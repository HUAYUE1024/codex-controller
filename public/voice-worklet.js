// Capture only: 16 kHz mono PCM, silent output (never monitor the microphone to speakers).
class ControllerPcm extends AudioWorkletProcessor {
  constructor(){
    super();this.buffer=new Int16Array(4096);this.offset=0;
    this.port.onmessage=e=>{if(e.data==='flush'){this.flush();this.port.postMessage({flushed:true});}};
  }
  flush(){if(this.offset){const samples=this.buffer.slice(0,this.offset);this.port.postMessage({samples},[samples.buffer]);this.offset=0;}}
  process(inputs,outputs){
    for(const output of outputs)for(const channel of output)channel.fill(0);
    const input=inputs[0]?.[0];if(!input)return true;
    for(const sample of input){const value=Math.max(-1,Math.min(1,sample));this.buffer[this.offset++]=Math.round(value*(value<0?32768:32767));if(this.offset===this.buffer.length)this.flush();}
    return true;
  }
}
registerProcessor('controller-pcm',ControllerPcm);
