// Which view is showing (assembled, service, exploded, by category), which drawer is open and what
// a click on the model does, section cuts, part visibility, the accessories, and keeping the page
// controls in step with the state.
// It is given the other controllers it calls (camera, transport, packages) and the few things it
// needs from the tour and the inspector when a view changes.
import * as T from "three";
import {cancelStopCycle, cancelAutoStop} from "./operating-state.mjs";
import {TOUR_SECONDS} from "./tour-timeline.mjs";
import config from "../config/model.json" with {type: "json"};

// One availability flag and selector keep controls and their handlers consistent after a graphics failure.
export const GRAPHICS_CONTROLS = '#accessories, #cells, #showAll, [data-plug], [data-mode], [data-view], #viewMenu, [data-angle], [data-category], [data-context], #tour, #tourNext, #tourPause, #pause, #reset, #spread, #speed, #motionCues, #toggleLabels, #projection, #section, #sectionOffset, #subsystem, #homeCamera, #controlCamera, #inspectCassette, #batteryDoor, #eject, #door, #cassette, #focus, #isolate, #clearContext, #audioSource, #hotline, #volumeLeft, #volumeRight, #tone, #tapePosition, #tourSeek, #retryAssets';
export function syncUnavailable($, state, model) {
  if (!state.graphicsUnavailable) return false;
  $("shell").setAttribute("aria-busy", "false");
  $("loading").hidden = false;
  $("loading").dataset.unavailable = "true";
  $("loadingTitle").textContent = "3D unavailable; parts catalog available.";
  document.body.dataset.drawer = "parts";
  for (const b of document.querySelectorAll("button[data-drawer]")) b.setAttribute("aria-pressed", String(b.dataset.drawer === "parts"));
  $("loading").querySelector(".spinner").hidden = true;
  $("loadingRetry").hidden = false;
  $("retryAssets").hidden = true;
  $("packageStatus").hidden = true;
  $("partCount").textContent = model ? model.parts.length + " components · catalog only" : "Embedded parts list available";
  $("cassetteVariantStatus").textContent = model ? "Cassette choice applies to catalog details." : "Cassette metadata unavailable.";
  $("status").textContent = "";
  $("fps").textContent = "";
  $("story").hidden = true;
  $("storyTitle").textContent = "Explore the parts catalog";
  $("storyText").textContent = model ? "Search components, select a variant and copy details or contribute evidence." : "Model metadata did not load. The embedded parts list, filters, CSV and contribution actions remain available; component finder and measured details are unavailable.";
  for (const control of document.querySelectorAll(GRAPHICS_CONTROLS)) control.disabled = true;
  for (const id of ["search", "clearSearch", "cassetteVariant", "exteriorVersion"]) $(id).disabled = !model;
  $("canvas").tabIndex = -1;
  $("partLabels").hidden = true;
  $("assemblyLegend").hidden = true;
  return true;
}

// The cells are the accessory with no plug; they go in and out by themselves.
const plugAssemblies = new Set(Object.values(config.accessories.plugs).map((plug) => plug.assembly));
export const isCell = (part) => part.accessory && !plugAssemblies.has(part.data.assembly);

const descriptions = {
  all: ["A small machine, opened up", "Turn the model with your mouse. Run the transport, open the cassette door, or move the covers aside to see how the mechanism fits together."],
  motor: ["01 / The source of motion", "The motor turns the flywheel through a belt. The heavy flywheel keeps the capstan turning steadily."],
  belts: ["02 / Following the drive", "Follow the white mark around each black belt to see which way it runs. Slow the motion down in Explore to see it clearly. The marks are drawn on; real belts have none."],
  gears: ["03 / Switching direction", "The gears and the clutch turn the reels. Fast forward and rewind change which wheels drive them. Gears that mesh turn opposite ways. Part of the rewind drive is a stand-in."],
  tape: ["04 / At the tape", "PLAY moves the head and the pinch roller up to the tape. The capstan and roller pull the tape and the take-up reel winds it in. Open the door to lift the cassette out."],
  controls: ["05 / Beneath the buttons", "Watch the keys go down and come back. STOP lets go of PLAY before the door and the cassette move. The links hidden behind the keys are guesses."]
};

// onExterior() runs after the exterior version changes, so the inspector can show the part as that version has it.
export function createViews({ $, state, parts, stage, packages, cam, transport, audio, invalidate, clearTour, tourPosition, tourSteps, clearInspectionContext, select, onExterior }) {
  function setUIMode(mode) {
    if (state.graphicsUnavailable) {
      if (mode === "inspect") { state.uiMode = mode; document.body.dataset.mode = mode; }
      syncUnavailable($, state, stage.model); return;
    }
    if (!stage.renderer) return;
    transport.cancelControlHold();
    state.uiMode = mode;
    document.body.dataset.mode = mode;
    if (mode === "inspect") packages.ensureAll();
    if (mode !== "tour") clearTour();
    sync();
  }
  /** Opens one drawer ("explore", "parts", "about") or closes them (""). With Parts open, a click on the model selects a part; otherwise it works the player. */
  function setDrawer(name = "") {
    const was = document.body.dataset.drawer || "";
    document.body.dataset.drawer = name;
    for (const b of document.querySelectorAll("button[data-drawer]")) b.setAttribute("aria-pressed", String(b.dataset.drawer === name));
    if (name === "parts" && state.uiMode !== "inspect" && state.contextKey !== "ejectMechanism") setUIMode("inspect");
    else if (was === "parts" && name !== "parts") {
      if (!state.isolate) select(null);   // an isolated part stays on its own; Show all parts brings the rest back
      if (state.uiMode === "inspect" && !state.contextKey) setUIMode("operate");
    }
    showAllButton();
    invalidate();
  }
  // Beside the model while it shows only some of its parts (an isolated part, an assembly, a subsystem) and Parts,
  // which has its own way back, is closed.
  function showAllButton() {
    $("showAll").hidden = !(state.isolate || state.contextIds || state.subsystem !== "all") || document.body.dataset.drawer === "parts";
  }
  function applySection() {
    if (state.graphicsUnavailable || !stage.renderer) return;
    const axis = state.section;
    stage.renderer.clippingPlanes = axis === "off" ? [] : [new T.Plane(new T.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0), -state.sectionOffset)];
    invalidate();
  }
  function sync() {
    if (syncUnavailable($, state, stage.model)) return;
    const { model } = stage;
    invalidate();
    audio.sync(state);
    $("tapePosition").value = state.tapePosition;
    $("tapeValue").textContent = Math.round(state.tapePosition * 100) + "%";
    $("stage").dataset.view = state.view;
    const separated = state.explode > 0 || state.radial > 0;
    stage.syncBackdrop?.();
    for (const el of document.querySelectorAll("button[data-mode]")) {
      el.setAttribute("aria-pressed", el.dataset.mode === state.mode);
      el.disabled = state.explode > 1e-3 || state.radial > 1e-3;
    }
    for (const el of document.querySelectorAll("button[data-view]")) el.setAttribute("aria-pressed", el.dataset.view === state.view);
    $("viewMenu").value = state.view;
    // The Actions menu: each item names what it will do next.
    $("batteryDoor").textContent = state.batteryOpen ? "Close battery cover" : "Open battery cover";
    $("batteryDoor").setAttribute("aria-pressed", state.batteryOpen);
    $("door").textContent = state.door ? "Close cassette door" : "Open cassette door";
    $("cassette").textContent = state.media === "removed" ? "Put cassette in" : "Remove cassette";
    $("cells").textContent = state.cells ? "Remove batteries" : "Put batteries in";
    $("accessories").textContent = state.accessories ? "Hide accessories" : "Show accessories";
    $("accessories").setAttribute("aria-pressed", String(state.accessories));
    for (const id of ["batteryDoor", "door", "cassette", "cells"]) $(id).disabled = separated;
    // The transport line shows only when there is something to say.
    const notes = [separated ? "Taken apart, transport off" : state.paused ? "Paused" : { stop: "", play: "Playing", ff: "Fast forward", rew: "Rewinding" }[state.mode]];
    if (!separated) {
      if (state.ejectNeedsOpenCover) notes.push("Open the cassette door, then press stop / eject");
      else if (state.stopCycle) notes.push(state.stopCycle.kind === "stop" ? "Releasing the transport" : "Eject stroke");
      else if (state.autoStop) notes.push("End of the tape: automatic shut-off");
      if (state.mode !== "stop" && state.media !== "loaded") notes.push("No cassette");
    }
    $("status").textContent = notes.filter(Boolean).join(" · ");
    $("pause").textContent = state.paused ? "Resume motion" : "Pause motion";
    $("spread").value = Math.round(Math.max(state.explode, state.radial) * 100);
    $("spreadValue").textContent = Math.round(Math.max(state.explode, state.radial) * 100) + "%";
    $("tour").textContent = state.tour >= 0 ? "End tour" : "Start guided tour";
    $("tourNext").hidden = state.tour < 0;
    $("tourPause").hidden = state.tour < 0;
    $("tourPause").textContent = state.paused ? "Resume tour" : "Pause tour";
    $("tourSeek").value = tourPosition();
    $("tourClock").textContent = Math.floor(tourPosition()) + " / " + TOUR_SECONDS + " s";
    for (const el of document.querySelectorAll("[data-category]")) el.setAttribute("aria-pressed", el.dataset.category === state.category);
    $("volumeLeft").value = state.volumeLeft;
    $("volumeRight").value = state.volumeRight;
    $("tone").value = state.tone;
    $("hotline").setAttribute("aria-pressed", state.hotline);
    $("audioSource").value = state.audioEnabled ? state.audioSource : "mute";
    const [title, desc] = state.tour >= 0 ? [tourSteps[state.tour].title, tourSteps[state.tour].text] : state.contextKey === "ejectMechanism" ? ["STOP / EJECT linkage", model.inspectionContexts.ejectMechanism.description] : descriptions[state.category] || descriptions.all;
    $("storyTitle").textContent = title;
    $("storyText").textContent = desc;
    $("story").hidden = !(state.tour >= 0 || state.category !== "all" || state.contextKey === "ejectMechanism");   // a caption only while there is a story to tell
    $("partCount").textContent = model ? model.inventory.physicalIds.length + " parts" + (state.accessories && model.inventory.accessoryIds?.length ? ", and " + model.inventory.accessoryIds.length + " accessory parts" : "") : "Loading model";
    // The accessories plug in from the assembled view.
    const unpluggable = state.view !== "assembled" || separated;
    for (const el of document.querySelectorAll("[data-plug]")) { el.disabled = unpluggable; el.title = unpluggable ? "Plug in from the assembled view" : ""; el.value = state[el.dataset.plug]; }
    updateVisibility();
  }
  // Cancel immediately: the frame loop does not advance mechanical state while
  // separated, and a slider can separate and reassemble before another frame.
  function prepareViewChange(fromTour = false) {
    cancelStopCycle(state);
    cancelAutoStop(state);
    state.ejectNeedsOpenCover = false;
    transport.cancelControlHold();
    if (!fromTour) clearTour();
  }
  function setSeparation(value) {
    if (state.graphicsUnavailable) return;
    const {camera, orbit} = stage;
    if (!camera || !Number.isFinite(value)) return;
    value = Math.max(0, Math.min(1, value));
    prepareViewChange();
    const radial = state.view === "exploded";
    state.radial = radial ? value : 0;
    state.explode = radial ? 0 : value;
    state.view = value ? radial ? "exploded" : "catalog" : "assembled";
    state.mode = "stop";
    if (value > 0.08 && camera.position.distanceTo(orbit.target) < 800) cam.preset(state.view);
    if (value === 0) cam.preset("assembled");
    sync();
  }
  function setView(view, fromTour = false) {
    if (state.graphicsUnavailable) return;
    if (!stage.camera) return;
    prepareViewChange(fromTour);
    $("controlCamera").value = "";
    state.view = view;
    clearInspectionContext();
    if (view !== "assembled") packages.ensureAll();
    state.explode = view === "catalog" ? 1 : 0;
    state.radial = view === "exploded" ? 1 : 0;
    if (view === "catalog" || view === "exploded") {
      state.mode = "stop";
      state.isolate = false;
      state.subsystem = "all";
      $("subsystem").value = "all";
      state.category = "all";
      state.section = "off";
      $("section").value = "off";
      applySection();
      select(null);
    }
    if (view === "assembled") {
      state.isolate = false;
      state.category = "all";
      select(null);
      updateVisibility();
    }
    cam.preset(view);
    sync();
  }
  function focusCategory(category, fromTour = false) {
    if (!stage.camera) return;
    if (!fromTour) clearTour();
    if (category === "all" && !fromTour) {
      setView("assembled");
      return;
    }
    clearInspectionContext();
    state.category = category;
    state.isolate = false;
    select(null);
    if (category !== "all") {
      packages.ensureAll();
      state.view = "service";
      state.explode = 0;
      state.radial = 0;
      cam.to([0, category === "motor" ? 35 : 5, -5], category === "motor" ? [15, 60, -190] : [55, 55, -245]);
    }
    updateVisibility();
    sync();
  }
  function updateVisibility() {
    if (syncUnavailable($, state, stage.model)) return;
    const { materials, highlightMaterials } = stage;
    for (const p of parts) {
      const covered = state.view === "assembled" && !state.door && !state.batteryOpen && state.uiMode === "operate" && !state.selected && state.subsystem === "all";
      p.group.visible = (!covered || p.data.package === "exterior" || p.family === "tape") && (!state.isolate || p === state.selected) && (state.subsystem === "all" || p.data.group === state.subsystem) && (!state.contextIds || state.contextIds.includes(p.data.id)) && (!p.accessory || (isCell(p) ? state.cells : state.accessories));
      const highlighted = p === state.selected || state.category !== "all" && p.family === state.category;
      for (const m of p.group.children) {
        m.material = m.userData.cueMaterials?.[highlighted ? 1 : 0] || (highlighted ? highlightMaterials : materials)[m.userData.materialIndex];
        if (p.data.is_cassette) m.visible = m.userData.variant === (state.cassetteVariant === "refined" && packages.loaded.has("cassette") ? "refined" : "original");
      if (m.userData.versions) m.visible = m.userData.versions.includes(state.exterior);   // lettering that only some exterior versions show
      }
    }
    $("isolate").textContent = state.isolate ? "Show all parts" : "Isolate part";
    showAllButton();
    invalidate();
  }
  function controlCloseup(key) {
    if (state.graphicsUnavailable) return;
    if (!stage.camera || !key) return;
    transport.cancelControlHold();
    clearTour();
    clearInspectionContext();
    state.view = state.view === "service" ? "service" : "assembled";
    state.explode = 0;
    state.radial = 0;
    state.category = "all";
    state.subsystem = "all";
    state.section = "off";
    $("subsystem").value = "all";
    $("section").value = "off";
    state.isolate = false;
    select(null);
    // The headphones and the adapter stand where these close-ups look from: put them away (the cells stay in).
    if (state.accessories) { state.accessories = false; for (const plug in config.accessories.plugs) state[plug] = "out"; }
    setUIMode("operate");
    applySection();
    cam.controlView(key);
    sync();
  }

  /** Shows another exterior version. Only lettering changes; nothing else about the session does. */
  function setExterior(version) {
    const exterior = stage.model?.exterior;
    if (!exterior?.versions.includes(version)) return;
    state.exterior = version;
    $("exteriorVersion").value = version;
    const params = new URLSearchParams(location.hash.slice(1));
    if (version === exterior.default) params.delete("exterior"); else params.set("exterior", version);
    history.replaceState(null, "", location.pathname + location.search + (params.size ? "#" + params : ""));
    updateVisibility();
    onExterior();
  }

  /** Shows or hides the accessories (headphones, adapter, cells). */
  function setAccessories(on) {
    state.accessories = state.cells = Boolean(on);
    if (!state.accessories) for (const key in config.accessories.plugs) state[key] = "out";   // shown again, they start unplugged
    sync();
  }
  /** Puts the two cells in the battery case or takes them out; the battery springs follow them. */
  function setCells(on) {
    state.cells = Boolean(on);
    sync();
  }
  /** Plugs an accessory into one of its sockets, or unplugs it ("out"). Plugging in shows the accessories. */
  function setPlug(key, value) {
    if (!(value === "out" || value in config.accessories.plugs[key].states)) return;
    if (value !== "out" && !state.accessories) {
      state.accessories = true;
      if (state.view === "assembled") cam.preset("assembled");   // step back to take the accessories in
    }
    if (!state.accessories) return;
    state[key] = value;
    sync();
  }
  for (const el of document.querySelectorAll("[data-plug]"))   // the choices, from the config
    el.replaceChildren(...Object.entries(config.accessories.plugs[el.dataset.plug].choices).map(([value, text]) => new Option(text, value)));
  return { setUIMode, setDrawer, applySection, sync, setView, setSeparation, focusCategory, updateVisibility, controlCloseup, setExterior, setAccessories, setCells, setPlug };
}
