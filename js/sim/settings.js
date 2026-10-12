// 설정 기본값, 저장/불러오기, 발로란트 크로스헤어 코드 읽기.

import { CROSSHAIR_COLORS } from './valorant.js';

export const DEFAULT_CROSSHAIR = {
  color: '#ffffff',
  outline: true,
  outlineOpacity: 0.5,
  outlineThickness: 1,
  dot: false,
  dotOpacity: 1,
  dotThickness: 2,
  firingErrorAll: true, // 연사 시 크로스헤어가 벌어짐 (내부 스위치 — 선마다 fireError 로 조절)
  fade: false, // '사격 오차에 따라 조준선 흐리게' (코드 f) — 발로 기본 끔
  inner: { show: true, opacity: 0.8, length: 6, vlength: null, thickness: 2, offset: 3, moveError: false, fireError: true },
  outer: { show: true, opacity: 0.35, length: 2, vlength: null, thickness: 2, offset: 10, moveError: true, fireError: true },
};

export const DEFAULTS = {
  // ── 감도·조작 (발로 설정과 같은 값) ──
  dpi: 800,
  sens: 0.4,
  scopedMult: 1.0,
  rawInput: true,
  mouseScale: 1.0, // 브라우저 보정 (보통 1)
  invertY: false,
  adsMode: 'hold', // 'hold' | 'toggle'
  crouchMode: 'hold',
  walkMode: 'hold',
  crosshairCode: '',
  crosshair: DEFAULT_CROSSHAIR,
  // ── 발로 일반 설정 ──
  enemyColor: 'red', // 'red' | 'purple' | 'yellowD' | 'yellowP'
  minimap: { rotate: true, centered: true, size: 1.0, zoom: 1.0, cones: true },
  regionNames: true, // 큰 지도(Caps Lock)에 위치 이름
  showBlood: true,
  showTracers: true,
  showFps: false,
  // ── 소리 ──
  volume: 0.7,
  // ── 화면 ──
  viewmodel: true,
  fullscreen: true,
  shadows: 'low', // 'off' | 'low' | 'high'
  // ── 연습 ──
  mode: 'dm', // 'free' | 'dm' | 'hold' | 'duel'
  matchRules: 'valorant', // 'valorant' (40킬 / 9:00) | 'endless'
  agent: 'jett', // 내 요원 (HUD 아이콘)
  gunSkin: 'default', // 총 스킨 (모양·총소리) — assets/sounds·models 목록의 id
  killEffect: 'auto', // 킬 배너·킬 소리 팩 ('auto' = 총 스킨에 맞춤)
  playerName: '나',
  dmBots: 13, // 발로 데스매치 14인 = 나 + 13
  dmBehavior: 'mixed',
  hold: 'aSiteLamps',
  duel: 'bLong30',
  duelBehavior: 'strafe',
  fight: 'normal', // 'off' | 'easy' | 'normal' | 'hard'
  botArmor: true, // 봇 중방어구 (연습장 'Bot Armor')
  infiniteReserve: false, // 연습장 'Infinite Ammo'
  // ── 발로에 없는 연습 도움 (기본 끔) ──
  showSpeed: false,
  showSpread: false,
  showDamage: false,
  showRegion: false,
  showPracticeStats: true, // Tab 점수판 아래 내 기록
  // ── HUD 위치 맞추기 (스크린샷 대조) ──
  hudAdjust: {}, // { 요소: { x, y, s } } — 1080p 기준 px, 배율
};

export const FIGHT_LEVELS = {
  off: { enabled: false },
  easy: { enabled: true, reaction: 0.55, accuracy: 0.18, headRate: 0.1 },
  normal: { enabled: true, reaction: 0.35, accuracy: 0.3, headRate: 0.2 },
  hard: { enabled: true, reaction: 0.22, accuracy: 0.45, headRate: 0.3 },
};

const KEY = 'valoaim.settings.v2';
const OLD_KEY = 'valoaim.settings.v1';
// 이전 버전에서 가져올 개인 설정 (나머지는 새 기본값 — 발로와 같게)
const CARRY = ['dpi', 'sens', 'scopedMult', 'rawInput', 'mouseScale', 'invertY', 'adsMode', 'crouchMode', 'walkMode', 'crosshairCode', 'crosshair', 'volume', 'fullscreen', 'hold', 'duel'];

function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!over || typeof over !== 'object') return out;
  for (const k of Object.keys(over)) {
    const b = base ? base[k] : undefined;
    const o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object') out[k] = deepMerge(b, o);
    else if (o !== undefined) out[k] = o;
  }
  return out;
}

export function loadSettings(storage) {
  let saved = null;
  try {
    const raw = storage && storage.getItem(KEY);
    if (raw) saved = JSON.parse(raw);
    else {
      const old = storage && storage.getItem(OLD_KEY);
      if (old) {
        const o = JSON.parse(old);
        saved = {};
        for (const k of CARRY) if (o && k in o) saved[k] = o[k];
      }
    }
  } catch {
    saved = null;
  }
  const s = deepMerge(structuredClone(DEFAULTS), saved);
  if (!['red', 'purple', 'yellowD', 'yellowP'].includes(s.enemyColor)) s.enemyColor = s.enemyColor === 'yellow' ? 'yellowD' : 'red';
  return s;
}

export function saveSettings(storage, s) {
  try {
    storage && storage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 못 해도 이번 판은 그대로 */
  }
}

/**
 * 발로란트 크로스헤어 코드 → 크로스헤어 설정.
 * 예: 0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0
 * 'P'(주 크로스헤어) 부분만 읽고, 모르는 키는 무시한다. 잘못된 코드면 null.
 */
export function parseCrosshairCode(code) {
  if (typeof code !== 'string') return null;
  const parts = code.trim().split(';').map((s) => s.trim());
  if (parts.length < 2) return null;
  const ch = JSON.parse(JSON.stringify(DEFAULT_CROSSHAIR));
  let section = null;
  let colorIdx = 0;
  let custom = null;
  let useCustom = false;
  let seen = 0;
  let i = 0;
  // 맨 앞의 버전 숫자는 건너뜀
  if (/^\d+$/.test(parts[0])) i = 1;
  for (; i < parts.length; i++) {
    const k = parts[i];
    if (k === 'P' || k === 'A' || k === 'S') {
      section = k;
      continue;
    }
    if (section !== 'P' && section !== null) {
      i++; // 다른 섹션 값 건너뜀
      continue;
    }
    const v = parts[i + 1];
    if (v === undefined) break;
    i++;
    const num = Number(v);
    const on = v === '1';
    seen++;
    switch (k) {
      case 'c':
        colorIdx = num;
        useCustom = num === 8;
        break;
      case 'u':
        custom = v;
        break;
      case 'h':
        ch.outline = on;
        break;
      case 't':
        ch.outlineThickness = num;
        break;
      case 'o':
        ch.outlineOpacity = num;
        break;
      case 'd':
        ch.dot = on;
        break;
      case 'z':
        ch.dotThickness = num;
        break;
      case 'a':
        ch.dotOpacity = num;
        break;
      case 'f':
        ch.fade = on; // 발로 코드의 f = 사격 오차에 따라 조준선 흐리게
        break;
      case 'b':
        // 'b' (발로 코드의 다른 옵션) — 무시
        break;
      default: {
        const m = /^([01])([a-z])$/.exec(k);
        if (!m) break;
        const line = m[1] === '0' ? ch.inner : ch.outer;
        switch (m[2]) {
          case 'b':
            line.show = on;
            break;
          case 't':
            line.thickness = num;
            break;
          case 'l':
            line.length = num;
            break;
          case 'v':
            line.vlength = num;
            break;
          case 'g':
            if (!on) line.vlength = null;
            break;
          case 'o':
            line.offset = num;
            break;
          case 'a':
            line.opacity = num;
            break;
          case 'm':
            line.moveError = on;
            break;
          case 'f':
            line.fireError = on;
            break;
          case 'e':
            line.fireMult = num; // 사격 오차 배율 (0~3)
            break;
          case 's':
            line.moveMult = num; // 이동 오차 배율 (0~3)
            break;
          default:
            break;
        }
      }
    }
  }
  if (seen === 0 && section === null) return null;
  if (useCustom && custom && /^[0-9a-fA-F]{6,8}$/.test(custom)) ch.color = `#${custom.slice(0, 6)}`;
  else if (colorIdx >= 0 && colorIdx < CROSSHAIR_COLORS.length) ch.color = CROSSHAIR_COLORS[colorIdx];
  return ch;
}
