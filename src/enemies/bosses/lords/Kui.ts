/**
 * 夔的行为（Unity Kui/KuiBrain.cs；定义 KuiDef.ts，招式 KuiMoves.ts，残鼓 KuiDrum.ts，登场 KuiIntro.ts，落雷 / 导体 / 雷暴的适配层 KuiStorm.ts）：
 *   · 一足：招式间隙不走路——原地转身对着玩家；位移全在招式里（小跳 / 大跳 / 转身跳在空中位移，拄拳绕拉则挪位）。
 *   · 选招：二阶段起每隔几招捶一次胸；玩家绕到身后 > 115° 且 12 m 内转身跳；8 m 内大概率雷掌；每四跳一次大跳（三阶段换连环大跳），
 *     远于 16 m 直接大跳；远于 12 m 偶尔拄拳；其余小跳（权重写在各招式里，这里只记计数）。
 *   · 召鼓（二阶段）：跳上拉则旁、吼，两只连鼓灵从擂台边飞来护驾，擂台内的经幡杆一齐通电（M7）。
 *   · 风雨（三阶段）：擂台外圈（20–32 m）每 1.2 s 一道落雷（M7）。
 *   · 经幡杆回劈：大跳 / 连环大跳落在带电的杆 4.5 m 内 → 杆放电、三道粗雷劈回胸口：200（换算）+ 破防条 + 硬直 1.5 s（M7 的导体）。
 *   · 捶胸：鼓心倍率 × 1.4（weakpointDamageMult）；破鼓：单膝跪地（kneel）。
 *   · 死亡「雷息」：鼓面炸开一道光 → 往后倒进残鼓（sink 片段，网页退回 kneel；体型缩到 25%）、身体化成雷云散开 → 雷暴 4 s 内退去。
 * 还差（等 M7）：落雷、导体（经幡杆带电 / 回劈 / 召鼓充电）、高原雷暴——全部经 KuiStorm 的 bindKuiStorm 接；没接时这些调用只记数。
 * 一直带电（Charge.Hold，火一碰焚雷；M8 接上，见 passiveTick）。与 Unity 的差异：雷云 / 鼓缝裂光换成 ctx.fx 粒子。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../../core/types';
import type { BossPhaseDef } from '../framework/BossDef';
import type { BossMove } from '../framework/BossMove';
import { summonOptions } from '../framework/Summons';
import type { BossIntroScript } from '../intro/BossIntroScript';
import { KuiDef } from './KuiDef';
import { KuiDrum } from './KuiDrum';
import { kuiIntro, setKuiIntroDrum } from './KuiIntro';
import { createKuiMove, KuiChestDrum } from './KuiMoves';
import { KuiPalette } from './KuiPlans';
import { kuiChargeConductors, kuiClearStrikes, kuiEndStorm, kuiEnsureStorm, kuiNearestCharged, kuiStrike } from './KuiStorm';
import { LordBrain } from './LordBrain';
import { LordFx } from './LordFx';

export const KUI_DEF: EnemyDef = {
  id: KuiDef.Id, name: '夔', hp: KuiDef.TierHp / 3.4, speed: 2.5, radius: 2.5, height: 6, damage: 16,
  coins: [60, 100], essence: 60, isBoss: true, headY: 5.4, headRadius: 0.7, knockbackResist: 1, color: KuiPalette.Thunder,
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const smooth = LordBrain.smooth;

export class Kui extends LordBrain {
  readonly kdef: KuiDef;
  drum: KuiDrum | null = null;
  /** 选招计数：小跳次数、距上次捶胸几招 */
  hops = 0;
  sinceDrum = 0;
  /** 被回劈过几次、三阶段外圈落过几道雷、召鼓召出来几只（测试用） */
  backlashes = 0;
  ringStrikes = 0;
  drumsSummoned = 0;

  private ringT = 0;
  private landedIntro = false;
  private deathBurst = false;
  private deathScale0 = 1;
  private stormEnded = false;
  private perchLanded = true;
  private readonly perchFrom = new THREE.Vector3();
  private readonly perchTo = new THREE.Vector3();
  private readonly spawnAt = new THREE.Vector3();
  private readonly summonPts: THREE.Vector3[] = [];

  constructor(ctx: GameContext, opts: SpawnOptions) {
    const def = new KuiDef();
    super(ctx, KUI_DEF, def, opts);
    this.kdef = def;
    this.spawnAt.copy(opts.position);
  }

  protected override createMove(id: string): BossMove | null {
    const spec = this.bdef.move(id);
    return spec ? createKuiMove(this, spec) : null;
  }

  protected override introScript(): BossIntroScript | null {
    return kuiIntro;
  }

  /** 鼓心正张开（捶胸中 / 破鼓中）：弱点倍率 × drumOpenMult */
  get drumOpen(): boolean {
    return this.currentMove instanceof KuiChestDrum || !!this.breakBar?.broken;
  }

  // ───────────── 生成 / 登场 ─────────────

  protected override onLordModel(): void {
    const toCenter = Math.atan2(this.bossCenter.x - this.spawnAt.x, this.bossCenter.z - this.spawnAt.z);
    this.drum = KuiDrum.ensure(this.ctx, this.spawnAt, toCenter);
    setKuiIntroDrum(this.drum);
    kuiEnsureStorm(this.bossCenter);
    this.hops = this.sinceDrum = 0;
    this.ringT = 0;
    this.landedIntro = false;
    this.stormEnded = false;
    this.setModelScale(0.25);
    // 召唤点（Unity Level_4_1：拉则为中心、残鼓方向 ± 1.75 rad、30 m）
    const c = this.bossCenter;
    const da = Math.atan2(this.spawnAt.z - c.z, this.spawnAt.x - c.x);
    this.summonPts.length = 0;
    for (const s of [1, -1]) {
      const a = da + s * 1.75;
      const p = new THREE.Vector3(c.x + Math.cos(a) * 30, c.y + 4, c.z + Math.sin(a) * 30);
      p.y = this.groundAt(p);
      this.summonPts.push(p);
    }
  }

  private setModelScale(s: number): void {
    this.model.scale.setScalar(s);
  }

  override summonPoints(): readonly THREE.Vector3[] {
    return this.summonPts;
  }

  /** 登场（4.3 s）：0–2.2 s 从残鼓里一节节长出来（25% → 100%，鼓长到 55% 时藏起）→ 2.2 s 一足落地、双拳砸地 → 仰头吼 */
  protected override introTick(t: number, dt: number): void {
    const sec = t * Math.max(0.01, this.bdef.intro.seconds);
    const k = smooth(sec / 2.2);
    this.setModelScale(0.25 + 0.75 * k);
    this.drum?.setVisible(k < 0.55);
    if (sec < 2.2) {
      if (this.ctx.rng.next() < dt * 10) this.ctx.fx.burst(_a.copy(this.position).setY(this.position.y + 1 + 4 * k), KuiPalette.Cloud, 4, 1.5, 0.8, 0.6, 0);
      return;
    }
    if (!this.landedIntro) {
      this.landedIntro = true;
      this.ctx.fx.ring(_a.copy(this.position).setY(this.position.y + 0.1), 10, KuiPalette.Skin, 0.5);
      LordFx.dust(this.ctx, this.position, 2.2, 8, KuiPalette.Dust);
      this.shake(0.5, 0.5);
      this.playActFade('roar', 2.1, 0.12);
      this.playSfx('boss_slam', 0.9, 0.7);
    }
    if (sec > 2.7 && sec < 4.1 && this.ctx.rng.next() < dt * 6) {
      const head = this.bonePos('head', _a);
      this.ctx.fx.lightning(head, _b.set(head.x + this.ctx.rng.range(-3, 3), head.y + 8, head.z + this.ctx.rng.range(-3, 3)), KuiPalette.Thunder);
    }
  }

  protected override onIntroEnd(): void {
    this.setModelScale(1);
    this.drum?.setVisible(false);
    this.tell('kui_tip', '打它胸口的鼓心——大跳砸地、拄拳挪位的时候胸口最低', KuiPalette.Thunder, 60, 4);
  }

  // ───────────── 每帧 ─────────────

  /** 一足：间隙不走路，原地转身对着玩家 */
  protected override idleMove(dt: number): void {
    this.halt();
    this.facePlayerDeg(110, dt);
  }

  override update(dt: number): void {
    super.update(dt);
    this.drum?.update(dt);
    if (this.alive) this.weakpointDamageMult = this.drumOpen ? this.kdef.drumOpenMult : 1;
  }

  /** 常驻带电的撤销函数（Unity KuiBrain.chargeHold） */
  private chargeHold: (() => void) | null = null;

  protected override passiveTick(dt: number): void {
    // 雷兽一直带电（M8 的 combat/Charge；登场时不可选中拿不到电：开打后补上，被清掉了也补）——火一碰就是焚雷。
    // 经 ctx.combat.charge 鸭子类型拿（不 import，测试桩里没有就不带电）
    const charge = (this.ctx.combat as unknown as { charge?: { isCharged(e: unknown): boolean; hold(e: unknown, src: unknown): () => void } }).charge;
    if (charge && this.alive && !this.untargetable && !charge.isCharged(this)) {
      this.chargeHold?.();
      this.chargeHold = charge.hold(this, this);
    }
    if (this.phase >= 2) {
      this.ringT -= dt;
      if (this.ringT <= 0) {
        this.ringT = this.kdef.ringEvery;
        const c = this.bossCenter;
        const a = this.ctx.rng.next() * Math.PI * 2, r = this.ctx.rng.range(this.kdef.ringBand[0], this.kdef.ringBand[1]);
        kuiStrike(new THREE.Vector3(c.x + Math.sin(a) * r, c.y, c.z + Math.cos(a) * r), {
          warn: this.kdef.ringWarn, radius: this.kdef.ringRadius, damage: this.moveDamage(this.kdef.ringDamage / Math.max(1, this.bdef.damage)) * this.damageMult, source: this,
        });
        this.ringStrikes++;
      }
    }
    if (this.drumOpen && this.ctx.rng.next() < dt * 8) {
      this.ctx.fx.burst(this.bonePos(KuiDef.WeakBone, _a), this.breakBar?.broken ? KuiPalette.ThunderEdge : KuiPalette.ThunderCore, 3, 1.2, 0.3, 0.25, 0);
    }
  }

  // ───────────── 阶段 ─────────────

  protected override onLordPhase(phase: number): void {
    kuiClearStrikes();
    this.perchLanded = phase !== 1;
    if (phase !== 1) return;
    // 召鼓：跳上拉则旁（拉则在场地中心，往残鼓那边 2.6 m）
    this.perchFrom.copy(this.position);
    const c = this.bossCenter;
    const dx = this.spawnAt.x - c.x, dz = this.spawnAt.z - c.z, d = Math.hypot(dx, dz) || 1;
    // Unity：Perch_Lartse = G(c + toDrum × 2.6, 2.4)（地形高 + 2.4），跳之前 target.y = GroundAt(target)（从它上方 6 m 往下找）
    // 落在拉则旁（Unity 落地后导航代理 Warp 回网格）：网页的身体是 2.1 m 半宽的碰撞盒，离拉则（4.5 m 见方、9 m 高的盒子）太近会被碰撞解算顶到拉则顶上——
    // 从 2.6 m 往外找第一处身体不压着拉则的点
    const half = this.radius * 0.85;
    for (let r = 2.6; r <= 12; r += 0.5) {
      this.perchTo.set(c.x + dx / d * r, c.y + 1, c.z + dz / d * r);
      this.perchTo.y = this.groundAt(_b.copy(this.perchTo).setY(c.y - 5)) + 2.4;
      this.perchTo.y = this.groundAt(this.perchTo);
      if (!this.ctx.world.overlapsBody(this.perchTo.x, this.perchTo.y + 0.6, this.perchTo.z, half, this.height - 0.6)) break;
    }
    this.beginDash();
  }

  protected override transitionTick(t: number, dt: number): void {
    this.facePlayerDeg(60, dt);
    if (this.phase === 1 && !this.perchLanded) {
      const k = smooth(t / 1.1);
      const p = _a.lerpVectors(this.perchFrom, this.perchTo, k);
      p.y += 6 * 4 * k * (1 - k);
      this.drive(p);
      if (t < 0.05) this.playActFade('leap', 1.6, 0.06);
      if (t >= 1.1) {
        this.perchLanded = true;
        this.drive(this.perchTo);
        this.endDash();
        this.ctx.fx.ring(_a.copy(this.perchTo).setY(this.perchTo.y + 0.1), 12, KuiPalette.Skin, 0.5);
        LordFx.dust(this.ctx, this.perchTo, 2.4, 8, KuiPalette.Dust);
        this.shake(0.4, 0.4);
        this.playActFade('roar', 2, 0.1);
        this.summonDrums();
        kuiChargeConductors(this.bossCenter, this.arenaRadius + 2, this.kdef.drumsPoleCharge);
      }
    } else if (this.phase === 2 && this.ctx.rng.next() < dt * 3) {
      const c = this.bossCenter;
      const a = this.ctx.rng.next() * Math.PI * 2, r = this.ctx.rng.range(25, 40);
      kuiStrike(new THREE.Vector3(c.x + Math.sin(a) * r, c.y, c.z + Math.cos(a) * r), { warn: 0, radius: 3.2, damage: 0, source: this, noTelegraph: true });
    }
  }

  protected override onLordTransitionEnd(_p: BossPhaseDef): void {
    if (!this.perchLanded) {
      this.perchLanded = true;
      this.endDash();
    }
    if (this.phase === 1) this.tell('kui_poles', '经幡杆旁 2–5 m 能躲雷；带电的杆子会回劈落在旁边的夔', KuiPalette.Thunder, 60, 4);
    if (this.phase === 2) this.tell('kui_storm', '外圈落雷越来越密——往山顶收', KuiPalette.Thunder, 60, 3);
  }

  private summonDrums(): void {
    const d = this.kdef;
    const n = this.summons.spawn(d.lianguId, d.lianguCount, summonOptions({ warn: 0.6, minRadius: 18, maxRadius: 24, cap: d.lianguCount, usePoints: true }));
    this.drumsSummoned += n;
  }

  // ───────────── 场地：经幡杆回劈（M7 的导体） ─────────────

  /** 大跳落地时调：落在带电的经幡杆 4.5 m 内 → 回劈（硬直、伤害、破防条）。返回是否回劈了（没接 M7 时恒为 false） */
  tryBacklash(): boolean {
    const d = this.kdef;
    if (!this.alive) return false;
    const pole = kuiNearestCharged(this.position, d.backlashRadius);
    if (!pole) return false;
    pole.discharge();
    const chest = this.bonePos('chest', new THREE.Vector3());
    for (let i = 0; i < 3; i++) this.ctx.fx.lightning(pole.top, chest, KuiPalette.Thunder);
    this.shake(0.5, 0.4);
    this.backlashes++;
    this.ctx.combat.damageEnemy(this, {
      base: d.backlashDamage * this.webScale, element: 'shock', source: 'status', canCrit: false, point: chest,
      direction: chest.clone().sub(pole.top).normalize(), tags: ['environment'],
    });
    this.breakBar?.add(d.backlashBreak * this.webScale);
    if (!this.staggered) this.stagger(d.backlashStun, 'kneel', 1);
    this.tell('kui_backlash', '落在带电的经幡杆旁——被回劈了！', KuiPalette.Thunder, 6, 2);
    return true;
  }

  // ───────────── 破防 / 倒下 ─────────────

  protected override onLordBreak(_count: number): void {
    LordFx.shatter(this.ctx, this.bonePos(KuiDef.WeakBone, _a), KuiPalette.ThunderCore, KuiPalette.Thunder);
    this.shake(0.4, 0.4);
    if (this.dashing) {
      this.endDash();
      _a.copy(this.position);
      _a.y = this.groundAt(_b.copy(_a).setY(_a.y + 2));
      this.position.copy(_a);
    }
    this.tell('kui_break', '破鼓！夔单膝跪地——全力输出', KuiPalette.Thunder, 4, 2.5);
  }

  protected override onLordDefeated(_result: DamageResult): void {
    kuiClearStrikes();
    this.deathBurst = false;
    this.weakpointDamageMult = 1;
    this.deathScale0 = this.model.scale.x;
  }

  /** 雷息：0.3 s 鼓面炸开 → 1.6–4.0 s 往后倒进残鼓（体型缩到 25%、化成雷云）→ 1.5 s 起雷暴退去 → 4 s 后隐去 */
  override deathTick(t: number, dt: number): void {
    if (t > 0.3 && !this.deathBurst) {
      this.deathBurst = true;
      LordFx.shatter(this.ctx, this.bonePos(KuiDef.WeakBone, _a), KuiPalette.ThunderCore, KuiPalette.Thunder);
    }
    const sink = smooth((t - 1.6) / 2.4);
    this.setModelScale(this.deathScale0 * (1 - 0.75 * sink));
    if (this.drum && sink > 0.5) this.drum.setVisible(true);
    if (sink > 0 && sink < 1 && this.ctx.rng.next() < dt * 12) this.ctx.fx.burst(this.bonePos('chest', _a), KuiPalette.Cloud, 4, 1.2, 0.9, 0.6, 0);
    if (t > 1.5 && !this.stormEnded) {
      this.stormEnded = true;
      kuiEndStorm();
    }
    if (t > 4 && this.model.visible) {
      this.ctx.fx.burst(this.drum ? this.drum.center(_a) : this.position, KuiPalette.Cloud, 18, 2, 1.2, 0.8, 0);
      this.model.visible = false;
    }
  }

  protected override onLordReleased(): void {
    if (!this.stormEnded) kuiEndStorm();
    this.drum?.setVisible(true);
    setKuiIntroDrum(null);
  }
}
