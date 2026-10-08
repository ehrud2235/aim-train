// 발로란트 크로스헤어 그리기 (게임 화면·설정 미리보기 공용).

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * g: 2D 컨텍스트, (cx, cy): 가운데, cfg: 크로스헤어 설정
 * fireErrPx / moveErrPx: 연사·이동 오차만큼 선이 벌어지는 픽셀
 */
export function paintCrosshair(g, cx, cy, cfg, fireErrPx = 0, moveErrPx = 0) {
  const ol = cfg.outline;
  const olT = cfg.outlineThickness;
  const olA = cfg.outlineOpacity;
  const rect = (x, y, w, h, a) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    if (ol && olA > 0) {
      g.fillStyle = `rgba(0,0,0,${olA})`;
      g.fillRect(rx - olT, ry - olT, rw + olT * 2, rh + olT * 2);
    }
    g.fillStyle = rgba(cfg.color, a);
    g.fillRect(rx, ry, rw, rh);
  };
  const lines = (L) => {
    if (!L.show || L.opacity <= 0 || L.length <= 0) return;
    let extra = 0;
    if (cfg.firingErrorAll && L.fireError) extra += fireErrPx;
    if (L.moveError) extra += moveErrPx;
    const t = L.thickness;
    const len = L.length;
    const vlen = L.vlength ?? len;
    const off = L.offset + extra;
    if (t <= 0) return;
    rect(cx - t / 2, cy - off - vlen, t, vlen, L.opacity);
    rect(cx - t / 2, cy + off, t, vlen, L.opacity);
    rect(cx - off - len, cy - t / 2, len, t, L.opacity);
    rect(cx + off, cy - t / 2, len, t, L.opacity);
  };
  lines(cfg.inner);
  lines(cfg.outer);
  if (cfg.dot && cfg.dotOpacity > 0) {
    const t = cfg.dotThickness;
    rect(cx - t / 2, cy - t / 2, t, t, cfg.dotOpacity);
  }
}

/** 설정 화면 미리보기 (회색 바탕) */
export function previewCrosshair(canvas, cfg) {
  const g = canvas.getContext('2d');
  g.fillStyle = '#7b8794';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#c9b18a';
  g.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);
  paintCrosshair(g, canvas.width / 2, canvas.height / 2, cfg);
}
