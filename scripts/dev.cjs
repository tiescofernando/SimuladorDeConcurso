const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.pdf': 'application/pdf' };
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost:3000').pathname); }
  catch (_) { res.writeHead(400); return res.end('Endereço inválido.'); }
  const admin = /^\/admin(?:\/|$)/.test(pathname);
  if (pathname === '/' || pathname === '/index.html' || admin) pathname = '/index.html';
  else if (!/^\/(?:assets|data|pdfs)\//.test(pathname)) { res.writeHead(404); return res.end(); }
  const file = path.resolve(root, '.' + pathname);
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (!file.startsWith(root + path.sep) || (relative !== 'index.html' && !/^(?:assets|data|pdfs)\//.test(relative)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  for (const header of config.headers[0].headers) {
    res.setHeader(header.key, header.key === 'Content-Security-Policy' ? header.value.replace('; upgrade-insecure-requests', '') : header.value);
  }
  if (admin) res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'A porta 3000 já está em uso. Encerre o servidor anterior antes de iniciar outro.' : error.message);
  process.exitCode = 1;
});
server.listen(3000, '127.0.0.1', () => console.log('Simulador disponível em http://localhost:3000 (Admin: /admin).'));
