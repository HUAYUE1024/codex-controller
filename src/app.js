'use strict';
const $=id=>document.getElementById(id);
const state={threads:[],selected:null,connected:false,defaultCwd:'',pending:[],drafts:new Map(),resumed:new Set(),active:new Map(),busy:false,cursor:null,threadListVersion:0,loadingThreads:false,voiceConsent:false,recognition:null,recording:false,voiceBase:'',voiceThread:null,voiceSession:0,padButtons:[],padIndex:null,lastNav:0,selectionVersion:0,modalVersion:0,issues:new Map(),operations:new Map(),issueSequence:0,turnIds:new Map(),eventVersion:0,voiceController:null,voiceWritten:'',voiceSource:null,rtReleaseAt:null,voiceEngine:'local'};
function mutePad(){state.padMuted=true;state.padVoiceArmed=false;}
mutePad();
const padControls=new window.ControllerGamepad(document,{
  onOpen:()=>{cancelVoice();pilot.suspendDesktop();pilot.cancelWheel();pilot.reset();mutePad();},
  onClose:()=>{pilot.reset();mutePad();},
  onSettings:()=>{stopVoice('settings');pilot.reset();mutePad();state.rtReleaseAt=null;syncPadHints();},
});
const pilot=new window.ControllerPilot(document,{
  onInsert:insertIntent,
  onWheelOpen:()=>{cancelVoice();pilot.suspendDesktop();pilot.reset();},
  onWheelClose:()=>{mutePad();},
  onNotice:pilotNotice,
});
state.readingAnchors=new Map();
function pilotNotice(text){$('pilotNotice').textContent=text;}
function renderIntentUndo(){const last=state.lastIntent;$('intentUndo').classList.toggle('hidden',!last||last.threadId!==state.selected||$('prompt').value!==last.after);}
function undoIntent(){
  const last=state.lastIntent;
  if(!last||last.threadId!==state.selected||$('prompt').value!==last.after)return false;
  $('prompt').value=last.before;if(state.selected)state.drafts.set(state.selected,last.before);state.lastIntent=null;
  renderIntentUndo();pilotNotice('已撤回上一次意图插入 · 原草稿已恢复');pilot.focus($('prompt'));return true;
}
function insertIntent(intent){
  const before=$('prompt').value,after=before+(before.trim()?'\n\n':'')+intent.text;
  $('prompt').value=after;state.lastIntent={threadId:state.selected,before,after};
  if(state.selected)state.drafts.set(state.selected,after);renderIntentUndo();pilot.focus($('prompt'));
  pilotNotice(`「${intent.title}」已加入草稿 · 确认后才会发送`);
}
function pilotBack(){
  if(pilot.closeKeyboard())return;
  if(pilot.isWheelOpen()){pilot.cancelWheel();return;}
  if(padControls.isOpen()){padControls.close();return;}
  if($('modal').open){$('modal').close();return;}
  if(pilot.pointerMode){pilot.setPointer(false);pilotNotice('已返回空间焦点导航 · 草稿已保留');return;}
  if(state.focusMode){toggleFocusMode();return;}
  pilotNotice('回到草稿 · 已保留文字');
  pilot.focus($('prompt'));
}
function toggleFocusMode(){
  state.focusMode=!state.focusMode;document.body.classList.toggle('pilot-focus-mode',state.focusMode);
  $('focusToggle').setAttribute('aria-pressed',String(state.focusMode));pilot.focus($('prompt'));
  pilotNotice(state.focusMode?'专注模式 · 再按摇杆恢复完整工作台':'已恢复完整工作台');
}
function readingAnchor(clear=false){
  const key=state.selected||'draft',timeline=$('timeline');
  state.lastReading=null;
  if(clear){state.readingAnchors.delete(key);pilotNotice('已清除当前任务的阅读锚点');}
  else if(state.readingAnchors.has(key)){const current=timeline.scrollTop;timeline.scrollTop=state.readingAnchors.get(key);state.readingAnchors.set(key,current);pilotNotice('已返回阅读锚点 · 再按可回到刚才的位置');}
  else{state.readingAnchors.set(key,timeline.scrollTop);pilotNotice('阅读锚点已记住 · 移动后可一键返回');}
  renderAnchor();
}
function renderAnchor(){const saved=state.readingAnchors.has(state.selected||'draft');$('anchorLabel').textContent=saved?'返回锚点':'锚点';$('anchorClear').classList.toggle('hidden',!saved);}
function taskOverview(){
  modal('任务速览');$('modal').classList.add('task-overview');
  const input=node('input');input.type='search';input.placeholder='搜索任务名或工作目录…';input.setAttribute('aria-label','搜索已加载的任务');
  const grid=node('div',undefined,'task-deck');
  const render=()=>{
    const query=input.value.trim().toLocaleLowerCase();grid.replaceChildren();
    for(const thread of state.threads.filter(t=>`${t.name||t.preview||''} ${t.cwd||''}`.toLocaleLowerCase().includes(query))){
      const card=node('button',undefined,'task-deck-card');card.type='button';card.setAttribute('aria-current',thread.id===state.selected?'page':'false');
      card.append(node('small',state.active.has(thread.id)?'进行中':thread.id===state.selected?'当前任务':'工作空间'),node('strong',thread.name||thread.preview||'新任务'),node('span',thread.cwd||'本地任务'));
      card.onclick=action(async()=>{$('modal').close();await selectThread(thread.id);pilotNotice('已切换任务 · 草稿按任务保留');});grid.append(card);
    }
    if(!grid.children.length)grid.append(node('p','没有匹配的已加载任务。','empty-list'));
  };
  input.oninput=render;$('modalBody').append(node('p',`已加载 ${state.threads.length} 个任务。左摇杆按方位穿梭，确认进入；也可输入关键词。`),input,grid);
  modalButton('返回',()=> $('modal').close());render();input.focus();
}
function voiceControlLabel(){return padControls.config.bindings.voice==null?'麦克风按钮':padControls.key('voice');}
function syncPadHints(resetVoice=true){
  for(const element of document.querySelectorAll('[data-pad-action]')){element.textContent=padControls.key(element.dataset.padAction);element.classList.toggle('hidden',padControls.config.bindings[element.dataset.padAction]==null);}
  $('padVoiceHint').textContent=`短按 ${voiceControlLabel()} 开始，再按结束，无需按住。每段最多 3 分钟，停顿不清空已转写文字。`;
  if(resetVoice)renderVoice('文字输入 / 短按 RT 持续说话');
}
const welcome=$('timeline').innerHTML;
const activity=new window.ControllerActivity($('timeline'));
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function renderFeedback(){
  const issues=[...state.issues.values()].filter(issue=>issue.global||issue.threadId===state.selected).sort((a,b)=>b.sequence-a.sequence);
  const latest=issues[0];state.visibleIssue=latest?.key;
  $('feedback').classList.toggle('hidden',!latest);$('error').classList.toggle('hidden',!latest);
  $('error').textContent=latest?.message||'';
  const labels={voice:'语音识别',bridge:'Codex 连接',transport:'实时连接',turn:'当前执行',history:'任务读取',action:'当前操作'};
  $('errorContext').textContent=latest?`${labels[latest.source]||'当前操作'} · ${latest.time}`:'';
}
function error(e,{source='action',global=false,threadId=state.selected}={}){
  const message=typeof e==='string'?e:e?.message||String(e);
  if($('modal').open&&!global){$('modalError').textContent=message;$('modalError').classList.remove('hidden');$('modalError').focus();return;}
  const key=`${global?'global':threadId??'draft'}:${source}`;
  state.issues.set(key,{key,source,global,threadId,message,sequence:++state.issueSequence,time:new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})});
  renderFeedback();
}
function clearError(source){
  for(const [key,issue]of state.issues)if(source?issue.source===source:!issue.global)state.issues.delete(key);
  if(!source||source==='action'){$('modalError').textContent='';$('modalError').classList.add('hidden');}
  renderFeedback();
}
async function api(path,body){const r=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.error)throw new Error(typeof d.error==='string'?d.error:d.error?.message||`请求失败 (${r.status})`);return d;}
const rpc=(method,params={})=>api('/api/rpc',{method,params});
function action(fn,{source='action',global=false}={}){
  return async(...args)=>{
    const operation=(state.operations.get(source)||0)+1;state.operations.set(source,operation);
    const selection=state.selectionVersion,modal=state.modalVersion,wasModal=$('modal').open;
    clearError(source);
    const current=()=>state.operations.get(source)===operation&&(global||state.selectionVersion===selection)&&(!wasModal||($('modal').open&&state.modalVersion===modal));
    try{await fn(...args);if(current())clearError(source);}catch(e){if(current())error(e,{source,global});}
  };
}
function setConnected(connected,message,source='bridge'){const justConnected=connected&&!state.connected;if(!connected){state.threadListVersion++;state.loadingThreads=false;$('refresh').setAttribute('aria-busy','false');state.resumed.clear();state.active.clear();state.pending=[];renderAccount(null);}state.connected=connected;$('connection').textContent=connected?'本地 Codex 已连接':'本地 Codex 未连接';$('connectionDot').classList.toggle('mint',connected);if(connected){clearError('bridge');}else if(message)error(message,{source,global:true});renderControls();if(justConnected){action(async()=>{await loadThreads();renderAccount(await rpc('account/read'));})();}}
function renderControls(){renderIntentUndo();const active=state.active.get(state.selected);$('send').disabled=!state.connected||state.busy;$('send').firstChild.textContent=state.busy?'正在发送 ':active?'追加指令 ':'发送指令 ';$('send').setAttribute('aria-busy',String(state.busy));for(const id of ['newThread','refresh','login'])$(id).disabled=!state.connected;$('loadMore').disabled=!state.connected||state.loadingThreads;$('interrupt').classList.toggle('hidden',!active);$('turnStatus').textContent=state.busy?'正在发送指令':active?'Codex 正在工作':state.connected?'等待指令':'等待连接';$('turnStatus').dataset.state=state.busy?'submitting':active?'running':state.connected?'idle':'offline';$('composeLabel').textContent=active?'追加指令到当前任务':'给 Codex 的指令';$('approvalCount').textContent=state.pending.length;}
function renderThreads(){const focusedId=document.activeElement?.dataset?.threadId;const box=$('threads');box.replaceChildren();if(!state.threads.length){box.append(node('p',state.connected?'暂无任务。创建你的第一个任务。':'连接后显示真实任务记录。','empty-list'));}for(const t of state.threads){const b=node('button',undefined,'thread'+(t.id===state.selected?' selected':''));b.dataset.threadId=t.id;b.title=[t.name||t.preview||'新任务',t.cwd].filter(Boolean).join('\n');b.setAttribute('aria-current',t.id===state.selected?'page':'false');b.append(node('span',t.name||t.preview||'新任务','thread-title'),node('span',`${state.active.has(t.id)?'● 进行中 · ':''}${t.cwd||'本地任务'}`,'thread-meta'));b.onclick=action(()=>selectThread(t.id));box.append(b);if(t.id===focusedId)b.focus();}$('loadMore').classList.toggle('hidden',!state.cursor);}
async function loadThreads(more=false){
  if(more&&(!state.cursor||state.loadingThreads))return;
  const version=++state.threadListVersion,cursor=state.cursor;
  state.loadingThreads=true;$('refresh').setAttribute('aria-busy','true');$('loadMore').disabled=true;
  try{
    const d=await rpc('thread/list',{limit:40,sortKey:'updated_at',...(more&&cursor?{cursor}:{})});
    if(version!==state.threadListVersion)return;
    state.cursor=d.nextCursor;state.threads=more?[...state.threads,...d.data.filter(t=>!state.threads.some(x=>x.id===t.id))]:d.data;renderThreads();
  }catch(e){if(version===state.threadListVersion)throw e;}finally{
    if(version===state.threadListVersion){state.loadingThreads=false;$('refresh').setAttribute('aria-busy','false');$('loadMore').disabled=!state.connected;}
  }
}
function renderItem(item,context){return activity.upsert(item,context);}
function scrollBottom(){const e=$('timeline');e.scrollTop=e.scrollHeight;}
function renderHistory(thread){
  state.active.delete(thread.id);state.turnIds.delete(thread.id);clearError('turn');activity.history(thread);
  for(const turn of thread.turns||[]){state.turnIds.set(thread.id,turn.id);if(turn.status==='inProgress')state.active.set(thread.id,turn.id);}
  if(!thread.turns?.length)$('timeline').innerHTML=welcome;
  syncPadHints(false);scrollBottom();renderControls();
}
async function selectThread(id,suppliedThread=null){
  cancelVoice();pilot.suspendDesktop();pilot.cancelWheel();pilot.reset();state.lastReading=null;clearError();
  if(state.selected)state.drafts.set(state.selected,$('prompt').value);
  const unsent=!state.selected?$('prompt').value:'';state.selected=id;renderAnchor();
  if(unsent)state.drafts.set(id,unsent);
  const version=++state.selectionVersion,revision=state.eventVersion;$('prompt').value=state.drafts.get(id)||'';
  const t=state.threads.find(t=>t.id===id);
  $('threadTitle').textContent=t?.name||t?.preview||'任务';$('headline').textContent=t?.name||'专注于手中的任务。';$('subtitle').textContent=t?.cwd||'本地工作空间';
  renderThreads();renderControls();activity.clear();$('timeline').append(node('p','正在读取任务…','empty-list'));
  try{const d=suppliedThread?{thread:suppliedThread}:await rpc('thread/read',{threadId:id,includeTurns:true});if(version===state.selectionVersion&&revision===state.eventVersion)renderHistory(d.thread);}
  catch(e){if(version===state.selectionVersion&&revision===state.eventVersion){$('timeline').replaceChildren(node('p','任务记录未读入。请检查当前提示后重新选择任务。','empty-list'));error(e,{source:'history'});}}
}
function modal(title){pilot.suspendDesktop();pilot.cancelWheel();pilot.reset();state.modalVersion++;$('modal').classList.remove('task-overview');$('modalError').textContent='';$('modalError').classList.add('hidden');$('modalTitle').textContent=title;$('modalBody').replaceChildren();$('modalActions').replaceChildren();if(!$('modal').open)$('modal').showModal();}
function modalButton(label,fn,primary=false){const b=node('button',label,primary?'send':'');b.onclick=action(async()=>{if(b.disabled)return;const buttons=[...$('modalActions').children];buttons.forEach(x=>x.disabled=true);try{await fn();}finally{buttons.forEach(x=>x.disabled=false);}});$('modalActions').append(b);return b;}
function newThreadDialog(){modal('开启一个新任务');$('modalBody').append(node('p','Codex 将在所选本地目录中工作。额外权限按 Codex 策略请求确认，沙箱内允许的操作可自动执行。'));const label=node('label','工作目录');const input=node('input');input.id='cwdInput';input.value=state.defaultCwd;input.placeholder='C:\\Projects\\app 或 /绝对路径/项目';label.append(input);$('modalBody').append(label,node('p','使用已登录的 Codex 账号。模型使用量受你的套餐与配额限制。','modal-note'));modalButton('取消',()=> $('modal').close());modalButton('创建任务',async()=>{if(!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(input.value.trim()))throw new Error('请输入本地工作目录的绝对路径。');const d=await rpc('thread/start',{cwd:input.value.trim(),approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'});state.resumed.add(d.thread.id);if(!state.threads.some(t=>t.id===d.thread.id))state.threads.unshift(d.thread);$('modal').close();await selectThread(d.thread.id,d.thread);},true);input.focus();}
async function send(){if(state.busy)return;const rawText=$('prompt').value;const text=rawText.trim();if(!text){$('prompt').focus();return;}if(!state.selected){newThreadDialog();return;}if(!state.connected)throw new Error('请先连接本地 Codex。');cancelVoice();clearError();state.busy=true;renderControls();const threadId=state.selected;try{if(!state.resumed.has(threadId)){const d=await rpc('thread/resume',{threadId,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'});state.resumed.add(threadId);const running=d.thread.turns?.find(t=>t.status==='inProgress');if(running)state.active.set(threadId,running.id);}const active=state.active.get(threadId);const input=[{type:'text',text,text_elements:[]}];const d=await rpc(active?'turn/steer':'turn/start',{threadId,input,...(active?{expectedTurnId:active}:{})});if(d.turn?.id)state.active.set(threadId,d.turn.id);if(state.selected===threadId&&$('prompt').value.trim()===text)$('prompt').value='';if(state.drafts.get(threadId)===rawText||state.drafts.get(threadId)===text)state.drafts.set(threadId,'');}finally{state.busy=false;renderControls();}}
async function interrupt(){const turnId=state.active.get(state.selected);if(turnId)await rpc('turn/interrupt',{threadId:state.selected,turnId});}
async function status(){const d=await api('/api/status');setConnected(d.connected,d.error);state.defaultCwd=d.defaultCwd||state.defaultCwd;state.pending=d.pendingRequests||[];renderAccount(d.account);renderControls();return d;}
function renderAccount(account){const a=account?.account||account;$('account').textContent=a?.email||a?.type==='chatgpt'&&'ChatGPT 已登录'||'连接 ChatGPT 账号';}
async function login(){modal('连接你的 ChatGPT 账号');$('modalBody').append(node('p','登录将打开 OpenAI 官方授权页面。账号授权完成后，此本地界面会自动更新。'));modalButton('取消',()=> $('modal').close());modalButton('继续登录',async()=>{const d=await rpc('account/login/start',{type:'chatgpt'});if(!d.authUrl)throw new Error('Codex 没有返回授权链接。');const url=new URL(d.authUrl);if(url.protocol!=='https:'||!['auth.openai.com','auth0.openai.com','chatgpt.com','chat.openai.com'].includes(url.hostname))throw new Error('授权链接不属于已知的 OpenAI 官方登录域名，请改用 Codex 官方客户端登录。');$('modalBody').replaceChildren(node('p','请打开授权页面完成登录，然后回到这里。'));const a=node('a','打开 ChatGPT 授权页面 ↗','auth-link');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';$('modalBody').append(a);$('modalActions').replaceChildren();modalButton('检查登录状态',async()=>{const result=await rpc('account/read',{});renderAccount(result);if(result.account)$('modal').close();});window.open(url.href,'_blank','noopener,noreferrer');},true);}
async function respond(request,result){await api('/api/respond',{id:request.id,result,connectionId:request.connectionId});state.pending=state.pending.filter(r=>r.id!==request.id);renderControls();showApprovals();}
function showApprovals(){modal('需要你的确认');if(!state.pending.length){$('modalBody').append(node('p','没有待处理的请求。Codex 不会在这里自动批准任何权限。'));modalButton('返回',()=> $('modal').close());return;}for(const req of state.pending){const b=node('button',undefined,'pending-card');b.append(node('span',req.method),node('small',`任务 ${req.params.threadId||'当前任务'}`));b.onclick=()=> approvalDetail(req);$('modalBody').append(b);}}
function approvalDetail(req){modal('查看请求并决定');$('modalBody').append(node('p',req.method),node('pre',JSON.stringify(req.params,null,2)));const method=req.method;if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method)){modalButton('拒绝',()=>respond(req,{decision:'decline'}));modalButton('取消执行',()=>respond(req,{decision:'cancel'}));modalButton('仅批准本次',()=>respond(req,{decision:'accept'}),true);}else if(method==='item/tool/requestUserInput'){const inputs=[];for(const q of req.params.questions||[]){const wrap=node('label',q.question);let input;if(q.options?.length&&!q.isOther){input=node('select');for(const o of q.options){const opt=node('option',`${o.label}${o.description?' · '+o.description:''}`);opt.value=o.label;input.append(opt);}}else{input=node('input');input.type=q.isSecret?'password':'text';input.placeholder=q.options?.map(o=>o.label).join(' / ')||'输入回答';}wrap.append(input);$('modalBody').append(wrap);inputs.push([q.id,input]);}modalButton('提交回答',()=>{const answers={};for(const[id,input]of inputs){if(!input.value.trim())throw new Error('请填写所有回答。');answers[id]={answers:[input.value]};}return respond(req,{answers});},true);}else{$('modalBody').append(node('p','此请求类型暂不支持在此界面处理。请停止当前任务，再到 Codex 官方客户端重新执行。','modal-note'));}modalButton('返回列表',showApprovals);}

function help(){modal('让手柄成为你的工作台');$('modalBody').append(node('p',`${padControls.key('confirm')}：确认焦点或指针下的控件，输入框只聚焦；选中发送按钮后才发送。${padControls.key('back')}：逐层返回，不清空草稿。屏幕键盘键：编辑当前输入框；精准指针键：切换左摇杆的空间焦点 / 鼠标指针。右摇杆始终用于精读滚动。停止与待确认仍可通过页面按钮操作，也可在手柄工作台重新分配。${voiceControlLabel()}：短按开始持续语音，再按结束。${padControls.key('previous')} / ${padControls.key('next')}：切换任务。${padControls.key('intent')}：意图轮盘。${padControls.key('overview')}：任务速览。${padControls.key('focus')}：专注模式。${padControls.key('anchor')}：阅读锚点。`),node('p','键盘：Alt+K 屏幕键盘，Alt+M 精准指针；Tab 切换焦点，Enter 激活按钮，Ctrl / ⌘ + Enter 发送，Esc 关闭窗口。手柄需要浏览器支持 Gamepad API；连接后请按任意按钮唤醒。'),node('p','语音默认使用 Fun-ASR-Nano 本地模型识别。浏览器获得麦克风授权后，仅向本机发送音频；不保存原始录音，不使用付费语音 API 或 API key。模型识别仍可能有错字，发送前请校对。','modal-note'));modalButton('重新连接 Codex',async()=>{await api('/api/reconnect',{});state.resumed.clear();await status();$('modal').close();});modalButton('知道了',()=> $('modal').close(),true);}
function renderVoice(message){
  $('voice').classList.toggle('recording',state.recording&&!!state.voiceController?.audioActive);$('voice').setAttribute('aria-pressed',String(state.recording));
  $('voiceLabel').textContent=state.recording?'结束语音':'持续语音';
  $('voice').title=state.recording?'点击结束语音，也可再按一次语音键':'点击开始持续语音，无需按住';
  message=message?.replaceAll('RT',voiceControlLabel());
  if(message&&$('voiceStatus').textContent!==message)$('voiceStatus').textContent=message;
}
function getVoice(){
  if(state.voiceController)return state.voiceController;
  state.voiceController=new window.ControllerVoice({
    createRecognition:()=>state.voiceEngine==='local'?new window.ControllerLocalRecognition({deviceId:state.voiceDeviceId||''}):new (window.SpeechRecognition||window.webkitSpeechRecognition)(),
    finalizeMs:state.voiceEngine==='local'?25000:1500,
    startupMs:state.voiceEngine==='local'?90000:12000,
    onState:info=>{
      state.recognition=info.recognition;state.recording=info.desired;
      const labels={idle:'文字输入 / 短按 RT 持续说话',starting:state.voiceEngine==='local'?'正在准备本地中文模型 · 就绪后打开麦克风…':'正在启动麦克风…',connecting:'识别服务已连接 · 等待麦克风就绪',listening:'持续收音中 · 再按 RT 结束',speech:info.interim?'正在识别 · 临时文字会继续修正':info.transcript?'已确认文字 · 可以继续说话':'检测到说话 · 正在转写',waiting:'等待你继续说话 · 无需按住 RT',restarting:'正在续接识别 · 本段文字已保留',stopping:'正在完成最后转写…',ready:info.reason==='limit'?'已达 3 分钟 · 草稿已保留':info.reason==='edited'?'手动修改已保留 · 请预览后发送':'转写完成 · 请检查文字后发送',empty:info.captureStarted?'本段尚无识别文字 · 请检查麦克风输入':'尚未进入收音 · 请查看结束原因',error:'语音已停止 · 请查看当前语音提示'};
      const visible=info.phase!=='idle';
      $('voicePanel').classList.toggle('hidden',!visible);$('voicePanel').dataset.phase=info.phase;
      $('voicePanel').dataset.capturing=String(info.audioActive);
      const noSignal=info.desired&&info.input?.samples>=80000&&info.input.maxPeak===0;
      const label=noSignal?'麦克风已打开，但输入无信号 · 请检查或切换麦克风':labels[info.phase]||info.phase;
      $('voicePhase').textContent=label.replaceAll('RT',voiceControlLabel());
      const reasons={toggle:'再次按键结束',manual:'手动结束',release:'结束操作',blur:'页面失去焦点',inactive:'手柄输入转入后台',disconnect:'手柄已断开',hidden:'页面已隐藏',edited:'手动编辑文字',settings:'修改手柄设置',diagnostics:'打开语音诊断',limit:'达到 3 分钟上限','device-error':'手柄读取异常','controller-error':`手柄交互异常：${state.padError||'未知错误'}`};
      $('voiceCapture').textContent=`${state.voiceEngine==='local'?'Fun-ASR-Nano 本地模型 · ':''}${info.audioActive?'麦克风已打开':info.captureStarted?'麦克风当前已暂停':'麦克风尚未开始采音'} · ${info.reason?'结束原因：'+(reasons[info.reason]||info.reason):'本段转写会持续累积，不会自动发送'}`;
      if(info.input){const rms=info.desired?info.input.rms:info.input.maxRms;$('voiceCapture').textContent+=` · 输入：${info.input.device} · ${info.desired?'当前':'本段最大'}电平：${rms>0?Math.round(20*Math.log10(rms))+' dBFS':'无信号'}`;}
      const seconds=Math.floor(info.elapsedMs/1000);$('voiceElapsed').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} / 03:00`;
      $('voiceStop').disabled=!info.desired;renderVoice(label);
    },
    onText:text=>{
      if(state.voiceThread!==state.selected)return;
      if($('prompt').value!==state.voiceWritten){stopVoice('edited');return;}
      const value=state.voiceBase+(state.voiceBase&&text?'\n':'')+text;
      $('prompt').value=value;state.voiceWritten=value;
      if(state.selected)state.drafts.set(state.selected,value);
      if(text)clearError('voice');
    },
    onError:issue=>error(`${issue.message.replaceAll('RT',voiceControlLabel())} [${issue.code}]`,{source:'voice'}),
  });
  return state.voiceController;
}
function startVoice(source='button'){
  if(state.recording||$('modal').open||padControls.isOpen()||pilot.isWheelOpen())return;
  if(state.voiceEngine==='local'&&state.voiceController?.phase==='stopping'){renderVoice('正在完成本地尾句转写，请稍候…');return;}
  pilot.closeKeyboard(false);
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(state.voiceEngine==='local'?!navigator.mediaDevices?.getUserMedia||!window.AudioContext||!window.AudioWorkletNode:!SR){error(state.voiceEngine==='local'?'当前浏览器未提供麦克风或 WebAudio 收音接口。[local-unsupported]':'当前浏览器没有提供语音转写接口。请打开语音诊断查看可用能力。',{source:'voice'});return;}
  if(!state.voiceConsent){
    modal('启用持续语音');$('modalBody').append(node('p',state.voiceEngine==='local'?'本地离线语音：浏览器请求麦克风授权并采音，音频仅通过本机地址送到 Fun-ASR-Nano 中文模型；不发送给浏览器厂商，不保存原始录音，不需要 API key。文字只进入草稿，请检查后发送。':'语音转写由浏览器提供，音频可能发送给浏览器厂商的语音服务。文字只进入草稿。'),node('p',`语音尚未启用。请点击「同意并启用」，或松开 ${voiceControlLabel()} 后按 ${padControls.key('confirm')} 确认。启用后短按 ${voiceControlLabel()} 或点击麦克风开始持续收音，再按一次结束。每段最长 3 分钟；离开页面会停止。`));
    modalButton('暂不启用',()=> $('modal').close());modalButton('同意并启用',()=>{state.voiceConsent=true;$('modal').close();mutePad();renderVoice('语音已启用 · 短按 RT 开始，再按结束');},true).focus();return;
  }
  cancelVoice();clearError('voice');state.voiceSource=source;
  state.voiceBase=$('prompt').value;state.voiceWritten=state.voiceBase;state.voiceThread=state.selected;
  getVoice().start();
}
function cancelVoice(){state.voiceSession++;state.voiceController?.cancel();state.recognition=null;state.recording=false;renderVoice('文字输入 / 短按 RT 持续说话');}
function stopVoice(reason='release'){state.voiceController?.stop(typeof reason==='string'?reason:'release');}
function toggleVoice(source='button'){if(state.recording)stopVoice('toggle');else startVoice(source);}
async function voiceDiagnostics(){
  stopVoice('diagnostics');modal('语音诊断');
  const version=state.modalVersion;
  const local=state.voiceEngine==='local',supported=local?!!(navigator.mediaDevices?.getUserMedia&&window.AudioContext&&window.AudioWorkletNode):!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  let capability;try{if(local)capability=await api('/api/voice/status');}catch(e){capability={available:false,message:e.message};}
  let permission='浏览器未公开权限状态';
  try{if(navigator.permissions)permission=({granted:'已允许',denied:'已拒绝',prompt:'首次使用时询问'})[(await navigator.permissions.query({name:'microphone'})).state]||permission;}catch{}
    let devices=[];try{devices=await navigator.mediaDevices?.enumerateDevices?.()||[];}catch{}
    if(!$('modal').open||version!==state.modalVersion)return;
  const voice=state.voiceController;
  $('modalBody').append(node('p',local?`识别通道：Fun-ASR-Nano 本地模型 · ${capability?.available?(capability.ready?'模型已就绪':'模型已安装 · 正在按需准备')+'（'+capability.culture+(capability.device?' · '+capability.device:'')+'）':capability?.message||'引擎尚未就绪'}`:`语音接口：${supported?'可用':'未提供'}`),node('p',`麦克风权限：${permission}`),node('p',`最近一段：${voice?.captureStarted?'已收到浏览器采音或转写事件':'尚未收到浏览器采音或转写事件'}；状态 ${voice?.phase||'idle'}；结束原因 ${voice?.reason||'尚无'}。接口可用、权限允许均不等于麦克风已开始采音。`),node('p',`短按 ${voiceControlLabel()} 或点击麦克风开始持续语音，再按一次结束，最长 3 分钟。静音停顿后会续接正常识别会话，已转写文字会保留；本地模型首次准备最多等待 90 秒；准备期间不打开麦克风，热启动无需重复加载。`),node('p',local?'此通道不依赖浏览器在线识别服务。语音活动检测会自动分句；临时文字由神经网络持续修正，停顿不结束整段收音。结束后最多等待 25 秒完成尾句。模型保留在内存中以加快下一次启动；仍请校对识别结果。':supported?'如果持续没有文字，请检查系统默认麦克风、输入音量与浏览器语音服务的网络连接。':'请在提供 SpeechRecognition 接口的浏览器中打开本机控制台地址。','modal-note'));
    if(local){
      const label=node('label','录音麦克风'),select=node('select');select.setAttribute('aria-label','录音麦克风');
      const inputs=devices.filter(d=>d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default');
      const choices=[{deviceId:'',label:'跟随系统默认麦克风'},...inputs];
      if(state.voiceDeviceId&&!choices.some(d=>d.deviceId===state.voiceDeviceId))choices.push({deviceId:state.voiceDeviceId,label:'之前选择的麦克风（当前未连接）'});
      for(const [i,device]of choices.entries()){const option=node('option',device.label||`麦克风 ${i}`);option.value=device.deviceId;select.append(option);}
      select.value=state.voiceDeviceId||'';select.onchange=()=>{state.voiceDeviceId=select.value;};label.append(select);$('modalBody').append(label,node('p','若收音中始终无文字，请观察实际输入电平；完全无信号时先检查静音开关，或选择正确麦克风。更换后关闭窗口，再短按 RT 测试。','modal-note'));
      const capture=capability?.capture;
      if(capture)$('modalBody').append(node('p',`本机${capture.active?'当前':'最近一段'}：收到 ${capture.bytes} 字节 PCM，最大电平 ${capture.maxRms>0?Math.round(20*Math.log10(capture.maxRms))+' dBFS':'无信号'}；检测讲话 ${capture.speechStarts} 次，临时文字 ${capture.hypotheses} 次，最终文字 ${capture.results} 次。此处不保存原始录音。`));
    }
    modalButton('知道了',()=> $('modal').close(),true);
}
function rtPressed(button,now){
  const value=Number.isFinite(button?.value)?button.value:0;
  const previous=state.padButtons[padControls.config.bindings.voice];
  // Compare the same integer percentage shown in the UI, including float-rounded boundaries.
  const held=Math.round(value*100)>=Math.round((previous ? .1 : padControls.config.triggerThreshold)*100)||!!button?.pressed&&!Number.isFinite(button?.value);
  if(held){state.rtReleaseAt=null;return true;}
  if(!previous)return false;
  if(state.rtReleaseAt===null)state.rtReleaseAt=now;
  return now-state.rtReleaseAt<140;
}
function setPadVoiceStatus(text){if($('padVoiceStatus').textContent!==text)$('padVoiceStatus').textContent=text;}
function padVoiceInput(pad,pressed,focused){
  const index=padControls.config.bindings.voice,held=index!=null&&pressed[index];
  const blocked=padControls.isOpen()||$('modal').open||pilot.isWheelOpen();
  const enabled=focused&&pad.mapping==='standard'&&!blocked&&index!=null;
  if(!enabled)state.padVoiceArmed=false;
  // Voice only needs its own release edge; stick drift must not lock the voice toggle.
  const start=enabled&&state.padVoiceArmed&&held&&!state.padButtons[index];
  if(enabled&&!held)state.padVoiceArmed=true;
  const button=pad.buttons[index],value=Number.isFinite(button?.value)?button.value:button?.pressed?1:0;
  const input=`${voiceControlLabel()} ${Math.round(value*100)}%`;
  setPadVoiceStatus(index==null?'手柄语音未分配 · 可使用屏幕上的说话按钮':
    pad.mapping!=='standard'?'请在手柄工作台检查非标准映射':
    !focused?'点击网页恢复手柄语音':blocked?$('modal').open&&$('modalTitle').textContent==='启用持续语音'?'请在窗口中确认启用语音，再松开重按语音键':'请关闭当前窗口后，再短按语音键':
    !state.padVoiceArmed?`${input} · 请先松开 ${voiceControlLabel()} 再短按`:
    state.recording?`${input} · 再按一次结束收音`:`${input} · 短按至 ${Math.round(padControls.config.triggerThreshold*100)}% 开始持续语音`);
  return start;
}
function event(message){
  const {method,params:p={}}=message;
  if(method==='bridge/status'){clearError('transport');setConnected(p.connected,p.error);if(p.pendingRequests){state.pending=p.pendingRequests;renderControls();}if(Object.hasOwn(p,'account'))renderAccount(p.account);return;}
  if(method==='server/request'){if(!state.pending.some(r=>r.id===p.id))state.pending.push(p);renderControls();return;}
  if(method==='account/login/completed'){if(p.success){action(async()=>{renderAccount(await rpc('account/read'));if($('modal').open)$('modal').close();await loadThreads();},{global:true})();}else error(p.error||'登录未完成');return;}
  if(method==='account/updated'){action(async()=>renderAccount(await rpc('account/read')),{global:true})();return;}
  if(['serverRequest/resolved','server/request/resolved','bridge/requestResolved'].includes(method)){state.pending=state.pending.filter(r=>r.id!==(p.requestId??p.id));renderControls();return;}
  if(method==='thread/started'){if(p.thread&&!state.threads.some(t=>t.id===p.thread.id)){state.threads.unshift(p.thread);renderThreads();}return;}
  if(method==='turn/started'){
    state.active.set(p.threadId,p.turn.id);state.turnIds.set(p.threadId,p.turn.id);renderThreads();renderControls();
    if(p.threadId===state.selected){clearError('turn');activity.turn(p.turn.id,{status:'inProgress'});}
  }
  if(method==='turn/completed'){
    if(state.active.get(p.threadId)===p.turn.id)state.active.delete(p.threadId);
    renderThreads();renderControls();
    if(p.threadId===state.selected){activity.turn(p.turn.id,{...p.turn,status:p.turn.status||'completed'});if(state.turnIds.get(p.threadId)===p.turn.id){if(p.turn.error)error(p.turn.error.message,{source:'turn'});else clearError('turn');}}
  }
  if(p.threadId!==state.selected)return;
  state.eventVersion++;
  const currentTurn=state.turnIds.get(p.threadId);
  if(p.turnId&&currentTurn&&p.turnId!==currentTurn)return;
  const timeline=$('timeline'),nearBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<120;
  if(state.active.get(p.threadId)===(p.turnId||currentTurn)&&['item/started','item/agentMessage/delta','item/commandExecution/outputDelta','item/reasoning/summaryTextDelta'].includes(method))activity.turn(p.turnId||currentTurn,{status:'inProgress',error:null});
  if(method==='item/started'||method==='item/completed')activity.upsert(p.item,{turnId:p.turnId||currentTurn,phase:method==='item/completed'?'completed':'inProgress'});
  const deltaTypes={'item/agentMessage/delta':'agentMessage','item/commandExecution/outputDelta':'commandExecution','item/reasoning/summaryTextDelta':'reasoning'};
  if(deltaTypes[method])activity.delta({...p,turnId:p.turnId||currentTurn},deltaTypes[method]);
  if(method==='turn/plan/updated')activity.plan(p);
  if(method==='error'){
    if(p.willRetry){activity.turn(p.turnId,{status:'retrying',error:{message:`服务正在重试：${p.error?.message||'连接暂时中断'}`}});}
    else error(p.error?.message||'Codex 返回错误',{source:'turn'});
  }
  if(nearBottom)scrollBottom();
}
$('newThread').onclick=newThreadDialog;$('refresh').onclick=action(()=>loadThreads());$('loadMore').onclick=action(()=>loadThreads(true));$('send').onclick=action(send);$('interrupt').onclick=action(interrupt);$('login').onclick=action(login);$('approvals').onclick=showApprovals;$('help').onclick=help;$('closeModal').onclick=()=> $('modal').close();$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();action(send)();}});$('prompt').addEventListener('input',()=>{state.lastIntent=null;renderIntentUndo();if(state.recording)stopVoice('edited');if(state.selected)state.drafts.set(state.selected,$('prompt').value);});$('voice').onclick=()=>toggleVoice();window.addEventListener('blur',()=>{pilot.suspendDesktop();pilot.cancelWheel();pilot.reset();state.padFocused=false;mutePad();if(!['starting','connecting'].includes(state.voiceController?.phase))stopVoice('blur');});document.addEventListener('visibilitychange',()=>{if(document.hidden){mutePad();pilot.suspendDesktop();pilot.cancelWheel();pilot.reset();stopVoice('hidden');}});
$('voiceInfo').onclick=action(voiceDiagnostics);$('voiceStop').onclick=()=>stopVoice('manual');$('dismissError').onclick=()=>{state.issues.delete(state.visibleIssue);renderFeedback();};
function focusMove(direction,force=false){
  const focused=document.activeElement;
  if(!force&&focused?.tagName==='SELECT'){focused.selectedIndex=Math.max(0,Math.min(focused.options.length-1,focused.selectedIndex+direction));focused.dispatchEvent(new Event('change',{bubbles:true}));return;}
  if(!force&&focused?.tagName==='INPUT'&&focused.type==='range'){focused.stepUp(direction);focused.dispatchEvent(new Event('input',{bubbles:true}));return;}
  const root=padControls.isOpen()?$('controllerPanel'):$('modal').open?$('modal'):document;
  const items=[...root.querySelectorAll('button:not(:disabled),textarea,input,select,a[href]')].filter(e=>e.getClientRects().length);
  const index=items.indexOf(document.activeElement);items[(index+direction+items.length)%items.length]?.focus();
}
function threadMove(direction){if($('modal').open||padControls.isOpen()||pilot.isKeyboardOpen()||!state.threads.length)return;const i=state.threads.findIndex(t=>t.id===state.selected);action(()=>selectThread(state.threads[(i+direction+state.threads.length)%state.threads.length].id))();}
function setPadStatus(text){const el=$('padStatus');if(el.textContent!==text)el.textContent=text;}
function confirmFocused(){
  const root=activeInputRoot(),el=pilot.pointerMode?pilot.pointerHit(root):document.activeElement;
  if(pilot.activate(el,root))return;
  if(root===document&&!pilot.pointerMode){pilot.focus($('prompt'));pilotNotice('先选择对象，再确认 · 草稿不会自动发送');}
  else pilotNotice('请先选中一个可操作对象');
}
function activeInputRoot(){return pilot.isKeyboardOpen()?$('desktopKeyboard'):padControls.isOpen()?$('controllerPanel'):$('modal').open?$('modal'):document;}
function toggleKeyboard(){
  if(pilot.closeKeyboard())return;
  if(padControls.isOpen()||pilot.isWheelOpen())return;
  stopVoice('edited');const root=activeInputRoot();
  const usable=element=>pilot.editable(element)&&element.getClientRects().length&&(root===document||root.contains(element));
  const target=[document.activeElement,pilot.lastEditor,root===document?$('prompt'):null].find(usable)||[...root.querySelectorAll('textarea,input')].find(usable);
  pilot.openKeyboard(target);
}
function togglePointer(){if(pilot.isWheelOpen()||padControls.isOpen())return;pilot.setPointer(!pilot.pointerMode,activeInputRoot());if(!pilot.pointerMode)pilotNotice('空间焦点导航 · 摇杆选中，确认激活');}
function currentReading(){
  const items=[...$('timeline').querySelectorAll('.message')];if(!items.length)return null;
  const box=$('timeline').getBoundingClientRect(),center=(box.top+box.bottom)/2;
  if(state.lastReading&&items.includes(state.lastReading)){const r=state.lastReading.getBoundingClientRect();if(r.bottom>box.top&&r.top<box.bottom)return state.lastReading;}
  const visible=items.filter(item=>{const r=item.getBoundingClientRect();return r.bottom>box.top&&r.top<box.bottom;});
  const candidates=visible.length?visible:items;
  return candidates.reduce((best,item)=>Math.abs(item.getBoundingClientRect().top-center)<Math.abs(best.getBoundingClientRect().top-center)?item:best,candidates[0]);
}
function jumpReading(direction){
  const items=[...$('timeline').querySelectorAll('.message')],current=currentReading();if(!current){pilotNotice('当前还没有可阅读的任务记录');return;}
  const index=items.indexOf(current),next=items[Math.max(0,Math.min(items.length-1,index+direction))];state.lastReading=next;
  const target=next.querySelector('summary')||next;if(target===next)target.tabIndex=-1;pilot.focus(target);
  pilotNotice('逐段阅读 · 左右方向键收展详情');
}
function readingDetail(open){
  const item=currentReading();if(!item)return;
  const detail=item.tagName==='DETAILS'?item:item.querySelector('details');
  if(detail){detail.open=open;state.lastReading=item;pilot.focus(detail.querySelector('summary')||detail);pilotNotice(open?'已展开当前记录':'已收起当前记录');}
  else pilotNotice('当前是正文段落，无折叠详情');
}
function scrollElement(element,key,delta){
  const maximum=key==='scrollTop'?element.scrollHeight-element.clientHeight:element.scrollWidth-element.clientWidth;
  if(!(maximum>0))return 0;const before=element[key];element[key]=Math.max(0,Math.min(maximum,before+delta));return element[key]-before;
}
function readMotion(dx,dy){
  const root=pilot.isKeyboardOpen()?$('desktopKeyboard'):padControls.isOpen()?$('padPanelContent'):$('modal').open?$('modal'):$('timeline');
  const reading=root===$('timeline')?currentReading():null;
  const inner=reading?.open?reading.querySelector('.message-body'):null;
  const consumed=inner?scrollElement(inner,'scrollTop',dy):0;scrollElement(root,'scrollTop',dy-consumed);
  if(dx){
    const box=root.getBoundingClientRect();
    const targets=[...(reading||root).querySelectorAll('pre,.table-scroll,.message-body')].filter(e=>{const r=e.getBoundingClientRect();return e.getClientRects().length&&e.scrollWidth>e.clientWidth&&r.bottom>box.top&&r.top<box.bottom;});
    if(targets[0])scrollElement(targets[0],'scrollLeft',dx);
  }
}
function gamepad(){
  try{
    const pads=[...(navigator.getGamepads?.()||[])].filter(pad=>pad&&pad.connected!==false);
    const pad=pads.find(pad=>pad.index===state.padIndex)||pads[0];padControls.update(pad);pilot.dock(pad?.axes);
    if(!pad){
      if(state.padIndex!==null&&state.voiceSource==='gamepad')stopVoice('disconnect');if(pilot.source==='gamepad')pilot.cancelWheel();if(state.padIndex!==null)pilot.suspendDesktop();pilot.reset();
      state.rtReleaseAt=null;state.padIndex=null;state.padDeviceId=null;state.padButtons=[];mutePad();state.padFrameAt=null;
      setPadVoiceStatus('未检测到手柄 · 可点击麦克风持续说话');
      setPadStatus('◎ 手柄工作台');return;
    }
    setPadStatus(pad.mapping==='standard'?'◉ 手柄已连接':'◎ 检查手柄映射');
    const now=performance.now(),seconds=Math.min(Math.max((now-(state.padFrameAt??now))/1000,0),.05);state.padFrameAt=now;
    const changed=state.padIndex!==pad.index||state.padDeviceId!==pad.id;
    if(changed){if(state.voiceSource==='gamepad')stopVoice('disconnect');if(pilot.source==='gamepad')pilot.cancelWheel();if(state.padIndex!==null)pilot.suspendDesktop();pilot.reset();mutePad();state.padButtons=[];state.rtReleaseAt=null;}
    state.padIndex=pad.index;state.padDeviceId=pad.id;
    const raw=pad.buttons.map(button=>!!button.pressed||button.value>.5),pressed=[...raw],bindings=padControls.config.bindings;
    if(bindings.voice!=null)pressed[bindings.voice]=rtPressed(pad.buttons[bindings.voice],now);
    const neutral=!raw.some(Boolean)&&pad.axes.every(value=>Math.abs(value)<=padControls.config.deadzone);
    const focused=!document.hidden&&(document.hasFocus?.()??state.padFocused!==false);
    if(!focused||pad.mapping!=='standard'){
      mutePad();if(pilot.source==='gamepad')pilot.cancelWheel();if(pilot.pointerMode)pilot.setPointer(false);pilot.reset();if(state.voiceSource==='gamepad'&&!['starting','connecting'].includes(state.voiceController?.phase))stopVoice('inactive');
    }
    const voiceStart=padVoiceInput(pad,pressed,focused);
    if(state.padMuted){if(voiceStart)toggleVoice('gamepad');if(neutral&&focused&&pad.mapping==='standard')state.padMuted=false;state.padButtons=pressed;return;}
    const edge=key=>bindings[key]!=null&&pressed[bindings[key]]&&!state.padButtons[bindings[key]];
    if(edge('back')){pilotBack();pilot.reset();state.padButtons=pressed;return;}
    if(pilot.isWheelOpen()){
      pilot.wheelVector(pad.axes[0],pad.axes[1]);
      if(edge('confirm')||pilot.source==='gamepad'&&bindings.intent!=null&&!pressed[bindings.intent])pilot.releaseWheel();
      state.padButtons=pressed;return;
    }
    if(edge('workbench')&&!$('modal').open){if(padControls.isOpen())padControls.close();else padControls.open();state.padButtons=pressed;return;}
    if(edge('intent')&&!padControls.isOpen()&&!$('modal').open){pilot.openWheel('gamepad');pilot.wheelVector(pad.axes[0],pad.axes[1]);state.padButtons=pressed;return;}
    if(!padControls.isOpen()){
      if(edge('keyboard')){toggleKeyboard();state.padButtons=pressed;return;}
      if(edge('pointer')){togglePointer();state.padButtons=pressed;return;}
    }
    if(edge('confirm'))confirmFocused();
    if(state.padMuted){state.padButtons=pressed;return;}
    if(!padControls.isOpen()){
      if(edge('interrupt')&&!$('modal').open)action(interrupt)();if(edge('approvals'))showApprovals();
      if(edge('previous'))threadMove(-1);if(edge('next'))threadMove(1);if(voiceStart)toggleVoice('gamepad');
      if(edge('newThread')&&!$('modal').open)newThreadDialog();
      if(!$('modal').open&&!pilot.isKeyboardOpen()){if(edge('overview'))taskOverview();else if(edge('focus'))toggleFocusMode();else if(edge('anchor'))readingAnchor();}
    }
    if(pilot.pointerMode)pilot.movePointer(pad.axes[0],pad.axes[1],seconds,padControls.config.deadzone,activeInputRoot());
    else{const vector=pilot.navigation(pad.axes[0],pad.axes[1],now,padControls.config.deadzone);if(vector)pilot.navigate(activeInputRoot(),vector);}
    if(now-state.lastNav>180){
      if(pilot.isKeyboardOpen()){if(pressed[12]||pressed[13]||pressed[14]||pressed[15]){pilot.navigate(activeInputRoot(),pressed[12]?[0,-1]:pressed[13]?[0,1]:pressed[14]?[-1,0]:[1,0]);state.lastNav=now;}}
      else if(padControls.isOpen()||$('modal').open||['INPUT','SELECT'].includes(document.activeElement?.tagName)){if(pressed[12]||pressed[14]){focusMove(-1);state.lastNav=now;}else if(pressed[13]||pressed[15]){focusMove(1);state.lastNav=now;}}
      else if(pressed[12]||pressed[13]||pressed[14]||pressed[15]){if(pressed[12])jumpReading(-1);else if(pressed[13])jumpReading(1);else readingDetail(pressed[15]);state.lastNav=now;}
    }
    const [dx,dy]=pilot.motion(pad.axes[2],pad.axes[3],seconds,padControls.config.deadzone,padControls.config.scrollSpeed);
    if(Math.abs(dx)+Math.abs(dy)>.001)readMotion(dx,dy);
    state.padButtons=pressed;
  }catch(e){
    state.padError=`${e?.name||'Error'}: ${e?.message||String(e)}`.slice(0,200);
    if(state.voiceSource==='gamepad')stopVoice('controller-error');pilot.cancelWheel();pilot.suspendDesktop();pilot.reset();mutePad();setPadStatus('◎ 手柄交互异常');setPadVoiceStatus(`手柄交互异常 · ${state.padError}`);console.warn('Gamepad interaction error',e);
  }finally{requestAnimationFrame(gamepad);}
}
$('intentLauncher').onclick=()=>{if(!$('modal').open&&!padControls.isOpen())pilot.openWheel();};
$('overviewLauncher').onclick=taskOverview;$('focusToggle').onclick=toggleFocusMode;
$('anchorToggle').onclick=()=>readingAnchor();$('anchorClear').onclick=()=>readingAnchor(true);
$('intentUndo').onclick=undoIntent;
$('keyboardToggle').onclick=toggleKeyboard;$('pointerToggle').onclick=togglePointer;
$('modal').addEventListener('close',()=>pilot.suspendDesktop());
document.addEventListener('keydown',e=>{if(e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.repeat&&['k','m'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='k')toggleKeyboard();else togglePointer();}});
document.addEventListener('pointerdown',()=>pilot.focused?.classList.remove('pilot-target'));
$('padStatus').onclick=()=>padControls.open();
window.addEventListener('focus',()=>{state.padFocused=true;});
syncPadHints();
async function boot(){try{await status();}catch(e){setConnected(false);error('无法连接本地桥接服务。请确认服务正在运行，再点击帮助中的重新连接。');}const stream=new EventSource('/api/events');stream.onmessage=e=>{try{event(JSON.parse(e.data));}catch(err){console.warn('Notification error',err);}};stream.onerror=()=>setConnected(false,'实时连接中断，正在等待重连。请勿重复发送同一指令。','transport');stream.onopen=()=>{action(async()=>{const fresh=await status();if(fresh.connected){clearError('transport');const id=state.selected;const version=state.selectionVersion;const revision=state.eventVersion;if(id){const result=await rpc('thread/read',{threadId:id,includeTurns:true});if(state.selected===id&&state.selectionVersion===version&&state.eventVersion===revision)renderHistory(result.thread);}}})()};gamepad();}
boot();
