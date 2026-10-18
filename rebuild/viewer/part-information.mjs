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
