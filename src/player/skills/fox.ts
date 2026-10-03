/**
 * 赤狐 · 焰尾游侠：燃爆雷（E）、九尾狐火（Q）、余烬（被动）。
 */
import * as THREE from 'three';
import type { GameContext, HeroDef, IEnemy } from '../../core/types';
import { TAU } from '../../core/math';
import {
  EffectSession, type HeroSkillDef, SKILL_COLORS, groundYBelow, handOrigin, radiusScale, skillHit, spawnGroundCrack, throwVelocity,
} from './common';

// ───────────────────────────── 数值 ─────────────────────────────

const GRENADE_RADIUS = 4.5;
const GRENADE_DAMAGE = 120;
const GRENADE_SPEED = 21;
const GRENADE_LIFT = 3.2;
const GRENADE_GRAVITY = 20;
/** 正常 2.5 秒内必然落地；到期仍未触地（例如被抛出场外）则在空中自爆 */
const GRENADE_LIFETIME = 4;
/** 爆心处的击退速度（m/s，随距离衰减；explode 未指定击退时不推人） */
const GRENADE_KNOCKBACK = 7;

const FOXFIRE_COUNT = 9;
const FOXFIRE_DURATION = 3;
const FOXFIRE_FIRST = 0.3;
const FOXFIRE_INTERVAL = (FOXFIRE_DURATION - FOXFIRE_FIRST) / (FOXFIRE_COUNT - 1);
const FOXFIRE_DAMAGE = 60;
const FOXFIRE_SPEED = 17;
const FOXFIRE_HOMING = 7;
const FOXFIRE_RANGE = 45;

const EMBER_BONUS = 0.2;

const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _c = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _to = new THREE.Vector3();
const _cands: IEnemy[] = [];

// ───────────────────────────── E：燃爆雷 ─────────────────────────────

/**
 * 手雷本身是带 damage 与 explosionRadius 的玩家投射物：触地 / 命中敌人 / 到期都由投射物系统调用 combat.explode
 * 结算伤害，并播放默认爆炸特效、音效与震屏。每个敌人收到的请求是 source 'skill' + tag 'explosion'
 * （explode 只追加标签、不改 source），同时吃技能伤害与爆炸伤害加成；击退只来自这里显式给的 knockback。
 * 这里只在触碰时（onImpact）补充火焰专属的表现：火星、地面裂纹、冲击环与余火。
 * 到期自爆不回调 onImpact（带伤害的投射物不是「载体」），所以空中自爆只有默认爆炸特效。
 */
function grenadeImpactFx(ctx: GameContext, point: THREE.Vector3, r: number): void {
  _c.copy(point);
  ctx.fx.burst(_c, SKILL_COLORS.ember, 34, 9, 0.9, 0.09, 9);
  ctx.fx.burst(_c, SKILL_COLORS.fireCore, 14, 5, 0.45, 0.14, 0);
  const gy = groundYBelow(ctx, _c);
  const nearGround = _c.y - gy < 1.2;
  if (nearGround) {
    _c.y = gy + 0.08;
    spawnGroundCrack(ctx, _c, r * 0.55, SKILL_COLORS.fire, 1.4);
  }
  ctx.fx.ring(_c, r, SKILL_COLORS.fire, 0.4);
  ctx.audio.play('skill_fire', { position: point, volume: 0.9 });

  // 余火：落点附近短暂飘散火星
  const ex = point.x, ey = point.y, ez = point.z;
  let n = 0;
  ctx.tasks.every(0.18, () => {
    _c.set(ex + (Math.random() - 0.5) * r * 0.9, Math.max(gy + 0.2, ey), ez + (Math.random() - 0.5) * r * 0.9);
    ctx.fx.burst(_c, SKILL_COLORS.ember, 5, 1.6, 0.6, 0.07, -2);
    return ++n >= 5;
  });
}

const blazeGrenade: HeroSkillDef = {
  id: 'fox_blaze_grenade',
  name: '燃爆雷',
  description: `掷出一枚火焰手雷，触地或命中敌人即爆炸，对 ${GRENADE_RADIUS} 米内敌人造成 ${GRENADE_DAMAGE} 点火焰伤害，并必定附加灼烧。2 次充能，每次充能 8 秒。`,
  cooldown: 8,
  charges: 2,
  activate(ctx) {
    if (!ctx.player.alive) return false;
    handOrigin(ctx, _pos);
    throwVelocity(ctx, GRENADE_SPEED, GRENADE_LIFT, _vel);
    const r = GRENADE_RADIUS * radiusScale(ctx);
    const damage = skillHit(GRENADE_DAMAGE, 'fire', 1);
    damage.knockback = GRENADE_KNOCKBACK;
    ctx.projectiles.spawn({
      owner: 'player',
      position: _pos.clone(),
      velocity: _vel.clone(),
      gravity: GRENADE_GRAVITY,
      radius: 0.2,
      lifetime: GRENADE_LIFETIME,
      damage,
      element: 'fire',
      explosionRadius: r,
      explodeOnExpire: true,
      selfDamage: 0,
      color: SKILL_COLORS.fire,
      visual: 'grenade',
      scale: 1.1,
      onImpact: (point) => grenadeImpactFx(ctx, point, r),
    });
    ctx.audio.play('skill_throw', { volume: 0.9 });
    return true;
  },
};

// ───────────────────────────── Q：九尾狐火 ─────────────────────────────

let orbCoreGeo: THREE.IcosahedronGeometry | null = null;
let orbGlowGeo: THREE.IcosahedronGeometry | null = null;
let orbCoreMat: THREE.MeshBasicMaterial | null = null;
let orbGlowMat: THREE.MeshBasicMaterial | null = null;
/** 环绕周身的九团狐火（模块级复用，每次释放重新挂到 stageGroup） */
const orbs: THREE.Group[] = [];

function ensureOrbs(): void {
  if (orbs.length) return;
  orbCoreGeo = new THREE.IcosahedronGeometry(0.07, 1);
  orbGlowGeo = new THREE.IcosahedronGeometry(0.13, 1);
  orbCoreMat = new THREE.MeshBasicMaterial({ color: SKILL_COLORS.fireCore });
  orbGlowMat = new THREE.MeshBasicMaterial({
    color: SKILL_COLORS.fire, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < FOXFIRE_COUNT; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(orbCoreGeo, orbCoreMat));
    g.add(new THREE.Mesh(orbGlowGeo, orbGlowMat));
    g.name = 'foxfire';
    orbs.push(g);
  }
}

let foxT = 0;
let foxLaunched = 0;
/** 本次释放中每个敌人被瞄准的次数，用于把狐火分散到多个目标 */
const foxTargeted = new Map<number, number>();

const foxSession = new EffectSession(() => {
  for (const o of orbs) o.removeFromParent();
  foxTargeted.clear();
});

function orbPosition(ctx: GameContext, i: number, out: THREE.Vector3): THREE.Vector3 {
  const p = ctx.player;
  const a = foxT * 2.6 + (i / FOXFIRE_COUNT) * TAU;
  const r = 1.0 + 0.08 * Math.sin(foxT * 5 + i);
  return out.set(
    p.position.x + Math.sin(a) * r,
    p.eye.y - 0.42 + 0.1 * Math.sin(foxT * 4 + i * 1.3),
    p.position.z + Math.cos(a) * r,
  );
}

function pickFoxTarget(ctx: GameContext): IEnemy | null {
  const p = ctx.player;
  p.getAimDirection(_aim);
  _cands.length = 0;
  const list = ctx.enemies.queryRadius(p.position, FOXFIRE_RANGE, _cands);
  let best: IEnemy | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    e.getBodyCenter(_to).sub(p.eye);
    const dist = _to.length();
    if (dist < 1e-3) continue;
    const dot = _to.dot(_aim) / dist;
    if (dot < -0.2) continue;
    let score = dot - 0.3 * (foxTargeted.get(e.id) ?? 0) - dist / 150;
    // 优先有视线的目标（被墙挡住的追踪弹容易撞墙）
    if (score > bestScore - 0.6) {
      e.getBodyCenter(_c);
      if (ctx.world.segmentBlocked(p.eye, _c)) score -= 0.6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  _cands.length = 0;
  return best;
}

function launchFoxfire(ctx: GameContext, i: number): void {
  const orb = orbs[i];
  orb.removeFromParent();
  orbPosition(ctx, i, _pos);
  // 贴墙时狐火可能在墙里，改从手边发出
  if (ctx.world.segmentBlocked(ctx.player.eye, _pos)) handOrigin(ctx, _pos, i % 2 === 0 ? 1 : -1);
  const target = pickFoxTarget(ctx);
  if (target) {
    foxTargeted.set(target.id, (foxTargeted.get(target.id) ?? 0) + 1);
    target.getBodyCenter(_to).sub(_pos).normalize();
  } else {
    ctx.player.getAimDirection(_to);
  }
  // 先向外、向上甩出一道弧线，再由追踪拐向目标
  const p = ctx.player;
  const ox = _pos.x - p.position.x, oz = _pos.z - p.position.z;
  const ol = Math.hypot(ox, oz) || 1;
  _vel.copy(_to).multiplyScalar(FOXFIRE_SPEED);
  _vel.x += (ox / ol) * 4;
  _vel.z += (oz / ol) * 4;
  _vel.y += 2.5;
  ctx.projectiles.spawn({
    owner: 'player',
    position: _pos.clone(),
    velocity: _vel.clone(),
    radius: 0.3,
    lifetime: 3.5,
    damage: skillHit(FOXFIRE_DAMAGE, 'fire', 1),
    element: 'fire',
    homing: FOXFIRE_HOMING,
    color: SKILL_COLORS.fire,
    visual: 'flame',
    scale: 1.3,
    onImpact: (point) => ctx.fx.burst(point, SKILL_COLORS.ember, 12, 4.5, 0.4, 0.08, 4),
  });
  ctx.fx.burst(_pos, SKILL_COLORS.fireCore, 6, 2, 0.25, 0.06, 0);
  ctx.audio.play('skill_fire', { volume: 0.45, pitch: 1.15 + Math.random() * 0.25 });
}

const nineTails: HeroSkillDef = {
  id: 'fox_nine_tails',
  name: '九尾狐火',
  description: `唤出九团环绕周身的狐火，${FOXFIRE_DURATION} 秒内依次射向前方敌人并自动追踪，每团造成 ${FOXFIRE_DAMAGE} 点火焰伤害并附加灼烧，会优先分散到不同目标。冷却 20 秒。`,
  cooldown: 20,
  charges: 1,
  activate(ctx) {
    if (!ctx.player.alive) return false;
    ensureOrbs();
    foxSession.begin(ctx);
    foxT = 0;
    foxLaunched = 0;
    foxTargeted.clear();
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      o.scale.setScalar(0.01);
      orbPosition(ctx, i, o.position);
      ctx.stageGroup.add(o);
    }
    const p = ctx.player;
    _c.set(p.position.x, p.position.y + 1.1, p.position.z);
    ctx.fx.burst(_c, SKILL_COLORS.fire, 26, 4, 0.6, 0.1, -1);
    _c.y = p.position.y + 0.08;
    ctx.fx.ring(_c, 3.2, SKILL_COLORS.fire, 0.45);
    ctx.audio.play('skill_buff', { volume: 0.7, pitch: 1.1 });
    ctx.audio.play('skill_fire', { volume: 0.8, pitch: 0.8 });
    return true;
  },
  update(ctx, dt) {
    if (!foxSession.active) return;
    if (!ctx.player.alive) {
      foxSession.end();
      return;
    }
    foxT += dt;
    const grow = Math.min(1, foxT / 0.25);
    for (let i = foxLaunched; i < orbs.length; i++) {
      const o = orbs[i];
      orbPosition(ctx, i, o.position);
      o.scale.setScalar(grow * (0.9 + 0.15 * Math.sin(foxT * 12 + i * 2.1)));
    }
    while (foxLaunched < FOXFIRE_COUNT && foxT >= FOXFIRE_FIRST + foxLaunched * FOXFIRE_INTERVAL) {
      launchFoxfire(ctx, foxLaunched++);
    }
    if (foxLaunched >= FOXFIRE_COUNT) foxSession.end();
  },
  isActive: () => foxSession.active,
  reset: () => foxSession.end(),
};

// ───────────────────────────── 英雄 ─────────────────────────────

export const FOX: HeroDef = {
  id: 'fox',
  name: '赤狐',
  title: '焰尾游侠',
  description:
    '焰尾部族最后的游侠，自幼与九尾狐火为伴，在荒漠遗迹里追猎了十年的沙匪。她用冲锋枪压制、以燃爆雷点燃成群的敌人，再放出追踪狐火收割——火烧得越旺，她的枪口就越致命。',
  color: 0xff6a1f,
  base: { maxHp: 100, maxShield: 60, moveSpeed: 7.8 },
  startingWeapon: 'smg',
  primary: nineTails,
  secondary: blazeGrenade,
  passive: {
    name: '余烬',
    description: `对处于灼烧状态的敌人造成的所有伤害提高 ${Math.round(EMBER_BONUS * 100)}%。`,
    apply(ctx) {
      const off = ctx.combat.addOutgoingModifier((enemy) => (enemy.statuses.has('burn') ? 1 + EMBER_BONUS : 1));
      return () => off();
    },
  },
};
