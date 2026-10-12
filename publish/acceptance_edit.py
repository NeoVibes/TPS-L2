"""Deliberate acceptance edits; refuse any kit without the disposable-copy marker.
Run with Blender factory startup/auto-run disabled, --python this file -- STEP.
Only this explicit editing command saves the copied model and/or registry.
"""
import bpy,sys,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'rebuild'/'tools'))   # ROOT is the kit folder
from authoring import assign_part,attach_geometry,mark_helper
from part_schema import collect_owners
marker=ROOT/'DISPOSABLE-COPY.json'
if not marker.is_file():raise RuntimeError('Refusing to edit the baseline. First run publish/acceptance-copy.mjs into a fresh external folder.')
record=json.loads(marker.read_text())
if record.get('disposable') is not True:raise RuntimeError('Not a disposable acceptance copy.')
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if len(args)!=1:raise RuntimeError('Choose B, C1-missing, C1-create, C1-attach, C1-rename, C1-remove, C2-duplicate, C2-roles, or D.')
step=args[0]
if step in record['applied']:raise RuntimeError('This step was already applied; use a fresh copy instead of accumulating an edit twice.')
config=json.loads((ROOT/'rebuild/config/model.json').read_text());native=(ROOT/'rebuild'/config['native']).resolve();before=hashlib.sha256(native.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(native),load_ui=False,use_scripts=False)
bpy.context.preferences.filepaths.save_version=0
ignored=record.get('new_object') if step=='C1-create' else record.get('duplicate_object') if step=='C2-roles' else None
owners=collect_owners([o for o in bpy.data.objects if o.name!=ignored]);registry=ROOT/'rebuild/config/part-ids.json';changes=[]
def require(previous):
 if previous not in record['applied']:raise RuntimeError('Run '+previous+' first in this scenario copy.')
def cube(name,location,size):
 bpy.ops.mesh.primitive_cube_add(size=size,location=location);obj=bpy.context.object;obj.name=name;return obj
def controller(identity):return next(o for o in bpy.data.objects if o.get('controller_id')==identity)
def replace_driver(identity,path,index,factor):
 obj=controller(identity);curve=next(f for f in obj.animation_data.drivers if f.data_path==path and f.array_index==index);old=curve.driver.expression;curve.driver.expression='('+old+')*'+str(factor)
 if not curve.driver.is_simple_expression:raise RuntimeError('Edited driver is not a simple expression.')
 changes.append({'controller_id':identity,'data_path':path,'array_index':index,'old_expression':old,'new_expression':curve.driver.expression,'factor':factor})
if step=='B':
 obj=owners['BAS-013'];obj.data=obj.data.copy();center=sum(v.co.x for v in obj.data.vertices)/len(obj.data.vertices)
 for v in obj.data.vertices:v.co.x=center+(v.co.x-center)*1.15
 obj.data.update();changes.append({'part_id':'BAS-013','edit':'Scale local mesh X about its mean by 1.15; topology unchanged.'})
elif step=='C1-missing':
 obj=cube('Acceptance detail awaiting identity',(0,.09,0),.008);obj['release_role']='part';obj['export_enabled']=True;record['new_object']=obj.name
 changes.append({'expected_build_failure':'Canonical part owner is missing part_id; object named in the error.'})
elif step=='C1-create':
 require('C1-missing');obj=bpy.data.objects[record['new_object']];record['new_part_id']=assign_part(obj,registry);changes.append({'part_id':record['new_part_id'],'edit':'Assign complete defaults with helper.'})
elif step=='C1-attach':
 require('C1-create');pid=record['new_part_id'];obj=cube('Acceptance attached detail',(.005,.09,0),.003);attach_geometry(obj,owners[pid]);changes.append({'part_id':pid,'edit':'Attach geometry without issuing an identity.'})
elif step=='C1-rename':
 require('C1-attach');pid=record['new_part_id'];owners[pid].name='Renamed acceptance owner';owners[pid]['viewer_display_name']='Renamed acceptance display';owners['CTL-05'].name='Renamed left grip';owners['CTL-05']['viewer_display_name']='Renamed left volume';controller('CTRL-0103').name='Renamed volume motion controller'
 changes.append({'part_ids':[pid,'CTL-05'],'edit':'Rename owner, display name and motion controller while retaining IDs and native dependency pointers.'})
elif step=='C1-remove':
 require('C1-rename');pid=record['new_part_id']
 for obj in list(bpy.data.objects):
  if obj.get('release_role') in {'part','geometry'} and (obj.get('part_id') in {pid,'CTL-05'} or obj.get('owner_part_id') in {pid,'CTL-05'}):bpy.data.objects.remove(obj,do_unlink=True)
 probe=bpy.data.objects.new('Temporary ID reuse check',None);registry_before=registry.read_bytes()
 for reserved in [pid,'CTL-05']:
  try:assign_part(probe,registry,reserved)
  except ValueError as error:
   if 'already issued' not in str(error):raise
  else:raise RuntimeError('Removed ID was incorrectly reissued: '+reserved)
 bpy.data.objects.remove(probe);assert registry.read_bytes()==registry_before
 changes.append({'part_ids':[pid,'CTL-05'],'edit':'Remove the new detail and the existing volume grip. Keep registry entries and controller helpers; prove removed IDs cannot be reissued and the missing grip binding becomes inactive.'})
elif step=='C2-duplicate':
 obj=owners['BAS-013'].copy();obj.data=obj.data.copy();bpy.context.scene.collection.objects.link(obj);obj.name='Acceptance duplicate active owner';record['duplicate_object']=obj.name;changes.append({'expected_build_failure':'Duplicate active part_id BAS-013 with both object names.'})
elif step=='C2-roles':
 require('C2-duplicate');bpy.data.objects.remove(bpy.data.objects[record['duplicate_object']],do_unlink=True)
 for name,data in [('Acceptance ordinary camera',bpy.data.cameras.new('Acceptance camera data')),('Acceptance bare empty',None),('Acceptance tagged pivot',None)]:
  obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj)
  if name.endswith('pivot'):obj['release_role']='pivot';obj['owner_part_id']='BAS-013';obj['export_enabled']=False
 retired_id=next(r['id'] for r in json.loads(registry.read_text())['records'] if r.get('state_at_registration')=='retired-reserved');obj=cube('Acceptance retained retired geometry',(0,0,0),.001);obj['release_role']='retired';obj['retired_part_id']=retired_id;obj['export_enabled']=False
 obj=cube('Acceptance construction helper',(0,0,0),.001);mark_helper(obj)
 changes.append({'edit':'Remove invalid duplicate; add camera, bare empty, owned pivot, retired geometry and explicit helper.'})
elif step=='D':
 replace_driver('CTRL-0925','rotation_euler',2,1.5)
 replace_driver('CTRL-0103','location',1,1.25)
else:raise RuntimeError('Unknown acceptance edit '+step)
bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True,check_existing=False)
record['applied'].append(step);marker.write_text(json.dumps(record,indent=2)+'\n')
out=ROOT/'acceptance-results';out.mkdir(exist_ok=True)
receipt={'step':step,'beforeNativeSHA256':before,'afterNativeSHA256':hashlib.sha256(native.read_bytes()).hexdigest(),'changes':changes,'scope':'Deliberate disposable-copy edits; never use as release baseline.'}
(out/(step+'-edit.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
