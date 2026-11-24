// Canvas drawing: tiles, heatmap, flow arrows, shortest path.

// rendering
let cs = 30;
function resize() {
  const w = cv.parentElement.clientWidth;
  cs = Math.max(12, Math.min(LEVEL.maxCell, Math.floor(w / W)));
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * cs * dpr; cv.height = H * cs * dpr;
  cv.style.width = W * cs + 'px'; cv.style.height = H * cs + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function draw(now) {
  const col = {
    bg: css('--bg'), cell: css('--cell'), wall: css('--wall'), rock: css('--rock'),
    entry: css('--entry'), exit: css('--exit'), path: css('--path'),
    muted: css('--muted'), reject: css('--reject'),
  };
  ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W * cs, H * cs);
  let maxD = 1;
  for (let c = 0; c < N; c++) if (dist[c] > maxD) maxD = dist[c];
  const heat = $('tHeat').checked, arrows = $('tArrows').checked;
  const g = 1, r = Math.max(2, cs * 0.15);

  for (let c = 0; c < N; c++) {
    const x = (c % W) * cs, y = ((c / W) | 0) * cs;
    let fill = col.cell;
    if (walls.has(c)) fill = col.wall;
    else if (ROCKS.has(c)) fill = col.rock;
    else if (c === ENTRY) fill = col.entry;
    else if (c === EXIT) fill = col.exit;
    roundRect(x + g, y + g, cs - 2 * g, cs - 2 * g, r, fill);
    if (heat && fill === col.cell && dist[c] >= 0) {
      const t = dist[c] / maxD;
      roundRect(x + g, y + g, cs - 2 * g, cs - 2 * g, r, `hsla(${200 - 180 * t},70%,55%,0.38)`);
    }
  }

  if (arrows) {
    ctx.strokeStyle = col.muted; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2;
    for (let c = 0; c < N; c++) {
      if (c === EXIT || dist[c] < 0) continue;
      const n = nextCell(c); if (n < 0) continue;
      const cx = (c % W + 0.5) * cs, cy = (((c / W) | 0) + 0.5) * cs;
      const dx = (n % W) - (c % W), dy = ((n / W) | 0) - ((c / W) | 0);
      const L = cs * 0.22;
      const ex = cx + dx * L, ey = cy + dy * L;
      ctx.beginPath();
      ctx.moveTo(cx - dx * L, cy - dy * L); ctx.lineTo(ex, ey);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - dx * L * 0.6 - dy * L * 0.5, ey - dy * L * 0.6 - dx * L * 0.5);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - dx * L * 0.6 + dy * L * 0.5, ey - dy * L * 0.6 + dx * L * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (dist[ENTRY] >= 0) {
    const p = shortestPath();
    ctx.strokeStyle = col.path; ctx.lineWidth = Math.max(2, cs * 0.12);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    p.forEach((c, i) => {
      const px = (c % W + 0.5) * cs, py = (((c / W) | 0) + 0.5) * cs;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }

  if (flash && now < flash.until) {
    const x = (flash.cell % W) * cs, y = ((flash.cell / W) | 0) * cs;
    ctx.globalAlpha = (flash.until - now) / 500;
    roundRect(x + g, y + g, cs - 2 * g, cs - 2 * g, r, col.reject);
    ctx.globalAlpha = 1;
  }
}

function roundRect(x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
}
