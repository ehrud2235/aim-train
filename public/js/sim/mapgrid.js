// 맵 데이터(사각형들) → 0.25m 격자 높이맵.
// 충돌, 총알 판정, 화면 그리기, 미니맵이 모두 이 격자 하나를 쓴다.

export const CELL = 0.25;
export const K = { WALL: 0, FLOOR: 1, STAIRS: 2, PROP: 3, RAIL: 4, DOOR: 5 };

const STEP_RISE = 0.3;

export function buildMap(def) {
  const [bx0, by0, bx1, by1] = def.bounds;
  const nx = Math.round((bx1 - bx0) / CELL);
  const ny = Math.round((by1 - by0) / CELL);
  const N = nx * ny;
  const wallH = def.wallHeight;
  const top = new Float32Array(N).fill(wallH);
  const floor = new Float32Array(N).fill(wallH);
  const kind = new Uint8Array(N); // WALL
  const region = new Uint8Array(N); // 0 = 없음
  const propId = new Int16Array(N).fill(-1);

  const regionKeys = Object.keys(def.regions);
  const regions = regionKeys.map((key, i) => ({ key, index: i + 1, ...def.regions[key] }));
  const regionIndex = Object.fromEntries(regions.map((r) => [r.key, r.index]));

  /** 사각형 안에 중심이 들어오는 칸마다 fn(idx, cx, cy) */
  function eachCell(r, fn) {
    const [x0, y0, x1, y1] = r;
    const i0 = Math.max(0, Math.ceil((x0 - bx0) / CELL - 0.5 - 1e-6));
    const i1 = Math.min(nx - 1, Math.floor((x1 - bx0) / CELL - 0.5 - 1e-6));
    const j0 = Math.max(0, Math.ceil((y0 - by0) / CELL - 0.5 - 1e-6));
    const j1 = Math.min(ny - 1, Math.floor((y1 - by0) / CELL - 0.5 - 1e-6));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        fn(j * nx + i, bx0 + (i + 0.5) * CELL, by0 + (j + 0.5) * CELL);
      }
    }
  }

  for (const a of def.areas) {
    const h = a.h || 0;
    const reg = regionIndex[a.region] || 0;
    eachCell(a.r, (idx) => {
      top[idx] = h;
      floor[idx] = h;
      kind[idx] = K.FLOOR;
      region[idx] = reg;
    });
  }

  for (const s of def.stairs || []) {
    const [x0, y0, x1, y1] = s.r;
    const rise = s.to - s.from;
    const n = Math.max(1, Math.ceil(Math.abs(rise) / STEP_RISE) - 1); // 계단 칸 수
    eachCell(s.r, (idx, cx, cy) => {
      let f; // 낮은 쪽 0 → 높은 쪽 1
      if (s.dir === 'n') f = (cy - y0) / (y1 - y0);
      else if (s.dir === 's') f = (y1 - cy) / (y1 - y0);
      else if (s.dir === 'e') f = (cx - x0) / (x1 - x0);
      else f = (x1 - cx) / (x1 - x0);
      const k = Math.min(n - 1, Math.floor(f * n));
      const h = s.from + (rise * (k + 1)) / (n + 1);
      top[idx] = h;
      floor[idx] = h;
      kind[idx] = K.STAIRS;
    });
  }

  for (const s of def.solids || []) {
    eachCell(s.r, (idx) => {
      top[idx] = wallH;
      floor[idx] = wallH;
      kind[idx] = K.WALL;
      region[idx] = 0;
    });
  }

  const props = (def.props || []).map((p, i) => ({ ...p, id: i, kind: p.kind || 'crate' }));
  for (const p of props) {
    let base = Infinity;
    eachCell(p.r, (idx) => {
      if (kind[idx] !== K.WALL) base = Math.min(base, floor[idx]);
    });
    if (!Number.isFinite(base)) base = 0;
    p.base = base;
    p.top = base + p.h;
    eachCell(p.r, (idx) => {
      if (kind[idx] === K.WALL) return;
      top[idx] = p.top;
      kind[idx] = K.PROP;
      propId[idx] = p.id;
    });
  }

  for (const r of def.rails || []) {
    eachCell(r.r, (idx) => {
      if (kind[idx] === K.WALL) return;
      top[idx] = floor[idx] + r.h;
      kind[idx] = K.RAIL;
    });
  }

  const doors = (def.doors || []).map((d) => {
    const cells = [];
    eachCell(d.r, (idx) => {
      cells.push(idx);
      top[idx] = wallH;
      floor[idx] = 0;
      kind[idx] = K.DOOR;
    });
    return { ...d, cells, open: false, amount: 0 };
  });

  const overhead = [];
  for (const rf of def.roofs || []) {
    const [x0, y0, x1, y1] = rf.r;
    overhead.push({ x0, y0, x1, y1, z0: rf.y, z1: rf.y + 0.35, type: 'roof' });
  }
  for (const l of def.lintels || []) {
    const [x0, y0, x1, y1] = l.r;
    overhead.push({ x0, y0, x1, y1, z0: l.y0, z1: l.y1, type: 'lintel' });
  }

  const map = {
    def,
    name: def.name,
    cell: CELL,
    x0: bx0,
    y0: by0,
    x1: bx1,
    y1: by1,
    nx,
    ny,
    wallH,
    top,
    floor,
    kind,
    region,
    propId,
    props,
    regions,
    regionIndex,
    doors,
    overhead,
    teleporters: def.teleporters || [],

    idx(x, y) {
      const i = Math.floor((x - bx0) / CELL);
      const j = Math.floor((y - by0) / CELL);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
      return j * nx + i;
    },
    topAt(x, y) {
      const k = this.idx(x, y);
      return k < 0 ? wallH : top[k];
    },
    floorAt(x, y) {
      const k = this.idx(x, y);
      return k < 0 ? wallH : floor[k];
    },
    walkable(x, y) {
      const k = this.idx(x, y);
      return k >= 0 && kind[k] !== K.WALL && kind[k] !== K.DOOR;
    },
    regionAt(x, y) {
      const k = this.idx(x, y);
      if (k < 0) return null;
      const r = region[k];
      return r ? regions[r - 1] : null;
    },
    setDoor(door, open) {
      if (door.open === open) return;
      door.open = open;
      for (const idx of door.cells) {
        top[idx] = open ? 0 : wallH;
      }
    },
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      return raycastMap(this, ox, oy, oz, dx, dy, dz, maxDist);
    },
  };
  return map;
}

/**
 * 총알·시야 판정: 높이맵 격자를 따라가며(DDA) 처음 막히는 곳.
 * 반환 { t, nx, ny, nz } 또는 null (하늘로 빠짐). n 은 맞은 면의 바깥 방향.
 */
export function raycastMap(map, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null;
  // 천장·문틀 상자
  for (const b of map.overhead) {
    const hit = rayBox(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1);
    if (hit && hit.t <= maxDist && (!best || hit.t < best.t)) best = hit;
  }
  const limit = best ? best.t : maxDist;
  const g = gridRay(map, ox, oy, oz, dx, dy, dz, limit);
  return g || best;
}

function gridRay(map, ox, oy, oz, dx, dy, dz, maxDist) {
  const { cell, nx, ny, top, wallH } = map;
  let i = Math.floor((ox - map.x0) / cell);
  let j = Math.floor((oy - map.y0) / cell);
  if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
  const stepI = dx > 0 ? 1 : -1;
  const stepJ = dy > 0 ? 1 : -1;
  const tDeltaI = dx !== 0 ? Math.abs(cell / dx) : Infinity;
  const tDeltaJ = dy !== 0 ? Math.abs(cell / dy) : Infinity;
  const nextX = map.x0 + (i + (dx > 0 ? 1 : 0)) * cell;
  const nextY = map.y0 + (j + (dy > 0 ? 1 : 0)) * cell;
  let tMaxI = dx !== 0 ? (nextX - ox) / dx : Infinity;
  let tMaxJ = dy !== 0 ? (nextY - oy) / dy : Infinity;
  let tEnter = 0;
  let lastAxis = -1;
  // 처음 칸 안(벽 속)에서 시작하면 그 칸은 무시
  let first = true;
  while (tEnter <= maxDist) {
    const T = top[j * nx + i];
    const tExit = Math.min(tMaxI, tMaxJ, maxDist);
    const zEnter = oz + dz * tEnter;
    const zExit = oz + dz * tExit;
    if (!first || zEnter >= T) {
      if (zEnter < T && !first) {
        // 옆면에 맞음
        if (lastAxis === 0) return { t: tEnter, nx: -stepI, ny: 0, nz: 0 };
        return { t: tEnter, nx: 0, ny: -stepJ, nz: 0 };
      }
      if (zExit < T && dz < 0) {
        const t = (T - oz) / dz;
        return { t: Math.max(t, tEnter), nx: 0, ny: 0, nz: 1 };
      }
    }
    first = false;
    if (dz > 0 && zEnter > wallH + 0.01) return null; // 벽보다 높이 올라감 → 하늘
    if (tMaxI < tMaxJ) {
      tEnter = tMaxI;
      tMaxI += tDeltaI;
      i += stepI;
      lastAxis = 0;
    } else {
      tEnter = tMaxJ;
      tMaxJ += tDeltaJ;
      j += stepJ;
      lastAxis = 1;
    }
    if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
  }
  return null;
}

/** 광선 vs 축정렬 상자 (밖에서 들어올 때만). 반환 { t, nx, ny, nz } */
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [x0, y0, z0];
  const hi = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let t1 = (lo[a] - o[a]) / d[a];
    let t2 = (hi[a] - o[a]) / d[a];
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = a;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0 || tmin < 0) return null;
  const n = [0, 0, 0];
  if (axis >= 0) n[axis] = sign;
  return { t: tmin, nx: n[0], ny: n[1], nz: n[2] };
}
