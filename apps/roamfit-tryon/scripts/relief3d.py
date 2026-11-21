"""Free local 3D for Little Self: front + back concept images -> closed, textured GLB.

Silhouette = rembg IS-Net matte (MIT).\nShape = rounded "inflation" of the front silhouette (circular cross-sections from the distance transform)
        + high-frequency relief from Depth Anything V2 Small (Apache-2.0) on each side.
Front and back are stitched at the silhouette. Side views are interpolated, not observed.

usage: python3 scripts/relief3d.py <cache_dir> [front=source.jpg] [back=back.jpg]
"""
import json, sys, time
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

t0 = time.time()
d = Path(sys.argv[1])
front_name = sys.argv[2] if len(sys.argv) > 2 else 'source.jpg'
back_name = sys.argv[3] if len(sys.argv) > 3 else 'back.jpg'
dbg = d / 'relief_debug'; dbg.mkdir(exist_ok=True)

def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.float32)

F, B = load(d / front_name), load(d / back_name)
H, W = F.shape[:2]

# ---------- depth (Depth Anything V2 Small, local) ----------
import torch
from transformers import pipeline
dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
est = pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=dev)
def disparity(arr):
    out = est(Image.fromarray(arr.astype(np.uint8)))
    pd = out['predicted_depth']
    pd = pd.squeeze().detach().float().cpu().numpy()
    return np.asarray(Image.fromarray(pd).resize((arr.shape[1], arr.shape[0]), Image.BILINEAR))
dF, dB = disparity(F), disparity(B)
t_depth = time.time() - t0

# ---------- masks: rembg IS-Net (MIT, local ONNX) — robust for ivory garments on an off-white backdrop ----------
from rembg import remove, new_session
_seg = new_session('isnet-general-use')
def mask_of(img, _disp=None):
    m = np.asarray(remove(Image.fromarray(img.astype(np.uint8)), session=_seg, only_mask=True)) > 128
    lab, n = ndi.label(m)
    if n == 0: raise SystemExit('empty mask')
    m = lab == (1 + np.argmax(ndi.sum(m, lab, range(1, n + 1))))
    return ndi.binary_fill_holes(m)

mF, mB = mask_of(F, dF), mask_of(B, dB)

# ---------- align back image into the front frame (mirror + bbox scale, feet aligned) ----------
def bbox(m):
    ys, xs = np.nonzero(m); return xs.min(), ys.min(), xs.max(), ys.max()
fx0, fy0, fx1, fy1 = bbox(mF)
Bm, dBm, mBm = B[:, ::-1], dB[:, ::-1], mB[:, ::-1]          # seen from behind, world +x is image-left
bx0, by0, bx1, by1 = bbox(mBm)
s = (fy1 - fy0) / (by1 - by0)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
fcx, bcx = (fx0 + fx1) / 2, (bx0 + bx1) / 2
src_x = (xx - fcx) / s + bcx
src_y = (yy - fy1) / s + by1
def warp(a, order=1):
    if a.ndim == 2: return ndi.map_coordinates(a, [src_y, src_x], order=order, mode='nearest')
    return np.stack([ndi.map_coordinates(a[..., c], [src_y, src_x], order=order, mode='nearest') for c in range(3)], -1)
Ba, dBa, mBa = warp(Bm), warp(dBm), warp(mBm.astype(np.float32), 0) > 0.5

# inpaint backdrop pixels inside the silhouette with the nearest character pixel (prevents beige halos)
def fill_from(img, valid):
    idx = ndi.distance_transform_edt(~valid, return_distances=False, return_indices=True)
    return img[idx[0], idx[1]]
F_tex = fill_from(F, mF)
B_tex = fill_from(Ba, mBa)

# ---------- shape ----------
dt = ndi.distance_transform_edt(mF)
R = np.maximum(ndi.maximum_filter(dt, size=61), dt)
z_inf = np.sqrt(np.clip(2 * R * dt - dt * dt, 0, None))
# the distance transform has a sharp medial ridge -> diamond cross-sections & a centre crease; smooth it round
z_inf = ndi.gaussian_filter(z_inf, 9) * mF
z_inf *= 0.9
edge = np.clip(dt / 10.0, 0, 1); edge = edge * edge * (3 - 2 * edge)
def detail(disp, m):
    v = disp.copy(); v[~m] = np.median(disp[m])
    v = (v - np.percentile(v[m], 2)) / (np.percentile(v[m], 98) - np.percentile(v[m], 2) + 1e-6)
    hp = v - ndi.gaussian_filter(v, 18)
    return np.clip(hp, -0.25, 0.25) * 70 * edge                      # pixels of relief
zF = z_inf + detail(dF, mF)
zB = z_inf + detail(dBa, mF & mBa) * (mBa).astype(np.float32)

# ---------- optional SIDE view: true front-to-back depth per row + side texture near the silhouette ----------
side_info = None
side_path = next((d / n for n in ('side.jpg', 'side.png') if (d / n).exists()), None)
if side_path is not None:
    meta = json.loads((d / 'meta.json').read_text()) if (d / 'meta.json').exists() else {}
    S = load(side_path)
    if meta.get('side', {}).get('facing') == 'right': S = S[:, ::-1].copy()      # normalise: character faces image-left
    mS = mask_of(S)
    sx0, sy0, sx1, sy1 = bbox(mS)
    s_side = (fy1 - fy0) / (sy1 - sy0)
    S_tex = fill_from(S, mS)
    rows = np.arange(H)
    ys = np.clip(np.round(sy1 - (fy1 - rows) / s_side).astype(int), 0, S.shape[0] - 1)
    L = np.full(H, np.nan); D = np.full(H, np.nan)
    for y in range(fy0, fy1 + 1):
        cols = np.nonzero(mS[ys[y]])[0]
        if len(cols): L[y], D[y] = cols.min() * s_side, (cols.max() - cols.min()) * s_side
    def smooth_rows(a):
        ok = ~np.isnan(a); f = np.interp(rows, rows[ok], a[ok]); return ndi.gaussian_filter1d(f, 6)
    L, D = smooth_rows(L), smooth_rows(D)
    rmF = np.where(mF, zF, 0).max(1); rmB = np.where(mF, zB, 0).max(1)
    kF = np.clip(ndi.gaussian_filter1d(np.where(rmF > 1, (D / 2) / np.maximum(rmF, 1), 1.0), 6), 0.3, 3.0)
    kB = np.clip(ndi.gaussian_filter1d(np.where(rmB > 1, (D / 2) / np.maximum(rmB, 1), 1.0), 6), 0.3, 3.0)
    zF = zF * kF[:, None]; zB = zB * kB[:, None]
    zFmax = np.where(mF, zF, 0).max(1)

    def side_sample(Z):  # Z in front-pixel units (+ toward viewer) -> colour from side view at same row/depth
        xs = (L[:, None] + (zFmax[:, None] - Z)) / s_side
        yy = np.broadcast_to(ys[:, None], Z.shape).astype(np.float32)
        return np.stack([ndi.map_coordinates(S_tex[..., c], [yy, xs], order=1, mode='nearest') for c in range(3)], -1)

    def side_weight(z):  # how much the surface faces sideways (|n_x|) -> blend factor
        gy_, gx_ = np.gradient(ndi.gaussian_filter(z, 2))
        nx = np.abs(gx_) / np.sqrt(gx_ ** 2 + gy_ ** 2 + 1)
        t = np.clip((nx - 0.7) / 0.25, 0, 1)
        band = np.clip(1 - dt / 14.0, 0, 1)            # only a thin band at the silhouette edge (never the interior)
        return (t * t * (3 - 2 * t) * band)[..., None] * mF[..., None]

    wF, wB = side_weight(zF), side_weight(zB)
    F_tex = F_tex * (1 - wF) + side_sample(zF) * wF
    B_tex = B_tex * (1 - wB) + side_sample(-zB) * wB
    side_info = {'side_scale': round(float(s_side), 4), 'side_blend_front_pct': round(float(wF[mF].mean() * 100), 1)}
    Image.fromarray(np.clip(F_tex, 0, 255).astype(np.uint8)).resize((W // 4, H // 4)).save(dbg / 'front_tex_blended.jpg')

# ---------- mesh on a 4-px grid ----------
step = 4
gy, gx = np.mgrid[0:H:step, 0:W:step]
gm = mF[gy, gx]
h_px = fy1 - fy0
scale = 1.7 / h_px
idx = -np.ones(gm.shape, np.int64); n = int(gm.sum()); idx[gm] = np.arange(n)
X = ((gx[gm] - fcx) * scale).astype(np.float32)
Y = ((fy1 - gy[gm]) * scale).astype(np.float32)
ZF = (zF[gy, gx][gm] * scale).astype(np.float32)
ZB = (zB[gy, gx][gm] * scale).astype(np.float32)
verts = np.concatenate([np.stack([X, Y, ZF], 1), np.stack([X, Y, -ZB], 1)])
u = (gx[gm] / (W - 1)).astype(np.float32); v = (1 - gy[gm] / (H - 1)).astype(np.float32)
uvs = np.concatenate([np.stack([u * 0.5, v], 1), np.stack([0.5 + u * 0.5, v], 1)])

a, b_, c, d_ = idx[:-1, :-1], idx[:-1, 1:], idx[1:, :-1], idx[1:, 1:]
full = (a >= 0) & (b_ >= 0) & (c >= 0) & (d_ >= 0)
a, b_, c, d_ = a[full], b_[full], c[full], d_[full]
front_faces = np.concatenate([np.stack([a, c, b_], 1), np.stack([b_, c, d_], 1)])      # faces +z
back_faces = np.concatenate([np.stack([a, b_, c], 1), np.stack([b_, d_, c], 1)]) + n    # faces -z

# boundary edges of the front sheet -> side wall quads joining front and back
e = np.concatenate([front_faces[:, [0, 1]], front_faces[:, [1, 2]], front_faces[:, [2, 0]]])
key = np.sort(e, 1)
_, inv, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
bnd = e[counts[inv.ravel()] == 1]
side = np.concatenate([np.stack([bnd[:, 1], bnd[:, 0], bnd[:, 0] + n], 1), np.stack([bnd[:, 1], bnd[:, 0] + n, bnd[:, 1] + n], 1)])
faces = np.concatenate([front_faces, back_faces, side])

# ---------- texture atlas + GLB ----------
TW = 1024; TH = int(round(H * TW / W))
atlas = Image.new('RGB', (TW * 2, TH))
atlas.paste(Image.fromarray(np.clip(F_tex, 0, 255).astype(np.uint8)).resize((TW, TH), Image.LANCZOS), (0, 0))
atlas.paste(Image.fromarray(np.clip(B_tex, 0, 255).astype(np.uint8)).resize((TW, TH), Image.LANCZOS), (TW, 0))
import trimesh
mat = trimesh.visual.material.PBRMaterial(baseColorTexture=atlas, metallicFactor=0.0, roughnessFactor=0.85, doubleSided=True)
mesh = trimesh.Trimesh(vertices=verts, faces=faces, visual=trimesh.visual.TextureVisuals(uv=uvs, material=mat), process=False)
mesh.fix_normals()
out = d / 'model_local-relief.glb'
mesh.export(out)

for name, m in [('mask_front', mF), ('mask_back_aligned', mBa)]:
    Image.fromarray((m * 255).astype(np.uint8)).resize((W // 4, H // 4)).save(dbg / f'{name}.png')
Image.fromarray(np.clip(B_tex, 0, 255).astype(np.uint8)).resize((W // 4, H // 4)).save(dbg / 'back_aligned.jpg')
print(json.dumps({'glb': str(out), 'bytes': out.stat().st_size, 'vertices': int(len(verts)), 'faces': int(len(faces)), 'watertight': bool(mesh.is_watertight),
                  'back_scale': round(float(s), 4), 'side': side_info, 'device': dev, 'depth_sec': round(t_depth, 1), 'total_sec': round(time.time() - t0, 1)}))
