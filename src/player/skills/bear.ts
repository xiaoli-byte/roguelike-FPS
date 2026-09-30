/**
 * 岩熊 · 镇山守卫：裂地重击（E）、磐石壁垒（Q）、厚皮（被动）。
 */
import * as THREE from 'three';
import type { GameContext, HeroDef } from '../../core/types';
import { EffectSession, type HeroSkillDef, SKILL_COLORS, radiusScale, shockwave } from './common';

// ───────────────────────────── 数值 ─────────────────────────────

const SLAM_RADIUS = 6;
const SLAM_DAMAGE = 150;
const SLAM_STUN = 1.2;
const SLAM_KNOCKBACK = 15;
const SLAM_LIFT = 7;
const LEAP_FORWARD = 8;
const LEAP_UP = 7;
const SLAM_DOWN_SPEED = 22;
/** 下落段额外重力，让砸地更有分量 */
const SLAM_EXTRA_GRAVITY = 20;

const BASTION_DURATION = 8;
const BASTION_REDUCTION = 0.5;
const BASTION_DAMAGE_PCT = 0.25;
const BASTION_WAVE_RADIUS = 7;
const BASTION_WAVE_DAMAGE = 100;
const BASTION_SOURCE = 'skill:bear_q';

const PASSIVE_SOURCE = 'passive:bear';
const HIDE_REGEN_DELAY = -1;
const HIDE_WAVE_RADIUS = 6;
const HIDE_WAVE_DAMAGE = 60;
const HIDE_WAVE_ICD = 8;

const _f = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _c = new THREE.Vector3();

// ───────────────────────────── E：裂地重击 ─────────────────────────────

let leaping = false;
let leapT = 0;

const slamSession = new EffectSession(() => {
  leaping = false;
});

function slam(ctx: GameContext): void {
  const p = ctx.player;
  _c.copy(p.position);
  shockwave(ctx, _c, {
    radius: SLAM_RADIUS * radiusScale(ctx),
    base: SLAM_DAMAGE,
    element: 'none',
    knockback: SLAM_KNOCKBACK,
    lift: SLAM_LIFT,
    stun: SLAM_STUN,
    falloff: 0.35,
    color: SKILL_COLORS.earth,
    secondaryColor: SKILL_COLORS.gold,
    crack: true,
  });
  ctx.fx.shake(0.8, 0.35);
  ctx.audio.play('skill_earth', { volume: 1 });
  ctx.audio.play('explosion', { volume: 0.5, pitch: 0.6 });
}

const earthSplitter: HeroSkillDef = {
  id: 'bear_earth_splitter',
  name: '裂地重击',
  description: `向前跃起后重砸地面，对 ${SLAM_RADIUS} 米内敌人造成 ${SLAM_DAMAGE} 点伤害、强力击退并眩晕 ${SLAM_STUN} 秒；在空中释放则立即向下猛砸。2 次充能，每次充能 9 秒。`,
  cooldown: 9,
  charges: 2,
  activate(ctx) {
    const p = ctx.player;
    if (leaping || !p.alive) return false;
    slamSession.begin(ctx);
    leaping = true;
    leapT = 0;
    if (p.onGround) {
      p.getForward(_f);
      p.velocity.x = _f.x * LEAP_FORWARD;
      p.velocity.z = _f.z * LEAP_FORWARD;
      _imp.set(0, LEAP_UP - p.velocity.y, 0);
      p.applyImpulse(_imp);
      ctx.audio.play('jump', { volume: 0.8, pitch: 0.75 });
    } else {
      p.velocity.x *= 0.4;
      p.velocity.z *= 0.4;
      _imp.set(0, -SLAM_DOWN_SPEED - p.velocity.y, 0);
      p.applyImpulse(_imp);
    }
    ctx.audio.play('dash', { volume: 0.7, pitch: 0.65 });
    return true;
  },
  update(ctx, dt) {
    if (!leaping) return;
    const p = ctx.player;
    if (!p.alive) {
      slamSession.end();
      return;
    }
    leapT += dt;
    if (p.velocity.y < 0) p.velocity.y -= SLAM_EXTRA_GRAVITY * dt;
    if ((leapT > 0.12 && p.onGround) || leapT > 1.8) {
      slam(ctx);
      slamSession.end();
    }
  },
  isActive: () => leaping,
  reset: () => slamSession.end(),
};

// ───────────────────────────── Q：磐石壁垒 ─────────────────────────────

let runeGeoOuter: THREE.RingGeometry | null = null;
let runeGeoInner: THREE.RingGeometry | null = null;
let runeGeoCore: THREE.RingGeometry | null = null;
let runeMat: THREE.MeshBasicMaterial | null = null;
let rune: THREE.Group | null = null;
let runeOuter: THREE.Object3D | null = null;
let runeInner: THREE.Object3D | null = null;

/** 脚下旋转的金色符阵（模块级复用） */
function getRune(): THREE.Group {
  if (rune) return rune;
  runeGeoOuter = new THREE.RingGeometry(1.15, 1.3, 48).rotateX(-Math.PI / 2);
  runeGeoInner = new THREE.RingGeometry(0.72, 0.8, 6).rotateX(-Math.PI / 2);
  runeGeoCore = new THREE.RingGeometry(0.35, 0.4, 3).rotateX(-Math.PI / 2);
  runeMat = new THREE.MeshBasicMaterial({
    color: SKILL_COLORS.gold, transparent: true, opacity: 0.7, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  rune = new THREE.Group();
  rune.name = 'bastionRune';
  runeOuter = new THREE.Mesh(runeGeoOuter, runeMat);
  runeInner = new THREE.Mesh(runeGeoInner, runeMat);
  const core = new THREE.Mesh(runeGeoCore, runeMat);
  runeOuter.renderOrder = runeInner.renderOrder = core.renderOrder = 2;
  rune.add(runeOuter, runeInner, core);
  return rune;
}

let bastionLeft = 0;
let bastionT = 0;
let bastionFx = 0;

const bastionSession = new EffectSession(() => {
  bastionLeft = 0;
  rune?.removeFromParent();
});

function bastionBurst(ctx: GameContext): void {
  const p = ctx.player;
  _c.copy(p.position);
  shockwave(ctx, _c, {
    radius: BASTION_WAVE_RADIUS * radiusScale(ctx),
    base: BASTION_WAVE_DAMAGE,
    element: 'none',
    knockback: 13,
    lift: 5,
    falloff: 0.4,
    color: SKILL_COLORS.gold,
    secondaryColor: SKILL_COLORS.earth,
    crack: true,
  });
  ctx.fx.shake(0.5, 0.3);
  ctx.audio.play('skill_earth', { volume: 0.9, pitch: 1.1 });
}

const bastion: HeroSkillDef = {
  id: 'bear_bastion',
  name: '磐石壁垒',
  description: `立即回满护盾，${BASTION_DURATION} 秒内受到的伤害降低 ${Math.round(BASTION_REDUCTION * 100)}%、武器伤害提高 ${Math.round(BASTION_DAMAGE_PCT * 100)}%；结束时释放冲击波，对 ${BASTION_WAVE_RADIUS} 米内敌人造成 ${BASTION_WAVE_DAMAGE} 点伤害并击退。冷却 22 秒。`,
  cooldown: 22,
  charges: 1,
  activate(ctx) {
    const p = ctx.player;
    if (!p.alive) return false;
    bastionSession.begin(ctx);
    bastionLeft = BASTION_DURATION;
    bastionT = 0;
    bastionFx = 0;
    bastionSession.track(ctx.combat.addIncomingModifier(() => 1 - BASTION_REDUCTION));
    const stats = p.stats;
    stats.add('damagePct', BASTION_DAMAGE_PCT, BASTION_SOURCE);
    bastionSession.track(() => stats.removeSource(BASTION_SOURCE));
    p.addShield(p.maxShield());

    const r = getRune();
    r.position.set(p.position.x, p.position.y + 0.05, p.position.z);
    r.scale.setScalar(0.2);
    ctx.stageGroup.add(r);

    _c.set(p.position.x, p.position.y + 0.08, p.position.z);
    ctx.fx.ring(_c, 5, SKILL_COLORS.gold, 0.5);
    _c.y = p.position.y + 1;
    ctx.fx.burst(_c, SKILL_COLORS.gold, 32, 4.5, 0.6, 0.08, -2);
    ctx.fx.shake(0.3, 0.25);
    ctx.audio.play('skill_buff', { volume: 0.9, pitch: 0.85 });
    ctx.audio.play('skill_earth', { volume: 0.6, pitch: 1.3 });
    return true;
  },
  update(ctx, dt) {
    if (!bastionSession.active) return;
    const p = ctx.player;
    if (!p.alive) {
      bastionSession.end();
      return;
    }
    bastionLeft -= dt;
    bastionT += dt;
    const r = getRune();
    if (!r.parent) ctx.stageGroup.add(r);
    r.position.set(p.position.x, p.position.y + 0.05, p.position.z);
    const open = Math.min(1, bastionT / 0.3);
    // 最后 1 秒闪烁提示即将结束
    const blink = bastionLeft < 1 ? 0.75 + 0.25 * Math.sin(bastionT * 30) : 1;
    r.scale.setScalar((0.2 + 0.8 * (1 - Math.pow(1 - open, 3))) * (1 + 0.03 * Math.sin(bastionT * 6)) * blink);
    if (runeOuter) runeOuter.rotation.y += dt * 0.9;
    if (runeInner) runeInner.rotation.y -= dt * 1.6;

    bastionFx -= dt;
    if (bastionFx <= 0) {
      bastionFx = 0.4;
      const a = Math.random() * Math.PI * 2;
      _c.set(p.position.x + Math.cos(a) * 0.9, p.position.y + 0.3, p.position.z + Math.sin(a) * 0.9);
      ctx.fx.burst(_c, SKILL_COLORS.gold, 5, 1.2, 0.6, 0.05, -3);
    }

    if (bastionLeft <= 0) {
      bastionBurst(ctx);
      bastionSession.end();
    }
  },
  isActive: () => bastionSession.active,
  reset: () => bastionSession.end(),
};

// ───────────────────────────── 英雄 ─────────────────────────────

export const BEAR: HeroDef = {
  id: 'bear',
  name: '岩熊',
  title: '镇山守卫',
  description:
    '镇守霜雪古寺山门百年的岩熊武僧，皮糙肉厚、力可裂地。生命与护盾冠绝众人，并天生减免 10% 伤害；扛着碎岩霰弹冲进人堆，一记裂地重击把敌人震上半空，是最让人安心的前排。',
  color: 0xc9a36b,
  base: { maxHp: 140, maxShield: 80, moveSpeed: 7.0, damageReduction: 0.1 },
  startingWeapon: 'shotgun',
  primary: bastion,
  secondary: earthSplitter,
  passive: {
    name: '厚皮',
    description: `护盾恢复延迟缩短 ${Math.abs(HIDE_REGEN_DELAY)} 秒；护盾被击破时释放震地冲击波，对 ${HIDE_WAVE_RADIUS} 米内敌人造成 ${HIDE_WAVE_DAMAGE} 点伤害并将其击退（内置冷却 ${HIDE_WAVE_ICD} 秒）。`,
    apply(ctx) {
      const stats = ctx.player.stats;
      stats.add('shieldRegenDelay', HIDE_REGEN_DELAY, PASSIVE_SOURCE);
      let lastWave = -Infinity;
      let cancelPending: (() => void) | null = null;
      const off = ctx.events.on('player:shieldBroken', () => {
        const now = ctx.time.now;
        if (now - lastWave < HIDE_WAVE_ICD || !ctx.player.alive) return;
        lastWave = now;
        // 推迟到本帧任务阶段执行，避免在敌人攻击结算途中重入战斗系统
        cancelPending = ctx.tasks.delay(0, () => {
          cancelPending = null;
          const p = ctx.player;
          if (!p.alive) return;
          _c.copy(p.position);
          shockwave(ctx, _c, {
            radius: HIDE_WAVE_RADIUS * radiusScale(ctx),
            base: HIDE_WAVE_DAMAGE,
            element: 'none',
            knockback: 16,
            lift: 6,
            falloff: 0.4,
            color: SKILL_COLORS.earth,
            secondaryColor: SKILL_COLORS.gold,
            crack: true,
          });
          ctx.fx.shake(0.4, 0.25);
          ctx.audio.play('skill_earth', { volume: 0.85, pitch: 0.9 });
        });
      });
      return () => {
        off();
        cancelPending?.();
        cancelPending = null;
        stats.removeSource(PASSIVE_SOURCE);
      };
    },
  },
};
