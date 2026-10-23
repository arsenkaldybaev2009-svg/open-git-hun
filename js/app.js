/* Сцена, камера, выбор деталей и интерфейс. */
(function () {
  'use strict';
  const T = THREE, E = V12, INFO = window.INFO;
  const { MM, G, BANKS, STROKES } = E;
  const DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);
  const nf = (x, d) => x.toLocaleString('ru-RU', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const sig2 = (x) => x.toLocaleString('ru-RU', { maximumSignificantDigits: 2 });
  const disp = (id) => BANKS[id[0]].name + id.slice(1); // 'A3' → 'А3'
  const STROKE_COLORS = ['#ff8a2a', '#8b909a', '#4aa8ff', '#b5e3ff'];
  const TDC_S = G.r + G.l;

  // ---------- рендерер ----------
  const canvas = $('scene');
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    const fb = $('fallback');
    fb.hidden = false;
    fb.textContent = 'Не удалось запустить WebGL. Откройте страницу в современном браузере с включённым аппаратным ускорением.';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 0.5, 400);

  // окружение для бликов на металле: тёмная «студия» с несколькими софтбоксами
  (function setupEnvironment() {
    const env = new T.Scene();
    env.add(new T.Mesh(new T.BoxGeometry(34, 22, 34), new T.MeshBasicMaterial({ color: 0x1b2231, side: T.BackSide })));
    const panel = (w, h, pos, rot, k, color) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(k), side: T.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]);
      m.rotation.set(rot[0], rot[1], rot[2]);
      env.add(m);
    };
    panel(16, 12, [0, 10.5, 0], [Math.PI / 2, 0, 0], 7, 0xffffff);
    panel(10, 8, [-16.5, 3, 2], [0, Math.PI / 2, 0], 4, 0xcfe0ff);
    panel(10, 8, [16.5, 2, 5], [0, -Math.PI / 2, 0], 5, 0xffe3c4);
    panel(14, 6, [0, 1, -16.5], [0, 0, 0], 3, 0xffffff);
    panel(14, 5, [0, 1, 16.5], [0, Math.PI, 0], 2.5, 0xd8e6ff);
    const pmrem = new T.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.03).texture;
    pmrem.dispose();
  })();

  scene.add(new T.HemisphereLight(0xbcd0ff, 0x1a1410, 0.45));
  const key = new T.DirectionalLight(0xffffff, 1.7);
  key.position.set(7, 15, 11);
  scene.add(key);
  const rim = new T.DirectionalLight(0x7fa6ff, 0.9);
  rim.position.set(-12, 6, -9);
  scene.add(rim);

  // «пол»: светлое пятно, плавно уходящее в темноту, и мягкая тень под двигателем
  (function setupFloor() {
    const tex = (stops, size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      stops.forEach((s) => g.addColorStop(s[0], s[1]));
      x.fillStyle = g;
      x.fillRect(0, 0, size, size);
      const t = new T.CanvasTexture(c);
      t.encoding = T.sRGBEncoding;
      return t;
    };
    const floor = new T.Mesh(new T.PlaneGeometry(90, 90), new T.MeshBasicMaterial({
      map: tex([[0, 'rgba(70,92,130,0.55)'], [0.35, 'rgba(40,55,85,0.28)'], [1, 'rgba(20,28,45,0)']], 256), transparent: true, depthWrite: false,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.7;
    floor.renderOrder = -2;
    scene.add(floor);
    const shadow = new T.Mesh(new T.PlaneGeometry(30, 38), new T.MeshBasicMaterial({
      map: tex([[0, 'rgba(0,0,0,0.75)'], [0.55, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']], 256), transparent: true, depthWrite: false,
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -2.65;
    shadow.renderOrder = -1;
    scene.add(shadow);
    const grid = new T.GridHelper(60, 30, 0x2a3a58, 0x1c2638);
    grid.position.y = -2.69;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.material.depthWrite = false;
    grid.renderOrder = -1;
    scene.add(grid);
  })();

  const engine = E.createEngine();
  scene.add(engine.root);

  // ---------- состояние ----------
  const info = $('info');
  const state = { theta: 0, rpm: 3000, scale: 0.02, playing: true, glass: 0.3, sel: null, hover: null };
  const glassFactor = () => state.glass * 0.5;

  // ---------- камера ----------
  const cam = { target: new T.Vector3(0, 2.3, 0), az: 38, el: 20, radius: 30 };
  const goal = { target: new T.Vector3(0, 2.3, 0), az: 38, el: 20, radius: 30 };
  const angDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;
  let dragging = false;
  const WIDE = ['crank', 'flywheel', 'block', 'head', 'cam'];
  // на узких (портретных) экранах камера отодвигается, чтобы деталь влезала по ширине
  const fit = (sel) => Math.max(1, (!sel || WIDE.indexOf(sel.part) >= 0 ? 0.98 : 0.7) / camera.aspect);

  function flyTo(sel) {
    const f = engine.focusFor(sel);
    goal.target.copy(f.target);
    goal.radius = f.radius * fit(sel);
    goal.el = f.el;
    goal.az = cam.az + angDiff(f.az, cam.az);
  }
  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * (dragging ? 22 : 5.5));
    cam.target.lerp(goal.target, k);
    cam.az += (goal.az - cam.az) * k;
    cam.el += (goal.el - cam.el) * k;
    cam.radius += (goal.radius - cam.radius) * k;
    const az = cam.az * DEG, el = cam.el * DEG;
    camera.position.set(
      cam.target.x + cam.radius * Math.cos(el) * Math.sin(az),
      cam.target.y + cam.radius * Math.sin(el),
      cam.target.z + cam.radius * Math.cos(el) * Math.cos(az));
    camera.lookAt(cam.target);
  }

  // Свободная область между панелями: двигатель центрируем в ней сдвигом окна проекции.
  const view = { x: 0, y: 0, tx: 0, ty: 0, dirty: true };
  function layoutTargets() {
    const w = window.innerWidth, h = window.innerHeight;
    const dockTop = $('dock').getBoundingClientRect().top;
    let left = 0, right = w, top = 52;
    if (w > 860) {
      left = $('cylmap').getBoundingClientRect().right;
      right = $('info').getBoundingClientRect().left;
    } else if (!info.classList.contains('overview')) top = info.getBoundingClientRect().bottom;
    view.tx = Math.round(w / 2 - (left + right) / 2);
    view.ty = Math.round(h / 2 - (top + dockTop) / 2);
    view.dirty = false;
  }
  function applyView(snap, dt) {
    if (view.dirty) { document.documentElement.style.setProperty('--dock-h', $('dock').offsetHeight + 'px'); layoutTargets(); }
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    const nx = view.x + (view.tx - view.x) * k, ny = view.y + (view.ty - view.y) * k;
    if (!snap && Math.abs(nx - view.x) < 0.05 && Math.abs(ny - view.y) < 0.05) return;
    view.x = nx; view.y = ny;
    camera.setViewOffset(window.innerWidth, window.innerHeight, view.x, view.y, window.innerWidth, window.innerHeight);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    view.dirty = true;
    applyView(true);
  }
  window.addEventListener('resize', () => { resize(); if (!state.sel) flyTo(null); });

  // ---------- мышь и касания ----------
  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bestClass = 9;
    for (const h of ray.intersectObjects(engine.pickables, false)) { // от ближних к дальним
      const e = h.object.userData.entry;
      if (e.kind === 'glass' && glassFactor() < 0.01) continue;
      // приоритет: яркие детали, затем приглушённые, затем прозрачный корпус, затем «призраки»
      const cls = e.kind === 'glass' ? 2 : e.fade > 0.9 ? 0 : e.fade > 0.2 ? 1 : 3;
      if (cls < bestClass) { bestClass = cls; best = e; }
    }
    return best;
  }

  const pointers = new Map();
  let drag = null, pinch = null, hintHidden = false;
  const hideHint = () => { if (!hintHidden) { hintHidden = true; $('hint').classList.add('gone'); } };
  setTimeout(hideHint, 14000);

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1) {
      drag = { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, t0: performance.now(), moved: false, pan: ev.button === 2 || ev.shiftKey };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: goal.radius };
      if (drag) drag.moved = true;
    }
    dragging = true;
  });
  canvas.addEventListener('pointermove', (ev) => {
    const p = pointers.get(ev.pointerId);
    if (!p) { hoverAt(ev.clientX, ev.clientY); return; }
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX; p.y = ev.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      goal.radius = clampR(pinch.r * (pinch.d / Math.max(d, 1)));
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 5) drag.moved = true;
    if (!drag.moved) return;
    hideHint();
    setHover(null);
    if (drag.pan) {
      const s = goal.radius * 0.0016;
      const m = camera.matrixWorld.elements;
      goal.target.x += (-m[0] * dx + m[4] * dy) * s;
      goal.target.y += (-m[1] * dx + m[5] * dy) * s;
      goal.target.z += (-m[2] * dx + m[6] * dy) * s;
    } else {
      goal.az -= dx * 0.3;
      goal.el = Math.max(-8, Math.min(88, goal.el + dy * 0.3));
    }
  });
  const endPointer = (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      dragging = false;
      if (drag && !drag.moved && ev.type === 'pointerup' && performance.now() - drag.t0 < 600) {
        const e = pick(ev.clientX, ev.clientY);
        select(e);
        if (!e) setHover(null);
      }
      drag = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) setHover(null); });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('dblclick', () => { state.sel && select(null); flyTo(null); });
  const clampR = (r) => Math.max(3, Math.min(75, r));
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    hideHint();
    goal.radius = clampR(goal.radius * Math.exp(ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0012)));
  }, { passive: false });

  // подсветка и подпись при наведении
  let hoverQueued = null;
  function hoverAt(x, y) {
    if (hoverQueued) { hoverQueued.x = x; hoverQueued.y = y; return; }
    hoverQueued = { x, y };
    requestAnimationFrame(() => {
      const q = hoverQueued;
      hoverQueued = null;
      if (dragging) return;
      const e = pick(q.x, q.y);
      setHover(e, q.x, q.y);
    });
  }
  const tip = $('tip');
  function setHover(e, x, y) {
    const g = e ? e.group : null;
    if (g !== state.hover) { state.hover = g; engine.setHover(g); }
    canvas.style.cursor = e ? 'pointer' : '';
    if (e) {
      tip.hidden = false;
      tip.textContent = e.label || INFO[e.part].title;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    } else tip.hidden = true;
  }

  // ---------- выбор детали ----------
  function select(e) {
    hideHint();
    if (e && state.sel && state.sel.group === e.group) return;
    state.sel = e ? { part: e.part, group: e.group, unit: e.unit, bank: e.bank, shaft: e.shaft, label: e.label } : null;
    engine.setFocus(state.sel);
    if (state.sel) flyTo(state.sel);
    renderInfo();
    document.querySelectorAll('.cm-cell').forEach((c) => c.classList.toggle('sel', !!state.sel && state.sel.unit === c.dataset.id));
    $('hint').classList.toggle('has-sel', !!state.sel);
  }
  $('btnHome').addEventListener('click', () => { select(null); flyTo(null); });

  // ---------- время и двигатель ----------
  const speedEl = $('speed'), rpmEl = $('rpm'), angleEl = $('angle'), glassEl = $('glass');
  const scaleFromSlider = (v) => Math.pow(10, -3 + (3 * v) / 1000);
  const sliderFromScale = (s) => ((Math.log10(s) + 3) / 3) * 1000;

  const ICON_PAUSE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.6" height="12" rx="1" fill="currentColor"/><rect x="8.4" y="1" width="3.6" height="12" rx="1" fill="currentColor"/></svg>';
  const ICON_PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.4v11.2L12.4 7z" fill="currentColor"/></svg>';
  function setPlaying(p) {
    state.playing = p;
    const b = $('btnPlay');
    b.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
    b.setAttribute('aria-label', p ? 'Пауза' : 'Продолжить');
    refreshSpeedLabels();
  }
  function setScale(s) {
    state.scale = Math.max(0.001, Math.min(1, s));
    speedEl.value = sliderFromScale(state.scale);
    if (!state.playing) setPlaying(true);
    refreshSpeedLabels();
  }
  function refreshSpeedLabels() {
    const s = state.scale;
    $('speedVal').textContent = !state.playing ? 'пауза' : s >= 0.995 ? '×1 — реальное' : `×${sig2(s)} · в ${sig2(1 / s)} раз медленнее`;
    $('rpmVal').textContent = `${nf(state.rpm)} об/мин`;
    document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', state.playing && Math.abs(Math.log10(+b.dataset.s / s)) < 0.02));
    const eff = state.rpm * s;
    $('speedNote').innerHTML = !state.playing
      ? 'Пауза. Крутите «Угол цикла» или нажимайте шаги по 10° — так удобно рассматривать каждую фазу.'
      : s > 0.3
        ? 'При реальной скорости детали сливаются в мелькание — <b>замедлите время</b>.'
        : `На экране ≈ <b>${nf(eff, eff < 10 ? 1 : 0)} об/мин</b> вместо ${nf(state.rpm)}. Один полный цикл (720°) длится ${nf(120 / eff, 1)} с.`;
  }
  speedEl.value = sliderFromScale(state.scale);
  speedEl.addEventListener('input', () => { state.scale = scaleFromSlider(+speedEl.value); if (!state.playing) setPlaying(true); refreshSpeedLabels(); });
  rpmEl.addEventListener('input', () => { state.rpm = +rpmEl.value; refreshSpeedLabels(); });
  angleEl.addEventListener('input', () => { state.theta = +angleEl.value; setPlaying(false); });
  glassEl.addEventListener('input', () => { state.glass = glassEl.value / 100; engine.setGlass(glassFactor()); $('glassVal').textContent = `${glassEl.value}%`; });
  $('presets').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setScale(+b.dataset.s); });
  $('btnPlay').addEventListener('click', () => setPlaying(!state.playing));
  $('btnMore').addEventListener('click', () => {
    const open = $('dock').classList.toggle('open');
    $('btnMore').setAttribute('aria-expanded', String(open));
    view.dirty = true;
  });
  if (window.matchMedia('(pointer: coarse)').matches) $('hint').textContent = $('hint').dataset.touch;
  const step = (d) => { state.theta = E.mod(state.theta + d, 720); setPlaying(false); };
  $('btnBack').addEventListener('click', () => step(-10));
  $('btnFwd').addEventListener('click', () => step(10));
  window.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT' && ev.key.indexOf('Arrow') === 0) return;
    if (ev.key === ' ' && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); setPlaying(!state.playing); }
    else if (ev.key === 'ArrowLeft') step(-5);
    else if (ev.key === 'ArrowRight') step(5);
    else if (ev.key === 'Escape') select(null);
    else if (ev.key === 'Home' || ev.key === 'h') { select(null); flyTo(null); }
  });

  // ---------- карта тактов цилиндров ----------
  const cells = {};
  (function buildMap() {
    const grid = $('cmGrid');
    for (const b of ['A', 'B']) {
      for (let n = 1; n <= 6; n++) {
        const id = b + n;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cm-cell';
        btn.dataset.id = id;
        btn.innerHTML = `<span>${disp(id)}</span><b></b>`;
        btn.setAttribute('aria-label', `Цилиндр ${disp(id)}`);
        btn.addEventListener('click', () => select(engine.byId[id].liner));
        grid.appendChild(btn);
        cells[id] = { el: btn, label: btn.querySelector('b'), s: -1 };
      }
    }
    $('strokeLegend').innerHTML = [2, 3, 0, 1].map((i) => `<li><i style="background:${STROKE_COLORS[i]}"></i>${STROKES[i].name}</li>`).join('');
    $('cmOrder').innerHTML = `Порядок работы: <b>${engine.firingOrder.map(disp).join(' · ')}</b>. Цилиндр 1 — у передней части.`;
  })();
  const SHORT = ['Раб.', 'Вып.', 'Впуск', 'Сжат.'];
  function updateMap() {
    for (const c of engine.cylinders) {
      const cell = cells[c.id];
      if (cell.s !== c.state.stroke) {
        cell.s = c.state.stroke;
        cell.el.dataset.s = cell.s;
        cell.label.textContent = SHORT[cell.s];
      }
    }
  }

  // ---------- карточка детали ----------
  const UNIT_PARTS = ['piston', 'rod', 'cylinder', 'plug', 'valveIn', 'valveEx'];
  const FACTS = {
    engine: () => [['Рабочий объём', '6,2 л (12 × 517 см³)'], ['Цилиндр', '⌀ 85,5 × 90 мм'], ['Степень сжатия', '11 : 1'], ['Клапаны', '48 (по 4 на цилиндр, DOHC)'], ['Развал рядов', '60°']],
    piston: () => [['Диаметр', '85,5 мм'], ['Ход', '90 мм'], ['Материал', 'алюминиевый сплав'], ['Макс. давление', '≈ 65 бар']],
    rod: () => [['Длина', '162 мм между осями'], ['Материал', 'кованая сталь'], ['Сечение', 'двутавровое']],
    crank: () => [['Шатунных шеек', '6, через 120°'], ['Ход (радиус кривошипа)', '90 мм (45 мм)'], ['Главных опор', '7']],
    flywheel: () => [['Зубьев венца', '90'], ['Назначение', 'плавность, пуск, сцепление']],
    cam: () => [['Подъём кулачка', '≈ 11 мм'], ['Открыт по фазе', '≈ 240° из 720°'], ['Вращение', 'вдвое медленнее коленвала']],
    valveIn: () => [['Подъём', '≈ 11 мм'], ['Открыт', '≈ 240° из 720°'], ['На цилиндр', '2 впускных']],
    valveEx: () => [['Подъём', '≈ 11 мм'], ['Открыт', '≈ 240° из 720°'], ['На цилиндр', '2 выпускных']],
    plug: () => [['Опережение', '20° до ВМТ'], ['Зажигание', 'искровое']],
    cylinder: () => [['Диаметр × ход', '85,5 × 90 мм'], ['Объём цилиндра', '517 см³'], ['Объём камеры в ВМТ', '52 см³'], ['Степень сжатия', '11 : 1']],
    block: () => [['Конфигурация', 'V12, развал 60°'], ['Цилиндров в ряду', '6']],
    head: () => [['Клапанов в головке', '24 (по 4 на цилиндр)'], ['Распредвалов', '2 (DOHC)']],
  };

  const omega = () => (state.rpm * 2 * Math.PI) / 60;
  const barText = (c) => `${nf(c.state.pressure, c.state.pressure < 10 ? 1 : 0)} бар`;
  const velText = (c) => {
    const v = E.pistonDS(c.state.beta) * omega() * (MM / 1000);
    return `${nf(Math.abs(v), 1)} м/с ${v > 0.05 ? '↑' : v < -0.05 ? '↓' : '•'}`;
  };
  const volText = (c) => `${nf(Math.PI * 4.275 * 4.275 * c.state.gap * 4.5, 0)} см³`;
  const openText = (open) => (open ? 'открыт' : 'закрыт');
  const UNIT_LIVE = {
    piston: [['Путь от ВМТ', (c) => `${nf((TDC_S - c.state.s) * MM)} мм`], ['Скорость (реальная)', velText], ['Давление над поршнем', barText]],
    rod: [['Наклон шатуна', (c) => `${nf(Math.abs(c.state.rodAngle) / DEG, 1)}° ${c.state.rodAngle > 0.002 ? '→' : c.state.rodAngle < -0.002 ? '←' : ''}`], ['Скорость поршня', velText], ['Давление над поршнем', barText]],
    cylinder: [['Давление', barText], ['Объём камеры', volText], ['Впускные клапаны', (c) => openText(c.state.liftIn > 0.002)], ['Выпускные клапаны', (c) => openText(c.state.liftEx > 0.002)]],
    plug: [['Искра', (c) => (c.state.spark > 0.05 ? 'есть!' : 'нет')], ['Давление в камере', barText]],
    valveIn: [['Подъём клапана', (c) => `${nf(c.state.liftIn * MM, 1)} мм`], ['Состояние', (c) => openText(c.state.liftIn > 0.002)]],
    valveEx: [['Подъём клапана', (c) => `${nf(c.state.liftEx * MM, 1)} мм`], ['Состояние', (c) => openText(c.state.liftEx > 0.002)]],
  };
  const idsWhere = (fn) => engine.cylinders.filter(fn).map((c) => disp(c.id)).join(', ') || '—';
  const GLOBAL_LIVE = {
    engine: [['Угол цикла', () => `${nf(state.theta)}° из 720°`], ['Рабочий ход идёт в', () => idsWhere((c) => c.state.stroke === 0)], ['Искра сейчас', () => idsWhere((c) => c.state.spark > 0.05)]],
    crank: [['Угол вала', () => `${nf(state.theta % 360)}°`], ['Обороты (реальные)', () => `${nf(state.rpm)} об/мин`], ['Рабочий ход идёт в', () => idsWhere((c) => c.state.stroke === 0)]],
    flywheel: [['Угол поворота', () => `${nf(state.theta % 360)}°`], ['Обороты (реальные)', () => `${nf(state.rpm)} об/мин`], ['Скорость обода', () => `${nf(omega() * 0.1134, 0)} м/с`]],
    cam: [(s) => ['Угол распредвала', () => `${nf((state.theta / 2) % 360)}°`], (s) => ['Обороты (реальные)', () => `${nf(state.rpm / 2)} об/мин`],
      (s) => ['Клапанов открыто', () => `${2 * engine.cylinders.filter((c) => c.bank === s.bank && c.state[s.shaft === 'in' ? 'liftIn' : 'liftEx'] > 0.002).length} из 12`]],
  };

  let live = [];       // обновляемые строки [элемент, функция]
  let chart = null;
  let hasUnit = false;

  function renderInfo() {
    const sel = state.sel;
    const part = sel ? sel.part : 'engine';
    const d = INFO[part];
    const unitCyl = sel && sel.unit ? engine.byId[sel.unit] : null;
    hasUnit = !!unitCyl;
    let rows;
    if (unitCyl) rows = UNIT_LIVE[part].map((r) => [r[0], () => r[1](unitCyl)]);
    else {
      rows = (GLOBAL_LIVE[part] || []).map((r) => (typeof r === 'function' ? r(sel) : r));
    }
    info.innerHTML = `
      ${sel ? '<button class="btn close" id="infoClose" type="button" aria-label="Закрыть (Esc)">✕</button>' : ''}
      <p class="kicker">${sel ? 'Выбрана деталь' : 'Обзор'}</p>
      <h2>${sel ? sel.label : d.title}</h2>
      <p class="lead">${d.lead}</p>
      ${unitCyl ? '<div class="now" id="now"><b id="nowStroke"></b><small id="nowText"></small></div>' : ''}
      ${rows.length ? `<dl class="live" id="live">${rows.map((r, i) => `<dt>${r[0]}</dt><dd id="lv${i}"></dd>`).join('')}</dl>` : ''}
      ${unitCyl ? `<figure class="chart">
          <canvas id="chart" role="img" aria-label="График цикла цилиндра ${disp(unitCyl.id)}: давление и подъём клапанов по углу поворота"></canvas>
          <ul class="chart-legend">
            <li><i style="border-color:#eef1f6"></i>давление, бар</li>
            <li><i style="border-color:var(--c-intake)"></i>впускной клапан</li>
            <li><i style="border-color:var(--c-exhaust)"></i>выпускной клапан</li>
          </ul>
          <div class="chart-read" id="chartRead"></div>
          <figcaption>Цикл цилиндра ${disp(unitCyl.id)}: 0° — начало впуска. Наведите курсор на график — увидите значения в любой точке.</figcaption>
        </figure>` : ''}
      ${d.paras.map((p) => `<p>${p}</p>`).join('')}
      <dl class="facts">${FACTS[part]().map((f) => `<dt>${f[0]}</dt><dd>${f[1]}</dd>`).join('')}</dl>
      ${sel ? '<button class="btn slowbtn" id="slowBtn" type="button" hidden>Замедлить время до ×0,02</button>' : ''}`;
    live = rows.map((r, i) => [document.getElementById('lv' + i), r[1]]);
    info.scrollTop = 0;
    info.classList.toggle('overview', !sel);
    view.dirty = true;
    const close = $('infoClose');
    if (close) close.addEventListener('click', () => select(null));
    const slow = $('slowBtn');
    if (slow) slow.addEventListener('click', () => setScale(0.02));
    chart = unitCyl ? makeChart($('chart'), unitCyl) : null;
    updateInfoLive();
  }

  function updateInfoLive() {
    for (const l of live) l[0].textContent = l[1]();
    if (hasUnit) {
      const c = engine.byId[state.sel.unit], k = c.state.stroke;
      $('nowStroke').innerHTML = `<span style="color:${STROKE_COLORS[k]}">●</span> ${STROKES[k].name}`;
      $('nowText').textContent = INFO.strokeNow[k];
      if (chart) chart.draw(c);
    }
    const slow = $('slowBtn');
    if (slow) slow.hidden = !(state.scale > 0.05 && state.playing);
  }

  // ---------- график цикла: давление и подъём клапанов ----------
  const PMAX = 75, LMAX = 0.25, STEPS = 360;
  const curve = { p: [], li: [], le: [] };
  for (let i = 0; i <= STEPS; i++) {
    const psi = E.mod((i * 720) / STEPS + 360, 720);
    curve.p.push(E.pressureAt(psi));
    curve.li.push(E.liftAt(psi, E.INTAKE_MID));
    curve.le.push(E.liftAt(psi, E.EXHAUST_MID));
  }
  function makeChart(cv, cyl) {
    const ctx = cv.getContext('2d');
    const pad = { l: 28, r: 8, t: 18, b: 17 };
    let hover = null, W = 0, H = 0;
    const read = $('chartRead');
    const toPhi = (psi) => E.mod(psi - 360, 720);
    const sizeIt = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    cv.addEventListener('pointermove', (ev) => {
      const r = cv.getBoundingClientRect();
      hover = Math.max(0, Math.min(720, ((ev.clientX - r.left - pad.l) / (W - pad.l - pad.r)) * 720));
      draw(cyl);
    });
    cv.addEventListener('pointerleave', () => { hover = null; draw(cyl); });
    function draw(c) {
      sizeIt();
      const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b, base = pad.t + ph;
      const X = (phi) => pad.l + (phi / 720) * pw;
      const Yp = (p) => pad.t + ph * (1 - Math.min(p, PMAX) / PMAX);
      const Yl = (l) => base - 0.3 * ph * (l / LMAX);
      ctx.clearRect(0, 0, W, H);
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      // полосы тактов: впуск, сжатие, рабочий ход, выпуск
      [2, 3, 0, 1].forEach((k, i) => {
        ctx.fillStyle = STROKE_COLORS[k] + (i % 2 ? '1c' : '2e');
        ctx.fillRect(X(i * 180), pad.t, pw / 4, ph);
        ctx.fillStyle = '#9aa6ba';
        ctx.textAlign = 'center';
        ctx.fillText(STROKES[k].short, X(i * 180 + 90), 8);
      });
      // сетка и подписи оси давления
      ctx.strokeStyle = 'rgba(160,185,225,0.16)';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#7f8a9d';
      ctx.textAlign = 'right';
      for (const v of [0, 25, 50, 75]) {
        const y = Math.round(Yp(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
        ctx.fillText(String(v), pad.l - 4, y);
      }
      // мёртвые точки
      ctx.textAlign = 'center';
      ['ВМТ', 'НМТ', 'ВМТ', 'НМТ', 'ВМТ'].forEach((t, i) => {
        const x = X(i * 180);
        ctx.fillText(t, Math.max(pad.l + 8, Math.min(W - pad.r - 8, x)), H - 7);
      });
      // подъёмы клапанов (заливка + контур)
      const area = (arr, color) => {
        ctx.beginPath(); ctx.moveTo(X(0), base);
        for (let i = 0; i <= STEPS; i++) ctx.lineTo(X((i * 720) / STEPS), Yl(arr[i]));
        ctx.lineTo(X(720), base); ctx.closePath();
        ctx.fillStyle = color + '55'; ctx.fill();
        ctx.beginPath();
        for (let i = 0; i <= STEPS; i++) ctx[i ? 'lineTo' : 'moveTo'](X((i * 720) / STEPS), Yl(arr[i]));
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
      };
      area(curve.li, '#3987e5');
      area(curve.le, '#d95926');
      // давление
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) ctx[i ? 'lineTo' : 'moveTo'](X((i * 720) / STEPS), Yp(curve.p[i]));
      ctx.strokeStyle = '#eef1f6'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      // курсор: текущее положение или точка под указателем
      const phi = hover !== null ? hover : toPhi(c.state.psi);
      const psi = E.mod(phi + 360, 720);
      const p = E.pressureAt(psi), li = E.liftAt(psi, E.INTAKE_MID), le = E.liftAt(psi, E.EXHAUST_MID);
      ctx.strokeStyle = hover !== null ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(X(phi)) + 0.5, pad.t); ctx.lineTo(Math.round(X(phi)) + 0.5, base); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(phi), Yp(p), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#eef1f6'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#11161f'; ctx.stroke();
      read.innerHTML = `${hover !== null ? 'курсор' : 'сейчас'} <b>${nf(phi)}°</b> · давление <b>${nf(p, p < 10 ? 1 : 0)} бар</b> · впуск <b>${nf(li * MM, 1)} мм</b> · выпуск <b>${nf(le * MM, 1)} мм</b>`;
    }
    return { draw };
  }

  // ---------- главный цикл ----------
  let last = performance.now(), uiAcc = 0, mapAcc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.playing) state.theta = E.mod(state.theta + state.rpm * 6 * dt * state.scale, 720);
    engine.update(state.theta);
    engine.animate(dt);
    updateCamera(dt);
    applyView(false, dt);
    uiAcc += dt; mapAcc += dt;
    if (uiAcc > 0.05) {
      uiAcc = 0;
      updateInfoLive();
      if (document.activeElement !== angleEl) angleEl.value = Math.round(state.theta);
      $('angleVal').textContent = `${nf(Math.round(state.theta))}° / 720°`;
    }
    if (mapAcc > 0.1) { mapAcc = 0; updateMap(); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ---------- старт ----------
  resize();
  flyTo(null);
  cam.target.copy(goal.target); cam.az = goal.az; cam.el = goal.el; cam.radius = goal.radius * 1.35; // небольшой «подлёт» при загрузке
  glassEl.value = state.glass * 100;
  engine.setGlass(glassFactor());
  $('glassVal').textContent = `${glassEl.value}%`;
  setPlaying(true);
  renderInfo();
  updateMap();
  requestAnimationFrame((t) => { last = t; frame(t); });

  // для отладки и автотестов
  window.__v12 = { state, engine, select, setPlaying, setScale, camera, cam, goal, pick, renderer, THREE: T };
})();
