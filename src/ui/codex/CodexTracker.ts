/**
 * 图鉴收录（照译 Unity P/Progression/CodexTracker.cs）：把局内「首次获得 / 首次交手」记进图鉴。
 *   · 敌人：第一次打中它、被它打中、打死它，或首领登场（enemy:spawned 的首领）；
 *   · 秘卷：scroll:acquired；
 *   · 武器、灵宠、读档 / 换关恢复的秘卷：每 0.5 s（不缩放时间）看一眼手上两把枪、当前灵宠、秘卷清单。
 * 新收录时提示一行「图鉴新收录 · xx」（?uishots 截图模式不提示，免得挡截图）。
 */
import type { GameContext } from '../../core/types';
import type { PetSource } from '../PetData';
import { type Codex, type CodexCatalog, type CodexKind, KIND_NAMES, codexEnemyId } from './Codex';

const POLL_INTERVAL = 0.5;

export class CodexTracker {
  private nextPoll = 0;
  private readonly offs: (() => void)[] = [];
  /** 新收录的提示（UIManager 给；null = 不提示） */
  toast: ((text: string) => void) | null = null;

  constructor(private readonly ctx: GameContext, private readonly book: Codex, private readonly catalog: () => CodexCatalog, private readonly pets: () => PetSource) {}

  init(): void {
    const ev = this.ctx.events;
    const enemy = (e: { def?: { id?: string } } | null | undefined) => this.unlock('enemy', codexEnemyId(e?.def?.id));
    this.offs.push(
      ev.on('enemy:damaged', ({ enemy: e }) => enemy(e)),
      ev.on('enemy:killed', ({ enemy: e }) => enemy(e)),
      ev.on('enemy:spawned', ({ enemy: e }) => {
        if (e.isBoss) enemy(e);
      }),
      ev.on('scroll:acquired', ({ id }) => this.unlock('scroll', id)),
      ev.on('player:damaged', ({ source }) => enemy(source)),
      ev.on('stage:loaded', () => this.poll()),
      this.book.onUnlocked((kind, id) => {
        const e = this.catalog().find(kind, id);
        if (e) this.toast?.(`图鉴新收录 · ${KIND_NAMES[kind]}「${e.name}」`);
      }),
    );
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private unlock(kind: CodexKind, id: string | null | undefined): void {
    if (id) this.book.unlock(kind, id);
  }

  /** 每帧（不缩放时间，秒）：到点就看一眼；顺带把改动写盘 */
  tick(now: number): void {
    if (now < this.nextPoll) return;
    this.nextPoll = now + POLL_INTERVAL;
    const s = this.ctx.game.state;
    if (s === 'playing' || s === 'modal' || s === 'paused') this.poll();
    this.book.flush();
  }

  /** 看一眼手上的枪、灵宠、秘卷清单，没收录的收录 */
  poll(): void {
    const ctx = this.ctx;
    try {
      for (const w of ctx.weapons?.slots ?? []) if (w) this.book.unlock('weapon', w.defId);
      const pet = this.pets().current();
      if (pet) this.book.unlock('pet', pet.def.id);
      for (const o of ctx.scrolls?.owned() ?? []) this.book.unlock('scroll', o.def.id);
    } catch (err) {
      console.warn('[UI] 图鉴收录轮询失败', err);
    }
  }
}
