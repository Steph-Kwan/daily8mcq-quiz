"""Minimal OpenAI-compatible server for the app self test: streams Chat Completions and lists models.
The model name picks the behaviour: mock-ok, mock-length, mock-refusal, mock-slow. Prints its port on stdout."""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def do_GET(self):
        if self.path != '/v1/models':
            self.send_response(404); self.end_headers(); return
        body = json.dumps({'object': 'list', 'data': [{'id': m, 'object': 'model'} for m in ['mock-ok', 'mock-length', 'mock-refusal', 'mock-slow']]}).encode()
        self.send_response(200); self.cors(); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.headers.get('Authorization') != 'Bearer sk-mock':
            body = json.dumps({'error': {'message': 'Incorrect API key provided', 'type': 'invalid_request_error', 'code': 'invalid_api_key'}}).encode()
            self.send_response(401); self.cors(); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body); return
        model, messages = req['model'], req['messages']
        user = messages[-1]['content']
        images = sum(1 for part in user if isinstance(part, dict) and part.get('type') == 'image_url') if isinstance(user, list) else 0
        valid_images = all(p['image_url']['url'].startswith('data:image/') for p in user if isinstance(p, dict) and p.get('type') == 'image_url') if isinstance(user, list) else True
        summary = f"system={messages[0]['role']}; images={images}; valid={valid_images}; stream={req.get('stream')}"
        self.send_response(200); self.cors(); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        def chunk(delta, finish=None):
            data = {'id': 'c1', 'object': 'chat.completion.chunk', 'model': model + '-served', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
            self.wfile.write(b'data: ' + json.dumps(data).encode() + b'\n\n'); self.wfile.flush()
        chunk({'role': 'assistant', 'content': ''})
        if model == 'mock-refusal':
            chunk({'refusal': 'I cannot help with that.'}, 'stop')
        else:
            parts = ['### 讲解\n\n', '**正确答案** 是 C。', '\n\n- ' + summary]
            for p in parts * (20 if model == 'mock-slow' else 1):
                chunk({'content': p})
                if model == 'mock-slow': time.sleep(0.2)
            chunk({}, 'length' if model == 'mock-length' else 'stop')
        self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
