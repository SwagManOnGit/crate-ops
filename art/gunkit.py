# Crate Ops art toolkit. Runs inside Blender 5.x (headless):
#   blender --background --factory-startup --python art/render.py -- [weapon ids]
#
# Weapons are modelled from filleted 2D side profiles (x = along the barrel, y = up,
# z = toward the viewer, all in centimetres), given real thickness and bevels, then
# baked with Cycles into a "G-buffer" sprite: camera-space normals, ambient occlusion,
# coverage and material masks. The game relights and re-skins that sprite in WebGL,
# so every drop can have its own pattern placement and wear.
import bpy, bmesh, math, os, shutil, subprocess
import numpy as np
from mathutils import Vector, Matrix

TILE_W, TILE_H = 1280, 640
SMALL = 4  # downscale factor for the thumbnail atlas

_parts = []
_cutters = []
MATS = {}
PREVIEWS = {}

# mask pass colours: R = pattern paint, G = accent paint, B = bare material brightness
TAG_COL = {
    'paint': (1.0, 0.0, 0.75),
    'accent': (0.0, 1.0, 0.75),
    'poly': (0.0, 0.0, 0.0),
    'rubber': (0.0, 0.0, 0.12),
    'steel': (0.0, 0.0, 0.5),
    'bright': (0.0, 0.0, 1.0),
}


def V(x, y, z=0.0):
    """Kit space (x along barrel, y up, z toward viewer) -> Blender space."""
    return Vector((x, -z, y))


# ----------------------------------------------------------------------------- scene

def _emit(name, color):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (color[0], color[1], color[2], 1.0)
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def _normal_mat():
    m = _emit('PASS_normal', (0, 0, 0))
    nt = m.node_tree
    em = [n for n in nt.nodes if n.type == 'EMISSION'][0]
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    vt = nt.nodes.new('ShaderNodeVectorTransform')
    vt.vector_type = 'NORMAL'
    vt.convert_from = 'WORLD'
    vt.convert_to = 'CAMERA'
    ma = nt.nodes.new('ShaderNodeVectorMath')
    ma.operation = 'MULTIPLY_ADD'
    ma.inputs[1].default_value = (0.5, 0.5, 0.5)
    ma.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(geo.outputs['Normal'], vt.inputs['Vector'])
    nt.links.new(vt.outputs['Vector'], ma.inputs[0])
    nt.links.new(ma.outputs['Vector'], em.inputs['Color'])
    return m


def _ao_mat(dist):
    m = _emit('PASS_ao', (1, 1, 1))
    nt = m.node_tree
    em = [n for n in nt.nodes if n.type == 'EMISSION'][0]
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
    ao.samples = 16
    ao.inputs['Distance'].default_value = dist
    nt.links.new(ao.outputs['Color'], em.inputs['Color'])
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _parts.clear()
    _cutters.clear()
    MATS.clear()
    for tag, col in TAG_COL.items():
        MATS[tag] = _emit('M_' + tag, col)
    MATS['cut'] = MATS['poly']
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                devs = [d for d in prefs.devices if d.type == kind]
                if devs:
                    for d in prefs.devices:
                        d.use = d.type == kind
                    sc.cycles.device = 'GPU'
                    break
            except Exception:
                continue
    except Exception:
        pass
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.render.film_transparent = True
    sc.render.resolution_x = TILE_W
    sc.render.resolution_y = TILE_H
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Raw'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.image_settings.compression = 15
    world = bpy.data.worlds.new('W')
    sc.world = world
    return sc


# ----------------------------------------------------------------------------- 2D helpers

def fillet(pts, r=0.0, seg=5):
    """Round polygon corners. Points are (x, y) or (x, y, radius)."""
    n = len(pts)
    out = []
    for i in range(n):
        p = pts[i]
        rr = p[2] if len(p) > 2 else r
        P = Vector((p[0], p[1]))
        if rr <= 1e-5:
            out.append((P.x, P.y))
            continue
        A = Vector(pts[i - 1][:2])
        B = Vector(pts[(i + 1) % n][:2])
        d1 = A - P
        d2 = B - P
        l1, l2 = d1.length, d2.length
        if l1 < 1e-6 or l2 < 1e-6:
            out.append((P.x, P.y))
            continue
        d1 /= l1
        d2 /= l2
        ang = math.acos(max(-1.0, min(1.0, d1.dot(d2))))
        if ang < 0.02 or abs(ang - math.pi) < 0.02:
            out.append((P.x, P.y))
            continue
        t = rr / math.tan(ang / 2)
        tmax = min(l1, l2) * 0.48
        if t > tmax:
            t = tmax
            rr = t * math.tan(ang / 2)
        T1 = P + d1 * t
        T2 = P + d2 * t
        c = P + (d1 + d2).normalized() * (rr / math.sin(ang / 2))
        a1 = math.atan2(T1.y - c.y, T1.x - c.x)
        a2 = math.atan2(T2.y - c.y, T2.x - c.x)
        da = a2 - a1
        while da > math.pi:
            da -= 2 * math.pi
        while da < -math.pi:
            da += 2 * math.pi
        steps = max(2, int(seg * abs(da) / (math.pi / 2) + 0.5))
        for k in range(steps + 1):
            a = a1 + da * k / steps
            out.append((c.x + rr * math.cos(a), c.y + rr * math.sin(a)))
    return out


def arc(cx, cy, r, a0, a1, n=12):
    """Points on a circle arc; angles in degrees."""
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def band(cx, cy, r0, r1, a0, a1, n=14):
    """Closed curved band between two radii (curved magazines, guards)."""
    return arc(cx, cy, r1, a0, a1, n) + list(reversed(arc(cx, cy, r0, a0, a1, n)))


def stroke(path, w):
    """Thick polyline -> closed polygon (trigger guards, slings, wires)."""
    pts = [Vector(p[:2]) for p in path]
    n = len(pts)
    left, right = [], []
    for i in range(n):
        if i == 0:
            d = (pts[1] - pts[0]).normalized()
            s = 1.0
        elif i == n - 1:
            d = (pts[-1] - pts[-2]).normalized()
            s = 1.0
        else:
            d1 = (pts[i] - pts[i - 1]).normalized()
            d2 = (pts[i + 1] - pts[i]).normalized()
            d = (d1 + d2).normalized()
            s = 1.0 / max(d.dot(d1), 0.45)
        nrm = Vector((-d.y, d.x))
        left.append(pts[i] + nrm * (w / 2) * s)
        right.append(pts[i] - nrm * (w / 2) * s)
    return [(p.x, p.y) for p in left] + [(p.x, p.y) for p in reversed(right)]


def rot(pts, deg, cx=0.0, cy=0.0):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    out = []
    for p in pts:
        x, y = p[0] - cx, p[1] - cy
        q = (cx + x * c - y * s, cy + x * s + y * c)
        out.append(q + tuple(p[2:]))
    return out


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def move(pts, dx, dy):
    return [(p[0] + dx, p[1] + dy) + tuple(p[2:]) for p in pts]


# ----------------------------------------------------------------------------- mesh builder

class B:
    """Accumulates several primitives into one mesh/object."""

    def __init__(self):
        self.bm = bmesh.new()

    def prism(self, pts, z0, z1, r=0.0):
        p2 = fillet(pts, r)
        bm = self.bm
        vb = [bm.verts.new(V(x, y, z0)) for x, y in p2]
        vt = [bm.verts.new(V(x, y, z1)) for x, y in p2]
        n = len(p2)
        fs = [bm.faces.new(vb), bm.faces.new(list(reversed(vt)))]
        for i in range(n):
            fs.append(bm.faces.new((vb[i], vb[(i + 1) % n], vt[(i + 1) % n], vt[i])))
        bmesh.ops.recalc_face_normals(bm, faces=fs)
        return self

    def _cone(self, r1, r2, depth, seg, mat, loc):
        ret = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg,
                                    radius1=r1, radius2=r2, depth=depth)
        vs = ret['verts']
        bmesh.ops.rotate(self.bm, cent=(0, 0, 0), matrix=mat, verts=vs)
        bmesh.ops.translate(self.bm, vec=loc, verts=vs)
        return self

    def tube(self, x0, x1, y, z, r, r2=None, seg=40):
        """Cylinder / cone along the barrel axis."""
        return self._cone(r, r if r2 is None else r2, abs(x1 - x0), seg,
                          Matrix.Rotation(math.pi / 2, 3, 'Y'), V((x0 + x1) / 2, y, z))

    def pin(self, x, y, z0, z1, r, r2=None, seg=28):
        """Cylinder pointing at the viewer (pins, screws, buttons, round cut-outs)."""
        return self._cone(r, r if r2 is None else r2, abs(z1 - z0), seg,
                          Matrix.Rotation(math.pi / 2, 3, 'X'), V(x, y, (z0 + z1) / 2))

    def post(self, x, y0, y1, z, r, r2=None, seg=28):
        """Vertical cylinder (turrets, foregrips)."""
        return self._cone(r, r if r2 is None else r2, abs(y1 - y0), seg,
                          Matrix.Identity(3), V(x, (y0 + y1) / 2, z))

    def ball(self, x, y, z, r, sx=1.0, sy=1.0, sz=1.0, seg=24):
        ret = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=seg // 2, radius=r)
        vs = ret['verts']
        bmesh.ops.scale(self.bm, vec=(sx, sz, sy), verts=vs)
        bmesh.ops.translate(self.bm, vec=V(x, y, z), verts=vs)
        return self

    def done(self, name, tag, bevel=0.1, seg=3, angle=30.0, smooth=True):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        me.materials.append(MATS[tag])
        ob['bevel'] = bevel
        ob['seg'] = seg
        ob['angle'] = angle
        if tag == 'cut':
            ob.hide_render = True
            ob.display_type = 'WIRE'
            _cutters.append(ob)
        else:
            _parts.append(ob)
        return ob


def solid(name, pts, hw, tag, bevel=0.12, r=0.0, z=None, seg=3):
    """Extruded profile, symmetric (hw = half width) unless z=(z0, z1) is given."""
    z0, z1 = (-hw, hw) if z is None else z
    return B().prism(pts, z0, z1, r).done(name, tag, bevel, seg)


def box(name, x0, x1, y0, y1, hw, tag, bevel=0.1, r=0.0, z=None):
    return solid(name, rect(x0, x1, y0, y1), hw, tag, bevel, r, z)


def tube(name, x0, x1, y, r, tag, bevel=0.06, z=0.0, r2=None, seg=40):
    return B().tube(x0, x1, y, z, r, r2, seg).done(name, tag, bevel)


def pin(name, x, y, z0, z1, r, tag, bevel=0.05, r2=None):
    return B().pin(x, y, z0, z1, r, r2).done(name, tag, bevel)


def plate(name, pts, zbase, h, tag, bevel=0.05, r=0.0):
    """Thin raised panel on the viewer-facing side."""
    return B().prism(pts, zbase - 0.06, zbase + h, r).done(name, tag, bevel, 2)


def rail(name, x0, x1, y, hw=1.02, tag='steel', pitch=1.0, h=0.42):
    """Accessory rail: a base strip with evenly spaced lugs."""
    b = B()
    b.prism(rect(x0, x1, y, y + h * 0.45), -hw * 0.78, hw * 0.78)
    n = max(1, int((x1 - x0) / pitch))
    span = (x1 - x0) / n
    for i in range(n):
        xa = x0 + i * span + span * 0.2
        b.prism(rect(xa, xa + span * 0.56, y + h * 0.4, y + h), -hw, hw)
    return b.done(name, tag, 0.035, 2)


def cut(target, cutter, transfer=True):
    """Boolean-subtract cutter from target. Cut faces take the cutter's material."""
    m = target.modifiers.new('Cut', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.object = cutter
    try:
        m.solver = 'EXACT'
        m.material_mode = 'TRANSFER' if transfer else 'INDEX'
    except Exception:
        pass
    return target


def cutter(name, tag='poly'):
    """Start a cutter mesh; finish with .done via cut_done()."""
    b = B()
    b._cut_name = name
    b._cut_tag = tag
    return b


def cut_done(b):
    me = bpy.data.meshes.new(b._cut_name)
    b.bm.to_mesh(me)
    b.bm.free()
    ob = bpy.data.objects.new(b._cut_name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(MATS[b._cut_tag])
    ob.hide_render = True
    ob.display_type = 'WIRE'
    _cutters.append(ob)
    return ob


def slots(target, name, cells, z0, z1, tag='poly', r=0.0):
    """Cut several profile-shaped pockets (cells = list of point lists) into target."""
    b = cutter(name, tag)
    for c in cells:
        b.prism(c, z0, z1, r)
    return cut(target, cut_done(b))


def finalize():
    """Add bevel + weighted normals after all booleans are in place."""
    for ob in _parts:
        bev = ob.get('bevel', 0.0)
        if bev > 0:
            m = ob.modifiers.new('Bevel', 'BEVEL')
            m.width = bev
            m.segments = int(ob.get('seg', 3))
            m.limit_method = 'ANGLE'
            m.angle_limit = math.radians(ob.get('angle', 30.0))
            m.miter_outer = 'MITER_ARC'
        w = ob.modifiers.new('WN', 'WEIGHTED_NORMAL')
        w.keep_sharp = True
        w.weight = 60
    bpy.context.view_layer.update()


# ----------------------------------------------------------------------------- camera + passes

def _fit_camera(yaw, pitch, margin=1.07, roll=0.0):
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob in _parts:
        ev = ob.evaluated_get(dg)
        for c in ev.bound_box:
            pts.append(ev.matrix_world @ Vector(c))
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    cp, sp = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
    d = Vector((sy * cp, -cy * cp, sp))  # from target toward the camera
    q = (-d).to_track_quat('-Z', 'Y')
    if roll:
        q = q @ Matrix.Rotation(math.radians(roll), 4, 'Z').to_quaternion()
    right = q @ Vector((1, 0, 0))
    up = q @ Vector((0, 1, 0))
    xs = [p.dot(right) for p in pts]
    ys = [p.dot(up) for p in pts]
    ds = [p.dot(d) for p in pts]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    cx = (max(xs) + min(xs)) / 2
    cyy = (max(ys) + min(ys)) / 2
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(w, h * TILE_W / TILE_H) * margin
    cam_data.clip_start = 0.1
    cam_data.clip_end = 2000
    cam = bpy.data.objects.new('Cam', cam_data)
    sc.collection.objects.link(cam)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = q
    cam.location = right * cx + up * cyy + d * (max(ds) + 200)
    sc.camera = cam
    return cam


def _render(path, override, samples):
    sc = bpy.context.scene
    bpy.context.view_layer.material_override = override
    sc.cycles.samples = samples
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def _load(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()


def _blur(a, rad):
    if rad <= 0:
        return a
    k = 2 * rad + 1
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (rad + 1, rad)
        c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
        if axis == 0:
            a = (c[k:, :] - c[:-k, :]) / k
        else:
            a = (c[:, k:] - c[:, :-k]) / k
    return a


def _dilate(val, mask, iters):
    """Bleed valid values outward so filtering never samples garbage at the silhouette."""
    v = val * mask
    m = mask.copy()
    for _ in range(iters):
        vs = np.zeros_like(v)
        ms = np.zeros_like(m)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            vs += np.roll(v, (dy, dx), axis=(0, 1))
            ms += np.roll(m, (dy, dx), axis=(0, 1))
        new = (m < 0.5) & (ms > 0.5)
        v = np.where(new, vs / np.maximum(ms, 1e-6), v)
        m = np.where(new, 1.0, m)
    return v, m


def _ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    cand = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages')
    for root, _dirs, files in os.walk(cand):
        if 'ffmpeg.exe' in files:
            return os.path.join(root, 'ffmpeg.exe')
    raise RuntimeError('ffmpeg not found')


def _save(arr, path, quality=90):
    """arr: HxW (gray) or HxWx3 uint8 -> webp/png/jpg through ffmpeg."""
    h, w = arr.shape[:2]
    fmt = 'gray' if arr.ndim == 2 else 'rgb24'
    raw = path + '.raw'
    arr.astype(np.uint8).tofile(raw)
    cmd = [_ffmpeg(), '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', fmt,
           '-s', '%dx%d' % (w, h), '-i', raw]
    if path.endswith('.webp'):
        cmd += ['-c:v', 'libwebp', '-quality', str(quality), '-compression_level', '6', '-preset', 'picture']
    elif path.endswith('.jpg'):
        cmd += ['-q:v', '3']
    cmd += ['-frames:v', '1', path]
    subprocess.run(cmd, check=True)
    os.remove(raw)


def shade_preview(t, paint_col=(0.86, 0.42, 0.08), accent_col=(0.1, 0.5, 0.75)):
    """Quick numpy relight of the baked tiles so models can be judged without the game."""
    nx, ny = t['nx'] * 2 - 1, t['ny'] * 2 - 1
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
    L = np.array([-0.42, 0.66, 0.62])
    L = L / np.linalg.norm(L)
    Hv = L + np.array([0, 0, 1.0])
    Hv = Hv / np.linalg.norm(Hv)
    ndl = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    ndh = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1)
    mat = t['mat'][..., None]
    col = (1 - mat) * np.array([0.045, 0.047, 0.05]) + mat * np.array([0.40, 0.42, 0.45])
    col = col * (1 - t['paint'][..., None]) + np.array(paint_col) * t['paint'][..., None]
    col = col * (1 - t['accent'][..., None]) + np.array(accent_col) * t['accent'][..., None]
    ao = t['ao'][..., None]
    rgb = col * (0.22 + 0.95 * ndl[..., None]) * ao
    rgb += (ndh[..., None] ** 50) * 0.55 * ao
    rgb += ((1 - nz[..., None]) ** 3) * 0.22 * (ny[..., None] * 0.5 + 0.5)
    rgb = rgb / (1 + rgb) * 1.45
    rgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
    a = t['alpha'][..., None]
    bg = np.array([0.105, 0.115, 0.125])
    return (np.clip(rgb * a + bg * (1 - a), 0, 1) * 255).astype(np.uint8)


def bake(wid, out_dir, tmp_dir, yaw=14.0, pitch=11.0, ao_dist=5.0, margin=1.07, roll=0.0, preview=True):
    """Render the passes for the current scene and write <wid>.webp, <wid>_s.webp (+ preview)."""
    finalize()
    _fit_camera(yaw, pitch, margin, roll)
    os.makedirs(tmp_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    pn = os.path.join(tmp_dir, wid + '_n.png')
    pa = os.path.join(tmp_dir, wid + '_a.png')
    pm = os.path.join(tmp_dir, wid + '_m.png')
    _render(pn, _normal_mat(), 24)
    _render(pa, _ao_mat(ao_dist), 48)
    _render(pm, None, 24)
    N, A, M = _load(pn), _load(pa), _load(pm)
    alpha = N[..., 3]
    solid_mask = (alpha > 0.5).astype(np.float32)
    if N[..., 2][alpha > 0.9].mean() < 0.5:
        nx, ny = N[..., 0], N[..., 1]          # camera looks down -Z: x right, y up already
    else:
        nx, ny = N[..., 0], N[..., 1]
    nxp, _ = _dilate(nx, solid_mask, 6)
    nyp, m2 = _dilate(ny, solid_mask, 6)
    nxp = np.where(m2 > 0.5, nxp, 0.5)
    nyp = np.where(m2 > 0.5, nyp, 0.5)
    ao, _ = _dilate(A[..., 0], solid_mask, 4)
    paint, _ = _dilate(M[..., 0], solid_mask, 3)
    accent, _ = _dilate(M[..., 1], solid_mask, 3)
    mat, _ = _dilate(M[..., 2], solid_mask, 3)
    # signed curvature from the normal field: > 0.5 convex edges (paint chips first), < 0.5 creases (grime)
    fx, fy = nxp * 2 - 1, nyp * 2 - 1
    div = (np.roll(fx, -1, axis=1) - np.roll(fx, 1, axis=1)) - (np.roll(fy, -1, axis=0) - np.roll(fy, 1, axis=0))
    sil = np.clip(_blur(solid_mask, 3) * -1 + 1, 0, 1) * solid_mask  # near the outline
    conv = np.clip(div * 1.6, -1, 1)
    conv = 0.55 * conv + 0.45 * np.clip(_blur(conv, 2) * 2.2, -1, 1)
    edge = np.clip(0.5 + 0.5 * conv + sil * 0.9, 0, 1) * solid_mask + 0.5 * (1 - solid_mask)
    tiles = {'nx': nxp, 'ny': nyp, 'ao': ao, 'alpha': alpha, 'paint': paint, 'accent': accent, 'mat': mat, 'edge': edge}
    order = [['nx', 'ny'], ['ao', 'alpha'], ['paint', 'accent'], ['mat', 'edge']]
    atlas = np.vstack([np.hstack([np.clip(tiles[k], 0, 1) for k in row]) for row in order])
    _save(np.round(atlas * 255), os.path.join(out_dir, wid + '.webp'), 90)
    small = np.vstack([np.hstack([
        np.clip(tiles[k], 0, 1).reshape(TILE_H // SMALL, SMALL, TILE_W // SMALL, SMALL).mean(axis=(1, 3))
        for k in row]) for row in order])
    _save(np.round(small * 255), os.path.join(out_dir, wid + '_s.webp'), 88)
    info = {
        'nz_mean': float(N[..., 2][alpha > 0.9].mean()),
        'coverage': float(solid_mask.mean()),
        'paint': float((paint * solid_mask).sum() / max(solid_mask.sum(), 1)),
    }
    if preview:
        PREVIEWS[wid] = shade_preview(tiles)
        _save(PREVIEWS[wid], os.path.join(tmp_dir, wid + '_preview.jpg'))
    for p in (pn, pa, pm):
        try:
            os.remove(p)
        except OSError:
            pass
    return info
