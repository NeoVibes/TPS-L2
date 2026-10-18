// Every executable test is classified here. New tests must declare their prerequisites;
// the runner never guesses them by searching source text.
const fast = [
  'auto_stop', 'blend_privacy', 'blender_discovery', 'blender_supervisor', 'build_failure', 'build_integrity', 'build_lock', 'confirmation', 'control_pointers', 'directory_transaction',
  'eject_behavior', 'evidence', 'exterior_versions', 'fit_camera', 'master_list', 'offline', 'operating',
  'operating_seek', 'parts_list_view', 'release_zip', 'render_observation', 'render_quality', 'rig_links', 'stale_detection', 'stop_eject', 'test_runner', 'theme', 'viewer_inputs', 'viewer_modules',
];
const geometry = [
  'battery_attachments', 'control_geometry', 'door_motion', 'drive_motion', 'eject_motion', 'exploded_layout',
  'math', 'native_deformation', 'operability', 'operation_indicator', 'owner_geometry', 'stop_eject_geometry', 'workbench',
];
export const TEST_SUITES = [
  ...fast.map(name => ({file: `tests/test_${name}.mjs`, suite: 'fast'})),
  ...geometry.map(name => ({file: `tests/test_${name}.mjs`, suite: 'geometry', workingFiles: true})),
  {file: 'tests/test_model_controls.mjs', suite: 'geometry', workingFiles: true,
    parts: ['CTL-01', 'CTL-02', 'CTL-03', 'CTL-04', 'CTL-05', 'CTL-06', 'CTL-07', 'CTL-08']},
  {file: 'tests/reference/test_battery_housing.mjs', suite: 'reference', workingFiles: true},
  {file: 'tests/reference/test_target_measurements.mjs', suite: 'reference'},
].sort((a, b) => a.file.localeCompare(b.file));
