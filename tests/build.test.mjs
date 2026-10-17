import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('build validates the bundle before replacing the previous output',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'controller-build-test-'));
  try{
    for(const dir of ['scripts','src','public'])await mkdir(path.join(root,dir));
    await copyFile(new URL('../scripts/build.mjs',import.meta.url),path.join(root,'scripts/build.mjs'));
    for(const file of ['voice-input.js','local-recognition.js','voice-worklet.js','activity-view.js','gamepad-controls.js','controller-pilot.js','app.js'])await writeFile(path.join(root,'src',file),'// fixture\n');
    const build=()=>spawnSync(process.execPath,[path.join(root,'scripts/build.mjs')],{encoding:'utf8',windowsHide:true});
    assert.equal(build().status,0);const before=await readFile(path.join(root,'public/app.js'),'utf8');
    const worklet=await readFile(path.join(root,'public/voice-worklet.js'),'utf8');
    await writeFile(path.join(root,'src/app.js'),'function broken( {');
    assert.notEqual(build().status,0);assert.equal(await readFile(path.join(root,'public/app.js'),'utf8'),before);
    await writeFile(path.join(root,'src/app.js'),'// fixture\n');await writeFile(path.join(root,'src/voice-worklet.js'),'function broken( {');
    assert.notEqual(build().status,0);assert.equal(await readFile(path.join(root,'public/app.js'),'utf8'),before);assert.equal(await readFile(path.join(root,'public/voice-worklet.js'),'utf8'),worklet);
  }finally{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(root,{recursive:true,force:true,maxRetries:3});
  }
});
