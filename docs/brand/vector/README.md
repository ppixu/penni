# Penni vector master

The SVG follows the Blender model approved on 2026-09-06, with a purple P and larger orange ring, including its current object positions and 15-degree orthographic viewport angle.

- `capture-blender.py`: captures the saved ring variant; the light center disk becomes a transparent cutout in the orange layer.
- `blender-reference.json`: captured curve contours, bevels, extrusion, transforms, materials, and viewport matrix from the open Blender scene.
- `render-vector.py`: projects those contours and rounded bevel sections into SVG paths. Subpixel path simplification keeps the curves smooth. Gradients and soft shadows reproduce the studio appearance; no bitmap is embedded.
- `penni-stacked.svg`: generated transparent logo for the website.
- `penni-icon.svg`: generated logo centered on a white rounded-square tile.
- `penni-stacked.png`: high-resolution fallback.

The Blender scene (`penni-ring.blend`) is a design source kept outside the repository, so step 1 below needs your own copy of it. Without it, you can still regenerate all website/app assets from the committed `blender-reference.json` (steps 2 and 3).

Regenerate the master and all website/app assets:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background <path>/penni-ring.blend --python docs/brand/vector/capture-blender.py
python3 docs/brand/vector/render-vector.py
node docs/brand/vector/build-assets.mjs
```

The renderer preserves the reference geometry rather than substituting a generic P or independent coin ellipses. Material-preview colors are specified in the renderer's palette. The opening is circular in model space and naturally foreshortened by the approved viewing angle.

The asset builder uses existing web app image dependencies. `iconutil` exports the macOS ICNS on macOS.
