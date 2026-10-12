# Releasing your own version

Nothing here uploads anything or needs git. These tools prepare a ZIP and check it.

## Before you share

1. In `rebuild/`: `npm run build`, `npm test`, and `npm run accept` once the listed changes are what you meant.
2. Remove your computer's folder paths from the Blender file (Blender keeps them in its screen layout). From the kit folder:

   ```sh
   HOME=/tmp/portable-tape-player blender --background --factory-startup --disable-autoexec --python publish/clean_blender_file.py
   ```

   Rebuild afterwards; `npm test` warns while a path is still there.
3. Set the new version in `rebuild/config/release.json`, `rebuild/package.json` and `rebuild/package-lock.json`, then `npm run build:viewer`.
4. Make the ZIP:

   ```sh
   node publish/release.mjs
   ```

   It stops if the kit breaks a rule, `view/` is out of date, the model has unaccepted changes, or a file names your computer, your user or a home folder. Otherwise it writes the ZIP beside the kit folder, with its SHA-256 and a list of its files; give last release's list as a second argument to see what was added or removed.

The ZIP holds every file in the kit except the build's scratch folders, hidden files, backups and archives. The kit describes the current version only; "what changed" belongs in your release notes.

## Taking contributions

The README lists three ways to take part. For the second and third:

- **Issue forms.** Copy the two forms in `publish/github/` to `.github/ISSUE_TEMPLATE/` in your repository, and `gitignore.txt` to `.gitignore`. Put the repository's address in `repository` in `rebuild/config/release.json` and run `npm run build:viewer`; the viewer's buttons then open the forms. Left empty, they offer text to copy.
- **A measurement.** `edit/EDITING.md` says how to accept one. When a photo arrives as a link, write one line in the issue saying what it showed, because links die.
- **An edited copy.** Open the linked file with scripts off, Append the changed part into your model, give its mesh to your own part, delete the appended object and rebuild. `npm test` must list only that part as changed.

## Your identity

If you publish with git, use a public name and a no-reply address: every commit carries both. Publishing needs no git if the repository holds only the README, the picture and the forms, with the ZIP attached to a Release.

## Checking that the kit still works

Unzip the ZIP into an empty folder and, from there:

- double-click `view/index.html` in Chrome, Safari and Firefox
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

`view/` is a complete static site and works from any web host or subfolder. `publish/github/pages.yml` is a GitHub Actions workflow that publishes it when you trigger it by hand; copy it to `.github/workflows/` in your repository.

Do not publish Chrome network logs, build logs or anything from your home folder.
