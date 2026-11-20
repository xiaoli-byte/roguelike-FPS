/**
 * 飞廉的行为（Unity Feilian/FeilianBrain.cs；定义 FeilianDef.ts，招式 FeilianMoves.ts，龙卷 FeilianTornado.ts，登场 FeilianIntro.ts）：
 *   · 招式间隙小跑到离玩家 12–18 m（BossBrain 默认走位的距离带），只在擂台里（冰舌顶）；
 *   · 擂台风：开打时加一个跟着它走的吸引点——一二阶段往外推、三阶段往里吸；推人速度 1.6 m/s（风雷爆蓄力时到 2.6），珠碎风停 6 s；
 *     狂风出手段顺风猛推 0.6 s（9 m/s），掩体后不推。
 *   · 风雷珠（orb 骨）：弱点；珠碎后弱点关掉、25 s 后重新长出来（最后 3 s 长大）。
 *   · 侧跃：2 s 内挨打太多（700，按耐久换算）就出侧跃（权重写在招式里，这里记最近受伤：每秒回落 200 × 耐久比例）。
 *   · 龙卷：二阶段转阶段时风涡分出两根、之后龙卷招每次两根（三阶段三根）；火龙卷被吸回来烧它。
 *   · 风涡柱：开打时在出生点（WindVortex）立一根 40 m 的螺旋带柱，三阶段反转，死时一圈圈松开散掉。
 *   · 死亡「风止」：珠子散成一团风 → 侧倒（down 片段）→ 风涡柱散掉、风停下。
 * 与 Unity 的差异：
 *   · 风场是本首领自己算的（同 Unity WindAttractor：smoothstep 权重、方向朝 / 背着它），没有接 F 路的全局 WindField（随 M7），
 *     顺风 / 逆风 ±25% 步速没有（网页玩家没有这个口子）；贴地风线没有。
 *   · 二阶段起、珠子在的时候「带电」（Charge.Hold，火一碰焚雷；M8 接上，见 update）。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../../core/types';
import type { BossPhaseDef } from '../framework/BossDef';
import type { BossMove } from '../framework/BossMove';
import type { BossIntroScript } from '../intro/BossIntroScript';
import { FeilianDef } from './FeilianDef';
import { feilianIntro } from './FeilianIntro';
import { createFeilianMove } from './FeilianMoves';
import { FeilianPalette } from './FeilianPlans';
import { FEILIAN_TORNADO_DEF, FeilianTornado, type TornadoOwner } from './FeilianTornado';
import { LordBrain } from './LordBrain';
import { LordFx, Spiral } from './LordFx';

export const FEILIAN_DEF: EnemyDef = {
  id: FeilianDef.Id, name: '飞廉', hp: FeilianDef.TierHp / 3.4, speed: 7, radius: 1.6, height: 5, damage: 16,
  coins: [60, 100], essence: 60, isBoss: true, headY: 4.2, headRadius: 0.45, knockbackResist: 1, color: FeilianPalette.Wind,
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const smooth = LordBrain.smooth;

export class Feilian extends LordBrain implements TornadoOwner {
  readonly fdef: FeilianDef;
  /** 风涡柱 */
  vortex: Spiral | null = null;
  readonly tornadoes: FeilianTornado[] = [];
  fireTornadoes = 0;
  crashes = 0;
  /** 2 s 内挨的打（侧跃用） */
  recentDamage = 0;
  /** 风雷爆蓄力 0..1（招式写） */
  storm = 0;
  /** 狂风出手段剩余秒数（猛推，招式写） */
  gustLeft = 0;
  readonly gustDir = new THREE.Vector3(0, 0, 1);
  /** 擂台风：开着、强度（−1 推 / +1 吸 / 0 停）、推人速度 */
  windOn = false;
  windStrength = 0;
  windPushNow = 0;
  /** 风推着玩家走过的距离（测试 / 调试） */
  windMoved = 0;

  private orb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private orbGone = 0;
  private windOff = 0;
  private landedIntro = false;
  private deathBurst = false;
  private phaseTornadoes = false;
  /** 常驻带电的撤销函数（Unity FeilianBrain.chargeHold） */
  private chargeHold: (() => void) | null = null;
  private readonly vortexAt = new THREE.Vector3();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    const def = new FeilianDef();
    super(ctx, FEILIAN_DEF, def, opts);
    this.fdef = def;
    this.vortexAt.copy(opts.position);
  }

  protected override createMove(id: string): BossMove | null {
    const spec = this.bdef.move(id);
    return spec ? createFeilianMove(this, spec) : null;
  }

  protected override introScript(): BossIntroScript | null {
    return feilianIntro;
  }

  get orbIntact(): boolean {
    return this.orbGone <= 0;
  }

  // ───────────── 生成 / 登场 ─────────────

  protected override onLordModel(): void {
    const bone = this.bone(FeilianDef.WeakBone);
    if (bone) {
      // 风雷珠：程序化的发光球（Unity FeilianOrb），挂在 orb 骨上
      const mat = new THREE.MeshBasicMaterial({ color: FeilianPalette.Orb, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.clonedMats.push(mat);
      this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat);
      this.orb.renderOrder = 2;
      bone.add(this.orb);
    }
    this.orbGone = 0;
    this.recentDamage = 0;
    this.landedIntro = false;
    // 风涡柱：擂台中心（出生点）一根 40 m 的螺旋带
    // Unity FeilianSpiral.Create(vortexAt + 6 m, 3, 9, 40, 90)：底半径 3、顶半径 9、高 40 m、每秒转 90°
    this.vortex = new Spiral([FeilianPalette.WindCore, FeilianPalette.Wind, FeilianPalette.WindEdge], 3, 9, 40, 90);
    this.vortex.group.position.copy(this.vortexAt).setY(this.vortexAt.y + 6);
    this.ctx.stageGroup.add(this.vortex.group);
  }

  override onDamaged(result: DamageResult): void {
    super.onDamaged(result);
    if (this.introDone && this.alive) this.recentDamage += result.dealt;
  }

  /** 登场（5.4 s）：0–3.0 s 从 40 m 高的风涡里盘旋落下（半径 6 → 0、8 圈）→ 3.0 s 落地炸开一圈雪 → 人立长嘶 */
  protected override introTick(t: number, dt: number): void {
    const sec = t * Math.max(0.01, this.bdef.intro.seconds);
    if (sec < 3) {
      const k = smooth(sec / 3);
      const spin = (1 - k) * 8;
      this.model.position.set(Math.sin(spin) * 6 * (1 - k), 40 * (1 - k), Math.cos(spin) * 6 * (1 - k));
      this.model.rotation.y = spin + Math.PI / 2;
      if (this.ctx.rng.next() < dt * 20) LordFx.gather(this.ctx, this.model.getWorldPosition(_a).setY(_a.y + 2), FeilianPalette.Wind, 4, 0.3);
      return;
    }
    this.model.position.set(0, 0, 0);
    this.model.rotation.y = 0;
    if (this.landedIntro) return;
    this.landedIntro = true;
    LordFx.snowCrown(this.ctx, this.position, 2.2);
    this.ctx.fx.ring(_a.copy(this.position).setY(this.position.y + 0.1), 14, FeilianPalette.Snow, 0.5);
    this.shake(0.4, 0.4);
    this.playActFade('roar', 2.4, 0.1);
  }

  protected override onIntroEnd(): void {
    this.model.position.set(0, 0, 0);
    this.model.rotation.y = 0;
    this.windOn = true;
    this.tell('feilian_tip', '风一直把人往外推——打鹿角间的风雷珠；引它撞上冰脊、巨石', FeilianPalette.Wind, 60, 4);
  }

  // ───────────── 每帧 ─────────────

  override update(dt: number): void {
    super.update(dt);
    this.vortex?.update(dt);
    if (!this.alive) {
      this.chargeHold?.();
      this.chargeHold = null;
      return;
    }
    // 带电（M8 的 combat/Charge，Unity FeilianBrain）：二阶段起、珠子在的时候常驻带电，火一碰就是焚雷；珠碎 / 回到一阶段就撤
    const charge = (this.ctx.combat as unknown as { charge?: { isCharged(e: unknown): boolean; hold(e: unknown, src: unknown): () => void } }).charge;
    const charged = this.phase >= 1 && this.orbIntact && this.introDone;
    if (charge && charged && !this.untargetable && !charge.isCharged(this)) {
      this.chargeHold?.();
      this.chargeHold = charge.hold(this, this);
    } else if (!charged && this.chargeHold) {
      this.chargeHold();
      this.chargeHold = null;
    }
    this.recentDamage = Math.max(0, this.recentDamage - dt * 200 * this.webScale);
    if (this.orbGone > 0) {
      this.orbGone -= dt;
      if (this.orb) this.orb.scale.setScalar(this.orbGone > 3 ? 0.01 : 1 - this.orbGone / 3);
      if (this.orbGone <= 0) this.orbBack();
    }
    if (this.orb) {
      this.orb.visible = this.orbGone <= 3;
      this.orb.material.color.setHex(this.storm > 0 ? 0xe8dcff : FeilianPalette.Orb);
      if (this.storm > 0) this.orb.scale.setScalar(1 + this.storm * 0.6);
    }
    this.windOff = Math.max(0, this.windOff - dt);
    if (this.windOn) {
      let s = this.phase >= 2 ? 1 : -1;
      if (this.storm > 0) s = 1;
      if (this.gustLeft > 0) s = -1;
      this.windStrength = this.windOff > 0 || this.transitioning ? 0 : s;
      const d = this.fdef;
      this.windPushNow = this.windOff > 0 ? 0 : this.storm > 0 ? d.windPush + (d.stormPush - d.windPush) * this.storm : d.windPush;
      this.blowWind(dt);
    }
    // 狂风出手段：顺风猛推（9 m/s 量级），掩体后不推
    if (this.gustLeft > 0) {
      this.gustLeft -= dt;
      if (!this.covered(this.bonePos(FeilianDef.WeakBone, _a))) this.blowPlayer(_b.copy(this.gustDir).multiplyScalar(this.fdef.gustPush), dt);
    }
  }

  /** 擂台风推玩家（Unity WindField.PlayerPush × 吸引点的风强沿风向，扫掠移动） */
  private blowWind(dt: number): void {
    const s = this.windStrength, push = this.windPushNow;
    if (s === 0 || !(push > 0)) return;
    const p = this.ctx.player.position;
    const d = this.fdef;
    const dx = this.position.x - p.x, dz = this.position.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= d.windRadius || dist < 1e-3) return;
    const t = Math.min(1, Math.max(0, (d.windRadius - dist) / Math.max(0.01, d.windRadius - d.windCore)));
    const w = t * t * (3 - 2 * t);
    const strength = Math.min(1, Math.abs(s) * w);
    const sign = s > 0 ? 1 : -1;
    const before = _c.copy(p);
    this.blowPlayer(_b.set(dx / dist * sign * push * strength, 0, dz / dist * sign * push * strength), dt);
    this.windMoved += Math.hypot(p.x - before.x, p.z - before.z);
  }

  /** 从 from（风雷珠）到玩家胸口之间被冰脊 / 巨石挡住：狂风吹不到 */
  covered(from: THREE.Vector3): boolean {
    if (!this.playerFeet(_c)) return false;
    _c.y += 1.1;
    return !this.lineClear(from, _c);
  }

  // ───────────── 龙卷 ─────────────

  spawnTornado(at: THREE.Vector3): FeilianTornado | null {
    const p = at.clone();
    p.y = this.groundAt(_a.copy(at).setY(at.y + 2));
    const e = this.ctx.enemies.spawn(FEILIAN_TORNADO_DEF.id, { position: p, level: this.level });
    if (!(e instanceof FeilianTornado)) return null;
    e.owner = this;
    e.life = this.fdef.tornadoLife;
    this.tornadoes.push(e);
    return e;
  }

  forgetTornado(t: FeilianTornado): void {
    const i = this.tornadoes.indexOf(t);
    if (i >= 0) this.tornadoes.splice(i, 1);
  }

  get fdefForTornado() {
    return this.fdef;
  }

  hurtFromHazard(damage: number, from: THREE.Vector3): number {
    return this.hazards.hurt(damage, 'none', from);
  }

  burnSelf(damage: number, from: THREE.Vector3): void {
    const body = this.getBodyCenter(new THREE.Vector3());
    this.ctx.combat.damageEnemy(this, {
      base: damage, element: 'fire', source: 'status', elementChance: 1, canCrit: false, point: body,
      direction: body.clone().sub(from).normalize(), tags: ['environment'],
    });
    this.ctx.fx.explosion(body, 1.4, FeilianPalette.Fire);
  }

  onTornadoIgnited(): void {
    this.fireTornadoes++;
  }

  // ───────────── 阶段 ─────────────

  protected override onLordPhase(phase: number): void {
    this.phaseTornadoes = phase !== 1;
    if (phase === 2 && this.vortex) this.vortex.reversed = true;
  }

  /** 龙卷：跃上风涡底、悬停嘶鸣，1.2 s 时风涡分出两根龙卷落下 */
  protected override transitionTick(t: number, dt: number): void {
    this.facePlayerDeg(60, dt);
    if (this.phase !== 1) return;
    const k = smooth(t / 0.8), back = smooth((t - 2.2) / 0.8);
    this.model.position.y = 6 * k * (1 - back);
    if (!this.phaseTornadoes && t >= 1.2) {
      this.phaseTornadoes = true;
      for (const a of [70, -70]) this.spawnTornado(_a.copy(this.position).addScaledVector(LordBrain.dir(this.facingDeg + a, _b), 12));
    }
  }

  protected override onLordTransitionEnd(_phase: BossPhaseDef): void {
    this.model.position.y = 0;
    if (this.phase === 1) this.tell('feilian_tornado', '龙卷风柱追人——用火点着它，火龙卷会被风吸回去烧飞廉', FeilianPalette.Wind, 60, 4);
    if (this.phase === 2) this.tell('feilian_eye', '风向反了——风往它那里吸', FeilianPalette.Wind, 60, 3);
  }

  // ───────────── 破防 / 倒下 ─────────────

  protected override onLordBreak(_count: number): void {
    LordFx.shatter(this.ctx, this.bonePos(FeilianDef.WeakBone, _a), FeilianPalette.OrbCore, FeilianPalette.Orb);
    this.shake(0.35, 0.35);
    this.orbGone = this.fdef.orbRegrow;
    this.windOff = this.fdef.breakWindOff;
    this.storm = 0;
    if (this.orb) this.orb.scale.setScalar(0.01);
    this.setWeakPointActive(false);
    this.tell('feilian_break', '珠碎！飞廉侧倒，风停了', FeilianPalette.Wind, 4, 2.5);
  }

  private orbBack(): void {
    this.orbGone = 0;
    if (this.orb) this.orb.scale.setScalar(1);
    this.setWeakPointActive(true);
    LordFx.glint(this.ctx, this.bonePos(FeilianDef.WeakBone, _a), FeilianPalette.OrbCore);
  }

  protected override onLordDefeated(_result: DamageResult): void {
    this.windOn = false;
    this.windStrength = 0;
    this.gustLeft = 0;
    this.deathBurst = false;
  }

  /** 风止：0.2 s 珠子散成一团风 → 侧倒 → 1–5 s 风涡柱一圈圈松开、散掉；龙卷 0.5 s 内散掉 */
  override deathTick(t: number): void {
    if (t > 0.2 && !this.deathBurst) {
      this.deathBurst = true;
      LordFx.shatter(this.ctx, this.bonePos(FeilianDef.WeakBone, _a), FeilianPalette.WindCore, FeilianPalette.Wind);
      if (this.orb) this.orb.visible = false;
      for (const tr of [...this.tornadoes]) tr.dissipate();
    }
    const v = this.vortex;
    if (v) {
      const k = smooth((t - 1) / 4);
      v.setAlpha(1 - k);
      v.group.scale.set(1 + k * 0.8, 1 - k * 0.3, 1 + k * 0.8);
      if (k >= 1) {
        v.dispose();
        this.vortex = null;
      }
    }
  }

  protected override onLordReleased(): void {
    for (const tr of [...this.tornadoes]) tr.vanish();
    this.tornadoes.length = 0;
    this.vortex?.dispose();
    this.vortex = null;
  }
}
