# Rebuilding the viewer

You need **Blender 5.2 or newer** and **Node 24**. Open a terminal in this folder (`rebuild/`).

```sh
npm ci            # once: installs the two build dependencies (needs the internet)
npm run build     # Blender reads the model, then view/ is rebuilt (about 70 seconds)
npm test          # checks the result and lists what changed
```

Then open `../view/index.html`.

- `npm run build:viewer` rebuilds the page and the lists beside it in a few seconds, without Blender. Use it after changing files in `viewer/`, the wording in `config/release.json`, or a list in `../edit/`.
- `npm run accept` records the current build as the accepted state, once you have checked that the listed changes are what you meant. It also ties new assessments to the model.
- `npm test -- name` runs only the tests whose file name contains `name`.
- `npm run test:fast` runs all behavioral and build-tool checks without Blender; any skip fails.
- `npm run test:release` runs every suite and rejects skips. It needs current Blender working files.
- `npm run check` verifies committed output integrity and source freshness without rebuilding.

Each supplied test filter must match a discovered test and run at least one test. Filters combine with OR; overlapping tests run once. A typo or an entirely skipped filter fails even when another filter passes. The summary names skipped tests and their prerequisites.

An explicit `BLENDER_BIN` is authoritative: an invalid or outdated executable fails without fallback. Automatic discovery checks `PATH`, then the usual install folders, continuing past broken or outdated candidates. The kit is tested with Blender 5.2; a newer one works with a note.

## What a build does

1. Blender tries the exterior-version choice at every setting, then exports every part, measures it, packs the geometry, generates the cassette, samples the motion and takes the measurements the targets are checked against. These working files go to `build/`, which is scratch: delete it whenever you like.
2. The data files are written to a staging folder and read back the way a browser would read them. From them and the lists in `../edit/`, the build works out the target checks and confirmation levels and writes `master-parts.csv`, `TARGETS.md` and `assessment-results.json`, then the page.
3. Only then is `view/` replaced, together with `view/build-record.json`. The build moves the old output to a unique sibling backup, promotes the staged output, then deletes the backup. A failed promotion attempts rollback. Failed cleanup after promotion succeeds with a warning naming the leftover backup; the new output is already committed. Failed rollback reports the paths to preserve.

Integrity and freshness are separate. Viewer-only reuse verifies the geometry inventory, lengths and SHA-256 hashes against its existing record, then verifies the staged copy against that same record. It carries those geometry entries forward. Editing viewer source or any of the three editable lists (`edit/service-manual-parts.csv`, `edit/targets.json`, `edit/assessments.json`) is expected and permits rebuilding. Model or export-input changes require a full build. Inputs are captured before work and checked again before promotion; changing them during a build fails.

The input guard compares hashes before and after work; it is not an immutable source snapshot and cannot detect an edit restored to identical bytes between checks. Keep sources stable during a build. Git checkouts use LF line endings on every supported contributor platform so source fingerprints remain comparable.

Commit regenerated `view/`, including its record, with source changes before merge. Intermediate development output may be stale. The merge and publication checks reject stale or altered committed output and never rebuild it automatically.

Builds hold one `.ptp-build.lock` directory and use unique hidden staging/backup directories beside the destination. Contention reports the PID, process identity and whether the owner is alive, stale or indeterminate. No lock is taken over automatically. Stop builders, confirm their Blender children have exited, preserve useful output/backups, remove only the named lock directory, then retry. Never remove an active lock.

An external Node supervisor holds the Blender child lifetime to a pipe from the builder. EOF (including a killed builder) terminates Blender with bounded escalation and waits for its exit. SIGKILL can leave the lock and partial staging files. This does not protect against killing the supervisor too, power loss or a filesystem that cannot honor local rename semantics.

After normal lock acquisition, recognized abandoned stages/backups can be deleted only when the live output verifies. Missing or invalid live output with leftovers stops for manual inspection; recovery never deletes the only valid copy. `git restore view/` is an optional manual recovery from committed output; the build never runs it. There is a brief interval between renames when the live path is absent; this is not continuous-read or power-loss durability.

## What the tests mean

- **Rules** hold for any valid kit: every part has a registered ID, the files in `view/` match the build record, the lists in `../edit/` are sound.
- **Tests** check the viewer's own logic.
- **Reference tests** (`tests/reference/`) hold numbers of the shipped model. They step aside once you have changed the model.
- **Changed since the accepted state** is a report, not a failure: each changed part and what changed, each target redefined or with a new outcome, each change of level.

A fresh download has no `build/` folder. Geometry tests report that prerequisite, while the entire fast suite still runs. Suite membership and prerequisites are explicit in `tests/suites.mjs`.

Contributor targets are macOS, Linux and Windows. Local validation has been performed on macOS; Linux and Windows CI coverage is configured but has not been validated locally. The Windows job includes open-file rename denial, where an editor or browser can keep a file handle open and cause rollback.

## Where things are

| Folder | Holds |
|---|---|
| `viewer/` | The viewer's source. `app.js` wires the page's buttons; `app-core.mjs` holds the scene and creates the controllers (`app-camera.mjs`, `app-views.mjs` and so on), each given what it uses. `page.html` and `page.css` are the page. |
| `tools/` | The build. `build.mjs` runs it; the `.py` files run inside Blender. `targets.mjs` holds the target checks, `confirmation.mjs` the levels and the lists. |
| `config/` | Viewer settings, the list of issued part IDs, the release wording. |
| `tests/` | The tests. |
| `accepted.json` | The accepted state: one line per part, each target's definition and outcome, and any level above 1. |

The detailed cassette is generated by `tools/export_cassette.py` from the `cassette` section of `config/model.json`, not from the Blender file.

## If something goes wrong

- **Blender not found:** install it or set `BLENDER_BIN`.
- **"Out of date":** the message names the changed files and the command to run.
- **A part has no ID, or two share one:** see "Part IDs" in `../edit/EDITING.md`.
- **The page says a geometry file is missing:** keep `index.html` and `geometry/` together.
- **No 3D view:** the browser has no WebGL2. Search and part information still work.
