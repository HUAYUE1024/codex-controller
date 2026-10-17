/* Browser speech lifecycle. No DOM, credentials, model calls, or audio uploads here. */
(() => {
  const join = (a, b) => a && b ? a + (/[a-z0-9]$/i.test(a) && /^[a-z0-9]/i.test(b) ? ' ' : '') + b : a || b;
  const messages = {
    'not-allowed': '麦克风权限未获允许。请在浏览器网站设置中检查麦克风权限后重试。',
    'service-not-allowed': '浏览器语音服务未获允许，请检查浏览器或组织设置。',
    'audio-capture': '没有可用的麦克风输入。请检查默认录音设备及麦克风连接。',
    network: '浏览器在线语音服务连接失败；这不表示麦克风故障。已保留草稿，请使用本地离线语音，或恢复服务后短按 RT 重试。',
    'language-not-supported': '当前语音服务不支持所选识别语言。',
    'audio-timeout': '语音准备超时，麦克风尚未进入收音。请检查语音诊断、麦克风权限和默认输入设备后重试。',
  };

  window.ControllerVoice = class ControllerVoice {
    constructor({createRecognition, onState = () => {}, onText = () => {}, onError = () => {},
      schedule = (fn, delay) => setTimeout(fn, delay), unschedule = id => clearTimeout(id), now = () => performance.now(),
      maxDurationMs = 180000, maxRestarts = 4, finalizeMs = 1500, startupMs = 12000}) {
      Object.assign(this, {createRecognition, onState, onText, onError, schedule, unschedule, now, maxDurationMs, maxRestarts, finalizeMs, startupMs});
      this.version = 0; this.phase = 'idle'; this.recognition = null;
      this.desired = false; this.transcript = ''; this.timers = new Map();
      this.audioActive = false; this.captureStarted = false;
    }
    timer(name, fn, delay) {
      this.clearTimer(name);
      this.timers.set(name, this.schedule(() => { this.timers.delete(name); fn(); }, delay));
    }
    clearTimer(name) {
      if (this.timers.has(name)) this.unschedule(this.timers.get(name));
      this.timers.delete(name);
    }
    clearTimers() { for (const name of [...this.timers.keys()]) this.clearTimer(name); }
    emit(phase = this.phase) {
      this.phase = phase;
      this.onState({phase, recognition: this.recognition, desired: this.desired,
        transcript: this.transcript, interim: this.interim,
        elapsedMs: Math.max(0, this.now() - (this.startedAt ?? this.now())), reason: this.reason,
        audioActive: this.audioActive, captureStarted: this.captureStarted, restarts: this.restarts || 0,input:this.input});
    }
    start() {
      this.cancel(false);
      this.desired = true; this.startedAt = this.now(); this.committed = '';
      this.transcript = ''; this.cycleText = ''; this.interim = false;
      this.restarts = 0; this.lastProgressAt = this.startedAt; this.reason = null;
      this.input = null;
      this.audioActive = false; this.captureStarted = false;
      this.input = null;
      this.timer('deadline', () => this.stop('limit'), this.maxDurationMs);
      const tick = () => { if (this.desired) { this.emit(); this.timer('tick', tick, 1000); } };
      this.timer('tick', tick, 1000);
      this.begin();
    }
    begin() {
      if (!this.desired) return;
      const version = this.version;
      let r;
      try { r = this.createRecognition(); } catch (e) { this.fail('start', e.message); return; }
      this.recognition = r; this.cycleText = '';
      let audioStartedAt = null;
      const current = () => version === this.version && r === this.recognition;
      r.lang = 'zh-CN'; r.continuous = true; r.interimResults = true;
      r.onstart = () => { if (current() && this.desired && !this.audioActive) this.emit('connecting'); };
      r.oninput = input => { if(current()){this.input=input;this.emit();} };
      r.onaudiostart = () => {
        if (!current() || !this.desired) return;
        this.clearTimer('startup'); this.clearTimer('audio-end');
        this.audioActive = true; this.captureStarted = true; audioStartedAt = this.now();
        this.emit('listening');
      };
      r.onaudioend = () => {
        if (!current()) return;
        this.audioActive = false;
        if (this.desired) {
          this.emit('restarting');
          // Bound browsers that close the mic but never deliver the service end event.
          this.timer('audio-end', () => {
            if (!current() || !this.desired) return;
            try { r.abort(); } catch {}
            if (current()) r.onend();
          }, 2000);
        } else this.emit();
      };
      r.onspeechstart = () => { if (current() && this.desired) { this.clearTimer('startup'); this.captureStarted = true; this.emit('speech'); } };
      r.onspeechend = () => { if (current() && this.desired) this.emit('waiting'); };
      r.onresult = e => {
        if (!current()) return;
        const results = Array.from(e.results || []);
        this.cycleText = results.map(result => result[0]?.transcript || '').join('');
        this.transcript = join(this.committed, this.cycleText);
        this.interim = results.some(result => result.isFinal !== true);
        if (this.cycleText) { this.clearTimer('startup'); this.captureStarted = true; this.restarts = 0; this.lastProgressAt = this.now(); }
        this.onText(this.transcript, {interim: this.interim});
        this.emit(this.desired ? 'speech' : 'stopping');
      };
      r.onerror = e => {
        if (!current()) return;
        if (e.error === 'no-speech' || e.error === 'aborted') {
          if (this.desired) this.emit('waiting');
          return;
        }
        this.fail(e.error || 'unknown',e.error?.startsWith('local-')?e.message:undefined);
      };
      r.onend = () => {
        if (!current()) return;
        this.clearTimer('startup'); this.clearTimer('audio-end'); this.audioActive = false;
        this.recognition = null; this.committed = this.transcript; this.cycleText = '';
        if (this.phase === 'error') { this.emit(); return; }
        if (!this.desired) { this.finish(); return; }
        // Quiet, healthy capture is not a failure. Keep its session through pauses.
        if (audioStartedAt !== null && this.now() - audioStartedAt >= 1000) {
          this.restarts = 0; this.lastProgressAt = this.now();
        }
        if (++this.restarts > this.maxRestarts && this.now() - this.lastProgressAt >= 20000) {
          this.fail('no-speech', '语音服务连续结束且未获得新文字。草稿已保留，请检查麦克风输入后重试。');
          return;
        }
        this.emit('restarting');
        this.timer('restart', () => { if (version === this.version && this.desired) this.begin(); }, Math.min(250 * 2 ** (this.restarts - 1), 1500));
      };
      this.emit('starting');
      this.timer('startup', () => { if (current() && this.desired) this.fail('audio-timeout'); }, this.startupMs);
      try { r.start(); } catch (e) { this.fail('start', e.message); }
    }
    fail(code, detail) {
      this.desired = false; this.audioActive = false; this.clearTimers();
      const r = this.recognition; this.recognition = null;
      try { r?.abort(); } catch {}
      this.reason = code; this.emit('error');
      this.onError({code, message: detail || messages[code] || `语音识别中断（${code}）。草稿已保留，可检查语音诊断后重试。`});
    }
    stop(reason = 'release') {
      if (!this.desired) return;
      this.desired = false; this.reason = reason; this.clearTimers();
      const r = this.recognition;
      if (!r) { this.finish(); return; }
      this.emit('stopping');
      // Some browsers never emit end after stop; bound finalization and release the microphone.
      this.timer('finalize', () => {
        this.recognition = null;
        try { r.abort(); } catch {}
        this.finish();
      }, this.finalizeMs);
      try { r.stop(); } catch {
        this.recognition = null;
        try { r.abort(); } catch {}
        this.finish();
      }
    }
    finish() {
      this.clearTimers(); this.desired = false; this.audioActive = false; this.recognition = null;
      this.emit(this.transcript ? 'ready' : 'empty');
    }
    cancel(notify = true) {
      this.version++; this.desired = false; this.audioActive = false; this.captureStarted = false; this.reason = null; this.clearTimers();
      const r = this.recognition; this.recognition = null;
      try { r?.abort(); } catch {}
      this.phase = 'idle';
      if (notify) this.emit();
    }
  };
})();
