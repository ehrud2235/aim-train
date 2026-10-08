// 발로란트 수치·맵·판정 테스트: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { BIND } from '../js/sim/bind.js';
import { buildMap, K } from '../js/sim/mapgrid.js';
import { createMover, stepMover, maxSpeed, horizSpeed, groundHeight } from '../js/sim/movement.js';
import { createWeapon, stepWeapon, movementError, currentSpread, switchTo } from '../js/sim/weapon.js';
import { createBot, rayBot, segmentWalkable } from '../js/sim/bots.js';
import { createGame, DT, offsetDir, placeBotAtAim } from '../js/sim/game.js';
import { cmPer360, zoomedHfov, VANDAL, MOVE, YAW_PER_COUNT } from '../js/sim/valorant.js';
import { DEFAULTS, parseCrosshairCode } from '../js/sim/settings.js';

const map = buildMap(BIND);
const near = (a, b, eps) => Math.abs(a - b) <= eps;

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── 감도 ──
test('감도 0.4 / 800 DPI → 1카운트 0.028°, 360° 약 40.8cm', () => {
  assert.ok(near(YAW_PER_COUNT * 0.4, 0.028, 1e-9));
  assert.ok(near(cmPer360(800, 0.4), 40.82, 0.01));
});

test('밴달 조준 1.25배 → 가로 시야 약 90.3°', () => {
  assert.ok(near(zoomedHfov(1.25), 90.3, 0.1));
});

// ── 이동 ──
function runFlat(ticks, input, m = createMover(0, 7, 0)) {
  for (let i = 0; i < ticks; i++) stepMover(m, map, input, DT);
  return m;
}

test('밴달 들고 달리면 5.4 m/s, 걷기 약 2.98, 조준 4.104, 칼 6.75', () => {
  const run = runFlat(128, { wx: 1, wy: 0, speed: maxSpeed(VANDAL.speed, {}), crouch: false, jump: false }, createMover(-8, 7, 0));
  assert.ok(near(horizSpeed(run), 5.4, 1e-6));
  assert.ok(near(maxSpeed(VANDAL.speed, { walk: true }), 2.984, 0.01));
  assert.ok(near(maxSpeed(VANDAL.speed, { ads: true, adsSpeedMult: VANDAL.adsSpeedMult }), 4.104, 1e-6));
  assert.ok(near(maxSpeed(6.75, {}), 6.75, 1e-9));
});

test('키를 놓으면 0.1초 안에 정확 사격 속도(27.5%)까지 떨어지고, 반대키(카운터 스트레이핑)가 조금 더 빠르다', () => {
  const thr = VANDAL.speed * MOVE.accurateFrac;
  const timeToAccurate = (counter) => {
    const m = runFlat(128, { wx: 1, wy: 0, speed: 5.4, crouch: false, jump: false }, createMover(-8, 7, 0));
    let t = 0;
    while (horizSpeed(m) > thr && t < 1) {
      stepMover(m, map, { wx: counter ? -1 : 0, wy: 0, speed: 5.4, crouch: false, jump: false }, DT);
      t += DT;
    }
    return t;
  };
  const release = timeToAccurate(false);
  const counter = timeToAccurate(true);
  assert.ok(release < 0.1, `놓기 ${release}`);
  assert.ok(counter < release, `카운터 ${counter} < 놓기 ${release}`);
});

test('점프: 약 0.9~1.1m 뜨고 착지한다', () => {
  const m = createMover(0, 7, 0);
  let peak = 0;
  stepMover(m, map, { wx: 0, wy: 0, speed: 5.4, crouch: false, jump: true }, DT);
  for (let i = 0; i < 200; i++) {
    stepMover(m, map, { wx: 0, wy: 0, speed: 5.4, crouch: false, jump: false }, DT);
    peak = Math.max(peak, m.z);
  }
  assert.ok(peak > 0.85 && peak < 1.15, `높이 ${peak}`);
  assert.ok(m.onGround && m.z === 0);
});

test('벽을 뚫고 지나가지 못한다 (공격 스폰 → 정면 벽)', () => {
  const m = createMover(0, 14, 0);
  runFlat(400, { wx: 0, wy: 1, speed: 6.75, crouch: false, jump: false }, m);
  assert.ok(m.y < 16, `y=${m.y}`);
});

test('계단을 올라 헤븐(3m)에 갈 수 있다', () => {
  const m = createMover(-40, 50, 0);
  runFlat(500, { wx: 0, wy: 1, speed: 5.4, crouch: false, jump: false }, m);
  assert.ok(near(m.z, 3, 0.01), `z=${m.z}`);
});

// ── 맵 ──
test('바인드: 모든 위치가 공격 스폰에서 걸어서(계단·창문 포함) 이어져 있다', () => {
  const { nx, ny, top, kind } = map;
  const start = map.idx(0, 7);
  const seen = new Uint8Array(nx * ny);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const k = q.pop();
    const i = k % nx;
    const j = (k / nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a;
      if (seen[n] || kind[n] === K.WALL) continue;
      // 위로는 점프(1.1m)까지, 아래로는 어디든
      if (top[n] - top[k] > 1.1) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  // 문은 열 수 있으니 텔레 출구 방은 문을 연 상태로 본다 → 대신 출구 방은 텔레로 도달
  const unreachable = new Set();
  for (const r of map.regions) {
    const k = map.idx(r.at[0], r.at[1]);
    assert.ok(k >= 0 && kind[k] !== K.WALL, `${r.key} 라벨 위치가 벽 속`);
    if (!seen[k] && !r.key.endsWith('TeleExit')) unreachable.add(r.key);
  }
  assert.deepEqual([...unreachable], []);
});

test('텔레포터 패드·출구가 걸을 수 있는 곳이고, 출구 방 문이 열리면 밖으로 나갈 수 있다', () => {
  for (const t of map.teleporters) {
    const [x0, y0, x1, y1] = t.pad;
    assert.ok(map.walkable((x0 + x1) / 2, (y0 + y1) / 2), `${t.id} 패드`);
    assert.ok(map.walkable(t.to[0], t.to[1]), `${t.id} 출구`);
  }
  const g = createGame(map, { ...DEFAULTS, mode: 'free' }, seeded(3));
  // A 텔레: A 숏에서 동쪽으로 걸어 들어감
  const m = g.player.mover;
  m.x = -22;
  m.y = 28.5;
  g.yaw = 90;
  g.input.fwd = 1;
  let tele = null;
  for (let i = 0; i < 300 && !tele; i++) {
    g.step();
    tele = g.events.find((e) => e.type === 'teleport');
  }
  assert.ok(tele, '텔레포트 됨');
  assert.equal(tele.id, 'A');
  assert.ok(g.map.regionAt(m.x, m.y).key === 'bTeleExit');
  // 출구에서 남쪽(문)으로 걸어나가면 B 숏
  g.input.fwd = 0;
  g.yaw = 180;
  m.x = 19;
  g.input.fwd = 1;
  for (let i = 0; i < 400; i++) g.step();
  assert.equal(g.map.regionAt(m.x, m.y).key, 'bShort');
});

test('총알: 공격 스폰 가운데에서 북쪽으로 쏘면 16m 벽에 맞는다', () => {
  const hit = map.raycast(0, 7, 1.6, 0, 1, 0, 100);
  assert.ok(hit && near(hit.t, 9, 0.01), JSON.stringify(hit));
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [0, -1, 0]);
  const down = map.raycast(0, 7, 1.6, 0, 0, -1, 100);
  assert.ok(near(down.t, 1.6, 1e-6) && down.nz === 1);
});

test('후카 창문은 사람이 지나갈 높이, 창문 위 벽은 총알을 막는다', () => {
  // 창문 앞 B 사이트에서 후카 쪽(남쪽)으로 수평 사격: 0.9~2.9m 는 통과
  const through = map.raycast(23.5, 44, 1.6, 0, -1, 0, 100);
  assert.ok(through.t > 8, `t=${through.t}`);
  const lintel = map.raycast(23.5, 44, 3.5, 0, -1, 0, 100);
  assert.ok(near(lintel.t, 4, 0.01), `t=${lintel.t}`);
});

test('걸어서 직선 이동 가능 여부', () => {
  assert.ok(segmentWalkable(map, -50, 40, -34, 40));
  assert.ok(!segmentWalkable(map, 0, 7, 0, 30)); // 미드 없음
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

test('첫 발은 0.25° (조준 0.157°), 움직이면 오차, 27.5% 이하 속도면 오차 0', () => {
  const w = createWeapon();
  assert.ok(near(currentSpread(w, { speed: 0, airborne: false }).total, 0.25, 1e-9));
  assert.equal(movementError(VANDAL.speed * 0.27, false), 0);
  assert.ok(movementError(VANDAL.speed * 0.6, false) > 1);
  assert.equal(movementError(VANDAL.speed, false), VANDAL.runError);
  assert.equal(movementError(0, true), VANDAL.jumpError);
});

test('끊어 쏘기(탭)는 반동이 회복되어 매번 첫 발 정확도', () => {
  const w = createWeapon();
  const still = { speed: 0, airborne: false, crouched: false };
  const idx = [];
  for (let k = 0; k < 5; k++) {
    let fired = false;
    for (let i = 0; i < 128 * 0.4; i++) {
      const r = stepWeapon(w, { fire: !fired, adsHeld: false }, still, DT);
      if (r.shots.length) {
        idx.push(r.shots[0].index);
        fired = true;
      }
    }
  }
  assert.deepEqual(idx, [0, 0, 0, 0, 0]);
});

test('스프레이: 처음엔 위로, 10발 넘어가면 옆으로', () => {
  const w = createWeapon();
  const still = { speed: 0, airborne: false, crouched: false };
  const rec = [];
  for (let i = 0; i < 128 * 1.5; i++) {
    for (const s of stepWeapon(w, { fire: true, adsHeld: false }, still, DT, seeded(5)).shots) rec.push(s.recoil);
  }
  assert.equal(rec[0][0], 0);
  assert.ok(rec[4][0] > 1.5 && Math.abs(rec[4][1]) < 0.2);
  assert.ok(rec[12][0] > 5 && Math.abs(rec[12][1]) > 0.8);
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
  const g = createGame(map, { ...DEFAULTS, mode: 'free' }, seeded(9));
  const bot = createBot(map, 0, 12, { face: 180 });
  g.bots.push(bot);
  const m = g.player.mover;
  m.x = 0;
  m.y = 2;
  // 머리 높이를 정확히 조준
  const eye = 1.6;
  const headZ = 1.66;
  g.yaw = 0;
  g.pitch = (Math.atan2(headZ - eye, 10) * 180) / Math.PI;
  g.input.fire = true;
  g.step();
  g.input.fire = false;
  const shot = g.events.find((e) => e.type === 'shot');
  assert.equal(shot.hitBot.part, 'head');
  assert.ok(shot.kill);
  assert.equal(g.stats.kills, 1);

  for (let i = 0; i < 60; i++) g.step();
  const b2 = createBot(map, 0, 12, { face: 180 });
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
  assert.equal(b2.alive, false);
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

test('모드별 시작: 데스매치 봇 8명이 맵 곳곳에, 각 잡기·1:1 은 봇 1명', () => {
  const dm = createGame(map, { ...DEFAULTS, mode: 'dm', dmBots: 8 }, seeded(2));
  assert.equal(dm.bots.length, 8);
  for (const b of dm.bots) assert.ok(map.walkable(b.mover.x, b.mover.y));
  for (let i = 0; i < 128 * 5; i++) dm.step();
  for (const b of dm.bots) assert.ok(map.walkable(b.mover.x, b.mover.y), `봇 ${b.id} 벽 속`);
  for (const id of BIND.holds.map((h) => h.id)) {
    const g = createGame(map, { ...DEFAULTS, mode: 'hold', hold: id }, seeded(4));
    assert.equal(g.bots.length, 1);
    // 피킹 봇이 일정 시간 안에 한 번은 보여야 한다
    let seen = false;
    for (let i = 0; i < 128 * 8 && !seen; i++) {
      g.step();
      seen = g.bots[0].visible;
    }
    assert.ok(seen, `${id}: 피킹 봇이 안 보임`);
  }
  for (const id of BIND.duels.map((d) => d.id)) {
    const g = createGame(map, { ...DEFAULTS, mode: 'duel', duel: id }, seeded(4));
    for (let i = 0; i < 128 * 3; i++) g.step();
    assert.ok(g.bots[0].visible, `${id}: 1:1 봇이 안 보임`);
  }
});

test('B 키: 보는 곳에 봇 놓기', () => {
  const g = createGame(map, { ...DEFAULTS, mode: 'free' }, seeded(2));
  g.pitch = -5;
  assert.ok(placeBotAtAim(g));
  assert.equal(g.bots.length, 1);
});

test('반격 켜면 봇이 쏘고, 죽으면 2초 뒤 다시 시작', () => {
  const g = createGame(map, { ...DEFAULTS, mode: 'duel', duel: 'spawn20', fight: 'hard' }, seeded(7));
  let died = false;
  for (let i = 0; i < 128 * 20 && !died; i++) {
    g.step();
    died = g.events.some((e) => e.type === 'died');
    g.events.length = 0;
  }
  assert.ok(died);
  for (let i = 0; i < 128 * 2.2; i++) g.step();
  assert.ok(g.player.alive && g.player.hp === 150);
});

// ── 크로스헤어 코드 ──
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

test('바닥 높이 확인용: 후카는 0.9m 높다', () => {
  assert.ok(near(groundHeight(map, 26, 34, 5), 0.9, 1e-6));
});

// ── 리뷰에서 찾은 문제들 (다시 생기지 않게) ──
import { loadSettings, DEFAULT_CROSSHAIR } from '../js/sim/settings.js';

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

test('점프하다 계단 턱에 올라서도 위로 가던 속도가 남지 않는다 (나중에 저절로 뜨지 않음)', () => {
  const rng = seeded(11);
  for (let trial = 0; trial < 40; trial++) {
    const m = createMover(28, 16 + rng() * 2, 0);
    for (let i = 0; i < 128 * 3; i++) {
      const jump = i === Math.floor(rng() * 200) || rng() < 0.01;
      stepMover(m, map, { wx: (rng() - 0.5) * 0.3, wy: 1, speed: 5.4, crouch: false, jump }, DT);
      if (m.onGround) assert.equal(m.vz, 0, `trial ${trial} tick ${i}`);
    }
  }
  // 후카 계단에서 점프 → 후카 → 창문으로 걸어 나가면 0.9m 만 떨어지고 위로 뜨지 않는다
  const m = createMover(28, 19.3, 0);
  stepMover(m, map, { wx: 0, wy: 1, speed: 5.4, crouch: false, jump: true }, DT);
  for (let i = 0; i < 128 * 2; i++) stepMover(m, map, { wx: 0, wy: 1, speed: 5.4, crouch: false, jump: false }, DT);
  m.x = 23.5;
  m.y = 37;
  let peak = m.z;
  for (let i = 0; i < 128 * 2; i++) {
    stepMover(m, map, { wx: 0, wy: 1, speed: 5.4, crouch: false, jump: false }, DT);
    peak = Math.max(peak, m.z);
  }
  assert.ok(peak <= 0.9 + 1e-6, `peak ${peak}`);
});

test('각 잡기 데이터: 숨는 곳 → (경유) → 피킹 지점이 왕복으로 걸어서 이어지고, 숨는 곳은 내 자리에서 안 보인다', () => {
  for (const h of BIND.holds) {
    const eye = map.floorAt(h.at[0], h.at[1]) + 1.6;
    for (const l of h.peeks) {
      const pts = l.via ? [l.hide, l.via, l.peek] : [l.hide, l.peek];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        assert.ok(segmentWalkable(map, a[0], a[1], b[0], b[1]), `${h.id}: ${a} → ${b}`);
        assert.ok(segmentWalkable(map, b[0], b[1], a[0], a[1]), `${h.id}: ${b} → ${a}`);
      }
      const hz = map.floorAt(l.hide[0], l.hide[1]) + 1.55;
      const hit = map.raycast(h.at[0], h.at[1], eye, ...(() => {
        const d = [l.hide[0] - h.at[0], l.hide[1] - h.at[1], hz - eye];
        const L = Math.hypot(...d);
        return [d[0] / L, d[1] / L, d[2] / L, L];
      })());
      assert.ok(hit, `${h.id}: 숨는 곳 ${l.hide} 이 내 자리에서 보임`);
      // 피킹 지점은 내 자리에서 보여야 연습이 됨
      const pz = map.floorAt(l.peek[0], l.peek[1]) + 1.55;
      const d = [l.peek[0] - h.at[0], l.peek[1] - h.at[1], pz - eye];
      const L = Math.hypot(...d);
      const ph = map.raycast(h.at[0], h.at[1], eye, d[0] / L, d[1] / L, d[2] / L, L);
      assert.ok(!ph || ph.t >= L - 0.05, `${h.id}: 피킹 지점 ${l.peek} 이 내 자리에서 안 보임`);
    }
  }
});

test('각 잡기: 모든 자리에서 봇이 계속 숨었다 나왔다 한다 (걸리거나 계속 보이는 채로 멈추지 않음)', () => {
  for (const h of BIND.holds) {
    for (let seed = 1; seed <= 6; seed++) {
      const g = createGame(map, { ...DEFAULTS, mode: 'hold', hold: h.id }, seeded(seed * 97 + 5));
      const T = 128 * 150;
      let visTicks = 0;
      let run = 0;
      let maxVisRun = 0;
      let hiddenRun = 0;
      let maxHiddenRun = 0;
      let lastSeen = -1;
      for (let i = 0; i < T; i++) {
        g.step();
        g.events.length = 0;
        const b = g.bots[0];
        assert.ok(map.walkable(b.mover.x, b.mover.y), `${h.id}: 봇이 벽 속`);
        if (b.visible) {
          visTicks++;
          run++;
          hiddenRun = 0;
          lastSeen = i;
        } else {
          run = 0;
          hiddenRun++;
        }
        maxVisRun = Math.max(maxVisRun, run);
        if (i > 128 * 5) maxHiddenRun = Math.max(maxHiddenRun, hiddenRun);
      }
      const frac = visTicks / T;
      assert.ok(frac > 0.02 && frac < 0.75, `${h.id} seed ${seed}: 보이는 비율 ${frac.toFixed(3)}`);
      // 먼 길(U홀 → 램프)을 걸어서 가로지르면 실제로도 그동안 보이므로 12초까지는 정상
      assert.ok(maxVisRun < 128 * 12, `${h.id} seed ${seed}: ${(maxVisRun / 128).toFixed(1)}초 동안 계속 보임`);
      assert.ok(maxHiddenRun < 128 * 15, `${h.id} seed ${seed}: ${(maxHiddenRun / 128).toFixed(1)}초 동안 안 나옴`);
      assert.ok(lastSeen > T - 128 * 20, `${h.id} seed ${seed}: 마지막 20초 동안 한 번도 안 나옴`);
    }
  }
});

test('봇이 "보인다"는 건 화면 안에 있을 때만 (등 뒤는 미니맵·반응 시간에 안 들어감)', () => {
  const g = createGame(map, { ...DEFAULTS, mode: 'free' }, seeded(2));
  const b = createBot(map, 0, 12, { face: 180 });
  g.bots.push(b);
  g.player.mover.x = 0;
  g.player.mover.y = 4;
  g.yaw = 0;
  g.step();
  assert.equal(b.visible, true);
  g.yaw = 180;
  b.visibleSince = -1;
  g.step();
  assert.equal(b.visible, false);
  assert.equal(b.visibleSince, -1);
});
