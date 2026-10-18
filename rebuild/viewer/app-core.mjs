// The scene and the frame loop: the shared state, the three.js objects, start-up, moving the parts
// each frame, and reset. It also creates the controllers and gives each what it needs:
//
//   packages   loading the geometry files            app-packages.mjs
//   transport  PLAY, FF, REW, the modelled controls  app-transport.mjs
//   cam        camera movement                       app-camera.mjs
//   labels     part and assembly labels              app-labels.mjs
//   views      view switches and page refresh        app-views.mjs
//   inspect    search, selection, part information   app-inspect.mjs
//   tour       the guided tour                       app-tour.mjs
//   masterList the parts list and confirmation       app-master-list.mjs
//
// A controller module imports nothing from here. Where two controllers call each other, the later
// one is reached through a small function such as "() => tour.clear()".
import {sessionDiagnostics} from "./session-diagnostics.mjs";
import config from "../config/model.json" with { type: "json" };
import {ejectTravel, cassetteLift, applyArticulation} from "./eject-motion.mjs";
import * as T from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {RoomEnvironment} from "three/examples/jsm/environments/RoomEnvironment.js";
import {beltTravel, advancePartAngle} from "./drive-motion.mjs";
import {updateOperationIndicator} from "./operation-indicator.mjs";
import {batterySequence} from "./operating-pose.mjs";
import {createDoorMotion, applyHingePose} from "./door-motion.mjs";
import {createExplodedLayout} from "./exploded-layout.mjs";
import {deformationWeights, applyDeformationPositions} from "./native-deformation.mjs";
import {CONTROL_BINDINGS, controlVisualOffset} from "./model-controls.mjs";
import {modelData, listData} from "./data.mjs";
import {createOperatingState, advanceOperating, resetOperating, transportInterval, autoStopProgress} from "./operating-state.mjs";
import {createAudioEngine} from "./audio.mjs";
import {createTour} from "./app-tour.mjs";
import {createTransport} from "./app-transport.mjs";
import {createViews, syncUnavailable} from "./app-views.mjs";
import {createInspect, expandVisiblePartBounds} from "./app-inspect.mjs";
import {createPackages} from "./app-packages.mjs";
import {createCamera, renderPixelRatio} from "./app-camera.mjs";
import {createLabels} from "./app-labels.mjs";
import {createMasterList} from "./app-master-list.mjs";
import {readPreferences, savePreferences} from "./preferences.mjs";
import {createTheme} from "./app-theme.mjs";

const preferences = readPreferences();
export const motionCueEnabled = { value: Number(preferences.motionCues) };
const indicatorMaterials = [];
export const $ = (id) => document.getElementById(id);
const clamp = T.MathUtils.clamp;
export const state = { ...createOperatingState(), uiMode: "operate", cassetteVariant: "refined", labels: preferences.labels, subsystem: "all", projection: "perspective", section: "off", sectionOffset: 0, view: "assembled", explode: 0, radial: 0, speed: config.viewer.defaultSpeed, paused: false, category: "all", selected: null, isolate: false, tour: -1 };
const family = (p) => p.category;
export let model;
let parts = [];
let scene;
export let camera;
let renderer;
export let orbit;
let raycaster;
let materials = [];
let lastTime = 0;
let displayExplosion = 0;
let displayService = 0;
let displayRadial = 0;
let displayBattery = 0;
let explodedLayout;
export const V = (a) => new T.Vector3().fromArray(a);
const Q = (a) => new T.Quaternion().fromArray(a);
const tempQ = new T.Quaternion();
const tempV = new T.Vector3();
let lastObservation = 0;
let frameNumber = 0;
let dirty = true;
let settleUntil = 0;
let highlightMaterials = [];
export const metrics = { started: performance.now(), firstExteriorMs: null, frames: [], packageErrors: [], device: navigator.userAgent };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
export const audio = createAudioEngine({ onStatus: (message) => {
  $("audioStatus").textContent = typeof message === "string" ? message : message.message;
} });
// The three.js objects, for the controllers. They are made in init(), and the camera is replaced when the
// projection changes, so controllers read them through this object when they need them.
const stage = {
  syncBackdrop,
  get scene() { return scene; }, get camera() { return camera; }, get renderer() { return renderer; }, get orbit() { return orbit; },
  get raycaster() { return raycaster; }, get model() { return model; }, get materials() { return materials; }, get highlightMaterials() { return highlightMaterials; }
};
// CSS owns theme/view colors. Reading it here also honors System without a JS theme override.
// Background changes were instant before theming; keep them on the existing render loop.
export function syncBackdrop() {
  if (!scene) return;
  scene.background.set(getComputedStyle($("stage")).getPropertyValue("--stage-backdrop").trim());
  invalidate();
}
export const theme = createTheme({onChange: syncBackdrop});
const labels = createLabels({ $, state, parts, stage });
// What follows a load: the new meshes take their place and the picture is redrawn.
export const packages = createPackages({ $, state, parts, stage, metrics, motionCueEnabled,
  onLoaded: (name) => {
    views.updateVisibility();
    if (name !== "cassette") updateParts(10, 0);
    invalidate();
  },
  onVariant: () => {
    views.updateVisibility();
    inspect.refreshPartInformation();
    invalidate();
  } });
export const transport = createTransport({ $, state, parts, stage, packages, audio, invalidate, clearTour: () => tour.clear(), sync: () => views.sync(),
  spread: () => ({ radial: displayRadial, explosion: displayExplosion }),
  inspectPart: (id) => {
    tour.clear();
    inspect.select(parts.find((p) => p.data.id === id));
    views.sync();
  },
  setOrbitEnabled: (enabled) => {
    orbit.enabled = enabled;
    if (!enabled) {
      cam.stop();
      orbit.update();
    }
  } });
export const cam = createCamera({ $, state, parts, stage, layout: () => explodedLayout, invalidate, reducedMotion, replaceCamera: (next) => { camera = next; } });
export const views = createViews({ $, state, parts, stage, packages, cam, transport, audio, invalidate, clearTour: () => tour.clear(), tourPosition: () => tour.position, tourSteps: config.viewer.tourSteps,
  clearInspectionContext: () => inspect.clearInspectionContext(), select: (part) => inspect.select(part),
  onExterior: () => { inspect.refreshPartInformation(); } });
export const inspect = createInspect({ $, state, parts, stage, packages, cam, views, clearTour: () => tour.clear(), reset, updateParts, detailsData: () => ({measured: modelData().measured, rows: masterList.rows, levels: listData().levels}), onPartShown: (id, details) => masterList.showPart(id, details.confirmation) });
// Picking a modelled row of the parts list shows that part; a cassette row also shows its cassette.
const masterList = createMasterList({ $, data: listData(), exterior: () => state.exterior, pickPart: (row, source) => {
  const part = parts.find((p) => p.data.id === row.part_id);
  const data = part?.data || model?.parts.find(p => p.id === row.part_id);
  if (data?.is_cassette && row.variant) {
    state.cassetteVariant = row.variant === "detailed" ? "refined" : "original";
    $("cassetteVariant").value = state.cassetteVariant;
    if (!state.graphicsUnavailable && renderer) packages.setCassetteVariant(state.cassetteVariant);
  } else if (row.variant && !row.variant.split("+").includes(state.exterior)) views.setExterior(row.variant.split("+")[0]);
  if (state.graphicsUnavailable || !renderer || !part) {
    if (data) inspect.showInformationOnly(data, source);
    return;
  }
  tour.clear();
  views.setUIMode("inspect");
  inspect.select(part, source);
  inspect.focusPart();
  views.sync();
} });
export const tour = createTour({ $, state, parts, steps: config.viewer.tourSteps, views, cam, invalidate });
export function saveViewerPreferences() {
  savePreferences({projection:state.projection,labels:state.labels,motionCues:Boolean(motionCueEnabled.value)});
}
export function invalidate() {
  dirty = true;
  settleUntil = performance.now() + 3e3;
}
export function reset() {
  if (state.graphicsUnavailable || !renderer) return;
  transport.cancelControlHold();
  $("controlCamera").value = "";
  $("audioControls").open = true;
  tour.clear();
  resetOperating(state);
  tour.rewind();
  Object.assign(state, { mode: "stop", door: false, media: "loaded", view: "assembled", explode: 0, radial: 0, speed: config.viewer.defaultSpeed, paused: false, category: "all", selected: null, isolate: false });
  for (const p of parts) p.phase = 0;
  $("speed").value = state.speed;
  $("speedValue").textContent = state.speed.toFixed(2) + "×";
  state.subsystem = "all";
  inspect.clearInspectionContext();
  $("subsystem").value = "all";
  state.section = "off";
  state.sectionOffset = 0;
  $("section").value = "off";
  $("sectionOffset").value = 0;
  $("sectionValue").textContent = "0 mm";
  views.applySection();
  inspect.select(null);
  views.updateVisibility();
  displayExplosion = 0;
  displayService = 0;
  displayRadial = 0;
  displayBattery = 0;
  updateParts(100, 0);
  cam.preset("assembled");
  views.sync();
}
// Automatic shut-off: which parts take part, and where each stands. In PLAY the cam on the third gear pushes the
// shut-off lever out once a turn. When the reel stalls the detection lever falls back and the lever's teeth
// mesh with the gear; the gear then carries the lever along and it turns release lever C.
const shutOff = config.roles.autoStop, shutOffRole = Object.fromEntries(["lever", "detector", "release"].flatMap((role) => shutOff[role].map((id) => [id, role])));
const reelDriven = new Set(config.roles.reelDriven);
function shutOffWeights(role) {
  const stage = autoStopProgress(state), cam = parts.find((q) => q.data.id === shutOff.cam);
  const rock = role === "lever" && cam ? (1 - Math.cos(cam.phase)) / 2 * (1 - stage.mesh) : 0;
  if (stage.trip > 0) return [["shutoff_meshed", 1 - stage.trip], ["shutoff_tripped", stage.trip]];
  return [["play", (1 - rock) * (1 - stage.mesh)], ["shutoff_out", rock * (1 - stage.mesh)], ["shutoff_meshed", stage.mesh]];
}
const mixPoses = (p, weights, s) => weights.reduce((sum, [name, w]) => { const total = sum.w + w; if (w > 0) { sum.p.lerp(p.poses[name].p, w / total); sum.q.slerp(p.poses[name].q, w / total); sum.w = total; } return sum; }, { p: p.poses[weights[0][0]].p.clone(), q: p.poses[weights[0][0]].q.clone(), s, w: 0 });
// A part that rides the rig is built from what its rig members do: each member's turn and shift are blended, then applied outermost
// first to the part as it stands at STOP. That keeps a gear on its arm's arc, and turning with it, all the way from one position to the next.
const linkM = new T.Matrix4(), linkR = new T.Matrix4(), linkS = new T.Vector3(), linkShift = new T.Vector3();
function followLinks(p, weights, smoothing) {
  linkM.identity();
  for (const link of p.links) {
    let a = 0; linkShift.set(0, 0, 0);
    for (const [name, w] of weights) { a += w * link.poses[name].a; linkShift.addScaledVector(link.poses[name].t, w); }
    link.a += (a - link.a) * smoothing; link.t.lerp(linkShift, smoothing);
    linkM.multiply(linkR.makeTranslation(link.t.x + link.pivot.x, link.t.y + link.pivot.y, link.t.z + link.pivot.z)).multiply(linkR.makeRotationAxis(link.axis, link.a)).multiply(linkR.makeTranslation(-link.pivot.x, -link.pivot.y, -link.pivot.z));
  }
  linkM.multiply(p.stopMatrix).decompose(p.baseP, p.baseQ, linkS);
}
function updateParts(dt, spinDt = dt, spinMode = state.mode) {
  updateOperationIndicator(indicatorMaterials, state);
  const smoothing = 1 - Math.exp(-dt * config.viewer.poseSmoothingRate), pose = transport.poseName();
  displayService = T.MathUtils.lerp(displayService, state.view === "service" ? 1 : 0, smoothing);
  displayExplosion = T.MathUtils.lerp(displayExplosion, state.explode, smoothing);
  displayRadial = T.MathUtils.lerp(displayRadial, state.radial, smoothing);
  if (Math.abs(displayRadial - state.radial) < 1e-5) displayRadial = state.radial;
  if (Math.abs(displayExplosion - state.explode) < 1e-5) displayExplosion = state.explode;
  if (Math.abs(displayService - (state.view === "service" ? 1 : 0)) < 1e-5) displayService = state.view === "service" ? 1 : 0;
  displayBattery = T.MathUtils.lerp(displayBattery, ["exploded", "catalog"].includes(state.view) ? 0 : Number(state.batteryOpen), smoothing);
  const battery = batterySequence(displayBattery), eject = ejectTravel(state), contact = model.parts.find((p) => p.ejectContact)?.ejectContact;
  for (const p of parts) {
    p.deformPlay = T.MathUtils.lerp(p.deformPlay || 0, state.mode === "play" ? 1 : 0, smoothing);
    let base = p.poses[state.view === "service" && p.data.rest_when_separated ? "stop" : pose];
    if (p.data.is_cassette && state.media !== "removed" && contact) {
      base = { ...base, p: p.poses[state.door ? "open" : "stop"].p.clone() };
      base.p.z += cassetteLift(contact, eject);
    }
    if (config.roles.stopTranslation.includes(p.data.id)) base = { ...base, p: p.poses.stop.p.clone().lerp(p.poses.eject.p, state.stopTravel || 0) };
    const staged = shutOffRole[p.data.id] && state.mode === "play" && p.poses.shutoff_tripped ? shutOffWeights(shutOffRole[p.data.id]) : null;
    if (staged && !p.links) base = mixPoses(p, staged, base.s);
    if (p.batteryHinge) {
      const q = p.poses.stop.q.clone().slerp(p.poses.battery_open.q, battery.open);
      base = { ...base, q, p: applyHingePose(p.batteryHinge, q) };
    }
    if (p.data.id === config.roles.batteryLatch) base = { ...base, p: p.poses.stop.p.clone().lerp(p.poses.battery_release.p, battery.release) };
    if (p.links) followLinks(p, staged || [[state.view === "service" && p.data.rest_when_separated ? "stop" : pose, 1]], smoothing);
    else if (p.batteryHinge) p.baseQ.copy(base.q);
    else p.baseQ.slerp(base.q, smoothing);
    if (p.hinge) p.baseQ.normalize();
    if (p.batteryHinge) applyHingePose(p.batteryHinge, p.baseQ, p.baseP);
    else if (p.hinge) applyHingePose(p.hinge, p.baseQ, p.baseP);
    else if (config.roles.instantTranslation.includes(p.data.id) || p.data.is_cassette && state.media !== "removed" && contact) p.baseP.copy(base.p);
    else if (!p.links) p.baseP.lerp(base.p, smoothing);
    p.group.scale.copy(base.s);
    const sp = state.autoStop && reelDriven.has(p.data.id) ? null : p.spin[spinMode];   // a stalled reel and what turns with it stand still
    p.phase = advancePartAngle(p.phase, p.data, sp, { ...state, displayExplosion, displayRadial }, spinDt);
    const a = p.reference;
    if (a) {
      tempQ.setFromAxisAngle(a.axis, p.phase);
      tempV.copy(a.center).applyQuaternion(tempQ).negate().add(a.center).multiply(base.s).applyQuaternion(p.baseQ);
      p.group.position.copy(p.baseP).add(tempV);
      p.group.quaternion.copy(p.baseQ).multiply(tempQ);
    } else {
      p.group.position.copy(p.baseP);
      p.group.quaternion.copy(p.baseQ);
    }
    const d = p.data, delay = 0.32 * d.order / Math.max(1, parts.length - 1), progress = clamp((displayExplosion - delay) / (1 - delay), 0, 1), axial = clamp(progress / 0.45, 0, 1), fan = clamp((progress - 0.45) / 0.55, 0, 1), service = displayService * clamp((1 - displayExplosion) / (1 - delay), 0, 1);
    p.group.position.x += d.service[0] * service + d.direction[0] * d.distance * axial + d.fan[0] * fan;
    p.group.position.y += d.service[1] * service + d.direction[1] * d.distance * axial + d.fan[1] * fan;
    p.group.position.z += d.service[2] * service + d.direction[2] * d.distance * axial + d.fan[2] * fan;
    if (explodedLayout) {
      const offset = explodedLayout.offsets[d.id];
      p.group.position.addScaledVector(V(offset), displayRadial);
    }
    if (state.view !== "exploded" && state.view !== "catalog") p.group.position.add(V(controlVisualOffset(d.id, state)));
    for (const mesh of p.group.children) {
      const g = mesh.geometry, deformation = g?.userData.nativeDeformation;
      if (g?.userData.nativeArticulation) applyArticulation(mesh, g.userData.nativeArticulation, eject);
      if (!deformation) continue;
      const target = deformationWeights(deformation, { ...state, pose, playTravel: p.deformPlay, batteryRelease: battery.release, stopTravel: state.stopTravel }), previous = mesh.userData.deformationWeights;
      const weights = target.map((v, i) => config.roles.smoothDeformation.includes(deformation.owner) && previous ? T.MathUtils.lerp(previous[i], v, smoothing) : v);
      if (!previous || weights.some((v, i) => Math.abs(v - previous[i]) > 1e-7)) {
        applyDeformationPositions(g.userData.nativeBasePositions, deformation.targets, weights, g.attributes.position.array);
        g.attributes.position.needsUpdate = true;
        g.computeVertexNormals();
        g.computeBoundingSphere();
        g.computeBoundingBox();
        mesh.userData.deformationWeights = weights;
      }
    }
  }
  for (const p of parts) if (p.data.belt && p.cueTravel) {
    const driver = parts.find((d) => d.data.id === p.data.belt.driverId);
    p.cueTravel.value = beltTravel(p.data.belt, driver.phase);
  }
}
function animate(now) {
  if (state.graphicsUnavailable) return;
  requestAnimationFrame(animate);
  if (window.portableTapePlayer && performance.now() - lastObservation > 500) {
    lastObservation = performance.now();
    const record = $("portable-tape-player-state");
    if (record) record.textContent = JSON.stringify(window.portableTapePlayer.snapshot());
  }
  const wallDt = Math.max(0, (now - lastTime) / 1e3 || 0);
  lastTime = now;
  if (document.hidden) return;
  const active = state.stopCycle && !state.paused || state.mode !== "stop" && !state.paused && (state.explode === 0 && state.radial === 0) || state.tour >= 0 && !state.paused || cam.moving || now < settleUntil;
  if (!dirty && !active) return;
  const start = performance.now(), dt = Math.min(wallDt, 0.1);
  const transportStep = transportInterval(state, wallDt);
  if (state.explode === 0 && state.radial === 0 && state.tour < 0) {
    const before = [state.mode, state.media, state.stopCycle?.committed, Boolean(state.stopCycle), Boolean(state.autoStop), state.ejectNeedsOpenCover].join();
    advanceOperating(state, wallDt);
    if (before !== [state.mode, state.media, state.stopCycle?.committed, Boolean(state.stopCycle), Boolean(state.autoStop), state.ejectNeedsOpenCover].join()) views.sync();
  }
  if (state.tour >= 0 && !state.paused) tour.seek(tour.position + wallDt);
  updateParts(reducedMotion.matches ? 10 : dt, state.tour >= 0 ? 0 : transportStep.seconds, transportStep.mode);
  cam.step(dt);
  orbit.update();
  cam.updateClipRange();
  renderer.render(scene, camera);
  labels.update(displayRadial);
  dirty = false;
  frameNumber++;
  const renderMs = performance.now() - start, sampleKey = state.view + "/" + state.mode;
  if (metrics.sampleKey !== sampleKey) {
    metrics.frames = [];
    metrics.sampleKey = sampleKey;
    metrics.motionSampling = false;
  }
  if (state.mode !== "stop" && !state.paused) {
    if (metrics.motionSampling) {
      metrics.frames.push({ interval: wallDt * 1e3, render: renderMs });
      if (metrics.frames.length > 180) metrics.frames.shift();
    }
    metrics.motionSampling = true;
  } else metrics.motionSampling = false;
  audio.sync(state);
  // Publish every completed render: a slow renderer can become idle before
  // the throttled UI update reaches its fifteenth frame.
  $("stage").dataset.test = JSON.stringify({ mode: state.mode, view: state.view, door: state.door, media: state.media, batteryOpen: state.batteryOpen, batteryProgress: displayBattery, stopTravel: state.stopTravel, ejectTravel: ejectTravel(state), stopCycle: state.stopCycle?.kind || null, explode: displayExplosion, radial: displayRadial, cassetteVariant: state.cassetteVariant, cassetteReady: packages.loaded.has("cassette"), batteryCaseReady: packages.loaded.has("exterior"), paused: state.paused, tour: state.tour, visible: parts.filter((p) => p.group.visible).length, volumeLeft: state.volumeLeft, volumeRight: state.volumeRight, tone: state.tone, hotline: state.hotline, assemblyLabels: labels.visibleAssemblies(), frames: frameNumber, phase: parts.find((p) => p.data.id === "MEC-011")?.phase, draws: renderer.info.render.calls, triangles: renderer.info.render.triangles, near: camera.near, far: camera.far, pixelRatio: renderer.getPixelRatio() });
  if (frameNumber % 15 === 0 || !active) {
    $("tapePosition").value = state.tapePosition;
    $("tapeValue").textContent = Math.round(state.tapePosition * 100) + "%";
    const mean = metrics.frames.reduce((a, v) => a + v.interval, 0) / metrics.frames.length;
    $("fps").textContent = state.mode === "stop" || state.paused ? "Render on change" : Math.round(1e3 / mean) + " FPS · " + renderer.info.render.calls + " draws";
  }
}
// Optional read-only evidence for appearance changes; ordinary session snapshots stay small.
function appearanceSnapshot() {
  const materialSet = new Set([...materials, ...highlightMaterials]);
  const assignments = [];
  for (const p of parts) p.group.traverse(object => {
    if (!object.material) return;
    const assigned = Array.isArray(object.material) ? object.material : [object.material];
    [...assigned, ...(object.userData.cueMaterials || [])].forEach(material => materialSet.add(material));
    assignments.push({object: object.uuid, materials: assigned.map(material => material.uuid)});
  });
  const lights = [];
  scene.traverse(object => { if (object.isLight) lights.push(object.toJSON()); });
  const materialMeta = {textures: {}, images: {}}; // Compare texture identities without encoding canvas textures.
  return {
    pending: {stopCycle: state.stopCycle, autoStop: state.autoStop},
    camera: {type: camera.type, position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
      zoom: camera.zoom, projectionMatrix: camera.projectionMatrix.toArray(), target: orbit.target.toArray()},
    materials: [...materialSet].map(material => material.toJSON(materialMeta)), assignments, lights,
    renderer: {toneMapping: renderer.toneMapping, toneMappingExposure: renderer.toneMappingExposure, outputColorSpace: renderer.outputColorSpace},
    environment: {id: scene.environment?.uuid, intensity: scene.environmentIntensity, rotation: scene.environmentRotation.toArray()},
    audio: {...audio.status}
  };
}
export function markGraphicsUnavailable(message) {
  transport.cancelControlHold();
  Object.assign(state, {graphicsUnavailable:true, mode:"stop", paused:true, audioEnabled:false, tour:-1, stopCycle:null});
  cam.stop();
  if (orbit) orbit.enabled = false;
  audio.setVisibility(false);
  $("loadingText").textContent = message + " Use the catalog, or reload to try 3D again.";
  $("catalog").open = Boolean(model);
  if (model) {
    views.setExterior(new URLSearchParams(location.hash.slice(1)).get("exterior") || model.exterior?.default);
    inspect.useFallbackSearch();
  } else {
    $("masterList").open = true;
    $("searchCount").textContent = "Component finder unavailable: model metadata did not load.";
  }
  syncUnavailable($, state, model);
}
export async function init() {
  try {
    model = modelData().meta;
    state.exterior = model.exterior?.default ?? null;
    packages.open(modelData().packages);
    $("loadingText").textContent = "Opening the exterior…";
    scene = new T.Scene();
    scene.background = new T.Color();
    syncBackdrop();
    camera = new T.PerspectiveCamera(32, 1, 40, 2400);
    camera.position.set(200, 135, 340);
    renderer = new T.WebGLRenderer({ canvas: $("canvas"), antialias: true, powerPreference: "high-performance" });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.8;
    room.dispose();
    pmrem.dispose();
    scene.add(new T.HemisphereLight(16777215, 7370626, 1.3));
    const key = new T.DirectionalLight(16777215, 2);
    key.position.set(150, 250, 400);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 800 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -6e-5;
    key.shadow.normalBias = 0.06;
    scene.add(key);
    const back = new T.DirectionalLight(14476799, 1.9);
    back.position.set(-140, 100, -250);
    scene.add(back);
    materials = model.materials.map((m) => new T.MeshStandardMaterial({ color: new T.Color().setRGB(...m.color), metalness: m.metalness, roughness: m.roughness, opacity: m.alpha, transparent: m.alpha < 0.99, depthWrite: m.alpha >= 0.99, side: T.DoubleSide }));
    explodedLayout = createExplodedLayout(model.parts, { gapMm: config.viewer.explodedGapMm });
    highlightMaterials = materials.map((m) => {
      const h = m.clone();
      h.emissive.setRGB(0.09, 0.055, 8e-3);
      return h;
    });
    model.materials.forEach((spec, i) => {
      if (spec.operationIndicator) for (const material of [materials[i], highlightMaterials[i]]) {
        material.userData.operationIndicator = spec.operationIndicator;
        indicatorMaterials.push(material);
      }
    });
    for (const data of model.parts) {
      const group = new T.Group();
      group.name = data.id;
      scene.add(group);
      const poses = Object.fromEntries(Object.entries(data.poses).map(([k, [p2, q, s]]) => [k, { p: V(p2), q: Q(q), s: V(s) }]));
      const refdata = Object.values(data.spin)[0], reference = refdata ? { axis: V(refdata.axis).normalize(), center: V(refdata.center) } : null;
      const spin = Object.fromEntries(Object.entries(data.spin).map(([k, s]) => [k, { rate: s.rate * (config.viewer.rotationScale ?? 1) * (reference ? V(s.axis).normalize().dot(reference.axis) : 1) }]));
      const links = data.links ? data.links.map((l) => ({ pivot: V(l.pivot), axis: V(l.axis).normalize(), poses: Object.fromEntries(Object.entries(l.poses).map(([k, [a, ...t]]) => [k, { a, t: V(t) }])), a: 0, t: new T.Vector3() })) : null;
      const p = { data, group, poses, baseP: poses.stop.p.clone(), baseQ: poses.stop.q.clone(), phase: 0, reference, spin, hinge: createDoorMotion(data), batteryHinge: createDoorMotion(data, { battery: true }), family: family(data), links, stopMatrix: new T.Matrix4().compose(poses.stop.p, poses.stop.q, poses.stop.s) };
      labels.addPart(p, () => {
        tour.clear();
        inspect.select(p);
        views.sync();
      });
      const bounds = data.authoritativeBounds, center = new T.Vector3().addVectors(V(bounds.min), V(bounds.max)).multiplyScalar(0.5);
      const inverse = new T.Matrix4().compose(poses.stop.p, poses.stop.q, poses.stop.s).invert();
      p.labelPoint = center.applyMatrix4(inverse);
      parts.push(p);
    }
    orbit = new OrbitControls(camera, $("canvas"));
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.09;
    orbit.minDistance = 6;
    orbit.maxDistance = 12e3;
    orbit.target.set(0, 0, 0);
    orbit.addEventListener("start", () => {
      cam.stop();
      invalidate();
    });
    orbit.addEventListener("change", () => {
      dirty = true;
    });
    orbit.addEventListener("end", invalidate);
    raycaster = new T.Raycaster();
    const resize = () => {
      if (state.graphicsUnavailable) return;
      const r = $("stage").getBoundingClientRect();
      renderer.setPixelRatio(renderPixelRatio(r.width, r.height, devicePixelRatio));
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      if (camera.isOrthographicCamera) {
        const extent = (camera.top - camera.bottom) / 2;
        camera.left = -extent * camera.aspect;
        camera.right = extent * camera.aspect;
      }
      camera.updateProjectionMatrix();
      invalidate();
    };
    new ResizeObserver(resize).observe($("stage"));
    resize();
    cam.setProjection(preferences.projection);
    $("motionCues").checked = preferences.motionCues;
    $("toggleLabels").setAttribute("aria-pressed", state.labels);
    await packages.ensure("exterior");
    packages.ensureCassette().catch(() => {
    });
    metrics.firstExteriorMs = performance.now() - metrics.started;
    updateParts(10, 0);
    views.sync();
    inspect.search();
    for (const group of [...new Set(model.parts.map((p) => p.group))]) {
      const option = document.createElement("option");
      option.value = group;
      option.textContent = group;
      $("subsystem").append(option);
    }
    for (const key2 of ["motorAssembly", "motorCutaway", "beltDrive", "ejectMechanism", "batteryHousing", "battery", "servoBoard", "dcPower", "jackHotline", "mainAf"]) {
      const context = model.inspectionContexts?.[key2];
      if (context) {
        const b = document.createElement("button");
        b.dataset.context = key2;
        b.textContent = context.label;
        b.onclick = () => inspect.focusContext(key2);
        $("boardContexts").append(b);
      }
    }
    views.setExterior(new URLSearchParams(location.hash.slice(1)).get("exterior"));
    inspect.applyPartLink();
    $("loading").hidden = true;
    $("shell").setAttribute("aria-busy", "false");
    requestAnimationFrame(animate);
    if (window.portableTapePlayer && performance.now() - lastObservation > 500) {
      lastObservation = performance.now();
      const record = $("portable-tape-player-state");
      if (record) record.textContent = JSON.stringify(window.portableTapePlayer.snapshot());
    }
    for (const group of explodedLayout.groups) labels.addAssembly(group, () => {
      inspect.select(parts.find((p) => p.data.id === group.partIds[0]));
      views.sync();
    });
    transport.installPointers();
    Object.defineProperty(window, "portableTapePlayer", { value: Object.freeze({ snapshot({appearance = false} = {}) {
      const values = Object.fromEntries(Object.entries(state).filter(([key2, value]) => key2 !== "selected" && (value === null || ["number", "string", "boolean"].includes(typeof value))));
      const rect = $("canvas").getBoundingClientRect();
      const controls = Object.fromEntries(Object.keys(CONTROL_BINDINGS).map((id) => {
        const p = parts.find((p2) => p2.data.id === id);
        if (!p?.loaded || !p.group.visible) return [id, null];
        const box = new T.Box3();
        expandVisiblePartBounds(box, p);
        const point = box.getCenter(new T.Vector3()).project(camera);
        const x = rect.left + (point.x + 1) * rect.width / 2, y = rect.top + (1 - point.y) * rect.height / 2;
        return [id, { x, y, inFrustum: point.z >= -1 && point.z <= 1 && point.x >= -1 && point.x <= 1 && point.y >= -1 && point.y <= 1, axis: transport.controlScreenAxis(id) }];
      }));
      const lettering = packages.draws.filter((m) => m.userData.versions).map((m) => m.userData.part.data.id + " " + m.userData.versions.join("+") + (m.visible ? " shown" : " hidden")).sort();
      return JSON.parse(JSON.stringify({ ready: true, state: { ...values, selectedId: state.selected?.data.id || null }, lettering, loaded: [...packages.loaded], renderedFrames: frameNumber, packageErrors: metrics.packageErrors, diagnostics: sessionDiagnostics(), ...(appearance ? {appearanceInvariant: appearanceSnapshot()} : {}), controls, parts: parts.map((p) => ({ id: p.data.id, visible: p.group.visible, position: p.group.position.toArray(), quaternion: p.group.quaternion.toArray(), scale: p.group.scale.toArray(), phase: p.phase, deformation: p.group.children.filter((m) => m.userData.deformationWeights).map((m) => m.userData.deformationWeights) })) }));
    } }), writable: false, configurable: false });
  } catch (err) {
    console.error(err);
    Object.defineProperty(window, "portableTapePlayerError", { value: String(err), writable: false });
    markGraphicsUnavailable(err.message);

  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) transport.cancelControlHold();
  lastTime = performance.now();
  audio.setVisibility(!state.graphicsUnavailable && !document.hidden);
  invalidate();
});
