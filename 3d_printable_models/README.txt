Jelly Baby – 3D printable extraction
=====================================

Source
------
The body is extracted directly from src/assets/model/jelly-baby.bin in the supplied game.
The neutral face geometry and placements are reconstructed from src/graphics/baby-face.ts
and projected onto the same front skin surface using the game's FaceSkin mapping logic.

Scale / units
-------------
All exported geometry is in millimetres.
Authored body height: 70.0 mm
Overall body bounds: 97.85 x 70.00 x 58.96 mm (X/Y/Z)

Files
-----
jelly_baby_multicolor.3mf
  Preferred printer/slicer file. Separate color/material parts in one aligned scene.

jelly_baby_multicolor.obj + jelly_baby_multicolor.mtl
  Common color-capable interchange format.

jelly_baby_vertex_color.ply
  Single aligned mesh collection with vertex colors.

jelly_baby_full_geometry.stl
  Universal geometry-only version. STL does not store color.

parts/*.stl
  Same-origin material groups for slicers/workflows that prefer separate meshes:
  body, eyes, dark face (brows + mouth), blush, tongue.

jelly_baby_preview.glb
  Appearance-preserving preview/interchange copy; included for inspection, not as the primary slicer format.

Print conversion
----------------
The in-game eyes, blush, mouth and tongue are render-only surface details; several are open
or effectively zero-thickness and therefore are not printable as authored. I converted them
to shallow watertight solids and embedded the hidden backs about 0.35–0.45 mm into the body.
The visible outer surfaces and placement are kept at the game offsets, so this changes the
hidden print topology rather than the intended exterior look.

Material parity
---------------
The game's jelly look comes from transmission/absorption, not just a flat RGB color.
Standard slicer formats cannot reproduce that shader optically. For the closest physical result:
- print the body in translucent lime/green resin or filament;
- print eyes/brows/mouth in very dark green;
- print the tongue in light yellow-green;
- print blush in a muted yellow/olive.

materials.json contains the exact game shader/material values plus the display colors used
for the printable color formats.

Validation
----------
Body source mesh: watertight, winding-consistent manifold.
Printable face parts were checked as watertight solids.
The model is kept at the game's original 70 mm body height and can be uniformly scaled in a slicer.
