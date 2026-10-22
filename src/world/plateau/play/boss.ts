/**
 * 领主 / 首领的底座（chuanzang-combat-v1.md 第 4 节「领主通用」）：
 * - 登场演出（镜头接管、环境变化、名字卡）→ 三阶段（血 66% / 33% 转阶段演出）→ 死亡演出（慢放、环绕、场地恢复）；
 * - 招式时间轴（前摇 / 出手 / 收招，和 Unity BossMove 一致）、按阶段 / 冷却 / 权重抽招；
 * - 破防条：打弱点、反应伤害填它，满了破防（倒地 / 跪下几秒，受伤 +30%，下一次多填 25%）；
 * - 难度梯度 tier（第几个打的领主）：血量 ×(1 + 0.15 tier)，收招 ×(1 − 0.1 tier)。
 * 各领主只写演出（introShot / transition / deathShot）、招式表、think()（选招、走位）和 onEvent()（时间点上做什么）。
 */
import * as THREE from 'three';
import type { NativeBody } from '../../../assets/NativeRig';
import { CreatureAnimator, newAnimState, type AnimState, type Gait, type Stage } from './anim';
import type { Actor, DamageInfo, HitSphere, PlayCtx } from './core';
import { StatusBag } from './elements';
import type { Foe } from './foe';
import type { WarnHandle } from './fx';
import { MoveRunner, movesOf, type MoveDef } from './moves';
import type { Shot } from './cinema';
import type { BossBar } from './hud';

export interface BossSphere { bone: string; r: number; mult: number; part?: string }

const _v = new THREE.Vector3();

export abstract class Boss implements Actor, BossBar {
  readonly isBoss = true;
  readonly status = new StatusBag();
  readonly move = new MoveRunner();
  readonly anim: AnimState = newAnimState();
  readonly animator: CreatureAnimator | null;
  readonly pos = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  readonly baseHp: number;
  phase = 1;
  active = false;
  defeated = false;
  /** 奖励已发（只发一次） */
  rewarded = false;
  /** 演出中（登场、转阶段、死亡）：不受伤、不出招 */
  inShow = false;
  /** 擂台中心与半径 */
  readonly arena: THREE.Vector2;
  readonly arenaR: number;
  /** 破防条 */
  breakAcc = 0;
  breaks = 0;
  brokenT = 0;
  /** 第几个打的领主（难度梯度） */
  tier = 0;
  /** 召来的帮手：PlayMode 把它们当普通雷魅更新、加进 actors */
  readonly adds: Foe[] = [];
  /** 静电护盾层数（帮手连鼓灵给的，每层完全挡一次伤害）、加速（红鼓） */
  shieldLayers = 0;
  haste = 0;
  /** 演出里的姿势（登场 / 转阶段 / 死亡时由 Shot.tick 摆） */
  protected show: { id: string; stage: Stage; k: number } | null = null;
  /** 已出过的招（试玩脚本检查覆盖） */
  get used(): Map<string, number> { return this.move.count; }
  protected cd = 2;
  protected readonly mem: Record<string, number> = {};
  protected flash = 0;
  protected deadT = 0;
  protected stunT = 0;
  protected warns: WarnHandle[] = [];
  protected pendingPhase = 0;
  protected readonly hitList: HitSphere[];
  private lastPick = '';

  constructor(
    readonly id: string,
    readonly label: string,
    hp: number,
    protected readonly breakMax: number,
    readonly host: THREE.Group,
    readonly body: NativeBody | null,
    gait: Gait,
    readonly model: string,
    protected readonly sphereSpec: BossSphere[],
    readonly ctx: PlayCtx,
    arena: { x: number; z: number; r: number },
  ) {
    this.animator = body ? new CreatureAnimator(body.pose, gait, model) : null;
    this.hp = this.maxHp = this.baseHp = hp;
    this.arena = new THREE.Vector2(arena.x, arena.z);
    this.arenaR = arena.r;
    this.hitList = sphereSpec.map(s => ({ c: new THREE.Vector3(), r: s.r, mult: s.mult, part: s.part }));
    ctx.scene.add(host);
  }

  get alive(): boolean { return !this.defeated; }
  get group(): unknown { return this; }
  abstract readonly phaseNames: string[];
  get phaseName(): string { return this.phaseNames[this.phase - 1] ?? ''; }
  get breakK(): number { return Math.min(1, this.breakAcc / (this.breakMax * (1 + 0.25 * this.breaks))); }
  get broken(): boolean { return this.brokenT > 0; }
  /** 雷兽一直带电；其他领主覆盖 */
  charged(): boolean { return false; }
  charge(_sec: number): void {}

  center(out: THREE.Vector3): THREE.Vector3 { return this.boneWorld(this.sphereSpec[0].bone, out); }

  /** 难度梯度：开打时按已经打败了几个领主定 */
  setTier(n: number): void {
    this.tier = n;
    this.maxHp = Math.round(this.baseHp * (1 + 0.15 * n));
    if (!this.active) this.hp = this.maxHp;
  }

  /** 收招 / 招式间隙的时间倍率（阶段越后、梯度越高越短） */
  protected get tempo(): number { return (1 - 0.1 * this.tier) * (this.phase === 3 ? 0.75 : this.phase === 2 ? 0.9 : 1); }

  spheres(): readonly HitSphere[] {
    if (!this.host.visible || this.inShow && !this.defeated) return [];
    this.sphereSpec.forEach((s, i) => {
      this.boneWorld(s.bone, this.hitList[i].c);
      this.hitList[i].mult = this.weakMult(s);
      this.hitList[i].r = this.sphereR(s);
    });
    return this.hitList;
  }

  /** 弱点倍率（招式中张开的弱点在这里加大） */
  protected weakMult(s: BossSphere): number { return s.mult; }
  protected sphereR(s: BossSphere): number { return s.r; }

  hit(dmg: number, mult: number, at: THREE.Vector3, info: DamageInfo = { kind: 'bullet' }): number {
    if (this.defeated || !this.active || this.inShow || !this.host.visible) return 0;
    if (this.shieldLayers > 0 && info.kind !== 'dot') {
      this.shieldLayers--;
      this.ctx.fx.burst(at, 1.2, '#c792ff');
      return 0;
    }
    const extra = this.partMul(info.sphere, info, dmg);
    let d = dmg * mult * extra * (this.brokenT > 0 ? 1.3 : 1) * (this.status.vuln > 0 ? this.status.vulnMul : 1) * (this.stunT > 0 ? 1.15 : 1);
    if (d <= 0) return 0;
    // 不能一枪跨过阶段线：停在线上，转阶段演出之后再继续
    const line = this.phase === 1 ? 0.66 : this.phase === 2 ? 0.33 : 0;
    const floor = this.maxHp * line;
    if (this.hp - d < floor && this.phase < 3) { d = Math.max(0, this.hp - floor); this.pendingPhase = this.phase + 1; }
    this.hp -= d;
    this.flash = 1;
    this.anim.hurt = Math.min(1, this.anim.hurt + 0.15);
    // 破防条：弱点（倍率 > 1）和反应伤害填
    if (this.brokenT <= 0 && (mult > 1 || info.kind === 'reaction')) {
      this.breakAcc += d * (info.kind === 'reaction' ? 1.5 : 1);
      if (this.breakK >= 1) this.doBreak();
    }
    if (this.hp <= 0) { this.hp = 0; this.die(); }
    this.ctx.dealt(at, d, mult > 1, info);
    return d;
  }

  /** 部位倍率（领主自己的机关：鼓心、风雷珠……）；返回 0 表示吃掉 */
  protected partMul(_sphere: HitSphere | undefined, _info: DamageInfo, _dmg: number): number { return 1; }

  /** 加破防条（场地机关、回劈） */
  addBreak(v: number): void {
    if (this.brokenT > 0 || !this.active) return;
    this.breakAcc += v;
    if (this.breakK >= 1) this.doBreak();
  }

  private doBreak(): void {
    this.breakAcc = 0;
    this.interrupt();
    this.brokenT = this.breakTime;
    this.breaks++;
    this.onBreak();
  }

  protected abstract readonly breakTime: number;
  protected abstract onBreak(): void;

  /** 眩晕：sec = 0 是封脉的打断（只打断非霸体的前摇） */
  stun(sec: number, why: string): void {
    if (this.defeated || !this.active || this.inShow) return;
    if (sec <= 0) {
      if (this.move.stage === 'windup' && !this.move.def?.armored) { this.interrupt(); this.ctx.say(`${this.label}的${this.move.def?.name ?? '招式'}被${why}打断`, 1.4); this.cd = 0.8; }
      return;
    }
    this.interrupt();
    this.stunT = Math.max(this.stunT, sec);
    this.ctx.say(`${this.label}：${why}`, 1.6);
  }

  interrupt(): void {
    for (const w of this.warns) w.cancel();
    this.warns = [];
    if (this.move.busy) this.onInterrupt(this.move.id);
    this.move.cancel();
  }

  protected onInterrupt(_id: string): void {}

  /** 抽一招：按阶段、冷却、权重（weight 可以按距离改） */
  protected pick(moves: MoveDef[], weight: (m: MoveDef) => number = m => m.weight ?? 1): MoveDef | null {
    const now = this.ctx.time;
    const ok = moves.filter(m => (m.minPhase ?? 1) <= this.phase && (this.mem[`cd_${m.id}`] ?? 0) <= now);
    let total = 0;
    const ws = ok.map(m => { const w = Math.max(0, weight(m)) * (m.id === this.lastPick ? 0.35 : 1); total += w; return w; });
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < ok.length; i++) { r -= ws[i]; if (r <= 0) return this.use(ok[i]); }
    return this.use(ok[ok.length - 1]);
  }

  protected use(m: MoveDef): MoveDef {
    this.mem[`cd_${m.id}`] = this.ctx.time + (m.cooldown ?? 0);
    this.lastPick = m.id;
    return m;
  }

  protected begin(m: MoveDef): void {
    this.move.start(m);
    this.warns = [];
  }

  /** 强制出某一招（试玩脚本、以后烘焙 Unity 片段的强制场景用） */
  force(id: string): boolean {
    const def = movesOf(this.model).find(m => m.id === id);
    if (!def || !this.active || this.defeated) return false;
    this.interrupt();
    this.stunT = 0; this.brokenT = 0;
    this.begin(def);
    return true;
  }

  /** 试玩脚本：直接把血压到转阶段的线下 */
  toPhase(n: number): void {
    if (n <= this.phase || !this.active) return;
    this.hp = this.maxHp * (n === 2 ? 0.655 : 0.325);
    this.pendingPhase = n;
  }

  /** 试玩脚本：直接破防 */
  forceBreak(): void { this.addBreak(1e6); }

  // ─────────────── 开打 / 重置 ───────────────

  abstract shouldStart(): boolean;

  start(): void {
    if (this.active || this.defeated) return;
    this.active = true;
    this.inShow = true;
    this.phase = 1;
    this.pendingPhase = 0;
    this.breakAcc = 0; this.breaks = 0; this.brokenT = 0; this.stunT = 0;
    this.cd = 1.5;
    this.ctx.cinema.play({ ...this.introShot(), onEnd: () => { this.inShow = false; this.afterIntro(); } });
  }

  protected abstract introShot(): Shot;
  protected afterIntro(): void {}

  /** 战斗重置：回满血、回原位（玩家倒下或跑出擂台） */
  reset(): void {
    if (this.defeated) return;
    this.interrupt();
    this.active = false;
    this.inShow = false;
    this.hp = this.maxHp;
    this.phase = 1;
    this.pendingPhase = 0;
    this.breakAcc = 0; this.brokenT = 0; this.stunT = 0;
    this.pos.copy(this.home);
    this.status.clear();
    for (const a of this.adds) a.dispose();
    this.adds.length = 0;
    this.onReset();
  }

  protected onReset(): void {}

  // ─────────────── 转阶段 / 死亡 ───────────────

  private enterPhase(n: number): void {
    this.interrupt();
    this.phase = n;
    this.pendingPhase = 0;
    this.stunT = 0; this.brokenT = 0;
    this.ctx.fx.clearHostile();
    this.inShow = true;
    const shot = this.transition(n);
    this.ctx.cinema.play({ ...shot, onEnd: () => { this.inShow = false; shot.onEnd?.(); } });
  }

  /** 转阶段演出（2–3 秒，镜头可以不接管，只放横幅） */
  protected abstract transition(n: number): Shot;

  private die(): void {
    this.defeated = true;
    this.interrupt();
    this.deadT = 0;
    this.inShow = true;
    this.ctx.fx.clearHostile();
    for (const a of this.adds) if (a.alive) a.die({ kind: 'reaction' });
    this.ctx.cinema.play(this.deathShot());
  }

  /** 死亡演出（慢放、环绕、场地恢复、名字卡） */
  protected abstract deathShot(): Shot;

  // ─────────────── 每帧 ───────────────

  protected abstract think(dt: number, dist: number): void;
  protected onEvent(_ev: string, _dist: number): void {}
  protected idle(_dt: number): void {}
  /** 演出中（登场 / 转阶段 / 死亡）每帧：领主自己的演出动作在 Shot.tick 里，这里只管通用的 */
  protected showing(_dt: number): void {}

  update(dt: number): void {
    const ctx = this.ctx;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.anim.hurt = Math.max(0, this.anim.hurt - dt * 3);
    this.haste = Math.max(0, this.haste - dt);
    if (this.defeated) {
      this.deadT += dt;
    } else if (this.active && !this.inShow) {
      if (this.pendingPhase) this.enterPhase(this.pendingPhase);
      else {
        const dist = Math.hypot(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z);
        if (this.brokenT > 0) {
          this.brokenT -= dt;
          this.anim.stun = 0;
          this.whileBroken(dt);
        } else if (this.stunT > 0) {
          this.stunT -= dt;
          this.anim.stun = Math.min(1, this.anim.stun + dt * 4);
        } else {
          this.anim.stun = Math.max(0, this.anim.stun - dt * 3);
          this.cd -= dt;
          this.move.speed = this.status.slow > 0 ? 0.8 : 1;
          for (const ev of this.move.update(dt)) this.event(ev, dist);
          this.think(dt, dist);
        }
      }
    } else if (this.inShow) this.showing(dt);
    else this.idle(dt);
    this.render(dt);
    if (this.active && !this.defeated && this.host.visible) this.block();
  }

  private event(ev: string, dist: number): void {
    if (ev === 'glint') {
      const b = this.glintBone();
      if (b) this.ctx.fx.glint(this.boneWorld(b, _v).clone(), 2.2);
    }
    this.onEvent(ev, dist);
  }

  protected glintBone(): string | null { return this.sphereSpec.find(s => s.mult > 1)?.bone ?? null; }

  protected whileBroken(_dt: number): void {}

  /** 摆姿势、闪白 */
  protected render(_dt: number): void {
    const ctx = this.ctx;
    this.host.position.copy(this.pos);
    this.host.rotation.y = this.yaw;
    if (this.show) {
      this.anim.pose = this.show.id; this.anim.stage = this.show.stage; this.anim.k = this.show.k;
    } else {
      this.anim.pose = this.brokenT > 0 ? this.downPose : this.move.id || this.posture;
      this.anim.stage = this.brokenT > 0 ? 'active' : this.move.stage ?? '';
      this.anim.k = this.brokenT > 0 ? 1 : this.move.stageK;
    }
    const look = Math.atan2(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z) - this.yaw;
    this.anim.look = this.active && !this.inShow ? Math.atan2(Math.sin(look), Math.cos(look)) : 0;
    this.animator?.apply(this.anim, ctx.time);
    if (this.body) {
      const m = this.body.materials[0] as THREE.MeshStandardMaterial;
      const br = this.brokenT > 0 ? 0.15 + 0.1 * Math.sin(ctx.time * 12) : 0;
      m.emissive.setRGB(this.flash * 0.6 + br, this.flash * 0.6 + br * 0.8, this.flash * 0.6 + br * 0.3);
    }
    this.host.updateMatrixWorld(true);
    this.after(_dt);
  }

  /** 破防时的姿势（动画状态名） */
  protected downPose = 'down';
  /** 不出招时的持续姿势 */
  protected posture = '';
  protected after(_dt: number): void {}

  /** 身体挡人：玩家走进这些骨骼周围 r 米就被推出去（夔落在人头上、飞廉冲过来不会让镜头钻进模型） */
  protected blockers: [string, number][] = [];

  private block(): void {
    const ctx = this.ctx, P = ctx.walker.feet;
    for (const [bone, r] of this.blockers) {
      this.boneWorld(bone, _v);
      const dx = P.x - _v.x, dz = P.z - _v.z, d = Math.hypot(dx, dz);
      if (d >= r || P.y > _v.y + r * 1.5 || P.y < this.pos.y - 1) continue;
      const k = (r - d) + 0.05;
      if (d < 1e-3) ctx.walker.shove(k, 0); else ctx.walker.shove(dx / d * k, dz / d * k);
    }
  }

  protected faceTo(x: number, z: number, dt: number, rate: number): void {
    let d = Math.atan2(x - this.pos.x, z - this.pos.z) - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  protected boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 {
    const b = this.body?.pose.bone(name);
    return b ? b.getWorldPosition(out) : out.copy(this.pos);
  }

  protected ground(x: number, z: number): number { return this.ctx.terrain.heightAt(x, z); }

  /** 燎的火落在这里（龙卷、烽火） */
  fireAt(_at: THREE.Vector3, _r: number): void {}
  /** 一道落雷劈下来了 */
  onBolt(_at: THREE.Vector3): void {}
}
