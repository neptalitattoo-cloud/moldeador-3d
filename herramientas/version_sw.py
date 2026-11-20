#!/usr/bin/env python3
"""Versión de caché del service worker (ver README).

python3 herramientas/version_sw.py 7
    Escribe ?v=7 y 'moldeador-v7' en todos los archivos (también en vendor/ a través del importmap),
    actualiza el hash de la CSP del importmap y guarda la huella en herramientas/.version_hash.
    Se niega a reutilizar la misma versión (o una menor) si algún archivo precacheado cambió; --force lo permite.
python3 herramientas/version_sw.py --check
    (CI) Falla si las versiones no coinciden entre archivos o si algo precacheado cambió sin subir la versión.
python3 herramientas/version_sw.py --check-git HEAD~1
    (CI) Falla si, respecto a ese commit, cambió algún archivo precacheado y la versión es la misma.
--root DIR   trabaja sobre otra copia del sitio (lo usan los e2e para simular N → N+1).
"""

import base64
import hashlib
import pathlib
import re
import subprocess
import sys

CON_VERSION_FIJOS = ['sw.js', 'index.html']


def con_version(raiz):
    # todos los módulos de js/ (los nuevos también) llevan ?v=N en sus importaciones
    return CON_VERSION_FIJOS + sorted(str(p.relative_to(raiz)) for p in (raiz / 'js').glob('*.js'))


RE_V = re.compile(r'\?v=(\d+)')
RE_CACHE = re.compile(r'moldeador-v(\d+)')
RE_IMPORTMAP = re.compile(r'<script type="importmap">(.*?)</script>', re.S)
RE_CSP_HASH = re.compile(r"'sha256-[A-Za-z0-9+/=]+'")


def versiones(raiz):
    vs = set()
    for f in con_version(raiz):
        t = (raiz / f).read_text(encoding='utf-8')
        vs |= set(RE_V.findall(t)) | set(RE_CACHE.findall(t))
    return vs


def version_actual(raiz):
    vs = versiones(raiz)
    if len(vs) != 1:
        sys.exit(f'Versiones distintas entre archivos: {sorted(vs)}')
    return int(vs.pop())


def precacheados(sw_texto):
    lista = re.search(r'const FILES = \[(.*?)\];', sw_texto, re.S).group(1)
    return sorted({x.split('?')[0] for x in re.findall(r"'([^']+)'", lista) if x != './'} | {'sw.js'})


def huella(raiz):
    """sha256 de los archivos precacheados (y sw.js), sin números de versión ni el hash de la CSP."""
    h = hashlib.sha256()
    for f in precacheados((raiz / 'sw.js').read_text(encoding='utf-8')):
        datos = (raiz / f).read_bytes().replace(b'\r\n', b'\n')
        datos = re.sub(rb'\?v=\d+', b'?v=N', datos)
        datos = re.sub(rb'moldeador-v\d+', b'moldeador-vN', datos)
        datos = re.sub(rb"'sha256-[A-Za-z0-9+/=]+'", b"'sha256-X'", datos)
        h.update(f.encode() + b'\0' + datos + b'\0')
    return h.hexdigest()


def hash_csp(html):
    m = RE_IMPORTMAP.search(html)
    return base64.b64encode(hashlib.sha256(m.group(1).encode('utf-8')).digest()).decode()


def guardado(raiz):
    f = raiz / 'herramientas' / '.version_hash'
    return f.read_text().split() if f.exists() else ['', '']


def escribir(raiz, n):
    for f in con_version(raiz):
        p = raiz / f
        t = p.read_text(encoding='utf-8')
        t = RE_V.sub(f'?v={n}', t)
        t = RE_CACHE.sub(f'moldeador-v{n}', t)
        if f == 'index.html':  # el importmap lleva ?v=N: su hash en la CSP cambia con cada versión
            t = RE_CSP_HASH.sub(f"'sha256-{hash_csp(t)}'", t, count=1)
        p.write_text(t, encoding='utf-8', newline='\n')
    (raiz / 'herramientas').mkdir(exist_ok=True)
    (raiz / 'herramientas' / '.version_hash').write_text(f'{n} {huella(raiz)}\n')


def check(raiz):
    n = str(version_actual(raiz))
    g, actual = guardado(raiz), huella(raiz)
    if g == [n, actual]:
        print(f'OK: versión {n}, hash {actual[:12]}')
        return
    if g[0] == n:
        sys.exit(
            f'Los archivos precacheados cambiaron pero la versión sigue en {n}: '
            f'ejecuta  python3 herramientas/version_sw.py {int(n) + 1}'
        )
    sys.exit(
        f'herramientas/.version_hash no corresponde a la versión {n}: ejecuta  python3 herramientas/version_sw.py {n}'
    )


def check_git(raiz, base):
    def git(*a):
        return subprocess.run(['git', *a], cwd=raiz, capture_output=True, text=True)

    if git('rev-parse', '--verify', '--quiet', base + '^{commit}').returncode:
        print(f'{base} no existe (primer commit o clon superficial): nada que comparar')
        return
    sw_base = git('show', f'{base}:sw.js').stdout
    v_base = RE_CACHE.search(sw_base)
    v_head = version_actual(raiz)
    cambiados = set(git('diff', '--name-only', base, 'HEAD').stdout.split())
    tocados = sorted(cambiados & set(precacheados((raiz / 'sw.js').read_text(encoding='utf-8'))))
    if v_base and v_head < int(v_base.group(1)):
        sys.exit(f'La versión bajó respecto a {base} ({v_base.group(1)} → {v_head}): las versiones sólo pueden subir.')
    if tocados and v_base and int(v_base.group(1)) == v_head:
        sys.exit(
            f'Cambiaron archivos precacheados ({", ".join(tocados)}) respecto a {base} y la versión sigue en {v_head}: '
            f'ejecuta  python3 herramientas/version_sw.py {v_head + 1}'
        )
    print(
        f'OK: respecto a {base}, versión {v_base.group(1) if v_base else "?"} → {v_head}; precacheados tocados: {tocados or "ninguno"}'
    )


def main(argv):
    raiz = pathlib.Path(__file__).resolve().parent.parent
    if '--root' in argv:
        i = argv.index('--root')
        raiz = pathlib.Path(argv[i + 1]).resolve()
        del argv[i : i + 2]
    force = '--force' in argv
    argv = [a for a in argv if a != '--force']
    if not argv:
        sys.exit(__doc__)
    if argv[0] == '--check':
        return check(raiz)
    if argv[0] == '--check-git':
        return check_git(raiz, argv[1] if len(argv) > 1 else 'HEAD~1')
    n = int(argv[0])
    cur = version_actual(raiz)
    g = guardado(raiz)
    if n <= cur and huella(raiz) != g[1] and not force:
        sys.exit(
            f'Los archivos precacheados cambiaron desde la versión {cur}: reutilizar v{n} dejaría a los dispositivos '
            f'con archivos viejos. Usa  python3 herramientas/version_sw.py {cur + 1}  (o --force si sabes lo que haces).'
        )
    escribir(raiz, n)
    print('versión', n, 'escrita en', ', '.join(con_version(raiz)), '+ CSP del importmap + herramientas/.version_hash')


if __name__ == '__main__':
    main(sys.argv[1:])
