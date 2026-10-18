import * as THREE from 'three';
import type { DamageRequest, GameContext, IEnemy, ScrollDef, StatKey } from '../../core/types';
import {
  blastRadius, depthOf, isDirectWeaponHit, isPurgeKill, procScale, scroll, type ScrollScope,
} from './ScrollKit';

/** 战术秘卷：切枪、装填、机动、技能交替和连续命中。临时战斗状态在换关 / 死亡时清空。 */
function battleBuff(s: ScrollScope, mods: readonly (readonly [StatKey, number])[]) {
  const buff = s.buff(mods);
  s.on('stage:loaded', () => buff.end());
  s.on('player:died', () => buff.end());
  return buff;
}

/** 同一把武器的重复 switched 事件（拾取、初始化等）不算切枪。 */
function onSwitch(s: ScrollScope, fn: () => void): void {
  let previous = s.ctx.weapons.active?.uid;
  s.on('stage:loaded', () => { previous = s.ctx.weapons.active?.uid; });
  s.on('weapon:switched', ({ weapon }) => {
    const next = weapon?.uid;
    const changed = previous !== undefined && next !== undefined && previous !== next;
    previous = next;
    if (changed && s.ctx.player.alive) fn();
  });
}

function pulse(ctx: GameContext, radius: number, base: number, color: number): void {
  const center = ctx.player.position.clone().add(new THREE.Vector3(0, 0.9, 0));
  const r = blastRadius(ctx, radius);
  ctx.combat.explode(center, r, {
    base: base * procScale(ctx), element: 'none', source: 'scroll', procDepth: 1,
    canCrit: false, knockback: 8,
  }, { color, noFx: true });
  center.y = ctx.player.position.y + 0.1;
  ctx.fx.ring(center, r, color, 0.35);
  ctx.audio.play('skill_earth', { volume: 0.45 });
}

export const TACTIC_SCROLLS: ScrollDef[] = [
  scroll({
    id: 'tac_crossfire', name: '交替火力', rarity: 1, maxStacks: 3, tags: ['切枪', '伤害'],
    description: '切换到另一把武器后 4 秒内，武器伤害每层 +12%；冷却 4 秒。',
    setup: (s, n) => {
      const buff = battleBuff(s, [['damagePct', 0.12 * n]]);
      onSwitch(s, () => { if (s.ready('switch', 4)) buff.trigger(4); });
    },
  }),
  scroll({
    id: 'tac_cover_change', name: '换位掩护', rarity: 1, maxStacks: 3, tags: ['切枪', '护盾'],
    description: '切换到另一把武器时每层回复 8 护盾；冷却 5 秒。',
    setup: (s, n, ctx) => onSwitch(s, () => {
      if (s.ready('shield', 5)) ctx.player.addShield(8 * n);
    }),
  }),
  scroll({
    id: 'tac_reload_guard', name: '装填壁垒', rarity: 0, maxStacks: 3, tags: ['换弹', '生存'],
    description: '正在换弹时，受到的伤害每层 −8%。',
    setup: (s, n, ctx) => s.incoming(() => ctx.weapons.isReloading ? 1 - 0.08 * n : 1),
  }),
  scroll({
    id: 'tac_loaded_focus', name: '凝神装填', rarity: 1, maxStacks: 3, tags: ['换弹', '爆头', '伤害'],
    description: '换弹完成后 8 秒内，该武器接下来 3 次直接命中伤害每层 +25%，爆头再额外每层 +15%。同帧霰弹或穿透命中算一次并共享强化；切枪清空。',
    setup: (s, n, ctx) => {
      let uid: number | undefined, remaining = 0, until = -Infinity, spentFrame = -1;
      const reset = () => { uid = undefined; remaining = 0; until = -Infinity; spentFrame = -1; };
      const eligible = (req: DamageRequest) => ctx.player.alive && req.source === 'weapon' && depthOf(req) === 0 &&
        !req.tags?.includes('purge') && uid !== undefined && req.weaponUid === uid && ctx.time.now < until &&
        (remaining > 0 || spentFrame === ctx.time.frame);
      s.on('stage:loaded', reset);
      s.on('player:died', reset);
      s.on('weapon:switched', reset);
      s.on('weapon:reloaded', ({ weapon }) => {
        if (!ctx.player.alive) return;
        uid = weapon.uid; remaining = 3; until = ctx.time.now + 8; spentFrame = -1;
      });
      s.outgoing((_enemy, req) => eligible(req) ? 1 + (0.25 + (req.headshot ? 0.15 : 0)) * n : 1);
      s.on('enemy:damaged', ({ result }) => {
        if (result.dealt <= 0 || !eligible(result.request) || spentFrame === ctx.time.frame) return;
        remaining--;
        spentFrame = ctx.time.frame;
      });
    },
  }),
  scroll({
    id: 'tac_dash_load', name: '滑步装填', rarity: 2, maxStacks: 3, tags: ['机动', '弹匣'],
    description: '冲刺时将备弹中的每层 2 发装入当前弹匣；不超过弹匣容量，不触发换弹效果；冷却 2 秒。无备弹或持碎刃时不生效。',
    setup: (s, n, ctx) => {
      s.on('player:dashed', () => {
        const w = ctx.weapons.active;
        if (!ctx.player.alive || !w || ctx.weapons.bladeHud) return;
        const take = Math.min(2 * n, Math.max(0, ctx.weapons.magCapacity(w) - w.mag), Math.max(0, w.reserve));
        if (take <= 0 || !s.ready('load', 2)) return;
        w.mag += take;
        w.reserve -= take;
      });
    },
  }),
  scroll({
    id: 'tac_dash_wave', name: '踏浪震击', rarity: 2, maxStacks: 3, tags: ['机动', '爆炸'],
    description: '冲刺时向周围 3 米释放击退波，造成每层 24 点伤害（随关卡强度成长），范围受爆炸范围加成影响；冷却 3 秒。',
    setup: (s, n, ctx) => s.on('player:dashed', () => {
      if (ctx.player.alive && s.ready('wave', 3)) pulse(ctx, 3, 24 * n, 0x93e8ff);
    }),
  }),
  scroll({
    id: 'tac_landing_wave', name: '坠星震地', rarity: 2, maxStacks: 3, tags: ['机动', '爆炸'],
    description: '以至少 6 米/秒的下落速度落地时，对周围 4 米造成每层 28 点伤害（随关卡强度成长）并击退，范围受爆炸范围加成影响；冷却 3 秒。',
    setup: (s, n, ctx) => s.on('player:landed', ({ fallSpeed }) => {
      if (ctx.player.alive && fallSpeed >= 6 && s.ready('landing', 3)) pulse(ctx, 4, 28 * n, 0xe8cd8c);
    }),
  }),
  scroll({
    id: 'tac_battle_mage', name: '术法回流', rarity: 2, maxStacks: 3, tags: ['技能', '命中'],
    description: '英雄技能直接造成伤害时，主技能（Q）冷却每层减少 0.25 秒；冷却 0.6 秒。持续伤害、反应和衍生伤害不触发。',
    setup: (s, n, ctx) => s.on('enemy:damaged', ({ result }) => {
      const req = result.request;
      if (!ctx.player.alive || result.dealt <= 0 || req.source !== 'skill' || (req.procDepth ?? 0) !== 0 ||
        req.tags?.includes('reaction') || isPurgeKill(result) || !s.ready('skill', 0.6)) return;
      ctx.player.reduceCooldowns(0.25 * n, 'primary');
    }),
  }),
  scroll({
    id: 'tac_spell_ward', name: '施法护符', rarity: 0, maxStacks: 3, tags: ['技能', '护盾'],
    description: '释放英雄技能时每层回复 6 护盾；冷却 2 秒。',
    setup: (s, n, ctx) => s.on('skill:used', () => {
      if (ctx.player.alive && s.ready('ward', 2)) ctx.player.addShield(6 * n);
    }),
  }),
  scroll({
    id: 'tac_alternating_arts', name: '双诀相生', rarity: 2, maxStacks: 3, tags: ['技能', '触发'],
    description: '在 6 秒内交替释放 Q 与 E，使前一个技能冷却立即减少每层 1.5 秒，并获得 6 秒技能伤害每层 +20%；联动冷却 3 秒，连续使用同一技能不触发。',
    setup: (s, n, ctx) => {
      const buff = battleBuff(s, [['skillDamagePct', 0.2 * n]]);
      let last: 'primary' | 'secondary' | undefined;
      let until = -Infinity;
      const reset = () => { last = undefined; until = -Infinity; };
      s.on('stage:loaded', reset);
      s.on('player:died', reset);
      s.on('skill:used', ({ slot }) => {
        if (!ctx.player.alive) return;
        if (last !== undefined && last !== slot && ctx.time.now < until && s.ready('pair', 3)) {
          ctx.player.reduceCooldowns(1.5 * n, last);
          buff.trigger(6);
        }
        last = slot;
        until = ctx.time.now + 6;
      });
    },
  }),
  scroll({
    id: 'tac_pristine_shield', name: '完璧锋芒', rarity: 1, maxStacks: 3, tags: ['护盾', '伤害'],
    description: '护盾至少为上限的 95% 时，武器伤害每层 +10%；护盾上限为 0 时不生效。',
    setup: (s, n, ctx) => s.outgoing((_e, req) =>
      req.source === 'weapon' && ctx.player.maxShield() > 0 && ctx.player.shield >= ctx.player.maxShield() * 0.95
        ? 1 + 0.1 * n : 1),
  }),
  scroll({
    id: 'tac_emergency_reload', name: '破盾急装', rarity: 1, maxStacks: 3, tags: ['护盾', '换弹'],
    description: '护盾被击破后 5 秒内，换弹速度每层 +20%。',
    setup: (s, n, ctx) => {
      const buff = battleBuff(s, [['reloadSpeedPct', 0.2 * n]]);
      s.on('player:shieldBroken', () => { if (ctx.player.alive) buff.trigger(5); });
    },
  }),
  scroll({
    id: 'tac_healing_barrier', name: '回生结界', rarity: 2, maxStacks: 3, tags: ['生存', '护盾'],
    description: '实际回复生命时，同时回复该次回复量每层 25% 的护盾；满生命时无效。',
    setup: (s, n, ctx) => s.on('player:healed', ({ amount }) => {
      if (ctx.player.alive && amount > 0) ctx.player.addShield(amount * 0.25 * n);
    }),
  }),
  scroll({
    id: 'tac_crit_insight', name: '会心悟道', rarity: 2, maxStacks: 3, tags: ['暴击', '技能'],
    description: '武器直接暴击造成伤害时，副技能（E）冷却每层减少 0.2 秒；冷却 0.75 秒。',
    setup: (s, n, ctx) => s.on('enemy:damaged', ({ result }) => {
      if (ctx.player.alive && result.isCrit && result.dealt > 0 && isDirectWeaponHit(result) &&
        !isPurgeKill(result) && s.ready('insight', 0.75)) ctx.player.reduceCooldowns(0.2 * n, 'secondary');
    }),
  }),
  scroll({
    id: 'tac_focused_prey', name: '追猎印记', rarity: 3, maxStacks: 3, tags: ['命中', '伤害'],
    description: '武器直接命中同一敌人后，4 秒内后续武器伤害每次命中每层 +3%，最多累计 5 次；命中刷新持续时间，同帧对同一敌人只累计一次。',
    setup: (s, n, ctx) => {
      let marks = new WeakMap<IEnemy, { hits: number; until: number; frame: number }>();
      const reset = () => { marks = new WeakMap(); };
      s.on('stage:loaded', reset);
      s.on('player:died', reset);
      s.outgoing((enemy, req) => {
        const mark = marks.get(enemy);
        return req.source === 'weapon' && mark && ctx.time.now < mark.until ? 1 + mark.hits * 0.03 * n : 1;
      });
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!ctx.player.alive || !isDirectWeaponHit(result) || result.dealt <= 0 || isPurgeKill(result)) return;
        if (result.killed) { marks.delete(enemy); return; }
        const old = marks.get(enemy);
        if (old && old.frame === ctx.time.frame) return;
        marks.set(enemy, { hits: Math.min(5, (old && ctx.time.now < old.until ? old.hits : 0) + 1),
          until: ctx.time.now + 4, frame: ctx.time.frame });
      });
    },
  }),
  scroll({
    id: 'tac_reaction_ward', name: '化应为盾', rarity: 2, maxStacks: 3, tags: ['反应', '护盾', '生存'],
    description: '直接元素反应蓄积 1 枚应盾，最多 2 枚，每 0.8 秒至多蓄积一次；再次蓄积刷新全部应盾的 6 秒时长。受到伤害时消耗 1 枚，使该次伤害每层秘卷 −20%（满层 −60%）。衍生反应不蓄能，无敌时不消耗。',
    setup: (s, n, ctx) => {
      let charges = 0, until = -Infinity;
      const reset = () => { charges = 0; until = -Infinity; };
      s.on('stage:loaded', reset);
      s.on('player:died', reset);
      s.on('enemy:reaction', ({ depth }) => {
        if (!ctx.player.alive || depth !== 0 || !s.ready('reaction', 0.8)) return;
        if (ctx.time.now >= until) charges = 0;
        charges = Math.min(2, charges + 1);
        until = ctx.time.now + 6;
      });
      // Combat 在无敌检查之后调用，故冲刺无敌、免死无敌不会白白消耗应盾。
      s.incoming(() => {
        if (!ctx.player.alive || charges <= 0 || ctx.time.now >= until) return 1;
        charges--;
        ctx.fx.ring(ctx.player.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 1.2, 0xa7dfff, 0.25);
        return 1 - 0.2 * n;
      });
    },
  }),
  scroll({
    id: 'tac_reaction_stride', name: '应变疾行', rarity: 3, maxStacks: 2, tags: ['反应', '机动'],
    description: '直接引发元素反应后 4 秒内，移动速度每层 +0.4、反应急速每层 +5%；再次触发刷新时长。衍生反应不触发。',
    setup: (s, n, ctx) => {
      const buff = battleBuff(s, [['moveSpeed', 0.4 * n], ['reactionHaste', 0.05 * n]]);
      s.on('enemy:reaction', ({ depth }) => { if (ctx.player.alive && depth === 0) buff.trigger(4); });
    },
  }),
  scroll({
    id: 'tac_stagger_hunter', name: '乘隙追击', rarity: 1, maxStacks: 3, tags: ['控制', '伤害'],
    description: '对处于眩晕或减速状态的敌人，武器伤害每层 +12%。',
    setup: (s, n) => s.outgoing((enemy, req) => req.source === 'weapon' &&
      ((enemy.statuses.get('stun')?.remaining ?? 0) > 0 || (enemy.statuses.get('slow')?.remaining ?? 0) > 0)
      ? 1 + 0.12 * n : 1),
  }),
  scroll({
    id: 'tac_dash_capstone', name: '疾影破军', rarity: 4, maxStacks: 1, tags: ['传说', '机动', '爆炸'],
    description: '冲刺后 3 秒内首次武器直接命中引发 3 米爆炸，造成该次伤害 70% 的物理伤害，范围受爆炸范围加成影响；蓄能冷却 4 秒。',
    setup: (s, _n, ctx) => {
      let until = -Infinity;
      const reset = () => { until = -Infinity; };
      s.on('stage:loaded', reset);
      s.on('player:died', reset);
      s.on('player:dashed', () => { if (ctx.player.alive && s.ready('prime', 4)) until = ctx.time.now + 3; });
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!ctx.player.alive || ctx.time.now >= until || !isDirectWeaponHit(result) || result.dealt <= 0 || isPurgeKill(result)) return;
        // 先消费蓄能，避免爆炸派发的嵌套命中再次触发。
        until = -Infinity;
        const center = result.request.point?.clone() ?? enemy.getBodyCenter(new THREE.Vector3());
        ctx.combat.explode(center, blastRadius(ctx, 3), {
          base: result.dealt * 0.7, element: 'none', source: 'scroll', canCrit: false, procDepth: 1,
        }, { color: 0xb7eaff });
      });
    },
  }),
  scroll({
    id: 'tac_spellgun_cycle', name: '灵武轮转', rarity: 4, maxStacks: 1, tags: ['传说', '技能', '伤害', '风险'],
    description: '释放英雄技能后 5 秒内武器伤害 +25%；武器直接命中造成伤害后 5 秒内技能伤害 +35%；但受到的伤害 +15%。',
    setup: (s, _n, ctx) => {
      const gun = battleBuff(s, [['damagePct', 0.25]]);
      const spell = battleBuff(s, [['skillDamagePct', 0.35]]);
      s.incoming(() => 1.15);
      s.on('skill:used', () => { if (ctx.player.alive) gun.trigger(5); });
      s.on('enemy:damaged', ({ result }) => {
        if (ctx.player.alive && result.dealt > 0 && isDirectWeaponHit(result) && !isPurgeKill(result)) spell.trigger(5);
      });
    },
  }),
];
