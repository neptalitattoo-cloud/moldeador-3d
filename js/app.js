import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { zipSync } from '../vendor/fflate.js?v=6';
import * as K from './core.js?v=6';
import { PARTS } from './parts.js?v=6';
import { View2D } from './view2d.js?v=6';

// ---------- entorno y utilidades ----------
const $ = id => document.getElementById(id);
const status = t => {
  $('status').textContent = t;
};
const IS_IOS =
  /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// iPhone también con «Solicitar sitio web de escritorio» (se presenta como Mac): se detecta por el tamaño de pantalla
const IS_IPHONE = /iPhone|iPod/.test(navigator.userAgent) || (IS_IOS && Math.min(screen.width, screen.height) < 500);
const NARROW = matchMedia('(max-width: 820px)');
const MAX_TEX = IS_IPHONE ? 2048 : 4096; // PNG que va al USDZ/OBJ/capas
const MAX_PREVIEW = IS_IOS ? 2048 : 4096; // visor 3D y vista 2D
const MAX_UPLOAD_PX = 8192,
  MAX_UPLOAD_MB = 50;
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbg = (k, v) => {
  if (DEBUG) window[k] = v;
}; // variables de depuración sólo con ?debug
const release = (...cs) => {
  for (const c of cs) if (c && c.width) c.width = c.height = 0;
};
const fitSize = (w, h, max) => {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
};
const tick = () => new Promise(r => setTimeout(r, 30));
const BLEED = 6; // px de sangrado alrededor de las islas UV (a 2048 px)
const SKIN = '#e3c2aa';
const PREVIEW_BG = '#b9a99c';
const TATTOO_BLUE = '#1e7fd8',
  GUIDE_PINK = '#ff3d9a';

const part = PARTS.brazo_derecho;
let base = null,
  result = null,
  resultKey = null;
let userImg = null,
  tatImg = null,
  geo = null,
  mesh = null,
  texCanvas = null,
  texture = null,
  idxMap = null;

// ---------- formulario ----------
const MEDIDA_IDS = () => [...part.largos, ...part.contornos].map(([id]) => id).concat('largo_mano', 'ancho_nudillos');
function num(id) {
  const s = String($(id).value).trim().replace(',', '.');
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}
function buildForm() {
  const sel = $('parte');
  for (const [k, p] of Object.entries(PARTS)) {
    const o = new Option(p.nombre, k);
    o.disabled = !p.activo;
    sel.add(o);
  }
  const mk = (box, list) =>
    list.forEach(([id, lab, ej]) => {
      const [lo, hi] = K.RANGOS[id] || [1, 200];
      const l = document.createElement('label');
      l.append(lab);
      const i = Object.assign(document.createElement('input'), {
        type: 'text', // con type=number Safari en iOS vacía «32,5» con teclado español
        id,
        placeholder: `ej. ${ej}`,
        autocomplete: 'off',
        title: `Entre ${lo} y ${hi} cm`,
      });
      i.dataset.min = lo;
      i.dataset.max = hi;
      i.inputMode = 'decimal';
      const h = Object.assign(document.createElement('small'), { className: 'help' });
      h.dataset.for = id;
      l.append(i, h);
      box.append(l);
    });
  mk($('largos'), part.largos);
  mk($('contornos'), part.contornos);
  for (const id of ['largo_mano', 'ancho_nudillos']) {
    const [lo, hi] = K.RANGOS[id];
    $(id).title = `Entre ${lo} y ${hi} cm (opcional)`;
  }
  document.querySelectorAll('.help').forEach(el => {
    el.textContent = (part.ayuda || {})[el.dataset.for] || '';
  });
  for (const id of Object.keys(GUIDE_NUM)) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('focus', () => {
      focusId = id;
      refreshGuides();
    });
    el.addEventListener('blur', () => {
      setTimeout(() => {
        if (focusId === id) {
          focusId = null;
          refreshGuides();
        }
      }, 150);
    });
  }
  $('addTat').onclick = () => addTat('', '', '');
  $('ejemplo').onclick = loadExample;
}
function loadExample() {
  const ej = part.ejemplo || {};
  for (const [id, , v] of [...part.largos, ...part.contornos]) $(id).value = v;
  $('largo_mano').value = ej.largo_mano ?? '';
  $('ancho_nudillos').value = ej.ancho_nudillos ?? '';
  $('cliente').value = ej.cliente || 'Ejemplo';
  $('tatuajes').replaceChildren();
  (ej.tatuajes || []).forEach(t => addTat(...t));
  paintTexture();
  refreshExportable();
  status('Ejemplo cargado. Pulsa «Moldear».');
}
function addTat(n, d, w) {
  const div = document.createElement('div');
  div.className = 'tat';
  const field = (lab, cls, val, numeric) => {
    const l = document.createElement('label');
    l.append(lab);
    const i = document.createElement('input');
    i.className = cls;
    i.value = val;
    if (numeric) {
      i.type = 'text';
      i.inputMode = 'decimal';
      i.autocomplete = 'off';
    }
    i.addEventListener('change', () => paintTexture());
    l.append(i);
    return l;
  };
  const x = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'ghost',
    textContent: '✕',
    title: 'Quitar tatuaje',
  });
  x.setAttribute('aria-label', 'Quitar tatuaje');
  x.onclick = () => {
    div.remove();
    paintTexture();
  };
  div.append(
    field('Nombre', 'tn', n, false),
    field('Desde hombro', 'td', d, true),
    field('Ancho (opc.)', 'tw', w, true),
    x,
  );
  $('tatuajes').appendChild(div);
}
function tattoos() {
  return [...document.querySelectorAll('.tat')]
    .map(d => ({
      n: d.querySelector('.tn').value.trim(),
      d: parseFloat(d.querySelector('.td').value.replace(',', '.')),
      w: parseFloat(d.querySelector('.tw').value.replace(',', '.')),
    }))
    .filter(t => Number.isFinite(t.d) && t.d > 0 && t.d < 120);
}
function readInputs() {
  const raw = {},
    labels = { largo_mano: '9. Largo mano', ancho_nudillos: '10. Ancho nudillos' };
  for (const [id, lab] of [...part.largos, ...part.contornos]) {
    raw[id] = num(id);
    labels[id] = lab;
  }
  raw.largo_mano = num('largo_mano');
  raw.ancho_nudillos = num('ancho_nudillos');
  return K.validateInputs(raw, labels);
}
const inputsKey = () =>
  MEDIDA_IDS()
    .map(id => $(id).value.trim().replace(',', '.'))
    .join('|');
const fresh = () => !!result && resultKey === inputsKey();

// ---------- capas: base (piel en la silueta UV), guías (PNG aparte), tatuaje (PNG aparte) ----------
const mkCanvas = (W, H) => {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
};
function texSize() {
  return userImg ? fitSize(userImg.naturalWidth, userImg.naturalHeight, MAX_TEX) : [2048, 2048];
} // mantiene la proporción
function previewSize() {
  const [W, H] = texSize();
  return fitSize(W, H, MAX_PREVIEW);
}
function baseLayer() {
  // piel neutra solo dentro de las islas UV (+ sangrado) y transparente fuera; o la capa base del usuario
  const [W, H] = texSize(),
    c = mkCanvas(W, H),
    g = c.getContext('2d');
  if (userImg) {
    g.drawImage(userImg, 0, 0, W, H);
    return c;
  }
  const VT = base.VT,
    FT = base.FT;
  g.beginPath();
  for (let f = 0; f < FT.length; f += 3) {
    const a = FT[f],
      b = FT[f + 1],
      d = FT[f + 2];
    g.moveTo(VT[2 * a] * W, (1 - VT[2 * a + 1]) * H);
    g.lineTo(VT[2 * b] * W, (1 - VT[2 * b + 1]) * H);
    g.lineTo(VT[2 * d] * W, (1 - VT[2 * d + 1]) * H);
    g.closePath();
  }
  g.fillStyle = g.strokeStyle = SKIN;
  g.lineJoin = 'round';
  g.lineWidth = (2 * BLEED * W) / 2048;
  g.fill();
  g.stroke();
  return c;
}
let baseCache = null,
  tatCache = null;
function getBaseLayer() {
  const [W, H] = texSize();
  if (!baseCache || baseCache.width !== W || baseCache.height !== H || baseCache.src !== userImg) {
    release(baseCache);
    baseCache = baseLayer();
    baseCache.src = userImg;
  }
  return baseCache;
}
function getTattooLayer() {
  if (!tatImg) {
    release(tatCache);
    tatCache = null;
    return null;
  }
  const [W, H] = texSize();
  if (!tatCache || tatCache.width !== W || tatCache.height !== H || tatCache.src !== tatImg) {
    release(tatCache);
    tatCache = mkCanvas(W, H);
    tatCache.getContext('2d').drawImage(tatImg, 0, 0, W, H);
    tatCache.src = tatImg;
  }
  return tatCache;
}
function guidesLayer() {
  const [W, H] = texSize(),
    c = mkCanvas(W, H);
  drawGuides(c.getContext('2d'), W, H);
  return c;
}
function resetTexture() {
  if (texture) texture.dispose();
  texture = new THREE.CanvasTexture(texCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (mesh) {
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  }
}
function paintTexture() {
  // vista previa = base + tatuaje + guías, a tamaño de vista previa
  if (!base) return;
  const [W, H] = previewSize();
  if (!texCanvas) texCanvas = mkCanvas(W, H);
  const resized = texCanvas.width !== W || texCanvas.height !== H;
  if (resized) {
    texCanvas.width = W;
    texCanvas.height = H;
  }
  const g = texCanvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = PREVIEW_BG;
  g.fillRect(0, 0, W, H); // fondo neutro solo para la vista previa
  g.drawImage(getBaseLayer(), 0, 0, W, H);
  const t = getTattooLayer();
  if (t) g.drawImage(t, 0, 0, W, H);
  if ($('verGuias').checked) drawGuides(g, W, H);
  if (texture) {
    if (resized) resetTexture();
    else texture.needsUpdate = true;
  } // three fija el tamaño: si cambia, textura nueva
  if (v2d) v2d.invalidate('tex');
  requestRender();
}
function drawGuides(g, W, H) {
  const P = result ? result.P : base.V0,
    tape = result ? result.report.tape : K.tapeFn(base, base.V0);
  const vals = [];
  for (const t of tattoos()) {
    vals.push(t.d);
    if (Number.isFinite(t.w) && t.w > 0) vals.push(t.d + t.w);
  }
  if (!vals.length) return;
  const segs = K.ringSegments(base, P, tape, vals);
  g.strokeStyle = TATTOO_BLUE;
  g.lineWidth = Math.max(2, W / 700);
  g.lineCap = 'round';
  g.beginPath();
  for (const [u1, v1, u2, v2] of segs) {
    g.moveTo(u1 * W, (1 - v1) * H);
    g.lineTo(u2 * W, (1 - v2) * H);
  }
  g.stroke();
}
const toPNG = c =>
  new Promise((ok, ko) =>
    c.toBlob(
      b =>
        b
          ? b.arrayBuffer().then(ab => ok(new Uint8Array(ab)), ko)
          : ko(new Error(`Sin memoria para un PNG de ${c.width}×${c.height}. Usa una textura más pequeña.`)),
      'image/png',
    ),
  );
async function basePNG() {
  // capa base que va dentro del USDZ/OBJ
  const src = getBaseLayer();
  if (!$('expGuias').checked) return toPNG(src);
  const [W, H] = texSize(),
    c = mkCanvas(W, H),
    g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  drawGuides(g, W, H);
  try {
    return await toPNG(c);
  } finally {
    release(c);
  }
}
const LEEME_CAPAS = `CAPAS PARA PROCREATE 3D
Procreate importa una sola "Capa base" por modelo. Por eso la piel va dentro del USDZ y el tatuaje y las guías van en PNG aparte,
con el mismo tamaño que la textura, para colocarlos como capas nuevas:
1. Abre el USDZ en Procreate (Galería > Importar).
2. Llave inglesa (Acciones) > 3D > activa "Mostrar textura 2D".
3. Capas > "+" para crear una capa nueva encima de la Capa base.
4. Acciones > Añadir > Insertar un archivo (o Insertar una foto) > elige tatuaje.png o guias.png.
5. Como el PNG mide lo mismo que la textura, debe quedar encajado 1:1. Si no, en Transformar pulsa "Ajustar a pantalla" y luego toca otra herramienta para fijarlo.
6. Desactiva "Mostrar textura 2D" para volver al 3D: la capa se ve sobre el brazo y puedes ocultarla o bajar su opacidad.

guias_medicion.png (opcional): anillos rosas donde se mide cada contorno (axila, mitad bíceps, codo, mitad antebrazo, muñeca).
`;
// ---------- visor 3D (render sólo cuando hace falta) ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
let sun = null,
  frameId = 0,
  frames = 0;
function requestRender() {
  if (!frameId && !mode2d) frameId = requestAnimationFrame(frame);
}
function frame() {
  frameId = 0;
  if (mode2d) return;
  const moving = controls.update(); // true mientras dura la inercia del amortiguado
  renderer.render(scene, camera);
  placeLabels();
  frames++;
  if (moving) requestRender();
}
function initViewer() {
  const el = $('viewer');
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  el.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.2));
  sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(60, 80, 120);
  scene.add(sun);
  renderer.setClearColor(0x000000, 0);
  controls.enableDamping = true;
  const resize = () => {
    const w = el.clientWidth,
      h = el.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!fitCamera.done) fitCamera();
    requestRender();
  };
  new ResizeObserver(resize).observe(el);
  resize();
  scene.add(guideGroup);
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => {
    if (NARROW.matches && !touchHintSeen) {
      touchHintSeen = true;
      refreshGuides();
    }
  });
  applyTouchMode();
  NARROW.addEventListener('change', applyTouchMode);
  blockMultiTouchScroll(renderer.domElement);
  dbg('__frames', () => frames);
}
// Con touch-action: pan-y el navegador podría quedarse un arrastre vertical de dos dedos como scroll;
// con dos o más dedos el gesto es siempre del modelo (inclinar, girar, zoom), nunca de la página.
function blockMultiTouchScroll(el) {
  el.addEventListener(
    'touchmove',
    e => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
}
// En el móvil: un dedo hace scroll de la página y dos dedos giran y hacen zoom.
// Se aplica DESPUÉS de crear OrbitControls, que pone touchAction='none' por su cuenta.
let touchHintSeen = false;
function applyTouchMode() {
  const narrow = NARROW.matches;
  controls.touches = narrow
    ? { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }
    : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  renderer.domElement.style.touchAction = narrow ? 'pan-y' : 'none';
  if (v2d) v2d.setTouchScroll(narrow);
  refreshGuides();
}
function fitCamera() {
  // encuadra todo el brazo (con margen para las etiquetas)
  if (!geo) return;
  geo.computeBoundingBox();
  const b = geo.boundingBox,
    c = b.getCenter(new THREE.Vector3()),
    sz = b.getSize(new THREE.Vector3());
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
    dV = sz.y / 2 / t,
    dH = Math.max(sz.x, sz.z) / 2 / (t * camera.aspect);
  const narrow = $('viewer').clientWidth < 600; // en el móvil, más margen arriba para la barra de botones
  const d = Math.max(dV, dH) * (narrow ? 1.32 : 1.18) + sz.z / 2;
  if (narrow) c.y += sz.y * 0.07;
  controls.target.copy(c);
  camera.position.set(c.x, c.y, c.z + d);
  controls.update();
  fitCamera.done = true;
  requestRender();
}
function buildMesh() {
  const F = base.F,
    FT = base.FT,
    VT = base.VT,
    map = new Map(),
    vid = [],
    tid = [],
    index = new Uint32Array(F.length);
  for (let i = 0; i < F.length; i++) {
    const k = F[i] * 1e6 + FT[i];
    let j = map.get(k);
    if (j === undefined) {
      j = vid.length;
      map.set(k, j);
      vid.push(F[i]);
      tid.push(FT[i]);
    }
    index[i] = j;
  }
  idxMap = Int32Array.from(vid);
  const n = vid.length,
    uv = new Float32Array(2 * n);
  tid.forEach((t, j) => {
    uv[2 * j] = VT[2 * t];
    uv[2 * j + 1] = VT[2 * t + 1];
  });
  geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * n), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(3 * n), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  paintTexture();
  resetTexture();
  mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 }));
  scene.add(mesh);
  updateMesh(base.V0);
  fitCamera();
}
function updateMesh(P) {
  const N = K.vertexNormals(base, P),
    pa = geo.attributes.position.array,
    na = geo.attributes.normal.array;
  idxMap.forEach((v, j) => {
    for (let c = 0; c < 3; c++) {
      pa[3 * j + c] = P[3 * v + c];
      na[3 * j + c] = N[3 * v + c];
    }
  });
  geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingSphere();
  requestRender();
}

// ---------- guías de medición (vista 3D) ----------
const GUIDE_NUM = {
  hombro_codo: 1,
  codo_muneca: 2,
  hombro_muneca: 3,
  c_axila: 4,
  c_biceps: 5,
  c_codo: 6,
  c_antebrazo: 7,
  c_muneca: 8,
  largo_mano: 9,
  ancho_nudillos: 10,
};
const GUIDE_TXT = {
  hombro_codo: 'Hombro → codo',
  codo_muneca: 'Codo → muñeca',
  hombro_muneca: 'Hombro → muñeca',
  c_axila: 'Contorno axila',
  c_biceps: 'Contorno mitad bíceps',
  c_codo: 'Contorno codo',
  c_antebrazo: 'Contorno mitad antebrazo',
  c_muneca: 'Contorno muñeca',
  largo_mano: 'Largo mano',
  ancho_nudillos: 'Ancho nudillos',
};
const COL = 0xff3d9a,
  HI = 0xffd400;
let guidesOn = false,
  focusId = null;
const guideGroup = new THREE.Group(),
  gItems = {};
const V3 = p => new THREE.Vector3(p[0], p[1], p[2]);
function tube(pts, closed, r = 0.13) {
  const c = new THREE.CatmullRomCurve3(pts.map(V3), closed, 'centripetal');
  return new THREE.TubeGeometry(c, Math.max(48, pts.length * 3), r, 6, closed);
}
function addItem(id, geoms, labelPos, overlay = false) {
  const mat = new THREE.MeshBasicMaterial({ color: COL, transparent: true, opacity: 1, depthTest: !overlay });
  const ms = geoms.map(g => {
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = overlay ? 10 : 1;
    guideGroup.add(m);
    return m;
  });
  const el = document.createElement('div');
  el.className = 'gl';
  el.textContent = GUIDE_NUM[id];
  el.title = GUIDE_TXT[id];
  $('labels').appendChild(el);
  gItems[id] = { mat, ms, el, pos: V3(labelPos), on: false };
}
function buildGuides(P) {
  for (const it of Object.values(gItems)) {
    it.ms.forEach(m => {
      guideGroup.remove(m);
      m.geometry.dispose();
    });
    it.mat.dispose();
    it.el.remove();
  }
  for (const k of Object.keys(gItems)) delete gItems[k];
  const m = base.meta,
    st = K.stationS(base, P),
    tp = st.tp;
  const mer = (lo, hi) =>
    tp.pts
      .map((p, i) => [p, tp.S[i]])
      .filter(([, s]) => s <= hi + 1e-6 && s >= lo - 1e-6)
      .map(([p, s]) => K.outward(base, P, p, s, 0.2));
  const merAt = s => {
    let j = 0,
      b = 1e9;
    tp.S.forEach((x, i) => {
      if (Math.abs(x - s) < b) {
        b = Math.abs(x - s);
        j = i;
      }
    });
    return K.outward(base, P, tp.pts[j], tp.S[j], 0.2);
  };
  const ball = (p, r = 0.55) => new THREE.SphereGeometry(r, 16, 12).translate(p[0], p[1], p[2]);
  const pTip = merAt(m.s_tip),
    pEl = merAt(m.S_EL),
    pWr = merAt(m.S_WR);
  const seg1 = mer(m.S_EL, m.s_tip),
    seg2 = mer(m.S_WR, m.S_EL);
  const mid = seg => {
    const q = seg[Math.floor(seg.length / 2)];
    return [q[0] - 4.5, q[1], q[2]];
  }; // etiqueta al lado de la línea
  addItem('hombro_codo', [tube(seg1, false), ball(pTip), ball(pEl)], mid(seg1));
  addItem('codo_muneca', [tube(seg2, false), ball(pWr)], mid(seg2));
  addItem('hombro_muneca', [], [pTip[0] + 2.2, pTip[1] + 1.2, pTip[2]]);
  for (const id of ['c_axila', 'c_biceps', 'c_codo', 'c_antebrazo', 'c_muneca']) {
    const R = K.ringLoop(base, P, st.s[id], 0.18);
    if (!R) continue;
    const q = merAt(st.s[id]);
    let best = R.pts[0],
      bd = 1e9;
    for (const r of R.pts) {
      const d = Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    addItem(id, [tube(R.pts, true)], best);
  }
  let hg = null;
  try {
    hg = K.handGuides(base, P);
  } catch (e) {
    console.warn(e);
  }
  if (hg) {
    addItem('largo_mano', [tube([hg.wc, hg.tip], false, 0.1), ball(hg.wc, 0.4), ball(hg.tip, 0.4)], hg.tip, true);
    addItem('ancho_nudillos', [tube(hg.ring, true)], hg.ring[0]);
  }
  refreshGuides();
}
const members = id => (id === 'hombro_muneca' ? ['hombro_codo', 'codo_muneca', 'hombro_muneca'] : [id]);
function refreshGuides() {
  const act = focusId ? members(focusId) : [];
  guideGroup.visible = guidesOn || !!focusId;
  for (const [id, it] of Object.entries(gItems)) {
    const on = act.includes(id),
      vis = guidesOn || on;
    it.ms.forEach(m => {
      m.visible = vis;
    });
    it.mat.color.setHex(on ? HI : COL);
    it.mat.opacity = focusId && !on ? 0.35 : 1;
    it.el.hidden = !vis;
    it.el.className = 'gl' + (on ? ' on' : focusId ? ' dim' : '');
    it.on = on;
  }
  const b = $('btnGuias');
  b.setAttribute('aria-pressed', guidesOn);
  b.textContent = guidesOn ? '📏 Ocultar guías de medición' : '📏 Mostrar guías de medición';
  const info = $('guiaInfo');
  if (focusId) {
    info.hidden = false;
    const strong = document.createElement('b');
    strong.textContent = `${GUIDE_NUM[focusId]}. ${GUIDE_TXT[focusId]}`;
    info.replaceChildren(strong, ` — ${(part.ayuda || {})[focusId] || ''}`);
  } else if (guidesOn && !mode2d) {
    info.hidden = false;
    info.textContent = 'Los números coinciden con los campos de la ficha. Toca un campo para resaltar dónde se mide.';
  } else if (NARROW.matches && !touchHintSeen && base) {
    info.hidden = false;
    info.textContent = mode2d
      ? '✌️ Usa dos dedos para mover y hacer zoom; con un dedo bajas por la página.'
      : '✌️ Usa dos dedos para girar y hacer zoom; con un dedo bajas por la página.';
  } else info.hidden = true;
  if (v2d) v2d.invalidate('guides');
  requestRender();
}
const _v = new THREE.Vector3();
function placeLabels() {
  // sólo transform: no fuerza recalcular el layout
  if (!guideGroup.visible) return;
  const el = $('viewer'),
    w = el.clientWidth,
    h = el.clientHeight;
  for (const it of Object.values(gItems)) {
    if (it.el.hidden) continue;
    _v.copy(it.pos).project(camera);
    it.el.style.visibility = _v.z > 1 ? 'hidden' : 'visible';
    const x = Math.min(w - 14, Math.max(14, ((_v.x + 1) / 2) * w)),
      y = Math.min(h - 14, Math.max(14, ((1 - _v.y) / 2) * h));
    it.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)${it.on ? ' scale(1.25)' : ''}`;
  }
}
function measurementLayer() {
  // anillos de medición en la textura (capa PNG aparte)
  const [W, H] = texSize(),
    c = mkCanvas(W, H),
    g = c.getContext('2d'),
    P = result ? result.P : base.V0,
    st = K.stationS(base, P);
  const segs = K.ringSegments(base, P, st.tp, Object.values(st.tapes));
  g.strokeStyle = GUIDE_PINK;
  g.lineWidth = Math.max(2, W / 600);
  g.lineCap = 'round';
  g.beginPath();
  for (const [u1, v1, u2, v2] of segs) {
    g.moveTo(u1 * W, (1 - v1) * H);
    g.lineTo(u2 * W, (1 - v2) * H);
  }
  g.stroke();
  return c;
}

// ---------- tabla (sin innerHTML con datos del usuario) ----------
function showTable(rep, warn) {
  const tb = $('tabla').tBodies[0];
  tb.replaceChildren();
  for (const [n, t, v] of rep.rows) {
    const d = v - t,
      ok = Math.abs(d) <= K.FIT_TOLERANCE,
      tr = tb.insertRow();
    for (const txt of [n, t.toFixed(1), v.toFixed(1), (d >= 0 ? '+' : '') + d.toFixed(2)])
      tr.insertCell().textContent = txt;
    tr.cells[3].className = ok ? 'ok' : 'bad';
  }
  const tt = tattoos()
    .map(t => `${t.n || 'tatuaje'} a ${t.d} cm${Number.isFinite(t.w) && t.w > 0 ? ` (ancho ${t.w})` : ''}`)
    .join(' · ');
  const ex = $('extra');
  ex.replaceChildren();
  ex.append(
    `${rep.flips === 0 ? '✓ Malla sin pliegues (0 caras invertidas).' : `⚠ ${rep.flips} caras invertidas.`} Guías: ${tt || 'ninguna'}.`,
  );
  for (const w of warn) ex.append(document.createElement('br'), w);
}

// ---------- moldeado en un Web Worker (con respaldo síncrono) ----------
let worker = null,
  workerReady = null,
  jobSeq = 0;
const jobs = new Map();
let workerInit = null;
function startWorker(meta, buf) {
  workerInit = [meta, buf];
  try {
    worker = new Worker(new URL('./fit-worker.js?v=6', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return;
  }
  const fail = () => {
    if (worker) worker.terminate();
    worker = null;
    for (const j of jobs.values()) j.ko(new Error('worker'));
    jobs.clear();
  };
  workerReady = new Promise((ok, ko) => {
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'ready') return ok();
      if (m.type === 'fatal') {
        fail();
        return ko(new Error('worker'));
      }
      const job = jobs.get(m.id);
      if (!job) return;
      if (m.type === 'progress') {
        const it = /^iter (\d+)/.exec(m.line);
        if (it) status(`Moldeando… ${+it[1] + 1}/${K.FIT_ITERS}`);
        return;
      }
      jobs.delete(m.id);
      if (m.type === 'done') job.ok(m);
      else job.ko(new Error(m.message));
    };
    worker.onerror = e => {
      e.preventDefault();
      fail();
      ko(new Error('worker'));
    };
  });
  workerReady.catch(() => {});
  const copy = buf.slice(0); // la base del hilo principal queda intacta
  worker.postMessage({ type: 'init', meta, buf: copy }, [copy]);
}
// Cancelar: se termina el worker (corta el cálculo en seco) y se arranca uno nuevo.
function cancelFit() {
  if (!worker || !jobs.size) return;
  const pend = [...jobs.values()];
  jobs.clear();
  worker.terminate();
  worker = null;
  for (const j of pend) j.ko(new Error('cancelado'));
  startWorker(...workerInit);
}
async function fitAsync(inp) {
  if (worker) {
    try {
      await workerReady;
      const id = ++jobSeq;
      const m = await new Promise((ok, ko) => {
        jobs.set(id, { ok, ko });
        worker.postMessage({ type: 'fit', id, inp });
        $('cancel').hidden = false; // sólo se puede cancelar en el worker
      });
      return { P: m.P, report: { ...m.report, tape: K.tapeFn(base, m.P) }, ms: m.ms, via: 'worker' };
    } catch (e) {
      if (e.message !== 'worker') throw e;
    } // error de medidas → al usuario; worker caído → respaldo
  }
  await tick();
  const t0 = performance.now(),
    r = K.fit(base, inp);
  return { ...r, ms: performance.now() - t0, via: 'main' };
}

// ---------- acciones ----------
let fitting = false,
  exportBusy = false;
function setBusy() {
  // «Moldear» bloqueado mientras se moldea o se exporta (evita la carrera entre ambos)
  $('go').disabled = !base || fitting || exportBusy;
  if (!fitting) $('cancel').hidden = true;
  refreshExportable();
}
function refreshExportable() {
  const ok = fresh() && !!base && !fitting && !exportBusy;
  for (const id of ['dlUsdz', 'dlObj', 'dlCapas']) $(id).disabled = !ok;
  $('dl2D').disabled = !base || (!!result && !ok);
  $('stale').hidden = !result || fresh();
  if ((result && !fresh()) || fitting) {
    $('ready').hidden = true;
    pendingFile = null;
  }
}
async function run(ev) {
  if (ev) ev.preventDefault();
  if (!base) return;
  let r;
  try {
    r = readInputs();
  } catch (e) {
    status('⚠ ' + e.message);
    return;
  }
  const key = inputsKey();
  status('Moldeando…');
  fitting = true;
  setBusy();
  try {
    const out = await fitAsync(r.inp);
    result = out;
    resultKey = key;
    dbg('__result', result);
    updateMesh(result.P);
    if (v2d) v2d.invalidate('all');
    paintTexture();
    buildGuides(result.P);
    showTable(result.report, r.warn);
    status(
      `Listo en ${(out.ms / 1000).toFixed(1)} s. ` +
        (result.report.flips
          ? `⚠ ${result.report.flips} caras invertidas: revisa antes de exportar.`
          : NARROW.matches
            ? 'Gira el modelo con dos dedos.'
            : 'Puedes girar el modelo con el ratón o el dedo.'),
    );
    if (innerWidth <= 820) $('vista').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    if (e.message === 'cancelado') {
      status('Moldeado cancelado.');
    } else {
      console.warn(e);
      resultKey = null;
      status('⚠ ' + e.message + ' Vuelve a moldear cuando lo corrijas.');
    }
  } finally {
    fitting = false;
    setBusy();
  }
}
const fname = () =>
  ($('cliente').value.trim() || 'cliente')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'cliente';

// Descargas: en iPhone/iPad, hoja de compartir (Procreate, Archivos) en un 2.º toque; si no, descarga directa.
let pendingFile = null,
  pendingURL = null;
function offerFile(bytes, name, type) {
  const file = new File([bytes], name, { type });
  if (pendingURL) URL.revokeObjectURL(pendingURL); // se revoca la anterior, nunca la que se ofrece
  pendingURL = URL.createObjectURL(file);
  pendingFile = file;
  let share = false;
  try {
    share = !!navigator.canShare && navigator.canShare({ files: [file] }) && (IS_IOS || navigator.maxTouchPoints > 0);
  } catch {
    share = false;
  }
  if (!share) {
    const a = document.createElement('a');
    a.href = pendingURL;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  $('readyTxt').textContent = `${name} (${(file.size / 1e6).toFixed(1)} MB) listo.`;
  $('dlLink').href = pendingURL;
  $('dlLink').download = name;
  $('ready').hidden = false;
  $('shareBtn').focus();
}
async function shareNow() {
  // share() es lo primero: conserva el gesto del usuario
  if (!pendingFile) return;
  try {
    await navigator.share({ files: [pendingFile] });
    status('Enviado. Si Procreate no se abrió solo: Galería › Importar.');
  } catch (e) {
    if (e.name !== 'AbortError') status('⚠ No se pudo compartir; usa «Guardar».');
  }
}
addEventListener('pagehide', () => {
  if (pendingURL) URL.revokeObjectURL(pendingURL);
});
const exporting =
  (fn, needsFit = true) =>
  async () => {
    if (needsFit && !fresh()) {
      refreshExportable();
      status('⚠ Las medidas han cambiado: vuelve a moldear.');
      return;
    }
    const R = result; // el resultado se fija al empezar: un moldeado posterior no se mezcla con esta exportación
    if (
      needsFit &&
      R.report.flips &&
      !confirm(`El modelo tiene ${R.report.flips} caras invertidas. ¿Exportar igualmente?`)
    )
      return;
    exportBusy = true;
    setBusy(); // también bloquea «Moldear» y evita el doble toque
    try {
      await fn(R);
    } catch (e) {
      console.warn(e);
      status('⚠ ' + e.message);
    } finally {
      exportBusy = false;
      setBusy();
    }
  };
async function dlUsdz(R) {
  status('Generando USDZ…');
  await tick();
  const png = await basePNG();
  const name = `brazo_${fname()}`,
    bytes = K.makeUSDZ(base, R.P, name, png); // core limpia el nombre del prim
  dbg('__lastUSDZ', bytes);
  offerFile(bytes, `${name}.usdz`, 'model/vnd.usdz+zip');
  status(`USDZ listo (${(bytes.length / 1e6).toFixed(1)} MB). En el iPad: Archivos → abrir con Procreate.`);
}
async function dlObj(R) {
  status('Generando OBJ…');
  await tick();
  const png = await basePNG(),
    name = `brazo_${fname()}`,
    capas = await layerFiles(name);
  const { obj, mtl } = K.makeOBJ(base, R.P, name, `${name}.mtl`, `${name}.png`),
    enc = new TextEncoder();
  const z = zipSync(
    {
      [`${name}/${name}.obj`]: enc.encode(obj),
      [`${name}/${name}.mtl`]: enc.encode(mtl),
      [`${name}/${name}.png`]: [png, { level: 0 }],
      ...capas,
    },
    { level: 6 },
  );
  dbg('__lastOBJZIP', z);
  offerFile(z, `${name}_OBJ.zip`, 'application/zip');
  status(`ZIP listo (${(z.length / 1e6).toFixed(1)} MB).`);
}
async function layerFiles(name) {
  const out = { 'capas/LEEME_capas.txt': new TextEncoder().encode(LEEME_CAPAS) };
  const png = async (key, c, tmp) => {
    try {
      out[key] = [await toPNG(c), { level: 0 }];
    } finally {
      if (tmp) release(c);
    }
  };
  if (!$('expGuias').checked && tattoos().length) await png(`capas/${name}_guias.png`, guidesLayer(), true);
  const t = getTattooLayer();
  if (t) await png(`capas/${name}_tatuaje.png`, t, false); // caché: no se libera
  if ($('expMed').checked) await png(`capas/${name}_guias_medicion.png`, measurementLayer(), true);
  return out;
}
async function dlCapas() {
  status('Generando capas…');
  await tick();
  const name = `brazo_${fname()}`,
    f = await layerFiles(name);
  const z = zipSync(f, { level: 6 });
  dbg('__lastCAPAS', z);
  offerFile(z, `${name}_capas.zip`, 'application/zip');
  const pngs = Object.keys(f)
    .filter(k => k.endsWith('.png'))
    .map(k => k.split('/')[1]);
  status(`Capas listas: ${pngs.join(', ') || 'no hay capas (ni guías ni tatuaje)'}.`);
}

// ---------- vista 2D ----------
let v2d = null,
  mode2d = false;
function orthoView(d, right, xmin, xmax, ymin, ymax, W, H) {
  // vista ortográfica del brazo ajustado (WebGL), devuelve un canvas
  W = Math.round(W);
  H = Math.round(H);
  const cam = new THREE.OrthographicCamera(xmin, xmax, ymax, ymin, -1000, 1000),
    D = new THREE.Vector3(...d);
  cam.position.copy(D).multiplyScalar(300);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const gv = guideGroup.visible,
    sp = sun.position.clone();
  guideGroup.visible = false;
  sun.position
    .copy(D)
    .multiplyScalar(120)
    .add(new THREE.Vector3(0, 80, 0))
    .addScaledVector(new THREE.Vector3(...right), 40);
  try {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0xffffff, 0);
    renderer.clear();
    renderer.render(scene, cam);
  } finally {
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    guideGroup.visible = gv;
    sun.position.copy(sp);
  }
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  rt.dispose();
  const c = mkCanvas(W, H),
    g = c.getContext('2d'),
    im = g.createImageData(W, H),
    row = W * 4,
    a = im.data;
  for (let y = 0; y < H; y++) a.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
  for (let i = 0; i < a.length; i += 4) {
    // desmultiplicar alfa (bordes suaves)
    const al = a[i + 3];
    if (al && al < 255) for (let k = 0; k < 3; k++) a[i + k] = Math.min(255, (a[i + k] * 255) / al);
  }
  g.putImageData(im, 0, 0);
  return c;
}
const ROW_ID = [
  'hombro_codo',
  'codo_muneca',
  'hombro_muneca',
  'c_axila',
  'c_biceps',
  'c_codo',
  'c_antebrazo',
  'c_muneca',
  'largo_mano',
  'ancho_nudillos',
];
function set2D(on) {
  mode2d = on;
  v2d.show(on);
  renderer.domElement.style.display = on ? 'none' : '';
  $('labels').style.display = on ? 'none' : '';
  $('btn2D').setAttribute('aria-pressed', on);
  $('btn2D').textContent = on ? '🧊 Ver en 3D' : '🗺️ Ver en 2D';
  $('bar2d').hidden = !on;
  refreshGuides();
  if (on) {
    v2d._size();
    v2d.fit();
    v2d.draw();
  } else requestRender();
}
function init2D() {
  v2d = new View2D($('viewer'), {
    K,
    base,
    num: GUIDE_NUM,
    txt: GUIDE_TXT,
    members,
    ortho: orthoView,
    P: () => (result ? result.P : base.V0),
    texSize: previewSize,
    exportSize: texSize,
    tattooLayer: getTattooLayer,
    baseLayer: getBaseLayer,
    showTattoo: () => $('verGuias').checked,
    drawTattooGuides: drawGuides,
    guideState: () => ({ on: guidesOn, focus: focusId }),
    values: () => {
      const o = {};
      if (result)
        ROW_ID.forEach((id, i) => {
          o[id] = result.report.rows[i][2];
        });
      return o;
    },
    client: () => $('cliente').value.trim() || 'cliente',
  });
  const setSub = m => {
    v2d.setMode(m);
    document.querySelectorAll('#seg2d button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
  };
  $('btn2D').onclick = () => set2D(!mode2d);
  document.querySelectorAll('#seg2d button').forEach(b => {
    b.onclick = () => setSub(b.dataset.m);
  });
  $('dl2D').onclick = exporting(async () => {
    status('Generando PNG 2D…');
    await tick();
    const c = v2d.exportCanvas(),
      w = c.width,
      h = c.height,
      name = `${fname()}_2d_${v2d.mode === 'tex' ? 'textura' : 'siluetas'}.png`;
    let bytes;
    try {
      bytes = await toPNG(c);
    } finally {
      release(c);
    }
    dbg('__last2D', { name, w, h, n: bytes.length });
    offerFile(bytes, name, 'image/png');
    status(`PNG 2D listo: ${name} (${w}×${h} px).`);
  }, false);
  v2d.setTouchScroll(NARROW.matches);
  v2d.onGesture = () => {
    if (!touchHintSeen) {
      touchHintSeen = true;
      refreshGuides();
    }
  };
  dbg('__v2d', v2d);
}

// ---------- imágenes subidas ----------
function loadImageFile(file, onOk) {
  if (file.size > MAX_UPLOAD_MB * 1e6) {
    status(`⚠ La imagen pesa más de ${MAX_UPLOAD_MB} MB.`);
    return;
  }
  const url = URL.createObjectURL(file),
    img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    if (Math.max(img.naturalWidth, img.naturalHeight) > MAX_UPLOAD_PX) {
      status(`⚠ La imagen supera ${MAX_UPLOAD_PX} px de lado.`);
      return;
    }
    onOk(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    status('⚠ No se pudo leer la imagen (¿dañada o en HEIC? Usa PNG o JPG).');
  };
  img.src = url;
}
function wireUploads() {
  $('tex').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    loadImageFile(f, img => {
      userImg = img;
      const [W, H] = texSize();
      $('texInfo').textContent =
        `Tu textura: ${f.name} (${img.naturalWidth}×${img.naturalHeight})` +
        (W !== img.naturalWidth || H !== img.naturalHeight ? ` → se usa a ${W}×${H}` : '');
      paintTexture();
    });
  };
  $('texReset').onclick = () => {
    userImg = null;
    $('tex').value = '';
    $('texInfo').textContent = 'Piel neutra solo dentro de la silueta del brazo y las manos';
    paintTexture();
  };
  $('tat').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    loadImageFile(f, img => {
      tatImg = img;
      const [W, H] = texSize();
      $('tatInfo').textContent =
        `Tatuaje: ${f.name} (${img.naturalWidth}×${img.naturalHeight})` +
        (img.naturalWidth !== W || img.naturalHeight !== H ? ` ⚠ se escala a ${W}×${H}` : '');
      paintTexture();
    });
  };
  $('tatReset').onclick = () => {
    tatImg = null;
    $('tat').value = '';
    $('tatInfo').textContent = 'Sin capa de tatuaje';
    paintTexture();
  };
}

// ---------- service worker: sin conexión + aviso de versión nueva ----------
async function initSW() {
  if (!('serviceWorker' in navigator)) return;
  let accepted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (accepted) location.reload();
  });
  const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => null);
  if (!reg) return;
  const offer = w => {
    $('update').hidden = false;
    $('updBtn').onclick = () => {
      accepted = true;
      $('updBtn').disabled = true;
      w.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => location.reload(), 3000);
    };
    $('updLater').onclick = () => {
      $('update').hidden = true;
    };
  };
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

// ---------- arranque ----------
async function loadPart() {
  const url = ext => part.data + ext + (part.version || '');
  const [mr, br] = await Promise.all([fetch(url('.json')), fetch(url('.bin'))]);
  if (!mr.ok || !br.ok) throw new Error(`No se pudo descargar el modelo base (${mr.ok ? br.status : mr.status}).`);
  return [await mr.json(), await br.arrayBuffer()];
}
async function start() {
  initSW();
  buildForm();
  initViewer();
  wireUploads();
  $('form').onsubmit = run;
  $('dlUsdz').onclick = exporting(dlUsdz);
  $('dlObj').onclick = exporting(dlObj);
  $('dlCapas').onclick = exporting(dlCapas);
  $('shareBtn').onclick = shareNow;
  $('form').addEventListener('input', e => {
    if (MEDIDA_IDS().includes(e.target.id)) refreshExportable();
  });
  $('verGuias').onchange = () => paintTexture();
  $('btnGuias').onclick = () => {
    guidesOn = !guidesOn;
    refreshGuides();
  };
  let meta, buf;
  try {
    [meta, buf] = await loadPart();
    base = K.loadBase(meta, buf);
    buildMesh();
    buildGuides(base.V0);
  } catch (e) {
    console.warn(e);
    base = null;
    status(`⚠ ${e.message || 'No se pudo cargar el modelo base.'} Comprueba la conexión y recarga la página.`);
    return;
  }
  startWorker(meta, buf);
  init2D();
  for (const id of ['texReset', 'tatReset', 'btn2D', 'btnGuias']) $(id).disabled = false;
  $('cancel').onclick = cancelFit;
  setBusy();
  status('Modelo base cargado. Escribe las medidas (o «Cargar ejemplo») y pulsa «Moldear».');
  window.__ready = true;
}
start();
