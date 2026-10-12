// HUD: 발로란트 화면 배치 그대로 — 미니맵(왼쪽 위), 남은 시간·킬(위 가운데), 킬 피드(오른쪽 위),
// 방어구·체력 | 스킬 | 탄약(아래), 무기 목록(오른쪽 아래), 맞은 방향 표시, 사망 화면, 점수판(Tab), 큰 지도(Caps Lock).
// 발로처럼 데미지 숫자·히트마커는 없다 (연습 도움 설정에서만 켬).
import { HFOV, AGENTS, VANDAL, DM } from '../sim/valorant.js';
import { paintCrosshair } from './crosshair.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const REF_H = 1080;

// 미니맵 그림(assets/bind_minimap.svg) ↔ 게임 좌표(m): 발로 미니맵 UV 와 같은 변환
const SVG_M = 169.4915 / 462.5025; // SVG 1칸 = 0.3665 m
const SVG_X0 = 40.987741089 * SVG_M; // SVG (0,0) 의 게임 x
const SVG_Y0 = 169.4915 + 12.824899665 * SVG_M; // SVG (0,0) 의 게임 y
const SVG_W = 416;
const SVG_H = 474;

const agentName = (key) => (AGENTS.find((a) => a.key === key) || { name: key }).name;
const agentIcon = (key) => `assets/agents/${key}.webp`;

const HEADSHOT_SVG =
  '<svg class="hs" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="8" r="5.2" fill="none" stroke="#fff" stroke-width="2"/><path d="M5 18c1-3 3-4.4 5-4.4s4 1.4 5 4.4" fill="none" stroke="#fff" stroke-width="2"/><path d="M10 1v4M10 11v3M3 8h4M13 8h4" stroke="#fff" stroke-width="1.6"/></svg>';

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 값이 바뀔 때만 DOM 을 건드리는 작은 도우미 */
function textSetter(el) {
  let last;
  return (v) => {
    if (v !== last) {
      last = v;
      el.textContent = v;
    }
  };
}
function classSetter(el, cls) {
  let last;
  return (on) => {
    on = !!on;
    if (on !== last) {
      last = on;
      el.classList.toggle(cls, on);
    }
  };
}

/** SVG 미니맵을 발로 미니맵처럼 (밝은 회색 반투명 바닥, 흰 테두리) 다시 칠해서 이미지로 */
async function loadMapImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`미니맵 그림을 못 받음: ${res.status}`);
  let svg = await res.text();
  svg = svg
    // 텔레포터끼리 잇는 긴 선은 발로 미니맵에 없음
    .replace(/<path[^>]*fill="white" fill-opacity="0\.48"[^>]*\/>/g, '')
    .replaceAll('#271406', '#c9cfd6') // 바닥
    .replaceAll('#F08234', '#ffffff') // 사이트
    .replaceAll('#B27C40', '#f4f6f8'); // 테두리
  const img = new Image();
  img.decoding = 'async';
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  return img;
}

/** 이미지를 pxPerM 배율로 미리 그려 둔 캔버스 (매 프레임 SVG 를 다시 그리지 않게) */
function rasterMap(img, pxPerM) {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(SVG_W * SVG_M * pxPerM);
  cv.height = Math.ceil(SVG_H * SVG_M * pxPerM);
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

export function createHud(map, settings) {
  const S = settings;
  const stage = $('stage');
  const els = {
    hp: textSetter($('hp-num')),
    armor: textSetter($('armor-num')),
    ammo: textSetter($('ammo-num')),
    res: textSetter($('ammo-res')),
    time: textSetter($('tb-time')),
    goal: textSetter($('tb-goal')),
    me: textSetter($('tb-me')),
    lead: textSetter($('tb-lead')),
    region: textSetter($('region')),
    fps: textSetter($('fps')),
  };
  const cls = {
    low: classSetter($('health'), 'low'),
    heal: classSetter($('health'), 'heal'),
    noArmor: classSetter($('health').querySelector('.armor'), 'none'),
    ammoLow: classSetter($('ammo'), 'low'),
    knife: classSetter($('ammo'), 'knife'),
    timerLow: classSetter(document.querySelector('.tb-timer'), 'low'),
    solo: classSetter($('topbar'), 'solo'),
    weaponsFaded: classSetter($('weapons'), 'faded'),
    regionHidden: classSetter($('region'), 'hidden'),
    fpsHidden: classSetter($('fps'), 'hidden'),
    minimapHidden: classSetter($('minimap-wrap'), 'hidden'),
    protect: classSetter($('protect'), 'hidden'),
  };
  const hpFill = $('hp-fill');
  let lastHpPct = -1;
  const meAgentImg = $('tb-me-agent');
  const leadAgentImg = $('tb-lead-agent');
  let leadAgent = '';

  // ── 화면 크기: 1080 기준 무대 배율 ──
  let scale = 1;
  function layout() {
    scale = window.innerHeight / REF_H;
    document.documentElement.style.setProperty('--s', String(scale));
    applyAdjust();
  }
  /** HUD 위치 맞추기 값 적용 (요소별 이동·배율) */
  function applyAdjust() {
    for (const el of stage.querySelectorAll('.hud-el')) {
      const a = (S.hudAdjust || {})[el.dataset.el];
      el.style.translate = a ? `${a.x || 0}px ${a.y || 0}px` : '';
      el.style.scale = a && a.s && a.s !== 1 ? String(a.s) : '';
    }
  }
  window.addEventListener('resize', layout);
  layout();

  // ── 스킬 칸 (데스매치에선 못 씀 → 회색) ──
  let abilityAgent = '';
  function buildAbilities() {
    if (abilityAgent === S.agent) return;
    abilityAgent = S.agent;
    const keys = ['C', 'Q', 'E', 'X'];
    $('abilities').innerHTML = keys
      .map((k, i) => {
        const pips = i === 3 ? '<i></i>'.repeat(7) : '<i></i>'.repeat(i === 1 ? 1 : 2);
        return `<div class="ab${i === 3 ? ' ult' : ''}"><div class="pips">${pips}</div><img src="assets/agents/${S.agent}-${i + 1}.webp" alt=""><span>${k}</span></div>`;
      })
      .join('');
    meAgentImg.src = agentIcon(S.agent);
  }
  buildAbilities();

  // ── 무기 목록: 바꾸면 잠깐 밝게, 3초 뒤 흐리게 ──
  let curWeapon = '';
  let weaponT = 0;
  const slots = [...$('weapons').querySelectorAll('.slot')];

  // ── 미니맵 ──
  const mini = $('minimap');
  const mg = mini.getContext('2d');
  let mapImg = null;
  let miniRaster = null;
  let miniRasterScale = 0;
  let bigRaster = null;
  let bigRasterScale = 0;
  const agentImgs = new Map();
  function agentImg(key) {
    let im = agentImgs.get(key);
    if (!im) {
      im = new Image();
      im.src = agentIcon(key);
      agentImgs.set(key, im);
    }
    return im;
  }
  loadMapImage('assets/bind_minimap.svg')
    .then((img) => {
      mapImg = img;
    })
    .catch((e) => console.warn(e));
  let reveal = null; // { t, bots: [{x,y,agent}] }

  /** 동그란 요원 아이콘 + 테두리 */
  function drawIcon(g, x, y, r, key, ring, alpha = 1) {
    g.save();
    g.globalAlpha = alpha;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(15,25,35,0.85)';
    g.fill();
    const im = agentImg(key);
    if (im.complete && im.naturalWidth) {
      g.save();
      g.clip();
      g.drawImage(im, x - r, y - r, r * 2, r * 2);
      g.restore();
    }
    g.lineWidth = Math.max(1.5, r * 0.18);
    g.strokeStyle = ring;
    g.stroke();
    g.restore();
  }

  function drawMinimap(st) {
    const mm = S.minimap || {};
    const box = 300 * (mm.size || 1);
    const wrap = $('minimap-wrap');
    if (wrap.style.width !== `${box}px`) {
      wrap.style.width = `${box}px`;
      wrap.style.height = `${box}px`;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1) * scale;
    const W = Math.round(box * dpr);
    if (mini.width !== W) {
      mini.width = W;
      mini.height = W;
    }
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.clearRect(0, 0, W, W);
    if (!mapImg) return;
    const rotate = mm.rotate !== false;
    const centered = rotate || mm.centered !== false;
    // 확대: 플레이어 중심이면 80m 폭이 기본(확대 1.0), 아니면 맵 전체
    const fullM = Math.max(SVG_W, SVG_H) * SVG_M;
    const pxPerM = centered ? (W / 80) * (mm.zoom || 1) : W / fullM;
    if (!miniRaster || Math.abs(miniRasterScale - pxPerM) > 0.01) {
      miniRaster = rasterMap(mapImg, pxPerM);
      miniRasterScale = pxPerM;
    }
    const toPx = (x, y) => [(x - SVG_X0) * pxPerM, (SVG_Y0 - y) * pxPerM];
    mg.save();
    if (centered) {
      mg.translate(W / 2, W / 2);
      if (rotate) mg.rotate(-st.heading * DEG);
      const [px, py] = toPx(st.x, st.y);
      mg.translate(-px, -py);
    } else {
      mg.translate((W - miniRaster.width) / 2, (W - miniRaster.height) / 2);
    }
    mg.globalAlpha = 0.72;
    mg.drawImage(miniRaster, 0, 0);
    mg.globalAlpha = 1;
    // 적: 보일 때만 (+ 부활할 때 잠깐 전부)
    const r = 11 * dpr;
    const iconAt = (x, y, key, a) => {
      const [bx, by] = toPx(x, y);
      // 회전해도 아이콘은 똑바로
      mg.save();
      mg.translate(bx, by);
      if (rotate) mg.rotate(st.heading * DEG);
      drawIcon(mg, 0, 0, r, key, st.enemyColor, a);
      mg.restore();
    };
    if (reveal) {
      const a = Math.max(0, 1 - reveal.t / 2.5);
      for (const b of reveal.bots) iconAt(b.x, b.y, b.agent, a);
    }
    for (const b of st.bots) if (b.alive && b.visible) iconAt(b.mover.x, b.mover.y, b.agent || 'jett', 1);
    // 나: 시야 + 아이콘
    const [mx, my] = toPx(st.x, st.y);
    mg.translate(mx, my);
    mg.rotate(st.heading * DEG);
    if (mm.cones !== false) {
      const half = (HFOV / 2) * DEG;
      const len = 70 * dpr;
      const grad = mg.createRadialGradient(0, 0, 0, 0, 0, len);
      grad.addColorStop(0, 'rgba(255,255,255,0.32)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      mg.fillStyle = grad;
      mg.beginPath();
      mg.moveTo(0, 0);
      mg.arc(0, 0, len, -Math.PI / 2 - half, -Math.PI / 2 + half);
      mg.closePath();
      mg.fill();
    }
    mg.rotate(-st.heading * DEG);
    drawIcon(mg, 0, 0, r, S.agent, '#f2e05a');
    // 바라보는 방향 작은 삼각형
    mg.rotate(st.heading * DEG);
    mg.fillStyle = '#f2e05a';
    mg.beginPath();
    mg.moveTo(0, -r - 6 * dpr);
    mg.lineTo(4 * dpr, -r - 1 * dpr);
    mg.lineTo(-4 * dpr, -r - 1 * dpr);
    mg.closePath();
    mg.fill();
    mg.restore();
  }

  // ── 큰 지도 (Caps Lock 누르고 있기) ──
  const bigCanvas = $('bigmap-canvas');
  function drawBigMap(st) {
    if (!mapImg) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const side = Math.min(window.innerWidth - 40, window.innerHeight - 40);
    const fullM = Math.max(SVG_W, SVG_H) * SVG_M;
    const pxPerM = (side * dpr) / fullM;
    if (!bigRaster || Math.abs(bigRasterScale - pxPerM) > 0.01) {
      bigRaster = rasterMap(mapImg, pxPerM);
      bigRasterScale = pxPerM;
    }
    const W = Math.round(side * dpr);
    if (bigCanvas.width !== W) {
      bigCanvas.width = W;
      bigCanvas.height = W;
      bigCanvas.style.width = `${side}px`;
      bigCanvas.style.height = `${side}px`;
    }
    const g = bigCanvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    const ox = (W - bigRaster.width) / 2;
    const oy = (W - bigRaster.height) / 2;
    g.globalAlpha = 0.85;
    g.drawImage(bigRaster, ox, oy);
    g.globalAlpha = 1;
    const toPx = (x, y) => [ox + (x - SVG_X0) * pxPerM, oy + (SVG_Y0 - y) * pxPerM];
    if (S.regionNames !== false) {
      g.font = `600 ${Math.round(14 * dpr)}px Barlow, 'Malgun Gothic', sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const reg of map.regions) {
        const [x, y] = toPx(reg.at[0], reg.at[1]);
        g.fillStyle = 'rgba(0,0,0,0.65)';
        g.fillText(reg.label, x + dpr, y + dpr);
        g.fillStyle = '#ece8e1';
        g.fillText(reg.label, x, y);
      }
    }
    const r = 13 * dpr;
    for (const b of st.bots) {
      if (!b.alive || !b.visible) continue;
      const [x, y] = toPx(b.mover.x, b.mover.y);
      drawIcon(g, x, y, r, b.agent || 'jett', st.enemyColor);
    }
    const [x, y] = toPx(st.x, st.y);
    g.save();
    g.translate(x, y);
    g.rotate(st.heading * DEG);
    const half = (HFOV / 2) * DEG;
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 90 * dpr, -Math.PI / 2 - half, -Math.PI / 2 + half);
    g.closePath();
    g.fill();
    g.restore();
    drawIcon(g, x, y, r, S.agent, '#f2e05a');
  }

  // ── 크로스헤어: 화면 전체 캔버스, 지난번 그린 범위만 지움 ──
  const ch = $('crosshair');
  const chg = ch.getContext('2d');
  let lastExtent = Infinity;
  function drawCrosshair(cfg, fireErr, moveErr, pxPerDeg, spreadDeg, showSpread, visible = true) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (ch.width !== Math.round(W * dpr) || ch.height !== Math.round(H * dpr)) {
      ch.width = Math.round(W * dpr);
      ch.height = Math.round(H * dpr);
      ch.style.width = `${W}px`;
      ch.style.height = `${H}px`;
      lastExtent = Infinity;
    }
    chg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    if (lastExtent === Infinity) chg.clearRect(0, 0, W, H);
    else chg.clearRect(cx - lastExtent, cy - lastExtent, lastExtent * 2, lastExtent * 2);
    if (!visible) {
      lastExtent = 0;
      return;
    }
    let extent = paintCrosshair(chg, cx, cy, cfg, fireErr * pxPerDeg, moveErr * pxPerDeg);
    if (showSpread && spreadDeg > 0) {
      const r = Math.max(1, spreadDeg * pxPerDeg);
      chg.strokeStyle = 'rgba(255,80,80,0.6)';
      chg.lineWidth = 1;
      chg.beginPath();
      chg.arc(cx, cy, r, 0, Math.PI * 2);
      chg.stroke();
      extent = Math.max(extent, r + 1);
    }
    lastExtent = Math.ceil(extent) + 4;
  }

  // ── 맞은 방향 (화면 가운데 둘레의 빨간 호, 1초) ──
  const arcs = $('dmg-arcs');
  const ag = arcs.getContext('2d');
  const hits = []; // { from:[x,y], t }
  let arcsDirty = false;
  function drawArcs(st, dt) {
    for (const h of hits) h.t += dt;
    while (hits.length && hits[0].t > 1) hits.shift();
    if (!hits.length && !arcsDirty) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const R = 150 * scale;
    const size = Math.ceil((R + 20) * 2);
    if (arcs.width !== Math.round(size * dpr)) {
      arcs.width = Math.round(size * dpr);
      arcs.height = Math.round(size * dpr);
      arcs.style.width = `${size}px`;
      arcs.style.height = `${size}px`;
    }
    ag.setTransform(dpr, 0, 0, dpr, 0, 0);
    ag.clearRect(0, 0, size, size);
    arcsDirty = hits.length > 0;
    for (const h of hits) {
      const bearing = Math.atan2(h.from[0] - st.x, h.from[1] - st.y) / DEG;
      const rel = (bearing - st.heading) * DEG; // 0 = 정면(위)
      const a = 0.85 * Math.max(0, 1 - h.t);
      ag.strokeStyle = `rgba(255,70,85,${a})`;
      ag.lineWidth = 6 * scale;
      ag.beginPath();
      const c = rel - Math.PI / 2;
      ag.arc(size / 2, size / 2, R, c - 22 * DEG, c + 22 * DEG);
      ag.stroke();
    }
  }

  // ── 킬 피드 ──
  const feed = $('killfeed');
  /** [죽인 사람 아이콘 이름] [총 (헤드샷)] [죽은 사람 이름 아이콘] — 나는 청록, 나머지(데스매치는 전부 적)는 빨강 */
  function addFeed({ killer, victim, head }) {
    const team = (p) => (p.me ? 'ally' : 'enemy');
    const icon = (p) => `<img src="${agentIcon(p.agent)}" alt="">`;
    const el = document.createElement('div');
    el.className = `kf${killer.me || victim.me ? ' mine' : ''}`;
    el.innerHTML =
      `<div class="side ${team(killer)}">${icon(killer)}<span>${killer.name}</span></div>` +
      `<div class="mid"><img class="gun" src="assets/icons/vandal.png" alt="">${head ? HEADSHOT_SVG : ''}</div>` +
      `<div class="side ${team(victim)}"><span>${victim.name}</span>${icon(victim)}</div>`;
    feed.prepend(el);
    while (feed.children.length > 6) feed.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 5000);
    setTimeout(() => el.remove(), 5300);
  }

  // ── 사망 화면 ──
  const deathEl = $('death');
  let deathBar = null;
  function showDeath(info) {
    if (!info) {
      deathEl.classList.add('hidden');
      $('death-tint').classList.remove('on');
      deathBar = null;
      return;
    }
    const k = info.killer;
    const taken = info.taken || { dmg: 0, head: 0, body: 0, leg: 0 };
    const dealt = info.dealt || { dmg: 0, head: 0, body: 0, leg: 0 };
    deathEl.innerHTML = `
      <div class="by">처치한 적</div>
      <div class="killer"><img class="agent" src="${agentIcon(k.agent)}" alt=""><b>${k.name}</b><img class="gun" src="assets/icons/vandal.png" alt=""></div>
      <div class="report">
        <div><h4>받은 피해</h4>${taken.dmg} · 머리 ${taken.head} / 몸 ${taken.body} / 다리 ${taken.leg}</div>
        <div><h4>준 피해</h4>${dealt.dmg} · 머리 ${dealt.head} / 몸 ${dealt.body} / 다리 ${dealt.leg}</div>
      </div>
      <div class="bar"><i></i></div>`;
    deathBar = deathEl.querySelector('.bar i');
    deathEl.classList.remove('hidden');
    $('death-tint').classList.add('on');
  }

  // ── 점수판 ──
  const board = $('scoreboard');
  function renderBoard(st) {
    const rows = [{ me: true, name: S.playerName || '나', agent: S.agent, k: st.match.kills, d: st.match.deaths }];
    for (const b of st.bots) rows.push({ name: b.name, agent: b.agent, k: b.kills || 0, d: b.deaths || 0 });
    rows.sort((a, b) => b.k - a.k || a.d - b.d || (a.me ? -1 : b.me ? 1 : 0));
    const dm = st.mode === 'dm';
    const right = dm ? (st.match.endless ? '끝없이' : `${fmtClock(st.match.timeLeft)} 남음 · 먼저 ${st.match.target}킬`) : '';
    const title = { dm: '데스매치', hold: '각 잡기', duel: '1:1 스트레이프', free: '맵 둘러보기' }[st.mode] || '';
    let html = `<header><h2>${title} · 바인드</h2><span>${right}</span></header>
      <table><thead><tr><th>#</th><th></th><th>플레이어</th><th>처치</th><th>사망</th><th>지원</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      html += `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><img src="${agentIcon(r.agent)}" alt=""></td><td class="name">${r.name}</td><td class="k">${r.k}</td><td>${r.d}</td><td>0</td></tr>`;
    });
    html += '</tbody></table>';
    if (S.showPracticeStats !== false) html += practiceStats(st.stats, st.elapsed);
    board.innerHTML = html;
  }
  function fmtMs(arr) {
    if (!arr.length) return '-';
    return `${Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1000)}ms`;
  }
  function practiceStats(sts, elapsed) {
    const acc = sts.shots ? Math.round((sts.hits / sts.shots) * 100) : 0;
    const hs = sts.hits ? Math.round((sts.head / sts.hits) * 100) : 0;
    const still = sts.shots ? Math.round((sts.accurateShots / sts.shots) * 100) : 0;
    const fsh = sts.firstShots ? Math.round((sts.firstShotHeads / sts.firstShots) * 100) : 0;
    const kpm = elapsed > 5 ? (sts.kills / (elapsed / 60)).toFixed(1) : '-';
    return `<div class="practice"><h3>내 기록 · ${Math.floor(elapsed / 60)}분 ${Math.floor(elapsed % 60)}초 (Backspace 초기화)</h3>
      <div><b>${acc}%</b><span>명중률 ${sts.hits}/${sts.shots}</span></div>
      <div><b>${hs}%</b><span>헤드샷 비율</span></div>
      <div><b>${fsh}%</b><span>첫 발 헤드샷</span></div>
      <div><b>${still}%</b><span>멈춰서 쏜 비율</span></div>
      <div><b>${kpm}</b><span>분당 킬</span></div>
      <div><b>${fmtMs(sts.reactions)}</b><span>보이고 → 킬</span></div>
      <div><b>${fmtMs(sts.ttks)}</b><span>첫 명중 → 킬</span></div>
      <div><b>${sts.head}/${sts.body}/${sts.leg}</b><span>머리/몸/다리</span></div>
      <div><b>${sts.kills}</b><span>킬</span></div>
      <div><b>${sts.deaths}</b><span>죽음</span></div></div>`;
  }
  let boardOn = false;
  let boardT = 0;

  // ── 경기 끝 ──
  const endEl = $('matchend');
  function showMatchEnd(info) {
    if (!info) {
      endEl.classList.add('hidden');
      return;
    }
    endEl.innerHTML = `<h1 class="${info.win ? 'win' : 'lose'}">${info.win ? '승리' : '패배'}</h1>
      <p>${info.place}위 / ${info.players} · ${info.kills}킬 ${info.deaths}데스</p>
      <small>클릭하거나 Space 를 누르면 다시 시작</small>`;
    endEl.classList.remove('hidden');
  }

  let toastT = 0;
  let healT = 0;

  return {
    layout,
    applyAdjust,
    drawCrosshair,
    /** 매 프레임 */
    update(st, dt) {
      buildAbilities();
      // 체력·방어구
      const hp = Math.max(0, Math.ceil(st.hp));
      els.hp(String(hp));
      els.armor(String(Math.max(0, Math.ceil(st.armor))));
      cls.noArmor(st.armor <= 0);
      cls.low(st.alive && hp <= 30);
      const pct = Math.round(Math.min(100, (hp / 100) * 100));
      if (pct !== lastHpPct) {
        lastHpPct = pct;
        hpFill.style.width = `${pct}%`;
      }
      if (healT > 0) healT -= dt;
      cls.heal(healT > 0);
      // 탄약
      cls.knife(st.knife);
      els.ammo(String(st.ammo));
      els.res(st.reserve === Infinity ? '∞' : String(st.reserve));
      cls.ammoLow(!st.knife && st.ammo <= Math.floor(VANDAL.mag * 0.3));
      // 무기 목록
      if (st.weapon !== curWeapon) {
        curWeapon = st.weapon;
        weaponT = 0;
        for (const s of slots) s.classList.toggle('on', s.dataset.w === st.weapon);
      }
      weaponT += dt;
      cls.weaponsFaded(weaponT > 3);
      // 위쪽 가운데
      const m = st.match;
      const dm = st.mode === 'dm';
      cls.solo(!dm);
      if (dm) {
        els.time(m.endless ? '∞' : fmtClock(m.timeLeft));
        els.goal(m.endless ? '' : String(m.target));
        cls.timerLow(!m.endless && m.timeLeft <= 30);
        // 오른쪽: 나를 뺀 1등 (내가 1등이면 자연히 2등)
        let lead = null;
        for (const b of st.bots) if (!lead || (b.kills || 0) > (lead.kills || 0)) lead = b;
        els.lead(String(lead ? lead.kills || 0 : 0));
        const la = lead ? lead.agent : '';
        if (la !== leadAgent) {
          leadAgent = la;
          leadAgentImg.src = la ? agentIcon(la) : '';
        }
      } else {
        els.time(fmtClock(st.elapsed));
        els.goal('');
        cls.timerLow(false);
      }
      els.me(String(m.kills));
      // 미니맵
      cls.minimapHidden(S.showMinimap === false);
      if (reveal) {
        reveal.t += dt;
        if (reveal.t > 2.5) reveal = null;
      }
      if (S.showMinimap !== false) drawMinimap(st);
      // 큰 지도
      $('bigmap').classList.toggle('hidden', !st.bigMap);
      if (st.bigMap) drawBigMap(st);
      drawArcs(st, dt);
      // 위치 이름·FPS (연습 도움)
      cls.regionHidden(!S.showRegion);
      if (S.showRegion) els.region(st.region || '');
      cls.fpsHidden(!S.showFps);
      if (S.showFps) els.fps(st.fps ? `${st.fps} FPS` : '');
      cls.protect(!(st.protect > 0));
      // 사망 진행 막대
      if (deathBar) deathBar.style.width = `${Math.min(100, (st.deadFor / DM.respawn) * 100)}%`;
      // 점수판
      if (boardOn) {
        boardT -= dt;
        if (boardT <= 0) {
          boardT = 0.25;
          renderBoard(st);
        }
      }
      if (toastT > 0) {
        toastT -= dt;
        if (toastT <= 0) $('toast').classList.remove('show');
      }
    },
    /** 내가 킬: 킬 피드 */
    myKill(victim, head) {
      addFeed({ killer: { me: true, name: S.playerName || '나', agent: S.agent }, victim: { name: victim.name, agent: victim.agent }, head });
    },
    /** 내가 죽음: 킬 피드 + 사망 화면 */
    died(info) {
      const k = info.killer;
      addFeed({ killer: { name: k.name, agent: k.agent }, victim: { me: true, name: S.playerName || '나', agent: S.agent }, head: k.head });
      showDeath(info);
    },
    respawned() {
      showDeath(null);
    },
    /** 부활할 때 적 위치 잠깐 보여 주기 */
    reveal(bots) {
      reveal = { t: 0, bots };
    },
    hurt(from) {
      hits.push({ from, t: 0 });
    },
    heal() {
      healT = 0.6;
    },
    scoreboard(on, st) {
      boardOn = on;
      board.classList.toggle('hidden', !on);
      if (on && st) {
        renderBoard(st);
        boardT = 0.25;
      }
    },
    matchEnd: showMatchEnd,
    toast(text, sec = 1.6) {
      const el = $('toast');
      el.textContent = text;
      el.classList.add('show');
      toastT = sec;
    },
    damage(text, head) {
      const el = document.createElement('div');
      el.className = `dmg${head ? ' head' : ''}`;
      el.textContent = text;
      el.style.marginLeft = `${(Math.random() - 0.5) * 40}px`;
      stage.appendChild(el);
      setTimeout(() => el.remove(), 700);
    },
    clearFeed() {
      feed.innerHTML = '';
      hits.length = 0;
      arcsDirty = true;
      showDeath(null);
      showMatchEnd(null);
    },
  };
}
