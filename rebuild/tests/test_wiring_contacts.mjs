// Intersect exposed terminal surfaces with individually identified conductive lands.
// Check both exported triangles and the decoded, quantized triangles delivered to the viewer.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {Vector3 as V,Box3} from 'three';
import {json,eps,overlaps,pair,openModel} from './wiring_geometry.mjs';
const lands=json('tests/reference/wiring-lands.json');
for(const packed of [false,true]){
 const {tag,model,parts,get}=openModel(packed);
 let count=0;
 for(const [id,targets] of Object.entries(lands)){
  const tip=get(id,'','tin');
  for(const [pid,name,material] of targets){assert(pair(tip,get(pid,name,material)),tag+' '+id+' does not touch '+[pid,name,material].filter(Boolean).join(' / '));count++;}
 }
 assert(pair(get('CAP-901','','tinned'),get('JCK-13','','tinned')));
 assert(pair(get('CAP-901','','tinned'),get('JCK-35','','exposed brass')));
 assert(pair(get('JCK-36','','exposed brass'),get('JCK-35','','exposed brass')),'Unplugged jack must feed battery');
 assert(!pair(get('JCK-35','','exposed brass'),get('JCK-13','','tinned')),'DC positive isolated from center pin');
 for(const pose of ['stop','play','ff','rew'])assert.equal(pair(get('SWT-004','','',pose),get('SWT-005','','',pose)),pose!=='stop','S901 '+pose);
 for(const pose of ['stop','play'])for(const [k,head] of [['WIR-PB-01',true],['WIR-PB-02',false]]){
  const conductors=[],screen=get(k,k+' enclosing shield','',pose);
  for(const [i,sig] of ['WHT','RED','SH'].entries()){
   const conductor=get(k,k+' '+sig+' continuous conductor','',pose);conductors.push(conductor);
   const a=head?get('BAY-060','HP901 terminal '+(i+1),'',pose):get('JB-001','Audio solder OUT '+sig,'',pose);
   const b=head?get('JB-001','Audio solder IN '+sig,'',pose):get('MB-001','Audio solder PRE '+sig,'',pose);
   assert(pair(conductor,a)&&pair(conductor,b),tag+' '+k+' '+sig+' '+pose+' endpoint');
   assert.equal(pair(conductor,screen),i===2,tag+' '+k+' '+sig+' shield isolation');
  }
  for(let i=0;i<3;i++)for(let j=0;j<i;j++)assert(!pair(conductors[i],conductors[j]),tag+' '+k+' cores short in '+pose);
 }
 for(const [k,target] of [['WIR-MIC-04','Jack PCB solder MIC901 red'],['WIR-OUT-03','Audio solder WIR-OUT-03']]){
  const core=get(k,k+' continuous conductor');
  assert(pair(core,get('MB-001','Audio solder '+k))&&pair(core,get('JB-001',target)),tag+' '+k+' lands');
 }
 for(const id of ['WIR-MTR-01','WIR-MTR-02','WIR-MTR-03','WIR-MTR-04']){
  assert(!pair(get(id,'','insulation'),get('MTR-030')),tag+' motor carrier must clear '+id);
 }
 for(const pose of ['stop','play','ff','rew']){
  for(const id of ['SWT-002','SWT-007'])assert(!pair(get('BAS-001','','',pose),get(id,'',id==='SWT-002'?'phosphor':'',pose)),tag+' base must clear '+id+' '+pose);
 }
 const mb=name=>get('MB-001',name),inputSide=mb('New main copper • C201 RED input'),common=mb('New main PCB conductor 08');
 assert(!pair(inputSide,common)&&pair(inputSide,mb('New main solder C201 pin2')),tag+' right preamplifier isolation');
 for(const [name,num] of [['PRE WHT',18],['PRE RED',17],['PRE SH',8],['WIR-MIC-04',3],['WIR-OUT-03',8]])
  assert(pair(mb('Audio solder '+name),mb('New main PCB conductor '+String(num).padStart(2,'0'))),tag+' main '+name);
 const copper=n=>mb('New main PCB conductor '+String(n).padStart(2,'0'));
 for(const [i,name] of ['New main copper • AF contact A','New main PCB conductor 42','New main PCB conductor 08','New main PCB conductor 48','New main PCB conductor 50'].entries()){
  const w=mb('AF to main • formed joint '+(i+1));assert(pair(w,get('VOL-001','','copper'))&&pair(w,mb(name)),tag+' AF bridge '+(i+1));
 }
 for(const [k,src,ia,ib] of [
  ['WIR-TNE-01','New S301 solder tone_LU',24,22],['WIR-TNE-02','New S301 solder tone_BRN','New main copper • S301 brown',32],
  ['WIR-TNE-03','New S301 solder tone_WHT',26,35],['WIR-TNE-04','New S301 solder tone_VIO',27,25],
  ['WIR-IN-01',null,18,28],['WIR-IN-02',null,17,'New main copper • C201 RED input'],['WIR-AF-01',null,1,'New main copper • AF contact A']]){
   const w=get(k,k+' continuous conductor'),a=mb(src||'Main link solder '+k+' A'),b=mb('Main link solder '+k+' B');
   assert(pair(w,a)&&pair(w,b)&&pair(a,typeof ia==='number'?copper(ia):mb(ia))&&pair(b,typeof ib==='number'?copper(ib):mb(ib)),tag+' '+k+' to both main copper islands');
 }
 for(const [k,pin,land] of [[101,1,copper(28)],[201,2,inputSide]]){
  const s=mb('New main solder C'+k+' pin'+pin);assert(pair(get('CAP-'+k,'','tinned'),s)&&pair(s,land),tag+' C'+k+' input');
 }
 for(const [wid,col,far] of [['WIR-901','yellow','Servo PCB solder D901 yellow far'],['WIR-902','blue','Servo PCB solder L601 terminal 3']]){
  const wire=get(wid,'D901 '+col+' board jumper core');assert(pair(wire,get('SB-001','Servo PCB solder D901 '+col))&&pair(wire,get('SB-001',far)),tag+' D901 '+col+' across board');
 }
 const trim109=mb('New main copper • R109 continuation'),trim105=mb('New main copper • R105 continuation');
 assert(pair(trim109,copper(32))&&pair(trim109,mb('New main copper • R109 pad'))&&pair(trim105,copper(40))&&pair(trim105,mb('New main copper • R105 pad')),tag+' left tone and trim paths');
 assert(!pair(trim109,trim105)&&!pair(trim109,copper(33))&&!pair(trim105,copper(33)),tag+' separate trim nets');
 const passiveLands=[...new Set(parts.get('MB-001').meshes.map(m=>m.wireLand).filter(n=>/^New main solder [RC]\d+ pin[12]$/.test(n)))];
 assert.equal(passiveLands.length,124,tag+' main passive lands');
 for(const name of passiveLands){
  const [,family,id]=name.match(/^New main solder ([RC])(\d+)/);assert(pair(mb(name),get((family==='R'?'RES-':'CAP-')+id,'','tinned')),tag+' '+name+' must touch component lead');
 }
 const jb=land=>get('JB-001',land);
 const region=n=>jb('Jack PCB conductor region '+String(n).padStart(2,'0'));
 const extension=jb('Jack copper • S801-1 common continuation');
 assert(pair(extension,region(13))&&pair(extension,region(15))&&!pair(extension,region(10))&&!pair(extension,region(14)),tag+' S801 continuation');
 for(const [land,number] of [['IN WHT',5],['IN RED',10],['IN SH',12],['OUT WHT',13],['OUT RED',14],['OUT SH',12]])assert(pair(jb('Audio solder '+land),region(number)),tag+' '+land+' must contact its conductor island');
 for(const [j,n] of [10,14,17,5,15,17].entries()){
  const solder=jb('Jack PCB solder S801 terminal '+(j+1));
  assert(pair(solder,region(n))&&pair(solder,get('HLT-0'+(j+11),'','plated')),tag+' S801 terminal '+(j+1));
 }
 const feed=['Jack copper • left output feed','Jack copper • right output feed'];
 const sleeve='Jack copper • headphone sleeves';
 assert(!pair(jb(feed[0]),jb(feed[1])),'Stereo feed copper short');
 for(const [n,ch,branch,pin,lug] of [
  [801,0,'Jack PCB conductor region 09',3,'JCK-22'],[802,1,'Jack PCB conductor region 16',1,'JCK-21'],
  [803,0,'Jack copper • socket 2 signal',4,'JCK-24'],[804,1,'Jack PCB conductor region 07',6,'JCK-23']]){
  const a=jb('Jack PCB solder R'+n+' terminal 1'),b=jb('Jack PCB solder R'+n+' terminal 2'),metal=get('RES-'+n,'','plated');
  assert(pair(jb(feed[ch]),jb('Jack PCB solder output '+(ch?'blue':'white')))&&pair(jb(feed[ch]),a)&&!pair(jb(feed[1-ch]),a),tag+' feed R'+n);
  assert(pair(metal,a)&&pair(metal,b),tag+' resistor solder '+n);
  const land=jb('Jack PCB solder J801 terminal '+pin);
  assert(pair(b,jb(branch))&&pair(jb(branch),land)&&pair(land,get(lug,'','plated')),tag+' J801 via R'+n);
  assert(!pair(jb(branch),jb(sleeve)),tag+' signal connects to headphone sleeve');
 }
 for(const [pin,lug] of [[2,'JCK-11'],[5,'JCK-12']]){
  const land=jb('Jack PCB solder J801 terminal '+pin);
  assert(pair(jb(sleeve),land)&&pair(land,get(lug,'','plated')),tag+' sleeve '+lug);
 }
 for(const pressed of [0,1])for(const [bridge,base] of [['HLT-031',11],['HLT-032',14]]){
  for(let pin=11;pin<=16;pin++){const expected=pin===base+1||pin===base+2*pressed;
   assert.equal(pair(get(bridge,'','','stop',pressed),get('HLT-0'+pin)),expected,tag+' S801 '+bridge+' pin '+pin+' pressed='+pressed);}
 }
 for(const setting of [0,1])for(const [id,targets] of [['TNE-021',['TNE-032','TNE-034']],['TNE-022',['TNE-031','TNE-033']]]){
  for(const t of ['TNE-031','TNE-032','TNE-033','TNE-034'])assert.equal(pair(get(id,'','','stop',String(setting)),get(t)),setting===0&&targets.includes(t),tag+' S301 '+id+'/'+t+' position '+setting);
 }
 // Check the final assembled routing against the surfaces surrounding the main board.
 // Clip only the case triangles outside the union of the nine part bounds.
 const dressed=['RET-101','RET-102','WIR-AF-01','WIR-IN-01','WIR-IN-02','WIR-TNE-01','WIR-TNE-02','WIR-TNE-03','WIR-TNE-04'];
 const envelope=dressed.reduce((box,id)=>box.union(get(id).box),new Box3());
 for(const shell of ['EXT-010','EXT-040','GRL-001']){
  const nearby=get(shell,'','','stop',null,envelope);
  for(const id of dressed)assert(!pair(get(id),nearby),tag+' closed case: '+id+' intersects '+shell);
 }
 console.log(tag+': '+count+' original terminals plus stereo cables, board links, five AF joints, capacitor and switch states pass.');
}
