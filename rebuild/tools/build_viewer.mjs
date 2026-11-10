// Builds what people open: view/index.html and the data files in view/geometry/.
//
// geometryFiles() turns the Blender stages' working files into the data files; it needs build/exports/.
// pageFile() bundles the viewer source into index.html; it needs only viewer/ and config/.
// Both return file contents. tools/build.mjs decides where they go.
import {build, transform} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import path from 'node:path';
import * as T from 'three';
import {ROOT, hash, json, verifyExports, fileHash, serviceCatalog, viewerInputs, dependencyVersions, MUSIC} from './integrity.mjs';
import {validateServiceCatalog} from '../viewer/part-information.mjs';
import {defaultMeshes} from '../viewer/exterior.mjs';

const GEOMETRY_NOTE = 'Full detail; coordinate packing bounded to 0.002 mm';
const dataFile = (name, payload) => 'portableTapePlayerLoaded(' + JSON.stringify(name) + ',' + JSON.stringify(payload) + ');\n';

// The music ships as bare MPEG-1 Layer III frames: a tag (ID3, APE or the old end tag) can carry names, addresses
// or other identity, so the build refuses one. The duration comes from the encoder's Info frame (frames x 1152).
export function mp3Facts(bytes) {
  const text = (a, b) => bytes.subarray(a, b).toString('latin1');
  if (text(0, 3) === 'ID3' || text(bytes.length - 128, bytes.length - 125) === 'TAG' || bytes.includes('APETAGEX'))
    throw Error('edit/music: remove the tags from the MP3 (title, artist and the like) before building');
  const h = bytes.readUInt32BE(0);
  if (h >>> 21 !== 0x7ff || ((h >>> 19) & 3) !== 3 || ((h >>> 17) & 3) !== 1) throw Error('edit/music: the file must start with an MPEG-1 Layer III frame');
  const rate = [44100, 48000, 32000][(h >>> 10) & 3], channels = ((h >>> 6) & 3) === 3 ? 1 : 2, info = 4 + (channels === 1 ? 17 : 32);
  if (!rate || !['Xing', 'Info'].includes(text(info, info + 4)) || !(bytes.readUInt32BE(info + 4) & 1)) throw Error('edit/music: the first frame needs an Info frame with a frame count');
  return {sampleRate: rate, channels, durationSeconds: bytes.readUInt32BE(info + 8) * 1152 / rate};
}

/** The data files for view/geometry/, as [path inside view/, text] pairs, plus the part list they describe. */
export async function geometryFiles() {
  const writes = [];
  const {receipt, model: original, config} = await verifyExports();
  validateServiceCatalog(await serviceCatalog(), (await json('config/part-ids.json')).records.map(r => r.id));
  const meta = await json('build/exports/model-packed.json'), release = await json('config/release.json'), motion = await json('build/exports/motion.json');
  if (meta.fictional_serial?.value !== release.fictionalSerial || meta.fictional_serial.fictional !== true)
    throw Error('Fictional serial does not match native exports. Run npm run rebuild.');
  const fullDetail = gunzipSync(await readFile(path.join(ROOT, 'build/exports/model.bin.gz')));
  const packed = gunzipSync(await readFile(path.join(ROOT, 'build/exports/model-packed.bin.gz')));
  meta.inspectionContexts = config.inspectionContexts;

  // Each part's size in the assembled model, from the full-detail export.
  const groups = {exterior: [], mechanism: [], electronics: []};
  for (const part of meta.parts) {
    const source = original.parts.find(s => s.id === part.id), box = new T.Box3(), v = new T.Vector3();
    const rest = new T.Matrix4().compose(new T.Vector3().fromArray(source.poses.stop[0]), new T.Quaternion().fromArray(source.poses.stop[1]), new T.Vector3().fromArray(source.poses.stop[2]));
    for (const mesh of defaultMeshes(source, meta.exterior)) for (let i = 0; i < mesh.p[1]; i += 3)
      box.expandByPoint(v.set(fullDetail.readFloatLE(mesh.p[0] + i * 4), fullDetail.readFloatLE(mesh.p[0] + (i + 1) * 4), fullDetail.readFloatLE(mesh.p[0] + (i + 2) * 4)).applyMatrix4(rest));
    if (box.isEmpty()) throw Error(part.id + ': exported owner has no geometry; attach geometry or retire the owner.');
    part.authoritativeBounds = {min: box.min.toArray(), max: box.max.toArray(), dimensions: box.getSize(v).toArray(), units: 'mm', basis: 'Native full-detail export, assembled world axes'};
    if (!groups[part.package]) throw Error(part.id + ': unknown native loading package ' + part.package);
    groups[part.package].push(part);
  }

  // One geometry file per group of parts. Offsets in the part list are rewritten to point into it.
  const packages = {};
  for (const [name, parts] of Object.entries(groups)) {
    let length = 0; const chunks = [];
    const append = chunk => { const padding = (4 - length % 4) % 4; if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; } const offset = length; chunks.push(chunk); length += chunk.length; return offset; };
    for (const part of parts) for (const mesh of part.meshes) {
      for (const key of ['p', 'n', 'i', ...(mesh.beltS ? ['beltS'] : [])]) {
        const bytes = key === 'beltS' || key === 'i' && mesh.indexType === 'u32' ? 4 : 2, [offset, count] = mesh[key], chunk = packed.subarray(offset, offset + count * bytes);
        if (chunk.length !== count * bytes) throw Error(part.id + ': invalid geometry range');
        mesh[key] = [append(chunk), count];
      }
      if (mesh.deformation) {
        delete mesh.deformation.source_vertices;
        for (const target of mesh.deformation.targets) { const positions = Float32Array.from(target.positions); target.positions = [append(Buffer.from(positions.buffer)), positions.length]; target.encoding = 'float32'; }
      }
    }
    const compressed = gzipSync(Buffer.concat(chunks), {level: 6});
    packages[name] = {file: name + '.js', sha256: hash(compressed), bytes: compressed.length, rawBytes: length, components: parts.length, detail: GEOMETRY_NOTE};
    writes.push(['geometry/' + name + '.js', dataFile(name, compressed.toString('base64'))]);
  }

  // The generated cassette has its own working files and its own geometry file.
  const cassette = await json('build/exports/cassette/manifest.json'), cassetteBytes = await readFile(path.join(ROOT, 'build/exports/cassette/geometry.bin.gz'));
  if (cassette.native.sha256 !== meta.source_sha256 || hash(cassetteBytes) !== cassette.geometry.sha256 || cassette.config_sha256 !== receipt.inputs['config/model.json'] || cassette.parameter_sha256 !== await fileHash('build/exports/cassette/parameters.json'))
    throw Error('Cassette alternative has stale source bindings. Run npm run rebuild.');
  meta.alternatives = {cassette: {id: cassette.alternate_id, label: cassette.label, status: cassette.classification, parts: cassette.parts, materials: cassette.materials, limitations: cassette.limitations, parameterSha256: cassette.parameter_sha256, baselineMetadataSha256: cassette.baseline_metadata_sha256}};
  packages.cassette = {kind: 'alternative', file: 'cassette/cassette.js', sha256: hash(cassetteBytes), bytes: cassetteBytes.length, rawBytes: cassette.geometry.uncompressed_bytes, components: cassette.parts.length, detail: 'Generic cassette visual alternative; original geometry stays selectable'};
  writes.push(['geometry/cassette/cassette.js', dataFile('cassette', cassetteBytes.toString('base64'))]);

  // The music, loaded only when sound is enabled with it selected. Gzip barely changes an MP3, but lets it use the same loader.
  const mp3 = await readFile(path.join(ROOT, MUSIC)), music = gzipSync(mp3, {level: 6}), musicConfig = (await json('config/model.json')).viewer.music;
  meta.music = {title: musicConfig.title, file: musicConfig.file, type: 'audio/mpeg', sha256: hash(music), bytes: music.length, rawBytes: mp3.length, ...mp3Facts(mp3)};
  writes.push(['geometry/' + musicConfig.file, dataFile('music', music.toString('base64'))]);

  // The part list, the table of geometry files, and the control ranges and moving parts sampled from the Blender file.
  // "measured" is what Blender measured on the model: each part's size and solidity, and the quantities the targets
  // are checked against. It travels with the geometry so the parts list and the checks can be redone without Blender.
  const strip = report => { const {native_sha256, ...rest} = report; return rest; };
  const partMeasurements = await json('build/exports/part-measurements.json');
  const measured = {parts: partMeasurements.parts, exterior: partMeasurements.exterior || {}, cassette_detailed: (await json('build/exports/cassette/part-measurements.json')).parts,
    targets: strip(await json('build/exports/target-measurements.json')), accessories: meta.inventory.accessoryIds};
  writes.push(['geometry/model.js', dataFile('model', {meta, packages, motion: {controls: motion.controls, active_owner_ids: motion.active_owner_ids}, measured})]);

  return {writes, meta, packages};
}

/** view/index.html: the viewer source bundled into one script inside the template. */
export async function pageFile({masterParts = '', levels = []} = {}) {
  const release = await json('config/release.json');
  const bundle = await build({absWorkingDir: ROOT, entryPoints: ['viewer/app.js'], bundle: true, write: false, metafile: true, format: 'iife', minify: true, loader: {'.csv': 'text'}, target: ['safari17', 'chrome120', 'firefox120'], legalComments: 'inline'});
  const bundlerInputs = Object.fromEntries(await Promise.all(Object.entries(bundle.metafile.inputs).map(async ([p, details]) => [p, {bytes: details.bytes, sha256: await fileHash(p), kind: p.startsWith('node_modules/') ? 'locked installed dependency' : 'kit source'}])));
  const app = bundle.outputFiles[0].text, template = await readFile(path.join(ROOT, 'viewer/page.html'), 'utf8');
  const styles = (await transform(await readFile(path.join(ROOT, 'viewer/page.css'), 'utf8'), {loader: 'css', minify: true})).code.trim();
  const escapeHTML = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  // Scripts may come from the page itself and from its own folder (the data files); nothing may be fetched.
  const policy = "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  const title = 'Sony TPS-L2 — Interactive Walkman Reconstruction';
  const description = 'Explore an estimated Sony TPS-L2 Walkman reconstruction: operate the transport, browse every component, and inspect model dimensions and confirmation levels.';
  const publicUrl = release.publicUrl ? new URL(release.publicUrl) : null;
  if (publicUrl && !['https:', 'http:'].includes(publicUrl.protocol)) throw Error('publicUrl must use HTTP or HTTPS');
  const sharing = [['og:type','website'],['og:title',title],['og:description',description],
    ...(publicUrl ? [['og:url',publicUrl.href],['og:image',new URL('social-preview.png',publicUrl).href],['og:image:width','1200'],['og:image:height','630'],['og:image:alt','Estimated blue and silver Sony TPS-L2 reconstruction, shown assembled on a light background.']] : [])]
    .map(([property,content]) => '<meta property="' + property + '" content="' + escapeHTML(content) + '">').join('\n');
  const html = template.replace('__SHARING_METADATA__', () => sharing).replace('__STYLES__', () => styles).replace('__CONTENT_POLICY__', () => policy).replace('__STATEMENT__', () => escapeHTML(release.statement)).replace('__SERIAL_NOTICE__', () => escapeHTML(release.serialNotice)).replaceAll('__RELEASE_VERSION__', () => escapeHTML(release.version)).replace('__MASTER_PARTS__', () => JSON.stringify({csv: masterParts, levels, repository: release.repository || '', exteriors: release.exteriors || [], exteriorNote: release.exteriorNote || ''}).replaceAll('<', '\\u003c'))
    .replace('__APP_JS__', () => app.replaceAll('</script', '<\\/script'));

  const dependencies = Object.fromEntries(Object.entries(await dependencyVersions()).map(([name, v]) => [name, v.installed]));
  const themeInit = await readFile(path.join(ROOT, 'viewer/theme-init.js'), 'utf8');
  return {html, assets: {'theme-init.js': themeInit, 'social-preview.png': await readFile(path.join(ROOT, 'viewer/social-preview.png'))}, inputs: await viewerInputs(), dependencies};
}
