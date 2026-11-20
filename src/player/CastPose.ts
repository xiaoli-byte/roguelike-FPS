/**
 * 技能出手的覆盖姿态（Unity Skills/CastPose.cs）：放出技能的那一刻，枪模按动作类型播一段短时间线，叠在第一人称枪模的姿态上——
 * 投掷（燃爆雷、雷鼓信标）往右下一沉、枪口压低，给出手让位；召唤（尾焰火灵）往左上一抬再往前一送；
 * 砸地（裂地重击）先抬后猛砸、带一下回弹；举手（磐石壁垒）枪往一侧放低；点名（雷目 · 裁决）往后一顿、枪口上挑。
 * 关键帧之间按 smoothstep 过渡，0.4–0.6 s 放完归零（出手干脆、不拖慢开火：叠加只动枪模，不锁武器）。
 * 位置（米）、旋转（弧度）用的就是 Viewmodel 组合姿态时的那套相机空间约定（x 右、y 上、z 朝玩家；rx 抬枪口），
 * Unity 的 FirstPersonViewmodel.OverlayPos / OverlayRot 同约定，数值原样。
 * 订阅 'skill:used'；WeaponSystem 每帧把 {@link CastPose.pos} / {@link CastPose.rot} 交给 Viewmodel。纯计算（evaluate）不碰场景。
 */
import type { GameContext } from '../core/types';

export type CastStyle = 'none' | 'throw' | 'summon' | 'slam' | 'raise' | 'mark';

/** 一个关键帧：时间（秒）、位置（米）、旋转（弧度） */
export interface CastKey {
  t: number;
  pos: readonly [number, number, number];
  rot: readonly [number, number, number];
}

const K = (t: number, x: number, y: number, z: number, rx: number, ry: number, rz: number): CastKey => ({ t, pos: [x, y, z], rot: [rx, ry, rz] });

/** 每条时间线首尾都是 0：放完就回到原姿态 */
export const CAST_TIMELINES: Record<Exclude<CastStyle, 'none'>, readonly CastKey[]> = {
  throw: [
    K(0, 0, 0, 0, 0, 0, 0),
    K(0.08, 0.04, -0.07, 0.02, -0.3, 0.05, -0.22),
    K(0.2, 0.05, -0.09, 0.03, -0.38, 0.06, -0.28),
    K(0.42, 0, 0, 0, 0, 0, 0),
  ],
  summon: [
    K(0, 0, 0, 0, 0, 0, 0),
    K(0.1, -0.01, 0.02, 0.03, 0.12, 0, 0.18),
    K(0.25, -0.02, 0.025, -0.02, 0.08, 0, 0.22),
    K(0.6, 0, 0, 0, 0, 0, 0),
  ],
  slam: [
    K(0, 0, 0, 0, 0, 0, 0),
    K(0.14, 0, 0.035, 0.02, 0.3, 0, 0.05),
    K(0.24, 0, -0.11, -0.02, -0.45, 0, -0.05),
    K(0.34, 0, -0.07, 0, -0.3, 0, 0),
    K(0.6, 0, 0, 0, 0, 0, 0),
  ],
  raise: [
    K(0, 0, 0, 0, 0, 0, 0),
    K(0.12, -0.03, -0.08, 0.02, -0.25, 0.1, 0.3),
    K(0.3, -0.03, -0.08, 0.02, -0.25, 0.1, 0.3),
    K(0.55, 0, 0, 0, 0, 0, 0),
  ],
  mark: [
    K(0, 0, 0, 0, 0, 0, 0),
    K(0.06, 0, 0.01, 0.035, 0.16, 0, 0.04),
    K(0.4, 0, 0, 0, 0, 0, 0),
  ],
};

/** 技能 id → 动作类型（没登记的技能不播） */
export function castStyleFor(skillId: string): CastStyle {
  switch (skillId) {
    case 'fox_blaze_grenade':
    case 'falcon_storm_beacon': return 'throw';
    case 'fox_nine_tails': return 'summon';
    case 'bear_earth_splitter': return 'slam';
    case 'bear_bastion': return 'raise';
    case 'falcon_hawk_verdict': return 'mark';
    default: return 'none';
  }
}

export function castTimeline(style: CastStyle): readonly CastKey[] {
  return style === 'none' ? [] : CAST_TIMELINES[style];
}

export interface Vec3Like { x: number; y: number; z: number }

/** 时间线在 t 秒的姿态（关键帧之间 smoothstep；超出末帧 = 0） */
export function evaluateCast(keys: readonly CastKey[], t: number, pos: Vec3Like, rot: Vec3Like): void {
  pos.x = pos.y = pos.z = rot.x = rot.y = rot.z = 0;
  if (keys.length < 2 || t <= keys[0].t || t >= keys[keys.length - 1].t) return;
  for (let i = 1; i < keys.length; i++) {
    if (t > keys[i].t) continue;
    const a = keys[i - 1], b = keys[i];
    let u = (t - a.t) / Math.max(1e-4, b.t - a.t);
    u = Math.max(0, Math.min(1, u));
    u = u * u * (3 - 2 * u);
    pos.x = a.pos[0] + (b.pos[0] - a.pos[0]) * u;
    pos.y = a.pos[1] + (b.pos[1] - a.pos[1]) * u;
    pos.z = a.pos[2] + (b.pos[2] - a.pos[2]) * u;
    rot.x = a.rot[0] + (b.rot[0] - a.rot[0]) * u;
    rot.y = a.rot[1] + (b.rot[1] - a.rot[1]) * u;
    rot.z = a.rot[2] + (b.rot[2] - a.rot[2]) * u;
    return;
  }
}

export class CastPose {
  /** 这一刻叠到枪模上的位置 / 旋转（不在播时为 0） */
  readonly pos: Vec3Like = { x: 0, y: 0, z: 0 };
  readonly rot: Vec3Like = { x: 0, y: 0, z: 0 };
  /** 正在播的动作 */
  playing: CastStyle = 'none';
  private keys: readonly CastKey[] | null = null;
  private startedAt = 0;

  constructor(private readonly ctx: Pick<GameContext, 'time' | 'events'>) {
    ctx.events?.on('skill:used', ({ skillId }) => this.play(castStyleFor(skillId)));
    ctx.events?.on('stage:loaded', () => this.stop());
  }

  /** 从头播一段动作（新的打断旧的） */
  play(style: CastStyle): void {
    const keys = castTimeline(style);
    if (keys.length < 2) return;
    this.keys = keys;
    this.playing = style;
    this.startedAt = this.ctx.time.now;
  }

  stop(): void {
    this.keys = null;
    this.playing = 'none';
    this.pos.x = this.pos.y = this.pos.z = this.rot.x = this.rot.y = this.rot.z = 0;
  }

  update(): void {
    const keys = this.keys;
    if (!keys) return;
    const t = this.ctx.time.now - this.startedAt;
    if (t >= keys[keys.length - 1].t || t < 0) {
      this.stop();
      return;
    }
    evaluateCast(keys, t, this.pos, this.rot);
  }
}
