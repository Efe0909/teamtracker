#!/usr/bin/env python3
"""Sahte OpenRouter: yerel sozlesme testi icin (tools/local_test.sh -> check_api.sh `llm_live`).

Gercek anahtar ve ag olmadan LLM cagri yolunu (kayit, maliyet, limit, Dene, hata izi)
sinamak icin. Rust yalniz gelistirmede `EKIPTAKIP_OPENROUTER_URL` ile buraya doner;
yayinda adres sabit (config.rs). Anahtar olarak `stub-key` bekler.

Model adina gore davranir:
  stub/bad      -> 400 + OpenRouter bicimli hata govdesi
  stub/garbled  -> 200, icerik JSON degil
  diger         -> 200, iki oneri + usage.cost 0.004

  python3 tools/openrouter_stub.py 18101
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "Bearer stub-key"

MODELS = {"data": [
    {"id": "deepseek/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "context_length": 1048576,
     "pricing": {"prompt": "0.0000003", "completion": "0.0000012"},
     "supported_parameters": ["max_tokens", "reasoning", "response_format", "structured_outputs", "temperature"]},
    {"id": "typesafe/jev-router", "name": "Jev Router", "context_length": 8192,
     "pricing": {"prompt": "-1", "completion": "-1"}, "supported_parameters": []},
]}

KEY_INFO = {"data": {"label": "stub", "limit": 10, "limit_remaining": 9.5, "limit_reset": None,
                     "usage": 0.5, "usage_daily": 0.1, "usage_weekly": 0.3, "usage_monthly": 0.5,
                     "is_free_tier": False}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, code, body):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/api/v1/models":
            return self.send(200, MODELS)
        if self.path == "/api/v1/key":
            if self.headers.get("Authorization") != KEY:
                return self.send(401, {"error": {"code": 401, "message": "No auth"}})
            return self.send(200, KEY_INFO)
        self.send(404, {"error": {"code": 404, "message": "not found"}})

    def do_POST(self):
        if self.headers.get("Authorization") != KEY:
            return self.send(401, {"error": {"code": 401, "message": "No auth credentials found"}})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        model = body.get("model", "")
        if self.path == "/api/alpha/decisions":
            answers = {q: {"type": "noul", "noul": 0.9} for q in body.get("questions", {})}
            return self.send(200, {"model": model, "provider": "Stub", "answers": answers})
        if self.path != "/api/v1/chat/completions":
            return self.send(404, {"error": {"code": 404, "message": "not found"}})
        if model == "stub/bad":
            return self.send(400, {"error": {"code": 400, "message": "No endpoints found that support response_format",
                                             "metadata": {"provider_name": "Stub"}}})
        content = "Sure! Here are some ideas" if model == "stub/garbled" else json.dumps({"items": [
            {"name": "Servo motor", "description": "Robot kolunun eklemleri için."},
            {"name": "Havya istasyonu", "description": "Lehim işleri için."},
        ]})
        self.send(200, {"id": "gen-stub-1", "model": model,
                        "choices": [{"message": {"role": "assistant", "content": content}}],
                        "usage": {"prompt_tokens": 120, "completion_tokens": 40, "cost": 0.004}})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
