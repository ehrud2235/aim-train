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

/** 줌 배율 z 일 때의 가로 시야각 (초점거리 기준) */
export function zoomedHfov(zoom) {
  const t = Math.tan((HFOV / 2) * (Math.PI / 180)) / zoom;
  return (2 * Math.atan(t) * 180) / Math.PI;
}

/** 이동 */
export const MOVE = {
  knifeSpeed: 6.75, // 칼 들었을 때 달리기 [확인]
  walkMult: 0.5526, // Shift 걷기 = 달리기의 약 55% [추정] (밴달 2.98 m/s)
  crouchMult: 0.45, // 앉아 걷기 [추정]
  // 이 속도(무기 최대 속도 대비) 이하이면 이동 오차 0 = 완전 정확 [확인: 패치 3.0 에서 30% → 27.5%]
  accurateFrac: 0.275,
  accel: 32, // 입력 방향 가속 m/s² — 0→5.4 m/s 약 0.17초 [추정]
  brake: 52, // 키를 놓았을 때 감속 m/s² — 5.4→0 약 0.1초 [추정]
  counterBrake: 20, // 반대키(카운터 스트레이핑)로 더 빨리 서는 추가 감속 — 발로는 차이가 작다 [추정]
  airAccel: 6, // 공중 방향 전환 (약간의 에어 스트레이프) [추정]
  gravity: 13.5, // [추정]
  jumpVel: 5.0, // 점프 높이 약 0.93 m, 체공 약 0.74 초 [추정]
  stepHeight: 0.55, // 자동으로 올라가는 턱 높이 [추정]
  radius: 0.34, // 몸 반지름 [추정]
  eyeStand: 1.6, // 서 있을 때 눈 높이 [추정]
  eyeCrouch: 1.12, // 앉았을 때 눈 높이 [추정]
  crouchTime: 0.12, // 앉기/일어서기 시간 [추정]
  landSlowTime: 0.1, // 착지 직후 잠깐 느려짐 [추정]
  landSlowMult: 0.6,
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
  // 첫 발 퍼짐(원뿔 반각, °): 지향사격 0.25, 조준 0.157 [확인]
  firstShotSpread: 0.25,
  adsFirstShotSpread: 0.157,
  // 이동 오차 (°) — 속도에 따라 0 → 걷기 → 달리기 값으로 커진다 [추정]
  walkError: 2.6,
  runError: 6.0,
  jumpError: 11.0,
  crouchMult: 0.85, // 앉으면 퍼짐 ×0.85 [추정]
  adsErrorMult: 0.7, // 조준 시 연사 퍼짐 배율 [추정]
  // 연사 퍼짐: 3발째부터 한 발마다 늘어남 [추정]
  sprayErrorStart: 3,
  sprayErrorPerShot: 0.2,
  sprayErrorMax: 2.0,
  // 반동 회복: 마지막 발 이후 이 시간이 지나면 회복 시작, 초당 회복되는 '발 수' [추정]
  recoverDelay: 0.11,
  recoverRate: 16,
  recoverRateScale: 4.5, // 많이 쏠수록 빨리 돌아옴 (발수 × 이 값 /초)
  viewKick: 0.3, // 반동 중 화면(크로스헤어)이 같이 올라가는 비율 — 나머지는 탄이 크로스헤어 위로 튄다 [추정]
  adsRecoilMult: 0.9, // [추정]
  penetration: 'medium', // 벽 관통: 중간 [확인]
};

/**
 * 밴달 스프레이 패턴 — n 번째 발의 반동 (°): [위, 오른쪽+]
 * 처음 몇 발은 거의 직선으로 오르고, 10발 근처부터 좌우로 흔들린다. [추정: 연습장 탄착 모양을 흉내]
 */
const VANDAL_PATTERN = [
  [0, 0], [0.32, 0.0], [0.78, 0.02], [1.38, -0.03], [2.05, 0.05], [2.72, -0.06], [3.35, 0.08], [3.9, 0.0],
  [4.38, -0.18], [4.78, -0.45], [5.08, -0.8], [5.3, -1.12], [5.46, -1.3], [5.58, -1.2], [5.68, -0.85],
  [5.76, -0.3], [5.82, 0.3], [5.88, 0.85], [5.93, 1.25], [5.98, 1.4], [6.02, 1.15], [6.06, 0.6],
  [6.1, -0.05], [6.13, -0.7], [6.16, -1.15],
];

/** n(0부터)번째 발 반동. 좌우 흔들림 방향은 스프레이마다 무작위(side=±1) */
export function vandalRecoil(n, side = 1) {
  const p = VANDAL_PATTERN[Math.min(n, VANDAL_PATTERN.length - 1)];
  return [p[0], p[1] * side];
}

/** 칼 */
export const KNIFE = { name: 'Knife', speed: 6.75, equipTime: 0.75 };

/** 체력: 100 + 중방어구 50 = 150. 방어구가 먼저 다 깎인다. [확인] 밴달 몸 4발, 머리 1발 */
export const HP_FULL = 150;

/** 몸 판정 박스 (캐릭터 기준, 발바닥이 0) [추정] */
export const HITBOX = {
  head: { y0: 1.5, y1: 1.82, hw: 0.14, hd: 0.15 },
  body: { y0: 0.88, y1: 1.5, hw: 0.25, hd: 0.16 },
  leg: { y0: 0, y1: 0.88, hw: 0.2, hd: 0.14 },
  crouchDrop: 0.42, // 앉으면 머리·몸이 이만큼 내려간다
};

/** 크로스헤어 색 (발로 코드 c 번호) [확인] */
export const CROSSHAIR_COLORS = ['#ffffff', '#00ff00', '#7fff00', '#dfff00', '#ffff00', '#00ffff', '#ff00ff', '#ff0000'];

/** 적 하이라이트 색 (발로 설정) */
export const ENEMY_COLORS = { red: '#ff3b3b', yellow: '#f5e33b', purple: '#c24bff' };
