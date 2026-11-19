/**
 * 夔与 M7（src/world/mechanisms/：落雷 LightningStrike、导体 Conductor、高原雷暴 PlateauStorm）之间的适配层。
 * 这三样由 M7 实现；夔这边只经这里调用——M7 没接上时（hooks 为 null）夔照常打，只是没有雷：
 *   · 捶胸引雷的每一捶照样捶（鼓心张开 × 1.4、鼓皮环、顿帧），落雷记在 pendingBolts 里（测试 / 调试看得到「该劈几道」）；
 *   · 三阶段外圈落雷、转阶段的远雷、登场劈残鼓同样只记数；
 *   · 召鼓给经幡杆充电、大跳落地的回劈（经幡杆 4.5 m 内带电就回劈）什么都不做；
 *   · 高原雷暴（登场开头起、倒下 1.5 s 后退）不起。
 *
 * M7 合进来以后在关卡载入时（或 mechanisms 模块初始化时）调一次：
 *   bindKuiStorm({
 *     strike: (p, o) => LightningStrike.strike(p, { warn: o.warn, radius: o.radius, damage: o.damage, source: o.source, noTelegraph: o.noTelegraph, ignoreConductors: o.ignoreConductors, height: o.height }),
 *     nearestCharged: (p, r) => Conductor.nearestCharged(p, r),          // → { top, base, discharge() } | null
 *     chargeConductors: (center, radius, amount) => { for (const c of Conductor.all) if (inside(c.base)) c.addCharge(amount); },
 *     beginStorm: (center, spec) => WeatherDirector.beginPlateauStorm({ center, ...spec }),   // → { end(), done }
 *     clearStrikes: () => LightningStrike.clearAll(),
 *   });
 * 卸载时 bindKuiStorm(null)。签名见下面的 KuiStormHooks；所有数值（预警、半径、伤害）由夔按 Unity 定好再传进来，M7 不用知道夔。
 */
import type * as THREE from 'three';
import type { IEnemy } from '../../../core/types';

/** 一道落雷的参数（Unity StrikeOptions 的子集） */
export interface KuiStrikeOptions {
  /** 预警秒数（0 = 立刻劈） */
  warn: number;
  /** 伤害半径（米） */
  radius: number;
  /** 打玩家的伤害（已含难度 / 狂怒；0 = 只演出） */
  damage: number;
  /** 伤害来源（夔本身；null = 环境） */
  source: IEnemy | null;
  /** 不画地面预警 */
  noTelegraph?: boolean;
  /** 不被附近的导体（经幡杆）吸走 */
  ignoreConductors?: boolean;
  /** 雷从多高劈下（米，演出用） */
  height?: number;
}

/** 一根导体（经幡杆）：顶端 / 底座的世界位置，放电（回劈后清空电量） */
export interface KuiConductor {
  readonly top: THREE.Vector3;
  readonly base: THREE.Vector3;
  discharge(): void;
}

/** 高原雷暴的参数（Unity PlateauStormSpec 的子集，KuiBrain.EnsureStorm 的数） */
export interface KuiStormSpec {
  aroundPlayer: boolean;
  strikeMin: number;
  strikeMax: number;
  intervalMin: number;
  intervalMax: number;
  damage: number;
  chargeFoes: number;
  fadeIn: number;
  fadeOut: number;
  darken: number;
  rain: number;
}

export interface KuiStormTicket {
  /** 退场（fadeOut 秒） */
  end(): void;
  readonly done: boolean;
}

export interface KuiStormHooks {
  /** 在 p 处劈一道雷（地面高度由 M7 自己贴） */
  strike(p: THREE.Vector3, o: KuiStrikeOptions): void;
  /** 离 p 水平 radius 米内最近的带电导体；没有为 null */
  nearestCharged(p: THREE.Vector3, radius: number): KuiConductor | null;
  /** 给 center 周围 radius 米内的导体充电 amount（0..1） */
  chargeConductors(center: THREE.Vector3, radius: number, amount: number): void;
  /** 起一场高原雷暴（已经有了就复用）；返回票据 */
  beginStorm(center: THREE.Vector3, spec: KuiStormSpec): KuiStormTicket | null;
  /** 撤掉场上所有落雷（夔转阶段 / 倒下时，Unity LightningStrike.ClearAll） */
  clearStrikes(): void;
}

/** 当前接上的 M7 钩子（null = 没接） */
export const kuiStorm: { hooks: KuiStormHooks | null; pendingBolts: number } = { hooks: null, pendingBolts: 0 };

/** M7 接上 / 卸载时调 */
export function bindKuiStorm(hooks: KuiStormHooks | null): void {
  kuiStorm.hooks = hooks;
}

/** 夔调：劈一道雷（没接 M7 时只记数） */
export function kuiStrike(p: THREE.Vector3, o: KuiStrikeOptions): void {
  const h = kuiStorm.hooks;
  if (!h) {
    kuiStorm.pendingBolts++;
    return;
  }
  try {
    h.strike(p, o);
  } catch (err) {
    console.error('[Kui] 落雷钩子出错', err);
  }
}

/** Unity KuiBrain.EnsureStorm 的雷暴参数 */
export const KUI_STORM_SPEC: KuiStormSpec = {
  aroundPlayer: false, strikeMin: 36, strikeMax: 90, intervalMin: 2.5, intervalMax: 6, damage: 0, chargeFoes: 8,
  fadeIn: 3, fadeOut: 4, darken: 0.75, rain: 1,
};

let ticket: KuiStormTicket | null = null;

/** 要一场高原雷暴（登场演出开头 / 没演出时生成那一刻）：已经有了就复用；没接 M7 时什么都不做 */
export function kuiEnsureStorm(center: THREE.Vector3): void {
  const h = kuiStorm.hooks;
  if (!h || (ticket && !ticket.done)) return;
  try {
    ticket = h.beginStorm(center, KUI_STORM_SPEC);
  } catch (err) {
    console.error('[Kui] 雷暴钩子出错', err);
  }
}

/** 雷暴退场（夔倒下 1.5 s 后） */
export function kuiEndStorm(): void {
  const t = ticket;
  ticket = null;
  try {
    t?.end();
  } catch (err) {
    console.error('[Kui] 雷暴钩子出错', err);
  }
}

/** 给导体充电（召鼓） */
export function kuiChargeConductors(center: THREE.Vector3, radius: number, amount: number): void {
  try {
    kuiStorm.hooks?.chargeConductors(center, radius, amount);
  } catch (err) {
    console.error('[Kui] 导体钩子出错', err);
  }
}

/** 离 p 最近的带电导体（回劈）；没接 M7 时为 null */
export function kuiNearestCharged(p: THREE.Vector3, radius: number): KuiConductor | null {
  try {
    return kuiStorm.hooks?.nearestCharged(p, radius) ?? null;
  } catch (err) {
    console.error('[Kui] 导体钩子出错', err);
    return null;
  }
}

/** 撤掉场上的落雷（转阶段 / 倒下） */
export function kuiClearStrikes(): void {
  try {
    kuiStorm.hooks?.clearStrikes();
  } catch (err) {
    console.error('[Kui] 落雷钩子出错', err);
  }
}
