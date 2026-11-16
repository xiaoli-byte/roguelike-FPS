/**
 * 首领招式（Unity BossMove.cs 的网页版）：时间轴拆成三段——
 *   前摇 windup 秒：进入时 onTelegraph 画预警（预警时长 = 前摇时长，填满那一刻正好出手），每帧 onWindup；
 *   出手 active 秒（或子类的 activeDone 说结束）：进入时 onActiveBegin（一般在这里判定），每帧 onActive；
 *   收招 recover 秒：onRecover，然后结束，回到招式间隙（再喘 recovery × 阶段 / 狂怒 / 领主倍率）。
 * 出手时刻优先跟动画事件走（cue：片段事件表，经首领的 onAnimEvent 转来），没有事件就按时间兜底。
 * 打断（转阶段、硬直、死亡）：onEnd(true)，并撤回本招画出、还没填满的预警。
 * 调度参数（冷却、权重、首次可用延迟、限定阶段）来自纯数据 BossMoveSpec。一只首领一份招式对象。
 */
import type { BossMoveSpec } from './BossDef';

export type MoveStage = 'none' | 'windup' | 'active' | 'recover' | 'done';

/** 招式看得到的首领（framework/BossBrain 实现） */
export interface MoveHost {
  readonly phase: number;
  readonly formId: string | null;
  /** 前摇倍率（狂怒时缩短） */
  readonly windupScale: number;
  /** 招式伤害（基础伤害 × mult × 狂怒倍率；难度倍率由危险物 hurt 再乘） */
  moveDamage(mult: number): number;
  notifyTelegraph(m: BossMove): void;
  /** 播一个动作（片段名），拉伸到 seconds 秒 */
  playAct(state: string, seconds: number): void;
}

export abstract class BossMove {
  readonly spec: BossMoveSpec;
  cooldown: number;
  recovery: number;
  firstDelay: number;
  weight: number;
  minPhase: number;
  maxPhase: number;
  forms: string[] | null;
  stunnable: boolean;
  windup: number;
  active: number;
  recover: number;
  windupAnim: string | null = null;
  activeAnim: string | null = null;
  recoverAnim: string | null = null;

  host!: MoveHost;
  stage: MoveStage = 'none';
  /** 本招已进行的秒数（首帧为 0） */
  t = 0;
  /** 当前这一段已进行的秒数 */
  stageT = 0;
  cancelled = false;
  reachedActive = false;
  timesStarted = 0;
  timesActive = 0;
  telegraphCount = 0;
  /** 本次出招实际用的前摇时长 */
  windupTime = 0;

  private prevT = -1;
  private prevStageT = -1;
  private endActiveFlag = false;
  private endWindupFlag = false;
  private readonly cuesSeen = new Set<string>();
  private readonly cuesFired = new Set<string>();
  private readonly warnings: (() => void)[] = [];

  constructor(spec: BossMoveSpec) {
    this.spec = spec;
    this.cooldown = spec.cooldown;
    this.recovery = spec.recovery;
    this.firstDelay = spec.firstDelay;
    this.weight = spec.weight;
    this.minPhase = spec.minPhase;
    this.maxPhase = spec.maxPhase;
    this.forms = spec.forms ?? null;
    this.stunnable = spec.stunnable;
    this.windup = spec.windup;
    this.active = spec.active;
    this.recover = spec.recover;
  }

  get id(): string {
    return this.spec.id;
  }

  get name(): string {
    return this.spec.name ?? this.spec.id;
  }

  bind(host: MoveHost): void {
    this.host = host;
  }

  /** 当前形态 / 阶段下能不能出这一招（不看冷却和权重） */
  allowed(): boolean {
    const h = this.host;
    if (h.phase < this.minPhase || h.phase > this.maxPhase) return false;
    if (!this.forms || this.forms.length === 0) return true;
    return h.formId !== null && this.forms.includes(h.formId);
  }

  /** 出招权重（≤ 0 = 现在不出）：缺省 weight，子类按距离、召唤物数量改 */
  weightNow(): number {
    return this.weight;
  }

  begin(): void {
    this.stage = 'none';
    this.t = this.stageT = 0;
    this.prevT = this.prevStageT = -1;
    this.cancelled = this.reachedActive = this.endActiveFlag = this.endWindupFlag = false;
    this.cuesSeen.clear();
    this.cuesFired.clear();
    this.warnings.length = 0;
    this.timesStarted++;
    this.windupTime = Math.max(0, this.windup * this.host.windupScale);
    this.onStart();
    this.enter('windup');
  }

  /** 推进一帧；返回 true 表示招式结束 */
  step(dt: number): boolean {
    if (this.stage === 'done' || this.stage === 'none') return true;
    this.prevT = this.t;
    this.prevStageT = this.stageT;
    this.t += dt;
    this.stageT += dt;
    switch (this.stage) {
      case 'windup':
        this.onWindup(dt);
        if (this.stage === 'windup' && (this.endWindupFlag || this.windupDone)) this.enter('active');
        break;
      case 'active':
        this.onActive(dt);
        if (this.stage === 'active' && (this.endActiveFlag || this.activeDone)) this.enter('recover');
        break;
      case 'recover':
        this.onRecover(dt);
        if (this.stage === 'recover' && this.stageT >= this.recover) this.stage = 'done';
        break;
    }
    return this.stage === 'done';
  }

  private enter(s: MoveStage): void {
    this.stage = s;
    this.stageT = 0;
    this.prevStageT = -1;
    switch (s) {
      case 'windup':
        if (this.windupAnim) this.host.playAct(this.windupAnim, this.windupTime);
        this.onTelegraph();
        break;
      case 'active':
        this.reachedActive = true;
        this.timesActive++;
        if (this.activeAnim) this.host.playAct(this.activeAnim, this.active);
        this.onActiveBegin();
        break;
      case 'recover':
        if (this.recoverAnim) this.host.playAct(this.recoverAnim, this.recover);
        this.onRecoverBegin();
        break;
    }
  }

  /** 正常收招：onEnd(false)，并撤回提前结束的分支留下的预警 */
  finish(): void {
    this.stage = 'done';
    this.safeEnd(false);
    this.endWarnings();
  }

  /** 打断：onEnd(true)，撤回预警。可重复调用 */
  cancel(): void {
    if (this.stage === 'done' && this.cancelled) return;
    this.cancelled = true;
    this.stage = 'done';
    this.safeEnd(true);
    this.endWarnings();
  }

  private safeEnd(cancelled: boolean): void {
    try {
      this.onEnd(cancelled);
    } catch (err) {
      console.error(`[BossMove] ${this.id} onEnd threw`, err);
    }
  }

  /** 动画事件（首领转来）：记下来给 cue */
  onAnimEvent(name: string): void {
    if (name) this.cuesSeen.add(name);
  }

  // ───────────── 子类钩子 ─────────────

  protected onStart(): void {}
  protected onTelegraph(): void {}
  protected onWindup(_dt: number): void {}
  protected onActiveBegin(): void {}
  protected onActive(_dt: number): void {}
  protected onRecoverBegin(): void {}
  protected onRecover(_dt: number): void {}
  /** 结束或被打断（必须可重复调用） */
  protected onEnd(_cancelled: boolean): void {}

  protected get windupDone(): boolean {
    return this.stageT >= this.windupTime;
  }

  protected get activeDone(): boolean {
    return this.stageT >= this.active;
  }

  protected endWindup(): void {
    this.endWindupFlag = true;
  }

  protected endActive(): void {
    this.endActiveFlag = true;
  }

  // ───────────── 工具 ─────────────

  /** 本招的时间轴在这一帧越过 x 秒 */
  protected at(x: number): boolean {
    return this.prevT < x && this.t >= x;
  }

  /** 当前这一段的时间在这一帧越过 x 秒 */
  protected stageAt(x: number): boolean {
    return this.prevStageT < x && this.stageT >= x;
  }

  /**
   * 出手时刻：本招收到过名为 evt 的动画事件，或时间轴越过 fallback 秒，两者先到者算，每次出招只返回一次 true
   */
  protected cue(evt: string, fallback: number): boolean {
    if (this.cuesFired.has(evt)) return false;
    if (!this.cuesSeen.has(evt) && this.t < fallback) return false;
    this.cuesFired.add(evt);
    return true;
  }

  /** 这一次出招收到过这个动画事件 */
  protected sawCue(evt: string): boolean {
    return this.cuesSeen.has(evt);
  }

  protected damage(mult = 1): number {
    return this.host.moveDamage(mult);
  }

  /** 记一个预警的撤回函数（招式结束 / 被打断时撤回还没填满的），并让首领派发 telegraph 事件 */
  protected track(cancel: () => void): () => void {
    this.telegraphCount++;
    this.warnings.push(cancel);
    this.host.notifyTelegraph(this);
    return cancel;
  }

  /** 撤回本招还活着的预警（撤回函数只撤还没填满的） */
  protected endWarnings(): void {
    for (const c of this.warnings) {
      try {
        c();
      } catch (err) {
        console.error('[BossMove] cancel warning threw', err);
      }
    }
    this.warnings.length = 0;
  }

  toString(): string {
    return `${this.name}（${this.id}，${this.stage}，${this.t.toFixed(1)} s）`;
  }
}
