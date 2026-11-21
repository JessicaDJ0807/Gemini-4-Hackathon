"""Turnaround asset builder (local, free). Produces aligned, background-removed WebP frames + manifest.json.

  video mode:  python3 scripts/turnaround_frames.py video <in.mp4> <out_dir> [frames=36]
  views mode:  python3 scripts/turnaround_frames.py views <out_dir> front=<img> [side=<img> facing=left|right] [back=<img>]

Validation is measured, not assumed: duration/resolution, scale + centring stability, cut detection, full-body
visibility, first/last similarity, and a silhouette-width rotation estimate. Nothing here is 3D geometry.
"""
import json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from rembg import remove, new_session

SEG = new_session('isnet-general-use')
SEG_HUMAN = new_session('u2net_human_seg')   # better at white shoes on off-white floors; used for the feet band only
OUT_H = 1100  # px height of every output frame (character feet sit on the bottom edge, small margin)

def cutout(img):
    rgba = remove(img.convert('RGB'), session=SEG)
    a = np.asarray(rgba)[..., 3].copy()
    m = a > 128
    # ivory garments / white shoes on an off-white backdrop: union with the human-segmentation matte and fill
    # interior holes (anything fully enclosed by the silhouette is part of the figure)
    human_full = np.asarray(remove(img.convert('RGB'), session=SEG_HUMAN, only_mask=True)) > 128
    if m.any():
        filled = ndi.binary_fill_holes(m | (human_full & ndi.binary_dilation(m, iterations=25)))
        a = np.where(filled & ~m, 255, a); m = filled
    # White shoes on an off-white backdrop are often dropped by the matte: recover pixels in the bottom band that
    # differ from the per-row backdrop colour and sit directly under the character's legs.
    rgb = np.asarray(img.convert('RGB')).astype(np.float32); H, W = m.shape
    bgrow = ndi.gaussian_filter1d(np.median(np.concatenate([rgb[:, :25], rgb[:, -25:]], 1), axis=1), 8, axis=0)
    dist = np.linalg.norm(rgb - bgrow[:, None, :], axis=2)
    if m.any():
        ys, xs = np.nonzero(m); y_top, y_bot = ys.min(), ys.max(); band0 = int(y_bot - 0.08 * (y_bot - y_top))
        cols = np.zeros(W, bool); pad = int(0.12 * (y_bot - y_top)); cols[max(0, xs[ys > band0].min() - pad):min(W, xs[ys > band0].max() + pad)] = True
        diff = rgb - bgrow[:, None, :]; lum = diff.mean(2); chroma = np.linalg.norm(diff - lum[..., None], axis=2)
        human = np.asarray(remove(img.convert('RGB'), session=SEG_HUMAN, only_mask=True)) > 128
        shadow = (lum < -2) & (chroma < 10)
        extra = (human | ((dist > 9) & ((lum > 2) | (chroma > 12)))) & ~shadow & cols[None, :]
        extra[:band0] = False; extra[min(H, y_bot + int(0.06 * (y_bot - y_top))):] = False
        extra = ndi.binary_opening(extra, iterations=2)
        lab, n = ndi.label(extra | m)
        keep = np.isin(lab, np.unique(lab[m]))
        add = extra & keep & ~m
        a[add] = 255; m = m | add
    else:
        add = np.zeros_like(m)
    lab, n = ndi.label(m)
    if n:
        keep = lab == (1 + np.argmax(ndi.sum(m, lab, range(1, n + 1))))
        a = np.where(ndi.binary_dilation(keep, iterations=3), a, 0)  # drop stray blobs, keep soft hair edges
    arr = np.asarray(rgba).copy(); arr[..., 3] = a
    arr[..., :3] = rgb.astype(np.uint8)               # colour always from the source frame; alpha alone decides visibility
    return Image.fromarray(arr), a > 128

def bbox(m):
    ys, xs = np.nonzero(m); return xs.min(), ys.min(), xs.max(), ys.max()

def normalise(cuts, masks, mirror_flags=None):
    """Scale every frame so the character height matches, centre horizontally on the mask centroid, feet on the bottom."""
    out = []
    boxes = [bbox(m) for m in masks]
    ref_h = np.median([b[3] - b[1] for b in boxes])
    W = int(OUT_H * 0.62)
    for i, (im, m, b) in enumerate(zip(cuts, masks, boxes)):
        s = (OUT_H * 0.94) / ref_h
        im2 = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
        cx = ndi.center_of_mass(m)[1] * s
        foot = b[3] * s
        canvas = Image.new('RGBA', (W, OUT_H), (0, 0, 0, 0))
        canvas.paste(im2, (int(W / 2 - cx), int(OUT_H * 0.985 - foot)), im2)
        if mirror_flags and mirror_flags[i]: canvas = canvas.transpose(Image.FLIP_LEFT_RIGHT)
        out.append(canvas)
    return out, W

def write(frames, out_dir, extra):
    out_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for i, f in enumerate(frames):
        n = f'{i:03d}.webp'; f.save(out_dir / n, 'WEBP', quality=86, method=5); names.append(n)
    manifest = {'frameCount': len(frames), 'width': frames[0].width, 'height': frames[0].height, 'frames': names, 'loop': True, **extra}
    (out_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    return manifest

def plate_cutouts(frames):
    """Static camera: estimate an empty background plate from pixels the figure doesn't cover, then key every frame
    against it (white shoes and ivory garments differ from the plate even when they're close to the backdrop colour)."""
    arr = np.stack([np.asarray(f.convert('RGB')).astype(np.float32) for f in frames])
    rough = np.stack([np.asarray(remove(f.convert('RGB'), session=SEG, only_mask=True)) > 64 for f in frames])
    cover = np.stack([ndi.binary_dilation(m, iterations=18) for m in rough])
    uncovered = ~cover
    known = uncovered.sum(0) >= 2
    w = uncovered[..., None].astype(np.float32)
    plate = (arr * w).sum(0) / np.maximum(w.sum(0), 1)
    plate = np.where(known[..., None], plate, ndi.gaussian_filter(plate, (25, 25, 0)))
    out = []
    for f, rgb, rm in zip(frames, arr, rough):
        diff = rgb - plate; dist = np.linalg.norm(diff, axis=2); lum = diff.mean(2)
        chroma = np.linalg.norm(diff - lum[..., None], axis=2)
        shadow = (lum < 0) & (chroma < 9) & (dist < 50)
        fg = np.where(known, (dist > 13) & ~shadow, rm)
        fg = ndi.binary_opening(fg, iterations=1)
        lab, n = ndi.label(fg | rm)
        keep = np.isin(lab, np.unique(lab[rm & fg])) if (rm & fg).any() else fg
        fg = fg & keep
        holes = ndi.binary_fill_holes(fg) & ~fg
        fg = fg | (holes & ~(known & (dist < 9)))          # fill true interior holes, never re-fill visible backdrop
        alpha = (ndi.gaussian_filter(fg.astype(np.float32), 0.8) * 255).clip(0, 255).astype(np.uint8)
        rgba = np.dstack([rgb.astype(np.uint8), alpha])
        out.append((Image.fromarray(rgba), alpha > 128))
    return out

def video_mode(src, out_dir, n):
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', str(src)]))
    v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    dur = float(probe['format']['duration'])
    with tempfile.TemporaryDirectory() as tmp:
        # dense sample for analysis (every frame at 8 fps), then pick n frames
        subprocess.check_call(['ffmpeg', '-v', 'error', '-i', str(src), '-vf', 'fps=8', f'{tmp}/a_%04d.png'])
        files = sorted(Path(tmp).glob('a_*.png'))
        imgs = [Image.open(f).convert('RGB') for f in files]
    small = [np.asarray(i.resize((90, 160))).astype(np.float32) for i in imgs]
    diffs = [float(np.abs(small[i] - small[i - 1]).mean()) for i in range(1, len(small))]
    med = float(np.median(diffs)) if diffs else 0
    cuts = [i for i, d in enumerate(diffs, 1) if med > 0 and d > max(6 * med, 12)]
    idx = np.linspace(0, len(imgs) - 1, n + 1)[:-1].round().astype(int)   # n frames; last ≈ first is dropped for looping
    sel = [imgs[i] for i in idx]
    cut_res = plate_cutouts(sel)
    masks = [m for _, m in cut_res]
    boxes = [bbox(m) for m in masks]
    H0, W0 = masks[0].shape
    heights = np.array([b[3] - b[1] for b in boxes], float); centers = np.array([ndi.center_of_mass(m)[1] for m in masks])
    widths = np.array([b[2] - b[0] for b in boxes], float)
    touches = sum(1 for b in boxes if b[1] <= 2 or b[3] >= H0 - 3)
    # rotation estimate: silhouette width is widest facing front/back and narrowest in profile → ~2 minima per turn
    w = ndi.gaussian_filter1d(widths / widths.max(), 1.2)
    minima = [i for i in range(1, len(w) - 1) if w[i] < w[i - 1] and w[i] <= w[i + 1] and w[i] < 0.85]
    first_last_iou = float((masks[0] & cut_res[-1][1]).sum() / max(1, (masks[0] | cut_res[-1][1]).sum()))
    hist = lambda im: np.histogram(np.asarray(im)[..., :3], bins=24, range=(0, 255))[0].astype(float)
    a, b = hist(sel[0]), hist(imgs[-1]); colour_sim = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
    checks = {
        'duration_s': round(dur, 2), 'resolution': f"{v['width']}x{v['height']}", 'fps': v.get('r_frame_rate'),
        'scale_variation_pct': round(float(heights.std() / heights.mean() * 100), 1),
        'centre_drift_pct_of_width': round(float((centers.max() - centers.min()) / W0 * 100), 1),
        'cuts_detected': len(cuts), 'frames_touching_edge': touches,
        'profile_minima': len(minima), 'estimated_turns': round(len(minima) / 2, 2),
        'first_last_mask_iou': round(first_last_iou, 3), 'first_last_colour_similarity': round(colour_sim, 3),
    }
    ok = (checks['scale_variation_pct'] < 8 and checks['centre_drift_pct_of_width'] < 12 and not cuts and touches == 0
          and 0.75 <= checks['estimated_turns'] <= 1.25 and first_last_iou > 0.75)
    frames, _ = normalise([c for c, _ in cut_res], masks)
    return write(frames, out_dir, {'source': 'video', 'checks': checks, 'automatedRotationPass': bool(ok),
                                   'coverageDegrees': 360 if ok else None,
                                   'angleMapping': 'linear-in-time (only valid if automatedRotationPass and visual QA agree)'})

def views_mode(out_dir, args):
    front = Image.open(args['front']); views = [('front', 0, front, False, 'generated')]
    if 'side' in args:
        side = Image.open(args['side'])
        if args.get('facing', 'left') == 'right': side = side.transpose(Image.FLIP_LEFT_RIGHT)
        views.append(('left profile', 90, side, False, 'generated'))
    if 'back' in args: views.append(('back', 180, Image.open(args['back']), False, 'generated'))
    if 'side' in args: views.append(('right profile', 270, side, True, 'mirrored from left profile'))
    cut_res = [cutout(v[2]) for v in views]
    frames, _ = normalise([c for c, _ in cut_res], [m for _, m in cut_res], [v[3] for v in views])
    return write(frames, out_dir, {'source': 'views', 'coverageDegrees': None, 'automatedRotationPass': False,
                                   'views': [{'label': v[0], 'angle': v[1], 'origin': v[4]} for v in views]})

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'video':
        m = video_mode(Path(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 36)
    else:
        kv = dict(a.split('=', 1) for a in sys.argv[3:])
        m = views_mode(Path(sys.argv[2]), kv)
    print(json.dumps({k: v for k, v in m.items() if k != 'frames'}))
