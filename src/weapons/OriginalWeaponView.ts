import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { LoadedOriginalWeapon, OriginalMotionData } from '../assets/OriginalWeaponLibrary';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import type { ViewmodelState } from './Viewmodel';

type Role = 'Right' | 'Left';
type Vec3Data = { x: number; y: number; z: number };

function step(value: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3, stiffness: number, damping: number, dt: number): void {
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    velocity.x += (target.x - value.x) * (stiffness * 60 * h);
    velocity.y += (target.y - value.y) * (stiffness * 60 * h);
    velocity.z += (target.z - value.z) * (stiffness * 60 * h);
    const decay = Math.exp(-damping * 60 * h);
    velocity.multiplyScalar(decay);
    value.addScaledVector(velocity, h);
  }
}

function clampRecoil(value: THREE.Vector3, max: Vec3Data): void {
  value.set(
    Math.min(max.x, Math.max(-max.x, value.x)),
    Math.min(max.y, Math.max(-max.y, value.y)),
    Math.min(max.z, Math.max(-max.z, value.z)),
  );
}

export class OriginalRecoil {
  readonly position = new THREE.Vector3();
  readonly rotation = new THREE.Vector3();
  private readonly positionTarget = new THREE.Vector3();
  private readonly rotationTarget = new THREE.Vector3();
  private readonly positionVelocity = new THREE.Vector3();
  private readonly rotationVelocity = new THREE.Vector3();
  private lastFire = -100;
  private time = 0;

  constructor(private readonly source: OriginalMotionData) {}

  fire(): void {
    const motion = this.source;
    if (this.time - this.lastFire < motion.MotionRecoilInterval) return;
    this.lastFire = this.time;
    if (!motion.FixedPoint) {
      this.positionTarget.x += motion.MotionPositionRecoil.x;
      this.positionTarget.y += motion.MotionPositionRecoil.y;
      this.positionTarget.z -= motion.MotionPositionRecoil.z;
    }
    this.rotationTarget.x -= motion.MotionRotationRecoil.x * THREE.MathUtils.DEG2RAD;
    this.rotationTarget.y -= motion.MotionRotationRecoil.y * THREE.MathUtils.DEG2RAD;
    this.rotationTarget.z += motion.MotionRotationRecoil.z * THREE.MathUtils.DEG2RAD;
    clampRecoil(this.positionTarget, motion.MotionPositionMaxState);
    if (this.rotationTarget.length() < motion.MotionRotationRecoilDeadZone * THREE.MathUtils.DEG2RAD) this.rotationTarget.set(0, 0, 0);
  }

  update(dt: number): void {
    this.time += dt;
    const motion = this.source;
    this.positionTarget.multiplyScalar(Math.exp(-motion.MotionPositionReset * dt));
    this.rotationTarget.multiplyScalar(Math.exp(-motion.MotionRotationReset * dt));
    step(this.position, this.positionVelocity, this.positionTarget, motion.PositionSpring2Stiffness, motion.PositionSpring2Damping, dt);
    step(this.rotation, this.rotationVelocity, this.rotationTarget, motion.RotationSpring2Stiffness, motion.RotationSpring2Damping, dt);
  }

  reset(): void {
    this.positionTarget.set(0, 0, 0);
    this.rotationTarget.set(0, 0, 0);
    this.position.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
    this.positionVelocity.set(0, 0, 0);
    this.rotationVelocity.set(0, 0, 0);
    this.lastFire = -100;
  }
}

export class OriginalWeaponView {
  readonly root: THREE.Group;
  readonly muzzle: THREE.Object3D;
  readonly hip = new THREE.Vector3();
  readonly aim = new THREE.Vector3();
  private readonly mixers = new Map<Role, THREE.AnimationMixer>();
  private readonly clips = new Map<Role, Map<string, THREE.AnimationClip>>();
  private readonly current = new Map<Role, THREE.AnimationAction>();
  private reloading = false;

  constructor(asset: LoadedOriginalWeapon, renderer: THREE.WebGLRenderer, private readonly reloadTime: number) {
    this.root = clone(asset.gltf.scene) as THREE.Group;
    this.root.name = `unity.original.${asset.entry.weapon}`;
    this.root.scale.set(-0.24, 0.24, 0.24);
    this.root.rotation.y = Math.PI;
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) applyArtEnvironment(material, renderer);
    });
    const right = this.root.getObjectByName(`${asset.entry.weapon}_Right`) ?? this.root;
    this.muzzle = right.getObjectByName('muzzle') ?? new THREE.Object3D();
    if (!this.muzzle.parent) this.root.add(this.muzzle);
    this.root.updateMatrixWorld(true);
    const muzzlePosition = this.muzzle.getWorldPosition(new THREE.Vector3());
    this.hip.set(0.2, -0.13, -0.6).sub(muzzlePosition);
    this.aim.set(0, -0.08, -0.65).sub(muzzlePosition);
    for (const role of ['Right', 'Left'] as const) {
      const roleRoot = this.root.getObjectByName(`${asset.entry.weapon}_${role}`);
      if (!roleRoot) continue;
      const mixer = new THREE.AnimationMixer(roleRoot);
      this.mixers.set(role, mixer);
      this.clips.set(role, new Map(asset.gltf.animations.filter((clip) => clip.name.startsWith(`${role}_`)).map((clip) => [clip.name, clip])));
      mixer.addEventListener('finished', ({ action }) => {
        if (this.current.get(role) === action) this.play(role, 'Pose', 0.05);
      });
      this.play(role, 'Pose', 0);
    }
  }

  private play(role: Role, action: string, fade: number, duration?: number): THREE.AnimationAction | null {
    const mixer = this.mixers.get(role);
    const clip = this.clips.get(role)?.get(`${role}_${action}`);
    if (!mixer || !clip) return null;
    const previous = this.current.get(role);
    const next = mixer.existingAction(clip) ?? mixer.clipAction(clip);
    next.reset();
    next.setLoop(action === 'Pose' ? THREE.LoopRepeat : THREE.LoopOnce, action === 'Pose' ? Infinity : 1);
    next.clampWhenFinished = true;
    next.timeScale = duration && clip.duration > 0 ? clip.duration / duration : 1;
    next.play();
    if (previous && previous !== next && fade > 0) previous.crossFadeTo(next, fade, false);
    else if (previous && previous !== next) previous.stop();
    this.current.set(role, next);
    return next;
  }

  fire(fullCharge = false): void {
    this.reloading = false;
    this.play('Right', 'Fire', 0.02);
    this.play('Left', 'Fire', 0.02);
  }

  update(dt: number, state: ViewmodelState): void {
    if (state.reloading && !state.shellMode) {
      const action = this.reloading ? this.current.get('Right') : this.play('Right', 'Reload', 0.02, this.reloadTime);
      this.reloading = true;
      if (action) {
        const clip = action.getClip();
        action.time = Math.min(clip.duration, Math.max(0, state.reloadP) * clip.duration);
      }
    } else if (this.reloading) {
      this.reloading = false;
      this.play('Right', 'Pose', 0.05);
    }
    for (const mixer of this.mixers.values()) mixer.update(dt);
  }

  dispose(): void {
    for (const mixer of this.mixers.values()) mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
