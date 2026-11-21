/**
 * 键位表与改键（Unity P/Runtime/GameInput.cs 的动作表 + StartRebind / SaveBindings / ResetBindings 在网页的对应）。
 *   · BIND_DEFS：改键页 / 按键说明用的动作表（顺序同 Unity SettingsScreen.Actions），每个动作对应 core/Input 的一个动作名；
 *     「地图」「灵技」在 core/Input 里没有动作（地图由界面层读键，灵技等 M9 灵宠），键位只记在这里。
 *   · 改键只换第一个键盘绑定（同 Unity：冲刺的右 Shift 这类第二绑定留着），不查重（同 Unity）；
 *     覆盖项存 localStorage（只存改过的），启动时套到 ctx.input.bindings 上。
 *   · 网页差异：core/Input 的鼠标键是写死的（射击左键 / 瞄准右键 / 武器技能另绑中键），暂停由 Game 直接读 Esc / P——这三项只显示不改；没有手柄。
 * 本文件不 import 运行时模块（测试按 data: URL 直接加载）。
 */
import type { Action } from '../core/Input';

export const KEYBINDS_KEY = 'gunflame.keybinds.v1';

export type BindId =
  | 'jump' | 'dash' | 'fire' | 'aim' | 'reload' | 'interact' | 'skillPrimary' | 'skillSecondary' | 'weaponSkill'
  | 'weapon1' | 'weapon2' | 'swapWeapon' | 'petSkill' | 'inventory' | 'map' | 'pause';

export interface BindDef {
  id: BindId;
  /** 改键页里的名字 */
  label: string;
  /** core/Input 的动作名；null = 只在界面层用 */
  action: Action | null;
  /** 缺省键（KeyboardEvent.code；第一个是改键换的那个） */
  defaults: readonly string[];
  /** 写死的鼠标键（显示在键位前面；纯鼠标动作没有键盘绑定） */
  mouse?: string;
  /** 不能改（鼠标键写死、暂停由 Game 直接读键） */
  fixed?: boolean;
}

/** 改键表（顺序同 Unity SettingsScreen.Actions） */
export const BIND_DEFS: readonly BindDef[] = [
  { id: 'jump', label: '跳跃', action: 'jump', defaults: ['Space'] },
  { id: 'dash', label: '冲刺', action: 'dash', defaults: ['ShiftLeft', 'ShiftRight'] },
  { id: 'fire', label: '射击', action: 'fire', defaults: [], mouse: '鼠标左键', fixed: true },
  { id: 'aim', label: '瞄准', action: 'aim', defaults: [], mouse: '鼠标右键', fixed: true },
  { id: 'reload', label: '换弹', action: 'reload', defaults: ['KeyR'] },
  { id: 'interact', label: '交互', action: 'interact', defaults: ['KeyF'] },
  { id: 'skillPrimary', label: '主技能', action: 'skillPrimary', defaults: ['KeyQ'] },
  { id: 'skillSecondary', label: '副技能', action: 'skillSecondary', defaults: ['KeyE'] },
  { id: 'weaponSkill', label: '武器技能', action: 'weaponSkill', defaults: ['KeyV'] },
  { id: 'weapon1', label: '一号武器', action: 'weapon1', defaults: ['Digit1'] },
  { id: 'weapon2', label: '二号武器', action: 'weapon2', defaults: ['Digit2'] },
  { id: 'swapWeapon', label: '切换武器', action: 'swapWeapon', defaults: ['KeyX'] },
  { id: 'petSkill', label: '灵技', action: null, defaults: ['KeyG'] },
  { id: 'inventory', label: '行囊', action: 'inventory', defaults: ['Tab'] },
  { id: 'map', label: '地图', action: null, defaults: ['KeyM'] },
  { id: 'pause', label: '暂停', action: 'pause', defaults: ['Escape', 'KeyP'], fixed: true },
];

const NAMES: Record<string, string> = {
  Space: '空格', Escape: 'Esc', Enter: '回车', NumpadEnter: '小键盘回车', Tab: 'Tab', Backspace: '退格', CapsLock: 'Caps',
  ShiftLeft: 'Shift', ShiftRight: '右 Shift', ControlLeft: 'Ctrl', ControlRight: '右 Ctrl', AltLeft: 'Alt', AltRight: '右 Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
};

/** KeyboardEvent.code → 键帽文字（KeyR → R、Digit1 → 1、ShiftLeft → Shift、Space → 空格） */
export function keyName(code: string | undefined | null): string {
  if (!code) return '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return '小键盘 ' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return NAMES[code] ?? code;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface InputLike {
  bindings: Record<string, string[]>;
}

export class KeyBinds {
  private readonly over = new Map<BindId, string>();
  private readonly listeners: (() => void)[] = [];

  /** storage / input 可以为 null（测试、没有 localStorage）；构造时读存档并套到 input.bindings 上 */
  constructor(private readonly storage: Store | null, private readonly input: InputLike | null) {
    try {
      const raw = storage?.getItem(KEYBINDS_KEY);
      if (raw) {
        const o = JSON.parse(raw) as Record<string, unknown>;
        for (const d of BIND_DEFS) {
          const c = o?.[d.id];
          if (!d.fixed && typeof c === 'string' && c) this.over.set(d.id, c);
        }
      }
    } catch (err) {
      console.warn('[UI] 改键存档读不了，用默认键位', err);
    }
    this.apply();
  }

  static def(id: BindId): BindDef {
    const d = BIND_DEFS.find((x) => x.id === id);
    if (!d) throw new Error(`没有动作 ${id}`);
    return d;
  }

  /** 这个动作现在的键盘绑定（第一个是能改的那个） */
  codes(id: BindId): string[] {
    const d = KeyBinds.def(id);
    const list = d.defaults.slice();
    const o = this.over.get(id);
    if (o) {
      if (list.length > 0) list[0] = o;
      else list.push(o);
    }
    return list;
  }

  /** 第一个键盘绑定（没有为空串） */
  code(id: BindId): string {
    return this.codes(id)[0] ?? '';
  }

  /** code 是不是这个动作的键 */
  matches(id: BindId, code: string): boolean {
    return this.codes(id).includes(code);
  }

  /** 键帽文字：第一个键盘绑定；纯鼠标动作是鼠标键名 */
  label(id: BindId): string {
    const d = KeyBinds.def(id);
    const c = this.code(id);
    return c ? keyName(c) : d.mouse ?? '—';
  }

  /** 改过键（和缺省不同） */
  isOverridden(id: BindId): boolean {
    return this.over.has(id);
  }

  /** 改键：换掉第一个键盘绑定并保存；写死的动作 / 空键返回 false */
  set(id: BindId, code: string): boolean {
    const d = KeyBinds.def(id);
    if (d.fixed || !code) return false;
    if (d.defaults[0] === code) this.over.delete(id);
    else this.over.set(id, code);
    this.apply();
    this.save();
    this.emit();
    return true;
  }

  /** 恢复默认键位（清掉存档里的覆盖项） */
  reset(): void {
    this.over.clear();
    this.apply();
    try {
      this.storage?.removeItem(KEYBINDS_KEY);
    } catch {
      /* ignore */
    }
    this.emit();
  }

  /** 覆盖项（只含改过的） */
  get overrides(): Record<string, string> {
    return Object.fromEntries(this.over);
  }

  onChanged(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** 套到 core/Input 的动作表上 */
  private apply(): void {
    const b = this.input?.bindings;
    if (!b) return;
    for (const d of BIND_DEFS) if (d.action && !d.fixed) b[d.action] = this.codes(d.id);
  }

  private save(): void {
    try {
      if (this.over.size === 0) this.storage?.removeItem(KEYBINDS_KEY);
      else this.storage?.setItem(KEYBINDS_KEY, JSON.stringify(this.overrides));
    } catch {
      /* ignore */
    }
  }

  private emit(): void {
    for (const fn of this.listeners.slice()) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }
}

/**
 * 按键说明表（Unity ControlsScreen.Rows）：id = null 是移动 / 视角这类组合绑定（fixedKb 按空格拆成几个键帽）。
 * 手柄一列网页没有（没有手柄输入），照 Unity 的缺省手柄键位只在说明里留一列「—」。
 */
export const CONTROL_ROWS: readonly { id: BindId | null; label: string; fixedKb?: string }[] = [
  { id: null, label: '移动', fixedKb: 'W A S D' },
  { id: null, label: '视角', fixedKb: '鼠标' },
  { id: 'jump', label: '跳跃（部分英雄可二段跳）' },
  { id: 'dash', label: '冲刺（有充能与冷却）' },
  { id: 'fire', label: '射击' },
  { id: 'aim', label: '瞄准（缩放视野、降低散布）' },
  { id: 'reload', label: '换弹' },
  { id: 'swapWeapon', label: '切换武器（也可 1 / 2、滚轮）' },
  { id: 'skillPrimary', label: '主技能（长冷却）' },
  { id: 'skillSecondary', label: '副技能（多充能投掷类）' },
  { id: 'weaponSkill', label: '武器技能' },
  { id: 'petSkill', label: '灵技（结契灵宠后）' },
  { id: 'interact', label: '交互：拾取武器、开宝箱、购买、结契、进入出口' },
  { id: 'inventory', label: '行囊：秘卷、属性、武器、灵宠' },
  { id: 'map', label: '行旅图：全图、已发现的地点与目标' },
  { id: 'pause', label: '暂停' },
];
