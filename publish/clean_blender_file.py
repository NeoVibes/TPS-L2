"""Removes this computer's folder paths from the Blender file before it is shared.

Blender keeps its screen layout inside the file, and the layout's file browser remembers folders
on the computer that saved it. This re-saves the model with a fresh layout whose only remembered
folder is a neutral one. Shapes, rig, collections and properties are not touched.

Run from the kit folder, with HOME pointing at a neutral folder (the first line does that):

    HOME=/tmp/portable-tape-player  blender --background --factory-startup --disable-autoexec --python publish/clean_blender_file.py

Then run "npm test" in rebuild/: it reports any path that is still in the file.
"""
import bpy, os, sys
from pathlib import Path

kit = Path(__file__).resolve().parent.parent
model = kit / 'edit' / 'Portable Tape Player.blend'
if any(marker in os.path.expanduser('~') for marker in ('/Users/', '/home/', '\\Users\\')):
    sys.exit('Set HOME to a neutral folder first, for example HOME=/tmp/portable-tape-player (see the top of this file).')
os.makedirs(os.path.expanduser('~'), exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(model), load_ui=False, use_scripts=False)   # the model's data, this session's fresh layout
bpy.context.preferences.filepaths.save_version = 0                                # no .blend1 backup beside it
bpy.ops.wm.save_as_mainfile(filepath=str(model), compress=True, check_existing=False)
print('Saved', model.name, 'with a fresh screen layout.')
