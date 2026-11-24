// Optimizer: runs the method that won the lab benchmark for this board
// (see js/solvers.js, js/combos.js and the lab page).

$('bOpt').onclick = () => {
  if (mode !== 'edit') return;
  mode = 'opt'; setButtons();
  const run = Solvers.createRun(LEVEL, LEVEL.optMethod, {
    maxEvals: LEVEL.optEvals, seed: 1 + ((Math.random() * 1e9) | 0), yieldEvery: 20,
  });
  sa = { run, snap: null };
  say(`Optimizer running: ${run.method.name}.`);
};

// Each frame uses at least 1/200 of the evaluation budget, so a run takes up to
// 200 frames, or more if the 30 ms per-frame limit cuts frames short.
function stepOpt() {
  const ev = sa.run.ctx.ev, e0 = ev.evals, t0 = performance.now();
  const quota = LEVEL.optEvals / 200;
  let result = null;
  while (ev.evals - e0 < quota && performance.now() - t0 < 30) {
    const s = sa.run.gen.next();
    if (s.done) { result = s.value; break; }
    sa.snap = s.value;
  }
  if (result) {
    walls = new Set(result.walls);
    bfs(walls, dist);
    optBest = Math.max(optBest, result.len);
    $('saInfo').textContent = `done · ${sa.run.method.name} · ${result.evals.toLocaleString()} evaluations · length ${result.len}`;
    say(`Optimizer finished: path length ${result.len} using ${result.walls.length} of ${BUDGET} walls ` +
        `(your best: ${myBest || '–'}). Every remaining wall is needed: removing any one shortens the path. ` +
        'Press Clear to try your own.');
    assisted = true;
    sa = null; mode = 'edit'; setButtons();
  } else if (sa.snap) {
    walls = new Set(sa.snap.curWalls || sa.snap.bestWalls);
    bfs(walls, dist);
    $('saInfo').textContent = `${sa.run.method.name} · ${sa.snap.phase} · ` +
      `${sa.snap.evals.toLocaleString()}/${LEVEL.optEvals.toLocaleString()} evaluations · best ${sa.snap.best}`;
  }
  updateStats();
}
