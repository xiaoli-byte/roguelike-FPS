/**
 * Simplified enemy shadows: one soft dark disc under each enemy, all drawn by a single InstancedMesh.
 *
 * Enemy models no longer cast into the sun shadow map. That map spans the whole level and re-renders at
 * 30 Hz while anything moves, so every animated enemy body was redrawn into it each time. A ground disc
 * reads the same at combat distance for a fraction of the cost: no skinned shadow draws, one draw call.
 * Grounded enemies get the disc at their feet (deck tops included); flyers project it onto the ground.
 * Anything off the ground (jumps, or a body lifted by its animation: EnemyBase.visualLift) keeps its disc on the
 * ground below, shifted away along the sun direction by its height and shrunk, like a real sun shadow.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { EnemyBase } from './EnemyBase';

/** Disc diameter as a multiple of the enemy's body radius, and how far above the ground it floats. */
const SPREAD = 2.6, LIFT = .03;
/** Flyers' discs shrink and fade with height; past this many metres above ground they vanish. */
const FADE_HEIGHT = 12;
/** Jumpers / hoppers: how fast the disc shrinks with height above ground (per metre), and its smallest size. */
const JUMP_SHRINK = .45, JUMP_MIN = .55;

let texture: THREE.CanvasTexture | null = null;

/** Radial falloff, darkest in the middle (shared for the lifetime of the page). */
function discTexture(): THREE.CanvasTexture {
  if (texture) return texture;
  const size = 64, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!, grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(.55, 'rgba(255,255,255,.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  texture = new THREE.CanvasTexture(canvas);
  return texture;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class BlobShadows {
  private mesh: THREE.InstancedMesh | null = null;
  private capacity = 0;
  /** Horizontal shadow shift per metre of height (from the scene's sun), refreshed every update. */
  private readonly sunShift = new THREE.Vector2();
  private sun: THREE.DirectionalLight | null = null;
  /** No sun found (sunless level, level switch): don't re-traverse the scene before this time (seconds). */
  private sunRetryAt = 0;

  constructor(private readonly ctx: GameContext) {}

  /** Stop a freshly built enemy from casting into the sun map (its disc stands in for it). */
  adopt(enemy: EnemyBase): void {
    enemy.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  }

  update(enemies: readonly EnemyBase[]): void {
    // Headless runs (node tests, sync-stepped harness) have no canvas or scene to draw into.
    if (typeof document === 'undefined' || !this.ctx.scene || !this.ctx.world) return;
    if (enemies.length > this.capacity) this.grow(enemies.length);
    const mesh = this.mesh;
    if (!mesh) return;
    if (mesh.parent !== this.ctx.scene) this.ctx.scene.add(mesh);
    this.updateSun();
    let n = 0;
    for (const e of enemies) {
      if (e.removed || !e.root.visible) continue;
      const pos = e.position;
      let y = pos.y, fade = 1, x = pos.x, z = pos.z;
      if (e.flying) {
        const ground = this.ctx.world.groundHeight(pos.x, pos.z, pos.y, 0);
        y = Number.isFinite(ground) ? ground : this.ctx.stage.arena?.floorY ?? 0;
        fade = Math.max(0, 1 - (pos.y - y) / FADE_HEIGHT);
      } else if (!e.onGround || e.visualLift > 0.01) {
        // Off the ground: the shadow stays on the ground below, shifted along the sun and smaller with height.
        let ground = pos.y;
        if (!e.onGround) {
          const g = this.ctx.world.groundHeight(pos.x, pos.z, pos.y, 0);
          ground = Number.isFinite(g) ? Math.min(g, pos.y) : pos.y;
        }
        const h = Math.max(0, pos.y - ground) + Math.max(0, e.visualLift);
        y = ground;
        x += this.sunShift.x * h;
        z += this.sunShift.y * h;
        fade = Math.max(JUMP_MIN, 1 / (1 + h * JUMP_SHRINK));
      }
      // Dying bodies sink and fade; their discs shrink with them.
      if (!e.alive) fade *= Math.max(0, 1 - e.deathTime / Math.max(.01, e.deathDuration));
      if (fade <= .02) continue;
      const d = e.radius * SPREAD * (.5 + .5 * fade);
      _p.set(x, y + LIFT, z); _s.set(d, d, d);
      mesh.setMatrixAt(n++, _m.compose(_p, _q, _s));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = n > 0;
  }

  /** Shadow shift per metre of height = -(sun direction).xz / (sun direction).y, from the scene's directional light. */
  private updateSun(): void {
    if (!this.sun || !this.sun.parent) {
      this.sun = null;
      const now = this.ctx.time.now;
      if (now >= this.sunRetryAt) {
        this.ctx.scene.traverse((o) => { if (!this.sun && (o as THREE.DirectionalLight).isDirectionalLight) this.sun = o as THREE.DirectionalLight; });
        if (!this.sun) this.sunRetryAt = now + 1;
      }
    }
    const sun = this.sun;
    if (!sun) { this.sunShift.set(0, 0); return; }
    sun.getWorldPosition(_p);
    sun.target.getWorldPosition(_s);
    _p.sub(_s).normalize();
    const up = Math.max(.35, _p.y);
    this.sunShift.set(-_p.x / up, -_p.z / up);
  }

  private grow(need: number): void {
    const old = this.mesh;
    this.capacity = Math.max(32, need * 2);
    const geometry = old?.geometry ?? new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = (old?.material as THREE.MeshBasicMaterial | undefined) ?? new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: discTexture(), transparent: true, opacity: .42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    mesh.name = 'enemies.blobShadows'; mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.count = 0;
    old?.removeFromParent();
    old?.dispose();
    this.mesh = mesh;
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
    this.mesh?.dispose();
    this.mesh = null; this.capacity = 0;
  }
}
