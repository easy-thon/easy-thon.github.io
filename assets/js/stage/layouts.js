// EasyThon 2026 · stage layouts
// Every arrangement the keys take, as plain numbers: no three.js in here.
// Units are key units (u): a letter key sits on a 1u square. The plate's top is y = 0, x runs to the right and
// z toward the viewer. One board of 39 keys is the whole cast; each formation says where every key goes
// (or that it drops out of sight into the plate), and main.js moves the keys between them as the page scrolls.

export const GAP = 0.1;                 // between neighbouring caps
export const SEAT = 0.08;               // caps ride this far above the plate, where the switches would be
export const CAP_H = 0.42;              // cap height
export const PLATE_H = 0.5;             // plate thickness
export const MARGIN = 0.42;             // plate border around what stands on it
export const CAP_PROFILE = [0.11, 0.035];   // a key cap: how far the top is drawn in (taper), and its dish
export const CHIP_PROFILE = [0.03, 0];      // a flat chip in a prize stack

export const COLORS = {
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
export const BRAND = ['KeyE', 'KeyA', 'KeyS', 'KeyY', 'KeyT', 'KeyH', 'KeyO', 'KeyN'];

// a 3 x 5 pixel figure for each digit, rows top to bottom
const FIGURES = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
];
// is the pixel at column c (0..6), row r (0..4) of a two-digit display lit for this number
export function pixelOn(value, c, r) {
  if (c === 3) return false;
  const n = Math.max(0, Math.min(99, Math.floor(value)));
  const digit = c < 3 ? Math.floor(n / 10) : n % 10;
  return FIGURES[digit][r * 3 + (c < 3 ? c : c - 4)] === '1';
}

// a small, repeatable shuffle for the hand-stacked look
const jitter = seed => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

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
export function boardKeys() {
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
export function legendSpecs(keys, page) {
  const specs = new Map();
  keys.forEach(key => {
    if (key.kind === 'space') return;
    if (key.code === 'Enter') specs.set('Enter', { word: 'enter', icon: 'enter' });
    else if (key.code === 'Backspace') specs.set('Backspace', { icon: 'back' });
    else if (key.sub) specs.set(key.code, { main: key.main, sub: key.sub });
    else specs.set(key.code, key.kind === 'mod' ? { word: key.main } : { main: key.main });
  });
  page.hours.forEach(hour => specs.set(`hour:${hour}`, { figure: String(hour) }));
  specs.set(`chip:${page.chipValue}`, { figure: String(page.chipValue), small: true });
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

// the day as two rows of a keyboard: low hour keys along the back, and in front of them one key per session,
// as wide as the session runs, so the row reads like the day itself
function day(page) {
  const first = page.hours[0];
  const span = page.hours.length;
  const x = minutes => minutes / 60 - first - span / 2;
  const low = 0.3;
  const targets = page.hours.map((hour, i) => cap({
    x: i + 0.5 - span / 2, z: -0.5, h: low, y: capY(low), profile: [0.09, 0.025],
    legend: { id: `hour:${hour}`, at: [0, 0], size: 0.64 }, role: 'hour', index: i, hour,
  }));
  page.sessions.forEach((session, i) => {
    targets.push(cap({
      x: x(session.start + session.span / 2), z: 0.5, w: Math.max(0.3, session.span / 60 - GAP),
      role: 'session', index: i, color: COLORS.stone,
    }));
  });
  return { targets, plate: { w: span + MARGIN * 2, d: 2 + MARGIN * 2 }, view: [0.95, -0.8] };
}

// one stack of chips per winning team, one chip per chipValue (만원)
function prizes(page) {
  const targets = [];
  const pitch = 1.25;
  const chipH = 0.34;
  page.columns.forEach((column, c) => {
    const count = Math.max(1, Math.round(column.amount / page.chipValue));
    for (let level = 0; level < count; level++) {
      const seed = c * 31 + level * 7;
      targets.push(cap({
        x: (c - (page.columns.length - 1) / 2) * pitch + jitter(seed) * 0.025,
        z: jitter(seed + 1) * 0.025,
        y: chipH / 2 + level * (chipH + 0.025),
        yaw: jitter(seed + 2) * 0.07,
        h: chipH, profile: CHIP_PROFILE, color: column.tone,
        legend: { id: `chip:${page.chipValue}`, at: [0, 0], size: 0.66 },
        role: 'chip', index: c, prize: column.row, level,
      }));
    }
  });
  return {
    targets,
    plate: { w: page.columns.length * pitch + MARGIN * 2 - (pitch - 1), d: 1 + MARGIN * 2 },
    view: [0.36, -0.55],
  };
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

export function buildFormations(page) {
  const keys = boardKeys();
  const board = keyboard(keys);

  // the widest keys sit out the matrix: a space bar makes a poor pixel
  const clock = countdown();
  const widest = keys.map((key, k) => [key.w, k]).sort((a, b) => b[0] - a[0]);
  const benched = new Set(widest.slice(0, Math.max(0, keys.length - clock.targets.length)).map(([, k]) => k));
  const clockSlots = assign(keys, board.slots, clock.targets, benched);

  const chart = day(page);
  const chartSlots = assign(keys, standing(clockSlots, board.slots), chart.targets);

  const stacks = prizes(page);
  const stackSlots = assign(keys, standing(chartSlots, standing(clockSlots, board.slots)), stacks.targets);

  const pad = enter();
  const padSlots = keys.map(key => (key.code === 'Enter' ? pad.target : { hidden: true }));

  return {
    keys,
    formations: {
      keyboard: { slots: board.slots, plate: board.plate, view: board.view },
      countdown: { slots: clockSlots, plate: clock.plate, view: clock.view },
      day: { slots: chartSlots, plate: chart.plate, view: chart.view },
      prizes: { slots: stackSlots, plate: stacks.plate, view: stacks.view },
      enter: { slots: padSlots, plate: pad.plate, view: pad.view },
    },
  };
}
