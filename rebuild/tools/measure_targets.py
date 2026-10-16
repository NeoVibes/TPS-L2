"""Takes the measurements of the model that the targets in edit/targets.json are checked against.

The last Blender stage of "npm run build". It only measures: the comparison with the targets is done
by tools/targets.mjs, so a target can be edited and checked again without Blender. Never saves the
Blender file. Lengths are in mm in the model's own axes: X across the front (blue body negative,
silver control side positive), Y front to back, Z along the body (headphone end positive).

A "diameter" here is the size of a round part across X. That is right only for parts that turn on
the front-to-back axis, which every part in ROUND_PARTS does.
"""
from pathlib import Path
import ast, json, math, sys
import bpy, bmesh
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_io import OUT, CONFIG, bound_native, write_json, prepare_exterior, shown_by_default

MM = 1000.0
EXTERIOR = ['EXT-010', 'EXT-020', 'EXT-030', 'EXT-031', 'EXT-032', 'EXT-040', 'GRL-001']
PIVOTS = {
    'capstan_flywheel': 'DEMO • capstan and flywheel', 'supply_reel': 'DEMO • supply rotating members',
    'takeup_reel': 'DEMO • take-up rotating members', 'supply_hub': 'DEMO • supply cassette hub pivot',
    'takeup_hub': 'DEMO • takeup cassette hub pivot', 'pinch_roller': 'DEMO • pinch roller spin',
    'reverse_wheel': 'RUN • belt return guide', 'fr_pulley': 'RUN • FR pulley and tyre',
    'middle_pulley': 'RUN • middle pulley and primary pinion', 'motor': 'RUN • motor rotor and pulley',
    'fr_gear_a': 'RUN • FR gear A', 'fr_gear_b': 'RUN • FR gear B', 's_gear_b': 'RUN • supply intermediate',
    'third_gear': 'RUN • third gear cam', 'secondary_gear': 'RUN • secondary gear',
    'step_mate': 'RUN • gear beside the take-up', 'shutoff_post': 'MOVE • shut-off lever'}
ROUND_PARTS = ['MEC-011', 'BAY-052', 'BAY-061', 'CLT-030', 'DRV-010', 'DRV-011', 'DRV-012', 'DRV-013', 'DRV-014', 'DRV-015', 'DRV-016',
               'DRV-020', 'DRV-022', 'DRV-023', 'FWD-021', 'MTR-005', 'CAM-010', 'MEDIA-003', 'MEDIA-005']
BELTS = {'BLT-001': 16, 'BLT-002': 16}
MODE_PARTS = ['DRV-023', 'DRV-012', 'DRV-013', 'FWD-021', 'BAY-061', 'BAY-060', 'MEC-011', 'DRV-011', 'DRV-014', 'DRV-010', 'HDC-021', 'HDC-022', 'DRV-107']

native, digest = bound_native()
bpy.ops.wm.open_mainfile(filepath=str(native), load_ui=False, use_scripts=False)
inventory = json.loads((OUT / 'inventory.json').read_text())
if inventory['native_sha256'] != digest: raise RuntimeError('The part list in the working files belongs to a different Blender file.')
owners = {o['part_id']: o for o in inventory['owners']}
# The targets are checked on the default exterior version; lettering of the other versions is left out.
exterior = prepare_exterior(bpy, next(o for o in bpy.data.objects if o.get('controller_id') == CONFIG['controllers']['transport']))
dg = bpy.context.evaluated_depsgraph_get()

def meshes_of(part_id):
    for name in owners[part_id]['geometry'] if part_id in owners else ():
        obj = bpy.data.objects.get(name)
        if obj is not None and obj.type == 'MESH' and (not exterior['default'] or shown_by_default(obj, exterior)):
            yield name, obj

def world_bmesh(objs):
    bm = bmesh.new()
    for obj in objs:
        ev = obj.evaluated_get(dg); me = ev.to_mesh()
        me.transform(ev.matrix_world); bm.from_mesh(me); ev.to_mesh_clear()
    return bm

def bounds(bm):
    if not bm.verts: return None
    lo = [min(v.co[i] for v in bm.verts) * MM for i in range(3)]; hi = [max(v.co[i] for v in bm.verts) * MM for i in range(3)]
    return [round(x, 3) for x in lo], [round(x, 3) for x in hi]

result = {'native_sha256': digest, 'pivots': {}, 'round_parts': {}, 'belts': {}}

# The exterior: each cabinet part, all of them together, and how wide the front face is.
ext = {}
for part_id in EXTERIOR:
    bm = world_bmesh([o for n, o in meshes_of(part_id) if not n.startswith('ART ')]); ext[part_id] = bounds(bm); bm.free()
bm = world_bmesh([o for p in EXTERIOR for n, o in meshes_of(p) if not n.startswith('ART ')])
if bm.verts:
    front_y = min(v.co.y for v in bm.verts)
    face = [v.co for v in bm.verts if v.co.y < front_y + 0.0030]      # vertices within 3 mm of the front plane
    # the plain side from its outer wall; the control side from its side face within 3 mm of the front plane, which takes in its rounded
    # front edge and leaves out its keys, rail and MIC grille (both long edges are rounded, so the front plane alone stops short of them)
    result['exterior'] = {'parts': ext, 'union': bounds(bm), 'front_face_x': [round(min(v.co.x for v in bm.verts) * MM, 3), round(max(c.x for c in face) * MM, 3)]}
else: result['exterior'] = {'parts': ext, 'union': None, 'front_face_x': None}
bm.free()
for part_id in ('BAY-010', 'MEDIA-001', 'MEDIA-002', 'BAY-071', 'BAY-073'):
    bm = world_bmesh([o for n, o in meshes_of(part_id)]); result['exterior'][part_id] = bounds(bm); bm.free()

# The pivots the motion rig turns things on, and the centres and sizes of the round parts.
for key, name in PIVOTS.items():
    obj = bpy.data.objects.get(name)
    result['pivots'][key] = None if obj is None else [round(c * MM, 4) for c in obj.matrix_world.translation]
for part_id in ROUND_PARTS:
    bm = world_bmesh([o for n, o in meshes_of(part_id)]); b = bounds(bm); bm.free()
    if b: result['round_parts'][part_id] = {'bounds': b, 'centre_xz': [round((b[0][0] + b[1][0]) / 2, 3), round((b[0][2] + b[1][2]) / 2, 3)],
                                             'diameter_x': round(b[1][0] - b[0][0], 3), 'diameter_z': round(b[1][2] - b[0][2], 3),
                                             'depth_y': [b[0][1], b[1][1]]}

# The take-up shaft's stack: for each part on it, its levels and its smallest and largest radius about the axis (bores and fits).
STACK = ['DRV-104', 'BAY-020', 'CLT-020', 'CLT-021', 'DRV-204', 'DRV-014', 'CLT-010', 'CLT-030', 'CLT-031', 'CLT-032']
result['takeup_stack'] = {}
axis = result['pivots'].get('takeup_reel')
for part_id in STACK:
    if not axis or part_id not in owners: continue
    bm = world_bmesh([o for n, o in meshes_of(part_id)]); r = [math.hypot(v.co.x * MM - axis[0], v.co.z * MM - axis[2]) for v in bm.verts]; y = [v.co.y * MM for v in bm.verts]; bm.free()
    result['takeup_stack'][part_id] = {'depth': [round(min(y), 4), round(max(y), 4)], 'radius': [round(min(r), 4), round(max(r), 4)]}

# Tooth rings of the gears: at each height where a gear's outline is toothed, the tip radius and the number of teeth.
GEARS = {'DRV-010': 'supply_reel', 'DRV-011': 's_gear_b', 'DRV-012': 'fr_gear_a', 'DRV-013': 'fr_gear_b', 'DRV-014': 'takeup_reel', 'DRV-021': 'fr_pulley', 'CAM-010': 'third_gear',
         'DRV-015': 'middle_pulley', 'DRV-016': 'secondary_gear', 'DRV-017': 'step_mate'}
def points_of(part_id):
    bm = world_bmesh([o for n, o in meshes_of(part_id)]); pts = [tuple(c * MM for c in v.co) for v in bm.verts]
    edges = [(tuple(c * MM for c in e.verts[0].co), tuple(c * MM for c in e.verts[1].co)) for e in bm.edges]; bm.free(); return pts, edges
def tooth_rings(part_id, axis):
    pts, _ = points_of(part_id); levels = {}
    for x, y, z in pts: levels.setdefault(round(y, 2), []).append((math.hypot(x - axis[0], z - axis[2]), math.atan2(z - axis[2], x - axis[0])))
    rings = {}
    for y, level in levels.items():
        if len(level) < 24: continue
        top = max(r for r, a in level); tips = sorted({round(a, 4) for r, a in level if r > top - 0.02})
        if len(tips) < 8: continue
        gaps = [b - a for a, b in zip(tips, tips[1:] + [tips[0] + 2 * math.pi])]; wide = [g for g in gaps if g > (min(gaps) + max(gaps)) / 2]
        mean = sum(wide) / len(wide)
        if len(wide) >= 8 and max(gaps) > 1.5 * min(gaps) and max(abs(g - mean) for g in wide) < 0.15 * mean: rings[(round(top, 2), len(wide))] = True
    return [{'tip_radius': r, 'teeth': n} for r, n in sorted(rings, reverse=True)]
result['gears'] = {part_id: tooth_rings(part_id, result['pivots'][pivot]) for part_id, pivot in GEARS.items() if result['pivots'].get(pivot) and part_id in owners}

# Round parts and shafts by height, at rest: at each height where the part has vertices, its least and greatest radius from its axis.
PROFILES = {'MEC-011': 'capstan_flywheel', 'DRV-023': 'fr_pulley', 'DRV-106': 'middle_pulley', 'DRV-107': 'fr_pulley', 'CAM-101': 'third_gear',
            'DRV-202': 'fr_gear_a', 'DRV-213': 'fr_gear_b', 'DRV-205': 'secondary_gear'}
result['profiles'] = {}
for part_id, pivot in PROFILES.items():
    axis = result['pivots'].get(pivot)
    if not axis or part_id not in owners: continue
    levels = {}
    for x, y, z in points_of(part_id)[0]: levels.setdefault(round(y, 2), []).append(math.hypot(x - axis[0], z - axis[2]))
    result['profiles'][part_id] = [[y, round(min(r), 4), round(max(r), 4)] for y, r in sorted(levels.items())]
# The pinch lever's torsion spring, about its spindle at rest: wire thickness and mean coil from the coil's least and greatest radius (the
# median over 10-degree sectors, so the legs do not count), and its height (close-wound, legs in the end coils' planes).
if 'HDC-024' in owners and 'HDC-022' in owners:
    sp = points_of('HDC-022')[0]; cx, cz = (min(q[0] for q in sp) + max(q[0] for q in sp)) / 2, (min(q[2] for q in sp) + max(q[2] for q in sp)) / 2
    pts = points_of('HDC-024')[0]; sectors = {}
    for q in pts: sectors.setdefault(int(math.degrees(math.atan2(q[2] - cz, q[0] - cx)) // 10), []).append(math.hypot(q[0] - cx, q[2] - cz))
    med = lambda xs: sorted(xs)[len(xs) // 2]; inner, outer = med([min(r) for r in sectors.values()]), med([max(r) for r in sectors.values()])   # the legs reach only a few sectors
    result['pinch_spring'] = {'wire': round(outer - inner, 4), 'mean_coil': round(outer + inner, 4), 'height': round(max(q[1] for q in pts) - min(q[1] for q in pts), 4)}
# S gear B's back-tension spring (wire and mean coil by sector medians, installed height) and its brake felt's radii, about S gear B's axis.
if 'SBT-010' in owners and 'SBT-011' in owners and result['pivots'].get('s_gear_b'):
    ax = result['pivots']['s_gear_b']; pts = points_of('SBT-010')[0]; sectors = {}
    for q in pts: sectors.setdefault(int(math.degrees(math.atan2(q[2] - ax[2], q[0] - ax[0])) // 10), []).append(math.hypot(q[0] - ax[0], q[2] - ax[2]))
    med = lambda xs: sorted(xs)[len(xs) // 2]; inner, outer = med([min(r) for r in sectors.values()]), med([max(r) for r in sectors.values()])
    felt = [math.hypot(q[0] - ax[0], q[2] - ax[2]) for q in points_of('SBT-011')[0]]
    result['back_tension'] = {'wire': round(outer - inner, 4), 'mean_coil': round(outer + inner, 4), 'height': round(max(q[1] for q in pts) - min(q[1] for q in pts), 4), 'felt_radius': [round(min(felt), 4), round(max(felt), 4)]}
# Lever (B)'s spring at rest: its two ends (the hook in lever (B) is the one nearer FR gear B's axis) and, over its coiled middle, the wire
# and mean coil from the least and greatest distance to its axis.
if 'FRL-021' in owners and result['pivots'].get('fr_gear_b'):
    pts = points_of('FRL-021')[0]; bx = result['pivots']['fr_gear_b']; n_ = len(pts)
    mx, mz, my = sum(q[0] for q in pts) / n_, sum(q[2] for q in pts) / n_, sum(q[1] for q in pts) / n_      # the axis: through the centroid along the principal direction
    sxx = sum((q[0] - mx) ** 2 for q in pts); szz = sum((q[2] - mz) ** 2 for q in pts); sxz = sum((q[0] - mx) * (q[2] - mz) for q in pts)
    th = 0.5 * math.atan2(2 * sxz, sxx - szz); ux, uz = math.cos(th), math.sin(th)
    along = [(q[0] - mx) * ux + (q[2] - mz) * uz for q in pts]; s0, s1 = min(along), max(along); radial = []
    for q, s_ in zip(pts, along):
        if s0 + 1.2 < s_ < s1 - 1.2: radial.append(math.hypot(-(q[0] - mx) * uz + (q[2] - mz) * ux, q[1] - my))
    ends = sorted([(mx + ux * s0, mz + uz * s0), (mx + ux * s1, mz + uz * s1)], key=lambda q: math.hypot(q[0] - bx[0], q[1] - bx[2]))
    result['lever_b_spring'] = {'hook': [round(c, 4) for c in ends[0]], 'post': [round(c, 4) for c in ends[1]], 'wire': round(max(radial) - min(radial), 4), 'mean_coil': round(max(radial) + min(radial), 4)}
for part_id in ('STP-010', 'STP-011', 'RLC-030'):                      # posts measured about their own centres
    if part_id not in owners: continue
    pts = points_of(part_id)[0]; cx, cz = (min(q[0] for q in pts) + max(q[0] for q in pts)) / 2, (min(q[2] for q in pts) + max(q[2] for q in pts)) / 2; levels = {}
    for x, y, z in pts: levels.setdefault(round(y, 2), []).append(math.hypot(x - cx, z - cz))
    result['profiles'][part_id] = [[y, round(min(r), 4), round(max(r), 4)] for y, r in sorted(levels.items())]

# What stands up into the cassette, along Y (toward the lid is negative): reel spindle caps, the brass reel flanges' top faces, the
# locating pins' tips and base flanges, the capstan's tip, and the flywheel's front face.
def low_y(part_id, centre=None, r_min=0.0):
    pts = points_of(part_id)[0]
    if centre is None: centre = ((min(q[0] for q in pts) + max(q[0] for q in pts)) / 2, (min(q[2] for q in pts) + max(q[2] for q in pts)) / 2)
    return round(min(q[1] for q in pts if math.hypot(q[0] - centre[0], q[2] - centre[1]) >= r_min), 4)
if all(p in owners for p in ('BAY-030', 'BAY-031', 'BAY-020', 'BAY-021', 'BAY-050', 'BAY-051', 'BAY-052', 'MEC-011')):
    reel = {'BAY-030': 'takeup_reel', 'BAY-031': 'supply_reel'}; table = {'BAY-020': 'takeup_reel', 'BAY-021': 'supply_reel'}; cap_axis = result['pivots']['capstan_flywheel']
    result['depth_stack'] = {'caps': [low_y(p) for p in reel], 'flanges': [low_y(p, (result['pivots'][a][0], result['pivots'][a][2]), 4.0) for p, a in table.items()],
                             'pin_tips': [low_y(p) for p in ('BAY-050', 'BAY-051')], 'pin_flanges': [low_y(p, None, 1.9) for p in ('BAY-050', 'BAY-051')],
                             'capstan_tip': low_y('BAY-052'), 'flywheel_front': low_y('MEC-011', (cap_axis[0], cap_axis[2]), 6.6)}
    pin_pts = {p: points_of(p)[0] for p in ('BAY-050', 'BAY-051')}
    if 'MEDIA-002' in owners: result['depth_stack']['band_face'] = round(max(q[1] for q in points_of('MEDIA-002')[0]), 4)
    result['depth_stack']['pin_centres'] = [[round((min(q[i] for q in pts) + max(q[i] for q in pts)) / 2, 4) for i in (0, 2)] for pts in pin_pts.values()]

# The side keys: how far the LISTEN key's face stands past the grille's outer side face (the frame beside the volume slot), at rest.
if all(p in owners for p in ('CTL-03', 'GRL-001')):
    side = [q[0] for q in points_of('GRL-001')[0] if -60 < q[2] < 15 and 2.5 < q[1] < 14.5]
    result['controls'] = {'listen_key_x': round(max(q[0] for q in points_of('CTL-03')[0]), 4), 'side_face_x': round(max(side), 4) if side else None}
    # the control-side face's flat width across the body: from where the front edge's round starts to where the rear edge's starts
    grl = points_of('GRL-001')[0]
    front = [q[1] for q in grl if q[0] > 43.78 and q[1] < -10 and abs(q[2]) < 66.0]; rear = [q[1] for q in grl if q[0] > 44.69 and q[1] > 10 and abs(q[2]) < 66.0]   # end caps left out
    result['controls']['side_face_y'] = [round(min(front), 4), round(max(rear), 4)] if front and rear else None

# Battery bay: the cells' axes (the positive terminals' centres), the room round them along the cell's body between the springs' tips and
# the positive nub (sections every 1 mm through every part near the bay), the positive terminals' faces and the springs' tips and bases.
if all(p in owners for p in ('BAT-001', 'BAT-010', 'BAT-011', 'BAT-020', 'BAT-021')):
    import numpy as np
    term = [points_of(p)[0] for p in ('BAT-020', 'BAT-021')]
    axes = [((min(q[1] for q in t) + max(q[1] for q in t)) / 2, (min(q[2] for q in t) + max(q[2] for q in t)) / 2) for t in term]
    face = min(min(q[0] for q in t) for t in term); springs = [points_of(p)[0] for p in ('BAT-010', 'BAT-011')]
    lo_x, hi_x = max(max(q[0] for q in sp) for sp in springs) + 0.5, face - 1.0;                  # from just past the springs' tips to the positive nub
    box_lo = (lo_x - 1, min(a[0] for a in axes) - 8.5, min(a[1] for a in axes) - 8.5); box_hi = (hi_x + 1, max(a[0] for a in axes) + 8.5, max(a[1] for a in axes) + 8.5)
    tris = []
    for part_id in owners:
        if part_id.startswith('WIR-'): continue                                                     # the wires are soft: the cells press them aside
        for name, obj in meshes_of(part_id):
            ev = obj.evaluated_get(dg); corners = [ev.matrix_world @ Vector(c) * MM for c in ev.bound_box]
            if any(min(c[i] for c in corners) > box_hi[i] or max(c[i] for c in corners) < box_lo[i] for i in range(3)): continue
            me = ev.to_mesh(); me.calc_loop_triangles(); W = np.array([tuple(ev.matrix_world @ v.co * MM) for v in me.vertices])
            if len(me.loop_triangles): tris.append(W[np.array([t.vertices[:] for t in me.loop_triangles])])
            ev.to_mesh_clear()
    T = np.concatenate(tris); room = []
    for c in axes:
        best = 99.0
        for x0 in np.arange(lo_x, hi_x + 1e-9, 1.0):
            s_ = T[:, :, 0] - x0; cross = ~((s_ > 0).all(1) | (s_ < 0).all(1)); P, S = T[cross], s_[cross]; pts = []
            for i, j in ((0, 1), (1, 2), (2, 0)):
                a, b, sa, sb = P[:, i], P[:, j], S[:, i], S[:, j]; ok = (sa * sb <= 0) & (sa != sb); f = np.where(ok, sa / np.where(sa == sb, 1, sa - sb), 0)
                pts.append((np.where(ok[:, None], a + (b - a) * f[:, None], np.nan))[:, 1:])
            Q = np.stack(pts, 1)                                                                  # up to three points per triangle in (Y, Z)
            for i, j in ((0, 1), (1, 2), (0, 2)):
                A, B = Q[:, i], Q[:, j]; good = ~(np.isnan(A).any(1) | np.isnan(B).any(1)); A, B = A[good], B[good]
                if not len(A): continue
                D = B - A; L = (D * D).sum(1); t_ = np.clip(((np.array(c) - A) * D).sum(1) / np.where(L == 0, 1, L), 0, 1); near = A + D * t_[:, None]
                best = min(best, float(np.sqrt(((near - np.array(c)) ** 2).sum(1)).min()))
        room.append(round(best, 4))
    result['battery'] = {'axes_yz': [[round(a, 3) for a in c] for c in axes], 'positive_face': round(face, 4), 'free_radius': room,
                         'spring_tips': [round(max(q[0] for q in sp), 4) for sp in springs], 'spring_bases': [round(min(q[0] for q in sp), 4) for sp in springs]}

# The tape's band across its width (the cassette's tape pack) and the bands of what it runs over at the head end: pinch roller, capstan,
# head face, tape guide (along Y, at rest; nothing here moves along Y).
TAPE_PATH = ['MEDIA-004', 'BAY-061', 'BAY-052', 'BAY-060', 'HDC-040']
if all(p in owners for p in TAPE_PATH):
    result['tape_path'] = {p: [round(min(q[1] for q in points_of(p)[0]), 4), round(max(q[1] for q in points_of(p)[0]), 4)] for p in TAPE_PATH}

# The FWD pulley's drive: the radii its tyre runs between. The middle pulley's radius is read where the tyre sits.
def radius_at(part_id, axis, y):
    _, edges = points_of(part_id); best = None
    for a, b in edges:
        if (a[1] - y) * (b[1] - y) < 0:
            f = (y - a[1]) / (b[1] - a[1]); r = math.hypot(a[0] + f * (b[0] - a[0]) - axis[0], a[2] + f * (b[2] - a[2]) - axis[2]); best = r if best is None else max(best, r)
    return best
tyre, drum, middle = result['round_parts'].get('FWD-021'), result['round_parts'].get('CLT-030'), result['pivots'].get('middle_pulley')
if tyre and drum and middle and 'DRV-020' in owners:
    result['fwd_drive'] = {'tyre_radius': tyre['diameter_x'] / 2, 'drum_radius': drum['diameter_x'] / 2,
                           'middle_pulley_radius': round(radius_at('DRV-020', middle, sum(tyre['depth_y']) / 2), 3)}

# Which turning member of the motion rig carries each part on the take-up shaft.
TAKEUP_SHAFT = ['BAY-020', 'BAY-030', 'DRV-104', 'DRV-014', 'CLT-010', 'CLT-030', 'CLT-031', 'CLT-032', 'CLT-040', 'CLT-041', 'CLT-042']
result['carried_by'] = {}
for obj in bpy.data.objects:
    if obj.get('release_role') == 'pivot' and obj.get('owner_part_id') in TAKEUP_SHAFT:
        parent = obj.parent
        while parent is not None and not parent.name.startswith(('RUN • ', 'DEMO • ', 'MOVE • ')): parent = parent.parent
        result['carried_by'][obj['owner_part_id']] = parent.name.split(' • ', 1)[1] if parent is not None else None

# Belt centreline lengths from the swept meshes (the ring layout tools/belt_geometry.py relies on).
for part_id, section in BELTS.items():
    for name, obj in meshes_of(part_id):
        me = obj.data
        if len(me.vertices) % section: continue
        rings = len(me.vertices) // section; M = obj.matrix_world
        centres = [sum((M @ me.vertices[i * section + k].co for k in range(section)), Vector()) / section for i in range(rings)]
        length = sum((centres[(i + 1) % rings] - centres[i]).length for i in range(rings)) * MM
        result['belts'][part_id] = {'object': name, 'rings': rings, 'centreline_length_mm': round(length, 3)}

# Where the moving axes sit in each mode: the transport selector is set in memory only (0 STOP, 1 PLAY, 2 FF, 3 REW).
ctrl = bpy.data.objects.get('STAGE 1 • unified transport controller')
result['modes'] = {}
if ctrl is not None and 'Transport' in ctrl.keys():
    saved = ctrl['Transport']
    for mode, label in enumerate(('stop', 'play', 'ff', 'rew')):
        ctrl['Transport'] = mode; ctrl.update_tag(); bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
        dgm = bpy.context.evaluated_depsgraph_get(); entry = {'effective_mode': float(ctrl.evaluated_get(dgm).get('effective_mode', -1)), 'parts': {}}
        for part_id in MODE_PARTS:
            lo = [1e9] * 3; hi = [-1e9] * 3; found = False
            for name, obj in meshes_of(part_id):
                ev = obj.evaluated_get(dgm); found = True
                for corner in ev.bound_box:
                    w = ev.matrix_world @ Vector(corner)
                    for i in range(3): lo[i] = min(lo[i], w[i] * MM); hi[i] = max(hi[i], w[i] * MM)
            if found: entry['parts'][part_id] = {'centre_xz': [round((lo[0] + hi[0]) / 2, 3), round((lo[2] + hi[2]) / 2, 3)], 'size_xz': [round(hi[0] - lo[0], 3), round(hi[2] - lo[2], 3)]}
        result['modes'][label] = entry
    ctrl['Transport'] = saved

# Automatic shut-off: where the lever's teeth stand against the third gear at each stage (in PLAY, and at rest in STOP),
# how far the detection lever is swung and how far release lever C is turned.
result['shut_off'] = {}
third = result['pivots'].get('third_gear')
if ctrl is not None and 'Shut off' in ctrl.keys() and third and 'STF-012' in owners:
    saved = (ctrl['Transport'], ctrl['Shut off'])
    for label, mode, stage in (('rest', 0, 0), ('held', 1, 0), ('out', 1, 1), ('meshed', 1, 2), ('tripped', 1, 3)):
        ctrl['Transport'] = mode; ctrl['Shut off'] = stage; ctrl.update_tag(); bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
        dgm = bpy.context.evaluated_depsgraph_get(); pts = []
        for name, obj in meshes_of('STF-012'):
            ev = obj.evaluated_get(dgm); pts += [ev.matrix_world @ v.co * MM for v in obj.data.vertices]
        lever = [obj.evaluated_get(dgm).matrix_world @ v.co * MM for name, obj in meshes_of('STF-010') for v in obj.data.vertices]
        foot = [q for q in lever if q.y < min(w.y for w in lever) + 1.0]                              # the lowest millimetre of the lever: the blade's foot
        rlc = [obj.evaluated_get(dgm).matrix_world @ v.co * MM for name, obj in meshes_of('RLC-001') for v in obj.data.vertices]
        from mathutils.kdtree import KDTree
        tree = KDTree(len(rlc)); [tree.insert(q, i) for i, q in enumerate(rlc)]; tree.balance()
        to_release = min(tree.find(q)[2] for q in pts) if rlc else None                               # toothed piece to release lever C, nearest points
        turn = lambda name: round(math.degrees(bpy.data.objects[name].evaluated_get(dgm).rotation_euler[2]), 4) if name in bpy.data.objects else None
        result['shut_off'][label] = {'reach': round(min(math.hypot(q.x - third[0], q.z - third[2]) for q in pts), 4),
                                     'centre_xz': [round(sum(q.x for q in pts) / len(pts), 4), round(sum(q.z for q in pts) / len(pts), 4)],
                                     'detector_deg': turn('MOVE • detection lever'), 'release_deg': turn('MOVE • release lever C'),
                                     'blade': round(min(math.hypot(q.x - third[0], q.z - third[2]) for q in foot), 4),
                                     'to_release': None if to_release is None else round(to_release, 4)}
    ctrl['Transport'], ctrl['Shut off'] = saved; ctrl.update_tag(); bpy.context.scene.frame_set(0); bpy.context.view_layer.update()
    # The third gear's rib: how far from the gear's axis it reaches, above the ring of teeth.
    cam, _ = points_of('CAM-010'); rr = [(math.hypot(x - third[0], z - third[2]), y) for x, y, z in cam]; tip = max(r for r, y in rr)
    ring_top = max(y for r, y in rr if r > tip - 0.05); result['shut_off']['rib_reach'] = round(max(r for r, y in rr if y > ring_top + 0.01), 4)

# FF and REW: each button's lever drives Lever (A) through a cam on its edge meeting a follower post; a pin on Lever (A) works in the slot
# of the selector plate on FR gear A's arm. The cams, posts and pin are upright prisms, so their gaps are taken in plan (X, Z): each lever
# is cut at mid-lug height and its nearest point to each post is found.
def hull(pts):                                         # convex hull, counter-clockwise
    pts = sorted(set(pts)); cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); lo, hi = [], []
    for q in pts:
        while len(lo) > 1 and cross(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(pts):
        while len(hi) > 1 and cross(hi[-2], hi[-1], q) <= 0: hi.pop()
        hi.append(q)
    return lo[:-1] + hi[:-1]
def seg_dist(c, a, b):
    ab = (b[0] - a[0], b[1] - a[1]); L = ab[0] ** 2 + ab[1] ** 2; t = 0.0 if L == 0 else max(0.0, min(1.0, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1]) / L))
    return math.hypot(c[0] - a[0] - ab[0] * t, c[1] - a[1] - ab[1] * t)
def poly_gap(c, poly):                                 # distance from a point to a convex polygon, negative inside
    inside = all((poly[(i + 1) % len(poly)][0] - poly[i][0]) * (c[1] - poly[i][1]) - (poly[(i + 1) % len(poly)][1] - poly[i][1]) * (c[0] - poly[i][0]) > 0 for i in range(len(poly)))
    return -1.0 if inside else min(seg_dist(c, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))
result['ff_rew'] = {}
if ctrl is not None and all(p in owners for p in ('FCR-001', 'FCR-002', 'FRL-014', 'FRL-011', 'FRL-002', 'FRL-010')):
    saved = ctrl['Transport']
    for mode, label in ((0, 'rest'), (2, 'ff'), (3, 'rew')):
        ctrl['Transport'] = mode; ctrl.update_tag(); bpy.context.scene.frame_set(0); bpy.context.view_layer.update(); dgm = bpy.context.evaluated_depsgraph_get()
        def verts(part_id, keep=lambda name: True):
            return [obj.evaluated_get(dgm).matrix_world @ v.co * MM for name, obj in meshes_of(part_id) if keep(name) for v in obj.data.vertices]
        def section(part_id, y0=5.8):                                                                 # the lever cut at mid-lug height, as segments in (X, Z)
            segs = []
            for name, obj in meshes_of(part_id):
                ev = obj.evaluated_get(dgm); me = ev.to_mesh(); me.calc_loop_triangles(); W = [ev.matrix_world @ v.co * MM for v in me.vertices]
                for t in me.loop_triangles:
                    P_ = [W[i] for i in t.vertices]; cut = []
                    for i, j in ((0, 1), (1, 2), (2, 0)):
                        a_, b_ = P_[i], P_[j]
                        if (a_.y - y0) * (b_.y - y0) < 0: f = (y0 - a_.y) / (b_.y - a_.y); cut.append((a_.x + (b_.x - a_.x) * f, a_.z + (b_.z - a_.z) * f))
                    if len(cut) == 2: segs.append(cut)
                ev.to_mesh_clear()
            return segs
        levers = {pid: section(pid) for pid in ('FCR-001', 'FCR-002')}
        tops = sorted([q for q in verts('FRL-014') if q.y > max(w.y for w in verts('FRL-014')) - 0.01], key=lambda q: q.z)
        half = len(tops) // 2; posts = []                                                              # the REW lever's post (lower Z), then the FF lever's
        for ring in (tops[:half], tops[half:]):
            c = (sum(q.x for q in ring) / len(ring), sum(q.z for q in ring) / len(ring)); posts.append((c, max(math.hypot(q.x - c[0], q.z - c[1]) for q in ring)))
        gaps = lambda pid: [round(min(seg_dist(c, a_, b_) for a_, b_ in levers[pid]) - r, 4) for c, r in posts]
        pin = [q for q in verts('FRL-011') if q.y < 2.12]; pc = (sum(q.x for q in pin) / len(pin), sum(q.z for q in pin) / len(pin)); pr = max(math.hypot(q.x - pc[0], q.z - pc[1]) for q in pin)
        walls = []
        for name, obj in meshes_of('FRL-002'):
            ev = obj.evaluated_get(dgm); w = [ev.matrix_world @ v.co * MM for v in obj.data.vertices]; top = max(q.y for q in w)
            walls += [((w[a].x, w[a].z), (w[b].x, w[b].z)) for a, b in (e.vertices for e in obj.data.edges) if w[a].y > top - 0.01 and w[b].y > top - 0.01]
        bar = verts('FRL-010')
        result['ff_rew'][label] = {'ff_cam_to_posts': gaps('FCR-001')[::-1], 'rew_cam_to_posts': gaps('FCR-002'),
                                   'pin_to_slot_wall': round(min(seg_dist(pc, a, b) for a, b in walls) - pr, 4),
                                   'bar_centre_xz': [round(sum(q.x for q in bar) / len(bar), 4), round(sum(q.z for q in bar) / len(bar), 4)]}
    ctrl['Transport'] = saved; ctrl.update_tag(); bpy.context.scene.frame_set(0); bpy.context.view_layer.update()

# The cassette's body thickness away from its head band, the band's back against the head-carriage plate, and the tape plane's height
# above that plate (at rest).
if 'MEDIA-001' in owners and 'MEDIA-002' in owners and 'HDC-001' in owners:
    shells = points_of('MEDIA-001')[0] + points_of('MEDIA-002')[0]
    body = [q for q in shells if q[0] < 5.0]
    in_band = lambda q: 9.0 < q[0] < 24.0 and -41.9 < q[2] < 27.0
    plate = [q[1] for q in points_of('HDC-001')[0] if in_band(q)]
    rear_band = [q[1] for q in points_of('MEDIA-002')[0] if in_band(q)]
    pack = [q[1] for q in points_of('MEDIA-004')[0]]
    result['cassette_fit'] = {'body_depth': [round(min(q[1] for q in body), 4), round(max(q[1] for q in body), 4)],
                              'band_to_plate': round(min(plate) - max(rear_band), 4) if plate and rear_band else None,
                              'tape_plane_above_plate': round(min(plate) - (min(pack) + max(pack)) / 2, 4) if plate and pack else None}

# How fast the motion rig turns things. Its driver expressions were recorded by the export stage; they are
# worked out here with a small evaluator that accepts arithmetic, comparisons and "a if b else c" only.
def simple(expression, names):
    def value(node):
        if isinstance(node, ast.Expression): return value(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)): return node.value
        if isinstance(node, ast.Name) and node.id in names: return names[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd, ast.Not)):
            v = value(node.operand); return -v if isinstance(node.op, ast.USub) else +v if isinstance(node.op, ast.UAdd) else not v
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            a, b = value(node.left), value(node.right)
            return a + b if isinstance(node.op, ast.Add) else a - b if isinstance(node.op, ast.Sub) else a * b if isinstance(node.op, ast.Mult) else a / b
        if isinstance(node, ast.IfExp): return value(node.body) if value(node.test) else value(node.orelse)
        if isinstance(node, ast.BoolOp):
            values = [value(v) for v in node.values]; return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            a, b, op = value(node.left), value(node.comparators[0]), node.ops[0]
            for kind, test in ((ast.Lt, a < b), (ast.Gt, a > b), (ast.LtE, a <= b), (ast.GtE, a >= b), (ast.Eq, a == b), (ast.NotEq, a != b)):
                if isinstance(op, kind): return test
        raise ValueError('not a simple driver expression: ' + expression)
    return value(ast.parse(expression, mode='eval'))

motion = json.loads((OUT / 'motion.json').read_text()); fps = json.loads((OUT / 'native-checks.json').read_text())['fps']
angles = {d['data_path']: d['expression'] for d in motion['native_dependencies'] if d['owner']['datablock'].startswith('STAGE 1')}
def rate(path, mode):                               # rad/s in real time, as the rig's own expression defines it
    return simple(angles[path], {'t': 0, 'r': 0, 'e': 0, 'frame': 1, 'm': mode, 'd': 0, 'c': 0, 'q': 0}) * fps
result['fps'] = fps
result['rates_rad_s'] = {name: {label: rate('["' + name + '_angle"]', mode) for mode, label in ((1, 'play'), (2, 'ff'), (3, 'rew'))}
                         for name in ('flywheel', 'supply', 'takeup') if '["' + name + '_angle"]' in angles}
result['run'] = {}
for d in motion['native_dependencies']:
    name = d['owner']['datablock']
    if name.startswith('RUN • '):          # how fast it turns for one unit of flywheel, supply reel or take-up reel: in PLAY, and in each mode
        result['run'][name[6:]] = {'expression': d['expression'], 'factor': simple(d['expression'], {'a': 1.0, 'u': 1.0, 't': 1.0, 'm': 1}),
                                   'by_mode': {label: simple(d['expression'], {'a': 1.0, 'u': 1.0, 't': 1.0, 'm': mode}) for mode, label in ((1, 'play'), (2, 'ff'), (3, 'rew'))}}

write_json(OUT / 'target-measurements.json', result)
print('MEASURED for the targets:', len(result['round_parts']), 'round parts,', len(result['pivots']), 'pivots,', len(result['modes']), 'modes')
