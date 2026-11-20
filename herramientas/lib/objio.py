import numpy as np


def load_obj(p):
    V = []
    VT = []
    F = []
    FT = []
    with open(p) as fh:
        lines = fh.readlines()
    for ln in lines:
        if ln.startswith('v '):
            V.append([float(x) for x in ln.split()[1:4]])
        elif ln.startswith('vt '):
            VT.append([float(x) for x in ln.split()[1:3]])
        elif ln.startswith('f '):
            ids = [w.split('/') for w in ln.split()[1:]]
            vi = [int(a[0]) - 1 for a in ids]
            ti = [int(a[1]) - 1 for a in ids]
            for k in range(1, len(vi) - 1):
                F.append([vi[0], vi[k], vi[k + 1]])
                FT.append([ti[0], ti[k], ti[k + 1]])
    return np.array(V), np.array(VT), np.array(F), np.array(FT)


def uv_components(FT, nvt):
    import scipy.sparse as sp
    import scipy.sparse.csgraph as cg

    r = np.r_[FT[:, 0], FT[:, 1], FT[:, 2]]
    c = np.r_[FT[:, 1], FT[:, 2], FT[:, 0]]
    A = sp.coo_matrix((np.ones(len(r)), (r, c)), shape=(nvt, nvt))
    n, lab = cg.connected_components(A, directed=False)
    return n, lab[FT[:, 0]]
