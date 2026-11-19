/**
 * 化蛇的行为（Unity Huashe/HuasheBrain.cs；定义 HuasheDef.ts，招式 HuasheMoves.ts，湖 HuasheLake.ts，登场 HuasheIntro.ts）：
 *   · 游：在湖里绕湖心岛游（HuasheLake 的游线，0.35 rad/s 往玩家那一侧的湖岸），浮在水面下 0.3 m；不走导航（位置一直由代码驱动）。
 *   · 嘴：只在张嘴时（吐水、扑咬、吼叫、潜游扑出、噎住）露出弱点，破防条也只在张嘴时填（HuasheDef 的 fillWhen 读 mouthOpen）。
 *   · 湿身：身体在水里（根节点低于水面 + 0.2 m）——雷殛伤害 × 1.5；玩家自己站在 6 m 内的水里打雷殛会电到自己（5，网页值）。
 *   · 涨水：二阶段湖水常驻 +1.2 m；吼叫再 +0.8 m（6 s 后 0.3 m/s 退）；泡在涨水里每秒 2；三阶段湖心起漩涡、泡在水里的人往湖心拉（1.6 m/s）。
 *     涨上来的水是一张半透明水面（FloodSheet，覆盖整个擂台、跟着水位升降；地形高于水面的地方自然盖住它）。
 *   · 死亡「水退」：翻肚子挣扎（choke）→ 1.6–4.6 s 沉下去 3 m → 1–5 s 湖水退回原位；4.6 s 后隐去。
 * 与 Unity 的差异：
 *   · 雷殛 × 1.5 网页没有按元素的承伤口子：雷殛打在湿身的化蛇上时补一记 0.5 倍的「湿身」伤害（同样的总量，多一个伤害数字）；
 *     灼烧只烧一半时长没有（状态系统按层重算剩余时间，随 M8）；涨水线白沫、湖心漩涡贴花换成 ctx.fx 的环。
 *   · 4-1 的湖心岛岛心 Unity 是场地下的 Island 标记（导出器没导），这里按 Level_4_1.Field.cs 的 Lakes[0].island 换成网页坐标。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../../core/types';
import type { BossPhaseDef } from '../framework/BossDef';
import type { BossMove } from '../framework/BossMove';
import { stageHooks } from '../framework/StageHooks';
import type { BossIntroScript } from '../intro/BossIntroScript';
import { HuasheDef } from './HuasheDef';
import { huasheIntro, setHuasheIntroLake } from './HuasheIntro';
import { HuasheLake, LAKE_NAME, type LakeWater } from './HuasheLake';
import { createHuasheMove, HuasheRoar } from './HuasheMoves';
import { HuashePalette } from './HuashePlans';
import { LordBrain } from './LordBrain';
import { FloodSheet, LordFx } from './LordFx';

export const HUASHE_DEF: EnemyDef = {
  id: HuasheDef.Id, name: '化蛇', hp: HuasheDef.TierHp / 3.4, speed: 6, radius: 1.6, height: 3.2, damage: 16,
  coins: [60, 100], essence: 60, isBoss: true, headY: 2.6, headRadius: 0.5, knockbackResist: 1, color: HuashePalette.Water,
};

/** 4-1 圣湖的湖心岛（Level_4_1.Field.cs Lakes[0].island = (−152, −153)，规格坐标 → 网页 (152, 153)） */
export const HOLY_LAKE_ISLAND: Readonly<Record<string, [number, number]>> = { '4-1': [152, 153] };

interface SceneWaterDoc {
  name: string;
  center: number[];
  scale: number[];
  rotation: number[];
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const smooth = LordBrain.smooth;

export class Huashe extends LordBrain {
  readonly hdef: HuasheDef;
  lake: HuasheLake | null = null;
  /** 游线参数（弧度） */
  swimAngle = 0;
  /** 招式接管位置（扑岸、潜游）：不按游线摆 */
  driven = false;
  /** 嘴张着（招式写；噎住时也算） */
  mouthForced = false;
  /** 吼叫涨水剩余的停留秒数 */
  surgeHold = 0;
  wetShocks = 0;
  selfShocks = 0;
  soaks = 0;

  private flood: FloodSheet | null = null;
  private soakT = 0;
  private whirlT = 0;
  private breached = false;
  private phaseFlood0 = 0;
  private deathFlood0 = 0;
  private deathSurge0 = 0;
  private deathY0 = 0;
  private readonly spawnAt = new THREE.Vector3();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    const def = new HuasheDef();
    super(ctx, HUASHE_DEF, def, opts);
    this.hdef = def;
    this.spawnAt.copy(opts.position);
    // 先建湖（登场演出的锚点要用湖心）
    this.lake = this.buildLake();
    setHuasheIntroLake(this.lake);
  }

  protected override createMove(id: string): BossMove | null {
    const spec = this.bdef.move(id);
    return spec ? createHuasheMove(this, spec) : null;
  }

  protected override introScript(): BossIntroScript | null {
    return huasheIntro;
  }

  get mouthOpen(): boolean {
    return this.mouthForced || !!this.breakBar?.broken;
  }

  /** 身体泡在水里（湿身）：游动时根节点在水面下 0.3 m；扑上岸搁浅时根节点高出水面就不算 */
  get wet(): boolean {
    return !!this.lake && this.position.y < this.lake.level + 0.2;
  }

  // ───────────── 湖 ─────────────

  private buildLake(): HuasheLake {
    const ground = (x: number, z: number, fromY: number): number | null => {
      const y = this.ctx.world.groundHeight(x, z, fromY, 0);
      return Number.isFinite(y) ? y : null;
    };
    let water: LakeWater | null = null;
    const bodies = stageHooks.water?.waterBodies() ?? [];
    const hit = bodies.find(b => b.name.startsWith(LAKE_NAME));
    if (hit) water = { name: hit.name, center: hit.center.clone(), scale: hit.scale.clone(), quaternion: hit.quaternion.clone() };
    if (!water) {
      // 关卡钩子没登记（检视页）：读场景文档里的水体
      const doc = (this.ctx.stage as unknown as { unityDocument?: { water?: SceneWaterDoc[] } | null }).unityDocument;
      const w = doc?.water?.find(x => x.name.startsWith(LAKE_NAME));
      if (w) {
        water = {
          name: w.name, center: new THREE.Vector3(w.center[0], w.center[1], w.center[2]), scale: new THREE.Vector3(w.scale[0], w.scale[1], w.scale[2]),
          quaternion: new THREE.Quaternion(w.rotation[0], w.rotation[1], w.rotation[2], w.rotation[3]),
        };
      }
    }
    const docId = (this.ctx.stage as unknown as { unityDocument?: { id?: string } | null }).unityDocument?.id ?? '';
    const isl = HOLY_LAKE_ISLAND[docId];
    const island = water && isl ? new THREE.Vector3(isl[0], 0, isl[1]) : null;
    return new HuasheLake(this.bossCenter, this.arenaRadius, water, ground, island);
  }

  /** 摆到游线上（depth = 水面下多深） */
  placeOnSwim(depth: number): void {
    if (!this.lake) return;
    const yaw = { deg: 0 };
    this.lake.swimPoint(this.swimAngle, depth, _a, yaw);
    this.drive(_a);
    this.facingDeg = yaw.deg;
  }

  // ───────────── 生成 / 登场 ─────────────

  protected override onLordModel(): void {
    this.beginDash();
    if (this.lake) {
      this.surgeHold = 0;
      this.swimAngle = this.lake.angleOf(this.spawnAt) - 0.5;
      this.placeOnSwim(-3);
    }
    this.breached = false;
    this.model.visible = false;
  }

  override onDamaged(result: DamageResult): void {
    super.onDamaged(result);
    if (!this.alive || result.element !== 'shock' || !this.wet || !(result.dealt > 0)) return;
    const tags = result.request.tags ?? [];
    if (tags.includes('huashe_wet')) return;
    // 湿身：雷殛 × 1.5（补 0.5 倍）
    this.wetShocks++;
    this.ctx.combat.damageEnemy(this, {
      base: result.dealt * (this.hdef.wetShock - 1), element: 'none', source: 'status', canCrit: false, tags: ['huashe_wet'],
      point: this.getBodyCenter(new THREE.Vector3()),
    });
    // 玩家自己泡在 6 m 内的水里打雷殛：电到自己
    if (result.request.source === 'status') return;
    const pl = this.ctx.player;
    if (!pl.alive || pl.invulnerableTime > 0 || !this.lake || !this.playerInWater(pl.position)) return;
    if (Math.hypot(pl.position.x - this.position.x, pl.position.z - this.position.z) > this.hdef.selfShockRange) return;
    this.ctx.combat.damagePlayer(this.moveDamage(this.hdef.selfShockDamage / Math.max(1, this.bdef.damage)) * this.damageMult, 'shock', this, this.position.clone());
    this.selfShocks++;
    this.ctx.fx.lightning(_a.copy(pl.position).setY(pl.position.y + 0.2), this.getBodyCenter(_b), HuashePalette.Mouth);
    this.tell('huashe_selfshock', '水导电——你也泡在水里', HuashePalette.Mouth, 5, 1.6);
  }

  /** 登场（5.6 s）：0–2.2 s 水下一道长黑影游向冒头的地方（模型藏着，水面涟漪）→ 2.2 s 破水而出（rise 片段）→ 张嘴吼 */
  protected override introTick(t: number, dt: number): void {
    const lake = this.lake;
    if (!lake) return;
    const sec = t * Math.max(0.01, this.bdef.intro.seconds);
    const target = lake.angleOf(this.spawnAt);
    if (sec < 2.2) {
      const d = LordBrain.deltaAngle(this.swimAngle * 180 / Math.PI, target * 180 / Math.PI) * Math.PI / 180;
      this.swimAngle += d * Math.min(1, dt * 1.2);
      this.placeOnSwim(-3 + 1.2 * Math.min(1, sec / 2.2));
      if (this.ctx.rng.next() < dt * 8) LordFx.ripple(this.ctx, _a.set(this.position.x + this.ctx.rng.range(-2, 2), lake.level, this.position.z + this.ctx.rng.range(-2, 2)), 1.6);
      return;
    }
    if (!this.breached) {
      this.breached = true;
      this.model.visible = true;
      LordFx.splash(this.ctx, _a.set(this.position.x, lake.level, this.position.z), 1.6);
      this.shake(0.4, 0.4);
      this.playActFade('rise', 3.0, 0.05);
    }
    this.placeOnSwim(-1.5 + 1.2 * Math.min(1, Math.max(0, (sec - 2.2) / 0.8)));
    this.facePlayerDeg(115, dt);
  }

  protected override onIntroEnd(): void {
    this.model.visible = true;
    this.tell('huashe_tip', '它张嘴的时候打嘴；引它扑上岸——搁浅时最好打', HuashePalette.Water, 60, 4);
  }

  // ───────────── 每帧 ─────────────

  /** 间隙：往玩家那一侧的湖岸游 */
  protected override idleMove(dt: number): void {
    const lake = this.lake;
    if (!lake) return;
    const target = lake.angleOf(this.ctx.player.position);
    const d = LordBrain.deltaAngle(this.swimAngle * 180 / Math.PI, target * 180 / Math.PI) * Math.PI / 180;
    const rate = this.hdef.swimRate * lake.swimRateScale * (this.slowMult < 1 ? 0.6 : 1);
    this.swimAngle += Math.max(-rate * dt, Math.min(rate * dt, d));
    this.placeOnSwim(-0.3);
  }

  override update(dt: number): void {
    super.update(dt);
    const lake = this.lake;
    if (!this.alive || !lake) return;
    // 吼叫涨水停留 → 退
    const roaring = this.currentMove instanceof HuasheRoar;
    if (this.surgeHold > 0 && !roaring) this.surgeHold -= dt;
    else if (this.surgeHold <= 0 && !roaring) lake.surge = Math.max(0, lake.surge - dt * this.hdef.surgeFall);
    this.tickFlood();
    // 弱点（嘴）只在张嘴时开
    this.setWeakPointActive(this.mouthOpen && this.introDone);
    if (this.mouthOpen && this.introDone && this.ctx.rng.next() < dt * 6) LordFx.glint(this.ctx, this.bonePos(HuasheDef.MouthBone, _a), HuashePalette.Mouth);
    // 不出招也不在转阶段时浮在水面附近；噎住时浮在水面
    if (this.introDone && !this.currentMove && !this.transitioning && !this.staggered && !this.driven) {
      _a.copy(this.position);
      _a.y += (lake.level - 0.3 - _a.y) * Math.min(1, dt * 3);
      this.drive(_a);
    }
    if (this.breakBar?.broken) {
      _a.copy(this.position);
      _a.y += (lake.level - 0.2 - _a.y) * Math.min(1, dt * 3);
      this.drive(_a);
    }
    this.soak(dt);
    this.whirl(dt);
  }

  /** 涨水面跟着水位（Flood + Surge > 0.05 时才有） */
  private tickFlood(): void {
    const lake = this.lake!;
    const f = lake.flood + lake.surge;
    if (f > 0.05 && !this.flood) {
      this.flood = new FloodSheet(this.ctx.stageGroup, _a.set(lake.center.x, lake.level, lake.center.z), this.arenaRadius + 4, HuashePalette.Shallow);
    }
    if (!this.flood) return;
    this.flood.level = lake.level;
    if (f <= 0.02) {
      this.flood.dispose();
      this.flood = null;
    }
  }

  /** 玩家泡在水里（湖里或涨上来的水里，脚低于水面 5 cm 以上） */
  playerInWater(feet: THREE.Vector3): boolean {
    const lake = this.lake;
    if (!lake) return false;
    if ((stageHooks.water?.depthAt(feet) ?? 0) > 0.05) return true;
    if (feet.y >= lake.level - 0.05) return false;
    if (lake.inLake(feet, 1.05)) return true;
    // 涨上来的水：覆盖整个擂台
    return !!this.flood && Math.hypot(feet.x - lake.center.x, feet.z - lake.center.z) <= this.arenaRadius + 4;
  }

  private soak(dt: number): void {
    const lake = this.lake!;
    if (!this.introDone || lake.flood + lake.surge < 0.3 || !this.playerFeet(_a)) return;
    const inWater = this.playerInWater(_a);
    this.soakT -= dt;
    if (inWater && this.soakT <= 0) {
      this.soakT = 0.5;
      if (this.hazards.hurt(this.moveDamage(this.hdef.soakDamage * 0.5 / Math.max(1, this.bdef.damage)), 'none', _b.copy(_a).setY(_a.y - 1)) > 0) this.soaks++;
    }
    if (inWater && this.phase >= 2) {
      const to = _c.set(lake.center.x - _a.x, 0, lake.center.z - _a.z);
      if (to.lengthSq() > 1) this.blowPlayer(to.normalize().multiplyScalar(this.hdef.whirlPull), dt);
    }
  }

  private whirl(dt: number): void {
    if (this.phase < 2 || !this.introDone) return;
    this.whirlT -= dt;
    if (this.whirlT > 0) return;
    this.whirlT = 3.5;
    const lake = this.lake!;
    const r = Math.min(lake.rx, lake.rz) * 0.5;
    for (const k of [1, 0.66, 0.33]) this.ctx.fx.ring(_a.set(lake.center.x, lake.level + 0.05, lake.center.z), r * k, HuashePalette.Foam, 1.6);
  }

  // ───────────── 阶段 ─────────────

  protected override onLordPhase(_phase: number): void {
    this.phaseFlood0 = this.lake?.flood ?? 0;
    this.driven = false;
    this.mouthForced = true;
  }

  protected override transitionTick(t: number, dt: number): void {
    this.facePlayerDeg(60, dt);
    this.placeOnSwim(-0.2);
    const lake = this.lake;
    if (this.phase === 1 && lake) lake.flood = this.phaseFlood0 + (this.hdef.flood - this.phaseFlood0) * smooth((t - 0.6) / 2.4);
    if (this.ctx.rng.next() < dt * 2.5) {
      const m = this.bonePos(HuasheDef.MouthBone, _a);
      this.ctx.fx.ring(_b.set(m.x, (lake?.level ?? m.y) + 0.05, m.z), 6, HuashePalette.Mouth, 0.6);
    }
  }

  protected override onLordTransitionEnd(_p: BossPhaseDef): void {
    this.mouthForced = false;
    if (this.phase === 1 && this.lake) this.lake.flood = this.hdef.flood;
    if (this.phase === 1) this.tell('huashe_flood', '湖水涨上来了——上塔林、巨石、玛尼堆，泡在水里会掉血', HuashePalette.Water, 60, 4);
    if (this.phase === 2) this.tell('huashe_deluge', '湖水打漩——泡在水里会被往湖心拉', HuashePalette.Water, 60, 3);
  }

  // ───────────── 破防 / 倒下 ─────────────

  protected override onLordBreak(_count: number): void {
    LordFx.shatter(this.ctx, this.bonePos(HuasheDef.MouthBone, _a), HuashePalette.MouthCore, HuashePalette.Mouth);
    if (this.lake) this.lake.surge = Math.min(this.lake.surge, 0.2);
    this.surgeHold = 0;
    this.driven = false;
    this.tell('huashe_break', '噎住了！化蛇翻着肚子浮在水面——打', HuashePalette.Water, 4, 2.5);
  }

  protected override onLordDefeated(_result: DamageResult): void {
    this.deathFlood0 = this.lake?.flood ?? 0;
    this.deathSurge0 = this.lake?.surge ?? 0;
    this.deathY0 = this.position.y;
  }

  /** 水退：翻肚子挣扎 → 1.6–4.6 s 沉下去 3 m → 1–5 s 湖水退回原位；4.6 s 后隐去 */
  override deathTick(t: number, dt: number): void {
    const lake = this.lake;
    if (!lake) return;
    const sink = smooth((t - 1.6) / 3);
    _a.copy(this.position);
    _a.y = this.deathY0 - 3 * sink;
    this.position.copy(_a);
    this.velocity.set(0, 0, 0);
    lake.flood = this.deathFlood0 * (1 - smooth((t - 1) / 4));
    lake.surge = this.deathSurge0 * (1 - smooth((t - 1) / 2));
    this.tickFlood();
    if (sink > 0 && this.ctx.rng.next() < dt * 6) LordFx.ripple(this.ctx, _b.set(_a.x, lake.level, _a.z), 2);
    if (t > 4.6 && this.model.visible) this.model.visible = false;
    if (t > 5.4 && this.flood) {
      this.flood.dispose();
      this.flood = null;
    }
  }

  protected override onLordReleased(): void {
    this.flood?.dispose();
    this.flood = null;
    setHuasheIntroLake(null);
  }
}
