// The transport and the controls on the model: PLAY, FF, REW, STOP/EJECT, and clicks and drags
// on the modelled buttons and grips.
// It changes the operating state and nothing else. What must follow in the rest of the viewer is
// passed in: clearTour and sync, the packages to load, and how to inspect a part.
import * as T from "three";
import {operatingPose, modelControlsEnabled} from "./operating-pose.mjs";
import {CONTROL_BINDINGS, actionForControl, controlValue} from "./model-controls.mjs";
import {dispatchOperating} from "./operating-state.mjs";
import {installControlPointers, bindHoldButton} from "./control-pointers.mjs";

const V = (a) => new T.Vector3().fromArray(a);

// spread() gives how far the separated views are open; the modelled controls work only when they are closed.
export function createTransport({ $, state, parts, stage, packages, audio, invalidate, clearTour, sync, spread, inspectPart, setOrbitEnabled }) {
  let pointers = null;   // pointer handling on the modelled controls, once installed
  const hotlineHold = bindHoldButton($("hotline"), (active) => {
    operation({ type: "hotline", active });
    sync();
  });

  function operation(action) {
    dispatchOperating(state, action);
    audio.sync(state);
    invalidate();
  }
  function cancelControlHold() {
    pointers?.cancel();
    hotlineHold?.cancel();
    if (state.hotline) {
      operation({ type: "hotline", active: false });
      $("hotline").setAttribute("aria-pressed", "false");
    }
  }
  function poseName() {
    return operatingPose(state);
  }
  function operate(mode) {
    clearTour();
    if (state.explode > 0 || state.radial > 0) return;
    operation({ type: "transport", mode });
    packages.ensure("mechanism").catch(() => {
    });
    sync();
  }
  function stopEject() {
    clearTour();
    if (state.explode > 0 || state.radial > 0) return;
    operation({ type: "stop-eject" });
    packages.ensure("mechanism").catch(() => {
    });
    sync();
  }
  function modelAction(id, phase, value) {
    const action = actionForControl(id, state, phase, value);
    if (!action) return;
    if (action.type === "transport") {
      operate(action.mode);
      return;
    }
    if (action.type === "stop-eject") {
      stopEject();
      return;
    }
    if (action.type === "battery-door" || action.type === "battery-latch") {
      if (state.explode > 0 || state.radial > 0) return;
      clearTour();
      operation(action);
      packages.ensureAll();
      sync();
      return;
    }
    clearTour();
    operation(action);
    if (action.type === "door" || action.type === "cassette") packages.ensure("mechanism").catch(() => {
    });
    sync();
  }
  function modelHit(event) {
    const { camera, renderer, raycaster } = stage;
    const rect = $("canvas").getBoundingClientRect();
    raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects(packages.draws.filter((m) => m.visible && m.parent.visible)).find((hit2) => renderer.clippingPlanes.every((plane) => plane.distanceToPoint(hit2.point) >= 0));
    return hit ? { ...hit, partId: hit.object.userData.part.data.id } : null;
  }
  function controlScreenAxis(id) {
    const binding = CONTROL_BINDINGS[id], p = parts.find((p2) => p2.data.id === id);
    if (!binding?.axis || !Number.isFinite(binding.travelMm) || !p) return null;
    const { camera } = stage, rect = $("canvas").getBoundingClientRect(), center = p.labelPoint.clone().applyMatrix4(p.group.matrixWorld), end = center.clone().addScaledVector(V(binding.axis), binding.travelMm);
    return [center, end].map((v) => {
      v.project(camera);
      return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 };
    });
  }

  /** Makes the modelled buttons and grips answer the pointer. Called once, when the model is on screen. */
  function installPointers() {
    pointers = installControlPointers({ canvas: $("canvas"), hitTest: modelHit, describe: (id) => {
      const c = CONTROL_BINDINGS[id];
      return c ? { label: c.label, hold: c.kind === "momentary", drag: c.kind === "slider" || c.id === "tone", toggle: c.id === "tone" } : null;
    }, enabled: () => modelControlsEnabled(state, spread()), value: (id) => controlValue(id, state), projectedAxis: controlScreenAxis, activate: modelAction, inspect: inspectPart, hint: (text) => {
      $("controlHint").textContent = text;
      $("controlHint").hidden = !text;
    }, setOrbitEnabled });
  }

  return { operation, cancelControlHold, poseName, operate, stopEject, modelAction, modelHit, controlScreenAxis, installPointers };
}
