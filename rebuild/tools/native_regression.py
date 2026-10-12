"""Independent read-only native samples for portable regression checks."""
from pathlib import Path
import sys,math,json,bpy
from mathutils import Matrix
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_io import ROOT,OUT,CONFIG,bound_native,sha256,write_json
from part_schema import geometry_groups
native,digest=bound_native()
model=json.loads((OUT/'model.json').read_text())
if model['source_sha256']!=digest:raise RuntimeError('Regression sampler received stale geometry metadata')
bpy.ops.wm.open_mainfile(filepath=str(native),load_ui=False,use_scripts=False)
scene=bpy.context.scene
controllers={o.get('controller_id'):o for o in bpy.data.objects if o.get('controller_id')}
transport=controllers[CONFIG['controllers']['transport']]
operating=controllers[CONFIG['controllers']['operating']]
roots={o['part_id']:o for o in bpy.data.objects if o.get('part_id') in model['inventory']['ownerIds']}
assert len(roots)==len(model['parts'])
geometry=geometry_groups(roots)
C=Matrix(((1000,0,0,0),(0,0,1000,0),(0,-1000,0,0),(0,0,0,1)))
def evaluate(mode=0,frame=0,door=0,battery=0,stop=0,tone=.5,left=.5,right=.5,hotline=0):
 for key,value in {'Run Demo':0.,'Transport':mode,'Door':door,'Cassette':0.,'STOP EJECT':stop,'Eject stroke':stop,'Service view':0.,'Exploded view':0.}.items():
  if key in transport:transport[key]=value
 for key,value in {'tone_position':tone,'volume_left':left,'volume_right':right,'hotline_press':hotline,'battery_open_deg':battery,'battery_catch_release_mm':0.}.items():
  if key in operating:operating[key]=value
 transport.update_tag();operating.update_tag();scene.frame_set(-1);scene.frame_set(math.floor(frame),subframe=frame%1);bpy.context.view_layer.update()
def matrices(ids):return {id:[list(row) for row in C@roots[id].matrix_world] for id in ids if id in roots}
def weights():
 result={}
 for p in model['parts']:
  chunks=[m for m in p['meshes'] if m.get('deformation')]
  if not chunks:continue
  d=chunks[0]['deformation'];keys=geometry[roots[p['id']]][d['source_geometry_index']].data.shape_keys
  result[p['id']]=[keys.key_blocks[t['name']].value for t in d['targets']]
 return result
frame1={}
for mode,name in [(1,'play'),(2,'ff'),(3,'rew')]:
 evaluate(mode=mode,frame=1);frame1[name]=matrices(roots)
doors=[]
for step in range(191):
 progress=step/190
 evaluate(door=progress)
 doors.append({'progress':progress,'matrices':matrices(CONFIG['roles']['door'])})
battery=[]
max_deg=operating.id_properties_ui('battery_open_deg').as_dict()['max']*CONFIG['viewer']['batteryOpenFraction']
for progress in [0,.01,.05,.1,.15,.2,.25,.3,.4,.5,.6,.7,.75,.8,.9,.95,1,.8,.5,.2,0]:
 evaluate(battery=max_deg*progress)
 battery.append({'progress':progress,'degrees':max_deg*progress,'matrices':matrices(CONFIG['roles']['batteryDoor'])})
deformations=[]
for mode,name in enumerate(['stop','play','ff','rew']):
 for tone in sorted(set(CONFIG['sampling']['toneRequired']+[.0075,.013,.014,.02,.035,.042,.043,.957,.958,.965,.98,.986,.987,.9925])):
  evaluate(mode=mode,tone=tone)
  deformations.append({'mode':name,'tone':tone,'weights':weights()})
for value in CONFIG['sampling']['ordinary']:
 evaluate(stop=value)
 deformations.append({'mode':'stop','tone':.5,'stop':value,'weights':weights()})
 evaluate()
 operating['battery_catch_release_mm']=value*operating.id_properties_ui('battery_catch_release_mm').as_dict()['max'];operating.update_tag();scene.frame_set(1);scene.frame_set(0);bpy.context.view_layer.update()
 deformations.append({'mode':'stop','tone':.5,'batteryRelease':value,'weights':weights()})
evaluate()
assert sha256(native)==digest,'Regression sampling must not modify the model'
write_json(OUT/'native-checks.json',{'schema_version':1,'native_sha256':digest,'model_sha256':sha256(OUT/'model.json'),'sampler_sha256':sha256(Path(__file__)),'fps':scene.render.fps/scene.render.fps_base,'frame1':frame1,'doors':doors,'battery':battery,'deformations':deformations,'native_unchanged':True,'scope':'Fresh independent evaluations under factory startup and auto-run disabled. No native save, collision-free or factory-function claim.'})
print('NATIVE REGRESSION SAMPLES',len(frame1)*len(roots),len(doors),len(battery),len(deformations),flush=True)
