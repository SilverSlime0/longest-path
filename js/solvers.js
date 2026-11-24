// Optimizer library shared by the lab page (browser) and the benchmark (Node).
// Every method is a generator that yields progress snapshots and stops after
// opts.maxEvals path evaluations (one BFS = one evaluation), so methods can be
// compared on equal effort.
(function (root) {
'use strict';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- basics ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const keyOf = cells => String.fromCharCode(...cells.slice().sort((a, b) => a - b));

function makeBoard(def) {
  const W = def.W, H = def.H, N = W * H;
  const idx = (x, y) => y * W + x;
  const rock = new Uint8Array(N);
  for (const [x, y] of def.rocks) rock[idx(x, y)] = 1;
  const nbrs = [];
  for (let c = 0; c < N; c++) {
    const x = c % W, y = (c / W) | 0, list = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) list.push(idx(nx, ny));
    }
    nbrs.push(list);
  }
  const entry = idx(...def.entry), exit = idx(...def.exit);
  const open = [];
  for (let c = 0; c < N; c++) if (!rock[c] && c !== entry && c !== exit) open.push(c);
  return { W, H, N, idx, rock, nbrs, entry, exit, open, budget: def.budget };
}

// BFS from the exit. Stops as soon as the entry is dequeued, which is enough
// for the path length, the number of shortest paths, and extracting a path.
class Evaluator {
  constructor(b, tiebreak) {
    this.b = b; this.tiebreak = !!tiebreak; this.evals = 0;
    this.dist = new Int32Array(b.N); this.cnt = new Float64Array(b.N); this.q = new Int32Array(b.N);
  }
  run(mask) {
    this.evals++;
    const { dist, cnt, q, b } = this;
    dist.fill(-1);
    let h = 0, t = 0;
    dist[b.exit] = 0; cnt[b.exit] = 1; q[t++] = b.exit;
    while (h < t) {
      const c = q[h++];
      if (c === b.entry) return dist[c];
      const dc = dist[c] + 1;
      for (const n of b.nbrs[c]) {
        if (b.rock[n] || mask[n]) continue;
        if (dist[n] === -1) { dist[n] = dc; cnt[n] = cnt[c]; q[t++] = n; }
        else if (dist[n] === dc) cnt[n] += cnt[c];
      }
    }
    return -1;
  }
  // Path length, plus (with tie-break) a bonus below 1 that grows as the number
  // of shortest paths shrinks, so "almost blocked" layouts rank higher.
  score(mask) {
    const L = this.run(mask);
    if (L < 0) return -Infinity;
    return this.tiebreak ? L + 0.9 / this.cnt[this.b.entry] : L;
  }
  // One shortest path from the most recent run, entry to exit, without endpoints.
  path(rng) {
    const { dist, b } = this, p = [];
    let c = b.entry;
    while (true) {
      let nxt = -1, seen = 0;
      for (const n of b.nbrs[c]) {
        if (dist[n] >= 0 && dist[n] === dist[c] - 1 && !(b.rock[n])) {
          seen++;
          if (nxt < 0 || (rng && rng() * seen < 1)) nxt = n;
        }
      }
      c = nxt;
      if (c === b.exit || c < 0) break;
      p.push(c);
    }
    return p;
  }
}

// Wall list + mask + cell->index map kept in sync.
class Layout {
  constructor(b) { this.b = b; this.mask = new Uint8Array(b.N); this.pos = new Int32Array(b.N).fill(-1); this.walls = []; }
  static from(b, cells) { const L = new Layout(b); for (const c of cells) L.add(c); return L; }
  add(c) { this.pos[c] = this.walls.length; this.walls.push(c); this.mask[c] = 1; }
  removeCell(c) {
    const i = this.pos[c], last = this.walls.pop();
    this.mask[c] = 0; this.pos[c] = -1;
    if (last !== c) { this.walls[i] = last; this.pos[last] = i; }
  }
  free(c) { const b = this.b; return !b.rock[c] && !this.mask[c] && c !== b.entry && c !== b.exit; }
}

// pairs: [[wallIndex, newCell], ...]; returns the pairs that undo the move.
function applyMoves(L, pairs) {
  const undo = pairs.map(([i]) => [i, L.walls[i]]);
  for (const [i] of pairs) { const c = L.walls[i]; L.mask[c] = 0; L.pos[c] = -1; }
  for (const [i, c] of pairs) { L.walls[i] = c; L.mask[c] = 1; L.pos[c] = i; }
  return undo;
}

// ---------- shared building blocks ----------
function* tick(ctx, walls, phase) {
  if (ctx.ev.evals >= ctx.nextYield) {
    ctx.nextYield = ctx.ev.evals + ctx.yieldEvery;
    yield { evals: ctx.ev.evals, maxEvals: ctx.opts.maxEvals, best: Math.floor(ctx.best.score),
            bestWalls: ctx.best.walls, curWalls: walls, phase };
  }
}

function randomFill(ctx, L) {
  const { b, ev, rng } = ctx;
  for (let tries = 0; L.walls.length < b.budget && tries < 20000; tries++) {
    const c = b.open[(rng() * b.open.length) | 0];
    if (!L.free(c)) continue;
    L.add(c);
    if (ev.run(L.mask) < 0) L.removeCell(c);
  }
  return L;
}

// Like randomFill, but most new walls go onto the current shortest path.
function fillPathBiased(ctx, L) {
  const { b, ev, rng } = ctx;
  for (let tries = 0; L.walls.length < b.budget && tries < 2000; tries++) {
    if (ev.run(L.mask) < 0) return L;
    const p = ev.path(rng);
    const c = rng() < 0.7 && p.length ? p[(rng() * p.length) | 0] : b.open[(rng() * b.open.length) | 0];
    if (!L.free(c)) continue;
    L.add(c);
    if (ev.run(L.mask) < 0) L.removeCell(c);
  }
  return L;
}

function neighborOf(ctx, c) { const n = ctx.b.nbrs[c]; return n[(ctx.rng() * n.length) | 0]; }

// Single move: one wall to a tile on/next to the shortest path (or anywhere).
function proposeSingle(ctx, L, path) {
  const { b, rng } = ctx;
  if (!L.walls.length) return null;
  const i = (rng() * L.walls.length) | 0, r = rng();
  let c;
  if (r < 0.85 && path.length) {
    const base = path[(rng() * path.length) | 0];
    c = r < 0.55 ? base : neighborOf(ctx, base);
  } else c = b.open[(rng() * b.open.length) | 0];
  return L.free(c) ? [[i, c]] : null;
}

// Compound moves: relocate 2-3 walls at once, or slide a whole connected
// barrier one tile sideways.
function proposeCompound(ctx, L, path) {
  const { b, rng } = ctx;
  if (rng() < 0.5) {
    const k = 2 + (rng() < 0.5 ? 1 : 0), pairs = [], usedI = new Set(), usedC = new Set();
    for (let t = 0; t < k * 4 && pairs.length < k; t++) {
      const m = proposeSingle(ctx, L, path);
      if (!m) continue;
      const [i, c] = m[0];
      if (usedI.has(i) || usedC.has(c)) continue;
      usedI.add(i); usedC.add(c); pairs.push([i, c]);
    }
    return pairs.length ? pairs : null;
  }
  const start = L.walls[(rng() * L.walls.length) | 0];
  const comp = [start], inComp = new Set(comp);
  for (let h = 0; h < comp.length && comp.length < 10; h++)
    for (const n of b.nbrs[comp[h]]) if (L.mask[n] && !inComp.has(n)) { inComp.add(n); comp.push(n); }
  const [dx, dy] = DIRS[(rng() * 4) | 0];
  const pairs = [];
  for (const c of comp) {
    const x = c % b.W + dx, y = ((c / b.W) | 0) + dy;
    if (x < 0 || y < 0 || x >= b.W || y >= b.H) return null;
    const t = b.idx(x, y);
    if (b.rock[t] || t === b.entry || t === b.exit || (L.mask[t] && !inComp.has(t))) return null;
    pairs.push([L.pos[c], t]);
  }
  return pairs;
}

// One Metropolis step for a chain R = {L, cur, path, bestScore, bestWalls}.
function saStep(ctx, R, T, compound) {
  const { ev, rng } = ctx;
  const moves = compound && rng() < compound ? proposeCompound(ctx, R.L, R.path) : proposeSingle(ctx, R.L, R.path);
  if (!moves) return false;
  const undo = applyMoves(R.L, moves);
  const s = ev.score(R.L.mask);
  if (s > -Infinity && (s >= R.cur || rng() < Math.exp((s - R.cur) / T))) {
    R.cur = s; R.path = ev.path(rng);
    if (s > R.bestScore) { R.bestScore = s; R.bestWalls = R.L.walls.slice(); }
    ctx.consider(R.L, s);
  } else applyMoves(R.L, undo);
  return true;
}

function makeChain(ctx, L) {
  const s = ctx.ev.score(L.mask);
  ctx.consider(L, s);
  return { L, cur: s, path: ctx.ev.path(ctx.rng), bestScore: s, bestWalls: L.walls.slice() };
}

// Simulated annealing for evBudget evaluations. Options: compound move rate,
// and reheat (fraction of the budget without progress before reheating).
function* anneal(ctx, L, evBudget, { T0 = 4, T1 = 0.05, compound = 0, reheat = 0 } = {}) {
  const { ev, b } = ctx;
  const end = Math.min(ctx.opts.maxEvals, ev.evals + evBudget);
  let R = makeChain(ctx, L);
  const alpha = Math.pow(T1 / T0, 1 / evBudget);
  let T = T0, lastE = ev.evals, lastImp = ev.evals, bestHere = R.cur, spins = 0;
  while (ev.evals < end) {
    if (!saStep(ctx, R, T, compound) && ++spins > 500) { ev.evals++; spins = 0; }
    T *= Math.pow(alpha, ev.evals - lastE); lastE = ev.evals;
    if (R.cur > bestHere) { bestHere = R.cur; lastImp = ev.evals; }
    if (reheat && ev.evals - lastImp > reheat * evBudget) {
      const keep = { bestScore: R.bestScore, bestWalls: R.bestWalls };
      R = Object.assign(makeChain(ctx, Layout.from(b, R.bestWalls)), keep);
      T = Math.max(T, T0 * 0.5); lastImp = ev.evals; bestHere = R.cur;
    }
    yield* tick(ctx, R.L.walls, 'annealing');
  }
  return R;
}

// Hill climbing: for each wall, try every tile on the shortest path of the
// layout without that wall (the only tiles that can make it better) and take
// the best strictly-better spot. Repeats until no single move helps.
function* polish(ctx, L, cur, end = ctx.opts.maxEvals) {
  const { ev, rng } = ctx;
  let improved = true;
  while (improved && ev.evals < end) {
    improved = false;
    const order = shuffle(L.walls.map((_, i) => i), rng);
    for (const i of order) {
      if (ev.evals >= end) break;
      const old = L.walls[i];
      L.mask[old] = 0;
      ev.run(L.mask);
      const cands = ev.path(rng);
      let bestC = old, bestS = cur;
      for (const c of cands) {
        if (c === old) continue;
        L.mask[c] = 1;
        const s = ev.score(L.mask);
        L.mask[c] = 0;
        if (s > bestS) { bestS = s; bestC = c; }
      }
      L.mask[old] = 1;
      if (bestC !== old) { applyMoves(L, [[i, bestC]]); cur = bestS; improved = true; ctx.consider(L, cur); }
      yield* tick(ctx, L.walls, 'polishing');
    }
  }
  return cur;
}

// Random relocations used as a "kick" to escape a local optimum.
function kick(ctx, L, k) {
  const { ev, rng, b } = ctx;
  ev.run(L.mask);
  const path = ev.path(rng);
  for (let t = 0; t < k; t++) {
    const i = (rng() * L.walls.length) | 0;
    const c = rng() < 0.5 && path.length ? path[(rng() * path.length) | 0] : b.open[(rng() * b.open.length) | 0];
    if (!L.free(c)) continue;
    const undo = applyMoves(L, [[i, c]]);
    if (ev.run(L.mask) < 0) applyMoves(L, undo);
  }
}

// Exact search restricted to `allowed` tiles: start from `base`, add up to m
// walls, branching on allowed tiles of the current shortest path. Pure path
// length (complete for that objective). Stops after `cap` evaluations.
function* exactSearch(ctx, base, m, allowed, cap) {
  const { ev } = ctx;
  const mask = base.slice(), e0 = ev.evals;
  const stack = [[]], seen = new Set([keyOf([])]);
  let best = { len: -1, cells: [] }, complete = true;
  while (stack.length) {
    if (ev.evals - e0 >= cap || ev.evals >= ctx.opts.maxEvals) { complete = false; break; }
    const S = stack.pop();
    for (const c of S) mask[c] = 1;
    const len = ev.run(mask);
    const p = len >= 0 && S.length < m ? ev.path() : null;
    for (const c of S) mask[c] = 0;
    if (len < 0) continue;
    if (len > best.len) best = { len, cells: S };
    if (p) for (const c of p) {
      if (!allowed(c)) continue;
      const T = S.concat(c), k = keyOf(T);
      if (!seen.has(k)) { seen.add(k); stack.push(T); }
    }
    yield* tick(ctx, null, 'exact search');
  }
  return Object.assign(best, { complete });
}

// ---------- methods ----------
function saPolish(o = {}) {
  return function* (ctx) {
    const R = yield* anneal(ctx, randomFill(ctx, new Layout(ctx.b)), ctx.opts.maxEvals * 0.85, o);
    const L = Layout.from(ctx.b, R.bestWalls);
    yield* polish(ctx, L, ctx.ev.score(L.mask));
  };
}

function multistart({ runs = 6, compound = 0 } = {}) {
  return function* (ctx) {
    const share = ctx.opts.maxEvals / runs;
    for (let r = 0; r < runs && !ctx.done(); r++) {
      const end = Math.min(ctx.opts.maxEvals, ctx.ev.evals + share);
      const R = yield* anneal(ctx, randomFill(ctx, new Layout(ctx.b)), share * 0.85, { compound });
      const L = Layout.from(ctx.b, R.bestWalls);
      yield* polish(ctx, L, ctx.ev.score(L.mask), end);
    }
  };
}

function ils({ start = null } = {}) {
  return function* (ctx) {
    const { b, ev, rng } = ctx;
    const minKick = 2, maxKick = 5;
    let L = start ? yield* start(ctx) : randomFill(ctx, new Layout(b));
    let cur = yield* polish(ctx, L, ev.score(L.mask));
    while (!ctx.done()) {
      const save = L.walls.slice();
      kick(ctx, L, minKick + ((rng() * (maxKick - minKick + 1)) | 0));
      const s = yield* polish(ctx, L, ev.score(L.mask));
      if (s >= cur) cur = s; else L = Layout.from(b, save);
    }
  };
}

// Destroy & repair: clear the walls in a window, then rebuild that window with
// the exact search (other walls stay fixed). Keeps the result if no worse.
function* lnsLoop(ctx, L) {
  const { b, ev, rng } = ctx;
  const MAXM = Math.min(5, Math.max(2, Math.round(b.budget / 3))), CAP = Math.max(200, ctx.opts.maxEvals * 0.02);
  while (!ctx.done()) {
    const center = L.walls[(rng() * L.walls.length) | 0];
    const cx = center % b.W, cy = (center / b.W) | 0, R = 2 + ((rng() * 2) | 0);
    const inWin = c => Math.abs(c % b.W - cx) <= R && Math.abs(((c / b.W) | 0) - cy) <= R;
    let removed = L.walls.filter(inWin);
    if (removed.length > MAXM) removed = shuffle(removed, rng).slice(0, MAXM);
    const oldLen = ev.run(L.mask);
    const base = L.mask.slice();
    for (const c of removed) base[c] = 0;
    const res = yield* exactSearch(ctx, base, removed.length, inWin, CAP);
    if (res.len < oldLen) continue;
    const keep = L.walls.filter(c => !removed.includes(c));
    L = Layout.from(b, keep.concat(res.cells));
    // put back any walls the window didn't need, where they help most
    while (L.walls.length < b.budget && !ctx.done()) {
      ev.run(L.mask);
      let bestC = -1, bestS = -Infinity;
      for (const c of ev.path(rng)) {
        L.mask[c] = 1; const s = ev.score(L.mask); L.mask[c] = 0;
        if (s > bestS) { bestS = s; bestC = c; }
      }
      if (bestC < 0) break;
      L.add(bestC);
    }
    ctx.consider(L, ev.score(L.mask));
    yield* tick(ctx, L.walls, 'destroy & repair');
  }
  return L;
}

function lns({ start = null } = {}) {
  return function* (ctx) {
    let L = start ? yield* start(ctx) : randomFill(ctx, new Layout(ctx.b));
    yield* polish(ctx, L, ctx.ev.score(L.mask), Math.min(ctx.opts.maxEvals, ctx.ev.evals + ctx.opts.maxEvals * 0.1));
    L = Layout.from(ctx.b, ctx.best.walls);
    yield* lnsLoop(ctx, L);
  };
}

function pt({ K = 6, Tmin = 0.2, Tmax = 3, compound = 0 } = {}) {
  return function* (ctx) {
    const { b, ev, rng } = ctx;
    const Ts = Array.from({ length: K }, (_, k) => Tmin * Math.pow(Tmax / Tmin, k / (K - 1)));
    const R = Ts.map(() => makeChain(ctx, randomFill(ctx, new Layout(b))));
    const stopAt = ctx.opts.maxEvals * 0.9;
    let sweep = 0;
    while (ev.evals < stopAt) {
      for (let k = 0; k < K; k++) for (let s = 0; s < 10; s++) saStep(ctx, R[k], Ts[k], compound);
      for (let k = (sweep++ & 1); k + 1 < K; k += 2) {
        const d = (R[k + 1].cur - R[k].cur) * (1 / Ts[k] - 1 / Ts[k + 1]);
        if (d >= 0 || rng() < Math.exp(d)) [R[k], R[k + 1]] = [R[k + 1], R[k]];
      }
      yield* tick(ctx, R[0].L.walls, 'tempering');
    }
    const L = Layout.from(b, ctx.best.walls);
    yield* polish(ctx, L, ev.score(L.mask));
  };
}

function ga({ pop = 24, memetic = false } = {}) {
  return function* (ctx) {
    const { b, ev, rng } = ctx;
    const P = [];
    for (let k = 0; k < pop && !ctx.done(); k++) {
      const L = randomFill(ctx, new Layout(b));
      let s = ev.score(L.mask);
      if (memetic) s = yield* polish(ctx, L, s);
      ctx.consider(L, s);
      P.push({ L, s, key: keyOf(L.walls) });
    }
    const keys = new Set(P.map(p => p.key));
    const pick = () => {
      let a = P[(rng() * P.length) | 0];
      for (let t = 0; t < 2; t++) { const c = P[(rng() * P.length) | 0]; if (c.s > a.s) a = c; }
      return a;
    };
    while (!ctx.done()) {
      const A = pick().L, B = pick().L;
      // crossover: one side of a random cut from each parent
      const vertical = rng() < 0.5, cut = (rng() * (vertical ? b.W : b.H)) | 0;
      const side = c => (vertical ? c % b.W : (c / b.W) | 0) < cut;
      const cells = [...new Set(A.walls.filter(side).concat(B.walls.filter(c => !side(c))))];
      const L = Layout.from(b, shuffle(cells, rng).slice(0, b.budget));
      while (L.walls.length && ev.run(L.mask) < 0) L.removeCell(L.walls[(rng() * L.walls.length) | 0]);
      fillPathBiased(ctx, L);
      // mutation
      for (let m = (rng() * 3) | 0; m > 0; m--) {
        ev.run(L.mask);
        const mv = proposeSingle(ctx, L, ev.path(rng));
        if (!mv) continue;
        const undo = applyMoves(L, mv);
        if (ev.run(L.mask) < 0) applyMoves(L, undo);
      }
      let s = ev.score(L.mask);
      if (memetic && rng() < 0.3) s = yield* polish(ctx, L, s);
      ctx.consider(L, s);
      const key = keyOf(L.walls);
      let worst = 0;
      for (let i = 1; i < P.length; i++) if (P[i].s < P[worst].s) worst = i;
      if (s > P[worst].s && !keys.has(key)) { keys.delete(P[worst].key); P[worst] = { L, s, key }; keys.add(key); }
      yield* tick(ctx, L.walls, 'evolving');
    }
  };
}

// Beam search over the exact solver's tree: add one wall per level on the
// current shortest path, keep only the best `width` layouts per level.
function* beamBuild(ctx, evShare) {
  const { b, ev, rng } = ctx;
  ev.run(new Uint8Array(b.N));
  const estPath = ev.dist[b.entry] + 2.5 * b.budget;
  const width = Math.max(4, Math.floor(evShare / (b.budget * estPath)));
  let level = [{ cells: [], s: ev.score(new Uint8Array(b.N)) }];
  const mask = new Uint8Array(b.N);
  for (let d = 0; d < b.budget && !ctx.done(); d++) {
    const next = new Map();
    for (const st of level) {
      for (const c of st.cells) mask[c] = 1;
      ev.run(mask);
      for (const c of ev.path()) {
        const cells = st.cells.concat(c), k = keyOf(cells);
        if (next.has(k)) continue;
        mask[c] = 1;
        const s = ev.score(mask);
        mask[c] = 0;
        if (s > -Infinity) next.set(k, { cells, s: s + rng() * 1e-6 });
      }
      for (const c of st.cells) mask[c] = 0;
      if (ctx.done()) break;
      yield* tick(ctx, st.cells, 'beam search');
    }
    if (!next.size) break;
    level = [...next.values()].sort((a, c) => c.s - a.s).slice(0, width);
    ctx.consider({ walls: level[0].cells }, level[0].s);
  }
  return Layout.from(b, level[0].cells);
}

function beam() {
  return function* (ctx) {
    const L = yield* beamBuild(ctx, ctx.opts.maxEvals * 0.7);
    yield* polish(ctx, L, ctx.ev.score(L.mask));
  };
}

function tabu({ samples = 20 } = {}) {
  return function* (ctx) {
    const { b, ev, rng } = ctx;
    const L = randomFill(ctx, new Layout(b));
    let cur = ev.score(L.mask), path = ev.path(rng), it = 0;
    const tabuUntil = new Int32Array(b.N);
    ctx.consider(L, cur);
    while (!ctx.done()) {
      it++;
      let best = null, bestS = -Infinity;
      for (let k = 0; k < samples; k++) {
        const mv = proposeSingle(ctx, L, path);
        if (!mv) continue;
        const undo = applyMoves(L, mv);
        const s = ev.score(L.mask);
        applyMoves(L, undo);
        const isTabu = tabuUntil[mv[0][1]] > it;
        if (s > bestS && (!isTabu || s > ctx.best.score)) { bestS = s; best = mv; }
      }
      if (!best) continue;
      const old = L.walls[best[0][0]];
      applyMoves(L, best);
      tabuUntil[old] = it + 8 + ((rng() * 8) | 0);
      cur = ev.score(L.mask); path = ev.path(rng);
      ctx.consider(L, cur);
      yield* tick(ctx, L.walls, 'tabu search');
    }
  };
}

function exact() {
  return function* (ctx) {
    const res = yield* exactSearch(ctx, new Uint8Array(ctx.b.N), ctx.b.budget, () => true, Infinity);
    ctx.consider({ walls: res.cells }, ctx.ev.score(Layout.from(ctx.b, res.cells).mask));
    ctx.provenOptimal = res.complete;
  };
}

// ---------- registry ----------
const METHODS = [
  { id: 'baseline', name: 'Simulated annealing', group: 'Baseline', desc: 'One long annealing run, then polish. The baseline the others have to beat.', run: saPolish() },
  { id: 'multistart', name: 'Multi-start', group: '1 · Restarts', desc: 'Six independent anneal + polish runs; keep the best.', run: multistart() },
  { id: 'ils', name: 'Iterated local search', group: '1 · Restarts', desc: 'Polish to a local optimum, kick 2–5 walls, polish again, keep if no worse.', run: ils() },
  { id: 'reheat', name: 'Annealing + reheating', group: '1 · Restarts', desc: 'When annealing stalls, jump back to its best layout and raise the temperature.', run: saPolish({ reheat: 0.08 }) },
  { id: 'compound', name: 'Compound moves', group: '2 · Bigger moves', desc: 'Annealing that sometimes moves 2–3 walls at once or slides a whole barrier.', run: saPolish({ compound: 0.3 }) },
  { id: 'lns', name: 'Destroy & repair', group: '2 · Bigger moves', desc: 'Clear the walls in a small window and rebuild it with the exact solver.', run: lns() },
  { id: 'pt', name: 'Parallel tempering', group: '3 · Population', desc: 'Six annealers at fixed temperatures that swap layouts.', run: pt() },
  { id: 'ga', name: 'Genetic algorithm', group: '3 · Population', desc: '24 mazes; children combine halves of two parents, plus mutation.', run: ga() },
  { id: 'beam', name: 'Beam search', group: '3 · Population', desc: 'The exact solver\'s tree, keeping only the best layouts at each depth.', run: beam() },
  { id: 'tiebreak', name: 'Tie-break scoring', group: '4 · Scoring', desc: 'Annealing that also rewards fewer shortest paths, so half-built barriers count.', tiebreak: true, run: saPolish() },
  { id: 'tabu', name: 'Tabu search', group: '4 · Scoring', desc: 'Always takes the best of 20 sampled moves, but may not refill a just-vacated tile.', run: tabu() },
  { id: 'exact', name: 'Exact (capped)', group: '5 · Exact', desc: 'Full branch and bound, stopped when the evaluation budget runs out.', run: exact() },
];

function addMethod(m) { METHODS.push(m); return m; }

// ---------- running ----------
function createRun(def, methodId, { maxEvals, seed = 1, yieldEvery = 1000 } = {}) {
  const b = makeBoard(def);
  const method = METHODS.find(m => m.id === methodId);
  const ev = new Evaluator(b, method.tiebreak);
  const ctx = {
    b, ev, rng: mulberry32(seed * 7919 + 13), opts: { maxEvals }, nextYield: yieldEvery, yieldEvery,
    best: { score: -Infinity, walls: [] }, provenOptimal: false,
    done() { return ev.evals >= this.opts.maxEvals; },
    consider(L, s) { if (s > this.best.score) this.best = { score: s, walls: L.walls.slice() }; },
  };
  const gen = (function* () { yield* method.run(ctx); return finalize(ctx); })();
  return { ctx, gen, board: b, method };
}

// Pure path length of the best layout, with walls that do nothing removed.
function finalize(ctx) {
  const ev = new Evaluator(ctx.b, false);
  const L = Layout.from(ctx.b, ctx.best.walls);
  const len = ev.run(L.mask);
  for (const c of L.walls.slice()) {
    L.removeCell(c);
    if (ev.run(L.mask) !== len) L.add(c);
  }
  return { len, walls: L.walls.slice(), evals: ctx.ev.evals, proven: ctx.provenOptimal };
}

function runToEnd(def, methodId, opts) {
  const t0 = Date.now(), r = createRun(def, methodId, opts);
  let s;
  do s = r.gen.next(); while (!s.done);
  return Object.assign(s.value, { ms: Date.now() - t0 });
}

const API = {
  METHODS, addMethod, createRun, runToEnd, makeBoard, Evaluator, Layout,
  parts: { saPolish, multistart, ils, lns, lnsLoop, pt, ga, beam, beamBuild, tabu, exact, polish, anneal, randomFill },
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.Solvers = API;
})(typeof window !== 'undefined' ? window : globalThis);
