// EasyThon 2026 · 3D stage loader
// Checks for WebGL 2 and measures the browser's own frame pace, then pulls in three.js and the stage (main.js).
// Without WebGL the flat mark in the stage simply stays; nothing here throws.
const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');

function hasWebGL2() {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return false;
  const lose = probe.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();
  return true;
}

// the shortest of a few idle frames: 1/60 on most screens, 1/120 on fast ones, 1/30 under a power saver
function framePace(frames = 20) {
  return new Promise(done => {
    let prev = 0;
    let shortest = Infinity;
    let left = frames;
    const finish = () => done(Number.isFinite(shortest) ? Math.min(1 / 20, Math.max(1 / 240, shortest)) : 1 / 60);
    const step = now => {
      if (prev) shortest = Math.min(shortest, (now - prev) / 1000);
      prev = now;
      if (--left > 0) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
    setTimeout(finish, 1500);   // a tab in the background hands out no frames at all
  });
}

if (stage && canvas && hasWebGL2()) {
  Promise.all([import('./main.js'), framePace()])
    .then(([main, pace]) => main.start({ stage, canvas, pace }))
    .catch(err => console.warn('[stage] 3D stage disabled:', err));
}
