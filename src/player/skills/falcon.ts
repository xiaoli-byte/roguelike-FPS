/**
 * 雷隼 · 天穹猎手：雷暴信标（E）、鹰眼·裁决（Q）、凌空（被动：二段跳 / 空中增伤 / 滑翔）。
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, HeroDef, IEnemy } from '../../core/types';
import {
  EffectSession, type HeroSkillDef, SKILL_COLORS, groundYBelow, handOrigin, nearestEnemies, radiusScale, skillHit, throwVelocity,
} from './common';

// ───────────────────────────── 数值 ─────────────────────────────

const BEACON_RADIUS = 7;
const BEACON_DURATION = 5;
const BEACON_INTERVAL = 0.5;
const BEACON_TARGETS = 4;
const BEACON_DAMAGE = 45;
const BEACON_TOP = 1.05;
/**
 * 投掷物存活时间。正常抛物线 2.5 秒内必然落地（投射物系统有竞技场 floorY 的地面兜底）。
 * 信标投掷物是「载体」投射物（不带 damage、没有 explosionRadius，效果全在 onImpact 里）：
 * 万一到期仍未碰到东西，投射物系统会在它到期的位置回调一次 onImpact(point, null)，
 * deployBeacon 再把信标落到该点正下方的地面展开，不会空耗充能。
 */
const BEACON_THROW_LIFETIME = 6;

const HAWK_DURATION = 8;
const HAWK_FIRE_RATE = 0.4;
const HAWK_CHAIN_RANGE = 10;
const HAWK_CHAIN_RATIO = 0.55;
const HAWK_SOURCE = 'skill:falcon_q';

const AIR_BONUS = 0.15;

const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _targets: IEnemy[] = [];
const _exclude = new Set<IEnemy>();

// ───────────────────────────── E：雷暴信标 ─────────────────────────────

interface BeaconParts {
  base: THREE.CylinderGeometry;
  pole: THREE.CylinderGeometry;
  orb: THREE.IcosahedronGeometry;
  glow: THREE.IcosahedronGeometry;
  ring: THREE.TorusGeometry;
  area: THREE.RingGeometry;
  disc: THREE.CircleGeometry;
  metal: THREE.MeshStandardMaterial;
  core: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
  line: THREE.MeshBasicMaterial;
  zone: THREE.MeshBasicMaterial;
}

let parts: BeaconParts | null = null;

function beaconParts(): BeaconParts {
  if (parts) return parts;
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;
  parts = {
    base: new THREE.CylinderGeometry(0.26, 0.34, 0.12, 10),
    pole: new THREE.CylinderGeometry(0.04, 0.065, 0.9, 6),
    orb: new THREE.IcosahedronGeometry(0.14, 1),
    glow: new THREE.IcosahedronGeometry(0.3, 1),
    ring: new THREE.TorusGeometry(0.34, 0.022, 6, 28),
    area: new THREE.RingGeometry(0.965, 1, 72).rotateX(-Math.PI / 2),
    disc: new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
    metal: new THREE.MeshStandardMaterial({ color: 0x2c3644, metalness: 0.6, roughness: 0.4, emissive: 0x0b2a3a, emissiveIntensity: 0.6 }),
    core: new THREE.MeshBasicMaterial({ color: SKILL_COLORS.shockCore }),
    halo: new THREE.MeshBasicMaterial({ color: SKILL_COLORS.shock, opacity: 0.45, ...additive }),
    line: new THREE.MeshBasicMaterial({ color: SKILL_COLORS.shock, opacity: 0.9, ...additive }),
    zone: new THREE.MeshBasicMaterial({ color: SKILL_COLORS.shock, opacity: 0.07, side: THREE.DoubleSide, ...additive }),
  };
  return parts;
}

interface BeaconView {
  root: THREE.Group;
  mast: THREE.Group;
  orb: THREE.Mesh;
  spin: THREE.Group;
  area: THREE.Group;
}

function buildBeacon(): BeaconView {
  const p = beaconParts();
  const root = new THREE.Group();
  root.name = 'stormBeacon';
  const base = new THREE.Mesh(p.base, p.metal);
  base.position.y = 0.06;
  base.castShadow = true;
  root.add(base);

  const mast = new THREE.Group();
  const pole = new THREE.Mesh(p.pole, p.metal);
  pole.position.y = 0.55;
  pole.castShadow = true;
  mast.add(pole);
  const orb = new THREE.Mesh(p.orb, p.core);
  orb.position.y = BEACON_TOP;
  orb.add(new THREE.Mesh(p.glow, p.halo));
  mast.add(orb);
  const spin = new THREE.Group();
  spin.position.y = 0.88;
  const ring = new THREE.Mesh(p.ring, p.line);
  ring.rotation.x = Math.PI / 2 + 0.45;
  spin.add(ring);
  const ring2 = new THREE.Mesh(p.ring, p.line);
  ring2.rotation.x = Math.PI / 2 - 0.45;
  ring2.scale.setScalar(0.75);
  spin.add(ring2);
  mast.add(spin);
  root.add(mast);

  const area = new THREE.Group();
  area.position.y = 0.04;
  const edge = new THREE.Mesh(p.area, p.line);
  edge.renderOrder = 2;
  area.add(edge);
  const disc = new THREE.Mesh(p.disc, p.zone);
  disc.renderOrder = 1;
  area.add(disc);
  root.add(area);
  return { root, mast, orb, spin, area };
}

function beaconZap(ctx: GameContext, top: THREE.Vector3, radius: number): number {
  const list = nearestEnemies(ctx, top, radius, BEACON_TARGETS, _targets, true);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    e.getBodyCenter(_b);
    ctx.fx.lightning(top, _b, SKILL_COLORS.shock);
    const req = skillHit(BEACON_DAMAGE, 'shock', 1);
    // 平衡：信标每跳按「连锁伤害」结算（procDepth 1），附着的雷殛不再向周围弹射；
    // 雷殛叠层、叠满 3 层眩晕与 +15% 雷伤标记照常。否则 4 个目标 × 每跳弹射 3 次，输出约为设计值的 2.5 倍。
    req.procDepth = 1;
    req.point = _b.clone();
    req.direction = _a.subVectors(_b, top).normalize().clone();
    ctx.combat.damageEnemy(e, req);
  }
  const n = list.length;
  _targets.length = 0;
  if (n > 0) {
    ctx.audio.play('shock_zap', { position: top, volume: 0.65 });
  } else if (Math.random() < 0.55) {
    // 空放时的电弧噼啪
    const a = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 1.2;
    _b.set(top.x + Math.cos(a) * r, top.y - BEACON_TOP + 0.05, top.z + Math.sin(a) * r);
    ctx.fx.lightning(top, _b, SKILL_COLORS.shock);
  }
  return n;
}

function deployBeacon(ctx: GameContext, point: THREE.Vector3): void {
  const gy = groundYBelow(ctx, point);
  const center = new THREE.Vector3(point.x, gy, point.z);
  const top = new THREE.Vector3(center.x, gy + BEACON_TOP, center.z);
  const radius = BEACON_RADIUS * radiusScale(ctx);
  const view = buildBeacon();
  view.root.position.copy(center);
  view.area.scale.setScalar(radius);
  view.mast.scale.set(1, 0.01, 1);
  ctx.stageGroup.add(view.root);

  _a.set(center.x, gy + 0.06, center.z);
  ctx.fx.ring(_a, radius, SKILL_COLORS.shock, 0.5);
  ctx.fx.burst(top, SKILL_COLORS.shock, 22, 5, 0.5, 0.06, 2);
  ctx.audio.play('skill_shock', { position: center, volume: 0.9 });

  let t = 0;
  let next = 0.25;
  let pulse = 0;
  ctx.tasks.add((dt) => {
    // 已被清场（stageGroup.clear）则直接结束
    if (!view.root.parent) return true;
    t += dt;
    const open = Math.min(1, t / 0.22);
    view.mast.scale.set(1, 1 - Math.pow(1 - open, 3) + 0.01, 1);
    view.spin.rotation.y += dt * 5;
    view.spin.position.y = 0.88 + Math.sin(t * 6) * 0.05;
    pulse = Math.max(0, pulse - dt * 4);
    view.orb.scale.setScalar(1 + pulse * 0.9 + Math.sin(t * 20) * 0.05);
    view.area.scale.setScalar(radius * (1 + pulse * 0.025));
    if (t >= next && next <= BEACON_DURATION) {
      next += BEACON_INTERVAL;
      if (beaconZap(ctx, top, radius) > 0) pulse = 1;
      else pulse = Math.max(pulse, 0.35);
    }
    if (t >= BEACON_DURATION) {
      ctx.fx.burst(top, SKILL_COLORS.shock, 16, 3.5, 0.45, 0.05, 3);
      ctx.fx.burst(center, SKILL_COLORS.shockCore, 8, 2, 0.3, 0.04, 0);
      view.root.removeFromParent();
      return true;
    }
    return false;
  });
}

const stormBeacon: HeroSkillDef = {
  id: 'falcon_storm_beacon',
  name: '雷暴信标',
  description: `投出雷暴信标，落地后持续 ${BEACON_DURATION} 秒，每 ${BEACON_INTERVAL} 秒电击 ${BEACON_RADIUS} 米内最多 ${BEACON_TARGETS} 个敌人，造成 ${BEACON_DAMAGE} 点雷电伤害并必定附加雷殛（可叠层眩晕，但不会触发雷殛弹射）。2 次充能，每次充能 10 秒。`,
  cooldown: 10,
  charges: 2,
  activate(ctx) {
    if (!ctx.player.alive) return false;
    handOrigin(ctx, _pos);
    throwVelocity(ctx, 19, 3.5, _vel);
    ctx.projectiles.spawn({
      owner: 'player',
      position: _pos.clone(),
      velocity: _vel.clone(),
      gravity: 22,
      radius: 0.2,
      lifetime: BEACON_THROW_LIFETIME,
      element: 'shock',
      color: SKILL_COLORS.shock,
      visual: 'grenade',
      scale: 1,
      onImpact: (point) => deployBeacon(ctx, point),
    });
    ctx.audio.play('skill_throw', { volume: 0.9, pitch: 1.1 });
    return true;
  },
};

// ───────────────────────────── Q：鹰眼·裁决 ─────────────────────────────

let hawkLeft = 0;
let hawkSpark = 0;
let lastChainSound = -1;

const hawkSession = new EffectSession(() => {
  hawkLeft = 0;
});

/**
 * 武器造成的伤害：source 'weapon'。武器投射物的爆炸由 Combat.explode 结算，请求保持 source 'weapon'，
 * 只多一个 'explosion' 标签（tags 含 'explosion'），所以第一条判断已经覆盖它。
 * 第二条只是兼容旧约定「source 'explosion' + tag 'weapon'」，现行战斗模块不会再发出这种请求。
 */
function isWeaponHit(req: DamageRequest): boolean {
  if (req.source === 'weapon') return true;
  return req.source === 'explosion' && !!req.tags && req.tags.indexOf('weapon') >= 0;
}

function onHawkHit(ctx: GameContext, enemy: IEnemy, result: DamageResult): void {
  if (!hawkSession.active) return;
  const req = result.request;
  if (!isWeaponHit(req) || (req.procDepth ?? 0) > 0 || !(result.dealt > 0)) return;
  if (req.point) _a.copy(req.point);
  else enemy.getBodyCenter(_a);
  _exclude.clear();
  _exclude.add(enemy);
  const other = ctx.enemies.nearest(_a, HAWK_CHAIN_RANGE, _exclude);
  _exclude.clear();
  if (!other || !other.alive) return;
  other.getBodyCenter(_b);
  if (ctx.world.segmentBlocked(_a, _b)) return;
  ctx.fx.lightning(_a, _b, SKILL_COLORS.shock);
  const now = ctx.time.now;
  if (now - lastChainSound > 0.08) {
    lastChainSound = now;
    ctx.audio.play('shock_zap', { position: _b, volume: 0.45, pitch: 1.2 });
  }
  const point = _b.clone();
  const direction = _b.clone().sub(_a).normalize();
  ctx.combat.damageEnemy(other, {
    base: Math.max(6, result.dealt * HAWK_CHAIN_RATIO),
    element: 'shock',
    source: 'skill',
    elementChance: 0.25,
    canCrit: false,
    procDepth: 1,
    point,
    direction,
  });
}

const hawkVerdict: HeroSkillDef = {
  id: 'falcon_hawk_verdict',
  name: '鹰眼·裁决',
  description: `${HAWK_DURATION} 秒内射击不消耗弹匣、射速提高 ${Math.round(HAWK_FIRE_RATE * 100)}%，武器每次命中都会向 ${HAWK_CHAIN_RANGE} 米内另一名敌人弹射闪电，造成该次伤害 ${Math.round(HAWK_CHAIN_RATIO * 100)}% 的雷电伤害。冷却 25 秒。`,
  cooldown: 25,
  charges: 1,
  activate(ctx) {
    if (!ctx.player.alive) return false;
    hawkSession.begin(ctx);
    hawkLeft = HAWK_DURATION;
    hawkSpark = 0;

    const flags = ctx.run.flags;
    flags.infiniteAmmo = (flags.infiniteAmmo ?? 0) + 1;
    // 换关时 Game 会把 infiniteAmmo 归零；这里只减去自己加的那一份并钳制到 0
    hawkSession.track(() => {
      const f = ctx.run.flags;
      f.infiniteAmmo = Math.max(0, (f.infiniteAmmo ?? 0) - 1);
    });
    const stats = ctx.player.stats;
    stats.add('fireRatePct', HAWK_FIRE_RATE, HAWK_SOURCE);
    hawkSession.track(() => stats.removeSource(HAWK_SOURCE));
    hawkSession.track(ctx.events.on('enemy:damaged', (e) => onHawkHit(ctx, e.enemy, e.result)));

    const p = ctx.player;
    _a.set(p.position.x, p.position.y + 0.08, p.position.z);
    ctx.fx.ring(_a, 4, SKILL_COLORS.shock, 0.45);
    _a.y = p.position.y + 1.2;
    ctx.fx.burst(_a, SKILL_COLORS.shock, 30, 5, 0.55, 0.06, -1);
    // 天雷落在身前
    p.getForward(_vel);
    _pos.set(p.position.x + _vel.x * 2.2, p.position.y + 0.05, p.position.z + _vel.z * 2.2);
    _b.set(_pos.x, _pos.y + 11, _pos.z);
    ctx.fx.lightning(_b, _pos, SKILL_COLORS.shockCore);
    ctx.fx.burst(_pos, SKILL_COLORS.shock, 12, 3, 0.35, 0.05, 4);
    ctx.fx.shake(0.2, 0.2);
    ctx.audio.play('skill_buff', { volume: 0.8, pitch: 1.15 });
    ctx.audio.play('skill_shock', { volume: 0.7 });
    return true;
  },
  update(ctx, dt) {
    if (!hawkSession.active) return;
    hawkLeft -= dt;
    hawkSpark -= dt;
    if (hawkSpark <= 0 && ctx.player.alive) {
      hawkSpark = 0.28;
      handOrigin(ctx, _pos);
      ctx.fx.burst(_pos, SKILL_COLORS.shock, 3, 1.4, 0.25, 0.03, 0);
    }
    if (hawkLeft <= 0) {
      ctx.audio.play('skill_buff', { volume: 0.5, pitch: 0.7 });
      const p = ctx.player;
      _a.set(p.position.x, p.position.y + 1.1, p.position.z);
      ctx.fx.burst(_a, SKILL_COLORS.shock, 12, 2.5, 0.4, 0.05, 0);
      hawkSession.end();
    }
  },
  isActive: () => hawkSession.active,
  reset: () => hawkSession.end(),
};

// ───────────────────────────── 英雄 ─────────────────────────────

export const FALCON: HeroDef = {
  id: 'falcon',
  name: '雷隼',
  title: '天穹猎手',
  description:
    '云巅鹰巢最年轻的猎手，踏风而行、引雷为箭。二段跳与滑翔让她始终占据高处，赤铜左轮弹无虚发；抛下雷暴信标封锁敌群，开启鹰眼裁决时一枪连一雷，弹匣永不见底。',
  color: 0x6fd8ff,
  base: { maxHp: 90, maxShield: 70, extraJumps: 1 },
  startingWeapon: 'revolver',
  primary: hawkVerdict,
  secondary: stormBeacon,
  passive: {
    name: '凌空',
    description: `可在空中额外跳跃 1 次；身处空中时造成的伤害提高 ${Math.round(AIR_BONUS * 100)}%；下落时按住空格可展翼滑翔，大幅减缓下落。`,
    apply(ctx) {
      const off = ctx.combat.addOutgoingModifier((_enemy, req) =>
        !ctx.player.onGround && req.source !== 'status' ? 1 + AIR_BONUS : 1,
      );
      ctx.run.flags.glide = 1;
      return () => {
        off();
        ctx.run.flags.glide = 0;
      };
    },
  },
};
