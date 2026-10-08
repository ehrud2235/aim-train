// 연습장 한 판의 계산: 플레이어, 밴달, 봇, 모드, 기록, 텔레포터, 문.
// 화면·소리는 client 쪽이 events 를 받아서 처리한다.

import { TICK_HZ, VANDAL, HP_FULL, MOVE } from './valorant.js';
import { createMover, stepMover, maxSpeed, eyeHeight, accuracyState, horizSpeed } from './movement.js';
import { createWeapon, stepWeapon, weaponSpeed, isAds, currentRecoil, switchTo, startReload } from './weapon.js';
import { createBot, stepBot, rayBot, respawnBot, lineOfSight, headingVec, segmentWalkable } from './bots.js';
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
  const [x, y] = at;
  g.player = {
    mover: createMover(x, y, g.map.floorAt(x, y)),
    hp: HP_FULL,
    alive: true,
    deadFor: 0,
  };
  g.yaw = heading;
  g.pitch = 0;
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
  for (const d of g.map.doors) g.map.setDoor(d, false);

  if (s.mode === 'hold') {
    const h = def.holds.find((x) => x.id === s.hold) || def.holds[0];
    g.modeStart = { at: h.at, heading: h.heading };
    placePlayer(g, h.at, h.heading);
    const lane = h.peeks[Math.floor(g.rng() * h.peeks.length)];
    const b = createBot(g.map, lane.hide[0], lane.hide[1], { behavior: 'peek', peeks: h.peeks });
    b.timer = 0.8;
    g.bots.push(b);
  } else if (s.mode === 'duel') {
    const d = def.duels.find((x) => x.id === s.duel) || def.duels[0];
    g.modeStart = { at: d.at, heading: d.heading };
    placePlayer(g, d.at, d.heading);
    const axis = d.axis === 'x' ? [1, 0] : [0, 1];
    const toPlayer = (Math.atan2(d.at[0] - d.bot[0], d.at[1] - d.bot[1]) / DEG + 360) % 360;
    g.bots.push(createBot(g.map, d.bot[0], d.bot[1], { behavior: s.duelBehavior === 'static' ? 'static' : 'strafe', axis, span: d.span, face: toPlayer }));
  } else if (s.mode === 'dm') {
    const sp = def.spawns.attacker;
    g.modeStart = { at: sp.at, heading: sp.heading };
    placePlayer(g, sp.at, sp.heading);
    const n = Math.max(1, Math.min(16, s.dmBots | 0));
    for (let i = 0; i < n; i++) {
      const b = createBot(g.map, 0, 0, {});
      g.bots.push(b);
      dmRespawn(g, b, true);
    }
  } else {
    const sp = def.spawns.attacker;
    g.modeStart = { at: sp.at, heading: sp.heading };
    placePlayer(g, sp.at, sp.heading);
  }
}

function dmBehavior(g) {
  const mode = g.settings.dmBehavior;
  if (mode === 'static' || mode === 'strafe' || mode === 'wander') return mode;
  const r = g.rng();
  return r < 0.6 ? 'wander' : r < 0.8 ? 'strafe' : 'static';
}

/** 데스매치 봇 다시 놓기: 플레이어에게서 10m 이상, 보이지 않는 곳 */
function dmRespawn(g, bot, initial = false) {
  const def = g.map.def;
  const keys = Object.keys(def.botPoints);
  const p = g.player.mover;
  const eye = p.z + eyeHeight(p);
  for (let tries = 0; tries < 40; tries++) {
    const key = keys[Math.floor(g.rng() * keys.length)];
    const pts = def.botPoints[key];
    const pt = pts[Math.floor(g.rng() * pts.length)];
    const jx = pt[0] + (g.rng() - 0.5) * 1.2;
    const jy = pt[1] + (g.rng() - 0.5) * 1.2;
    if (!g.map.walkable(jx, jy)) continue;
    const d = Math.hypot(jx - p.x, jy - p.y);
    if (d < 10) continue;
    const z = g.map.floorAt(jx, jy);
    if (!initial && tries < 30 && lineOfSight(g.map, p.x, p.y, eye, jx, jy, z + 1.5)) continue;
    if (g.bots.some((o) => o !== bot && o.alive && Math.hypot(o.mover.x - jx, o.mover.y - jy) < 2)) continue;
    const face = g.rng() * 360;
    respawnBot(bot, g.map, jx, jy, face);
    bot.behavior = dmBehavior(g);
    bot.points = pts.concat(neighborPoints(g, key));
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

function neighborPoints(g, key) {
  // 같은 위치 이름 + 이어진 몇 군데 (위치 이름 순서상 이웃)
  const NEAR = {
    aSite: ['aHeaven', 'aLamps'],
    aHeaven: ['aSite', 'heavenHall'],
    aLamps: ['aSite', 'aShort', 'uHall'],
    aShort: ['aLamps', 'aLobby'],
    aBath: ['aLobby', 'aSite'],
    aLobby: ['aShort', 'aBath', 'atkSpawn'],
    uHall: ['aLamps', 'defSpawn'],
    heavenHall: ['aHeaven', 'defSpawn'],
    defSpawn: ['uHall', 'elbow', 'heavenHall'],
    atkSpawn: ['aLobby', 'bShort'],
    bShort: ['atkSpawn', 'hookah', 'bLong'],
    hookah: ['bShort', 'bSite'],
    bSite: ['hookah', 'garden', 'elbow'],
    garden: ['bSite', 'bLong'],
    bLong: ['garden', 'bShort'],
    elbow: ['bSite', 'defSpawn'],
  };
  const out = [];
  for (const k of NEAR[key] || []) out.push(...(g.map.def.botPoints[k] || []));
  return out;
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
  g.bots.push(b);
  return true;
}

export function clearPlacedBots(g) {
  g.bots = g.bots.filter((b) => !b.placed);
}

function stepGame(g) {
  const dt = DT;
  g.time += dt;
  const pl = g.player;
  const m = pl.mover;
  const w = g.weapon;
  const inp = g.input;

  if (!pl.alive) {
    pl.deadFor += dt;
    if (pl.deadFor > 2) {
      const { at, heading } = g.modeStart;
      placePlayer(g, at, heading);
      g.weapon = createWeapon({ infiniteReserve: g.settings.infiniteReserve });
      g.weapon.equip = 0;
      g.events.push({ type: 'respawn' });
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
  const moveInfo = { speed: acc.speed, airborne: acc.airborne, crouched: m.crouch > 0.5 };
  const wres = stepWeapon(w, { fire: pl.alive && inp.fire, adsHeld: pl.alive && inp.ads }, moveInfo, dt, g.rng);
  for (const e of wres.events) g.events.push({ type: e });
  for (const shot of wres.shots) fireShot(g, shot);

  // ── 봇 ──
  const fight = fightCfg(g);
  const eye = m.z + eyeHeight(m);
  const ctx = {
    map: g.map,
    dt,
    rng: g.rng,
    now: g.time,
    fight,
    player: { x: m.x, y: m.y, z: m.z, eye: eyeHeight(m), alive: pl.alive, speed: hs },
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
      // 보이기 시작한 순간 기록 (반응 속도)
      const vis = lineOfSight(g.map, m.x, m.y, eye, bm.x, bm.y, bm.z + 1.55 - bm.crouch * 0.42);
      if (vis && b.visibleSince < 0) b.visibleSince = g.time;
      if (!vis && b.visibleSince >= 0 && g.time - b.visibleSince > 1.5) b.visibleSince = -1;
      b.visible = vis;
    }
    if (res.shot) {
      g.events.push({ type: 'botShot', bot: b.id, hit: res.shot.hit, x: b.mover.x, y: b.mover.y, z: b.mover.z });
      if (res.shot.hit && pl.alive) {
        pl.hp -= res.shot.dmg;
        g.events.push({ type: 'hurt', dmg: res.shot.dmg, part: res.shot.part, from: [b.mover.x, b.mover.y] });
        if (pl.hp <= 0) {
          pl.hp = 0;
          pl.alive = false;
          pl.deadFor = 0;
          g.stats.deaths += 1;
          g.input.fire = false;
          g.events.push({ type: 'died' });
        }
      }
    }
    if (!wasAlive && !b.alive) {
      const wait = g.settings.mode === 'dm' ? 1.2 : g.settings.mode === 'duel' ? 0.5 : 0.9;
      if (b.deadFor > wait && !b.placed) {
        if (g.settings.mode === 'dm') dmRespawn(g, b);
        else if (g.settings.mode === 'hold') {
          const lane = b.peeks[Math.floor(g.rng() * b.peeks.length)];
          respawnBot(b, g.map, lane.hide[0], lane.hide[1]);
          b.lane = lane;
          b.timer = 0.4 + g.rng() * 1.4;
          b.spawnTime = g.time;
        } else if (g.settings.mode === 'duel') {
          const d = g.map.def.duels.find((x) => x.id === g.settings.duel) || g.map.def.duels[0];
          respawnBot(b, g.map, d.bot[0], d.bot[1]);
          b.spawnTime = g.time;
        }
      }
    }
  }
  if (g.bots.some((b) => b.placed && !b.alive && b.deadFor > 1.5)) {
    for (const b of g.bots) if (b.placed && !b.alive && b.deadFor > 1.5) respawnBot(b, g.map, b.home[0], b.home[1]);
  }

  // 위치 이름 바뀌면 알림
  const reg = g.map.regionAt(m.x, m.y);
  if (reg && reg !== g.lastRegion) {
    g.lastRegion = reg;
    g.events.push({ type: 'region', label: reg.label });
  }
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
    b.hp -= dmg;
    ev.t = best.t;
    ev.hitBot = { id: b.id, part: best.part, dmg };
    if (b.hp <= 0) {
      b.alive = false;
      b.deadFor = 0;
      st.kills += 1;
      if (b.visibleSince >= 0) st.reactions.push(g.time - b.visibleSince);
      if (b.firstHitAt !== null && b.firstHitAt !== undefined) st.ttks.push(g.time - b.firstHitAt);
      b.firstHitAt = null;
      b.visibleSince = -1;
      ev.kill = { id: b.id, head: best.part === 'head', x: b.mover.x, y: b.mover.y, z: b.mover.z, face: b.face };
      if (g.settings.mode === 'dm') g.player.hp = HP_FULL; // 킬하면 체력 회복 (데스매치 회복팩 대신)
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

/** 화면 시점(반동으로 살짝 올라간 크로스헤어) */
export function viewAngles(g) {
  const rec = currentRecoil(g.weapon);
  const k = VANDAL.viewKick * (isAds(g.weapon) ? VANDAL.adsRecoilMult : 1);
  return { yaw: g.yaw + rec[1] * k, pitch: g.pitch + rec[0] * k };
}

export { switchTo, startReload, isAds, eyeHeight, accuracyState, weaponSpeed, headingVec, MOVE };
