#!/usr/bin/env python3
"""(CI) Comprueba que el sha256 de la CSP de index.html coincide con el <script type="importmap">.
Si editas el importmap sin actualizar el hash, la app se quedaría en blanco."""

import base64
import hashlib
import pathlib
import re
import sys

html = (pathlib.Path(__file__).resolve().parent.parent / 'index.html').read_text(encoding='utf-8')
m = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', html)
if not m or not csp:
    sys.exit('Falta el importmap o la meta CSP en index.html')
h = base64.b64encode(hashlib.sha256(m.group(1).encode('utf-8')).digest()).decode()
hashes = re.findall(r"'sha256-([A-Za-z0-9+/=]+)'", csp.group(1))
if h not in hashes:
    sys.exit(f"La CSP no autoriza el importmap: pon 'sha256-{h}' en script-src (ahora: {hashes})")
inline = [s for s in re.findall(r'<script(?![^>]*\bsrc=)([^>]*)>', html) if 'importmap' not in s]
if inline:
    sys.exit(f'Hay scripts en línea sin hash en la CSP: {inline}')
if re.search(r'\sstyle="', html):
    sys.exit('Hay atributos style="" en index.html (la CSP style-src \'self\' los bloquea)')
print('OK: CSP', h)
