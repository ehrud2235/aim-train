'use strict';
/**
 * 발로 에임장 — 정적 파일 서버.
 * - public/ 폴더(연습장 화면)와 Three.js 파일을 제공한다.
 * - 혼자 하는 연습장이라 웹소켓·방 같은 건 없다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(path.dirname(require.resolve('three')), '..');
const VENDOR_FILES = {
  '/vendor/three/three.module.js': path.join(THREE_DIR, 'build', 'three.module.js'),
  '/vendor/three/three.core.js': path.join(THREE_DIR, 'build', 'three.core.js'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json']);
const gzCache = new Map();

/** 요청 경로 → 실제 파일 (허용되지 않은 경로면 null) */
function resolvePath(pathname) {
  if (VENDOR_FILES[pathname]) return { file: VENDOR_FILES[pathname], long: true };
  const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  return file.startsWith(PUBLIC_DIR + path.sep) ? { file, long: false } : null;
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
  const target = resolvePath(pathname);
  if (!target) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(target.file, (statErr, st) => {
    if (statErr || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const ext = path.extname(target.file).toLowerCase();
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': target.long ? 'public, max-age=86400' : 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    fs.readFile(target.file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && data.length > 1024) {
        const key = `${target.file}:${etag}`;
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
  const HOST = process.env.HOST || '0.0.0.0';
  createAimServer().listen(PORT, HOST, () => {
    console.log(`발로 에임장 실행 중 → http://localhost:${PORT}`);
  });
}
