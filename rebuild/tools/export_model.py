"""Read-only export of current master geometry and controller poses for offline presentation."""
import bpy,json,hashlib,gzip,base64,math,struct,time,sys
import numpy as np
from mathutils import Matrix,Vector,Quaternion
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_io import KIT, ROOT as R, OUT as O, CONFIG, check_space,write_bytes_guarded,write_json,sha256,bound_native,prepare_exterior,exterior_tags,shown_by_default
from part_schema import audit,collect_owners,geometry_groups
from belt_geometry import recover_belt, wrap_samples, seam_distance
native,digest=bound_native()
check_space(O,projected_bytes=0)
bpy.ops.wm.open_mainfile(filepath=str(native),load_ui=False,use_scripts=False);s=bpy.context.scene
inventory=audit(R/'config/part-ids.json')
serial={'value':str(s.get('release_serial_number','')),'fictional':bool(s.get('release_serial_is_fictional',False)),'part_id':str(s.get('release_serial_part_id',''))}
if serial != {'value':'12345','fictional':True,'part_id':'BAT-001'}:raise ValueError('Missing or modified fictional serial metadata. Restore the release serial properties on the scene.')
inventory['native_sha256']=digest
active_ids={row['part_id'] for row in inventory['owners']};issued_ids=set(inventory['registry_ids'])
inactive=[]
def inspect_bindings(value,path='config'):
 if isinstance(value,dict):
  for key,item in value.items():
   if key in issued_ids and key not in active_ids:inactive.append({'path':path+'.'+key,'part_id':key})
   inspect_bindings(item,path+'.'+key)
 elif isinstance(value,list):
  for index,item in enumerate(value):inspect_bindings(item,path+'['+str(index)+']')
 elif isinstance(value,str) and value in issued_ids and value not in active_ids:inactive.append({'path':path,'part_id':value})
inspect_bindings(CONFIG)
inventory['inactive_binding_references']=inactive
write_json(O/'inventory.json',inventory)
controllers={o.get('controller_id'):o for o in bpy.data.objects if o.get('controller_id')}
for label,cid in CONFIG['controllers'].items():
 if cid not in controllers:raise ValueError(f'Missing required controller {cid} ({label}). Restore its controller_id on the native controller before rebuilding.')
c=controllers[CONFIG['controllers']['transport']]
operation=controllers[CONFIG['controllers']['operating']]
# Try the exterior dropdown at every choice, then show all of its lettering so every piece is exported.
exterior=prepare_exterior(bpy,c,check=True)
rows=[{'id':r['part_id'],'object':r['object'],'status':r['status'],**r['presentation']} for r in inventory['owners']]
canonical=collect_owners();roots={canonical[r['id']]:r for r in rows}
inventory_binding={'sha256':sha256(O/'inventory.json'),'ownerIds':sorted(r['id'] for r in rows),'physicalIds':sorted(r['id'] for r in rows if not r['is_cassette']),'presentationOnlyIds':sorted(r['id'] for r in rows if r['is_cassette'])}
C=Matrix(((1000,0,0,0),(0,0,1000,0),(0,-1000,0,0),(0,0,0,1)))

def setpose(mode=0,door=0,media=0,eject=0,frame=0):
 for k,v in {'Run Demo':0.,'Transport':mode,'Door':float(door),'Cassette':float(media),'STOP EJECT':float(eject),'Service view':0.,'Exploded view':0.}.items():c[k]=v
 if 'Eject stroke' in c:c['Eject stroke']=float(eject)
 c.update_tag();s.frame_set(math.floor(frame),subframe=frame%1);bpy.context.view_layer.update()
def trs(m):
 p,q,z=m.decompose();return [list(p),[q.x,q.y,q.z,q.w],list(z)]
operation=controllers[CONFIG['controllers']['operating']]
frozen_controls={'tone_position':.5,'volume_left':.5,'volume_right':.5}
for key,value in frozen_controls.items():operation[key]=value
operation.update_tag();setpose()
assert all(abs(operation[key]-value)<1e-9 for key,value in frozen_controls.items())
belt_paths={r['id']:recover_belt(o,C@o.matrix_world,CONFIG['belts'][r['id']]['sectionVertices']) for o,r in roots.items() if r['id'] in CONFIG['belts']}

witness_points={}
groups=geometry_groups(canonical);unowned=[];cue_substitutions=inventory['native_cues']
buf=bytearray();materials=[];matids={};late_materials=[];parts=[];deformation_sources=[];legacy_shape_sources=[];dg=bpy.context.evaluated_depsgraph_get();totaltri=0
# Binary buffers reduce file size and JS parse overhead. Float32 geometry, Uint32 indices.
def append(a,dtype):
 while len(buf)%4:buf.append(0)
 a=np.asarray(a,dtype=dtype);start=len(buf);buf.extend(a.tobytes());return [start,len(a)]
def material(mat):
 name=mat.name if mat else 'default'
 if name in matids:return matids[name]
 color=list(mat.diffuse_color) if mat else [.5,.5,.5,1];metal=mat.metallic if mat else 0;rough=mat.roughness if mat else .45
 if mat and mat.use_nodes:
  bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if bs:
   color=list(bs.inputs['Base Color'].default_value);metal=bs.inputs['Metallic'].default_value;rough=bs.inputs['Roughness'].default_value
 if name in CONFIG['materials']['belt']:
  color=[.006,.007,.009,1.];rough=.88;metal=0.
 alpha=color[3]
 # The window uses transmission in Blender; a thin transparent browser material keeps the cassette visible.
 if name in CONFIG['materials']['transparent']:alpha=min(alpha,.24)
 idx=len(materials);matids[name]=idx;materials.append({'name':name,'color':color[:3],'metalness':metal,'roughness':max(.2,rough),'alpha':alpha})
 if name==CONFIG['materials']['indicator']['material']:
  assert bs and bs.inputs['Emission Color'].default_value[0]>.9
  materials[-1]['operationIndicator']={'owner':CONFIG['materials']['indicator']['owner'],'color':list(bs.inputs['Emission Color'].default_value)[:3],'strength':CONFIG['materials']['indicator']['strength'],'modes':['play','ff','rew'],'basis':'Native D901 red emission; illustrative powered transport state, not an electrical simulation.'}
 return idx
# Whole meshes at a time, with the results mathutils gives one value at a time (single precision throughout):
# Matrix @ Vector multiplies in single precision and adds the products in double, left to right;
# Vector.normalized() squares and adds in double, from the last component to the first, takes the root as a single
# and multiplies by its single-precision reciprocal.
def transformed(matrix,points):
 m=np.array(matrix,dtype=np.float32);total=np.zeros((len(points),3),dtype=np.float64)
 for column in range(3):total+=m[:3,column][None,:]*points[:,column][:,None]
 if m.shape[1]==4:total+=m[:3,3][None,:]
 return total.astype(np.float32)
def normalized(vectors):
 squares=vectors.astype(np.float64)**2;d=squares[:,2]+squares[:,1];d=d+squares[:,0]
 with np.errstate(divide='ignore',invalid='ignore'):out=vectors*(np.float32(1)/np.sqrt(d).astype(np.float32))[:,None]
 out[d<=1.0e-35]=0;return out
def welded(vertex_ids,normals):
 """Corners that share a vertex and a normal (to 5 decimals) become one point. Returns the corners that are kept,
 in the order they first appear, and each corner's point number."""
 q=np.rint(normals.astype(np.float64)*1e5).astype(np.int64)+100000;key=(q[:,0]<<36)|(q[:,1]<<18)|q[:,2]
 order=np.lexsort((key,vertex_ids));sv,sk=vertex_ids[order],key[order]
 new=np.ones(len(order),dtype=bool);new[1:]=(sv[1:]!=sv[:-1])|(sk[1:]!=sk[:-1])
 first=order[new];rank=np.empty(len(first),dtype=np.int64);rank[np.argsort(first,kind='stable')]=np.arange(len(first))
 index=np.empty(len(order),dtype=np.int64);index[order]=rank[np.cumsum(new)-1]
 return np.sort(first),index
def array_pieces(me,vs,nn):
 """One piece per material, in the order the materials first appear among the triangles."""
 count=len(me.loop_triangles);tv=np.empty(count*3,np.int32);tl=np.empty(count*3,np.int32);tm=np.empty(count,np.int32)
 me.loop_triangles.foreach_get('vertices',tv);me.loop_triangles.foreach_get('loops',tl);me.loop_triangles.foreach_get('material_index',tm)
 tv=tv.reshape(-1,3);tl=tl.reshape(-1,3);used,at=np.unique(tm,return_index=True)
 for mi in used[np.argsort(at)]:
  rows=tm==mi;vid=tv[rows].ravel();loop=tl[rows].ravel();keep,index=welded(vid,nn[loop]);source=vid[keep]
  yield int(mi),vs[source].ravel(),nn[loop[keep]].ravel(),index,source.tolist(),None,int(rows.sum())
def belt_pieces(me,vs,ns,belt_path):
 """The same for a belt, one corner at a time: each point also carries its distance along the belt."""
 bymat={}
 for tri in me.loop_triangles:bymat.setdefault(tri.material_index,[]).append(tri)
 for mi,triangles in bymat.items():
  verts=[];norms=[];inds=[];lookup={};source_vertices=[];belt_distances=[]
  for tri in triangles:
   for vid,loop in zip(tri.vertices,tri.loops):
    n=ns[loop].normalized();distance=seam_distance(belt_path,vid,tri.vertices);key=(vid,round(n.x,5),round(n.y,5),round(n.z,5),distance)
    if key not in lookup:lookup[key]=len(verts)//3;verts.extend(vs[vid]);norms.extend(n);source_vertices.append(vid);belt_distances.append(distance)
    inds.append(lookup[key])
  yield mi,verts,norms,inds,source_vertices,belt_distances,len(triangles)
for i,(root,r) in enumerate(roots.items()):
 inv=root.matrix_world.inverted();chunks=[];belt_path=belt_paths.get(r['id'])
 for geometry_index,ob in enumerate(groups[root]):
  ev=ob.evaluated_get(dg);me=ev.to_mesh();me.calc_loop_triangles()
  if not me.loop_triangles:ev.to_mesh_clear();continue
  transform=inv@ob.matrix_world;normal=transform.to_3x3().inverted().transposed()
  if belt_path:
   assert ob==root and len(me.vertices)==len(ob.data.vertices),'Belt evaluation changed vertex correspondence'
   vs=[transform@v.co for v in me.vertices];pieces=belt_pieces(me,vs,[normal@n.vector for n in me.corner_normals],belt_path)
  else:
   co=np.empty(len(me.vertices)*3,np.float32);me.vertices.foreach_get('co',co);cn=np.empty(len(me.corner_normals)*3,np.float32);me.corner_normals.foreach_get('vector',cn)
   vs=transformed(transform,co.reshape(-1,3));pieces=array_pieces(me,vs,normalized(transformed(normal,cn.reshape(-1,3))))
  if r['id'] in CONFIG['roles']['motorWitness']:witness_points.setdefault(r['id'],[]).extend(tuple(v) for v in (vs if belt_path else vs.tolist()))
  shape_keys=ob.data.shape_keys if ob.type=='MESH' else None
  deform=None
  if shape_keys and len(shape_keys.key_blocks)>1 and r['id'] not in CONFIG['deformation']['animated']:
   # These pre-existing inspection-only channels were static in the previous
   # viewer. Keep that explicit policy, and prove exported transport poses do
   # not change them. Their separate native inspection controls remain usable.
   assert r['id'] in CONFIG['deformation']['inspectionOnly'],('Unspecified deforming owner',r['id'])
   legacy_shape_sources.append(({'owner':r['id'],'source_object':ob.name,'targets':[{'name':key.name,'initial':key.value,'weights':{}} for key in list(shape_keys.key_blocks)[1:]],'policy':'Static evaluated native shape; legacy inspection-only deformation is not animated in the local viewer.'},shape_keys))
  if shape_keys and len(shape_keys.key_blocks)>1 and r['id'] in CONFIG['deformation']['animated']:
   assert all(mod.type=='WEIGHTED_NORMAL' for mod in ob.modifiers) and len(me.vertices)==len(ob.data.vertices),('Deformation topology needs explicit transfer',ob.name,[(m.name,m.type) for m in ob.modifiers])
   basis=shape_keys.key_blocks[0]
   deform={'owner':r['id'],'source_object':ob.name,'targets':[{'name':key.name,'initial':key.value,'delta':[list(transform.to_3x3()@(key.data[i].co-basis.data[i].co)) for i in range(len(me.vertices))],'weights':{}} for key in list(shape_keys.key_blocks)[1:]]}
  for mi,verts,norms,inds,source_vertices,belt_distances,triangle_count in pieces:
   slot_material=ob.material_slots[mi].material if mi<len(ob.material_slots) else None
   chunk={'p':append(verts,'<f4'),'n':append(norms,'<f4'),'i':append(inds,'<u4'),'m':material(slot_material) if shown_by_default(ob,exterior) else None}
   # Lettering that only some exterior versions show says which, and takes its material number after all the others.
   if exterior_tags(ob):chunk['versions']=exterior_tags(ob);chunk['piece']=ob.name
   if chunk['m'] is None:late_materials.append((chunk,slot_material))
   if ob.get('eject_articulation'):
    chunk['articulation']=json.loads(ob['eject_articulation'])|{'source_object':ob.name,'source_vertices':source_vertices}
   if belt_path:chunk['beltS']=append(belt_distances,'<f4')
   if deform:
    chunk['deformation']={'owner':deform['owner'],'source_geometry_index':geometry_index,'source_object':ob.name,'source_vertices':source_vertices,'targets':[{'name':t['name'],'initial':t['initial'],'positions':[component for vid in source_vertices for component in t['delta'][vid]],'weights':t['weights']} for t in deform['targets']]}
    deformation_sources.append((chunk['deformation'],shape_keys))
   chunks.append(chunk);totaltri+=triangle_count
  ev.to_mesh_clear()
 parts.append({'id':r['id'],'name':r['display_name'],'native_object_name':root.name,'status':r['status'],**{k:r[k] for k in ['rest_when_separated','service','direction','distance','order','fan','group','package','category','assembly','is_cassette']},'meshes':chunks,'poses':{},'spin':{}})
 if root.get('eject_contact'):parts[-1]['ejectContact']=json.loads(root['eject_contact'])
 if i%100==0:print('GEOMETRY',i,'triangles',totaltri,flush=True)
for chunk,slot_material in late_materials:chunk['m']=material(slot_material)
byid={r['id']:o for o,r in roots.items()}
def rotation_vector(delta):
 q=delta.to_quaternion().normalized()
 if q.w<0:q.negate()
 v=Vector((q.x,q.y,q.z));length=v.length
 return v*(2*math.atan2(length,q.w)/length) if length>1e-14 else Vector((0,0,0))
spin_sampling=[];fps=s.render.fps/s.render.fps_base
pose_cases=[('stop',0,0,0,0),('play',1,0,0,0),('ff',2,0,0,0),('rew',3,0,0,0),('open',0,1,0,0),('eject',0,1,0,1),('removed',0,1,1,0)]
for label,mode_value in [('stop',0),('play',1),('ff',2),('rew',3)]:
 if mode_value:pose_cases.append((label+'_open',mode_value,1,0,0))
 pose_cases.extend([(label+'_removed_open',mode_value,1,1,0),(label+'_removed_closed',mode_value,0,1,0),(label+'_ejected',mode_value,1,0,0)])
for name,mode,door,media,eject in pose_cases:
 setpose(mode,door,media,eject,0);m0={p['id']:C@byid[p['id']].matrix_world for p in parts}
 for p in parts:p['poses'][name]=p['poses']['eject'] if name.endswith('_ejected') and p['is_cassette'] else trs(m0[p['id']])
 for deformation,keys in deformation_sources+legacy_shape_sources:
  for target in deformation['targets']:target['weights'][name]=keys.key_blocks[target['name']].value
 for deformation,keys in legacy_shape_sources:
  assert all(abs(t['weights'][name]-t['initial'])<1e-8 for t in deformation['targets']),('Legacy deformation changed in exported transport',deformation['owner'],name)
 if name in {'play','ff','rew'}:
  # Frame 0→1 aliases rotations exceeding pi (PRX-001 nearly makes one
  # complete turn). Bound native raw Euler increments before matrix sampling.
  euler0={o:tuple(o.rotation_euler) for o in bpy.data.objects if o.animation_data};step=.125
  while True:
   setpose(mode,door,media,eject,step)
   raw_max=max(abs(o.rotation_euler[i]-v[i]) for o,v in euler0.items() for i in range(3))
   if raw_max<.35:break
   step/=2;assert step>=1/1024,'Unexpected spin velocity: review native sampling bounds'
  full={p['id']:C@byid[p['id']].matrix_world for p in parts}
  setpose(mode,door,media,eject,step/2)
  half={p['id']:C@byid[p['id']].matrix_world for p in parts};rate_error=0.
  # Refine low-rate precision over a longer native interval, using the bounded
  # fractional estimate to unwrap complete turns without ambiguity.
  refinement_frames=31.625;setpose(mode,door,media,eject,refinement_frames)
  long={p['id']:C@byid[p['id']].matrix_world for p in parts}
  for p in parts:
   inverse=m0[p['id']].inverted();delta=inverse@full[p['id']];vector=rotation_vector(delta);angle=vector.length
   if abs(angle)>1e-5:
    axis=vector/angle;half_vector=rotation_vector(inverse@half[p['id']]);difference=(vector-2*half_vector).length*fps/step;rate_error=max(rate_error,difference);assert difference<.001,(p['id'],'spin sample did not converge')
    wrapped=rotation_vector(inverse@long[p['id']]).dot(axis);estimate=angle*refinement_frames/step;unwrapped=wrapped+round((estimate-wrapped)/math.tau)*math.tau;rate=unwrapped*fps/refinement_frames;assert abs(rate-angle*fps/step)<.001,(p['id'],'long spin interval disagrees')
    a=np.eye(3)-np.array(delta.to_3x3());center=np.linalg.lstsq(a,np.array(delta.translation),rcond=None)[0];assert np.linalg.norm(a@center-np.array(delta.translation))<.002,(p['id'],'not rigid spin')
    p['spin'][name]={'axis':list(axis),'rate':rate,'center':center.tolist()}
  spin_sampling.append({'mode':name,'step_frames':step,'refinement_frames':refinement_frames,'maximum_raw_euler_increment_rad':raw_max,'maximum_halving_rate_difference_rad_s':rate_error})
# Export the existing battery hinge and catch, including its compliant spring.
for label,angle,release in [('battery_release',0.,operation.id_properties_ui('battery_catch_release_mm').as_dict()['max']),('battery_open',operation.id_properties_ui('battery_open_deg').as_dict()['max']*CONFIG['viewer']['batteryOpenFraction'],operation.id_properties_ui('battery_catch_release_mm').as_dict()['max'])]:
 setpose();operation['battery_open_deg']=angle;operation['battery_catch_release_mm']=release;operation.update_tag();s.frame_set(1);s.frame_set(0);bpy.context.view_layer.update()
 for p in parts:p['poses'][label]=trs(C@byid[p['id']].matrix_world)
 for deformation,keys in deformation_sources:
  for target in deformation['targets']:target['weights'][label]=keys.key_blocks[target['name']].value
operation['battery_open_deg']=0.;operation['battery_catch_release_mm']=0.;operation.update_tag();setpose()
# Capture the contact spring's native control values, including its untouched
# midpoint. Runtime uses these typed channels; never executes driver strings.
# Automatic shut-off: the lever at the cam's push, the teeth meshed after a reel stalls, and the tripped state, all in PLAY.
if 'Shut off' in c:
 for label,stage in [('shutoff_out',1),('shutoff_meshed',2),('shutoff_tripped',3)]:
  setpose(1);c['Shut off']=stage;c.update_tag();s.frame_set(1);s.frame_set(0);bpy.context.view_layer.update()
  for p in parts:p['poses'][label]=trs(C@byid[p['id']].matrix_world)
  for deformation,keys in deformation_sources:
   for target in deformation['targets']:target['weights'][label]=keys.key_blocks[target['name']].value
 c['Shut off']=0
# How a part gets from one position to another. A part that rides a swinging arm has to follow the arm's arc, and one that also turns on
# the arm has to turn as it goes; a straight blend between two positions does neither. So for each part the moving members of the rig above
# it are recorded, outermost first: where each stands at STOP, and how far it is turned and shifted in every position. The viewer blends
# those amounts and builds the position from them. A part gets this only if it reproduces every position recorded for it.
movers=[o for o in bpy.data.objects if o.name.startswith('MOVE • ')]
def rig_now():
 dg=bpy.context.evaluated_depsgraph_get();return {o.name:(o.evaluated_get(dg).location.copy(),o.evaluated_get(dg).rotation_euler[2],o.evaluated_get(dg).matrix_world.copy()) for o in movers}
def members(obj):
 chain=[];o=obj
 while o is not None:
  target=next((k.target for k in o.constraints if k.type=='COPY_TRANSFORMS' and k.target),None)
  if o.name.startswith('MOVE • '):chain.append(o)
  o=target if target is not None else o.parent
 return chain[::-1]
if movers:
 rig_at={};cases={name:(mode,door,media,eject,0) for name,mode,door,media,eject in pose_cases}
 for name in parts[0]['poses']:
  if name in cases:setpose(*cases[name][:4],0)
  elif name.startswith('shutoff_'):setpose(1);c['Shut off']={'shutoff_out':1,'shutoff_meshed':2,'shutoff_tripped':3}[name];c.update_tag();s.frame_set(1);s.frame_set(0);bpy.context.view_layer.update()
  else:setpose()
  rig_at[name]=rig_now()
  if 'Shut off' in c:c['Shut off']=0
 setpose();Cr=C.to_3x3()*(1/1000);linked=0
 for p in parts:
  chain=members(byid[p['id']])
  if not chain:continue
  links=[]
  for o in chain:
   loc0,rot0,world0=rig_at['stop'][o.name];frame=(o.parent.matrix_world.to_3x3() if o.parent else Matrix.Identity(3))
   links.append({'pivot':list(C@world0.translation),'axis':list((Cr@(world0.to_3x3()@Vector((0,0,1)))).normalized()),
                 'poses':{name:[rig_at[name][o.name][1]-rot0,*(C.to_3x3()@(frame@(rig_at[name][o.name][0]-loc0)))] for name in rig_at}})
  if all(abs(v)<1e-9 for l in links for values in l['poses'].values() for v in values):continue
  stop=Matrix.LocRotScale(Vector(p['poses']['stop'][0]),Quaternion((p['poses']['stop'][1][3],*p['poses']['stop'][1][:3])),Vector(p['poses']['stop'][2]));good=True
  for name,pose in p['poses'].items():
   m=Matrix.Identity(4)
   for l in links:
    a,*t=l['poses'][name];pivot=Vector(l['pivot']);m=m@Matrix.Translation(Vector(t))@Matrix.Translation(pivot)@Matrix.Rotation(a,4,Vector(l['axis']))@Matrix.Translation(-pivot)
   want=Matrix.LocRotScale(Vector(pose[0]),Quaternion((pose[1][3],*pose[1][:3])),Vector(pose[2]));got=m@stop
   if max(abs(got[i][j]-want[i][j]) for i in range(3) for j in range(4))>2e-3:good=False;break
  if good:p['links']=links;linked+=1
 print('LINKS',linked,'parts follow the rig between positions',flush=True)
setpose();operation=controllers[CONFIG['controllers']['operating']]
if operation:
 original=operation['tone_position']
 for value,label in [(0.,'tone_low'),(.5,'tone_mid'),(1.,'tone_high')]:
  operation['tone_position']=value;operation.update_tag();s.frame_set(1);s.frame_set(0);bpy.context.view_layer.update()
  for deformation,keys in deformation_sources:
   if deformation['owner']==CONFIG['deformation']['channels']['tone']:
    for target in deformation['targets']:target['weights'][label]=keys.key_blocks[target['name']].value
 operation['tone_position']=original;operation.update_tag();setpose()
# Bind motion to each driving owner's exported reference angle. Positive belt
# distance follows the validated current-mesh ring order, including all twists.
part_by_id={p['id']:p for p in parts}
for pid,path in belt_paths.items():
 p=part_by_id[pid];contacts=[]
 if any(d['owner'] not in part_by_id for d in CONFIG['belts'][pid]['drivers']):continue # Removed driver: keep the belt geometry, omit its now-inactive cue.
 for wrap in wrap_samples(pid,path,CONFIG['belts'][pid]['drivers'],part_by_id):
  wheel=part_by_id[wrap['owner']];world=(C@byid[wrap['owner']].matrix_world).to_3x3()
  rates={mode:spin['rate']*(world@Vector(spin['axis'])).normalized()[wrap['axis_index']] for mode,spin in wheel['spin'].items()}
  contacts.append({k:v for k,v in wrap.items() if k!='sample_coefficients'}|{'signed_speed_mm_s':{mode:rate*wrap['signed_mm_per_radian_positive_axis'] for mode,rate in rates.items()}})
 driver=contacts[0];wheel=part_by_id[driver['owner']];ref=next(iter(wheel['spin'].values()))
 world_axis=((C@byid[driver['owner']].matrix_world).to_3x3()@Vector(ref['axis'])).normalized()
 p['belt']={'loopLengthMm':path['loop_length_mm'],'orientation':'increasing native cross-section ring order','rings':path['rings'],'sectionVertices':path['section_vertices'],'closingStepMm':path['closing_step_mm'],'sourceMeshSha256':path['mesh_coordinates_sha256'],'driverId':driver['owner'],'mmPerDriverRadian':driver['signed_mm_per_radian_positive_axis']*world_axis[driver['axis_index']],'stripeWidthMm':CONFIG['viewer']['beltStripeWidthMm'],'cueLabel':'Illustrative motion cues','contacts':contacts,'seamPolicy':'Export-only duplicated ring-zero vertices on closing triangles; same positions, normals and triangles.'}
 p['belt']['modeledMismatchMmS']={mode:max(c['signed_speed_mm_s'].get(mode,0) for c in contacts)-min(c['signed_speed_mm_s'].get(mode,0) for c in contacts) for mode in ['play','ff','rew']}
for pid,points in witness_points.items():
 p=part_by_id[pid];spin=p['spin']['play'];axis=Vector(spin['axis']).normalized()
 # The exposed drive end is toward negative housing Y, away from the motor.
 if axis.y>0:axis.negate()
 center=Vector(spin['center']);values=np.array(points)-np.array(center);along=values@np.array(axis)
 radial=values-along[:,None]*np.array(axis)
 radius=float(np.linalg.norm(radial,axis=1).max())
 p['motorWitness']={'kind':CONFIG['roles']['motorWitness'][pid],'axis':list(axis),'center':list(center),'endProjection':float(max(along)),'radiusMm':radius,'cueLabel':'Illustrative motion cues','basis':'Static owner-local material mask; rotates only with the native-derived owner transform.'}
 if CONFIG['roles']['motorWitness'][pid]=='pulley':p['motorWitness']['backProjection']=float(min(along))
from motion_samples import sample_controls
motion=sample_controls(s,controllers,roots,parts,C,deformation_sources,CONFIG,setpose,trs)
write_json(O/'motion.json',motion)
meta_motion=motion['controls']
print('POSES DONE',flush=True)
assert sorted(p['id'] for p in parts)==inventory_binding['ownerIds'], 'Export owner coverage differs from current inventory'
meta={'fictional_serial':serial,'source_sha256':digest,'exterior':{'versions':exterior['versions'],'default':exterior['default']},'inactiveBindings':inactive,'nativeCueSubstitutions':cue_substitutions,'source':native.relative_to(KIT).as_posix(),'inventory':inventory_binding,'units':'millimeters','controls':meta_motion,'parts':parts,'materials':materials,'triangles':totaltri,'geometry_bytes':len(buf),'config':CONFIG['title'],'spin_sampling':spin_sampling,'frozen_controls':frozen_controls,'deformation_owners':sorted(set(d['owner'] for d,k in deformation_sources)),'legacy_static_shape_channels':[d for d,k in legacy_shape_sources]}
meta_bytes=json.dumps(meta,separators=(',',':')).encode();geometry_bytes=gzip.compress(buf,compresslevel=6,mtime=0)
check_space(O,projected_bytes=len(meta_bytes)+len(geometry_bytes)+1024**2)
write_bytes_guarded(O/'model.json',meta_bytes);write_bytes_guarded(O/'model.bin.gz',geometry_bytes);assert hashlib.sha256(native.read_bytes()).hexdigest()==digest
write_bytes_guarded(O/'export-report.json',json.dumps({'master_unchanged':True,'sha256':digest,'parts':len(parts),'visible_geometry':sum(map(len,groups.values())),'unowned':unowned,'triangles':totaltri,'raw_bytes':len(buf),'compressed_bytes':(O/'model.bin.gz').stat().st_size,'spin_counts':{k:sum(k in p['spin'] for p in parts) for k in ['play','ff','rew']}},indent=2).encode());print('EXPORT PASS',len(parts),totaltri,len(buf),flush=True)
