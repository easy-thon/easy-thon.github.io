// EasyThon 2026 · stage layouts
// Every arrangement the keys take, as plain numbers: no three.js in here.
// Units are key units (u): a letter key sits on a 1u square. The plate's top is y = 0, x runs to the right and
// z toward the viewer. One board of 39 keys is the whole cast; each formation says where every key goes
// (or that it drops out of sight into the plate), and main.js moves the keys between them as the page scrolls.
(parts => {
  const GAP = 0.1;                 // between neighbouring caps
  const SEAT = 0.08;               // caps ride this far above the plate, where the switches would be
  const CAP_H = 0.42;              // cap height
  const PLATE_H = 0.5;             // plate thickness
  const MARGIN = 0.42;             // plate border around what stands on it
  const CAP_PROFILE = [0.11, 0.035];   // a key cap: how far the top is drawn in (taper), and its dish
  const FLAT_PROFILE = [0.015, 0];     // straight walls and a flat top: clock hands, plinth layers

  const COLORS = {
    cap: '#f4f2ed',     // porcelain caps
    mod: '#2a2927',     // ink modifiers
    red: '#e8402f',     // the signal red
    stone: '#d6d2c9',   // sessions still to come
    plate: '#b7b3aa',   // anodised plate
  };

  // A Korean 40% board: Latin legends top left, the 두벌식 jamo bottom right
  const ROWS = [
    [['Tab', 1.5, 'tab'], ['KeyQ', 1, 'Q', 'ㅂ'], ['KeyW', 1, 'W', 'ㅈ'], ['KeyE', 1, 'E', 'ㄷ'], ['KeyR', 1, 'R', 'ㄱ'],
      ['KeyT', 1, 'T', 'ㅅ'], ['KeyY', 1, 'Y', 'ㅛ'], ['KeyU', 1, 'U', 'ㅕ'], ['KeyI', 1, 'I', 'ㅑ'], ['KeyO', 1, 'O', 'ㅐ'],
      ['KeyP', 1, 'P', 'ㅔ'], ['Backspace', 1.5, '']],
    [['CapsLock', 1.75, 'caps'], ['KeyA', 1, 'A', 'ㅁ'], ['KeyS', 1, 'S', 'ㄴ'], ['KeyD', 1, 'D', 'ㅇ'], ['KeyF', 1, 'F', 'ㄹ'],
      ['KeyG', 1, 'G', 'ㅎ'], ['KeyH', 1, 'H', 'ㅗ'], ['KeyJ', 1, 'J', 'ㅓ'], ['KeyK', 1, 'K', 'ㅏ'], ['KeyL', 1, 'L', 'ㅣ'],
      ['Enter', 2.25, 'enter']],
    [['ShiftLeft', 2.25, 'shift'], ['KeyZ', 1, 'Z', 'ㅋ'], ['KeyX', 1, 'X', 'ㅌ'], ['KeyC', 1, 'C', 'ㅊ'], ['KeyV', 1, 'V', 'ㅍ'],
      ['KeyB', 1, 'B', 'ㅠ'], ['KeyN', 1, 'N', 'ㅜ'], ['KeyM', 1, 'M', 'ㅡ'], ['Comma', 1, ','], ['Period', 1, '.'],
      ['ShiftRight', 1.75, 'shift']],
    [['ControlLeft', 1.5, 'ctrl'], ['AltLeft', 1.5, 'alt'], ['Space', 7, ''], ['Lang1', 1.5, '한/영'], ['Lang2', 1.5, '한자']],
  ];

  // the name is on the board: these caps are red, and the board types them in this order
  const BRAND = ['KeyE', 'KeyA', 'KeyS', 'KeyY', 'KeyT', 'KeyH', 'KeyO', 'KeyN'];

  // a 3 x 5 pixel figure for each digit, rows top to bottom
  const FIGURES = [
    '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
    '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
  ];
  // is the pixel at column c (0..6), row r (0..4) of a two-digit display lit for this number
  function pixelOn(value, c, r) {
    if (c === 3) return false;
    const n = Math.max(0, Math.min(99, Math.floor(value)));
    const digit = c < 3 ? Math.floor(n / 10) : n % 10;
    return FIGURES[digit][r * 3 + (c < 3 ? c : c - 4)] === '1';
  }

  const capY = (h = CAP_H) => SEAT + h / 2;

  // the legend square sits in the middle of a 1u cap, and at the left end of a wider one
  function legendAt(width, size) {
    if (width <= 1.01) return [0, 0];
    return [-(width - GAP) / 2 + CAP_PROFILE[0] + 0.03 + size / 2, 0];
  }

  function cap(fields) {
    return {
      x: 0, y: capY(), z: 0, yaw: 0, w: 1 - GAP, h: CAP_H, d: 1 - GAP, scale: 1,
      profile: CAP_PROFILE, color: COLORS.cap, legend: null, role: 'key', ...fields,
    };
  }

  // ----- The cast: one board -----
  function boardKeys() {
    const keys = [];
    ROWS.forEach((row, r) => {
      const width = row.reduce((sum, [, w]) => sum + w, 0);
      let left = -width / 2;
      row.forEach(([code, w, main, sub]) => {
        const brand = BRAND.includes(code);
        const kind = /^Key|Comma|Period/.test(code) ? (brand ? 'brand' : 'alpha') : code === 'Space' ? 'space' : 'mod';
        keys.push({ code, w, main, sub, kind, row: r, x: left + w / 2, z: r - (ROWS.length - 1) / 2 });
        left += w;
      });
    });
    return keys;
  }

  // ----- Legends: what is printed where. main.js draws every spec once into the atlas -----
  function legendSpecs(keys, page) {
    const specs = new Map();
    keys.forEach(key => {
      if (key.kind === 'space') return;
      if (key.code === 'Enter') specs.set('Enter', { word: 'enter', icon: 'enter' });
      else if (key.code === 'Backspace') specs.set('Backspace', { icon: 'back' });
      else if (key.sub) specs.set(key.code, { main: key.main, sub: key.sub });
      else specs.set(key.code, key.kind === 'mod' ? { word: key.main } : { main: key.main });
    });
    // the clock face, and the rank on each plinth
    for (let hour = 1; hour <= 12; hour++) specs.set(`clock:${hour}`, { figure: String(hour) });
    page.columns.forEach(column => specs.set(`rank:${column.row + 1}`, { figure: String(column.row + 1), big: true }));
    return specs;
  }

  // ----- Formations -----
  function keyboard(keys) {
    const slots = keys.map(key => {
      const size = 0.66;
      return cap({
        x: key.x, z: key.z, w: key.w - GAP,
        color: key.kind === 'brand' ? COLORS.red : key.kind === 'mod' ? COLORS.mod : COLORS.cap,
        legend: key.kind === 'space' ? null : { id: key.code, at: legendAt(key.w, size), size },
        role: 'key',
      });
    });
    const width = Math.max(...keys.map(key => Math.abs(key.x) + key.w / 2)) * 2;
    return { slots, plate: { w: width + MARGIN * 2, d: ROWS.length + MARGIN * 2 }, view: [0.9, -0.3] };
  }

  // the days left to the start, as lit keys on a 7 x 5 matrix
  function countdown() {
    const targets = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 7; c++) targets.push(cap({ x: c - 3, z: r - 2, role: 'pixel', col: c, row: r }));
    }
    return { targets, plate: { w: 7 + MARGIN * 2, d: 5 + MARGIN * 2 }, view: [0.86, -0.5] };
  }

  // The day on a clock face. A ring of keys, one per half hour of the dial (the hours larger, with their numerals),
  // coloured as the day goes by; two flat keys for hands that point at the time of the session in focus, and a red
  // pin. The day is shorter than the dial, so every key stands for one half hour of it, or for none.
  function clock(page) {
    const R = 3.55;
    const first = page.sessions.length ? Math.floor(page.sessions[0].start / 60) * 60 : 9 * 60;
    const targets = [];
    for (let j = 0; j < 24; j++) {
      const angle = (j / 24) * Math.PI * 2;   // from twelve, clockwise
      const hour = j % 2 === 0;
      // the minute of the day this key stands for (the dial shows twelve hours, the day starts at its first hour)
      let minute = j * 30;
      while (minute < first) minute += 720;
      while (minute >= first + 720) minute -= 720;
      const session = page.sessions.findIndex(s => minute >= s.start && minute < s.start + s.span);
      const h = hour ? CAP_H : 0.3;
      targets.push(cap({
        x: R * Math.sin(angle), z: -R * Math.cos(angle), y: capY(h), yaw: -angle,
        w: hour ? 0.86 : 0.48, d: hour ? 0.96 : 0.48, h, profile: hour ? CAP_PROFILE : [0.06, 0.015],
        // the numerals stay upright however the key is turned
        legend: hour ? { id: `clock:${j / 2 || 12}`, at: [0, 0], size: 0.62, turn: angle } : null,
        role: 'tick', session, minute,
      }));
    }
    // hands: a length, how far it reaches back past the pin, its width and its height above the plate
    const hand = (which, length, back, width, y) => cap({
      x: 0, z: -(length / 2 - back), y, w: length, d: width, h: 0.16, profile: FLAT_PROFILE, color: COLORS.mod,
      role: 'hand', hand: which, back,
    });
    targets.push(hand('hour', 2.3, 0.35, 0.36, 0.16), hand('minute', 3.15, 0.45, 0.26, 0.36));
    targets.push(cap({ y: 0.63, w: 0.62, d: 0.62, h: 0.3, profile: [0.08, 0.02], color: COLORS.red, role: 'pin' }));
    const side = R * 2 + 0.96 + MARGIN * 2;
    return { targets, plate: { w: side, d: side }, view: [0.98, -0.3] };
  }

  // One plinth per winning team, built of a layer per layerValue (만원) and crowned with a key that shows its rank,
  // in the colour of its row on the page. The plinths are white; the colour is on the crowns.
  function podium(page) {
    const targets = [];
    const pitch = 1.62;
    const side = 1.3;
    const layer = 0.3;
    const seam = 0.03;
    page.columns.forEach((column, c) => {
      const x = (c - (page.columns.length - 1) / 2) * pitch;
      const count = Math.max(1, Math.round(column.amount / page.layerValue));
      for (let level = 0; level < count; level++) {
        targets.push(cap({
          x, y: layer / 2 + level * (layer + seam), w: side, d: side, h: layer, profile: FLAT_PROFILE,
          role: 'slab', index: c, prize: column.row, level,
        }));
      }
      targets.push(cap({
        x, y: count * (layer + seam) - seam + capY(), color: column.tone,
        legend: { id: `rank:${column.row + 1}`, at: [0, 0], size: 0.66 },
        role: 'crown', index: c, prize: column.row, level: count,
      }));
    });
    const span = (page.columns.length - 1) * pitch + side;
    return { targets, plate: { w: span + MARGIN * 2, d: side + MARGIN * 2 }, view: [0.42, -0.5] };
  }

  // a single key, the size of a hand: the way in
  function enter() {
    const scale = 2.3;
    const w = 1.5 - GAP;
    const d = 1.2 - GAP;
    const target = cap({
      y: capY() * scale, w, d, scale, color: COLORS.red,
      legend: { id: 'Enter', at: [0, 0], size: 0.92 }, role: 'enter',
    });
    // a one-key pad, its border a little wider than the board's
    const border = MARGIN * 2.2;
    return { target, plate: { w: w * scale + border, d: d * scale + border }, view: [0.8, -0.62] };
  }

  // Hands out the targets to the keys: each target takes the free key nearest to it (where the keys stood in the
  // formation before), so that the keys travel as little as they can. Keys left over drop out of sight.
  function assign(keys, from, targets, skip = new Set()) {
    const pairs = [];
    targets.forEach((target, t) => {
      from.forEach((slot, k) => {
        if (skip.has(k)) return;
        pairs.push([Math.hypot(slot.x - target.x, slot.z - target.z) + Math.abs(slot.w - target.w) * 0.6, t, k]);
      });
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const slots = keys.map(() => null);
    const taken = new Set();
    pairs.forEach(([, t, k]) => {
      if (taken.has(t) || slots[k]) return;
      slots[k] = targets[t];
      taken.add(t);
    });
    return slots.map(slot => slot || { hidden: true });
  }

  // where a key stood last: in this formation, or the one before if it was out of sight there
  const standing = (slots, before) => slots.map((slot, k) => (slot.hidden ? before[k] : slot));

  function buildFormations(page) {
    const keys = boardKeys();
    const board = keyboard(keys);

    // the widest keys sit out the matrix: a space bar makes a poor pixel
    const matrix = countdown();
    const widest = keys.map((key, k) => [key.w, k]).sort((a, b) => b[0] - a[0]);
    const benched = new Set(widest.slice(0, Math.max(0, keys.length - matrix.targets.length)).map(([, k]) => k));
    const matrixSlots = assign(keys, board.slots, matrix.targets, benched);

    const chart = clock(page);
    const chartSlots = assign(keys, standing(matrixSlots, board.slots), chart.targets);

    const stacks = podium(page);
    const stackSlots = assign(keys, standing(chartSlots, standing(matrixSlots, board.slots)), stacks.targets);

    const pad = enter();
    const padSlots = keys.map(key => (key.code === 'Enter' ? pad.target : { hidden: true }));

    return {
      keys,
      formations: {
        keyboard: { slots: board.slots, plate: board.plate, view: board.view },
        countdown: { slots: matrixSlots, plate: matrix.plate, view: matrix.view },
        day: { slots: chartSlots, plate: chart.plate, view: chart.view },
        prizes: { slots: stackSlots, plate: stacks.plate, view: stacks.view },
        enter: { slots: padSlots, plate: pad.plate, view: pad.view },
      },
    };
  }

  parts.layouts = {
    GAP,
    SEAT,
    CAP_H,
    PLATE_H,
    MARGIN,
    CAP_PROFILE,
    FLAT_PROFILE,
    COLORS,
    BRAND,
    pixelOn,
    boardKeys,
    legendSpecs,
    buildFormations,
  };
})(window.EasyThonStage = window.EasyThonStage || {});
