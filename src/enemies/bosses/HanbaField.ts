/**
 * 旱魃的场地变化与护体（Unity Hanba/HanbaSpring.cs、Moves/Phase2Scorch.cs、Moves/Phase3SunRise.cs、Moves/Phase2ApsaraCall.cs 里的 ApsaraWard）。
 *   · {@link HanbaSpring}：月牙泉——经 framework/StageHooks 的 water 钩子（UnityWaterView 登记）吸干 / 复涌；泉底取点（每段水按面积每约 6 m 一个）给喷气裂缝用。
 *   · {@link Phase2Scorch}：二阶段「焦土」——吸干泉水、泉床龟裂（发光细条），之后每 4.5 s（三阶段 3.2 s）挑 2（3）个裂口喷气：
 *       离玩家最近、14 m 以内的那个必选，其余随机且互相隔开 5 m；先亮 1.1 s 圆形预警（危险物组：打断招式也照常兑现），再喷：半径 2.2 m、4 m 高以内灼伤并掀起，泉水喷柱。
 *   · {@link Phase3SunRise}：三阶段「赤地千里」——太阳被推到 85°（3.2 s），日轮沿太阳方向升到场地中心上空 45 m、轮面朝下、放大 2.4 倍，
 *       日晒里日轮直射的增益归零、日光增益提到 1.4（烈日当头）。
 *   · {@link ApsaraWard}：琵琶护体——邪飞天活着、琵琶没碎时旱魃受到的一切伤害 × 0.2；琵琶碎（邪飞天沉默）或她死了：护体崩散，旱魃踉跄 2.5 s（承伤 × 1.3），
 *       琵琶碎时邪飞天随之解脱（照常掉落、计击杀）。
 *     与 Unity 的差异：剥掉邪飞天落到旱魃身上的和弦护盾 / 赐福（网页邪飞天的辅助目标另算，护体期间不会叠到 0.075 的承伤）没有移植。
 */
import * as THREE from 'three';
import type { IEnemy } from '../../core/types';
import { isSpringWater, stageHooks } from './framework/StageHooks';
import type { Hanba } from './Hanba';
import * as Fx from './HanbaFx';
import { HanbaSunDriver, sunDirection } from './HanbaSun';

const _a = new THREE.Vector3();

// ───────────────────────────── 月牙泉 ─────────────────────────────

export class HanbaSpring {
  static readonly BedStep = 6;
  drains = 0;
  refills = 0;

  private constructor(readonly beds: readonly THREE.Vector3[]) {}

  /** 这片场地的泉水（关卡登记了水、且有名字带 CrescentSpring 的水段）；没有返回 null */
  static find(): HanbaSpring | null {
    const water = stageHooks.water;
    if (!water) return null;
    const beds: THREE.Vector3[] = [];
    for (const b of water.waterBodies()) {
      if (!b.spring && !isSpringWater(b.name)) continue;
      const nx = Math.min(6, Math.max(1, Math.round(Math.abs(b.scale.x) / HanbaSpring.BedStep)));
      const nz = Math.min(6, Math.max(1, Math.round(Math.abs(b.scale.z) / HanbaSpring.BedStep)));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const local = new THREE.Vector3(((i + 0.5) / nx - 0.5) * b.scale.x, -0.5 * b.scale.y, ((j + 0.5) / nz - 0.5) * b.scale.z);
          beds.push(local.applyQuaternion(b.quaternion).add(b.center));
        }
      }
    }
    return beds.length > 0 ? new HanbaSpring(beds) : null;
  }

  get level(): number {
    return stageHooks.water?.springLevel() ?? NaN;
  }

  drain(seconds: number, sink: THREE.Vector3): void {
    this.drains++;
    stageHooks.water?.springTo(0, seconds, sink);
  }

  refill(seconds: number, ctx: Hanba['ctx']): void {
    this.refills++;
    stageHooks.water?.springTo(1, seconds, null);
    for (const p of this.beds) ctx.fx.burst(_a.copy(p).setY(p.y + 0.2), Fx.DROPLET, 6, 3, 0.7, 0.12, 6);
  }
}

// ───────────────────────────── 焦土 ─────────────────────────────

export class Phase2Scorch {
  static readonly VentSpacing = 5;
  static readonly DrainShare = 0.8;
  static readonly PlumeSeconds = 1.2;
  static readonly NearPlayer = 14;

  begun = false;
  spring: HanbaSpring | null = null;
  readonly vents: THREE.Vector3[] = [];
  bursts = 0;
  warned = 0;
  erupted = 0;
  playerHits = 0;
  private timer = 0;
  private glowT = 0;
  private readonly cracks: THREE.Mesh[] = [];
  private readonly mat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(private readonly boss: Hanba) {}

  /** 开始吸干 + 龟裂（seconds = 转阶段演出时长）。只做一次 */
  begin(seconds: number): void {
    if (this.begun) return;
    this.begun = true;
    const b = this.boss;
    this.spring = HanbaSpring.find();
    this.spring?.drain(Math.max(0.3, seconds * Phase2Scorch.DrainShare), b.getBodyCenter(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0)));
    this.pickVents();
    this.buildCracks();
    this.timer = b.hdef.ventWarn + seconds;
    b.ctx.audio.play('shield_recharge', { position: b.position, volume: 0.9, pitch: 0.5 });
  }

  /** 裂口：泉床各段水的底面取点（太近的合并）；没有泉水时在场地中心外 55% 半径排一圈 8 个 */
  private pickVents(): void {
    this.vents.length = 0;
    const s = this.spring;
    if (s && s.beds.length > 0) {
      for (const p of s.beds) {
        if (this.vents.some(v => v.distanceToSquared(p) < Phase2Scorch.VentSpacing ** 2 * 0.5)) continue;
        this.vents.push(this.ground(p.clone()));
      }
      return;
    }
    const c = this.boss.bossCenter;
    const r = Math.min(16, this.boss.arenaRadius) * 0.55;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + 0.3;
      this.vents.push(this.ground(new THREE.Vector3(c.x + Math.sin(a) * r, c.y, c.z + Math.cos(a) * r)));
    }
  }

  private ground(p: THREE.Vector3): THREE.Vector3 {
    const y = this.boss.ctx.world.groundHeight(p.x, p.z, p.y + 3, 0.1);
    if (Number.isFinite(y) && y > p.y - 10) p.y = y;
    return p;
  }

  /** 龟裂：相邻裂口之间（9 m 以内）连一条发光细条，每个裂口再放射三条短裂缝（不挡路、不挡子弹） */
  private buildCracks(): void {
    const parent = this.boss.ctx.stageGroup;
    const crack = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
      const len = a.distanceTo(b);
      if (len < 0.2) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, len), this.mat);
      m.position.copy(a).add(b).multiplyScalar(0.5).setY((a.y + b.y) * 0.5 + 0.04);
      m.lookAt(b.x, m.position.y, b.z);
      m.renderOrder = 3;
      parent.add(m);
      this.cracks.push(m);
    };
    for (let i = 0; i < this.vents.length; i++) {
      const a = this.vents[i];
      for (let k = 0; k < 3; k++) {
        const yaw = ((i * 47 + k * 120) % 360) * Math.PI / 180;
        crack(a, this.ground(new THREE.Vector3(a.x + Math.sin(yaw) * 1.8, a.y, a.z + Math.cos(yaw) * 1.8)), 0.12);
      }
      if (i + 1 < this.vents.length && this.vents[i + 1].distanceToSquared(a) < 81) crack(a, this.vents[i + 1], 0.16);
    }
  }

  /** 每帧（阶段 ≥ 二）：裂缝明暗呼吸，到点挑裂口喷气 */
  tick(dt: number): void {
    const b = this.boss;
    if (!this.begun || !b.alive) return;
    this.glowT += dt;
    const on = Math.min(1, this.glowT / 2.5);
    const k = on * (0.65 + 0.35 * Math.sin(this.glowT * 2.2));
    this.mat.opacity = Math.min(1, 0.2 + 0.8 * k);
    if (this.vents.length === 0) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = b.hdef.ventEveryAt(b.phase);
    this.burst(b.hdef.ventCountAt(b.phase));
  }

  /** 挑 count 个裂口喷；返回实际排上的个数 */
  burst(count: number): number {
    const b = this.boss;
    if (!b.alive || this.vents.length === 0 || count <= 0) return 0;
    const picks: number[] = [];
    const player = b.ctx.player.position;
    let near = -1, best = Phase2Scorch.NearPlayer ** 2;
    this.vents.forEach((v, i) => {
      const dd = v.distanceToSquared(player);
      if (dd < best) {
        best = dd;
        near = i;
      }
    });
    if (near >= 0) picks.push(near);
    for (let tries = 0; picks.length < count && tries < 24; tries++) {
      const i = Math.floor(Math.random() * this.vents.length);
      if (picks.some(j => j === i || this.vents[j].distanceToSquared(this.vents[i]) < Phase2Scorch.VentSpacing ** 2)) continue;
      picks.push(i);
    }
    const d = b.hdef;
    for (const i of picks) {
      const p = this.vents[i];
      b.hazards.groundWarning(p.x, p.y, p.z, d.ventRadius, d.ventWarn, 0xffb070, 'hazard');
      this.warned++;
      b.ctx.fx.burst(_a.copy(p).setY(p.y + 0.2), Fx.STEAM, 4, 1.2, 0.6, 0.25, -0.4);
      b.hazards.later(d.ventWarn, () => this.erupt(p));
    }
    this.bursts++;
    return picks.length;
  }

  private erupt(p: THREE.Vector3): void {
    const b = this.boss;
    if (!b.alive) return;
    const d = b.hdef;
    this.erupted++;
    if (b.hazards.blast(p.x, p.y, p.z, d.ventRadius, b.moveDamage(d.ventDamage), { maxHeight: 4, knockUp: 7.5, element: 'fire' })) this.playerHits++;
    b.ctx.fx.burst(_a.copy(p).setY(p.y + 0.2), Fx.CRACK, 8, 4, 0.5, 0.15, 6);
    Fx.springSpout(b.ctx, p, d.ventRadius * 0.45, 6.5);
    b.quakeAt(p, 0.25, 0.25, 18);
    b.ctx.audio.play('skill_fire', { position: p, volume: 0.7, pitch: 1.7 });
    b.ctx.audio.play('shot_beam', { position: p, volume: 0.35, pitch: 1.9 });
    b.hazards.repeat(0.3, Phase2Scorch.PlumeSeconds, () => b.ctx.fx.burst(_a.copy(p).setY(p.y + 4.2 + Math.random() * 1.4), 0xffffff, 6, 2, 0.6, 0.25, 5));
  }

  /** 首领倒下 / 释放：裂缝熄掉 */
  end(): void {
    for (const m of this.cracks) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.cracks.length = 0;
    this.mat.dispose();
  }
}

// ───────────────────────────── 赤地千里 ─────────────────────────────

export class Phase3SunRise {
  begun = false;
  readonly target = new THREE.Vector3();
  driver: HanbaSunDriver | null = null;

  constructor(private readonly boss: Hanba) {}

  begin(seconds: number): void {
    if (this.begun) return;
    this.begun = true;
    const b = this.boss;
    const d = b.hdef;
    this.driver = HanbaSunDriver.find(b.ctx);
    const toSun = this.driver ? sunDirection(d.risenElevation, this.driver.azimuthNow) : new THREE.Vector3(0, 1, 0);
    const dir = toSun.y > 0.05 ? toSun.clone().normalize() : new THREE.Vector3(0, 1, 0);
    this.target.copy(b.bossCenter).addScaledVector(dir, Math.max(8, d.risenDistance));
    this.driver?.driveTo(d.risenElevation, d.sunDriveSeconds);
    const ring = b.ring;
    ring.risenScale = d.risenSkyScale;
    ring.rise(this.target, Math.max(0.5, seconds * 0.85));
    ring.setBlaze(1, 2.5);
    b.exposure.ringGain = 0;
    b.exposure.shaftGain = d.risenSunGain;
    b.ctx.audio.play('shot_beam', { position: b.position, volume: 1, pitch: 0.35 });
    b.ctx.audio.play('boss_roar', { position: b.position, volume: 0.8, pitch: 0.8 });
  }
}

// ───────────────────────────── 琵琶护体 ─────────────────────────────

export class ApsaraWard {
  up = false;
  apsara: IEnemy | null = null;
  raised = 0;
  broken = 0;
  lastSeconds = 0;
  private upAt = 0;
  private pulse = 0;
  private shell: THREE.Mesh | null = null;

  constructor(private readonly boss: Hanba) {}

  get taken(): number {
    return this.up ? Math.min(1, Math.max(0.01, this.boss.hdef.wardTaken)) : 1;
  }

  /** 披上护体（召出邪飞天之后） */
  raise(apsara: IEnemy): void {
    this.drop();
    const b = this.boss;
    this.apsara = apsara;
    this.up = true;
    this.upAt = b.ctx.time.now;
    this.raised++;
    b.setTaken('ward', this.taken);
    if (!this.shell) {
      this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ color: Fx.GOLD, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      b.ctx.stageGroup.add(this.shell);
    }
    this.shell.visible = true;
    b.ctx.ui.toast('邪飞天以琵琶为旱魃护体——先打碎她的琵琶！', '#ffd27a');
  }

  update(dt: number): void {
    if (!this.up) return;
    const b = this.boss;
    if (!b.alive) {
      this.drop();
      return;
    }
    const a = this.apsara as (IEnemy & { silenced?: boolean }) | null;
    if (!a || !a.alive || a.silenced) {
      this.shatter();
      return;
    }
    if (this.shell) {
      this.pulse += dt;
      b.getBodyCenter(this.shell.position);
      this.shell.scale.setScalar(Math.max(3, b.radius * 5) * 0.5 * (1 + 0.04 * Math.sin(this.pulse * 5)));
      (this.shell.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.08 * Math.sin(this.pulse * 3);
    }
  }

  /** 琵琶碎了 / 邪飞天死了：护体崩散，旱魃踉跄，邪飞天解脱 */
  private shatter(): void {
    const a = this.apsara;
    this.broken++;
    this.drop();
    const b = this.boss;
    if (!b.alive) return;
    const d = b.hdef;
    const c = b.getBodyCenter(new THREE.Vector3());
    b.ctx.fx.burst(c, Fx.GOLD, 40, 10, 1, 0.3, 4);
    b.ctx.fx.ring(b.position, 6, Fx.GOLD, 0.5);
    b.ctx.audio.play('shield_break', { position: c, pitch: 0.6 });
    b.ctx.audio.play('pipa_snap', { position: c, volume: 0.9, pitch: 0.7 });
    b.quake(0.5, 0.4);
    b.ctx.ui.toast('琵琶碎裂——旱魃的护体崩散！趁她踉跄集火！', '#ffd27a');
    b.stagger(d.wardBreakStagger, 'Hit', d.wardBreakTaken);
    if (a && a.alive) {
      // 飞天解脱：照常掉落、计击杀（玩家打碎了琵琶）
      b.ctx.fx.burst(_a.copy(a.position).setY(a.position.y + 1.4), Fx.GOLD, 30, 4, 1.4, 0.25, -1.5);
      b.ctx.combat.damageEnemy(a, { base: a.hp + a.shield + a.armor + 1, element: 'none', source: 'status', canCrit: false, procDepth: 2, bypassShield: false });
    }
  }

  /** 收起护体（不踉跄、不动邪飞天） */
  drop(): void {
    if (this.up) this.lastSeconds = this.boss.ctx.time.now - this.upAt;
    this.up = false;
    this.boss.setTaken('ward', null);
    if (this.shell) this.shell.visible = false;
  }

  dispose(): void {
    this.drop();
    if (this.shell) {
      this.shell.removeFromParent();
      this.shell.geometry.dispose();
      (this.shell.material as THREE.Material).dispose();
      this.shell = null;
    }
  }
}
