/**
 * 灵宠的界面数据接口（M11c 第二期只做界面壳：灵宠本体是 M9）。
 * 灵宠系统接进来时调 UIManager.setPetSource(…) 给出两样东西：当前结契的灵宠（HUD 面板、行囊「灵宠」页）和灵宠名录（图鉴「灵宠」页签）。
 * 没接时 current() 返回 null、catalog 为空：HUD 面板不显示，行囊页与图鉴页显示空态。
 * 字段照 Unity Pet / PetDef 里界面读的那些。本文件不 import 运行时模块。
 */
import type { Element } from '../core/types';

/** 灵宠定义里界面要的部分（Unity PetDef） */
export interface PetDefView {
  id: string;
  name: string;
  /** 称号 */
  title: string;
  /** 品阶名（凡品 / 灵品…）与品阶色（0xRRGGBB） */
  rarityName: string;
  rarityColor: number;
  /** 定位（可空） */
  role?: string;
  element: Element;
  lore?: string;
  attackDesc?: string;
  passiveName?: string;
  passiveDesc?: string;
  skillName?: string;
  skillDesc?: string;
  /** 灵技基础冷却（秒） */
  skillCooldown: number;
  awakenDesc?: string;
}

/** 结契中的灵宠（Unity Pet） */
export interface PetView {
  def: PetDefView;
  level: number;
  maxLevel: number;
  /** 几级觉醒 */
  awakenLevel: number;
  awakened: boolean;
  xp: number;
  /** 升下一级要的经验（≤ 0 = 已满） */
  xpNext: number;
  /** 灵技剩余冷却 / 当前冷却时长（秒） */
  skillLeft: number;
  skillCooldown: number;
  skillReady: boolean;
  /** 灵技施放中 */
  busy: boolean;
  /** 本局灵宠造成的伤害 */
  damageDealt: number;
  /** 最近一次放灵技的时间戳（任意单调计数，变了 = 刚放过一次；HUD 的技能盘闪一下） */
  castStamp?: number;
}

export interface PetSource {
  /** 当前结契的灵宠（没有为 null） */
  current(): PetView | null;
  /** 灵宠名录（图鉴用；PetLibrary 的顺序） */
  catalog(): readonly PetDefView[];
}

export const EMPTY_PETS: PetSource = { current: () => null, catalog: () => [] };

/** 灵契等级一行（Unity PetPanelWidget 的富文本） */
export function petLevelRich(p: Pick<PetView, 'level' | 'maxLevel' | 'awakened' | 'awakenLevel'>): string {
  if (p.level >= p.maxLevel) return `灵契 Lv.${p.level} <color=#ffcf5a>· 觉醒 · 满级</color>`;
  return `灵契 Lv.${p.level}` + (p.awakened ? ' <color=#ffcf5a>· 觉醒</color>' : ` <color=#a09888>（${p.awakenLevel} 级觉醒）</color>`);
}

/** 灵契状态（行囊灵宠页） */
export function petStateText(p: Pick<PetView, 'level' | 'maxLevel' | 'awakened' | 'awakenLevel'>): string {
  return p.level >= p.maxLevel ? '觉醒 · 满级' : p.awakened ? '觉醒' : `${p.awakenLevel} 级觉醒`;
}

/** 经验比例 0..1（满级 = 1） */
export function petXpRatio(p: Pick<PetView, 'xp' | 'xpNext'>): number {
  return p.xpNext > 0 ? Math.min(1, Math.max(0, p.xp / p.xpNext)) : 1;
}
