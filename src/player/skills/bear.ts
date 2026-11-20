/**
 * 岩熊 · 镇山守卫：裂地重击（E）、磐石壁垒（Q）、厚皮（被动）。
 */
import * as THREE from 'three';
import type { GameContext, HeroDef } from '../../core/types';
import { EffectSession, type HeroSkillDef, SKILL_COLORS, cancelDash, radiusScale, shockwave } from './common';
import { fxExtras } from '../../fx/extras';

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
/** 伤害边缘比例、地面起跳要先离地多久才算落地、兜底时长、空中释放保留的水平速度（Unity BearEarthSplitter） */
const SLAM_FALLOFF = 0.35;
const SLAM_MIN_AIR = 0.12;
const SLAM_MAX_LEAP = 1.8;
const SLAM_AIR_KEEP = 0.4;
/** 脚下这么近有地面且几乎没有竖直速度（−2…0.5 m/s），就按地面起跳（贴着敌人站、下台阶的那一帧没踩实地） */
const SLAM_GROUND_SNAP = 0.35;

const BASTION_DURATION = 8;
const BASTION_REDUCTION = 0.5;
const BASTION_DAMAGE_PCT = 0.25;
const BASTION_WAVE_RADIUS = 7;
const BASTION_WAVE_DAMAGE = 100;
const BASTION_WAVE_KNOCKBACK = 13;
const BASTION_WAVE_LIFT = 5;
const BASTION_WAVE_FALLOFF = 0.4;
/** 挡弹罩（Unity 加强）：胸口为心（脚底上方 1 m）、半径 1.6 m 的球罩，从外面飞来的敌方投射物撞上即碎 */
const BASTION_WARD_RADIUS = 1.6;
const BASTION_WARD_HEIGHT = 1;
const BASTION_SOURCE = 'skill:bear_q';

const PASSIVE_SOURCE = 'passive:bear';
const HIDE_REGEN_DELAY = -1;
const HIDE_WAVE_RADIUS = 6;
const HIDE_WAVE_DAMAGE = 60;
const HIDE_WAVE_ICD = 8;
const HIDE_WAVE_KNOCKBACK = 16;
const HIDE_WAVE_LIFT = 6;

/** 数值表（对照测试读） */
export const BEAR_TUNING = {
  SLAM_RADIUS, SLAM_DAMAGE, SLAM_STUN, SLAM_KNOCKBACK, SLAM_LIFT, SLAM_FALLOFF, LEAP_FORWARD, LEAP_UP, SLAM_DOWN_SPEED, SLAM_EXTRA_GRAVITY,
  SLAM_MIN_AIR, SLAM_MAX_LEAP, SLAM_AIR_KEEP, SLAM_GROUND_SNAP,
  BASTION_DURATION, BASTION_REDUCTION, BASTION_DAMAGE_PCT, BASTION_WAVE_RADIUS, BASTION_WAVE_DAMAGE, BASTION_WAVE_KNOCKBACK, BASTION_WAVE_LIFT,
  BASTION_WAVE_FALLOFF, BASTION_WARD_RADIUS, BASTION_WARD_HEIGHT,
  HIDE_REGEN_DELAY, HIDE_WAVE_RADIUS, HIDE_WAVE_DAMAGE, HIDE_WAVE_ICD, HIDE_WAVE_KNOCKBACK, HIDE_WAVE_LIFT,
} as const;

/**
 * 裂地重击按地面起跳（Unity BearEarthSplitter.OnGround）：踩着地面，或者脚下 0.35 m 内就是地面、竖直速度在 −2…0.5 m/s
 * （被敌人胶囊顶起一点、下台阶的那一帧）。真正从空中落下时竖直速度早就低于 −2，照旧立即下砸
 */
export function slamFromGround(onGround: boolean, vy: number, groundGap: number): boolean {
  if (onGround) return true;
  if (vy > 0.5 || vy < -2) return false;
  return groundGap >= 0 && groundGap <= SLAM_GROUND_SNAP;
}

const _f = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _c = new THREE.Vector3();

// ───────────────────────────── E：裂地重击 ─────────────────────────────

let leaping = false;
let leapT = 0;
/** 在空中释放：一落地立即砸（地面起跳则要求离地一小段时间，防止起跳当帧误判落地） */
let slamFromAir = false;

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
    falloff: SLAM_FALLOFF,
    color: SKILL_COLORS.earth,
    secondaryColor: SKILL_COLORS.gold,
    crack: true,
  });
  // 分层（docs/art/fx-style.md 第五节）：碎石往外崩、慢半拍一圈尘团和符点；落点烙一枚四方印，1.4 秒暗下去
  const extras = fxExtras(ctx);
  if (extras) {
    const r = SLAM_RADIUS * radiusScale(ctx);
    extras.earthBurst(_c, SKILL_COLORS.gold, r);
    _c.y += 0.08;
    extras.seal(_c, null, r * 0.55, SKILL_COLORS.earth, { write: 0.12, hold: 0.3, fade: 1.4, sides: 4, spin: 0.2, gain: 0.8 });
    _c.y -= 0.08;
  }
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
    // 冲刺会每帧覆盖速度，不先打断的话起跳 / 下砸会被吞掉（原地 0.12 秒后直接砸地）
    cancelDash(ctx);
    slamSession.begin(ctx);
    leaping = true;
    leapT = 0;
    // 跃起期间锁冲刺（Unity MotorLock.Dash：冲刺会托住下落、吞掉砸地），结束 / 被打断时解锁
    const lock = (p as unknown as { lockDash?: () => () => void }).lockDash;
    if (typeof lock === 'function') slamSession.track(lock.call(p));
    const gy = ctx.world.groundHeight(p.position.x, p.position.z, p.position.y + 0.1);
    const grounded = slamFromGround(p.onGround, p.velocity.y, gy > -Infinity ? p.position.y - gy : -1);
    slamFromAir = !grounded;
    if (grounded) {
      p.getForward(_f);
      p.velocity.x = _f.x * LEAP_FORWARD;
      p.velocity.z = _f.z * LEAP_FORWARD;
      _imp.set(0, LEAP_UP - p.velocity.y, 0);
      p.applyImpulse(_imp);
      ctx.audio.play('jump', { volume: 0.8, pitch: 0.75 });
    } else {
      p.velocity.x *= SLAM_AIR_KEEP;
      p.velocity.z *= SLAM_AIR_KEEP;
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
    const minAir = slamFromAir ? 0 : SLAM_MIN_AIR;
    if ((leapT > minAir && p.onGround) || leapT > SLAM_MAX_LEAP) {
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
/** 本次磐石壁垒挡下了几发（调试 / 测试读） */
export let bastionBlocked = 0;
const wardCenter = new THREE.Vector3();
const WARD_UP = new THREE.Vector3(0, 1, 0);
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
    knockback: BASTION_WAVE_KNOCKBACK,
    lift: BASTION_WAVE_LIFT,
    falloff: BASTION_WAVE_FALLOFF,
    color: SKILL_COLORS.gold,
    secondaryColor: SKILL_COLORS.earth,
    crack: true,
  });
  fxExtras(ctx)?.earthBurst(_c, SKILL_COLORS.gold, BASTION_WAVE_RADIUS * radiusScale(ctx));
  ctx.fx.shake(0.5, 0.3);
  ctx.audio.play('skill_earth', { volume: 0.9, pitch: 1.1 });
}

const bastion: HeroSkillDef = {
  id: 'bear_bastion',
  name: '磐石壁垒',
  description: `立即回满护盾，${BASTION_DURATION} 秒内受到的伤害降低 ${Math.round(BASTION_REDUCTION * 100)}%、武器伤害提高 ${Math.round(BASTION_DAMAGE_PCT * 100)}%，并挡下飞来的敌方投射物；结束时释放冲击波，对 ${BASTION_WAVE_RADIUS} 米内敌人造成 ${BASTION_WAVE_DAMAGE} 点伤害并击退。冷却 22 秒。`,
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
    // 挡弹罩（Unity 加强：「站桩扛首领大招」落到实处）：胸口为心的球罩随行，从外面飞来的敌方投射物撞上即碎（爆炸弹在罩面引爆）
    bastionBlocked = 0;
    wardCenter.set(p.position.x, p.position.y + BASTION_WARD_HEIGHT, p.position.z);
    const addWard = ctx.projectiles.addWard;
    if (typeof addWard === 'function') {
      bastionSession.track(addWard.call(ctx.projectiles, {
        center: wardCenter, normal: WARD_UP, radius: BASTION_WARD_RADIUS, shape: 'sphere',
        onBlock: (point) => {
          bastionBlocked++;
          _c.copy(point);
          ctx.fx.burst(_c, SKILL_COLORS.gold, 8, 2.5, 0.3, 0.05, 0);
          ctx.audio.play('hit_armor', { position: _c, volume: 0.6, pitch: 1.2 });
        },
      }));
    }

    const r = getRune();
    r.position.set(p.position.x, p.position.y + 0.05, p.position.z);
    r.scale.setScalar(0.2);
    ctx.stageGroup.add(r);

    _c.set(p.position.x, p.position.y + 0.08, p.position.z);
    ctx.fx.ring(_c, 5, SKILL_COLORS.gold, 0.5);
    _c.y = p.position.y + 1;
    ctx.fx.burst(_c, SKILL_COLORS.gold, 18, 4.5, 0.6, 0.08, -2);
    // 蓄：四周的金色光点盘旋着向身上收拢（脚下已有自己的符环，不再叠法印）
    fxExtras(ctx)?.gather(p.position, SKILL_COLORS.gold, 18, 3, p.position, 1);
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
    wardCenter.set(p.position.x, p.position.y + BASTION_WARD_HEIGHT, p.position.z);
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
  name: '磐',
  title: '工匠武僧',
  description:
    '修了一辈子山门石阶的穿山甲武僧，慢吞吞、推不动，一身鳞甲就是最好的盾。生命与护盾冠绝众人，并天生减免 10% 伤害；扛着钻炮霰弹走进人堆，一拳裂地把敌人震上半空，是队伍里那座山。',
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
            knockback: HIDE_WAVE_KNOCKBACK,
            lift: HIDE_WAVE_LIFT,
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
