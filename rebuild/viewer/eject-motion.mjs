// Typed, native-derived rigid motion. The concealed STOP contact and retained
// raised state remain explicit exhibit assumptions, not a force simulation.
export function ejectTravel(state) {
  if (['exploded','catalog'].includes(state.view) || state.explode > 0 || state.radial > 0 || !state.door) return 0;
  if (state.media === 'ejected') return 1;
  return state.stopCycle?.kind === 'eject' ? state.stopTravel || 0 : 0;
}
export function cassetteLift(contact, travel) {
  if (!contact) return 0;
  const a = contact.angle * travel, dx = contact.point[0] - contact.pivot[0], dz = contact.point[2] - contact.pivot[2];
  return Math.max(0, contact.pivot[2] - dx * Math.sin(a) + dz * Math.cos(a) - contact.cassetteBottom);
}
export function applyArticulation(mesh, spec, travel) {
  const [x,y,z] = spec.axis, angle = spec.angle * travel, half = angle/2, s = Math.sin(half);
  mesh.quaternion.set(x*s,y*s,z*s,Math.cos(half));
  mesh.position.fromArray(spec.pivot).applyQuaternion(mesh.quaternion).negate();
  mesh.position.x += spec.pivot[0]; mesh.position.y += spec.pivot[1]; mesh.position.z += spec.pivot[2];
}
