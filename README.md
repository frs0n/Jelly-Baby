# Jelly Baby

A WebGPU-only, Three.js r185 playground. The supplied EXR lights the scene; the
wood maps repeat every 2.5 metres. The baby is modelled at approximately 7 cm.

![Jelly Baby](assets/screenshot.jpeg)

```sh
npm run dev
```

WASD / arrow keys move relative to the camera. Space hops. Drag the table to
orbit, scroll or pinch to zoom, and drag the baby to stretch and throw. The camera
holds still during a grab and follows smoothly after release. Touch controls
appear on mobile as a joystick and hop control. R resets. Sound starts with the
first interaction.

Physics is a foundation for plausible appearance and behavior, balanced against
real-time CPU/GPU responsiveness. Preserve the established look and feel; use
bounded work and perceptually close approximations where full simulation causes lag.

## Implementation

- `src/physics/soft-body.js` uses the reference's neo-Hookean energy with coupled
  XPBD constraints, an orientation barrier, axial viscosity, Coulomb contact and
  force-limited barycentric grabbing. Coupling the elastic constraints eliminates
  artificial rest stress; whole-step backtracking prevents inverted elements.
  The 240 Hz fixed step matches `refs/jelly-webgpu.html`. Gravity is deliberately
  reduced to 2.4 m/s², with a smaller jump impulse for a gentle, floating hop.
  The exact same solver is executed by a small embedded WebAssembly kernel so the
  4,026 tetrahedra and full-resolution surface no longer monopolize the JS main
  thread. A JavaScript fallback retains the same equations if WebAssembly is
  unavailable. Catch-up work normally yields after 8 ms or six substeps; during
  an active grab the wall-clock cutoff is disabled while the six-step cap remains,
  so pointer response cannot lose ordinary 240 Hz samples under a transient frame spike.
- The displayed body is still the exact marching-tetrahedra mesh from
  `refs/jelly_baby_mesh.html`, uniformly scaled to 7 cm: 72,234 indexed vertices,
  144,464 triangles and no open edges. `npm run build:model` regenerates its binary
  asset and source hash. A regular tetrahedral cage deforms those vertices through
  barycentric embedding; contacts lie on the actual visible surface. The original
  smooth SDF normals follow the deformation. Position and normal BufferAttributes
  remain the fully deformed CPU surface used by rendering, picking and facial
  attachment; there is no lower-poly or shader-only visual substitute. The face
  follows the skin. Details are
  tessellated, kept outside the skin, and drawn after transmission so they cannot
  contaminate the opaque refraction buffer and produce duplicate images.
- `src/game/locomotion.ts` supplies a powered posture and gait through nodal
  forces and jump impulses. It does not replace particle positions with animation.
  The muscles release completely during a grab and recover gradually afterward.
  Gait forces stop when movement stops; damping dissipates recoil and the settled
  body sleeps until the next interaction.
- Fresnel transmission, internal reflection, spectral absorption and optical
  thickness run in a worker on a 20,176-triangle optical proxy sampled from the
  same implicit model. The full visible mesh stays intact. RGB shares one refracted
  path; thickness is interpolated back to the visible vertices through a precomputed
  surface mapping. Compact cage snapshots replace full-mesh transfers.
  There is one outstanding snapshot at a time, with at most 30 requests per second.
  Caustics publish before thickness finishes, camera-only updates reuse the light
  field, and idle frames do no optical work. Translation compensation keeps the light field
  attached while the worker traces the changing shape. A 256² RGBA16F receiver
  preserves bright caustic flux; vertical motion reprojects the directional shadow.
  Connected refracted beams replace point splats. Their incident flux is divided
  by the landed footprint and integrated over each receiver pixel, including
  subpixel footprints and overlapping folds, without a caustic blur kernel.
  Pixel clipping reuses scratch storage and skips empty or fully covered regions.
- The supplied HDR window is reoriented above the set, boosted, and balanced
  against reduced room fill. Window direction, color, and flux are then measured
  from that same edited HDR, combining adjacent panes into one emitter.
  The floor removes that source's occluded diffuse contribution and reconstructs
  transmitted flux. Environment illumination supplies the rest, without a second
  light duplicating the window. The environment is not drawn as a background.
- Linear HDR compositing adds restrained highlight bloom and a subtle grade,
  followed by a single AgX tone/output transform.
- Grab stencils reconstruct the selected surface point exactly. Pointer smoothing
  is short and force remains limited by XPBD. Dragging against the floor intersects
  the pointer ray with the table, preserving screen alignment.
  Hover uses a bounding-box cursor hint; a real grab still picks the exact mesh.
- Procedural contact audio combines damped membrane modes and a short filtered
  contact transient. No audio files or remote resources are required.

Optical approximations include screen-space view transmission, the optical proxy,
shared RGB ray paths, a finite ray grid, one measured window direction, a planar receiver, and omitted beams at visibility
discontinuities. The simulation has no self-collision or tearing. The character
uses powered posture forces to stand and walk.

## Verification

```sh
npm run lint
npm run typecheck
npm run test:physics
npm run test:performance
npm run build
```

The numerical checks cover settling upright, volume retention, walking, turning,
jumping, stretching, throwing, recovery, HDR source measurement, and refracted
light reaching the floor. Regressions also check roundness, airborne duration,
facial render ordering, grab projection before/after deformation, floor targeting,
and caustic color/flux, subpixel beam conservation, element orientation, zero-force
rest energy, complete idle sleep, and the generated model's source hash. Performance
regressions check bounded catch-up, active-grab step retention, byte-for-byte
visible position/normal equivalence with the original embedding, proxy
flux/thickness agreement, and the actual worker's transferable two-stage response
and camera-only reuse.

`npm run benchmark` reports CPU timings for walking and a severe stretch. The
optimization is intended to reduce main-thread solver/surface time without changing
mesh resolution, material parameters, grab constants, XPBD iteration order, or the
resulting visible positions/normals.

Per project instructions, no development server or browser inspection was run
during implementation. GPU shader execution, visual quality, touch feel, and sound
still need inspection in the target browser. WebGL fallback is disabled, and GPU
startup/runtime failures are surfaced with diagnostics.
