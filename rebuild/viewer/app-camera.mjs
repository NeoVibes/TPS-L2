// Camera movement: gliding to a new viewpoint, preset angles, fitting the exploded view, control
// close-ups, switching projection, and the clip range and render resolution.
// It is given the camera to move (through "stage") and owns the glide in progress.
import config from "../config/model.json" with { type: "json" };
import * as T from "three";

const V = (a) => new T.Vector3().fromArray(a), clamp = T.MathUtils.clamp;

/** Sets near and far planes so thin layers stay apart at the current viewing distance. */
export function updateClipRange(camera, target) {
  const distance = camera.position.distanceTo(target), near = camera.isOrthographicCamera ? 0.1 : clamp(distance * 0.1, 0.25, 200), far = Math.max(2e3, distance + 2e3);
  if (Math.abs(camera.near - near) > near * 1e-3 || Math.abs(camera.far - far) > far * 1e-3) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}
/** The device pixel ratio to render at: never above 2, and never more than 2.5 million pixels. */
export function renderPixelRatio(width, height, dpr) {
  return Math.min(dpr, 2, Math.sqrt(25e5 / Math.max(1, width * height)));
}

// layout() gives the exploded-view layout once it exists; replaceCamera(camera) hands a new camera to the scene.
export function createCamera({ $, state, parts, stage, layout, invalidate, reducedMotion, replaceCamera }) {
  let tween = null;   // the glide in progress, if any

  function to(target, pos, duration = 0.85) {
    const { camera, orbit } = stage;
    invalidate();
    if (camera.isOrthographicCamera) {
      const extent = V(pos).distanceTo(V(target)) * Math.tan(16 * Math.PI / 180);
      camera.top = extent;
      camera.bottom = -extent;
      camera.left = -extent * camera.aspect;
      camera.right = extent * camera.aspect;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
    }
    if (reducedMotion.matches) {
      camera.position.copy(V(pos));
      orbit.target.copy(V(target));
      tween = null;
      return;
    }
    tween = { start: camera.position.clone(), end: V(pos), from: orbit.target.clone(), to: V(target), t: 0, duration };
  }

  function setProjection(value) {
    let { camera, orbit } = stage;
    if (!camera) return;
    state.projection = value;
    const old = camera;
    if (tween) {
      old.position.copy(tween.end);
      orbit.target.copy(tween.to);
      tween = null;
      orbit.update();
    }
    const aspect = old.aspect || 1;
    const distance = old.position.distanceTo(orbit.target);
    const extent = distance * Math.tan(16 * Math.PI / 180);
    camera = value === "orthographic" ? new T.OrthographicCamera(-extent * aspect, extent * aspect, extent, -extent, 0.1, 6e3) : new T.PerspectiveCamera(32, aspect, old.near, old.far);
    camera.aspect = aspect;
    camera.position.copy(old.position);
    camera.quaternion.copy(old.quaternion);
    camera.up.copy(old.up);
    replaceCamera(camera);
    orbit.object = camera;
    orbit.update();
    $("projection").value = value;
    invalidate();
  }

  function preset(view) {
    const { camera } = stage;
    camera.up.set(0, 1, 0);
    const spec = config.viewer.cameraPresets[view];
    if (spec) {
      const position = [...spec.position];
      if (spec.depth) position[2] += spec.depth[0] * Math.max(spec.depth[1], spec.depth[2] / camera.aspect);
      to(spec.target, position);
    }
    if (view === "exploded" && layout()) fitExploded();
  }

  function fitExploded(direction = [1.8, 0.8, 1.35]) {
    const { camera } = stage, bounds = layout().bounds, center = V(bounds.center), forward = V(direction).normalize(), right = new T.Vector3().crossVectors(camera.up, forward).normalize(), up = new T.Vector3().crossVectors(forward, right), tan = Math.tan(16 * Math.PI / 180);
    let distance = 0;
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      const v = new T.Vector3(x, y, z).sub(center), depth = v.dot(forward);
      distance = Math.max(distance, depth + Math.abs(v.dot(right)) / (tan * camera.aspect * 0.73), depth + Math.abs(v.dot(up)) / (tan * 0.72));
    }
    to(center.toArray(), center.clone().addScaledVector(forward, distance).toArray());
  }

  /** Moves to the close-up of one control (volume, tone, …), allowing for the service view's offset. */
  function controlView(key) {
    const { camera } = stage;
    camera.up.set(0, 1, 0);
    const views = config.viewer.controlCameras;
    let view = views[key];
    if (state.view === "service") {
      if (config.viewer.serviceControlCameras[key]) view = config.viewer.serviceControlCameras[key];
      else {
        const id = config.roles.controlCloseup[key], offset = parts.find((p) => p.data.id === id)?.data.service || [0, 0, 0];
        view = view.map((point) => point.map((v, i) => v + offset[i]));
      }
    }
    if (view) to(...view);
  }

  /** Advances the glide by dt seconds. */
  function step(dt) {
    if (!tween) return;
    const { camera, orbit } = stage, x = tween;
    x.t += dt;
    const t = clamp(x.t / x.duration, 0, 1), k = t * t * (3 - 2 * t);
    camera.position.lerpVectors(x.start, x.end, k);
    orbit.target.lerpVectors(x.from, x.to, k);
    if (t === 1) tween = null;
  }

  return { to, setProjection, preset, fitExploded, controlView, step, stop: () => { tween = null; }, get moving() { return Boolean(tween); },
    updateClipRange: () => updateClipRange(stage.camera, stage.orbit.target) };
}
