import type { Settings } from '../core/types';

/** Sun shadow map edge in texels for each shadow-quality step (the player picks it in Settings). */
export const SHADOW_MAP_SIZES: Readonly<Record<Settings['shadowQuality'], number>> = { low: 1024, medium: 2048, high: 4096 };

export function shadowMapSize(settings: Pick<Settings, 'shadowQuality'>): number {
  return SHADOW_MAP_SIZES[settings.shadowQuality] ?? SHADOW_MAP_SIZES.medium;
}

/**
 * Follow the player's shadow-quality setting while a scene is up (callers pass shadowMapSize(settings)):
 * a changed size drops the old map (three.js allocates the new one on the next shadow render) and asks
 * for a redraw.
 */
export function syncShadowMapSize(shadow: { mapSize: { x: number; setScalar(v: number): unknown }; map: { dispose(): void } | null; needsUpdate: boolean }, size: number): void {
  if (shadow.mapSize.x === size) return;
  shadow.mapSize.setScalar(size);
  shadow.map?.dispose(); shadow.map = null;
  shadow.needsUpdate = true;
}

/** Keep the full-resolution sun map, refreshing animated casters at 30 Hz. */
export class ShadowCadence {
  private elapsed = 0;
  private revision = -1;
  private readonly interval = 1 / 30;

  advance(dt: number, revision: number): boolean {
    if (revision !== this.revision) {
      this.revision = revision; this.elapsed = 0;
      return true;
    }
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.elapsed + 1e-7 < this.interval) return false;
    this.elapsed = Math.max(0, this.elapsed - this.interval) % this.interval;
    return true;
  }
}

type V3 = { x: number; y: number; z: number };

/**
 * Player-following sun shadow box: half-size (metres) and the stride it moves in. 8 m is a whole number of texels
 * at every shadow quality (a 128 m box is 64, 128 or 256 texels per 8 m at 1024, 2048, 4096), so moving in strides
 * keeps texels on the same world grid and the map does not shimmer. Scenes no wider than the box keep a fitted map.
 */
export const SHADOW_FOLLOW_HALF = 64, SHADOW_FOLLOW_STEP = 8;

/**
 * Tracks where the shadow box is centred, across the light's view plane (`right`, `up`: the shadow camera's
 * world X and Y axes). follow() returns the world shift to apply to the sun and its target when the player
 * has moved a whole stride or more from the box centre (each such move costs one shadow redraw), else null.
 */
export class ShadowFollow {
  private readonly centre: V3;
  private readonly right: V3;
  private readonly up: V3;

  constructor(centre: V3, right: V3, up: V3, readonly step = SHADOW_FOLLOW_STEP) {
    this.centre = { x: centre.x, y: centre.y, z: centre.z };
    this.right = { x: right.x, y: right.y, z: right.z };
    this.up = { x: up.x, y: up.y, z: up.z };
  }

  follow(player: V3): V3 | null {
    const dx = player.x - this.centre.x, dy = player.y - this.centre.y, dz = player.z - this.centre.z;
    const r = Math.round((dx * this.right.x + dy * this.right.y + dz * this.right.z) / this.step) * this.step;
    const u = Math.round((dx * this.up.x + dy * this.up.y + dz * this.up.z) / this.step) * this.step;
    if (!r && !u) return null;
    const shift = { x: this.right.x * r + this.up.x * u, y: this.right.y * r + this.up.y * u, z: this.right.z * r + this.up.z * u };
    this.centre.x += shift.x; this.centre.y += shift.y; this.centre.z += shift.z;
    return shift;
  }
}

type FollowSun = {
  position: V3 & { add(v: V3): unknown };
  target: { position: V3 & { add(v: V3): unknown }; updateMatrixWorld(): void };
  updateMatrixWorld(): void;
  shadow: { needsUpdate: boolean };
};

/** Move a shadow-casting sun (and its target) with the follow box; true when it moved and the map must redraw. */
export function followSun(follow: ShadowFollow | null, sun: FollowSun | null, player: V3 | undefined): boolean {
  if (!follow || !sun || !player) return false;
  const shift = follow.follow(player);
  if (!shift) return false;
  sun.position.add(shift); sun.target.position.add(shift);
  sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  sun.shadow.needsUpdate = true;
  return true;
}

/**
 * Fit an orthographic shadow camera to a scene's light-space bounds, or, when the scene is wider than the follow
 * box, to the box itself (centred on the light's view axis) with depth still spanning the whole scene. Returns
 * the follow tracker in the latter case.
 */
export function fitSunShadow(camera: { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void },
  bounds: { min: V3; max: V3 }, centre: V3, right: V3, up: V3): ShadowFollow | null {
  const wide = bounds.max.x - bounds.min.x > 2 * SHADOW_FOLLOW_HALF || bounds.max.y - bounds.min.y > 2 * SHADOW_FOLLOW_HALF;
  const pad = wide ? SHADOW_FOLLOW_HALF : 0;
  if (wide) {
    camera.left = -SHADOW_FOLLOW_HALF; camera.right = SHADOW_FOLLOW_HALF; camera.bottom = -SHADOW_FOLLOW_HALF; camera.top = SHADOW_FOLLOW_HALF;
  } else {
    camera.left = bounds.min.x; camera.right = bounds.max.x; camera.bottom = bounds.min.y; camera.top = bounds.max.y;
  }
  // The box slides across the light view, so its depth range reaches past the fitted one by the box size.
  camera.near = Math.max(.5, -bounds.max.z - 3 - pad); camera.far = -bounds.min.z + 3 + pad;
  camera.updateProjectionMatrix();
  return wide ? new ShadowFollow(centre, right, up) : null;
}
