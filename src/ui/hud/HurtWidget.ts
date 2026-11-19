/**
 * 受击反馈的全屏层（照译 Unity G/UI/Widgets/HurtWidget.cs）：
 *   受击方向：6 道弧（约 41% 屏高半径、贴近屏幕边缘），指向伤害来源；来源敌人还活着时跟踪它的当前位置；同一方向（±20°）的复用同一道；
 *     强度 = 0.45 + 伤害占（生命 + 护盾上限）× 4，淡入 0.09 s、1.15 s 淡完；
 *   受击闪屏：扣到生命为红、只扣护盾为蓝（四周暗角），峰值 0.25–0.75 按伤害比例，0.38 s 平方淡出；
 *   低血量（< 30%）：深红暗角渐浓 + 1.05 s 心跳脉动。
 * 来源 player:damaged。时间用不缩放时间。对外钩子：flash（技能 / 机关闪一下受击色）、indicate（不扣血的威胁方向）、vignetteBoost（寒意、日晒压暗四周）。
 */
import * as THREE from 'three';
import type { IEnemy } from '../../core/types';
import { damp, el, setOpacity } from '../toolkit/el';
import { type RGBA, paint, vignette } from '../toolkit/UITheme';
import { type HudFrame, HudWidget } from './HudWidget';
import { ArcElement } from './shapes';

const Pool = 6;
const DirTime = 1.15, FlashTime = 0.38, HalfSpan = 23.6, Fade = 0.7;
const ArcColor: RGBA = [1, 0.25, 0.16, 0.95];
const FlashRed: RGBA = [0.7, 0.08, 0.04, 0.85], FlashBlue: RGBA = [0.16, 0.45, 0.86, 0.65];
const LowColor: RGBA = [0.3, 0, 0, 0.85], PulseColor: RGBA = [0.82, 0.08, 0.04, 0.5];

interface Dir {
  el: HTMLDivElement;
  glow: ArcElement;
  core: ArcElement;
  x: number;
  z: number;
  source: IEnemy | null;
  start: number;
  strength: number;
  shown: number;
  active: boolean;
}

const _f = new THREE.Vector3();

/** 心跳曲线（0 → 14% 1 → 28% 0.2 → 42% 0.8 → 70% 0） */
export function heartbeat(t: number): number {
  const ease = (k: number) => k * k * (3 - 2 * k);
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  if (t < 0.14) return ease(t / 0.14);
  if (t < 0.28) return lerp(1, 0.2, ease((t - 0.14) / 0.14));
  if (t < 0.42) return lerp(0.2, 0.8, ease((t - 0.28) / 0.14));
  if (t < 0.7) return lerp(0.8, 0, ease((t - 0.42) / 0.28));
  return 0;
}

/** 两个航向角（度）的有符号差，(-180, 180] */
function deltaAngle(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export class HurtWidget extends HudWidget {
  readonly id = 'hurt';
  override readonly order = 10;

  private low!: HTMLDivElement;
  private pulse!: HTMLDivElement;
  private flashEl!: HTMLDivElement;
  private readonly dirs: Dir[] = [];
  private flashAt = -10;
  private flashPeak = 0;
  private lowV = 0;
  private size = -1;
  private flashActive = false;
  private flashShield = false;
  /** 暗角额外强度 0..1（叠在低血量之上，取大的那个） */
  vignetteBoost = 0;

  protected build(): HTMLElement {
    const root = el('sf-hurt');
    this.low = el('sf-fullscreen', root, 'low-hp');
    paint(this.low, vignette(LowColor));
    setOpacity(this.low, 0);
    this.pulse = el('sf-fullscreen', this.low, 'low-hp-pulse');
    paint(this.pulse, vignette(PulseColor));
    setOpacity(this.pulse, 0);
    this.flashEl = el('sf-fullscreen', root, 'damage-flash');
    paint(this.flashEl, vignette(FlashRed));
    setOpacity(this.flashEl, 0);
    const dirRoot = el('sf-fullscreen', root, 'damage-dirs');
    for (let i = 0; i < Pool; i++) {
      const d: Dir = {
        el: el('sf-dmgdir__arc', dirRoot),
        glow: new ArcElement(800, 'sf-fullscreen'),
        core: new ArcElement(800, 'sf-fullscreen'),
        x: 0, z: 0, source: null, start: -10, strength: 0, shown: -1, active: false,
      };
      d.glow.set(-90, HalfSpan + 2, Fade, 16, [1, 0.16, 0.08, 0.22]);
      d.core.set(-90, HalfSpan, Fade, 6, ArcColor, 5);
      d.el.append(d.glow.el, d.core.el);
      setOpacity(d.el, 0);
      this.dirs.push(d);
    }
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('player:damaged', (e) => {
      const p = this.game.player;
      const maxTotal = Math.max(1, p.maxHp() + p.maxShield());
      const amount = Math.max(0, e.amount);
      this.flash(e.toHp <= 0, Math.min(0.75, Math.max(0.25, 0.25 + (amount / maxTotal) * 3)));
      const at = e.source && e.source.alive ? e.source.position : e.from;
      if (at) this.indicate(e.source && e.source.alive ? e.source : null, at.x, at.z, Math.min(1, Math.max(0.45, 0.45 + (amount / maxTotal) * 4)));
    }));
  }

  override resetState(): void {
    for (const d of this.dirs) {
      d.active = false;
      d.source = null;
      d.shown = 0;
      setOpacity(d.el, 0);
    }
    this.flashActive = false;
    setOpacity(this.flashEl, 0);
  }

  /** 受击闪屏：shieldOnly = 蓝（只扣护盾），否则红；peak = 峰值不透明度 */
  flash(shieldOnly: boolean, peak: number): void {
    this.flashAt = performance.now() / 1000;
    this.flashPeak = Math.min(1, Math.max(0, peak));
    this.flashActive = true;
    if (shieldOnly !== this.flashShield) {
      this.flashShield = shieldOnly;
      paint(this.flashEl, vignette(shieldOnly ? FlashBlue : FlashRed));
    }
  }

  /** 方向指示：source 还活着时跟踪它，否则固定在 (x, z)；strength 0..1 */
  indicate(source: IEnemy | null, x: number, z: number, strength: number): void {
    const o = this.game.player.position;
    const dx = x - o.x, dz = z - o.z;
    if (dx * dx + dz * dz < 0.25) return;
    const ang = (Math.atan2(dx, dz) * 180) / Math.PI;
    const now = performance.now() / 1000;
    // 复用方向相近的，其次空闲的，最后最旧的
    let pick: Dir | null = null;
    for (const d of this.dirs) {
      if (!d.active) continue;
      if (Math.abs(deltaAngle((Math.atan2(d.x - o.x, d.z - o.z) * 180) / Math.PI, ang)) < 20) {
        pick = d;
        break;
      }
    }
    const reuse = pick !== null;
    if (!pick) {
      pick = this.dirs[0];
      for (const d of this.dirs) {
        if (!d.active) {
          pick = d;
          break;
        }
        if (d.start < pick.start) pick = d;
      }
    }
    pick.x = x;
    pick.z = z;
    pick.source = source;
    pick.start = now;
    pick.strength = Math.max(reuse ? pick.strength : 0, strength);
    pick.active = true;
  }

  override tick(f: HudFrame): void {
    const p = this.game.player;
    this.visible = !!p;
    if (!p) return;
    const now = f.unscaledTime;
    const panel = this.ctx.panelSize;
    const s = 0.82 * Math.min(panel.x, panel.y);
    if (Math.abs(s - this.size) > 0.5) {
      this.size = s;
      for (const d of this.dirs) {
        d.el.style.width = d.el.style.height = `${s}px`;
        d.el.style.marginLeft = d.el.style.marginTop = `${-s * 0.5}px`;
        d.glow.setSize(s);
        d.core.setSize(s);
      }
    }

    this.updateDirs(now);

    // 受击闪屏
    if (this.flashActive) {
      const e = (now - this.flashAt) / FlashTime;
      if (e >= 1 || e < 0) {
        this.flashActive = false;
        setOpacity(this.flashEl, 0);
      } else setOpacity(this.flashEl, this.flashPeak * (1 - e) * (1 - e));
    }

    // 低血量：暗角渐浓（阻尼 6）+ 心跳
    const max = Math.max(1, p.maxHp());
    const frac = p.alive ? p.hp / max : 0;
    let target = frac < 0.3 && p.alive ? 0.45 + (1 - frac / 0.3) * 0.55 : 0;
    target = Math.max(target, Math.min(1, Math.max(0, this.vignetteBoost)));
    this.lowV = damp(this.lowV, target, 6, f.unscaledDt);
    if (this.lowV < 0.004 && target <= 0) this.lowV = 0;
    const lq = Math.round(this.lowV * 50) / 50;
    setOpacity(this.low, lq);
    setOpacity(this.pulse, lq > 0 ? heartbeat((now % 1.05) / 1.05) : 0);
  }

  private updateDirs(now: number): void {
    const p = this.game.player;
    // 朝向取相机的水平朝向（不随震屏抖：网页的 yaw 是瞄准朝向）
    p.getForward(_f);
    const camYaw = (Math.atan2(-_f.x, -_f.z) * 180) / Math.PI;
    const o = p.position;
    for (const d of this.dirs) {
      if (!d.active) continue;
      const e = (now - d.start) / DirTime;
      if (e >= 1 || e < 0) {
        d.active = false;
        d.source = null;
        d.shown = 0;
        setOpacity(d.el, 0);
        continue;
      }
      // 来源还活着：跟踪当前位置
      if (d.source) {
        if (!d.source.alive) d.source = null;
        else {
          d.x = d.source.position.x;
          d.z = d.source.position.z;
        }
      }
      // 来源在右侧 → 弧顺时针转到右边（three.js 右手系：从相机朝向到来源的有符号夹角，右为正）
      const srcYaw = (Math.atan2(-(d.x - o.x), -(d.z - o.z)) * 180) / Math.PI;
      const rot = -deltaAngle(camYaw, srcYaw);
      d.el.style.rotate = `${rot.toFixed(1)}deg`;
      const op = d.strength * (e < 0.08 ? e / 0.08 : 1 - (e - 0.08) / 0.92);
      if (Math.abs(op - d.shown) > 0.01) {
        d.shown = op;
        setOpacity(d.el, op);
      }
    }
  }
}
