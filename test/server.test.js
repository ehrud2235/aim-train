'use strict';
// 로컬 서버와 GitHub Pages 배포용 파일 구성.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createAimServer } = require('../server');

const ROOT = path.join(__dirname, '..');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
      })
      .on('error', reject);
  });
}

test('로컬 서버: 화면 파일과 Three.js 를 제공하고, 나머지(server.js, test/ 등)는 막는다', async () => {
  const server = createAimServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const index = await get(port, '/');
    assert.equal(index.status, 200);
    assert.match(index.body, /발로 에임장/);
    const main = await get(port, '/js/client/main.js');
    assert.equal(main.status, 200);
    assert.match(main.type, /javascript/);
    assert.equal((await get(port, '/style.css')).status, 200);
    assert.equal((await get(port, '/vendor/three/three.module.js')).status, 200);
    assert.equal((await get(port, '/vendor/three/three.core.js')).status, 200);
    assert.equal((await get(port, '/healthz')).body, 'ok');
    for (const p of ['/server.js', '/package.json', '/test/sim.test.mjs', '/../server.js', '/%2e%2e/server.js', '/js/../server.js', '/nope.js']) {
      assert.notEqual((await get(port, p)).status, 200, p);
    }
  } finally {
    server.close();
  }
});

test('GitHub Pages 하위 경로(/aim-train/)에서도 열리도록 화면이 쓰는 경로가 전부 상대 경로다', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
  refs.push(...Object.values(map.imports));
  for (const r of refs) {
    if (r.startsWith('data:')) continue;
    assert.ok(!r.startsWith('/') && !/^[a-z]+:/i.test(r), `절대 경로·외부 주소: ${r}`);
    assert.ok(fs.existsSync(path.join(ROOT, r)), `없는 파일: ${r}`);
  }
  // 화면 코드 안에서 import 하는 경로도 상대 경로 또는 'three' 뿐이어야 한다
  const jsDir = path.join(ROOT, 'js');
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(d, f.name));
      else if (f.name.endsWith('.js')) files.push(path.join(d, f.name));
    }
  };
  walk(jsDir);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:import|from)\s*\(?\s*'([^']+)'/g)) {
      const spec = m[1];
      if (spec === 'three') continue;
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${path.relative(ROOT, f)}: ${spec}`);
      assert.ok(fs.existsSync(path.join(path.dirname(f), spec)), `${path.relative(ROOT, f)}: 없는 파일 ${spec}`);
    }
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'vendor/three/three.core.js')), 'three.module.js 가 불러오는 짝 파일');
  assert.ok(fs.existsSync(path.join(ROOT, '.nojekyll')), 'Jekyll 이 파일을 건드리지 않게');
});
