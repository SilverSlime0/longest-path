// Restart sweep: how many restarts work best at each evaluation budget?
// Runs both restart methods (annealing and tempering, with tie-break scoring) on
// every board, over a grid of budgets and restart counts, using the same seeds in
// every cell. Progress is saved to bench/restarts.json, so an interrupted run resumes.
//
// --validate checks the fitted rule (sa-auto, pt-auto) against the old fixed
// counts (multi10+tb, pt-restarts) on new seeds and on budgets outside the grid,
// and writes bench/restarts-validate.json.
//
// Usage: node bench/restarts.js [--workers N] [--boards small,large] [--report]
//        node bench/restarts.js --validate [--workers N] [--report]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const S = require('../js/solvers.js');
require('../js/combos.js')(S);
const LEVELS = new Function(fs.readFileSync(path.join(__dirname, '../js/levels.js'), 'utf8') + '; return LEVELS;')();

const COUNTS = [1, 2, 3, 5, 8, 12, 20, 30, 50];
const FAMILIES = ['sa', 'pt'];
const GRID = {
  small: { budgets: [1000, 2000, 5000, 15000, 50000], trials: 120 },
  medium: { budgets: [5000, 15000, 50000, 150000, 500000], trials: 24 },
  large: { budgets: [30000, 100000, 300000, 1000000], trials: 12 },
};
const MIN_EVALS_PER_RESTART = 300; // below this a restart can barely finish its setup

// Budgets the rule wasn't fitted to, plus each size's default; seeds start at 1001.
const VALIDATE = {
  small: { budgets: [3000, 5000, 8000, 30000], trials: 120 },
  medium: { budgets: [10000, 30000, 50000, 100000, 300000], trials: 24 },
  large: { budgets: [50000, 200000, 300000, 600000], trials: 12 },
};
const PAIRS = [['sa', 'multi10+tb', 'sa-auto'], ['pt', 'pt-restarts', 'pt-auto']];

function methodId(family, runs) {
  if (runs === 'id') return family;
  const id = `${family}:${runs}`;
  if (!S.METHODS.find(m => m.id === id)) {
    const { restarts, ptRestarts } = S.parts;
    const run = family === 'sa' ? function* (ctx) { yield* restarts(ctx, runs, 1); } : ptRestarts(runs, 6);
    S.addMethod({ id, name: id, tiebreak: true, run });
  }
  return id;
}

if (!isMainThread) {
  parentPort.on('message', j => {
    const r = S.runToEnd(LEVELS[j.board], methodId(j.family, j.runs), { maxEvals: j.evals, seed: j.seed });
    parentPort.postMessage(Object.assign(j, { len: r.len, ms: r.ms }));
  });
} else {
  main();
}

function main() {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
  const validate = args.includes('--validate');
  const out = path.join(__dirname, validate ? 'restarts-validate.json' : 'restarts.json');
  const data = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  if (args.includes('--report')) return validate ? reportValidate(data) : report(data);

  const boards = opt('boards') ? opt('boards').split(',') : Object.keys(LEVELS);
  const jobs = [];
  if (validate) for (const board of boards) {
    const { budgets, trials } = VALIDATE[LEVELS[board].size];
    for (const evals of budgets) for (const [, fixed, auto] of PAIRS) for (const family of [fixed, auto]) {
      const done = (data[`${board}|${family}|${evals}|id`] || {}).lens || {};
      for (let seed = 1001; seed < 1001 + trials; seed++) if (!(seed in done)) jobs.push({ board, family, evals, runs: 'id', seed });
    }
  } else for (const board of boards) {
    const { budgets, trials } = GRID[LEVELS[board].size];
    for (const evals of budgets) for (const family of FAMILIES) for (const runs of COUNTS) {
      if (evals / runs < MIN_EVALS_PER_RESTART) continue;
      const done = (data[`${board}|${family}|${evals}|${runs}`] || {}).lens || {};
      for (let seed = 1; seed <= trials; seed++) if (!(seed in done)) jobs.push({ board, family, evals, runs, seed });
    }
  }
  // shuffle-free but balanced: cheap jobs first, so early results cover the whole grid
  jobs.sort((a, b) => a.evals - b.evals);
  const total = jobs.reduce((a, j) => a + j.evals, 0);
  console.log(`${jobs.length} runs, ${(total / 1e9).toFixed(2)} billion evaluations`);

  const nw = +opt('workers') || Math.max(1, os.cpus().length - 1);
  const save = () => fs.writeFileSync(out, JSON.stringify(data));
  const t0 = Date.now();
  let next = 0, doneEvals = 0, lastLog = 0, active = 0;
  if (!jobs.length) return;
  for (let i = 0; i < Math.min(nw, jobs.length); i++) {
    const w = new Worker(__filename);
    active++;
    const feed = () => { if (next < jobs.length) w.postMessage(jobs[next++]); else { w.terminate(); if (--active === 0) { save(); console.log('done'); } } };
    w.on('message', r => {
      const key = `${r.board}|${r.family}|${r.evals}|${r.runs}`;
      const cell = data[key] = data[key] || { lens: {}, ms: 0 };
      cell.lens[r.seed] = r.len; cell.ms += r.ms;
      doneEvals += r.evals;
      if (Date.now() - lastLog > 30000) {
        lastLog = Date.now();
        save();
        const secs = (Date.now() - t0) / 1000;
        console.log(`${secs.toFixed(0)}s  ${(doneEvals / total * 100).toFixed(1)}%  about ${(secs * (total / doneEvals - 1) / 60).toFixed(0)} min left`);
      }
      feed();
    });
    feed();
  }
}

// Rule against fixed count: paired on board and seed, with a standard error on
// the mean difference in path length (positive means the rule is longer).
function reportValidate(data) {
  for (const size of Object.keys(VALIDATE)) for (const [label, fixed, auto] of PAIRS) {
    console.log(`\n${size} / ${label}: ${auto} minus ${fixed}`);
    for (const evals of VALIDATE[size].budgets) {
      const diffs = [];
      let sumF = 0, sumA = 0;
      for (const [b, L] of Object.entries(LEVELS)) {
        if (L.size !== size) continue;
        const f = (data[`${b}|${fixed}|${evals}|id`] || {}).lens, a = (data[`${b}|${auto}|${evals}|id`] || {}).lens;
        if (!f || !a) continue;
        for (const s of Object.keys(f)) if (s in a) { diffs.push(a[s] - f[s]); sumF += f[s]; sumA += a[s]; }
      }
      if (!diffs.length) continue;
      const m = diffs.reduce((x, d) => x + d, 0) / diffs.length;
      const v = diffs.reduce((x, d) => x + (d - m) ** 2, 0) / Math.max(1, diffs.length - 1);
      const se = Math.sqrt(v / diffs.length);
      console.log(`  ${String(evals).padStart(7)}  fixed ${(sumF / diffs.length).toFixed(2)}  rule ${(sumA / diffs.length).toFixed(2)}  diff ${m >= 0 ? '+' : ''}${m.toFixed(2)} ± ${se.toFixed(2)}  (n=${diffs.length})`);
    }
  }
}

// For each size and budget, shows each restart count's score: the mean, over
// boards and seeds, of the path length as a percentage of that board's best
// length, plus how often it reached that best length.
function report(data) {
  const cells = Object.entries(data).map(([k, c]) => {
    const [board, family, evals, runs] = k.split('|');
    return { board, family, evals: +evals, runs: +runs, lens: Object.values(c.lens) };
  });
  const bestOf = {};
  for (const c of cells) for (const l of c.lens) bestOf[c.board] = Math.max(bestOf[c.board] || 0, l);
  for (const b of Object.keys(bestOf)) {
    const known = LEVELS[b].optimum || LEVELS[b].bestKnown;
    if (known) bestOf[b] = Math.max(bestOf[b], known);
  }
  for (const size of Object.keys(GRID)) for (const family of FAMILIES) {
    console.log(`\n${size} / ${family}  (mean % of best length, hit rate of best)`);
    for (const evals of GRID[size].budgets) {
      const parts = [];
      let top = -1;
      const rows = COUNTS.map(runs => {
        const lens = [], hits = [];
        for (const c of cells) if (LEVELS[c.board].size === size && c.family === family && c.evals === evals && c.runs === runs) {
          for (const l of c.lens) { lens.push(l / bestOf[c.board] * 100); hits.push(l >= bestOf[c.board] ? 1 : 0); }
        }
        if (!lens.length) return null;
        const mean = lens.reduce((a, x) => a + x, 0) / lens.length;
        const hit = hits.reduce((a, x) => a + x, 0) / hits.length * 100;
        top = Math.max(top, mean);
        return { runs, mean, hit, n: lens.length };
      }).filter(Boolean);
      for (const r of rows) parts.push(`${r.mean === top ? '*' : ' '}${r.runs}: ${r.mean.toFixed(1)}/${r.hit.toFixed(0)}%`);
      console.log(`  ${String(evals).padStart(8)}  ${parts.join('  ')}`);
    }
  }
}
