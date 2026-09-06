# Facilities

Facilities are small playable machines placed around the spawn point. They own
their own geometry and local physics, but they share interaction routing,
camera handoff, body ownership, reset, shadows, laughter state, and sound
events.

## Shared facility contract

[`src/game/facilities.ts`](../src/game/facilities.ts) defines the `Facility`
interface. Each implementation supplies:

- a unique `id` and short display `label`;
- `active`, optional `laughing`, optional `cameraDistance`, and an
  `interactionDistance` (`Infinity` means unavailable);
- `interact()` to board or leave;
- fixed-step `step(h)` and optional `afterStep()`;
- render-time `update()`;
- `reset()` and `dispose()`.

`Facilities` owns one DOM prompt and one touch button. It chooses the active
facility first; otherwise it sorts finite candidates by interaction distance.
The nearest available facility is therefore the only contextual affordance. An
active facility retains ownership even if another facility becomes closer.

Desktop `E` and the touch button call the same `interact` path. Key repeats are
ignored. On a successful transition the runtime clears ordinary input, resets
the locomotion rig, and unlocks audio. All facilities still receive fixed-step
updates, so an inactive swing can coast while another facility is active, but
only the active facility gets body-control ownership.

The manager renders `Play <label>` or `Get Off <label>` and hides the prompt when
there is no finite candidate. Reset clears every facility and hides the prompt;
dispose aborts the manager's listeners, removes the prompt, and disposes every
registered facility.

## Swing

### Geometry

[`src/graphics/swing.ts`](../src/graphics/swing.ts) builds a miniature joiner's
swing from rounded timber, sage seat pieces, brass pegs/rings, and paired rope
bridles. The seat is a three-slat assembly under a pivot group. The visual pivot
rotates around the X axis; the fixed frame stays in world space. The same frame
leg segments are exposed to the inactive-walk collision pass.

The visual material includes a small procedural TSL grain over the timber. All
geometry is disposed through the swing group rather than leaking shared
materials when the facility is removed.

### Pendulum and rider coupling

[`src/game/swing-physics.ts`](../src/game/swing-physics.ts) defines the swing in
metres:

| Quantity | Value |
| --- | ---: |
| World position | `x = -.155`, `z = -.035` |
| Pivot height | `.172` |
| Rope length | `.128` |
| Seat width | `.108` |
| Maximum angle | `.85` rad (about 49°) |

The local machine is a damped nonlinear pendulum. While occupied, it gradually
raises its target amplitude over seven seconds, injects energy in phase with
the current motion, gives a short initial assist, and applies a conservative
energy ceiling at the turning points. It is a driven pendulum approximation,
not a rope solver or a full multibody constraint system.

Boarding is allowed only when the body is grounded, ungrabbed, and within `.105`
m of the swing. The body is placed into the current seat frame and receives the
corresponding tangential velocity. During the ride, each cage node is pulled
toward its seat-frame target with stiffness and damping that rise toward the
feet. The solver is still responsible for deformation, volume retention,
contact, and recoil; facility forces never replace particle positions with an
animation.

Dismounting moves the body to the clear approach side, undoes the seat frame,
places the lowest point just above the floor, and zeroes velocity. An inactive
swing continues to integrate its angle and speed and gradually loses energy.
When inactive and nearby, the facility also pushes particles out of its rounded
frame legs and removes inward velocity so a walking body cannot pass through
the structure.

The normal face blinks during the gentle initial ride. Once the swing crosses
15°, `laughStarted` becomes true and laughter remains active for the rest of
that ride. Reset and dismount clear it.

## Trampoline

### Geometry

[`src/graphics/trampoline.ts`](../src/graphics/trampoline.ts) builds a padded
annular trampoline with a stitched cushion, thread rings, a dynamic fabric bed,
32 visible coil springs, three U-shaped tubular legs, collars, bolts, and six
molded rubber feet. The bed is a radial grid whose vertices carry a smooth
center-to-rim displacement weight. Its normals and bounds are recomputed when
the bed compression changes; the frame remains static.

### Support, bounce, and flight

[`src/game/trampoline-physics.ts`](../src/game/trampoline-physics.ts) defines:

| Quantity | Value |
| --- | ---: |
| World position | `x = .165`, `z = -.035` |
| Outer radius | `.10` |
| Mat radius | `.075` |
| Bed height | `.043` |
| Target bounce | `.105` m |
| Laugh threshold | `.035` m |

Boarding requires grounded, ungrabbed proximity within `.125` m. The body is
placed over the bed and the rest of its velocity is cleared. While active,
weighted lower nodes measure foot height and foot speed. If the feet are below
the bed, a unilateral spring force combines compression, damping, and a
bounded energy pump that gradually approaches the 10.5 cm target bounce.

The force is distributed through foot weights while horizontal and airborne
posture forces keep the body centered. The vertical posture term has zero net
force around the mass-weighted center, so once the feet leave the bed the body
flies under gravity and the soft-body solver handles its own deformation. The
unloaded bed follows a damped recoil mode rather than a cloth simulation.

The normal face becomes sustained laughter after the center rises 3.5 cm above
the bed. Leaving moves the body to the clear side of the trampoline, rests it
on the floor, and stores any remaining supported bed speed so the empty bed can
finish recoiling. When inactive, a padded-rim collision keeps a walking body
from passing through the frame.

## Facility shadow projection

[`src/graphics/facility-shadows.ts`](../src/graphics/facility-shadows.ts) gives
opaque facilities fixed-world shadows without adding transparent geometry to the
table. Each facility registers a world-space `Box3` that covers its entire
motion envelope. The constructor projects the bounds along the measured
downward window direction and builds a fixed 512² orthographic target.

Each descendant mesh is represented twice in the shadow scene:

- a red directional projection; and
- a green contact projection with height fade near the floor.

Both channels use max blending, so a cushion or bed cannot erase the legs and
feet beneath it. A target is rerendered only when a source matrix, visibility,
dynamic position-attribute version, or explicit dirty flag changes. This keeps
idle facility shadows stable and catches deformed trampoline fabric even when
its object transform is unchanged. The render target and renderer state are
restored after each update.

The table performs a deterministic 3×3 tent lookup of these channels. Its
world-to-UV transform accounts for the WebGPU row direction explicitly; there
is no camera-following shadow shimmer.

## Facility sound hooks

Each facility owns a `FacilityMotionSound` instance and emits semantic events
from fixed physics steps. The swing emits at hinge reversals and fast bottom
crossings. The trampoline emits on landing and early spring recovery. The
events carry strength and a world position; `JellySound` handles distance,
stereo placement, mute state, and voice limits. The complete audio path is
documented in [Input, audio, and UI](input-audio-ui.md).

## Adding a facility

To add another set piece:

1. implement `Facility` in `src/game/facilities.ts`'s surrounding module;
2. keep simulation in `src/game/<name>-physics.ts` and geometry in
   `src/graphics/<name>.ts`;
3. give it a unique `id`, concise `label`, interaction distance, reset, and
   disposal behavior;
4. register it with `facilities.add(...)` in `src/game/runtime.ts`;
5. register its complete motion envelope with `FacilityShadows.add(...)`;
6. route semantic sound events through `FacilityMotionSound` if it has motion;
   and
7. add a focused verification script for boarding, ownership, reset, body
   coupling, bounds, and any user-facing expression/audio threshold.

The active facility should own body posture only for the duration of the ride.
The shared manager should remain the owner of prompts, `E`, touch action,
exclusive selection, and teardown.
