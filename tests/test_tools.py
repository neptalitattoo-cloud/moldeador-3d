"""Pruebas de las herramientas Python: python3 -m unittest discover -s tests -p 'test_*.py'"""

import json
import os
import pathlib
import sys
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / 'herramientas' / 'lib'))
os.environ.pop('MOLDEADOR_SRC_OBJ', None)  # siempre la malla del repo
import fit_measures as fm  # noqa: E402
import numpy as np  # noqa: E402


class LoadBase(unittest.TestCase):
    def test_lee_el_bin_del_repo(self):
        V, VT, F, FT, meta = fm.load_base()
        disk = json.loads((RAIZ / 'data' / 'brazo_derecho.json').read_text())
        self.assertEqual(meta, disk)
        self.assertEqual(V.shape, (meta['nV'], 3))
        self.assertEqual(VT.shape, (meta['nVT'], 2))
        self.assertEqual(F.shape, (meta['nF'], 3))
        self.assertEqual(FT.shape, (meta['nF'], 3))
        self.assertTrue(np.isfinite(V).all() and np.isfinite(VT).all())
        self.assertTrue(0 <= F.min() and F.max() < len(V) and FT.max() < len(VT))

    def test_modulo_usa_la_base_del_repo(self):
        self.assertEqual(len(fm.V0), json.loads((RAIZ / 'data' / 'brazo_derecho.json').read_text())['nV'])

    def test_medidas_plausibles(self):
        M = fm.measure(fm.V0)
        for s, lo, hi in [(25.5, 12, 22), (49.5, 20, 32), (64.93, 24, 40)]:  # muñeca, codo, axila (cm)
            self.assertTrue(lo < M['circ'](s) < hi, (s, M['circ'](s)))
        self.assertTrue(0 < M['tape'](64.93) < M['tape'](49.5) < M['tape'](25.5))  # cinta desde el hombro

    def test_direcciones_2d(self):
        meta = fm.load_base()[4]
        o, b = np.array(meta['dir_outer']), np.array(meta['dir_back'])
        self.assertAlmostEqual(np.linalg.norm(o), 1, places=4)
        self.assertAlmostEqual(abs(o @ b), 0, places=4)


class VersionSw(unittest.TestCase):
    """version_sw.py no deja reutilizar una versión si cambió algún archivo precacheado."""

    def setUp(self):
        import shutil
        import tempfile

        self.tmp = pathlib.Path(tempfile.mkdtemp())
        for f in [
            'index.html',
            'sw.js',
            'manifest.webmanifest',
            'css',
            'js',
            'data',
            'vendor',
            'icons',
            'herramientas',
        ]:
            src = RAIZ / f
            (shutil.copytree if src.is_dir() else shutil.copy)(src, self.tmp / f)
        self.addCleanup(shutil.rmtree, self.tmp)

    def vsw(self, *args):
        import subprocess

        return subprocess.run(
            [sys.executable, str(RAIZ / 'herramientas' / 'version_sw.py'), *args, '--root', str(self.tmp)],
            capture_output=True,
            text=True,
        )

    def test_reutilizar_version_tras_un_cambio(self):
        import re

        n = int(re.search(r'moldeador-v(\d+)', (self.tmp / 'sw.js').read_text()).group(1))
        self.assertEqual(self.vsw(str(n), '--force').returncode, 0)  # punto de partida limpio
        self.assertEqual(self.vsw('--check').returncode, 0)
        with open(self.tmp / 'css' / 'app.css', 'a') as fh:
            fh.write('/* cambio */\n')
        self.assertNotEqual(self.vsw('--check').returncode, 0)  # la CI lo detecta
        self.assertNotEqual(self.vsw(str(n)).returncode, 0)  # misma N: rechazada
        self.assertNotEqual(self.vsw(str(n - 1)).returncode, 0)  # menor: rechazada
        self.assertEqual(self.vsw(str(n + 1)).returncode, 0)  # N+1: bien
        self.assertEqual(self.vsw('--check').returncode, 0)
        html = (self.tmp / 'index.html').read_text()
        self.assertIn(f'three.module.min.js?v={n + 1}', html)  # vendor/ también versionado
        sys.path.insert(0, str(RAIZ / 'herramientas'))
        import version_sw

        self.assertIn(f"'sha256-{version_sw.hash_csp(html)}'", html)  # la CSP sigue autorizando el importmap


if __name__ == '__main__':
    unittest.main()
