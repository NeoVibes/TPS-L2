"""Measures every part of the model as built: size, longest length, volume, and whether it is one closed solid.

A Blender stage of "npm run build". Reads the part list the export stage wrote (inventory.json) and
never saves the Blender file. Lengths are in mm along the model's own axes:
X across the front, Y front to back, Z along the body. Sizes are the model's values, not
measurements of a real unit.
"""
from pathlib import Path
import sys, json
import bpy, bmesh
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_io import OUT, CONFIG, bound_native, write_json, prepare_exterior, exterior_tags
from solid_measure import measure_solid

MM = 1000.0          # the Blender file is in metres
WELD = 1e-6          # 0.001 mm: joins vertices that were split only for shading

native, digest = bound_native()
bpy.ops.wm.open_mainfile(filepath=str(native), load_ui=False, use_scripts=False)
scene = bpy.context.scene
inventory = json.loads((OUT / 'inventory.json').read_text())
if inventory['native_sha256'] != digest: raise RuntimeError('The part list in the working files belongs to a different Blender file.')

# Rest position: stopped, door closed, nothing separated.
controllers = {o.get('controller_id'): o for o in bpy.data.objects if o.get('controller_id')}
transport = controllers[CONFIG['controllers']['transport']]
for key, value in {'Run Demo': 0., 'Transport': 0, 'Door': 0., 'Cassette': 0., 'STOP EJECT': 0., 'Eject stroke': 0., 'Service view': 0., 'Exploded view': 0.}.items():
    if key in transport: transport[key] = value
exterior = prepare_exterior(bpy, transport)      # every version's lettering is shown, so all of it is measured
transport.update_tag(); scene.frame_set(0); bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()

def measure(names):
    objects = [bpy.data.objects[n] for n in names if n in bpy.data.objects and bpy.data.objects[n].type == 'MESH']
    solid = [o for o in objects if not o.name.startswith('ART ')]          # lettering is surface artwork, not a solid
    report = {'blender_objects': len(objects), 'lettering_objects': len(objects) - len(solid)}
    if not solid: return {**report, 'closed_solid': False, 'why_not_closed': 'no solid geometry'}
    bm = bmesh.new()
    for obj in solid:
        evaluated = obj.evaluated_get(depsgraph); mesh = evaluated.to_mesh()
        mesh.transform(evaluated.matrix_world); bm.from_mesh(mesh); evaluated.to_mesh_clear()
    report.update(measure_solid(bm, MM, WELD))
    bm.free()
    return report

# A part is measured as the default exterior version shows it. A part whose lettering differs between
# versions is measured again for each of the others.
def shown_in(name, version):
    tags = exterior_tags(bpy.data.objects[name]) if name in bpy.data.objects else None
    return not tags or version in tags
parts, by_version, cache = {}, {v: {} for v in exterior['versions'][1:]}, {}
for owner in inventory['owners']:
    names = owner['geometry']
    default = [n for n in names if shown_in(n, exterior['default'])] if exterior['default'] else names
    parts[owner['part_id']] = cache[tuple(default)] = measure(default)
    if len(default) != len(names) or any(exterior_tags(bpy.data.objects[n]) for n in names if n in bpy.data.objects):
        for version in exterior['versions'][1:]:
            shown = tuple(n for n in names if shown_in(n, version))
            if shown not in cache: cache[shown] = measure(list(shown))
            by_version[version][owner['part_id']] = cache[shown]
write_json(OUT / 'part-measurements.json', {'native_sha256': digest, 'units': 'mm', 'axes': 'X across the front, Y front to back, Z along the body', 'parts': parts, 'exterior': by_version})
closed = sum(1 for p in parts.values() if p['closed_solid'])
print('MEASURED', len(parts), 'parts;', closed, 'are one closed solid,', len(parts) - closed, 'are not')
