# Exports the real-time meshes used by the in-game 3D view:
#   blender --background --factory-startup --python art/export_meshes.py -- [ids...] [--lod=0.6]
# Each weapon is built twice: once at full detail to recover the exact sprite bake camera,
# then at reduced detail for the mesh itself.
import sys, os, json, time, traceback, importlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gunkit  # noqa: E402
import weapons  # noqa: E402

for extra in ('weapons_guns', 'weapons_melee'):
    if os.path.exists(os.path.join(HERE, extra + '.py')):
        importlib.import_module(extra)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ids = [a for a in argv if not a.startswith('--')] or list(weapons.WEAPONS.keys())
lod = float(next((a.split('=', 1)[1] for a in argv if a.startswith('--lod=')), 0.6))
OUT = os.path.join(HERE, '..', 'public', 'models')


def harden():
    """Triangulate boolean-cut parts before the bevel so pocket caps tessellate correctly."""
    for ob in gunkit._parts:
        mods = [m.type for m in ob.modifiers]
        if 'BOOLEAN' in mods and 'TRIANGULATE' not in mods:
            m = ob.modifiers.new('Tri', 'TRIANGULATE')
            m.min_vertices = 5


report = {}
for wid in ids:
    fn, cam = weapons.WEAPONS[wid]
    t0 = time.time()
    try:
        gunkit.LOD = 1.0
        gunkit.reset()
        fn()
        gunkit.finalize()
        gunkit._fit_camera(cam.get('yaw', 14.0), cam.get('pitch', 11.0), cam.get('margin', 1.07), cam.get('roll', 0.0))
        camdata = dict(gunkit.LAST_CAM)
        gunkit.LOD = lod
        gunkit.reset()
        fn()
        harden()
        gunkit.finalize()
        # the gloves are many remeshed blobs: cap each part harder so the file stays small
        info = gunkit.export_mesh(wid, OUT, camdata, 1300 if wid in ('gauntlet', 'wraps') else 7000)
        info['sec'] = round(time.time() - t0, 1)
        report[wid] = info
        print('MESH', wid, json.dumps(info))
    except Exception:
        traceback.print_exc()
        report[wid] = {'error': traceback.format_exc()[-500:]}
gunkit.LOD = 1.0
print('DONE', json.dumps(report))
