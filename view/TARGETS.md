# Targets

Version 0.2.6. Written by the build from `edit/targets.json`; edit that file, not this one.

**These are the numbers the model is meant to match, and how the model compares today.** Most come from photographs, videos, Sony's service manual and published standards. A target is not a measurement of a real unit unless its class is `measured`. Where the model fails a target, the model is wrong or the target is in doubt; both are shown rather than hidden.

Of 120 targets, the model passes 95, fails 8 and has no check yet for 17.

## The three exterior versions

The model can be shown as any of three exterior versions. Only lettering differs between them.

| | Early | Intermediate | Later |
|---|---|---|---|
| Serial number, approximate | up to about 30,000 | about 30,000 to 264,000 | serial above about 264,000 |
| Door (`EXT-030`) | STEREO, arrow | STEREO, arrow | SONY, arrow, WALKMAN |
| Upper panel front (`EXT-020`) | SONY and STEREO CASSETTE PLAYER TPS-L2 | SONY and STEREO CASSETTE PLAYER TPS-L2 | blank |
| Headphone sockets (`EXT-020`) | GUYS & DOLLS | A B | A B |
| Back (`EXT-010`) | STEREO printed white | STEREO moulded | STEREO moulded |
| LISTEN, REW/REVIEW, FF/CUE (`GRL-001`) | printed dark | moulded | moulded |
| Play triangle (`GRL-001`) | black | green | black |

One published comparison of three players (AppleTechLab, 15 August 2014; serials 15371, 136497 and 349538). The serial ranges shown in the viewer are approximate: the split at 264,000 is quoted there from Sony's November 1980 parts list, and Sony's service manual gives other numbers for other markets.

The shells, the interior and everything else are the same in all three. Sony lists one mechanical chassis for every version, so drive and chassis targets apply to all. The WM-3 shares the flywheel and capstan sleeve part numbers and is used as evidence for those parts.

Limitations:
- On Early, the white STEREO and the dark legends are printed over the moulded letters, because the shells are shared by all three versions. On a real early player those surfaces are flat under the print.
- The lettering of Early and Intermediate is placed and sized by eye from one photograph.
- Some Intermediate players carried a WALKMAN sticker low on the door. It is not modelled.

Sony's manual also distinguishes these, which the model does not follow:
- Former and new models, split by serial number: different main circuit board (A-3068-050-A former, A-3068-057-A new) and volume control hardware (shaft and two collars on the former model, a VR collar on the new). Service manual exploded view 6-1.
- Marked and non-marked model name: different cassette lid (X-3568-711-2 marked, -0 non-marked), panel assembly (X-3568-707-4, -0) and upper panel (X-3568-704-0 marked, -4 non-marked). Service manual exploded view 6-1.

## Classes

| Class | What it means |
|---|---|
| standard | Fixed by a published standard or stock component. |
| documented | Stated by Sony in the service manual or operating instructions. |
| reported | Measured on a real unit by a third party; instrument not documented. |
| photo-measured | Measured by this project from photos or video against a known scale or by counting; uncertainty stated. |
| designed | Chosen by this project to satisfy the constraints; never presented as observed. |
| measured | Measured on a physical part by a contributor and accepted by a maintainer; the issue number is in edit/assessments.json. |

Tolerance is the uncertainty on the target, not a manufacturing tolerance. Lengths are in mm. Height is the long dimension of the body, width is across the front, depth is front to back.

## Targets

"Model" is what the check measures on the model. For a shaft position it is the distance from the target position.

| Target | Value | Tolerance | Unit | Class | Rests on | Applies to | Model | Outcome |
|---|---|---|---|---|---|---|---|---|
| `cassette.width` | 100.4 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 |  | 100.4 | pass |
| `cassette.height` | 63.8 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 |  | 63.8 | pass |
| `cassette.thickness_body` | 8.6 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 |  | 8.6 | pass |
| `cassette.thickness_head_end` | 12 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 | MEDIA-001 MEDIA-002 | 12 | pass |
| `tape.plane_above_carriage_plate` | 6 | ± 1 | mm | photo-measured | second Walkman Clinic set, photo 15 (side view): the head sits on the carriage plate and stands about twice as tall as the 6.5 mm pinch roller, so the tape plane at its middle is about 6 mm above the plate; a standard cassette's head band needs 6.0 (ECMA-34 Fig. 4) | MEDIA-004 HDC-001 | 6.1 | pass |
| `cassette.reel_pitch` | 42.5 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 |  | 42.5 | pass |
| `cassette.capstan_pitch` | 48 | ± 0.2 | mm | standard | ECMA-34 Fig. 4 |  | 48 | pass |
| `cassette.capstan_row_to_reel_row` | 31.3 | ± 0.25 | mm | standard | ECMA-34 Fig. 4: reel row 27.9 behind the reference line, capstan row 3.4 ahead of it |  | 31.3 | pass |
| `cassette.capstan_outboard_of_reel` | 2.75 | ± 0.25 | mm | standard | ECMA-34 Fig. 4: (48 - 42.5) / 2 |  | 2.75 | pass |
| `cassette.reference_hole_pitch` | 28 | ± 0.15 | mm | standard | ECMA-34 Fig. 4 |  | 28 | pass |
| `cassette.reference_hole_row_to_reel_row` | 29.7 | ± 0.2 | mm | standard | ECMA-34 Fig. 4: holes 3.6 wide with one edge on the reference line, 27.9 from the hub row |  | 29.7 | pass |
| `cell.aa_diameter_max` | 14.5 | not stated | mm | standard | IEC 60086, R6 cell |  | 14.5508 | pass |
| `cell.aa_length_max` | 50.5 | not stated | mm | standard | IEC 60086, R6 cell |  | 48.783 | pass |
| `tape.speed` | 47.6 | ± 2 % | mm/s | documented | Sony service manual p.7: a 3 kHz test tape must read 2,940 to 3,060 Hz |  | 47.6 | pass |
| `wind.c60_time` | 150 | ± 15 | s | documented | Sony service manual p.1: approx. 2 min 30 s |  | 139.4469, 161.1387 | pass |
| `motor.speed_while_winding` | 1 | ± 0.02 | of its PLAY speed | documented | Sony service manual pp.11-12, schematic: the motor is held at speed by the CX183 servo from a frequency generator built into the motor, and nothing in the circuit changes with the mode; with no cassette the set draws 100 mA in FWD, 105 in FF and 110 in REW. So the motor runs as fast while winding as in PLAY | MTR-004 MEC-011 | 1 | pass |
| `fr_pulley.slip_while_winding` | 28 | ± 1 | % | designed | not measured. With the motor servo-held and every contact rolling, a C-60 side would wind in 100 s forward and 116 s back; Sony gives approx. 2 min 30 s. The difference is put on the FF/REW tyre slipping on the flywheel's front disc, the friction drive that carries the winding load: 28 per cent gives 139 s and 161 s | DRV-023 MEC-011 | 28 | pass |
| `torque.takeup_play` | 22.5 to 45 |  | g.cm | documented | Sony service manual p.6 |  | 33.835 | pass |
| `torque.fast_wind_min` | 55 | not stated | g.cm | documented | Sony service manual p.6 |  | 62.0194 | pass |
| `torque.back_tension` | 2 to 3.5 |  | g.cm | documented | Sony service manual p.6 |  | 2.7363 | pass |
| `pinch.pressure` | 200 to 300 |  | g | documented | Sony service manual p.6 |  | 255.9427 | pass |
| `motor.never_reverses` | true | not stated |  | documented | Sony service manual p.3: the motor arrow is the same in FWD, FF and REW |  | true | pass |
| `body.height` | 133.5 | ± 0.5 | mm | documented | Sony service manual p.2: approx. 133.5; the third-party dimensioned sketch of a real unit (Imgur album tps-l2-dimensions-wD2kVLQ) agrees | EXT-010 EXT-020 EXT-030 GRL-001 | 133.3 | pass |
| `body.front_width` | 85 | ± 0.6 | mm | reported | third-party dimensioned sketch of a real unit (Imgur album tps-l2-dimensions-wD2kVLQ); photographs of two units read 84.1 to 84.9 | EXT-010 EXT-020 EXT-030 GRL-001 | 87.802 | **fail** |
| `body.width` | 88 | ± 0.6 | mm | documented | Sony service manual p.2: approx. 88 (w) x 133.5 (h) x 29 (d) mm, not including projecting parts and controls. It disagrees with body.front_width (85.0: a third party's measurement and photo readings of 84 to 86), which is the same width; the original workspace left the two open side by side (D-NUMBERED-GRID-ENVELOPE) until a unit is measured | EXT-010 EXT-020 EXT-030 GRL-001 | 87.802 | pass |
| `body.depth` | 29.75 | ± 0.75 | mm | reported | third-party dimensioned sketch of a real unit (Imgur album tps-l2-dimensions-wD2kVLQ). Sony gives approx. 29; photographs suggest 27.6 to 28.7, so this target is in doubt |  | 29.774 | pass |
| `body.depth_over_width` | 0.324 | ± 0.005 | ratio | photo-measured | published turntable video of a unit of this variant |  | 0.3391 | **fail** |
| `control.listen_key_proud_of_side` | 1.4 | ± 0.3 | mm | photo-measured | published turntable video, front square-on, key unpressed |  | 1.3218 | pass |
| `front.silver_strip` | 15.7 | ± 0.7 | mm | photo-measured | front-on photographs of several units, scaled to the body (five units) |  | 15.018 | pass |
| `front.top_band` | 20.4 | ± 0.7 | mm | photo-measured | front-on photographs of several units, scaled to the body (six units) | EXT-020 | 20.494 | pass |
| `window.opening_width` | 27.3 | ± 0.6 | mm | photo-measured | front-on photographs of several units, scaled to the body: outer edge of the bevelled opening | EXT-031 EXT-032 | 24.51 | **fail** |
| `window.opening_height` | 68.2 | ± 0.4 | mm | photo-measured | front-on photographs of several units, scaled to the body (five units) | EXT-031 EXT-032 | 66.26 | **fail** |
| `window.right_edge_to_strip` | 26.75 | ± 0.7 | mm | photo-measured | front-on photographs of several units, scaled to the body |  | 26.904 | pass |
| `window.bottom_to_body_bottom` | 23.75 | ± 0.5 | mm | photo-measured | front-on photographs of several units, scaled to the body |  | 23.62 | pass |
| `window.left_margin` | 14.9 | ± 0.8 | mm | photo-measured | front-on photographs of several units, scaled to the body: to the outer edge of the opening |  | 21.37 | **fail** |
| `capstan.diameter` | 2 | ± 0.05 | mm | documented | nominal size: Sony service manual exploded view 6-2 puts a 'Washer, plastic 2mm dia.' on the flywheel shaft. That names the shaft's size without measuring it; a published video of a running unit has the flywheel at 7.77 rev/s, which at 47.6 mm/s would be a 1.95 mm capstan | BAY-052 | 2 | pass |
| `flywheel.rate_play` | 7.58 | ± 2 % | rev/s | designed | tape.speed / (pi x capstan.diameter) | MEC-011 | 7.5758 | pass |
| `shaft.fr_gears` | 1.2 | not stated | mm | documented | Sony service manual exploded view 6-4: FF/REW gears A and B and the secondary gear are held by 'Washer, plastic 1.2mm dia. (t=0.25)'. Gear B's stack also has a 1.6 mm washer under that one, so 1.2 mm is the neck at the shaft's top that the washer seats on, not the shaft | DRV-012 DRV-013 DRV-016 | 1.1996 | pass |
| `shaft.pulleys_third_gear` | 1.6 | not stated | mm | documented | Sony service manual exploded view 6-4: FF/REW pulley, middle pulley and third gear take 'Washer, plastic 1.6mm dia.' | DRV-020 DRV-023 CAM-010 | 1.6004 | pass |
| `shaft.levers` | 2 | not stated | mm | documented | Sony service manual exploded views 6-2 and 6-3: stop lever, release lever and head board posts take the 2 mm washer |  | 2 | pass |
| `gear.module` | 0.3 | not stated | mm | photo-measured | published teardown photographs: S gears A and B are 15.10 mm apart and have 40 and 60 teeth |  | 0.3 | pass |
| `gear.s_gear_b.teeth` | 60 | ± 0 |  | photo-measured | published teardown photographs: counted round the whole gear | DRV-011 | 60 | pass |
| `gear.s_gear_a.teeth` | 40 | ± 0 |  | photo-measured | published teardown photographs: counted round the whole gear | DRV-010 | 40 | pass |
| `gear.fr_gear_b.teeth` | 36 | ± 0 |  | photo-measured | published teardown photographs: counted round the whole gear | DRV-013 | 36 | pass |
| `gear.takeup.teeth` | 60 | ± 0 |  | photo-measured | published teardown photographs: counted on the felt-faced gear | DRV-014 | 60 | pass |
| `gear.takeup.step_teeth` | 42 | ± 1 |  | photo-measured | provisional: read on two loose gears seen from the stepped face in published teardown photographs, not counted tooth by tooth. Supported by the gear it meshes with (gear.takeup.step_mate): 79.7 teeth between the two at the 0.3 module, of which that gear's own size takes 37.6 | DRV-014 | 42 | pass |
| `gear.takeup.step_mate` | 11.95 | ± 0.4 | mm | photo-measured | what the 42-tooth ring meshes with: the gear beside the take-up spindle (the tape-counter gear of Sony's FWD sequence, p.4), fitted in the published square-on photograph of the gear plate: its axis 11.95 mm from the take-up axis. Too near for the 60-tooth ring, which would need 13.5 or more | DRV-017 DRV-014 | 12 | pass |
| `gear.step_mate.teeth` | 38 | ± 1 |  | photo-measured | the same photograph: 5.94 mm to its tooth tips (37.6 teeth at the 0.3 module) and 11.95 mm from the take-up axis (37.7 teeth against the ring's 42). An earlier automatic count read 33, which neither size allows | DRV-017 | 38 | pass |
| `gear.takeup.tip_diameter` | 18.6 | ± 0.7 | mm | photo-measured | nominal size: 60 teeth at the 0.3 module of S gear B give 18.6. The published teardown photograph of the gear plate, seen square-on and scaled to the 42.5 mm reel pitch, reads about 19.3 (the ring stands above the plate) and S gear B 18.5 | DRV-014 | 18.597 | pass |
| `clutch.drum.diameter` | 17 | ± 0.6 | mm | photo-measured | the same square-on photograph: 16.5 to 17.3 | CLT-030 | 16.5 | pass |
| `clutch.felt.outer_diameter` | 15.9 | ± 0.6 | mm | photo-measured | published teardown photograph of the felt in its seat: 0.857 of the gear's tip diameter | CLT-010 | 15.9 | pass |
| `clutch.spring.outer_diameter` | 7.2 | ± 0.8 | mm | photo-measured | published teardown photographs: the loose spring beside gears of known size, and the coil seen in the drum's well | CLT-031 | 7.197 | pass |
| `clutch.spring.free_length` | 8.3 | not stated | mm | designed | chosen so that the spring as modelled (0.4 mm wire, 6.8 mm mean coil), compressed into its 2.3 mm space, squeezes the felt hard enough for the middle of Sony's PLAY torque; no spring has been measured | CLT-031 |  | no check |
| `clutch.spring.active_coils` | 2.75 | not stated |  | designed | the spring as modelled: 4.25 turns, three quarters of a turn closed at each end | CLT-031 |  | no check |
| `clutch.felt.friction` | 0.3 | not stated |  | designed | assumed coefficient for wool felt on moulded plastic (usual range 0.2 to 0.4); not measured | CLT-010 |  | no check |
| `spring.steel_shear_modulus` | 79300 | not stated | N/mm2 | standard | shear modulus of steel spring wire |  |  | no check |
| `spring.steel_youngs_modulus` | 206000 | not stated | N/mm2 | standard | Young's modulus of steel spring wire (music wire) |  |  | no check |
| `pinch.spring.preload` | 24 | not stated | deg | designed | chosen so that the pinch lever's torsion spring as modelled (0.45 mm wire, 2.33 mm mean coil, 1.4 turns) presses the roller on the capstan with 250 g in PLAY, the middle of Sony's 200 to 300 g; the spring is wound this far at rest against its stop. No spring has been measured | HDC-024 |  | no check |
| `back_tension.spring.free_length` | 4.33 | not stated | mm | designed | chosen so that the back-tension spring as modelled (0.4 mm wire, 3.0 mm mean coil, compressed to 4.03 mm) presses S gear B on its brake felt hard enough for 2.75 g.cm at the supply reel, the middle of Sony's 2 to 3.5; no spring has been measured | SBT-010 |  | no check |
| `back_tension.spring.active_coils` | 4.5 | not stated |  | designed | the spring as modelled: about 6 turns, three quarters of a turn closed at each end | SBT-010 |  | no check |
| `lever_b.spring.free_length` | 5.53 | not stated | mm | designed | chosen so that lever (B)'s spring as modelled (0.18 mm wire, 0.9 mm mean coil, 20 coils, 6.0 mm long in FF) presses the FF/REW tyre on the flywheel hard enough for 60 g.cm at the take-up, 10 per cent over Sony's least 55; no spring has been measured | FRL-021 |  | no check |
| `lever_b.spring.active_coils` | 20 | not stated |  | designed | the spring as modelled | FRL-021 |  | no check |
| `fr_tyre.friction` | 0.8 | not stated |  | designed | assumed coefficient for rubber on brass; not measured | DRV-023 MEC-011 |  | no check |
| `gear.fr_gear_a.teeth` | 26 | ± 0 |  | photo-measured | published teardown photographs: counted on the large tier | DRV-012 | 26 | pass |
| `gear.fr_pulley_pinion.teeth` | 28 | ± 2 |  | photo-measured | published teardown photographs: about 15 teeth across the visible half, and the gear is 0.73 of the 12 mm tyre across (27 to 29 teeth at the 0.3 module) | DRV-021 | 28 | pass |
| `belt.main.inner_diameter` | 44 | not stated | mm | reported | replacement-belt suppliers' listed sizes | BLT-001 |  | no check |
| `belt.main.section` | 0.8 | not stated | mm | reported | replacement-belt suppliers' listed sizes | BLT-001 |  | no check |
| `belt.main.free_length` | 140.7 | not stated | mm | reported | pi x (44.0 + 0.8), from the supplier sizes | BLT-001 | 7.7989 | pass |
| `belt.second.free_length` | 115.9 | not stated | mm | reported | pi x (36.0 + 0.9), from the supplier sizes | BLT-002 | 7.6514 | pass |
| `belt.stretch_range` | 4 to 8 |  | % | designed | usual installed stretch for small square-section drive belts |  |  | no check |
| `ratio.reverse_wheel_to_flywheel` | 2.68 | ± 0.08 |  | photo-measured | published repair video, measured frame by frame: reverse wheel 20.82 rev/s against flywheel 7.774 rev/s on a running unit | DRV-022 MEC-011 | 2.68 | pass |
| `tyre.fr_pulley.od` | 12 | ± 0.3 | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | DRV-023 | 12 | pass |
| `tyre.fr_pulley.id` | 7 | not stated | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | DRV-023 | 6.9918 | pass |
| `tyre.fr_pulley.width` | 2.25 | not stated | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | DRV-023 | 2.25 | pass |
| `tyre.fwd_pulley.od` | 8 | ± 0.3 | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | FWD-021 | 8 | pass |
| `pinch_roller.od` | 9 | ± 0.3 | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | BAY-061 | 9 | pass |
| `pinch_roller.width` | 6.5 | ± 0.2 | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | BAY-061 | 6.5 | pass |
| `flywheel.rim_diameter` | 25.4 | ± 0.8 | mm | photo-measured | two readings of the front disc: a published repair video, measured frame by frame, gives 24.0 for a WM-3 flywheel, which Sony lists as the same part family; Sony's FF and REW photographs put the FF/REW tyre's axle 19.2 mm from the capstan axis, which with the reported 12.0 mm tyre makes the disc it runs on 26.4. The value is their weighted mean | MEC-011 | 25.8 | pass |
| `axis.reverse_wheel` | (-5.3, 12.7) | ± 1 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (mean of four readings) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; DRV-022 | 0 off | pass |
| `axis.fr_pulley_engaged` | (6.65, 14.55) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (mean of FF and REW) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in FF, REW; DRV-023 | 0.6534 off, 0.6534 off | pass |
| `axis.fr_pulley_released` | (6.73, 12.83) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (FWD) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in PLAY; DRV-023 | 0.6109 off | pass |
| `contact.fr_pulley_to_capstan_axis_engaged` | 19.2 | ± 0.5 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch: 19.30 in FF, 19.11 in REW | DRV-023 MEC-011 | 18.9 | pass |
| `contact.fr_pulley_travel` | 1.5 | ± 0.6 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch: 20.76 mm from the capstan axis in PLAY against 19.2 engaged | DRV-023 | 1.4167 | pass |
| `axis.fr_gear_b` | (15.03, 10.64) | ± 0.8 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (mean of three) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; DRV-013 | 0.6475 off | pass |
| `axis.fr_gear_a_ff` | (13.15, 2.03) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in FF; DRV-012 | 0.4456 off | pass |
| `axis.fr_gear_a_rew` | (16.75, 2.19) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in REW; DRV-012 | 0.5825 off | pass |
| `axis.fr_gear_a_play` | (15.81, 1.57) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch; Sony marks a clearance here in FWD | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in PLAY; DRV-012 | 0.4603 off | pass |
| `arm.fr_gear_a_about_fr_gear_b` | 9.3 | ± 0.1 | mm | designed | 0.3 module x (36 + 26) / 2, from the counted teeth | DRV-012 DRV-013 | 9.3 | pass |
| `axis.fwd_pulley_engaged` | (8.95, -9.3) | ± 0.8 | mm | photo-measured | Sony's FWD photograph, scaled to the 42.5 mm reel pitch, read twice: (9.23, -9.55) in the first study and (8.67, -9.05) from the centre of the dashed circle Sony draws for the pulley; the value is their mean. The place also follows from the tyre touching both the drum and the middle pulley | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in PLAY; FWD-021 | 0.7741 off | pass |
| `axis.middle_pulley` | (4.19, -14.26) | ± 0.6 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch: (4.24, -14.29) in FWD, (4.11, -14.26) in FF, (4.22, -14.22) in REW. The axle's end stands above the gears, so the true place may be 0.1 to 0.4 nearer the reel row | u toward the supply reel, v toward the capstan row, origin on the take-up axis; DRV-020 | 0.0608 off | pass |
| `clearance.third_gear_to_motor_pulley` | 0.5 | ± 0.1 | mm | documented | Sony service manual p.7, Caution when installing motor: the gap between the third gear's rim and the end face of the motor pulley is to be just 0.5 mm, or the automatic shut-off may work before the tape ends | CAM-010 MTR-005 | 0.5 | pass |
| `gear.fr_gear_a_small_tier.teeth` | 15 | ± 2 |  | photo-measured | published teardown photographs: radius about 0.6 of the 26-tooth tier | DRV-012 | 15 | pass |
| `gear.third.teeth` | 44 | ± 1 |  | photo-measured | counted on the unrolled rim in a repair close-up (stereo2go thread 9534, photo 3): 41 teeth seen, 3 hidden under the lever; published teardown photographs counted by program and by eye agree within 3 | CAM-010 | 44 | pass |
| `gear.secondary.teeth` | 30 | ± 1 |  | photo-measured | counted in two repair close-ups (stereo2go thread 9534, photos 4 and 6): the wheel the middle pulley's pinion drives | DRV-016 | 30 | pass |
| `gear.secondary_pinion.teeth` | 13 | ± 2 |  | photo-measured | the black pinion on top of the second gear, which drives the third gear (repair close-ups 1, 3 and 4): read from the centre distance to the third gear, about 8.5 mm, not counted | DRV-016 | 13 | pass |
| `gear.third_pinion.teeth` | 9 | not stated | teeth | designed | Sony service manual p.3: the shut-off lever's teeth mesh with the teeth of the third gear; the close-ups show a coarse-toothed piece low beside the third gear's shaft, so a small pinion under the gear is assumed; 9 teeth of 0.4 module are designed | CAM-010 STF-012 | 9 | pass |
| `axis.third_gear` | (-0.7, -23.5) | ± 0.6 | mm | photo-measured | Sony service manual p.7, square-on photograph scaled by the 60-tooth gear: 9.3 mm from the middle pulley's axis across the body and 4.9 mm along it. Repair close-ups agree within about 1.5 mm. The motor is then placed by the 0.5 mm gap | u toward the supply reel, v toward the capstan row, origin on the take-up axis; CAM-010 | 0 off | pass |
| `axis.shutoff_post` | (-0.65, -13.35) | ± 0.8 | mm | photo-measured | three repair close-ups (stereo2go thread 9534, photos 1 and 4, auto-stop 2): the shut-off lever's post stands 4.6 to 5.4 mm from the middle pulley's shaft, nearly along the body; oblique views | u toward the supply reel, v toward the capstan row, origin on the take-up axis; STF-101 STF-010 | 0 off | pass |
| `flywheel.upper_flange_diameter` | 21.6 | ± 1 | mm | photo-measured | published repair video, measured frame by frame: 0.92 of the main disc | MEC-011 | 22.6 | pass |
| `flywheel.hub_flange_diameter` | 7.2 | ± 0.4 | mm | photo-measured | published repair video, measured frame by frame: 0.33 of the upper flange | MEC-011 | 7.2 | pass |
| `reel_table.cap_top_above_flange` | 8.86 | ± 0.15 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  | 8.86 | pass |
| `pin.locating_tip_above_reel_cap` | 2.04 | ± 0.4 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  | 2.04 | pass |
| `capstan.tip_above_reel_cap` | 1.15 | ± 0.4 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  | 1.15 | pass |
| `pin.locating_base_flange_below_reel_cap` | 9.25 | ± 0.5 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay; taken as the cassette's seat |  | 9.27 | pass |
| `flywheel.main_disc_thickness` | 4.48 | ± 0.2 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  | 4.48 | pass |
| `flywheel.groove_width` | 1.83 | ± 0.2 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay: gap between the main disc and the thin flange |  | 1.68 | pass |
| `flywheel.upper_flange_thickness` | 0.96 | ± 0.15 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  | 0.82 | pass |
| `flywheel.front_face_behind_pin_flange` | 3.34 | ± 0.5 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  | 4.66 | **fail** |
| `body.depth_minimum_from_stack` | 27.9 | not stated | mm | designed | cassette 10.3 + AA cell 14.5, plus the thinnest conceivable lid, separator and door |  | 29.774 | pass |
| `reverse_wheel.outer_diameter` | 10.1 | ± 0.4 | mm | photo-measured | published repair video, measured frame by frame | DRV-022 | 10.1 | pass |
| `bay.cassette_rear_edge_to_frame_edge` | 3.4 | ± 2.5 | mm | photo-measured | published repair video, measured frame by frame, read across about 10 mm of height without correction | BAY-010 MEDIA-001 |  | no check |
| `bay.cassette_to_chassis_end_battery` | 6.1 | ± 1 | mm | photo-measured | published repair video, measured frame by frame; the second set of published teardown photographs agrees | MEDIA-001 | 6.45 | pass |
| `bay.hook_far_edge_behind_cassette_rear_edge` | 0.7 | ± 0.8 | mm | photo-measured | second set of published teardown photographs |  |  | no check |
| `bay.hook_height_above_cassette_top_face` | 3.1 | ± 0.8 | mm | photo-measured | second set of published teardown photographs: 2.7 at the far edge, 3.6 at the near edge |  |  | no check |
| `bay.top_rail_outer_edge_beyond_cassette_end` | 6.2 | ± 0.6 | mm | photo-measured | second set of published teardown photographs |  | 6.2 | pass |
| `bay.top_rail_top_above_cassette_top_face` | 1.5 | ± 0.6 | mm | photo-measured | second set of published teardown photographs |  | 1.5 | pass |
| `cover.control_side_face_width` | 27.6 | ± 0.6 | mm | photo-measured | second set of published teardown photographs, taking the cover as 133.5 long |  | 27.5472 | pass |
| `lid.window_centre_fraction_of_lid_width` | 0.426 | ± 0.01 | ratio | photo-measured | second set of published teardown photographs: from the plain-side edge |  | 0.462 | **fail** |
| `lid.height_over_width` | 1.62 | ± 0.05 | ratio | photo-measured | second set of published teardown photographs |  | 1.547 | **fail** |
| `belt.length_ratio_main_to_second` | 1.2 | ± 0.05 | ratio | photo-measured | second set of published teardown photographs; supplier sizes give 1.21 |  | 1.2156 | pass |

## Other checks

Checks that have no target of their own: they test that the model is consistent with itself or with several targets at once.

| Check | Group | Model | Allowed | Outcome | Note |
|---|---|---|---|---|---|
| `solids.single_closed_shell` | solids | 41 parts | 0 to 0 | **fail** | 507 parts: 466 are one closed solid, 41 are not. Vertices closer than 0.001 mm are joined; lettering is left out. |
| `cassette.head_band_clears_the_carriage_plate` | envelope | 0.1 mm | 0.05 to … | pass | Gap between the back of the cassette's head band and the head-carriage plate under it, at rest. |
| `cassette.left_wall_room_at_registered_width` | envelope | 1.398 mm | 2 to … | **fail** | Room left of the cassette if the width surplus is removed from the left side. Needs a wall plus clearance; 2 mm is a working minimum. |
| `flywheel_on_capstan_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `capstan_shaft_on_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `s_gear_a_on_supply_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `takeup_gear_on_takeup_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `supply_hub_on_supply_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `takeup_hub_on_takeup_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `cassette_hub_pivots_match_reel_pivots` | axes | 0 mm | -0.05 to 0.05 | pass |  |
| `cassette_hub_pivots_match_reel_pivots_takeup` | axes | 0 mm | -0.05 to 0.05 | pass |  |
| `reel.takeup_rate_matches_tape` | motion | 2.8 rad/s | 1.8667 to 4.3273 | pass | A reel must turn at tape speed over its pack radius, between an empty hub (about 11 mm) and a full C-90 pack (about 25.5 mm). |
| `reel.supply_rate_matches_tape` | motion | 2.8 rad/s | 1.8667 to 4.3273 | pass | A reel must turn at tape speed over its pack radius, between an empty hub (about 11 mm) and a full C-90 pack (about 25.5 mm). |
| `clutch.pressed_parts_turn_with_reel` | motion | 0 parts | 0 to 0 | pass | Parts pressed on the take-up shaft that the motion rig does not turn with the reel. |
| `clutch.drum_outruns_reel_in_play` | motion | 4.9852 rad/s | 4.3273 to … | pass | The drum the FWD pulley drives must turn faster than the reel ever needs (tape speed over an empty hub of about 11 mm), in the same direction, so the felt always slips. |
| `clutch.drive_rolls_without_slipping` | motion | 0 % | 0 to 1 | pass | Largest difference between the surface speeds of the middle pulley, the FWD tyre and the drum in PLAY. |
| `fwd_pulley.presses_drum_in_play` | motion | -0.0996 mm | -0.3 to 0 | pass | Gap from the FWD tyre to the drum in PLAY; a friction drive needs slight compression. |
| `fwd_pulley.presses_middle_pulley_in_play` | motion | -0.0505 mm | -0.3 to 0 | pass | Gap from the FWD tyre to the middle pulley in PLAY. |
| `fwd_pulley.clear_of_drum_in_stop` | motion | 0.3046 mm | 0.2 to … | pass | Gap from the FWD tyre to the drum in STOP; Sony marks a clearance. |
| `fwd_pulley.clear_of_drum_in_ff` | motion | 0.3046 mm | 0.2 to … | pass | Gap from the FWD tyre to the drum in FF; Sony marks a clearance. |
| `fwd_pulley.clear_of_drum_in_rew` | motion | 0.3046 mm | 0.2 to … | pass | Gap from the FWD tyre to the drum in REW; Sony marks a clearance. |
| `clutch.felt_is_squeezed` | motion | 0.03 mm | 0.01 to 0.1 | pass | How far the drum's face stands into the felt: the friction faces must bear on each other, not stand apart. |
| `clutch.spring_bears_on_its_seat` | motion | 0.004 mm | 0.001 to 0.05 | pass | How far the spring's end coil stands into the brass seat it presses on; its other end stands the same way in the drum's well. |
| `clutch.pressed_parts_grip_the_shaft` | motion | 0.004 mm | 0.001 to 0.02 | pass | Least interference between the shaft and the bores pressed on it (reel table, gear, spring seat). The drum must be free on the shaft instead. |
| `takeup.shaft_endplay` | motion | 0.1 mm | 0.05 to 0.2 | pass | Room for the shaft to move along its axis: the space between the reel table and the gear, less the bush and the two thrust washers that stand in it. |
| `torque.fast_wind_needs_tyre_force` | motion | 53.4731 g |  | info | Info: the force with which the FF/REW tyre must be pressed on the flywheel to pass Sony's least fast-wind torque in FF, taking rubber on brass at 0.8. Lever (B)'s spring is modelled and checked by torque.fast_wind_min; this figure is the required tyre force, not a separate spring check. |
| `gear.step_mate_meshes_with_the_42_tooth_ring` | motion | 0.0002 % | 0 to 0.1 | pass | Larger of two mismatches: tooth speed of the gear against the ring that drives it, and its distance from the take-up axis against where their teeth mesh. |
| `gear.third_train_moves_tooth_for_tooth` | motion | 0 % | 0 to 0.1 | pass | Largest mismatch of tooth speed in the two meshes: the pulley's pinion with the second gear's wheel, the second gear's pinion with the third gear. |
| `gear.third_train_stands_in_mesh` | motion | 0 mm | 0 to 0.05 | pass | Largest departure of the two centre distances from where the counted teeth mesh. |
| `shutoff.clear_while_reel_turns` | motion | 0.3334 mm | 0.1 to … | pass | Smallest gap between the toothed piece and the tips of the pinion under the third gear in normal running: held back by the detection lever, at the rib's push, and at rest in STOP. If they touched it would trip with tape left. |
| `shutoff.meshes_when_reel_stalls` | motion | 0.5912 mm | 0.4 to 0.8 | pass | How deep the toothed piece stands among the pinion's teeth once the detection lever has fallen back (it must then be unswung). A tooth of the pinion is 2.25 modules deep. |
| `shutoff.gear_carries_lever` | motion | 3 teeth | 2 to 4 | pass | How far the pinion drives the meshed toothed piece along the lever before it lets go, in teeth of the pinion. |
| `shutoff.release_lever_turns_only_when_tripped` | motion | 6 deg | 3 to … | pass | Turn of release lever C when the toothed piece has been driven along; it must not move at any earlier stage. |
| `shutoff.piece_pushes_release_lever` | motion | 0.048 mm | 0 to 0.15 | pass | Gap between the toothed piece's tail and release lever C's input arm once the piece has been driven and release lever C turned: the tail must be what turns it. |
| `shutoff.release_lever_untouched_before_the_drive` | motion | 2.4861 mm | 0.3 to … | pass | Smallest gap between the toothed piece and release lever C at rest, held back, pushed out by the rib and in mesh. |
| `shutoff.rib_rocks_the_lever` | motion | 0.349 mm | 0.2 to 0.6 | pass | How far the far side of the rib on the third gear pushes the lever's blade out from where the detection lever holds it, once a turn (Sony p.3, motion 2). |
| `shutoff.pushed_out_by_the_rib` | motion | 0.0002 mm | 0 to 0.05 | pass | The lever's pushed-out stage against the rib's reach: the blade's foot should just meet the rib there. |
| `ffrew.ff_lever_drives_lever_a` | motion | 0.02 mm | 0 to 0.05 | pass | Gap between the FF lever's cam and its post on Lever (A) with FF pressed: the cam must be what has slid the bar (0.02 designed). |
| `ffrew.rew_lever_drives_lever_a` | motion | 0.02 mm | 0 to 0.05 | pass | Gap between the REW lever's cam and its post on Lever (A) with REW pressed (0.02 designed). |
| `ffrew.cams_clear_otherwise` | motion | 0.1298 mm | 0.08 to … | pass | Smallest gap between either cam and either post at rest and with the other button pressed: a lever must not move the bar unless its own button is pressed. |
| `ffrew.selector_pin_rides_in_its_slot` | motion | 0.05 mm | 0.02 to 0.08 | pass | Smallest gap between Lever (A)'s pin and the walls of the selector plate's slot, at rest, in FF and in REW: the pin stays in the slot as the bar slides and gear A's arm swings (0.05 a side designed). |
| `ffrew.lever_a_slides_opposite_ways` | motion | 179.9905 deg | 179 to … | pass | FF slides it 0.835 mm, REW 0.307 mm, opposite ways along its length. |
| `cassette.rests_on_locating_pins` | axes | 0.01 mm | 0 to 0.05 | pass | Gap between the cassette's head band and the locating pins' base flanges at rest: the standard supports a cassette on rings round its reference holes (ECMA-34 Fig. 5), and the depth stack puts the flanges at the band. 0.01 is shown. |
| `tape.runs_within_roller_capstan_head_and_guide` | motion | 0.1 mm | 0.05 to … | pass | Least overlap, at either edge of the 3.81 mm tape, of the pinch roller, the capstan, the head face and the tape guide: the tape must lie wholly on each. |
| `gear.s_gear_b_ratio` | motion | 0.6667  | 0.666 to 0.6673 | pass | Speed against S gear A; tooth ratio 40/60. Motion rig: -u*(40/60) |
| `gear.fr_train_moves_tooth_for_tooth` | motion | 0 % | 0 to 0.1 | pass | Largest mismatch of tooth speed among the gears in mesh: the FR pulley with FR gear B and FR gear B with FR gear A in FF and REW, FR gear A with the clutch gear in FF, FR gear A with S gear B in REW. |
| `gear.fr_gear_a_meets_clutch_gear_in_ff` | motion | 12.8999 mm | 12.85 to 12.95 | pass | Distance from FR gear A to the clutch gear in FF, against the distance at which their teeth mesh. |
| `gear.fr_gear_a_meets_s_gear_b_in_rew` | motion | 11.2498 mm | 11.2 to 11.3 | pass | Distance from FR gear A to S gear B in REW, against the distance at which their teeth mesh. |
| `ratio.FR_gear_A` | motion | 0  |  | info | Motion rig: u*(40/15) if m==3 else -t*(60/26) if m==2 else 0. No target yet. |
| `ratio.secondary_gear` | motion | -0.1115  |  | info | Motion rig: -a*(0.278719486567)*(12/30). No target yet. |
| `ratio.third_gear_cam` | motion | 0.0329  |  | info | Motion rig: a*(0.278719486567)*(12/30)*(13/44). No target yet. |
| `ratio.middle_pulley_and_primary_pinion` | motion | 0.2787  |  | info | Motion rig: a*(0.278719486567). No target yet. |
| `ratio.FR_pulley_and_tyre` | motion | 0  |  | info | Motion rig: -t*(60/28) if m==2 else u*(40/15)*(26/28) if m==3 else 0. No target yet. |
| `ratio.motor_rotor_and_pulley` | motion | -4.8667  |  | info | Motion rig: a*(-4.866666667). No target yet. |
| `fr_pulley.touches_flywheel_in_ff` | motion | -0.0801 mm | -0.3 to 0 | pass | Gap from the flywheel rim to a tyre of the target size; friction drive needs slight compression. |
| `fr_pulley.touches_flywheel_in_rew` | motion | -0.0801 mm | -0.3 to 0 | pass | Gap from the flywheel rim to a tyre of the target size; friction drive needs slight compression. |
| `fr_pulley.moves_between_modes` | motion | 2.1104 mm | 0.2 to … | pass | Largest shift from STOP in FF/REW; this axis is carried on a lever and has to move. |
| `fr_gear_a.moves_between_modes` | motion | 2.6861 mm | 0.2 to … | pass | Largest shift from STOP in FF/REW; this axis is carried on a lever and has to move. |
| `fwd_pulley.moves_between_modes` | motion | 0.6 mm | 0.2 to … | pass | Largest shift from STOP in PLAY; this axis is carried on a lever and has to move. |
| `pinch_roller.moves_between_modes` | motion | 2.2 mm | 0.2 to … | pass | Largest shift from STOP in PLAY; this axis is carried on a lever and has to move. |
| `fr_gear_a.swings_between_ff_and_rew` | motion | 3.688 mm | 0.5 to … | pass | FF sends drive to the take-up side, REW to the supply side, by swinging this gear. |
| `pinch_roller.meets_capstan_in_play` | motion | -0.1 mm | -0.5 to 0 | pass | Roller-to-capstan gap in PLAY at the target roller and capstan sizes. |

Totals by group: solids 0 pass, 1 fail; envelope 19 pass, 8 fail; axes 34 pass, 1 fail; motion 81 pass, 0 fail, 7 for information; parts 12 pass, 0 fail; size 4 pass, 0 fail.
