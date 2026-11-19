/**
 * 首领行为框架（Unity Bosses/BossBrain.cs 的网页版）：整套由 {@link BossDef} 驱动，具体首领继承它改走位 / 演出钩子，招式写成 {@link BossMove} 子类。
 * 继承网页原有的 BossBase（命中形状、美术挂载、危险物、溃散爆炸都沿用），但调度换成 Unity 的那套——其余首领不受影响，以后逐个改继承这里即可。
 *   登场：intro.seconds 秒不可选中、霸体；登场演出（intro/BossIntroDirector）接管时，演出交还镜头之前一直停在登场里；招式的首次可用时间从登场结束算起。
 *   阶段：生命层（不含护盾 / 护甲）跌破 phases[i].at → 等当前招式收尾（≤ phaseWait 秒，超时强制打断并撤回预警）→ 转换演出（不可选中、霸体，enemy:bossPhase）。
 *     阶段门槛：还有没走的阶段时，生命层最多打到下一道阈值（略低半点），越线后停在线上等转换演出——高输出不会一口气打穿一整段。
 *   抽招：可用（阶段 / 形态）、冷却到了、权重 > 0 的招式按权重随机；刚出过的那招 × repeatWeight；queueMove 指定下一招。招式之间喘 recovery × 阶段 × 狂怒 × 领主倍率。
 *   霸体：登场、转换、硬直、出招中（招式没标 stunnable）免疫眩晕；只有招式间隙能被眩晕（≤ 0.35 s、之后 6 s 免疫，BossBase 处理）。
 *   硬直 stagger：脚本化的倒地 / 踉跄，打断招式，可附带承伤倍率。狂怒：登场后 enrageAfter 秒或生命层低于 enrageBelow。
 *   召唤：{@link Summons}（上限、预警、倒下崩解）。破防条：{@link BreakBar}（定义里有才建）。领主梯度：{@link lordTierFor}。
 *   倒下：招式打断、召唤物崩解、倒下慢动作 + 提示（{@link beginDefeat}），溃散爆炸由 BossBase 放。
 *   动画事件：子类经 {@link emitAnimEvent} 派发（片段事件表），"sfx:<id>" / "fx:shake" 在这里处理，再转给当前招式（BossMove.cue）。
 * 受伤修饰（Unity Damageable.Incoming）：护体 ×0.2、硬直承伤、狂怒之类按 key 登记，乘在 damageTakenMult 上——
 * StatusSystem 每帧会把 damageTakenMult 重写成蚀化易伤，这里把它接成访问器：状态写进来的当底，读出去的是 底 × 本框架的修饰。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SfxId, SpawnOptions } from '../../../core/types';
import { clamp, clamp01, rotateTowards } from '../../../core/math';
import { BossBase } from '../BossBase';
import { roundHp, type BossDef, type BossFormDef, type BossPhaseDef } from './BossDef';
import { BossMove, type MoveHost } from './BossMove';
import { BreakBar } from './BreakBar';
import { beginDefeat, slowMo } from './DefeatSequence';
import { lordTierFor, recordLordDefeat, type LordTier } from './LordScaling';
import { Summons, summonOptions, type SummonHost } from './Summons';
import { TimePriority } from './TimeScaleArbiter';

interface Slot {
  move: BossMove;
  readyAt: number;
}

interface TransitionRun {
  def: BossPhaseDef;
  advances: boolean;
  swapped: boolean;
  t: number;
}

/** 登场演出导演对首领的约定（intro/BossIntroDirector 实现） */
export interface IntroHold {
  /** 该生成了（之前首领藏着、不动） */
  readonly spawnDue: boolean;
  /** 镜头交还了（之前首领停在登场里） */
  readonly released: boolean;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const DEG = Math.PI / 180;

export abstract class BossBrain extends BossBase implements MoveHost, SummonHost {
  readonly bdef: BossDef;
  readonly summons: Summons;
  readonly breakBar: BreakBar | null;
  readonly lord: LordTier;
  /** 当前形态 */
  form: BossFormDef | null;
  /** 正在出的招（招式间隙为 null） */
  currentMove: BossMove | null = null;
  readonly moveList: BossMove[] = [];
  introDone = false;
  enraged = false;
  enrageReason: string | null = null;
  /** 登场结束后的战斗时长（秒） */
  fightTime = 0;
  /** 登场演出（有就由它决定什么时候生成、什么时候交还） */
  protected introHold: IntroHold | null = null;
  /** 场地（圆）：中心与半径。Unity BossArena；网页按首领出生点 + 定义半径 */
  readonly bossCenter = new THREE.Vector3();
  arenaRadius = 40;
  /** 累计：出过的招、画过的预警（测试 / 调试） */
  movesStarted = 0;
  telegraphs = 0;
  /** 关掉阶段门槛（开发跳阶段用） */
  gateOff = false;
  /** 现身了（登场动作、吼声已经放过） */
  presented = false;

  private readonly moveSlots: Slot[] = [];
  private transition: TransitionRun | null = null;
  private lastMove: string | null = null;
  private queuedMove: string | null = null;
  private phaseWaitAcc = 0;
  private staggerLeft = 0;
  private strafeTimer = 0;
  private strafeSign = 1;
  private nextMark = 0;
  private readonly marks: { at: number; id: string }[] = [];
  private readonly takenMods = new Map<string, number>();
  private statusTaken = 1;
  private hpValue = 0;

  constructor(ctx: GameContext, enemyDef: EnemyDef, def: BossDef, opts: SpawnOptions) {
    super(ctx, enemyDef, opts);
    this.bdef = def;
    this.installAccessors();
    // 耐久：定档表（或 × 难度）× 领主梯度；伤害倍率照常 1 + (难度 − 1) × 0.55（EnemyBase）
    this.lord = lordTierFor(ctx.run?.flags, def.lordLevel);
    const v = def.vitalsAt(this.level);
    this.maxHp = this.hp = Math.max(1, roundHp(v.hp * this.lord.hpMult));
    this.maxShield = this.shield = Math.max(0, roundHp(v.shield));
    this.maxArmor = this.armor = Math.max(0, roundHp(v.armor));
    this.displayName = def.name;
    this.knockbackResist = 1;
    this.thresholds = def.phases.map(p => p.at);
    this.spawnDuration = Math.max(0.05, def.intro.seconds);
    this.deathDuration = Math.max(0.2, def.defeat.seconds);
    this.restLeft = Math.max(0, def.intro.firstRest);
    this.themeColor = def.color;
    this.form = def.firstForm;
    this.summons = new Summons(this);
    this.breakBar = def.breakBar ? new BreakBar(def.breakBar) : null;
    if (this.breakBar) this.breakBar.onBroke = (bar, n) => this.onBreakBarBroke(bar, n);
    for (const m of def.marks) this.marks.push({ at: m.at, id: m.id });
    this.marks.sort((a, b) => b.at - a.at);
    this.bossCenter.copy(opts.position);
  }

  /** hp / damageTakenMult 换成访问器（阶段门槛、受伤修饰），见类注释 */
  private installAccessors(): void {
    this.hpValue = this.hp;
    Object.defineProperty(this, 'hp', {
      configurable: true, enumerable: true,
      get: () => this.hpValue,
      set: (v: number) => {
        const floor = this.phaseGateFloor();
        this.hpValue = floor > 0 && v < floor ? floor : v;
      },
    });
    Object.defineProperty(this, 'damageTakenMult', {
      configurable: true, enumerable: true,
      get: () => {
        let k = this.statusTaken;
        for (const m of this.takenMods.values()) k *= m;
        return k;
      },
      set: (v: number) => {
        this.statusTaken = Number.isFinite(v) ? v : 1;
      },
    });
  }

  /** 阶段门槛：还有没走的阶段时，生命层最多打到下一道阈值（略低半点，让阈值判定成立） */
  private phaseGateFloor(): number {
    const def = this.bdef;
    if (!def || this.gateOff || !this.alive || this.phase >= def.phases.length) return 0;
    return Math.max(0, this.maxHp * def.phases[this.phase].at - 0.5);
  }

  // ───────────── MoveHost / SummonHost ─────────────

  get formId(): string | null {
    return this.form?.id ?? null;
  }

  get windupScale(): number {
    return this.enraged ? this.bdef.enrageWindupScale : 1;
  }

  /** 喘息倍率：阶段 restScale × 狂怒 × 领主 */
  get restScale(): number {
    return this.bdef.restScaleAt(this.phase) * (this.enraged ? this.bdef.enrageRestScale : 1) * this.lord.recoveryMult;
  }

  get summonCap(): number {
    return this.bdef.summonCap;
  }

  get warnColor(): number {
    return this.bdef.warn;
  }

  get transitioning(): boolean {
    return this.transition !== null;
  }

  get transitionTime(): number {
    return this.transition?.t ?? 0;
  }

  get staggered(): boolean {
    return this.staggerLeft > 0;
  }

  /** 距离计时狂怒还有多久（没有 / 已狂怒为 −1） */
  get enrageTimeLeft(): number {
    return this.bdef.enrageAfter > 0 && !this.enraged ? Math.max(0, this.bdef.enrageAfter - this.fightTime) : -1;
  }

  moveDamage(mult = 1): number {
    return this.bdef.damage * mult * (this.enraged ? this.bdef.enrageDamageScale : 1);
  }

  notifyTelegraph(_m: BossMove): void {
    this.telegraphs++;
  }

  /** 播一个动作（子类接片段播放器；缺省什么都不做） */
  playAct(_state: string, _seconds: number): void {}

  summonPoints(): readonly THREE.Vector3[] {
    return [];
  }

  override clampToArena(v: THREE.Vector3, margin: number): THREE.Vector3 {
    const c = this.bossCenter;
    const dx = v.x - c.x, dz = v.z - c.z;
    const d = Math.hypot(dx, dz);
    const max = Math.max(0, this.arenaRadius - margin);
    if (d > max && d > 1e-4) {
      v.x = c.x + dx / d * max;
      v.z = c.z + dz / d * max;
    }
    return super.clampToArena(v, margin);
  }

  /** 脚下的地面高度（BossBase 用场地的 floorY；Unity 关卡地面高低差很大，取首领脚下的真实地面） */
  protected override floorY(): number {
    const y = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 2, 0.1);
    return Number.isFinite(y) && y > this.position.y - 6 ? y : super.floorY();
  }

  arenaContains(p: THREE.Vector3, margin: number): boolean {
    return Math.hypot(p.x - this.bossCenter.x, p.z - this.bossCenter.z) <= this.arenaRadius - margin;
  }

  /** 走位离场地边界留多少（米）：身体半径 + 1 */
  get arenaMargin(): number {
    return this.radius + 1;
  }

  // ───────────── 契约 ─────────────

  override get untargetable(): boolean {
    return this.waitingForSpawn || !this.introDone || this.transition !== null || this.extraUntargetable;
  }

  override get stunImmune(): boolean {
    const d = this.bdef;
    return super.stunImmune || !this.alive || !d.stunBetweenMoves || !this.introDone || this.transition !== null || this.staggerLeft > 0
      || (this.currentMove !== null && !this.currentMove.stunnable);
  }

  /** 子类额外的不可选中 */
  protected get extraUntargetable(): boolean {
    return false;
  }

  /** 登场演出还没到生成时刻：首领藏着、不动、不计登场时间 */
  get waitingForSpawn(): boolean {
    return this.introHold !== null && !this.introHold.spawnDue && this.alive;
  }

  // ───────────── 生命周期 ─────────────

  override init(): void {
    this.buildMoves();
    super.init();
  }

  private buildMoves(): void {
    this.moveSlots.length = 0;
    this.moveList.length = 0;
    const seen = new Set<string>();
    for (const spec of this.bdef.moves) {
      let m: BossMove | null = null;
      try {
        m = this.createMove(spec.id);
      } catch (err) {
        console.error(`[Boss] ${this.bdef.id} 招式 ${spec.id} 创建失败`, err);
      }
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      m.bind(this);
      this.moveSlots.push({ move: m, readyAt: Infinity });
      this.moveList.push(m);
    }
  }

  /** 按定义里的招式 id 造运行时招式（子类实现） */
  protected abstract createMove(id: string): BossMove | null;

  override update(dt: number): void {
    if (this.waitingForSpawn) {
      // 演出的前几秒：首领还没现身（Unity 在 spawnAt 才生成），不推进登场、不受击
      this.root.visible = false;
      this.velocity.set(0, 0, 0);
      this.hazards.update(dt);
      return;
    }
    if (!this.root.visible && this.alive) this.root.visible = true;
    if (!this.presented && this.alive) {
      this.presented = true;
      this.guard('onPresent', () => this.onPresent());
    }
    super.update(dt);
    if (!this.alive) return;
    this.summons.tick();
    if (this.breakBar) {
      this.breakBar.locked = !this.introDone || this.transition !== null;
      this.breakBar.tick(dt);
    }
  }

  // BossBase 在登场时间里每帧调 entrance(age / spawnDuration)
  protected override entrance(t: number, dt: number): void {
    this.stopMoving();
    if (dt > 0) this.facePlayer(90 * DEG, dt);
    try {
      this.introTick(clamp01(t), dt);
    } catch (err) {
      console.error('[Boss] introTick threw', err);
    }
  }

  protected override idle(dt: number): void {
    this.idleMove(dt);
  }

  protected override think(dt: number): void {
    if (!this.introDone) {
      this.stepIntro(dt);
      return;
    }
    this.fightTime += dt;
    if (this.staggerLeft > 0) {
      this.stepStagger(dt);
      return;
    }
    if (this.transition) {
      this.stepTransition(dt);
      return;
    }
    this.checkMarks();
    this.checkEnrage();
    if (this.checkPhase(dt)) return;
    try {
      this.passiveTick(dt);
    } catch (err) {
      console.error('[Boss] passive threw', err);
    }
    if (this.currentMove) {
      this.stepMove(dt);
      return;
    }
    this.restLeft -= dt;
    if (!this.leashBack(dt)) {
      try {
        this.idleMove(dt);
      } catch (err) {
        console.error('[Boss] idle threw', err);
      }
    }
    if (this.restLeft <= 0) this.pickNext();
  }

  /** 登场动作播完之后（EnemyBase 已不在出生时间里）：演出镜头还没交还就继续停在登场里 */
  private stepIntro(dt: number): void {
    this.stopMoving();
    this.facePlayer(90 * DEG, dt);
    if (this.introHold && !this.introHold.released) {
      this.introTick(1, dt);
      return;
    }
    this.introDone = true;
    this.entranceDone = true;
    this.fightTime = 0;
    const now = this.ctx.time.now;
    for (const s of this.moveSlots) s.readyAt = s.move.firstDelay > 0 ? now + s.move.firstDelay : -Infinity;
    this.restLeft = Math.max(0, this.bdef.intro.firstRest);
    this.guard('onIntroEnd', () => this.onIntroEnd());
  }

  private leashBack(dt: number): boolean {
    if (this.arenaContains(this.position, -1.5)) return false;
    _v.copy(this.position);
    this.clampToArena(_v, this.arenaMargin + 2);
    this.moveTo(_v, this.bdef.speed * 1.2);
    this.faceMovement(240 * DEG, dt);
    return true;
  }

  // ───────────── 招式调度 ─────────────

  moveById(id: string): BossMove | null {
    return this.moveSlots.find(s => s.move.id === id)?.move ?? null;
  }

  override queueMove(id: string): void {
    this.queuedMove = id;
  }

  /** 立刻出某一招（测试 / 调试）：忽略冷却、权重、阶段；正在出的招被打断。登场、转换、硬直中不行 */
  forceMove(id: string): boolean {
    if (!this.alive || !this.introDone || this.transition || this.staggerLeft > 0 || this.stunTime > 0) return false;
    const s = this.moveSlots.find(x => x.move.id === id);
    if (!s) return false;
    this.abortCurrent();
    this.startSlot(s);
    return this.currentMove === s.move;
  }

  cooldownLeft(id: string): number {
    const s = this.moveSlots.find(x => x.move.id === id);
    return s ? Math.max(0, s.readyAt - this.ctx.time.now) : -1;
  }

  private pickNext(): void {
    const now = this.ctx.time.now;
    if (this.queuedMove) {
      const id = this.queuedMove;
      this.queuedMove = null;
      const qs = this.moveSlots.find(s => s.move.id === id);
      if (qs && qs.move.allowed()) {
        this.startSlot(qs);
        return;
      }
    }
    const cands: Slot[] = [];
    const weights: number[] = [];
    let others = false;
    for (const s of this.moveSlots) {
      if (now < s.readyAt || !s.move.allowed()) continue;
      let w: number;
      try {
        w = s.move.weightNow();
      } catch (err) {
        console.error('[Boss] weight threw', err);
        continue;
      }
      if (!(w > 0) || !Number.isFinite(w)) continue;
      cands.push(s);
      weights.push(w);
      if (s.move.id !== this.lastMove) others = true;
    }
    let total = 0;
    for (let i = 0; i < cands.length; i++) {
      if (others && cands[i].move.id === this.lastMove) weights[i] *= Math.max(0, this.bdef.repeatWeight);
      total += weights[i];
    }
    if (cands.length === 0 || !(total > 0)) {
      this.restLeft = 0.3;
      return;
    }
    let r = this.ctx.rng.next() * total;
    let pick = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r > 0 || weights[i] <= 0) continue;
      pick = cands[i];
      break;
    }
    this.startSlot(pick);
  }

  private startSlot(s: Slot): void {
    const m = s.move;
    this.currentMove = m;
    s.readyAt = this.ctx.time.now + Math.max(0, m.cooldown);
    this.lastMove = m.id;
    this.movesStarted++;
    this.stopMoving();
    try {
      m.begin();
    } catch (err) {
      console.error(`[Boss] ${m.id} begin threw`, err);
      this.abortCurrent();
      this.restLeft = 1;
      return;
    }
    this.guard('onMoveStarted', () => this.onMoveStarted(m));
  }

  private stepMove(dt: number): void {
    const m = this.currentMove!;
    let done: boolean;
    try {
      done = m.step(dt);
    } catch (err) {
      console.error(`[Boss] ${m.id} step threw`, err);
      this.abortCurrent();
      this.restLeft = 1;
      return;
    }
    if (done && this.currentMove === m) this.finishCurrent();
  }

  private finishCurrent(): void {
    const m = this.currentMove;
    this.currentMove = null;
    if (!m) return;
    m.finish();
    this.hazards.cancelMoveWarnings();
    this.restLeft = Math.max(0, m.recovery) * this.restScale;
    this.guard('onMoveEnded', () => this.onMoveEnded(m));
  }

  /** 打断当前招式（转换、硬直、死亡），撤回它还没兑现的预警 */
  abortCurrent(): void {
    const m = this.currentMove;
    if (!m) return;
    this.currentMove = null;
    m.cancel();
    this.hazards.cancelMoveWarnings();
    this.guard('onMoveEnded', () => this.onMoveEnded(m));
  }

  // ───────────── 阶段 ─────────────

  private checkPhase(dt: number): boolean {
    const def = this.bdef;
    if (this.phase >= def.phases.length) return false;
    const pd = def.phases[this.phase];
    if (this.phaseFraction() > pd.at) {
      this.phaseWaitAcc = 0;
      return false;
    }
    if (this.currentMove && this.phaseWaitAcc < def.phaseWait) {
      this.phaseWaitAcc += dt;
      return false;
    }
    this.phaseWaitAcc = 0;
    this.beginPhaseTransition(pd, true);
    return true;
  }

  private beginPhaseTransition(pd: BossPhaseDef, advances: boolean): void {
    this.abortCurrent();
    if (this.staggerLeft > 0) this.endStagger(false);
    this.breakBar?.cancel();
    if (advances) this.phase++;
    this.transition = { def: pd, advances, t: 0, swapped: !pd.form || this.form?.id === pd.form };
    this.stopMoving();
    this.playAct(pd.anim, pd.seconds);
    if (pd.sfx) this.ctx.audio.play(pd.sfx as SfxId, { position: this.position, volume: 1 });
    if (pd.shake > 0) this.quake(pd.shake, 0.9, 60);
    if (pd.toast) {
      if (this.bdef.phaseCinematic) this.ctx.ui.toast(pd.toast, hexColor(this.bdef.color));
      else this.ctx.ui.banner(pd.toast, undefined, clamp(pd.seconds, 1.6, 3));
    }
    this.summons.despawnPhaseBound();
    if (advances) {
      const p = this.phase;
      this.guard('onPhase', () => this.onPhase(p));
      this.ctx.events.emit('enemy:bossPhase', { enemy: this, phase: p });
    }
    if (pd.seconds <= 0) this.stepTransition(0);
  }

  private stepTransition(dt: number): void {
    const tr = this.transition!;
    tr.t += dt;
    this.stopMoving();
    if (dt > 0) this.facePlayer(60 * DEG, dt);
    try {
      this.transitionTick(tr.t, dt);
    } catch (err) {
      console.error('[Boss] transitionTick threw', err);
    }
    if (!tr.swapped && tr.t >= (tr.def.formSwapAt >= 0 ? Math.min(tr.def.formSwapAt, tr.def.seconds) : tr.def.seconds * 0.4)) {
      tr.swapped = true;
      this.switchForm(tr.def.form ?? null);
    }
    if (this.transition === tr && tr.t >= tr.def.seconds) this.endTransition();
  }

  private endTransition(): void {
    const tr = this.transition;
    this.transition = null;
    if (tr && !tr.swapped) this.switchForm(tr.def.form ?? null);
    this.restLeft = 0.4;
    if (tr?.def.firstMove) this.queuedMove = tr.def.firstMove;
    if (tr) this.guard('onTransitionEnd', () => this.onTransitionEnd(tr.def));
  }

  /** 换形（形态表里有就换，排上形态的第一招，护盾 / 护甲按形态回复） */
  switchForm(formId: string | null): void {
    const f = this.bdef.form(formId);
    if (!f || this.form === f) return;
    const prev = this.form;
    this.form = f;
    if (f.shieldRestore) this.shield = Math.max(this.shield, this.maxShield * clamp01(f.shieldRestore));
    if (f.armorRestore) this.armor = Math.max(this.armor, this.maxArmor * clamp01(f.armorRestore));
    if (f.firstMove) this.queuedMove = f.firstMove;
    this.guard('onFormChanged', () => this.onFormChanged(prev, f));
  }

  // ───────────── 刻度 / 狂怒 / 硬直 ─────────────

  private checkMarks(): void {
    while (this.nextMark < this.marks.length && this.phaseFraction() <= this.marks[this.nextMark].at) {
      const m = this.marks[this.nextMark++];
      this.guard('onMark', () => this.onMark(m.id));
    }
  }

  private checkEnrage(): void {
    if (this.enraged) return;
    const d = this.bdef;
    if (d.enrageAfter > 0 && this.fightTime >= d.enrageAfter) this.enrage('timer');
    else if (d.enrageBelow > 0 && this.phaseFraction() <= d.enrageBelow) this.enrage('health');
  }

  /** 进入狂怒：喘息与前摇缩短、伤害提高，只进一次 */
  enrage(reason = 'forced'): void {
    if (this.enraged || !this.alive) return;
    this.enraged = true;
    this.enrageReason = reason;
    if (this.bdef.enrageToast) this.ctx.ui.toast(this.bdef.enrageToast, hexColor(this.bdef.color));
    this.ctx.audio.play('boss_roar', { position: this.position, volume: 0.8, pitch: 1.2 });
    this.guard('onEnrage', () => this.onEnrage(reason));
  }

  /**
   * 硬直（脚本化的倒地 / 踉跄）：打断招式、停下、播动作，期间受伤 × takenMult。不受霸体与眩晕免疫期限制；登场、转换中不行
   */
  stagger(seconds: number, anim = 'Hit', takenMult = 1): boolean {
    if (!this.alive || !this.introDone || this.transition || !(seconds > 0) || !Number.isFinite(seconds)) return false;
    this.abortCurrent();
    this.stopMoving();
    this.staggerLeft = Math.max(this.staggerLeft, seconds);
    this.setTaken('stagger', takenMult > 0 && Math.abs(takenMult - 1) > 1e-4 ? takenMult : null);
    this.playAct(anim, seconds);
    this.guard('onStaggered', () => this.onStaggered(seconds));
    return true;
  }

  private stepStagger(dt: number): void {
    this.stopMoving();
    this.staggerLeft -= dt;
    if (this.staggerLeft <= 0) this.endStagger(true);
  }

  private endStagger(resume: boolean): void {
    this.staggerLeft = 0;
    this.setTaken('stagger', null);
    if (!resume || !this.alive) return;
    this.restLeft = Math.min(this.restLeft, 0.6);
  }

  private onBreakBarBroke(bar: BreakBar, count: number): void {
    const d = bar.def;
    if (!this.stagger(d.seconds, d.pose, d.takenMult)) {
      bar.cancel();
      return;
    }
    this.guard('onBreak', () => this.onBreak(count));
  }

  /** 受伤修饰（key → 倍率；null = 撤掉） */
  setTaken(key: string, mult: number | null): void {
    if (mult === null || !Number.isFinite(mult)) this.takenMods.delete(key);
    else this.takenMods.set(key, mult);
  }

  override onDamaged(result: DamageResult): void {
    super.onDamaged(result);
    if (!this.breakBar || !this.alive || !(result.dealt > 0)) return;
    // Unity OnBossDamaged：fillWhen 不满足（化蛇没张嘴）时不填；抛异常按不填算
    const when = this.breakBar.def.fillWhen;
    if (when) {
      try {
        if (!when(this)) return;
      } catch (err) {
        console.error(`[Boss] ${this.bdef.id} breakBar.fillWhen threw`, err);
        return;
      }
    }
    const tags = result.request.tags ?? [];
    this.breakBar.add(this.breakBar.fillFrom({ reaction: tags.includes('reaction'), weakpoint: !!result.request.headshot }, result.dealt));
  }

  // ───────────── 倒下 / 释放 ─────────────

  protected override onBossDeath(result: DamageResult): void {
    this.abortCurrent();
    this.transition = null;
    this.endStagger(false);
    this.breakBar?.cancel();
    this.summons.despawnAll();
    if (this.bdef.lordLevel) recordLordDefeat(this.ctx.run?.flags, this.bdef.lordLevel, this.bdef.id);
    beginDefeat(this.ctx, this, this.bdef.defeat, this.bdef.color);
    this.guard('onDefeated', () => this.onDefeated(result));
  }

  protected override onBossDispose(): void {
    this.abortCurrent();
    this.summons.despawnAll();
    this.guard('onReleased', () => this.onReleased());
  }

  // ───────────── 给招式 / 子类用的工具 ─────────────

  /** 以首领为中心的震屏（玩家越远越弱，range 米外没有） */
  quake(strength: number, duration = 0.4, range = 60): void {
    const d = this.distToPlayer();
    const k = range > 0 ? clamp01(1 - d / range) : 1;
    if (strength * k > 0.01) this.ctx.fx.shake(strength * k, duration);
  }

  playSfx(id: string, volume = 1, pitch = 1): void {
    if (id) this.ctx.audio.play(id as SfxId, { position: this.position, volume, pitch });
  }

  /** 首领的发光通道（0 = 主前摇）目标亮度（子类接材质） */
  glow(_channel: number, _value: number): void {}

  /** 动画事件（片段事件表）：通用的 sfx / 震屏，然后交给当前招式与子类 */
  emitAnimEvent(evt: string): void {
    if (!evt || !this.alive) return;
    if (evt.startsWith('sfx:')) this.playSfx(evt.slice(4));
    else if (evt === 'fx:shake') this.quake(0.35);
    this.currentMove?.onAnimEvent(evt);
    this.guard('onAnimEvent', () => this.onAnimEvent(evt));
  }

  /** 演出慢动作（框架优先级：压过顿帧、让给阵亡） */
  slowMo(scale: number, realSeconds: number): void {
    slowMo(this.ctx, this, scale, realSeconds, TimePriority.BossCinematic);
  }

  /** 立刻转向 p（水平） */
  faceNow(p: THREE.Vector3): void {
    const dx = p.x - this.position.x, dz = p.z - this.position.z;
    if (dx * dx + dz * dz > 1e-4) this.facing = Math.atan2(dx, dz);
  }

  turnToward(yaw: number, radPerSec: number, dt: number): void {
    this.facing = rotateTowards(this.facing, yaw, radPerSec * dt);
  }

  halt(): void {
    this.stopMoving();
  }

  /** 用于召唤的选项（缺省值同 Unity SummonOptions.Default） */
  protected summonOpts = summonOptions;

  private guard(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[Boss] ${this.bdef.id} ${what} threw`, err);
    }
  }

  // ───────────── 子类钩子 ─────────────

  /** 现身的那一刻（Unity BossBrain.Spawn 的末尾：登场动作、吼声、震屏）；有登场演出时是演出的 spawnAt */
  protected onPresent(): void {
    const intro = this.bdef.intro;
    this.playAct(intro.anim, intro.seconds);
    if (intro.sfx) this.playSfx(intro.sfx, 1);
    if (intro.shake > 0) this.quake(intro.shake, 0.9, 60);
  }

  /** 登场演出（t 0 → 1，期间不可选中） */
  protected introTick(_t: number, _dt: number): void {}
  protected onIntroEnd(): void {}
  /** 招式间隙的走位（缺省：保持 idleMinRange–idleMaxRange 的距离带，带内绕玩家侧移，都夹在场地里） */
  protected idleMove(dt: number): void {
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 2.5 + Math.random() * 2;
      this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    }
    const p = this.ctx.player.position;
    const tx = p.x - this.position.x, tz = p.z - this.position.z;
    const d = Math.hypot(tx, tz);
    const dx = d > 0.01 ? tx / d : Math.sin(this.facing), dz = d > 0.01 ? tz / d : Math.cos(this.facing);
    const sx = -dz * this.strafeSign, sz = dx * this.strafeSign;
    const min = this.bdef.idleMinRange, max = Math.max(min + 1, this.bdef.idleMaxRange);
    if (d < min) _w.set(this.position.x - dx * (min - d + 2) + sx * 2, this.position.y, this.position.z - dz * (min - d + 2) + sz * 2);
    else if (d > max) _w.set(p.x - dx * ((min + max) * 0.5), this.position.y, p.z - dz * ((min + max) * 0.5));
    else _w.set(this.position.x + sx * 4 + dx * 0.5, this.position.y, this.position.z + sz * 4 + dz * 0.5);
    this.clampToArena(_w, this.arenaMargin);
    this.moveTo(_w, this.bdef.speed);
    this.facePlayer(240 * DEG, dt);
  }
  /** 登场后每帧（招式中、间隙都调，转换 / 硬直中不调） */
  protected passiveTick(_dt: number): void {}
  protected override onPhase(_phase: number): void {}
  protected override transitionTick(_t: number, _dt: number): void {}
  protected onTransitionEnd(_phase: BossPhaseDef): void {}
  protected onFormChanged(_prev: BossFormDef | null, _next: BossFormDef): void {}
  protected onMark(_id: string): void {}
  protected onEnrage(_reason: string): void {}
  protected onStaggered(_seconds: number): void {}
  protected onBreak(_count: number): void {}
  protected onMoveStarted(_m: BossMove): void {}
  protected onMoveEnded(_m: BossMove): void {}
  protected onAnimEvent(_evt: string): void {}
  /** 倒下（召唤物已崩解） */
  protected onDefeated(_result: DamageResult): void {}
  /** 物体释放（换关 / 清场） */
  protected onReleased(): void {}
}

export function hexColor(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}
