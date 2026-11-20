# Medición de la malla base (Python, independiente de la web). Sin rutas absolutas:
# por defecto lee la malla base horneada del repo (data/brazo_derecho.json/.bin);
# para hornear desde un OBJ fuente, define MOLDEADOR_SRC_OBJ=/ruta/al/brazo.obj antes de importar.
import json
import os
import pathlib

import numpy as np
from objio import load_obj
from scipy.spatial import ConvexHull, cKDTree

REPO = pathlib.Path(__file__).resolve().parents[2]


def load_base(data=REPO / 'data' / 'brazo_derecho'):
    meta = json.loads(pathlib.Path(f'{data}.json').read_text())
    raw = pathlib.Path(f'{data}.bin').read_bytes()

    def blob(k):
        off, n, dt = meta['blobs'][k]
        return np.frombuffer(raw, dtype=dt, count=n, offset=off)

    return (
        blob('V0').reshape(-1, 3).astype(np.float64),
        blob('VT').reshape(-1, 2).astype(np.float64),
        blob('F').reshape(-1, 3).astype(np.int64),
        blob('FT').reshape(-1, 3).astype(np.int64),
        meta,
    )


SRC = os.environ.get('MOLDEADOR_SRC_OBJ')
if SRC:
    V0, VT, F, FT = load_obj(SRC)
else:
    V0, VT, F, FT, _META = load_base()
TEX = 2048
# Punto de referencia en el UV (px de la textura 2048): cara lateral externa del brazo; fija la «línea externa».
LM_PX = {'ref_lateral': (617, 297)}


def uv_to_bary(px):
    u = px[0] / TEX
    v = 1 - px[1] / TEX
    T = VT[FT]
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    v0 = b - a
    v1 = c - a
    v2 = np.array([u, v]) - a
    d00 = (v0 * v0).sum(1)
    d01 = (v0 * v1).sum(1)
    d11 = (v1 * v1).sum(1)
    d20 = (v2 * v0).sum(1)
    d21 = (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01 + 1e-20
    l1 = (d11 * d20 - d01 * d21) / den
    l2 = (d00 * d21 - d01 * d20) / den
    l0 = 1 - l1 - l2
    mn = np.minimum(np.minimum(l0, l1), l2)
    mn[den < 1e-14] = -9
    i = int(np.argmax(mn))
    assert mn[i] > -1e-4, mn[i]
    return i, np.array([l0[i], l1[i], l2[i]])


LMB = {k: uv_to_bary(p) for k, p in LM_PX.items()}


def lm_pos(V, k):
    i, w = LMB[k]
    return (V[F[i]] * w[:, None]).sum(0)


def centreline(V, n_iter=0):
    y = V[:, 1]
    ys = np.arange(-17, 30.01, 1.0)
    Cs = np.array([V[np.abs(y - y0) < 0.3].mean(0) for y0 in ys])
    px = np.polyfit(ys, Cs[:, 0], 3)
    pz = np.polyfit(ys, Cs[:, 2], 3)

    def cxz(yy):
        yc = np.clip(yy, -17, 30)
        ex = yy - yc
        dx = np.polyval(np.polyder(px), yc)
        dz = np.polyval(np.polyder(pz), yc)
        return np.polyval(px, yc) + dx * ex, np.polyval(pz, yc) + dz * ex

    yy = np.arange(y.min() - 3, y.max() + 3, 0.05)
    x, z = cxz(yy)
    C = np.c_[x, yy, z]
    seg = np.linalg.norm(np.diff(C, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    ss = np.arange(0, s[-1], 0.25)
    C = np.c_[[np.interp(ss, s, C[:, k]) for k in range(3)]].T
    T = np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1)[:, None]
    return C, T, ss


def project(V, C, T):
    ss = np.arange(len(C)) * 0.25
    idx = cKDTree(C).query(V)[1]
    d = V - C[idx]
    t = (d * T[idx]).sum(1)
    s_v = ss[idx] + t
    off = d - t[:, None] * T[idx]
    return s_v, off, idx


def measure(V, label=''):
    C, T, ss = centreline(V)  # s=0 at hand end (min y)
    s_v, off, idx = project(V, C, T)
    # s measured from top
    top = ss[-1]
    # outer direction: from centreline towards the lateral reference point
    kp = lm_pos(V, 'ref_lateral')
    sk, ok_, ik = project(kp[None], C, T)
    outer_dir = ok_[0] / np.linalg.norm(ok_[0])

    # circumference at s: perpendicular slice convex hull perimeter
    def circ(s0):
        m = np.abs(s_v - s0) < 0.25
        if m.sum() < 10:
            return np.nan
        j = int(np.clip(round(s0 / 0.25), 0, len(C) - 1))
        t = T[j]
        e1 = np.cross(t, [0, 0, 1.0])
        if np.linalg.norm(e1) < 1e-3:
            e1 = np.cross(t, [1.0, 0, 0])
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(t, e1)
        P = np.c_[(off[m] * e1).sum(1), (off[m] * e2).sum(1)]
        return ConvexHull(P).area

    # outer meridian tape: for each s bin, the vertex most along outer_dir (transported: project outer_dir onto plane)
    sb = np.arange(ss[0], ss[-1] + 2, 0.5)
    pts = []
    for s0 in sb:
        m = np.abs(s_v - s0) < 0.3
        if m.sum() < 3:
            continue
        j = int(np.clip(round(s0 / 0.25), 0, len(C) - 1))
        od = outer_dir - (outer_dir @ T[j]) * T[j]
        od /= np.linalg.norm(od)
        cand = np.where(m)[0]
        sc = (off[cand] @ od) / (np.linalg.norm(off[cand], axis=1) + 1e-9)
        good = cand[sc > np.cos(np.radians(12))]
        if len(good) == 0:
            continue
        pts.append((s0, V[good].mean(0)))
    sp = np.array([p[0] for p in pts])
    P = np.array([p[1] for p in pts])
    o = np.argsort(-sp)
    sp = sp[o]
    P = P[o]
    # start at shoulder tip = top-most vertex
    tip = V[np.argmax(V[:, 1])]
    P = np.vstack([tip, P[P[:, 1] < tip[1] - 0.05]])
    sp = np.r_[
        s_v[np.argmax(V[:, 1])],
        sp[o.argsort()][:0] if False else sp[(np.array([p[1] for p in pts])[o][:, 1] < tip[1] - 0.05)],
    ]
    D = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    tapeD = lambda s0: float(np.interp(-s0, -sp, D))
    return dict(C=C, T=T, ss=ss, s_v=s_v, off=off, circ=circ, tape=tapeD, top=top)


def landmarks(V, M):
    C, T = M['C'], M['T']
    out = {}
    for k in LM_PX:
        out[k] = float(project(lm_pos(V, k)[None], C, T)[0][0])
    return out
