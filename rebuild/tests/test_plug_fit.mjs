// The plug-in states against the fit and cord rules, on the exported model: every state, 11 steps of each insertion,
// and the six combinations of the two accessories. Contact: within 0.002 mm. A socket spring (or the DC plug's
// centre band on its pin) may press up to 0.05 mm into what it rides on. Everything else: at least 0.01 mm apart.
// Cords: the whole length within 0.5%, the moving end bending no tighter than 3 x the cord's width.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Vector3 as V, Quaternion, Matrix4, Box3} from 'three';
import {tri, tree, pair} from './wiring_geometry.mjs';
import {interpolateSamples} from '../viewer/model-controls.mjs';
import config from '../config/model.json' with {type: 'json'};

const model = JSON.parse(readFileSync('build/exports/model.json')), raw = gunzipSync(readFileSync('build/exports/model.bin.gz'));
const parts = new Map(model.parts.map(p => [p.id, p])), PLUGS = config.accessories.plugs;
const METAL = /tin|solder|copper|brass|plated|plating|phosphor|steel|metal|bronze|zinc|eyelet|terminal|contact|\blead|conductor|blade|nickel|bright/i;
// What each plug meets on purpose: where it comes to rest, and which of its contacts each socket spring presses on
// (the headphone plug's tip and ring by how far they reach in; the DC plug's centre band, its one metal inside).
const SOCKETS = {
  headphones: {A: {stop: 'JCK-11', springs: {tip: 'JCK-21', ring: 'JCK-22'}}, B: {stop: 'JCK-12', springs: {tip: 'JCK-23', ring: 'JCK-24'}}},
  adapter: {'DC IN': {stop: 'JCK-03', springs: {centre: 'JCK-13'}}},
};
const SPRINGS = ['JCK-21', 'JCK-22', 'JCK-23', 'JCK-24'], STEPS = Array.from({length: 11}, (_, i) => i / 10);

/** A part's chunks in the model frame, placed (default: at rest) and with its shape keys at the plug states. */
function chunks(id, place, plugs) {
  const p = parts.get(id), [t, q, s] = place || p.poses.stop, m = new Matrix4().compose(new V(...t), new Quaternion(...q), new V(...s)), out = [];
  for (const chunk of p.meshes) {
    if (chunk.versions) continue;   // lettering that only some exterior versions show
    const pos = new Float32Array(raw.buffer, raw.byteOffset + chunk.p[0], chunk.p[1]), ids = new Uint32Array(raw.buffer, raw.byteOffset + chunk.i[0], chunk.i[1]);
    const targets = chunk.deformation?.targets || [];
    const weights = targets.map(target => { const plug = target.plug, motion = plug && plugs?.[plug.accessory];
      return plug && motion?.shown === plug.state ? interpolateSamples(plug.samples, motion.insertion, 'weight') - target.initial : 0; });
    const points = [];
    for (let j = 0; j < pos.length; j += 3) points.push(new V(...[0, 1, 2].map(d => targets.reduce((v, target, k) => v + target.positions[j + d] * weights[k], pos[j + d]))).applyMatrix4(m));
    out.push({id, chunk, points, ids, metal: METAL.test(model.materials[chunk.m].name)});
  }
  return out;
}
const treeOf = (list, keep = () => true) => { const ts = []; for (const c of list) for (let j = 0; j < c.ids.length; j += 3) if (keep(c.ids[j], c.ids[j + 1], c.ids[j + 2])) ts.push(tri([c.points[c.ids[j]], c.points[c.ids[j + 1]], c.points[c.ids[j + 2]]])); return ts.length ? tree(ts) : null; };
const near = (a, b, e) => a.min.x <= b.max.x + e && b.min.x <= a.max.x + e && a.min.y <= b.max.y + e && b.min.y <= a.max.y + e && a.min.z <= b.max.z + e && b.min.z <= a.max.z + e;
const ids = assembly => model.parts.filter(p => p.assembly === assembly).map(p => p.id);
const placed = (id, state, t) => { const ends = parts.get(id).plugPoses?.[state]; if (!ends) return null; const [a, b] = ends; return [a[0].map((x, i) => x + (b[0][i] - x) * t), b[1], b[2]]; };
// How deep one body's vertices lie inside another closed one (ray parity, three rays), as the geometry audit measures.
const DIRS = [new V(.5773, .5774, .5775), new V(-.3127, .8461, .4316), new V(.7071, -.2093, -.6754)].map(d => d.normalize());
function hits(o, d, t) { const e1 = t.pts[1].clone().sub(t.pts[0]), e2 = t.pts[2].clone().sub(t.pts[0]), p = d.clone().cross(e2), det = e1.dot(p);
  if (Math.abs(det) < 1e-12) return false; const s = o.clone().sub(t.pts[0]), u = s.dot(p) / det; if (u < 0 || u > 1) return false;
  const q = s.cross(e1), v = d.dot(q) / det; if (v < 0 || u + v > 1) return false; return e2.dot(q) / det > 1e-9; }
function closest(p, t) {   // the nearest point of a triangle (Ericson, Real-Time Collision Detection 5.1.5)
  const [a, b, c] = t.pts, ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a), d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = p.clone().sub(b), d3 = ab.dot(bp), d4 = ac.dot(bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().addScaledVector(ab, d1 / (d1 - d3));
  const cp = p.clone().sub(c), d5 = ab.dot(cp), d6 = ac.dot(cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc); return a.clone().addScaledVector(ab, vb * den).addScaledVector(ac, vc * den); }
const flat = n => n.ts ? n.ts : [...flat(n.l), ...flat(n.r)];
function depthInto(points, body) {   // body: a closed tree
  const ts = flat(body), box = body.box; let deepest = 0;
  for (const p of points) {
    if (p.x < box.min.x || p.x > box.max.x || p.y < box.min.y || p.y > box.max.y || p.z < box.min.z || p.z > box.max.z) continue;
    if (DIRS.filter(d => ts.filter(t => hits(p, d, t)).length % 2).length < 2) continue;
    deepest = Math.max(deepest, Math.min(...ts.map(t => p.distanceTo(closest(p, t)))));
  }
  return deepest;
}
const depth = (a, b) => Math.max(depthInto(a.points, b.tree), depthInto(b.points, a.tree));
const radii = P => P.slice(1, -1).map((b, i) => { const a = P[i], c = P[i + 2], area = new V().subVectors(b, a).cross(new V().subVectors(c, a)).length() / 2; return area > 1e-12 ? b.distanceTo(a) * c.distanceTo(b) * a.distanceTo(c) / (4 * area) : Infinity; });

// The player at rest: each part's box now, its triangles when something comes near. The socket springs move.
const player = model.parts.filter(p => !config.accessories.assemblies.includes(p.assembly) && !p.is_cassette).map(p => p.id).filter(id => !SPRINGS.includes(id));
const boxes = new Map(player.map(id => [id, chunks(id).reduce((b, c) => { for (const p of c.points) b.expandByPoint(p); return b; }, new Box3())]));
const trees = new Map(), still = id => { if (!trees.has(id)) trees.set(id, treeOf(chunks(id))); return trees.get(id); };
const around = (box, e) => player.filter(id => !boxes.get(id).isEmpty() && near(box, boxes.get(id), e));
const failures = [], cords = {}; let checks = 0, deepest = 0;
const fail = (...what) => failures.push(what.join(' '));

for (const [key, plug] of Object.entries(PLUGS)) {
  const own = ids(plug.assembly), cord = model.plugs[key].cord;
  for (const state of Object.keys(plug.states)) {
    const plan = SOCKETS[key][state], moved = own.filter(id => { const [a, b] = parts.get(id).plugPoses[state]; return a[0].some((x, i) => Math.abs(x - b[0][i]) > 1e-6); });
    const slide = new V(...placed(moved[0], state, 1)[0]).sub(new V(...placed(moved[0], state, 0)[0])).normalize();
    let restTail = null;
    for (const t of STEPS) {
      const plugs = {[key]: {shown: state, insertion: t}};
      const plugChunks = moved.flatMap(id => chunks(id, placed(id, state, t), plugs));
      // which plug contact each spring presses on
      const metal = plugChunks.filter(c => c.metal).map(c => ({c, reach: Math.max(...c.points.map(p => p.dot(slide)))})).sort((a, b) => b.reach - a.reach);
      const role = {tip: metal[0]?.c, ring: metal[1]?.c, centre: plugChunks.find(c => c.metal && c.id === moved.at(-1))};
      // the cord's moving end, its ring centres in native order; it joins the rest of the cord at its first ring
      const cordChunks = chunks(cord.part, placed(cord.part, state, t), plugs), endAt = cordChunks.findIndex(c => c.chunk.deformation), end = cordChunks[endAt];
      const source = end.chunk.deformation.source_vertices, ringOf = i => Math.floor(source[i] / cord.sides);
      const centres = (c) => { const r = new Map(); source.forEach((v, i) => { const k = Math.floor(v / cord.sides); if (!r.has(k)) r.set(k, new Map()); r.get(k).set(v, c.points[i]); });
        return [...r.keys()].sort((a, b) => a - b).map(k => { const pts = [...r.get(k).values()]; return pts.reduce((s, p) => s.add(p), new V()).multiplyScalar(1 / pts.length); }); };
      const C = centres(end), length = C.slice(1).reduce((s, c, i) => s + c.distanceTo(C[i]), 0);
      const ring3 = end.points.filter((p, i) => ringOf(i) === 3), width = Math.max(...ring3.flatMap(a => ring3.map(b => a.distanceTo(b))));
      if (restTail === null) { const U = centres(chunks(cord.part)[endAt]); restTail = U.slice(1).reduce((s, c, i) => s + c.distanceTo(U[i]), 0); }
      const bend = Math.min(...radii(C.slice(1)));
      if (Math.abs(length - restTail) > .005 * cord.lengthMm) fail(key, state, t, 'cord length changes', (length - restTail).toFixed(3));
      if (bend < 3 * width) fail(key, state, t, 'cord bends', bend.toFixed(2), 'tighter than', (3 * width).toFixed(2));
      (cords[key + '/' + state] ||= []).push({t, lengthChangeMm: +(length - restTail).toFixed(3), tightestBendMm: +bend.toFixed(2)});
      // what the moving parts may meet: the player nearby, the socket springs as the plug deflects them, the
      // accessory's own resting parts, and the rest of the cord (not where the end joins it)
      const bodies = [...plugChunks.map(c => ({name: c.id, c, tree: treeOf([c])})), {name: cord.part + ' end', c: end, tree: treeOf([end], (a, b, c) => [a, b, c].every(i => ringOf(i) >= 2))}];
      const springChunks = new Map(SPRINGS.map(id => [id, chunks(id, null, plugs)])), springs = new Map([...springChunks].map(([id, c]) => [id, treeOf(c)]));
      const pointsOf = id => springChunks.has(id) ? springChunks.get(id).flatMap(c => c.points) : chunks(id).flatMap(c => c.points);
      const resting = new Map(own.filter(id => !moved.includes(id)).map(id => [id, treeOf(chunks(id, placed(id, state, t), plugs).filter(c => c !== cordChunks[endAt] && !(id === cord.part && c.chunk.deformation)))]));
      for (const b of bodies) {
        if (!b.tree) continue;
        const near_ = [...around(b.tree.box, .05).map(id => [id, still(id)]), ...springs, ...resting].filter(([, o]) => o && near(b.tree.box, o.box, .05));
        for (const [id, other] of near_) {
          checks++;
          const presses = Object.entries(plan.springs).find(([r, s]) => s === id && role[r] === b.c)?.[0];
          if (presses || (SPRINGS.includes(id) && t < 1)) {   // a spring on its contact, or riding over the travelling plug
            const d = pair(b.tree, other, .002) ? depth({points: b.c.points, tree: b.tree}, {points: pointsOf(id), tree: other}) : 0;
            deepest = Math.max(deepest, d); if (d > .05) fail(key, state, t, b.name, 'presses', d.toFixed(4), 'mm into', id);
            if (presses && t === 1 && !pair(b.tree, other, .002)) fail(key, state, 'seated:', b.name, presses, 'does not touch', id);
            continue;
          }
          if (id === plan.stop && t === 1 && pair(b.tree, other, .002)) {   // resting on its stop
            const d = depth({points: b.c.points, tree: b.tree}, {points: pointsOf(id), tree: other}); if (d > .002) fail(key, state, 'seated:', b.name, 'goes', d.toFixed(4), 'mm into its stop', id);
            continue;
          }
          if (pair(b.tree, other, .01)) fail(key, state, t, b.name, 'within 0.01 of', id);
        }
      }
      if (t === 1 && !bodies.some(b => b.tree && pair(b.tree, still(plan.stop), .002))) fail(key, state, 'seated: the plug does not reach its stop', plan.stop);
    }
  }
}
// The six combinations: the two accessories wherever their states put them, clear of each other and of the player.
const [hpKey, dcKey] = Object.keys(PLUGS), sockets = new Set(Object.values(SOCKETS).flatMap(s => Object.values(s).flatMap(x => [x.stop, ...Object.values(x.springs)])));
for (const hs of ['out', ...Object.keys(PLUGS[hpKey].states)]) for (const ds of ['out', ...Object.keys(PLUGS[dcKey].states)]) {
  const plugs = {[hpKey]: {shown: hs, insertion: 1}, [dcKey]: {shown: ds, insertion: 1}};
  const sets = [[hpKey, hs], [dcKey, ds]].map(([key, state]) => ids(PLUGS[key].assembly).map(id => ({id, tree: treeOf(chunks(id, state === 'out' ? null : placed(id, state, 1), plugs))})).filter(x => x.tree));
  for (const a of sets[0]) for (const b of sets[1]) if (near(a.tree.box, b.tree.box, .01) && pair(a.tree, b.tree, .01)) fail('combination', hs, ds, a.id, 'within 0.01 of', b.id);
  for (const a of sets.flat()) for (const id of around(a.tree.box, .01)) if (!sockets.has(id) && still(id) && pair(a.tree, still(id), .01)) fail('combination', hs, ds, a.id, 'within 0.01 of', id);
}
writeFileSync('build/test-results/plug-fit-tests.json', JSON.stringify({passed: !failures.length, failures, pairChecks: checks, deepestSpringPressMm: +deepest.toFixed(4), cords,
  rules: {contactMm: .002, springPressMm: .05, clearanceMm: .01, cordLength: '0.5% of the whole cord', cordBend: '3 x the cord width'}, steps: STEPS.length}, null, 1) + '\n');
assert.deepEqual(failures, []);
console.log('PLUG FIT PASS', checks, 'pair checks');
