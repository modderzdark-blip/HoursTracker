// Minimal static file server for the Playwright tests: serves www/ on 127.0.0.1:4173 (no network beyond localhost).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.resolve('www');
const PORT = Number(process.env.STATIC_PORT || 4173);
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((request, response) => {
  const request_path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file_path = path.join(WEB_ROOT, request_path === '/' ? 'index.html' : request_path);
  if (!file_path.startsWith(WEB_ROOT) || !fs.existsSync(file_path) || fs.statSync(file_path).isDirectory()) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file_path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file_path).pipe(response);
}).listen(PORT, '127.0.0.1', () => console.log(`static server on http://127.0.0.1:${PORT}`));
