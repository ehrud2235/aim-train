// 소리: 실제 발로란트 소리 파일(assets/sounds, manifest.json)을 쓴다 — 총 스킨별 총소리·재장전 소리, 킬 효과별 1~5킬 소리.
// 파일이 없거나 아직 못 불러왔으면 코드로 만든 비슷한 소리로 대신한다.
// 적 총소리·발소리는 위치에 따라 왼쪽/오른쪽(HRTF)·거리감(멀수록 작고 먹먹하게)이 난다.

const BASE = 'assets/sounds/';

function noiseBuf(ctx, dur, fn) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) d[i] = fn(i / ctx.sampleRate, rnd);
  return buf;
}

/** 파일이 없을 때 쓰는 대체 소리 */
function makeFallbacks(ctx) {
  const b = {};
  let lp = 0;
  b.fire = noiseBuf(ctx, 0.28, (t, r) => {
    const crack = r() * Math.exp(-t * 55) * 0.9;
    lp += (r() - lp) * 0.08;
    return Math.max(-1, Math.min(1, crack + lp * Math.exp(-t * 14) * 2.2 + Math.sin(2 * Math.PI * 78 * t) * Math.exp(-t * 22) * 0.9));
  });
  b.head = noiseBuf(ctx, 0.3, (t) => (Math.sin(2 * Math.PI * 2960 * t) * 0.6 + Math.sin(2 * Math.PI * 4420 * t) * 0.3) * Math.exp(-t * 14));
  let lp2 = 0;
  b.body = noiseBuf(ctx, 0.12, (t, r) => {
    lp2 += (r() - lp2) * 0.15;
    return lp2 * Math.exp(-t * 40) * 2;
  });
  for (let k = 1; k <= 5; k++) {
    const f0 = 660 * Math.pow(2, (k - 1) * (2 / 12));
    b[`kill${k}`] = noiseBuf(ctx, 0.5, (t) => (Math.sin(2 * Math.PI * f0 * t) * 0.5 + Math.sin(2 * Math.PI * f0 * 1.5 * t) * 0.25) * Math.exp(-t * 7));
  }
  let lp3 = 0;
  b.step = noiseBuf(ctx, 0.09, (t, r) => {
    lp3 += (r() - lp3) * 0.25;
    return lp3 * Math.exp(-t * 60) * 2.5 + Math.sin(2 * Math.PI * 110 * t) * Math.exp(-t * 70) * 0.5;
  });
  b.click = noiseBuf(ctx, 0.05, (t, r) => r() * Math.exp(-t * 180) * 0.8);
  b.tele = noiseBuf(ctx, 0.7, (t, r) => (Math.sin(2 * Math.PI * (300 * t + 750 * t * t)) * 0.4 + r() * 0.25) * Math.sin(Math.PI * Math.min(1, t / 0.7)));
  b.heal = noiseBuf(ctx, 0.5, (t) => Math.sin(2 * Math.PI * (520 + 500 * t) * t) * Math.exp(-t * 5) * 0.4);
  b.hurt = noiseBuf(ctx, 0.15, (t) => Math.sin(2 * Math.PI * 160 * t) * Math.exp(-t * 25));
  let lp4 = 0;
  b.door = noiseBuf(ctx, 0.4, (t, r) => {
    lp4 += (r() - lp4) * 0.05;
    return lp4 * 1.6 * Math.sin(Math.PI * (t / 0.4));
  });
  return b;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let volume = 0.7;
  let fb = null;
  let manifest = null;
  const cache = new Map(); // 경로 → Promise<AudioBuffer|null>
  const ready = new Map(); // 경로 → AudioBuffer
  let sel = { gunSkin: 'default', killPack: 'auto' };
  let skin = null;
  let pack = null;
  const reloadTimers = [];

  const manifestP = fetch(`${BASE}manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((m) => {
      manifest = m;
      resolveSel();
      return m;
    });

  function resolveSel() {
    if (!manifest) return;
    const skins = manifest.vandalSkins || [];
    skin = skins.find((s) => s.id === sel.gunSkin) || skins[0] || null;
    const packs = manifest.killPacks || [];
    const want = sel.killPack === 'auto' ? skin && skin.killPack : sel.killPack;
    pack = packs.find((p) => p.id === want) || packs.find((p) => p.id === 'base') || packs[0] || null;
    if (ctx) preload();
  }

  function load(path) {
    if (!path || !ctx) return null;
    let p = cache.get(path);
    if (!p) {
      p = fetch(BASE + path)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => {
          ready.set(path, buf);
          return buf;
        })
        .catch((e) => {
          console.warn('소리 파일을 못 읽음', path, e);
          return null;
        });
      cache.set(path, p);
    }
    return p;
  }

  /** 지금 고른 총 스킨·킬 효과에 필요한 파일을 미리 디코딩 */
  function preload() {
    const list = [];
    if (skin) {
      list.push(skin.fire);
      for (const k of ['reload', 'equip']) for (const e of skin[k] || []) list.push(e.file);
      for (const f of Object.values(skin.byOriginalPath || {})) list.push(f);
    }
    if (pack) list.push(...(pack.kills || []), pack.headshotKill, pack.appear);
    if (manifest && manifest.hit) list.push(manifest.hit.head, manifest.hit.body);
    if (manifest && manifest.misc) {
      for (const v of Object.values(manifest.misc)) {
        if (Array.isArray(v)) list.push(...v);
        else if (typeof v === 'string') list.push(v);
      }
    }
    for (const p of list) if (p) load(p);
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = volume;
    // 너무 크게 겹칠 때 찢어지지 않게
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    master.connect(comp);
    comp.connect(ctx.destination);
    fb = makeFallbacks(ctx);
    preload();
  }

  /** buf: AudioBuffer, pos/listener 가 있으면 3D */
  function play(buf, { gain = 1, rate = 1, pos = null, listener = null, when = 0 } = {}) {
    if (!ctx || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (pos && listener) {
      const dx = pos[0] - listener.x;
      const dy = pos[1] - listener.y;
      const dz = pos[2] - listener.z;
      const dist = Math.hypot(dx, dy, dz);
      // 멀수록 고음이 깎임
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = Math.max(1800, 18000 * Math.exp(-dist / 45));
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.rolloffFactor = 1.0;
      p.maxDistance = 150;
      const h = (listener.heading * Math.PI) / 180;
      const right = dx * Math.cos(h) - dy * Math.sin(h);
      const fwd = dx * Math.sin(h) + dy * Math.cos(h);
      if (p.positionX) {
        p.positionX.value = right;
        p.positionY.value = dz;
        p.positionZ.value = -fwd;
      } else p.setPosition(right, dz, -fwd);
      g.connect(lpf);
      lpf.connect(p);
      p.connect(master);
    } else g.connect(master);
    src.start(when ? ctx.currentTime + when : 0);
    return src;
  }
  const real = (path) => (path ? ready.get(path) || null : null);
  const vary = (a = 0.03) => 1 - a + Math.random() * a * 2;

  function cancelReload() {
    for (const t of reloadTimers) clearTimeout(t);
    reloadTimers.length = 0;
  }

  return {
    init,
    resume() {
      init();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    setVolume(v) {
      volume = v;
      if (master) master.gain.value = v;
    },
    /** 총 스킨 · 킬 효과 고르기 ('auto' = 총 스킨에 딸린 킬 효과) */
    select(gunSkin, killPack) {
      sel = { gunSkin, killPack };
      resolveSel();
    },
    fire() {
      const b = real(skin && skin.fire);
      if (b) play(b, { gain: 0.62 * (skin.gain || 1), rate: vary(0.01) });
      else play(fb && fb.fire, { gain: 0.55, rate: vary() });
    },
    botFire(pos, listener) {
      const b = real(skin && skin.fire) || (fb && fb.fire);
      play(b, { gain: 0.85, rate: 0.97, pos, listener });
    },
    /** 내 총알이 적에게 맞음 */
    hit(part) {
      const h = manifest && manifest.hit;
      if (part === 'head') {
        const b = real(h && h.head);
        play(b || (fb && fb.head), { gain: b ? 0.7 : 0.45 });
      } else {
        const b = real(h && h.body);
        play(b || (fb && fb.body), { gain: b ? 0.6 : 0.55 });
      }
    },
    /** streak 번째 연속 킬 (5 이상은 5번 소리) */
    kill(streak, head) {
      const k = Math.max(1, Math.min(5, streak | 0));
      const p = pack;
      const hk = head && p && p.headshotKill ? real(p.headshotKill) : null;
      const b = real(p && p.kills && p.kills[k - 1]);
      if (b) play(b, { gain: 0.7 * ((p && p.gain) || 1) });
      else play(fb && fb[`kill${k}`], { gain: 0.4 });
      if (hk) play(hk, { gain: 0.6 * ((p && p.gain) || 1) });
    },
    /** 재장전 (총 모델 애니메이션 소리가 없을 때 쓰는 시간표) */
    reload(duration = 2.5) {
      cancelReload();
      const list = (skin && skin.reload) || [];
      const timed = list.filter((e) => e.at != null && real(e.file));
      if (timed.length) {
        for (const e of timed) reloadTimers.push(setTimeout(() => play(real(e.file), { gain: 0.6 }), Math.min(duration, e.at) * 1000));
        return;
      }
      play(fb && fb.click, { gain: 0.4, rate: 0.8 });
      reloadTimers.push(setTimeout(() => play(fb && fb.click, { gain: 0.4, rate: 1.1 }), duration * 440));
      reloadTimers.push(setTimeout(() => play(fb && fb.click, { gain: 0.4, rate: 0.7 }), duration * 840));
    },
    cancelReload,
    /** 총 모델 애니메이션의 소리 이벤트 (원래 모드 파일 경로) → 우리 파일. 낼 수 있으면 true */
    modelSound(originalPath) {
      if (!skin || !skin.byOriginalPath || !originalPath) return false;
      const key = originalPath.replace(/^sound\//, '').toLowerCase();
      const hit = Object.entries(skin.byOriginalPath).find(([k]) => k.toLowerCase() === key);
      const b = hit && real(hit[1]);
      if (!b) return false;
      play(b, { gain: 0.6 });
      return true;
    },
    get hasModelSounds() {
      return !!(skin && skin.byOriginalPath && Object.keys(skin.byOriginalPath).length);
    },
    equip() {
      cancelReload();
      const e = skin && skin.equip && skin.equip[0];
      const b = real(e && e.file);
      play(b || (fb && fb.click), { gain: b ? 0.6 : 0.4, rate: b ? 1 : 1.4 });
    },
    step(me, pos, listener) {
      const steps = manifest && manifest.misc && manifest.misc.footstep;
      const f = Array.isArray(steps) && steps.length ? real(steps[Math.floor(Math.random() * steps.length)]) : null;
      const b = f || (fb && fb.step);
      if (me) play(b, { gain: f ? 0.18 : 0.12, rate: vary(0.08) });
      else play(b, { gain: f ? 1.2 : 0.9, rate: vary(0.08), pos, listener });
    },
    tele() {
      const b = real(manifest && manifest.misc && manifest.misc.teleport);
      play(b || (fb && fb.tele), { gain: 0.5 });
    },
    heal() {
      const b = real(manifest && manifest.misc && manifest.misc.heal);
      play(b || (fb && fb.heal), { gain: 0.5 });
    },
    door() {
      play(fb && fb.door, { gain: 0.35 });
    },
    hurt() {
      play(fb && fb.hurt, { gain: 0.5 });
    },
    slash() {
      play(fb && fb.body, { gain: 0.2, rate: 2.2 });
    },
  };
}
