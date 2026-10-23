# Browser checks

These checks exercise the generated `view/` with Playwright **1.62.1**, axe-core **4.14.0** and pngjs **7.0.0**, pinned in the package and lockfile. They do not rebuild it. Run the viewer build and fast tests first.

From this folder, using Node 24 or newer:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run test:feasibility
npm run test:chromium
```

On Linux, use `npx playwright install --with-deps chromium firefox webkit` to install required system libraries too. CI should use the lockfile and matching Playwright browser downloads; no container image is assumed by these scripts.

The Chromium pull-request job uses `ubuntu-24.04`, Node 24.22.0, the exact package lockfile and Playwright's matching Chromium revision. It clears any runner-provided `CHROME_BIN` override so the installed revision is actually used. An immutable container digest remains a separate infrastructure follow-up; a versioned runner label is not an immutable OS image.

The feasibility run opens all six combinations of Chromium, Firefox and WebKit with `file://` and an HTTP subfolder. It requires viewer startup, a rendered frame, successful local packages, no runtime network requests outside the viewer and no document/CSP errors. A launch or capability failure fails that combination and the command; it is never counted as a pass.

The Chromium regression run additionally presses the real keyboard zoom shortcuts in both projections, checking the projected size of model controls, and interrupts both STOP and EJECT with the Separation slider before reassembling. `npm test` runs these same regressions in all three engines and both protocols. The older comprehensive walkthrough in `../walkthrough/` remains a separate check.

Chromium also holds real geometry requests across context loss and component selection. These regressions require the startup recovery panel to remain visible, mechanism/electronics failures to enter catalog-only mode even when another package finishes later, manual reload to recover, and a delayed assembly load to preserve a newer component selection and its URL.

Theme acceptance holds back the real exterior geometry request in each protocol and samples the earliest observed body frame. It checks System, saved Light/Dark, invalid preferences, denied storage access and denied writes; changes the operating-system preference; and verifies persistence across reload and Reset. Deliberately failed geometry requests exercise the actual loading-error screen in both palettes.

The pinned local axe-core source checks text and control-label contrast on loading, error, selected-component and narrow layouts. It runs under normal browser time before the application clock is frozen, because axe uses its own timers. Violations fail the run; incomplete results remain in the JSON for review. Keyboard focus and horizontal fit at 390 px are checked separately. Screenshots cover the selected exterior lid, assembled view, exploded labels and narrow controls. Canvas labels, leader lines and selection highlights still require visual review; a successful DOM scan does not certify those pixels.

Startup, accessibility and zoom use normal browser time. Once the stopped viewer has loaded all four packages, the interruption cases take control of its clock; native clicks, keyboard input and Playwright's actionability checks remain in use. A 200 ms step must render a partial, uncommitted stroke, and separation and reassembly must cancel it immediately before another frame. A final 900 ms step checks that it stays cancelled. Each step must complete exactly one geometry-rendering frame and is bounded by a real-time watchdog. This avoids letting slow software rendering finish a stroke while automation is still moving between controls; it does not measure animation performance. The clock is installed after startup because Playwright's fake Performance object lacks inherited methods used by the viewer's document diagnostics.

While the application clock is frozen, theme changes must preserve an exact snapshot of selected part, camera, transport, tape, audio, model parts/materials, lights and renderer exposure. Separate comparisons preserve pending STOP and EJECT strokes. Each resolved theme is rendered in all four presentation views; pngjs decodes the actual canvas screenshot and its clear-corner RGB must match the CSS backdrop within two levels per channel. Assembled and separated backdrops must remain distinct. The invariant snapshot and sampled RGB values are saved with the evidence.

JSON results, screenshots and traces go under `rebuild/build/browser/feasibility/` or `rebuild/build/browser/regressions/`, outside the shipped kit. Each result records the actual browser and Playwright versions, OS and architecture. Local runs may explicitly set `CHROME_BIN` to an installed Chrome executable; reports mark that override, so it cannot be confused with the pinned Chromium download. `PTP_PLAYWRIGHT_MODULE` can select a preinstalled Playwright module, but its package version must still be 1.62.1.

Set `PLAYWRIGHT_BROWSERS_PATH` consistently for installation and execution to keep downloaded browsers in an ignored scratch directory. Browser findings establish behavior in the recorded engine/platform, not physical model accuracy or equivalence to every Safari installation.

Failed checks also record the precise test phase, current control state, rendered frame count and last render statistics. A slow renderer must still expose its first completed frame; readiness does not depend on reaching a minimum frame rate.
