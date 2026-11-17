# Firearm models for Crate Ops (second batch). Every design is an original, generic archetype.
# Kit space: x along the barrel (muzzle = +x), y up, z toward the viewer, centimetres.
import math
import gunkit
from gunkit import *  # noqa: F401,F403
from weapons import weapon, ridges, serrations, screws


# ----------------------------------------------------------------------------- helpers

def _harden_cuts():
    """Triangulate n-gons on every boolean-cut part before finalize() adds the bevel.

    Without this, Bevel sometimes leaves the big cap n-gon (the one with pockets cut into
    it) in a state Cycles tessellates wrongly: the cap is drawn across the pockets, so
    vents and lens recesses vanish from the bake. Triangulating first is robust.
    """
    for ob in gunkit._parts:
        mods = [m.type for m in ob.modifiers]
        if 'BOOLEAN' in mods and 'TRIANGULATE' not in mods:
            m = ob.modifiers.new('Tri', 'TRIANGULATE')
            m.quad_method = 'BEAUTY'
            m.ngon_method = 'BEAUTY'
            m.min_vertices = 5


def gun(wid, **cam):
    """Like @weapon, but hardens boolean cuts once the model is built."""
    def deco(fn):
        def build():
            fn()
            _harden_cuts()
        build.__name__ = fn.__name__
        return weapon(wid, **cam)(build)
    return deco


def rivets(name, pts, z, r=0.2, tag='steel', h=0.09):
    """Small domed rivet heads on the viewer-facing surface."""
    b = B()
    for (x, y) in pts:
        b.pin(x, y, z - 0.1, z + h, r, r * 0.62)
    return b.done(name, tag, 0.03, 2)


def holes(target, name, pts, r, z0, z1, tag='poly'):
    """Round pockets / through-holes pointing at the viewer."""
    b = cutter(name, tag)
    for (x, y) in pts:
        b.pin(x, y, z0, z1, r)
    return cut(target, cut_done(b))


def flutes(target, name, x0, x1, y, R, r, angles, tag='steel'):
    """Lengthwise grooves around a cylinder whose axis is at height y."""
    b = cutter(name, tag)
    for a in angles:
        b.tube(x0, x1, y + R * math.sin(math.radians(a)), R * math.cos(math.radians(a)), r, seg=20)
    return cut(target, cut_done(b))


def lens(target, name, x0, x1, y, r):
    """Recess the end of an optic tube and give the pocket a bright glass face."""
    c = cutter(name, 'bright')
    c.tube(x0, x1, y, 0.0, r)
    return cut(target, cut_done(c))


def trigger(name, x, y, tag='accent', hw=0.3):
    """Curved trigger blade hanging from (x, y)."""
    return solid(name, [(x, y), (x + 0.9, y), (x + 0.72, y - 1.45), (x + 0.02, y - 2.6), (x - 0.44, y - 2.38),
                        (x + 0.06, y - 1.35)], hw, tag, bevel=0.08, r=0.12)


def aperture(name, x, y, tag='poly'):
    """Folding rear aperture sight standing on a rail at height y."""
    box(name + '_base', x - 1.5, x + 1.5, y + 0.45, y + 1.0, 0.92, tag, bevel=0.08)
    leaf = solid(name + '_leaf', [(x - 0.85, y + 0.95), (x + 0.85, y + 0.95), (x + 0.65, y + 2.9, 0.3), (x - 0.65, y + 2.9, 0.3)],
                 0.5, tag, bevel=0.08)
    holes(leaf, name + '_hole', [(x, y + 2.15)], 0.32, -2, 2, tag)
    return leaf


# =============================================================================
# MAGNATE .44  (heavy revolver)
# =============================================================================
@gun('magnate', margin=1.1)
def magnate():
    # barrel group: round barrel, vented top rib, full underlug
    tube('barrel', 14.4, 29.6, 0, 1.05, 'paint', bevel=0.12)
    tube('crown', 29.4, 30.2, 0, 0.74, 'steel', bevel=0.1)
    b = B()
    b.tube(14.4, 24.4, -1.8, 0, 0.8)
    b.tube(24.3, 27.2, -1.8, 0, 0.8, 0.4)
    b.done('underlug', 'paint', 0.1)
    tube('ejector_tip', 27.0, 27.9, -1.8, 0.3, 'steel', bevel=0.08, seg=20)
    solid('web', rect(14.6, 25.6, -1.8, 0.0), 0.6, 'paint', bevel=0.05)
    rib = solid('rib', [(14.6, 0.7), (29.3, 0.7), (29.3, 1.5, 0.2), (16.4, 1.9, 0.3), (14.6, 1.9)], 0.46, 'paint', bevel=0.1)
    slots(rib, 'rib_vents', [rect(17.0 + i * 2.7, 19.0 + i * 2.7, 1.1, 1.4) for i in range(4)], -3, 3, 'poly', r=0.12)
    solid('front_sight', [(26.4, 1.5), (29.1, 1.5), (29.1, 2.6, 0.15), (28.4, 2.6, 0.1)], 0.24, 'accent', bevel=0.06)
    plate('barrel_flat', [(16.0, -0.42), (27.6, -0.42), (27.6, 0.42), (16.0, 0.42)], 0.98, 0.14, 'paint', r=0.3)

    # frame with cylinder window
    fr = solid('frame', [(15.0, 2.45, 0.4), (5.8, 2.45, 0.5), (4.3, 1.5, 0.6), (3.5, -0.6, 0.5), (3.2, -3.0, 0.6),
                         (4.4, -4.75, 0.4), (13.6, -4.75, 0.5), (15.0, -3.6, 0.4)], 0.98, 'paint', bevel=0.22, seg=4)
    slots(fr, 'window', [rect(7.25, 13.15, -3.6, 1.3)], -3, 3, 'poly', r=0.25)
    plate('sideplate', [(4.6, -0.5, 0.5), (6.8, -0.5, 0.3), (6.8, -4.25, 0.3), (5.0, -4.25, 0.5), (3.95, -2.6, 0.5)],
          0.98, 0.1, 'paint', bevel=0.05)
    plate('latch', [(4.6, 0.25), (6.3, 0.25), (6.3, 1.05), (5.0, 1.05)], 0.98, 0.22, 'accent', r=0.2)
    plate('crane', [(13.45, -4.3), (14.7, -3.4), (14.7, -1.0), (13.45, -1.0)], 0.98, 0.08, 'paint', r=0.15)
    screws('fr_screws', [(5.5, -3.5), (12.3, -4.2), (14.15, -2.2)], 1.08, 0.2)
    box('rear_sight', 5.3, 7.5, 2.4, 3.02, 0.64, 'poly', bevel=0.1)

    # cylinder
    cyl = tube('cylinder', 7.45, 12.95, -1.2, 2.2, 'paint', bevel=0.16)
    flutes(cyl, 'cyl_flutes', 9.7, 13.6, -1.2, 2.5, 0.52, (0, 60, -60, 120, -120, 180), 'paint')
    slots(cyl, 'cyl_notch', [rect(8.0, 8.9, -1.55, -0.85)], 1.96, 3, 'poly', r=0.1)

    # hammer, trigger, guard
    solid('hammer', [(4.7, 1.2), (5.5, 2.6, 0.2), (4.6, 3.9, 0.3), (2.5, 3.7, 0.25), (2.7, 3.1, 0.2), (3.9, 3.0, 0.4), (3.7, 1.2)],
          0.42, 'accent', bevel=0.1)
    solid('guard', stroke([(6.7, -4.6), (7.0, -7.6), (8.6, -8.5), (11.2, -8.3), (12.5, -6.6), (12.7, -4.6)], 0.5),
          0.5, 'paint', bevel=0.12, r=0.3)
    trigger('trigger', 9.55, -4.6)

    # grip
    gr = solid('grip', [(3.0, -2.5, 0.5), (4.6, -4.5, 0.3), (6.7, -4.9, 0.4), (5.5, -8.6, 1.2), (5.1, -12.0, 1.4), (2.8, -13.8, 1.6),
                        (-0.6, -13.3, 1.6), (-2.1, -10.8, 1.5), (0.2, -6.4, 2.0), (1.6, -3.2, 0.8)], 1.22, 'rubber', bevel=0.4, seg=4)
    ridges(gr, 'grip_tex', -1.9, 6.0, -12.6, -6.2, 1.22, pitch=0.56, th=0.24, depth=0.1, tag='rubber')
    pin('medallion', 2.75, -4.9, 1.1, 1.4, 0.55, 'accent', bevel=0.08)


# =============================================================================
# HORNET SMG  (compact submachine gun, wire stock)
# =============================================================================
@gun('hornet')
def hornet():
    # barrel, perforated shroud, muzzle
    tube('barrel', 30.0, 43.0, 0, 0.72, 'steel')
    sh = tube('shroud', 31.5, 39.6, 0, 1.6, 'paint', bevel=0.2)
    holes(sh, 'sh_holes', [(33.3 + i * 1.9, 0.75) for i in range(4)] + [(34.25 + i * 1.9, -0.65) for i in range(3)],
          0.42, 0.7, 3, 'poly')
    mz = tube('muzzle', 42.2, 45.2, 0, 0.98, 'steel', bevel=0.12)
    slots(mz, 'mz_cut', [rect(43.0 + i * 0.95, 43.5 + i * 0.95, -0.5, 0.5) for i in range(2)], 0.35, 3, 'poly', r=0.15)
    fs = solid('fsight', [(36.9, 1.45), (39.3, 1.45), (38.9, 3.7, 0.4), (37.3, 3.7, 0.4)], 0.5, 'poly', bevel=0.08)
    holes(fs, 'fs_hole', [(38.1, 2.85)], 0.36, -2, 2, 'poly')
    solid('handstop', [(32.2, -1.4), (36.6, -1.4), (35.5, -3.7, 0.5), (33.1, -3.7, 0.5)], 0.9, 'poly', bevel=0.2)

    # receiver
    rc = solid('receiver', [(9.6, -2.3, 0.5), (32.0, -2.3, 0.3), (32.0, 2.1, 0.5), (30.6, 2.6, 0.2), (10.6, 2.6, 0.6), (9.6, 1.6, 0.4)],
               1.5, 'paint', bevel=0.28, seg=4)
    slots(rc, 'port', [rect(14.6, 20.4, -0.75, 0.6)], 1.1, 3, 'bright', r=0.3)
    slots(rc, 'cock_slot', [rect(22.2, 31.0, 0.85, 1.4)], 1.2, 3, 'poly', r=0.25)
    pin('cock_knob', 28.6, 1.12, 1.2, 2.5, 0.5, 'accent', bevel=0.1)
    rail('toprail', 11.2, 30.4, 2.6)
    tube('endcap', 8.4, 10.0, 0.2, 1.3, 'steel', bevel=0.2)
    plate('rc_plate', [(21.6, -1.9), (31.2, -1.9), (31.2, 0.35), (21.6, 0.35)], 1.5, 0.1, 'paint', r=0.3)
    screws('rc_screws', [(11.2, -1.3), (30.5, -1.35), (22.4, -1.35)], 1.6, 0.22)
    aperture('rs', 13.0, 2.55)

    # lower with magazine well
    solid('lower', [(11.6, -2.3), (11.6, -4.6, 0.6), (13.4, -5.4, 0.4), (23.8, -5.4, 0.2), (24.2, -7.2, 0.3), (29.6, -7.2, 0.4),
                    (30.2, -2.3)], 1.38, 'paint', bevel=0.22, seg=4)
    plate('well_fence', [(24.5, -6.8, 0.2), (29.3, -6.8, 0.3), (29.7, -3.0, 0.3), (24.2, -3.0, 0.2)], 1.38, 0.13, 'paint', bevel=0.06)
    pin('sel_hub', 15.0, -3.7, 1.2, 1.58, 0.42, 'accent')
    plate('selector', rot(rect(14.7, 17.4, -3.92, -3.48), 26, 15.0, -3.7), 1.38, 0.2, 'accent', r=0.18)
    plate('magcatch', rect(22.3, 23.5, -4.9, -3.6), 1.38, 0.18, 'accent', r=0.2)
    pin('pin_a', 13.3, -3.1, 1.2, 1.44, 0.3, 'steel')
    pin('pin_b', 20.6, -3.3, 1.2, 1.44, 0.3, 'steel')

    # stick magazine
    solid('mag', [(24.9, -6.5), (28.9, -6.5), (28.9, -19.2, 0.3), (24.9, -19.2, 0.3)], 0.95, 'paint', bevel=0.14)
    plate('mag_rib', rect(26.5, 27.3, -18.3, -8.0), 0.95, 0.1, 'paint', r=0.25)
    b = B()
    for i in range(4):
        b.pin(25.7, -9.4 - i * 2.4, 0.8, 1.0, 0.24)
    b.done('mag_witness', 'bright', 0.03, 2)
    solid('mag_base', rect(24.5, 29.3, -20.1, -19.0), 1.1, 'poly', bevel=0.16, r=0.25)

    # grip, guard, trigger
    gr = solid('grip', [(12.6, -5.2, 0.2), (17.6, -5.3, 0.2), (17.2, -7.0, 0.5), (15.0, -14.2, 0.7), (10.2, -14.0, 0.7),
                        (11.6, -8.6, 1.5), (12.0, -6.0, 0.4)], 1.3, 'poly', bevel=0.3, seg=4)
    ridges(gr, 'grip_r', 10.8, 16.6, -13.2, -7.6, 1.3, pitch=0.62, th=0.26, slant=-0.3)
    solid('guard', stroke([(17.3, -5.6), (17.8, -8.3), (23.2, -8.3), (24.5, -6.9)], 0.48), 0.62, 'paint', bevel=0.1, r=0.14)
    trigger('trigger', 20.2, -5.4)

    # collapsed wire stock running along the receiver
    b = B()
    b.tube(1.2, 19.4, 1.5, 1.74, 0.34, seg=20)
    b.tube(1.2, 13.4, -1.5, 1.74, 0.34, seg=20)
    b.done('stock_rods', 'steel', 0.05)
    b = B()
    b.prism(rect(10.4, 12.1, 0.95, 2.05), 1.4, 2.2)
    b.prism(rect(10.4, 12.1, -2.05, -0.95), 1.4, 2.2)
    b.done('rod_guides', 'paint', 0.1)
    bp = solid('butt', [(0.0, -4.6, 0.5), (1.5, -4.6, 0.3), (1.5, 3.0, 0.3), (0.0, 3.0, 0.5)], 2.15, 'rubber', bevel=0.25)
    ridges(bp, 'butt_r', -0.5, 2.0, -3.8, 2.4, 2.15, pitch=0.7, th=0.26, depth=0.1, tag='rubber')


# =============================================================================
# WASP PDW  (enclosed bullpup-style personal defence weapon)
# =============================================================================
@gun('wasp')
def wasp():
    body = solid('body', [(0.4, -7.6, 0.8), (0.0, -6.0, 0.5), (0.0, 2.0, 1.2), (5.0, 3.1, 2.5), (24.0, 3.1, 1.5), (33.6, 1.9, 1.0),
                          (35.0, 0.9, 0.5), (35.0, -1.4, 0.6), (31.0, -3.0, 1.2), (21.6, -3.2, 0.4), (20.2, -3.7, 0.4),
                          (18.6, -11.4, 1.0), (13.4, -12.0, 1.2), (10.6, -7.9, 1.0)], 1.75, 'paint', bevel=0.5, seg=5)
    slots(body, 'thumbhole', [[(11.2, -2.7), (16.2, -3.1), (14.9, -8.6), (13.0, -9.5), (11.5, -7.0)]], -3, 3, 'paint', r=0.9)
    slots(body, 'port', [rect(4.0, 9.2, -0.9, 0.7)], 1.35, 3, 'bright', r=0.3)
    slots(body, 'vents', [rot(rect(28.0 + i * 1.5, 28.6 + i * 1.5, -1.5, 1.0), -20, 28.3 + i * 1.5, -0.25) for i in range(3)],
          1.45, 3, 'poly', r=0.2)
    slots(body, 'ch_slot', [rect(21.5, 26.6, 1.25, 1.75)], 1.5, 3, 'poly', r=0.2)
    slots(body, 'seam', [rect(11.6, 27.0, -2.3, -2.14)], 1.62, 3, 'poly')
    pin('ch_knob', 25.6, 1.5, 1.6, 2.6, 0.42, 'accent', bevel=0.1)
    plate('cheek', [(3.6, 1.55), (11.0, 1.55), (11.0, 2.35), (4.6, 2.35)], 1.75, 0.12, 'accent', r=0.3)
    pin('sel', 21.4, -1.4, 1.6, 1.98, 0.5, 'accent', bevel=0.08)
    plate('sel_lever', rot(rect(21.2, 23.6, -1.6, -1.2), -25, 21.4, -1.4), 1.75, 0.26, 'accent', r=0.16)
    plate('mag_rel', rect(6.2, 8.4, -6.6, -5.6), 1.75, 0.16, 'accent', r=0.25)
    screws('body_screws', [(1.6, -5.4), (1.6, 0.4), (32.6, 0.3), (17.2, 1.4)], 1.86, 0.24)
    gp = plate('grip_panel', [(19.2, -4.6, 0.4), (18.0, -10.5, 0.5), (15.7, -10.5, 0.5), (16.7, -4.6, 0.4)], 1.75, 0.09, 'poly', bevel=0.05)
    ridges(gp, 'grip_tex', 15.0, 20.0, -10.2, -5.0, 1.84, pitch=0.5, th=0.22, depth=0.07)
    bp = solid('buttpad', [(-1.1, -7.4), (0.3, -7.4), (0.3, 1.8), (-1.1, 1.8)], 1.8, 'rubber', bevel=0.26, r=0.4)
    ridges(bp, 'butt_r', -1.4, 0.6, -6.6, 1.2, 1.8, pitch=0.72, th=0.26, depth=0.1, tag='rubber')

    # magazine behind the grip
    solid('mag', [(3.4, -7.0), (9.2, -7.0), (10.6, -15.8, 0.4), (5.0, -16.6, 0.4)], 1.1, 'paint', bevel=0.16)
    plate('mag_rib1', stroke([(5.4, -8.6), (6.6, -15.4)], 0.5), 1.1, 0.1, 'paint', bevel=0.04)
    plate('mag_rib2', stroke([(7.5, -8.4), (8.8, -15.1)], 0.5), 1.1, 0.1, 'paint', bevel=0.04)
    solid('mag_base', [(4.5, -16.3), (11.0, -15.4), (11.2, -16.45), (4.7, -17.4)], 1.26, 'poly', bevel=0.16, r=0.22)

    # trigger group and hand stop
    solid('guard', stroke([(26.6, -3.1), (26.2, -7.0), (24.8, -7.9), (19.35, -7.8)], 0.55), 0.8, 'paint', bevel=0.14, r=0.3)
    trigger('trigger', 22.6, -3.2, hw=0.32)
    hs = solid('handstop', [(27.6, -2.9), (31.8, -2.8), (30.6, -5.7, 0.6), (28.4, -5.7, 0.6)], 1.3, 'poly', bevel=0.25)
    ridges(hs, 'hs_r', 27.4, 32.0, -5.2, -3.4, 1.3, pitch=0.55, th=0.22, depth=0.1)

    # short barrel with conical flash hider
    tube('barrel', 34.0, 39.2, -0.25, 0.74, 'steel')
    fh = tube('flash', 38.6, 42.0, -0.25, 0.85, 'steel', bevel=0.1, r2=1.3)
    slots(fh, 'fh_slots', [rect(39.4 + i * 0.9, 39.85 + i * 0.9, -0.7, 0.2) for i in range(3)], 0.3, 3, 'poly', r=0.12)

    # low rail with a tube sight
    rail('toprail', 10.6, 27.4, 3.1, hw=0.9)
    box('riser', 16.4, 22.6, 3.5, 4.4, 0.82, 'poly', bevel=0.1)
    op = tube('optic', 15.8, 23.2, 5.75, 1.62, 'paint', bevel=0.22)
    lens(op, 'lens_f', 22.7, 24.0, 5.75, 1.32)
    B().post(19.5, 7.2, 8.0, 0, 0.62).done('turret', 'accent', 0.1)
    pin('opt_knob', 19.5, 5.75, 1.4, 2.25, 0.62, 'accent', bevel=0.1)
    tube('opt_ring', 17.4, 18.3, 5.75, 1.72, 'steel', bevel=0.06)


# =============================================================================
# BULLDOG 12  (pump-action shotgun)
# =============================================================================
@gun('bulldog', margin=1.05)
def bulldog():
    tube('barrel', 30.0, 84.0, 0, 0.98, 'steel')
    tube('magtube', 30.0, 77.5, -2.35, 0.92, 'steel')
    tube('magcap', 77.0, 79.6, -2.35, 1.06, 'steel', bevel=0.22)
    solid('clamp', [(73.2, -3.65, 0.5), (75.6, -3.65, 0.5), (75.6, 1.3, 0.5), (73.2, 1.3, 0.5)], 1.22, 'paint', bevel=0.2)
    pin('clamp_screw', 74.4, -1.18, 1.0, 1.34, 0.3, 'steel')
    solid('bead', [(82.2, 0.9), (83.6, 0.9), (83.4, 1.75, 0.2), (82.4, 1.75, 0.2)], 0.25, 'accent', bevel=0.06)
    hs = solid('heatshield', [(36.0, 0.25), (62.0, 0.25), (62.0, 1.38, 0.4), (36.0, 1.38, 0.4)], 1.2, 'paint', bevel=0.16)
    holes(hs, 'hs_holes', [(38.2 + i * 2.85, 0.74) for i in range(8)], 0.34, -3, 3, 'poly')

    # receiver
    rc = solid('receiver', [(15.6, -3.9, 0.8), (33.6, -4.2, 0.5), (34.4, -3.2, 0.3), (34.4, 1.2, 0.5), (33.0, 1.75, 0.3),
                            (18.0, 1.75, 1.2), (15.6, 0.4, 0.8)], 1.6, 'paint', bevel=0.3, seg=4)
    slots(rc, 'port', [rect(22.0, 29.8, -0.7, 0.85)], 1.2, 3, 'bright', r=0.35)
    rail('toprail', 19.0, 32.4, 1.75, hw=0.9)
    aperture('rs', 20.8, 1.7)
    pin('safety', 17.6, -2.6, 1.5, 1.92, 0.46, 'accent', bevel=0.08)
    plate('release', rect(31.4, 32.8, -3.5, -2.3), 1.6, 0.16, 'accent', r=0.2)
    # side saddle with spare shells
    plate('saddle', [(20.6, -3.35), (30.4, -3.5), (30.4, -1.55), (20.6, -1.4)], 1.6, 0.42, 'poly', r=0.3, bevel=0.1)
    b = B()
    for i in range(5):
        b.post(21.9 + i * 1.8, -3.75, -1.75, 2.45, 0.56, seg=20)
    b.done('shells', 'accent', 0.08)
    b = B()
    for i in range(5):
        b.post(21.9 + i * 1.8, -1.8, -1.2, 2.45, 0.6, seg=20)
    b.done('shell_brass', 'bright', 0.06)
    pin('pin1', 18.9, -0.6, 1.5, 1.74, 0.28, 'steel')
    pin('pin2', 32.6, -0.4, 1.5, 1.74, 0.28, 'steel')

    # trigger group
    solid('guard', stroke([(18.2, -4.0), (18.6, -6.7), (24.6, -6.9), (26.0, -4.2)], 0.5), 0.62, 'paint', bevel=0.1, r=0.2)
    trigger('trigger', 21.6, -4.0)

    # pump forend riding the magazine tube
    box('action_bar', 33.5, 46.0, -1.95, -1.45, 1.26, 'steel', bevel=0.05)
    fe = solid('forend', [(44.0, -3.95, 0.6), (62.5, -3.95, 0.6), (63.2, -2.8, 0.3), (63.2, -0.85, 0.4), (44.0, -0.85, 0.4),
                          (43.2, -1.9, 0.3)], 1.9, 'paint', bevel=0.36, seg=4)
    serrations(fe, 'fe_ribs', 45.8, 61.2, -3.35, -1.45, 1.9, pitch=1.55, th=0.72, lean=0.0, depth=0.24, tag='paint')

    # classic stock with a semi pistol grip
    st = solid('stock', [(16.6, 1.0, 0.3), (16.6, -3.9, 0.4), (14.4, -4.8, 1.0), (13.0, -8.0, 1.0), (10.0, -8.4, 1.2), (8.4, -7.0, 1.5),
                         (-3.0, -9.8, 0.6), (-3.0, -0.8, 0.8), (4.0, 0.7, 3.0), (11.5, -0.5, 3.0)], 1.5, 'paint', bevel=0.45, seg=5)
    gp = plate('grip_panel', [(14.4, -1.6, 0.5), (15.6, -3.8, 0.4), (13.6, -4.6, 0.5), (12.4, -7.2, 0.5), (10.4, -7.4, 0.5),
                              (11.0, -2.2, 0.8)], 1.5, 0.07, 'poly', bevel=0.04)
    ridges(gp, 'grip_tex', 10.0, 16.0, -7.2, -1.8, 1.57, pitch=0.46, th=0.2, depth=0.06)
    slots(st, 'st_groove', [[(-1.0, -6.6), (6.6, -4.4), (6.6, -3.7), (-1.0, -5.9)]], 1.3, 3, 'paint', r=0.25)
    bp = solid('buttpad', [(-4.4, -9.8, 0.4), (-2.9, -9.8), (-2.9, -0.8), (-4.4, -0.8, 0.4)], 1.55, 'rubber', bevel=0.3)
    ridges(bp, 'butt_r', -4.8, -2.6, -9.0, -1.4, 1.55, pitch=0.75, th=0.28, depth=0.1, tag='rubber')
    pin('swivel', 0.4, -8.0, 1.3, 1.78, 0.42, 'steel')


# =============================================================================
# KODIAK KR  (stamped-receiver battle rifle with curved magazine)
# =============================================================================
@gun('kodiak', margin=1.05)
def kodiak():
    tube('barrel', 46.0, 84.5, 0, 0.8, 'steel')
    mz = tube('muzzle', 84.0, 88.4, 0, 1.06, 'steel', bevel=0.1)
    c = cutter('mz_slant', 'steel')
    c.prism([(86.9, 2.0), (90.0, 2.0), (90.0, -2.0), (88.5, -2.0)], -3, 3)
    cut(mz, cut_done(c))
    tube('gastube', 49.0, 70.5, 1.95, 0.62, 'steel')
    solid('gasblock', [(68.6, -0.95, 0.2), (71.6, -0.95, 0.2), (71.6, 1.4, 0.2), (70.9, 2.7, 0.3), (68.6, 2.7, 0.3)],
          0.92, 'steel', bevel=0.14)
    tube('cleaning_rod', 62.6, 83.6, -1.35, 0.22, 'steel', bevel=0.03, seg=16)
    fs = solid('fsight', [(77.6, -0.95, 0.2), (80.8, -0.95, 0.2), (80.6, 2.2, 0.2), (80.3, 4.3, 0.5), (78.1, 4.3, 0.5), (77.8, 2.2, 0.2)],
               0.78, 'steel', bevel=0.12)
    holes(fs, 'fs_hole', [(79.2, 3.15)], 0.66, -3, 3, 'steel')

    # receiver, dust cover, rear sight block
    rc = solid('receiver', [(23.6, -3.7, 0.4), (47.2, -3.7, 0.3), (47.2, 1.5), (23.6, 1.5)], 1.5, 'paint', bevel=0.2)
    slots(rc, 'dimple', [rect(36.4, 41.8, -3.0, -1.95)], 1.3, 3, 'paint', r=0.48)
    slots(rc, 'bolt_slot', [rect(32.6, 45.0, 0.72, 1.3)], 1.15, 3, 'bright', r=0.12)
    pin('ch_knob', 41.8, 1.0, 1.15, 2.7, 0.42, 'steel', bevel=0.1)
    dc = solid('dustcover', [(24.0, 1.5), (45.6, 1.5), (45.6, 2.5, 0.4), (44.0, 3.1, 0.6), (26.0, 3.1, 1.2), (24.0, 2.2, 0.5)],
               1.42, 'paint', bevel=0.3, seg=4)
    b = B()
    for i in range(4):
        b.prism(fillet(rect(28.4 + i * 4.3, 29.3 + i * 4.3, 1.75, 2.75), 0.3), 1.36, 1.52)
    b.done('dc_ribs', 'paint', 0.05, 2)
    rivets('rivets', [(25.0, -2.9), (26.6, -0.5), (44.9, -2.8), (46.1, -0.9), (46.1, 0.5), (30.6, -2.9), (34.6, -3.0)], 1.5, 0.23)
    plate('selector', [(33.0, -0.75), (41.4, 0.12), (42.0, -0.42), (41.4, -0.95), (33.2, -1.4)], 1.5, 0.15, 'accent', r=0.15)
    pin('sel_hub', 41.3, -0.42, 1.4, 1.74, 0.36, 'steel')
    solid('rsblock', [(45.6, 0.9), (50.6, 0.9), (50.6, 2.9, 0.3), (49.6, 3.45, 0.3), (45.8, 3.45, 0.2)], 1.2, 'steel', bevel=0.16)
    solid('rsleaf', [(46.2, 3.4), (51.6, 3.4), (51.6, 3.72), (46.2, 3.95)], 0.45, 'steel', bevel=0.06)
    box('tang', 22.7, 24.4, -3.3, 1.1, 1.47, 'steel', bevel=0.1)

    # furniture
    lh = solid('handguard', [(47.2, -3.3, 0.3), (61.6, -2.9, 0.6), (62.4, -1.6, 0.4), (62.4, 0.5, 0.3), (47.2, 0.5)],
               1.75, 'paint', bevel=0.32, seg=4)
    slots(lh, 'hg_vents', [rect(50.0 + i * 3.6, 52.3 + i * 3.6, -0.5, 0.05) for i in range(3)], 1.2, 3, 'poly', r=0.2)
    slots(lh, 'hg_groove', [rect(49.0, 60.4, -2.3, -1.75)], 1.56, 3, 'paint', r=0.25)
    uh = solid('upperhg', [(50.6, 0.7, 0.2), (61.2, 0.7, 0.2), (61.2, 2.6, 0.6), (50.6, 2.9, 0.6)], 1.2, 'paint', bevel=0.3, seg=4)
    slots(uh, 'uh_vents', [rect(52.2 + i * 2.9, 53.9 + i * 2.9, 1.55, 2.0) for i in range(3)], 0.85, 3, 'poly', r=0.2)
    box('ferrule', 61.9, 63.5, -1.9, 2.45, 1.32, 'steel', bevel=0.15)
    st = solid('stock', [(23.9, 1.0, 0.3), (23.9, -3.3, 0.4), (19.5, -3.7, 1.0), (4.0, -7.8, 0.8), (0.0, -7.8, 0.5), (0.0, 0.2, 0.6),
                         (3.0, 1.2, 1.2), (17.0, 1.3, 2.0)], 1.42, 'paint', bevel=0.4, seg=5)
    slots(st, 'st_groove', [[(5.5, -2.4), (18.5, -1.0), (18.5, -0.4), (5.5, -1.7)]], 1.22, 3, 'paint', r=0.25)
    solid('buttplate', [(-0.9, -7.9, 0.3), (0.3, -7.9), (0.3, 0.3), (-0.9, 0.3, 0.3)], 1.46, 'steel', bevel=0.15)
    pin('sling', 3.4, -5.7, 1.2, 1.74, 0.45, 'steel')

    # curved magazine
    solid('mag', band(62.0, -3.4, 19.6, 26.0, 178, 217, 16), 1.0, 'paint', bevel=0.16)
    plate('mag_rib1', band(62.0, -3.4, 21.3, 21.85, 186, 215, 12), 1.0, 0.1, 'paint', bevel=0.04)
    plate('mag_rib2', band(62.0, -3.4, 23.6, 24.15, 186, 215, 12), 1.0, 0.1, 'paint', bevel=0.04)
    solid('mag_base', [(40.9, -19.3), (46.7, -14.95), (47.3, -15.75), (41.5, -20.1)], 1.14, 'poly', bevel=0.14, r=0.2)
    solid('magcatch', [(34.9, -3.6), (35.8, -3.6), (35.7, -6.0), (35.0, -6.0)], 0.45, 'steel', bevel=0.08)

    # grip, guard, trigger
    gr = solid('grip', [(26.0, -3.5, 0.2), (30.4, -3.7, 0.2), (29.8, -5.2, 0.4), (28.0, -12.6, 0.7), (23.4, -12.4, 0.7),
                        (24.8, -7.0, 1.2), (25.3, -4.4, 0.3)], 1.3, 'poly', bevel=0.3, seg=4)
    ridges(gr, 'grip_r', 24.0, 29.2, -11.6, -6.2, 1.3, pitch=0.62, th=0.26, slant=-0.27)
    solid('guard', stroke([(30.5, -3.9), (30.8, -6.5), (34.2, -6.7), (35.3, -5.7)], 0.42), 0.6, 'steel', bevel=0.08, r=0.12)
    trigger('trigger', 32.3, -3.7)


# =============================================================================
# LYNX BP  (bullpup assault rifle with carry-handle rail)
# =============================================================================
@gun('lynx', margin=1.05)
def lynx():
    body = solid('body', [(0.5, -8.0, 0.6), (0.0, -6.5, 0.5), (0.0, 1.6, 1.0), (2.5, 2.6, 1.2), (48.0, 2.6, 1.5), (55.4, 1.4, 0.8),
                          (56.6, 0.3, 0.4), (56.6, -2.0, 0.6), (54.0, -3.2, 0.8), (40.4, -3.3, 0.3), (39.4, -3.7, 0.2),
                          (34.0, -3.7, 0.3), (30.5, -4.6, 0.8), (23.6, -5.6, 0.5), (23.3, -7.8, 0.4), (14.4, -8.2, 0.4),
                          (13.6, -6.6, 0.5), (6.0, -8.3, 1.0)], 1.7, 'paint', bevel=0.4, seg=5)
    slots(body, 'port', [rect(11.4, 19.2, 0.0, 1.5)], 1.3, 3, 'bright', r=0.3)
    slots(body, 'ch_slot', [rect(44.0, 52.4, 0.85, 1.38)], 1.45, 3, 'poly', r=0.2)
    slots(body, 'vents', [rot(rect(48.4 + i * 1.6, 49.0 + i * 1.6, -2.3, -0.3), -18, 48.7 + i * 1.6, -1.3) for i in range(4)],
          1.4, 3, 'poly', r=0.2)
    slots(body, 'seam', [rect(22.0, 46.4, -0.34, -0.18)], 1.58, 3, 'poly')
    pin('ch_knob', 51.2, 1.12, 1.5, 2.6, 0.42, 'accent', bevel=0.1)
    plate('well_panel', [(14.9, -2.9, 0.4), (23.0, -2.5, 0.4), (22.8, -7.0, 0.3), (15.2, -7.4, 0.3)], 1.7, 0.13, 'paint', bevel=0.06)
    plate('cheek', [(3.2, 1.3), (10.4, 1.3), (10.4, 2.05), (3.2, 2.05)], 1.7, 0.12, 'accent', r=0.3)
    plate('mag_rel', rect(24.3, 25.8, -4.5, -3.4), 1.7, 0.16, 'accent', r=0.22)
    pin('sel_hub', 36.6, -1.7, 1.55, 1.92, 0.42, 'accent')
    plate('selector', rot(rect(36.3, 38.9, -1.92, -1.48), -28, 36.6, -1.7), 1.7, 0.24, 'accent', r=0.18)
    pin('takedown', 28.0, -2.5, 1.5, 1.8, 0.36, 'steel')
    screws('body_screws', [(1.8, -5.6), (1.8, 0.4), (31.6, -2.9), (54.0, -1.0)], 1.8, 0.24)
    bp = solid('buttpad', [(-1.1, -7.9), (0.3, -7.9), (0.3, 1.5), (-1.1, 1.5)], 1.76, 'rubber', bevel=0.26, r=0.4)
    ridges(bp, 'butt_r', -1.4, 0.6, -7.2, 0.9, 1.76, pitch=0.75, th=0.28, depth=0.1, tag='rubber')

    # carry handle / optic bridge
    ch = solid('handle', [(19.0, 2.5), (23.6, 5.7, 1.2), (42.4, 5.7, 1.2), (47.0, 2.5)], 1.0, 'paint', bevel=0.25, seg=4)
    slots(ch, 'handle_hole', [[(24.2, 3.3), (41.8, 3.3), (40.0, 4.75), (26.0, 4.75)]], -3, 3, 'paint', r=0.5)
    rail('toprail', 24.6, 41.4, 5.7, hw=0.85)
    solid('fs_blade', [(40.0, 6.1), (41.2, 6.1), (41.0, 7.3, 0.2), (40.2, 7.3, 0.2)], 0.3, 'accent', bevel=0.06)
    aperture('rs', 26.6, 5.65)

    # magazine behind the grip
    solid('mag', [(15.0, -7.4), (22.6, -7.4), (23.4, -13.0), (25.0, -19.0, 0.4), (18.0, -20.0, 0.4), (16.0, -13.6)],
          1.05, 'paint', bevel=0.16)
    plate('mag_rib1', stroke([(17.2, -9.4), (18.2, -14.0), (19.8, -19.0)], 0.55), 1.05, 0.1, 'paint', bevel=0.04)
    plate('mag_rib2', stroke([(20.0, -9.2), (21.0, -13.6), (22.6, -18.6)], 0.55), 1.05, 0.1, 'paint', bevel=0.04)
    solid('mag_base', [(17.5, -19.7), (25.4, -18.6), (25.6, -19.7), (17.7, -20.9)], 1.2, 'poly', bevel=0.14, r=0.2)

    # grip, guard, trigger, hand stop
    gr = solid('grip', [(34.2, -3.5, 0.2), (39.2, -3.6, 0.2), (38.6, -5.4, 0.5), (36.4, -13.0, 0.7), (31.6, -12.8, 0.7),
                        (33.2, -7.4, 1.5), (33.8, -4.4, 0.3)], 1.3, 'poly', bevel=0.3, seg=4)
    ridges(gr, 'grip_r', 32.2, 37.8, -12.0, -6.4, 1.3, pitch=0.62, th=0.26, slant=-0.3)
    solid('guard', stroke([(37.8, -7.7), (43.3, -7.5), (44.5, -3.5)], 0.5), 0.65, 'paint', bevel=0.1, r=0.14)
    trigger('trigger', 40.6, -3.3)
    hs = solid('handstop', [(46.4, -3.2), (51.4, -3.2), (50.2, -6.4, 0.6), (47.6, -6.4, 0.6)], 1.25, 'poly', bevel=0.25)
    ridges(hs, 'hs_r', 46.0, 51.6, -5.9, -3.8, 1.25, pitch=0.55, th=0.22, depth=0.1)

    # barrel
    tube('barrel', 55.0, 72.0, -0.8, 0.8, 'steel')
    tube('collar', 60.6, 62.8, -0.8, 1.16, 'steel', bevel=0.1)
    fh = tube('flash', 71.2, 76.2, -0.8, 1.06, 'steel', bevel=0.12)
    slots(fh, 'fh_slots', [rect(72.3 + i * 1.15, 72.9 + i * 1.15, -1.35, -0.25) for i in range(3)], 0.4, 3, 'poly', r=0.18)


# =============================================================================
# LONGBOW .338  (bolt-action precision rifle)
# =============================================================================
@gun('longbow', margin=1.04)
def longbow():
    brl = tube('barrel', 44.0, 104.5, 0, 1.15, 'steel', bevel=0.08)
    flutes(brl, 'flutes', 50.0, 98.0, 0, 1.4, 0.38, (-55, 0, 55), 'steel')
    mb = solid('brake', [(103.6, -1.35, 0.3), (110.4, -1.35, 0.4), (110.4, 1.35, 0.4), (103.6, 1.35, 0.3)], 1.3, 'steel', bevel=0.2)
    slots(mb, 'ports', [rect(105.0 + i * 1.8, 106.0 + i * 1.8, -0.8, 0.8) for i in range(3)], -3, 3, 'steel', r=0.25)

    # action and bolt
    ac = tube('action', 29.6, 46.0, 0, 1.55, 'paint', bevel=0.14)
    slots(ac, 'port', [rect(34.5, 41.5, 0.1, 1.25)], 0.95, 3, 'bright', r=0.3)
    tube('shroud', 26.4, 29.8, 0, 1.25, 'steel', bevel=0.2)
    solid('bolt_arm', stroke([(31.2, 0.0), (31.7, -2.7)], 0.75), 0, 'steel', bevel=0.1, z=(1.3, 2.1), r=0.2)
    B().ball(31.85, -3.4, 2.05, 0.92).done('bolt_knob', 'accent', 0.0)

    # chassis
    ch = solid('chassis', [(26.0, -0.5, 0.3), (26.0, -4.4, 0.6), (37.0, -4.8, 0.3), (43.6, -4.8, 0.3), (46.0, -4.2, 0.5),
                           (70.0, -3.9, 0.6), (71.4, -2.8, 0.5), (71.4, -1.0, 0.4), (47.0, -1.0, 0.3), (46.4, -0.5, 0.2)],
               1.85, 'paint', bevel=0.32, seg=4)
    slots(ch, 'vents', [rect(49.5 + i * 4.2, 52.4 + i * 4.2, -2.95, -2.05) for i in range(5)], 1.3, 3, 'poly', r=0.42)
    screws('ch_screws', [(27.4, -1.6), (45.0, -2.2), (69.6, -2.3)], 1.95, 0.24)
    plate('ch_panel', [(28.6, -3.9), (36.0, -4.2), (36.0, -1.3), (28.6, -1.3)], 1.85, 0.1, 'paint', r=0.35)
    pin('safety', 29.0, -0.9, 1.7, 2.1, 0.42, 'accent', bevel=0.08)

    # magazine, trigger group, grip
    solid('mag', [(37.4, -4.4), (43.2, -4.4), (43.6, -9.6, 0.4), (37.8, -9.9, 0.4)], 1.15, 'paint', bevel=0.16)
    solid('mag_base', [(37.4, -9.6), (44.0, -9.25), (44.1, -10.2), (37.5, -10.6)], 1.3, 'poly', bevel=0.14, r=0.2)
    plate('mag_rel', rect(43.8, 45.2, -5.9, -4.9), 1.2, 0.5, 'accent', r=0.2)
    solid('guard', stroke([(30.4, -4.6), (30.9, -7.3), (36.4, -7.5), (37.5, -6.0)], 0.48), 0.62, 'paint', bevel=0.1, r=0.14)
    trigger('trigger', 33.3, -4.5)
    gr = solid('grip', [(26.4, -4.2, 0.2), (30.6, -4.4, 0.2), (30.2, -6.0, 0.5), (28.8, -13.2, 0.7), (24.2, -13.0, 0.7),
                        (25.2, -8.0, 1.5), (25.6, -5.0, 0.3)], 1.35, 'poly', bevel=0.3, seg=4)
    ridges(gr, 'grip_r', 24.6, 30.0, -12.2, -6.8, 1.35, pitch=0.62, th=0.26, slant=-0.2)

    # skeleton stock with adjustable cheek riser
    st = solid('stock', [(26.4, 0.9, 0.3), (26.4, -4.2, 0.3), (22.0, -4.6, 0.8), (7.0, -8.9, 0.8), (0.6, -8.9, 0.5), (0.6, 1.2, 0.6),
                         (2.0, 2.0, 0.5), (6.5, 2.0, 0.6), (8.0, 0.9, 0.5)], 1.6, 'paint', bevel=0.35, seg=4)
    slots(st, 'st_hole', [[(7.6, -1.4), (22.0, -1.4), (21.4, -3.6), (8.6, -7.2)]], -3, 3, 'paint', r=0.9)
    B().post(12.0, 0.6, 1.9, 0, 0.4).post(19.6, 0.6, 1.9, 0, 0.4).done('riser_posts', 'steel', 0.04)
    solid('riser', [(9.0, 1.7, 0.5), (22.6, 1.7, 0.5), (22.6, 3.5, 0.8), (9.0, 3.5, 0.8)], 1.5, 'poly', bevel=0.3, seg=4)
    pin('riser_knob', 15.8, -0.25, 1.5, 2.4, 0.62, 'accent', bevel=0.1)
    box('spacer', -0.1, 0.7, -8.8, 1.9, 1.62, 'steel', bevel=0.06)
    bp = solid('buttpad', [(-1.5, -8.8), (0.0, -8.8), (0.0, 1.9), (-1.5, 1.9)], 1.66, 'rubber', bevel=0.26, r=0.4)
    ridges(bp, 'butt_r', -1.8, 0.2, -8.0, 1.2, 1.66, pitch=0.75, th=0.28, depth=0.1, tag='rubber')

    # scope
    rail('scoperail', 28.6, 50.0, 1.5, hw=0.85)
    B().prism(rect(33.6, 36.0, 1.9, 4.6), -0.9, 0.9).prism(rect(45.0, 47.4, 1.9, 4.6), -0.9, 0.9).done('ring_bases', 'steel', 0.1)
    b = B()
    b.tube(33.5, 36.1, 5.6, 0, 1.95)
    b.tube(44.9, 47.5, 5.6, 0, 1.95)
    b.done('rings', 'steel', 0.12)
    tube('scope_tube', 26.5, 55.0, 5.6, 1.55, 'paint', bevel=0.1)
    tube('ocular', 22.0, 27.6, 5.6, 2.05, 'paint', bevel=0.25)
    tube('oc_ring', 21.2, 22.6, 5.6, 2.15, 'rubber', bevel=0.15)
    tube('bell_cone', 54.0, 60.2, 5.6, 1.55, 'paint', bevel=0.05, r2=2.6)
    ob = tube('objective', 59.8, 67.0, 5.6, 2.6, 'paint', bevel=0.2)
    lens(ob, 'lens_f', 66.3, 68.0, 5.6, 2.25)
    box('saddle', 38.6, 43.4, 4.2, 7.0, 1.7, 'paint', bevel=0.3, r=0.4)
    B().post(41.0, 7.0, 8.7, 0, 1.0).done('turret_top', 'accent', 0.12)
    pin('turret_side', 41.0, 5.6, 1.6, 3.05, 1.0, 'accent', bevel=0.12)

    # folded bipod under the barrel
    box('bipod_mount', 69.4, 72.6, -3.5, -1.5, 1.5, 'steel', bevel=0.15)
    b = B()
    b.tube(72.0, 95.5, -2.6, 1.15, 0.42, seg=20)
    b.tube(72.0, 95.5, -2.6, -1.15, 0.42, seg=20)
    b.done('bipod_legs', 'steel', 0.06)
    b = B()
    b.tube(94.6, 97.8, -2.6, 1.15, 0.62, seg=20)
    b.tube(94.6, 97.8, -2.6, -1.15, 0.62, seg=20)
    b.done('bipod_feet', 'rubber', 0.16)


# =============================================================================
# RAVAGER MG  (belt-fed light machine gun)
# =============================================================================
@gun('ravager', margin=1.04)
def ravager():
    tube('barrel', 52.0, 98.5, 0, 0.98, 'steel')
    sh = tube('shroud', 54.0, 80.0, 0, 1.75, 'paint', bevel=0.2)
    holes(sh, 'sh_holes', [(56.6 + i * 2.7, 0.85) for i in range(9)] + [(57.95 + i * 2.7, -0.75) for i in range(8)],
          0.5, 0.9, 3, 'poly')
    fh = tube('flash', 97.6, 104.0, 0, 0.9, 'steel', bevel=0.12, r2=1.45)
    slots(fh, 'fh_slots', [rect(99.2 + i * 1.4, 99.9 + i * 1.4, -0.5, 0.5) for i in range(3)], 0.3, 3, 'poly', r=0.2)
    tube('gastube', 52.0, 84.0, -2.3, 0.66, 'steel')
    solid('gasblock', [(82.4, -3.1, 0.3), (85.6, -3.1, 0.3), (85.6, 1.25, 0.3), (82.4, 1.25, 0.3)], 1.12, 'steel', bevel=0.16)
    tube('fs_collar', 89.6, 93.0, 0, 1.2, 'steel', bevel=0.1)
    solid('fsight', [(90.0, 0.8), (92.6, 0.8), (92.2, 3.7, 0.4), (90.4, 3.7, 0.4)], 0.5, 'steel', bevel=0.1)

    # receiver and feed cover
    rc = solid('receiver', [(21.6, -4.6, 0.5), (52.4, -4.6, 0.6), (53.6, -3.4, 0.4), (53.6, 2.2, 0.5), (52.6, 3.0, 0.3), (21.6, 3.0, 0.6)],
               1.85, 'paint', bevel=0.3, seg=4)
    slots(rc, 'port', [rect(36.0, 43.0, -1.5, 0.1)], 1.4, 3, 'bright', r=0.3)
    slots(rc, 'ch_slot', [rect(33.0, 50.0, 1.15, 1.7)], 1.6, 3, 'poly', r=0.2)
    pin('ch_knob', 47.6, 1.42, 1.7, 3.1, 0.5, 'accent', bevel=0.12)
    plate('rc_panel', [(23.6, -3.4), (32.0, -3.4), (32.0, 0.4), (23.6, 0.4)], 1.85, 0.1, 'paint', r=0.4)
    rivets('rc_rivets', [(22.8, -3.9), (22.8, 2.2), (52.2, -3.4), (52.2, 1.9), (45.6, -3.8), (50.4, -1.4)], 1.85, 0.25)
    pin('sel_hub', 26.0, -1.2, 1.8, 2.14, 0.45, 'accent')
    plate('selector', rot(rect(25.7, 28.6, -1.42, -0.98), -30, 26.0, -1.2), 1.95, 0.2, 'accent', r=0.18)
    box('feedtray', 31.0, 50.6, 2.7, 3.15, 1.95, 'steel', bevel=0.06)
    fc = solid('feedcover', [(28.6, 3.0), (51.4, 3.0), (51.4, 3.9, 0.4), (49.6, 4.7, 0.6), (30.4, 4.7, 0.8), (28.6, 3.9, 0.5)],
               1.75, 'paint', bevel=0.3, seg=4)
    plate('fc_latch', rect(29.2, 31.4, 3.35, 4.1), 1.75, 0.2, 'accent', r=0.2)
    slots(fc, 'fc_grooves', [rect(34.0 + i * 3.4, 35.0 + i * 3.4, 3.35, 4.25) for i in range(5)], 1.58, 3, 'paint', r=0.2)
    rail('toprail', 31.8, 49.0, 4.7, hw=0.9)
    aperture('rs', 33.6, 4.65)

    # ammunition box
    solid('ammobox', [(34.0, -4.4), (48.6, -4.4), (48.6, -15.0, 0.8), (34.0, -15.0, 0.8)], 2.3, 'paint', bevel=0.35, seg=4)
    plate('box_rib1', stroke([(35.8, -6.6), (46.8, -13.4)], 0.6), 2.3, 0.1, 'paint', bevel=0.04, r=0.2)
    plate('box_rib2', stroke([(35.8, -13.4), (46.8, -6.6)], 0.6), 2.3, 0.1, 'paint', bevel=0.04, r=0.2)
    box('box_lid', 33.6, 49.0, -5.2, -4.3, 2.4, 'steel', bevel=0.1)
    plate('box_latch', rect(39.6, 43.0, -6.3, -4.9), 2.4, 0.2, 'accent', r=0.25)

    # grip, guard, trigger
    gr = solid('grip', [(24.0, -4.4, 0.2), (28.8, -4.6, 0.2), (28.2, -6.2, 0.5), (26.2, -13.6, 0.7), (21.4, -13.4, 0.7),
                        (22.8, -8.0, 1.5), (23.4, -5.2, 0.3)], 1.35, 'poly', bevel=0.3, seg=4)
    ridges(gr, 'grip_r', 22.0, 27.6, -12.6, -7.0, 1.35, pitch=0.62, th=0.26, slant=-0.3)
    solid('guard', stroke([(27.9, -7.4), (32.6, -7.6), (33.7, -4.8)], 0.5), 0.65, 'paint', bevel=0.1, r=0.14)
    trigger('trigger', 30.4, -4.6)

    # heavy stock with shoulder rest
    st = solid('stock', [(21.9, 2.4, 0.3), (21.9, -4.2, 0.4), (16.0, -5.0, 1.0), (5.0, -9.2, 0.8), (0.0, -9.2, 0.5), (0.0, 1.6, 0.6),
                         (2.0, 2.6, 0.8)], 1.65, 'paint', bevel=0.4, seg=5)
    slots(st, 'st_pocket', [[(3.4, 0.6), (18.6, 0.6), (18.6, -2.6), (4.4, -6.6), (3.4, -6.6)]], 1.3, 3, 'paint', r=0.8)
    solid('shoulder_rest', [(0.2, 2.55), (6.0, 2.75), (6.0, 3.15), (0.2, 3.05)], 1.2, 'steel', bevel=0.08)
    bp = solid('buttpad', [(-1.5, -9.1), (0.1, -9.1), (0.1, 1.7), (-1.5, 1.7)], 1.7, 'rubber', bevel=0.26, r=0.4)
    ridges(bp, 'butt_r', -1.8, 0.4, -8.4, 1.0, 1.7, pitch=0.75, th=0.28, depth=0.1, tag='rubber')
    tube('buffer', 19.0, 22.2, 0.2, 1.5, 'steel', bevel=0.2)

    # carry handle
    solid('handle_arm', stroke([(55.2, 1.4), (56.2, 5.8), (64.4, 5.8)], 0.7), 0.45, 'steel', bevel=0.1, r=0.25)
    hg = tube('handle_grip', 57.6, 64.8, 5.8, 0.85, 'poly', bevel=0.2)
    serrations(hg, 'hgrip_r', 58.4, 64.0, 5.2, 6.4, 0.85, pitch=0.7, th=0.3, lean=0.0, depth=0.12, tag='poly')
    tube('handle_collar', 54.4, 56.6, 0, 1.9, 'steel', bevel=0.12)

    # folded bipod under the gas tube
    box('bipod_mount', 82.6, 85.4, -4.7, -3.0, 1.5, 'steel', bevel=0.15)
    b = B()
    b.tube(59.0, 84.0, -4.0, 1.2, 0.42, seg=20)
    b.tube(59.0, 84.0, -4.0, -1.2, 0.42, seg=20)
    b.done('bipod_legs', 'steel', 0.06)
    b = B()
    b.tube(56.6, 59.8, -4.0, 1.2, 0.62, seg=20)
    b.tube(56.6, 59.8, -4.0, -1.2, 0.62, seg=20)
    b.done('bipod_feet', 'rubber', 0.16)
