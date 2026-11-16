/**
 * 首领看得到的关卡钩子（docs/threejs-migration.md M6）：场景视图（world/UnityEnvironment、world/UnityWater）建好时登记，卸载时撤掉；
 * 首领只经这里读写太阳 / 环境光 / 雾 / 水，不伸手进场景视图的内部。没有登记（老关卡、检视页）时首领照常打，只是太阳不动、没有泉水可吸。
 */
import type * as THREE from 'three';

/** 场景主光与环境（UnityEnvironmentView 登记） */
export interface StageSunHook {
  readonly scene: THREE.Scene;
  /** 主方向光（太阳）：朝向 = position − target.position 的反方向 */
  readonly light: THREE.DirectionalLight;
  /** 环境光（Ambient / Hemisphere），日蚀时跟着压暗 */
  readonly ambients: readonly THREE.Light[];
}

/** 一段水（UnityWaterView 登记） */
export interface StageWaterBody {
  readonly name: string;
  /** 月牙泉的水（spring 标记，或名字里带 CrescentSpring / Crescent Spring） */
  readonly spring: boolean;
  readonly center: THREE.Vector3;
  readonly scale: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** 底面高度（世界 y） */
  readonly bottom: number;
}

export interface StageWaterHook {
  waterBodies(): readonly StageWaterBody[];
  /** p 处的水深（米，所有水段里最深的；springOnly = 只看月牙泉） */
  depthAt(p: THREE.Vector3, springOnly?: boolean): number;
  /** 月牙泉此刻的水位（1 = 原水深，0 = 吸干；没有泉水为 NaN） */
  springLevel(): number;
  /** seconds 秒内把月牙泉的水位变到 target（0 吸干 / 1 复涌）；吸的过程中水珠飘向 sink */
  springTo(target: number, seconds: number, sink?: THREE.Vector3 | null): void;
}

export const stageHooks: { sun: StageSunHook | null; water: StageWaterHook | null } = { sun: null, water: null };

/** Unity HanbaSpring.IsSpringWater 的名字标记 */
export function isSpringWater(name: string, flag = false): boolean {
  return flag || /crescent ?spring/i.test(name);
}
