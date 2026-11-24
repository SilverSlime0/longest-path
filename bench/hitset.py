"""Exact solver: hitting-set formulation with lazily generated routes.

Question: can `budget` walls make every entry-to-exit route at least `target`
steps long, while leaving the exit reachable?

  1. Keep a pool of routes shorter than `target`.
  2. Ask CP-SAT for at most `budget` walls that put a wall on every pooled route.
  3. Run BFS on that layout. A route shorter than `target` that slips through is
     added to the pool (plus a few more found by temporarily blocking it).
     The master is solved without reachability first; only if its walls seal
     the exit is it re-solved with a flow constraint that keeps the exit open.
  4. Repeat. If step 2 is infeasible, no layout reaches `target`: the best
     length is proven to be below it. If BFS finds no short route, the layout
     reaches `target`, and the search moves on to `target + 1`.

Usage: python bench/hitset.py small|large [--target 93] [--time 3600] [--batch 30]
"""
import argparse
import os
import random
import sys
import time

from ortools.sat.python import cp_model

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ilp import DIRS, load_level, best_known, bfs  # noqa: E402

STATUS = {cp_model.OPTIMAL: 'OPTIMAL', cp_model.FEASIBLE: 'FEASIBLE', cp_model.INFEASIBLE: 'INFEASIBLE',
          cp_model.UNKNOWN: 'UNKNOWN', cp_model.MODEL_INVALID: 'MODEL_INVALID'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('board', choices=['small', 'large'])
    ap.add_argument('--target', type=int, help='length to reach (default: best known + 1)')
    ap.add_argument('--time', type=float, default=3600)
    ap.add_argument('--batch', type=int, default=30, help='routes added per round')
    ap.add_argument('--workers', type=int, default=os.cpu_count() or 8)
    a = ap.parse_args()

    L = load_level(a.board)
    W, H, budget = L['W'], L['H'], L['budget']
    s = L['entry'][1] * W + L['entry'][0]
    t = L['exit'][1] * W + L['exit'][0]
    rocks = {y * W + x for x, y in L['rocks']}
    cand = [c for c in range(W * H) if c not in rocks and c not in (s, t)]
    free = cand + [s, t]
    nbrs = {c: [ny * W + nx for dx, dy in DIRS for nx, ny in [(c % W + dx, c // W + dy)]
                if 0 <= nx < W and 0 <= ny < H and ny * W + nx not in rocks] for c in free}
    rng = random.Random(1)

    def route(blocked):
        """Shortest route as a list of cells from s to t, or None if sealed."""
        dt = bfs(W, H, blocked, t)
        if s not in dt:
            return None
        p, c = [s], s
        while c != t:
            x, y = c % W, c // W
            nxt = [ny * W + nx for dx, dy in DIRS for nx, ny in [(x + dx, y + dy)]
                   if 0 <= nx < W and 0 <= ny < H and dt.get(ny * W + nx, -1) == dt[c] - 1]
            c = rng.choice(nxt)
            p.append(c)
        return p

    def barrier(walls):
        """Walls touching the region reachable from s: together they seal the exit."""
        reach = bfs(W, H, rocks | walls, s)
        out = set()
        for c in reach:
            x, y = c % W, c // W
            for dx, dy in DIRS:
                nx, ny = x + dx, y + dy
                n = ny * W + nx
                if 0 <= nx < W and 0 <= ny < H and n in walls:
                    out.add(n)
        return out

    if a.target:
        target = a.target
    else:
        hint = best_known(a.board)
        target = (bfs(W, H, rocks | set(hint), s)[t] + 1) if hint else 1
    routes, cuts, seen = [], [], set()
    walls = set()
    t0 = time.time()
    rounds = 0
    best_layout = None
    print(f'{a.board}: target {target}, budget {budget}, {len(cand)} wall candidates', flush=True)

    def solve_master(hint, flow):
        m = cp_model.CpModel()
        w = {c: m.NewBoolVar(f'w{c}') for c in cand}
        m.Add(sum(w.values()) <= budget)
        for r in routes:
            m.AddBoolOr([w[c] for c in r])
        for b in cuts:
            m.Add(sum(w[c] for c in b) <= len(b) - 1)
        if flow:
            # the exit stays reachable: one unit of flow from s to t through open tiles
            f = {(u, v): m.NewBoolVar('') for u in free for v in nbrs[u]}
            for (u, v), var in f.items():
                for c in (u, v):
                    if c in w:
                        m.AddImplication(var, w[c].Not())
            for c in free:
                m.Add(sum(f[c, v] for v in nbrs[c]) - sum(f[u, c] for u in nbrs[c])
                      == (1 if c == s else -1 if c == t else 0))
        for c in cand:
            m.AddHint(w[c], c in hint)
        solver = cp_model.CpSolver()
        solver.parameters.num_workers = a.workers
        solver.parameters.max_time_in_seconds = max(1.0, a.time - (time.time() - t0))
        st = solver.Solve(m)
        walls = {c for c in cand if solver.Value(w[c])} if st in (cp_model.FEASIBLE, cp_model.OPTIMAL) else None
        return st, walls, solver.WallTime()

    while time.time() - t0 < a.time:
        # --- separation: routes shorter than target that the current walls miss
        p = route(rocks | walls)
        if p is None:
            b = barrier(walls)
            cuts.append(sorted(b))
        elif len(p) - 1 >= target:
            best_layout = (len(p) - 1, sorted(walls))
            print(f'  {time.time() - t0:7.1f}s  REACHED {len(p) - 1} with {len(walls)} walls: '
                  f'{[(c % W, c // W) for c in sorted(walls)]}', flush=True)
            target = len(p)
            continue
        else:
            temp = set()
            for _ in range(a.batch):
                if p is None or len(p) - 1 >= target:
                    break
                key = frozenset(p[1:-1])
                if key not in seen:
                    seen.add(key)
                    routes.append(p[1:-1])
                temp.add(rng.choice(p[1:-1]))
                p = route(rocks | walls | temp)

        # --- master: at most `budget` walls hitting every pooled route.
        # Solve without the reachability constraint first: if even that is
        # infeasible, so is the real problem, and that proof is much faster.
        rounds += 1
        st, walls_new, secs = solve_master(walls, flow=False)
        if st in (cp_model.FEASIBLE, cp_model.OPTIMAL) and route(rocks | walls_new) is None:
            st, walls_new, s2 = solve_master(walls, flow=True)
            secs += s2
        if rounds % 20 == 0 or st not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            print(f'  {time.time() - t0:7.1f}s  round {rounds}  routes {len(routes)}  cuts {len(cuts)}  '
                  f'last solve {secs:.2f}s  {STATUS[st]}', flush=True)
        if st == cp_model.INFEASIBLE:
            print(f'\nPROVEN: no layout with {budget} walls reaches {target}, so the optimum is {target - 1}.')
            if best_layout:
                print(f'optimal layout: {best_layout}')
            return
        if st not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            break
        walls = walls_new

    print(f'\nTIME UP after {time.time() - t0:.0f}s, {rounds} rounds, {len(routes)} routes, {len(cuts)} cuts: '
          f'reaching {target} is still undecided.')


if __name__ == '__main__':
    main()
