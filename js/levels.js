// Board definitions: size, wall budget, entry/exit and rock layout.
// optimum = proven by bench/prove.js; bestKnown = best found, not proven.
// evidence (bench/evidence.js): runs, how many hit bestKnown, longest budget
// (× optEvals), and the budget at which bestKnown first appeared.

const SIZES = {
  small:  { maxCell: 52, exact: true,  optMethod: 'sa-auto', optEvals: 5000 },
  medium: { maxCell: 44, exact: false, optMethod: 'pt-auto', optEvals: 50000 },
  large:  { maxCell: 40, exact: false, optMethod: 'pt-auto', optEvals: 300000 },
};

const LEVELS = {
  small: {
    label: 'Small 1', size: 'small', W: 11, H: 9, budget: 6, entry: [0, 4], exit: [10, 4],
    optimum: 26,
    rocks: [[2,1],[2,2],[5,0],[5,1],[4,5],[5,5],[8,3],[7,7],[8,7],[2,7]],
  },
  small2: {
    label: 'Small 2', size: 'small', W: 11, H: 9, budget: 6, entry: [0, 4], exit: [10, 4],
    optimum: 24,
    rocks: [[1,0],[2,0],[8,2],[9,3],[1,6],[4,6],[0,7],[1,7],[4,7],[6,8]],
  },
  small3: {
    label: 'Small 3', size: 'small', W: 11, H: 9, budget: 6, entry: [0, 0], exit: [10, 8],
    optimum: 24,
    rocks: [[5,0],[1,1],[4,1],[5,1],[1,2],[3,2],[4,2],[1,3],[5,4],[6,4],[1,8]],
  },
  medium1: {
    label: 'Medium 1', size: 'medium', W: 15, H: 11, budget: 10, entry: [0, 5], exit: [14, 5],
    optimum: 44,
    rocks: [[7,1],[9,1],[7,2],[4,3],[13,3],[4,4],[9,4],[10,4],[11,4],[1,6],[2,6],[2,7],[3,7],[3,8],[3,9],[3,10]],
  },
  medium2: {
    label: 'Medium 2', size: 'medium', W: 15, H: 11, budget: 10, entry: [0, 0], exit: [14, 10],
    optimum: 46,
    rocks: [[3,1],[1,2],[2,2],[3,2],[2,3],[2,4],[11,4],[12,4],[2,5],[11,5],[0,6],[10,6],[11,6],[0,7],[9,9],[9,10],[12,10]],
  },
  medium3: {
    label: 'Medium 3', size: 'medium', W: 15, H: 11, budget: 10, entry: [0, 2], exit: [14, 8],
    optimum: 40,
    rocks: [[7,0],[9,3],[10,3],[0,5],[7,5],[8,5],[1,7],[1,8],[10,8],[1,9],[2,9],[9,9],[10,9],[13,9],[5,10],[6,10]],
  },
  large: {
    label: 'Large 1', size: 'large', W: 21, H: 15, budget: 25, entry: [0, 7], exit: [20, 7],
    bestKnown: 92, evidence: { runs: 66, hits: 23, longest: 300, firstAt: 1 }, // bench/evidence.js
    rocks: [
      [3,2],[3,3],[4,3],          [9,1],[10,1],[10,2],      [18,1],[18,2],
      [7,4],                      [14,3],[15,3],[15,4],
      [9,6],[10,6],[10,7],[11,7], [4,8],[4,9],              [17,8],[17,9],[18,9],
      [6,10],[6,11],[7,11],       [13,11],[14,11],[14,12],  [2,12],[3,12],
      [11,13],[12,13],            [16,13],[17,13],
    ],
  },
  large2: {
    label: 'Large 2', size: 'large', W: 21, H: 15, budget: 25, entry: [0, 7], exit: [20, 7],
    bestKnown: 84, evidence: { runs: 66, hits: 9, longest: 300, firstAt: 10 }, // bench/evidence.js
    rocks: [[7,0],[14,0],[15,0],[16,0],[7,1],[8,1],[9,1],[8,4],[12,5],[13,5],[5,6],[10,6],[9,7],[10,7],[3,8],[10,8],[16,9],[20,9],[2,10],[7,10],[16,10],[7,11],[16,11],[16,12],[17,12],[18,12],[19,12],[4,13],[12,13],[16,13],[12,14],[16,14],[17,14]],
  },
  large3: {
    label: 'Large 3', size: 'large', W: 21, H: 15, budget: 25, entry: [0, 0], exit: [20, 14],
    bestKnown: 82, evidence: { runs: 72, hits: 6, longest: 1000, firstAt: 100 }, // bench/evidence.js
    rocks: [[14,0],[15,0],[15,1],[4,2],[12,2],[13,2],[4,3],[5,3],[11,3],[12,3],[17,4],[16,5],[17,5],[18,5],[16,6],[0,8],[19,8],[20,8],[2,9],[3,9],[4,9],[3,10],[4,10],[0,11],[1,11],[2,11],[3,11],[8,11],[2,12],[4,12],[7,12],[8,12],[4,13],[7,13]],
  },
  large4: {
    label: 'Large 4', size: 'large', W: 21, H: 15, budget: 25, entry: [0, 3], exit: [20, 11],
    bestKnown: 88, evidence: { runs: 72, hits: 5, longest: 1000, firstAt: 300 }, // bench/evidence.js
    rocks: [[10,0],[20,0],[6,2],[7,2],[9,2],[6,3],[18,5],[5,6],[6,6],[16,6],[17,6],[18,6],[6,7],[18,7],[19,7],[18,8],[3,9],[4,9],[18,9],[4,10],[9,10],[14,10],[9,11],[8,12],[9,12],[5,13],[6,13],[7,13],[17,13],[18,13],[19,13],[17,14]],
  },
  large5: {
    label: 'Large 5', size: 'large', W: 21, H: 15, budget: 25, entry: [0, 7], exit: [20, 7],
    bestKnown: 90, evidence: { runs: 66, hits: 11, longest: 300, firstAt: 1 }, // bench/evidence.js
    rocks: [[18,0],[19,0],[20,0],[2,1],[3,1],[18,1],[18,2],[6,3],[6,4],[0,5],[1,5],[14,5],[1,6],[2,7],[2,8],[1,9],[8,9],[9,9],[10,9],[11,9],[1,10],[2,10],[8,11],[18,11],[19,11],[1,12],[2,12],[8,12],[18,12],[19,12],[7,13],[8,13],[9,13],[10,13],[19,13],[0,14]],
  },
};
for (const L of Object.values(LEVELS)) Object.assign(L, SIZES[L.size], { ...L });
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
