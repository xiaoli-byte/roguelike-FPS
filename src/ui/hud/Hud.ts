/**
 * 战斗 HUD 的宿主（照译 Unity G/UI/Hud.cs 的 UI Toolkit 部分）：
 *   · 起来时按登记表给每个部件建一个实例，挂进 UIRoot 对应层里本 HUD 的容器（.sf-hud.sf-hud--<层>），每帧统一刷新（单个部件出错只报一次）；
 *     新开一局 / 换关时让部件清瞬态（resetState）。
 *   · 有模态界面 / 暂停（游戏不在 playing）或 HUD 被藏起（showHUD(false)：首领登场演出、菜单）时 HUD 层整体淡出（0.15 s），回来 0.45 s 淡入。
 *   · 部件：生命 / 护盾、武器槽、Q/E 技能与冲刺、武器技能 V、信息角、准星、狙击镜遮罩、受击方向 / 闪屏 / 低血量、交互提示卡、中央大字、
 *     伤害数字与世界浮字、敌人头顶血条（含精英印章）、首领血条、反应首遇教学、罗盘条、秘卷触发弹字、灵宠面板。
 * Unity 的 [HudWidget] 反射登记在网页是 WIDGETS 这张表：加一个部件 = 加一行。
 */
import type { GameContext } from '../../core/types';
import { el } from '../toolkit/el';
import { UILayer, layerName } from '../toolkit/UILayers';
import type { UIRoot } from '../toolkit/UIRoot';
import { BossBar } from './BossBar';
import { CenterTextWidget } from './CenterTextWidget';
import { CompassStrip } from './CompassStrip';
import { CrosshairWidget } from './CrosshairWidget';
import { DamageNumbers } from './DamageNumbers';
import { EnemyBars } from './EnemyBars';
import { type HudFrame, HudContext, type HudWidget } from './HudWidget';
import { HurtWidget } from './HurtWidget';
import { InfoWidget } from './InfoWidget';
import { PetPanelWidget } from './PetPanelWidget';
import { PromptWidget } from './PromptWidget';
import { ReactionTipsWidget } from './ReactionTipsWidget';
import { ScopeOverlay } from './ScopeOverlay';
import { ScrollProcPop } from './ScrollProcPop';
import { BladeSkillWidget, SkillWidget } from './SkillWidget';
import { VitalsWidget } from './VitalsWidget';
import { WeaponWidget } from './WeaponWidget';

/** 登记表（Unity [HudWidget]）：宿主起来时每项建一个实例，按层、order、id 排序 */
export const WIDGETS: (() => HudWidget)[] = [
  () => new EnemyBars(),
  () => new DamageNumbers(),
  () => new HurtWidget(),
  () => new ScopeOverlay(),
  () => new CrosshairWidget(),
  () => new CompassStrip(),
  () => new ScrollProcPop(),
  () => new VitalsWidget(),
  () => new WeaponWidget(),
  () => new SkillWidget(),
  () => new BladeSkillWidget(),
  () => new PetPanelWidget(),
  () => new InfoWidget(),
  () => new BossBar(),
  () => new ReactionTipsWidget(),
  () => new PromptWidget(),
  () => new CenterTextWidget(),
];

export class Hud {
  readonly widgets: HudWidget[] = [];
  readonly context: HudContext;
  private readonly containers = new Map<UILayer, HTMLElement>();
  private readonly failed = new Set<string>();
  private hudAlpha = -1;
  private hudVisible = false;

  constructor(private readonly ui: UIRoot, private readonly ctx: GameContext) {
    this.context = new HudContext(ctx, this.containers, this.widgets, ui.panel);
    const list = WIDGETS.map((make) => make());
    list.sort((a, b) => a.layer - b.layer || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const w of list) {
      let c = this.containers.get(w.layer);
      if (!c) {
        const name = layerName(w.layer).toLowerCase();
        c = el(`sf-hud sf-hud--${name}`, ui.layer(w.layer), 'hud-' + name);
        this.containers.set(w.layer, c);
      }
      try {
        w.attach(this.context, c);
        this.widgets.push(w);
      } catch (err) {
        console.error(`[UI] HUD 部件 ${w.id} 挂不上`, err);
      }
    }
    const hud = this.containers.get(UILayer.Hud);
    if (hud) hud.style.opacity = '0';
  }

  /** 取一个部件（没有为 null） */
  widget<T extends HudWidget>(type: abstract new (...args: never[]) => T): T | null {
    return this.context.widget(type);
  }

  get isVisible(): boolean {
    return this.hudVisible;
  }

  /** showHUD：藏起来时淡出（首领登场演出、菜单、结算） */
  setVisible(v: boolean): void {
    if (v === this.hudVisible) return;
    this.hudVisible = v;
    if (v) this.reset();
    else this.widget(PromptWidget)?.set(null);
  }

  /** 新开一局 / 换关：清掉瞬态（血条池、指示器、首领条、缓存） */
  reset(): void {
    for (const w of this.widgets) {
      try {
        w.resetState();
      } catch (err) {
        this.fail(w.id, err);
      }
    }
  }

  /** 每帧：dt = 缩放时间（暂停 / 模态为 0），unscaledDt / now 不缩放（秒） */
  tick(dt: number, unscaledDt: number, now: number, playing: boolean, hidden: boolean): void {
    const f: HudFrame = { dt, unscaledDt, time: this.ctx.time.now, unscaledTime: now, frame: this.ctx.time.frame, playing };
    // 有模态界面 / 暂停 / 藏起：HUD 层淡出（0.15 s）；进场 0.45 s 淡入
    const hud = this.containers.get(UILayer.Hud);
    if (hud) {
      const target = playing && this.hudVisible && !hidden ? 1 : 0;
      const rate = unscaledDt / (target > this.hudAlpha ? 0.45 : 0.15);
      this.hudAlpha = this.hudAlpha < 0 ? 0 : target > this.hudAlpha ? Math.min(target, this.hudAlpha + rate) : Math.max(target, this.hudAlpha - rate);
      const q = String(Math.round(this.hudAlpha * 100) / 100);
      if (hud.style.opacity !== q) hud.style.opacity = q;
      hud.style.display = this.hudVisible || this.hudAlpha > 0 ? '' : 'none';
    }
    if (!this.hudVisible && this.hudAlpha <= 0) return;
    for (const w of this.widgets) {
      try {
        w.tick(f);
      } catch (err) {
        this.fail(w.id, err);
      }
    }
  }

  private fail(id: string, err: unknown): void {
    if (this.failed.has(id)) return;
    this.failed.add(id);
    console.error(`[UI] HUD 部件 ${id} 更新失败`, err);
  }
}
