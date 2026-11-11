# Releasing your own version

The release tools prepare and check a ZIP; they never rebuild or upload it. **Committed `view/` is the shipping artifact.** Pages serves those same files alongside the license notices. Build during development, commit the resulting output with its sources, then validate and package those exact bytes.

## Before you share

1. During development, in `rebuild/`, use `npm run build` when the native model, model settings or export tools changed. For viewer-only changes such as a theme change, use `npm run build:viewer`; it verifies the existing geometry against its build record before reusing it. Run `npm run test:release` against current native/reference working files in either case. Run `npm run accept` only after reviewing intentional geometry or assessment changes. Normal tests never update accepted or reference baselines. `accepted.json` records reviewed part content, target definitions/outcomes and assessment levels; it is not a claim that every software test passed.
2. Check the Blender file for your computer's folder paths (Blender keeps them in its screen layout). Preserve a previously reviewed native file when it is unchanged. If the check finds private paths, remove them before publishing. From the kit folder:

   ```sh
   HOME=/tmp/portable-tape-player blender --background --factory-startup --disable-autoexec --python publish/clean_blender_file.py
   ```

   Run a full rebuild after changing the native file; `npm test` warns while a home or temporary profile path is still there. Only the exact neutral folder above (and its macOS `/private/tmp/` spelling) is exempt; temporary folders can also reveal user or tool information.
3. Set the new version in `rebuild/config/release.json`, `rebuild/package.json` and `rebuild/package-lock.json`, then `npm run build:viewer`.
4. On the final candidate, run `npm run check`, `npm run test:fast`, and `npm run test:release`. The fast suite must have zero skips. The release suite needs current native/reference working files and allows no unexpected skips. Run `node publish/walkthrough/run.mjs` (Chrome, from disk and hosted). Check real Safari by hand from disk and hosted: startup, the views, the drawers, the Actions menu, transport, sound and full screen. Firefox is not tested; say so in the README. Record unavailable checks as incomplete, not passed. Keep logs, traces, screenshots and temporary fixtures in `rebuild/build/` or outside the kit.

   For appearance changes, check System, Light and Dark during loading and after startup, including delayed or failed geometry, live device preference changes, blocked storage and Reset. Verify that a theme switch preserves the current selection, camera, transport, tape position and audio, including a pending STOP/EJECT stroke. Check text, controls, keyboard focus, canvas labels and selection highlights at desktop and narrow widths. Keep the existing light assembled and separated backdrops and the model's materials, lighting and exposure. Use the intended explicit theme when creating screenshots for comparison or publication.

5. Make the ZIP without another rebuild:

   ```sh
   node publish/release.mjs
   ```

   It stops if the kit breaks a rule, `view/` is out of date, the model has unaccepted changes, or a file that ships holds a password, PIN, key, token, e-mail address or other personal detail, a home folder or a name from your computer (`publish/scan-secrets.mjs`; the repository's checks run it on every push too). Otherwise it extracts the ZIP into a temporary directory and checks its complete inventory and hashes against the candidate, then writes the ZIP beside the kit with its checksum, a SHA256SUMS file and a file list. Give last release's list as a second argument to see what was added or removed. There is no second browser run on the extracted copy: matching hashes establish it contains the tested bytes.

The ZIP holds every file in the kit except the build's scratch folders, hidden files, backups and archives. The kit describes the current version only; "what changed" belongs in your release notes.

## Taking contributions

The README lists three ways to take part. For the second and third:

- **Issue forms.** Copy the two forms in `publish/github/` to `.github/ISSUE_TEMPLATE/` in your repository, and `gitignore.txt` to `.gitignore`. Put the repository's address in `repository` in `rebuild/config/release.json` and run `npm run build:viewer`; the viewer's buttons then open the forms. Left empty, they offer text to copy.
- **A measurement.** `edit/EDITING.md` says how to accept one. When a photo arrives as a link, write one line in the issue saying what it showed, because links die.
- **An edited copy.** Open the linked file with scripts off, Append the changed part into your model, give its mesh to your own part, delete the appended object and rebuild. `npm test` must list only that part as changed.

## Your identity

If you publish with git, use a public name and a no-reply address: every commit carries both. Publishing needs no git if the repository holds only the README, the picture and the forms, with the ZIP attached to a Release.

Before every push, run `node publish/scan-secrets.mjs --git-new` in the repository: it checks the commits GitHub does not have yet, their author addresses and every file in them (`--git` checks the whole history). On GitHub, turn on secret scanning with push protection for the repository, and in your account's e-mail settings keep your address private and block pushes that would expose it. A key that was ever pushed counts as public: revoke it, then remove it.

## Checking that the kit still works

Validate the candidate before packaging; use disposable copies for rebuild/edit experiments:

- double-click the candidate's `view/index.html` in Chrome and Safari
- let Chrome use the viewer, opened from disk and served from a subfolder (about a minute; on GitHub, where Chrome draws in software, 15 to 30 minutes):

  ```sh
  node publish/walkthrough/run.mjs
  ```

  It opens the page and checks that nothing fails or reaches outside its folder; both rows on one line from desktop to phone width; the four views; the drawers; the transport; every item of the Actions menu, and the same actions with the mouse on the model; the sound; isolating a part; full screen; the three exterior versions; the tour; text contrast in light and dark; and the page without 3D or with a geometry file missing. Each check says in plain words what is wrong. It needs Chrome (set `CHROME_BIN` if it is somewhere unusual) and the packages from `npm ci` in `rebuild/`. `--file` or `--hosted` runs one way of opening it, `--only=sound,parts` named checks. Results and a few pictures go to `rebuild/build/walkthrough/`.
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

`view/` is a complete static site and works from any web host or subfolder. Serve `LICENSE` and `LICENSES.md` alongside it. Copy `publish/github/validate.yml` and `publish/github/pages.yml` to `.github/workflows/` in your repository. The validation workflow checks integrity, freshness and fast tests on macOS, Linux and Windows, and runs Chrome against local files and a hosted subfolder on Linux. The manually triggered Pages workflow validates the committed files and includes both license notices without rebuilding. Native release checks run where the supported Blender executable and the checked-in `.blend` source are available; generated working files are recreated there and are not shipped.

The completion gate retains D1–D7 regression coverage and requires integrity/freshness, zero unexpected software/native skips, Chromium file/hosted automation, the appearance and browser smoke checks above, and ZIP hash comparison. The dark-mode requirements are recorded in `FOLLOW_UPS.md`. Further publication automation and new collision calibration remain separate tracks.

Do not publish Chrome network logs, build logs or anything from your home folder.
