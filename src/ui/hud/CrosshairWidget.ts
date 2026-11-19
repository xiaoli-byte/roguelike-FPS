/**
 * 屏幕中心的动态准星（照译 Unity G/UI/Widgets/CrosshairWidget.cs）：
 *   十字四线 + 中心点，间距 = 散布半角按当前视野投影成的像素（阻尼 28 跟随）；开镜时淡一半；
 *   压到敌人身上变朱红（每 3 帧沿视线打一次射线，被墙挡住不算；近战形态改为「攻击距离内」）；
 *   近战形态（碎刃「斩」）：十字换成左右两道弧形括号，敌人在范围内时收紧；
 *   换弹环（鎏金，按换弹进度顺时针）、蓄力环（淡紫，满蓄转金并脉动）；
 *   命中标记：普通（白，0.19 s）、暴击（金、略长，0.26 s）、击杀（朱红、加粗、放大回弹，0.42 s）；持续伤害跳伤、衍生伤害不出标记。
 * 狙击镜遮罩是第二期（Unity ScopeOverlay）：这期沿用网页旧的 gf-scope 遮罩（挂在 HUD 层的旧界面壳里），开镜时把十字藏起来（Suppressed）。
 */
import * as THREE from 'three';
import type { DamageResult } from '../../core/types';
import { damp, el, setOpacity, setScale, setTranslate, show } from '../toolkit/el';
import { CinnabarHi, GoldHi, type RGBA, css, lerpColor, withAlpha } from '../toolkit/UITheme';
import { HudColors, type HudFrame, HudWidget } from './HudWidget';
import { ArcElement, RingElement } from './shapes';

const HitKind = { None: -1, Normal: 0, Crit: 1, Kill: 2 } as const;
type HitKind = (typeof HitKind)[keyof typeof HitKind];

const BracketSize = 420, TargetRange = 150;
const HitAngles = [45, 135, 225, 315];
const ChargeColor: RGBA = [0.886, 0.831, 1, 1];
/** 狙击镜阈值：fovKick 低于此值视为开镜（网页旧遮罩的判据） */
const SCOPE_KICK = -30;
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();

export class CrosshairWidget extends HudWidget {
  readonly id = 'crosshair';
  override readonly order = 40;

  private reticle!: HTMLDivElement;
  private dot!: HTMLDivElement;
  private hitmark!: HTMLDivElement;
  private readonly lines: HTMLDivElement[] = [];
  private readonly hitLines: HTMLDivElement[] = [];
  private bracketL!: ArcElement;
  private bracketR!: ArcElement;
  private reload!: RingElement;
  private charge!: RingElement;

  private gap = -1;
  private shownGap = -1;
  private hitAt = -10;
  private reticleAlpha = -1;
  private hitKind: HitKind = HitKind.None;
  private shownKind: HitKind = HitKind.None;
  onTarget = false;
  private melee = false;
  private hitActive = false;
  private reloadQ = -2;
  private chargeQ = -2;
  private chargeMode = '';
  /** 藏起十字 / 括号（狙击镜开镜时）；换弹环、蓄力环、命中标记照常 */
  suppressed = false;
  /** 旧的狙击镜遮罩（第二期换成 ScopeOverlay） */
  scope: HTMLElement | null = null;
  private scoped = false;

  protected build(): HTMLElement {
    const root = el('sf-xhair');
    this.reticle = el('sf-xhair__reticle', root);
    for (let i = 0; i < 4; i++) this.lines.push(el('sf-xhair__line ' + (i % 2 === 0 ? 'sf-xhair__line--v' : 'sf-xhair__line--h'), this.reticle));
    this.dot = el('sf-xhair__dot', this.reticle);
    this.bracketL = new ArcElement(BracketSize, 'sf-xhair__bracket');
    this.bracketR = new ArcElement(BracketSize, 'sf-xhair__bracket');
    for (const b of [this.bracketL, this.bracketR]) {
      b.el.style.width = b.el.style.height = `${BracketSize}px`;
      b.el.style.left = b.el.style.top = `${-BracketSize * 0.5}px`;
      b.Color = withAlpha(HudColors.Reticle, 0.85);
      show(b.el, false);
      this.reticle.appendChild(b.el);
    }
    this.reload = new RingElement(2.4, 60, 'sf-xhair__reload');
    this.reload.Track = [0, 0, 0, 0];
    this.reload.Color = GoldHi;
    setOpacity(this.reload.el, 0);
    root.appendChild(this.reload.el);
    this.charge = new RingElement(3, 46, 'sf-xhair__charge');
    this.charge.Track = [1, 0.976, 0.933, 0.16];
    this.charge.Color = ChargeColor;
    this.charge.RoundCap = false;
    show(this.charge.el, false);
    root.appendChild(this.charge.el);

    this.hitmark = el('sf-hitmark', root);
    for (let i = 0; i < 4; i++) {
      const l = el('sf-hitmark__l', this.hitmark);
      l.style.transformOrigin = '50% 50%';
      l.style.rotate = `${HitAngles[i]}deg`;
      this.hitLines.push(l);
    }
    this.layoutHitLines(HitKind.Normal);
    setOpacity(this.hitmark, 0);
    return root;
  }

  protected override onAttach(): void {
    const ev = this.game.events;
    this.listen(ev.on('enemy:damaged', ({ result }) => this.onDamaged(result)));
    this.listen(ev.on('enemy:killed', ({ result }) => this.onKilled(result)));
  }

  override resetState(): void {
    this.hitActive = false;
    this.hitKind = this.shownKind = HitKind.None;
    setOpacity(this.hitmark, 0);
    this.gap = this.shownGap = -1;
    this.onTarget = false;
  }

  // ───────────── 命中标记 ─────────────

  /** 这一下算不算玩家的命中（标记）：持续伤害跳伤、衍生伤害（弹射、反应）不算 */
  static countsAsPlayerHit(r: DamageResult): boolean {
    const req = r.request;
    return req.source !== 'status' && (req.procDepth ?? 0) === 0 && !(req.tags?.includes('reaction') ?? false);
  }

  private onDamaged(r: DamageResult): void {
    if (!CrosshairWidget.countsAsPlayerHit(r) || !(r.dealt > 0) || r.killed) return;
    const now = performance.now() / 1000;
    // 击杀标记显示期间不被普通命中覆盖；暴击标记 0.09 s 内不被普通命中覆盖
    if (this.hitKind === HitKind.Kill && now - this.hitAt < 0.26) return;
    const kind = r.isCrit ? HitKind.Crit : HitKind.Normal;
    if (this.hitKind === HitKind.Crit && kind === HitKind.Normal && now - this.hitAt < 0.09) return;
    this.hitKind = kind;
    this.hitAt = now;
    this.hitActive = true;
  }

  private onKilled(r: DamageResult): void {
    // 静默处决（清场）不出标记
    if (r.request.tags?.includes('purge')) return;
    this.hitKind = HitKind.Kill;
    this.hitAt = performance.now() / 1000;
    this.hitActive = true;
  }

  /** 按标记种类摆四道短线：普通 2×9、暴击 2×11（金）、击杀 3×13（朱红），离中心 12 */
  private layoutHitLines(kind: HitKind): void {
    const w = kind === HitKind.Kill ? 3 : 2, h = kind === HitKind.Kill ? 13 : kind === HitKind.Crit ? 11 : 9;
    const c = css(kind === HitKind.Kill ? CinnabarHi : kind === HitKind.Crit ? GoldHi : [1, 1, 1, 1]);
    for (let i = 0; i < 4; i++) {
      const l = this.hitLines[i];
      // 带 1 px 黑描边：元素比线宽各大 2
      l.style.width = `${w + 2}px`;
      l.style.height = `${h + 2}px`;
      l.style.left = `${17 - (w + 2) * 0.5}px`;
      l.style.top = `${17 - (h + 2) * 0.5}px`;
      l.style.backgroundColor = c;
      const a = (HitAngles[i] * Math.PI) / 180;
      setTranslate(l, Math.sin(a) * 12, -Math.cos(a) * 12);
    }
  }

  private updateHitMarker(now: number): void {
    if (!this.hitActive) return;
    const kill = this.hitKind === HitKind.Kill;
    const dur = kill ? 0.42 : this.hitKind === HitKind.Crit ? 0.26 : 0.19;
    const e = (now - this.hitAt) / dur;
    if (e >= 1 || e < 0) {
      this.hitActive = false;
      setOpacity(this.hitmark, 0);
      return;
    }
    if (this.hitKind !== this.shownKind) {
      this.shownKind = this.hitKind;
      this.layoutHitLines(this.hitKind);
    }
    const s = kill ? 1.5 - 0.35 * Math.min(1, e * 3) : this.hitKind === HitKind.Crit ? 1.2 - 0.2 * e : 1 + 0.12 * (1 - e);
    setOpacity(this.hitmark, 1 - e * e);
    setScale(this.hitmark, s);
  }

  // ───────────── 准星 ─────────────

  override tick(f: HudFrame): void {
    const ctx = this.game;
    const ws = ctx.weapons;
    const p = ctx.player;
    this.visible = !!ws && !!p;
    if (!ws || !p) return;
    const now = f.unscaledTime;

    // 旧的狙击镜遮罩（第二期换成 ScopeOverlay）
    const scoped = f.playing && ctx.cameraFx.fovKick < SCOPE_KICK;
    if (scoped !== this.scoped) {
      this.scoped = scoped;
      this.scope?.classList.toggle('is-on', scoped);
    }
    this.suppressed = scoped;

    const blade = ws.bladeHud ?? null;
    const isMelee = blade !== null && blade.mode === 'hand';
    if (isMelee !== this.melee) {
      this.melee = isMelee;
      for (const l of this.lines) show(l, !isMelee);
      show(this.dot, !isMelee);
      show(this.bracketL.el, isMelee);
      show(this.bracketR.el, isMelee);
      this.shownGap = -1;
    }

    // 压到敌人身上（每 3 帧一次；暂停 / 阵亡不测）；近战形态改为「下一段斩击此刻能砍到」
    if (f.frame % 3 === 0) {
      let on = false;
      if (f.playing && p.alive) {
        if (isMelee) on = blade?.inRange ?? false;
        else {
          p.getAimDirection(_dir);
          const hit = ctx.enemies.raycast(p.eye, _dir, TargetRange);
          if (hit && hit.enemy.alive && !hit.enemy.untargetable) {
            // 被墙挡住不算；敌人自己的碰撞体（持盾怪的盾）不算挡（同 Unity：第一个挡住的是敌人自己的碰撞体就算压到）
            _end.copy(hit.point);
            const d = hit.distance, k = hit.enemy.radius + 0.3;
            if (d > k + 0.1) _end.addScaledVector(_dir, -k);
            on = !ctx.world.segmentBlocked(p.eye, _end);
          }
        }
      }
      if (on !== this.onTarget) {
        this.onTarget = on;
        const c = css(on ? HudColors.ReticleTarget : HudColors.Reticle);
        for (const l of this.lines) l.style.backgroundColor = c;
        this.dot.style.backgroundColor = c;
        this.bracketL.Color = this.bracketR.Color = on ? HudColors.ReticleTarget : withAlpha(HudColors.Reticle, 0.85);
        this.shownGap = -1;
      }
    }

    // 散布 → 像素（按竖直视野投影，面板高度的一半 = 半视野）
    const spread = Math.max(0, ws.currentSpread || 0);
    const halfFov = (ctx.camera.fov * 0.5 * Math.PI) / 180;
    const px = (Math.tan(Math.min(spread, 1.2)) / Math.tan(halfFov)) * this.ctx.panelSize.y * 0.5;
    const target = Math.min(180, Math.max(4, 4 + px - (this.melee && this.onTarget ? 4 : 0)));
    this.gap = this.gap < 0 ? target : damp(this.gap, target, 28, f.unscaledDt);
    if (Math.abs(this.gap - this.shownGap) > 0.25) {
      this.shownGap = this.gap;
      if (this.melee) {
        const inset = BracketSize * 0.5 - (this.gap + 12);
        this.bracketL.set(180, 32, 0.25, 2.5, this.bracketL.Color, inset);
        this.bracketR.set(0, 32, 0.25, 2.5, this.bracketR.Color, inset);
      } else {
        // 线 2×10 + 1 px 描边（元素 4×12），中心在 (0, 0)
        setTranslate(this.lines[0], -2, -this.gap - 12);
        setTranslate(this.lines[2], -2, this.gap);
        setTranslate(this.lines[1], this.gap, -2);
        setTranslate(this.lines[3], -this.gap - 12, -2);
      }
    }
    const ra = this.suppressed ? 0 : Math.round((1 - aimOf(ws, ctx.cameraFx.fovKick) * 0.5) * 50) / 50;
    if (ra !== this.reticleAlpha) {
      this.reticleAlpha = ra;
      setOpacity(this.reticle, ra);
    }

    // 换弹环
    const rq = ws.isReloading ? Math.round(Math.min(1, Math.max(0, ws.reloadProgress)) * 100) : -1;
    if (rq !== this.reloadQ) {
      if (rq >= 0 !== this.reloadQ >= 0) setOpacity(this.reload.el, rq >= 0 ? 0.9 : 0);
      this.reloadQ = rq;
      if (rq >= 0) this.reload.Progress = rq / 100;
    }

    // 蓄力环：只有真正蓄满才显示满格（网页武器没有预热转速，转速环这一档不出现）
    const v = ws.chargeProgress ?? 0;
    const charging = v > 0.001;
    const cm = charging ? 'charge' : '';
    const full = charging && v >= 1;
    const cq = cm.length === 0 ? 0 : full ? 100 : Math.min(99, Math.max(1, Math.round(v * 100)));
    if (cq !== this.chargeQ || cm !== this.chargeMode) {
      if (cq > 0 !== this.chargeQ > 0) show(this.charge.el, cq > 0);
      this.chargeQ = cq;
      this.chargeMode = cm;
      this.charge.Progress = cq / 100;
      this.charge.Color = full ? HudColors.ArmorHi : ChargeColor;
      if (!full) setScale(this.charge.el, null);
    }
    if (cq >= 100 && charging) {
      // 满蓄：0.45 s 往返脉动 1 → 1.08
      const k = 0.5 + 0.5 * Math.sin((now * Math.PI) / 0.45);
      setScale(this.charge.el, 1 + 0.08 * k);
    }

    this.updateHitMarker(now);
  }
}

/** 开镜程度 0..1（武器系统的 aimT；读不到时按 fovKick 估） */
function aimOf(ws: object, fovKick: number): number {
  const t = (ws as { aimT?: unknown }).aimT;
  if (typeof t === 'number' && Number.isFinite(t)) return Math.min(1, Math.max(0, t));
  return Math.min(1, Math.max(0, -fovKick / 15));
}

// 预热武器转速环的颜色（Unity：橙 → 朱红）
export const heatRingColor = (q: number): RGBA => lerpColor([1, 0.62, 0.25, 1], CinnabarHi, q / 100);
