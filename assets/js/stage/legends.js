// EasyThon 2026 · key legends
// Every legend on the caps is drawn once, white on clear, into one square atlas: a cell per legend, laid out the
// way the cap wears it (Latin top left, jamo bottom right). keycap.js prints a cell on a cap's top face in the
// cap's legend colour.
(parts => {
  const LATIN = '"Geist Variable", "Helvetica Neue", Arial, sans-serif';
  const HANGUL = '"SUIT Variable", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

  // the faces the legends are set in; they are already on the page, so this is usually instant
  const FACES = [`600 64px ${LATIN}`, `600 64px ${HANGUL}`];
  function legendFonts(timeout = 2500) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const loads = Promise.all(FACES.map(face => document.fonts.load(face, 'Aㅂ0').catch(() => null)));
    return Promise.race([loads, new Promise(done => setTimeout(done, timeout))]);
  }
  // already here: then the first drawing is the last (the atlas is 16 MB to send to the GPU each time)
  const legendFontsReady = () => !document.fonts || !document.fonts.check || FACES.every(face => document.fonts.check(face, 'Aㅂ0'));

  // A legend shown large can ask for a block of cells (span: 2 is a 2 x 2 block) instead of one, so that it stays
  // sharp where the cap is the size of a hand. The blocks are placed first, then the single cells in the gaps.
  function pack(ids, spanOf) {
    const need = ids.reduce((sum, id) => sum + spanOf.get(id) ** 2, 0);
    for (let cols = Math.max(1, Math.ceil(Math.sqrt(need))); ; cols++) {
      const taken = new Uint8Array(cols * cols);
      const cellOf = new Map();
      const order = [...ids].sort((a, b) => spanOf.get(b) - spanOf.get(a));
      const fits = order.every(id => {
        const span = spanOf.get(id);
        for (let at = 0; at < cols * cols; at++) {
          const r = Math.floor(at / cols);
          const c = at % cols;
          if (r + span > cols || c + span > cols) continue;
          let free = true;
          for (let i = 0; i < span * span && free; i++) free = !taken[(r + Math.floor(i / span)) * cols + c + (i % span)];
          if (!free) continue;
          for (let i = 0; i < span * span; i++) taken[(r + Math.floor(i / span)) * cols + c + (i % span)] = 1;
          cellOf.set(id, at);
          return true;
        }
        return false;
      });
      if (fits) return { cols, cellOf };
    }
  }

  function createLegends(THREE, specs, { size = 2048 } = {}) {
    const ids = [...specs.keys()];
    const spanOf = new Map(ids.map(id => [id, specs.get(id).span || 1]));
    const { cols, cellOf } = pack(ids, spanOf);
    const cell = Math.floor(size / cols);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = cell * cols;
    const ctx = canvas.getContext('2d');

    const icon = (name, x, y, s) => {
      ctx.lineWidth = s * 0.09;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (name === 'enter') {
        // ↵ : down from the top right, then back to the left with a head
        ctx.moveTo(x + s, y);
        ctx.lineTo(x + s, y + s * 0.62);
        ctx.lineTo(x + s * 0.12, y + s * 0.62);
        ctx.moveTo(x + s * 0.38, y + s * 0.36);
        ctx.lineTo(x + s * 0.12, y + s * 0.62);
        ctx.lineTo(x + s * 0.38, y + s * 0.88);
      } else if (name === 'back') {
        // ⌫ : a tag pointing left, with a cross in it
        ctx.moveTo(x, y + s * 0.5);
        ctx.lineTo(x + s * 0.3, y + s * 0.16);
        ctx.lineTo(x + s, y + s * 0.16);
        ctx.lineTo(x + s, y + s * 0.84);
        ctx.lineTo(x + s * 0.3, y + s * 0.84);
        ctx.closePath();
        ctx.moveTo(x + s * 0.48, y + s * 0.36);
        ctx.lineTo(x + s * 0.76, y + s * 0.64);
        ctx.moveTo(x + s * 0.76, y + s * 0.36);
        ctx.lineTo(x + s * 0.48, y + s * 0.64);
      }
      ctx.stroke();
    };

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff';
      ids.forEach(id => {
        const spec = specs.get(id);
        const at = cellOf.get(id);
        const x0 = (at % cols) * cell;
        const y0 = Math.floor(at / cols) * cell;
        const box = cell * spanOf.get(id);   // the cell, or the block of cells
        const pad = box * 0.1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 2, y0 + 2, box - 4, box - 4);   // nothing bleeds into the next cell's mipmaps
        ctx.clip();
        if (spec.main) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `600 ${Math.round(box * 0.4)}px ${LATIN}`;
          ctx.fillText(spec.main, x0 + pad, y0 + pad);
        }
        if (spec.sub) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.font = `600 ${Math.round(box * 0.33)}px ${HANGUL}`;
          ctx.fillText(spec.sub, x0 + box - pad, y0 + box - pad);
        }
        if (spec.word) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          // Hangul words in the Korean face, the rest in Latin
          const hangul = /[ㄱ-힣]/.test(spec.word);
          ctx.font = `600 ${Math.round(box * (hangul ? 0.26 : 0.27))}px ${hangul ? HANGUL : LATIN}`;
          ctx.fillText(spec.word, x0 + pad, y0 + pad);
        }
        if (spec.icon) {
          const s = box * (spec.word ? 0.36 : 0.42);
          if (spec.word) icon(spec.icon, x0 + box - pad - s, y0 + box - pad - s * 0.95, s);
          else icon(spec.icon, x0 + pad, y0 + pad, s);
        }
        if (spec.figure) {
          // a numeral in the middle: the clock face
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `600 ${Math.round(box * 0.44)}px ${LATIN}`;
          ctx.fillText(spec.figure, x0 + box / 2, y0 + box / 2 + box * 0.03);
        }
        ctx.restore();
      });
    }
    draw();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;   // coverage, not colour
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;

    return {
      texture,
      cols,
      cellOf,    // a legend's cell (the top left one of a block)
      spanOf,    // and how many cells across it takes
      // the faces can turn up after the first draw (a slow connection); then draw again
      redraw() {
        draw();
        texture.needsUpdate = true;
      },
    };
  }

  parts.legends = { legendFonts, legendFontsReady, createLegends };
})(window.EasyThonStage = window.EasyThonStage || {});
