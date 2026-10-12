// 발로란트 수치 모음. 거리 m, 시간 s, 각도 °(도).
// [확인] = 공개 자료로 확인된 값, [추정] = 인게임 느낌·커뮤니티 측정에 맞춘 근사값 (나중에 여기만 고치면 전부 바뀜).

/** 감도: 발로란트는 마우스 1카운트당 0.07° × 감도 만큼 돈다. [확인] (CS 0.022 × 3.181818) */
export const YAW_PER_COUNT = 0.07;

/** 시야각: 16:9 기준 가로 103° 고정. 화면비가 달라도 가로가 고정된다. [확인] */
export const HFOV = 103;

/** 서버 틱 (발로란트 128틱) — 움직임·사격 계산 간격 [확인] */
export const TICK_HZ = 128;

/** 감도·DPI → 360° 도는 데 필요한 마우스 거리(cm) */
export function cmPer360(dpi, sens) {
  const counts = 360 / (YAW_PER_COUNT * sens);
  return (counts / dpi) * 2.54;
}

/** 줌 배율 z 일 때의 가로 시야각 — 발로는 각도를 그대로 나눈다 (밴달 1.25배 → 82.4°) [추정: FOV 계산기·커뮤니티 목록] */
export function zoomedHfov(zoom) {
  return HFOV / zoom;
}

/** 이동 */
export const MOVE = {
  knifeSpeed: 6.75, // 칼 들었을 때 달리기 [확인]
  walkMult: 0.5526, // Shift 걷기 = 달리기의 약 55% [추정] (밴달 2.98 m/s)
  crouchMult: 0.45, // 앉아 걷기 [추정]
  // 이 속도(무기 최대 속도 대비) 이하이면 이동 오차 0 = 완전 정확 [확인: 패치 3.0 에서 30% → 27.5%]
  accurateFrac: 0.275,
  accel: 32, // 입력 방향 가속 m/s² — 0→5.4 m/s 약 0.17초 [추정]
  // 감속: 속도에 비례하는 마찰(지수 감속) + 작은 고정 감속. 달리다 키를 놓으면 걷기 속도까지 약 0.075초,
  // 정확 사격 속도(27.5%)까지 약 0.16초 [확인: 라이엇 개발자 수치(팬텀) 0.065 / 0.17초]
  friction: 7.5, // 1/s
  stopDecel: 1.5, // m/s²
  counterBrake: 2.5, // 반대키(카운터 스트레이핑)로 더 서는 양 — 발로는 약 10ms 차이뿐 [확인: 0.055 / 0.16초]
  airAccel: 6, // 공중 방향 전환 (약간의 에어 스트레이프) [추정]
  gravity: 13.5, // [추정]
  jumpVel: 5.0, // 점프 높이 약 0.93 m, 체공 약 0.74 초 [추정]
  stepHeight: 0.45, // 자동으로 올라가는 턱 높이 — 내비메시 walkableClimb 35cm + 지형 데이터 오차 여유 [추정]
  radius: 0.34, // 몸 반지름 [추정]
  eyeStand: 1.6, // 서 있을 때 눈 높이 [추정]
  eyeCrouch: 1.12, // 앉았을 때 눈 높이 [추정]
  crouchTime: 0.12, // 앉기/일어서기 시간 [추정]
  landErrorTime: 0.225, // 착지 직후 이 시간 동안 오차 +7° [확인: 패치 1.09]
  landError: 7.0,
  tagSlow: 0.725, // 맞으면 72.5% 느려짐 [확인: 패치 3.0]
  tagTime: 0.4, // 원래 속도로 돌아오는 시간 [추정: 0.3~0.5초]
};

/** 밴달 */
export const VANDAL = {
  name: 'Vandal',
  fireRate: 9.75, // 발/초 [확인]
  adsFireRateMult: 0.9, // 조준 시 8.775 발/초 [확인]
  mag: 25, // [확인]
  reserve: 50, // [확인]
  reloadTime: 2.5, // [확인]
  equipTime: 1.0, // [확인]
  damage: { head: 160, body: 40, leg: 34 }, // 거리 감소 없음 [확인]
  speed: 5.4, // 들고 달리는 속도 m/s [확인]
  adsSpeedMult: 0.76, // 조준 중 이동 4.104 m/s [확인]
  zoom: 1.25, // 조준 배율 [확인]
  adsTime: 0.16, // 조준 전환 시간 [추정]
  // 사격 오차(원뿔 반각, °): 첫 발 0.25 → 연사하면 최대 1.0. 조준 0.1575 → 1.02 [확인: valorant-api · 위키 표]
  firstShotSpread: 0.25,
  maxSpread: 1.0,
  adsFirstShotSpread: 0.1575,
  adsMaxSpread: 1.02,
  spreadFullAt: 7, // 이 발수쯤에서 최대 [추정: 7~8발]
  crouchMult: 0.85, // 앉으면 ×0.85 (0.21 / 0.85) [확인]
  // 이동 오차 (°, 사격 오차에 더함) [확인: 패치 9.10 — 소총 걷기 3, 달리기 6, 공중 10, 앉아 이동 0.8]
  walkError: 3.0,
  runError: 6.0,
  jumpError: 10.0,
  crouchMoveError: 0.8,
  // 반동 회복: 마지막 발 뒤 0.375초 동안 첫 발 상태로 돌아옴. 회복 중에 다시 쏘면 1/6 발만큼만 쌓임 [확인: 패치 0.50 Recovery 0.375, Tap Efficiency 6]
  recoveryTime: 0.375,
  tapEfficiency: 6,
  // 스프레이: 1~6발은 위로만, 그 뒤 좌우 [확인: 패치 11.08 보호 탄 6발, 전환 확률 10%, 좌우 전환 0.6초]
  protectedBullets: 6,
  yawSwitchChance: 0.1,
  yawSwitchTime: 0.6,
  viewKick: 0.5, // 지향사격: 화면(크로스헤어)이 반동의 약 50% 를 따라감 [추정: 프레임 측정]
  adsViewKick: 1.0, // 조준: 크로스헤어가 반동을 그대로 따라감 [확인: 위키 'Crosshair follows recoil']
  shotPunch: 0.85, // 발마다 화면이 살짝 튀었다가(25ms) 다음 발 전에 돌아옴 [추정]
  adsRecoilMult: 0.9, // [추정]
  runRecoilMult: 1.8, // 달리면서 쏘면 세로 반동 ×1.8 [확인: 패치 6.11]
  crouchYawMult: 0.85, // 앉아서 멈춰 쏘면 좌우 반동 -15% [확인: 패치 0.50]
  penetration: 'medium', // 벽 관통: 중간 [확인]
};

/**
 * 밴달 세로 반동 (°): n(0부터, 소수 가능)번째 발. 8발째까지 거의 직선으로 7.85° 오르고 8.5~9° 에서 멈춘다.
 * [추정: 영상 프레임 측정 — 라이엇은 크기를 공개하지 않음]
 */
export function vandalPitch(n) {
  if (n <= 0) return 0;
  if (n <= 7) return (7.85 * n) / 7;
  return 7.85 + (8.9 - 7.85) * (1 - Math.exp(-(n - 7) / 2.2));
}

/** 좌우 반동이 커질 수 있는 최대 폭 (°): 보호 탄 이후 늘어나 12발쯤 ±2.4°, 최대 ±2.8° [추정] */
export function vandalYawAmp(n) {
  const p = VANDAL.protectedBullets;
  if (n < p) return 0;
  return Math.min(2.8, 0.4 * (n - p + 1));
}

/** 칼 */
export const KNIFE = { name: 'Knife', speed: 6.75, equipTime: 0.75 };

/** 체력 100 + 중방어구 50. 방어구가 먼저 깎인다. [확인] 밴달 몸 4발, 머리 1발 */
export const HP_MAX = 100;
export const ARMOR_HEAVY = 50;
export const HP_FULL = HP_MAX + ARMOR_HEAVY;
/** 방어구는 맞을 때마다 피해의 66% 를 대신 받는다 (다 닳을 때까지) [확인: 패치 9.10] — 밴달 몸 4발, 다리 5발은 그대로 */
export const ARMOR_ABSORB = 0.66;

/** 데스매치 규칙 [확인: 라이엇 고객지원] */
export const DM = {
  killTarget: 40, // 먼저 40킬
  timeLimit: 540, // 또는 9:00 이 지나면 킬 많은 사람이 승리
  respawn: 1.5, // 죽고 1.5초 뒤 부활
  healthPackLife: 10, // 죽은 자리에 떨어지는 회복팩: 10초 동안, 밟으면 체력·방어구 가득
  healthPackRadius: 1.0, // [추정]
  spawnProtect: 8, // 부활 직후 무적: 움직이거나 쏘기 전까지 (최대 8초 [추정: 2020년 자료])
};

/** 요원 (봇 이름·아이콘). 키 = assets/agents/<키>.webp */
export const AGENTS = [
  ['jett', '제트'], ['reyna', '레이나'], ['phoenix', '피닉스'], ['sage', '세이지'], ['sova', '소바'], ['omen', '오멘'],
  ['brimstone', '브림스톤'], ['raze', '레이즈'], ['killjoy', '킬조이'], ['cypher', '사이퍼'], ['viper', '바이퍼'], ['breach', '브리치'],
  ['skye', '스카이'], ['yoru', '요루'], ['astra', '아스트라'], ['chamber', '체임버'], ['neon', '네온'], ['fade', '페이드'],
].map(([key, name]) => ({ key, name }));

/** 몸 판정 박스 (캐릭터 기준, 발바닥이 0) [추정] */
export const HITBOX = {
  head: { y0: 1.5, y1: 1.82, hw: 0.14, hd: 0.15 },
  body: { y0: 0.88, y1: 1.5, hw: 0.25, hd: 0.16 },
  leg: { y0: 0, y1: 0.88, hw: 0.2, hd: 0.14 },
  crouchDrop: 0.42, // 앉으면 머리·몸이 이만큼 내려간다
};

/** 크로스헤어 색 (발로 코드 c 번호) [확인] */
export const CROSSHAIR_COLORS = ['#ffffff', '#00ff00', '#7fff00', '#dfff00', '#ffff00', '#00ffff', '#ff00ff', '#ff0000'];

/** 적 하이라이트 색 (발로 설정: 빨강(기본) / 보라(제3색맹) / 노랑(제2색맹) / 노랑(제1색맹)) [추정: 색 값] */
export const ENEMY_COLORS = { red: '#ff3b3b', purple: '#c24bff', yellowD: '#f5f53a', yellowP: '#ffe13a' };
