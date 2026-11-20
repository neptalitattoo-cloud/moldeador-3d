#!/usr/bin/env python3
"""Sube (o comprueba) la versión de caché en todos los archivos a la vez.
   python3 herramientas/version_sw.py 6     -> escribe ?v=6 y 'moldeador-v6'
   python3 herramientas/version_sw.py --check -> falla si las versiones no coinciden entre archivos."""
import pathlib, re, sys
raiz = pathlib.Path(__file__).resolve().parent.parent
archivos = ['sw.js', 'index.html', 'js/app.js', 'js/fit-worker.js', 'js/view2d.js', 'js/parts.js']
def versiones():
    vs = set()
    for f in archivos:
        t = (raiz / f).read_text(encoding='utf-8')
        vs |= set(re.findall(r'\?v=(\d+)', t)) | set(re.findall(r"moldeador-v(\d+)", t))
    return vs
if '--check' in sys.argv:
    vs = versiones(); print('versiones:', vs); sys.exit(0 if len(vs) == 1 else 'Versiones distintas entre archivos')
n = sys.argv[1]
for f in archivos:
    p = raiz / f; t = p.read_text(encoding='utf-8')
    t = re.sub(r'\?v=\d+', f'?v={n}', t); t = re.sub(r'moldeador-v\d+', f'moldeador-v{n}', t)
    p.write_text(t, encoding='utf-8', newline='\n')
print('versión', n, 'escrita en', ', '.join(archivos))
