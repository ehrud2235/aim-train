// 소리: 파일 없이 코드로 만든 효과음. 봇 발소리·총소리는 위치에 따라 왼쪽/오른쪽·거리감이 난다.
// (발로란트처럼 달리면 발소리가 나고, 걷기·앉기는 소리가 안 난다)

function noiseBuf(ctx, dur, fn) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) d[i] = fn(i / ctx.sampleRate, rnd);
  return buf;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let volume = 0.7;
  const bufs = {};

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    // 밴달 총소리: 날카로운 파열음 + 묵직한 저음
    let lp = 0;
    bufs.shot = noiseBuf(ctx, 0.28, (t, r) => {
      const crack = r() * Math.exp(-t * 55) * 0.9;
      lp += (r() - lp) * 0.08;
      const body = lp * Math.exp(-t * 14) * 2.2;
      const thump = Math.sin(2 * Math.PI * 78 * t) * Math.exp(-t * 22) * 0.9;
      return Math.max(-1, Math.min(1, crack + body + thump));
    });
    // 헤드샷 '팅'
    bufs.head = noiseBuf(ctx, 0.35, (t) => (Math.sin(2 * Math.PI * 2960 * t) * 0.6 + Math.sin(2 * Math.PI * 4420 * t) * 0.3) * Math.exp(-t * 13));
    // 몸 맞음 '퍽'
    let lp2 = 0;
    bufs.body = noiseBuf(ctx, 0.12, (t, r) => {
      lp2 += (r() - lp2) * 0.15;
      return lp2 * Math.exp(-t * 40) * 2;
    });
    // 킬
    bufs.kill = noiseBuf(ctx, 0.45, (t) => {
      const f = t < 0.09 ? 880 : 1320;
      return Math.sin(2 * Math.PI * f * t) * Math.exp(-((t < 0.09 ? t : t - 0.09) * 9)) * 0.5;
    });
    // 발소리
    let lp3 = 0;
    bufs.step = noiseBuf(ctx, 0.09, (t, r) => {
      lp3 += (r() - lp3) * 0.25;
      return lp3 * Math.exp(-t * 60) * 2.5 + Math.sin(2 * Math.PI * 110 * t) * Math.exp(-t * 70) * 0.5;
    });
    // 재장전 딸깍
    bufs.click = noiseBuf(ctx, 0.05, (t, r) => r() * Math.exp(-t * 180) * 0.8);
    // 텔레포트 '슈욱'
    bufs.tele = noiseBuf(ctx, 0.7, (t, r) => {
      const chirp = Math.sin(2 * Math.PI * (300 * t + 750 * t * t));
      return (chirp * 0.4 + r() * 0.25) * Math.sin(Math.PI * Math.min(1, t / 0.7));
    });
    // 문
    let lp4 = 0;
    bufs.door = noiseBuf(ctx, 0.4, (t, r) => {
      lp4 += (r() - lp4) * 0.05;
      return lp4 * 1.6 * Math.sin(Math.PI * (t / 0.4));
    });
    // 아픔
    bufs.hurt = noiseBuf(ctx, 0.15, (t) => Math.sin(2 * Math.PI * 160 * t) * Math.exp(-t * 25));
  }

  function play(name, { gain = 1, rate = 1, pos = null, listener = null } = {}) {
    if (!ctx || !bufs[name]) return;
    const src = ctx.createBufferSource();
    src.buffer = bufs[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (pos && listener) {
      // 듣는 사람 기준 위치 (오른쪽, 위, 앞)
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 120;
      const dx = pos[0] - listener.x;
      const dy = pos[1] - listener.y;
      const dz = pos[2] - listener.z;
      const h = (listener.heading * Math.PI) / 180;
      const right = dx * Math.cos(h) - dy * Math.sin(h);
      const fwd = dx * Math.sin(h) + dy * Math.cos(h);
      if (p.positionX) {
        p.positionX.value = right;
        p.positionY.value = dz;
        p.positionZ.value = -fwd;
      } else p.setPosition(right, dz, -fwd);
      g.connect(p);
      p.connect(master);
    } else g.connect(master);
    src.start();
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
    shot() {
      play('shot', { gain: 0.55, rate: 0.97 + Math.random() * 0.06 });
    },
    head() {
      play('head', { gain: 0.5 });
    },
    body() {
      play('body', { gain: 0.6 });
    },
    kill() {
      play('kill', { gain: 0.45 });
    },
    step(me, pos, listener) {
      if (me) play('step', { gain: 0.12, rate: 0.9 + Math.random() * 0.2 });
      else play('step', { gain: 0.9, rate: 0.85 + Math.random() * 0.2, pos, listener });
    },
    botShot(pos, listener) {
      play('shot', { gain: 0.7, rate: 0.93, pos, listener });
    },
    click(rate = 1) {
      play('click', { gain: 0.4, rate });
    },
    tele() {
      play('tele', { gain: 0.5 });
    },
    door() {
      play('door', { gain: 0.35 });
    },
    hurt() {
      play('hurt', { gain: 0.6 });
    },
    slash() {
      play('body', { gain: 0.2, rate: 2.2 });
    },
  };
}
