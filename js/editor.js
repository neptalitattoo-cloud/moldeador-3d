// Editor «Foto del brazo»: cuentagotas (tono de piel), recortar tatuajes con lazo y borde suave, medir (calibración).
// Táctil (iPad/iPhone) y ratón. Dos dedos o la rueda: mover/acercar la foto.
import { averageColor, blurAlpha, altoFromCalib } from './foto.js?v=9';

const $ = id => document.getElementById(id);
const MAX_PHOTO = 2048; // px del lado mayor (memoria en iOS)
const MAX_CUT = 1024; // px del lado mayor de cada recorte

export class FotoEditor {
  constructor({ onTone, onCut, toCm }) {
    this.onTone = onTone;
    this.onCut = onCut;
    this.toCm = toCm; // texto → número (acepta coma)
    this.root = $('editor');
    this.cv = $('edCanvas');
    this.tool = 'gotas';
    this.v = { s: 1, tx: 0, ty: 0 };
    this.lasso = null;
    this.line = null;
    this.cmPerPx = null;
    this.probe = null;
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
      // foto nueva: calibración y alto, de cero (con la misma foto se conservan)
      this.cmPerPx = this.line = null;
      $('edMideCm').value = '';
      $('edAlto').value = '';
      $('edEscala').textContent = 'Sin calibrar: escribe el alto a mano.';
    }
    const g = this.src.getContext('2d', { willReadFrequently: true });
    this.data = g.getImageData(0, 0, this.src.width, this.src.height).data;
    this.lasso = this.probe = null;
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
    if (this.line) {
      const [a, b] = [this.toView(...this.line[0]), this.toView(...this.line[1])];
      g.lineWidth = 3;
      g.strokeStyle = '#ffd400';
      g.beginPath();
      g.moveTo(...a);
      g.lineTo(...b);
      g.stroke();
      for (const p of [a, b]) {
        g.beginPath();
        g.arc(p[0], p[1], 6, 0, 2 * Math.PI);
        g.fillStyle = '#ffd400';
        g.fill();
      }
    }
    if (this.probe) this._loupe(g);
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
  sampleAt(ix, iy) {
    const res = averageColor(this.data, this.src.width, this.src.height, ix, iy, this.probeRadius());
    this.probe = { pt: [ix, iy], hex: res && res.hex };
    if (res) {
      this.tone = res.hex;
      $('edSwatch').style.background = res.hex;
      $('edHex').textContent = `${res.hex} · ${res.usados} de ${res.n} píxeles (sin brillos ni sombras)`;
      $('edUsarTono').disabled = false;
    }
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
    L.hSrc = Math.max(...ys) - Math.min(...ys); // alto del trazo en px de la foto
    this._altoFromCalib();
    this._refreshCut();
  }
  _refreshCut() {
    const alto = this.toCm($('edAlto').value);
    $('edRecortar').disabled = !(this.lasso && this.lasso.closed && alto > 0.5 && alto < 80);
  }
  _altoFromCalib() {
    if (this.cmPerPx && this.lasso && this.lasso.closed)
      $('edAlto').value = fmt(altoFromCalib(this.lasso.hSrc, this.cmPerPx));
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
  /** Recorte del lazo → canvas con transparencia (borde suave). */
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
    const bw = x1 - x0,
      bh = y1 - y0,
      k = Math.min(1, MAX_CUT / Math.max(bw, bh)),
      cw = Math.max(1, Math.round(bw * k)),
      ch = Math.max(1, Math.round(bh * k));
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const g = out.getContext('2d', { willReadFrequently: true });
    g.drawImage(this.src, x0, y0, bw, bh, 0, 0, cw, ch);
    const m = document.createElement('canvas');
    m.width = cw;
    m.height = ch;
    const mg = m.getContext('2d', { willReadFrequently: true });
    mg.fillStyle = '#000';
    mg.beginPath();
    pts.forEach(([x, y], i) => mg[i ? 'lineTo' : 'moveTo']((x - x0) * k, (y - y0) * k));
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
    const ys = pts.map(p => p[1]);
    // el alto en cm se aplica al trazo (traceH, px del lienzo), no al lienzo con el margen del borde suave (H9)
    return { canvas: out, traceH: (Math.max(...ys) - Math.min(...ys)) * k };
  }
  // ---------- eventos ----------
  _wire() {
    const cv = this.cv,
      P = new Map();
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
    cv.addEventListener('pointerdown', e => {
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        // puntero ya suelto o sintético: se sigue sin captura
      }
      P.set(e.pointerId, xy(e));
      last = null;
      if (P.size > 1) {
        // dos dedos: se abandona el trazo en curso y se mueve/acerca la foto
        if (this.lasso && !this.lasso.closed) this.lasso = null;
        this.probe = null;
        panning = true;
        this.draw();
        return;
      }
      panning = this.tool === 'mover' || e.button === 1;
      if (panning) return;
      const [ix, iy] = this.toImg(...xy(e));
      if (this.tool === 'gotas') this.sampleAt(ix, iy);
      else if (this.tool === 'lazo') {
        this.lasso = { pts: [[ix, iy]], closed: false };
        $('edRecortar').disabled = true;
      } else if (this.tool === 'medir')
        this.line = [
          [ix, iy],
          [ix, iy],
        ];
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
      else if (this.tool === 'lazo' && this.lasso && !this.lasso.closed) {
        const q = this.lasso.pts[this.lasso.pts.length - 1];
        if (Math.hypot(ix - q[0], iy - q[1]) * this.v.s > 2) this.lasso.pts.push([ix, iy]);
      } else if (this.tool === 'medir' && this.line) this.line[1] = [ix, iy];
      this.draw();
    });
    const up = e => {
      if (!P.has(e.pointerId)) return;
      P.delete(e.pointerId);
      last = null;
      if (P.size) return;
      if (!panning) {
        if (this.tool === 'lazo') this._lassoDone();
        if (this.tool === 'medir') {
          this._calib();
          if (this.line && !this.cmPerPx) $('edMideCm').focus();
        }
        if (this.tool === 'gotas') this.probe = null;
      }
      panning = false;
      this.draw();
    };
    cv.addEventListener('pointerup', up);
    // gesto cancelado por el sistema (p. ej. pasada desde el borde en iOS): el trazo a medias no vale
    cv.addEventListener('pointercancel', e => {
      if (this.lasso && !this.lasso.closed) this.lasso = null;
      if (this.tool === 'medir' && !this.cmPerPx) this.line = null;
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
    $('edAlto').addEventListener('input', () => this._refreshCut());
    $('edMideCm').addEventListener('input', () => this._calib());
    $('edBorrar').onclick = () => {
      this.lasso = null;
      $('edRecortar').disabled = true;
      this.draw();
    };
    $('edRecortar').onclick = () => {
      const alto = this.toCm($('edAlto').value);
      if (!(this.lasso && this.lasso.closed && alto > 0)) return;
      const feather = (+$('edBorde').value / 100) * Math.min(this.src.width, this.src.height) * 0.1;
      const { canvas, traceH } = this.cut(feather);
      this.onCut({ canvas, traceH, name: $('edNombre').value.trim(), alto });
      this.lasso = null;
      $('edNombre').value = '';
      if (!this.cmPerPx) $('edAlto').value = ''; // el siguiente recorte no hereda el alto de este
      $('edRecortar').disabled = true;
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
