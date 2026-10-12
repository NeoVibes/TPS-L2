// The service-manual parts list (edit/service-manual-parts.csv) as the viewer's search catalogue.
// One row per part the manual names; "model_part_ids" says which model parts represent it. An ID may be
// followed by a state ("EXT-030/later") when only that state of the part is the manual's part: one of the
// two cassettes, or one exterior version's lettering.

/** Splits CSV text into rows of fields. Handles quoted fields with commas and doubled quotes. */
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Catalogue entries in the form the search and the part inspector use. */
export function parseServiceCatalog(csvText) {
  const [header, ...rows] = parseCsv(csvText), col = name => { const i = header.indexOf(name); if (i < 0) throw Error('service-manual-parts.csv has no "' + name + '" column'); return i; };
  const at = Object.fromEntries(['catalog_id', 'ref_no', 'part_no', 'description', 'model', 'category', 'printed_pages', 'model_part_ids', 'schematic_ref', 'viewer_context'].map(n => [n, col(n)]));
  return rows.map(r => {
    const entry = {id: r[at.catalog_id], refNo: r[at.ref_no] || null, partNumber: r[at.part_no] || null, description: r[at.description], variant: r[at.model], category: r[at.category],
      partIds: [], partStates: {}};
    for (const token of r[at.model_part_ids] ? r[at.model_part_ids].split(/\s+/) : []) {
      const [id, state] = token.split('/');
      if (!entry.partIds.includes(id)) entry.partIds.push(id);
      if (state) (entry.partStates[id] ||= []).push(state);
    }
    if (r[at.schematic_ref]) entry.schematicRefNo = r[at.schematic_ref];
    if (r[at.viewer_context]) entry.contextKey = r[at.viewer_context];
    return entry;
  });
}
