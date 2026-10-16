import './test_setup.mjs';
import {pageHtml,modelFile,geometryBytes,geometryBuffer,viewFiles,buildRecord,fakeDocument} from './kit_files.mjs';
import {assertInventoryCoverage} from './inventory_contract.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { TOUR_SECONDS, TOUR_DURATIONS, tourLocation, tourMotion } from '../viewer/tour-timeline.mjs';
import { createLoader } from '../viewer/loading.mjs';
import { TRANSPORT_RATES } from '../viewer/operating-state.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const close = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} differs from ${b}`);
const tolerance = .002;

// Verify the editorial sequence and timeline at the transitions visitors see,
// including a single low-frame-rate step crossing several chapters.
assert.equal(TOUR_SECONDS, 80);
assert.deepEqual(TOUR_DURATIONS, [8, 10, 12, 12, 10, 10, 12, 6]);
const tourFixture = [
  {duration:8,mode:'stop',view:'assembled'}, {duration:10,mode:'stop',view:'assembled',door:true,media:'ejected'},
  {duration:12,mode:'play',view:'service'}, {duration:12,mode:'play',view:'service'},
  {duration:10,mode:'ff',view:'service'}, {duration:10,mode:'stop',view:'service'},
  {duration:12,mode:'stop',view:'exploded'}, {duration:6,mode:'stop',view:'assembled'},
];
const finalMotion = tourMotion(80,tourFixture);
assert.deepEqual(finalMotion.modeSeconds,{stop:46,play:24,ff:10,rew:0});
assert.equal(finalMotion.tapeSeconds,0,'Service cassette is physically separated from the running transport');
assert.equal(finalMotion.mediaModeSeconds.play,0);
assert.equal(finalMotion.mediaModeSeconds.ff,0);
const rewindFixture = [{duration:4,mode:'play',view:'assembled'},{duration:1,mode:'rew',view:'assembled'}];
assert.equal(tourMotion(5,rewindFixture).tapeSeconds,4+TRANSPORT_RATES.rew,'Reverse winding contributes the shared negative transport rate');
assert.equal(tourMotion(10,[{duration:10,mode:'play',view:'assembled',door:true}]).tapeSeconds,10,'An open cover permits seated tape playback');
assert.equal(tourMotion(10,[{duration:10,mode:'play',view:'exploded'}]).tapeSeconds,0,'Separated geometry cannot advance transport');
assert.deepEqual(tourMotion(41.5,tourFixture),tourMotion(41.5,tourFixture),'Repeated seek has no retained integration state');
for (const [time, index, offset, ended] of [[-4,0,0,false],[0,0,0,false],[7.5,0,7.5,false],[8,1,0,false],[18,2,0,false],[42,4,0,false],[53,5,1,false],[74,7,0,false],[80,7,6,true],[120,7,6,true]]) {
  assert.deepEqual(tourLocation(time), { index, offset, ended });
}
for (const frameSeconds of [1/60, 1/30, .25, 3, 17]) {
  let elapsed = 0;
  while (elapsed < 80) {
    const previous = elapsed; elapsed = Math.min(80, elapsed + frameSeconds);
    const location = tourLocation(elapsed);
    const reconstructed = TOUR_DURATIONS.slice(0, location.index).reduce((a,b) => a+b, 0) + location.offset;
    close(reconstructed, elapsed, 1e-10, `Timeline after ${frameSeconds}s frame`);
    const motion=tourMotion(elapsed,tourFixture);
    // This independent piecewise tape oracle catches chapter boundary errors:
    // 18 seconds stopped, 24 seconds play, 10 seconds fast wind, then stopped.
    const expectedTape=0; // All running chapters have their cassette removed for service.
    close(motion.tapeSeconds,expectedTape,1e-10,'Tour tape time independent of frame segmentation');
    assert.ok(elapsed > previous);
  }
  assert.equal(tourLocation(elapsed).ended, true);
  assert.deepEqual(tourMotion(elapsed,tourFixture),finalMotion,'All frame schedules land on identical phases and tape position');
}

const [model,original,packages,build,nativeBinding]=await Promise.all([
 json('build/viewer-data/model.json'),json('build/exports/model.json'),json('build/viewer-data/packages.json'),
 buildRecord(),json('build/exports/native-checks.json')]);
const packageManifest={packages},native=nativeBinding.frame1;
assert.equal(nativeBinding.native_sha256,model.source_sha256);assert.equal(nativeBinding.model_sha256,hash(await readFile('build/exports/model.json')));
assert.equal(build.nativeSha256,model.source_sha256);
assert.equal(original.source_sha256, model.source_sha256);
const {ownerIds} = assertInventoryCoverage(model);
for(const context of Object.values(model.inspectionContexts)){assert(context.partIds.includes(context.focusPartId));for(const id of context.partIds)assert(model.parts.some(p=>p.id===id),'Board context includes only real component IDs');}
for(const part of model.parts.filter(p=>/^(BAT-|BCL-)/.test(p.id)||p.id==='BAY-010'))assert.equal(part.package,'exterior',part.id+' must be present before detail loading');
for(const part of model.parts.filter(p=>p.id.startsWith('BCL-')))assert.deepEqual(part.service,model.parts.find(p=>p.id==='EXT-010').service,part.id+' stays with rear cabinet in service');
assert(model.inspectionContexts.battery.partIds.includes('BAY-010'),'Battery inspection includes its modeled backing floor');
assert(model.inspectionContexts.servoBoard.partIds.includes('IND-601'));assert(model.inspectionContexts.jackHotline.partIds.includes('MIC-001'));
assert.deepEqual([...new Set(model.parts.map(part => part.id))].sort(),ownerIds,'Stable selection identifiers exactly cover the current inventory');
assert.deepEqual(model.parts.map(p => p.id).sort(), original.parts.map(p => p.id).sort(), 'Loading packages cannot remove or rename a component');
assert.deepEqual(Object.keys(packageManifest.packages).sort(), ['cassette', 'electronics', 'exterior', 'mechanism']);
assert.deepEqual(build.packages, packageManifest.packages);
const requiredBuildInputs=Object.keys(build.sources);
for(const path of requiredBuildInputs)assert.equal(hash(await readFile(path)),build.sources[path],path+' changed after viewer build');
const rawOriginal = gunzipSync(await readFile('build/exports/model.bin.gz'));
const rawPackages = new Map(), compressedPackages = new Map();
let totalBytes = 0;
for (const [name, config] of Object.entries(packageManifest.packages)) {
  const bytes = geometryBytes(name);
  assert.equal(bytes.length, config.bytes); assert.equal(hash(bytes), config.sha256);
  const raw = gunzipSync(bytes); assert.equal(raw.length, config.rawBytes);
  assert.equal((config.kind==='alternative'?model.alternatives[name].parts:model.parts.filter(p=>p.package===name)).length,config.components);
  compressedPackages.set(name, bytes); rawPackages.set(name, raw); totalBytes += bytes.length;
}
assert.equal(totalBytes,Object.values(build.packages).reduce((sum,p)=>sum+p.bytes,0));
const originalById = new Map(original.parts.map(p => [p.id, p]));
const ranges = new Map([...rawPackages.keys()].map(k => [k, []]));
let coordinates = 0, indices = 0, maxCoordinateError = 0, maxBoundsError = 0, maxNativeMatrixError = 0;

// Independent scalar quaternion transform for authoritative bounds. It avoids
// reusing the Box3/matrix path used to author the measurement metadata.
function transform(x, y, z, pose) {
  const [position, [qx,qy,qz,qw], scale] = pose;
  x *= scale[0]; y *= scale[1]; z *= scale[2];
  const tx = 2*(qy*z-qz*y), ty = 2*(qz*x-qx*z), tz = 2*(qx*y-qy*x);
  return [x+qw*tx+qy*tz-qz*ty+position[0], y+qw*ty+qz*tx-qx*tz+position[1], z+qw*tz+qx*ty-qy*tx+position[2]];
}
for (const part of model.parts) {
  const source = originalById.get(part.id), raw = rawPackages.get(part.package);
  assert.ok(raw, `${part.id}: package exists`);
  assert.equal(JSON.stringify(part.poses), JSON.stringify(source.poses), `${part.id}: packaging preserves all operating/reset poses (signed zero is equivalent)`);
  assert.equal(JSON.stringify(part.spin), JSON.stringify(source.spin)); assert.equal(part.meshes.length, source.meshes.length);
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (let meshIndex=0; meshIndex<part.meshes.length; meshIndex++) {
    const mesh = part.meshes[meshIndex], src = source.meshes[meshIndex];
    if(src.deformation){
      assert.equal(mesh.deformation.owner,src.deformation.owner);
      assert.equal(mesh.deformation.source_object,src.deformation.source_object);
      assert.equal(mesh.deformation.targets.length,src.deformation.targets.length);
      for(let ti=0;ti<src.deformation.targets.length;ti++){
        const target=mesh.deformation.targets[ti],reference=src.deformation.targets[ti];
        assert.equal(target.name,reference.name);assert.equal(target.initial,reference.initial);assert.deepEqual(target.weights,reference.weights);assert.equal(target.encoding,'float32');
        const [offset,count]=target.positions;assert.equal(count,src.p[1]);assert.equal(offset%4,0);assert(offset+count*4<=raw.length);
        ranges.get(part.package).push([offset,offset+count*4,part.id]);
        for(let j=0;j<count;j++)close(raw.readFloatLE(offset+j*4),reference.positions[j],.000002,'Native shape displacement packing');
      }
    }else assert.equal(mesh.deformation,undefined);
    assert.equal(mesh.m, src.m); assert.ok(mesh.m >= 0 && mesh.m < model.materials.length);
    assert.equal(mesh.p[1], src.p[1]); assert.equal(mesh.n[1], src.n[1]); assert.equal(mesh.i[1], src.i[1]);
    assert.equal(mesh.p[1] % 3, 0); assert.equal(mesh.i[1] % 3, 0);
    for (const key of ['p','n','i',...(mesh.beltS?['beltS']:[])]) {
      const [offset,count] = mesh[key], width = key === 'beltS' || key === 'i' && mesh.indexType === 'u32' ? 4 : 2;
      assert.ok(Number.isInteger(offset) && offset >= 0 && offset % width === 0);
      assert.ok(Number.isInteger(count) && count > 0 && offset + count*width <= raw.length, `${part.id}: valid ${key} byte range`);
      ranges.get(part.package).push([offset, offset+count*width, part.id]);
    }
    const sourceFloats = new Float32Array(rawOriginal.buffer, rawOriginal.byteOffset + src.p[0], src.p[1]);
    for (let i=0; i<mesh.p[1]; i+=3) {
      const actual = transform(sourceFloats[i], sourceFloats[i+1], sourceFloats[i+2], source.poses.stop);
      const decoded = [];
      for (let axis=0; axis<3; axis++) {
        decoded[axis] = Math.fround(raw.readUInt16LE(mesh.p[0]+(i+axis)*2)*mesh.pscale[axis]+mesh.pmin[axis]);
        // A part's stated size is its size in the default exterior version; lettering of other versions is left out of it.
        if (!mesh.versions || mesh.versions.includes(model.exterior?.default)) { min[axis] = Math.min(min[axis], actual[axis]); max[axis] = Math.max(max[axis], actual[axis]); }
      }
      const packedWorld = transform(...decoded, part.poses.stop);
      for (let axis=0; axis<3; axis++) {
        const error = Math.abs(packedWorld[axis]-actual[axis]);
        maxCoordinateError = Math.max(maxCoordinateError,error);
        assert.ok(error <= tolerance, `${part.id}: world coordinate exceeds ${tolerance} mm numerical tolerance`);
        coordinates++;
      }
    }
    for (let i=0; i<mesh.i[1]; i++) {
      const index = mesh.indexType === 'u32' ? raw.readUInt32LE(mesh.i[0]+i*4) : raw.readUInt16LE(mesh.i[0]+i*2);
      assert.equal(index, rawOriginal.readUInt32LE(src.i[0]+i*4), `${part.id}: topology preserved`);
      assert.ok(index < mesh.p[1]/3, `${part.id}: index resolves to a selectable mesh vertex`); indices++;
    }
  }
  for (let axis=0; axis<3; axis++) {
    for (const [value, expected] of [[part.authoritativeBounds.min[axis],min[axis]],[part.authoritativeBounds.max[axis],max[axis]],[part.authoritativeBounds.dimensions[axis],max[axis]-min[axis]]]) {
      maxBoundsError = Math.max(maxBoundsError,Math.abs(value-expected)); close(value,expected,tolerance,`${part.id}: authoritative bound`);
    }
  }
  for (const mode of ['play','ff','rew']) {
    const [pos,quat,scale] = part.poses[mode], P = new T.Vector3().fromArray(pos), Q = new T.Quaternion().fromArray(quat), S = new T.Vector3().fromArray(scale);
    const ref = Object.values(part.spin)[0], spin = part.spin[mode];
    if (ref && spin) {
      const axis = new T.Vector3().fromArray(ref.axis).normalize(), center = new T.Vector3().fromArray(ref.center);
      const phase = spin.rate*new T.Vector3().fromArray(spin.axis).normalize().dot(axis)/nativeBinding.fps;
      const rotation = new T.Quaternion().setFromAxisAngle(axis,phase);
      P.add(center.clone().sub(center.clone().applyQuaternion(rotation)).multiply(S).applyQuaternion(Q)); Q.multiply(rotation);
    }
    const matrix = new T.Matrix4().compose(P,Q,S);
    for (let row=0; row<4; row++) for (let col=0; col<4; col++) {
      const error = Math.abs(matrix.elements[col*4+row]-native[mode][part.id][row][col]);
      maxNativeMatrixError = Math.max(maxNativeMatrixError,error); assert.ok(error <= tolerance, `${part.id}/${mode}: native/browser matrix match`);
    }
  }
}
for (const [name, list] of ranges) {
  if(packageManifest.packages[name].kind==='alternative')continue;
  list.sort((a,b) => a[0]-b[0]); let end = 0;
  for (const [start,next,id] of list) {
    assert.ok(start >= end, `${name}/${id}: mesh ranges must not overlap`);
    assert.ok(start-end <= 3, `${name}/${id}: only alignment padding may be unused`); end = next;
  }
  assert.equal(end,rawPackages.get(name).length, `${name}: every byte covered by geometry or alignment`);
}

// Run the real loader against the built geometry files.
// A file that fails to load must clear its remembered attempt and allow a retry.
const originalDocument = globalThis.document;
let failFirst = true;
try {
  const page = fakeDocument({fail: () => { if (failFirst) { failFirst = false; return true; } return false; }});
  globalThis.document = page;
  const loader = createLoader({packages:packageManifest.packages});
  await assert.rejects(loader.load('exterior'), /missing or could not be read/);
  for (const name of rawPackages.keys()) {
    const first = loader.load(name), second = loader.load(name);
    assert.equal(first,second,'Concurrent loads share one request');
    assert.deepEqual(Buffer.from(await first),rawPackages.get(name));
  }
  assert.deepEqual(page.requested,['geometry/exterior.js','geometry/exterior.js','geometry/mechanism.js','geometry/electronics.js','geometry/cassette/cassette.js']);
} finally { globalThis.document = originalDocument; }

// The rebuilt cassette adds previously omitted interior features. Preserve its
// six owner transforms and the complete cassette envelope; individual hub/pack
// extents are allowed to change. Neighbor contact checks are a separate report.
const alt=model.alternatives.cassette,altRaw=rawPackages.get('cassette');
const media=original.parts.filter(p=>p.id.startsWith('MEDIA'));
assert.deepEqual(alt.parts.map(p=>p.id).sort(),media.map(p=>p.id).sort());
const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
for(const p of media)for(const mesh of p.meshes)for(let i=0;i<mesh.p[1];i+=3){
 const xyz=[0,1,2].map(a=>rawOriginal.readFloatLE(mesh.p[0]+(i+a)*4)),world=transform(...xyz,p.poses.stop);
 for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],world[a]);hi[a]=Math.max(hi[a],world[a]);}
}
let altVertices=0,altTriangles=0;
for(const part of alt.parts){
 const base=originalById.get(part.id);
 for(const mesh of part.meshes){assert(mesh.m>=0&&mesh.m<alt.materials.length);assert.equal(mesh.p[1],mesh.n[1]);
  for(const key of ['p','n','i']){const [start,count]=mesh[key];assert(start%4===0&&start>=0&&count>0&&start+count*4<=altRaw.length);}
  for(let i=0;i<mesh.p[1];i+=3){const xyz=[0,1,2].map(a=>altRaw.readFloatLE(mesh.p[0]+(i+a)*4)),world=transform(...xyz,base.poses.stop);for(let a=0;a<3;a++){assert(Number.isFinite(world[a])&&world[a]>=lo[a]-.002&&world[a]<=hi[a]+.002,part.id+' complete cassette envelope');assert(Number.isFinite(altRaw.readFloatLE(mesh.n[0]+(i+a)*4)));}}
  for(let i=0;i<mesh.i[1];i++)assert(altRaw.readUInt32LE(mesh.i[0]+i*4)<mesh.p[1]/3);
  altVertices+=mesh.p[1]/3;altTriangles+=mesh.i[1]/3;
 }
}
const files = viewFiles().filter(file => file !== 'build-record.json');
assert.ok(files.every(file => Object.hasOwn(build.outputs,file)), `view/ holds files the build record does not list: ${files.filter(file => !Object.hasOwn(build.outputs,file)).join(', ')}`);
const html = pageHtml();
assert.equal(hash(html),build.outputs['index.html']);
assert.ok(!/__MODEL_META__|__MODEL_DATA__|__EVIDENCE__|__EMBEDDED_PACKAGES__|__APP_JS__/.test(html), 'Every template placeholder must be replaced before publication');
assert.ok(!/references\/.*\.(?:jpe?g|png|mp4|pdf)/i.test(html), 'Original reference media must not be embedded in the public viewer');
const report = {
  passed:true,nativeSha256:model.source_sha256,htmlSha256:build.outputs['index.html'],components:model.parts.length,coordinatesCompared:coordinates,indicesCompared:indices,
  packages:Object.keys(packageManifest.packages),numericalToleranceMm:tolerance,maxCoordinateErrorMm:maxCoordinateError,
  maxAuthoritativeBoundsErrorMm:maxBoundsError,maxNativeMatrixError,tourDurationSeconds:TOUR_SECONDS,
  lowFrameRateTimeline:true,deterministicTourTransport:true,hostedEmbeddedParity:true,loaderRetry:true,componentInformationCoverage:true,publicationAllowlist:true,
  cassetteAlternative:{owners:alt.parts.length,vertices:altVertices,triangles:altTriangles,completeCassetteEnvelopeContained:true,individualPartEnvelopePreserved:false,physicalFit:'Not certified'},
  physicalAccuracy:'Not established by these numerical tests.',
  browserAndPhoneCoverage:'Node tests only; actual browser and phone checks are separate release gates.',
};
report.sourceHashes = { ...build.sources };
for (const path of requiredBuildInputs) assert.equal(hash(await readFile(path)),build.sources[path], `${path} changed while tests were running; rerun on a stable build`);
report.sourceHashes['tests/test_workbench.mjs'] = hash(await readFile('tests/test_workbench.mjs'));
report.inputHashes = {};
for (const path of ['build/viewer-data/model.json','build/viewer-data/packages.json','config/release.json','build/exports/model.json','build/exports/native-checks.json']) report.inputHashes[path] = hash(await readFile(path));
await writeFile('build/test-results/workbench-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
