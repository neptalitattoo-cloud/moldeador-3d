import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sitio, lista, moldear, vigilarErrores, leerZip, tamPNG } from './sitio.mjs';
import { fotoPNG } from './fixture.mjs';

let S;
test.beforeAll(async () => {
  S = await sitio();
});
test.afterAll(async () => {
  await S.cerrar();
});

// Lee el USDZ (ZIP sin compresión): primer archivo = .usda
function abrirUSDZ(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength),
    files = {};
  let off = 0;
  while (dv.getUint32(off, true) === 0x04034b50) {
    const n = dv.getUint16(off + 26, true),
      x = dv.getUint16(off + 28, true),
      size = dv.getUint32(off + 18, true),
      d = off + 30 + n + x;
    files[buf.subarray(off + 30, off + 30 + n).toString('utf8')] = { d, data: buf.subarray(d, d + size) };
    off = d + size;
  }
  return files;
}

test('moldear el ejemplo → exportar USDZ → reabrirlo; medidas a ±0,05 cm; 0 fotogramas en reposo', async ({ page }) => {
  const errs = vigilarErrores(page);
  await page.goto(S.url + '?debug');
  await lista(page);
  await page.click('#ejemplo');
  await page.fill('#cliente', 'Ana-María');
  await moldear(page);
  const r = await page.evaluate(() => ({
    flips: window.__result.report.flips,
    rows: window.__result.report.rows.map(r => [r[0], r[1], r[2]]),
    P: Array.from(window.__result.P),
  }));
  expect(r.flips).toBe(0);
  for (const [n, t, v] of r.rows) expect(Math.abs(v - t), n).toBeLessThanOrEqual(0.05);

  // sin interacción no se dibuja nada (render a demanda)
  await page.waitForTimeout(800);
  const quietos = await page.evaluate(async () => {
    const a = window.__frames();
    await new Promise(r => setTimeout(r, 1500));
    return window.__frames() - a;
  });
  expect(quietos).toBe(0);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlUsdz')]);
  expect(dl.suggestedFilename()).toMatch(/^brazo_Ana-Mar[ií]a\.usdz$/);
  const buf = fs.readFileSync(await dl.path());
  const files = abrirUSDZ(buf),
    nombres = Object.keys(files);
  expect(nombres[0]).toMatch(/^[A-Za-z_][A-Za-z0-9_]*\.usda$/);
  for (const k of nombres) expect(files[k].d % 64, k).toBe(0);
  const usda = files[nombres[0]].data.toString('utf8');
  expect(usda).not.toMatch(/NaN|Infinity/);
  const pts = usda
    .match(/point3f\[\] points = \[([^\]]*)\]/)[1]
    .match(/-?[\d.]+(e-?\d+)?/g)
    .map(Number);
  expect(pts.length).toBe(r.P.length);
  let maxd = 0;
  for (let i = 0; i < pts.length; i++) maxd = Math.max(maxd, Math.abs(pts[i] - r.P[i]));
  expect(maxd).toBeLessThan(0.01); // la malla reabierta es la moldeada
  expect(errs).toEqual([]);
});

test('cambiar una medida desactiva las descargas hasta volver a moldear', async ({ page }) => {
  await page.goto(S.url);
  await lista(page);
  await page.click('#ejemplo');
  await moldear(page);
  await expect(page.locator('#dlUsdz')).toBeEnabled();
  await page.fill('#c_biceps', '34');
  await expect(page.locator('#dlUsdz')).toBeDisabled();
  await expect(page.locator('#dlObj')).toBeDisabled();
  await expect(page.locator('#stale')).toBeVisible();
  await page.fill('#c_biceps', '33'); // vuelve a la medida moldeada
  await expect(page.locator('#dlUsdz')).toBeEnabled();
  await page.fill('#largo_mano', '-5');
  await page.click('#go');
  await expect(page.locator('#status')).toContainText('Revisa');
});

test('cancelar el moldeado y volver a moldear', async ({ page }) => {
  await page.goto(S.url);
  await lista(page);
  await page.click('#ejemplo');
  await page.click('#go');
  await expect(page.locator('#cancel')).toBeVisible();
  await expect(page.locator('#go')).toBeDisabled();
  await page.click('#cancel');
  await expect(page.locator('#status')).toContainText('cancelado');
  await expect(page.locator('#go')).toBeEnabled();
  await expect(page.locator('#cancel')).toBeHidden();
  await moldear(page); // el worker nuevo funciona
  await expect(page.locator('#dlUsdz')).toBeEnabled();
});

test('CSP real: 0 errores de consola al cargar, moldear y ver en 2D', async ({ page }) => {
  const errs = vigilarErrores(page);
  await page.goto(S.url);
  await lista(page);
  await page.click('#ejemplo');
  await moldear(page);
  await page.click('#btn2D');
  await page.waitForTimeout(800);
  expect(errs).toEqual([]);
});

test('sin conexión: la app abre y moldea', async ({ page, context }) => {
  await page.goto(S.url);
  await lista(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await lista(page);
  await page.click('#ejemplo');
  await moldear(page);
  await expect(page.locator('#dlUsdz')).toBeEnabled();
  await context.setOffline(false);
});

test('actualización N → N+1: aviso «Nueva versión», recarga y caché nueva', async ({ page }) => {
  await page.goto(S.url);
  await lista(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  const n = S.version(),
    n1 = S.subirVersion();
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator('#update')).toBeVisible({ timeout: 60_000 });
  await Promise.all([page.waitForEvent('load', { timeout: 60_000 }), page.click('#updBtn')]);
  await lista(page);
  const estado = await page.evaluate(async () => ({
    caches: await caches.keys(),
    app: [...document.scripts].map(s => s.src).find(s => /app\.js/.test(s)),
  }));
  expect(estado.caches).toContain(`moldeador-v${n1}`);
  expect(estado.caches).not.toContain(`moldeador-v${n}`);
  expect(estado.app).toContain(`?v=${n1}`);
});

const esperarSW = page =>
  page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });

test('red colgada: el SW sirve la copia guardada tras el tiempo límite de 3 s', async ({ page }) => {
  await page.goto(S.url);
  await lista(page);
  await esperarSW(page);
  S.colgarRed(true); // la página nunca responde (pero hay «conexión»)
  try {
    const t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    const ms = Date.now() - t0; // sólo la página: el arranque de la app (WebGL) no cuenta
    expect(ms).toBeGreaterThanOrEqual(2_500); // esperó a la red…
    expect(ms).toBeLessThan(10_000); // …pero no para siempre: sirvió la copia guardada
    await lista(page);
  } finally {
    S.colgarRed(false);
  }
});

test('caras invertidas: confirm() antes de exportar; «Cancelar» no descarga, «Aceptar» sí', async ({ page }) => {
  await page.goto(S.url + '?debug');
  await lista(page);
  await page.click('#ejemplo');
  await moldear(page);
  await page.evaluate(() => {
    window.__result.report.flips = 3; // simula una malla con 3 caras invertidas
  });
  let msg = '';
  let descargas = 0;
  page.on('download', () => descargas++);
  page.once('dialog', d => {
    msg = d.message();
    d.dismiss();
  });
  await page.click('#dlUsdz');
  await page.waitForTimeout(1500);
  expect(msg).toContain('3 caras invertidas');
  expect(descargas).toBe(0);
  await expect(page.locator('#go')).toBeEnabled(); // no quedó bloqueado
  page.once('dialog', d => d.accept());
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlUsdz')]);
  expect(dl.suggestedFilename()).toMatch(/\.usdz$/);
});

test('descargas OBJ, capas y PNG 2D con contenido correcto', async ({ page }) => {
  const errs = vigilarErrores(page);
  await page.goto(S.url + '?debug');
  await lista(page);
  await page.click('#ejemplo');
  await page.fill('#cliente', 'Ana');
  await page.check('#expMed');
  await moldear(page);
  const nV = await page.evaluate(() => window.__result.P.length / 3);
  const bajar = async sel => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
    return { nombre: d.suggestedFilename(), buf: fs.readFileSync(await d.path()) };
  };

  // OBJ + MTL + PNG (+ capas) en un ZIP
  const obj = await bajar('#dlObj');
  expect(obj.nombre).toBe('brazo_Ana_OBJ.zip');
  const zo = leerZip(obj.buf);
  const o = zo['brazo_Ana/brazo_Ana.obj'].toString('utf8'),
    mtl = zo['brazo_Ana/brazo_Ana.mtl'].toString('utf8');
  expect(o).toMatch(/^mtllib brazo_Ana\.mtl$/m);
  expect(o.match(/^v /gm).length).toBe(nV);
  expect(o.match(/^f /gm).length).toBeGreaterThan(nV);
  expect(o).not.toMatch(/NaN|Infinity/);
  expect(mtl).toMatch(/map_Kd brazo_Ana\.png/);
  expect(tamPNG(zo['brazo_Ana/brazo_Ana.png'])).not.toBeNull();
  expect(Object.keys(zo)).toContain('capas/LEEME_capas.txt');

  // Capas PNG: guías de tatuaje y de medición, a la resolución de la textura
  const capas = await bajar('#dlCapas');
  expect(capas.nombre).toBe('brazo_Ana_capas.zip');
  const zc = leerZip(capas.buf);
  for (const k of ['capas/brazo_Ana_guias.png', 'capas/brazo_Ana_guias_medicion.png']) {
    const t = tamPNG(zc[k]);
    expect(t, k).not.toBeNull();
    expect(t[0], k).toBe(t[1]);
    expect(t[0], k).toBeGreaterThanOrEqual(1024);
  }
  expect(zc['capas/LEEME_capas.txt'].toString('utf8')).toContain('Procreate');

  // PNG 2D
  await page.click('#btn2D');
  await page.waitForTimeout(800);
  const p2 = await bajar('#dl2D');
  expect(p2.nombre).toMatch(/\.png$/);
  const info = await page.evaluate(() => window.__last2D);
  expect(tamPNG(p2.buf)).toEqual([info.w, info.h]);
  expect(p2.buf.length).toBe(info.n);
  expect(errs).toEqual([]);
});

test('foto del brazo: cuentagotas → tono, recorte con lazo, colocar a X cm y mover en 2D', async ({ page }) => {
  const errs = vigilarErrores(page);
  const foto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foto-')), 'brazo.png');
  fs.writeFileSync(foto, fotoPNG()); // imagen generada: nunca fotos reales
  await page.goto(S.url + '?debug');
  await lista(page);
  await page.click('#ejemplo');
  await page.fill('#c_nudillos', '21'); // contorno de nudillos (antes «ancho»: 21 se rechazaba)
  await moldear(page);
  await page.setInputFiles('#fotoGal', foto);
  await expect(page.locator('#editor')).toBeVisible();
  const en = (x, y) => page.evaluate(([x, y]) => window.__editor.imgToClient(x, y), [x, y]);
  // 1) cuentagotas sobre la piel (con poros oscuros que debe ignorar)
  let [cx, cy] = await en(80, 100);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#edHex')).toContainText(/#[0-9a-f]{6}/);
  await page.click('#edUsarTono');
  const tono = await page.inputValue('#tono');
  const rgb = [1, 3, 5].map(k => parseInt(tono.slice(k, k + 2), 16));
  [200, 152, 122].forEach((v, k) => expect(Math.abs(rgb[k] - v)).toBeLessThan(6));
  // 2) lazo exactamente por el borde del tatuaje (rectángulo 200–400 × 250–500 de la imagen: 200 × 250 px)
  await page.click('#edTools button[data-t="lazo"]');
  const pts = [];
  const esquinas = [
    [200, 250],
    [400, 250],
    [400, 500],
    [200, 500],
    [200, 250],
  ];
  for (let c = 0; c < 4; c++)
    for (let k = 0; k < 8; k++) {
      const [x0, y0] = esquinas[c],
        [x1, y1] = esquinas[c + 1];
      pts.push([x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8]);
    }
  pts.push(esquinas[0]);
  [cx, cy] = await en(...pts[0]);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (const q of pts.slice(1)) {
    [cx, cy] = await en(...q);
    await page.mouse.move(cx, cy);
  }
  await page.mouse.up();
  await page.fill('#edAlto', '10'); // alto de lo rodeado ⇒ ancho = 200/250 × 10 = 8 cm
  await page.click('#edRecortar');
  await expect(page.locator('#edAlto')).toHaveValue(''); // sin calibrar, el alto no se arrastra al siguiente recorte
  await page.click('#edListo');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#decals .decal')).toHaveCount(1);
  // 3) colocar el centro a 38 cm del hombro, por fuera
  await page.evaluate(() => (window.__antes = window.__result));
  await page.fill('#decals .dd', '38');
  await page.locator('#decals .dd').press('Enter');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__result === window.__antes)).toBe(true); // Intro no vuelve a moldear
  const px = await page.evaluate(() => ({
    centro: window.__tatPixel(...window.__cmToUV(38, 0)),
    lejos: window.__tatPixel(...window.__cmToUV(20, 0)),
    otroLado: window.__tatPixel(...window.__cmToUV(38, 180)),
  }));
  expect(px.centro[3]).toBeGreaterThan(200);
  expect(px.lejos[3]).toBe(0);
  expect(px.otroLado[3]).toBe(0);
  // cm reales: lo pintado mide 8 × 10 cm sobre la malla ajustada (±3 %)
  const med = await page.evaluate(() => window.__medirRecorte(0));
  console.log(`e2e cm reales: ancho ${med.ancho.toFixed(2)} cm (8), alto ${med.alto.toFixed(2)} cm (10)`);
  expect(Math.abs(med.ancho - 8)).toBeLessThan(0.24);
  expect(Math.abs(med.alto - 10)).toBeLessThan(0.3);
  // sin espejo: la marca roja está arriba a la DERECHA del dibujo (x +2,3 cm, y −3,1 cm), y a la izquierda no
  const roja = await page.evaluate(() => [window.__recortePixel(0, 2.3, -3.1), window.__recortePixel(0, -2.3, -3.1)]);
  expect(roja[0][0]).toBeGreaterThan(170);
  expect(roja[0][1]).toBeLessThan(110);
  expect(roja[1][0]).toBeLessThan(110);
  // la guía azul del recorte existe en la capa de guías
  const guia = await page.evaluate(() => window.__guiaRecorte(0));
  expect(guia.tramos).toBeGreaterThan(40);
  expect(guia.azul).toBeGreaterThan(0);
  // 4) mover en 2D: lo agarrado sigue al dedo (dirección y cantidad)
  await page.click('#decals .mover');
  await expect(page.locator('#btn2D')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  const d0 = await page.evaluate(() => window.__decals()[0].d);
  const [sx, sy] = await page.evaluate(() => window.__recorteEnPantalla(0, 0, 0));
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(sx + 3 * k, sy + 6 * k);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const [ex, ey] = await page.evaluate(() => window.__recorteEnPantalla(0, 0, 0));
  console.log(
    `e2e arrastre: dedo (+18, +36) px, centro del recorte (${(ex - sx).toFixed(1)}, ${(ey - sy).toFixed(1)}) px`,
  );
  expect(Math.hypot(ex - sx - 18, ey - sy - 36)).toBeLessThan(4);
  const d1 = await page.evaluate(() => window.__decals()[0].d);
  expect(d1).not.toBe(d0);
  // un arrastre que empieza fuera del recorte mueve la vista, no el recorte
  const box = await page.locator('canvas.v2d').boundingBox();
  const antes = await page.evaluate(() => ({ ...window.__decals()[0], tx: window.__v2d.v.tx }));
  await page.mouse.move(box.x + 12, box.y + box.height - 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 52, box.y + box.height - 12, { steps: 4 });
  await page.mouse.up();
  const despues = await page.evaluate(() => ({ ...window.__decals()[0], tx: window.__v2d.v.tx }));
  expect([despues.d, despues.ang]).toEqual([antes.d, antes.ang]);
  expect(despues.tx - antes.tx).toBeCloseTo(40, 0);
  // pellizco con dos dedos (táctil) sobre el recorte: separarlos agranda, girarlos gira hacia el mismo lado
  const pin = await page.evaluate(async () => {
    const cv = document.querySelector('canvas.v2d'),
      [x, y] = window.__recorteEnPantalla(0, 0, 0);
    const ev = (t, id, px, py) =>
      cv.dispatchEvent(
        new PointerEvent(t, { pointerId: id, clientX: px, clientY: py, pointerType: 'touch', bubbles: true }),
      );
    const a0 = window.__decals()[0].alto,
      r0 = window.__decals()[0].rot;
    ev('pointerdown', 11, x - 20, y);
    ev('pointerdown', 12, x + 20, y);
    for (let k = 1; k <= 5; k++) {
      const R = 20 + 4 * k,
        t = (k * 3 * Math.PI) / 180; // gira 15° en el sentido de las agujas del reloj (pantalla)
      ev('pointermove', 11, x - R * Math.cos(t), y - R * Math.sin(t));
      ev('pointermove', 12, x + R * Math.cos(t), y + R * Math.sin(t));
    }
    ev('pointerup', 11, x, y);
    ev('pointerup', 12, x, y);
    await new Promise(r => setTimeout(r, 300));
    const d = window.__decals()[0];
    return { escala: d.alto / a0, giro: d.rot - r0 };
  });
  expect(pin.escala).toBeGreaterThan(1.3);
  expect(Math.abs(pin.giro)).toBeGreaterThan(5);
  // 5) tono sólo para esta sesión (el siguiente cliente empieza con piel neutra)
  expect(await page.evaluate(() => sessionStorage.getItem('moldeador.tono'))).toBe(tono);
  expect(await page.evaluate(() => localStorage.getItem('moldeador.tono'))).toBe(null);
  // 6) quitar el recorte libera su lienzo
  await page.click('#decals .decal button[aria-label^="Quitar"]');
  await expect(page.locator('#decals .decal')).toHaveCount(0);
  expect(errs).toEqual([]);
});

test('foto JPEG con EXIF «girada 90°» (Orientation = 6): el editor la ve derecha', async ({ page }) => {
  const errs = vigilarErrores(page);
  await page.goto(S.url + '?debug');
  await lista(page);
  // JPEG 60 × 40 (izquierda roja, derecha azul) hecho por el propio navegador
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 60;
    c.height = 40;
    const g = c.getContext('2d');
    g.fillStyle = '#e00000';
    g.fillRect(0, 0, 30, 40);
    g.fillStyle = '#0000e0';
    g.fillRect(30, 0, 30, 40);
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  });
  const jpg = Buffer.from(b64, 'base64');
  // segmento APP1 Exif con Orientation = 6 (girar 90° a la derecha al mostrar), justo tras SOI
  const tiff = Buffer.from([
    0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0,
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  const foto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exif-')), 'girada.jpg');
  fs.writeFileSync(foto, Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]));
  await page.setInputFiles('#fotoGal', foto);
  await expect(page.locator('#editor')).toBeVisible();
  const r = await page.evaluate(() => {
    const s = window.__editor.src,
      g = s.getContext('2d'),
      p = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    return { w: s.width, h: s.height, arriba: p(20, 10), abajo: p(20, 50) };
  });
  expect([r.w, r.h]).toEqual([40, 60]);
  expect(r.arriba[0]).toBeGreaterThan(150); // lo que era la izquierda (rojo) queda arriba
  expect(r.abajo[2]).toBeGreaterThan(150);
  // el foco entra en el editor y vuelve al cerrar
  expect(await page.evaluate(() => !!document.activeElement.closest('#editor'))).toBe(true);
  expect(await page.evaluate(() => document.querySelector('main').inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('main').inert)).toBe(false);
  expect(errs).toEqual([]);
});

test.describe('iPhone', () => {
  const { defaultBrowserType, ...iphone } = devices['iPhone 15']; // eslint-disable-line no-unused-vars
  test.use(iphone);
  test.skip(({ browserName }) => browserName !== 'webkit', 'emulación de iPhone sólo en WebKit');
  test('un dedo hace scroll; aviso «Usa dos dedos para girar»', async ({ page }) => {
    await page.goto(S.url);
    await lista(page);
    await page.click('#ejemplo');
    await moldear(page);
    const ta = await page.evaluate(() => document.querySelector('#viewer canvas').style.touchAction);
    expect(ta).toBe('pan-y');
    await expect(page.locator('#guiaInfo')).toContainText('dos dedos');
    // touchmove con 2 dedos se cancela (no mueve la página); con 1 dedo no (scroll normal)
    const cancelado = await page.evaluate(() => {
      const cv = document.querySelector('#viewer canvas');
      // WebKit no deja construir Touch: evento genérico con «touches» simulado (el manejador sólo mira cuántos hay)
      const ev = n => {
        const e = new Event('touchmove', { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'touches', { value: { length: n } });
        return e;
      };
      const dos = ev(2),
        uno = ev(1);
      cv.dispatchEvent(dos);
      cv.dispatchEvent(uno);
      return [dos.defaultPrevented, uno.defaultPrevented];
    });
    expect(cancelado).toEqual([true, false]);
  });
});
