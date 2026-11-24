// Exact prover: finds the longest achievable shortest path and proves it.
//
// To decide "can `budget` walls make every route at least T steps long?":
//   - Take the current shortest route. If it is shorter than T, one of its
//     tiles must get a wall, so branch on each of them. Branch i walls tile i
//     and forbids tiles 1..i-1, so no layout is ever visited twice.
//   - Bound: greedily collect routes shorter than T that share no wallable
//     tile. Each needs its own wall, so if there are more than the walls left,
//     the branch is dead.
//   - A layout that seals the exit is dead too (more walls never reopen it).
// Starting from the optimizer's best length B, it proves T = B + 1 impossible
// (B is optimal) or finds a longer layout and tries again. The top of the
// search tree is split into subtrees that worker threads solve in parallel.
//
// Usage: node bench/prove.js <board> [--start N] [--time seconds] [--budget walls]
//                                    [--workers N] [--split depth]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const LEVELS = new Function(fs.readFileSync(path.join(__dirname, '../js/levels.js'), 'utf8') + '; return LEVELS;')();
const args = isMainThread ? process.argv.slice(2) : workerData.args;
const name = args[0];
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? +args[i + 1] : undefined; };
const def = LEVELS[name];
if (!def) { console.log('unknown board ' + name); process.exit(1); }

const { W, H } = def;
const budget = opt('budget') || def.budget;
const N = W * H;
const s = def.entry[1] * W + def.entry[0], t = def.exit[1] * W + def.exit[0];
const rock = new Uint8Array(N);
for (const [x, y] of def.rocks) rock[y * W + x] = 1;
const nbrs = [];
for (let c = 0; c < N; c++) {
  const x = c % W, y = (c / W) | 0, list = [];
  if (x > 0) list.push(c - 1); if (x < W - 1) list.push(c + 1);
  if (y > 0) list.push(c - W); if (y < H - 1) list.push(c + W);
  nbrs.push(list.filter(n => !rock[n]));
}

const dist = new Int32Array(N), queue = new Int32Array(N);
// Shortest route from s to t avoiding `mask`, as interior tiles; null if sealed.
function route(mask) {
  dist.fill(-1);
  let head = 0, tail = 0;
  dist[t] = 0; queue[tail++] = t;
  while (head < tail) {
    const c = queue[head++];
    if (c === s) break;
    for (const n of nbrs[c]) if (dist[n] < 0 && !mask[n]) { dist[n] = dist[c] + 1; queue[tail++] = n; }
  }
  if (dist[s] < 0) return null;
  const p = [];
  let c = s;
  while (c !== t) {
    for (const n of nbrs[c]) if (dist[n] === dist[c] - 1) { c = n; break; }
    if (c !== t) p.push(c);
  }
  return p;
}

const wall = new Uint8Array(N), forbid = new Uint8Array(N), tmp = new Uint8Array(N);
let T, nodes = 0;

// Lower bound on walls still needed: routes shorter than T with no shared wallable tile.
function packing(k) {
  tmp.set(wall);
  let count = 0;
  for (;;) {
    const p = route(tmp);
    if (!p || p.length + 1 >= T) return count;
    let free = 0;
    for (const c of p) if (!forbid[c]) { tmp[c] = 1; free++; }
    if (!free) return Infinity;
    if (++count > k) return count;
  }
}

// Depth-first search with k walls left. Returns a layout reaching T, or null.
// With `split` > 0, instead of descending further it hands each node at that
// depth to `emit` and returns null.
function dfs(k, split = 0, emit = null) {
  nodes++;
  const p = route(wall);
  if (!p) return null;
  if (p.length + 1 >= T) return { len: p.length + 1, walls: [...wall.keys()].filter(c => wall[c]) };
  if (k === 0 || packing(k) > k) return null;
  const cand = p.filter(c => !forbid[c]);
  let res = null, i = 0;
  for (; i < cand.length && !res; i++) {
    const c = cand[i];
    wall[c] = 1;
    if (split === 1) emit({ wall: wall.slice(), forbid: forbid.slice(), k: k - 1 });
    else res = dfs(k - 1, split - 1, emit);
    wall[c] = 0;
    forbid[c] = 1;
  }
  for (let j = 0; j < i; j++) forbid[cand[j]] = 0;
  return res;
}

if (!isMainThread) {
  parentPort.on('message', task => {
    T = task.T;
    wall.set(task.wall); forbid.set(task.forbid);
    const n0 = nodes;
    const res = dfs(task.k);
    parentPort.postMessage({ res, nodes: nodes - n0 });
  });
} else {
  main();
}

// Decide one target T in parallel: split the tree, run subtrees on workers.
function solveT(pool, split, deadline) {
  const tasks = [];
  wall.fill(0); forbid.fill(0);
  const direct = dfs(budget, split, x => tasks.push(x));
  if (direct) return Promise.resolve({ res: direct, nodes });
  return new Promise(resolve => {
    let next = 0, running = 0, total = nodes, done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    const feed = w => {
      if (done) return;
      if (Date.now() > deadline) { if (!running) finish({ timeout: true, nodes: total }); return; }
      if (next >= tasks.length) { if (!running) finish({ res: null, nodes: total, tasks: tasks.length }); return; }
      running++;
      w.postMessage(Object.assign({ T }, tasks[next++]));
    };
    for (const w of pool) {
      w.on('message', m => {
        running--; total += m.nodes;
        if (m.res) return finish({ res: m.res, nodes: total });
        feed(w);
      });
    }
    pool.forEach(feed);
  });
}

async function main() {
  const S = require('../js/solvers.js');
  require('../js/combos.js')(S);
  const t0 = Date.now(), deadline = t0 + (opt('time') || 3600) * 1000;
  const nw = opt('workers') || os.cpus().length, split = opt('split') || 2;
  let best;
  if (opt('start')) best = { len: opt('start'), walls: null };
  else {
    const r = S.runToEnd(Object.assign({}, def, { budget }), def.optMethod, { maxEvals: def.optEvals, seed: 1 });
    best = { len: r.len, walls: r.walls };
  }
  console.log(`${name}: ${W}x${H}, ${budget} walls, optimizer start ${best.len}, ${nw} workers`);
  let proven = false;
  for (;;) {
    T = best.len + 1;
    nodes = 0;
    const t1 = Date.now();
    // a fresh pool per target, so replies from the previous target can't leak in
    const pool = Array.from({ length: nw }, () => new Worker(__filename, { workerData: { args } }));
    const r = await solveT(pool, split, deadline);
    await Promise.all(pool.map(w => w.terminate()));
    const info = `${r.nodes.toLocaleString()} nodes, ${((Date.now() - t1) / 1000).toFixed(1)}s`;
    if (r.timeout) { console.log(`  T=${T}: time limit reached (${info})`); break; }
    console.log(`  T=${T}: ${r.res ? 'found ' + r.res.len : 'impossible'}  (${info})`);
    if (!r.res) { proven = true; break; }
    best = r.res;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`RESULT ${name} ${proven ? 'optimum' : 'best'} ${best.len} ${proven ? 'PROVEN' : 'UNPROVEN'} in ${secs}s`);
  if (best.walls) console.log('walls ' + JSON.stringify(best.walls.map(c => [c % W, (c / W) | 0])));
}
