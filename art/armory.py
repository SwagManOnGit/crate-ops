# Crate Ops backdrop: the inside of a military armory, rendered with Cycles.
#   blender --background --factory-startup --python art/armory.py [-- --quick | --dry]
# Writes public/bg/armory.webp (1600x800 colour) and public/bg/armory_d.webp (800x400 depth,
# white = near) for the parallax backdrop behind the 3D weapon view.
#   --quick  half-size, fewer samples, preview only (art/out/armory_preview.jpg)
#   --dry    build the scene and exit without rendering (syntax / API check)
import sys, os, math, time, importlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy, bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector, Euler  # noqa: E402
import gunkit  # noqa: E402
import weapons  # noqa: E402

for extra in ('weapons_guns', 'weapons_melee'):
    if os.path.exists(os.path.join(HERE, extra + '.py')):
        importlib.import_module(extra)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in argv
DRY = '--dry' in argv
OUT = os.path.normpath(os.path.join(HERE, '..', 'public', 'bg'))
TMP = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)
W, H = 1600, 800
T0 = time.time()

sc = gunkit.reset()
col = sc.collection

# ----------------------------------------------------------------------------- materials

def pbr(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (emit[0], emit[1], emit[2], 1.0)
        b.inputs['Emission Strength'].default_value = strength
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    return m


def concrete(name, dark, light, r0, r1, scale=2.2):
    """Principled with noise-driven colour and roughness, so lights smear on the floor."""
    m = pbr(name, dark, r0)
    nt = m.node_tree
    b = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = 7.0
    nz.inputs['Roughness'].default_value = 0.62
    mixc = nt.nodes.new('ShaderNodeMixRGB')
    mixc.inputs[1].default_value = (dark[0], dark[1], dark[2], 1.0)
    mixc.inputs[2].default_value = (light[0], light[1], light[2], 1.0)
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['To Min'].default_value = r0
    mr.inputs['To Max'].default_value = r1
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    nt.links.new(nz.outputs['Fac'], mixc.inputs[0])
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mixc.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])
    return m


M = {
    'floor': concrete('floor', (0.05, 0.053, 0.05), (0.115, 0.118, 0.11), 0.12, 0.42),
    'wall': concrete('wall', (0.052, 0.068, 0.06), (0.078, 0.098, 0.088), 0.7, 0.9, 1.3),
    'wall_dark': pbr('wall_dark', (0.026, 0.033, 0.03), 0.8),
    'ceiling': pbr('ceiling', (0.03, 0.034, 0.034), 0.85),
    'gunmetal': pbr('gunmetal', (0.11, 0.115, 0.122), 0.42, 0.9),
    'slat': pbr('slat', (0.11, 0.125, 0.12), 0.5, 0.3),
    'locker': pbr('locker', (0.085, 0.115, 0.098), 0.48, 0.35),
    'locker2': pbr('locker2', (0.07, 0.095, 0.085), 0.5, 0.35),
    'black': pbr('black', (0.014, 0.014, 0.016), 0.55),
    'rubber': pbr('rubber', (0.02, 0.02, 0.021), 0.85),
    'bright': pbr('bright', (0.5, 0.51, 0.53), 0.3, 1.0),
    'brass': pbr('brass', (0.56, 0.38, 0.13), 0.36, 0.9),
    'tan': pbr('tan', (0.36, 0.29, 0.17), 0.6),
    'line': pbr('line', (0.42, 0.3, 0.07), 0.55),
    'strip': pbr('strip', (1, 1, 1), 0.4, 0.0, (0.82, 0.92, 1.0), 2.3),
    'warm': pbr('warm', (1, 1, 1), 0.4, 0.0, (1.0, 0.55, 0.2), 14.0),
    'glow': pbr('glow', (1, 1, 1), 0.4, 0.0, (1.0, 0.6, 0.24), 5.0),
    # paints for the racked guns and the crates
    'p_olive': pbr('p_olive', (0.065, 0.085, 0.05), 0.55),
    'p_grey': pbr('p_grey', (0.055, 0.06, 0.066), 0.5, 0.2),
    'p_tan': pbr('p_tan', (0.27, 0.215, 0.13), 0.6),
    'p_black': pbr('p_black', (0.022, 0.023, 0.025), 0.5),
    'p_sand': pbr('p_sand', (0.33, 0.265, 0.165), 0.55),
    'p_green': pbr('p_green', (0.1, 0.14, 0.07), 0.5),
    'p_steel': pbr('p_steel', (0.15, 0.16, 0.17), 0.38, 0.6),
    'c_olive': pbr('c_olive', (0.12, 0.15, 0.085), 0.6),
    'c_sand': pbr('c_sand', (0.36, 0.285, 0.16), 0.62),
    'c_slate': pbr('c_slate', (0.1, 0.14, 0.17), 0.58),
}

# ----------------------------------------------------------------------------- geometry helpers

class Boxes:
    """Many axis-aligned boxes / cylinders in one mesh."""

    def __init__(self):
        self.bm = bmesh.new()

    def add(self, x, y, z):
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        cx, cy, cz = (x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2
        sx, sy, sz = abs(x[1] - x[0]), abs(y[1] - y[0]), abs(z[1] - z[0])
        for v in ret['verts']:
            v.co = Vector((cx + v.co.x * sx, cy + v.co.y * sy, cz + v.co.z * sz))
        return self

    def cyl(self, p0, p1, r, seg=14):
        d = Vector(p1) - Vector(p0)
        ret = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.rotate(self.bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=ret['verts'])
        bmesh.ops.translate(self.bm, vec=(Vector(p0) + Vector(p1)) / 2, verts=ret['verts'])
        return self

    def done(self, name, mat, bevel=0.0, smooth=False):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        me.materials.append(M[mat] if isinstance(mat, str) else mat)
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
            try:
                me.set_sharp_from_angle(angle=math.radians(40))
            except Exception:
                pass
        if bevel > 0:
            mod = ob.modifiers.new('Bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = 2
            mod.limit_method = 'ANGLE'
        return ob


def box(name, x, y, z, mat, bevel=0.0):
    return Boxes().add(x, y, z).done(name, mat, bevel)


def weapon_mesh(wid):
    """Build one of the game's models and bake it down to a single mesh (centimetres)."""
    gunkit._parts.clear()
    gunkit._cutters.clear()
    fn, _cam = weapons.WEAPONS[wid]
    fn()
    gunkit.finalize()
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    tags = []
    for ob in gunkit._parts:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        remap = []
        for mat in me.materials:
            tag = mat.name.split('.')[0][2:] if mat is not None and mat.name.startswith('M_') else 'poly'
            if tag not in tags:
                tags.append(tag)
            remap.append(tags.index(tag))
        if not remap:
            if 'poly' not in tags:
                tags.append('poly')
            remap = [tags.index('poly')]
        f0 = len(bm.faces)
        v0 = len(bm.verts)
        bm.from_mesh(me)
        new_faces = list(bm.faces)[f0:]
        for f in new_faces:
            f.material_index = remap[min(f.material_index, len(remap) - 1)]
        bmesh.ops.transform(bm, matrix=ob.matrix_world, verts=list(bm.verts)[v0:])
        ev.to_mesh_clear()
    mesh = bpy.data.meshes.new('W_' + wid)
    bm.to_mesh(mesh)
    bm.free()
    for ob in list(gunkit._parts) + list(gunkit._cutters):
        bpy.data.objects.remove(ob, do_unlink=True)
    gunkit._parts.clear()
    gunkit._cutters.clear()
    for p in mesh.polygons:
        p.use_smooth = True
    try:
        mesh.set_sharp_from_angle(angle=math.radians(38))
    except Exception:
        pass
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    print('MESH', wid, len(mesh.polygons), 'faces', round(time.time() - T0, 1), 's')
    return {'mesh': mesh, 'tags': tags, 'min': Vector(co.min(axis=0)), 'max': Vector(co.max(axis=0))}


def place(wm, loc, rot=(0.0, 0.0, 0.0), paint='p_olive', accent='brass', anchor='axis', scale=0.01):
    """Instance a weapon mesh. anchor: 'axis' = mid-length on the barrel line, 'base' = bottom centre."""
    me = wm['mesh'].copy()
    me.materials.clear()
    look = {'paint': paint, 'accent': accent, 'poly': 'black', 'rubber': 'rubber', 'steel': 'gunmetal',
            'bright': 'bright', 'cut': 'black'}
    for tag in wm['tags']:
        me.materials.append(M[look.get(tag, 'black')])
    ob = bpy.data.objects.new(me.name, me)
    col.objects.link(ob)
    mn, mx = wm['min'], wm['max']
    if anchor == 'base':
        c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    elif anchor == 'butt':
        c = Vector((mn.x, 0.0, 0.0))
    else:
        c = Vector(((mn.x + mx.x) / 2, 0.0, 0.0))
    e = Euler(rot, 'XYZ')
    ob.rotation_euler = e
    ob.scale = (scale, scale, scale)
    ob.location = Vector(loc) - e.to_matrix() @ (c * scale)
    return ob


# ----------------------------------------------------------------------------- props from the game

GUNS = {w: weapon_mesh(w) for w in ('kestrel', 'kodiak', 'bulldog', 'longbow', 'lynx', 'ravager', 'hornet', 'wasp')}
CRATE = weapon_mesh('crate')

# ----------------------------------------------------------------------------- room shell

XW, YB, YF, ZC = 2.5, 5.8, -1.6, 2.9
DOOR_W, DOOR_H = 0.62, 2.2

box('floor', (-XW - 0.3, XW + 0.3), (YF - 0.3, YB + 2.4), (-0.1, 0.0), 'floor')
box('ceiling', (-XW - 0.3, XW + 0.3), (YF - 0.3, YB + 2.4), (ZC, ZC + 0.1), 'ceiling')
shell = Boxes()
shell.add((-XW - 0.2, -XW), (YF, YB + 0.2), (0, ZC))
shell.add((XW, XW + 0.2), (YF, YB + 0.2), (0, ZC))
shell.add((-XW, XW), (YF - 0.2, YF), (0, ZC))
shell.add((-XW, -DOOR_W), (YB, YB + 0.2), (0, ZC))
shell.add((DOOR_W, XW), (YB, YB + 0.2), (0, ZC))
shell.add((-DOOR_W, DOOR_W), (YB, YB + 0.2), (DOOR_H, ZC))
shell.done('walls', 'wall')

# darker skirting band and wall pilasters give the side walls a rhythm that reads as depth
trim = Boxes()
for sx in (-1, 1):
    trim.add((sx * XW, sx * (XW - 0.03)), (YF, YB), (0.0, 0.42))
    for y in (1.0, 2.3, 3.6, 4.9):
        trim.add((sx * XW, sx * (XW - 0.09)), (y, y + 0.16), (0.0, ZC))
trim.add((-XW, -DOOR_W - 0.07), (YB - 0.03, YB), (0.0, 0.42))
trim.add((DOOR_W + 0.07, XW), (YB - 0.03, YB), (0.0, 0.42))
trim.done('trim', 'wall_dark')

# back room behind the caged door: dim, only there to give the centre real depth
br = Boxes()
br.add((-1.7, 1.7), (YB + 2.0, YB + 2.2), (0, ZC))
br.add((-1.9, -1.7), (YB + 0.2, YB + 2.2), (0, ZC))
br.add((1.7, 1.9), (YB + 0.2, YB + 2.2), (0, ZC))
br.done('backroom', 'wall_dark')
shelf = Boxes()
for z in (0.5, 1.05, 1.6):
    shelf.add((-1.5, 1.5), (YB + 1.55, YB + 1.98), (z, z + 0.03))
for x in (-1.5, -0.5, 0.5, 1.5):
    shelf.add((x - 0.02, x + 0.02), (YB + 1.55, YB + 1.59), (0, 2.0))
shelf.done('backshelf', 'gunmetal')
for i, (x, z, p) in enumerate(((-0.9, 0.53, 'c_olive'), (0.35, 0.53, 'c_sand'), (-0.2, 1.08, 'c_slate'), (0.95, 1.08, 'c_olive'), (-1.0, 1.63, 'c_sand'))):
    place(CRATE, (x, YB + 1.76, z), (0, 0, 0), p, 'tan', 'base')

# door frame + cage mesh
frame = Boxes()
frame.add((-DOOR_W - 0.07, -DOOR_W), (YB - 0.05, YB + 0.03), (0, DOOR_H))
frame.add((DOOR_W, DOOR_W + 0.07), (YB - 0.05, YB + 0.03), (0, DOOR_H))
frame.add((-DOOR_W - 0.07, DOOR_W + 0.07), (YB - 0.05, YB + 0.03), (DOOR_H, DOOR_H + 0.08))
frame.add((-DOOR_W, DOOR_W), (YB - 0.035, YB - 0.005), (1.02, 1.1))
frame.add((0.38, 0.56), (YB - 0.06, YB - 0.01), (0.96, 1.16))
frame.done('doorframe', 'gunmetal', 0.006)
cage = Boxes()
x = -DOOR_W + 0.05
while x < DOOR_W:
    cage.add((x - 0.009, x + 0.009), (YB - 0.03, YB - 0.012), (0.02, DOOR_H))
    x += 0.1
z = 0.1
while z < DOOR_H:
    cage.add((-DOOR_W, DOOR_W), (YB - 0.03, YB - 0.012), (z - 0.009, z + 0.009))
    z += 0.1
cage.done('cage', 'gunmetal')

# ----------------------------------------------------------------------------- back wall racks

PANELS = ((-2.25, -0.87), (0.87, 2.25))
slats = Boxes()
for (xa, xb) in PANELS:
    z = 0.52
    while z < 2.36:
        slats.add((xa, xb), (YB - 0.04, YB), (z, z + 0.115))
        z += 0.14
slats.done('slats', 'slat', 0.004)
ptrim = Boxes()
for (xa, xb) in PANELS:
    ptrim.add((xa - 0.03, xb + 0.03), (YB - 0.05, YB), (2.39, 2.43))
    ptrim.add((xa - 0.03, xb + 0.03), (YB - 0.05, YB), (0.46, 0.5))
ptrim.done('paneltrim', 'brass', 0.004)
glow = Boxes()
for (xa, xb) in PANELS:
    glow.add((xa + 0.02, xb - 0.02), (YB - 0.075, YB - 0.055), (2.372, 2.386))
glow.done('panelglow', 'glow')

ROWS = (0.93, 1.42, 1.93)
LEFT = (('bulldog', 'p_sand', 'brass'), ('kestrel', 'p_green', 'tan'), ('longbow', 'p_steel', 'brass'))
RIGHT = (('lynx', 'p_green', 'brass'), ('kodiak', 'p_sand', 'tan'), ('ravager', 'p_steel', 'tan'))
hooks = Boxes()
for panel, guns in zip(PANELS, (LEFT, RIGHT)):
    cx = (panel[0] + panel[1]) / 2
    for z, (wid, paint, accent) in zip(ROWS, guns):
        place(GUNS[wid], (cx, YB - 0.075, z), (0, 0, 0), paint, accent)
        for dx in (-0.27, 0.2):
            hooks.add((cx + dx - 0.012, cx + dx + 0.012), (YB - 0.13, YB - 0.03), (z - 0.055, z - 0.035))
            hooks.add((cx + dx - 0.012, cx + dx + 0.012), (YB - 0.13, YB - 0.115), (z - 0.055, z + 0.0))
hooks.done('hooks', 'gunmetal')

# ----------------------------------------------------------------------------- left wall: lockers

lock = Boxes()
lock2 = Boxes()
ldark = Boxes()
lbrass = Boxes()
lsteel = Boxes()
N_LOCK = 7
for i in range(N_LOCK):
    y0 = 2.36 + i * 0.47
    (lock if i % 2 == 0 else lock2).add((-XW, -2.02), (y0 + 0.008, y0 + 0.462), (0.1, 2.02))
    for k in range(6):
        ldark.add((-2.021, -2.014), (y0 + 0.11, y0 + 0.36), (1.72 + k * 0.036, 1.735 + k * 0.036))
    for k in range(4):
        ldark.add((-2.021, -2.014), (y0 + 0.11, y0 + 0.36), (0.26 + k * 0.036, 0.275 + k * 0.036))
    lbrass.add((-2.024, -2.016), (y0 + 0.17, y0 + 0.3), (1.5, 1.565))
    lsteel.add((-2.05, -2.015), (y0 + 0.385, y0 + 0.41), (0.98, 1.14))
lock.done('lockers_a', 'locker', 0.006)
lock2.done('lockers_b', 'locker2', 0.006)
ldark.done('locker_vents', 'black')
lbrass.done('locker_plates', 'brass')
lsteel.done('locker_handles', 'gunmetal')
box('locker_plinth', (-XW, -2.04), (2.36, 2.36 + N_LOCK * 0.47), (0.0, 0.1), 'wall_dark')
for (y, rz, p) in ((2.9, 1.5708, 'c_olive'), (3.95, 1.62, 'c_sand'), (4.9, 1.52, 'c_slate')):
    place(CRATE, (-2.26, y, 2.035), (0, 0, rz), p, 'tan', 'base')

# crate stack in the left foreground
for (x, y, z, rz, p, a) in ((-1.62, 2.72, 0.014, 0.32, 'c_olive', 'tan'), (-1.02, 3.2, 0.014, -1.2, 'c_sand', 'brass'),
                            (-1.6, 2.76, 0.284, 0.2, 'c_slate', 'tan'), (-1.58, 2.74, 0.554, 0.42, 'c_olive', 'brass')):
    place(CRATE, (x, y, z), (0, 0, rz), p, a, 'base')

# ----------------------------------------------------------------------------- right wall: shelving

rack = Boxes()
SH_Y0, SH_Y1 = 2.9, 5.5
for y in (SH_Y0, 3.77, 4.63, SH_Y1):
    for x in (1.95, 2.45):
        rack.add((x - 0.02, x + 0.02), (y - 0.02, y + 0.02), (0, 2.3))
SHELVES = (0.22, 0.78, 1.34, 1.9)
for z in SHELVES:
    rack.add((1.93, 2.47), (SH_Y0 - 0.02, SH_Y1 + 0.02), (z, z + 0.03))
rack.done('shelving', 'gunmetal', 0.004)
cans = Boxes()
cans2 = Boxes()
rnd = np.random.RandomState(7)
paints = ('c_olive', 'c_sand', 'c_slate', 'c_olive')
for si, z in enumerate(SHELVES):
    y = SH_Y0 + 0.36
    k = 0
    while y < SH_Y1 - 0.3:
        if rnd.rand() < 0.62:
            place(CRATE, (2.2, y, z + 0.044), (0, 0, -1.5708 + (rnd.rand() - 0.5) * 0.12), paints[(si + k) % 4], 'tan' if k % 2 else 'brass', 'base')
            if rnd.rand() < 0.3 and z < 1.8:
                place(CRATE, (2.21, y + 0.02, z + 0.314), (0, 0, -1.5708 + (rnd.rand() - 0.5) * 0.2), paints[(si + k + 1) % 4], 'tan', 'base')
            y += 0.7
        else:
            # ammo cans: two or three small boxes
            for j in range(2 + int(rnd.rand() * 2)):
                tgt = cans if (j + k) % 2 else cans2
                tgt.add((2.06, 2.36), (y - 0.1 + j * 0.2, y + 0.07 + j * 0.2), (z + 0.03, z + 0.22))
            y += 0.62
        k += 1
cans.done('ammo_a', 'c_olive', 0.006)
cans2.done('ammo_b', 'p_grey', 0.006)

# upright long-gun rack in the right foreground
gr = Boxes()
gr.add((1.14, 2.14), (2.5, 2.92), (0.0, 0.12))
gr.add((1.14, 1.19), (2.82, 2.9), (0.12, 1.02))
gr.add((2.09, 2.14), (2.82, 2.9), (0.12, 1.02))
gr.add((1.14, 2.14), (2.84, 2.88), (0.86, 0.92))
gr.done('gunrack', 'gunmetal', 0.006)
for i, (wid, paint, accent) in enumerate((('kodiak', 'p_green', 'tan'), ('bulldog', 'p_sand', 'brass'), ('kestrel', 'p_steel', 'brass'), ('lynx', 'p_green', 'tan'))):
    place(GUNS[wid], (1.3 + i * 0.235, 2.74, 0.13), (0.1, -1.5708, 0.0), paint, accent, 'butt')

# ----------------------------------------------------------------------------- ceiling: lights, beams, services

strips = Boxes()
housing = Boxes()
STRIP_Y = (-0.3, 1.5, 3.3, 5.05)
for sx in (-1.15, 1.15):
    for y in STRIP_Y:
        strips.add((sx - 0.065, sx + 0.065), (y - 0.62, y + 0.62), (ZC - 0.075, ZC - 0.055))
        housing.add((sx - 0.1, sx + 0.1), (y - 0.68, y + 0.68), (ZC - 0.055, ZC))
strips.done('strips', 'strip')
housing.done('strip_housing', 'gunmetal')
beams = Boxes()
for y in (0.6, 2.4, 4.2):
    beams.add((-XW, XW), (y - 0.08, y + 0.08), (ZC - 0.16, ZC))
beams.add((-0.22, 0.22), (YF, YB), (ZC - 0.3, ZC - 0.02))
beams.done('beams', 'ceiling')
pipes = Boxes()
for sx in (-1, 1):
    pipes.cyl((sx * (XW - 0.1), YF, ZC - 0.22), (sx * (XW - 0.1), YB, ZC - 0.22), 0.035)
    pipes.cyl((sx * (XW - 0.2), YF, ZC - 0.14), (sx * (XW - 0.2), YB, ZC - 0.14), 0.022)
pipes.done('pipes', 'gunmetal', smooth=True)
bp = Boxes()
bp.cyl((-XW, YB - 0.06, 2.62), (XW, YB - 0.06, 2.62), 0.03)
bp.done('backpipe', 'brass', smooth=True)

# caged wall lamps: the warm accents, high on the side walls and beside the door
lamps = Boxes()
lampcage = Boxes()
LAMPS = [(sx * (XW - 0.06), y, 2.42, sx) for sx in (-1, 1) for y in (3.25, 4.7)]
for (x, y, z, sx) in LAMPS:
    lamps.add((x - 0.035, x + 0.035), (y - 0.09, y + 0.09), (z - 0.05, z + 0.05))
    lampcage.add((x - 0.06, x + 0.06), (y - 0.12, y + 0.12), (z + 0.055, z + 0.08))
    lampcage.add((x - 0.06, x + 0.06), (y - 0.12, y + 0.12), (z - 0.08, z - 0.055))
lamps.done('lamps', 'warm')
lampcage.done('lampcage', 'gunmetal')

# floor guide lines converge on the vanishing point
lines = Boxes()
for sx in (-1, 1):
    lines.add((sx * 1.72 - 0.035, sx * 1.72 + 0.035), (0.2, YB - 0.2), (0.0, 0.003))
lines.add((-1.72, 1.72), (YB - 0.5, YB - 0.43), (0.0, 0.003))
lines.done('lines', 'line')

# ----------------------------------------------------------------------------- lights

def area(name, loc, size, power, color, rot=(0, 0, 0)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size = size[0]
    ld.size_y = size[1]
    ld.energy = power
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    col.objects.link(ob)
    return ob


def spot(name, loc, target, power, color, size_deg=62.0):
    ld = bpy.data.lights.new(name, 'SPOT')
    ld.energy = power
    ld.color = color
    ld.spot_size = math.radians(size_deg)
    ld.spot_blend = 0.6
    ld.shadow_soft_size = 0.08
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    col.objects.link(ob)
    return ob


def point(name, loc, power, color, radius=0.06):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = power
    ld.color = color
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    col.objects.link(ob)
    return ob


COOL = (0.82, 0.92, 1.0)
WARM = (1.0, 0.62, 0.28)
for sx in (-1.15, 1.15):
    for y in STRIP_Y:
        area('A_strip', (sx, y, ZC - 0.09), (0.13, 1.24), 46.0, COOL)
for (x, y, z, sx) in LAMPS:
    point('P_lamp', (x - sx * 0.12, y, z - 0.02), 22.0, WARM)
point('P_backroom', (0.0, YB + 1.0, 2.3), 3.5, WARM, 0.1)
point('P_rack', (1.45, 2.25, 1.35), 5.0, WARM, 0.1)
for (xa, xb) in PANELS:
    spot('S_panel', ((xa + xb) / 2, YB - 1.35, 2.72), ((xa + xb) / 2, YB, 1.4), 26.0, WARM)
    area('A_panel', ((xa + xb) / 2, YB - 0.11, 2.36), (xb - xa - 0.1, 0.04), 9.0, WARM, (math.radians(-14.0), 0.0, 0.0))

world = sc.world
try:
    world.use_nodes = True
except Exception:
    pass
bg = world.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.004, 0.005, 0.006, 1.0)
    bg.inputs['Strength'].default_value = 1.0

# ----------------------------------------------------------------------------- camera

cam_d = bpy.data.cameras.new('Cam')
cam_d.lens = 22.0
cam_d.sensor_width = 36.0
cam_d.sensor_fit = 'HORIZONTAL'
cam_d.shift_y = -0.035
cam_d.clip_start = 0.05
cam_d.clip_end = 60.0
cam_d.dof.use_dof = True
cam_d.dof.focus_distance = 1.2
cam_d.dof.aperture_fstop = 2.0
cam = bpy.data.objects.new('Cam', cam_d)
cam.location = (0.0, 0.0, 1.42)
cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
col.objects.link(cam)
sc.camera = cam
bpy.context.view_layer.update()
print('SCENE BUILT', len(bpy.data.objects), 'objects', round(time.time() - T0, 1), 's')

if DRY:
    print('DRY RUN OK')
    sys.exit(0)

# ----------------------------------------------------------------------------- colour render

def set_view(names, looks):
    for n in names:
        try:
            sc.view_settings.view_transform = n
            break
        except Exception:
            continue
    for lk in looks:
        try:
            sc.view_settings.look = lk
            break
        except Exception:
            continue


scale = 0.5 if QUICK else 1.0
sc.render.resolution_x = int(W * scale)
sc.render.resolution_y = int(H * scale)
sc.render.resolution_percentage = 100
sc.render.film_transparent = False
sc.render.image_settings.color_mode = 'RGB'
sc.render.image_settings.color_depth = '8'
sc.cycles.samples = 64 if QUICK else 224
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.04 if QUICK else 0.02
sc.cycles.use_denoising = True
try:
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
sc.cycles.max_bounces = 6
sc.cycles.diffuse_bounces = 3
sc.cycles.glossy_bounces = 3
sc.cycles.transmission_bounces = 2
sc.cycles.sample_clamp_indirect = 6.0
set_view(('AgX', 'Filmic', 'Standard'), ('AgX - High Contrast', 'High Contrast', 'AgX - Medium High Contrast', 'Medium High Contrast', 'None'))
print('VIEW', sc.view_settings.view_transform, '/', sc.view_settings.look)
sc.view_settings.exposure = -0.9
sc.view_settings.gamma = 1.0
bpy.context.view_layer.material_override = None

png = os.path.join(TMP, 'armory_c.png')
sc.render.filepath = png
bpy.ops.render.render(write_still=True)
print('COLOUR RENDERED', round(time.time() - T0, 1), 's')
C = gunkit._load(png)
rgb = np.clip(np.round(C[..., :3] * 255.0), 0, 255)
step = 1 if QUICK else 2
gunkit._save(rgb[::step, ::step], os.path.join(TMP, 'armory_preview.jpg'))
lum = (0.2126 * C[..., 0] + 0.7152 * C[..., 1] + 0.0722 * C[..., 2])
hh, ww = lum.shape
centre = lum[hh // 4: 3 * hh // 4, ww // 5: 4 * ww // 5]
print('LUMA mean %.3f  centre %.3f  p95 %.3f  max %.3f' % (lum.mean(), centre.mean(), np.percentile(lum, 95), lum.max()))
if QUICK:
    print('QUICK DONE')
    sys.exit(0)
# quality 90: the frame is dark and soft, so lower settings band in the gradients
gunkit._save(rgb, os.path.join(OUT, 'armory.webp'), 90)

# ----------------------------------------------------------------------------- depth pass

def depth_mat(max_d):
    m = gunkit._emit('PASS_depth', (0, 0, 0))
    nt = m.node_tree
    em = [n for n in nt.nodes if n.type == 'EMISSION'][0]
    cd = nt.nodes.new('ShaderNodeCameraData')
    div = nt.nodes.new('ShaderNodeMath')
    div.operation = 'DIVIDE'
    div.inputs[1].default_value = max_d
    nt.links.new(cd.outputs['View Z Depth'], div.inputs[0])
    nt.links.new(div.outputs['Value'], em.inputs['Color'])
    return m


def dilate(a, r):
    """Grow near (bright) regions by r pixels so the soft, defocused edges of foreground
    props in the colour image move with the prop instead of tearing off it."""
    p = np.pad(a, r, mode='edge')
    out = a.copy()
    hh2, ww2 = a.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r + 1:
                out = np.maximum(out, p[r + dy: r + dy + hh2, r + dx: r + dx + ww2])
    return out


MAX_D = 12.0
# the cage would make the doorway flicker between bar depth and back-room depth; for
# parallax treat the whole doorway as one surface at the wall
box('door_fill', (-DOOR_W, DOOR_W), (YB - 0.012, YB + 0.01), (0, DOOR_H), 'black')
cam_d.dof.use_dof = False
sc.render.resolution_x = W // 2
sc.render.resolution_y = H // 2
sc.cycles.samples = 24
sc.cycles.use_adaptive_sampling = False
sc.cycles.use_denoising = False
sc.cycles.max_bounces = 0
sc.view_settings.view_transform = 'Raw'
try:
    sc.view_settings.look = 'None'
except Exception:
    pass
sc.view_settings.exposure = 0.0
sc.render.image_settings.color_mode = 'RGB'
sc.render.image_settings.color_depth = '16'
bpy.context.view_layer.material_override = depth_mat(MAX_D)
dpng = os.path.join(TMP, 'armory_z.png')
sc.render.filepath = dpng
bpy.ops.render.render(write_still=True)
Z = gunkit._load(dpng)[..., 0] * MAX_D
zmin, zmax = np.percentile(Z, 0.5), np.percentile(Z, 99.5)
d = 1.0 - np.clip((Z - zmin) / max(zmax - zmin, 1e-6), 0.0, 1.0)
d = gunkit._blur(gunkit._blur(dilate(d, 2), 2), 1)
d8 = np.clip(np.round(d * 255.0), 0, 255)
gunkit._save(d8, os.path.join(OUT, 'armory_d.webp'), 90)
gunkit._save(d8, os.path.join(TMP, 'armory_depth_preview.jpg'))
for p in (png, dpng):
    try:
        os.remove(p)
    except OSError:
        pass
print('DEPTH range %.2f .. %.2f m' % (zmin, zmax))
print('SIZES', os.path.getsize(os.path.join(OUT, 'armory.webp')), os.path.getsize(os.path.join(OUT, 'armory_d.webp')))
print('DONE', round(time.time() - T0, 1), 's')
