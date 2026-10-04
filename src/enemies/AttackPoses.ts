/**
 * 重炮与法杖的动作关键帧。用绝对进度采样，前摇、释放和收势共用同一条姿态曲线。
 * 只驱动现有骨架/武器挂点，握点沿实际发布附件的 +Y 长轴布置。
 */
export type MortarAction = 'shell' | 'smash';
export type ShamanAction = 'circle' | 'ward';

export interface MortarPose {
  x: number; y: number; z: number;
  pitch: number; yaw: number; roll: number;
  crouch: number; lean: number; twist: number; head: number;
  supportY: number;
  supportClearance: number;
}
export interface ShamanPose extends MortarPose {
  handX: number; handY: number; handZ: number;
  handPitch: number; handYaw: number; handRoll: number;
  staffForearmRoll: number;
}

// 虚拟掌参考点包含手掌厚度，真实掌内面承托铜炮光滑段，避开铁箍。
export const MORTAR_RIGHT_GRIP = [-0.206, 0.06, -0.0175] as const;
export const MORTAR_LEFT_GRIP = [0.178, 0.32, -0.04] as const;
// 杖杆落在指侧与掌内面之间的握持空隙；参考点包含真实掌厚，避免杆体穿过掌肉。
export const SHAMAN_STAFF_GRIP = [0.0671318189, 0.22, 0.0231153390] as const;
/** 炮口与法珠中心；与现有附件/发光挂点一致，世界坐标从 socket 矩阵求得。 */
export const MORTAR_MUZZLE = [0, 1, 0] as const;
export const SHAMAN_FOCUS = [0, 1.05, 0] as const;

const BODY_KEYS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'crouch', 'lean', 'twist', 'head', 'supportY', 'supportClearance'] as const;
const SHAMAN_KEYS = [...BODY_KEYS, 'handX', 'handY', 'handZ', 'handPitch', 'handYaw', 'handRoll', 'staffForearmRoll'] as const;
const unit = (n: number): number => Math.min(1, Math.max(0, n));
const ease = (n: number): number => { const t = unit(n); return t * t * (3 - 2 * t); };
type Frame<T> = readonly [number, T];

/** Palm centre follows this external reference; the inner palm surface makes the actual contact. */
export function mortarSupportGrip(p: MortarPose, out: { x: number; y: number; z: number }): void {
  const radius = Math.hypot(MORTAR_LEFT_GRIP[0], MORTAR_LEFT_GRIP[2]);
  out.x = MORTAR_LEFT_GRIP[0] * (1 + p.supportClearance / radius);
  out.y = p.supportY;
  out.z = MORTAR_LEFT_GRIP[2] * (1 + p.supportClearance / radius);
}

function sample<T>(frames: readonly Frame<T>[], progress: number, keys: readonly (keyof T)[], out: T): void {
  const t = unit(progress);
  if (t <= frames[0][0]) { Object.assign(out as object, frames[0][1]); return; }
  if (t >= frames[frames.length - 1][0]) { Object.assign(out as object, frames[frames.length - 1][1]); return; }
  let i = 1;
  while (i < frames.length - 1 && t > frames[i][0]) i++;
  const [aTime, a] = frames[i - 1], [bTime, b] = frames[i];
  const k = ease((t - aTime) / Math.max(1e-5, bTime - aTime));
  for (const key of keys) out[key] = ((a[key] as number) + ((b[key] as number) - (a[key] as number)) * k) as T[keyof T];
}

export const MORTAR_CARRY: Readonly<MortarPose> = {
  x: 0.02, y: 0.27, z: 0.47, pitch: 0.50, yaw: 0, roll: 0,
  crouch: 0, lean: 0.025, twist: -0.025, head: 0, supportY: 0.32, supportClearance: 0.008,
};
const MORTAR_BRACED: MortarPose = {
  x: 0.02, y: 0.22, z: 0.44, pitch: 0.75, yaw: 0, roll: 0,
  crouch: 0.08, lean: 0.055, twist: -0.015, head: -0.035, supportY: 0.24, supportClearance: 0.03,
};
const MORTAR_SMASH_HIT: MortarPose = {
  x: 0.02, y: 0.16, z: 0.47, pitch: 0.65, yaw: 0, roll: -0.025,
  crouch: 0.12, lean: 0.10, twist: 0.035, head: -0.045, supportY: 0.28, supportClearance: 0.015,
};
const BRACE: readonly Frame<MortarPose>[] = [
  [0, MORTAR_CARRY],
  [0.48, { ...MORTAR_BRACED, y: 0.24, z: 0.45, pitch: 0.64, supportY: 0.26, crouch: 0.05, twist: -0.04 }],
  [0.82, MORTAR_BRACED], [1, MORTAR_BRACED],
];
const SMASH: readonly Frame<MortarPose>[] = [
  [0, MORTAR_CARRY],
  [0.58, { x: 0.02, y: 0.44, z: 0.50, pitch: 0.72, yaw: -0.015, roll: 0.025,
    crouch: 0.015, lean: -0.04, twist: -0.06, head: 0.025, supportY: 0.18, supportClearance: 0.035 }],
  [0.72, { x: 0.02, y: 0.44, z: 0.50, pitch: 0.72, yaw: -0.015, roll: 0.025,
    crouch: 0.015, lean: -0.04, twist: -0.06, head: 0.025, supportY: 0.18, supportClearance: 0.035 }],
  [1, MORTAR_SMASH_HIT],
];

/** 每发独立的短后坐：后移后回弹，不把三个炮弹合成一次长时间倾斜。 */
export function mortarRecoil(shotAge: number): number {
  if (!Number.isFinite(shotAge) || shotAge < 0 || shotAge >= 0.35) return 0;
  const t = shotAge / 0.35;
  return Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 1.5);
}

export function sampleMortarPose(
  state: string, progress: number, shotAge: number, lastAction: MortarAction, out: MortarPose,
): void {
  if (state === 'brace') sample(BRACE, progress, BODY_KEYS, out);
  else if (state === 'fire') Object.assign(out, MORTAR_BRACED);
  else if (state === 'smashWindup') sample(SMASH, progress, BODY_KEYS, out);
  else if (state === 'recover') {
    const start = lastAction === 'smash' ? MORTAR_SMASH_HIT : MORTAR_BRACED;
    sample([[0, start], [1, MORTAR_CARRY]], progress, BODY_KEYS, out);
  } else Object.assign(out, MORTAR_CARRY);
  if (lastAction === 'shell' && (state === 'fire' || state === 'recover')) {
    const recoil = mortarRecoil(shotAge);
    out.y -= Math.cos(out.pitch) * recoil * 0.025;
    out.z -= Math.sin(out.pitch) * recoil * 0.025;
    out.pitch -= recoil * 0.035;
    out.lean -= recoil * 0.065;
    out.crouch += Math.max(0, recoil) * 0.018;
  }
}

export const SHAMAN_CARRY: Readonly<ShamanPose> = {
  x: -0.40, y: 0.09, z: 0.30, pitch: 0.02, yaw: 0, roll: 0,
  crouch: 0, lean: 0.015, twist: 0, head: 0, supportY: 0, supportClearance: 0,
  handX: 0.30, handY: 0.12, handZ: 0.20, handPitch: 0, handYaw: 0, handRoll: 0,
  staffForearmRoll: 0.20,
};
const CIRCLE_RELEASE: ShamanPose = {
  x: -0.41, y: 0.20, z: 0.35, pitch: 0.30, yaw: 0.015, roll: -0.01,
  crouch: 0.015, lean: 0.035, twist: 0.025, head: -0.02, supportY: 0, supportClearance: 0,
  handX: 0.36, handY: 0.52, handZ: 0.40, handPitch: -0.08, handYaw: -0.04, handRoll: -0.05,
  staffForearmRoll: 0,
};
const WARD_RELEASE: ShamanPose = {
  x: -0.40, y: 0.30, z: 0.28, pitch: 0.03, yaw: 0, roll: -0.025,
  crouch: 0, lean: -0.025, twist: -0.025, head: -0.05, supportY: 0, supportClearance: 0,
  handX: 0.48, handY: 0.84, handZ: 0.28, handPitch: -0.12, handYaw: 0.06, handRoll: -0.06,
  staffForearmRoll: 0,
};
const CIRCLE: readonly Frame<ShamanPose>[] = [
  [0, SHAMAN_CARRY],
  [0.38, { ...SHAMAN_CARRY, x: -0.42, y: 0.20, z: 0.24, pitch: -0.10, roll: -0.025, twist: -0.045,
    handX: 0.18, handY: 0.46, handZ: 0.28, handPitch: -0.10, handYaw: -0.04, handRoll: -0.05 }],
  [0.76, { ...CIRCLE_RELEASE, pitch: 0.16, y: 0.22, handX: 0.25, handY: 0.52, handZ: 0.33,
    handPitch: -0.08, twist: 0.015 }],
  [1, CIRCLE_RELEASE],
];
const WARD: readonly Frame<ShamanPose>[] = [
  [0, SHAMAN_CARRY],
  [0.40, { ...SHAMAN_CARRY, x: -0.41, y: 0.18, z: 0.28, pitch: -0.03, lean: -0.025, twist: -0.04,
    handX: 0.24, handY: 0.49, handZ: 0.28, handPitch: -0.08, handRoll: -0.05 }],
  [0.86, { ...WARD_RELEASE, handX: 0.42, handY: 0.82, handZ: 0.28, handPitch: -0.12 }],
  [1, WARD_RELEASE],
];

// 持杖手随杆体位置小幅旋前/旋后，掌内面保持接触，腕部不复制法杖朝向。
const FOREARM_KEY = ['staffForearmRoll'] as const;
const CIRCLE_FOREARM: readonly Frame<Pick<ShamanPose, 'staffForearmRoll'>>[] = [
  [0, { staffForearmRoll: 0.20 }], [0.20, { staffForearmRoll: 0.2875 }],
  [0.45, { staffForearmRoll: 0.2875 }], [0.55, { staffForearmRoll: 0.2125 }],
  [0.65, { staffForearmRoll: 0.075 }], [0.85, { staffForearmRoll: 0.025 }], [1, { staffForearmRoll: 0 }],
];
const WARD_FOREARM: readonly Frame<Pick<ShamanPose, 'staffForearmRoll'>>[] = [
  [0, { staffForearmRoll: 0.20 }], [0.15, { staffForearmRoll: 0.25 }],
  [0.50, { staffForearmRoll: 0.25 }], [0.60, { staffForearmRoll: 0.20 }],
  [0.70, { staffForearmRoll: 0.10 }], [0.90, { staffForearmRoll: 0.025 }], [1, { staffForearmRoll: 0 }],
];
const CIRCLE_RECOVER_FOREARM: readonly Frame<Pick<ShamanPose, 'staffForearmRoll'>>[] = [
  [0, { staffForearmRoll: 0 }], [0.15, { staffForearmRoll: 0 }],
  [0.30, { staffForearmRoll: 0.05 }], [0.40, { staffForearmRoll: 0.10 }],
  [0.50, { staffForearmRoll: 0.20 }], [0.75, { staffForearmRoll: 0.2375 }],
  [0.85, { staffForearmRoll: 0.2375 }], [1, { staffForearmRoll: 0.20 }],
];
const WARD_RECOVER_FOREARM: readonly Frame<Pick<ShamanPose, 'staffForearmRoll'>>[] = [
  [0, { staffForearmRoll: 0 }], [0.05, { staffForearmRoll: 0.075 }],
  [0.20, { staffForearmRoll: 0.125 }], [0.30, { staffForearmRoll: 0.125 }],
  [0.50, { staffForearmRoll: 0.2625 }], [0.80, { staffForearmRoll: 0.2625 }], [1, { staffForearmRoll: 0.20 }],
];

export function sampleShamanPose(state: string, progress: number, lastAction: ShamanAction, out: ShamanPose): void {
  if (state === 'castCircle') {
    sample(CIRCLE, progress, SHAMAN_KEYS, out);
    sample(CIRCLE_FOREARM, progress, FOREARM_KEY, out);
  } else if (state === 'ward') {
    sample(WARD, progress, SHAMAN_KEYS, out);
    sample(WARD_FOREARM, progress, FOREARM_KEY, out);
  }
  else if (state === 'recover') {
    sample([[0, lastAction === 'ward' ? WARD_RELEASE : CIRCLE_RELEASE], [1, SHAMAN_CARRY]], progress, SHAMAN_KEYS, out);
    // 释放后短暂顺势送杖/展掌，再连贯回到行走姿态。
    const release = progress > 0 && progress < 0.25 ? Math.sin(Math.PI * progress / 0.25) : 0;
    out.y -= release * 0.025;
    out.lean += release * 0.025;
    out.handZ += release * 0.025;
    if (lastAction === 'circle') out.pitch += release * 0.055;
    else out.handX += release * 0.025;
    sample(lastAction === 'ward' ? WARD_RECOVER_FOREARM : CIRCLE_RECOVER_FOREARM, progress, FOREARM_KEY, out);
  } else Object.assign(out, SHAMAN_CARRY);
}
