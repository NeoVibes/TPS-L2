// The transport and the controls on the model: PLAY, FF, REW, STOP/EJECT, and clicks and drags
// on the modelled buttons and grips, the sockets, the plugs and the batteries.
// It changes the operating state and nothing else. What must follow in the rest of the viewer is
// passed in: clearTour and sync, the packages to load, how to inspect a part, and how to plug an
// accessory in or move the cells (accessories).
import * as T from "three";
import {operatingPose, modelControlsEnabled} from "./operating-pose.mjs";
import {CONTROL_BINDINGS, actionForControl, controlValue} from "./model-controls.mjs";
import {dispatchOperating} from "./operating-state.mjs";
import {installControlPointers, bindHoldButton} from "./control-pointers.mjs";
import config from "../config/model.json" with { type: "json" };

const V = (a) => new T.Vector3().fromArray(a);

const SOCKET_REACH_MM = 6;   // how near a socket's mouth a click must land to mean that socket
const CELL_REACH_MM = 2;   // how far outside the cells' own space a click still means the battery case
const plugAssemblies = new Set(Object.values(config.accessories.plugs).map((plug) => plug.assembly));
const PLUG_WORDS = { headphones: ["headphones", "headphone plug"], adapter: ["power adapter", "power plug"] };   // [what is plugged in, what is pulled out]

// spread() gives how far the separated views are open; the modelled controls work only when they are closed.
export function createTransport({ $, state, parts, stage, packages, audio, invalidate, clearTour, sync, spread, inspectPart, accessories, setOrbitEnabled }) {
  let pointers = null;   // pointer handling on the modelled controls, once installed
  let plugPlaces = null;   // per accessory: where each socket's mouth is, and which of its parts are the plug
  let cellSpace = null;   // the room the two cells take in the battery case
  const hotlineHold = bindHoldButton($("hotline"), (active) => {
    operation({ type: "hotline", active });
    sync();
  });

  function operation(action) {
    if (state.graphicsUnavailable) return;
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
    if (state.graphicsUnavailable) return;
    clearTour();
    if (state.explode > 0 || state.radial > 0) return;
    operation({ type: "transport", mode });
    packages.ensure("mechanism").catch(() => {
    });
    sync();
  }
  function stopEject() {
    if (state.graphicsUnavailable) return;
    clearTour();
    if (state.explode > 0 || state.radial > 0) return;
    operation({ type: "stop-eject" });
    packages.ensure("mechanism").catch(() => {
    });
    sync();
  }
  function modelAction(id, phase, value) {
    if (state.graphicsUnavailable) return;
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
    if (state.graphicsUnavailable) return null;
    const { camera, renderer, raycaster } = stage;
    const rect = $("canvas").getBoundingClientRect();
    raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects(packages.draws.filter((m) => m.visible && m.parent.visible)).find((hit2) => renderer.clippingPlanes.every((plane) => plane.distanceToPoint(hit2.point) >= 0));
    return hit ? { ...hit, partId: hit.object.userData.part.data.id } : null;
  }
  // Each accessory's sockets and plug, read from the places its parts take when plugged in: the parts that
  // slide are the plug, and the one that ends nearest the player marks the socket's mouth.
  function plugs() {
    if (plugPlaces) return plugPlaces;
    plugPlaces = {};
    for (const [key, plug] of Object.entries(config.accessories.plugs)) {
      const own = parts.filter((p) => p.data.assembly === plug.assembly && p.plugPoses), sockets = {}, moving = new Set();
      for (const socket of Object.keys(plug.states)) {
        const sliding = own.filter((p) => p.plugPoses[socket] && p.plugPoses[socket][0].p.distanceTo(p.plugPoses[socket][1].p) > 0.01);
        for (const p of sliding) moving.add(p.data.id);
        const tip = sliding.reduce((best, p) => !best || p.plugPoses[socket][1].p.length() < best.plugPoses[socket][1].p.length() ? p : best, null);
        if (tip) sockets[socket] = tip.plugPoses[socket][1].p;
      }
      const [thing, itsPlug] = PLUG_WORDS[key] || [plug.label, plug.label + " plug"];
      plugPlaces[key] = { thing, itsPlug, sockets, moving, first: Object.keys(plug.states)[0] };
    }
    return plugPlaces;
  }
  function cellRoom() {
    if (cellSpace) return cellSpace;
    cellSpace = new T.Box3();
    for (const p of parts) if (p.accessory && !plugAssemblies.has(p.data.assembly)) cellSpace.expandByPoint(V(p.data.authoritativeBounds.min)).expandByPoint(V(p.data.authoritativeBounds.max));
    return cellSpace.expandByScalar(CELL_REACH_MM);
  }
  // What a click at this spot would do beyond Sony's own controls: {id, label}, or null.
  function accessoryTarget(hit) {
    const part = parts.find((p) => p.data.id === hit.partId);
    if (!part || state.explode > 0 || state.radial > 0) return null;
    if (part.accessory && !plugAssemblies.has(part.data.assembly)) return state.batteryOpen ? { id: "do:cells:out", label: "Take the batteries out" } : null;
    if (!state.cells && state.batteryOpen && !part.accessory && cellRoom().containsPoint(hit.point)) return { id: "do:cells:in", label: "Put the batteries in" };
    if (state.view !== "assembled") return null;
    for (const [key, place] of Object.entries(plugs())) {
      if (place.moving.has(part.data.id)) return state[key] === "out" ? { id: "do:plug:" + key + ":" + place.first, label: "Plug the " + place.thing + " in" } : { id: "do:plug:" + key + ":out", label: "Pull the " + place.itsPlug + " out" };
      if (part.accessory) continue;
      const near = Object.entries(place.sockets).map(([socket, mouth]) => [socket, mouth.distanceTo(hit.point)]).sort((a, b) => a[1] - b[1])[0];
      if (near && near[1] <= SOCKET_REACH_MM && state[key] !== near[0]) return { id: "do:plug:" + key + ":" + near[0], label: "Plug the " + place.thing + " into " + (Object.keys(place.sockets).length > 1 ? "socket " + near[0] : near[0]) };
    }
    return null;
  }
  function accessoryAction(id) {
    const [, kind, a, b] = id.split(":");
    clearTour();
    if (kind === "cells") accessories.setCells(a === "in");
    else accessories.setPlug(a, b);
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
    const targets = new Map();   // the label of each accessory action last offered, by its id
    pointers = installControlPointers({ canvas: $("canvas"), hitTest: (event) => {
      const hit = modelHit(event), extra = hit && modelControlsEnabled(state, spread()) && !CONTROL_BINDINGS[hit.partId] ? accessoryTarget(hit) : null;
      if (!extra) return hit;
      targets.set(extra.id, extra.label);
      return { ...hit, partId: extra.id };
    }, describe: (id) => {
      if (targets.has(id)) return { label: targets.get(id) };
      const c = CONTROL_BINDINGS[id];
      return c ? { label: c.label, hold: c.kind === "momentary", drag: c.kind === "slider" || c.id === "tone", toggle: c.id === "tone" } : null;
    }, enabled: () => modelControlsEnabled(state, spread()), value: (id) => controlValue(id, state), projectedAxis: controlScreenAxis,
    activate: (id, phase, value) => targets.has(id) ? phase === "click" && accessoryAction(id) : modelAction(id, phase, value),
    inspect: (id) => { if (state.uiMode === "inspect") inspectPart(id); },   // with Parts open a click selects; otherwise only the player's own parts answer
    hint: (text) => {
      $("controlHint").textContent = text;
      $("controlHint").hidden = !text;
    }, setOrbitEnabled });
  }

  return { operation, cancelControlHold, poseName, operate, stopEject, modelAction, modelHit, controlScreenAxis, installPointers };
}
