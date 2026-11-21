# Moldeador 3D — brazo derecho

Web estática (HTML + JS, sin servidor). Escribes las medidas del cliente, pulsas **Moldear** y descargas el brazo en **USDZ** (Procreate 3D, Y arriba, cm) o en **OBJ + MTL + PNG** (zip).

## Cómo funciona
1. Malla base: brazo limpio original (49.314 vértices, UV original intacto). La capa base es piel neutra SOLO dentro de las islas UV (silueta del brazo y las manos) con 6 px de sangrado y transparente fuera; o tu propia capa base.
2. Largos: se remapea por tramos el eje del brazo (curva PCHIP monótona, nunca pliega) hasta que la cinta medida por la cara externa desde la punta del hombro da hombro→codo y hombro→muñeca exactos.
3. Contornos: factor radial suave a lo largo del eje (perfil PCHIP entre axila, mitad bíceps, codo, mitad antebrazo y muñeca) con 8 pasadas de corrección densa + 4 de afinado por estaciones.
4. Mano: largo = 0,79 × antebrazo; contorno nudillos (medida 10, cinta alrededor de la mano sin el pulgar) = máx(1,04 × muñeca; 2,4 × ancho típico), siempre entre 15 y 32 cm; el ancho de la sección se deduce del contorno (contorno ÷ 2,45). Escalado anisótropo en el marco de la mano con transición smoothstep de 0,3 a 3 cm después de la muñeca. Si escribes largo de mano o contorno de nudillos se usan tus valores (v8: la medida 10 es el **contorno** de nudillos, 15–32 cm, cinta alrededor de la mano sin el pulgar; antes era «ancho»). Avisa si el contorno parece un ancho (menor que 0,9 × muñeca) o si la mano sale demasiado ancha para su largo.
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

## Vista 2D
Botón «🗺️ Ver en 2D» junto al de guías. Dos modos:
- **Textura plana**: el mapa UV como en Procreate (Acciones › 3D › Mostrar textura 2D) con la piel, la capa de tatuaje, las guías azules, los contornos de las islas UV y, si están activadas, las guías rosas de medición (el campo que tocas se resalta en amarillo).
- **Siluetas**: el brazo ajustado visto de exterior, frente, interior y espalda (proyección ortográfica, sin perspectiva) con los contornos, largos, mano y nudillos numerados y en cm, más una barra de escala de 10 cm. Pensado para imprimir como referencia.

Arrastra para mover, pellizca o usa la rueda para hacer zoom y toca dos veces para encajar. «⬇ Descargar PNG 2D» guarda la vista actual en alta resolución (textura al tamaño de la textura; siluetas a 28 px/cm).

## Novedades v5 (auditoría)
- El formulario empieza vacío (la web es pública); «Cargar ejemplo» rellena unas medidas de muestra.
- Se validan todas las medidas (mensajes en español) y nunca se exporta un modelo con valores no numéricos. Los nombres con guion o acentos («Ana-María») exportan bien.
- El moldeado va en segundo plano (Web Worker): la página no se congela. El visor 3D sólo dibuja cuando algo cambia (menos batería).
- En iPhone/iPad, al descargar aparece «📤 Enviar a…» para mandarlo directo a Procreate o a Archivos.
- Si cambias una medida después de moldear, las descargas se desactivan hasta que vuelvas a moldear.
- Texturas limitadas a 2048 px en iPhone y escaladas manteniendo la proporción, para no agotar la memoria de Safari.
- Funciona sin conexión; cuando hay una versión nueva aparece «Nueva versión… Recargar».


## Foto del brazo (v8, mejorada en v9)
1. En «Foto del brazo» toca 📷 *Hacer foto* (o 🖼️ *Elegir foto*). La foto no sale del dispositivo ni se guarda.
2. 💧 *Cuentagotas*: toca la piel con buena luz (no en brillos ni sombras) → «Usar este tono». El tono se aplica a todo el modelo y se recuerda sólo mientras la pestaña esté abierta (el siguiente cliente empieza con piel neutra). Si usas una «Capa base propia», el tono no se ve.
3. ✂️ *Recortar*: rodea el tatuaje con el dedo (no hace falta ir pegado) y escribe el alto real en cm de la **tinta**, de arriba abajo del dibujo. La app busca sola dónde empieza y acaba la tinta dentro del lazo (caja azul) y aplica el alto ahí, no al hueco de piel que deja el dedo. Si la caja no cuadra, toca 📏 *Marcar el alto* y luego arriba y abajo de la tinta (o traza la línea): manda lo marcado. También puedes usar 📏 *Medir* sobre algo de largo conocido (la medida se conserva mientras sigas con la misma foto) y el alto se calcula solo. Ajusta el borde suave y toca «Añadir recorte». Puedes añadir varios.
   - **↔ Desenrollar** (tatuajes que rodean parte del brazo): en la foto, lo que da la vuelta al brazo se ve en línea recta de borde a borde, más estrecho que sobre la piel (un tatuaje de 8 cm en un antebrazo de 25 cm sale un 16 % más estrecho, y más comprimido en los bordes). Toca «↔ Desenrollar» y luego el borde izquierdo y el derecho del brazo a la altura del tatuaje (líneas verdes): el recorte se estira por columnas para que su ancho sea el arco sobre la piel. El alto no cambia. «✕ Quitar desenrollar» lo borra. Si el recorte es ancho (≈ 5 cm o más) y no lo usas, el editor te lo recuerda.
4. Toca «Listo» y, en la ficha del recorte, escribe «Desde hombro» (cm desde la punta del hombro hasta el centro del tatuaje) y el lado (exterior, delante, interior, detrás u otro ángulo) y el giro.
5. Afina con «✋ Mover en 2D»: arrastra el recorte en la textura plana (lo que agarras se queda bajo el dedo); si empiezas fuera del recorte mueves la vista. Pellizca sobre el recorte para el tamaño y gira con dos dedos.
6. Descarga como siempre: el tatuaje va en la capa PNG de tatuaje (o dentro de la capa base si marcas «Fundir»).

## Novedades v9 (auditoría)
- **Medidas reales**: el recorte se envuelve con una carta medida sobre el brazo ya ajustado (arco real alrededor de cada sección y largo real hacia la mano). Pruebas automáticas: un recorte de 8 × 10 cm mide 8 × 10 cm en la piel con error ≤ 0,8 % (≈ 1 mm) sin girar, en brazo, antebrazo y muñeca, por todos los lados y cruzando la costura de la UV; girado 30–90°, hasta ±5,2 % (lo que da la CI).
- «Alto» es el de lo que rodeas (antes contaba también el margen del borde suave y salía más pequeño).
- Da la vuelta completa al brazo (360°) y llega hasta unos 3–4 cm pasada la muñeca; más allá avisa y se corta.
- Arrastrar ya no se pierde: el punto agarrado sigue al dedo. Pellizcar gira hacia el mismo lado que los dedos.
- Pintado con WebGL (más rápido) y sin líneas en las costuras (6 px de sangrado fuera de las islas UV).
- Editor: el foco entra y vuelve al cerrar, se libera la memoria de la foto al cerrar, fotos con giro EXIF del iPhone se ven derechas.
- Aviso al recargar si hay recortes (no se guardan).

## Novedades v10 (auditoría)
- **Alto de la tinta (H9)**: el alto que escribes se aplica a la tinta, no a todo lo rodeado. Dentro del lazo se detecta dónde empieza y acaba la tinta (filas con más de un 10 % de píxeles lejos del tono de la piel, medido justo por fuera del lazo) y se dibuja la caja azul; si no se distingue, se usa el alto del trazo y se avisa. «📏 Marcar el alto» (dos toques arriba y abajo de la tinta) manda sobre lo detectado. La prueba e2e usa un lazo holgado (25 px de piel arriba y abajo) y «Alto 10» sin «Medir», y exige que la tinta pintada mida 10 ± 0,3 cm de alto y 8 ± 0,3 cm de ancho en la malla.
- **↔ Desenrollar (H22)**: corrige la foto de un brazo curvo para que el ancho sea el arco sobre la piel (ver el punto 3 de arriba). Prueba: una cuadrícula vista en un cilindro mide 8 cm ± 3 % de arco tras desenrollar (sin desenrollar, ≈ 6,7 cm).
- **Sangrado limitado de verdad (H23)**: la plantilla (stencil) de las islas UV ya se escribe, así que el sangrado de 6 px sólo pinta fuera de las islas: nunca encima de otra isla cercana. Una prueba e2e con 20 px de sangrado comprueba que no se pinta ningún triángulo ajeno.
- **Estrechamiento del brazo (H25)**: en la vuelta completa del antebrazo bajo ya no hay pellizco en la costura y el borde recto de un brazalete queda como un anillo (misma altura delante y detrás, ±3 mm). Lo que se agarra con el dedo queda debajo con error < 1 mm también lejos del centro.
- **Pruebas más exigentes (H24)**: la posición se compara con la cinta de las medidas (no con la propia carta), el arrastre se mide en 3D sobre la malla, se mide la forma completa del 8 × 10 (bordes y diagonales, no sólo los ejes): en el brazo y el antebrazo bajo, bordes ≤ 1,3 % y diagonales ≤ 4,8 %; junto al codo, bordes 3,3 % y diagonales 6,9 %; en el deltoides (exterior y ±45°), bordes 3,8 % y diagonales 5,1 %, la carta se prueba con cuerpos extremos, y el e2e comprueba si se pinta con WebGL2 o con el respaldo 2D (`?nogl`) y que el pellizco gira ≈ 15° hacia el lado de los dedos.
- **Rendimiento (H26)**: descarte rápido de triángulos, contornos guardados, búsqueda por rejilla y, en la vista 2D, la textura del 3D sólo se rehace al volver al 3D.
- **WebGL en iOS (H27)**: si el navegador da un búfer más pequeño se usa el dibujo 2D; al quitar el último recorte se suelta la memoria de WebGL; si se pierde el contexto (salir a otra app) se crea uno nuevo, y si hay que pasar al dibujo 2D se avisa una vez.
- **«Desde hombro» exacto también en el hombro**: la distancia se ajusta a la cinta de las medidas rodaja a rodaja (antes, a 8 cm del hombro se desviaba 3 mm).
- **Límites que quedan**: junto al codo y en el deltoides la piel se tuerce y un cuadrado sale ligeramente romboide (diagonales hasta ≈ 7 %); delante y detrás del hombro, por encima de la axila, el error sube al 15–20 %. En brazos cortos o muñecas muy gruesas los recortes llegan justo hasta la muñeca, no más allá.
- **Gestos y detalles (H28)**: el pellizco mueve el recorte con el punto medio de los dedos; si tras el pellizco el dedo que queda no está sobre un recorte, mueve la vista; con el Apple Pencil se ignora la palma; una línea de «Medir» cancelada no estropea la calibración anterior; en iOS (donde no hay aviso al recargar) se ve «Los recortes no se guardan al recargar» mientras haya recortes; el aviso de versión nueva se actualiza al añadir o quitar recortes; el cuentagotas sólo anuncia el color al soltar.
