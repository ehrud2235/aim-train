// 발로 에임장 — 화면·입력·루프. 계산은 sim/ 쪽(128틱 고정), 여기서는 그리고 소리 내고 입력만 받는다.
import * as THREE from 'three';
import { BIND } from '../sim/bind.js';
import { buildMap } from '../sim/mapgrid.js';
import { HFOV, VANDAL, YAW_PER_COUNT, ENEMY_COLORS, zoomedHfov } from '../sim/valorant.js';
import { loadSettings, saveSettings } from '../sim/settings.js';
import {
  createGame,
  DT,
  viewAngles,
  aimBasis,
  placeBotAtAim,
  clearPlacedBots,
  switchTo,
  startReload,
  isAds,
  eyeHeight,
  accuracyState,
  weaponSpeed,
  newStats,
} from '../sim/game.js';
import { currentSpread } from '../sim/weapon.js';
import { buildWorld } from './world.js';
import { createBotView } from './botview.js';
import { createViewmodel } from './viewmodel.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createMenu } from './menu.js';
import { previewCrosshair } from './crosshair.js';

const DEG = Math.PI / 180;
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

const S = loadSettings(storage);
const map = buildMap(BIND);
const game = createGame(map, S);

// ── 렌더러 ──
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 400);
camera.rotation.order = 'YXZ';
const world = buildWorld(map, scene);
const botView = createBotView(scene, ENEMY_COLORS[S.enemyColor] || ENEMY_COLORS.red);
const fx = createFx(scene);
const vm = createViewmodel();
const hud = createHud(map);
const audio = createAudio();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  vm.resize(w / h);
}
window.addEventListener('resize', resize);
resize();

/** 가로 시야각 → three.js 세로 시야각 (발로는 가로 103° 고정) */
function vfovFor(hfov, aspect) {
  return (2 * Math.atan(Math.tan((hfov / 2) * DEG) / aspect)) / DEG;
}

// ── 메뉴 ──
let locked = false;
let skipMouse = 0;
const menu = createMenu(S, {
  onChange(settings, { reset, key }) {
    saveSettings(storage, settings);
    if (key === 'enemyColor') botView.setColor(ENEMY_COLORS[settings.enemyColor] || ENEMY_COLORS.red);
    if (key === 'volume') audio.setVolume(settings.volume);
    if (reset) {
      game.reset();
      fx.clearDecals();
    }
  },
  onStart: start,
  drawPreview: previewCrosshair,
});
audio.setVolume(S.volume);

async function start() {
  audio.resume();
  if (S.fullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {});
    } catch {
      /* 전체화면 안 돼도 그냥 진행 */
    }
  }
  lockPointer();
}

function lockPointer() {
  const opts = S.rawInput ? { unadjustedMovement: true } : undefined;
  try {
    const p = canvas.requestPointerLock(opts);
    if (p && p.catch) {
      p.catch(() => {
        // 원시 입력을 지원하지 않는 브라우저 → 일반 잠금
        try {
          const q = canvas.requestPointerLock();
          if (q && q.catch) q.catch(() => {});
        } catch {
          /* 무시 */
        }
      });
    }
  } catch {
    canvas.requestPointerLock();
  }
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) {
    menu.hide();
    document.getElementById('hud').classList.remove('hidden');
    skipMouse = 1;
    acc = 0;
  } else {
    releaseInputs();
    menu.render();
    menu.show();
  }
});
document.addEventListener('pointerlockerror', () => {
  hud.toast('마우스 잠금 실패 — 화면을 다시 클릭해 주세요');
});
canvas.addEventListener('click', () => {
  if (!locked && !menu.visible) start();
});
window.addEventListener('beforeunload', (e) => {
  if (game.stats.shots > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── 입력 ──
const keys = new Set();
let walkToggle = false;
let crouchToggle = false;
let adsToggle = false;
let showStats = false;
let showBig = false;
let spinTest = null; // F2: 360° 확인
let totalYaw = 0;

function releaseInputs() {
  keys.clear();
  const i = game.input;
  i.fwd = i.back = i.left = i.right = 0;
  i.fire = i.jump = false;
  i.walk = walkToggle && S.walkMode === 'toggle';
  i.crouch = crouchToggle && S.crouchMode === 'toggle';
  if (S.adsMode !== 'toggle') i.ads = false;
  showStats = false;
  showBig = false;
  hud.showStats(false);
}
window.addEventListener('blur', releaseInputs);

function syncMoveKeys() {
  const i = game.input;
  i.fwd = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  i.back = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  i.left = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
  i.right = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
  i.jump = keys.has('Space');
  i.walk = S.walkMode === 'toggle' ? walkToggle : keys.has('ShiftLeft') || keys.has('ShiftRight');
  i.crouch = S.crouchMode === 'toggle' ? crouchToggle : keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
}

window.addEventListener('keydown', (e) => {
  if (!locked) return;
  const c = e.code;
  if (c !== 'F11' && c !== 'F12') e.preventDefault();
  if (e.repeat) return;
  keys.add(c);
  if ((c === 'ShiftLeft' || c === 'ShiftRight') && S.walkMode === 'toggle') walkToggle = !walkToggle;
  if ((c === 'ControlLeft' || c === 'ControlRight' || c === 'KeyC') && S.crouchMode === 'toggle') crouchToggle = !crouchToggle;
  switch (c) {
    case 'Escape':
      // 전체화면 키보드 잠금 중에는 Esc 가 마우스 잠금을 안 풀어 주므로 직접 푼다
      document.exitPointerLock();
      break;
    case 'KeyR':
      if (startReload(game.weapon)) game.events.push({ type: 'reload' });
      break;
    case 'Digit1':
      if (switchTo(game.weapon, 'vandal')) game.events.push({ type: 'equip' });
      break;
    case 'Digit3':
      if (switchTo(game.weapon, 'knife')) game.events.push({ type: 'equip' });
      break;
    case 'KeyQ':
      if (switchTo(game.weapon, game.weapon.last)) game.events.push({ type: 'equip' });
      break;
    case 'KeyB':
      if (placeBotAtAim(game)) hud.toast('봇을 놓았어요 (N: 지우기)');
      else hud.toast('거기에는 놓을 수 없어요');
      break;
    case 'KeyN':
      clearPlacedBots(game);
      hud.toast('놓은 봇을 지웠어요');
      break;
    case 'Tab':
      showStats = true;
      hud.stats(game.stats, game.time - game.stats.startedAt);
      hud.showStats(true);
      break;
    case 'KeyM':
      showBig = true;
      break;
    case 'KeyF': {
      const st = game.modeStart;
      const m = game.player.mover;
      m.x = st.at[0];
      m.y = st.at[1];
      m.z = map.floorAt(m.x, m.y);
      m.vx = m.vy = m.vz = 0;
      game.yaw = st.heading;
      game.pitch = 0;
      snapInterp();
      break;
    }
    case 'Backspace':
      game.stats = newStats();
      game.stats.startedAt = game.time;
      fx.clearDecals();
      hud.toast('기록을 초기화했어요');
      break;
    case 'F2':
      if (spinTest) {
        spinTest = null;
        hud.toast('360° 확인 끝', 1);
      } else spinTest = { start: totalYaw };
      break;
    default:
      break;
  }
  syncMoveKeys();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') {
    showStats = false;
    hud.showStats(false);
  }
  if (e.code === 'KeyM') showBig = false;
  syncMoveKeys();
});

window.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) {
    game.input.fire = true;
    if (game.weapon.current === 'knife') {
      vm.onSlash();
      audio.slash();
    }
  }
  if (e.button === 2) {
    if (S.adsMode === 'toggle') adsToggle = !adsToggle;
    game.input.ads = S.adsMode === 'toggle' ? adsToggle : true;
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) game.input.fire = false;
  if (e.button === 2 && S.adsMode !== 'toggle') game.input.ads = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

function onMouseMove(e) {
  if (!locked) return;
  if (skipMouse > 0) {
    skipMouse--;
    return;
  }
  const ads = isAds(game.weapon);
  const k = YAW_PER_COUNT * S.sens * S.mouseScale * (ads ? S.scopedMult / VANDAL.zoom : 1);
  const dyaw = e.movementX * k;
  totalYaw += dyaw;
  game.yaw = (((game.yaw + dyaw) % 360) + 360) % 360;
  const dp = e.movementY * k * (S.invertY ? 1 : -1);
  game.pitch = Math.max(-89, Math.min(89, game.pitch + dp));
}
// 지원하면 pointerrawupdate (지연이 더 적음)
if ('onpointerrawupdate' in window) document.addEventListener('pointerrawupdate', onMouseMove);
else document.addEventListener('mousemove', onMouseMove);

// ── 이벤트 → 소리·효과 ──
const listener = { x: 0, y: 0, z: 0, heading: 0 };
const reloadTimers = [];
function reloadSounds() {
  for (const t of reloadTimers) clearTimeout(t);
  reloadTimers.length = 0;
  audio.click(0.8);
  reloadTimers.push(setTimeout(() => audio.click(1.1), 1100));
  reloadTimers.push(setTimeout(() => audio.click(0.7), 2100));
}

function handleEvents() {
  const m = game.player.mover;
  listener.x = m.x;
  listener.y = m.y;
  listener.z = m.z + eyeHeight(m);
  listener.heading = game.yaw;
  for (const e of game.events) {
    switch (e.type) {
      case 'shot': {
        audio.shot();
        vm.onShot();
        const end = [e.from[0] + e.dir[0] * e.t, e.from[1] + e.dir[1] * e.t, e.from[2] + e.dir[2] * e.t];
        if (S.showTracers) {
          const { f, r, u } = aimBasis(game.yaw, game.pitch);
          const ads = e.ads;
          const ox = ads ? 0 : 0.12;
          const oz = ads ? -0.06 : -0.12;
          const muzzle = [0, 1, 2].map((i) => e.from[i] + f[i] * 0.6 + r[i] * ox + u[i] * oz);
          fx.tracer(muzzle, end);
        }
        if (e.hitBot) {
          if (e.hitBot.part === 'head') audio.head();
          else audio.body();
          fx.puff(end, 0xff6060);
          if (S.showDamage) hud.damage(String(e.hitBot.dmg), e.hitBot.part === 'head');
        } else if (e.normal) {
          fx.decal(end, e.normal);
          fx.puff(end);
        }
        if (e.kill) {
          audio.kill();
          hud.kill(e.kill.head);
        }
        break;
      }
      case 'reload':
        reloadSounds();
        break;
      case 'equip':
        audio.click(1.4);
        for (const t of reloadTimers) clearTimeout(t);
        break;
      case 'teleport':
        audio.tele();
        snapInterp();
        hud.toast(e.id === 'A' ? 'A 텔레포터 → B 숏' : 'B 텔레포터 → A 로비', 1.2);
        break;
      case 'door':
        audio.door();
        break;
      case 'footstep':
        if (e.who === 'me') audio.step(true);
        else audio.step(false, [e.x, e.y, e.z + 0.1], listener);
        break;
      case 'botShot': {
        audio.botShot([e.x, e.y, e.z + 1.4], listener);
        if (S.showTracers) {
          const miss = e.hit ? 0 : 0.8;
          fx.tracer([e.x, e.y, e.z + 1.35], [m.x + (Math.random() - 0.5) * miss, m.y + (Math.random() - 0.5) * miss, m.z + 1.2 + (Math.random() - 0.5) * miss]);
        }
        break;
      }
      case 'hurt':
        hud.hurt();
        audio.hurt();
        break;
      case 'died':
        hud.toast('사망 — 2초 뒤 다시 시작', 2);
        break;
      case 'land':
        if (e.speed > 3) audio.step(true);
        break;
      case 'reset':
      case 'respawn':
        fx.clearDecals();
        snapInterp();
        break;
      default:
        break;
    }
  }
  game.events.length = 0;
}

// ── 보간 (128틱 사이 부드럽게) ──
const prev = { x: 0, y: 0, z: 0 };
function savePrev() {
  const m = game.player.mover;
  prev.x = m.x;
  prev.y = m.y;
  prev.z = m.z;
  for (const b of game.bots) {
    b.px = b.mover.x;
    b.py = b.mover.y;
    b.pz = b.mover.z;
  }
}
function snapInterp() {
  savePrev();
}
savePrev();

// ── 루프 ──
let acc = 0;
let last = performance.now();
let fpsCount = 0;
let fpsT = 0;
let fps = 0;
let statsT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsCount++;
  fpsT += dt;
  if (fpsT >= 0.5) {
    fps = Math.round(fpsCount / fpsT);
    fpsCount = 0;
    fpsT = 0;
  }

  if (locked) {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 32) {
      savePrev();
      game.step();
      handleEvents();
      acc -= DT;
      steps++;
    }
  } else if (game.events.length) handleEvents();
  const alpha = locked ? acc / DT : 1;

  // 카메라
  const m = game.player.mover;
  const x = prev.x + (m.x - prev.x) * alpha;
  const y = prev.y + (m.y - prev.y) * alpha;
  const z = prev.z + (m.z - prev.z) * alpha;
  const eye = z + eyeHeight(m) + m.stepSmooth;
  const va = viewAngles(game);
  if (!window.__aim || !window.__aim.freeCam) {
    // 격자 경계와 정확히 같은 위치면 일부 GPU 에서 바닥 무늬가 깨져서 아주 살짝 비킴
    camera.position.set(x + 0.0013, eye, -y - 0.0017);
    camera.rotation.set(va.pitch * DEG, -va.yaw * DEG, 0);
  }
  const w = game.weapon;
  const hfov = HFOV + (zoomedHfov(VANDAL.zoom) - HFOV) * w.ads;
  camera.fov = vfovFor(hfov, camera.aspect);
  camera.updateProjectionMatrix();

  for (const b of game.bots) {
    const a = b.px === undefined ? 1 : alpha;
    b.rx = (b.px ?? b.mover.x) + (b.mover.x - (b.px ?? b.mover.x)) * a;
    b.ry = (b.py ?? b.mover.y) + (b.mover.y - (b.py ?? b.mover.y)) * a;
    b.rz = (b.pz ?? b.mover.z) + (b.mover.z - (b.pz ?? b.mover.z)) * a;
  }
  botView.update(game.bots, dt);
  world.update(game.time);
  fx.update(dt);

  renderer.clear();
  renderer.render(scene, camera);
  const acc2 = accuracyState(m, weaponSpeed(w));
  if (S.viewmodel) {
    vm.update(w, acc2.speed, m.onGround, dt);
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
  }

  // 크로스헤어: 연사 오차·이동 오차만큼 벌어짐
  const focal = window.innerWidth / 2 / Math.tan((hfov / 2) * DEG);
  const pxPerDeg = focal * Math.tan(DEG);
  const sp = currentSpread(w, { speed: acc2.speed, airborne: acc2.airborne, crouched: m.crouch > 0.5 });
  if (w.current === 'vandal') hud.drawCrosshair(S.crosshair, sp.spray, sp.move, pxPerDeg, sp.total, S.showSpread);
  else hud.drawCrosshair(S.crosshair, 0, 0, pxPerDeg, 0, false);

  if (spinTest) {
    const turned = totalYaw - spinTest.start;
    hud.toast(`360° 확인: ${turned.toFixed(1)}°  (F2 로 끝)`, 0.3);
  }
  if (showStats) {
    statsT -= dt;
    if (statsT <= 0) {
      statsT = 0.25;
      hud.stats(game.stats, game.time - game.stats.startedAt);
    }
  }
  const reg = map.regionAt(m.x, m.y);
  hud.update(
    {
      hp: game.player.hp,
      alive: game.player.alive,
      ammo: w.ammo,
      reserve: w.reserve,
      knife: w.current === 'knife',
      reloading: w.reload > 0,
      equipping: w.equip > 0,
      x: m.x,
      y: m.y,
      heading: game.yaw,
      bots: game.bots,
      enemyColor: ENEMY_COLORS[S.enemyColor] || ENEMY_COLORS.red,
      region: reg ? reg.label : '',
      speed: acc2.speed,
      threshold: acc2.threshold,
      accurate: acc2.accurate,
      airborne: acc2.airborne,
      showSpeed: S.showSpeed,
      showMinimap: S.showMinimap,
      bigMap: showBig,
      fps,
    },
    dt,
  );
}
requestAnimationFrame(frame);

// 개발·테스트용 (콘솔에서 __aim)
window.__aim = {
  game,
  settings: S,
  map,
  camera,
  world,
  start,
  /** 마우스 잠금 없이 n 틱 진행 */
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      savePrev();
      game.step();
      handleEvents();
    }
  },
  view(x, y, heading, pitch = 0) {
    const pm = game.player.mover;
    pm.x = x;
    pm.y = y;
    pm.z = map.floorAt(x, y);
    game.yaw = heading;
    game.pitch = pitch;
    snapInterp();
  },
  ui(big, stats) {
    showBig = !!big;
    showStats = !!stats;
    hud.stats(game.stats, game.time - game.stats.startedAt);
    hud.showStats(!!stats);
  },
  hideMenu() {
    menu.hide();
    document.getElementById('hud').classList.remove('hidden');
  },
};
