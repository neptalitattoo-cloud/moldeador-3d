"""Pruebas de las herramientas Python: python3 -m unittest discover -s tests -p 'test_*.py'"""
import json, os, pathlib, sys, unittest

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / 'herramientas' / 'lib'))
os.environ.pop('MOLDEADOR_SRC_OBJ', None)  # siempre la malla del repo
import numpy as np
import fit_measures as fm


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


if __name__ == '__main__':
    unittest.main()
