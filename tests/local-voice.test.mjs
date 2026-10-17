import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/local-recognition.js',import.meta.url),'utf8');
function harness({media,respond}={}){
  const scope={window:{},AbortController,setTimeout,clearTimeout,console};vm.runInNewContext(source,scope);let stops=0,closes=0,events;
  const calls=[],track={stop(){stops++}},stream={getTracks:()=>[track]},port={postMessage(value){if(value==='flush')port.onmessage({data:{flushed:true}})}};
  const audio={sampleRate:16000,audioWorklet:{addModule:async()=>{}},destination:{},resume:async()=>{},close:async()=>{closes++},createMediaStreamSource:()=>({connect(){},disconnect(){}})};
  const node={port,connect(){},disconnect(){}};
  const recognition=new scope.window.ControllerLocalRecognition({getMedia:()=>media||Promise.resolve(stream),createAudio:()=>audio,createNode:()=>node,
    createEvents:()=>events={close(){}},request:async(url,options)=>{calls.push({url,options});return respond?respond(url,options):{ok:true,json:async()=>url==='/api/voice/start'?{sessionId:'fixture'}:{ok:true}};}});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {recognition,calls,stream,track,port,audio,flush,scope,get events(){return events},get stops(){return stops},get closes(){return closes}};
}
test('offline adapter only reports capture after PCM arrives and revises interim text before final text',async()=>{
  const h=harness(),states=[],texts=[];h.recognition.onstart=()=>states.push('connected');h.recognition.onaudiostart=()=>states.push('capture');h.recognition.onresult=e=>texts.push(e.results.map(r=>r[0].transcript).join(''));
  h.recognition.start();await h.flush();assert.deepEqual(states,['connected']);
  h.port.onmessage({data:{samples:new Int16Array([1,2,3,4])}});await h.flush();assert.deepEqual(states,['connected','capture']);
  h.events.onmessage({data:JSON.stringify({type:'hypothesis',text:'临时错字'})});h.events.onmessage({data:JSON.stringify({type:'result',text:'最终文字'})});
  assert.deepEqual(texts,['临时错字','最终文字']);assert.ok(h.calls.some(c=>c.url.endsWith('/audio?sequence=0')&&c.options.body.byteLength===8));
  h.recognition.stop();await h.flush();assert.equal(h.stops,1);assert.ok(h.calls.some(c=>c.url.endsWith('/end')));
  h.events.onmessage({data:'{"type":"end"}'});assert.equal(h.recognition.active,false);
});
test('offline adapter releases a microphone granted after cancellation and never starts an audio session',async()=>{
  let resolve;const h=harness({media:new Promise(r=>resolve=r)});h.recognition.start();await h.flush();h.recognition.abort();resolve(h.stream);await h.flush();
  assert.equal(h.stops,1);assert.deepEqual(h.calls.map(c=>c.url),['/api/voice/prepare']);assert.ok(h.closes>=1);
});
test('offline adapter closes capture and preserves the concrete local transport failure',async()=>{
  const h=harness({respond:(url)=>({ok:!url.includes('/audio'),json:async()=>url==='/api/voice/start'?{sessionId:'fixture'}:{error:'fixture transport',code:'local-input'}})}),errors=[];
  h.recognition.onerror=e=>errors.push(e);h.recognition.start();await h.flush();h.port.onmessage({data:{samples:new Int16Array([1,2])}});await h.flush();
  assert.equal(errors.length,1);assert.equal(errors[0].error,'local-input');assert.equal(errors[0].message,'fixture transport');assert.equal(h.stops,1);assert.equal(h.recognition.active,false);
});
test('worklet emits bounded signed PCM, flushes the tail, and outputs silence rather than microphone feedback',async()=>{
  let Worklet;const messages=[];
  const context={AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)}}},registerProcessor:(name,type)=>{Worklet=type},Int16Array};
  vm.runInNewContext(await readFile(new URL('../src/voice-worklet.js',import.meta.url),'utf8'),context);const worklet=new Worklet(),output=new Float32Array(5).fill(1);
  worklet.process([[new Float32Array([-1,-.5,0,.5,1])]],[[output]]);worklet.port.onmessage({data:'flush'});
  assert.deepEqual([...messages[0].samples],[-32768,-16384,0,16384,32767]);assert.equal(messages[1].flushed,true);assert.ok(output.every(x=>x===0));
  worklet.process([[new Float32Array(4098)]],[]);worklet.port.onmessage({data:'flush'});assert.equal(messages[2].samples.length,4096);assert.equal(messages[3].samples.length,2);
});

test('offline adapter cancels a remote worker created after the user already cancelled startup',async()=>{
  let resolveStart;const h=harness({respond:url=>url==='/api/voice/start'?new Promise(resolve=>resolveStart=resolve):{ok:true,json:async()=>({ok:true})}});
  h.recognition.start();await h.flush();h.recognition.abort();resolveStart({ok:true,json:async()=>({sessionId:'late'})});await h.flush();
  assert.equal(h.recognition.active,false);assert.ok(h.calls.some(c=>c.url==='/api/voice/late/cancel'));assert.equal(h.stops,1);
});

test('model preparation is cancellable before microphone capture and before creating an audio session',async()=>{
  let prepare;const h=harness({respond:url=>url==='/api/voice/prepare'?new Promise(r=>prepare=r):{ok:true,json:async()=>({})}});
  h.recognition.start();await h.flush();assert.equal(h.recognition.context,undefined);h.recognition.abort();
  prepare({ok:true,json:async()=>({ready:true})});await h.flush();assert.equal(h.recognition.context,undefined);assert.equal(h.stops,0);assert.equal(h.calls.length,1);
});

test('real PCM levels distinguish a silent source from speech without modifying uploaded samples',async()=>{
  const h=harness(),levels=[];h.track.label='USB microphone';h.track.getSettings=()=>({sampleRate:48000,channelCount:1});h.recognition.oninput=value=>levels.push(value);
  h.recognition.start();await h.flush();assert.equal(levels[0].samples,0);assert.equal(h.recognition.capturing,undefined);
  h.port.onmessage({data:{samples:new Int16Array([0,0])}});await h.flush();assert.equal(levels.at(-1).maxPeak,0);assert.equal(levels.at(-1).rms,0);
  h.port.onmessage({data:{samples:new Int16Array([16384,-16384])}});await h.flush();
  assert.equal(levels.at(-1).device,'USB microphone');assert.equal(levels.at(-1).rms,.5);assert.equal(levels.at(-1).maxRms,.5);assert.equal(levels.at(-1).samples,4);
  const body=h.calls.find(c=>c.url.endsWith('sequence=1')).options.body;assert.deepEqual([...new Int16Array(body)],[16384,-16384]);
  h.recognition.abort();
});

test('selected microphone is requested exactly and is not silently replaced by the system default',async()=>{
  const h=harness();let constraints;
  h.scope.navigator={mediaDevices:{getUserMedia:async options=>{constraints=options;throw Object.assign(new Error('device removed'),{name:'OverconstrainedError'})}}};
  const recognition=new h.scope.window.ControllerLocalRecognition({deviceId:'usb-input',createAudio:()=>h.audio,request:async()=>({ok:true,json:async()=>({})})});let error;
  recognition.onerror=value=>error=value;recognition.start();await h.flush();
  assert.equal(constraints.audio.deviceId.exact,'usb-input');assert.equal(constraints.video,false);assert.equal(error.error,'audio-capture');assert.equal(recognition.active,false);
});
