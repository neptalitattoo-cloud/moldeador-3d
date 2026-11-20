// Genera USDZ de prueba con nombres difíciles para validarlos con USD en CI:
//   node tests/make_usdz.mjs DIR && python3 herramientas/validar_usdz.py DIR/*.usdz
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as K from '../js/core.js';

const dir = process.argv[2] || 'usdz-prueba';
fs.mkdirSync(dir, { recursive: true });
const r = p => new URL('../' + p, import.meta.url);
const meta = JSON.parse(fs.readFileSync(r('data/brazo_derecho.json')));
const bin = fs.readFileSync(r('data/brazo_derecho.bin'));
const base = K.loadBase(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const { P } = K.fit(base, K.EJEMPLO);

// PNG real de 1×1 (color piel) para que la textura también se valide
const crc = b => {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const chunk = (t, d) => {
  const b = Buffer.alloc(12 + d.length);
  b.writeUInt32BE(d.length, 0);
  b.write(t, 4, 'latin1');
  d.copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length);
  return b;
};
const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.from([0, 224, 172, 150]))),
  chunk('IEND', Buffer.alloc(0)),
]);

for (const nombre of ['Ana-María', '123', '', '李']) {
  const f = path.join(dir, `brazo_${K.usdIdent(nombre || 'vacio')}.usdz`);
  fs.writeFileSync(f, K.makeUSDZ(base, P, 'brazo_' + nombre, new Uint8Array(png)));
  console.log(JSON.stringify(nombre), '→', f);
}
