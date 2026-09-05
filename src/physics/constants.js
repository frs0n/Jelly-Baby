export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const PHYS = {
  density: 1050, shear: 1200, bulk: 65000, damping: 3,
  gravity: 9.81, step: 1 / 240, iterations: 3,
  staticFriction: .65, dynamicFriction: .42, restitution: .065,
  floor: .00015, maxGrabForce: 2.8,
};
