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
// A menu item does the step it needs first: the door before the cassette, the cover before the batteries.
let followUp = 0;
function then(milliseconds, step) {
  clearTimeout(followUp);
  followUp = setTimeout(() => { step(); views.sync(); }, milliseconds);
}
$("cassette").onclick = () => {
  tour.clear();
  const inserted = state.media === "removed";
  if (state.door) transport.operation({ type: "cassette", inserted });
  else {
    transport.operation({ type: "door", open: true });
    then(700, () => { if (state.door) transport.operation({ type: "cassette", inserted }); });
  }
  packages.ensure("mechanism").catch(() => {
  });
  views.sync();
};
$("cells").onclick = () => {
  tour.clear();
  const put = !state.cells;
  if (state.batteryOpen) views.setCells(put);
  else {
    transport.modelAction(config.roles.batteryDoor[0], "click");
    then(900, () => { if (state.batteryOpen) views.setCells(put); });
  }
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
$("showAll").onclick = () => {
  state.isolate = false;
  state.subsystem = "all";
  $("subsystem").value = "all";
  inspect.clearInspectionContext();
  inspect.select(null);
  views.updateVisibility();
  cam.preset(state.view);
  views.sync();
};
$("tour").onclick = () => {
  if (state.tour >= 0) {
    tour.clear();
    views.sync();
  } else {
    reset();
    if (document.body.dataset.drawer === "parts" || narrow.matches) views.setDrawer("");   // its caption shows over the model
    views.setUIMode("tour");
    tour.seek(0);
  }
};
$("tourNext").onclick = () => {
  state.tapeRevision++;
  tour.seek(tour.steps.slice(0, state.tour + 1).reduce((sum, s) => sum + s.duration, 0));
};
// The model alone: the page's rows and drawers go, and the browser's full screen is used where it has one.
function setSolo(on) {
  document.body.classList.toggle("solo", on);
  const label = on ? "Show the controls again" : "Show the model alone";
  $("fullscreen").setAttribute("aria-pressed", String(on));
  $("fullscreen").setAttribute("aria-label", label);
  $("fullscreen").title = label;
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch(() => {
  });
  if (!on && document.fullscreenElement) document.exitFullscreen?.();
  invalidate();
}
$("fullscreen").onclick = () => setSolo(!document.body.classList.contains("solo"));
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) setSolo(false);
});
// The drawers, one at a time.
for (const b of document.querySelectorAll("button[data-drawer]")) b.onclick = () => views.setDrawer(document.body.dataset.drawer === b.dataset.drawer ? "" : b.dataset.drawer);
$("closeDrawer").onclick = () => views.setDrawer("");
$("viewMenu").onchange = (e) => views.setView(e.target.value);
// The two popup menus of the bottom row. A press anywhere else closes them.
const menus = [["actionsButton", "actionsMenu"], ["moreControls", "moreMenu"]].map(([button, menu]) => {
  const set = (open) => {
    $(menu).hidden = !open;
    $(button).setAttribute("aria-expanded", String(open));
  };
  $(button).onclick = () => set($(menu).hidden);
  document.addEventListener("pointerdown", (e) => {
    if (!$(menu).hidden && !$(menu).contains(e.target) && !$(button).contains(e.target)) set(false);
  });
  return { set, get open() { return !$(menu).hidden; } };
});
// In a narrow window the version, the sound choice, the volume and the tone go into the More menu.
const narrow = matchMedia("(max-width: 939px)");
function placeControls() {
  (narrow.matches ? $("moreMenu") : $("versionSlot")).append($("exteriorVersion"));
  (narrow.matches ? $("moreMenu") : $("soundSlot")).append($("soundGroup"));
  if (!narrow.matches) menus[1].set(false);
}
narrow.addEventListener("change", placeControls);
placeControls();
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
  if (e.key === "Escape") {   // closes what is open, one thing at a time
    const menu = menus.find((m) => m.open);
    if (menu) { menu.set(false); return; }
    if (document.body.classList.contains("solo")) { setSolo(false); return; }
    const busy = Boolean(state.selected) || state.tour >= 0 || state.isolate;
    tour.clear();
    state.isolate = false;
    inspect.dismiss();
    views.updateVisibility();
    views.sync();
    if (!busy && document.body.dataset.drawer) views.setDrawer("");
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
$("projection").onchange = (e) => cam.setProjection(e.target.value);
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
// The page opens with the music chosen. A browser lets sound start only after a press, so the first press anywhere
// starts it; a press after the browser blocked it tries again.
function wakeSound() {
  if (state.audioEnabled && !state.graphicsUnavailable && ["off", "blocked"].includes(audio.status.state)) audio.enable(state);
}
for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, wakeSound, true);
// One choice: mute, the tape's music, or the test tone. Choosing a sound turns the sound on.
$("audioSource").oninput = async (e) => {
  const value = e.target.value, on = value !== "mute";
  if (on) transport.operation({ type: "audio-source", value });
  transport.operation({ type: "audio-enable", enabled: on });
  if (on) await audio.enable(state);
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
$("accessories").onclick = () => {
  views.setAccessories(!state.accessories);
  if (state.view === "assembled") cam.preset("assembled");   // step back to take them in, or forward again
};
for (const el of document.querySelectorAll("[data-plug]")) el.onchange = () => views.setPlug(el.dataset.plug, el.value);
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
$("audioDuration").textContent = Math.round(state.tapeDuration / 60);
// Guard callbacks as well as native disabled controls, including synthetic events.
for (const control of document.querySelectorAll(GRAPHICS_CONTROLS)) for (const event of ["onclick", "oninput", "onchange"]) {
  const callback = control[event];
  if (callback) control[event] = function(e) { if (!state.graphicsUnavailable) return callback.call(this, e); };
}
init();
