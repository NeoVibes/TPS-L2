"""Build a source-informed, six-owner cassette component delta, never save native.

Blender --background --factory-startup --disable-autoexec --python this_file
The current native supplies the frozen owner transforms/interfaces, not old-app
geometry. Photo topology and explicitly estimated dimensions are in parameters.
"""
import bpy, bmesh, gzip, hashlib, json, math, struct, sys
from pathlib import Path
from mathutils import Matrix, Vector, Quaternion
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_io import ROOT as R, OUT, CONFIG, check_space,write_bytes_guarded,bound_native,write_json
from solid_measure import measure_solid
O=OUT/'cassette';O.mkdir(parents=True,exist_ok=True)
spec=json.loads(json.dumps(CONFIG['cassette']));meta=json.loads((OUT/'model.json').read_text())
native,source_hash=bound_native()
assert source_hash==meta['source_sha256'], 'Cassette export requires current native-bound geometry.'
check_space(O,projected_bytes=32*1024**2)
# No native file open/save is needed: world-space dimensions are recorded estimates,
# converted through the frozen, native-derived STOP owner matrices below.
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
collection=bpy.data.collections.new('TEMP cassette component');bpy.context.scene.collection.children.link(collection)
parts={p['id']:p for p in meta['parts'] if p['id'] in spec['owners']}
inactive_owners=sorted(set(spec['owners'])-set(parts))
transforms={}
for pid,p in parts.items():
    pos,q,scale=p['poses']['stop']; quat=Quaternion((q[3],q[0],q[1],q[2]));transforms[pid]=Matrix.LocRotScale(Vector(pos),quat,Vector(scale))
features=[]; M={m['semantic']:i for i,m in enumerate(spec['materials'])}

def mesh_object(name,vertices,faces):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);collection.objects.link(obj);return obj

def remove(obj):
    data=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
    if data.users==0:bpy.data.meshes.remove(data)

def apply(obj,mod):
    bpy.context.view_layer.update();result=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    obj.modifiers.remove(mod);old=obj.data;obj.data=result
    if old.users==0:bpy.data.meshes.remove(old)

def boolean(obj,cutter,operation='DIFFERENCE'):
    mod=obj.modifiers.new('Estimated molded detail','BOOLEAN');mod.operation=operation;mod.solver='EXACT';mod.object=cutter
    apply(obj,mod);remove(cutter)

def bevel(obj,width=.12,segments=3):
    mod=obj.modifiers.new('Manufactured edge highlight','BEVEL');mod.width=width;mod.segments=segments;mod.limit_method='ANGLE';mod.angle_limit=.35
    apply(obj,mod)

def rounded_loop(bounds,radius,segments=10):
    x0,y0,x1,y1=bounds;result=[]
    for cx,cy,start in [(x1-radius,y1-radius,0),(x0+radius,y1-radius,90),(x0+radius,y0+radius,180),(x1-radius,y0+radius,270)]:
        for j in range(segments+1):
            a=math.radians(start+j*90/segments);result.append((cx+radius*math.cos(a),cy+radius*math.sin(a)))
    return result

def prism(name,loop,z0,z1):
    n=len(loop);return mesh_object(name,[(x,y,z) for z in [z0,z1] for x,y in loop], [tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])

def box(name,b,z0,z1,r=0):
    x0,y0,x1,y1=b;loop=rounded_loop(b,r) if r else [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
    return prism(name,loop,z0,z1)

def circle(cx,cy,r,n=96):return [(cx+r*math.cos(math.tau*i/n),cy+r*math.sin(math.tau*i/n)) for i in range(n)]
def cylinder(name,cx,cy,r,z0,z1,n=64):return prism(name,circle(cx,cy,r,n),z0,z1)

def ring(name,cx,cy,ri,ro,z0,z1,n=96):
    obj=cylinder(name,cx,cy,ro,z0,z1,n);boolean(obj,cylinder('bore',cx,cy,ri,z0-1,z1+1,n));return obj

def add(obj,pid,material,kind,do_bevel=0,smooth=False):
    if do_bevel:bevel(obj,do_bevel)
    if smooth:
        for poly in obj.data.polygons:poly.use_smooth=abs(poly.normal.z)<.98
    obj['owner_id']=pid;obj['feature_kind']=kind
    features.append({'obj':obj,'pid':pid,'m':M[material],'kind':kind,'name':obj.name});return obj

shell=spec['shell'];x0,y0,x1,y1=shell['assembled_xy_bounds_mm'];z0,z1=shell['assembled_z_bounds_mm']
centers=[tuple(c) for c in spec['hub']['centers_assembled_mm']]
# A complete rounded outline replaces the demonstrator's huge missing lower edge.
# The front roof is thin enough to read as clear molded material; the apron is a
# distinct raised trapezoid within the same maximum envelope.
apron_loop=[(9.,-38.95),(9.,24.05),(24.,27.05),(24.,-41.95)]
edge_openings=spec['interfaces']['edge_openings_xy_mm']
bores=spec['interfaces']['through_bores']

def interface_cuts(obj,hub_radius=8.15,front_apron=False):
    for cx,cy,cz in centers:boolean(obj,cylinder('hub access',cx,cy,hub_radius,2,14))
    for b in bores:boolean(obj,cylinder(b['name'],*b['center_xy_mm'],b['radius_mm'],2,14))
    for b in edge_openings:boolean(obj,box('individual tape/head aperture',b,2,9.65,.3))
    if front_apron:
        # Three distinct front-face windows, separated by molded locating bridges.
        for b in spec['interfaces']['apron_face_windows_xy_mm']:boolean(obj,box('apron face window',b,9.0,14,.45))

rear=box('clear deck-facing half',shell['assembled_xy_bounds_mm'],3.55,4.0,2.1)
interface_cuts(rear);add(rear,spec['ownerRoles']['backShell'],'shell','rear_shell',.10)
wall=box('rounded molded perimeter',shell['assembled_xy_bounds_mm'],4.0,10.42,2.1)
boolean(wall,box('interior cavity',[-38.65,-56.5,22.85,41.6],3.7,11,1.2))
interface_cuts(wall);add(wall,spec['ownerRoles']['backShell'],'edge','perimeter_wall',.12)
roof=box('clear front face',shell['assembled_xy_bounds_mm'],10.32,10.78,2.1)
boolean(roof,prism('raised apron footprint',apron_loop,10,12))
interface_cuts(roof);add(roof,spec['ownerRoles']['frontShell'],'shell','front_shell',.12)
apron=prism('tapered raised head apron',apron_loop,10.32,11.95)
interface_cuts(apron,front_apron=True);add(apron,spec['ownerRoles']['frontShell'],'edge','head_apron',.18)
# Fine mid-plane seam is a separate shallow rim with reduced optical transmission.
seam=box('mold join seam',[-39.79,-57.64,23.99,42.74],7.52,7.67,2.1)
boolean(seam,box('seam hollow',[-39.52,-57.37,23.72,42.47],7.3,7.9,1.83));interface_cuts(seam)
add(seam,spec['ownerRoles']['backShell'],'seam','mold_seam',.035)
# Clear bearing collars surround the open reel holes (no glass filling the bores).
for cx,cy,cz in centers:
    for ri,ro,a,b in [(8.16,8.75,10.70,11.20),(8.74,9.15,10.52,10.85)]:
        add(ring('clear molded reel collar',cx,cy,ri,ro,a,b),spec['ownerRoles']['frontShell'],'edge','reel_access_collar',.09,True)
# Thin integral stiffening ribs are visible through the clear face.
for b in [[-36.0,-52.9,-34.95,37.9],[-33.8,-53.6,7.9,-52.75],[-33.8,37.85,7.9,38.7],[8.,-49.8,8.8,34.9]]:
    add(box('internal molded reinforcement rib',b,9.15,10.32,.2),spec['ownerRoles']['frontShell'],'edge','internal_rib',.10)
for y in [-50.8,35.9]:
    add(box('corner roller guide wall',[10.5,y-.3,15.2,y+.3],4.05,9.1,.18),spec['ownerRoles']['backShell'],'edge','internal_guide_rib',.09)
# Five real counterbored screw stations: four corners and the apron center.
for idx,(cx,cy) in enumerate(shell['screw_centers_xy_mm']):
    face=11.95 if idx==4 else 10.78
    target=apron if idx==4 else roof
    boolean(target,cylinder('screw counterbore',cx,cy,1.92,face-.7,face+1))
    boss=ring('molded screw boss',cx,cy,.85,2.5,4.02,face-.5)
    add(boss,spec['ownerRoles']['backShell'],'edge','screw_boss',.12,True)
    washer=ring('counterbore seat',cx,cy,1.37,1.9,face-.7,face-.36)
    add(washer,spec['ownerRoles']['frontShell'],'seam','screw_seat',.06,True)
    head=cylinder('recessed crossed metal screw '+str(idx+1),cx,cy,1.34,face-.67,face-.20)
    bevel(head,.11)
    for b in [[cx-1.0,cy-.19,cx+1.0,cy+.19],[cx-.19,cy-1.0,cx+.19,cy+1.0]]:boolean(head,box('crossed drive slot',b,face-.42,face+.1,.08))
    add(head,spec['ownerRoles']['frontShell'],'screw','screw_head',0,True)
# Neutral original graphics are applied by the viewer to thin label stock.
for name,b in [('label upper',[-34.6,-49.5,-28.9,34.6]),('label lower',[3.4,-49.1,9.0,34.2])]:
    label=box(name,b,10.81,10.88,.65)
    spec['materials'][M[name]]['uvBounds']=b
    spec['materials'][M[name]]['uvSpace']='assemblyXY'
    add(label,spec['ownerRoles']['frontShell'],name,name.replace(' ','_'),.025)
    back_name=name+' back'
    boolean(rear,box('recess for rear paper label',b,3.50,3.59,.65))
    back=box(back_name,b,3.55,3.59,.65)
    spec['materials'][M[back_name]]['uvBounds']=b
    spec['materials'][M[back_name]]['uvSpace']='assemblyXY'
    add(back,spec['ownerRoles']['backShell'],back_name,back_name.replace(' ','_'),.015)
# Narrow anti-friction slip rings remain visible behind the tape, avoiding a large
# opaque plate which would hide the internal winding structure.
for cx,cy,cz in centers:
    add(ring('lower translucent slip sheet',cx,cy,8.2,20.15,4.01,4.04,128),spec['ownerRoles']['backShell'],'slip','slip_sheet',0,False)
# Stepped six-tooth hubs: broad upper flange with 12 real scalloped relief pockets.
hub=spec['hub'];n=192
inner=[]
for i in range(n):
    degrees=360*i/n;d=abs((degrees+30)%60-30);t=max(0,min(1,(d-9)/4))
    inner.append(4.2+1.05*t)
for pid,(cx,cy,cz) in zip([spec['ownerRoles']['hubs'][0],spec['ownerRoles']['hubs'][1]],centers):
    core=cylinder('six-tooth hub barrel',cx,cy,7.95,3.65,8.55,96)
    tooth_loop=[(cx+inner[i]*math.cos(math.tau*i/n),cy+inner[i]*math.sin(math.tau*i/n)) for i in range(n)]
    boolean(core,prism('six tooth open bore',tooth_loop,3,10))
    # Reverse-side pockets are outside the spindle bore and remove material only.
    for i in range(12):
        a=math.tau*(i+.5)/12;r=6.7
        boolean(core,cylinder('rear hub radial relief',cx+r*math.cos(a),cy+r*math.sin(a),.75,3.5,3.94,32))
    add(core,pid,'hub','six_tooth_bore',.10,True)
    flange=ring('ivory stepped spool flange',cx,cy,5.3,10.55,8.03,8.67,144)
    for i in range(12):
        a=math.tau*(i+.5)/12;r=8.40
        pocket=cylinder('radial relief pocket',cx+r*math.cos(a),cy+r*math.sin(a),1.12,8.32,9.0,32)
        boolean(flange,pocket)
    add(flange,pid,'hub','scalloped_flange',.10,True)
    for ri,ro,a,b in [(5.26,6.25,8.52,9.05),(9.95,10.55,8.66,8.84)]:
        add(ring('ivory concentric rim',cx,cy,ri,ro,a,b,144),pid,'hub','hub_rim',.065,True)
    # Lower flange locates the tape but stays above the existing deck-facing floor.
    lower=ring('lower spool flange',cx,cy,5.3,10.3,4.04,4.18,128)
    for i in range(12):
        a=math.tau*(i+.5)/12;r=8.4
        boolean(lower,cylinder('rear flange scalloped relief',cx+r*math.cos(a),cy+r*math.sin(a),1.10,3.9,4.125,32))
    add(lower,pid,'hub','lower_flange',.025,True)
# Wound packs have modeled shallow concentric winding relief, not flat disks.
for pid,(cx,cy,cz) in zip([spec['ownerRoles']['packs'][0],spec['ownerRoles']['packs'][1]],centers):
    radial=spec['tape']['pack_radii_mm'];ro=radial[1];ri=radial[0];rings=32;segments=128
    profile=[(ri,4.2)]
    for j in range(1,rings+1):
        r=ri+(ro-ri)*j/rings
        profile.extend([(r-.075,4.2),(r-.035,4.235),(r,4.2)])
    profile.extend([(ro,7.84)])
    for j in range(rings):
        r=ro-(ro-ri)*j/rings
        profile.extend([(r,7.84),(max(ri,r-.035),7.875),(max(ri,r-.075),7.84)])
    profile.extend([(ri,7.84),(ri,4.2)]);vertices=[]
    for r,z in profile:vertices.extend([(cx+r*math.cos(math.tau*i/segments),cy+r*math.sin(math.tau*i/segments),z) for i in range(segments)])
    faces=[]
    for k in range(len(profile)-1):
        if profile[k]==profile[k+1]:continue
        for i in range(segments):j=(i+1)%segments;faces.append((k*segments+i,k*segments+j,(k+1)*segments+j,(k+1)*segments+i))
    # Weld profile closure/occasional duplicate radius so the winding remains closed.
    obj=mesh_object('concentric wound magnetic tape',vertices,faces)
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    add(obj,pid,'tape','wound_tape_pack',0,True)
# Two corner guide rollers, stepped clear/ivory, with a metal center axle.
rollers=spec['tape']['guide_rollers']
for c in rollers:
    cx,cy=c['center_xy_mm'];r=c['radius_mm']
    add(ring('corner tape guide roller',cx,cy,.8,r,4.08,8.05),spec['ownerRoles']['backShell'],'roller','guide_roller',.14,True)
    add(ring('guide roller face ring',cx,cy,1.25,r-.2,8.04,8.32),spec['ownerRoles']['backShell'],'hub','guide_roller_rim',.08,True)
    add(cylinder('guide roller axle',cx,cy,.70,4.02,8.40,48),spec['ownerRoles']['backShell'],'screw','guide_roller_axle',.10,True)
# Continuous thin tape ribbon: tangent runs and arcs wrap the two corner rollers.
# Its static route is an explicit visual proxy, not a flexible transport simulation.
left=Vector(rollers[0]['center_xy_mm']);right=Vector(rollers[1]['center_xy_mm']);radius=rollers[0]['radius_mm']
path=[]
# Tangent to supply pack and left guide, then clockwise around the lower-left guide.
for p in [(-4.8,-47.45),(12.5,-51.15)]:path.append(p)
for i in range(41):
    a=math.radians(-100+100*i/40);path.append((left.x+radius*math.cos(a),left.y+radius*math.sin(a)))
path.append((right.x+radius,right.y))
for i in range(1,41):
    a=math.radians(100*i/40);path.append((right.x+radius*math.cos(a),right.y+radius*math.sin(a)))
path.extend([(12.5,36.25),(-4.8,32.55)])
# Ribbon mesh is a closed extruded strip with nominal .035mm thickness.
verts=[];width=.035
for i,p in enumerate(path):
    before=Vector(path[max(0,i-1)]);after=Vector(path[min(len(path)-1,i+1)]);t=(after-before).normalized();nrm=Vector((-t.y,t.x))
    for z in [4.12,7.88]:
        for side in [-.5,.5]:verts.append((p[0]+side*width*nrm.x,p[1]+side*width*nrm.y,z))
faces=[]
for k in range(len(path)-1):
    a=4*k;b=a+4;faces.extend([(a,b,b+2,a+2),(a+1,a+3,b+3,b+1),(a,a+1,b+1,b),(a+2,b+2,b+3,a+3)])
faces.extend([(0,2,3,1),(len(verts)-4,len(verts)-3,len(verts)-1,len(verts)-2)])
add(mesh_object('continuous illustrated tape ribbon',verts,faces),spec['ownerRoles']['backShell'],'ribbon','tape_ribbon')
# The center pressure pad and bowed spring sit behind the exposed tape span.
add(box('felt pressure pad',[19.85,-10.20,20.9,-4.7],4.36,7.64,.18),spec['ownerRoles']['backShell'],'felt','pressure_pad',.1)
add(box('pressure pad spring',[19.4,-17.0,19.65,2.1],4.65,7.35,.08),spec['ownerRoles']['backShell'],'spring','pad_spring',.06)
for cy in [-16.7,1.8]:add(box('spring anchor',[18.4,cy-.6,20.05,cy+.6],4.05,8.15,.2),spec['ownerRoles']['backShell'],'edge','pad_spring_anchor',.10)

# Export grouped by owner/material but retain triangle ranges for every physical
# feature, allowing contact audit to distinguish shell, ribbon and pad surfaces.
def bounds(mesh,transform=None):
    points=[transform@v.co if transform else v.co for v in mesh.vertices]
    return [[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]
buffer=bytearray()
def append(values,fmt):
    while len(buffer)%4:buffer.append(0)
    offset=len(buffer);buffer.extend(struct.pack('<'+fmt*len(values),*values));return [offset,len(values)]
checks=[];exported=[];feature_checks=[];measured={}
for pid in spec['owners']:
    if pid not in transforms:continue
    inv=transforms[pid].inverted();selected=[f for f in features if f['pid']==pid];chunks=[];allpoints=[]
    for material in sorted({f['m'] for f in selected}):
        positions=[];normals=[];indices=[];ranges=[]
        for f in [f for f in selected if f['m']==material]:
            mesh=f['obj'].data;mesh.calc_loop_triangles();box_mm=bounds(mesh)
            assert all(box_mm[0][i]>=[x0,y0,z0][i]-.002 and box_mm[1][i]<=[x1,y1,z1][i]+.002 for i in range(3)),(f['name'],'external bound',box_mm)
            bm=bmesh.new();bm.from_mesh(mesh);bad=sum(not e.is_manifold for e in bm.edges);vol=abs(bm.calc_volume());bm.free()
            assert bad==0 and vol>0,(f['name'],'invalid solid',bad,vol)
            start=len(indices);lookup={}
            for tri in mesh.loop_triangles:
                for vi,li in zip(tri.vertices,tri.loops):
                    normal=inv.to_3x3()@mesh.corner_normals[li].vector;normal.normalize();key=(vi,*(round(c,6) for c in normal))
                    if key not in lookup:
                        lookup[key]=len(positions)//3;p=inv@mesh.vertices[vi].co;positions.extend(p);normals.extend(normal);allpoints.append(p)
                    indices.append(lookup[key])
            ranges.append({'name':f['name'],'kind':f['kind'],'indexStart':start,'indexCount':len(indices)-start})
            feature_checks.append({'owner':pid,'name':f['name'],'kind':f['kind'],'assembled_bounds_mm':box_mm,'triangles':len(mesh.loop_triangles),'nonmanifold_edges':bad,'volume_mm3':vol})
        assert all(math.isfinite(v) for v in positions+normals)
        chunks.append({'p':append(positions,'f'),'n':append(normals,'f'),'i':append(indices,'I'),'m':material,'indexType':'u32','features':ranges})
    local_bounds=[[min(p[i] for p in allpoints) for i in range(3)],[max(p[i] for p in allpoints) for i in range(3)]]
    checks.append({'part_id':pid,'alternative_local_bounds_mm':local_bounds,'feature_count':len(selected),'triangles':sum(f['triangles'] for f in feature_checks if f['owner']==pid)})
    whole=bmesh.new()
    for f in selected:whole.from_mesh(f['obj'].data)
    measured[pid]={'solids':len(selected),**measure_solid(whole,1.0,1e-3)};whole.free()   # the generated solids are already in assembled mm
    sx,sy,sz=measured[pid]['size_mm'];measured[pid]['size_mm']=[sx,sz,sy]                 # from the page's axes (Y up) to the model's (Z up)
    exported.append({'id':pid,'meshes':chunks,'alternate_id':spec['alternate_id'],'evidence_status':'DEMO_PROXY','ownership':'Existing owner transform retained. Integral molded features stay with their shell; separately manufactured screws, roller, ribbon and pad chunks are grouped under shell owners for this visual alternative only.'})
assert hashlib.sha256(native.read_bytes()).hexdigest()==source_hash
compressed=gzip.compress(buffer,compresslevel=6,mtime=0);assert len(compressed)<5*1024**2
# Material UV domains are generated from the exact component-local label bounds.
write_bytes_guarded(O/'parameters.json',(json.dumps(spec,indent=2)+'\n').encode())
write_bytes_guarded(O/'geometry.bin.gz',compressed)
manifest={'schema_version':2,'alternate_id':spec['alternate_id'],'label':spec['label'],'classification':spec['classification'],
'native':{'sha256':source_hash,'unchanged':True},'baseline_metadata_sha256':hashlib.sha256((OUT/'model.json').read_bytes()).hexdigest(),
'coordinate_space':'Existing component-local millimeters; apply the original owner poses/spins/service/explosion metadata unchanged.',
'packing':{'packed':False,'positions':'float32 little-endian','normals':'float32 little-endian','indices':'uint32 little-endian'},
'geometry':{'file':'geometry.bin.gz','uncompressed_bytes':len(buffer),'compressed_bytes':len(compressed),'sha256':hashlib.sha256(compressed).hexdigest()},
'parts':exported,'materials':spec['materials'],'parameters':{k:spec[k] for k in ['shell','hub','tape','interfaces','numeric_detail_status']},'parameter_sha256':hashlib.sha256((O/'parameters.json').read_bytes()).hexdigest(),'config_sha256':hashlib.sha256((R/'config/model.json').read_bytes()).hexdigest(),
'checks':{'passed':True,'component_ids_preserved':True,'native_unchanged':True,'external_envelope_mm':[100.4,63.8,8.4],'external_bounds_mm':[[x0,y0,z0],[x1,y1,z1]],'hub_teeth':6,'hub_pitch_mm':42.5,'six_owner_transforms_unchanged':not inactive_owners,'inactive_owner_bindings':inactive_owners,'all_feature_solids_manifold':True,'parts':checks,'features':feature_checks,'physical_fit_limit':'New occupied volume is deliberate. Independent cassette/player contact regression is required; visual topology and illustrative tape route do not establish physical accuracy.'},
'limitations':spec['scope_limits']}
write_json(O/'part-measurements.json',{'native_sha256':source_hash,'variant':spec['alternate_id'],'units':'mm','axes':'X across the front, Y front to back, Z along the body','parts':measured})
write_bytes_guarded(O/'manifest.json',(json.dumps(manifest,indent=2)+'\n').encode())
review=dict(manifest);review['recipe']={'script':'tools/export_cassette.py','blender_version':bpy.app.version_string,'native_open':False,'native_save':False}
write_bytes_guarded(O/'review.json',(json.dumps(review,indent=2)+'\n').encode())
print(json.dumps({'alternate_id':spec['alternate_id'],'parts':len(exported),'features':len(features),'triangles':sum(c['triangles'] for c in checks),'compressed_bytes':len(compressed),'native_unchanged':True,'checks_passed':True}))
