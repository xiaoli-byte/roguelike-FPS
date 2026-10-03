import * as THREE from 'three';
import type { ScrollDef } from '../../core/types';
import { bodyCenter, isDirectWeaponHit, playerHpFrac, scroll } from './ScrollKit';

/** 秘卷：传说（高风险高回报）与英雄专属 */

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

export const LEGEND_SCROLLS: ScrollDef[] = [
  scroll({
    id: 'glass_cannon', name: '玉碎', rarity: 4, maxStacks: 1, tags: ['传说', '伤害', '风险'],
    description: '武器伤害 +55%，但受到的伤害 +35%。',
    setup: (s) => {
      s.stat('damagePct', 0.55);
      s.incoming(() => 1.35);
    },
  }),
  scroll({
    id: 'berserk_blood', name: '狂血', rarity: 4, maxStacks: 1, tags: ['传说', '伤害', '风险'],
    description: '每损失 1% 生命，伤害 +0.7%（最多 +63%）；但护盾恢复延迟 +2 秒。',
    setup: (s, _n, ctx) => {
      s.stat('shieldRegenDelay', 2);
      s.outgoing(() => 1 + Math.min(0.63, (1 - playerHpFrac(ctx)) * 0.7));
    },
  }),
  scroll({
    id: 'gambler', name: '赌徒之心', rarity: 4, maxStacks: 1, tags: ['传说', '暴击', '风险'],
    description: '暴击率 +25%，暴击伤害 +50%；但武器的非暴击伤害 −30%。',
    setup: (s) => {
      s.stat('critChance', 0.25);
      s.stat('critDamagePct', 0.5);
      s.outgoing((_e, req, isCrit) => (req.source === 'weapon' && !isCrit ? 0.7 : 1));
    },
  }),
  scroll({
    id: 'thousand_blades', name: '万剑归宗', rarity: 4, maxStacks: 1, tags: ['传说', '命中'],
    description: '武器命中时 15% 概率射出一柄追踪飞剑，造成该次伤害 120% 的伤害。',
    setup: (s, _n, ctx) => {
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!isDirectWeaponHit(result) || result.dealt <= 0 || result.killed) return;
        if (!ctx.rng.chance(0.15) || !s.ready('blade', 0.12)) return;
        const eye = ctx.player.eye;
        _from.set(eye.x + (Math.random() - 0.5) * 0.8, eye.y + 0.35 + Math.random() * 0.3, eye.z + (Math.random() - 0.5) * 0.8);
        _to.subVectors(bodyCenter(enemy, _to), _from).normalize().multiplyScalar(30);
        ctx.projectiles.spawn({
          owner: 'player',
          position: _from.clone(),
          velocity: _to.clone(),
          radius: 0.2,
          lifetime: 2.2,
          homing: 10,
          damage: { base: result.dealt * 1.2, element: 'none', source: 'scroll', procDepth: 1, canCrit: false },
          color: 0xbff4ff,
          visual: 'shard',
          scale: 1.3,
        });
      });
    },
  }),
  scroll({
    id: 'midas_heart', name: '贪婪之心', rarity: 4, maxStacks: 1, tags: ['传说', '经济', '风险'],
    description: '金币获取 +50%；每持有 100 金币，武器伤害 +4%（最多 +40%）；但受到伤害时损失 3 金币（每 0.5 秒最多一次）。',
    setup: (s, _n, ctx) => {
      s.stat('coinGainPct', 0.5);
      s.outgoing((_e, req) => (req.source === 'weapon' ? 1 + Math.min(0.4, Math.floor(ctx.run.coins / 100) * 0.04) : 1));
      s.on('player:damaged', ({ amount }) => {
        if (amount <= 0 || ctx.run.coins <= 0 || !s.ready('lose', 0.5)) return;
        const loss = Math.min(3, ctx.run.coins);
        ctx.run.coins -= loss;
        ctx.events.emit('coins:changed', { coins: ctx.run.coins, delta: -loss });
      });
    },
  }),
  scroll({
    id: 'blood_pact', name: '血契', rarity: 4, maxStacks: 1, tags: ['传说', '生存', '风险'],
    description: '吸血 +4%，击杀回复 6 生命；但护盾上限 −40。',
    setup: (s) => {
      s.stat('lifesteal', 0.04);
      s.stat('killHeal', 6);
      s.stat('maxShield', -40);
    },
  }),
  scroll({
    id: 'overdrive', name: '超载', rarity: 4, maxStacks: 1, tags: ['传说', '射速', '风险'],
    description: '射速 +35%，弹匣容量 +50%；但换弹速度 −30%。',
    setup: (s) => {
      s.stat('fireRatePct', 0.35);
      s.stat('magSizePct', 0.5);
      s.stat('reloadSpeedPct', -0.3);
    },
  }),

  // ───────────── 英雄专属 ─────────────
  scroll({
    id: 'fox_resonance', name: '狐火共鸣', rarity: 2, maxStacks: 3, heroOnly: 'fox', tags: ['英雄', '灼烧', '技能'],
    description: '灼烧伤害每层 +10%；使用燃爆雷（E）后，九尾狐火（Q）冷却每层减少 1.5 秒。',
    setup: (s, n, ctx) => {
      s.stat('fireDamagePct', 0.1 * n);
      s.on('skill:used', ({ slot }) => {
        if (slot === 'secondary') ctx.player.reduceCooldowns(1.5 * n, 'primary');
      });
    },
  }),
  scroll({
    id: 'falcon_sky', name: '九天雷鸣', rarity: 2, maxStacks: 3, heroOnly: 'falcon', tags: ['英雄', '雷殛', '暴击'],
    description: '雷殛伤害每层 +10%；滞空时暴击率每层 +6%。',
    setup: (s, n, ctx) => {
      s.stat('shockDamagePct', 0.1 * n);
      s.toggle([['critChance', 0.06 * n]], () => !ctx.player.onGround);
    },
  }),
  scroll({
    id: 'bear_mountain', name: '不动如山', rarity: 2, maxStacks: 3, heroOnly: 'bear', tags: ['英雄', '护盾', '生存'],
    description: '护盾上限每层 +15（获得时同时补充 15 护盾）；护盾未被击破时，受到的伤害每层 −6%。',
    setup: (s, n, ctx) => {
      s.stat('maxShield', 15 * n);
      ctx.player.addShield(15);
      s.incoming(() => (ctx.player.shield > 0 ? 1 - 0.06 * n : 1));
    },
  }),
];
