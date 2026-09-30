import * as THREE from 'three';
import type { GameContext, IEnemy, ScrollDef, StatusId } from '../../core/types';
import { ELEMENT_COLORS } from '../../core/types';
import { bodyCenter, depthOf, forEachNear, isDirectWeaponHit, nearestOther, scroll } from './ScrollKit';
import type { ScrollScope } from './ScrollKit';

/** 秘卷：元素（灼烧 / 雷殛 / 蚀化） */

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/** 各状态的默认持续时间（用于死亡时判断「是否处于该状态」，兼容战斗系统在死亡时清空状态的情况） */
const STATUS_DURATION: Partial<Record<StatusId, number>> = { burn: 4, shock: 3, corrode: 5 };

/**
 * 跟踪敌人最近一次被施加某状态的时间。
 * 返回查询函数：敌人当前带有该状态，或在状态持续时间内被施加过。
 */
function trackStatus(s: ScrollScope, ctx: GameContext, id: StatusId): (e: IEnemy) => boolean {
  const last = new WeakMap<IEnemy, number>();
  s.on('enemy:statusApplied', ({ enemy, status }) => {
    if (status === id) last.set(enemy, ctx.time.now);
  });
  const dur = STATUS_DURATION[id] ?? 3;
  return (e) => e.statuses.has(id) || ctx.time.now - (last.get(e) ?? -Infinity) < dur;
}

/** 武器命中时按概率附着元素状态 */
function elementalRounds(id: string, name: string, status: 'burn' | 'shock' | 'corrode', label: string): ScrollDef {
  return scroll({
    id, name, rarity: 1, maxStacks: 3, tags: ['元素', label, '命中'],
    description: `武器命中时每层 5% 概率额外附着${label}。`,
    setup: (s, n, ctx) => {
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!isDirectWeaponHit(result) || result.killed || !enemy.alive || result.dealt <= 0) return;
        if (result.statusApplied === status || !ctx.rng.chance(0.05 * n)) return;
        ctx.combat.applyStatus(enemy, status, Math.min(result.dealt, enemy.maxHp * 0.5));
      });
    },
  });
}

export const ELEMENT_SCROLLS: ScrollDef[] = [
  scroll({
    id: 'ember_heart', name: '炎心', rarity: 0, maxStacks: 4, tags: ['元素', '灼烧'],
    description: '灼烧伤害每层 +15%，元素触发率每层 +3%。',
    setup: (s, n) => {
      s.stat('fireDamagePct', 0.15 * n);
      s.stat('elementChancePct', 0.03 * n);
    },
  }),
  scroll({
    id: 'thunder_heart', name: '雷心', rarity: 0, maxStacks: 4, tags: ['元素', '雷殛'],
    description: '雷殛伤害每层 +15%，元素触发率每层 +3%。',
    setup: (s, n) => {
      s.stat('shockDamagePct', 0.15 * n);
      s.stat('elementChancePct', 0.03 * n);
    },
  }),
  scroll({
    id: 'venom_heart', name: '蚀心', rarity: 0, maxStacks: 4, tags: ['元素', '蚀化'],
    description: '蚀化伤害每层 +15%，元素触发率每层 +3%。',
    setup: (s, n) => {
      s.stat('corrodeDamagePct', 0.15 * n);
      s.stat('elementChancePct', 0.03 * n);
    },
  }),
  scroll({
    id: 'five_elements', name: '五行共鸣', rarity: 2, maxStacks: 3, tags: ['元素'],
    description: '所有元素伤害每层 +10%，元素触发率每层 +5%。',
    setup: (s, n) => {
      s.stat('elementDamagePct', 0.1 * n);
      s.stat('elementChancePct', 0.05 * n);
    },
  }),
  elementalRounds('ignite_rounds', '燃弹', 'burn', '灼烧'),
  elementalRounds('storm_rounds', '雷弹', 'shock', '雷殛'),
  elementalRounds('acid_rounds', '蚀弹', 'corrode', '蚀化'),
  scroll({
    id: 'wildfire', name: '野火燎原', rarity: 2, maxStacks: 3, tags: ['元素', '灼烧', '击杀'],
    description: '灼烧中的敌人死亡时，火焰蔓延至 5 米内所有敌人，附着强度为其最大生命每层 10% 的灼烧。',
    setup: (s, n, ctx) => {
      const burning = trackStatus(s, ctx, 'burn');
      s.on('enemy:killed', ({ enemy }) => {
        if (!burning(enemy)) return;
        const c = bodyCenter(enemy, _p);
        const power = enemy.maxHp * 0.1 * n;
        let spread = 0;
        forEachNear(ctx, c, 5, enemy, (e) => {
          ctx.combat.applyStatus(e, 'burn', Math.min(power, e.maxHp * 0.5));
          spread++;
        });
        if (spread > 0) {
          _q.set(c.x, enemy.position.y + 0.1, c.z);
          ctx.fx.ring(_q, 5, ELEMENT_COLORS.fire, 0.4);
          ctx.fx.burst(c, ELEMENT_COLORS.fire, 16, 5, 0.5, 0.12, -2);
        }
      });
    },
  }),
  scroll({
    id: 'static_arc', name: '静电弧', rarity: 2, maxStacks: 3, tags: ['元素', '雷殛', '命中'],
    description: '武器命中雷殛状态的敌人时，每层 12% 概率向 8 米内另一个敌人弹射闪电，造成该次伤害 60% 的雷电伤害。',
    setup: (s, n, ctx) => {
      const shocked = trackStatus(s, ctx, 'shock');
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!isDirectWeaponHit(result) || result.dealt <= 0 || !shocked(enemy)) return;
        if (!ctx.rng.chance(0.12 * n) || !s.ready('arc', 0.08)) return;
        const from = bodyCenter(enemy, _p);
        const target = nearestOther(ctx, from, 8, enemy);
        if (!target) return;
        const to = target.getBodyCenter(_q);
        ctx.fx.lightning(from, to, ELEMENT_COLORS.shock);
        ctx.audio.play('shock_zap', { position: to, volume: 0.6 });
        ctx.combat.damageEnemy(target, {
          base: result.dealt * 0.6, element: 'shock', source: 'scroll', procDepth: 1, canCrit: false, point: to.clone(),
        });
      });
    },
  }),
  scroll({
    id: 'acid_burst', name: '蚀爆', rarity: 2, maxStacks: 3, tags: ['元素', '蚀化', '击杀'],
    description: '蚀化中的敌人死亡时爆炸，对 3.5 米内造成其最大生命每层 12% 的蚀化伤害并附着蚀化。',
    setup: (s, n, ctx) => {
      const corroded = trackStatus(s, ctx, 'corrode');
      s.on('enemy:killed', ({ enemy, result }) => {
        const depth = depthOf(result.request);
        if (depth >= 2 || !corroded(enemy)) return;
        const c = bodyCenter(enemy, _p);
        ctx.combat.explode(c, 3.5, {
          base: enemy.maxHp * 0.12 * n, element: 'corrode', elementChance: 1, source: 'scroll', procDepth: depth + 1, canCrit: false,
        }, { color: ELEMENT_COLORS.corrode });
      });
    },
  }),
];
