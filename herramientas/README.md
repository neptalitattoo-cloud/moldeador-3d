# Herramientas (Python)

No hacen falta para usar la web; sirven para regenerar la malla base y comprobar las exportaciones.

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r herramientas/requirements.txt
```

| Script | Qué hace |
|---|---|
| `web_check.py OBJ.zip modelo.usdz` | Comprobación independiente de un OBJ/USDZ exportado por la web (medidas, topología, alineación del ZIP). Usa la malla base del repo. |
| `web_bake.py` | Hornea `data/brazo_derecho.json/.bin` desde un OBJ fuente (`MOLDEADOR_SRC_OBJ=/ruta/al.obj`). El OBJ fuente no se publica. |
| `split_layers.py textura.png salida/` | Separa una textura pintada en piel (solo islas UV) y capa de tatuaje. |
| `usdz_writer.py` | Escritor USDZ con `pxr` (referencia). |
| `version_sw.py` | Sube la versión de caché (`?v=N` y `moldeador-vN`) en todos los archivos a la vez. |

`lib/` contiene los módulos compartidos (`fit_measures`, `hand_measure`, `objio`).
