import type { V2 } from '../whitebox/types';

/**
 * 第一章重做：每张图编进游戏时、白盒以外要补的东西（白盒只管可玩区的版面）。
 * 图外一圈的地形怎么续、远景地标、白杨的叶色、沙暴从哪边来……都是构图概念图（docs/art/concepts/ch1-routes/views/）里定下来的。
 */
export interface FarLandmark {
  name: string;
  /** public/assets/props/<asset>.glb */
  asset: string;
  at: V2;
  /** 整体缩放 */
  scale: number;
  /** 俯视逆时针（度）；资产正面朝 +Z */
  yaw: number;
  /** 往地里埋多少米 */
  sink?: number;
  /** 脚下垫一座沙丘（半径、高）：远景地标坐在丘顶上 */
  mound?: { r: number; h: number };
}

export interface RedoMapConfig {
  /** 图外一圈（MARGIN 米）的地形：从图边的高度起，每 100 m 抬多少米、沙丘起伏多大 */
  margin: { rise: number; dunes: number };
  /** 白杨叶色 */
  poplar?: 'green' | 'gold';
  /** 看得见走不到的远景地标（摆在图外，不进碰撞和导航） */
  far?: FarLandmark[];
  /** 周期沙暴：从哪个据点（白盒点位 id）、从哪边刮来（网页 XZ） */
  storm?: { site: string; from: V2; radius: number };
  /** 流沙（白盒里画成泥色圆斑的位置、半径） */
  quicksand?: { at: V2; r: number }[];
}

export const REDO_MAPS: Record<string, RedoMapConfig> = {
  '1-1': {
    margin: { rise: 5, dunes: 6 },
    far: [
      // 用户 2026-11-25 看旧 1-1：「这个佛像远景做的很不错」。照旧场景的构图：出生点左前方约 40°（北偏东），
      // 旧的是 244 m 外放大 2.2 倍；这里推到图外 330 m，放大 3 倍保持同样的视角大小，面朝古道
      { name: '远景坐佛', asset: 'SM_Tripo_DesertSeatedColossus', at: [283, -47], scale: 3, yaw: -50, sink: 2, mound: { r: 70, h: 10 } },
    ],
    storm: { site: '4', from: [1, 0], radius: 30 },
  },
  '1-2': { margin: { rise: 6, dunes: 7 }, quicksand: [{ at: [148, 97], r: 5 }, { at: [162, 96], r: 5.5 }, { at: [181, 100], r: 5 }] },
  '1-3': { margin: { rise: 5, dunes: 8 } },
  '1-4': { margin: { rise: 10, dunes: 10 }, poplar: 'green' },
  '1-A': { margin: { rise: 4, dunes: 5 }, poplar: 'gold' },
};
