import {BufferAttribute, BufferGeometry} from 'three';

// Invoke separately for each component owner. These chunks already share the
// same local coordinate system and rigid transform. Concatenation preserves
// every vertex, normal and triangle; no quantization or vertex welding occurs.
export function mergeOwnerGeometries(records, materials) {
  const explicitOwners = new Set(records.filter(r => r.ownerId !== undefined).map(r => r.ownerId));
  if (explicitOwners.size > 1) throw new Error('Geometry merge cannot cross component ownership');
  if (explicitOwners.size && records.some(r => r.ownerId === undefined)) throw new Error('Geometry merge requires consistent explicit ownership');
  const groups = new Map();
  const direct = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index], g = record.geometry, material = materials[record.materialIndex];
    if (!material) throw new Error('Missing material for owner geometry');
    const alpha = material.opacity ?? material.alpha ?? 1;
    const names = Object.keys(g.attributes).sort();
    const attributes = names.map(name => g.getAttribute(name));
    const count = g.index?.count ?? 0;
    // Transparent chunks stay independent: merging could change their depth
    // sorting. Preserve unusual geometry layouts and partial draw ranges too.
    const eligible = !g.userData.nativeDeformation && !g.userData.nativeArticulation && alpha >= .99 && !material.transparent && g.index && count % 3 === 0 &&
      g.getAttribute('position')?.itemSize === 3 && g.getAttribute('normal')?.itemSize === 3 &&
      !g.isInstancedBufferGeometry && g.groups.length === 0 && Object.keys(g.morphAttributes).length === 0 &&
      g.drawRange.start === 0 && (g.drawRange.count === Infinity || g.drawRange.count === count) &&
      attributes.every(a => !a.isInterleavedBufferAttribute && !a.isInstancedBufferAttribute && a.count === g.getAttribute('position').count);
    if (!eligible) { direct.push({...record, sourceChunkIndices:[index]}); continue; }
    const schema = names.map((name, i) => [name, attributes[i].array.constructor.name, attributes[i].itemSize,
      attributes[i].normalized, attributes[i].gpuType, attributes[i].usage].join(':')).join('|');
    const key = `${record.materialIndex}/${record.variant ?? ''}/${schema}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({record, index});
  }
  const result = [...direct];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push({...group[0].record, sourceChunkIndices:[group[0].index]});
      continue;
    }
    const first = group[0].record.geometry;
    const vertexCount = group.reduce((sum, {record}) => sum + record.geometry.getAttribute('position').count, 0);
    const indexCount = group.reduce((sum, {record}) => sum + record.geometry.index.count, 0);
    const merged = new BufferGeometry();
    for (const name of Object.keys(first.attributes)) {
      const original = first.getAttribute(name), values = new original.array.constructor(vertexCount * original.itemSize);
      let offset = 0;
      for (const {record} of group) {
        const source = record.geometry.getAttribute(name).array;
        values.set(source, offset); offset += source.length;
      }
      const attribute = new BufferAttribute(values, original.itemSize, original.normalized);
      attribute.setUsage(original.usage); attribute.gpuType = original.gpuType;
      merged.setAttribute(name, attribute);
    }
    const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let vertexOffset = 0, indexOffset = 0;
    for (const {record} of group) {
      const g = record.geometry, vertices = g.getAttribute('position').count;
      for (const index of g.index.array) {
        if (!Number.isInteger(index) || index < 0 || index >= vertices) throw new Error('Source triangle index outside its owner chunk');
        indices[indexOffset++] = index + vertexOffset;
      }
      vertexOffset += vertices;
    }
    merged.setIndex(new BufferAttribute(indices, 1));
    merged.computeBoundingSphere();
    result.push({...group[0].record, geometry:merged, sourceChunkIndices:group.map(item => item.index)});
  }
  // Maintain the order of each group's first occurrence for deterministic QA.
  return result.sort((a, b) => a.sourceChunkIndices[0] - b.sourceChunkIndices[0]);
}
