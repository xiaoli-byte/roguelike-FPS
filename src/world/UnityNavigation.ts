import type * as THREE from 'three';
import type { ArenaInfo, GameContext } from '../core/types';
import { NavGrid } from './NavGrid';
import { UnityNavMesh } from './UnityNavMesh';
import type { UnitySceneDocument } from './UnityLevelLibrary';

export class UnityNavigation extends NavGrid {
  private unity: UnityNavMesh | null = null;

  constructor(ctx: GameContext) {
    super(ctx);
  }

  setUnityDocument(document: UnitySceneDocument | null): void {
    this.unity = document?.navigation ? new UnityNavMesh(this.ctx, document) : null;
  }

  override build(arena: ArenaInfo, cellSize?: number): void {
    if (!this.unity) super.build(arena, cellSize);
  }

  override isWalkable(x: number, z: number): boolean {
    return this.unity ? this.unity.isWalkable(x, z) : super.isWalkable(x, z);
  }

  override nearestWalkable(point: THREE.Vector3, out: THREE.Vector3): boolean {
    return this.unity ? this.unity.nearestWalkable(point, out) : super.nearestWalkable(point, out);
  }

  override randomWalkable(center: THREE.Vector3, minR: number, maxR: number, out: THREE.Vector3): boolean {
    return this.unity ? this.unity.randomWalkable(center, minR, maxR, out) : super.randomWalkable(center, minR, maxR, out);
  }

  override findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[]): boolean {
    return this.unity ? this.unity.findPath(from, to, out) : super.findPath(from, to, out);
  }

  override platformAt(point: THREE.Vector3): boolean {
    return this.unity ? false : super.platformAt(point);
  }
}
