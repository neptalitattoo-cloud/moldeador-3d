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

test('ejemplo: todas las medidas a ±0,3 cm, sin NaN y sin pliegues', () => {
  assert.ok(fitEj.P.every(Number.isFinite), 'la malla tiene NaN/Infinity');
  assert.equal(fitEj.report.flips, 0);
  for (const [n, t, v] of fitEj.report.rows) assert.ok(Math.abs(v - t) <= 0.3, `${n}: ${v.toFixed(2)} ≠ ${t}`);
});

test('rechaza entradas imposibles con un mensaje (nunca una malla con NaN)', () => {
  for (const x of [
    { ancho_nudillos: -8 },
    { largo_mano: -1 },
    { largo_mano: 200 },
    { c_muneca: NaN },
    { hombro_codo: 0 },
    { c_axila: Infinity },
    { hombro_muneca: 20 },
    { largo_mano: 12, ancho_nudillos: 14 },
  ])
    assert.throws(() => K.fit(base, { ...EJ, ...x }), Error, JSON.stringify(x));
});

test('entradas aleatorias: o error o resultado finito', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 6; i++) {
    const inp = { ...EJ };
    for (const k of Object.keys(K.RANGOS))
      if (rnd() < 0.5) inp[k] = [NaN, -5, 0, 1e6, (K.RANGOS[k][0] + K.RANGOS[k][1]) / 2][Math.floor(rnd() * 5)];
    try {
      const o = K.fit(base, inp);
      assert.ok(o.P.every(Number.isFinite));
    } catch (e) {
      assert.ok(e instanceof Error && e.message.length > 3);
    }
  }
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
    { largo_mano: 10, ancho_nudillos: 4 },
    { largo_mano: 30, ancho_nudillos: 15 },
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
