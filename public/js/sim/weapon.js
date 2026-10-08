// 밴달 / 칼 상태: 연사 속도, 탄창, 재장전, 꺼내기 시간, 조준(ADS), 퍼짐, 스프레이 반동과 회복.
// 화면·사운드와 상관없는 순수 계산이라 테스트에서 그대로 돌린다.

import { VANDAL, KNIFE, MOVE, vandalRecoil } from './valorant.js';

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
    spraySide: 1,
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

/** 현재 반동(화면 흔들림용): 소수 shotIdx 를 보간 */
export function currentRecoil(w) {
  const k = w.shotIdx - 1;
  if (k <= 0) {
    const [u, r] = vandalRecoil(0, w.spraySide);
    const f = Math.max(0, w.shotIdx);
    return [u * f, r * f];
  }
  const a = Math.floor(k);
  const f = k - a;
  const p0 = vandalRecoil(a, w.spraySide);
  const p1 = vandalRecoil(a + 1, w.spraySide);
  return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f];
}

/**
 * 이동 오차(°): 정확 기준 속도 이하면 0, 걷기 속도에서 walkError, 달리기 속도에서 runError, 공중이면 jumpError.
 */
export function movementError(speed, airborne, maxRun = VANDAL.speed) {
  if (airborne) return VANDAL.jumpError;
  const thr = maxRun * MOVE.accurateFrac;
  if (speed <= thr) return 0;
  const walk = maxRun * MOVE.walkMult;
  if (speed <= walk) return (VANDAL.walkError * (speed - thr)) / (walk - thr);
  const f = Math.min(1, (speed - walk) / (maxRun - walk));
  return VANDAL.walkError + (VANDAL.runError - VANDAL.walkError) * f;
}

/** 지금 쏘면 퍼짐 반각(°) */
export function currentSpread(w, move) {
  const ads = isAds(w);
  const base = ads ? VANDAL.adsFirstShotSpread : VANDAL.firstShotSpread;
  const n = Math.floor(w.shotIdx);
  let spray = Math.min(VANDAL.sprayErrorMax, VANDAL.sprayErrorPerShot * Math.max(0, n - VANDAL.sprayErrorStart + 1));
  if (ads) spray *= VANDAL.adsErrorMult;
  const mv = movementError(move.speed, move.airborne);
  let total = base + spray + mv;
  if (move.crouched && !move.airborne) total *= VANDAL.crouchMult;
  return { total, base, spray, move: mv };
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

  // 반동 회복
  w.sinceShot += dt;
  if (w.sinceShot > VANDAL.recoverDelay && w.shotIdx > 0) {
    w.shotIdx = Math.max(0, w.shotIdx - (VANDAL.recoverRate + w.shotIdx * VANDAL.recoverRateScale) * dt);
    if (w.shotIdx === 0) w.spraySide = rng() < 0.5 ? -1 : 1;
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
    const n = Math.floor(w.shotIdx);
    const sp = currentSpread(w, move);
    const rec = vandalRecoil(n, w.spraySide);
    const rm = ads ? VANDAL.adsRecoilMult : 1;
    // 원 안에 고르게
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * sp.total;
    shots.push({
      index: n,
      recoil: [rec[0] * rm, rec[1] * rm],
      spread: sp.total,
      moveError: sp.move,
      dx: Math.cos(ang) * rad,
      dy: Math.sin(ang) * rad,
      accurate: sp.move === 0,
      ads,
    });
    w.ammo -= 1;
    w.totalShots += 1;
    w.shotIdx = n + 1;
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
