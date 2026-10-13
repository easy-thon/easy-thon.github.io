// EasyThon 2026 · the board's sound
// Real keyboards, recorded. The keys sound as they go down and come back up: under the visitor's own keyboard
// (wherever the pointer is), a click or a tap, and softly as the pointer passes over them. Never by themselves: the
// board typing the name on its own is silent. The keyboard is picked in the intro (or none); the choice is kept for
// the next visit.
// Each keyboard is a pack in assets/sounds/: takes of its keys going down and coming back up, its space bar and its
// enter, cut from recordings released under free licences (assets/sounds/CREDITS.md), laid end to end in one FLAC
// written into a script, so that a pack loads with a plain script tag, from disk too. A pack loads when it is first
// needed (the one in use, once the page is idle), and is decoded once.
// A browser lets a page make sound only once the visitor has clicked or typed on it, so until then the pointer
// passing over the keys is silent.
(parts => {
  const STORE = 'easython:key-sound';
  const OFF = 'off';
  const here = document.currentScript && document.currentScript.src;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ----- Packs -----
  const packs = new Map();   // id -> { ready: Promise, buffer, takes, gain, last: {} }
  const validId = id => /^[a-z0-9-]+$/.test(id || '');
  function decode(bytes) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Offline(1, 1, 48000);
    return new Promise((resolve, reject) => {
      const pending = ctx.decodeAudioData(bytes, resolve, reject);
      if (pending && pending.then) pending.then(resolve, reject);
    });
  }
  function load(id) {
    if (!validId(id) || id === OFF || !here) return Promise.resolve(null);
    if (packs.has(id)) return packs.get(id).ready;
    const pack = { buffer: null, takes: null, gain: 1, last: {} };
    pack.ready = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = new URL(`../../sounds/${id}.js`, here).href;
      script.onload = () => resolve(window.EasyThonSounds && window.EasyThonSounds[id]);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    }).then(data => {
      if (!data) return null;
      const text = atob(data.audio.slice(data.audio.indexOf(',') + 1));
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      pack.takes = data.takes;
      pack.gain = 10 ** ((data.level || 0) / 20);   // brings the keyboards to about the same loudness
      pack.gains = data.gains || {};                // and a kind that borrows another's takes to its own
      delete window.EasyThonSounds[id];   // the decoded buffer is all that is needed from here
      return decode(bytes.buffer).then(buffer => {
        pack.buffer = buffer;
        return pack;
      });
    }).catch(err => {
      console.warn('[stage] key sounds not loaded:', id, err);
      return null;
    });
    packs.set(id, pack);
    return pack.ready;
  }

  // a take of a kind, never the same one twice running
  function takeOf(pack, kind) {
    const list = pack.takes[kind];
    if (!list || !list.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === pack.last[kind]) i = (i + 1) % list.length;
    pack.last[kind] = i;
    return list[i];
  }

  // ----- Playing -----
  function create({ picker } = {}) {
    const Context = window.AudioContext || window.webkitAudioContext;
    const inputs = picker ? [...picker.querySelectorAll('input[type="radio"]')] : [];
    const ids = inputs.map(input => input.value);
    let name = ids.find(id => id !== OFF) || OFF;
    try {
      const kept = window.localStorage.getItem(STORE);
      if (ids.includes(kept)) name = kept;
    } catch (err) { /* storage blocked: the default it is */ }
    let ctx = null;
    let out = null;

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
      out.gain.value = 0.9;
      // a run of keys never clips
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -6;
      limit.knee.value = 4;
      limit.ratio.value = 10;
      limit.attack.value = 0.001;
      limit.release.value = 0.1;
      out.connect(limit).connect(ctx.destination);
      return ctx;
    }

    // One stroke of one key: code (KeyboardEvent.code), its width in u, where it stands left to right (-1..1), and
    // how hard: soft for the pointer passing over. delay is in s; gesture says this comes straight from a click or
    // a keypress, which may start the sound
    function play({ code = '', size = 1, pan = 0, stroke = 'down', soft = false, delay = 0, gesture = false }) {
      if (name === OFF) return;
      const c = context(gesture);
      if (!c || (c.state !== 'running' && !gesture)) return;
      const pack = packs.get(name);
      if (!pack || !pack.buffer) {
        load(name);   // not here yet: this stroke goes unheard
        return;
      }
      // the kind of take, and how much lower a wider key sounds where the pack has nothing of its own for it
      const wide = size >= 1.9;
      let kind = 'down';
      let rate = 1;
      if (stroke === 'up') {
        kind = 'up';
        if (wide) rate = 0.93;
      } else if (code === 'Enter' && pack.takes.enter) kind = 'enter';
      else if (size >= 4 && pack.takes.space) kind = 'space';
      else if (wide && pack.takes.space) {
        kind = 'space';
        rate = 1.06;
      } else if (wide) rate = 0.92;
      const take = takeOf(pack, kind);
      if (!take) return;
      const source = c.createBufferSource();
      source.buffer = pack.buffer;
      source.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * 0.025);
      const gain = c.createGain();
      gain.gain.value = pack.gain * (pack.gains[kind] || 1) * (soft ? 0.4 : 1) * 10 ** (((Math.random() * 2 - 1) * 1.5) / 20);
      let node = source.connect(gain);
      if (c.createStereoPanner) {
        const panner = c.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1) * 0.5;
        node = node.connect(panner);
      }
      node.connect(out);
      source.start(c.currentTime + delay, take[0], take[1]);
    }

    // a few keys, to hear a keyboard as it is picked
    function sample() {
      [['KeyE', 1, -0.3, 0], ['KeyA', 1, -0.55, 0.14], ['Space', 7, 0, 0.29]].forEach(([code, size, pan, at]) => {
        play({ code, size, pan, delay: at, gesture: true });
        play({ code, size, pan, stroke: 'up', delay: at + 0.09, gesture: true });
      });
    }

    function choose(next) {
      if (!ids.includes(next)) return;
      name = next;
      try {
        window.localStorage.setItem(STORE, name);
      } catch (err) { /* not kept: fine for this visit */ }
      if (name === OFF) return;
      context(true);
      load(name).then(pack => { if (pack && name === next) sample(); });
    }

    // The picker in the intro (the stage shows it once the board is up): a cap names the keyboard in use and opens
    // the list; picking one lets it be heard, and the list stays open to try the others
    if (picker) {
      const toggle = picker.querySelector('[data-key-sound-toggle]');
      const list = picker.querySelector('[data-key-sound-list]');
      const current = picker.querySelector('[data-key-sound-name]');
      const named = () => {
        const input = inputs.find(i => i.value === name);
        if (current && input) current.textContent = input.nextElementSibling.textContent;
      };
      inputs.forEach(input => { input.checked = input.value === name; });
      named();
      picker.addEventListener('change', e => {
        if (e.target.type !== 'radio' || !e.target.checked) return;
        choose(e.target.value);
        named();
      });
      if (toggle && list) {
        const open = on => {
          list.hidden = !on;
          toggle.setAttribute('aria-expanded', String(on));
          if (on) (inputs.find(i => i.checked) || inputs[0]).focus();
        };
        toggle.addEventListener('click', () => open(list.hidden));
        // closed by a click elsewhere, by escape, or by the focus moving on
        document.addEventListener('pointerdown', e => { if (!list.hidden && !picker.contains(e.target)) open(false); });
        picker.addEventListener('keydown', e => {
          if (e.key !== 'Escape' || list.hidden) return;
          open(false);
          toggle.focus();
        });
        picker.addEventListener('focusout', e => {
          if (!list.hidden && e.relatedTarget && !picker.contains(e.relatedTarget)) open(false);
        });
      }
      // where the recordings come from, in the foot of the page
      const credits = picker.querySelector('[data-key-sound-credits]');
      const notes = document.getElementById('sound-credits');
      if (credits && notes) credits.addEventListener('click', () => { notes.open = true; });
    }

    return {
      play,
      supported: !!Context && !!(window.OfflineAudioContext || window.webkitOfflineAudioContext),
      get name() { return name; },
      // the pack in use, ahead of the first key (once the page has nothing better to do)
      prepare() {
        const go = () => load(name);
        if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 4000 });
        else setTimeout(go, 1500);
      },
    };
  }

  parts.sound = { create };
})(window.EasyThonStage = window.EasyThonStage || {});
