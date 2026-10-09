// EasyThon 2026: the 3D stage.
// Seven bars re-form for every scene of the story: the E mark, a dial of the day's schedule,
// the prize podium and a laptop. The dial and the podium are built from the lists on the page,
// so editing the HTML reshapes them. The canvas is fixed to the viewport and the model is fitted to
// the frame each scene names (data-frame): centre stage in the intro, beside the story after it, and
// it travels between them as it changes shape. On wide screens it can be turned by hand; on small
// ones both frames are one band at the top and the model is the page's backdrop.
// three.js is lazy-loaded from the CDN; without WebGL the flat mark in the stage stays.
//
// Events on document (the other end is in effects.js):
//   stage:focus  { group, index }   a list row is in focus        (effects.js -> here)
//   stage:hover  { group, index }   a bar is under the pointer    (here -> effects.js)
(() => {
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.185.0/build/three.module.min.js';

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('scene');
  if (!stage || !canvas) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wide = window.matchMedia('(min-width: 1024px)');

  const FOV = 28;
  const CAM_Z = 11;
  const TAU = Math.PI * 2;
  const QUARTER = Math.PI / 2;
  const RING = 1.5;      // radius of the schedule dial
  const SPREAD = 0.45;   // how far apart in time the bars set off when the shape changes

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (cur, goal, rate, dt) => lerp(cur, goal, 1 - Math.exp(-rate * dt));
  const inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function start(THREE) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (err) {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;
    const maxPixels = 3.5e6;
    let quality = 1;   // lowered by watchFrameRate when frames run slow
    let dpr = 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    camera.position.z = CAM_Z;
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z;

    // a high-key studio for a paper page: a key from the upper left, and the sky and floor in the colour of the page
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-3, 5, 6);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d4c8, 0.6));

    // ----- Reflections: a soft studio of light panels, baked once -----
    function buildEnvironment() {
      const studio = new THREE.Scene();
      studio.background = new THREE.Color(0xd6d3cb);
      const panel = (w, h, hex, power, x, y, z) => {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide }),
        );
        mesh.position.set(x, y, z);
        mesh.lookAt(0, 0, 0);
        studio.add(mesh);
      };
      panel(16, 16, 0xffffff, 1.8, 0, 9, 2);
      panel(8, 10, 0xffffff, 2.4, -7, 3, 6);
      panel(6, 10, 0xffffff, 1.1, 8, 1, -2);
      panel(8, 10, 0x6b675f, 1.0, -8, -1, -5);
      panel(12, 6, 0xf2efe8, 0.9, 0, -3, 9);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const old = scene.environment;
      // three's own blur shader trips a harmless HLSL precision warning on Windows; keep the console clean
      renderer.debug.checkShaderErrors = false;
      scene.environment = pmrem.fromScene(studio, 0.04).texture;
      renderer.debug.checkShaderErrors = true;
      if (old) old.dispose();
      pmrem.dispose();
      studio.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        o.material.dispose();
      });
    }
    buildEnvironment();

    // ----- What the page says: the bars are built from the same lists the visitor reads -----
    const startsAt = [...document.querySelectorAll('#timeline [data-time]')].map(el => {
      const [hours, minutes] = el.dataset.time.split(':').map(Number);
      return hours * 60 + minutes;
    });
    // minutes each session runs: until the next one starts, and a nominal half hour for the last
    const spans = startsAt.length ? startsAt.map((at, i) => Math.max(15, (startsAt[i + 1] ?? at + 30) - at)) : [60];
    const prizeRows = [...document.querySelectorAll('#prize-list [data-amount]')];
    const prizes = prizeRows.flatMap((el, row) => Array.from(
      { length: Number(el.dataset.teams) || 1 },
      () => ({ amount: Number(el.dataset.amount) || 0, row }),
    ));
    // podium order: the runner-up stands to the left of the winner, everyone else to the right
    const columns = prizes.length > 1 ? [prizes[1], prizes[0], ...prizes.slice(2)] : prizes;
    const COUNT = Math.max(7, spans.length, columns.length + 1);

    // ----- One rounded bar, drawn COUNT times -----
    // The vertex shader builds each bar from its own length / height / width / corner radius and
    // can bend it into an arc, so a bar can become a capsule, a slab, a column or a dial segment.
    function barGeometry() {
      const along = 44;
      const across = 10;
      const geo = new THREE.BoxGeometry(2, 2, 2, along, across, across);
      const position = geo.attributes.position;
      const normal = geo.attributes.normal;
      const core = new Float32Array(position.count * 3);
      // splits a grid coordinate into where it sits in the straight core (-1..1) and how far round the corner it is
      const split = (value, steps, band) => {
        const i = Math.round(((value + 1) / 2) * steps);
        if (i < band) return [-1, -Math.tan(((band - i) / band) * (Math.PI / 4))];
        if (i > steps - band) return [1, Math.tan(((i - steps + band) / band) * (Math.PI / 4))];
        return [-1 + (2 * (i - band)) / (steps - 2 * band), 0];
      };
      for (let v = 0; v < position.count; v++) {
        const [cx, dx] = split(position.getX(v), along, 4);
        const [cy, dy] = split(position.getY(v), across, 4);
        const [cz, dz] = split(position.getZ(v), across, 4);
        const length = Math.hypot(dx, dy, dz);
        core.set([cx, cy, cz], v * 3);
        normal.setXYZ(v, dx / length, dy / length, dz / length);
      }
      geo.setAttribute('aCore', new THREE.BufferAttribute(core, 3));
      geo.deleteAttribute('uv');
      return geo;
    }

    const geometry = barGeometry();
    const instanced = size => {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * size), size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      return attribute;
    };
    const shapeAttr = instanced(4);
    const bendAttr = instanced(1);
    const fromAttr = instanced(3);
    const toAttr = instanced(3);
    const fxAttr = instanced(2);
    geometry.setAttribute('aShape', shapeAttr);
    geometry.setAttribute('aBend', bendAttr);
    geometry.setAttribute('aFrom', fromAttr);
    geometry.setAttribute('aTo', toAttr);
    geometry.setAttribute('aFx', fxAttr);

    const material = new THREE.MeshPhysicalMaterial({
      roughness: 0.46,
      clearcoat: 0.35,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.85,
    });
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 aCore;
          attribute vec4 aShape;   // length, height, width, corner radius
          attribute float aBend;   // curvature: 1 / radius of the arc the bar follows
          attribute vec3 aFrom;    // colour at one end of the bar
          attribute vec3 aTo;      // and at the other
          attribute vec2 aFx;      // glow, metal
          varying vec3 vTint;
          varying vec2 vFx;`)
        .replace('#include <beginnormal_vertex>', `
          vec3 barCore = max(aShape.xyz * 0.5 - aShape.w, 0.0);
          vec3 barAt = aCore * barCore + normal * aShape.w;
          vec3 objectNormal = normal;
          if (abs(aBend) > 0.0001) {
            float barReach = 1.0 / aBend + barAt.z;
            float barSin = sin(barAt.x * aBend);
            float barCos = cos(barAt.x * aBend);
            barAt = vec3(barReach * barSin, barAt.y, barReach * barCos - 1.0 / aBend);
            objectNormal = vec3(normal.x * barCos + normal.z * barSin, normal.y, normal.z * barCos - normal.x * barSin);
          }
          vTint = mix(aFrom, aTo, aCore.x * 0.5 + 0.5);
          vFx = aFx;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = barAt;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vTint;
          varying vec2 vFx;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= vTint;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.22, vFx.y);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 1.0, vFx.y);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vTint * (0.02 + vFx.x);`);
    };
    const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    const model = new THREE.Group();
    model.add(mesh);
    scene.add(model);

    // ----- Shapes -----
    const makeBars = () => Array.from({ length: COUNT }, () => ({
      at: new THREE.Vector3(),
      turn: new THREE.Quaternion(),
      size: new THREE.Vector3(1, 1, 1),   // length, height, width
      round: 0.05,
      bend: 0,
      from: new THREE.Color(),
      to: new THREE.Color(),
      glow: 0,
      metal: 0,
    }));

    const color = hex => new THREE.Color(hex);
    const RED = color(0xe8402f);
    const DEEP_RED = color(0xa52617);
    const INK = color(0x2a1714);
    const METALS = [
      [color(0xc9961f), color(0xf3d27a)],
      [color(0x9aa2ad), color(0xe9ecf0)],
      [color(0xa45f2a), color(0xe2a46c)],
    ];
    const SLAB = [color(0x161616), color(0x262626)];
    const BODY = [color(0xb3291a), color(0xe8402f)];
    const DECK = color(0x1c1c1c);
    const SCREEN = color(0x121212);
    const LINES = [color(0xe8402f), color(0xf3efe8), color(0xa52617), color(0x6b6a66)];
    // dial segments: sessions still to come are porcelain, those before the leading one are ink, the leading one red
    const AHEAD = [color(0xd8d5ce), color(0xf4f2ed)];
    const DONE = [color(0x161616), color(0x2b2b2b)];
    const LIT = color(0xff6a54);
    // the object gradient, signal red through deep red to a red-black
    const ramp = (u, out) => (u < 0.5
      ? out.lerpColors(RED, DEEP_RED, clamp(u * 2, 0, 1))
      : out.lerpColors(DEEP_RED, INK, clamp(u * 2 - 1, 0, 1) * 0.6));

    const euler = new THREE.Euler();
    const reach = new THREE.Vector3();
    const tintA = new THREE.Color();
    const tintB = new THREE.Color();
    let form;   // the set of bars a shape is being written into

    // lays bar i down: centre, rotation, [length, height, width], roundness 0..1 of a full capsule
    function put(i, { at, turn, frame, size, round = 0.05, bend = 0, glow = 0, metal = 0, from, to = from }) {
      const bar = form[i];
      bar.at.set(at[0], at[1], at[2]);
      if (frame) bar.turn.copy(frame);
      else if (turn) bar.turn.setFromEuler(euler.set(turn[0], turn[1], turn[2]));
      else bar.turn.identity();
      bar.size.set(size[0], size[1], size[2]);
      bar.round = (round * Math.min(size[0], size[1], size[2])) / 2;
      bar.bend = bend;
      bar.glow = glow;
      bar.metal = metal;
      if (from) {
        bar.from.copy(from);
        bar.to.copy(to);
      }
    }
    // spare bars shrink into a host, so nothing pops in or out between shapes
    function tuck(i, host, slide = 0) {
      const bar = form[i];
      const into = form[host];
      bar.turn.copy(into.turn);
      bar.at.set(slide, 0, 0).applyQuaternion(into.turn).add(into.at);
      bar.size.set(Math.min(into.size.x, into.size.y) * 0.5, into.size.y * 0.5, into.size.z * 0.5);
      bar.round = Math.min(bar.size.x, bar.size.y, bar.size.z) * 0.025;
      bar.bend = into.bend;
      bar.glow = 0;
      bar.metal = into.metal;
      bar.from.copy(into.from);
      bar.to.copy(into.to);
    }
    // colours a bar from the brand gradient, by where its two ends are
    function paint(i) {
      const bar = form[i];
      reach.set(bar.size.x / 2, 0, 0).applyQuaternion(bar.turn);
      ramp(0.5 + (bar.at.x - reach.x - bar.at.y + reach.y) * 0.17, bar.from);
      ramp(0.5 + (bar.at.x + reach.x - bar.at.y - reach.y) * 0.17, bar.to);
    }

    // per-frame inputs to the shapes
    const heat = { clock: spans.map(() => 0), podium: prizeRows.map(() => 0) };   // 0..1 highlight per row
    let time = 0;
    let step = 0;   // schedule row the dial has turned to (fractional while it turns)

    const basis = new THREE.Matrix4();
    const axisX = new THREE.Vector3();
    const axisY = new THREE.Vector3(0, 0, -1);
    const axisZ = new THREE.Vector3();
    const spin = new THREE.Quaternion();
    const minutes = spans.reduce((sum, span) => sum + span, 0);
    const lidTilt = -0.24;

    const SHAPES = {
      // the letter E: a spine and three arms
      logo() {
        put(0, { at: [-0.92, 0, 0], turn: [0, 0, QUARTER], size: [2.9, 0.56, 0.56] });
        put(1, { at: [0.365, 1.17, 0], size: [1.67, 0.56, 0.56] });
        put(2, { at: [0.155, 0, 0], size: [1.25, 0.56, 0.56] });
        put(3, { at: [0.365, -1.17, 0], size: [1.67, 0.56, 0.56] });
        for (let i = 0; i < 4; i++) paint(i);
        for (let i = 4; i < COUNT; i++) tuck(i, 0, (i - 5) * 0.7);
      },

      // the day as a dial: one segment per session, as long as the session runs
      clock() {
        const gap = 0.11;
        const perMinute = (TAU - gap * spans.length) / minutes;
        let angle = 0;
        const mids = spans.map(span => {
          const mid = angle + (span * perMinute) / 2;
          angle += span * perMinute + gap;
          return mid;
        });
        // the dial turns so the leading segment sits at the bottom, nearest the viewer
        const lead = clamp(step, 0, spans.length - 1);
        const low = Math.floor(lead);
        const turned = Math.PI - lerp(mids[low], mids[Math.min(low + 1, spans.length - 1)], lead - low);
        spans.forEach((span, i) => {
          const hot = heat.clock[i];
          const phi = mids[i] + turned;
          const out = RING + 0.16 * hot;
          const done = clamp(lead - i, 0, 1);
          basis.makeBasis(axisX.set(Math.cos(phi), -Math.sin(phi), 0), axisY, axisZ.set(Math.sin(phi), Math.cos(phi), 0));
          put(i, {
            at: [out * Math.sin(phi), out * Math.cos(phi), 0.24 * hot],
            frame: spin.setFromRotationMatrix(basis),
            size: [span * perMinute * RING, 0.44, 0.46],
            round: 0.05,
            bend: 1 / RING,
            glow: 0.5 * hot,
            // only the leading session is lit, so it reads at a glance
            from: tintA.lerpColors(AHEAD[0], DONE[0], done).lerp(RED, hot),
            to: tintB.lerpColors(AHEAD[1], DONE[1], done).lerp(LIT, hot),
          });
        });
        for (let i = spans.length; i < COUNT; i++) tuck(i, 0);
      },

      // one column per winning team, as tall as its prize
      podium() {
        const top = Math.max(1, ...columns.map(column => column.amount));
        columns.forEach((column, i) => {
          const hot = heat.podium[column.row];
          const tall = Math.max(0.5, (2.5 * column.amount) / top);
          const metal = METALS[Math.min(column.row, METALS.length - 1)];
          put(i, {
            at: [(i - (columns.length - 1) / 2) * 0.8, -1.28 + tall / 2 + 0.14 * hot, 0],
            turn: [0, 0, QUARTER],
            size: [tall, 0.66, 0.66],
            metal: 0.55,
            glow: 0.04 + 0.3 * hot,
            from: metal[0],
            to: metal[1],
          });
        });
        const base = columns.length;
        put(base, { at: [0, -1.4, 0], size: [columns.length * 0.8 + 0.5, 0.18, 1.2], from: SLAB[0], to: SLAB[1] });
        for (let i = base + 1; i < COUNT; i++) tuck(i, base, (i - base - 1.5) * 0.6);
      },

      // base, keyboard, lid, and four lines of code typing themselves
      laptop() {
        put(0, { at: [0, -0.78, 0.3], size: [2.7, 0.14, 1.8], from: BODY[0], to: BODY[1] });
        put(1, { at: [0, -0.7, 0.16], size: [2.3, 0.04, 0.9], from: DECK });
        const hinge = [0, -0.71, -0.6];
        const lidY = Math.cos(lidTilt);
        const lidZ = Math.sin(lidTilt);
        put(2, { at: [0, hinge[1] + 0.85 * lidY, hinge[2] + 0.85 * lidZ], turn: [lidTilt, 0, 0], size: [2.7, 1.7, 0.1], from: SCREEN });
        const typed = (time * 0.9) % 7;
        [1.2, 1.7, 1.0, 1.45].forEach((full, line) => {
          const length = full * clamp(typed - line * 0.8, 0.1, 1);
          const x = -1.05 + (line === 1 || line === 2 ? 0.28 : 0) + length / 2;
          const y = 0.85 + 0.42 - line * 0.28;   // up the lid from the hinge
          put(3 + line, {
            at: [x, hinge[1] + y * lidY - 0.08 * lidZ, hinge[2] + y * lidZ + 0.08 * lidY],
            turn: [lidTilt, 0, 0],
            size: [length, 0.13, 0.06],
            glow: 0.5,
            from: LINES[line],
          });
        });
        for (let i = 7; i < COUNT; i++) tuck(i, 0);
      },
    };

    // how each shape is turned toward the viewer: pitch, yaw, roll
    const view = name => {
      if (name === 'clock') return [-0.62, -0.18, 0];
      if (name === 'podium') return [0.2, -0.52, 0];
      if (name === 'laptop') return [0.42, -0.6, 0];
      return [0.1, -0.5, 0];
    };
    const shape = (bars, name) => {
      form = bars;
      (SHAPES[name] || SHAPES.logo)();
    };

    // ----- Layout: every scene of the story holds one shape -----
    const sceneEls = [...document.querySelectorAll('.scene[data-scene]')];
    const windowEls = [...document.querySelectorAll('[data-window]')];
    const frameEls = [...stage.querySelectorAll('[data-frame]')];
    const footer = document.getElementById('footer');
    let keys = [];
    let windows = [];   // small screens: [top, bottom] of each clear view of the stage, in page pixels
    let vh = window.innerHeight;
    let narrow = !wide.matches;
    let width = 1;
    let height = 1;
    // per frame: the model scale that fits it, where its centre is in world units from the stage's,
    // and its top and height in stage pixels
    const placements = {};
    const frameOf = name => placements[name] || placements.side || { fit: 1, x: 0, y: 0, top: 0, height: 1 };
    let sized = '';

    function measure() {
      vh = window.innerHeight;
      narrow = !wide.matches;
      const end = Math.max(0, document.documentElement.scrollHeight - vh);
      keys = sceneEls.map(el => {
        const box = el.getBoundingClientRect();
        const top = box.top + window.scrollY;
        // the scroll range over which this scene holds its shape: beside the story, while the scene fills the
        // screen; behind it, while the scene is being read, so the shape changes as the next heading crosses
        // the middle of the screen (where effects.js moves the nav on to it)
        let a = narrow ? top - vh * 0.35 : top;
        let b = top + box.height - vh * (narrow ? 0.75 : 1);
        if (b < a) a = b = (a + b) / 2;
        return { a, b, shape: el.dataset.scene, frame: el.dataset.frame || 'side' };
      });
      windows = narrow
        ? windowEls.map(el => {
          const box = el.getBoundingClientRect();
          return [box.top + window.scrollY, box.bottom + window.scrollY];
        })
        : [];
      if (!keys.length) return;
      keys[0].a = Math.min(keys[0].a, 0);
      keys[0].b = Math.max(keys[0].b, 0);
      const last = keys[keys.length - 1];
      last.a = Math.min(last.a, end);
      last.b = Math.max(last.b, end);
    }

    function resize() {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      narrow = !wide.matches;
      dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(maxPixels / (w * h))) * quality);
      const next = `${w}x${h}@${dpr}`;
      if (next !== sized) {
        sized = next;
        width = w;
        height = h;
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      // the model is fitted to each frame and centred on it; what a frame holds is centred on it by CSS
      const room = stage.getBoundingClientRect();
      const unit = viewH / h;   // world units per pixel where the model stands
      frameEls.forEach(el => {
        const box = el.getBoundingClientRect();
        const fw = box.width || w;
        const fh = box.height || h;
        placements[el.dataset.frame] = {
          fit: ((narrow ? 0.9 : 0.82) * Math.min(fw, fh) * unit) / 3.9,
          x: (box.left - room.left + fw / 2 - w / 2) * unit,
          y: (h / 2 - (box.top - room.top) - fh / 2) * unit,
          top: box.top - room.top,
          height: fh,
        };
      });
      // the labels on the dial and the podium are sized to the frame beside the story
      stage.style.setProperty('--u', `${(frameOf('side').fit / unit).toFixed(1)}px`);
      measure();
    }

    // ----- State -----
    const shapeA = makeBars();
    const shapeB = makeBars();
    const bars = makeBars();
    const weight = { logo: 0, clock: 0, podium: 0, laptop: 0 };
    let scrollY = window.scrollY;
    let stepGoal = Number(stage.dataset.step) || 0;   // schedule row in focus on the page
    let hotRow = null;                                // prize row in focus on the page
    let hover = { group: null, index: null };         // bar under the pointer
    let dragging = false;
    let yaw = 0;      // how far the visitor has dragged the model round
    let pitch = 0;
    let yawSpeed = 0;
    let pitchSpeed = 0;
    let lookX = 0;    // the model leans a little toward the pointer
    let lookY = 0;
    let lookGoalX = 0;
    let lookGoalY = 0;
    let dirty = true;
    let movedAt = 0;   // last scroll, resize or pointer move
    let assembled = reduceMotion ? 1 : 0;   // 0..1: the bars fly together into the first shape
    let liveAt = 0;                          // when the stage first went live
    let covered = false;                     // the footer is over the whole stage
    const checkCovered = () => { covered = !!footer && footer.getBoundingClientRect().top <= 0; };

    document.addEventListener('stage:focus', e => {
      const { group, index } = e.detail;
      if (group === 'clock' && index !== null) stepGoal = index;
      if (group === 'podium') hotRow = index;
      dirty = true;
      movedAt = performance.now();
    });
    const emit = (group, index) => {
      document.dispatchEvent(new CustomEvent('stage:hover', { detail: { group, index } }));
    };
    function setHover(group, index) {
      if (hover.group === group && hover.index === index) return;
      if (hover.group && hover.group !== group) emit(hover.group, null);
      hover = { group, index };
      if (group) emit(group, index);
      dirty = true;
    }

    // ----- Picking: which bar is under the pointer -----
    // The GPU reshapes the bars, so the hit test repeats that maths instead of using a raycast.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const inverse = new THREE.Matrix4();
    const turnBack = new THREE.Quaternion();
    const origin = new THREE.Vector3();
    const heading = new THREE.Vector3();
    function hitBox(o, d, hx, hy, hz) {
      let near = -Infinity;
      let far = Infinity;
      for (const [start, slope, half] of [[o.x, d.x, hx], [o.y, d.y, hy], [o.z, d.z, hz]]) {
        if (Math.abs(slope) < 1e-6) {
          if (Math.abs(start) > half) return null;
          continue;
        }
        const t1 = (-half - start) / slope;
        const t2 = (half - start) / slope;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
        if (near > far) return null;
      }
      return far < 0 ? null : near;
    }
    function hitArc(o, d, bar) {
      if (Math.abs(d.y) < 1e-6) return null;
      const t = -o.y / d.y;
      if (t < 0) return null;
      const radius = 1 / bar.bend;
      const x = o.x + d.x * t;
      const z = o.z + d.z * t + radius;
      if (Math.abs(Math.hypot(x, z) - radius) > bar.size.z / 2) return null;
      if (Math.abs(Math.atan2(x, z)) > (bar.size.x * bar.bend) / 2) return null;
      return t;
    }
    function barAt(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      ndc.set(((clientX - box.left) / box.width) * 2 - 1, 1 - ((clientY - box.top) / box.height) * 2);
      raycaster.setFromCamera(ndc, camera);
      const ray = raycaster.ray.applyMatrix4(inverse.copy(model.matrixWorld).invert());
      let found = -1;
      let nearest = Infinity;
      bars.forEach((bar, i) => {
        turnBack.copy(bar.turn).invert();
        origin.copy(ray.origin).sub(bar.at).applyQuaternion(turnBack);
        heading.copy(ray.direction).applyQuaternion(turnBack);
        const t = Math.abs(bar.bend) > 0.001
          ? hitArc(origin, heading, bar)
          : hitBox(origin, heading, bar.size.x / 2, bar.size.y / 2, bar.size.z / 2);
        if (t !== null && t < nearest) {
          nearest = t;
          found = i;
        }
      });
      return found;
    }

    // ----- Labels riding on the podium columns -----
    const tags = columns.map(column => {
      const tag = document.createElement('span');
      tag.className = 'stage-tag';
      tag.setAttribute('aria-hidden', 'true');
      tag.innerHTML = `${column.amount}<small>만원</small>`;
      stage.appendChild(tag);
      return tag;
    });
    const point = new THREE.Vector3();
    const shown = {};
    const setVar = (name, value) => {
      const text = value.toFixed(2);
      if (shown[name] === text) return;
      shown[name] = text;
      stage.style.setProperty(name, text);
    };

    // small screens: the model shows in full while nothing covers the middle of the frame, dims to a backdrop
    // while the story runs over it, and comes up part way while it changes shape (blend 0..1)
    function veil(blend) {
      const frame = frameOf('center');
      const top = window.scrollY + frame.top + frame.height * 0.2;
      const span = frame.height * 0.6;
      let open = 0;
      windows.forEach(([a, b]) => { open = Math.max(open, (Math.min(b, top + span) - Math.max(a, top)) / span); });
      const t = clamp(open, 0, 1);
      return Math.max(lerp(0.26, 1, t * t * (3 - 2 * t)), lerp(0.26, 0.42, Math.sin(Math.PI * blend)));
    }

    // ----- Animation -----
    const viewA = new THREE.Quaternion();
    const viewB = new THREE.Quaternion();
    const turnY = new THREE.Quaternion();
    const turnX = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    const RIGHT = new THREE.Vector3(1, 0, 0);
    const matrix = new THREE.Matrix4();
    const ONE = new THREE.Vector3(1, 1, 1);
    const placed = new THREE.Vector3();
    const outQuart = t => 1 - Math.pow(1 - t, 4);

    function update(dt) {
      if (!reduceMotion) time += dt;
      // by the clock, not the frame count, so a slow device assembles as quickly (if less smoothly)
      if (assembled < 1) assembled = clamp((performance.now() - liveAt) / 1800, 0, 1);

      // where the scroll is between two scenes (Lenis already eases the scroll itself)
      scrollY = reduceMotion ? window.scrollY : damp(scrollY, window.scrollY, window.lenis ? 24 : 10, dt);
      let i = 0;
      while (i < keys.length - 1 && scrollY >= keys[i + 1].a) i++;
      const a = keys[i];
      const b = keys[Math.min(i + 1, keys.length - 1)];
      const travel = a && b !== a && scrollY > a.b ? clamp((scrollY - a.b) / Math.max(1, b.a - a.b), 0, 1) : 0;
      // the shape holds near each scene and changes over the middle of the way; reduced motion swaps at the halfway mark
      const blend = reduceMotion ? Math.round(travel) : clamp((travel - 0.12) / 0.76, 0, 1);

      // highlights ease in and out
      step = reduceMotion ? stepGoal : damp(step, stepGoal, 6, dt);
      const litStep = hover.group === 'clock' ? hover.index : Math.round(stepGoal);
      const litRow = hover.group === 'podium' ? hover.index : hotRow;
      heat.clock.forEach((value, k) => { heat.clock[k] = reduceMotion ? +(k === litStep) : damp(value, +(k === litStep), 10, dt); });
      heat.podium.forEach((value, k) => { heat.podium[k] = reduceMotion ? +(k === litRow) : damp(value, +(k === litRow), 10, dt); });

      // bars: each one sets off a little after the one before it
      shape(shapeA, a ? a.shape : 'logo');
      shape(shapeB, b ? b.shape : 'logo');
      bars.forEach((bar, k) => {
        const from = shapeA[k];
        const to = shapeB[k];
        const t = inOut(clamp(blend * (1 + SPREAD) - (k / (COUNT - 1)) * SPREAD, 0, 1));
        bar.at.lerpVectors(from.at, to.at, t);
        bar.turn.slerpQuaternions(from.turn, to.turn, t);
        bar.size.lerpVectors(from.size, to.size, t);
        bar.round = lerp(from.round, to.round, t);
        bar.bend = lerp(from.bend, to.bend, t);
        bar.glow = lerp(from.glow, to.glow, t);
        bar.metal = lerp(from.metal, to.metal, t);
        bar.from.lerpColors(from.from, to.from, t);
        bar.to.lerpColors(from.to, to.to, t);

        // on first show each bar grows out of its own centre, one after another, and rises into place
        const grow = assembled < 1 ? outQuart(clamp(assembled * 1.7 - (k / (COUNT - 1)) * 0.7, 0, 1)) : 1;
        placed.copy(bar.at);
        placed.y -= (1 - grow) * 0.9;
        mesh.setMatrixAt(k, matrix.compose(placed, bar.turn, ONE));
        const length = Math.max(0.001, bar.size.x * grow);
        shapeAttr.setXYZW(k, length, bar.size.y, bar.size.z, Math.min(bar.round, length / 2, bar.size.y / 2, bar.size.z / 2));
        bendAttr.setX(k, bar.bend);
        fromAttr.setXYZ(k, bar.from.r, bar.from.g, bar.from.b);
        toAttr.setXYZ(k, bar.to.r, bar.to.g, bar.to.b);
        fxAttr.setXY(k, bar.glow, bar.metal);
      });
      mesh.instanceMatrix.needsUpdate = true;
      shapeAttr.needsUpdate = bendAttr.needsUpdate = fromAttr.needsUpdate = toAttr.needsUpdate = fxAttr.needsUpdate = true;

      // the model: turned to show the shape, one full spin on the way to the next, plus drag, lean and idle sway
      if (!dragging && !reduceMotion) {
        yawSpeed += (-yaw * 30 - yawSpeed * 9) * dt;
        pitchSpeed += (-pitch * 30 - pitchSpeed * 9) * dt;
        yaw += yawSpeed * dt;
        pitch += pitchSpeed * dt;
      }
      lookX = damp(lookX, lookGoalX, 4, dt);
      lookY = damp(lookY, lookGoalY, 4, dt);
      const eased = inOut(blend);
      const sway = reduceMotion ? 0 : 1;
      // behind the story nobody turns it by hand, so it swings wider on its own
      const swing = narrow ? Math.sin(time * 0.32) * 0.3 : Math.sin(time * 0.5) * 0.1;
      const [ax, ay, az] = view(a ? a.shape : 'logo');
      const [bx, by, bz] = view(b ? b.shape : 'logo');
      viewA.setFromEuler(euler.set(ax, ay, az));
      viewB.setFromEuler(euler.set(bx, by, bz));
      model.quaternion.slerpQuaternions(viewA, viewB, eased);
      // the first show also swings the model round to face the viewer
      const entrance = (1 - outQuart(assembled)) * -1.4;
      turnY.setFromAxisAngle(UP, eased * TAU + yaw + lookX * 0.14 + sway * swing + entrance);
      turnX.setFromAxisAngle(RIGHT, pitch - lookY * 0.08 + sway * Math.sin(time * 0.37) * 0.035);
      model.quaternion.premultiply(turnY).premultiply(turnX);
      // and it travels from one frame to the other as it changes shape
      const fa = frameOf(a ? a.frame : 'center');
      const fb = frameOf(b ? b.frame : 'center');
      model.position.set(lerp(fa.x, fb.x, eased), lerp(fa.y, fb.y, eased) + sway * Math.sin(time * 0.8) * 0.05, 0);
      model.scale.setScalar(lerp(fa.fit, fb.fit, eased));
      model.updateMatrixWorld();

      // what the overlays in the stage should show, and how far the backdrop is dimmed
      setVar('--show', narrow ? veil(blend) : 1);
      for (const name in weight) weight[name] = 0;
      if (a) weight[a.shape in weight ? a.shape : 'logo'] += 1 - blend;
      if (b) weight[b.shape in weight ? b.shape : 'logo'] += blend;
      setVar('--clock', clamp((weight.clock - 0.75) / 0.25, 0, 1));
      const podium = clamp((weight.podium - 0.75) / 0.25, 0, 1);
      setVar('--podium', podium);
      if (podium > 0 && !narrow) {
        columns.forEach((column, k) => {
          const bar = bars[k];
          point.set(bar.size.x / 2 + 0.16, 0, 0).applyQuaternion(bar.turn).add(bar.at);
          model.localToWorld(point).project(camera);
          const x = ((point.x + 1) / 2) * width;
          const y = ((1 - point.y) / 2) * height;
          tags[k].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        });
      }
    }

    // drop the resolution if the device cannot keep up
    let slowRuns = 0;
    let frames = 0;
    let elapsed = 0;
    function watchFrameRate(delta) {
      if (delta > 0.25) return;   // tab was in the background
      elapsed += delta;
      if (++frames < 45) return;
      // slow means well below what the browser itself allows, so a 30 fps power-saving cap is not punished
      slowRuns = elapsed / frames > Math.max(1 / 40, pace * 1.6) ? slowRuns + 1 : 0;
      frames = 0;
      elapsed = 0;
      if (slowRuns >= 2 && dpr > 0.75) {
        quality *= 0.8;
        slowRuns = 0;
        resize();
      }
    }

    let raf = 0;
    let last = 0;
    let visible = true;
    function tick(now) {
      raf = requestAnimationFrame(tick);
      // nothing to draw into yet, out of view or under the footer, or (reduced motion) nothing has changed
      if (!sized || !visible || covered || (reduceMotion && !dirty)) {
        last = now;
        return;
      }
      const delta = (now - last) / 1000;
      // a backdrop on a page that is standing still only sways, which half the frames carry just as well
      const idle = narrow && assembled >= 1 && now - movedAt > 600;
      if (idle && delta < 1 / 34) return;
      last = now;
      dirty = false;
      update(Math.min(delta, 0.05));
      renderer.render(scene, camera);
      if (!idle) watchFrameRate(delta);
    }
    function run() {
      resize();
      checkCovered();
      if (!liveAt) liveAt = performance.now();
      scrollY = window.scrollY;
      step = stepGoal;
      stage.classList.add('is-live');
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }

    // ----- Input -----
    const refresh = () => {
      resize();
      dirty = true;
      movedAt = performance.now();
    };
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', () => {
      dirty = true;
      movedAt = performance.now();
      checkCovered();
    }, { passive: true });
    if ('ResizeObserver' in window) {
      // the stage changes size with the layout; the page changes height with its fonts
      new ResizeObserver(refresh).observe(stage);
      new ResizeObserver(() => { measure(); dirty = true; }).observe(document.body);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        dirty = true;
      }).observe(stage);
    }

    let lastX = 0;
    let lastY = 0;
    stage.addEventListener('pointerdown', e => {
      if (e.button) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      yawSpeed = pitchSpeed = 0;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('is-touched');
    });
    stage.addEventListener('pointermove', e => {
      dirty = true;
      movedAt = performance.now();
      if (dragging) {
        yaw += (e.clientX - lastX) * 0.008;
        pitch = clamp(pitch + (e.clientY - lastY) * 0.006, -0.9, 0.9);
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (e.pointerType === 'touch') return;
      const box = stage.getBoundingClientRect();
      lookGoalX = ((e.clientX - box.left) / box.width) * 2 - 1;
      lookGoalY = 1 - ((e.clientY - box.top) / box.height) * 2;
      const i = barAt(e.clientX, e.clientY);
      if (weight.clock > 0.85 && i >= 0 && i < spans.length) setHover('clock', i);
      else if (weight.podium > 0.85 && i >= 0 && i < columns.length) setHover('podium', columns[i].row);
      else setHover(null, null);
    });
    const release = () => {
      if (!dragging) return;
      dragging = false;
      yaw = ((((yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;   // unwind whole turns before springing back
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', () => {
      lookGoalX = lookGoalY = 0;
      setHover(null, null);
    });

    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      stage.classList.remove('is-live');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      buildEnvironment();
      run();
    });

    // compile the shaders off the main thread where the browser allows it
    renderer.compileAsync(scene, camera).then(run, run);
  }

  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return;
  const lose = probe.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();

  // The browser's own frame pace, taken from the shortest of a few idle frames before the scene draws
  let pace = 1 / 60;
  (function probePace(prev, shortest, left) {
    requestAnimationFrame(now => {
      if (prev) shortest = Math.min(shortest, (now - prev) / 1000);
      if (left) probePace(now, shortest, left - 1);
      else pace = clamp(shortest, 1 / 240, 1 / 20);
    });
  })(0, Infinity, 20);

  import(THREE_URL).then(start).catch(err => console.warn('[scene] 3D stage disabled:', err));
})();
