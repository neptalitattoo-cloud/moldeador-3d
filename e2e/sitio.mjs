// Servidor estático mínimo (tipos MIME correctos) sobre una copia temporal del sitio.
// La copia permite simular una versión nueva (N → N+1) sin tocar el repo.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
    // publica la versión N+1 en la copia (lo mismo que herramientas/version_sw.py)
    subirVersion() {
      const n = this.version() + 1;
      for (const f of ['sw.js', 'index.html', 'js/app.js', 'js/fit-worker.js', 'js/view2d.js', 'js/parts.js']) {
        const p = path.join(dir, f);
        fs.writeFileSync(
          p,
          fs
            .readFileSync(p, 'utf8')
            .replace(/\?v=\d+/g, `?v=${n}`)
            .replace(/moldeador-v\d+/g, `moldeador-v${n}`),
        );
      }
      return n;
    },
    async cerrar() {
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
