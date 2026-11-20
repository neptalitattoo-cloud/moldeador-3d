# Hornea la malla base del brazo derecho para la web (geometría limpia, UV originales).
# Uso: MOLDEADOR_SRC_OBJ=/ruta/brazo_vertical.obj python3 herramientas/web_bake.py
# (el OBJ fuente no está en el repo: es un modelo de terceros; el resultado sí: data/brazo_derecho.*)
import sys, json; sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent / 'lib'))
import numpy as np, fit_measures as fm, hand_measure as hm
V0,VT,F,FT=fm.V0,fm.VT,fm.F,fm.FT
M=fm.measure(V0); C,T,ss=M['C'],M['T'],M['ss']; s_v,off=M['s_v'],M['off']
tip=int(np.argmax(V0[:,1])); s_tip=float(s_v[tip])
S_AX,S_EL,S_WR=64.93,49.5,25.5
# outer meridian sets (same rule as fit_measures.measure)
kp=fm.lm_pos(V0,'ref_lateral'); _,ok_,_=fm.project(kp[None],C,T); od0=ok_[0]/np.linalg.norm(ok_[0])
mer=[]
for s0 in np.arange(ss[0],ss[-1]+2,0.5):
    m=np.abs(s_v-s0)<0.3
    if m.sum()<3: continue
    j=int(np.clip(round(s0/0.25),0,len(C)-1)); od=od0-(od0@T[j])*T[j]; od/=np.linalg.norm(od)
    cand=np.where(m)[0]; sc=(off[cand]@od)/(np.linalg.norm(off[cand],axis=1)+1e-9)
    good=cand[sc>np.cos(np.radians(12))]
    if len(good)==0 or V0[good].mean(0)[1]>=V0[tip,1]-0.05: continue
    mer.append((float(s0),good.tolist()))
mer.sort(key=lambda x:-x[0])
jw=int(round(S_WR/0.25)); wc=C[jw]; t=-T[jw]
a=hm.frame(V0,wc,t)
HL0=float(((V0-wc)@a).max())
# direcciones de la vista 2D (horizontales): lateral externa y posterior (= externa × Y)
d_out=np.array([od0[0],0.0,od0[2]]); d_out/=np.linalg.norm(d_out); d_back=np.cross(d_out,[0.0,1.0,0.0])
meta=dict(part='brazo_derecho',nV=len(V0),nVT=len(VT),nF=len(F),step=0.25,nC=len(C),s_tip=s_tip,tip=tip,
  S_AX=S_AX,S_EL=S_EL,S_WR=S_WR,hand_a=a.tolist(),HL0=HL0,mcp_frac=0.46,
  mer_s=[m[0] for m in mer],mer_n=[len(m[1]) for m in mer],dir_outer=d_out.round(6).tolist(),dir_back=d_back.round(6).tolist())
blobs=[('V0',V0.astype('<f4')),('VT',VT.astype('<f4')),('F',F.astype('<u4')),('FT',FT.astype('<u4')),
       ('sv',s_v.astype('<f4')),('off',off.astype('<f4')),('C',C.astype('<f4')),('T',T.astype('<f4')),
       ('mer',np.concatenate([m[1] for m in mer]).astype('<u4'))]
off_b=0; buf=b''; meta['blobs']={}
for k,arr in blobs:
    b=arr.tobytes(); meta['blobs'][k]=[off_b,arr.size,arr.dtype.str]; buf+=b; off_b+=len(b)
open(str(fm.REPO/'data')+'/brazo_derecho.bin','wb').write(buf)
json.dump(meta,open(str(fm.REPO/'data')+'/brazo_derecho.json','w'))
print(len(buf)/1e6,'MB', 'HL0',HL0,'mer',len(mer), 'base tapes el/wr/ax',M['tape'](S_EL),M['tape'](S_WR),M['tape'](S_AX))
