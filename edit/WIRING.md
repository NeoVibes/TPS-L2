# Wiring

The wiring follows Sony's New board mounting (service manual, printed pp.15–16) and schematic (pp.17–18). In the viewer, **Parts → Assemblies → Playback wiring** shows the head cable, switches, microphone and both headphone sockets; in Blender, search for the part IDs below. [wiring-map.csv](wiring-map.csv) lists each lead's ends and modelled length (Blender world millimetres).

| Parts | What they are |
|---|---|
| WIR-PB-01, WIR-PB-02 | Shielded stereo cables: head to the jack board (red sleeves; bends as the head enters PLAY), jack board to the main preamps (blue sleeves). |
| WIR-MIC-01…04 | Microphone leads to the jack board; the orange lead brings its bias from the main board. |
| WIR-OUT-01…03 | Headphone feeds (white left, blue right) and the black sleeve return to main common. |
| WIR-MTR-01…04, WIR-611/612 | Motor brush and FG leads (FG phase unassigned); L601's two lead pairs. |
| WIR-PWR-01…09, CAP-901 | DC input, switched battery feed, charge contact, returns, cell link; C901 across the DC jack. |
| WIR-IN-01/02, WIR-TNE-01…04, WIR-AF-01 | Main-board links: the preamp inputs, S301's two tone poles, the right volume input. |
| WIR-901/902 | D901's legs and their board links. |
| RET-101…104 | Harness dressing: filament tape, foam pad, carrier strap, retaining tab. |

**Switches.** S901 is open in STOP and closed in PLAY, FF and REW. S301 joins brown–violet and blue–white in LOW and opens both in HIGH. S801's bridges join 011/012 and 014/015 at rest, 012/013 and 015/016 pressed. The DC jack's battery contact opens with the shape key **Plug opens battery contact** on `CNJ901 • normally closed spring contact` (JCK-36).

**Checking.** After a build, `npm test -- wiring` in `rebuild/` checks the full and the packed geometry: each lead end on its land; each wire's metal touching only what `tests/reference/wire-contacts.json` lists for it, at rest and in PLAY; the through-hole joints; the cable cores, shields and drains; the switch states. Its 0.002 mm allowance is agreement within the model, not a measurement.

**Limits.** The README's *How sure is it* says what the wiring rests on and where the copper still differs from the schematic.
