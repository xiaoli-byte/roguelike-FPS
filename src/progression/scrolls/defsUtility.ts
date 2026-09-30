import * as THREE from 'three';
import type { ScrollDef } from '../../core/types';
import { bodyCenter, playerHpFrac, procScale, scroll } from './ScrollKit';

/** 秘卷：技能、生存（护盾 / 吸血 / 减伤 / 受伤触发）、机动、经济 */

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export const UTILITY_SCROLLS: ScrollDef[] = [
  // ───────────── 技能 ─────────────
  scroll({
    id: 'spirit_spring', name: '灵泉', rarity: 0, maxStacks: 5, tags: ['技能'],
    description: '技能急速每层 +8%。',
    setup: (s, n) => s.stat('skillHaste', 0.08 * n),
  }),
  scroll({
    id: 'arcane_surge', name: '法力涌动', rarity: 1, maxStacks: 4, tags: ['技能'],
    description: '技能伤害每层 +15%。',
    setup: (s, n) => s.stat('skillDamagePct', 0.15 * n),
  }),
  scroll({
    id: 'extra_charge', name: '多重储备', rarity: 3, maxStacks: 1, tags: ['技能'],
    description: '副技能（E）充能 +1。',
    setup: (s) => s.stat('secondaryCharges', 1),
  }),
  scroll({
    id: 'skill_echo', name: '回响', rarity: 1, maxStacks: 3, tags: ['技能', '触发'],
    description: '释放技能后 5 秒内，武器伤害每层 +10%。',
    setup: (s, n) => {
      const buff = s.buff([['damagePct', 0.1 * n]]);
      s.on('skill:used', () => buff.trigger(5));
    },
  }),
  scroll({
    id: 'soul_reap', name: '夺魂', rarity: 2, maxStacks: 3, tags: ['技能', '击杀'],
    description: '击杀敌人时，所有技能冷却每层减少 0.3 秒（精英与首领为 4 倍）。',
    setup: (s, n, ctx) => {
      s.on('enemy:killed', ({ enemy }) => {
        ctx.player.reduceCooldowns(0.3 * n * (enemy.isElite || enemy.isBoss ? 4 : 1), 'both');
      });
    },
  }),

  // ───────────── 生存 ─────────────
  scroll({
    id: 'iron_bones', name: '铁骨', rarity: 0, maxStacks: 5, tags: ['生存'],
    description: '生命上限每层 +12（获得时同时回复 12 生命）。',
    setup: (s, n, ctx) => {
      s.stat('maxHp', 12 * n);
      ctx.player.heal(12);
    },
  }),
  scroll({
    id: 'spirit_ward', name: '灵盾', rarity: 0, maxStacks: 5, tags: ['生存', '护盾'],
    description: '护盾上限每层 +10（获得时同时补充 10 护盾）。',
    setup: (s, n, ctx) => {
      s.stat('maxShield', 10 * n);
      ctx.player.addShield(10);
    },
  }),
  scroll({
    id: 'quick_recovery', name: '回春', rarity: 1, maxStacks: 3, tags: ['生存', '护盾'],
    description: '护盾恢复延迟每层 −0.4 秒，护盾恢复速度每层 +8/秒。',
    setup: (s, n) => {
      s.stat('shieldRegenDelay', -0.4 * n);
      s.stat('shieldRegenRate', 8 * n);
    },
  }),
  scroll({
    id: 'blood_drinker', name: '噬血', rarity: 2, maxStacks: 3, tags: ['生存', '吸血'],
    description: '吸血每层 +2%。',
    setup: (s, n) => s.stat('lifesteal', 0.02 * n),
  }),
  scroll({
    id: 'harvest', name: '收割', rarity: 1, maxStacks: 4, tags: ['生存', '击杀'],
    description: '击杀敌人时每层回复 3 生命。',
    setup: (s, n) => s.stat('killHeal', 3 * n),
  }),
  scroll({
    id: 'soul_siphon', name: '摄魂', rarity: 1, maxStacks: 4, tags: ['护盾', '击杀'],
    description: '击杀敌人时每层回复 4 护盾。',
    setup: (s, n) => s.stat('killShield', 4 * n),
  }),
  scroll({
    id: 'stone_skin', name: '石肤', rarity: 1, maxStacks: 3, tags: ['生存'],
    description: '伤害减免每层 +5%。',
    setup: (s, n) => s.stat('damageReduction', 0.05 * n),
  }),
  scroll({
    id: 'regen', name: '生生不息', rarity: 1, maxStacks: 3, tags: ['生存'],
    description: '每秒每层回复 1.5 生命。',
    setup: (s, n, ctx) => {
      s.every(1, () => {
        const p = ctx.player;
        if (p.alive && p.hp < p.maxHp()) p.heal(1.5 * n);
      });
    },
  }),
  scroll({
    id: 'last_stand', name: '背水一战', rarity: 2, maxStacks: 2, tags: ['生存'],
    description: '生命低于 35% 时，受到的伤害每层 −15%。',
    setup: (s, n, ctx) => s.incoming(() => (playerHpFrac(ctx) < 0.35 ? 1 - 0.15 * n : 1)),
  }),
  scroll({
    id: 'shield_nova', name: '碎盾反击', rarity: 2, maxStacks: 3, tags: ['护盾', '触发'],
    description: '护盾被击破时向 6 米内释放冲击波，造成每层 70 点伤害（随关卡强度成长）并击退，冷却 5 秒。',
    setup: (s, n, ctx) => {
      s.on('player:shieldBroken', () => {
        if (!ctx.player.alive || !s.ready('nova', 5)) return;
        _p.copy(ctx.player.position);
        _p.y += 0.9;
        ctx.combat.explode(_p, 6, {
          base: 70 * n * procScale(ctx), element: 'none', source: 'scroll', procDepth: 1, canCrit: false, knockback: 14,
        }, { color: 0x7fd8ff, noFx: true });
        _p.y = ctx.player.position.y + 0.1;
        ctx.fx.ring(_p, 6, 0x7fd8ff, 0.45);
        ctx.fx.shake(0.25, 0.2);
        ctx.audio.play('skill_earth', { volume: 0.7 });
      });
    },
  }),
  scroll({
    id: 'thorns', name: '以牙还牙', rarity: 1, maxStacks: 3, tags: ['生存', '受伤'],
    description: '受到敌人伤害时，对其造成每层 25 点伤害（随关卡强度成长），每 0.4 秒最多一次。',
    setup: (s, n, ctx) => {
      s.on('player:damaged', ({ source }) => {
        if (!source || !source.alive || !s.ready('thorns', 0.4)) return;
        const to = bodyCenter(source, _q);
        _p.copy(ctx.player.position);
        _p.y += 1.1;
        ctx.fx.beam(_p, to, 0xff5a4f, 0.05, 0.12);
        ctx.combat.damageEnemy(source, {
          base: 25 * n * procScale(ctx), element: 'none', source: 'scroll', procDepth: 1, canCrit: false, point: to.clone(),
        });
      });
    },
  }),
  scroll({
    id: 'pain_to_power', name: '化痛为力', rarity: 1, maxStacks: 3, tags: ['伤害', '受伤'],
    description: '受到伤害后 5 秒内，武器伤害每层 +10%。',
    setup: (s, n) => {
      const buff = s.buff([['damagePct', 0.1 * n]]);
      s.on('player:damaged', ({ amount }) => {
        if (amount > 0) buff.trigger(5);
      });
    },
  }),
  scroll({
    id: 'second_wind', name: '绝处逢生', rarity: 3, maxStacks: 1, tags: ['生存'],
    description: '每关一次：受到致命伤害时免除该次伤害，回复 35% 生命并获得 2 秒无敌。',
    setup: (s, _n, ctx) => {
      let used = false;
      s.on('stage:loaded', () => {
        used = false;
      });
      s.incoming((amount) => {
        const p = ctx.player;
        if (used || !p.alive || p.invulnerableTime > 0) return 1;
        // 粗略估计最终伤害（其它会放大伤害的秘卷也计入）
        const amp = ctx.scrolls.stacks('glass_cannon') > 0 ? 1.35 : 1;
        if (amount * amp < p.hp + p.shield) return 1;
        used = true;
        p.heal(p.maxHp() * 0.35);
        p.invulnerableTime = Math.max(p.invulnerableTime, 2);
        ctx.ui.toast('绝处逢生！', '#ffd54a');
        ctx.audio.play('skill_buff');
        _p.copy(p.position);
        _p.y += 1;
        ctx.fx.burst(_p, 0xffe28a, 30, 6, 0.7, 0.14, -3);
        return 0;
      });
    },
  }),
  scroll({
    id: 'phoenix_feather', name: '凤羽', rarity: 3, maxStacks: 2, tags: ['护盾', '击杀'],
    description: '击杀精英或首领时立即回满护盾，并在 6 秒内伤害减免每层 +10%。',
    setup: (s, n, ctx) => {
      const buff = s.buff([['damageReduction', 0.1 * n]]);
      s.on('enemy:killed', ({ enemy }) => {
        if (!enemy.isElite && !enemy.isBoss) return;
        ctx.player.addShield(ctx.player.maxShield());
        buff.trigger(6);
        ctx.audio.play('shield_recharge');
      });
    },
  }),

  // ───────────── 机动 ─────────────
  scroll({
    id: 'wind_walker', name: '踏风', rarity: 0, maxStacks: 3, tags: ['机动'],
    description: '移动速度每层 +0.4。',
    setup: (s, n) => s.stat('moveSpeed', 0.4 * n),
  }),
  scroll({
    id: 'cloud_step', name: '凌云', rarity: 2, maxStacks: 1, tags: ['机动'],
    description: '额外跳跃次数 +1。',
    setup: (s) => s.stat('extraJumps', 1),
  }),
  scroll({
    id: 'streamer', name: '流光', rarity: 2, maxStacks: 1, tags: ['机动'],
    description: '冲刺次数 +1。',
    setup: (s) => s.stat('dashCharges', 1),
  }),
  scroll({
    id: 'phantom_step', name: '幻影步', rarity: 1, maxStacks: 3, tags: ['机动', '触发'],
    description: '冲刺冷却每层 −0.2 秒；冲刺后 2 秒内武器伤害每层 +8%。',
    setup: (s, n) => {
      s.stat('dashCooldown', -0.2 * n);
      const buff = s.buff([['damagePct', 0.08 * n]]);
      s.on('player:dashed', () => buff.trigger(2));
    },
  }),
  scroll({
    id: 'high_ground', name: '居高临下', rarity: 1, maxStacks: 3, tags: ['机动', '伤害'],
    description: '滞空时伤害每层 +10%。',
    setup: (s, n, ctx) => s.outgoing(() => (ctx.player.onGround ? 1 : 1 + 0.1 * n)),
  }),
  scroll({
    id: 'war_drum', name: '战鼓', rarity: 3, maxStacks: 2, tags: ['射速', '机动'],
    description: '每波敌人来袭时，8 秒内射速每层 +15%、移动速度每层 +0.5。',
    setup: (s, n) => {
      const buff = s.buff([['fireRatePct', 0.15 * n], ['moveSpeed', 0.5 * n]]);
      s.on('wave:started', () => buff.trigger(8));
    },
  }),

  // ───────────── 经济 ─────────────
  scroll({
    id: 'golden_touch', name: '点金手', rarity: 0, maxStacks: 3, tags: ['经济'],
    description: '金币获取每层 +15%。',
    setup: (s, n) => s.stat('coinGainPct', 0.15 * n),
  }),
  scroll({
    id: 'spirit_lure', name: '灵引', rarity: 0, maxStacks: 2, tags: ['经济'],
    description: '拾取范围每层 +2 米。',
    setup: (s, n) => s.stat('pickupRadius', 2 * n),
  }),
  scroll({
    id: 'fortune_charm', name: '招财符', rarity: 1, maxStacks: 3, tags: ['经济'],
    description: '幸运每层 +1（更容易出现高稀有度的武器与秘卷）。',
    setup: (s, n) => s.stat('luck', n),
  }),
  scroll({
    id: 'bounty', name: '悬赏令', rarity: 1, maxStacks: 3, tags: ['经济', '击杀'],
    description: '击杀精英时每层额外掉落 12 金币，击杀首领时每层额外掉落 60 金币。',
    setup: (s, n, ctx) => {
      s.on('enemy:killed', ({ enemy }) => {
        const amount = enemy.isBoss ? 60 * n : enemy.isElite ? 12 * n : 0;
        if (amount > 0) ctx.loot.dropCoins(bodyCenter(enemy, _p), amount);
      });
    },
  }),
  scroll({
    id: 'treasure_bowl', name: '聚宝盆', rarity: 2, maxStacks: 2, tags: ['经济'],
    description: '每进入新关卡，获得当前金币 10% 的利息（每层上限 40，随章节提高）。',
    setup: (s, n, ctx) => {
      s.on('stage:loaded', ({ stage }) => {
        const cap = Math.round(40 * n * (1 + 0.35 * stage.chapter));
        const gain = Math.min(cap, Math.floor(ctx.run.coins * 0.1));
        if (gain <= 0) return;
        ctx.run.coins += gain;
        ctx.events.emit('coins:changed', { coins: ctx.run.coins, delta: gain });
        ctx.ui.toast(`聚宝盆：利息 +${gain} 金币`, '#ffd54a');
      });
    },
  }),
];
