// 연습장 한 판의 계산: 플레이어, 밴달, 봇, 모드, 기록, 텔레포터, 문.
// 화면·소리는 client 쪽이 events 를 받아서 처리한다.

import { TICK_HZ, VANDAL, HP_MAX, ARMOR_HEAVY, ARMOR_ABSORB, MOVE, HFOV, DM, AGENTS, zoomedHfov } from './valorant.js';
import { createMover, stepMover, maxSpeed, eyeHeight, accuracyState, horizSpeed } from './movement.js';
import { createWeapon, stepWeapon, weaponSpeed, isAds, currentRecoil, shotPunch, switchTo, startReload } from './weapon.js';
import { createBot, stepBot, rayBot, respawnBot, lineOfSight, headingVec, segmentWalkable } from './bots.js';
import { buildNav, navNodes, nodePos } from './nav.js';
import { autoLanes, autoDuel, snapSpot } from './spots.js';
import { FIGHT_LEVELS } from './settings.js';

const DEG = Math.PI / 180;
export const DT = 1 / TICK_HZ;
const MAX_RANGE = 200;
const FOOT_STRIDE = 1.7; // 이만큼 달릴 때마다 발소리

/** heading/pitch(°) → 방향 벡터와 오른쪽·위 벡터 */
export function aimBasis(heading, pitch) {
  const h = heading * DEG;
  const p = pitch * DEG;
  const ch = Math.cos(h);
  const sh = Math.sin(h);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  return {
    f: [sh * cp, ch * cp, sp],
    r: [ch, -sh, 0],
    u: [-sh * sp, -ch * sp, cp],
  };
}

/** 조준 방향에서 (오른쪽 °, 위 °) 만큼 틀어진 방향 */
export function offsetDir(heading, pitch, rightDeg, upDeg) {
  const { f, r, u } = aimBasis(heading, pitch);
  const tr = Math.tan(rightDeg * DEG);
  const tu = Math.tan(upDeg * DEG);
  const d = [f[0] + r[0] * tr + u[0] * tu, f[1] + r[1] * tr + u[1] * tu, f[2] + r[2] * tr + u[2] * tu];
  const L = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / L, d[1] / L, d[2] / L];
}

export function newStats() {
  return {
    shots: 0,
    hits: 0,
    head: 0,
    body: 0,
    leg: 0,
    kills: 0,
    deaths: 0,
    accurateShots: 0,
    firstShots: 0, // 연사 첫 발
    firstShotHeads: 0,
    reactions: [], // 봇이 보이고 나서 죽이기까지 (초)
    ttks: [], // 첫 명중 → 킬 (초)
    startedAt: 0,
  };
}

export function createGame(map, settings, rng = Math.random) {
  const g = {
    map,
    settings,
    rng,
    time: 0,
    player: null,
    weapon: null,
    bots: [],
    stats: newStats(),
    events: [],
    input: { fwd: 0, back: 0, left: 0, right: 0, walk: false, crouch: false, jump: false, fire: false, ads: false },
    yaw: 0,
    pitch: 0,
    modeStart: null,
    teleCd: 0,
    footDist: 0,
    lastRegion: null,
    match: null, // 데스매치: { kills, deaths, timeLeft, target, over, winner }
    packs: [], // 데스매치 회복팩 { x, y, z, life }
  };
  g.reset = () => resetMode(g);
  g.step = () => stepGame(g);
  resetMode(g);
  return g;
}

function fightCfg(g) {
  return FIGHT_LEVELS[g.settings.fight] || FIGHT_LEVELS.off;
}

function placePlayer(g, at, heading) {
  const [x, y] = g.map.walkable(at[0], at[1]) ? at : snapSpot(navOf(g.map), at[0], at[1]);
  g.player = {
    mover: createMover(x, y, g.map.floorAt(x, y)),
    hp: HP_MAX,
    armor: ARMOR_HEAVY,
    alive: true,
    deadFor: 0,
    // 부활 무적: 데스매치에서 움직이거나 쏘기 전까지
    protect: g.settings.mode === 'dm' ? DM.spawnProtect : 0,
    killer: null,
    taken: [], // 이번 목숨에 받은 피해 { bot, part, dmg }
    dealt: new Map(), // 이번 목숨에 준 피해 bot.id → { dmg, head, body, leg }
  };
  g.yaw = heading;
  g.pitch = 0;
}

/** 맞으면 방어구가 피해의 66% 를 대신 받고(남은 만큼만) 나머지는 체력에서. 반환: 실제로 깎인 양 (체력+방어구) */
export function applyDamage(t, dmg) {
  const armor = t.armor || 0;
  const a = Math.min(armor, dmg * ARMOR_ABSORB);
  const before = Math.max(0, t.hp) + armor;
  t.armor = armor - a;
  t.hp -= dmg - a;
  return before - (Math.max(0, t.hp) + t.armor);
}

/** 봇 이름·요원: 내 요원과 겹치지 않게 차례대로 */
function nameBot(g, b, i) {
  const pool = AGENTS.filter((a) => a.key !== g.settings.agent);
  const a = pool[i % pool.length];
  b.agent = a.key;
  b.name = a.name;
  b.kills = 0;
  b.deaths = 0;
}

/** 봇 체력 100 + 중방어구 50 (연습장 '적 방어구' 끄면 방어구 0) */
function equipBot(g, b) {
  b.hp = HP_MAX;
  b.armor = g.settings.botArmor === false ? 0 : ARMOR_HEAVY;
}

export function resetMode(g) {
  const def = g.map.def;
  const s = g.settings;
  g.bots = [];
  g.events.push({ type: 'reset' });
  g.weapon = createWeapon({ infiniteReserve: s.infiniteReserve });
  g.weapon.equip = 0;
  g.stats = newStats();
  g.stats.startedAt = g.time;
  g.packs = [];
  g.match = s.mode === 'dm' ? { kills: 0, deaths: 0, timeLeft: DM.timeLimit, target: DM.killTarget, over: false, endless: s.matchRules === 'endless' } : { kills: 0, deaths: 0, elapsed: 0, over: false, endless: true };
  for (const d of g.map.doors) g.map.setDoor(d, false);

  if (s.mode === 'hold') {
    const h = def.holds.find((x) => x.id === s.hold) || def.holds[0];
    const { at, lanes } = holdSetup(g, h);
    g.modeStart = { at, heading: h.heading };
    placePlayer(g, at, h.heading);
    const lane = lanes[Math.floor(g.rng() * lanes.length)];
    const b = createBot(g.map, lane.hide[0], lane.hide[1], { behavior: 'peek', peeks: lanes });
    b.lane = lane;
    b.timer = 0.8;
    g.bots.push(b);
    nameBot(g, b, 0);
  } else if (s.mode === 'duel') {
    const d = def.duels.find((x) => x.id === s.duel) || def.duels[0];
    const setup = duelSetup(g, d);
    g.modeStart = { at: setup.at, heading: d.heading };
    placePlayer(g, setup.at, d.heading);
    const toPlayer = (Math.atan2(setup.at[0] - setup.bot[0], setup.at[1] - setup.bot[1]) / DEG + 360) % 360;
    g.bots.push(
      createBot(g.map, setup.bot[0], setup.bot[1], {
        behavior: s.duelBehavior === 'static' ? 'static' : 'strafe',
        axis: setup.axis,
        span: d.span,
        face: toPlayer,
      }),
    );
    nameBot(g, g.bots[0], 0);
  } else if (s.mode === 'dm') {
    const sp = def.spawns.attacker;
    g.modeStart = { at: sp.at, heading: sp.heading };
    placePlayer(g, sp.at, sp.heading);
    const n = Math.max(1, Math.min(16, s.dmBots | 0));
    for (let i = 0; i < n; i++) {
      const b = createBot(g.map, sp.at[0], sp.at[1], {});
      g.bots.push(b);
      nameBot(g, b, i);
      dmRespawn(g, b, true);
    }
  } else {
    const sp = def.spawns.attacker;
    g.modeStart = { at: sp.at, heading: sp.heading };
    placePlayer(g, sp.at, sp.heading);
  }
  for (const b of g.bots) equipBot(g, b);
}

/** 맵마다 한 번: 봇 길찾기 격자 */
export function navOf(map) {
  if (!map.nav) map.nav = buildNav(map);
  return map.nav;
}

/** 각 잡기 자리: 내 자리(내비 칸에 맞춤) + 실제 지형에서 찾은 모서리들 (맵마다 한 번 계산) */
export function holdSetup(g, h) {
  const cache = (g.map.holdCache ||= {});
  if (!cache[h.id]) {
    const nav = navOf(g.map);
    const at = snapSpot(nav, h.at[0], h.at[1]);
    const lanes = autoLanes(g.map, nav, at, h.heading, { maxDist: h.maxDist || 42 });
    cache[h.id] = { at, lanes };
  }
  return cache[h.id];
}

export function duelSetup(g, d) {
  const cache = (g.map.duelCache ||= {});
  if (!cache[d.id]) {
    const nav = navOf(g.map);
    const at = snapSpot(nav, d.at[0], d.at[1]);
    const r = autoDuel(g.map, nav, at, d.heading, d.dist, d.span) || {
      bot: [at[0] + Math.sin(d.heading * DEG) * d.dist, at[1] + Math.cos(d.heading * DEG) * d.dist],
      axis: [Math.cos(d.heading * DEG), -Math.sin(d.heading * DEG)],
    };
    cache[d.id] = { at, bot: r.bot, axis: r.axis };
  }
  return cache[d.id];
}

function dmBehavior(g) {
  const mode = g.settings.dmBehavior;
  if (mode === 'static' || mode === 'strafe' || mode === 'wander') return mode;
  const r = g.rng();
  return r < 0.6 ? 'wander' : r < 0.8 ? 'strafe' : 'static';
}

/** 데스매치 봇 다시 놓기: 맵 아무 데나(플레이어에게서 12m 이상, 보이지 않는 곳) */
function dmRespawn(g, bot, initial = false) {
  const nav = navOf(g.map);
  const nodes = navNodes(nav);
  const p = g.player.mover;
  const eye = p.z + eyeHeight(p);
  for (let tries = 0; tries < 60; tries++) {
    const [jx, jy] = nodePos(nav, nodes[Math.floor(g.rng() * nodes.length)]);
    const d = Math.hypot(jx - p.x, jy - p.y);
    if (d < 12) continue;
    const z = g.map.floorAt(jx, jy);
    if (!initial && tries < 45 && lineOfSight(g.map, p.x, p.y, eye, jx, jy, z + 1.5)) continue;
    if (g.bots.some((o) => o !== bot && o.alive && Math.hypot(o.mover.x - jx, o.mover.y - jy) < 3)) continue;
    respawnBot(bot, g.map, jx, jy, g.rng() * 360);
    equipBot(g, bot);
    bot.behavior = dmBehavior(g);
    bot.path = null;
    const a = g.rng() * Math.PI;
    bot.axis = [Math.cos(a), Math.sin(a)];
    bot.span = 2.2;
    if (bot.behavior === 'strafe' && !segmentWalkable(g.map, jx - bot.axis[0] * 2, jy - bot.axis[1] * 2, jx + bot.axis[0] * 2, jy + bot.axis[1] * 2)) {
      bot.behavior = 'static';
    }
    bot.spawnTime = g.time;
    return;
  }
}

/** 데스매치 내 부활 자리: 살아 있는 봇에게서 멀고 안 보이는 곳 (발로: 죽은 곳·적에게서 먼 곳) */
function dmPlayerSpot(g) {
  const nav = navOf(g.map);
  const nodes = navNodes(nav);
  const dead = g.player.mover;
  let best = null;
  for (let tries = 0; tries < 40; tries++) {
    const [x, y] = nodePos(nav, nodes[Math.floor(g.rng() * nodes.length)]);
    const z = g.map.floorAt(x, y) + 1.6;
    let near = Infinity;
    let seen = false;
    for (const b of g.bots) {
      if (!b.alive) continue;
      near = Math.min(near, Math.hypot(b.mover.x - x, b.mover.y - y));
      if (!seen && near < 45 && lineOfSight(g.map, b.mover.x, b.mover.y, b.mover.z + 1.6, x, y, z)) seen = true;
    }
    const score = Math.min(near, 30) + Math.min(20, Math.hypot(dead.x - x, dead.y - y)) * 0.3 - (seen ? 100 : 0);
    if (!best || score > best.score) best = { at: [x, y], score };
  }
  // 가장 넓게 트인 방향을 보게
  let heading = 0;
  let far = -1;
  const ez = g.map.floorAt(best.at[0], best.at[1]) + 1.6;
  for (let a = 0; a < 360; a += 30) {
    const h = g.map.raycast(best.at[0], best.at[1], ez, Math.sin(a * DEG), Math.cos(a * DEG), 0, 80);
    const t = h ? h.t : 80;
    if (t > far) {
      far = t;
      heading = a;
    }
  }
  return { at: best.at, heading };
}

/** 내가 보는 곳 바닥에 가만히 있는 봇 놓기 (아무 모드에서나 B) */
export function placeBotAtAim(g) {
  const p = g.player.mover;
  const eye = p.z + eyeHeight(p);
  const { f } = aimBasis(g.yaw, g.pitch);
  const hit = g.map.raycast(p.x, p.y, eye, f[0], f[1], f[2], 120);
  if (!hit) return false;
  // 맞은 곳에서 조금 내 쪽으로
  let x = p.x + f[0] * (hit.t - 0.5);
  let y = p.y + f[1] * (hit.t - 0.5);
  if (!g.map.walkable(x, y)) return false;
  const face = (Math.atan2(p.x - x, p.y - y) / DEG + 360) % 360;
  const b = createBot(g.map, x, y, { behavior: 'static', face });
  b.placed = true;
  b.spawnTime = g.time;
  equipBot(g, b);
  nameBot(g, b, g.bots.length);
  g.bots.push(b);
  return true;
}

export function clearPlacedBots(g) {
  g.bots = g.bots.filter((b) => !b.placed);
}

function stepGame(g) {
  const dt = DT;
  if (g.match && g.match.over) return; // 경기 끝: 다시 시작할 때까지 멈춤
  g.time += dt;
  const pl = g.player;
  const m = pl.mover;
  const w = g.weapon;
  const inp = g.input;

  // 데스매치 시간·목표 킬
  const mt = g.match;
  if (mt && mt.over) return;
  if (mt) {
    if (mt.timeLeft !== undefined) {
      if (!mt.endless) mt.timeLeft = Math.max(0, mt.timeLeft - dt);
      if (!mt.endless && (mt.timeLeft <= 0 || mt.kills >= mt.target || g.bots.some((b) => b.kills >= mt.target))) {
        mt.over = true;
        const best = Math.max(0, ...g.bots.map((b) => b.kills));
        mt.winner = mt.kills >= best ? 'me' : g.bots.find((b) => b.kills === best).id;
        g.input.fire = false;
        g.events.push({ type: 'matchEnd', win: mt.winner === 'me', kills: mt.kills });
        return;
      }
    } else mt.elapsed += dt;
  }

  if (!pl.alive) {
    pl.deadFor += dt;
    if (pl.deadFor > DM.respawn) {
      const dm = g.settings.mode === 'dm';
      const spot = dm ? dmPlayerSpot(g) : g.modeStart;
      placePlayer(g, spot.at, spot.heading);
      g.weapon = createWeapon({ infiniteReserve: g.settings.infiniteReserve });
      g.weapon.equip = 0;
      g.events.push({ type: 'respawn' });
      // 부활하면 적 위치가 잠깐 미니맵에 보임 [확인]
      if (dm) g.events.push({ type: 'reveal', bots: g.bots.filter((b) => b.alive).map((b) => ({ id: b.id, x: b.mover.x, y: b.mover.y })) });
    }
  }

  // ── 이동 ──
  const fwd = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
  const side = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const { f, r } = aimBasis(g.yaw, 0);
  let wx = f[0] * fwd + r[0] * side;
  let wy = f[1] * fwd + r[1] * side;
  const wl = Math.hypot(wx, wy);
  if (wl > 0) {
    wx /= wl;
    wy /= wl;
  }
  const ads = isAds(w);
  const speed = maxSpeed(weaponSpeed(w), { walk: inp.walk, crouch: inp.crouch, ads, adsSpeedMult: VANDAL.adsSpeedMult });
  const prevX = m.x;
  const prevY = m.y;
  if (pl.protect > 0) {
    pl.protect -= dt;
    if (wl > 0 || inp.fire || inp.jump) pl.protect = 0;
  }
  if (pl.alive) {
    const ev = stepMover(m, g.map, { wx, wy, speed, crouch: inp.crouch, jump: inp.jump }, dt);
    if (ev.jumped) g.events.push({ type: 'jump' });
    if (ev.landed) g.events.push({ type: 'land', speed: ev.landSpeed });
  }

  // 발소리: 걷기·앉기면 안 남 (발로와 같음)
  const moved = Math.hypot(m.x - prevX, m.y - prevY);
  const hs = horizSpeed(m);
  if (m.onGround && hs > weaponSpeed(w) * 0.75 && !inp.walk && !inp.crouch) {
    g.footDist += moved;
    if (g.footDist > FOOT_STRIDE) {
      g.footDist = 0;
      g.events.push({ type: 'footstep', who: 'me', x: m.x, y: m.y, z: m.z });
    }
  } else g.footDist = Math.min(g.footDist, FOOT_STRIDE * 0.6);

  // ── 텔레포터 ──
  g.teleCd = Math.max(0, g.teleCd - dt);
  if (pl.alive && g.teleCd <= 0) {
    for (const t of g.map.teleporters) {
      const [x0, y0, x1, y1] = t.pad;
      if (m.x > x0 && m.x < x1 && m.y > y0 && m.y < y1 && m.z < g.map.floorAt(m.x, m.y) + 0.6) {
        const delta = t.heading - t.inHeading;
        const c = Math.cos(-delta * DEG);
        const s2 = Math.sin(-delta * DEG);
        const vx = m.vx * c - m.vy * s2;
        const vy = m.vx * s2 + m.vy * c;
        g.events.push({ type: 'teleport', from: [m.x, m.y], to: t.to, id: t.id });
        m.x = t.to[0];
        m.y = t.to[1];
        m.z = g.map.floorAt(m.x, m.y);
        m.vx = vx;
        m.vy = vy;
        g.yaw = (g.yaw + delta + 360) % 360;
        g.teleCd = 0.5;
        break;
      }
    }
  }

  // ── 회복팩 (데스매치): 밟으면 체력 100 · 방어구 50 ──
  for (let i = g.packs.length - 1; i >= 0; i--) {
    const k = g.packs[i];
    k.life -= dt;
    if (pl.alive && Math.hypot(m.x - k.x, m.y - k.y) < DM.healthPackRadius && Math.abs(m.z - k.z) < 1.2) {
      pl.hp = HP_MAX;
      pl.armor = ARMOR_HEAVY;
      g.events.push({ type: 'heal', x: k.x, y: k.y });
      g.packs.splice(i, 1);
    } else if (k.life <= 0) g.packs.splice(i, 1);
  }

  // ── 문 (텔레포터 출구 방): 방 안에서 문에 다가가면 열림 ──
  for (const d of g.map.doors) {
    const [x0, y0, x1, y1] = d.r;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const dist = Math.hypot(m.x - cx, m.y - cy);
    const [rx0, ry0, rx1, ry1] = d.room;
    const inRoom = m.x > rx0 && m.x < rx1 && m.y > ry0 && m.y < ry1;
    if (!d.open && inRoom && dist < 2.6) {
      g.map.setDoor(d, true);
      g.events.push({ type: 'door', id: d.id, open: true });
    } else if (d.open && dist > 4 && !inRoom) {
      g.map.setDoor(d, false);
      g.events.push({ type: 'door', id: d.id, open: false });
    }
  }

  // ── 무기 ──
  const acc = accuracyState(m, weaponSpeed(w));
  const moveInfo = { speed: acc.speed, airborne: acc.airborne, crouched: m.crouch > 0.5, landing: m.landErr > 0 };
  const wres = stepWeapon(w, { fire: pl.alive && inp.fire, adsHeld: pl.alive && inp.ads }, moveInfo, dt, g.rng);
  for (const e of wres.events) g.events.push({ type: e });
  for (const shot of wres.shots) fireShot(g, shot);

  // ── 봇 ──
  const fight = fightCfg(g);
  const eye = m.z + eyeHeight(m);
  const ctx = {
    map: g.map,
    nav: navOf(g.map),
    dt,
    rng: g.rng,
    now: g.time,
    fight,
    player: { x: m.x, y: m.y, z: m.z, eye: eyeHeight(m), alive: pl.alive && !(pl.protect > 0), speed: hs },
  };
  for (const b of g.bots) {
    const wasAlive = b.alive;
    const bx = b.mover.x;
    const by = b.mover.y;
    const res = stepBot(b, ctx);
    if (b.alive) {
      // 발소리
      const bm = b.mover;
      const bs = horizSpeed(bm);
      if (bm.onGround && bs > VANDAL.speed * 0.75) {
        b.footDist = (b.footDist || 0) + Math.hypot(bm.x - bx, bm.y - by);
        if (b.footDist > FOOT_STRIDE) {
          b.footDist = 0;
          g.events.push({ type: 'footstep', who: b.id, x: bm.x, y: bm.y, z: bm.z });
        }
      }
      // 보이기 시작한 순간 기록 (반응 속도): 화면 안에 있고 가려지지 않았을 때
      const headZ = bm.z + 1.55 - bm.crouch * 0.42;
      const vis = inView(g, m, eye, bm.x, bm.y, headZ) && lineOfSight(g.map, m.x, m.y, eye, bm.x, bm.y, headZ);
      if (vis && b.visibleSince < 0) b.visibleSince = g.time;
      if (!vis && b.visibleSince >= 0 && g.time - b.visibleSince > 1.5) b.visibleSince = -1;
      b.visible = vis;
    }
    if (res.shot) {
      g.events.push({ type: 'botShot', bot: b.id, hit: res.shot.hit, x: b.mover.x, y: b.mover.y, z: b.mover.z });
      if (res.shot.hit && pl.alive && !(pl.protect > 0)) {
        const lost = applyDamage(pl, res.shot.dmg);
        m.tag = 1; // 태깅
        pl.taken.push({ bot: b.id, part: res.shot.part, dmg: Math.round(lost) });
        g.events.push({ type: 'hurt', dmg: res.shot.dmg, part: res.shot.part, from: [b.mover.x, b.mover.y] });
        if (pl.hp <= 0) {
          pl.hp = 0;
          pl.armor = 0;
          pl.alive = false;
          pl.deadFor = 0;
          g.stats.deaths += 1;
          g.input.fire = false;
          b.kills += 1;
          if (g.match) g.match.deaths += 1;
          pl.killer = { id: b.id, name: b.name, agent: b.agent, head: res.shot.part === 'head' };
          g.events.push({ type: 'died', killer: pl.killer, x: m.x, y: m.y, z: m.z });
        }
      }
    }
    if (!wasAlive && !b.alive) {
      const wait = g.settings.mode === 'dm' ? DM.respawn : g.settings.mode === 'duel' ? 0.5 : 0.9;
      if (b.deadFor > wait && !b.placed) {
        if (g.settings.mode === 'dm') dmRespawn(g, b);
        else if (g.settings.mode === 'hold') {
          const lane = b.peeks[Math.floor(g.rng() * b.peeks.length)];
          respawnBot(b, g.map, lane.hide[0], lane.hide[1]);
          equipBot(g, b);
          b.lane = lane;
          b.timer = 0.4 + g.rng() * 1.4;
          b.spawnTime = g.time;
        } else if (g.settings.mode === 'duel') {
          const d = g.map.def.duels.find((x) => x.id === g.settings.duel) || g.map.def.duels[0];
          const setup = duelSetup(g, d);
          respawnBot(b, g.map, setup.bot[0], setup.bot[1]);
          equipBot(g, b);
          b.spawnTime = g.time;
        }
      }
    }
  }
  if (g.bots.some((b) => b.placed && !b.alive && b.deadFor > 1.5)) {
    for (const b of g.bots) {
      if (b.placed && !b.alive && b.deadFor > 1.5) {
        respawnBot(b, g.map, b.home[0], b.home[1]);
        equipBot(g, b);
      }
    }
  }

  // 위치 이름 바뀌면 알림
  const reg = g.map.regionAt(m.x, m.y);
  if (reg && reg !== g.lastRegion) {
    g.lastRegion = reg;
    g.events.push({ type: 'region', label: reg.label });
  }
}

/** 그 점이 지금 화면(가로 103°, 조준 시 줌) 안에 들어오는지. 세로는 16:9 기준 */
function inView(g, m, eye, x, y, z) {
  const hf = HFOV + (zoomedHfov(VANDAL.zoom) - HFOV) * g.weapon.ads;
  const vf = (2 * Math.atan(Math.tan((hf / 2) * DEG) / (16 / 9))) / DEG;
  const dx = x - m.x;
  const dy = y - m.y;
  const dYaw = ((Math.atan2(dx, dy) / DEG - g.yaw + 540) % 360) - 180;
  const dPitch = Math.atan2(z - eye, Math.hypot(dx, dy)) / DEG - g.pitch;
  return Math.abs(dYaw) <= hf / 2 && Math.abs(dPitch) <= vf / 2;
}

/** 총알 한 발: 반동 + 퍼짐 → 광선 → 벽/봇 */
function fireShot(g, shot) {
  const m = g.player.mover;
  const eye = m.z + eyeHeight(m);
  const dir = offsetDir(g.yaw, g.pitch, shot.recoil[1] + shot.dx, shot.recoil[0] + shot.dy);
  const st = g.stats;
  st.shots += 1;
  if (shot.accurate) st.accurateShots += 1;
  if (shot.index === 0) st.firstShots += 1;

  const wallHit = g.map.raycast(m.x, m.y, eye, dir[0], dir[1], dir[2], MAX_RANGE);
  const wallT = wallHit ? wallHit.t : MAX_RANGE;
  let best = null;
  for (const b of g.bots) {
    if (!b.alive) continue;
    const h = rayBot(b, m.x, m.y, eye, dir[0], dir[1], dir[2], wallT);
    if (h && (!best || h.t < best.t)) best = { ...h, bot: b };
  }
  const ev = {
    type: 'shot',
    from: [m.x, m.y, eye],
    dir,
    index: shot.index,
    spread: shot.spread,
    accurate: shot.accurate,
    ads: shot.ads,
  };
  if (best) {
    const b = best.bot;
    const dmg = VANDAL.damage[best.part];
    st.hits += 1;
    st[best.part] += 1;
    if (shot.index === 0 && best.part === 'head') st.firstShotHeads += 1;
    if (b.firstHitAt === undefined || b.firstHitAt === null) b.firstHitAt = g.time;
    const lost = applyDamage(b, dmg);
    b.mover.tag = 1; // 맞으면 느려짐 (태깅)
    ev.t = best.t;
    ev.hitBot = { id: b.id, part: best.part, dmg };
    const pl = g.player;
    const dl = pl.dealt.get(b.id) || { dmg: 0, head: 0, body: 0, leg: 0 };
    dl.dmg += Math.round(lost);
    dl[best.part] += 1;
    pl.dealt.set(b.id, dl);
    if (b.hp <= 0) {
      b.alive = false;
      b.deadFor = 0;
      b.deaths = (b.deaths || 0) + 1;
      st.kills += 1;
      if (g.match) g.match.kills += 1;
      if (b.visibleSince >= 0) st.reactions.push(g.time - b.visibleSince);
      if (b.firstHitAt !== null && b.firstHitAt !== undefined) st.ttks.push(g.time - b.firstHitAt);
      b.firstHitAt = null;
      b.visibleSince = -1;
      ev.kill = { id: b.id, name: b.name, agent: b.agent, head: best.part === 'head', x: b.mover.x, y: b.mover.y, z: b.mover.z, face: b.face };
      if (g.settings.mode === 'dm') {
        // 데스매치: 킬하면 들고 있는 총 탄창이 바로 가득 [확인], 죽은 자리에 회복팩 10초 [확인]
        const w = g.weapon;
        if (w.current === 'vandal') {
          w.ammo = VANDAL.mag;
          w.reload = 0;
        }
        g.packs.push({ x: b.mover.x, y: b.mover.y, z: b.mover.z, life: DM.healthPackLife });
      }
    }
  } else if (wallHit) {
    ev.t = wallHit.t;
    ev.normal = [wallHit.nx, wallHit.ny, wallHit.nz];
  } else {
    ev.t = MAX_RANGE;
    ev.sky = true;
  }
  g.events.push(ev);
}

/** 화면 시점: 지향사격은 반동의 50%, 조준하면 100% 를 따라가고 발마다 살짝 튐 */
export function viewAngles(g) {
  const w = g.weapon;
  const rec = currentRecoil(w);
  const k = VANDAL.viewKick + (VANDAL.adsViewKick - VANDAL.viewKick) * w.ads;
  return { yaw: g.yaw + rec[1] * k, pitch: g.pitch + rec[0] * k + shotPunch(w) };
}

export { switchTo, startReload, isAds, eyeHeight, accuracyState, weaponSpeed, headingVec, MOVE };
