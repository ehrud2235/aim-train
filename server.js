'use strict';
/**
 * 발로 에임장 — 내 컴퓨터에서 열어 볼 때 쓰는 정적 파일 서버 (설치할 것 없음: node server.js).
 * 인터넷에서는 GitHub Pages 가 같은 파일을 그대로 제공하므로 이 서버가 필요 없다.
 * 화면에 필요한 파일(index.html, style.css, js/, vendor/)만 내보낸다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const ALLOWED_FILES = new Set(['/index.html', '/style.css']);
const ALLOWED_DIRS = ['/js/', '/vendor/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json']);
const gzCache = new Map();

/** 요청 경로 → 실제 파일 (허용되지 않은 경로면 null) */
function resolvePath(pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) return null;
  const rel = `/${path.relative(ROOT, file).split(path.sep).join('/')}`;
  const allowed = ALLOWED_FILES.has(rel) || ALLOWED_DIRS.some((d) => rel.startsWith(d));
  return allowed ? file : null;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  const file = resolvePath(pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}vendor${path.sep}`) ? 'public, max-age=86400' : 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && data.length > 1024) {
        const key = `${file}:${etag}`;
        let gz = gzCache.get(key);
        if (!gz) {
          gz = zlib.gzipSync(data, { level: 6 });
          gzCache.set(key, gz);
        }
        headers['Content-Encoding'] = 'gzip';
        headers.Vary = 'Accept-Encoding';
        data = gz;
      }
      headers['Content-Length'] = data.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

function createAimServer() {
  return http.createServer(serveStatic);
}

module.exports = { createAimServer };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3300;
  const HOST = process.env.HOST || '127.0.0.1';
  createAimServer().listen(PORT, HOST, () => {
    console.log(`발로 에임장 실행 중 → http://localhost:${PORT}`);
  });
}
