import * as THREE from 'three';
import type { GameContext, IInteraction, Interactable } from '../core/types';

/**
 * 交互系统：每帧挑选玩家面前最合适的交互物（武器、宝箱、商店摊位、传送门……），
 * 推送交互提示给 UI，按 F 触发。
 *
 * 选择规则：enabled、水平距离在 radius 内、高度差合理；
 * 且位于视线前方（dot > 0.4）或非常近（< 1.5 米）。评分 = 视线对准程度 + 距离接近程度。
 */

const PROMPT_REFRESH = 0.2;
const FRONT_DOT = 0.4;
const NEAR_DIST = 1.5;
/** 交互物相对玩家脚底的可接受高度范围 */
const MIN_DY = -1.2;
const MAX_DY = 2.8;

const _aim = new THREE.Vector3();
const _to = new THREE.Vector3();

export class InteractionSystem implements IInteraction {
  private items: Interactable[] = [];
  private _current: Interactable | null = null;
  private refreshTimer = 0;
  private promptVisible = false;

  constructor(readonly ctx: GameContext) {}

  get current(): Interactable | null {
    return this._current;
  }

  add(item: Interactable): () => void {
    if (!this.items.includes(item)) this.items.push(item);
    return () => this.remove(item);
  }

  update(dt: number): void {
    const player = this.ctx.player;
    const best = player.alive ? this.pickBest() : null;

    if (best !== this._current) {
      this.setCurrent(best);
    } else if (best) {
      this.refreshTimer -= dt;
      if (this.refreshTimer <= 0) this.pushPrompt();
    }

    if (best && this.ctx.input.pressed('interact')) {
      try {
        best.onInteract();
      } catch (err) {
        console.error('[Interaction] onInteract threw', err);
      }
      // 交互后物体可能被禁用 / 移除 / 提示变化，立即刷新
      if (!best.enabled || !this.items.includes(best)) this.setCurrent(null);
      else this.pushPrompt();
    }
  }

  clear(): void {
    this.items.length = 0;
    this._current = null;
    this.refreshTimer = 0;
    this.promptVisible = false;
    this.ctx.ui.setInteractPrompt(null);
  }

  // ───────────── 内部 ─────────────

  private remove(item: Interactable): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    if (this._current === item) this.setCurrent(null);
  }

  private setCurrent(item: Interactable | null): void {
    this._current = item;
    if (item) {
      this.pushPrompt();
    } else if (this.promptVisible) {
      this.promptVisible = false;
      this.ctx.ui.setInteractPrompt(null);
    }
  }

  private pushPrompt(): void {
    const item = this._current;
    this.refreshTimer = PROMPT_REFRESH;
    if (!item) return;
    try {
      this.ctx.ui.setInteractPrompt(item.prompt());
      this.promptVisible = true;
    } catch (err) {
      console.error('[Interaction] prompt() threw', err);
    }
  }

  private pickBest(): Interactable | null {
    const player = this.ctx.player;
    const feet = player.position;
    const eye = player.eye;
    player.getAimDirection(_aim);

    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const item of this.items) {
      if (!item.enabled) continue;
      const p = item.position;
      const dy = p.y - feet.y;
      if (dy < MIN_DY || dy > MAX_DY) continue;
      const dx = p.x - feet.x;
      const dz = p.z - feet.z;
      const dist = Math.hypot(dx, dz);
      if (dist > item.radius) continue;

      _to.subVectors(p, eye);
      const len = _to.length();
      const dot = len > 1e-4 ? _to.dot(_aim) / len : 1;
      if (dot <= FRONT_DOT && dist >= NEAR_DIST) continue;

      const score = dot * 2 + (1 - dist / Math.max(0.1, item.radius));
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }
}
