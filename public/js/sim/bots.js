// 연습용 봇: 판정 박스(머리·몸·다리), 움직임(가만히 / AD 스트레이프 / 피킹 / 돌아다니기), 선택적으로 반격.
// 봇도 플레이어와 같은 이동 계산(가속·감속)을 써서 발로란트에서 보는 적 움직임과 같은 속도로 움직인다.

import { createMover, stepMover, horizSpeed, groundHeight } from './movement.js';
import { VANDAL, MOVE, HITBOX, HP_FULL } from './valorant.js';
import { rayBox } from './mapgrid.js';

const DEG = Math.PI / 180;
let nextId = 1;

/** heading(나침반 도) → 맵 평면 방향 벡터 */
export function headingVec(deg) {
  return [Math.sin(deg * DEG), Math.cos(deg * DEG)];
}

export function createBot(map, x, y, opts = {}) {
  const z = map.floorAt(x, y);
  return {
    id: nextId++,
    mover: createMover(x, y, z),
    face: opts.face ?? 0, // 바라보는 방향 (나침반 도)
    hp: HP_FULL,
    alive: true,
    deadFor: 0,
    behavior: opts.behavior || 'static',
    home: [x, y],
    // 스트레이프
    axis: opts.axis || [1, 0],
    span: opts.span ?? 3,
    dir: 0,
    timer: 0,
    crouchWanted: false,
    walk: false,
    // 피킹
    peeks: opts.peeks || null,
    lane: null,
    phase: 'hidden',
    target: null,
    // 돌아다니기
    points: opts.points || null,
    // 반격
    seeT: 0,
    fireCd: 0,
    shotsAtPlayer: 0,
    // 기록
    visibleSince: -1,
    spawnTime: 0,
    lastHitPart: null,
    ...opts.extra,
  };
}

/** 몸 판정 박스들 (봇 기준 좌표). 앉으면 머리·몸이 내려간다. */
export function botBoxes(bot) {
  const c = bot.mover.crouch * HITBOX.crouchDrop;
  const H = HITBOX;
  return [
    { part: 'head', hw: H.head.hw, hd: H.head.hd, z0: H.head.y0 - c, z1: H.head.y1 - c },
    { part: 'body', hw: H.body.hw, hd: H.body.hd, z0: H.body.y0 - c, z1: H.body.y1 - c },
    { part: 'leg', hw: H.leg.hw, hd: H.leg.hd, z0: H.leg.y0, z1: H.leg.y1 - c },
  ];
}

/** 광선 vs 봇. 반환 { t, part } (가장 가까운 부위) */
export function rayBot(bot, ox, oy, oz, dx, dy, dz, maxDist) {
  const m = bot.mover;
  // 봇 기준 좌표로 돌림 (face 방향이 로컬 +y)
  const a = bot.face * DEG;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rx = ox - m.x;
  const ry = oy - m.y;
  const lox = rx * ca - ry * sa;
  const loy = rx * sa + ry * ca;
  const ldx = dx * ca - dy * sa;
  const ldy = dx * sa + dy * ca;
  const loz = oz - m.z;
  let best = null;
  for (const b of botBoxes(bot)) {
    const h = rayBox(lox, loy, loz, ldx, ldy, dz, -b.hw, -b.hd, b.z0, b.hw, b.hd, b.z1);
    if (h && h.t <= maxDist && (!best || h.t < best.t)) best = { t: h.t, part: b.part };
  }
  return best;
}

/** 두 점 사이 시야가 트였는지 (벽·천장만 검사) */
export function lineOfSight(map, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-6) return true;
  const hit = map.raycast(ax, ay, az, dx / L, dy / L, dz / L, L);
  return !hit || hit.t >= L - 0.05;
}

/** a → b 를 걸어서 직선으로 갈 수 있는지 (벽·높은 턱·낭떠러지 없이) */
export function segmentWalkable(map, ax, ay, bx, by) {
  const L = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(L / 0.2));
  let z = map.floorAt(ax, ay);
  for (let k = 1; k <= n; k++) {
    const x = ax + ((bx - ax) * k) / n;
    const y = ay + ((by - ay) * k) / n;
    const g = groundHeight(map, x, y, z + MOVE.stepHeight);
    if (g === null || g < z - 0.5) return false;
    z = g;
  }
  return true;
}

export function respawnBot(bot, map, x, y, face) {
  const z = map.floorAt(x, y);
  bot.mover = createMover(x, y, z);
  bot.face = face ?? bot.face;
  bot.hp = HP_FULL;
  bot.alive = true;
  bot.deadFor = 0;
  bot.dir = 0;
  bot.timer = 0;
  bot.seeT = 0;
  bot.fireCd = 0;
  bot.visibleSince = -1;
  bot.home = [x, y];
  bot.target = null;
  bot.phase = 'hidden';
}

function rand(rng, a, b) {
  return a + (b - a) * rng();
}

/** 목표 지점으로 달려가되, 멈출 거리가 되면 키를 놓아서 자연스럽게 선다 */
function seek(bot, tx, ty) {
  const m = bot.mover;
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.hypot(dx, dy);
  const v = horizSpeed(m);
  const stopDist = (v * v) / (2 * MOVE.brake) + 0.05;
  if (d <= stopDist || d < 0.12) return { wx: 0, wy: 0, arrived: d < 0.35 && v < 0.6 };
  return { wx: dx / d, wy: dy / d, arrived: false };
}

/**
 * 봇 한 틱.
 * ctx: { map, dt, rng, player: {x,y,z,eye, alive}, now, fight: {enabled, reaction, accuracy, headRate} }
 * 반환: { shot?: {hit, part, dmg} }
 */
export function stepBot(bot, ctx) {
  const { map, dt, rng } = ctx;
  const out = {};
  if (!bot.alive) {
    bot.deadFor += dt;
    return out;
  }
  const m = bot.mover;
  let wx = 0;
  let wy = 0;
  const run = VANDAL.speed;
  const walk = VANDAL.speed * MOVE.walkMult;
  let speed = run;
  let crouch = false;

  // 플레이어가 보이는지 (반격·바라보기)
  const p = ctx.player;
  let sees = false;
  if (p && p.alive) {
    const eye = m.z + 1.55 - m.crouch * HITBOX.crouchDrop;
    sees = lineOfSight(map, m.x, m.y, eye, p.x, p.y, p.z + p.eye - 0.2);
  }

  switch (bot.behavior) {
    case 'strafe': {
      bot.timer -= dt;
      const ax = bot.axis[0];
      const ay = bot.axis[1];
      const off = (m.x - bot.home[0]) * ax + (m.y - bot.home[1]) * ay;
      if (bot.timer <= 0) {
        const r = rng();
        if (bot.dir !== 0 && r < 0.18) {
          bot.dir = 0; // 멈춰서 쏘는 척
          bot.timer = rand(rng, 0.18, 0.55);
          bot.crouchWanted = rng() < 0.15;
        } else {
          bot.dir = bot.dir === 0 ? (rng() < 0.5 ? -1 : 1) : r < 0.82 ? -bot.dir : bot.dir;
          bot.timer = rand(rng, 0.14, 0.62);
          bot.crouchWanted = false;
        }
      }
      if (off > bot.span && bot.dir > 0) bot.dir = -1;
      if (off < -bot.span && bot.dir < 0) bot.dir = 1;
      wx = ax * bot.dir;
      wy = ay * bot.dir;
      crouch = bot.crouchWanted;
      break;
    }
    case 'peek': {
      bot.timer -= dt;
      if (!bot.lane) bot.lane = bot.peeks[Math.floor(rng() * bot.peeks.length)];
      const lane = bot.lane;
      if (bot.phase === 'hidden') {
        const s = seek(bot, lane.hide[0], lane.hide[1]);
        wx = s.wx;
        wy = s.wy;
        if (bot.timer <= 0 && s.arrived) {
          bot.phase = 'out';
          // 넓게(와이드) 피킹하거나, 살짝(어깨) 피킹
          const dx = lane.peek[0] - lane.hide[0];
          const dy = lane.peek[1] - lane.hide[1];
          const L = Math.hypot(dx, dy) || 1;
          const style = rng();
          const extra = style < 0.25 ? -L * 0.55 : style < 0.55 ? rand(rng, 0.5, 1.8) : 0;
          bot.jiggle = style < 0.25;
          bot.target = [lane.peek[0] + (dx / L) * extra, lane.peek[1] + (dy / L) * extra];
          bot.walk = rng() < 0.1;
          bot.crouchWanted = rng() < 0.12;
        }
      } else if (bot.phase === 'out') {
        const s = seek(bot, bot.target[0], bot.target[1]);
        wx = s.wx;
        wy = s.wy;
        speed = bot.walk ? walk : run;
        if (s.wx === 0 && s.wy === 0) {
          bot.phase = 'hold';
          bot.timer = bot.jiggle ? rand(rng, 0.0, 0.12) : rand(rng, 0.35, 1.3);
        }
      } else if (bot.phase === 'hold') {
        crouch = bot.crouchWanted;
        if (bot.timer <= 0) {
          bot.phase = 'back';
        }
      } else if (bot.phase === 'back') {
        const s = seek(bot, lane.hide[0], lane.hide[1]);
        wx = s.wx;
        wy = s.wy;
        if (s.arrived) {
          bot.phase = 'hidden';
          bot.timer = rand(rng, 0.5, 2.4);
          bot.lane = bot.peeks[Math.floor(rng() * bot.peeks.length)];
        }
      }
      break;
    }
    case 'wander': {
      bot.timer -= dt;
      if (sees && ctx.fight && ctx.fight.enabled) {
        // 교전: 짧게 AD 하다가 멈춰서 쏜다
        bot.target = null;
        if (bot.timer <= 0) {
          bot.dir = rng() < 0.35 ? 0 : rng() < 0.5 ? -1 : 1;
          bot.timer = rand(rng, 0.15, 0.5);
        }
        const tx = p.x - m.x;
        const ty = p.y - m.y;
        const L = Math.hypot(tx, ty) || 1;
        wx = (-ty / L) * bot.dir;
        wy = (tx / L) * bot.dir;
        if (!segmentWalkable(map, m.x, m.y, m.x + wx * 0.6, m.y + wy * 0.6)) {
          bot.dir = -bot.dir;
          wx = -wx;
          wy = -wy;
        }
        break;
      }
      if (!bot.target) {
        if (bot.timer <= 0) {
          const choices = bot.points.filter(
            (q) => Math.hypot(q[0] - m.x, q[1] - m.y) > 1.5 && segmentWalkable(map, m.x, m.y, q[0], q[1]),
          );
          if (choices.length) {
            bot.target = choices[Math.floor(rng() * choices.length)];
            bot.walk = rng() < 0.3;
          } else {
            bot.timer = rand(rng, 1, 3);
          }
        }
      } else {
        const s = seek(bot, bot.target[0], bot.target[1]);
        wx = s.wx;
        wy = s.wy;
        speed = bot.walk ? walk : run;
        // 어딘가 걸려서 못 가면 포기
        bot.stuckT = horizSpeed(m) < 0.3 && (s.wx !== 0 || s.wy !== 0) ? (bot.stuckT || 0) + dt : 0;
        if (bot.stuckT > 0.8) {
          bot.stuckT = 0;
          s.wx = 0;
          s.wy = 0;
          wx = 0;
          wy = 0;
        }
        if (s.wx === 0 && s.wy === 0) {
          bot.target = null;
          bot.timer = rand(rng, 0.8, 3.5); // 도착하면 각 잡고 기다림
          bot.crouchWanted = rng() < 0.12;
        }
      }
      crouch = !bot.target && bot.crouchWanted;
      break;
    }
    default:
      break;
  }

  // 반격: 보이면 반응 시간 뒤에 멈춰서 쏜다
  if (ctx.fight && ctx.fight.enabled && sees) {
    bot.seeT += dt;
    if (bot.seeT >= ctx.fight.reaction) {
      wx = 0; // 쏠 때는 멈춘다 (발로 방식)
      wy = 0;
      bot.fireCd -= dt;
      if (bot.fireCd <= 0 && horizSpeed(m) <= VANDAL.speed * MOVE.accurateFrac) {
        bot.fireCd += 1 / VANDAL.fireRate;
        const dist = Math.hypot(p.x - m.x, p.y - m.y);
        const pMove = Math.min(1, (p.speed || 0) / VANDAL.speed);
        const chance = ctx.fight.accuracy * Math.max(0.15, 1 - dist / 70) * (1 - 0.5 * pMove);
        bot.shotsAtPlayer += 1;
        if (rng() < chance) {
          const head = rng() < ctx.fight.headRate;
          out.shot = { hit: true, part: head ? 'head' : 'body', dmg: head ? VANDAL.damage.head : VANDAL.damage.body };
        } else out.shot = { hit: false };
      }
    }
  } else {
    bot.seeT = Math.max(0, bot.seeT - dt * 2);
    bot.fireCd = Math.max(bot.fireCd, 0);
  }

  // 바라보는 방향
  let want = null;
  if (sees) want = (Math.atan2(p.x - m.x, p.y - m.y) / DEG + 360) % 360;
  else if (wx !== 0 || wy !== 0) want = (Math.atan2(wx, wy) / DEG + 360) % 360;
  if (want !== null) {
    let d = ((want - bot.face + 540) % 360) - 180;
    const maxTurn = 720 * dt;
    d = Math.max(-maxTurn, Math.min(maxTurn, d));
    bot.face = (bot.face + d + 360) % 360;
  }

  stepMover(m, map, { wx, wy, speed, crouch, jump: false }, dt);
  return out;
}
