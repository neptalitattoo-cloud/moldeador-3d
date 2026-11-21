# Moldeador 3D

Static web tool (Spanish UI) that reshapes a 3D right arm to a client's measurements and exports it for **Procreate 3D** (iPad/iPhone).

- Enter the measurements (cm) → **Moldear** → download **USDZ** (Y up, cm) or **OBJ + MTL + PNG**.
- Skin base layer is painted only inside the arm/hand UV islands (transparent outside).
- «Tatuajes existentes» are guide rings only: «Borde de arriba» is the tattoo's top edge and «Largo» its length along the arm toward the wrist (labelled «Ancho» before v12 and «Desde hombro» before v13; the number keeps the same meaning), so the two blue rings sit at top and top + length. Photo cut-outs use the tattoo's «Centro» instead (see below); every row and card shows «arriba X · abajo Y cm» and the summary uses the same numbers.
- Tattoo layer, tattoo-marker guides and measurement guides are exported as separate PNG layers (Procreate imports one base layer per model).
- **📏 Mostrar guías de medición**: pink rings/lines on the 3D preview showing where each field is measured; focusing a field highlights its guide.
- **🗺️ Ver en 2D**: flat UV texture view (skin + tattoo layer + guides + UV island outlines) or orthographic silhouettes of the fitted arm (outer/front/inner/back) with numbered measurements in cm and a 10 cm scale bar; pinch/drag zoom and pan; «Descargar PNG 2D» exports the current 2D view in high resolution.
- **Foto del brazo** (📷 *Hacer foto* / 🖼️ *Elegir foto*): an on-device editor (touch + mouse) with
  **💧 Cuentagotas** (averages a small circle of skin, ignoring pores/highlights/shadows; loupe; «Usar este tono» sets the
  skin colour of the whole model, kept for this browser session only — the next client starts neutral), **✂️ Recortar** (lasso around each tattoo, soft-edge slider,
  several cut-outs), **📏 Medir** (optional: draw a line over something of known length to estimate the tattoo height) and
  **✋ Mover**. «Alto» is the height of the *ink* (top to bottom of the drawing), not of everything the lasso
  surrounds: the ink box is detected inside the lasso (rows where > 10 % of the pixels differ from the skin tone measured
  just outside the lasso; shown as a blue box), or marked by hand with **📏 Marcar el alto** (two taps above and below
  the ink); if no ink can be told apart, the lasso height is used and the editor says so. **↔ Desenrollar** fixes photos
  of a curved arm: tap the left and right edges of the arm at the tattoo's height and the cut-out is resampled column by
  column so its width is the arc on the skin, not the chord seen by the camera (an 8 cm tattoo on a 25 cm forearm
  otherwise comes out ~16 % narrower); the editor suggests it for wide cut-outs. Each cut-out is placed by
  «Centro» (cm from the shoulder tip to the centre of the ink, along the outer line where lengths are measured), side
  (exterior/delante/interior/detrás or any angle), height in cm and rotation, or by dragging (what you grab stays under
  your finger) / pinching it in the 2D flat view. It is wrapped around the fitted arm with a surface chart measured on the
  fitted mesh (real arc length around each cross-section and real length down the arm, full 360° wrap, down to ~3–4 cm
  past the wrist) and painted with WebGL2 (2D-canvas fallback) into the tattoo layer, with a 6 px bleed outside the UV
  islands so seams don't show (the UV-island stencil really is written since v10, so the bleed never paints over a
  neighbouring island). If the WebGL context is lost (iOS app switch) a new one is created; after repeated failures it
  falls back to 2D and says so once; the WebGL memory is released when the last cut-out is removed. Photos never leave
  the device and are not saved (reloading loses them; the page warns, and on iOS — where `beforeunload` never shows — a
  small fixed note «Los recortes no se guardan al recargar» stays visible while there are cut-outs).
  Measured accuracy (unit tests, 8 × 10 cm cut-out on the fitted example): within ±0.8 % (≈ 1 mm) unrotated on upper arm,
  forearm and wrist on all sides including across the UV seam; up to ±5.2 % when rotated 30–90°. v10 tests also check the
  whole shape, not just the axes (upper arm / lower forearm: edges ≤ 1.3 %, diagonals ≤ 4.8 %; next to the elbow: edges
  3.3 %, diagonals 6.9 %; deltoid: edges 3.8 %, diagonals 5.1 % — the skin twists there, so a square becomes slightly
  rhomboid; front/back of the shoulder cap above the armpit is up to ≈ 23 % off), a full-wrap band on the tapering lower forearm (its straight
  edge stays a ring, ±3 mm) and that the grabbed point stays under the finger within 1 mm measured in 3D.
- Hand: **10. Contorno nudillos** is a tape *around* the hand at the knuckles without the thumb (15–32 cm, the yellow ring
  in the 3D guides); empty → ≈ 1.04 × wrist, kept within 15–32 cm. Warnings if it looks like a width (< 0.9 × wrist) or
  is too wide for the hand length.
- 100 % client-side (three.js, fflate vendored), works offline after the first visit (service worker).
- The form starts empty (public site); **Cargar ejemplo** fills sample measurements.
- Fitting runs in a module Web Worker (`js/fit-worker.js`), with a synchronous fallback; the 3D view renders on demand only.
- Inputs are validated (`K.validateInputs`, Spanish messages); any NaN/Infinity is rejected before export; USD prim names are sanitised (`brazo_Ana-María` → `/brazo_Ana_Maria`).
- On iPhone/iPad, downloads open the share sheet (Procreate, Files) via a second tap; elsewhere they download directly. Exports are disabled when measurements change after fitting.

- Photo editor on iPhone: the tool panel scrolls (max 42 % of the screen) and the photo re-fits when the panel changes
  height (never mid-stroke, never after a manual zoom).

## v13 (Opus v12 audit)

- **⟲ Enderezar / ↻ Girar 90°** in the photo editor: two taps along the arm rotate the photo so the arm is vertical, shoulder up (a 10° tilt used to shrink the tattoo ≈ 9 %).
- Ink box: per-column skin tone, despeckled absolute ink counts (thin stems and letters are kept), width shown in cm, and the blue box must be confirmed (or the height marked) before adding.
- Cut-outs are centred on the ink, and the blue guide (also exported) fits the ink.
- Distortion warning on the card when the drawing's edges or diagonals deviate > 5 % on the 3D arm (`decalStretch`).
- «Desenrollar» resets after each cut-out; Medir keeps full precision; 2D pinch rotates like the fingers; bleed test with a negative control; 3D redraw after WebGL context loss; 4096 px export where possible (2048 on iPhone).
- `vendor/LICENSES.md`, a `.gitignore` and a CI step that keep photos out of this public repo.

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
                                               # colour picker, soft edge, cm → UV placement checked against the
                                               # measurement tape (not the chart), REAL cm on the fitted mesh (±2 %
                                               # unrotated, ±6 % rotated, edges ±3 % / diagonals ±4 % incl. deltoid,
                                               # UV seam, 360° wrap, full band on the tapering forearm), drag keeps the
                                               # grabbed point under the finger (< 1 mm in 3D), pinch rotates the same
                                               # way, chart on extreme bodies, ink rows (H9), unrolling a cylinder grid
                                               # (8 cm ± 3 %), knuckle tapes 15–32 cm reach ±0.3 cm, loose timing
npm run lint && npm run format:check           # ESLint (0 warnings) + Prettier (printWidth 120)
npx playwright install webkit chromium && npm run e2e   # fit → USDZ → reopen, stale downloads, cancel, CSP, offline, SW N→N+1, iPhone touch,
                                               # photo: eyedropper → LOOSE lasso → «Alto 10» without «Medir» → painted
                                               # ink 8 × 10 cm (±0.3 cm), not mirrored, guide outline, WebGL2 required in
                                               # Chromium (`__pintor`), same checks with the 2D fallback (`?nogl`) and a
                                               # hand-marked height, 20 px bleed never paints foreign UV triangles,
                                               # drag follows the pointer, pinch ≈ +15° the fingers' way, EXIF JPEG
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
