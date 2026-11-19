/**
 * 首领血条（照译 Unity G/UI/Widgets/BossBar.cs + IBossBarSource.cs）：顶部居中。
 *   名字（标题字体、宽字距，两侧朱砂祥云）+ 可选副标题（称号 / 形态）；护盾（青）/ 护甲（金）细条、生命主条（延迟掉血拖尾）；
 *   阶段刻度来自首领定义（BossDef.barTicks），越过时刻度熄灭、整条亮一下；
 *   无敌（登场 / 换形 / 阶段转换）：血条蒙灰、底部显示锁与「无敌」；底部另有当前受击层（护盾 / 护甲 / 生命）与数值；
 *   首领死后显示「已击破」1.6 s 再收起（不管有没有人调 setBoss(null)）。
 *   破防条（第四章领主，首领有 breakBar 时）：生命条下一道细金条；满了破防时满格闪烁、底部受击层换成破防名。
 * 数据源：Unity 的 IBossBarSource 由 BossBrain 实现；网页按鸭子类型读首领框架（enemies/bosses/framework/BossBrain）的 bdef / form / breakBar，
 * 旧首领（BossBase）只有 thresholds（照 Unity DamageableBossSource：没有定义就没有刻度以外的东西）。
 */
import type { IEnemy } from '../../core/types';
import { el, fill, formatNum, setFill, setOpacity, setTranslate, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon, makeIcon } from '../toolkit/UIIcons';
import { GoldHi, HpHi, JadeHi, Paper2, barShade, css, paint } from '../toolkit/UITheme';
import { HudColors, type HudFrame, HudWidget } from './HudWidget';

const DeadLinger = 1.6, OpenTime = 0.5, TrailHold = 0.45, TrailRate = 0.45, PassFlash = 0.52;

/** 首领血条的数据源（Unity IBossBarSource；成员名带 bar 前缀） */
export interface BossBarSource {
  /** 当前承伤的身体 */
  readonly barHealth: IEnemy | null;
  readonly barTitle: string;
  readonly barSubtitle: string | null;
  /** 阶段阈值（生命比例 0..1） */
  readonly barThresholds: readonly number[];
  readonly barInvulnerable: boolean;
  /** 破防条（没有为 null） */
  readonly barBreak: { fill: number; broken: boolean; label: string } | null;
}

interface FrameworkBoss {
  bdef?: { name?: string; title?: string | null; barTicks?: readonly number[] };
  form?: { name?: string } | null;
  breakBar?: { fill: number; broken: boolean; def?: { label?: string } } | null;
  thresholds?: number[];
}

/** 网页首领 → 血条数据源（鸭子类型：首领框架的 BossBrain 有 bdef；旧 BossBase 有 thresholds） */
export function bossSource(enemy: IEnemy): BossBarSource {
  const b = enemy as IEnemy & FrameworkBoss;
  return {
    get barHealth() {
      return enemy;
    },
    get barTitle() {
      const def = b.bdef;
      if (def?.name) return b.form?.name ? `${def.name} · ${b.form.name}` : def.name;
      return enemy.displayName || enemy.def.name;
    },
    get barSubtitle() {
      return b.bdef?.title ?? null;
    },
    get barThresholds() {
      return b.bdef?.barTicks ?? (Array.isArray(b.thresholds) ? b.thresholds : []);
    },
    get barInvulnerable() {
      return enemy.alive && !!enemy.untargetable;
    },
    get barBreak() {
      const bb = b.breakBar;
      return bb ? { fill: bb.fill, broken: bb.broken, label: bb.def?.label || '破防' } : null;
    },
  };
}

export class BossBar extends HudWidget {
  readonly id = 'boss-bar';
  override readonly order = 55;

  private panel!: HTMLDivElement;
  private shieldRow!: HTMLDivElement;
  private shieldFill!: HTMLDivElement;
  private armorRow!: HTMLDivElement;
  private armorFill!: HTMLDivElement;
  private hpRow!: HTMLDivElement;
  private hpFill!: HTMLDivElement;
  private hpTrail!: HTMLDivElement;
  private invulnVeil!: HTMLDivElement;
  private flash!: HTMLDivElement;
  private lockIcon!: HTMLDivElement;
  private breakRow!: HTMLDivElement;
  private breakFill!: HTMLDivElement;
  private nameLabel!: HTMLDivElement;
  private subLabel!: HTMLDivElement;
  private layerLabel!: HTMLDivElement;
  private numLabel!: HTMLDivElement;
  private readonly tickEls: HTMLDivElement[] = [];
  private readonly ticks: number[] = [];
  private readonly passed: boolean[] = [];

  private source: BossBarSource | null = null;
  private body: IEnemy | null = null;
  private shownFlag = false;
  private invuln = false;
  private opening = false;
  private closing = false;
  private dead = false;
  private explicitSet = false;
  private openAt = -10;
  private closeAt = -10;
  private deadAt = -1;
  private flashAt = -10;
  private trail = 1;
  private trailHold = 0;
  private shieldV = -1;
  private armorV = -1;
  private hpV = -1;
  private numCur = -1;
  private numMax = -1;
  private breakV = -1;
  private breakShown = false;
  private breakBroken = false;
  private layerText = '';
  private titleText = '';
  private subText = '';
  private panelW = -1;

  /** 当前数据源 / 首领（「已击破」收起期间仍是死去的那个） */
  get Source(): BossBarSource | null {
    return this.source;
  }

  get enemy(): IEnemy | null {
    return this.body;
  }

  /** 正在显示（含收起动画） */
  get Shown(): boolean {
    return this.shownFlag;
  }

  get Title(): string {
    return this.titleText;
  }

  get Ticks(): readonly number[] {
    return this.ticks;
  }

  protected build(): HTMLElement {
    const root = el('sf-boss');
    this.panel = el('sf-boss__panel', root);
    const head = el('sf-boss__head', this.panel);
    head.appendChild(makeIcon(UIIcon.Cloud, 'sf-boss__cloud'));
    this.nameLabel = text('sf-boss__name', head, '', UIFontRole.Title);
    head.appendChild(makeIcon(UIIcon.Cloud, 'sf-boss__cloud', 'sf-boss__cloud--r'));
    this.subLabel = text('sf-boss__sub', this.panel);
    show(this.subLabel, false);

    const bars = el('sf-boss__bars', this.panel);
    this.shieldRow = el('sf-boss__row sf-boss__row--shield', bars);
    this.shieldFill = fill(this.shieldRow);
    paint(this.shieldFill, barShade(JadeHi));
    this.armorRow = el('sf-boss__row sf-boss__row--armor', bars);
    this.armorFill = fill(this.armorRow);
    paint(this.armorFill, barShade(HudColors.ArmorHi));
    this.hpRow = el('sf-boss__row sf-boss__row--hp', bars);
    this.hpTrail = fill(this.hpRow, 'sf-boss__trail');
    this.hpTrail.style.backgroundColor = css(HudColors.Trail);
    this.hpFill = fill(this.hpRow);
    paint(this.hpFill, barShade(HpHi));
    this.breakRow = el('sf-boss__row sf-boss__row--break', bars);
    this.breakFill = fill(this.breakRow, 'sf-boss__break');
    paint(this.breakFill, barShade(GoldHi));
    show(this.breakRow, false);
    this.invulnVeil = el('sf-boss__veil', bars);
    show(this.invulnVeil, false);
    this.flash = el('sf-boss__flash', bars);
    setOpacity(this.flash, 0);

    const foot = el('sf-boss__foot', this.panel);
    const state = el('sf-boss__state', foot);
    this.lockIcon = makeIcon(UIIcon.Lock, 'sf-boss__lock');
    state.appendChild(this.lockIcon);
    show(this.lockIcon, false);
    this.layerLabel = text('sf-boss__layer', state);
    this.numLabel = text('sf-boss__num', foot, '', UIFontRole.Number);
    root.style.display = 'none';
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('enemy:spawned', ({ enemy }) => {
      if (!enemy || !enemy.isBoss) return;
      // 已经有活着的首领在显示（不管是手动设的还是自动接上的）就不抢
      if (this.source && !this.dead && !this.closing && this.body && this.body.alive) return;
      this.bind(bossSource(enemy), false);
    }));
  }

  /** 换玩家（换关 / 重来）：首领还活着就留着，否则立即收起 */
  override resetState(): void {
    if (this.source && this.body && this.body.alive && !this.closing) return;
    this.hideNow();
  }

  /** 设首领（null = 收起；刚死的首领先显示「已击破」再收起） */
  set(enemy: IEnemy | null): void {
    if (!enemy) {
      if (this.shownFlag && this.body && !this.body.alive && !this.closing) {
        if (!this.dead) this.markDead(performance.now() / 1000);
        return;
      }
      this.close();
      return;
    }
    if (this.source && this.body === enemy && this.shownFlag && !this.closing) return;
    this.bind(bossSource(enemy), true);
  }

  private bind(s: BossBarSource, isExplicit: boolean): void {
    const reopen = !this.shownFlag || this.closing;
    this.source = s;
    this.explicitSet = isExplicit;
    this.body = s.barHealth;
    this.dead = false;
    this.deadAt = -1;
    this.closing = false;
    this.shieldV = this.armorV = this.hpV = -1;
    this.numCur = this.numMax = -1;
    this.breakV = -1;
    this.layerText = '';
    this.trail = this.body ? Math.min(1, Math.max(0, this.body.hp / Math.max(1, this.body.maxHp))) : 1;
    setFill(this.hpTrail, this.trail);
    toggle(this.root, 'is-dead', false);
    this.syncTitle();
    this.buildTicks(s.barThresholds);
    for (let i = 0; i < this.ticks.length; i++) {
      this.passed[i] = this.trail <= this.ticks[i];
      toggle(this.tickEls[i], 'is-passed', this.passed[i]);
    }
    if (reopen) {
      this.shownFlag = true;
      this.opening = true;
      this.openAt = performance.now() / 1000;
      this.root.style.display = '';
    }
  }

  private syncTitle(): void {
    let t = this.source?.barTitle ?? '';
    if (!t && this.body) t = this.body.displayName || this.body.def.name;
    if (t !== this.titleText) {
      this.titleText = t;
      this.nameLabel.textContent = t;
    }
    const s = this.source?.barSubtitle ?? '';
    if (s !== this.subText) {
      this.subText = s;
      this.subLabel.textContent = s;
      show(this.subLabel, s.length > 0);
    }
  }

  /** 按阈值重建刻度（阈值相同保留现有元素） */
  private buildTicks(src: readonly number[] | null): void {
    const list = (src ?? []).filter((t) => t > 0.001 && t < 0.999);
    const same = list.length === this.ticks.length && list.every((t, i) => Math.abs(t - this.ticks[i]) < 1e-6);
    if (same) return;
    for (const e of this.tickEls) e.remove();
    this.tickEls.length = this.ticks.length = this.passed.length = 0;
    for (const t of list) {
      const tick = el('sf-boss__tick', this.hpRow);
      tick.style.left = `${t * 100}%`;
      this.tickEls.push(tick);
      this.ticks.push(t);
      this.passed.push(false);
    }
  }

  private markDead(now: number): void {
    this.dead = true;
    this.deadAt = now;
    toggle(this.root, 'is-dead', true);
  }

  private close(): void {
    if (!this.shownFlag || this.closing) return;
    this.closing = true;
    this.closeAt = performance.now() / 1000;
  }

  /** 立即收起（换关 / 新开一局），不保留「已击破」 */
  hideNow(): void {
    this.source = null;
    this.body = null;
    this.shownFlag = this.opening = this.closing = this.dead = this.explicitSet = false;
    this.deadAt = -1;
    if (this.root) this.root.style.display = 'none';
  }

  override tick(f: HudFrame): void {
    if (!this.shownFlag) return;
    const now = f.unscaledTime;
    // 面板宽度：不超过 720，也不超过屏宽 56%（给右上角信息角留位置）
    const w = Math.min(720, this.ctx.panelSize.x * 0.56);
    if (w !== this.panelW) {
      this.panelW = w;
      this.panel.style.width = `${w}px`;
    }

    // 开 / 收动画
    if (this.opening) {
      const k = Math.min(1, Math.max(0, (now - this.openAt) / OpenTime));
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      setOpacity(this.panel, e);
      setTranslate(this.panel, 0, -14 * (1 - e));
      if (k >= 1) this.opening = false;
    }
    if (this.closing) {
      const k = Math.min(1, Math.max(0, (now - this.closeAt) / OpenTime));
      setOpacity(this.panel, 1 - k);
      setTranslate(this.panel, 0, -14 * k);
      if (k >= 1) {
        this.hideNow();
        return;
      }
    }
    const source = this.source;
    if (!source) return;

    // 换形：受伤体换了 → 拖尾对齐
    const b = source.barHealth;
    if (b && b !== this.body) {
      this.body = b;
      this.trail = Math.min(1, Math.max(0, b.hp / Math.max(1, b.maxHp)));
      setFill(this.hpTrail, this.trail);
      this.shieldV = this.armorV = this.hpV = -1;
    }
    const body = this.body;
    if (!body || body.removed) {
      // 首领被回收了：没死就直接收起，死了的等「已击破」停够再收
      if (!this.dead || now - this.deadAt > DeadLinger) this.close();
      return;
    }
    this.syncTitle();
    this.buildTicks(source.barThresholds);

    const alive = body.alive;
    const hasShield = body.maxShield > 0 || body.shield > 0, hasArmor = body.maxArmor > 0;
    show(this.shieldRow, hasShield);
    show(this.armorRow, hasArmor);
    const sh = hasShield ? Math.min(1, Math.max(0, body.shield / Math.max(1, Math.max(body.maxShield, body.shield)))) : 0;
    if (Math.abs(sh - this.shieldV) > 0.001) {
      this.shieldV = sh;
      setFill(this.shieldFill, sh);
    }
    const ar = hasArmor ? Math.min(1, Math.max(0, body.armor / body.maxArmor)) : 0;
    if (Math.abs(ar - this.armorV) > 0.001) {
      this.armorV = ar;
      setFill(this.armorFill, ar);
    }
    const hp = alive ? Math.min(1, Math.max(0, body.hp / Math.max(1, body.maxHp))) : 0;
    if (Math.abs(hp - this.hpV) > 0.0005) {
      if (hp < this.hpV) this.trailHold = now + TrailHold;
      this.hpV = hp;
      setFill(this.hpFill, hp);
      for (let i = 0; i < this.ticks.length; i++) {
        const p = hp <= this.ticks[i];
        if (p === this.passed[i]) continue;
        this.passed[i] = p;
        toggle(this.tickEls[i], 'is-passed', p);
        if (p) this.flashAt = now;
      }
    }
    let t = this.trail;
    if (t < hp) t = hp;
    else if (t > hp && now >= this.trailHold) t = Math.max(hp, t - f.unscaledDt * TrailRate);
    if (t !== this.trail) {
      this.trail = t;
      setFill(this.hpTrail, t);
    }
    const kf = (now - this.flashAt) / PassFlash;
    setOpacity(this.flash, kf >= 0 && kf < 1 ? 0.45 * (1 - kf) * (1 - kf) : 0);

    // 破防条（第四章领主）
    const bb = alive ? source.barBreak : null;
    const showBreak = bb !== null;
    if (showBreak !== this.breakShown) {
      this.breakShown = showBreak;
      show(this.breakRow, showBreak);
      this.breakV = -1;
    }
    const broken = !!bb && bb.broken;
    if (bb) {
      if (Math.abs(bb.fill - this.breakV) > 0.002) {
        this.breakV = bb.fill;
        setFill(this.breakFill, bb.fill);
      }
      if (broken !== this.breakBroken) {
        this.breakBroken = broken;
        toggle(this.breakRow, 'is-broken', broken);
        if (broken) this.flashAt = now;
      }
      setOpacity(this.breakFill, broken ? 0.65 + 0.35 * Math.sin(now * 18) : 1);
    }

    // 无敌：蒙灰 + 锁
    const inv = alive && (source.barInvulnerable || !!body.untargetable);
    if (inv !== this.invuln) {
      this.invuln = inv;
      show(this.invulnVeil, inv);
      show(this.lockIcon, inv);
      toggle(this.root, 'is-invuln', inv);
    }

    // 当前受击层 + 数值
    const layer = !alive ? '已击破' : inv ? '无敌' : broken && bb ? bb.label : body.shield > 0 ? '护盾' : body.armor > 0 ? '护甲' : '生命';
    if (layer !== this.layerText) {
      this.layerText = layer;
      this.layerLabel.textContent = layer;
      this.layerLabel.style.color = css(!alive || broken ? GoldHi : inv ? Paper2 : body.shield > 0 ? JadeHi : body.armor > 0 ? HudColors.ArmorHi : HpHi);
    }
    const cur = alive ? (body.shield > 0 ? body.shield : body.armor > 0 ? body.armor : body.hp) : 0;
    const max = alive ? (body.shield > 0 ? Math.max(body.maxShield, body.shield) : body.armor > 0 ? body.maxArmor : body.maxHp) : body.maxHp;
    const ci = Math.ceil(cur), mi = Math.round(max);
    if (ci !== this.numCur || mi !== this.numMax) {
      this.numCur = ci;
      this.numMax = mi;
      this.numLabel.textContent = `${formatNum(ci)} / ${formatNum(mi)}`;
    }

    // 首领死了：显示「已击破」后自动收起
    if (!alive) {
      if (!this.dead) this.markDead(now);
      else if (now - this.deadAt > DeadLinger) this.close();
    }
  }
}
