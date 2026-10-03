import * as THREE from 'three';
import type { DamageRequest, DetonateOpts, GameContext, IEnemy, ReactionId, ScrollDef, StatusId } from '../../core/types';
import { ELEMENT_COLORS, REACTION_NAMES } from '../../core/types';
import { bodyCenter, depthOf, forEachNear, nearestOther, procScale, scroll } from './ScrollKit';
import type { ScrollScope } from './ScrollKit';
import { statusPowerFromDealt } from '../../combat/DamageCalc';

/**
 * 命中 / 反应伤害（已含元素 / 精英 / 首领加成）→ applyStatus 的状态强度：元素状态除掉每一跳会再乘的属性倍率，
 * 否则持续伤害会把加成算两次（引发的反应强度由 applyStatus 乘回，和原来一致）；其他状态只钳到最大生命 × 0.5。
 */
function asStatusPower(ctx: GameContext, e: IEnemy, sid: StatusId, dealt: number): number {
  return sid === 'burn' || sid === 'shock' || sid === 'corrode'
    ? statusPowerFromDealt(ctx.player.stats, e, sid, dealt)
    : Math.min(dealt, e.maxHp * 0.5);
}

/**
 * 秘卷：元素反应（docs/arsenal-expansion.md 第 6 节，共 24 个）。
 *  - 只经 ctx.combat（applyStatus / detonate / triggerReaction / damageEnemy / explode）与战斗交互，不 import combat / weapons。
 *  - 'enemy:damaged' / 'enemy:killed' 回调里造成伤害一律包 ctx.tasks.delay(0, …)；施加状态、引爆、强制反应只入队，可同步调用。
 *  - 'enemy:reaction' 在伤害管线之外派发，可直接造成伤害；ev.point 是复用向量，先拷贝再用。
 *  - 显式施加状态一律传 depth，反应最多再连锁一级：
 *    · 武器 / 技能命中直接引出的附着（引雷 / 引火 / 引蚀、三才印、狐火引雷、蚀羽惊雷、熔岩撼地）沿用该击的深度
 *      （通常为 0），算作「直接反应」，流派终卷（爆焰、熔铸、焚天雷狱、金乌坠、镇岳）对它们生效；
 *    · 由反应衍生的附着（焚天雷狱补雷殛、镇岳电弧附蚀）为 depth 1。
 */

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _o = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _g = new THREE.Vector3();
const _buf: IEnemy[] = [];
const _cands: IEnemy[] = [];
/** 「点穴」的引爆参数（detonate 同步读取，复用） */
const _acuOpts: DetonateOpts = { power: 0, mult: 1, depth: 0, weaponUid: undefined, point: undefined };
/** 「归真」随机挑两种元素用（原地洗牌，不分配） */
const _trio: StatusId[] = ['burn', 'shock', 'corrode'];
/** 「劫火」三道天雷的颜色 */
const KALPA_COLORS: readonly number[] = [ELEMENT_COLORS.fire, ELEMENT_COLORS.shock, ELEMENT_COLORS.corrode];

// ───────────── 私有辅助 ─────────────

const ELEM: readonly StatusId[] = ['burn', 'shock', 'corrode'];
const STATUS_LABEL: Partial<Record<StatusId, string>> = { burn: '灼烧', shock: '雷殛', corrode: '蚀化' };

/** 敌人身上 灼烧 / 雷殛 / 蚀化 的种数 */
function statusCount(e: IEnemy): number {
  let n = 0;
  for (let i = 0; i < ELEM.length; i++) if (e.statuses.has(ELEM[i])) n++;
  return n;
}

const rxTag = (req: DamageRequest, id: string): boolean => !!req.tags?.includes(id);

/** 玩家武器伤害（含爆炸武器：投射物爆炸把原 source 放进 tags） */
const isWeaponReq = (req: DamageRequest): boolean =>
  req.weaponUid !== undefined && (req.source === 'weapon' || (req.source === 'explosion' && rxTag(req, 'weapon')));

/** 技能伤害（含技能投射物的爆炸） */
const isSkillReq = (req: DamageRequest): boolean => req.source === 'skill' || rxTag(req, 'skill');

/** 逐敌人内置冷却（WeakMap 版）：返回 true 时同时记下冷却 */
function perEnemyIcd(): (e: IEnemy, now: number, cd: number) => boolean {
  const next = new WeakMap<IEnemy, number>();
  return (e, now, cd) => {
    if (now < (next.get(e) ?? -Infinity)) return false;
    next.set(e, now + cd);
    return true;
  };
}

/** 带某反应标签的伤害 × mult */
function boostReaction(s: ScrollScope, id: ReactionId, mult: number): void {
  s.outgoing((_e, r) => (rxTag(r, id) ? mult : 1));
}

/** 爆炸 / 范围半径吃爆炸范围属性 */
function blastR(s: ScrollScope, r: number): number {
  return r * s.ctx.player.stats.mult('explosionRadiusPct');
}

/**
 * 秘卷延时爆炸（金乌坠坍缩）每帧的完整爆炸特效预算（与反应系统一致为 3 个）：
 * 同一帧被接受的多次熔金会在 1.5 秒后同帧坍缩，超出的改为 noFx + 轻量 burst / ring。
 */
const SCROLL_BIG_FX = 3;
/** 金乌坠坍缩爆炸颜色 */
const MG_COLLAPSE_COLOR = 0xffc04a;
let _fxFrame = -1;
let _fxUsed = 0;
function scrollBigFx(ctx: GameContext): boolean {
  const f = ctx.time.frame;
  if (f !== _fxFrame) {
    _fxFrame = f;
    _fxUsed = 0;
  }
  if (_fxUsed >= SCROLL_BIG_FX) return false;
  _fxUsed++;
  return true;
}

/**
 * 引雷 / 引火 / 引蚀：武器命中带 need 的敌人时按概率附加 give（引发 rx）。
 * 逐敌 0.4 秒冷却放在概率之前：霰弹的多枚弹丸、高射速武器都按「每 0.4 秒一次判定」归一。
 * 附着沿用这一击的深度 0（与三才印、副元素词条一致）：引发的是直接反应，爆焰 / 焚天雷狱 / 金乌坠 / 镇岳等终卷照常生效；
 * 设计文档 6.3 原写 depth 1，会让这些核心卡与终卷完全不联动，与 0.3 节流派表的意图相悖。
 */
function leadScroll(id: string, name: string, need: StatusId, give: StatusId, rx: ReactionId): ScrollDef {
  const needName = STATUS_LABEL[need] ?? need;
  const giveName = STATUS_LABEL[give] ?? give;
  const rxName = REACTION_NAMES[rx];
  return scroll({
    id, name, rarity: 1, maxStacks: 3, tags: ['元素', '反应', rxName, giveName, '命中'],
    description: `武器命中${needName}中的敌人时，每层 8% 概率附加${giveName}（引发「${rxName}」）。`,
    setup: (s, n, ctx) => {
      const icd = perEnemyIcd();
      s.on('enemy:damaged', ({ enemy, result }) => {
        const req = result.request;
        if (!isWeaponReq(req) || depthOf(req) !== 0 || result.killed || !enemy.alive) return;
        if (!enemy.statuses.has(need) || result.statusApplied === give) return;
        if (!icd(enemy, ctx.time.now, 0.4) || !ctx.rng.chance(0.08 * n)) return;
        ctx.combat.applyStatus(enemy, give, asStatusPower(ctx, enemy, give, result.dealt), undefined, {
          depth: 0, weaponUid: req.weaponUid,
        });
      });
    },
  });
}

/**
 * 英雄专属「技能附加 trigger 时概率同时附加 give」（狐火引雷 / 蚀羽惊雷）。
 * 雷殛叠满第 3 层会自删并眩晕：trigger 为 shock 时要求状态仍在身上。
 * 附着沿用这次技能命中的深度（技能直接命中为 0，鹰眼弹射等衍生命中为 1），理由同 leadScroll。
 */
function heroCatalyst(
  id: string, name: string, heroOnly: string, trigger: StatusId, give: StatusId, rx: ReactionId,
  tags: string[], description: string,
): ScrollDef {
  return scroll({
    id, name, rarity: 2, maxStacks: 3, heroOnly, tags, description,
    setup: (s, n, ctx) => {
      const icd = perEnemyIcd();
      s.on('enemy:damaged', ({ enemy, result }) => {
        if (!isSkillReq(result.request) || result.statusApplied !== trigger || result.killed || !enemy.alive) return;
        if (trigger === 'shock' && !enemy.statuses.has('shock')) return;
        if (!icd(enemy, ctx.time.now, 0.3) || !ctx.rng.chance(0.3 * n)) return;
        ctx.combat.applyStatus(enemy, give, asStatusPower(ctx, enemy, give, result.dealt), undefined, {
          depth: depthOf(result.request),
        });
      });
      boostReaction(s, rx, 1 + 0.1 * n);
    },
  });
}

// ───────────── 秘卷表 ─────────────

export const REACTION_SCROLLS: ScrollDef[] = [
  // ───────────── 普通 ─────────────
  scroll({
    id: 'rx_catalyst', name: '催化', rarity: 0, maxStacks: 5, tags: ['元素', '反应', '伤害'],
    description: '元素反应伤害每层 +8%。',
    setup: (s, n) => s.stat('reactionDamagePct', 0.08 * n),
  }),
  scroll({
    id: 'rx_haste', name: '灵动', rarity: 0, maxStacks: 4, tags: ['元素', '反应'],
    description: '元素反应急速每层 +10%（同一敌人再次发生同种反应的间隔缩短）。',
    setup: (s, n) => s.stat('reactionHaste', 0.1 * n),
  }),
  scroll({
    id: 'rx_tf_charm', name: '雷火符', rarity: 0, maxStacks: 4, tags: ['元素', '反应', '焚雷', '灼烧', '雷殛'],
    description: '「焚雷」伤害每层 +12%；灼烧与雷殛伤害每层 +4%。',
    setup: (s, n) => {
      boostReaction(s, 'thunderfire', 1 + 0.12 * n);
      s.stat('fireDamagePct', 0.04 * n);
      s.stat('shockDamagePct', 0.04 * n);
    },
  }),
  scroll({
    id: 'rx_mg_charm', name: '熔金符', rarity: 0, maxStacks: 4, tags: ['元素', '反应', '熔金', '灼烧', '蚀化'],
    description: '「熔金」伤害每层 +12%；对护甲伤害每层 +6%。',
    setup: (s, n) => {
      boostReaction(s, 'meltdown', 1 + 0.12 * n);
      s.stat('armorDamagePct', 0.06 * n);
    },
  }),
  scroll({
    id: 'rx_vs_charm', name: '封脉符', rarity: 0, maxStacks: 4, tags: ['元素', '反应', '封脉', '雷殛', '蚀化'],
    description: '「封脉」伤害每层 +12%；对护盾伤害每层 +6%。',
    setup: (s, n) => {
      boostReaction(s, 'veinseal', 1 + 0.12 * n);
      s.stat('shieldDamagePct', 0.06 * n);
    },
  }),

  // ───────────── 精良 ─────────────
  leadScroll('rx_lead_shock', '引雷', 'burn', 'shock', 'thunderfire'),
  leadScroll('rx_lead_fire', '引火', 'corrode', 'burn', 'meltdown'),
  leadScroll('rx_lead_corrode', '引蚀', 'shock', 'corrode', 'veinseal'),
  scroll({
    id: 'rx_ward', name: '化劫', rarity: 1, maxStacks: 3, tags: ['反应', '护盾', '生存'],
    description: '引发元素反应时每层回复 4 点护盾（每秒至多 3 次）；「归墟」改为每层 12 点。',
    setup: (s, n, ctx) => {
      s.on('enemy:reaction', ({ reaction }) => {
        if (!ctx.player.alive || !s.ready('w', 0.33)) return;
        ctx.player.addShield((reaction === 'abyss' ? 12 : 4) * n);
      });
    },
  }),

  // ───────────── 稀有 ─────────────
  scroll({
    id: 'rx_transmute', name: '化元', rarity: 2, maxStacks: 3, tags: ['反应', '技能'],
    description: '引发元素反应时，所有技能冷却每层减少 0.25 秒（每 0.5 秒至多一次）。',
    setup: (s, n, ctx) => {
      s.on('enemy:reaction', () => {
        if (s.ready('cd', 0.5)) ctx.player.reduceCooldowns(0.25 * n, 'both');
      });
    },
  }),
  scroll({
    id: 'rx_acupoint', name: '点穴', rarity: 2, maxStacks: 3, tags: ['反应', '引爆', '爆头'],
    description: '武器爆头命中带有元素状态的敌人时引爆其状态，引爆强度每层 40%（冷却 1.2 秒）。',
    setup: (s, n, ctx) => {
      // 与同一击的满蓄 / 破势引爆由反应系统合并（取较高强度）；被引爆冷却拒绝时不计本卷冷却
      let readyAt = -Infinity;
      s.on('enemy:damaged', ({ enemy, result }) => {
        const req = result.request;
        if (!req.headshot || !isWeaponReq(req) || depthOf(req) !== 0 || result.killed || !enemy.alive) return;
        const now = ctx.time.now;
        if (now < readyAt || statusCount(enemy) === 0) return;
        _acuOpts.power = Math.min(result.dealt, enemy.maxHp * 0.5);
        _acuOpts.mult = 0.4 * n;
        _acuOpts.weaponUid = req.weaponUid;
        _acuOpts.point = req.point;
        const out = ctx.combat.detonate(enemy, _acuOpts);
        _acuOpts.point = undefined;
        if (out) readyAt = now + 1.2;
      });
    },
  }),
  scroll({
    id: 'rx_tf_scatter', name: '爆焰', rarity: 2, maxStacks: 3, tags: ['元素', '反应', '焚雷', '爆炸'],
    description: '「焚雷」爆炸时向四周溅出 3 枚火星，各在落点 2 米内造成每层 18 点火焰伤害（随关卡强度成长），50% 概率附加灼烧。',
    setup: (s, n, ctx) => {
      s.on('enemy:reaction', (ev) => {
        if (ev.reaction !== 'thunderfire' || ev.depth !== 0 || !s.ready('sc', 0.3)) return;
        _o.copy(ev.point);
        // 出生点推到中心敌人身体之外，免得火星一出膛就撞上它原地爆开
        const push = (ev.enemy.alive ? ev.enemy.radius : 0) + 0.25;
        const base = 18 * n * procScale(ctx);
        const a0 = ctx.rng.range(0, Math.PI * 2);
        for (let i = 0; i < 3; i++) {
          const a = a0 + (i * Math.PI * 2) / 3 + ctx.rng.range(-0.4, 0.4);
          _dir.set(Math.cos(a), 0, Math.sin(a));
          const h = ctx.rng.range(4, 6);
          _vel.set(_dir.x * h, ctx.rng.range(6, 8), _dir.z * h);
          _p.copy(_o).addScaledVector(_dir, push);
          _p.y += 0.3;
          // spawn 内部按值复制 position / velocity / damage
          ctx.projectiles.spawn({
            owner: 'player', position: _p, velocity: _vel, gravity: 16, radius: 0.12, lifetime: 1.2,
            visual: 'orb', scale: 0.6, color: 0xffa040, element: 'fire', explosionRadius: 2,
            damage: { base, element: 'fire', source: 'scroll', elementChance: 0.5, canCrit: false, procDepth: ev.depth + 1 },
          });
        }
      });
    },
  }),
  scroll({
    id: 'rx_mg_shatter', name: '熔铸', rarity: 2, maxStacks: 3, tags: ['元素', '反应', '熔金', '护甲'],
    description: '「熔金」击碎敌人护甲时，熔甲碎片迸射至 5 米内的敌人，造成其护甲上限每层 15% 的蚀化伤害（单体上限随关卡强度）并附加蚀化。',
    setup: (s, n, ctx) => {
      s.on('enemy:damaged', ({ enemy, result }) => {
        const req = result.request;
        if (!result.armorBroken || !rxTag(req, 'meltdown')) return;
        const depth = depthOf(req);
        if (depth >= 2) return;
        const maxArmor = enemy.maxArmor;
        const c = bodyCenter(enemy, _p).clone();
        ctx.fx.burst(c, ELEMENT_COLORS.corrode, 16, 6, 0.5, 0.1, 10);
        ctx.tasks.delay(0, () => {
          const base = Math.min(maxArmor * 0.15 * n, 60 * n * procScale(ctx));
          if (!(base > 0)) return;
          forEachNear(ctx, c, 5, enemy, (e) => {
            ctx.combat.damageEnemy(e, {
              base, element: 'corrode', source: 'scroll', elementChance: 1, canCrit: false,
              procDepth: depth + 1, point: e.getBodyCenter(new THREE.Vector3()),
            });
          });
        });
      });
    },
  }),
  scroll({
    id: 'rx_vs_lock', name: '锁灵', rarity: 2, maxStacks: 3, tags: ['元素', '反应', '封脉'],
    description: '被「封脉」的敌人 4 秒内受到的元素伤害每层 +12%。',
    setup: (s, n, ctx) => {
      const until = new WeakMap<IEnemy, number>();
      /** 最晚的到期时刻：全场都过期时跳过 WeakMap 查询 */
      let latest = -1;
      s.on('enemy:reaction', (ev) => {
        if (ev.reaction !== 'veinseal') return;
        const t = ctx.time.now + 4;
        until.set(ev.enemy, t);
        latest = Math.max(latest, t);
      });
      s.outgoing((e, r) => {
        if (r.element === 'none') return 1;
        const now = ctx.time.now;
        return now < latest && now < (until.get(e) ?? 0) ? 1 + 0.12 * n : 1;
      });
    },
  }),
  scroll({
    id: 'rx_ab_mark', name: '三才印', rarity: 2, maxStacks: 3, tags: ['元素', '反应', '归墟', '命中'],
    description: '武器命中恰好身负两种元素状态的敌人时，每层 12% 概率补上第三种（引发「归墟」）。',
    setup: (s, n, ctx) => {
      s.on('enemy:damaged', ({ enemy, result }) => {
        const req = result.request;
        if (!isWeaponReq(req) || depthOf(req) !== 0 || result.killed || !enemy.alive) return;
        if (statusCount(enemy) !== 2 || !s.ready('m', 0.1) || !ctx.rng.chance(0.12 * n)) return;
        let missing: StatusId | null = null;
        for (let i = 0; i < ELEM.length; i++) {
          if (!enemy.statuses.has(ELEM[i])) {
            missing = ELEM[i];
            break;
          }
        }
        if (!missing) return;
        ctx.combat.applyStatus(enemy, missing, asStatusPower(ctx, enemy, missing, result.dealt), undefined, {
          depth: 0, weaponUid: req.weaponUid,
        });
      });
    },
  }),

  // ───────────── 稀有 · 英雄专属 ─────────────
  heroCatalyst(
    'fox_thunderfire', '狐火引雷', 'fox', 'burn', 'shock', 'thunderfire',
    ['英雄', '反应', '焚雷', '灼烧', '雷殛'],
    '技能附加灼烧时，每层 30% 概率同时附加雷殛（引发「焚雷」）；「焚雷」伤害每层 +10%。',
  ),
  heroCatalyst(
    'falcon_veinseal', '蚀羽惊雷', 'falcon', 'shock', 'corrode', 'veinseal',
    ['英雄', '反应', '封脉', '雷殛', '蚀化'],
    '技能附加雷殛时，每层 30% 概率同时附加蚀化（引发「封脉」）；「封脉」伤害每层 +10%。',
  ),
  scroll({
    id: 'bear_magma', name: '熔岩撼地', rarity: 2, maxStacks: 3, heroOnly: 'bear', tags: ['英雄', '反应', '熔金', '技能'],
    description: '裂地重击（E）命中的敌人依次附加灼烧与蚀化（强度为该次伤害的 40%），引发「熔金」；「熔金」伤害每层 +10%。',
    setup: (s, n, ctx) => {
      // E 先跃起、落地才砸（最长约 1.8 秒）：释放后 2.2 秒内的第一次物理技能命中开一个 0.05 秒窗口，
      // 窗口内（同一次砸地的全部命中）都附加灼烧 + 蚀化，窗口过后解除
      let armedUntil = -1;
      let windowEnd = -1;
      s.on('skill:used', ({ slot }) => {
        if (slot !== 'secondary') return;
        armedUntil = ctx.time.now + 2.2;
        windowEnd = -1;
      });
      s.on('enemy:damaged', ({ enemy, result }) => {
        const now = ctx.time.now;
        if (now >= armedUntil) return;
        const req = result.request;
        if (!isSkillReq(req) || req.element !== 'none' || result.killed || !enemy.alive) return;
        if (windowEnd < 0) windowEnd = now + 0.05;
        if (now > windowEnd) {
          armedUntil = -1;
          return;
        }
        const power = Math.min(0.4 * result.dealt, enemy.maxHp * 0.5);
        if (!(power > 0)) return;
        // 沿用砸地命中的深度（0）：引发的熔金是直接反应，金乌坠 / 熔铸对它生效（理由同 leadScroll）
        const depth = depthOf(req);
        ctx.combat.applyStatus(enemy, 'burn', asStatusPower(ctx, enemy, 'burn', power), undefined, { depth });
        ctx.combat.applyStatus(enemy, 'corrode', asStatusPower(ctx, enemy, 'corrode', power), undefined, { depth });
      });
      boostReaction(s, 'meltdown', 1 + 0.1 * n);
    },
  }),

  // ───────────── 史诗 ─────────────
  scroll({
    id: 'rx_tf_capstone', name: '焚天雷狱', rarity: 3, maxStacks: 2, tags: ['元素', '反应', '焚雷'],
    description: '「焚雷」伤害每层 +20%；被「焚雷」波及的其他敌人额外附加雷殛，从而接连引发「焚雷」。',
    setup: (s, n, ctx) => {
      boostReaction(s, 'thunderfire', 1 + 0.2 * n);
      s.on('enemy:reaction', (ev) => {
        if (ev.reaction !== 'thunderfire' || ev.depth !== 0) return;
        // 焚雷已给周围点上灼烧（depth 1），这里补雷殛 → 周围敌人各自引发次级焚雷（受冷却限制）
        const power = 0.3 * ev.base;
        if (!(power > 0)) return;
        _o.copy(ev.point);
        forEachNear(ctx, _o, blastR(s, 3), ev.enemy, (e) => {
          ctx.combat.applyStatus(e, 'shock', asStatusPower(ctx, e, 'shock', power), undefined, { depth: 1 });
        });
      });
    },
  }),
  scroll({
    id: 'rx_mg_capstone', name: '金乌坠', rarity: 3, maxStacks: 2, tags: ['元素', '反应', '熔金', '爆炸'],
    description: '「熔金」留下的熔池在 1.5 秒后坍缩爆炸，对 3.5 米内造成「熔金」威力每层 60% 的火焰伤害；对无护甲敌人的「熔金」伤害每层 +25%。',
    setup: (s, n, ctx) => {
      s.on('enemy:reaction', (ev) => {
        if (ev.reaction !== 'meltdown' || ev.depth !== 0) return;
        const p = ev.point.clone();
        const b = ev.base;
        const d = ev.depth;
        // 非常驻延时：换关自动取消
        ctx.tasks.delay(1.5, () => {
          const r = blastR(s, 3.5);
          const big = scrollBigFx(ctx);
          ctx.combat.explode(p, r, {
            base: 0.6 * n * b, element: 'fire', source: 'scroll', canCrit: false, procDepth: d + 1,
          }, { color: MG_COLLAPSE_COLOR, noFx: !big });
          if (!big) {
            // 超出本帧大爆炸预算：轻量表现（火星 + 地面光环）
            const gy = ctx.world.groundHeight(p.x, p.z, p.y + 0.1);
            _g.set(p.x, Number.isFinite(gy) && p.y - gy < 3 ? gy + 0.05 : p.y, p.z);
            ctx.fx.burst(p, MG_COLLAPSE_COLOR, 18, 7, 0.45, 0.13, 2);
            ctx.fx.ring(_g, r, MG_COLLAPSE_COLOR, 0.4);
          }
        });
      });
      s.outgoing((e, r) => (e.armor <= 0 && rxTag(r, 'meltdown') ? 1 + 0.25 * n : 1));
    },
  }),
  scroll({
    id: 'rx_vs_capstone', name: '镇岳', rarity: 3, maxStacks: 2, tags: ['元素', '反应', '封脉', '控制'],
    description: '「封脉」造成的眩晕每层延长 0.4 秒，并额外放出每层 1 道电弧；首领被「封脉」后 6 秒内受到的伤害每层 +8%。',
    setup: (s, n, ctx) => {
      const bossUntil = new WeakMap<IEnemy, number>();
      let latest = -1;
      s.on('enemy:reaction', (ev) => {
        if (ev.reaction !== 'veinseal' || ev.depth !== 0) return;
        const center = ev.enemy;
        const now = ctx.time.now;
        _o.copy(ev.point);

        // 眩晕取较长值，相当于延长（精英由状态系统自动 ×0.75）
        if (ev.stunned && !center.isBoss && center.alive) {
          ctx.combat.applyStatus(center, 'stun', 0, 0.7 + 0.4 * n, { depth: ev.depth + 1 });
        }
        if (center.isBoss) {
          const t = now + 6;
          bossUntil.set(center, t);
          latest = Math.max(latest, t);
        }

        // 额外电弧：8 米内随机 n 名有视线的敌人
        _buf.length = 0;
        const found = ctx.enemies.queryRadius(_o, 8, _buf);
        _cands.length = 0;
        for (let i = 0; i < found.length; i++) {
          const e = found[i];
          if (e !== center && e.alive) _cands.push(e);
        }
        _buf.length = 0;
        if (_cands.length === 0) return;
        ctx.rng.shuffle(_cands);
        let picked = 0;
        for (let i = 0; i < _cands.length && picked < n; i++) {
          if (ctx.world.segmentBlocked(_o, _cands[i].getBodyCenter(_q))) continue;
          _cands[picked++] = _cands[i];
        }
        _cands.length = picked;
        const arc = 0.3 * ev.base;
        const corrode = 0.35 * ev.base;
        const depth = ev.depth + 1;
        for (let i = 0; i < picked; i++) {
          const e = _cands[i];
          if (!e.alive) continue;
          ctx.fx.lightning(_o, e.getBodyCenter(_q), 0x5affd0);
          ctx.combat.damageEnemy(e, { base: arc, element: 'shock', source: 'scroll', canCrit: false, procDepth: depth });
          if (e.alive) ctx.combat.applyStatus(e, 'corrode', asStatusPower(ctx, e, 'corrode', corrode), undefined, { depth: 1 });
        }
        _cands.length = 0;
      });
      s.outgoing((e) => {
        const now = ctx.time.now;
        return now < latest && now < (bossUntil.get(e) ?? 0) ? 1 + 0.08 * n : 1;
      });
    },
  }),
  scroll({
    id: 'rx_ab_amp', name: '归真', rarity: 3, maxStacks: 2, tags: ['元素', '反应', '归墟', '击杀'],
    description: '「归墟」伤害每层 +30%；「归墟」击杀敌人时，向 8 米内最近的 2 名敌人各附加两种随机元素状态（强度为「归墟」威力的每层 15%）。',
    setup: (s, n, ctx) => {
      boostReaction(s, 'abyss', 1 + 0.3 * n);
      let lastAbyssBase = 0;
      s.on('enemy:reaction', (ev) => {
        if (ev.reaction === 'abyss') lastAbyssBase = ev.base;
      });
      s.on('enemy:killed', ({ enemy, result }) => {
        const req = result.request;
        if (!rxTag(req, 'abyss')) return;
        const depth = depthOf(req);
        if (depth >= 2) return;
        const c = bodyCenter(enemy, _p).clone();
        // 归墟伤害在 flush 里结算，'enemy:killed' 早于该次 'enemy:reaction'：
        // 推迟到本帧任务阶段，lastAbyssBase 已是造成这次击杀的那次归墟的威力
        const fallback = req.base * 3;
        ctx.tasks.delay(0, () => {
          const base = 0.15 * n * (lastAbyssBase > 0 ? lastAbyssBase : fallback);
          if (!(base > 0)) return;
          const spread = (e: IEnemy): void => {
            ctx.rng.shuffle(_trio);
            for (let i = 0; i < 2 && e.alive; i++) {
              ctx.combat.applyStatus(e, _trio[i], asStatusPower(ctx, e, _trio[i], base), undefined, { depth });
            }
          };
          // 死者已不存活，nearestOther 会自动跳过它；第二次排除第一名
          const first = nearestOther(ctx, c, 8, enemy);
          if (!first) return;
          const second = nearestOther(ctx, c, 8, first);
          spread(first);
          if (second) spread(second);
        });
      });
    },
  }),

  // ───────────── 传说 ─────────────
  scroll({
    id: 'rx_hunyuan', name: '混元', rarity: 4, maxStacks: 1, tags: ['元素', '反应', '传说', '风险'],
    description: '元素反应伤害 +60%，元素反应急速 +40%；但受到的伤害 +25%，护盾上限 −30。',
    setup: (s) => {
      s.stat('reactionDamagePct', 0.6);
      s.stat('reactionHaste', 0.4);
      s.stat('maxShield', -30);
      s.incoming(() => 1.25);
    },
  }),
  scroll({
    id: 'rx_kalpa', name: '劫火', rarity: 4, maxStacks: 1, tags: ['元素', '反应', '归墟', '传说', '风险'],
    description: '每引发 10 次元素反应，向准星所指的敌人降下「三相天劫」：直接引发一次「归墟」（无需元素状态）；但元素触发率 −8%。',
    setup: (s, _n, ctx) => {
      s.stat('elementChancePct', -0.08);
      let count = 0;
      s.on('enemy:reaction', (ev) => {
        if (ev.origin === 'forced') return;
        if (++count < 10) return;
        const p = ctx.player;
        if (!p.alive) return;
        let target = ctx.enemies.raycast(p.eye, p.getAimDirection(_dir), 30)?.enemy ?? null;
        if (!target || !target.alive) target = ctx.enemies.nearest(p.position, 15);
        if (!target || !target.alive) return;   // 没有目标：保留计数，下次反应再降
        const ok = ctx.combat.triggerReaction(target, 'abyss', 100 * procScale(ctx), { depth: 0, ignoreIcd: true, tag: 'kalpa' });
        if (!ok) return;                         // 被预算拒绝：同上
        count = 0;
        target.getBodyCenter(_q);
        for (let i = 0; i < 3; i++) {
          // 纯视觉随机：三道天雷从目标上方 12 米略微错开劈下
          const a = (i * Math.PI * 2) / 3 + Math.random() * 0.6;
          _p.set(_q.x + Math.cos(a) * 0.8, _q.y + 12, _q.z + Math.sin(a) * 0.8);
          ctx.fx.lightning(_p, _q, KALPA_COLORS[i]);
        }
        ctx.audio.play('boss_slam', { volume: 0.6, pitch: 1.3 });
      });
    },
  }),
];
