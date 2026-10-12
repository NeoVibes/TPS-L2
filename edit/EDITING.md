# Editing the model

Open `Portable Tape Player.blend` in Blender 5.2 or newer. It contains no scripts, so leave "Auto Run Python Scripts" off. Units are millimetres.

After an edit: save, then follow `../rebuild/REBUILDING.md` to see it in the viewer.

## What is in the file

| Collection | Holds |
|---|---|
| Exterior, Mechanism, Electronics | The parts, grouped as the viewer loads them (`view/geometry/exterior.js` and so on) |
| Cassette | The original cassette parts |
| Motion rig | Controllers, pivots and the hidden objects that carry motion to the parts. No shapes of its own. |
| Helpers | Lights, three demo cameras, belt guides, and a hidden group of construction cutters and datums |

Every part is one object with a `part_id` (for example `CTL-04`). Extra pieces of the same part carry `owner_part_id`. Lettering is ordinary mesh.

## Blender decides, the viewer shows

Blender decides shapes, positions, and how far and how fast things move; two controllers in *Motion rig* hold the sliders. The viewer decides timing, the guided tour and the travelling marks on the belts; those settings are in `../rebuild/config/model.json`.

To change a speed, find the part by `part_id`, follow its driver, and change the multiplier. Keep driver expressions simple (arithmetic, comparisons, `a if b else c`) so they work with scripts off.

## Exterior versions

The *Exterior version* choice on the transport controller switches between Later, Intermediate and Early. Only lettering differs. A piece that only some versions show carries `exterior_versions` and two visibility drivers, both set by `show_in_versions` (below); an untagged piece shows in all three. Save with Later selected. `targets.json` holds the table of what each version shows, and the build stops if the model disagrees with it.

## Part IDs

IDs are issued once and never reused; a removed part's ID stays reserved in `../rebuild/config/part-ids.json`. Renaming an object does not change its ID.

In Blender's Python console, load `../rebuild/tools/authoring.py` and use:

| To | Call |
|---|---|
| Give a new object an ID | `assign_part(object, registry_path, prefix='PRT')` |
| Add a piece to an existing part | `attach_geometry(piece, part)` |
| Mark an object or collection as not part of the model | `mark_helper(object_or_collection)` |
| Show a lettering piece only in some exterior versions | `show_in_versions(piece, ['intermediate', 'early'])` |
| Fill in missing viewer settings | `complete_defaults(part)` |

`registry_path` is the path to `part-ids.json`. The helpers do not save; you do. The build refuses a model with a missing or duplicate ID and says which object to fix.

Keep the scene properties that begin `release_serial_` and the "12345" marking together: they record that the serial number is made up.

## The three lists

After changing one, run `npm run build:viewer` in `../rebuild/`; Blender is not needed.

- `service-manual-parts.csv`: what Sony's manual says exists. `model_part_ids` names the model parts that represent an entry; blank means not modelled. Write `EXT-030/later` when only one state of a part is the manual's part.
- `targets.json`: the numbers the model is meant to match, each with a value, a tolerance, a unit, a class and one line on what it rests on.
- `assessments.json`: accepted confirmations. This is what raises a part's level.

## Accepting a confirmation

A part's level (see `../README.md`) is the lowest level among its required features. A feature is one measurable thing: a diameter, a thickness, a position, a travel.

1. **Add the measurement to `targets.json`** as its own target, class `measured`. It needs a check, or it cannot raise a level:
   - `"measure": {"size_of": "BAY-052", "along": "width"}` checks the part's size along a model axis (`width`, `depth`, `height`) or its `longest` length. Use an axis only for a part that sits square to the model.
   - anything else needs a check in `../rebuild/tools/targets.mjs`, with a test.
2. **Add the assessment.** Levels 3 to 5 need a target. A part with several rows in the master list (a cassette part, or one whose lettering differs between exterior versions) also needs its `"variant"` as the list shows it.

   ```json
   {"id": "A-0001", "part": "BAY-052", "feature": "diameter", "level": 4, "target": "capstan.diameter.measured", "issues": [12]}
   ```

3. **Give the part a checklist** of what defines it: `"checklists": {"BAY-052": {"features": ["diameter", "length", "axis position"], "reviewed": "issue 12"}}`. Without one, its only feature is the placeholder "overall geometry", which stays at level 1.
4. `npm run build:viewer`, read the result, then `npm run accept`, which ties the assessment to the parts' current shape, position and motion and to the target's definition (its `bound_to` block).

The build then enforces:

- If a tied part or target changes, the assessment stops counting: review it, delete its `bound_to` block, accept again.
- If the model fails the check, the measurement stays on record and the feature stays at level 1. Fix the model, not the target.
- Two measurements of one feature that cannot both be right stay as two targets; neither counts until one is withdrawn.
- Level 6 needs a `corroborations` entry naming two level 5 assessments from different issues, with `"distinct_people_and_units_verified": true`.
- A feature dropped from a checklist, or any change of level, shows in `npm test` as a change to accept.

Store issue numbers only. Names, serial numbers, photographs and links stay in the issue.
