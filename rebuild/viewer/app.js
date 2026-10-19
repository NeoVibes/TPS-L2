// The page's start-up: wires every button, slider and key to its function, then starts the viewer.
// The work itself is in the app-*.mjs modules beside this file; shared state lives in app-core.mjs.
import config from "../config/model.json" with { type: "json" };
import {copyTarget} from "./part-information.mjs";
import {TOUR_SECONDS} from "./tour-timeline.mjs";
import {GRAPHICS_CONTROLS, markGraphicsUnavailable, saveViewerPreferences, motionCueEnabled, $, state, model, camera, V, audio, metrics, invalidate, cam, reset, init, packages, transport, views, inspect, tour} from "./app-core.mjs";

for (const b of document.querySelectorAll("button[data-mode]")) b.onclick = () => transport.operate(b.dataset.mode);
for (const b of document.querySelectorAll("button[data-view]")) b.onclick = () => views.setView(b.dataset.view);
for (const b of document.querySelectorAll("[data-category]")) b.onclick = () => views.focusCategory(b.dataset.category);
$("inspectCassette").onclick = () => inspect.focusContext("cassette");
$("cassetteVariant").onchange = (e) => {
  if (state.graphicsUnavailable) { state.cassetteVariant = e.target.value; inspect.refreshPartInformation(); }
  else packages.setCassetteVariant(e.target.value);
};
$("batteryDoor").onclick = () => transport.modelAction(config.roles.batteryDoor[0], "click");
$("eject").onclick = transport.stopEject;
$("door").onclick = () => {
  tour.clear();
  transport.operation({ type: "door" });
  packages.ensure("mechanism").catch(() => {
  });
  views.sync();
};
$("cassette").onclick = () => {
  tour.clear();
  transport.operation({ type: "cassette" });
  packages.ensure("mechanism").catch(() => {
  });
  views.sync();
};
$("pause").onclick = () => {
  transport.operation({ type: "pause" });
  views.sync();
};
$("reset").onclick = reset;
$("spread").oninput = (e) => views.setSeparation(+e.target.value / 100);
$("motionCues").onchange = (e) => {
  motionCueEnabled.value = e.target.checked ? 1 : 0;
  saveViewerPreferences();
  invalidate();
};
$("speed").oninput = (e) => {
  transport.operation({ type: "speed", value: +e.target.value });
  if (state.tour >= 0) {
    state.tapeRevision++;
    tour.seek(tour.position);
    audio.sync(state);
  }
  $("speedValue").textContent = state.speed.toFixed(2) + "×";
};
$("search").oninput = inspect.search;
$("focus").onclick = inspect.focusPart;
$("isolate").onclick = () => {
  state.isolate = !state.isolate;
  views.updateVisibility();
  inspect.focusPart();
};
$("closeInspector").onclick = () => inspect.dismiss();
$("tour").onclick = () => {
  if (state.tour >= 0) {
    tour.clear();
    views.sync();
  } else {
    reset();
    views.setUIMode("tour");
    tour.seek(0);
  }
};
$("tourNext").onclick = () => {
  state.tapeRevision++;
  tour.seek(tour.steps.slice(0, state.tour + 1).reduce((sum, s) => sum + s.duration, 0));
};
$("quickTour").onclick = () => $("tour").click();
$("fullscreen").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};
$("toggleLabels").onclick = () => {
  state.labels = !state.labels;
  saveViewerPreferences();
  $("toggleLabels").setAttribute("aria-pressed", state.labels);
  invalidate();
};
$("homeCamera").onclick = () => {
  if (camera) state.isolate ? inspect.focusPart() : state.contextKey ? inspect.fitInspectionContext(state.contextKey) : cam.preset(state.view);
};
for (const b of document.querySelectorAll("[data-angle]")) b.onclick = () => {
  if (!camera) return;
  if (state.contextKey === "cassette") {
    inspect.fitInspectionContext("cassette", b.dataset.angle);
    return;
  }
  if (state.view === "exploded") {
    cam.fitExploded({ front: [0, 0, 1], back: [0, 0, -1], side: [1, 0, 0], top: [0, 1, 1e-3] }[b.dataset.angle]);
    return;
  }
  const target = state.view === "catalog" ? [0, 500, 90] : [0, 0, 0], d = state.view === "catalog" ? 1850 : state.view === "service" ? 480 : 340;
  const positions = { front: [0, 0, d], back: [0, 0, -d], side: [d, 0, 0], top: [0, d, 0.01] };
  if (!positions[b.dataset.angle]) return;   // "Tape edge" belongs to the cassette view only
  cam.to(target, V(target).add(V(positions[b.dataset.angle])).toArray());
};
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.target.tagName === "SELECT") return;
  if (e.key === "Escape") {
    tour.clear();
    state.isolate = false;
    inspect.dismiss();
    views.updateVisibility();
    views.sync();
    return;
  }
  if (state.graphicsUnavailable) return;
  if (/^(INPUT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(e.target.tagName)) return;
  if (e.code === "Space") {
    e.preventDefault();
    transport.operation({ type: "pause" });
    views.sync();
  }
  if (e.key === "0") reset();
});
for (const b of document.querySelectorAll("[data-workmode]")) b.onclick = () => views.setUIMode(b.dataset.workmode);
$("tourSeek").oninput = (e) => {
  const seconds = +e.target.value;
  views.setUIMode("tour");
  state.tapeRevision++;
  tour.seek(seconds);
  views.sync();
};
$("tourPause").onclick = () => {
  transport.operation({ type: "pause" });
  views.sync();
};
$("projection").onchange = (e) => { cam.setProjection(e.target.value); saveViewerPreferences(); };
$("clearContext").onclick = () => {
  inspect.clearInspectionContext();
  inspect.select(null);
  views.updateVisibility();
  cam.preset(state.view);
};
$("subsystem").onchange = (e) => {
  state.subsystem = e.target.value;
  inspect.clearInspectionContext();
  state.isolate = false;
  packages.ensureAll();
  views.updateVisibility();
};
$("section").onchange = (e) => {
  state.section = e.target.value;
  packages.ensureAll();
  views.applySection();
};
$("sectionOffset").oninput = (e) => {
  state.sectionOffset = +e.target.value;
  $("sectionValue").textContent = state.sectionOffset + " mm";
  views.applySection();
};
async function copyText(text, button, success) {
  if (!text) return;
  const selectedDetails = inspect.copiedDetails();
  try {
    await navigator.clipboard.writeText(text);
    if (selectedDetails !== inspect.copiedDetails()) return;
    button.textContent = success;
    $("copyFallbackLabel").hidden = true;
    $("copyFallback").value = "";
  } catch {
    if (selectedDetails !== inspect.copiedDetails()) return;
    $("copyFallbackLabel").hidden = false;
    $("copyFallback").value = text;
    $("copyFallback").focus();
    $("copyFallback").select();
    button.textContent = "Select and copy below";
  }
}
$("copyPartLink").onclick = () => {
  const id = $("partId").textContent;
  if (!id) return;
  const target = copyTarget(id, location, state.exterior && state.exterior !== model?.exterior?.default ? "&exterior=" + state.exterior : "");
  return copyText(target.text, $("copyPartLink"), target.kind === "id" ? "Part ID copied" : "Public link copied");
};
$("copyPartDetails").onclick = () => copyText(inspect.copiedDetails(), $("copyPartDetails"), "Part details copied");
$("audioEnable").onclick = async () => {
  transport.operation({ type: "audio-enable", enabled: ["blocked", "unavailable"].includes(audio.status.state) || !state.audioEnabled });
  if (state.audioEnabled) await audio.enable(state);
  views.sync();
};
for (const channel of ["Left", "Right"]) $("volume" + channel).oninput = (e) => transport.operation({ type: "volume", channel: channel.toLowerCase(), value: +e.target.value });
$("tone").oninput = (e) => {
  transport.operation({ type: "tone", value: e.target.value });
  views.sync();
};
$("controlCamera").onchange = (e) => views.controlCloseup(e.target.value);
$("tapePosition").oninput = (e) => {
  transport.operation({ type: "seek", position: +e.target.value });
  views.sync();
};
$("retryAssets").onclick = () => {
  packages.ensureAll();
  $("retryAssets").hidden = true;
};
$("loadingRetry").onclick = () => location.reload();
$("performance").onclick = () => {
  $("performanceReadout").textContent = JSON.stringify({ device: metrics.device, firstExteriorMs: Math.round(metrics.firstExteriorMs), loaded: [...packages.loaded], sample: metrics.sampleKey, frames: metrics.frames.length, meanFrameMs: metrics.frames.length ? metrics.frames.reduce((s, v) => s + v.interval, 0) / metrics.frames.length : null, memoryBytes: performance.memory?.usedJSHeapSize || "Unavailable in this browser", downloadBytes: Object.values(packages.files).reduce((s, p) => s + p.bytes, 0), physicalPhoneTest: "Not performed" }, null, 2);
};
$("exteriorVersion").onchange = (e) => views.setExterior(e.target.value);
window.addEventListener("hashchange", () => {
  views.setExterior(new URLSearchParams(location.hash.slice(1)).get("exterior") || model?.exterior?.default);
  inspect.applyPartLink();
});
window.addEventListener("blur", transport.cancelControlHold);
$("canvas").addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  markGraphicsUnavailable("The graphics context was lost.");
});
$("canvas").addEventListener("keydown", (e) => {
  if (!state.graphicsUnavailable && cam.handleKey(e.key)) e.preventDefault();
});
$("tourSeek").max = TOUR_SECONDS;
$("tourDuration").textContent = TOUR_SECONDS + "-second tour ";
for (const key of ["min", "max", "step"]) $("speed")[key] = config.viewer.speedSlider[key];
$("speed").value = state.speed;
$("speedValue").textContent = state.speed.toFixed(2) + "×";
$("audioDuration").textContent = state.tapeDuration;
// Guard callbacks as well as native disabled controls, including synthetic events.
for (const control of document.querySelectorAll(GRAPHICS_CONTROLS)) for (const event of ["onclick", "oninput", "onchange"]) {
  const callback = control[event];
  if (callback) control[event] = function(e) { if (!state.graphicsUnavailable) return callback.call(this, e); };
}
init();
