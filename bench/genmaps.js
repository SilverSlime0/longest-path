// Prints a generated rock layout (see js/mapgen.js) as JSON, with a preview on stderr.
// Usage: node bench/genmaps.js W H rocks entryX,entryY exitX,exitY seed
const { generateRocks } = require('../js/mapgen.js');

const [W, H, rocks, en, ex, seed] = process.argv.slice(2);
const entry = en.split(',').map(Number), exit = ex.split(',').map(Number);
const cells = generateRocks({ W: +W, H: +H, rocks: +rocks, entry, exit, seed: +seed });
if (!cells) { console.error('no layout found'); process.exit(1); }
const rock = new Set(cells.map(([x, y]) => `${x},${y}`));
for (let y = 0; y < +H; y++) {
  let row = '';
  for (let x = 0; x < +W; x++) row += x === entry[0] && y === entry[1] ? 'E' : x === exit[0] && y === exit[1] ? 'X' : rock.has(`${x},${y}`) ? '#' : '.';
  console.error(row);
}
console.log(JSON.stringify(cells));
