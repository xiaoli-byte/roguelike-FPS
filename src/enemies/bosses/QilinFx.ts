/**
 * 火麒麟的特效（每个首领实例一份，挂 ctx.stageGroup，首领释放时整体移除并释放）。全部是实例化网格，各一次绘制：
 *  - 蹄印火：踏火奔驰时每一步在地上留一个燃烧的蹄印（4 秒），玩家踩到会被烧（伤害由首领按 printNear 结算）；
 *  - 鳞刃：张鳞时 360° 射出的一圈红热鳞片（竖立的薄片，贴地 0.2–2.4 米高），撞到石柱 / 墙就碎（首领给的 resolver 判定）；
 *  - 火焰粒子：吐息火流、蹄下火云、饮熔时从熔池吸进嘴里的熔岩流、鳞甲炸飞的碎鳞火星（emit 通用发射）；
 *  - 熔岩柱：饮熔 / 坠鼎 / 化形时熔池里冲天的熔岩柱（eruption(k) 控制高度与亮度），化形时用它盖住换模型。
 * 所有网格常驻场景、不用时缩放为 0：着色器在登场时就编译好。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';

const MAX_PRINTS = 64;
const PRINT_LIFE = 4;
const MAX_BLADES = 96;
const MAX_FLAMES = 260;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Print { x: number; z: number; yaw: number; age: number }
export interface Blade {
  readonly pos: THREE.Vector3;
  readonly prev: THREE.Vector3;
  readonly dir: THREE.Vector3;
  speed: number;
  travelled: number;
  range: number;
  alive: boolean;
}
interface Flame { pos: THREE.Vector3; vel: THREE.Vector3; age: number; life: number; size: number; color: number; drag: number; rise: number }

/** 鳞刃落点判定：返回 'hit' 打中玩家（鳞刃碎掉）、'block' 撞到掩体（碎掉），null 继续飞 */
export type BladeResolver = (b: Blade) => 'hit' | 'block' | null;

export class QilinFx {
  readonly group = new THREE.Group();
  private readonly prints: Print[] = [];
  private readonly printMesh: THREE.InstancedMesh;
  private readonly blades: Blade[] = [];
  private readonly bladeMesh: THREE.InstancedMesh;
  private readonly flames: Flame[] = [];
  private readonly flameMesh: THREE.InstancedMesh;
  private readonly column: THREE.Mesh;
  private readonly columnMat: THREE.MeshBasicMaterial;
  private readonly columnCore: THREE.Mesh;
  private readonly columnCoreMat: THREE.MeshBasicMaterial;
  private columnK = 0;
  private columnWant = 0;
  private age = 0;
  private readonly floorY: number;

  constructor(private readonly ctx: GameContext, private readonly poolCenter: THREE.Vector3, private readonly poolRadius: number) {
    this.group.name = 'qilin-fx';
    this.floorY = poolCenter.y;
    // 蹄印：压扁的八边形火斑（加法混合）
    const printGeo = new THREE.CircleGeometry(0.55, 8);
    printGeo.rotateX(-Math.PI / 2);
    const printMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.printMesh = new THREE.InstancedMesh(printGeo, printMat, MAX_PRINTS);
    this.printMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PRINTS * 3), 3);
    this.printMesh.frustumCulled = false;
    this.printMesh.renderOrder = 1;
    for (let i = 0; i < MAX_PRINTS; i++) this.printMesh.setMatrixAt(i, ZERO);
    this.group.add(this.printMesh);
    // 鳞刃：竖立的菱形薄片（自发光，红热）
    const bladeGeo = new THREE.OctahedronGeometry(1, 0);
    bladeGeo.scale(0.55, 1.15, 0.09);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2a1a12, emissive: 0xff5a14, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.6 });
    this.bladeMesh = new THREE.InstancedMesh(bladeGeo, bladeMat, MAX_BLADES);
    this.bladeMesh.frustumCulled = false;
    for (let i = 0; i < MAX_BLADES; i++) this.bladeMesh.setMatrixAt(i, ZERO);
    this.group.add(this.bladeMesh);
    // 火焰粒子
    const flameGeo = new THREE.OctahedronGeometry(1, 0);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.flameMesh = new THREE.InstancedMesh(flameGeo, flameMat, MAX_FLAMES);
    this.flameMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 3), 3);
    this.flameMesh.frustumCulled = false;
    this.flameMesh.renderOrder = 2;
    for (let i = 0; i < MAX_FLAMES; i++) this.flameMesh.setMatrixAt(i, ZERO);
    this.group.add(this.flameMesh);
    // 熔岩柱：两层开口圆柱（外层橙红半透明，内层黄白芯）
    this.columnMat = new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.25, 1, 18, 1, true), this.columnMat);
    this.columnCoreMat = new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.columnCore = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 1, 14, 1, true), this.columnCoreMat);
    for (const c of [this.column, this.columnCore]) {
      c.frustumCulled = false;
      c.position.copy(poolCenter);
      c.scale.set(0.001, 0.001, 0.001);
      this.group.add(c);
    }
    ctx.stageGroup.add(this.group);
  }

  // ───────────── 蹄印 ─────────────

  hoofprint(x: number, z: number, yaw: number): void {
    if (this.prints.length >= MAX_PRINTS) this.prints.shift();
    this.prints.push({ x, z, yaw, age: 0 });
  }

  /** (x, z) 半径 r 内有没有还在烧的蹄印 */
  printNear(x: number, z: number, r: number): boolean {
    for (const p of this.prints) if (p.age < PRINT_LIFE - 0.3 && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true;
    return false;
  }

  get printCount(): number { return this.prints.length; }

  clearPrints(): void { this.prints.length = 0; }

  // ───────────── 鳞刃 ─────────────

  /** 以 origin 为圆心射出一圈 count 片鳞刃（offset：起始角偏移，弧度） */
  fireRing(origin: THREE.Vector3, count: number, offset: number, speed: number, range: number, startR = 2.2): number {
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (this.blades.filter((b) => b.alive).length >= MAX_BLADES) break;
      const a = offset + (i / count) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const pos = origin.clone().addScaledVector(dir, startR);
      pos.y = this.floorY + 1.3;
      const free = this.blades.find((b) => !b.alive);
      if (free) {
        free.pos.copy(pos); free.prev.copy(pos); free.dir.copy(dir);
        free.speed = speed; free.travelled = 0; free.range = range; free.alive = true;
      } else {
        this.blades.push({ pos, prev: pos.clone(), dir, speed, travelled: 0, range, alive: true });
      }
      n++;
    }
    return n;
  }

  get liveBlades(): number { return this.blades.filter((b) => b.alive).length; }

  clearBlades(): void { for (const b of this.blades) b.alive = false; }

  // ───────────── 火焰粒子 ─────────────

  /** 发射一个火焰粒子（速度 vel，寿命 life 秒，大小 size 米） */
  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: number, drag = 1.5, rise = 2): void {
    let f: Flame | undefined;
    if (this.flames.length < MAX_FLAMES) {
      f = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life, size, color, drag, rise };
      this.flames.push(f);
    } else {
      // 满了：复用最老的
      let oldest = this.flames[0];
      for (const x of this.flames) if (x.age / x.life > oldest.age / oldest.life) oldest = x;
      f = oldest;
    }
    f.pos.copy(pos);
    f.vel.copy(vel);
    f.age = 0; f.life = life; f.size = size; f.color = color; f.drag = drag; f.rise = rise;
  }

  /** 吐息火流：从 from 沿 dir 喷出 n 个粒子（锥角 spread） */
  breath(from: THREE.Vector3, dir: THREE.Vector3, speed: number, spread: number, n: number): void {
    for (let i = 0; i < n; i++) {
      _p.set(dir.x + (Math.random() - 0.5) * spread, dir.y + (Math.random() - 0.5) * spread * 0.5, dir.z + (Math.random() - 0.5) * spread).normalize();
      _s.copy(_p).multiplyScalar(speed * (0.8 + Math.random() * 0.4));
      this.emit(from, _s, 0.55 + Math.random() * 0.35, 0.35 + Math.random() * 0.35, Math.random() < 0.3 ? 0xffd070 : 0xff6a1a, 0.6, 1.5);
    }
  }

  // ───────────── 熔岩柱 ─────────────

  /** 熔池里的熔岩柱，k 0 → 1（高度与亮度，平滑过去） */
  eruption(k: number): void {
    this.columnWant = Math.max(0, Math.min(1, k));
  }

  // ───────────── 每帧 ─────────────

  update(dt: number, resolver: BladeResolver | null): void {
    this.age += dt;
    // 蹄印
    let n = 0;
    for (let i = this.prints.length - 1; i >= 0; i--) {
      const p = this.prints[i];
      p.age += dt;
      if (p.age >= PRINT_LIFE) this.prints.splice(i, 1);
    }
    for (const p of this.prints) {
      const k = p.age / PRINT_LIFE;
      const s = (0.9 + 0.15 * Math.sin(this.age * 9 + p.x)) * (k < 0.08 ? k / 0.08 : 1);
      _q.setFromAxisAngle(UP, p.yaw);
      _m.compose(_p.set(p.x, this.floorY + 0.05, p.z), _q, _s.set(s * 0.8, 1, s * 1.15));
      this.printMesh.setMatrixAt(n, _m);
      const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      this.printMesh.setColorAt(n, _c.setHex(0xff5a14).multiplyScalar(0.55 + 0.45 * fade * (0.85 + 0.15 * Math.sin(this.age * 13 + p.z))));
      n++;
      // 蹄印上冒火苗
      if (Math.random() < dt * 5) {
        _s.set((Math.random() - 0.5) * 0.4, 1.4 + Math.random(), (Math.random() - 0.5) * 0.4);
        this.emit(_p.set(p.x, this.floorY + 0.1, p.z), _s, 0.5, 0.18, 0xff8a2a, 1, 2);
      }
    }
    for (let i = n; i < MAX_PRINTS; i++) this.printMesh.setMatrixAt(i, ZERO);
    this.printMesh.count = MAX_PRINTS;
    this.printMesh.instanceMatrix.needsUpdate = true;
    if (this.printMesh.instanceColor) this.printMesh.instanceColor.needsUpdate = true;

    // 鳞刃
    let b = 0;
    for (const bl of this.blades) {
      if (!bl.alive) continue;
      bl.prev.copy(bl.pos);
      const step = bl.speed * dt;
      bl.pos.addScaledVector(bl.dir, step);
      bl.travelled += step;
      const r = resolver ? resolver(bl) : null;
      if (r || bl.travelled >= bl.range) {
        bl.alive = false;
        if (r) {
          this.ctx.fx.burst(bl.pos, 0xff8a3a, r === 'hit' ? 10 : 6, 5, 0.4, 0.15, 10);
        }
        continue;
      }
      _q.setFromUnitVectors(_s.set(0, 0, 1), bl.dir);
      // 薄片面朝飞行方向，略微旋转
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(_s.set(0, 0, 1), Math.sin(this.age * 20 + bl.travelled) * 0.15));
      _m.compose(bl.pos, _q, _p.set(1, 1, 1));
      this.bladeMesh.setMatrixAt(b++, _m);
    }
    for (let i = b; i < MAX_BLADES; i++) this.bladeMesh.setMatrixAt(i, ZERO);
    this.bladeMesh.instanceMatrix.needsUpdate = true;

    // 火焰粒子
    let f = 0;
    for (const fl of this.flames) {
      fl.age += dt;
      if (fl.age >= fl.life) { this.flameMesh.setMatrixAt(f, ZERO); this.flameMesh.setColorAt(f, _c.setRGB(0, 0, 0)); f++; continue; }
      const damp = Math.exp(-fl.drag * dt);
      fl.vel.multiplyScalar(damp);
      fl.vel.y += fl.rise * dt;
      fl.pos.addScaledVector(fl.vel, dt);
      const k = fl.age / fl.life;
      const s = fl.size * (k < 0.15 ? 0.5 + k / 0.3 : 1 + k * 0.8) * (1 - k * 0.5);
      _q.setFromAxisAngle(UP, fl.age * 6 + fl.size * 10);
      _m.compose(fl.pos, _q, _s.set(s, s * 1.3, s));
      this.flameMesh.setMatrixAt(f, _m);
      const fade = 1 - k;
      this.flameMesh.setColorAt(f, _c.setHex(fl.color).multiplyScalar(fade * fade));
      f++;
    }
    for (let i = f; i < MAX_FLAMES; i++) this.flameMesh.setMatrixAt(i, ZERO);
    this.flameMesh.instanceMatrix.needsUpdate = true;
    if (this.flameMesh.instanceColor) this.flameMesh.instanceColor.needsUpdate = true;

    // 熔岩柱
    this.columnK += (this.columnWant - this.columnK) * Math.min(1, dt * (this.columnWant > this.columnK ? 7 : 2.2));
    const ck = this.columnK;
    const h = 1 + 26 * ck;
    const rad = this.poolRadius * (0.35 + 0.35 * ck);
    this.column.scale.set(ck > 0.005 ? rad : 0.001, h, ck > 0.005 ? rad : 0.001);
    this.column.position.set(this.poolCenter.x, this.floorY + h / 2 - 0.5, this.poolCenter.z);
    this.column.rotation.y += dt * 1.5;
    this.columnMat.opacity = 0.55 * ck * (0.85 + 0.15 * Math.sin(this.age * 17));
    this.columnCore.scale.set(ck > 0.005 ? rad * 0.6 : 0.001, h * 0.92, ck > 0.005 ? rad * 0.6 : 0.001);
    this.columnCore.position.copy(this.column.position);
    this.columnCoreMat.opacity = 0.75 * ck;
    if (ck > 0.05 && Math.random() < dt * 30 * ck) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * rad;
      _s.set(Math.sin(a) * 4, 6 + Math.random() * 10 * ck, Math.cos(a) * 4);
      this.emit(_p.set(this.poolCenter.x + Math.sin(a) * r, this.floorY + 0.5, this.poolCenter.z + Math.cos(a) * r), _s, 1.2, 0.5 + Math.random() * 0.5, Math.random() < 0.4 ? 0xffd070 : 0xff5a14, 0.4, -6);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.printMesh.geometry.dispose();
    (this.printMesh.material as THREE.Material).dispose();
    this.printMesh.dispose();
    this.bladeMesh.geometry.dispose();
    (this.bladeMesh.material as THREE.Material).dispose();
    this.bladeMesh.dispose();
    this.flameMesh.geometry.dispose();
    (this.flameMesh.material as THREE.Material).dispose();
    this.flameMesh.dispose();
    this.column.geometry.dispose();
    this.columnMat.dispose();
    this.columnCore.geometry.dispose();
    this.columnCoreMat.dispose();
  }
}
