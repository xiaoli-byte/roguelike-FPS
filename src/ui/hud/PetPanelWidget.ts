/**
 * 灵宠面板（照译 Unity G/UI/Widgets/PetPanelWidget.cs，样式 css/unity/hud.css 的 .sf-pet）：左下、生命框上方。
 *   左侧品阶色竖条；灵宠名（品阶色、标题字体）+「品阶 · 称号」小字；灵契等级（觉醒 / 满级金字，未觉醒时注明几级觉醒）；经验细条；
 *   右侧 G 灵技盘（SkillDisc：冷却环 + 秒数，放出时闪一下）。
 * 只在结契了灵宠时显示。网页的灵宠本体是 M9：数据走 PetSource（UIManager.setPetSource），没接时本部件不显示。
 */
import { type PetSource, type PetView, EMPTY_PETS, petLevelRich, petXpRatio } from '../PetData';
import type { KeyBinds } from '../KeyBinds';
import { el, fill, setFill, setText, text } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { Gold, css, fadeRight, lerpColor, paint, rgb } from '../toolkit/UITheme';
import { type HudFrame, HudWidget } from './HudWidget';
import { SkillDisc } from './SkillWidget';

export class PetPanelWidget extends HudWidget {
  readonly id = 'pet';
  override readonly order = 50;
  /** 灵宠数据来源（M9 接进来之前是空的） */
  source: PetSource = EMPTY_PETS;
  keys: KeyBinds | null = null;

  private stripe!: HTMLDivElement;
  private xpFill!: HTMLDivElement;
  private nameLabel!: HTMLDivElement;
  private subLabel!: HTMLDivElement;
  private levelLabel!: HTMLDivElement;
  private skill!: SkillDisc;
  private shownId: string | null = null;
  private levelV = -1;
  private awakenedV = false;
  private xpV = -1;
  private castV: number | undefined;

  /** 正在显示的灵宠 id（测试用） */
  get shown(): string | null {
    return this.visible ? this.shownId : null;
  }

  protected build(): HTMLElement {
    const root = el('sf-pet');
    // 左实右透的墨底（同提示条）
    paint(root, fadeRight([0.02, 0.016, 0.016, 0.62]));
    this.stripe = el('sf-pet__stripe', root);
    const info = el('sf-pet__info', root);
    const head = el('sf-pet__head', info);
    this.nameLabel = text('sf-pet__name', head, '', UIFontRole.Title);
    this.subLabel = text('sf-pet__sub', head);
    this.levelLabel = text('sf-pet__level', info, '', UIFontRole.Body, true);
    const xp = el('sf-pet__xp', info);
    this.xpFill = fill(xp, 'sf-pet__xpfill');
    this.xpFill.style.backgroundColor = css([1, 0.8, 0.4, 0.95]);
    this.skill = new SkillDisc('G', 52);
    this.skill.el.classList.add('sf-pet__skill');
    root.appendChild(this.skill.el);
    root.style.display = 'none';
    return root;
  }

  override resetState(): void {
    this.shownId = null;
    this.levelV = -1;
    this.xpV = -1;
  }

  override tick(f: HudFrame): void {
    let pet: PetView | null = null;
    try {
      pet = this.source.current();
    } catch {
      pet = null;
    }
    const show = !!pet && !!this.game.player;
    this.visible = show;
    if (!show || !pet) return;
    const def = pet.def;
    const now = f.unscaledTime;
    if (def.id !== this.shownId) {
      this.shownId = def.id;
      const rc = rgb(def.rarityColor);
      this.stripe.style.backgroundColor = css(rc);
      setText(this.nameLabel, def.name);
      this.nameLabel.style.color = css(rc);
      setText(this.subLabel, `${def.rarityName} · ${def.title}`);
      this.skill.setSkill(def.skillName ?? '');
      this.skill.Accent = lerpColor(Gold, rc, 0.35);
      this.levelV = -1;
      this.castV = pet.castStamp;
    }
    if (pet.level !== this.levelV || pet.awakened !== this.awakenedV) {
      this.levelV = pet.level;
      this.awakenedV = pet.awakened;
      setText(this.levelLabel, petLevelRich(pet));
    }
    const xp = petXpRatio(pet);
    if (Math.abs(xp - this.xpV) > 0.002) {
      this.xpV = xp;
      setFill(this.xpFill, xp);
    }
    if (pet.castStamp !== this.castV) {
      this.castV = pet.castStamp;
      this.skill.Flash(now);
    }
    this.skill.Key = this.keys?.label('petSkill') ?? 'G';
    const left = pet.skillLeft, cd = Math.max(0.01, pet.skillCooldown);
    // 灵技一次一发：就绪 = 1 层充能，冷却中 = 0
    this.skill.set(left > 0 ? Math.min(1, Math.max(0, 1 - left / cd)) : 1, left, pet.skillReady ? 1 : 0, 1, pet.busy, now);
  }
}
