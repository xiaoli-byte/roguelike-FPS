/**
 * UI 使用的中文文案映射（写死，避免依赖其他模块的具体实现）。
 */
import type { Element, HeroDef, StatKey, StatusId } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { STAT_INFO } from '../core/Stats';
import { cssHex } from './dom';

/**
 * 属性增量的显示（与 core/Stats.formatStat 相同，但 flat 类保留两位小数：
 * 例如移速 +0.15 不会被显示成 +0.2）。
 */
export function fmtStat(key: StatKey, value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const sign = v > 0 ? '+' : '';
  switch (STAT_INFO[key]?.format) {
    case 'pct':
      return `${sign}${Math.round(v * 100)}%`;
    case 'sec':
      return `${sign}${v.toFixed(1)}秒`;
    case 'int':
      return `${sign}${Math.round(v)}`;
    default:
      return `${sign}${Math.round(v * 100) / 100}`;
  }
}

/** 精英词缀（与 enemies/Affixes.ts 的 id 一致；UI 不 import 敌人模块的实现） */
export const AFFIX_LABELS: Record<string, { name: string; color: string; hint: string }> = {
  swift: { name: '迅捷', color: '#49d8ff', hint: '移速与攻速提高' },
  shielded: { name: '坚盾', color: '#6f9dff', hint: '额外护盾，脱战回盾' },
  volatile: { name: '爆裂', color: '#ff7a3a', hint: '死亡时爆炸，别贴身击杀' },
  frenzied: { name: '狂暴', color: '#ff4a32', hint: '低血量时狂暴' },
};

/** 武器 id → 中文名 / 类别（DESIGN.md 第 7 节） */
export const WEAPON_NAMES: Record<string, { name: string; category: string }> = {
  revolver: { name: '赤铜左轮', category: '手枪' },
  smg: { name: '蜂鸣冲锋枪', category: '冲锋枪' },
  rifle: { name: '裂风步枪', category: '步枪' },
  burst: { name: '三叠点射枪', category: '步枪' },
  shotgun: { name: '碎岩霰弹', category: '霰弹枪' },
  sniper: { name: '鹰隼狙击', category: '狙击枪' },
  launcher: { name: '焚城榴弹', category: '发射器' },
  crossbow: { name: '追魂连弩', category: '弩' },
  beam: { name: '雷弧发射器', category: '光束' },
  minigun: { name: '旋风机炮', category: '重武器' },
  swarm: { name: '蜂群飞弹', category: '发射器' },
  flamer: { name: '朱雀吐息', category: '喷火器' },
  stormpod: { name: '青冥雷蛊', category: '发射器' },
  magmashot: { name: '赤蛟霰铳', category: '霰弹枪' },
  trinity: { name: '三才转轮', category: '手枪' },
  railgun: { name: '贯虹灵炮', category: '蓄能炮' },
  lantern: { name: '蚀蛊灯', category: '蛊灯' },
  demon_blade: { name: '魔刀千刃', category: '刀' },
};

export function weaponName(defId: string): string {
  return WEAPON_NAMES[defId]?.name ?? defId;
}

/** 英雄头像字（没有图片时用单字徽记） */
const HERO_GLYPHS: Record<string, string> = { fox: '狐', falcon: '隼', bear: '熊' };

export function heroGlyph(hero: HeroDef | null | undefined): string {
  if (!hero) return '侠';
  return HERO_GLYPHS[hero.id] ?? (hero.name.charAt(0) || '侠');
}

export function heroColor(hero: HeroDef | null | undefined): string {
  return hero ? cssHex(hero.color) : '#d6ae5c';
}

/** 英雄选择界面的定位 / 上手难度 / 玩法标签 / 心得 */
export interface HeroMeta {
  role: string;
  /** 上手难度：1 简单、2 中等、3 进阶 */
  difficulty: 1 | 2 | 3;
  tags: string[];
  tip: string;
}

export const HERO_META: Record<string, HeroMeta> = {
  fox: { role: '火焰爆发', difficulty: 2, tags: ['灼烧', '范围', '爆发'], tip: '先用燃爆雷点燃敌群，再借余烬被动收割' },
  falcon: { role: '雷电机动', difficulty: 3, tags: ['雷殛', '空战', '精准'], tip: '保持滞空：二段跳 + 滑翔时伤害更高' },
  bear: { role: '近战坦克', difficulty: 1, tags: ['护盾', '控制', '霰弹'], tip: '顶在前线，用磐石壁垒扛住首领大招' },
};

const DEFAULT_HERO_META: HeroMeta = { role: '均衡', difficulty: 2, tags: [], tip: '' };

export function heroMeta(hero: HeroDef | null | undefined): HeroMeta {
  return (hero && HERO_META[hero.id]) || DEFAULT_HERO_META;
}

/** 上手难度文字（下标即难度） */
export const DIFFICULTY_NAMES: readonly string[] = ['', '简单', '中等', '进阶'];

/** 元素单字标记 */
export const ELEMENT_GLYPH: Record<Element, string> = { none: '', fire: '火', shock: '雷', corrode: '蚀' };

export function elementCss(el: Element): string {
  return cssHex(ELEMENT_COLORS[el]);
}

/** 敌人状态小标 */
export const STATUS_BADGES: { id: StatusId; glyph: string; color: string; name: string }[] = [
  { id: 'burn', glyph: '灼', color: cssHex(ELEMENT_COLORS.fire), name: '灼烧' },
  { id: 'shock', glyph: '雷', color: cssHex(ELEMENT_COLORS.shock), name: '雷殛' },
  { id: 'corrode', glyph: '蚀', color: cssHex(ELEMENT_COLORS.corrode), name: '蚀化' },
  { id: 'stun', glyph: '晕', color: '#f3e9a6', name: '眩晕' },
];

/** 秘卷标签（英文 id → 中文）；已经是中文的原样显示 */
const TAG_NAMES: Record<string, string> = {
  damage: '伤害', dmg: '伤害', crit: '暴击', headshot: '爆头', precision: '精准',
  fireRate: '射速', firerate: '射速', rate: '射速', reload: '换弹', mag: '弹匣', ammo: '弹药',
  fire: '灼烧', burn: '灼烧', shock: '雷殛', lightning: '雷殛', corrode: '蚀化', poison: '蚀化', element: '元素', elemental: '元素',
  skill: '技能', skills: '技能', cooldown: '冷却',
  survival: '生存', defense: '防御', shield: '护盾', health: '生命', hp: '生命', heal: '治疗', lifesteal: '吸血', armor: '护甲',
  mobility: '机动', move: '机动', speed: '移速', dash: '冲刺', jump: '跳跃',
  economy: '经济', coins: '金币', gold: '金币', luck: '幸运',
  explosion: '爆炸', explosive: '爆炸', projectile: '投射物',
  onHit: '命中时', onhit: '命中时', onKill: '击杀时', onkill: '击杀时', onReload: '换弹时', onreload: '换弹时',
  onHurt: '受伤时', onhurt: '受伤时', onShieldBreak: '破盾时', onshieldbreak: '破盾时', trigger: '触发',
  risk: '高风险', cursed: '诅咒', legendary: '传说', boss: '首领', elite: '精英',
};

export function tagName(tag: string): string {
  if (/[^\x00-\x7f]/.test(tag)) return tag;
  return TAG_NAMES[tag] ?? TAG_NAMES[tag.toLowerCase()] ?? tag;
}

/** 中文数字（章节用） */
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function cnNum(n: number): string {
  if (n >= 0 && n <= 10) return CN_DIGITS[n];
  return String(n);
}

/** 操作说明（DESIGN.md 第 2 节） */
export const CONTROLS: { keys: string[]; action: string; together?: boolean }[] = [
  { keys: ['W', 'A', 'S', 'D'], action: '移动', together: true },
  { keys: ['空格'], action: '跳跃（部分英雄可二段跳）' },
  { keys: ['Shift'], action: '冲刺（有充能与冷却）' },
  { keys: ['左键'], action: '射击' },
  { keys: ['右键'], action: '瞄准（缩放视野、降低散布）；持魔刀千刃时切换形态' },
  { keys: ['R'], action: '换弹' },
  { keys: ['1', '2', '滚轮', 'X'], action: '切换武器' },
  { keys: ['Q'], action: '主技能（长冷却）' },
  { keys: ['E'], action: '副技能（多充能投掷类）' },
  { keys: ['V', '中键'], action: '武器技能（魔刀千刃：千刃·无间）' },
  { keys: ['F'], action: '交互：拾取武器、开宝箱、购买、进入传送门' },
  { keys: ['Tab'], action: '按住查看已获得秘卷与属性' },
  { keys: ['Esc', 'P'], action: '暂停' },
];
