# Moldeador 3D

Static web tool (Spanish UI) that reshapes a 3D right arm to a client's measurements and exports it for **Procreate 3D** (iPad/iPhone).

- Enter the measurements (cm) → **Moldear** → download **USDZ** (Y up, cm) or **OBJ + MTL + PNG**.
- Skin base layer is painted only inside the arm/hand UV islands (transparent outside).
- Tattoo layer, tattoo-marker guides and measurement guides are exported as separate PNG layers (Procreate imports one base layer per model).
- **📏 Mostrar guías de medición**: pink rings/lines on the 3D preview showing where each field is measured; focusing a field highlights its guide.
- **🗺️ Ver en 2D**: flat UV texture view (skin + tattoo layer + guides + UV island outlines) or orthographic silhouettes of the fitted arm (outer/front/inner/back) with numbered measurements in cm and a 10 cm scale bar; pinch/drag zoom and pan; «Descargar PNG 2D» exports the current 2D view in high resolution.
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
npm test                                       # fit within ±0.3 cm, fuzz (520 seeded inputs), golden USDZ hash
npm run lint && npm run format:check           # ESLint (0 warnings) + Prettier (printWidth 120)
npx playwright install webkit chromium && npm run e2e   # fit → USDZ → reopen, stale downloads, cancel, CSP, offline, SW N→N+1, iPhone touch
python3 -m unittest discover -s tests -p 'test_*.py'    # Python tools read the repo .bin
node tests/make_usdz.mjs out && python3 herramientas/validar_usdz.py out/*.usdz   # usd-core ≥ 26.3
python3 herramientas/version_sw.py --check && python3 herramientas/check_csp.py
```
CI (`.github/workflows/comprobar.yml`) runs all of the above.

## Releasing
Bump the cache version everywhere at once: `python3 herramientas/version_sw.py 7` (rewrites `?v=N`, `moldeador-vN` and `herramientas/.version_hash`).
CI fails if any precached file changed without a version bump.
Navigations are network-first with a 3 s timeout, then the cached copy; versioned assets are cache-first, so old and new files never mix. Open pages show «Nueva versión… Recargar».
Content-Security-Policy is a `<meta>` in `index.html`; if you edit the importmap, update its sha256 hash (`check_csp.py` prints the right one).

## Structure
- `index.html`, `css/app.css`, `js/app.js` (UI), `js/core.js` (fitting math + validation, no DOM), `js/fit-worker.js`, `js/view2d.js`, `js/parts.js` (body-part registry)
- `data/brazo_derecho.{json,bin}` baked base mesh (original UVs)
- `vendor/` three.js r170, OrbitControls, fflate
- `herramientas/` Python helpers (bake a new body part, verify exports; see `herramientas/README.md`, `requirements.txt`)
- `tests/` Node tests
