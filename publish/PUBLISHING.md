# Releasing your own version

The release tools prepare and check a ZIP; they never rebuild or upload it. **Committed `view/` is the shipping artifact.** Pages uploads that same directory after validation. Build during development, commit the resulting output with its sources, then validate and package those exact bytes.

## Before you share

1. During development, in `rebuild/`: `npm run build`, `npm run test:release`, and `npm run accept` only after reviewing intentional geometry or assessment changes. Normal tests never update accepted or reference baselines. `accepted.json` records reviewed part content, target definitions/outcomes and assessment levels; it is not a claim that every software test passed.
2. Remove your computer's folder paths from the Blender file (Blender keeps them in its screen layout). From the kit folder:

   ```sh
   HOME=/tmp/portable-tape-player blender --background --factory-startup --disable-autoexec --python publish/clean_blender_file.py
   ```

   Rebuild afterwards; `npm test` warns while a home or temporary profile path is still there. Only the exact neutral folder above (and its macOS `/private/tmp/` spelling) is exempt; temporary folders can also reveal user or tool information.
3. Set the new version in `rebuild/config/release.json`, `rebuild/package.json` and `rebuild/package-lock.json`, then `npm run build:viewer`.
4. On the final candidate, run `npm run check`, `npm run test:fast`, and `npm run test:release`. The fast suite must have zero skips. The release suite needs current native/reference working files and allows no unexpected skips. Run the Chromium walkthrough in both file and hosted modes, plus the focused runtime browser checks. Smoke-test startup, geometry, transport, separation, interrupted STOP/EJECT and keyboard zoom in Chrome, Firefox and real Safari on macOS; Playwright WebKit does not establish branded Safari support. Record unavailable checks as incomplete, not passed. Keep logs, traces, screenshots and temporary fixtures in `rebuild/build/` or outside the kit.
5. Make the ZIP without another rebuild:

   ```sh
   node publish/release.mjs
   ```

   It stops if the kit breaks a rule, `view/` is out of date, the model has unaccepted changes, or a file names your computer, your user or a home folder. Otherwise it extracts the ZIP into a temporary directory and checks its complete inventory and hashes against the candidate, then writes the ZIP beside the kit with its checksum, a SHA256SUMS file and a file list. Give last release's list as a second argument to see what was added or removed. There is no second browser run on the extracted copy: matching hashes establish it contains the tested bytes.

The ZIP holds every file in the kit except the build's scratch folders, hidden files, backups and archives. The kit describes the current version only; "what changed" belongs in your release notes.

## Taking contributions

The README lists three ways to take part. For the second and third:

- **Issue forms.** Copy the two forms in `publish/github/` to `.github/ISSUE_TEMPLATE/` in your repository, and `gitignore.txt` to `.gitignore`. Put the repository's address in `repository` in `rebuild/config/release.json` and run `npm run build:viewer`; the viewer's buttons then open the forms. Left empty, they offer text to copy.
- **A measurement.** `edit/EDITING.md` says how to accept one. When a photo arrives as a link, write one line in the issue saying what it showed, because links die.
- **An edited copy.** Open the linked file with scripts off, Append the changed part into your model, give its mesh to your own part, delete the appended object and rebuild. `npm test` must list only that part as changed.

## Your identity

If you publish with git, use a public name and a no-reply address: every commit carries both. Publishing needs no git if the repository holds only the README, the picture and the forms, with the ZIP attached to a Release.

## Checking that the kit still works

Validate the candidate before packaging; use disposable copies for rebuild/edit experiments:

- double-click the candidate's `view/index.html` in Chrome, Safari and Firefox
- let Chrome walk through every control and compare with the recorded behaviour, opened from disk and then served from a subfolder:

  ```sh
  node publish/walkthrough/run.mjs
  node publish/walkthrough/run.mjs --hosted
  ```

  It needs Chrome (set `CHROME_BIN` if it is somewhere unusual). It also switches the exterior version in every state, uses the parts list with and without 3D graphics, and checks that damaged geometry files are reported. After an intended change to the viewer's behaviour, review the differences, then record them with `--update-reference`.
- in `rebuild/`: `npm ci`, `npm run build`, `npm test`
- `node rebuild/tools/compare.mjs "/path/to/previous kit" .` lists every part, pose and motion sample that differs from the previous release
- try real edits on throwaway copies:

  ```sh
  node publish/acceptance-copy.mjs "../Scenario B"      # then, inside the copy:
  blender --background --factory-startup --disable-autoexec --python-exit-code 2 --python publish/acceptance_edit.py -- B
  cd rebuild && npm run build && node ../publish/verify_edit.mjs "/path/to/the unzipped kit" B
  ```

  `B` reshapes a screw; `D` changes a speed and a travel; `C1-missing`, `C1-create`, `C1-attach`, `C1-rename`, `C1-remove` (in order, in one copy) add, extend, rename and remove a part; `C2-duplicate` must fail and `C2-roles` must change nothing.
- `node publish/verify_build_rules.mjs "../Rules scratch"` proves the build's rules and the release tool on a throwaway copy, without Blender.
- `node publish/walkthrough/picture.mjs` remakes the README's picture of the three exterior versions.
- `publish/test_authoring.py` (run inside Blender) checks the editing helpers; `publish/rig_probe.py` records where every object sits in each control state.

## A live copy on the web

`view/` is a complete static site and works from any web host or subfolder. `publish/github/pages.yml` is a GitHub Actions workflow that validates and publishes the committed files when you trigger it by hand; copy it to `.github/workflows/` in your repository. It never rebuilds. The repository's merge workflow checks integrity, freshness and fast tests on the contributor platform matrix. Native release checks run where the supported Blender executable and the checked-in `.blend` source are available; generated working files are recreated there and are not shipped.

For this patch release, the completion gate is the seven defect regressions, integrity/freshness, zero unexpected software/native skips, Chromium file/hosted automation, the browser smoke checklist above and ZIP hash comparison. Publication automation, dark mode and new collision calibration are separate tracks described in `FOLLOW_UPS.md`; they do not delay these fixes.

Do not publish Chrome network logs, build logs or anything from your home folder.
