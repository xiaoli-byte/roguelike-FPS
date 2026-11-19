/**
 * 右上 信息角（照译 Unity G/UI/Widgets/InfoWidget.cs）：
 *   关卡名（标题字体，右侧朱砂竖线；首领关偏红）、目标（前面一枚双刃图标）、
 *   钱袋：灵石（铜钱图标、千分位）+ 魂晶；灵石变化时数字旁飘「+N / -N」并弹一下（coins:changed）。墨色右实左透的衬底。
 * 目标文字：Unity 由遭遇 / 首领 / 出口各自调 GameUI.SetObjective（「驼队营地 · 第 1/3 波 · 剩余敌人 5」「击败 旱魃」「前往出口祭坛」）；
 * 网页的关卡导演没有这个钩子，没有显式设置（UI.setObjective）时按同样的格式从关卡状态拼出来（deriveObjective）。
 * 调试模式下（?debug）右上角另有一行帧率（网页独有，Unity 用调试叠层）。
 */
import type { GameContext, IEnemy } from '../../core/types';
import { el, formatNum, setOpacity, setScale, setText, setTranslate, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon, makeIcon } from '../toolkit/UIIcons';
import { fadeLeft, paint } from '../toolkit/UITheme';
import { type HudFrame, HudWidget } from './HudWidget';

const FloatTime = 0.9, PopTime = 0.2;

/** 按 Unity 各处 SetObjective 的格式，从网页关卡状态拼目标文字（boss = 首领条当前的首领） */
export function deriveObjective(ctx: GameContext, boss: IEnemy | null): string {
  if (boss && boss.alive) return `击败 ${boss.displayName || boss.def.name}`;
  const st = ctx.stage;
  if (!st?.stage) return '';
  const alive = ctx.enemies.aliveCount();
  const count = st.stage.type === 'boss' ? 0 : Math.max(0, st.waveCount | 0);
  if (!st.cleared && alive > 0) {
    const info = st.exploration ?? null;
    const site = info?.encounters?.find((e) => e.phase === 'active')?.label ?? (info?.phase === 'battle' ? info.title : '') ?? '';
    const idx = Math.min(Math.max(1, (st.waveIndex | 0) + 1), Math.max(1, count));
    const wave = count > 1 ? `第 ${idx}/${count} 波` : '';
    return [site, wave, `剩余敌人 ${alive}`].filter(Boolean).join(' · ');
  }
  if (st.cleared) return '前往出口祭坛';
  return '';
}

export class InfoWidget extends HudWidget {
  readonly id = 'info';
  override readonly order = 50;

  private stage!: HTMLDivElement;
  private objective!: HTMLDivElement;
  private coins!: HTMLDivElement;
  private essence!: HTMLDivElement;
  private coinFloat!: HTMLDivElement;
  private objectiveRow!: HTMLDivElement;
  private coinsWrap!: HTMLDivElement;
  private fps!: HTMLDivElement;
  private stageText = '';
  private objectiveText = '';
  private coinsV = -Infinity;
  private essV = -Infinity;
  private fpsV = -1;
  private floatAt = -10;
  private floating = false;
  /** 显式设置的目标（UI.setObjective；null = 按关卡状态拼） */
  explicitObjective: string | null = null;
  /** 首领条当前的首领（UI 写） */
  boss: () => IEnemy | null = () => null;

  /** 当前关卡名 / 目标（测试用） */
  get Stage(): string {
    return this.stageText;
  }

  get Objective(): string {
    return this.objectiveText;
  }

  protected build(): HTMLElement {
    const root = el('sf-info');
    paint(root, fadeLeft([0.027, 0.024, 0.04, 0.6]));
    this.fps = text('sf-info__objective', root, '', UIFontRole.Number);
    show(this.fps, false);
    this.stage = text('sf-info__stage', root, '', UIFontRole.Title);
    show(this.stage, false);
    this.objectiveRow = el('sf-info__row', root);
    this.objectiveRow.appendChild(makeIcon(UIIcon.Blades, 'sf-info__icon'));
    this.objective = text('sf-info__objective', this.objectiveRow);
    show(this.objectiveRow, false);

    const purse = el('sf-info__purse', root);
    this.coinsWrap = el('sf-info__coins', purse);
    this.coinsWrap.style.transformOrigin = '100% 50%';
    this.coinsWrap.appendChild(makeIcon(UIIcon.Coin, 'sf-icon--coin', 'sf-info__icon'));
    this.coins = text('sf-info__coinnum', this.coinsWrap, '0', UIFontRole.Number);
    this.coinFloat = text('sf-info__float', this.coinsWrap, '', UIFontRole.Number);
    setOpacity(this.coinFloat, 0);
    const ess = el('sf-info__ess', purse);
    ess.appendChild(makeIcon(UIIcon.Essence, 'sf-icon--essence', 'sf-info__icon'));
    this.essence = text('sf-info__essnum', ess, '0', UIFontRole.Number);
    ess.title = '本局获得的魂晶';
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('coins:changed', ({ delta }) => this.onCoins(delta)));
  }

  /** 关卡名（「1-1 · 古道穿越戈壁」；首领关整体偏红） */
  setStage(value: string, isBoss = false): void {
    this.stageText = value ?? '';
    setText(this.stage, this.stageText);
    show(this.stage, this.stageText.length > 0);
    toggle(this.stage, 'is-boss', isBoss);
  }

  setObjective(value: string): void {
    this.objectiveText = value ?? '';
    setText(this.objective, this.objectiveText);
    show(this.objectiveRow, this.objectiveText.length > 0);
  }

  private onCoins(delta: number): void {
    if (!delta) return;
    this.coinFloat.textContent = delta > 0 ? '+' + delta : String(delta);
    toggle(this.coinFloat, 'is-neg', delta < 0);
    this.floatAt = performance.now() / 1000;
    this.floating = true;
  }

  override resetState(): void {
    this.coinsV = this.essV = -Infinity;
  }

  override tick(f: HudFrame): void {
    const ctx = this.game;
    // 关卡名
    const node = ctx.run?.stage;
    let label = '';
    if (node) {
      try {
        label = ctx.runPlan.stageLabel(node);
      } catch {
        label = `${node.chapter + 1}-${node.index + 1}`;
      }
    }
    if (label !== this.stageText) this.setStage(label, node?.type === 'boss');
    // 目标
    let obj = this.explicitObjective;
    if (obj === null) {
      try {
        obj = deriveObjective(ctx, this.boss());
      } catch {
        obj = '';
      }
    }
    if (obj !== this.objectiveText) this.setObjective(obj);
    // 帧率（调试）
    show(this.fps, ctx.game.debug);
    if (ctx.game.debug) {
      const fps = Math.round(ctx.game.fps);
      if (fps !== this.fpsV) {
        this.fpsV = fps;
        this.fps.textContent = `FPS ${fps}`;
      }
    }

    const c = Math.floor(ctx.run?.coins ?? 0), e = Math.floor(ctx.run?.essence ?? 0);
    if (c !== this.coinsV) {
      this.coinsV = c;
      this.coins.textContent = formatNum(c);
    }
    if (e !== this.essV) {
      this.essV = e;
      this.essence.textContent = formatNum(e);
    }
    if (!this.floating) return;
    const k = (f.unscaledTime - this.floatAt) / FloatTime;
    if (k < 0 || k >= 1) {
      this.floating = false;
      setOpacity(this.coinFloat, 0);
      setScale(this.coinsWrap, null);
      return;
    }
    // 0 → 0.2 淡入并上移到位，之后边淡出边再上浮 14
    const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    const y = k < 0.2 ? 6 + (0 - 6) * (k / 0.2) : -14 * ((k - 0.2) / 0.8);
    setOpacity(this.coinFloat, a);
    setTranslate(this.coinFloat, 0, y);
    const kp = (f.unscaledTime - this.floatAt) / PopTime;
    setScale(this.coinsWrap, kp < 1 ? 1 + 0.15 * (1 - kp) : null);
  }
}
