// Map generator: rocks in small clusters of 1–4, rejected if any open tile is
// cut off. Rocks never touch the entry or exit. Shared by the map generator
// page (browser) and bench/genmaps.js (Node).
(function (root) {
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function connected(W, H, entry, rock) {
  const start = entry[1] * W + entry[0], seen = new Set([start]), stack = [start];
  while (stack.length) {
    const c = stack.pop(), x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, n = ny * W + nx;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && !rock.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen.size === W * H - rock.size;
}

// Returns the rocks as [[x, y], ...], or null if no valid layout turned up.
function generateRocks({ W, H, rocks, entry, exit, seed, attempts = 1000 }) {
  const rng = makeRng(seed);
  const near = (x, y, [px, py]) => Math.abs(x - px) + Math.abs(y - py) <= 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rock = new Set();
    for (let tries = 0; rock.size < rocks && tries < rocks * 50; tries++) {
      let x = (rng() * W) | 0, y = (rng() * H) | 0;
      const size = 1 + ((rng() * 4) | 0);
      for (let k = 0; k < size && rock.size < rocks; k++) {
        if (!near(x, y, entry) && !near(x, y, exit)) rock.add(y * W + x);
        const [dx, dy] = DIRS[(rng() * 4) | 0];
        x = Math.min(W - 1, Math.max(0, x + dx)); y = Math.min(H - 1, Math.max(0, y + dy));
      }
    }
    if (rock.size === rocks && connected(W, H, entry, rock)) {
      return [...rock].sort((p, q) => p - q).map(c => [c % W, (c / W) | 0]);
    }
  }
  return null;
}

const API = { generateRocks, makeRng };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.MapGen = API;
})(typeof window !== 'undefined' ? window : globalThis);
