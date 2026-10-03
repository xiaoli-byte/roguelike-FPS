/**
 * 英雄展示模型契约（英雄选择 3D 舞台用）。
 *
 * 坐标约定（与 enemies/Models.ts 一致）：脚底中心在原点，面朝 +Z，Y 向上，单位米；
 * 角色右侧为 −X。站立高度约 1.75–2.2 米（岩熊最高最壮）。
 */
import type * as THREE from 'three';

export interface HeroRig {
  readonly root: THREE.Group;
  /** 站立总高（含耳朵 / 头冠等），用于取景 */
  readonly height: number;
  /**
   * 右手持枪挂点：原点 = 握把顶部（持枪手位置），本地 −Z = 枪口方向，+Y 向上。
   * 与 weapons/WeaponModels.buildGunModel 的原点约定一致，枪模按 1:1（米）挂上即可。
   */
  readonly hand: THREE.Object3D;
  /**
   * 本模型自建的全部材质（每次 build 都是新实例，不与他人共享）。
   * 预览台会改它们的 transparent / opacity 做淡入淡出，并在 dispose 时释放。
   */
  readonly materials: readonly THREE.Material[];
  /** 每帧更新：待机动画（呼吸、尾巴、耳朵…）与亮相动作。dt 已夹到 ≤ 0.05；t 为累计秒数 */
  update(dt: number, t: number): void;
  /** 播放一次亮相动作（约 1–1.5 秒，结束后自然回到待机） */
  playIntro(): void;
  /** 释放本模型自建的几何体与材质（不释放 enemies/Models 等模块的共享缓存几何体） */
  dispose(): void;
}

export type HeroModelFactory = () => HeroRig;
