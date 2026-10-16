/**
 * 第三章「连环爆」：炮仗傀儡和神火飞鸦共用的爆炸连锁（docs/art/enemy-roster-v2.md 第三章 · 炮仗傀儡 / 神火飞鸦）。
 *
 * 两种火药怪各自的死亡爆炸走同一个入口 chainBlast，区别只在「同类怎么处理」：
 * - 'detonate'（炮仗傀儡死时火箭箱炸开）：半径内的其他火药怪（傀儡、飞鸦）不论血量直接被引爆，按离爆心由近到远
 *   一只接一只炸（每跳间隔 CHAIN.hop，读得出是连锁）；其余敌人吃一次火药伤害 + 击退（能把地面怪推进熔岩）。
 * - 'damage'（神火飞鸦在空中被打爆）：半径内所有敌人（含同类）吃一次伤害。飞鸦只有约 20 血，旁边的飞鸦被炸死后
 *   自己再炸，连锁自然往下传；傀儡血厚，只是掉血。
 *
 * 爆炸对敌人的伤害走玩家方伤害管线（ctx.combat.explode：算玩家的战果、带 'explosion' 标签），并且延后 CHAIN.settle 秒
 * 结算，不在触发它的那次伤害结算里递归。被引爆的火药怪用「处决」级伤害（基础 1e6，不弹数字，照常算击杀、掉落）。
 * 全部跳过 attackDirector.purging（清场时不连锁）。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { attackDirector } from '../AttackTokens';

/** 会被连锁引爆的火药怪（炮仗傀儡、神火飞鸦） */
export interface ExplosiveKin extends IEnemy {
  readonly explosiveKin: true;
  /** 被同伴的爆炸引爆：delay 秒后当场炸死（每只只会被安排一次） */
  chainDetonate(delay: number): void;
}

export function isExplosiveKin(e: IEnemy): e is ExplosiveKin {
  return (e as Partial<ExplosiveKin>).explosiveKin === true;
}

export const CHAIN = {
  /** 爆炸对敌人的结算延后（秒）：离开触发它的伤害结算 */
  settle: 0.06,
  /** 连锁引爆：第一只的延迟与后面每只追加的间隔（秒） */
  hop: 0.14,
  hopStep: 0.07,
  /** 处决级伤害（Combat 的 EXECUTE_BASE）：不弹伤害数字，照常算击杀 */
  execute: 1e6,
} as const;

export interface ChainBlastSpec {
  center: THREE.Vector3;
  radius: number;
  /** 对其他敌人的基础伤害（已含等级 / 精英倍率）与击退（米/秒，随距离衰减） */
  base: number;
  knockback: number;
  mode: 'detonate' | 'damage';
  /** 爆炸的主人（自己不吃自己的爆炸） */
  source: IEnemy;
}

const _c = new THREE.Vector3();

/** 半径内活着的火药怪（不含 source），按离爆心由近到远 */
export function kinInRadius(ctx: GameContext, center: THREE.Vector3, radius: number, source: IEnemy | null): ExplosiveKin[] {
  const out: { e: ExplosiveKin; d: number }[] = [];
  for (const e of ctx.enemies.list) {
    if (e === source || !e.alive || !isExplosiveKin(e)) continue;
    const d = e.getBodyCenter(_c).distanceTo(center);
    if (d <= radius + e.radius) out.push({ e, d });
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.e);
}

/** 火药怪死亡爆炸对其他敌人的结算（外观与对玩家的伤害由调用方负责） */
export function chainBlast(ctx: GameContext, s: ChainBlastSpec): void {
  if (attackDirector.purging) return;
  const center = s.center.clone();
  ctx.tasks.delay(CHAIN.settle, () => {
    if (attackDirector.purging) return;
    const exclude = new Set<IEnemy>([s.source]);
    const kin = s.mode === 'detonate' ? kinInRadius(ctx, center, s.radius, s.source) : [];
    for (const e of kin) exclude.add(e);
    ctx.combat.explode(center, s.radius, {
      base: s.base, element: 'none', source: 'explosion', procDepth: 1, canCrit: false, knockback: s.knockback,
    }, { playerDamage: 0, noFx: true, exclude, falloff: 0.5 });
    kin.forEach((e, i) => e.chainDetonate(CHAIN.hop + i * CHAIN.hopStep));
  });
}

/** 把一只火药怪当场炸死（处决级伤害：不弹数字，算玩家击杀、正常掉落；它自己的 onDeath 负责爆炸） */
export function detonateKin(ctx: GameContext, e: IEnemy): void {
  if (!e.alive || attackDirector.purging) return;
  ctx.combat.damageEnemy(e, {
    base: CHAIN.execute, element: 'none', source: 'explosion', procDepth: 1, canCrit: false, bypassShield: true, tags: ['explosion'],
  });
}
