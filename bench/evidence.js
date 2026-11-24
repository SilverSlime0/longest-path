// Evidence for boards too large to prove: run optimizers many times at
// increasing budgets (up to 300× the Optimize button's) and record how often
// each length is reached. If the best length shows up again and again and much
// longer runs never beat it, it is very likely the optimum.
//
// Usage: node bench/evidence.js large,large2 [--workers 12]
//        [--tiers method:mult:seeds:firstSeed,...]  (adds to existing results)
// Writes bench/evidence.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const S = require('../js/solvers.js');
require('../js/combos.js')(S);
const LEVELS = new Function(fs.readFileSync(path.join(__dirname, '../js/levels.js'), 'utf8') + '; return LEVELS;')();

// [method, evaluations as a multiple of the board's optEvals, seeds]
const TIERS = [
  ['pt-restarts', 1, 40],
  ['pt-restarts', 10, 12],
  ['pt+tb+compound', 10, 8],
  ['pt-restarts', 100, 4],
  ['pt-restarts', 300, 2],
];

if (!isMainThread) {
  parentPort.on('message', j => {
    const r = S.runToEnd(LEVELS[j.board], j.method, { maxEvals: j.evals, seed: j.seed });
    parentPort.postMessage(Object.assign(j, { len: r.len, walls: r.walls, ms: r.ms }));
  });
} else {
  const args = process.argv.slice(2);
  const boards = args[0].split(',');
  const wi = args.indexOf('--workers');
  const nw = wi >= 0 ? +args[wi + 1] : os.cpus().length;
  // --tiers method:mult:seeds:firstSeed,... adds runs to the existing results
  const ti = args.indexOf('--tiers');
  const extra = ti >= 0 ? args[ti + 1].split(',').map(x => x.split(':')) : null;
  const tiers = extra ? extra.map(([m, mult, n, first]) => [m, +mult, +n, +first]) : TIERS.map(t => [...t, 1]);
  const jobs = [];
  for (const board of boards) for (const [method, mult, seeds, first] of tiers)
    for (let seed = first; seed < first + seeds; seed++) jobs.push({ board, method, mult, evals: LEVELS[board].optEvals * mult, seed });
  jobs.sort((a, b) => b.evals - a.evals); // longest first, for load balance
  const out = path.join(__dirname, 'evidence.json');
  const results = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  for (const b of boards) if (!extra || !results[b]) results[b] = [];
  let next = 0, done = 0;
  const t0 = Date.now();
  const pool = Array.from({ length: Math.min(nw, jobs.length) }, () => new Worker(__filename));
  const feed = w => { if (next < jobs.length) w.postMessage(jobs[next++]); else w.terminate(); };
  for (const w of pool) {
    w.on('message', r => {
      results[r.board].push(r);
      done++;
      console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s ${done}/${jobs.length}] ${r.board} ${r.method} ${r.mult}x seed ${r.seed}: ${r.len}`);
      feed(w);
    });
    feed(w);
  }
  process.on('exit', () => {
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
    for (const b of boards) {
      const rs = results[b], best = Math.max(...rs.map(r => r.len));
      console.log(`\n${b}: best ${best}, reached by ${rs.filter(r => r.len === best).length}/${rs.length} runs`);
      const seen = [...new Set(rs.map(r => r.method + ':' + r.mult))].map(k => k.split(':'));
      seen.sort((a, b) => a[1] - b[1]);
      for (const [method, mult] of seen.map(([m, x]) => [m, +x])) {
        const t = rs.filter(r => r.method === method && r.mult === mult).map(r => r.len);
        if (!t.length) continue;
        const counts = {};
        for (const l of t) counts[l] = (counts[l] || 0) + 1;
        console.log(`  ${method.padEnd(15)} ${String(mult).padStart(3)}x  ` +
          Object.entries(counts).sort((a, b) => b[0] - a[0]).map(([l, n]) => `${l}×${n}`).join('  '));
      }
    }
  });
}
