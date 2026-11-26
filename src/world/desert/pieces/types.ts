import type * as THREE from 'three';
import type { UnityEnvironment } from '../../UnityLevelLibrary';

/**
 * 第一章重做的「新做的件」（2026-11-25 用户：要新做的件照清单出，和概念图不一样的两处也补齐）。
 * 现有 59 件沙漠资产里没有、白盒里标了 needs 的七种：白杨、胡杨枯木、半埋驼骨、九层楼、贴崖木栈梯、月泉阁（大开间敞厅 + 长廊 + 门楼）、坐像殿。
 * 全部程序化建模（Three.js 几何 + 风格化材质）：要按白盒的尺寸精确对上走法 / 碰撞，树要成百棵实例化，远景地标看得见走不到。
 *
 * 坐标同白盒（src/world/desert/whitebox/types.ts）：x 向东、z 向南（北 = −z）、y 向上，单位米；
 * 转角 rot / yaw 都是「俯视逆时针」的度数 = THREE 的 rotation.y（弧度换算），0 = 件的本地 +X 朝东。
 * 编译成游戏场景文档时直接用这个坐标（文档就是网页坐标，不再换算）。
 */
export type V2 = [number, number];
export type V3 = [number, number, number];
export type Quat = [number, number, number, number];

/** 碰撞盒（世界坐标）：中心、尺寸、朝向四元数（缺省不转）。编进场景文档的 colliders（kind 'box'） */
export interface PieceBox {
  center: V3;
  size: V3;
  rotation?: Quat;
  /** 调试 / 报告用 */
  name?: string;
}

/** 建件时拿到的环境 */
export interface PieceContext {
  /** 地面高度（地形，不含件）：树根、柱脚落地用 */
  ground(x: number, z: number): number;
  /** 低画质：少分段、少叶片 */
  low: boolean;
  /** 场景环境（风格化材质用它的三色环境光 / 主光；检视页给一份沙漠午后的） */
  environment?: Pick<UnityEnvironment, 'ambient' | 'sun'> | null;
}

/** 建好的一件（或一批实例化的同种件） */
export interface BuiltPiece {
  /** 挂进场景的网格（已经摆在世界坐标上；castShadow / receiveShadow 已设好） */
  object: THREE.Object3D;
  /** 世界坐标的碰撞盒：只给人能撞上 / 站上的部分（柱、墙、楼板、梯段、树干）；树冠、檐口、碎件不给 */
  colliders: PieceBox[];
  /** 每帧（风吹叶子、幡飘动……）；t = 秒 */
  update?(dt: number, t: number): void;
  dispose(): void;
}

/** 检视页的一个条目（每个件模块导出 LAB: LabPiece[]，检视页 desert-pieces.html 自动收集） */
export interface LabPiece {
  id: string;
  title: string;
  /** 一句话：这件是什么、白盒里在哪 */
  note: string;
  /** 检视页地面是 y = 0 的平地（也可以自己在 build 里垫台子 / 崖面）；ctx.ground 返回 0 */
  build(ctx: PieceContext): BuiltPiece | Promise<BuiltPiece>;
  /** 机位：玩家眼高的近看、远看剪影、俯视……（eye / look 世界坐标，fov 缺省 60） */
  views: { name: string; eye: V3; look: V3; fov?: number }[];
}
