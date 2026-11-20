# Separa la textura de Neptali en: piel limpia (solo dentro de las islas UV + sangrado) y capa de tatuaje (tinta, transparente fuera)
import sys; sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent / 'lib'))
import numpy as np, json
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
import os, fit_measures as fm
# Uso: python3 herramientas/split_layers.py textura_pintada.png carpeta_salida/
# (usa los UV de la malla base del repo)
if len(sys.argv) < 3: sys.exit('Uso: split_layers.py textura.png carpeta_salida/')
SRC, OUT = sys.argv[1], os.path.join(sys.argv[2], ''); os.makedirs(OUT, exist_ok=True)
VT, F, FT = fm.VT, fm.F, fm.FT
im=np.asarray(Image.open(SRC).convert('RGB')).astype(np.float64); H,W,_=im.shape
# 1) máscara de islas UV
m=Image.new('L',(W,H),0); d=ImageDraw.Draw(m)
for t in FT:
    d.polygon([(VT[i,0]*W,(1-VT[i,1])*H) for i in t],fill=255)
isl=np.asarray(m)>0
Image.fromarray((isl*255).astype(np.uint8)).save(OUT+'mascara_islas_uv.png')
# 2) color de piel = mediana en las manos (sin tinta)
hsv=np.asarray(Image.open(SRC).convert('RGB').convert('HSV')).astype(float)
hand=isl.copy(); hand[:, :int(0.48*W)]=False
skin=np.median(im[hand],axis=0); print('piel',skin)
# 3) marcas guía magenta/amarillo (saturadas y de tono distinto a la piel)
hue=hsv[...,0]*360/255; sat=hsv[...,1]/255; val=hsv[...,2]/255
skin_h=np.median(hue[hand])
dh=np.minimum(np.abs(hue-skin_h),360-np.abs(hue-skin_h))
guide=(sat>0.35)&(val>0.45)&(dh>22)
guide=ndi.binary_dilation(guide,iterations=2)
print('pix guía',guide.sum())
# 4) alfa de tinta: proyección sobre la recta piel→negro; color de tinta por desmezcla
s=skin; a=1-(im@s)/(s@s); a=np.clip(a,0,1)
a[a<0.04]=0; a[guide]=0
inside=ndi.binary_dilation(isl,iterations=4); a[~inside]=0
ink=np.where(a[...,None]>1e-3,(im-(1-a[...,None])*s)/np.maximum(a[...,None],1e-3),0)
ink=np.clip(ink,0,255)
tat=np.dstack([ink,a*255]).round().astype(np.uint8); tat[a==0]=0
Image.fromarray(tat,'RGBA').save(OUT+'tatuaje_capa.png',optimize=True)
# 5) piel limpia con sangrado de 8 px, transparente fuera
bleed=ndi.binary_dilation(isl,iterations=8)
sk=np.zeros((H,W,4),np.uint8); sk[bleed,:3]=np.round(s).astype(np.uint8); sk[bleed,3]=255
Image.fromarray(sk,'RGBA').save(OUT+'piel_base.png',optimize=True)
# 6) control: piel ⊕ tatuaje vs original (dentro de islas, sin guías)
comp=sk[...,:3]*(1-a[...,None])+ink*a[...,None]
err=np.abs(comp-im)[isl&~guide]; print('error recomposición medio %.2f  p99 %.1f'%(err.mean(),np.percentile(err,99)))
Image.fromarray(np.clip(comp,0,255).astype(np.uint8)).save(OUT+'_control_recompuesto.png')
json.dump(dict(skin=s.tolist(),guide_px=int(guide.sum()),err_mean=float(err.mean()),err_p99=float(np.percentile(err,99))),open(OUT+'_split.json','w'))
