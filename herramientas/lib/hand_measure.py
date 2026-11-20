import numpy as np
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from scipy.spatial import ConvexHull, cKDTree


def comps(P, r=0.6):
    t = cKDTree(P)
    pr = np.array(list(t.query_pairs(r)))
    if len(pr) == 0:
        return np.zeros(len(P), int)
    A = sp.coo_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), shape=(len(P), len(P)))
    return connected_components(A, directed=False)[1]


def frame(V, wrist_c, t):
    """hand frame: origin wrist centre, a = hand axis (PCA of hand verts, oriented away from arm), b = palm breadth dir, c = thickness"""
    d = (V - wrist_c) @ t
    H = V[d > 0.5]
    X = H - H.mean(0)
    w, U = np.linalg.eigh(X.T @ X / len(X))
    a = U[:, 2]
    a = a if a @ t > 0 else -a
    return a


def slice_stats(V, o, a, b, c, d0, hw=0.25, main_only=True):
    d = (V - o) @ a
    m = np.abs(d - d0) < hw
    if m.sum() < 6:
        return None
    P = np.c_[(V[m] - o) @ b, (V[m] - o) @ c]
    if main_only:
        lab = comps(P, 0.7)
        big = np.argmax(np.bincount(lab))
        P = P[lab == big]
    h = ConvexHull(P)
    return dict(circ=h.area, breadth=P[:, 0].max() - P[:, 0].min(), thick=P[:, 1].max() - P[:, 1].min(), n=len(P))


def hand_metrics(V, wrist_c, t):
    a = frame(V, wrist_c, t)
    d = (V - wrist_c) @ a
    # breadth direction: PCA in plane perpendicular to a at mid-palm
    mid = np.abs(d - 0.45 * d.max()) < 0.6
    Q = V[mid] - V[mid].mean(0)
    Q = Q - np.outer(Q @ a, a)
    w, U = np.linalg.eigh(Q.T @ Q)
    b = U[:, 2]
    c = np.cross(a, b)
    L = d.max()
    tip = V[np.argmax(d)]
    prof = [(x, slice_stats(V, wrist_c, a, b, c, x)) for x in np.arange(0.5, L, 0.5)]
    return dict(a=a, b=b, c=c, L=L, tip=tip, prof=prof, d=d)
