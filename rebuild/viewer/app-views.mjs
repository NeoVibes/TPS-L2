// Which view is showing (assembled, service, exploded, by category), the Tour/Operate/Inspect
// switch, section cuts, part visibility, and keeping the page controls in step with the state.
// It is given the other controllers it calls (camera, transport, packages) and the few things it
// needs from the tour and the inspector when a view changes.
import * as T from "three";
import {cancelStopCycle} from "./operating-state.mjs";
import {TOUR_SECONDS} from "./tour-timeline.mjs";

const descriptions = {
  all: ["A small machine, opened up", "Turn the model with your mouse. Run the transport, open the cassette compartment, or move the covers aside to see how the mechanism fits together."],
  motor: ["01 / The source of motion", "The motor turns the belt-driven flywheel. The large flywheel helps steady the capstan’s rotation. Select any part to inspect it on its own."],
  belts: ["02 / Following the drive", "Follow one white stripe around each black belt. These illustrative motion cues follow the driving pulleys through the modeled twists and wraps. Use slow motion to inspect direction; factory timing and coupling remain unverified."],
  gears: ["03 / Switching direction", "The gear train and clutch coordinate the reels. FF and REW change the transport state. Meshing gears counter-rotate; the fast-reverse drive includes an explicitly illustrative substitute."],
  tape: ["04 / At the tape", "PLAY advances the head and pinch roller. The capstan and roller control tape travel while the take-up reel collects it. Open the door to lift and remove the cassette."],
  controls: ["05 / Beneath the buttons", "Watch the transport controls engage and release. STOP disengages playback before the door and cassette operate. Hidden selector linkages remain illustrative."]
};

// onExterior() runs after the exterior version changes, so the inspector can show the part as that version has it.
export function createViews({ $, state, parts, stage, packages, cam, transport, audio, invalidate, clearTour, tourPosition, tourSteps, clearInspectionContext, select, onExterior }) {
  function setUIMode(mode) {
    if (!stage.renderer) return;
    transport.cancelControlHold();
    state.uiMode = mode;
    document.body.dataset.mode = mode;
    for (const b of document.querySelectorAll("[data-workmode]")) b.setAttribute("aria-pressed", b.dataset.workmode === mode);
    if (mode === "inspect") packages.ensureAll();
    if (mode !== "tour") clearTour();
    sync();
  }
  function applySection() {
    const axis = state.section;
    stage.renderer.clippingPlanes = axis === "off" ? [] : [new T.Plane(new T.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0), -state.sectionOffset)];
    invalidate();
  }
  function sync() {
    const { scene, model } = stage;
    invalidate();
    audio.sync(state);
    $("tapePosition").value = state.tapePosition;
    $("tapeValue").textContent = Math.round(state.tapePosition * 100) + "%";
    $("stage").dataset.view = state.view;
    $("stageHelp").textContent = state.view === "exploded" ? "Aligned assemblies · zoom for individual IDs" : state.uiMode === "operate" && ["assembled", "service"].includes(state.view) ? "Click buttons · drag volume grips · hold Hot Line" : "Drag to orbit · scroll to zoom · click a component";
    if (scene) scene.background.set(state.view === "assembled" ? "#e9e7df" : "#34424d");
    for (const el of document.querySelectorAll("button[data-mode]")) {
      el.setAttribute("aria-pressed", el.dataset.mode === state.mode);
      el.disabled = state.explode > 1e-3 || state.radial > 1e-3;
    }
    for (const el of document.querySelectorAll("[data-view]")) el.setAttribute("aria-pressed", el.dataset.view === state.view);
    $("batteryDoor").textContent = state.batteryOpen ? "Close battery cover" : "Open battery cover";
    $("batteryDoor").setAttribute("aria-pressed", state.batteryOpen);
    $("batteryDoor").disabled = state.explode > 0 || state.radial > 0;
    $("door").textContent = state.door ? "Close door" : "Open door";
    $("cassette").textContent = state.media === "removed" ? "Insert cassette" : "Remove cassette";
    $("cassette").disabled = !state.door || (state.explode > 0 || state.radial > 0);
    $("door").disabled = state.explode > 0 || state.radial > 0;
    $("status").textContent = state.explode > 0 || state.radial > 0 ? "Disconnected · transport stopped" : (state.paused ? "Motion paused" : { stop: "Stopped", play: "PLAY · illustrative drive running", ff: "FF · illustrative fast forward", rew: "REW · illustrative reverse winding" }[state.mode]) + (state.media !== "loaded" ? " · No engaged cassette" : "") + (state.door ? " · Cover open" : "");
    if (state.ejectNeedsOpenCover) $("status").textContent += " · Open cover, then press STOP / EJECT";
    else if (state.stopCycle) $("status").textContent += " · " + (state.stopCycle.kind === "stop" ? "Releasing transport" : "Eject button stroke");
    $("pause").textContent = state.paused ? "Resume motion" : "Pause motion";
    $("spread").value = Math.round(Math.max(state.explode, state.radial) * 100);
    $("spreadValue").textContent = Math.round(Math.max(state.explode, state.radial) * 100) + "%";
    $("tour").textContent = state.tour >= 0 ? "End tour" : "Start guided tour";
    $("quickTour").textContent = state.tour >= 0 ? "End tour" : "Guided tour";
    $("tourNext").hidden = state.tour < 0;
    $("reset").textContent = "Reset";
    $("tourPause").hidden = state.tour < 0;
    $("tourPause").textContent = state.paused ? "Resume tour" : "Pause tour";
    $("tourSeek").value = tourPosition();
    $("tourClock").textContent = Math.floor(tourPosition()) + " / " + TOUR_SECONDS + " s";
    for (const el of document.querySelectorAll("[data-category]")) el.setAttribute("aria-pressed", el.dataset.category === state.category);
    $("volumeLeft").value = state.volumeLeft;
    $("volumeRight").value = state.volumeRight;
    $("tone").value = state.tone;
    $("hotline").setAttribute("aria-pressed", state.hotline);
    $("audioEnable").textContent = ["blocked", "unavailable"].includes(audio.status.state) ? "Retry test audio" : state.audioEnabled ? "Disable audio" : "Enable test audio";
    const [title, desc] = state.tour >= 0 ? [tourSteps[state.tour].title, tourSteps[state.tour].text] : state.contextKey === "ejectMechanism" ? ["STOP / EJECT linkage", model.inspectionContexts.ejectMechanism.description] : descriptions[state.category] || descriptions.all;
    $("storyTitle").textContent = title;
    $("storyText").textContent = desc;
    $("partCount").textContent = model ? model.inventory.physicalIds.length + " device parts · " + model.inventory.presentationOnlyIds.length + " display objects" : "Loading model";
    updateVisibility();
  }
  function setView(view, fromTour = false) {
    if (!stage.camera) return;
    cancelStopCycle(state);
    transport.cancelControlHold();
    $("controlCamera").value = "";
    if (!fromTour) clearTour();
    state.view = view;
    $("audioControls").open = view === "assembled";
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
      if (view === "exploded") state.labels = true;
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
    const { materials, highlightMaterials } = stage;
    for (const p of parts) {
      const covered = state.view === "assembled" && !state.door && !state.batteryOpen && state.uiMode === "operate" && !state.selected && state.subsystem === "all";
      p.group.visible = (!covered || p.data.package === "exterior" || p.family === "tape") && (!state.isolate || p === state.selected) && (state.subsystem === "all" || p.data.group === state.subsystem) && (!state.contextIds || state.contextIds.includes(p.data.id));
      const highlighted = p === state.selected || state.category !== "all" && p.family === state.category;
      for (const m of p.group.children) {
        m.material = m.userData.cueMaterials?.[highlighted ? 1 : 0] || (highlighted ? highlightMaterials : materials)[m.userData.materialIndex];
        if (p.data.is_cassette) m.visible = m.userData.variant === (state.cassetteVariant === "refined" && packages.loaded.has("cassette") ? "refined" : "original");
      if (m.userData.versions) m.visible = m.userData.versions.includes(state.exterior);   // lettering that only some exterior versions show
      }
    }
    $("isolate").textContent = state.isolate ? "Show all parts" : "Isolate part";
    invalidate();
  }
  function controlCloseup(key) {
    if (!stage.camera || !key) return;
    $("audioControls").open = true;
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

  return { setUIMode, applySection, sync, setView, focusCategory, updateVisibility, controlCloseup, setExterior };
}
