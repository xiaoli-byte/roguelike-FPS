import * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { StaticBox } from './Collision';
import { unityPoint, unityQuaternion, type UnityPlatform, type UnitySceneDocument } from './UnityLevelLibrary';

export class UnityPlatformView {
  private readonly points: THREE.Vector3[];
  private readonly current: THREE.Vector3;
  private readonly previous: THREE.Vector3;
  private readonly next = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private collision: StaticBox | null;
  private readonly size: THREE.Vector3;
  private readonly rotation: THREE.Quaternion;
  private at: number;
  private goal: number;
  private nextIndex: number;
  private dir = 1;
  private velocity = 0;
  private idleTime = 0;
  private standTime = 0;
  private callTime = 0;
  private powered: boolean;
  private moving = false;
  private queued = false;
  private holdUntilClear = false;

  constructor(private readonly ctx: GameContext, private readonly def: UnityPlatform, private readonly root: THREE.Object3D, private readonly document: UnitySceneDocument) {
    this.points = def.path.map(unityPoint);
    this.at = this.goal = Math.min(def.at, this.points.length - 1);
    this.current = this.points[this.at].clone();
    this.previous = this.current.clone();
    this.nextIndex = this.at;
    this.root.position.copy(this.current);
    this.powered = def.startPowered;
    this.size = new THREE.Vector3().fromArray(def.size);
    const collider = document.colliders.find(item => item.platform === def.id);
    this.rotation = collider?.rotation ? unityQuaternion(collider.rotation) : new THREE.Quaternion();
    if (collider) {
      const size = collider.size ? new THREE.Vector3().fromArray(collider.size) : this.size;
      this.collision = collider.kind === 'box' && collider.center && collider.size
        ? ctx.world.addObb(unityPoint(collider.center), size, this.rotation, 'platform')
        : ctx.world.addBox(...collider.min, ...collider.max, 'platform');
    } else this.collision = null;
  }

  get id(): string {
    return this.def.id;
  }

  activate(on: boolean): void {
    if ((this.def.onSignal ?? 0) === 0) {
      this.powered = on;
      return;
    }
    if (!on) return;
    this.powered = true;
    if (this.moving) this.queued = true;
    else this.depart(this.otherEnd(this.at));
  }

  update(dt: number): void {
    if (dt <= 0 || this.points.length < 2) return;
    if (!this.powered && this.def.powerSite && this.ctx.stage.exploration?.encounters?.some(site => site.id === this.def.powerSite && site.phase === 'cleared')) this.powered = true;
    if (!this.powered) return;
    this.idleTime += dt;
    if (this.moving) this.travel(dt);
    else {
      if (this.queued) {
        this.queued = false;
        this.depart(this.otherEnd(this.at));
      } else if (this.def.mode === 0 && this.idleTime >= this.def.dwell) this.depart(this.otherEnd(this.at));
      else if (this.def.mode === 1 && this.idleTime >= this.def.dwell) this.departLoop();
      else if (this.def.mode === 2) this.ride(dt);
    }
  }

  private otherEnd(at: number): number {
    return at === 0 ? this.points.length - 1 : 0;
  }

  private depart(to: number): void {
    if (to === this.at && this.def.mode !== 1) return;
    this.goal = to;
    this.dir = to > this.at ? 1 : -1;
    this.nextIndex = this.at + this.dir;
    this.beginTrip();
  }

  private departLoop(): void {
    this.goal = 0;
    this.dir = 1;
    this.nextIndex = (this.at + 1) % this.points.length;
    this.beginTrip();
  }

  private beginTrip(): void {
    this.moving = true;
    this.velocity = 0;
    this.idleTime = this.standTime = this.callTime = 0;
  }

  private following(index: number): number {
    return this.def.mode === 1 ? (index + this.dir + this.points.length) % this.points.length : index + this.dir;
  }

  private remaining(): { distance: number; corner: number } {
    let distance = this.current.distanceTo(this.points[this.nextIndex]);
    let corner = Infinity;
    let previous = this.current;
    for (let i = this.nextIndex, guard = 0; i !== this.goal && guard <= this.points.length; guard++) {
      const next = this.following(i);
      const incoming = this.direction.subVectors(this.points[i], previous);
      const outgoing = this.next.subVectors(this.points[next], this.points[i]);
      if (corner === Infinity && incoming.lengthSq() > 1e-6 && outgoing.lengthSq() > 1e-6 && incoming.angleTo(outgoing) > Math.PI / 6) corner = distance;
      distance += outgoing.length();
      previous = this.points[i];
      i = next;
    }
    return { distance, corner };
  }

  private travel(dt: number): void {
    const { distance, corner } = this.remaining();
    if (distance < 1e-3) {
      this.arrive();
      return;
    }
    const acceleration = Math.max(0.1, this.def.accel);
    let cap = Math.min(this.def.speed, Math.sqrt(2 * acceleration * distance) + 0.05);
    if (corner !== Infinity) cap = Math.min(cap, Math.sqrt(2 * acceleration * corner) + Math.max(0.2, this.def.cornerSpeed));
    const speedDelta = cap - this.velocity;
    this.velocity = Math.abs(speedDelta) <= acceleration * dt ? cap : this.velocity + Math.sign(speedDelta) * acceleration * dt;
    this.velocity = Math.min(this.velocity, cap);
    let left = Math.min(distance, Math.max(this.velocity, 0.15) * dt);
    this.previous.copy(this.current);
    let nextIndex = this.nextIndex;
    let arrived = false;
    for (let guard = 0; guard <= this.points.length; guard++) {
      this.direction.subVectors(this.points[nextIndex], this.current);
      const length = this.direction.length();
      if (length > left) {
        this.current.addScaledVector(this.direction, left / length);
        break;
      }
      this.current.copy(this.points[nextIndex]);
      left -= length;
      if (nextIndex === this.goal) {
        arrived = true;
        break;
      }
      nextIndex = this.following(nextIndex);
    }
    this.delta.subVectors(this.current, this.previous);
    const player = this.ctx.player;
    const riding = player.onGround
      && Math.abs(player.position.x - this.previous.x) <= this.def.size[0] * 0.5 + player.radius
      && Math.abs(player.position.z - this.previous.z) <= this.def.size[2] * 0.5 + player.radius
      && player.position.y >= this.previous.y - 0.35 && player.position.y <= this.previous.y + 0.65;
    if (riding) player.position.add(this.delta);
    this.root.position.copy(this.current);
    if (this.collision) {
      const box = this.collision;
      this.ctx.world.remove(box);
      const center = box.obb ? box.obb.center.clone() : new THREE.Vector3((box.minX + box.maxX) * 0.5, (box.minY + box.maxY) * 0.5, (box.minZ + box.maxZ) * 0.5);
      const size = box.obb ? box.obb.halfSize.clone().multiplyScalar(2) : new THREE.Vector3(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ);
      this.collision = this.ctx.world.addObb(center.add(this.delta), size, this.rotation, 'platform');
    }
    this.nextIndex = nextIndex;
    if (arrived) this.arrive();
  }

  private arrive(): void {
    this.current.copy(this.points[this.goal]);
    this.at = this.goal;
    this.moving = false;
    this.velocity = 0;
    this.idleTime = 0;
    this.holdUntilClear = this.rider();
  }

  private rider(): boolean {
    const p = this.ctx.player.position;
    return this.ctx.player.onGround
      && Math.abs(p.x - this.current.x) <= this.def.size[0] * 0.5 + this.ctx.player.radius
      && Math.abs(p.z - this.current.z) <= this.def.size[2] * 0.5 + this.ctx.player.radius
      && p.y >= this.current.y - 0.35 && p.y <= this.current.y + 0.65;
  }

  private ride(dt: number): void {
    if (this.rider()) {
      this.callTime = 0;
      if (this.holdUntilClear) return;
      this.standTime += dt;
      if (this.standTime >= this.def.departDelay) this.depart(this.otherEnd(this.at));
      return;
    }
    this.holdUntilClear = false;
    this.standTime = 0;
    const target = this.points[this.otherEnd(this.at)], player = this.ctx.player.position;
    if (Math.hypot(player.x - target.x, player.z - target.z) <= this.def.callRadius && Math.abs(player.y - target.y) <= 2.5) {
      this.callTime += dt;
      if (this.callTime >= this.def.callDelay) this.depart(this.otherEnd(this.at));
    } else this.callTime = 0;
  }
}
