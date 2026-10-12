import config from '../config/model.json' with {type:'json'};
import { Vector3, Quaternion } from 'three';

// These are the three independent export roots carried by the native lid.
// HINGE-010 is the stationary shaft; its placement must not follow the lid.
export const DOOR_PART_IDS = Object.freeze(config.roles.door);
export const BATTERY_DOOR_PART_IDS = Object.freeze(config.roles.batteryDoor);

export function createDoorMotion(part, { toleranceMm = .002, battery = false } = {}) {
  if (!(battery ? BATTERY_DOOR_PART_IDS : DOOR_PART_IDS).includes(part.id)) return null;
  const stop = part.poses.stop, open = part.poses[battery ? 'battery_open' : 'open'];
  // Float32 native constraint decomposition can differ by one ULP at another
  // angle. Accept that rounding only; a real scale change is not hinge motion.
  if (stop[2].some((scale, i) => Math.abs(scale - open[2][i]) > 1e-6 * Math.max(1, Math.abs(scale)))) throw new Error(`${part.id}: door scale changes between exported poses`);
  const closedPosition = new Vector3().fromArray(stop[0]);
  const closedQuaternion = new Quaternion().fromArray(stop[1]).normalize();
  const inverseClosedQuaternion = closedQuaternion.clone().invert();
  const openQuaternion = new Quaternion().fromArray(open[1]).normalize();
  const rotation = openQuaternion.clone().multiply(inverseClosedQuaternion).normalize();
  if (rotation.w < 0) rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
  const sineHalf = Math.hypot(rotation.x, rotation.y, rotation.z);
  if (sineHalf < 1e-8) throw new Error(`${part.id}: cannot recover a hinge from coincident orientations`);
  const axis = new Vector3(rotation.x, rotation.y, rotation.z).divideScalar(sineHalf);
  const translation = new Vector3().fromArray(open[0]).sub(closedPosition.clone().applyQuaternion(rotation));
  const axialTranslation = translation.dot(axis);
  if (Math.abs(axialTranslation) > toleranceMm) throw new Error(`${part.id}: exported door has axial motion, not a fixed hinge`);

  // Solve (I - R) c = t on the plane normal to the rotation axis. The free
  // coordinate along the hinge is set to zero (the closest point to origin).
  // No new physical axis or geometry is guessed: it is recovered from the two
  // existing native-export transforms, then checked against their endpoints.
  const perpendicular = translation.clone().addScaledVector(axis, -axialTranslation);
  const pivot = perpendicular.clone().add(new Vector3().crossVectors(axis, perpendicular).multiplyScalar(rotation.w / sineHalf)).multiplyScalar(.5);
  const motion = { partId: part.id, pivot, axis, angle: 2 * Math.atan2(sineHalf, rotation.w), closedPosition, closedQuaternion, inverseClosedQuaternion, openQuaternion, axialTranslation };
  motion.endpointResidualMm = applyHingePose(motion, openQuaternion).distanceTo(new Vector3().fromArray(open[0]));
  if (motion.endpointResidualMm > toleranceMm) throw new Error(`${part.id}: recovered hinge fails exported endpoint tolerance`);
  return motion;
}

// Keep the viewer's smoothly interpolated orientation, but evaluate translation
// on the corresponding circular path. This works for opening, closing, and
// reversals partway through motion; independently lerping translation does not.
export function applyHingePose(motion, quaternion, position = new Vector3()) {
  const relative = quaternion.clone().normalize().multiply(motion.inverseClosedQuaternion);
  return position.copy(motion.closedPosition).sub(motion.pivot).applyQuaternion(relative).add(motion.pivot);
}
