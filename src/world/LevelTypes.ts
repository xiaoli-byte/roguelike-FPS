/**
 * 关卡布局的数据类型（LevelGen 产出，ArenaBuilder / StageDirector 消费）。
 */
import type { StageType, ThemeId } from '../core/types';

export interface P2 { x: number; z: number }

/** 盒子外观：ArenaBuilder 据此选择绘制方式（collider / invisible 不绘制） */
export type BoxLook =
  | 'wall' | 'tower' | 'pilaster' | 'gatePillar'
  | 'platform' | 'stair' | 'parapet' | 'post' | 'roof'
  | 'lowWall' | 'crate' | 'pillar' | 'ruin' | 'stele' | 'steleBase' | 'lintel'
  | 'galleryRoof' | 'counter'
  | 'collider' | 'invisible';

export interface LayoutBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  look: BoxLook;
  /** 碰撞标签 */
  tag: string;
  /** 障碍物组（0 = 结构，永不移除；>0 可在连通性修复时整组移除） */
  group: number;
  noRaycast: boolean;
  /** 0..1 视觉随机值 */
  v: number;
}

export type DecoKind =
  | 'gate' | 'door' | 'wallBanner' | 'banner'
  | 'brazier' | 'stoneLantern' | 'lanternPost' | 'lanternString' | 'stall'
  | 'cactus' | 'statue' | 'dune'
  | 'pine' | 'crystal' | 'snowdrift'
  | 'spike' | 'rock' | 'pots';

export interface Deco {
  kind: DecoKind;
  x: number; y: number; z: number;
  /** 模型 +Z 朝向（rotation.y） */
  yaw: number;
  s: number;
  /** 尺寸参数（半宽 / 跨度 / 高度），含义随 kind 变化 */
  w: number;
  h: number;
  v: number;
  group: number;
  /** 带点光源 */
  lit: boolean;
}

export interface RuneMark { x: number; z: number; r: number; gold: boolean }

export interface LevelLayout {
  type: StageType;
  theme: ThemeId;
  half: number;
  minX: number; minZ: number; maxX: number; maxZ: number;
  floorY: number;
  wallThickness: number;
  wallHeight: number;
  boxes: LayoutBox[];
  decos: Deco[];
  /** 点光源位置（恒为 4 个，避免换关时灯光数量变化导致着色器重编译） */
  lights: { x: number; y: number; z: number }[];
  runes: RuneMark[];
  playerSpawn: P2;
  playerYaw: number;
  spawnPoints: P2[];
  rewardPoint: P2;
  portalPoints: P2[];
  shopPoint: P2;
  /** Boss 登场点（非 Boss 关 = 中心） */
  bossPoint: P2;
  center: P2;
  /** 生成期可达性校验点（台阶口等） */
  checks: (P2 & { g: number })[];
}
