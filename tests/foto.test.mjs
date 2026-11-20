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

test('cm → UV: el punto cae a esa distancia del hombro (cinta por la línea exterior) y en ese lado', () => {
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
    assert.ok(Math.abs(chart.dOfJ(at.jf) - d) < 0.3 || ang !== 0, `${d} cm: sale a ${chart.dOfJ(at.jf).toFixed(2)}`);
    let da = (at.phi * 180) / Math.PI - ang;
    da -= 360 * Math.round(da / 360);
    assert.ok(Math.abs(da) < 3, `${d} cm / ${ang}°: ángulo ${da.toFixed(1)}° desviado`);
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
const medir = dec => {
  const tris = FO.decalTriangles(base, FO.decalCoords(chart, dec), W, H);
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
    const tris = FO.decalTriangles(base, FO.decalCoords(chart, { d: 38, ang, rot: 0 }), W, H);
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
  const tris = FO.decalTriangles(base, FO.decalCoords(chart, { d, ang: 0, rot: 0 }), L, 4);
  let hueco = 0;
  for (let k = 0; k <= 200; k++) if (!FO.decalPointUV(tris, -L / 2 + (L * k) / 200, 0)) hueco++;
  assert.equal(hueco, 0, `${hueco}/201 puntos sin cubrir`);
  const vuelta = FO.measureOnMesh(tris, fit.P, -L / 2 + 0.05, 0, L / 2 - 0.05, 0, 800);
  assert.ok(Math.abs(vuelta - (L - 0.1)) < 0.03 * L, `vuelta ${vuelta.toFixed(2)} de ${L.toFixed(2)} cm`);
});

test('escala del recorte: «alto» es el del trazo, no el del lienzo con margen y borde suave', () => {
  // lienzo recortado 300 px de alto = 250 px de trazo + 2 × 25 px de margen (borde suave)
  const s = FO.cutScale(250, 10);
  assert.equal(250 * s, 10);
  assert.equal(300 * s, 12); // el lienzo entero mide más; el dibujo trazado mide 10
  assert.ok(Number.isNaN(FO.cutScale(0, 10)));
  // calibración «Medir»: una línea de 400 px = 5 cm ⇒ un trazo de 800 px de la foto mide 10 cm
  assert.ok(Math.abs(FO.altoFromCalib(800, 5 / 400) - 10) < 1e-9);
  assert.ok(Number.isNaN(FO.altoFromCalib(800, 0)));
});

test('mover con el dedo: lo agarrado queda bajo el dedo (±1 mm) y se mueve lo que se movió el dedo', () => {
  for (const rot of [0, 90, 180]) {
    const dec = { d: 30, ang: 20, rot };
    const tris = FO.decalTriangles(base, FO.decalCoords(chart, dec), W, H);
    const [gx, gy] = [1.5, -2];
    const g3 = FO.decalPoint3D(tris, fit.P, gx, gy).pos;
    // el dedo baja 5 cm hacia la mano y recorre 4 cm de contorno: destino = punto del brazo a esa distancia
    const at0 = FO.decalPointUV(tris, gx, gy).uv,
      a0 = loc(at0[0], at0[1]);
    const jT = chart.jOfY(chart.Yat(a0.jf, a0.phi) + 5, a0.phi);
    const phT = chart.phiOfArc(jT, chart.arcAt(jT, a0.phi) + 4);
    const nd = FO.placeAt(chart, dec, gx, gy, { jf: jT, phi: phT });
    const tris2 = FO.decalTriangles(base, FO.decalCoords(chart, { ...dec, ...nd }), W, H);
    const h2 = FO.decalPointUV(tris2, gx, gy),
      a2 = loc(h2.uv[0], h2.uv[1]);
    const dy = chart.Yat(a2.jf, a2.phi) - chart.Yat(jT, phT),
      dx = chart.arcAt(a2.jf, a2.phi) - chart.arcAt(jT, phT);
    assert.ok(Math.hypot(dx, dy) < 0.1, `giro ${rot}: queda a ${Math.hypot(dx, dy).toFixed(3)} cm del dedo`);
    const p2 = FO.decalPoint3D(tris2, fit.P, gx, gy).pos;
    const mov = Math.hypot(p2[0] - g3[0], p2[1] - g3[1], p2[2] - g3[2]);
    assert.ok(mov > 5.3 && mov < 6.6, `giro ${rot}: se movió ${mov.toFixed(2)} cm (cuerda de 5 × 4 cm)`);
  }
});

test('el alcance del recorte: llega al dorso de la mano y no pasa de ahí', () => {
  assert.ok(chart.dMax > K.EJEMPLO.hombro_muneca + 2, `dMax ${chart.dMax}`);
  assert.ok(chart.dMax < K.EJEMPLO.hombro_muneca + 8, `dMax ${chart.dMax}`);
  assert.ok(chart.dMin < 5, `dMin ${chart.dMin}`); // el hombro (encima de la axila) no tiene contorno cerrado
});

test('pellizco: el recorte gira hacia el mismo lado que los dedos en la vista 2D (giros 0, 90 y 180)', () => {
  // ángulo en pantalla (x = u, y = 1 − v, hacia abajo) del eje x del recorte
  const angImg = tris => {
    const h = FO.decalPointUV(tris, 0, 0),
      A = FO.affine3(
        h.tri.p,
        h.tri.q.map(([u, v]) => [u, 1 - v]),
      );
    return (Math.atan2(A[1], A[0]) * 180) / Math.PI;
  };
  for (const ang of [0, 90, 180, -90])
    for (const rot of [0, 90, 180]) {
      const dec = { d: 30, ang, rot },
        t0 = FO.decalTriangles(base, FO.decalCoords(chart, dec), W, H);
      const rot2 = FO.pinchRot(t0, rot, 15);
      const t1 = FO.decalTriangles(base, FO.decalCoords(chart, { ...dec, rot: rot2 }), W, H);
      let dd = angImg(t1) - angImg(t0);
      dd -= 360 * Math.round(dd / 360);
      assert.ok(Math.abs(dd - 15) < 4, `${ang}° giro ${rot}: el dibujo giró ${dd.toFixed(1)}° (dedos 15°)`);
    }
});
