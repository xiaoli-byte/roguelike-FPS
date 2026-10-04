/** Fit generated art inside the generator's existing square collision footprint. */
export function fitScenePropScale(bounds: { min: number[]; max: number[] }, yaw: number, requested: number, collider?: readonly [number, number]): number {
  if (!collider) return requested;
  let radiusX = 0, radiusZ = 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const x of [bounds.min[0], bounds.max[0]]) for (const z of [bounds.min[2], bounds.max[2]]) {
    radiusX = Math.max(radiusX, Math.abs(x * c + z * s));
    radiusZ = Math.max(radiusZ, Math.abs(-x * s + z * c));
  }
  const half = collider[0] * Math.min(1.25, requested) / 2;
  return Math.min(requested, half / Math.max(radiusX, radiusZ, 1e-6), collider[1] * requested / Math.max(bounds.max[1], 1e-6));
}
