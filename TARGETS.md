# Targets

Version 0.2.2. Written by the build from `edit/targets.json`; edit that file, not this one.

**These are the numbers the model is meant to match, and how the model compares today.** Most come from photographs, videos, Sony's service manual and published standards. A target is not a measurement of a real unit unless its class is `measured`. Where the model fails a target, the model is wrong or the target is in doubt; both are shown rather than hidden.

Of 91 targets, the model passes 16, fails 22 and has no check yet for 53.

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
| `cassette.thickness_body` | 8.6 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 |  |  | no check |
| `cassette.thickness_head_end` | 12 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 | MEDIA-001 MEDIA-002 | 8.4 | **fail** |
| `cassette.reel_pitch` | 42.5 | ± 0.3 | mm | standard | ECMA-34 Fig. 4 |  | 42.5 | pass |
| `cassette.capstan_pitch` | 48 | ± 0.2 | mm | standard | ECMA-34 Fig. 4 |  |  | no check |
| `cassette.capstan_row_to_reel_row` | 31.3 | ± 0.25 | mm | standard | ECMA-34 Fig. 4: reel row 27.9 behind the reference line, capstan row 3.4 ahead of it |  | 31.3 | pass |
| `cassette.capstan_outboard_of_reel` | 2.75 | ± 0.25 | mm | standard | ECMA-34 Fig. 4: (48 - 42.5) / 2 |  | 2.75 | pass |
| `cassette.reference_hole_pitch` | 28 | ± 0.15 | mm | standard | ECMA-34 Fig. 4 |  |  | no check |
| `cassette.reference_hole_row_to_reel_row` | 29.7 | ± 0.2 | mm | standard | ECMA-34 Fig. 4: holes 3.6 wide with one edge on the reference line, 27.9 from the hub row |  |  | no check |
| `cell.aa_diameter_max` | 14.5 | not stated | mm | standard | IEC 60086, R6 cell |  |  | no check |
| `cell.aa_length_max` | 50.5 | not stated | mm | standard | IEC 60086, R6 cell |  |  | no check |
| `tape.speed` | 47.6 | ± 2 % | mm/s | documented | Sony service manual p.7: a 3 kHz test tape must read 2,940 to 3,060 Hz |  | 8.832 | **fail** |
| `wind.c60_time` | 150 | ± 15 | s | documented | Sony service manual p.1: approx. 2 min 30 s |  |  | no check |
| `torque.takeup_play` | 22.5 to 45 |  | g.cm | documented | Sony service manual p.6 |  |  | no check |
| `torque.fast_wind_min` | 55 | not stated | g.cm | documented | Sony service manual p.6 |  |  | no check |
| `torque.back_tension` | 2 to 3.5 |  | g.cm | documented | Sony service manual p.6 |  |  | no check |
| `pinch.pressure` | 200 to 300 |  | g | documented | Sony service manual p.6 |  |  | no check |
| `motor.never_reverses` | true | not stated |  | documented | Sony service manual p.3: the motor arrow is the same in FWD, FF and REW |  | false | **fail** |
| `body.height` | 133.5 | ± 0.5 | mm | documented | Sony service manual p.2: approx. 133.5; the third-party dimensioned sketch of a real unit (Imgur album tps-l2-dimensions-wD2kVLQ) agrees | EXT-010 EXT-020 EXT-030 GRL-001 | 133.3 | pass |
| `body.front_width` | 85 | ± 0.6 | mm | reported | third-party dimensioned sketch of a real unit (Imgur album tps-l2-dimensions-wD2kVLQ); photographs of two units read 84.1 to 84.9 | EXT-010 EXT-020 EXT-030 GRL-001 | 87.878 | **fail** |
| `body.depth` | 29.75 | ± 0.75 | mm | reported | third-party dimensioned sketch of a real unit (Imgur album tps-l2-dimensions-wD2kVLQ). Sony gives approx. 29; photographs suggest 27.6 to 28.7, so this target is in doubt |  | 29.774 | pass |
| `body.depth_over_width` | 0.324 | ± 0.005 | ratio | photo-measured | published turntable video of a unit of this variant |  |  | no check |
| `control.listen_key_proud_of_side` | 1.4 | ± 0.3 | mm | photo-measured | published turntable video, front square-on, key unpressed |  |  | no check |
| `front.silver_strip` | 15.7 | ± 0.7 | mm | photo-measured | front-on photographs of several units, scaled to the body (five units) |  | 15.126 | pass |
| `front.top_band` | 20.4 | ± 0.7 | mm | photo-measured | front-on photographs of several units, scaled to the body (six units) | EXT-020 | 20.494 | pass |
| `window.opening_width` | 27.3 | ± 0.6 | mm | photo-measured | front-on photographs of several units, scaled to the body: outer edge of the bevelled opening | EXT-031 EXT-032 | 24.51 | **fail** |
| `window.opening_height` | 68.2 | ± 0.4 | mm | photo-measured | front-on photographs of several units, scaled to the body (five units) | EXT-031 EXT-032 | 66.26 | **fail** |
| `window.right_edge_to_strip` | 26.75 | ± 0.7 | mm | photo-measured | front-on photographs of several units, scaled to the body |  | 26.904 | pass |
| `window.bottom_to_body_bottom` | 23.75 | ± 0.5 | mm | photo-measured | front-on photographs of several units, scaled to the body |  | 23.62 | pass |
| `window.left_margin` | 14.9 | ± 0.8 | mm | photo-measured | front-on photographs of several units, scaled to the body: to the outer edge of the opening |  | 21.37 | **fail** |
| `capstan.diameter` | 2 | ± 0.05 | mm | documented | Sony service manual exploded view 6-2: 'Washer, plastic 2mm dia.' sits on the flywheel shaft | BAY-052 | 1.6 | **fail** |
| `flywheel.rate_play` | 7.58 | ± 2 % | rev/s | designed | tape.speed / (pi x capstan.diameter) | MEC-011 | 1.7571 | **fail** |
| `shaft.fr_gears` | 1.2 | not stated | mm | documented | Sony service manual exploded view 6-4: FF/REW gears A and B and the secondary gear take 'Washer, plastic 1.2mm dia.' | DRV-012 DRV-013 DRV-016 |  | no check |
| `shaft.pulleys_third_gear` | 1.6 | not stated | mm | documented | Sony service manual exploded view 6-4: FF/REW pulley, middle pulley and third gear take 'Washer, plastic 1.6mm dia.' | DRV-020 DRV-023 CAM-010 |  | no check |
| `shaft.levers` | 2 | not stated | mm | documented | Sony service manual exploded views 6-2 and 6-3: stop lever, release lever and head board posts take the 2 mm washer |  |  | no check |
| `gear.module` | 0.3 | not stated | mm | photo-measured | published teardown photographs: S gears A and B are 15.10 mm apart and have 40 and 60 teeth |  |  | no check |
| `gear.s_gear_b.teeth` | 60 | ± 0 |  | photo-measured | published teardown photographs: counted round the whole gear | DRV-011 |  | no check |
| `gear.s_gear_a.teeth` | 40 | ± 0 |  | photo-measured | published teardown photographs: counted round the whole gear | DRV-010 |  | no check |
| `gear.fr_gear_b.teeth` | 36 | ± 0 |  | photo-measured | published teardown photographs: counted round the whole gear | DRV-013 |  | no check |
| `gear.takeup.teeth` | 60 | ± 0 |  | photo-measured | published teardown photographs: counted on the felt-faced gear | DRV-014 |  | no check |
| `gear.fr_gear_a.teeth` | 26 | ± 0 |  | photo-measured | published teardown photographs: counted on the large tier | DRV-012 |  | no check |
| `gear.fr_pulley_pinion.teeth` | 30 | ± 2 |  | photo-measured | published teardown photographs: about 15 teeth across the visible half | DRV-023 |  | no check |
| `belt.main.inner_diameter` | 44 | not stated | mm | reported | replacement-belt suppliers' listed sizes | BLT-001 |  | no check |
| `belt.main.section` | 0.8 | not stated | mm | reported | replacement-belt suppliers' listed sizes | BLT-001 |  | no check |
| `belt.main.free_length` | 140.7 | not stated | mm | reported | pi x (44.0 + 0.8), from the supplier sizes | BLT-001 | 16.4918 | **fail** |
| `belt.second.free_length` | 115.9 | not stated | mm | reported | pi x (36.0 + 0.9), from the supplier sizes | BLT-002 | 5.9862 | pass |
| `belt.stretch_range` | 4 to 8 |  | % | designed | usual installed stretch for small square-section drive belts |  |  | no check |
| `ratio.reverse_wheel_to_flywheel` | 2.68 | ± 0.08 |  | photo-measured | published repair video, measured frame by frame: reverse wheel 20.82 rev/s against flywheel 7.774 rev/s on a running unit | DRV-022 MEC-011 | 2.5862 | **fail** |
| `tyre.fr_pulley.od` | 12 | ± 0.3 | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | DRV-023 | 10.2 | **fail** |
| `tyre.fr_pulley.id` | 7 | not stated | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | DRV-023 |  | no check |
| `tyre.fr_pulley.width` | 2.25 | not stated | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | DRV-023 |  | no check |
| `tyre.fwd_pulley.od` | 8 | ± 0.3 | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | FWD-021 | 8 | pass |
| `pinch_roller.od` | 9 | ± 0.3 | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | BAY-061 | 7.5 | **fail** |
| `pinch_roller.width` | 6.5 | not stated | mm | reported | third-party measurements of the rubber parts of a real unit (reddit.com/r/walkman/comments/15uetfj) | BAY-061 |  | no check |
| `flywheel.rim_diameter` | 24 | ± 1.2 | mm | photo-measured | published repair video, measured frame by frame: main disc of a WM-3 flywheel, which Sony lists as the same part family | MEC-011 | 24.4 | pass |
| `axis.reverse_wheel` | (-5.3, 12.7) | ± 1 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (mean of four readings) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; DRV-022 | 1.6771 off | **fail** |
| `axis.fr_pulley_engaged` | (6.65, 14.55) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (mean of FF and REW) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in FF, REW; DRV-023 | 1.6508 off, 1.6508 off | **fail** |
| `axis.fr_pulley_released` | (6.73, 12.83) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (FWD) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in PLAY; DRV-023 | 2.9567 off | **fail** |
| `contact.fr_pulley_to_capstan_axis_engaged` | 19.2 | ± 0.5 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch: 19.30 in FF, 19.11 in REW | DRV-023 MEC-011 | 17.3 | **fail** |
| `contact.fr_pulley_travel` | 1.5 | ± 0.6 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch: 20.76 mm from the capstan axis in PLAY against 19.2 engaged | DRV-023 |  | no check |
| `axis.fr_gear_b` | (15.03, 10.64) | ± 0.8 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (mean of three) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; DRV-013 | 0.6475 off | pass |
| `axis.fr_gear_a_ff` | (13.15, 2.03) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in FF; DRV-012 | 3.7567 off | **fail** |
| `axis.fr_gear_a_rew` | (16.75, 2.19) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in REW; DRV-012 | 0.1801 off | pass |
| `axis.fr_gear_a_play` | (15.81, 1.57) | ± 0.7 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch; Sony marks a clearance here in FWD | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in PLAY; DRV-012 | 1.2174 off | **fail** |
| `arm.fr_gear_a_about_fr_gear_b` | 9.3 | ± 0.1 | mm | designed | 0.3 module x (36 + 26) / 2, from the counted teeth | DRV-012 DRV-013 | 9 | **fail** |
| `axis.fwd_pulley_engaged` | (9.23, -9.55) | ± 0.8 | mm | photo-measured | Sony's photographs of the mechanism in each mode, scaled to the 42.5 mm reel pitch (FWD) | u toward the supply reel, v toward the capstan row, origin on the take-up axis; in PLAY; FWD-021 | 2.247 off | **fail** |
| `gear.fr_gear_a_small_tier.teeth` | 15 | ± 2 |  | photo-measured | published teardown photographs: radius about 0.6 of the 26-tooth tier | DRV-012 |  | no check |
| `gear.third.teeth` | 44 | ± 3 |  | photo-measured | published teardown photographs: counted by program and by eye | CAM-010 |  | no check |
| `flywheel.upper_flange_diameter` | 21.6 | ± 1 | mm | photo-measured | published repair video, measured frame by frame: 0.92 of the main disc | MEC-011 |  | no check |
| `flywheel.hub_flange_diameter` | 7.2 | ± 0.4 | mm | photo-measured | published repair video, measured frame by frame: 0.33 of the upper flange | MEC-011 |  | no check |
| `reel_table.cap_top_above_flange` | 8.86 | ± 0.15 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  |  | no check |
| `pin.locating_tip_above_reel_cap` | 2.04 | ± 0.4 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  |  | no check |
| `capstan.tip_above_reel_cap` | 1.15 | ± 0.4 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  |  | no check |
| `pin.locating_base_flange_below_reel_cap` | 9.25 | ± 0.5 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay; taken as the cassette's seat |  |  | no check |
| `flywheel.main_disc_thickness` | 4.48 | ± 0.2 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  |  | no check |
| `flywheel.groove_width` | 1.83 | ± 0.2 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay: gap between the main disc and the thin flange |  |  | no check |
| `flywheel.upper_flange_thickness` | 0.96 | ± 0.15 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  |  | no check |
| `flywheel.front_face_behind_pin_flange` | 3.34 | ± 0.5 | mm | photo-measured | depth stack worked out from photographs of the open cassette bay |  |  | no check |
| `body.depth_minimum_from_stack` | 27.9 | not stated | mm | designed | cassette 10.3 + AA cell 14.5, plus the thinnest conceivable lid, separator and door |  |  | no check |
| `reverse_wheel.outer_diameter` | 10.1 | ± 0.4 | mm | photo-measured | published repair video, measured frame by frame | DRV-022 | 9.4 | **fail** |
| `bay.cassette_rear_edge_to_frame_edge` | 3.4 | ± 2.5 | mm | photo-measured | published repair video, measured frame by frame, read across about 10 mm of height without correction | BAY-010 MEDIA-001 |  | no check |
| `bay.cassette_to_chassis_end_battery` | 6.1 | ± 1 | mm | photo-measured | published repair video, measured frame by frame; the second set of published teardown photographs agrees | MEDIA-001 |  | no check |
| `bay.hook_far_edge_behind_cassette_rear_edge` | 0.7 | ± 0.8 | mm | photo-measured | second set of published teardown photographs |  |  | no check |
| `bay.hook_height_above_cassette_top_face` | 3.1 | ± 0.8 | mm | photo-measured | second set of published teardown photographs: 2.7 at the far edge, 3.6 at the near edge |  |  | no check |
| `bay.top_rail_outer_edge_beyond_cassette_end` | 6.2 | ± 0.6 | mm | photo-measured | second set of published teardown photographs |  |  | no check |
| `bay.top_rail_top_above_cassette_top_face` | 1.5 | ± 0.6 | mm | photo-measured | second set of published teardown photographs |  |  | no check |
| `cover.control_side_face_width` | 27.6 | ± 0.6 | mm | photo-measured | second set of published teardown photographs, taking the cover as 133.5 long |  |  | no check |
| `lid.window_centre_fraction_of_lid_width` | 0.426 | ± 0.01 | ratio | photo-measured | second set of published teardown photographs: from the plain-side edge |  |  | no check |
| `lid.height_over_width` | 1.62 | ± 0.05 | ratio | photo-measured | second set of published teardown photographs |  |  | no check |
| `belt.length_ratio_main_to_second` | 1.2 | ± 0.05 | ratio | photo-measured | second set of published teardown photographs; supplier sizes give 1.21 |  |  | no check |

## Other checks

Checks that have no target of their own: they test that the model is consistent with itself or with several targets at once.

| Check | Group | Model | Allowed | Outcome | Note |
|---|---|---|---|---|---|
| `solids.single_closed_shell` | solids | 118 parts | 0 to 0 | **fail** | 498 parts: 380 are one closed solid, 118 are not. Vertices closer than 0.001 mm are joined; lettering is left out. |
| `cassette.left_wall_room_at_registered_width` | envelope | 1.322 mm | 2 to … | **fail** | Room left of the cassette if the width surplus is removed from the left side. Needs a wall plus clearance; 2 mm is a working minimum. |
| `flywheel_on_capstan_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `capstan_shaft_on_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `s_gear_a_on_supply_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `takeup_gear_on_takeup_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `supply_hub_on_supply_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `takeup_hub_on_takeup_axis` | axes | 0 mm | -0.05 to 0.05 | pass | Centre of the part against the axis it turns on; both faces of the chassis must share it. |
| `cassette_hub_pivots_match_reel_pivots` | axes | 0 mm | -0.05 to 0.05 | pass |  |
| `cassette_hub_pivots_match_reel_pivots_takeup` | axes | 0 mm | -0.05 to 0.05 | pass |  |
| `reel.takeup_rate_matches_tape` | motion | 1.1781 rad/s | 1.8667 to 4.3273 | **fail** | A reel must turn at tape speed over its pack radius, between an empty hub (about 11 mm) and a full C-90 pack (about 25.5 mm). |
| `reel.supply_rate_matches_tape` | motion | 1.1781 rad/s | 1.8667 to 4.3273 | **fail** | A reel must turn at tape speed over its pack radius, between an empty hub (about 11 mm) and a full C-90 pack (about 25.5 mm). |
| `reel.rates_are_independent` | motion | false  | must be true | **fail** | Supply and take-up share one fixed rate in every mode: no slip clutch and no tape conservation between the packs. |
| `gear.s_gear_b_ratio` | motion | 0.6781  | 0.666 to 0.6673 | **fail** | Speed against S gear A; tooth ratio 40/60. Motion rig: -u*(6.3/9.29) |
| `gear.fr_gear_b_ratio` | motion | 1.1072  | 1.11 to 1.1122 | **fail** | Speed against S gear A; tooth ratio 40/36. Motion rig: -u*(6.3/5.69) |
| `ratio.FR_gear_A` | motion | 1.6237  |  | info | Motion rig: u*(6.3/3.88). No target yet. |
| `ratio.secondary_gear` | motion | -0.1123  |  | info | Motion rig: -a*(0.278719486567)*(2.05/5.09). No target yet. |
| `ratio.third_gear_cam` | motion | 0.0908  |  | info | Motion rig: a*(0.278719486567)*(2.05/6.29). No target yet. |
| `ratio.middle_pulley_and_primary_pinion` | motion | 0.2787  |  | info | Motion rig: a*(0.278719486567). No target yet. |
| `ratio.FR_pulley_and_tyre` | motion | 2.3922  |  | info | Motion rig: a*(12.2/5.1). No target yet. |
| `ratio.motor_rotor_and_pulley` | motion | -6.25  |  | info | Motion rig: a*(-6.25000117755). No target yet. |
| `fr_pulley.touches_flywheel_in_ff` | motion | 0.9103 mm | -0.3 to 0 | **fail** | Gap from the flywheel rim to a tyre of the target size; friction drive needs slight compression. |
| `fr_pulley.touches_flywheel_in_rew` | motion | 0.9103 mm | -0.3 to 0 | **fail** | Gap from the flywheel rim to a tyre of the target size; friction drive needs slight compression. |
| `fr_pulley.moves_between_modes` | motion | 0 mm | 0.2 to … | **fail** | Largest shift from STOP in FF/REW; this axis is carried on a lever and has to move. |
| `fr_gear_a.moves_between_modes` | motion | 0 mm | 0.2 to … | **fail** | Largest shift from STOP in FF/REW; this axis is carried on a lever and has to move. |
| `fwd_pulley.moves_between_modes` | motion | 0 mm | 0.2 to … | **fail** | Largest shift from STOP in PLAY; this axis is carried on a lever and has to move. |
| `pinch_roller.moves_between_modes` | motion | 3.0575 mm | 0.2 to … | pass | Largest shift from STOP in PLAY; this axis is carried on a lever and has to move. |
| `fr_gear_a.swings_between_ff_and_rew` | motion | 0 mm | 0.5 to … | **fail** | FF sends drive to the take-up side, REW to the supply side, by swinging this gear. |
| `pinch_roller.meets_capstan_in_play` | motion | -0.9567 mm | -0.5 to 0 | **fail** | Roller-to-capstan gap in PLAY at the target roller and capstan sizes. |

Totals by group: solids 0 pass, 1 fail; envelope 8 pass, 6 fail; axes 13 pass, 8 fail; motion 4 pass, 22 fail, 6 for information.
