// Servidor estático mínimo (tipos MIME correctos) sobre una copia temporal del sitio.
// La copia permite simular una versión nueva (N → N+1) sin tocar el repo.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const RAIZ = path.resolve(import.meta.dirname, '..');
const COPIAR = ['index.html', 'sw.js', 'manifest.webmanifest', 'css', 'js', 'data', 'vendor', 'icons'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export async function sitio() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moldeador-e2e-'));
  for (const f of COPIAR)
    if (fs.existsSync(path.join(RAIZ, f))) fs.cpSync(path.join(RAIZ, f), path.join(dir, f), { recursive: true });
  const colgadas = new Set();
  const estado = { colgar: false };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // «red colgada»: la página (navegación) nunca responde, como una wifi que conecta pero no da datos
    if (estado.colgar && (p.endsWith('/') || p.endsWith('index.html'))) {
      colgadas.add(res);
      return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, path.normalize(p));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404).end('no');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  return {
    dir,
    url: `http://127.0.0.1:${srv.address().port}/`,
    version: () => +fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').match(/moldeador-v(\d+)/)[1],
    // publica la versión N+1 en la copia con la herramienta real (también actualiza el hash de la CSP)
    subirVersion() {
      const n = this.version() + 1;
      execFileSync('python3', [path.join(RAIZ, 'herramientas', 'version_sw.py'), String(n), '--root', dir]);
      return n;
    },
    colgarRed(si) {
      estado.colgar = si;
      if (!si) {
        for (const r of colgadas) r.destroy();
        colgadas.clear();
      }
    },
    async cerrar() {
      this.colgarRed(false);
      srv.closeAllConnections();
      await new Promise(ok => srv.close(ok));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Espera a que la app esté lista sin evaluar código (funciona también con la CSP real)
export async function lista(page) {
  await page.waitForSelector('#btn2D:not([disabled])', { timeout: 180_000 }); // Chromium con swiftshader es lento en CI
}
export async function moldear(page) {
  await page.click('#go');
  await page.waitForSelector('#tabla tbody tr:nth-child(8)', { timeout: 120_000 });
}
// Errores de consola y de página (las violaciones de CSP salen como error de consola)
export function vigilarErrores(page) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errs.push(m.text());
  });
  return errs;
}

// Lee un ZIP (sin compresión o deflate) → { nombre: Buffer }
export function leerZip(buf) {
  const out = {};
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const metodo = buf.readUInt16LE(off + 8),
      comp = buf.readUInt32LE(off + 18),
      n = buf.readUInt16LE(off + 26),
      x = buf.readUInt16LE(off + 28),
      d = off + 30 + n + x,
      datos = buf.subarray(d, d + comp);
    out[buf.subarray(off + 30, off + 30 + n).toString('utf8')] = metodo === 8 ? zlib.inflateRawSync(datos) : datos;
    off = d + comp;
  }
  return out;
}
// PNG válido → [ancho, alto]
export function tamPNG(b) {
  if (b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || b.subarray(12, 16).toString() !== 'IHDR') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
