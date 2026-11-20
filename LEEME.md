# Moldeador 3D — brazo derecho

Web estática (HTML + JS, sin servidor). Escribes las medidas del cliente, pulsas **Moldear** y descargas el brazo en **USDZ** (Procreate 3D, Y arriba, cm) o en **OBJ + MTL + PNG** (zip).

## Cómo funciona
1. Malla base: brazo limpio original (49.314 vértices, UV original intacto). La capa base es piel neutra SOLO dentro de las islas UV (silueta del brazo y las manos) con 6 px de sangrado y transparente fuera; o tu propia capa base.
2. Largos: se remapea por tramos el eje del brazo (curva PCHIP monótona, nunca pliega) hasta que la cinta medida por la cara externa desde la punta del hombro da hombro→codo y hombro→muñeca exactos.
3. Contornos: factor radial suave a lo largo del eje (perfil PCHIP entre axila, mitad bíceps, codo, mitad antebrazo y muñeca) con 8 pasadas de corrección densa + 4 de afinado por estaciones.
4. Mano: largo = 0,79 × antebrazo, ancho nudillos = 0,45 × largo, contorno nudillos = máx(1,04 × muñeca; 2,4 × ancho). Escalado anisótropo en el marco de la mano con transición smoothstep de 0,3 a 3 cm después de la muñeca. Si escribes largo de mano o ancho de nudillos se usan tus valores.
5. Capas: Procreate importa una sola capa base por modelo, así que la piel va en el USDZ y las guías de tatuajes existentes y la capa de tatuaje (PNG transparente que subes) se descargan como PNG aparte del mismo tamaño, para insertarlas como capas nuevas en «Mostrar textura 2D». Opción para fundir las guías en la capa base.
6. Comprobación: tabla objetivo/resultado y conteo de caras invertidas.

## Archivos
- `index.html`, `css/`, `js/core.js` (matemáticas, sin DOM), `js/app.js` (interfaz), `js/parts.js` (registro de partes del cuerpo)
- `data/brazo_derecho.{json,bin}` malla base horneada; `vendor/` three.js r170, OrbitControls, fflate
- `sw.js` + `manifest.webmanifest`: funciona sin conexión y se puede añadir a la pantalla de inicio
- `herramientas/web_bake.py` (hornear una parte nueva), `herramientas/web_check.py` (verificación en Python)

## Añadir otra parte del cuerpo
Hornear la malla con `web_bake.py` (eje, estaciones, línea externa) y declararla en `js/parts.js`.

## Guías de medición
Botón «📏 Mostrar guías de medición» sobre la vista 3D: anillos rosas en cada contorno (4–8), línea por la cara externa para los largos (1–3), línea de la mano (9) y anillo de nudillos (10), con números iguales a los de la ficha. Al tocar un campo se resalta en amarillo su guía y aparece dónde medir. Las guías de tatuajes existentes son azules y tienen su propio interruptor. En la exportación las guías de medición van apagadas; opción para descargarlas como capa PNG aparte.

## GitHub Pages
Todas las rutas son relativas y hay `.nojekyll`: basta subir esta carpeta como raíz del repositorio (o /docs) y activar Pages.
