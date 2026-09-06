/** Replicated facility identity and geometry shared by the client, the remote
 * actor worker and the Worker room service. Deliberately free of THREE and of
 * any model data so the authority can validate mounts without the jelly cage. */

export const FACILITY_NONE=0;
export const FACILITY_SWING=1;
export const FACILITY_TRAMPOLINE=2;

export type FacilityId=typeof FACILITY_NONE|typeof FACILITY_SWING|typeof FACILITY_TRAMPOLINE;

export type FacilityAnchor={
  /** Stable string id, matching the client-side Facility implementations. */
  key:string;
  x:number;
  z:number;
  /** Mount radius on the ground plane, in metres. */
  reach:number;
  /** Where a rider is placed on dismount, relative to the anchor. */
  exit:{x:number;z:number};
  /** Absolute bound on the replicated ride phase. */
  phaseLimit:number;
};

/** Indexed by FacilityId; index 0 is "not riding" and has no anchor. */
export const FACILITY_ANCHORS:readonly (FacilityAnchor|null)[]=[
  null,
  {key:'spawn-swing',x:-.155,z:-.035,reach:.105,exit:{x:.13,z:0},phaseLimit:.9},
  {key:'spawn-trampoline',x:.165,z:-.035,reach:.125,exit:{x:-.145,z:0},phaseLimit:.16},
];

export function facilityAnchor(facility:number) {
  return FACILITY_ANCHORS[facility]??null;
}

export function isFacility(value:unknown):value is FacilityId {
  return value===FACILITY_SWING||value===FACILITY_TRAMPOLINE;
}

/** Clamp a reported phase into the range the facility can physically reach. */
export function clampPhase(facility:number,phase:number) {
  const anchor=facilityAnchor(facility);
  if(!anchor||!Number.isFinite(phase))return 0;
  return Math.max(-anchor.phaseLimit,Math.min(anchor.phaseLimit,phase));
}
