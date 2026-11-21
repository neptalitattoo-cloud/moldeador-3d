import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sitio, lista, moldear, vigilarErrores, leerZip, tamPNG } from './sitio.mjs';
import { fotoPNG, girar, cilindroPNG, CIL, FOTO } from './fixture.mjs';

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

// ---------- foto del brazo ----------
// La imagen de prueba (e2e/fixture.mjs) es generada: tinta en el rectángulo 200–400 × 250–500 px (200 × 250 px),
// con un círculo claro en el centro y una marca roja arriba a la derecha. Escala con «Alto 10»: 0,04 cm/px.
function elipse(cx, cy, rx, ry, n = 48) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = (2 * Math.PI * k) / n;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}
// lazo HOLGADO como el de un dedo (H9): deja 25 px de piel arriba y abajo y corta las esquinas de la tinta
const LAZO_HOLGADO = elipse(300, 375, 125, 150);
// lazo DESCENTRADO (H31): 30 px más arriba que la tinta (95 px de piel arriba y 35 abajo)
const LAZO_ALTO = elipse(300, 345, 135, 190);
// imagen generada (nunca fotos reales) en un archivo temporal
function archivoFoto(buf = fotoPNG()) {
  const foto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foto-')), 'brazo.png');
  fs.writeFileSync(foto, buf);
  return foto;
}
async function abrirFoto(page, query, buf = fotoPNG()) {
  const foto = archivoFoto(buf);
  await page.goto(S.url + query);
  await lista(page);
  await page.click('#ejemplo');
  await page.fill('#c_nudillos', '21'); // contorno de nudillos (antes «ancho»: 21 se rechazaba)
  await moldear(page);
  await page.setInputFiles('#fotoGal', foto);
  await expect(page.locator('#editor')).toBeVisible();
}
const lum = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
// arrastre con el ratón por puntos de la foto (px de la imagen)
async function trazar(page, pts) {
  // el lienzo se vuelve a encajar cuando el panel cambia de alto (otra herramienta): se espera a que se asiente
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const cl = await page.evaluate(ps => ps.map(([x, y]) => window.__editor.imgToClient(x, y)), pts);
  await page.mouse.move(...cl[0]);
  await page.mouse.down();
  for (const q of cl.slice(1)) await page.mouse.move(...q);
  await page.mouse.up();
}
// lazo (por defecto el holgado) + «Alto» SIN «Medir» (+ «Marcar el alto» si se pide; si no, se confirma la caja
// azul: H30) → recorte colocado con el centro a d cm, por fuera
async function recortar(page, { marcar = false, lazo = LAZO_HOLGADO, alto = 10, d = 38 } = {}) {
  await page.click('#edTools button[data-t="lazo"]');
  await trazar(page, lazo);
  if (marcar) {
    await page.click('#edMarcar');
    await trazar(page, [
      [300, 250],
      [300, 500],
    ]); // de arriba abajo de la tinta
    const r = await page.evaluate(() => window.__editor.refH());
    expect(r.por).toBe('marca');
    expect(Math.abs(r.h - 250)).toBeLessThan(2);
    await expect(page.locator('#edTinta')).toContainText('Alto marcado');
    await expect(page.locator('#edCajaOk')).toBeHidden(); // con el alto marcado no hace falta confirmar la caja
  }
  await page.fill('#edAlto', String(alto)); // alto de la TINTA ⇒ ancho = 200/250 × 10 = 8 cm
  if (!marcar) {
    // H30: sin el alto marcado a mano, «Añadir recorte» espera a que se confirme la caja azul
    await expect(page.locator('#edRecortar')).toBeDisabled();
    await expect(page.locator('#edTinta')).toContainText('compruébalo con la regla');
    await page.click('#edCajaOk');
    await expect(page.locator('#edCajaOk')).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('#edRecortar')).toBeEnabled();
  await page.click('#edRecortar');
  await expect(page.locator('#edAlto')).toHaveValue(''); // sin calibrar, el alto no se arrastra al siguiente recorte
  // H41: se anuncia dentro del editor y el foco pasa al nombre del siguiente (no se queda en un botón apagado)
  await expect(page.locator('#edAviso')).toContainText('añadido');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('edNombre');
  expect(await page.evaluate(() => window.__editor.brazo)).toBeNull(); // H33: el desenrollado era de este recorte
  await page.click('#edListo');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#decals .decal')).toHaveCount(1);
  await page.evaluate(() => (window.__antes = window.__result));
  await page.fill('#decals .dd', String(d));
  await page.locator('#decals .dd').press('Enter');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__result === window.__antes)).toBe(true); // Intro no vuelve a moldear
}
// lo pintado de la TINTA (oscuro) mide 8 × 10 cm en la malla ajustada (±0,3 cm), aunque el lazo rodee más piel;
// se mide fuera del círculo claro y de la marca roja: alto en x = −2,5 cm, ancho en y = +3 cm
async function comprobarMedidas(page, que) {
  const med = await page.evaluate(() => ({
    tinta: window.__medirRecorte(0, { tinta: true, x: -2.5, y: 3 }),
    alfa: window.__medirRecorte(0, { y: 3 }), // con la piel que rodeó el lazo (alto por el centro: 300 px)
  }));
  console.log(
    `e2e ${que}: tinta ${med.tinta.ancho.toFixed(2)} × ${med.tinta.alto.toFixed(2)} cm (8 × 10); ` +
      `con la piel del lazo ${med.alfa.ancho.toFixed(2)} × ${med.alfa.alto.toFixed(2)} cm`,
  );
  expect(Math.abs(med.tinta.ancho - 8)).toBeLessThan(0.3);
  expect(Math.abs(med.tinta.alto - 10)).toBeLessThan(0.3);
  expect(med.alfa.alto).toBeGreaterThan(med.tinta.alto + 1); // el lazo holgado sí pinta piel (≈ 12 cm por el centro)
  // sin espejo: la marca roja está arriba a la DERECHA del dibujo (x +2,3 cm, y −3,1 cm), y a la izquierda no
  const roja = await page.evaluate(() => [window.__recortePixel(0, 2.3, -3.1), window.__recortePixel(0, -2.3, -3.1)]);
  expect(roja[0][0]).toBeGreaterThan(170);
  expect(roja[0][1]).toBeLessThan(110);
  expect(roja[1][0]).toBeLessThan(110);
}
const hayWebGL2 = page => page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));

test('foto: cuentagotas → tono, lazo holgado, colocar a X cm y mover en 2D', async ({ page, browserName }) => {
  const errs = vigilarErrores(page);
  await abrirFoto(page, '?debug');
  // 1) cuentagotas sobre la piel (con poros oscuros que debe ignorar)
  await trazar(page, [[80, 100]]);
  await expect(page.locator('#edHex')).toContainText(/#[0-9a-f]{6}/);
  await page.click('#edUsarTono');
  const tono = await page.inputValue('#tono');
  const rgb = [1, 3, 5].map(k => parseInt(tono.slice(k, k + 2), 16));
  [200, 152, 122].forEach((v, k) => expect(Math.abs(rgb[k] - v)).toBeLessThan(6));
  // 2) lazo holgado: la tinta se detecta sola dentro (caja azul) y a ella se aplica el alto (H9)
  await page.click('#edTools button[data-t="lazo"]');
  await trazar(page, LAZO_HOLGADO);
  const ink = await page.evaluate(() => window.__editor.lasso.ink);
  expect(ink).not.toBeNull();
  for (const [v, t] of [
    [ink.top, 250],
    [ink.bottom, 499],
    [ink.left, 200],
    [ink.right, 399],
  ])
    expect(Math.abs(v - t)).toBeLessThanOrEqual(2);
  await expect(page.locator('#edTinta')).toContainText('Tinta detectada');
  expect(ink.dudoso).toBe(false);
  await expect(page.locator('#edCajaOk')).toBeVisible();
  // H30: el ancho resultante en cm, para comprobarlo con la regla (200 × 250 px de tinta, «Alto 10» ⇒ 8,0 cm)
  await page.fill('#edAlto', '10');
  await expect(page.locator('#edTinta')).toContainText(/el dibujo mide (7,9|8,0|8,1) cm de ancho/);
  await page.click('#edBorrar');
  await page.fill('#edAlto', '');
  // 3) recorte con «Alto 10» sin «Medir», colocado el centro a 38 cm del hombro, por fuera
  await recortar(page);
  // H34: la línea «arriba · abajo» del recorte (centro 38, alto 10) y la del resumen bajo la tabla coinciden
  const rango = page.locator('#decals .g-rango');
  await expect(rango).toHaveText('arriba 33,0 · abajo 43,0 cm');
  await expect(page.locator('#resumenGuias')).toContainText(`tatuaje 1: ${await rango.textContent()} (alto 10)`);
  await expect(page.locator('#tatuajes .t-rango').nth(2)).toHaveText('arriba 39,0 · abajo 45,0 cm'); // «Bandas»
  await expect(page.locator('#resumenGuias')).toContainText('Bandas: arriba 39,0 · abajo 45,0 cm (largo 6)');
  await expect(page.locator('#decals .mover')).toHaveAttribute('aria-label', /^Mover /);
  expect(await page.evaluate(() => document.getElementById('updWarn').hidden)).toBe(false); // H28
  await expect(page.locator('#avisoRecortes')).toBeHidden(); // sólo en iOS (donde beforeunload no avisa)
  const px = await page.evaluate(() => ({
    centro: window.__tatPixel(...window.__cmToUV(38, 0)),
    lejos: window.__tatPixel(...window.__cmToUV(20, 0)),
    otroLado: window.__tatPixel(...window.__cmToUV(38, 180)),
  }));
  expect(px.centro[3]).toBeGreaterThan(200);
  expect(px.lejos[3]).toBe(0);
  expect(px.otroLado[3]).toBe(0);
  // pintado con WebGL2 (Chromium lo tiene siempre en CI; WebKit, si lo da)
  const gl2 = await hayWebGL2(page);
  if (browserName === 'chromium') expect(gl2).toBe(true);
  expect(await page.evaluate(() => window.__pintor())).toBe(gl2 ? 'webgl2' : '2d');
  // cm reales de la tinta y marca roja
  await comprobarMedidas(page, gl2 ? 'webgl2' : '2d');
  // la guía azul del recorte existe en la capa de guías
  const guia = await page.evaluate(() => window.__guiaRecorte(0));
  expect(guia.tramos).toBeGreaterThan(40);
  expect(guia.azul).toBeGreaterThan(0);
  // H42: con recortes, las capas se exportan a 4096 px donde cabe (Chromium sí; si no, 2048), todas del mismo tamaño
  const [dlc] = await Promise.all([page.waitForEvent('download'), page.click('#dlCapas')]);
  const zc = leerZip(fs.readFileSync(await dlc.path())),
    tTat = tamPNG(zc['capas/brazo_Ejemplo_tatuaje.png']),
    tGuias = tamPNG(zc['capas/brazo_Ejemplo_guias.png']);
  console.log(`e2e exportación: tatuaje ${tTat.join('×')} px, guías ${tGuias.join('×')} px`);
  expect(tTat).toEqual(tGuias);
  expect([2048, 4096]).toContain(tTat[0]);
  if (browserName === 'chromium') expect(tTat[0]).toBe(4096);
  // la vista previa sigue a 2048 (el recorte se sigue viendo en su sitio)
  expect((await page.evaluate(() => window.__tatPixel(...window.__cmToUV(38, 0))))[3]).toBeGreaterThan(200);
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
  // pellizco con dos dedos (táctil) sobre el recorte: separarlos agranda, girarlos gira el dibujo en pantalla lo mismo
  // y hacia el mismo lado (ángulo en pantalla del eje x del recorte, como angImg en las pruebas unitarias)
  const pin = await page.evaluate(async () => {
    const cv = document.querySelector('canvas.v2d'),
      [x, y] = window.__recorteEnPantalla(0, 0, 0);
    const ev = (t, id, px, py) =>
      cv.dispatchEvent(
        new PointerEvent(t, { pointerId: id, clientX: px, clientY: py, pointerType: 'touch', bubbles: true }),
      );
    const angPantalla = () => {
      const a = window.__recorteEnPantalla(0, -2, 0),
        b = window.__recorteEnPantalla(0, 2, 0);
      return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    };
    const a0 = window.__decals()[0].alto,
      g0 = angPantalla(),
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
    const d = window.__decals()[0],
      [x2, y2] = window.__recorteEnPantalla(0, 0, 0);
    let pantalla = angPantalla() - g0;
    pantalla -= 360 * Math.round(pantalla / 360);
    return { escala: d.alto / a0, giro: d.rot - r0, pantalla, centro: Math.hypot(x2 - x, y2 - y) };
  });
  console.log(
    `e2e pellizco: dedos +15°, dibujo ${pin.pantalla.toFixed(1)}° en pantalla; escala ${pin.escala.toFixed(2)}; ` +
      `el centro se movió ${pin.centro.toFixed(1)} px`,
  );
  expect(pin.escala).toBeGreaterThan(1.3);
  // H36: en la vista plana el dibujo gira lo mismo que los dedos y hacia el mismo lado (antes, 19,9° por 15°); sobre la
  // piel el giro es el que hace falta para eso (la UV no conserva los ángulos)
  expect(Math.abs(pin.pantalla - 15)).toBeLessThan(2);
  expect(Math.abs(pin.giro)).toBeGreaterThan(5);
  expect(pin.centro).toBeLessThan(6); // el punto medio de los dedos no se movió: el recorte tampoco (H28)
  // 5) tono sólo para esta sesión (el siguiente cliente empieza con piel neutra)
  expect(await page.evaluate(() => sessionStorage.getItem('moldeador.tono'))).toBe(tono);
  expect(await page.evaluate(() => localStorage.getItem('moldeador.tono'))).toBe(null);
  // 6) quitar el recorte libera su lienzo (y el contexto WebGL) y el aviso de la versión nueva ya no habla de recortes
  await page.click('#decals .decal button[aria-label^="Quitar"]');
  await expect(page.locator('#decals .decal')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('updWarn').hidden)).toBe(true);
  expect(errs).toEqual([]);
});

test('respaldo 2D (?nogl) y alto marcado a mano: mismas medidas de la tinta y marca roja', async ({ page }) => {
  const errs = vigilarErrores(page);
  await abrirFoto(page, '?debug&nogl');
  await recortar(page, { marcar: true });
  expect(await page.evaluate(() => window.__pintor())).toBe('2d');
  await comprobarMedidas(page, '2d (?nogl)');
  expect(errs).toEqual([]);
});

test('sangrado WebGL de 20 y 160 px: nada en triángulos ajenos (con control sin plantilla), sí fuera de las islas', async ({
  page,
  browserName,
}) => {
  await abrirFoto(page, '?debug');
  const gl2 = await hayWebGL2(page);
  test.skip(!gl2 && browserName !== 'chromium', 'este navegador no da WebGL2');
  expect(gl2).toBe(true);
  await recortar(page);
  const cost = await page.evaluate(() => window.__buscarCostura(0)); // el recorte cruza el borde de una isla UV
  expect(cost.bordes).toBeGreaterThan(10);
  await page.evaluate(() => window.__sangrado(20));
  expect(await page.evaluate(() => window.__pintor())).toBe('webgl2');
  const s20 = await page.evaluate(() => window.__sangradoInfo(0, 300));
  expect(s20.pintados).toBe(0);
  expect(s20.sangrado).toBeGreaterThanOrEqual(5);
  // H37: con 20 px la isla ajena más cercana queda fuera de alcance (≈ 6 sangrados) y la prueba pasaría aunque la
  // plantilla no funcionara: se repite con 160 px, que SÍ llega a otras islas (lo demuestra el control sin plantilla)
  await page.evaluate(() => window.__sangrado(160));
  const s = await page.evaluate(() => window.__sangradoInfo(0, 300));
  console.log(
    `e2e sangrado 160 px (${cost.ang}°, ${s.bordes} aristas de borde): ${s.pintados}/${s.n} triángulos ajenos pintados ` +
      `(${s.cerca} a menos de dos sangrados, ${s.otrasIslas} de otras islas); sangrado fuera de las islas en ${s.sangrado}`,
  );
  expect(s.n).toBeGreaterThanOrEqual(200);
  // H37: la prueba no puede pasar vacía: aristas de borde donde se comprueba que sí hay sangrado, y el control negativo
  // de abajo (sin la plantilla, los mismos triángulos ajenos SÍ se pintan) demuestra que están a su alcance
  expect(s.pintados).toBe(0);
  expect(s.sangrado).toBeGreaterThanOrEqual(5);
  // control negativo: sin la plantilla de las islas y con los mismos 160 px SÍ se pisan triángulos ajenos, así que
  // la prueba de arriba puede fallar si la máscara vuelve a romperse
  await page.evaluate(() => {
    window.__sinPlantilla(true);
    window.__sangrado(160);
  });
  const ctl = await page.evaluate(() => window.__sangradoInfo(0, 300));
  console.log(
    `e2e sangrado sin plantilla (control): ${ctl.pintados}/${ctl.n} triángulos ajenos pintados; el más cercano a ${ctl.dmin.toFixed(1)} sangrados`,
  );
  expect(ctl.pintados).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__sinPlantilla(false);
    window.__sangrado(6);
  });
});

test('foto girada 10° (H29): «⟲ Enderezar» con dos toques → la tinta mide 8 × 10 cm', async ({ page }) => {
  const errs = vigilarErrores(page);
  await abrirFoto(page, '?debug', fotoPNG({ giro: 10 }));
  // dos toques a lo largo del brazo (el eje x = 300 de la escena derecha): primero hacia el hombro, luego hacia la mano
  await page.click('#edEnderezar');
  await expect(page.locator('#edAviso')).toContainText('cerca del hombro');
  await trazar(page, [girar(300, 120, 10)]);
  await expect(page.locator('#edAviso')).toContainText('cerca de la mano');
  await trazar(page, [girar(300, 680, 10)]);
  await expect(page.locator('#edAviso')).toContainText('Foto enderezada');
  await expect(page.locator('#edEnderezar')).toHaveAttribute('aria-pressed', 'false');
  // la foto girada (más grande, con las esquinas transparentes) lleva la escena derecha en su centro
  const g = await page.evaluate(() => ({ w: window.__editor.src.width, h: window.__editor.src.height }));
  const dx = g.w / 2 - FOTO.w / 2,
    dy = g.h / 2 - FOTO.h / 2,
    mover = pts => pts.map(([x, y]) => [x + dx, y + dy]);
  expect(g.w).toBeGreaterThan(FOTO.w);
  // la caja de la tinta vuelve a ser la de la escena derecha (±3 px)
  await page.click('#edTools button[data-t="lazo"]');
  await trazar(page, mover(LAZO_HOLGADO));
  const ink = await page.evaluate(() => window.__editor.lasso.ink);
  console.log(`e2e enderezar: foto ${g.w}×${g.h}, tinta ${JSON.stringify(ink)} (desplazamiento ${dx}, ${dy})`);
  for (const [v, t] of [
    [ink.top, 250 + dy],
    [ink.bottom, 499 + dy],
    [ink.left, 200 + dx],
    [ink.right, 399 + dx],
  ])
    expect(Math.abs(v - t)).toBeLessThanOrEqual(3);
  await page.click('#edBorrar');
  // lazo holgado + «Alto 10» sin «Medir» → lo pintado mide 8 × 10 cm (sin enderezar saldría ≈ 9,4 % más pequeño)
  await recortar(page, { lazo: mover(LAZO_HOLGADO) });
  await comprobarMedidas(page, 'foto girada 10° y enderezada');
  // «Volver al editor» abre la foto ya enderezada (no un lienzo liberado)
  await page.click('#fotoEditar');
  await expect(page.locator('#editor')).toBeVisible();
  expect(await page.evaluate(() => [window.__editor.src.width, window.__editor.src.height])).toEqual([g.w, g.h]);
  await page.click('#edGirar');
  expect(await page.evaluate(() => [window.__editor.src.width, window.__editor.src.height])).toEqual([g.h, g.w]);
  expect(errs).toEqual([]);
});

test('lazo descentrado 30 px hacia arriba (H31): centrado en la tinta, mismas medidas', async ({ page }) => {
  const errs = vigilarErrores(page);
  await abrirFoto(page, '?debug');
  await recortar(page, { lazo: LAZO_ALTO });
  const r = await page.evaluate(() => {
    const dc = window.__decals()[0];
    return { b: dc.inkBox, w: dc.canvas.width, h: dc.canvas.height, tinta: window.__tintaCm(0) };
  });
  console.log(`e2e lazo descentrado: lienzo ${r.w}×${r.h}, tinta ${JSON.stringify(r.b)}`);
  // la tinta en el centro del lienzo (±2 px) y sus bordes a ±5 cm del centro (alto 10)
  expect(Math.abs((r.b.y0 + r.b.y1) / 2 - r.h / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs((r.b.x0 + r.b.x1) / 2 - r.w / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(r.tinta.y0 + 5)).toBeLessThan(0.1);
  expect(Math.abs(r.tinta.y1 - 5)).toBeLessThan(0.1);
  await comprobarMedidas(page, 'lazo descentrado');
  // lo pintado: tinta justo dentro de su borde de arriba (y = −4,8 cm) y piel justo fuera (−5,3 cm), en 5 columnas
  // (sin centrar en la tinta, el borde caería 1,2 cm más abajo)
  const px = await page.evaluate(() =>
    [-3.5, -2.5, -1.5, -0.5, 0.5].map(x => [window.__recortePixel(0, x, -4.8), window.__recortePixel(0, x, -5.3)]),
  );
  expect(px.filter(([dentro]) => lum(dentro) < 100).length).toBeGreaterThanOrEqual(4);
  expect(px.filter(([, fuera]) => fuera[3] < 128 || lum(fuera) > 100).length).toBeGreaterThanOrEqual(4);
  expect(errs).toEqual([]);
});

test('ejemplo del LEEME (H31): existente borde 36 + largo 15 y recorte alto 15 con centro 43,5 → anillos en el borde de la tinta', async ({
  page,
}) => {
  const errs = vigilarErrores(page);
  await abrirFoto(page, '?debug');
  await recortar(page, { alto: 15, d: 43.5 });
  // el mismo tatuaje apuntado en «Tatuajes existentes»: anillos azules a 36 y a 51 cm
  await page.click('#addTat');
  const fila = page.locator('#tatuajes .tat').last();
  await fila.locator('.tn').fill('mismo');
  await fila.locator('.td').fill('36');
  await fila.locator('.tw').fill('15');
  await expect(fila.locator('.t-rango')).toHaveText('arriba 36,0 · abajo 51,0 cm');
  await expect(page.locator('#decals .g-rango')).toHaveText('arriba 36,0 · abajo 51,0 cm');
  const res = {};
  for (const [lado, ang] of [
    ['exterior', 0],
    ['delante', 90],
    ['interior', 180],
  ]) {
    await page.selectOption('#decals .dl', lado);
    res[ang] = await page.evaluate(() => {
      // bordes de la tinta PINTADA en la columna x = −2,5 cm del recorte (fuera del círculo claro): primer y último
      // tramo de al menos 0,3 cm seguidos de tinta (un poro suelto no cuenta)
      const x = -2.5,
        paso = 0.02,
        lum = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2],
        oscuro = y => {
          const p = window.__recortePixel(0, x, y);
          return !!p && p[3] > 128 && lum(p) < 100;
        };
      const tramos = [];
      let ini = null;
      for (let y = -9; y <= 9; y += paso) {
        if (oscuro(y)) ini ??= y;
        else if (ini != null) {
          if (y - ini >= 0.3) tramos.push([ini, y - paso]);
          ini = null;
        }
      }
      const arriba = tramos[0][0],
        abajo = tramos[tramos.length - 1][1];
      return {
        arriba,
        abajo,
        d36: window.__distAnillo(0, 36, x, arriba),
        d51: window.__distAnillo(0, 51, x, abajo),
      };
    });
  }
  console.log(
    'e2e ejemplo del LEEME (distancia anillo ↔ borde de la tinta, mm): ' +
      Object.entries(res)
        .map(([a, v]) => `${a}°: arriba ${(10 * v.d36).toFixed(1)}, abajo ${(10 * v.d51).toFixed(1)}`)
        .join(' · '),
  );
  // por la cara externa (donde se miden las distancias) el anillo pasa a menos de 5 mm del borde de la tinta;
  // delante e interior se registran en el log (no se exigen: la carta y la cinta sólo coinciden exactamente a 0°)
  expect(Math.abs(res[0].arriba + 7.5)).toBeLessThan(0.15);
  expect(Math.abs(res[0].abajo - 7.5)).toBeLessThan(0.15);
  // los anillos siguen las rodajas de la malla y el recorte la carta: junto al codo (36 cm, codo a 32) se separan
  // ≈ 4 mm, más abajo < 1 mm (límite documentado en el LEEME)
  expect(res[0].d36).toBeLessThan(0.5);
  expect(res[0].d51).toBeLessThan(0.5);
  expect(errs).toEqual([]);
});

test('«↔ Desenrollar» en el editor (H33): brazo cilíndrico → 8 cm de ancho ±3 %; el siguiente recorte, sin desenrollar', async ({
  page,
}) => {
  const errs = vigilarErrores(page);
  await abrirFoto(page, '?debug', cilindroPNG());
  const { xc, yc, R } = CIL;
  await page.click('#edTools button[data-t="lazo"]');
  await page.click('#edDesenrollar');
  await trazar(page, [[xc - R + 1, yc]]); // borde izquierdo del brazo, a la altura del tatuaje
  await trazar(page, [[xc + R - 1, yc]]); // y el derecho
  const brazo = await page.evaluate(() => window.__editor.brazo);
  expect(brazo).not.toBeNull();
  expect(Math.abs(brazo[0] - (xc - R + 1))).toBeLessThan(2);
  expect(Math.abs(brazo[1] - (xc + R - 1))).toBeLessThan(2);
  await expect(page.locator('#edBrazoQuitar')).toBeVisible();
  // lazo holgado alrededor del tatuaje (8 cm de arco = ±88,8 px de cuerda; 10 cm = ±125 px)
  await recortar(page, { lazo: elipse(xc, yc, 100, 150) });
  const med = await page.evaluate(() => window.__medirRecorte(0, { tinta: true, x: 0, y: 0 }));
  console.log(
    `e2e desenrollar: tinta ${med.ancho.toFixed(2)} × ${med.alto.toFixed(2)} cm (8 × 10; sin desenrollar ≈ 7,1)`,
  );
  expect(Math.abs(med.ancho - 8) / 8).toBeLessThan(0.03);
  expect(Math.abs(med.alto - 10)).toBeLessThan(0.3);
  // el siguiente recorte de la misma foto empieza sin desenrollar (el radio era el de ESTE tatuaje)
  await page.click('#fotoEditar');
  await expect(page.locator('#editor')).toBeVisible();
  await page.click('#edTools button[data-t="lazo"]');
  expect(await page.evaluate(() => window.__editor.brazo)).toBeNull();
  await expect(page.locator('#edBrazoQuitar')).toBeHidden();
  await expect(page.locator('#edDesenrollar')).toHaveAttribute('aria-pressed', 'false');
  expect(errs).toEqual([]);
});

test('contexto WebGL perdido y recuperado (H39): los recortes y el visor 3D se vuelven a pintar', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'WEBGL_lose_context sólo se prueba en Chromium');
  await abrirFoto(page, '?debug');
  await recortar(page);
  expect(await page.evaluate(() => window.__pintor())).toBe('webgl2');
  expect(await page.evaluate(() => window.__perderContexto())).toBe(true);
  // se creó un contexto nuevo (no se pasó al dibujo 2D) y el recorte sigue pintado en su centro
  expect(await page.evaluate(() => window.__pintor())).toBe('webgl2');
  expect((await page.evaluate(() => window.__tatPixel(...window.__cmToUV(38, 0))))[3]).toBeGreaterThan(200);
  // el visor 3D se repinta solo al recuperar su contexto (sin tocarlo)
  expect(await page.evaluate(() => window.__perderContexto3D())).toBeGreaterThan(0);
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
  test('editor (H38): con el panel de «Recortar» abierto la foto ocupa al menos la mitad del alto visible', async ({
    page,
  }) => {
    await page.goto(S.url + '?debug');
    await lista(page);
    await page.setInputFiles('#fotoGal', archivoFoto());
    await expect(page.locator('#editor')).toBeVisible();
    await page.click('#edTools button[data-t="lazo"]');
    await page.fill('#edAlto', '10');
    const r = await page.evaluate(() => ({
      foto: document.getElementById('edCanvas').getBoundingClientRect().height,
      visible: window.visualViewport ? window.visualViewport.height : innerHeight,
    }));
    console.log(`e2e iPhone: foto ${r.foto.toFixed(0)} px de ${r.visible.toFixed(0)} px visibles`);
    expect(r.foto).toBeGreaterThanOrEqual(0.5 * r.visible - 1);
  });
});
