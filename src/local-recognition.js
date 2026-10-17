/* SpeechRecognition-shaped adapter: browser permission/capture -> loopback PCM -> local neural ASR. */
(() => {
  window.ControllerLocalRecognition=class ControllerLocalRecognition {
    constructor({deviceId='',getMedia=()=>navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false}),
      createAudio=()=>new window.AudioContext({sampleRate:16000}),createNode=context=>new window.AudioWorkletNode(context,'controller-pcm',{channelCount:1,channelCountMode:'explicit',outputChannelCount:[1]}),
      request=(url,options)=>fetch(url,options),createEvents=url=>new EventSource(url)}={}){
      Object.assign(this,{getMedia,createAudio,createNode,request,createEvents});this.finals=[];this.queue=Promise.resolve();this.sequence=0;this.queuedBytes=0;
    }
    async json(url,body={},signal=this.abortController?.signal){
      const response=await this.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
      const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'本机语音服务请求失败'),{code:value.code||'local-transport'});return value;
    }
    start(){this.active=true;this.abortController=new AbortController();this.open().catch(e=>this.fail(e));}
    async open(){
      // Model preparation opens neither a microphone nor an audio session with an idle deadline.
      await this.json('/api/voice/prepare');if(!this.active)return;
      this.context=this.createAudio();
      const stream=await this.getMedia();
      if(!this.active){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;
      const track=stream.getAudioTracks?.()[0]||stream.getTracks()[0],settings=track?.getSettings?.()||{};
      this.input={device:track?.label||'系统默认麦克风',sampleRate:settings.sampleRate,channels:settings.channelCount,samples:0,rms:0,maxRms:0,maxPeak:0};
      this.oninput?.({...this.input});
      for(const track of stream.getTracks())track.onended=()=>{if(this.active&&!this.stopping)this.fail(Object.assign(new Error('麦克风输入已断开'),{code:'audio-capture'}));};
      await this.context.audioWorklet.addModule('/voice-worklet.js');if(!this.active)return;
      if(this.context.sampleRate!==16000)throw new Error('当前浏览器未提供 16 kHz 音频上下文');
      // Keep the start response observable after cancellation so a late-created session can be released.
      const session=await this.json('/api/voice/start',{},null);this.sessionId=session.sessionId;
      if(!this.active){this.cancelRemote();return;}
      this.events=this.createEvents(`/api/voice/${this.sessionId}/events`);
      this.events.onmessage=e=>{try{this.event(JSON.parse(e.data));}catch(error){this.fail(error);}};
      this.events.onerror=()=>{if(this.active)this.fail(Object.assign(new Error('本机语音结果连接中断，已有文字已保留'),{code:'local-transport'}));};
      this.node=this.createNode(this.context);
      this.node.port.onmessage=e=>{
        if(e.data.flushed){this.flushResolve?.();return;}
        if(!this.active||!e.data.samples)return;
        let sum=0,peak=0;for(const value of e.data.samples){sum+=value*value;peak=Math.max(peak,Math.abs(value));}
        const rms=Math.sqrt(sum/e.data.samples.length)/32768;
        Object.assign(this.input,{samples:this.input.samples+e.data.samples.length,rms,maxRms:Math.max(this.input.maxRms,rms),maxPeak:Math.max(this.input.maxPeak,peak)});
        this.oninput?.({...this.input});
        if(!this.capturing){this.capturing=true;this.onaudiostart?.();}
        this.upload(e.data.samples);
      };
      this.source=this.context.createMediaStreamSource(stream);this.source.connect(this.node);this.node.connect(this.context.destination);
      await this.context.resume();if(this.active)this.onstart?.();
    }
    upload(samples){
      const bytes=samples.byteLength;this.queuedBytes+=bytes;
      if(this.queuedBytes>128000){this.fail(Object.assign(new Error('本机语音处理积压，已停止收音并保留文字'),{code:'local-backpressure'}));return;}
      const sequence=this.sequence++;
      this.queue=this.queue.then(async()=>{
        if(!this.active)return;
        const response=await this.request(`/api/voice/${this.sessionId}/audio?sequence=${sequence}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:samples.buffer.slice(samples.byteOffset,samples.byteOffset+samples.byteLength),signal:this.abortController.signal});
        if(!response.ok){const error=await response.json();throw Object.assign(new Error(error.error||'本机音频传输失败'),{code:error.code||'local-transport'});}
      }).catch(e=>this.fail(e)).finally(()=>{this.queuedBytes-=bytes;});
    }
    event(event){
      if(!this.active)return;
      if(event.type==='speech-start'){this.onspeechstart?.();return;}
      if(event.type==='speech-end'){this.onspeechend?.();return;}
      if(event.type==='error'){this.fail(Object.assign(new Error(event.message||'本地识别引擎异常'),{code:event.code||'local-engine'}));return;}
      if(event.type==='end'){this.active=false;this.cleanup();this.onend?.();return;}
      if(!['hypothesis','result'].includes(event.type)||typeof event.text!=='string'||!event.text)return;
      const result=Object.assign([{transcript:event.text,confidence:event.confidence}],{isFinal:event.type==='result'});
      if(result.isFinal)this.finals.push(result);
      this.onresult?.({results:result.isFinal?[...this.finals]:[...this.finals,result]});
    }
    stop(){
      if(!this.active||this.stopping)return;this.stopping=true;
      this.stopCapture();
      if(!this.node){this.abort();this.onend?.();return;}
      const flushed=new Promise(resolve=>{const timer=setTimeout(resolve,500);this.flushResolve=()=>{clearTimeout(timer);resolve();};});
      this.node.port.postMessage('flush');
      flushed.then(()=>this.queue).then(()=>{this.closeAudio();if(this.active&&this.sessionId)return this.json(`/api/voice/${this.sessionId}/end`);}).catch(e=>this.fail(e));
    }
    stopCapture(){this.source?.disconnect();for(const track of this.stream?.getTracks()||[]){track.onended=null;track.stop();}if(this.capturing){this.capturing=false;this.onaudioend?.();}}
    closeAudio(){this.node?.disconnect();this.context?.close().catch(()=>{});}
    cleanup(){this.stopCapture();this.closeAudio();this.events?.close();this.flushResolve?.();}
    cancelRemote(){if(this.sessionId)this.json(`/api/voice/${this.sessionId}/cancel`,{},null).catch(()=>{});}
    abort(){this.active=false;this.abortController?.abort();this.cleanup();this.cancelRemote();}
    fail(error){
      if(!this.active)return;
      const code=error.name==='NotAllowedError'?'not-allowed':['NotFoundError','NotReadableError','OverconstrainedError'].includes(error.name)?'audio-capture':error.code||'local-engine';
      this.abort();this.onerror?.({error:code,message:error.message});this.onend?.();
    }
  };
})();
