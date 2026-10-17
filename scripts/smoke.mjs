import {CodexBridge} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const home=await mkdtemp(path.join(os.tmpdir(),'controller-smoke-'));
const bridge=new CodexBridge({env:{...process.env,CODEX_HOME:home}});
try {await bridge.start();if(!bridge.connected)throw new Error(bridge.error);const account=await bridge.rpc('account/read',{refreshToken:false});const threads=await bridge.rpc('thread/list',{limit:5});console.log(JSON.stringify({ok:true,initialized:bridge.version,accountType:account.account?.type||null,requiresOpenaiAuth:account.requiresOpenaiAuth,threadCount:threads.data.length,notice:'Read-only handshake; no login, inference, or paid API use.'},null,2));} finally {await bridge.stop();await rm(home,{recursive:true,force:true});}
