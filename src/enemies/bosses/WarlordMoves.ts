/**
 * 熔心魔将的九个招式（Unity Bosses/Warlord/Moves/*.cs 与 Bosses/Reference/WarlordMoves.cs 逐个翻译）：
 *   剑士化 v2：焰刃连斩 WarlordBladeCombo、居合一闪 WarlordIai、熔铜剑气 WarlordSwordWave（+ 飞行剑气 WarlordWaveRunner）、突刺冲锋 WarlordThrust、回旋斩 WarlordSpin；
 *   保留的参考招式：火焰横扫 WarlordSweep、跃击 WarlordLeap、陨石雨 WarlordMeteor；熔铜渠涨落 WarlordChannelSurge。
 * 常量、判定几何、刀序在 WarlordDef.ts（一处改数，测试读它）。伤害：Unity 的 Dmg(TS 原值) = 原值 × 狂怒倍率，危险物 hurt 再乘难度倍率（同 Unity）。
 * 动作：招式自己调 Warlord.act 起片段（片段按「出手事件在片段里的位置」拉伸到实际时间轴）；释放帧调 Warlord 的 bladeStroke / iaiCut / … 放顿帧 + 震屏 + 刀光。
 * 与 Unity 的差异：
 *   · 导航网格的台沿护栏（ScriptedMotion 的 BossLedgeDrop / LedgeNavReach）换成按地面高度探测：前方落差 2 m 以上就刹住（Warlord.beginDash 的 guarded）；
 *   · 跃击落点「贴到导航网格」换成夹进场地 + 贴地（Warlord.landingPoint）；
 *   · 熔铜渠（FoundryChannels）是 M7 的地图机关，场景文档还没导出：熔铜渠涨落走 Unity 的兜底写法（场地外圈环带熔岩）；
 *   · 火尾 / 火浪体积（Surge.Trail / Sheet）换成跟着身体喷的火星与冲击波环；月牙刀光照 Unity 自己做（WarlordFx.crescent）。
 */
import * as THREE from 'three';
import { BossMove } from './framework/BossMove';
import type { BossMoveSpec } from './framework/BossDef';
import type { Warlord } from './Warlord';
import {
  BladeCombo, ChannelSurge, EMBERS, FIRE, Iai, inLane, inRing, inSector, LAVA, Leap, Meteor, Spin, Sweep, SwordWave, Thrust, WARN,
  WarlordRef, WarlordSword, waveSweeps, yawOf, type Beat, type WaveShot,
} from './WarlordDef';
import * as Fx from './WarlordFx';
import { stageGates, type FoundryChannelsHook } from '../../world/mechanisms/StageGates';

const DEG = Math.PI / 180;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export function dir3(yawDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(yawDeg * DEG), 0, Math.cos(yawDeg * DEG));
}

/** 魔将招式的基类（Unity ReferenceMove + WarlordSwordMove 的工具） */
export abstract class WarlordMove extends BossMove {
  constructor(spec: BossMoveSpec, protected readonly w: Warlord) {
    super(spec);
  }

  protected get ctx() {
    return this.w.ctx;
  }

  protected get hz() {
    return this.w.hazards;
  }

  protected get phase(): number {
    return this.w.phase;
  }

  /** 狂怒：熔铜长刃、剑气变多、节奏压缩 */
  protected get fury(): boolean {
    return this.w.enraged || this.w.phase >= 2;
  }

  protected get reach(): number {
    return this.fury ? WarlordSword.FuryReach : 1;
  }

  /** TS 原值伤害换算成本首领的招式伤害（含狂怒；难度由 hurt 再乘） */
  protected dmg(tsBase: number): number {
    return this.damage(tsBase / Math.max(1, this.w.bdef.damage));
  }

  /** 首领脚下的地面高度 */
  protected get floor(): number {
    return this.w.groundY(this.w.position.x, this.w.position.z, this.w.position.y + 2);
  }

  protected onGround(p: THREE.Vector3): THREE.Vector3 {
    p.y = this.w.groundY(p.x, p.z, Math.max(p.y, this.w.position.y) + 3);
    return p;
  }

  /** 首领朝向（世界 yaw，度） */
  protected get facing(): number {
    return this.w.facing / DEG;
  }

  protected get yawToPlayer(): number {
    const p = this.ctx.player.position, b = this.w.position;
    const dx = p.x - b.x, dz = p.z - b.z;
    return dx * dx + dz * dz > 1e-4 ? yawOf(dx, dz) : this.facing;
  }

  protected turnTo(yawDeg: number, degPerSec: number, dt: number): void {
    this.w.turnToward(yawDeg * DEG, degPerSec * DEG, dt);
  }

  /** 玩家胶囊（脚底、半径）；没有玩家或已倒下返回 null */
  protected player(): { feet: THREE.Vector3; pr: number } | null {
    const p = this.ctx.player;
    return p.alive ? { feet: p.position, pr: p.radius } : null;
  }

  /** 打中玩家：扣血 + 冲量（米/秒）。返回是否真的扣到了 */
  protected strike(damage: number, from: THREE.Vector3, impulse: THREE.Vector3): boolean {
    if (this.hz.hurt(damage, 'fire', from) <= 0) return false;
    if (impulse.lengthSq() > 0.01) this.ctx.player.applyImpulse(impulse);
    return true;
  }

  protected act(state: string, seconds: number): void {
    this.w.act(state, seconds);
  }

  protected actCrossfade(state: string, seconds: number): void {
    this.w.actCrossfade(state, seconds);
  }

  protected glow(v: number): void {
    this.w.glow(0, v);
  }

  protected sfx(id: string, volume = 1, pitch = 1): void {
    this.w.playSfx(id, volume, pitch);
  }
}

// ───────────────────────────── 焰刃连斩 ─────────────────────────────

/**
 * 贴身三到五刀，左右交替，末刀双手下劈；节奏「快、快、顿、重」。每刀在前摇开始时画预警、起这一刀的动作：袈裟 / 逆袈裟 / 上挑是短扇形（预警 = 判定），
 * 下劈是往前的一条长条。袈裟、逆袈裟之后小幅前冲。
 */
export class BladeComboMove extends WarlordMove {
  private plan: readonly Beat[] = [];
  private yaws: number[] = [];
  private origins: THREE.Vector3[] = [];
  private warned = 0;
  private struck = 0;
  private planPhase = 0;
  private lungeUntil = -1;
  private reachNow = 1;
  hits = 0;

  get struckCount(): number {
    return this.struck;
  }

  get count(): number {
    return this.plan.length;
  }

  override weightNow(): number {
    const d = this.w.distToPlayer();
    return d < 5.5 ? 6 : this.w.phase >= 1 && d < 7 ? 1.5 : 0;
  }

  protected override onStart(): void {
    // 狂怒、射程在出招那一刻定下来
    this.planPhase = this.fury ? 2 : this.phase;
    this.reachNow = this.reach;
    this.plan = BladeCombo.plan(this.planPhase);
    this.yaws = new Array(this.plan.length).fill(0);
    this.origins = this.plan.map(() => new THREE.Vector3());
    this.warned = this.struck = 0;
    this.lungeUntil = -1;
    this.w.halt();
    this.sfx('telegraph', 1, 1.1);
  }

  protected override onTelegraph(): void {
    this.warn();
  }

  private get cleaveLength(): number {
    return (this.planPhase >= 1 ? BladeCombo.CleaveLen : BladeCombo.CleaveLen0) * this.reachNow;
  }

  private warn(): void {
    const k = this.warned++;
    const b = this.plan[k];
    this.yaws[k] = this.yawToPlayer;
    this.origins[k].copy(this.w.position);
    const g = this.onGround(this.origins[k].clone());
    const windup = BladeCombo.windupOf(b);
    if (b.stroke === 'cleave') this.track(this.hz.lineWarning(g.x, g.y, g.z, this.yaws[k] * DEG, this.cleaveLength, BladeCombo.CleaveHalfWidth, windup, WARN));
    else {
      const rise = b.stroke === 'rise';
      this.track(this.hz.sectorWarning(g.x, g.y, g.z, this.yaws[k] * DEG, (rise ? BladeCombo.RiseHalf : BladeCombo.SlashHalf) * DEG,
        (rise ? BladeCombo.RiseRange : BladeCombo.SlashRange) * this.reachNow, windup, WARN));
    }
    this.act(BladeCombo.stateOf(b.stroke), windup / WarlordSword.SlashHitAt);
    this.glow(1);
  }

  protected override get windupDone(): boolean {
    return this.t >= this.plan[0].strike;
  }

  protected override onWindup(dt: number): void {
    this.turnTo(this.yaws[0], 570, dt);
  }

  protected override onActiveBegin(): void {
    this.hit();
  }

  protected override onActive(dt: number): void {
    const t = this.t;
    if (this.warned < this.plan.length && t >= this.plan[this.warned].warn) this.warn();
    if (this.struck < this.warned && t >= this.plan[this.struck].strike) this.hit();
    if (this.warned > this.struck) this.turnTo(this.yaws[this.warned - 1], 570, dt);
    if (this.ctx.time.now < this.lungeUntil && this.w.distToPlayer() > 2.4) this.w.moveToward(dir3(this.facing, _a).multiplyScalar(2).add(this.w.position), 1.1);
    else this.w.halt();
  }

  protected override get activeDone(): boolean {
    return this.struck >= this.plan.length && this.t >= this.plan[this.plan.length - 1].strike + 0.45;
  }

  private hit(): void {
    const k = this.struck++;
    const b = this.plan[k];
    const yaw = this.yaws[k];
    const o = this.origins[k];
    const fwd = dir3(yaw);
    let hit = false;
    const pl = this.player();
    if (pl) {
      const inside = b.stroke === 'cleave' ? inLane(o, fwd, this.cleaveLength, BladeCombo.CleaveHalfWidth, pl.feet, pl.pr, 3)
        : b.stroke === 'rise' ? inSector(o, yaw, BladeCombo.RiseHalf, BladeCombo.RiseRange * this.reachNow, pl.feet, pl.pr, 3.4)
          : inSector(o, yaw, BladeCombo.SlashHalf, BladeCombo.SlashRange * this.reachNow, pl.feet, pl.pr, 3.4);
      if (inside) {
        const from = o.clone().setY(o.y + 1);
        hit = b.stroke === 'cleave' ? this.strike(this.dmg(24), from, fwd.clone().multiplyScalar(9).setY(4))
          // 上挑：把人挑起来（接下劈）
          : b.stroke === 'rise' ? this.strike(this.dmg(12), from, fwd.clone().multiplyScalar(3).setY(8.5))
            : this.strike(this.dmg(18), from, fwd.clone().multiplyScalar(7).setY(3));
      }
    }
    if (hit) {
      this.hits++;
      this.w.quake(0.3, 0.2);
      this.sfx('enemy_melee');
    } else this.sfx('enemy_melee', 0.8, 0.75);
    if (b.stroke === 'kesa' || b.stroke === 'gyaku') this.lungeUntil = this.ctx.time.now + 0.14;
    this.glow(0);
    this.w.bladeStroke(BladeCombo.stateOf(b.stroke), k, this.plan.length, yaw, hit, b.stroke === 'cleave' ? this.cleaveLength : 0);
  }

  protected override onEnd(): void {
    this.w.halt();
    this.glow(0);
  }
}

// ───────────────────────────── 居合一闪 ─────────────────────────────

type IaiLeg = 'aim' | 'dash' | 'sheathe' | 'rest';

/**
 * 拔剑式的居合重斩——「先过身，后见光」：按刀（0.95 / 0.85 / 0.75 s）时直线预警铺向玩家身后 4 m；拔刀 0.14 s 突进到线尾（不伤人）；
 * 纳刀「咔」那一帧整条线上的刀光才现形并判定（预警填满 = 收刀 = 刀光）。狂怒时回身再来一次（按刀 0.6 s）。
 */
export class IaiMove extends WarlordMove {
  private leg: IaiLeg = 'aim';
  private legT = 0;
  private wnd = 0;
  private sheathe = 0;
  private len = 0;
  private half = 0;
  private left = 0;
  private readonly from = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(0, 0, 1);
  cuts = 0;
  hits = 0;

  get lastLength(): number {
    return this.len;
  }

  override weightNow(): number {
    const d = this.w.distToPlayer();
    return d >= 5 && d <= 15 ? 2.8 : d < 5 ? 0.8 : 1.2;
  }

  protected override onStart(): void {
    this.left = this.fury ? 2 : 1;
    const first = this.phase >= 2 || this.fury ? 0.75 : this.phase >= 1 ? 0.85 : 0.95;
    this.aim(first * this.host.windupScale, false);
  }

  private aim(windupSeconds: number, again: boolean): void {
    this.leg = 'aim';
    this.legT = 0;
    this.wnd = windupSeconds;
    this.sheathe = Iai.sheatheFor(this.wnd);
    this.w.halt();
    this.from.copy(this.w.position);
    const want = this.w.predict(0.25, _a).sub(this.from).setY(0);
    const d = want.length();
    if (d < 0.5) dir3(this.facing, this.dir);
    else this.dir.copy(want).divideScalar(d);
    const edge = this.w.toEdge(this.from, this.dir, 1.5);
    let len = Math.min(Math.max(d + Iai.Beyond, Iai.MinLen), Iai.MaxLen * this.reach);
    len = Math.min(Math.max(len, Math.min(4, edge)), Math.max(3, edge));
    this.len = this.w.ledgeFreeRun(this.from, this.dir, len);
    this.half = this.phase >= 1 || this.fury ? Iai.HalfWidth : Iai.HalfWidth0;
    this.w.faceNow(_b.copy(this.w.position).add(this.dir));
    const g = this.onGround(this.from.clone());
    const total = this.wnd + WarlordSword.IaiDash + this.sheathe;
    this.track(this.hz.lineWarning(g.x, g.y, g.z, yawOf(this.dir.x, this.dir.z) * DEG, this.len, this.half, total, WARN));
    // 回身再斩时第一刀的片段正在退回待机：交叉淡入
    if (again) this.actCrossfade('iai', total / WarlordSword.IaiHitAt);
    else this.act('iai', total / WarlordSword.IaiHitAt);
    this.sfx('telegraph', 1, 0.9);
  }

  protected override get windupDone(): boolean {
    return this.stageT >= this.wnd;
  }

  protected override onWindup(dt: number): void {
    this.w.facePoint(_a.copy(this.w.position).add(this.dir), 400, dt);
    this.glow(Math.min(1, this.stageT / Math.max(0.01, this.wnd)));
  }

  /** 出手段由腿自己结束；8 s 兜底防卡死 */
  protected override get activeDone(): boolean {
    return this.stageT > 8;
  }

  protected override onActiveBegin(): void {
    this.dash();
  }

  private dash(): void {
    this.leg = 'dash';
    this.legT = 0;
    const dash = Math.max(1.5, this.len - 1.8);
    this.w.faceNow(_a.copy(this.w.position).add(this.dir));
    this.w.beginDash(this.dir.clone().multiplyScalar(dash / WarlordSword.IaiDash), 0);
    this.glow(1);
    this.sfx('enemy_charge', 1, 1.4);
    this.w.iaiDraw(this.from, this.dir, dash);
  }

  protected override onActive(dt: number): void {
    this.legT += dt;
    switch (this.leg) {
      case 'aim':
        this.w.facePoint(_a.copy(this.w.position).add(this.dir), 400, dt);
        if (this.legT >= this.wnd) this.dash();
        break;
      case 'dash':
        if (this.legT < WarlordSword.IaiDash && !(this.w.dashHitWall && this.legT > 0.04)) break;
        this.w.endDash();
        this.w.halt();
        this.leg = 'sheathe';
        // 纳刀从拔刀那一刻起算（撞上掩体提前停下也不提前出刀光）
        this.legT -= WarlordSword.IaiDash;
        break;
      case 'sheathe':
        this.w.halt();
        if (this.legT < this.sheathe) break;
        this.cut();
        this.leg = 'rest';
        this.legT = 0;
        break;
      default:
        this.w.halt();
        // 纳刀之后回身：胸口（地火之心）转向玩家
        this.w.facePoint(this.ctx.player.position, 260, dt);
        if (this.left > 0 && this.legT >= 0.3) this.aim(0.6 * this.host.windupScale, true);
        else if (this.left <= 0 && this.legT >= 0.5) this.endActive();
        break;
    }
  }

  private cut(): void {
    this.left--;
    this.cuts++;
    let hit = false;
    const pl = this.player();
    if (pl && inLane(this.from, this.dir, this.len, this.half, pl.feet, pl.pr, 3)) {
      const ox = pl.feet.x - this.from.x, oz = pl.feet.z - this.from.z;
      const side = ox * this.dir.z - oz * this.dir.x >= 0 ? 1 : -1;
      const lateral = new THREE.Vector3(this.dir.z, 0, -this.dir.x).multiplyScalar(side);
      const at = this.from.clone().addScaledVector(this.dir, this.len * 0.5).setY(this.from.y + 1);
      hit = this.strike(this.dmg(30), at, lateral.multiplyScalar(9).addScaledVector(this.dir, 3).setY(4));
    }
    if (hit) {
      this.hits++;
      this.sfx('enemy_melee', 1, 0.7);
    }
    this.sfx('skill_fire', 0.9, 1.3);
    this.glow(0);
    this.w.iaiCut(this.from, this.dir, this.len, this.half, hit);
  }

  protected override onEnd(): void {
    this.w.endDash();
    this.glow(0);
  }
}

// ───────────────────────────── 熔铜剑气 ─────────────────────────────

/**
 * 远程：挥刀把月牙剑光甩出去，贴地飞行。竖剑气窄而高（侧移躲），横剑气宽而矮（跳过去）。
 * 一阶段一道竖剑气；二阶段横 → 竖（重新瞄准）；狂怒「十字剑气」横（慢）+ 三道竖（快，±32°）。每道剑气沿飞行路线画一条长条预警（预警 = 判定）。
 */
export class SwordWaveMove extends WarlordMove {
  private pattern: { first: readonly WaveShot[]; second: readonly WaveShot[] } = SwordWave.pattern(0);
  private planPhase = 0;
  private wnd = 0;
  private gap = 0;
  private aim = 0;
  private aim2 = 0;
  private reachNow = 1;
  private second = false;
  private launched2 = false;
  /** 还没出手的剑气路线预警（出手时转成危险物预警：收招后照样亮到剑气飞完；被打断时撤回） */
  private lanes: (() => void)[] = [];
  launched = 0;

  get lastGap(): number {
    return this.gap;
  }

  override weightNow(): number {
    const d = this.w.distToPlayer();
    return d > 9 ? 2.6 : d > 6 ? 1.4 : 0.3;
  }

  protected override onStart(): void {
    this.planPhase = this.fury ? 2 : this.phase;
    this.reachNow = this.reach;
    this.pattern = SwordWave.pattern(this.planPhase);
    this.second = this.pattern.second.length > 0;
    this.launched2 = false;
    this.wnd = (this.planPhase >= 2 ? 0.65 : this.planPhase >= 1 ? 0.75 : 0.8) * this.host.windupScale;
    this.gap = this.second ? this.wnd * (WarlordSword.CrossImpactAt / WarlordSword.CrossHitAt - 1) : 0;
    this.aim = this.yawToPlayerAt(0.45);
    this.lanes = [];
    this.w.halt();
    this.act(this.second ? 'waveCross' : 'waveSlash', this.second ? this.wnd / WarlordSword.CrossHitAt : this.wnd / WarlordSword.WaveHitAt);
    this.sfx('telegraph');
  }

  private yawToPlayerAt(lead: number): number {
    const d = this.w.predict(lead, _a).sub(this.w.position).setY(0);
    return d.lengthSq() < 0.25 ? this.facing : yawOf(d.x, d.z);
  }

  protected override onTelegraph(): void {
    this.drawLanes(this.pattern.first, this.aim, this.wnd);
  }

  private rangeAlong(yaw: number): number {
    return Math.min(SwordWave.Range, Math.max(6, this.w.toEdge(this.w.position, dir3(yaw, _b), -1, SwordWave.Range)));
  }

  private drawLanes(shots: readonly WaveShot[], yaw: number, fill: number): void {
    const o = this.onGround(this.w.position.clone());
    for (const s of shots) {
      const y = yaw + s.yaw;
      const range = this.rangeAlong(y);
      this.lanes.push(this.hz.lineWarning(o.x, o.y, o.z, y * DEG, range, SwordWave.halfWidth(s.kind, this.reachNow), fill, WARN, range / s.speed, 'hazard'));
      this.telegraphCount++;
      this.host.notifyTelegraph(this);
    }
  }

  protected override get windupDone(): boolean {
    return this.stageT >= this.wnd;
  }

  protected override onWindup(dt: number): void {
    this.turnTo(this.aim, 360, dt);
    this.glow(Math.min(1, this.stageT / Math.max(0.01, this.wnd)));
  }

  protected override onActiveBegin(): void {
    this.launch(this.pattern.first, this.aim, 0);
    if (!this.second) return;
    // 第二刀重新瞄准（玩家跳过第一道之后落在哪），预警从第一刀出手画到第二刀出手
    this.aim2 = this.yawToPlayerAt(this.gap + 0.25);
    this.drawLanes(this.pattern.second, this.aim2, this.gap);
  }

  protected override onActive(dt: number): void {
    if (!this.second || this.launched2) {
      this.w.halt();
      return;
    }
    this.turnTo(this.aim2, 500, dt);
    if (this.stageT < this.gap) return;
    this.launched2 = true;
    this.launch(this.pattern.second, this.aim2, 1);
  }

  protected override get activeDone(): boolean {
    return (!this.second || this.launched2) && this.stageT >= this.gap + 0.35;
  }

  private launch(shots: readonly WaveShot[], yaw: number, swing: number): void {
    this.lanes = [];
    const o = this.w.position;
    const floor = this.floor;
    const fury = this.planPhase >= 2;
    for (const s of shots) {
      const y = yaw + s.yaw;
      const d = dir3(y);
      this.w.waves.add({
        origin: new THREE.Vector3(o.x, floor, o.z).addScaledVector(d, 0.8), dir: d, speed: s.speed, range: this.rangeAlong(y) - 0.8,
        halfWidth: SwordWave.halfWidth(s.kind, this.reachNow), top: s.kind === 'horizontal' ? SwordWave.HTop : SwordWave.VTop,
        vertical: s.kind === 'vertical', damage: s.kind === 'horizontal' ? this.dmg(20) : this.dmg(22), fury,
      });
      this.launched++;
    }
    this.glow(0);
    this.sfx('skill_fire', 0.9, swing === 0 ? 0.85 : 1.05);
    this.sfx('enemy_melee', 0.7, 0.7);
    this.w.waveSwing(this.second ? (swing === 0 ? 'waveCross' : 'waveCross2') : 'waveSlash', yaw, shots[0].kind === 'vertical');
  }

  protected override onEnd(): void {
    this.w.halt();
    this.glow(0);
    for (const c of this.lanes) c();
    this.lanes = [];
  }
}

/** 一道飞出去的剑气 */
export interface WaveSpec {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  range: number;
  halfWidth: number;
  top: number;
  vertical: boolean;
  damage: number;
  fury: boolean;
}

interface Wave extends WaveSpec {
  s: number;
  hit: boolean;
  done: boolean;
  fx: Fx.ArcHandle;
  emberAcc: number;
  /** 月牙圆心落在前沿后面多远（拱顶略超前沿：看到的刀光就是判定的前沿） */
  back: number;
}

/**
 * 飞出去的剑气（Unity WarlordWaveRunner）：逐帧推进——这一帧扫过的长方体碰到玩家胶囊就伤一次，碰到掩体在掩体上炸开、飞到射程尽头散掉；
 * 狂怒十字剑气：竖剑气追上横剑气、从横月牙中间穿过的那一刻在交点亮一个「十」字。首领倒下 / 释放时全部散掉。
 */
export class WaveRunner {
  private readonly waves: Wave[] = [];
  private readonly crossedOnce = new Set<Wave>();
  launched = 0;
  hits = 0;
  walls = 0;
  ended = 0;
  crossed = 0;

  constructor(private readonly w: Warlord) {}

  get alive(): number {
    return this.waves.length;
  }

  add(spec: WaveSpec): void {
    if (!(spec.range > 0.5)) return;
    spec.dir.setY(0).normalize();
    const ctx = this.w.ctx;
    const yaw = yawOf(spec.dir.x, spec.dir.z);
    const f = spec.fury ? 1 : 0;
    // 竖剑气：一弯竖着的月牙（拱向前方）；横剑气：一弯平放的月牙，略往前低头
    const R = spec.vertical ? spec.top * 0.55 : spec.halfWidth * 1.05;
    const back = R * 0.85;
    const at = spec.origin.clone().addScaledVector(spec.dir, -back);
    const fx = spec.vertical
      ? Fx.crescent(ctx, at.setY(spec.origin.y + spec.top * 0.42), yaw, R, 100 * DEG, 1, -Math.PI / 2, 0.75, f, { steady: true })
      : Fx.crescent(ctx, at.setY(spec.origin.y + 0.55), yaw, R, 2 * Math.asin(1 / 1.05) * 0.95, 1, 0, 0.8, f, { steady: true, pitchDeg: 8 });
    this.waves.push({ ...spec, s: 0, hit: false, done: false, fx, emberAcc: 0, back });
    this.launched++;
  }

  update(dt: number): void {
    if (this.waves.length === 0) return;
    if (!this.w.alive) {
      this.clear();
      return;
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wv = this.waves[i];
      this.step(wv, dt);
      if (!wv.done) continue;
      this.waves.splice(i, 1);
      this.ended++;
    }
    this.checkCross(dt);
  }

  private step(wv: Wave, dt: number): void {
    const ctx = this.w.ctx;
    const s0 = wv.s, s1 = Math.min(wv.range, wv.s + wv.speed * dt);
    // 掩体：剑气腰高处往前探
    const probe = wv.vertical ? 1.4 : 0.6;
    const p0 = _a.copy(wv.origin).addScaledVector(wv.dir, s0).setY(wv.origin.y + probe);
    const hit = ctx.world.raycast(p0, wv.dir, s1 - s0 + 0.25);
    if (hit && Math.abs(hit.normal.y) < 0.6) {
      wv.s = s0 + Math.max(0, hit.distance - 0.2);
      this.walls++;
      this.finish(wv, true, hit.point.clone().addScaledVector(wv.dir, -0.2));
      return;
    }
    wv.s = s1;
    const p = ctx.player;
    if (!wv.hit && p.alive && waveSweeps(wv.origin, wv.dir, s0, s1, wv.halfWidth, wv.origin.y, wv.top, p.position, p.radius)) {
      wv.hit = true;
      if (this.w.hazards.hurt(wv.damage, 'fire', _b.copy(wv.origin).addScaledVector(wv.dir, s1).setY(wv.origin.y + 1)) > 0) {
        this.hits++;
        p.applyImpulse(new THREE.Vector3(wv.dir.x * 8, 3, wv.dir.z * 8));
        Fx.waveBurst(ctx, new THREE.Vector3(p.position.x, p.position.y + 1, p.position.z), wv.vertical, wv.fury, false);
      }
    }
    const pos = _a.copy(wv.origin).addScaledVector(wv.dir, wv.s);
    wv.fx.moveTo(pos.clone().addScaledVector(wv.dir, -wv.back).setY(pos.y + (wv.vertical ? wv.top * 0.42 : 0.55)));
    wv.emberAcc += dt;
    if (wv.emberAcc >= 0.05) {
      wv.emberAcc = 0;
      ctx.fx.burst(pos.clone().setY(pos.y + 0.2), EMBERS, 3, 2, 0.4, 0.12, -2);
    }
    if (wv.s >= wv.range - 1e-3) this.finish(wv, false, pos.clone().setY(pos.y + (wv.vertical ? 1.2 : 0.5)));
  }

  private finish(wv: Wave, wall: boolean, at: THREE.Vector3): void {
    wv.done = true;
    wv.fx.cancel();
    Fx.waveBurst(this.w.ctx, at, wv.vertical, wv.fury, wall);
  }

  private checkCross(dt: number): void {
    for (const h of this.waves) {
      if (h.vertical || !h.fury || h.done || this.crossedOnce.has(h)) continue;
      const ph = _a.copy(h.origin).addScaledVector(h.dir, h.s);
      for (const v of this.waves) {
        if (!v.vertical || v.done || v.dir.dot(h.dir) < 0.94) continue;
        const off = _b.copy(v.origin).addScaledVector(v.dir, v.s).sub(ph);
        const lead = off.dot(h.dir), side = Math.abs(off.x * h.dir.z - off.z * h.dir.x);
        if (lead < 0 || lead > v.speed * dt + 0.3 || side > h.halfWidth) continue;
        this.crossedOnce.add(h);
        this.crossed++;
        const perp = new THREE.Vector3(h.dir.z, 0, -h.dir.x);
        Fx.crossFlare(this.w.ctx, ph.clone().setY(ph.y + 0.9).addScaledVector(perp, off.dot(perp)), h.dir, h.halfWidth, h.fury);
        break;
      }
    }
  }

  clear(): void {
    for (const wv of this.waves) {
      if (wv.done) continue;
      wv.done = true;
      wv.fx.cancel();
    }
    this.waves.length = 0;
    this.crossedOnce.clear();
  }
}

// ───────────────────────────── 突刺冲锋 ─────────────────────────────

type ThrustLeg = 'aim' | 'run' | 'cut' | 'crash' | 'recover';

/**
 * 剑尖在前的突刺：直线预警（预判玩家 0.3 s、越过玩家 5 m、最长 24 m、截到场地边）→ 24 m/s 突进，沿途每 2.4 m 留一片 5 s 的火；
 * 冲过玩家身边（预警半宽以内）刺中一下并往侧前方掀开。刹住之后转身「收刀横斩」：5.2 m、半角 70° 的扇形（0.42 / 0.36 / 0.32 s 预警）。
 * 撞墙硬直 1 s、不横斩（破绽窗口）。二阶段起连刺两次（第二次前摇 0.6 s），狂怒前摇再压。台沿前刹住（护栏冲刺）。
 */
export class ThrustMove extends WarlordMove {
  private leg: ThrustLeg = 'aim';
  private readonly dir = new THREE.Vector3(0, 0, 1);
  private readonly lastPos = new THREE.Vector3();
  private length = 0;
  private travelled = 0;
  private trail = 0;
  private legT = 0;
  private tele = 0;
  private cutTele = 0;
  private cutYaw = 0;
  private left = 0;
  private hitDone = false;
  private line: (() => void) | null = null;
  trails = 0;
  hits = 0;
  cutHits = 0;
  cuts = 0;
  crashes = 0;
  ledges = 0;
  lastRun = 0;
  lastLength = 0;

  /** 正在突进（Warlord 据此在剑尖甩火星） */
  get running(): boolean {
    return this.leg === 'run' && this.stage === 'active';
  }

  override weightNow(): number {
    return this.w.distToPlayer() > 8 ? 2.6 : 0.8;
  }

  protected override onStart(): void {
    this.left = this.phase >= 1 || this.fury ? 2 : 1;
    this.tele = (this.fury ? 0.62 : this.phase >= 1 ? 0.72 : 0.85) * this.host.windupScale;
    this.cutTele = (this.fury ? 0.32 : this.phase >= 1 ? 0.36 : 0.42) * this.host.windupScale;
    this.trails = 0;
    this.aim(false);
  }

  private aim(again: boolean): void {
    const from = this.w.position;
    const want = this.w.predict(0.3, _a).sub(from).setY(0);
    const d = want.length();
    if (d < 0.5) dir3(this.facing, this.dir);
    else this.dir.copy(want).divideScalar(d);
    this.length = Thrust.planLength(d, this.w.toEdge(from, this.dir, 1.5), l => this.w.ledgeFreeRun(from, this.dir, l));
    this.lastLength = this.length;
    this.leg = 'aim';
    this.legT = 0;
    this.w.halt();
    // 第二次突刺：横斩 / 撞墙的片段可能正在退回待机，交叉淡入
    if (again) this.actCrossfade('thrustReady', this.tele);
    else this.act('thrustReady', this.tele);
    this.sfx('telegraph');
    this.sfx('enemy_charge', 1, 0.8);
  }

  protected override onTelegraph(): void {
    this.drawLine();
  }

  private drawLine(): void {
    const g = this.onGround(this.w.position.clone());
    // 贴着台沿时线可能只剩几十厘米：至少画 1 m；线一直亮到突进结束
    const run = Math.max(1, this.length);
    this.line = this.track(this.hz.lineWarning(g.x, g.y, g.z, yawOf(this.dir.x, this.dir.z) * DEG, run, Thrust.HalfWidth, this.tele, WARN, run / Thrust.Speed + 0.1));
  }

  protected override get windupDone(): boolean {
    return this.stageT >= this.tele;
  }

  protected override onWindup(dt: number): void {
    this.w.facePoint(_a.copy(this.w.position).add(this.dir), 340, dt);
    this.glow(Math.min(1, this.stageT / Math.max(0.01, this.tele)));
  }

  /** 出手段由腿自己结束（连刺都刺完）；10 s 兜底防卡死 */
  protected override get activeDone(): boolean {
    return this.stageT > 10;
  }

  protected override onActiveBegin(): void {
    this.run();
  }

  private run(): void {
    this.leg = 'run';
    this.legT = 0;
    this.travelled = 0;
    this.trail = 1.5;
    this.hitDone = false;
    this.w.faceNow(_a.copy(this.w.position).add(this.dir));
    this.lastPos.copy(this.w.position);
    this.w.beginDash(this.dir.clone().multiplyScalar(Thrust.Speed), 30, this.length);
    this.glow(1);
    this.sfx('enemy_charge', 1, 0.7);
    this.w.thrustRun(this.dir, this.length / Thrust.Speed);
  }

  protected override onActive(dt: number): void {
    this.legT += dt;
    switch (this.leg) {
      case 'aim':
        this.w.facePoint(_a.copy(this.w.position).add(this.dir), 340, dt);
        this.glow(Math.min(1, this.legT / Math.max(0.01, this.tele)));
        if (this.legT >= this.tele) this.run();
        break;
      case 'run':
        this.stepRun(dt);
        break;
      case 'cut':
        this.w.halt();
        this.turnTo(this.cutYaw, 500, dt);
        if (this.legT >= this.cutTele) this.cut();
        break;
      default:
        this.w.halt();
        if (this.leg === 'recover') this.w.facePoint(this.ctx.player.position, 200, dt);
        this.glow(0);
        if (this.legT >= (this.leg === 'crash' ? 1 : 0.35)) this.next();
        break;
    }
  }

  private next(): void {
    this.left--;
    if (this.left > 0) {
      this.tele = 0.6 * this.host.windupScale * (this.fury ? 0.9 : 1);
      this.aim(true);
      this.drawLine();
    } else this.endActive();
  }

  private stepRun(dt: number): void {
    const p = this.w.position;
    const s = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.travelled += s;
    this.trail += s;
    if (this.trail >= 2.4) {
      this.trail = 0;
      const y = this.w.groundY(p.x, p.z, p.y + 2);
      this.hz.zone({ x: p.x, y, z: p.z, radius: 1.6, duration: 5, damage: this.dmg(5), color: FIRE, arm: 0.25, embers: EMBERS, element: 'fire' });
      this.trails++;
    }
    if (!this.hitDone) this.checkHit(p);
    this.lastPos.copy(p);
    const crashed = this.w.dashHitWall && this.legT > 0.1;
    const ledge = this.w.dashHitLedge && !crashed;
    const reached = this.w.dashRunSpent || this.travelled >= this.length - 0.02;
    const outOfArena = !this.w.arenaContains(p, this.w.radius * 0.5);
    if (!reached && !ledge && !crashed && !outOfArena && this.legT <= 1.8) return;
    this.w.endDash();
    this.w.halt();
    this.legT = 0;
    this.lastRun = this.travelled;
    if (ledge) this.ledges++;
    this.line?.();
    this.line = null;
    if (crashed) {
      this.leg = 'crash';
      this.crashes++;
      this.w.chargeEnd(true, p, this.dir);
      this.w.quake(0.55, 0.4);
      this.sfx('boss_slam', 1, 1.1);
      return;
    }
    // 刹住 → 转身收刀横斩：朝玩家画扇形，填满即斩
    this.leg = 'cut';
    const to = _a.copy(this.ctx.player.position).sub(p).setY(0);
    this.cutYaw = to.lengthSq() > 0.25 ? yawOf(to.x, to.z) : this.facing;
    const g = this.onGround(p.clone());
    this.track(this.hz.sectorWarning(g.x, g.y, g.z, this.cutYaw * DEG, Thrust.CutHalf * DEG, Thrust.CutRange * this.reach, this.cutTele, WARN));
    this.w.thrustStop(p, this.dir, this.cutTele);
  }

  private checkHit(p: THREE.Vector3): void {
    const pl = this.player();
    if (!pl) return;
    const ox = pl.feet.x - p.x, oz = pl.feet.z - p.z, dy = pl.feet.y - p.y;
    // 判定半径与预警长条半宽一致：玩家中心站在预警外就不会被刺到
    if (Math.hypot(ox, oz) >= Thrust.HalfWidth || dy >= 2.8) return;
    this.hitDone = true;
    const side = ox * this.dir.z - oz * this.dir.x >= 0 ? 1 : -1;
    const imp = new THREE.Vector3(this.dir.x * 13 + this.dir.z * 5 * side, 6, this.dir.z * 13 - this.dir.x * 5 * side);
    if (!this.strike(this.dmg(28), p.clone().setY(p.y + 1), imp)) return;
    this.hits++;
    this.w.quake(0.55, 0.35);
    this.sfx('enemy_melee', 1, 0.6);
  }

  private cut(): void {
    this.cuts++;
    this.leg = 'recover';
    this.legT = 0;
    const p = this.w.position;
    let hit = false;
    const pl = this.player();
    if (pl && inSector(p, this.cutYaw, Thrust.CutHalf, Thrust.CutRange * this.reach, pl.feet, pl.pr, 3.2)) {
      hit = this.strike(this.dmg(20), p.clone().setY(p.y + 1), dir3(this.cutYaw).multiplyScalar(8).setY(3.5));
    }
    if (hit) this.cutHits++;
    this.sfx('enemy_melee', hit ? 1 : 0.8, hit ? 1 : 0.8);
    this.w.thrustCut(this.cutYaw, hit, Thrust.CutRange * this.reach);
  }

  protected override onEnd(): void {
    this.w.endDash();
    this.glow(0);
    this.line?.();
    this.line = null;
  }
}

// ───────────────────────────── 回旋斩 ─────────────────────────────

/**
 * 二阶段起：原地转一整圈——以他为心 6.2 m 的圆形预警（0.8 s，狂怒 0.68 s），填满即斩：圈里挨 24、往外掀开。
 * 狂怒「回旋二连」：第一圈斩完再转一圈甩出更远的一环——内圈 2.6 m 以内安全、外到 9 m（× 1.15），第一圈出手时画环形预警、间隔后斩。
 */
export class SpinMove extends WarlordMove {
  private wnd = 0;
  private gap = 0;
  private r1 = 0;
  private outer2 = 0;
  private twice = false;
  private second = false;
  spins = 0;
  hits = 0;

  get lastGap(): number {
    return this.gap;
  }

  override weightNow(): number {
    return this.w.distToPlayer() < 7 ? 3.5 : 0.5;
  }

  protected override onStart(): void {
    this.twice = this.fury;
    this.second = false;
    this.wnd = (this.twice ? 0.68 : 0.8) * this.host.windupScale;
    this.gap = this.twice ? Spin.gapFor(this.wnd) : 0;
    this.r1 = Spin.Radius * this.reach;
    this.outer2 = Spin.Outer2 * this.reach;
    this.w.halt();
    this.act(this.twice ? 'spinTwice' : 'spin', this.twice ? this.wnd / WarlordSword.SpinTwiceHitAt : this.wnd / WarlordSword.SpinHitAt);
    this.sfx('telegraph', 1, 0.9);
  }

  protected override onTelegraph(): void {
    const g = this.onGround(this.w.position.clone());
    this.track(this.hz.groundWarning(g.x, g.y, g.z, this.r1, this.wnd, WARN));
  }

  protected override get windupDone(): boolean {
    return this.stageT >= this.wnd;
  }

  protected override onWindup(dt: number): void {
    this.w.facePoint(this.ctx.player.position, 120, dt);
    this.glow(Math.min(1, this.stageT / Math.max(0.01, this.wnd)));
  }

  protected override onActiveBegin(): void {
    this.spin(0);
    if (!this.twice) return;
    const g = this.onGround(this.w.position.clone());
    this.track(this.hz.annulusWarning(g.x, g.y, g.z, Spin.Inner2, this.outer2, this.gap, WARN));
  }

  protected override onActive(): void {
    this.w.halt();
    if (!this.twice || this.second || this.stageT < this.gap) return;
    this.second = true;
    this.spin(1);
  }

  protected override get activeDone(): boolean {
    return (!this.twice || this.second) && this.stageT >= this.gap + 0.45;
  }

  private spin(k: number): void {
    this.spins++;
    const c = this.w.position;
    let hit = false;
    const pl = this.player();
    if (pl) {
      const inside = k === 0 ? inRing(c, 0, this.r1, pl.feet, pl.pr, 2.2) : inRing(c, Spin.Inner2, this.outer2, pl.feet, pl.pr, 2.2);
      if (inside) {
        const away = _a.copy(pl.feet).sub(c).setY(0);
        if (away.lengthSq() > 0.01) away.normalize();
        else dir3(this.facing, away);
        hit = this.strike(this.dmg(k === 0 ? 24 : 20), c.clone().setY(c.y + 1), away.multiplyScalar(9).setY(4));
      }
    }
    if (hit) {
      this.hits++;
      this.sfx('enemy_melee');
    }
    this.sfx('skill_fire', 0.8, k === 0 ? 0.9 : 1.1);
    this.glow(k === 0 && this.twice ? 1 : 0);
    this.w.spinStrike(k, this.twice, k === 0 ? this.r1 : this.outer2, k === 0 ? 0 : Spin.Inner2, hit);
  }

  protected override onEnd(): void {
    this.w.halt();
    this.glow(0);
  }
}

// ───────────────────────────── 参考招式：火焰横扫 ─────────────────────────────

/** 横扫：扇形预警（0.85 / 0.7 s）→ 一道贴地扩散的扇形火浪（1 → 13 m）；二阶段反手再扫一次并甩出 7 颗火弹 */
export class SweepMove extends WarlordMove {
  private tele = 0;
  private yaw = 0;
  private yaw2 = 0;
  private sweeps = 1;
  private warned2 = false;
  private struck2 = false;

  override weightNow(): number {
    return this.w.distToPlayer() < 14 ? 3 : 1.2;
  }

  protected override onStart(): void {
    this.tele = (this.phase >= 1 ? 0.7 : 0.85) * this.host.windupScale;
    this.yaw = this.yawToPlayer;
    this.sweeps = this.phase >= 1 ? 2 : 1;
    this.warned2 = this.struck2 = false;
    this.w.halt();
    // 前摇动作（WarlordBrain.OnOwnMoveStarted）：sweepReady 拉伸到实际前摇，结束接 sweep（第 1 帧就是刀到）
    this.act('sweepReady', this.tele);
  }

  protected override onTelegraph(): void {
    const g = this.onGround(this.w.position.clone());
    this.track(this.hz.sectorWarning(g.x, g.y, g.z, this.yaw * DEG, WarlordRef.SweepHalf * DEG, WarlordRef.SweepWarnRadius, this.tele, WARN));
    this.sfx('telegraph');
  }

  protected override get windupDone(): boolean {
    return this.stageT >= this.tele;
  }

  protected override onWindup(dt: number): void {
    this.turnTo(this.yaw, 460, dt);
    this.glow(Math.min(1, this.stageT / Math.max(0.01, this.tele)));
  }

  protected override onActiveBegin(): void {
    this.sweepAt(this.yaw, false);
  }

  protected override onActive(dt: number): void {
    if (this.sweeps < 2) return;
    if (!this.warned2 && this.stageT >= 0.2) {
      this.warned2 = true;
      this.yaw2 = this.yawToPlayer;
      const g = this.onGround(this.w.position.clone());
      this.track(this.hz.sectorWarning(g.x, g.y, g.z, this.yaw2 * DEG, WarlordRef.SweepHalf * DEG, WarlordRef.SweepWarnRadius, 0.55, WARN));
      this.sfx('telegraph', 1, 1.2);
      this.act('sweepReady2', 0.55 * this.host.windupScale);
    }
    if (this.warned2 && !this.struck2) this.turnTo(this.yaw2, 460, dt);
    if (!this.struck2 && this.stageT >= 0.75) {
      this.struck2 = true;
      this.sweepAt(this.yaw2, true);
    }
  }

  protected override get activeDone(): boolean {
    return this.stageT >= (this.sweeps > 1 ? 1.35 : 0.8);
  }

  private sweepAt(yawDeg: number, bolts: boolean): void {
    this.glow(1);
    const c = this.onGround(this.w.position.clone());
    this.hz.wave({
      x: c.x, y: c.y, z: c.z, speed: 16, maxRadius: WarlordRef.SweepRadius, damage: this.dmg(24), color: FIRE, startRadius: 1,
      arcCenter: yawDeg * DEG, arcHalf: WarlordRef.SweepHalf * DEG, width: WarlordRef.SweepWidth, height: 1, element: 'fire', knockback: 6, dust: EMBERS,
    });
    this.w.sweepStrike(c, yawDeg, bolts);
    if (bolts) {
      for (let k = -3; k <= 3; k++) {
        const d = dir3(yawDeg + k * 9.17);
        this.w.fireBolt(c.clone().addScaledVector(d, 1.5).setY(c.y + 0.55), d, 16, this.dmg(10), FIRE);
      }
    }
    this.w.quake(0.35, 0.3);
    this.sfx('enemy_melee', 1, 0.6);
    this.sfx('skill_fire', 0.8, 0.8);
  }

  protected override onEnd(): void {
    this.glow(0);
  }
}

// ───────────────────────────── 参考招式：陨石雨 ─────────────────────────────

/**
 * 举剑引天火（0.8 s），之后 3.2 s 内落下 10（二阶段 14、三阶段 20）颗带落点预警的陨石（每三颗一颗预判玩家 1.1 s 后的走位，其余落在玩家周围 3–15 m），
 * 从 30 m 高处斜着直线坠落（1.25 s）；二阶段起落点留下 3.5 s 的火焰
 */
export class MeteorMove extends WarlordMove {
  private count = 10;
  private dropped = 0;
  private dur = 3.2;
  private flameAcc = 0;

  override weightNow(): number {
    return 2.2 + (this.w.phase >= 2 ? 1.5 : 0);
  }

  protected override onStart(): void {
    this.count = this.phase >= 2 ? 20 : this.phase >= 1 ? 14 : 10;
    this.dur = this.phase >= 2 ? 3.6 : this.phase >= 1 ? 3.4 : 3.2;
    this.dropped = 0;
    this.w.halt();
    this.sfx('boss_roar', 0.6, 1.2);
    this.sfx('telegraph');
    // raise 的 cast 事件在片段 33% 处：拉伸到 cast 正好在举剑结束
    this.act('raise', this.windupTime / 0.33);
  }

  protected override onTelegraph(): void {
    // 举剑时玩家周围一圈淡预警（陨石落点预警要等第一颗出手才有）
    const g = this.onGround(this.ctx.player.position.clone());
    this.track(this.hz.groundWarning(g.x, g.y, g.z, 15, this.windupTime, 0x8a2a10));
  }

  protected override onWindup(dt: number): void {
    this.glow(Math.min(1, this.stageT / Math.max(0.01, this.windupTime)));
    this.flameAcc += dt;
    if (this.flameAcc < 0.06) return;
    this.flameAcc = 0;
    this.ctx.fx.burst(this.w.headPoint(_a).setY(_a.y + 1.2), EMBERS, 4, 5, 0.6, 0.16, -12);
  }

  protected override onActiveBegin(): void {
    this.w.meteorCast();
    this.drop(this.dropped++);
  }

  protected override onActive(): void {
    while (this.dropped < this.count && this.stageT >= this.dropped * this.dur / this.count) this.drop(this.dropped++);
  }

  protected override get activeDone(): boolean {
    return this.dropped >= this.count && this.stageT >= this.dur + 0.3;
  }

  private drop(i: number): void {
    const rng = this.ctx.rng;
    let to: THREE.Vector3;
    if (i % 3 === 0) to = this.w.predict(1.1, new THREE.Vector3());
    else {
      const a = rng.range(0, Math.PI * 2), r = rng.range(3, 15);
      const pp = this.ctx.player.position;
      to = new THREE.Vector3(pp.x + Math.sin(a) * r, pp.y, pp.z + Math.cos(a) * r);
    }
    this.w.clampToArena(to, 2);
    this.onGround(to);
    const from = to.clone().add(new THREE.Vector3(rng.range(-7, 7), 30, rng.range(-7, 7)));
    const leaveFire = this.phase >= 1;
    const fireDmg = this.dmg(4);
    const hz = this.hz;
    hz.lob({
      from, to, time: 1.25, arc: 0, radius: 3, damage: this.dmg(22), color: FIRE, kind: 'meteor', element: 'fire',
      onLand: leaveFire ? (p) => { hz.zone({ x: p.x, y: p.y, z: p.z, radius: 2.2, duration: 3.5, damage: fireDmg, color: FIRE, arm: 0.1, embers: EMBERS, element: 'fire' }); } : undefined,
    });
  }

  protected override onEnd(): void {
    this.glow(0);
  }
}

// ───────────────────────────── 参考招式：跃击 ─────────────────────────────

/**
 * 蹲伏（0.48 / 0.38 s）→ 跃向玩家 0.35 s 后的位置（落点 5 m 圆形预警，填满时刻 = 落地时刻）→ 砸地重击 + 扩散冲击波（5 → 20 m）；二阶段起落点燃起 5 s 火焰。
 * 被掩体挡住半路落地或明显提前落地时撤回落点预警、只放冲击波。没被挡住时落地钉在预警圈中心（大步长早着地就等预警填满再砸）。
 */
export class LeapMove extends WarlordMove {
  private readonly target = new THREE.Vector3();
  private crouch = 0;
  private air = 1;
  private landT = 0;
  private landed = false;
  private warnCancel: (() => void) | null = null;
  lastOnMark = false;
  lastDrift = 0;

  override weightNow(): number {
    return this.w.distToPlayer() > 8 ? 2.6 : 1.2;
  }

  protected override onStart(): void {
    this.crouch = (this.phase >= 1 ? 0.38 : 0.48) * this.host.windupScale;
    this.air = this.phase >= 1 ? 0.85 : 1;
    this.landed = false;
    this.lastDrift = 0;
    this.w.landingPoint(this.w.predict(0.35, _a), 3, this.target);
    this.w.halt();
    this.w.faceNow(this.target);
    this.sfx('telegraph');
    // 前摇动作：crouch 拉伸到实际前摇，结束接 leap（落地那一刻才播 land）
    this.act('crouch', this.crouch);
  }

  protected override onTelegraph(): void {
    this.warnCancel = this.track(this.hz.groundWarning(this.target.x, this.target.y, this.target.z, 5, this.crouch + this.air, WARN));
  }

  protected override get windupDone(): boolean {
    return this.stageT >= this.crouch;
  }

  protected override onWindup(dt: number): void {
    this.w.facePoint(this.target, 460, dt);
  }

  protected override onActiveBegin(): void {
    const from = this.w.position.clone();
    const d = this.target.clone().sub(from);
    const dy = d.y;
    d.setY(0);
    const v = d.divideScalar(this.air);
    v.y = (dy + 0.5 * WarlordRef.LeapGravity * this.air * this.air) / this.air;
    this.w.beginDash(v, WarlordRef.LeapGravity);
    this.w.leapTakeoff(from, this.air);
    this.sfx('jump', 1, 0.5);
  }

  protected override onActive(): void {
    if (this.landed) return;
    switch (Leap.decide(this.stageT, this.air, this.w.dashGrounded, this.w.position, this.target, this.w.dashHitWall)) {
      case 'pin':
        this.pinToTarget();
        break;
      case 'land':
        this.land();
        break;
    }
  }

  private pinToTarget(): void {
    const at = this.w.position;
    this.lastDrift = Math.max(this.lastDrift, Math.hypot(at.x - this.target.x, at.z - this.target.z));
    this.w.position.copy(this.target);
    this.w.setDashVelocity(0, 0, 0);
  }

  protected override get activeDone(): boolean {
    return this.landed && this.stageT - this.landT >= 0.7;
  }

  private land(): void {
    const early = this.stageT < this.air - 0.12;
    this.landed = true;
    this.landT = this.stageT;
    if (!Leap.isBlocked(this.w.position, this.target, this.w.dashHitWall)) this.pinToTarget();
    this.w.endDash();
    this.w.halt();
    const p = this.w.position;
    const onMark = Math.hypot(p.x - this.target.x, p.z - this.target.z) <= WarlordRef.LeapMiss;
    this.lastOnMark = onMark;
    if (!onMark || early) this.warnCancel?.();
    const crushed = onMark && this.hz.blast(p.x, p.y, p.z, 5, this.dmg(30), { maxHeight: 1.8, knockback: 12, knockUp: 6, element: 'fire' });
    // 冲击波始终贴着场地地面扩散，地面上的玩家才能看清并跳过
    const floor = this.onGround(p.clone());
    this.hz.wave({ x: floor.x, y: floor.y, z: floor.z, speed: 14, maxRadius: 20, damage: this.dmg(16), color: FIRE, startRadius: 5, element: 'fire', dust: EMBERS,
      width: 0.9, height: 0.85, spare: crushed });
    this.w.leapLand(floor, onMark);
    this.w.quake(0.9, 0.55);
    this.sfx('boss_slam');
    this.sfx('explosion', 1, 0.7);
    if (this.phase >= 1) this.hz.zone({ x: p.x, y: floor.y, z: p.z, radius: 4, duration: 5, damage: this.dmg(5), color: FIRE, arm: 0.3, embers: EMBERS, element: 'fire' });
  }

  protected override onEnd(): void {
    this.w.endDash();
  }
}

// ───────────────────────────── 熔铜渠涨落 ─────────────────────────────

/**
 * 二阶段起、渠没在涨时才出，越过 50% 后第一招就是它：插剑入地（plant，前摇 0.45 s）→ 剑落地的一刻引动熔铜渠。
 * 场地里没有熔铜渠时（网页：熔铜渠 FoundryChannels 随 M7 的地图机关导出，现在都没有）退回 TS 的写法：场地外圈环带熔岩（预警 3 s、持续 10 s，内圈半径按场地缩放）。
 */
export class ChannelSurgeMove extends WarlordMove {
  private ring: { readonly ended: boolean } | null = null;
  private announced = false;
  /** 引动过几次熔铜渠、退回环带写法几次、这次画了几条渠岸预警、这次高位停几秒（同 Unity，测试 / 调试用） */
  floods = 0;
  fallbacks = 0;
  lastWarnings = 0;
  lastHold = 0;

  /** 3-3 神范台的熔铜渠（M7 的 FoundryChannels，经 stageGates 交过来；场上没有渠时为 null） */
  private get channels(): FoundryChannelsHook | null {
    const ch = stageGates.foundryChannels;
    return ch && ch.count > 0 ? ch : null;
  }

  /** 熔铜渠（或兜底的环带）还在涨 / 生效 */
  get activeSurge(): boolean {
    const ch = this.channels;
    return ch ? ch.flooding : !!this.ring && !this.ring.ended;
  }

  override weightNow(): number {
    return this.w.phase >= 1 && !this.activeSurge ? 2.5 : 0;
  }

  protected override onStart(): void {
    this.w.halt();
    this.sfx('boss_roar', 0.8);
    this.lastWarnings = 0;
    // plant 的 hit 事件在片段 35% 处
    this.act('plant', this.windupTime / 0.35);
  }

  protected override onTelegraph(): void {
    const g = this.onGround(this.w.position.clone());
    this.track(this.hz.groundWarning(g.x, g.y, g.z, 3.2, this.windupTime, WARN));
    this.glow(1);
  }

  protected override onWindup(dt: number): void {
    this.w.facePoint(this.ctx.player.position, 200, dt);
  }

  protected override onActiveBegin(): void {
    const c = this.onGround(this.w.position.clone());
    this.w.quake(0.4, 1.6);
    this.ctx.fx.ring(_a.copy(c).setY(c.y + 0.1), 12, LAVA, 0.9);
    this.ctx.fx.burst(_a.copy(c).setY(c.y + 0.5), EMBERS, 30, 8, 0.9, 0.2, 4);
    this.w.plantStrike(c);
    this.sfx('boss_slam', 1, 0.7);
    const ch = this.channels;
    if (ch) this.floodChannels(ch);
    else this.ringFallback();
    if (this.announced) return;
    this.announced = true;
    this.ctx.ui.toast(ch ? '熔铜渠要漫上来了——上桥，或往象限中央躲！' : '熔岩正在涌向外圈——靠近中心或站上高处！', '#ff6a2a');
  }

  /**
   * 引动熔铜渠（Unity WarlordChannelSurge.FloodChannels）：高位停 = 定义里按阶段的秒数（狂怒 +2 s）；
   * 每片熔岩的漫溢范围铺一条预警（盒沿长边从一头铺到另一头、熔池铺圆），填满的那一刻熔岩正好漫过渠岸。
   * 预警走 hazard 组（招式被打断也照常兑现，所以不 track）。渠里冒泡 / 溅熔滴 / 沿渠涌浪的外观（SurgeFx）随 M11b。
   */
  private floodChannels(ch: FoundryChannelsHook): void {
    let hold = this.w.wdef.surgeHoldAt(this.w.phase);
    if (this.w.enraged) hold += 2;
    this.lastHold = hold;
    if (ch.flood(hold)) this.floods++;
    const fill = ch.warn + ch.riseTime;
    const y = this.floor + 0.02;
    for (const v of ch.surges) {
      if (v.shape === 'disc') this.hz.groundWarning(v.center[0], y, v.center[2], v.size[0], fill, LAVA, 'hazard');
      else {
        // 网页 yaw（度）：本地 +Z = (sin, cos)；半宽 = 盒宽的一半
        const r = v.yaw * DEG, fx = Math.sin(r), fz = Math.cos(r), len = v.size[1];
        this.hz.lineWarning(v.center[0] - fx * len * 0.5, y, v.center[2] - fz * len * 0.5, r, len, v.size[0] * 0.5, fill, LAVA, 0.3, 'hazard');
      }
      this.lastWarnings++;
    }
  }

  /** 兜底（场地里没有熔铜渠）：TS 的外圈环带熔岩 */
  private ringFallback(): void {
    this.fallbacks++;
    const c = this.w.bossCenter;
    const y = this.w.groundY(c.x, c.z, c.y + 4);
    const extent = this.w.arenaRadius;
    const inner = Math.min(15, Math.max(5, extent * 0.38));
    this.ring = this.hz.zone({
      x: c.x, y, z: c.z, radius: extent + 20, innerRadius: inner, duration: 10, damage: this.dmg(5), color: LAVA,
      arm: 3, interval: 0.5, embers: EMBERS, element: 'fire', maxHeight: 0.8,
    });
    this.lastWarnings++;
  }

  protected override onEnd(): void {
    this.glow(0);
  }
}

/** 按定义里的招式 id 造运行时招式 */
export function createWarlordMove(w: Warlord, id: string): BossMove | null {
  const spec = w.bdef.move(id);
  if (!spec) return null;
  switch (id) {
    case BladeCombo.id: return new BladeComboMove(spec, w);
    case Iai.id: return new IaiMove(spec, w);
    case SwordWave.id: return new SwordWaveMove(spec, w);
    case Thrust.id: return new ThrustMove(spec, w);
    case Spin.id: return new SpinMove(spec, w);
    case Sweep.id: return new SweepMove(spec, w);
    case Leap.id: return new LeapMove(spec, w);
    case Meteor.id: return new MeteorMove(spec, w);
    case ChannelSurge.id: return new ChannelSurgeMove(spec, w);
  }
  return null;
}
