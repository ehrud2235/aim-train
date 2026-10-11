// 실제 바인드 격자(maps/bind.grid.gz, tools/build-bind.mjs 가 만듦) → 맵 객체.
// 충돌, 총알 판정, 화면 그리기, 미니맵이 모두 이 격자 하나를 쓴다.
//  top  : 그 칸에서 아래부터 막혀 있는 높이(m) — 바닥 윗면, 상자 윗면, 벽 꼭대기
//  ceil : 그 칸에서 위쪽이 막히기 시작하는 높이(m) — 창문·문 윗벽 (없으면 Infinity)
//  floor: 그 칸의 바닥 높이 (상자 밑 바닥 포함)

export const K = { WALL: 0, FLOOR: 1, STAIRS: 2, PROP: 3, RAIL: 4, DOOR: 5 };

/** 압축을 푼 격자 바이트 → 배열들 */
export function parseGrid(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'VAIM') throw new Error('맵 파일 형식이 아님');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hl = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
  let off = 8 + hl;
  if (off % 2) off++;
  const N = header.nx * header.ny;
  const i16 = (o) => {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const v = dv.getInt16(o + k * 2, true);
      out[k] = v === header.none ? Infinity : v / 100;
    }
    return out;
  };
  const top = i16(off);
  off += N * 2;
  const floor = i16(off);
  off += N * 2;
  const ceil = i16(off);
  off += N * 2;
  const kind = u8.slice(off, off + N);
  off += N;
  const region = u8.slice(off, off + N);
  off += N;
  const prop = u8.slice(off, off + N);
  return { header, top, floor, ceil, kind, region, prop };
}

export function buildMap(grid, def) {
  const { header, top, floor, ceil, kind, region, prop } = grid;
  const { nx, ny, cell, x0, y0 } = header;
  const N = nx * ny;
  let maxTop = -Infinity;
  for (let k = 0; k < N; k++) if (top[k] > maxTop && Number.isFinite(top[k])) maxTop = top[k];
  const regions = header.callouts.map((c, i) => ({ ...c, index: i + 1 }));
  const regionIndex = Object.fromEntries(regions.map((r) => [r.key, r.index]));

  const map = {
    def,
    name: header.map,
    cell,
    x0,
    y0,
    x1: x0 + nx * cell,
    y1: y0 + ny * cell,
    nx,
    ny,
    wallH: maxTop,
    top,
    floor,
    ceil,
    kind,
    region,
    prop,
    propNames: header.props,
    regions,
    regionIndex,
    doors: [],
    overhead: [],
    teleporters: header.teleporters,

    idx(x, y) {
      const i = Math.floor((x - x0) / cell);
      const j = Math.floor((y - y0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
      return j * nx + i;
    },
    topAt(x, y) {
      const k = this.idx(x, y);
      return k < 0 ? maxTop : top[k];
    },
    floorAt(x, y) {
      const k = this.idx(x, y);
      if (k < 0) return maxTop;
      return kind[k] === K.FLOOR || kind[k] === K.STAIRS ? top[k] : Number.isFinite(floor[k]) ? floor[k] : top[k];
    },
    ceilAt(x, y) {
      const k = this.idx(x, y);
      return k < 0 ? -Infinity : ceil[k];
    },
    walkable(x, y) {
      const k = this.idx(x, y);
      return k >= 0 && (kind[k] === K.FLOOR || kind[k] === K.STAIRS);
    },
    regionAt(x, y) {
      const k = this.idx(x, y);
      if (k < 0) return null;
      const r = region[k];
      return r ? regions[r - 1] : null;
    },
    setDoor() {},
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      return raycastMap(this, ox, oy, oz, dx, dy, dz, maxDist);
    },
  };
  return map;
}

/**
 * 총알·시야 판정: 높이맵 격자를 따라가며(DDA) 처음 막히는 곳.
 * 칸마다 [top, ceil) 사이만 비어 있다. 반환 { t, nx, ny, nz } 또는 null (하늘로 빠짐).
 */
export function raycastMap(map, ox, oy, oz, dx, dy, dz, maxDist) {
  const { cell, nx, ny, top, ceil, wallH } = map;
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
  let first = true;
  while (tEnter <= maxDist) {
    const k = j * nx + i;
    const T = top[k];
    const C = ceil[k];
    const tExit = Math.min(tMaxI, tMaxJ, maxDist);
    const zEnter = oz + dz * tEnter;
    const zExit = oz + dz * tExit;
    if (!first && (zEnter < T || zEnter > C)) {
      // 옆면에 맞음 (아래 벽이든 위 벽이든)
      if (lastAxis === 0) return { t: tEnter, nx: -stepI, ny: 0, nz: 0 };
      return { t: tEnter, nx: 0, ny: -stepJ, nz: 0 };
    }
    if (!first || (zEnter >= T && zEnter <= C)) {
      if (dz < 0 && zExit < T) return { t: Math.max((T - oz) / dz, tEnter), nx: 0, ny: 0, nz: 1 };
      if (dz > 0 && zExit > C) return { t: Math.max((C - oz) / dz, tEnter), nx: 0, ny: 0, nz: -1 };
    }
    first = false;
    if (dz >= 0 && zEnter > wallH + 0.01) return null; // 모든 벽보다 높이 → 하늘
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
