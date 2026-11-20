# Comprobación independiente (Python) de un OBJ/USDZ exportado por la web.
# Uso: python3 herramientas/web_check.py brazo_X_OBJ.zip brazo_X.usdz
import json
import os
import pathlib
import struct
import sys
import tempfile
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'lib'))
import fit_measures as fm  # noqa: E402
import numpy as np  # noqa: E402
from objio import load_obj  # noqa: E402
from scipy.spatial import ConvexHull  # noqa: E402

SLICE_HALF_W = 0.25  # cm: media anchura de la rodaja para medir un contorno
SLICE_MATCH = 0.3  # cm: ventana para encontrar la estación equivalente en la malla moldeada
TAPE_STEP = 0.05  # cm: paso para invertir la cinta (cinta → posición s)
ZIP_ALIGN = 64  # bytes: alineación que exige USDZ

objzip, usdz = sys.argv[1], sys.argv[2]
meta = json.loads((fm.REPO / 'data' / 'brazo_derecho.json').read_text())
S_AX, S_EL, S_WR = meta['S_AX'], meta['S_EL'], meta['S_WR']  # estaciones axila, codo y muñeca (s en cm)

z = zipfile.ZipFile(objzip)
obj_name = [n for n in z.namelist() if n.endswith('.obj')][0]
with tempfile.TemporaryDirectory() as td:
    tmp = os.path.join(td, 'export.obj')
    with open(tmp, 'wb') as fh:
        fh.write(z.read(obj_name))
    V, VT, F, FT = load_obj(tmp)
assert len(V) == len(fm.V0) and (F == fm.F).all() and np.abs(VT - fm.VT).max() < 1e-4 and (FT == fm.FT).all(), (
    'topology/UV changed'
)
s0 = fm.measure(fm.V0)['s_v']
mer_off, mer_count = meta['blobs']['mer'][:2]
mb = np.fromfile(fm.REPO / 'data' / 'brazo_derecho.bin', dtype='<u4', offset=mer_off, count=mer_count)

# (A) Independiente: cinta por la línea externa (mismos vértices que en la base)
#     + contorno en el plano propio del anillo (PCA).
pts, S, o = [V[meta['tip']]], [meta['s_tip']], 0
for s, n in zip(meta['mer_s'], meta['mer_n'], strict=True):
    pts.append(V[mb[o : o + n]].mean(0))
    S.append(s)
    o += n
D = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1))]
S = np.array(S)


def tape(s):
    return float(np.interp(-s, -S, D))


def ring_circ(s):
    R = V[np.abs(s0 - s) < SLICE_HALF_W]
    X = R - R.mean(0)
    _, U = np.linalg.eigh(X.T @ X)
    return ConvexHull(X @ U[:, 1:]).area


def s_of_tape(t):
    g = np.arange(S_WR, meta['s_tip'], TAPE_STEP)
    return float(np.interp(t, [tape(x) for x in g][::-1], g[::-1]))


el, wr, ax = tape(S_EL), tape(S_WR), tape(S_AX)
A = dict(
    hombro_codo=el,
    codo_muneca=wr - el,
    hombro_muneca=wr,
    c_axila=ring_circ(S_AX),
    c_biceps=ring_circ(s_of_tape((ax + el) / 2)),
    c_codo=ring_circ(S_EL),
    c_antebrazo=ring_circ(s_of_tape((el + wr) / 2)),
    c_muneca=ring_circ(S_WR),
)

# (B) Convención de fit_measures (centro reajustado por polinomio).
M = fm.measure(V)


def news(s):
    return float(np.median(M['s_v'][np.abs(s0 - s) < SLICE_MATCH]))


tp = M['tape']
e2, w2, a2 = tp(news(S_EL)), tp(news(S_WR)), tp(news(S_AX))
ssn = np.arange(M['s_v'].min(), M['s_v'].max(), meta['step'])
tps = np.array([tp(x) for x in ssn])


def circ_at_tape(t):
    return M['circ'](float(np.interp(t, tps[::-1], ssn[::-1])))


B = dict(
    hombro_codo=e2,
    codo_muneca=w2 - e2,
    hombro_muneca=w2,
    c_axila=M['circ'](news(S_AX)),
    c_biceps=circ_at_tape((a2 + e2) / 2),
    c_codo=M['circ'](news(S_EL)),
    c_antebrazo=circ_at_tape((e2 + w2) / 2),
    c_muneca=M['circ'](news(S_WR)),
)

# Caras invertidas respecto a la base y alineación de los archivos dentro del USDZ.
n0 = np.cross(fm.V0[F[:, 1]] - fm.V0[F[:, 0]], fm.V0[F[:, 2]] - fm.V0[F[:, 0]])
n1 = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
raw = pathlib.Path(usdz).read_bytes()
entries = []
for i in zipfile.ZipFile(usdz).infolist():
    n, e = struct.unpack('<HH', raw[i.header_offset + 26 : i.header_offset + 30])
    entries.append((i.filename, i.compress_type, (i.header_offset + 30 + n + e) % ZIP_ALIGN))
print(
    json.dumps(
        dict(
            independiente=A,
            fit_measures=B,
            flips=int(((n0 * n1).sum(1) < 0).sum()),
            usdz_entries=entries,
            obj_entries=z.namelist(),
        ),
        indent=1,
        default=lambda x: round(float(x), 3),
    )
)
