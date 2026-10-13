// EasyThon 2026 · the board's sound
// The keys sound as they go down and come back up: under the visitor's own keyboard (wherever the pointer is), a
// click or a tap, and softly as the pointer passes over them. Never by themselves: the board typing the name on its
// own is silent. Four switches to choose from, or none (the picker in the intro); the choice is kept for the next
// visit. Every sound is made here, from bursts of noise and the parts they set ringing (Web Audio), so there is
// nothing to load and it works from disk too. A browser lets a page make sound only once the visitor has clicked or
// typed on it, so until then the pointer passing over the keys is silent.
(parts => {
  const STORE = 'easython:key-sound';
  // the switches on offer, in the picker's order; the first is the default
  const SWITCHES = ['thock', 'clicky', 'linear', 'typewriter', 'off'];
  const VARIANTS = 4;   // takes of every sound, picked at random, so that a run of keys never repeats itself

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // a seeded random source: the takes are the same on every visit
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = text => [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

  // ----- Strikes -----
  // A strike is a short burst of noise (len s, shaped by one-pole low- and high-pass filters at lp and hp Hz), heard
  // as it is (dry) and through the parts it sets ringing: each a decaying resonance [frequency Hz, time constant s,
  // level]. Every take nudges the resonances a little.
  function strike(out, rate, hit, rnd) {
    const start = Math.round(hit.at * rate);
    const n = Math.max(2, Math.round(hit.len * rate));
    const burst = new Float32Array(n);
    const kl = hit.lp ? 1 - Math.exp((-2 * Math.PI * hit.lp) / rate) : 1;
    const kh = hit.hp ? Math.exp((-2 * Math.PI * hit.hp) / rate) : 0;
    let low = 0;
    let last = 0;
    let high = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = (rnd() * 2 - 1) * Math.min(1, t * 10) * Math.exp(-4 * t);
      low += kl * (x - low);
      high = kh * (high + low - last);
      last = low;
      burst[i] = hit.hp ? high : low;
    }
    for (let j = 0; j < n && start + j < out.length; j++) out[start + j] += burst[j] * hit.dry * hit.gain;
    for (const [freq, tau, level] of hit.modes) {
      const f = freq * (1 + (rnd() * 2 - 1) * 0.02);
      if (f >= rate / 2.2) continue;
      const w = (2 * Math.PI * f) / rate;
      const r = Math.exp(-1 / (tau * rate));
      const a1 = 2 * r * Math.cos(w);
      const a2 = r * r;
      const g = Math.sin(w) * level * hit.gain * (1 + (rnd() * 2 - 1) * 0.15);
      let y1 = 0;
      let y2 = 0;
      const end = Math.min(out.length, start + n + Math.ceil(tau * rate * 7));
      for (let i = start; i < end; i++) {
        const j = i - start;
        const y = a1 * y1 - a2 * y2 + (j < n ? burst[j] : 0);
        y2 = y1;
        y1 = y;
        out[i] += y * g;
      }
    }
  }
  const lengthOf = hits => Math.max(...hits.map(hit => hit.at + hit.len + 7 * Math.max(0, ...hit.modes.map(m => m[1]))));

  // ----- The switches -----
  // Each recipe gives the strikes of one stroke ('down' or 'up') of one kind of key. p scales the pitch and d the
  // ring by the size of the key (a wider cap sounds lower and longer); t() nudges a time a little, take by take.
  const SIZES = { alpha: [1, 1], mod: [0.92, 1.08], big: [0.84, 1.2], space: [0.74, 1.35], enter: [0.84, 1.2] };
  // a long cap rides on a stabiliser, whose wire ticks just after the cap lands
  const wire = at => ({ at, len: 0.0008, dry: 0.3, hp: 1500, lp: 9000, gain: 0.12, modes: [[3300, 0.004, 1], [5200, 0.002, 0.6]] });
  const stabilised = (hits, kind, t) => (kind === 'big' || kind === 'enter' ? [...hits, wire(t(0.011))]
    : kind === 'space' ? [...hits, wire(t(0.009)), { ...wire(t(0.017)), gain: 0.07 }] : hits);

  const RECIPES = {
    // 도각: a deep, round knock, the cap on a damped case, with little click on top
    thock(stroke, kind, p, d, t) {
      if (stroke === 'up') {
        return [{ at: 0, len: 0.0015, dry: 0.1, hp: 120, lp: 4500, gain: 1,
          modes: [[310 * p, 0.013, 0.55], [700 * p, 0.009, 0.5], [1500 * p, 0.005, 0.35], [2800 * p, 0.003, 0.18]] }];
      }
      return stabilised([
        { at: 0, len: 0.0006, dry: 0.4, hp: 1800, lp: 9000, gain: 0.1, modes: [[2600 * p, 0.004, 1]] },
        { at: t(0.004), len: 0.003, dry: 0.12, hp: 60, lp: 3200, gain: 1,
          modes: [[230 * p, 0.026 * d, 0.9], [480 * p, 0.018 * d, 0.85], [920 * p, 0.011 * d, 0.55], [1750 * p, 0.006 * d, 0.3],
            [3000 * p, 0.003 * d, 0.1]] },
      ], kind, t);
    },
    // 청축: a bright click on the way down, then the bottom; and the click again on the way up
    clicky(stroke, kind, p, d, t) {
      if (stroke === 'up') {
        return [
          { at: 0, len: 0.0004, dry: 0.25, hp: 1500, lp: 14000, gain: 1,
            modes: [[4200 * p, 0.005, 1], [6100 * p, 0.003, 0.55], [2900 * p, 0.005, 0.3]] },
          { at: t(0.004), len: 0.001, dry: 0.1, hp: 300, lp: 6000, gain: 0.45, modes: [[1700 * p, 0.006, 0.8], [3100 * p, 0.004, 0.5]] },
        ];
      }
      return stabilised([
        { at: 0, len: 0.0004, dry: 0.3, hp: 1200, lp: 14000, gain: 1,
          modes: [[3900 * p, 0.0055, 1], [5700 * p, 0.0035, 0.65], [7600 * p, 0.0022, 0.35], [2650 * p, 0.006, 0.3]] },
        { at: t(0.007), len: 0.0016, dry: 0.12, hp: 120, lp: 5500, gain: 0.65,
          modes: [[1020 * p, 0.012 * d, 1], [2150 * p, 0.008 * d, 0.6], [3350 * p, 0.005 * d, 0.35], [540 * p, 0.016 * d, 0.45]] },
      ], kind, t);
    },
    // 적축: one clean, clacky bottom-out, brighter than the knock
    linear(stroke, kind, p, d, t) {
      if (stroke === 'up') {
        return [{ at: 0, len: 0.001, dry: 0.12, hp: 300, lp: 7000, gain: 1,
          modes: [[1450 * p, 0.007, 0.8], [2900 * p, 0.005, 0.55], [4400 * p, 0.003, 0.25]] }];
      }
      return stabilised([
        { at: 0, len: 0.0005, dry: 0.3, hp: 2000, lp: 10000, gain: 0.1, modes: [[3000 * p, 0.003, 1]] },
        { at: t(0.003), len: 0.0013, dry: 0.15, hp: 150, lp: 6500, gain: 1,
          modes: [[1150 * p, 0.013 * d, 1], [2380 * p, 0.0085 * d, 0.62], [3650 * p, 0.005 * d, 0.33], [580 * p, 0.018 * d, 0.5],
            [5300 * p, 0.0025 * d, 0.14]] },
      ], kind, t);
    },
    // 타자기: the lever goes down, the type bar strikes the platen and rings, the carriage steps on; the space bar
    // only steps it, the shift moves the basket, and the end of the line rings the bell and runs the carriage back
    typewriter(stroke, kind, p, d, t) {
      if (stroke === 'up') {
        return [{ at: 0, len: 0.0012, dry: 0.08, hp: 200, lp: 5000, gain: 1, modes: [[1250 * p, 0.01, 0.7], [2600 * p, 0.006, 0.5]] }];
      }
      const lever = { at: 0, len: 0.002, dry: 0.05, hp: 60, lp: 1500, gain: 0.35, modes: [[150 * p, 0.03, 1], [330 * p, 0.02, 0.5]] };
      const step = at => ({ at, len: 0.0003, dry: 0.3, hp: 2500, lp: 15000, gain: 0.22, modes: [[5400, 0.006, 0.6], [3900, 0.008, 0.45]] });
      if (kind === 'space') {
        return [{ ...lever, gain: 0.6, modes: [[120, 0.04, 1], [270, 0.025, 0.5], [600, 0.012, 0.25]] }, step(t(0.02))];
      }
      if (kind === 'enter') {
        const ratchet = Array.from({ length: 9 }, (_, i) => ({ ...step(t(0.1) + i * 0.014), gain: 0.1 * (1 - i / 11) }));
        return [lever,
          { at: t(0.02), len: 0.0004, dry: 0.05, hp: 800, lp: 15000, gain: 0.4,
            modes: [[2093, 0.35, 1], [5040, 0.18, 0.32], [8160, 0.08, 0.12]] },
          ...ratchet];
      }
      if (kind !== 'alpha') {
        return [{ ...lever, gain: 0.6, modes: [[170 * p, 0.04, 1], [400 * p, 0.022, 0.6], [900 * p, 0.01, 0.3]] }, step(t(0.03))];
      }
      return [lever,
        { at: t(0.012), len: 0.0007, dry: 0.45, hp: 500, lp: 15000, gain: 1,
          modes: [[2050 * p, 0.07, 0.55], [3370 * p, 0.045, 0.5], [4880 * p, 0.03, 0.42], [7150 * p, 0.018, 0.26],
            [940 * p, 0.04, 0.45], [220, 0.035, 0.55]] },
        step(t(0.045))];
    },
  };
  // how loud each stroke is, after every take is brought to the same peak; and each switch against the others
  const LEVELS = {
    thock: { down: 1, up: 0.3 },
    clicky: { down: 0.62, up: 0.42 },
    linear: { down: 0.65, up: 0.26 },
    typewriter: { down: 0.59, up: 0.12 },
  };
  const KIND_LEVELS = { alpha: 1, mod: 1, big: 1.08, space: 1.12, enter: 0.7 };

  // one take of one stroke, as samples at the given rate, peaking at 1
  function render(name, kind, stroke, take, rate) {
    const rnd = random(hash(`${name}/${kind}/${stroke}/${take}`));
    const [ps, ds] = SIZES[kind] || SIZES.alpha;
    const p = ps * (1 + (rnd() * 2 - 1) * 0.03);
    const d = ds * (1 + (rnd() * 2 - 1) * 0.08);
    const t = at => at * (1 + (rnd() * 2 - 1) * 0.12);
    const hits = RECIPES[name](stroke, kind, p, d, t);
    const out = new Float32Array(Math.ceil(lengthOf(hits) * rate) + 1);
    hits.forEach(hit => strike(out, rate, hit, rnd));
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
    return out;
  }

  // which sound a key makes: by its width on the stage (u); the typewriter's carriage return is its own
  const kindOf = (code, size) => (code === 'Enter' ? 'enter' : size >= 4 ? 'space' : size >= 2 ? 'big' : size >= 1.3 ? 'mod' : 'alpha');

  // ----- Playing -----
  function create({ picker } = {}) {
    const Context = window.AudioContext || window.webkitAudioContext;
    let name = SWITCHES[0];
    try {
      const kept = window.localStorage.getItem(STORE);
      if (SWITCHES.includes(kept)) name = kept;
    } catch (err) { /* storage blocked: the default it is */ }
    let ctx = null;
    let out = null;
    const takes = new Map();

    // made on the first gesture (or after one, where the browser says so): before that a page may not make sound
    function context(gesture) {
      if (ctx) {
        if (ctx.state === 'suspended' && gesture) ctx.resume().catch(() => {});
        return ctx;
      }
      if (!Context) return null;
      const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : false;
      if (!gesture && !active) return null;
      try {
        ctx = new Context({ latencyHint: 'interactive' });
      } catch (err) {
        return null;
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      out = ctx.createGain();
      out.gain.value = 0.5;
      // a run of keys never clips
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -8;
      limit.knee.value = 6;
      limit.ratio.value = 8;
      limit.attack.value = 0.002;
      limit.release.value = 0.12;
      out.connect(limit).connect(ctx.destination);
      return ctx;
    }

    function takesOf(kind, stroke) {
      const id = `${name}/${kind}/${stroke}`;
      if (!takes.has(id)) {
        takes.set(id, Array.from({ length: VARIANTS }, (_, take) => {
          const samples = render(name, kind, stroke, take, ctx.sampleRate);
          const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
          buffer.copyToChannel(samples, 0);
          return buffer;
        }));
      }
      return takes.get(id);
    }

    // One stroke of one key: code (KeyboardEvent.code), its width in u, where it stands left to right (-1..1), and
    // how hard: soft for the pointer passing over. delay is in s; gesture says this comes straight from a click or
    // a keypress, which may start the sound
    function play({ code = '', size = 1, pan = 0, stroke = 'down', soft = false, delay = 0, gesture = false }) {
      if (name === 'off') return;
      const c = context(gesture);
      if (!c || (c.state !== 'running' && !gesture)) return;
      let kind = kindOf(code, size);
      if (kind === 'enter' && name !== 'typewriter') kind = size >= 3 ? 'space' : 'big';
      const set = takesOf(kind, stroke);
      const source = c.createBufferSource();
      source.buffer = set[Math.floor(Math.random() * set.length)];
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.025;
      const gain = c.createGain();
      gain.gain.value = LEVELS[name][stroke] * (KIND_LEVELS[kind] || 1) * (soft ? 0.35 : 1) * (0.9 + Math.random() * 0.2);
      let node = source.connect(gain);
      if (c.createStereoPanner) {
        const panner = c.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1) * 0.6;
        node = node.connect(panner);
      }
      node.connect(out);
      source.start(c.currentTime + delay);
    }

    // a few keys, to hear a switch as it is picked
    function sample() {
      [['KeyE', 1, -0.3, 0], ['KeyA', 1, -0.55, 0.13], ['Space', 7, 0, 0.27]].forEach(([code, size, pan, at]) => {
        play({ code, size, pan, delay: at, gesture: true });
        play({ code, size, pan, stroke: 'up', delay: at + 0.075, gesture: true });
      });
    }

    function choose(next) {
      if (!SWITCHES.includes(next)) return;
      name = next;
      try {
        window.localStorage.setItem(STORE, name);
      } catch (err) { /* not kept: fine for this visit */ }
      if (name !== 'off') sample();
    }

    // the picker in the intro (the stage shows it once the board is up)
    if (picker) {
      picker.querySelectorAll('input[type="radio"]').forEach(input => { input.checked = input.value === name; });
      picker.addEventListener('change', e => {
        if (e.target.type === 'radio' && e.target.checked) choose(e.target.value);
      });
    }

    return { play, supported: !!Context };
  }

  // render and kindOf also make the sounds outside a page (to listen to them, or check them)
  parts.sound = { create, render, kindOf };
})(window.EasyThonStage = window.EasyThonStage || {});
