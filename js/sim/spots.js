// 연습 자리 자동 계산: 실제 맵 모양에서 '엄폐물 모서리'를 찾아 봇이 숨었다가 튀어나오는 길을 만든다.
//  - 피킹 지점: 내 시야(정면 ±각도) 안에서 보이는 곳
//  - 숨는 곳: 피킹 지점에서 몇 m 옆, 나한테 안 보이고 일직선으로 걸어서 오갈 수 있는 곳
// 실제 게임에서 적이 나오는 모서리(문틀·상자·벽 끝)가 그대로 골라진다.

import { navNodes, nodePos } from './nav.js';
import { lineOfSight, segmentWalkable } from './bots.js';

const EYE = 1.6;
const HEAD = 1.55;

function bearing(ax, ay, bx, by) {
  return ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
}
function angDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

/** 그 지점에서 가장 가까운 쓸 수 있는 내비 칸 중심 (자리 맞추기) */
export function snapSpot(nav, x, y) {
  let best = null;
  let bd = Infinity;
  for (const n of navNodes(nav)) {
    const [px, py] = nodePos(nav, n);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) {
      bd = d;
      best = [px, py];
    }
  }
  return best;
}

function visibleFrom(map, at, eye, p) {
  return lineOfSight(map, at[0], at[1], eye, p[0], p[1], map.floorAt(p[0], p[1]) + HEAD);
}

/**
 * 각 잡기 길 찾기.
 * opts: { fov: 정면 ±각도, minDist, maxDist, count, sep: 피킹 지점끼리 최소 각도 }
 * 반환: [{ hide, peek, dist }]
 */
export function autoLanes(map, nav, at, heading, opts = {}) {
  const { fov = 42, minDist = 9, maxDist = 42, count = 4, sep = 7 } = opts;
  const eye = map.floorAt(at[0], at[1]) + EYE;
  const nodes = navNodes(nav);
  // 1) 시야 안의 칸 → 보임/안 보임
  const cand = [];
  const visMap = new Map();
  for (const n of nodes) {
    const p = nodePos(nav, n);
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d < minDist - 6 || d > maxDist + 6) continue;
    const ang = angDiff(bearing(at[0], at[1], p[0], p[1]), heading);
    if (Math.abs(ang) > fov + 25) continue;
    const v = visibleFrom(map, at, eye, p);
    visMap.set(n, v);
    if (v && d >= minDist && d <= maxDist && Math.abs(ang) <= fov) cand.push({ n, p, d, ang });
  }
  // 2) 보이는 칸 중 근처(1.5~5m)에 안 보이는 칸이 있는 곳 = 엄폐물 모서리
  const lanes = [];
  for (const c of cand) {
    let best = null;
    for (let r = 3; r <= 10; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const I = (c.n % nav.w) + di;
          const J = ((c.n / nav.w) | 0) + dj;
          if (I < 0 || J < 0 || I >= nav.w || J >= nav.h) continue;
          const m = J * nav.w + I;
          if (Number.isNaN(nav.z[m])) continue;
          let v = visMap.get(m);
          const q = nodePos(nav, m);
          if (v === undefined) {
            v = visibleFrom(map, at, eye, q);
            visMap.set(m, v);
          }
          if (v) continue;
          if (!segmentWalkable(map, q[0], q[1], c.p[0], c.p[1]) || !segmentWalkable(map, c.p[0], c.p[1], q[0], q[1])) continue;
          // 숨는 곳에서 피킹 쪽으로 0.6m 나와도 안 보여야 함 (봇이 딱 그 자리에 서지 않으므로 여유)
          {
            const L0 = Math.hypot(c.p[0] - q[0], c.p[1] - q[1]) || 1;
            const q2 = [q[0] + ((c.p[0] - q[0]) * 0.6) / L0, q[1] + ((c.p[1] - q[1]) * 0.6) / L0];
            if (visibleFrom(map, at, eye, q2)) continue;
          }
          // 옆으로 튀어나오는 길일수록 좋음 (시선과 수직)
          const lx = c.p[0] - q[0];
          const ly = c.p[1] - q[1];
          const L = Math.hypot(lx, ly);
          const sx = (c.p[0] - at[0]) / c.d;
          const sy = (c.p[1] - at[1]) / c.d;
          const lateral = Math.abs((lx * sy - ly * sx) / L);
          const score = lateral - Math.abs(L - 3.5) * 0.08;
          if (!best || score > best.score) best = { hide: q, score, L };
        }
      }
      if (best) break;
    }
    if (best && best.score > 0.45) lanes.push({ hide: best.hide, peek: c.p, dist: c.d, ang: c.ang, score: best.score });
  }
  // 3) 서로 다른 방향의 좋은 모서리 몇 개
  lanes.sort((a, b) => b.score - a.score || a.dist - b.dist);
  const out = [];
  for (const l of lanes) {
    if (out.some((o) => Math.abs(o.ang - l.ang) < sep)) continue;
    out.push(l);
    if (out.length >= count) break;
  }
  return out.map(({ hide, peek, dist }) => ({ hide, peek, dist }));
}

/**
 * 1:1 자리: 정면으로 dist m 쯤, 좌우로 span m 씩 움직여도 계속 보이는 곳.
 * 반환 { bot: [x,y], axis: [ax, ay] } 또는 null
 */
export function autoDuel(map, nav, at, heading, dist, span) {
  const eye = map.floorAt(at[0], at[1]) + EYE;
  let best = null;
  for (const n of navNodes(nav)) {
    const p = nodePos(nav, n);
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (Math.abs(d - dist) > 4) continue;
    const ang = angDiff(bearing(at[0], at[1], p[0], p[1]), heading);
    if (Math.abs(ang) > 12) continue;
    // 시선에 수직인 축
    const ax = (p[1] - at[1]) / d;
    const ay = -(p[0] - at[0]) / d;
    const e1 = [p[0] + ax * span, p[1] + ay * span];
    const e2 = [p[0] - ax * span, p[1] - ay * span];
    if (!map.walkable(e1[0], e1[1]) || !map.walkable(e2[0], e2[1])) continue;
    if (!segmentWalkable(map, e1[0], e1[1], e2[0], e2[1]) || !segmentWalkable(map, e2[0], e2[1], e1[0], e1[1])) continue;
    if (!visibleFrom(map, at, eye, p) || !visibleFrom(map, at, eye, e1) || !visibleFrom(map, at, eye, e2)) continue;
    const score = -Math.abs(d - dist) - Math.abs(ang) * 0.2;
    if (!best || score > best.score) best = { bot: p, axis: [ax, ay], score };
  }
  return best && { bot: best.bot, axis: best.axis };
}
