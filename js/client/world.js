// 격자 맵 → Three.js 메시. 그래픽은 최소한: 면 방향 음영 + 구역별 색 + 1m 타일 무늬(속도·거리 감각용).
import * as THREE from 'three';
import { K } from '../sim/mapgrid.js';

// 바인드 느낌(모로코풍 사암·테라코타·청록 타일)의 구역별 색 [바닥, 벽]
const REGION_COLORS = {
  atkSpawn: ['#b9a07a', '#c8a274'],
  aLobby: ['#c2a47c', '#cf9f6e'],
  aBath: ['#86aeb0', '#d9d4c6'],
  aShort: ['#bfa27a', '#c79363'],
  aTele: ['#6f7f99', '#8f97aa'],
  aLamps: ['#c4a57c', '#b97a4d'],
  uHall: ['#a99272', '#b98a5c'],
  aSite: ['#cdb489', '#d0a676'],
  aHeaven: ['#a8865e', '#c0956a'],
  heavenHall: ['#a8865e', '#c0956a'],
  defSpawn: ['#b6a789', '#bfae8f'],
  bShort: ['#b9a37f', '#c9a57a'],
  bTeleExit: ['#6f7f99', '#8f97aa'],
  aTeleExit: ['#6f7f99', '#8f97aa'],
  hookah: ['#8d5c4c', '#c98f6a'],
  bLong: ['#c8b088', '#d3ad7f'],
  bTele: ['#6f7f99', '#8f97aa'],
  garden: ['#9cae80', '#c8a77c'],
  bSite: ['#ccb58e', '#d6b183'],
  elbow: ['#bba27e', '#c99f72'],
};
const PROP_COLORS = {
  crate: '#8a6a45',
  truck: '#4d7391',
  elevator: '#9c8f7c',
  pillar: '#dccbaa',
  planter: '#6f8f4f',
  sofa: '#7d3b3b',
};
const DEFAULT_FLOOR = '#b8a07c';
const DEFAULT_WALL = '#c39a6c';
const RAIL = '#6b5a45';
const ROOF = '#9b8466';
const LINTEL = '#b98d62';

function col(hex, mul = 1) {
  const c = new THREE.Color(hex);
  return [c.r * mul, c.g * mul, c.b * mul];
}

/** 타일 무늬 텍스처 (1칸 = 1m) */
function makeTileTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  // 잔잔한 얼룩
  const img = g.getImageData(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 236 + rnd() * 19;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, S - 3, S - 3);
  g.strokeStyle = 'rgba(0,0,0,0.06)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S / 2, 0);
  g.lineTo(S / 2, S);
  g.moveTo(0, S / 2);
  g.lineTo(S, S / 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
  }
  /** 사각형 하나 (맵 좌표 4점, 반시계 = 바깥쪽), 점마다 색 */
  quad(p, n, colors, uvs) {
    const order = [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      const [x, y, z] = p[k];
      this.pos.push(x, z, -y);
      this.nor.push(n[0], n[2], -n[1]);
      const c = colors[k] || colors[0];
      this.col.push(c[0], c[1], c[2]);
      this.uv.push(uvs[k][0], uvs[k][1]);
    }
  }
  /** 상자 (맵 좌표) */
  box(x0, y0, z0, x1, y1, z1, color, opts = {}) {
    const c = color;
    const dark = [c[0] * 0.82, c[1] * 0.82, c[2] * 0.82];
    const bot = opts.shadeBottom ? dark : c;
    // 위
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [c], uvRect(x0, y0, x1, y1));
    // 아래
    this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], [0, 0, -1], [dark], uvRect(x0, y0, x1, y1));
    // 남(-y)
    this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [bot, bot, c, c], uvWall(x0, x1, z0, z1));
    // 북(+y)
    this.quad([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [0, 1, 0], [bot, bot, c, c], uvWall(x1, x0, z0, z1));
    // 서(-x)
    this.quad([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0], [bot, bot, c, c], uvWall(y1, y0, z0, z1));
    // 동(+x)
    this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], [bot, bot, c, c], uvWall(y0, y1, z0, z1));
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

function uvRect(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
function uvWall(a0, a1, z0, z1) {
  return [[a0, z0], [a1, z0], [a1, z1], [a0, z1]];
}

/** 칸 색 정보 */
function cellStyle(map, idx) {
  const k = map.kind[idx];
  const reg = map.region[idx];
  const rk = reg ? map.regions[reg - 1].key : null;
  const rc = (rk && REGION_COLORS[rk]) || [DEFAULT_FLOOR, DEFAULT_WALL];
  if (k === K.PROP) {
    const p = map.props[map.propId[idx]];
    return { key: `p${p.id}`, top: PROP_COLORS[p.kind] || PROP_COLORS.crate, side: PROP_COLORS[p.kind] || PROP_COLORS.crate };
  }
  if (k === K.RAIL) return { key: 'rail', top: RAIL, side: RAIL };
  if (k === K.STAIRS) return { key: `s${rk}`, top: rc[0], side: rc[1], mul: 0.92 };
  if (k === K.DOOR) return { key: 'door', top: DEFAULT_FLOOR, side: DEFAULT_WALL };
  if (k === K.WALL) return { key: 'wall', top: DEFAULT_WALL, side: DEFAULT_WALL };
  return { key: `f${rk}`, top: rc[0], side: rc[1] };
}

function underRoof(map, x, y) {
  for (const b of map.overhead) {
    if (b.type === 'roof' && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
  }
  return false;
}

export function buildWorld(map, scene) {
  const { nx, ny, cell, x0, y0, kind } = map;
  // 문 칸은 바닥으로 그리고(문은 따로 움직이는 메시), 나머지는 격자 높이 그대로
  const top = Float32Array.from(map.top);
  for (const d of map.doors) for (const k of d.cells) top[k] = 0;
  const gb = new GeoBuilder();
  const styleCache = new Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) styleCache[i] = cellStyle(map, i);

  // ── 윗면: 같은 높이·같은 색끼리 큰 사각형으로 합침 ──
  const done = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (done[k] || kind[k] === K.WALL) continue;
      const t = top[k];
      const sk = styleCache[k].key;
      const same = (a) => !done[a] && kind[a] !== K.WALL && top[a] === t && styleCache[a].key === sk;
      let w = 1;
      while (i + w < nx && same(k + w)) w++;
      let h = 1;
      outer: while (j + h < ny) {
        for (let a = 0; a < w; a++) if (!same((j + h) * nx + i + a)) break outer;
        h++;
      }
      for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) done[(j + b) * nx + i + a] = 1;
      const ax = x0 + i * cell;
      const ay = y0 + j * cell;
      const bx = ax + w * cell;
      const by = ay + h * cell;
      const st = styleCache[k];
      const mul = (st.mul || 1) * (underRoof(map, (ax + bx) / 2, (ay + by) / 2) ? 0.78 : 1);
      const c = col(st.top, mul);
      gb.quad([[ax, ay, t], [bx, ay, t], [bx, by, t], [ax, by, t]], [0, 0, 1], [c], uvRect(ax, ay, bx, by));
    }
  }

  // ── 옆면: 높은 칸 → 낮은 칸 사이 벽면. 같은 높이 쌍끼리 줄로 합침 ──
  const sideColor = (hi, lo) => {
    // 벽면 색: 벽이면 낮은 쪽(걸어다니는 쪽) 구역의 벽 색, 소품이면 소품 색
    const sh = styleCache[hi];
    if (kind[hi] === K.WALL) return styleCache[lo].side;
    if (kind[hi] === K.FLOOR || kind[hi] === K.STAIRS) return styleCache[hi].side;
    return sh.side;
  };
  // x 방향 이웃 (i | i+1): 면은 x = 경계
  for (let i = 0; i < nx - 1; i++) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const xb = x0 + (i + 1) * cell;
      const ya = y0 + run.j0 * cell;
      const yb = y0 + (run.j1 + 1) * cell;
      const c = col(run.color);
      const cb = col(run.color, run.ao);
      if (run.dir > 0) {
        // 왼쪽(i)이 높음 → 면이 +x 를 봄
        gb.quad([[xb, ya, run.lo], [xb, yb, run.lo], [xb, yb, run.hi], [xb, ya, run.hi]], [1, 0, 0], [cb, cb, c, c], uvWall(ya, yb, run.lo, run.hi));
      } else {
        gb.quad([[xb, yb, run.lo], [xb, ya, run.lo], [xb, ya, run.hi], [xb, yb, run.hi]], [-1, 0, 0], [cb, cb, c, c], uvWall(yb, ya, run.lo, run.hi));
      }
      run = null;
    };
    for (let j = 0; j < ny; j++) {
      const a = j * nx + i;
      const b = a + 1;
      const ta = top[a];
      const tb = top[b];
      let cur = null;
      if (ta !== tb) {
        const hiIdx = ta > tb ? a : b;
        const loIdx = ta > tb ? b : a;
        if (!(kind[loIdx] === K.WALL && kind[hiIdx] === K.WALL)) {
          const lowWall = kind[loIdx] === K.WALL;
          if (!lowWall) {
            cur = { dir: ta > tb ? 1 : -1, lo: Math.min(ta, tb), hi: Math.max(ta, tb), color: sideColor(hiIdx, loIdx), ao: kind[hiIdx] === K.WALL ? 0.72 : 0.85 };
          }
        }
      }
      if (cur && run && run.dir === cur.dir && run.lo === cur.lo && run.hi === cur.hi && run.color === cur.color && run.j1 === j - 1) {
        run.j1 = j;
      } else {
        flush();
        if (cur) run = { ...cur, j0: j, j1: j };
      }
    }
    flush();
  }
  // y 방향 이웃 (j | j+1)
  for (let j = 0; j < ny - 1; j++) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const yb = y0 + (j + 1) * cell;
      const xa = x0 + run.i0 * cell;
      const xb = x0 + (run.i1 + 1) * cell;
      const c = col(run.color);
      const cb = col(run.color, run.ao);
      if (run.dir > 0) {
        // 아래(j)가 높음 → 면이 +y 를 봄
        gb.quad([[xb, yb, run.lo], [xa, yb, run.lo], [xa, yb, run.hi], [xb, yb, run.hi]], [0, 1, 0], [cb, cb, c, c], uvWall(xb, xa, run.lo, run.hi));
      } else {
        gb.quad([[xa, yb, run.lo], [xb, yb, run.lo], [xb, yb, run.hi], [xa, yb, run.hi]], [0, -1, 0], [cb, cb, c, c], uvWall(xa, xb, run.lo, run.hi));
      }
      run = null;
    };
    for (let i = 0; i < nx; i++) {
      const a = j * nx + i;
      const b = a + nx;
      const ta = top[a];
      const tb = top[b];
      let cur = null;
      if (ta !== tb) {
        const hiIdx = ta > tb ? a : b;
        const loIdx = ta > tb ? b : a;
        if (kind[loIdx] !== K.WALL) {
          cur = { dir: ta > tb ? 1 : -1, lo: Math.min(ta, tb), hi: Math.max(ta, tb), color: sideColor(hiIdx, loIdx), ao: kind[hiIdx] === K.WALL ? 0.72 : 0.85 };
        }
      }
      if (cur && run && run.dir === cur.dir && run.lo === cur.lo && run.hi === cur.hi && run.color === cur.color && run.i1 === i - 1) {
        run.i1 = i;
      } else {
        flush();
        if (cur) run = { ...cur, i0: i, i1: i };
      }
    }
    flush();
  }

  // ── 천장·문틀 ──
  for (const b of map.overhead) {
    gb.box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, col(b.type === 'roof' ? ROOF : LINTEL), {});
  }

  const tex = makeTileTexture();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  const mesh = new THREE.Mesh(gb.build(), mat);
  scene.add(mesh);

  // ── 문 (텔레포터 출구 방) ──
  const doorMeshes = map.doors.map((d) => {
    const [ax, ay, bx, by] = d.r;
    const g = new GeoBuilder();
    g.box(ax, ay, 0, bx, by, 3.2, col('#596273'), { shadeBottom: true });
    const m = new THREE.Mesh(g.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    scene.add(m);
    return { door: d, mesh: m };
  });

  // ── 텔레포터 ──
  const teleMeshes = map.teleporters.map((t) => {
    const [ax, ay, bx, by] = t.pad;
    const z = map.floorAt((ax + bx) / 2, (ay + by) / 2);
    const grp = new THREE.Group();
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(bx - ax, 0.06, by - ay),
      new THREE.MeshBasicMaterial({ color: 0x39d7ff }),
    );
    pad.position.set((ax + bx) / 2, z + 0.03, -(ay + by) / 2);
    grp.add(pad);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(bx - ax, 2.6, by - ay),
      new THREE.MeshBasicMaterial({ color: 0x39d7ff, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    glow.position.set((ax + bx) / 2, z + 1.3, -(ay + by) / 2);
    grp.add(glow);
    scene.add(grp);
    return { tele: t, glow };
  });

  // 하늘·빛
  scene.background = new THREE.Color('#bcd3e6');
  const hemi = new THREE.HemisphereLight('#fff7ea', '#7d6d5c', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1dc', 1.6);
  sun.position.set(-40, 80, 25);
  scene.add(sun);

  return {
    mesh,
    update(time) {
      for (const dm of doorMeshes) {
        const target = dm.door.open ? 1 : 0;
        dm.door.amount += (target - dm.door.amount) * 0.25;
        dm.mesh.position.y = dm.door.amount * 3.1; // 위로 올라가며 열림
        dm.mesh.visible = dm.door.amount < 0.98;
      }
      for (const tm of teleMeshes) tm.glow.material.opacity = 0.14 + 0.08 * Math.sin(time * 4);
    },
  };
}
