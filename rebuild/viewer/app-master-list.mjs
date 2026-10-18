// The master parts list in Inspect: every modelled part and every service-manual part not modelled
// yet, with its confirmation level. Filter it, pick a row, download it, and start a submission.
// The rows come from view/master-parts.csv, which the build also embeds in the page. Nothing here
// needs the 3D view, so the list still works when graphics are unavailable.
import {displayName} from "./part-information.mjs";
import {parseCsv} from "./service-catalog.mjs";

const CASSETTE = { original: "original cassette", detailed: "detailed cassette" };
/** What a row's variant means, in words: which cassette, or which exterior versions show this state of the part. */
export const variantLabel = (variant) => CASSETTE[variant] || (variant ? variant.split("+").join(" and ") + " exterior" : "");
const showsExterior = (row, version) => !row.variant || row.variant in CASSETTE || row.variant.split("+").includes(version);

/** The CSV text as one object per row. */
export function parseMasterList(csv) {
  const [header, ...lines] = parseCsv(csv);
  return lines.map((line) => Object.fromEntries(header.map((name, i) => [name, line[i] ?? ""])));
}

/** Rows that match the text (ID, name, part number, group) and the chosen status and level. Empty filters match everything. */
export function filterRows(rows, { text = "", status = "", level = "" } = {}) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (level !== "" && row.confirmation_level !== String(level)) return false;
    const hay = [row.row_id, row.name, row.manual_part_no, row.manual_ref_no, row.manual_catalog_id, row.group, row.category].join(" ").toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

export function rowLabel(row) {
  const what = row.part_id || row.manual_part_no || row.manual_ref_no || row.manual_catalog_id;
  return (row.status === "modelled" ? "" : "Not modelled · ") + what + " · " + displayName({id: row.part_id, name: row.name}) + (row.variant ? " · " + variantLabel(row.variant) : "") + " · level " + row.confirmation_level;
}

/**
 * What a contributor is asked for. kind is "confirmation" or "part". With a repository address the result
 * carries the address of the matching issue form; the part ID is the only thing put in it. Without one,
 * the text is offered for copying.
 */
export function submission(kind, row, repository) {
  const part = row ? row.part_id || row.manual_part_no || row.manual_ref_no : "";
  const privacy = "Before posting: hide serial numbers, leave out your name and address, and remove location data from photographs. An issue is public.";
  const lines = kind === "confirmation" ? [
    "Confirmation",
    "Part ID: " + part + (row?.name ? " (" + row.name + ")" : ""),
    "Cassette (only for cassette parts): " + (CASSETTE[row?.variant] || "not a cassette part"),
    "Exterior version of your player (Later, Intermediate or Early; go by the lettering): " + (row?.variant && !CASSETTE[row.variant] ? row.variant.split("+").join(" or ") : ""),
    "Feature (one measurable thing: a diameter, a thickness, a position, a travel): ",
    "Where the measurement starts and ends: ",
    "Value and units: ",
    "Method and instrument: ",
    "Requested level (2 reference material, 3 photograph with a scale, 4 measured on a part, 5 measured with supporting evidence, or \"not sure\"): ",
    "Photos or links to photos: ",
    "", privacy,
  ] : [
    "New or corrected part",
    "Part ID, or the service manual's Ref. No. or Part No.: " + part,
    "What is missing or wrong: ",
    "What it should be: ",
    "How you know (manual page, photograph or a link to one, the part in hand): ",
    "Exterior version of your player (Later, Intermediate or Early; go by the lettering): ",
    "", privacy,
  ];
  const address = repository ? repository.replace(/\/+$/, "") + "/issues/new?template=" + (kind === "confirmation" ? "confirmation.yml" : "part.yml") + (part ? "&part=" + encodeURIComponent(part) : "") : null;
  return { url: address, text: lines.join("\n") };
}

// data is {csv, levels, repository, exteriors, exteriorNote}; exterior() gives the version on screen;
// pickPart(row) shows a modelled row's part in the viewer.
export function createMasterList({ $, data, exterior, pickPart }) {
  const rows = parseMasterList(data.csv);
  const element = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };

  /** Opens the issue form, or shows the text to copy when no repository is set. */
  function offer(kind, row, target) {
    const { url, text } = submission(kind, row, data.repository);
    if (url) { window.open(url, "_blank", "noopener"); return; }
    const box = $(target);
    box.hidden = false;
    box.querySelector("textarea").value = text;
    box.querySelector("textarea").focus();
    box.querySelector("textarea").select();
  }

  /** One row's level, features and targets, as a block of the inspector or of the list. */
  function describe(row) {
    const block = element("section"), fields = element("dl"), level = Number(row.confirmation_level);
    const label = variantLabel(row.variant);
    block.append(element("h3", (label ? label[0].toUpperCase() + label.slice(1) + " · " : "") + "Confirmation level " + level));
    block.append(element("p", data.levels[level] + "."));
    const add = (label, value) => { if (value) fields.append(element("dt", label), element("dd", value)); };
    add("Features confirmed", row.features_confirmed);
    add("Features", row.feature_levels);
    add("Why not higher", row.level_notes);
    add("Targets", row.targets);
    if (row.status !== "modelled") { add("Part No.", row.manual_part_no); add("Ref. No.", row.manual_ref_no); }
    block.append(fields);
    return block;
  }

  /** Only the canonical selected variant is shown; the master rows remain individually selectable. */
  function showPart(partId, row) {
    const mine = row ? [row] : [], target = $("partConfirmation");
    target.replaceChildren(...mine.map(describe));
    target.hidden = !mine.length;
    $("partSubmission").hidden = true;
    $("confirmPart").onclick = () => offer("confirmation", mine[0], "partSubmission");
    $("correctPart").onclick = () => offer("part", mine[0], "partSubmission");
    $("partActions").hidden = !mine.length;
  }

  /** Redraws the list for the current filters. */
  let limit = 60;
  function refresh(append = false) {
    if (append !== true) { limit = 60; $("masterResults").replaceChildren(); }
    const found = filterRows(rows, { text: $("masterSearch").value, status: $("masterStatus").value, level: $("masterLevel").value });
    const shown = Math.min(limit, found.length), exhausted = shown === found.length;
    $("masterCount").textContent = `Showing ${shown} of ${found.length} rows`;
    $("masterEmpty").hidden = found.length > 0;
    $("masterMore").hidden = found.length <= 60;
    $("masterMore").textContent = exhausted ? `All ${found.length} shown` : "Show more rows";
    $("masterMore").setAttribute("aria-disabled", String(exhausted));
    $("masterMore").onclick = () => { if (!exhausted) { limit += 60; refresh(true); } };
    $("masterResults").append(...found.slice($("masterResults").children.length, shown).map((row) => {
      const b = element("button", rowLabel(row), "master-row");
      b.type = "button";
      b.onclick = () => {
        $("masterDetail").replaceChildren(describe(row));
        $("masterDetail").hidden = false;
        $("masterSubmission").hidden = true;
        $("masterReport").hidden = false;
        $("masterReport").textContent = row.status === "modelled" ? "Report a correction to this part" : "Report this part";
        $("masterReport").onclick = () => offer("part", row, "masterSubmission");
        if (row.status === "modelled") pickPart(row, b);
      };
      return b;
    }));
  }

  function download() {
    const link = element("a");
    link.href = URL.createObjectURL(new Blob([data.csv], { type: "text/csv" }));
    link.download = "master-parts.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1e4);
  }

  const modelled = rows.filter((row) => row.status === "modelled").length;
  $("masterSummary").textContent = modelled + " modelled rows and " + (rows.length - modelled) + " service-manual parts not modelled yet. Sizes in the list are the model's own, not measurements.";
  // The exterior-version choice: one option per version, labelled with its lettering and approximate serial range.
  $("exteriorVersion").replaceChildren(...(data.exteriors || []).map((e) => { const option = element("option", e.label + " · " + e.lettering + " · " + e.serials); option.value = e.id; return option; }));
  $("exteriorNote").textContent = data.exteriorNote || "";
  $("levelKey").replaceChildren(...data.levels.map((text, level) => element("li", "Level " + level + ": " + text)));
  for (const id of ["masterSearch", "masterStatus", "masterLevel"]) $(id).oninput = refresh;
  $("masterClear").onclick = () => {
    for (const id of ["masterSearch", "masterStatus", "masterLevel"]) $(id).value = "";
    refresh(); $("masterSearch").focus();
  };
  for (const id of ["partContributionNote", "masterContributionNote"])
    $(id).textContent = data.repository ? "Opens GitHub · GitHub account required · Public submission" : "Copy the submission text below to share with the maintainer.";
  $("masterDownload").onclick = download;
  $("masterNew").onclick = () => offer("part", null, "masterSubmission");
  refresh();

  return { rows, refresh, showPart };
}
