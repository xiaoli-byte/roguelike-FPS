/**
 * 英雄展示模型注册表：hero.id → 模型工厂。未知 id 用占位模型。
 */
import type { HeroModelFactory, HeroRig } from './types';
import { buildFoxModel } from './fox';
import { buildFalconModel } from './falcon';
import { buildBearModel } from './bear';
import { buildPlaceholderHero } from './placeholder';

export type { HeroRig } from './types';

const FACTORIES: Record<string, HeroModelFactory> = {
  fox: buildFoxModel,
  falcon: buildFalconModel,
  bear: buildBearModel,
};

export function buildHeroModel(id: string, color?: number): HeroRig {
  const f = FACTORIES[id];
  return f ? f() : buildPlaceholderHero(color);
}
