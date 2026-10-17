"""Download pinned local ASR assets; never run downloads while recording."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
REVISION = "d93b302ee7fd505e1b3576120fc142fc6f7820e1"
WEIGHTS_SHA = "1bbb6dcc5d8b75084a399d48c4d4b0f3aa1d3f09f2616ae40ed2c4fba03d89c9"
VAD_URL = "https://raw.githubusercontent.com/snakers4/silero-vad/v6.0/src/silero_vad/data/silero_vad.jit"
VAD_SHA = "b178b4bc39467ecd5e9eb0bc6f2fcc291c1cc1cc55a68fea8c0c2c0d5fbbe66c"

def checksum(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()

if __name__ == "__main__":
    from huggingface_hub import snapshot_download
    model = ROOT / ".voice-models/nano"
    snapshot_download("FunAudioLLM/Fun-ASR-Nano-2512-hf", revision=REVISION,
                      local_dir=model, token=False,
                      allow_patterns=["*.json", "*.safetensors", "*.txt", "*.jinja"])
    if checksum(model / "model.safetensors") != WEIGHTS_SHA:
        raise RuntimeError("ASR weights checksum mismatch")
    vad = ROOT / ".voice-models/silero_vad.jit"
    if not vad.exists() or checksum(vad) != VAD_SHA:
        data = urllib.request.urlopen(VAD_URL, timeout=90).read(3_000_000)
        if hashlib.sha256(data).hexdigest() != VAD_SHA:
            raise RuntimeError("VAD checksum mismatch")
        vad.write_bytes(data)
    runtime = ROOT / ".voice-runtime"
    runtime.mkdir(exist_ok=True)
    (runtime / "python.json").write_text(json.dumps({"executable": sys.executable}), encoding="utf-8")
    print("VOICE SETUP: pinned Nano + Silero weights verified; Python configured")
