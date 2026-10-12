// The part-ID labels, the assembly labels of the exploded view and their leader lines.
// It is given everything it uses: the page's elements, the shared state, the parts and the camera.
import * as T from "three";

const V = (a) => new T.Vector3().fromArray(a), clamp = T.MathUtils.clamp;

export function createLabels({ $, state, parts, stage }) {
  const assemblies = [];   // one {group, label, line} per assembly of the exploded view

  /** Gives a part its ID label. onPick runs when the label is clicked. */
  function addPart(part, onPick) {
    const label = document.createElement("button");
    label.className = "part-label";
    label.textContent = part.data.id;
    label.title = part.data.name;
    label.setAttribute("aria-label", part.data.id + " " + part.data.name);
    label.tabIndex = -1;
    label.onclick = onPick;
    $("partLabels").append(label);
    part.label = label;
  }

  /** Adds an assembly's label, its numbered legend entry and its leader line. */
  function addAssembly(group, onPick) {
    const label = document.createElement("button");
    label.className = "part-label assembly-label";
    label.textContent = group.name;
    label.title = group.partIds.length + " components · click to inspect";
    label.onclick = onPick;
    label.setAttribute("aria-label", group.name + " assembly");
    $("partLabels").append(label);
    const legend = document.createElement("button");
    legend.textContent = assemblies.length + 1 + ". " + group.name;
    legend.onclick = onPick;
    $("assemblyLegend").append(legend);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    $("labelLeaders").append(line);
    assemblies.push({ group, label, line });
  }

  /** Places every label for the current camera. radial is how far the exploded view is spread (0 to 1). */
  function update(radial) {
    const { camera, orbit } = stage;
    const showing = state.view === "exploded" && state.labels;
    $("toggleLabels").setAttribute("aria-pressed", state.labels);
    $("partLabels").hidden = !showing;
    $("toggleLabels").hidden = state.view !== "exploded";
    $("labelHint").hidden = state.view !== "exploded";
    if (!showing) {
      $("assemblyLegend").hidden = true;
      return;
    }
    const rect = $("stage").getBoundingClientRect(), project = (v) => {
      v.project(camera);
      return { x: (v.x + 1) * rect.width / 2, y: (1 - v.y) * rect.height / 2, z: v.z };
    }, occupied = [];
    const place = (el, point, width, height) => {
      el.style.left = point.x + "px";
      el.style.top = point.y + "px";
      occupied.push({ x: point.x - width / 2, y: point.y - height / 2, w: width, h: height });
    };
    const candidates = assemblies.map((item) => ({ ...item, point: project(V(item.group.anchor).addScaledVector(V(item.group.offset), radial)) })).filter((item) => item.point.z > -1 && item.point.z < 1);
    const sorted = [...candidates].sort((a, b) => a.point.x - b.point.x), half = Math.ceil(sorted.length / 2), compact = rect.width < 550, labelWidth = compact ? 24 : 140;
    $("assemblyLegend").hidden = !compact;
    for (const [index, item] of assemblies.entries()) {
      item.label.textContent = compact ? String(index + 1) : item.group.name;
      item.label.classList.toggle("compact-label", compact);
    }
    for (const item of assemblies) {
      item.label.hidden = true;
      item.line.style.display = "none";
    }
    for (const [side, items] of [[-1, sorted.slice(0, half)], [1, sorted.slice(half)]]) {
      items.sort((a, b) => a.point.y - b.point.y);
      const top = 90, bottom = rect.height - 36, spacing = Math.min(compact ? 40 : 36, (bottom - top) / Math.max(1, items.length - 1)), start = clamp(items.reduce((sum, item) => sum + item.point.y, 0) / Math.max(1, items.length) - (items.length - 1) * spacing / 2, top, bottom - (items.length - 1) * spacing);
      items.forEach((item, index) => {
        const y = start + index * spacing, x = side < 0 ? labelWidth / 2 + 10 : rect.width - labelWidth / 2 - 10;
        item.label.hidden = false;
        item.label.style.width = labelWidth + "px";
        place(item.label, { x, y }, labelWidth, 30);
        item.line.style.display = "";
        for (const [k, v] of Object.entries({ x1: item.point.x, y1: item.point.y, x2: x - side * labelWidth / 2, y2: y })) item.line.setAttribute(k, v);
      });
    }
    const density = camera.isOrthographicCamera ? rect.height / (camera.top - camera.bottom) * camera.zoom : rect.height / (2 * Math.tan(16 * Math.PI / 180) * camera.position.distanceTo(orbit.target));
    for (const p of [...parts].sort((a, b) => (b === state.selected) - (a === state.selected))) {
      const point = project(p.labelPoint.clone().applyMatrix4(p.group.matrixWorld)), width = p.data.id.length * 5.5 + 7, height = 15;
      let visible = p.loaded && p.group.visible && point.z > -1 && point.z < 1 && point.x > width / 2 && point.x < rect.width - width / 2 && point.y > 80 && point.y < rect.height - 20 && (density > 3 || p === state.selected);
      if (visible && p !== state.selected) visible = !occupied.some((b) => point.x + width / 2 > b.x && point.x - width / 2 < b.x + b.w && point.y + height / 2 > b.y && point.y - height / 2 < b.y + b.h);
      p.label.hidden = !visible;
      if (visible) {
        p.label.style.fontSize = "9px";
        p.label.style.opacity = "1";
        place(p.label, point, width, height);
        p.label.classList.toggle("selected", p === state.selected);
      }
    }
  }

  return { addPart, addAssembly, update, visibleAssemblies: () => assemblies.filter((x) => !x.label.hidden).length };
}
