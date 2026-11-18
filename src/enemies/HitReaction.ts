/**
 * 受击四层（Unity G/Enemies/HitReaction.cs + Poise.cs；第四章 combat 1.1，docs/unity-ch4-port.md 第 2 节契约）：
 *   受击（闪白 + 数字）→ 抖动（韧性未破）→ 硬直（韧性破）→ 眩晕（反制 / 破防 / 封脉）。
 * 数值和韧性规则在这里（纯逻辑，tests/enemy-framework.test.mjs 直接加载）；状态和表现在 StandardEnemy：
 *   · 硬直 hitStagger(秒, 来向, 原因)：打断招式、撤预警、停摆；霸体（superArmor）时不进。
 *   · 眩晕 hitStun(秒, 原因)：走元素眩晕（精英 ×0.75），期间受伤 × STUN_TAKEN_MULT。
 *   · 顿一下 hitch(秒)：轻怪每挨一枪停一小下，不打断招式。
 *   · 韧性：def.poise > 0 的敌人按 poiseDamage 累计，满了调硬直；前三章的敌人韧性都是 0，不走这条。
 */

/** 受击的哪一层 */
export type HitLayer = 'flinch' | 'jolt' | 'stagger' | 'stun';
/** 硬直 / 眩晕从哪来：韧性破、专属反制、破防、元素反应（封脉）、场地 / 剧本 */
export type HitCause = 'poise' | 'counter' | 'break' | 'reaction' | 'script';

/** 韧性的累计窗口：每秒回落韧性值的一半（2 秒内累计超过韧性才硬直） */
export const POISE_DECAY_PER_SECOND = 0.5;
/** 韧性伤害倍率：弱点 ×2，爆炸 / 反应 ×3 */
export const WEAK_POISE = 2;
export const BLAST_POISE = 3;
/** 眩晕期间受伤倍率（+25%） */
export const STUN_TAKEN_MULT = 1.25;
/** 定义没写硬直秒数时（Unity EnemyDef.staggerSeconds 初值） */
export const DEFAULT_STAGGER_SECONDS = 0.6;

/** 与 core/types 的 REACTION_TAG 同值（这里不引 core/types，测试直接加载本文件） */
const REACTION = 'reaction';

/** 判定韧性伤害所需的请求字段（DamageRequest 的子集） */
export interface PoiseHit {
  source: string;
  tags?: readonly string[];
  headshot?: boolean;
}

function tagged(h: PoiseHit, tag: string): boolean {
  return !!h.tags && h.tags.includes(tag);
}

/** 反应伤害（带反应标签） */
export function isReactionHit(h: PoiseHit): boolean {
  return tagged(h, REACTION);
}

/** 持续伤害（Unity Poise：source Status 且不是反应）：不算顿一下，也不算韧性 */
export function isDotHit(h: PoiseHit): boolean {
  return h.source === 'status' && !isReactionHit(h);
}

/** 爆炸 / 反应（Unity PlateauEnemyAI.IsBlast：死法、韧性 ×3） */
export function isBlastHit(h: PoiseHit): boolean {
  return h.source === 'explosion' || tagged(h, 'explosion') || isReactionHit(h);
}

/** 一次伤害的韧性伤害：持续伤害 0；反应 / 爆炸 ×3；弱点 ×2；其余 ×1（Unity HitReaction.PoiseDamage） */
export function poiseDamage(h: PoiseHit, dealt: number): number {
  if (!(dealt > 0)) return 0;
  const reaction = isReactionHit(h);
  if (h.source === 'status' && !reaction) return 0;
  if (reaction || h.source === 'explosion' || tagged(h, 'explosion')) return dealt * BLAST_POISE;
  if (h.headshot) return dealt * WEAK_POISE;
  return dealt;
}

/**
 * 韧性计量（Unity PoiseMeter）：累计韧性伤害，每秒回落韧性值的 POISE_DECAY_PER_SECOND（= 2 秒窗口），
 * 超过韧性就清零并返回「破了」。韧性 ≤ 0 或 +∞ 时永远不破
 */
export class PoiseMeter {
  value = 0;

  constructor(public poise = 0) {}

  /** 能不能破（韧性有限且 > 0） */
  get breakable(): boolean {
    return this.poise > 0 && this.poise !== Infinity;
  }

  /** 加一次韧性伤害；破了返回 true（并清零） */
  add(amount: number): boolean {
    if (!this.breakable || !(amount > 0) || !Number.isFinite(amount)) return false;
    this.value += amount;
    if (this.value < this.poise) return false;
    this.value = 0;
    return true;
  }

  /** 回落 dt 秒 */
  tick(dt: number): void {
    if (this.value > 0 && this.breakable && dt > 0) this.value = Math.max(0, this.value - this.poise * POISE_DECAY_PER_SECOND * dt);
  }
}
