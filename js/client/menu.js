// 설정 메뉴 (Esc). 모드·감도·크로스헤어·화면·소리. 바꾸면 바로 저장된다.
import { BIND } from '../sim/bind.js';
import { cmPer360 } from '../sim/valorant.js';
import { parseCrosshairCode, DEFAULT_CROSSHAIR } from '../sim/settings.js';

const $ = (id) => document.getElementById(id);

// 바꾸면 판을 새로 시작해야 하는 설정
const RESET_KEYS = new Set(['mode', 'dmBots', 'dmBehavior', 'hold', 'duel', 'duelBehavior', 'fight', 'infiniteReserve']);

function set(obj, path, v) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
}

function opt(list, cur) {
  return list.map(([v, label]) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`).join('');
}

export function createMenu(settings, { onChange, onStart, drawPreview: drawInto }) {
  const root = $('menu');
  const S = settings;

  function render() {
    const cm = cmPer360(S.dpi, S.sens);
    const c = S.crosshair;
    root.querySelector('.panel').innerHTML = `
      <header>
        <div>
          <h1>발로 에임장 <span>· ${BIND.label}</span></h1>
          <p>밴달 · 발로란트 이동/사격 규칙 그대로 · 맵을 눈에 익히면서 에임 연습</p>
        </div>
        <button id="start" class="primary">연습 시작 <small>(클릭하면 마우스가 잠겨요)</small></button>
      </header>
      <nav>
        <button data-tab="mode" class="on">모드</button>
        <button data-tab="sens">감도·조작</button>
        <button data-tab="cross">크로스헤어</button>
        <button data-tab="view">화면·소리</button>
        <button data-tab="keys">조작키</button>
      </nav>

      <section data-tab="mode" class="on">
        <div class="modes">
          ${[
            ['dm', '데스매치', '바인드 곳곳에 봇. 돌아다니며 찾아서 잡기. 죽으면 다른 곳에서 다시 나옴'],
            ['hold', '각 잡기', '자리 잡고 각 보기. 봇이 램프·창문·가든 같은 실제 각에서 피킹'],
            ['duel', '1:1 스트레이프', '봇 하나가 AD 무빙. 카운터 스트레이핑 하고 멈춰서 쏘기'],
            ['free', '맵 둘러보기', '봇 없이 바인드 걸어다니기. B 키로 원하는 자리에 봇 놓기'],
          ]
            .map(([v, t, d]) => `<label class="mode${S.mode === v ? ' on' : ''}"><input type="radio" name="mode" data-k="mode" value="${v}"${S.mode === v ? ' checked' : ''}><b>${t}</b><span>${d}</span></label>`)
            .join('')}
        </div>
        <div class="rows">
          <div class="row" data-show="dm"><span>봇 수</span><input type="range" min="1" max="16" step="1" data-k="dmBots" value="${S.dmBots}"><em>${S.dmBots}명</em></div>
          <div class="row" data-show="dm"><span>봇 움직임</span><select data-k="dmBehavior">${opt([['mixed', '섞어서'], ['wander', '돌아다니며 각 잡기'], ['strafe', 'AD 스트레이프'], ['static', '가만히']], S.dmBehavior)}</select></div>
          <div class="row" data-show="hold"><span>자리</span><select data-k="hold">${opt(BIND.holds.map((h) => [h.id, h.label]), S.hold)}</select></div>
          <div class="row" data-show="duel"><span>자리</span><select data-k="duel">${opt(BIND.duels.map((d) => [d.id, d.label]), S.duel)}</select></div>
          <div class="row" data-show="duel"><span>봇 움직임</span><select data-k="duelBehavior">${opt([['strafe', 'AD 스트레이프'], ['static', '가만히']], S.duelBehavior)}</select></div>
          <div class="row" data-show="dm hold duel"><span>봇 반격</span><select data-k="fight">${opt([['off', '끔 (에임만)'], ['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']], S.fight)}</select></div>
          <div class="row"><span>예비 탄약 무한</span><input type="checkbox" data-k="infiniteReserve"${S.infiniteReserve ? ' checked' : ''}><em>끄면 25 / 50 (실제처럼)</em></div>
        </div>
        <p class="hint">모드를 바꾸면 기록이 새로 시작돼요. 게임 중 <kbd>Tab</kbd> 기록, <kbd>M</kbd> 큰 지도, <kbd>Backspace</kbd> 기록 초기화.</p>
      </section>

      <section data-tab="sens">
        <div class="rows">
          <div class="row"><span>마우스 DPI</span><input type="number" min="100" max="32000" step="50" data-k="dpi" value="${S.dpi}"></div>
          <div class="row"><span>감도 (발로 그대로)</span><input type="number" min="0.01" max="10" step="0.001" data-k="sens" value="${S.sens}"></div>
          <div class="row"><span>조준 감도 배율</span><input type="number" min="0.1" max="5" step="0.01" data-k="scopedMult" value="${S.scopedMult}"><em>발로 '조준 감도 배율'과 같은 값</em></div>
          <div class="row big"><span>360° 도는 거리</span><b>${cm.toFixed(1)} cm</b><em>(${(cm / 2.54).toFixed(1)} 인치 · eDPI ${Math.round(S.dpi * S.sens)})</em></div>
          <div class="row"><span>원시 입력 (가속 끔)</span><input type="checkbox" data-k="rawInput"${S.rawInput ? ' checked' : ''}><em>크롬·엣지에서 윈도우 마우스 가속·포인터 속도를 무시 (발로의 '원시 입력 버퍼'와 같은 효과)</em></div>
          <div class="row"><span>보정 배수</span><input type="number" min="0.1" max="10" step="0.01" data-k="mouseScale" value="${S.mouseScale}"><em>보통 1. 발로와 도는 양이 다르게 느껴질 때만 조절</em></div>
          <div class="row"><span>Y축 반전</span><input type="checkbox" data-k="invertY"${S.invertY ? ' checked' : ''}></div>
          <div class="row"><span>조준(우클릭)</span><select data-k="adsMode">${opt([['hold', '누르고 있기'], ['toggle', '토글']], S.adsMode)}</select></div>
          <div class="row"><span>앉기</span><select data-k="crouchMode">${opt([['hold', '누르고 있기'], ['toggle', '토글']], S.crouchMode)}</select></div>
          <div class="row"><span>걷기</span><select data-k="walkMode">${opt([['hold', '누르고 있기'], ['toggle', '토글']], S.walkMode)}</select></div>
        </div>
        <p class="hint">발로란트 감도 공식: 마우스 1칸(카운트)당 0.07° × 감도. 시야각은 발로와 같은 가로 103°.
        <br>360° 테스트: 게임 중 <kbd>F2</kbd> 를 누르면 지금 방향을 기억하고, 마우스를 ${cm.toFixed(1)}cm 움직이면 정확히 한 바퀴예요.</p>
      </section>

      <section data-tab="cross">
        <div class="cross-wrap">
          <canvas id="cross-preview" width="160" height="160"></canvas>
          <div class="rows">
            <div class="row"><span>발로 크로스헤어 코드</span><input type="text" id="cross-code" placeholder="0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0" value="${S.crosshairCode || ''}"><button id="cross-apply">적용</button></div>
            <div class="row"><span>색</span><input type="color" data-k="crosshair.color" value="${c.color}"></div>
            <div class="row"><span>테두리</span><input type="checkbox" data-k="crosshair.outline"${c.outline ? ' checked' : ''}><input type="range" min="0" max="1" step="0.05" data-k="crosshair.outlineOpacity" value="${c.outlineOpacity}"></div>
            <div class="row"><span>중앙 점</span><input type="checkbox" data-k="crosshair.dot"${c.dot ? ' checked' : ''}><input type="range" min="1" max="6" step="1" data-k="crosshair.dotThickness" value="${c.dotThickness}"></div>
            <div class="row"><span>안쪽 선</span><input type="checkbox" data-k="crosshair.inner.show"${c.inner.show ? ' checked' : ''}>
              길이<input type="number" min="0" max="20" step="1" data-k="crosshair.inner.length" value="${c.inner.length}">
              두께<input type="number" min="0" max="10" step="1" data-k="crosshair.inner.thickness" value="${c.inner.thickness}">
              간격<input type="number" min="0" max="20" step="1" data-k="crosshair.inner.offset" value="${c.inner.offset}">
              투명도<input type="number" min="0" max="1" step="0.05" data-k="crosshair.inner.opacity" value="${c.inner.opacity}"></div>
            <div class="row"><span>바깥 선</span><input type="checkbox" data-k="crosshair.outer.show"${c.outer.show ? ' checked' : ''}>
              길이<input type="number" min="0" max="20" step="1" data-k="crosshair.outer.length" value="${c.outer.length}">
              두께<input type="number" min="0" max="10" step="1" data-k="crosshair.outer.thickness" value="${c.outer.thickness}">
              간격<input type="number" min="0" max="40" step="1" data-k="crosshair.outer.offset" value="${c.outer.offset}">
              투명도<input type="number" min="0" max="1" step="0.05" data-k="crosshair.outer.opacity" value="${c.outer.opacity}"></div>
            <div class="row"><span>연사 오차 표시</span><input type="checkbox" data-k="crosshair.firingErrorAll"${c.firingErrorAll ? ' checked' : ''}><em>쏠 때 크로스헤어가 벌어짐</em></div>
            <div class="row"><span>이동 오차 표시 (바깥 선)</span><input type="checkbox" data-k="crosshair.outer.moveError"${c.outer.moveError ? ' checked' : ''}></div>
            <div class="row"><button id="cross-reset">기본 크로스헤어로</button></div>
          </div>
        </div>
        <p class="hint">발로 설정 → 크로스헤어 → '프로필 코드 내보내기'로 복사한 코드를 붙여넣으면 똑같이 나와요.</p>
      </section>

      <section data-tab="view">
        <div class="rows">
          <div class="row"><span>적 하이라이트 색</span><select data-k="enemyColor">${opt([['red', '빨강 (기본)'], ['yellow', '노랑 (적록색약)'], ['purple', '보라 (청색약)']], S.enemyColor)}</select></div>
          <div class="row"><span>소리 크기</span><input type="range" min="0" max="1" step="0.05" data-k="volume" value="${S.volume}"></div>
          <div class="row"><span>속도계</span><input type="checkbox" data-k="showSpeed"${S.showSpeed ? ' checked' : ''}><em>초록 = 정확하게 쏠 수 있는 속도 (카운터 스트레이핑 연습)</em></div>
          <div class="row"><span>실제 퍼짐 원</span><input type="checkbox" data-k="showSpread"${S.showSpread ? ' checked' : ''}><em>지금 쏘면 총알이 갈 수 있는 범위</em></div>
          <div class="row"><span>데미지 숫자</span><input type="checkbox" data-k="showDamage"${S.showDamage ? ' checked' : ''}><em>발로엔 없음. 연습용</em></div>
          <div class="row"><span>예광탄</span><input type="checkbox" data-k="showTracers"${S.showTracers ? ' checked' : ''}></div>
          <div class="row"><span>총 모델</span><input type="checkbox" data-k="viewmodel"${S.viewmodel ? ' checked' : ''}></div>
          <div class="row"><span>미니맵</span><input type="checkbox" data-k="showMinimap"${S.showMinimap ? ' checked' : ''}></div>
          <div class="row"><span>전체화면으로 시작</span><input type="checkbox" data-k="fullscreen"${S.fullscreen ? ' checked' : ''}><em>Ctrl+W(앉아서 앞으로) 로 탭이 닫히는 걸 막아요</em></div>
        </div>
      </section>

      <section data-tab="keys">
        <table class="keys">
          <tr><td>이동 / 걷기 / 앉기 / 점프</td><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>Shift</kbd> / <kbd>Ctrl</kbd> 또는 <kbd>C</kbd> / <kbd>Space</kbd></td></tr>
          <tr><td>쏘기 / 조준</td><td>마우스 왼쪽 / 오른쪽</td></tr>
          <tr><td>재장전</td><td><kbd>R</kbd></td></tr>
          <tr><td>밴달 / 칼 / 직전 무기</td><td><kbd>1</kbd> / <kbd>3</kbd> / <kbd>Q</kbd></td></tr>
          <tr><td>보는 곳에 봇 놓기 / 놓은 봇 지우기</td><td><kbd>B</kbd> / <kbd>N</kbd></td></tr>
          <tr><td>기록 / 큰 지도</td><td><kbd>Tab</kbd> / <kbd>M</kbd> (누르고 있기)</td></tr>
          <tr><td>처음 자리로 / 기록 초기화</td><td><kbd>F</kbd> / <kbd>Backspace</kbd></td></tr>
          <tr><td>360° 감도 확인</td><td><kbd>F2</kbd></td></tr>
          <tr><td>메뉴</td><td><kbd>Esc</kbd></td></tr>
        </table>
        <p class="hint">한글 입력 상태여도 키 위치 기준이라 그대로 됩니다. <b>Ctrl+W</b> 는 브라우저가 탭을 닫는 키라서, 앉기는 <kbd>C</kbd> 를 쓰거나 전체화면에서 하세요 (전체화면이면 막아 둡니다).</p>
      </section>`;
    bind();
    showModeRows();
    drawPreview();
  }

  function showModeRows() {
    for (const el of root.querySelectorAll('[data-show]')) {
      el.classList.toggle('hidden', !el.dataset.show.split(' ').includes(S.mode));
    }
    for (const el of root.querySelectorAll('label.mode')) {
      el.classList.toggle('on', el.querySelector('input').value === S.mode);
    }
  }

  function drawPreview() {
    const cv = $('cross-preview');
    if (cv && drawInto) drawInto(cv, S.crosshair);
  }

  function changed(key) {
    const top = key.split('.')[0];
    onChange(S, { reset: RESET_KEYS.has(top), key });
    if (key === 'dpi' || key === 'sens') {
      const cm = cmPer360(S.dpi, S.sens);
      const big = root.querySelector('.row.big');
      if (big) {
        big.querySelector('b').textContent = `${cm.toFixed(1)} cm`;
        big.querySelector('em').textContent = `(${(cm / 2.54).toFixed(1)} 인치 · eDPI ${Math.round(S.dpi * S.sens)})`;
      }
    }
    if (top === 'crosshair') {
      S.crosshairCode = '';
      drawPreview();
    }
    if (top === 'mode') showModeRows();
  }

  function bind() {
    $('start').onclick = () => onStart();
    for (const b of root.querySelectorAll('nav button')) {
      b.onclick = () => {
        for (const x of root.querySelectorAll('nav button, section')) x.classList.toggle('on', x.dataset.tab === b.dataset.tab);
      };
    }
    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      const handler = () => {
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'radio') {
          if (!el.checked) return;
          v = el.value;
        } else if (el.type === 'number' || el.type === 'range') {
          v = Number(el.value);
          if (!Number.isFinite(v)) return;
          if (el.min !== '' && v < Number(el.min)) return;
        } else v = el.value;
        set(S, k, v);
        const em = el.parentElement.querySelector('em');
        if (k === 'dmBots' && em) em.textContent = `${v}명`;
        changed(k);
      };
      el.addEventListener(el.type === 'number' || el.type === 'text' ? 'change' : 'input', handler);
      if (el.type === 'number') el.addEventListener('input', handler);
    }
    $('cross-apply').onclick = () => {
      const code = $('cross-code').value.trim();
      const parsed = parseCrosshairCode(code);
      if (!parsed) {
        $('cross-code').classList.add('bad');
        return;
      }
      $('cross-code').classList.remove('bad');
      S.crosshair = parsed;
      onChange(S, { reset: false, key: 'crosshair' });
      S.crosshairCode = code;
      onChange(S, { reset: false, key: 'crosshairCode' });
      render();
      for (const x of root.querySelectorAll('nav button, section')) x.classList.toggle('on', x.dataset.tab === 'cross');
    };
    $('cross-reset').onclick = () => {
      S.crosshair = JSON.parse(JSON.stringify(DEFAULT_CROSSHAIR));
      S.crosshairCode = '';
      onChange(S, { reset: false, key: 'crosshair' });
      render();
      for (const x of root.querySelectorAll('nav button, section')) x.classList.toggle('on', x.dataset.tab === 'cross');
    };
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
  };
}
