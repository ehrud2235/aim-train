'use strict';
// 발로 에임장 서버: 정적 파일, Three.js, 경로 막기.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createAimServer } = require('../server');

function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
      })
      .on('error', reject);
  });
}

test('정적 파일과 Three.js 를 제공하고, public 밖은 막는다', async () => {
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
    const three = await get(port, '/vendor/three/three.module.js');
    assert.equal(three.status, 200);
    const core = await get(port, '/vendor/three/three.core.js');
    assert.equal(core.status, 200);
    assert.equal((await get(port, '/healthz')).body, 'ok');
    assert.equal((await get(port, '/../server.js')).status !== 200, true);
    assert.equal((await get(port, '/%2e%2e/server.js')).status !== 200, true);
    assert.equal((await get(port, '/nope.js')).status, 404);
  } finally {
    server.close();
  }
});
