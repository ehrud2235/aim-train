// 실제 바인드 격자 → Three.js 메시.
// 바닥은 경사·계단을 부드럽게(모서리 높이 평균), 높이가 크게 다른 곳(벽·상자·낭떠러지)은 수직면.
// 색은 바인드 분위기(모로코풍 사암·테라코타·청록 타일·나무)로 구역마다 다르게, 타일 무늬로 거리·속도 감각.
import * as THREE from 'three';
import { K } from '../sim/mapgrid.js';

const SMOOTH = 0.36; // 이 이하 높이 차는 이어진 바닥(경사·계단)으로 본다

// 구역별 색 [바닥, 벽]
const REGION_COLORS = {
  atkSpawn: ['#c9b48f', '#d2b28a'],
  atkCave: ['#bfa784', '#c79c6c'],
  aLobby: ['#c9b28c', '#d6a676'],
  aLink: ['#c3ab86', '#cf9f70'],
  aShort: ['#c4ab84', '#cb9466'],
  aCubby: ['#c4ab84', '#cb9466'],
  aTele: ['#c4ab84', '#cb9466'],
  aLamps: ['#c6ad86', '#c28a5d'],
  aSite: ['#d3bd95', '#dcb487'],
  aTower: ['#a98b66', '#c99b6e'],
  aBath: ['#8fb7b6', '#e2ddcf'],
  aExit: ['#c9b28c', '#d6a676'],
  defSpawn: ['#c3b392', '#cdb894'],
  bHall: ['#c6b08a', '#d4ab7c'],
  bSite: ['#cdb68e', '#d8b083'],
  bElbow: ['#c2aa84', '#cfa274'],
  bGarden: ['#a8b48a', '#cfa97e'],
  bTele: ['#cbb48c', '#d6ad7f'],
  bLong: ['#cbb48c', '#d6ad7f'],
  bFountain: ['#b7b597', '#d2ab7e'],
  bWindow: ['#9a5a48', '#d19970'],
  bShort: ['#c3ab86', '#cfa274'],
  bExit: ['#a8604c', '#d19970'],
  bLink: ['#c3ab86', '#cf9f70'],
};
const PROP_COLORS = {
  crate: '#8f6a43',
  box: '#9a7550',
  metal: '#6f7b86',
  barrel: '#566b7a',
  container: '#3f6f8a',
  vehicle: '#4b7a96',
  bath: '#d9d2c2',
};
const DEFAULT = ['#c6ad86', '#cfa274'];
const RAIL = '#b9895c';
const LINTEL = '#c49668';

function rgb(hex, mul = 1) {
  const c = new THREE.Color(hex);
  return [c.r * mul, c.g * mul, c.b * mul];
}

/** 캔버스로 그린 무늬 (타일·돌·나무) — 흰 바탕이라 정점 색이 그대로 입혀진다 */
function makeTexture(kind) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  let seed = kind === 'floor' ? 11 : kind === 'wall' ? 23 : 37;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 232 + rnd() * 23;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  if (kind === 'floor') {
    // 돌판: 1m 격자 + 반쯤 엇갈린 줄
    g.strokeStyle = 'rgba(60,40,20,0.22)';
    g.lineWidth = 3;
    for (let r = 0; r < 4; r++) {
      const y = (r * S) / 4;
      g.beginPath();
      g.moveTo(0, y + 1.5);
      g.lineTo(S, y + 1.5);
      g.stroke();
      const off = r % 2 ? S / 4 : 0;
      for (let c = 0; c < 2; c++) {
        const x = off + (c * S) / 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + S / 4);
        g.stroke();
      }
    }
  } else if (kind === 'wall') {
    // 회벽 + 큰 블록 줄눈
    g.strokeStyle = 'rgba(70,40,20,0.13)';
    g.lineWidth = 2;
    for (let r = 0; r < 2; r++) {
      const y = (r * S) / 2;
      g.beginPath();
      g.moveTo(0, y + 1);
      g.lineTo(S, y + 1);
      g.stroke();
      const x = r % 2 ? S / 2 : 0;
      g.beginPath();
      g.moveTo(x + 1, y);
      g.lineTo(x + 1, y + S / 2);
      g.stroke();
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(90,60,30,${0.03 + rnd() * 0.05})`;
      g.beginPath();
      g.arc(rnd() * S, rnd() * S, 4 + rnd() * 14, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // 나무판
    g.strokeStyle = 'rgba(50,30,10,0.25)';
    g.lineWidth = 2;
    for (let r = 0; r < 6; r++) {
      const y = (r * S) / 6;
      g.beginPath();
      g.moveTo(0, y + 1);
      g.lineTo(S, y + 1);
      g.stroke();
    }
    g.strokeRect(2, 2, S - 4, S - 4);
  }
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
  /** 삼각형 (맵 좌표 x, y, z(높이)) */
  tri(a, b, c, n, ca, cb, cc, ua, ub, uc) {
    for (const [p, col, uv] of [[a, ca, ua], [b, cb, ub], [c, cc, uc]]) {
      this.pos.push(p[0], p[2], -p[1]);
      this.nor.push(n[0], n[2], -n[1]);
      this.col.push(col[0], col[1], col[2]);
      this.uv.push(uv[0], uv[1]);
    }
  }
  /** 사각형 (반시계 = 바깥) */
  quad(p, n, colors, uvs) {
    const c = (i) => colors[i] || colors[0];
    this.tri(p[0], p[1], p[2], n, c(0), c(1), c(2), uvs[0], uvs[1], uvs[2]);
    this.tri(p[0], p[2], p[3], n, c(0), c(2), c(3), uvs[0], uvs[2], uvs[3]);
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

export function buildWorld(map, scene, opts = {}) {
  const { nx, ny, cell, x0, y0, top, ceil, kind, region, prop } = map;
  const N = nx * ny;
  const regionKey = (k) => (region[k] ? map.regions[region[k] - 1].key : null);
  const isSolidWall = (k) => kind[k] === K.WALL;
  const isGround = (k) => kind[k] === K.FLOOR || kind[k] === K.STAIRS;

  // ── 칸마다 네 모서리 높이 (이어진 바닥끼리만 평균) ──
  // corner(i,j) 의 칸 k 기준 값: k 와 높이가 비슷한 이웃 바닥 칸들의 평균
  const cornerH = new Float32Array(N * 4); // 순서: (i,j) (i+1,j) (i+1,j+1) (i,j+1)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (kind[k] === K.WALL) continue;
      const t = top[k];
      if (!isGround(k)) {
        cornerH[k * 4] = cornerH[k * 4 + 1] = cornerH[k * 4 + 2] = cornerH[k * 4 + 3] = t;
        continue;
      }
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let c = 0; c < 4; c++) {
        const [ci, cj] = corners[c];
        let sum = 0;
        let n = 0;
        for (const [di, dj] of [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]]) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
          const m = b * nx + a;
          if (!isGround(m) || Math.abs(top[m] - t) > SMOOTH) continue;
          sum += top[m];
          n++;
        }
        cornerH[k * 4 + c] = n ? sum / n : t;
      }
    }
  }

  const floorG = new GeoBuilder();
  const wallG = new GeoBuilder();
  const propG = new GeoBuilder();

  const floorColor = (k) => {
    if (kind[k] === K.PROP) return rgb(PROP_COLORS[map.propNames[prop[k]]] || PROP_COLORS.crate, 1.05);
    if (kind[k] === K.RAIL) return rgb(RAIL);
    const rc = REGION_COLORS[regionKey(k)] || DEFAULT;
    return rgb(rc[0]);
  };
  const sideColor = (hiK, loK) => {
    if (kind[hiK] === K.PROP) return PROP_COLORS[map.propNames[prop[hiK]]] || PROP_COLORS.crate;
    if (kind[hiK] === K.RAIL) return RAIL;
    const rk = regionKey(isSolidWall(hiK) ? loK : hiK);
    return (REGION_COLORS[rk] || DEFAULT)[1];
  };
  const builderFor = (k) => (kind[k] === K.PROP ? propG : kind[k] === K.FLOOR || kind[k] === K.STAIRS ? floorG : wallG);

  // ── 윗면 ──
  const flat = (k) => {
    const b = k * 4;
    return cornerH[b] === cornerH[b + 1] && cornerH[b] === cornerH[b + 2] && cornerH[b] === cornerH[b + 3] && cornerH[b] === top[k];
  };
  const styleKey = (k) => `${kind[k]}|${region[k]}|${prop[k]}`;
  const done = new Uint8Array(N);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (done[k] || kind[k] === K.WALL) continue;
      const ax = x0 + i * cell;
      const ay = y0 + j * cell;
      const col = floorColor(k);
      const gb = builderFor(k);
      if (flat(k)) {
        const t = top[k];
        const sk = styleKey(k);
        const same = (a) => !done[a] && kind[a] !== K.WALL && top[a] === t && flat(a) && styleKey(a) === sk;
        let w = 1;
        while (i + w < nx && same(k + w)) w++;
        let h = 1;
        outer: while (j + h < ny) {
          for (let a = 0; a < w; a++) if (!same((j + h) * nx + i + a)) break outer;
          h++;
        }
        for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) done[(j + b) * nx + i + a] = 1;
        const bx = ax + w * cell;
        const by = ay + h * cell;
        gb.quad([[ax, ay, t], [bx, ay, t], [bx, by, t], [ax, by, t]], [0, 0, 1], [col], [[ax, ay], [bx, ay], [bx, by], [ax, by]]);
      } else {
        done[k] = 1;
        const b = k * 4;
        const bx = ax + cell;
        const by = ay + cell;
        const p = [[ax, ay, cornerH[b]], [bx, ay, cornerH[b + 1]], [bx, by, cornerH[b + 2]], [ax, by, cornerH[b + 3]]];
        // 경사면 법선 (대략)
        const sx = (p[1][2] + p[2][2] - p[0][2] - p[3][2]) / (2 * cell);
        const sy = (p[3][2] + p[2][2] - p[0][2] - p[1][2]) / (2 * cell);
        const L = Math.hypot(sx, sy, 1);
        const n = [-sx / L, -sy / L, 1 / L];
        gb.quad(p, n, [col], [[ax, ay], [bx, ay], [bx, by], [ax, by]]);
      }
    }
  }

  // ── 옆면: 이웃 칸과 높이가 다른 경계마다 수직면 (모서리 높이로 정확히 이음) ──
  const pushSide = (gb, p0, p1, lo0, lo1, hi0, hi1, n, color, ao) => {
    if (hi0 - lo0 < 0.004 && hi1 - lo1 < 0.004) return;
    const c = rgb(color);
    const cb = rgb(color, ao);
    const along0 = n[0] !== 0 ? p0[1] : p0[0];
    const along1 = n[0] !== 0 ? p1[1] : p1[0];
    gb.quad(
      [[p0[0], p0[1], lo0], [p1[0], p1[1], lo1], [p1[0], p1[1], hi1], [p0[0], p0[1], hi0]],
      n,
      [cb, cb, c, c],
      [[along0, lo0], [along1, lo1], [along1, hi1], [along0, hi0]],
    );
  };
  // x 방향 경계
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      if (kind[a] === K.WALL && kind[b] === K.WALL) continue;
      const xb = x0 + (i + 1) * cell;
      const ya = y0 + j * cell;
      const yb = ya + cell;
      // a 의 +x 경계 높이 (ya→yb), b 의 -x 경계 높이 (ya→yb)
      const ha = kind[a] === K.WALL ? [top[a], top[a]] : [cornerH[a * 4 + 1], cornerH[a * 4 + 2]];
      const hb = kind[b] === K.WALL ? [top[b], top[b]] : [cornerH[b * 4], cornerH[b * 4 + 3]];
      if (ha[0] + ha[1] > hb[0] + hb[1]) {
        // a 가 높음 → 면이 +x 를 봄
        const ao = kind[a] === K.WALL ? 0.7 : 0.82;
        pushSide(kind[a] === K.WALL ? wallG : builderFor(a), [xb, ya], [xb, yb], hb[0], hb[1], ha[0], ha[1], [1, 0, 0], sideColor(a, b), ao);
      } else if (hb[0] + hb[1] > ha[0] + ha[1]) {
        const ao = kind[b] === K.WALL ? 0.7 : 0.82;
        pushSide(kind[b] === K.WALL ? wallG : builderFor(b), [xb, yb], [xb, ya], ha[1], ha[0], hb[1], hb[0], [-1, 0, 0], sideColor(b, a), ao);
      }
    }
  }
  // y 방향 경계
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * nx + i;
      const b = a + nx;
      if (kind[a] === K.WALL && kind[b] === K.WALL) continue;
      const yb = y0 + (j + 1) * cell;
      const xa = x0 + i * cell;
      const xb = xa + cell;
      const ha = kind[a] === K.WALL ? [top[a], top[a]] : [cornerH[a * 4 + 3], cornerH[a * 4 + 2]]; // a 의 +y 경계 (xa→xb)
      const hb = kind[b] === K.WALL ? [top[b], top[b]] : [cornerH[b * 4], cornerH[b * 4 + 1]]; // b 의 -y 경계 (xa→xb)
      if (ha[0] + ha[1] > hb[0] + hb[1]) {
        const ao = kind[a] === K.WALL ? 0.7 : 0.82;
        pushSide(kind[a] === K.WALL ? wallG : builderFor(a), [xb, yb], [xa, yb], hb[1], hb[0], ha[1], ha[0], [0, 1, 0], sideColor(a, b), ao);
      } else if (hb[0] + hb[1] > ha[0] + ha[1]) {
        const ao = kind[b] === K.WALL ? 0.7 : 0.82;
        pushSide(kind[b] === K.WALL ? wallG : builderFor(b), [xa, yb], [xb, yb], ha[0], ha[1], hb[0], hb[1], [0, -1, 0], sideColor(b, a), ao);
      }
    }
  }

  // ── 창문·문 윗벽 (ceil) ──
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const C = ceil[k];
      if (!Number.isFinite(C)) continue;
      const ax = x0 + i * cell;
      const ay = y0 + j * cell;
      const bx = ax + cell;
      const by = ay + cell;
      const up = C + 3;
      const c = rgb(LINTEL, 0.85);
      wallG.quad([[ax, by, C], [bx, by, C], [bx, ay, C], [ax, ay, C]], [0, 0, -1], [c], [[ax, by], [bx, by], [bx, ay], [ax, ay]]);
      const nb = [[i - 1, j, [-1, 0, 0], [ax, by], [ax, ay]], [i + 1, j, [1, 0, 0], [bx, ay], [bx, by]], [i, j - 1, [0, -1, 0], [ax, ay], [bx, ay]], [i, j + 1, [0, 1, 0], [bx, by], [ax, by]]];
      for (const [a, b, n, p0, p1] of nb) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const m = b * nx + a;
        if (kind[m] === K.WALL || Number.isFinite(ceil[m])) continue;
        pushSide(wallG, p0, p1, C, C, up, up, n, LINTEL, 0.8);
      }
    }
  }

  const mkMesh = (gb, texKind) => {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeTexture(texKind) });
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const floorMesh = mkMesh(floorG, 'floor');
  const wallMesh = mkMesh(wallG, 'wall');
  const propMesh = mkMesh(propG, 'wood');

  // ── 텔레포터 ──
  const teleMeshes = map.teleporters.map((t) => {
    const [ax, ay, bx, by] = t.pad;
    const z = map.floorAt((ax + bx) / 2, (ay + by) / 2);
    const grp = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.BoxGeometry(bx - ax, 0.05, by - ay), new THREE.MeshBasicMaterial({ color: 0x4fe3ff }));
    pad.position.set((ax + bx) / 2, z + 0.03, -(ay + by) / 2);
    grp.add(pad);
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(bx - ax, 2.8, by - ay),
      new THREE.MeshBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    glow.position.set((ax + bx) / 2, z + 1.4, -(ay + by) / 2);
    grp.add(glow);
    scene.add(grp);
    return { tele: t, glow };
  });

  // ── 하늘·빛 (낮, 따뜻한 햇빛) ──
  scene.background = new THREE.Color('#a9c8e6');
  scene.fog = new THREE.Fog('#c9d8e6', 120, 260);
  const hemi = new THREE.HemisphereLight('#fff4e2', '#8a7660', 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d6', 1.75);
  const cxm = (map.x0 + map.x1) / 2;
  const cym = (map.y0 + map.y1) / 2;
  sun.position.set(cxm - 60, 110, -(cym - 45));
  sun.target.position.set(cxm, 0, -cym);
  scene.add(sun.target);
  if (opts.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(opts.shadows === 'high' ? 4096 : 2048, opts.shadows === 'high' ? 4096 : 2048);
    const r = 112;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 320 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun);

  return {
    meshes: [floorMesh, wallMesh, propMesh],
    sun,
    update(time) {
      for (const tm of teleMeshes) tm.glow.material.opacity = 0.15 + 0.08 * Math.sin(time * 4);
    },
  };
}
