// Benchmark: runs optimizer methods on the game's boards with equal evaluation
// budgets and several seeds, then writes bench/results.json and
// bench/results.js (loaded by lab.html).
//
// Usage: node bench/bench.js [--boards small,large] [--methods id,id] [--trials 20]
//                            [--evals-small 5000] [--evals-medium 50000] [--evals-large 300000]
//                            [--out file.json]  (write only that file; for parallel runs, then merge)
const fs = require('fs');
const path = require('path');
const S = require('../js/solvers.js');
require('../js/combos.js')(S);

const LEVELS = new Function(fs.readFileSync(path.join(__dirname, '../js/levels.js'), 'utf8') + '; return LEVELS;')();

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const boards = (args.boards || 'small,large').split(',');
const methods = args.methods ? args.methods.split(',') : S.METHODS.map(m => m.id);
const bySize = {
  small: { maxEvals: +(args['evals-small'] || 5000), trials: +(args.trials || 200) },
  medium: { maxEvals: +(args['evals-medium'] || 50000), trials: +(args.trials || 40) },
  large: { maxEvals: +(args['evals-large'] || 300000), trials: +(args.trials || 12) },
};
const settings = Object.fromEntries(Object.entries(LEVELS).map(([k, L]) =>
  [k, Object.assign({ optimum: L.optimum }, bySize[L.size])]));

const outJson = args.out ? path.resolve(args.out) : path.join(__dirname, 'results.json');
const results = fs.existsSync(outJson) ? JSON.parse(fs.readFileSync(outJson, 'utf8')) : { boards: {} };

for (const board of boards) {
  const { maxEvals, trials } = settings[board];
  const store = results.boards[board] = results.boards[board] || { maxEvals, methods: {} };
  if (store.maxEvals !== maxEvals) { store.maxEvals = maxEvals; store.methods = {}; }
  for (const id of methods) {
    const m = S.METHODS.find(x => x.id === id);
    if (!m) { console.log(`unknown method ${id}`); continue; }
    const runs = [];
    for (let seed = 1; seed <= trials; seed++) {
      const r = S.runToEnd(LEVELS[board], id, { maxEvals, seed });
      runs.push({ len: r.len, ms: r.ms, evals: r.evals, proven: r.proven, walls: r.walls });
    }
    store.methods[id] = { name: m.name, group: m.group, runs };
    const lens = runs.map(r => r.len);
    const mean = lens.reduce((a, c) => a + c, 0) / lens.length;
    const ms = runs.reduce((a, r) => a + r.ms, 0) / runs.length;
    const target = settings[board].optimum;
    const hit = target ? `hit ${(lens.filter(l => l >= target).length / lens.length * 100).toFixed(0).padStart(3)}%  ` : '';
    console.log(`${board.padEnd(5)} ${id.padEnd(16)} ${hit}mean ${mean.toFixed(1).padStart(5)}  min ${Math.min(...lens)}  max ${Math.max(...lens)}  ${ms.toFixed(0)}ms/run`);
  }
  // best known = best length any method has ever reached on this board
  let best = 0, bestWalls = [];
  for (const m of Object.values(store.methods)) for (const r of m.runs) if (r.len > best) { best = r.len; bestWalls = r.walls; }
  if (best > (store.bestKnown || 0)) { store.bestKnown = best; store.bestKnownWalls = bestWalls; }
}

results.generated = new Date().toISOString();
fs.writeFileSync(outJson, JSON.stringify(results));
if (args.out) { console.log('wrote ' + outJson); return; }
fs.writeFileSync(path.join(__dirname, 'results.js'), 'window.BENCH = ' + JSON.stringify(results) + ';\n');
console.log('wrote bench/results.json and bench/results.js');
