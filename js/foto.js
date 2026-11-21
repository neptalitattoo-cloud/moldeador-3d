// Herramientas de «Foto del brazo» sin DOM (se prueban en Node):
//  - promedio robusto de color (cuentagotas)
//  - borde suave de un recorte (desenfoque de la máscara)
//  - carta de la superficie del brazo: (cm desde el hombro, cm alrededor del brazo) ↔ UV, para colocar tatuajes
import { gauss1d, dot, cross, norm } from './core.js?v=13';

// ---------- color ----------
export const hex = (r, g, b) => '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
export function rgbOf(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const median = a => {
  const s = Float64Array.from(a).sort();
  return s.length ? s[s.length >> 1] : NaN;
};
/**
 * Color medio de un círculo de radio r alrededor de (cx, cy), ignorando valores atípicos
 * (poros, pelos, brillos, sombras): se descartan los píxeles lejos de la mediana (> 2,5 × MAD, mínimo 12/255).
 * data: RGBA (ImageData.data), w×h. Devuelve { rgb, hex, n, usados } o null si no hay píxeles.
 */
export function averageColor(data, w, h, cx, cy, r) {
  const px = [];
  const x0 = Math.max(0, Math.floor(cx - r)),
    x1 = Math.min(w - 1, Math.ceil(cx + r)),
    y0 = Math.max(0, Math.floor(cy - r)),
    y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = 4 * (y * w + x);
      if (data[i + 3] < 128) continue; // transparente
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
  if (!px.length) return null;
  const med = [0, 1, 2].map(c => median(px.map(p => p[c])));
  const dist = px.map(p => Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]));
  const mad = median(dist);
  const lim = Math.max(12, 2.5 * mad);
  const acc = [0, 0, 0];
  let n = 0;
  px.forEach((p, k) => {
    if (dist[k] > lim) return;
    acc[0] += p[0];
    acc[1] += p[1];
    acc[2] += p[2];
    n++;
  });
  const rgb = acc.map(v => v / n);
  return { rgb, hex: hex(...rgb), n: px.length, usados: n };
}

// ---------- borde suave ----------
// Desenfoque de caja separable (3 pasadas ≈ gaussiano) sobre un canal alfa Uint8ClampedArray w×h.
export function blurAlpha(a, w, h, radius) {
  const r = Math.max(0, Math.round(radius));
  if (!r) return a;
  let src = Float32Array.from(a),
    dst = new Float32Array(a.length);
  const pass = (horiz, rr) => {
    const L = horiz ? w : h,
      M = horiz ? h : w;
    for (let m = 0; m < M; m++) {
      const at = k => (horiz ? m * w + k : k * w + m);
      let sum = 0;
      for (let k = -rr; k <= rr; k++) sum += src[at(Math.min(L - 1, Math.max(0, k)))];
      for (let k = 0; k < L; k++) {
        dst[at(k)] = sum / (2 * rr + 1);
        sum += src[at(Math.min(L - 1, k + rr + 1))] - src[at(Math.max(0, k - rr))];
      }
    }
    [src, dst] = [dst, src];
  };
  const rr = Math.max(1, Math.round(r / 1.7));
  for (let p = 0; p < 3; p++) {
    pass(true, rr);
    pass(false, rr);
  }
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) out[i] = src[i];
  return out;
}
// ---------- escala de un recorte (H9) ----------
/**
 * cm por píxel del lienzo del recorte. El alto que escribe el usuario (o el calibrado) es el del trazo del lazo,
 * no el del lienzo, que lleva margen para el borde suave.
 *   traceH: alto del trazo en px del lienzo; alto: cm.
 */
export const cutScale = (traceH, alto) => (traceH > 0 && alto > 0 ? alto / traceH : NaN);
/** Alto en cm del trazo a partir de la calibración (cm por px de la foto). */
export const altoFromCalib = (traceHsrc, cmPerPx) => (traceHsrc > 0 && cmPerPx > 0 ? traceHsrc * cmPerPx : NaN);

// ---------- alto de la TINTA dentro del lazo (H9) ----------
/** Mediana por canal [r, g, b] de los píxeles con mask ≥ 128 (o null si no hay). */
export function medianColor(rgba, mask, w, h) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] < 128) continue;
    for (let c = 0; c < 3; c++) hist[c][rgba[4 * i + c]]++;
    n++;
  }
  if (!n) return null;
  return hist.map(hc => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hc[v];
      if (acc * 2 > n) return v;
    }
    return 255;
  });
}
/**
 * Tono de la piel POR COLUMNA (H30): mediana [r, g, b] de los píxeles del anillo (ring ≥ 128) en las columnas x ± R.
 * Devuelve Int16Array(3·w); −1 en las columnas con menos de minN muestras (ahí se usa el tono global).
 */
export function colTones(rgba, ring, w, h, R = 8, minN = 5) {
  const out = new Int16Array(3 * w).fill(-1),
    hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  let n = 0;
  const add = (x, s) => {
    if (x < 0 || x >= w) return;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (ring[i] < 128) continue;
      for (let c = 0; c < 3; c++) hist[c][rgba[4 * i + c]] += s;
      n += s;
    }
  };
  for (let x = 0; x < R; x++) add(x, 1);
  for (let x = 0; x < w; x++) {
    add(x + R, 1); // ventana [x − R, x + R]
    add(x - R - 1, -1);
    if (n < minN) continue;
    for (let c = 0; c < 3; c++) {
      let acc = 0,
        v = 0;
      while (v < 255 && (acc += hist[c][v]) * 2 <= n) v++;
      out[3 * x + c] = v;
    }
  }
  return out;
}
/**
 * Caja de la TINTA de un recorte (H9, H30): así el alto que escribe el tatuador (el de la tinta) no se aplica también al
 * hueco de piel que deja el dedo alrededor.
 *   rgba: w×h RGBA; alpha: w×h (la máscara del lazo, sin borde suave);
 *   skin: [r, g, b] o null (= mediana del borde interior del lazo);
 *   ring: w×h o null: anillo por fuera del lazo; si se da, el tono de la piel se mide POR COLUMNA (mediana en x ± 8 px),
 *   para que la sombra lateral del brazo no cuente como tinta.
 * Un píxel es de tinta si se aleja más de `thr` (distancia RGB) del tono de su columna y al menos 5 de los 9 de su
 * entorno 3 × 3 también lo son (sin poros ni ruido). Una fila (o columna) es de tinta si tiene al menos
 * max(3 px, 2 % de la fila con más tinta) píxeles de tinta: un número de píxeles, no un % del ancho del lazo, así que
 * los tallos y las letras finas cuentan aunque el lazo vaya holgado. Hacen falta 2 filas seguidas.
 * Si las filas de tinta forman grupos separados por un hueco (un pelo en el hueco del lazo, trazos sueltos), la caja
 * los incluye todos y `dudoso` = true: el editor pide revisarla o marcar el alto a mano.
 * Devuelve { top, bottom, left, right, skin, dudoso } (px, inclusivos) o null si no se distingue.
 */
export function inkRows(rgba, alpha, w, h, skin, ring = null, thr = 45) {
  const inside = i => alpha[i] >= 128;
  let tone = skin;
  if (!tone) {
    const edge = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!inside(i)) continue;
        const out = !x || !y || x === w - 1 || y === h - 1;
        if (out || !inside(i - 1) || !inside(i + 1) || !inside(i - w) || !inside(i + w)) edge[i] = 255;
      }
    tone = medianColor(rgba, edge, w, h);
  }
  if (!tone) return null;
  const cols = ring ? colTones(rgba, ring, w, h) : null;
  // el tono de una columna sólo vale si es piel con otra luz (misma cromaticidad, más oscura o más clara): donde el lazo
  // holgado corta las esquinas del dibujo, el anillo de fuera pasa por la tinta y esa columna no puede tomarla por piel
  if (cols) {
    const s0 = tone[0] + tone[1] + tone[2] || 1;
    for (let x = 0; x < w; x++) {
      if (cols[3 * x] < 0) continue;
      const s1 = cols[3 * x] + cols[3 * x + 1] + cols[3 * x + 2] || 1,
        ratio = s1 / s0;
      let dc = 0;
      for (let c = 0; c < 3; c++) dc = Math.max(dc, Math.abs(cols[3 * x + c] / s1 - tone[c] / s0));
      if (dc > 0.035 || ratio < 0.4 || ratio > 1.6) cols[3 * x] = cols[3 * x + 1] = cols[3 * x + 2] = -1;
    }
  }
  // 1) tinta en bruto: lejos del tono de la piel de su columna
  const t2 = thr * thr,
    raw = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside(i)) continue;
      const own = cols && cols[3 * x] >= 0,
        dr = rgba[4 * i] - (own ? cols[3 * x] : tone[0]),
        dg = rgba[4 * i + 1] - (own ? cols[3 * x + 1] : tone[1]),
        db = rgba[4 * i + 2] - (own ? cols[3 * x + 2] : tone[2]);
      if (dr * dr + dg * dg + db * db > t2) raw[i] = 1;
    }
  // 2) sin ruido: cuenta si al menos 5 de los 9 píxeles de su entorno 3 × 3 son tinta
  const rowN = new Int32Array(h),
    rowK = new Int32Array(h),
    colN = new Int32Array(w),
    colK = new Int32Array(w);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside(i)) continue;
      rowN[y]++;
      colN[x]++;
      if (!raw[i]) continue;
      let k = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) k += raw[yy * w + xx];
      if (k >= 5) {
        rowK[y]++;
        colK[x]++;
      }
    }
  // 3) filas / columnas de tinta: un número mínimo de píxeles, relativo a la fila con más tinta (no al lazo)
  const span = (N, Kc) => {
    let max = 0;
    for (const v of Kc) max = Math.max(max, v);
    const need = Math.max(3, 0.02 * max),
      ink = k => N[k] >= 4 && Kc[k] >= need;
    let a = -1,
      b = -1;
    for (let k = 0; k + 1 < N.length; k++)
      if (ink(k) && ink(k + 1)) {
        a = k;
        break;
      }
    for (let k = N.length - 1; k > 0; k--)
      if (ink(k) && ink(k - 1)) {
        b = k;
        break;
      }
    if (a < 0 || b < a) return null;
    // ¿grupos separados por un hueco sin tinta? (un pelo en el hueco del lazo, trazos sueltos)
    const gap = Math.max(2, Math.round(0.01 * N.length));
    let run = 0,
      split = false;
    for (let k = a; k <= b; k++)
      if (!ink(k)) run++;
      else {
        if (run >= gap) split = true;
        run = 0;
      }
    return { a, b, split };
  };
  const r = span(rowN, rowK),
    c = span(colN, colK);
  if (!r || !c) return null;
  // sólo las filas deciden si es dudoso: el alto (la escala) sale de ellas; las columnas sólo dan el ancho mostrado
  return { top: r.a, bottom: r.b, left: c.a, right: c.b, skin: tone, dudoso: r.split };
}

// ---------- enderezar la foto (H29) ----------
/**
 * Ángulo (radianes, como ctx.rotate: positivo = horario en pantalla) que deja vertical el eje p → q (p hacia el hombro,
 * q hacia la mano), con el hombro arriba. 0 = ya está vertical.
 */
export const straightenAngle = (p, q) => Math.atan2(q[0] - p[0], q[1] - p[1]);
/**
 * Geometría de girar una foto w×h el ángulo a alrededor de su centro, reducida para que el lado mayor no pase de max:
 * { W, H, k, map(x, y) → [x', y'] } (map lleva un punto de la foto de antes a la girada).
 */
export function rotateGeom(w, h, a, max = Infinity) {
  const c = Math.cos(a),
    s = Math.sin(a),
    wr = w * Math.abs(c) + h * Math.abs(s),
    hr = w * Math.abs(s) + h * Math.abs(c),
    k = Math.min(1, max / Math.max(wr, hr)),
    W = Math.max(1, Math.round(wr * k)),
    H = Math.max(1, Math.round(hr * k));
  const map = (x, y) => {
    const dx = x - w / 2,
      dy = y - h / 2;
    return [W / 2 + k * (c * dx - s * dy), H / 2 + k * (s * dx + c * dy)];
  };
  return { W, H, k, map };
}

// ---------- desenrollar la foto de un brazo curvo (H22) ----------
// En la foto, lo que rodea parte del brazo se ve en cuerda (de borde a borde), no en arco sobre la piel. Con los bordes
// del brazo a la altura del tatuaje (xc ± R, px de la foto) y una vista casi ortográfica, la columna x de la foto está
// en el arco s = R·asin((x − xc)/R) sobre la piel.
export const arcOfCol = (x, xc, R) => R * Math.asin(Math.max(-1, Math.min(1, (x - xc) / R)));
export const colOfArc = (s, xc, R) => xc + R * Math.sin(Math.max(-1.5707, Math.min(1.5707, s / R)));
/**
 * Remuestreo por columnas para desenrollar [x0, x1] (px de la foto): columna X del recorte (k px por px de arco) ←
 * columna sx[X] (continua) de la foto. xOf(x) lleva una x de la foto a la x del recorte (para la máscara del lazo).
 * xm (opcional, H31): columna de la foto que debe quedar en el centro del recorte (el centro de la tinta); el recorte
 * se ensancha por el lado que haga falta y esas columnas (fuera de [x0, x1]) llevan sx = NaN (quedan transparentes).
 */
export function unrollCols(x0, x1, xc, R, k = 1, xm = null) {
  const a0 = arcOfCol(x0, xc, R),
    a1 = arcOfCol(x1, xc, R);
  let s0 = a0,
    s1 = a1;
  if (xm != null) {
    const sm = arcOfCol(xm, xc, R),
      hs = Math.max(sm - a0, a1 - sm);
    s0 = sm - hs;
    s1 = sm + hs;
  }
  const w = Math.max(1, Math.round((s1 - s0) * k)),
    sx = new Float64Array(w);
  for (let X = 0; X < w; X++) {
    const s = s0 + (X + 0.5) / k;
    sx[X] = s < a0 - 1e-9 || s > a1 + 1e-9 ? NaN : colOfArc(s, xc, R);
  }
  return { s0, s1, w, sx, xOf: x => (arcOfCol(x, xc, R) - s0) * k };
}

// ---------- carta de la superficie ----------
// Lados del brazo: ángulo (grados) alrededor del eje, 0 = exterior (la línea donde se miden los largos).
export const LADOS = { exterior: 0, delante: 90, interior: 180, detras: -90 };
const TAU = 2 * Math.PI;
const NB = 72; // sectores por rodaja para medir el contorno real
const WIN = 2; // rodajas vecinas (±) que se juntan para cada contorno
const HAND_SPREAD = 0.8; // cm: hasta dónde se sigue por el dorso de la mano (antes del pulgar)

/**
 * Carta del brazo ajustado, con distancias reales sobre la piel:
 *  - por rodaja (cada `step` cm de la malla base): contorno real en NB sectores → arco acumulado y perímetro L
 *    (no radio × ángulo: el antebrazo y la muñeca son ovalados);
 *  - a lo largo de cada ángulo, la longitud real sobre la piel entre rodajas (Y);
 *  - por vértice: jf (rodaja continua), phi (0 exterior, +π/2 delante), arco y Y propios.
 * La cinta (`tape`) sigue siendo la de las medidas: «Desde hombro» es la distancia por la línea exterior.
 */
export function surfaceChart(base, P, tape) {
  const m = base.meta,
    n = m.nV,
    sv = base.sv,
    step = m.step,
    nC = m.nC;
  const sMax = m.s_tip,
    sHand = Math.max(0, m.S_WR - 8);
  const sliceOf = s => Math.min(nC - 1, Math.max(0, Math.round(s / step)));
  // centro de cada rodaja en la malla ajustada
  const cx = new Float64Array(nC),
    cy = new Float64Array(nC),
    cz = new Float64Array(nC),
    cnt = new Float64Array(nC);
  for (let i = 0; i < n; i++) {
    if (sv[i] < sHand || sv[i] > sMax) continue;
    const j = sliceOf(sv[i]);
    cx[j] += P[3 * i];
    cy[j] += P[3 * i + 1];
    cz[j] += P[3 * i + 2];
    cnt[j]++;
  }
  const outer = m.dir_outer || [-1, 0, 0],
    front = (m.dir_back || [0, 0, -1]).map(v => -v);
  const frames = (js, SIG = 3) => {
    const sm = c =>
      gauss1d(
        js.map(j => c[j] / cnt[j]),
        SIG,
      );
    const X = sm(cx),
      Y = sm(cy),
      Z = sm(cz);
    const C = new Float64Array(3 * nC),
      T = new Float64Array(3 * nC),
      E1 = new Float64Array(3 * nC),
      E2 = new Float64Array(3 * nC);
    for (let j = 0; j < nC; j++) {
      let k = 0;
      while (k < js.length - 1 && js[k + 1] <= j) k++;
      const k2 = Math.min(js.length - 1, k + 1),
        t = js[k2] === js[k] ? 0 : Math.min(1, Math.max(0, (j - js[k]) / (js[k2] - js[k])));
      C[3 * j] = X[k] + t * (X[k2] - X[k]);
      C[3 * j + 1] = Y[k] + t * (Y[k2] - Y[k]);
      C[3 * j + 2] = Z[k] + t * (Z[k2] - Z[k]);
    }
    // el signo de e2 se decide en una rodaja del medio (las de los extremos pueden ser degeneradas)
    const jRef = js[js.length >> 1];
    let sign = 0;
    for (const j of [jRef, ...Array.from({ length: nC }, (_, k) => k)]) {
      const a = Math.max(0, j - 2),
        b = Math.min(nC - 1, j + 2);
      const t = norm([C[3 * b] - C[3 * a], C[3 * b + 1] - C[3 * a + 1], C[3 * b + 2] - C[3 * a + 2]]); // hacia el hombro
      const e1 = norm(outer.map((v, c) => v - dot(outer, t) * t[c]));
      let e2 = cross(t, e1);
      if (!sign) {
        sign = dot(e2, front) >= 0 ? 1 : -1;
        continue; // la primera vuelta (jRef) sólo fija el signo
      }
      e2 = e2.map(v => v * sign);
      for (let c = 0; c < 3; c++) {
        T[3 * j + c] = t[c];
        E1[3 * j + c] = e1[c];
        E2[3 * j + c] = e2[c];
      }
    }
    return { C, T, E1, E2, sign };
  };
  const polar = (F, i, j) => {
    const o = [P[3 * i] - F.C[3 * j], P[3 * i + 1] - F.C[3 * j + 1], P[3 * i + 2] - F.C[3 * j + 2]];
    const t = [F.T[3 * j], F.T[3 * j + 1], F.T[3 * j + 2]];
    const op = o.map((v, c) => v - dot(o, t) * t[c]);
    const a = dot(op, [F.E1[3 * j], F.E1[3 * j + 1], F.E1[3 * j + 2]]),
      b = dot(op, [F.E2[3 * j], F.E2[3 * j + 1], F.E2[3 * j + 2]]);
    return [Math.atan2(b, a), Math.hypot(a, b), dot(o, t)];
  };
  let js = [];
  for (let j = 0; j < nC; j++) if (cnt[j] >= 6) js.push(j);
  if (js.length < 5) throw new Error('No se pudo calcular el eje del brazo.');
  // ¿hasta dónde llega por la mano? mientras cada sector del contorno sea de una sola capa (antes del pulgar)
  const F0 = frames(js);
  const jWR = sliceOf(m.S_WR);
  const lo = new Float64Array(nC * 36).fill(1e9),
    hi = new Float64Array(nC * 36).fill(-1e9);
  for (let i = 0; i < n; i++) {
    if (sv[i] < sHand || sv[i] > m.S_WR) continue;
    const j = sliceOf(sv[i]),
      [ph, r] = polar(F0, i, j),
      k = j * 36 + Math.min(35, Math.floor(((ph + Math.PI) / TAU) * 36));
    lo[k] = Math.min(lo[k], r);
    hi[k] = Math.max(hi[k], r);
  }
  // umbral proporcional al grosor de la muñeca (en una muñeca gruesa la separación palma/dorso es mayor de por sí)
  let rW = 0,
    nW = 0;
  for (let k = 0; k < 36; k++)
    if (hi[jWR * 36 + k] > -1e8) {
      rW += (hi[jWR * 36 + k] + lo[jWR * 36 + k]) / 2;
      nW++;
    }
  const thr = Math.max(HAND_SPREAD, 0.25 * (nW ? rW / nW : 0));
  let jLo = jWR;
  for (let j = jWR; j >= sliceOf(sHand); j--) {
    let spread = 0;
    for (let k = 0; k < 36; k++) if (hi[j * 36 + k] > -1e8) spread = Math.max(spread, hi[j * 36 + k] - lo[j * 36 + k]);
    if (spread > thr) break;
    jLo = j;
  }
  jLo += WIN; // los contornos de las últimas rodajas juntan vecinas que ya no son de una capa
  const jHi = sliceOf(sMax - 0.5);
  js = js.filter(j => j >= jLo - WIN);
  const Fr = frames(js, 10);
  const hand = Fr.sign; // visto desde fuera con el hombro arriba, la derecha de la imagen es T × normal
  // ----- por vértice -----
  const jf = new Float32Array(n),
    phi = new Float32Array(n),
    r = new Float32Array(n),
    valid = new Uint8Array(n);
  const rs = new Float64Array(nC * NB),
    hs = new Float64Array(nC * NB),
    rc = new Float64Array(nC * NB);
  const sec = ph => {
    const u = ((ph + Math.PI) / TAU) * NB;
    return Math.min(NB - 1, Math.max(0, Math.floor(u)));
  };
  // Las rodajas de la malla base (sv) salen inclinadas respecto al eje en la malla ajustada (sobre todo en la muñeca):
  // se re-cortan en planos perpendiculares al eje (posición axial real de cada vértice), sin cizalla.
  const sA = new Float64Array(nC);
  for (let j = 1; j < nC; j++)
    sA[j] =
      sA[j - 1] +
      Math.max(
        1e-6,
        Math.hypot(Fr.C[3 * j] - Fr.C[3 * j - 3], Fr.C[3 * j + 1] - Fr.C[3 * j - 2], Fr.C[3 * j + 2] - Fr.C[3 * j - 1]),
      );
  const jOfAx = a => {
    let lo3 = 0,
      hi3 = nC - 1;
    if (a <= sA[0]) return 0;
    if (a >= sA[nC - 1]) return nC - 1;
    while (hi3 - lo3 > 1) {
      const mid = (lo3 + hi3) >> 1;
      if (sA[mid] <= a) lo3 = mid;
      else hi3 = mid;
    }
    return lo3 + (a - sA[lo3]) / (sA[hi3] - sA[lo3]);
  };
  for (let i = 0; i < n; i++) {
    const j0 = sliceOf(sv[i]);
    if (j0 < jLo - 2 * WIN || j0 > jHi + 2 * WIN) continue;
    const [, , h0] = polar(Fr, i, j0);
    const x = jOfAx(sA[j0] + h0),
      j = Math.min(nC - 1, Math.max(0, Math.round(x)));
    if (j < jLo - WIN || j > jHi + WIN) continue;
    const [ph, rr, hh] = polar(Fr, i, j);
    phi[i] = ph;
    r[i] = rr;
    jf[i] = x;
    rs[j * NB + sec(ph)] += rr;
    hs[j * NB + sec(ph)] += hh;
    rc[j * NB + sec(ph)]++;
    valid[i] = j >= jLo && j <= jHi && rr > 0.5 && Number.isFinite(tape(sv[i])) ? 1 : 0;
  }
  // ----- contorno por rodaja: radio por sector (huecos interpolados, suavizado) → arco acumulado -----
  const phiK = k => -Math.PI + ((k + 0.5) / NB) * TAU;
  const R = new Float64Array(nC * NB),
    Hx = new Float64Array(nC * NB),
    A = new Float64Array(nC * (NB + 1)),
    L = new Float64Array(nC);
  for (let j = jLo; j <= jHi; j++) {
    const v = new Float64Array(NB),
      w2 = new Float64Array(NB),
      has = new Uint8Array(NB);
    for (let k = 0; k < NB; k++) {
      let s = 0,
        sh = 0,
        c = 0;
      for (let q = Math.max(0, j - WIN); q <= Math.min(nC - 1, j + WIN); q++) {
        s += rs[q * NB + k];
        sh += hs[q * NB + k];
        c += rc[q * NB + k];
      }
      if (c) {
        v[k] = s / c;
        w2[k] = sh / c;
        has[k] = 1;
      }
    }
    const filled = [...has.keys()].filter(k => has[k]);
    if (filled.length < NB / 4) throw new Error('Contorno del brazo incompleto.');
    for (let k = 0; k < NB; k++) {
      if (has[k]) continue;
      let a = k,
        b = k,
        da = 0,
        db = 0;
      while (!has[a]) ((a = (a - 1 + NB) % NB), da++);
      while (!has[b]) ((b = (b + 1) % NB), db++);
      v[k] = (v[a] * db + v[b] * da) / (da + db);
      w2[k] = (w2[a] * db + w2[b] * da) / (da + db);
    }
    for (const arr of [v, w2])
      for (let pass = 0; pass < 2; pass++) {
        const w = Float64Array.from(arr);
        for (let k = 0; k < NB; k++) arr[k] = (w[(k - 1 + NB) % NB] + 2 * w[k] + w[(k + 1) % NB]) / 4;
      }
    let acc = 0;
    A[j * (NB + 1)] = 0;
    for (let k = 0; k < NB; k++) {
      R[j * NB + k] = v[k];
      Hx[j * NB + k] = w2[k];
      const k2 = (k + 1) % NB,
        a1 = phiK(k),
        a2 = phiK(k) + TAU / NB;
      acc += Math.hypot(
        v[k2] * Math.cos(a2) - v[k] * Math.cos(a1),
        v[k2] * Math.sin(a2) - v[k] * Math.sin(a1),
        w2[k2] - w2[k],
      );
      A[j * (NB + 1) + k + 1] = acc;
    }
    L[j] = acc;
  }
  // arco (sin envolver, en [0, L)) en la rodaja entera j, ángulo ph; origen en el centro del sector 0
  const arcJ = (j, ph) => {
    let u = ((ph + Math.PI) / TAU) * NB - 0.5;
    u -= NB * Math.floor(u / NB);
    const k = Math.floor(u),
      t = u - k,
      o = j * (NB + 1);
    return A[o + k] + t * (A[o + k + 1] - A[o + k]);
  };
  // ----- a lo largo de cada ángulo: longitud real sobre la piel desde la rodaja del hombro (Y) -----
  const Yt = new Float64Array(nC * NB);
  const q3 = (j, k) => {
    const ph = phiK(k),
      rr = R[j * NB + k],
      hh = Hx[j * NB + k],
      c = Math.cos(ph),
      s = Math.sin(ph);
    return [0, 1, 2].map(
      e => Fr.C[3 * j + e] + hh * Fr.T[3 * j + e] + rr * (c * Fr.E1[3 * j + e] + s * Fr.E2[3 * j + e]),
    );
  };
  // cada YSTEP rodajas (≈ 1 cm) para que el ruido del contorno no alargue la medida; en medio, interpolado
  const YSTEP = 4,
    knots = [];
  for (let j = jHi; j > jLo; j -= YSTEP) knots.push(j);
  knots.push(jLo);
  for (let k = 0; k < NB; k++) {
    let prev = q3(jHi, k),
      acc = 0;
    Yt[jHi * NB + k] = 0;
    for (let q = 1; q < knots.length; q++) {
      const j = knots[q],
        p2 = q3(j, k);
      const seg = Math.hypot(p2[0] - prev[0], p2[1] - prev[1], p2[2] - prev[2]),
        j1 = knots[q - 1];
      for (let jj = j1 - 1; jj >= j; jj--) Yt[jj * NB + k] = acc + (seg * (j1 - jj)) / (j1 - j);
      acc += seg;
      prev = p2;
    }
  }
  const yJ = (j, ph) => {
    let u = ((ph + Math.PI) / TAU) * NB - 0.5;
    u -= NB * Math.floor(u / NB);
    const k = Math.floor(u),
      t = u - k;
    return Yt[j * NB + k] * (1 - t) + Yt[j * NB + ((k + 1) % NB)] * t;
  };
  // interpolación entre rodajas
  const lerpJ = (f, x) => {
    const xc = Math.min(jHi, Math.max(jLo, x)),
      j0 = Math.min(jHi - 1, Math.floor(xc)),
      t = xc - j0;
    return f(j0) * (1 - t) + f(j0 + 1) * t;
  };
  const Lat = x => lerpJ(j => L[j], x);
  const arcAt = (x, ph) => lerpJ(j => arcJ(j, ph), x);
  const Yat = (x, ph) => lerpJ(j => yJ(j, ph), x);
  // por vértice: arco, Y y perímetro propios
  const vA = new Float32Array(n),
    vY = new Float32Array(n),
    vL = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    vA[i] = arcAt(jf[i], phi[i]);
    vY[i] = Yat(jf[i], phi[i]);
    vL[i] = Lat(jf[i]);
  }
  // cinta ↔ rodaja: «Desde hombro» es la distancia por la línea exterior (Y a 0°), ajustada a la cinta de las medidas
  // (por rodaja: en el hombro la cinta va por rodajas inclinadas y se separa unos mm de Y; así coinciden a 0°)
  const offs = [],
    offJ = Array.from({ length: jHi + 1 }, () => []);
  for (let i = 0; i < n; i++)
    if (valid[i] && Math.abs(phi[i]) < 0.08) {
      const o = tape(sv[i]) - vY[i];
      offs.push(o);
      const j = Math.round(jf[i]);
      if (j >= jLo && j <= jHi) offJ[j].push(o);
    }
  const d0 = offs.length ? median(offs) : 0;
  const OW = 6; // ± rodajas (1,5 cm) para cada mediana
  const off = new Float64Array(jHi + 1).fill(d0);
  for (let j = jLo; j <= jHi; j++) {
    const v = [];
    for (let k = Math.max(jLo, j - OW); k <= Math.min(jHi, j + OW); k++) v.push(...offJ[k]);
    if (v.length >= 3) off[j] = median(v);
  }
  // H40: vértices válidos agrupados por rodaja (decalCoords sólo recorre las rodajas que puede tocar el recorte)
  const vStart = new Int32Array(nC + 1),
    vOrder = new Int32Array(n),
    jOfV = i => Math.min(nC - 1, Math.max(0, Math.round(jf[i])));
  for (let i = 0; i < n; i++) if (valid[i]) vStart[jOfV(i) + 1]++;
  for (let j = 0; j < nC; j++) vStart[j + 1] += vStart[j];
  const pos = vStart.slice(0, nC);
  for (let i = 0; i < n; i++) if (valid[i]) vOrder[pos[jOfV(i)]++] = i;
  const dOfJ = x => lerpJ(j => off[j], x) + Yat(x, 0);
  const dMin = dOfJ(jHi),
    dMax = dOfJ(jLo);
  // ángulo de la rodaja x en el que el arco (sin envolver) vale s
  const phiOfArc = (x, s) => {
    let lo2 = -Math.PI,
      hi2 = Math.PI;
    const Lx = Lat(x),
      s0 = arcAt(x, -Math.PI);
    const rel = ph => {
      const v = arcAt(x, ph) - s0;
      return v - Lx * Math.floor(v / Lx);
    };
    let target = s - s0;
    target -= Lx * Math.floor(target / Lx);
    for (let it = 0; it < 40; it++) {
      const mid = (lo2 + hi2) / 2;
      if (rel(mid) < target) lo2 = mid;
      else hi2 = mid;
    }
    return (lo2 + hi2) / 2;
  };
  // rodaja en la que, a lo largo del ángulo ph, Y vale y (Y crece hacia la mano)
  const jOfY = (y, ph) => {
    let a = jLo,
      b = jHi;
    for (let it = 0; it < 40; it++) {
      const mid = (a + b) / 2;
      if (Yat(mid, ph) > y) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };
  const jOfD = d => {
    let a = jLo,
      b = jHi;
    for (let it = 0; it < 40; it++) {
      const mid = (a + b) / 2;
      if (dOfJ(mid) > d) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };
  return {
    // por vértice
    jf,
    phi,
    r,
    valid,
    vA,
    vY,
    vL,
    d: Float32Array.from(jf, (x, i) => (valid[i] ? dOfJ(x) : 0)),
    hand,
    vOrder,
    vStart,
    // por rodaja / funciones
    jLo,
    jHi,
    dMin,
    dMax,
    Lat,
    arcAt,
    Yat,
    jOfD,
    dOfJ,
    phiOfArc,
    jOfY,
  };
}

/**
 * Estrechamiento local del brazo (como un cono) en la rodaja jc y el lado th: radio de desarrollo rho0 (0 = sin
 * corrección). Para bandas (W > L/3) es 0: cada fila sigue a la misma distancia del centro a lo largo de cada ángulo, y
 * el borde recto de un brazalete queda como un anillo (delante y detrás a la misma altura).
 */
export function coneRho0(chart, jc, th, W = 0) {
  if (W > chart.Lat(jc) / 3) return 0;
  const dj = 8,
    jA = Math.max(chart.jLo, jc - dj),
    jB = Math.min(chart.jHi, jc + dj);
  const dy = chart.Yat(jA, th) - chart.Yat(jB, th),
    tau = dy > 0.5 ? (chart.Lat(jA) - chart.Lat(jB)) / dy / chart.Lat(jc) : 0;
  return Math.abs(tau) > 1e-3 ? 1 / tau : 0;
}
/**
 * Ida y vuelta del desarrollo del cono: (X, Y) sin corregir (arco en la propia rodaja, largo a lo largo del ángulo) ↔
 * (x, y) del dibujo (filas como arcos concéntricos de radio rho0 + Y, sin cizalla en diagonal).
 */
export function coneMaps(rho0) {
  const dev = (X, Y) => {
    if (!rho0) return [X, Y];
    const rho = rho0 + Y,
      t = X / rho;
    return Math.abs(t) < 1.5 ? [rho * Math.sin(t), rho * Math.cos(t) - rho0] : [X, Y];
  };
  const undev = (X, Y) => {
    if (!rho0) return [X, Y];
    const r = Math.sign(rho0) * Math.hypot(X, Y + rho0);
    return [r * Math.atan2(X / r, (Y + rho0) / r), r - rho0];
  };
  return { dev, undev };
}
/**
 * Coordenadas (cm sobre la piel) de cada vértice en el marco de un tatuaje colocado:
 *   x hacia la derecha de la imagen (arco real alrededor del brazo), y hacia abajo (hacia la mano, longitud real a lo
 *   largo del brazo), origen en el centro del tatuaje, ya girado. Da la vuelta completa (360°): x ∈ [−L/2, L/2].
 * dec = { d: cm desde el hombro al centro (por la línea exterior), ang: grados alrededor del brazo (0 exterior),
 *         rot: grados de giro }; W: ancho del tatuaje en cm (para saber si es una banda; opcional).
 * H (opcional, H40): alto del tatuaje en cm; si se da, sólo se calculan los vértices de las rodajas que el tatuaje puede
 * tocar (su media diagonal + 2 cm, y 3 rodajas de margen): el resto queda fuera de `ok` (el arrastre no recorre los
 * 49 314 vértices en cada fotograma). Sin H, todos.
 * Devuelve también rx/ry (sin la corrección del cono ni el giro) y dev/undev (ida y vuelta de la corrección).
 */
export function decalCoords(chart, dec, W = 0, H = 0) {
  const n = chart.valid.length,
    x = new Float32Array(n),
    y = new Float32Array(n),
    rx = new Float32Array(n),
    ry = new Float32Array(n);
  const th = (dec.ang * Math.PI) / 180,
    rot = ((dec.rot || 0) * Math.PI) / 180,
    c = Math.cos(-rot),
    s = Math.sin(-rot);
  const jc = chart.jOfD(dec.d);
  let ok = chart.valid,
    idx = null;
  if (H > 0 && chart.vStart) {
    const reach = Math.hypot(W, H) / 2 + 2;
    let ja = jc,
      jb = jc;
    for (let q = 0; q < 8; q++) {
      const ph = -Math.PI + (q * Math.PI) / 4,
        y0 = chart.Yat(jc, ph);
      for (const yy of [y0 - reach, y0 + reach]) {
        const j = chart.jOfY(yy, ph);
        ja = Math.min(ja, j);
        jb = Math.max(jb, j);
      }
    }
    const nC = chart.vStart.length - 1,
      j0 = Math.max(0, Math.floor(ja) - 3),
      j1 = Math.min(nC - 1, Math.ceil(jb) + 3);
    idx = chart.vOrder.subarray(chart.vStart[j0], chart.vStart[j1 + 1]);
    ok = new Uint8Array(n);
    for (const i of idx) ok[i] = 1;
  }
  // Y del centro a cada ángulo (tabla) y arco del lado elegido en cada rodaja
  const NT = 360,
    yc = new Float64Array(NT + 1);
  for (let k = 0; k <= NT; k++) yc[k] = chart.Yat(jc, -Math.PI + (k / NT) * TAU);
  // estrechamiento local del brazo (cono): las filas se desenrollan como arcos concéntricos, sin cizalla en diagonal
  const rho0 = coneRho0(chart, jc, th, W),
    { dev, undev } = coneMaps(rho0);
  const arcTh = new Map(),
    m = idx ? idx.length : n;
  for (let q = 0; q < m; q++) {
    const i = idx ? idx[q] : q;
    if (!ok[i]) continue;
    const j0 = Math.floor(chart.jf[i]);
    let a0 = arcTh.get(j0);
    if (a0 === undefined) arcTh.set(j0, (a0 = [chart.arcAt(j0, th), chart.arcAt(j0 + 1, th)]));
    const t = chart.jf[i] - j0,
      aTh = a0[0] * (1 - t) + a0[1] * t,
      Lv = chart.vL[i];
    let ds = chart.vA[i] - aTh;
    ds -= Lv * Math.round(ds / Lv);
    const u = ((chart.phi[i] + Math.PI) / TAU) * NT,
      k = Math.min(NT - 1, Math.floor(u)),
      f = u - k;
    const X = chart.hand * ds,
      Y = chart.vY[i] - (yc[k] * (1 - f) + yc[k + 1] * f);
    rx[i] = X;
    ry[i] = Y;
    let xx = X,
      yy = Y;
    if (rho0) {
      const rho = rho0 + Y,
        t2 = X / rho;
      if (Math.abs(t2) < 1.5) {
        xx = rho * Math.sin(t2);
        yy = rho * Math.cos(t2) - rho0;
      }
    }
    x[i] = c * xx - s * yy;
    y[i] = s * xx + c * yy;
  }
  return { x, y, rx, ry, c, s, ok, L: chart.vL, rho0, dev, undev };
}

/**
 * Triángulos UV que tocan el rectángulo del tatuaje (W×H cm, centrado):
 * [{ f: cara (índice en F), i: vértices, p: [[x,y]×3] en cm, q: [[u,v]×3] en UV (v hacia arriba), t: vértices UV }]
 * Los triángulos de la «costura» del lado opuesto (x salta ±L) se emiten dos veces, desplazados, para la vuelta completa:
 * el desplazamiento se hace en la x SIN corregir (arco de la propia rodaja) y la corrección del cono se aplica después.
 */
export function decalTriangles(base, coords, W, H, margin = 0.5) {
  const F = base.F,
    FT = base.FT,
    VT = base.VT,
    { x, y, rx, ry, ok, L, dev } = coords,
    cr = coords.c,
    sr = coords.s,
    out = [];
  const hx = W / 2 + margin,
    hy = H / 2 + margin;
  const emit = (f, pt) => {
    out.push({
      f,
      i: [F[f], F[f + 1], F[f + 2]],
      p: pt,
      q: [0, 1, 2].map(k => [VT[2 * FT[f + k]], VT[2 * FT[f + k] + 1]]),
      t: [FT[f], FT[f + 1], FT[f + 2]],
    });
  };
  // costura del lado opuesto: sgn > 0 → los negativos pasan a +L; sgn < 0 → los positivos a −L (cada uno con su L)
  const seam = (f, sgn) => {
    const pt = [F[f], F[f + 1], F[f + 2]].map(i => {
      let sh = 0;
      if (sgn > 0 && rx[i] < 0) sh = L[i];
      else if (sgn < 0 && rx[i] > 0) sh = -L[i];
      if (!sh) return [x[i], y[i]];
      const [xx, yy] = dev(rx[i] + sh, ry[i]);
      return [cr * xx - sr * yy, sr * xx + cr * yy];
    });
    const xs = pt.map(q => q[0]),
      ys = pt.map(q => q[1]);
    if (Math.min(...xs) > hx || Math.max(...xs) < -hx || Math.min(...ys) > hy || Math.max(...ys) < -hy) return;
    emit(f, pt);
  };
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f],
      b = F[f + 1],
      c = F[f + 2];
    if (!(ok[a] && ok[b] && ok[c])) continue;
    const ra = rx[a],
      rb = rx[b],
      rc = rx[c];
    if (Math.max(ra, rb, rc) - Math.min(ra, rb, rc) > (L[a] + L[b] + L[c]) / 6) {
      seam(f, 1);
      seam(f, -1);
      continue;
    }
    // descarte rápido por caja, sólo con números (se ejecuta en cada fotograma del arrastre)
    const xa = x[a],
      xb = x[b],
      xc = x[c];
    if (Math.min(xa, xb, xc) > hx || Math.max(xa, xb, xc) < -hx) continue;
    const ya = y[a],
      yb = y[b],
      yc = y[c];
    if (Math.min(ya, yb, yc) > hy || Math.max(ya, yb, yc) < -hy) continue;
    emit(f, [
      [xa, ya],
      [xb, yb],
      [xc, yc],
    ]);
  }
  return out;
}

// Afín que lleva los 3 puntos p (origen) a los 3 puntos q (destino): [a, b, c, d, e, f] como en setTransform
export function affine3(p, q) {
  const [[x0, y0], [x1, y1], [x2, y2]] = p,
    [[u0, v0], [u1, v1], [u2, v2]] = q;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-12) return null;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det,
    c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det,
    b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det,
    d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  return [a, b, c, d, u0 - a * x0 - c * y0, v0 - b * x0 - d * y0];
}
export const bary = (p, x, y) => {
  const [[x0, y0], [x1, y1], [x2, y2]] = p;
  const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(det) < 1e-12) return null;
  const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det,
    l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det;
  return [l0, l1, 1 - l0 - l1];
};
const inTri = l => l && Math.min(...l) >= -1e-6;
// Rejilla en el marco del tatuaje (cm) sobre la lista de triángulos (H26): se guarda en la propia lista (tris._grid).
// Cada celda guarda los índices en orden, así que se devuelve el mismo triángulo que una búsqueda lineal.
function decalGrid(tris) {
  if (tris._grid) return tris._grid;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const t of tris)
    for (const [px, py] of t.p) {
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
  const G = Math.max(4, Math.min(96, Math.ceil(Math.sqrt(tris.length / 2)))),
    cw = (x1 - x0) / G || 1,
    ch = (y1 - y0) / G || 1,
    cells = Array.from({ length: G * G }, () => []),
    cell = (v, v0, s) => Math.min(G - 1, Math.max(0, Math.floor((v - v0) / s)));
  tris.forEach((t, k) => {
    const xs = t.p.map(q => q[0]),
      ys = t.p.map(q => q[1]);
    const c0 = cell(Math.min(...xs) - 1e-6, x0, cw),
      c1 = cell(Math.max(...xs) + 1e-6, x0, cw),
      r0 = cell(Math.min(...ys) - 1e-6, y0, ch),
      r1 = cell(Math.max(...ys) + 1e-6, y0, ch);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * G + c].push(k);
  });
  const g = { x0, y0, x1, y1, cw, ch, G, cells, cell };
  Object.defineProperty(tris, '_grid', { value: g, enumerable: false });
  return g;
}
/** UV del punto (x, y) cm del marco del tatuaje (por defecto su centro), o null. También el triángulo y los pesos. */
export function decalPointUV(tris, x = 0, y = 0) {
  const hit = t => {
    const l = bary(t.p, x, y);
    return inTri(l) ? { uv: [0, 1].map(c => l[0] * t.q[0][c] + l[1] * t.q[1][c] + l[2] * t.q[2][c]), tri: t, l } : null;
  };
  if (tris.length <= 32) {
    for (const t of tris) {
      const h = hit(t);
      if (h) return h;
    }
    return null;
  }
  const g = decalGrid(tris),
    e = 1e-6;
  if (x < g.x0 - e || x > g.x1 + e || y < g.y0 - e || y > g.y1 + e) return null;
  for (const k of g.cells[g.cell(y, g.y0, g.ch) * g.G + g.cell(x, g.x0, g.cw)]) {
    const h = hit(tris[k]);
    if (h) return h;
  }
  return null;
}
/** Punto del marco del tatuaje (cm) que cae en (u, v), o null. */
export function uvToDecal(tris, u, v) {
  for (const t of tris) {
    const l = bary(t.q, u, v);
    if (inTri(l)) return [0, 1].map(c => l[0] * t.p[0][c] + l[1] * t.p[1][c] + l[2] * t.p[2][c]);
  }
  return null;
}
/** Posición 3D (cm, malla ajustada P) del punto (x, y) del marco del tatuaje, o null. */
export function decalPoint3D(tris, P, x, y) {
  const h = decalPointUV(tris, x, y);
  if (!h) return null;
  const pos = [0, 1, 2].map(c => h.l.reduce((s, w, k) => s + w * P[3 * h.tri.i[k] + c], 0));
  return { pos, uv: h.uv };
}
/**
 * Medida real sobre la malla: recorre el segmento (x0,y0)→(x1,y1) del marco del tatuaje en `n` pasos y suma la
 * longitud 3D entre puntos consecutivos que cumplen keep(uv) (p. ej. alfa ≥ 50 % en la capa pintada).
 */
export function measureOnMesh(tris, P, x0, y0, x1, y1, n = 400, keep = () => true) {
  let len = 0,
    prev = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n,
      h = decalPoint3D(tris, P, x0 + t * (x1 - x0), y0 + t * (y1 - y0));
    const cur = h && keep(h.uv) ? h.pos : null;
    if (cur && prev) len += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    prev = cur;
  }
  return len;
}
/** UV del punto a d cm del hombro, en el lado ang (grados). */
export function cmToUV(base, chart, d, ang) {
  const co = decalCoords(chart, { d, ang, rot: 0 });
  const hit = decalPointUV(decalTriangles(base, co, 1, 1, 0.5));
  return hit ? hit.uv : null;
}

// ---------- mover un recorte con el dedo (H11): posición absoluta, sin perder arrastre ----------
/** Rejilla UV → (rodaja continua, ángulo) del brazo, para saber qué punto del brazo hay bajo el dedo. */
export function uvLocator(base, chart, G = 128) {
  const F = base.F,
    FT = base.FT,
    VT = base.VT,
    cells = Array.from({ length: G * G }, () => []);
  for (let f = 0; f < F.length; f += 3) {
    if (!(chart.valid[F[f]] && chart.valid[F[f + 1]] && chart.valid[F[f + 2]])) continue;
    const us = [0, 1, 2].map(k => VT[2 * FT[f + k]]),
      vs = [0, 1, 2].map(k => VT[2 * FT[f + k] + 1]);
    const c0 = Math.max(0, Math.floor(Math.min(...us) * G)),
      c1 = Math.min(G - 1, Math.floor(Math.max(...us) * G)),
      r0 = Math.max(0, Math.floor(Math.min(...vs) * G)),
      r1 = Math.min(G - 1, Math.floor(Math.max(...vs) * G));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * G + c].push(f);
  }
  return (u, v) => {
    const c = Math.floor(u * G),
      r = Math.floor(v * G);
    if (c < 0 || r < 0 || c >= G || r >= G) return null;
    for (const f of cells[r * G + c]) {
      const q = [0, 1, 2].map(k => [VT[2 * FT[f + k]], VT[2 * FT[f + k] + 1]]);
      const l = bary(q, u, v);
      if (!inTri(l)) continue;
      const vi = [F[f], F[f + 1], F[f + 2]],
        p0 = chart.phi[vi[0]];
      let jf = 0,
        ph = 0;
      vi.forEach((i, k) => {
        jf += l[k] * chart.jf[i];
        let d = chart.phi[i] - p0;
        d -= TAU * Math.round(d / TAU);
        ph += l[k] * (p0 + d);
      });
      return { jf, phi: ph - TAU * Math.round(ph / TAU) };
    }
    return null;
  };
}
const wrapDeg = a => ((((a + 540) % 360) + 360) % 360) - 180;
/**
 * Giro del recorte tras girar dos dedos dRot grados en pantalla (y hacia abajo), en la vista 2D (textura plana).
 * La UV no conserva los ángulos (H36): girar el dibujo 15° sobre la piel podía verse girar 19,9° en la vista plana. Se
 * busca el giro sobre la piel que, visto en la vista plana alrededor del centro del recorte, mide exactamente lo que
 * giraron los dedos (y hacia el mismo lado, también donde la isla de la UV está volteada).
 */
export function pinchRot(tris, rot, dRot) {
  const h = decalPointUV(tris);
  if (!h) return wrapDeg(rot + dRot);
  // cm del marco → vista plana (x = u, y = 1 − v hacia abajo)
  const A = affine3(
    h.tri.p,
    h.tri.q.map(([u, v]) => [u, 1 - v]),
  );
  if (!A) return wrapDeg(rot + dRot);
  // ángulo en la vista plana del eje x del dibujo tras girarlo d radianes sobre la piel
  const scr = d => Math.atan2(A[1] * Math.cos(d) + A[3] * Math.sin(d), A[0] * Math.cos(d) + A[2] * Math.sin(d));
  const sg = A[0] * A[3] - A[1] * A[2] < 0 ? -1 : 1, // isla UV volteada
    a0 = scr(0),
    want = (dRot * Math.PI) / 180;
  let lo = -Math.PI / 2,
    hi = Math.PI / 2;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    let e = scr(sg * mid) - a0 - want;
    e -= 2 * Math.PI * Math.round(e / (2 * Math.PI));
    if (e < 0) lo = mid;
    else hi = mid;
  }
  return wrapDeg(rot + (sg * (lo + hi) * 90) / Math.PI);
}
/**
 * Deformación del dibujo (H32): el mayor error relativo de los 4 bordes y las 2 diagonales del dibujo (W × H cm,
 * centrado), medidos sobre la malla 3D. Donde la piel se curva en dos direcciones (hombro, codo) la carta no puede ser
 * plana sin estirar ni torcer: el editor avisa a partir del 5 %. (El percentil de las aristas de cada triángulo que
 * proponía la auditoría da 7–8 % hasta en el brazo, donde el dibujo mide ±1 %: mide la malla, no el dibujo.)
 * Las líneas que se salen de la malla (por encima del hombro, más allá de la mano) no cuentan.
 */
export function decalStretch(tris, P, W, H, n = 200) {
  const x = W / 2,
    y = H / 2,
    D = Math.hypot(W, H);
  let worst = 0;
  for (const [x0, y0, x1, y1, real] of [
    [-x, -y, x, -y, W],
    [-x, y, x, y, W],
    [-x, -y, -x, y, H],
    [x, -y, x, y, H],
    [-x, -y, x, y, D],
    [x, -y, -x, y, D],
  ]) {
    let len = 0,
      prev = null,
      ok = true;
    for (let k = 0; k <= n && ok; k++) {
      const h = decalPoint3D(tris, P, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
      if (!h) ok = false;
      else {
        if (prev) len += Math.hypot(h.pos[0] - prev[0], h.pos[1] - prev[1], h.pos[2] - prev[2]);
        prev = h.pos;
      }
    }
    if (ok && real > 0) worst = Math.max(worst, Math.abs(len / real - 1));
  }
  return worst;
}
/**
 * Nueva posición { d, ang } del recorte para que su punto (gx, gy) (cm en su marco, el que se agarró) quede bajo el
 * punto del brazo `at` = { jf, phi } (de uvLocator). W: ancho del tatuaje en cm (el mismo que en decalCoords).
 * Se deshace la corrección del cono (undev) del punto agarrado; como el cono depende de la posición nueva, se repite
 * con el cono del sitio de destino (converge en 2–3 vueltas).
 */
export function placeAt(chart, dec, gx, gy, at, W = 0) {
  const rot = ((dec.rot || 0) * Math.PI) / 180,
    c = Math.cos(-rot),
    s = Math.sin(-rot);
  const gxx = c * gx + s * gy,
    gyy = -s * gx + c * gy; // marco del brazo sin girar (x = hand·arco, y = hacia la mano), con la corrección del cono
  let pos = { d: dec.d, ang: dec.ang };
  for (let it = 0; it < 3; it++) {
    const th0 = (pos.ang * Math.PI) / 180,
      [xx, yy] = coneMaps(coneRho0(chart, chart.jOfD(pos.d), th0, W)).undev(gxx, gyy);
    const jc = chart.jOfY(chart.Yat(at.jf, at.phi) - yy, at.phi);
    // el arco se mide en la rodaja de cada punto: la del dedo
    const th = chart.phiOfArc(at.jf, chart.arcAt(at.jf, at.phi) - chart.hand * xx);
    pos = { d: chart.dOfJ(jc), ang: (th * 180) / Math.PI };
  }
  return pos;
}
