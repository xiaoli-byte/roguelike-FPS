/**
 * 英雄技能共用工具：伤害请求构造、出手点 / 投掷速度、冲击波、眩晕、持续效果会话、地面裂纹贴花。
 * 只依赖 core/types 的接口与冻结基础设施。
 */
import * as THREE from 'three';
import type { DamageRequest, Element, GameContext, IEnemy, SkillDef } from '../../core/types';
import { clamp01 } from '../../core/math';

/**
 * 本模块内部使用的技能定义扩展：reset 用于开新局 / 换英雄时立即终止持续效果并撤销全部修饰。
 * 仍然满足 SkillDef 契约，外部系统无需感知。
 */
export interface HeroSkillDef extends SkillDef {
  reset?(ctx: GameContext): void;
}

/** 技能配色 */
export const SKILL_COLORS = {
  fire: 0xff6a1f,
  fireCore: 0xffd27a,
  ember: 0xff9a3c,
  shock: 0x6fd8ff,
  shockCore: 0xe8fbff,
  earth: 0xc9a36b,
  gold: 0xffc861,
  dust: 0x9c8466,
} as const;

const _up = new THREE.Vector3(0, 1, 0);
const _aim = new THREE.Vector3();
const _right = new THREE.Vector3();
const _body = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _queryOut: IEnemy[] = [];

/** 技能伤害请求（source = skill，Combat 会乘 skillDamagePct） */
export function skillHit(base: number, element: Element, elementChance = 0): DamageRequest {
  return { base, element, source: 'skill', elementChance, procDepth: 0 };
}

/** 范围类技能的半径倍率（爆炸范围属性） */
export function radiusScale(ctx: GameContext): number {
  return ctx.player.stats.mult('explosionRadiusPct');
}

/** 第一人称「手部」出手点：眼前略偏右下 */
export function handOrigin(ctx: GameContext, out: THREE.Vector3, side = 1): THREE.Vector3 {
  const p = ctx.player;
  p.getAimDirection(_aim);
  _right.crossVectors(_aim, _up);
  if (_right.lengthSq() < 1e-6) _right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  _right.normalize();
  out.copy(p.eye).addScaledVector(_aim, 0.55).addScaledVector(_right, 0.22 * side);
  out.y -= 0.16;
  // 贴墙时别把投掷物塞进墙里
  if (ctx.world.segmentBlocked(p.eye, out)) out.copy(p.eye).addScaledVector(_aim, 0.15);
  return out;
}

/** 投掷速度：沿准星方向 speed，额外上抛 lift，并继承部分玩家水平速度 */
export function throwVelocity(ctx: GameContext, speed: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
  const p = ctx.player;
  p.getAimDirection(out).multiplyScalar(speed);
  out.y += lift;
  out.x += p.velocity.x * 0.35;
  out.z += p.velocity.z * 0.35;
  return out;
}

/** 眩晕：交给 Combat 施加；非首领额外保证 stunTime 至少为 seconds（首领是否免疫由 Combat 决定） */
export function stunEnemy(ctx: GameContext, e: IEnemy, seconds: number): void {
  if (!e.alive || seconds <= 0) return;
  ctx.combat.applyStatus(e, 'stun', 0, seconds);
  if (!e.isBoss && e.alive) e.stunTime = Math.max(e.stunTime, seconds);
}

/** 找到地面：point 正下方最高的地面高度（找不到时退回竞技场地面） */
export function groundYBelow(ctx: GameContext, point: THREE.Vector3): number {
  const gy = ctx.world.groundHeight(point.x, point.z, point.y + 0.35, 0.05);
  if (gy > -Infinity) return gy;
  return ctx.stage.arena?.floorY ?? 0;
}

export interface ShockwaveOptions {
  /** 最终半径（已乘范围倍率） */
  radius: number;
  /** 基础伤害（source=skill），0 = 只击退不伤害 */
  base: number;
  element?: Element;
  elementChance?: number;
  /** 水平击退速度（m/s，中心处） */
  knockback: number;
  /** 上抛速度（m/s，中心处） */
  lift: number;
  /** 眩晕秒数 */
  stun?: number;
  /** 伤害边缘衰减（缺省 0.45） */
  falloff?: number;
  color: number;
  secondaryColor?: number;
  /** 地面裂纹贴花 */
  crack?: boolean;
}

/**
 * 以脚底点 center 为圆心释放冲击波：范围伤害（explode）+ 向外击退 + 可选眩晕 + 地面冲击环特效。
 * 返回被伤害命中的敌人数量。
 */
export function shockwave(ctx: GameContext, center: THREE.Vector3, o: ShockwaveOptions): number {
  _body.set(center.x, center.y + 0.9, center.z);
  let hits = 0;
  if (o.base > 0) {
    hits = ctx.combat.explode(_body, o.radius, skillHit(o.base, o.element ?? 'none', o.elementChance ?? 0), {
      noFx: true,
      color: o.color,
      falloff: o.falloff ?? 0.45,
    });
  }
  _queryOut.length = 0;
  const list = ctx.enemies.queryRadius(_body, o.radius, _queryOut);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    let dx = e.position.x - center.x;
    let dz = e.position.z - center.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = 1;
      dz = 0;
      d = 1;
    }
    const k = 1 - 0.5 * clamp01(d / o.radius);
    _imp.set((dx / d) * o.knockback * k, o.lift * k, (dz / d) * o.knockback * k);
    e.knockback(_imp);
    if (o.stun) stunEnemy(ctx, e, o.stun);
  }
  _queryOut.length = 0;

  // 特效
  _body.set(center.x, center.y + 0.08, center.z);
  ctx.fx.ring(_body, o.radius, o.color, 0.45);
  ctx.fx.ring(_body, o.radius * 0.55, o.secondaryColor ?? o.color, 0.3);
  _body.y = center.y + 0.3;
  ctx.fx.burst(_body, SKILL_COLORS.dust, 28, o.radius * 1.1, 0.7, 0.14, 14);
  ctx.fx.burst(_body, o.secondaryColor ?? o.color, 14, o.radius * 1.4, 0.4, 0.06, 6);
  if (o.crack) spawnGroundCrack(ctx, center, o.radius * 0.8, o.secondaryColor ?? o.color, 1.6);
  return hits;
}

/**
 * 半径内按距离由近到远取最多 max 个活着的敌人（需要视线时检查静态遮挡），结果写入 out。
 */
export function nearestEnemies(ctx: GameContext, center: THREE.Vector3, radius: number, max: number, out: IEnemy[], needLos = false): IEnemy[] {
  out.length = 0;
  _queryOut.length = 0;
  const list = ctx.enemies.queryRadius(center, radius, _queryOut);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    if (needLos) {
      e.getBodyCenter(_body);
      if (ctx.world.segmentBlocked(center, _body)) continue;
    }
    out.push(e);
  }
  _queryOut.length = 0;
  // 部分选择排序：只排出最近的 max 个
  const n = out.length;
  const k = Math.min(max, n);
  for (let i = 0; i < k; i++) {
    let best = i;
    let bd = out[i].position.distanceToSquared(center);
    for (let j = i + 1; j < n; j++) {
      const d = out[j].position.distanceToSquared(center);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best !== i) {
      const tmp = out[i];
      out[i] = out[best];
      out[best] = tmp;
    }
  }
  out.length = k;
  return out;
}

// ───────────────────────────── 持续效果会话 ─────────────────────────────

/**
 * 持续型技能的生命周期：记录所有撤销函数（修饰、监听、flags），结束时逆序执行。
 * 兜底：换关（stage:loaded）、开新局、结算、回主菜单时自动结束（不触发「自然结束」效果）。
 */
export class EffectSession {
  active = false;
  private disposers: (() => void)[] = [];

  /** onEnd：无论自然结束还是兜底结束都会调用，用于复位技能内部状态 */
  constructor(private readonly onEnd?: () => void) {}

  begin(ctx: GameContext): void {
    this.end();
    this.active = true;
    const stop = () => this.end();
    this.track(ctx.events.on('stage:loaded', stop));
    this.track(ctx.events.on('run:started', stop));
    this.track(ctx.events.on('run:ended', stop));
    this.track(ctx.events.on('game:stateChanged', (e) => {
      if (e.to === 'menu') stop();
    }));
  }

  track(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  end(): void {
    if (!this.active) return;
    this.active = false;
    const list = this.disposers;
    this.disposers = [];
    for (let i = list.length - 1; i >= 0; i--) {
      try {
        list[i]();
      } catch (err) {
        console.error('[Skill] dispose threw', err);
      }
    }
    this.onEnd?.();
  }
}

// ───────────────────────────── 地面裂纹贴花 ─────────────────────────────

let crackGeo: THREE.BufferGeometry | null = null;
const crackMats: THREE.MeshBasicMaterial[] = [];
let crackMatIndex = 0;

/** 程序化生成放射状裂纹（XZ 平面，半径约 1） */
function getCrackGeometry(): THREE.BufferGeometry {
  if (crackGeo) return crackGeo;
  const pos: number[] = [];
  const spikes = 13;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const len = 0.55 + Math.random() * 0.45;
    const w = 0.05 + Math.random() * 0.05;
    const r0 = 0.14;
    // 主裂纹
    pos.push(Math.cos(a - w) * r0, 0, Math.sin(a - w) * r0);
    pos.push(Math.cos(a) * len, 0, Math.sin(a) * len);
    pos.push(Math.cos(a + w) * r0, 0, Math.sin(a + w) * r0);
    // 分叉
    if (Math.random() < 0.6) {
      const mid = len * (0.45 + Math.random() * 0.2);
      const ba = a + (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.3);
      const bl = mid + len * 0.35;
      const mx = Math.cos(a) * mid, mz = Math.sin(a) * mid;
      pos.push(mx - Math.sin(a) * 0.025, 0, mz + Math.cos(a) * 0.025);
      pos.push(Math.cos(ba) * bl, 0, Math.sin(ba) * bl);
      pos.push(mx + Math.sin(a) * 0.025, 0, mz - Math.cos(a) * 0.025);
    }
  }
  // 中心凹坑
  const seg = 12;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    pos.push(0, 0, 0);
    pos.push(Math.cos(a1) * 0.2, 0, Math.sin(a1) * 0.2);
    pos.push(Math.cos(a0) * 0.2, 0, Math.sin(a0) * 0.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  crackGeo = g;
  return g;
}

function nextCrackMaterial(color: number): THREE.MeshBasicMaterial {
  if (crackMats.length === 0) {
    for (let i = 0; i < 6; i++) {
      crackMats.push(new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }));
    }
  }
  const m = crackMats[crackMatIndex];
  crackMatIndex = (crackMatIndex + 1) % crackMats.length;
  m.color.setHex(color);
  m.opacity = 1;
  return m;
}

/** 地面发光裂纹，duration 秒内淡出（挂 stageGroup，换关自动移除） */
export function spawnGroundCrack(ctx: GameContext, center: THREE.Vector3, radius: number, color: number, duration: number): void {
  const mat = nextCrackMaterial(color);
  const mesh = new THREE.Mesh(getCrackGeometry(), mat);
  mesh.position.set(center.x, groundYBelow(ctx, center) + 0.03, center.z);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.scale.setScalar(radius * 0.3);
  mesh.renderOrder = 2;
  ctx.stageGroup.add(mesh);
  ctx.tasks.tween(duration, (t) => {
    const grow = 1 - Math.pow(1 - Math.min(1, t * 6), 3);
    mesh.scale.setScalar(radius * (0.3 + 0.7 * grow));
    mat.opacity = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
  }, () => mesh.removeFromParent());
}
