"""Relative build paths and atomic stage outputs; no fixed disk reserve."""
import hashlib,json,os,shutil,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
KIT=ROOT.parent   # the kit folder; ROOT is rebuild/
OUT=Path(os.environ.get('PTP_STAGE_OUT',str(ROOT/'build'/'exports'))).resolve()
CONFIG=json.loads((ROOT/'config/model.json').read_text())
def sha256(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def check_space(directory,projected_bytes=0):
 directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(directory).free<projected_bytes:raise RuntimeError(f'Insufficient free space for stage outputs: need {projected_bytes:,} additional bytes at {directory}.')
def write_bytes_guarded(path,data):
 path=Path(path);check_space(path.parent,len(data));fd,temporary=tempfile.mkstemp(prefix='.'+path.name+'-',suffix='.tmp',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(temporary,path)
 finally:
  if os.path.exists(temporary):os.unlink(temporary)
def write_json(path,value):write_bytes_guarded(path,(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n').encode())
def bound_native():
 native=(ROOT/CONFIG['native']).resolve()
 if not native.is_relative_to(KIT) or native.is_symlink():raise ValueError('Native input must be a regular kit-local file.')
 if not native.is_file():raise FileNotFoundError(f'Missing {CONFIG["native"]}; restore the editable native model.')
 expected=os.environ.get('PTP_EXPECTED_NATIVE_SHA256')
 if not expected:raise ValueError('Missing explicit native hash binding. Run npm run rebuild; do not invoke this export stage independently.')
 actual=sha256(native)
 if actual!=expected:raise ValueError('Native file changed after the build selected it. Save your edits, then restart npm run rebuild.')
 return native,actual

# ---- exterior versions
# One dropdown on the transport controller chooses which lettering is shown. An object that belongs
# to only some versions carries "exterior_versions" (for example "intermediate early") and two
# visibility drivers. Untagged objects belong to every version.
EXTERIOR_PROPERTY='Exterior version'
def exterior_tags(obj):
 value=obj.get('exterior_versions')
 return value.split() if isinstance(value,str) and value.strip() else None
def prepare_exterior(bpy,controller,check=False):
 """Returns the versions the file offers and shows every tagged object, in memory only.
 Blender does not evaluate an object that is hidden in the viewport: it would not follow its parent
 and would lose its modifiers. A stage that reads shapes or positions must therefore show them all.
 With check=True the dropdown is first tried at every choice and must show exactly the tagged lettering."""
 tagged=[o for o in bpy.data.objects if exterior_tags(o)]
 if EXTERIOR_PROPERTY not in controller.keys():
  if tagged:raise ValueError(f'{tagged[0].name}: has exterior_versions, but the controller has no "{EXTERIOR_PROPERTY}" choice.')
  return {'versions':[],'default':None,'labels':{}}
 items=sorted(controller.id_properties_ui(EXTERIOR_PROPERTY).as_dict().get('items') or [],key=lambda item:item[-1])
 versions=[item[0].lower() for item in items]
 if len(versions)<1 or [item[-1] for item in items]!=list(range(len(versions))):raise ValueError(f'"{EXTERIOR_PROPERTY}" must offer choices numbered 0, 1, 2 and so on.')
 if controller[EXTERIOR_PROPERTY]!=0:raise ValueError(f'Save the Blender file with "{EXTERIOR_PROPERTY}" set to its first choice ({items[0][1]}); the viewer always starts with it.')
 for o in tagged:
  unknown=[t for t in exterior_tags(o) if t not in versions]
  if unknown:raise ValueError(f'{o.name}: exterior_versions names {unknown}; the choices are {versions}.')
  if o.get('release_role')!='geometry':raise ValueError(f'{o.name}: only attached lettering may carry exterior_versions, not a part itself.')
 if check:
  scene=bpy.context.scene
  for value,version in list(enumerate(versions))+[(0,versions[0])]:
   controller[EXTERIOR_PROPERTY]=value;controller.update_tag();scene.frame_set(scene.frame_current);bpy.context.view_layer.update()
   graph=bpy.context.evaluated_depsgraph_get()
   for o in tagged:
    hidden=version not in exterior_tags(o);ev=o.evaluated_get(graph)
    if ev.hide_viewport!=hidden or ev.hide_render!=hidden:raise ValueError(f'{o.name}: with "{EXTERIOR_PROPERTY}" at {version} it should be {"hidden" if hidden else "shown"}. Repair its two visibility drivers to match exterior_versions.')
 for o in tagged:
  for path in ('hide_viewport','hide_render'):
   try:o.driver_remove(path)
   except TypeError:pass
  o.hide_viewport=False;o.hide_render=False
 bpy.context.view_layer.update()
 return {'versions':versions,'default':versions[0],'labels':{item[0].lower():item[1] for item in items}}
def shown_by_default(obj,exterior):
 tags=exterior_tags(obj)
 return not tags or exterior['default'] in tags
