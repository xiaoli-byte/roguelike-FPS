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
  /** Semantic controls used to adapt authored art to the display rig. */
  readonly artControls?: {
    rightArm?: THREE.Object3D;
    rigidGroups?: readonly THREE.Object3D[];
    tailFlames?: readonly THREE.Object3D[];
    skinJoints?: readonly THREE.Object3D[];
  };
  /**
   * 专属演出（heroShows.ts）：没有时按旧约定（光柱升起、到位后约 1.5 秒亮相）。
   * entrance：'rise' = 预览台让英雄从光柱升起；'self' = 模型自己入场（空降 / 滑翔），预览台直接显形。
   * 两种都在开始入场时立刻 playIntro（出场动作自己包含「冒出光柱」那一段）；intro = 出场时长（秒），
   * frameFrom = 出场中从第几秒起计入取景（之前在画外）。
   */
  readonly show?: { entrance: 'rise' | 'self'; intro: number; frameFrom: number };
  /** 每帧更新：待机动画（呼吸、尾巴、耳朵…）与亮相动作。dt 已夹到 ≤ 0.05；t 为累计秒数 */
  update(dt: number, t: number): void;
  /** 播放一次亮相动作（约 1–1.5 秒，结束后自然回到待机） */
  playIntro(): void;
  /** 释放本模型自建的几何体与材质（不释放 enemies/Models 等模块的共享缓存几何体） */
  dispose(): void;
}

export type HeroModelFactory = () => HeroRig;
