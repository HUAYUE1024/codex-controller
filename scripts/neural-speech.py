"""Local-only PCM worker. Binary input frames, session-tagged NDJSON output."""
import importlib.metadata
import json
import os
from pathlib import Path
import queue
import struct
import sys
import threading

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".voice-runtime"))
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
MODEL = ROOT / ".voice-models/nano"
RATE = 16000
KEYWORDS = ["Codex", "RT", "API", "UI", "前端", "手柄", "摇杆", "草稿"]

def send(kind, session=None, **fields):
    print(json.dumps({"type": kind, "sessionId": session, **fields}, ensure_ascii=False), flush=True)

def capability():
    for name in ["torch", "torchaudio", "transformers"]:
        importlib.metadata.version(name)
    for name in ["model.safetensors", "config.json", "processor_config.json", "tokenizer.json", "chat_template.jinja"]:
        if not (MODEL / name).is_file():
            raise RuntimeError("中文模型未安装，请运行 scripts/setup-voice.py")
    if not (ROOT / ".voice-models/silero_vad.jit").is_file():
        raise RuntimeError("语音活动检测模型未安装，请运行 scripts/setup-voice.py")
    return {"available": True, "offline": True, "engine": "Fun-ASR-Nano", "culture": "zh-CN", "revision": "d93b302ee7fd505e1b3576120fc142fc6f7820e1"}

def read_exact(source, size):
    data = bytearray()
    while len(data) < size:
        part = source.read(size - len(data))
        if not part:
            if data:
                raise EOFError("Truncated voice frame")
            return None
        data.extend(part)
    return bytes(data)

def frames(output):
    try:
        while header := read_exact(sys.stdin.buffer, 5):
            kind, size = struct.unpack("<BI", header)
            if kind not in (0, 1) or size > 65536 or size < 1:
                raise ValueError("Invalid voice frame")
            data = read_exact(sys.stdin.buffer, size)
            if data is None:
                raise EOFError("Missing voice frame")
            output.put((kind, data))
    except Exception as error:
        output.put(error)
    finally:
        output.put(None)

class Segmenter:
    """Silero hysteresis, padded utterances, bounded context, replaceable previews."""
    def __init__(self, vad, decode, emit):
        self.vad, self.decode, self.emit = vad, decode, emit
        self.reset()

    def reset(self):
        self.vad.reset_states()
        self.buffer = bytearray()
        self.pending = bytearray()
        self.speaking = False
        self.silence = self.voiced = self.preview_at = 0
        self.last_preview = ""

    def finish(self):
        speaking = self.speaking
        if self.speaking and self.voiced >= int(.16 * RATE):
            text = self.decode(bytes(self.buffer))
            if text:
                self.emit("result", text=text)
            elif self.last_preview:
                raise RuntimeError("尾句模型未返回文字；临时文字已保留，请检查后重试")
        if speaking:
            self.emit("speech-end")
        self.buffer.clear()
        self.speaking = False
        self.silence = self.voiced = self.preview_at = 0
        self.last_preview = ""

    def feed(self, pcm, final=False):
        import numpy as np
        import torch
        self.pending.extend(pcm)
        if final and len(self.pending) % 1024:
            self.pending.extend(bytes(1024 - len(self.pending) % 1024))
        while len(self.pending) >= 1024:
            block = bytes(self.pending[:1024]); del self.pending[:1024]
            audio = np.frombuffer(block, dtype="<i2").astype(np.float32) / 32768
            probability = self.vad(torch.from_numpy(audio), RATE).item()
            self.buffer.extend(block)
            if not self.speaking:
                if probability >= .5:
                    self.speaking = True
                    self.emit("speech-start")
                else:
                    del self.buffer[:-int(.25 * RATE) * 2]
                    continue
            if probability >= .35:
                self.silence = 0
                self.voiced += 512
            else:
                self.silence += 512
            samples = len(self.buffer) // 2
            if self.silence >= int(.7 * RATE) or samples >= 20 * RATE:
                # ponytail: utterances are capped at 20s; an unbroken monologue can cross a word boundary.
                # Prefer a pause before the cap; forced splits retain all PCM rather than silently trimming.
                self.finish()
            elif self.voiced >= RATE and samples - self.preview_at >= int(1.5 * RATE):
                text = self.decode(bytes(self.buffer))
                self.preview_at = samples
                if text and text != self.last_preview:
                    self.last_preview = text
                    self.emit("hypothesis", text=text)
        if final:
            self.finish()

def serve():
    import numpy as np
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
    torch.set_num_threads(4)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    processor = AutoProcessor.from_pretrained(MODEL, local_files_only=True, trust_remote_code=False, token=False)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(MODEL, local_files_only=True, trust_remote_code=False,
                                                   token=False, dtype=dtype, attn_implementation="sdpa").to(device).eval()
    vad = torch.jit.load(str(ROOT / ".voice-models/silero_vad.jit"), map_location="cpu").eval()

    def decode(pcm):
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        inputs = processor.apply_transcription_request(audio=audio, language="zh", keywords=KEYWORDS,
            processor_kwargs={"return_tensors": "pt", "audio_kwargs": {"sampling_rate": RATE}, "text_kwargs": {"padding": True}}).to(device, dtype=dtype)
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=384, do_sample=False)
        tokens = generated[:, inputs.input_ids.shape[1]:]
        eos = model.generation_config.eos_token_id
        if not any(t in (eos if isinstance(eos, list) else [eos]) for t in tokens[0].tolist()):
            raise RuntimeError("模型转写达到输出上限，已有文字已保留")
        return processor.batch_decode(tokens, skip_special_tokens=True)[0].strip()

    # Warm kernels before announcing readiness; no microphone, file recording or network access.
    decode(bytes(RATE * 2))
    send("ready", device=device, dtype=str(dtype), **capability())
    incoming = queue.Queue(maxsize=32)
    threading.Thread(target=frames, args=(incoming,), daemon=True).start()
    session = None
    segmenter = Segmenter(vad, decode, lambda kind, **data: send(kind, session, **data))
    while (frame := incoming.get()) is not None:
        if isinstance(frame, Exception):
            raise frame
        kind, data = frame
        try:
            if kind == 0:
                command = json.loads(data)
                if command["type"] == "start":
                    session = command["sessionId"]
                    segmenter.reset()
                    send("ready", session)
                elif command.get("sessionId") == session:
                    if command["type"] == "end":
                        segmenter.feed(b"", final=True)
                    segmenter.reset()
                    send("end", session)
                    session = None
            elif session:
                segmenter.feed(data)
        except Exception as error:
            send("error", session, code="local-engine", message=str(error))
            segmenter.reset()
            session = None

if __name__ == "__main__":
    try:
        if sys.argv[-1] == "probe":
            print(json.dumps(capability(), ensure_ascii=False))
        else:
            capability()
            serve()
    except Exception as error:
        send("error", available=False, code="local-engine", message=str(error))
        raise SystemExit(1)
