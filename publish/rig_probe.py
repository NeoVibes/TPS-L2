# Records where every object sits, and whether it shows, in a range of control states.
# Run on two versions of the Blender file and compare the two records.
#   blender -b --factory-startup --disable-autoexec file.blend --python rig_probe.py -- out.json
import bpy, sys, json, hashlib, math
out=sys.argv[sys.argv.index('--')+1]
D=bpy.data; sc=bpy.context.scene; vl=bpy.context.view_layer
ctl={o.get('controller_id'):o for o in D.objects if o.get('controller_id')}
from pathlib import Path
conf=json.load(open(Path(__file__).resolve().parent.parent/'rebuild'/'config'/'model.json'))['controllers']
T=ctl[conf['transport']]; O=ctl[conf['operating']]
base_T={k:(T[k] if not hasattr(T[k],'__len__') else None) for k in T.keys() if isinstance(T[k],(int,float))}
base_O={k:O[k] for k in O.keys() if isinstance(O[k],(int,float))}
def apply(tv={},ov={},frame=1):
    for k,v in base_T.items(): T[k]=type(v)(tv.get(k,v)) if isinstance(v,float) else tv.get(k,v)
    for k,v in base_O.items(): O[k]=type(v)(ov.get(k,v)) if isinstance(v,float) else ov.get(k,v)
    T.update_tag(); O.update_tag(); sc.frame_set(-1); sc.frame_set(int(frame)); vl.update()
def snapshot():
    r={}
    for o in D.objects:
        m=o.matrix_world
        r[o.name]=[round(x,5) for row in m for x in row]
    return r
states={'rest':({},{},1)}
for k in base_T:
    if k in ('Run Demo',): continue
    hi=1.0 if k not in ('Transport',) else 3
    states['T:'+k+'=max']=({k:hi},{},1)
for mode in (1,2,3):
    states['transport %d frame 40'%mode]=({'Transport':mode},{},40)
for k,v in base_O.items():
    states['O:'+k+'=hi']=({},{k:(v+1.0 if abs(v)<5 else v+30.0)},1)
    states['O:'+k+'=lo']=({},{k:0.0},1)
rec={'controls':{'transport':sorted(base_T),'operating':sorted(base_O)},'states':{}}
for name,(tv,ov,fr) in states.items():
    apply(tv,ov,fr); s=snapshot()
    rec['states'][name]={'hash':hashlib.sha256(json.dumps(s,sort_keys=True).encode()).hexdigest()[:16],'matrices':s}
apply({}, {}, 1)
rec['visible']={o.name:[bool(o.visible_get()),bool(o.hide_render),bool(o.hide_viewport),bool(o.hide_select)] for o in D.objects}
rec['counts']={'objects':len(D.objects),'meshes':len(D.meshes),'collections':len(D.collections),'cameras':len(D.cameras),'materials':len(D.materials)}
json.dump(rec,open(out,'w'))
print('PROBE_DONE',len(rec['states']),'states',rec['counts'])
