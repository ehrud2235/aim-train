// 실제 바인드 맵 테스트: 지형 데이터, 이어짐, 텔레포터, 판정, 연습 자리, 봇.
import test from 'node:test';
import assert from 'node:assert/strict';
import { K } from '../js/sim/mapgrid.js';
import { BIND } from '../js/sim/bind.js';
import { createGame, holdSetup, duelSetup, navOf } from '../js/sim/game.js';
import { findPath } from '../js/sim/nav.js';
import { segmentWalkable, lineOfSight } from '../js/sim/bots.js';
import { DEFAULTS } from '../js/sim/settings.js';
import { loadBind, freshBind, seeded, near } from './helpers.mjs';
const BASE = { ...DEFAULTS, fight: 'off', matchRules: 'endless', dmBots: 8 };

const map = loadBind();
const at = (key) => map.regions.find((r) => r.key === key).at;

function nearestWalkable(x, y) {
  for (let r = 0; r <= 16; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = x + dx * 0.25;
        const py = y + dy * 0.25;
        if (map.walkable(px, py)) return [px, py];
      }
    }
  }
  return null;
}

test('실제 바인드: 크기·위치 이름·대표 높이', () => {
  assert.ok(map.x1 - map.x0 > 120 && map.y1 - map.y0 > 150, '맵 크기');
  assert.equal(map.regions.length, 24);
  for (const r of map.regions) assert.ok(nearestWalkable(...r.at), `${r.key} 근처에 걸을 곳 없음`);
  // A 사이트 1m, A 숏 2m, A 타워 4m, 후카(B 창문) 5m, B 사이트 3.6m 근처
  assert.ok(near(map.floorAt(...nearestWalkable(...at('aSite'))), 1.0, 0.3));
  assert.ok(near(map.floorAt(...nearestWalkable(...at('aTower'))), 4.0, 0.3));
  assert.ok(near(map.floorAt(...nearestWalkable(...at('bWindow'))), 5.0, 0.3));
  assert.ok(map.floorAt(...nearestWalkable(...at('bWindow'))) > map.floorAt(...nearestWalkable(...at('bSite'))) + 1, '후카가 B 사이트보다 높다');
});

test('공격 스폰에서 모든 위치까지 걸어서 갈 수 있다 (계단 35cm, 뛰어내리기). 텔레포터 출구 방은 안에서 나가기만', () => {
  const nav = navOf(map);
  const start = BIND.spawns.attacker.at;
  const fails = [];
  for (const r of map.regions) {
    const exitRoom = r.key === 'aExit' || r.key === 'bExit';
    // 콜아웃 점 6m 안의 바닥 중 한 곳이라도 (분수대 위처럼 점프해야 올라가는 곳은 제외되므로)
    let ok = false;
    for (let d = 0; d <= 6 && !ok; d += 1.5) {
      for (let a = 0; a < 360 && !ok; a += 45) {
        const gx = r.at[0] + Math.sin((a * Math.PI) / 180) * d;
        const gy = r.at[1] + Math.cos((a * Math.PI) / 180) * d;
        if (!map.walkable(gx, gy)) continue;
        const p = exitRoom ? findPath(nav, gx, gy, start[0], start[1], 200000) : findPath(nav, start[0], start[1], gx, gy, 200000);
        if (p) ok = true;
        if (d === 0) break;
      }
    }
    if (!ok) fails.push(r.key);
  }
  assert.deepEqual(fails, []);
});

test('텔레포터: A 숏 → B 출구, B 텔레포터 → A 출구 (보던 방향 유지)', () => {
  const g = createGame(freshBind(), { ...BASE, mode: 'free' }, seeded(3));
  const m = g.player.mover;
  for (const [id, exitKey] of [['A', 'bExit'], ['B', 'aExit']]) {
    const t = g.map.teleporters.find((x) => x.id === id);
    const [x0, y0, x1, y1] = t.pad;
    assert.ok(g.map.walkable((x0 + x1) / 2, (y0 + y1) / 2), `${id} 패드`);
    assert.ok(g.map.walkable(t.to[0], t.to[1]), `${id} 출구`);
    m.x = x1 + 2.5;
    m.y = (y0 + y1) / 2;
    m.z = g.map.floorAt(m.x, m.y);
    m.vx = m.vy = 0;
    g.yaw = 270;
    g.input.fwd = 1;
    let tele = null;
    for (let i = 0; i < 400 && !tele; i++) {
      g.step();
      tele = g.events.find((e) => e.type === 'teleport');
      g.events.length = 0;
    }
    g.input.fwd = 0;
    assert.ok(tele, `${id} 텔레포트 안 됨`);
    assert.equal(tele.id, id);
    assert.equal(g.map.regionAt(m.x, m.y).key, exitKey);
    for (let i = 0; i < 64; i++) g.step();
  }
});

test('총알: 바닥·벽에 맞고, 맵 밖으로 새지 않는다', () => {
  const p = nearestWalkable(...at('aSite'));
  const z = map.floorAt(...p);
  const down = map.raycast(p[0], p[1], z + 1.6, 0, 0, -1, 100);
  assert.ok(near(down.t, 1.6, 0.01) && down.nz === 1);
  for (let a = 0; a < 360; a += 15) {
    const dx = Math.sin((a * Math.PI) / 180);
    const dy = Math.cos((a * Math.PI) / 180);
    const hit = map.raycast(p[0], p[1], z + 1.6, dx, dy, 0, 300);
    assert.ok(hit && hit.t < 120, `방향 ${a}° 에서 벽에 안 맞음`);
  }
});

test('각 잡기: 자리마다 실제 지형의 모서리 2개 이상, 숨는 곳은 안 보이고 튀어나오는 곳은 보인다', () => {
  const g = createGame(map, { ...BASE, mode: 'free' }, seeded(1));
  for (const h of BIND.holds) {
    const { at: spot, lanes } = holdSetup(g, h);
    assert.ok(map.walkable(...spot), `${h.id} 자리`);
    assert.ok(lanes.length >= 2, `${h.id}: 모서리 ${lanes.length}개`);
    const eye = map.floorAt(...spot) + 1.6;
    for (const l of lanes) {
      const hz = map.floorAt(...l.hide) + 1.55;
      const pz = map.floorAt(...l.peek) + 1.55;
      assert.ok(!lineOfSight(map, spot[0], spot[1], eye, l.hide[0], l.hide[1], hz), `${h.id}: 숨는 곳이 보임 ${l.hide}`);
      assert.ok(lineOfSight(map, spot[0], spot[1], eye, l.peek[0], l.peek[1], pz), `${h.id}: 피킹 지점이 안 보임 ${l.peek}`);
      assert.ok(segmentWalkable(map, ...l.hide, ...l.peek) && segmentWalkable(map, ...l.peek, ...l.hide), `${h.id}: 길이 막힘`);
    }
  }
});

test('각 잡기: 봇이 계속 숨었다 나왔다 한다 (걸리거나 계속 보이는 채로 멈추지 않음)', () => {
  for (const h of BIND.holds) {
    for (let seed = 1; seed <= 3; seed++) {
      const g = createGame(map, { ...BASE, mode: 'hold', hold: h.id }, seeded(seed * 97 + 5));
      const T = 128 * 100;
      let vis = 0;
      let run = 0;
      let maxVis = 0;
      let hid = 0;
      let maxHid = 0;
      let last = -1;
      for (let i = 0; i < T; i++) {
        g.step();
        g.events.length = 0;
        const b = g.bots[0];
        if (b.visible) {
          vis++;
          run++;
          hid = 0;
          last = i;
        } else {
          run = 0;
          hid++;
        }
        maxVis = Math.max(maxVis, run);
        if (i > 128 * 5) maxHid = Math.max(maxHid, hid);
      }
      const f = vis / T;
      assert.ok(f > 0.02 && f < 0.75, `${h.id} ${seed}: 보이는 비율 ${f.toFixed(3)}`);
      assert.ok(maxVis < 128 * 12, `${h.id} ${seed}: ${(maxVis / 128).toFixed(1)}초 계속 보임`);
      assert.ok(maxHid < 128 * 15, `${h.id} ${seed}: ${(maxHid / 128).toFixed(1)}초 안 나옴`);
      assert.ok(last > T - 128 * 20, `${h.id} ${seed}: 마지막 20초 동안 안 나옴`);
    }
  }
});

test('1:1: 자리마다 봇이 보이는 곳에서 좌우로 움직인다', () => {
  for (const d of BIND.duels) {
    const g = createGame(map, { ...BASE, mode: 'duel', duel: d.id }, seeded(4));
    const s = duelSetup(g, d);
    assert.ok(map.walkable(...s.bot), `${d.id} 봇 자리`);
    let seen = 0;
    for (let i = 0; i < 128 * 4; i++) {
      g.step();
      g.events.length = 0;
      if (g.bots[0].visible) seen++;
    }
    assert.ok(seen > 128 * 3, `${d.id}: 봇이 잘 안 보임 (${seen})`);
  }
});

test('데스매치: 봇이 바인드 곳곳에 나오고 실제 길로 돌아다닌다', () => {
  const g = createGame(map, { ...BASE, mode: 'dm', dmBots: 8, dmBehavior: 'wander' }, seeded(2));
  assert.equal(g.bots.length, 8);
  const start = g.bots.map((b) => [b.mover.x, b.mover.y]);
  const regions = new Set();
  for (let i = 0; i < 128 * 45; i++) {
    g.step();
    g.events.length = 0;
    for (const b of g.bots) {
      const k = map.idx(b.mover.x, b.mover.y);
      assert.ok(k >= 0 && map.kind[k] !== K.WALL, `봇 ${b.id} 벽 속`);
      const r = map.regionAt(b.mover.x, b.mover.y);
      if (r) regions.add(r.key);
    }
  }
  const moved = g.bots.filter((b, i) => Math.hypot(b.mover.x - start[i][0], b.mover.y - start[i][1]) > 5).length;
  assert.ok(moved >= 5, `움직인 봇 ${moved}/8`);
  assert.ok(regions.size >= 6, `봇이 다닌 위치 ${regions.size}곳`);
});

test('반격 켜면 봇이 쏘고, 죽으면 1.5초 뒤 체력 100 · 방어구 50 으로 다시 시작', () => {
  const g = createGame(map, { ...BASE, mode: 'duel', duel: 'bLong25', fight: 'hard' }, seeded(7));
  let died = false;
  for (let i = 0; i < 128 * 30 && !died; i++) {
    g.step();
    died = g.events.some((e) => e.type === 'died');
    g.events.length = 0;
  }
  assert.ok(died);
  for (let i = 0; i < 128 * 1.6; i++) g.step();
  assert.ok(g.player.alive && g.player.hp === 100 && g.player.armor === 50);
});
