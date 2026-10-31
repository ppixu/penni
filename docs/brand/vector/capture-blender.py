"""Capture saved logo geometry without modifying the Blender source.

Run: Blender --background <path>/penni-ring.blend \
  --python docs/brand/vector/capture-blender.py
"""
import bpy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Retain the established front-facing orthographic projection used by the app.
reference = json.loads((ROOT / 'blender-reference.json').read_text())
parts = []
for obj in bpy.context.scene.objects:
    if obj.type != 'CURVE' or obj.hide_render or not obj.name.startswith('Penni'):
        continue
    contours = []
    for spline in obj.data.splines:
        if spline.type != 'POLY' or not spline.use_cyclic_u:
            raise ValueError(f'Unsupported logo contour: {obj.name} / {spline.type}')
        contours.append([[p.co.x, p.co.y] for p in spline.points])
    material = obj.data.materials[0]
    parts.append({
        'name': obj.name,
        'material': material.name,
        'matrix': [list(row) for row in obj.matrix_world],
        'extrude': obj.data.extrude,
        'bevel': obj.data.bevel_depth,
        'color': list(material.diffuse_color),
        'contours': contours,
    })
if len(parts) not in (2, 3):
    raise ValueError(f'Expected logo pieces and optional center cutout, found {len(parts)}')
reference['source'] = Path(bpy.data.filepath).name  # the .blend lives outside the repo
reference['parts'] = parts
(ROOT / 'blender-reference.json').write_text(json.dumps(reference, ensure_ascii=False, indent=2) + '\n')
print(f'Captured {len(parts)} logo pieces from {bpy.data.filepath}')
