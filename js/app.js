import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { zipSync } from '../vendor/fflate.js';
import * as K from './core.js';
import { PARTS } from './parts.js';

const $ = id => document.getElementById(id);
const status = t => { $('status').textContent = t; };
let part = PARTS.brazo_derecho, base = null, result = null, userImg = null, tatImg = null, geo = null, mesh = null, texCanvas = null, texture = null, idxMap = null;
const BLEED = 6; // px de sangrado alrededor de las islas UV (a 2048 px)
const SKIN = '#e3c2aa';

// ---------- formulario ----------
function num(id) { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : null; }
function buildForm() {
  const sel = $('parte'); for (const [k, p] of Object.entries(PARTS)) { const o = new Option(p.nombre, k); o.disabled = !p.activo; sel.add(o); }
  const mk = (box, list) => list.forEach(([id, lab, v]) => { box.insertAdjacentHTML('beforeend', `<label>${lab}<input type="number" inputmode="decimal" step="0.1" min="1" id="${id}" value="${v}"><small class="help" data-for="${id}"></small></label>`); });
  mk($('largos'), part.largos); mk($('contornos'), part.contornos);
  part.tatuajes.forEach(t => addTat(...t));
  document.querySelectorAll('.help').forEach(el => { el.textContent = (part.ayuda || {})[el.dataset.for] || ''; });
  for (const id of Object.keys(GUIDE_NUM)) { const el = $(id); if (!el) continue;
    el.addEventListener('focus', () => { focusId = id; refreshGuides(); });
    el.addEventListener('blur', () => { setTimeout(() => { if (focusId === id) { focusId = null; refreshGuides(); } }, 150); }); }
  $('addTat').onclick = () => addTat('', '', '');
}
function addTat(n, d, w) {
  const div = document.createElement('div'); div.className = 'tat';
  div.innerHTML = `<label>Nombre<input class="tn" value="${n}"></label><label>Desde hombro<input class="td" type="number" inputmode="decimal" step="0.1" value="${d}"></label><label>Ancho (opc.)<input class="tw" type="number" inputmode="decimal" step="0.1" value="${w}"></label><button type="button" class="ghost" title="Quitar">✕</button>`;
  div.querySelector('button').onclick = () => { div.remove(); paintTexture(); };
  div.querySelectorAll('input').forEach(i => i.addEventListener('change', () => paintTexture()));
  $('tatuajes').appendChild(div);
}
function tattoos() {
  return [...document.querySelectorAll('.tat')].map(d => ({ n: d.querySelector('.tn').value.trim(), d: parseFloat(d.querySelector('.td').value), w: parseFloat(d.querySelector('.tw').value) })).filter(t => isFinite(t.d) && t.d > 0);
}
function readInputs() {
  const inp = {}; for (const [id, lab] of [...part.largos, ...part.contornos]) { inp[id] = num(id); }
  const warn = [];
  if (!inp.hombro_codo) throw new Error('Falta hombro → codo.');
  if (!inp.hombro_muneca && !inp.codo_muneca) throw new Error('Falta codo → muñeca u hombro → muñeca.');
  if (!inp.hombro_muneca) inp.hombro_muneca = inp.hombro_codo + inp.codo_muneca;
  if (inp.codo_muneca && Math.abs(inp.hombro_codo + inp.codo_muneca - inp.hombro_muneca) > 0.5)
    warn.push(`Ojo: 1 + 2 = ${(inp.hombro_codo + inp.codo_muneca).toFixed(1)} no cuadra con 3 = ${inp.hombro_muneca}; uso hombro→codo y hombro→muñeca.`);
  for (const [id, lab] of part.contornos) if (!inp[id] || inp[id] < 8 || inp[id] > 80) throw new Error(`Revisa: ${lab}.`);
  if (inp.hombro_muneca - inp.hombro_codo < 10) throw new Error('El antebrazo sale demasiado corto: revisa los largos.');
  inp.largo_mano = num('largo_mano'); inp.ancho_nudillos = num('ancho_nudillos');
  return { inp, warn };
}

// ---------- capas: base (piel en la silueta UV), guías (PNG aparte), tatuaje (PNG aparte) ----------
const mkCanvas = (W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
function texSize() { return userImg ? [Math.min(4096, userImg.naturalWidth), Math.min(4096, userImg.naturalHeight)] : [2048, 2048]; }
function baseLayer() { // piel neutra solo dentro de las islas UV (+ sangrado) y transparente fuera; o la capa base del usuario
  const [W, H] = texSize(), c = mkCanvas(W, H), g = c.getContext('2d');
  if (userImg) { g.drawImage(userImg, 0, 0, W, H); return c; }
  const VT = base.VT, FT = base.FT; g.beginPath();
  for (let f = 0; f < FT.length; f += 3) { const a = FT[f], b = FT[f + 1], d = FT[f + 2];
    g.moveTo(VT[2 * a] * W, (1 - VT[2 * a + 1]) * H); g.lineTo(VT[2 * b] * W, (1 - VT[2 * b + 1]) * H); g.lineTo(VT[2 * d] * W, (1 - VT[2 * d + 1]) * H); g.closePath(); }
  g.fillStyle = g.strokeStyle = SKIN; g.lineJoin = 'round'; g.lineWidth = 2 * BLEED * W / 2048; g.fill(); g.stroke();
  return c;
}
function guidesLayer() { const [W, H] = texSize(), c = mkCanvas(W, H); drawGuides(c.getContext('2d'), W, H); return c; }
function tattooLayer() { if (!tatImg) return null; const [W, H] = texSize(), c = mkCanvas(W, H); c.getContext('2d').drawImage(tatImg, 0, 0, W, H); return c; }
let baseCache = null;
function paintTexture() { // vista previa = base + tatuaje + guías
  if (!base) return;
  const [W, H] = texSize();
  if (!texCanvas) texCanvas = mkCanvas(W, H);
  if (texCanvas.width !== W || texCanvas.height !== H) { texCanvas.width = W; texCanvas.height = H; }
  if (!baseCache || baseCache.width !== W || baseCache.userImg !== userImg) { baseCache = baseLayer(); baseCache.userImg = userImg; }
  const g = texCanvas.getContext('2d'); g.clearRect(0, 0, W, H);
  g.fillStyle = '#b9a99c'; g.fillRect(0, 0, W, H); // fondo neutro solo para la vista previa
  g.drawImage(baseCache, 0, 0);
  const t = tattooLayer(); if (t) g.drawImage(t, 0, 0);
  if ($('verGuias').checked) drawGuides(g, W, H);
  if (texture) { texture.needsUpdate = true; }
}
function drawGuides(g, W, H) {
  const P = result ? result.P : base.V0, tape = result ? result.report.tape : K.tapeFn(base, base.V0);
  const vals = []; for (const t of tattoos()) { vals.push(t.d); if (isFinite(t.w) && t.w > 0) vals.push(t.d + t.w); }
  if (!vals.length) return;
  const segs = K.ringSegments(base, P, tape, vals);
  g.strokeStyle = '#1e7fd8'; g.lineWidth = Math.max(2, W / 700); g.lineCap = 'round'; g.beginPath();
  for (const [u1, v1, u2, v2] of segs) { g.moveTo(u1 * W, (1 - v1) * H); g.lineTo(u2 * W, (1 - v2) * H); }
  g.stroke();
}
const toPNG = async c => new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
async function basePNG() { // capa base que va dentro del USDZ/OBJ
  const c = baseLayer(); if ($('expGuias').checked) { const [W, H] = texSize(); drawGuides(c.getContext('2d'), W, H); }
  return toPNG(c);
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
// ---------- visor 3D ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
function initViewer() {
  const el = $('viewer'); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); el.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(60, 80, 120); scene.add(d);
  renderer.setClearColor(0x000000, 0); controls.enableDamping = true;
  const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); if (!fitCamera.done) fitCamera(); };
  new ResizeObserver(resize).observe(el); resize();
  scene.add(guideGroup);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); placeLabels(); });
}
function fitCamera() { // encuadra todo el brazo (con margen para las etiquetas)
  if (!geo) return; geo.computeBoundingBox(); const b = geo.boundingBox, c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), dV = (sz.y / 2) / t, dH = (Math.max(sz.x, sz.z) / 2) / (t * camera.aspect);
  const d = Math.max(dV, dH) * 1.18 + sz.z / 2; controls.target.copy(c); camera.position.set(c.x, c.y, c.z + d); controls.update(); fitCamera.done = true;
}
function buildMesh() {
  const F = base.F, FT = base.FT, VT = base.VT, map = new Map(), vid = [], tid = [], index = new Uint32Array(F.length);
  for (let i = 0; i < F.length; i++) { const k = F[i] * 1e6 + FT[i]; let j = map.get(k); if (j === undefined) { j = vid.length; map.set(k, j); vid.push(F[i]); tid.push(FT[i]); } index[i] = j; }
  idxMap = Int32Array.from(vid); const n = vid.length, uv = new Float32Array(2 * n);
  tid.forEach((t, j) => { uv[2 * j] = VT[2 * t]; uv[2 * j + 1] = VT[2 * t + 1]; });
  geo = new THREE.BufferGeometry(); geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * n), 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(3 * n), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  paintTexture(); texture = new THREE.CanvasTexture(texCanvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 })); scene.add(mesh);
  updateMesh(base.V0); fitCamera();
}
function updateMesh(P) {
  const N = K.vertexNormals(base, P), pa = geo.attributes.position.array, na = geo.attributes.normal.array;
  idxMap.forEach((v, j) => { for (let c = 0; c < 3; c++) { pa[3 * j + c] = P[3 * v + c]; na[3 * j + c] = N[3 * v + c]; } });
  geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = true; geo.computeBoundingSphere();
}

// ---------- guías de medición (vista 3D) ----------
const GUIDE_NUM = { hombro_codo: 1, codo_muneca: 2, hombro_muneca: 3, c_axila: 4, c_biceps: 5, c_codo: 6, c_antebrazo: 7, c_muneca: 8, largo_mano: 9, ancho_nudillos: 10 };
const GUIDE_TXT = { hombro_codo: 'Hombro → codo', codo_muneca: 'Codo → muñeca', hombro_muneca: 'Hombro → muñeca', c_axila: 'Contorno axila', c_biceps: 'Contorno mitad bíceps',
  c_codo: 'Contorno codo', c_antebrazo: 'Contorno mitad antebrazo', c_muneca: 'Contorno muñeca', largo_mano: 'Largo mano', ancho_nudillos: 'Ancho nudillos' };
const COL = 0xff3d9a, HI = 0xffd400;
let guidesOn = false, focusId = null; const guideGroup = new THREE.Group(), gItems = {};
const V3 = p => new THREE.Vector3(p[0], p[1], p[2]);
function tube(pts, closed, r = 0.13) { const c = new THREE.CatmullRomCurve3(pts.map(V3), closed, 'centripetal'); return new THREE.TubeGeometry(c, Math.max(48, pts.length * 3), r, 6, closed); }
function addItem(id, geoms, labelPos, overlay = false) {
  const mat = new THREE.MeshBasicMaterial({ color: COL, transparent: true, opacity: 1, depthTest: !overlay });
  const ms = geoms.map(g => { const m = new THREE.Mesh(g, mat); m.renderOrder = overlay ? 10 : 1; guideGroup.add(m); return m; });
  const el = document.createElement('div'); el.className = 'gl'; el.textContent = GUIDE_NUM[id]; el.title = GUIDE_TXT[id]; $('labels').appendChild(el);
  gItems[id] = { mat, ms, el, pos: V3(labelPos) };
}
function buildGuides(P) {
  for (const it of Object.values(gItems)) { it.ms.forEach(m => { guideGroup.remove(m); m.geometry.dispose(); }); it.mat.dispose(); it.el.remove(); }
  for (const k of Object.keys(gItems)) delete gItems[k];
  const m = base.meta, st = K.stationS(base, P), tp = st.tp;
  const mer = (lo, hi) => tp.pts.map((p, i) => [p, tp.S[i]]).filter(([, s]) => s <= hi + 1e-6 && s >= lo - 1e-6).map(([p, s]) => K.outward(base, P, p, s, 0.2));
  const merAt = s => { let j = 0, b = 1e9; tp.S.forEach((x, i) => { if (Math.abs(x - s) < b) { b = Math.abs(x - s); j = i; } }); return K.outward(base, P, tp.pts[j], tp.S[j], 0.2); };
  const ball = (p, r = 0.55) => new THREE.SphereGeometry(r, 16, 12).translate(p[0], p[1], p[2]);
  const pTip = merAt(m.s_tip), pEl = merAt(m.S_EL), pWr = merAt(m.S_WR);
  const seg1 = mer(m.S_EL, m.s_tip), seg2 = mer(m.S_WR, m.S_EL);
  const mid = (seg) => { const q = seg[Math.floor(seg.length / 2)]; return [q[0] - 4.5, q[1], q[2]]; }; // etiqueta al lado de la línea
  addItem('hombro_codo', [tube(seg1, false), ball(pTip), ball(pEl)], mid(seg1, m.S_EL, m.s_tip));
  addItem('codo_muneca', [tube(seg2, false), ball(pWr)], mid(seg2, m.S_WR, m.S_EL));
  const off = p => [p[0] + 2.2, p[1] + 1.2, p[2]];
  addItem('hombro_muneca', [], off(pTip));
  for (const id of ['c_axila', 'c_biceps', 'c_codo', 'c_antebrazo', 'c_muneca']) {
    const R = K.ringLoop(base, P, st.s[id], 0.18); if (!R) continue;
    const q = merAt(st.s[id]); let best = R.pts[0], bd = 1e9; for (const r of R.pts) { const d = Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]); if (d < bd) { bd = d; best = r; } }
    addItem(id, [tube(R.pts, true)], best);
  }
  const hg = K.handGuides(base, P);
  if (hg) {
    addItem('largo_mano', [tube([hg.wc, hg.tip], false, 0.1), ball(hg.wc, 0.4), ball(hg.tip, 0.4)], hg.tip, true);
    addItem('ancho_nudillos', [tube(hg.ring, true)], hg.ring[0]);
  }
  refreshGuides();
}
const members = id => id === 'hombro_muneca' ? ['hombro_codo', 'codo_muneca', 'hombro_muneca'] : [id];
function refreshGuides() {
  const act = focusId ? members(focusId) : [];
  guideGroup.visible = guidesOn || !!focusId;
  for (const [id, it] of Object.entries(gItems)) {
    const on = act.includes(id), vis = guidesOn || on;
    it.ms.forEach(m => { m.visible = vis; }); it.mat.color.setHex(on ? HI : COL); it.mat.opacity = focusId && !on ? 0.35 : 1;
    it.el.style.display = vis ? '' : 'none'; it.el.className = 'gl' + (on ? ' on' : focusId ? ' dim' : '');
  }
  const b = $('btnGuias'); b.setAttribute('aria-pressed', guidesOn); b.textContent = guidesOn ? '📏 Ocultar guías de medición' : '📏 Mostrar guías de medición';
  const info = $('guiaInfo');
  if (focusId) { info.hidden = false; info.innerHTML = `<b>${GUIDE_NUM[focusId]}. ${GUIDE_TXT[focusId]}</b> — ${(part.ayuda || {})[focusId] || ''}`; }
  else if (guidesOn) { info.hidden = false; info.textContent = 'Los números coinciden con los campos de la ficha. Toca un campo para resaltar dónde se mide.'; }
  else info.hidden = true;
}
const _v = new THREE.Vector3();
function placeLabels() {
  if (!guideGroup.visible) return; const el = $('viewer'), w = el.clientWidth, h = el.clientHeight;
  for (const it of Object.values(gItems)) { if (it.el.style.display === 'none') continue;
    _v.copy(it.pos).project(camera); const hide = _v.z > 1; it.el.style.visibility = hide ? 'hidden' : 'visible';
    it.el.style.left = Math.min(w - 14, Math.max(14, (_v.x + 1) / 2 * w)) + 'px'; it.el.style.top = Math.min(h - 14, Math.max(14, (1 - _v.y) / 2 * h)) + 'px'; }
}
function measurementLayer() { // anillos de medición en la textura (capa PNG aparte)
  const [W, H] = texSize(), c = mkCanvas(W, H), g = c.getContext('2d'), P = result ? result.P : base.V0, st = K.stationS(base, P);
  const segs = K.ringSegments(base, P, st.tp, Object.values(st.tapes));
  g.strokeStyle = '#ff3d9a'; g.lineWidth = Math.max(2, W / 600); g.lineCap = 'round'; g.beginPath();
  for (const [u1, v1, u2, v2] of segs) { g.moveTo(u1 * W, (1 - v1) * H); g.lineTo(u2 * W, (1 - v2) * H); } g.stroke(); return c;
}

// ---------- tabla ----------
function showTable(rep, warn) {
  const tb = $('tabla').tBodies[0]; tb.innerHTML = '';
  for (const [n, t, v] of rep.rows) { const d = v - t, ok = Math.abs(d) <= 0.3;
    tb.insertAdjacentHTML('beforeend', `<tr><td>${n}</td><td>${t.toFixed(1)}</td><td>${v.toFixed(1)}</td><td class="${ok ? 'ok' : 'bad'}">${d >= 0 ? '+' : ''}${d.toFixed(2)}</td></tr>`); }
  const tt = tattoos().map(t => `${t.n || 'tatuaje'} a ${t.d} cm${isFinite(t.w) && t.w > 0 ? ` (ancho ${t.w})` : ''}`).join(' · ');
  $('extra').innerHTML = `${rep.flips === 0 ? '✓ Malla sin pliegues (0 caras invertidas).' : `⚠ ${rep.flips} caras invertidas.`} Guías: ${tt || 'ninguna'}.` + (warn.length ? `<br>${warn.join('<br>')}` : '');
}

// ---------- acciones ----------
async function run(ev) {
  ev && ev.preventDefault();
  let r; try { r = readInputs(); } catch (e) { status('⚠ ' + e.message); return; }
  status('Moldeando…'); $('go').disabled = true; await new Promise(res => setTimeout(res, 30));
  try {
    const t0 = performance.now(); result = K.fit(base, r.inp); window.__result = result;
    updateMesh(result.P); paintTexture(); buildGuides(result.P); showTable(result.report, r.warn);
    status(`Listo en ${((performance.now() - t0) / 1000).toFixed(1)} s. Puedes girar el modelo con el dedo.`);
    $('dlUsdz').disabled = $('dlObj').disabled = $('dlCapas').disabled = false;
    if (innerWidth <= 820) $('vista').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { console.error(e); status('⚠ ' + e.message); }
  $('go').disabled = false;
}
const fname = () => ($('cliente').value.trim() || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_');
function save(bytes, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
async function dlUsdz() {
  status('Generando USDZ…'); const png = await basePNG();
  const name = `brazo_${fname()}`; const bytes = K.makeUSDZ(base, result.P, name.replace(/^[^A-Za-z_]/, '_'), png);
  window.__lastUSDZ = bytes; save(bytes, `${name}.usdz`, 'model/vnd.usdz+zip'); status(`USDZ listo (${(bytes.length / 1e6).toFixed(1)} MB). En el iPad: Archivos → abrir con Procreate.`);
}
async function dlObj() {
  status('Generando OBJ…'); const png = await basePNG(); const name = `brazo_${fname()}`; const capas = await layerFiles(name);
  const { obj, mtl } = K.makeOBJ(base, result.P, name, `${name}.mtl`, `${name}.png`); const enc = new TextEncoder();
  const z = zipSync({ [`${name}/${name}.obj`]: enc.encode(obj), [`${name}/${name}.mtl`]: enc.encode(mtl), [`${name}/${name}.png`]: [png, { level: 0 }], ...capas }, { level: 6 });
  window.__lastOBJZIP = z; save(z, `${name}_OBJ.zip`, 'application/zip'); status(`ZIP listo (${(z.length / 1e6).toFixed(1)} MB).`);
}

async function layerFiles(name) {
  const out = { [`capas/LEEME_capas.txt`]: new TextEncoder().encode(LEEME_CAPAS) };
  if (!$('expGuias').checked && tattoos().length) out[`capas/${name}_guias.png`] = [await toPNG(guidesLayer()), { level: 0 }];
  const t = tattooLayer(); if (t) out[`capas/${name}_tatuaje.png`] = [await toPNG(t), { level: 0 }];
  if ($('expMed').checked) out[`capas/${name}_guias_medicion.png`] = [await toPNG(measurementLayer()), { level: 0 }];
  return out;
}
async function dlCapas() {
  status('Generando capas…'); const name = `brazo_${fname()}`; const f = await layerFiles(name);
  const z = zipSync(f, { level: 6 }); window.__lastCAPAS = z; save(z, `${name}_capas.zip`, 'application/zip');
  status(`Capas listas: ${Object.keys(f).filter(k => k.endsWith('.png')).map(k => k.split('/')[1]).join(', ') || 'no hay capas (ni guías ni tatuaje)'}.`);
}
// ---------- arranque ----------
async function start() {
  buildForm(); initViewer();
  $('form').onsubmit = run; $('dlUsdz').onclick = dlUsdz; $('dlObj').onclick = dlObj; $('dlCapas').onclick = dlCapas;
  $('verGuias').onchange = () => paintTexture();
  $('tex').onchange = e => { const f = e.target.files[0]; if (!f) return; const img = new Image();
    img.onload = () => { userImg = img; $('texInfo').textContent = `Tu textura: ${f.name} (${img.naturalWidth}×${img.naturalHeight})`; paintTexture(); if (texture) { texture.dispose(); texture = new THREE.CanvasTexture(texCanvas); texture.colorSpace = THREE.SRGBColorSpace; mesh.material.map = texture; mesh.material.needsUpdate = true; } };
    img.src = URL.createObjectURL(f); };
  $('texReset').onclick = () => { userImg = null; $('tex').value = ''; $('texInfo').textContent = 'Piel neutra solo dentro de la silueta del brazo y las manos'; paintTexture(); texture.dispose(); texture = new THREE.CanvasTexture(texCanvas); texture.colorSpace = THREE.SRGBColorSpace; mesh.material.map = texture; mesh.material.needsUpdate = true; };
  $('tat').onchange = e => { const f = e.target.files[0]; if (!f) return; const img = new Image();
    img.onload = () => { tatImg = img; const [W, H] = texSize(); $('tatInfo').textContent = `Tatuaje: ${f.name} (${img.naturalWidth}×${img.naturalHeight})` + (img.naturalWidth !== W || img.naturalHeight !== H ? ` ⚠ se escala a ${W}×${H}` : ''); paintTexture(); };
    img.src = URL.createObjectURL(f); };
  $('tatReset').onclick = () => { tatImg = null; $('tat').value = ''; $('tatInfo').textContent = 'Sin capa de tatuaje'; paintTexture(); };
  const [meta, buf] = await Promise.all([fetch(part.data + '.json').then(r => r.json()), fetch(part.data + '.bin').then(r => r.arrayBuffer())]);
  base = K.loadBase(meta, buf); buildMesh(); buildGuides(base.V0);
  $('btnGuias').onclick = () => { guidesOn = !guidesOn; refreshGuides(); };
  status('Modelo base cargado. Revisa las medidas y pulsa «Moldear».');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__ready = true;
}
start();
