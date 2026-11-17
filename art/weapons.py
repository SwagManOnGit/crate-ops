# Weapon models for Crate Ops. Every design here is original and fictional.
# Kit space: x along the barrel (muzzle = +x), y up, z toward the viewer, centimetres.
from gunkit import *  # noqa: F401,F403

WEAPONS = {}


def weapon(wid, **cam):
    def deco(fn):
        WEAPONS[wid] = (fn, cam)
        return fn
    return deco


def ridges(target, name, x0, x1, y0, y1, zs, pitch=0.55, th=0.22, slant=0.0, depth=0.14, tag='poly'):
    """Horizontal grip ridges cut into the viewer-facing surface."""
    cells = []
    y = y0
    while y < y1:
        cells.append([(x0 + slant * (y - y0), y), (x1 + slant * (y - y0), y),
                      (x1 + slant * (y + th - y0), y + th), (x0 + slant * (y + th - y0), y + th)])
        y += pitch
    return slots(target, name, cells, zs - depth, zs + 1.0, tag)


def serrations(target, name, x0, x1, y0, y1, zs, pitch=0.5, th=0.2, lean=0.25, depth=0.12, tag='steel'):
    """Slanted vertical grooves (slide serrations, knurling)."""
    cells = []
    x = x0
    while x < x1:
        cells.append([(x, y0), (x + th, y0), (x + th + lean, y1), (x + lean, y1)])
        x += pitch
    return slots(target, name, cells, zs - depth, zs + 1.0, tag)


def screws(name, pts, z, r=0.24, tag='steel', h=0.1):
    b = B()
    for (x, y) in pts:
        b.pin(x, y, z - 0.1, z + h, r)
    ob = b.done(name, tag, 0.04, 2)
    sl = cutter(name + '_slot', 'poly')
    for (x, y) in pts:
        sl.prism(rect(x - r * 0.7, x + r * 0.7, y - r * 0.14, y + r * 0.14), z + h - 0.05, z + h + 0.5)
    cut(ob, cut_done(sl))
    return ob


# =============================================================================
# KESTREL AR  (modern carbine)
# =============================================================================
@weapon('kestrel')
def kestrel():
    # barrel + muzzle device
    tube('barrel', 41, 79.5, 0, 0.82, 'steel')
    mz = tube('muzzle', 79.0, 85.6, 0, 1.14, 'steel', bevel=0.14)
    slots(mz, 'mz_cut', [rect(80.6 + i * 1.5, 81.4 + i * 1.5, -0.55, 0.55) for i in range(3)], 0.4, 3, 'poly', r=0.2)
    tube('crown', 85.4, 86.1, 0, 0.9, 'steel', bevel=0.1)
    tube('gasblock', 67.6, 70.4, 0, 1.25, 'steel', bevel=0.12)

    # handguard with cooling slots
    hg = solid('handguard', [(42.2, -2.95, 0.3), (65.4, -2.75, 0.5), (67.2, -1.7, 0.4), (67.2, 1.9, 0.5),
                             (66.2, 2.5, 0.2), (42.2, 2.5, 0.1)], 2.0, 'paint', bevel=0.3, seg=4)
    cells = []
    for i in range(5):
        x = 44.3 + i * 4.4
        cells.append(rect(x, x + 3.0, 0.55, 1.5))
        cells.append(rect(x + 0.9, x + 3.9, -1.75, -0.8))
    slots(hg, 'hg_slots', cells, 1.35, 4, 'poly', r=0.42)
    screws('hg_screws', [(43.3, -1.9), (43.3, 0.2), (65.6, 0.1)], 2.0, 0.26)

    # receiver set
    up = solid('upper', [(21.4, -2.4), (42.2, -2.4), (42.2, 2.5, 0.2), (23.2, 2.5, 0.5), (21.4, 1.3, 0.4)],
               1.46, 'paint', bevel=0.26, seg=4)
    slots(up, 'port', [rect(30.6, 37.2, -1.05, 0.95)], 1.05, 3, 'bright', r=0.3)
    plate('dustcover', [(30.2, -1.75), (37.6, -1.75), (37.6, -1.2), (30.2, -1.2)], 1.46, 0.16, 'accent', r=0.15)
    plate('deflector', [(37.9, -1.0, 0.2), (39.6, -0.2, 0.3), (39.6, 1.0, 0.2), (37.9, 1.0, 0.1)], 1.46, 0.3, 'paint', bevel=0.1)
    pin('fwd_assist', 26.6, -0.6, 1.3, 1.95, 0.55, 'accent', bevel=0.1)
    low = solid('lower', [(19.4, -2.4), (19.4, -4.3, 0.5), (22.0, -5.9, 0.6), (26.6, -6.05, 0.2), (32.6, -6.05, 0.3),
                          (33.0, -8.9, 0.3), (40.7, -9.7, 0.5), (41.7, -5.2, 0.6), (42.2, -2.4)],
                1.36, 'paint', bevel=0.22, seg=4)
    plate('magwell_fence', [(33.3, -8.6, 0.2), (40.5, -9.3, 0.3), (41.3, -5.4, 0.4), (38.2, -5.0, 0.4), (33.3, -6.2, 0.2)],
          1.36, 0.14, 'paint', bevel=0.08)
    tube('ext_ring', 17.4, 21.6, 0.35, 1.8, 'paint', bevel=0.16)
    tube('buffer', 4.0, 18.0, 0.35, 1.34, 'steel', bevel=0.08)
    solid('charging', [(19.3, 1.95), (23.6, 1.95), (23.6, 2.62), (19.3, 2.62)], 1.75, 'accent', bevel=0.12, r=0.15)
    rail('toprail', 23.6, 66.4, 2.5)
    pin('pin_rear', 22.8, -3.5, 1.2, 1.48, 0.36, 'steel')
    pin('pin_front', 40.2, -3.4, 1.2, 1.48, 0.36, 'steel')
    pin('selector_hub', 26.0, -4.4, 1.2, 1.56, 0.42, 'accent')
    plate('selector', rot([(25.7, -4.62), (28.4, -4.62), (28.4, -4.18), (25.7, -4.18)], -32, 26.0, -4.4), 1.5, 0.14, 'accent', r=0.18)
    plate('magrelease', rect(34.4, 36.0, -4.75, -3.75), 1.36, 0.2, 'accent', r=0.2)
    plate('boltcatch', [(31.2, -3.3), (32.5, -3.3), (32.5, -2.6), (31.2, -2.6)], 1.36, 0.16, 'steel', r=0.12)

    # trigger group
    solid('guard', stroke([(26.6, -6.4), (27.3, -9.25), (32.9, -9.0)], 0.5), 0.62, 'paint', bevel=0.1, r=0.12)
    solid('trigger', [(29.7, -6.0), (30.6, -6.0), (30.4, -7.4), (29.7, -8.45), (29.25, -8.25), (29.75, -7.3)],
          0.3, 'accent', bevel=0.08, r=0.12)

    # grip
    gr = solid('grip', [(22.3, -5.7, 0.2), (26.9, -5.9, 0.2), (26.4, -7.6, 0.5), (23.6, -15.3, 0.7), (18.9, -15.1, 0.7),
                        (20.4, -9.2, 1.5), (21.3, -6.5, 0.4)], 1.3, 'poly', bevel=0.3, seg=4)
    ridges(gr, 'grip_ridges', 20.4, 25.2, -14.2, -8.2, 1.3, pitch=0.62, th=0.26, slant=-0.3)

    # magazine
    mg = solid('mag', [(33.7, -7.6), (39.9, -8.2), (40.9, -15.0), (42.5, -21.4, 0.4), (36.3, -22.6, 0.4), (34.5, -15.4)],
               1.02, 'paint', bevel=0.16)
    plate('mag_rib1', stroke([(36.1, -10.2), (37.0, -15.6), (38.6, -21.3)], 0.55), 1.02, 0.1, 'paint', bevel=0.04)
    plate('mag_rib2', stroke([(38.3, -10.4), (39.2, -15.6), (40.8, -21.0)], 0.55), 1.02, 0.1, 'paint', bevel=0.04)
    solid('mag_base', [(35.8, -22.3), (42.9, -21.0), (43.1, -22.0), (36.0, -23.4)], 1.16, 'poly', bevel=0.14, r=0.2)

    # stock
    st = solid('stock', [(0.7, -7.7, 0.5), (0.0, -6.0, 0.4), (0.0, 1.3, 0.6), (1.4, 2.45, 0.4), (15.6, 2.45, 0.3),
                         (16.4, 1.7, 0.3), (16.4, -1.5, 0.4), (12.2, -2.0, 0.6), (5.3, -8.0, 0.6)],
               1.52, 'paint', bevel=0.28, seg=4)
    slots(st, 'stock_hole', [[(3.0, -2.5), (10.4, -2.6), (3.4, -6.7)]], -3, 3, 'poly', r=0.7)
    solid('buttpad', [(-0.95, -7.7), (0.35, -7.7), (0.35, 1.2), (-0.95, 1.2)], 1.56, 'rubber', bevel=0.22, r=0.3)
    plate('cheek', [(3.0, 1.7), (14.6, 1.7), (14.6, 2.3), (3.0, 2.3)], 1.52, 0.1, 'accent', r=0.2)
    plate('stock_latch', [(10.8, -2.9), (15.6, -2.3), (15.6, -1.75), (10.8, -2.35)], 1.4, 0.2, 'accent', r=0.15)

    # sights
    box('rs_base', 24.4, 27.4, 2.95, 3.55, 0.95, 'poly', bevel=0.08)
    rs = solid('rs_leaf', [(25.2, 3.5), (26.9, 3.5), (26.7, 5.5, 0.3), (25.4, 5.5, 0.3)], 0.5, 'poly', bevel=0.08)
    slots(rs, 'rs_hole', [arc(26.05, 4.75, 0.32, 0, 360, 16)[:-1]], -2, 2, 'poly')
    box('fs_base', 62.2, 65.2, 2.95, 3.55, 0.95, 'poly', bevel=0.08)
    solid('fs_post', [(62.9, 3.5), (64.7, 3.5), (64.3, 5.4, 0.2), (63.3, 5.4, 0.2)], 0.42, 'poly', bevel=0.08)


# =============================================================================
# VIPER-9  (compact striker pistol)
# =============================================================================
@weapon('viper')
def viper():
    sl = solid('slide', [(0.0, -1.3), (19.2, -1.3, 0.2), (19.7, -0.5, 0.3), (19.7, 1.45, 0.4), (18.9, 2.15, 0.3),
                         (0.9, 2.15, 0.4), (0.0, 1.3, 0.3)], 1.32, 'paint', bevel=0.26, seg=4)
    serrations(sl, 'ser_rear', 1.3, 4.9, -1.0, 1.75, 1.32, pitch=0.62, th=0.3, lean=0.5, tag='poly')
    serrations(sl, 'ser_front', 15.0, 17.6, -1.0, 1.75, 1.32, pitch=0.62, th=0.3, lean=0.5, tag='poly')
    slots(sl, 'port', [rect(8.6, 13.4, 0.55, 3.0)], 0.75, 3, 'bright', r=0.25)
    slots(sl, 'slide_cut', [[(5.9, -0.4), (7.5, -0.4), (7.9, 1.2), (6.3, 1.2)]], 1.14, 3, 'poly', r=0.2)
    box('sight_rear', 0.7, 2.1, 2.1, 2.72, 0.9, 'poly', bevel=0.1)
    box('sight_front', 18.0, 18.9, 2.1, 2.62, 0.32, 'accent', bevel=0.08)
    tube('muzzle', 19.3, 20.0, 0.25, 0.62, 'steel', bevel=0.1)
    tube('guiderod', 19.4, 19.85, -0.85, 0.3, 'steel', bevel=0.06)

    fr = solid('frame', [(0.5, -1.3), (19.1, -1.3), (19.1, -2.95, 0.35), (13.3, -3.2, 0.2), (12.9, -3.75, 0.1), (8.5, -3.75, 0.5),
                         (5.7, -12.7, 0.5), (-1.2, -13.5, 0.6), (1.5, -5.0, 1.6), (-1.0, -3.2, 0.5), (-1.05, -2.2, 0.3)],
               1.25, 'paint', bevel=0.26, seg=4)
    slots(fr, 'rail_notch', [rect(14.6 + i * 1.2, 15.1 + i * 1.2, -3.4, -2.55) for i in range(3)], 0.6, 3, 'poly')
    gp = plate('grip_panel', [(7.2, -5.2, 0.5), (4.9, -12.0, 0.5), (0.2, -12.5, 0.5), (2.6, -5.4, 1.0)], 1.25, 0.1, 'poly', bevel=0.06)
    ridges(gp, 'grip_tex', -0.5, 8.0, -12.2, -5.6, 1.35, pitch=0.46, th=0.2, depth=0.07)
    solid('guard', stroke([(12.8, -3.5), (13.2, -6.3), (12.1, -7.5), (8.6, -7.35), (7.6, -6.5)], 0.52), 0.78, 'paint', bevel=0.12, r=0.3)
    solid('trigger', [(10.3, -3.6), (11.15, -3.6), (10.95, -5.2), (10.25, -6.4), (9.8, -6.15), (10.3, -5.1)],
          0.32, 'accent', bevel=0.08, r=0.12)
    solid('mag_base', [(-1.75, -13.25), (5.95, -12.4), (6.15, -13.4), (-1.55, -14.35)], 1.32, 'poly', bevel=0.18, r=0.25)
    plate('slide_stop', [(8.0, -2.05), (11.6, -2.05), (11.9, -1.55), (8.0, -1.55)], 1.25, 0.14, 'accent', r=0.12)
    plate('takedown', rect(12.6, 13.5, -2.6, -1.9), 1.25, 0.12, 'steel', r=0.12)
    plate('mag_release', arc(7.9, -4.9, 0.55, 0, 360, 16)[:-1], 1.25, 0.16, 'accent')
    screws('pins', [(3.6, -2.6), (10.4, -2.75)], 1.25, 0.2)


# =============================================================================
# SUPPLY CRATE  (the loot crate itself; painted per crate tier like a skin)
# =============================================================================
@weapon('crate', yaw=31, pitch=23, margin=1.1, ao_dist=9.0)
def crate():
    D = 17.0
    body = box('body', 0, 60, 0, 15.2, D, 'paint', bevel=0.9)
    lid = box('lid', 0, 60, 15.9, 25.5, D, 'paint', bevel=0.9)
    box('gasket', 0.7, 59.3, 13.5, 17.5, D - 0.7, 'rubber', bevel=0.2)
    # stacking ribs, front face
    for i, x in enumerate((5.5, 13.0, 44.0, 51.5)):
        plate('rib_b%d' % i, rect(x, x + 3.0, 1.2, 14.2), D, 0.55, 'paint', bevel=0.22, r=0.4)
        plate('rib_l%d' % i, rect(x, x + 3.0, 16.9, 24.3), D, 0.55, 'paint', bevel=0.22, r=0.4)
    # ribs across the lid top and down the right side
    for i, x in enumerate((5.5, 13.0, 44.0, 51.5)):
        B().prism(rect(x, x + 3.0, 25.2, 26.05), -D + 1.2, D - 1.2).done('top_rib%d' % i, 'paint', 0.2)
    for i, z in enumerate((-11.0, -3.5, 4.0, 11.5)):
        B().prism(rect(59.7, 60.55, 1.2, 14.2), z - 1.5, z + 1.5).done('side_rib_b%d' % i, 'paint', 0.2)
        B().prism(rect(59.7, 60.55, 16.9, 24.3), z - 1.5, z + 1.5).done('side_rib_l%d' % i, 'paint', 0.2)
    # colour band + label panel
    plate('band', rect(17.2, 42.8, 17.3, 23.9), D, 0.3, 'accent', bevel=0.12, r=0.5)
    B().prism(rect(18.5, 41.5, 25.3, 25.75), -11.5, 11.5, r=0.0).done('top_panel', 'accent', 0.12)
    # corner guards
    for i, (xa, xb) in enumerate(((-0.7, 3.4), (56.6, 60.7))):
        B().prism(rect(xa, xb, -0.4, 25.9), D - 3.2, D + 0.7, r=0.6).done('guard_f%d' % i, 'poly', 0.45)
        B().prism(rect(xa, xb, -0.4, 25.9), -D - 0.7, -D + 3.2, r=0.6).done('guard_b%d' % i, 'poly', 0.45)
    # latches
    for i, x in enumerate((20.5, 35.5)):
        plate('latch_base%d' % i, rect(x, x + 4.0, 10.6, 15.0), D, 0.4, 'steel', bevel=0.12, r=0.4)
        plate('latch_arm%d' % i, [(x + 0.5, 12.2), (x + 3.5, 12.2), (x + 3.5, 19.6, 0.8), (x + 0.5, 19.6, 0.8)], D + 0.35, 0.5, 'steel', bevel=0.16)
        plate('latch_tab%d' % i, rect(x + 0.9, x + 3.1, 12.6, 14.2), D + 0.8, 0.3, 'accent', bevel=0.1, r=0.3)
    # carry handle
    plate('handle_l', rect(25.6, 27.4, 5.0, 9.2), D, 0.9, 'steel', bevel=0.2, r=0.3)
    plate('handle_r', rect(32.6, 34.4, 5.0, 9.2), D, 0.9, 'steel', bevel=0.2, r=0.3)
    B().prism(stroke([(26.5, 8.2), (26.5, 4.2), (33.5, 4.2), (33.5, 8.2)], 1.3), D + 0.8, D + 2.0, r=0.5).done('handle', 'rubber', 0.35)
    screws('lid_screws', [(2.0, 23.6), (58.0, 23.6), (2.0, 2.0), (58.0, 2.0)], D + 0.7, 0.45)
    # skids
    box('skid_l', 5, 12, -1.4, 0.3, D - 1.0, 'poly', bevel=0.3)
    box('skid_r', 48, 55, -1.4, 0.3, D - 1.0, 'poly', bevel=0.3)
