// Editor «Foto del brazo»: cuentagotas (tono de piel), recortar tatuajes con lazo y borde suave, medir (calibración).
// Táctil (iPad/iPhone), Apple Pencil y ratón. Dos dedos o la rueda: mover/acercar la foto.
// El alto que se escribe es el de la TINTA (H9): se marca con dos toques («Marcar el alto») o se detecta sola dentro
// del lazo. «Desenrollar» (H22) corrige la foto de un brazo curvo: el ancho sale como el arco sobre la piel.
import {
  averageColor,
  blurAlpha,
  altoFromCalib,
  inkRows,
  medianColor,
  rgbOf,
  arcOfCol,
  unrollCols,
} from './foto.js?v=10';

const $ = id => document.getElementById(id);
const MAX_PHOTO = 2048; // px del lado mayor (memoria en iOS)
const MAX_CUT = 1024; // px del lado mayor de cada recorte
const RING = 6; // px por fuera del lazo donde se mide el tono de la piel (para separar la tinta)
const WIDE_CM = 5; // a partir de este ancho se recomienda «Desenrollar» (−6 % en un antebrazo de 25 cm)
const INFO = {
  brazo1: 'Toca el borde izquierdo y el derecho del brazo, a la altura del tatuaje.',
  brazo2: 'Ahora toca el otro borde del brazo.',
  tinta: 'El alto que escribas se aplica a la tinta, no al hueco del lazo.',
  sinTinta: 'No se distingue la tinta de la piel: el alto se aplica a todo lo rodeado (o usa «Marcar el alto»).',
  fuera: '⚠ El recorte se sale de los bordes del brazo marcados: vuelve a «Desenrollar».',
  ancho: 'Si rodea el brazo, usa «↔ Desenrollar» para que no salga más estrecho que en la piel.',
  brazoOn: 'Desenrollar activo (líneas verdes).',
};

export class FotoEditor {
  constructor({ onTone, onCut, toCm }) {
    this.onTone = onTone;
    this.onCut = onCut;
    this.toCm = toCm; // texto → número (acepta coma)
    this.root = $('editor');
    this.cv = $('edCanvas');
    this.tool = 'gotas';
    this.marking = null; // dentro de «Recortar»: 'alto' (marcar el alto) o 'brazo' (desenrollar)
    this.v = { s: 1, tx: 0, ty: 0 };
    this.lasso = null;
    this.line = null;
    this.altoMark = null; // { a, b, pending }: línea de arriba abajo de la tinta (px de la foto)
    this.brazo = null; // [xl, xr]: bordes del brazo a la altura del tatuaje (px de la foto)
    this.brazoY = 0;
    this.brazoPend = null;
    this.cmPerPx = null;
    this.probe = null;
    this.sample = null;
    this.tone = null;
    this.dpr = 1;
    this._wire();
  }
  // ---------- abrir / cerrar ----------
  // img: foto nueva (Image) o this.src (volver al editor con la misma foto, ya reducida: sin decodificar otra vez)
  open(img) {
    const same = img === this.src;
    if (!same) {
      const [w, h] = fit(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_PHOTO);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h); // con la orientación EXIF aplicada
      if (this.src) this.src.width = this.src.height = 0; // libera la foto anterior
      this.src = c;
      // foto nueva: calibración, alto y desenrollar, de cero (con la misma foto se conservan)
      this.cmPerPx = this.line = null;
      this.brazo = this.brazoPend = null;
      $('edMideCm').value = '';
      $('edAlto').value = '';
      $('edEscala').textContent = 'Sin calibrar: escribe el alto a mano.';
    }
    const g = this.src.getContext('2d', { willReadFrequently: true });
    this.data = g.getImageData(0, 0, this.src.width, this.src.height).data;
    this.lasso = this.probe = this.sample = this.altoMark = this._stroke = null;
    this.tone = null;
    $('edUsarTono').disabled = true;
    $('edRecortar').disabled = true;
    $('edHex').textContent = 'Toca la piel en una zona con buena luz.';
    $('edSwatch').style.background = 'transparent';
    this.opener = document.activeElement;
    for (const el of document.querySelectorAll('header, main')) el.inert = true; // el foco no sale del editor
    this.root.hidden = false;
    document.documentElement.classList.add('editing');
    this.setTool('gotas');
    this._info();
    this.root.querySelector('#edTools [aria-pressed="true"]').focus();
    requestAnimationFrame(() => {
      this._size();
      this.fit();
      this.draw();
    });
  }
  close() {
    this.root.hidden = true;
    document.documentElement.classList.remove('editing');
    for (const el of document.querySelectorAll('header, main')) el.inert = false;
    // memoria (iOS): se suelta la imagen de pantalla y los píxeles; la foto reducida se guarda para «Volver al editor»
    this.cv.width = this.cv.height = 0;
    this.data = null;
    this.probe = null;
    const back =
      this.opener && this.opener.isConnected && !this.opener.closest('#editor') ? this.opener : $('fotoEditar');
    if (back && !back.hidden) back.focus();
  }
  get isOpen() {
    return !this.root.hidden;
  }
  setTool(t) {
    this.tool = t;
    this.root.querySelectorAll('#edTools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t));
    this.root.querySelectorAll('.ed-panel [data-p]').forEach(p => {
      p.hidden = p.dataset.p !== t;
    });
    this.cv.dataset.tool = t;
    this.setMarking(null);
  }
  // «📏 Marcar el alto» / «↔ Desenrollar»: lo que hace el dedo dentro de «Recortar»
  setMarking(m) {
    this.marking = m;
    if (m !== 'brazo') this.brazoPend = null;
    if (m !== 'alto' && this.altoMark && this.altoMark.pending) this.altoMark = this._prevMark || null;
    $('edMarcar').setAttribute('aria-pressed', String(m === 'alto'));
    $('edDesenrollar').setAttribute('aria-pressed', String(m === 'brazo'));
    $('edBrazoQuitar').hidden = !this.brazo;
    if (m) this._info(m === 'alto' ? 'Toca arriba y abajo de la tinta (o traza la línea).' : null);
    this.draw();
  }
  // ---------- vista ----------
  _size() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr));
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.cw = r.width;
    this.ch = r.height;
  }
  fit() {
    if (!this.src) return;
    const s = Math.min(this.cw / this.src.width, this.ch / this.src.height) * 0.95;
    this.v = { s, tx: (this.cw - this.src.width * s) / 2, ty: (this.ch - this.src.height * s) / 2 };
  }
  toImg(x, y) {
    return [(x - this.v.tx) / this.v.s, (y - this.v.ty) / this.v.s];
  }
  toView(x, y) {
    return [x * this.v.s + this.v.tx, y * this.v.s + this.v.ty];
  }
  // para las pruebas: coordenadas de pantalla (CSS, página) de un punto de la foto
  imgToClient(x, y) {
    const r = this.cv.getBoundingClientRect(),
      [vx, vy] = this.toView(x, y);
    return [r.left + vx, r.top + vy];
  }
  probeRadius() {
    return Math.max(4, 0.01 * Math.min(this.src.width, this.src.height));
  }
  draw() {
    if (!this.src || this.root.hidden) return;
    const g = this.cv.getContext('2d'),
      d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#111';
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(d * this.v.s, 0, 0, d * this.v.s, d * this.v.tx, d * this.v.ty);
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.src, 0, 0);
    g.setTransform(d, 0, 0, d, 0, 0);
    const lw = 2;
    this._drawBrazo(g);
    if (this.lasso && this.lasso.pts.length > 1) {
      g.beginPath();
      this.lasso.pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](...this.toView(x, y)));
      if (this.lasso.closed) {
        g.closePath();
        g.fillStyle = 'rgba(255,61,154,0.18)';
        g.fill();
      }
      g.lineWidth = lw + 2;
      g.strokeStyle = 'rgba(0,0,0,.6)';
      g.stroke();
      g.lineWidth = lw;
      g.setLineDash([6, 4]);
      g.strokeStyle = '#ff3d9a';
      g.stroke();
      g.setLineDash([]);
    }
    // caja de la tinta detectada (a ella se aplica el alto si no se marca a mano)
    const ink = this.lasso && this.lasso.closed && this.lasso.ink;
    if (ink) {
      const [ax, ay] = this.toView(ink.left, ink.top),
        [bx, by] = this.toView(ink.right + 1, ink.bottom + 1);
      g.lineWidth = 2;
      g.setLineDash([5, 3]);
      g.strokeStyle = this.altoMark && !this.altoMark.pending ? 'rgba(56,200,255,.45)' : '#38c8ff';
      g.strokeRect(ax, ay, bx - ax, by - ay);
      g.setLineDash([]);
    }
    if (this.line) this._drawLine(g, this.line[0], this.line[1], false);
    if (this.altoMark) this._drawLine(g, this.altoMark.a, this.altoMark.pending ? null : this.altoMark.b, true);
    if (this.probe) this._loupe(g);
  }
  // línea amarilla de «Medir» o del alto marcado (con rayas horizontales: lo que cuenta es la altura)
  _drawLine(g, p, q, ticks) {
    const a = this.toView(...p),
      b = q ? this.toView(...q) : null;
    g.lineWidth = 3;
    g.strokeStyle = '#ffd400';
    g.fillStyle = '#ffd400';
    if (b) {
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...b);
      g.stroke();
    }
    for (const c of b ? [a, b] : [a]) {
      g.beginPath();
      g.arc(c[0], c[1], 6, 0, 2 * Math.PI);
      g.fill();
      if (!ticks) continue;
      g.beginPath();
      g.moveTo(c[0] - 26, c[1]);
      g.lineTo(c[0] + 26, c[1]);
      g.stroke();
    }
  }
  // bordes del brazo para desenrollar (verde)
  _drawBrazo(g) {
    const xs = this.brazo ? this.brazo : this.brazoPend ? [this.brazoPend[0]] : [];
    if (!xs.length) return;
    g.lineWidth = 2;
    g.strokeStyle = '#5bea7a';
    g.setLineDash([8, 5]);
    for (const x of xs) {
      g.beginPath();
      g.moveTo(...this.toView(x, 0));
      g.lineTo(...this.toView(x, this.src.height));
      g.stroke();
    }
    g.setLineDash([]);
    if (this.brazo) {
      const [ax, ay] = this.toView(this.brazo[0], this.brazoY),
        [bx] = this.toView(this.brazo[1], this.brazoY);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, ay);
      for (const [x, s] of [
        [ax, 1],
        [bx, -1],
      ]) {
        g.moveTo(x + 10 * s, ay - 6);
        g.lineTo(x, ay);
        g.lineTo(x + 10 * s, ay + 6);
      }
      g.stroke();
    }
  }
  _loupe(g) {
    const [ix, iy] = this.probe.pt,
      [vx, vy] = this.toView(ix, iy);
    const R = 48,
      Z = 4,
      cx = Math.min(this.cw - R - 8, Math.max(R + 8, vx)), // la lupa no se corta en los bordes
      cy = Math.max(R + 6, vy - R - 40);
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, 2 * Math.PI);
    g.clip();
    g.imageSmoothingEnabled = false;
    const half = R / Z;
    g.drawImage(this.src, ix - half, iy - half, 2 * half, 2 * half, cx - R, cy - R, 2 * R, 2 * R);
    g.restore();
    const rr = (this.probeRadius() * R) / half;
    g.lineWidth = 2;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.arc(cx, cy, rr, 0, 2 * Math.PI);
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = this.probe.hex || '#fff';
    g.beginPath();
    g.arc(cx, cy, R + 3, 0, 2 * Math.PI);
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = '#000';
    g.beginPath();
    g.arc(cx, cy, R + 6.5, 0, 2 * Math.PI);
    g.stroke();
  }
  // ---------- herramientas ----------
  // en vivo sólo la lupa y la muestra de color; el texto (aria-live) se escribe al soltar, para no saturar VoiceOver
  sampleAt(ix, iy) {
    const res = averageColor(this.data, this.src.width, this.src.height, ix, iy, this.probeRadius());
    this.probe = { pt: [ix, iy], hex: res && res.hex };
    if (res) {
      this.sample = res;
      $('edSwatch').style.background = res.hex;
    }
  }
  _toneDone() {
    const res = this.sample;
    if (!res) return;
    this.tone = res.hex;
    $('edHex').textContent = `${res.hex} · ${res.usados} de ${res.n} píxeles (sin brillos ni sombras)`;
    $('edUsarTono').disabled = false;
  }
  _lassoDone() {
    const L = this.lasso;
    if (!L || L.pts.length < 3) return;
    let a = 0;
    for (let i = 0, j = L.pts.length - 1; i < L.pts.length; j = i++)
      a += L.pts[j][0] * L.pts[i][1] - L.pts[i][0] * L.pts[j][1];
    if (Math.abs(a) / 2 < 25) {
      this.lasso = null;
      return;
    }
    L.closed = true;
    const ys = L.pts.map(p => p[1]);
    L.y0 = Math.min(...ys);
    L.hSrc = Math.max(...ys) - L.y0; // alto del trazo en px de la foto
    L.ink = this._detectInk();
    this._altoFromCalib();
    this._refreshCut();
    this._info();
  }
  /**
   * Caja de la tinta dentro del lazo (px de la foto) o null. El tono de la piel se mide justo por fuera del lazo
   * (casi siempre es piel, aunque el lazo vaya pegado a la tinta); si no hay, el del cuentagotas o el borde interior.
   */
  _detectInk() {
    const pts = this.lasso.pts,
      W = this.src.width,
      H = this.src.height,
      M = RING + 2;
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0]))) - M),
      y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1]))) - M),
      x1 = Math.min(W, Math.ceil(Math.max(...pts.map(p => p[0]))) + M),
      y1 = Math.min(H, Math.ceil(Math.max(...pts.map(p => p[1]))) + M),
      w = x1 - x0,
      h = y1 - y0;
    if (w < 3 || h < 3) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    const path = () => {
      g.beginPath();
      pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x - x0, y - y0));
      g.closePath();
    };
    const alphaOf = () => {
      const d = g.getImageData(0, 0, w, h).data,
        a = new Uint8ClampedArray(w * h);
      for (let i = 0; i < a.length; i++) a[i] = d[4 * i + 3];
      return a;
    };
    // anillo por fuera del lazo = trazo grueso menos el interior
    g.lineWidth = 2 * RING;
    g.lineJoin = 'round';
    g.strokeStyle = g.fillStyle = '#000';
    path();
    g.stroke();
    g.globalCompositeOperation = 'destination-out';
    path();
    g.fill();
    g.globalCompositeOperation = 'source-over';
    const ring = alphaOf();
    g.clearRect(0, 0, w, h);
    path();
    g.fill();
    const mask = alphaOf();
    c.width = c.height = 0;
    const rgba = new Uint8ClampedArray(4 * w * h);
    for (let y = 0; y < h; y++) {
      const o = 4 * (y0 + y) * W;
      rgba.set(this.data.subarray(o + 4 * x0, o + 4 * x1), 4 * y * w);
    }
    const skin = medianColor(rgba, ring, w, h) || (this.tone && rgbOf(this.tone)) || null;
    const r = inkRows(rgba, mask, w, h, skin);
    return r && { top: r.top + y0, bottom: r.bottom + y0, left: r.left + x0, right: r.right + x0 };
  }
  /**
   * Altura (px de la foto) a la que se aplica el alto escrito: la marcada a mano, la de la tinta detectada o, si no se
   * distingue la tinta, la de todo lo rodeado.
   */
  refH() {
    const m = this.altoMark;
    if (m && !m.pending && Math.abs(m.b[1] - m.a[1]) > 5) return { h: Math.abs(m.b[1] - m.a[1]), por: 'marca' };
    const L = this.lasso;
    if (!L || !L.closed) return null;
    if (L.ink) return { h: L.ink.bottom - L.ink.top + 1, por: 'tinta' };
    return { h: L.hSrc, por: 'trazo' };
  }
  // texto de ayuda del panel del lazo (qué alto se usa, avisos de «Desenrollar»)
  _info(msg) {
    const el = $('edTinta');
    if (msg) {
      el.textContent = msg;
      return;
    }
    const r = this.refH(),
      L = this.lasso && this.lasso.closed ? this.lasso : null,
      out = [];
    if (this.marking === 'brazo') out.push(this.brazoPend ? INFO.brazo2 : INFO.brazo1);
    if (r && r.por === 'marca') out.push(`Alto marcado a mano: ${Math.round(r.h)} px de la foto (líneas amarillas).`);
    else if (r && r.por === 'tinta') out.push(`Tinta detectada: ${r.h} px de alto (caja azul). ${INFO.tinta}`);
    else if (r) out.push(INFO.sinTinta);
    const alto = this.toCm($('edAlto').value);
    if (L && r && alto > 0) {
      const x0 = L.ink ? L.ink.left : Math.min(...L.pts.map(p => p[0])),
        x1 = L.ink ? L.ink.right + 1 : Math.max(...L.pts.map(p => p[0])),
        ancho = ((x1 - x0) * alto) / r.h;
      if (this.brazo && (x0 < this.brazo[0] || x1 > this.brazo[1])) out.push(INFO.fuera);
      else if (this.brazo) out.push(`Desenrollado sobre un brazo de ${Math.round(this.brazo[1] - this.brazo[0])} px.`);
      else if (ancho >= WIDE_CM) out.push(`Recorte ancho (≈ ${fmt(ancho)} cm). ${INFO.ancho}`);
    } else if (this.brazo) out.push(INFO.brazoOn);
    el.textContent = out.join(' ');
  }
  _refreshCut() {
    const alto = this.toCm($('edAlto').value);
    $('edRecortar').disabled = !(this.lasso && this.lasso.closed && alto > 0.5 && alto < 80);
  }
  _altoFromCalib() {
    const r = this.refH();
    if (this.cmPerPx && r) $('edAlto').value = fmt(altoFromCalib(r.h, this.cmPerPx));
  }
  _calib() {
    if (!this.line) return;
    const cm = this.toCm($('edMideCm').value),
      px = Math.hypot(this.line[1][0] - this.line[0][0], this.line[1][1] - this.line[0][1]);
    if (cm > 0 && px > 5) {
      this.cmPerPx = cm / px;
      $('edEscala').textContent =
        `Calibrado: 10 cm = ${Math.round(10 / this.cmPerPx)} px de la foto. El alto de los recortes se calcula solo.`;
      this._altoFromCalib();
      this._refreshCut();
    }
  }
  // «Marcar el alto»: dos toques (o una línea) arriba y abajo de la tinta
  _markDown(p) {
    if (this.altoMark && this.altoMark.pending) {
      this.altoMark.b = p;
      this.altoMark.pending = false;
    } else {
      this._prevMark = this.altoMark;
      this.altoMark = { a: p, b: p, pending: false };
    }
    this._stroke = 'alto';
  }
  _markUp() {
    const m = this.altoMark;
    if (!m) return;
    if (Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * this.v.s < 6) {
      m.pending = true; // primer toque: falta el segundo
      return;
    }
    this._stroke = null;
    this.setMarking(null);
    this._altoFromCalib();
    this._refreshCut();
    this._info();
  }
  // «Desenrollar»: un toque en cada borde del brazo
  _brazoUp(p) {
    if (!this.brazoPend) {
      this.brazoPend = p;
      this._info();
      return;
    }
    const xl = Math.min(p[0], this.brazoPend[0]),
      xr = Math.max(p[0], this.brazoPend[0]);
    this.brazoY = (p[1] + this.brazoPend[1]) / 2;
    this.brazoPend = null;
    this.brazo = xr - xl > 10 ? [xl, xr] : null;
    this.setMarking(null);
    this._info();
  }
  // trazo a medias que se abandona (segundo dedo, palma, gesto cancelado): se vuelve a lo que había
  _abortStroke() {
    if (this.lasso && !this.lasso.closed) this.lasso = null;
    if (this._stroke === 'medir') this.line = this._prevLine || null;
    if (this._stroke === 'alto') this.altoMark = this._prevMark || null;
    this._stroke = null;
  }
  /** Recorte del lazo → canvas con transparencia (borde suave); desenrollado si se marcaron los bordes del brazo. */
  cut(feather) {
    const pts = this.lasso.pts,
      W = this.src.width,
      H = this.src.height;
    const f = Math.max(0, feather);
    let x0 = Math.floor(Math.min(...pts.map(p => p[0])) - f),
      y0 = Math.floor(Math.min(...pts.map(p => p[1])) - f),
      x1 = Math.ceil(Math.max(...pts.map(p => p[0])) + f),
      y1 = Math.ceil(Math.max(...pts.map(p => p[1])) + f);
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(W, x1);
    y1 = Math.min(H, y1);
    const bh = y1 - y0,
      un = this.brazo && { xc: (this.brazo[0] + this.brazo[1]) / 2, R: (this.brazo[1] - this.brazo[0]) / 2 },
      bw = un ? arcOfCol(x1, un.xc, un.R) - arcOfCol(x0, un.xc, un.R) : x1 - x0,
      k = Math.min(1, MAX_CUT / Math.max(bw, bh)),
      cols = un ? unrollCols(x0, x1, un.xc, un.R, k) : null,
      cw = cols ? cols.w : Math.max(1, Math.round(bw * k)),
      ch = Math.max(1, Math.round(bh * k)),
      xOf = cols ? cols.xOf : x => (x - x0) * k;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const g = out.getContext('2d', { willReadFrequently: true });
    if (cols) {
      // H22: cada columna del recorte es un trozo igual de arco sobre la piel (más ancho que en la foto)
      g.imageSmoothingEnabled = true;
      for (let X = 0; X < cw; X++) {
        const sx = Math.min(W - 1, Math.max(0, cols.sx[X] - 0.5));
        g.drawImage(this.src, sx, y0, 1, bh, X, 0, 1, ch);
      }
    } else g.drawImage(this.src, x0, y0, bw, bh, 0, 0, cw, ch);
    const m = document.createElement('canvas');
    m.width = cw;
    m.height = ch;
    const mg = m.getContext('2d', { willReadFrequently: true });
    mg.fillStyle = '#000';
    mg.beginPath();
    pts.forEach(([x, y], i) => mg[i ? 'lineTo' : 'moveTo'](xOf(x), (y - y0) * k));
    mg.closePath();
    mg.fill();
    const md = mg.getImageData(0, 0, cw, ch).data,
      a = new Uint8ClampedArray(cw * ch);
    for (let i = 0; i < a.length; i++) a[i] = md[4 * i + 3];
    const soft = blurAlpha(a, cw, ch, f * k);
    const id = g.getImageData(0, 0, cw, ch);
    for (let i = 0; i < a.length; i++) id.data[4 * i + 3] = (id.data[4 * i + 3] * soft[i]) / 255;
    g.putImageData(id, 0, 0);
    m.width = m.height = 0;
    // el alto en cm se aplica a la tinta (o a lo marcado), no al lienzo con el hueco del lazo y el borde suave (H9)
    const r = this.refH();
    return { canvas: out, traceH: (r ? r.h : bh) * k, por: r ? r.por : 'trazo' };
  }
  // ---------- eventos ----------
  _wire() {
    const cv = this.cv,
      P = new Map(),
      kind = new Map(); // tipo de cada puntero: con el Apple Pencil apoyado, la palma (touch) no cuenta
    let last = null,
      panning = false;
    const xy = e => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const zoomAt = (f, x, y) => {
      const s2 = Math.min(40, Math.max(0.05, this.v.s * f));
      f = s2 / this.v.s;
      this.v.tx = x - (x - this.v.tx) * f;
      this.v.ty = y - (y - this.v.ty) * f;
      this.v.s = s2;
    };
    const penDown = () => [...kind.values()].includes('pen');
    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && penDown()) return; // palma apoyada mientras se dibuja con el lápiz
      if (e.pointerType === 'pen' && P.size) {
        // la palma llegó antes que el lápiz: se olvida, con lo que hubiera empezado
        for (const [id, t] of [...kind])
          if (t !== 'pen') {
            P.delete(id);
            kind.delete(id);
          }
        this._abortStroke();
        panning = false;
      }
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        // puntero ya suelto o sintético: se sigue sin captura
      }
      P.set(e.pointerId, xy(e));
      kind.set(e.pointerId, e.pointerType);
      last = null;
      if (P.size > 1) {
        // dos dedos: se abandona el trazo en curso y se mueve/acerca la foto
        this._abortStroke();
        this.probe = null;
        panning = true;
        this.draw();
        return;
      }
      panning = this.tool === 'mover' || e.button === 1;
      if (panning) return;
      const [ix, iy] = this.toImg(...xy(e));
      if (this.tool === 'gotas') this.sampleAt(ix, iy);
      else if (this.tool === 'lazo' && this.marking === 'alto') this._markDown([ix, iy]);
      else if (this.tool === 'lazo' && this.marking === 'brazo') this._brazoAt = [ix, iy];
      else if (this.tool === 'lazo') {
        this.lasso = { pts: [[ix, iy]], closed: false };
        $('edRecortar').disabled = true;
      } else if (this.tool === 'medir') {
        this._prevLine = this.line; // si se cancela, vuelve la línea (y la calibración) de antes
        this._stroke = 'medir';
        this.line = [
          [ix, iy],
          [ix, iy],
        ];
      }
      this.draw();
    });
    cv.addEventListener('pointermove', e => {
      if (!P.has(e.pointerId)) return;
      const prev = P.get(e.pointerId),
        cur = xy(e);
      P.set(e.pointerId, cur);
      if (P.size === 2) {
        const [a, b] = [...P.values()],
          dist = Math.hypot(a[0] - b[0], a[1] - b[1]),
          mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (last) {
          this.v.tx += mid[0] - last.mid[0];
          this.v.ty += mid[1] - last.mid[1];
          zoomAt(dist / last.dist, mid[0], mid[1]);
        }
        last = { dist, mid };
        this.draw();
        return;
      }
      if (P.size !== 1) return;
      if (panning) {
        this.v.tx += cur[0] - prev[0];
        this.v.ty += cur[1] - prev[1];
        this.draw();
        return;
      }
      const [ix, iy] = this.toImg(...cur);
      if (this.tool === 'gotas') this.sampleAt(ix, iy);
      else if (this.tool === 'lazo' && this.marking === 'alto') {
        if (this.altoMark && !this.altoMark.pending) this.altoMark.b = [ix, iy];
      } else if (this.tool === 'lazo' && this.marking === 'brazo') this._brazoAt = [ix, iy];
      else if (this.tool === 'lazo' && this.lasso && !this.lasso.closed) {
        const q = this.lasso.pts[this.lasso.pts.length - 1];
        if (Math.hypot(ix - q[0], iy - q[1]) * this.v.s > 2) this.lasso.pts.push([ix, iy]);
      } else if (this.tool === 'medir' && this.line) this.line[1] = [ix, iy];
      this.draw();
    });
    const up = e => {
      if (!P.has(e.pointerId)) return;
      P.delete(e.pointerId);
      kind.delete(e.pointerId);
      last = null;
      if (P.size) return;
      if (!panning) {
        if (this.tool === 'lazo' && this.marking === 'alto') this._markUp();
        else if (this.tool === 'lazo' && this.marking === 'brazo' && this._brazoAt) this._brazoUp(this._brazoAt);
        else if (this.tool === 'lazo') this._lassoDone();
        if (this.tool === 'medir') {
          this._stroke = null;
          this._calib();
          if (this.line && !this.cmPerPx) $('edMideCm').focus();
        }
        if (this.tool === 'gotas') {
          this._toneDone();
          this.probe = null;
        }
      }
      this._brazoAt = null;
      panning = false;
      this.draw();
    };
    cv.addEventListener('pointerup', up);
    // gesto cancelado por el sistema (p. ej. pasada desde el borde en iOS): el trazo a medias no vale
    cv.addEventListener('pointercancel', e => {
      this._abortStroke();
      panning = true; // no cerrar ni calibrar
      up(e);
    });
    cv.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        const [x, y] = xy(e);
        zoomAt(Math.exp(-e.deltaY * 0.0015), x, y);
        this.draw();
      },
      { passive: false },
    );
    new ResizeObserver(() => {
      if (this.root.hidden) return;
      this._size();
      this.draw();
    }).observe(cv);
    this.root.querySelectorAll('#edTools button').forEach(b => {
      b.onclick = () => this.setTool(b.dataset.t);
    });
    $('edListo').onclick = () => this.close();
    $('edEncajar').onclick = () => {
      this.fit();
      this.draw();
    };
    $('edUsarTono').onclick = () => {
      if (this.tone) this.onTone(this.tone);
    };
    $('edAlto').addEventListener('input', () => {
      this._refreshCut();
      this._info();
    });
    $('edMideCm').addEventListener('input', () => this._calib());
    $('edMarcar').onclick = () => this.setMarking(this.marking === 'alto' ? null : 'alto');
    $('edDesenrollar').onclick = () => this.setMarking(this.marking === 'brazo' ? null : 'brazo');
    $('edBrazoQuitar').onclick = () => {
      this.brazo = this.brazoPend = null;
      this.setMarking(null);
      this._info();
      $('edDesenrollar').focus();
    };
    $('edBorrar').onclick = () => {
      this.lasso = this.altoMark = null;
      $('edRecortar').disabled = true;
      this._info();
      this.draw();
    };
    $('edRecortar').onclick = () => {
      const alto = this.toCm($('edAlto').value);
      if (!(this.lasso && this.lasso.closed && alto > 0)) return;
      const feather = (+$('edBorde').value / 100) * Math.min(this.src.width, this.src.height) * 0.1;
      const { canvas, traceH } = this.cut(feather);
      this.onCut({ canvas, traceH, name: $('edNombre').value.trim(), alto });
      this.lasso = this.altoMark = null;
      $('edNombre').value = '';
      if (!this.cmPerPx) $('edAlto').value = ''; // el siguiente recorte no hereda el alto de este
      $('edRecortar').disabled = true;
      this.setMarking(null);
      this._info();
    };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }
}
const fit = (w, h, max) => {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
};
const fmt = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
