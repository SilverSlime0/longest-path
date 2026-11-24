// Player input, board switching, buttons and stats panel.

function recompute() {
  const len = bfs(walls, dist);
  if (mode === 'edit' && !assisted && len > myBest) myBest = len;
  updateStats();
}

// input
function cellFromEvent(e) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * W);
  const y = Math.floor((e.clientY - r.top) / r.height * H);
  if (x < 0 || y < 0 || x >= W || y >= H) return -1;
  return idx(x, y);
}

cv.addEventListener('click', e => {
  if (mode !== 'edit') { say('Wait for the search to finish.'); return; }
  const c = cellFromEvent(e);
  if (c < 0 || c === ENTRY || c === EXIT || ROCKS.has(c)) return;
  if (walls.has(c)) { walls.delete(c); recompute(); say(''); return; }
  if (walls.size >= BUDGET) { say(`Out of walls (${BUDGET}). Click a wall to remove it.`); return; }
  walls.add(c);
  if (bfs(walls, new Int32Array(N)) < 0) {
    walls.delete(c);
    flash = { cell: c, until: performance.now() + 500 };
    say('Rejected: that wall would seal off the exit completely.');
    return;
  }
  say('');
  recompute();
});

function loadLevel(name) {
  if (mode !== 'edit') return;
  LEVEL = LEVELS[name];
  W = LEVEL.W; H = LEVEL.H; BUDGET = LEVEL.budget; N = W * H;
  ENTRY = idx(...LEVEL.entry); EXIT = idx(...LEVEL.exit);
  ROCKS = new Set(LEVEL.rocks.map(([x, y]) => idx(x, y)));
  walls = new Set(); dist = new Int32Array(N); pathDist = new Int32Array(N);
  myBest = 0; optBest = 0; exactBest = LEVEL.optimum || 0; assisted = false;
  $('saInfo').textContent = ''; say('');
  if ($('level')) $('level').value = name;
  $('bExact').style.display = LEVEL.exact ? '' : 'none';
  $('exactStat').style.display = LEVEL.optimum || LEVEL.exact ? '' : 'none';
  $('knownStat').style.display = LEVEL.bestKnown ? '' : 'none';
  $('sKnown').textContent = LEVEL.bestKnown || '–';
  $('boardNote').innerHTML = boardNote(LEVEL);
  resize(); recompute();
}

// What is known about this board's best possible path.
function boardNote(L) {
  if (L.note) return L.note;
  if (L.optimum) {
    return `The best possible on this board is <b>${L.optimum}</b>, proven by an exhaustive search ` +
      `(bench/prove.js)${L.exact ? '. Press Solve exactly to watch the proof run' : ''}.`;
  }
  if (!L.bestKnown) return '';
  const free = L.W * L.H - L.rocks.length - 2;
  let lg = 0;
  for (let i = 0; i < L.budget; i++) lg += Math.log10(free - i) - Math.log10(i + 1);
  const layouts = `${(10 ** (lg % 1)).toFixed(0)} × 10<sup>${Math.floor(lg)}</sup>`;
  // every step changes the checkerboard color, so all routes share one parity
  const parity = (L.entry[0] + L.entry[1] + L.exit[0] + L.exit[1]) % 2 ? 'odd' : 'even';
  const e = L.evidence;
  const runs = e ? ` In ${e.runs} optimizer runs, some up to ${e.longest}× longer than the Optimize button's, ` +
    `${e.hits} reached ${L.bestKnown} and none went higher` +
    (e.firstAt > 10 ? `; it first appeared only in runs ${e.firstAt}× longer, so this board is harder to be sure of.` : '.') : '';
  const sure = e && e.firstAt <= 10 ? 'very likely' : 'likely';
  return `<b>${L.bestKnown}</b> is the longest path found on this board, ${sure} the best possible, but not proven.${runs} ` +
    `A proof would have to rule out ${L.bestKnown + 2} (every route here has ${parity} length). ` +
    `Brute force would check every way to place ${L.budget} walls on ${free} free tiles, about ${layouts} layouts. ` +
    `The exact search that proves the medium boards gets about 10× slower per extra wall, so at 25 walls it would ` +
    `need billions of years.`;
}

// the board picker (the map generator page has its own form instead)
if ($('level')) for (const size of ['small', 'medium', 'large']) {
  const group = document.createElement('optgroup');
  group.label = size[0].toUpperCase() + size.slice(1);
  for (const [key, L] of Object.entries(LEVELS)) {
    if (L.size !== size) continue;
    const o = document.createElement('option');
    o.value = key; o.textContent = `${L.label} · ${L.W}×${L.H} · ${L.budget} walls`;
    group.appendChild(o);
  }
  $('level').appendChild(group);
}
if ($('level')) $('level').onchange = () => {
  loadLevel($('level').value);
  setUrl(`board=${encodeURIComponent($('level').value)}`);
};

// Keeps the address bar in step, without adding browser history entries.
function setUrl(query) {
  try { history.replaceState(null, '', '?' + query); } catch (e) { /* some file:// pages refuse */ }
}

// Opens the board and walls in a query string (?board=key&walls=cell,cell,...).
// `from` names the lab method a result came from; shared links don't have one.
// Returns false, changing nothing, if it doesn't name a known board.
function loadFromQuery(query) {
  const q = new URLSearchParams(query), name = q.get('board'), from = q.get('from');
  if (!name || !Object.hasOwn(LEVELS, name)) return false;
  loadLevel(name);
  const cells = (q.get('walls') || '').split(',').filter(Boolean).map(Number);
  if (!cells.length) return true;
  const placed = new Set(cells);
  const valid = placed.size === cells.length && cells.length <= BUDGET &&
    cells.every(c => Number.isInteger(c) && c >= 0 && c < N && c !== ENTRY && c !== EXIT && !ROCKS.has(c)) &&
    bfs(placed, new Int32Array(N)) >= 0;
  if (!valid) { say('That link has an invalid layout, so the board opened empty.'); return true; }
  walls = placed; assisted = true;
  const len = bfs(walls, dist);
  if (from) optBest = len;
  say(`${from ? `From the lab (${from})` : 'Shared solution'}: path length ${len} using ${walls.size} of ${BUDGET} walls. Press Clear to try your own.`);
  updateStats();
  return true;
}

// Share card (play page only): export the current solution, or load a pasted link.
async function exportLink() {
  const query = `board=${encodeURIComponent($('level').value)}&walls=${[...walls].sort((a, b) => a - b).join(',')}`;
  const link = location.href.split(/[?#]/)[0] + '?' + query;
  setUrl(query);
  $('shareLink').value = link;
  const summary = `path length ${dist[ENTRY]} using ${walls.size} of ${BUDGET} walls`;
  try {
    await navigator.clipboard.writeText(link);
    say(`Link copied: ${summary}.`);
  } catch (e) {
    $('shareLink').select();
    say(`Link ready to copy from the Share box: ${summary}.`);
  }
}

function loadLink() {
  const text = $('shareLink').value.trim();
  if (!text) { say('Paste a shared link first.'); return; }
  const query = text.slice(text.indexOf('?') + 1).split('#')[0];
  if (!loadFromQuery(query)) { say("That link doesn't name a known board."); return; }
  setUrl(query);
  if (!$('msg').textContent) say(`Opened ${LEVEL.label} with no walls.`);
}

if ($('bExport')) {
  $('bExport').onclick = exportLink;
  $('bLoad').onclick = loadLink;
  $('shareLink').onkeydown = e => { if (e.key === 'Enter') loadLink(); };
}

$('bClear').onclick = () => {
  if (mode !== 'edit') return;
  assisted = false;
  walls.clear(); recompute(); say(''); $('saInfo').textContent = '';
};

function setButtons() {
  const busy = mode !== 'edit';
  $('bOpt').disabled = busy; $('bClear').disabled = busy;
  $('bExact').disabled = busy && mode !== 'exact';
  $('bExact').textContent = mode === 'exact' ? 'Stop' : 'Solve exactly';
  document.querySelectorAll('[data-lock]').forEach(el => el.disabled = busy);
}

function updateStats() {
  $('sWalls').textContent = `${walls.size}/${BUDGET}`;
  $('sLen').textContent = dist[ENTRY];
  $('sMine').textContent = myBest || '–';
  $('sOpt').textContent = optBest || '–';
  $('sExact').textContent = exactBest || '–';
}
