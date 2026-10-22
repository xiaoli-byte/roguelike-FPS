/**
 * 游玩版的枪：自动步枪手感（9 发 / 秒、30 发弹匣、1.5 秒换弹），即时命中（射线对命中球 + 地形 / 建筑遮挡），
 * 连射扩散、后坐、枪口火光、弹道光迹。手里的枪是程序化的简模（正式武器在 Unity 版里）。
 */
import * as THREE from 'three';
import type { HitSphere, PlayCtx, Target } from './core';

export const GUN = { damage: 16, rate: 9, mag: 30, reload: 1.5, range: 260 };

export interface ShotResult { target: Target | null; mult: number; dealt: number; point: THREE.Vector3; killed: boolean }

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Gun {
  readonly view = new THREE.Group();
  ammo = GUN.mag;
  reloading = 0;
  private cool = 0;
  private bloom = 0;
  private kick = 0;
  private readonly flash: THREE.Mesh;
  private readonly muzzle = new THREE.Object3D();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    const metal = new THREE.MeshLambertMaterial({ color: '#2b2f36' });
    const wood = new THREE.MeshLambertMaterial({ color: '#7a4a2c' });
    const brass = new THREE.MeshLambertMaterial({ color: '#b58b3c', emissive: '#3a2a08' });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.view.add(mesh);
      return mesh;
    };
    box(0.07, 0.09, 0.42, metal, 0, 0, -0.1);
    box(0.06, 0.05, 0.22, wood, 0, -0.02, 0.18);
    box(0.045, 0.13, 0.06, wood, 0, -0.1, 0.06);
    box(0.04, 0.14, 0.07, metal, 0, -0.1, -0.1);
    box(0.075, 0.02, 0.3, brass, 0, 0.055, -0.12);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.36, 10).rotateX(Math.PI / 2), metal);
    barrel.position.set(0, 0.015, -0.45);
    this.view.add(barrel);
    this.muzzle.position.set(0, 0.015, -0.65);
    this.view.add(this.muzzle);
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe3a0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    this.view.add(this.flash);
    this.view.traverse(o => { o.renderOrder = 10; const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.depthTest = true; });
    this.view.scale.setScalar(0.42);
    this.view.position.set(0.19, -0.16, -0.42);
    camera.add(this.view);
  }

  startReload(): void {
    if (this.reloading > 0 || this.ammo === GUN.mag) return;
    this.reloading = GUN.reload;
  }

  /** firing：按住左键；返回这一帧打出去的每一发的结果 */
  update(dt: number, firing: boolean, ctx: PlayCtx, targets: readonly Target[]): ShotResult[] {
    const out: ShotResult[] = [];
    this.cool -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.05);
    this.kick = Math.max(0, this.kick - dt * 10);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this.ammo = GUN.mag; }
    } else if (firing && this.ammo > 0 && ctx.player.alive) {
      while (this.cool <= 0 && this.ammo > 0) {
        this.cool += 1 / GUN.rate;
        this.ammo--;
        out.push(this.fire(ctx, targets));
      }
    }
    if (this.ammo === 0 && this.reloading === 0) this.startReload();
    if (this.cool < 0) this.cool = 0;
    // 手里的枪：后坐、换弹时压低
    const r = this.reloading > 0 ? Math.sin((1 - this.reloading / GUN.reload) * Math.PI) : 0;
    this.view.position.set(0.19, -0.16 - r * 0.07, -0.42 + this.kick * 0.025);
    this.view.rotation.set(this.kick * 0.09 - r * 0.6, 0, r * 0.4);
    this.flash.visible = this.kick > 0.75;
    this.flash.scale.setScalar(0.7 + Math.random() * 0.6);
    return out;
  }

  private fire(ctx: PlayCtx, targets: readonly Target[]): ShotResult {
    this.kick = 1;
    this.bloom = Math.min(0.03, this.bloom + 0.0035);
    // 视角往上抖一点（轻后坐，射得爽为先）
    ctx.walker.pitch = Math.min(1.5, ctx.walker.pitch + 0.004);
    this.camera.getWorldPosition(_o);
    this.camera.getWorldDirection(_d);
    const spread = 0.004 + this.bloom;
    _d.x += (Math.random() - 0.5) * 2 * spread; _d.y += (Math.random() - 0.5) * 2 * spread; _d.z += (Math.random() - 0.5) * 2 * spread;
    _d.normalize();
    // 先找挡住的地形 / 建筑
    let tMax = GUN.range;
    for (let t = 0.5; t < GUN.range; t += 1) {
      _p.copy(_o).addScaledVector(_d, t);
      if (_p.y < ctx.terrain.heightAt(_p.x, _p.z) || ctx.world.solidAt(_p.x, _p.y, _p.z)) { tMax = Math.max(0.5, t - 0.5); break; }
    }
    let best: Target | null = null, bestT = tMax, bestKey = tMax, bestMult = 1;
    let bestS: HitSphere | undefined;
    for (const T of targets) {
      if (!T.alive) continue;
      for (const s of T.spheres()) {
        if (s.r <= 0) continue;
        // 射线与球：|o + t d - c| = r
        _m.subVectors(_o, s.c);
        const b = _m.dot(_d), c = _m.lengthSq() - s.r * s.r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        // 弱点和身体球重叠时弱点优先（弱点球多半嵌在身体球里）
        const key = t - (s.mult > 1 ? 0.35 : 0);
        if (t > 0 && t < tMax && key < bestKey) { best = T; bestT = t; bestKey = key; bestMult = s.mult; bestS = s; }
      }
    }
    const point = _o.clone().addScaledVector(_d, bestT);
    this.muzzle.getWorldPosition(_p);
    this.view.getWorldQuaternion(_q);
    ctx.fx.tracer(_p.clone(), point);
    let dealt = 0, killed = false;
    if (best) {
      const wasAlive = best.alive;
      const dmg = ctx.kit.bulletDamage(GUN.damage * ctx.player.dmgMul, best);
      dealt = best.hit(dmg, bestMult, point, { kind: 'bullet', sphere: bestS, from: _o.clone(), poise: bestMult > 1 ? 2 : 1 });
      killed = wasAlive && !best.alive;
      if (dealt > 0) ctx.kit.afterBullet(best, point, dealt);
      ctx.fx.spray(point, bestMult > 1 ? ['#ffe08a', '#ffffff'] : ['#ffd2a0'], bestMult > 1 ? 5 : 2, 2.5, 1, 8, 0.2);
    } else if (bestT < GUN.range) {
      ctx.fx.burst(point, 0.35, '#ffe6b0');
      ctx.fx.spray(point, ['#c8b89a', '#8a7a60'], 3, 2, 2, 12, 0.35);
    }
    return { target: best, mult: bestMult, dealt, point, killed };
  }
}
