/**
 * 游玩模式的战斗特效与投射物：弹道光迹、地面预警圈、落雷、冲击波环、爆闪、抛物线投石、直线弹。
 * 只管画面和「打没打中玩家」，伤害数值由出手的怪决定（回调里扣血）。
 */
import * as THREE from 'three';
import type { Terrain } from '../terrain';
import type { CollisionWorld } from '../walker';

const MAGENTA = '#ff4fd8';

interface Timed { t: number; life: number; tick(k: number, dt: number): void; done?(): void; obj: THREE.Object3D }
interface Projectile {
  mesh: THREE.Object3D; pos: THREE.Vector3; vel: THREE.Vector3; gravity: number; r: number; life: number;
  /** 碰到玩家或落地时调用；hitPlayer 表示直接打中 */
  onHit(at: THREE.Vector3, hitPlayer: boolean): void;
}

export class CombatFx {
  readonly group = new THREE.Group();
  private timed: Timed[] = [];
  private shots: Projectile[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
  private readonly discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly sphereGeo = new THREE.SphereGeometry(1, 16, 10);
  private readonly boltGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  private readonly tracerMat = new THREE.LineBasicMaterial({ color: '#fff2c4', transparent: true, opacity: 0.9, depthWrite: false });

  constructor(scene: THREE.Scene, private readonly terrain: Terrain, private readonly world: CollisionWorld) {
    this.group.name = 'combat-fx';
    scene.add(this.group);
  }

  ground(x: number, z: number): number {
    return Math.max(this.terrain.heightAt(x, z), this.terrain.waterLevelAt(x, z));
  }

  private add(obj: THREE.Object3D, life: number, tick: Timed['tick'], done?: () => void): void {
    this.group.add(obj);
    this.timed.push({ t: 0, life, tick, done, obj });
  }

  private additive(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  /** 枪口到命中点的一道光迹 */
  tracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.add(line, 0.06, (k) => { (line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - k); }, () => g.dispose());
  }

  /** 地面预警圈：外圈先出现，里面的实心圆在 delay 秒内涨满，然后 onFire() */
  telegraph(x: number, z: number, r: number, delay: number, onFire: () => void, color: THREE.ColorRepresentation = MAGENTA): void {
    const y = this.ground(x, z) + 0.12;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const ring = new THREE.Mesh(this.ringGeo, this.additive(color, 0.9));
    const disc = new THREE.Mesh(this.discGeo, this.additive(color, 0.25));
    ring.scale.setScalar(r);
    g.add(ring, disc);
    this.add(g, delay, (k) => { disc.scale.setScalar(Math.max(0.01, r * k)); (disc.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.25 * k; }, onFire);
  }

  /** 落雷画面：从高空劈下的一道光柱 + 地面爆闪 */
  bolt(x: number, z: number, color: THREE.ColorRepresentation = '#ffd6fb'): void {
    const y = this.ground(x, z);
    const core = new THREE.Mesh(this.boltGeo, this.additive('#ffffff'));
    const glow = new THREE.Mesh(this.boltGeo, this.additive(color, 0.5));
    core.scale.set(0.35, 160, 0.35); glow.scale.set(1.4, 160, 1.4);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.add(core, glow);
    this.add(g, 0.22, (k) => { g.visible = k < 0.4 || (k > 0.55 && k < 0.8); });
    this.burst(new THREE.Vector3(x, y + 0.5, z), 3.2, color);
  }

  /** 爆闪：一个迅速长大、淡出的发光球 */
  burst(at: THREE.Vector3, r: number, color: THREE.ColorRepresentation = '#ffd2f3'): void {
    const m = new THREE.Mesh(this.sphereGeo, this.additive(color, 0.8));
    m.position.copy(at);
    this.add(m, 0.35, (k) => { m.scale.setScalar(r * (0.3 + 0.7 * k)); (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k); });
  }

  /** 冲击波：贴地扩散的环，onTick(当前半径) 每帧回调（拿来判定玩家被扫到没有） */
  shockwave(x: number, z: number, maxR: number, dur: number, onTick?: (r: number) => void, color: THREE.ColorRepresentation = '#ffb5f0'): void {
    const y = this.ground(x, z) + 0.25;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 64).rotateX(Math.PI / 2), this.additive(color, 0.9));
    ring.position.set(x, y, z);
    this.add(ring, dur, (k) => {
      const r = 0.5 + maxR * k;
      ring.scale.set(r, 1 + 2 * (1 - k), r);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k * k);
      onTick?.(r);
    }, () => ring.geometry.dispose());
  }

  /** 抛物线投射物：flight 秒后落到 to；落点提前出预警圈 */
  lob(from: THREE.Vector3, to: THREE.Vector3, flight: number, mesh: THREE.Object3D, splash: number, onLand: (at: THREE.Vector3) => void): void {
    const g = 26;
    const vel = new THREE.Vector3((to.x - from.x) / flight, (to.y - from.y + 0.5 * g * flight * flight) / flight, (to.z - from.z) / flight);
    mesh.position.copy(from);
    this.group.add(mesh);
    this.telegraph(to.x, to.z, splash, flight * 0.95, () => {}, '#ff8a3a');
    this.shots.push({ mesh, pos: from.clone(), vel, gravity: g, r: 0, life: flight + 2, onHit: (at) => onLand(at) });
  }

  /** 直线弹：碰到玩家（r 内）或地形 / 建筑就停 */
  shot(from: THREE.Vector3, vel: THREE.Vector3, r: number, color: THREE.ColorRepresentation, onHit: (at: THREE.Vector3, hitPlayer: boolean) => void, gravity = 0): void {
    const mesh = new THREE.Mesh(this.sphereGeo, this.additive(color, 0.95));
    mesh.scale.setScalar(Math.max(0.25, r));
    mesh.position.copy(from);
    this.group.add(mesh);
    this.shots.push({ mesh, pos: from.clone(), vel: vel.clone(), gravity, r, life: 4, onHit });
  }

  /** player：玩家身体的球心和半径（用来判定直线弹命中） */
  update(dt: number, player: THREE.Vector3, playerR: number): void {
    for (const T of this.timed) {
      T.t += dt;
      T.tick(Math.min(1, T.t / T.life), dt);
    }
    this.timed = this.timed.filter(T => {
      if (T.t < T.life) return true;
      this.group.remove(T.obj);
      T.done?.();
      return false;
    });
    this.shots = this.shots.filter(S => {
      S.life -= dt;
      S.vel.y -= S.gravity * dt;
      S.pos.addScaledVector(S.vel, dt);
      S.mesh.position.copy(S.pos);
      S.mesh.rotation.x += dt * 4;
      let hit: boolean | null = null;
      if (S.r > 0 && S.pos.distanceTo(player) < S.r + playerR) hit = true;
      else if (S.pos.y <= this.ground(S.pos.x, S.pos.z) || this.world.solidAt(S.pos.x, S.pos.y, S.pos.z) || S.life <= 0) hit = false;
      if (hit === null) return true;
      this.group.remove(S.mesh);
      S.onHit(S.pos.clone(), hit);
      return false;
    });
  }

  /** 玩家倒下重来时清掉场上所有投射物和预警 */
  clear(): void {
    for (const T of this.timed) this.group.remove(T.obj);
    for (const S of this.shots) this.group.remove(S.mesh);
    this.timed = [];
    this.shots = [];
  }
}

/** 举父的雷石：裂着紫红雷纹的石块 */
export function boulderMesh(r = 0.7): THREE.Object3D {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshLambertMaterial({ color: '#5e5650', flatShading: true }));
  const vein = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.03, 0), new THREE.MeshBasicMaterial({ color: MAGENTA, wireframe: true }));
  rock.castShadow = true;
  g.add(rock, vein);
  return g;
}
