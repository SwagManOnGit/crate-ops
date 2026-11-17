# Bakes weapon sprites:
#   blender --background --factory-startup --python art/render.py -- [ids...] [--sheet=name]
# With no ids every registered weapon is baked. --sheet writes art/out/sheet_<name>.jpg,
# a contact sheet of the lit previews for a quick visual check.
import sys, os, json, time, traceback, importlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np  # noqa: E402
import gunkit  # noqa: E402
import weapons  # noqa: E402

for extra in ('weapons_guns', 'weapons_melee'):
    if os.path.exists(os.path.join(HERE, extra + '.py')):
        importlib.import_module(extra)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ids = [a for a in argv if not a.startswith('--')] or list(weapons.WEAPONS.keys())
sheet = next((a.split('=', 1)[1] for a in argv if a.startswith('--sheet=')), None)
OUT = os.path.join(HERE, '..', 'public', 'weapons')
TMP = os.path.join(HERE, 'out')
report = {}
for wid in ids:
    fn, cam = weapons.WEAPONS[wid]
    t0 = time.time()
    try:
        gunkit.reset()
        fn()
        info = gunkit.bake(wid, OUT, TMP, **cam)
        info['sec'] = round(time.time() - t0, 1)
        report[wid] = info
        print('BAKED', wid, json.dumps(info))
    except Exception:
        traceback.print_exc()
        report[wid] = {'error': traceback.format_exc()[-600:]}

if sheet:
    cells = [gunkit.PREVIEWS[w][::2, ::2] for w in ids if w in gunkit.PREVIEWS]
    if cells:
        if len(cells) % 2:
            cells.append(np.zeros_like(cells[0]))
        rows = [np.hstack(cells[i:i + 2]) for i in range(0, len(cells), 2)]
        gunkit._save(np.vstack(rows), os.path.join(TMP, 'sheet_%s.jpg' % sheet))
print('DONE', json.dumps(report))
