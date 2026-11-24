// Animation loop and startup.

function loop(now) {
  if (mode === 'opt') stepOpt();
  if (mode === 'exact') stepExact();
  draw(now);
  requestAnimationFrame(loop);
}

loadLevel(window.START_LEVEL || 'small');
if ($('level')) loadFromQuery(location.search);
requestAnimationFrame(loop);
