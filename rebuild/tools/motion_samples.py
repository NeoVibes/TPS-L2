"""Native dependencies and evaluated control curves. This module never saves Blender data."""
import bpy,math,json
import numpy as np

def sample_controls(scene,controllers,roots,parts,C,deformations,config,setpose,trs):
    byid={row['id']:obj for obj,row in roots.items()}
    result={};bindings=[c for c in config['controls'] if c.get('native')]
    inputs={}
    for key,cid in config['controllers'].items():
        obj=controllers[cid]
        inputs[cid]={'editing_location':'Native object custom properties','object_name':obj.name,'properties':{k:{'value':v,'range':obj.id_properties_ui(k).as_dict()} for k,v in obj.items() if isinstance(v,(int,float))}}
    for binding in bindings:
        source=binding['native'];controller=controllers[config['controllers'][source['controller']]];prop=source['property']
        if prop not in controller:raise ValueError(f'{binding["id"]}: missing native property {prop}')
        ui=controller.id_properties_ui(prop).as_dict();low=float(ui['min']);high=float(ui['max']);saved=controller[prop]
        if not all(math.isfinite(v) for v in [low,high]) or high<=low:raise ValueError(f'{prop}: set a finite native UI range before rebuilding.')
        setpose();cache={}
        def evaluate(value):
            if value not in cache:
                controller[prop]=low+(high-low)*value;controller.update_tag();scene.frame_set(1);scene.frame_set(0);bpy.context.view_layer.update()
                transforms={pid:trs(C@obj.matrix_world) for pid,obj in byid.items()}
                weights={f'{d["owner"]}/{t["name"]}':keys.key_blocks[t['name']].value for d,keys in deformations for t in d['targets']}
                cache[value]=(transforms,weights)
            return cache[value]
        initial=sorted(set(config['sampling']['ordinary']+(config['sampling']['toneRequired'] if binding['id']=='tone' else [])))
        for value in initial:evaluate(value)
        ptol=config['sampling']['positionToleranceMm'];wtol=config['sampling']['weightTolerance']
        # Every interval gets a midpoint test, including apparently flat endpoints.
        # Refine nonlinear translations and deformation; fail rather than hide an unresolved discontinuity.
        def refine(a,b,depth=0):
            mid=(a+b)/2;av,aw=evaluate(a);bv,bw=evaluate(b);mv,mw=evaluate(mid)
            position=max((max(abs(mv[pid][0][i]-(av[pid][0][i]+bv[pid][0][i])/2) for i in range(3)) for pid in byid),default=0)
            weight=max((abs(mw[k]-(aw[k]+bw[k])/2) for k in aw),default=0)
            if position>ptol or weight>wtol:
                if depth>=20:raise ValueError(f'{prop}: unresolved native discontinuity near {mid}; position error {position}, weight error {weight}.')
                refine(a,mid,depth+1);refine(mid,b,depth+1)
        for a,b in zip(initial,initial[1:]):refine(a,b)
        rest=source['rest'];baseline,_=evaluate(rest);changed={}
        for pid in byid:
            track=[{'value':v,'position':state[0][pid][0]} for v,state in sorted(cache.items())]
            if max(abs(row['position'][i]-baseline[pid][0][i]) for row in track for i in range(3))<=1e-7:continue
            for v,state in cache.items():
                tr=state[0][pid]
                if max(abs(tr[k][i]-baseline[pid][k][i]) for k in [1,2] for i in range(len(tr[k])))>2e-6:raise ValueError(f'{prop}/{pid}: control adds rotation or scale; extend the control adapter explicitly before release.')
            changed[pid]={'restPosition':baseline[pid][0],'samples':track}
        configured_primary=binding['partIds'][0];primary=configured_primary if configured_primary in byid else next((pid for pid in binding.get('motionPartIds',[]) if pid in changed),None)
        if primary is not None and primary not in changed:raise ValueError(f'{binding["id"]}: primary control {primary} did not move under {prop}.')
        if primary is None:delta=np.zeros(3);travel=0.
        else:
            start=evaluate(0)[0][primary][0];end=evaluate(1)[0][primary][0];delta=np.array(end)-np.array(start);travel=float(np.linalg.norm(delta))
            if travel<1e-7:raise ValueError(f'{binding["id"]}: control travel is zero.')
        weights={k:[{'value':v,'weight':state[1][k]} for v,state in sorted(cache.items())] for k in next(iter(cache.values()))[1] if max(state[1][k] for state in cache.values())-min(state[1][k] for state in cache.values())>1e-8}
        result[binding['id']]={'provenance':'native','controller_id':controller['controller_id'],'property':prop,'range':[low,high],'restValue':rest,'axis':(delta/travel).tolist() if travel else [0.,1.,0.],'travelMm':travel,'parts':changed,'deformation':weights,'sampleCount':len(cache),'interpolationChecks':{'positionToleranceMm':ptol,'weightTolerance':wtol}}
        controller[prop]=saved;controller.update_tag();setpose();scene.frame_set(1);scene.frame_set(0);bpy.context.view_layer.update()
        print('CONTROL',binding['id'],len(cache),'samples',len(changed),'moving owners',travel,'mm',flush=True)
    # Intermediate PLAY deformation comes from the native driver graph. The
    # viewer supplies timing; it must not reconstruct weights from shape-key names.
    transport=controllers[config['controllers']['transport']]
    key_curve=next((curve for curve in transport.animation_data.drivers if curve.data_path=='["key_play"]'),None)
    if key_curve is None:raise ValueError('Missing native key_play driver for PLAY interpolation.')
    saved_mute=key_curve.mute;key_curve.mute=True;saved_key=transport['key_play'];play_values=config['sampling']['ordinary']
    for d,keys in deformations:
        if d['owner'] in config['deformation']['channels']['play']:
            for target in d['targets']:target['controlCurve']={'channel':'play','samples':[]}
    for value in play_values:
        transport['key_play']=value;transport.update_tag();scene.frame_set(1);scene.frame_set(0);bpy.context.view_layer.update()
        for d,keys in deformations:
            if d['owner'] in config['deformation']['channels']['play']:
                for target in d['targets']:target['controlCurve']['samples'].append({'value':value,'weight':keys.key_blocks[target['name']].value})
    key_curve.mute=saved_mute;transport['key_play']=saved_key;transport.update_tag();setpose()
    operating=controllers[config['controllers']['operating']]
    for channel,owner in [('stop',config['deformation']['channels']['stop']),('battery',config['deformation']['channels']['battery'])]:
        for d,keys in deformations:
            if d['owner']==owner:
                for target in d['targets']:target['controlCurve']={'channel':channel,'samples':[]}
        for value in config['sampling']['ordinary']:
            setpose(eject=value if channel=='stop' else 0)
            if channel=='battery':operating['battery_catch_release_mm']=value*operating.id_properties_ui('battery_catch_release_mm').as_dict()['max'];operating.update_tag()
            scene.frame_set(1);scene.frame_set(0);bpy.context.view_layer.update()
            for d,keys in deformations:
                if d['owner']==owner:
                    for target in d['targets']:target['controlCurve']['samples'].append({'value':value,'weight':keys.key_blocks[target['name']].value})
        operating['battery_catch_release_mm']=0.;operating.update_tag();setpose()
    for d,keys in deformations:
        if d['owner']==config['deformation']['channels']['tone']:
            for target in d['targets']:target['controlCurve']={'channel':'tone','samples':result['tone']['deformation'][d['owner']+'/'+target['name']]}
    dependencies=[];parents=[];constraints=[];modifier_dependencies=[]
    blocks=list(bpy.data.objects)+list(bpy.data.shape_keys);seen=set(blocks)
    for collection in bpy.data.bl_rna.properties:
        if collection.type!='COLLECTION':continue
        for block in getattr(bpy.data,collection.identifier):
            if isinstance(block,bpy.types.ID) and block not in seen:seen.add(block);blocks.append(block)
    snapshot_refs={block:block.bl_rna.identifier+'-'+str(index) for index,block in enumerate(blocks)}
    def identity(obj):
        if obj is None:return None
        return {'part_id':obj.get('part_id'),'owner_part_id':obj.get('owner_part_id'),'controller_id':obj.get('controller_id'),'snapshot_ref':snapshot_refs.get(obj),'datablock':obj.name,'type':obj.bl_rna.identifier}
    def array_value(value):
        if isinstance(value,(str,bool,int,float)) or value is None:return value
        return [array_value(v) for v in value]
    for data in blocks:
        animation=getattr(data,'animation_data',None)
        if animation:
            for curve in animation.drivers:
                dependencies.append({'editing_location':'Native driver','owner':identity(data),'data_path':curve.data_path,'array_index':curve.array_index,'expression':curve.driver.expression,'simple_expression':curve.driver.is_simple_expression,'variables':[{'name':v.name,'type':v.type,'targets':[{'id':identity(t.id),'data_path':t.data_path,'transform_type':t.transform_type} for t in v.targets]} for v in curve.driver.variables]})
        if isinstance(data,bpy.types.Object):
            for modifier in data.modifiers:
                targets={}
                for prop in modifier.bl_rna.properties:
                    if prop.type!='POINTER' or prop.identifier=='rna_type':continue
                    value=getattr(modifier,prop.identifier,None)
                    if isinstance(value,bpy.types.ID):targets[prop.identifier]=identity(value)
                if targets:modifier_dependencies.append({'owner':identity(data),'name':modifier.name,'type':modifier.type,'targets':targets})
            if data.parent:parents.append({'child':identity(data),'parent':identity(data.parent),'parent_type':data.parent_type})
            for constraint in data.constraints:
                properties={}
                for prop in constraint.bl_rna.properties:
                    if prop.identifier=='rna_type':continue
                    try:value=getattr(constraint,prop.identifier)
                    except Exception:continue
                    if isinstance(value,bpy.types.ID):properties[prop.identifier]=identity(value)
                    elif isinstance(value,(str,bool,int,float)) or value is None:properties[prop.identifier]=value
                    elif prop.is_array:properties[prop.identifier]=array_value(value)
                constraints.append({'editing_location':'Native object constraint','owner':identity(data),'type':constraint.type,'properties':properties})
    return {'schema_version':1,'controls':result,'native_inputs':inputs,'native_dependencies':dependencies,'native_constraints':constraints,'native_modifier_dependencies':modifier_dependencies,'native_parenting':parents,'snapshot_reference_policy':'snapshot_ref joins this generated graph only; authoring and viewer bindings use part_id/controller_id. Datablock names are descriptive, never lookup keys.','active_owner_ids':sorted(byid),'behaviors':{'transport':{'kind':'mixed','native':'Driver rates and exported mode poses','viewer':'viewer/operating-state.mjs: timing, sequencing and interpolation'},'battery':{'kind':'mixed','native':'Operating controller battery_open_deg and battery_catch_release_mm','viewer':'config/model.json: opening fraction and release sequencing; viewer/door-motion.mjs: interpolation'},'belts':{'kind':'mixed','native':'Swept path geometry and driving-owner rates','viewer':'viewer/drive-materials.mjs: traveling visual cues'},'separation':{'kind':'viewer-defined','editing_location':'Native viewer_* presentation properties and config/model.json assemblies; viewer/exploded-layout.mjs','separate_native_system':'Transport Service view, Exploded view and per-part part_explode operate Blender independently'},'audio':{'kind':'viewer-defined','editing_location':'viewer/audio.mjs and viewer/shared/audio-policy.mjs'},'tours':{'kind':'viewer-defined','editing_location':'viewer/tour-timeline.mjs'}}}
