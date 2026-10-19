/**
 * 游玩模式各模块共用的上下文：玩家状态、受击、命中判定的接口。
 */
import type * as THREE from 'three';
import type { Terrain } from '../terrain';
import type { CollisionWorld, Walker } from '../walker';
import type { Weather } from '../weather';
import type { CombatFx } from './fx';
import type { NavField } from './nav';

/** 一个可被子弹打中的球：mult 是伤害倍率（1 = 身体，> 1 = 弱点） */
export interface HitSphere { c: THREE.Vector3; r: number; mult: number }

export interface Target {
  readonly alive: boolean;
  readonly label: string;
  /** 本帧的命中球（世界坐标） */
  spheres(): readonly HitSphere[];
  /** 被打中：返回实际造成的伤害 */
  hit(dmg: number, mult: number, at: THREE.Vector3): number;
}

export interface PlayerState {
  hp: number; maxHp: number;
  shield: number; maxShield: number;
  /** 伤害倍率（领主奖励叠加） */
  dmgMul: number;
  alive: boolean;
  /** 上次受伤的时间（护盾 4 秒没挨打开始回） */
  lastHurt: number;
}

export interface KnockBack { x: number; z: number; up?: number }

export interface PlayCtx {
  scene: THREE.Scene;
  terrain: Terrain;
  world: CollisionWorld;
  walker: Walker;
  weather: Weather;
  fx: CombatFx;
  /** 追人的寻路场（以玩家为源点） */
  nav: NavField | null;
  player: PlayerState;
  /** 游戏时间（秒） */
  time: number;
  /** 玩家脚底 */
  feet: THREE.Vector3;
  /** 玩家身体中心（投射物判定用） */
  center: THREE.Vector3;
  hurt(dmg: number, source: string, knock?: KnockBack): void;
  say(text: string, seconds?: number): void;
}

export const PLAYER_R = 0.55;
