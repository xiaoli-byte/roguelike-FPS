/**
 * 祝融炉心殿的吊鼎与四条巨链（火麒麟的首领道具，挂 ctx.stageGroup，首领释放时整体移除）。程序化 v1：
 * 一口约 7.5 米高的青铜方鼎（四足、双耳、鼎口一汪熔岩），吊在中央熔池正上方，四个角各拴一条巨链斜拉到外墙的锁扣
 * （QilinLock，在象限中线上）。三种状态：
 *  - 吊着（hang）：轻轻摆动；
 *  - 一角坠下（corner）：某个锁扣被打碎，那条链崩飞，鼎朝那一角倾倒、角足斜砸在池沿上（dropCorner 返回撞击点，
 *    撞击时刻回调 onImpact）。之后再断一角，鼎改朝新的一角倾倒；
 *  - 坠池（fallen）：55% 时剩下的链全断，鼎整个砸进熔池、翻倒半露（fall），落定时回调 onImpact 并加一个碰撞盒——
 *    二阶段它是池中挡吐息的掩体（盒子在熔池里，不影响导航）。
 * 美术版以后可以由场景套件管线出一个模型替换这里的程序化几何（三态与接口不变）。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { StaticBox } from '../../world/Collision';
import type { Furnace } from './QilinArena';
import { geo, glow, mesh, std } from './parts';

/** 鼎身半宽、半高；足长；吊着时鼎身中心离地多高 */
const HALF = 2.6;
const HALF_Y = 1.8;
const LEG = 2.4;
const HANG_Y = 13.2;
/** 角足在鼎身局部的位置（角往里收一点） */
const LEG_IN = HALF - 0.45;
const LINKS = 44;
/** 链节间距：按最长的链平均分布 */
const TILT_CORNER = 0.6;
const TILT_FALLEN = 1.15;

type ChainState = 'taut' | 'falling' | 'gone';

interface Chain {
  state: ChainState;
  t: number;
  /** 锁扣端（世界） */
  readonly lock: THREE.Vector3;
  /** 崩飞时每个链节的散开方向 */
  readonly scatter: Float32Array;
  readonly from: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export type CauldronState = 'hang' | 'corner' | 'falling' | 'fallen';

export class QilinCauldron {
  readonly group = new THREE.Group();
  state: CauldronState = 'hang';
  /** 坠下的那一角（corner 状态） */
  droppedCorner = -1;
  /** 撞击回调：一角砸在池沿 / 整口鼎砸进熔池（世界坐标撞击点） */
  onImpact: ((kind: 'corner' | 'fallen', at: THREE.Vector3) => void) | null = null;
  private readonly ding = new THREE.Group();
  private readonly links: THREE.InstancedMesh;
  private readonly chains: Chain[] = [];
  private readonly yaw0: number;
  /** 局部的四个角方向（与 furnace.quadrants 同序） */
  private readonly cornerDirs: THREE.Vector3[] = [];
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQ = new THREE.Quaternion();
  private readonly toPos = new THREE.Vector3();
  private readonly toQ = new THREE.Quaternion();
  private readonly restPos = new THREE.Vector3();
  private readonly restQ = new THREE.Quaternion();
  private readonly impact = new THREE.Vector3();
  private moveT = 1;
  private moveDur = 0.6;
  private age = 0;
  private sway = 0;
  private box: StaticBox | null = null;
  private readonly molten: THREE.Mesh;
  private readonly moltenMat: THREE.MeshBasicMaterial;
  private dirty = true;

  constructor(private readonly ctx: GameContext, private readonly furnace: Furnace, lockPoints: readonly THREE.Vector3[]) {
    this.group.name = 'qilin-cauldron';
    const bronze = std(0x5a4422, { emissive: 0x2a1204, ei: 0.35, rough: 0.5, metal: 0.65 });
    const verdigris = std(0x3e5040, { emissive: 0x101808, ei: 0.2, rough: 0.7, metal: 0.4 });
    const dark = std(0x2a2018, { rough: 0.6, metal: 0.5 });
    const D = this.ding;
    D.name = 'ding';
    // 鼎身：上宽下略收的方体 + 口沿 + 腰箍 + 饕餮纹（四面各一块凸起）
    const body = mesh(D, geo.cyl(HALF * Math.SQRT2, HALF * Math.SQRT2 * 0.9, HALF_Y * 2, 4), bronze, 0, 0, 0, 0, Math.PI / 4, 0);
    body.castShadow = true;
    mesh(D, geo.box(HALF * 2 + 0.5, 0.35, HALF * 2 + 0.5), dark, 0, HALF_Y - 0.1, 0);
    mesh(D, geo.box(HALF * 2 + 0.15, 0.25, HALF * 2 + 0.15), verdigris, 0, -0.4, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const face = mesh(D, geo.box(1.6, 1.1, 0.25), verdigris, Math.sin(a) * (HALF + 0.05), 0.35, Math.cos(a) * (HALF + 0.05), 0, a, 0);
      face.castShadow = false;
    }
    // 双耳
    for (const s of [-1, 1]) {
      const ear = mesh(D, geo.torus(0.7, 0.18, 6, 10), dark, s * (HALF - 0.7), HALF_Y + 0.75, 0, 0, Math.PI / 2, 0);
      ear.scale.set(1, 1.2, 1);
    }
    // 四足（在角上）
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      mesh(D, geo.cyl(0.38, 0.3, LEG, 6), dark, sx * LEG_IN, -HALF_Y - LEG / 2 + 0.2, sz * LEG_IN);
      mesh(D, geo.sphere(0.45, 7, 5), bronze, sx * LEG_IN, -HALF_Y - 0.1, sz * LEG_IN);
    }
    // 鼎口的一汪熔岩
    this.moltenMat = glow(0xff6a1a).clone();
    this.molten = mesh(D, geo.box(HALF * 2 - 0.3, 0.05, HALF * 2 - 0.3), this.moltenMat, 0, HALF_Y - 0.15, 0);
    this.molten.castShadow = false;
    this.group.add(D);

    // 鼎的四个角朝四个象限中线（锁扣方向）：局部角方向 (±1, ±1)/√2，整体绕 Y 转 yaw0
    this.yaw0 = (furnace.quadrants[0] ?? Math.PI / 4) - Math.PI / 4;
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, z]) => new THREE.Vector3(x, 0, z).normalize());
    for (let i = 0; i < furnace.quadrants.length; i++) {
      // 找出转过 yaw0 之后最接近象限 i 的那个局部角
      const q = furnace.quadrants[i];
      let best = corners[0], bestD = Infinity;
      for (const c of corners) {
        const a = Math.atan2(c.x, c.z) + this.yaw0;
        const d = Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q)));
        if (d < bestD) { bestD = d; best = c; }
      }
      this.cornerDirs.push(best.clone());
    }
    const C = furnace.center;
    this.restPos.set(C.x, C.y + HANG_Y, C.z);
    this.restQ.setFromAxisAngle(UP, this.yaw0);
    this.ding.position.copy(this.restPos);
    this.ding.quaternion.copy(this.restQ);
    this.fromPos.copy(this.restPos);
    this.toPos.copy(this.restPos);
    this.fromQ.copy(this.restQ);
    this.toQ.copy(this.restQ);

    // 巨链：所有链节一个实例化网格
    const linkMat = std(0x2a2422, { emissive: 0x501808, ei: 0.35, rough: 0.55, metal: 0.7 });
    const n = lockPoints.length * LINKS;
    this.links = new THREE.InstancedMesh(geo.torus(0.3, 0.09, 5, 10), linkMat, Math.max(1, n));
    this.links.name = 'qilin-chains';
    this.links.frustumCulled = false;
    this.links.castShadow = false;
    this.group.add(this.links);
    for (let i = 0; i < lockPoints.length; i++) {
      const scatter = new Float32Array(LINKS * 3);
      for (let k = 0; k < LINKS; k++) {
        const a = (k * 2.399 + i) % (Math.PI * 2);
        scatter[k * 3] = Math.sin(a) * (1 + (k % 5) * 0.4);
        scatter[k * 3 + 1] = 2 + (k % 3);
        scatter[k * 3 + 2] = Math.cos(a) * (1 + (k % 4) * 0.4);
      }
      this.chains.push({ state: 'taut', t: 0, lock: lockPoints[i].clone().add(new THREE.Vector3(0, 1.05, 0)), scatter, from: new THREE.Vector3() });
    }
    ctx.stageGroup.add(this.group);
    this.update(0);
  }

  /** 链 i 还拴着 */
  chainIntact(i: number): boolean {
    return this.chains[i]?.state === 'taut';
  }

  /** 拴着的链数 */
  intactCount(): number {
    let n = 0;
    for (const c of this.chains) if (c.state === 'taut') n++;
    return n;
  }

  /** 鼎角 i 的足尖（世界坐标，当前姿势） */
  cornerTip(i: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.cornerDirs[i] ?? this.cornerDirs[0];
    out.set(d.x * LEG_IN * Math.SQRT2, -HALF_Y - LEG + 0.2, d.z * LEG_IN * Math.SQRT2);
    this.ding.updateMatrixWorld(true);
    return this.ding.localToWorld(out);
  }

  /** 鼎角 i 的链环（世界坐标，当前姿势） */
  private anchor(i: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.cornerDirs[i] ?? this.cornerDirs[0];
    out.set(d.x * HALF * Math.SQRT2 * 0.98, HALF_Y, d.z * HALF * Math.SQRT2 * 0.98);
    return this.ding.localToWorld(out);
  }

  /**
   * 锁扣 i 碎了：那条链崩飞，鼎朝那一角倾倒，角足斜砸在池沿上。返回撞击点（池沿，离地约 1 米）。
   * 鼎已经坠池时什么也不做（返回 null）。
   */
  dropCorner(i: number): THREE.Vector3 | null {
    if (this.state === 'falling' || this.state === 'fallen') return null;
    const ch = this.chains[i];
    if (!ch || ch.state !== 'taut') return null;
    this.snap(i);
    const f = this.furnace;
    const ang = f.quadrants[i];
    const D = _d.set(Math.sin(ang), 0, Math.cos(ang));
    // 目标姿势：先转到吊着的朝向，再绕 (up × D) 倾斜 TILT_CORNER（D 一侧朝下）
    _a.set(D.z, 0, -D.x).normalize();
    this.toQ.setFromAxisAngle(_a, TILT_CORNER).multiply(this.restQ);
    // 平移：让那一角的足尖正好落在池沿撞击点
    this.impact.set(f.center.x + D.x * (f.pool + 0.6), f.center.y + 1.0, f.center.z + D.z * (f.pool + 0.6));
    const dir = this.cornerDirs[i];
    _p.set(dir.x * LEG_IN * Math.SQRT2, -HALF_Y - LEG + 0.2, dir.z * LEG_IN * Math.SQRT2).applyQuaternion(this.toQ);
    this.toPos.copy(this.impact).sub(_p);
    this.beginMove(0.55);
    this.state = 'corner';
    this.droppedCorner = i;
    return this.impact.clone();
  }

  /** 剩下的链全断，鼎整个砸进熔池（翻倒、半露），落定后成为掩体 */
  fall(): void {
    if (this.state === 'falling' || this.state === 'fallen') return;
    for (let i = 0; i < this.chains.length; i++) if (this.chains[i].state === 'taut') this.snap(i);
    const f = this.furnace;
    const side = this.droppedCorner >= 0 ? f.quadrants[this.droppedCorner] : (f.quadrants[0] ?? 0);
    _a.set(Math.cos(side), 0, -Math.sin(side)).normalize();
    this.toQ.setFromAxisAngle(_a, TILT_FALLEN).multiply(this.restQ);
    _q2.setFromAxisAngle(UP, 0.5);
    this.toQ.premultiply(_q2);
    this.toPos.set(f.center.x, f.center.y + 0.6, f.center.z);
    this.impact.copy(this.toPos);
    this.beginMove(1.05);
    this.state = 'falling';
  }

  private beginMove(dur: number): void {
    this.fromPos.copy(this.ding.position);
    this.fromQ.copy(this.ding.quaternion);
    this.moveT = 0;
    this.moveDur = dur;
    this.sway = 0;
  }

  private snap(i: number): void {
    const ch = this.chains[i];
    if (!ch || ch.state !== 'taut') return;
    this.anchor(i, ch.from);
    ch.state = 'falling';
    ch.t = 0;
    // 断链：锁扣处火星，链节崩飞
    this.ctx.fx.burst(ch.lock, 0xffb050, 22, 9, 0.7, 0.25, 12);
    this.ctx.fx.burst(ch.from, 0xffb050, 16, 7, 0.7, 0.25, 12);
    this.ctx.audio.play('shield_break', { position: ch.lock, pitch: 0.5, volume: 0.9 });
  }

  update(dt: number): void {
    this.age += dt;
    // 鼎的姿势：移动中加速下落（ease-in），落定后余摆衰减
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / this.moveDur);
      const e = this.moveT * this.moveT;
      this.ding.position.lerpVectors(this.fromPos, this.toPos, e);
      this.ding.quaternion.slerpQuaternions(this.fromQ, this.toQ, e);
      if (this.moveT >= 1) {
        if (this.state === 'falling') this.land();
        else this.onImpact?.('corner', this.impact);
        this.sway = 1;
      }
      this.dirty = true;
    } else if (this.state !== 'fallen') {
      // 吊着 / 斜挂：轻轻摆
      this.sway = Math.max(0.12, this.sway - dt * 0.6);
      const w = Math.sin(this.age * 1.3) * 0.025 * this.sway * (this.state === 'corner' ? 2 : 1);
      _q.setFromAxisAngle(_a.set(1, 0, 0), w);
      this.ding.quaternion.copy(this.toQ).premultiply(_q);
      this.dirty = true;
    }
    this.moltenMat.color.setHex(0xff6a1a).multiplyScalar(0.8 + 0.2 * Math.sin(this.age * 3));
    this.updateChains(dt);
  }

  private land(): void {
    this.state = 'fallen';
    // 翻倒半露的鼎：池中掩体（挡吐息、挡视线），盒子在熔池里
    const C = this.furnace.center;
    const h = HALF * 0.95;
    this.box = this.ctx.world.addBox(C.x - h, C.y - 1, C.z - h, C.x + h, C.y + 4.4, C.z + h, 'qilin_cauldron');
    this.moltenMat.color.setHex(0x000000);
    this.molten.visible = false;
    this.onImpact?.('fallen', this.impact);
  }

  private updateChains(dt: number): void {
    let i = 0;
    for (let c = 0; c < this.chains.length; c++) {
      const ch = this.chains[c];
      if (ch.state === 'falling') {
        ch.t += dt;
        if (ch.t > 1.6) ch.state = 'gone';
        this.dirty = true;
      }
      if (ch.state === 'gone') {
        for (let k = 0; k < LINKS; k++) this.links.setMatrixAt(i++, ZERO);
        continue;
      }
      if (!this.dirty) { i += LINKS; continue; }
      const from = ch.state === 'taut' ? this.anchor(c, _p) : _p.copy(ch.from);
      _d.subVectors(ch.lock, from);
      const len = _d.length();
      _d.multiplyScalar(1 / Math.max(1e-6, len));
      _q.setFromUnitVectors(UP, _d);
      const t = ch.t;
      for (let k = 0; k < LINKS; k++) {
        const u = (k + 0.5) / LINKS;
        _s.copy(from).addScaledVector(_d, len * u);
        // 微微下垂
        _s.y -= Math.sin(u * Math.PI) * len * 0.035;
        let scale = 1;
        if (ch.state === 'falling') {
          _s.x += ch.scatter[k * 3] * t;
          _s.y += ch.scatter[k * 3 + 1] * t - 9 * t * t;
          _s.z += ch.scatter[k * 3 + 2] * t;
          scale = Math.max(0, 1 - t / 1.6);
        }
        _q2.setFromAxisAngle(_d, k % 2 ? Math.PI / 2 : 0).multiply(_q);
        _m.compose(_s, _q2, _a.set(scale, scale * 1.5, scale));
        this.links.setMatrixAt(i++, _m);
      }
    }
    if (this.dirty) this.links.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }

  /** 鼎当前的世界包围中心（特效用） */
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.ding.position);
  }

  dispose(): void {
    if (this.box) this.ctx.world.remove(this.box);
    this.box = null;
    this.group.removeFromParent();
    this.links.dispose();
    this.moltenMat.dispose();
  }
}
