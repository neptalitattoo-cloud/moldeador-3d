// Ejecutar con:  node --test tests/foto.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as K from '../js/core.js';
import * as FO from '../js/foto.js';

const r = p => new URL('../' + p, import.meta.url);
const meta = JSON.parse(fs.readFileSync(r('data/brazo_derecho.json')));
const bin = fs.readFileSync(r('data/brazo_derecho.bin'));
const base = K.loadBase(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const fit = K.fit(base, K.EJEMPLO);
const chart = FO.surfaceChart(base, fit.P, fit.report.tape);
const loc = FO.uvLocator(base, chart);

// imagen RGBA w×h rellena con f(x, y) → [r, g, b, a]
const img = (w, h, f) => {
  const d = new Uint8ClampedArray(4 * w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), 4 * (y * w + x));
  return d;
};

test('cuentagotas: promedio de la piel ignorando poros, brillos y transparencia', () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const piel = [200, 150, 120];
  const d = img(40, 40, x => {
    if (x < 5) return [0, 255, 0, 0]; // transparente: no cuenta
    const q = rnd();
    if (q < 0.08) return [30, 20, 15, 255]; // poro / pelo
    if (q < 0.12) return [255, 255, 255, 255]; // brillo
    return [...piel.map(v => v + (rnd() - 0.5) * 8), 255];
  });
  const c = FO.averageColor(d, 40, 40, 20, 20, 10);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(c.rgb[k] - piel[k]) < 3, `${c.hex} ≠ piel`);
  assert.ok(c.usados < c.n, 'debe descartar atípicos');
  assert.match(c.hex, /^#[0-9a-f]{6}$/);
  // un promedio ingenuo se iría lejos por los poros y brillos
  assert.equal(FO.averageColor(d, 40, 40, 2, 20, 1.5), null); // sólo píxeles transparentes
});

test('cuentagotas: color uniforme exacto y hex ↔ rgb', () => {
  const d = img(9, 9, () => [12, 34, 56, 255]);
  assert.equal(FO.averageColor(d, 9, 9, 4, 4, 3).hex, '#0c2238');
  assert.deepEqual(FO.rgbOf('#0C2238'), [12, 34, 56]);
  assert.equal(FO.rgbOf('rojo'), null);
});

test('borde suave: el desenfoque conserva la máscara y suaviza el borde', () => {
  const w = 60,
    h = 60,
    a = new Uint8ClampedArray(w * h);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) a[y * w + x] = 255;
  const b = FO.blurAlpha(a, w, h, 6);
  assert.ok(b[30 * w + 30] > 240, 'centro opaco');
  assert.ok(b[5 * w + 5] === 0, 'lejos transparente');
  const borde = b[30 * w + 20];
  assert.ok(borde > 60 && borde < 200, `borde suave (${borde})`);
  const s0 = a.reduce((s, v) => s + v, 0),
    s1 = b.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(s1 - s0) / s0 < 0.03);
  assert.equal(FO.blurAlpha(a, w, h, 0), a);
});

test('carta: la línea exterior (donde se miden los largos) está en el ángulo 0', () => {
  let n = 0,
    lejos = 0;
  for (const i of base.mer) {
    if (!chart.valid[i]) continue;
    n++;
    if (Math.abs(chart.phi[i]) > 0.35) lejos++;
  }
  assert.ok(n > 200);
  assert.ok(lejos / n < 0.05, `${lejos}/${n} vértices de la línea exterior lejos de 0°`);
  const ph = base.mer.filter(i => chart.valid[i]).map(i => Math.abs(chart.phi[i]));
  ph.sort((x, y) => x - y);
  assert.ok(ph[ph.length >> 1] < 0.05, `mediana ${ph[ph.length >> 1].toFixed(3)} rad`);
});

test('cm → UV: el punto cae a esa distancia del hombro y en ese lado (en todos los lados)', () => {
  for (const [d, ang] of [
    [8, 0],
    [15, 90],
    [24, 180],
    [33, -90],
    [45, 0],
  ]) {
    const uv = FO.cmToUV(base, chart, d, ang);
    assert.ok(uv, `sin UV para ${d} cm / ${ang}°`);
    const at = loc(uv[0], uv[1]);
    assert.ok(at, `${d} cm / ${ang}°: UV fuera del brazo`);
    assert.ok(Math.abs(chart.dOfJ(at.jf) - d) < 0.3, `${d} cm / ${ang}°: sale a ${chart.dOfJ(at.jf).toFixed(2)}`);
    let da = (at.phi * 180) / Math.PI - ang;
    da -= 360 * Math.round(da / 360);
    assert.ok(Math.abs(da) < 3, `${d} cm / ${ang}°: ángulo ${da.toFixed(1)}° desviado`);
  }
});

test('cm → UV contra una referencia que no es la carta: la cinta de las medidas (a 0°) da d ± 0,3 cm', () => {
  for (const d of [8, 20, 33, 45]) {
    const h = FO.decalPointUV(FO.decalTriangles(base, FO.decalCoords(chart, { d, ang: 0, rot: 0 }), 1, 1));
    assert.ok(h, `${d} cm: sin punto`);
    const sv = h.l.reduce((s, w, k) => s + w * base.sv[h.tri.i[k]], 0),
      cinta = fit.report.tape(sv);
    assert.ok(Math.abs(cinta - d) < 0.3, `${d} cm: la cinta da ${cinta.toFixed(2)} cm`);
  }
});

test('colocación: delante es delante, y el tatuaje no sale en espejo visto desde fuera', () => {
  const P = fit.P,
    m = base.meta;
  const mean = sel => {
    const s = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < m.nV; i++)
      if (sel(i)) {
        s[0] += P[3 * i];
        s[1] += P[3 * i + 1];
        s[2] += P[3 * i + 2];
        n++;
      }
    return s.map(v => v / n);
  };
  const ok = i => chart.valid[i] && chart.d[i] > 18 && chart.d[i] < 22;
  const front = m.dir_back.map(v => -v);
  const fr = mean(i => ok(i) && Math.abs(chart.phi[i] - Math.PI / 2) < 0.3),
    bk = mean(i => ok(i) && Math.abs(chart.phi[i] + Math.PI / 2) < 0.3);
  assert.ok(K.dot([fr[0] - bk[0], fr[1] - bk[1], fr[2] - bk[2]], front) > 3, 'delante/detrás invertidos');
  // marco del tatuaje en el exterior a 20 cm: x+ debe ir hacia cross(hacia el hombro, normal exterior)
  const co = FO.decalCoords(chart, { d: 20, ang: 0, rot: 0 });
  const up = (() => {
    const a = mean(i => chart.valid[i] && chart.d[i] < 6),
      b = mean(i => chart.valid[i] && chart.d[i] > 40 && chart.d[i] < 46);
    return K.norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
  })();
  const right = K.cross(up, m.dir_outer);
  const near = i => co.ok[i] && Math.abs(co.y[i]) < 1;
  const R = mean(i => near(i) && co.x[i] > 0.5 && co.x[i] < 2.5),
    L = mean(i => near(i) && co.x[i] < -0.5 && co.x[i] > -2.5);
  assert.ok(K.dot([R[0] - L[0], R[1] - L[1], R[2] - L[2]], right) > 1, 'el tatuaje saldría en espejo');
  // y hacia abajo = hacia la mano
  const D = mean(i => co.ok[i] && Math.abs(co.x[i]) < 1 && co.y[i] > 1 && co.y[i] < 3),
    U = mean(i => co.ok[i] && Math.abs(co.x[i]) < 1 && co.y[i] < -1 && co.y[i] > -3);
  assert.ok(K.dot([U[0] - D[0], U[1] - D[1], U[2] - D[2]], up) > 1);
});

test('triángulos del tatuaje: cubren su rectángulo y la afín lleva cm → UV sin errores', () => {
  const co = FO.decalCoords(chart, { d: 15, ang: 0, rot: 30 });
  const tris = FO.decalTriangles(base, co, 8, 10);
  assert.ok(tris.length > 300);
  for (const [x, y] of [
    [0, 0],
    [3.5, 4.5],
    [-3.5, -4.5],
  ])
    assert.ok(FO.decalPointUV(tris, x, y), `(${x}, ${y}) sin cubrir`);
  for (const t of tris.slice(0, 50)) {
    const A = FO.affine3(t.p, t.q);
    if (!A) continue;
    for (let k = 0; k < 3; k++) {
      const [x, y] = t.p[k];
      assert.ok(Math.abs(A[0] * x + A[2] * y + A[4] - t.q[k][0]) < 1e-6);
      assert.ok(Math.abs(A[1] * x + A[3] * y + A[5] - t.q[k][1]) < 1e-6);
    }
  }
});

// ---------- medidas reales en cm sobre la malla ajustada (lo que el tatuador ve en la piel) ----------
const W = 8,
  H = 10;
const pct = (v, t) => (100 * (v - t)) / t;
// como en app.js: decalCoords recibe el ancho del recorte (las bandas, W > L/3, no llevan la corrección del cono)
const trisDe = (dec, w = W, h = H) => FO.decalTriangles(base, FO.decalCoords(chart, dec, w), w, h);
const medir = dec => {
  const tris = trisDe(dec);
  return {
    tris,
    w: FO.measureOnMesh(tris, fit.P, -W / 2, 0, W / 2, 0),
    h: FO.measureOnMesh(tris, fit.P, 0, -H / 2, 0, H / 2),
  };
};
const resumen = [];

test('cm reales: un recorte de 8 × 10 cm mide 8 × 10 cm en la piel (±2 %) en brazo, antebrazo y muñeca, en 5 lados', () => {
  for (const d of [22, 38, 50, 53])
    for (const ang of [0, 90, 180, -90, 150]) {
      const { w, h } = medir({ d, ang, rot: 0 });
      resumen.push([d, ang, 0, w, h]);
      assert.ok(Math.abs(pct(w, W)) <= 2, `d=${d} ${ang}°: ancho ${w.toFixed(2)} cm (${pct(w, W).toFixed(1)} %)`);
      assert.ok(Math.abs(pct(h, H)) <= 2, `d=${d} ${ang}°: alto ${h.toFixed(2)} cm (${pct(h, H).toFixed(1)} %)`);
    }
});

test('cm reales: la FORMA del 8 × 10 sin girar, no sólo los ejes: bordes y diagonales por zona (brazo, junto al codo, antebrazo bajo, deltoides)', () => {
  const lados = [
    [-4, -5, 4, -5, 8],
    [-4, 5, 4, 5, 8],
    [-4, -5, -4, 5, 10],
    [4, -5, 4, 5, 10],
    [-4, -5, 4, 5, Math.hypot(8, 10)],
    [4, -5, -4, 5, Math.hypot(8, 10)],
  ];
  // tolerancias por zona (medidas, no deseadas): el brazo y el antebrazo bajo son casi desarrollables; cerca del codo
  // (d = 38 cruza de 33 a 43 cm, codo a 32) y en el deltoides la superficie se tuerce y las diagonales se separan
  const peor = {};
  for (const [zona, d, angs, tB, tD] of [
    ['brazo', 22, [0, 90, 180, -90], 3, 5],
    ['antebrazo bajo', 50, [0, 90, 180, -90], 3, 5],
    ['junto al codo', 38, [0, 90, 180, -90], 4, 7.5],
    ['deltoides', 10, [0, 45, -45], 4, 6],
  ])
    for (const ang of angs) {
      const tris = trisDe({ d, ang, rot: 0 });
      for (const [a, b, c, e, t] of lados) {
        const v = FO.measureOnMesh(tris, fit.P, a, b, c, e, 600),
          diag = t > 12,
          err = Math.abs(pct(v, t)),
          k = `${zona} ${diag ? 'diagonal' : 'borde'}`;
        peor[k] = Math.max(peor[k] || 0, err);
        assert.ok(err <= (diag ? tD : tB), `d=${d} ${ang}°: (${a},${b})→(${c},${e}) mide ${v.toFixed(2)} de ${t}`);
      }
    }
  console.log(
    `# forma 8×10 (peor %): ${Object.entries(peor)
      .map(([k, v]) => `${k} ${v.toFixed(1)}`)
      .join(' · ')}`,
  );
});

test('aviso de deformación (H32): sale en el deltoides a ±90° (d = 10) y no en el brazo a 0° (d = 22)', () => {
  const s = (d, ang) => FO.decalStretch(trisDe({ d, ang, rot: 0 }), fit.P, W, H);
  for (const ang of [90, -90]) assert.ok(s(10, ang) > 0.05, `d=10 ${ang}°: ${(100 * s(10, ang)).toFixed(1)} %`);
  assert.ok(s(22, 0) < 0.05, `d=22 0°: ${(100 * s(22, 0)).toFixed(1)} %`);
  // la medida es la de los bordes y las diagonales del dibujo, la misma que la prueba de forma
  const t = trisDe({ d: 22, ang: 0, rot: 0 }),
    diag = FO.measureOnMesh(t, fit.P, -W / 2, -H / 2, W / 2, H / 2, 600) / Math.hypot(W, H) - 1;
  assert.ok(s(22, 0) + 1e-3 >= Math.abs(diag), 'incluye la diagonal');
});
test.todo(
  'forma sin cizalla (para el 10): diagonales ≤ 3 % en brazo y antebrazo y ≤ 5 % junto al codo y en el deltoides',
);

test('cm reales: girado 30° y 90°, ancho y alto a ±6 %', () => {
  for (const d of [22, 38, 50])
    for (const ang of [0, 90, 180])
      for (const rot of [30, 90]) {
        const { w, h } = medir({ d, ang, rot });
        resumen.push([d, ang, rot, w, h]);
        assert.ok(Math.abs(pct(w, W)) <= 6, `d=${d} ${ang}° giro ${rot}: ancho ${w.toFixed(2)} cm`);
        assert.ok(Math.abs(pct(h, H)) <= 6, `d=${d} ${ang}° giro ${rot}: alto ${h.toFixed(2)} cm`);
      }
  const err = resumen.map(([, , rot, w, h]) => [rot, Math.abs(pct(w, W)), Math.abs(pct(h, H))]);
  const peor = r => Math.max(...err.filter(e => (r ? e[0] : !e[0])).flatMap(e => [e[1], e[2]])).toFixed(2);
  console.log(`# cm reales 8×10: peor error sin girar ${peor(false)} %, girado ${peor(true)} %`);
});

test('cm reales: cruzando la costura de la UV mide lo mismo y no deja huecos', () => {
  // busca el lado donde la fila central del recorte pasa por triángulos de dos islas (costura)
  let costura = null;
  for (let ang = -180; ang < 180 && costura == null; ang += 10) {
    const tris = trisDe({ d: 38, ang, rot: 0 });
    const xs = [];
    for (let x = -3.5; x <= 3.5; x += 0.25) {
      const h = FO.decalPointUV(tris, x, 0);
      if (h) xs.push(h.uv[0]);
    }
    for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - xs[k - 1]) > 0.1) costura = ang;
  }
  assert.ok(costura != null, 'no se encontró la costura');
  for (const d of [22, 38, 50]) {
    const { w, h } = medir({ d, ang: costura, rot: 0 });
    assert.ok(Math.abs(pct(w, W)) <= 2, `costura ${costura}° d=${d}: ancho ${w.toFixed(2)} cm`);
    assert.ok(Math.abs(pct(h, H)) <= 2, `costura ${costura}° d=${d}: alto ${h.toFixed(2)} cm`);
  }
});

test('cm reales: un brazalete tan ancho como el contorno da la vuelta completa (360°) sin huecos', () => {
  const d = 38,
    L = chart.Lat(chart.jOfD(d));
  const tris = trisDe({ d, ang: 0, rot: 0 }, L, 4);
  let hueco = 0;
  for (let k = 0; k <= 200; k++) if (!FO.decalPointUV(tris, -L / 2 + (L * k) / 200, 0)) hueco++;
  assert.equal(hueco, 0, `${hueco}/201 puntos sin cubrir`);
  const vuelta = FO.measureOnMesh(tris, fit.P, -L / 2 + 0.05, 0, L / 2 - 0.05, 0, 800);
  assert.ok(Math.abs(vuelta - (L - 0.1)) < 0.03 * L, `vuelta ${vuelta.toFixed(2)} de ${L.toFixed(2)} cm`);
});

// imagen sintética de un recorte: piel con ruido y poros, tinta oscura (con un círculo claro dentro) en
// filas [iy0, iy1] × columnas [ix0, ix1], y la máscara del lazo con margen de piel alrededor
const recorteSintetico = (w, h, [ix0, iy0, ix1, iy1], [mx0, my0, mx1, my1], seed0 = 7) => {
  let seed = seed0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rgba = img(w, h, (x, y) => {
    if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1) {
      const cx = (ix0 + ix1) / 2,
        cy = (iy0 + iy1) / 2;
      return (x - cx) ** 2 + (y - cy) ** 2 < 15 ** 2 ? [170, 170, 170, 255] : [25, 25, 25, 255];
    }
    if (rnd() < 0.03) return [60, 40, 30, 255]; // poro / pelo
    return [200 + (rnd() - 0.5) * 12, 152 + (rnd() - 0.5) * 12, 122 + (rnd() - 0.5) * 12, 255];
  });
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = my0; y <= my1; y++) for (let x = mx0; x <= mx1; x++) alpha[y * w + x] = 255;
  return { rgba, alpha };
};

test('alto de la tinta (H9): inkRows separa la tinta del hueco de piel que deja el lazo', () => {
  const w = 120,
    h = 160,
    { rgba, alpha } = recorteSintetico(w, h, [25, 30, 94, 129], [10, 10, 109, 149]);
  for (const skin of [null, [200, 152, 122]]) {
    const r = FO.inkRows(rgba, alpha, w, h, skin);
    assert.ok(r, 'no detecta la tinta');
    assert.deepEqual([r.top, r.bottom, r.left, r.right], [30, 129, 25, 94], JSON.stringify(r));
    // el alto escrito (10 cm) se aplica a las 100 filas de tinta, no a las 140 del lazo
    const s = FO.cutScale(r.bottom - r.top + 1, 10);
    assert.ok(Math.abs(100 * s - 10) < 1e-9);
    assert.ok(Math.abs(140 * s - 14) < 1e-9);
  }
  // el tono de la piel por defecto es la mediana del borde interior del lazo
  const r = FO.inkRows(rgba, alpha, w, h, null);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(r.skin[c] - [200, 152, 122][c]) <= 3, `tono ${r.skin}`);
  // lazo justo por el borde de la tinta, con el tono de la piel dado: toda la máscara es tinta
  const pegado = recorteSintetico(w, h, [25, 30, 94, 129], [25, 30, 94, 129]);
  const r2 = FO.inkRows(pegado.rgba, pegado.alpha, w, h, [200, 152, 122]);
  assert.deepEqual([r2.top, r2.bottom], [30, 129]);
  // sólo piel (con poros): no hay tinta
  const piel = recorteSintetico(w, h, [-9, -9, -9, -9], [10, 10, 109, 149]);
  assert.equal(FO.inkRows(piel.rgba, piel.alpha, w, h, null), null);
  // calibración «Medir»: una línea de 400 px = 5 cm ⇒ 800 px de la foto miden 10 cm
  assert.ok(Math.abs(FO.altoFromCalib(800, 5 / 400) - 10) < 1e-9);
  assert.ok(Number.isNaN(FO.altoFromCalib(800, 0)));
  assert.ok(Number.isNaN(FO.cutScale(0, 10)));
});

// ---------- H30: caja de la tinta con dibujos realistas (no un bloque macizo) y lazo HOLGADO ----------
// piel(x) → [r, g, b] (con ruido y poros), tinta(x, y) → ¿tinta?, pelo(x, y) → ¿pelo oscuro?
const escena = (w, h, tinta, { piel = () => [200, 152, 122], pelo = () => false } = {}) => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return img(w, h, (x, y) => {
    if (tinta(x, y)) return [25, 25, 25, 255];
    if (pelo(x, y)) return [55, 38, 28, 255];
    if (rnd() < 0.03) return [60, 40, 30, 255]; // poro
    const p = piel(x);
    return [p[0] + (rnd() - 0.5) * 12, p[1] + (rnd() - 0.5) * 12, p[2] + (rnd() - 0.5) * 12, 255];
  });
};
// máscara rectangular del lazo [x0, y0, x1, y1] y anillo de 6 px por fuera (como en el editor)
const lazoRect = (w, h, [x0, y0, x1, y1], R = 6) => {
  const alpha = new Uint8ClampedArray(w * h),
    ring = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) alpha[y * w + x] = 255;
      else if (x >= x0 - R && x <= x1 + R && y >= y0 - R && y <= y1 + R) ring[y * w + x] = 255;
    }
  return { alpha, ring };
};
// filas de tinta reales de la escena
const filasReales = (w, h, tinta) => {
  let a = h,
    b = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (tinta(x, y)) {
        a = Math.min(a, y);
        b = Math.max(b, y);
      }
  return [a, b];
};
const caja = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const detectar = (w, h, tinta, lazo, op = {}) => {
  const rgba = escena(w, h, tinta, op),
    { alpha, ring } = lazoRect(w, h, lazo),
    skin = FO.medianColor(rgba, ring, w, h);
  return { r: FO.inkRows(rgba, alpha, w, h, skin, op.global ? null : ring), real: filasReales(w, h, tinta) };
};
const errAlto = ({ r, real }) => (r ? (r.bottom - r.top + 1) / (real[1] - real[0] + 1) - 1 : Infinity);

test('caja de la tinta (H30): flor con tallo fino y letras con astas, con el lazo holgado: alto a ±3 %', () => {
  const w = 200,
    h = 280;
  // flor (disco de 32 px) con un tallo de 4 px que baja 130 px
  const flor = (x, y) => (x - 100) ** 2 + (y - 70) ** 2 < 32 ** 2 || caja(x, y, 98, 100, 101, 230);
  // «l b d»: astas de 4 px desde y = 80 y panzas de la altura de la x (140–200)
  const letras = (x, y) =>
    caja(x, y, 30, 80, 33, 200) ||
    caja(x, y, 60, 80, 63, 200) ||
    caja(x, y, 60, 140, 95, 143) ||
    caja(x, y, 60, 197, 95, 200) ||
    caja(x, y, 92, 140, 95, 200) ||
    caja(x, y, 140, 80, 143, 200) ||
    caja(x, y, 110, 140, 143, 143) ||
    caja(x, y, 110, 197, 143, 200) ||
    caja(x, y, 110, 140, 113, 200);
  for (const [nombre, tinta, lazo] of [
    ['flor con tallo', flor, [30, 15, 170, 262]],
    ['letras con astas', letras, [10, 40, 190, 240]],
  ]) {
    const res = detectar(w, h, tinta, lazo),
      e = errAlto(res);
    console.log(`# tinta ${nombre}: alto ${(100 * e).toFixed(1)} %`);
    assert.ok(Math.abs(e) <= 0.03, `${nombre}: alto ${(100 * e).toFixed(1)} % (${JSON.stringify(res.r)})`);
    assert.equal(res.r.dudoso, false, nombre);
  }
});

test('caja de la tinta (H30): sombra lateral del brazo (degradado izquierda → derecha): tono por columna, alto a ±3 %', () => {
  const w = 200,
    h = 280,
    tinta = (x, y) => caja(x, y, 40, 90, 160, 190),
    // la piel se oscurece hacia la izquierda (del 100 % al 55 %)
    piel = x => [200, 152, 122].map(v => v * (0.55 + (0.45 * x) / (w - 1))),
    lazo = [20, 50, 180, 230];
  const res = detectar(w, h, tinta, lazo, { piel }),
    e = errAlto(res);
  assert.ok(Math.abs(e) <= 0.03, `alto ${(100 * e).toFixed(1)} % (${JSON.stringify(res.r)})`);
  assert.equal(res.r.dudoso, false);
  // control: con un solo tono para todo el lazo la sombra cuenta como tinta (la prueba puede fallar)
  const glob = errAlto(detectar(w, h, tinta, lazo, { piel, global: true }));
  console.log(`# tinta con sombra: por columna ${(100 * e).toFixed(1)} %, tono único ${(100 * glob).toFixed(1)} %`);
  assert.ok(glob > 0.1, `con un solo tono debería fallar (${(100 * glob).toFixed(1)} %)`);
});

test('caja de la tinta (H30): un pelo en el hueco del lazo: alto a ±3 % o la caja se marca como dudosa', () => {
  const w = 200,
    h = 280,
    tinta = (x, y) => caja(x, y, 50, 100, 150, 200),
    pelo = (x, y) => (y === 60 || y === 61) && x >= 20 && x <= 180,
    res = detectar(w, h, tinta, [30, 40, 170, 250], { pelo }),
    e = errAlto(res);
  console.log(`# tinta con un pelo: ${(100 * e).toFixed(1)} %, dudosa: ${res.r && res.r.dudoso}`);
  assert.ok(res.r, 'no detecta la tinta');
  assert.ok(Math.abs(e) <= 0.03 || res.r.dudoso, `alto ${(100 * e).toFixed(1)} % sin marcarla como dudosa`);
  // sin el pelo, la misma tinta no es dudosa
  assert.equal(detectar(w, h, tinta, [30, 40, 170, 250]).r.dudoso, false);
});

test('tono de la piel por columna (H30): mediana del anillo en x ± 8 px; sin muestras, −1', () => {
  const w = 40,
    h = 10,
    rgba = img(w, h, x => [x < 20 ? 100 : 200, 50, 50, 255]),
    ring = new Uint8ClampedArray(w * h);
  for (let x = 0; x < 30; x++) ring[x] = ring[w + x] = 255; // dos filas de anillo en las columnas 0–29
  const t = FO.colTones(rgba, ring, w, h);
  assert.deepEqual([t[3 * 2], t[3 * 2 + 1]], [100, 50]);
  assert.equal(t[3 * 27], 200);
  assert.equal(t[3 * 39], -1); // columnas 31–39 sin anillo en x ± 8
});

// ---------- H29: enderezar la foto ----------
test('enderezar (H29): el eje marcado queda vertical con el hombro arriba, y la foto girada cabe entera', () => {
  assert.equal(FO.straightenAngle([10, 10], [10, 90]), 0); // ya vertical
  assert.ok(Math.abs(Math.abs(FO.straightenAngle([10, 90], [10, 10])) - Math.PI) < 1e-12); // al revés: media vuelta
  for (const [w, h, phi] of [
    [600, 800, 10],
    [800, 600, -25],
    [1000, 1500, 170],
    [4000, 3000, 37],
    [640, 480, 90], // brazo en horizontal (hombro a la izquierda)
  ]) {
    const f = (phi * Math.PI) / 180,
      u = [Math.sin(f), Math.cos(f)], // del hombro hacia la mano
      c = [w / 2 + 13, h / 2 - 7],
      p = [c[0] - 200 * u[0], c[1] - 200 * u[1]],
      q = [c[0] + 200 * u[0], c[1] + 200 * u[1]],
      a = FO.straightenAngle(p, q),
      R = FO.rotateGeom(w, h, a, 2048),
      [P, Q] = [R.map(...p), R.map(...q)];
    assert.ok(Math.abs(P[0] - Q[0]) < 1e-6, `${phi}°: el eje no queda vertical`);
    assert.ok(Q[1] > P[1], `${phi}°: la mano quedó arriba`);
    assert.ok(Math.abs(Q[1] - P[1] - 400 * R.k) < 1e-6, `${phi}°: el eje cambió de largo`);
    assert.ok(Math.max(R.W, R.H) <= 2048);
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ]) {
      const [X, Y] = R.map(x, y);
      assert.ok(X > -1 && X < R.W + 1 && Y > -1 && Y < R.H + 1, `${phi}°: la esquina (${x}, ${y}) queda fuera`);
    }
  }
  // «Girar 90°» (horario): la esquina de arriba a la izquierda pasa a la de arriba a la derecha
  const G = FO.rotateGeom(600, 800, Math.PI / 2);
  assert.deepEqual([G.W, G.H], [800, 600]);
  const [x0, y0] = G.map(0, 0);
  assert.ok(Math.abs(x0 - 800) < 1e-9 && Math.abs(y0) < 1e-9);
});

// punto 3D (malla ajustada) bajo una UV, con las baricéntricas del triángulo UV: no usa la carta
const punto3DdeUV = (tris, x, y) => {
  const h = FO.decalPointUV(tris, x, y);
  return { uv: h.uv, pos: [0, 1, 2].map(c => h.l.reduce((s, w, k) => s + w * fit.P[3 * h.tri.i[k] + c], 0)) };
};
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// arrastre: el dedo va a la UV de otro punto del recorte (destino); tras placeAt, el punto agarrado debe quedar en la
// posición 3D de ese destino (medida en la malla con baricéntricas, no con la carta)
const arrastre = (dec, [gx, gy], [tx, ty], w = W, h = H) => {
  const tris = trisDe(dec, w, h),
    dest = punto3DdeUV(tris, tx, ty),
    at = loc(dest.uv[0], dest.uv[1]);
  const nd = FO.placeAt(chart, dec, gx, gy, at, w),
    p2 = punto3DdeUV(trisDe({ ...dec, ...nd }, w, h), gx, gy).pos;
  return { err: dist3(p2, dest.pos), mov: dist3(p2, punto3DdeUV(tris, gx, gy).pos) };
};

test('mover con el dedo: lo agarrado queda bajo el dedo (±1 mm, medido en 3D sobre la malla)', () => {
  for (const rot of [0, 90, 180]) {
    const { err, mov } = arrastre({ d: 30, ang: 20, rot }, [1.5, -2], [-2.5, 3]);
    assert.ok(err < 0.1, `giro ${rot}: queda a ${(10 * err).toFixed(2)} mm del dedo`);
    assert.ok(mov > 4, `giro ${rot}: sólo se movió ${mov.toFixed(2)} cm`);
  }
});

test('el alcance del recorte: llega al dorso de la mano y no pasa de ahí', () => {
  assert.ok(chart.dMax > K.EJEMPLO.hombro_muneca + 2, `dMax ${chart.dMax}`);
  assert.ok(chart.dMax < K.EJEMPLO.hombro_muneca + 8, `dMax ${chart.dMax}`);
  assert.ok(chart.dMin < 5, `dMin ${chart.dMin}`); // el hombro (encima de la axila) no tiene contorno cerrado
});

test('pellizco (H36): en la vista 2D el dibujo gira lo mismo que los dedos (±1°) en d = 22, 30, 38 y 50', () => {
  // ángulo en pantalla (x = u, y = 1 − v, hacia abajo) del eje x del recorte
  const angImg = tris => {
    const h = FO.decalPointUV(tris, 0, 0),
      A = FO.affine3(
        h.tri.p,
        h.tri.q.map(([u, v]) => [u, 1 - v]),
      );
    return (Math.atan2(A[1], A[0]) * 180) / Math.PI;
  };
  let peor = 0,
    piel = 0;
  for (const d of [22, 30, 38, 50])
    for (const ang of [0, 90, 180, -90])
      for (const rot of [0, 90, 180])
        for (const dedos of [15, -15]) {
          const dec = { d, ang, rot },
            t0 = trisDe(dec),
            rot2 = FO.pinchRot(t0, rot, dedos),
            t1 = trisDe({ ...dec, rot: rot2 });
          let dd = angImg(t1) - angImg(t0),
            dp = rot2 - rot;
          dd -= 360 * Math.round(dd / 360);
          dp -= 360 * Math.round(dp / 360);
          peor = Math.max(peor, Math.abs(dd - dedos));
          piel = Math.max(piel, Math.abs(Math.abs(dp) - 15));
          assert.ok(Math.abs(dd - dedos) < 1, `d=${d} ${ang}° giro ${rot}: ${dd.toFixed(1)}° (dedos ${dedos}°)`);
        }
  console.log(
    `# pellizco: peor error en pantalla ${peor.toFixed(2)}°; sobre la piel se aparta hasta ${piel.toFixed(1)}°`,
  );
});

// ---------- H25: corrección del estrechamiento (cono) en la costura y al agarrar ----------
test('cono: dev/undev son ida y vuelta, y sin estrechamiento no cambian nada', () => {
  for (const rho0 of [-30, 18, 0]) {
    const { dev, undev } = FO.coneMaps(rho0);
    for (let X = -6; X <= 6; X += 1.5)
      for (let Y = -5; Y <= 5; Y += 2.5) {
        const [x, y] = dev(X, Y),
          [X2, Y2] = undev(x, y);
        assert.ok(Math.abs(X2 - X) < 1e-9 && Math.abs(Y2 - Y) < 1e-9, `rho0 ${rho0}: (${X}, ${Y}) → (${X2}, ${Y2})`);
        if (!rho0) assert.deepEqual([x, y], [X, Y]);
      }
  }
});

test('banda tan ancha como el contorno en el antebrazo bajo (d = 50): sin huecos, vuelta ±3 % y borde recto como un anillo', () => {
  const d = 50,
    L = chart.Lat(chart.jOfD(d)),
    Hb = 4,
    tris = trisDe({ d, ang: 0, rot: 0 }, L, Hb);
  let hueco = 0;
  for (let k = 0; k <= 200; k++) if (!FO.decalPointUV(tris, -L / 2 + (L * k) / 200, 0)) hueco++;
  assert.equal(hueco, 0, `${hueco}/201 puntos sin cubrir`);
  const vuelta = FO.measureOnMesh(tris, fit.P, -L / 2 + 0.05, 0, L / 2 - 0.05, 0, 800);
  assert.ok(Math.abs(vuelta - (L - 0.1)) < 0.03 * L, `vuelta ${vuelta.toFixed(2)} de ${L.toFixed(2)} cm`);
  // referencia 3D (no de la carta): el plano del anillo central de la banda (puntos de la malla, normal por PCA).
  // Los dos bordes rectos deben quedar paralelos a ese plano: un anillo, no una banda torcida
  const R0 = Array.from({ length: 48 }, (_, k) => punto3DdeUV(tris, -L / 2 + 0.2 + ((L - 0.4) * k) / 47, 0).pos);
  const C0 = [0, 1, 2].map(c => R0.reduce((s, p) => s + p[c], 0) / R0.length);
  const M = [0, 1, 2].map(a => [0, 1, 2].map(b => R0.reduce((s, p) => s + (p[a] - C0[a]) * (p[b] - C0[b]), 0)));
  const mul = v => [0, 1, 2].map(a => M[a][0] * v[0] + M[a][1] * v[1] + M[a][2] * v[2]);
  let e1 = [1, 0.3, 0.2];
  for (let it = 0; it < 100; it++) e1 = K.norm(mul(e1));
  const fuera = v => K.norm(v.map((x, k) => x - K.dot(v, e1) * e1[k]));
  let e2 = fuera([0.2, 1, 0.3]);
  for (let it = 0; it < 100; it++) e2 = fuera(mul(e2));
  const T = K.norm(K.cross(e1, e2));
  const plano = R0.map(p => K.dot([p[0] - C0[0], p[1] - C0[1], p[2] - C0[2]], T));
  assert.ok(Math.max(...plano) - Math.min(...plano) < 0.3, 'el anillo central no es plano');
  // los dos bordes rectos, a la misma altura delante, detrás y en el lado opuesto (±3 mm)
  for (const ye of [-Hb / 2 + 0.15, Hb / 2 - 0.15]) {
    const alt = [-3, -2, -1, 0, 1, 2, 3].map(k => {
      const p = punto3DdeUV(tris, (k * L) / 8, ye).pos;
      return K.dot([p[0] - C0[0], p[1] - C0[1], p[2] - C0[2]], T);
    });
    const media = alt.reduce((s, v) => s + v, 0) / alt.length;
    for (const a of alt)
      assert.ok(Math.abs(a - media) < 0.3, `borde y=${ye}: alturas ${alt.map(v => v.toFixed(2)).join(' ')} cm`);
  }
});

test('agarrar lejos del centro donde el brazo se estrecha (d = 50, punto (3,5, 4,5)): error 3D < 1 mm', () => {
  for (const ang of [0, 90, -90]) {
    const dec = { d: 50, ang, rot: 0 },
      quieto = arrastre(dec, [3.5, 4.5], [3.5, 4.5]),
      movido = arrastre(dec, [3.5, 4.5], [-2.5, -2.5]);
    assert.ok(quieto.err < 0.1, `${ang}°: sin mover el dedo salta ${(10 * quieto.err).toFixed(2)} mm`);
    assert.ok(movido.err < 0.1, `${ang}°: queda a ${(10 * movido.err).toFixed(2)} mm del dedo`);
  }
});

// ---------- H24: la carta con cuerpos extremos ----------
test('carta con cuerpos extremos: no falla, todo finito y llega a la muñeca', () => {
  const cuerpos = [
    { hombro_codo: 24, codo_muneca: 18, hombro_muneca: 42 }, // brazo corto
    { hombro_codo: 40, codo_muneca: 30, hombro_muneca: 70 }, // brazo largo
    { c_muneca: 9, c_antebrazo: 22 },
    { c_muneca: 40, c_antebrazo: 40 },
    { c_axila: 24, c_biceps: 24, c_codo: 21, c_antebrazo: 21, c_muneca: 14 }, // delgado
    { c_axila: 46, c_biceps: 48, c_codo: 38, c_antebrazo: 36, c_muneca: 24 }, // grueso
  ];
  let probados = 0;
  for (const x of cuerpos) {
    const inp = { ...K.EJEMPLO, ...x };
    let o;
    try {
      o = K.fit(base, inp);
    } catch (e) {
      assert.ok(e instanceof Error && !/undefined|null|NaN/.test(e.message), `${JSON.stringify(x)}: ${e.message}`);
      continue;
    }
    probados++;
    const c = FO.surfaceChart(base, o.P, o.report.tape);
    for (const k of ['d', 'vA', 'vY', 'vL', 'jf', 'phi'])
      for (let i = 0; i < c.valid.length; i++)
        if (c.valid[i]) assert.ok(Number.isFinite(c[k][i]), `${JSON.stringify(x)}: ${k}[${i}] no es finito`);
    assert.ok(Number.isFinite(c.dMin) && Number.isFinite(c.dMax), JSON.stringify(x));
    // llega a la muñeca (±0,5 cm); pasada la muñeca sólo mientras el contorno sea de una capa (antes del pulgar), y en
    // manos cortas o muñecas gruesas eso es poco: el ejemplo pide > 2 cm en el test de alcance
    assert.ok(c.dMax > inp.hombro_muneca - 0.5, `${JSON.stringify(x)}: dMax ${c.dMax.toFixed(2)} cm`);
    const dm = (c.dMin + c.dMax) / 2,
      t = FO.decalTriangles(base, FO.decalCoords(c, { d: dm, ang: 0, rot: 0 }, 6), 6, 6);
    assert.ok(t.length > 50 && t.every(q => q.p.flat().every(Number.isFinite)), JSON.stringify(x));
  }
  assert.ok(probados >= 4, `sólo se moldearon ${probados} cuerpos`);
});

// ---------- H22: desenrollar la foto de un brazo curvo ----------
test('desenrollar: arcOfCol y colOfArc son ida y vuelta y se quedan en el brazo en los bordes', () => {
  const xc = 300.5,
    R = 120;
  for (let x = xc - R + 1; x <= xc + R - 1; x += 7.3)
    assert.ok(Math.abs(FO.colOfArc(FO.arcOfCol(x, xc, R), xc, R) - x) < 1e-6, `x ${x}`);
  assert.equal(FO.arcOfCol(xc, xc, R), 0);
  assert.ok(Math.abs(FO.arcOfCol(xc + R, xc, R) - (R * Math.PI) / 2) < 1e-9);
  assert.equal(FO.arcOfCol(xc + 2 * R, xc, R), FO.arcOfCol(xc + R, xc, R)); // fuera del brazo: el borde
  assert.ok(FO.colOfArc(10 * R, xc, R) <= xc + R && FO.colOfArc(-10 * R, xc, R) >= xc - R);
  // cerca del centro casi no cambia; hacia los bordes la foto comprime: el arco es mayor que la cuerda
  assert.ok(Math.abs(FO.arcOfCol(xc + 10, xc, R) - 10) < 0.02);
  assert.ok(FO.arcOfCol(xc + 100, xc, R) > 115);
  const u = FO.unrollCols(xc - 100, xc + 100, xc, R, 1);
  assert.equal(u.w, Math.round(2 * R * Math.asin(100 / R)));
  assert.ok(Math.abs(u.xOf(xc - 100)) < 1e-9 && Math.abs(u.xOf(xc + 100) - (u.s1 - u.s0)) < 1e-9);
});

test('desenrollar: una cuadrícula vista en un cilindro (foto ortográfica) vuelve a medir 8 cm de arco ±3 %', () => {
  const ppcm = 25, // px de la foto por cm
    R = (25 / (2 * Math.PI)) * ppcm, // antebrazo de 25 cm de contorno
    xc = 200.3,
    w = 400;
  // columna x de la foto: líneas negras (3 px de arco) cada cm de arco sobre la piel; 16 submuestras por píxel
  const col = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let v = 0;
    for (let q = 0; q < 16; q++) {
      const u = (x + (q + 0.5) / 16 - xc) / R;
      if (Math.abs(u) >= 1) v += 1;
      else {
        const s = (R * Math.asin(u)) / ppcm;
        v += Math.abs(s - Math.round(s)) * ppcm < 1.5 ? 0 : 1;
      }
    }
    col[x] = v / 16;
  }
  // valor de la foto en la x continua c (centro del píxel i en i + 0,5), interpolado
  const sample = c => {
    const p = Math.min(w - 1, Math.max(0, c - 0.5)),
      i = Math.min(w - 2, Math.floor(p));
    return col[i] * (1 - (p - i)) + col[i + 1] * (p - i);
  };
  // centros de las líneas oscuras de un perfil
  const lineas = prof => {
    const out = [];
    let acc = 0,
      sx = 0;
    prof.forEach((v, X) => {
      const dk = 1 - v;
      if (dk > 0.3) {
        acc += dk;
        sx += dk * (X + 0.5);
      } else if (acc) {
        out.push(sx / acc);
        acc = sx = 0;
      }
    });
    return out;
  };
  const x0 = Math.floor(xc - 90),
    x1 = Math.ceil(xc + 90);
  // sin desenrollar: la foto comprime (cuerda), ≈ −16 %
  const foto = lineas(Array.from({ length: x1 - x0 }, (_, X) => col[x0 + X]));
  assert.equal(foto.length, 9);
  const anchoFoto = (foto[8] - foto[0]) / ppcm;
  assert.ok(anchoFoto < 7.2, `sin desenrollar ${anchoFoto.toFixed(2)} cm`);
  // desenrollado: 8 cm de arco miden 8 ± 3 %
  const u = FO.unrollCols(x0, x1, xc, R, 1),
    des = lineas(Array.from(u.sx, sample));
  assert.equal(des.length, 9);
  const ancho = (des[8] - des[0]) / ppcm;
  assert.ok(Math.abs(pct(ancho, 8)) <= 3, `desenrollado ${ancho.toFixed(2)} cm`);
  // y colocado sobre la malla (recorte de u.w px de ancho, 25 px/cm): de línea a línea, 8 cm ± 3 % en la piel
  const Wd = u.w / ppcm,
    tris = trisDe({ d: 38, ang: 0, rot: 0 }, Wd, 4),
    xa = des[0] / ppcm - Wd / 2,
    xb = des[8] / ppcm - Wd / 2,
    enPiel = FO.measureOnMesh(tris, fit.P, xa, 0, xb, 0, 600);
  assert.ok(Math.abs(pct(enPiel, 8)) <= 3, `en la piel ${enPiel.toFixed(2)} cm`);
  console.log(`# desenrollar: foto ${anchoFoto.toFixed(2)} cm → ${ancho.toFixed(2)} cm, piel ${enPiel.toFixed(2)} cm`);
});

// ---------- H26: tiempo (laxo) de lo que se recalcula en cada fotograma del arrastre ----------
test('tiempo: decalTriangles < 60 ms (mediana de 7, tras calentar)', () => {
  const dec = { d: 30, ang: 20, rot: 15 },
    co = FO.decalCoords(chart, dec, W);
  for (let k = 0; k < 3; k++) FO.decalTriangles(base, co, W, H);
  const ms = [];
  for (let k = 0; k < 7; k++) {
    const t0 = performance.now();
    FO.decalTriangles(base, co, W, H);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const t0 = performance.now();
  FO.decalCoords(chart, dec, W);
  const tc = performance.now() - t0;
  console.log(`# tiempo: decalTriangles ${ms[3].toFixed(1)} ms, decalCoords ${tc.toFixed(1)} ms`);
  assert.ok(ms[3] < 60, `decalTriangles ${ms[3].toFixed(1)} ms`);
});
