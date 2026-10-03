import type { StatKey } from './types';

/** 所有属性的默认基础值（英雄 base 会覆盖其中一部分） */
export const BASE_STATS: Record<StatKey, number> = {
  maxHp: 100,
  maxShield: 50,
  shieldRegenDelay: 3,
  shieldRegenRate: 30,
  hpRegen: 0,
  damageReduction: 0,
  lifesteal: 0,
  killHeal: 0,
  killShield: 0,

  moveSpeed: 7.5,
  jumpVelocity: 8.6,
  extraJumps: 0,
  dashCooldown: 1.6,
  dashCharges: 1,

  damagePct: 0,
  critChance: 0.05,
  critDamagePct: 0,
  fireRatePct: 0,
  reloadSpeedPct: 0,
  magSizePct: 0,
  ammoReservePct: 0,
  spreadPct: 0,
  recoilPct: 0,
  projectileSpeedPct: 0,
  explosionRadiusPct: 0,
  explosionDamagePct: 0,
  bossDamagePct: 0,
  eliteDamagePct: 0,
  shieldDamagePct: 0,
  armorDamagePct: 0,

  elementChancePct: 0,
  elementDamagePct: 0,
  fireDamagePct: 0,
  shockDamagePct: 0,
  corrodeDamagePct: 0,
  reactionDamagePct: 0,
  reactionHaste: 0,

  skillDamagePct: 0,
  skillHaste: 0,
  secondaryCharges: 0,

  pickupRadius: 3.5,
  coinGainPct: 0,
  luck: 0,
};

export type StatFormat = 'flat' | 'pct' | 'sec' | 'int';

/** 属性中文名与显示格式（UI 描述用） */
export const STAT_INFO: Record<StatKey, { name: string; format: StatFormat }> = {
  maxHp: { name: '生命上限', format: 'flat' },
  maxShield: { name: '护盾上限', format: 'flat' },
  shieldRegenDelay: { name: '护盾恢复延迟', format: 'sec' },
  shieldRegenRate: { name: '护盾恢复速度', format: 'flat' },
  hpRegen: { name: '每秒生命恢复', format: 'flat' },
  damageReduction: { name: '伤害减免', format: 'pct' },
  lifesteal: { name: '吸血', format: 'pct' },
  killHeal: { name: '击杀回血', format: 'flat' },
  killShield: { name: '击杀回盾', format: 'flat' },
  moveSpeed: { name: '移动速度', format: 'flat' },
  jumpVelocity: { name: '跳跃力', format: 'flat' },
  extraJumps: { name: '额外跳跃', format: 'int' },
  dashCooldown: { name: '冲刺冷却', format: 'sec' },
  dashCharges: { name: '冲刺次数', format: 'int' },
  damagePct: { name: '武器伤害', format: 'pct' },
  critChance: { name: '暴击率', format: 'pct' },
  critDamagePct: { name: '暴击伤害', format: 'pct' },
  fireRatePct: { name: '射速', format: 'pct' },
  reloadSpeedPct: { name: '换弹速度', format: 'pct' },
  magSizePct: { name: '弹匣容量', format: 'pct' },
  ammoReservePct: { name: '备弹上限', format: 'pct' },
  spreadPct: { name: '散布', format: 'pct' },
  recoilPct: { name: '后坐力', format: 'pct' },
  projectileSpeedPct: { name: '弹速', format: 'pct' },
  explosionRadiusPct: { name: '爆炸范围', format: 'pct' },
  explosionDamagePct: { name: '爆炸伤害', format: 'pct' },
  bossDamagePct: { name: '首领伤害', format: 'pct' },
  eliteDamagePct: { name: '精英伤害', format: 'pct' },
  shieldDamagePct: { name: '对护盾伤害', format: 'pct' },
  armorDamagePct: { name: '对护甲伤害', format: 'pct' },
  elementChancePct: { name: '元素触发率', format: 'pct' },
  elementDamagePct: { name: '元素伤害', format: 'pct' },
  fireDamagePct: { name: '灼烧伤害', format: 'pct' },
  shockDamagePct: { name: '雷殛伤害', format: 'pct' },
  corrodeDamagePct: { name: '蚀化伤害', format: 'pct' },
  reactionDamagePct: { name: '反应伤害', format: 'pct' },
  reactionHaste: { name: '反应急速', format: 'pct' },
  skillDamagePct: { name: '技能伤害', format: 'pct' },
  skillHaste: { name: '技能急速', format: 'pct' },
  secondaryCharges: { name: '副技能充能', format: 'int' },
  pickupRadius: { name: '拾取范围', format: 'flat' },
  coinGainPct: { name: '金币获取', format: 'pct' },
  luck: { name: '幸运', format: 'flat' },
};

export function formatStat(key: StatKey, value: number): string {
  const f = STAT_INFO[key].format;
  const sign = value > 0 ? '+' : '';
  switch (f) {
    case 'pct':
      return `${sign}${Math.round(value * 100)}%`;
    case 'sec':
      return `${sign}${value.toFixed(1)}秒`;
    case 'int':
      return `${sign}${Math.round(value)}`;
    default:
      return `${sign}${Math.round(value * 10) / 10}`;
  }
}

interface Modifier {
  key: StatKey;
  value: number;
  source: string;
}

/**
 * 属性容器：最终值 = 基础值 + 所有修饰值之和。
 * 修饰按 source 分组，便于秘卷 / 天赋 / 临时增益整体移除。
 */
export class Stats {
  private base: Record<StatKey, number> = { ...BASE_STATS };
  private mods: Modifier[] = [];
  private cache = new Map<StatKey, number>();
  /** 每次变化自增，外部可用于缓存失效判断 */
  version = 0;

  get(key: StatKey): number {
    const c = this.cache.get(key);
    if (c !== undefined) return c;
    let v = this.base[key];
    for (const m of this.mods) if (m.key === key) v += m.value;
    this.cache.set(key, v);
    return v;
  }

  /** 1 + get(key)，用于 Pct 类属性，结果不小于 0.05 */
  mult(key: StatKey): number {
    return Math.max(0.05, 1 + this.get(key));
  }

  getBase(key: StatKey): number {
    return this.base[key];
  }

  setBase(key: StatKey, value: number): void {
    this.base[key] = value;
    this.dirty();
  }

  /** 重置基础值为默认 + overrides，并清空所有修饰 */
  reset(overrides?: Partial<Record<StatKey, number>>): void {
    this.base = { ...BASE_STATS, ...(overrides ?? {}) };
    this.mods.length = 0;
    this.dirty();
  }

  add(key: StatKey, value: number, source: string): void {
    if (value === 0) return;
    this.mods.push({ key, value, source });
    this.dirty();
  }

  removeSource(source: string): void {
    const before = this.mods.length;
    this.mods = this.mods.filter((m) => m.source !== source);
    if (this.mods.length !== before) this.dirty();
  }

  hasSource(source: string): boolean {
    return this.mods.some((m) => m.source === source);
  }

  /** 列出某 source 的全部修饰（调试 / UI） */
  modsFrom(source: string): { key: StatKey; value: number }[] {
    return this.mods.filter((m) => m.source === source).map((m) => ({ key: m.key, value: m.value }));
  }

  private dirty(): void {
    this.cache.clear();
    this.version++;
  }
}
