// Combinations of methods, registered on top of the single methods in
// solvers.js. Shared by the benchmark (Node) and the lab page (browser).
(function (factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
  else factory(window.Solvers);
})(function (S) {
  const { anneal, polish, randomFill, lnsLoop, pt, tabu } = S.parts;
  const { Layout } = S;

  // How many restarts suit this budget: one per `perWall2` × walls² evaluations,
  // fitted by the sweep in bench/restarts.js. Its grid stopped at 50 restarts,
  // so that is the limit here too.
  const SA_EVALS = 14, PT_EVALS = 300, MAX_RESTARTS = 50;
  function restartsFor(ctx, perWall2) {
    const n = Math.round(ctx.opts.maxEvals / (perWall2 * ctx.b.budget ** 2));
    return Math.min(MAX_RESTARTS, Math.max(1, n));
  }

  // Run `runs` anneal + polish passes inside the first `frac` of the budget.
  function* restarts(ctx, runs, frac, o = {}) {
    const share = ctx.opts.maxEvals * frac / runs;
    for (let r = 0; r < runs && !ctx.done(); r++) {
      const end = Math.min(ctx.opts.maxEvals, ctx.ev.evals + share);
      const R = yield* anneal(ctx, randomFill(ctx, new Layout(ctx.b)), share * 0.85, o);
      const L = Layout.from(ctx.b, R.bestWalls);
      yield* polish(ctx, L, ctx.ev.score(L.mask), end);
    }
  }

  // Restarts explore, then destroy & repair refines the best layout found.
  function* restartsThenLns(ctx) {
    yield* restarts(ctx, 4, 0.6);
    yield* lnsLoop(ctx, Layout.from(ctx.b, ctx.best.walls));
  }

  // Parallel tempering for most of the budget, then destroy & repair.
  function* ptThenLns(ctx) {
    const max = ctx.opts.maxEvals;
    ctx.opts.maxEvals = max * 0.6;
    yield* pt()(ctx);
    ctx.opts.maxEvals = max;
    yield* lnsLoop(ctx, Layout.from(ctx.b, ctx.best.walls));
  }

  // Tabu search restarted from scratch four times.
  function* tabuRestarts(ctx) {
    const max = ctx.opts.maxEvals, runs = 4;
    for (let r = 1; r <= runs; r++) {
      ctx.opts.maxEvals = max * r / runs;
      yield* tabu()(ctx);
    }
    ctx.opts.maxEvals = max;
  }

  // Parallel tempering (tie-break + compound moves) restarted from scratch.
  // `count` is a number of restarts, or a function of ctx that returns one.
  function ptRestarts(count, K) {
    return function* (ctx) {
      const max = ctx.opts.maxEvals;
      const runs = typeof count === 'function' ? count(ctx) : count;
      for (let r = 1; r <= runs; r++) {
        ctx.opts.maxEvals = max * r / runs;
        yield* pt({ compound: 0.3, K })(ctx);
      }
      ctx.opts.maxEvals = max;
    };
  }

  Object.assign(S.parts, { restarts, ptRestarts }); // for bench/restarts.js

  const combos = [
    { id: 'pt+tb+compound', name: 'Tempering + tie-break + compound', desc: 'Parallel tempering with tie-break scoring and compound moves.', tiebreak: true, run: pt({ compound: 0.3 }) },
    { id: 'multi+tb', name: 'Multi-start + tie-break', desc: 'Six restarts, each scoring with the tie-break.', tiebreak: true, run: function* (ctx) { yield* restarts(ctx, 6, 1); } },
    { id: 'multi10+tb', name: '10 restarts + tie-break', desc: 'Ten short annealing runs from random layouts; on equal length, prefers fewer shortest routes.', tiebreak: true, run: function* (ctx) { yield* restarts(ctx, 10, 1); } },
    { id: 'multi+lns', name: 'Multi-start → destroy & repair', desc: 'Four restarts (60% of the budget), then exact window repairs on the best.', run: restartsThenLns },
    { id: 'pt+lns', name: 'Tempering → destroy & repair', desc: 'Parallel tempering (60%), then exact window repairs on the best.', run: ptThenLns },
    { id: 'tabu+restarts', name: 'Tabu + restarts', desc: 'Tabu search restarted from scratch four times.', run: tabuRestarts },
    { id: 'pt4+tb+compound', name: 'Smaller tempering + tie-break + compound', desc: 'Like tempering + tie-break + compound, but four annealers instead of six.', tiebreak: true, run: ptRestarts(1, 4) },
    { id: 'pt-restarts', name: 'Tempering, 5 restarts', desc: 'Six annealers at different temperatures swap layouts, restarted five times.', tiebreak: true, run: ptRestarts(5, 6) },
    { id: 'sa-auto', name: 'Annealing restarts', desc: 'Short annealing runs from random layouts, with more restarts as the evaluation budget grows; on equal length, prefers fewer shortest routes. The game uses this on small boards.', tiebreak: true, run: function* (ctx) { yield* restarts(ctx, restartsFor(ctx, SA_EVALS), 1); } },
    { id: 'pt-auto', name: 'Tempering restarts', desc: 'Six annealers at different temperatures swap layouts, with more restarts as the evaluation budget grows. The game uses this on medium and large boards.', tiebreak: true, run: ptRestarts(ctx => restartsFor(ctx, PT_EVALS), 6) },
  ];
  for (const c of combos) S.addMethod(Object.assign({ group: 'Combination' }, c));
});
