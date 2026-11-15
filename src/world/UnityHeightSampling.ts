export interface UnityHeightSamples {
  origin: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  resolution: number;
  heights: Float32Array;
}

export function sampleUnityHeight(field: UnityHeightSamples, x: number, z: number): number {
  const fx = (x - field.origin.x) / field.scale.x;
  const fz = (z - field.origin.z) / field.scale.z;
  if (fx < 0 || fz < 0 || fx > field.resolution - 1 || fz > field.resolution - 1) return -Infinity;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(field.resolution - 1, x0 + 1), z1 = Math.min(field.resolution - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const at = (ix: number, iz: number) => field.origin.y + field.heights[iz * field.resolution + ix] * field.scale.y;
  const a = at(x0, z0), b = at(x1, z0), c = at(x0, z1), d = at(x1, z1);
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}
