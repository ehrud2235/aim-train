// 발로 에임장 — 화면·입력·루프. 계산은 sim/ 쪽(128틱 고정), 여기서는 그리고 소리 내고 입력만 받는다.
import * as THREE from 'three';
import { BIND } from '../sim/bind.js';
import { buildMap, parseGrid } from '../sim/mapgrid.js';
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
import { createCalibrator } from './calib.js';
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
const save = () => saveSettings(storage, S);

/** 맵 격자 받기 (gzip). 서버가 이미 풀어서 주면 그대로 쓴다 */
async function loadGrid(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`맵을 못 받음: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const map = buildMap(parseGrid(await loadGrid(BIND.grid)), BIND);
const game = createGame(map, S);

// ── 렌더러 ──
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.autoClear = false;
if (S.shadows !== 'off') {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 400);
camera.rotation.order = 'YXZ';
const world = buildWorld(map, scene, { shadows: S.shadows === 'off' ? null : S.shadows });
const enemyColor = () => ENEMY_COLORS[S.enemyColor] || ENEMY_COLORS.red;
const botView = createBotView(scene, enemyColor());
const fx = createFx(scene);
const vm = createViewmodel();
const hud = createHud(map, S);
const audio = createAudio();
audio.setVolume(S.volume);
audio.select(S.gunSkin, S.killEffect);

// ── 데스매치 회복팩 (죽은 자리에 10초, 청록색으로 빛나며 떠 있음) ──
const packGeo = new THREE.OctahedronGeometry(0.16, 0);
const packMat = new THREE.MeshBasicMaterial({ color: 0x4fe0b6, transparent: true, opacity: 0.9 });
const packGlowMat = new THREE.MeshBasicMaterial({ color: 0x4fe0b6, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
const packMeshes = [];
function updatePacks(t) {
  const packs = game.packs;
  while (packMeshes.length < packs.length) {
    const gm = new THREE.Group();
    gm.add(new THREE.Mesh(packGeo, packMat));
    const glow = new THREE.Mesh(packGeo, packGlowMat);
    glow.scale.setScalar(1.9);
    gm.add(glow);
    scene.add(gm);
    packMeshes.push(gm);
  }
  for (let i = 0; i < packMeshes.length; i++) {
    const gm = packMeshes[i];
    const k = packs[i];
    gm.visible = !!k;
    if (!k) continue;
    gm.position.set(k.x, k.z + 0.45 + Math.sin(t * 3 + i) * 0.06, -k.y);
    gm.rotation.y = t * 1.6;
    // 사라지기 2초 전부터 깜빡임
    gm.children[0].material.opacity = k.life < 2 ? 0.5 + 0.4 * Math.sin(t * 20) : 0.9;
  }
}

// ── 킬 배너 · 진짜 총 모델 (모듈·파일이 있으면 씀, 없으면 기본 모양) ──
let banner = null;
const killPackId = () => {
  if (S.killEffect !== 'auto') return S.killEffect;
  return (gunSkins.find((g) => g.id === S.gunSkin) || {}).killPack || 'base';
};
let gunSkins = [];
import('./killbanner.js')
  .then((m) => m.createKillBanner(document.getElementById('killbanner'), { pack: killPackId() }))
  .then((b) => {
    banner = b;
  })
  .catch((e) => console.warn('킬 배너를 못 불러옴 (기본 표시 없음)', e));

const realVm = { mod: null, model: null, scene: null, camera: null, skin: '', loading: null, lookup: null };
async function loadRealViewmodel() {
  if (!S.viewmodel) return;
  const want = S.gunSkin;
  if (realVm.skin === want && (realVm.model || realVm.loading)) return;
  realVm.skin = want;
  try {
    realVm.mod ||= await import('./vmodel.js');
    if (!realVm.lookup) {
      const r = await fetch('assets/models/manifest.json');
      realVm.lookup = r.ok ? await r.json() : null;
    }
    const list = (realVm.lookup && (realVm.lookup.vandal || realVm.lookup.skins || realVm.lookup)) || [];
    const arr = Array.isArray(list) ? list : Object.values(list);
    const entry = arr.find((s) => s.id === want) || arr.find((s) => s.id === 'default');
    if (!entry) return;
    realVm.loading = realVm.mod.loadViewmodel(entry);
    const model = await realVm.loading;
    realVm.loading = null;
    if (realVm.skin !== want) {
      model.dispose();
      return;
    }
    if (realVm.model) realVm.model.dispose();
    realVm.model = model;
    if (!realVm.scene) {
      realVm.scene = new THREE.Scene();
      realVm.scene.add(new THREE.HemisphereLight('#ffffff', '#4a4640', 1.6));
      const key = new THREE.DirectionalLight('#ffffff', 1.4);
      key.position.set(1, 2, 1);
      realVm.scene.add(key);
      realVm.camera = new THREE.PerspectiveCamera(entry.cameraFov || 54, camera.aspect, entry.near || 0.01, 100);
    }
    realVm.scene.add(model.object);
    model.onEvent((ev) => {
      if (ev && ev.options && /\.wav$/i.test(ev.options)) audio.modelSound(ev.options);
    });
    model.playDraw && model.playDraw(0.6);
  } catch (e) {
    realVm.loading = null;
    console.warn('총 모델을 못 불러옴 (기본 모양 사용)', e);
  }
}
loadRealViewmodel();
const useRealVm = () => S.viewmodel && realVm.model && game.weapon.current === 'vandal';

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  vm.resize(w / h);
  if (realVm.camera) {
    realVm.camera.aspect = w / h;
    realVm.camera.updateProjectionMatrix();
  }
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
    save();
    if (key === 'enemyColor') botView.setColor(enemyColor());
    if (key === 'volume') audio.setVolume(settings.volume);
    if (key === 'gunSkin' || key === 'killEffect') {
      audio.select(S.gunSkin, S.killEffect);
      if (banner) banner.setPack(killPackId()).catch(() => {});
      loadRealViewmodel();
    }
    if (key === 'viewmodel') loadRealViewmodel();
    if (key === 'hudAdjust') hud.applyAdjust();
    // 누르고 있기 ↔ 토글을 바꾸면 남아 있던 토글 상태를 지움 (조준이 혼자 켜져 있는 일 방지)
    if (key === 'adsMode') {
      adsToggle = false;
      game.input.ads = false;
    }
    if (key === 'walkMode') walkToggle = false;
    if (key === 'crouchMode') crouchToggle = false;
    if (reset) restart();
  },
  onStart: start,
  onCalibrate() {
    menu.hide();
    document.getElementById('hud').classList.remove('hidden');
    calib.enter();
  },
  drawPreview: previewCrosshair,
});
// 총 스킨 · 킬 효과 목록 (assets/sounds/manifest.json)
fetch('assets/sounds/manifest.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => {
    if (!m) return;
    gunSkins = m.vandalSkins || [];
    const lists = {};
    if (gunSkins.length) lists.gunSkins = gunSkins.map((g) => ({ id: g.id, name: g.name }));
    if (m.killPacks && m.killPacks.length) lists.killPacks = m.killPacks.map((k) => ({ id: k.id, name: k.name }));
    menu.setLists(lists);
    if (banner) banner.setPack(killPackId()).catch(() => {});
  })
  .catch(() => {});
const calib = createCalibrator(S, {
  onSave() {
    save();
    hud.applyAdjust();
  },
  onExit() {
    menu.render();
    menu.show();
  },
  getScale: () => window.innerHeight / 1080,
});

function restart() {
  game.reset();
  fx.clearDecals();
  hud.clearFeed();
  streak = 0;
  if (banner) banner.reset();
}

async function start() {
  audio.resume();
  if (game.match && game.match.over) restart();
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
    if (!calib.active) {
      menu.render();
      menu.show();
    }
  }
});
document.addEventListener('pointerlockerror', () => {
  hud.toast('마우스 잠금 실패 — 화면을 다시 클릭해 주세요');
});
canvas.addEventListener('click', () => {
  if (!locked && !menu.visible && !calib.active) start();
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
let showBoard = false;
let showBig = false;
let spinTest = null; // F2: 360° 확인
let totalYaw = 0;
let streak = 0; // 죽지 않고 연속 킬 (킬 배너·킬 소리 1~5)

function releaseInputs() {
  keys.clear();
  const i = game.input;
  i.fwd = i.back = i.left = i.right = 0;
  i.fire = i.jump = false;
  i.walk = walkToggle && S.walkMode === 'toggle';
  i.crouch = crouchToggle && S.crouchMode === 'toggle';
  if (S.adsMode !== 'toggle') i.ads = false;
  showBoard = false;
  showBig = false;
  hud.scoreboard(false);
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

function boardState() {
  return { mode: S.mode, match: game.match, bots: game.bots, stats: game.stats, elapsed: game.time - game.stats.startedAt };
}

window.addEventListener('keydown', (e) => {
  if (!locked) return;
  const c = e.code;
  if (c !== 'F11' && c !== 'F12') e.preventDefault();
  if (e.repeat) return;
  if (game.match && game.match.over && (c === 'Space' || c === 'Enter')) {
    restart();
    return;
  }
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
      if (placeBotAtAim(game)) hud.toast('적을 놓았어요 (N: 지우기)');
      else hud.toast('거기에는 놓을 수 없어요');
      break;
    case 'KeyN':
      clearPlacedBots(game);
      hud.toast('놓은 적을 지웠어요');
      break;
    case 'Tab':
      showBoard = true;
      hud.scoreboard(true, boardState());
      break;
    case 'CapsLock':
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
    showBoard = false;
    hud.scoreboard(false);
  }
  if (e.code === 'KeyM' || e.code === 'CapsLock') showBig = false;
  syncMoveKeys();
});

window.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (game.match && game.match.over) {
    if (e.button === 0) restart();
    return;
  }
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
// 우클릭(조준) 메뉴는 막되, 크로스헤어 코드 칸에서는 오른쪽 클릭 → 붙여넣기가 되게
window.addEventListener('contextmenu', (e) => {
  if (!(e.target instanceof Element && e.target.closest('input, textarea'))) e.preventDefault();
});

/** 재장전·무기 교체·부활로 조준이 풀리면 토글 조준도 같이 풀기 (다시 눌러야 조준) */
function dropToggleAds() {
  if (S.adsMode === 'toggle') {
    adsToggle = false;
    game.input.ads = false;
  }
}

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

/** 죽었을 때 전투 보고: 나를 죽인 적에게 받은 피해 · 준 피해 */
function combatReport(pl, killerId) {
  const taken = { dmg: 0, head: 0, body: 0, leg: 0 };
  for (const t of pl.taken) {
    if (t.bot !== killerId) continue;
    taken.dmg += t.dmg;
    taken[t.part] += 1;
  }
  const d = pl.dealt.get(killerId);
  return { taken, dealt: d ? { ...d } : { dmg: 0, head: 0, body: 0, leg: 0 } };
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
        audio.fire();
        vm.onShot();
        if (useRealVm()) realVm.model.playFire();
        const end = [e.from[0] + e.dir[0] * e.t, e.from[1] + e.dir[1] * e.t, e.from[2] + e.dir[2] * e.t];
        if (S.showTracers) {
          const { f, r, u } = aimBasis(game.yaw, game.pitch);
          const ox = e.ads ? 0 : 0.12;
          const oz = e.ads ? -0.06 : -0.12;
          const muzzle = [0, 1, 2].map((i) => e.from[i] + f[i] * 0.6 + r[i] * ox + u[i] * oz);
          fx.tracer(muzzle, end);
        }
        if (e.hitBot) {
          audio.hit(e.hitBot.part);
          fx.puff(end, S.showBlood ? 0x9c1c1c : 0xb9b9b9);
          if (S.showDamage) hud.damage(String(e.hitBot.dmg), e.hitBot.part === 'head');
        } else if (e.normal) {
          fx.decal(end, e.normal);
          fx.puff(end);
        }
        if (e.kill) {
          streak += 1;
          audio.kill(streak, e.kill.head);
          if (banner) banner.show(streak, e.kill.head);
          hud.myKill(e.kill, e.kill.head);
          // 데스매치: 킬하면 탄창이 바로 가득 → 하던 재장전 소리·동작 멈춤
          if (S.mode === 'dm') {
            audio.cancelReload();
            if (useRealVm() && realVm.model.playIdle) realVm.model.playIdle();
          }
        }
        break;
      }
      case 'reload':
        if (!(useRealVm() && audio.hasModelSounds)) audio.reload(VANDAL.reloadTime);
        if (useRealVm()) realVm.model.playReload(VANDAL.reloadTime);
        dropToggleAds();
        break;
      case 'equip':
        dropToggleAds();
        audio.equip();
        if (useRealVm() && realVm.model.playDraw) realVm.model.playDraw(VANDAL.equipTime);
        break;
      case 'teleport':
        audio.tele();
        snapInterp();
        break;
      case 'door':
        audio.door();
        break;
      case 'footstep':
        if (e.who === 'me') audio.step(true);
        else audio.step(false, [e.x, e.y, e.z + 0.1], listener);
        break;
      case 'botShot': {
        audio.botFire([e.x, e.y, e.z + 1.4], listener);
        if (S.showTracers) {
          const miss = e.hit ? 0 : 0.8;
          fx.tracer([e.x, e.y, e.z + 1.35], [m.x + (Math.random() - 0.5) * miss, m.y + (Math.random() - 0.5) * miss, m.z + 1.2 + (Math.random() - 0.5) * miss]);
        }
        break;
      }
      case 'hurt':
        hud.hurt(e.from);
        audio.hurt();
        break;
      case 'died': {
        streak = 0;
        if (banner) banner.reset();
        audio.cancelReload();
        hud.died({ killer: e.killer, ...combatReport(game.player, e.killer.id) });
        break;
      }
      case 'respawn':
        hud.respawned();
        dropToggleAds();
        fx.clearDecals();
        snapInterp();
        if (useRealVm() && realVm.model.playDraw) realVm.model.playDraw(0.6);
        break;
      case 'reveal':
        hud.reveal(e.bots.map((b) => ({ ...b, agent: (game.bots.find((x) => x.id === b.id) || {}).agent || 'jett' })));
        break;
      case 'heal':
        audio.heal();
        hud.heal();
        break;
      case 'matchEnd': {
        const rows = [{ me: true, k: game.match.kills }, ...game.bots.map((b) => ({ k: b.kills || 0 }))].sort((a, b) => b.k - a.k);
        const place = rows.findIndex((r) => r.me) + 1;
        hud.matchEnd({ win: e.win, place, players: rows.length, kills: game.match.kills, deaths: game.match.deaths });
        game.input.fire = false;
        break;
      }
      case 'land':
        if (e.speed > 3) audio.step(true);
        break;
      case 'reset':
        dropToggleAds();
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
    b.pm = b.mover;
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
const adsVignette = document.getElementById('ads-vignette');
let lastVig = -1;

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
  const pl = game.player;
  const m = pl.mover;
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
  const vig = Math.round(w.ads * 100) / 100;
  if (vig !== lastVig) {
    lastVig = vig;
    adsVignette.style.opacity = String(vig);
  }

  for (const b of game.bots) {
    // 다시 나타난 봇(mover 가 새로 바뀜)은 시체 자리에서 끌려오지 않게 바로 새 자리에
    const a = b.px === undefined || b.pm !== b.mover ? 1 : alpha;
    b.rx = (b.px ?? b.mover.x) + (b.mover.x - (b.px ?? b.mover.x)) * a;
    b.ry = (b.py ?? b.mover.y) + (b.mover.y - (b.py ?? b.mover.y)) * a;
    b.rz = (b.pz ?? b.mover.z) + (b.mover.z - (b.pz ?? b.mover.z)) * a;
  }
  botView.update(game.bots, dt);
  world.update(game.time);
  fx.update(dt);
  updatePacks(game.time);
  if (banner) banner.update(dt);

  renderer.clear();
  renderer.render(scene, camera);
  const acc2 = accuracyState(m, weaponSpeed(w));
  if (S.viewmodel && pl.alive) {
    renderer.clearDepth();
    if (useRealVm()) {
      realVm.model.update(dt);
      renderer.render(realVm.scene, realVm.camera);
    } else {
      vm.update(w, acc2.speed, m.onGround, dt);
      renderer.render(vm.scene, vm.camera);
    }
  }

  // 크로스헤어: 연사 오차·이동 오차만큼 벌어짐 (죽었을 때·경기 끝엔 숨김)
  const focal = window.innerWidth / 2 / Math.tan((hfov / 2) * DEG);
  const pxPerDeg = focal * Math.tan(DEG);
  const over = !!(game.match && game.match.over);
  const showCross = pl.alive && !over;
  const sp = currentSpread(w, { speed: acc2.speed, airborne: acc2.airborne, crouched: m.crouch > 0.5, landing: m.landErr > 0 });
  if (w.current === 'vandal') hud.drawCrosshair(S.crosshair, sp.spray, sp.move, pxPerDeg, sp.total, S.showSpread, showCross);
  else hud.drawCrosshair(S.crosshair, 0, 0, pxPerDeg, 0, false, showCross);

  if (spinTest) {
    const turned = totalYaw - spinTest.start;
    hud.toast(`360° 확인: ${turned.toFixed(1)}°  (F2 로 끝)`, 0.3);
  }
  const reg = map.regionAt(m.x, m.y);
  hud.update(
    {
      hp: pl.hp,
      armor: pl.armor,
      alive: pl.alive,
      deadFor: pl.deadFor,
      protect: pl.protect,
      ammo: w.ammo,
      reserve: w.reserve,
      knife: w.current === 'knife',
      weapon: w.current,
      x: m.x,
      y: m.y,
      heading: game.yaw,
      bots: game.bots,
      enemyColor: enemyColor(),
      region: reg ? reg.label : '',
      speed: acc2.speed,
      threshold: acc2.threshold,
      accurate: acc2.accurate,
      airborne: acc2.airborne,
      bigMap: showBig,
      fps,
      mode: S.mode,
      match: game.match,
      stats: game.stats,
      elapsed: game.time - game.stats.startedAt,
    },
    dt,
  );
  updateSpeedometer(acc2);
}

// 속도계 (연습 도움)
const speedEl = document.getElementById('speed');
function updateSpeedometer(a) {
  speedEl.classList.toggle('hidden', !S.showSpeed);
  if (!S.showSpeed) return;
  const frac = Math.min(1, a.speed / 6.75);
  document.getElementById('speed-fill').style.width = `${frac * 100}%`;
  document.getElementById('speed-thr').style.left = `${(a.threshold / 6.75) * 100}%`;
  speedEl.classList.toggle('ok', a.accurate);
  speedEl.classList.toggle('air', a.airborne);
  document.getElementById('speed-txt').textContent = a.airborne ? '공중' : `${a.speed.toFixed(2)} m/s${a.accurate ? '  정확' : ''}`;
}
requestAnimationFrame(frame);

// 개발·테스트용 (콘솔에서 __aim)
window.__aim = {
  game,
  settings: S,
  map,
  camera,
  world,
  hud,
  audio,
  realVm,
  get banner() {
    return banner;
  },
  start,
  restart,
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
  ui(big, board) {
    showBig = !!big;
    showBoard = !!board;
    hud.scoreboard(!!board, boardState());
  },
  hideMenu() {
    menu.hide();
    document.getElementById('hud').classList.remove('hidden');
  },
};
