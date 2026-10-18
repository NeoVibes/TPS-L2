# Independent follow-up work

The existing defect regressions cover reused geometry integrity (D1), directory-swap outcomes (D2), interrupted STOP/EJECT (D3), orthographic keyboard zoom (D4), seek timing (D5), Blender discovery (D6), and empty/skipped test filters (D7). No geometry dimensions or collision baselines are changed. Test evidence stays outside shipped files.

## Publication automation

Keep committed `view/` as the sole artifact. Validate once, pass that immutable artifact between CI jobs, package and publish its exact bytes. Record source fingerprints, lockfile digest, suite names/results and actual Node/Blender/browser versions alongside output hashes; exclude evidence itself from its hash set. Consider GitHub artifact attestations instead of building a custom provenance protocol. Prove export determinism on a pinned platform before requiring rebuild-and-diff; do not round output to disguise nondeterminism.

Prove all six Chromium/Firefox/WebKit × file/hosted combinations first: actual viewer, WebGL2, geometry and one control. Pin both the Playwright npm package and matching official container image by digest. Start PR browser checks with Chromium and expand only after measuring stability/runtime. Releases retain the full matrix and a real Safari smoke check while Safari support is advertised. Infrastructure failures are distinct from viewer defects.

## Dark mode for 0.2.7

The appearance control offers System, Light and Dark. System follows `prefers-color-scheme`, including device preference changes while the viewer is open. Light and Dark override that preference. Remember an explicit choice only when browser storage is available; unavailable storage must leave the control usable for the current page. Returning to System removes the override, and Reset preserves the appearance choice.

Apply the choice before the first visible page paint without weakening CSP. Verify delayed geometry loading, startup errors, blocked storage, live System changes and explicit overrides from both a local file and a hosted subfolder. Keep these checks separate from claims about browser performance.

Preserve the light assembled backdrop (`#e9e7df`) and the light service, catalog and exploded backdrop (`#34424d`). Keep CSS stage and loading surfaces consistent with the renderer, and check captions, label backgrounds and halos, leader lines, selection highlights and narrow controls in both resolved themes. The current backdrop switches immediately; do not add a separate color animation clock. Keep model materials, selection emissive colors, environment, lights, tone mapping and exposure unchanged. Compare a sampled canvas backdrop pixel with the intended CSS color under actual color management. Screenshot composition must explicitly use the intended theme.

A before/after state check must prove that a theme change itself preserves selection, camera, transport, tape position and audio, including a pending STOP/EJECT stroke. Keep the existing operating regressions. Check keyboard focus and text/control contrast with automated accessibility checks, plus visual checks for canvas labels and highlights that DOM contrast tools cannot assess. These are release requirements, not a record of checks already passed.

## Mechanical evidence (report-only)

Software correctness and physical accuracy are different. Known rail/lid and rail/EJECT collisions remain documented. New mechanical checks remain a separate report-only track.

First define a pinned CI platform and Blender build. Baselines apply only there; other platforms/versions report **noncomparable**, not changed. A Blender upgrade requires baseline review. Import the existing rail-sweep script only after recording its source and baseline digest. Record every sampled control value, endpoints, exact part-pair scope and adaptive refinement near contact transitions. A targeted rail test makes no claim about all part pairs, and finite sampling cannot prove continuous clearance.

Fingerprint per-object evaluated local vertices, topology, ownership and complete inventory, plus placement matrices separately (or explicitly use world-space vertices). Define coordinate frame, units, representation and byte encoding. First run a one-time repeatability study; only repeatable fingerprints can flag unintended geometry changes. A changed hash triggers reviewed numerical differences and a measurement sweep, not an automatic baseline update.

Calibrate penetration/containment methods separately on the chosen native or quantized representation. Non-closed meshes require explicit applicability rules; unsupported measurements are **indeterminate**, never zero. Establish numerical repeatability before defining tolerances or release gates. Computational micron thresholds do not establish physical accuracy against uncertain reference dimensions. Normal tests never update baselines.
