// EasyThon 2026 · 3D stage loader
// Checks for WebGL 2 and measures the browser's own frame pace, then loads three.js and the stage's own files (next
// to this one) and starts the stage (main.js). Plain scripts throughout, so it also runs from a page opened straight
// from disk, where module scripts are refused. Without WebGL the stage simply stays empty.
(() => {
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.min.js';
  const PARTS = ['layouts', 'legends', 'keycap', 'main'];

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('scene');
  // the stage's files sit next to this one, wherever the page is served from
  const here = document.currentScript && document.currentScript.src;
  if (!stage || !canvas || !here) return;

  function hasWebGL2() {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return false;
    const lose = probe.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  }
  if (!hasWebGL2()) return;

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

  // in order: main.js uses the other three
  const load = name => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`${name}.js`, here).href;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`could not load ${script.src}`));
    document.head.appendChild(script);
  });

  Promise.all([import(THREE_URL), Promise.all(PARTS.map(load)), framePace()])
    .then(([THREE, , pace]) => window.EasyThonStage.start(THREE, { stage, canvas, pace }))
    .catch(err => console.warn('[stage] 3D stage disabled:', err));
})();
