// Display translations for an aligned exploded assembly. Every module remains
// rigid: no rotation, component packing, or changes to source registration.
// These offsets illustrate assembly structure, not factory removal instructions.
import config from '../config/model.json' with {type:'json'};
const DEFINITIONS=Object.freeze(config.assemblies);
export const EXPLODED_GROUP_ORDER=Object.freeze(DEFINITIONS.map(group=>group.name));
const ZERO=()=>[0,0,0];
const add=(a,b)=>a.map((value,i)=>value+b[i]);
const center=bounds=>bounds.min.map((value,i)=>(value+bounds.max[i])/2);
const dimensions=bounds=>bounds.min.map((value,i)=>bounds.max[i]-value);
const completeBounds=bounds=>({...bounds,center:center(bounds),dimensions:dimensions(bounds)});
const emptyBounds=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
const include=(target,bounds,offset=ZERO())=>{
 for(let i=0;i<3;i++){
  target.min[i]=Math.min(target.min[i],bounds.min[i]+offset[i]);
  target.max[i]=Math.max(target.max[i],bounds.max[i]+offset[i]);
 }
};
const validateBounds=part=>{
 const bounds=part.correctedBounds||part.authoritativeBounds;
 if(!bounds||!Array.isArray(bounds.min)||!Array.isArray(bounds.max)||bounds.min.length!==3||bounds.max.length!==3||!bounds.min.every(Number.isFinite)||!bounds.max.every(Number.isFinite)||bounds.min.some((value,i)=>value>bounds.max[i]))throw new Error(part.id+': exploded assembly needs finite authoritative bounds');
 return bounds;
};

// Explicit ownership overrides avoid inferring assemblies from nearby positions.
export function explodedAssemblyId(part){const id=part.assembly||'ungrouped';if(!DEFINITIONS.some(g=>g.id===id))throw Error(part.id+': unknown viewer assembly '+id+'; define it in config/model.json');return id;}

export function createExplodedLayout(parts,{gapMm=config.viewer.explodedGapMm,sideGapMm=config.viewer.explodedSideGapMm}={}){
 for(const [name,value] of Object.entries({gapMm,sideGapMm}))if(!Number.isFinite(value)||value<0)throw new Error('Invalid exploded assembly '+name);
 if(!parts.length)return {offsets:{},labelAnchors:{},assemblyIds:{},bounds:completeBounds({min:ZERO(),max:ZERO()}),centralBounds:{min:ZERO(),max:ZERO()},groups:[],leaders:[],notes:'Empty assembly.'};
 const ordered=[...parts].sort((a,b)=>a.id.localeCompare(b.id)),seen=new Set();
 const byAssembly=new Map(DEFINITIONS.map(group=>[group.id,{...group,axis:[...group.axis],partIds:[],assembledBounds:emptyBounds(),offset:ZERO()}]));
 const nativeBounds=emptyBounds();
 for(const part of ordered){
  if(typeof part.id!=='string'||!part.id)throw new Error('Exploded assembly needs a component ID');
  if(seen.has(part.id))throw new Error('Duplicate component ID '+part.id);seen.add(part.id);
  const bounds=validateBounds(part),group=byAssembly.get(explodedAssemblyId(part));
  group.partIds.push(part.id);include(group.assembledBounds,bounds);include(nativeBounds,bounds);
 }
 const groups=[...byAssembly.values()].filter(group=>group.partIds.length);
 // The connected transport, complete motor and battery case remain the datum.
 const datum=byAssembly.get('transport');
 const datumBounds=datum.partIds.length?datum.assembledBounds:nativeBounds;
 let front=datumBounds.max[2],rear=datumBounds.min[2];
 for(const group of groups){
  if(group.axis[2]===1){group.offset[2]=Math.max(0,front+gapMm-group.assembledBounds.min[2]);front=group.assembledBounds.max[2]+group.offset[2];}
  if(group.axis[2]===-1){group.offset[2]=Math.min(0,rear-gapMm-group.assembledBounds.max[2]);rear=group.assembledBounds.min[2]+group.offset[2];}
  // Cover trim and associated fasteners stay registered as rigid modules.
  if(group.axis[0]===1)group.offset[0]=Math.max(0,nativeBounds.max[0]+sideGapMm-group.assembledBounds.min[0]);
  if(group.axis[0]===-1)group.offset[0]=Math.min(0,nativeBounds.min[0]-sideGapMm-group.assembledBounds.max[0]);
  if(group.axis[1]===1)group.offset[1]=Math.max(0,nativeBounds.max[1]+sideGapMm-group.assembledBounds.min[1]);
 }
 const offsets=Object.create(null),labelAnchors=Object.create(null),assemblyIds=Object.create(null),bounds=emptyBounds();
 include(bounds,nativeBounds);
 for(const part of ordered){
  const group=byAssembly.get(explodedAssemblyId(part)),offset=[...group.offset];
  offsets[part.id]=offset;assemblyIds[part.id]=group.id;
  const partBounds=validateBounds(part),anchor=center(partBounds);anchor[2]=partBounds.max[2];
  labelAnchors[part.id]=add(anchor,offset);include(bounds,partBounds,offset);
 }
 const outputGroups=groups.map(group=>{
  const anchor=center(group.assembledBounds),labelAnchor=add(anchor,group.offset);
  const displayBounds={min:add(group.assembledBounds.min,group.offset),max:add(group.assembledBounds.max,group.offset)};
  return {...group,assembledBounds:completeBounds(group.assembledBounds),bounds:completeBounds(displayBounds),
   direction:[...group.axis],center:labelAnchor,anchor,labelAnchor,leader:{from:[...anchor],to:[...labelAnchor]}};
 });
 return {offsets,labelAnchors,assemblyIds,bounds:completeBounds(bounds),centralBounds:nativeBounds,groups:outputGroups,
  leaders:outputGroups.filter(group=>group.offset.some(value=>value!==0)).map(group=>({assemblyId:group.id,partIds:[...group.partIds],...group.leader})),
  suggestedViewDirection:[1.1,.7,1.35],
  notes:'Aligned exploded modules. Boards retain their mounted details; the cassette, motor, transport and battery case remain coherent. Source orientations and registration are unchanged. Wiring retains its modeled routing. Separation illustrates assembly structure, not verified factory removal paths.'};
}

export function explodedOffset(layout,id,progress){
 const offset=layout.offsets[id];if(!offset)throw new Error('Unknown exploded component '+id);
 const amount=Math.max(0,Math.min(1,Number(progress)||0));
 if(amount===0)return ZERO();
 return offset.map(value=>value*amount);
}
