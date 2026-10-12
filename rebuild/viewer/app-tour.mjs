// The guided tour: a timeline of steps, each with a view, a transport mode and a caption.
// It owns where the tour is. Showing a step is done through the views and camera controllers.
import * as T from "three";
import {TOUR_SECONDS, tourLocation, tourMotion} from "./tour-timeline.mjs";

const clamp = T.MathUtils.clamp;

export function createTour({ $, state, parts, steps, views, cam, invalidate }) {
  let position = 0;   // seconds from the start of the tour

  /** Ends the tour and leaves everything else as it is. */
  function clear() {
    state.tour = -1;
    $("tourProgress").textContent = "";
    $("tourPause").hidden = true;
  }

  /** Jumps to a time in the tour: shows that step and puts every turning part where it would be by then. */
  function seek(seconds) {
    const location2 = tourLocation(seconds);
    position = Math.min(TOUR_SECONDS, Math.max(0, seconds));
    if (state.tour !== location2.index) step(location2.index, true);
    const motion = tourMotion(position, steps);
    for (const p of parts) {
      const modes = p.data.is_cassette ? motion.mediaModeSeconds : motion.modeSeconds;
      p.phase = Object.entries(modes).reduce((sum, [mode, seconds2]) => sum + (p.spin[mode]?.rate || 0) * seconds2, 0) * state.speed;
    }
    state.tapePosition = clamp(motion.tapeSeconds * state.speed / state.tapeDuration, 0, 1);
    $("tourSeek").value = position;
    $("tourClock").textContent = Math.floor(position) + " / " + TOUR_SECONDS + " s";
    if (location2.ended) {
      state.paused = true;
    }
    invalidate();
  }
  function step(i, fromSeek = false) {
    if (i >= steps.length) {
      seek(TOUR_SECONDS);
      return;
    }
    const wasPaused = state.paused;
    state.tour = i;
    if (!fromSeek) position = steps.slice(0, i).reduce((sum, s) => sum + s.duration, 0);
    const now = steps[i];
    state.door = now.door || false;
    state.media = now.media || "loaded";
    state.paused = fromSeek ? wasPaused : false;
    state.mode = now.mode;
    state.subsystem = "all";
    $("subsystem").value = "all";
    views.setView(now.view, true);
    views.focusCategory(now.cat, true);
    state.view = now.view;
    state.explode = now.view === "catalog" ? 1 : 0;
    state.radial = now.view === "exploded" ? 1 : 0;
    state.section = now.section || "off";
    state.sectionOffset = 0;
    $("section").value = state.section;
    $("sectionOffset").value = 0;
    $("sectionValue").textContent = "0 mm";
    views.applySection();
    cam.preset(now.view);
    if (now.cat !== "all") views.focusCategory(now.cat, true);
    views.sync();
    $("storyTitle").textContent = now.title;
    $("storyText").textContent = now.text;
    $("tourProgress").textContent = i + 1 + " / " + steps.length;
  }

  return { clear, seek, steps, rewind: () => { position = 0; }, get position() { return position; } };
}
