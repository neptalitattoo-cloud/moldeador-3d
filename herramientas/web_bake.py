# Hornea la malla base del brazo derecho para la web (geometría limpia, UV originales).
# Uso: MOLDEADOR_SRC_OBJ=/ruta/brazo_vertical.obj python3 herramientas/web_bake.py [--out DIR]
# (el OBJ fuente no está en el repo: es un modelo de terceros; el resultado sí: data/brazo_derecho.*)
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'lib'))
import fit_measures as fm  # noqa: E402
import hand_measure as hm  # noqa: E402
import numpy as np  # noqa: E402

PARTE = 'brazo_derecho'
CENTRE_STEP = 0.25  # cm: paso de la línea central (C, T)
MER_STEP = 0.5  # cm: paso de los conjuntos de la línea externa
MER_WINDOW = 0.3  # cm: media ventana de cada conjunto
MER_CONE_DEG = 12  # grados: apertura alrededor de la dirección externa
TIP_CLEAR = 0.05  # cm: se descartan conjuntos a esta altura de la punta del hombro
MCP_FRAC = 0.46  # fracción del largo de la mano donde están los nudillos
# Estaciones anatómicas (s en cm desde el extremo de la mano). Se leen del meta ya horneado de la parte;
# estos valores sólo se usan la primera vez que se hornea.
ESTACIONES_INICIALES = {'S_AX': 64.93, 'S_EL': 49.5, 'S_WR': 25.5}

out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else fm.REPO / 'data'
previo = fm.REPO / 'data' / f'{PARTE}.json'
est = {k: json.loads(previo.read_text())[k] for k in ESTACIONES_INICIALES} if previo.exists() else ESTACIONES_INICIALES
S_AX, S_EL, S_WR = est['S_AX'], est['S_EL'], est['S_WR']

V0, VT, F, FT = fm.V0, fm.VT, fm.F, fm.FT
M = fm.measure(V0)
C, T, ss = M['C'], M['T'], M['ss']
s_v, off = M['s_v'], M['off']
tip = int(np.argmax(V0[:, 1]))
s_tip = float(s_v[tip])

# Conjuntos de la línea externa (misma regla que fit_measures.measure)
kp = fm.lm_pos(V0, 'ref_lateral')
_, ok_, _ = fm.project(kp[None], C, T)
od0 = ok_[0] / np.linalg.norm(ok_[0])
mer = []
for s0 in np.arange(ss[0], ss[-1] + 2, MER_STEP):
    m = np.abs(s_v - s0) < MER_WINDOW
    if m.sum() < 3:
        continue
    j = int(np.clip(round(s0 / CENTRE_STEP), 0, len(C) - 1))
    od = od0 - (od0 @ T[j]) * T[j]
    od /= np.linalg.norm(od)
    cand = np.where(m)[0]
    sc = (off[cand] @ od) / (np.linalg.norm(off[cand], axis=1) + 1e-9)
    good = cand[sc > np.cos(np.radians(MER_CONE_DEG))]
    if len(good) == 0 or V0[good].mean(0)[1] >= V0[tip, 1] - TIP_CLEAR:
        continue
    mer.append((float(s0), good.tolist()))
mer.sort(key=lambda x: -x[0])

# Marco de la mano en la muñeca
jw = int(round(S_WR / CENTRE_STEP))
wc, t = C[jw], -T[jw]
a = hm.frame(V0, wc, t)
HL0 = float(((V0 - wc) @ a).max())

# Direcciones de la vista 2D (horizontales): lateral externa y posterior (= externa × Y)
d_out = np.array([od0[0], 0.0, od0[2]])
d_out /= np.linalg.norm(d_out)
d_back = np.cross(d_out, [0.0, 1.0, 0.0])

meta = dict(
    part=PARTE,
    nV=len(V0),
    nVT=len(VT),
    nF=len(F),
    step=CENTRE_STEP,
    nC=len(C),
    s_tip=s_tip,
    tip=tip,
    S_AX=S_AX,
    S_EL=S_EL,
    S_WR=S_WR,
    hand_a=a.tolist(),
    HL0=HL0,
    mcp_frac=MCP_FRAC,
    mer_s=[m[0] for m in mer],
    mer_n=[len(m[1]) for m in mer],
    dir_outer=d_out.round(6).tolist(),
    dir_back=d_back.round(6).tolist(),
)
blobs = [
    ('V0', V0.astype('<f4')),
    ('VT', VT.astype('<f4')),
    ('F', F.astype('<u4')),
    ('FT', FT.astype('<u4')),
    ('sv', s_v.astype('<f4')),
    ('off', off.astype('<f4')),
    ('C', C.astype('<f4')),
    ('T', T.astype('<f4')),
    ('mer', np.concatenate([m[1] for m in mer]).astype('<u4')),
]
off_b, buf, meta['blobs'] = 0, b'', {}
for k, arr in blobs:
    b = arr.tobytes()
    meta['blobs'][k] = [off_b, arr.size, arr.dtype.str]
    buf += b
    off_b += len(b)
out.mkdir(parents=True, exist_ok=True)
(out / f'{PARTE}.bin').write_bytes(buf)
(out / f'{PARTE}.json').write_text(json.dumps(meta))
print(
    f'{len(buf) / 1e6:.2f} MB  HL0 {HL0:.3f}  mer {len(mer)}  cintas base codo/muñeca/axila',
    M['tape'](S_EL),
    M['tape'](S_WR),
    M['tape'](S_AX),
)
