/**
 * 迅捷精英挥出的前行龙卷（Unity G/Enemies/Affixes/EliteTornado.cs + EliteAffix_Swift 的龙卷段）：
 * 锁定方向直线推进（8 m/s、射程 20 m = 寿命 2.5 s），碰到玩家只结算一次（18 × 伤害倍率、掀起 + 侧推），撞墙或寿命结束即散开。
 * 判定是水平扫掠圆（半径 1.35 m + 玩家半径）对玩家圆，再查龙卷竖直范围（5.8 m）：低帧率下跨过玩家也不会漏判。
 * 外观：程序化的层叠风环（章节尘色：沙 / 霜 / 火），不依赖贴图；Unity 的三阶手绘风带随 M11b 特效核心再换。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../core/types';

/** 龙卷参数（Unity EliteTornado 常量） */
export const TORNADO = {
  /** 蓄风前摇（秒） */
  windup: 0.85,
  /** 射程（米）、前行速度（米 / 秒）、扫掠半径、竖直高度、基础伤害（× 出手者伤害倍率） */
  range: 20,
  speed: 8,
  radius: 1.35,
  height: 5.8,
  baseDamage: 18,
  /** 两次龙卷之间的冷却（秒，随机） */
  cooldownMin: 7.5,
  cooldownMax: 10.5,
  /** 第一次龙卷前的冷却（秒，随机；Unity Swift.OnInstall） */
  firstMin: 4.5,
  firstMax: 6.5,
  /** 出手距离带（水平）与高差上限 */
  minDistance: 4,
  maxDistance: 24,
  maxRise: 4,
  /** 出手后的收招（秒）：之后交还基础 AI */
  recovery: 0.22,
  /** 打中玩家的冲量：沿前进方向、侧推、上抛（m/s） */
  pushForward: 3.5,
  pushSide: 2.2,
  pushUp: 6.2,
} as const;

/** 水平扫掠圆与玩家圆相交，并检查龙卷竖直范围（Unity EliteTornado.SweepOverlaps，同样的数） */
export function sweepOverlaps(
  from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number },
  playerFeet: { x: number; y: number; z: number }, playerRadius: number,
): boolean {
  if (playerFeet.y > Math.max(from.y, to.y) + TORNADO.height || playerFeet.y + 1.8 < Math.min(from.y, to.y) - 0.2) return false;
  const ax = from.x, az = from.z;
  const abx = to.x - ax, abz = to.z - az;
  const apx = playerFeet.x - ax, apz = playerFeet.z - az;
  const ab2 = abx * abx + abz * abz;
  const t = ab2 > 1e-6 ? Math.min(1, Math.max(0, (apx * abx + apz * abz) / ab2)) : 0;
  const r = TORNADO.radius + Math.max(0, playerRadius);
  const dx = apx - abx * t, dz = apz - abz * t;
  return dx * dx + dz * dz <= r * r;
}

/** 章节尘色（Unity FxTone.Chapter：第二章霜、第三章火，其余沙 / 风） */
export function tornadoColor(chapterIndex: number): number {
  return chapterIndex === 1 ? 0xc4ecf6 : chapterIndex === 2 ? 0xff9a4a : 0xd8c49a;
}

// ───────────── 外观：层叠风环 ─────────────

const RINGS = 6;
let ringGeo: THREE.TorusGeometry | null = null;

/** 一团风：RINGS 圈由下往上变大的风环，各自转，整体淡入淡出。charge = 蓄风时脚下的小旋风 */
export class TornadoLook {
  readonly group = new THREE.Group();
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private t = Math.random() * 10;
  private alpha = 1;

  constructor(color: number, height: number, width: number) {
    if (!ringGeo) ringGeo = new THREE.TorusGeometry(1, 0.07, 4, 24, Math.PI * 1.55);
    for (let i = 0; i < RINGS; i++) {
      const k = i / (RINGS - 1);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25 * (1 - k)), transparent: true,
        opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.rotation.x = Math.PI / 2;
      m.position.y = height * (0.06 + 0.9 * k);
      m.scale.setScalar(width * (0.32 + 0.68 * k * k + 0.12));
      m.frustumCulled = false;
      this.mats.push(mat);
      this.rings.push(m);
      this.group.add(m);
    }
  }

  /** 每帧：转、按 alpha 淡入淡出 */
  update(dt: number, spin = 1): void {
    this.t += dt;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.rotation.z += dt * spin * (7 + i * 1.6) * (i % 2 === 0 ? 1 : -1);
      r.position.x = Math.sin(this.t * 5 + i * 0.9) * 0.12 * i;
      r.position.z = Math.cos(this.t * 4.3 + i * 1.1) * 0.12 * i;
      this.mats[i].opacity = this.alpha * (0.38 + 0.22 * Math.sin(this.t * 9 + i));
    }
  }

  set opacity(v: number) {
    this.alpha = Math.max(0, v);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
  }
}

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();
const _imp = new THREE.Vector3();

/** 一道正在前行的龙卷（ctx.tasks 推进；换关时随非常驻任务一起清掉） */
export class EliteTornado {
  /** 打中玩家几次（测试 / 冒烟读，最多 1） */
  playerHits = 0;
  readonly position = new THREE.Vector3();
  readonly direction = new THREE.Vector3();
  private life: number;
  private age = 0;
  private spent = false;
  private nearRumble = false;
  private ended = false;
  private fade = 0;
  private readonly look: TornadoLook;
  private cancelTask: (() => void) | null = null;

  private constructor(
    private readonly ctx: GameContext, private readonly source: IEnemy | null, ground: THREE.Vector3, dir: THREE.Vector3,
    readonly damage: number,
  ) {
    this.position.copy(ground);
    this.direction.set(dir.x, 0, dir.z);
    if (this.direction.lengthSq() < 1e-5) this.direction.set(0, 0, 1);
    this.direction.normalize();
    this.life = TORNADO.range / TORNADO.speed;
    this.look = new TornadoLook(tornadoColor(ctx.run.chapter), TORNADO.height, 1.65);
    this.look.group.position.copy(ground);
    this.look.group.scale.setScalar(0.45);
    (ctx.stageGroup ?? ctx.scene).add(this.look.group);
  }

  /** 生成一道龙卷：ground = 起点（地面），dir = 前进方向（水平），damage = 已乘倍率的伤害 */
  static spawn(ctx: GameContext, source: IEnemy | null, ground: THREE.Vector3, dir: THREE.Vector3, damage: number): EliteTornado {
    const t = new EliteTornado(ctx, source, ground, dir, damage);
    t.cancelTask = ctx.tasks.add((dt) => t.step(dt));
    return t;
  }

  get alive(): boolean {
    return !this.ended;
  }

  /** 提前散开（0.15 s 内） */
  dissipate(): void {
    this.life = Math.min(this.life, 0.15);
  }

  /** 推进一帧；返回 true 表示整个结束（任务移除） */
  step(dt: number): boolean {
    if (!(dt > 0)) return false;
    if (this.ended) {
      // 散开：0.35 s 淡出、放大一点
      this.fade += dt;
      const k = Math.min(1, this.fade / 0.35);
      this.look.opacity = 1 - k;
      this.look.group.scale.setScalar(1 + 0.25 * k);
      this.look.update(dt, 1 - k * 0.6);
      if (k >= 1) {
        this.look.dispose();
        return true;
      }
      return false;
    }
    this.life -= dt;
    if (this.life <= 0) {
      this.end();
      return false;
    }
    this.age += dt;
    this.look.group.scale.setScalar(THREE.MathUtils.lerp(0.45, 1, 1 - Math.exp(-this.age * 13)));
    this.look.update(dt);

    const ctx = this.ctx;
    _from.copy(this.position);
    _to.copy(this.position).addScaledVector(this.direction, TORNADO.speed * dt);
    // 撞墙：膝上 1.1 m 的一条线被地形 / 建筑挡住就散开
    _p.set(_from.x, _from.y + 1.1, _from.z);
    const a = _p.clone();
    _p.set(_to.x, _to.y + 1.1, _to.z);
    if (ctx.world.segmentBlocked(a, _p)) {
      a.y = _from.y + 0.7;
      ctx.fx.burst(a, 0x58a6b3, 7, 3.5, 0.35, 0.16, 0);
      this.end();
      return false;
    }
    const gy = ctx.world.groundHeight(_to.x, _to.z, _from.y + 2.5);
    _to.y = Number.isFinite(gy) && gy > _from.y - 8 ? gy : _from.y;
    this.position.copy(_to);
    this.look.group.position.copy(_to);

    const player = ctx.player;
    if (!player.alive) return false;
    const dist = player.position.distanceTo(_to);
    if (!this.nearRumble && dist < 6) {
      this.nearRumble = true;
      ctx.fx.shake(0.08, 0.22);
    }
    if (this.spent) return false;
    if (!sweepOverlaps(_from, _to, player.position, player.radius)) return false;
    this.spent = true;
    _p.copy(_to).y += 1;
    const dealt = ctx.combat.damagePlayer(this.damage, 'none', this.source, _p);
    if (!(dealt > 0)) return false;
    this.playerHits++;
    const d = this.direction;
    // 侧推 = Cross(up, dir) = (dir.z, 0, −dir.x)
    _imp.set(d.x * TORNADO.pushForward + d.z * TORNADO.pushSide, TORNADO.pushUp, d.z * TORNADO.pushForward - d.x * TORNADO.pushSide);
    player.applyImpulse(_imp);
    ctx.fx.shake(0.32, 0.28);
    _p.copy(_to).y += 0.08;
    ctx.fx.ring(_p, TORNADO.radius * 1.5, 0xc6e7dc, 0.28);
    _p.copy(player.position).y += 1;
    ctx.fx.burst(_p, 0xc6e7dc, 10, 5, 0.35, 0.13, 0);
    return false;
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.fade = 0;
  }

  /** 立刻移除（测试 / 清场） */
  dispose(): void {
    this.cancelTask?.();
    this.cancelTask = null;
    this.ended = true;
    this.look.dispose();
  }
}
