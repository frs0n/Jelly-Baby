# Jelly Baby documentation

This directory describes the running project as it exists in the repository. The
game is a WebGPU-only Three.js experience: one small soft body, a tabletop, two
play facilities, and a deliberately measured optical treatment.

## Documentation map

- [Architecture and runtime](architecture.md) — boot, initialization order,
  frame order, ownership boundaries, and teardown.
- [Soft body and interaction physics](soft-body-and-interaction.md) — the
  tetrahedral model, XPBD solver, WASM accelerator, surface embedding, grabs,
  locomotion, fixed stepping, and sleep.
- [Rendering and materials](rendering-and-materials.md) — WebGPU startup,
  resize policy, HDR environment, table, baby material, compositing, and
  failure handling.
- [Optical transport](optical-transport.md) — GPU caustics, worker-backed
  thickness/shadow transport, the optical proxy, and the approximation budget.
- [Facilities](facilities.md) — the shared facility contract, swing,
  trampoline, collisions, facility shadows, and extension points.
- [Input, audio, and UI](input-audio-ui.md) — desktop and touch controls,
  picking, camera behavior, flavor selection, facial animation, sound, and
  responsive presentation.
- [Assets and verification](assets-and-verification.md) — generated model
  data, build scripts, test coverage, benchmarks, and operational commands.

## Reading the code

The entry point is [`src/main.ts`](../src/main.ts). It creates the DOM shell and
observes every startup failure. The game implementation is assembled by
[`src/game/runtime.ts`](../src/game/runtime.ts), but the runtime remains an
orchestrator: physics, rendering, input, audio, transport, and facilities live
in their own modules.

The most important shared invariant is that the full-resolution deformed
surface is the source of truth for rendering, picking, facial attachment, and
transmission. Lower-resolution data exists only where a bounded optical
calculation needs it.
