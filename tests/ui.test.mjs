import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.value='';this.isConnected=true;this.type='';this.maxLength=-1;this.dataset={};this.attributes={};this.style={setProperty(name,value){this[name]=value}};this.className='';this._text='';this._html='';this.listeners={};this.scrollHeight=0;this.scrollTop=0;this.clientHeight=0;this.classList={add:(...t)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...t])].join(' ')},remove:(...t)=>{this.className=this.className.split(/\s+/).filter(x=>!t.includes(x)).join(' ')},contains:t=>this.className.split(/\s+/).includes(t),toggle:(t,force)=>{const on=force??!this.classList.contains(t);on?this.classList.add(t):this.classList.remove(t);return on}};}
  get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent).join('')}
  get value(){return this._value}set value(value){this._value=value;if(['TEXTAREA','INPUT'].includes(this.tagName))this.selectionStart=this.selectionEnd=String(value).length;}
  set textContent(value){this._text=String(value??'');this.children=[];}
  get innerHTML(){return this._html}set innerHTML(value){this._html=value;this.children=[];this._text='';}
  get firstChild(){return this.children[0]}get lastChild(){return this.children.at(-1)}
  append(...children){for(const child of children){if(typeof child==='object'){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(c=>c!==child);child.parentElement=this;}this.children.push(child)}}replaceChildren(...children){this._text='';for(const child of this.children)if(typeof child==='object')child.parentElement=null;this.children=[];this.append(...children)}
  setAttribute(name,value){this.attributes[name]=String(value)}getAttribute(name){return this.attributes[name]??null}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
  getBoundingClientRect(){return this.rect||{left:0,top:0,right:100,bottom:40,width:100,height:40}}
  matches(selector){return selector.split(',').some(s=>{s=s.trim();if(s==='dialog[open]')return this.tagName==='DIALOG'&&this.open;if(s.startsWith('.'))return this.classList.contains(s.slice(1));if(s==='[tabindex="0"]')return this.tabIndex===0;if(s==='a[href]')return this.tagName==='A'&&!!this.href;return this.tagName===s.split(':')[0].toUpperCase()&&(!s.includes(':not(:disabled)')||!this.disabled)})}
  contains(element){return element===this||this.children.some(c=>typeof c==='object'&&c.contains(element))}
  closest(selector){for(let e=this;e;e=e.parentElement)if(e.matches(selector))return e;return null}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}querySelectorAll(selector){return this.children.filter(c=>typeof c==='object').flatMap(c=>[...(c.matches(selector)?[c]:[]),...c.querySelectorAll(selector)])}
  focus(){if(this.ownerDocument){this.ownerDocument.activeElement=this;this.ownerDocument.dispatchEvent({type:'focusin',target:this})}}showModal(){this.open=true}close(){this.open=false;for(const listener of this.listeners.close||[])listener()}
  click(){if(!this.disabled)this.onclick?.()}dispatchEvent(e){e.target=this;for(const fn of this.listeners[e.type]||[])fn(e);this['on'+e.type]?.(e);if(e.bubbles)this.ownerDocument?.dispatchEvent(e);return true}
  setSelectionRange(start,end){this.selectionStart=Math.min(start,this.value.length);this.selectionEnd=Math.min(end,this.value.length)}setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.setSelectionRange(start+text.length,start+text.length)}
  setPointerCapture(){}getClientRects(){for(let e=this;e;e=e.parentElement)if(e.classList.contains('hidden')||e.tagName==='DIALOG'&&!e.open)return[];return[1]}
}
async function harness({storage}={}){
  const elements=new Map(),timers=new Map(),windowListeners={},documentListeners={};let time=0,nextTimer=0;
  const schedule=(fn,delay=0)=>{const id=++nextTimer;timers.set(id,{fn,at:time+delay});return id};
  const document={getElementById(id){if(!elements.has(id)){const e=new Element(id==='prompt'?'textarea':['modal','controllerPanel','intentDialog'].includes(id)?'dialog':id==='padBinding'?'select':['send','padDone','padClose','keyboardToggle','pointerToggle','keyboardClose','closeModal'].includes(id)?'button':'div');e.id=id;e.ownerDocument=document;if(id==='send')e.append(new Element('span'),new Element('kbd'));elements.set(id,e)}return elements.get(id)},createElement(tag){const e=new Element(tag);e.ownerDocument=document;return e},addEventListener(name,fn){(documentListeners[name]??=[]).push(fn)},dispatchEvent(e){for(const fn of documentListeners[e.type]||[])fn(e)},querySelectorAll(){return[]},elementFromPoint(){return null}};
  document.body=new Element('body');document.body.ownerDocument=document;
  for(const id of ['prompt','send','desktopKeyboard','modal','controllerPanel','intentDialog','pilotCursor'])document.body.append(document.getElementById(id));
  for(const id of ['modalBody','modalActions','modalTitle','closeModal'])document.getElementById('modal').append(document.getElementById(id));
  for(const id of ['padDone','padClose','padBinding'])document.getElementById('controllerPanel').append(document.getElementById(id));
  for(const id of ['keyboardClose','keyboardKeys','keyboardTools'])document.getElementById('desktopKeyboard').append(document.getElementById(id));
  const calls=[];let response={};
  const context=vm.createContext({document,window:{innerWidth:1280,innerHeight:720,localStorage:storage,addEventListener(name,fn){(windowListeners[name]??=[]).push(fn)}},navigator:{},Event:class{constructor(type,options){this.type=type;Object.assign(this,options)}preventDefault(){this.defaultPrevented=true}},console,URL,Map,performance:{now:()=>time},setTimeout:schedule,clearTimeout:id=>timers.delete(id),requestAnimationFrame(){},EventSource:class{},fetch:async(path,options)=>{const body=JSON.parse(options?.body||'{}');calls.push({path,...body});return{ok:true,json:async()=>typeof response==='function'?response(body):response}}});
  // Native Window timers reject object-method receivers; permissive JS timers hid a real startup crash.
  vm.runInContext(`(()=>{const schedule=setTimeout,cancel=clearTimeout;
    const check=receiver=>{if(receiver!==undefined&&receiver!==globalThis&&receiver!==window)throw new TypeError('Illegal invocation')};
    globalThis.setTimeout=function(fn,delay){check(this);return schedule(fn,delay)};
    globalThis.clearTimeout=function(id){check(this);return cancel(id)};
  })()`,context);
  let source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');source=source.replace(/boot\(\);\s*$/,'');vm.runInContext(source,context);
  vm.runInContext("state.voiceEngine='browser'",context); // Existing fixtures exercise the browser adapter; offline capture has its own native-boundary tests.
  return{context,document,calls,run:script=>vm.runInContext(script,context),respond:r=>response=r,documentEvent:e=>document.dispatchEvent(e),windowEvent:name=>{for(const fn of windowListeners[name]||[])fn()},tick(ms){const target=time+ms;for(let count=0;count<10000;count++){const pending=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!pending)break;time=pending[1].at;timers.delete(pending[0]);pending[1].fn()}time=target},timers};
}

test('UI sends start then steer and interrupt using real protocol fixtures',async()=>{const h=await harness();h.run("state.connected=true;state.selected='thread-1';state.resumed.add('thread-1');$('prompt').value='做测试';");h.respond({turn:{id:'turn-1'}});await h.run('send()');assert.equal(h.calls[0].method,'turn/start');assert.equal(h.calls[0].params.input[0].type,'text');h.run("$('prompt').value='加上边界情况'");h.respond({});await h.run('send()');assert.equal(h.calls[1].method,'turn/steer');assert.equal(h.calls[1].params.expectedTurnId,'turn-1');await h.run('interrupt()');assert.equal(h.calls[2].method,'turn/interrupt');h.run("event({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1'}}})");assert.equal(h.run("state.active.has('thread-1')"),false);});
test('UI user input answers are scoped to request and connection',async()=>{const h=await harness();h.run("approvalDetail({id:8,connectionId:'conn-1',method:'item/tool/requestUserInput',params:{questions:[{id:'q1',question:'选一个',isOther:true,options:[]}]}})");const label=h.document.getElementById('modalBody').children.find(x=>x.tagName==='LABEL');label.children[0].value='选项一';await h.document.getElementById('modalActions').children[0].onclick();assert.equal(h.calls[0].id,8);assert.equal(h.calls[0].connectionId,'conn-1');assert.deepEqual(h.calls[0].result,{answers:{q1:{answers:['选项一']}}});});
test('UI rapid double-click cannot submit twice',async()=>{const h=await harness();let resolve;h.respond(()=>new Promise(r=>resolve=r));h.run("approvalDetail({id:5,connectionId:'c',method:'item/fileChange/requestApproval',params:{}})");const approve=h.document.getElementById('modalActions').children[2];const first=approve.onclick();await approve.onclick();assert.equal(h.calls.length,1);resolve({ok:true});await first;});
test('UI ignores speech after task switching and stops recording',async()=>{const h=await harness();h.run("window.SpeechRecognition=class {start(){} stop(){this.stopped=true}};state.voiceConsent=true;state.selected='old';$('prompt').value='';startVoice();globalThis.oldRecognition=state.recognition;");h.respond({thread:{id:'new',turns:[]}});await h.run("selectThread('new')");h.run("oldRecognition.onresult({results:[[{transcript:'stale words'}]]})");assert.equal(h.document.getElementById('prompt').value,'');assert.equal(h.run('state.recording'),false);});
test('UI connection loss invalidates active and resumed state',async()=>{const h=await harness();h.run("state.resumed.add('t');state.active.set('t','turn');state.pending=[{id:1}];event({method:'bridge/status',params:{connected:false,error:'offline'}})");assert.equal(h.run('state.resumed.size'),0);assert.equal(h.run('state.active.size'),0);assert.equal(h.run('state.pending.length'),0);assert.equal(h.document.getElementById('send').disabled,true);});
test('UI old voice end cannot cancel a newer recording session',async()=>{const h=await harness();h.run("window.SpeechRecognition=class {start(){} stop(){} abort(){}};state.voiceConsent=true;state.selected='t';startVoice();globalThis.firstVoice=state.recognition;stopVoice();startVoice();globalThis.secondVoice=state.recognition;firstVoice.onend();firstVoice.onresult({results:[[{transcript:'old'}]]});");assert.equal(h.run('state.recognition===secondVoice'),true);assert.equal(h.run('state.recording'),true);assert.equal(h.document.getElementById('prompt').value,'');});
test('UI resolved request uses official requestId field',async()=>{const h=await harness();h.run("state.pending=[{id:1},{id:2}];event({method:'serverRequest/resolved',params:{requestId:1}})");assert.equal(h.run('state.pending.length'),1);assert.equal(h.run('state.pending[0].id'),2);});
test('UI clears stale account details when status has no account',async()=>{
  const h=await harness();h.run("state.connected=true;renderAccount({account:{email:'test@example.test'}})");
  h.respond({connected:true,account:null,pendingRequests:[]});await h.run('status()');
  assert.equal(h.document.getElementById('account').textContent,'连接 ChatGPT 账号');
  assert.doesNotThrow(()=>h.run('renderAccount(null)'));
});
test('UI repeated voice release stops once and retains the final transcript',async()=>{
  const h=await harness();h.run("globalThis.stops=0;window.SpeechRecognition=class{start(){}stop(){stops++}abort(){}};state.voiceConsent=true;state.selected='t';startVoice();globalThis.voice=state.recognition;stopVoice();stopVoice();");
  assert.equal(h.run('stops'),1);assert.equal(h.run('state.recording'),false);
  h.run("voice.onresult({results:[[{transcript:'最后的文字'}]]});voice.onend()");
  assert.equal(h.document.getElementById('prompt').value,'最后的文字');
});
test('UI validation errors appear inside the open dialog',async()=>{
  const h=await harness();h.run('newThreadDialog()');
  await h.document.getElementById('modalActions').children[1].onclick();
  assert.match(h.document.getElementById('modalError').textContent,/绝对路径/);
  assert.equal(h.document.getElementById('error').textContent,'');
  h.document.getElementById('modal').close();h.run("error('离线')");
  assert.equal(h.document.getElementById('error').textContent,'离线');
});
test('UI ignores older thread list responses after a newer refresh',async()=>{
  const h=await harness(),pending=[];h.run('state.connected=true');h.respond(()=>new Promise(resolve=>pending.push(resolve)));
  const first=h.run('loadThreads()'),second=h.run('loadThreads()');
  await new Promise(setImmediate);
  pending[1]({data:[{id:'new',name:'新列表'}],nextCursor:null});await second;
  pending[0]({data:[{id:'old',name:'旧列表'}],nextCursor:'stale'});await first;
  assert.equal(h.run('state.threads[0].id'),'new');assert.equal(h.run('state.cursor'),null);
  assert.equal(h.document.getElementById('loadMore').disabled,false);
});
test('UI boot loads the thread list only once',async()=>{
  const h=await harness();h.respond(body=>body.method==='thread/list'?{data:[],nextCursor:null}:body.method==='account/read'?{account:null}:{connected:true,pendingRequests:[]});
  await h.run('boot()');await new Promise(setImmediate);
  assert.equal(h.calls.filter(call=>call.method==='thread/list').length,1);
  assert.equal(h.calls.filter(call=>call.method==='account/read').length,1);
});
test('UI does not show another thread error in the selected thread',async()=>{
  const h=await harness();h.run("state.selected='current';event({method:'turn/completed',params:{threadId:'other',turn:{error:{message:'另一个任务的错误'}}}})");
  assert.equal(h.document.getElementById('error').textContent,'');
});
test('UI tolerates a recorder that is already stopped',async()=>{
  const h=await harness();h.run("window.SpeechRecognition=class{start(){}stop(){throw new Error('InvalidStateError')}abort(){}};state.voiceConsent=true;startVoice();globalThis.oldVoice=state.recognition;");
  assert.doesNotThrow(()=>h.run('stopVoice();stopVoice()'));
  assert.equal(h.run('state.recording'),false);assert.equal(h.run('state.recognition'),null);
  h.run("oldVoice.onresult({results:[[{transcript:'过期文字'}]]})");
  assert.equal(h.document.getElementById('prompt').value,'');
});
test('UI discards an in-flight thread list after disconnect',async()=>{
  const h=await harness();let resolve;h.run('state.connected=true');h.respond(()=>new Promise(r=>resolve=r));
  const loading=h.run('loadThreads()');await new Promise(setImmediate);h.run("setConnected(false,'离线')");
  resolve({data:[{id:'stale'}],nextCursor:'stale'});await loading;
  assert.equal(h.run('state.threads.length'),0);assert.equal(h.run('state.loadingThreads'),false);
  assert.equal(h.document.getElementById('loadMore').disabled,true);
});
test('UI releases list loading state after a failed refresh',async()=>{
  const h=await harness();h.run('state.connected=true');h.respond(()=>{throw new Error('fixture offline')});
  await assert.rejects(h.run('loadThreads()'),/fixture offline/);
  assert.equal(h.run('state.loadingThreads'),false);assert.equal(h.document.getElementById('loadMore').disabled,false);
});
test('UI ignores a failed stale refresh after a newer result',async()=>{
  const h=await harness(),pending=[];h.run('state.connected=true');h.respond(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
  const first=h.run('loadThreads()'),second=h.run('loadThreads()');await new Promise(setImmediate);
  pending[1].resolve({data:[{id:'new'}],nextCursor:null});await second;
  pending[0].reject(new Error('stale failure'));await assert.doesNotReject(first);
  assert.equal(h.run('state.threads[0].id'),'new');
});
test('UI gamepad polling does not repeat unchanged DOM writes',async()=>{
  const h=await harness(),status=h.document.getElementById('padStatus');let writes=0,value='';
  Object.defineProperty(status,'textContent',{get(){return value},set(next){value=next;writes++}});
  h.run('gamepad();gamepad();gamepad()');assert.equal(writes,1);
});

test('voice corrects interim results and continues across service end',async()=>{
  const h=await harness();h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;state.selected='t';startVoice();globalThis.first=state.recognition;");
  h.run("first.onresult({results:[Object.assign([{transcript:'临时错字'}],{isFinal:false})]});first.onresult({results:[Object.assign([{transcript:'修正文字'}],{isFinal:true})]});first.onend()");
  assert.equal(h.document.getElementById('prompt').value,'修正文字');assert.equal(h.run('state.recording'),true);
  h.tick(250);h.run("state.recognition.onresult({results:[Object.assign([{transcript:'继续说话'}],{isFinal:true})]})");
  assert.equal(h.document.getElementById('prompt').value,'修正文字继续说话');assert.equal(h.calls.length,0);
});
test('voice release cancels a scheduled recognition restart',async()=>{
  const h=await harness();h.run("globalThis.starts=0;window.SpeechRecognition=class{start(){starts++}stop(){}abort(){}};state.voiceConsent=true;startVoice();state.recognition.onend();stopVoice()");
  h.tick(5000);assert.equal(h.run('starts'),1);assert.equal(h.run('state.recording'),false);assert.equal(h.timers.size,0);
});
test('permission prompt blur does not immediately stop a starting voice session',async()=>{
  const h=await harness();h.run("globalThis.stops=0;window.SpeechRecognition=class{start(){}stop(){stops++}abort(){}};state.voiceConsent=true;startVoice()");
  h.windowEvent('blur');assert.equal(h.run('stops'),0);
  h.run('state.recognition.onstart()');h.windowEvent('blur');assert.equal(h.run('stops'),0);
  h.run('state.recognition.onaudiostart()');h.windowEvent('blur');assert.equal(h.run('stops'),1);
});
test('no-speech is a waiting state, with bounded silence retries',async()=>{
  const h=await harness();h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;startVoice();state.recognition.onerror({error:'no-speech'});state.recognition.onend()");
  assert.equal(h.run('state.issues.size'),0);assert.equal(h.run('state.recording'),true);
  for(let i=0;i<20&&h.run('state.recording');i++){h.tick(1500);h.run('state.recognition?.onend()')}
  assert.equal(h.run('state.recording'),false);assert.match(h.document.getElementById('error').textContent,/no-speech/);assert.equal(h.timers.size,0);
});
test('voice permission and network failures do not retry forever',async()=>{
  for(const code of ['not-allowed','network']){
    const h=await harness();h.run("globalThis.starts=0;window.SpeechRecognition=class{start(){starts++}stop(){}abort(){}};state.voiceConsent=true;startVoice()");
    h.run(`state.recognition.onerror({error:'${code}'})`);h.tick(10000);
    assert.equal(h.run('starts'),1);assert.equal(h.run('state.recording'),false);assert.match(h.document.getElementById('error').textContent,new RegExp(code));assert.equal(h.timers.size,0);
  }
});
test('voice session has a three minute bound and a bounded finalization wait',async()=>{
  const h=await harness();h.run("globalThis.aborts=0;window.SpeechRecognition=class{start(){}stop(){}abort(){aborts++}};state.voiceConsent=true;startVoice();state.recognition.onresult({results:[[{transcript:'保留草稿'}]]})");
  h.tick(180000);assert.equal(h.run('state.recording'),false);h.tick(1500);
  assert.equal(h.document.getElementById('prompt').value,'保留草稿');assert.equal(h.run('state.recognition'),null);assert.equal(h.timers.size,0);assert.match(h.document.getElementById('voiceStatus').textContent,/3 分钟/);
});
test('voice finalization never overwrites a manual correction',async()=>{
  const h=await harness();h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;startVoice();globalThis.r=state.recognition;r.onresult({results:[[{transcript:'原文字'}]]});$('prompt').value='我手动更正的文字';r.onresult({results:[[{transcript:'后到的文字'}]]});r.onend()");
  assert.equal(h.document.getElementById('prompt').value,'我手动更正的文字');assert.equal(h.run('state.recording'),false);assert.equal(h.calls.length,0);
});
test('RT uses analog hysteresis and a short release debounce',async()=>{
  const h=await harness();assert.equal(h.run('rtPressed({value:.4,pressed:false},0)'),false);
  assert.equal(h.run('state.padButtons[7]=rtPressed({value:.6,pressed:false},0)'),true);
  assert.equal(h.run('rtPressed({value:.48,pressed:false},10)'),true);
  assert.equal(h.run('rtPressed({value:0,pressed:false},20)'),true);
  assert.equal(h.run('rtPressed({value:0,pressed:false},159)'),true);
  assert.equal(h.run('rtPressed({value:0,pressed:false},161)'),false);
});
test('historical failed turns stay in their records and never become current alerts',async()=>{
  const h=await harness();h.run("state.selected='t';renderHistory({id:'t',turns:[{id:'old',status:'failed',error:{message:'以前的失败'},items:[{id:'a',type:'agentMessage',text:'历史回复'}]},{id:'new',status:'completed',error:null,items:[]}]})");
  assert.equal(h.document.getElementById('error').textContent,'');assert.match(h.document.getElementById('timeline').textContent,/以前的失败/);
});
test('late action errors from a previous selection do not appear in the current task',async()=>{
  const h=await harness();let reject;h.respond(()=>new Promise((_,r)=>reject=r));h.run("state.selected='old'");
  const pending=h.run("action(()=>rpc('thread/read',{threadId:'old'}))()");await new Promise(setImmediate);
  h.run("state.selected='new';state.selectionVersion++");reject(new Error('过期读取失败'));await pending;
  assert.equal(h.document.getElementById('error').textContent,'');
});
test('closing a modal suppresses a later error from its old request',async()=>{
  const h=await harness();let reject;h.respond(()=>new Promise((_,r)=>reject=r));h.run("modal('旧窗口')");
  const pending=h.run("action(()=>rpc('account/read'))()");await new Promise(setImmediate);h.run("$('modal').close();modal('新窗口')");reject(new Error('旧窗口错误'));await pending;
  assert.equal(h.document.getElementById('modalError').textContent,'');
});
test('connection recovery clears only connection alerts, not the current voice error',async()=>{
  const h=await harness();h.run("state.connected=true;error('旧连接错误',{source:'bridge',global:true});error('当前语音错误',{source:'voice'});setConnected(true)");
  assert.equal(h.document.getElementById('error').textContent,'当前语音错误');assert.equal(h.run("[...state.issues.values()].some(x=>x.source==='bridge')"),false);
});
test('an old turn completion cannot clear a newer active turn',async()=>{
  const h=await harness();h.run("state.selected='t';event({method:'turn/started',params:{threadId:'t',turn:{id:'new'}}});event({method:'turn/completed',params:{threadId:'t',turn:{id:'old',status:'failed',error:{message:'旧失败'}}}})");
  assert.equal(h.run("state.active.get('t')"),'new');assert.equal(h.document.getElementById('error').textContent,'');
});
test('a retry notification is activity, not a fatal alert',async()=>{
  const h=await harness();h.run("state.selected='t';event({method:'turn/started',params:{threadId:'t',turn:{id:'a'}}});event({method:'error',params:{threadId:'t',turnId:'a',willRetry:true,error:{message:'临时断线'}}})");
  assert.equal(h.document.getElementById('error').textContent,'');assert.match(h.document.getElementById('timeline').textContent,/正在重试/);
});
test('reasoning summary and plan streams render real structured activity',async()=>{
  const h=await harness();h.run("state.selected='t';event({method:'turn/started',params:{threadId:'t',turn:{id:'a'}}});event({method:'item/reasoning/summaryTextDelta',params:{threadId:'t',turnId:'a',itemId:'r',summaryIndex:0,delta:'核对现有代码'}});event({method:'turn/plan/updated',params:{threadId:'t',turnId:'a',explanation:'先验证',plan:[{step:'补回归检查',status:'inProgress'}]}})");
  assert.match(h.document.getElementById('timeline').textContent,/核对现有代码/);assert.match(h.document.getElementById('timeline').textContent,/补回归检查/);
  h.run("event({method:'item/completed',params:{threadId:'t',turnId:'a',item:{id:'r',type:'reasoning',summary:['核对完成'],content:['not a displayed summary']}}})");
  assert.doesNotMatch(h.document.getElementById('timeline').textContent,/not a displayed summary/);
});
test('terminal completion retains streamed output and ignores late duplicate deltas',async()=>{
  const h=await harness();h.run("state.selected='t';event({method:'item/commandExecution/outputDelta',params:{threadId:'t',turnId:'a',itemId:'c',delta:'PASS'}});event({method:'item/completed',params:{threadId:'t',turnId:'a',item:{id:'c',type:'commandExecution',command:'npm test',status:'completed',aggregatedOutput:null,exitCode:0,durationMs:100}}});event({method:'item/commandExecution/outputDelta',params:{threadId:'t',turnId:'a',itemId:'c',delta:'LATE'}})");
  const text=h.document.getElementById('timeline').textContent;assert.match(text,/PASS/);assert.match(text,/退出码 0/);assert.doesNotMatch(text,/LATE/);
});
test('final replies render code as text nodes, not executable HTML',async()=>{
  const h=await harness();h.run("renderItem({id:'m',type:'agentMessage',phase:'final_answer',text:'## 结果\\n**完成**\\n```html\\n<img src=x onerror=alert(1)>\\n```'},{turnId:'a',phase:'completed'})");
  const root=h.document.getElementById('timeline'),tags=[];const visit=e=>{tags.push(e.tagName);for(const child of e.children)visit(child)};visit(root);
  assert.ok(tags.includes('PRE'));assert.ok(tags.includes('CODE'));assert.ok(!tags.includes('IMG'));assert.match(root.textContent,/<img src=x/);
});

test('completed empty reasoning records do not look like ongoing thought',async()=>{
  const h=await harness();h.run("state.selected='t';renderHistory({id:'t',turns:[{id:'a',status:'completed',items:[{id:'empty',type:'reasoning',summary:[],content:['not displayed']}]}]})");
  assert.doesNotMatch(h.document.getElementById('timeline').textContent,/等待服务端|not displayed/);
});
test('reply tables preserve code-cell pipes and links reject executable schemes',async()=>{
  const h=await harness();h.run("renderItem({id:'m',type:'agentMessage',text:'| 命令 | 结果 |\\n| --- | --- |\\n| `a|b` | 通过 |\\n\\n[文档](https://example.test/docs) [危险](javascript:alert(1))'},{turnId:'t',phase:'completed'})");
  const nodes=[];const walk=e=>{nodes.push(e);for(const c of e.children)walk(c)};walk(h.document.getElementById('timeline'));
  assert.equal(nodes.filter(e=>e.tagName==='TABLE').length,1);assert.equal(nodes.filter(e=>e.tagName==='A').length,1);
  assert.equal(nodes.find(e=>e.tagName==='TD').textContent,'a|b');
});

test('a completed turn ends its synthetic plan status without inventing step completion',async()=>{
  const h=await harness();h.run("state.selected='t';event({method:'turn/started',params:{threadId:'t',turn:{id:'a'}}});event({method:'turn/plan/updated',params:{threadId:'t',turnId:'a',plan:[{step:'尚未完成',status:'pending'}]}});event({method:'turn/completed',params:{threadId:'t',turn:{id:'a',status:'interrupted'}}})");
  assert.equal(h.run("activity.items.get('plan:a').badge.textContent"),'已中止');
  assert.equal(h.run("activity.items.get('plan:a').item.plan[0].status"),'pending');
});

test('a late history snapshot cannot replace newer live activity or resurrect its error',async()=>{
  const h=await harness();let resolve;h.respond(()=>new Promise(r=>resolve=r));
  const loading=h.run("selectThread('t')");await new Promise(setImmediate);
  h.run("event({method:'turn/started',params:{threadId:'t',turn:{id:'new'}}});event({method:'item/agentMessage/delta',params:{threadId:'t',turnId:'new',itemId:'m',delta:'当前进度'}})");
  resolve({thread:{id:'t',turns:[{id:'old',status:'failed',error:{message:'旧错误'},items:[]}]}});await loading;
  assert.equal(h.run("state.active.get('t')"),'new');assert.match(h.document.getElementById('timeline').textContent,/当前进度/);
  assert.doesNotMatch(h.document.getElementById('timeline').textContent,/旧错误/);assert.equal(h.document.getElementById('error').textContent,'');
});

test('a delayed voice diagnosis cannot populate a newer dialog',async()=>{
  const h=await harness();h.run("navigator.permissions={query:()=>new Promise(resolve=>{globalThis.permissionResolve=resolve})}");
  const diagnosis=h.run('voiceDiagnostics()');h.run("$('modal').close();modal('新窗口');permissionResolve({state:'granted'})");await diagnosis;
  assert.equal(h.document.getElementById('modalTitle').textContent,'新窗口');assert.equal(h.document.getElementById('modalBody').textContent,'');
});

function fixturePad(h){
  h.run("globalThis.pad={id:'Fixture Controller',index:0,connected:true,mapping:'standard',buttons:Array.from({length:17},()=>({value:0,pressed:false})),axes:[0,0,0,0]};navigator.getGamepads=()=>[pad];gamepad()");
}

test('controller diagram selects a key without executing work or fabricating input',async()=>{
  const h=await harness();h.run("padControls.open();padControls.select(0)");
  assert.equal(h.document.getElementById('padButtons').children.length,17);
  assert.equal(h.document.getElementById('padSelectedTitle').textContent,'确认 / 单击');
  assert.equal(h.document.getElementById('padInputValue').textContent,'—');assert.equal(h.calls.length,0);
  h.run('padControls.select(12)');assert.equal(h.document.getElementById('padBinding').disabled,true);
});

test('controller monitor shows real values and clears presses, axes and meters on disconnect',async()=>{
  const h=await harness();fixturePad(h);h.run("padControls.open();pad.buttons[7]={value:.72,pressed:true};pad.axes=[.3,-.4,.1,.5];gamepad()");
  assert.equal(h.document.getElementById('padRTValue').textContent,'72%');assert.equal(h.document.getElementById('padRTMeter').value,.72);
  assert.equal(h.run("padControls.nodes[7].button.classList.contains('pad-pressed')"),true);
  assert.match(h.document.getElementById('padLeftValue').textContent,/0.30.*-0.40/);
  h.run('navigator.getGamepads=()=>[];gamepad()');
  assert.equal(h.document.getElementById('padRTValue').textContent,'—');assert.equal(h.document.getElementById('padRTMeter').value,0);
  assert.equal(h.run("padControls.nodes[7].button.classList.contains('pad-pressed')"),false);
  assert.equal(h.document.getElementById('padLastInput').textContent,'尚未收到设备输入');
});

test('controller bindings swap occupied actions and persist across a fresh page instance',async()=>{
  const saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  const h=await harness({storage});h.run("padControls.select(0);padControls.bind('voice')");
  assert.equal(h.run('padControls.config.bindings.voice'),0);assert.equal(h.run('padControls.config.bindings.confirm'),7);
  assert.match(h.document.getElementById('padVoiceHint').textContent,/短按 A/);assert.match(h.document.getElementById('padSaveStatus').textContent,/交换/);
  const next=await harness({storage});assert.equal(next.run("padControls.key('voice')"),'A');assert.equal(next.run("padControls.key('confirm')"),'RT');
  h.run("padControls.bind('none')");assert.equal(h.run('padControls.config.bindings.voice'),null);
  assert.equal(h.run("padControls.key('voice')"),'—');
  assert.match(h.document.getElementById('padVoiceHint').textContent,/麦克风按钮/);
});

test('invalid stored bindings and tuning do not become executable configuration',async()=>{
  const storage={getItem:()=>JSON.stringify({version:1,bindings:{confirm:7,back:1,interrupt:2,approvals:3,previous:4,next:5,voice:7,newThread:9},triggerThreshold:-1,deadzone:1,scrollSpeed:'fast'})};
  const h=await harness({storage});assert.equal(h.run('padControls.config.bindings.confirm'),0);assert.equal(h.run('padControls.config.triggerThreshold'),.55);
  assert.equal(h.run('padControls.config.deadzone'),.18);assert.equal(h.run('padControls.config.scrollSpeed'),900);
});

test('storage failure retains session settings and reset restores defaults',async()=>{
  const h=await harness({storage:{getItem(){throw Error('blocked')},setItem(){throw Error('quota')}}});
  h.run("padControls.select(7);padControls.bind('interrupt')");assert.equal(h.run('padControls.config.bindings.interrupt'),7);
  assert.match(h.document.getElementById('padSaveStatus').textContent,/本次会话有效/);
  h.document.getElementById('padReset').onclick();assert.equal(h.run('padControls.config.bindings.keyboard'),2);assert.equal(h.run('padControls.config.bindings.interrupt'),null);assert.equal(h.run('padControls.config.bindings.voice'),7);
});

test('first device wake-up cannot submit a draft and a new device cannot inherit a held action',async()=>{
  const h=await harness();h.run("state.connected=true;state.selected='t';state.resumed.add('t');$('prompt').value='keep';globalThis.pad={id:'one',index:0,mapping:'standard',buttons:Array.from({length:17},()=>({value:0,pressed:false})),axes:[0,0,0,0]};pad.buttons[0]={value:1,pressed:true};navigator.getGamepads=()=>[pad];gamepad()");
  assert.equal(h.calls.length,0);h.run("pad.buttons[0]={value:0,pressed:false};gamepad();pad.id='two';pad.buttons[0]={value:1,pressed:true};gamepad()");
  assert.equal(h.calls.length,0);assert.equal(h.document.getElementById('prompt').value,'keep');
});

test('preview mode blocks recording, sending and interruption shortcuts',async()=>{
  const h=await harness();fixturePad(h);h.run("state.connected=true;state.selected='t';state.resumed.add('t');state.active.set('t','a');state.voiceConsent=true;window.SpeechRecognition=class{start(){throw Error('must not record')}};$('prompt').value='keep';padControls.open();gamepad();pad.buttons[2]={value:1,pressed:true};pad.buttons[7]={value:1,pressed:true};gamepad()");
  assert.equal(h.calls.length,0);assert.equal(h.run('state.recording'),false);assert.equal(h.document.getElementById('prompt').value,'keep');
  assert.equal(h.document.getElementById('error').textContent,'');
});

test('remapped voice follows the assigned key and the next press finalizes capture',async()=>{
  const h=await harness();fixturePad(h);h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;padControls.select(0);padControls.bind('voice');gamepad();pad.buttons[0]={value:1,pressed:true};gamepad()");
  assert.equal(h.run('state.recording'),true);assert.equal(h.run('state.voiceSource'),'gamepad');
  h.run('pad.buttons[0]={value:0,pressed:false};gamepad()');h.tick(141);h.run('gamepad()');
  assert.equal(h.run('state.recording'),true);
  h.run('pad.buttons[0]={value:1,pressed:true};gamepad()');
  assert.equal(h.run('state.recording'),false);
});

test('trigger threshold uses analog pressure rather than the browser pressed flag',async()=>{
  const h=await harness();h.run('padControls.config.triggerThreshold=.85');
  assert.equal(h.run('rtPressed({value:.8,pressed:true},0)'),false);assert.equal(h.run('rtPressed({value:.9,pressed:true},0)'),true);
});

test('RT activates at the displayed percentage, including float-rounded 55 and 90 percent',async()=>{
  for(const [threshold,value]of [[.55,.5499999523162842],[.9,.8999999761581421],[.9,.95]]){
    const h=await harness();fixturePad(h);h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true");
    h.run(`padControls.config.triggerThreshold=${threshold};pad.buttons[7]={value:${value},pressed:true};gamepad()`);
    assert.equal(h.run('state.recording'),true);assert.equal(h.document.getElementById('voicePanel').dataset.phase,'starting');assert.equal(h.calls.length,0);
  }
});

test('a displayed 89 percent remains below a 90 percent voice threshold',async()=>{
  const h=await harness();h.run('padControls.config.triggerThreshold=.9');
  assert.equal(h.run('rtPressed({value:.894,pressed:true},0)'),false);
  assert.equal(h.run('rtPressed({value:.8999999761581421,pressed:true},0)'),true);
});

test('stick deadzone rejects drift and scrolling is independent of refresh rate',async()=>{
  for(const rate of [60,120]){
    const h=await harness();fixturePad(h);h.run("$('timeline').scrollHeight=20000;$('timeline').clientHeight=500;pad.axes[3]=.1");h.tick(16);h.run('gamepad()');assert.equal(h.document.getElementById('timeline').scrollTop,0);
    h.run('pad.axes[3]=1');for(let i=0;i<rate;i++){h.tick(1000/rate);h.run('gamepad()')}
    assert.ok(Math.abs(h.document.getElementById('timeline').scrollTop-(900-50*(1-Math.exp(-18))))<.001);
  }
});

test('nonstandard mapping remains observable but cannot execute work shortcuts',async()=>{
  const h=await harness();fixturePad(h);h.run("pad.mapping='';padControls.open();gamepad();padControls.close();pad.buttons[0]={value:1,pressed:true};pad.buttons[7]={value:1,pressed:true};gamepad()");
  assert.match(h.document.getElementById('padMapping').textContent,/非标准/);assert.equal(h.calls.length,0);assert.equal(h.run('state.recording'),false);
});

test('closing the panel with confirm cannot also trigger voice in the same frame',async()=>{
  const h=await harness();fixturePad(h);h.run("state.voiceConsent=true;window.SpeechRecognition=class{start(){}stop(){}abort(){}};padControls.open();gamepad()");
  const done=h.document.getElementById('padDone');done.tagName='BUTTON';done.focus();
  h.run('pad.buttons[0]={value:1,pressed:true};pad.buttons[7]={value:1,pressed:true};gamepad()');
  assert.equal(h.run('padControls.isOpen()'),false);assert.equal(h.run('state.recording'),false);assert.equal(h.run('state.padMuted'),true);
});

test('blur pauses shortcut handling until focus and neutral input return',async()=>{
  const h=await harness();fixturePad(h);h.run("state.voiceConsent=true;window.SpeechRecognition=class{start(){}stop(){}abort(){}}");h.windowEvent('blur');
  h.run('gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()');assert.equal(h.run('state.recording'),false);
  h.windowEvent('focus');h.run('gamepad()');assert.equal(h.run('state.recording'),false);
  h.run('pad.buttons[7]={value:0,pressed:false};gamepad()');h.tick(141);h.run('gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()');assert.equal(h.run('state.recording'),true);
});

test('RT rearms independently of deflected sticks after device connection',async()=>{
  const h=await harness();fixturePad(h);
  h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;pad.id='new device';pad.axes=[.3,0,0,.6];gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()");
  assert.equal(h.run('state.recording'),true);assert.equal(h.run('state.padMuted'),true);
  assert.equal(h.document.getElementById('voicePanel').dataset.phase,'starting');assert.equal(h.calls.length,0);
  h.run('state.recognition.onstart();pad.buttons[7]={value:0,pressed:false};gamepad()');h.tick(141);h.run('gamepad()');
  assert.equal(h.run('state.recording'),true);
  h.run('pad.buttons[7]={value:1,pressed:true};gamepad()');
  assert.equal(h.run('state.recording'),false);
});

test('closing the wheel cannot leave RT blocked by a stick or another held button',async()=>{
  const h=await harness();fixturePad(h);
  h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;state.connected=true;state.selected='t';state.resumed.add('t');$('prompt').value='保留草稿';pilot.openWheel();pad.axes[0]=1;pad.buttons[0]={value:1,pressed:true};pilot.cancelWheel();gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()");
  assert.equal(h.run('state.recording'),true);assert.equal(h.document.getElementById('prompt').value,'保留草稿');assert.equal(h.calls.length,0);
});

test('native document focus recovers RT after a missed window focus event',async()=>{
  const h=await harness();fixturePad(h);h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true");h.windowEvent('blur');
  h.document.hasFocus=()=>true;
  h.run('gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()');
  assert.equal(h.run('state.recording'),true);assert.equal(h.calls.length,0);
});

test('native background focus and visibility still block RT and require a fresh press',async()=>{
  for(const hidden of [false,true]){
    const h=await harness();fixturePad(h);h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true");
    h.document.hidden=hidden;h.document.hasFocus=()=>hidden;h.windowEvent('focus');
    h.run('gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()');assert.equal(h.run('state.recording'),false);
    h.document.hidden=false;h.document.hasFocus=()=>true;h.run('gamepad()');assert.equal(h.run('state.recording'),false);
    h.run('pad.buttons[7]={value:0,pressed:false};gamepad()');h.tick(141);h.run('gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()');
    assert.equal(h.run('state.recording'),true);
  }
});

test('RT held during device wake or panel close must be released before recording',async()=>{
  for(const reconnect of [false,true]){
    const h=await harness();fixturePad(h);h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;pad.buttons[7]={value:1,pressed:true}");
    if(reconnect)h.run("pad.id='replacement'");else h.run('padControls.open();gamepad();padControls.close()');
    h.run('gamepad();gamepad()');assert.equal(h.run('state.recording'),false);
    assert.match(h.document.getElementById('padVoiceStatus').textContent,/松开 RT/);
    h.run('pad.buttons[7]={value:0,pressed:false};gamepad()');h.tick(141);h.run('gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()');
    assert.equal(h.run('state.recording'),true);
  }
});

test('RT status exposes pressure, threshold and actual input blockers without replacing speech errors',async()=>{
  const h=await harness();fixturePad(h);h.run("pad.buttons[7]={value:.3,pressed:false};gamepad();error('保留当前语音错误',{source:'voice'})");
  assert.match(h.document.getElementById('padVoiceStatus').textContent,/RT 30%.*55%/);
  h.windowEvent('blur');h.run('gamepad()');assert.match(h.document.getElementById('padVoiceStatus').textContent,/点击网页/);
  assert.equal(h.document.getElementById('error').textContent,'保留当前语音错误');
  h.windowEvent('focus');h.run("padControls.config.bindings.voice=null;gamepad()");assert.match(h.document.getElementById('padVoiceStatus').textContent,/未分配/);
  h.run('navigator.getGamepads=()=>[];gamepad()');assert.match(h.document.getElementById('padVoiceStatus').textContent,/未检测到手柄/);
});

test('RT with deflected sticks still requests consent and never captures before agreement',async()=>{
  const h=await harness();fixturePad(h);h.run("globalThis.starts=0;window.SpeechRecognition=class{start(){starts++}stop(){}abort(){}};padControls.open();padControls.close();pad.axes[0]=1;gamepad();pad.buttons[7]={value:1,pressed:true};gamepad();gamepad()");
  assert.equal(h.document.getElementById('modalTitle').textContent,'启用持续语音');assert.equal(h.run('starts'),0);
  assert.match(h.document.getElementById('padVoiceStatus').textContent,/窗口/);assert.equal(h.calls.length,0);
});

test('consent focuses its explicit enable action and still requires releasing RT before capture',async()=>{
  const h=await harness();fixturePad(h);h.run("globalThis.starts=0;window.SpeechRecognition=class{start(){starts++}stop(){}abort(){}};pad.buttons[7]={value:1,pressed:true};gamepad();gamepad()");
  const enable=h.document.getElementById('modalActions').children[1];assert.equal(h.document.activeElement,enable);assert.equal(h.run('starts'),0);
  await enable.onclick();assert.equal(h.run('starts'),0);assert.match(h.document.getElementById('voiceStatus').textContent,/语音已启用/);
  h.run('gamepad()');assert.equal(h.run('starts'),0);
  h.run('pad.axes[0]=.6;pad.buttons[7]={value:0,pressed:false};gamepad()');h.tick(141);h.run('gamepad();pad.buttons[7]={value:1,pressed:true};gamepad()');
  assert.equal(h.run('starts'),1);assert.equal(h.document.getElementById('voicePanel').dataset.phase,'starting');assert.equal(h.calls.length,0);
});

test('left stick flick has an intentional threshold and bounded hold repeat',async()=>{
  const h=await harness();assert.equal(h.run('pilot.navigation(.3,0,0)'),null);
  assert.ok(h.run('pilot.navigation(1,0,0)'));assert.equal(h.run('pilot.navigation(1,0,200)'),null);
  assert.ok(h.run('pilot.navigation(1,0,331)'));assert.equal(h.run('pilot.navigation(1,0,400)'),null);
  h.run('pilot.navigation(0,0,410)');assert.ok(h.run('pilot.navigation(1,0,411)'));
});

test('left stick spatial navigation chooses a nearby aligned target, not DOM order',async()=>{
  const h=await harness(),buttons=[0,1,2].map(()=>h.document.createElement('button'));
  const position=(x,y)=>({left:x,top:y,right:x+40,bottom:y+30,width:40,height:30});
  buttons[0].rect=position(0,0);buttons[1].rect=position(60,100);buttons[2].rect=position(100,0);
  buttons[0].focus();h.context.targets=buttons;h.run('document.querySelectorAll=()=>targets');fixturePad(h);
  h.run('pad.axes[0]=1;gamepad()');assert.equal(h.document.activeElement,buttons[2]);assert.equal(h.calls.length,0);
});

test('right stick supplies horizontal and vertical precision motion with bounded coast',async()=>{
  const h=await harness();const slow=h.run('pilot.motion(.35,.35,.016,.18,900)'),fast=h.run('pilot.reset();pilot.motion(1,1,.016,.18,900)');
  assert.ok(slow[0]>0&&slow[1]>0);assert.ok(fast[0]>slow[0]*5);
  for(let i=0;i<13;i++)h.run('pilot.motion(0,0,.016,.18,900)');assert.equal(h.run('pilot.vx'),0);assert.equal(h.run('pilot.vy'),0);
  assert.deepEqual(Array.from(h.run('pilot.motion(NaN,Infinity,.016,.18,900)')),[0,0]);
});

test('LT wheel and left stick release add an intent to the draft without sending',async()=>{
  const h=await harness();fixturePad(h);h.run("$('prompt').value='保留原要求';pad.buttons[6]={value:1,pressed:true};gamepad();pad.axes[0]=1;gamepad()");
  assert.equal(h.run('pilot.selectedWheel'),2);assert.equal(h.document.getElementById('prompt').value,'保留原要求');
  h.run('pad.buttons[6]={value:0,pressed:false};gamepad()');assert.equal(h.run('pilot.isWheelOpen()'),false);
  assert.match(h.document.getElementById('prompt').value,/保留原要求\n\n请复用现有测试框架/);assert.equal(h.calls.length,0);assert.equal(h.run('state.padMuted'),true);
  h.run('pilotBack()');assert.match(h.document.getElementById('prompt').value,/请复用现有测试框架/);h.run('undoIntent()');assert.equal(h.document.getElementById('prompt').value,'保留原要求');
  assert.equal(h.document.getElementById('intentUndo').classList.contains('hidden'),true);
});

test('wheel center and return cancel instead of choosing an arbitrary intent',async()=>{
  for(const back of [false,true]){
    const h=await harness();fixturePad(h);h.run("pad.buttons[6]={value:1,pressed:true};gamepad();pad.axes[1]=-1;gamepad()");
    if(back)h.run('pad.buttons[1]={value:1,pressed:true};gamepad()');
    else h.run('pad.axes[1]=0;gamepad();pad.buttons[6]={value:0,pressed:false};gamepad()');
    assert.equal(h.document.getElementById('prompt').value,'');assert.equal(h.run('pilot.isWheelOpen()'),false);assert.equal(h.calls.length,0);
  }
});

test('wheel angular hysteresis rejects boundary jitter',async()=>{
  const h=await harness();h.run("pilot.openWheel();pilot.wheelVector(0,-1);pilot.wheelVector(Math.sin(.4),-Math.cos(.4))");
  assert.equal(h.run('pilot.selectedWheel'),0);h.run('pilot.wheelVector(Math.sin(.55),-Math.cos(.55))');assert.equal(h.run('pilot.selectedWheel'),1);
});

test('pointer wheel remains usable when no physical gamepad is present',async()=>{
  const h=await harness();h.run('pilot.openWheel();gamepad();gamepad()');assert.equal(h.run('pilot.isWheelOpen()'),true);
  fixturePad(h);assert.equal(h.run('pilot.isWheelOpen()'),true);
  h.run('pilot.selectWheel(1);pilot.releaseWheel()');assert.match(h.document.getElementById('prompt').value,/沿用现有设计语言/);assert.equal(h.calls.length,0);
});

test('device loss or window blur cancels a held wheel without inserting its preview',async()=>{
  for(const disconnect of [true,false]){
    const h=await harness();fixturePad(h);h.run('pad.buttons[6]={value:1,pressed:true};gamepad();pad.axes[0]=1;gamepad()');
    if(disconnect)h.run('navigator.getGamepads=()=>[];gamepad()');else h.windowEvent('blur');
    assert.equal(h.run('pilot.isWheelOpen()'),false);assert.equal(h.document.getElementById('prompt').value,'');
  }
});

test('intent undo never destroys a later manual edit or another task draft',async()=>{
  const h=await harness();h.run("state.selected='one';insertIntent({title:'检查',text:'新增要求'});$('prompt').value+='手动补充';pilotBack()");
  assert.equal(h.document.getElementById('prompt').value,'新增要求手动补充');
  h.run("state.selected='two';$('prompt').value='第二个任务';pilotBack()");assert.equal(h.document.getElementById('prompt').value,'第二个任务');
});

test('reading anchors shuttle independently per task and can be cleared',async()=>{
  const h=await harness();h.run("state.selected='one';$('timeline').scrollTop=250;readingAnchor();$('timeline').scrollTop=800;readingAnchor()");
  assert.equal(h.document.getElementById('timeline').scrollTop,250);h.run('readingAnchor()');assert.equal(h.document.getElementById('timeline').scrollTop,800);
  h.run("state.selected='two';$('timeline').scrollTop=40;readingAnchor();readingAnchor(true)");assert.equal(h.run("state.readingAnchors.has('two')"),false);assert.equal(h.run("state.readingAnchors.has('one')"),true);
});

test('L3 focus mode and return preserve the draft',async()=>{
  const h=await harness();fixturePad(h);h.run("$('prompt').value='草稿';pad.buttons[10]={value:1,pressed:true};gamepad()");
  assert.equal(h.document.body.classList.contains('pilot-focus-mode'),true);assert.equal(h.document.getElementById('focusToggle').getAttribute('aria-pressed'),'true');
  h.run('pilotBack()');assert.equal(h.document.body.classList.contains('pilot-focus-mode'),false);assert.equal(h.document.getElementById('prompt').value,'草稿');
});

test('task overview searches loaded real task names and directories without starting a turn',async()=>{
  const h=await harness();h.run("state.threads=[{id:'a',name:'界面',cwd:'C:/alpha'},{id:'b',name:'测试',cwd:'C:/beta'}];taskOverview()");
  const body=h.document.getElementById('modalBody'),input=body.children.find(e=>e.tagName==='INPUT'),grid=body.children.find(e=>e.className==='task-deck');
  assert.equal(grid.children.length,2);input.value='beta';input.oninput();assert.equal(grid.children.length,1);assert.match(grid.textContent,/测试/);assert.equal(h.calls.length,0);
});

test('v1 preferences migrate without replacing an existing trigger remap',async()=>{
  const storage={getItem:()=>JSON.stringify({version:1,bindings:{confirm:0,back:1,interrupt:2,approvals:3,previous:4,next:5,voice:6,newThread:9},deadzone:.25})};
  const h=await harness({storage});assert.equal(h.run('padControls.config.version'),3);assert.equal(h.run('padControls.config.bindings.voice'),6);assert.equal(h.run('padControls.config.bindings.intent'),null);
  assert.equal(h.run('padControls.config.bindings.overview'),8);assert.equal(h.run('padControls.config.deadzone'),.25);
});

test('all standard buttons have a role, with home exposed only as a browser-available binding',async()=>{
  const h=await harness();assert.equal(h.run('new Set(Object.values(padControls.config.bindings).filter(v=>v!=null)).size'),13);
  h.run('padControls.select(16)');assert.equal(h.document.getElementById('padBinding').disabled,false);assert.match(h.document.getElementById('padSelectedDescription').textContent,/浏览器开放/);
  assert.deepEqual(Array.from(h.run('Object.values(padControls.config.bindings).filter(v=>v!=null).sort((a,b)=>a-b)')),[0,1,2,3,4,5,6,7,8,9,10,11,16]);
});

test('D-pad reading navigation expands and collapses the current activity',async()=>{
  const h=await harness(),first=h.document.createElement('details'),second=h.document.createElement('details');
  const summaries=[h.document.createElement('summary'),h.document.createElement('summary')];first.querySelector=()=>summaries[0];second.querySelector=()=>summaries[1];
  h.document.getElementById('timeline').querySelectorAll=()=>[first,second];h.context.firstReading=first;h.run('state.lastReading=firstReading;jumpReading(1);readingDetail(true)');
  assert.equal(second.open,true);h.run('readingDetail(false)');assert.equal(second.open,false);assert.equal(h.document.activeElement,summaries[1]);
});

test('horizontal read motion pans code and vertical overflow chains to the timeline',async()=>{
  const h=await harness(),detail=h.document.createElement('details'),inner=h.document.createElement('div');detail.open=true;detail.querySelector=()=>inner;detail.querySelectorAll=()=>[inner];
  Object.assign(inner,{scrollHeight:300,clientHeight:100,scrollTop:190,scrollWidth:600,clientWidth:200,scrollLeft:0});
  const timeline=h.document.getElementById('timeline');Object.assign(timeline,{scrollHeight:2000,clientHeight:400,scrollTop:100});timeline.querySelectorAll=()=>[detail];
  h.context.reading=detail;h.run('state.lastReading=reading;readMotion(35,30)');assert.equal(inner.scrollTop,200);assert.equal(timeline.scrollTop,120);assert.equal(inner.scrollLeft,35);
});

test('idle connected polling does not measure the message tree every frame',async()=>{
  const h=await harness();fixturePad(h);let reads=0;h.document.getElementById('timeline').querySelectorAll=()=>{reads++;return[]};
  for(let i=0;i<20;i++){h.tick(16);h.run('gamepad()')}assert.equal(reads,0);
});

test('spatial navigation ignores tiny angular jitter between adjacent directions',async()=>{
  const h=await harness();h.run('pilot.navigation(1,0,0)');assert.equal(h.run('pilot.navigation(Math.cos(.4),Math.sin(.4),20)'),null);
  const vector=Array.from(h.run('pilot.navigation(Math.cos(.6),Math.sin(.6),40)'));assert.ok(vector[0]>.7&&vector[1]>.7);
});

test('editing a draft invalidates intent undo even when the text is later identical',async()=>{
  const h=await harness();h.run("insertIntent({title:'检查',text:'要求'});for(const fn of $('prompt').listeners.input||[])fn();pilotBack()");
  assert.equal(h.document.getElementById('prompt').value,'要求');assert.equal(h.run('state.lastIntent'),null);
});

test('ABXY defaults separate confirmation, back, keyboard and precision pointer',async()=>{
  const h=await harness();assert.equal(h.run('padControls.config.version'),3);
  assert.deepEqual(Array.from(h.run("['confirm','back','keyboard','pointer'].map(k=>padControls.config.bindings[k])")),[0,1,2,3]);
  assert.equal(h.run('padControls.config.bindings.interrupt'),null);assert.equal(h.run('padControls.config.bindings.approvals'),null);
});

test('A never sends from an unfocused page or a text field; an explicit send target does',async()=>{
  const h=await harness();fixturePad(h);h.run("state.connected=true;state.selected='t';state.resumed.add('t');$('prompt').value='保留并预览';document.activeElement=document.body;confirmFocused();confirmFocused()");
  assert.equal(h.calls.length,0);assert.equal(h.document.activeElement,h.document.getElementById('prompt'));
  h.respond({turn:{id:'turn'}});h.run("$('send').focus();confirmFocused()");await new Promise(setImmediate);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'turn/start');
});

test('A activates native details and never clicks a disabled or out-of-dialog target',async()=>{
  const h=await harness(),summary=h.document.createElement('summary');let clicks=0;summary.onclick=()=>clicks++;summary.focus();h.run('confirmFocused()');assert.equal(clicks,1);
  summary.disabled=true;h.run('confirmFocused()');assert.equal(clicks,1);summary.disabled=false;
  h.run("modal('当前窗口')");summary.focus();h.run('confirmFocused()');assert.equal(clicks,1);
});

test('X opens the keyboard instead of interrupting a running task; A held on entry types nothing',async()=>{
  const h=await harness();fixturePad(h);h.run("state.selected='t';state.active.set('t','running');$('prompt').value='原稿';pad.buttons[2]={value:1,pressed:true};pad.buttons[0]={value:1,pressed:true};gamepad();gamepad()");
  assert.equal(h.run('pilot.isKeyboardOpen()'),true);assert.equal(h.document.getElementById('prompt').value,'原稿');assert.equal(h.calls.length,0);
  h.run('pad.buttons[0]={value:0,pressed:false};gamepad();pad.buttons[0]={value:1,pressed:true};gamepad()');
  assert.equal(h.document.getElementById('prompt').value,'原稿q');assert.equal(h.run("state.active.get('t')"),'running');
});

test('keyboard replaces the selected text and publishes ordinary draft input events',async()=>{
  const h=await harness();h.run("state.selected='t';$('prompt').value='hello world';$('prompt').setSelectionRange(6,11);toggleKeyboard();pilot.keyInput('text','Codex')");
  assert.equal(h.document.getElementById('prompt').value,'hello Codex');assert.equal(h.run("state.drafts.get('t')"),'hello Codex');
  assert.equal(h.document.getElementById('prompt').selectionStart,11);assert.equal(h.calls.length,0);
});

test('keyboard caret and backspace preserve whole emoji graphemes and combining characters',async()=>{
  const h=await harness();h.run("$('prompt').value='A👨‍👩‍👧‍👦é';toggleKeyboard();pilot.keyInput('backspace')");
  assert.equal(h.document.getElementById('prompt').value,'A👨‍👩‍👧‍👦');h.run("pilot.keyInput('left');pilot.keyInput('right');pilot.keyInput('backspace')");
  assert.equal(h.document.getElementById('prompt').value,'A');h.run("pilot.keyInput('home');pilot.keyInput('delete')");assert.equal(h.document.getElementById('prompt').value,'');
});

test('keyboard caps, symbols, whitespace and selected-range deletion use the real editor',async()=>{
  const h=await harness();h.run("toggleKeyboard();pilot.keyInput('caps');pilot.keyButtons.find(k=>k.base==='q').button.click();pilot.keyInput('symbols');pilot.keyButtons[0].button.click();pilot.keyInput('text',' ');pilot.keyInput('enter')");
  assert.equal(h.document.getElementById('prompt').value,'Q! \n');h.run("pilot.keyInput('select');pilot.keyInput('backspace')");assert.equal(h.document.getElementById('prompt').value,'');assert.equal(h.calls.length,0);
});

test('keyboard respects maxlength, readonly, detached targets and masked password previews',async()=>{
  const h=await harness(),field=h.document.createElement('input');field.type='password';field.value='hidden-secret';h.document.body.append(field);h.context.field=field;
  h.run('pilot.openKeyboard(field)');assert.doesNotMatch(h.document.getElementById('keyboardPreview').textContent,/hidden-secret/);
  field.maxLength=field.value.length;assert.equal(h.run("pilot.keyInput('text','x')"),false);assert.equal(field.value,'hidden-secret');
  field.readOnly=true;assert.equal(h.run("pilot.keyInput('backspace')"),false);assert.equal(field.value,'hidden-secret');
  field.readOnly=false;field.isConnected=false;assert.equal(h.run('pilot.openKeyboard(field)'),false);
});

test('X edits the active modal field and single-line enter closes without submitting',async()=>{
  const h=await harness();h.run('newThreadDialog();toggleKeyboard()');
  const input=h.document.getElementById('modalBody').children.find(e=>e.tagName==='LABEL').children[0];
  assert.equal(h.run('pilot.keyboardTarget'),input);assert.equal(h.document.getElementById('desktopKeyboard').parentElement,h.document.getElementById('modal'));
  h.run("pilot.keyInput('text','C:/work');pilot.keyInput('enter')");assert.equal(input.value,'C:/work');assert.equal(h.document.getElementById('modal').open,true);assert.equal(h.calls.length,0);
});

test('B closes the keyboard and pointer in layers without undoing or deleting a draft',async()=>{
  const h=await harness();h.run("insertIntent({title:'要求',text:'保留要求'});toggleKeyboard();pilot.keyInput('text','q');pilot.setPointer(true,activeInputRoot());pilotBack()");
  assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.run('pilot.pointerMode'),true);
  h.run('pilotBack();pilotBack()');assert.equal(h.run('pilot.pointerMode'),false);assert.equal(h.document.getElementById('prompt').value,'保留要求q');assert.equal(h.calls.length,0);
});

test('Y toggles a precise page pointer and A hits its current target rather than stale focus',async()=>{
  const h=await harness();fixturePad(h);const first=h.document.createElement('button'),second=h.document.createElement('button');let a=0,b=0;first.onclick=()=>a++;second.onclick=()=>b++;first.focus();
  h.document.elementFromPoint=()=>first;h.run('pad.buttons[3]={value:1,pressed:true};gamepad()');assert.equal(h.run('pilot.pointerMode'),true);
  h.document.elementFromPoint=()=>second;h.run('pad.buttons[0]={value:1,pressed:true};gamepad()');assert.equal(a,0);assert.equal(b,1);assert.equal(h.calls.length,0);
});

test('precision pointer has a deadzone, immediate stop, viewport bounds and refresh-rate independence',async()=>{
  const positions=[];for(const rate of [60,120]){
    const h=await harness();h.run('pilot.setPointer(true);pilot.movePointer(.1,0,.016,.18)');const start=h.run('pilot.pointerX');
    h.run('pilot.movePointer(0,0,.016,.18)');assert.equal(h.run('pilot.pointerX'),start);
    for(let i=0;i<rate;i++)h.run(`pilot.movePointer(1,0,${1/rate},.18)`);positions.push(h.run('pilot.pointerX'));
    h.run('pilot.pointerX=5000;pilot.pointerY=-500;pilot.movePointer(NaN,Infinity,.05,.18)');assert.equal(h.run('pilot.pointerX'),1272);assert.equal(h.run('pilot.pointerY'),8);
  }assert.ok(Math.abs(positions[0]-positions[1])<1e-6);
});

test('pointer hit testing respects the top dialog and disabled targets',async()=>{
  const h=await harness(),button=h.document.createElement('button');h.document.body.append(button);h.document.elementFromPoint=()=>button;
  h.run("modal('窗口');pilot.setPointer(true,activeInputRoot())");assert.equal(h.run('pilot.pointerHit(activeInputRoot())'),null);
  h.document.getElementById('modal').append(button);assert.equal(h.run('pilot.pointerHit(activeInputRoot())'),button);
  button.disabled=true;assert.equal(h.run('pilot.pointerHit(activeInputRoot())'),null);
});

test('native mouse and keyboard take over from the controller pointer without altering text',async()=>{
  const h=await harness();h.run("$('prompt').value='保留';togglePointer()");h.documentEvent({type:'pointerdown',target:h.document.body,isTrusted:true});assert.equal(h.run('pilot.pointerMode'),false);
  h.run('togglePointer()');h.documentEvent({type:'keydown',key:'Tab',isTrusted:true});assert.equal(h.run('pilot.pointerMode'),false);assert.equal(h.document.getElementById('prompt').value,'保留');
});

test('physical typing into the virtual keyboard and Escape preserve the editor and default shortcuts',async()=>{
  const h=await harness();h.run("toggleKeyboard();$('desktopKeyboard').dispatchEvent(new Event('keydown',{key:'x'}));$('desktopKeyboard').dispatchEvent(new Event('keydown',{key:'Backspace'}));$('desktopKeyboard').dispatchEvent(new Event('keydown',{key:'Z'}));$('desktopKeyboard').dispatchEvent(new Event('keydown',{key:'Escape'}))");
  assert.equal(h.document.getElementById('prompt').value,'Z');assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.document.activeElement,h.document.getElementById('prompt'));
});

test('desktop interaction loss preserves text and mouse-opened keyboard works without a gamepad',async()=>{
  const h=await harness();h.run("$('prompt').value='保留';toggleKeyboard();gamepad();gamepad()");assert.equal(h.run('pilot.isKeyboardOpen()'),true);
  fixturePad(h);h.run('navigator.getGamepads=()=>[];gamepad()');assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.document.getElementById('prompt').value,'保留');
  h.run('toggleKeyboard();togglePointer()');h.windowEvent('blur');assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.run('pilot.pointerMode'),false);
});

test('RT can continue from the on-screen draft keyboard without losing edited text',async()=>{
  const h=await harness();fixturePad(h);h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;toggleKeyboard();pilot.keyInput('text','draft');pad.buttons[7]={value:1,pressed:true};gamepad()");
  assert.equal(h.run('state.recording'),true);assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.document.getElementById('prompt').value,'draft');assert.equal(h.calls.length,0);
});

const legacyPad=()=>({version:2,bindings:{confirm:0,back:1,interrupt:2,approvals:3,previous:4,next:5,voice:7,newThread:9,intent:6,overview:8,focus:10,anchor:11,workbench:16},triggerThreshold:.9,deadzone:.27,scrollSpeed:1200});
test('v2 default face roles migrate to keyboard and pointer without changing tuning',async()=>{
  const h=await harness({storage:{getItem:()=>JSON.stringify(legacyPad())}});
  assert.equal(h.run('padControls.config.bindings.keyboard'),2);assert.equal(h.run('padControls.config.bindings.pointer'),3);assert.equal(h.run('padControls.config.bindings.interrupt'),null);
  assert.equal(h.run('padControls.config.triggerThreshold'),.9);assert.equal(h.run('padControls.config.deadzone'),.27);assert.equal(h.run('padControls.config.scrollSpeed'),1200);
});

test('v2 custom face roles are not stolen and the v3 remap persists across reload',async()=>{
  const config=legacyPad();config.bindings.confirm=2;config.bindings.interrupt=0;let saved=JSON.stringify(config);
  const storage={getItem:()=>saved,setItem:(key,value)=>saved=value},h=await harness({storage});
  assert.equal(h.run('padControls.config.bindings.keyboard'),null);assert.equal(h.run('padControls.config.bindings.confirm'),2);assert.equal(h.run('padControls.config.bindings.interrupt'),0);
  h.run("padControls.select(5);padControls.bind('keyboard')");const next=await harness({storage});assert.equal(next.run('padControls.config.bindings.keyboard'),5);assert.equal(next.run('padControls.config.bindings.next'),null);assert.equal(next.run('padControls.config.version'),3);
});

test('pointer toggle remains reversible by a native mouse click on its own button',async()=>{
  const h=await harness();h.run('togglePointer()');
  h.documentEvent({type:'pointerdown',target:h.document.getElementById('pointerToggle'),isTrusted:true});assert.equal(h.run('pilot.pointerMode'),true);
  h.document.getElementById('pointerToggle').onclick();assert.equal(h.run('pilot.pointerMode'),false);
});

test('Alt K and Alt M provide real keyboard access inside a modal without typing into its field',async()=>{
  const h=await harness();h.run("newThreadDialog();document.dispatchEvent(new Event('keydown',{key:'k',altKey:true}))");assert.equal(h.run('pilot.isKeyboardOpen()'),true);
  h.run("document.dispatchEvent(new Event('keydown',{key:'m',altKey:true}));document.dispatchEvent(new Event('keydown',{key:'m',altKey:true}))");assert.equal(h.run('pilot.pointerMode'),false);
  assert.equal(h.run('pilot.keyboardTarget.value'),'');h.run("document.dispatchEvent(new Event('keydown',{key:'k',altKey:true}))");assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.document.getElementById('modal').open,true);assert.equal(h.calls.length,0);
});

test('switching tasks closes temporary desktop modes and stores the edited old draft',async()=>{
  const h=await harness();h.run("state.selected='old';$('prompt').value='原稿';toggleKeyboard();pilot.keyInput('text','q')");h.respond({thread:{id:'new',turns:[]}});await h.run("selectThread('new')");
  assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.run('pilot.pointerMode'),false);assert.equal(h.run("state.drafts.get('old')"),'原稿q');assert.equal(h.document.getElementById('prompt').value,'');
});

test('large selected drafts have a bounded preview without truncating or exposing the real value',async()=>{
  const h=await harness();h.run("$('prompt').value='x'.repeat(10000);toggleKeyboard();pilot.keyInput('select')");
  assert.ok(h.document.getElementById('keyboardPreview').textContent.length<=181);assert.equal(h.document.getElementById('prompt').value.length,10000);
  h.run("pilot.keyInput('text','short')");assert.equal(h.document.getElementById('prompt').value,'short');assert.equal(h.calls.length,0);
});

test('IME composition hands the original editor back to the native input method',async()=>{
  for(const event of [{key:'Process'},{key:'Unidentified',keyCode:229},{key:'x',isComposing:true}]){
    const h=await harness();h.context.ime=event;h.run("$('prompt').value='保留中文';toggleKeyboard();globalThis.compositionKey=new Event('keydown',ime);$('desktopKeyboard').dispatchEvent(compositionKey)");
    assert.equal(h.run('pilot.isKeyboardOpen()'),false);assert.equal(h.document.activeElement,h.document.getElementById('prompt'));assert.equal(h.document.getElementById('prompt').value,'保留中文');assert.notEqual(h.run('compositionKey.defaultPrevented'),true);
  }
});

test('continuous voice RT tap survives release and a second press finishes the same session',async()=>{
  const h=await harness();fixturePad(h);
  h.run("globalThis.starts=0;globalThis.stops=0;window.SpeechRecognition=class{start(){starts++}stop(){stops++}abort(){}};state.voiceConsent=true;state.selected='t';$('prompt').value='已有草稿';pad.buttons[7]={value:1,pressed:true};gamepad();globalThis.r=state.recognition;pad.buttons[7]={value:0,pressed:false};gamepad()");
  h.tick(141);h.run('gamepad()');assert.equal(h.run('state.recording'),true);assert.equal(h.run('stops'),0);
  h.run('r.onstart();r.onaudiostart()');h.tick(45000);h.run('gamepad()');
  assert.equal(h.run('state.recording'),true);assert.equal(h.run('starts'),1);assert.equal(h.document.getElementById('voiceElapsed').textContent,'00:45 / 03:00');
  h.run("r.onresult({results:[Object.assign([{transcript:'第一句话'}],{isFinal:true})]});pad.buttons[7]={value:1,pressed:true};gamepad();gamepad()");
  assert.equal(h.run('stops'),1);assert.equal(h.run('state.recording'),false);
  h.run("r.onresult({results:[Object.assign([{transcript:'第一句话和尾句'}],{isFinal:true})]});r.onend()");
  assert.equal(h.document.getElementById('prompt').value,'已有草稿\n第一句话和尾句');assert.equal(h.timers.size,0);assert.equal(h.calls.length,0);
});

test('continuous voice screen click is a native toggle rather than pointer or key release',async()=>{
  const h=await harness();h.run("globalThis.stops=0;window.SpeechRecognition=class{start(){}stop(){stops++}abort(){}};state.voiceConsent=true");
  const button=h.document.getElementById('voice');button.click();
  button.dispatchEvent({type:'pointerup'});button.dispatchEvent({type:'lostpointercapture'});button.dispatchEvent({type:'keyup',key:'Enter'});
  assert.equal(h.run('state.recording'),true);assert.equal(h.run('stops'),0);assert.equal(button.getAttribute('aria-pressed'),'true');
  button.click();assert.equal(h.run('stops'),1);h.tick(1500);assert.equal(h.timers.size,0);
  assert.match(h.document.getElementById('voiceCapture').textContent,/尚未开始采音.*再次按键结束/);
  assert.equal(h.document.getElementById('voicePanel').classList.contains('hidden'),false);
});

test('continuous voice only marks the microphone open on an actual capture event',async()=>{
  const h=await harness();h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;startVoice();state.recognition.onstart()");
  assert.equal(h.document.getElementById('voicePanel').dataset.phase,'connecting');assert.equal(h.document.getElementById('voicePanel').dataset.capturing,'false');
  assert.equal(h.document.getElementById('voice').classList.contains('recording'),false);assert.match(h.document.getElementById('voiceCapture').textContent,/尚未开始采音/);
  h.run('state.recognition.onaudiostart()');
  assert.equal(h.document.getElementById('voicePanel').dataset.phase,'listening');assert.equal(h.document.getElementById('voicePanel').dataset.capturing,'true');
  assert.equal(h.document.getElementById('voice').classList.contains('recording'),true);assert.match(h.document.getElementById('voiceCapture').textContent,/麦克风已打开/);
  h.run('state.recognition.onaudioend()');assert.equal(h.document.getElementById('voicePanel').dataset.capturing,'false');assert.equal(h.run('state.recording'),true);
});

test('continuous voice stalled microphone startup has a concrete timeout not an empty transcript',async()=>{
  const h=await harness();h.run("globalThis.aborts=0;window.SpeechRecognition=class{start(){}stop(){}abort(){aborts++}};state.voiceConsent=true;startVoice();state.recognition.onstart()");
  h.tick(11999);assert.equal(h.run('state.recording'),true);h.tick(1);
  assert.equal(h.run('state.recording'),false);assert.equal(h.run('aborts'),1);assert.equal(h.timers.size,0);
  assert.equal(h.document.getElementById('voicePanel').dataset.phase,'error');assert.match(h.document.getElementById('error').textContent,/audio-timeout/);
  assert.match(h.document.getElementById('voiceCapture').textContent,/尚未开始采音.*audio-timeout/);
});

test('continuous voice healthy quiet capture can pause and resume beyond twenty seconds',async()=>{
  const h=await harness();h.run("globalThis.starts=0;window.SpeechRecognition=class{start(){starts++}stop(){}abort(){}};state.voiceConsent=true;state.selected='t';startVoice();state.recognition.onresult({results:[Object.assign([{transcript:'先记住这句话'}],{isFinal:true})]})");
  for(let i=0;i<6;i++){
    h.run('state.recognition.onstart();state.recognition.onaudiostart()');h.tick(8000);
    h.run("state.recognition.onerror({error:'no-speech'});state.recognition.onaudioend();state.recognition.onend()");h.tick(250);
  }
  assert.equal(h.run('state.recording'),true);assert.equal(h.run('state.issues.size'),0);assert.equal(h.document.getElementById('prompt').value,'先记住这句话');
  h.run("state.recognition.onresult({results:[Object.assign([{transcript:'接着补充'}],{isFinal:true})]})");
  assert.equal(h.document.getElementById('prompt').value,'先记住这句话接着补充');assert.equal(h.run('starts'),7);assert.equal(h.calls.length,0);
});

test('continuous voice audio end without service end is bounded and preserves its transcript',async()=>{
  const h=await harness();h.run("globalThis.starts=0;globalThis.aborts=0;window.SpeechRecognition=class{start(){starts++}stop(){}abort(){aborts++}};state.voiceConsent=true;startVoice();globalThis.old=state.recognition;old.onaudiostart();old.onresult({results:[[{transcript:'保留前句'}]]});old.onaudioend()");
  h.tick(1999);assert.equal(h.run('starts'),1);h.tick(1);assert.equal(h.run('aborts'),1);h.tick(250);assert.equal(h.run('starts'),2);
  h.run("old.onaudiostart();old.onresult({results:[[{transcript:'过期结果'}]]});old.onend()");assert.equal(h.document.getElementById('prompt').value,'保留前句');assert.equal(h.document.getElementById('voicePanel').dataset.capturing,'false');
});

test('continuous voice silent capture still ends at three minutes and releases resources',async()=>{
  const h=await harness();h.run("globalThis.stops=0;window.SpeechRecognition=class{start(){}stop(){stops++}abort(){}};state.voiceConsent=true;startVoice();state.recognition.onaudiostart()");
  h.tick(179999);assert.equal(h.run('state.recording'),true);h.tick(1);assert.equal(h.run('stops'),1);h.tick(1500);
  assert.equal(h.run('state.recording'),false);assert.equal(h.run('state.voiceController.audioActive'),false);assert.equal(h.run('state.voiceController.reason'),'limit');assert.equal(h.timers.size,0);
  assert.match(h.document.getElementById('voiceCapture').textContent,/达到 3 分钟上限/);
});

test('continuous voice records a foreground exit reason and clears capture state',async()=>{
  const h=await harness();h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;startVoice();state.recognition.onaudiostart()");
  h.windowEvent('blur');h.run('state.recognition.onaudioend();state.recognition.onend()');
  assert.equal(h.run('state.recording'),false);assert.match(h.document.getElementById('voiceCapture').textContent,/页面失去焦点/);assert.equal(h.document.getElementById('voicePanel').dataset.capturing,'false');
  assert.equal(h.document.getElementById('voicePanel').classList.contains('hidden'),false);assert.equal(h.timers.size,0);
});

test('continuous voice stop and restart invalidates startup and audio-end timers from the previous session',async()=>{
  const h=await harness();h.run("globalThis.aborts=0;window.SpeechRecognition=class{start(){}stop(){}abort(){aborts++}};state.voiceConsent=true;startVoice();globalThis.old=state.recognition;old.onaudiostart();old.onaudioend();toggleVoice();toggleVoice();globalThis.fresh=state.recognition;fresh.onaudiostart()");
  h.tick(15000);h.run('old.onend();old.onaudiostart()');
  assert.equal(h.run('state.recognition===fresh'),true);assert.equal(h.run('state.recording'),true);assert.equal(h.run('state.voiceController.audioActive'),true);
  h.run('cancelVoice()');assert.equal(h.timers.size,0);
});

test('browser timer receivers let RT enter audio capture and finalize without a controller fault',async()=>{
  const h=await harness();fixturePad(h);
  h.run("globalThis.starts=0;globalThis.stops=0;window.SpeechRecognition=class{start(){starts++}stop(){stops++}abort(){}};state.voiceConsent=true;pad.buttons[7]={value:1,pressed:true};gamepad()");
  assert.equal(h.run('starts'),1);assert.equal(h.run('state.recording'),true);assert.equal(h.document.getElementById('voicePanel').dataset.phase,'starting');
  h.run('state.recognition.onstart();state.recognition.onaudiostart();pad.buttons[7]={value:0,pressed:false};gamepad()');h.tick(141);h.run('gamepad()');
  assert.equal(h.document.getElementById('voicePanel').dataset.capturing,'true');assert.equal(h.run('state.recording'),true);
  h.tick(2000);h.run('pad.buttons[7]={value:1,pressed:true};gamepad()');assert.equal(h.run('stops'),1);h.tick(1500);
  assert.equal(h.run('state.voiceController.reason'),'toggle');assert.equal(h.timers.size,0);assert.equal(h.run('state.padError'),undefined);assert.equal(h.calls.length,0);
});

test('browser timer receivers clear pending recognition restarts and never resurrect cancelled capture',async()=>{
  const h=await harness();h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;startVoice();state.recognition.onaudiostart();state.recognition.onend()");
  assert.equal(h.run("state.voiceController.timers.has('restart')"),true);h.run('cancelVoice()');h.tick(180000);
  assert.equal(h.run('state.recording'),false);assert.equal(h.timers.size,0);
  h.run('startVoice();state.recognition.onaudiostart();stopVoice();cancelVoice()');assert.equal(h.timers.size,0);
});

test('controller runtime exceptions report their actual cause and retain voice drafts',async()=>{
  const h=await harness();fixturePad(h);const warnings=[];h.context.console={...console,warn:(...args)=>warnings.push(args)};
  h.run("window.SpeechRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;state.selected='t';getVoice();state.voiceController.schedule=(fn,delay)=>setTimeout(fn,delay);state.voiceController.unschedule=id=>clearTimeout(id);startVoice('gamepad');state.recognition.onaudiostart();state.recognition.onresult({results:[[{transcript:'保留语音草稿'}]]});pilot.navigation=()=>{throw new TypeError('navigation fixture')};gamepad()");
  assert.equal(h.run('state.recording'),false);assert.equal(h.run('state.voiceController.reason'),'controller-error');
  assert.match(h.document.getElementById('voiceCapture').textContent,/手柄交互异常：TypeError: navigation fixture/);
  assert.match(h.document.getElementById('padVoiceStatus').textContent,/TypeError: navigation fixture/);assert.equal(h.document.getElementById('prompt').value,'保留语音草稿');
  h.tick(1500);assert.equal(h.timers.size,0);assert.equal(warnings.length,1);assert.equal(h.calls.length,0);
});

test('offline RT uses local capture without browser SpeechRecognition and keeps release non-terminal',async()=>{
  const h=await harness();fixturePad(h);
  h.run("state.voiceEngine='local';navigator.mediaDevices={getUserMedia(){}};window.AudioContext=class{};window.AudioWorkletNode=class{};globalThis.localStarts=0;window.ControllerLocalRecognition=class{start(){localStarts++}stop(){}abort(){}};state.voiceConsent=true;pad.buttons[7]={value:1,pressed:true};gamepad();state.recognition.onstart();state.recognition.onaudiostart();pad.buttons[7]={value:0,pressed:false};gamepad()");
  h.tick(141);h.run('gamepad()');assert.equal(h.run('localStarts'),1);assert.equal(h.run('state.recording'),true);assert.match(h.document.getElementById('voiceCapture').textContent,/Fun-ASR-Nano 本地模型.*麦克风已打开/);assert.equal(h.run('state.voiceController.finalizeMs'),25000);
  h.run('cancelVoice()');assert.equal(h.timers.size,0);
});

test('offline consent and diagnostics describe local processing and do not acquire a microphone',async()=>{
  const h=await harness();h.run("state.voiceEngine='local';globalThis.mediaCalls=0;navigator.mediaDevices={getUserMedia(){mediaCalls++}};window.AudioContext=class{};window.AudioWorkletNode=class{};startVoice()");
  assert.match(h.document.getElementById('modalBody').textContent,/音频仅通过本机地址/);assert.equal(h.run('mediaCalls'),0);
  h.run("$('modal').close()");h.respond({available:true,ready:true,culture:'zh-CN',engine:'Fun-ASR-Nano',device:'cuda'});await h.run('voiceDiagnostics()');
  assert.match(h.document.getElementById('modalBody').textContent,/Fun-ASR-Nano 本地模型.*模型已就绪/);assert.equal(h.run('mediaCalls'),0);
});

test('local model cold preparation survives twelve seconds but remains bounded and cancellable',async()=>{
  const h=await harness();h.run("state.voiceEngine='local';navigator.mediaDevices={getUserMedia(){}};window.AudioContext=class{};window.AudioWorkletNode=class{};window.ControllerLocalRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;startVoice()");
  h.tick(14000);assert.equal(h.run('state.recording'),true);assert.match(h.document.getElementById('voicePhase').textContent,/准备本地中文模型/);
  h.tick(76000);assert.equal(h.run('state.recording'),false);assert.equal(h.run('state.voiceController.reason'),'audio-timeout');assert.equal(h.timers.size,0);
});

test('silent PCM shows an actionable input warning instead of pretending sound was detected',async()=>{
  const h=await harness();h.run("state.voiceEngine='local';navigator.mediaDevices={getUserMedia(){}};window.AudioContext=class{};window.AudioWorkletNode=class{};window.ControllerLocalRecognition=class{start(){}stop(){}abort(){}};state.voiceConsent=true;startVoice();state.recognition.onaudiostart();state.recognition.oninput({device:'USB microphone',samples:80000,rms:0,maxRms:0,maxPeak:0})");
  assert.match(h.document.getElementById('voicePhase').textContent,/输入无信号/);assert.match(h.document.getElementById('voiceCapture').textContent,/USB microphone.*无信号/);assert.equal(h.run('state.recording'),true);
  h.run("state.recognition.oninput({device:'USB microphone',samples:90000,rms:.1,maxRms:.1,maxPeak:3276})");
  assert.match(h.document.getElementById('voiceCapture').textContent,/-20 dBFS/);assert.match(h.document.getElementById('voicePhase').textContent,/持续收音中/);
  h.run('cancelVoice()');assert.equal(h.timers.size,0);
});

test('microphone selection enumerates without capture and applies only on the next explicit start',async()=>{
  const h=await harness();h.run("state.voiceEngine='local';globalThis.mediaCalls=0;navigator.mediaDevices={getUserMedia(){mediaCalls++},enumerateDevices:async()=>[{kind:'audioinput',deviceId:'usb',label:'USB microphone'},{kind:'audiooutput',deviceId:'speaker',label:'Speakers'}]};window.AudioContext=class{};window.AudioWorkletNode=class{};window.ControllerLocalRecognition=class{constructor(options){this.device=options.deviceId}start(){}stop(){}abort(){}}");
  h.respond({available:true,ready:true,culture:'zh-CN'});await h.run('voiceDiagnostics()');
  const select=h.document.getElementById('modalBody').children.find(n=>n.tagName==='LABEL').children[0];assert.equal(select.children.length,2);select.value='usb';select.onchange();
  assert.equal(h.run('mediaCalls'),0);assert.equal(h.run('state.recording'),false);h.run("$('modal').close();state.voiceConsent=true;startVoice()");assert.equal(h.run('state.recognition.device'),'usb');h.run('cancelVoice()');
});
