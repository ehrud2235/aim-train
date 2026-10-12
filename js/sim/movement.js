// 발로란트식 이동: 가속·감속(브레이킹), 카운터 스트레이핑, 걷기·앉기·조준 속도, 점프, 계단.
// 플레이어와 봇이 같은 코드를 쓴다. 좌표는 맵 평면 (x, y) + 높이 z(발바닥).

import { MOVE } from './valorant.js';

const BODY_H = 1.85;
const BODY_H_CROUCH = 1.35;
const SUBSTEP = 0.08; // 한 번에 이만큼 이상 움직이지 않게 나눠서 충돌 검사
const STEP_DOWN = 0.45; // 계단 내려갈 때 바닥에 붙어 있는 높이
const AIR_STEP = 0.2; // 공중에서 모서리에 걸쳤을 때 올라서는 높이

export function createMover(x, y, z = 0) {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    crouch: 0, // 0 = 서 있음, 1 = 완전히 앉음
    landErr: 0, // 착지 직후 사격 오차 남은 시간
    tag: 0, // 맞아서 느려진 정도 (1 → 0)
    airTime: 0,
    jumpHeld: false,
    stepSmooth: 0, // 계단 오를 때 화면이 튀지 않게
  };
}

export function horizSpeed(m) {
  return Math.hypot(m.vx, m.vy);
}

export function bodyHeight(m) {
  return BODY_H + (BODY_H_CROUCH - BODY_H) * m.crouch;
}

export function eyeHeight(m) {
  return MOVE.eyeStand + (MOVE.eyeCrouch - MOVE.eyeStand) * m.crouch;
}

/** 지금 상태에서 낼 수 있는 최고 속도 */
export function maxSpeed(weaponSpeed, { walk, crouch, ads, adsSpeedMult }) {
  let s = weaponSpeed;
  if (crouch) s *= MOVE.crouchMult;
  else if (walk) s *= MOVE.walkMult;
  if (ads) s = Math.min(s, weaponSpeed * adsSpeedMult);
  return s;
}

/**
 * 한 틱 이동.
 * input: { wx, wy: 원하는 방향(맵 평면, 길이 0~1), speed: 최고 속도, crouch: bool, jump: bool }
 * 반환: { landed, jumped, teleported? } 같은 이벤트
 */
export function stepMover(m, map, input, dt) {
  const ev = { landed: false, jumped: false, landSpeed: 0 };

  // 앉기
  const targetCrouch = input.crouch ? 1 : 0;
  if (m.crouch !== targetCrouch) {
    const d = dt / MOVE.crouchTime;
    if (targetCrouch > m.crouch) m.crouch = Math.min(1, m.crouch + d);
    else if (canStand(m, map)) m.crouch = Math.max(0, m.crouch - d);
  }

  let wx = input.wx;
  let wy = input.wy;
  const wl = Math.hypot(wx, wy);
  if (wl > 1) {
    wx /= wl;
    wy /= wl;
  }
  let speed = input.speed;
  if (m.landErr > 0) m.landErr = Math.max(0, m.landErr - dt);
  // 태깅: 총에 맞으면 72.5% 느려졌다가 0.4초 동안 돌아옴
  if (m.tag > 0) {
    speed *= 1 - MOVE.tagSlow * m.tag;
    m.tag = Math.max(0, m.tag - dt / MOVE.tagTime);
  }

  if (m.onGround) {
    groundAccel(m, wx, wy, wl > 0.01, speed, dt);
    if (input.jump && !m.jumpHeld) {
      m.vz = MOVE.jumpVel;
      m.onGround = false;
      ev.jumped = true;
    }
  } else {
    // 공중: 약한 방향 전환만 (에어 스트레이프)
    if (wl > 0.01) {
      const along = m.vx * wx + m.vy * wy;
      if (along < speed) {
        const a = Math.min(MOVE.airAccel * dt, speed - along);
        m.vx += wx * a;
        m.vy += wy * a;
      }
    }
    m.vz -= MOVE.gravity * dt;
  }
  m.jumpHeld = !!input.jump;

  // 수평 이동 + 충돌
  const dx = m.vx * dt;
  const dy = m.vy * dt;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SUBSTEP));
  for (let s = 0; s < n; s++) {
    moveAxis(m, map, dx / n, 0);
    moveAxis(m, map, 0, dy / n);
  }

  // 수직
  const wasGround = m.onGround;
  const ground = groundHeight(map, m.x, m.y, m.z + (m.onGround ? MOVE.stepHeight : AIR_STEP)) ?? m.z;
  if (m.onGround) {
    if (ground < m.z - STEP_DOWN) {
      m.onGround = false; // 낭떠러지
    } else {
      if (ground < m.z) m.stepSmooth -= m.z - ground;
      m.z = ground;
      m.vz = 0;
    }
  }
  if (!m.onGround) {
    m.z += m.vz * dt;
    const head = m.z + bodyHeight(m);
    if (m.vz > 0 && hitsCeiling(map, m.x, m.y, head)) m.vz = 0;
    m.airTime += dt;
    if (m.z <= ground) {
      if (!wasGround) {
        ev.landed = true;
        ev.landSpeed = -m.vz;
        m.landErr = MOVE.landErrorTime;
      }
      m.z = ground;
      m.vz = 0;
      m.onGround = true;
      m.airTime = 0;
    }
  }
  if (m.onGround) m.airTime = 0;
  // 화면 높이 보정은 빠르게 0 으로
  m.stepSmooth *= Math.exp(-dt * 18);
  if (Math.abs(m.stepSmooth) < 1e-4) m.stepSmooth = 0;
  return ev;
}

/** 속도 v 를 dt 동안 마찰로 줄인 값 (지수 감속 + 작은 고정 감속) */
function brakeSpeed(v, dt, extra = 0) {
  return Math.max(0, v * Math.exp(-MOVE.friction * dt) - (MOVE.stopDecel + extra) * dt);
}

/** 지상 가속/감속. 반대 방향 입력(카운터 스트레이핑)은 조금만 더 빨리 선다 (발로는 키를 놓는 것과 약 10ms 차이). */
function groundAccel(m, wx, wy, hasInput, speed, dt) {
  if (!hasInput) {
    const v = Math.hypot(m.vx, m.vy);
    if (v > 0) {
      const nv = brakeSpeed(v, dt);
      m.vx *= nv / v;
      m.vy *= nv / v;
    }
    return;
  }
  // 원하는 방향 성분(p)과 옆 성분(q)으로 나눔
  let p = m.vx * wx + m.vy * wy;
  let qx = m.vx - p * wx;
  let qy = m.vy - p * wy;
  const q = Math.hypot(qx, qy);
  if (q > 0) {
    const nq = brakeSpeed(q, dt, MOVE.counterBrake);
    qx *= nq / q;
    qy *= nq / q;
  }
  if (p < 0) {
    // 반대로 움직이는 중 → 감속 (반대 키가 조금 더 세움). 멈추면 그때부터 새 방향으로 가속
    p = -brakeSpeed(-p, dt, MOVE.counterBrake);
  } else if (p < speed) {
    p = Math.min(speed, p + MOVE.accel * dt);
  } else if (p > speed) {
    p = Math.max(speed, brakeSpeed(p, dt)); // 걷기·조준·태깅으로 최고 속도가 줄면 감속
  }
  m.vx = wx * p + qx;
  m.vy = wy * p + qy;
}

function moveAxis(m, map, dx, dy) {
  if (dx === 0 && dy === 0) return;
  const nxp = m.x + dx;
  const nyp = m.y + dy;
  const stepLimit = m.z + (m.onGround ? MOVE.stepHeight : AIR_STEP);
  const g = groundHeight(map, nxp, nyp, stepLimit);
  if (g === null || blockedOverhead(map, nxp, nyp, m.z, m.z + bodyHeight(m))) {
    if (dx !== 0) m.vx = 0;
    if (dy !== 0) m.vy = 0;
    return;
  }
  m.x = nxp;
  m.y = nyp;
  if (g > m.z) {
    m.stepSmooth -= g - m.z; // 계단: 몸은 바로 올리고 화면은 부드럽게
    m.z = g;
    if (!m.onGround) {
      m.vz = 0;
      m.onGround = true;
    }
  }
}

/**
 * 발 아래 바닥 높이. 몸이 닿는 칸 중 limit 보다 높은 게 있으면 null(막힘).
 */
export function groundHeight(map, x, y, limit) {
  const r = MOVE.radius;
  const c = map.cell;
  const i0 = Math.floor((x - r - map.x0) / c);
  const i1 = Math.floor((x + r - map.x0) / c);
  const j0 = Math.floor((y - r - map.y0) / c);
  const j1 = Math.floor((y + r - map.y0) / c);
  let g = -Infinity;
  for (let j = j0; j <= j1; j++) {
    if (j < 0 || j >= map.ny) return null;
    for (let i = i0; i <= i1; i++) {
      if (i < 0 || i >= map.nx) return null;
      const t = map.top[j * map.nx + i];
      if (t > limit + 1e-4) return null;
      if (t > g) g = t;
    }
  }
  return g;
}

/** 몸통(z0~z1)이 들어갈 자리에 위쪽 막힘(창문·문 윗벽)이 걸리는지 */
function blockedOverhead(map, x, y, z0, z1) {
  const r = MOVE.radius;
  const c = map.cell;
  const i0 = Math.floor((x - r - map.x0) / c);
  const i1 = Math.floor((x + r - map.x0) / c);
  const j0 = Math.floor((y - r - map.y0) / c);
  const j1 = Math.floor((y + r - map.y0) / c);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= map.nx || j >= map.ny) return true;
      const C = map.ceil[j * map.nx + i];
      if (C < z1 && C > z0 - 0.5) return true;
    }
  }
  return false;
}

function hitsCeiling(map, x, y, head) {
  return blockedOverhead(map, x, y, head - 0.3, head);
}

function canStand(m, map) {
  return !blockedOverhead(map, m.x, m.y, m.z + 0.1, m.z + BODY_H);
}

/** 이동 오차 계산에 쓰는 '정확도 상태' */
export function accuracyState(m, weaponSpeed) {
  const v = horizSpeed(m);
  const threshold = weaponSpeed * MOVE.accurateFrac;
  return {
    speed: v,
    threshold,
    airborne: !m.onGround,
    accurate: m.onGround && v <= threshold + 1e-6,
  };
}
