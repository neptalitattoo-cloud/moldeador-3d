# Comprobación independiente (Python) de un OBJ/USDZ exportado por la web.
import sys, json, zipfile, struct, io; sys.path.insert(0,'/workspace/sleeve/scripts')
import numpy as np, fit_measures as fm
from objio import load_obj
from scipy.spatial import ConvexHull
objzip,usdz=sys.argv[1],sys.argv[2]
z=zipfile.ZipFile(objzip); on=[n for n in z.namelist() if n.endswith('.obj')][0]
open('/tmp/_wc.obj','wb').write(z.read(on)); V,VT,F,FT=load_obj('/tmp/_wc.obj')
assert len(V)==len(fm.V0) and (F==fm.F).all() and np.abs(VT-fm.VT).max()<1e-4 and (FT==fm.FT).all(), 'topology/UV changed'
S_AX,S_EL,S_WR=64.93,49.5,25.5; M0=fm.measure(fm.V0); s0=M0['s_v']
meta=json.load(open('/workspace/sleeve/web_moldeador/data/brazo_derecho.json'))
mb=np.fromfile('/workspace/sleeve/web_moldeador/data/brazo_derecho.bin',dtype='<u4',offset=meta['blobs']['mer'][0],count=meta['blobs']['mer'][1])
# (A) independiente: cinta por la línea externa (mismos vértices que en la base) + contorno en el plano propio del anillo (PCA)
pts=[V[meta['tip']]]; S=[meta['s_tip']]; o=0
for s,n in zip(meta['mer_s'],meta['mer_n']): pts.append(V[mb[o:o+n]].mean(0)); S.append(s); o+=n
D=np.r_[0,np.cumsum(np.linalg.norm(np.diff(np.array(pts),axis=0),axis=1))]; S=np.array(S)
tape=lambda s: float(np.interp(-s,-S,D))
def ring_circ(s):
    R=V[np.abs(s0-s)<0.25]; X=R-R.mean(0); w,U=np.linalg.eigh(X.T@X); P=X@U[:,1:]; return ConvexHull(P).area
def s_of_tape(T): g=np.arange(S_WR,meta['s_tip'],0.05); return float(np.interp(T,[tape(x) for x in g][::-1],g[::-1]))
el,wr,ax=tape(S_EL),tape(S_WR),tape(S_AX)
A=dict(hombro_codo=el,codo_muneca=wr-el,hombro_muneca=wr,c_axila=ring_circ(S_AX),c_biceps=ring_circ(s_of_tape((ax+el)/2)),
 c_codo=ring_circ(S_EL),c_antebrazo=ring_circ(s_of_tape((el+wr)/2)),c_muneca=ring_circ(S_WR))
# (B) convención fit_measures (centro reajustado por polinomio)
M=fm.measure(V)
def news(s): m=np.abs(s0-s)<0.3; return float(np.median(M['s_v'][m]))
tp=M['tape']; e2,w2,a2=tp(news(S_EL)),tp(news(S_WR)),tp(news(S_AX))
ssn=np.arange(M['s_v'].min(),M['s_v'].max(),0.25); tps=np.array([tp(x) for x in ssn]); cat=lambda T: M['circ'](float(np.interp(T,tps[::-1],ssn[::-1])))
B=dict(hombro_codo=e2,codo_muneca=w2-e2,hombro_muneca=w2,c_axila=M['circ'](news(S_AX)),c_biceps=cat((a2+e2)/2),c_codo=M['circ'](news(S_EL)),c_antebrazo=cat((e2+w2)/2),c_muneca=M['circ'](news(S_WR)))
n0=np.cross(fm.V0[F[:,1]]-fm.V0[F[:,0]],fm.V0[F[:,2]]-fm.V0[F[:,0]]); n1=np.cross(V[F[:,1]]-V[F[:,0]],V[F[:,2]]-V[F[:,0]])
f=open(usdz,'rb').read(); zz=zipfile.ZipFile(usdz); al=[]
for i in zz.infolist(): n,e=struct.unpack('<HH',f[i.header_offset+26:i.header_offset+30]); al.append((i.filename,i.compress_type,(i.header_offset+30+n+e)%64))
print(json.dumps(dict(independiente=A,fit_measures=B,flips=int(((n0*n1).sum(1)<0).sum()),usdz_entries=al,obj_entries=z.namelist()),indent=1,default=lambda x: round(float(x),3)))
