/**
 * 音效总表：SfxId → 合成配方 + 混音参数。
 * 三个分表的 id 联合必须覆盖全部 SfxId（漏掉任何一个都会编译报错）。
 */
import type { SfxId } from '../core/types';
import type { Recipe } from './Synth';
import { WEAPON_SFX } from './SfxWeapons';
import { COMBAT_SFX, ENEMY_VARIANT_SFX } from './SfxCombat';
import { UI_SFX } from './SfxUi';

export const SFX: Record<SfxId, Recipe> = { ...WEAPON_SFX, ...COMBAT_SFX, ...UI_SFX };

/** 带 position 播放时优先使用的配方（敌方事件借用了玩家音效 id，见 SfxCombat.ENEMY_VARIANT_SFX） */
export const SFX_POSITIONAL: Partial<Record<SfxId, Recipe>> = ENEMY_VARIANT_SFX;

export interface SfxMeta {
  /** 基础音量 */
  gain: number;
  /** 随机音高幅度（±） */
  pitch: number;
  /** 同 id 最小间隔（秒），0 = 不节流 */
  throttle: number;
  /** 混响发送量 */
  send: number;
  /** 抢占优先级：0 环境 / 1 敌人 / 2 反馈 / 3 玩家与关键提示 */
  prio: number;
}

function m(gain: number, o: Partial<SfxMeta> = {}): SfxMeta {
  return { gain, pitch: o.pitch ?? 0.04, throttle: o.throttle ?? 0.04, send: o.send ?? 0.12, prio: o.prio ?? 2 };
}

/** 枪声：不节流（射速由武器决定）、最高优先级 */
function gun(gain: number, send: number): SfxMeta {
  return { gain, pitch: 0.035, throttle: 0, send, prio: 3 };
}

const UI = { pitch: 0, throttle: 0.03, send: 0.04, prio: 3 };
const JINGLE = { pitch: 0, throttle: 0.2, send: 0.32, prio: 3 };

export const SFX_META: Record<SfxId, SfxMeta> = {
  shot_pistol: gun(0.55, 0.18),
  shot_smg: gun(0.4, 0.1),
  shot_rifle: gun(0.48, 0.12),
  shot_shotgun: gun(0.62, 0.2),
  shot_sniper: gun(0.66, 0.42),
  shot_launcher: gun(0.58, 0.2),
  shot_beam: gun(0.4, 0.12),
  shot_bow: gun(0.5, 0.12),
  shot_heavy: gun(0.42, 0.1),
  reload_start: m(0.42, { prio: 3, throttle: 0.05 }),
  reload_end: m(0.46, { prio: 3, throttle: 0.05 }),
  dry_fire: m(0.4, { prio: 3, throttle: 0.08, pitch: 0.02 }),
  weapon_switch: m(0.4, { prio: 3, throttle: 0.05 }),
  // 魔刀千刃：挥砍 / 命中节流很短（三段连斩约每 0.3 秒一次），贯穿混响最多（「千刃」的空间感）
  blade_swing: m(0.62, { prio: 3, throttle: 0.03, pitch: 0.05, send: 0.06 }),
  blade_hit: m(0.5, { prio: 3, throttle: 0.04, pitch: 0.05, send: 0.08 }),
  blade_throw: gun(0.95, 0.08),
  blade_recall: m(0.62, { prio: 3, throttle: 0.08, send: 0.12 }),
  blade_morph: m(0.42, { prio: 3, throttle: 0.08, send: 0.12 }),
  blade_dash: m(0.55, { prio: 3, throttle: 0.1, send: 0.12 }),
  blade_impale: m(0.7, { prio: 3, throttle: 0.1, pitch: 0.02, send: 0.3 }),

  hit: m(0.4, { throttle: 0.035, pitch: 0.06, send: 0.02 }),
  hit_crit: m(0.5, { throttle: 0.05, pitch: 0.02, send: 0.08, prio: 3 }),
  hit_shield: m(0.38, { throttle: 0.04, pitch: 0.06, send: 0.04 }),
  hit_armor: m(0.38, { throttle: 0.04, pitch: 0.06, send: 0.06 }),
  kill: m(0.5, { throttle: 0.05, pitch: 0.02, send: 0.08, prio: 3 }),
  explosion: m(0.75, { throttle: 0.03, pitch: 0.08, send: 0.35 }),

  player_hurt: m(0.55, { throttle: 0.08, prio: 3, send: 0.05 }),
  shield_break: m(0.6, { throttle: 0.25, prio: 3, send: 0.2 }),
  shield_recharge: m(0.42, { throttle: 0.3, prio: 3, send: 0.15 }),
  low_hp: m(0.6, { throttle: 0.3, pitch: 0, prio: 3, send: 0.02 }),
  jump: m(0.38, { throttle: 0.06, prio: 3, send: 0.03 }),
  land: m(0.5, { throttle: 0.08, prio: 3, send: 0.05 }),
  dash: m(0.5, { throttle: 0.08, prio: 3, send: 0.08 }),
  footstep: m(0.32, { throttle: 0.08, pitch: 0.1, prio: 1, send: 0.03 }),

  pickup_coin: m(0.42, { throttle: 0.04, pitch: 0.03, send: 0.08 }),
  pickup_ammo: m(0.48, { throttle: 0.06, send: 0.06 }),
  pickup_health: m(0.5, { throttle: 0.08, pitch: 0, send: 0.12 }),
  pickup_weapon: m(0.55, { throttle: 0.08, pitch: 0, send: 0.12, prio: 3 }),
  chest_open: m(0.6, { throttle: 0.2, pitch: 0, send: 0.25, prio: 3 }),
  portal: m(0.6, { throttle: 0.2, pitch: 0, send: 0.3, prio: 3 }),
  buy: m(0.55, { throttle: 0.08, pitch: 0, send: 0.1, prio: 3 }),
  scroll_get: m(0.62, { throttle: 0.2, pitch: 0, send: 0.35, prio: 3 }),

  enemy_shot: m(0.4, { throttle: 0.04, pitch: 0.07, prio: 1 }),
  enemy_melee: m(0.5, { throttle: 0.05, pitch: 0.06, prio: 1 }),
  enemy_alert: m(0.4, { throttle: 0.15, pitch: 0.1, prio: 1 }),
  enemy_death: m(0.45, { throttle: 0.04, pitch: 0.1, prio: 1, send: 0.15 }),
  enemy_spawn: m(0.4, { throttle: 0.08, pitch: 0.08, prio: 0, send: 0.2 }),
  enemy_charge: m(0.5, { throttle: 0.1, pitch: 0.05, prio: 2 }),
  boss_roar: m(0.68, { throttle: 0.3, pitch: 0.03, prio: 3, send: 0.4 }),
  boss_slam: m(0.85, { throttle: 0.1, pitch: 0.04, prio: 3, send: 0.35 }),
  telegraph: m(0.5, { throttle: 0.06, pitch: 0.02, prio: 2, send: 0.12 }),

  skill_fire: m(0.6, { throttle: 0.05, prio: 3, send: 0.2 }),
  skill_shock: m(0.55, { throttle: 0.05, prio: 3, send: 0.2 }),
  skill_earth: m(0.7, { throttle: 0.05, prio: 3, send: 0.28 }),
  skill_buff: m(0.55, { throttle: 0.1, pitch: 0, prio: 3, send: 0.3 }),
  skill_throw: m(0.5, { throttle: 0.05, prio: 3, send: 0.08 }),

  burn_tick: m(0.28, { throttle: 0.07, pitch: 0.12, prio: 0, send: 0.03 }),
  shock_zap: m(0.34, { throttle: 0.05, pitch: 0.1, prio: 0, send: 0.06 }),
  corrode_tick: m(0.28, { throttle: 0.08, pitch: 0.12, prio: 0, send: 0.03 }),

  ui_click: m(0.5, UI),
  ui_hover: m(0.45, { ...UI, throttle: 0.04 }),
  ui_confirm: m(0.55, UI),
  ui_deny: m(0.5, UI),

  wave_start: m(0.62, JINGLE),
  stage_clear: m(0.62, JINGLE),
  victory: m(0.72, { ...JINGLE, send: 0.4 }),
  defeat: m(0.72, { ...JINGLE, send: 0.4 }),
};
