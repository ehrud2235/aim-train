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
 * 발로란트처럼 테두리를 전부 먼저 깔고 그 위에 색을 칠한다 (간격이 좁아도 선끼리 테두리가 덮지 않게).
 * 반환: 가운데에서 그린 곳까지의 최대 거리(px) — 다음 프레임에 그만큼만 지우면 된다.
 */
export function paintCrosshair(g, cx, cy, cfg, fireErrPx = 0, moveErrPx = 0) {
  const rects = [];
  // '사격 오차에 따라 조준선 흐리게': 연사로 벌어질수록 옅어짐 [추정: 곡선]
  const fade = cfg.fade ? Math.max(0.25, 1 - fireErrPx / 12) : 1;
  const rect = (x, y, w, h, a) => {
    rects.push([Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), a * fade]);
  };
  const lines = (L) => {
    if (!L.show || L.opacity <= 0 || L.length <= 0) return;
    let extra = 0;
    if (cfg.firingErrorAll && L.fireError) extra += fireErrPx * (L.fireMult ?? 1);
    if (L.moveError) extra += moveErrPx * (L.moveMult ?? 1);
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
  const olT = cfg.outline && cfg.outlineOpacity > 0 ? cfg.outlineThickness : 0;
  if (olT > 0) {
    g.fillStyle = `rgba(0,0,0,${cfg.outlineOpacity})`;
    for (const [x, y, w, h] of rects) g.fillRect(x - olT, y - olT, w + olT * 2, h + olT * 2);
  }
  let extent = 0;
  for (const [x, y, w, h, a] of rects) {
    g.fillStyle = rgba(cfg.color, a);
    g.fillRect(x, y, w, h);
    extent = Math.max(extent, Math.abs(x - cx), Math.abs(x + w - cx), Math.abs(y - cy), Math.abs(y + h - cy));
  }
  return extent + olT + 1;
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
