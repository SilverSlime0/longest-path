// Optimizer lab: races every method on the same board and evaluation budget,
// and shows the benchmark results from bench/results.js.
(function () {
const S = window.Solvers;
const $ = id => document.getElementById(id);
const BUDGETS = Object.fromEntries(Object.entries(LEVELS).map(([k, L]) => [k, L.optEvals]));
const OPTIMUM = Object.fromEntries(Object.entries(LEVELS).filter(([, L]) => L.optimum).map(([k, L]) => [k, L.optimum]));
// The methods shown here; solvers.js and combos.js hold more (see bench/bench.js).
const FEATURED = ['baseline', 'sa-auto', 'pt-auto', 'lns', 'ga', 'exact'];
const METHODS = FEATURED.map(id => S.METHODS.find(m => m.id === id));
let race = null;

for (const [key, L] of Object.entries(LEVELS)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = `${L.label} · ${L.W}×${L.H} · ${L.budget} walls`;
  $('board').appendChild(o);
}

function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

// Link that opens a board and its walls on the play page (see loadFromQuery in ui.js).
function playLink(board, walls, from) {
  return `play.html?board=${encodeURIComponent(board)}&walls=${walls.join(',')}&from=${encodeURIComponent(from)}`;
}

// Draw a board with the given walls and its shortest path.
function drawBoard(canvas, b, walls, cellPx) {
  const dpr = window.devicePixelRatio || 1;
  const w = b.W * cellPx, h = b.H * cellPx;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = { bg: css('--bg'), cell: css('--cell'), wall: css('--wall'), rock: css('--rock'),
                entry: css('--entry'), exit: css('--exit'), path: css('--path') };
  ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
  const mask = new Uint8Array(b.N);
  for (const c of walls) mask[c] = 1;
  for (let c = 0; c < b.N; c++) {
    ctx.fillStyle = mask[c] ? col.wall : b.rock[c] ? col.rock : c === b.entry ? col.entry : c === b.exit ? col.exit : col.cell;
    ctx.fillRect((c % b.W) * cellPx + 0.5, ((c / b.W) | 0) * cellPx + 0.5, cellPx - 1, cellPx - 1);
  }
  const ev = new S.Evaluator(b, false);
  if (ev.run(mask) < 0) return;
  const p = [b.entry, ...ev.path(), b.exit];
  ctx.strokeStyle = col.path; ctx.lineWidth = Math.max(1.5, cellPx * 0.18);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  p.forEach((c, i) => {
    const x = (c % b.W + 0.5) * cellPx, y = (((c / b.W) | 0) + 0.5) * cellPx;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

// ---------- race ----------
function buildCards(b) {
  const grid = $('cards');
  grid.innerHTML = '';
  return METHODS.map(m => {
    const card = document.createElement('div');
    card.className = 'mcard';
    card.innerHTML = `<div class="mhead"><span class="mname"></span></div>
      <a class="to-play" title="Open this layout in Play"><canvas></canvas></a>
      <div class="mstats"><span class="mbest">–</span><span class="mphase">waiting</span></div>
      <div class="bar"><i></i></div><p class="mdesc"></p>`;
    card.querySelector('.mname').textContent = m.name;
    card.querySelector('.mdesc').textContent = m.desc;
    grid.appendChild(card);
    const canvas = card.querySelector('canvas'), link = card.querySelector('.to-play');
    link.href = playLink($('board').value, [], m.name);
    drawBoard(canvas, b, [], cellSize(canvas, b));
    return { m, card, canvas, link, best: card.querySelector('.mbest'), phase: card.querySelector('.mphase'),
             bar: card.querySelector('.bar i'), snap: null, result: null, dirty: false };
  });
}

function cellSize(canvas, b) { return Math.max(6, Math.floor((canvas.closest('.mcard').clientWidth - 24) / b.W)); }

function startRace() {
  if ($('randomSeed').checked) $('seed').value = 1 + ((Math.random() * 9999) | 0);
  const name = $('board').value, def = LEVELS[name];
  const maxEvals = Math.max(500, +$('budget').value || BUDGETS[name]);
  const seed = Math.max(1, +$('seed').value || 1);
  const b = S.makeBoard(def);
  const yieldEvery = Math.max(10, Math.round(maxEvals / 400));
  const entries = buildCards(b);
  for (const e of entries) e.run = S.createRun(def, e.m.id, { maxEvals, seed, yieldEvery });
  race = { name, b, maxEvals, entries, t0: performance.now(), duration: $('paced').checked ? +$('duration').value : 0 };
  $('raceMsg').textContent = `Racing ${entries.length} methods with ${maxEvals.toLocaleString()} evaluations each…`;
}

function step() {
  if (race && race.entries.some(e => !e.result)) {
    const active = race.entries.filter(e => !e.result);
    // each method may use at most its share of the evaluations per frame (pacing,
    // unless turned off) and its share of ~35 ms of compute (so the page stays responsive)
    const quota = race.duration ? race.maxEvals / (race.duration * 60) : Infinity;
    const slice = 35 / active.length;
    for (const e of active) {
      const ev = e.run.ctx.ev, e0 = ev.evals, t0 = performance.now();
      while (ev.evals - e0 < quota && performance.now() - t0 < slice) {
        const s = e.run.gen.next();
        if (s.done) { e.result = s.value; break; }
        e.snap = s.value;
      }
      e.dirty = true;
    }
    for (const e of race.entries) if (e.dirty) renderEntry(e);
    if (race.entries.every(e => e.result)) finishRace();
  }
  requestAnimationFrame(step);
}

function renderEntry(e) {
  e.dirty = false;
  const { b, maxEvals, name } = race;
  const walls = e.result ? e.result.walls : e.snap ? e.snap.bestWalls : [];
  const len = e.result ? e.result.len : e.snap ? e.snap.best : null;
  e.best.textContent = len === null || !isFinite(len) ? '–' : len;
  if (e.result && OPTIMUM[name] && e.result.len >= OPTIMUM[name]) {
    const badge = document.createElement('span');
    badge.className = 'badge'; badge.textContent = 'optimal';
    e.best.appendChild(badge);
  }
  const evals = e.result ? e.result.evals : e.snap ? e.snap.evals : 0;
  e.phase.textContent = e.result ? `done · ${evals.toLocaleString()} evals` : (e.snap ? e.snap.phase : 'starting');
  e.bar.style.width = Math.min(100, evals / maxEvals * 100) + '%';
  e.link.href = playLink(name, walls, e.m.name);
  drawBoard(e.canvas, b, walls, cellSize(e.canvas, b));
}

function finishRace() {
  const best = Math.max(...race.entries.map(e => e.result.len));
  const winners = race.entries.filter(e => e.result.len === best);
  for (const e of winners) e.card.classList.add('winner');
  const secs = ((performance.now() - race.t0) / 1000).toFixed(1);
  const opt = OPTIMUM[race.name];
  $('raceMsg').textContent = `Finished in ${secs}s. Best: ${best}` +
    (opt ? (best >= opt ? ' (the proven optimum)' : ` (optimum is ${opt})`) : '') +
    `, reached by ${winners.length} of ${race.entries.length} methods. One race is one seed: see the benchmark below for averages over many seeds. Click a board to open it in Play.`;
}

// ---------- benchmark table ----------
function renderBench() {
  const name = $('board').value, B = window.BENCH && window.BENCH.boards[name];
  const table = $('benchTable');
  if (!B) {
    $('benchInfo').textContent = '';
    $('bestKnown').innerHTML = '';
    table.innerHTML = `<tr><td>No benchmark results for this board yet: run node bench/bench.js --boards ${name}</td></tr>`;
    return;
  }
  const target = OPTIMUM[name] || Math.max(B.bestKnown, LEVELS[name].bestKnown || 0);
  const rows = METHODS.filter(m => B.methods[m.id]).map(({ id, name }) => {
    const m = B.methods[id], lens = m.runs.map(r => r.len);
    return {
      id, name, n: lens.length,
      hit: lens.filter(l => l >= target).length / lens.length,
      mean: lens.reduce((a, c) => a + c, 0) / lens.length,
      min: Math.min(...lens), max: Math.max(...lens),
      ms: m.runs.reduce((a, r) => a + r.ms, 0) / m.runs.length,
    };
  }).sort(OPTIMUM[name] ? (a, c) => c.hit - a.hit || c.mean - a.mean : (a, c) => c.mean - a.mean || c.min - a.min);
  const trials = Math.max(...rows.map(r => r.n));
  $('benchInfo').textContent = `${LEVELS[name].label} · ${B.maxEvals.toLocaleString()} evaluations per run · ${trials} seeds per method · ` +
    (OPTIMUM[name] ? `"Hit" = reached the proven optimum ${target}.` : `"Hit" = reached ${target}, the best any method has found (not proven optimal).`) +
    ' Measured in Node with bench/bench.js.';
  table.innerHTML = '<tr><th>Method</th><th>Hit rate</th><th class="num">Mean</th><th class="num">Worst</th><th class="num">Best</th><th class="num">Time / run</th></tr>';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i === 0) tr.className = 'top';
    tr.innerHTML = `<td></td><td><span class="hitbar"><i style="width:${(r.hit * 100).toFixed(0)}%"></i></span>${(r.hit * 100).toFixed(0)}%</td>
      <td class="num">${r.mean.toFixed(1)}</td><td class="num">${r.min}</td><td class="num">${r.max}</td><td class="num">${r.ms < 1000 ? r.ms.toFixed(0) + ' ms' : (r.ms / 1000).toFixed(1) + ' s'}</td>`;
    tr.children[0].textContent = r.name;
    table.appendChild(tr);
  });

  const bk = $('bestKnown');
  bk.innerHTML = '';
  if (B.bestKnownWalls) {
    const b = S.makeBoard(LEVELS[name]);
    const canvas = document.createElement('canvas');
    const px = { small: 22, medium: 18, large: 14 }[LEVELS[name].size];
    canvas.style.width = b.W * px + 'px'; canvas.style.height = b.H * px + 'px';
    const link = document.createElement('a');
    link.className = 'to-play'; link.title = 'Open this layout in Play';
    link.href = playLink(name, B.bestKnownWalls, 'best benchmark layout');
    link.appendChild(canvas);
    bk.appendChild(link);
    drawBoard(canvas, b, B.bestKnownWalls, px);
    const p = document.createElement('p');
    p.textContent = `Best layout found in the benchmark: path length ${B.bestKnown} with ${B.bestKnownWalls.length} walls.` +
      (OPTIMUM[name] ? (B.bestKnown >= OPTIMUM[name] ? ' This is the proven optimum.' : ` The proven optimum is ${OPTIMUM[name]}.`)
        : (LEVELS[name].bestKnown > B.bestKnown ? ` Much longer runs (bench/evidence.js) have found ${LEVELS[name].bestKnown}.` : '') +
          ' Nobody has proven whether a longer path exists.');
    bk.appendChild(p);
  }
}

// ---------- controls ----------
function onBoardChange() {
  $('budget').value = BUDGETS[$('board').value];
  $('paced').checked = LEVELS[$('board').value].size === 'small';
  syncPace();
  renderBench();
  const b = S.makeBoard(LEVELS[$('board').value]);
  race = null;
  buildCards(b);
  $('raceMsg').textContent = 'Press Race to run every method on this board.';
}
// The selected board lives in the URL (?board=key), so reloads and bookmarks keep it.
$('board').onchange = () => {
  onBoardChange();
  try { history.replaceState(null, '', `?board=${encodeURIComponent($('board').value)}`); } catch (e) { /* some file:// pages refuse */ }
};
const savedBoard = new URLSearchParams(location.search).get('board');
if (savedBoard && Object.hasOwn(LEVELS, savedBoard)) $('board').value = savedBoard;
$('bRace').onclick = startRace;
$('randomSeed').onchange = () => { $('seed').disabled = $('randomSeed').checked; };
$('randomSeed').onchange();
function syncPace() {
  const paced = $('paced').checked;
  $('duration').disabled = !paced;
  $('durLabel').textContent = paced ? $('duration').value + 's' : 'as fast as possible';
}
$('duration').oninput = syncPace;
$('paced').onchange = syncPace;
syncPace();

onBoardChange();
requestAnimationFrame(step);
})();
