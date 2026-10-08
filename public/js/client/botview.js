// 봇 모습: 상자로 만든 사람 + 발로란트처럼 적 테두리(빨강/노랑/보라). 판정 박스와 크기를 맞췄다.
import * as THREE from 'three';
import { HITBOX } from '../sim/valorant.js';

const OUTLINE = 1.07;

function part(geo, color, outlineMat) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  g.add(m);
  const o = new THREE.Mesh(geo, outlineMat);
  o.scale.setScalar(OUTLINE);
  g.add(o);
  return g;
}

export function createBotView(scene, enemyColor) {
  const outlineMat = new THREE.MeshBasicMaterial({ color: enemyColor, side: THREE.BackSide });
  const views = new Map();
  const H = HITBOX;

  const legGeo = new THREE.BoxGeometry(0.17, H.leg.y1, 0.2);
  legGeo.translate(0, -H.leg.y1 / 2, 0); // 엉덩이를 기준으로 흔들리게
  const bodyGeo = new THREE.BoxGeometry(H.body.hw * 2, H.body.y1 - H.body.y0, H.body.hd * 2);
  const headGeo = new THREE.BoxGeometry(H.head.hw * 2, H.head.y1 - H.head.y0, H.head.hd * 2);
  const visorGeo = new THREE.BoxGeometry(H.head.hw * 1.6, 0.07, 0.03);
  const armGeo = new THREE.BoxGeometry(0.12, 0.12, 0.5);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.1, 0.75);

  function make() {
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const hips = new THREE.Group();
    hips.position.y = H.leg.y1;
    root.add(hips);
    const legL = part(legGeo, 0x2b2f38, outlineMat);
    const legR = part(legGeo, 0x2b2f38, outlineMat);
    legL.position.x = -0.1;
    legR.position.x = 0.1;
    hips.add(legL, legR);
    const upper = new THREE.Group(); // 앉으면 같이 내려감
    root.add(upper);
    const body = part(bodyGeo, 0x4b5160, outlineMat);
    body.position.y = (H.body.y0 + H.body.y1) / 2;
    upper.add(body);
    const head = part(headGeo, 0xd9b99b, outlineMat);
    head.position.y = (H.head.y0 + H.head.y1) / 2;
    upper.add(head);
    const visor = new THREE.Mesh(visorGeo, new THREE.MeshBasicMaterial({ color: 0x1b1d22 }));
    visor.position.set(0, (H.head.y0 + H.head.y1) / 2 + 0.03, -H.head.hd - 0.01);
    upper.add(visor);
    const arms = new THREE.Group();
    arms.position.set(0.12, 1.3, -0.22);
    const arm = new THREE.Mesh(armGeo, new THREE.MeshLambertMaterial({ color: 0x3d424f }));
    arms.add(arm);
    const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0x16181c }));
    gun.position.set(0, 0.05, -0.3);
    arms.add(gun);
    upper.add(arms);
    scene.add(root);
    return { root, legL, legR, upper, phase: 0, deathT: 0, wasAlive: true };
  }

  return {
    setColor(c) {
      outlineMat.color.set(c);
    },
    /** bots: 시뮬레이션 봇들, alpha: 틱 사이 보간, dt: 프레임 시간 */
    update(bots, dt) {
      const alive = new Set();
      for (const b of bots) {
        alive.add(b.id);
        let v = views.get(b.id);
        if (!v) {
          v = make();
          views.set(b.id, v);
        }
        const m = b.mover;
        const px = b.rx ?? m.x;
        const py = b.ry ?? m.y;
        const pz = b.rz ?? m.z;
        v.root.position.set(px, pz, -py);
        v.root.rotation.set(0, (-b.face * Math.PI) / 180, 0);
        if (b.alive) {
          if (!v.wasAlive) {
            v.deathT = 0;
            v.root.visible = true;
          }
          v.wasAlive = true;
          v.root.rotation.x = 0;
          v.root.visible = true;
          const sp = Math.hypot(m.vx, m.vy);
          v.phase += dt * sp * 2.6;
          const swing = Math.min(1, sp / 3) * 0.6 * Math.sin(v.phase);
          v.legL.rotation.x = swing;
          v.legR.rotation.x = -swing;
          const c = m.crouch * HITBOX.crouchDrop;
          v.upper.position.y = -c;
          const legScale = (HITBOX.leg.y1 - c) / HITBOX.leg.y1;
          v.legL.scale.y = legScale;
          v.legR.scale.y = legScale;
          v.legL.parent.position.y = HITBOX.leg.y1 - c;
        } else {
          // 쓰러짐
          if (v.wasAlive) v.deathT = 0;
          v.wasAlive = false;
          v.deathT += dt;
          v.root.rotation.x = Math.min(1, v.deathT / 0.28) * (-Math.PI / 2) * 0.95;
          v.root.visible = v.deathT < 0.9;
        }
      }
      for (const [id, v] of views) {
        if (!alive.has(id)) {
          scene.remove(v.root);
          views.delete(id);
        }
      }
    },
  };
}
