import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';import {readFile} from 'node:fs/promises';
import {LocalSpeech} from '../scripts/local-speech.mjs';import {CodexBridge,createServer} from '../server.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function fakeSpeech(){
  const workers=[],launches=[];
  const service=new LocalSpeech({python:process.execPath,spawnProcess:(command,args,options)=>{
    launches.push({command,args,options});const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.chunks=[];
    const emit=event=>{if(!child.killed)child.stdout.write(JSON.stringify(event)+'\n')};
    child.stdin=new Writable({write(chunk,encoding,done){
      assert.equal(chunk.readUInt32LE(1),chunk.length-5);
      if(chunk[0]===1)child.chunks.push(Buffer.from(chunk.subarray(5)));
      else{const control=JSON.parse(chunk.subarray(5));setImmediate(()=>emit({type:control.type==='start'?'ready':'end',sessionId:control.sessionId}));}
      done();
    }});
    child.kill=()=>{child.killed=true;child.stdout.end();};workers.push(child);
    setImmediate(()=>{emit(args.at(-1)==='probe'?{available:true,culture:'zh-CN',engine:'Fun-ASR-Nano',offline:true}:{type:'ready',engine:'Fun-ASR-Nano',device:'cuda'});if(args.at(-1)==='probe')child.emit('close',0)});
    return child;
  }});return {service,workers,launches};
}
test('neural speech reuses one hidden warm process, bounded sequential PCM and a single active session',async()=>{
  const {service,workers,launches}=fakeSpeech();try{
    const {sessionId}=await service.start();assert.equal(launches[1].options.windowsHide,true);assert.ok(!launches[1].args.includes('-ExecutionPolicy'));
    await assert.rejects(service.start(),/另一段/);await service.write(sessionId,0,Buffer.alloc(8));await service.write(sessionId,0,Buffer.alloc(8));
    assert.equal(workers[1].chunks.length,1);await assert.rejects(service.write(sessionId,2,Buffer.alloc(8)),/序号不连续/);
    await assert.rejects(service.write(sessionId,1,Buffer.alloc(3)),/16-bit/);await assert.rejects(service.write(sessionId,1,Buffer.alloc(65538)),/16-bit/);
    service.end(sessionId);await assert.rejects(service.write(sessionId,1,Buffer.alloc(8)),/已经结束/);service.cancel(sessionId);assert.ok(!workers[1].killed);assert.equal(service.session,null);
    const next=await service.start();assert.notEqual(next.sessionId,sessionId);assert.equal(launches.length,2);assert.equal(next.device,'cuda');assert.equal(next.ready,true);assert.equal(next.capture.bytes,0);service.cancel(next.sessionId);
  }finally{service.close()}
});
test('local speech rejects stale session IDs and releases workers on engine errors',async()=>{
  const {service,workers}=fakeSpeech();try{
    const {sessionId}=await service.start();await assert.rejects(service.write('stale',0,Buffer.alloc(8)),/已结束/);
    const events=[],response=new EventEmitter();response.writeHead=()=>{};response.write=value=>events.push(value);response.end=()=>{};
    service.subscribe(sessionId,response);workers[1].stdout.write('{"type":"error","message":"fixture error"}\n');
    assert.equal(service.session,null);assert.equal(workers[1].killed,true);assert.ok(events.some(e=>e.includes('fixture error')));response.emit('close');
  }finally{service.close()}
});
test('local voice HTTP route keeps exact origin and content-type checks',async()=>{
  const id='00000000-0000-4000-8000-000000000000',writes=[];
  const speech={probe:async()=>({available:true,offline:true}),prepare:async()=>({ready:true}),start:async()=>({sessionId:id}),write:async(...args)=>{writes.push(args);return{nextSequence:1}},end:()=>({ok:true}),cancel:()=>({ok:true}),close(){}};
  const server=createServer(new CodexBridge(),{speech});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/api/voice/status')).status,200);
    assert.equal((await fetch(base+'/api/voice/prepare',{method:'POST',headers:{Origin:'http://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/voice/prepare',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,200);
    const route=base+`/api/voice/${id}/audio?sequence=0`,headers={'Content-Type':'application/octet-stream',Origin:base};
    assert.equal((await fetch(route,{method:'POST',headers:{...headers,Origin:'http://evil.example'},body:new Uint8Array(8)})).status,403);
    assert.equal((await fetch(base+'/api/rpc',{method:'POST',headers,body:new Uint8Array(8)})).status,403);
    assert.equal((await fetch(route,{method:'POST',headers,body:new Uint8Array(8)})).status,200);assert.equal(writes.length,1);assert.equal(writes[0][1],0);assert.equal(writes[0][2].length,8);
  }finally{await new Promise(r=>server.close(r))}
});

test('late results from a cancelled session cannot contaminate the next warm session',async()=>{
  const {service,workers}=fakeSpeech();try{
    const old=await service.start();service.cancel(old.sessionId);const fresh=await service.start();
    workers[1].stdout.write(JSON.stringify({type:'result',sessionId:old.sessionId,text:'old'})+'\n');
    assert.equal(service.session.history.some(e=>e.text==='old'),false);
    workers[1].stdout.write(JSON.stringify({type:'result',sessionId:fresh.sessionId,text:'new'})+'\n');
    assert.equal(service.session.history.at(-1).text,'new');
  }finally{service.close()}
});

test('a crashed warm engine releases its session and a retry starts a fresh worker',async()=>{
  const {service,workers}=fakeSpeech();try{
    await service.prepare();assert.equal(service.session,undefined);await service.start();workers[1].emit('exit',7);
    assert.equal(service.session,null);assert.equal(workers[1].killed,true);assert.equal(service.worker,null);
    await service.start();assert.equal(workers.length,3);assert.equal(service.worker.ready,true);
  }finally{service.close()}
});

test('capture diagnostics count actual PCM and recognition events without retaining transcript or stale active state',async()=>{
  const {service,workers}=fakeSpeech();try{
    const {sessionId}=await service.start();const pcm=Buffer.alloc(4);pcm.writeInt16LE(16384);pcm.writeInt16LE(-16384,2);
    await service.write(sessionId,0,pcm);await service.write(sessionId,0,pcm);
    for(const type of ['speech-start','hypothesis','result'])workers[1].stdout.write(JSON.stringify({type,sessionId,text:'private fixture text'})+'\n');
    let capture=(await service.probe()).capture;assert.equal(capture.bytes,4);assert.equal(capture.maxPeak,16384);assert.equal(capture.maxRms,.5);assert.equal(capture.results,1);assert.equal(capture.speechStarts,1);assert.equal(capture.active,true);assert.ok(!JSON.stringify(capture).includes('private'));
    service.cancel(sessionId);capture=(await service.probe()).capture;assert.equal(capture.active,false);assert.equal(capture.results,1);
    const next=await service.start();capture=(await service.probe()).capture;assert.equal(capture.bytes,0);assert.equal(capture.results,0);service.cancel(next.sessionId);
  }finally{service.close()}
});

test('neural segmentation covers silence, pauses, cancellation, limits and fragmented pipe frames',async t=>{
  let config;try{config=JSON.parse(await readFile(new URL('../.voice-runtime/python.json',import.meta.url),'utf8'));}catch{t.skip('local voice runtime is not configured');return;}
  const result=spawnSync(config.executable,[fileURLToPath(new URL('neural-speech.test.py',import.meta.url))],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONUTF8:'1'},timeout:60000});
  assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stderr,/Ran 4 tests/);
});
test('installed neural engine returns correct Chinese text after a long initial pause and progressive PCM',async t=>{
  const service=new LocalSpeech();const capability=await service.probe();if(!capability.available){t.skip(capability.message);return;}
  try{
    const wave=await readFile(new URL('fixtures/chinese.wav',import.meta.url));let pcm;
    for(let offset=12;offset+8<=wave.length;){const size=wave.readUInt32LE(offset+4);if(wave.toString('ascii',offset,offset+4)==='data'){pcm=wave.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
    assert.ok(pcm?.length);const {sessionId}=await service.start();const events=[];
    const response=new EventEmitter();response.writeHead=()=>{};response.write=chunk=>{if(chunk.startsWith('data: '))events.push(JSON.parse(chunk.slice(6)))};
    const ended=new Promise(resolve=>{response.end=()=>{response.emit('close');resolve()}});service.subscribe(sessionId,response);
    let sequence=0;
    for(let seconds=0;seconds<35;seconds++)await service.write(sessionId,sequence++,Buffer.alloc(32000));
    assert.ok(service.session,'a long initial pause must remain a live session');
    for(let offset=0;offset<pcm.length;offset+=8192,sequence++){
      await service.write(sessionId,sequence,pcm.subarray(offset,offset+8192));
      await new Promise(resolve=>setTimeout(resolve,25));
      assert.ok(service.session,'progressive PCM must not look like an early EOF');
    }
    service.end(sessionId);await ended;
    assert.ok(events.some(e=>e.type==='hypothesis'&&e.text));assert.equal(events.filter(e=>e.type==='result').map(e=>e.text).join('').replace(/[^\p{L}\p{N}]/gu,''),'你好这是语音识别测试');assert.equal(events.at(-1).type,'end');assert.equal(service.session,null);
    t.diagnostic('Actual local Fun-ASR-Nano + Silero; synthetic input only; no microphone. This fixture is not a human accuracy benchmark.');
  }finally{service.close()}
});
