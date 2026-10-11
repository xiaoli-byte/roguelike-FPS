/**
 * 冰灯水母（lantern_jelly，第二章 · 北冥冰海的辅助）：北冥深海里提灯的水母，伞盖下吊着一盏发光的笼灯（灯芯 = 弱点），
 * 漂在半空，用发光的触须连着同伴给它们续命。设计见 docs/art/enemy-roster-v2.md「北冥五怪 · 战斗设计」冰灯水母一行。
 *
 * - 回血连线：12 米内最多连 3 个同伴（先连血少的），光触须从一条触须的末端伸过去（约 0.5 秒连上），
 *   连上后每秒回同伴最大生命的 4%。断开的三种方式：
 *   1. 挡住视线：灯芯到同伴之间有遮挡（墙、掩体、狐巫的冰壁）→ 断开，2.5 秒内不再连它；
 *   2. 打断连线：玩家身体穿过光触须 → 触须「啪」地断开，3 秒内不再连它；
 *   3. 打灯芯：短时间内灯芯累计吃到最大生命 12% 的伤害 → 水母一缩、全部连线断开，1.2 秒内不能重连。
 *   距离超出 12 米（留 15% 余量）也会松开。
 * - 电冻：玩家进入 5.5 米内时，触须全部张开、亮起 0.8 秒（脚下预警圈），然后放出一圈冻电：伤害 + 减速 40% 1 秒。别贴脸。
 * - 弱点：伞盖里的灯芯（头部判定挂在灯芯骨骼上，离地约 2.2 米，要抬枪）。
 *
 * 动作：伞盖每 2.4 秒收缩一次（伞缘四瓣往里收、身体往上一窜），八条触须是弹簧骨骼，随漂移拖在后面、波浪从根部往尖传；
 * 连线时对应的那条触须朝同伴抬起；电冻前摇时触须全部张开颤抖。
 *
 * 状态机：drift → shockWindup → drift；灯芯受重击时 stagger → drift
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp01, raySphere } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { zonePlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';
import { LightTendrils, Sway, bodyCrossesSegment, chillPlayer, type TendrilSpec } from '../fx/FrostSupportFx';
import { isFrostAlly } from './FoxWitch';

export const LANTERN_JELLY_DEF: ScaledEnemyDef = {
  id: 'lantern_jelly',
  name: '冰灯水母',
  hp: 110,
  speed: 3.4,
  radius: 0.42,
  height: 1.8,
  flying: true,
  // 电冻的基础伤害
  damage: 10,
  coins: [2, 4],
  essence: 1,
  // 弱点 = 伞盖下的灯芯（美术 1.07 米处）
  headY: 1.07,
  headRadius: 0.2,
  knockbackResist: 0.4,
  color: 0x6fe8ff,
  // 美术按 1.8 米制作（含触须），游戏里放大 1.1 倍
  scale: 1.1,
};

/** 回血连线 */
export const LINK = { range: 12, max: 3, heal: 0.04, reach: 0.5, losRetry: 2.5, crossRetry: 3, staggerRetry: 1.2 } as const;
/** 灯芯受击：窗口内累计伤害（相对最大生命）达到这个比例就缩一下、断开全部连线 */
const STAGGER_FRAC = 0.12;
const STAGGER_TIME = 1.2;
/** 电冻 */
const SHOCK = { range: 5.5, windup: 0.8, cooldown: [4, 5] as const, slow: 0.4, slowTime: 1, rise: 3.5 } as const;
/** 悬浮：触须末端离地高度、上下浮动幅度 / 角频率；伞盖脉动周期 */
const HOVER = 0.95;
const BOB = [0.12, 1.3] as const;
const PULSE = 2.4;
/** 跟在同伴身后：离玩家的距离带，同伴质心后方多远 */
const KEEP_RANGE = [9, 15] as const;
const BEHIND = 3;

const C = {
  bell: 0x9fd6e8, bellDark: 0x5f8fb0, frill: 0xc8e8f4, core: 0x6fe8ff, coreHot: 0xe8ffff, bead: 0x6fe8ff,
  link: 0x7ff0d8, heal: 0xa8ffd0, shock: 0x9fe8ff, shard: 0xd8f4ff,
};

/** 八条触须（四节）：L/R 两条长的垂到地面，前 FL/FR、后 BL/BR、后中 CL/CR */
const TENTACLES = ['L', 'R', 'FL', 'FR', 'BL', 'BR', 'CL', 'CR'] as const;
/** 白模触须根部（模型空间、未缩放；x 左、z 前）与长度 */
const CLASSIC_TENT: Record<(typeof TENTACLES)[number], [number, number, number]> = {
  L: [0.1, 0.025, 1.1], R: [-0.1, 0.025, 1.1], FL: [0.13, 0.05, 0.85], FR: [-0.13, 0.05, 0.85],
  BL: [0.12, -0.03, 0.85], BR: [-0.12, -0.03, 0.85], CL: [0.06, -0.03, 0.85], CR: [-0.06, -0.03, 0.85],
};

const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Vector3();
const _scratch: IEnemy[] = [];

const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** 一根连线 */
export interface HealLink {
  ally: IEnemy;
  /** 用哪条触须（TENTACLES 下标） */
  tent: number;
  spec: TendrilSpec;
  /** 累计回了多少血（调试 / 测试） */
  healed: number;
}

/** 一条触须：四节骨骼、绑定姿势下根部的水平朝外方向、张开轴、惯性弹簧 */
interface TentState {
  bones: string[];
  out: THREE.Vector3;
  flareAxis: THREE.Vector3;
  sway: Sway;
  /** 连线时朝同伴抬起的权重与方向（模型空间水平方向） */
  lift: number;
  readonly liftDir: THREE.Vector3;
  seed: number;
}

export class LanternJelly extends StandardEnemy {
  /** 当前的连线（最多 3 根） */
  readonly links: HealLink[] = [];
  /** 被断开的同伴 → 可以重新连上的时间 */
  private readonly cutUntil = new Map<IEnemy, number>();
  private linkLosTimer = 0;
  private pickTimer = 0;
  private shockCd: number;
  private windTime = 1;
  private cancelWarning: (() => void) | null = null;
  /** 灯芯受击累计（相对最大生命，随时间衰减）与缩起来的剩余时间 */
  private coreHits = 0;
  private staggerTime = 0;
  private hitAt = -9;
  private tendrils: LightTendrils | null = null;
  private readonly specs: TendrilSpec[] = [];
  private healAcc = 0;

  private body!: THREE.Group;
  private core!: THREE.Mesh;
  private classicTents: THREE.Group[][] = [];
  private readonly tents: TentState[] = [];
  private readonly drift = new Sway(9, 3.2);
  private readonly prevVel = new THREE.Vector3();
  private pulseLift = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, LANTERN_JELLY_DEF, opts);
    this.hoverHeight = HOVER;
    this.shockCd = ctx.rng.range(1.5, 2.5);
    this.deathDuration = 1.4;
    this.setState('drift');
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const bell = flat(C.bell, { rough: 0.35 }), dark = flat(C.bellDark), frill = flat(C.frill);
    // 白模：伞盖、伞缘、口腕冰褶、八条触须（四节，末端发光珠）；美术身体就绪后整组隐藏
    const body = joint(root, 0, 0, 0);
    this.body = body;
    part(body, Geo.ico(0.42, 1), bell, 0, 1.38, 0).scale.set(1.05, 0.55, 1.05);
    part(body, Geo.cone(0.5, 0.18, 8), dark, 0, 1.26, 0);
    part(body, Geo.cone(0.05, 0.25, 4, 'bottom'), dark, 0, 1.55, 0);
    part(body, Geo.cone(0.24, 0.32, 8), frill, 0, 0.92, 0).rotation.x = Math.PI;
    for (let i = 0; i < TENTACLES.length; i++) {
      const [x, z, len] = CLASSIC_TENT[TENTACLES[i]];
      const seg = len / 4;
      let parent: THREE.Object3D = body;
      const chain: THREE.Group[] = [];
      for (let k = 0; k < 4; k++) {
        const j = k === 0 ? joint(parent, x, 1.08, z) : joint(parent, 0, -seg, 0);
        part(j, Geo.cyl(0.018, 0.014, seg, 4, 'top'), dark, 0, 0, 0);
        chain.push(j);
        parent = j;
      }
      this.glowPart(parent, Geo.ico(0.035, 0), C.bead, C.coreHot, 0, -seg, 0);
      this.classicTents.push(chain);
    }
    // 灯芯（弱点，加法发光；美术身体上它是发光壳）
    this.core = this.glowPart(body, Geo.ico(0.15, 1), C.core, C.coreHot, 0, 1.07, 0);
    this.setHeadAnchor(this.core, 0, 0, 0);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (n) {
      this.body.visible = false;
      // 白模的灯芯球不再显示（美术的笼灯就是灯芯；发光由发光壳负责），弱点锚点挪到灯芯骨骼上
      this.core.visible = false;
      const coreBone = n.pose.bone('core');
      if (coreBone) this.setHeadAnchor(coreBone, 0, 0.1, 0);
      n.glowShell?.color.setHex(C.core);
      this.initNative(n.pose);
    }
    this.tendrils = new LightTendrils(this.ctx.stageGroup, C.link, LINK.max);
  }

  private initNative(P: NativePose): void {
    for (let i = 0; i < TENTACLES.length; i++) {
      const id = TENTACLES[i];
      const bones = [1, 2, 3, 4].map((k) => `tent_${id}${k}`);
      const root = P.restPosition(bones[0]);
      if (!root) continue;
      const out = new THREE.Vector3(root.x, 0, root.z);
      if (out.lengthSq() < 1e-6) out.set(id.endsWith('L') ? 1 : -1, 0, 0);
      out.normalize();
      const flareAxis = new THREE.Vector3().crossVectors(DOWN, out).normalize();
      this.tents.push({ bones, out, flareAxis, sway: new Sway(10 + i, 2.6), lift: 0, liftDir: new THREE.Vector3(), seed: i * 0.83 });
    }
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0;
    this.cancelWarning?.();
    this.cancelWarning = null;
    // 眩晕 / 死亡：全部连线断开
    this.cutAll(LINK.staggerRetry);
    if (this.state !== 'drift' && this.state !== 'idle') this.setState('drift');
  }

  protected override onDispose(): void {
    super.onDispose();
    this.tendrils?.dispose();
    this.tendrils = null;
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    this.hoverHeight = HOVER + Math.sin(this.age * BOB[1]) * BOB[0];
    this.shockCd -= dt * this.attackRate;
    this.coreHits = Math.max(0, this.coreHits - dt * 0.06);
    this.staggerTime = Math.max(0, this.staggerTime - dt);
    switch (this.state) {
      case 'drift': {
        this.followAllies();
        this.facePlayer(1.2, dt);
        this.glowTarget[0] = 0.3 + 0.15 * Math.sin(this.age * 2.6) + 0.25 * Math.min(1, this.links.length);
        const pl = this.ctx.player.position;
        const dy = pl.y - (this.position.y - this.hoverHeight);
        if (this.shockCd <= 0 && this.distToPlayerXZ() <= SHOCK.range && dy > -1 && dy < SHOCK.rise
          && this.requestAttack('melee', SHOCK.windup + 0.4)) {
          this.windTime = this.windup(SHOCK.windup, 0.55);
          this.setState('shockWindup');
          this.groundPoint(_p);
          this.cancelWarning = this.ctx.fx.groundWarning(_p, SHOCK.range, this.windTime, C.shock);
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.5, pitch: 1.6 });
        }
        break;
      }
      case 'shockWindup': {
        // 前摇里不再移动（漂着的速度慢慢停下），触须张开颤抖
        this.stopMoving();
        this.glowTarget[0] = 0.6 + 0.4 * clamp01(this.stateTime / this.windTime);
        if (this.stateTime >= this.windTime) {
          this.cancelWarning = null;
          this.releaseShock();
          this.releaseAttack();
          this.shockCd = this.ctx.rng.range(SHOCK.cooldown[0], SHOCK.cooldown[1]);
          this.setState('drift');
        }
        break;
      }
      case 'stagger': {
        this.stopMoving();
        if (this.stateTime >= STAGGER_TIME) this.setState('drift');
        break;
      }
      default:
        this.setState('drift');
    }
    this.updateLinks(dt);
  }

  /** 脚下地面上的点（水母悬在空中，预警圈 / 冻电画在地上） */
  private groundPoint(out: THREE.Vector3): THREE.Vector3 {
    const gy = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
    return out.set(this.position.x, Number.isFinite(gy) ? gy : this.ctx.stage.arena?.floorY ?? this.position.y - this.hoverHeight, this.position.z);
  }

  /** 漂在同伴质心后方几米（离玩家 9–15 米）；没有同伴就和玩家保持距离 */
  private followAllies(): void {
    const pl = this.ctx.player.position;
    const list = this.ctx.enemies.queryRadius(this.position, 22, _scratch);
    let n = 0;
    _q.set(0, 0, 0);
    for (const e of list) {
      if (!this.isLinkable(e)) continue;
      _q.add(e.position);
      n++;
    }
    _scratch.length = 0;
    if (n === 0) {
      this.keepRange(KEEP_RANGE[0], KEEP_RANGE[1], this.speed, 0.4);
      return;
    }
    _q.multiplyScalar(1 / n);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    const d = _v.length() || 1;
    _q.addScaledVector(_v, BEHIND / d);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    if (_v.length() < KEEP_RANGE[0]) _q.set(pl.x, _q.y, pl.z).addScaledVector(_v.normalize(), KEEP_RANGE[0]);
    if (Math.hypot(_q.x - this.position.x, _q.z - this.position.z) > 1.2) this.moveTo(_q, this.speed, 0.8);
    else this.stopMoving();
  }

  /** 能连的同伴：辅助怪眼里的同伴，且不是别的冰灯水母（两只水母互相续命会变成打不死的一对） */
  private isLinkable(e: IEnemy): boolean {
    return isFrostAlly(this, e) && !(e instanceof LanternJelly);
  }

  /** 灯芯的世界坐标（连线的视线检测从这里算） */
  coreWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.getHeadCenter(out);
  }

  // ───────────── 回血连线 ─────────────

  /**
   * 每帧：松开失效的连线（同伴死了 / 走远了），检查视线（0.2 秒一次）和玩家是否穿过触须，
   * 按需补连新的同伴（0.25 秒一次，先连血少的），伸出触须，连上的每秒回 4% 生命。
   */
  updateLinks(dt: number): void {
    const ctx = this.ctx, now = ctx.time.now;
    const core = this.coreWorld(_c);
    const live = this.alive && this.stunTime <= 0 && this.staggerTime <= 0 && this.state !== 'stagger';
    this.linkLosTimer -= dt;
    const recheck = this.linkLosTimer <= 0;
    if (recheck) this.linkLosTimer = 0.2;
    const pl = ctx.player;
    for (let i = this.links.length - 1; i >= 0; i--) {
      const L = this.links[i];
      const e = L.ally;
      if (!live || !e.alive || !this.isLinkable(e)) {
        this.links.splice(i, 1);
        continue;
      }
      e.getBodyCenter(_q);
      if (core.distanceTo(_q) > LINK.range * 1.15) {
        this.links.splice(i, 1);
        continue;
      }
      if (recheck && ctx.world.segmentBlocked(core, _q)) {
        this.cut(i, LINK.losRetry);
        continue;
      }
      // 玩家穿过已经伸出去的那一段
      L.spec.from.copy(this.linkStart(L.tent, _w));
      L.spec.to.copy(_q);
      _p.lerpVectors(L.spec.from, L.spec.to, clamp01(L.spec.extend));
      if (pl.alive && L.spec.extend > 0.15 && bodyCrossesSegment(L.spec.from, _p, pl.position, pl.height, pl.radius)) {
        this.cut(i, LINK.crossRetry);
        continue;
      }
    }
    this.pickTimer -= dt;
    if (live && this.pickTimer <= 0 && this.links.length < LINK.max) {
      this.pickTimer = 0.25;
      this.pickLinks(core, now);
    }
    const mult = this.isElite ? 1.25 : 1;
    for (const L of this.links) {
      L.spec.extend = Math.min(1, L.spec.extend + dt / LINK.reach);
      L.spec.alpha = Math.min(1, L.spec.alpha + dt * 4);
      if (L.spec.extend < 1) continue;
      const e = L.ally;
      if (e.hp >= e.maxHp) continue;
      const add = Math.min(e.maxHp - e.hp, e.maxHp * LINK.heal * mult * dt);
      e.hp += add;
      L.healed += add;
    }
  }

  private pickLinks(core: THREE.Vector3, now: number): void {
    const ctx = this.ctx;
    const list = ctx.enemies.queryRadius(core, LINK.range, _scratch).filter((e) => {
      if (!this.isLinkable(e) || this.links.some((l) => l.ally === e)) return false;
      if ((this.cutUntil.get(e) ?? -Infinity) > now) return false;
      e.getBodyCenter(_q);
      return core.distanceTo(_q) <= LINK.range && !ctx.world.segmentBlocked(core, _q);
    });
    _scratch.length = 0;
    // 先连血少的（按缺血比例），一样时连近的
    list.sort((a, b) => (a.hp / a.maxHp - b.hp / b.maxHp) || a.position.distanceToSquared(core) - b.position.distanceToSquared(core));
    for (const e of list) {
      if (this.links.length >= LINK.max) break;
      const tent = this.pickTentacle(e);
      this.links.push({ ally: e, tent, healed: 0, spec: { from: new THREE.Vector3(), to: new THREE.Vector3(), extend: 0, alpha: 0, seed: Math.random() } });
    }
  }

  /** 选一条朝向同伴、还没被占用的触须 */
  private pickTentacle(e: IEnemy): number {
    const yaw = Math.atan2(e.position.x - this.position.x, e.position.z - this.position.z) - this.facing;
    _v.set(Math.sin(yaw), 0, Math.cos(yaw));
    let best = 0, bestDot = -Infinity;
    for (let i = 0; i < TENTACLES.length; i++) {
      if (this.links.some((l) => l.tent === i)) continue;
      const out = this.tents[i]?.out ?? _w.set(CLASSIC_TENT[TENTACLES[i]][0], 0, CLASSIC_TENT[TENTACLES[i]][1]).normalize();
      const d = out.dot(_v);
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    return best;
  }

  /** 连线的起点：那条触须的末端（美术骨骼 / 白模关节），都没有时用灯芯 */
  private linkStart(tent: number, out: THREE.Vector3): THREE.Vector3 {
    const ts = this.tents[tent];
    const bone = ts ? this.nativeBody?.pose.bone(ts.bones[3]) : null;
    if (bone) {
      bone.updateWorldMatrix(true, false);
      return bone.localToWorld(out.set(0, 0.12, 0));
    }
    const chain = this.classicTents[tent];
    if (chain) {
      const j = chain[chain.length - 1];
      j.updateWorldMatrix(true, false);
      return j.localToWorld(out.set(0, -0.2, 0));
    }
    return this.coreWorld(out);
  }

  /** 断开第 i 根连线：retry 秒内不再连它；断口炸出一点冰屑 */
  private cut(i: number, retry: number): void {
    const L = this.links[i];
    if (!L) return;
    this.links.splice(i, 1);
    this.cutUntil.set(L.ally, this.ctx.time.now + retry);
    if (L.spec.extend > 0.05) {
      _p.lerpVectors(L.spec.from, L.spec.to, clamp01(L.spec.extend) * 0.5);
      this.ctx.fx.burst(_p, C.link, 10, 2.5, 0.35, 0.05, 2);
      this.ctx.audio.play('shock_zap', { position: _p, volume: 0.45, pitch: 1.6 });
    }
  }

  private cutAll(retry: number): void {
    for (let i = this.links.length - 1; i >= 0; i--) this.cut(i, retry);
  }

  // ───────────── 电冻 ─────────────

  /** 一圈冻电：地面圆形判定（5.5 米），命中伤害 + 减速，触须末端各拉一道电光 */
  releaseShock(): boolean {
    const ctx = this.ctx;
    const center = this.groundPoint(_p);
    ctx.fx.ring(_q.copy(center).setY(center.y + 0.1), SHOCK.range, C.shock, 0.45);
    this.getBodyCenter(_q);
    ctx.fx.burst(_q, C.shock, 24, 5, 0.4, 0.06, 0);
    ctx.audio.play('shock_zap', { position: _q, volume: 0.9, pitch: 0.8 });
    const hit = zonePlayer(ctx, center, SHOCK.range, this.def.damage * this.damageMult, 'shock', this, SHOCK.rise);
    if (hit) {
      chillPlayer(ctx, SHOCK.slow, SHOCK.slowTime);
      this.playerChest(_w);
      for (let i = 0; i < 3; i++) ctx.fx.lightning(this.linkStart(i * 2, _q), _w, C.shock);
    }
    return hit;
  }

  // ───────────── 受击 / 死亡 ─────────────

  /** 头部（灯芯）之外，伞盖加一个扁椭球判定（算打身体）：身体胶囊只到口腕，打伞盖不该穿过去 */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    const hit = super.raycastHit(origin, dir, maxDist, out);
    if (!this.alive) return hit;
    const s = this.sizeScale;
    // 椭球（半径 0.48 / 0.2 / 0.48）→ 把 y 拉伸成球求交
    const k = 0.48 / 0.2;
    _p.set(origin.x, this.position.y + 1.47 * s + (origin.y - this.position.y - 1.47 * s) * k, origin.z);
    _v.set(dir.x, dir.y * k, dir.z);
    const len = _v.length();
    _v.multiplyScalar(1 / len);
    _q.set(this.position.x, this.position.y + 1.47 * s, this.position.z);
    const t = raySphere(_p, _v, _q, 0.48 * s);
    if (t < 0) return hit;
    // 拉伸空间里的距离换回原空间
    _w.copy(_v).multiplyScalar(t);
    _w.y /= k;
    const d = _w.length();
    if (d <= maxDist && (!hit || d < out.distance - this.headRadius * 0.5)) {
      out.distance = d;
      out.headshot = false;
      return true;
    }
    return hit;
  }

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    if (!r.request.headshot || !this.alive) return;
    this.hitAt = this.age;
    this.glowLevel[0] = 1;
    this.coreHits += r.dealt / Math.max(1, this.maxHp);
    if (this.coreHits >= STAGGER_FRAC && this.state !== 'stagger') {
      this.coreHits = 0;
      this.staggerTime = STAGGER_TIME;
      this.cancelWarning?.();
      this.cancelWarning = null;
      this.releaseAttack();
      this.cutAll(LINK.staggerRetry);
      this.setState('stagger');
      this.getHeadCenter(_p);
      this.ctx.fx.burst(_p, C.coreHot, 16, 3, 0.4, 0.06, 2);
      this.ctx.audio.play('hit_shield', { position: _p, volume: 0.8, pitch: 1.4 });
    }
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.links.length = 0;
    if (attackDirector.purging) return;
    const ctx = this.ctx;
    this.getHeadCenter(_p);
    ctx.fx.burst(_p, C.coreHot, 24, 4, 0.7, 0.08, 2);
    ctx.fx.burst(_p, C.core, 30, 3, 1.4, 0.09, -1);
    ctx.audio.play('shield_break', { position: _p, volume: 0.7, pitch: 1.8 });
  }

  // ───────────── 动画 ─────────────

  private deathT = 0;

  /** 死亡：灯芯熄灭，伞盖像一片落叶缓缓翻着沉下去，边沉边散成冰屑 */
  protected override animateDeath(t: number): void {
    const dt = Math.max(0, (t - this.deathT) * this.deathDuration);
    this.deathT = t;
    if (this.velocity.y < -1.4) this.velocity.y = -1.4;
    this.velocity.x *= 0.95;
    this.velocity.z *= 0.95;
    this.model.rotation.set(0.6 * smooth(t), t * 1.5, 0.3 * Math.sin(t * 4));
    const fade = smooth((t - 0.4) / 0.6);
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (1 - fade)));
    if (dt > 0) this.pose(dt);
    if (Math.random() < dt * 25) {
      this.getBodyCenter(_p);
      this.ctx.fx.burst(_p, C.shard, 1, 1, 1.2, 0.07, -0.4);
    }
  }

  protected override pose(dt: number): void {
    const t = this.age;
    // 伞盖脉动：0..0.35 快速收缩，之后慢慢舒张
    const u = (t % PULSE) / PULSE;
    const c = u < 0.35 ? Math.sin((Math.PI * u) / 0.35) : 0;
    this.pulseLift += ((0.05 * c) - this.pulseLift) * Math.min(1, dt * 6);
    const shock = this.state === 'shockWindup' ? smooth(this.stateTime / Math.max(0.01, this.windTime)) : 0;
    const stagger = this.state === 'stagger' ? Math.exp(-this.stateTime * 2.5) : 0;
    this.model.position.y = this.pulseLift - 0.08 * stagger;
    // 漂移惯性（模型空间）
    const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
    const vz = this.velocity.x * sf + this.velocity.z * cf, vx = this.velocity.x * cf - this.velocity.z * sf;
    const h = Math.max(dt, 1e-3);
    const az = ((this.velocity.x - this.prevVel.x) * sf + (this.velocity.z - this.prevVel.z) * cf) / h;
    this.prevVel.copy(this.velocity);
    this.drift.step(THREE.MathUtils.clamp(vz * 0.07 + az * 0.01, -0.5, 0.5), THREE.MathUtils.clamp(-vx * 0.07, -0.5, 0.5), dt);
    // 连线的触须朝同伴抬起
    for (const ts of this.tents) ts.lift *= Math.exp(-dt * 4);
    for (const L of this.links) {
      const ts = this.tents[L.tent];
      if (!ts) continue;
      const yaw = Math.atan2(L.ally.position.x - this.position.x, L.ally.position.z - this.position.z) - this.facing;
      ts.liftDir.set(Math.sin(yaw), 0, Math.cos(yaw));
      ts.lift = Math.min(1, ts.lift + dt * 8 * clamp01(L.spec.extend + 0.2));
    }
    if (this.nativeBody) this.poseNative(this.nativeBody, c, shock, stagger, dt);
    else this.poseClassic(c, shock, stagger);
    this.updateFx(dt, c, shock);
  }

  /**
   * 美术骨骼动画（creature_rigs/SK_Enemy_LanternJelly.json）。模型空间：X = 左，Y = 上，Z = 前。
   * - 伞盖：伞缘四瓣随脉动往里收，挂链随惯性摆，顶饰轻晃；灯芯随连线 / 前摇鼓动；被打中灯芯时整个缩一下。
   * - 触须：四节弹簧链，漂移时拖在后面（越往尖越弯），平时波浪从根往尖传；收缩时略张开；
   *   电冻前摇全部张开颤抖；连线的那条朝同伴抬起。
   */
  private poseNative(n: NativeBody, c: number, shock: number, stagger: number, dt: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const rim = 0.28 * c + 0.35 * stagger - 0.15 * shock;
    P.rotate('rim_F', AX, rim);
    P.rotate('rim_B', AX, -rim);
    P.rotate('rim_L', AZ, -rim);
    P.rotate('rim_R', AZ, rim);
    P.rotate('bell', AX, this.drift.x * 0.2 + 0.03 * Math.sin(t * 0.8));
    P.rotate('bell', AZ, -this.drift.y * 0.2 + 0.03 * Math.sin(t * 0.6 + 1));
    P.rotate('crown', AZ, 0.05 * Math.sin(t * 1.3));
    const glow = clamp01(this.glowLevel[0]);
    P.scale('core', (1 + 0.08 * glow + 0.05 * c) * (1 - 0.2 * stagger));
    P.rotate('frill', AX, -this.drift.x * 0.3);
    for (const side of ['L', 'R'] as const) {
      const m = side === 'L' ? 1 : -1;
      P.rotate(`chain_${side}1`, AX, this.drift.x * 0.8 + 0.05 * Math.sin(t * 1.7 + m));
      P.rotate(`chain_${side}1`, AZ, -this.drift.y * 0.6 + 0.15 * c * m);
      P.rotate(`chain_${side}2`, AX, this.drift.x * 0.5);
      // 口腕：随漂移慢慢拖着、轻轻扭
      for (let k = 1; k <= 3; k++) {
        const w = 0.25 + 0.2 * k;
        P.rotate(`oral_${side}${k}`, AX, this.drift.x * w + 0.06 * Math.sin(t * 1.1 - k * 0.8 + m));
        P.rotate(`oral_${side}${k}`, AZ, -this.drift.y * w + 0.08 * Math.sin(t * 0.9 - k * 0.7 + m * 2));
      }
    }
    const tremble = shock * Math.sin(t * 47);
    for (const ts of this.tents) {
      ts.sway.step(this.drift.x, this.drift.y, dt);
      for (let k = 0; k < 4; k++) {
        const w = 0.18 + 0.12 * k;
        const wave = 0.1 * Math.sin(t * 1.6 - k * 0.9 + ts.seed * 4);
        const wave2 = 0.08 * Math.sin(t * 1.25 - k * 0.8 + ts.seed * 7);
        P.rotate(ts.bones[k], AX, ts.sway.x * w + wave * (k + 1) * 0.35);
        P.rotate(ts.bones[k], AZ, ts.sway.y * w + wave2 * (k + 1) * 0.35);
        // 张开：根部转得多、尖部少；电冻前摇再加颤抖
        const flare = (0.12 * c + 0.75 * shock + 0.04 * tremble) * (k === 0 ? 1 : 0.35);
        P.rotate(ts.bones[k], ts.flareAxis, flare);
      }
      if (ts.lift > 0.01) {
        _v.crossVectors(DOWN, ts.liftDir);
        if (_v.lengthSq() > 1e-6) {
          _v.normalize();
          P.rotate(ts.bones[0], _v, 0.45 * ts.lift);
          P.rotate(ts.bones[1], _v, 0.2 * ts.lift);
        }
      }
    }
  }

  /** 程序化白模（?classic）：同一套触须摆动，转关节 */
  private poseClassic(c: number, shock: number, stagger: number): void {
    const t = this.age;
    this.body.scale.set(1 - 0.05 * c, 1 + 0.04 * c - 0.1 * stagger, 1 - 0.05 * c);
    for (let i = 0; i < this.classicTents.length; i++) {
      const chain = this.classicTents[i];
      const [x, z] = CLASSIC_TENT[TENTACLES[i]];
      const len = Math.hypot(x, z) || 1;
      const ox = x / len, oz = z / len;
      for (let k = 0; k < chain.length; k++) {
        const w = 0.18 + 0.12 * k;
        const flare = (0.12 * c + 0.75 * shock) * (k === 0 ? 1 : 0.35);
        chain[k].rotation.set(
          this.drift.x * w + 0.1 * Math.sin(t * 1.6 - k * 0.9 + i) * (k + 1) * 0.35 + flare * oz,
          0,
          this.drift.y * w + 0.08 * Math.sin(t * 1.25 - k * 0.8 + i * 2) * (k + 1) * 0.35 - flare * ox,
        );
      }
    }
  }

  /** 光触须、灯芯发光（发光壳）、治疗光点 */
  private updateFx(dt: number, c: number, shock: number): void {
    const ctx = this.ctx;
    const t = this.age;
    const specs = this.specs;
    specs.length = 0;
    for (const L of this.links) {
      L.spec.from.copy(this.linkStart(L.tent, _w));
      L.ally.getBodyCenter(_q);
      L.spec.to.copy(_q);
      specs.push(L.spec);
    }
    this.tendrils?.update(specs, 0.06 * this.sizeScale, 0.18, t, ctx.camera.getWorldPosition(_p));
    // 治疗光点：连上的同伴身上冒绿光
    this.healAcc += dt * this.links.length;
    while (this.healAcc > 0.3) {
      this.healAcc -= 0.3;
      const L = this.links[Math.floor(Math.random() * this.links.length)];
      if (!L || L.spec.extend < 1) continue;
      L.ally.getBodyCenter(_q);
      _q.x += (Math.random() - 0.5) * L.ally.radius * 2;
      _q.z += (Math.random() - 0.5) * L.ally.radius * 2;
      ctx.fx.burst(_q, C.heal, 2, 0.6, 0.9, 0.07, -1.6);
    }
    // 灯芯：发光壳透明度跟着连线数、前摇、脉动走；被打中闪亮
    const shell = this.nativeBody?.glowShell;
    const hitFlash = Math.max(0, 1 - (t - this.hitAt) * 6);
    const level = 0.3 + 0.12 * this.links.length + 0.25 * c + 0.5 * shock + 0.6 * hitFlash;
    if (shell) shell.opacity = this.alive ? Math.min(1, level) : 0;
    if (shock > 0.05 && Math.random() < dt * 20) {
      this.linkStart(Math.floor(Math.random() * TENTACLES.length), _q);
      ctx.fx.burst(_q, C.shock, 2, 1.5, 0.25, 0.04, 0);
    }
  }
}
