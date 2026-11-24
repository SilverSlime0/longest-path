"""Exact solver: the board as a CP-SAT model (Google OR-Tools).

Variables: w[c] = wall on tile c, d[c] = distance label of tile c.
- d[entry] = 0, and between two open neighbors d can rise by at most 1.
  Maximizing d[exit] under these rules gives exactly the shortest-path length.
- One unit of flow from entry to exit through open tiles keeps the exit reachable.
- At most `budget` walls.
The solver reports the best layout found and an upper bound on the optimum;
when they meet, the layout is proven optimal.

Usage: python bench/ilp.py small|large [--time 600] [--workers 12] [--no-hint]
"""
import argparse
import json
import os
import subprocess
import time
from collections import deque

from ortools.sat.python import cp_model

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]


def load_level(name):
    js = ("const fs=require('fs');const L=new Function(fs.readFileSync('js/levels.js','utf8')+';return LEVELS')();"
          f"console.log(JSON.stringify(L['{name}']))")
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))


def bfs(W, H, blocked, src):
    dist = {src: 0}
    q = deque([src])
    while q:
        c = q.popleft()
        x, y = c % W, c // W
        for dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            n = ny * W + nx
            if 0 <= nx < W and 0 <= ny < H and n not in blocked and n not in dist:
                dist[n] = dist[c] + 1
                q.append(n)
    return dist


def best_known(name):
    try:
        with open(os.path.join(ROOT, 'bench', 'results.json')) as f:
            return json.load(f)['boards'][name].get('bestKnownWalls')
    except (OSError, KeyError):
        return None


class Progress(cp_model.CpSolverSolutionCallback):
    def __init__(self, t0):
        super().__init__()
        self.t0 = t0

    def on_solution_callback(self):
        print(f'  {time.time() - self.t0:7.1f}s  found {int(self.ObjectiveValue())}  '
              f'bound {int(self.BestObjectiveBound())}', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('board', choices=['small', 'large'])
    ap.add_argument('--time', type=float, default=600)
    ap.add_argument('--workers', type=int, default=os.cpu_count() or 8)
    ap.add_argument('--no-hint', action='store_true')
    a = ap.parse_args()

    L = load_level(a.board)
    W, H, budget = L['W'], L['H'], L['budget']
    s = L['entry'][1] * W + L['entry'][0]
    t = L['exit'][1] * W + L['exit'][0]
    rocks = {y * W + x for x, y in L['rocks']}
    free = [c for c in range(W * H) if c not in rocks]
    U = len(free) - 1  # no simple path is longer than this

    def nbrs(c):
        x, y = c % W, c // W
        for dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            n = ny * W + nx
            if 0 <= nx < W and 0 <= ny < H and n not in rocks:
                yield n

    m = cp_model.CpModel()
    w = {c: m.NewBoolVar(f'w{c}') for c in free if c not in (s, t)}
    d = {c: m.NewIntVar(0, U, f'd{c}') for c in free}
    is_open = lambda c: [w[c].Not()] if c in w else []

    m.Add(d[s] == 0)
    m.Add(sum(w.values()) <= budget)
    for c in w:
        m.Add(d[c] == 0).OnlyEnforceIf(w[c])  # walls carry no label (removes symmetry)

    # distance rule between open neighbors
    for u in free:
        for v in nbrs(u):
            m.Add(d[v] <= d[u] + 1).OnlyEnforceIf(is_open(u) + is_open(v))

    # reachability: one unit of flow from entry to exit through open tiles
    f = {(u, v): m.NewBoolVar(f'f{u}_{v}') for u in free for v in nbrs(u)}
    for (u, v), var in f.items():
        for c in (u, v):
            if c in w:
                m.AddImplication(var, w[c].Not())
    for c in free:
        out = sum(f[c, v] for v in nbrs(c))
        inn = sum(f[u, c] for u in nbrs(c))
        m.Add(out - inn == (1 if c == s else -1 if c == t else 0))

    m.Maximize(d[t])

    hint = None if a.no_hint else best_known(a.board)
    if hint:
        hs = set(hint)
        dist = bfs(W, H, rocks | hs, s)
        for c in w:
            m.AddHint(w[c], c in hs)
        for c in free:
            m.AddHint(d[c], 0 if c in hs else dist.get(c, 0))
        print(f'hint: best known layout, length {dist.get(t)}')

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = a.time
    solver.parameters.num_workers = a.workers
    print(f'{a.board}: {len(w)} wall candidates, budget {budget}, {a.workers} workers, {a.time:.0f}s limit', flush=True)
    t0 = time.time()
    status = solver.Solve(m, Progress(t0))

    best, bound = int(solver.ObjectiveValue()), int(solver.BestObjectiveBound())
    walls = sorted(c for c in w if solver.Value(w[c]))
    check = bfs(W, H, rocks | set(walls), s).get(t)
    print(f'\nstatus {solver.StatusName(status)} after {time.time() - t0:.1f}s')
    print(f'best {best} (BFS check: {check}), upper bound {bound}')
    print('PROVEN OPTIMAL' if status == cp_model.OPTIMAL else f'gap: optimum is between {best} and {bound}')
    print('walls (x,y):', [(c % W, c // W) for c in walls])


if __name__ == '__main__':
    main()
