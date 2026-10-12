"""Native part ownership and presentation contract. No model or registry writes."""
import json,math,re
from pathlib import Path
import bpy

FIELDS={'display_name':str,'group':str,'package':str,'category':str,'service':list,'direction':list,'distance':(int,float),'order':int,'fan':list,'assembly':str,'is_cassette':bool,'rest_when_separated':bool}
ROLES={'part','geometry','helper','pivot','retired'}
GEOMETRY_TYPES={'MESH','CURVE','FONT','SURFACE','META','CURVES','VOLUME','POINTCLOUD','GREASEPENCIL'}
ID_PATTERN=re.compile(r'^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$')

def geometry_capable(obj):
 return obj.type in GEOMETRY_TYPES or obj.instance_type!='NONE'

def load_registry(path):
 path=Path(path)
 if not path.is_file():raise ValueError(f'Missing issued-ID registry: {path}. Restore config/part-ids.json; never reconstruct it from current objects alone.')
 data=json.loads(path.read_text());rows=data.get('records',[]);ids=[r.get('id') for r in rows]
 if data.get('schema_version')!=1 or len(ids)!=len(set(ids)) or any(not isinstance(i,str) or not ID_PATTERN.fullmatch(i) for i in ids):raise ValueError('Invalid issued-ID registry: duplicate or malformed permanent identities.')
 return data

def presentation(obj):
 result={}
 for field,kind in FIELDS.items():
  key='viewer_'+field
  if key not in obj:raise ValueError(f'{obj.name}: missing {key}. Run authoring.complete_defaults on this owner explicitly.')
  value=obj[key]
  if kind is list:
   try:value=list(value)
   except TypeError:raise ValueError(f'{obj.name}: {key} must be a three-number vector.')
   if len(value)!=3 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in value):raise ValueError(f'{obj.name}: invalid {key}; require three finite numbers.')
  elif kind is bool:
   if type(value) not in {bool,int} or value not in {0,1}:raise ValueError(f'{obj.name}: {key} must be boolean.')
   value=bool(value)
  elif not isinstance(value,kind):raise ValueError(f'{obj.name}: invalid {key}; expected {kind}.')
  if isinstance(value,str) and not value.strip():raise ValueError(f'{obj.name}: {key} must not be empty.')
  if isinstance(value,(int,float)) and not math.isfinite(value):raise ValueError(f'{obj.name}: {key} must be finite.')
  result[field]=value
 if result['package'] not in {'exterior','mechanism','electronics'}:raise ValueError(f'{obj.name}: viewer_package must be exterior, mechanism, or electronics.')
 if result['category'] not in {'structure','motor','belts','gears','tape','controls'}:raise ValueError(f'{obj.name}: unknown viewer_category {result["category"]}.')
 if result['distance']<0 or result['order']<0:raise ValueError(f'{obj.name}: separation distance and order must be nonnegative.')
 if sum(v*v for v in result['direction'])<1e-16:raise ValueError(f'{obj.name}: viewer_direction must have nonzero length.')
 return result

def collect_owners(objects=None):
 owners={};errors=[]
 for obj in bpy.data.objects if objects is None else objects:
  pid=obj.get('part_id');role=obj.get('release_role')
  if pid is None:
   if role=='part':errors.append(f'{obj.name}: part owner is missing part_id. Assign a permanent ID using tools/authoring.py.')
   continue
  if not isinstance(pid,str) or not ID_PATTERN.fullmatch(pid):errors.append(f'{obj.name}: malformed part_id {pid!r}. Use uppercase letters, digits and hyphen-separated segments.');continue
  if role!='part':errors.append(f'{obj.name}: part_id {pid} belongs only on a canonical owner. For pivots/children use owner_part_id; move retired IDs to retired_part_id.');continue
  if pid in owners:errors.append(f'Duplicate active part_id {pid}: {owners[pid].name!r} and {obj.name!r}. Attach the duplicate geometry to the existing owner, or assign a new permanent ID explicitly.')
  else:owners[pid]=obj
 if errors:raise ValueError('\n'.join(errors))
 return owners

def audit(registry_path):
 registry=load_registry(registry_path);issued={r['id']:r for r in registry['records']};owners=collect_owners();rows=[];errors=[]
 for pid,obj in owners.items():
  if pid not in issued:errors.append(f'{obj.name}: {pid} is not registered. Run authoring.reconcile_ids explicitly before rebuilding.')
  elif issued[pid].get('state_at_registration')=='retired-reserved':errors.append(f'{obj.name}: retired ID {pid} cannot be reactivated or reused; assign a new identity.')
  try:pres=presentation(obj)
  except ValueError as e:errors.append(str(e));continue
  if not obj.get('export_enabled',False):errors.append(f'{obj.name}: active owner {pid} must be export_enabled; retire/remove its active identity to exclude it.')
  rows.append({'part_id':pid,'object':obj.name,'presentation':pres,'status':str(obj.get('review_status','unreviewed')).lower(),'geometry':[]})
 byid={r['part_id']:r for r in rows};export_set=[];helper_set=[];cue_set=[]
 for obj in bpy.data.objects:
  role=obj.get('release_role');capable=geometry_capable(obj)
  if role is not None and role not in ROLES:errors.append(f'{obj.name}: unknown release_role {role!r}.')
  if not capable:continue # Cameras, lights and bare empties need no geometry role.
  collection_helper=any(c.get('release_role')=='helper' for c in obj.users_collection)
  if role is None and collection_helper:role='helper'
  if role is None:errors.append(f'{obj.name}: geometry has no release_role. Assign a part, attach it to a part, or mark it/its collection as helper.');continue
  if role in {'helper','retired','pivot'}:
   if obj.get('export_enabled',False):errors.append(f'{obj.name}: {role} geometry cannot be export_enabled.')
   helper_set.append(obj.name);continue
  explicit=obj.get('part_id') if role=='part' else obj.get('owner_part_id')
  parent=obj.parent;ancestry=[]
  while parent:
   if parent.get('release_role')=='part' and parent.get('part_id') in owners:ancestry.append(parent['part_id'])
   parent=parent.parent
  if role=='geometry' and not explicit:errors.append(f'{obj.name}: missing owner_part_id; use attach_geometry.');continue
  if explicit not in owners:errors.append(f'{obj.name}: owner {explicit!r} does not exist. Attach to a current canonical part.');continue
  if role=='geometry' and ancestry and ancestry[0]!=explicit:errors.append(f'{obj.name}: ambiguous ownership: owner_part_id={explicit}, nearest parent owner={ancestry[0]}. Repair the tag or parenting.');continue
  if role=='part' and ancestry:errors.append(f'{obj.name}: canonical part is nested beneath another canonical part ({ancestry[0]}); parent it beneath a helper pivot to avoid ambiguous ownership.');continue
  if obj.get('illustrative_motion_cue'):
   if obj.get('export_enabled',False):errors.append(f'{obj.name}: native cue is substituted by viewer presentation and must not be exported twice.')
   cue_set.append({'object':obj.name,'owner':explicit});continue
  if not obj.get('export_enabled',False):errors.append(f'{obj.name}: attached geometry is disabled without helper/retired classification. Mark its role explicitly.');continue
  if explicit in byid:byid[explicit]['geometry'].append(obj.name);export_set.append(obj.name)
 if errors:raise ValueError('\n'.join(errors))
 controllers={}
 for obj in bpy.data.objects:
  cid=obj.get('controller_id')
  if cid:
   if cid in controllers:raise ValueError(f'Duplicate controller identity {cid}: {controllers[cid]} and {obj.name}.')
   controllers[cid]=obj.name
 return {'schema_version':1,'owners':sorted(rows,key=lambda r:r['part_id']),'geometry_objects':sorted(export_set),'helper_geometry':sorted(helper_set),'native_cues':cue_set,'controllers':controllers,'registry_ids':sorted(issued),'missing_owner_ids_reserved':sorted(set(issued)-set(owners))}


def geometry_groups(owners=None):
 """Resolve live object references from explicit identities, never object names.
 The audit must pass first. Iteration order matches the generated inventory.
 """
 owners=collect_owners() if owners is None else owners
 groups={obj:[] for obj in owners.values()}
 for obj in bpy.data.objects:
  if obj.get('release_role') not in {'part','geometry'} or not geometry_capable(obj) or not obj.get('export_enabled',False) or obj.get('illustrative_motion_cue'):continue
  identity=obj.get('part_id') if obj.get('release_role')=='part' else obj.get('owner_part_id')
  if identity in owners:groups[owners[identity]].append(obj)
 return groups
