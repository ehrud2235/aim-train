// HUD: 발로란트식 크로스헤어(코드 그대로), 체력·탄약, 미니맵, 위치 이름, 속도계, 킬 알림, 기록표.
import { K } from '../sim/mapgrid.js';
import { HFOV } from '../sim/valorant.js';

import { paintCrosshair } from './crosshair.js';

const $ = (id) => document.getElementById(id);

/** 미니맵 바탕 그림 (한 번만) */
function renderMapImage(map, scale) {
  const W = Math.ceil((map.x1 - map.x0) * scale);
  const H = Math.ceil((map.y1 - map.y0) * scale);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(map.nx, map.ny);
  for (let j = 0; j < map.ny; j++) {
    for (let i = 0; i < map.nx; i++) {
      const k = j * map.nx + i;
      const o = ((map.ny - 1 - j) * map.nx + i) * 4;
      const kd = map.kind[k];
      let c;
      if (kd === K.WALL) c = [0, 0, 0, 0];
      else if (kd === K.PROP || kd === K.RAIL) c = [70, 78, 92, 235];
      else if (kd === K.DOOR) c = [120, 130, 150, 235];
      else {
        const t = map.top[k];
        const v = 150 + Math.min(3, t) * 22;
        c = [v * 0.78, v * 0.86, v, 225];
      }
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = c[3];
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = map.nx;
  tmp.height = map.ny;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, W, H);
  // 텔레포터
  g.fillStyle = '#39d7ff';
  for (const t of map.teleporters) {
    const [x0, y0, x1, y1] = t.pad;
    g.fillRect((x0 - map.x0) * scale, (map.y1 - y1) * scale, (x1 - x0) * scale, (y1 - y0) * scale);
  }
  return cv;
}

export function createHud(map) {
  const ch = $('crosshair');
  const chg = ch.getContext('2d');
  const mini = $('minimap');
  const mg = mini.getContext('2d');
  const MINI_SCALE = 2.2; // px/m
  const mapImg = renderMapImage(map, MINI_SCALE);
  const bigCanvas = $('bigmap-canvas');
  let bigImg = null;
  let killStreakTimer = 0;
  let streak = 0;
  let toastT = 0;
  let hurtT = 0;

  function drawCrosshair(cfg, fireErr, moveErr, pxPerDeg, spreadDeg, showSpread) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = 220;
    if (ch.width !== S * dpr) {
      ch.width = S * dpr;
      ch.height = S * dpr;
      ch.style.width = `${S}px`;
      ch.style.height = `${S}px`;
    }
    chg.setTransform(dpr, 0, 0, dpr, 0, 0);
    chg.clearRect(0, 0, S, S);
    paintCrosshair(chg, S / 2, S / 2, cfg, fireErr * pxPerDeg, moveErr * pxPerDeg);
    if (showSpread && spreadDeg > 0) {
      chg.strokeStyle = 'rgba(255,80,80,0.6)';
      chg.lineWidth = 1;
      chg.beginPath();
      chg.arc(S / 2, S / 2, Math.max(1, spreadDeg * pxPerDeg), 0, Math.PI * 2);
      chg.stroke();
    }
  }

  function drawMinimap(state) {
    const S = mini.width;
    mg.clearRect(0, 0, S, S);
    mg.fillStyle = 'rgba(10,14,20,0.55)';
    mg.fillRect(0, 0, S, S);
    // 내 위치가 가운데 오도록 (북쪽 위 고정, 발로 기본값)
    const px = (state.x - map.x0) * MINI_SCALE;
    const py = (map.y1 - state.y) * MINI_SCALE;
    mg.save();
    mg.translate(S / 2 - px, S / 2 - py);
    mg.drawImage(mapImg, 0, 0);
    // 보이는 봇
    mg.fillStyle = state.enemyColor;
    for (const b of state.bots) {
      if (!b.alive || !b.visible) continue;
      mg.beginPath();
      mg.arc((b.mover.x - map.x0) * MINI_SCALE, (map.y1 - b.mover.y) * MINI_SCALE, 4, 0, Math.PI * 2);
      mg.fill();
    }
    mg.restore();
    // 나 (화살표 + 시야)
    const h = (state.heading * Math.PI) / 180;
    mg.save();
    mg.translate(S / 2, S / 2);
    mg.rotate(h);
    mg.fillStyle = 'rgba(255,255,255,0.13)';
    mg.beginPath();
    mg.moveTo(0, 0);
    const half = ((HFOV / 2) * Math.PI) / 180;
    mg.arc(0, 0, 60, -Math.PI / 2 - half, -Math.PI / 2 + half);
    mg.closePath();
    mg.fill();
    mg.fillStyle = '#ffe36b';
    mg.beginPath();
    mg.moveTo(0, -8);
    mg.lineTo(5.5, 6);
    mg.lineTo(0, 3);
    mg.lineTo(-5.5, 6);
    mg.closePath();
    mg.fill();
    mg.restore();
  }

  function drawBigMap(state) {
    const scale = Math.min((window.innerWidth - 80) / (map.x1 - map.x0), (window.innerHeight - 60) / (map.y1 - map.y0));
    const W = (map.x1 - map.x0) * scale;
    const H = (map.y1 - map.y0) * scale;
    if (!bigImg || bigImg.width !== Math.ceil(W)) bigImg = renderMapImage(map, scale);
    bigCanvas.width = Math.ceil(W);
    bigCanvas.height = Math.ceil(H);
    const g = bigCanvas.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.drawImage(bigImg, 0, 0);
    g.font = '600 13px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const r of map.regions) {
      const x = (r.at[0] - map.x0) * scale;
      const y = (map.y1 - r.at[1]) * scale;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillText(r.label, x + 1, y + 1);
      g.fillStyle = '#fff';
      g.fillText(r.label, x, y);
    }
    const x = (state.x - map.x0) * scale;
    const y = (map.y1 - state.y) * scale;
    g.save();
    g.translate(x, y);
    g.rotate((state.heading * Math.PI) / 180);
    g.fillStyle = '#ffe36b';
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = state.enemyColor;
    for (const b of state.bots) {
      if (!b.alive || !b.visible) continue;
      g.beginPath();
      g.arc((b.mover.x - map.x0) * scale, (map.y1 - b.mover.y) * scale, 5, 0, Math.PI * 2);
      g.fill();
    }
  }

  function fmtMs(arr) {
    if (!arr.length) return '-';
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return `${Math.round(avg * 1000)}ms`;
  }

  return {
    drawCrosshair,
    update(state, dt) {
      $('hp-num').textContent = Math.max(0, Math.ceil(state.hp));
      $('ammo-num').textContent = state.knife ? '—' : state.ammo;
      $('ammo-res').textContent = state.knife ? '' : `/ ${state.reserve === Infinity ? '∞' : state.reserve}`;
      $('weapon-name').textContent = state.knife ? '칼' : state.reloading ? '재장전…' : state.equipping ? '꺼내는 중…' : 'VANDAL';
      $('ammo').classList.toggle('low', !state.knife && state.ammo <= 5);
      if (state.showMinimap) drawMinimap(state);
      mini.parentElement.classList.toggle('hidden', !state.showMinimap);
      // 속도계: 정확 사격 가능 속도 이하면 초록
      const sp = $('speed');
      sp.classList.toggle('hidden', !state.showSpeed);
      if (state.showSpeed) {
        const frac = Math.min(1, state.speed / 6.75);
        $('speed-fill').style.width = `${frac * 100}%`;
        $('speed-thr').style.left = `${(state.threshold / 6.75) * 100}%`;
        sp.classList.toggle('ok', state.accurate);
        sp.classList.toggle('air', state.airborne);
        $('speed-txt').textContent = state.airborne ? '공중' : `${state.speed.toFixed(2)} m/s${state.accurate ? '  정확' : ''}`;
      }
      if (killStreakTimer > 0) {
        killStreakTimer -= dt;
        if (killStreakTimer <= 0) {
          streak = 0;
          $('banner').classList.remove('show');
        }
      }
      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) $('toast').classList.remove('show');
      }
      if (hurtT > 0) {
        hurtT -= dt;
        $('hurt').style.opacity = Math.max(0, hurtT / 0.4) * 0.55;
      }
      const big = $('bigmap');
      big.classList.toggle('hidden', !state.bigMap);
      if (state.bigMap) drawBigMap(state);
      $('region').textContent = state.region || '';
      $('fps').textContent = state.fps ? `${state.fps} FPS` : '';
      $('dead').classList.toggle('hidden', state.alive);
    },
    kill(head) {
      streak += 1;
      killStreakTimer = 2.2;
      const el = $('banner');
      el.innerHTML = `<span class="ring${head ? ' head' : ''}">${head ? '◎' : '✕'}</span><b>${streak > 1 ? `${streak}연속` : '킬'}</b>`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    },
    toast(text, sec = 1.6) {
      const el = $('toast');
      el.textContent = text;
      el.classList.add('show');
      toastT = sec;
    },
    hurt() {
      hurtT = 0.4;
    },
    damage(text, head) {
      const el = document.createElement('div');
      el.className = `dmg${head ? ' head' : ''}`;
      el.textContent = text;
      el.style.left = `${50 + (Math.random() - 0.5) * 4}%`;
      $('hud').appendChild(el);
      setTimeout(() => el.remove(), 700);
    },
    stats(st, elapsed) {
      const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
      const hs = st.hits ? Math.round((st.head / st.hits) * 100) : 0;
      const still = st.shots ? Math.round((st.accurateShots / st.shots) * 100) : 0;
      const fsh = st.firstShots ? Math.round((st.firstShotHeads / st.firstShots) * 100) : 0;
      const kpm = elapsed > 5 ? (st.kills / (elapsed / 60)).toFixed(1) : '-';
      $('stats').innerHTML = `
        <h3>기록 <small>${Math.floor(elapsed / 60)}분 ${Math.floor(elapsed % 60)}초 · Backspace 초기화</small></h3>
        <div class="grid">
          <div><b>${st.kills}</b><span>킬</span></div>
          <div><b>${kpm}</b><span>분당 킬</span></div>
          <div><b>${acc}%</b><span>명중률 (${st.hits}/${st.shots})</span></div>
          <div><b>${hs}%</b><span>헤드샷 비율</span></div>
          <div><b>${fsh}%</b><span>첫 발 헤드샷</span></div>
          <div><b>${still}%</b><span>멈춰서 쏜 비율</span></div>
          <div><b>${fmtMs(st.reactions)}</b><span>보이고 → 킬 (평균)</span></div>
          <div><b>${fmtMs(st.ttks)}</b><span>첫 명중 → 킬 (평균)</span></div>
          <div><b>${st.head}/${st.body}/${st.leg}</b><span>머리/몸/다리</span></div>
          <div><b>${st.deaths}</b><span>죽음</span></div>
        </div>`;
    },
    showStats(on) {
      $('stats').classList.toggle('hidden', !on);
    },
  };
}
