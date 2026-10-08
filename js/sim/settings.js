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
  firingErrorAll: true, // 연사 시 크로스헤어가 벌어짐 (전체 스위치)
  inner: { show: true, opacity: 0.8, length: 6, vlength: null, thickness: 2, offset: 3, moveError: false, fireError: true },
  outer: { show: true, opacity: 0.35, length: 2, vlength: null, thickness: 2, offset: 10, moveError: true, fireError: true },
};

export const DEFAULTS = {
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
  enemyColor: 'red',
  volume: 0.7,
  showSpeed: true,
  showSpread: false,
  showDamage: false,
  showTracers: true,
  viewmodel: true,
  infiniteReserve: true,
  mode: 'dm', // 'free' | 'dm' | 'hold' | 'duel'
  dmBots: 8,
  dmBehavior: 'mixed',
  hold: 'aSiteLamps',
  duel: 'bLong30',
  duelBehavior: 'strafe',
  fight: 'off', // 'off' | 'easy' | 'normal' | 'hard'
  showMinimap: true,
  fullscreen: true,
};

export const FIGHT_LEVELS = {
  off: { enabled: false },
  easy: { enabled: true, reaction: 0.55, accuracy: 0.18, headRate: 0.1 },
  normal: { enabled: true, reaction: 0.35, accuracy: 0.3, headRate: 0.2 },
  hard: { enabled: true, reaction: 0.22, accuracy: 0.45, headRate: 0.3 },
};

const KEY = 'valoaim.settings.v1';

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
  } catch {
    saved = null;
  }
  return deepMerge(DEFAULTS, saved);
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
        ch.firingErrorAll = on;
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
