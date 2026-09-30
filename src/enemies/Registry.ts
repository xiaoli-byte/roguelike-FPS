import type { EnemyDef, GameContext, SpawnOptions } from '../core/types';
import type { EnemyBase } from './EnemyBase';

/** 敌人工厂：由敌人类型模块 / Boss 模块在启动时注册 */
export type EnemyFactory = (ctx: GameContext, opts: SpawnOptions) => EnemyBase;

interface Entry {
  def: EnemyDef;
  factory: EnemyFactory;
}

const registry = new Map<string, Entry>();

export function registerEnemy(def: EnemyDef, factory: EnemyFactory): void {
  if (registry.has(def.id)) console.warn(`[Registry] enemy "${def.id}" registered twice, overriding`);
  registry.set(def.id, { def, factory });
}

export function getEnemyEntry(id: string): Entry | undefined {
  return registry.get(id);
}

export function getEnemyDef(id: string): EnemyDef | undefined {
  return registry.get(id)?.def;
}

export function allEnemyIds(): string[] {
  return Array.from(registry.keys());
}
