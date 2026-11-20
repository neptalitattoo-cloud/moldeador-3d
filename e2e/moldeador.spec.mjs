import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import { sitio, lista, moldear, vigilarErrores } from './sitio.mjs';

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
  });
});
