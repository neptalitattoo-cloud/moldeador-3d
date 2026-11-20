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
  assert.ok(
    FO.insidePoly(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      5,
      5,
    ),
  );
  assert.ok(
    !FO.insidePoly(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      15,
      5,
    ),
  );
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
});

test('cm → UV: el punto cae exactamente sobre el anillo de esa distancia (mismas guías azules)', () => {
  for (const [d, ang] of [
    [8, 0],
    [15, 90],
    [24, 180],
    [33, -90],
    [45, 0],
  ]) {
    const uv = FO.cmToUV(base, chart, d, ang);
    assert.ok(uv, `sin UV para ${d} cm / ${ang}°`);
    let best = 1;
    for (const [u1, v1, u2, v2] of K.ringSegments(base, fit.P, fit.report.tape, [d])) {
      const dx = u2 - u1,
        dy = v2 - v1,
        L = dx * dx + dy * dy;
      const k = L ? Math.max(0, Math.min(1, ((uv[0] - u1) * dx + (uv[1] - v1) * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(uv[0] - u1 - k * dx, uv[1] - v1 - k * dy));
    }
    assert.ok(best < 2e-3, `${d} cm / ${ang}°: a ${best} del anillo`);
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
