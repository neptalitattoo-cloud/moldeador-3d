// Imágenes de prueba generadas (nunca fotos reales): «brazo» color piel con ruido y algún pelo/poro oscuro,
// y un «tatuaje» oscuro (rectángulo con un círculo claro) en una zona conocida. Variantes: la misma foto girada
// (H29) y un brazo cilíndrico visto de frente con un tatuaje que lo rodea (H33).
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
// PNG RGB w×h; color(x, y, rnd) → [r, g, b] (rnd: aleatorio con semilla fija, siempre el mismo resultado)
function png(w, h, color) {
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const raw = Buffer.alloc(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + 3 * w)] = 0;
    for (let x = 0; x < w; x++) {
      const c = color(x, y, rnd),
        o = y * (1 + 3 * w) + 1 + 3 * x;
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
// la escena de la foto en un punto (continuo) de la foto derecha
function escena(x, y, rnd) {
  const { piel, tat } = FOTO;
  let c = piel.map(v => v + (rnd() - 0.5) * 10);
  if (rnd() < 0.03) c = [60, 40, 30]; // poros / pelos: deben ignorarse en el cuentagotas
  if (x >= tat.x0 && x < tat.x1 && y >= tat.y0 && y < tat.y1) {
    const inCircle = (x - (tat.x0 + tat.x1) / 2) ** 2 + (y - (tat.y0 + tat.y1) / 2) ** 2 < 50 ** 2;
    c = inCircle ? [170, 170, 170] : [25, 25, 25];
    // marca asimétrica arriba a la derecha (para ver que no sale en espejo)
    if (x > tat.x1 - 60 && x < tat.x1 - 25 && y > tat.y0 + 30 && y < tat.y0 + 65) c = [230, 40, 40];
  }
  return c;
}
// H29: un punto (x, y) de la foto derecha, en la foto girada `giro` grados (horario) alrededor del centro
export function girar(x, y, giro) {
  const a = (giro * Math.PI) / 180,
    cx = FOTO.w / 2,
    cy = FOTO.h / 2;
  return [cx + Math.cos(a) * (x - cx) - Math.sin(a) * (y - cy), cy + Math.sin(a) * (x - cx) + Math.cos(a) * (y - cy)];
}
// la foto de prueba; con giro, la misma escena girada (como una foto hecha con el móvil torcido), del mismo tamaño
export function fotoPNG({ giro = 0 } = {}) {
  const { w, h } = FOTO;
  if (!giro) return png(w, h, (x, y, rnd) => escena(x, y, rnd));
  return png(w, h, (x, y, rnd) => {
    const [sx, sy] = girar(x + 0.5, y + 0.5, -giro); // centro del píxel → punto de la escena derecha
    return escena(Math.floor(sx), Math.floor(sy), rnd);
  });
}

// H33: brazo cilíndrico (contorno 30 cm, 25 px por cm de piel) visto de frente en vertical, sobre una pared azulada;
// el tatuaje rodea el brazo: 8 cm de ARCO de ancho sobre la piel y 10 cm de alto. En la foto (ortográfica) el ancho
// se ve como la cuerda: ≈ 7,1 cm.
export const CIL = { w: 600, h: 800, ppcm: 25, contorno: 30, xc: 300, yc: 400, arco: 8, alto: 10 };
CIL.R = (CIL.contorno / (2 * Math.PI)) * CIL.ppcm;
export function cilindroPNG() {
  const { w, h, ppcm, xc, yc, R, arco, alto } = CIL;
  return png(w, h, (x, y, rnd) => {
    const u = (x + 0.5 - xc) / R;
    if (Math.abs(u) >= 1) return [90 + (rnd() - 0.5) * 8, 110 + (rnd() - 0.5) * 8, 140 + (rnd() - 0.5) * 8]; // pared
    const s = (R * Math.asin(u)) / ppcm; // cm de arco sobre la piel desde el centro del brazo
    if (Math.abs(s) <= arco / 2 && Math.abs(y + 0.5 - yc) <= (alto / 2) * ppcm) return [25, 25, 25];
    return [200 + (rnd() - 0.5) * 10, 152 + (rnd() - 0.5) * 10, 122 + (rnd() - 0.5) * 10];
  });
}
