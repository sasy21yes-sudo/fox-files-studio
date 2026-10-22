"""Local studio-voice server: renders edited narration lines on the fly.

    pip install kokoro-onnx soundfile numpy
    python tools/voice_server.py            # listens on http://127.0.0.1:8765

While it runs, the studio (npm run dev, or the built app opened from this
machine) sends every sentence that is not in the shipped voice pack — the
lines you rewrote — and gets back the same Kokoro voice, so edited scenes stay
fully voiced in the preview and in exported videos. Only 127.0.0.1 is bound;
nothing leaves your computer.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kokoro_voice as kv  # noqa: E402

LOCK = threading.Lock()  # one synthesis at a time (onnxruntime already uses every core)
CACHE: dict[tuple, dict] = {}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        body = b"" if code == 204 else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):  # CORS preflight
        self._send(204, {})

    def do_GET(self):
        if self.path.startswith("/health"):
            self._send(200, {"ok": True, "engine": "Kokoro-82M v1.0"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/speak"):
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(n) or b"{}")
            say, voice, lang = str(req["say"]), str(req["voice"]), str(req["lang"])
            parts = [str(p) for p in req.get("parts", [])]
            speed = float(req.get("speed", 1.0))
            if len(say) > 600:
                return self._send(400, {"error": "sentence too long"})
            key = (say, voice, lang, speed, tuple(parts))
            if key not in CACHE:
                with LOCK:
                    audio = kv.synth(say, voice, lang, speed)
                    audio = kv.loudness_normalize([audio])[0]
                buf = io.BytesIO()
                sf.write(buf, audio, kv.SAMPLE_RATE, format="WAV", subtype="PCM_16")
                CACHE[key] = {
                    "wav": base64.b64encode(buf.getvalue()).decode(),
                    "duration": len(audio) / kv.SAMPLE_RATE,
                    "splits": kv.find_splits(audio, parts),
                }
            self._send(200, CACHE[key])
        except Exception as e:  # report, keep serving
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("voice: " + fmt % args + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    kv.engine()  # load (and download, the first time) before accepting requests
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"studio voice ready on http://127.0.0.1:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
