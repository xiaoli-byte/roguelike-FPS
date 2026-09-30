/**
 * 设置面板（主菜单与暂停菜单共用）。
 * 修改 ctx.settings 后立即 applySettings()；滑条松手 / 开关切换时 saveSettings()。
 */
import type { GameContext, Settings } from '../core/types';
import { h, button, sfx } from './dom';
import { DEFAULT_SETTINGS } from '../core/settings';

const DEFAULTS: Settings = DEFAULT_SETTINGS;

type NumKey = 'sensitivity' | 'fov' | 'masterVolume' | 'sfxVolume' | 'musicVolume' | 'screenShake';
type BoolKey = 'damageNumbers' | 'invertY';

interface Control {
  sync(): void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export class SettingsPanel {
  readonly root: HTMLDivElement;
  private controls: Control[] = [];

  constructor(private readonly ctx: GameContext, onBack: () => void, backLabel = '返回') {
    this.root = h('div', 'gf-settings');
    const head = h('div', 'gf-panel__head', this.root);
    h('h2', 'gf-panel__title', head, '设置');
    h('p', 'gf-panel__sub', head, '改动即时生效，并自动保存');

    const body = h('div', 'gf-settings__body', this.root);

    const g1 = this.group(body, '操作');
    this.slider(g1, '鼠标灵敏度', 'sensitivity', 0.1, 3, 0.05, (v) => `${v.toFixed(2)}×`);
    this.toggle(g1, '反转 Y 轴', 'invertY');

    const g2 = this.group(body, '画面');
    this.slider(g2, '视野（FOV）', 'fov', 60, 110, 1, (v) => `${Math.round(v)}°`);
    this.segmented(g2, '画质', [
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' },
    ]);
    this.toggle(g2, '伤害数字', 'damageNumbers');
    this.slider(g2, '屏幕震动', 'screenShake', 0, 1, 0.05, pct);

    const g3 = this.group(body, '声音');
    this.slider(g3, '主音量', 'masterVolume', 0, 1, 0.01, pct, true);
    this.slider(g3, '音效', 'sfxVolume', 0, 1, 0.01, pct, true);
    this.slider(g3, '音乐', 'musicVolume', 0, 1, 0.01, pct);

    const foot = h('div', 'gf-panel__foot', this.root);
    button(ctx, 'gf-btn gf-btn--ghost', foot, '恢复默认', () => {
      Object.assign(this.ctx.settings, DEFAULTS);
      this.apply(true);
      this.refresh();
    });
    button(ctx, 'gf-btn gf-btn--primary', foot, backLabel, () => onBack());
  }

  /** 从 ctx.settings 同步所有控件 */
  refresh(): void {
    for (const c of this.controls) c.sync();
  }

  private apply(save: boolean): void {
    try {
      this.ctx.game.applySettings();
      if (save) this.ctx.game.saveSettings();
    } catch (err) {
      console.error('[UI] 应用设置失败', err);
    }
  }

  private group(parent: HTMLElement, title: string): HTMLElement {
    const g = h('section', 'gf-settings__group', parent);
    h('h3', 'gf-settings__gtitle', g, title);
    return g;
  }

  private row(parent: HTMLElement, label: string): { row: HTMLElement; ctrl: HTMLElement } {
    // 用 div 而非 label：label 会把点击转发给其中第一个按钮（例如画质「低」）
    const row = h('div', 'gf-setting', parent);
    h('span', 'gf-setting__label', row, label);
    const ctrl = h('span', 'gf-setting__ctrl', row);
    return { row, ctrl };
  }

  private slider(parent: HTMLElement, label: string, key: NumKey, min: number, max: number, step: number, fmt: (v: number) => string, previewSfx = false): void {
    const { ctrl } = this.row(parent, label);
    const input = h('input', 'gf-range', ctrl);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    const val = h('span', 'gf-setting__val', ctrl);
    const paint = (v: number) => {
      val.textContent = fmt(v);
      input.style.setProperty('--fill', `${(((v - min) / (max - min)) * 100).toFixed(1)}%`);
    };
    input.addEventListener('input', () => {
      const v = Number(input.value);
      this.ctx.settings[key] = v;
      paint(v);
      this.apply(false);
    });
    input.addEventListener('change', () => {
      this.apply(true);
      // 调音量时试听一下
      if (previewSfx) sfx(this.ctx, 'ui_confirm');
    });
    this.controls.push({
      sync: () => {
        const v = Number(this.ctx.settings[key]);
        input.value = String(v);
        paint(v);
      },
    });
  }

  private toggle(parent: HTMLElement, label: string, key: BoolKey): void {
    const { ctrl } = this.row(parent, label);
    const sw = button(this.ctx, 'gf-switch', ctrl, '', () => {
      this.ctx.settings[key] = !this.ctx.settings[key];
      paint();
      this.apply(true);
    });
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', label);
    h('i', 'gf-switch__knob', sw);
    const val = h('span', 'gf-setting__val', ctrl);
    const paint = () => {
      const on = !!this.ctx.settings[key];
      sw.classList.toggle('is-on', on);
      sw.setAttribute('aria-checked', String(on));
      val.textContent = on ? '开启' : '关闭';
    };
    this.controls.push({ sync: paint });
  }

  private segmented(parent: HTMLElement, label: string, options: { value: Settings['quality']; label: string }[]): void {
    const { ctrl } = this.row(parent, label);
    const seg = h('span', 'gf-seg', ctrl);
    const btns = options.map((o) =>
      button(this.ctx, 'gf-seg__opt', seg, o.label, () => {
        this.ctx.settings.quality = o.value;
        paint();
        this.apply(true);
      }),
    );
    const paint = () => {
      options.forEach((o, i) => btns[i].classList.toggle('is-on', this.ctx.settings.quality === o.value));
    };
    this.controls.push({ sync: paint });
  }
}
