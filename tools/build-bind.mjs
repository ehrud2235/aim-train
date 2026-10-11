// 실제 바인드 지형 → 연습장 격자(maps/bind.grid.gz) 만들기.
//
// 원본 데이터 (게임 파일에서 추출된 것, Icarus 프로젝트가 공개 저장소에 정리해 둔 것):
//   - assets/maps/world/bind_navigation.json.gz  : 바인드 Recast 내비메시(/Game/Maps/Duality/Duality_NavMesh) — 걸을 수 있는 바닥과 높이(cm)
//   - assets/maps/bind_svg_height_attack.json.gz : 벽 다각형(시야 높이 구간 포함), 상자·트럭·컨테이너 같은 엄폐물과 윗면 높이(m)
// 좌표 변환:
//   - 미니맵 UV = Riot 맵 UI 데이터 (valorant-api.com maps: xMultiplier 5.9e-05, yScalarToAdd ...) — 1 UV = 169.49 m
//   - SVG ↔ UV = Icarus 의 1024px 미니맵 정합값 (lib/const/maps.dart visionGeometryPadding.bind)
//
// 사용법: node tools/build-bind.mjs <icarus 저장소 경로>
// 결과물은 저장소에 같이 커밋해 두므로, 화면을 열 때는 이 스크립트가 필요 없다.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ICARUS = process.argv[2] || '../SunkenInTime/icarus';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'maps', 'bind.grid.gz');

// ── 좌표계 ──
// 게임 평면: x = 동(미니맵 오른쪽), y = 북(미니맵 위쪽), 단위 m. 높이 z 는 게임 월드 Z(m).
const UV_METERS = 1 / (5.9e-5 * 100); // 1 UV = 169.4915 m
const SVG_PAD = { left: 40.987741089, top: -12.824899665, size: 416 + 40.987741089 + 5.51473234 }; // = 462.5025
const uvToM = (u, v) => [u * UV_METERS, (1 - v) * UV_METERS];
const svgToM = (sx, sy) => uvToM((sx + SVG_PAD.left) / SVG_PAD.size, (sy + SVG_PAD.top) / SVG_PAD.size);

const CELL = 0.25;
const MARGIN = 3;

const K = { WALL: 0, FLOOR: 1, STAIRS: 2, PROP: 3, RAIL: 4, DOOR: 5 };
const NONE = 32767;

// 바인드 위치 이름 (valorant-api.com 의 미니맵 UV 좌표, 2025 패치 기준) → 한국어 이름
const CALLOUTS = [
  ['aExit', 'A 출구', 0.9235, 0.5221],
  ['aLink', 'A 링크', 0.5175, 0.592],
  ['aLobby', 'A 로비', 0.7633, 0.6069],
  ['aShort', 'A 숏', 0.6244, 0.4965],
  ['aSite', 'A 사이트', 0.7341, 0.3334],
  ['aTele', 'A 텔레포터', 0.6058, 0.4111],
  ['atkSpawn', '공격팀 스폰', 0.5815, 0.958],
  ['bExit', 'B 출구', 0.4729, 0.4412],
  ['bHall', 'B 홀', 0.2854, 0.2016],
  ['bLink', 'B 링크', 0.4223, 0.592],
  ['bFountain', 'B 분수', 0.2589, 0.6291],
  ['bLong', 'B 롱', 0.1927, 0.5152],
  ['bShort', 'B 숏', 0.3966, 0.5295],
  ['bSite', 'B 사이트', 0.2919, 0.3122],
  ['bTele', 'B 텔레포터', 0.1507, 0.4349],
  ['bWindow', 'B 창문 (후카)', 0.3227, 0.4468],
  ['aBath', 'A 바스', 0.8395, 0.4303],
  ['atkCave', '공격팀 동굴', 0.5921, 0.7363],
  ['aCubby', 'A 커비', 0.5873, 0.4599],
  ['defSpawn', '수비팀 스폰', 0.5169, 0.1037],
  ['bElbow', 'B 엘보', 0.1583, 0.306],
  ['bGarden', 'B 가든', 0.2467, 0.4281],
  ['aLamps', 'A 램프', 0.5817, 0.3392],
  ['aTower', 'A 타워 (헤븐)', 0.7278, 0.2081],
];

// 엄폐물 종류 (색 고르기용)
const PROP_KIND = {
  'Wooden crate': 1,
  'Covered crate': 1,
  Box: 2,
  'Metal cover': 3,
  Barrel: 4,
  'B-site container top': 5,
  'B Site container': 5,
  Vehicle: 6,
  Bathhouse: 7,
  'upper Shard box tops': 2,
  'lower Shard box tops': 2,
};
const PROP_NAMES = ['', 'crate', 'box', 'metal', 'barrel', 'container', 'vehicle', 'bath'];

function load(p) {
  const raw = fs.readFileSync(path.join(ICARUS, p));
  return JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(raw) : raw);
}

const nav = load('assets/maps/world/bind_navigation.json.gz');
const heights = load('assets/maps/bind_svg_height_attack.json.gz');
if (nav.map !== 'bind' || heights.map !== 'bind') throw new Error('바인드 데이터가 아님');

// ── 바닥 삼각형 (m) ──
const fm = nav.floorMesh;
const fv = fm.vertices;
const floorPts = [];
let minX = Infinity;
let minY = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
for (let i = 0; i < fv.length; i += 3) {
  const [x, y] = uvToM(fv[i] / fm.coordinateScale, fv[i + 1] / fm.coordinateScale);
  const z = fv[i + 2] / 100;
  floorPts.push([x, y, z]);
  minX = Math.min(minX, x);
  minY = Math.min(minY, y);
  maxX = Math.max(maxX, x);
  maxY = Math.max(maxY, y);
}
const x0 = Math.floor((minX - MARGIN) / CELL) * CELL;
const y0 = Math.floor((minY - MARGIN) / CELL) * CELL;
const nx = Math.ceil((maxX + MARGIN - x0) / CELL);
const ny = Math.ceil((maxY + MARGIN - y0) / CELL);
const N = nx * ny;
console.log(`격자 ${nx}×${ny} (${(nx * CELL).toFixed(0)}×${(ny * CELL).toFixed(0)} m), 원점 (${x0}, ${y0})`);

const navZ = new Float32Array(N).fill(NaN); // 내비메시가 덮는 칸의 바닥 높이
const cx = (i) => x0 + (i + 0.5) * CELL;
const cy = (j) => y0 + (j + 0.5) * CELL;

const ft = fm.triangles;
for (let t = 0; t < ft.length; t += 4) {
  const A = floorPts[ft[t + 1]];
  const B = floorPts[ft[t + 2]];
  const C = floorPts[ft[t + 3]];
  const bx0 = Math.max(0, Math.floor((Math.min(A[0], B[0], C[0]) - x0) / CELL));
  const bx1 = Math.min(nx - 1, Math.floor((Math.max(A[0], B[0], C[0]) - x0) / CELL));
  const by0 = Math.max(0, Math.floor((Math.min(A[1], B[1], C[1]) - y0) / CELL));
  const by1 = Math.min(ny - 1, Math.floor((Math.max(A[1], B[1], C[1]) - y0) / CELL));
  const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  if (Math.abs(d) < 1e-12) continue;
  for (let j = by0; j <= by1; j++) {
    for (let i = bx0; i <= bx1; i++) {
      const px = cx(i);
      const py = cy(j);
      const l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / d;
      const l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / d;
      const l3 = 1 - l1 - l2;
      const e = -1e-4;
      if (l1 < e || l2 < e || l3 < e) continue;
      const z = l1 * A[2] + l2 * B[2] + l3 * C[2];
      const k = j * nx + i;
      if (Number.isNaN(navZ[k]) || z > navZ[k]) navZ[k] = z;
    }
  }
}

// ── 다각형 칠하기 (짝홀 규칙, 칸 중심) + 테두리 보수적 칠하기 ──
function ringsToM(rings) {
  return rings.map((r) => {
    const pts = [];
    for (let i = 0; i + 1 < r.length; i += 2) pts.push(svgToM(r[i], r[i + 1]));
    return pts;
  });
}
function fillRings(rings, fn, conservative) {
  // 행마다 교차점
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const r of rings) for (const p of r) {
    ymin = Math.min(ymin, p[1]);
    ymax = Math.max(ymax, p[1]);
  }
  const j0 = Math.max(0, Math.floor((ymin - y0) / CELL));
  const j1 = Math.min(ny - 1, Math.floor((ymax - y0) / CELL));
  for (let j = j0; j <= j1; j++) {
    const y = cy(j);
    const xs = [];
    for (const r of rings) {
      for (let a = 0; a < r.length; a++) {
        const p = r[a];
        const q = r[(a + 1) % r.length];
        if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) {
          xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - x0) / CELL - 0.5));
      const i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) fn(j * nx + i);
    }
  }
  if (conservative) {
    for (const r of rings) {
      for (let a = 0; a < r.length; a++) {
        const p = r[a];
        const q = r[(a + 1) % r.length];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const n = Math.max(1, Math.ceil(L / 0.05));
        for (let s = 0; s <= n; s++) {
          const x = p[0] + ((q[0] - p[0]) * s) / n;
          const y = p[1] + ((q[1] - p[1]) * s) / n;
          const i = Math.floor((x - x0) / CELL);
          const j = Math.floor((y - y0) / CELL);
          if (i >= 0 && j >= 0 && i < nx && j < ny) fn(j * nx + i);
        }
      }
    }
  }
}

// ── 벽 (시야 높이 구간 bands: 관찰자 눈높이 구간. 'floorElevation -100 + band' = 절대 높이 m) ──
const wallFull = new Uint8Array(N);
const lowTop = new Float32Array(N).fill(-Infinity); // 이 높이까지 막힘 (넘겨 볼 수 있는 낮은 벽)
const winCeil = new Float32Array(N).fill(Infinity); // 창문 위쪽 막힘 시작
for (const w of heights.walls) {
  const base = w.floorElevationMeters; // -100
  const bands = w.bands.map(([a, b]) => [a + base, b === null ? Infinity : b + base]);
  const rings = ringsToM(w.rings);
  const full = bands.length === 1 && bands[0][0] <= base + 1e-6 && bands[0][1] === Infinity;
  if (full) {
    fillRings(rings, (k) => (wallFull[k] = 1), true);
    continue;
  }
  // 아래쪽에서 시작하는 구간 = 그 높이까지 막는 낮은 벽, 위쪽 끝이 열린 두 번째 구간 = 창문 위 벽
  const low = bands.find((b) => b[0] <= base + 1e-6);
  const high = bands.find((b) => b[0] > base + 1e-6 && b[1] === Infinity);
  if (low && Number.isFinite(low[1])) {
    fillRings(rings, (k) => {
      lowTop[k] = Math.max(lowTop[k], low[1]);
      if (high) winCeil[k] = Math.min(winCeil[k], high[0]);
    }, true);
  }
}

// ── 엄폐물 (상자·트럭·컨테이너…: 윗면 높이까지 꽉 찬 덩어리) ──
const propTop = new Float32Array(N).fill(-Infinity);
const propKind = new Uint8Array(N);
for (const s of heights.supports) {
  const kind = PROP_KIND[s.label];
  if (!kind) continue; // Ground/Platform 은 바닥(내비메시가 이미 가짐)
  fillRings(ringsToM(s.rings), (k) => {
    if (s.surfaceElevationMeters > propTop[k]) {
      propTop[k] = s.surfaceElevationMeters;
      propKind[k] = kind;
    }
  }, false);
}

// ── 바닥 넓히기: 내비메시는 벽에서 42cm 안쪽까지만 있으므로 벽 쪽으로 채움 ──
const floorZ = Float32Array.from(navZ);
const fromNav = new Uint8Array(N);
for (let k = 0; k < N; k++) if (!Number.isNaN(navZ[k])) fromNav[k] = 1;
let frontier = [];
for (let k = 0; k < N; k++) if (fromNav[k]) frontier.push(k);
const DILATE = 3; // 0.75m
for (let step = 0; step < DILATE; step++) {
  const next = [];
  const add = new Map();
  for (const k of frontier) {
    const i = k % nx;
    const j = (k / nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a;
      if (!Number.isNaN(floorZ[n]) || wallFull[n]) continue;
      const prev = add.get(n);
      if (prev === undefined || floorZ[k] > prev) add.set(n, floorZ[k]);
    }
  }
  for (const [n, z] of add) {
    floorZ[n] = z;
    next.push(n);
  }
  frontier = next;
}
// 엄폐물 밑바닥: 주변 바닥 높이
for (let pass = 0; pass < 12; pass++) {
  for (let k = 0; k < N; k++) {
    if (!Number.isFinite(propTop[k]) || !Number.isNaN(floorZ[k])) continue;
    const i = k % nx;
    const j = (k / nx) | 0;
    let z = NaN;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (j + dj) * nx + (i + di);
      if (n >= 0 && n < N && !Number.isNaN(floorZ[n])) z = Number.isNaN(z) ? floorZ[n] : Math.min(z, floorZ[n]);
    }
    if (!Number.isNaN(z)) floorZ[k] = z;
  }
}

// 시야 구간 벽(bands)은 '관찰자 눈높이' 기준이라 실제 높이가 아님 → 주변 바닥으로 실제 높이 추정
//  - 근처(1m)에 주변보다 0.5m 이상 높은 걸을 수 있는 면(상자·컨테이너 윗면)이 있으면: 그 면의 옆면 → 그 높이
//  - 아니면 난간·창틀: 높은 쪽 바닥 + 최대 1.1m
function railTop(k, bandTop) {
  const i = k % nx;
  const j = (k / nx) | 0;
  const R = 4;
  let lo = Infinity;
  let hi = -Infinity;
  for (let dj = -R; dj <= R; dj++) {
    for (let di = -R; di <= R; di++) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const z = navZ[b * nx + a];
      if (Number.isNaN(z)) continue;
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  if (!Number.isFinite(hi)) return bandTop;
  if (hi > lo + 0.5) return Math.min(bandTop, hi);
  return Math.min(bandTop, hi + 1.1);
}

// ── 칸 종류 결정 ──
const top = new Int16Array(N).fill(NONE);
const floorOut = new Int16Array(N).fill(NONE);
const ceil = new Int16Array(N).fill(NONE);
const kind = new Uint8Array(N); // WALL
const prop = new Uint8Array(N);
const cm = (m) => Math.max(-32000, Math.min(32000, Math.round(m * 100)));
for (let k = 0; k < N; k++) {
  const f = floorZ[k];
  const hasFloor = !Number.isNaN(f);
  if (Number.isFinite(propTop[k]) && (!hasFloor || propTop[k] > f + 0.05)) {
    kind[k] = K.PROP;
    top[k] = cm(propTop[k]);
    floorOut[k] = cm(hasFloor ? f : propTop[k]);
    prop[k] = propKind[k];
    continue;
  }
  if (hasFloor && (fromNav[k] || !wallFull[k])) {
    floorOut[k] = cm(f);
    const rt = Number.isFinite(lowTop[k]) && !fromNav[k] ? railTop(k, lowTop[k]) : -Infinity;
    if (rt > f + 0.4) {
      kind[k] = K.RAIL; // 넘겨 볼 수 있는 낮은 벽
      top[k] = cm(rt);
      if (Number.isFinite(winCeil[k])) ceil[k] = cm(winCeil[k]);
    } else {
      kind[k] = K.FLOOR;
      top[k] = cm(f);
    }
    continue;
  }
  if (!wallFull[k] && Number.isFinite(lowTop[k])) {
    // 바닥 없는 곳의 낮은 벽 (난간·창틀·상자 옆면): 그 높이까지만 막힘
    const rt = railTop(k, lowTop[k]);
    kind[k] = K.RAIL;
    top[k] = cm(rt);
    floorOut[k] = cm(rt);
    if (Number.isFinite(winCeil[k])) ceil[k] = cm(winCeil[k]);
    continue;
  }
  kind[k] = K.WALL;
}

// 벽 높이: 주변(3m 안) 가장 높은 바닥 + 8m. 맵 밖 먼 곳은 그대로 높은 벽
const WALL_ABOVE = 8;
{
  const R = Math.round(3 / CELL);
  // 가로 → 세로 최대값 필터 (분리 가능)
  const tmp = new Float32Array(N).fill(-Infinity);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let m = -Infinity;
      for (let d = -R; d <= R; d++) {
        const a = i + d;
        if (a < 0 || a >= nx) continue;
        const k = j * nx + a;
        if (kind[k] !== K.WALL && top[k] !== NONE) m = Math.max(m, top[k] / 100);
      }
      tmp[j * nx + i] = m;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (kind[k] !== K.WALL) continue;
      let m = -Infinity;
      for (let d = -R; d <= R; d++) {
        const b = j + d;
        if (b < 0 || b >= ny) continue;
        m = Math.max(m, tmp[b * nx + i]);
      }
      top[k] = cm((Number.isFinite(m) ? m : 0) + WALL_ABOVE);
    }
  }
}

// ── 위치 이름: 걸을 수 있는 칸을 따라 가장 가까운 콜아웃 (벽을 넘지 않는 거리) ──
const region = new Uint8Array(N);
{
  const q = [];
  CALLOUTS.forEach(([, , u, v], idx) => {
    const [x, y] = uvToM(u, v);
    // 콜아웃 점 근처에서 걸을 수 있는 칸 찾기
    let best = -1;
    let bd = Infinity;
    const i0 = Math.floor((x - x0) / CELL);
    const j0 = Math.floor((y - y0) / CELL);
    for (let dj = -12; dj <= 12; dj++) {
      for (let di = -12; di <= 12; di++) {
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (kind[k] !== K.FLOOR) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
    }
    if (best >= 0 && !region[best]) {
      region[best] = idx + 1;
      q.push(best);
    }
  });
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    const i = k % nx;
    const j = (k / nx) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = b * nx + a;
      if (region[n] || kind[n] === K.WALL) continue;
      if (Math.abs(top[n] - top[k]) > 120 && kind[n] !== K.PROP) continue; // 큰 낭떠러지는 넘지 않음
      region[n] = region[k];
      q.push(n);
    }
  }
}

// ── 텔레포터 (미니맵 그림의 화살표 위치 = SVG 좌표) ──
// A: A 숏 서쪽 벽의 텔레포터 → B 출구 방(후카 옆) 동쪽 끝, 서쪽을 보며 나옴
// B: B 텔레포터 방 서쪽 끝 → A 출구 방(A 바스 옆) 동쪽 끝, 서쪽을 보며 나옴
// 들어가는 판(pad)은 화살표가 닿는 벽 바로 안쪽 바닥 1.3~1.6m (m 좌표, 위 렌더로 확인한 값)
const teleporters = [
  { id: 'A', label: 'A 텔레포터 → B 출구', pad: [102.3, 98.9, 103.6, 101.8], to: svgToM(184.5, 216.5).map((v) => +v.toFixed(2)), heading: 270, inHeading: 270 },
  { id: 'B', label: 'B 텔레포터 → A 출구', pad: [24.0, 94.7, 25.6, 98.1], to: svgToM(388.5, 250.0).map((v) => +v.toFixed(2)), heading: 270, inHeading: 270 },
];

// ── 저장 ──
const header = {
  version: 1,
  map: 'bind',
  cell: CELL,
  x0,
  y0,
  nx,
  ny,
  none: NONE,
  props: PROP_NAMES,
  callouts: CALLOUTS.map(([key, label, u, v]) => {
    const [x, y] = uvToM(u, v);
    return { key, label, at: [+x.toFixed(2), +y.toFixed(2)] };
  }),
  teleporters,
  source: 'VALORANT Bind navmesh/vision data via SunkenInTime/icarus (Apache-2.0); Riot map transform via valorant-api.com',
};
const hbuf = Buffer.from(JSON.stringify(header), 'utf8');
let off = 8 + hbuf.length;
if (off % 2) off++;
const total = off + N * 2 * 3 + N * 3;
const out = Buffer.alloc(total);
out.write('VAIM', 0, 'latin1');
out.writeUInt32LE(hbuf.length, 4);
hbuf.copy(out, 8);
let p = off;
for (const arr of [top, floorOut, ceil]) {
  Buffer.from(arr.buffer).copy(out, p);
  p += N * 2;
}
for (const arr of [kind, region, prop]) {
  Buffer.from(arr.buffer).copy(out, p);
  p += N;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const gz = zlib.gzipSync(out, { level: 9 });
fs.writeFileSync(OUT, gz);
const counts = {};
for (let k = 0; k < N; k++) counts[kind[k]] = (counts[kind[k]] || 0) + 1;
console.log('칸 종류', counts, `→ ${OUT} (${(gz.length / 1024).toFixed(0)} KB)`);
