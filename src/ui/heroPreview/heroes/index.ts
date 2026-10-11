/**
 * 英雄展示模型注册表：hero.id → 模型。
 *
 * 优先级：
 *  1. 美术资产库里绑定到该英雄、且为原生骨骼（manifest `skeleton.mode = 'native'`，Tripo + Mixamo）的发布资产
 *     → nativeTripo.ts 直接驱动资产自带骨骼；
 *  2. 旧式部件骨架资产（manifest `rig.mode = 'parts'`）→ 套到程序化骨架上（artBody.ts，兼容旧发布）；
 *  3. 程序化模型（资产未加载完 / 加载失败 / ?classic）；未知 id 用占位模型。
 */
import type { HeroModelFactory, HeroRig } from './types';
import { buildFoxModel } from './fox';
import { buildFalconModel } from './falcon';
import { buildBearModel } from './bear';
import { buildPlaceholderHero } from './placeholder';
import { AssetLibrary, type LoadedAsset } from '../../../assets/AssetLibrary';
import { withHeroArt } from './artBody';
import { createNativeHero } from './nativeTripo';

export type { HeroRig } from './types';

const FACTORIES: Record<string, HeroModelFactory> = {
  fox: buildFoxModel,
  falcon: buildFalconModel,
  bear: buildBearModel,
};

/** 该英雄当前可用的发布资产（未加载完 / 失败 / ?classic 时为 null） */
export function heroAsset(id: string): LoadedAsset | null {
  return AssetLibrary.findBound('hero', id);
}

/** 程序化模型（不使用任何美术资产）：对照 / 回退用 */
export function buildProceduralHero(id: string, color?: number): HeroRig {
  const f = FACTORIES[id];
  return f ? f() : buildPlaceholderHero(color);
}

export function buildHeroModel(id: string, color?: number): HeroRig {
  const f = FACTORIES[id];
  if (!f) return buildPlaceholderHero(color);
  const asset = heroAsset(id);
  if (asset?.entry.skeleton?.mode === 'native') {
    try {
      const b = asset.entry.bounds;
      const rig = createNativeHero(id, asset.gltf.scene, { lodDistance: asset.entry.lodDistance, height: b.max[1] - b.min[1] });
      if (rig) return rig;
    } catch (err) {
      console.warn(`[heroes] ${asset.id} 原生骨骼模型创建失败，改用程序化模型`, err);
    }
    return f();
  }
  const rig = f();
  return asset?.entry.rig ? withHeroArt(rig, asset) : rig;
}
