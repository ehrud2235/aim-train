// 봇 길찾기: 0.5m 격자 위 A*. 벽에서 조금 떨어진(몸이 들어가는) 칸만 쓰고,
// 높이 차이가 계단 높이 이하인 이웃끼리 잇는다 (1.6m 까지는 뛰어내리기만 가능).

import { K } from './mapgrid.js';
import { MOVE } from './valorant.js';
import { segmentWalkable } from './bots.js';
import { groundHeight } from './movement.js';

const NAV = 0.5;
const DROP = 1.6;

export function buildNav(map) {
  const f = Math.round(NAV / map.cell); // 작은 칸 몇 개가 한 칸인지
  const w = Math.floor(map.nx / f);
  const h = Math.floor(map.ny / f);
  const z = new Float32Array(w * h).fill(NaN);
  // 플레이어와 같은 규칙: 그 자리에 몸(반지름)이 서 있을 수 있는 칸만
  const solid = (i, j) => {
    if (i < 0 || j < 0 || i >= map.nx || j >= map.ny) return true;
    const kd = map.kind[j * map.nx + i];
    return kd !== K.FLOOR && kd !== K.STAIRS;
  };
  for (let J = 0; J < h; J++) {
    for (let I = 0; I < w; I++) {
      const ci = I * f + (f >> 1);
      const cj = J * f + (f >> 1);
      if (solid(ci, cj)) continue;
      const x = map.x0 + (I + 0.5) * NAV;
      const y = map.y0 + (J + 0.5) * NAV;
      const z0 = map.top[cj * map.nx + ci];
      const g = groundHeight(map, x, y, z0 + MOVE.stepHeight);
      if (g === null || Math.abs(g - z0) > MOVE.stepHeight) continue;
      z[J * w + I] = g;
    }
  }
  return { w, h, z, f, size: NAV, map };
}

function nodeOf(nav, x, y) {
  const I = Math.floor((x - nav.map.x0) / nav.size);
  const J = Math.floor((y - nav.map.y0) / nav.size);
  if (I < 0 || J < 0 || I >= nav.w || J >= nav.h) return -1;
  return J * nav.w + I;
}

export function nodePos(nav, n) {
  const I = n % nav.w;
  const J = (n / nav.w) | 0;
  return [nav.map.x0 + (I + 0.5) * nav.size, nav.map.y0 + (J + 0.5) * nav.size];
}

/** (x,y) 에서 가장 가까운 쓸 수 있는 칸 */
export function nearestNode(nav, x, y, maxR = 14) {
  const n0 = nodeOf(nav, x, y);
  if (n0 >= 0 && !Number.isNaN(nav.z[n0])) return n0;
  const I0 = Math.floor((x - nav.map.x0) / nav.size);
  const J0 = Math.floor((y - nav.map.y0) / nav.size);
  for (let r = 1; r <= maxR; r++) {
    let best = -1;
    let bd = Infinity;
    for (let J = J0 - r; J <= J0 + r; J++) {
      for (let I = I0 - r; I <= I0 + r; I++) {
        if (I < 0 || J < 0 || I >= nav.w || J >= nav.h) continue;
        const n = J * nav.w + I;
        if (Number.isNaN(nav.z[n])) continue;
        const d = (I - I0) ** 2 + (J - J0) ** 2;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** 쓸 수 있는 칸 전체 (무작위 목적지·생성 위치 고르기용) */
export function navNodes(nav) {
  if (!nav.list) {
    nav.list = [];
    for (let n = 0; n < nav.z.length; n++) if (!Number.isNaN(nav.z[n])) nav.list.push(n);
  }
  return nav.list;
}

class Heap {
  constructor() {
    this.a = [];
  }
  push(n, p) {
    const a = this.a;
    a.push([p, n]);
    let i = a.length - 1;
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (a[q][0] <= a[i][0]) break;
      [a[q], a[i]] = [a[i], a[q]];
      i = q;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() {
    return this.a.length;
  }
}

/**
 * A* 길찾기 → 걸어갈 지점 목록 [[x,y], ...] (직선으로 갈 수 있는 곳은 건너뜀). 못 찾으면 null.
 */
export function findPath(nav, ax, ay, bx, by, maxNodes = 60000) {
  const s = nearestNode(nav, ax, ay);
  const t = nearestNode(nav, bx, by);
  if (s < 0 || t < 0) return null;
  const { w, h, z } = nav;
  const g = new Map([[s, 0]]);
  const came = new Map();
  const open = new Heap();
  const [tx, ty] = [t % w, (t / w) | 0];
  const H = (n) => Math.hypot((n % w) - tx, ((n / w) | 0) - ty);
  open.push(s, H(s));
  let seen = 0;
  while (open.size) {
    const n = open.pop();
    if (n === t) break;
    if (++seen > maxNodes) return null;
    const I = n % w;
    const J = (n / w) | 0;
    const gn = g.get(n);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = I + di;
        const b = J + dj;
        if (a < 0 || b < 0 || a >= w || b >= h) continue;
        const m = b * w + a;
        if (Number.isNaN(z[m])) continue;
        const dz = z[m] - z[n];
        if (dz > MOVE.stepHeight || dz < -DROP) continue;
        if (di && dj && (Number.isNaN(z[J * w + a]) || Number.isNaN(z[b * w + I]))) continue; // 모서리 자르지 않기
        const cost = gn + (di && dj ? Math.SQRT2 : 1);
        if (cost < (g.get(m) ?? Infinity)) {
          g.set(m, cost);
          came.set(m, n);
          open.push(m, cost + H(m));
        }
      }
    }
  }
  if (!came.has(t) && s !== t) return null;
  const nodes = [t];
  while (nodes[nodes.length - 1] !== s) nodes.push(came.get(nodes[nodes.length - 1]));
  nodes.reverse();
  const pts = nodes.map((n) => nodePos(nav, n));
  pts[pts.length - 1] = [bx, by];
  // 직선으로 갈 수 있으면 중간 지점 생략
  const out = [];
  let cur = [ax, ay];
  let i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 40); // 너무 멀리까지는 확인하지 않음 (계산량)
    while (j > i && !segmentWalkable(nav.map, cur[0], cur[1], pts[j][0], pts[j][1])) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return out;
}
