/** A stage-local mask preserves world-space paving without a road loop per fragment. */
import type { AdventurePath, P2 } from './LevelTypes';

export interface AdventureRoadMask { data: Uint8Array; resolution: number }

/** R8 texels are sampled at their centers; use (world - center) / (2 * extent) + .5 in the shader. */
export function bakeAdventureRoadMask(paths: readonly AdventurePath[], center: P2, extent: number, resolution = 512): AdventureRoadMask {
  if (!Number.isFinite(extent) || extent <= 0 || !Number.isInteger(resolution) || resolution < 2) {
    throw new RangeError('Road mask requires a positive extent and an integer resolution of at least 2');
  }
  const data = new Uint8Array(resolution * resolution);
  const step = 2 * extent / resolution;
  const originX = center.x - extent + step / 2, originZ = center.z - extent + step / 2;
  for (const path of paths) {
    if (!Number.isFinite(path.width) || path.width <= 0) continue;
    const inner = path.width * .5 * .55, outer = path.width * .5 + 1.4, fade = outer - inner;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], abX = b.x - a.x, abZ = b.z - a.z;
      const inverseLengthSq = 1 / Math.max(abX * abX + abZ * abZ, .001);
      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - outer - originX) / step));
      const maxX = Math.min(resolution - 1, Math.ceil((Math.max(a.x, b.x) + outer - originX) / step));
      const minZ = Math.max(0, Math.floor((Math.min(a.z, b.z) - outer - originZ) / step));
      const maxZ = Math.min(resolution - 1, Math.ceil((Math.max(a.z, b.z) + outer - originZ) / step));
      for (let z = minZ; z <= maxZ; z++) {
        const dz = originZ + z * step - a.z;
        for (let x = minX; x <= maxX; x++) {
          const index = z * resolution + x;
          if (data[index] === 255) continue;
          const dx = originX + x * step - a.x;
          const t = Math.max(0, Math.min(1, (dx * abX + dz * abZ) * inverseLengthSq));
          const rx = dx - t * abX, rz = dz - t * abZ;
          const distance = Math.sqrt(rx * rx + rz * rz);
          if (distance >= outer) continue;
          const u = Math.max(0, (distance - inner) / fade);
          const weight = Math.round(255 * (1 - u * u * (3 - 2 * u)));
          if (weight > data[index]) data[index] = weight;
        }
      }
    }
  }
  return { data, resolution };
}
