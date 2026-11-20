/**
 * M 键全图（照译 Unity G/UI/Screens/MapScreen.cs，样式 css/unity/map.css 的 .sf-map；旧行旅图 AdventureHUD 放大成全屏界面）：
 *   · 底图 = 关卡的俯视图（AdventureInfo.mapImage，北朝上），按它盖住的世界范围把世界 XZ 映射到图上；
 *     没有俯视图的关卡铺墨底点阵，范围取地点与玩家的包围盒；
 *   · 叠层：发现过的地点（徽记 + 名字，颜色同罗盘条；已完成的压暗）、当前目标（金圈呼吸）、玩家（青色箭头 + 视野扇，朝向 = 视线）；
 *   · 标题行：关卡名、「已发现 3/5 处 · 肃清 2/4」；底栏：目标「前往 · 雅丹石阵 · 128 米」、图例。
 * 打开时停住游戏（Game 的 modal 状态）；M / Esc 关。打开热键在 UI.ts。
 */
import type { GameContext } from '../../core/types';
import type { KeyBinds } from '../KeyBinds';
import { type MapMarker, type MapModel, type PoiKind, fallbackArea, headingOf, kindName, mapBoxSize, markerColor, markerGlyph, worldToMap } from '../MapMarkers';
import { el, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { GoldHi, css } from '../toolkit/UITheme';
import { easeOut, gameModal, paintDots } from './ScreenKit';

export const MAP_ID = 'map';

/** 玩家标记（64 × 64，中心 = 玩家；朝上 = 视线方向）：淡青视野扇 + 墨边青色箭头 */
const PLAYER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<path d="M32 32 L15 3 L49 3 Z" fill="#b8eaff" fill-opacity="0.2"/>' +
  '<path d="M32 15 L42 43 L32 37 L22 43 Z" fill="#07060a" stroke="#07060a" stroke-width="3.5" stroke-linejoin="round"/>' +
  '<path d="M32 15 L42 43 L32 37 L22 43 Z" fill="#b8eaff"/></svg>';

const LEGEND: PoiKind[] = ['site', 'cache', 'altar', 'camp', 'boss', 'exit'];

export class MapScreen extends UIScreen {
  readonly id = MAP_ID;
  override get blockState(): BlockState {
    return 'modal';
  }

  private frame!: HTMLDivElement;
  private box!: HTMLDivElement;
  private image!: HTMLDivElement;
  private marksLayer!: HTMLDivElement;
  private player!: HTMLDivElement;
  private playerIcon!: HTMLDivElement;
  private ring!: HTMLDivElement;
  private title!: HTMLDivElement;
  private sub!: HTMLDivElement;
  private targetLine!: HTMLDivElement;
  private empty!: HTMLDivElement;
  private readonly shownMarks: { marker: MapMarker; el: HTMLDivElement }[] = [];
  private openedAt = 0;
  private readonly modal = gameModal(() => this.ctx);
  /** 图框尺寸（设计像素）、底图范围、有没有俯视图、玩家在图上的位置（测试用） */
  boxSize = { w: 0, h: 0 };
  area: [number, number, number, number] = [0, 1, 0, 1];
  hasImage = false;
  playerUV = { u: 0, v: 0 };

  constructor(private readonly ctx: GameContext, private readonly model: MapModel, private readonly keys: KeyBinds, private readonly panel: { x: number; y: number }, private readonly now: () => number) {
    super();
  }

  get titleText(): string {
    return this.title?.textContent ?? '';
  }

  get targetText(): string {
    return this.targetLine?.textContent ?? '';
  }

  /** 图上显示的地点（名字、是不是目标） */
  get marks(): { name: string; target: boolean }[] {
    return this.shownMarks.map((m) => ({ name: m.marker.name, target: m.marker === this.model.markers.target }));
  }

  protected build(): HTMLElement {
    const root = el('sf-map', null, 'map');
    el('sf-backdrop sf-map__backdrop', root);
    this.frame = el('sf-map__frame', root);
    const head = el('sf-map__head', this.frame);
    this.title = text('sf-map__title', head, '行旅图', UIFontRole.Title);
    this.sub = text('sf-map__sub', head, '');
    el('sf-grow', head);
    text('sf-panel__hint', head, 'M / Esc 关闭');
    this.box = el('sf-map__box', this.frame);
    this.image = el('sf-map__image', this.box);
    this.empty = text('sf-map__empty', this.box, '本区域没有俯视图');
    this.marksLayer = el('sf-map__marks', this.box);
    this.ring = el('sf-map__ring', this.marksLayer);
    this.player = el('sf-map__player', this.marksLayer);
    this.playerIcon = el('sf-map__playericon', this.player);
    this.playerIcon.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(PLAYER_SVG)}")`;
    this.playerIcon.style.backgroundSize = '100% 100%';
    const north = el('sf-map__north', this.box);
    text('sf-map__northglyph', north, '北', UIFontRole.Title);
    text('sf-map__northarrow', north, '▲');
    const foot = el('sf-map__foot', this.frame);
    this.targetLine = text('sf-map__target', foot, '', UIFontRole.Title);
    el('sf-grow', foot);
    const legend = el('sf-map__legend', foot);
    const item = (glyph: string, color: string, label: string, done = false) => {
      const it = el('sf-map__legenditem', legend);
      const badge = el('sf-map__badge sf-map__badge--sm' + (done ? ' is-done' : ''), it);
      badge.style.borderColor = color;
      text('sf-map__glyph', badge, glyph, UIFontRole.Title).style.color = color;
      text('sf-map__legendtext', it, label);
    };
    for (const k of LEGEND) item(markerGlyph(k), css(markerColor(k, 'idle')), kindName(k));
    item('战', css(markerColor('site', 'done')), '已完成', true);
    return root;
  }

  override onOpen(): void {
    this.openedAt = this.now();
    this.modal.open();
    (this.ctx.ui as { clearMessages?: () => void }).clearMessages?.();
    this.rebuild();
    this.tick();
  }

  override onClose(): void {
    this.modal.close();
  }

  /** M 再按一次关 */
  onKey(code: string): boolean {
    if (!this.keys.matches('map', code)) return false;
    this.close();
    return true;
  }

  /** 按当前状态重建：底图、范围、图框尺寸、地点、玩家 */
  rebuild(): void {
    const ctx = this.ctx;
    const model = this.model;
    model.update(ctx);
    const mk = model.markers, snap = model.snap;
    const pos = ctx.player?.position ?? null;
    this.hasImage = !!snap.image;
    this.area = snap.image ? [...snap.image.area] : fallbackArea(mk.all, pos?.x ?? 0, pos?.z ?? 0);
    let stageText = '';
    try {
      stageText = ctx.run?.stage ? ctx.runPlan.stageLabel(ctx.run.stage) : '';
    } catch {
      stageText = '';
    }
    this.title.textContent = snap.title || stageText || '行旅图';
    const d = mk.discovery(), s = mk.progress('site', true);
    const parts: string[] = [];
    if (d.total > 0) parts.push(`已发现 ${d.found}/${d.total} 处`);
    if (s.total > 0) parts.push(`肃清 ${s.done}/${s.total}`);
    this.sub.textContent = parts.join(' · ');

    this.boxSize = mapBoxSize(this.panel.x, this.panel.y, this.area);
    this.box.style.width = `${this.boxSize.w}px`;
    this.box.style.height = `${this.boxSize.h}px`;
    if (snap.image) {
      this.image.style.background = `url("${snap.image.url}") center / 100% 100% no-repeat`;
    } else paintDots(this.image, [0.83, 0.66, 0.33, 0.16], 18);
    show(this.empty, !this.hasImage);

    for (const m of this.shownMarks) m.el.remove();
    this.shownMarks.length = 0;
    for (const k of mk.all) {
      if (!mk.visible(k)) continue;
      const e = el('sf-map__mark', this.marksLayer, 'mark-' + k.name);
      const badge = el('sf-map__badge', e);
      const c = css(markerColor(k.kind, k.state));
      badge.style.borderColor = c;
      text('sf-map__glyph', badge, markerGlyph(k.kind), UIFontRole.Title).style.color = c;
      const label = text('sf-map__name', e, k.name);
      toggle(e, 'is-done', k.state === 'done');
      toggle(e, 'is-target', k === mk.target);
      if (k === mk.target) label.style.color = css(GoldHi);
      this.place(e, k.x, k.z);
      this.shownMarks.push({ marker: k, el: e });
    }
    this.marksLayer.appendChild(this.ring);
    this.marksLayer.appendChild(this.player);
    const t = mk.target;
    show(this.ring, !!t);
    if (t) this.place(this.ring, t.x, t.z);
    this.targetLine.textContent = !t ? '' : `目标　${mk.targetVerb ? mk.targetVerb + ' · ' : ''}${t.name} · ${Math.round(t.distance)} 米`;

    show(this.player, !!pos);
    if (pos) {
      this.playerUV = worldToMap(this.area, pos.x, pos.z);
      this.place(this.player, pos.x, pos.z);
      this.playerIcon.style.rotate = `${headingOf(ctx.player.yaw).toFixed(1)}deg`;
    }
  }

  /** 世界 XZ → 图框里的百分比位置（中心对齐） */
  private place(e: HTMLElement, x: number, z: number): void {
    const p = worldToMap(this.area, x, z);
    e.style.left = `${(p.u * 100).toFixed(2)}%`;
    e.style.top = `${(p.v * 100).toFixed(2)}%`;
  }

  override tick(): void {
    const t = this.now() - this.openedAt;
    const k = easeOut(t / 0.22);
    this.frame.style.opacity = String(Math.round(k * 1000) / 1000);
    const s = 0.985 + 0.015 * k;
    this.frame.style.scale = `${s.toFixed(4)} ${s.toFixed(4)}`;
    const p = 0.5 + 0.5 * Math.sin(t * 4.2);
    const rs = 0.85 + 0.35 * p;
    this.ring.style.scale = `${rs.toFixed(3)} ${rs.toFixed(3)}`;
    this.ring.style.opacity = (0.45 + 0.55 * (1 - p)).toFixed(3);
  }
}
