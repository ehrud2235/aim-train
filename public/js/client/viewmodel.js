// 1인칭 손에 든 총(밴달 비슷한 모양)·칼. 반동 튐, 걸을 때 흔들림, 재장전, 꺼내기, 조준 위치.
import * as THREE from 'three';
import { VANDAL, KNIFE } from '../sim/valorant.js';

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

export function createViewmodel() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 10);
  scene.add(new THREE.HemisphereLight('#ffffff', '#55504a', 1.4));
  const key = new THREE.DirectionalLight('#ffffff', 1.2);
  key.position.set(1, 2, 1);
  scene.add(key);

  // ── 밴달 ──
  const vandal = new THREE.Group();
  const dark = 0x2a2c31;
  const wood = 0x5a4636;
  vandal.add(box(0.06, 0.085, 0.36, dark, 0, 0, 0)); // 몸통
  vandal.add(box(0.055, 0.07, 0.2, wood, 0, -0.005, -0.27)); // 총열 덮개
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.26, 8), new THREE.MeshLambertMaterial({ color: 0x1a1b1f }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.48);
  vandal.add(barrel);
  vandal.add(box(0.025, 0.03, 0.16, 0x1a1b1f, 0, 0.055, -0.02)); // 위 레일
  vandal.add(box(0.02, 0.04, 0.02, 0x1a1b1f, 0, 0.075, -0.2)); // 가늠쇠
  vandal.add(box(0.05, 0.08, 0.24, wood, 0, -0.015, 0.29)); // 개머리판
  const grip = box(0.04, 0.11, 0.045, 0x1f2024, 0, -0.08, 0.1);
  grip.rotation.x = -0.25;
  vandal.add(grip);
  const mag = box(0.045, 0.15, 0.075, 0x2f3137, 0, -0.1, -0.06);
  mag.rotation.x = 0.28;
  vandal.add(mag);
  const hand = box(0.07, 0.07, 0.11, 0x3b3f4a, 0.005, -0.075, 0.12);
  vandal.add(hand);
  const hand2 = box(0.075, 0.06, 0.1, 0x3b3f4a, 0, -0.05, -0.27);
  vandal.add(hand2);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  flash.position.set(0, 0.012, -0.64);
  flash.visible = false;
  vandal.add(flash);
  scene.add(vandal);

  // ── 칼 ──
  const knife = new THREE.Group();
  const blade = box(0.012, 0.05, 0.24, 0xcfd6de, 0, 0, -0.12);
  knife.add(blade);
  knife.add(box(0.03, 0.04, 0.1, 0x222326, 0, -0.005, 0.05));
  knife.add(box(0.07, 0.07, 0.1, 0x3b3f4a, 0, -0.01, 0.06));
  knife.rotation.set(0.2, 0.25, -0.35);
  scene.add(knife);

  const HIP = new THREE.Vector3(0.21, -0.22, -0.62);
  const ADS = new THREE.Vector3(0.0, -0.13, -0.5);
  const state = { kick: 0, kickRot: 0, bob: 0, flashT: 0, slash: 0 };
  const tmp = new THREE.Vector3();

  return {
    scene,
    camera,
    onShot() {
      state.kick = Math.min(0.06, state.kick + 0.028);
      state.kickRot = Math.min(0.16, state.kickRot + 0.05);
      state.flashT = 0.035;
      flash.rotation.z = Math.random() * Math.PI;
    },
    onSlash() {
      state.slash = 0.25;
    },
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    /** w: 무기 상태, speed: 이동 속도, dt */
    update(w, speed, onGround, dt) {
      const isKnife = w.current === 'knife';
      vandal.visible = !isKnife;
      knife.visible = isKnife;
      state.kick *= Math.exp(-dt * 22);
      state.kickRot *= Math.exp(-dt * 16);
      state.bob += dt * (onGround ? speed * 1.9 : 0);
      const bobAmt = Math.min(1, speed / 5.4) * (onGround ? 1 : 0.3);
      const bx = Math.sin(state.bob) * 0.012 * bobAmt;
      const by = -Math.abs(Math.cos(state.bob)) * 0.01 * bobAmt;
      // 꺼내기: 아래에서 올라옴
      const equipTotal = isKnife ? KNIFE.equipTime : VANDAL.equipTime;
      const eq = w.equip > 0 ? w.equip / equipTotal : 0;
      const equipDrop = eq * eq * 0.25;
      if (!isKnife) {
        tmp.copy(HIP).lerp(ADS, w.ads);
        vandal.position.set(tmp.x + bx * (1 - w.ads), tmp.y + by * (1 - w.ads) - equipDrop, tmp.z + state.kick);
        let rx = state.kickRot;
        let rz = 0;
        let magDrop = 0;
        if (w.reload > 0) {
          const p = 1 - w.reload / VANDAL.reloadTime; // 0 → 1
          const tilt = Math.sin(Math.min(1, p * 1.25) * Math.PI);
          rz = 0.55 * tilt;
          rx -= 0.25 * tilt;
          magDrop = p > 0.2 && p < 0.65 ? 0.25 : 0;
        }
        vandal.rotation.set(rx, 0.02 * (1 - w.ads), rz);
        mag.position.y = -0.1 - magDrop;
        mag.visible = magDrop < 0.2;
        state.flashT -= dt;
        flash.visible = state.flashT > 0;
      } else {
        state.slash = Math.max(0, state.slash - dt);
        const s = state.slash > 0 ? Math.sin((1 - state.slash / 0.25) * Math.PI) : 0;
        knife.position.set(0.22 + bx - s * 0.15, -0.22 + by - equipDrop + s * 0.05, -0.45 - s * 0.1);
      }
    },
  };
}
