# USDZ (cm, Y arriba) escrito directamente con pxr: una malla, UV faceVarying, UsdPreviewSurface con textura base.
import os, shutil, tempfile, numpy as np
from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf, Vt, UsdUtils
def vnormals(V,F):
    n=np.cross(V[F[:,1]]-V[F[:,0]],V[F[:,2]]-V[F[:,0]]); N=np.zeros_like(V)
    for k in range(3): np.add.at(N,F[:,k],n)
    return N/np.maximum(np.linalg.norm(N,axis=1),1e-12)[:,None]
def write_usdz(V,VT,F,FT,tex_png,out,name='brazo'):
    d=tempfile.mkdtemp(); os.makedirs(d+'/textures'); shutil.copy(tex_png,d+'/textures/piel.png')
    st=Usd.Stage.CreateNew(d+f'/{name}.usdc'); UsdGeom.SetStageUpAxis(st,UsdGeom.Tokens.y); UsdGeom.SetStageMetersPerUnit(st,0.01)
    root=UsdGeom.Xform.Define(st,f'/{name}'); st.SetDefaultPrim(root.GetPrim()); Usd.ModelAPI(root).SetKind('component')
    m=UsdGeom.Mesh.Define(st,f'/{name}/malla')
    m.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(V.astype(np.float32))); m.CreateFaceVertexCountsAttr(Vt.IntArray([3]*len(F)))
    m.CreateFaceVertexIndicesAttr(Vt.IntArray(F.reshape(-1).tolist())); m.CreateSubdivisionSchemeAttr('none')
    m.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(vnormals(V,F).astype(np.float32))); m.SetNormalsInterpolation('vertex')
    m.CreateExtentAttr(Vt.Vec3fArray([Gf.Vec3f(*V.min(0).tolist()),Gf.Vec3f(*V.max(0).tolist())]))
    pv=UsdGeom.PrimvarsAPI(m).CreatePrimvar('st',Sdf.ValueTypeNames.TexCoord2fArray,UsdGeom.Tokens.faceVarying)
    pv.Set(Vt.Vec2fArray.FromNumpy(VT.astype(np.float32))); pv.SetIndices(Vt.IntArray(FT.reshape(-1).tolist()))
    mat=UsdShade.Material.Define(st,f'/{name}/Materiales/piel')
    sh=UsdShade.Shader.Define(st,f'/{name}/Materiales/piel/Superficie'); sh.CreateIdAttr('UsdPreviewSurface')
    sh.CreateInput('metallic',Sdf.ValueTypeNames.Float).Set(0.0); sh.CreateInput('roughness',Sdf.ValueTypeNames.Float).Set(0.6)
    rd=UsdShade.Shader.Define(st,f'/{name}/Materiales/piel/LectorUV'); rd.CreateIdAttr('UsdPrimvarReader_float2'); rd.CreateInput('varname',Sdf.ValueTypeNames.String).Set('st')
    tx=UsdShade.Shader.Define(st,f'/{name}/Materiales/piel/Textura'); tx.CreateIdAttr('UsdUVTexture')
    tx.CreateInput('file',Sdf.ValueTypeNames.Asset).Set('textures/piel.png'); tx.CreateInput('sourceColorSpace',Sdf.ValueTypeNames.Token).Set('sRGB')
    tx.CreateInput('st',Sdf.ValueTypeNames.Float2).ConnectToSource(rd.ConnectableAPI(),'result')
    sh.CreateInput('diffuseColor',Sdf.ValueTypeNames.Color3f).ConnectToSource(tx.ConnectableAPI(),'rgb')
    mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(),'surface')
    UsdShade.MaterialBindingAPI.Apply(m.GetPrim()).Bind(mat)
    st.GetRootLayer().Save()
    cwd=os.getcwd(); os.chdir(d); ok=UsdUtils.CreateNewARKitUsdzPackage(Sdf.AssetPath(f'{name}.usdc'),os.path.abspath(os.path.join(cwd,out)) if not os.path.isabs(out) else out); os.chdir(cwd)
    shutil.rmtree(d); return ok
