import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFileSync} from 'node:fs';

const fault=(message,code='local-speech')=>Object.assign(new Error(message),{code});
const root=fileURLToPath(new URL('../',import.meta.url));
export class LocalSpeech {
  constructor({spawnProcess=spawn,python=process.env.LOCAL_SPEECH_PYTHON,idleMs=10000,maxMs=180000}={}){Object.assign(this,{spawnProcess,python,idleMs,maxMs});}
  launch(mode){
    const command=this.python||JSON.parse(readFileSync(path.join(root,'.voice-runtime/python.json'),'utf8')).executable;
    if(typeof command!=='string'||!path.isAbsolute(command))throw fault('请先配置本地语音 Python 的绝对路径','local-unavailable');
    return this.spawnProcess(command,['-u',fileURLToPath(new URL('neural-speech.py',import.meta.url)),mode],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
  }
  probe(){
    const probing=this.probing??=new Promise(resolve=>{
      let child,output='',settled=false;
      const done=value=>{if(settled)return;settled=true;clearTimeout(timer);child?.kill();resolve(value);};
      const timer=setTimeout(()=>done({available:false,message:'本地识别引擎检测超时'}),10000);
      try{
        child=this.launch('probe');child.on('error',e=>done({available:false,message:e.message}));
        child.stdout.on('data',b=>{output+=b;if(output.length>16384)done({available:false,message:'本地引擎返回过大'});});child.stderr.resume();
        child.on('close',()=>{try{done(JSON.parse(output.trim()));}catch{done({available:false,message:'本地中文识别引擎未就绪'});}});
      }catch(e){done({available:false,message:e.message});}
    });return probing.then(value=>({...value,ready:!!this.worker?.ready,...this.worker?.capability,capture:this.session?{...this.session.metrics,active:true}:this.lastCapture}));
  }
  warm(){
    if(this.closed)return Promise.reject(fault('本地语音服务已经关闭'));
    if(this.warming)return this.warming;
    this.warming=new Promise((resolve,reject)=>{
      let child;try{child=this.launch('serve');}catch(e){reject(e);return;}
      const worker=this.worker={child,ready:false};
      const fail=e=>{
        if(worker.closed)return;worker.closed=true;clearTimeout(worker.timer);child.kill();
        if(this.worker===worker){this.worker=null;this.warming=null;}
        reject(e);if(this.session)this.finish(this.session,{type:'error',code:e.code||'local-engine',message:e.message});
      };worker.fail=fail;
      worker.timer=setTimeout(()=>fail(fault('中文模型准备超时，请查看本机模型与显卡状态','local-loading')),80000);
      child.stdin.on('error',fail);child.stderr.resume();child.on('error',fail);
      child.on('exit',code=>fail(fault(`中文模型进程提前结束 (${code})`)));
      createInterface({input:child.stdout}).on('line',line=>{
        if(worker.closed)return;
        let event;try{if(line.length>16384)throw new Error();event=JSON.parse(line);}catch{fail(fault('本地模型返回格式错误'));return;}
        if(!event.sessionId){
          if(event.type==='ready'){worker.ready=true;worker.capability={device:event.device,engine:event.engine};clearTimeout(worker.timer);resolve();}
          else if(event.type==='error')fail(fault(event.message,event.code));
          return;
        }
        const s=this.session;if(!s||event.sessionId!==s.id)return;
        if(event.type==='ready'){
          clearTimeout(s.startTimer);s.ready=true;s.lastAudio=Date.now();s.resolve({sessionId:s.id,...s.capability,...worker.capability,ready:true,capture:{...s.metrics,active:true}});
          s.deadline=setTimeout(()=>this.end(s.id),this.maxMs);
          s.idle=setInterval(()=>{if(!s.stopping&&Date.now()-s.lastAudio>this.idleMs)this.finish(s,{type:'error',code:'local-idle',message:'未再收到浏览器音频，会话已释放。'});},1000);
        }
        if(event.type==='end'||event.type==='error')this.finish(s,event,false);else this.publish(s,event);
      });
    });
    // Reset a synchronous launch failure as well, so installing/configuring then retrying works.
    this.warming.catch(()=>{if(!this.worker)this.warming=null;});return this.warming;
  }
  async prepare(){const capability=await this.probe();if(!capability.available)throw fault(capability.message||'本地中文模型未安装','local-unavailable');await this.warm();return this.probe();}
  send(kind,payload){
    const child=this.worker?.child;if(!child) return Promise.reject(fault('本地模型进程尚未就绪'));
    const data=Buffer.isBuffer(payload)?payload:Buffer.from(JSON.stringify(payload));
    const header=Buffer.alloc(5);header.writeUInt8(kind);header.writeUInt32LE(data.length,1);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(fault('本地模型未及时接收音频','local-backpressure')),5000);
      child.stdin.write(Buffer.concat([header,data]),e=>{clearTimeout(timer);e?reject(e):resolve();});
    });
  }
  async start(){
    const capability=await this.probe();if(!capability.available)throw fault(capability.message||'本地中文识别引擎未安装','local-unavailable');
    if(this.session)throw fault('另一段本地语音正在收音或完成转写，请先结束它。','local-busy');
    const s={id:randomUUID(),capability,clients:new Set(),history:[],nextSequence:0,bytes:0,finished:false,metrics:{bytes:0,rms:0,maxRms:0,maxPeak:0,speechStarts:0,hypotheses:0,results:0}};this.session=s;
    const ready=new Promise((resolve,reject)=>{s.resolve=resolve;s.reject=reject;});
    this.warm().then(()=>{
      if(s.finished)return;
      s.startTimer=setTimeout(()=>this.finish(s,{type:'error',message:'本地模型会话启动超时'}),10000);
      return this.send(0,{type:'start',sessionId:s.id});
    }).catch(e=>this.finish(s,{type:'error',code:e.code,message:e.message}));
    return ready;
  }
  get(id){const s=this.session;if(!s||s.id!==id||s.finished)throw fault('本地语音会话已结束','local-ended');return s;}
  publish(s,event){const field={'speech-start':'speechStarts',hypothesis:'hypotheses',result:'results'}[event.type];if(field)s.metrics[field]++;s.history.push(event);if(s.history.length>128)s.history.shift();for(const res of s.clients)res.write(`data: ${JSON.stringify(event)}\n\n`);}
  subscribe(id,res){
    const s=this.get(id);clearTimeout(s.detached);s.clients.add(res);
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write(': local speech\n\n');
    for(const event of s.history)res.write(`data: ${JSON.stringify(event)}\n\n`);
    const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),10000);
    res.on('close',()=>{clearInterval(heartbeat);s.clients.delete(res);if(!s.finished&&!s.clients.size)s.detached=setTimeout(()=>this.finish(s,{type:'error',code:'local-detached',message:'语音页面已断开，会话已释放。'}),3000);});
  }
  async write(id,sequence,pcm){
    const s=this.get(id);
    if(s.stopping)throw fault('本段收音已经结束','local-ended');
    if(!Buffer.isBuffer(pcm)||pcm.length<2||pcm.length>65536||pcm.length%2)throw fault('音频必须为有界的 16-bit 单声道 PCM','local-format');
    if(!Number.isInteger(sequence)||sequence<0)throw fault('音频序号无效','local-sequence');
    if(sequence===s.nextSequence-1){await s.pending;return {nextSequence:s.nextSequence};}
    if(sequence!==s.nextSequence)throw fault('音频序号不连续','local-sequence');
    if(s.bytes+pcm.length>16000*2*180)throw fault('收音超过 3 分钟上限','local-limit');
    s.nextSequence++;s.bytes+=pcm.length;s.lastAudio=Date.now();
    let sum=0,peak=0;for(let i=0;i<pcm.length;i+=2){const value=pcm.readInt16LE(i);sum+=value*value;peak=Math.max(peak,Math.abs(value));}
    const rms=Math.sqrt(sum/(pcm.length/2))/32768;
    Object.assign(s.metrics,{bytes:s.bytes,rms,maxRms:Math.max(s.metrics.maxRms,rms),maxPeak:Math.max(s.metrics.maxPeak,peak)});
    s.pending=this.send(1,pcm);
    try{await s.pending;}catch(e){this.finish(s,{type:'error',message:e.message});throw e;}
    return {nextSequence:s.nextSequence};
  }
  end(id){const s=this.get(id);if(!s.stopping){s.stopping=true;clearInterval(s.idle);this.send(0,{type:'end',sessionId:id}).catch(e=>this.finish(s,{type:'error',message:e.message}));s.finalize=setTimeout(()=>this.finish(s,{type:'error',code:'local-finalize',message:'本地尾句转写超时，已有文字已保留。'}),20000);}return {ok:true};}
  cancel(id){const s=this.get(id);this.finish(s,{type:'end'});return {ok:true};}
  finish(s,event,cancel=true){
    if(s.finished)return;s.finished=true;
    for(const name of ['startTimer','deadline','idle','finalize','detached'])clearTimeout(s[name]);
    if(!s.ready)s.reject(fault(event.message||'本地识别尚未就绪',event.code));
    this.publish(s,event);for(const res of s.clients)res.end();s.clients.clear();
    this.lastCapture={...s.metrics,active:false,endedAt:Date.now(),reason:event.code||event.type};
    if(this.session===s)this.session=null;
    if(cancel&&this.worker?.ready)this.send(0,{type:'cancel',sessionId:s.id}).catch(()=>{});
  }
  close(){this.closed=true;if(this.session)this.finish(this.session,{type:'end'});this.worker?.fail(fault('本地语音服务已经关闭'));}
}
