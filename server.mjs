import http from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {LocalSpeech} from './scripts/local-speech.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
// Never let Windows cmd.exe search the selected project for an executable.
export function resolveLaunch(command,args,env,platform=process.platform,exists=existsSync){
  if(platform!=='win32')return {command,args};
  if(!['codex','codex.cmd'].includes(command.toLowerCase())){
    if(!path.win32.isAbsolute(command)||!/\.exe$/i.test(command))throw new Error('Windows CODEX_BIN 必须是 codex.exe 的绝对路径');
    return {command,args};
  }
  const pathValue=Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]||'';
  for(let dir of pathValue.split(';')){
    dir=dir.replace(/^"|"$/g,'');
    if(!path.win32.isAbsolute(dir))continue;
    const exe=path.win32.join(dir,'codex.exe');
    if(exists(exe))return {command:exe,args};
    const js=path.win32.join(dir,'node_modules','@openai','codex','bin','codex.js');
    if(exists(js))return {command:process.execPath,args:[js,...args]};
  }
  throw new Error('在绝对 PATH 目录中找不到 Codex。请安装官方 Codex CLI 或设置 CODEX_BIN 为 codex.exe 的绝对路径');
}
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const SUPPORTED_REQUESTS=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput']);
export function validateResponse(request,result){
  if(!isObject(result))throw new Error('审批结果必须是对象');
  if(request.method==='item/commandExecution/requestApproval'||request.method==='item/fileChange/requestApproval'){
    if(Object.keys(result).some(k=>k!=='decision')||!['accept','decline','cancel'].includes(result.decision))throw new Error('仅允许单次接受、拒绝或取消');
  } else if(request.method==='item/tool/requestUserInput'){
    if(Object.keys(result).some(k=>k!=='answers')||!isObject(result.answers))throw new Error('回答格式无效');
    const questions=new Set((request.params?.questions||[]).map(q=>q.id));
    for(const [id,value] of Object.entries(result.answers))if(!questions.has(id)||!isObject(value)||Object.keys(value).some(k=>k!=='answers')||!Array.isArray(value.answers)||value.answers.some(x=>typeof x!=='string'))throw new Error('回答格式无效');
  } else throw new Error('此请求类型不支持网页审批，请使用官方 Codex');
}
export class CodexBridge extends EventEmitter {
  constructor({command=process.env.CODEX_BIN||'codex',args=['app-server','--stdio'],cwd=process.env.CODEX_WORKSPACE||process.cwd(),env=process.env}={}) {super();Object.assign(this,{command,args,cwd,env});this.seq=0;this.pending=new Map();this.requests=new Map();this.connected=false;this.error=null;this.account=null;this.child=null;this.connectionId=null;this.startPromise=null;this.reconnectPromise=null;}
  emitEvent(method,params){this.emit('event',{method,params});}
  start(){
    if(this.startPromise)return this.startPromise;
    if(this.child)return Promise.resolve();
    const operation=this.startChild();this.startPromise=operation;
    operation.finally(()=>{if(this.startPromise===operation)this.startPromise=null;});
    return operation;
  }
  async startChild(){
    this.error=null;this.account=null;this.version=null;this.requiresOpenaiAuth=null;
    let child;
    try {
      const launch=resolveLaunch(this.command,this.args,this.env);
      child=spawn(launch.command,launch.args,{cwd:this.cwd,env:this.env,stdio:['pipe','pipe','pipe'],windowsHide:true});this.child=child;this.connectionId=randomUUID();
      child.on('error',e=>this.disconnected(`无法启动 Codex：${e.message}`,child));
      child.on('exit',(code,signal)=>this.disconnected(`Codex 已断开 (${signal||code})`,child));
      child.stdin.on('error',e=>this.disconnected(`Codex 写入失败：${e.message}`,child));
      child.stderr.on('data',()=>{});
      createInterface({input:child.stdout}).on('line',line=>{if(this.child!==child)return;try{this.receive(JSON.parse(line));}catch{}});
      const version=await this.rpc('initialize',{clientInfo:{name:'codex_controller',title:'Codex Controller',version:'1.0.0'},capabilities:{experimentalApi:false,requestAttestation:false,explicitGatewayOauth:true}},15000);
      if(this.child!==child)return;
      this.version=version;this.write({method:'initialized'});this.connected=true;
      const a=await this.rpc('account/read',{refreshToken:false});
      if(this.child!==child)return;
      this.account=a.account;this.requiresOpenaiAuth=a.requiresOpenaiAuth;
      this.emitEvent('bridge/status',this.status());
    } catch(e){
      if(child&&this.child!==child)return;
      if(child){this.disconnected(e.message,child);child.kill();}
      else {this.error=e.message;this.emitEvent('bridge/status',{connected:false,error:this.error});}
    }
  }
  disconnected(error,child){if(this.child!==child)return;this.child=null;this.connectionId=null;this.connected=false;this.error=error;this.account=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(error));}this.pending.clear();this.requests.clear();this.emitEvent('bridge/status',{connected:false,error});}
  write(msg){if(!this.child?.stdin.writable)throw new Error('Codex 未连接');this.child.stdin.write(JSON.stringify(msg)+'\n');}
  rpc(method,params={},timeout=60000){const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} 超时；操作可能仍在进行，请刷新状态，不要重复提交。`));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.write({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
  receive(msg){
    if(!isObject(msg))return;
    if(msg.method && msg.id!==undefined){
      if(!SUPPORTED_REQUESTS.has(msg.method)){this.write({id:msg.id,error:{code:-32601,message:'Unsupported request: use the official Codex client'}});return;}
      const request={...msg,connectionId:this.connectionId};this.requests.set(msg.id,request);this.emitEvent('server/request',request);return;
    }
    if(msg.id!==undefined){const p=this.pending.get(msg.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message||JSON.stringify(msg.error))):p.resolve(msg.result);return;}
    if(msg.method){
      if(msg.method==='serverRequest/resolved')this.requests.delete(msg.params?.requestId);
      if(msg.method==='account/updated'&&this.connected){const child=this.child;this.rpc('account/read',{refreshToken:false}).then(a=>{if(this.child!==child)return;this.account=a.account;this.requiresOpenaiAuth=a.requiresOpenaiAuth;this.emitEvent('bridge/status',this.status());}).catch(()=>{});}
      this.emitEvent(msg.method,msg.params);
    }
  }
  respond(id,result,connectionId){if(!connectionId||connectionId!==this.connectionId)throw new Error('连接已改变，请刷新审批请求');const request=this.requests.get(id);if(!request)throw new Error('审批请求不存在或已处理');validateResponse(request,result);this.write({id,result});this.requests.delete(id);this.emitEvent('bridge/requestResolved',{id,connectionId});}
  async stop(){const child=this.child;if(child){const closed=new Promise(resolve=>child.once('close',resolve));this.disconnected('连接已重启',child);child.kill();await closed;}const pending=this.startPromise;if(pending)await pending;}
  reconnect(){if(this.reconnectPromise)return this.reconnectPromise;const operation=(async()=>{await this.stop();await this.start();})();this.reconnectPromise=operation;operation.finally(()=>{if(this.reconnectPromise===operation)this.reconnectPromise=null;});return operation;}
  status(){return {connected:this.connected,connectionId:this.connectionId,error:this.error,account:this.account,requiresOpenaiAuth:this.requiresOpenaiAuth,version:this.version,defaultCwd:this.cwd,pendingRequests:[...this.requests.values()]};}
}
const ALLOWED=new Set(['account/read','account/login/start','account/login/cancel','thread/list','thread/read','thread/start','thread/resume','turn/start','turn/steer','turn/interrupt','model/list']);
const FIELDS={
  'account/read':['refreshToken'], 'account/login/start':['type'], 'account/login/cancel':['loginId'],
  'thread/list':['cursor','limit','sortKey','sortDirection','modelProviders','sourceKinds','archived','cwd','searchTerm'],
  'thread/read':['threadId','includeTurns'],
  'thread/start':['cwd','model','approvalPolicy','approvalsReviewer','sandbox'],
  'thread/resume':['threadId','cwd','model','approvalPolicy','approvalsReviewer','sandbox'],
  'turn/start':['threadId','input','cwd','model','effort','approvalPolicy','approvalsReviewer'],
  'turn/steer':['threadId','input','expectedTurnId'], 'turn/interrupt':['threadId','turnId'],
  'model/list':['cursor','limit','includeHidden']
};
export function validateRpc(method,params){
  if(!isObject(params))throw new Error('参数必须是对象');
  if(!ALLOWED.has(method))throw new Error('此方法未开放');
  if(Object.keys(params).some(key=>!FIELDS[method].includes(key)))throw new Error('包含未开放的参数');
  if(method==='account/login/start' && params.type!=='chatgpt')throw new Error('此应用只接受官方 ChatGPT 登录；不接收密钥');
  if(['thread/start','thread/resume','turn/start'].includes(method)){
    if(params.approvalPolicy && params.approvalPolicy!=='on-request')throw new Error('必须保留 Codex 请求审批');
    if(params.sandbox && !['workspace-write','read-only'].includes(params.sandbox))throw new Error('不允许关闭沙箱');
    if(params.sandboxPolicy || params.config)throw new Error('不能通过界面修改安全配置');
    params.approvalPolicy='on-request';params.approvalsReviewer='user';
    if(method!=='turn/start')params.sandbox=params.sandbox||'workspace-write';
  }
}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>1024*1024)throw new Error('请求过大');}return JSON.parse(s||'{}');}
export function createServer(bridge,{speech=new LocalSpeech()}={}){
  const clients=new Set();const listener=event=>{for(const res of clients)res.write('data: '+JSON.stringify(event)+'\n\n');};bridge.on('event',listener);
  const server=http.createServer(async(req,res)=>{
    const host=req.headers.host;const local=/^(127\.0\.0\.1|localhost):\d+$/.test(host||'');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    if(!local){json({error:'仅允许本机访问'},403);return;}
    const audioPost=/^\/api\/voice\/[a-f0-9-]{36}\/audio\?sequence=\d+$/.test(req.url)&&req.headers['content-type']==='application/octet-stream';
    if(req.method==='POST' && (req.headers.origin!==`http://${host}` || !(audioPost||req.headers['content-type']?.startsWith('application/json')))){json({error:'跨站请求已阻止'},403);return;}
    try{
      const u=new URL(req.url,`http://${host}`);
      if(u.pathname==='/api/events'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write('data: '+JSON.stringify({method:'bridge/status',params:bridge.status()})+'\n\n');clients.add(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),20000);req.on('close',()=>{clients.delete(res);clearInterval(heartbeat);});return;}
      if(u.pathname==='/api/status'&&req.method==='GET'){json(bridge.status());return;}
      if(u.pathname==='/api/voice/status'&&req.method==='GET'){json(await speech.probe());return;}
      if(u.pathname==='/api/voice/prepare'&&req.method==='POST'){await body(req);json(await speech.prepare());return;}
      if(u.pathname==='/api/voice/start'&&req.method==='POST'){await body(req);json(await speech.start());return;}
      const voice=u.pathname.match(/^\/api\/voice\/([a-f0-9-]{36})\/(events|audio|end|cancel)$/);
      if(voice){
        const [,id,operation]=voice;
        if(operation==='events'&&req.method==='GET'){speech.subscribe(id,res);return;}
        if(req.method==='POST'){
          if(operation==='audio'){
            let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('音频请求过大');chunks.push(chunk);}
            json(await speech.write(id,Number(u.searchParams.get('sequence')),Buffer.concat(chunks)));return;
          }
          if(operation==='end'||operation==='cancel'){await body(req);json(speech[operation](id));return;}
        }
        json({error:'Not found'},404);return;
      }
      if(u.pathname==='/api/rpc'&&req.method==='POST'){const {method,params={}}=await body(req);validateRpc(method,params);const result=await bridge.rpc(method,params);if(method==='account/read')bridge.account=result.account;json(result);return;}
      if(u.pathname==='/api/respond'&&req.method==='POST'){const {id,result,connectionId}=await body(req);bridge.respond(id,result,connectionId);json({ok:true});return;}
      if(u.pathname==='/api/reconnect'&&req.method==='POST'){await body(req);await bridge.reconnect();json(bridge.status());return;}
      if(req.method!=='GET'){json({error:'Not found'},404);return;}
      const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/voice-worklet.js':'voice-worklet.js','/style.css':'style.css','/styles.css':'styles.css'};const file=files[u.pathname];if(!file){json({error:'Not found'},404);return;}
      const data=await readFile(path.join(ROOT,'public',file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(data);
    }catch(e){json({error:e.message,code:e.code},400);}
  });server.on('close',()=>{speech.close();bridge.off('event',listener);for(const c of clients)c.end();});return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const bridge=new CodexBridge(),speech=new LocalSpeech();const server=createServer(bridge,{speech});const port=Number(process.env.PORT||4318);
 server.listen(port,'127.0.0.1',()=>{console.log(`Codex Controller: http://127.0.0.1:${port}`);bridge.start();speech.probe().then(c=>c.available?speech.warm():null).catch(e=>console.warn('Voice preparation:',e.message));});
 server.on('error',e=>{console.error(e.message);process.exitCode=1;});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await bridge.stop();server.close(()=>process.exit());server.closeAllConnections();});
}
