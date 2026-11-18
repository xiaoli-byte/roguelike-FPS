import * as THREE from 'three';
import type { GameContext, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { JerboaBlade } from './JerboaBlade';
import type { ScaledEnemyDef } from '../EnemyBase';
import { GroundDecal } from '../bosses/Visuals';
import { spawnSlashArc } from '../fx/SlashArc';

export const SAND_WRAITH_DEF: ScaledEnemyDef = {
  id: 'sand_wraith', name: '沙魇', scale: 1.4, hp: 55, speed: 5.6, damage: 12,
  radius: 0.34, height: 1.1, headY: 0.92, headRadius: 0.19, knockbackResist: 0.2,
  coins: [1, 3], essence: 1, color: 0xd9b27a,
  // Unity 名册（M2，defs.json）：弱点骨骼、出手名额、站位、元素…
  weakBone: 'bell', role: 'melee', placement: 'flank', groundOnly: true,
};

/** 沙魇的招式常量（Unity SandWraithAI 的 public const，tests/enemy-framework.test.mjs 对照） */
export const SAND_WRAITH = {
  burrowMin: 3, burrowMax: 16, sinkTime: 0.45, tunnelSpeed: 9, tunnelMax: 2.4, surfaceTime: 0.6,
  eruptRadius: 2.2, eliteEruptRadius: 2.6, eruptMult: 1.3, eruptKnock: 6, eruptKnockUp: 3.5, recoverAfterErupt: 0.7,
  slashRange: 1.6, slashWindup: 0.35, recoverAfterSlash: 0.45, chainRange: 4,
  /** 沉进沙里的深度（模型局部单位）、出生升起用时 */
  sinkDepth: 1.3, riseTime: 0.7,
} as const;

const W = SAND_WRAITH;
/** 第一章沙色（Unity DesertKit.Sand / SandLight / Spark）与沙魇本体的焦沙色（EnemyVariant.Wraith.sandColor） */
const SAND = 0xd9b27a, SAND_LIGHT = 0xe8d2a6, SPARK = 0xffc46a, WRAITH_SAND = 0x75543b;

const _target = new THREE.Vector3(), _v = new THREE.Vector3();

/** JerboaBlade 的姿态按状态名摆：沙魇的状态映射过去（Unity 借跳鼠刀兵的 AC_：crouch 沉沙、spin 破沙旋斩、slashWindup / slash、recover） */
const POSE_OF: Record<string, string> = {
  stalk: 'chase', sink: 'crouch', burrow: 'crouch', surface: 'crouch', erupt: 'spin',
  slashWindup: 'slashWindup', slash: 'slash', recover: 'recover',
};

/**
 * 沙魇（Unity SandWraithAI，Unity 新增的第一章杂兵沙化版；网页借跳鼠刀兵的模型与姿态，沙化换皮）：侧翼伏击手。
 *   出生：从沙里升起（出生无敌那 0.7 s 里身体从地下冒出来，扬沙）。
 *   潜行 stalk：5.6 m/s 摇摆着逼近（左右换向 0.5–0.9 s），身上不停往下掉沙；冷却中在 2.4–5 m 绕圈。
 *   潜沙突袭：3–16 m、拿到近战名额 → 沉沙 0.45 s（下沉过半就打不到）→ 沙下潜行（9 m/s，最多 2.4 s，朝玩家预判位置拐弯，地上冒沙、闷响）
 *             → 定点 surface：脚下亮 2.2 m 预警圈 0.6 s（沙柱往上喷）→ erupt 破沙旋斩：圈内 ×1.3 伤害 + 往外掀开（6 / 3.5 m/s）→ 硬直 0.7 s。
 *             冷却 5.5–7.5 s；精英：圈 2.6 m，破沙后玩家还在 4 m 外就立刻再潜一次（每轮最多连一次）。
 *   贴脸（1.6 m 内）：举爪 0.35 s → 交叉爪击 → 收招 0.45 s。
 *   遁地中被眩晕 / 打断 / 玩家阵亡：立刻钻回地面（身体、可选中都还原）。
 */
export class SandWraith extends JerboaBlade {
  private burrowCd: number;
  private sink = 1;
  private wraithWindTime: number = W.slashWindup;
  private wraithRecoverTime: number = W.recoverAfterSlash;
  private wraithZigzagTimer = 0;
  private dustAt = 0;
  private sprayAt = 0;
  private fountainAt = 0;
  private rumbleAt = 0;
  private chained = false;
  private hitDone = false;
  private warning: GroundDecal | null = null;
  private readonly tunnelTarget = new THREE.Vector3();
  private readonly eruptAt = new THREE.Vector3();
  /** 累计：潜沙几次、破沙打中几次、精英连潜几次（测试 / 冒烟读） */
  burrows = 0;
  eruptHits = 0;
  chains = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, opts);
    this.state = 'stalk';
    this.burrowCd = ctx.rng.range(1, 3.5);
    this.spawnDuration = W.riseTime;
    this.accel = 20;
  }

  /** 遁地中（下沉过 80%）不可选中；出生 / 出场中同基类 */
  override get untargetable(): boolean {
    return super.untargetable || (this.sink > 0.8 && ['sink', 'burrow', 'surface', 'erupt'].includes(this.state));
  }

  /** 现在在沙下（看不见、打不到） */
  get underground(): boolean {
    return this.sink > 0.8;
  }

  /** 破沙的预警半径 */
  get eruptRange(): number {
    return this.isElite ? W.eliteEruptRadius : W.eruptRadius;
  }

  protected override artId(): string {
    return 'jerboa_blade';
  }

  protected override afterInit(): void {
    super.afterInit();
    // 沙魇本体的皮（Unity EnemyVariant.Wraith：沙化 0.95、焦沙色）：反照率往焦沙色拉
    const sand = new THREE.Color(WRAITH_SAND);
    this.model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshStandardMaterial) material.color.lerp(sand, 0.8);
      }
    });
  }

  override update(dt: number): void {
    super.update(dt);
    // 出生：从沙里升起（出生无敌期间基类不调 AI / 姿态，这里直接摆模型）
    if (this.alive && this.age < this.spawnDuration && !this.entering) {
      this.sink = 1 - this.smooth(this.age / W.riseTime);
      this.model.position.y = -this.sink * W.sinkDepth * this.sizeScale;
      this.spray(0.06, 3);
    }
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    if (this.burrowCd > 0) this.burrowCd -= dt * this.attackRate;
    const pp = this.ctx.player.position;
    switch (this.state) {
      case 'stalk': {
        this.glowTarget[0] = 0.15 + 0.1 * Math.sin(this.age * 3);
        this.sink = 0;
        const dy = Math.abs(pp.y - this.position.y);
        if (this.cooldown <= 0 && this.sees && d <= W.slashRange + 0.3 && dy < 1.6 && this.requestAttack('melee', 1.2)) {
          this.wraithWindTime = this.windupFrac(W.slashWindup, 0.24);
          this.stopMoving();
          this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.4, pitch: 1.3 });
          this.setState('slashWindup');
          break;
        }
        if (this.burrowCd <= 0 && d >= W.burrowMin && d <= W.burrowMax && dy < 2.5 && (this.sees || d < 10) && this.requestAttack('melee', 5)) {
          this.chained = false;
          this.beginSink();
          break;
        }
        this.wraithZigzagTimer -= dt;
        if (this.wraithZigzagTimer <= 0) {
          this.wraithZigzagTimer = this.ctx.rng.range(0.5, 0.9);
          this.strafeSign = -this.strafeSign || 1;
        }
        if (d > 5.5 || !this.sees) {
          // 摇摆着逼近：看得见时朝「玩家方向 + 0.55 侧向」前 4 m 走，看不见时直接寻路到玩家
          if (this.sees && d > 0.01) {
            const dx = (pp.x - this.position.x) / d, dz = (pp.z - this.position.z) / d;
            const sx = -dz * this.strafeSign, sz = dx * this.strafeSign;
            _target.set(this.position.x + (dx + sx * 0.55) * 4, this.position.y, this.position.z + (dz + sz * 0.55) * 4);
            this.navigate(_target, this.speed, 0.6);
          } else {
            this.approachPlayer(this.speed, 1.2);
          }
          this.faceMovement(9.4, dt);
        } else {
          if (this.cooldown > 0.3) this.keepBand(2.4, 5, this.speed * 0.85);
          else this.approachPlayer(this.speed, 0.8);
          this.faceTravel(dt);
        }
        // 一直往下掉沙
        this.dustAt -= dt;
        if (this.dustAt <= 0) {
          this.dustAt = this.ctx.rng.range(0.1, 0.18);
          _target.copy(this.position).y += this.ctx.rng.range(0.4, 1.1) * this.sizeScale;
          this.ctx.fx.burst(_target, SAND, 1, 0.4, 0.8, 0.08 * this.sizeScale, 3);
        }
        break;
      }
      case 'sink':
        this.stopMoving();
        this.facePlayer(5.24, dt);
        this.sink = this.smooth(this.stateTime / W.sinkTime);
        this.glowTarget[0] = 0.6;
        this.spray(0.05, 4);
        if (this.stateTime >= W.sinkTime) {
          this.sink = 1;
          this.setModelVisible(false);
          this.ambushPoint(this.tunnelTarget);
          this.burrows++;
          this.setState('burrow');
        }
        break;
      case 'burrow': {
        // 朝玩家拐弯（离得近时锁定，不贴身追）
        if (d > 3) this.ambushPoint(this.tunnelTarget);
        this.navigate(this.tunnelTarget, W.tunnelSpeed, 0.5);
        this.faceMovement(12.6, dt);
        this.spray(0.07, 3);
        this.rumbleAt -= dt;
        if (this.rumbleAt <= 0) {
          this.rumbleAt = 0.35;
          this.ctx.audio.play('footstep', { position: this.position, volume: 0.55, pitch: 0.4 });
        }
        const flat = Math.hypot(this.tunnelTarget.x - this.position.x, this.tunnelTarget.z - this.position.z);
        if (d < 1.4 || flat < 0.9 || this.stateTime >= W.tunnelMax) this.beginSurface();
        break;
      }
      case 'surface': {
        // 预警：地下的它定在这一点，沙柱往上喷
        this.stopMoving();
        const boost = clamp01(this.stateTime / Math.max(0.05, this.wraithWindTime));
        this.glowTarget[0] = 0.5 + 0.5 * boost;
        if (this.warning) {
          this.warning.time = this.stateTime;
          this.warning.fill = boost;
        }
        this.fountainAt -= dt;
        if (this.fountainAt <= 0) {
          this.fountainAt = 0.06;
          const a = this.ctx.rng.next() * Math.PI * 2, r = Math.sqrt(this.ctx.rng.next()) * this.eruptRange * 0.6;
          _target.set(this.eruptAt.x + Math.sin(a) * r, this.eruptAt.y + 0.1, this.eruptAt.z + Math.cos(a) * r);
          this.ctx.fx.burst(_target, SAND_LIGHT, 2, 1.2, 0.5, 0.22 * this.sizeScale, -6 * (0.5 + boost));
        }
        if (this.stateTime >= this.wraithWindTime) this.erupt();
        break;
      }
      case 'erupt':
        this.facePlayer(7, dt);
        this.sink = 1 - this.smooth(this.stateTime / 0.22);
        this.glowTarget[0] = 0.8;
        if (this.stateTime >= 0.38) {
          this.sink = 0;
          if (this.isElite && !this.chained && d >= W.chainRange && d <= W.burrowMax && this.requestAttack('melee', 5)) {
            this.chained = true;
            this.chains++;
            this.beginSink();
            break;
          }
          this.wraithRecoverTime = W.recoverAfterErupt;
          this.burrowCd = this.ctx.rng.range(5.5, 7.5);
          this.setState('recover');
        }
        break;
      case 'slashWindup':
        this.facePlayer(8, dt);
        this.glowTarget[0] = 1;
        if (d > 1) this.setMove(pp.x - this.position.x, pp.z - this.position.z, this.speed * 0.5);
        else this.stopMoving();
        if (this.stateTime >= this.wraithWindTime) {
          this.melee(W.slashRange, this.def.damage, 0.2);
          this.crossSlashFx();
          this.setState('slash');
        }
        break;
      case 'slash':
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), 1.5);
        if (this.stateTime >= 0.16) {
          this.stopMoving();
          this.wraithRecoverTime = W.recoverAfterSlash;
          this.setState('recover');
        }
        break;
      case 'recover':
        this.stopMoving();
        this.facePlayer(3.8, dt);
        this.sink = 0;
        this.glowTarget[0] = 0.1;
        if (this.stateTime >= this.wraithRecoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.rollCooldown(1.2, 2.2);
          this.setState('stalk');
        }
        break;
      default:
        this.sink = 0;
        this.setState('stalk');
    }
  }

  private smooth(t: number): number {
    const v = clamp01(t);
    return v * v * (3 - 2 * v);
  }

  /**
   * 保持在 [min, max] 距离带（Unity EnemyAI.KeepRange）：太近后撤 (min − d + 2) m 带 2 m 侧移、太远逼到带中、带内绕玩家侧移 4 m
   */
  private keepBand(min: number, max: number, speed: number): void {
    const pp = this.ctx.player.position;
    const dx = pp.x - this.position.x, dz = pp.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const ux = d > 0.01 ? dx / d : Math.sin(this.facing), uz = d > 0.01 ? dz / d : Math.cos(this.facing);
    const sx = -uz * this.strafeSign, sz = ux * this.strafeSign;
    if (d < min) _target.set(this.position.x - ux * (min - d + 2) + sx * 2, this.position.y, this.position.z - uz * (min - d + 2) + sz * 2);
    else if (d > max) _target.set(pp.x - ux * ((min + max) * 0.5), pp.y, pp.z - uz * ((min + max) * 0.5));
    else _target.set(this.position.x + sx * 4 + ux * 0.5, this.position.y, this.position.z + sz * 4 + uz * 0.5);
    this.navigate(_target, speed, 0.3);
  }

  /** 伏击点：玩家预判位置（0.35 s，只取水平速度）往自己这边退 0.6 m（不钻在玩家脚底正中；Unity AmbushPoint） */
  private ambushPoint(out: THREE.Vector3): THREE.Vector3 {
    const pl = this.ctx.player;
    out.set(pl.position.x + pl.velocity.x * 0.35, pl.position.y, pl.position.z + pl.velocity.z * 0.35);
    const bx = this.position.x - out.x, bz = this.position.z - out.z;
    const b = Math.hypot(bx, bz);
    if (b > 0.1) {
      out.x += (bx / b) * 0.6;
      out.z += (bz / b) * 0.6;
    }
    return out;
  }

  /** 钻沙 / 钻出的扬沙（Unity DesertKit.SandSpray） */
  private spray(every: number, count: number): void {
    this.sprayAt -= this.ctx.time.dt;
    if (this.sprayAt > 0) return;
    this.sprayAt = every;
    _v.copy(this.position).y += 0.1;
    this.ctx.fx.burst(_v, SAND, count, 0.7 * this.sizeScale, 0.4, 0.12 * this.sizeScale, -1);
  }

  private setModelVisible(on: boolean): void {
    this.model.visible = on;
  }

  private beginSink(): void {
    this.stopMoving();
    this.sink = 0;
    this.releaseWarning();
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.55, pitch: 0.75 });
    this.setState('sink');
  }

  private beginSurface(): void {
    this.stopMoving();
    this.eruptAt.copy(this.position);
    this.wraithWindTime = this.windupFrac(W.surfaceTime, 0.45);
    this.hitDone = false;
    this.releaseWarning();
    this.warning = GroundDecal.acquire(this.ctx.stageGroup, 0xff9a38).circle(this.eruptAt.x, this.eruptAt.y, this.eruptAt.z, this.eruptRange);
    this.warning.fill = 0;
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.8, pitch: 0.5 });
    this.ctx.audio.play('enemy_charge', { position: this.eruptAt, volume: 0.5, pitch: 0.7 });
    this.setState('surface');
  }

  /** 破沙旋斩（Unity Erupt）：圈内（水平 ≤ 半径 + 0.35、高差 ≤ 2.2）× 1.3 伤害，打中才往外掀；没打中近处一震 */
  private erupt(): void {
    this.setModelVisible(true);
    this.releaseWarning();
    this.ctx.audio.play('land', { position: this.position, volume: 0.7, pitch: 0.8 });
    this.ctx.audio.play('boss_slam', { position: this.eruptAt, volume: 0.45, pitch: 1.5 });
    this.setState('erupt');
    const range = this.eruptRange;
    if (!this.hitDone) {
      this.hitDone = true;
      const pl = this.ctx.player;
      const dx = pl.position.x - this.eruptAt.x, dz = pl.position.z - this.eruptAt.z, dy = pl.position.y - this.eruptAt.y;
      const h = Math.hypot(dx, dz);
      let hit = false;
      if (pl.alive && h <= range + 0.35 && Math.abs(dy) <= 2.2) {
        hit = this.ctx.combat.damagePlayer(this.def.damage * this.damageMult * W.eruptMult, 'none', this, this.eruptAt) > 0;
      }
      if (hit) {
        this.eruptHits++;
        const ux = h > 0.01 ? dx / h : Math.sin(this.facing), uz = h > 0.01 ? dz / h : Math.cos(this.facing);
        _v.set(ux * W.eruptKnock, W.eruptKnockUp, uz * W.eruptKnock);
        pl.applyImpulse(_v);
        this.ctx.fx.shake(0.35, 0.25);
      } else if (h < 10) {
        this.ctx.fx.shake(0.25 * (1 - h / 10), 0.25);
      }
    }
    const k = this.sizeScale;
    _v.copy(this.eruptAt).y += 0.2;
    this.ctx.fx.burst(_v, SAND, 22, 5, 0.8, 0.3 * k, 6);
    _v.y += 0.2;
    this.ctx.fx.burst(_v, SAND_LIGHT, 10, 2, 0.9, 0.45 * k, -3);
    _v.y += 0.2;
    this.ctx.fx.burst(_v, SPARK, 10, 4, 0.5, 0.06, 2);
    _v.copy(this.eruptAt).y += 0.08;
    this.ctx.fx.ring(_v, range, SAND_LIGHT, 0.4);
    _v.copy(this.eruptAt).y += 0.42 * k;
    spawnSlashArc(this.ctx, { center: _v, yaw: this.facing, radius: range * 0.85, arc: Math.PI * 1.9, width: 0.5 * k, duration: 0.26, color: 0xffb85c });
  }

  private releaseWarning(): void {
    this.warning?.release();
    this.warning = null;
  }

  /** 遁地中被打断：钻回地面上，身体 / 可选中都还原（Unity Resurface） */
  private resurface(): void {
    this.sink = 0;
    this.model.position.y = 0;
    this.setModelVisible(true);
    this.releaseWarning();
  }

  /** 被打断（眩晕、死亡、玩家阵亡、硬直；Unity CancelAttack）：钻回地面、熄灯，出招中被打断的重新排冷却 */
  protected override cancelAttack(): void {
    const was = this.state;
    if (was === 'sink' || was === 'burrow' || was === 'surface' || was === 'erupt') this.resurface();
    this.releaseWarning();
    this.glowTarget[0] = 0;
    if (was !== 'stalk' && was !== 'idle') {
      this.rollCooldown(0.8, 1.4);
      if (this.burrowCd < 2) this.burrowCd = this.ctx.rng.range(2, 3.5);
    }
    this.sink = 0;
    this.setState('stalk');
  }

  protected override onDispose(): void {
    this.releaseWarning();
    super.onDispose();
  }

  protected override pose(dt: number): void {
    // 借跳鼠刀兵的姿态：状态名映射过去摆（沉沙 = 蹲、破沙 = 旋斩、潜行 = 跳步）
    const own = this.state;
    this.state = POSE_OF[own] ?? own;
    try {
      super.pose(dt);
    } finally {
      this.state = own;
    }
    this.model.position.y = -this.sink * W.sinkDepth * this.sizeScale;
  }
}
