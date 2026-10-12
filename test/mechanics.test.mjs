// 발로란트 수치 테스트 (감도·이동·무기·판정·설정): node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMover, stepMover, maxSpeed, horizSpeed } from '../js/sim/movement.js';
import { createWeapon, stepWeapon, movementError, currentSpread, switchTo } from '../js/sim/weapon.js';
import { createBot, rayBot } from '../js/sim/bots.js';
import { createGame, DT, offsetDir, placeBotAtAim } from '../js/sim/game.js';
import { cmPer360, zoomedHfov, VANDAL, MOVE, YAW_PER_COUNT } from '../js/sim/valorant.js';
import { DEFAULTS, parseCrosshairCode, loadSettings, DEFAULT_CROSSHAIR } from '../js/sim/settings.js';
import { flatMap, seeded, near } from './helpers.mjs';
const BASE = { ...DEFAULTS, fight: 'off', matchRules: 'endless', dmBots: 8 };

const map = flatMap(80, 80);
// ── 감도 ──
test('감도 0.4 / 800 DPI → 1카운트 0.028°, 360° 약 40.8cm', () => {
  assert.ok(near(YAW_PER_COUNT * 0.4, 0.028, 1e-9));
  assert.ok(near(cmPer360(800, 0.4), 40.82, 0.01));
});

test('밴달 조준 1.25배 → 가로 시야 103 / 1.25 = 82.4°', () => {
  assert.ok(near(zoomedHfov(1.25), 82.4, 1e-9));
});

// ── 이동 ──
function runFlat(ticks, input, m = createMover(20, 40, 0)) {
  for (let i = 0; i < ticks; i++) stepMover(m, map, input, DT);
  return m;
}

test('밴달 들고 달리면 5.4 m/s, 걷기 약 2.98, 조준 4.104, 칼 6.75', () => {
  const run = runFlat(128, { wx: 1, wy: 0, speed: maxSpeed(VANDAL.speed, {}), crouch: false, jump: false }, createMover(12, 40, 0));
  assert.ok(near(horizSpeed(run), 5.4, 1e-6));
  assert.ok(near(maxSpeed(VANDAL.speed, { walk: true }), 2.984, 0.01));
  assert.ok(near(maxSpeed(VANDAL.speed, { ads: true, adsSpeedMult: VANDAL.adsSpeedMult }), 4.104, 1e-6));
  assert.ok(near(maxSpeed(6.75, {}), 6.75, 1e-9));
});

test('키를 놓으면 약 0.16초에 정확 사격 속도(27.5%), 걷기 속도까지 약 0.07초 — 반대키(카운터 스트레이핑)는 약 10ms 빠름', () => {
  const thr = VANDAL.speed * MOVE.accurateFrac;
  const timeToAccurate = (counter) => {
    const m = runFlat(128, { wx: 1, wy: 0, speed: 5.4, crouch: false, jump: false }, createMover(12, 40, 0));
    let t = 0;
    while (horizSpeed(m) > thr && t < 1) {
      stepMover(m, map, { wx: counter ? -1 : 0, wy: 0, speed: 5.4, crouch: false, jump: false }, DT);
      t += DT;
    }
    return t;
  };
  const release = timeToAccurate(false);
  const counter = timeToAccurate(true);
  assert.ok(release > 0.14 && release < 0.19, `놓기 ${release}`);
  assert.ok(counter < release && release - counter < 0.03, `카운터 ${counter} < 놓기 ${release}`);
  // 걷기 속도(2.98)까지
  const m = runFlat(128, { wx: 1, wy: 0, speed: 5.4, crouch: false, jump: false }, createMover(12, 40, 0));
  let t = 0;
  while (horizSpeed(m) > VANDAL.speed * MOVE.walkMult) {
    stepMover(m, map, { wx: 0, wy: 0, speed: 5.4, crouch: false, jump: false }, DT);
    t += DT;
  }
  assert.ok(t > 0.05 && t < 0.09, `걷기 속도까지 ${t}`);
});

test('점프: 약 0.9~1.1m 뜨고 착지한다', () => {
  const m = createMover(40, 40, 0);
  let peak = 0;
  stepMover(m, map, { wx: 0, wy: 0, speed: 5.4, crouch: false, jump: true }, DT);
  for (let i = 0; i < 200; i++) {
    stepMover(m, map, { wx: 0, wy: 0, speed: 5.4, crouch: false, jump: false }, DT);
    peak = Math.max(peak, m.z);
  }
  assert.ok(peak > 0.85 && peak < 1.15, `높이 ${peak}`);
  assert.ok(m.onGround && m.z === 0);
});

test('벽을 뚫고 지나가지 못한다', () => {
  const m = createMover(40, 70, 0);
  runFlat(400, { wx: 0, wy: 1, speed: 6.75, crouch: false, jump: false }, m);
  assert.ok(m.y < 79 - 0.3, `y=${m.y}`);
});

// ── 무기 ──
function fireFor(seconds, { ads = false, w = createWeapon() } = {}) {
  let shots = 0;
  const still = { speed: 0, airborne: false, crouched: false };
  // 조준 먼저 완료
  if (ads) for (let i = 0; i < 64; i++) stepWeapon(w, { fire: false, adsHeld: true }, still, DT);
  const n = Math.round(seconds * 128);
  for (let i = 0; i < n; i++) shots += stepWeapon(w, { fire: true, adsHeld: ads }, still, DT).shots.length;
  return shots;
}

test('밴달 연사: 1초에 10발 (9.75발/초), 조준 시 9발 (8.775발/초)', () => {
  assert.equal(fireFor(1.0), 10);
  assert.equal(fireFor(1.0, { ads: true }), 9);
  // 2초: 9.75*2 = 19.5 → 첫 발 포함 20발
  assert.equal(fireFor(2.0), 20);
});

test('탄창 25발 → 자동 재장전 2.5초 뒤 다시 25발', () => {
  const w = createWeapon();
  const still = { speed: 0, airborne: false, crouched: false };
  let shots = 0;
  for (let i = 0; i < 128 * 3; i++) shots += stepWeapon(w, { fire: true, adsHeld: false }, still, DT).shots.length;
  assert.equal(shots, 25);
  assert.ok(w.reload > 0);
  for (let i = 0; i < 128 * 3; i++) stepWeapon(w, { fire: false, adsHeld: false }, still, DT);
  assert.equal(w.ammo, 25);
});

test('첫 발 0.25° (앉으면 0.21), 연사 최대 1.0°, 걷기 +3 · 달리기 +6 · 공중 +10 · 착지 +7, 27.5% 이하 속도면 이동 오차 0', () => {
  const w = createWeapon();
  assert.ok(near(currentSpread(w, { speed: 0, airborne: false }).total, 0.25, 1e-9));
  assert.ok(near(currentSpread(w, { speed: 0, airborne: false, crouched: true }).total, 0.2125, 1e-9));
  w.shotIdx = 20;
  assert.ok(near(currentSpread(w, { speed: 0, airborne: false }).total, 1.0, 1e-9));
  w.shotIdx = 0;
  assert.ok(near(movementError(VANDAL.speed * MOVE.walkMult, false), 3.0, 1e-9));
  assert.ok(near(movementError(VANDAL.speed * 0.6, false, VANDAL.speed, true), 0.8, 1e-9));
  assert.ok(near(movementError(0, false, VANDAL.speed, false, true), 7, 1e-9));
  assert.equal(movementError(VANDAL.speed * 0.27, false), 0);
  assert.ok(movementError(VANDAL.speed * 0.6, false) > 1);
  assert.equal(movementError(VANDAL.speed, false), VANDAL.runError);
  assert.equal(movementError(0, true), VANDAL.jumpError);
});

test('끊어 쏘기: 0.5초 간격이면 매번 첫 발, 0.3초 간격이어도 거의 첫 발 (회복 0.375초, 탭 효율 6)', () => {
  const still = { speed: 0, airborne: false, crouched: false };
  const tap = (gap) => {
    const w = createWeapon();
    const out = [];
    for (let k = 0; k < 6; k++) {
      let fired = false;
      for (let i = 0; i < 128 * gap; i++) {
        const r = stepWeapon(w, { fire: !fired, adsHeld: false }, still, DT);
        if (r.shots.length) {
          out.push(r.shots[0]);
          fired = true;
        }
      }
    }
    return out;
  };
  assert.deepEqual(tap(0.5).map((s) => s.index), [0, 0, 0, 0, 0, 0]);
  for (const s of tap(0.3)) {
    assert.ok(s.spread < 0.27, `퍼짐 ${s.spread}`);
    assert.ok(s.recoil[0] < 0.8, `반동 ${s.recoil[0]}`);
  }
});

test('끊어 쏘기(탭) 기본: 충분히 쉬면 반동이 회복되어 매번 첫 발 정확도', () => {
  const w = createWeapon();
  const still = { speed: 0, airborne: false, crouched: false };
  const idx = [];
  for (let k = 0; k < 5; k++) {
    let fired = false;
    for (let i = 0; i < 128 * 0.55; i++) {
      const r = stepWeapon(w, { fire: !fired, adsHeld: false }, still, DT);
      if (r.shots.length) {
        idx.push(r.shots[0].index);
        fired = true;
      }
    }
  }
  assert.deepEqual(idx, [0, 0, 0, 0, 0]);
});

test('스프레이: 1~6발은 위로만, 8발째 약 7.85° 뒤 9° 아래에서 멈춤, 그 뒤 좌우로 흔들림', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const w = createWeapon();
    const still = { speed: 0, airborne: false, crouched: false };
    const rec = [];
    const rng = seeded(seed);
    for (let i = 0; i < 128 * 2.6; i++) {
      for (const s of stepWeapon(w, { fire: true, adsHeld: false }, still, DT, rng).shots) rec.push(s.recoil);
    }
    assert.equal(rec.length, 25);
    assert.equal(rec[0][0], 0);
    for (let n = 0; n < 6; n++) assert.equal(rec[n][1], 0, `보호 탄 ${n} 좌우 ${rec[n][1]}`);
    assert.ok(near(rec[7][0], 7.85, 0.01));
    assert.ok(Math.max(...rec.map((r) => r[0])) < 9.0);
    assert.ok(Math.max(...rec.map((r) => Math.abs(r[1]))) <= 2.8 + 1e-6);
    assert.ok(rec.slice(10).some((r) => Math.abs(r[1]) > 0.8), `시드 ${seed}: 좌우 흔들림 없음`);
  }
});

test('무기 바꾸면 꺼내는 1초 동안 못 쏜다', () => {
  const w = createWeapon();
  switchTo(w, 'knife');
  switchTo(w, 'vandal');
  assert.equal(fireFor(0.95, { w }), 0);
  assert.ok(fireFor(0.2, { w }) >= 1);
});

// ── 판정 ──
test('봇 판정: 머리 160 (한 방), 몸 40 × 4발, 다리 34', () => {
  const g = createGame(map, { ...BASE, mode: 'free' }, seeded(9));
  const bot = createBot(map, 40, 50, { face: 180 });
  g.bots.push(bot);
  const m = g.player.mover;
  m.x = 40;
  m.y = 40;
  const eye = 1.6;
  g.yaw = 0;
  g.pitch = (Math.atan2(1.66 - eye, 10) * 180) / Math.PI;
  g.input.fire = true;
  g.step();
  g.input.fire = false;
  const shot = g.events.find((e) => e.type === 'shot');
  assert.equal(shot.hitBot.part, 'head');
  assert.ok(shot.kill);
  for (let i = 0; i < 60; i++) g.step();
  const b2 = createBot(map, 40, 50, { face: 180 });
  g.bots = [b2];
  g.pitch = (Math.atan2(1.2 - eye, 10) * 180) / Math.PI;
  let kills = 0;
  let shots = 0;
  for (let k = 0; k < 4; k++) {
    g.events.length = 0;
    g.input.fire = true;
    g.step();
    g.input.fire = false;
    for (let i = 0; i < 60; i++) g.step();
    for (const e of g.events) if (e.type === 'shot') {
      shots++;
      assert.equal(e.hitBot && e.hitBot.part, 'body');
      if (e.kill) kills++;
    }
  }
  assert.equal(shots, 4);
  assert.equal(kills, 1);
});

test('봇 판정 박스는 바라보는 방향으로 돈다', () => {
  // 서쪽에서 동쪽으로 0.2m 비켜 쏨: 북쪽을 보면 옆모습(두께 0.16) → 빗나감, 서쪽을 보면 정면(폭 0.25) → 맞음
  const b = createBot(map, 0, 10, { face: 0 });
  assert.equal(rayBot(b, -10, 10.2, 1.2, 1, 0, 0, 50), null);
  b.face = 270;
  const hitFront = rayBot(b, -10, 10.2, 1.2, 1, 0, 0, 50);
  assert.ok(hitFront && hitFront.part === 'body');
});

test('반동 방향 계산: 오른쪽 + 위', () => {
  const d = offsetDir(0, 0, 10, 0);
  assert.ok(d[0] > 0.17 && d[1] > 0.98);
  const u = offsetDir(0, 0, 0, 10);
  assert.ok(u[2] > 0.17);
});

test('발로 크로스헤어 코드 읽기', () => {
  const c = parseCrosshairCode('0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0');
  assert.equal(c.color, '#00ffff');
  assert.equal(c.outline, false);
  assert.equal(c.inner.length, 4);
  assert.equal(c.inner.offset, 2);
  assert.equal(c.inner.opacity, 1);
  assert.equal(c.inner.fireError, false);
  assert.equal(c.outer.show, false);
  const custom = parseCrosshairCode('0;P;c;8;u;FF8800FF;d;1;z;3;0b;0;1b;0');
  assert.equal(custom.color, '#FF8800');
  assert.equal(custom.dot, true);
  assert.equal(custom.dotThickness, 3);
  assert.equal(parseCrosshairCode('hello'), null);
});

// ── 리뷰에서 찾은 문제들 (다시 생기지 않게) ──

test('첫 방문: 메뉴에서 크로스헤어를 바꿔도 기본값·코드 해석 기준이 안 바뀐다', () => {
  const s = loadSettings(null);
  assert.notEqual(s.crosshair, DEFAULT_CROSSHAIR);
  assert.notEqual(s.crosshair.inner, DEFAULT_CROSSHAIR.inner);
  s.crosshair.color = '#00ff00';
  s.crosshair.inner.length = 14;
  assert.equal(DEFAULT_CROSSHAIR.color, '#ffffff');
  assert.equal(parseCrosshairCode('0;P;h;0;0o;2;0a;1;0f;0;1b;0').inner.length, 6);
  assert.equal(loadSettings(null).crosshair.inner.length, 6);
});

test('조준(ADS) 상태로 누르고 쏘면 스프레이 패턴이 0~24번째 발까지 끊김 없이 이어진다', () => {
  for (const ads of [false, true]) {
    const w = createWeapon();
    const still = { speed: 0, airborne: false, crouched: false };
    if (ads) for (let i = 0; i < 64; i++) stepWeapon(w, { fire: false, adsHeld: true }, still, DT);
    const idx = [];
    for (let i = 0; i < 128 * 3.5 && idx.length < 25; i++) {
      for (const s of stepWeapon(w, { fire: true, adsHeld: ads }, still, DT, seeded(3)).shots) idx.push(s.index);
    }
    assert.deepEqual(idx, Array.from({ length: 25 }, (_, i) => i), ads ? 'ADS' : '지향사격');
  }
});

test('점프하다 높은 칸에 올라서도 위로 가던 속도가 남지 않는다 (나중에 저절로 뜨지 않음)', () => {
  const rng = seeded(11);
  for (let trial = 0; trial < 30; trial++) {
    const m = createMover(40, 40, 0);
    for (let i = 0; i < 128 * 2; i++) {
      const jump = rng() < 0.02;
      stepMover(m, map, { wx: rng() - 0.5, wy: rng() - 0.5, speed: 5.4, crouch: false, jump }, DT);
      if (m.onGround) assert.equal(m.vz, 0, `trial ${trial} tick ${i}`);
    }
  }
});

test('봇이 "보인다"는 건 화면 안에 있을 때만 (등 뒤는 미니맵·반응 시간에 안 들어감)', () => {
  const g = createGame(map, { ...BASE, mode: 'free' }, seeded(2));
  const b = createBot(map, 40, 52, { face: 180 });
  g.bots.push(b);
  g.player.mover.x = 40;
  g.player.mover.y = 44;
  g.yaw = 0;
  g.step();
  assert.equal(b.visible, true);
  g.yaw = 180;
  b.visibleSince = -1;
  g.step();
  assert.equal(b.visible, false);
  assert.equal(b.visibleSince, -1);
});

test('B 키: 보는 곳에 봇 놓기', () => {
  const g = createGame(map, { ...BASE, mode: 'free' }, seeded(2));
  g.pitch = -5;
  assert.ok(placeBotAtAim(g));
  assert.equal(g.bots.length, 1);
});
