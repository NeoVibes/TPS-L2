# Browser checks

These checks exercise the generated `view/` with Playwright **1.62.1**, pinned in the package and lockfile. They do not rebuild it. Run the viewer build and fast tests first.

From this folder, using Node 24 or newer:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run test:feasibility
npm run test:chromium
```

On Linux, use `npx playwright install --with-deps chromium firefox webkit` to install required system libraries too. CI should use the lockfile and matching Playwright browser downloads; no container image is assumed by these scripts.

The Chromium pull-request job uses `ubuntu-24.04`, Node 24.19.0, the exact package lockfile and Playwright's matching Chromium revision. An immutable container digest remains a separate infrastructure follow-up; a versioned runner label is not an immutable OS image.

The feasibility run opens all six combinations of Chromium, Firefox and WebKit with `file://` and an HTTP subfolder. It requires viewer startup, a rendered frame, successful local packages, no runtime network requests outside the viewer and no document/CSP errors. A launch or capability failure fails that combination and the command; it is never counted as a pass.

The Chromium regression run additionally presses the real keyboard zoom shortcuts in both projections, checking the projected size of model controls, and interrupts both STOP and EJECT with the Separation slider before reassembling. `npm test` runs these same regressions in all three engines and both protocols. The older comprehensive walkthrough in `../walkthrough/` remains a separate check.

JSON results, screenshots and traces go under `rebuild/build/browser/feasibility/` or `rebuild/build/browser/regressions/`, outside the shipped kit. Each result records the actual browser and Playwright versions, OS and architecture. Local runs may explicitly set `CHROME_BIN` to an installed Chrome executable; reports mark that override, so it cannot be confused with the pinned Chromium download. `PTP_PLAYWRIGHT_MODULE` can select a preinstalled Playwright module, but its package version must still be 1.62.1.

Set `PLAYWRIGHT_BROWSERS_PATH` consistently for installation and execution to keep downloaded browsers in an ignored scratch directory. Browser findings establish behavior in the recorded engine/platform, not physical model accuracy or equivalence to every Safari installation.
