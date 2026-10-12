// 발로란트 규칙: 방어구 66% 흡수, 태깅, 데스매치(40킬·9분, 1.5초 부활, 킬하면 탄창 가득, 회복팩, 부활 무적).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyDamage } from '../js/sim/game.js';
import { createBot } from '../js/sim/bots.js';
import { DEFAULTS } from '../js/sim/settings.js';
import { DM, VANDAL } from '../js/sim/valorant.js';
import { flatMap, seeded, near } from './helpers.mjs';

const BASE = { ...DEFAULTS, fight: 'off', dmBots: 4, dmBehavior: 'static' };

test('방어구 50: 맞을 때마다 66% 를 대신 받음 — 밴달 몸 4발, 머리 1발, 다리 5발', () => {
  const t = { hp: 100, armor: 50 };
  applyDamage(t, 40);
  assert.ok(near(t.hp, 86.4, 1e-9) && near(t.armor, 23.6, 1e-9));
  applyDamage(t, 40);
  assert.ok(near(t.hp, 70, 1e-9) && t.armor === 0);
  applyDamage(t, 40);
  assert.ok(near(t.hp, 30, 1e-9));
  applyDamage(t, 40);
  assert.ok(t.hp <= 0);
  const h = { hp: 100, armor: 50 };
  applyDamage(h, VANDAL.damage.head);
  assert.ok(h.hp <= 0);
  const l = { hp: 100, armor: 50 };
  for (let i = 0; i < 4; i++) applyDamage(l, VANDAL.damage.leg);
  assert.ok(l.hp > 0);
  applyDamage(l, VANDAL.damage.leg);
  assert.ok(l.hp <= 0);
});

function shootBot(g, b, part) {
  const m = g.player.mover;
  m.x = b.mover.x;
  m.y = b.mover.y - 10;
  g.yaw = 0;
  const z = part === 'head' ? 1.66 : 1.2;
  g.pitch = (Math.atan2(z - 1.6, 10) * 180) / Math.PI;
  g.input.fire = true;
  g.step();
  g.input.fire = false;
  for (let i = 0; i < 70; i++) g.step();
}

test('맞은 적은 72.5% 느려졌다가 0.4초 동안 돌아온다 (태깅)', () => {
  const map = flatMap();
  const g = createGame(map, { ...BASE, mode: 'free' }, seeded(1));
  const b = createBot(map, 30, 40, { behavior: 'strafe', axis: [1, 0], span: 6, face: 180 });
  g.bots.push(b);
  for (let i = 0; i < 128; i++) g.step();
  const before = Math.hypot(b.mover.vx, b.mover.vy);
  assert.ok(before > 4, `달리는 중 ${before}`);
  // 맞히기
  const m = g.player.mover;
  m.x = b.mover.x;
  m.y = b.mover.y - 10;
  g.yaw = 0;
  g.pitch = (Math.atan2(1.2 - 1.6, 10) * 180) / Math.PI;
  b.mover.tag = 1;
  let minV = Infinity;
  for (let i = 0; i < 20; i++) {
    g.step();
    minV = Math.min(minV, Math.hypot(b.mover.vx, b.mover.vy));
  }
  assert.ok(minV < before * 0.6, `태깅 뒤 ${minV}`);
});

test('데스매치: 킬하면 탄창 가득, 죽은 자리에 회복팩 10초 — 밟으면 체력 100 · 방어구 50', () => {
  const map = flatMap();
  const g = createGame(map, { ...BASE, mode: 'dm' }, seeded(3));
  const b = g.bots[0];
  g.bots = [b];
  b.behavior = 'static';
  b.mover.x = 30;
  b.mover.y = 40;
  g.weapon.ammo = 10;
  g.player.protect = 0;
  shootBot(g, b, 'head');
  assert.equal(b.alive, false);
  assert.equal(g.weapon.ammo, VANDAL.mag);
  assert.equal(g.packs.length, 1);
  const k = g.packs[0];
  g.player.hp = 20;
  g.player.armor = 0;
  const m = g.player.mover;
  m.x = k.x;
  m.y = k.y;
  g.step();
  assert.equal(g.player.hp, 100);
  assert.equal(g.player.armor, 50);
  assert.equal(g.packs.length, 0);
  // 아무도 안 밟으면 10초 뒤 사라짐
  g.packs.push({ x: 5, y: 5, z: 0, life: DM.healthPackLife });
  for (let i = 0; i < 128 * 10.2; i++) g.step();
  assert.equal(g.packs.length, 0);
});

test('데스매치: 죽으면 1.5초 뒤 부활 (체력 100 · 방어구 50), 부활하면 적 위치 알림, 움직이기 전까지 무적', () => {
  const map = flatMap(80, 80);
  const g = createGame(map, { ...BASE, mode: 'dm', fight: 'hard' }, seeded(5));
  const pl = g.player;
  pl.protect = 0;
  pl.hp = 1;
  pl.armor = 0;
  let died = false;
  let t = 0;
  for (let i = 0; i < 128 * 40 && !died; i++) {
    g.step();
    died = g.events.some((e) => e.type === 'died');
    g.events.length = 0;
  }
  assert.ok(died, '봇이 쏴서 죽어야 함');
  let reveal = null;
  for (; t < 128 * 2 && !g.player.alive; t++) {
    g.step();
    reveal ||= g.events.find((e) => e.type === 'reveal');
    g.events.length = 0;
  }
  assert.ok(near(t / 128, DM.respawn, 0.02), `부활까지 ${t / 128}초`);
  assert.ok(reveal && reveal.bots.length > 0);
  assert.equal(g.player.hp, 100);
  assert.equal(g.player.armor, 50);
  assert.ok(g.player.protect > 0);
  // 가만히 있으면 맞아도 안 다침
  const hp = g.player.hp;
  for (let i = 0; i < 128 * 3; i++) g.step();
  assert.equal(g.player.hp, hp);
  // 움직이면 무적 끝
  g.input.fwd = 1;
  g.step();
  g.input.fwd = 0;
  assert.equal(g.player.protect, 0);
});

test('데스매치: 40킬 하면 경기 끝 (승리), 9:00 이 지나도 끝', () => {
  const map = flatMap();
  const g = createGame(map, { ...BASE, mode: 'dm' }, seeded(7));
  g.match.kills = 39;
  const b = g.bots[0];
  b.mover.x = 30;
  b.mover.y = 40;
  g.player.protect = 0;
  shootBot(g, b, 'head');
  assert.equal(g.match.kills, 40);
  assert.ok(g.match.over);
  const t0 = g.time;
  g.step();
  assert.equal(g.time, t0, '끝난 뒤에는 시간이 멈춤');
  const g2 = createGame(map, { ...BASE, mode: 'dm' }, seeded(8));
  g2.match.timeLeft = 0.5;
  let end = null;
  for (let i = 0; i < 128 && !end; i++) {
    g2.step();
    end = g2.events.find((e) => e.type === 'matchEnd');
  }
  assert.ok(end && g2.match.over);
  const g3 = createGame(map, { ...BASE, mode: 'dm', matchRules: 'endless' }, seeded(9));
  g3.match.timeLeft = 0.1;
  for (let i = 0; i < 128; i++) g3.step();
  assert.equal(g3.match.over, false);
});
