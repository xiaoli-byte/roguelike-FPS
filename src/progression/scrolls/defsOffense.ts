import * as THREE from 'three';
import type { ScrollDef } from '../../core/types';
import { ELEMENT_COLORS } from '../../core/types';
import {
  bodyCenter, depthOf, enemyDistance, enemyHealthFrac, isDirectWeaponHit, procScale, scroll,
} from './ScrollKit';

/** 秘卷：通用伤害、暴击 / 爆头、射速 / 换弹 / 弹匣、爆炸 */

const _p = new THREE.Vector3();
const _sky = new THREE.Vector3();

export const OFFENSE_SCROLLS: ScrollDef[] = [
  // ───────────── 通用伤害 ─────────────
  scroll({
    id: 'keen_blade', name: '利刃', rarity: 0, maxStacks: 5, tags: ['伤害'],
    description: '武器伤害每层 +6%。',
    setup: (s, n) => s.stat('damagePct', 0.06 * n),
  }),
  scroll({
    id: 'giant_slayer', name: '屠巨', rarity: 1, maxStacks: 3, tags: ['伤害'],
    description: '对精英与首领的伤害每层 +12%。',
    setup: (s, n) => {
      s.stat('eliteDamagePct', 0.12 * n);
      s.stat('bossDamagePct', 0.12 * n);
    },
  }),
  scroll({
    id: 'shield_breaker', name: '破盾', rarity: 0, maxStacks: 3, tags: ['伤害'],
    description: '对护盾的伤害每层 +20%。',
    setup: (s, n) => s.stat('shieldDamagePct', 0.2 * n),
  }),
  scroll({
    id: 'armor_piercer', name: '穿甲', rarity: 0, maxStacks: 3, tags: ['伤害'],
    description: '对护甲的伤害每层 +20%。',
    setup: (s, n) => s.stat('armorDamagePct', 0.2 * n),
  }),
  scroll({
    id: 'first_blood', name: '先声夺人', rarity: 1, maxStacks: 3, tags: ['伤害'],
    description: '对耐久高于 90% 的敌人伤害每层 +20%。',
    setup: (s, n) => s.outgoing((e) => (enemyHealthFrac(e) > 0.9 ? 1 + 0.2 * n : 1)),
  }),
  scroll({
    id: 'executioner', name: '断命', rarity: 2, maxStacks: 3, tags: ['伤害'],
    description: '对耐久低于 35% 的敌人伤害每层 +18%。',
    setup: (s, n) => s.outgoing((e) => (enemyHealthFrac(e) < 0.35 ? 1 + 0.18 * n : 1)),
  }),
  scroll({
    id: 'close_combat', name: '近身搏杀', rarity: 0, maxStacks: 3, tags: ['伤害'],
    description: '对 7 米内的敌人伤害每层 +10%。',
    setup: (s, n, ctx) => s.outgoing((e) => (enemyDistance(ctx, e) < 7 ? 1 + 0.1 * n : 1)),
  }),
  scroll({
    id: 'sharpshooter', name: '百步穿杨', rarity: 1, maxStacks: 3, tags: ['伤害'],
    description: '对 18 米外的敌人伤害每层 +15%。',
    setup: (s, n, ctx) => s.outgoing((e) => (enemyDistance(ctx, e) > 18 ? 1 + 0.15 * n : 1)),
  }),

  // ───────────── 暴击 / 爆头 ─────────────
  scroll({
    id: 'hawk_eye', name: '鹰目', rarity: 0, maxStacks: 5, tags: ['暴击'],
    description: '暴击率每层 +4%。',
    setup: (s, n) => s.stat('critChance', 0.04 * n),
  }),
  scroll({
    id: 'fatal_art', name: '致命诀', rarity: 1, maxStacks: 4, tags: ['暴击'],
    description: '暴击伤害每层 +15%。',
    setup: (s, n) => s.stat('critDamagePct', 0.15 * n),
  }),
  scroll({
    id: 'headsman', name: '断首', rarity: 2, maxStacks: 3, tags: ['暴击', '护盾'],
    description: '爆头伤害每层 +15%；爆头击杀时每层回复 4 护盾。',
    setup: (s, n, ctx) => {
      s.outgoing((_e, req) => (req.headshot ? 1 + 0.15 * n : 1));
      s.on('enemy:killed', ({ result }) => {
        if (result.request.headshot && result.request.source === 'weapon') ctx.player.addShield(4 * n);
      });
    },
  }),
  scroll({
    id: 'crit_streak', name: '连击心法', rarity: 2, maxStacks: 3, tags: ['暴击', '触发'],
    description: '武器暴击后 3 秒内，暴击率每层 +5%。',
    setup: (s, n) => {
      const buff = s.buff([['critChance', 0.05 * n]]);
      s.on('enemy:damaged', ({ result }) => {
        if (result.isCrit && isDirectWeaponHit(result)) buff.trigger(3);
      });
    },
  }),

  // ───────────── 射速 / 换弹 / 弹匣 ─────────────
  scroll({
    id: 'rapid_fire', name: '骤雨', rarity: 1, maxStacks: 4, tags: ['射速'],
    description: '射速每层 +7%。',
    setup: (s, n) => s.stat('fireRatePct', 0.07 * n),
  }),
  scroll({
    id: 'swift_hands', name: '疾手', rarity: 0, maxStacks: 5, tags: ['换弹'],
    description: '换弹速度每层 +10%。',
    setup: (s, n) => s.stat('reloadSpeedPct', 0.1 * n),
  }),
  scroll({
    id: 'bottomless', name: '百宝囊', rarity: 0, maxStacks: 3, tags: ['弹匣'],
    description: '弹匣容量每层 +10%，备弹上限每层 +20%。',
    setup: (s, n) => {
      s.stat('magSizePct', 0.1 * n);
      s.stat('ammoReservePct', 0.2 * n);
    },
  }),
  scroll({
    id: 'steady', name: '稳如磐石', rarity: 0, maxStacks: 3, tags: ['精准'],
    description: '散布每层 −12%，后坐力每层 −15%。',
    setup: (s, n) => {
      s.stat('spreadPct', -0.12 * n);
      s.stat('recoilPct', -0.15 * n);
    },
  }),
  scroll({
    id: 'meteor_shot', name: '流星', rarity: 0, maxStacks: 3, tags: ['弹速'],
    description: '弹速每层 +20%，武器伤害每层 +3%。',
    setup: (s, n) => {
      s.stat('projectileSpeedPct', 0.2 * n);
      s.stat('damagePct', 0.03 * n);
    },
  }),
  scroll({
    id: 'last_rounds', name: '背水弹匣', rarity: 1, maxStacks: 3, tags: ['弹匣', '伤害'],
    description: '弹匣余量低于 30% 时，武器伤害每层 +15%。',
    setup: (s, n, ctx) => s.outgoing((_e, req) => {
      if (req.source !== 'weapon') return 1;
      const w = ctx.weapons.active;
      if (!w) return 1;
      const cap = ctx.weapons.magCapacity(w);
      return cap > 0 && w.mag <= cap * 0.3 ? 1 + 0.15 * n : 1;
    }),
  }),
  scroll({
    id: 'reload_rush', name: '装填激励', rarity: 1, maxStacks: 3, tags: ['换弹', '触发'],
    description: '换弹完成后 4 秒内，射速每层 +12%。',
    setup: (s, n) => {
      const buff = s.buff([['fireRatePct', 0.12 * n]]);
      s.on('weapon:reloaded', () => buff.trigger(4));
    },
  }),
  scroll({
    id: 'reload_nova', name: '换弹冲击', rarity: 2, maxStacks: 3, tags: ['换弹', '触发'],
    description: '开始换弹时向 5 米内释放冲击波，造成每层 35 点伤害（随关卡强度成长）并击退，冷却 2 秒。',
    setup: (s, n, ctx) => {
      s.on('weapon:reloadStart', () => {
        if (!ctx.player.alive || !s.ready('nova', 2)) return;
        _p.copy(ctx.player.position);
        _p.y += 0.9;
        ctx.combat.explode(_p, 5, {
          base: 35 * n * procScale(ctx), element: 'none', source: 'scroll', procDepth: 1, canCrit: false, knockback: 9,
        }, { color: 0xbfe6ff, noFx: true });
        _p.y = ctx.player.position.y + 0.1;
        ctx.fx.ring(_p, 5, 0xbfe6ff, 0.35);
        ctx.audio.play('skill_earth', { volume: 0.5 });
      });
    },
  }),

  // ───────────── 爆炸 ─────────────
  scroll({
    id: 'blast_master', name: '爆破专家', rarity: 0, maxStacks: 4, tags: ['爆炸'],
    description: '爆炸范围每层 +10%，爆炸伤害每层 +12%。',
    setup: (s, n) => {
      s.stat('explosionRadiusPct', 0.1 * n);
      s.stat('explosionDamagePct', 0.12 * n);
    },
  }),
  scroll({
    id: 'chain_blast', name: '连环爆', rarity: 2, maxStacks: 3, tags: ['爆炸', '击杀'],
    description: '击杀敌人时每层 10% 概率引爆尸体，对 3.5 米内造成其最大生命 30% 的伤害。',
    setup: (s, n, ctx) => {
      s.on('enemy:killed', ({ enemy, result }) => {
        const depth = depthOf(result.request);
        if (depth >= 2 || enemy.isBoss || !ctx.rng.chance(0.1 * n)) return;
        const c = bodyCenter(enemy, _p);
        ctx.combat.explode(c, 3.5, {
          base: enemy.maxHp * 0.3, element: 'none', source: 'explosion', procDepth: depth + 1, canCrit: false, knockback: 6,
        }, { color: 0xffa040 });
      });
    },
  }),
  scroll({
    id: 'volatile_rounds', name: '爆裂弹', rarity: 3, maxStacks: 2, tags: ['爆炸', '暴击', '命中'],
    description: '武器暴击时在命中点引发 2.2 米爆炸，造成该次伤害每层 30% 的伤害。',
    setup: (s, n, ctx) => {
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!result.isCrit || !isDirectWeaponHit(result) || result.dealt <= 0) return;
        if (!s.ready('boom', 0.12)) return;
        const c = result.request.point ? _p.copy(result.request.point) : bodyCenter(enemy, _p);
        ctx.combat.explode(c, 2.2, {
          base: result.dealt * 0.3 * n, element: result.element, source: 'explosion', procDepth: 1, canCrit: false,
        }, { color: 0xffb347 });
      });
    },
  }),
  scroll({
    id: 'thunder_judgment', name: '天雷引', rarity: 3, maxStacks: 3, tags: ['雷殛', '命中'],
    description: '武器每命中 15 次，下一次命中召唤天雷，对目标周围 3 米造成每层 45 点雷电伤害（随关卡强度成长），必定附着雷殛。',
    setup: (s, n, ctx) => {
      let hits = 0;
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!isDirectWeaponHit(result)) return;
        if (++hits <= 15) return;
        hits = 0;
        const c = bodyCenter(enemy, _p);
        _sky.set(c.x + (Math.random() - 0.5) * 2, c.y + 14, c.z + (Math.random() - 0.5) * 2);
        ctx.fx.lightning(_sky, c, ELEMENT_COLORS.shock);
        ctx.combat.explode(c, 3, {
          base: 45 * n * procScale(ctx), element: 'shock', elementChance: 1, source: 'scroll', procDepth: 1, canCrit: false,
        }, { color: ELEMENT_COLORS.shock });
        ctx.audio.play('shock_zap', { position: c });
        ctx.fx.shake(0.15, 0.15);
      });
    },
  }),
];
