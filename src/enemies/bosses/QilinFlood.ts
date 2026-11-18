/**
 * 焚身 · 熔流轮转的熔流（Unity Qilin/QilinFlood.cs 的网页版；几何与常量在 QilinFurnace.ts 的 floodStrips / FLOOD）：
 * 倒鼎压满熔池，熔岩溢进四条渠。从玩家所在的象限起、俯视顺时针轮流，把夹着那个象限的两条渠的外段（窄桥以外到殿墙）朝象限一侧涨宽到 4 m：
 *   预警 1.5 s（地上两条预警条带）→ 涨 6 s（狂怒 4 s）→ 退 → 隔 0.6 s（狂怒 0.3 s）→ 下一个象限，四个象限轮完结束。
 * 网页的熔流：
 *   · 白盒关卡有熔岩系统（StageDirector.lavaSystem）时，涨着的熔流交给 LavaSystem.addLavaArea（掩码、导航、安全落脚点都跟着变，同 Three.js 原版）；
 *   · Unity 场景（3-4）还没有熔岩运行时（docs/threejs-migration.md M7）：每条熔流带一片发光的熔岩面，平时沉在地面以下 1.6 m，预警完涨到地面以上 0.03 m、退时沉回去；
 *     玩家贴地站在涨着的熔流里每 0.5 s 烧一下 10（火，难度 1；Three.js 原版没有熔岩系统时的兜底）。
 * 首领倒下 / 释放时全部退回、销毁。
 */
import * as THREE from 'three';
import type { LavaFlood, LavaSystem } from '../../world/Lava';
import type { Qilin } from './Qilin';
import { QilinDef } from './QilinDef';
import { FLOOD, floodStrips, inStrip, type FloodStrip } from './QilinFurnace';

const DEG = Math.PI / 180;
type Stage = 'warn' | 'on' | 'gap';

interface Sheet {
  strip: FloodStrip;
  mesh: THREE.Mesh;
  /** 当前 / 目标高度（相对 base）与插值速度 */
  level: number;
  /** 熔流带所在的地面高度（世界 y）：殿内地面在场景网格里不全是 0 m，熔岩面要贴着实际地面涨上来，否则埋在地面下看不见 */
  base: number;
  target: number;
  speed: number;
}

const _v = new THREE.Vector3();

export class QilinFlood {
  /** 累计：开始过几轮、涨过几次（一次 = 一个象限）、本次涨着用的时长 */
  cycles = 0;
  floods = 0;
  currentOnSeconds = 0;
  private order: number[] | null = null;
  private index = 0;
  private stage: Stage = 'warn';
  private t = 0;
  private dmgAcc = 0;
  private readonly sheets = new Map<number, Sheet[]>();
  private lavaFloods: LavaFlood[] = [];
  private readonly group = new THREE.Group();
  private readonly mat: THREE.MeshStandardMaterial;
  private age = 0;

  constructor(private readonly q: Qilin) {
    this.group.name = 'qilin-flood';
    this.mat = new THREE.MeshStandardMaterial({ color: 0x3a1206, emissive: 0xff4a10, emissiveIntensity: 1.8, roughness: 0.55, metalness: 0 });
    q.ctx.stageGroup.add(this.group);
  }

  /** 轮转进行中（四个象限还没轮完） */
  get active(): boolean {
    return this.order !== null;
  }

  get floodingQuadrant(): number {
    return this.order && this.stage === 'on' ? this.order[this.index] : -1;
  }

  get warningQuadrant(): number {
    return this.order && this.stage === 'warn' ? this.order[this.index] : -1;
  }

  get orderList(): readonly number[] {
    return this.order ?? [];
  }

  private lava(): LavaSystem | null {
    return (this.q.ctx.stage as unknown as { lavaSystem?: LavaSystem | null }).lavaSystem ?? null;
  }

  /** 开始一轮（从 firstQuadrant 起、俯视顺时针）；restart = 正在轮也重新开始（狂怒）。返回是否开始了 */
  start(firstQuadrant: number, restart = false): boolean {
    const f = this.q.furnace;
    const n = f.quadrantCount;
    if (n === 0) return false;
    if (this.active) {
      if (!restart) return false;
      this.stop();
    }
    const order = [((firstQuadrant % n) + n) % n];
    for (let i = 1; i < n; i++) order.push(f.clockwiseNext(order[i - 1]));
    this.order = order;
    this.index = 0;
    this.cycles++;
    this.beginWarn();
    return true;
  }

  /** 停掉这一轮：涨着 / 预警中的熔流退回地下 */
  stop(): void {
    this.order = null;
    this.clearLava();
    for (const list of this.sheets.values()) for (const s of list) this.sink(s, 0.4);
  }

  dispose(): void {
    this.order = null;
    this.clearLava();
    this.group.removeFromParent();
    for (const list of this.sheets.values()) for (const s of list) s.mesh.geometry.dispose();
    this.sheets.clear();
    this.mat.dispose();
  }

  /** 推进（首领每帧调，招式中、间隙都调） */
  tick(dt: number): void {
    if (!(dt > 0)) return;
    this.age += dt;
    this.animateSheets(dt);
    if (!this.order) return;
    this.t += dt;
    const rage = this.q.enraged;
    const qd = this.order[this.index];
    if (this.stage === 'warn') {
      if (this.t < FLOOD.WarnSeconds) return;
      this.stage = 'on';
      this.t = 0;
      this.currentOnSeconds = rage ? FLOOD.OnSecondsRage : FLOOD.OnSeconds;
      this.floods++;
      this.rise(qd);
      const f = this.q.furnace;
      const at = f.point(f.quadrantYaw(qd), f.bridgeOuter + 3, _v);
      at.y += 0.3;
      this.q.ctx.fx.burst(at, QilinDef.Ember, 30, 7, 0.9, 0.3, 6);
      this.q.ctx.audio.play('skill_fire', { position: at, volume: 0.9, pitch: 0.5 });
      return;
    }
    if (this.stage === 'on') {
      if (rage) this.currentOnSeconds = Math.min(this.currentOnSeconds, FLOOD.OnSecondsRage);
      this.burnPlayer(qd, dt);
      if (this.t < this.currentOnSeconds) return;
      this.clearLava();
      for (const s of this.sheetsFor(qd)) this.sink(s, FLOOD.RecedeSeconds);
      this.stage = 'gap';
      this.t = 0;
      return;
    }
    if (this.t < (rage ? FLOOD.GapSecondsRage : FLOOD.GapSeconds)) return;
    this.index++;
    if (this.index >= this.order.length) {
      this.order = null;
      return;
    }
    this.beginWarn();
  }

  private beginWarn(): void {
    this.stage = 'warn';
    this.t = 0;
    const f = this.q.furnace;
    const qd = this.order![this.index];
    for (const s of floodStrips(f, qd)) {
      this.q.hazards.lineWarning(s.from.x, f.floorY, s.from.z, s.yaw * DEG, s.length, s.halfWidth, FLOOD.WarnSeconds, QilinDef.Warn, 0, 'hazard');
    }
    this.q.ctx.audio.play('telegraph', { position: f.center, volume: 1, pitch: 0.6 });
  }

  /** 涨：熔岩系统里加临时熔岩（白盒），熔岩面涨上来 */
  private rise(qd: number): void {
    const lava = this.lava();
    if (lava) {
      for (const s of floodStrips(this.q.furnace, qd)) this.lavaFloods.push(lava.addLavaArea(stripPolygon(s), { rise: 0.5 }));
    }
    for (const s of this.sheetsFor(qd)) {
      s.mesh.visible = true;
      s.target = FLOOD.Rise;
      s.speed = (FLOOD.Rise + FLOOD.SunkDepth) / FLOOD.RiseSeconds;
    }
  }

  private sink(s: Sheet, seconds: number): void {
    s.target = -FLOOD.SunkDepth;
    s.speed = (FLOOD.Rise + FLOOD.SunkDepth) / Math.max(0.05, seconds);
  }

  private clearLava(): void {
    for (const fl of this.lavaFloods) fl.remove();
    this.lavaFloods = [];
  }

  /** 没有熔岩系统时自己结算：玩家贴地站在涨着的熔流里每 0.5 s 烧一下 */
  private burnPlayer(qd: number, dt: number): void {
    if (this.lavaFloods.length > 0) return;
    this.dmgAcc += dt;
    if (this.dmgAcc < 0.5) return;
    this.dmgAcc = 0;
    const pl = this.q.ctx.player;
    if (!pl.alive) return;
    if (this.sheetsFor(qd).some(s => s.level > -0.2 && inStrip(s.strip, pl.position) && pl.position.y - s.base < 0.4)) this.q.hazards.hurt(this.q.dmg(10), 'fire', pl.position);
  }

  /** 某一点（XZ）此刻在不在涨着的熔流里 */
  flooded(p: { x: number; z: number }): boolean {
    for (const list of this.sheets.values()) for (const s of list) if (s.mesh.visible && s.level > -0.2 && inStrip(s.strip, p)) return true;
    return false;
  }

  /** 象限 q 的两片熔流（第一次用时建：沉在地面以下） */
  private sheetsFor(qd: number): Sheet[] {
    let list = this.sheets.get(qd);
    if (list) return list;
    list = [];
    for (const s of floodStrips(this.q.furnace, qd)) {
      const geo = new THREE.PlaneGeometry(s.size.x, s.size.y, 1, 6);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.name = `qilin-flood-q${qd}-c${s.channel}`;
      mesh.rotation.y = s.yaw * DEG;
      mesh.position.set(s.center.x, this.q.hallFloor - FLOOD.SunkDepth, s.center.z);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.visible = false;
      this.group.add(mesh);
      const g = this.q.ctx.world.groundHeight(s.center.x, s.center.z, this.q.hallFloor + 2, 0.3);
      const base = Number.isFinite(g) && Math.abs(g - this.q.hallFloor) < 1 ? Math.max(g, this.q.hallFloor) : this.q.hallFloor;
      list.push({ strip: s, mesh, level: -FLOOD.SunkDepth, target: -FLOOD.SunkDepth, speed: 1, base });
    }
    this.sheets.set(qd, list);
    return list;
  }

  private animateSheets(dt: number): void {
    this.mat.emissiveIntensity = 1.6 + 0.4 * Math.sin(this.age * 2.3);
    const floor = this.q.hallFloor;
    for (const list of this.sheets.values()) {
      for (const s of list) {
        if (!s.mesh.visible) continue;
        const d = s.target - s.level;
        s.level += Math.sign(d) * Math.min(Math.abs(d), s.speed * dt);
        s.mesh.position.y = s.base + s.level + 0.04; // 比碰撞地面高一点点：场景的地面网格和碰撞高度场有几厘米的出入
        if (s.level <= -FLOOD.SunkDepth + 1e-3 && s.target <= -FLOOD.SunkDepth) s.mesh.visible = false;
        else if (s.level > -0.2 && Math.random() < dt * 6) {
          // 涨着的熔流冒火星
          const st = s.strip, a = st.yaw * DEG;
          const u = (Math.random() - 0.5) * st.size.y, w = (Math.random() - 0.5) * st.size.x;
          _v.set(st.center.x + Math.sin(a) * u + Math.cos(a) * w, floor + 0.2, st.center.z + Math.cos(a) * u - Math.sin(a) * w);
          this.q.ctx.fx.burst(_v, Math.random() < 0.5 ? QilinDef.Hot : QilinDef.Ember, 3, 2, 0.6, 0.18, -2);
        }
      }
    }
  }
}

/** 熔流带的盒 → 多边形（世界 [x, z]，交给 LavaSystem.addLavaArea） */
function stripPolygon(s: FloodStrip): [number, number][] {
  const a = s.yaw * DEG;
  const fx = Math.sin(a), fz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
  const hx = s.size.x * 0.5, hy = s.size.y * 0.5;
  const P = (u: number, w: number): [number, number] => [s.center.x + fx * u + rx * w, s.center.z + fz * u + rz * w];
  return [P(-hy, -hx), P(hy, -hx), P(hy, hx), P(-hy, hx)];
}
