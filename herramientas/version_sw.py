#!/usr/bin/env python3
"""Versión de caché del service worker.

  python3 herramientas/version_sw.py 6      escribe ?v=6 y 'moldeador-v6' en todos los archivos
                                            y guarda en herramientas/.version_hash el hash de los archivos de FILES
  python3 herramientas/version_sw.py --check  (CI) falla si las versiones no coinciden entre archivos o si
                                            algún archivo precacheado cambió sin subir la versión
"""
import hashlib, pathlib, re, sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
HASH_FILE = RAIZ / 'herramientas' / '.version_hash'
CON_VERSION = ['sw.js', 'index.html', 'js/app.js', 'js/fit-worker.js', 'js/view2d.js', 'js/parts.js']


def versiones():
    vs = set()
    for f in CON_VERSION:
        t = (RAIZ / f).read_text(encoding='utf-8')
        vs |= set(re.findall(r'\?v=(\d+)', t)) | set(re.findall(r'moldeador-v(\d+)', t))
    return vs


def huella():
    """sha256 de los archivos precacheados (FILES de sw.js, más el propio sw.js), sin los números de versión."""
    sw = (RAIZ / 'sw.js').read_text(encoding='utf-8')
    lista = re.search(r'const FILES = \[(.*?)\];', sw, re.S).group(1)
    nombres = sorted({x.split('?')[0] for x in re.findall(r"'([^']+)'", lista) if x != './'} | {'sw.js'})
    h = hashlib.sha256()
    for f in nombres:
        datos = (RAIZ / f).read_bytes().replace(b'\r\n', b'\n')
        datos = re.sub(rb'\?v=\d+', b'?v=N', datos)
        datos = re.sub(rb'moldeador-v\d+', b'moldeador-vN', datos)
        h.update(f.encode() + b'\0' + datos + b'\0')
    return h.hexdigest()


if __name__ == '__main__':
    if '--check' in sys.argv:
        vs = versiones()
        if len(vs) != 1:
            sys.exit(f'Versiones distintas entre archivos: {sorted(vs)}')
        n = vs.pop()
        guardado = HASH_FILE.read_text().split() if HASH_FILE.exists() else ['', '']
        actual = huella()
        if guardado == [n, actual]:
            print(f'OK: versión {n}, hash {actual[:12]}')
            sys.exit(0)
        if guardado[0] == n:
            sys.exit(f'Los archivos precacheados cambiaron pero la versión sigue en {n}: '
                     f'ejecuta  python3 herramientas/version_sw.py {int(n) + 1}')
        sys.exit(f'herramientas/.version_hash no corresponde a la versión {n}: ejecuta  python3 herramientas/version_sw.py {n}')
    n = sys.argv[1]
    for f in CON_VERSION:
        p = RAIZ / f
        t = p.read_text(encoding='utf-8')
        t = re.sub(r'\?v=\d+', f'?v={n}', t)
        t = re.sub(r'moldeador-v\d+', f'moldeador-v{n}', t)
        p.write_text(t, encoding='utf-8', newline='\n')
    HASH_FILE.write_text(f'{n} {huella()}\n')
    print('versión', n, 'escrita en', ', '.join(CON_VERSION), '+ herramientas/.version_hash')
