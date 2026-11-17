/**
 * 熔心魔将的关键姿势库 + 片段表（art/source/characters/SK_Boss_Warlord/anim/warlord_poses.py 逐项照搬；骨架无关的纯数据，不 import three）。
 * Unity 的 Keyframed/<状态>.fbx 是 Blender 按这张表解算、烘焙出来的；11-07 v006 换骨架之后旧的采样片段（public/assets/anim）全部作废，
 * 网页不再读片段文件，而是在载入正式模型后按同一张表、同一套解算（WarlordPoser.ts，照 warlord_anims_humanoid.py 的 build）现场烘焙关键帧。
 *
 * 姿势写法（角色坐标：right = 角色右手方向，fwd = 前，up = 上）：
 *   drop / fwd 全身下沉 / 前移（米），pitch / twist / roll 上身前倾 / 转向左 / 侧弯（度，spine 40% + chest 60%），hips 髋前倾，head [俯仰, 转头]，
 *   yaw 全身绕竖轴转（度），arm_R / fore_R / arm_L / fore_L 四肢方向，grip 右拳 IK 到两肩中点的偏移（米），sword 剑身方向，edge 剑刃朝向，
 *   grip_L 左手握剑柄，feet 脚掌落点（相对静止姿势的 [右, 前, 上] 偏移，IK），air / legs 悬空腿 [大腿前抬, 小腿弯]（度），cape 披风（人形骨架没有，忽略）。
 * 片段：frames 总帧数（30 fps）；keys [帧, 姿势]；events [帧, 事件名]；next 连段的下一个状态；loop 循环；speed 步态对应的移动速度（米/秒）。
 * 出手事件的帧位置是定稿的（WarlordDef 的 *At 按它拉伸片段，tests/warlord-boss.test.mjs 对 Unity 的 events.json 守着）。
 */

export type V3 = readonly [number, number, number];

export interface Pose {
  drop?: number; fwd?: number; pitch?: number; twist?: number; roll?: number; hips?: number; yaw?: number;
  head?: readonly [number, number];
  arm_R?: V3; fore_R?: V3; arm_L?: V3; fore_L?: V3;
  grip?: V3; sword?: V3; edge?: V3; grip_L?: boolean;
  feet?: { readonly R?: readonly number[]; readonly L?: readonly number[] };
  air?: boolean; legs?: readonly [number, number]; cape?: number;
}

export interface Clip {
  frames: number;
  keys: readonly (readonly [number, Pose])[];
  events: readonly (readonly [number, string])[];
  next?: string;
  loop?: boolean;
  speed?: number;
}

export const FPS = 30;

const P = (p: Pose): Pose => p;

// ───────────── 姿势库 ─────────────

// 底姿「双手斜持下段」：右拳握在剑格、左手握剑首，双手收在右胯前，剑身从右胯斜指左前下方、剑尖离地约半米
export const GUARD = P({ drop: 0.1, pitch: 6, twist: -8, head: [4, 6], grip: [0.22, 0.38, -0.8], sword: [-0.62, 0.6, -0.5], edge: [0, 0.25, -1], grip_L: true,
  feet: { R: [0.1, -0.16], L: [-0.06, 0.22] }, cape: 2 });
export const BASE = GUARD;
// 横扫：右后蓄刀 → 刀头从右后绕过身前扫到左前 → 左下沉刀收势
const SWEEP_LOAD = P({ drop: 0.12, pitch: -4, twist: -20, head: [0, 14], arm_R: [0.6, -0.1, -0.75], fore_R: [0.55, -0.45, -0.6], sword: [0.6, -0.75, -0.15],
  feet: { L: [0, 0.12] } });
const SWEEP_COCK = P({ drop: 0.3, pitch: 6, twist: -48, roll: -6, head: [-4, 38], arm_R: [0.85, -0.25, -0.1], fore_R: [0.75, -0.6, 0.15], sword: [0.72, -0.58, 0.38],
  edge: [0.6, 0.75, 0], arm_L: [-0.35, 0.8, -0.1], fore_L: [-0.15, 0.95, 0.1], feet: { R: [0.12, -0.3], L: [-0.05, 0.42] }, cape: 8 });
const SWEEP_COCK_HOLD = P({ ...SWEEP_COCK, drop: 0.34, twist: -53, sword: [0.68, -0.62, 0.4] });
const SWEEP_SMEAR = P({ drop: 0.34, pitch: 10, twist: -20, head: [0, 18], arm_R: [0.75, 0.35, -0.35], fore_R: [0.75, 0.6, -0.1], sword: [0.92, 0.38, -0.05],
  edge: [-0.38, 0.92, 0], arm_L: [-0.45, 0.5, -0.45], fore_L: [-0.3, 0.6, -0.3], feet: { R: [0.12, -0.32], L: [-0.05, 0.48] }, cape: 4 });
const SWEEP_HIT = P({ drop: 0.38, pitch: 14, twist: 8, head: [2, -6], arm_R: [0.15, 0.9, -0.35], fore_R: [0.0, 1, -0.12], sword: [0.08, 1, -0.12], edge: [-1, 0.1, 0],
  arm_L: [-0.55, -0.4, -0.55], fore_L: [-0.4, -0.5, -0.4], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: -6 });
const SWEEP_FOLLOW = P({ drop: 0.3, pitch: 18, twist: 58, roll: 5, head: [4, -42], arm_R: [-0.45, 0.8, -0.3], fore_R: [-0.75, 0.6, -0.1], sword: [-0.9, 0.38, -0.08],
  edge: [-0.35, -0.92, 0], arm_L: [-0.55, -0.6, -0.4], fore_L: [-0.4, -0.7, -0.2], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: -14 });
const SWEEP_SETTLE = P({ drop: 0.32, pitch: 20, twist: 48, head: [6, -36], arm_R: [-0.35, 0.75, -0.5], fore_R: [-0.6, 0.55, -0.55], sword: [-0.62, 0.62, -0.42],
  edge: [0, 0, -1], arm_L: [-0.5, -0.5, -0.55], fore_L: [-0.35, -0.5, -0.5], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: -4 });
// 反手再扫：从左下拧到左后蓄刀 → 刀头从左后扫到右前
const BACK_COCK = P({ drop: 0.32, pitch: 8, twist: 62, roll: 6, head: [-4, -44], arm_R: [-0.6, 0.55, 0.1], fore_R: [-0.75, -0.35, 0.4], sword: [-0.72, -0.5, 0.48],
  edge: [-0.6, 0.75, 0], arm_L: [-0.6, -0.5, -0.35], fore_L: [-0.5, -0.7, -0.1], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: -10 });
const BACK_COCK_HOLD = P({ ...BACK_COCK, twist: 66, sword: [-0.68, -0.55, 0.5] });
const BACK_SMEAR = P({ drop: 0.35, pitch: 10, twist: 30, head: [0, -20], arm_R: [-0.3, 0.8, -0.35], fore_R: [-0.7, 0.65, -0.1], sword: [-0.92, 0.38, -0.05],
  edge: [0.38, 0.92, 0], arm_L: [-0.6, -0.5, -0.45], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: -4 });
const BACK_HIT = P({ drop: 0.38, pitch: 14, twist: -6, head: [2, 6], arm_R: [0.35, 0.85, -0.3], fore_R: [0.15, 1, -0.1], sword: [0.05, 1, -0.1], edge: [1, 0.1, 0],
  arm_L: [-0.6, -0.35, -0.55], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: 6 });
const BACK_FOLLOW = P({ drop: 0.3, pitch: 16, twist: -52, roll: -5, head: [4, 40], arm_R: [0.75, 0.35, -0.3], fore_R: [0.8, 0.35, -0.2], sword: [0.92, 0.35, -0.1],
  edge: [0.35, -0.92, 0], arm_L: [-0.4, 0.5, -0.5], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: 14 });
const BACK_SETTLE = P({ drop: 0.3, pitch: 18, twist: -44, head: [6, 32], arm_R: [0.65, 0.4, -0.5], fore_R: [0.6, 0.45, -0.6], sword: [0.66, 0.6, -0.42], edge: [0, 0, -1],
  arm_L: [-0.4, 0.4, -0.6], feet: { R: [0.12, -0.35], L: [-0.05, 0.5] }, cape: 4 });
// 连斩一：袈裟斩（右上 → 左下）
const A_LIFT = P({ drop: 0.1, pitch: -4, twist: -18, head: [0, 12], arm_R: [0.55, 0.35, 0.55], fore_R: [0.45, 0.2, 0.8], sword: [0.5, 0.2, 0.84], edge: [-0.3, 0.9, 0],
  arm_L: [-0.3, 0.85, 0], fore_L: [-0.1, 0.95, 0.2] });
const A_COCK = P({ drop: 0.22, pitch: -12, twist: -38, roll: -5, head: [-6, 28], arm_R: [0.55, 0.05, 0.82], fore_R: [0.35, -0.35, 0.87], sword: [0.4, -0.55, 0.73],
  edge: [-0.35, 0.65, 0.65], arm_L: [-0.25, 0.92, 0.1], fore_L: [-0.05, 0.95, 0.25], feet: { R: [0.1, -0.25], L: [-0.05, 0.35] }, cape: 10 });
const A_COCK_HOLD = P({ ...A_COCK, pitch: -15, twist: -42, sword: [0.36, -0.62, 0.7] });
const A_SMEAR = P({ drop: 0.28, pitch: 6, twist: -12, head: [0, 10], arm_R: [0.35, 0.75, 0.45], fore_R: [0.15, 0.95, 0.25], sword: [0.15, 0.92, 0.36],
  edge: [-0.35, 0.3, -0.88], arm_L: [-0.4, 0.4, -0.5], feet: { R: [0.1, -0.28], L: [-0.05, 0.42] }, cape: 2 });
const A_HIT = P({ drop: 0.36, pitch: 22, twist: 24, head: [6, -18], arm_R: [-0.15, 0.85, -0.5], fore_R: [-0.35, 0.8, -0.45], sword: [-0.38, 0.82, -0.42],
  edge: [-0.6, -0.1, -0.8], arm_L: [-0.55, -0.45, -0.55], fore_L: [-0.4, -0.55, -0.45], feet: { R: [0.1, -0.3], L: [-0.05, 0.48] }, cape: -10 });
const A_FOLLOW = P({ drop: 0.34, pitch: 26, twist: 40, roll: 4, head: [8, -30], arm_R: [-0.45, 0.65, -0.6], fore_R: [-0.65, 0.4, -0.6], sword: [-0.8, 0.45, -0.36],
  edge: [-0.3, -0.7, -0.65], arm_L: [-0.6, -0.5, -0.5], feet: { R: [0.1, -0.3], L: [-0.05, 0.48] }, cape: -12 });
// 连斩二：逆袈裟（左下 → 右上）
const B_COCK = P({ drop: 0.32, pitch: 12, twist: 56, roll: 5, head: [0, -40], arm_R: [-0.55, 0.35, -0.6], fore_R: [-0.6, -0.3, -0.5], sword: [-0.55, -0.45, -0.7],
  edge: [0.4, 0.85, 0.3], arm_L: [-0.6, -0.45, -0.5], feet: { R: [0.1, -0.3], L: [-0.05, 0.48] }, cape: -10 });
const B_COCK_HOLD = P({ ...B_COCK, twist: 60, sword: [-0.5, -0.55, -0.66] });
const B_SMEAR = P({ drop: 0.3, pitch: 6, twist: 20, head: [0, -12], arm_R: [-0.2, 0.85, -0.35], fore_R: [-0.25, 0.95, -0.1], sword: [-0.3, 0.95, -0.1],
  edge: [0.6, 0.2, 0.75], arm_L: [-0.5, -0.4, -0.6], feet: { R: [0.1, -0.3], L: [-0.05, 0.48] }, cape: -2 });
const B_HIT = P({ drop: 0.22, pitch: -4, twist: -22, head: [-4, 16], arm_R: [0.45, 0.8, 0.25], fore_R: [0.45, 0.75, 0.45], sword: [0.42, 0.72, 0.55],
  edge: [0.55, -0.15, 0.82], arm_L: [-0.5, -0.4, -0.6], feet: { R: [0.1, -0.3], L: [-0.05, 0.48] }, cape: 10 });
const B_FOLLOW = P({ drop: 0.18, pitch: -10, twist: -38, roll: -5, head: [-8, 28], arm_R: [0.6, 0.35, 0.7], fore_R: [0.45, 0.1, 0.88], sword: [0.55, -0.05, 0.84],
  edge: [0.3, -0.75, 0.6], arm_L: [-0.45, 0.4, -0.6], feet: { R: [0.1, -0.3], L: [-0.05, 0.48] }, cape: 12 });
// 连斩收尾：双手过顶 → 竖劈入地
const C_COCK = P({ drop: -0.04, pitch: -16, head: [-14, 0], grip: [0.05, -0.12, 1.12], sword: [0.04, -0.62, 0.78], edge: [0, 0.78, 0.62],
  grip_L: true, feet: { R: [0.1, -0.25], L: [-0.05, 0.38] }, cape: 14 });
const C_COCK_HOLD = P({ ...C_COCK, pitch: -19, sword: [0.03, -0.72, 0.69] });
const C_SMEAR = P({ drop: 0.2, pitch: 10, head: [0, 0], grip: [0.05, 0.72, 0.7], sword: [0.03, 0.88, 0.47], edge: [0, 0.47, -0.88],
  grip_L: true, feet: { R: [0.1, -0.3], L: [-0.05, 0.45] }, cape: 4 });
const C_HIT = P({ drop: 0.5, pitch: 34, head: [10, 0], grip: [0.05, 0.85, -0.55], sword: [0.02, 0.8, -0.6], edge: [0, -0.78, -0.62],
  grip_L: true, feet: { R: [0.12, -0.38], L: [-0.05, 0.55] }, cape: -16 });
const C_SETTLE = P({ ...C_HIT, drop: 0.54, pitch: 36, head: [16, 0], cape: -6 });
// 冲锋：后仰蓄力 → 左肩在前的低身冲刺，大剑拖在右后 → 刹停 / 撞墙
const CH_REAR = P({ drop: 0.14, pitch: -12, twist: -16, head: [-8, 12], arm_R: [0.45, -0.55, -0.7], fore_R: [0.4, -0.75, -0.5], sword: [0.35, -0.8, -0.48],
  arm_L: [-0.4, 0.4, 0.3], fore_L: [0.45, 0.5, 0.75], feet: { L: [0, 0.2] } });
const CH_SET = P({ drop: 0.38, pitch: 28, twist: -32, roll: -4, head: [-26, 30], arm_R: [0.42, -0.6, -0.68], fore_R: [0.35, -0.8, -0.5], sword: [0.3, -0.82, -0.49],
  edge: [0, 0, -1], arm_L: [-0.3, 0.75, 0.25], fore_L: [0.55, 0.55, 0.6], feet: { R: [0.12, -0.42], L: [-0.08, 0.42] }, cape: 16 });
const CH_SET_HOLD = P({ ...CH_SET, drop: 0.42, pitch: 31 });
const RUN = P({ ...CH_SET, drop: 0.26, pitch: 30, head: [-28, 30], cape: 24 });
const CH_STOP = P({ drop: 0.4, pitch: -12, twist: -10, head: [-4, 8], arm_R: [0.35, 0.55, -0.6], fore_R: [0.3, 0.6, -0.7], sword: [0.3, 0.55, -0.78], edge: [0, 1, 0],
  arm_L: [-0.6, -0.2, 0.1], fore_L: [-0.7, 0.1, 0.4], feet: { R: [0.12, -0.45], L: [-0.06, 0.7] }, cape: 26 });
const CRASH_HIT = P({ drop: 0.18, pitch: 34, twist: -30, head: [30, 20], arm_R: [0.5, -0.4, -0.7], sword: [0.35, -0.8, -0.48], arm_L: [-0.3, 0.6, 0.4],
  fore_L: [0.5, 0.5, 0.7], feet: { R: [0.12, -0.42], L: [-0.08, 0.42] } });
const CRASH_BOUNCE = P({ drop: 0.05, pitch: -22, twist: -8, roll: 8, head: [-30, -14], arm_R: [0.75, -0.25, 0.4], fore_R: [0.7, -0.1, 0.7], sword: [0.6, 0.25, 0.75],
  arm_L: [-0.75, -0.3, 0.35], fore_L: [-0.7, -0.2, 0.6], feet: { R: [0.12, -0.3], L: [-0.08, 0.15] }, cape: -16 });
const CRASH_DAZE = P({ drop: 0.32, pitch: 18, roll: -6, head: [18, 16], arm_R: [0.4, 0.3, -0.85], fore_R: [0.3, 0.4, -0.85], sword: [0.35, 0.55, -0.76],
  arm_L: [-0.35, 0.3, -0.85], feet: { R: [0.15, -0.25], L: [-0.1, 0.25] } });
// 跃击：深蹲 → 拔地而起、大剑过顶 → 空中弓身 → 剑尖朝下下劈 → 落地剑插入地
const CROUCH_DIP = P({ drop: 0.2, pitch: 12, head: [-10, 0], arm_R: [0.35, -0.2, -0.9], sword: [0.4, 0.3, -0.85], feet: { L: [0, 0.15] } });
const CROUCH_DEEP = P({ drop: 0.58, pitch: 32, head: [-30, 0], arm_R: [0.4, -0.55, -0.72], fore_R: [0.35, -0.75, -0.55], sword: [0.35, -0.75, -0.55],
  arm_L: [-0.3, -0.6, -0.7], fore_L: [-0.25, -0.7, -0.6], feet: { R: [0.15, -0.2], L: [-0.1, 0.25] }, cape: 10 });
const CROUCH_HOLD = P({ ...CROUCH_DEEP, drop: 0.62, pitch: 34 });
const LEAP_TAKEOFF = P({ drop: -0.15, pitch: -10, head: [-20, 0], grip: [0.05, 0.15, 1.15], sword: [0.08, -0.2, 0.97], edge: [0, 1, 0],
  grip_L: true, air: true, legs: [-18, 6], cape: -20 });
const LEAP_TUCK = P({ drop: -0.1, pitch: -18, head: [-22, 0], grip: [0.05, -0.12, 1.1], sword: [0.03, -0.8, 0.6], edge: [0, 0.6, 0.8],
  grip_L: true, air: true, legs: [62, 105], cape: 20 });
const LEAP_APEX = P({ ...LEAP_TUCK, pitch: -22, sword: [0.03, -0.88, 0.47], legs: [68, 112] });
const LEAP_SWING = P({ drop: 0, pitch: 4, head: [-6, 0], grip: [0.05, 0.72, 0.85], sword: [0.03, 0.82, 0.57], edge: [0, 0.57, -0.82],
  grip_L: true, air: true, legs: [30, 40], cape: 26 });
const LEAP_PLUNGE = P({ drop: 0, pitch: 22, head: [4, 0], grip: [0.05, 0.85, -0.25], sword: [0.02, 0.55, -0.83], edge: [0, -0.83, -0.55],
  grip_L: true, air: true, legs: [14, 18], cape: 32 });
const LAND_HIT = P({ drop: 0.66, pitch: 36, head: [8, 0], grip: [0.05, 0.8, -0.7], sword: [0.03, 0.4, -0.92], edge: [0, -0.92, -0.4],
  grip_L: true, feet: { R: [0.22, -0.32], L: [-0.18, 0.48] }, cape: -22 });
const LAND_HOLD = P({ ...LAND_HIT, drop: 0.7, pitch: 38, cape: -8 });
const LAND_RISE = P({ ...LAND_HIT, drop: 0.52, pitch: 26, head: [12, 0], cape: 0 });
// 陨石雨：压剑蓄 → 举剑指天
const RAISE_ANT = P({ drop: 0.26, pitch: 16, head: [14, 0], arm_R: [0.4, -0.35, -0.85], fore_R: [0.35, -0.55, -0.75], sword: [0.3, -0.6, -0.74],
  arm_L: [-0.3, 0.3, -0.9], feet: { L: [0, 0.2] } });
const RAISE_UP = P({ drop: -0.05, pitch: -12, head: [-28, 0], arm_R: [0.14, 0.06, 0.99], fore_R: [0.05, 0.04, 1], sword: [0.06, 0.1, 0.99], edge: [1, 0, 0],
  arm_L: [-0.3, 0.6, -0.6], fore_L: [0.75, 0.6, 0.25], feet: { L: [0, 0.2] }, cape: -8 });
const RAISE_CAST = P({ ...RAISE_UP, sword: [0.09, 0.16, 0.98], head: [-32, 0] });
const RAISE_HOLD_A = P({ ...RAISE_UP, pitch: -10, head: [-26, 3] });
const RAISE_HOLD_B = P({ ...RAISE_UP, pitch: -13, head: [-29, -3], sword: [0.04, 0.08, 1] });
// 熔铜渠：反握举剑过头 → 单膝跪地、大剑直插入地
const PLANT_UP = P({ drop: -0.06, pitch: -10, head: [-12, 0], grip: [0.05, 0.55, 1.1], sword: [0.02, 0.2, -0.98], edge: [1, 0, 0],
  grip_L: true, feet: { L: [0, 0.2] }, cape: -6 });
const PLANT_HIT = P({ drop: 0.72, pitch: 24, head: [6, 0], grip: [0.05, 0.75, -0.75], sword: [0.02, 0.12, -0.99], edge: [1, 0, 0],
  grip_L: true, feet: { R: [0.1, -0.55], L: [-0.05, 0.42] }, cape: -18 });
const PLANT_HOLD = P({ ...PLANT_HIT, drop: 0.74, pitch: 26, head: [-4, 0], cape: -4 });
// 咆哮（转阶段 / 狂怒换挡）：缩身蓄 → 双臂炸开仰天长啸
export const ROAR_GATHER = P({ drop: 0.28, pitch: 26, head: [22, 0], arm_R: [0.3, 0.5, -0.8], fore_R: [-0.5, 0.65, 0.1], sword: [0.6, -0.1, -0.79],
  arm_L: [-0.3, 0.5, -0.8], fore_L: [0.5, 0.65, 0.1], feet: { R: [0.1, 0], L: [-0.1, 0] } });
const ROAR_OPEN = P({ drop: -0.04, pitch: -18, head: [-36, 0], arm_R: [0.92, 0.1, 0.38], fore_R: [0.82, 0.1, 0.56], sword: [0.6, 0.05, 0.8], edge: [0, 1, 0],
  arm_L: [-0.92, 0.1, 0.38], fore_L: [-0.82, 0.2, 0.54], feet: { R: [0.15, 0], L: [-0.15, 0] }, cape: -28 });
const ROAR_SHAKE_A = P({ ...ROAR_OPEN, pitch: -16, head: [-33, 4] });
const ROAR_SHAKE_B = P({ ...ROAR_OPEN, pitch: -19, head: [-37, -4] });
// 登场下坠：抱身、剑尖朝下
const FALL = P({ drop: 0, pitch: 14, head: [10, 0], grip: [0.05, 0.55, -0.3], sword: [0.03, 0.22, -0.97], edge: [1, 0, 0], grip_L: true,
  air: true, legs: [55, 95], cape: 40 });
const FALL_B = P({ ...FALL, pitch: 17, legs: [60, 100], cape: 46 });
// 受击：上身后仰、剑往外一甩 → 往前一沉 → 回待机
const HIT_RECOIL = P({ drop: 0.06, pitch: -14, roll: 5, head: [-18, 6], arm_R: [0.55, 0.1, -0.5], fore_R: [0.6, 0.35, -0.3], sword: [0.55, 0.75, 0.1],
  arm_L: [-0.5, -0.2, -0.6], cape: -12 });
const HIT_SAG = P({ drop: 0.16, pitch: 10, head: [12, 0], arm_R: [0.35, 0.3, -0.85], sword: [0.4, 0.85, -0.2], cape: 6 });
// 倒下：中招后仰 → 踉跄、拄剑 → 单膝跪地低头 → 剑滑、向前扑倒
const DEATH_RECOIL = P({ drop: -0.04, pitch: -24, head: [-30, 0], arm_R: [0.6, -0.55, 0.45], fore_R: [0.6, -0.6, 0.5], sword: [0.5, -0.4, 0.77],
  arm_L: [-0.6, -0.55, 0.45], fore_L: [-0.6, -0.6, 0.5], feet: { L: [0, -0.1] }, cape: -24 });
const DEATH_STAGGER = P({ drop: 0.3, pitch: 14, roll: -8, head: [16, 10], arm_R: [0.35, 0.45, -0.82], fore_R: [0.3, 0.45, -0.84], sword: [0.25, 0.4, -0.88],
  arm_L: [-0.4, 0.2, -0.9], feet: { R: [0.15, 0.1], L: [-0.1, -0.15] }, cape: 6 });
const DEATH_KNEEL = P({ drop: 0.86, pitch: 20, roll: -4, head: [30, 0], grip: [0.45, 0.65, -0.7], sword: [0.06, 0.2, -0.98], edge: [1, 0, 0],
  arm_L: [-0.25, 0.6, -0.75], fore_L: [-0.1, 0.4, -0.9], feet: { R: [0.1, -0.6], L: [-0.05, 0.4] }, cape: -4 });
const DEATH_SLUMP = P({ ...DEATH_KNEEL, drop: 0.92, pitch: 30, head: [42, 0], roll: -7 });
const DEATH_FALL = P({ drop: 1.3, fwd: 0.35, pitch: 62, roll: -12, head: [30, -10], arm_R: [0.5, 0.6, -0.6], fore_R: [0.45, 0.6, -0.65], sword: [0.75, 0.6, -0.25],
  arm_L: [-0.4, 0.55, -0.73], fore_L: [-0.3, 0.6, -0.74], feet: { R: [0.1, -0.85], L: [-0.05, -0.55] }, cape: 10 });

// 待机 / 慢走 / 疾行（双手持大剑）、登场落地停顿
const GUARD_IN = P({ ...GUARD, drop: 0.06, pitch: 4, head: [2, 6], sword: [-0.6, 0.62, -0.46], cape: 0 });
const GUARD_SHIFT = P({ ...GUARD, drop: 0.13, pitch: 7, twist: -14, roll: 2, head: [6, 16], sword: [-0.62, 0.58, -0.53], cape: 4 });
const CARRY = P({ grip: [0.18, 0.4, -0.5], sword: [-0.55, 0.32, 0.77], edge: [0, 1, 0], grip_L: true });
const IL_IMPACT = P({ drop: 0.92, pitch: 30, roll: -4, head: [24, 0], grip: [0.08, 0.62, -0.22], sword: [0.04, 0.72, -0.69], edge: [1, 0, 0], grip_L: true,
  feet: { R: [0.12, -0.62], L: [-0.06, 0.45] }, cape: 10 });
const IL_SQUASH = P({ ...IL_IMPACT, drop: 1.0, pitch: 34, head: [30, 0], cape: 4 });
const IL_HOLD = P({ ...IL_IMPACT, drop: 0.96, pitch: 32, head: [28, 0], cape: 28 });
const IL_HOLD_B = P({ ...IL_IMPACT, drop: 0.95, pitch: 31, head: [26, 2], cape: 33 });
const IL_GLARE = P({ ...IL_IMPACT, drop: 0.88, pitch: 22, head: [-12, 0], cape: 20 });

interface GaitOpts {
  base: Pose; stride: number; lift: number; beta: number; drop: number; bob: number; twist: number; twist_amp: number;
  pitch: number; cape: number; swing: number;
}

/** 步态第 phi（0–1）处的姿势（warlord_poses.step_pose） */
function stepPose(phi: number, o: GaitOpts): Pose {
  const feet: Record<string, number[]> = {};
  for (const [side, off] of [['R', 0], ['L', 0.5]] as const) {
    const psi = ((phi - off) % 1 + 1) % 1;
    let fwd: number, up: number;
    if (psi < o.beta) {
      fwd = o.stride - 2 * o.stride * psi / o.beta;
      up = 0;
    } else {
      const u = (psi - o.beta) / (1 - o.beta);
      fwd = -o.stride + 2 * o.stride * (0.5 - 0.5 * Math.cos(Math.PI * u));
      up = o.lift * Math.sin(Math.PI * u);
    }
    feet[side] = [0, fwd, up];
  }
  const c2 = Math.cos(4 * Math.PI * (phi - o.beta / 2));
  const tw = o.twist - o.twist_amp * Math.cos(2 * Math.PI * phi);
  const sw = o.base.sword!;
  const sword: V3 = [sw[0], sw[1], sw[2] + o.swing * Math.cos(4 * Math.PI * (phi - o.beta / 2 - 0.08))];
  return {
    ...o.base, drop: o.drop + o.bob * c2, pitch: o.pitch + 1.5 * c2, twist: tw, roll: 2.5 * Math.sin(2 * Math.PI * phi),
    head: [(o.base.head?.[0] ?? 0) - 1.5 * c2, -0.6 * (tw - o.twist)], sword, feet: { R: feet.R, L: feet.L },
    cape: o.cape + 5 * Math.cos(4 * Math.PI * (phi - o.beta / 2 - 0.12)),
  };
}

function gaitClip(frames: number, speed: number, o: GaitOpts): Clip {
  const keys: [number, Pose][] = [];
  for (let f = 0; f <= frames; f += 2) keys.push([f, stepPose(f / frames, o)]);
  if (keys[keys.length - 1][0] !== frames) keys.push([frames, keys[0][1]]);
  return { frames, loop: true, speed, keys, events: [[0.5, 'sfx:footstep'], [frames / 2 + 0.5, 'sfx:footstep']] };
}

// 剑士化 v2 的姿势
const IAI_LOAD = P({ drop: 0.16, pitch: 10, twist: 20, head: [-4, -14], grip: [-0.28, 0.12, -0.82], sword: [-0.3, -0.9, -0.3], edge: [0, 0, 1], grip_L: true,
  feet: { R: [0.12, -0.2], L: [-0.08, 0.3] }, cape: 4 });
const IAI_SET = P({ drop: 0.4, pitch: 24, twist: 34, roll: 4, head: [-14, -30], grip: [-0.35, 0.05, -0.85], sword: [-0.25, -0.95, -0.2], edge: [0, 0, 1], grip_L: true,
  feet: { R: [0.15, -0.3], L: [-0.1, 0.45] }, cape: 8 });
const IAI_SET_HOLD = P({ ...IAI_SET, drop: 0.43, twist: 36 });
const IAI_SMEAR = P({ drop: 0.3, pitch: 14, twist: 0, head: [-6, 0], grip: [0.1, 0.5, -0.4], sword: [0.3, 0.9, 0.1], edge: [1, 0, 0],
  feet: { R: [0.15, -0.45], L: [-0.1, 0.55] }, cape: 20 });
const IAI_DRAWN = P({ drop: 0.34, pitch: 12, twist: -40, roll: -4, head: [-2, 30], arm_R: [0.9, 0.3, -0.1], fore_R: [0.95, 0.25, 0], sword: [0.95, 0.2, 0.05],
  edge: [0, -1, 0], arm_L: [-0.4, 0.6, -0.5], fore_L: [-0.3, 0.7, -0.4], feet: { R: [0.15, -0.45], L: [-0.1, 0.55] }, cape: -10 });
const IAI_SHEATHE = P({ drop: 0.32, pitch: 16, twist: 10, head: [4, 8], grip: [-0.3, 0.15, -0.8], sword: [-0.3, -0.9, -0.25], edge: [0, 0, 1], grip_L: true,
  feet: { R: [0.15, -0.4], L: [-0.1, 0.5] }, cape: -4 });
const IAI_CLICK = P({ ...IAI_SHEATHE, drop: 0.36, pitch: 20, head: [8, 4], sword: [-0.25, -0.95, -0.15] });
const WAVE_HIT = P({ drop: 0.3, pitch: 22, head: [4, 0], grip: [0.05, 0.9, -0.2], sword: [0.02, 0.95, -0.3], edge: [0, -0.3, -0.95], grip_L: true,
  feet: { R: [0.12, -0.3], L: [-0.06, 0.45] }, cape: -8 });
const WAVE_FOLLOW = P({ ...WAVE_HIT, drop: 0.32, pitch: 26, sword: [0.02, 0.7, -0.7], cape: -4 });
const TH_REAR = P({ drop: 0.15, pitch: -6, twist: -25, head: [-6, 22], grip: [0.35, -0.15, -0.55], sword: [0.05, 1, 0.05], edge: [0, 0, 1], grip_L: true,
  feet: { R: [0.12, -0.25], L: [-0.08, 0.3] }, cape: 6 });
const TH_SET = P({ drop: 0.42, pitch: 26, twist: -30, roll: -3, head: [-24, 28], grip: [0.4, -0.2, -0.6], sword: [0.0, 1, 0.08], edge: [0, 0, 1], grip_L: true,
  feet: { R: [0.12, -0.45], L: [-0.08, 0.5] }, cape: 12 });
const TH_SET_HOLD = P({ ...TH_SET, drop: 0.45, pitch: 28 });
const TH_RUN = P({ ...TH_SET, drop: 0.28, pitch: 30, twist: -12, head: [-28, 12], grip: [0.15, 0.75, -0.35], sword: [0, 1, 0.05], cape: 26 });
const TH_STOP = P({ drop: 0.4, pitch: -10, twist: -6, head: [-4, 6], grip: [0.1, 0.6, -0.5], sword: [0.1, 0.8, -0.6], edge: [0, 0, -1], grip_L: true,
  feet: { R: [0.12, -0.3], L: [-0.08, 0.45] }, cape: 10 });
const UP_COCK = P({ drop: 0.38, pitch: 22, twist: -30, head: [-10, 24], grip: [0.4, -0.1, -0.85], sword: [0.35, -0.6, -0.72], edge: [0, 0.5, 0.86], grip_L: true,
  feet: { R: [0.12, -0.3], L: [-0.06, 0.4] }, cape: 6 });
const UP_COCK_HOLD = P({ ...UP_COCK, drop: 0.42, pitch: 25 });
const UP_SMEAR = P({ drop: 0.25, pitch: 6, twist: -8, head: [-8, 8], grip: [0.15, 0.6, -0.3], sword: [0.05, 0.92, 0.38], edge: [0, 0.38, 0.92], grip_L: true,
  feet: { R: [0.12, -0.3], L: [-0.06, 0.45] }, cape: 2 });
const UP_HIT = P({ drop: 0.05, pitch: -14, twist: 8, head: [-24, 0], grip: [0, 0.5, 0.9], sword: [-0.05, 0.4, 0.92], edge: [0, -0.92, 0.4], grip_L: true,
  feet: { R: [0.12, -0.3], L: [-0.06, 0.45] }, cape: -6 });
const UP_FOLLOW = P({ drop: -0.02, pitch: -16, head: [-14, 0], grip: [0.05, 0.1, 1.1], sword: [0.03, -0.62, 0.78], edge: [0, 0.78, 0.62], grip_L: true,
  feet: { R: [0.12, -0.3], L: [-0.06, 0.45] }, cape: -2 });

/** 剑尖在前的奔跑：每 step 帧一步（同 charge 的步点） */
function runKeys(pose: Pose, frames: number, step = 6): [number, Pose][] {
  const feet = [{ R: [0.12, -0.55], L: [-0.08, 0.55] }, { R: [0.12, -0.2], L: [-0.08, 0.25] },
    { R: [0.12, 0.55], L: [-0.08, -0.5] }, { R: [0.12, 0.2], L: [-0.08, -0.2] }];
  const keys: [number, Pose][] = [];
  let i = 0;
  for (let f = 0; f <= frames; f += step / 2, i++) keys.push([f, { ...pose, drop: (pose.drop ?? 0) + (i % 2 ? 0.06 : 0), feet: feet[i % 4] }]);
  return keys;
}

const runFeet = (pose: Pose, R: number[], L: number[], drop?: number): Pose => ({ ...pose, ...(drop !== undefined ? { drop } : {}), feet: { R, L } });

// ───────────── 片段表 ─────────────

export const CLIPS: Readonly<Record<string, Clip>> = {
  sweepReady: { frames: 26, next: 'sweep', keys: [[0, BASE], [7, SWEEP_LOAD], [19, SWEEP_COCK], [26, SWEEP_COCK_HOLD]],
    events: [[0, 'fx:sectorWarning'], [0, 'sfx:telegraph'], [7, 'fx:windup']] },
  sweep: { frames: 24, keys: [[0, SWEEP_SMEAR], [2, SWEEP_HIT], [5, SWEEP_FOLLOW], [14, SWEEP_SETTLE], [24, BASE]],
    events: [[0, 'smear'], [1, 'hit'], [1, 'sfx:blade_swing'], [6, 'smearEnd']] },
  sweepReady2: { frames: 17, next: 'sweepBack', keys: [[0, SWEEP_SETTLE], [11, BACK_COCK], [17, BACK_COCK_HOLD]],
    events: [[0, 'fx:sectorWarning'], [0, 'sfx:telegraph'], [0, 'fx:windup']] },
  sweepBack: { frames: 24, keys: [[0, BACK_SMEAR], [2, BACK_HIT], [5, BACK_FOLLOW], [14, BACK_SETTLE], [24, BASE]],
    events: [[0, 'smear'], [1, 'hit'], [1, 'sfx:blade_swing'], [6, 'smearEnd']] },
  slashA: { frames: 25, keys: [[0, BASE], [5, A_LIFT], [11, A_COCK], [13, A_COCK_HOLD], [14, A_SMEAR], [15, A_HIT], [17, A_FOLLOW], [25, A_FOLLOW]],
    events: [[0, 'fx:sectorWarning'], [2, 'fx:windup'], [13, 'smear'], [15, 'hit'], [15, 'sfx:blade_swing'], [18, 'smearEnd']] },
  slashB: { frames: 25, keys: [[0, A_FOLLOW], [8, B_COCK], [13, B_COCK_HOLD], [14, B_SMEAR], [15, B_HIT], [17, B_FOLLOW], [25, B_FOLLOW]],
    events: [[0, 'fx:sectorWarning'], [2, 'fx:windup'], [13, 'smear'], [15, 'hit'], [15, 'sfx:blade_swing'], [18, 'smearEnd']] },
  slashC: { frames: 25, keys: [[0, B_FOLLOW], [9, C_COCK], [13, C_COCK_HOLD], [14, C_SMEAR], [15, C_HIT], [17, C_SETTLE], [25, C_SETTLE]],
    events: [[0, 'fx:sectorWarning'], [2, 'fx:windup'], [13, 'smear'], [15, 'hit'], [15, 'sfx:blade_swing'], [16, 'fx:shake'], [18, 'smearEnd']] },
  chargeReady: { frames: 27, next: 'charge', keys: [[0, BASE], [8, CH_REAR], [20, CH_SET], [27, CH_SET_HOLD]],
    events: [[0, 'fx:lineWarning'], [0, 'sfx:telegraph'], [8, 'fx:windup'], [20, 'step']] },
  charge: { frames: 36, keys: [
    [0, runFeet(RUN, [0.12, -0.55], [-0.08, 0.55])], [3, runFeet(RUN, [0.12, -0.2], [-0.08, 0.25], 0.32)], [6, runFeet(RUN, [0.12, 0.55], [-0.08, -0.5], 0.22)],
    [9, runFeet(RUN, [0.12, 0.2], [-0.08, -0.2], 0.32)], [12, runFeet(RUN, [0.12, -0.55], [-0.08, 0.55])], [15, runFeet(RUN, [0.12, -0.2], [-0.08, 0.25], 0.32)],
    [18, runFeet(RUN, [0.12, 0.55], [-0.08, -0.5], 0.22)], [21, runFeet(RUN, [0.12, 0.2], [-0.08, -0.2], 0.32)], [24, runFeet(RUN, [0.12, -0.55], [-0.08, 0.55])],
    [27, runFeet(RUN, [0.12, -0.2], [-0.08, 0.25], 0.32)], [30, runFeet(RUN, [0.12, 0.55], [-0.08, -0.5], 0.22)], [33, runFeet(RUN, [0.12, 0.2], [-0.08, -0.2], 0.32)],
    [36, runFeet(RUN, [0.12, -0.55], [-0.08, 0.55])]],
  events: [[0, 'fx:shake'], [1, 'hitOpen'], [0, 'step'], [6, 'step'], [12, 'step'], [18, 'step'], [24, 'step'], [30, 'step']] },
  chargeStop: { frames: 15, keys: [[0, runFeet(RUN, [0.12, -0.3], [-0.08, 0.3])], [3, CH_STOP], [9, { ...CH_STOP, drop: 0.36, pitch: -6 }],
    [15, { ...CH_STOP, drop: 0.24, pitch: 2, cape: 8 }]],
  events: [[2, 'brake'], [2, 'sfx:boss_slam']] },
  crash: { frames: 30, keys: [[0, CRASH_HIT], [4, CRASH_BOUNCE], [12, CRASH_DAZE], [20, { ...CRASH_DAZE, head: [14, -18], roll: 5 }], [30, BASE]],
    events: [[0, 'impact'], [1, 'fx:shake'], [1, 'sfx:boss_slam']] },
  crouch: { frames: 15, next: 'leap', keys: [[0, BASE], [4, CROUCH_DIP], [12, CROUCH_DEEP], [15, CROUCH_HOLD]],
    events: [[0, 'fx:groundWarning'], [0, 'sfx:telegraph'], [4, 'fx:windup']] },
  leap: { frames: 42, keys: [[0, LEAP_TAKEOFF], [8, LEAP_TUCK], [18, LEAP_APEX], [26, LEAP_SWING], [32, LEAP_PLUNGE], [42, LEAP_PLUNGE]],
    events: [[0, 'sfx:jump'], [0, 'takeoff'], [26, 'smear']] },
  land: { frames: 24, keys: [[0, LAND_HIT], [3, LAND_HOLD], [14, LAND_RISE], [24, BASE]],
    events: [[0, 'hit'], [0, 'fx:shake'], [0, 'sfx:boss_slam'], [1, 'smearEnd']] },
  raise: { frames: 72, keys: [[0, BASE], [10, RAISE_ANT], [21, RAISE_UP], [24, RAISE_CAST], [40, RAISE_HOLD_A], [52, RAISE_HOLD_B], [60, RAISE_HOLD_A], [72, BASE]],
    events: [[0, 'sfx:boss_roar'], [0, 'sfx:telegraph'], [10, 'fx:windup'], [24, 'cast']] },
  plant: { frames: 39, keys: [[0, BASE], [9, PLANT_UP], [13, { ...PLANT_UP, drop: -0.1, pitch: -13 }], [14, PLANT_HIT], [17, PLANT_HOLD], [30, PLANT_HOLD], [39, BASE]],
    events: [[0, 'sfx:boss_roar'], [4, 'fx:windup'], [14, 'hit'], [14, 'fx:shake'], [14, 'sfx:boss_slam']] },
  roar: { frames: 72, keys: [[0, BASE], [12, ROAR_GATHER], [22, ROAR_OPEN], [30, ROAR_SHAKE_A], [38, ROAR_SHAKE_B], [46, ROAR_SHAKE_A], [54, ROAR_SHAKE_B],
    [60, ROAR_OPEN], [72, BASE]],
  events: [[0, 'sfx:boss_roar'], [12, 'gather'], [22, 'roar'], [22, 'fx:shake']] },
  Hit: { frames: 18, keys: [[0, BASE], [3, HIT_RECOIL], [8, HIT_SAG], [18, BASE]], events: [] },
  fall: { frames: 20, loop: true, keys: [[0, FALL], [10, FALL_B], [20, FALL]], events: [] },
  death: { frames: 96, keys: [[0, BASE], [6, DEATH_RECOIL], [24, DEATH_STAGGER], [40, DEATH_KNEEL], [70, DEATH_SLUMP], [84, DEATH_FALL], [96, DEATH_FALL]],
    events: [[0, 'sfx:boss_roar'], [40, 'kneel'], [40, 'fx:shake'], [84, 'collapse'], [84, 'fx:shake'], [84, 'sfx:boss_slam']] },
  Idle: { frames: 90, loop: true, keys: [[0, GUARD], [22, GUARD_IN], [45, GUARD], [67, GUARD_SHIFT], [90, GUARD]], events: [] },
  Walk: gaitClip(26, 2.3, { base: GUARD, stride: 0.6, lift: 0.22, beta: 0.6, drop: 0.17, bob: 0.04, twist: -8, twist_amp: 7, pitch: 8, cape: 0, swing: 0.05 }),
  Move: gaitClip(22, 4.6, { base: { ...GUARD, head: [-2, 0], ...CARRY }, stride: 0.66, lift: 0.32, beta: 0.42, drop: 0.24, bob: 0.07, twist: -12,
    twist_amp: 9, pitch: 14, cape: -10, swing: 0.06 }),
  introLand: { frames: 24, keys: [[0, IL_IMPACT], [3, IL_SQUASH], [9, IL_HOLD], [14, IL_HOLD_B], [18, IL_GLARE], [24, ROAR_GATHER]],
    events: [[0, 'hit'], [1, 'smearEnd'], [18, 'glare']] },
  iai: { frames: 48, keys: [[0, BASE], [6, IAI_LOAD], [18, IAI_SET], [22, IAI_SET_HOLD], [24, IAI_SMEAR], [26, IAI_DRAWN], [30, { ...IAI_DRAWN, twist: -46 }],
    [34, IAI_SHEATHE], [36, IAI_CLICK], [48, BASE]],
  events: [[0, 'fx:lineWarning'], [6, 'fx:windup'], [23, 'smear'], [24, 'dash'], [24, 'sfx:blade_swing'], [27, 'smearEnd'], [36, 'hit']] },
  waveSlash: { frames: 30, keys: [[0, BASE], [6, A_LIFT], [14, C_COCK], [17, C_COCK_HOLD], [18, C_SMEAR], [19, WAVE_HIT], [22, WAVE_FOLLOW], [30, BASE]],
    events: [[0, 'fx:lineWarning'], [4, 'fx:windup'], [18, 'smear'], [19, 'hit'], [19, 'sfx:blade_swing'], [22, 'smearEnd']] },
  waveCross: { frames: 40, keys: [[0, BASE], [8, SWEEP_LOAD], [13, SWEEP_COCK_HOLD], [14, SWEEP_SMEAR], [15, SWEEP_HIT], [18, SWEEP_FOLLOW], [21, C_COCK],
    [22, C_SMEAR], [23, WAVE_HIT], [26, WAVE_FOLLOW], [40, BASE]],
  events: [[0, 'fx:lineWarning'], [6, 'fx:windup'], [14, 'smear'], [15, 'hit'], [15, 'sfx:blade_swing'], [17, 'smearEnd'],
    [22, 'smear'], [23, 'impact'], [23, 'sfx:blade_swing'], [26, 'smearEnd']] },
  thrustReady: { frames: 24, next: 'thrust', keys: [[0, BASE], [8, TH_REAR], [18, TH_SET], [24, TH_SET_HOLD]],
    events: [[0, 'fx:lineWarning'], [8, 'fx:windup']] },
  thrust: { frames: 24, keys: runKeys(TH_RUN, 24), events: [[0, 'fx:shake'], [0, 'step'], [6, 'step'], [12, 'step'], [18, 'step']] },
  thrustCut: { frames: 27, keys: [[0, TH_STOP], [5, SWEEP_COCK], [10, SWEEP_COCK_HOLD], [11, SWEEP_SMEAR], [12, SWEEP_HIT], [15, SWEEP_FOLLOW],
    [21, SWEEP_SETTLE], [27, BASE]],
  events: [[0, 'fx:sectorWarning'], [11, 'smear'], [12, 'hit'], [12, 'sfx:blade_swing'], [15, 'smearEnd']] },
  spin: { frames: 36, keys: [[0, BASE], [8, { ...SWEEP_COCK, yaw: -25 }], [16, { ...SWEEP_COCK_HOLD, yaw: -35 }], [17, { ...SWEEP_SMEAR, yaw: 20 }],
    [18, { ...SWEEP_HIT, yaw: 80 }], [21, { ...SWEEP_FOLLOW, yaw: 200 }], [24, { ...SWEEP_FOLLOW, yaw: 300 }],
    [27, { ...SWEEP_SETTLE, yaw: 360 }], [36, { ...BASE, yaw: 360 }]],
  events: [[0, 'fx:groundWarning'], [8, 'fx:windup'], [16, 'smear'], [18, 'hit'], [18, 'sfx:blade_swing'], [24, 'smearEnd']] },
  spinTwice: { frames: 54, keys: [[0, BASE], [8, { ...SWEEP_COCK, yaw: -25 }], [16, { ...SWEEP_COCK_HOLD, yaw: -35 }], [17, { ...SWEEP_SMEAR, yaw: 20 }],
    [18, { ...SWEEP_HIT, yaw: 80 }], [21, { ...SWEEP_FOLLOW, yaw: 200 }], [24, { ...SWEEP_FOLLOW, yaw: 300 }],
    [27, { ...SWEEP_COCK, yaw: 380 }], [30, { ...SWEEP_SMEAR, yaw: 430 }], [32, { ...SWEEP_HIT, yaw: 520 }],
    [35, { ...SWEEP_FOLLOW, yaw: 640 }], [38, { ...SWEEP_SETTLE, yaw: 720 }], [54, { ...BASE, yaw: 720 }]],
  events: [[0, 'fx:groundWarning'], [8, 'fx:windup'], [16, 'smear'], [18, 'hit'], [18, 'sfx:blade_swing'],
    [25, 'smearEnd'], [30, 'smear'], [32, 'impact'], [32, 'sfx:blade_swing'], [38, 'smearEnd']] },
  slashUp: { frames: 25, keys: [[0, B_FOLLOW], [8, UP_COCK], [13, UP_COCK_HOLD], [14, UP_SMEAR], [15, UP_HIT], [17, UP_FOLLOW], [25, UP_FOLLOW]],
    events: [[0, 'fx:sectorWarning'], [2, 'fx:windup'], [13, 'smear'], [15, 'hit'], [15, 'sfx:blade_swing'], [18, 'smearEnd']] },
};

/** 片段时长（秒，原速） */
export function clipSeconds(state: string): number {
  const c = CLIPS[state];
  return c ? c.frames / FPS : 0;
}

/** 片段里第一个名为 name 的事件的归一化时刻（找不到 NaN） */
export function eventAt(state: string, name: string): number {
  const c = CLIPS[state];
  const e = c?.events.find(x => x[1] === name);
  return c && e ? e[0] / c.frames : NaN;
}
