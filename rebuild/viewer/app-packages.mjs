// Loading the geometry files and turning them into meshes: the three groups of parts, and the
// detailed cassette that can stand in for the original one.
// It owns what has been loaded and the meshes it made. It is told what to do afterwards through
// onLoaded(name), onVariant() and onFailure(error); it does not reach into the rest of the viewer.
import * as T from "three";
import {makeCassetteMaterial, applyCassetteUV} from "./cassette-materials.mjs";
import {makeDriveMaterial} from "./drive-materials.mjs";
import {mergeOwnerGeometries} from "./owner-geometry.mjs";
import {createLoader} from "./loading.mjs";

const VARIANT_TEXT = { refined: "Detailed cassette · generated clear shell, spools and tape path", original: "Original cassette · plain shell and hubs from the Blender file" };

// Shape keys blend on the GPU as relative morph targets, so a frame only sets their weights (app-core.mjs). Each key
// also carries its change in computed normals. The native springs and packs take computed normals at rest too, as
// the CPU blend used to leave them; the generated cassette keeps its own. Bounds are the resting shape's: three.js
// would widen them to every key at full strength, which moves Focus part; keyed meshes are never culled instead.
function setShapeKeys(g, positions, deformation, raw, computedNormals) {
  const targets = deformation.targets.map((t) => {
    if (t.encoding !== "float32") throw Error("Unsupported native shape encoding");
    return { ...t, positions: new Float32Array(raw, ...t.positions) };
  });
  g.userData.nativeDeformation = { ...deformation, targets };
  g.morphTargetsRelative = true;
  g.morphAttributes.position = targets.map((t) => new T.BufferAttribute(t.positions, 3));
  const keyed = new T.BufferGeometry();
  keyed.setIndex(g.index);
  const normalsOf = (p) => { keyed.setAttribute("position", new T.BufferAttribute(p, 3)); keyed.computeVertexNormals(); return keyed.attributes.normal.array.slice(); };
  const base = normalsOf(positions);
  if (computedNormals) g.setAttribute("normal", new T.BufferAttribute(base, 3));
  g.morphAttributes.normal = targets.map((t) => {
    const n = normalsOf(Float32Array.from(positions, (v, j) => v + t.positions[j]));
    return new T.BufferAttribute(Float32Array.from(n, (v, j) => v - base[j]), 3);
  });
  const keys = g.morphAttributes;
  g.morphAttributes = {}; g.computeBoundingSphere(); g.computeBoundingBox(); g.morphAttributes = keys;
}

export function createPackages({ $, state, parts, stage, metrics, motionCueEnabled, onLoaded, onVariant, onFailure }) {
  const loaded = new Set(), promises = new Map(), draws = [];   // names loaded; loads in progress; every mesh made
  let queue = Promise.resolve(), loader = null, files = {};

  /** Says which geometry files exist. Called once, when the part list has been read. */
  function open(table) {
    files = table;
    loader = createLoader({ packages: table }, (text) => {
      if (state.graphicsUnavailable) return;
      $("loadingText").textContent = text;
      $("packageStatus").textContent = text;
      $("packageStatus").hidden = false;   // shown only while something is loading
    });
  }

  /** Loads one group of parts (exterior, mechanism, electronics) unless it is loaded or loading already. */
  async function ensure(name) {
    if (state.graphicsUnavailable) return;
    if (loaded.has(name)) return;
    if (promises.has(name)) return promises.get(name);
    const job = queue.catch(() => {
    }).then(async () => {
      if (state.graphicsUnavailable) return;
      const raw = await loader.load(name), { materials } = stage;
      if (state.graphicsUnavailable) return;
      for (const p of parts.filter((p2) => p2.data.package === name)) {
        const chunks = [];
        for (const mesh of p.data.meshes) {
          const g = new T.BufferGeometry();
          const source = new Uint16Array(raw, ...mesh.p), positions = new Float32Array(source.length);
          for (let j = 0; j < source.length; j++) positions[j] = source[j] * mesh.pscale[j % 3] + mesh.pmin[j % 3];
          g.setAttribute("position", new T.BufferAttribute(positions, 3));
          g.setAttribute("normal", new T.BufferAttribute(new Int16Array(raw, ...mesh.n), 3, true));
          g.setIndex(new T.BufferAttribute(mesh.indexType === "u16" ? new Uint16Array(raw, ...mesh.i) : new Uint32Array(raw, ...mesh.i), 1));
          if (mesh.beltS) g.setAttribute("beltS", new T.BufferAttribute(new Float32Array(raw, ...mesh.beltS), 1));
          g.computeBoundingSphere();
          if (mesh.articulation) g.userData.nativeArticulation = mesh.articulation;
          if (mesh.deformation) setShapeKeys(g, positions, mesh.deformation, raw, true);
          chunks.push({ geometry: g, materialIndex: mesh.m, ownerId: p.data.id, variant: mesh.versions?.join("+"), versions: mesh.versions });   // lettering of different exterior versions is never merged
        }
        const merged = mergeOwnerGeometries(chunks, materials), retained = new Set(merged.map((c) => c.geometry));
        for (const c of chunks) if (!retained.has(c.geometry)) c.geometry.dispose();
        for (const c of merged) {
          const m = new T.Mesh(c.geometry, materials[c.materialIndex]);
          m.userData = { part: p, materialIndex: c.materialIndex, variant: "original", versions: c.versions };
          if (c.geometry.morphAttributes.position) m.frustumCulled = false;   // a spring's keys can move it outside its resting bounds
          if (p.data.belt || p.data.motorWitness) {
            p.cueTravel ??= { value: 0 };
            m.userData.cueMaterials = [false, true].map((highlight) => makeDriveMaterial(materials[c.materialIndex], p.data, { highlight, enabled: motionCueEnabled, travel: p.cueTravel }));
            m.material = m.userData.cueMaterials[0];
          }
          p.group.add(m);
          draws.push(m);
        }
        p.loaded = true;
      }
      loaded.add(name);
      $("packageStatus").hidden = true;
      onLoaded(name);
    });
    queue = job;
    promises.set(name, job);
    job.catch((err) => {
      promises.delete(name);
      metrics.packageErrors.push(String(err));
      if (state.graphicsUnavailable) return;
      onFailure(err);
    });
    return job;
  }

  /** Loads the detailed cassette. */
  async function ensureCassette() {
    if (state.graphicsUnavailable) return;
    if (loaded.has("cassette")) return;
    if (promises.has("cassette")) return promises.get("cassette");
    const job = loader.load("cassette").then((raw) => {
      if (state.graphicsUnavailable) return;
      const { model, materials, highlightMaterials } = stage, alt = model.alternatives.cassette, offset = materials.length;
      for (const spec of alt.materials) {
        const material = makeCassetteMaterial(spec);
        materials.push(material);
        const h = material.clone();
        h.emissive.setRGB(0.045, 0.025, 3e-3);
        highlightMaterials.push(h);
      }
      for (const data of alt.parts) {
        const p = parts.find((p2) => p2.data.id === data.id);
        for (const mesh of data.meshes) {
          const g = new T.BufferGeometry();
          g.setAttribute("position", new T.BufferAttribute(new Float32Array(raw, ...mesh.p), 3));
          g.setAttribute("normal", new T.BufferAttribute(new Float32Array(raw, ...mesh.n), 3));
          g.setIndex(new T.BufferAttribute(new Uint32Array(raw, ...mesh.i), 1));
          g.computeBoundingSphere();
          if (mesh.deformation) setShapeKeys(g, g.attributes.position.array, mesh.deformation, raw, false);   // tape packs and ribbon
          applyCassetteUV(g, alt.materials[mesh.m], p.data.poses.stop);
          const m = new T.Mesh(g, materials[offset + mesh.m]);
          if (g.morphAttributes.position) m.frustumCulled = false;
          m.castShadow = (alt.materials[mesh.m].transmission || 0) === 0 && (alt.materials[mesh.m].alpha ?? 1) >= 0.99;
          m.receiveShadow = true;
          m.userData = { part: p, materialIndex: offset + mesh.m, variant: "refined" };
          p.group.add(m);
          draws.push(m);
        }
      }
      loaded.add("cassette");
      $("packageStatus").hidden = true;
      $("cassetteVariantStatus").textContent = VARIANT_TEXT[state.cassetteVariant];
      onLoaded("cassette");
    }).catch((err) => {
      promises.delete("cassette");
      $("packageStatus").hidden = true;
      $("cassetteVariantStatus").textContent = "Refinement unavailable; original geometry shown. Change the selection to retry.";
      metrics.packageErrors.push(String(err));
      if (state.graphicsUnavailable) return;
      throw err;
    });
    promises.set("cassette", job);
    return job;
  }

  /** Shows the detailed ("refined") or the original cassette. */
  function setCassetteVariant(value) {
    state.cassetteVariant = value;
    $("cassetteVariantStatus").textContent = VARIANT_TEXT[value];
    if (value === "refined") ensureCassette().catch(() => {
    });
    onVariant();
  }

  const ensureAll = () => Promise.allSettled([ensure("mechanism"), ensure("electronics")]);

  return { open, ensure, ensureCassette, ensureAll, setCassetteVariant, loaded, draws, get files() { return files; } };
}
