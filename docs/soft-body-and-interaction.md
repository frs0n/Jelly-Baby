# Soft body and interaction physics

The baby is simulated as a small, nearly incompressible soft solid. The visible
mesh is not animated by a canned squash-and-stretch pose: it is embedded in a
regular tetrahedral cage, and the cage is advanced by the solver.

## Model data and generated cage

The source shape lives in [`refs/jelly_baby_mesh.html`](../refs/jelly_baby_mesh.html).
`scripts/build-model.mjs` extracts only its implicit-model definitions and
marching-tetrahedra builder, scales the result to a 7 cm body, preserves the
original surface triangles, and writes a packed binary asset plus a JSON
manifest.

The checked-in asset currently contains:

| Data | Size | Use |
| --- | ---: | --- |
| Visible surface | 72,234 vertices / 144,464 triangles | The rendered, picked, and facially attached body. |
| Mechanical particles | 980 nodes | Positions, velocities, mass, contact, and cage deformation. |
| Tetrahedral elements | 4,026 | Elastic, volume, and orientation constraints. |
| Contact bindings | 2,138 | Barycentric floor samples around the lower body. |
| Optical proxy | 10,090 vertices / 20,176 triangles | Bounded light-space depth, shadow, and thickness work. |

The counts come directly from the generated manifest arrays: `particles` has
2,940 scalar coordinates, `volumes` has 4,026 entries, and the visible and
optical index buffers contain 433,392 and 60,528 indices respectively. The
manifest stores the source SHA-256, physical volume, scale, and byte ranges for
each typed array. `src/physics/baby-cage.ts` reconstructs those arrays into
Three.js geometries and per-surface four-node bindings.

`scripts/model-cage.mjs` lays a 7.5 mm regular lattice over the implicit solid.
Each occupied lattice cell is split into six tetrahedra. Element volumes are
weighted by implicit occupancy samples and then globally rescaled so the cage
has the exact signed volume of the reference surface. Every visible vertex is
embedded into the first containing tetrahedron with barycentric weights. Surface
contact bindings are selected from cell extrema so the floor constraints reach
the actual lower silhouette instead of an arbitrary cage plane.

The optical surface is generated from the same implicit model at a lower
polygonizer resolution. Its vertices are also embedded into the full cage, and
each visible vertex receives a three-vertex mapping back to the proxy for view
thickness interpolation. The proxy never replaces the rendered mesh.

## Physical parameters

[`src/physics/constants.js`](../src/physics/constants.js) is the shared source
of simulation constants:

| Parameter | Value | Meaning |
| --- | ---: | --- |
| Density | `1050` | kg/m³ mass density. |
| Shear modulus | `1200` | Pa, resistance to distortion. |
| Bulk modulus | `65000` | Pa, resistance to volume change. |
| Damping | `3` | Internal damping rate used by axial viscosity. |
| Gravity | `2.4` | m/s², deliberately gentler than Earth gravity. |
| Fixed step | `1 / 240` s | Solver rate. |
| XPBD iterations | `3` | Elastic/contact projection passes per step. |
| Static / dynamic friction | `.65` / `.42` | Floor tangential response. |
| Restitution | `.065` | Small bounce response. |
| Floor | `.00015` m | Contact plane height. |
| Maximum grab force | `2.8` | Force limit used by the grab constraint. |

The low gravity and small jump impulse are part of the intended feel: the body
has time to show its elastic response without becoming a fast arcade character.

## Solver step

[`src/physics/soft-body.js`](../src/physics/soft-body.js) stores positions and
velocities in `Float64Array`s. For each fixed step, the JavaScript path:

1. copies the current positions to `previous`, clears contact accumulators, and
   applies exponential air damping and gravity;
2. predicts positions from velocity;
3. clears XPBD multipliers and runs three iterations over every tetrahedron,
   alternating element traversal direction;
4. solves the coupled elastic distortion and hydrostatic constraints, then the
   orientation barrier, grabs, and floor contacts;
5. applies floor friction from the solved tangential displacement;
6. repairs any element whose normalized determinant falls below the orientation
   threshold, without shrinking the global timestep;
7. reconstructs velocity from the corrected position delta and applies a small
   impact response when a contact arrived with meaningful downward speed;
8. applies equal-and-opposite axial viscosity along unique cage edges; and
9. updates the mass center and marks the surface dirty.

The elastic constraints are solved together from the reference neo-Hookean
energy:

```text
W = μ/2 (||F||² − 3) + K/2 (J − 1 − μ/K)²
```

Solving distortion and volume as a coupled two-constraint system makes the
identity deformation force-free. The separate orientation barrier prevents an
element from inverting. If projection stalls, only the affected tetrahedral
cluster is moved partway toward the previous valid state; the rest of the body
still consumes the complete 1/240-second step.

The solver has no self-collision or tearing. This is an intentional bounded
soft-body model, not a general-purpose deformable-material package.

## WebAssembly accelerator and fallback

[`src/physics/soft-body-kernel.js`](../src/physics/soft-body-kernel.js) embeds a
WebAssembly module generated from
[`scripts/native/soft-body-kernel.c`](../scripts/native/soft-body-kernel.c).
`createSoftBodyKernel` allocates the model arrays in a fixed 16 MiB linear
memory region, configures the same topology and constants, and exposes the
kernel's positions, velocities, contact data, nodal deformation gradients,
surface positions, normals, and metadata back to the `SoftBody` object.

The accelerator executes the same elastic projection, grab, contact, barrier,
orientation-repair, damping, sleeping, and surface-embedding arithmetic in
tight linear-memory loops. The visible output is intentionally unchanged: the
performance regression compares accelerated positions and normals with the
original JavaScript embedding and requires zero error. If WebAssembly is not
available or initialization fails, the class keeps the JavaScript solver with
the same equations and public behavior.

The kernel reserves capacity for 16 simultaneous grabs. The input layer uses the
same capacity check before creating a grip, so the fallback and accelerated
paths have the same interaction limit.

## Surface embedding

[`src/physics/deform-surface.js`](../src/physics/deform-surface.js) is the
single embedding implementation. For each visible or optical vertex it:

- interpolates the four current cage positions with the stored barycentric
  weights;
- interpolates the four nodal deformation gradients;
- applies the cofactor matrix to the rest normal and normalizes it; and
- updates the position and normal `BufferAttribute`s and bounds.

The exact full-resolution CPU surface is therefore shared by rendering, the
surface BVH, grabbing, face placement, optical thickness, and facial
clearance. The accelerated path writes the same arrays from WebAssembly, then
updates the same Three.js attributes and bounding volumes.

## Floor contact, sleep, and wake-up

Floor constraints use the precomputed four-node contact bindings. A contact
sample projects upward if it falls below `PHYS.floor`, accumulates penetration
for friction and audio, and contributes to `grounded`. Tangential correction
uses static friction below the threshold and dynamic friction above it.

When locomotion allows sleeping, the body must be grounded, complete a full
fixed step, and remain below 5 mm/s RMS kinetic speed for more than 0.45 s. It
then zeros velocity and stops changing positions. A grab, a movement command,
a jump, or a facility wakes it. Sleeping is exact: later steps leave the
position array unchanged until the next wake.

## Grabbing and throwing

[`src/physics/grab.ts`](../src/physics/grab.ts) turns a visible triangle hit into
a mechanical grip:

1. The hit point is converted to triangle barycentrics.
2. Those weights are composed with the triangle vertex-to-cage stencils.
3. Duplicate cage nodes are merged and renormalized.
4. The resulting anchor is checked against the visible hit point; a mismatch is
   an error rather than a silent offset.
5. The solver applies a compliant XPBD point constraint with a bounded force.

The input layer maintains a short-lived target command. Pointer motion is read
from the newest coalesced sample, limited only for absurd raw world-space
teleports, and advanced with a fast exponential response. On release, the
final target sample is kept for one or two physics substeps so a quick flick
still transfers momentum.

While a grip exists, the camera is frozen and orbit controls are disabled. A
drag target is projected onto a plane aligned with the camera; if it would fall
through the table, it is intersected with a floor plane while remaining on the
pointer ray.

## Locomotion and jumping

[`src/game/locomotion.ts`](../src/game/locomotion.ts) is a force-controlled rig,
not an animation replacement. It computes a mass-weighted center and velocity,
turns toward the requested camera-relative direction, and applies per-node
posture/gait forces toward a yawed rest shape. Feet receive stronger support;
alternating nodal stride forces create a simple walk cycle.

Movement forces release when a grip is active and recover over 0.55 s after the
body is released. Stopping movement removes gait drive and lets damping settle
the body. A jump queues a `.43` m/s base vertical impulse with a little extra
impulse at low rest-space nodes, subject to grounded state and a `.24` s
cooldown. The resulting flight and landing are still solved by the soft body.

Facilities temporarily own posture and vertical support while active. Normal
locomotion is skipped during that handoff; the active facility drives nodes and
the soft-body solver remains responsible for deformation, contact, and recoil.

## Fixed-rate timing

[`src/game/fixed-step.ts`](../src/game/fixed-step.ts) accumulates clamped frame
time and executes up to 12 steps. Four steps cover a normal 60 Hz frame and 12
steps cover the full accepted 50 ms hitch. Excess beyond the caller's contract
is reduced to a remainder instead of creating a slow-motion catch-up spiral.
