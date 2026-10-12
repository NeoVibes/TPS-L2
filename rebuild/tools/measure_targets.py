"""Takes the measurements of the model that the targets in edit/targets.json are checked against.

The last Blender stage of "npm run build". It only measures: the comparison with the targets is done
by tools/targets.mjs, so a target can be edited and checked again without Blender. Never saves the
Blender file. Lengths are in mm in the model's own axes: X across the front (blue body negative,
silver control side positive), Y front to back, Z along the body (headphone end positive).

A "diameter" here is the size of a round part across X. That is right only for parts that turn on
the front-to-back axis, which every part in ROUND_PARTS does.
"""
from pathlib import Path
import ast, json, sys
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
    'third_gear': 'RUN • third gear cam', 'secondary_gear': 'RUN • secondary gear'}
ROUND_PARTS = ['MEC-011', 'BAY-052', 'BAY-061', 'DRV-010', 'DRV-011', 'DRV-012', 'DRV-013', 'DRV-014', 'DRV-015', 'DRV-016',
               'DRV-020', 'DRV-022', 'DRV-023', 'FWD-021', 'MTR-005', 'CAM-010', 'MEDIA-003', 'MEDIA-005']
BELTS = {'BLT-001': 16, 'BLT-002': 16}
MODE_PARTS = ['DRV-023', 'DRV-012', 'DRV-013', 'FWD-021', 'BAY-061', 'BAY-060', 'MEC-011', 'DRV-011', 'DRV-014', 'DRV-010']

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
    face = [v.co for v in bm.verts if v.co.y < front_y + 0.0010]      # vertices within 1 mm of the front plane
    result['exterior'] = {'parts': ext, 'union': bounds(bm), 'front_face_x': [round(min(c.x for c in face) * MM, 3), round(max(c.x for c in face) * MM, 3)]}
else: result['exterior'] = {'parts': ext, 'union': None, 'front_face_x': None}
bm.free()
for part_id in ('BAY-010', 'MEDIA-001', 'MEDIA-002'):
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
    if name.startswith('RUN • '): result['run'][name[6:]] = {'expression': d['expression'], 'factor': simple(d['expression'], {'a': 1.0, 'u': 1.0, 't': 1.0})}

write_json(OUT / 'target-measurements.json', result)
print('MEASURED for the targets:', len(result['round_parts']), 'round parts,', len(result['pivots']), 'pivots,', len(result['modes']), 'modes')
