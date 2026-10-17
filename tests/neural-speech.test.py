import importlib.util
import io
from pathlib import Path
import queue
import struct
import sys
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("neural_speech", Path(__file__).resolve().parents[1] / "scripts/neural-speech.py")
speech = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)

class FakeVad:
    probability = 0
    def reset_states(self): pass
    def __call__(self, audio, rate):
        return SimpleNamespace(item=lambda: self.probability)

class SpeechTests(unittest.TestCase):
    def test_fragmented_pipe_frames_and_truncated_payload(self):
        class Fragmented(io.BytesIO):
            def read(self, size): return super().read(min(size, 3))
        original = sys.stdin
        try:
            data = b"{\"type\":\"end\"}"
            sys.stdin = SimpleNamespace(buffer=Fragmented(struct.pack("<BI", 0, len(data)) + data))
            output = queue.Queue(); speech.frames(output)
            self.assertEqual(output.get(), (0, data)); self.assertIsNone(output.get())
            sys.stdin = SimpleNamespace(buffer=Fragmented(struct.pack("<BI", 1, 20) + b"12"))
            speech.frames(output); self.assertIsInstance(output.get(), EOFError); self.assertIsNone(output.get())
        finally:
            sys.stdin = original

    def test_silence_never_transcribes_and_memory_remains_bounded(self):
        vad = FakeVad(); events = []; calls = []
        segment = speech.Segmenter(vad, lambda pcm: calls.append(pcm), lambda *a, **k: events.append(a))
        segment.feed(bytes(35 * 32000), final=True)
        self.assertEqual(calls, []); self.assertEqual(events, []); self.assertEqual(len(segment.buffer), 0)

    def test_pauses_finalize_sentences_without_ending_session_and_flush_short_tail(self):
        vad = FakeVad(); events = []; sizes = []
        def decode(pcm): sizes.append(len(pcm)); return "实际模型结果由集成测试覆盖"
        segment = speech.Segmenter(vad, decode, lambda kind, **data: events.append((kind, data)))
        vad.probability = .9; segment.feed(bytes(2 * 32000))
        self.assertTrue(any(e[0] == "hypothesis" for e in events))
        vad.probability = 0; segment.feed(bytes(32000))
        self.assertEqual(sum(e[0] == "result" for e in events), 1)
        self.assertEqual(events[-1][0], "speech-end")
        vad.probability = .9; segment.feed(bytes(7000), final=True)
        self.assertEqual(sum(e[0] == "result" for e in events), 2)
        self.assertTrue(all(n <= 20 * 32000 for n in sizes))
        self.assertEqual(len(segment.pending), 0)

    def test_reset_discards_cancelled_preview_and_long_speech_keeps_all_audio(self):
        vad = FakeVad(); vad.probability = .9; events = []; final_sizes = []
        segment = speech.Segmenter(vad, lambda pcm: str(len(pcm)), lambda kind, **data: events.append((kind, data)))
        segment.feed(bytes(2 * 32000)); segment.reset(); events.clear()
        segment.feed(bytes(21 * 32000), final=True)
        final_sizes = [int(data["text"]) for kind, data in events if kind == "result"]
        self.assertEqual(sum(final_sizes), 21 * 32000 + (1024 - (21 * 32000) % 1024) % 1024)

if __name__ == "__main__": unittest.main()
