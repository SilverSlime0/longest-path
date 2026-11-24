# Longest Path

A grid puzzle: place a limited number of walls so that the **shortest** route
from the entry to the exit is as long as possible, without sealing the exit
off. Optimizers and exact solvers show how close you got.

Open `index.html` in a browser (no build step or server needed). It has three pages:
- **Lab** (`index.html`, the homepage): six algorithms race on any board, with
  benchmark results.
- **Play** (`play.html`): try the 11 fixed boards yourself or run the optimizer.
- **Map generator** (`generate.html`): generate a new map in the browser from
  a size, wall count, rock density, entry/exit layout and seed, then build your
  own maze on it or press Optimize. Small maps with up to 6 walls can also be
  solved exactly. The same options and seed always give the same map.

## Boards

| Board | Size | Walls | Best path | Status |
|---|---|---|---|---|
| Small 1 | 11×9 | 6 | 26 | proven optimal |
| Small 2 | 11×9 | 6 | 24 | proven optimal |
| Small 3 | 11×9 | 6 | 24 | proven optimal |
| Medium 1 | 15×11 | 10 | 44 | proven optimal (3.5 min) |
| Medium 2 | 15×11 | 10 | 46 | proven optimal (28 min) |
| Medium 3 | 15×11 | 10 | 40 | proven optimal (7 min) |
| Large 1 | 21×15 | 25 | 92 | best known, very likely optimal |
| Large 2 | 21×15 | 25 | 84 | best known, very likely optimal |
| Large 3 | 21×15 | 25 | 82 | best known, likely optimal |
| Large 4 | 21×15 | 25 | 88 | best known, likely optimal |
| Large 5 | 21×15 | 25 | 90 | best known, very likely optimal |

Proof times are for `bench/prove.js` on 12 cores. Small boards take under a
second, and both of the lab's exact solvers agree on them.

### Proofs (small and medium)
`bench/prove.js` is a branch and bound:
- Any longer layout must put a wall on the current shortest route, so it
  branches on that route's tiles. Branch *i* walls tile *i* and forbids
  tiles 1…*i*−1, so no layout is visited twice.
- Bound: if more short routes share no wallable tile than there are walls
  left, no layout down that branch can work.
- The top of the tree is split across worker threads.

It gets about 10× slower per extra wall. The medium boards have 10 walls
rather than 12 because at 12 each proof would take about 8 hours.

### Evidence (large)
Large boards can't be proven. Brute force would need about 10³⁵ layouts, and
the prover's 10× per wall puts 25 walls at billions of years. Three other exact
approaches also failed on Large 1 within their time limits:
- `prove.js` stopped after 2 minutes (17 million layouts).
- `ilp.py`, an integer program in CP-SAT, ran for an hour; its upper bound
  never dropped below 281.
- `hitset.py`, a hitting-set search, ran for an hour; after 12,745 routes,
  25 walls could still block all of them.

Instead, `bench/evidence.js` ran each large board 66–72 times, at 1×, 10×,
100× and 300× the Optimize button's budget. Large 3 and Large 4 also got
1000× runs.

| Board | Best | Runs reaching it | Distinct best layouts | Longest runs |
|---|---|---|---|---|
| Large 1 | 92 | 23/66 | 21 | all 6 runs at 100–300× reached 92 |
| Large 2 | 84 | 9/66 | 1 | all 6 at 100–300× reached 84; every hit is the same layout |
| Large 3 | 82 | 6/72 | 5 | 1000× runs stopped at 82 (82 first appeared at 100×) |
| Large 4 | 88 | 5/72 | 2 | 1000× runs stopped at 88 (88 first appeared at 300×) |
| Large 5 | 90 | 11/66 | 11 | all 6 at 100–300× reached 90 |

Every route on these boards has even length, so beating the best means
reaching best + 2. No run did.

On Large 1, 2 and 5, the best length appears even at 10× budgets, and every
longer run converges to it. That is strong evidence it is optimal. Large 3 and
Large 4 are harder for the optimizer: their best values only appeared at
100–300×. Even so, more than 3× more effort (1000×, about an hour per run)
found nothing longer.

## Algorithms
- **Distance field (BFS)** from the exit: the entry's distance is the score.
  It also draws the heatmap, the arrows and the shortest path, and rejects walls
  that would seal the exit.
- **Optimize** runs whichever method won the benchmark for that board size:
  - small: short annealing restarts with tie-break scoring (fewer shortest
    routes counts as better when lengths tie);
  - medium and large: parallel tempering with tie-break scoring and compound
    moves, also restarted.
- **Restart count** follows the evaluation budget: one restart per 14 × walls²
  evaluations for annealing and per 300 × walls² for tempering, from 1 up to 50.
  `bench/restarts.js` fitted this over 9 restart counts and 4–5 budgets per
  board size, then checked it on new seeds and budgets. It beats fixed counts at
  low budgets and ties them elsewhere.
- **Solve exactly** (small boards): the in-browser branch and bound, animated.

## Optimizer lab
The homepage races six methods with equal evaluation budgets on any board and
shows their benchmark results: simulated annealing (the baseline), annealing
restarts, tempering restarts, destroy & repair, a genetic algorithm and capped
exact search. The list is `FEATURED` in `js/lab.js`. The solver library holds 16
more (fixed restart counts, bigger moves, population methods and combinations),
and the benchmark can run all 22, so any of them can be added back to the page.

```
node bench/bench.js [--boards small,large] [--methods id,id] [--trials N]
                    [--evals-small 5000] [--evals-medium 50000] [--evals-large 300000]
node bench/prove.js <board> [--time seconds] [--budget walls] [--workers N]
node bench/evidence.js large,large2 [--tiers method:mult:seeds:firstSeed,...]
node bench/restarts.js [--validate] [--report] [--boards small,large] [--workers N]
```

`bench.js` writes `bench/results.json` and `bench/results.js`, which the lab
loads. `evidence.js` writes `bench/evidence.json`. `restarts.js` writes
`bench/restarts.json` and, with `--validate`, `bench/restarts-validate.json`.
The evidence runs used the fixed 5-restart tempering (`pt-restarts`).

## Files
- `index.html`, `css/lab.css`, `js/lab.js`: the lab (homepage).
- `play.html`, `css/styles.css`: the game page (styles are shared by all pages).
- `generate.html`, `js/generator.js`: the map generator page, which reuses the
  game's scripts.
- `js/mapgen.js`: the map generator, shared with `bench/genmaps.js`.
- `js/levels.js`: board definitions, each board size's optimizer, and the
  proven optimums or best-known lengths.
- `js/state.js`, `grid.js`, `ui.js`, `render.js`, `main.js`: game state,
  BFS, input, drawing and the animation loop.
- `js/optimizer.js`: runs the chosen solver method step by step on the board.
- `js/exact.js`: the animated exact solver.
- `js/solvers.js`, `js/combos.js`: the solver library shared by the game,
  the lab and the benchmark.
- `bench/bench.js`: optimizer benchmark. `bench/prove.js`: exact prover.
  `bench/evidence.js`: repeated long runs. `bench/restarts.js`: restart sweep.
  `bench/genmaps.js`: map generator.
  `bench/ilp.py`, `bench/hitset.py`: the CP-SAT experiments (need OR-Tools).
