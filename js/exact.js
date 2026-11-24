// Exact solver: branch and bound over the shortest path (small board only).

// exact solver: branch and bound over the shortest path
// A layout can only beat the current one if it blocks a tile of the current
// shortest path. So from any wall set, branch on every tile of that path.
let ex = null;
const keyOf = arr => String.fromCharCode(...arr.slice().sort((a, b) => a - b));

$('bExact').onclick = () => {
  if (mode === 'exact') { ex.stopped = true; return; }
  if (mode !== 'edit') return;
  mode = 'exact'; setButtons();
  ex = { stack: [[]], seen: new Set([keyOf([])]), nodes: 0, best: -1, bestWalls: [], cur: [],
         t0: performance.now(), stopped: false };
  say('Exact search running: trying every way to block the shortest path.');
};

function stepExact() {
  const until = performance.now() + 12;
  while (ex.stack.length && !ex.stopped && performance.now() < until) {
    for (let k = 0; k < 100 && ex.stack.length; k++) {
      const S = ex.stack.pop();
      ex.nodes++;
      const p = pathOf(new Set(S));
      if (!p.length) continue; // this wall set seals the exit
      const len = p.length - 1;
      if (len > ex.best) { ex.best = len; ex.bestWalls = S; }
      ex.cur = S;
      if (S.length >= BUDGET) continue;
      for (let j = 1; j < p.length - 1; j++) {
        const T = S.concat(p[j]), key = keyOf(T);
        if (ex.seen.has(key)) continue;
        ex.seen.add(key); ex.stack.push(T);
      }
    }
  }
  const secs = ((performance.now() - ex.t0) / 1000).toFixed(1);
  const finished = !ex.stack.length || ex.stopped;
  walls = new Set(finished ? ex.bestWalls : ex.cur);
  bfs(walls, dist);
  $('saInfo').textContent =
    `exact · ${ex.nodes.toLocaleString()} layouts checked · ${ex.stack.length.toLocaleString()} queued · best ${ex.best} · ${secs}s`;
  if (finished) {
    if (ex.stopped) {
      say(`Stopped early: best found ${ex.best}, but it is not proven optimal.`);
    } else {
      exactBest = ex.best;
      const cmp = optBest ? ` The optimizer's best on this board is ${optBest}.` : '';
      say(`Proven optimal: path length ${ex.best} using ${ex.bestWalls.length} of ${BUDGET} walls. ` +
          `Checked ${ex.nodes.toLocaleString()} distinct layouts in ${secs}s.${cmp} Press Clear to try your own.`);
    }
    assisted = true;
    ex = null; mode = 'edit'; setButtons();
  }
  updateStats();
}
