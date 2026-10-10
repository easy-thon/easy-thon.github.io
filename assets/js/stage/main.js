// EasyThon 2026 · the 3D stage
// One small Korean keyboard is the whole cast. In the intro it sits centre stage and types the name, and plays
// along when the visitor types (typing the name itself sets off a small party); down the page its 39 keys hop into
// place for each chapter: a sign of keys counting the days left, the day as a clock, the prizes as a bar chart, and
// at the end a single key the size of a hand that follows the apply link. The page's own lists are the data, so
// editing the HTML re-forms the 3D.
//
//   boot.js      checks for WebGL 2, then loads three.js and the files below
//   layouts.js   where every key goes in every formation (plain numbers)
//   keycap.js    the cap shape and its shaders, shared by all keys and the plate
//   legends.js   the printed legends, drawn into one atlas
//   main.js      this file: light, scroll, motion, the pointer and the keyboard
// They are plain scripts sharing window.EasyThonStage (not ES modules), so the page also works opened straight from
// disk; only three.js itself is imported, from the CDN.
//
// The canvas is fixed to the viewport. Each scene names a formation (data-scene) and a frame (data-frame, a box in
// the stage the model is fitted to). Between two scenes the keys set off for the next formation one after another,
// each on a small arc, and every key follows its path on a spring, so stopping the scroll lets them settle.
// Events on document (the other end is in effects.js):
//   stage:focus  { group, index }   a list row is in focus      (effects.js -> here)
//   stage:hover  { group, index }   a key is under the pointer  (here -> effects.js)
// group is 'day' (schedule rows) or 'prize' (prize rows); index null means none.
(parts => {
  const FOV = 28;
  const CAM_Z = 11;
  const SPREAD = 0.6;   // how far apart in time the keys set off between formations
  const PRESS = 0.13;   // key travel, u

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (cur, goal, rate, dt) => lerp(cur, goal, 1 - Math.exp(-rate * dt));
  const inOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const outQuart = t => 1 - Math.pow(1 - t, 4);
  const smooth = t => t * t * (3 - 2 * t);

  // whole calendar days in Korea from today to a time, as the D-day badges on the page count them
  const kstDay = ms => Math.floor((ms + 9 * 3600000) / 86400000);
  const daysTo = time => (Number.isFinite(time) ? kstDay(time) - kstDay(Date.now()) : 0);

  // ----- What the page says -----
  function readPage(keyCount) {
    const starts = [...document.querySelectorAll('#timeline [data-time]')].map(el => {
      const [hours, minutes] = el.dataset.time.split(':').map(Number);
      return hours * 60 + minutes;
    });
    // each session runs until the next one starts; the last gets a nominal half hour
    const sessions = starts.map((start, i) => ({ start, span: Math.max(15, (starts[i + 1] ?? start + 30) - start) }));

    const prizeRows = [...document.querySelectorAll('#prize-list [data-amount]')];
    // one award per winning team, in the order of the list (as many as there are keys besides the chart's board and
    // its four rules at most)
    const awards = prizeRows.flatMap((el, row) => Array.from({ length: Number(el.dataset.teams) || 1 }, () => ({
      amount: Number(el.dataset.amount) || 0,
      row,
      tone: getComputedStyle(el).getPropertyValue('--tone').trim() || '#dcd9d2',
    }))).slice(0, keyCount - 5).map((award, index) => ({ ...award, index }));

    const startAt = document.querySelector('[data-milestone="start"] time');
    const startTime = startAt ? new Date(startAt.dateTime).getTime() : NaN;
    return { sessions, awards, prizeRows, startTime, daysLeft: daysTo(startTime) };
  }

  parts.start = function start(THREE, { stage, canvas, pace = 1 / 60 }) {
    const { keycapGeometry, keycapMaterial, keycapDepthMaterial, ATTRIBUTES } = parts.keycap;
    const { createLegends, legendFonts } = parts.legends;
    const {
      boardKeys, buildFormations, countdownFormation, countdownText, legendSpecs, BRAND, COLORS, PLATE_H, CAP_PROFILE,
    } = parts.layouts;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wide = window.matchMedia('(min-width: 1024px)');
    let narrow = !wide.matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (err) {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // a GPU that cannot build the shaders leaves the stage empty (as without WebGL) rather than half drawn
    let broken = false;
    renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      broken = true;
      stage.classList.remove('is-live');
      console.warn('[stage] 3D stage disabled: a shader did not compile',
        gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertexShader), gl.getShaderInfoLog(fragmentShader));
    };
    const maxPixels = 3.5e6;
    let quality = 1;   // lowered by watchFrameRate when frames run slow
    let dpr = 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    camera.position.z = CAM_Z;
    camera.updateMatrixWorld();   // the labels are projected before the first frame is drawn
    const viewH =2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_Z;

    // ----- Light: a window to the upper left, the room in the page's colours, and soft studio panels to reflect -----
    const SUN = new THREE.Vector3(-0.5, 0.86, 0.62).normalize();
    const sun = new THREE.DirectionalLight(0xfff8ee, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(narrow ? 1024 : 2048);
    sun.shadow.radius = 2.5;
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d4c8, 0.62));

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
      panel(16, 16, 0xffffff, 1.7, 0, 9, 2);
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

    // ----- The cast and its formations -----
    const page = readPage(boardKeys().length);
    const { keys, formations } = buildFormations(page);
    const N = keys.length;
    const COUNT = N + 1;   // instance 0 is the plate
    const keyIndex = new Map(keys.map((key, k) => [key.code, k]));
    // the Korean keys report themselves differently from system to system
    keyIndex.set('AltRight', keyIndex.get('Lang1'));
    keyIndex.set('HangulMode', keyIndex.get('Lang1'));
    keyIndex.set('ControlRight', keyIndex.get('Lang2'));
    keyIndex.set('HanjaMode', keyIndex.get('Lang2'));

    const legends = createLegends(THREE, legendSpecs(keys, page), { size: narrow ? 1024 : 2048 });
    legendFonts().then(() => legends.redraw());
    legends.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const color = value => new THREE.Color(value);
    const RED = color(COLORS.red);
    const INK = color(COLORS.mod);
    const CAP = color(COLORS.cap);
    const STONE = color(COLORS.stone);
    const PLATE = color(COLORS.plate);

    const NAMES = Object.keys(formations);
    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    // a formation as the frames use it: colours and legend cells per key, its turn, and the room it takes on screen
    function prepare(f, name) {
      f.name = name;
      f.slots = f.slots.map(slot => {
        if (slot.hidden) return null;
        const legend = slot.legend && legends.cellOf.has(slot.legend.id) ? slot.legend : null;
        return {
          ...slot,
          pos: new THREE.Vector3(slot.x, slot.y, slot.z),
          tint: color(slot.color),
          cell: legend ? legends.cellOf.get(legend.id) : -1,
          legendX: legend ? legend.at[0] : 0,
          legendZ: legend ? legend.at[1] : 0,
          legendSize: legend ? legend.size : 1,
          legendTurn: legend && legend.turn ? legend.turn : 0,
        };
      });
      f.turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.view[0], f.view[1], 0, 'XYZ'));
      // the room the formation takes, with headroom for keys that lift
      box.set(new THREE.Vector3(-f.plate.w / 2, -PLATE_H, -f.plate.d / 2), new THREE.Vector3(f.plate.w / 2, 0.4, f.plate.d / 2));
      f.slots.forEach(slot => {
        if (!slot) return;
        const s = slot.scale;
        box.expandByPoint(corner.set(slot.x - (slot.w / 2) * s, slot.y + (slot.h / 2) * s + 0.3, slot.z - (slot.d / 2) * s));
        box.expandByPoint(corner.set(slot.x + (slot.w / 2) * s, slot.y + (slot.h / 2) * s + 0.3, slot.z + (slot.d / 2) * s));
      });
      f.box = box.clone();
      f.sphere = f.box.getBoundingSphere(new THREE.Sphere());
      // the box as the viewer sees it, straight on (the perspective is mild): its size and centre on screen, in u
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? f.box.max.x : f.box.min.x, i & 2 ? f.box.max.y : f.box.min.y, i & 4 ? f.box.max.z : f.box.min.z);
        corner.applyQuaternion(f.turn);
        minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
        minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
      }
      f.extent = { w: maxX - minX, h: maxY - minY, x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      return f;
    }
    NAMES.forEach(name => prepare(formations[name], name));

    // keys set off one after another: those leaving the stage first, then from the floor up and from left to right
    const orders = new Map();
    function orderOf(from, to) {
      const id = `${from}>${to}`;
      if (orders.has(id)) return orders.get(id);
      const rank = keys.map((_, k) => {
        const there = formations[to].slots[k];
        const here = formations[from].slots[k];
        if (!there) return -100 + (here ? here.x * 0.1 : 0);
        return there.y * 4 + there.x * 0.12 + there.z * 0.03;
      });
      const sorted = rank.map((r, k) => [r, k]).sort((a, b) => a[0] - b[0]);
      const order = new Float32Array(N);
      sorted.forEach(([, k], i) => { order[k] = N > 1 ? i / (N - 1) : 0; });
      orders.set(id, order);
      return order;
    }
    // each key tips a little its own way while it is in the air
    const tumble = keys.map((_, k) => Math.sin(k * 12.9898) * 0.45);

    // ----- The mesh: the plate and every key, one draw -----
    const geometry = keycapGeometry(THREE, narrow ? 0.7 : 1);
    const attr = {};
    Object.entries(ATTRIBUTES).forEach(([name, size]) => {
      attr[name] = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * size), size);
      attr[name].setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attr[name]);
    });
    const mesh = new THREE.InstancedMesh(geometry, keycapMaterial(THREE, legends), COUNT);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = keycapDepthMaterial(THREE);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    // under the plate: the shadow the sun casts on the page, and the soft dark of the plate's own footprint
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ color: 0x2b2216, opacity: 0.2, depthWrite: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -PLATE_H;
    ground.receiveShadow = true;
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uSize: { value: new THREE.Vector2(1, 1) },
          uSoft: { value: 0.55 },
          uRound: { value: 0.32 },
          uStrength: { value: 0.3 },
          uColor: { value: new THREE.Color(0x2b2216) },
        },
        vertexShader: /* glsl */ `
          uniform vec2 uSize;
          uniform float uSoft;
          varying vec2 vAt;
          void main() {
            vAt = position.xy * (uSize + uSoft * 4.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(vAt, 0.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec2 uSize;
          uniform float uSoft;
          uniform float uRound;
          uniform float uStrength;
          uniform vec3 uColor;
          varying vec2 vAt;
          void main() {
            vec2 q = abs(vAt) - (uSize * 0.5 - uRound);
            float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRound;
            float shade = 1.0 - smoothstep(0.0, uSoft, outside);
            gl_FragColor = vec4(uColor, shade * shade * uStrength);
            #include <colorspace_fragment>
          }`,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = -PLATE_H + 0.004;

    const model = new THREE.Group();
    model.add(ground, contact, mesh);
    scene.add(model);

    // ----- Confetti: little caps that burst out of the name when the visitor types it (see the party, below) -----
    const BITS = 60;
    const BIT_H = 0.55;   // a bit is a 1u cap this tall, scaled down
    const bitGeometry = keycapGeometry(THREE, 0.5);
    const bitAttr = {};
    Object.entries(ATTRIBUTES).forEach(([name, size]) => {
      bitAttr[name] = new THREE.InstancedBufferAttribute(new Float32Array(BITS * size), size);
      bitGeometry.setAttribute(name, bitAttr[name]);
    });
    const bits = new THREE.InstancedMesh(bitGeometry, mesh.material, BITS);
    bits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bits.customDepthMaterial = mesh.customDepthMaterial;
    bits.castShadow = true;
    bits.frustumCulled = false;
    bits.count = 0;   // nothing to draw until the party
    model.add(bits);
    const bitState = Array.from({ length: BITS }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), turn: new THREE.Quaternion(), axis: new THREE.Vector3(),
      spin: 0, size: 0, age: 0, life: 0,
    }));

    // ----- Per key: where it is, on its springs -----
    const keyState = keys.map(() => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      turn: new THREE.Quaternion(),
      press: 0, pressVel: 0,
      hop: 0, hopVel: 0,          // a bounce on the spot, for waves
      holdUntil: 0,               // pressed by a tap until then
      scale: 1,
      // what the pointer tests against
      centre: new THREE.Vector3(),
      half: new THREE.Vector3(),
    }));
    const plate = { w: formations.keyboard.plate.w, d: formations.keyboard.plate.d };
    const held = new Set();     // keys held down on the visitor's own keyboard
    let hovered = -1;           // key under the pointer
    const pointer = { x: 0, y: 0, over: false };   // a mouse or pen resting over the stage
    const kicks = [];           // scheduled bounces: [time, key, speed]

    // ----- Poses: one key in one formation, as it should look right now -----
    const makePose = () => ({
      pos: new THREE.Vector3(), yaw: 0, roll: 0, tilt: 0, w: 1, h: 1, d: 1, scale: 1, inset: 0, dish: 0,
      tint: new THREE.Color(), cell: -1, legendX: 0, legendZ: 0, legendSize: 1, legendTurn: 0, legendOn: 1,
      rough: 0.62, metal: 0, glow: 0, rigid: false,
    });
    const poseA = makePose();
    const poseB = makePose();
    const HIDDEN_Y = -PLATE_H * 0.55;

    let time = 0;
    let step = 0;                                      // schedule row the chart has moved to (fractional on the way)
    let stepGoal = Number(stage.dataset.step) || 0;    // schedule row in focus on the page
    let hotRow = null;                                 // prize row in focus on the page
    let hover = { group: null, index: null };          // a list row under the pointer, on the stage
    const heat = { day: page.sessions.map(() => 0), prize: page.prizeRows.map(() => 0) };
    let clockTime = page.sessions.length ? page.sessions[0].start : 540;   // minutes: where the hands point
    let hotPrize = 0;                                                       // how hot the hottest prize row is
    // the sign is set again when the day turns (a page left open overnight)
    let signText = formations.countdown.text;
    setInterval(() => {
      const days = daysTo(page.startTime);
      if (countdownText(days) === signText) return;
      formations.countdown = prepare(countdownFormation(keys, days), 'countdown');
      signText = formations.countdown.text;
      orders.clear();
      dirty = true;
    }, 60000);

    function pose(f, k, out) {
      const slot = f.slots[k];
      out.tilt = 0;
      out.rigid = false;
      if (!slot) {
        out.pos.set(0, HIDDEN_Y, 0);
        out.yaw = 0; out.w = 0.6; out.h = 0.3; out.d = 0.6; out.scale = 0;
        out.inset = CAP_PROFILE[0]; out.dish = 0;
        out.tint.copy(PLATE); out.cell = -1; out.glow = 0; out.rough = 0.62; out.metal = 0;
        return out;
      }
      out.pos.copy(slot.pos);
      out.yaw = slot.yaw;
      out.w = slot.w; out.h = slot.h; out.d = slot.d; out.scale = slot.scale;
      out.inset = slot.profile[0]; out.dish = slot.profile[1];
      out.tint.copy(slot.tint);
      out.cell = slot.cell; out.legendX = slot.legendX; out.legendZ = slot.legendZ; out.legendSize = slot.legendSize;
      out.legendTurn = slot.legendTurn;
      out.rough = 0.62;
      out.metal = 0;
      out.glow = 0;
      switch (slot.role) {
        case 'pixel': {
          // now and then a ripple runs along the sign, and lights it as it goes
          if (!reduceMotion) {
            const run = (time % 5.5) * 8 - slot.col - slot.row * 0.4;
            const crest = Math.exp(-run * run * 0.6);
            out.pos.y += 0.09 * crest;
            out.glow = 0.07 * crest;
          }
          break;
        }
        case 'tick': {
          // the half hours before the session in focus are ink, the session itself red and raised, the rest of the
          // day porcelain, and the hours outside it a step down in stone
          if (slot.session < 0) {
            out.tint.copy(STONE);
            out.pos.y -= 0.04;
            break;
          }
          const lit = heat.day[slot.session];
          out.tint.lerp(INK, clamp(step - slot.session, 0, 1)).lerp(RED, lit);
          out.pos.y += 0.16 * lit;
          out.glow = 0.05 * lit;
          break;
        }
        case 'hand': {
          // turned round the pin to the time of the session in focus: the hour hand once in twelve hours, the
          // minute hand once an hour. Hands are rigid, so they skip the springs
          const turns = clockTime / (slot.hand === 'hour' ? 720 : 60);
          const angle = (turns - Math.floor(turns)) * Math.PI * 2;
          const reach = slot.w / 2 - slot.back;
          out.pos.x = Math.sin(angle) * reach;
          out.pos.z = -Math.cos(angle) * reach;
          out.yaw = Math.PI / 2 - angle;
          out.rigid = true;
          break;
        }
        case 'bar': {
          // a prize in focus (its row on the page, or the bar under the pointer) glows a little, and the other bars
          // fade toward the board
          const h = heat.prize[slot.prize] || 0;
          out.glow = 0.05 * h;
          out.tint.lerp(PLATE, 0.6 * clamp(hotPrize - h, 0, 1));
          break;
        }
        case 'board':
          // the same anodised metal as the plate it stands on
          out.rough = 0.46;
          out.metal = 0.12;
          break;
        case 'enter':
          out.glow = 0.03;
          break;
        default:
      }
      return out;
    }

    // ----- Layout: every scene of the story holds one formation, fitted to one frame -----
    const sceneEls = [...document.querySelectorAll('.scene[data-scene]')];
    const windowEls = [...document.querySelectorAll('[data-window]')];
    const frameEls = [...stage.querySelectorAll('[data-frame]')];
    const footer = document.getElementById('footer');
    let marks = [];      // per scene: the scroll range over which it holds its formation
    let windows = [];    // small screens: [top, bottom] of each clear view of the stage, in page pixels
    const placements = {};   // per frame: centre and size in world units, top and height in stage pixels
    const frameOf = name => placements[name] || placements.side || { x: 0, y: 0, w: viewH, h: viewH, top: 0, height: 1 };
    let sized = '';
    let stageW = 1;          // the stage in CSS pixels
    let stageH = 1;

    function measure() {
      const vh = window.innerHeight;
      narrow = !wide.matches;
      const end = Math.max(0, document.documentElement.scrollHeight - vh);
      marks = sceneEls.map(el => {
        const box = el.getBoundingClientRect();
        const top = box.top + window.scrollY;
        // beside the story the formation holds while its scene fills the screen; behind it (small screens) while the
        // scene is read, so it changes as the next heading crosses the middle of the screen
        let a = narrow ? top - vh * 0.35 : top;
        let b = top + box.height - vh * (narrow ? 0.75 : 1);
        if (b < a) a = b = (a + b) / 2;
        const shape = el.dataset.scene in formations ? el.dataset.scene : 'keyboard';
        return { a, b, shape, frame: el.dataset.frame || 'side' };
      });
      windows = narrow
        ? windowEls.map(el => {
          const box = el.getBoundingClientRect();
          return [box.top + window.scrollY, box.bottom + window.scrollY];
        })
        : [];
      if (!marks.length) return;
      marks[0].a = Math.min(marks[0].a, 0);
      marks[0].b = Math.max(marks[0].b, 0);
      const last = marks[marks.length - 1];
      last.a = Math.min(last.a, end);
      last.b = Math.max(last.b, end);
    }

    function resize() {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      stageW = w;
      stageH = h;
      narrow = !wide.matches;
      dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(maxPixels / (w * h))) * quality);
      const next = `${w}x${h}@${dpr}`;
      if (next !== sized) {
        sized = next;
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const room = stage.getBoundingClientRect();
      const unit = viewH / h;   // world units per pixel where the model stands
      frameEls.forEach(el => {
        const box = el.getBoundingClientRect();
        const fw = box.width || w;
        const fh = box.height || h;
        placements[el.dataset.frame] = {
          x: (box.left - room.left + fw / 2 - w / 2) * unit,
          y: (h / 2 - (box.top - room.top) - fh / 2) * unit,
          w: fw * unit,
          h: fh * unit,
          top: box.top - room.top,
          height: fh,
        };
      });
      measure();
    }

    // how big a formation is drawn in a frame, and where its centre goes
    const fits = { a: { s: 1, x: 0, y: 0 }, b: { s: 1, x: 0, y: 0 } };
    function fit(f, frameName, out) {
      const frame = frameOf(frameName);
      // on a phone the board is wider than the screen: it is cropped at both ends, like a close-up, so the keys read
      let fill = narrow ? 0.92 : frameName === 'center' ? 0.9 : 0.76;
      if (narrow && f.name === 'keyboard') fill = 1.3;
      out.s = Math.min(frame.w / f.extent.w, frame.h / f.extent.h) * fill;
      out.x = frame.x - f.extent.x * out.s;
      out.y = frame.y - f.extent.y * out.s;
      return out;
    }

    // ----- Picking: which key is under the pointer -----
    // The shader shapes the caps, so the pointer is tested against each key's box instead of the triangles
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const inverse = new THREE.Matrix4();
    const turnBack = new THREE.Quaternion();
    const origin = new THREE.Vector3();
    const heading = new THREE.Vector3();
    function hitBox(o, d, half) {
      let near = -Infinity;
      let far = Infinity;
      for (const axis of ['x', 'y', 'z']) {
        const start = o[axis];
        const slope = d[axis];
        if (Math.abs(slope) < 1e-9) {
          if (Math.abs(start) > half[axis]) return null;
          continue;
        }
        const t1 = (-half[axis] - start) / slope;
        const t2 = (half[axis] - start) / slope;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
        if (near > far) return null;
      }
      return far < 0 ? null : near;
    }
    function keyAt(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      ndc.set(((clientX - box.left) / box.width) * 2 - 1, 1 - ((clientY - box.top) / box.height) * 2);
      raycaster.setFromCamera(ndc, camera);
      const ray = raycaster.ray.applyMatrix4(inverse.copy(model.matrixWorld).invert());
      let found = -1;
      let nearest = Infinity;
      keyState.forEach((key, k) => {
        if (key.scale < 0.2) return;
        turnBack.copy(key.turn).invert();
        origin.copy(ray.origin).sub(key.centre).applyQuaternion(turnBack);
        heading.copy(ray.direction).applyQuaternion(turnBack);
        const t = hitBox(origin, heading, key.half);
        if (t !== null && t < nearest) {
          nearest = t;
          found = k;
        }
      });
      return found;
    }

    // ----- Labels on the stage: a note in the corner for each formation, and the chart's figures -----
    const notes = [...stage.querySelectorAll('.stage-note[data-note]')].map(el => ({ el, name: el.dataset.note, shown: '' }));
    const shown = {};
    const setVar = (name, value) => {
      const text = value.toFixed(2);
      if (shown[name] === text) return;
      shown[name] = text;
      stage.style.setProperty(name, text);
    };
    // the amount over each bar, and the value of each rule at its left end, kept over the keys as they move
    const tags = formations.prizes.slots.flatMap((slot, k) => {
      if (!slot || (slot.role !== 'bar' && slot.role !== 'grid')) return [];
      const el = document.createElement('span');
      el.className = slot.role === 'bar' ? 'stage-tag' : 'stage-tag stage-tag-rule';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = slot.role === 'bar' ? `${slot.amount}<small>만원</small>` : String(slot.level);
      stage.appendChild(el);
      return [{ el, k, over: slot.role === 'bar', prize: slot.prize, shown: '' }];
    });
    const point = new THREE.Vector3();
    const offset = new THREE.Vector3();
    function pin(tag) {
      const key = keyState[tag.k];
      if (tag.over) offset.set(0, key.half.y + 0.2, 0);
      else offset.set(-key.half.x - 0.14, 0, 0);
      point.copy(key.centre).add(offset.applyQuaternion(key.turn));
      model.localToWorld(point).project(camera);
      const x = ((point.x + 1) / 2) * stageW;
      const y = ((1 - point.y) / 2) * stageH;
      tag.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${tag.over ? 'translate(-50%, -100%)' : 'translate(-100%, -50%)'}`;
      // beside a prize in focus, the other amounts step back
      const dim = tag.over ? (1 - 0.65 * clamp(hotPrize - (heat.prize[tag.prize] || 0), 0, 1)).toFixed(2) : '1.00';
      if (tag.shown !== dim) {
        tag.shown = dim;
        tag.el.style.setProperty('--tag', dim);
      }
    }
    // small screens: the model shows in full while nothing covers the middle of the frame, dims to a backdrop while the
    // story runs over it, and comes up part way while it changes formation (blend 0..1)
    function veil(blend) {
      const frame = frameOf('center');
      const top = window.scrollY + frame.top + frame.height * 0.2;
      const span = frame.height * 0.6;
      let open = 0;
      windows.forEach(([a, b]) => { open = Math.max(open, (Math.min(b, top + span) - Math.max(a, top)) / span); });
      const t = clamp(open, 0, 1);
      return Math.max(lerp(0.18, 1, t * t * (3 - 2 * t)), lerp(0.18, 0.3, Math.sin(Math.PI * blend)));
    }

    // ----- Typing: the board types the name, the visitor can type on it, and the big key waits to be pressed -----
    const TYPE_GAPS = [170, 130, 150, 210, 120, 160, 140];   // ms before each letter after the first
    const typing = { at: 0, i: 0 };
    let humanAt = -Infinity;     // the visitor's last keypress or pointer move over the stage
    let typed = '';
    let pulseAt = 0;
    const tap = (k, ms) => {
      if (k === undefined || k < 0) return;
      keyState[k].holdUntil = performance.now() + ms;
    };
    // a ripple of small hops out from one key, as far as the board goes
    function wave(from) {
      const now = performance.now();
      const origin0 = formations.keyboard.slots[from].pos;
      formations.keyboard.slots.forEach((slot, k) => {
        if (!slot) return;
        kicks.push([now + slot.pos.distanceTo(origin0) * 55, k, 3.4]);
      });
      kicks.sort((x, y) => x[0] - y[0]);
    }

    // ----- The party: the visitor types the name on the board (on their keyboard, or key by key with the pointer).
    // A ripple runs over the board, the eight red keys fly up and spell it in the air, turned to the viewer, while
    // little caps burst out of it and rain on the board; the corner says where to meet, and the name on the page
    // turns red. Under reduced motion only the words change and the red keys glow. -----
    const NAME = BRAND.map(code => code.slice(3)).join('');
    const brandAt = keys.map(key => BRAND.indexOf(key.code));
    const PARTY_UP = 2.9;    // s the name stays up
    const PARTY_END = 4.4;   // s the word in the corner stays
    const party = { at: -Infinity, t: Infinity, on: false, burstAt: 0, timer: 0 };
    // where letter j of the name hangs: in a row over the board, square to the viewer however the board is turned
    const FACING = -formations.keyboard.view[1];
    const wordAt = (j, out) => out.set((j - 3.5) * 1.5, 2.4, 0.5).applyAxisAngle(UP, FACING);
    function celebrate(from) {
      if (party.on) return;
      const now = performance.now();
      party.at = now;
      party.t = 0;
      party.on = true;
      document.body.classList.add('is-party');
      clearTimeout(party.timer);
      party.timer = setTimeout(() => {
        document.body.classList.remove('is-party');
        dirty = true;
      }, PARTY_END * 1000);
      if (!reduceMotion) {
        wave(from);
        party.burstAt = now + 520;   // as the letters reach the top
      }
      dirty = true;
    }
    function typeLetter(k) {
      const code = keys[k] ? keys[k].code : '';
      if (!/^Key[A-Z]$/.test(code)) return;
      typed = (typed + code.slice(3)).slice(-NAME.length);
      if (typed !== NAME) return;
      typed = '';
      celebrate(k);
    }
    // a letter of the name on its way up, up, or on its way back down
    const word = new THREE.Vector3();
    function lift(j, out) {
      if (reduceMotion) {
        out.glow = Math.max(out.glow, 0.2);
        return;
      }
      const t = party.t - 0.08 - j * 0.07;
      const up = smooth(clamp(t / 0.28, 0, 1)) * smooth(clamp((PARTY_UP - j * 0.04 - t) / 0.32, 0, 1))
        * clamp(weight.keyboard * 2 - 1, 0, 1);
      if (up <= 0) return;
      wordAt(j, word).y += Math.sin(party.t * 3.4 - j * 0.75) * 0.12;
      out.pos.lerp(word, up);
      out.yaw = lerp(out.yaw, FACING, up);
      out.tilt = lerp(out.tilt, 0.62, up);
      out.scale *= 1 + 0.3 * up;
      out.glow = Math.max(out.glow, 0.1 * up);
    }

    // the confetti, shot out of the name as it reaches the top: each bit hops and tumbles, lands on the plate (or off
    // its edge, on the page), bounces, settles flat and fades
    const BIT_FALL = 22;
    const BIT_TINTS = [RED, RED, RED, INK, CAP, STONE];
    const nudge = new THREE.Quaternion();
    const flat = new THREE.Quaternion();
    const bitAngles = new THREE.Euler();
    const scatter = new THREE.Vector3();
    function burst() {
      bitState.forEach((bit, i) => {
        scatter.set((Math.random() - 0.5) * 0.8, Math.random() * 0.3, (Math.random() - 0.5) * 0.5);
        wordAt(i % BRAND.length, bit.pos).add(scatter);
        bit.vel.set((Math.random() - 0.5) * 6, 3 + Math.random() * 5, 0.6 + Math.random() * 3.2);
        bit.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        bit.turn.setFromAxisAngle(bit.axis, Math.random() * Math.PI * 2);
        bit.spin = 7 + Math.random() * 9;
        bit.size = 0.3 + Math.random() * 0.16;
        bit.age = 0;
        bit.life = 2.2 + Math.random() * 0.8;
        const tint = BIT_TINTS[i % BIT_TINTS.length];
        bitAttr.aSize.setXYZW(i, 0.9, BIT_H, 0.9, 0.07);
        bitAttr.aProfile.setXYZW(i, CAP_PROFILE[0], CAP_PROFILE[1], 0, 0);
        bitAttr.aColor.setXYZ(i, tint.r, tint.g, tint.b);
        bitAttr.aLegend.setXYZW(i, -1, 0, 0, 1);
        bitAttr.aLook.setXYZW(i, 0.55, 0, 0, tint === RED ? 0.05 : 0);
      });
      Object.values(bitAttr).forEach(attribute => { attribute.needsUpdate = true; });
      bits.count = BITS;
    }
    function updateBits(dt) {
      if (!bits.count) return;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      let alive = 0;
      bitState.forEach((bit, i) => {
        let s = 0;
        for (let n = 0; n < steps && bit.age < bit.life; n++) {
          bit.age += h;
          const above = bit.pos.y >= 0;
          bit.vel.y -= BIT_FALL * h;
          bit.pos.addScaledVector(bit.vel, h);
          const onPlate = above && Math.abs(bit.pos.x) < plate.w / 2 && Math.abs(bit.pos.z) < plate.d / 2;
          const floor = (onPlate ? 0 : -PLATE_H) + (BIT_H / 2) * bit.size;
          if (bit.pos.y <= floor) {
            bit.pos.y = floor;
            bit.vel.y = bit.vel.y < -1.2 ? -bit.vel.y * 0.36 : 0;
            bit.vel.x *= 0.72;
            bit.vel.z *= 0.72;
            bit.spin *= 0.5;
            bitAngles.setFromQuaternion(bit.turn, 'YXZ');
            bit.turn.slerp(flat.setFromAxisAngle(UP, bitAngles.y), 1 - Math.exp(-14 * h));
          }
          bit.turn.premultiply(nudge.setFromAxisAngle(bit.axis, bit.spin * h));
        }
        if (bit.age < bit.life) {
          alive++;
          s = bit.size * clamp(bit.age / 0.06, 0, 1) * clamp((bit.life - bit.age) / 0.4, 0, 1);
        }
        bits.setMatrixAt(i, matrix.compose(bit.pos, bit.turn, scaleV.setScalar(Math.max(s, 1e-4))));
      });
      bits.instanceMatrix.needsUpdate = true;
      if (!alive) bits.count = 0;
    }

    // ----- Animation -----
    const weight = Object.fromEntries(NAMES.map(name => [name, 0]));
    // the big key at the end is a way in: a click on it follows the page's own apply link, while there is one
    const applyLink = () => document.querySelector('a[data-apply]:not([hidden])');
    let linkOpen = false;
    let linkCheckedAt = 0;
    const onEnter = k => k >= 0 && k === keyIndex.get('Enter') && weight.enter > 0.85;
    let scrollY = window.scrollY;
    let dragging = false;
    let pressing = -1;   // key under a pointer that is down
    let yaw = 0;         // how far the visitor has turned the model by hand
    let pitch = 0;
    let yawSpeed = 0;
    let pitchSpeed = 0;
    let lookX = 0;       // the model leans a little toward the pointer
    let lookY = 0;
    let lookGoalX = 0;
    let lookGoalY = 0;
    let dirty = true;
    let movedAt = 0;     // last scroll, resize or pointer move
    let liveAt = 0;      // when the stage first went live
    let assembled = reduceMotion ? 1 : 0;   // 0..1: the plate rises and the keys drop onto it
    let covered = false;                     // the footer is over the whole stage
    const checkCovered = () => { covered = !!footer && footer.getBoundingClientRect().top <= 0; };

    const target = new THREE.Vector3();
    const tint = new THREE.Color();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');   // a key turns on its yaw, then tips up (tilt) and over (roll)
    const spin = new THREE.Quaternion();
    const turnX = new THREE.Quaternion();
    const turnY = new THREE.Quaternion();
    const RIGHT = new THREE.Vector3(1, 0, 0);
    const UP = new THREE.Vector3(0, 1, 0);
    const matrix = new THREE.Matrix4();
    const scaleV = new THREE.Vector3();
    const placed = new THREE.Vector3();
    const sphereCentre = new THREE.Vector3();

    // the opening: the plate comes up, then the keys drop onto it one after another and bounce once
    const GRAVITY = 70;
    const DROP = 3.2;
    const FALL = Math.sqrt((2 * DROP) / GRAVITY);
    const BOUNCE = 0.22 * GRAVITY * FALL;
    const dropOffset = t => {
      if (t < FALL) return DROP - 0.5 * GRAVITY * t * t;
      const b = t - FALL;
      return b < (2 * BOUNCE) / GRAVITY ? BOUNCE * b - 0.5 * GRAVITY * b * b : 0;
    };
    const introOrder = orderOf('keyboard', 'keyboard');

    let a = null;
    let b = null;
    let blend = 0;

    // where the scroll is between two scenes, and how far the change between them has got
    function locate() {
      let i = 0;
      while (i < marks.length - 1 && scrollY >= marks[i + 1].a) i++;
      a = marks[i] || { shape: 'keyboard', frame: 'center', a: 0, b: 0 };
      b = marks[Math.min(i + 1, marks.length - 1)] || a;
      const travel = b !== a && scrollY > a.b ? clamp((scrollY - a.b) / Math.max(1, b.a - a.b), 0, 1) : 0;
      // the formation holds near each scene and changes over the middle of the way; reduced motion swaps halfway
      blend = reduceMotion ? Math.round(travel) : clamp((travel - 0.1) / 0.8, 0, 1);
    }

    // the formation that has most of the stage right now
    const leading = () => formations[blend < 0.5 ? a.shape : b.shape];

    // the pose every key is headed for right now: along its arc between the two formations
    function aim(k, out) {
      const fa = formations[a.shape];
      const fb = formations[b.shape];
      pose(fa, k, poseA);
      pose(fb, k, poseB);
      const order = orderOf(a.shape, b.shape)[k];
      const t = fa === fb ? 0 : inOut(clamp(blend * (1 + SPREAD) - order * SPREAD, 0, 1));
      const arc = Math.sin(Math.PI * t);
      out.pos.lerpVectors(poseA.pos, poseB.pos, t);
      const reach = poseA.pos.distanceTo(poseB.pos);
      out.pos.y += arc * Math.min(2.4, 0.45 + reach * 0.16) * (poseA.scale > 0 && poseB.scale > 0 ? 1 : 0.35);
      out.yaw = lerp(poseA.yaw, poseB.yaw, t);
      out.roll = arc * tumble[k];
      out.tilt = lerp(poseA.tilt, poseB.tilt, t);
      out.w = lerp(poseA.w, poseB.w, t);
      out.h = lerp(poseA.h, poseB.h, t);
      out.d = lerp(poseA.d, poseB.d, t);
      out.scale = lerp(poseA.scale, poseB.scale, t);
      out.inset = lerp(poseA.inset, poseB.inset, t);
      out.dish = lerp(poseA.dish, poseB.dish, t);
      out.tint.lerpColors(poseA.tint, poseB.tint, t);
      out.rough = lerp(poseA.rough, poseB.rough, t);
      out.metal = lerp(poseA.metal, poseB.metal, t);
      out.glow = lerp(poseA.glow, poseB.glow, t);
      // a legend fades out and the next one in, unless it is the same legend
      const near = t < 0.5 ? poseA : poseB;
      out.cell = near.cell;
      out.legendX = near.legendX;
      out.legendZ = near.legendZ;
      out.legendSize = near.legendSize;
      out.legendTurn = near.legendTurn;
      out.rigid = poseA.rigid || poseB.rigid;
      out.legendOn = poseA.cell === poseB.cell ? 1 : Math.abs(1 - 2 * t);
      if (poseA.cell === poseB.cell) {
        out.legendX = lerp(poseA.legendX, poseB.legendX, t);
        out.legendZ = lerp(poseA.legendZ, poseB.legendZ, t);
        out.legendSize = lerp(poseA.legendSize, poseB.legendSize, t);
      }
      if (party.on && brandAt[k] >= 0) lift(brandAt[k], out);
      return out;
    }
    const goal = makePose();

    function update(dt) {
      const now = performance.now();
      if (!reduceMotion) time += dt;
      if (assembled < 1) assembled = clamp((now - liveAt) / 1700, 0, 1);

      // where the scroll is (Lenis already eases the scroll itself)
      scrollY = reduceMotion ? window.scrollY : damp(scrollY, window.scrollY, window.lenis ? 24 : 10, dt);
      locate();
      for (const name of NAMES) weight[name] = 0;
      weight[a.shape] += 1 - blend;
      weight[b.shape] += blend;

      // highlights ease in and out
      step = reduceMotion ? stepGoal : damp(step, stepGoal, 6, dt);
      const litStep = hover.group === 'day' ? hover.index : Math.round(stepGoal);
      const litRow = hover.group === 'prize' ? hover.index : hotRow;
      heat.day.forEach((v, i) => { heat.day[i] = reduceMotion ? +(i === litStep) : damp(v, +(i === litStep), 10, dt); });
      heat.prize.forEach((v, i) => { heat.prize[i] = reduceMotion ? +(i === litRow) : damp(v, +(i === litRow), 10, dt); });
      hotPrize = Math.max(0, ...heat.prize);
      // the hands sweep to the session in focus: the minute hand round once for every hour on the way, at most four
      // turns a second
      const lit = page.sessions[clamp(litStep, 0, page.sessions.length - 1)];
      if (lit) {
        if (reduceMotion) clockTime = lit.start;
        else clockTime += clamp((lit.start - clockTime) * (1 - Math.exp(-5 * dt)), -240 * dt, 240 * dt);
      }

      // the board types the name while it is centre stage and nobody else is typing
      const boardUp = weight.keyboard > 0.85 && assembled >= 1 && !reduceMotion && now - humanAt > 3000;
      if (!boardUp) typing.at = Math.max(typing.at, now + 700);
      else if (now >= typing.at) {
        tap(keyIndex.get(BRAND[typing.i]), 105);
        typing.at = now + (typing.i === BRAND.length - 1 ? 2600 : TYPE_GAPS[typing.i]);
        typing.i = (typing.i + 1) % BRAND.length;
      }
      // the big key asks to be pressed, now and then
      const enterKey = keyIndex.get('Enter');
      if (weight.enter > 0.9 && !reduceMotion && hovered !== enterKey && now >= pulseAt) {
        tap(enterKey, 150);
        pulseAt = now + 2800;
      } else if (weight.enter <= 0.9) pulseAt = Math.max(pulseAt, now + 900);
      while (kicks.length && kicks[0][0] <= now) {
        const [, k, speed] = kicks.shift();
        keyState[k].hopVel += speed;
      }
      party.t = (now - party.at) / 1000;
      party.on = party.t < PARTY_END;
      if (party.burstAt && now >= party.burstAt) {
        party.burstAt = 0;
        burst();
      }

      // ----- keys -----
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      const intro = assembled < 1 ? (now - liveAt) / 1000 : Infinity;
      for (let k = 0; k < N; k++) {
        const key = keyState[k];
        aim(k, goal);
        // the position follows its path on a spring, the turn on a damper; reduced motion goes straight there
        if (reduceMotion || goal.rigid) {
          key.pos.copy(goal.pos);
          key.vel.set(0, 0, 0);
        } else {
          for (let s = 0; s < steps; s++) {
            target.subVectors(goal.pos, key.pos).multiplyScalar(170).addScaledVector(key.vel, -20);
            key.vel.addScaledVector(target, h);
            key.pos.addScaledVector(key.vel, h);
          }
        }
        spin.setFromEuler(euler.set(goal.tilt, goal.yaw, goal.roll));
        if (reduceMotion || goal.rigid) key.turn.copy(spin);
        else key.turn.slerp(spin, 1 - Math.exp(-16 * dt));

        // presses: by the pointer, a tap (the board typing, a click), or the visitor's own keyboard
        const down = (k === hovered && weight.keyboard + weight.countdown + weight.enter > 0.5) || k === pressing || held.has(k)
          || now < key.holdUntil;
        if (reduceMotion) key.press = down ? 1 : 0;
        else {
          for (let s = 0; s < steps; s++) {
            key.pressVel += ((down ? 1 : 0) - key.press) * 900 * h - key.pressVel * 30 * h;
            key.press += key.pressVel * h;
            key.hopVel += (-key.hop * 140 - key.hopVel * 7) * h;
            key.hop += key.hopVel * h;
          }
        }

        // the opening drop
        let introY = 0;
        let grow = 1;
        if (intro < Infinity) {
          const since = intro - 0.35 - introOrder[k] * 0.8;
          grow = clamp(since / 0.12, 0, 1);
          introY = since > 0 ? dropOffset(since) : DROP;
        }

        const scale = goal.scale * grow;
        key.scale = scale;
        placed.copy(key.pos);
        placed.y += introY + key.hop - key.press * PRESS * Math.max(goal.scale, 0.001);
        mesh.setMatrixAt(k + 1, matrix.compose(placed, key.turn, scaleV.setScalar(Math.max(scale, 1e-4))));
        key.centre.copy(placed);
        key.half.set(goal.w / 2, goal.h / 2, goal.d / 2).multiplyScalar(scale);

        attr.aSize.setXYZW(k + 1, goal.w, goal.h, goal.d, 0.07);
        attr.aProfile.setXYZW(k + 1, goal.inset, goal.dish, goal.legendTurn, 0);
        tint.copy(goal.tint);
        attr.aColor.setXYZ(k + 1, tint.r, tint.g, tint.b);
        attr.aLegend.setXYZW(k + 1, goal.cell, goal.legendX, goal.legendZ, goal.legendSize);
        attr.aLook.setXYZW(k + 1, goal.rough, goal.metal, goal.cell >= 0 ? goal.legendOn : 0, goal.glow);
      }

      // ----- the plate: it takes the size of the formation on it -----
      const eased = inOut(blend);
      const fa = formations[a.shape];
      const fb = formations[b.shape];
      const plateW = lerp(fa.plate.w, fb.plate.w, eased);
      const plateD = lerp(fa.plate.d, fb.plate.d, eased);
      plate.w = reduceMotion ? plateW : damp(plate.w, plateW, 12, dt);
      plate.d = reduceMotion ? plateD : damp(plate.d, plateD, 12, dt);
      const rise = assembled < 1 ? outQuart(clamp((now - liveAt) / 500, 0, 1)) : 1;
      mesh.setMatrixAt(0, matrix.compose(placed.set(0, -PLATE_H / 2, 0), spin.identity(), scaleV.set(lerp(0.9, 1, rise), Math.max(rise, 1e-4), lerp(0.9, 1, rise))));
      attr.aSize.setXYZW(0, plate.w, PLATE_H, plate.d, 0.32);
      attr.aProfile.setXYZW(0, 0, 0, 0, 0);
      attr.aColor.setXYZ(0, PLATE.r, PLATE.g, PLATE.b);
      attr.aLegend.setXYZW(0, -1, 0, 0, 1);
      attr.aLook.setXYZW(0, 0.46, 0.12, 0, 0);
      mesh.instanceMatrix.needsUpdate = true;
      Object.values(attr).forEach(attribute => { attribute.needsUpdate = true; });

      ground.scale.set(plate.w * 3, plate.d * 3, 1);
      contact.material.uniforms.uSize.value.set(plate.w * lerp(0.9, 1, rise), plate.d * lerp(0.9, 1, rise));
      contact.material.uniforms.uStrength.value = 0.3 * rise;
      updateBits(dt);

      // ----- the model: turned to show the formation, plus the hand, the lean and a slow sway -----
      if (!dragging && !reduceMotion) {
        yawSpeed += (-yaw * 30 - yawSpeed * 9) * dt;
        pitchSpeed += (-pitch * 30 - pitchSpeed * 9) * dt;
        yaw += yawSpeed * dt;
        pitch += pitchSpeed * dt;
      }
      lookX = damp(lookX, lookGoalX, 4, dt);
      lookY = damp(lookY, lookGoalY, 4, dt);
      const sway = reduceMotion ? 0 : 1;
      // behind the story nobody turns it by hand, so it swings a little wider on its own
      const swing = narrow ? Math.sin(time * 0.3) * 0.16 : Math.sin(time * 0.45) * 0.06;
      model.quaternion.slerpQuaternions(fa.turn, fb.turn, eased);
      // the first show also swings the model round to face the viewer
      const entrance = (1 - outQuart(assembled)) * -0.5;
      turnY.setFromAxisAngle(UP, yaw + lookX * 0.12 + sway * swing + entrance);
      turnX.setFromAxisAngle(RIGHT, pitch - lookY * 0.06 + sway * Math.sin(time * 0.37) * 0.02);
      model.quaternion.multiply(turnY).premultiply(turnX);
      fit(fa, a.frame, fits.a);
      fit(fb, b.frame, fits.b);
      model.position.set(lerp(fits.a.x, fits.b.x, eased), lerp(fits.a.y, fits.b.y, eased) + sway * Math.sin(time * 0.8) * 0.02, 0);
      model.scale.setScalar(lerp(fits.a.s, fits.b.s, eased));
      model.updateMatrixWorld();

      // ----- the sun's shadow covers the model wherever it stands -----
      sphereCentre.lerpVectors(fa.sphere.center, fb.sphere.center, eased);
      model.localToWorld(sphereCentre);
      const radius = lerp(fa.sphere.radius, fb.sphere.radius, eased) * model.scale.x * 1.15;
      sun.position.copy(sphereCentre).addScaledVector(SUN, radius * 4);
      sun.target.position.copy(sphereCentre);
      sun.target.updateMatrixWorld();
      const shadowCam = sun.shadow.camera;
      shadowCam.left = shadowCam.bottom = -radius;
      shadowCam.right = shadowCam.top = radius;
      shadowCam.near = radius * 0.5;
      shadowCam.far = radius * 8;
      shadowCam.updateProjectionMatrix();
      sun.shadow.normalBias = radius * 0.003;

      // the keys move under a pointer that stands still, so what it is over is asked again every frame
      if (pointer.over) pick();

      // ----- what the overlays show, and how far the backdrop is dimmed -----
      setVar('--show', narrow ? veil(blend) : 1);
      if (now >= linkCheckedAt) {
        linkOpen = !!applyLink();
        linkCheckedAt = now + 1000;
      }
      // the notes step aside as the footer comes up over the stage
      const clear = footer ? clamp((footer.getBoundingClientRect().top / window.innerHeight - 0.45) / 0.3, 0, 1) : 1;
      notes.forEach(note => {
        // the big key only invites a press while the application is open
        const on = narrow || (note.name === 'enter' && !linkOpen) ? 0 : clamp((weight[note.name] - 0.75) / 0.25, 0, 1) * clear;
        const text = on.toFixed(2);
        if (note.shown === text) return;
        note.shown = text;
        note.el.style.setProperty('--note', text);
      });
      // the chart's figures come up with the chart, beside the story only
      const tagsOn = narrow ? 0 : clamp((weight.prizes - 0.75) / 0.25, 0, 1) * clear;
      setVar('--tags', tagsOn);
      if (tagsOn > 0) tags.forEach(pin);
    }

    // drop the resolution if the device cannot keep up
    let slowRuns = 0;
    let frames = 0;
    let elapsed = 0;
    function watchFrameRate(delta) {
      if (delta > 0.25) return;   // the tab was in the background
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
      if (broken) return;
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
      if (broken) return;
      resize();
      checkCovered();
      if (!liveAt) liveAt = performance.now();
      scrollY = window.scrollY;
      step = stepGoal;
      const lead = page.sessions[clamp(Math.round(stepGoal), 0, page.sessions.length - 1)];
      if (lead) clockTime = lead.start;
      // every key starts where it belongs, so the opening drop is the only motion
      locate();
      for (let k = 0; k < N; k++) {
        aim(k, goal);
        keyState[k].pos.copy(goal.pos);
        keyState[k].vel.set(0, 0, 0);
        keyState[k].turn.setFromEuler(euler.set(goal.tilt, goal.yaw, goal.roll));
      }
      plate.w = formations[a.shape].plate.w;
      plate.d = formations[a.shape].plate.d;
      stage.classList.add('is-live');
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }

    // ----- Input -----
    document.addEventListener('stage:focus', e => {
      const { group, index } = e.detail;
      if (group === 'day' && index !== null) stepGoal = index;
      if (group === 'prize') hotRow = index;
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

    // the key under the pointer, and the list row it stands for
    function pick() {
      hovered = keyAt(pointer.x, pointer.y);
      const slot = hovered >= 0 ? leading().slots[hovered] : null;
      if (slot && slot.role === 'tick' && slot.session >= 0 && weight.day > 0.85) setHover('day', slot.session);
      else if (slot && slot.role === 'bar' && weight.prizes > 0.85) setHover('prize', slot.prize);
      else setHover(null, null);
      stage.classList.toggle('is-pointing', onEnter(hovered) && !!applyLink());
    }

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

    // the visitor's own keyboard plays the board while it is on stage (never while they type into a field)
    const typingInto = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    window.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || typingInto(e.target)) return;
      const k = keyIndex.get(e.code);
      if (k === undefined || weight.keyboard < 0.5) return;
      held.add(k);
      humanAt = performance.now();
      dirty = true;
      if (!e.repeat) typeLetter(k);
    });
    window.addEventListener('keyup', e => {
      const k = keyIndex.get(e.code);
      if (k !== undefined) held.delete(k);
    });
    window.addEventListener('blur', () => held.clear());

    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let downAt = -1;
    stage.addEventListener('pointerdown', e => {
      if (e.button) return;
      downAt = e.pointerId;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      yawSpeed = pitchSpeed = 0;
      pressing = keyAt(e.clientX, e.clientY);
      humanAt = performance.now();
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      dirty = true;
      movedAt = performance.now();
      if (downAt === e.pointerId) {
        // a press turns into a drag once the pointer travels
        if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
          dragging = true;
          pressing = -1;
        }
        if (dragging) {
          yaw += (e.clientX - lastX) * 0.008;
          pitch = clamp(pitch + (e.clientY - lastY) * 0.006, -0.7, 0.5);
        }
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (e.pointerType === 'touch' || !b) return;
      humanAt = performance.now();
      const box = stage.getBoundingClientRect();
      lookGoalX = ((e.clientX - box.left) / box.width) * 2 - 1;
      lookGoalY = 1 - ((e.clientY - box.top) / box.height) * 2;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.over = true;
      pick();
    });
    const release = e => {
      if (downAt !== e.pointerId) return;
      downAt = -1;
      if (pressing >= 0) tap(pressing, 90);
      // a click on a letter types it, so the name can be spelled with the pointer too
      if (!dragging && pressing >= 0 && e.type === 'pointerup' && weight.keyboard > 0.5) typeLetter(pressing);
      if (!dragging && onEnter(pressing) && e.type === 'pointerup') {
        const link = applyLink();
        if (link) link.click();
      }
      pressing = -1;
      if (!dragging) return;
      dragging = false;
      yaw = ((((yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;   // unwind whole turns
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', () => {
      lookGoalX = lookGoalY = 0;
      pointer.over = false;
      hovered = -1;
      setHover(null, null);
      stage.classList.remove('is-pointing');
    });

    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      stage.classList.remove('is-live');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      buildEnvironment();
      legends.redraw();
      run();
    });

    // compile the shaders off the main thread where the browser allows it
    renderer.compileAsync(scene, camera).then(run, run);
  };
})(window.EasyThonStage = window.EasyThonStage || {});
