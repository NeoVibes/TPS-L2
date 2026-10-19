import {exteriorStates} from "./exterior.mjs";
// Public component fields and explicit service-catalog facts; no research annotations.
export function partSearchText(part){return [part.id,part.name,part.group,part.assembly,part.category].filter(Boolean).join(' ');}
export function copyTarget(id,location,extra=''){
 const host=String(location.hostname||'').toLowerCase();
 const local=location.protocol==='file:'||host==='localhost'||host.endsWith('.localhost')||host==='::1'||host==='[::1]'||/^127\./.test(host)||!['http:','https:'].includes(location.protocol);
 if(local)return {kind:'id',label:'Copy part ID',text:id};
 const url=new URL(location.pathname,location.origin);url.hash='part='+encodeURIComponent(id)+extra;   // extra carries the exterior version, when it is not the default
 return {kind:'link',label:'Copy part link',text:url.href};
}
export function assemblySearchEntries(contexts,query=''){return Object.entries(contexts||{}).filter(([,entry])=>entry.searchable&&[entry.label,entry.refNo,entry.partNumber].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()));}
export function serviceSearchEntries(catalog,query=''){
 const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 if(!words.length)return [];
 return catalog.filter(entry=>{const text=[entry.refNo,entry.schematicRefNo,entry.partNumber,entry.description,entry.variant,...entry.partIds].filter(Boolean).join(' ').toLowerCase();return words.every(word=>text.includes(word));});
}
// With a state (a row's variant, such as "later" or "intermediate+early"), entries that name another state of the part are left out.
export function serviceEntriesForPart(catalog,id,state=null){return catalog.filter(entry=>entry.partIds.includes(id)&&(state===null||!entry.partStates?.[id]||entry.partStates[id].includes(state)));}
export function serviceFields(entry){
 return [['Ref. No.',entry.refNo||'Not listed'],['Part No.',entry.partNumber||'Not listed'],['Description',entry.description],...(entry.schematicRefNo?[['Schematic ref.',entry.schematicRefNo]]:[]),['Variant',entry.variant==='both'?'Former and new':entry.variant]];
}
export function validateServiceCatalog(catalog,issuedIds){
 const issued=new Set(issuedIds),seen=new Set();
 for(const entry of catalog){
  if(!entry.id||seen.has(entry.id))throw Error('Missing or duplicate service catalog ID: '+entry.id);seen.add(entry.id);
  if(!entry.description||!entry.variant||!Array.isArray(entry.partIds))throw Error(entry.id+': missing service catalog fields');
  if(entry.refNo!==null&&typeof entry.refNo!=='string'||entry.partNumber!==null&&typeof entry.partNumber!=='string')throw Error(entry.id+': reference and part number must be strings or null');
  if(new Set(entry.partIds).size!==entry.partIds.length)throw Error(entry.id+': duplicate model membership');
  for(const id of entry.partIds)if(!issued.has(id))throw Error(entry.id+': unissued model ID '+id);
 }
 return true;
}


// Strip only this exact ID followed by a label separator; identifiers inside names stay intact.
export function displayName(part) {
 const name = String(part.name || '');
 if (!part.id || !name.startsWith(part.id)) return name;
 const tail = name.slice(part.id.length);
 return /^\s*[•·:—–-]\s*/.test(tail) ? tail.replace(/^\s*[•·:—–-]\s*/, '') : name;
}
export function finderResults(parts, catalog, query = '') {
 const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const services = serviceSearchEntries(catalog, query);
 const mapped = new Set(services.flatMap(entry => entry.partIds));
 const seen = new Set();
 const components = parts.filter(part => {
  const text = partSearchText(part).toLowerCase();
  if (seen.has(part.id) || !(mapped.has(part.id) || words.every(word => text.includes(word)))) return false;
  seen.add(part.id); return true;
 });
 return {components, services};
}

export const dimensionCaveat = "Estimated model extents; not physical measurements.";
export const referencePose = "Assembled/rest pose: stopped model, lid closed, cassette seated. Values do not follow explosion or animation.";
export function resolvePartDetails({part, meta, measured, rows, levels = [], exterior, cassette}) {
 const version = meta.exterior?.versions.includes(exterior) ? exterior : meta.exterior?.default;
 const states = exteriorStates(part, meta.exterior);
 const state = states.find(s => s.versions.includes(version));
 const hasDetailed = meta.alternatives?.cassette?.parts.some(p => p.id === part.id);
 const choice = cassette === 'refined' ? 'detailed' : cassette;
 const variant = part.is_cassette ? (choice === 'detailed' && hasDetailed ? 'detailed' : 'original') : state?.name || '';
 const record = (variant === 'detailed' ? measured.cassette_detailed : state && !state.base ? measured.exterior?.[state.versions[0]] : measured.parts)?.[part.id];
 const size = record?.size_mm;
 const dimensions = Array.isArray(size) && size.length === 3 && size.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) ? [size[0], size[2], size[1]] : null;
 const confirmation = rows.find(row => row.part_id === part.id && row.variant === variant) || null;
 return {part, variant, record, dimensions, confirmation, meaning: confirmation ? levels[Number(confirmation.confirmation_level)] || 'Unknown' : 'Unknown'};
}
export function formatDimensions(details, rounded = true) {
 return details.dimensions ? details.dimensions.map((n, i) => ['X', 'Y', 'Z'][i] + ' ' + (rounded ? n.toFixed(1) : String(n))).join(' × ') + ' mm' : 'Dimensions unavailable';
}
export function detailPrecision(details) {
 const variant = details.variant ? details.variant.replaceAll('+', ' + ') : 'Shared across exterior versions';
 return 'Variant: ' + variant + '. Basis: measured solid extents; assembly axes X/Y/Z (width/height/depth), converted once from native X/Z/Y. ' + referencePose + '\nStored precision: ' + formatDimensions(details, false);
}
export function formatPartDetails(details, services, target) {
 const entries = serviceEntriesForPart(services, details.part.id, details.variant);
 return [details.part.id + ' · ' + displayName(details.part),
  ...entries.map(entry => (entry.partIds.length > 1 ? 'Service item containing this component' : 'Service catalog mapping') + ': ' + serviceFields(entry).map(([label,value]) => label + ': ' + value).join(' · ')),
  ...(!entries.length ? ['Service mapping: Unknown'] : []),
  formatDimensions(details), dimensionCaveat, detailPrecision(details),
  'Confirmation level: ' + (details.confirmation?.confirmation_level ?? 'Unknown') + ' · ' + details.meaning,
  (target.kind === 'link' ? 'Component/exterior link: ' : 'Part ID: ') + target.text,
  ...(details.part.is_cassette ? ['The component/exterior link does not restore cassette choice. Cassette: ' + details.variant + '.'] : [])].join('\n');
}

export const partExplanations = {
 // Sony TPS-L2 service manual, printed pp. 3–4, “Direction of rotation”: motor → flywheel in FWD/FF/REW. config/model.json maps the can to the MNF-1600B assembly.
 'MTR-001': 'This metal can is one component of the MNF-1600B motor assembly. The motor supplies rotation to the belt-driven flywheel and transport drive in playback, fast forward and rewind.',
 // Sony TPS-L2 service manual, printed pp. 3–4: numbered drive sequence and belt path from motor to flywheel and onward to the selected reel drive.
 'MEC-011': 'The capstan flywheel receives the motor’s rotation through a belt. The drive path continues from this wheel to the pulleys and gears used by the selected transport mode.',
 // Sony TPS-L2 service manual, printed p. 8, “Pinch Roller Pressure Measurement”: playback contact diagram labels capstan and pinch roller.
 'BAY-052': 'The capstan is the rotating shaft at the tape path. During playback, the pinch roller presses toward it so the tape can be carried through the playing mechanism.',
 // Sony TPS-L2 service manual, printed p. 8, “Pinch Roller Pressure Measurement”: the roller contacts the capstan in playback and is pulled away for the pressure check.
 'BAY-061': 'The pinch roller presses the tape against the capstan during playback. This contact lets the rotating capstan move the tape past the playback head.',
 // Sony TPS-L2 service manual, printed pp. 10–12: playback-head azimuth adjustment and HP901 L/R connections to the preamplifiers. BAY-060 models the visible housing, not the complete internal head.
 'BAY-060': 'This is the visible housing of the playback-head assembly. The head reads the tape’s two recorded channels and feeds their signals to the playback amplifiers; the housing represents only part of that assembly.'
};
