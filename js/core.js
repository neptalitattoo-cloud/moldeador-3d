// Moldeador — núcleo matemático (sin DOM). Funciona en navegador y en Node.
// Ajuste por tramos de la longitud a lo largo del eje (medida por la cara externa desde la punta del hombro),
// escalado radial a contornos con perfil suave, mano proporcional con escalado anisótropo y transición smoothstep.

// ---------- utilidades numéricas ----------
export function pchip(xs, ys) {
  const n = xs.length,
    h = [],
    del = [],
    d = new Array(n).fill(0);
  for (let k = 0; k < n - 1; k++) {
    h[k] = xs[k + 1] - xs[k];
    del[k] = (ys[k + 1] - ys[k]) / h[k];
  }
  if (n === 2) {
    d[0] = d[1] = del[0];
  } else {
    for (let k = 1; k < n - 1; k++) {
      if (del[k - 1] * del[k] <= 0) d[k] = 0;
      else {
        const w1 = 2 * h[k] + h[k - 1],
          w2 = h[k] + 2 * h[k - 1];
        d[k] = (w1 + w2) / (w1 / del[k - 1] + w2 / del[k]);
      }
    }
    const edge = (h0, h1, m0, m1) => {
      let dd = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
      if (Math.sign(dd) !== Math.sign(m0)) dd = 0;
      else if (Math.sign(m0) !== Math.sign(m1) && Math.abs(dd) > 3 * Math.abs(m0)) dd = 3 * m0;
      return dd;
    };
    d[0] = edge(h[0], h[1], del[0], del[1]);
    d[n - 1] = edge(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
  }
  function seg(x) {
    let lo = 0,
      hi = n - 2;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (xs[m] <= x) lo = m;
      else hi = m - 1;
    }
    return lo;
  }
  const f = x => {
    if (x <= xs[0]) return ys[0] + d[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + d[n - 1] * (x - xs[n - 1]);
    const k = seg(x),
      t = (x - xs[k]) / h[k],
      t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[k] +
      (t3 - 2 * t2 + t) * h[k] * d[k] +
      (-2 * t3 + 3 * t2) * ys[k + 1] +
      (t3 - t2) * h[k] * d[k + 1]
    );
  };
  f.deriv = x => {
    if (x <= xs[0]) return d[0];
    if (x >= xs[n - 1]) return d[n - 1];
    const k = seg(x),
      t = (x - xs[k]) / h[k],
      t2 = t * t;
    return (
      ((6 * t2 - 6 * t) * ys[k] + (-6 * t2 + 6 * t) * ys[k + 1]) / h[k] +
      (3 * t2 - 4 * t + 1) * d[k] +
      (3 * t2 - 2 * t) * d[k + 1]
    );
  };
  return f;
}
export function interp(x, xs, ys) {
  // xs increasing, clamp
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}
export function gauss1d(a, sigma) {
  // scipy.ndimage.gaussian_filter1d, mode reflect, truncate 4
  const r = Math.round(4 * sigma),
    w = [];
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp((-0.5 * i * i) / (sigma * sigma));
    w.push(v);
    s += v;
  }
  const n = a.length,
    out = new Array(n);
  const idx = i => {
    while (i < 0 || i >= n) {
      if (i < 0) i = -i - 1;
      if (i >= n) i = 2 * n - i - 1;
    }
    return i;
  };
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += w[j + r] * a[idx(i + j)];
    out[i] = acc / s;
  }
  return out;
}
export function hull2d(P) {
  // P: array of [x,y]; returns hull points (monotone chain)
  const p = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [],
    up = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}
export function perim(H) {
  let s = 0;
  for (let i = 0; i < H.length; i++) {
    const a = H[i],
      b = H[(i + 1) % H.length];
    s += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return s;
}
export function maxCaliper(H) {
  let best = 0,
    ang = 0;
  for (let k = 0; k < 360; k++) {
    const th = (Math.PI * k) / 360,
      c = Math.cos(th),
      s = Math.sin(th);
    let mn = 1e9,
      mx = -1e9;
    for (const q of H) {
      const v = q[0] * c + q[1] * s;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx - mn > best) {
      best = mx - mn;
      ang = th;
    }
  }
  return [best, ang];
}
function components(P, r) {
  // union-find on 2D points within radius r
  const n = P.length,
    par = new Int32Array(n).map((_, i) => i);
  const find = i => {
    while (par[i] !== i) {
      par[i] = par[par[i]];
      i = par[i];
    }
    return i;
  };
  const grid = new Map(),
    key = (x, y) => (x * 73856093) ^ (y * 19349663);
  P.forEach((q, i) => {
    const k = key(Math.floor(q[0] / r), Math.floor(q[1] / r));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  P.forEach((q, i) => {
    const gx = Math.floor(q[0] / r),
      gy = Math.floor(q[1] / r);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const L = grid.get(key(gx + dx, gy + dy));
        if (!L) continue;
        for (const j of L)
          if (j > i && Math.hypot(P[j][0] - q[0], P[j][1] - q[1]) < r) {
            const a = find(i),
              b = find(j);
            if (a !== b) par[a] = b;
          }
      }
  });
  const lab = new Int32Array(n);
  for (let i = 0; i < n; i++) lab[i] = find(i);
  return lab;
}
// Puntos del componente conexo más grande (radio de vecindad r).
export function largestComponent(Q, r = SECTION_LINK_R) {
  const lab = components(Q, r),
    cnt = new Map();
  for (const l of lab) cnt.set(l, (cnt.get(l) || 0) + 1);
  let big = -1,
    bc = -1;
  for (const [l, c] of cnt)
    if (c > bc) {
      bc = c;
      big = l;
    }
  return Q.filter((_, i) => lab[i] === big);
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smooth = x => {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
};

// ---------- base ----------
export function loadBase(meta, buffer) {
  const B = {};
  for (const [k, [o, n, dt]] of Object.entries(meta.blobs))
    B[k] = dt.includes('f') ? new Float32Array(buffer, o, n) : new Uint32Array(buffer, o, n);
  const base = { meta, ...B };
  const n = meta.nV;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => B.sv[a] - B.sv[b]);
  base.order = Int32Array.from(order);
  base.svSorted = Float32Array.from(order.map(i => B.sv[i]));
  base.merStart = [];
  let acc = 0;
  for (const c of meta.mer_n) {
    base.merStart.push(acc);
    acc += c;
  }
  return base;
}
function slab(base, s0, hw) {
  // vertex indices with |sv-s0|<hw
  const a = base.svSorted;
  const lb = x => {
    let lo = 0,
      hi = a.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (a[m] < x) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  return base.order.subarray(lb(s0 - hw), lb(s0 + hw));
}
function Tat(base, s) {
  const j = Math.min(base.meta.nC - 1, Math.max(0, Math.round(s / base.meta.step)));
  const T = base.T;
  return [T[3 * j], T[3 * j + 1], T[3 * j + 2]];
}
export function circAt(base, P, s0) {
  const idx = slab(base, s0, SECTION_HALF_W);
  if (idx.length < 10) return NaN;
  const t = Tat(base, s0);
  let e1 = cross(t, [0, 0, 1]);
  e1 = norm(e1);
  const e2 = cross(t, e1);
  const Q = [];
  for (const i of idx) {
    const p = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
    Q.push([dot(p, e1), dot(p, e2)]);
  }
  return perim(hull2d(Q));
}
export function tapeFn(base, P) {
  // returns {S (desc), D}: tape distance along outer meridian from shoulder tip
  const m = base.meta,
    ti = m.tip;
  const pts = [[P[3 * ti], P[3 * ti + 1], P[3 * ti + 2]]],
    S = [m.s_tip];
  m.mer_s.forEach((s, k) => {
    const st = base.merStart[k],
      cnt = m.mer_n[k];
    let x = 0,
      y = 0,
      z = 0;
    for (let q = 0; q < cnt; q++) {
      const i = base.mer[st + q];
      x += P[3 * i];
      y += P[3 * i + 1];
      z += P[3 * i + 2];
    }
    pts.push([x / cnt, y / cnt, z / cnt]);
    S.push(s);
  });
  const D = [0];
  for (let i = 1; i < pts.length; i++)
    D.push(D[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const negS = S.map(s => -s);
  const f = s => interp(-s, negS, D);
  f.pts = pts;
  f.S = S;
  f.D = D;
  f.inv = T => {
    // s where tape == T (search on arm)
    for (let i = 1; i < D.length; i++)
      if (D[i] >= T) {
        const t = (T - D[i - 1]) / (D[i] - D[i - 1]);
        return S[i - 1] + t * (S[i] - S[i - 1]);
      }
    return S[S.length - 1];
  };
  return f;
}

// ---------- deformación del brazo ----------
function deformArm(base, kn, kfun) {
  const m = base.meta,
    nC = m.nC,
    st = m.step,
    C = base.C,
    T = base.T,
    sT = m.s_tip;
  const xs = [-6, -3, 0, kn.elO, kn.wrO, kn.wrO + 3, kn.wrO + 8, kn.wrO + 20, kn.wrO + 40];
  const ys = [-6, -3, 0, kn.elN, kn.wrN, kn.wrN + 3, kn.wrN + 8, kn.wrN + 20, kn.wrN + 40];
  const h = pchip(xs, ys);
  const Pn = new Float64Array(3 * nC);
  let x = 0,
    y = 0,
    z = 0;
  for (let j = 0; j < nC; j++) {
    const step = j === 0 ? 0 : st * h.deriv(sT - j * st);
    x += T[3 * j] * step;
    y += T[3 * j + 1] * step;
    z += T[3 * j + 2] * step;
    Pn[3 * j] = x;
    Pn[3 * j + 1] = y;
    Pn[3 * j + 2] = z;
  }
  const jt = Math.round(sT / st),
    dx = C[3 * jt] - Pn[3 * jt],
    dy = C[3 * jt + 1] - Pn[3 * jt + 1],
    dz = C[3 * jt + 2] - Pn[3 * jt + 2];
  for (let j = 0; j < nC; j++) {
    Pn[3 * j] += dx;
    Pn[3 * j + 1] += dy;
    Pn[3 * j + 2] += dz;
  }
  const n = m.nV,
    P = new Float32Array(3 * n),
    sv = base.sv,
    off = base.off;
  for (let i = 0; i < n; i++) {
    let u = sv[i] / st;
    u = Math.min(nC - 1, Math.max(0, u));
    const j0 = Math.min(nC - 2, Math.floor(u)),
      t = u - j0,
      k = kfun(sv[i]);
    for (let c = 0; c < 3; c++) P[3 * i + c] = Pn[3 * j0 + c] * (1 - t) + Pn[3 * j0 + 3 + c] * t + off[3 * i + c] * k;
  }
  const pnAt = s => {
    const u = Math.min(nC - 1, Math.max(0, s / st));
    const j0 = Math.min(nC - 2, Math.floor(u)),
      t = u - j0;
    return [0, 1, 2].map(c => Pn[3 * j0 + c] * (1 - t) + Pn[3 * j0 + 3 + c] * t);
  };
  return { P, pnAt };
}

// ---------- constantes con nombre ----------
export const HAND_LEN_K = 0.79; // largo de la mano ≈ 0,79 × antebrazo
export const KNUCKLE_W_K = 0.45; // ancho de nudillos ≈ 0,45 × largo de la mano
export const KNUCKLE_CIRC_WRIST_K = 1.04; // contorno de nudillos ≈ 1,04 × muñeca
export const KNUCKLE_CIRC_MIN_K = 2.4; // contorno de nudillos nunca menor que 2,4 × ancho (sección posible)
export const KNUCKLE_CIRC_K = 2.45; // contorno de nudillos si el usuario da el ancho
export const HAND_CIRC_EXP = 1.6; // exponente de corrección del grosor de la mano por iteración
export const HAND_BLEND = [0.3, 2.7]; // la mano empieza 0,3 cm tras la muñeca y se mezcla en 2,7 cm
export const SECTION_HALF_W = 0.25; // media anchura (cm) de las rodajas de sección
export const FIT_TOLERANCE = 0.3; // cm: diferencia máxima aceptada entre medida pedida y obtenida
export const SECTION_LINK_R = 0.7; // radio (cm) para unir puntos de una misma sección
export const FIT_ITERS = 12,
  FIT_PROFILE_ITERS = 8,
  HAND_ITERS = 10;

// ---------- validación ----------
// Rangos en cm: amplios, sólo filtran errores de tecleo y valores imposibles.
export const RANGOS = {
  hombro_codo: [15, 60],
  codo_muneca: [12, 50],
  hombro_muneca: [25, 110],
  c_axila: [8, 80],
  c_biceps: [8, 80],
  c_codo: [8, 80],
  c_antebrazo: [8, 80],
  c_muneca: [8, 80],
  largo_mano: [10, 30],
  ancho_nudillos: [4, 15],
};
const OPCIONALES = new Set(['codo_muneca', 'hombro_muneca', 'largo_mano', 'ancho_nudillos']);
export function validateInputs(raw, labels = {}) {
  const inp = { ...raw },
    warn = [],
    lab = id => labels[id] || id;
  for (const [id, v] of Object.entries(inp))
    if (v != null && !Number.isFinite(v)) throw new Error(`Revisa: ${lab(id)} (no es un número).`);
  if (inp.hombro_codo == null) throw new Error(`Falta: ${lab('hombro_codo')}.`);
  if (inp.hombro_muneca == null && inp.codo_muneca == null) throw new Error('Falta codo → muñeca u hombro → muñeca.');
  if (inp.hombro_muneca == null) inp.hombro_muneca = inp.hombro_codo + inp.codo_muneca;
  for (const [id, [lo, hi]] of Object.entries(RANGOS)) {
    const v = inp[id];
    if (v == null) {
      if (!OPCIONALES.has(id)) throw new Error(`Falta: ${lab(id)}.`);
      continue;
    }
    if (v < lo || v > hi) throw new Error(`Revisa: ${lab(id)} (entre ${lo} y ${hi} cm).`);
  }
  if (inp.codo_muneca != null && Math.abs(inp.hombro_codo + inp.codo_muneca - inp.hombro_muneca) > 0.5)
    warn.push(
      `Ojo: 1 + 2 = ${(inp.hombro_codo + inp.codo_muneca).toFixed(1)} no cuadra con 3 = ${inp.hombro_muneca}; uso hombro→codo y hombro→muñeca.`,
    );
  if (inp.hombro_muneca - inp.hombro_codo < 10)
    throw new Error('El antebrazo sale demasiado corto: revisa los largos.');
  if (inp.largo_mano != null && inp.ancho_nudillos != null && inp.ancho_nudillos >= inp.largo_mano)
    throw new Error('El ancho de nudillos no puede ser mayor que el largo de la mano.');
  return { inp, warn };
}
export function assertFinite(A, que) {
  for (let i = 0; i < A.length; i++)
    if (!Number.isFinite(A[i])) throw new Error(`${que}: valor no numérico (índice ${i}). Revisa las medidas.`);
}
// Identificador USD válido: [A-Za-z_][A-Za-z0-9_]*
export function usdIdent(s) {
  let id = String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(id)) id = '_' + id;
  return id;
}

// ---------- mano ----------
function mcpSection(base, P, wc, a, hand) {
  let HL = -1e9;
  for (const i of hand) {
    const d = (P[3 * i] - wc[0]) * a[0] + (P[3 * i + 1] - wc[1]) * a[1] + (P[3 * i + 2] - wc[2]) * a[2];
    if (d > HL) HL = d;
  }
  const d0 = base.meta.mcp_frac * HL;
  const u = norm(cross(a, [0, 0, 1])),
    v = cross(a, u);
  const Q = [];
  for (const i of hand) {
    const p = [P[3 * i] - wc[0], P[3 * i + 1] - wc[1], P[3 * i + 2] - wc[2]];
    if (Math.abs(dot(p, a) - d0) < SECTION_HALF_W) Q.push([dot(p, u), dot(p, v)]);
  }
  const R = largestComponent(Q);
  if (R.length < 3) throw new Error('No se encontró la sección de los nudillos: revisa largo y ancho de la mano.');
  const H = hull2d(R),
    [br, ang] = maxCaliper(H);
  const cen = [R.reduce((s, q) => s + q[0], 0) / R.length, R.reduce((s, q) => s + q[1], 0) / R.length];
  return { HL, d0, circ: perim(H), br, ang, cen, u, v };
}
function handFit(base, P1, wc, t, tgt) {
  const a = base.meta.hand_a,
    n = base.meta.nV,
    hand = [];
  for (let i = 0; i < n; i++) {
    const d = (P1[3 * i] - wc[0]) * t[0] + (P1[3 * i + 1] - wc[1]) * t[1] + (P1[3 * i + 2] - wc[2]) * t[2];
    if (d > HAND_BLEND[0]) hand.push(i);
  }
  const M0 = mcpSection(base, P1, wc, a, hand);
  const cen3 = [0, 1, 2].map(c => M0.cen[0] * M0.u[c] + M0.cen[1] * M0.v[c]);
  const e1 = [0, 1, 2].map(c => Math.cos(M0.ang) * M0.u[c] + Math.sin(M0.ang) * M0.v[c]),
    e2 = cross(a, e1);
  const apply = (sa, s1, s2) => {
    const P = Float32Array.from(P1);
    for (const i of hand) {
      const X = [P1[3 * i] - wc[0], P1[3 * i + 1] - wc[1], P1[3 * i + 2] - wc[2]];
      const w = smooth((dot(X, t) - HAND_BLEND[0]) / HAND_BLEND[1]);
      if (w <= 0) continue;
      const da = dot(X, a),
        Y = [X[0] - cen3[0], X[1] - cen3[1], X[2] - cen3[2]],
        y1 = dot(Y, e1),
        y2 = dot(Y, e2);
      for (let c = 0; c < 3; c++)
        P[3 * i + c] += w * ((sa - 1) * da * a[c] + (s1 - 1) * y1 * e1[c] + (s2 - 1) * y2 * e2[c]);
    }
    return P;
  };
  let sa = 1,
    s1 = 1,
    s2 = 1,
    P = P1,
    M = M0;
  const before = { HL: M0.HL, br: M0.br, circ: M0.circ };
  for (let it = 0; it < HAND_ITERS; it++) {
    sa *= tgt.HL / M.HL;
    s1 *= tgt.br / M.br;
    s2 *= Math.pow(tgt.circ / M.circ, HAND_CIRC_EXP);
    s2 = Math.min(2.5, Math.max(0.4, s2));
    s1 = Math.min(2.5, Math.max(0.4, s1));
    sa = Math.min(1.8, Math.max(0.5, sa));
    if (!Number.isFinite(sa * s1 * s2))
      throw new Error('El ajuste de la mano no converge: revisa las medidas de la mano.');
    P = apply(sa, s1, s2);
    M = mcpSection(base, P, wc, a, hand);
  }
  return { P, sa, s1, s2, before, after: { HL: M.HL, br: M.br, circ: M.circ } };
}

// ---------- ajuste completo ----------
export function fit(base, inp, log = () => {}) {
  inp = validateInputs(inp).inp; // protege también al worker, a Node y a los tests
  const m = base.meta,
    V0 = base.V0;
  const tEl = inp.hombro_codo,
    tWr = inp.hombro_muneca || inp.hombro_codo + inp.codo_muneca,
    forearm = tWr - tEl;
  const circT = [inp.c_axila, inp.c_biceps, inp.c_codo, inp.c_antebrazo, inp.c_muneca];
  const HLt = inp.largo_mano || HAND_LEN_K * forearm,
    brT = inp.ancho_nudillos || KNUCKLE_W_K * HLt;
  // contorno nudillos: 1,04×muñeca, pero nunca menor que 2,4×ancho (sección físicamente posible)
  const circHand = inp.ancho_nudillos
    ? KNUCKLE_CIRC_K * brT
    : Math.max(KNUCKLE_CIRC_WRIST_K * inp.c_muneca, KNUCKLE_CIRC_MIN_K * brT);
  const tape0 = tapeFn(base, V0);
  const kn = { elO: m.s_tip - m.S_EL, wrO: m.s_tip - m.S_WR };
  kn.elN = tEl - (tape0(m.S_EL) - kn.elO);
  kn.wrN = tWr - (tape0(m.S_WR) - kn.wrO);
  const sg = [];
  for (let s = m.S_WR - 1; s <= m.S_AX + 1e-6; s += 0.5) sg.push(s);
  const c0 = gauss1d(
    sg.map(s => circAt(base, V0, s)),
    2,
  );
  let corr = sg.map(() => 1),
    res = deformArm(base, kn, () => 1),
    P = res.P,
    hand = null,
    tgtProf = null;
  for (let it = 0; it < FIT_ITERS; it++) {
    const tp = tapeFn(base, P);
    const ax = tp(m.S_AX),
      xs = [ax, (ax + tEl) / 2, tEl, (tEl + tWr) / 2, tWr];
    for (let i = 1; i < 5; i++)
      if (!(xs[i] > xs[i - 1] + 0.5))
        throw new Error(
          'Medidas de largo incoherentes (hombro→codo debe ser mayor que la distancia a la axila y menor que hombro→muñeca).',
        );
    const f = pchip(xs, circT);
    tgtProf = sg.map(s => f(Math.min(xs[4], Math.max(xs[0], tp(s)))));
    const k = gauss1d(
      tgtProf.map((v, i) => (v / c0[i]) * corr[i]),
      1.5,
    );
    res = deformArm(base, kn, s => interp(s, sg, k));
    const jw = m.S_WR,
      wc = res.pnAt(jw),
      T = Tat(base, jw),
      t = [-T[0], -T[1], -T[2]];
    hand = handFit(base, res.P, wc, t, { HL: HLt, br: brT, circ: circHand });
    P = hand.P;
    const tp2 = tapeFn(base, P);
    const eEl = tEl - tp2(m.S_EL),
      eWr = tWr - tp2(m.S_WR);
    log(`iter ${it}: codo ${tp2(m.S_EL).toFixed(2)} muñeca ${tp2(m.S_WR).toFixed(2)}`);
    kn.elN += eEl;
    kn.wrN += eWr;
    if (it < FIT_PROFILE_ITERS) {
      const meas = gauss1d(
        sg.map(s => {
          const c = circAt(base, P, s);
          return isNaN(c) ? 1 : c;
        }),
        1,
      );
      corr = corr.map((c, i) => c * Math.min(1.1, Math.max(0.9, tgtProf[i] / Math.max(meas[i], 1e-3))));
    } else {
      // afinado por estaciones (valores exactos en axila, bíceps, codo, antebrazo, muñeca)
      const tp3 = tapeFn(base, P),
        a3 = tp3(m.S_AX);
      const ss = [m.S_WR, tp3.inv((tEl + tWr) / 2), m.S_EL, tp3.inv((a3 + tEl) / 2), m.S_AX];
      const rt = [4, 3, 2, 1, 0].map((q, i) => Math.min(1.1, Math.max(0.9, circT[q] / circAt(base, P, ss[i]))));
      const g = pchip(ss, rt);
      corr = corr.map((c, i) => c * (sg[i] <= ss[0] ? rt[0] : sg[i] >= ss[4] ? rt[4] : g(sg[i])));
    }
  }
  const report = measureAll(base, P, inp, { tEl, tWr, HLt, brT, circHand }, hand);
  assertFinite(P, 'Malla ajustada');
  for (const [n, , v] of report.rows)
    if (!Number.isFinite(v)) throw new Error(`No se pudo medir «${n}» en el modelo ajustado.`);
  return { P, report };
}
export function measureAll(base, P, inp, t, hand) {
  const m = base.meta,
    tp = tapeFn(base, P);
  const el = tp(m.S_EL),
    wr = tp(m.S_WR),
    ax = tp(m.S_AX);
  const cAt = T => circAt(base, P, tp.inv(T));
  const rows = [
    ['Hombro → codo', t.tEl, el],
    ['Codo → muñeca', t.tWr - t.tEl, wr - el],
    ['Hombro → muñeca', t.tWr, wr],
    ['Contorno axila', inp.c_axila, circAt(base, P, m.S_AX)],
    ['Contorno mitad bíceps', inp.c_biceps, cAt((ax + el) / 2)],
    ['Contorno codo', inp.c_codo, circAt(base, P, m.S_EL)],
    ['Contorno mitad antebrazo', inp.c_antebrazo, cAt((el + wr) / 2)],
    ['Contorno muñeca', inp.c_muneca, circAt(base, P, m.S_WR)],
    ['Largo mano', t.HLt, hand.after.HL],
    ['Ancho nudillos', t.brT, hand.after.br],
    ['Contorno nudillos', t.circHand, hand.after.circ],
  ];
  // pliegues: triángulos invertidos respecto a la base
  const F = base.F,
    V0 = base.V0;
  let flips = 0;
  const nrm = (A, a, b, c) =>
    cross(
      [A[3 * b] - A[3 * a], A[3 * b + 1] - A[3 * a + 1], A[3 * b + 2] - A[3 * a + 2]],
      [A[3 * c] - A[3 * a], A[3 * c + 1] - A[3 * a + 1], A[3 * c + 2] - A[3 * a + 2]],
    );
  for (let f = 0; f < F.length; f += 3)
    if (dot(nrm(V0, F[f], F[f + 1], F[f + 2]), nrm(P, F[f], F[f + 1], F[f + 2])) < 0) flips++;
  return { rows, flips, tape: tp, hand: { sa: hand.sa, s1: hand.s1, s2: hand.s2, before: hand.before } };
}

// ---------- guías de tatuajes (anillos) sobre la textura ----------
export function ringSegments(base, P, tape, values) {
  // returns [[u1,v1,u2,v2],...] in UV space
  const sv = base.sv,
    n = base.meta.nV,
    tv = new Float32Array(n);
  for (let i = 0; i < n; i++) tv[i] = sv[i] > base.meta.S_WR - 1 ? tape(sv[i]) : -1e3;
  const F = base.F,
    FT = base.FT,
    VT = base.VT,
    out = [];
  for (const T of values)
    for (let f = 0; f < F.length; f += 3) {
      const a = [tv[F[f]], tv[F[f + 1]], tv[F[f + 2]]];
      if (Math.min(...a) > T || Math.max(...a) < T) continue;
      const pts = [];
      for (const [i, j] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        if ((a[i] - T) * (a[j] - T) < 0 || (a[i] === T && a[j] !== T)) {
          const w = (T - a[i]) / (a[j] - a[i]);
          const ti = FT[f + i],
            tj = FT[f + j];
          pts.push([
            VT[2 * ti] + w * (VT[2 * tj] - VT[2 * ti]),
            VT[2 * ti + 1] + w * (VT[2 * tj + 1] - VT[2 * ti + 1]),
          ]);
        }
      }
      if (pts.length >= 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
    }
  return out;
}

// ---------- exportación ----------
export function vertexNormals(base, P) {
  const F = base.F,
    N = new Float32Array(P.length);
  for (let f = 0; f < F.length; f += 3) {
    const [a, b, c] = [F[f], F[f + 1], F[f + 2]];
    const n = cross(
      [P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1], P[3 * b + 2] - P[3 * a + 2]],
      [P[3 * c] - P[3 * a], P[3 * c + 1] - P[3 * a + 1], P[3 * c + 2] - P[3 * a + 2]],
    );
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) N[3 * v + k] += n[k];
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l;
    N[i + 1] /= l;
    N[i + 2] /= l;
  }
  return N;
}
const fx = x => (Math.round(x * 1e4) / 1e4).toString();
export function makeOBJ(base, P, name, mtlName, texName) {
  assertFinite(P, 'OBJ');
  const L = [`# Moldeador — ${name} (cm, Y arriba)`, `mtllib ${mtlName}`, `o ${name}`];
  for (let i = 0; i < P.length; i += 3) L.push(`v ${fx(P[i])} ${fx(P[i + 1])} ${fx(P[i + 2])}`);
  const VT = base.VT;
  for (let i = 0; i < VT.length; i += 2) L.push(`vt ${fx(VT[i])} ${fx(VT[i + 1])}`);
  L.push('usemtl piel', 's 1');
  const F = base.F,
    FT = base.FT;
  for (let f = 0; f < F.length; f += 3)
    L.push(`f ${F[f] + 1}/${FT[f] + 1} ${F[f + 1] + 1}/${FT[f + 1] + 1} ${F[f + 2] + 1}/${FT[f + 2] + 1}`);
  const mtl = `newmtl piel\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nNs 10\nd 1\nillum 1\nmap_Kd ${texName}\n`;
  return { obj: L.join('\n') + '\n', mtl };
}
export function makeUSDA(base, P, rawName) {
  assertFinite(P, 'USDA');
  const name = usdIdent(rawName),
    N = vertexNormals(base, P),
    F = base.F,
    FT = base.FT,
    VT = base.VT;
  const tri = (A, k) => {
    const o = [];
    for (let i = 0; i < A.length; i += k) o.push('(' + Array.from(A.subarray(i, i + k), fx).join(', ') + ')');
    return o.join(', ');
  };
  const mn = [1e9, 1e9, 1e9],
    mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3)
    for (let c = 0; c < 3; c++) {
      mn[c] = Math.min(mn[c], P[i + c]);
      mx[c] = Math.max(mx[c], P[i + c]);
    }
  return `#usda 1.0
(
    defaultPrim = "${name}"
    metersPerUnit = 0.01
    upAxis = "Y"
    doc = "Moldeador web - cm, Y arriba"
)

def Xform "${name}" (
    kind = "component"
)
{
    def Mesh "malla" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        float3[] extent = [(${mn.map(fx).join(', ')}), (${mx.map(fx).join(', ')})]
        int[] faceVertexCounts = [${new Array(F.length / 3).fill(3).join(', ')}]
        int[] faceVertexIndices = [${Array.from(F).join(', ')}]
        rel material:binding = </${name}/Materiales/piel>
        normal3f[] normals = [${tri(N, 3)}] (
            interpolation = "vertex"
        )
        point3f[] points = [${tri(P, 3)}]
        texCoord2f[] primvars:st = [${tri(VT, 2)}] (
            interpolation = "faceVarying"
        )
        int[] primvars:st:indices = [${Array.from(FT).join(', ')}]
        uniform token subdivisionScheme = "none"
        uniform bool doubleSided = 0
    }

    def Scope "Materiales"
    {
        def Material "piel"
        {
            token outputs:surface.connect = </${name}/Materiales/piel/Superficie.outputs:surface>

            def Shader "Superficie"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </${name}/Materiales/piel/Textura.outputs:rgb>
                float inputs:metallic = 0
                float inputs:roughness = 0.6
                token outputs:surface
            }

            def Shader "LectorUV"
            {
                uniform token info:id = "UsdPrimvarReader_float2"
                string inputs:varname = "st"
                float2 outputs:result
            }

            def Shader "Textura"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @textures/piel.png@
                float2 inputs:st.connect = </${name}/Materiales/piel/LectorUV.outputs:result>
                token inputs:sourceColorSpace = "sRGB"
                token inputs:wrapS = "repeat"
                token inputs:wrapT = "repeat"
                float3 outputs:rgb
            }
        }
    }
}
`;
}
// ZIP sin compresión con datos alineados a 64 bytes (requisito USDZ)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function storeZip(files, align = 64) {
  // files: [[name, Uint8Array]]
  const enc = new TextEncoder(),
    parts = [],
    central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name),
      crc = crc32(data);
    const pad = (align - ((off + 30 + nb.length + 4) % align)) % align;
    const extra = new Uint8Array(4 + pad);
    const ev = new DataView(extra.buffer);
    ev.setUint16(0, 0x1986, true);
    ev.setUint16(2, pad, true);
    const h = new Uint8Array(30),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0, true);
    v.setUint16(8, 0, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nb.length, true);
    v.setUint16(28, extra.length, true);
    parts.push(h, nb, extra, data);
    const c = new Uint8Array(46),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, off, true);
    central.push(c, nb);
    off += 30 + nb.length + extra.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0),
    e = new Uint8Array(22),
    evv = new DataView(e.buffer);
  evv.setUint32(0, 0x06054b50, true);
  evv.setUint16(8, files.length, true);
  evv.setUint16(10, files.length, true);
  evv.setUint32(12, cdSize, true);
  evv.setUint32(16, off, true);
  const all = [...parts, ...central, e],
    out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
export function makeUSDZ(base, P, rawName, pngBytes) {
  const name = usdIdent(rawName);
  return storeZip([
    [`${name}.usda`, new TextEncoder().encode(makeUSDA(base, P, name))],
    ['textures/piel.png', pngBytes],
  ]);
}
export const EJEMPLO = {
  hombro_codo: 32,
  codo_muneca: 24,
  hombro_muneca: 56,
  c_axila: 31,
  c_biceps: 33,
  c_codo: 29,
  c_antebrazo: 30,
  c_muneca: 20,
};

// ---------- guías de medición (geometría 3D para la vista previa) ----------
export function stationS(base, P) {
  const m = base.meta,
    tp = tapeFn(base, P),
    el = tp(m.S_EL),
    wr = tp(m.S_WR),
    ax = tp(m.S_AX);
  return {
    tp,
    s: {
      c_axila: m.S_AX,
      c_biceps: tp.inv((ax + el) / 2),
      c_codo: m.S_EL,
      c_antebrazo: tp.inv((el + wr) / 2),
      c_muneca: m.S_WR,
    },
    tapes: { c_axila: ax, c_biceps: (ax + el) / 2, c_codo: el, c_antebrazo: (el + wr) / 2, c_muneca: wr },
  };
}
export function ringLoop(base, P, s0, grow = 0.15) {
  // contorno (envolvente) del corte en s0, algo inflado, en 3D
  const idx = slab(base, s0, SECTION_HALF_W);
  if (idx.length < 10) return null;
  const t = Tat(base, s0),
    e1 = norm(cross(t, [0, 0, 1])),
    e2 = cross(t, e1);
  const c = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) c[k] += P[3 * i + k] / idx.length;
  const Q = [];
  for (const i of idx) {
    const d = [P[3 * i] - c[0], P[3 * i + 1] - c[1], P[3 * i + 2] - c[2]];
    Q.push([dot(d, e1), dot(d, e2)]);
  }
  const H = hull2d(Q);
  return {
    centre: c,
    pts: H.map(([x, y]) => {
      const r = Math.hypot(x, y) || 1,
        f = (r + grow) / r;
      return [0, 1, 2].map(k => c[k] + f * (x * e1[k] + y * e2[k]));
    }),
  };
}
export function outward(base, P, p, s, d = 0.15) {
  // empuja un punto de la superficie hacia fuera del eje
  const idx = slab(base, s, SECTION_HALF_W);
  if (!idx.length) return p;
  const c = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) c[k] += P[3 * i + k] / idx.length;
  const t = Tat(base, s);
  let v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const a = dot(v, t);
  v = [v[0] - a * t[0], v[1] - a * t[1], v[2] - a * t[2]];
  const L = Math.hypot(...v) || 1;
  return [p[0] + (d * v[0]) / L, p[1] + (d * v[1]) / L, p[2] + (d * v[2]) / L];
}
export function handGuides(base, P) {
  // eje de la mano, punta del dedo corazón y anillo de nudillos
  const m = base.meta,
    a = m.hand_a,
    w = ringLoop(base, P, m.S_WR, 0);
  if (!w) return null;
  const wc = w.centre;
  const T = Tat(base, m.S_WR),
    t = [-T[0], -T[1], -T[2]],
    hand = [];
  for (let i = 0; i < m.nV; i++) {
    const d = (P[3 * i] - wc[0]) * t[0] + (P[3 * i + 1] - wc[1]) * t[1] + (P[3 * i + 2] - wc[2]) * t[2];
    if (d > HAND_BLEND[0]) hand.push(i);
  }
  const S = mcpSection(base, P, wc, a, hand);
  let tipI = hand[0],
    best = -1e9;
  for (const i of hand) {
    const d = (P[3 * i] - wc[0]) * a[0] + (P[3 * i + 1] - wc[1]) * a[1] + (P[3 * i + 2] - wc[2]) * a[2];
    if (d > best) {
      best = d;
      tipI = i;
    }
  }
  const tip = [P[3 * tipI], P[3 * tipI + 1], P[3 * tipI + 2]];
  // anillo de nudillos (componente principal, sin pulgar)
  const Q = [];
  for (const i of hand) {
    const p = [P[3 * i] - wc[0], P[3 * i + 1] - wc[1], P[3 * i + 2] - wc[2]];
    if (Math.abs(dot(p, a) - S.d0) < SECTION_HALF_W) Q.push([dot(p, S.u), dot(p, S.v)]);
  }
  const R = largestComponent(Q),
    H = hull2d(R),
    cx = R.reduce((s, q) => s + q[0], 0) / R.length,
    cy = R.reduce((s, q) => s + q[1], 0) / R.length;
  const ring = H.map(([x, y]) => {
    const dx = x - cx,
      dy = y - cy,
      r = Math.hypot(dx, dy) || 1,
      f = (r + 0.15) / r;
    const X = cx + f * dx,
      Y = cy + f * dy;
    return [0, 1, 2].map(k => wc[k] + S.d0 * a[k] + X * S.u[k] + Y * S.v[k]);
  });
  return { wc, tip, ring, HL: S.HL };
}
