// Inspect mode: searching, selecting and focusing parts, service-manual fields, part links,
// and the named groups of parts ("contexts") such as the motor assembly.
// It owns the service catalogue and the selection. It is given the camera, views and packages
// controllers, and three things from the core: clearTour, reset and updateParts.
import config from "../config/model.json" with { type: "json" };
import {displayName, finderResults, copyTarget, serviceSearchEntries, serviceEntriesForPart, serviceFields} from "./part-information.mjs";
import {fitBoxDistance} from "./fit-camera.mjs";
import {parseServiceCatalog} from "./service-catalog.mjs";
import serviceCatalogCsv from "../../edit/service-manual-parts.csv";
import * as T from "three";

const V = (a) => new T.Vector3().fromArray(a);
export const serviceCatalog = parseServiceCatalog(serviceCatalogCsv);

/** Grows a box to hold the visible meshes of a part, where they are now. */
export function expandVisiblePartBounds(box, part) {
  for (const mesh of part.group.children) if (mesh.visible && mesh.geometry) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  return box;
}
/** One line naming a service-manual entry: its Ref. No., Part No. and description. */
export function serviceLabel(entry) {
  return serviceFields(entry).map(([label, value]) => label + ": " + value).join(" · ");
}

// onPartShown(partId) lets the master list add the part's confirmation level to the inspector.
export function createInspect({ $, state, parts, stage, packages, cam, views, clearTour, reset, updateParts, onPartShown }) {
  // Links carry the exterior version when it is not the default one.
  const versionSuffix = () => state.exterior && state.exterior !== stage.model?.exterior?.default ? "&exterior=" + state.exterior : "";
  function clearInspectionContext() {
    $("cassetteEdge").hidden = true;
    state.contextIds = null;
    state.contextKey = null;
    $("clearContext").hidden = true;
    $("contextStatus").textContent = "";
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.has("context")) {
      params.delete("context");
      history.replaceState(null, "", location.pathname + location.search + (params.size ? "#" + params : ""));
    }
  }
  async function focusContext(key) {
    const { model, scene } = stage, context = model.inspectionContexts[key];
    if (!context) return;
    reset();
    views.setUIMode(key === "ejectMechanism" ? "operate" : "inspect");
    state.contextIds = context.partIds;
    state.contextKey = key;
    $("cassetteEdge").hidden = key !== "cassette";
    state.paused = !["motorCutaway", "beltDrive", "ejectMechanism"].includes(key);
    if (key === "ejectMechanism") {
      state.door = true;
      state.media = "removed";
      $("storyTitle").textContent = "STOP / EJECT linkage";
      $("storyText").textContent = context.description;
    }
    views.updateVisibility();
    $("contextStatus").textContent = context.label + " · " + context.partIds.length + " parts in assembled positions. " + context.description;
    $("clearContext").hidden = false;
    await packages.ensureAll();
    if (state.contextIds !== context.partIds) return;
    updateParts(100, 0);
    scene.updateMatrixWorld(true);
    const selected = parts.find((p) => p.data.id === context.focusPartId) || parts.find((p) => context.partIds.includes(p.data.id));
    select(key.startsWith("service:") || ["motorAssembly", "motorCutaway", "beltDrive", "ejectMechanism"].includes(key) ? null : selected);
    fitInspectionContext(key);
    history.replaceState(null, "", location.pathname + location.search + "#context=" + encodeURIComponent(key) + "&part=" + encodeURIComponent(selected?.data.id || "") + versionSuffix());
    views.sync();
  }
  function fitInspectionContext(key, angle = "three-quarter") {
    const { model, scene, camera } = stage, context = model.inspectionContexts[key];
    if (!context) return;
    scene.updateMatrixWorld(true);
    const box = new T.Box3();
    for (const p of parts) if (context.partIds.includes(p.data.id) && (!["battery", "batteryHousing"].includes(key) || context.focusBoundsIds.includes(p.data.id))) expandVisiblePartBounds(box, p);
    const center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
    if (key === "cassette") {
      camera.up.set(-1, 0, 0);
      const halfFov = Math.tan(16 * Math.PI / 180), d = Math.max(size.x, size.y / camera.aspect) / (2 * halfFov) * 1.25;
      const direction = { front: [0, 0, 1], back: [0, 0, -1], side: [0, 1, 0.06], top: [-1, 0, 0.06], edge: [1, 0, 0.15], "three-quarter": [0.6, 0.28, 1] }[angle] || [0.6, 0.28, 1];
      cam.to(center.toArray(), center.clone().addScaledVector(V(direction).normalize(), d).toArray());
    } else if (key === "ejectMechanism") {
      box.makeEmpty();
      for (const p of parts) if (config.roles.ejectFocus.includes(p.data.id)) expandVisiblePartBounds(box, p);
      box.getCenter(center);
      camera.up.set(0, 0, 1);
      const direction = V([0.45, 0.8, 0.55]).normalize(), d = fitBoxDistance(box, direction, camera.up, camera.aspect);
      cam.to(center.toArray(), center.clone().addScaledVector(direction, d).toArray());
    } else if (["motorAssembly", "motorCutaway"].includes(key)) {
      camera.up.set(0, 0, 1);
      const direction = V([0.75, -0.8, -0.35]).normalize(), d = fitBoxDistance(box, direction, camera.up, camera.aspect);
      cam.to(center.toArray(), center.clone().addScaledVector(direction, d).toArray());
    } else if (["battery", "batteryHousing"].includes(key)) {
      camera.up.set(0, 1, 0);
      const forward = V([0.25, -0.5, -1]).normalize(), right = new T.Vector3().crossVectors(camera.up, forward).normalize(), up = new T.Vector3().crossVectors(forward, right), tan = Math.tan(16 * Math.PI / 180);
      let distance = 0;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const v = new T.Vector3(x, y, z).sub(center), depth = v.dot(forward);
        distance = Math.max(distance, depth + Math.abs(v.dot(right)) / (tan * camera.aspect * 0.8), depth + Math.abs(v.dot(up)) / (tan * 0.78));
      }
      cam.to(center.toArray(), center.clone().addScaledVector(forward, distance).toArray());
    } else {
      camera.up.set(0, 1, 0);
      const direction = V([0, 0.2, -1]).normalize(), d = fitBoxDistance(box, direction, camera.up, camera.aspect);
      cam.to(center.toArray(), center.clone().addScaledVector(direction, d).toArray());
    }
  }
  function showServiceFields(partId) {
    const target = $("partService");
    target.replaceChildren();
    // For a part whose lettering differs between exterior versions, only the manual's entry for the version on screen is shown.
    const shown = serviceEntriesForPart(serviceCatalog, partId).filter((entry) => !entry.partStates?.[partId] || entry.partStates[partId].some((s) => s.split("+").includes(state.exterior) || s === "original" || s === "detailed"));
    for (const entry of shown) {
      const block = document.createElement("section"), heading = document.createElement("h3");
      heading.textContent = entry.partIds.length > 1 ? "Service item containing this component" : "Service catalog";
      block.append(heading);
      const fields = document.createElement("dl");
      for (const [label, value] of serviceFields(entry)) {
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        fields.append(dt, dd);
      }
      block.append(fields);
      target.append(block);
    }
    target.hidden = !target.children.length;
  }
  async function focusServiceEntry(entry) {
    const active = entry.partIds.filter((id) => parts.some((p) => p.data.id === id));
    if (!active.length) return;
    if (entry.contextKey) {
      await focusContext(entry.contextKey);
      return;
    }
    if (active.length === 1) {
      clearTour();
      clearInspectionContext();
      views.setUIMode("inspect");
      const part = parts.find((p) => p.data.id === active[0]);
      select(part);
      await packages.ensure(part.data.package);
      if (state.selected === part) focusPart();
      views.sync();
      return;
    }
    const key = "service:" + entry.id;
    stage.model.inspectionContexts[key] = { label: entry.description, description: serviceLabel(entry), partIds: active, focusPartId: active[0] };
    await focusContext(key);
  }
  function refreshPartInformation(part) {
    showServiceFields(part.data.id);
    onPartShown(part.data.id);
    const dims = part.data.authoritativeBounds?.dimensions;
    $("partMeasure").textContent = dims ? "Model extents (assembly axes): " + dims.map((x) => x.toFixed(3)).join(" × ") + " mm." : "";
    $("copyPartLink").textContent = copyTarget(part.data.id, location, versionSuffix()).label;
    $("copyFallbackLabel").hidden = true;
  }
  function applyPartLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    const context = params.get("context");
    if (context && stage.model.inspectionContexts?.[context]) {
      focusContext(context);
      return;
    }
    const id = params.get("part");
    if (id) {
      const p = parts.find((p2) => p2.data.id === id);
      if (p) {
        views.setUIMode("inspect");
        select(p);
        packages.ensure(p.data.package).then(focusPart).catch(() => {
        });
      }
    }
  }
  function select(part) {
    state.selected = part;
    if (!part) state.isolate = false;
    $("inspector").hidden = !part;
    if (part) {
      if (state.contextIds && !state.contextIds.includes(part.data.id)) clearInspectionContext();
      if (state.subsystem !== "all" && state.subsystem !== part.data.group) {
        state.subsystem = "all";
        $("subsystem").value = "all";
      }
      $("partName").textContent = displayName(part.data);
      $("partId").textContent = part.data.id;
      refreshPartInformation(part);
      $("copyPartLink").textContent = copyTarget(part.data.id, location, versionSuffix()).label;
      history.replaceState(null, "", location.pathname + location.search + "#part=" + encodeURIComponent(part.data.id) + versionSuffix());
      packages.ensure(part.data.package).catch(() => {
      });
    } else if (location.hash.startsWith("#part=")) history.replaceState(null, "", location.pathname + location.search + (versionSuffix() ? "#" + versionSuffix().slice(1) : ""));
    views.updateVisibility();
  }
  function focusPart() {
    if (!state.selected) return;
    if (!state.selected.loaded) {
      packages.ensure(state.selected.data.package).then(focusPart).catch(() => {
      });
      return;
    }
    const { scene, camera, orbit } = stage;
    scene.updateMatrixWorld(true);
    const box = expandVisiblePartBounds(new T.Box3(), state.selected), center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3()).length();
    const dir = camera.position.clone().sub(orbit.target).normalize();
    cam.to(center.toArray(), center.clone().addScaledVector(dir, Math.max(20, size * 1.7)).toArray());
  }
  let componentLimit = 60, serviceLimit = 60, informationOnly = false;
  function search(append = false) {
    if (append !== true) {
      componentLimit = serviceLimit = 60;
      $("results").replaceChildren();
      $("serviceResults").replaceChildren();
    }
    const {components, services} = finderResults(stage.model?.parts || [], serviceCatalog, $("search").value);
    const renderGroup = (items, limit, listId, countId, moreId, row, noun) => {
      const list = $(listId), shown = Math.min(limit, items.length), exhausted = shown === items.length;
      for (const item of items.slice(list.children.length, shown)) list.append(row(item));
      $(countId).textContent = `Showing ${shown} of ${items.length} ${noun}`;
      const more = $(moreId);
      more.hidden = items.length <= 60;
      more.setAttribute("aria-disabled", String(exhausted));
      more.textContent = exhausted ? `All ${items.length} shown` : "Show more " + noun;
      more.onclick = () => {
        if (exhausted) return;
        if (moreId === "moreComponents") componentLimit += 60; else serviceLimit += 60;
        search(true);
      };
    };
    renderGroup(components, componentLimit, "results", "searchCount", "moreComponents", data => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "part-result";
      b.textContent = data.id + " · " + displayName(data);
      b.onclick = () => {
        if (informationOnly) showInformationOnly(data);
        else { clearTour(); select(parts.find(p => p.data.id === data.id)); focusPart(); views.sync(); }
        $("catalog").open = false;
      };
      return b;
    }, "components");
    renderGroup(services, serviceLimit, "serviceResults", "serviceCount", "moreServices", entry => {
      const active = entry.partIds.filter(id => stage.model?.parts.some(p => p.id === id));
      const b = document.createElement(informationOnly ? "p" : "button");
      b.className = "part-result";
      b.textContent = serviceLabel(entry) + " · " + (active.length ? "Model IDs: " + active.join(", ") : "No verified model mapping");
      if (!informationOnly) { b.type = "button"; b.disabled = !active.length; b.onclick = () => { focusServiceEntry(entry); $("catalog").open = false; }; }
      return b;
    }, "service entries");
    $("searchEmpty").hidden = Boolean(components.length || services.length);
  }
  $("clearSearch").onclick = () => { $("search").value = ""; search(); $("search").focus(); };

  /** Shows a part's information without the 3D view. */
  function showInformationOnly(data) {
    $("inspector").hidden = false;
    $("partId").textContent = data.id;
    $("partName").textContent = displayName(data);
    refreshPartInformation({ data });
    $("focus").disabled = true;
    $("isolate").disabled = true;
    history.replaceState(null, "", location.pathname + location.search + "#part=" + encodeURIComponent(data.id));
  }

  function useFallbackSearch() {
    informationOnly = true;
    $("search").oninput = search;
    search();
  }

  return { clearInspectionContext, focusContext, fitInspectionContext, focusServiceEntry, refreshPartInformation, applyPartLink, select, focusPart, search, useFallbackSearch, showInformationOnly };
}
