// Imagen de prueba generada (nunca fotos reales): «brazo» color piel con ruido y algún pelo/poro oscuro,
// y un «tatuaje» oscuro (rectángulo con un círculo claro) en una zona conocida.
import zlib from 'node:zlib';

export const FOTO = { w: 600, h: 800, piel: [200, 152, 122], tat: { x0: 200, y0: 250, x1: 400, y1: 500 } };

function crc(b) {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(t, d) {
  const b = Buffer.alloc(12 + d.length);
  b.writeUInt32BE(d.length, 0);
  b.write(t, 4, 'latin1');
  d.copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length);
  return b;
}
export function fotoPNG() {
  const { w, h, piel, tat } = FOTO;
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const raw = Buffer.alloc(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + 3 * w)] = 0;
    for (let x = 0; x < w; x++) {
      let c = piel.map(v => v + (rnd() - 0.5) * 10);
      if (rnd() < 0.03) c = [60, 40, 30]; // poros / pelos: deben ignorarse en el cuentagotas
      if (x >= tat.x0 && x < tat.x1 && y >= tat.y0 && y < tat.y1) {
        const inCircle = (x - (tat.x0 + tat.x1) / 2) ** 2 + (y - (tat.y0 + tat.y1) / 2) ** 2 < 50 ** 2;
        c = inCircle ? [170, 170, 170] : [25, 25, 25];
        // marca asimétrica arriba a la derecha (para ver que no sale en espejo)
        if (x > tat.x1 - 60 && x < tat.x1 - 25 && y > tat.y0 + 30 && y < tat.y0 + 65) c = [230, 40, 40];
      }
      const o = y * (1 + 3 * w) + 1 + 3 * x;
      raw[o] = Math.max(0, Math.min(255, c[0]));
      raw[o + 1] = Math.max(0, Math.min(255, c[1]));
      raw[o + 2] = Math.max(0, Math.min(255, c[2]));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
