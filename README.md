# Jelly Baby

A WebGPU-only, Three.js r185 playground. The supplied EXR lights the scene; the
wood maps repeat every 2.5 metres. The baby is modelled at approximately 7 cm.

```sh
npm run dev
```

WASD / arrow keys move relative to the camera. Space hops. Drag the table to
orbit, scroll or pinch to zoom, and drag the baby to stretch and throw. The camera
holds still during a grab and follows smoothly after release. Touch controls
appear on mobile. R resets. Sound starts with the first interaction.

## Implementation

- `src/physics/soft-body.js` preserves the reference's tetrahedral neo-Hookean
  XPBD solver, determinant barrier, axial viscosity, Coulomb contact, force-limited
  barycentric grabbing, and two-pass Loop surface subdivision. Material constants
  and the 240 Hz fixed step match `refs/jelly-webgpu.html`.
- The new cage uses a Delaunay interior and consistently split prisms to avoid
  thin radial elements. The face follows weighted points on the simulated skin.
- `src/game/locomotion.ts` supplies a powered posture and gait through nodal
  forces and jump impulses. It does not replace particle positions with animation.
  The muscles release completely during a grab and recover gradually afterward.
- The reference's RGB surface tracing, Fresnel transmission, internal reflection,
  absorption, and per-vertex optical thickness run in a worker. There is one
  outstanding snapshot at a time. Translation compensation keeps the light field
  attached while the worker traces the changing shape.
- Window direction, color, and flux are measured from the supplied HDR image.
  The floor removes that source's occluded diffuse contribution and reconstructs
  transmitted flux. Environment illumination supplies the rest, without a second
  light duplicating the window. The environment is not drawn as a background.
- Procedural contact audio combines damped membrane modes and a short filtered
  contact transient. No audio files or remote resources are required.

The optical approximations are the same family as the reference: screen-space
view transmission, finite photon budget, a planar receiver, and no self-collision
or tearing. This is a powered soft character, not a passive upright jelly statue.

## Verification

```sh
npm run lint
npm run typecheck
npm run test:physics
npm run build
```

The numerical checks cover settling upright, volume retention, walking, turning,
jumping, stretching, throwing, recovery, HDR source measurement, and refracted
light reaching the floor. The reference JavaScript modules are linted and tested
numerically; new application modules are TypeScript.

Per project instructions, no development server or browser inspection was run
during implementation. GPU shader execution, visual quality, touch feel, and sound
still need inspection in the target browser. WebGL fallback is disabled, and GPU
startup/runtime failures are surfaced with diagnostics.
