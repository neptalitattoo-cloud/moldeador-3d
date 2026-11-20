// Herramientas de «Foto del brazo» sin DOM (se prueban en Node):
//  - promedio robusto de color (cuentagotas)
//  - borde suave de un recorte (desenfoque de la máscara)
//  - carta de la superficie del brazo: (cm desde el hombro, cm alrededor del brazo) ↔ UV, para colocar tatuajes
import { gauss1d, dot, cross, norm } from './core.js?v=8';

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
// ¿Punto dentro del polígono? (regla par-impar)
export function insidePoly(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// ---------- carta de la superficie ----------
// Lados del brazo: ángulo (grados) alrededor del eje, 0 = exterior (la línea donde se miden los largos).
export const LADOS = { exterior: 0, delante: 90, interior: 180, detras: -90 };
const wrapPi = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * Para cada vértice del brazo (de la muñeca a la punta del hombro): d = cm desde la punta del hombro (misma cinta que
 * las medidas), phi = ángulo alrededor del eje (0 exterior, +π/2 delante), r = distancia al eje (cm).
 * hand = +1/-1: sentido para que el tatuaje no salga en espejo visto desde fuera.
 */
export function surfaceChart(base, P, tape) {
  const m = base.meta,
    n = m.nV,
    sv = base.sv,
    step = m.step,
    nC = m.nC;
  const sMin = m.S_WR - 1,
    sMax = m.s_tip;
  // centro de cada rodaja en la malla ajustada
  const cx = new Float64Array(nC),
    cy = new Float64Array(nC),
    cz = new Float64Array(nC),
    cnt = new Float64Array(nC);
  for (let i = 0; i < n; i++) {
    if (sv[i] < sMin || sv[i] > sMax) continue;
    const j = Math.min(nC - 1, Math.max(0, Math.round(sv[i] / step)));
    cx[j] += P[3 * i];
    cy[j] += P[3 * i + 1];
    cz[j] += P[3 * i + 2];
    cnt[j]++;
  }
  const ok = [];
  for (let j = 0; j < nC; j++) if (cnt[j] >= 6) ok.push(j);
  if (ok.length < 5) throw new Error('No se pudo calcular el eje del brazo.');
  const js = ok,
    sm = c =>
      gauss1d(
        js.map(j => c[j] / cnt[j]),
        3,
      );
  const X = sm(cx),
    Y = sm(cy),
    Z = sm(cz);
  const C = new Float64Array(3 * nC),
    T = new Float64Array(3 * nC),
    E1 = new Float64Array(3 * nC),
    E2 = new Float64Array(3 * nC);
  // rellena todas las rodajas interpolando entre las válidas
  for (let j = 0; j < nC; j++) {
    let k = 0;
    while (k < js.length - 1 && js[k + 1] <= j) k++;
    const k2 = Math.min(js.length - 1, k + 1),
      t = js[k2] === js[k] ? 0 : Math.min(1, Math.max(0, (j - js[k]) / (js[k2] - js[k])));
    C[3 * j] = X[k] + t * (X[k2] - X[k]);
    C[3 * j + 1] = Y[k] + t * (Y[k2] - Y[k]);
    C[3 * j + 2] = Z[k] + t * (Z[k2] - Z[k]);
  }
  const outer = m.dir_outer || [-1, 0, 0],
    front = (m.dir_back || [0, 0, -1]).map(v => -v);
  // el signo de e2 se decide en una rodaja del medio del antebrazo/brazo (las de los extremos pueden ser degeneradas)
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
  // Visto desde fuera con el hombro arriba, la derecha de la imagen es T × normal; en phi = 0 eso es cross(t, e1) = sign·e2
  const hand = sign;
  const d = new Float32Array(n),
    phi = new Float32Array(n),
    r = new Float32Array(n),
    valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (sv[i] < sMin || sv[i] > sMax - 0.5) continue;
    const j = Math.min(nC - 1, Math.max(0, Math.round(sv[i] / step)));
    const o = [P[3 * i] - C[3 * j], P[3 * i + 1] - C[3 * j + 1], P[3 * i + 2] - C[3 * j + 2]];
    const t = [T[3 * j], T[3 * j + 1], T[3 * j + 2]];
    const op = o.map((v, c) => v - dot(o, t) * t[c]);
    const a = dot(op, [E1[3 * j], E1[3 * j + 1], E1[3 * j + 2]]),
      b = dot(op, [E2[3 * j], E2[3 * j + 1], E2[3 * j + 2]]);
    d[i] = tape(sv[i]);
    phi[i] = Math.atan2(b, a);
    r[i] = Math.hypot(a, b);
    valid[i] = Number.isFinite(d[i]) && r[i] > 0.5 ? 1 : 0;
  }
  return { d, phi, r, valid, hand };
}

/**
 * Coordenadas (cm) de cada vértice en el marco de un tatuaje colocado:
 *   x hacia la derecha de la imagen, y hacia abajo (hacia la mano), origen en el centro del tatuaje, ya girado.
 * dec = { d: cm desde el hombro al centro, ang: grados alrededor del brazo (0 exterior), rot: grados de giro }
 */
export function decalCoords(chart, dec) {
  const n = chart.d.length,
    x = new Float32Array(n),
    y = new Float32Array(n),
    ok = new Uint8Array(n);
  const th = (dec.ang * Math.PI) / 180,
    rot = ((dec.rot || 0) * Math.PI) / 180,
    c = Math.cos(-rot),
    s = Math.sin(-rot);
  for (let i = 0; i < n; i++) {
    if (!chart.valid[i]) continue;
    const pr = wrapPi(chart.phi[i] - th);
    if (Math.abs(pr) > 2.6) continue; // lejos del lado elegido: evita la costura del otro lado
    const xx = chart.hand * pr * chart.r[i],
      yy = chart.d[i] - dec.d;
    x[i] = c * xx - s * yy;
    y[i] = s * xx + c * yy;
    ok[i] = 1;
  }
  return { x, y, ok };
}

/**
 * Triángulos UV que tocan el rectángulo del tatuaje (W×H cm, centrado):
 * [{ p: [[x,y]×3] en cm, q: [[u,v]×3] en UV (v hacia arriba) }]
 */
export function decalTriangles(base, coords, W, H, margin = 0.5) {
  const F = base.F,
    FT = base.FT,
    VT = base.VT,
    { x, y, ok } = coords,
    out = [];
  const hx = W / 2 + margin,
    hy = H / 2 + margin;
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f],
      b = F[f + 1],
      c = F[f + 2];
    if (!(ok[a] && ok[b] && ok[c])) continue;
    if (Math.min(x[a], x[b], x[c]) > hx || Math.max(x[a], x[b], x[c]) < -hx) continue;
    if (Math.min(y[a], y[b], y[c]) > hy || Math.max(y[a], y[b], y[c]) < -hy) continue;
    // triángulos estirados por la costura del ángulo: fuera
    if (Math.max(Math.abs(x[a] - x[b]), Math.abs(x[b] - x[c]), Math.abs(x[a] - x[c])) > 4) continue;
    const ta = FT[f],
      tb = FT[f + 1],
      tc = FT[f + 2];
    out.push({
      i: [a, b, c],
      p: [
        [x[a], y[a]],
        [x[b], y[b]],
        [x[c], y[c]],
      ],
      q: [
        [VT[2 * ta], VT[2 * ta + 1]],
        [VT[2 * tb], VT[2 * tb + 1]],
        [VT[2 * tc], VT[2 * tc + 1]],
      ],
    });
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
const bary = (p, x, y) => {
  const [[x0, y0], [x1, y1], [x2, y2]] = p;
  const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(det) < 1e-12) return null;
  const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det,
    l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det;
  return [l0, l1, 1 - l0 - l1];
};
/** UV del punto (x, y) cm del marco del tatuaje (por defecto su centro), o null. También el triángulo usado. */
export function decalPointUV(tris, x = 0, y = 0) {
  for (const t of tris) {
    const l = bary(t.p, x, y);
    if (l && Math.min(...l) >= -1e-6)
      return { uv: [0, 1].map(c => l[0] * t.q[0][c] + l[1] * t.q[1][c] + l[2] * t.q[2][c]), tri: t };
  }
  return null;
}
/** UV del punto a d cm del hombro, en el lado ang (grados). */
export function cmToUV(base, chart, d, ang) {
  const co = decalCoords(chart, { d, ang, rot: 0 });
  const hit = decalPointUV(decalTriangles(base, co, 1, 1, 0.5));
  return hit ? hit.uv : null;
}
