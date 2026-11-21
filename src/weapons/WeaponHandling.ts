/**
 * 每把枪的第一人称持握与换弹（Unity HandlingProfile.cs + Handling/Profiles/HandlingProfile_<Id>.cs，M10 照 C# 补齐）。
 *
 * 两部分：
 * - 网页自己的握点（枪模局部空间，米）：右手 right / rightPitch、左手横滚 leftRoll、无前握的手枪 support、送弹口 load、收尾点 finish。
 *   Unity 把这些放在枪模 Prefab 的挂点上（W3 WeaponSockets），网页的枪模没有挂点，仍用这张表（数值是 Unity 挂点的来源）。
 * - Unity HandlingProfile 的「怎么动」：装填动作的预设（{@link makeHandling}，按装填动作 + 换弹风格）+ 各把改的几项
 *   （枪重 weight、晃动 swayScale、摆动 bobScale、转轮格数、泵动行程）：
 *   · 时间线（整匣换弹进度 0..1）：0 → reachEnd 左手从握点伸到送弹口；弹匣 magOutStart–magOutEnd 取出、magInStart–magInEnd 装入；
 *     loadAt 弹匣入位 = 加弹的动画事件（WeaponSystem.commitLoad，Unity WeaponStateMachine.CommitLoad）；finishStart–finishEnd 手去收尾点，之后回握点；
 *   · 逐发装填（shell / breech）：每发 0–22% 手从握点（第一发）或送弹口（之后）去弹药袋，22%–88% 送到送弹口；
 *   · 换弹时枪身姿态 tiltRot / tiltPos（相机空间：rx + 枪口上抬、ry + 枪口左摆、rz + 右侧上翻；x 右、y 上、z 朝后），包络进 0–15%、出 82–100%；
 *     逐发装填的整体姿态也写在 tiltRot / tiltPos（Unity WeaponRigFactory.Configure：shell 时写进 shellTilt，整匣姿态为零）；
 *   · 弹匣离位 magOffset（枪模坐标）与俯仰 magPitch、管式装填塞进去后隐藏 magHideAt；转轮每发 cylinderSteps 格、换弹甩出 cylinderSwing 并自转 cylinderSpin；
 *     泵动行程 pumpStroke；左手伸到送弹口时的手型 reachRoll / reachPitch。
 */
export type HandPoint = readonly [number, number, number];
export type LoadingAction = 'magazine' | 'speedloader' | 'drum' | 'shell' | 'breech' | 'tube' | 'cellTop' | 'cellBottom' | 'wick' | 'ammoBox' | 'boltClip' | 'recall';
/** 换弹风格（同 WeaponDef.reloadStyle） */
export type HandlingReloadStyle = 'mag' | 'cylinder' | 'tube' | 'cell' | 'box' | 'shell';
export type Vec3 = readonly [number, number, number];

export interface HandlingProfile {
  action: LoadingAction;
  right: HandPoint;
  rightPitch: number;
  leftRoll: number;
  /** 无前握点的手枪使用双手包握。 */
  support?: HandPoint;
  load: HandPoint;
  finish: HandPoint;

  // ── Unity HandlingProfile ──
  /** 左手伸到送弹口的时刻；弹匣取出 / 装入的区间；弹匣入位（加弹事件）；手去收尾点的区间 */
  reachEnd: number;
  magOutStart: number;
  magOutEnd: number;
  magInStart: number;
  magInEnd: number;
  loadAt: number;
  finishStart: number;
  finishEnd: number;
  /** 换弹姿态（逐发装填时是整体姿态） */
  tiltRot: Vec3;
  tiltPos: Vec3;
  /** 弹匣离位偏移（枪模坐标）、俯仰；离位到 magHideAt 后隐藏（≥ 1 = 不隐藏） */
  magOffset: Vec3;
  magPitch: number;
  magHideAt: number;
  /** 转轮每发转的格数（0 = 不转；三才转轮由 TrinityCycle 那一路转）、换弹甩出的横移（米）与自转（弧度 / 秒） */
  cylinderSteps: number;
  cylinderSwing: number;
  cylinderSpin: number;
  /** 泵动行程（米；0 = 没有泵） */
  pumpStroke: number;
  /** 枪重（冲锋枪 = 1；越重晃动越慢、后坐回位越慢、落地越沉）、晃动 / 摆动倍率 */
  weight: number;
  swayScale: number;
  bobScale: number;
  /** 左手伸到送弹口时的横滚 / 俯仰（弧度） */
  reachRoll: number;
  reachPitch: number;
}

/** 网页握点（Unity 挂点的来源；x 不取反，Three.js 枪模坐标） */
interface Grip {
  right: HandPoint;
  rightPitch: number;
  leftRoll: number;
  support?: HandPoint;
  load: HandPoint;
  finish: HandPoint;
}

/** Unity 各把 HandlingProfile_<Id>.cs 在预设之外改的几项 */
type Tweak = Partial<Pick<HandlingProfile, 'weight' | 'swayScale' | 'bobScale' | 'cylinderSteps' | 'pumpStroke'>>;

/**
 * 按装填动作与换弹风格的预设（Unity HandlingProfile.Make）。
 * 相对 TS 原来的改动（Unity 注释）：弹匣换弹枪身多抬 5 cm、往镜头拉 2 cm（换弹匣的手看得见）；弹匣下抽 0.2 → 0.14（不掉出画面）。
 */
export function makeHandling(grip: Grip, action: LoadingAction, style: HandlingReloadStyle, tweak: Tweak = {}): HandlingProfile {
  const p: HandlingProfile = {
    ...grip, action,
    reachEnd: 0.14, magOutStart: 0.12, magOutEnd: 0.38, magInStart: 0.55, magInEnd: 0.78, loadAt: 0.78, finishStart: 0.78, finishEnd: 0.88,
    tiltRot: [0, 0, 0], tiltPos: [0, 0, 0], magOffset: [0, 0, 0], magPitch: 0, magHideAt: 1,
    cylinderSteps: 0, cylinderSwing: -0.045, cylinderSpin: 14, pumpStroke: 0,
    weight: 1, swayScale: 1, bobScale: 1, reachRoll: 0.35, reachPitch: 0.12,
  };
  switch (style) {
    case 'mag': p.tiltRot = [0.12, 0, 0.45]; p.tiltPos = [-0.045, 0.05, 0.02]; break;
    case 'cylinder': p.tiltRot = [0.1, 0, 0.75]; p.tiltPos = [-0.04, 0, 0]; break;
    case 'tube': p.tiltRot = [0.5, 0, 0.15]; p.tiltPos = [0, -0.04, 0.04]; break;
    case 'cell': p.tiltRot = [0.12, 0, 0.3]; p.tiltPos = [-0.02, 0, 0]; break;
    case 'box': p.tiltRot = [0, 0, 0.28]; p.tiltPos = [-0.02, -0.05, 0]; break;
    case 'shell': p.tiltRot = [0.1, 0, -0.38]; p.tiltPos = [-0.015, 0.015, 0]; break;
  }
  switch (action) {
    case 'magazine': p.magOffset = [0, -0.14, 0.03]; p.magPitch = 0.3; break;
    case 'boltClip': p.magOffset = [0, 0.13, 0.03]; p.magPitch = -0.25; p.reachRoll = -0.9; break;
    case 'cellTop': p.magOffset = [0.03, 0.12, 0]; p.reachRoll = -0.9; break;
    case 'wick': p.magOffset = [0.03, 0.12, 0]; p.reachRoll = -0.9; break;
    case 'cellBottom': p.magOffset = [0.03, -0.16, 0]; break;
    case 'tube': p.magOffset = [0, -0.02, 0.12]; p.magHideAt = 0.85; p.reachRoll = 0.65; break;
    case 'ammoBox': p.magOffset = [-0.02, -0.24, 0]; break;
    case 'speedloader':
    case 'drum': p.reachRoll = -1.25; break;
    case 'shell':
    case 'breech': p.reachPitch = -0.3; break;
    case 'recall': break;
  }
  return Object.assign(p, tweak);
}

/** 逐发装填（同 Unity HandlingProfile.Shell） */
export function isShellAction(action: LoadingAction): boolean {
  return action === 'shell' || action === 'breech';
}

export const WEAPON_HANDLING: Readonly<Record<string, HandlingProfile>> = {
  revolver: makeHandling({ right: [0, -0.003, 0], rightPitch: -0.02, leftRoll: 0.65, support: [-0.034, -0.04, 0.035], load: [-0.045, 0.038, -0.006], finish: [-0.025, 0.038, -0.05] },
    'speedloader', 'cylinder', { cylinderSteps: 8, weight: 0.7 }),
  smg: makeHandling({ right: [0, 0, 0], rightPitch: 0, leftRoll: 0.04, load: [-0.015, -0.07, -0.11], finish: [-0.035, 0.054, -0.07] },
    'magazine', 'mag', { weight: 0.85, swayScale: 1.1 }),
  rifle: makeHandling({ right: [0, -0.001, 0.012], rightPitch: -0.05, leftRoll: -0.08, load: [-0.015, -0.065, -0.095], finish: [-0.04, 0.06, 0.005] },
    'magazine', 'mag', { weight: 1 }),
  burst: makeHandling({ right: [0, 0, 0], rightPitch: 0, leftRoll: 0.1, load: [-0.015, -0.06, -0.1], finish: [-0.035, 0.055, -0.035] },
    'magazine', 'mag', { weight: 1.05 }),
  shotgun: makeHandling({ right: [0, 0.006, 0.02], rightPitch: -0.12, leftRoll: 0, load: [-0.018, -0.03, -0.08], finish: [0, -0.002, -0.3] },
    'shell', 'shell', { pumpStroke: 0.075, weight: 1.15 }),
  sniper: makeHandling({ right: [0, -0.001, 0.01], rightPitch: -0.06, leftRoll: -0.06, load: [-0.018, -0.06, -0.06], finish: [0.038, 0.056, 0.03] },
    'magazine', 'mag', { weight: 1.25, swayScale: 0.85, bobScale: 0.85 }),
  launcher: makeHandling({ right: [0, -0.008, 0.008], rightPitch: 0.05, leftRoll: -0.2, load: [0, 0.02, 0.08], finish: [-0.045, 0.045, -0.03] },
    'tube', 'tube', { cylinderSteps: 4, weight: 1.3 }),
  crossbow: makeHandling({ right: [0, -0.004, 0.008], rightPitch: 0.02, leftRoll: -0.1, load: [-0.015, 0.075, -0.13], finish: [0, 0.08, -0.1] },
    'boltClip', 'mag', { weight: 1.05 }),
  beam: makeHandling({ right: [0, -0.002, 0.008], rightPitch: 0.04, leftRoll: 0.24, load: [-0.025, 0.11, -0.04], finish: [-0.04, 0.035, 0.02] },
    'cellTop', 'cell', { weight: 1.1 }),
  minigun: makeHandling({ right: [0, -0.012, -0.005], rightPitch: 0.12, leftRoll: 0.6, load: [-0.08, -0.065, -0.02], finish: [-0.065, 0.06, -0.11] },
    'ammoBox', 'box', { weight: 1.6, swayScale: 0.8, bobScale: 1.15 }),
  swarm: makeHandling({ right: [0, -0.006, 0.008], rightPitch: 0.06, leftRoll: 0.3, load: [0, 0.016, 0.075], finish: [-0.055, 0.042, -0.055] },
    'tube', 'tube', { weight: 1.35 }),
  flamer: makeHandling({ right: [0, -0.003, 0.014], rightPitch: -0.04, leftRoll: 0.45, load: [-0.035, -0.07, -0.088], finish: [-0.045, 0.03, 0.015] },
    'cellBottom', 'cell', { weight: 1.3 }),
  stormpod: makeHandling({ right: [0, -0.003, 0.01], rightPitch: -0.02, leftRoll: 0.38, load: [-0.06, 0.03, -0.005], finish: [-0.025, 0.03, -0.03] },
    'drum', 'cylinder', { cylinderSteps: 5, weight: 1.2 }),
  magmashot: makeHandling({ right: [0, 0.006, 0.02], rightPitch: -0.1, leftRoll: -0.12, load: [0, 0.045, -0.04], finish: [0, -0.02, -0.16] },
    'breech', 'shell', { weight: 1.1 }),
  trinity: makeHandling({ right: [0, -0.003, 0], rightPitch: -0.02, leftRoll: 0.58, support: [-0.034, -0.04, 0.03], load: [-0.048, 0.04, -0.003], finish: [-0.027, 0.04, -0.05] },
    'speedloader', 'cylinder', { weight: 0.7 }),
  railgun: makeHandling({ right: [0, -0.001, 0.01], rightPitch: 0, leftRoll: -0.18, load: [-0.03, 0.085, 0.02], finish: [-0.038, 0.055, 0.08] },
    'cellTop', 'cell', { weight: 1.3, swayScale: 0.9 }),
  lantern: makeHandling({ right: [0, 0.008, 0.004], rightPitch: 0.12, leftRoll: 0.2, load: [-0.025, -0.03, -0.29], finish: [-0.024, 0.02, -0.23] },
    'wick', 'cell', { weight: 0.9, swayScale: 1.2 }),
  // 碎刃没有枪的持握（Unity HandlingProfile.For 返回 null）；保留这一行只为让握点表覆盖全部武器，第一人称不读它
  demon_blade: makeHandling({ right: [0, 0, 0], rightPitch: 0, leftRoll: 0, load: [0, 0, 0], finish: [0, 0, 0] }, 'recall', 'box'),
};

/**
 * 碎刃的第一人称晃动（Unity BladeView.Build 给 Sway 的 FirstPersonViewmodel）：比冲锋枪略轻快，刀在手里晃得比枪灵活；
 * 腰射 / 开镜偏移为零（刀姿关键帧已经是相机空间的真实位置）
 */
export const BLADE_SWAY = { weight: 0.85, swayScale: 1.1, bobScale: 0.9 } as const;

const smooth = (p: number): number => { const t = Math.max(0, Math.min(1, p)); return t * t * (3 - 2 * t); };
export interface HandPose { x: number; y: number; z: number; roll: number; pitch: number }

/** 换弹姿态包络（Unity HandlingProfile.Envelope / FirstPersonViewmodel.Envelope）：进 0–15%，保持，82–100% 退出 */
export function reloadEnvelope(p: number): number {
  return smooth(p / 0.15) * (1 - smooth((p - 0.82) / 0.18));
}

/** 弹匣离位程度 0..1（Unity HandlingProfile.MagOut，分界用本把的时间线） */
export function magOut(profile: HandlingProfile, p: number): number {
  if (p < profile.magOutStart) return 0;
  if (p < profile.magOutEnd) return smooth((p - profile.magOutStart) / Math.max(1e-3, profile.magOutEnd - profile.magOutStart));
  if (p < profile.magInStart) return 1;
  if (p < profile.magInEnd) return 1 - smooth((p - profile.magInStart) / Math.max(1e-3, profile.magInEnd - profile.magInStart));
  return 0;
}

/** 逐发装填时左手去拿弹的弹药袋（枪模坐标，Unity HandlingProfile.Pouch 的 TS 原值） */
export const POUCH: HandPoint = [-0.11, -0.21, 0.08];

/**
 * 换弹中左手的位置与手型（Unity HandlingProfile.SampleHand；坐标都是枪模空间）。support = 握点，contact = 送弹口，收尾点 = profile.finish；
 * 装填循环使用逻辑层的单发进度，手送到装填口时才实际加弹。
 * 逐发装填时，第一发从前握出发；后续各发从上一发结束的装填口出发并保持装填手型，避免每发之间手跳回前握。
 */
export function sampleLoadingHand(profile: HandlingProfile, progress: number, support: HandPoint, contact: HandPoint, out: HandPose, firstShell = true,
  finish: HandPoint = profile.finish): void {
  const p = Math.max(0, Math.min(1, progress));
  const P = profile;
  let from = support, to = contact, t: number;
  const shell = isShellAction(P.action);
  if (shell) {
    if (p < 0.22) { from = firstShell ? support : contact; to = POUCH; t = smooth(p / 0.22); }
    else { from = POUCH; t = smooth((p - 0.22) / 0.66); }
  } else if (p < P.reachEnd) {
    t = smooth(p / P.reachEnd);
  } else if (p < P.finishStart) {
    from = contact; t = 1;
  } else if (p < P.finishEnd) {
    from = contact; to = finish; t = smooth((p - P.finishStart) / Math.max(1e-3, P.finishEnd - P.finishStart));
  } else {
    from = finish; to = support; t = smooth((p - P.finishEnd) / Math.max(1e-3, 1 - P.finishEnd));
  }
  out.x = from[0] + (to[0] - from[0]) * t;
  out.y = from[1] + (to[1] - from[1]) * t;
  out.z = from[2] + (to[2] - from[2]) * t;
  const reach = shell ? (firstShell ? smooth(p / 0.22) : 1) : smooth(p / P.reachEnd) * (1 - smooth((p - P.finishEnd) / Math.max(1e-3, 1 - P.finishEnd)));
  out.roll = P.leftRoll + (P.reachRoll - P.leftRoll) * reach;
  out.pitch = P.reachPitch * reach;
}
