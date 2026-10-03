/**
 * 人形骨骼（HumanoidRig）的绑定姿势约定 —— 美术管线与运行时共用。
 *
 * 程序动画的「零旋转」是手臂垂直下垂的静止姿势；美术资产按 A-pose 绑定（上臂外展 BIND_ARM_SPREAD），
 * 这样腋下和躯干在建模、蒙皮时是分开的。导出白模（src/dev/artExport.ts）与运行时绑定蒙皮
 * （src/assets/SkinnedBody.ts）都调用 applyBindPose，保证两边的绑定姿势完全相同。
 */
import type { HumanoidRig } from '../enemies/Models';

/** 绑定姿势：上臂外展角（弧度） */
export const BIND_ARM_SPREAD = 0.45;

/** 作为骨骼导出的关节；名字即骨骼名（GLB 里 skin.joints 的节点名） */
export const HUMANOID_JOINTS = [
  'hips', 'torso', 'head',
  'armL', 'elbowL', 'handL', 'armR', 'elbowR', 'handR',
  'legL', 'kneeL', 'legR', 'kneeR',
] as const;
export type HumanoidJoint = (typeof HUMANOID_JOINTS)[number];

/**
 * 摆成绑定姿势：所有关节零旋转、髋部回到基准高度，上臂外展。
 * 白模导出用默认角；美术资产经过「骨骼适配网格」后，清单里会带各自实测的左右外展角（AssetEntry.bindPose）。
 */
export function applyBindPose(rig: HumanoidRig, spreadL = BIND_ARM_SPREAD, spreadR = spreadL): void {
  for (const k of HUMANOID_JOINTS) rig[k].rotation.set(0, 0, 0);
  rig.hips.position.y = rig.hipY;
  rig.armL.rotation.z = spreadL;
  rig.armR.rotation.z = -spreadR;
}

export function isHumanoidRig(x: unknown): x is HumanoidRig {
  const r = x as Partial<HumanoidRig> | null | undefined;
  return !!r && HUMANOID_JOINTS.every((k) => !!(r as Record<string, unknown>)[k]) && typeof r.hipY === 'number';
}
