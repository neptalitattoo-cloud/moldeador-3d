// Ejecutar con:  node --test tests/fit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as K from '../js/core.js';

const r = p => new URL('../' + p, import.meta.url);
const meta = JSON.parse(fs.readFileSync(r('data/brazo_derecho.json')));
const bin = fs.readFileSync(r('data/brazo_derecho.bin'));
const base = K.loadBase(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const EJ = K.EJEMPLO;
const fitEj = K.fit(base, EJ);
const GOLDEN_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

test('ejemplo: todas las medidas a ±0,3 cm, sin NaN y sin pliegues', () => {
  assert.ok(fitEj.P.every(Number.isFinite), 'la malla tiene NaN/Infinity');
  assert.equal(fitEj.report.flips, 0);
  for (const [n, t, v] of fitEj.report.rows)
    assert.ok(Math.abs(v - t) <= K.FIT_TOLERANCE, `${n}: ${v.toFixed(2)} ≠ ${t}`);
});

test('rechaza entradas imposibles con un mensaje (nunca una malla con NaN)', () => {
  for (const x of [
    { c_nudillos: -8 },
    { largo_mano: -1 },
    { largo_mano: 200 },
    { c_muneca: NaN },
    { hombro_codo: 0 },
    { c_axila: Infinity },
    { hombro_muneca: 20 },
    { c_nudillos: 14 }, // contorno, no ancho: menos de 15 cm es imposible
    { c_nudillos: 40 },
  ])
    assert.throws(() => K.fit(base, { ...EJ, ...x }), Error, JSON.stringify(x));
});

// Fuzz con semilla fija (reproducible): 520 entradas. Las inválidas deben rechazarse con un mensaje legible;
// las válidas (≈1 de cada 5) se moldean de verdad y deben dar una malla finita.
test('fuzz (520 entradas, semilla fija): o error legible o malla finita', () => {
  let seed = 20261120;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ids = Object.keys(K.RANGOS);
  const raro = () => [NaN, -5, 0, 1e6, -Infinity, Infinity, 1e-9, -0, undefined, null][Math.floor(rnd() * 10)];
  const dentro = k => {
    const [lo, hi] = K.RANGOS[k];
    return lo + (hi - lo) * rnd();
  };
  let validas = 0,
    rechazadas = 0;
  for (let i = 0; i < 520; i++) {
    const inp = {},
      modo = rnd();
    for (const k of ids) {
      if (modo < 0.2)
        inp[k] = EJ[k] == null ? undefined : EJ[k] * (0.75 + 0.5 * rnd()); // cerca del ejemplo
      else if (modo < 0.5)
        inp[k] = rnd() < 0.15 ? raro() : dentro(k); // casi todo dentro de rango
      else inp[k] = rnd() < 0.5 ? raro() : dentro(k) * (rnd() < 0.5 ? 1 : 4 * rnd()); // basura
    }
    for (const k of ids) if (inp[k] === undefined) delete inp[k];
    let ok = true;
    try {
      K.validateInputs(inp);
    } catch (e) {
      ok = false;
      assert.ok(e instanceof Error && e.message.length > 5 && !/undefined|NaN/.test(e.message), e.message);
    }
    if (!ok) {
      rechazadas++;
      assert.throws(() => K.fit(base, inp), Error);
      continue;
    }
    if (validas >= 60) continue; // limita el tiempo: 60 moldeados completos
    validas++;
    try {
      const o = K.fit(base, inp);
      assert.ok(o.P.every(Number.isFinite), JSON.stringify(inp));
    } catch (e) {
      assert.ok(e instanceof Error && !/undefined|null|NaN/.test(e.message), `${JSON.stringify(inp)}: ${e.message}`);
    }
  }
  assert.ok(validas >= 40 && rechazadas >= 200, `validas ${validas}, rechazadas ${rechazadas}`);
});

// Golden: el USDZ del ejemplo es determinista (ZIP sin fechas). Si cambias el ajuste o el formato a propósito,
// sustituye GOLDEN_USDZ por el valor «actual» que muestra el fallo.
const GOLDEN_USDZ = 'fb3f3c7a8d998425f5d970e2592199cbeac7f6c91cbea8b1478a7832e06b6d53';
test('golden: USDZ del ejemplo idéntico byte a byte', async () => {
  const { createHash } = await import('node:crypto');
  const z = K.makeUSDZ(base, fitEj.P, 'brazo_ejemplo', GOLDEN_PNG);
  assert.equal(createHash('sha256').update(z).digest('hex'), GOLDEN_USDZ);
});

test('usdIdent devuelve siempre un identificador USD válido', () => {
  for (const s of ['brazo_Ana-María', '123', '', 'José Luis', '李小龙', 'a.b/c'])
    assert.match(K.usdIdent(s), /^[A-Za-z_][A-Za-z0-9_]*$/);
});

test('USDZ con «Ana-María»: .usda primero, alineado a 64, prim válido, varname string, sin NaN', () => {
  const z = K.makeUSDZ(base, fitEj.P, 'brazo_Ana-María', new Uint8Array([137, 80, 78, 71])),
    dv = new DataView(z.buffer);
  let off = 0,
    i = 0;
  while (dv.getUint32(off, true) === 0x04034b50) {
    const n = dv.getUint16(off + 26, true),
      x = dv.getUint16(off + 28, true),
      size = dv.getUint32(off + 18, true),
      d = off + 30 + n + x;
    const nombre = new TextDecoder().decode(z.subarray(off + 30, off + 30 + n));
    assert.equal(d % 64, 0, nombre);
    if (i++ === 0) {
      assert.match(nombre, /^[A-Za-z_][A-Za-z0-9_]*\.usda$/);
      const u = new TextDecoder().decode(z.subarray(d, d + size));
      assert.match(u, /defaultPrim = "[A-Za-z_][A-Za-z0-9_]*"/);
      assert.match(u, /string inputs:varname = "st"/); // USD ≥ 21.11: string (el validador de USD 26 marca token como error)
      assert.ok(!/NaN|Infinity/.test(u));
    }
    off = d + size;
  }
  assert.equal(i, 2);
});

test('exportar con NaN lanza error', () => {
  const P = Float32Array.from(fitEj.P);
  P[5] = NaN;
  assert.throws(() => K.makeUSDA(base, P, 'x'));
  assert.throws(() => K.makeOBJ(base, P, 'x', 'x.mtl', 'x.png'));
});

test('extremos válidos de la mano y del brazo: resultado finito', () => {
  for (const x of [
    { largo_mano: 10, c_nudillos: 15 },
    { largo_mano: 30, c_nudillos: 32 },
    { c_nudillos: 21 }, // 21 cm: antes se rechazaba al leerse como «ancho»
    { c_muneca: 14, c_antebrazo: 22 },
    { hombro_codo: 28, codo_muneca: 22, hombro_muneca: 50 },
  ]) {
    try {
      const o = K.fit(base, { ...EJ, ...x });
      assert.ok(o.P.every(Number.isFinite), JSON.stringify(x));
    } catch (e) {
      assert.ok(e instanceof Error && !/undefined|null|NaN/.test(e.message), `${JSON.stringify(x)}: ${e.message}`);
    }
  }
});
