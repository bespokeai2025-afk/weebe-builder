# Hero 3D model

Drop the commissioned asset here as:

    public/models/hive-core.glb

Nothing else needs changing. `src/components/story/scenes/HeroModel.tsx` probes
for that exact path with a HEAD request on mount:

  - file present -> it loads, is auto-centred on its own bounding box, scaled to
    fill the hero frame, and rotated slowly under the shared lighting rig
  - file absent  -> the hero silently falls back to the procedural scene, so a
    missing asset never breaks the page

## If the delivered file is Draco-compressed

The decoder is NOT committed, because it is ~3 MB and most models do not need
it. If the glTF viewer reports a Draco extension, add it with one command:

    cp -r node_modules/three/examples/jsm/libs/draco public/draco

HeroModel.tsx already points at `/draco/`, so that is the only step. Re-run it
after upgrading the `three` package.

## Checking a delivered file before accepting it

Open it in https://gltf-viewer.donmccurdy.com and confirm:

  - loads with no errors or missing textures
  - under 4 MB total
  - under 80,000 triangles
  - Y-up, centred on origin, roughly 2 units across
  - still reads as one clear shape when spun all the way round

The commission brief has the full spec. The silhouette check is the one that
matters most and the one most often skipped.
