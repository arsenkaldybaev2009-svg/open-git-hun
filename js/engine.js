/* V12: 3D-модель двигателя — геометрия, кинематика и состояние тактов.
 * Единица сцены = 45 мм. Ось коленвала — Z (перед двигателя — +Z), ряды цилиндров
 * наклонены на ±30° от вертикали (развал 60°). Коленвал вращается по часовой стрелке
 * (если смотреть спереди). Угол цикла theta — 0…720° (два оборота коленвала). */
(function (global) {
  'use strict';
  const T = global.THREE;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false; // цвета из hex считаем как sRGB (до создания любых Color)
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const mod = (a, n) => ((a % n) + n) % n;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  const MM = 45; // мм в одной единице сцены

  const G = {
    r: 1.0, l: 3.6, // радиус кривошипа (ход 90 мм) и длина шатуна
    pistonR: 0.915, linerR: 0.96, gasR: 0.93, // диаметр цилиндра 85,5 мм
    pitch: 2.4, stagger: 0.25, // шаг цилиндров и смещение рядов на общей шейке
    yHead: 5.4, yDeck: 5.85, yCover: 7.95, yLinerBot: 1.3,
    crown: 0.6, skirt: 0.65, // днище над пальцем / юбка под пальцем
    camX: 0.55, camY: 6.95, rb: 0.34, cc: 0.5, rn: 0.09, // кулачок: базовый круг, смещение и радиус носика
    valveX: 0.55, valveZ: 0.33, springRest: 0.53,
    bankLen: 14.9,
  };
  // Колена вала для цилиндров 1…6 (от передней части): три плоскости через 120°
  const PIN_OFF = [0, 120, 240, 240, 120, 0];
  const BANKS = {
    A: { axis: -30, inner: 1, name: 'А' },
    B: { axis: 30, inner: -1, name: 'Б' },
  };
  const INTAKE_MID = 450; // середина открытия впускного клапана в цикле цилиндра (0 = вспышка в ВМТ)
  const EXHAUST_MID = 270;
  const STROKES = [
    { key: 'power', name: 'Рабочий ход', short: 'Раб' },
    { key: 'exhaust', name: 'Выпуск', short: 'Вып' },
    { key: 'intake', name: 'Впуск', short: 'Впуск' },
    { key: 'compression', name: 'Сжатие', short: 'Сжат' },
  ];

  const zThrow = (n) => (2.5 - n) * G.pitch;
  const zCyl = (b, n) => zThrow(n) + (b === 'A' ? -G.stagger : G.stagger);

  // ---------- физика цикла (зависит только от угла цикла цилиндра psi) ----------
  const pistonS = (beta) => G.r * Math.cos(beta) + Math.sqrt(G.l * G.l - G.r * G.r * Math.sin(beta) ** 2);
  // dS/dβ — скорость поршня в единицах сцены на радиан поворота вала
  const pistonDS = (beta) => {
    const sb = Math.sin(beta), cb = Math.cos(beta);
    return -G.r * sb - (G.r * G.r * sb * cb) / Math.sqrt(G.l * G.l - G.r * G.r * sb * sb);
  };
  const liftAt = (psi, mid) => {
    const d = mod(psi - mid + 360, 720) - 360; // угол от середины подъёма, в градусах вала
    const h = Math.max(G.rb, G.cc * Math.cos((Math.abs(d) / 2) * DEG) + G.rn);
    return h - G.rb; // подъём клапана = выступ кулачка над базовым кругом
  };
  const gapAt = (psi) => G.yHead - (pistonS(psi * DEG) + G.crown); // высота камеры сгорания
  const VMAX = gapAt(180);
  const comp = (psi) => 0.9 * Math.pow(VMAX / gapAt(psi), 1.34);
  const burn = (a) => {
    const u = (a + 20) / 60; // сгорание начинается за 20° до ВМТ и длится ~60°
    return u <= 0 ? 0 : 1 - Math.exp(-5 * Math.pow(Math.min(u, 1.2), 3));
  };
  /** Давление в цилиндре, бар (упрощённая модель). */
  function pressureAt(psi) {
    psi = mod(psi, 720);
    if (psi >= 700 || psi < 150) return comp(psi) * (1 + 4.2 * burn(psi >= 700 ? psi - 720 : psi));
    if (psi < 360) return 1.1 + (comp(150) * 5.2 - 1.1) * Math.exp(-(psi - 150) / 9);
    if (psi < 570) return 0.9 + 0.2 * Math.exp(-(psi - 360) / 10);
    return comp(psi);
  }

  const GAS_KEYS = [
    [0, 0xfff0b8, 0.95], [25, 0xffb347, 0.85], [90, 0xff7a1f, 0.6], [180, 0xd8501a, 0.42],
    [215, 0x9c5a40, 0.32], [300, 0x8e9199, 0.22], [358, 0x9a9ea6, 0.16], [376, 0x6fc2ff, 0.24],
    [540, 0x59b8ff, 0.3], [640, 0x8fd2ff, 0.42], [698, 0xc4ebff, 0.55], [712, 0xfff7d0, 0.8],
    [720, 0xfff0b8, 0.95],
  ].map((k) => ({ psi: k[0], c: new T.Color(k[1]), a: k[2] }));
  function gasAt(psi, out) {
    let i = 0;
    while (i < GAS_KEYS.length - 2 && psi >= GAS_KEYS[i + 1].psi) i++;
    const a = GAS_KEYS[i], b = GAS_KEYS[i + 1];
    const t = clamp((psi - a.psi) / (b.psi - a.psi), 0, 1);
    out.color.copy(a.c).lerp(b.c, t);
    out.alpha = lerp(a.a, b.a, t);
    return out;
  }

  // ---------- геометрические помощники ----------
  const _m = new T.Matrix4(), _e = new T.Euler(), _q = new T.Quaternion(), _v = new T.Vector3(), _s1 = new T.Vector3(1, 1, 1);
  /** Сдвиг/поворот геометрии: сначала поворот вокруг начала координат, потом перенос. */
  function at(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    g.applyMatrix4(_m.compose(_v.set(x, y, z), _q, _s1));
    return g;
  }
  const cylZ = (r, h, seg, x, y, z) => at(new T.CylinderGeometry(r, r, h, seg), x, y, z, Math.PI / 2);

  /** Склеивает геометрии в одну (позиции, нормали и необязательные цвета вершин). */
  function merge(items) {
    const pos = [], nor = [], col = [];
    const useColor = items.some((i) => i.c !== undefined);
    for (const it of items) {
      const g = it.g.index ? it.g.toNonIndexed() : it.g;
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
      if (useColor) {
        const c = new T.Color(it.c === undefined ? 0xffffff : it.c);
        for (let i = 0; i < p.length / 3; i++) col.push(c.r, c.g, c.b);
      }
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    if (useColor) out.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    return out;
  }

  function hull(pts) { // выпуклая оболочка (Эндрю), против часовой стрелки
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
      up.push(p);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function circlePts(cx, cy, r, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push([cx + Math.cos((i / n) * TAU) * r, cy + Math.sin((i / n) * TAU) * r]);
    return out;
  }
  function shapeFrom(pts) {
    const s = new T.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return s;
  }
  function hole(shape, cx, cy, r) {
    const p = new T.Path();
    p.absarc(cx, cy, r, 0, TAU, true);
    shape.holes.push(p);
  }
  /** Выдавливание контура вдоль Z (по центру) со скошенными кромками, не увеличивающими габарит. */
  function extrude(shape, depth, bevel) {
    bevel = bevel === undefined ? 0.02 : bevel;
    const g = new T.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 28, bevelEnabled: bevel > 0,
      bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }
  function gearShape(rIn, rOut, teeth, holes) {
    const pts = [], step = TAU / teeth;
    for (let i = 0; i < teeth; i++) {
      for (const [f, r] of [[0, rIn], [0.12, rOut], [0.38, rOut], [0.5, rIn]]) {
        pts.push([Math.cos((i + f) * step) * r, Math.sin((i + f) * step) * r]);
      }
    }
    const s = shapeFrom(pts);
    (holes || []).forEach((h) => hole(s, h[0], h[1], h[2]));
    return s;
  }

  // ---------- геометрия деталей ----------
  function buildCrank() {
    const items = [];
    items.push({ g: cylZ(0.55, 15.7, 40, 0, 0, 0), c: 0xb9bec7 });
    for (let k = 0; k <= 6; k++) items.push({ g: cylZ(0.62, 0.7, 40, 0, 0, (k - 3) * G.pitch), c: 0xeceff4 });
    const web = hull([].concat(
      circlePts(0, 0, 0.8, 48), circlePts(0, G.r, 0.62, 32),
      Array.from({ length: 17 }, (_, i) => {
        const f = (-58 + (i * 116) / 16) * DEG; // противовес — на стороне, противоположной шейке
        return [Math.sin(f) * 1.55, -Math.cos(f) * 1.55];
      })
    ));
    const webShape = shapeFrom(web);
    for (let n = 0; n < 6; n++) {
      const z = zThrow(n), a = -PIN_OFF[n] * DEG;
      items.push({ g: at(cylZ(0.45, 1.0, 40, 0, G.r, z), 0, 0, 0, 0, 0, a), c: 0xf2f4f8 });
      for (const dz of [-0.65, 0.65]) items.push({ g: at(extrude(webShape, 0.3, 0.02), 0, 0, z + dz, 0, 0, a), c: 0x858b95 });
    }
    // демпфер на носке вала с меткой
    items.push({ g: cylZ(1.15, 0.5, 56, 0, 0, 7.85), c: 0x5b616b });
    items.push({ g: new T.BoxGeometry(0.13, 0.5, 0.04).translate(0, 0.85, 8.12), c: 0xffffff });
    items.push({ g: cylZ(1.0, 0.5, 40, 0, 0, -7.55), c: 0x9aa0aa });
    return merge(items);
  }

  function buildFlywheel() {
    const shape = gearShape(2.38, 2.52, 90);
    for (let i = 0; i < 6; i++) hole(shape, Math.cos((30 + i * 60) * DEG) * 1.5, Math.sin((30 + i * 60) * DEG) * 1.5, 0.5);
    const items = [{ g: at(extrude(shape, 0.5, 0.03), 0, 0, -8.2), c: 0x6d737d }];
    items.push({ g: cylZ(0.95, 0.8, 40, 0, 0, -7.95), c: 0xaab0ba });
    for (let i = 0; i < 6; i++) items.push({ g: cylZ(0.09, 0.1, 12, Math.cos(i * 60 * DEG) * 0.72, Math.sin(i * 60 * DEG) * 0.72, -7.55), c: 0xe4e7ec });
    items.push({ g: new T.BoxGeometry(0.16, 0.55, 0.03).translate(0, 1.95, -7.93), c: 0xff6a2a });
    return merge(items);
  }

  function buildPiston() {
    const R = G.pistonR, top = G.crown, bot = -G.skirt, wall = 0.08, h = top - bot;
    const out = 0xdfe3ea, inn = 0xa9afb9;
    const items = [
      { g: at(new T.CylinderGeometry(R, R, h, 48, 1, true), 0, (top + bot) / 2, 0), c: out },
      { g: at(new T.CircleGeometry(R, 48), 0, top, 0, -Math.PI / 2), c: out },
      { g: at(new T.CylinderGeometry(R - wall, R - wall, h - 0.14, 40, 1, true), 0, (top - 0.14 + bot) / 2, 0), c: inn },
      { g: at(new T.CircleGeometry(R - wall, 40), 0, top - 0.14, 0, Math.PI / 2), c: inn },
      { g: at(new T.RingGeometry(R - wall, R, 48), 0, bot, 0, -Math.PI / 2), c: out },
      { g: cylZ(0.2, 1.64, 24, 0, 0, 0), c: 0xcfd4dc }, // поршневой палец
    ];
    for (const y of [top - 0.12, top - 0.26, top - 0.4]) items.push({ g: at(new T.TorusGeometry(R + 0.004, 0.032, 8, 48), 0, y, 0, Math.PI / 2), c: 0x353a42 }); // кольца
    for (const sz of [-1, 1]) items.push({ g: cylZ(0.34, 0.4, 24, 0, 0, sz * 0.63), c: inn }); // бобышки под палец
    return merge(items);
  }

  function buildRod() {
    const l = G.l, rod = 0x818a97, cap = 0x4d545e;
    const small = new T.Shape(); small.absarc(0, 0, 0.32, 0, TAU, false); hole(small, 0, 0, 0.205);
    const big = new T.Shape(); big.absarc(0, -l, 0.62, 0, TAU, false); hole(big, 0, -l, 0.46);
    const beam = shapeFrom([[-0.16, -0.2], [0.16, -0.2], [0.3, -l + 0.5], [-0.3, -l + 0.5]]);
    const lid = new T.Shape();
    lid.absarc(0, -l, 0.66, Math.PI * 1.12, Math.PI * 1.88, false);
    lid.absarc(0, -l, 0.46, Math.PI * 1.88, Math.PI * 1.12, true);
    return merge([
      { g: extrude(small, 0.42), c: rod }, { g: extrude(big, 0.42), c: rod },
      { g: extrude(beam, 0.3), c: rod }, { g: extrude(lid, 0.45), c: cap },
    ]);
  }

  function buildValve() {
    return merge([
      { g: at(new T.CylinderGeometry(0.23, 0.23, 0.04, 32), 0, 0.02, 0) },
      { g: at(new T.CylinderGeometry(0.045, 0.23, 0.2, 32), 0, 0.14, 0) },
      { g: at(new T.CylinderGeometry(0.045, 0.045, 0.74, 16), 0, 0.61, 0) },
      { g: at(new T.CylinderGeometry(0.2, 0.2, 0.04, 24), 0, 1.0, 0), c: 0x9aa0aa }, // тарелка пружины
      { g: at(new T.CylinderGeometry(0.21, 0.21, 0.19, 28), 0, 1.115, 0), c: 0x6c727c }, // толкатель-стакан
    ]);
  }

  class Helix extends T.Curve {
    constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
    getPoint(t, target) {
      const a = t * this.turns * TAU;
      return (target || new T.Vector3()).set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
    }
  }
  const buildSpring = () => new T.TubeGeometry(new Helix(0.15, G.springRest, 7), 100, 0.03, 6, false);

  function buildPlug() {
    const steel = 0x8d939c, ceramic = 0xf4efe2;
    return merge([
      { g: at(new T.CylinderGeometry(0.025, 0.025, 0.1, 10), 0, G.yHead - 0.02, 0), c: 0xd4d8de },
      { g: at(new T.CylinderGeometry(0.11, 0.11, 0.5, 20), 0, G.yHead + 0.25, 0), c: steel },
      { g: at(new T.CylinderGeometry(0.2, 0.2, 0.22, 6), 0, 6.0, 0), c: steel },
      { g: at(new T.CylinderGeometry(0.1, 0.1, 1.3, 20), 0, 6.76, 0), c: ceramic },
      { g: at(new T.TorusGeometry(0.11, 0.025, 8, 20), 0, 6.5, 0, Math.PI / 2), c: ceramic },
      { g: at(new T.TorusGeometry(0.11, 0.025, 8, 20), 0, 6.8, 0, Math.PI / 2), c: ceramic },
      { g: at(new T.TorusGeometry(0.11, 0.025, 8, 20), 0, 7.1, 0, Math.PI / 2), c: ceramic },
      { g: at(new T.CylinderGeometry(0.06, 0.06, 0.28, 12), 0, 7.54, 0), c: 0xc9ced6 },
    ]);
  }

  const lobeShape = shapeFrom(hull(circlePts(0, 0, G.rb, 72).concat(circlePts(0, G.cc, G.rn, 28))));

  // ---------- сборка двигателя ----------
  function sparkTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(190,225,255,0.95)');
    g.addColorStop(0.5, 'rgba(110,170,255,0.35)'); g.addColorStop(1, 'rgba(60,110,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  function createEngine() {
    const root = new T.Group();
    const entries = [], cylinders = [], cams = [];
    const glass = { factor: 0.16 };
    let glassDirty = true;

    const reg = (mesh, kind, info) => {
      const e = Object.assign({ mesh, kind, fade: 1, fadeTarget: 1, hl: 0, hlTarget: 0, alpha: 1 }, info);
      mesh.userData.entry = e;
      entries.push(e);
      return e;
    };
    const solidMat = (o) => new T.MeshStandardMaterial(Object.assign({ metalness: 0.85, roughness: 0.34, envMapIntensity: 1.1 }, o));
    const addSolid = (parent, geo, matOpts, pos, info) => {
      const m = new T.Mesh(geo, solidMat(matOpts));
      if (pos) m.position.set(pos[0], pos[1], pos[2]);
      parent.add(m);
      return reg(m, 'solid', info);
    };
    const addGlass = (parent, geo, pos, info, color) => {
      const m = new T.Mesh(geo, new T.MeshStandardMaterial({
        color: color || 0x7fa8d8, metalness: 0.1, roughness: 0.18, transparent: true, opacity: 0.2,
        depthWrite: false, side: info.double ? T.DoubleSide : T.FrontSide,
      }));
      m.position.set(pos[0], pos[1], pos[2]);
      m.renderOrder = 3;
      parent.add(m);
      const e = reg(m, 'glass', info);
      if (info.edges !== false) {
        const ln = new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color: 0x7db4ff, transparent: true, opacity: 0.4, depthWrite: false }));
        ln.renderOrder = 3;
        m.add(ln);
        reg(ln, 'line', { lineBase: 0.42, group: info.group });
      }
      return e;
    };

    // коленвал и маховик
    const crank = addSolid(root, buildCrank(), { color: 0xffffff, vertexColors: true, roughness: 0.28 }, null,
      { part: 'crank', group: 'crank', label: 'Коленчатый вал' }).mesh;
    const flywheel = addSolid(root, buildFlywheel(), { color: 0xffffff, vertexColors: true, roughness: 0.4 }, null,
      { part: 'flywheel', group: 'flywheel', label: 'Маховик' }).mesh;

    // картер
    addGlass(root, new T.BoxGeometry(5.2, 3.4, 15.6), [0, -0.5, 0], { part: 'block', group: 'case', label: 'Картер', base: 1 }, 0x6f93c4);

    const pistonGeo = buildPiston(), rodGeo = buildRod(), valveGeo = buildValve(), springGeo = buildSpring(), plugGeo = buildPlug();
    const gasGeo = new T.CylinderGeometry(G.gasR, G.gasR, 1, 32).translate(0, 0.5, 0);
    const linerGeo = new T.CylinderGeometry(G.linerR, G.linerR, G.yHead - G.yLinerBot, 40, 1, true);
    const lobeGeo = extrude(lobeShape, 0.3, 0.02);
    const tex = sparkTexture();
    const label = (name, b, n) => `${name} ${BANKS[b].name}${n + 1}`;

    for (const b of ['A', 'B']) {
      const B = BANKS[b];
      const bg = new T.Group();
      bg.rotation.z = -B.axis * DEG;
      root.add(bg);
      const sz = b === 'A' ? -G.stagger : G.stagger;
      const bankInfo = (part, extra) => Object.assign({ part, bank: b, group: `${part}:${b}` }, extra);
      addGlass(bg, new T.BoxGeometry(2.7, G.yHead - G.yLinerBot, G.bankLen), [0, (G.yHead + G.yLinerBot) / 2, sz],
        bankInfo('block', { label: `Блок цилиндров (ряд ${B.name})`, base: 1 }), 0x7fa0cc);
      addGlass(bg, new T.BoxGeometry(2.7, G.yDeck - G.yHead, G.bankLen), [0, (G.yDeck + G.yHead) / 2, sz],
        bankInfo('head', { label: `Головка блока (ряд ${B.name})`, base: 1.1 }), 0x8fb0d8);
      addGlass(bg, new T.BoxGeometry(2.7, G.yCover - G.yDeck, G.bankLen), [0, (G.yCover + G.yDeck) / 2, sz],
        bankInfo('head', { label: `Головка блока (ряд ${B.name})`, base: 0.5 }), 0x9bb8dc);

      // распределительные валы (DOHC): впускной у «долины» V, выпускной снаружи
      for (const t of ['in', 'ex']) {
        const items = [];
        const mid = t === 'in' ? INTAKE_MID : EXHAUST_MID;
        const zf = zCyl(b, 0), zb = zCyl(b, 5);
        items.push({ g: cylZ(0.13, zf - zb + 3.2, 20, 0, 0, (zf + zb) / 2 + 0.2), c: 0xc8a24a });
        for (let k = 0; k <= 6; k++) items.push({ g: cylZ(0.2, 0.5, 24, 0, 0, zCyl(b, 0) + G.pitch / 2 - k * G.pitch), c: 0xe4cf8c });
        const sp = gearShape(0.44, 0.52, 18, [[0.27, 0, 0.09], [-0.27, 0, 0.09], [0, 0.27, 0.09], [0, -0.27, 0.09]]);
        items.push({ g: at(extrude(sp, 0.2, 0.02), 0, 0, zf + 1.65), c: 0x8d939c });
        for (let n = 0; n < 6; n++) {
          const F = fireAngle(b, n), a0 = 180 - (F + mid) / 2;
          for (const s of [-1, 1]) items.push({ g: at(lobeGeo.clone(), 0, 0, zCyl(b, n) + s * G.valveZ, 0, 0, -a0 * DEG), c: 0xf0dc98 });
        }
        const sx = (t === 'in' ? B.inner : -B.inner) * G.camX;
        const e = addSolid(bg, merge(items), { color: 0xffffff, vertexColors: true, metalness: 0.9, roughness: 0.3 }, [sx, G.camY, 0],
          { part: 'cam', bank: b, shaft: t, group: `cam:${b}:${t}`, label: `Распредвал ${t === 'in' ? 'впускной' : 'выпускной'} (ряд ${B.name})` });
        cams.push({ mesh: e.mesh, bank: b, shaft: t });
      }

      for (let n = 0; n < 6; n++) {
        const id = `${b}${n + 1}`, zc = zCyl(b, n);
        const unit = { unit: id, bank: b, n };
        const liner = addGlass(bg, linerGeo, [0, (G.yHead + G.yLinerBot) / 2, zc],
          Object.assign({ part: 'cylinder', group: `cyl:${id}`, label: `Цилиндр ${id}`, base: 0.8, double: true, edges: false }, unit), 0x9cc2ee);
        const gas = new T.Mesh(gasGeo, new T.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.3 }));
        gas.position.set(0, 3, zc); gas.renderOrder = 1;
        bg.add(gas);
        const gasE = reg(gas, 'gas', Object.assign({ part: 'cylinder', group: `cyl:${id}` }, unit));

        const pistonE = addSolid(bg, pistonGeo, { color: 0xffffff, vertexColors: true, side: T.DoubleSide, roughness: 0.3 }, [0, 3, zc],
          Object.assign({ part: 'piston', group: `piston:${id}`, label: label('Поршень', b, n) }, unit));
        pistonE.mesh.material.metalness = 0.9;
        const rodE = addSolid(bg, rodGeo, { color: 0xffffff, vertexColors: true, roughness: 0.4 }, [0, 3, zc],
          Object.assign({ part: 'rod', group: `rod:${id}`, label: label('Шатун', b, n) }, unit));
        const plugE = addSolid(bg, plugGeo, { color: 0xffffff, vertexColors: true, metalness: 0.5, roughness: 0.4 }, [0, 0, zc],
          Object.assign({ part: 'plug', group: `plug:${id}`, label: label('Свеча зажигания', b, n) }, unit));
        const spark = new T.Sprite(new T.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
        spark.position.set(0, G.yHead - 0.06, zc);
        spark.renderOrder = 2;
        bg.add(spark);
        const sparkE = reg(spark, 'sprite', Object.assign({ part: 'plug', group: `plug:${id}` }, unit));

        const valves = [];
        for (const t of ['in', 'ex']) {
          const vx = (t === 'in' ? B.inner : -B.inner) * G.valveX;
          [-1, 1].forEach((s, i) => {
            const group = `valve:${id}:${t}:${i}`;
            const info = Object.assign({ part: t === 'in' ? 'valveIn' : 'valveEx', group, label: label(t === 'in' ? 'Впускной клапан' : 'Выпускной клапан', b, n) }, unit);
            const col = t === 'in' ? 0xa9ccf2 : 0xf0b183;
            const v = addSolid(bg, valveGeo, { color: col, vertexColors: true, roughness: 0.3 }, [vx, G.yHead, zc + s * G.valveZ], info);
            const sp = addSolid(bg, springGeo, { color: 0xe9a93c, metalness: 0.7, roughness: 0.35 }, [vx, G.yDeck, zc + s * G.valveZ], info);
            valves.push({ mesh: v.mesh, spring: sp.mesh, type: t });
          });
        }
        cylinders.push({
          id, bank: b, n, axis: B.axis, off: PIN_OFF[n], F: fireAngle(b, n), zc, bankGroup: bg,
          piston: pistonE.mesh, rod: rodE.mesh, gas, gasE, sparkE, valves, liner,
          state: { psi: 0, stroke: 0, s: 0, beta: 0, rodAngle: 0, gap: 0, liftIn: 0, liftEx: 0, spark: 0, pressure: 1 },
        });
      }
    }

    function fireAngle(b, n) { return mod(BANKS[b].axis - PIN_OFF[n], 360) + (n >= 3 ? 360 : 0); }
    const firingOrder = cylinders.slice().sort((a, b) => a.F - b.F).map((c) => c.id);
    const byId = {};
    cylinders.forEach((c) => { byId[c.id] = c; });

    const _g = { color: new T.Color(), alpha: 0 };
    let theta = 0;
    /** Ставит механизм в положение для угла цикла th (градусы, 0…720). */
    function update(th) {
      theta = th = mod(th, 720);
      const rz = -th * DEG;
      crank.rotation.z = rz;
      flywheel.rotation.z = rz;
      for (const c of cams) c.mesh.rotation.z = rz / 2; // распредвалы — вдвое медленнее
      for (const c of cylinders) {
        const psi = mod(th - c.F, 720);
        const beta = (th + c.off - c.axis) * DEG;
        const sb = Math.sin(beta);
        const s = pistonS(beta);
        const rodAngle = Math.asin((G.r * sb) / G.l);
        c.piston.position.y = s;
        c.rod.position.y = s;
        c.rod.rotation.z = rodAngle;
        const gap = G.yHead - (s + G.crown);
        c.gas.position.y = s + G.crown;
        c.gas.scale.y = gap;
        gasAt(psi, _g);
        c.gas.material.color.copy(_g.color);
        c.gasE.alpha = _g.alpha;
        const li = liftAt(psi, INTAKE_MID), le = liftAt(psi, EXHAUST_MID);
        for (const v of c.valves) {
          const L = v.type === 'in' ? li : le;
          v.mesh.position.y = G.yHead - L;
          v.spring.scale.y = (G.springRest - L) / G.springRest;
        }
        const sp = mod(psi - 700, 720); // искра за 20° до ВМТ, вспышка гаснет за ~26°
        const k = sp < 26 ? Math.pow(1 - sp / 26, 1.5) : 0;
        c.sparkE.alpha = k;
        c.sparkE.mesh.scale.setScalar(0.25 + 1.5 * k);
        const st = c.state;
        st.psi = psi; st.stroke = Math.floor(psi / 180); st.s = s; st.beta = beta; st.rodAngle = rodAngle; st.gap = gap;
        st.liftIn = li; st.liftEx = le; st.spark = k; st.pressure = pressureAt(psi);
      }
    }

    // ---------- «фокус»: приглушаем всё, кроме выбранной детали и связанных с ней ----------
    const LEVEL = [1, 0.22, 0.03];
    const UNIT_PARTS = ['piston', 'rod', 'cylinder', 'plug', 'valveIn', 'valveEx'];
    function levelOf(e, sel) {
      if (!sel) return 0;
      const P = sel.part;
      if (P === 'block' || P === 'head') return 0;
      if (UNIT_PARTS.indexOf(P) >= 0) {
        if (e.unit === sel.unit) return 0;
        return e.part === 'crank' || (e.part === 'cam' && e.bank === sel.bank) ? 1 : 2;
      }
      if (P === 'crank') return e.part === 'crank' || e.part === 'flywheel' ? 0 : e.part === 'piston' || e.part === 'rod' ? 1 : 2;
      if (P === 'flywheel') return e.part === 'flywheel' ? 0 : e.part === 'crank' ? 1 : 2;
      if (P === 'cam') {
        if (e.group === sel.group) return 0;
        const want = sel.shaft === 'in' ? 'valveIn' : 'valveEx';
        if (e.bank === sel.bank && e.part === want) return 0;
        return e.part === 'crank' ? 1 : 2;
      }
      return 0;
    }
    let selGroup = null, hoverGroup = null;
    function setFocus(sel) {
      selGroup = sel ? sel.group : null;
      for (const e of entries) e.fadeTarget = LEVEL[levelOf(e, sel)];
    }
    function setHover(group) { hoverGroup = group; }
    function setGlass(f) { glass.factor = f; glassDirty = true; }

    /** Плавное затухание/подсветка и применение прозрачности материалов (вызывать каждый кадр). */
    function animate(dt) {
      const k = 1 - Math.exp(-dt * 9);
      for (const e of entries) {
        const hlT = e.group && e.group === selGroup ? 1 : e.group && e.group === hoverGroup ? 0.55 : 0;
        const dirtyFade = Math.abs(e.fadeTarget - e.fade) > 1e-3;
        if (dirtyFade) e.fade += (e.fadeTarget - e.fade) * k; else e.fade = e.fadeTarget;
        const dirtyHl = Math.abs(hlT - e.hl) > 1e-3;
        if (dirtyHl) e.hl += (hlT - e.hl) * k; else e.hl = hlT;
        const m = e.mesh.material, f = e.fade;
        switch (e.kind) {
          case 'solid': {
            if (dirtyFade || e.first === undefined) {
              const tr = f < 0.995;
              m.opacity = f;
              if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
            }
            if (dirtyHl || e.first === undefined) m.emissive.setRGB(0.05, 0.3, 1.0).multiplyScalar(0.2 * e.hl);
            e.first = false;
            break;
          }
          case 'glass':
            if (dirtyFade || dirtyHl || glassDirty) m.opacity = Math.min(0.9, e.base * glass.factor * (0.07 + 0.93 * f) * (1 + 2.5 * e.hl));
            break;
          case 'line':
            if (dirtyFade || glassDirty) { m.opacity = e.lineBase * clamp(glass.factor / 0.16, 0, 1.4) * (0.1 + 0.9 * f); e.mesh.visible = glass.factor > 0.004; }
            break;
          case 'gas':
            m.opacity = e.alpha * (0.12 + 0.88 * f);
            break;
          case 'sprite':
            m.opacity = e.alpha * f;
            e.mesh.visible = e.alpha > 0.01 && f > 0.1;
            break;
        }
      }
      glassDirty = false;
    }

    /** Где и откуда смотреть на выбранную деталь (в мировых координатах сцены). */
    function focusFor(sel) {
      root.updateMatrixWorld(true);
      const side = (b) => (b === 'A' ? -1 : 1);
      const out = (x, y, z, radius, az, el) => ({ target: new T.Vector3(x, y, z), radius, az, el });
      if (!sel) return out(0, 2.3, 0, 30, 38, 20);
      const P = sel.part;
      if (UNIT_PARTS.indexOf(P) >= 0) {
        const c = byId[sel.unit];
        const top = P === 'plug' || P === 'valveIn' || P === 'valveEx';
        const p = c.bankGroup.localToWorld(new T.Vector3(0, top ? 6.3 : 2.9, c.zc));
        return out(p.x, p.y, p.z, top ? 7.5 : 18, side(c.bank) * (top ? 28 : 22), top ? 24 : 10);
      }
      if (P === 'crank') return out(0, 0.2, 0, 23, 28, 20);
      if (P === 'flywheel') return out(0, 0, -7.9, 11, 150, 16);
      if (P === 'cam') {
        const bg = cylinders.find((c) => c.bank === sel.bank).bankGroup;
        const x = (sel.shaft === 'in' ? BANKS[sel.bank].inner : -BANKS[sel.bank].inner) * G.camX;
        const p = bg.localToWorld(new T.Vector3(x, G.camY, 1.5));
        return out(p.x, p.y, p.z, 13, side(sel.bank) * 30, 34);
      }
      if (P === 'head' || P === 'block') {
        if (!sel.bank) return out(0, -0.3, 0, 22, 30, 24);
        const p = cylinders.find((c) => c.bank === sel.bank).bankGroup.localToWorld(new T.Vector3(0, 4.5, 0));
        return out(p.x, p.y, p.z, 24, side(sel.bank) * 36, 24);
      }
      return out(0, 2.3, 0, 30, 38, 20);
    }

    update(0);
    const pickables = entries.filter((e) => e.kind === 'solid' || e.kind === 'glass').map((e) => e.mesh);
    return {
      root, entries, cylinders, byId, cams, pickables, firingOrder,
      update, animate, setFocus, setHover, setGlass, focusFor,
      get theta() { return theta; },
    };
  }

  global.V12 = {
    createEngine, G, MM, BANKS, STROKES, PIN_OFF, INTAKE_MID, EXHAUST_MID,
    pressureAt, liftAt, gapAt, pistonS, pistonDS, mod, clamp,
  };
})(window);
