"""Blender-only authoring regression fixture; never opens or saves a user model."""
import bpy,sys,json,tempfile,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'rebuild'/'tools'))
from part_schema import audit,collect_owners
from authoring import assign_part,attach_geometry,mark_helper,reconcile_ids,complete_defaults,show_in_versions
from build_io import EXTERIOR_PROPERTY,CONFIG
def check(condition,label):
 assert condition,label
 results.append({'test':label,'status':'PASS'})
def fails(fn,text,label):
 try:fn()
 except ValueError as e:check(text in str(e),label)
 else:raise AssertionError('Expected failure: '+label)
def cube(name):
 bpy.ops.mesh.primitive_cube_add();o=bpy.context.object;o.name=name;return o
bpy.ops.wm.read_factory_settings(use_empty=True);results=[]
with tempfile.TemporaryDirectory(prefix='portable-authoring-') as temporary:
 registry=Path(temporary)/'part-ids.json';registry.write_text(json.dumps({'schema_version':1,'records':[{'id':'OLD-001','state_at_registration':'retired-reserved','origin':'fixture'}]}))
 o=cube('New detail')
 fails(lambda:audit(registry),'New detail','Unclassified geometry fails with object name')
 o['release_role']='part' # A missing-ID diagnostic must be repairable by the helper.
 pid=assign_part(o,registry);r=audit(registry)
 check(pid=='PRT-000001' and r['owners'][0]['presentation']['package']=='exterior','New permanent ID receives initial exterior loading')
 check(r['owners'][0]['presentation']['assembly']=='ungrouped' and r['owners'][0]['presentation']['distance']==0,'Complete ungrouped static defaults')
 check(r['owners'][0]['part_id']==pid,'New part requires no research note')
 saved=registry.read_bytes();detail=cube('Attached detail');attach_geometry(detail,o)
 check(registry.read_bytes()==saved and set(audit(registry)['owners'][0]['geometry'])=={'New detail','Attached detail'},'Attachment uses owner without issuing ID')
 o.name='Renamed owner';o['viewer_display_name']='Independent display name'
 check(collect_owners()[pid]==o and detail['owner_part_id']==pid,'Rename preserves stable ownership')
 duplicate=o.copy();duplicate.data=o.data.copy();bpy.context.scene.collection.objects.link(duplicate)
 fails(lambda:audit(registry),'Duplicate active part_id','Duplicate canonical identity fails')
 bpy.data.objects.remove(duplicate,do_unlink=True)
 del o['part_id'];fails(lambda:audit(registry),'missing part_id','Canonical owner missing ID fails');o['part_id']=pid
 pivot=bpy.data.objects.new('Tagged pivot',None);bpy.context.scene.collection.objects.link(pivot);pivot['release_role']='pivot';pivot['owner_part_id']=pid;pivot['export_enabled']=False
 retired=cube('Retained retired');retired['release_role']='retired';retired['retired_part_id']='OLD-001';retired['export_enabled']=False
 check(len(audit(registry)['owners'])==1,'Tagged pivot and retained retired geometry are not active duplicates')
 bpy.context.scene.collection.objects.link(bpy.data.objects.new('Ordinary camera',bpy.data.cameras.new('Camera data')))
 bpy.context.scene.collection.objects.link(bpy.data.objects.new('Bare helper empty',None))
 check(len(audit(registry)['owners'])==1,'Ordinary camera and bare empty do not require geometry IDs')
 helper=cube('Construction helper');mark_helper(helper);check('Construction helper' in audit(registry)['helper_geometry'],'Geometry can be marked helper')
 coll=bpy.data.collections.new('Helper collection');bpy.context.scene.collection.children.link(coll);mark_helper(coll)
 geometry=cube('Collection helper');bpy.context.scene.collection.objects.unlink(geometry);coll.objects.link(geometry)
 check('Collection helper' in audit(registry)['helper_geometry'],'Collection helper classification applies to its geometry')
 instance=bpy.data.objects.new('Unclassified instance',None);bpy.context.scene.collection.objects.link(instance);instance.instance_type='COLLECTION';instance.instance_collection=coll
 fails(lambda:audit(registry),'Unclassified instance','Collection instance is geometry-producing and requires a role');mark_helper(instance)
 bpy.data.objects.remove(detail,do_unlink=True);bpy.data.objects.remove(o,do_unlink=True)
 r=audit(registry)
 check(pid in r['missing_owner_ids_reserved'],'Removing a part reserves its ID')
 fresh=cube('Replacement');fails(lambda:assign_part(fresh,registry,pid),'already issued','Issued identities cannot be reused')
 fails(lambda:assign_part(fresh,registry,'OLD-001'),'already issued','Retired identities cannot be reused')
 pid2=assign_part(fresh,registry);check(pid2=='PRT-000002','Issuance skips all previously issued identities')
 manual=cube('Manual owner');manual['part_id']='USR-007';manual['release_role']='part';manual['export_enabled']=True;complete_defaults(manual)
 check(reconcile_ids(registry)==['USR-007'],'Manual identities reconcile explicitly')
 chosen=cube('Chosen prefix');chosen_id=assign_part(chosen,registry,prefix='USR')
 check(chosen_id=='USR-008','Chosen-prefix issuance preserves existing numeric width and skips reserved values')
 chosen2=cube('Next chosen prefix');check(assign_part(chosen2,registry,prefix='USR')=='USR-009','Chosen-prefix issuance never reuses an issued number')
 digest=hashlib.sha256(registry.read_bytes()).hexdigest();audit(registry)
 check(hashlib.sha256(registry.read_bytes()).hexdigest()==digest,'Read-only audit does not edit registry')
 letter=cube('Lettering');attach_geometry(letter,chosen)
 drivers=lambda:sorted((f.data_path,f.driver.expression) for f in (letter.animation_data.drivers if letter.animation_data else []))
 fails(lambda:show_in_versions(chosen,['early']),'attach it to a part first','A part itself cannot belong to an exterior version')
 fails(lambda:show_in_versions(letter,['early']),'has no "'+EXTERIOR_PROPERTY+'" choice','Lettering versions need the controller choice')
 controller=bpy.data.objects.new('Fixture controller',None);bpy.context.scene.collection.objects.link(controller);controller['controller_id']=CONFIG['controllers']['transport']
 controller[EXTERIOR_PROPERTY]=0;controller.id_properties_ui(EXTERIOR_PROPERTY).update(default=0,items=[(v.upper(),v.title(),'',i) for i,v in enumerate(('later','intermediate','early'))])
 show_in_versions(letter,['early'])
 check(letter['exterior_versions']=='early' and drivers()==[('hide_render','x != 2'),('hide_viewport','x != 2')] and letter.hide_viewport,'Lettering for one version is tagged, driven and hidden in the others')
 show_in_versions(letter,['intermediate','later'])
 check(letter['exterior_versions']=='later intermediate' and drivers()==[('hide_render','x == 2'),('hide_viewport','x == 2')] and not letter.hide_viewport,'Lettering for all but one version is hidden only in that one')
 fails(lambda:show_in_versions(letter,['first lot']),'Choose from','An unknown exterior version is refused')
 show_in_versions(letter,['later','intermediate','early'])
 check('exterior_versions' not in letter and drivers()==[] and not letter.hide_render,'Lettering for every version carries no tag and no drivers')
print(json.dumps({'status':'PASS','fixture_only':True,'tests':results},indent=2))
