// 설정 메뉴 (Esc) — 발로란트 설정 화면 모양: 위쪽 탭(연습 · 일반 · 조작키 · 조준선 · 비디오 · 오디오), 줄마다 이름 | 조절.
// 바꾸면 바로 저장된다. 판을 새로 시작해야 하는 값은 onChange 의 reset 으로 알린다.
import { BIND } from '../sim/bind.js';
import { cmPer360, AGENTS } from '../sim/valorant.js';
import { parseCrosshairCode, DEFAULT_CROSSHAIR } from '../sim/settings.js';

const $ = (id) => document.getElementById(id);

// 바꾸면 판을 새로 시작해야 하는 설정
const RESET_KEYS = new Set(['mode', 'dmBots', 'dmBehavior', 'hold', 'duel', 'duelBehavior', 'fight', 'infiniteReserve', 'matchRules', 'botArmor', 'agent']);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, v) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = v;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const TABS = [
  ['practice', '연습'],
  ['general', '일반'],
  ['controls', '조작키'],
  ['crosshair', '조준선'],
  ['video', '비디오'],
  ['audio', '오디오'],
];

const MODES = [
  ['dm', '데스매치', '바인드 곳곳의 적 13명과 개인전. 먼저 40킬 또는 9분. 죽으면 1.5초 뒤 다른 곳에서 부활'],
  ['hold', '각 잡기', '실제 자리에서 각 보기. 적이 엄폐물 모서리에서 피킹'],
  ['duel', '1:1 스트레이프', '적 하나가 AD 무빙. 카운터 스트레이핑 하고 멈춰서 쏘기'],
  ['free', '맵 둘러보기', '적 없이 바인드 걷기. B 키로 보는 곳에 적 놓기'],
];

export function createMenu(settings, { onChange, onStart, onCalibrate, drawPreview }) {
  const root = $('menu');
  const S = settings;
  let tab = 'practice';
  let lists = { gunSkins: [{ id: 'default', name: '기본 밴달' }], killPacks: [{ id: 'base', name: '기본' }] };

  // ── 줄 만들기 ──
  const row = (label, ctl, note = '', show = '') =>
    `<div class="vrow"${show ? ` data-show="${show}"` : ''}><div class="lab">${label}${note ? `<small>${note}</small>` : ''}</div><div class="ctl">${ctl}</div></div>`;
  const seg = (k, opts) => {
    const cur = String(getPath(S, k));
    return `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${cur === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  };
  const onoff = (k, on = '켜기', off = '끄기') => seg(k, [[true, on], [false, off]]);
  const sel = (k, opts) => {
    const cur = String(getPath(S, k));
    return `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${cur === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  };
  const slider = (k, min, max, step) => {
    const v = getPath(S, k);
    return `<input type="number" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}">`;
  };
  const num = (k, min, max, step) => `<input type="number" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${getPath(S, k)}">`;

  function sens360() {
    const cm = cmPer360(S.dpi, S.sens);
    return `<span class="val" id="cm360">${cm.toFixed(1)} cm</span><span class="note" id="cm360n">${(cm / 2.54).toFixed(1)} 인치 · eDPI ${Math.round(S.dpi * S.sens)}</span>`;
  }

  function practiceTab() {
    return `
      <h3>모드</h3>
      <div class="modes">${MODES.map(([v, t, d]) => `<button type="button" class="mode${S.mode === v ? ' on' : ''}" data-mode="${v}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
      <h3 data-show="dm">데스매치</h3>
      ${row('규칙', seg('matchRules', [['valorant', '발로 그대로 (40킬 · 9:00)'], ['endless', '끝없이']]), '', 'dm')}
      ${row('적 수', slider('dmBots', 1, 16, 1), '발로 데스매치는 14명 (나 + 13)', 'dm')}
      ${row('적 움직임', sel('dmBehavior', [['mixed', '섞어서'], ['wander', '돌아다니며 각 잡기'], ['strafe', 'AD 스트레이프'], ['static', '가만히']]), '', 'dm')}
      <h3 data-show="hold duel">자리</h3>
      ${row('각 잡기 자리', sel('hold', BIND.holds.map((h) => [h.id, h.label])), '', 'hold')}
      ${row('1:1 자리', sel('duel', BIND.duels.map((d) => [d.id, d.label])), '', 'duel')}
      ${row('적 움직임', seg('duelBehavior', [['strafe', 'AD 스트레이프'], ['static', '가만히']]), '', 'duel')}
      <h3>연습장 옵션</h3>
      ${row('적 반격', seg('fight', [['off', '끔'], ['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']]), '끄면 적이 쏘지 않음 (에임만)')}
      ${row('적 방어구', onoff('botArmor'), '켜면 중방어구 (체력 100 + 50) — 밴달 몸 4발')}
      ${row('무한 탄약', onoff('infiniteReserve'), '예비 탄약이 줄지 않음 (재장전은 그대로)')}
      <h3>내 장비</h3>
      ${row('총 스킨', sel('gunSkin', lists.gunSkins.map((g) => [g.id, g.name])), '총 모양 · 총소리 · 재장전 소리')}
      ${row('킬 효과', sel('killEffect', [['auto', '총 스킨에 맞춤'], ...lists.killPacks.map((p) => [p.id, p.name])]), '킬 배너 그림과 킬 소리 (1~5킬)')}
      ${row('요원', sel('agent', AGENTS.map((a) => [a.key, a.name])), '미니맵·킬 피드·스킬 칸 아이콘')}
      ${row('이름', `<input type="text" data-k="playerName" maxlength="16" value="${esc(S.playerName)}">`)}
      <h3>연습 도움 (발로엔 없음)</h3>
      ${row('속도계', onoff('showSpeed'), '초록 = 정확하게 쏠 수 있는 속도 (카운터 스트레이핑)')}
      ${row('실제 퍼짐 원', onoff('showSpread'), '지금 쏘면 총알이 갈 수 있는 범위')}
      ${row('데미지 숫자', onoff('showDamage'))}
      ${row('지금 위치 이름', onoff('showRegion'), '미니맵 아래에 콜아웃 표시')}
      ${row('Tab 점수판에 내 기록', onoff('showPracticeStats'), '명중률 · 헤드샷 · 첫 발 헤드샷 · 반응 시간')}
      <h3>HUD 위치 맞추기</h3>
      ${row('내 발로 스크린샷과 맞추기', `<button type="button" class="vbtn" id="calib-open">맞추기 시작</button><button type="button" class="vbtn" id="calib-reset">처음 위치로</button>`, '1920×1080 발로 스크린샷을 겹쳐 놓고 HUD 요소를 끌어서 똑같은 자리로')}`;
  }

  function generalTab() {
    return `
      <h3>마우스</h3>
      ${row('감도: 조준', num('sens', 0.001, 10, 0.001), '발로 감도와 같은 값 (마우스 1카운트 = 0.07° × 감도)')}
      ${row('마우스 DPI', num('dpi', 100, 32000, 50))}
      ${row('360° 도는 거리', sens360(), '게임 중 F2 로 확인')}
      ${row('조준경 감도 배율', num('scopedMult', 0.1, 5, 0.01), '발로와 같은 값 (기본 1)')}
      ${row('마우스 반전', onoff('invertY'))}
      ${row('원시 입력 버퍼', onoff('rawInput'), '윈도우 마우스 가속·포인터 속도 무시 (크롬·엣지)')}
      ${row('브라우저 보정 배수', num('mouseScale', 0.1, 10, 0.01), '보통 1. 발로와 도는 양이 다르게 느껴질 때만')}
      <h3>접근성</h3>
      ${row('적 강조 색상', sel('enemyColor', [['red', '빨간색 (기본)'], ['purple', '보라색 (제3색맹)'], ['yellowD', '노란색 (제2색맹)'], ['yellowP', '노란색 (제1색맹)']]))}
      <h3>미니맵</h3>
      ${row('회전', seg('minimap.rotate', [[true, '회전'], [false, '고정']]))}
      ${row('플레이어 중심 유지', onoff('minimap.centered'), '고정일 때 끄면 맵 전체')}
      ${row('미니맵 크기', slider('minimap.size', 0.8, 1.2, 0.01))}
      ${row('미니맵 확대/축소', slider('minimap.zoom', 0.7, 1.4, 0.01))}
      ${row('미니맵 시야 표시', onoff('minimap.cones'))}
      ${row('큰 지도 지역 이름', onoff('regionNames', '항상', '안 함'))}
      <h3>기타</h3>
      ${row('피 표시', onoff('showBlood'))}
      ${row('총알 궤적 표시', onoff('showTracers'))}`;
  }

  function controlsTab() {
    const keys = [
      ['이동 / 걷기 / 앉기 / 점프', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>Shift</kbd> / <kbd>Ctrl</kbd> 또는 <kbd>C</kbd> / <kbd>Space</kbd>'],
      ['발사 / 정조준', '마우스 왼쪽 / 오른쪽'],
      ['재장전', '<kbd>R</kbd>'],
      ['주무기 / 근접 무기 / 이전 무기', '<kbd>1</kbd> / <kbd>3</kbd> / <kbd>Q</kbd>'],
      ['점수판', '<kbd>Tab</kbd> (누르고 있기)'],
      ['큰 지도', '<kbd>Caps Lock</kbd> 또는 <kbd>M</kbd> (누르고 있기)'],
      ['보는 곳에 적 놓기 / 지우기', '<kbd>B</kbd> / <kbd>N</kbd>'],
      ['처음 자리로 / 기록 초기화', '<kbd>F</kbd> / <kbd>Backspace</kbd>'],
      ['360° 감도 확인', '<kbd>F2</kbd>'],
      ['설정', '<kbd>Esc</kbd>'],
    ];
    return `
      <h3>방식</h3>
      ${row('정조준', seg('adsMode', [['hold', '누르고 있기'], ['toggle', '토글']]))}
      ${row('앉기', seg('crouchMode', [['hold', '누르고 있기'], ['toggle', '토글']]))}
      ${row('걷기', seg('walkMode', [['hold', '누르고 있기'], ['toggle', '토글']]))}
      <h3>키</h3>
      <table class="keys">${keys.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      <p class="hint">한글 입력 상태여도 키 위치 기준이라 그대로 됩니다. Ctrl+W 는 브라우저 탭 닫기라서 전체화면에서만 막을 수 있어요 — 앉기는 <kbd>C</kbd> 도 됩니다.</p>`;
  }

  function crosshairTab() {
    const c = S.crosshair;
    const line = (L, name) => `
      ${row(`${name} 표시`, onoff(`crosshair.${L}.show`))}
      ${row(`${name} 불투명도`, slider(`crosshair.${L}.opacity`, 0, 1, 0.01))}
      ${row(`${name} 길이`, slider(`crosshair.${L}.length`, 0, 20, 1))}
      ${row(`${name} 두께`, slider(`crosshair.${L}.thickness`, 0, 10, 1))}
      ${row(`${name} 간격`, slider(`crosshair.${L}.offset`, 0, 40, 1))}
      ${row(`${name} 이동 오차`, onoff(`crosshair.${L}.moveError`))}
      ${row(`${name} 사격 오차`, onoff(`crosshair.${L}.fireError`))}`;
    return `
      <div class="cross-wrap">
        <canvas id="cross-preview" width="200" height="200"></canvas>
        <div>
          <h3>프로필</h3>
          ${row('조준선 코드 가져오기', `<input type="text" id="cross-code" placeholder="0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0" value="${esc(S.crosshairCode || '')}"><button type="button" class="vbtn" id="cross-apply">가져오기</button>`, '발로 설정 → 조준선 → 프로필 코드 내보내기로 복사한 코드')}
          ${row('기본값으로', '<button type="button" class="vbtn" id="cross-reset">초기화</button>')}
          <h3>조준선</h3>
          ${row('조준선 색상', `<input type="color" data-k="crosshair.color" value="${c.color}">`)}
          ${row('외곽선', onoff('crosshair.outline'))}
          ${row('외곽선 불투명도', slider('crosshair.outlineOpacity', 0, 1, 0.01))}
          ${row('외곽선 두께', slider('crosshair.outlineThickness', 1, 6, 1))}
          ${row('중앙 점', onoff('crosshair.dot'))}
          ${row('중앙 점 불투명도', slider('crosshair.dotOpacity', 0, 1, 0.01))}
          ${row('중앙 점 두께', slider('crosshair.dotThickness', 1, 6, 1))}
          ${row('사격 오차에 따라 조준선 흐리게', onoff('crosshair.fade'))}
          <h3>안쪽 선</h3>${line('inner', '안쪽 선')}
          <h3>바깥쪽 선</h3>${line('outer', '바깥쪽 선')}
        </div>
      </div>`;
  }

  function videoTab() {
    return `
      <h3>일반</h3>
      ${row('전체화면으로 시작', onoff('fullscreen'), 'Ctrl+W 같은 브라우저 단축키를 막고 마우스가 화면 밖으로 안 나감')}
      ${row('시야각', '<span class="val">103</span>', '발로와 같은 가로 103° 고정 (정조준 1.25배)')}
      ${row('FPS 표시', onoff('showFps'))}
      <h3>그래픽 품질</h3>
      ${row('그림자', seg('shadows', [['off', '끔'], ['low', '낮음'], ['high', '높음']]), '바꾸면 새로고침해야 적용')}
      ${row('1인칭 총 모델', onoff('viewmodel'))}`;
  }

  function audioTab() {
    return `
      <h3>소리</h3>
      ${row('전체 음량', slider('volume', 0, 1, 0.01))}
      <p class="hint">총소리 · 킬 소리 · 재장전 소리는 연습 탭의 <b>총 스킨 / 킬 효과</b>에서 고릅니다.</p>`;
  }

  function render() {
    const body = { practice: practiceTab, general: generalTab, controls: controlsTab, crosshair: crosshairTab, video: videoTab, audio: audioTab };
    root.innerHTML = `
      <div class="top">
        <div class="brand"><b>발로 에임장</b><span>${BIND.label}</span></div>
        <nav>${TABS.map(([id, t]) => `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''}">${t}</button>`).join('')}</nav>
        <button type="button" class="vbtn primary" id="start">계속하기</button>
      </div>
      <div class="rule"></div>
      <div class="body"><div class="col">${TABS.map(([id]) => `<section data-tab="${id}" class="${tab === id ? 'on' : ''}">${body[id]()}</section>`).join('')}</div></div>`;
    bind();
    showModeRows();
    preview();
  }

  function showModeRows() {
    for (const el of root.querySelectorAll('[data-show]')) el.classList.toggle('hidden', !el.dataset.show.split(' ').includes(S.mode));
    for (const el of root.querySelectorAll('.mode')) el.classList.toggle('on', el.dataset.mode === S.mode);
  }

  function preview() {
    const cv = $('cross-preview');
    if (cv && drawPreview) drawPreview(cv, S.crosshair);
  }

  function changed(key) {
    const top = key.split('.')[0];
    onChange(S, { reset: RESET_KEYS.has(top), key });
    if (key === 'dpi' || key === 'sens') {
      const cm = cmPer360(S.dpi, S.sens);
      const a = $('cm360');
      const b = $('cm360n');
      if (a) a.textContent = `${cm.toFixed(1)} cm`;
      if (b) b.textContent = `${(cm / 2.54).toFixed(1)} 인치 · eDPI ${Math.round(S.dpi * S.sens)}`;
    }
    if (top === 'crosshair') {
      S.crosshairCode = '';
      preview();
    }
    if (top === 'mode') showModeRows();
  }

  /** 문자열 → 원래 값의 자료형 */
  function coerce(key, raw) {
    const cur = getPath(S, key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (typeof cur === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : cur;
    }
    return raw;
  }

  function bind() {
    $('start').onclick = () => onStart();
    for (const b of root.querySelectorAll('nav button')) {
      b.onclick = () => {
        tab = b.dataset.tab;
        for (const x of root.querySelectorAll('nav button, section')) x.classList.toggle('on', x.dataset.tab === tab);
      };
    }
    for (const b of root.querySelectorAll('.mode')) {
      b.onclick = () => {
        if (S.mode === b.dataset.mode) return;
        S.mode = b.dataset.mode;
        changed('mode');
      };
    }
    for (const g of root.querySelectorAll('.seg')) {
      const k = g.dataset.seg;
      for (const b of g.querySelectorAll('button')) {
        b.onclick = () => {
          setPath(S, k, coerce(k, b.dataset.v));
          for (const x of g.querySelectorAll('button')) x.classList.toggle('on', x === b);
          changed(k);
        };
      }
    }
    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      const handler = () => {
        let v;
        if (el.type === 'number' || el.type === 'range') {
          v = Number(el.value);
          if (!Number.isFinite(v)) return;
          if (el.min !== '' && v < Number(el.min)) return;
          if (el.max !== '' && v > Number(el.max)) return;
          // 같은 값을 쓰는 숫자칸·슬라이더 짝 맞추기
          for (const o of root.querySelectorAll(`[data-k="${k}"]`)) if (o !== el) o.value = String(v);
        } else if (el.tagName === 'SELECT') v = coerce(k, el.value);
        else v = el.value;
        if (k === 'playerName') v = String(v).trim().slice(0, 16) || '나';
        setPath(S, k, v);
        changed(k);
      };
      el.addEventListener(el.type === 'text' || el.tagName === 'SELECT' ? 'change' : 'input', handler);
      if (el.type === 'number') el.addEventListener('change', handler);
    }
    const apply = $('cross-apply');
    if (apply) {
      apply.onclick = () => {
        const code = $('cross-code').value.trim();
        const parsed = parseCrosshairCode(code);
        if (!parsed) {
          $('cross-code').classList.add('bad');
          return;
        }
        S.crosshair = parsed;
        S.crosshairCode = code;
        onChange(S, { reset: false, key: 'crosshair' });
        render();
      };
      $('cross-reset').onclick = () => {
        S.crosshair = structuredClone(DEFAULT_CROSSHAIR);
        S.crosshairCode = '';
        onChange(S, { reset: false, key: 'crosshair' });
        render();
      };
    }
    const co = $('calib-open');
    if (co) {
      co.onclick = () => onCalibrate && onCalibrate('open');
      $('calib-reset').onclick = () => {
        S.hudAdjust = {};
        onChange(S, { reset: false, key: 'hudAdjust' });
      };
    }
  }

  render();
  return {
    show() {
      root.classList.remove('hidden');
    },
    hide() {
      root.classList.add('hidden');
    },
    get visible() {
      return !root.classList.contains('hidden');
    },
    render,
    /** 총 스킨 · 킬 효과 목록 (불러온 뒤) */
    setLists(next) {
      lists = { ...lists, ...next };
      render();
    },
  };
}
