// Vista 2D: (a) textura plana con capas y guías, (b) siluetas ortográficas del brazo ajustado con medidas.
// Zoom con pellizco / rueda, arrastrar para mover, doble toque para encajar.
const PINK = '#ff3d9a', PINK_D = '#d81b72', HI = '#ffc400', HI_D = '#f29900';
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const neg = a => a.map(x => -x);
const mk = (W, H) => { const c = document.createElement('canvas'); c.width = Math.round(W); c.height = Math.round(H); return c; };
const SHORT = { hombro_codo: 'Hombro→codo', codo_muneca: 'Codo→muñeca', hombro_muneca: 'Hombro→muñeca', c_axila: 'Axila', c_biceps: 'Bíceps', c_codo: 'Codo', c_antebrazo: 'Antebrazo', c_muneca: 'Muñeca', largo_mano: 'Largo mano', ancho_nudillos: 'Nudillos' };
const fmt = v => v == null || !isFinite(v) ? '' : v.toFixed(1).replace('.', ',') + ' cm';

export class View2D {
  constructor(host, api) {
    this.host = host; this.api = api; this.mode = 'tex'; this.active = false; this.cache = {}; this.v = { s: 1, tx: 0, ty: 0 };
    this.cv = document.createElement('canvas'); this.cv.className = 'v2d'; this.cv.style.display = 'none'; host.appendChild(this.cv);
    this._pointers();
    new ResizeObserver(() => { if (this.active) { const cols = this._cols(); if (cols !== this.lastCols) delete this.cache.sil, delete this.cache.silG; this._size(); this.ensure(); this.fit(); this.draw(); } }).observe(host);
  }
  _cols() { return this.host.clientWidth < this.host.clientHeight * 1.3 ? 2 : 4; }
  show(on) { this.active = on; this.cv.style.display = on ? 'block' : 'none'; if (on) { this._size(); this.ensure(); this.fit(); this.draw(); } }
  setMode(m) { this.mode = m; if (this.active) { this.ensure(); this.fit(); this.draw(); } }
  invalidate(what) {
    if (what === 'all') this.cache = {};
    else if (what === 'tex') { delete this.cache.tex; delete this.cache.texG; }
    else if (what === 'guides') { delete this.cache.texG; delete this.cache.silG; }
    if (this.active) { this.ensure(); this.draw(); }
  }
  ensure() {
    const c = this.cache;
    if (this.mode === 'tex') { if (!c.tex) c.tex = this.renderTex(); if (!c.texG) c.texG = this.renderTexGuides(); this.layers = [c.tex, c.texG]; this.bg = '#2b2724'; }
    else { this.lastCols = this._cols(); if (!c.sil) c.sil = this.renderSil(13, this.lastCols); if (!c.silG) c.silG = this.renderSilGuides(c.sil); this.layers = [c.sil.canvas, c.silG]; this.bg = '#ffffff'; }
  }
  _size() { const d = Math.min(2, devicePixelRatio || 1), w = this.host.clientWidth, h = this.host.clientHeight; this.dpr = d; this.cv.width = w * d; this.cv.height = h * d; this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px'; }
  fit() { const L = this.layers[0], w = this.host.clientWidth, h = this.host.clientHeight, bar = this.host.querySelector('.vbar'), top = bar ? bar.offsetTop + bar.offsetHeight + 6 : 56, bot = 8;
    const s = Math.min((w - 16) / L.width, (h - top - bot) / L.height); this.v = { s, tx: (w - L.width * s) / 2, ty: top + (h - top - bot - L.height * s) / 2 }; }
  draw() {
    if (!this.active) return; const g = this.cv.getContext('2d'), d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = this.bg; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(d * this.v.s, 0, 0, d * this.v.s, d * this.v.tx, d * this.v.ty); g.imageSmoothingQuality = 'high';
    for (const L of this.layers) if (L) g.drawImage(L, 0, 0);
  }
  _pointers() {
    const P = new Map(), cv = this.cv; let last = null;
    const zoomAt = (f, x, y) => { const v = this.v; const s2 = Math.min(40, Math.max(0.02, v.s * f)); f = s2 / v.s; v.tx = x - (x - v.tx) * f; v.ty = y - (y - v.ty) * f; v.s = s2; this.draw(); };
    const xy = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); P.set(e.pointerId, xy(e)); last = null; });
    cv.addEventListener('pointermove', e => {
      if (!P.has(e.pointerId)) return; const prev = P.get(e.pointerId), cur = xy(e); P.set(e.pointerId, cur);
      if (P.size === 1) { this.v.tx += cur[0] - prev[0]; this.v.ty += cur[1] - prev[1]; this.draw(); }
      else if (P.size === 2) { const [a, b] = [...P.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (last) { this.v.tx += mid[0] - last.mid[0]; this.v.ty += mid[1] - last.mid[1]; zoomAt(dist / last.dist, mid[0], mid[1]); } last = { dist, mid }; }
    });
    const up = e => { P.delete(e.pointerId); last = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = xy(e); zoomAt(Math.exp(-e.deltaY * 0.0015), x, y); }, { passive: false });
    cv.addEventListener('dblclick', () => { this.fit(); this.draw(); });
  }
  // ---------- (a) textura plana ----------
  _uvTables() {
    if (this.uvT) return this.uvT; const { base } = this.api, F = base.F, FT = base.FT, VT = base.VT, nVT = base.meta.nVT;
    const v2t = new Int32Array(base.meta.nV).fill(-1); for (let i = 0; i < F.length; i++) if (v2t[F[i]] < 0) v2t[F[i]] = FT[i];
    const cnt = new Map(); for (let f = 0; f < FT.length; f += 3) for (const [a, b] of [[FT[f], FT[f + 1]], [FT[f + 1], FT[f + 2]], [FT[f + 2], FT[f]]]) { const k = Math.min(a, b) * nVT + Math.max(a, b); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const edges = []; for (const [k, c] of cnt) if (c === 1) edges.push([Math.floor(k / nVT), k % nVT]);
    const m = base.meta, mer = []; let o = 0;
    m.mer_s.forEach((s, i) => { let u = 0, v = 0; const n = m.mer_n[i]; o = base.merStart[i]; for (let q = 0; q < n; q++) { const t = v2t[base.mer[o + q]]; u += VT[2 * t]; v += VT[2 * t + 1]; } mer.push([s, u / n, v / n]); });
    const tt = v2t[m.tip]; mer.unshift([m.s_tip, VT[2 * tt], VT[2 * tt + 1]]);
    return this.uvT = { v2t, edges, mer };
  }
  renderTex() {
    const { api } = this, [W, H] = api.texSize(), c = mk(W, H), g = c.getContext('2d'), VT = api.base.VT;
    g.drawImage(api.baseLayer(), 0, 0); const t = api.tattooLayer(); if (t) g.drawImage(t, 0, 0);
    const { edges } = this._uvTables(); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(1.5, W / 900); g.beginPath();
    for (const [a, b] of edges) { g.moveTo(VT[2 * a] * W, (1 - VT[2 * a + 1]) * H); g.lineTo(VT[2 * b] * W, (1 - VT[2 * b + 1]) * H); } g.stroke();
    return c;
  }
  renderTexGuides() {
    const { api } = this, { K, base } = api, [W, H] = api.texSize(), c = mk(W, H), g = c.getContext('2d');
    if (api.showTattoo()) api.drawTattooGuides(g, W, H);
    const st = api.guideState(); if (!st.on && !st.focus) return c;
    const P = api.P(), S = K.stationS(base, P), act = st.focus ? api.members(st.focus) : [];
    const ids = st.on ? ['hombro_codo', 'codo_muneca', 'hombro_muneca', 'c_axila', 'c_biceps', 'c_codo', 'c_antebrazo', 'c_muneca'] : act;
    const { mer } = this._uvTables(), sc = W / 2048, m = base.meta;
    const merAt = s => { let b = mer[0], d = 1e9; for (const q of mer) if (Math.abs(q[0] - s) < d) { d = Math.abs(q[0] - s); b = q; } return [b[1] * W, (1 - b[2]) * H]; };
    const style = id => { const on = act.includes(id); g.globalAlpha = st.focus && !on ? 0.35 : 1; g.strokeStyle = on ? HI : PINK; g.lineWidth = (on ? 9 : 5) * sc; g.lineCap = 'round'; return on ? HI : PINK; };
    const badges = [];
    for (const id of ids) {
      if (id.startsWith('c_')) {
        const col = style(id), segs = K.ringSegments(base, P, S.tp, [S.tapes[id]]); g.beginPath();
        for (const [u1, v1, u2, v2] of segs) { g.moveTo(u1 * W, (1 - v1) * H); g.lineTo(u2 * W, (1 - v2) * H); } g.stroke();
        const q = merAt(S.s[id]); let best = q, bd = 1e9;
        for (const [u1, v1, u2, v2] of segs) { const x = (u1 + u2) / 2 * W, y = (1 - (v1 + v2) / 2) * H, d = Math.hypot(x - q[0], y - q[1]); if (d < bd) { bd = d; best = [x, y]; } }
        badges.push([id, best, col, g.globalAlpha]);
      } else if (id !== 'hombro_muneca') {
        const [lo, hi] = id === 'hombro_codo' ? [m.S_EL, m.s_tip] : [m.S_WR, m.S_EL], col = style(id);
        const pts = mer.filter(q => q[0] >= lo - 1e-6 && q[0] <= hi + 1e-6).map(q => [q[1] * W, (1 - q[2]) * H]);
        g.beginPath(); pts.forEach((p, i) => { if (i && Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.06 * W) g.moveTo(...p); else i ? g.lineTo(...p) : g.moveTo(...p); }); g.stroke();
        const mp = pts[Math.floor(pts.length / 2)]; badges.push([id, [mp[0] - 34 * sc, mp[1]], col, g.globalAlpha]);
      } else { const col = act.includes(id) ? HI : PINK; badges.push([id, merAt(m.s_tip), col, st.focus && !act.includes(id) ? 0.35 : 1]); }
    }
    for (const [id, [x, y], col, a] of badges) this._badge(g, x, y, api.num[id], col, 22 * sc, a);
    g.globalAlpha = 1; return c;
  }
  _badge(g, x, y, n, col, r, alpha = 1) {
    g.globalAlpha = alpha; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = col; g.fill(); g.lineWidth = r * 0.15; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = col === HI || col === HI_D ? '#1d1b1a' : '#fff'; g.font = `700 ${Math.round(r * 1.1)}px -apple-system,Helvetica,Arial,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), x, y + r * 0.05); g.globalAlpha = 1;
  }
  // ---------- (b) siluetas ----------
  renderSil(ppcm, cols = 4) {
    const { api } = this, { base } = api, P = api.P(), m = base.meta, F = base.F, n = m.nV, up = [0, 1, 0];
    const o = m.dir_outer || [-1, 0, 0], b = m.dir_back || [0, 0, -1];
    const views = [['Exterior', o], ['Frente', neg(b)], ['Interior', neg(o)], ['Espalda', b]];
    let ymin = 1e9, ymax = -1e9; for (let i = 0; i < n; i++) { ymin = Math.min(ymin, P[3 * i + 1]); ymax = Math.max(ymax, P[3 * i + 1]); }
    const VW = views.map(([name, d]) => { const right = norm(cross(neg(d), up)); let xmin = 1e9, xmax = -1e9;
      for (let i = 0; i < n; i++) { const x = P[3 * i] * right[0] + P[3 * i + 1] * right[1] + P[3 * i + 2] * right[2]; xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); } return { name, d, right, xmin, xmax }; });
    const ML = 12.5, MR = 10.5, HEAD = 5, FOOT = 6, gap = 1;  // márgenes en cm (etiquetas de largos a la izquierda, contornos a la derecha)
    const pw = Math.max(...VW.map(v => v.xmax - v.xmin)) + ML + MR, ph = (ymax - ymin) + 4;
    const rows = Math.ceil(4 / cols), W = (cols * pw + gap) * ppcm, H = (HEAD + rows * (ph + 3) + FOOT) * ppcm, c = mk(W, H), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    let nf = null;
    VW.forEach((v, k) => {
      const col = k % cols, row = Math.floor(k / cols);
      v.X0 = (col * pw + ML + 0.5 - v.xmin) * ppcm; v.Y0 = (HEAD + row * (ph + 3) + 2 + ymax) * ppcm; v.ppcm = ppcm;
      v.px = p => [v.X0 + dot(p, v.right) * ppcm, v.Y0 - p[1] * ppcm];
      let img = null; try { if (api.ortho) img = api.ortho(v.d, v.right, v.xmin - 0.5, v.xmax + 0.5, ymin - 0.5, ymax + 0.5, (v.xmax - v.xmin + 1) * ppcm, (ymax - ymin + 1) * ppcm); } catch (e) { console.warn(e); }
      if (img) { g.drawImage(img, v.X0 + (v.xmin - 0.5) * ppcm, v.Y0 - (ymax + 0.5) * ppcm, (v.xmax - v.xmin + 1) * ppcm, (ymax - ymin + 1) * ppcm); }
      else { // respaldo sin WebGL: triángulos ordenados por profundidad
      if (!nf) { nf = new Float32Array(F.length);
        for (let f = 0; f < F.length; f += 3) { const [a, bb, cc] = [F[f], F[f + 1], F[f + 2]];
          const nn = norm(cross([P[3 * bb] - P[3 * a], P[3 * bb + 1] - P[3 * a + 1], P[3 * bb + 2] - P[3 * a + 2]], [P[3 * cc] - P[3 * a], P[3 * cc + 1] - P[3 * a + 1], P[3 * cc + 2] - P[3 * a + 2]])); nf[f] = nn[0]; nf[f + 1] = nn[1]; nf[f + 2] = nn[2]; } }
      const L = norm([v.d[0] + 0.3 * v.right[0], 0.6, v.d[2] + 0.3 * v.right[2]]), tris = [];
      for (let f = 0; f < F.length; f += 3) { const nd = nf[f] * v.d[0] + nf[f + 1] * v.d[1] + nf[f + 2] * v.d[2]; if (nd <= 0) continue;
        let z = 0; for (let q = 0; q < 3; q++) { const i = F[f + q]; z += P[3 * i] * v.d[0] + P[3 * i + 1] * v.d[1] + P[3 * i + 2] * v.d[2]; } tris.push([z, f]); }
      tris.sort((a, b2) => a[0] - b2[0]); g.lineWidth = 0.6; g.lineJoin = 'round';
      for (const [, f] of tris) { const sh = 0.62 + 0.38 * Math.max(0, nf[f] * L[0] + nf[f + 1] * L[1] + nf[f + 2] * L[2]);
        const colr = `rgb(${Math.round(227 * sh)},${Math.round(194 * sh)},${Math.round(170 * sh)})`; g.fillStyle = g.strokeStyle = colr; g.beginPath();
        for (let q = 0; q < 3; q++) { const i = F[f + q], x = v.X0 + (P[3 * i] * v.right[0] + P[3 * i + 1] * v.right[1] + P[3 * i + 2] * v.right[2]) * ppcm, y = v.Y0 - P[3 * i + 1] * ppcm; q ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.closePath(); g.fill(); g.stroke(); } }
      g.fillStyle = '#3a332e'; g.font = `700 ${Math.round(0.95 * ppcm)}px -apple-system,Helvetica,Arial,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText(v.name, v.X0 + ((v.xmin + v.xmax) / 2) * ppcm, (HEAD + row * (ph + 3) + 1.2) * ppcm);
    });
    // cabecera y barra de escala
    g.textAlign = 'left'; g.fillStyle = '#1d1b1a'; g.font = `700 ${Math.round(1.4 * ppcm)}px -apple-system,Helvetica,Arial,sans-serif`;
    g.fillText(`Moldeador 3D · ${api.client()} · ${new Date().toLocaleDateString('es-ES')}`, 1 * ppcm, 2.3 * ppcm);
    g.font = `400 ${Math.round(0.8 * ppcm)}px -apple-system,Helvetica,Arial,sans-serif`; g.fillStyle = '#6b625b';
    g.fillText('Brazo derecho ajustado a las medidas · los números coinciden con la ficha · líneas discontinuas = cara oculta', 1 * ppcm, 3.7 * ppcm);
    const by = H - 3 * ppcm, bx = 1.5 * ppcm; g.strokeStyle = '#1d1b1a'; g.fillStyle = '#1d1b1a'; g.lineWidth = Math.max(1.5, 0.08 * ppcm);
    g.fillRect(bx, by, 10 * ppcm, 0.35 * ppcm); for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo(bx + i * ppcm, by); g.lineTo(bx + i * ppcm, by - (i % 5 ? 0.4 : 0.8) * ppcm); g.stroke(); }
    g.font = `600 ${Math.round(0.85 * ppcm)}px -apple-system,Helvetica,Arial,sans-serif`; g.fillText('0', bx - 0.25 * ppcm, by - 1.1 * ppcm); g.fillText('10 cm', bx + 9.3 * ppcm, by - 1.1 * ppcm);
    return { canvas: c, views: VW, ppcm, P };
  }
  renderSilGuides(sil) {
    const { api } = this, { K, base } = api, P = sil.P, m = base.meta, ppcm = sil.ppcm, c = mk(sil.canvas.width, sil.canvas.height), g = c.getContext('2d');
    const st = api.guideState(), act = st.focus ? api.members(st.focus) : [], vals = api.values(), S = K.stationS(base, P);
    const tp = S.tp, rings = {};
    for (const id of ['c_axila', 'c_biceps', 'c_codo', 'c_antebrazo', 'c_muneca']) rings[id] = K.ringLoop(base, P, S.s[id], 0.12);
    const hg = K.handGuides(base, P);
    const merPts = tp.pts.map((p, i) => ({ s: tp.S[i], p: K.outward(base, P, p, tp.S[i], 0.12), c: (K.ringLoop(base, P, tp.S[i], 0) || { centre: p }).centre }));
    const font = (w, s) => `${w} ${Math.round(s * ppcm)}px -apple-system,Helvetica,Arial,sans-serif`;
    for (const v of sil.views) {
      const sty = id => { const on = act.includes(id); g.globalAlpha = st.focus && !on ? 0.3 : 1; const col = on ? HI_D : PINK_D; g.strokeStyle = col; g.lineWidth = (on ? 0.22 : 0.13) * ppcm; return col; };
      const poly = (pts, closed, centre) => { // tramos visibles continuos, ocultos discontinuos
        const N = pts.length, segN = closed ? N : N - 1;
        for (let i = 0; i < segN; i++) { const a = pts[i], b = pts[(i + 1) % N], ce = centre(i), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          const front = dot([mid[0] - ce[0], mid[1] - ce[1], mid[2] - ce[2]], v.d) >= -0.05; g.setLineDash(front ? [] : [0.35 * ppcm, 0.3 * ppcm]);
          const pa = v.px(a), pb = v.px(b); g.beginPath(); g.moveTo(...pa); g.lineTo(...pb); g.stroke(); } g.setLineDash([]); };
      const label = (id, anchor, side, col) => { // insignia + texto con línea guía
        const tx = side > 0 ? v.X0 + (v.xmax + 1.6) * ppcm : v.X0 + (v.xmin - 1.6) * ppcm, ty = anchor[1];
        g.lineWidth = 0.05 * ppcm; g.strokeStyle = col; g.setLineDash([0.2 * ppcm, 0.2 * ppcm]); g.beginPath(); g.moveTo(...anchor); g.lineTo(tx - side * 0.8 * ppcm, ty); g.stroke(); g.setLineDash([]);
        this._badge(g, tx, ty, api.num[id], col, 0.7 * ppcm, g.globalAlpha);
        const a = g.globalAlpha; g.globalAlpha = a; g.fillStyle = '#1d1b1a'; g.textBaseline = 'middle'; g.textAlign = side > 0 ? 'left' : 'right';
        g.font = font(700, 0.95); g.fillText(SHORT[id], tx + side * 0.95 * ppcm, ty - 0.5 * ppcm); g.font = font(400, 0.95);
        g.fillText(vals[id] != null ? fmt(vals[id]) + (id === 'ancho_nudillos' ? ' ancho' : '') : '—', tx + side * 0.95 * ppcm, ty + 0.6 * ppcm); g.globalAlpha = 1; };
      // contornos (derecha)
      for (const id of Object.keys(rings)) { const R = rings[id]; if (!R) continue; const col = sty(id); poly(R.pts, true, () => R.centre);
        let best = R.pts[0]; for (const q of R.pts) if (dot(q, v.right) > dot(best, v.right)) best = q; g.globalAlpha = st.focus && !act.includes(id) ? 0.3 : 1; label(id, v.px(best), 1, col); }
      if (hg) { let col = sty('ancho_nudillos'); poly(hg.ring, true, () => hg.ring.reduce((s, q) => [s[0] + q[0] / hg.ring.length, s[1] + q[1] / hg.ring.length, s[2] + q[2] / hg.ring.length], [0, 0, 0]));
        let best = hg.ring[0]; for (const q of hg.ring) if (dot(q, v.right) > dot(best, v.right)) best = q; label('ancho_nudillos', v.px(best), 1, col);
        col = sty('largo_mano'); g.setLineDash([0.3 * ppcm, 0.2 * ppcm]); g.beginPath(); g.moveTo(...v.px(hg.wc)); g.lineTo(...v.px(hg.tip)); g.stroke(); g.setLineDash([]);
        label('largo_mano', v.px(hg.tip), -1, col); }
      // largos (izquierda)
      for (const [id, lo, hi] of [['hombro_codo', m.S_EL, m.s_tip], ['codo_muneca', m.S_WR, m.S_EL]]) {
        const col = sty(id), Q = merPts.filter(q => q.s >= lo - 1e-6 && q.s <= hi + 1e-6); poly(Q.map(q => q.p), false, i => Q[i].c);
        for (const q of [Q[0], Q[Q.length - 1]]) { const p = v.px(q.p); g.beginPath(); g.arc(p[0], p[1], 0.3 * ppcm, 0, 7); g.fillStyle = col; g.fill(); }
        const mid = Q[Math.floor(Q.length / 2)]; let lp = v.px(mid.p); label(id, lp, -1, col); }
      { const col = act.includes('hombro_muneca') ? HI_D : PINK_D; g.globalAlpha = st.focus && !act.includes('hombro_muneca') ? 0.3 : 1; label('hombro_muneca', v.px(merPts[0].p), -1, col); }
      g.globalAlpha = 1;
    }
    return c;
  }
  // ---------- exportación ----------
  exportCanvas() {
    if (this.mode === 'tex') { const t = this.cache.tex || this.renderTex(), gd = this.renderTexGuides(), c = mk(t.width, t.height), g = c.getContext('2d'); g.drawImage(t, 0, 0); g.drawImage(gd, 0, 0); return c; }
    const sil = this.renderSil(28, 4), gd = this.renderSilGuides(sil), g = sil.canvas.getContext('2d'); g.drawImage(gd, 0, 0); return sil.canvas;
  }
}
