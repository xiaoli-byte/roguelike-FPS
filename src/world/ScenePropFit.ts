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

/** Preserve the old natural prop's visual envelope without turning foliage into solid cover. */
export function fitNaturalPropScale(bounds: { min: number[]; max: number[] }, requested: number, kind: 'pine' | 'rock', horizontalRadius?: number): number {
  const height = Math.max(bounds.max[1] - Math.min(0, bounds.min[1]), 1e-6);
  const radius = horizontalRadius ?? Math.max(...[bounds.min[0], bounds.max[0]].flatMap(x =>
    [bounds.min[2], bounds.max[2]].map(z => Math.hypot(x, z))));
  // The generator already reserves a circular 3.1m canopy and a 4.6m tree height.
  // Decorative rubble stays below walking cover height; its old silhouette had no collider.
  const diameter = kind === 'pine' ? 3.1 : 1.7;
  const maxHeight = kind === 'pine' ? 4.6 : 0.85;
  return requested * Math.min(1, diameter / Math.max(radius * 2, 1e-6), maxHeight / height);
}

/** Preserve a generated building's proportions while fitting every LOD in one solid envelope. */
export function fitLandmarkTransform(bounds: { min: number[]; max: number[] }, footprint: { width: number; depth: number; height: number }): { scale: number; offset: [number, number, number] } {
  const size = bounds.max.map((value, axis) => Math.max(value - bounds.min[axis], 1e-6));
  return {
    scale: Math.min(footprint.width / size[0], footprint.height / size[1], footprint.depth / size[2]),
    offset: [-(bounds.min[0] + bounds.max[0]) / 2, -bounds.min[1], -(bounds.min[2] + bounds.max[2]) / 2],
  };
}
