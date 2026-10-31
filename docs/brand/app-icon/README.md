# Penni app icon

The current editable master is `../vector/penni-stacked.svg`.
The smaller mark, darker silver coin, aligned layers, and round stem are shared
by the website SVG and the macOS PNG/ICNS assets.

Rebuild from the repository root:

```sh
node docs/brand/vector/build-assets.mjs
```

The earlier raster reference and the Blender sources live outside the repository.
The old Swift entry point delegates to the vector builder.
