// Grid algorithms: BFS distance field, flow-field steps, shortest path.

// core algorithm: BFS from exit
function blocked(c, w) { return w.has(c) || ROCKS.has(c); }

function bfs(w, out) {
  out.fill(-1);
  const q = new Int32Array(N);
  let head = 0, tail = 0;
  out[EXIT] = 0; q[tail++] = EXIT;
  while (head < tail) {
    const c = q[head++], x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idx(nx, ny);
      if (out[n] !== -1 || blocked(n, w)) continue;
      out[n] = out[c] + 1;
      q[tail++] = n;
    }
  }
  return out[ENTRY];
}

// next tile in the flow field: the neighbor with smallest distance
function nextCell(c) {
  const x = c % W, y = (c / W) | 0;
  let best = -1, bd = dist[c];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = idx(nx, ny);
    if (dist[n] >= 0 && dist[n] < bd) { bd = dist[n]; best = n; }
  }
  return best;
}

function shortestPath() {
  const p = [ENTRY];
  let c = ENTRY;
  while (c !== EXIT && c !== -1) { c = nextCell(c); if (c !== -1) p.push(c); }
  return p;
}

function freeCells(w) {
  const f = [];
  for (let c = 0; c < N; c++) if (c !== ENTRY && c !== EXIT && !blocked(c, w)) f.push(c);
  return f;
}

let pathDist;
function pathOf(w) {
  // shortest path for wall set w (uses its own distance array so the display isn't touched)
  if (bfs(w, pathDist) < 0) return [];
  const p = [ENTRY];
  let c = ENTRY;
  while (c !== EXIT) {
    const x = c % W, y = (c / W) | 0;
    let nxt = -1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idx(nx, ny);
      if (pathDist[n] >= 0 && pathDist[n] < pathDist[c]) { nxt = n; break; }
    }
    c = nxt; p.push(c);
  }
  return p;
}
