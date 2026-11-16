/**
 * 技能用的分层特效入口（docs/art/fx-style.md 第五节）。这些不在 IFx 里（IFx 是全游戏的契约，这里只是火系技能先用上的几样），
 * 用 fxExtras(ctx) 取；特效系统换成别的实现（测试桩）时返回 null，调用方用 ?. 跳过即可。
 */
import type * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { SealHandle, SealOptions } from './Seal';

export type { SealHandle, SealOptions } from './Seal';

export interface IFxExtras {
  /** 画一枚法印：从外圈往里逐圈写出 → 停留 → 淡出 */
  seal(center: THREE.Vector3, normal: THREE.Vector3 | null, radius: number, color: number, opts?: SealOptions): SealHandle;
  /** 蓄力：四周一圈光点盘旋着向 target（+ offY）收拢 */
  gather(center: THREE.Vector3, color: number, count: number, radius: number, target: THREE.Vector3, offY?: number): void;
  /** 出手：沿 dir 的一束拉丝火星 + 一闪 */
  castSparks(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void;
  /** 飞行物身后落下的一条火舌 */
  flameShed(pos: THREE.Vector3, vel: THREE.Vector3, color: number, size?: number): void;
  /** 火系命中：一闪 → 火舌窜起 + 火星 → 余烬 */
  flameHit(pos: THREE.Vector3, color: number, scale?: number): void;
  /** 火系技能落点：甩出去的火舌、会蹦的炭火，慢半拍的符点和烟 */
  flameBurst(pos: THREE.Vector3, color: number, scale?: number): void;
  /** 砸地（土系）：碎石往外崩、贴地火星，慢半拍沿半径一圈尘团和几枚符点 */
  earthBurst(center: THREE.Vector3, color: number, radius: number): void;
  /** 落雷点 / 雷系出手：电弧贴地爬两拍、光屑迸开、一盏短灯 */
  arcBurst(center: THREE.Vector3, color: number, scale?: number): void;
}

export function fxExtras(ctx: GameContext): IFxExtras | null {
  const fx = ctx.fx as unknown as Partial<IFxExtras>;
  return typeof fx.seal === 'function' && typeof fx.flameBurst === 'function' ? (fx as IFxExtras) : null;
}
