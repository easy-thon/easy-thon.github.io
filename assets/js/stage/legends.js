// EasyThon 2026 · key legends
// Every legend on the caps is drawn once, white on clear, into one square atlas: a cell per legend, laid out the
// way the cap wears it (Latin top left, jamo bottom right). keycap.js prints a cell on a cap's top face in the
// cap's legend colour.
(parts => {
  const LATIN = '"Geist Variable", "Helvetica Neue", Arial, sans-serif';
  const HANGUL = '"SUIT Variable", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

  // the faces the legends are set in; they are already on the page, so this is usually instant
  function legendFonts(timeout = 2500) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const faces = [`600 64px ${LATIN}`, `600 64px ${HANGUL}`];
    const loads = Promise.all(faces.map(face => document.fonts.load(face, 'Aㅂ0').catch(() => null)));
    return Promise.race([loads, new Promise(done => setTimeout(done, timeout))]);
  }

  function createLegends(THREE, specs, { size = 2048 } = {}) {
    const ids = [...specs.keys()];
    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
    const cell = Math.floor(size / cols);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = cell * cols;
    const ctx = canvas.getContext('2d');
    const cellOf = new Map(ids.map((id, i) => [id, i]));

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
      ids.forEach((id, i) => {
        const spec = specs.get(id);
        const x0 = (i % cols) * cell;
        const y0 = Math.floor(i / cols) * cell;
        const pad = cell * 0.1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 2, y0 + 2, cell - 4, cell - 4);   // nothing bleeds into the next cell's mipmaps
        ctx.clip();
        if (spec.main) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.font = `600 ${Math.round(cell * 0.4)}px ${LATIN}`;
          ctx.fillText(spec.main, x0 + pad, y0 + pad);
        }
        if (spec.sub) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.font = `600 ${Math.round(cell * 0.33)}px ${HANGUL}`;
          ctx.fillText(spec.sub, x0 + cell - pad, y0 + cell - pad);
        }
        if (spec.word) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          // Hangul words in the Korean face, the rest in Latin
          const hangul = /[ㄱ-힣]/.test(spec.word);
          ctx.font = `600 ${Math.round(cell * (hangul ? 0.26 : 0.27))}px ${hangul ? HANGUL : LATIN}`;
          ctx.fillText(spec.word, x0 + pad, y0 + pad);
        }
        if (spec.icon) {
          const s = cell * (spec.word ? 0.36 : 0.42);
          if (spec.word) icon(spec.icon, x0 + cell - pad - s, y0 + cell - pad - s * 0.95, s);
          else icon(spec.icon, x0 + pad, y0 + pad, s);
        }
        if (spec.figure) {
          // a numeral in the middle: the clock face
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `600 ${Math.round(cell * 0.44)}px ${LATIN}`;
          ctx.fillText(spec.figure, x0 + cell / 2, y0 + cell / 2 + cell * 0.03);
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
      cellOf,
      // the faces can turn up after the first draw (a slow connection); then draw again
      redraw() {
        draw();
        texture.needsUpdate = true;
      },
    };
  }

  parts.legends = { legendFonts, createLegends };
})(window.EasyThonStage = window.EasyThonStage || {});
