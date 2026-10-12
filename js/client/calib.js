// HUD 위치 맞추기: 내 발로 스크린샷(1920×1080 권장)을 반투명하게 겹쳐 놓고,
// HUD 요소를 마우스로 끌어 옮기고(휠 = 크기, 화살표 = 1px, Shift+화살표 = 10px) 같은 자리에 맞춘다.
// 값은 설정의 hudAdjust 에 1080p 기준 px 로 저장된다.

const $ = (id) => document.getElementById(id);
const NAMES = {
  minimap: '미니맵',
  region: '위치 이름',
  topbar: '시간·킬',
  killfeed: '킬 피드',
  health: '체력',
  abilities: '스킬',
  ammo: '탄약',
  weapons: '무기 목록',
  banner: '킬 배너',
};

export function createCalibrator(settings, { onSave, onExit, getScale }) {
  const S = settings;
  const root = $('calib');
  const shot = $('calib-shot');
  const bar = $('calib-bar');
  let sel = null;
  let drag = null;
  let active = false;

  bar.innerHTML = `
    <label class="vbtn">스크린샷 불러오기<input type="file" id="calib-file" accept="image/*" hidden></label>
    <span>겹친 정도</span><input type="range" id="calib-op" min="0" max="1" step="0.05" value="0.5">
    <span id="calib-sel">요소를 끌어서 옮기세요 · 휠 = 크기</span>
    <button type="button" class="vbtn" id="calib-reset-one">이 요소 처음대로</button>
    <button type="button" class="vbtn primary" id="calib-done">끝내기</button>`;

  $('calib-file').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (shot.src.startsWith('blob:')) URL.revokeObjectURL(shot.src);
    shot.src = URL.createObjectURL(f);
  };
  $('calib-op').oninput = (e) => {
    shot.style.opacity = e.target.value;
  };
  $('calib-done').onclick = () => exit();
  $('calib-reset-one').onclick = () => {
    if (!sel) return;
    delete S.hudAdjust[sel.dataset.el];
    onSave();
  };

  const adj = (el) => {
    S.hudAdjust ||= {};
    return (S.hudAdjust[el.dataset.el] ||= { x: 0, y: 0, s: 1 });
  };
  function select(el) {
    if (sel) sel.classList.remove('sel');
    sel = el;
    if (sel) {
      sel.classList.add('sel');
      const a = adj(sel);
      $('calib-sel').textContent = `${NAMES[sel.dataset.el] || sel.dataset.el} · x ${Math.round(a.x)} y ${Math.round(a.y)} · 크기 ${a.s.toFixed(2)}`;
    }
  }

  function onDown(e) {
    if (!active) return;
    const el = e.target.closest && e.target.closest('.hud-el');
    if (!el) return;
    e.preventDefault();
    select(el);
    const a = adj(el);
    drag = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y };
  }
  function onMove(e) {
    if (!drag || !sel) return;
    const k = 1 / getScale();
    const a = adj(sel);
    a.x = drag.ax + (e.clientX - drag.x) * k;
    a.y = drag.ay + (e.clientY - drag.y) * k;
    onSave();
    select(sel);
  }
  function onUp() {
    drag = null;
  }
  function onWheel(e) {
    if (!active || !sel) return;
    e.preventDefault();
    const a = adj(sel);
    a.s = Math.max(0.4, Math.min(2.5, a.s * (e.deltaY < 0 ? 1.02 : 1 / 1.02)));
    onSave();
    select(sel);
  }
  function onKey(e) {
    if (!active) return;
    if (e.code === 'Escape') {
      exit();
      return;
    }
    if (!sel) return;
    const d = e.shiftKey ? 10 : 1;
    const a = adj(sel);
    if (e.code === 'ArrowLeft') a.x -= d;
    else if (e.code === 'ArrowRight') a.x += d;
    else if (e.code === 'ArrowUp') a.y -= d;
    else if (e.code === 'ArrowDown') a.y += d;
    else return;
    e.preventDefault();
    onSave();
    select(sel);
  }
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  function exit() {
    if (!active) return;
    active = false;
    select(null);
    root.classList.add('hidden');
    document.body.classList.remove('calibrating');
    onExit();
  }

  return {
    get active() {
      return active;
    },
    enter() {
      active = true;
      root.classList.remove('hidden');
      document.body.classList.add('calibrating');
    },
    exit,
  };
}
