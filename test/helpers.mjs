// 테스트 공용: 실제 바인드 맵 읽기, 평평한 시험용 맵, 고정 난수.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseGrid, buildMap, K } from '../js/sim/mapgrid.js';
import { BIND } from '../js/sim/bind.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let bindCache = null;
/** 실제 바인드 (maps/bind.grid.gz) */
export function loadBind() {
  if (!bindCache) {
    const bytes = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, BIND.grid)));
    bindCache = buildMap(parseGrid(bytes), BIND);
  }
  return bindCache;
}

/** 새로 읽은 바인드 (캐시가 상태를 가질 때) */
export function freshBind() {
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, BIND.grid)));
  return buildMap(parseGrid(bytes), BIND);
}

/** w×h m 평평한 바닥 + 둘레 벽 (움직임·무기 시험용) */
export function flatMap(w = 60, h = 60, cell = 0.25) {
  const nx = Math.round(w / cell);
  const ny = Math.round(h / cell);
  const N = nx * ny;
  const top = new Float32Array(N);
  const floor = new Float32Array(N);
  const ceil = new Float32Array(N).fill(Infinity);
  const kind = new Uint8Array(N).fill(K.FLOOR);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (i < 4 || j < 4 || i >= nx - 4 || j >= ny - 4) {
        const k = j * nx + i;
        kind[k] = K.WALL;
        top[k] = 8;
      }
    }
  }
  const header = { nx, ny, cell, x0: 0, y0: 0, none: 32767, props: [''], callouts: [{ key: 'flat', label: '시험장', at: [w / 2, h / 2] }], teleporters: [] };
  return buildMap({ header, top, floor, ceil, kind, region: new Uint8Array(N).fill(1), prop: new Uint8Array(N) }, { ...BIND, spawns: { attacker: { at: [w / 2, 8], heading: 0 }, defender: { at: [w / 2, h - 8], heading: 180 } } });
}

export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const near = (a, b, eps) => Math.abs(a - b) <= eps;
