# Knives and gloves for Crate Ops. Original, fictional designs.
# Kit space: x along the blade / fingers (+x = tip), y up, z toward the viewer, centimetres.
from gunkit import *  # noqa: F401,F403
from weapons import weapon, ridges, serrations, screws  # noqa: F401
import gunkit


# ----------------------------------------------------------------------------- helpers

def circ(cx, cy, r, n=28):
    return arc(cx, cy, r, 0, 360, n)[:-1]


def polar(r, a):
    return (r * math.cos(math.radians(a)), r * math.sin(math.radians(a)))


def spl(ctrl, n):
    """Resample a control polyline to n points with a Catmull-Rom spline."""
    P = [Vector(c[:2]) for c in ctrl]
    m = len(P)
    out = []
    for k in range(n):
        u = k / (n - 1) * (m - 1)
        i = min(int(u), m - 2)
        t = u - i
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, m - 1)]
        q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                   + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
        out.append((q.x, q.y))
    return out


def mix(A, Bp, f):
    return [(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) for a, b in zip(A, Bp)]


def loft(name, sections, tag, bevel=0.04, seg=2, angle=30.0):
    """Blade-style loft. sections = [(polyline, half_width), ...] with equal point counts;
    consecutive polylines are bridged on the front and back, so a section with half width 0
    is a knife edge. Interior section lines are marked sharp to give crisp grind lines."""
    b = B()
    bm = b.bm
    m = len(sections)
    n = len(sections[0][0])
    F, K = [], []
    for pts, hw in sections:
        hws = hw if isinstance(hw, (list, tuple)) else [hw] * len(pts)
        f = [bm.verts.new(V(x, y, h)) for (x, y), h in zip(pts, hws)]
        k = f if max(hws) <= 1e-6 else [bm.verts.new(V(x, y, -h)) for (x, y), h in zip(pts, hws)]
        F.append(f)
        K.append(k)

    def face(vs):
        u = []
        for v in vs:
            if v not in u:
                u.append(v)
        if len(u) >= 3:
            try:
                bm.faces.new(u)
            except ValueError:
                pass

    for i in range(m - 1):
        for j in range(n - 1):
            face((F[i][j], F[i][j + 1], F[i + 1][j + 1], F[i + 1][j]))
            if not (F[i] is K[i] and F[i + 1] is K[i + 1]):
                face((K[i][j], K[i + 1][j], K[i + 1][j + 1], K[i][j + 1]))
    for i in (0, m - 1):
        if F[i] is not K[i]:
            for j in range(n - 1):
                face((F[i][j], K[i][j], K[i][j + 1], F[i][j + 1]))
    for j in (0, n - 1):
        face([F[i][j] for i in range(m)] + [K[i][j] for i in reversed(range(m)) if K[i] is not F[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for i in range(1, m - 1):
        for j in range(n - 1):
            for row in (F[i], K[i]):
                e = bm.edges.get((row[j], row[j + 1]))
                if e:
                    e.smooth = False
    return b.done(name, tag, bevel, seg, angle)


def blade(name, S, E, hw, grind=0.5, edge=0.93, tag='paint', fuller=None):
    """Spine line S, edge line E -> flat + primary grind (paint) and a bright honed edge.
    fuller = (f0, f1, depth, j0, j1): a groove between fractions f0..f1 of the way from spine
    to edge, running from sample j0 to j1 and fading out at both ends (no booleans needed)."""
    G = mix(S, E, grind)
    P = mix(S, E, edge)
    secs = [(S, hw)]
    if fuller:
        f0, f1, depth, j0, j1 = fuller
        n = len(S)

        def win(j):
            a = min(1.0, max(0.0, (j - j0) / 3.0))
            b = min(1.0, max(0.0, (j1 - j) / 3.0))
            t = min(a, b)
            return t * t * (3 - 2 * t)
        low = [hw - depth * win(j) for j in range(n)]
        q = (f1 - f0) * 0.3
        secs += [(mix(S, E, f0), hw), (mix(S, E, f0 + q), low), (mix(S, E, f1 - q), low), (mix(S, E, f1), hw)]
    secs += [(G, hw), (P, hw * 0.16)]
    body = loft(name, secs, tag)
    loft(name + '_edge', [(P, hw * 0.16), (E, 0.0)], 'bright', bevel=0.0)
    return body


def _bool(ob, cob, op):
    m = ob.modifiers.new('Clip', 'BOOLEAN')
    m.operation = op
    m.object = cob
    for s in ('MANIFOLD', 'FLOAT', 'FAST', 'EXACT'):
        try:
            m.solver = s
            break
        except TypeError:
            continue
    return m


def blob(name, tag, build, voxel=0.11, smooth=5, clip=None):
    """Organic part: primitives fused by a voxel remesh, optionally clipped, then smoothed."""
    b = B()
    build(b)
    ob = b.done(name, tag, 0.0)
    rm = ob.modifiers.new('Remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    rm.adaptivity = 0.0
    rm.use_smooth_shade = True
    for cob, op in clip or []:
        _bool(ob, cob, op)
    if smooth:
        s = ob.modifiers.new('Smooth', 'SMOOTH')
        s.factor = 0.8
        s.iterations = smooth
    return ob


def region(name, cells, z0=-9.0, z1=9.0, r=0.0):
    c = cutter(name)
    for cell in cells:
        c.prism(cell, z0, z1, r)
    return cut_done(c)


# =============================================================================
# FANG  (combat knife)
# =============================================================================
@weapon('fang', yaw=12, pitch=13, roll=-20)
def fang():
    n = 44
    S = spl([(12.8, 1.76), (16.5, 1.8), (20.2, 1.82), (23.8, 1.78), (26.4, 1.05), (28.9, 0.42), (31.2, -0.08)], n)
    E = spl([(12.8, -1.7), (16.5, -1.76), (20.2, -1.8), (23.8, -1.76), (27.0, -1.42), (29.6, -0.82), (31.2, -0.2)], n)
    bl = blade('blade', S, E, 0.3, grind=0.46, edge=0.9, fuller=(0.2, 0.36, 0.13, 5, 27))
    slots(bl, 'saw', [[(15.2 + i * 0.72, 2.4), (15.76 + i * 0.72, 2.4), (15.48 + i * 0.72, 1.44)] for i in range(9)],
          -1, 1, 'bright')
    solid('ricasso', [(12.5, -1.74), (14.4, -1.74, 0.4), (14.4, 1.79), (12.5, 1.79)], 0.315, 'paint', bevel=0.05)
    solid('guard', [(11.6, -3.0, 0.45), (12.9, -2.75, 0.35), (13.05, 2.8, 0.35), (11.75, 3.05, 0.45)],
          0.82, 'steel', bevel=0.2, seg=4)
    hd = solid('handle', [(1.5, -1.25, 0.3), (4.4, -1.52, 1.0), (8.2, -1.4, 1.0), (11.7, -1.52, 0.2), (11.7, 1.42, 0.2),
                          (8.2, 1.46, 1.0), (4.4, 1.52, 1.0), (1.5, 1.2, 0.3)], 0.96, 'accent', bevel=0.38, seg=4)
    serrations(hd, 'grooves', 2.7, 10.9, -1.7, 1.7, 0.96, pitch=0.86, th=0.3, lean=0.0, depth=0.17, tag='poly')
    screws('pins', [(3.85, 0.0), (9.95, 0.0)], 0.96, 0.3, 'bright')
    pm = solid('pommel', [(-0.9, -1.05, 0.45), (1.7, -1.45, 0.2), (1.7, 1.4, 0.2), (-0.9, 1.0, 0.45)],
               0.86, 'steel', bevel=0.22, seg=4)
    slots(pm, 'lanyard', [circ(0.25, 0.0, 0.45, 20)], -2, 2, 'poly')


# =============================================================================
# TALON  (curved claw knife with finger ring)
# =============================================================================
@weapon('talon', yaw=12, pitch=12, roll=-8)
def talon():
    n = 46
    S, E = [], []
    for k in range(n):
        t = k / (n - 1) * 0.992
        a = 96 - 86 * t
        rc = 11.8 - 1.1 * t * t
        w = 1.85 * (1 - t ** 1.8) ** 0.85
        S.append(polar(rc + w, a))
        E.append(polar(rc - w, a))
    blade('blade', S, E, 0.3, grind=0.5, edge=0.9, fuller=(0.13, 0.33, 0.13, 3, 30))
    solid('bolster', band(0, 0, 9.8, 13.8, 93, 102, 4), 1.02, 'steel', bevel=0.2, seg=4)
    hd = solid('handle', band(0, 0, 10.35, 13.25, 101, 168, 22), 0.96, 'accent', bevel=0.36, seg=4)
    slots(hd, 'grooves', [rot(rect(10.0, 13.6, -0.13, 0.13), a) for a in range(108, 162, 5)], 0.8, 3, 'poly')
    plate('inlay', band(0, 0, 11.35, 12.25, 105, 164, 20), 0.96, 0.09, 'rubber', bevel=0.05)
    screws('pins', [polar(11.8, 104.0), polar(11.8, 135.0), polar(11.8, 165.0)], 1.05, 0.3, 'bright')
    rc = polar(11.8, 175.5)
    ring = solid('ring', circ(rc[0], rc[1], 2.3, 32), 0.62, 'steel', bevel=0.26, seg=4)
    slots(ring, 'ring_hole', [circ(rc[0], rc[1], 1.42, 28)], -2, 2, 'steel')


# =============================================================================
# NEEDLE  (double-edged dagger)
# =============================================================================
@weapon('needle', yaw=12, pitch=12, roll=-20)
def needle():
    n = 40
    T, C, Bt = [], [], []
    for k in range(n):
        t = k / (n - 1) * 0.993
        x = 10.2 + 21.0 * t
        w = 1.32 * (1 - t ** 1.7)
        T.append((x, w))
        C.append((x, 0.0))
        Bt.append((x, -w))
    Tp, Bp = mix(C, T, 0.9), mix(C, Bt, 0.9)
    loft('blade', [(Tp, 0.05), (C, 0.36), (Bp, 0.05)], 'paint', bevel=0.0)
    loft('edge_t', [(Tp, 0.05), (T, 0.0)], 'bright', bevel=0.0)
    loft('edge_b', [(Bp, 0.05), (Bt, 0.0)], 'bright', bevel=0.0)
    solid('ricasso', [(9.6, -1.38), (11.3, -1.38, 0.3), (11.3, 1.38, 0.3), (9.6, 1.38)], 0.4, 'paint', bevel=0.08)
    plate('ricasso_mark', [(10.0, -0.75), (10.9, -0.75), (10.9, 0.75), (10.0, 0.75)], 0.4, 0.06, 'accent', r=0.15)
    solid('guard', [(8.5, -3.2, 0.3), (9.5, -3.45, 0.3), (9.85, -1.1, 0.3), (9.85, 1.1, 0.3), (9.5, 3.45, 0.3),
                    (8.5, 3.2, 0.3), (8.75, 1.2, 0.3), (8.75, -1.2, 0.3)], 0.56, 'steel', bevel=0.18, seg=4)
    B().ball(9.0, 3.5, 0, 0.62).ball(9.0, -3.5, 0, 0.62).done('guard_balls', 'steel', 0.0)
    tube('core', 2.2, 8.7, 0, 0.84, 'poly', bevel=0.05)
    w = B()
    for i in range(9):
        w.tube(2.55 + i * 0.67, 3.06 + i * 0.67, 0, 0, 1.0)
    for v in w.bm.verts:
        v.co.x += 0.3 * v.co.z
    w.done('wrap', 'accent', 0.14, 3)
    tube('ferrule_a', 8.05, 8.75, 0, 1.08, 'steel', bevel=0.12)
    tube('ferrule_b', 1.75, 2.45, 0, 1.08, 'steel', bevel=0.12)
    B().ball(0.75, 0, 0, 1.22, 1.0, 1.0, 0.9, 32).done('pommel', 'steel', 0.0)
    tube('nut', -0.75, -0.3, 0, 0.36, 'bright', bevel=0.08)


# =============================================================================
# BOLO  (heavy forward-weighted chopper)
# =============================================================================
@weapon('bolo', yaw=12, pitch=13, roll=-17)
def bolo():
    n = 48
    S = spl([(12.4, 1.5), (17, 1.9), (22, 2.35), (27, 2.85), (31.5, 3.15), (35.2, 2.55), (37.6, 0.85)], n)
    E = spl([(12.4, -1.5), (17, -2.05), (22, -3.05), (27, -4.15), (31.5, -4.5), (35.5, -3.1), (37.7, 0.6)], n)
    bl = blade('blade', S, E, 0.34, grind=0.62, edge=0.94, fuller=(0.08, 0.2, 0.15, 4, 40))
    slots(bl, 'holes', [circ(28.2 + i * 2.5, 0.35 - i * 0.12, 0.62, 20) for i in range(3)], -2, 2, 'bright')
    slots(bl, 'notch', [circ(14.1, -1.85, 0.55, 16)], -2, 2, 'bright')
    solid('guard', [(11.2, -2.35, 0.35), (12.75, -2.1, 0.3), (12.75, 2.05, 0.3), (11.2, 2.2, 0.35)],
          0.98, 'steel', bevel=0.22, seg=4)
    solid('handle', [(0.9, -1.95, 0.7), (4.2, -1.55, 1.2), (8.4, -1.72, 1.0), (11.3, -1.78, 0.3), (11.3, 1.62, 0.3),
                     (8.0, 1.56, 1.0), (3.6, 1.72, 1.2), (0.7, 1.6, 0.5)], 1.08, 'accent', bevel=0.42, seg=4)
    gp = plate('grip', [(2.2, -0.95, 0.4), (10.3, -1.05, 0.4), (10.3, 0.9, 0.4), (2.2, 0.95, 0.4)], 1.08, 0.08, 'rubber', bevel=0.05)
    ridges(gp, 'grip_tex', 1.8, 10.8, -0.9, 0.9, 1.16, pitch=0.36, th=0.16, depth=0.07, tag='poly')
    B().pin(3.4, 0.0, 0.9, 1.3, 0.56).pin(6.5, -0.02, 0.9, 1.3, 0.56).pin(9.6, -0.04, 0.9, 1.3, 0.56).done('washers', 'steel', 0.06, 2)
    screws('rivets', [(3.4, 0.0), (6.5, -0.02), (9.6, -0.04)], 1.3, 0.34, 'bright')
    pm = solid('pommel', [(-1.2, -2.75, 0.5), (1.15, -2.2, 0.25), (1.15, 1.8, 0.25), (-0.7, 1.75, 0.5), (-0.45, -0.6, 0.6)],
               1.02, 'steel', bevel=0.24, seg=4)
    slots(pm, 'lanyard', [circ(0.15, -1.45, 0.42, 18)], -2, 2, 'poly')


# =============================================================================
# hands
# =============================================================================
# base (x, y, z), fan angle, length, root radius, tip radius   (right hand, back view, thumb up)
FING = [
    ((9.3, 3.05, 0.2), 7.0, 7.4, 1.08, 0.86),
    ((9.8, 1.0, 0.32), 2.0, 8.2, 1.12, 0.88),
    ((9.4, -1.05, 0.22), -3.5, 7.6, 1.06, 0.84),
    ((8.4, -2.95, 0.02), -10.0, 6.0, 0.95, 0.76),
]
THUMB = ((3.3, 4.25, -0.75), 40.0, 6.3, 1.3, 1.02)


def _chain(b, f, d, curl=1.3):
    base, ang, L, r0, r1 = f
    ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    k = max(8, int(L / (0.3 * r1)))
    for i in range(k + 1):
        s = i / k
        r = r0 + (r1 - r0) * s
        r *= 1 + 0.07 * (math.exp(-((s - 0.44) / 0.05) ** 2) + math.exp(-((s - 0.74) / 0.05) ** 2))
        b.ball(base[0] + ca * L * s, base[1] + sa * L * s, base[2] - curl * s ** 1.7, r + d, seg=14)


def hand(b, d=0.0, parts='wpft'):
    """Hand primitives inflated by d. parts: w = wrist/cuff, p = palm, f = fingers, t = thumb."""
    if 'p' in parts:
        b.ball(4.6, 0.05, -0.15, 1, 5.3 + d, 4.45 + d, 1.75 + d, 32)
        b.ball(7.6, 0.0, 0.0, 1, 2.6 + d, 4.15 + d, 1.6 + d, 24)
        b.ball(2.9, 3.3, -0.6, 1, 3.0 + d, 2.0 + d, 1.5 + d, 24)
    if 'w' in parts:
        x = -10.6
        while x <= 0.8:   # closely spaced so the union has no visible scallops
            fl = min(1.0, max(0.0, (-5.5 - x) / 4.0))
            b.ball(x, 0.0, -0.15, 1, 2.2 + d, 3.4 + 0.55 * fl + d, 2.1 + 0.35 * fl + d, 24)
            x += 0.3
    if 'f' in parts:
        for f in FING:
            base, _ang, _L, r0, _r1 = f
            b.ball(base[0] - 0.25, base[1], base[2] + 0.12, r0 * 1.2 + d, seg=16)
            _chain(b, f, d)
    if 't' in parts:
        _chain(b, THUMB, d, curl=0.5)


def slab(cx, cy, ang, w, L=30.0):
    return move(rot(rect(-L, L, -w / 2, w / 2), ang), cx, cy)


def fseg(f, s0, s1, pad=0.5):
    base, ang, L, r0, _r1 = f
    return move(rot(rect(L * s0, L * s1, -(r0 + pad), r0 + pad), ang), base[0], base[1])


def shell(name, tag, d, cells, z0=-9.0, z1=9.0, smooth=3, r=0.0, parts='wpft'):
    """A layer that hugs the hand: the hand inflated by d, kept only inside the given cells."""
    cob = region(name + '_clip', cells, z0, z1, r)
    return blob(name, tag, lambda b: hand(b, d, parts), 0.1, smooth, [(cob, 'INTERSECT')])


def fshell(name, tag, d, f, s0, s1, z0=-9.0, pad=0.5, r=0.0, curl=1.3):
    """Shell around a single finger only, so neighbouring fingers never bleed into it."""
    cob = region(name + '_clip', [fseg(f, s0, s1, pad)], z0, 9.0, r)
    return blob(name, tag, lambda b: _chain(b, f, d, curl), 0.09, 3, [(cob, 'INTERSECT')])


def freeze():
    """Apply the remesh stacks once so the three bake passes do not re-evaluate them."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in gunkit._parts:
        if any(m.type == 'REMESH' for m in ob.modifiers):
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            ob.modifiers.clear()
            ob.data = me


def base_hand(tag):
    cuff = region('cuff_cut', [rect(-30, -9.3, -12, 12)])
    return blob('hand', tag, lambda b: hand(b, 0.0), 0.1, 5, [(cuff, 'DIFFERENCE')])


# =============================================================================
# GAUNTLET  (hard-knuckle operator glove)
# =============================================================================
@weapon('gauntlet', yaw=9, pitch=10, roll=-7, margin=1.06)
def gauntlet():
    base_hand('paint')
    shell('knuckle', 'poly', 0.45, [[(7.2, 4.6), (10.3, 4.55), (11.3, 2.2), (11.6, 0.7), (11.2, -1.5), (10.0, -4.2),
                                     (6.9, -4.3), (6.5, 0.0)]], 0.25, 9, r=0.7, parts='pf')
    for i, f in enumerate(FING):
        fshell('fa%d' % i, 'accent', 0.24, f, 0.17, 0.4, -0.45, r=0.25)
        fshell('fb%d' % i, 'paint', 0.24, f, 0.49, 0.7, -0.6, r=0.25)
        fshell('ft%d' % i, 'rubber', 0.12, f, 0.87, 1.2)
    fshell('ta', 'accent', 0.24, THUMB, 0.34, 0.62, -1.4, r=0.25, curl=0.5)
    fshell('tt', 'rubber', 0.12, THUMB, 0.84, 1.2, curl=0.5)
    shell('back_bars', 'accent', 0.2, [[(1.4 + i * 1.75, -2.9), (2.5 + i * 1.75, -2.9), (3.6 + i * 1.75, 2.5), (2.5 + i * 1.75, 2.5)]
                                       for i in range(3)], 0.3, 9, r=0.3, parts='pw')
    shell('strap', 'accent', 0.3, [rect(-3.7, -1.5, -12, 12)], -9, 9, parts='wp')
    shell('tab', 'poly', 0.55, [rect(-4.0, -1.2, -1.6, 1.9)], 0.5, 9, r=0.45, parts='wp')
    pin('snap', -2.6, 0.2, 2.2, 2.92, 0.42, 'steel', bevel=0.1)
    shell('hem', 'rubber', 0.22, [rect(-9.3, -8.3, -12, 12)], -9, 9, parts='w')
    shell('cuff_panel', 'paint', 0.16, [[(-7.6, -2.2), (-5.0, -2.2), (-4.4, 2.2), (-7.6, 2.2)]], 0.5, 9, r=0.4, parts='w')
    freeze()


# =============================================================================
# WRAPS  (cloth hand wraps over a fingerless inner glove)
# =============================================================================
@weapon('wraps', yaw=9, pitch=10, roll=-7, margin=1.06)
def wraps():
    base_hand('accent')
    # wrist: overlapping near-vertical turns
    for i, (x, a, d) in enumerate([(-8.3, 84, 0.16), (-6.6, 97, 0.28), (-4.9, 83, 0.2), (-3.2, 98, 0.32), (-1.5, 84, 0.24)]):
        shell('wrist%d' % i, 'paint', d, [slab(x, 0, a, 2.15)], -9, 9, parts='wp')
    # back of the hand: crossing diagonals, then the knuckle turns
    shell('diag_a', 'paint', 0.22, [slab(3.4, 0.6, 52, 2.3)], -9, 9, parts='wpt')
    shell('diag_b', 'paint', 0.36, [slab(3.9, -0.4, -50, 2.3)], -9, 9, parts='wpt')
    shell('diag_c', 'paint', 0.3, [slab(1.0, 0.0, 72, 2.0)], -9, 9, parts='wpt')
    shell('knuck_a', 'paint', 0.34, [slab(8.9, 0.0, 80, 2.2)], -9, 9, parts='pf')
    shell('knuck_b', 'paint', 0.46, [slab(7.5, 0.0, 99, 2.1)], -9, 9, parts='pf')
    for i, f in enumerate(FING):
        fshell('fw%d' % i, 'paint', 0.2, f, 0.2, 0.43, pad=0.6)
    shell('thumb', 'paint', 0.24, [fseg(THUMB, 0.05, 0.4, 0.7)], -9, 9, parts='tp')
    shell('pad', 'rubber', 0.6, [[(9.7, 3.9), (10.9, 2.0), (11.2, 0.6), (10.8, -1.6), (9.6, -3.9), (8.6, -3.8), (9.2, 0.2), (8.8, 3.8)]],
          0.4, 9, r=0.4, parts='pf')
    shell('tab', 'poly', 0.5, [rect(-6.2, -3.6, -1.5, 1.6)], 0.6, 9, r=0.4, parts='w')
    pin('snap', -4.9, 0.05, 2.25, 2.95, 0.4, 'steel', bevel=0.1)
    freeze()
