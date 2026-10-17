/* Only renders protocol-provided summaries and activity, never invents model reasoning. */
(() => {
  const el = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (cls) element.className = cls;
    return element;
  };
  const statusText = {inProgress: '进行中', completed: '已结束', failed: '失败', interrupted: '已中止', declined: '已拒绝', pending: '待执行', retrying: '正在重试'};
  const labels = {userMessage: '你', agentMessage: 'Codex', reasoning: '思考摘要', plan: '计划说明', executionPlan: '执行计划', commandExecution: '终端执行', fileChange: '文件变更', mcpToolCall: '工具调用'};
  const outputLimit = 200000;
  function inline(parent, text) {
    for (const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g)) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link && /^https?:\/\//i.test(link[2])) {
        const anchor = el('a', link[1]); anchor.href = link[2]; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; parent.append(anchor);
      } else parent.append(part.startsWith('`') && part.endsWith('`') ? el('code', part.slice(1, -1)) :
        part.startsWith('**') && part.endsWith('**') ? el('strong', part.slice(2, -2)) : el('span', part));
    }
  }
  function cells(line) {
    const values = []; let current = '', code = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\' && line[i + 1] === '|') { current += '|'; i++; }
      else if (line[i] === '`') { code = !code; current += line[i]; }
      else if (line[i] === '|' && !code) { values.push(current.trim()); current = ''; }
      else current += line[i];
    }
    values.push(current.trim()); if (line.trim().startsWith('|')) values.shift(); if (line.trim().endsWith('|')) values.pop();
    return values;
  }
  function markdown(parent, text) {
    parent.replaceChildren();
    let code = null, language = '', paragraph = [], list = null;
    const flush = () => { if (paragraph.length) { const p = el('p'); inline(p, paragraph.join('\n')); parent.append(p); paragraph = []; } list = null; };
    const codeBlock = () => {
      const block = el('div', null, 'code-block'), header = el('div', null, 'code-header');
      const copy = el('button', '复制', 'code-copy'); copy.type = 'button';
      const value = code.join('\n');
      copy.onclick = async () => { try { await navigator.clipboard.writeText(value); copy.textContent = '已复制'; } catch { copy.textContent = '复制未完成'; } };
      header.append(el('span', language || '代码'), copy); const pre = el('pre'); pre.append(el('code', value));
      block.append(header, pre); parent.append(block); code = null;
    };
    // ponytail: a bounded DOM-only Markdown subset, not full CommonMark; use an audited parser for richer syntax.
    const lines = String(text).split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const fence = /^\s*```\s*([^`]*)$/.exec(line);
      if (fence) { if (code) codeBlock(); else { flush(); code = []; language = fence[1].trim(); } continue; }
      if (code) { code.push(line); continue; }
      if (!line.trim()) { flush(); continue; }
      const columns = cells(line), separators = cells(lines[index + 1] || '');
      if (line.includes('|') && columns.length <= 30 && columns.length === separators.length && separators.every(value => /^:?-{3,}:?$/.test(value))) {
        flush(); const wrapper = el('div', null, 'table-scroll'), table = el('table'), head = el('thead'), row = el('tr'), body = el('tbody');
        for (const title of columns) { const cell = el('th'); inline(cell, title); row.append(cell); } head.append(row); index++;
        let count = 0;
        while (lines[index + 1]?.includes('|') && count++ < 200) {
          const values = cells(lines[++index]), row = el('tr');
          for (let column = 0; column < columns.length; column++) { const cell = el('td'); inline(cell, values[column] || ''); row.append(cell); }
          body.append(row);
        }
        table.append(head, body); wrapper.append(table); parent.append(wrapper); continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line), bullet = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
      if (heading) { flush(); const h = el('h3'); inline(h, heading[2]); parent.append(h); }
      else if (bullet) { if (!list) { flush(); list = el('ul'); parent.append(list); } const li = el('li'); inline(li, bullet[1]); list.append(li); }
      else { if (list) flush(); paragraph.push(line); }
    }
    if (code) codeBlock(); flush();
  }
  window.ControllerActivity = class ControllerActivity {
    constructor(container) { this.container = container; this.items = new Map(); this.turns = new Map(); }
    clear() { this.items.clear(); this.turns.clear(); this.container.replaceChildren(); }
    turn(id = 'unassigned', data = {}) {
      if (!this.turns.has(id)) {
        if (!this.turns.size) this.container.replaceChildren();
        const root = el('section', null, 'turn-card'), header = el('div', null, 'turn-header');
        const badge = el('span', null, 'activity-status'), time = el('span', null, 'turn-meta'), body = el('div', null, 'turn-content');
        root.dataset.turnId = id; header.append(el('span', '本轮执行', 'turn-title'), badge, time); root.append(header, body); this.container.append(root);
        this.turns.set(id, {root, badge, time, body});
      }
      const entry = this.turns.get(id), state = data.status || entry.root.dataset.status || 'inProgress';
      entry.root.dataset.status = state; entry.badge.textContent = statusText[state] || state;
      if (data.durationMs != null) entry.time.textContent = `${(data.durationMs / 1000).toFixed(1)} 秒`;
      if (data.error?.message) {
        if (!entry.error) { entry.error = el('p', null, 'turn-error'); entry.root.append(entry.error); }
        entry.error.textContent = `该轮记录：${data.error.message}`;
      } else if (Object.hasOwn(data, 'error') && entry.error) { entry.error.textContent = ''; }
      const plan = this.items.get(`plan:${id}`);
      if (plan && !['inProgress', 'retrying'].includes(state)) { plan.phase = state; this.render(plan); }
      return entry;
    }
    upsert(item, {turnId = 'unassigned', phase = 'inProgress'} = {}) {
      if (!item?.id) return;
      const turn = this.turn(turnId);
      let entry = this.items.get(item.id);
      if (!entry) {
        const detail = ['reasoning', 'commandExecution', 'fileChange', 'mcpToolCall', 'executionPlan'].includes(item.type);
        const root = el(detail ? 'details' : 'article', null, `message activity-${item.type}${item.type === 'userMessage' ? ' user' : ''}`);
        root.dataset.itemId = item.id;
        const label = el(detail ? 'summary' : 'div', null, detail ? 'activity-summary' : 'message-label');
        const title = el('span', null, 'activity-title'), badge = el('span', null, 'activity-status'), body = el('div', null, 'message-body');
        label.append(title, badge); root.append(label, body); if (item.type === 'reasoning') root.open = phase === 'inProgress';
        turn.body.append(root); entry = {root, title, badge, body, item: {}, turnId, phase}; this.items.set(item.id, entry);
      }
      const old = entry.item;
      entry.item = {...old, ...item}; entry.phase = phase;
      for (const key of ['text', 'aggregatedOutput']) if (!item[key] && old[key]) entry.item[key] = old[key];
      this.render(entry); return entry;
    }
    render(entry) {
      const item = entry.item, type = item.type;
      const state = item.status || entry.phase;
      entry.root.dataset.status = state;
      entry.title.textContent = type === 'agentMessage' ? item.phase === 'commentary' ? '进度说明' : item.phase === 'final_answer' ? '最终回复' : 'Codex 回复' : labels[type] || type;
      entry.badge.textContent = type === 'userMessage' ? '' : statusText[state] || state;
      if (type === 'userMessage') entry.body.textContent = (item.content || []).map(x => x.text || `[${x.type}]`).join('\n');
      else if (type === 'agentMessage' || type === 'plan') {
        if (entry.phase === 'completed') markdown(entry.body, item.text || ''); else entry.body.textContent = item.text || '';
      } else if (type === 'reasoning') entry.body.textContent = (item.summary || []).join('\n\n') || (entry.phase === 'completed' ? '该条记录未提供可显示的思考摘要。' : '等待服务端提供可显示的思考摘要…');
      else if (type === 'commandExecution') {
        const output = item.aggregatedOutput || '';
        // ponytail: visible terminal tail is capped at 200k characters; full history stays in the Codex session.
        entry.body.textContent = `$ ${item.command || ''}\n${item.cwd ? `目录：${item.cwd}\n` : ''}${output.length > outputLimit || item.truncated ? '[仅展示最近 200000 个字符]\n' : ''}${output.slice(-outputLimit)}${item.exitCode != null ? `\n退出码 ${item.exitCode}` : ''}${item.durationMs != null ? ` · ${(item.durationMs / 1000).toFixed(1)} 秒` : ''}`;
      } else if (type === 'fileChange') entry.body.textContent = (item.changes || []).map(c => `${c.path}\n${c.diff || ''}`).join('\n\n');
      else if (type === 'mcpToolCall') entry.body.textContent = `${item.server || ''} / ${item.tool || ''}\n${JSON.stringify(item.arguments || {}, null, 2)}${item.error ? `\n${item.error.message || '工具调用失败'}` : ''}`;
      else if (type === 'executionPlan') {
        entry.body.replaceChildren(); if (item.explanation) entry.body.append(el('p', item.explanation));
        const list = el('ol', null, 'plan-steps');
        for (const step of item.plan || []) { const row = el('li'); row.dataset.status = step.status; row.append(el('span', statusText[step.status] || step.status, 'plan-state'), el('span', step.step)); list.append(row); }
        entry.body.append(list);
      } else entry.body.textContent = item.text || '该活动的详情未由服务端提供。';
    }
    delta({itemId, turnId, delta, summaryIndex = 0}, type) {
      if (!itemId || typeof delta !== 'string') return;
      let entry = this.items.get(itemId);
      if (entry?.phase === 'completed') return;
      if (!entry) entry = this.upsert({id: itemId, type}, {turnId});
      if (type === 'reasoning') {
        if (!Number.isInteger(summaryIndex) || summaryIndex < 0 || summaryIndex > 1000) return;
        const summary = entry.item.summary ||= []; summary[summaryIndex] = (summary[summaryIndex] || '') + delta;
      } else {
        const key = type === 'commandExecution' ? 'aggregatedOutput' : 'text';
        entry.item[key] = (entry.item[key] || '') + delta;
        if (type === 'commandExecution' && entry.item[key].length > outputLimit) { entry.item[key] = entry.item[key].slice(-outputLimit); entry.item.truncated = true; }
      }
      this.render(entry);
    }
    plan(data) { this.upsert({id: `plan:${data.turnId}`, type: 'executionPlan', plan: data.plan, explanation: data.explanation}, {turnId: data.turnId}); }
    history(thread) {
      this.clear();
      for (const turn of thread.turns || []) {
        this.turn(turn.id, turn);
        for (const item of turn.items || []) {
          if (turn.status !== 'inProgress' && item.type === 'reasoning' && !(item.summary || []).some(text => text.trim())) continue;
          this.upsert(item, {turnId: turn.id, phase: turn.status === 'inProgress' ? 'inProgress' : 'completed'});
        }
      }
    }
  };
})();
