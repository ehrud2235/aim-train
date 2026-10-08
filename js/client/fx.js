// 총알 자국, 예광탄, 맞은 곳 먼지. 개수 제한이 있어서 오래 쏴도 느려지지 않는다.
import * as THREE from 'three';

const MAX_DECALS = 320;
const MAX_TRACERS = 24;
const MAX_PUFFS = 24;

export function createFx(scene) {
  // ── 탄흔: 인스턴스 하나로 ──
  const decalGeo = new THREE.PlaneGeometry(0.07, 0.07);
  const decalMat = new THREE.MeshBasicMaterial({ color: 0x1c1712, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
  decals.count = 0;
  decals.frustumCulled = false;
  scene.add(decals);
  let decalNext = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const nrm = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  // ── 예광탄 ──
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.8 });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const line = new THREE.Line(g, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  // ── 먼지 ──
  const puffs = [];
  const puffGeo = new THREE.SphereGeometry(0.06, 6, 4);
  for (let i = 0; i < MAX_PUFFS; i++) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xd9c7a5, transparent: true, opacity: 0.6, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    puffs.push({ m, life: 0 });
  }
  let puffNext = 0;

  return {
    /** 맵 좌표 p(x,y,z), 면 방향 n */
    decal(p, n) {
      nrm.set(n[0], n[2], -n[1]);
      q.setFromUnitVectors(zAxis, nrm);
      pos.set(p[0] + n[0] * 0.012, p[2] + n[2] * 0.012, -(p[1] + n[1] * 0.012));
      m4.compose(pos, q, one);
      decals.setMatrixAt(decalNext, m4);
      decalNext = (decalNext + 1) % MAX_DECALS;
      decals.count = Math.min(MAX_DECALS, decals.count + 1);
      decals.instanceMatrix.needsUpdate = true;
    },
    clearDecals() {
      decals.count = 0;
      decalNext = 0;
    },
    tracer(a, b) {
      const t = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % MAX_TRACERS;
      const arr = t.line.geometry.attributes.position.array;
      arr[0] = a[0];
      arr[1] = a[2];
      arr[2] = -a[1];
      arr[3] = b[0];
      arr[4] = b[2];
      arr[5] = -b[1];
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.geometry.computeBoundingSphere();
      t.life = 0.07;
      t.line.visible = true;
    },
    puff(p, color = 0xd9c7a5) {
      const f = puffs[puffNext];
      puffNext = (puffNext + 1) % MAX_PUFFS;
      f.m.position.set(p[0], p[2], -p[1]);
      f.m.material.color.setHex(color);
      f.life = 0.25;
      f.m.visible = true;
    },
    update(dt) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.8;
        if (t.life <= 0) t.line.visible = false;
      }
      for (const f of puffs) {
        if (f.life <= 0) continue;
        f.life -= dt;
        const k = 1 - f.life / 0.25;
        f.m.scale.setScalar(1 + k * 2.5);
        f.m.material.opacity = 0.6 * (1 - k);
        if (f.life <= 0) f.m.visible = false;
      }
    },
  };
}
