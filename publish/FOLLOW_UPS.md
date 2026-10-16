# Independent follow-up work

The patch fixes seven defects: reused geometry integrity (D1), directory-swap outcomes (D2), interrupted STOP/EJECT (D3), orthographic keyboard zoom (D4), seek timing (D5), Blender discovery (D6), and empty/skipped test filters (D7). No geometry dimensions or collision baselines are changed. Test evidence stays outside shipped files.

## Publication automation

Keep committed `view/` as the sole artifact. Validate once, pass that immutable artifact between CI jobs, package and publish its exact bytes. Record source fingerprints, lockfile digest, suite names/results and actual Node/Blender/browser versions alongside output hashes; exclude evidence itself from its hash set. Consider GitHub artifact attestations instead of building a custom provenance protocol. Prove export determinism on a pinned platform before requiring rebuild-and-diff; do not round output to disguise nondeterminism.

Prove all six Chromium/Firefox/WebKit × file/hosted combinations first: actual viewer, WebGL2, geometry and one control. Pin both the Playwright npm package and matching official container image by digest. Start PR browser checks with Chromium and expand only after measuring stability/runtime. Releases retain the full matrix and a real Safari smoke check while Safari support is advertised. Infrastructure failures are distinct from viewer defects.

## Dark mode for 0.3.0

Offer System, Light and Dark. CSS `prefers-color-scheme` resolves System; a small synchronous external head script sets `data-theme` only for an explicit stored override and tolerates unavailable storage. Preserve the existing CSP without adding `unsafe-inline` solely for theming. Test first paint while geometry is delayed, preference changes under System and explicit overrides, reset preserving the choice, and storage failure under file and hosted use.

Audit every backdrop consumer before choosing transparent canvas plus CSS: scene background, fog, clear colors during loading, selection/outline passes, label halos and transitions. Preserve the existing distinct assembled and separated light backdrops with theme-by-view tokens. If view animation changes the backdrop, have the same animation clock write its color; independent CSS timing must not drift. Check postprocessing and screenshot export. If the renderer paints the backdrop, compare a sampled canvas pixel with the intended CSS color under actual color management.

One before/after state snapshot must prove that switching themes preserves selected part, camera, transport, tape position, audio, model materials, lighting and exposure. Test loading errors, selection highlights, keyboard focus and narrow controls in both resolved themes. Run automated text/control contrast checks with axe-core plus visual checks for canvas labels and highlights that DOM contrast tools cannot assess.

## Mechanical evidence (report-only)

Software correctness and physical accuracy are different. Known rail/lid and rail/EJECT collisions remain documented. New mechanical checks do not block this patch.

First define a pinned CI platform and Blender build. Baselines apply only there; other platforms/versions report **noncomparable**, not changed. A Blender upgrade requires baseline review. Import the existing rail-sweep script only after recording its source and baseline digest. Record every sampled control value, endpoints, exact part-pair scope and adaptive refinement near contact transitions. A targeted rail test makes no claim about all part pairs, and finite sampling cannot prove continuous clearance.

Fingerprint per-object evaluated local vertices, topology, ownership and complete inventory, plus placement matrices separately (or explicitly use world-space vertices). Define coordinate frame, units, representation and byte encoding. First run a one-time repeatability study; only repeatable fingerprints can flag unintended geometry changes. A changed hash triggers reviewed numerical differences and a measurement sweep, not an automatic baseline update.

Calibrate penetration/containment methods separately on the chosen native or quantized representation. Non-closed meshes require explicit applicability rules; unsupported measurements are **indeterminate**, never zero. Establish numerical repeatability before defining tolerances or release gates. Computational micron thresholds do not establish physical accuracy against uncertain reference dimensions. Normal tests never update baselines.
