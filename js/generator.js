// Map generator page: builds a random board from the form, then loads it into
// the same game code as the play page. Same options + same seed = same map.

const GEN_SIZES = {
  small:  { W: 11, H: 9,  walls: 6 },
  medium: { W: 15, H: 11, walls: 10 },
  large:  { W: 21, H: 15, walls: 25 },
};

function endpoints(layout, W, H, rng) {
  if (layout === 'corners') return [[0, 0], [W - 1, H - 1]];
  if (layout === 'random') return [[0, (rng() * H) | 0], [W - 1, (rng() * H) | 0]];
  const mid = (H / 2) | 0;
  return [[0, mid], [W - 1, mid]];
}

// The optimizer's method and effort follow the wall count, like the fixed boards.
function buildMap() {
  const size = $('gSize').value, { W, H } = GEN_SIZES[size];
  const budget = Math.max(1, Math.min(40, +$('gWalls').value || 1));
  const seed = Math.max(1, +$('gSeed').value || 1);
  const rocks = Math.round(W * H * +$('gRocks').value / 100);
  const [entry, exit] = endpoints($('gEnds').value, W, H, MapGen.makeRng(seed + 1));
  const cells = MapGen.generateRocks({ W, H, rocks, entry, exit, seed });
  if (!cells) return null;
  const tier = SIZES[budget <= 8 ? 'small' : budget <= 15 ? 'medium' : 'large'];
  const exact = size === 'small' && budget <= 6;
  return {
    label: 'Generated', size, W, H, budget, entry, exit, rocks: cells, seed,
    maxCell: SIZES[size].maxCell, exact, optMethod: tier.optMethod, optEvals: tier.optEvals,
    note: `Map seed ${seed}: ${cells.length} rocks. The best possible path on a new map is unknown. ` +
      (exact ? 'Solve exactly finds it and proves it.' : 'Optimize gives a strong answer, but not a proven one.'),
  };
}

// Replaces the board with the map the form describes.
function generate() {
  if (mode !== 'edit') return;
  const map = buildMap();
  if (!map) { say('No valid map with that many rocks: lower the rock density or try a new seed.'); return; }
  LEVELS.custom = map;
  loadLevel('custom');
}

$('gRocks').oninput = () => { $('gRocksLabel').textContent = $('gRocks').value + '%'; };
$('gSize').onchange = () => { $('gWalls').value = GEN_SIZES[$('gSize').value].walls; generate(); };
for (const id of ['gWalls', 'gSeed', 'gRocks', 'gEnds']) $(id).onchange = generate;
$('bNew').onclick = () => { $('gSeed').value = 1 + ((Math.random() * 99999) | 0); generate(); };

$('gSeed').value = 1 + ((Math.random() * 99999) | 0);
LEVELS.custom = buildMap();
window.START_LEVEL = 'custom';
