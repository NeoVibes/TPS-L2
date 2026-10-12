# Portable Tape Player

<img width="880" height="699" alt="The viewer in use: the versions, a turn, the doors, PLAY, the exploded and service views, every part" src="https://github.com/user-attachments/assets/931e6ca6-4ece-4b89-8dc2-487cfec332a3" />

![The three exterior versions of the model, early to later](publish/github/three-versions.png)

A 3D model of the Sony TPS-L2 that you can operate, take apart on screen, edit and improve.

This model is an estimate. It was worked out from photographs, videos, Sony’s service manual and the Compact Cassette standard, and no part has yet been checked against a real unit. Every part carries a confirmation level, from 1 (modelled, not checked) to 6 (measured on two units by two people); today all are at level 1.

Serial number 12345 was chosen completely arbitrarily for this model and is not taken from any real unit.

Unofficial project, not affiliated with or endorsed by Sony.

**Download:** the whole kit as one ZIP is on the [Releases](https://github.com/NeoVibes/TPS-L2/releases) page.

## What is here

| Folder | For | Start with |
|---|---|---|
| `view/` | Looking at the model | Double-click `view/index.html`. Nothing to install. |
| `edit/` | Changing the model, its targets and its parts lists | `edit/EDITING.md`. Needs Blender 5.2 or newer. |
| `rebuild/` | Turning an edit into a new `view/` | `rebuild/REBUILDING.md`. Needs Blender and Node 24. |
| `publish/` | Releasing your own version | `publish/PUBLISHING.md`. |

Keep `view/index.html` and `view/geometry/` side by side. It is tested in Chrome; a current Safari or Firefox should work too.

In the viewer: press PLAY, drag the volume grips, open the battery cover. **Exterior version** switches between the three versions of the lettering. **Inspect** lets you search by part name, model part ID, or the service manual's Ref. No. and Part No. (try `8-835-008-11`), and lists every part with its confirmation level.

## How sure is it

| Level | Meaning |
|---|---|
| 0 | Not modelled |
| 1 | Modelled estimate; its basis has not been independently assessed |
| 2 | Based on reference material: standards, manufacturer specifications, photos or service manuals |
| 3 | Estimated from photographs using a defined measuring reference or system |
| 4 | Measured from a physical part, without additional supporting evidence |
| 5 | Measured from a physical part with supporting evidence |
| 6 | Level 5 corroborated by at least two people using two different physical units |

A part's level is the lowest level among the features that define it.

- `view/master-parts.csv` lists every part, and every service-manual part not modelled yet, with its level and its size in the model. Those sizes are the model's own, not measurements.
- `view/TARGETS.md` lists the numbers the model is meant to match and how it compares today.

Known problems:

- **Body:** the front is about 88 mm wide in the model; the target is 85 mm. Depth, window shape and margins are uncertain.
- **Cassette bay:** a standard cassette does not yet seat with proper clearance.
- **Drive:** shaft positions, gear ratios and capstan speed are not calibrated. Belts, springs and friction are shown, not simulated.
- **Solids:** many parts are not single closed solids; the master list says which and why.
- **Early exterior:** its white STEREO and dark key legends are printed over the moulded letters of the shared shells; a real early player is flat there. The older lettering is placed by eye from one photograph.
- **Separated views** are illustrations, not removal instructions.

## Take part

Three ways, each fine by itself.

1. **Enjoy it and share it.** It is free to use and share with credit (see Licences).
2. **Send a measurement.** Pick the part in the viewer's Inspect panel and choose "Confirm a feature". Say which exterior version your player is, what you measured and where the measurement starts and ends, the value and the instrument. Photos or links to photos are enough. The maintainer adjusts the model.
3. **Adjust a part yourself.** Edit your own copy in Blender, put it anywhere you like, and send a link to it with the measurement it rests on.

A submission is public: hide serial numbers, leave out your name and address, and remove location data from photographs. Every submission is reviewed, and a part's level rises only when the model matches.

## Licences

MIT, for the model and the code. Details and third-party notices are in `LICENSES.md`.
