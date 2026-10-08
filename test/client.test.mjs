// 화면 쪽 중 DOM 없이 확인할 수 있는 것: 크로스헤어 그리기 순서와 범위.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintCrosshair } from '../js/client/crosshair.js';
import { parseCrosshairCode, DEFAULT_CROSSHAIR } from '../js/sim/settings.js';

function mockCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: '',
    fillRect(x, y, w, h) {
      calls.push({ style: this.fillStyle, x, y, w, h });
    },
  };
}

test('크로스헤어: 테두리를 전부 먼저 깔고 색은 그 위에 (간격이 좁아도 선이 대칭)', () => {
  const cfg = parseCrosshairCode('0;P;c;5;h;1;t;1;o;1;0t;2;0l;4;0o;1');
  const g = mockCtx();
  paintCrosshair(g, 100, 100, cfg);
  const firstColor = g.calls.findIndex((c) => !c.style.startsWith('rgba(0,0,0'));
  const lastOutline = g.calls.map((c) => c.style.startsWith('rgba(0,0,0')).lastIndexOf(true);
  assert.ok(firstColor > lastOutline, '색 칠하기 전에 테두리가 끝나야 함');
  // 픽셀로 그려 보면 위·아래·왼·오른 팔 길이가 같다
  const px = new Map();
  for (const c of g.calls) for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) px.set(`${x},${y}`, c.style);
  const colored = (x, y) => (px.get(`${x},${y}`) || '').includes('0,255,255');
  let up = 0;
  let right = 0;
  for (let d = 1; d < 20; d++) {
    if (colored(100, 100 - d) || colored(99, 100 - d)) up++;
    if (colored(100 + d, 100) || colored(100 + d, 99)) right++;
  }
  assert.equal(up, right);
});

test('크로스헤어: 오차로 벌어진 만큼 그린 범위(지울 범위)도 커진다', () => {
  const cfg = structuredClone(DEFAULT_CROSSHAIR);
  const near = paintCrosshair(mockCtx(), 500, 500, cfg, 0, 0);
  const far = paintCrosshair(mockCtx(), 500, 500, cfg, 30, 150);
  assert.ok(near >= cfg.outer.offset + cfg.outer.length);
  assert.ok(far >= cfg.outer.offset + 30 + 150 + cfg.outer.length, `${far}`);
});
