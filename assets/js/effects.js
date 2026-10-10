// EasyThon 2026, page behaviour: smooth scrolling, which scene is on screen, the schedule stepper, live dates,
// the apply dock, reveals, and the link between the lists and the 3D stage (assets/js/scene.js).
//
// The two files only talk through events on document:
//   stage:focus  { group, index }   a list row is in focus         (this file -> scene.js)
//   stage:hover  { group, index }   a 3D bar is under the pointer  (scene.js -> this file)
// group is 'clock' (schedule rows) or 'podium' (prize rows); index null means none.
(() => {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const topbar = document.getElementById('topbar');
  const stage = document.getElementById('stage');
  const scenes = [...document.querySelectorAll('.scene')];
  const tabs = [...document.querySelectorAll('.nav a')];

  const focusStage = (group, index) => {
    document.dispatchEvent(new CustomEvent('stage:focus', { detail: { group, index } }));
  };

  // ----- Smooth wheel scrolling (Lenis) for mice and trackpads; touch and reduced motion keep the native scroll -----
  if (window.Lenis && !reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    window.lenis = new window.Lenis({ autoRaf: true, anchors: true, lerp: 0.12 });
  }

  // ----- Schedule: one row leads at a time -----
  const schedule = document.getElementById('schedule');
  const pin = schedule && schedule.querySelector('.scene-pin');
  const timeline = document.getElementById('timeline');
  const rows = [...document.querySelectorAll('#timeline .tl-row')];
  const clockTime = document.querySelector('[data-clock-time]');
  const clockWhat = document.querySelector('[data-clock-what]');
  const startsAt = rows.map(row => {
    const [hours, minutes] = row.dataset.time.split(':').map(Number);
    return hours * 60 + minutes;
  });

  // every session runs until the next one starts
  rows.slice(0, -1).forEach((row, i) => {
    const span = startsAt[i + 1] - startsAt[i];
    const hours = Math.floor(span / 60);
    const minutes = span % 60;
    row.querySelector('.tl-span').textContent = [hours && `${hours}시간`, minutes && `${minutes}분`].filter(Boolean).join(' ');
  });
  if (rows.length) {
    const hours = `${rows[0].dataset.time} – ${rows[rows.length - 1].dataset.time}`;
    document.querySelectorAll('[data-hours]').forEach(el => { el.textContent = hours; });
  }

  let scrollStep = 0;     // where the scroll position is in the day
  let rowStep = null;     // a row under the pointer
  let stageStep = null;   // a dial segment under the pointer, reported by scene.js
  let lit = -1;
  let led = -1;
  // the ink block behind the lit row slides to it
  function placeMarker() {
    const row = rows[lit];
    if (!timeline || !row) return;
    timeline.style.setProperty('--y', `${row.offsetTop}px`);
    timeline.style.setProperty('--h', `${row.offsetHeight}px`);
  }
  function showStep() {
    const lead = rowStep ?? scrollStep;   // the dial turns to this one
    const step = stageStep ?? lead;       // this one is lit
    if (step !== lit && rows[step]) {
      lit = step;
      rows.forEach((row, i) => {
        if (i === step) row.setAttribute('aria-current', 'step');
        else row.removeAttribute('aria-current');
      });
      placeMarker();
      if (clockTime) clockTime.textContent = rows[step].dataset.time;
      if (clockWhat) clockWhat.textContent = rows[step].querySelector('h3').firstChild.textContent;
    }
    if (lead !== led) {
      led = lead;
      if (stage) stage.dataset.step = lead;   // scene.js starts from here if it loads later
      focusStage('clock', lead);
    }
  }
  rows.forEach((row, i) => {
    row.addEventListener('pointerenter', e => {
      if (e.pointerType === 'touch') return;   // on touch screens the scroll position leads
      rowStep = i;
      showStep();
    });
    row.addEventListener('pointerleave', () => {
      rowStep = null;
      showStep();
    });
  });

  // ----- Prizes -----
  const prizeRows = [...document.querySelectorAll('#prize-list .prize-row')];
  const prizeTotal = prizeRows.reduce((sum, row) => sum + Number(row.dataset.amount) * Number(row.dataset.teams), 0);
  if (prizeRows.length) {
    document.querySelectorAll('[data-prize-total]').forEach(el => { el.textContent = `${prizeTotal}만원`; });
    document.querySelectorAll('[data-prize-sum]').forEach(el => { el.textContent = prizeTotal; });
  }
  prizeRows.forEach((row, i) => {
    row.addEventListener('pointerenter', () => focusStage('podium', i));
    row.addEventListener('pointerleave', () => focusStage('podium', null));
  });

  // the total counts up the first time its scene comes up
  let counted = reduceMotion;
  function countUp() {
    const el = document.querySelector('[data-count]');
    if (counted || !el) return;
    counted = true;
    const began = performance.now();
    const frame = now => {
      const t = clamp((now - began) / 1400, 0, 1);
      el.textContent = Math.round(prizeTotal * (1 - Math.pow(1 - t, 4)));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  document.addEventListener('stage:hover', e => {
    const { group, index } = e.detail;
    if (group === 'clock') {
      stageStep = index;
      showStep();
    } else if (group === 'podium') {
      prizeRows.forEach((row, i) => row.classList.toggle('is-hot', i === index));
    }
  });

  // ----- Dates: D-day badges, which milestone is next, what is on right now -----
  const DAY = 86400000;
  const kstDay = ms => Math.floor((ms + 9 * 3600000) / DAY);   // calendar day in Korea
  const dday = date => {
    const left = kstDay(date.getTime()) - kstDay(Date.now());
    if (left > 0) return `D-${left}`;
    return left === 0 ? 'D-DAY' : '';
  };
  const milestones = [...document.querySelectorAll('.milestone')].map(el => {
    const badge = document.createElement('span');
    badge.className = 'dday';
    el.querySelector('.milestone-name').appendChild(badge);
    return { el, badge, name: el.dataset.milestone, date: new Date(el.querySelector('time').dateTime) };
  });
  function refreshDates() {
    const now = Date.now();
    const today = kstDay(now);
    // a milestone holds through its own day: on 11.14 the hackathon is today, not done at 9 am
    const next = milestones.find(m => kstDay(m.date.getTime()) >= today);
    milestones.forEach(m => {
      m.el.classList.toggle('is-done', kstDay(m.date.getTime()) < today);
      m.el.classList.toggle('is-next', m === next);
      m.badge.textContent = m === next ? dday(m.date) : '';
    });
    const deadline = milestones.find(m => m.name === 'apply');
    if (deadline) document.querySelectorAll('[data-dday]').forEach(el => { el.textContent = dday(deadline.date); });

    // on the day itself, tag the session that is running
    rows.forEach(row => { const tag = row.querySelector('.tl-live'); if (tag) tag.remove(); });
    const start = milestones.find(m => m.name === 'start');
    if (!start || !rows.length || kstDay(start.date.getTime()) !== kstDay(now)) return;
    const clock = new Date(now + 9 * 3600000);
    const minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
    if (minute < startsAt[0] || minute >= startsAt[startsAt.length - 1] + 60) return;
    const tag = document.createElement('span');
    tag.className = 'tl-live';
    tag.textContent = '진행 중';
    rows[startsAt.filter(at => at <= minute).length - 1].querySelector('h3').appendChild(tag);
  }
  refreshDates();
  setInterval(refreshDates, 60000);

  // ----- Scroll: progress, current scene, schedule step -----
  let pinned = false;
  let current = '';
  let ticking = false;
  function update() {
    ticking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    const max = root.scrollHeight - vh;
    if (topbar) {
      topbar.style.setProperty('--p', max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0);
      topbar.classList.toggle('is-scrolled', y > 8);
    }

    // the readable area starts under the top bar
    const shade = topbar ? topbar.offsetHeight : 0;
    const line = shade + (vh - shade) * 0.45;

    let scene = scenes[0];
    scenes.forEach(el => { if (el.getBoundingClientRect().top <= line) scene = el; });
    if (scene && scene.id !== current) {
      current = scene.id;
      document.body.dataset.sceneNow = current;
      tabs.forEach(tab => {
        if (tab.getAttribute('href') === `#${current}`) tab.setAttribute('aria-current', 'true');
        else tab.removeAttribute('aria-current');
      });
      if (current === 'prizes') countUp();
    }

    if (!rows.length) return;
    if (pinned) {
      // the schedule holds still: the distance scrolled through it picks the row
      const box = schedule.getBoundingClientRect();
      const travel = box.height - vh;
      scrollStep = travel > 1 ? Math.round(clamp(-box.top / travel, 0, 1) * (rows.length - 1)) : 0;
    } else {
      // the schedule scrolls by: the row nearest the middle of the readable area leads
      let gap = Infinity;
      rows.forEach((row, i) => {
        const box = row.getBoundingClientRect();
        const away = Math.abs((box.top + box.bottom) / 2 - line);
        if (away < gap) {
          gap = away;
          scrollStep = i;
        }
      });
    }
    showStep();
  }
  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }
  function layout() {
    pinned = !!pin && getComputedStyle(pin).position === 'sticky';
    placeMarker();
    requestUpdate();
  }
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', layout);
  // the rows change height once the fonts are in
  if (document.fonts) document.fonts.ready.then(layout);
  layout();
  update();

  // ----- Small screens: the apply button docks to the bottom while neither large one is in sight -----
  const ways = [document.getElementById('apply'), document.getElementById('footer')].filter(Boolean);
  if (ways.length && 'IntersectionObserver' in window) {
    const inSight = new Map(ways.map(el => [el, true]));
    // under the top bar counts as out of sight
    const watch = new IntersectionObserver(entries => {
      entries.forEach(entry => inSight.set(entry.target, entry.isIntersecting));
      document.body.classList.toggle('is-docked', ![...inSight.values()].some(Boolean));
    }, { rootMargin: `-${topbar ? topbar.offsetHeight : 0}px 0px 0px 0px` });
    ways.forEach(el => watch.observe(el));
  }

  // ----- Reveals: each block of a chapter rises in the first time it scrolls into view (see style.css) -----
  if (!reduceMotion && 'IntersectionObserver' in window) {
    scenes.forEach(scene => {
      if (scene.classList.contains('hero')) return;   // the intro has its own entrance
      [...scene.querySelectorAll('.scene-body > *')].forEach((el, i) => {
        el.setAttribute('data-reveal', '');
        el.style.setProperty('--i', i);
      });
    });
    root.classList.add('reveal-on');
    const reveal = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        reveal.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('[data-reveal]').forEach(el => reveal.observe(el));
  }
})();
