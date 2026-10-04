/** 每把武器的手腕姿势、装填口和收尾操作点（枪模局部空间，米）。 */
export type HandPoint = readonly [number, number, number];
export type LoadingAction = 'magazine' | 'speedloader' | 'drum' | 'shell' | 'breech' | 'tube' | 'cellTop' | 'cellBottom' | 'wick' | 'ammoBox' | 'boltClip' | 'recall';
export interface HandlingProfile {
  action: LoadingAction;
  right: HandPoint;
  rightPitch: number;
  leftRoll: number;
  /** 无前握点的手枪使用双手包握。 */
  support?: HandPoint;
  load: HandPoint;
  finish: HandPoint;
}

export const WEAPON_HANDLING: Readonly<Record<string, HandlingProfile>> = {
  revolver: { action: 'speedloader', right: [0, -0.003, 0], rightPitch: -0.02, leftRoll: 0.65, support: [-0.034, -0.04, 0.035], load: [-0.045, 0.038, -0.006], finish: [-0.025, 0.038, -0.05] },
  smg: { action: 'magazine', right: [0, 0, 0], rightPitch: 0, leftRoll: 0.04, load: [-0.015, -0.07, -0.11], finish: [-0.035, 0.054, -0.07] },
  rifle: { action: 'magazine', right: [0, -0.001, 0.012], rightPitch: -0.05, leftRoll: -0.08, load: [-0.015, -0.065, -0.095], finish: [-0.04, 0.06, 0.005] },
  burst: { action: 'magazine', right: [0, 0, 0], rightPitch: 0, leftRoll: 0.1, load: [-0.015, -0.06, -0.1], finish: [-0.035, 0.055, -0.035] },
  shotgun: { action: 'shell', right: [0, 0.006, 0.02], rightPitch: -0.12, leftRoll: 0, load: [-0.018, -0.03, -0.08], finish: [0, -0.002, -0.3] },
  sniper: { action: 'magazine', right: [0, -0.001, 0.01], rightPitch: -0.06, leftRoll: -0.06, load: [-0.018, -0.06, -0.06], finish: [0.038, 0.056, 0.03] },
  launcher: { action: 'tube', right: [0, -0.008, 0.008], rightPitch: 0.05, leftRoll: -0.2, load: [0, 0.02, 0.08], finish: [-0.045, 0.045, -0.03] },
  crossbow: { action: 'boltClip', right: [0, -0.004, 0.008], rightPitch: 0.02, leftRoll: -0.1, load: [-0.015, 0.075, -0.13], finish: [0, 0.08, -0.1] },
  beam: { action: 'cellTop', right: [0, -0.002, 0.008], rightPitch: 0.04, leftRoll: 0.24, load: [-0.025, 0.11, -0.04], finish: [-0.04, 0.035, 0.02] },
  minigun: { action: 'ammoBox', right: [0, -0.012, -0.005], rightPitch: 0.12, leftRoll: 0.6, load: [-0.08, -0.065, -0.02], finish: [-0.065, 0.06, -0.11] },
  swarm: { action: 'tube', right: [0, -0.006, 0.008], rightPitch: 0.06, leftRoll: 0.3, load: [0, 0.016, 0.075], finish: [-0.055, 0.042, -0.055] },
  flamer: { action: 'cellBottom', right: [0, -0.003, 0.014], rightPitch: -0.04, leftRoll: 0.45, load: [-0.035, -0.07, -0.088], finish: [-0.045, 0.03, 0.015] },
  stormpod: { action: 'drum', right: [0, -0.003, 0.01], rightPitch: -0.02, leftRoll: 0.38, load: [-0.06, 0.03, -0.005], finish: [-0.025, 0.03, -0.03] },
  magmashot: { action: 'breech', right: [0, 0.006, 0.02], rightPitch: -0.1, leftRoll: -0.12, load: [0, 0.045, -0.04], finish: [0, -0.02, -0.16] },
  trinity: { action: 'speedloader', right: [0, -0.003, 0], rightPitch: -0.02, leftRoll: 0.58, support: [-0.034, -0.04, 0.03], load: [-0.048, 0.04, -0.003], finish: [-0.027, 0.04, -0.05] },
  railgun: { action: 'cellTop', right: [0, -0.001, 0.01], rightPitch: 0, leftRoll: -0.18, load: [-0.03, 0.085, 0.02], finish: [-0.038, 0.055, 0.08] },
  lantern: { action: 'wick', right: [0, 0.008, 0.004], rightPitch: 0.12, leftRoll: 0.2, load: [-0.025, -0.03, -0.29], finish: [-0.024, 0.02, -0.23] },
  demon_blade: { action: 'recall', right: [0, 0, 0], rightPitch: 0, leftRoll: 0, load: [0, 0, 0], finish: [0, 0, 0] },
};

const smooth = (p: number): number => { const t = Math.max(0, Math.min(1, p)); return t * t * (3 - 2 * t); };
export interface HandPose { x: number; y: number; z: number; roll: number; pitch: number }

/** 装填循环使用逻辑层的单发进度，手送到装填口时才实际加弹。 */
export function sampleLoadingHand(profile: HandlingProfile, progress: number, support: HandPoint, contact: HandPoint, out: HandPose): void {
  const p = Math.max(0, Math.min(1, progress));
  let from = support, to = contact, t = 0;
  const shell = profile.action === 'shell' || profile.action === 'breech';
  if (shell) {
    const pouch: HandPoint = [-0.11, -0.21, 0.08];
    if (p < 0.22) { to = pouch; t = smooth(p / 0.22); }
    else { from = pouch; t = smooth((p - 0.22) / 0.66); }
  } else if (p < 0.14) {
    t = smooth(p / 0.14);
  } else if (p < 0.78) {
    from = contact; t = 1;
  } else if (p < 0.88) {
    from = contact; to = profile.finish; t = smooth((p - 0.78) / 0.1);
  } else {
    from = profile.finish; to = support; t = smooth((p - 0.88) / 0.12);
  }
  out.x = from[0] + (to[0] - from[0]) * t;
  out.y = from[1] + (to[1] - from[1]) * t;
  out.z = from[2] + (to[2] - from[2]) * t;
  const reach = shell ? smooth(p / 0.22) : smooth(p / 0.14) * (1 - smooth((p - 0.88) / 0.12));
  const roll = profile.action === 'cellTop' || profile.action === 'boltClip' || profile.action === 'wick' ? -0.9
    : profile.action === 'speedloader' || profile.action === 'drum' ? -1.25
    : profile.action === 'tube' ? 0.65 : 0.35;
  out.roll = profile.leftRoll + (roll - profile.leftRoll) * reach;
  out.pitch = (shell ? -0.3 : 0.12) * reach;
}
