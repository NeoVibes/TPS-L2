"""Explicit authoring operations. Import from Blender's Python console or edit scripts.

Operations modify the current session and, when issuing/reconciling IDs, append to
its registry. They never save the .blend file. Save the native model explicitly.
"""
import json,os,tempfile,re
from pathlib import Path
import bpy
from part_schema import collect_owners,load_registry,ID_PATTERN,geometry_capable

def _append_registry(path,data,records):
 if not records:return
 # Read again immediately before writing so an intervening edit cannot be lost.
 path=Path(path);current=load_registry(path)
 if current!=data:raise ValueError('Registry changed during authoring. Retry with the current registry.')
 updated={**data,'records':data['records']+records}
 with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=path.parent,prefix='.part-ids-',delete=False) as f:
  temporary=Path(f.name);json.dump(updated,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 try:os.replace(temporary,path)
 finally:
  if temporary.exists():temporary.unlink()

def reconcile_ids(registry_path, *, _pending=None):
 """Register manually entered canonical IDs, never replacing existing records."""
 if _pending is not None and _pending.get('part_id') is not None:raise ValueError('An existing identity cannot be excluded from reconciliation.')
 data=load_registry(registry_path);issued={r['id']:r for r in data['records']};owners=collect_owners([o for o in bpy.data.objects if o!=_pending])
 for pid,obj in owners.items():
  if pid in issued and issued[pid].get('state_at_registration')=='retired-reserved':raise ValueError(f'{obj.name}: {pid} is retired and cannot be reused.')
 rows=[{'id':pid,'origin':'manual-reconciliation','state_at_registration':'active'} for pid in sorted(set(owners)-set(issued))]
 _append_registry(registry_path,data,rows);return [r['id'] for r in rows]

def complete_defaults(obj):
 """Fill only missing presentation values; names are copied once."""
 orders=[int(o['viewer_order']) for o in bpy.data.objects if o.get('release_role')=='part' and 'viewer_order' in o]
 values={'display_name':obj.name,'group':'Ungrouped','assembly':'ungrouped','package':'exterior','category':'structure','service':[0.,0.,0.],'fan':[0.,0.,0.],'direction':[0.,0.,1.],'distance':0.,'order':max(orders,default=-1)+1,'is_cassette':False,'rest_when_separated':False}
 for k,v in values.items():
  if 'viewer_'+k not in obj:obj['viewer_'+k]=v
 if 'review_status' not in obj:obj['review_status']='unreviewed'


def assign_part(obj,registry_path,part_id=None,*,prefix="PRT"):
 """Give an unassigned object a never-before-issued ID and complete defaults."""
 if obj.get('part_id') is not None:raise ValueError(f'{obj.name}: already has permanent identity {obj["part_id"]}; never reassign an existing part.')
 reconcile_ids(registry_path,_pending=obj)
 data=load_registry(registry_path);issued={r['id'] for r in data['records']};owners=collect_owners([o for o in bpy.data.objects if o!=obj])
 reserved=issued|set(owners)|{o.get('retired_part_id') for o in bpy.data.objects if o.get('retired_part_id')}
 if part_id is None:
  if not re.fullmatch(r'[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*',prefix):raise ValueError('Prefix must use uppercase letters, digits and optional hyphen-separated labels.')
  suffixes=[i[len(prefix)+1:] for i in reserved if isinstance(i,str) and i.startswith(prefix+'-') and i[len(prefix)+1:].isdigit()]
  width=max([len(x) for x in suffixes],default=6);n=max([int(x) for x in suffixes],default=0)+1
  while f'{prefix}-{n:0{width}}' in reserved:n+=1
  part_id=f'{prefix}-{n:0{width}}'
 if not ID_PATTERN.fullmatch(part_id):raise ValueError('Use an uppercase hyphen-separated permanent identity, for example PRT-000001.')
 if part_id in reserved:raise ValueError(f'{part_id} was already issued or reserved. Choose a new permanent identity.')
 if obj.get('retired_part_id'):raise ValueError(f'{obj.name}: retained retired geometry must remain retired; make a deliberate new geometry object for a new identity.')
 parent=obj.parent
 while parent:
  if parent.get('part_id'):raise ValueError(f'{obj.name}: nested under part {parent["part_id"]}; attach detail to that owner, or reparent before creating a new owner.')
  parent=parent.parent
 _append_registry(registry_path,data,[{'id':part_id,'origin':'authoring-helper','state_at_registration':'active'}])
 obj['part_id']=part_id;obj['release_role']='part';obj['export_enabled']=True
 if 'owner_part_id' in obj:del obj['owner_part_id']
 complete_defaults(obj);return part_id

def attach_geometry(obj,owner):
 """Attach a detail to an existing owner, preserving world pose; issue no ID."""
 if obj.get('part_id') or obj.get('retired_part_id'):raise ValueError(f'{obj.name}: existing/retired identity must not be silently discarded.')
 if not geometry_capable(obj):raise ValueError(f'{obj.name}: attach_geometry requires geometry or a geometry-producing instance.')
 if owner.get('release_role')!='part' or not owner.get('part_id'):raise ValueError('Target must be a canonical part owner.')
 parent=owner
 while parent:
  if parent==obj:raise ValueError('Attachment would create a parenting cycle.')
  parent=parent.parent
 matrix=obj.matrix_world.copy();obj.parent=owner;obj.matrix_world=matrix
 obj['owner_part_id']=owner['part_id'];obj['release_role']='geometry';obj['export_enabled']=True

def mark_helper(obj):
 """Classify geometry or a whole collection as non-exportable construction."""
 if isinstance(obj,bpy.types.Object) and obj.get('part_id'):raise ValueError(f'{obj.name}: already a canonical part. Retire its identity explicitly before marking it helper.')
 obj['release_role']='helper'
 if isinstance(obj,bpy.types.Object):
  obj['export_enabled']=False
  if 'owner_part_id' in obj:del obj['owner_part_id']

def show_in_versions(obj,versions):
 """Show an attached lettering piece only in the named exterior versions (for example ['early']).
 Sets its exterior_versions tag and the two visibility drivers that follow the controller's choice."""
 from build_io import EXTERIOR_PROPERTY,CONFIG
 if obj.get('release_role')!='geometry' or not obj.get('owner_part_id'):raise ValueError(f'{obj.name}: attach it to a part first (attach_geometry); a part itself cannot belong to a version.')
 controller=next((o for o in bpy.data.objects if o.get('controller_id')==CONFIG['controllers']['transport']),None)
 if controller is None or EXTERIOR_PROPERTY not in controller.keys():raise ValueError(f'The transport controller has no "{EXTERIOR_PROPERTY}" choice.')
 offered=[item[0].lower() for item in sorted(controller.id_properties_ui(EXTERIOR_PROPERTY).as_dict()['items'],key=lambda item:item[-1])]
 chosen=[v for v in offered if v in versions]
 if not chosen or len(chosen)!=len(set(versions)):raise ValueError(f'Choose from {offered}.')
 for path in ('hide_viewport','hide_render'):
  try:obj.driver_remove(path)
  except TypeError:pass
 if len(chosen)==len(offered):
  if 'exterior_versions' in obj:del obj['exterior_versions']
  obj.hide_viewport=obj.hide_render=False;return
 obj['exterior_versions']=' '.join(chosen)
 # One comparison keeps the driver a simple expression, which Blender evaluates with scripts off.
 if len(chosen)==1:expression='x != %d'%offered.index(chosen[0])
 elif len(chosen)==len(offered)-1:expression='x == %d'%next(i for i,v in enumerate(offered) if v not in chosen)
 else:raise ValueError('Name one version, or all but one.')
 for path in ('hide_viewport','hide_render'):
  driver=obj.driver_add(path).driver;driver.type='SCRIPTED';x=driver.variables.new();x.name='x';x.targets[0].id=controller;x.targets[0].data_path='["%s"]'%EXTERIOR_PROPERTY;driver.expression=expression
 obj.hide_viewport=obj.hide_render=offered[controller[EXTERIOR_PROPERTY]] not in chosen
