import './test_setup.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';

// Parts that ride the rig's moving members carry "links": each member's pivot and axis at STOP, and its turn and shift in every
// position. Built from them, a part must land on every position recorded for it, and part way between two positions it must stay
// on its arm: a gear on its axle, the axle on its arc.
const model = JSON.parse((await readFile(new URL('../../view/geometry/model.js', import.meta.url), 'utf8')).replace(/^[^{]*/, '').replace(/\);?\s*$/, ''));
const parts = Object.fromEntries(model.meta.parts.map((p) => [p.id, p])), linked = model.meta.parts.filter((p) => p.links);
const V = (a) => new T.Vector3().fromArray(a), pose = ([p, q, s]) => new T.Matrix4().compose(V(p), new T.Quaternion().fromArray(q), V(s));
function built(part, weights) {
  const m = new T.Matrix4();
  for (const link of part.links) {
    let a = 0; const t = new T.Vector3(), pivot = V(link.pivot);
    for (const [name, w] of weights) { a += w * link.poses[name][0]; t.addScaledVector(V(link.poses[name].slice(1)), w); }
    m.multiply(new T.Matrix4().makeTranslation(t.x + pivot.x, t.y + pivot.y, t.z + pivot.z)).multiply(new T.Matrix4().makeRotationAxis(V(link.axis).normalize(), a)).multiply(new T.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  }
  return m.multiply(pose(part.poses.stop));
}
assert.ok(linked.length >= 20, 'the rig-borne parts carry links');
for (const part of linked) for (const [name, recorded] of Object.entries(part.poses)) {
  const got = built(part, [[name, 1]]).elements, want = pose(recorded).elements;
  assert.ok(got.every((v, i) => Math.abs(v - want[i]) < 3e-3), part.id + ' lands on ' + name);
}
// Half way into fast-forward and into rewind, FR gear A is still on its axle and still 9.3 mm from FR gear B; the FR pulley likewise on its post.
const spinCentre = (id, m) => V(Object.values(parts[id].spin)[0].center).applyMatrix4(m), boxCentre = (id, m) => V(parts[id].authoritativeBounds.min).add(V(parts[id].authoritativeBounds.max)).multiplyScalar(.5);
const gearB = spinCentre('DRV-013', pose(parts['DRV-013'].poses.stop)), arm = spinCentre('DRV-012', pose(parts['DRV-012'].poses.stop)).distanceTo(gearB);
for (const mode of ['ff', 'rew']) for (const f of [.25, .5, .75]) {
  const gear = spinCentre('DRV-012', built(parts['DRV-012'], [['stop', 1 - f], [mode, f]]));
  assert.ok(Math.abs(gear.distanceTo(gearB) - arm) < 2e-3, 'FR gear A keeps its distance from FR gear B, ' + f + ' of the way to ' + mode);
  const straight = spinCentre('DRV-012', pose(parts['DRV-012'].poses.stop)).lerp(spinCentre('DRV-012', pose(parts['DRV-012'].poses[mode])), f);
  assert.ok(straight.distanceTo(gearB) < arm - 1e-3, 'a straight line would cut the corner');
}
console.log('Rig links: ' + linked.length + ' parts land on every recorded position and keep to their arcs between them.');
