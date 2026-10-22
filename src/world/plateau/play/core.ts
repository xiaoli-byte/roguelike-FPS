/**
 * 游玩模式各模块共用的上下文：玩家状态、受击、命中判定、元素与演出的接口。
 * 战斗设计见 docs/level-design/chuanzang-combat-v1.md。
 */
import type * as THREE from 'three';
import type { HeightGrid } from '../grid';
import type { CollisionWorld, Walker } from '../walker';
import type { Weather } from '../weather';
import type { Cinema } from './cinema';
import type { ElementSystem, StatusBag } from './elements';
import type { CombatFx } from './fx';
import type { Kit } from './kit';
import type { NavField } from './nav';

export type Elem = 'fire' | 'shock' | 'corrode';

/** 一个可被子弹打中的球：mult 是伤害倍率（1 = 身体，> 1 = 弱点）；part 是部位名（蓑毛分区、雷石、鼓面） */
export interface HitSphere { c: THREE.Vector3; r: number; mult: number; part?: string }

/** 一次伤害的附加信息 */
export interface DamageInfo {
  /** 子弹 / 爆炸 / 反应 / 持续伤害 / 环境（落石、回劈） */
  kind: 'bullet' | 'blast' | 'reaction' | 'dot' | 'env';
  /** 附着的元素（反应伤害、持续伤害不再附着） */
  elem?: Elem;
  /** 元素强度（反应威力，缺省 = 伤害） */
  power?: number;
  /** 子弹命中的那个球 */
  sphere?: HitSphere;
  /** 伤害来源点（受击方向、爆炸击杀往哪边飞） */
  from?: THREE.Vector3;
  /** 韧性伤害倍率（缺省：子弹 1、弱点 2、爆炸 3） */
  poise?: number;
  /** 反应深度（反应扩散出去的元素 +1，到 2 不再反应） */
  depth?: number;
  /** 爆炸半径（獓狠按它烧掉半径内的每一片蓑毛） */
  blastR?: number;
}

export interface Target {
  readonly alive: boolean;
  readonly label: string;
  /** 本帧的命中球（世界坐标） */
  spheres(): readonly HitSphere[];
  /** 被打中：返回实际造成的伤害 */
  hit(dmg: number, mult: number, at: THREE.Vector3, info?: DamageInfo): number;
}

/** 能挂元素、能被眩晕的战斗单位（雷魅、领主、领主召来的帮手） */
export interface Actor extends Target {
  readonly pos: THREE.Vector3;
  readonly isBoss: boolean;
  readonly status: StatusBag;
  /** 本章规则：带电的雷魅算身上有雷殛（燎的火一碰就是焚雷） */
  charged(): boolean;
  /** 被电传过来 / 衔雷：带电 sec 秒 */
  charge(sec: number): void;
  /** 身体中心（反应爆点、雷弧落点） */
  center(out: THREE.Vector3): THREE.Vector3;
  /** 眩晕 sec 秒（领主：打断非霸体的前摇；why 给浮字） */
  stun(sec: number, why: string): void;
  /** 是否属于玩家的敌人一方里「同一群」（电会传、雷弧只跳同群；领主的帮手算领主一群） */
  readonly group: unknown;
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

/** 导体：经幡杆、拉则、碉楼、铁索、雷桩、导雷石柱。落雷 5 m 内有导体就劈导体；被劈中带电 10 秒 */
export interface Conductor { pos: THREE.Vector3; top: number; charge: number; name: string }

export interface BoltOpts {
  /** 半径（默认 3.2） */
  r?: number;
  /** 预警时长（默认 1.2） */
  delay?: number;
  /** 对玩家的伤害（默认 18） */
  dmg?: number;
  source: string;
  /** 能被导体引走（默认 true） */
  conduct?: boolean;
  /** 劈下来之后（at = 实际落点；conductor = 被引走时的导体） */
  onStrike?: (at: THREE.Vector3, conductor: Conductor | null) => void;
}

export interface PlayCtx {
  scene: THREE.Scene;
  terrain: HeightGrid;
  world: CollisionWorld;
  walker: Walker;
  weather: Weather;
  fx: CombatFx;
  elements: ElementSystem;
  kit: Kit;
  cinema: Cinema;
  /** 追人的寻路场（以玩家为源点） */
  nav: NavField | null;
  player: PlayerState;
  /** 游戏时间（秒，慢放时变慢） */
  time: number;
  /** 玩家脚底 */
  feet: THREE.Vector3;
  /** 玩家身体中心（投射物判定用） */
  center: THREE.Vector3;
  /** 玩家的水平速度 */
  pvel: THREE.Vector2;
  /** 玩家朝向（弧度，Walker.yaw） */
  readonly yaw: number;
  /** 场上所有活着的战斗单位（反应、雷弧、电会传用） */
  actors(): readonly Actor[];
  conductors: Conductor[];
  /** 到可玩区边界的有符号距离（区内为负）：怪不出可玩区 */
  bound(x: number, z: number): number;
  hurt(dmg: number, source: string, knock?: KnockBack, elem?: Elem): void;
  /** 一道落雷：预警圈 → 劈下；导体引雷、溅电、衔雷 / 吞雷都在这里 */
  bolt(x: number, z: number, opts: BoltOpts): void;
  say(text: string, seconds?: number): void;
  /** 叫醒 (x, z) 周围 r 内的兽群（啸獭哨兵尖啸） */
  wake(x: number, z: number, r: number): void;
  /** 屏幕震动（0..1） */
  shake(amount: number): void;
  /** 燎的火落在这里（燃爆雷、火灵、炎心子弹）：点燃龙卷、烽火这类场地机关 */
  onFire(at: THREE.Vector3, r: number): void;
  /** 玩家是否无敌（冲刺无敌帧、演出） */
  invulnerable(): boolean;
  /** 伤害结算之后（伤害数字、反应浮字） */
  dealt(at: THREE.Vector3, d: number, weak: boolean, info: DamageInfo): void;
}

export const PLAYER_R = 0.55;
