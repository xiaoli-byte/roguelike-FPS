import type { ScaledEnemyDef } from '../EnemyBase';
import { registerEnemy } from '../Registry';
import { FOE_SPECS } from '../../world/plateau/play/foes';
import type { MonsterKind } from '../../world/plateau/spec';
import { MONSTER_NAMES } from '../../world/plateau/spec';
import { PlateauFoeAdapter } from './PlateauFoeAdapter';

export const PLATEAU_ENEMY_IDS = ['marmot', 'tiangou', 'aoyin', 'jufu', 'manman', 'liangu', 'dijiang', 'qiongqi'] as const;

const DIMENSIONS: Record<(typeof PLATEAU_ENEMY_IDS)[number], { radius: number; height: number; headY: number; damage: number }> = {
  marmot: { radius: 0.45, height: 1.1, headY: 0.9, damage: 6 },
  tiangou: { radius: 0.65, height: 1.6, headY: 1.25, damage: 12 },
  aoyin: { radius: 1.8, height: 3.6, headY: 2.8, damage: 20 },
  jufu: { radius: 0.75, height: 2.5, headY: 2.1, damage: 14 },
  manman: { radius: 0.6, height: 1.4, headY: 1.1, damage: 9 },
  liangu: { radius: 1.6, height: 1.4, headY: 0.5, damage: 10 },
  dijiang: { radius: 0.75, height: 1.3, headY: 0.8, damage: 16 },
  qiongqi: { radius: 1.3, height: 2.5, headY: 2.0, damage: 22 },
};

let registered = false;
export function registerPlateauEnemies(): void {
  if (registered) return;
  registered = true;
  for (const id of PLATEAU_ENEMY_IDS) {
    const spec = FOE_SPECS[id as MonsterKind];
    const dimensions = DIMENSIONS[id];
    const def: ScaledEnemyDef = {
      id, name: MONSTER_NAMES[id as MonsterKind], hp: spec.hp, speed: spec.speed, damage: dimensions.damage,
      radius: dimensions.radius, height: dimensions.height, headY: dimensions.headY,
      headRadius: Math.min(0.45, dimensions.radius * 0.4), knockbackResist: id === 'aoyin' || id === 'qiongqi' ? 0.8 : 0.25,
      flying: id === 'manman' || id === 'liangu', coins: [2, 5], essence: 1, color: 0xff4fd8,
    };
    registerEnemy(def, (ctx, opts) => new PlateauFoeAdapter(ctx, def, opts));
  }
}
