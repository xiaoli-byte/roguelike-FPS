/**
 * 4-1 三领主招式的底座（Unity Bosses/Lords/LordMove.cs；时间轴照 docs/art/ch4-move-events.json：windup / active / recover = 同名片段的三段）：
 *   · 片段：前摇第一帧播整段片段（clip，默认 = 招式 id），按「设计时长 × (前摇 + 出手的实际 / 设计)」拉伸——出手事件在片段里的位置不变，
 *     所以释放帧和代码的出手时刻对齐（cue 先到者算）；收招被领主梯度 / 阶段节奏缩短时，片段尾巴由下一个状态的交叉淡入截掉。
 *   · 收招：recover = 设计值 × recoverScale（领主梯度 × 阶段节奏），出招第一帧按当时算。
 *   · 伤害：网页版的数值是难度 1 的绝对值 → dmg(web) 按首领伤害换算（含狂怒；难度倍率由危险物 hurt 再乘）。
 *   · 预警：地面圆 / 直线 / 扇形走 HazardSet 的招式组（招式结束 / 被打断撤回没填满的），记数 warned。危险填充一律正红（Unity TelegraphTone）。
 * 角度一律世界 yaw（度，0 = +Z，往 +X 为正）；网页场景是 Unity 的镜像（x 取反），左右相关的地方（侧跃、回旋）在招式里换算。
 */
import * as THREE from 'three';
import type { Element } from '../../../core/types';
import { BossMove } from '../framework/BossMove';
import type { BossMoveSpec } from '../framework/BossDef';
import { LordBrain } from './LordBrain';

/** 危险填充正红（Unity TelegraphTone.Danger） */
export const LORD_WARN = 0xff3b30;
const DEG = Math.PI / 180;
const _a = new THREE.Vector3();

export abstract class LordMove extends BossMove {
  /** 经危险物画的预警个数 */
  warned = 0;
  /** 最近一次出手（释放帧）的招式时间（秒）；没出过为 −1 */
  releasedAt = -1;
  /** 最近一次出招打中玩家几次 */
  hits = 0;
  private designWindup = -1;
  private designActive = 0;
  private designTotal = 0;
  private baseRecover = 0;

  constructor(spec: BossMoveSpec, protected readonly lord: LordBrain) {
    super(spec);
  }

  protected get ctx() {
    return this.lord.ctx;
  }

  protected get hz() {
    return this.lord.hazards;
  }

  /** 片段名（状态名）；null = 不播 */
  protected get clip(): string | null {
    return this.id;
  }

  /** 设计时长（片段长度，秒）：构造时的三段之和 */
  get designSeconds(): number {
    this.capture();
    return this.designTotal;
  }

  private capture(): void {
    if (this.designWindup >= 0) return;
    this.designWindup = this.windup;
    this.designActive = this.active;
    this.baseRecover = this.recover;
    this.designTotal = this.windup + this.active + this.recover;
  }

  protected override onStart(): void {
    this.capture();
    this.recover = this.baseRecover * this.lord.recoverScale;
    this.releasedAt = -1;
    this.hits = 0;
    this.prepare();
  }

  /** 子类的出招第一帧（选目标、记落点） */
  protected prepare(): void {}

  protected override onTelegraph(): void {
    this.playClip();
    this.telegraph();
  }

  /** 子类画预警（前摇第一帧） */
  protected telegraph(): void {}

  /** 按设计时长拉伸播整段片段（前摇被狂怒缩短时按比例缩） */
  protected playClip(state: string | null = this.clip, fade = 0.08): void {
    if (!state) return;
    this.capture();
    const k = (this.windupTime + this.designActive) / Math.max(0.01, this.designWindup + this.designActive);
    this.lord.playActFade(state, this.designTotal * k, fade);
  }

  /** 记一次释放帧 */
  protected markRelease(): void {
    this.releasedAt = this.t;
  }

  /** 网页原值伤害（难度 1 的绝对值）→ 本首领的招式伤害（含狂怒） */
  protected dmg(web: number): number {
    return this.damage(web / Math.max(1, this.lord.bdef.damage));
  }

  protected get facing(): number {
    return this.lord.facingDeg;
  }

  protected get yawToPlayer(): number {
    return this.yawTo(this.ctx.player.position);
  }

  protected yawTo(p: THREE.Vector3): number {
    return LordBrain.yawTo(this.lord.position, p, this.facing);
  }

  protected setFacing(yawDeg: number): void {
    this.lord.facingDeg = yawDeg;
  }

  protected turnToward(yawDeg: number, degPerSec: number, dt: number): void {
    this.setFacing(LordBrain.moveTowardsAngle(this.facing, yawDeg, degPerSec * dt));
  }

  protected static dir(yawDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
    return LordBrain.dir(yawDeg, out);
  }

  protected static flat(a: THREE.Vector3, b: THREE.Vector3): number {
    return LordBrain.flat(a, b);
  }

  /** 贴地 */
  protected onGround(p: THREE.Vector3): THREE.Vector3 {
    p.y = this.lord.groundAt(p);
    return p;
  }

  protected sfx(id: string, volume = 1, pitch = 1): void {
    this.lord.playSfx(id, volume, pitch);
  }

  // ───────────── 预警 ─────────────

  protected warnCircle(p: THREE.Vector3, radius: number, seconds: number): void {
    this.track(this.hz.groundWarning(p.x, p.y + 0.05, p.z, radius, seconds, LORD_WARN));
    this.warned++;
  }

  /** 直线预警：a → b，宽 width（米） */
  protected warnLine(a: THREE.Vector3, b: THREE.Vector3, width: number, seconds: number): void {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(len > 0.05)) return;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    this.track(this.hz.lineWarning(a.x, Math.min(a.y, b.y) + 0.05, a.z, yaw, len, width / 2, seconds, LORD_WARN));
    this.warned++;
  }

  /** 扇形预警：yaw（度）、半角（度）、半径 */
  protected warnSector(o: THREE.Vector3, yawDeg: number, halfAngleDeg: number, range: number, seconds: number): void {
    this.track(this.hz.sectorWarning(o.x, o.y + 0.05, o.z, yawDeg * DEG, halfAngleDeg * DEG, range, seconds, LORD_WARN));
    this.warned++;
  }

  /** 不画地面的预警（提示类）也计一次 */
  protected countWarning(): void {
    this.track(() => {});
    this.warned++;
  }

  /** 打玩家一下（走危险物：冲刺无敌躲得过、首领倒下不伤）；返回实际扣了多少 */
  protected hurtPlayer(damage: number, element: Element, from: THREE.Vector3, push: THREE.Vector3): number {
    if (this.lord.playerDashing) return 0;
    const d = this.hz.hurt(damage, element, from);
    if (d > 0) {
      this.hits++;
      this.lord.pushPlayer(push);
    }
    return d;
  }

  protected rng(min: number, max: number): number {
    return this.ctx.rng.range(min, max);
  }

  protected chance(p: number): boolean {
    return this.ctx.rng.next() < p;
  }

  protected get playerPos(): THREE.Vector3 {
    return _a.copy(this.ctx.player.position);
  }
}
