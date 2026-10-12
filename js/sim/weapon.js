// 밴달 / 칼 상태: 연사 속도, 탄창, 재장전, 꺼내기 시간, 조준(ADS), 퍼짐, 스프레이 반동과 회복.
// 화면·사운드와 상관없는 순수 계산이라 테스트에서 그대로 돌린다.

import { VANDAL, KNIFE, MOVE, vandalPitch, vandalYawAmp } from './valorant.js';

export function createWeapon({ infiniteReserve = true } = {}) {
  return {
    current: 'vandal', // 'vandal' | 'knife'
    last: 'knife',
    equip: 0, // 남은 꺼내기 시간
    ammo: VANDAL.mag,
    reserve: infiniteReserve ? Infinity : VANDAL.reserve,
    reload: 0, // 남은 재장전 시간 (0 이면 재장전 중 아님)
    cooldown: 0, // 다음 발까지 남은 시간
    shotIdx: 0, // 연사 중 몇 번째 발인지 (회복되면서 줄어드는 실수)
    sinceShot: 99,
    recoverFrom: 0, // 회복을 시작한 발수 (0.375초 동안 일정하게 0 으로)
    yawHist: new Float32Array(64), // 이번 스프레이의 발마다 좌우 반동 (°)
    histLen: 0,
    yawCur: 0,
    yawTarget: 1, // 좌우 반동이 향하는 쪽 (±1)
    recoilMult: [1, 1], // 마지막 발의 [세로, 가로] 배율 (달리기·앉기·조준)
    ads: 0, // 0..1 조준 진행도
    adsWanted: false,
    totalShots: 0,
  };
}

export function weaponSpeed(w) {
  return w.current === 'knife' ? KNIFE.speed : VANDAL.speed;
}

export function isAds(w) {
  return w.current === 'vandal' && w.ads >= 0.5;
}

export function switchTo(w, which) {
  if (w.current === which) return false;
  w.last = w.current;
  w.current = which;
  w.equip = which === 'knife' ? KNIFE.equipTime : VANDAL.equipTime;
  w.reload = 0; // 무기를 바꾸면 재장전 취소
  w.ads = 0;
  w.cooldown = 0;
  return true;
}

export function startReload(w) {
  if (w.current !== 'vandal' || w.reload > 0 || w.equip > 0) return false;
  if (w.ammo >= VANDAL.mag || w.reserve <= 0) return false;
  w.reload = VANDAL.reloadTime;
  w.ads = 0;
  return true;
}

/** 연사 간격 (조준하면 더 김) */
function fireInterval(w) {
  return 1 / (VANDAL.fireRate * (isAds(w) ? VANDAL.adsFireRateMult : 1));
}

/** 이번 스프레이의 좌우 반동을 n 번째 발까지 만들어 둠: 보호 탄 뒤 무작위 쪽, 발마다 10% 확률로 방향 전환, 0.6초에 한쪽 끝→반대쪽 끝 */
function extendYaw(w, n, rng) {
  const step = fireInterval(w);
  while (w.histLen <= n && w.histLen < w.yawHist.length) {
    const i = w.histLen;
    const amp = vandalYawAmp(i);
    if (amp > 0) {
      if (i > VANDAL.protectedBullets && rng() < VANDAL.yawSwitchChance) w.yawTarget = -w.yawTarget;
      const goal = w.yawTarget * amp;
      const maxMove = ((2 * amp) / VANDAL.yawSwitchTime) * step;
      w.yawCur += Math.max(-maxMove, Math.min(maxMove, goal - w.yawCur));
    }
    w.yawHist[i] = w.yawCur;
    w.histLen++;
  }
}

/** 반동 [위, 오른쪽] (°) — 소수 발수는 사이를 이음. 배율 없이 */
function recoilAt(w, idx) {
  if (idx <= 0) return [0, 0];
  const a = Math.min(Math.floor(idx), Math.max(0, w.histLen - 1));
  const b = Math.min(a + 1, Math.max(0, w.histLen - 1));
  const f = Math.min(1, idx - Math.floor(idx));
  const yaw = w.histLen ? w.yawHist[a] + (w.yawHist[b] - w.yawHist[a]) * f : 0;
  return [vandalPitch(idx), yaw];
}

/** 지금 반동 (화면·크로스헤어용) */
export function currentRecoil(w) {
  const [u, r] = recoilAt(w, w.shotIdx);
  return [u * w.recoilMult[0], r * w.recoilMult[1]];
}

/** 발마다 화면이 살짝 튀는 양 (°): 25ms 에 최대, 다음 발 전에 거의 돌아옴. 탄에는 영향 없음 [추정] */
export function shotPunch(w) {
  const t = w.sinceShot;
  if (t > 0.2 || w.totalShots === 0) return 0;
  const k = VANDAL.shotPunch * (isAds(w) ? VANDAL.adsRecoilMult : 1);
  return t < 0.025 ? (k * t) / 0.025 : k * Math.exp(-(t - 0.025) / 0.03);
}

/**
 * 이동 오차(°): 정확 기준 속도(27.5%) 이하면 0, 걷기 속도에서 walkError, 달리기 속도에서 runError, 공중이면 jumpError,
 * 앉아서 움직이면 crouchMoveError. 착지 직후 0.225초 동안 +7°.
 */
export function movementError(speed, airborne, maxRun = VANDAL.speed, crouched = false, landing = false) {
  const land = landing && !airborne ? MOVE.landError : 0;
  if (airborne) return VANDAL.jumpError;
  const thr = maxRun * MOVE.accurateFrac;
  if (speed <= thr + 1e-6) return land;
  if (crouched) return VANDAL.crouchMoveError + land;
  const walk = maxRun * MOVE.walkMult;
  if (speed <= walk) return (VANDAL.walkError * (speed - thr)) / (walk - thr) + land;
  const f = Math.min(1, (speed - walk) / (maxRun - walk));
  return VANDAL.walkError + (VANDAL.runError - VANDAL.walkError) * f + land;
}

/** 지금 쏘면 퍼짐 반각(°): 사격 오차(첫 발 → 연사할수록 최대까지, 앉으면 ×0.85) + 이동 오차 */
export function currentSpread(w, move) {
  const ads = isAds(w);
  const first = ads ? VANDAL.adsFirstShotSpread : VANDAL.firstShotSpread;
  const max = ads ? VANDAL.adsMaxSpread : VANDAL.maxSpread;
  const t = Math.min(1, Math.max(0, w.shotIdx / VANDAL.spreadFullAt));
  let fire = first + (max - first) * t * t * (3 - 2 * t);
  const crouched = !!move.crouched && !move.airborne;
  if (crouched) fire *= VANDAL.crouchMult;
  const mv = movementError(move.speed, move.airborne, VANDAL.speed, crouched, !!move.landing);
  return { total: fire + mv, base: first * (crouched ? VANDAL.crouchMult : 1), spray: fire - first * (crouched ? VANDAL.crouchMult : 1), move: mv };
}

/**
 * 한 틱.
 * input: { fire: bool(누르고 있음), adsHeld: bool }
 * move: { speed, airborne, crouched }
 * rng: () => [0,1)
 * 반환: 이번 틱에 나간 총알들 [{ recoil:[위,오른쪽], spread, dx, dy(퍼짐 방향 °), accurate }]
 */
export function stepWeapon(w, input, move, dt, rng = Math.random) {
  const shots = [];
  const events = [];
  if (w.equip > 0) w.equip = Math.max(0, w.equip - dt);

  if (w.reload > 0) {
    w.reload -= dt;
    if (w.reload <= 0) {
      w.reload = 0;
      const need = VANDAL.mag - w.ammo;
      const take = Math.min(need, w.reserve);
      w.ammo += take;
      if (w.reserve !== Infinity) w.reserve -= take;
      events.push('reloaded');
    }
  }

  // 조준
  const canAds = w.current === 'vandal' && w.equip <= 0 && w.reload <= 0;
  const wantAds = canAds && input.adsHeld;
  const da = dt / VANDAL.adsTime;
  w.ads = wantAds ? Math.min(1, w.ads + da) : Math.max(0, w.ads - da);

  // 반동 회복: 연사 간격(조준 시 더 김)이 지나도 다음 발이 없으면 0.375초 동안 일정하게 첫 발 상태로
  w.sinceShot += dt;
  const interval = fireInterval(w);
  const grace = interval * 1.1 + dt;
  if (w.sinceShot > grace && w.shotIdx > 0) {
    if (w.recoverFrom <= 0) w.recoverFrom = w.shotIdx;
    w.shotIdx = Math.max(0, w.shotIdx - (w.recoverFrom / VANDAL.recoveryTime) * dt);
    if (w.shotIdx === 0) {
      w.recoverFrom = 0;
      w.histLen = 0;
      w.yawCur = 0;
      w.yawTarget = rng() < 0.5 ? -1 : 1;
    }
  }
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.current !== 'vandal') {
    if (w.cooldown < 0) w.cooldown = 0;
    return { shots, events };
  }

  const ready = w.equip <= 0 && w.reload <= 0;
  if (input.fire && ready && w.ammo <= 0 && w.reserve > 0) {
    startReload(w); // 빈 탄창으로 쏘면 자동 재장전
    events.push('reload');
  }
  while (input.fire && ready && w.ammo > 0 && w.cooldown <= 0) {
    const ads = isAds(w);
    const rate = VANDAL.fireRate * (ads ? VANDAL.adsFireRateMult : 1);
    // 이어서 쏘는 중이면 정수 발수, 회복 중에 다시 쏘면 지금(소수) 발수에서
    const spraying = w.sinceShot <= 1 / rate * 1.1 + dt && w.totalShots > 0;
    const idx = spraying ? Math.round(w.shotIdx) : w.shotIdx;
    extendYaw(w, Math.ceil(idx) + 1, rng);
    const sp = currentSpread(w, move);
    const [ru, rr] = recoilAt(w, idx);
    // 배율: 조준 ×0.9, 달리며 쏘면 세로 최대 ×1.8, 앉아서 멈춰 쏘면 가로 ×0.85
    const walk = VANDAL.speed * MOVE.walkMult;
    const runK = move.airborne ? 1 : Math.min(1, Math.max(0, (move.speed - walk) / (VANDAL.speed - walk)));
    const am = ads ? VANDAL.adsRecoilMult : 1;
    const um = am * (1 + (VANDAL.runRecoilMult - 1) * runK);
    const still = move.speed <= VANDAL.speed * MOVE.accurateFrac && !move.airborne;
    const rmul = am * (move.crouched && still ? VANDAL.crouchYawMult : 1);
    w.recoilMult[0] = um;
    w.recoilMult[1] = rmul;
    // 퍼짐 원 안: 멈춰 있으면 가운데로 몰리고(반지름 ∝ U), 움직이면 고르게(∝ √U) [추정]
    const ang = rng() * Math.PI * 2;
    const u = rng();
    const rad = (sp.move > 0 ? Math.sqrt(u) : u) * sp.total;
    shots.push({
      index: idx,
      recoil: [ru * um, rr * rmul],
      spread: sp.total,
      moveError: sp.move,
      dx: Math.cos(ang) * rad,
      dy: Math.sin(ang) * rad,
      accurate: sp.move === 0,
      ads,
    });
    w.ammo -= 1;
    w.totalShots += 1;
    // 이어서 쏘면 한 발씩, 회복 중에 끊어 쏘면 1/6 발만 쌓임 (Tap Efficiency 6). 완전히 돌아온 첫 발은 1
    w.shotIdx = spraying || idx === 0 ? idx + 1 : idx + 1 / VANDAL.tapEfficiency;
    w.recoverFrom = 0;
    w.sinceShot = 0;
    w.cooldown += 1 / rate;
  }
  if (!input.fire && w.cooldown < 0) w.cooldown = 0;
  if (w.ammo <= 0 && w.reload <= 0 && w.reserve > 0 && !input.fire) {
    startReload(w); // 다 쏘면 자동 재장전
    events.push('reload');
  }
  return { shots, events };
}
