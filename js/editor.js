// Editor «Foto del brazo»: cuentagotas (tono de piel), recortar tatuajes con lazo y borde suave, medir (calibración).
// Táctil (iPad/iPhone), Apple Pencil y ratón. Dos dedos o la rueda: mover/acercar la foto.
// El alto que se escribe es el de la TINTA (H9): se marca con dos toques («Marcar el alto») o se detecta sola dentro
// del lazo (caja azul, que hay que confirmar: H30). «Desenrollar» (H22) corrige la foto de un brazo curvo: el ancho sale
// como el arco sobre la piel. «Enderezar» y «Girar 90°» (H29) dejan el brazo vertical, con el hombro arriba.
import {
  averageColor,
  blurAlpha,
  altoFromCalib,
  inkRows,
  medianColor,
  rgbOf,
  arcOfCol,
  unrollCols,
  straightenAngle,
  rotateGeom,
} from './foto.js?v=13';

const $ = id => document.getElementById(id);
const MAX_PHOTO = 2048; // px del lado mayor (memoria en iOS)
const MAX_CUT = 1024; // px del lado mayor de cada recorte
const RING = 6; // px por fuera del lazo donde se mide el tono de la piel (para separar la tinta)
const WIDE_CM = 5; // a partir de este ancho se recomienda «Desenrollar» (−6 % en un antebrazo de 25 cm)
const INFO = {
  brazo1: 'Toca el borde izquierdo y el derecho del brazo, a la altura del tatuaje.',
  brazo2: 'Ahora toca el otro borde del brazo.',
  eje1: 'Toca el brazo cerca del hombro y luego cerca de la mano: la foto se gira para dejarlo vertical.',
  eje2: 'Ahora toca el brazo cerca de la mano.',
  tinta: 'Tinta detectada (caja azul): debe tocar los bordes del dibujo, tallos y trazos finos incluidos.',
  dudoso: '⚠ Tinta detectada con trazos sueltos (¿un pelo?): si la caja azul no cuadra, usa «Marcar el alto».',
  sinTinta: 'No se distingue la tinta: la caja azul es todo lo rodeado. Si sobra piel, usa «Marcar el alto».',
  confirmar: 'Para añadirlo, confirma la caja azul o marca el alto.',
  fuera: '⚠ El recorte se sale de los bordes del brazo marcados: vuelve a «Desenrollar».',
  otraAltura: '⚠ Los bordes del brazo están a otra altura: vuelve a «Desenrollar».',
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
    this.marking = null; // 'alto' (marcar el alto) o 'brazo' (desenrollar), dentro de «Recortar»; 'eje' (enderezar)
    this.v = { s: 1, tx: 0, ty: 0 };
    this.lasso = null;
    this.line = null;
    this.altoMark = null; // { a, b, pending }: línea de arriba abajo de la tinta (px de la foto)
    this.brazo = null; // [xl, xr]: bordes del brazo a la altura del tatuaje (px de la foto)
    this.brazoY = 0;
    this.brazoPend = null;
    this.ejePend = null; // primer toque de «Enderezar» (hacia el hombro)
    this.inkOk = false; // «✓ La caja azul cubre todo el dibujo» (H30); se anula si cambia el lazo o el alto
    this.cmPerPx = null;
    this.altoCal = null; // alto calibrado exacto (el campo muestra su redondeo a 1 mm) (H35)
    this.probe = null;
    this.sample = null;
    this.tone = null;
    this.dpr = 1;
    this._wire();
  }
  // ---------- abrir / cerrar ----------
  // img: foto nueva (Image) o this.src (volver al editor con la misma foto, ya reducida y quizá girada)
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
      this._resetCalib();
      this.brazo = this.brazoPend = null;
      $('edAlto').value = '';
    }
    const g = this.src.getContext('2d', { willReadFrequently: true });
    this.data = g.getImageData(0, 0, this.src.width, this.src.height).data;
    this.lasso = this.probe = this.sample = this.altoMark = this._stroke = this.ejePend = null;
    this.inkOk = false;
    this.tone = null;
    $('edUsarTono').disabled = true;
    $('edRecortar').disabled = true;
    $('edHex').textContent = 'Toca la piel en una zona con buena luz.';
    $('edSwatch').style.background = 'transparent';
    this._aviso('Brazo recto y vertical, hombro arriba. Si la foto salió torcida, usa ⟲ Enderezar.');
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
  // «📏 Marcar el alto» / «↔ Desenrollar» (dentro de «Recortar») y «⟲ Enderezar» (con cualquier herramienta)
  setMarking(m) {
    const was = this.marking;
    this.marking = m;
    if (m !== 'brazo') this.brazoPend = null;
    if (m !== 'eje') this.ejePend = null;
    if (m !== 'alto' && this.altoMark && this.altoMark.pending) this.altoMark = this._prevMark || null;
    $('edMarcar').setAttribute('aria-pressed', String(m === 'alto'));
    $('edDesenrollar').setAttribute('aria-pressed', String(m === 'brazo'));
    $('edEnderezar').setAttribute('aria-pressed', String(m === 'eje'));
    $('edBrazoQuitar').hidden = !this.brazo;
    if (m === 'eje') this._aviso(INFO.eje1);
    else if (was === 'eje') this._aviso('');
    if (m === 'alto') this._info('Toca arriba y abajo de la tinta (o traza la línea).');
    else if (m === 'brazo') this._info();
    this.draw();
  }
  // texto del editor que no depende de la herramienta (enderezar, recorte añadido); se anuncia (aria-live)
  _aviso(t) {
    const el = $('edAviso');
    if (el.textContent !== t) el.textContent = t;
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
    this.userView = false; // encajada: si cambia el tamaño del lienzo (panel de otra herramienta) se vuelve a encajar
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
  // caja azul: la tinta detectada o, si no se distingue, todo lo rodeado (px de la foto, bordes continuos)
  _blueBox() {
    const L = this.lasso;
    if (!L || !L.closed) return null;
    if (L.ink) return { left: L.ink.left, top: L.ink.top, right: L.ink.right + 1, bottom: L.ink.bottom + 1 };
    const xs = L.pts.map(p => p[0]),
      ys = L.pts.map(p => p[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
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
    // caja azul: la tinta detectada (a ella se aplica el alto si no se marca a mano)
    const box = this._blueBox();
    if (box) {
      const [ax, ay] = this.toView(box.left, box.top),
        [bx, by] = this.toView(box.right, box.bottom);
      g.lineWidth = this.inkOk ? 3 : 2;
      g.setLineDash(this.inkOk ? [] : [5, 3]);
      g.strokeStyle = this.altoMark && !this.altoMark.pending ? 'rgba(56,200,255,.45)' : '#38c8ff';
      g.strokeRect(ax, ay, bx - ax, by - ay);
      g.setLineDash([]);
    }
    if (this.line) this._drawLine(g, this.line[0], this.line[1], false);
    if (this.altoMark) this._drawLine(g, this.altoMark.a, this.altoMark.pending ? null : this.altoMark.b, true);
    if (this.ejePend) {
      const [x, y] = this.toView(...this.ejePend);
      g.fillStyle = '#5bd8ff';
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 7, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
    }
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
  // bordes del brazo para desenrollar (verde), sólo a la altura marcada (H33)
  _drawBrazo(g) {
    const xs = this.brazo ? this.brazo : this.brazoPend ? [this.brazoPend[0]] : [];
    if (!xs.length) return;
    const yc = this.brazo ? this.brazoY : this.brazoPend[1],
      ext = this.brazo ? Math.max(20, 0.3 * (this.brazo[1] - this.brazo[0])) : 30;
    g.lineWidth = 2;
    g.strokeStyle = '#5bea7a';
    g.setLineDash([8, 5]);
    for (const x of xs) {
      g.beginPath();
      g.moveTo(...this.toView(x, yc - ext));
      g.lineTo(...this.toView(x, yc + ext));
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
  // ---------- enderezar / girar (H29) ----------
  // «⟲ Enderezar»: un toque hacia el hombro y otro hacia la mano
  _ejeUp(p) {
    if (!this.ejePend) {
      this.ejePend = p;
      this._aviso(INFO.eje2);
      return;
    }
    const q0 = this.ejePend;
    this.setMarking(null);
    if (Math.hypot(p[0] - q0[0], p[1] - q0[1]) * this.v.s < 20) {
      this._aviso('Toca dos puntos separados a lo largo del brazo (hombro y mano).');
      return;
    }
    const a = straightenAngle(q0, p);
    if (Math.abs(a) < 0.005) this._aviso('La foto ya está recta.');
    else this._rotate(a, 'Foto enderezada: brazo vertical, hombro arriba. Vuelve a rodear los tatuajes.');
  }
  /**
   * Gira la foto (ya reducida, máx. MAX_PHOTO) el ángulo a (radianes, horario en pantalla). Lo marcado (lazo, línea de
   * «Medir», alto marcado, bordes de «Desenrollar», calibración) estaba en la foto de antes: se borra.
   */
  _rotate(a, msg) {
    const s = this.src,
      R = rotateGeom(s.width, s.height, a, MAX_PHOTO),
      out = document.createElement('canvas');
    out.width = R.W;
    out.height = R.H;
    const g = out.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.setTransform(R.k, 0, 0, R.k, R.W / 2, R.H / 2);
    g.rotate(a);
    g.drawImage(s, -s.width / 2, -s.height / 2);
    s.width = s.height = 0; // libera la foto anterior
    this.src = out;
    this.data = g.getImageData(0, 0, out.width, out.height).data;
    const calibrada = !!this.cmPerPx;
    this.lasso = this.line = this.altoMark = this._prevMark = this._prevLine = this.probe = null;
    this.brazo = this.brazoPend = this.ejePend = null;
    this.inkOk = false;
    this._resetCalib();
    if (calibrada) $('edAlto').value = ''; // era el alto calculado con la calibración
    this.setMarking(null);
    this.fit();
    this._refreshCut();
    this._info();
    this._aviso(msg);
    this.draw();
  }
  _resetCalib() {
    this.cmPerPx = this.line = this.altoCal = null;
    $('edMideCm').value = '';
    $('edEscala').textContent = 'Sin calibrar: escribe el alto a mano.';
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
    this.inkOk = false; // caja nueva: hay que volver a confirmarla
    this._altoFromCalib();
    this._refreshCut();
    this._info();
  }
  /**
   * Caja de la tinta dentro del lazo (px de la foto) o null. El tono de la piel se mide justo por fuera del lazo
   * (casi siempre es piel, aunque el lazo vaya pegado a la tinta), columna a columna (la sombra lateral del brazo);
   * si no hay, el del cuentagotas o el borde interior.
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
    // las esquinas de una foto girada son transparentes: ni piel ni tinta
    for (let i = 0; i < w * h; i++)
      if (rgba[4 * i + 3] < 128) {
        ring[i] = 0;
        mask[i] = 0;
      }
    const skin = medianColor(rgba, ring, w, h) || (this.tone && rgbOf(this.tone)) || null;
    const r = inkRows(rgba, mask, w, h, skin, ring);
    if (!r) return null;
    return { top: r.top + y0, bottom: r.bottom + y0, left: r.left + x0, right: r.right + x0, dudoso: r.dudoso };
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
  /**
   * Caja de referencia del recorte (px de la foto, bordes continuos) (H31): arriba y abajo, lo marcado a mano o la caja
   * azul; izquierda y derecha, la caja azul. El recorte se centra en ella.
   */
  refBox() {
    const box = this._blueBox();
    if (!box) return null;
    const r = this.refH();
    if (r && r.por === 'marca') {
      const m = this.altoMark;
      box.top = Math.min(m.a[1], m.b[1]);
      box.bottom = Math.max(m.a[1], m.b[1]);
    }
    return box;
  }
  // alto escrito (cm); si es el calibrado y el campo sigue mostrando su redondeo, el valor exacto (H35)
  _alto() {
    const v = $('edAlto').value;
    return this.altoCal && v === fmt(this.altoCal) ? this.altoCal : this.toCm(v);
  }
  // ancho de la caja de referencia en cm para un alto dado (arco sobre la piel si se desenrolla)
  _anchoCm(alto) {
    const b = this.refBox(),
      r = this.refH();
    if (!b || !r || !(alto > 0)) return NaN;
    const un = this.brazo && { xc: (this.brazo[0] + this.brazo[1]) / 2, R: (this.brazo[1] - this.brazo[0]) / 2 },
      w = un ? arcOfCol(b.right, un.xc, un.R) - arcOfCol(b.left, un.xc, un.R) : b.right - b.left;
    return (w * alto) / r.h;
  }
  _cajaOk() {
    const r = this.refH();
    return !!r && (r.por === 'marca' || this.inkOk);
  }
  // texto de ayuda del panel del lazo (qué alto se usa, ancho resultante en cm, avisos de «Desenrollar»)
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
    if (r && r.por === 'marca') out.push('Alto marcado a mano (líneas amarillas).');
    else if (r && r.por === 'tinta') out.push(L.ink.dudoso ? INFO.dudoso : INFO.tinta);
    else if (r) out.push(INFO.sinTinta);
    const alto = this._alto();
    if (L && r && alto > 0) {
      const ancho = this._anchoCm(alto),
        b = this.refBox();
      out.push(`Con Alto ${fmt(alto)} cm, el dibujo mide ${fmt1(ancho)} cm de ancho: compruébalo con la regla.`);
      if (!this._cajaOk()) out.push(INFO.confirmar);
      if (this.brazo && (this.brazoY < L.y0 || this.brazoY > L.y0 + L.hSrc)) out.push(INFO.otraAltura);
      else if (this.brazo && (b.left < this.brazo[0] || b.right > this.brazo[1])) out.push(INFO.fuera);
      else if (this.brazo) out.push('Desenrollado: el ancho es el arco sobre la piel.');
      else if (ancho >= WIDE_CM) out.push(INFO.ancho);
    } else if (this.brazo) {
      out.push(L && (this.brazoY < L.y0 || this.brazoY > L.y0 + L.hSrc) ? INFO.otraAltura : INFO.brazoOn);
    }
    el.textContent = out.join(' ');
  }
  _refreshCut() {
    const alto = this._alto(),
      closed = !!(this.lasso && this.lasso.closed),
      r = this.refH(),
      b = $('edCajaOk');
    $('edRecortar').disabled = !(closed && alto > 0.5 && alto < 80 && this._cajaOk());
    b.hidden = !closed || !r || r.por === 'marca';
    b.setAttribute('aria-pressed', String(this.inkOk));
  }
  _altoFromCalib() {
    const r = this.refH();
    if (!this.cmPerPx || !r) return;
    this.altoCal = altoFromCalib(r.h, this.cmPerPx);
    $('edAlto').value = fmt(this.altoCal);
  }
  _calib() {
    if (!this.line) return;
    const cm = this.toCm($('edMideCm').value),
      px = Math.hypot(this.line[1][0] - this.line[0][0], this.line[1][1] - this.line[0][1]);
    if (cm > 0 && px > 5) {
      this.cmPerPx = cm / px;
      $('edEscala').textContent = 'Calibrado: el alto de los recortes se calcula solo (compruébalo).';
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
  /**
   * Recorte del lazo → canvas con transparencia (borde suave); desenrollado si se marcaron los bordes del brazo.
   * H31: el lienzo es simétrico alrededor de la caja de referencia (la tinta o lo marcado), así que su centro es el de
   * la tinta aunque el lazo no deje el mismo hueco por cada lado; lo que sobra queda transparente.
   * Devuelve { canvas, traceH (alto de la referencia en px del lienzo), por, inkBox (caja de referencia, px del lienzo) }.
   */
  cut(feather) {
    const pts = this.lasso.pts,
      W = this.src.width,
      H = this.src.height,
      f = Math.max(0, feather);
    // lo que tiene píxeles: el lazo con el borde suave, dentro de la foto
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0])) - f)),
      y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1])) - f)),
      x1 = Math.min(W, Math.ceil(Math.max(...pts.map(p => p[0])) + f)),
      y1 = Math.min(H, Math.ceil(Math.max(...pts.map(p => p[1])) + f));
    const ref = this.refBox(),
      cx = (ref.left + ref.right) / 2,
      cy = (ref.top + ref.bottom) / 2,
      hy = Math.max(cy - y0, y1 - cy, 1),
      Y0 = cy - hy,
      un = this.brazo && { xc: (this.brazo[0] + this.brazo[1]) / 2, R: (this.brazo[1] - this.brazo[0]) / 2 };
    let bw, X0;
    if (un) {
      const s0 = arcOfCol(x0, un.xc, un.R),
        s1 = arcOfCol(x1, un.xc, un.R),
        sm = arcOfCol(cx, un.xc, un.R);
      bw = 2 * Math.max(sm - s0, s1 - sm, 1);
    } else {
      const hx = Math.max(cx - x0, x1 - cx, 1);
      X0 = cx - hx;
      bw = 2 * hx;
    }
    const k = Math.min(1, MAX_CUT / Math.max(bw, 2 * hy)),
      cols = un ? unrollCols(x0, x1, un.xc, un.R, k, cx) : null,
      cw = cols ? cols.w : Math.max(1, Math.round(bw * k)),
      ch = Math.max(1, Math.round(2 * hy * k)),
      xOf = cols ? cols.xOf : x => (x - X0) * k,
      yOf = y => (y - Y0) * k;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const g = out.getContext('2d', { willReadFrequently: true });
    if (cols) {
      // H22: cada columna del recorte es un trozo igual de arco sobre la piel (más ancho que en la foto)
      g.imageSmoothingEnabled = true;
      for (let X = 0; X < cw; X++) {
        if (!Number.isFinite(cols.sx[X])) continue; // fuera de lo recortado: transparente
        const sx = Math.min(W - 1, Math.max(0, cols.sx[X] - 0.5));
        g.drawImage(this.src, sx, y0, 1, y1 - y0, X, yOf(y0), 1, (y1 - y0) * k);
      }
    } else g.drawImage(this.src, x0, y0, x1 - x0, y1 - y0, xOf(x0), yOf(y0), (x1 - x0) * k, (y1 - y0) * k);
    const m = document.createElement('canvas');
    m.width = cw;
    m.height = ch;
    const mg = m.getContext('2d', { willReadFrequently: true });
    mg.fillStyle = '#000';
    mg.beginPath();
    pts.forEach(([x, y], i) => mg[i ? 'lineTo' : 'moveTo'](xOf(x), yOf(y)));
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
    return {
      canvas: out,
      traceH: (ref.bottom - ref.top) * k,
      por: r ? r.por : 'trazo',
      inkBox: { x0: xOf(ref.left), y0: yOf(ref.top), x1: xOf(ref.right), y1: yOf(ref.bottom) },
    };
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
      this.userView = true;
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
      panning = (this.tool === 'mover' && this.marking !== 'eje') || e.button === 1;
      if (panning) return;
      const [ix, iy] = this.toImg(...xy(e));
      if (this.marking === 'eje') this._ejeAt = [ix, iy];
      else if (this.tool === 'gotas') this.sampleAt(ix, iy);
      else if (this.tool === 'lazo' && this.marking === 'alto') this._markDown([ix, iy]);
      else if (this.tool === 'lazo' && this.marking === 'brazo') this._brazoAt = [ix, iy];
      else if (this.tool === 'lazo') {
        this.lasso = { pts: [[ix, iy]], closed: false };
        this.inkOk = false;
        $('edRecortar').disabled = true;
        $('edCajaOk').hidden = true;
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
          this.userView = true;
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
        this.userView = true;
        this.v.tx += cur[0] - prev[0];
        this.v.ty += cur[1] - prev[1];
        this.draw();
        return;
      }
      const [ix, iy] = this.toImg(...cur);
      if (this.marking === 'eje') this._ejeAt = [ix, iy];
      else if (this.tool === 'gotas') this.sampleAt(ix, iy);
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
        if (this.marking === 'eje') {
          if (this._ejeAt) this._ejeUp(this._ejeAt);
        } else if (this.tool === 'lazo' && this.marking === 'alto') this._markUp();
        else if (this.tool === 'lazo' && this.marking === 'brazo' && this._brazoAt) this._brazoUp(this._brazoAt);
        else if (this.tool === 'lazo') this._lassoDone();
        else if (this.tool === 'medir') {
          this._stroke = null;
          this._calib();
          if (this.line && !this.cmPerPx) $('edMideCm').focus();
        } else if (this.tool === 'gotas') {
          this._toneDone();
          this.probe = null;
        }
      }
      this._brazoAt = this._ejeAt = null;
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
      // el panel cambió de alto (p. ej. el de «Recortar» es más alto); nunca a mitad de un trazo, ni entre los dos
      // toques de «Desenrollar», «Enderezar» o «Marcar», ni con un lazo cerrado (H38)
      if (!this.userView && !P.size && !this.marking && !(this.lasso && this.lasso.closed)) this.fit();
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
    $('edEnderezar').onclick = () => this.setMarking(this.marking === 'eje' ? null : 'eje');
    $('edGirar').onclick = () => this._rotate(Math.PI / 2, 'Foto girada 90°. Vuelve a rodear los tatuajes.');
    $('edUsarTono').onclick = () => {
      if (this.tone) this.onTone(this.tone);
    };
    $('edAlto').addEventListener('input', () => {
      this.inkOk = false; // otro alto, otro ancho en cm: hay que volver a confirmar la caja
      this._refreshCut();
      this._info();
      this.draw();
    });
    $('edMideCm').addEventListener('input', () => this._calib());
    $('edMarcar').onclick = () => this.setMarking(this.marking === 'alto' ? null : 'alto');
    $('edDesenrollar').onclick = () => this.setMarking(this.marking === 'brazo' ? null : 'brazo');
    $('edCajaOk').onclick = () => {
      if (!(this.lasso && this.lasso.closed)) return;
      this.inkOk = !this.inkOk;
      this._refreshCut();
      this._info();
      this.draw();
    };
    $('edBrazoQuitar').onclick = () => {
      this.brazo = this.brazoPend = null;
      this.setMarking(null);
      this._info();
      $('edDesenrollar').focus();
    };
    $('edBorrar').onclick = () => {
      this.lasso = this.altoMark = null;
      this.inkOk = false;
      this._refreshCut();
      this._info();
      this.draw();
    };
    $('edRecortar').onclick = () => {
      const alto = this._alto();
      if (!(this.lasso && this.lasso.closed && alto > 0 && this._cajaOk())) return;
      const feather = (+$('edBorde').value / 100) * Math.min(this.src.width, this.src.height) * 0.1;
      const { canvas, traceH, inkBox } = this.cut(feather);
      const dc = this.onCut({ canvas, traceH, inkBox, name: $('edNombre').value.trim(), alto });
      const ancho = ((inkBox.x1 - inkBox.x0) / (inkBox.y1 - inkBox.y0)) * alto;
      this.lasso = this.altoMark = null;
      this.inkOk = false;
      this.brazo = this.brazoPend = null; // el desenrollado es de ESTE tatuaje (H33)
      $('edNombre').value = '';
      if (!this.cmPerPx) $('edAlto').value = ''; // el siguiente recorte no hereda el alto de este
      this.setMarking(null);
      this._refreshCut();
      this._info();
      // H41: se anuncia dentro del editor (el resto de la página está inerte) y el foco no se queda en un botón apagado
      this._aviso(`Recorte «${(dc && dc.name) || 'tatuaje'}» añadido: ${fmt1(ancho)} × ${fmt1(alto)} cm.`);
      $('edNombre').focus();
      this.draw();
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
const fmt1 = x => x.toFixed(1).replace('.', ','); // siempre con un decimal: «8,0 cm»
