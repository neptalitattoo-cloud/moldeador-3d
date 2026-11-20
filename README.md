# Moldeador 3D

Static web tool (Spanish UI) that reshapes a 3D right arm to a client's measurements and exports it for **Procreate 3D** (iPad/iPhone).

- Enter the measurements (cm) → **Moldear** → download **USDZ** (Y up, cm) or **OBJ + MTL + PNG**.
- Skin base layer is painted only inside the arm/hand UV islands (transparent outside).
- Tattoo layer, tattoo-marker guides and measurement guides are exported as separate PNG layers (Procreate imports one base layer per model).
- **📏 Mostrar guías de medición**: pink rings/lines on the 3D preview showing where each field is measured; focusing a field highlights its guide.
- **🗺️ Ver en 2D**: flat UV texture view (skin + tattoo layer + guides + UV island outlines) or orthographic silhouettes of the fitted arm (outer/front/inner/back) with numbered measurements in cm and a 10 cm scale bar; pinch/drag zoom and pan; «Descargar PNG 2D» exports the current 2D view in high resolution.
- **Foto del brazo** (📷 *Hacer foto* / 🖼️ *Elegir foto*): an on-device editor (touch + mouse) with
  **💧 Cuentagotas** (averages a small circle of skin, ignoring pores/highlights/shadows; loupe; «Usar este tono» sets the
  skin colour of the whole model, kept for this browser session only — the next client starts neutral), **✂️ Recortar** (lasso around each tattoo, soft-edge slider,
  several cut-outs), **📏 Medir** (optional: draw a line over something of known length to estimate the tattoo height) and
  **✋ Mover**. «Alto» is the height of what you traced with the lasso (not the soft edge). Each cut-out is placed by
  «Desde hombro» (cm from the shoulder tip to its centre, along the outer line where lengths are measured), side
  (exterior/delante/interior/detrás or any angle), height in cm and rotation, or by dragging (what you grab stays under
  your finger) / pinching it in the 2D flat view. It is wrapped around the fitted arm with a surface chart measured on the
  fitted mesh (real arc length around each cross-section and real length down the arm, full 360° wrap, down to ~3–4 cm
  past the wrist) and painted with WebGL2 (2D-canvas fallback) into the tattoo layer, with a 6 px bleed outside the UV
  islands so seams don't show. Photos never leave the device and are not saved (reloading loses them; the page warns).
  Measured accuracy (unit tests, 8 × 10 cm cut-out on the fitted example): within ±0.8 % (≈ 1 mm) unrotated on upper arm,
  forearm and wrist on all sides including across the UV seam; up to ±5.2 % when rotated 30–90°.
- Hand: **10. Contorno nudillos** is a tape *around* the hand at the knuckles without the thumb (15–32 cm, the yellow ring
  in the 3D guides); empty → ≈ 1.04 × wrist, kept within 15–32 cm. Warnings if it looks like a width (< 0.9 × wrist) or
  is too wide for the hand length.
- 100 % client-side (three.js, fflate vendored), works offline after the first visit (service worker).
- The form starts empty (public site); **Cargar ejemplo** fills sample measurements.
- Fitting runs in a module Web Worker (`js/fit-worker.js`), with a synchronous fallback; the 3D view renders on demand only.
- Inputs are validated (`K.validateInputs`, Spanish messages); any NaN/Infinity is rejected before export; USD prim names are sanitised (`brazo_Ana-María` → `/brazo_Ana_Maria`).
- On iPhone/iPad, downloads open the share sheet (Procreate, Files) via a second tap; elsewhere they download directly. Exports are disabled when measurements change after fitting.

## Run locally
```
python3 -m http.server 8000
# open http://localhost:8000/
```

## GitHub Pages
Push this folder as the repository root (or `/docs`) and enable *Settings → Pages → Deploy from branch*. All paths are relative and `.nojekyll` is included.

## Tests
```
npm ci
npm test                                       # fit within ±0.3 cm, fuzz (520 seeded inputs), golden USDZ hash,
                                               # colour picker, soft edge, cm → UV placement (not mirrored),
                                               # REAL cm on the fitted mesh (±2 % unrotated, ±6 % rotated, UV seam,
                                               # 360° wrap), drag keeps the grabbed point under the finger (±1 mm),
                                               # pinch rotates the same way, knuckle tapes 15–32 cm reach ±0.3 cm
npm run lint && npm run format:check           # ESLint (0 warnings) + Prettier (printWidth 120)
npx playwright install webkit chromium && npm run e2e   # fit → USDZ → reopen, stale downloads, cancel, CSP, offline, SW N→N+1, iPhone touch,
                                               # photo: eyedropper → lasso → place → painted size 8 × 10 cm (±3 %),
                                               # not mirrored, guide outline, drag follows the pointer, pinch, EXIF JPEG
python3 -m unittest discover -s tests -p 'test_*.py'    # Python tools read the repo .bin
node tests/make_usdz.mjs out && python3 herramientas/validar_usdz.py out/*.usdz   # usd-core ≥ 26.3
python3 herramientas/version_sw.py --check && python3 herramientas/check_csp.py
ruff format --check . && ruff check .                # Python tools style
```
CI (`.github/workflows/comprobar.yml`) runs all of the above.

## Releasing
Bump the cache version everywhere at once: `python3 herramientas/version_sw.py 9` (rewrites `?v=N` in every local file, including
`vendor/` through the importmap, `moldeador-vN`, the importmap's CSP hash and `herramientas/.version_hash`).
It refuses to reuse the same (or a lower) N once a precached file changed (`--force` overrides).
CI fails if a precached file changed without a version bump, both against the stored hash and against the state before
the push (`version_sw.py --check-git <github.event.before>`, `HEAD~1` for pull requests / new branches), and if a `js/*.js`
module is missing from the service worker's `FILES`.
Navigations are network-first with a 3 s timeout, then the cached copy; versioned assets are cache-first, so old and new files never mix. Open pages show «Nueva versión… Recargar».
Content-Security-Policy is a `<meta>` in `index.html`; if you edit the importmap, update its sha256 hash (`check_csp.py` prints the right one).

## Structure
- `index.html`, `css/app.css`, `js/app.js` (UI), `js/core.js` (fitting math + validation, no DOM), `js/fit-worker.js`, `js/view2d.js`, `js/parts.js` (body-part registry),
  `js/editor.js` (photo editor), `js/foto.js` (colour picking, soft mask, surface chart / decal placement and on-mesh
  measurement, no DOM), `js/decalgl.js` (WebGL2 decal painter with UV-island bleed)
- `data/brazo_derecho.{json,bin}` baked base mesh (original UVs)
- `vendor/` three.js r170, OrbitControls, fflate
- `herramientas/` Python helpers (bake a new body part, verify exports; see `herramientas/README.md`, `requirements.txt`)
- `tests/` Node tests
