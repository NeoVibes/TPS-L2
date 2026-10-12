// Exterior versions. The shells are shared; a lettering piece that only some versions show carries
// "versions" (for example ["intermediate", "early"]). A piece without it belongs to every version.
// Used by the page and by the build tools, so both agree on what each version shows.

/** True when this mesh entry is shown in the given version. */
export const shownIn = (mesh, version) => !mesh.versions || mesh.versions.includes(version);

/** A part's meshes as the default version shows them. */
export const defaultMeshes = (part, exterior) => exterior?.default ? part.meshes.filter(m => shownIn(m, exterior.default)) : part.meshes;

/**
 * The distinct states of a part across the versions. Versions that show the same meshes share a state.
 * Returns [] for a part that looks the same in every version; otherwise a list of
 * {name, versions, base, meshes}, where base marks the state that includes the default version and
 * name joins its versions with "+" (for example "intermediate+early").
 */
export function exteriorStates(part, exterior) {
  if (!exterior?.versions?.length || !part.meshes.some(m => m.versions)) return [];
  const states = [];
  for (const version of exterior.versions) {
    const key = part.meshes.map(m => shownIn(m, version) ? '1' : '0').join('');
    const state = states.find(s => s.key === key);
    if (state) state.versions.push(version); else states.push({key, versions: [version], meshes: part.meshes.filter(m => shownIn(m, version))});
  }
  return states.map(({key, ...s}) => ({...s, name: s.versions.join('+'), base: s.versions.includes(exterior.default)}));
}

/** The page data reduced to the default version: what a kit without exterior versions would hold. */
export function defaultExteriorMeta(meta) {
  if (!meta.exterior?.default) return meta;
  const strip = ({versions, piece, ...mesh}) => mesh;
  const parts = meta.parts.map(part => ({...part, meshes: defaultMeshes(part, meta.exterior).map(strip)}));
  const used = Math.max(...parts.flatMap(p => p.meshes.map(m => m.m)));
  const extra = meta.parts.flatMap(p => p.meshes.filter(m => !shownIn(m, meta.exterior.default))).reduce((n, m) => n + m.i[1] / 3, 0);
  const {exterior, ...rest} = meta;
  return {...rest, parts, materials: meta.materials.slice(0, used + 1), ...('triangles' in meta ? {triangles: meta.triangles - extra} : {})};
}
