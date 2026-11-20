/**
 * 灵宠伤害源的战斗契约（Unity DamageSource.Pet / DamageTag.Pet / Combat.ForceWeakpoint，docs/pet-system.md）。
 * 灵宠本体（8 只、跟随、攻击 / 被动 / G 技能）是 M9；这里只定它们打出来的伤害怎么进战斗管线：
 *   · 来源 'pet'（或带 'pet' 标签）：属性只乘「灵宠伤害」petDamagePct（不吃武器 / 技能 / 爆炸伤害），元素 / 精英 / 首领类照常；
 *   · 默认不随机暴击（灵宠自己决定 forceCrit：狰、白泽）；命中弱点照样必暴、吃「弱点伤害」；
 *   · 不吸血（吸血只认武器直接伤害）、不触发顿帧（HitStop 只认玩家的武器 / 技能 / 近战 / 爆炸 / 秘卷）；
 *   · 「改判为弱点」（神兽白泽「万鬼图」）：登记一个判断，玩家的武器 / 技能 / 爆炸直接命中任一返回 true 即按弱点算——
 *     只影响暴击与弱点加成，敌人机制（琵琶、正面格挡、破防条的弱点填充）仍看 req.headshot。
 * 纯逻辑，不 import 任何模块之外的东西（Combat 读它）。
 */
import type { DamageRequest, Element, IEnemy } from '../core/types';

/** 灵宠伤害的标签（Unity DamageTag.Pet） */
export const PET_TAG = 'pet';

/** 灵宠一击的伤害请求：来源 'pet'、不随机暴击、带 'pet' 标签 */
export function petHit(base: number, element: Element = 'none', elementChance = 0): DamageRequest {
  return { base, element, source: 'pet', elementChance, canCrit: false, tags: [PET_TAG], procDepth: 0 };
}

/** 「改判为弱点」的判断：返回 true = 这一击按弱点算 */
export type ForceWeakpoint = (enemy: IEnemy, req: DamageRequest) => boolean;

const forceWeakpoints: ForceWeakpoint[] = [];

/** 登记一个「改判为弱点」的判断；返回撤销函数 */
export function addForceWeakpoint(fn: ForceWeakpoint): () => void {
  forceWeakpoints.push(fn);
  return () => {
    const i = forceWeakpoints.indexOf(fn);
    if (i >= 0) forceWeakpoints.splice(i, 1);
  };
}

/** 现在登记了几个 */
export function forceWeakpointCount(): number {
  return forceWeakpoints.length;
}

/**
 * 这一击是否被改判为弱点（Unity Combat.DamageEnemy 开头）：已经是弱点、反应伤害、不是武器 / 技能 / 爆炸来源的不判；
 * 判断抛错只报错、跳过那一个。
 */
export function forcedWeakpoint(enemy: IEnemy, req: DamageRequest, reaction: boolean): boolean {
  if (forceWeakpoints.length === 0 || req.headshot || reaction) return false;
  if (req.source !== 'weapon' && req.source !== 'skill' && req.source !== 'explosion') return false;
  for (let i = 0; i < forceWeakpoints.length; i++) {
    try {
      if (forceWeakpoints[i](enemy, req)) return true;
    } catch (err) {
      console.error('[Combat] force-weakpoint threw', err);
    }
  }
  return false;
}

/** 清空（测试 / 新开一局） */
export function clearForceWeakpoints(): void {
  forceWeakpoints.length = 0;
}
