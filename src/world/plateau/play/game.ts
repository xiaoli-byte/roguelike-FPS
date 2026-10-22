/**
 * 4-1 游玩模式：把正式模型的雷魅和三个领主放进开放盆地，加上灵火点亮、出口和通关（共用部分在 session.ts）。
 * 规则（chuanzang-v1.md 2.6，战斗设计见 chuanzang-combat-v1.md）：
 * - 6 个据点任意顺序。普通据点：清掉那片的雷魅，在灵火坛按住 F 点亮。领主据点（④ 圣湖 化蛇、⑤ 冰川口 飞廉、⑥ 经幡山头 夔）：
 *   打败领主直接点亮，另给伤害 +20%、血上限 +25。每点亮一处灵火、每打败一个领主，秘卷三选一。
 * - 点亮任意 3 处，⑦ 垭口的经幡门打开；走进门里通关。点亮灵火 = 回满血 + 存档点。
 * - 倒下：回到最后点亮的灵火（没有就回出生点）；正在打的那片雷魅回家回血，领主战重置；打死的不复活。
 * - 领主难度梯度：第几个打的领主血量 ×(1 + 0.15 n)、收招更短。
 */
import * as THREE from 'three';
import { FIRE_STATE } from '../landmarks';
import { ENCOUNTERS, FIRES_TO_UNLOCK, LORDS, MONSTER_NAMES, PLACEMENTS, ROAMER, SITES } from '../spec';
import { basinDistance, type Terrain } from '../terrain';
import type { CollisionWorld, Walker } from '../walker';
import type { Weather } from '../weather';
import { loadPlateauModels } from './assets';
import type { Boss } from './boss';
import { createLords } from './bosses';
import type { EncounterState } from './foe';
import { MarmotNet, Manman, Marmot, Roamer, createFoe } from './foes';
import type { ShotResult } from './gun';
import { NavField } from './nav';
import { PlaySession, type PlayInput } from './session';

export type { PlayInput } from './session';

interface SiteState { id: string; name: string; altar: THREE.Vector3; index: number; lit: boolean; enc: EncounterState | null; boss: Boss | null }

const LORD_SITE: Record<string, string> = { kui: 's6', feilian: 's5', huashe: 's4' };

export class PlayMode extends PlaySession {
  readonly encounters: EncounterState[] = [];
  readonly sites: SiteState[] = [];
  readonly nets: MarmotNet[] = [];
  private roamer!: Roamer;
  private lordsDown = 0;
  private holdE = 0;
  private readonly gate: THREE.Vector2;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, terrain: Terrain, world: CollisionWorld, walker: Walker, weather: Weather, conductors: THREE.Vector3[] = []) {
    super(scene, camera, terrain, world, walker, weather, conductors, basinDistance);
    const spawn = SITES.find(s => s.kind === 'spawn')!;
    this.checkpoint.set(spawn.x, 0, spawn.z);
    const g = PLACEMENTS.find(p => p.kind === 'flagGate')!;
    this.gate = new THREE.Vector2(g.x, g.z);
    weather.onStrike = (at, c) => this.strikeEffects(at, c ? this.conductors.find(k => k.pos === c) ?? null : null, 3, 12, '雷暴');
  }

  /** 加载模型、摆怪、开局（出生点） */
  async start(): Promise<void> {
    this.hud.loading('正在加载第四章的雷魅和领主模型…');
    await loadPlateauModels((d, n) => this.hud.loading(`正在加载第四章的雷魅和领主模型… ${d}/${n}`));
    this.hud.loading('');
    this.nav = new NavField(this.terrain, this.world);
    const T = this.terrain;
    for (const E of ENCOUNTERS) {
      const enc: EncounterState = {
        id: E.id, site: E.site, x: E.x, z: E.z, r: E.r, foes: [], alerted: false, cleared: false,
        burrows: (E.burrows ?? []).map(([x, z]) => new THREE.Vector3(x, T.heightAt(x, z), z)),
        tokens: { melee: 0, pounce: 0, ranged: 0, howl: 0 },
      };
      let lastMan: Manman | null = null;
      for (const u of E.units) {
        const ground = T.heightAt(u.at[0], u.at[2]);
        const f = createFoe(u.kind, this, new THREE.Vector3(u.at[0], ground + u.at[1], u.at[2]), u.at[1], MONSTER_NAMES);
        f.enc = enc;
        f.sentinel = !!u.sentinel;
        // 蛮蛮成对：第二只是镜像（只有右翼）
        if (f instanceof Manman) {
          if (lastMan) { f.host.scale.x *= -1; lastMan.pair(f, true); f.pair(lastMan, false); lastMan = null; } else lastMan = f;
        }
        enc.foes.push(f);
        this.foes.push(f);
      }
      const marmots = enc.foes.filter((f): f is Marmot => f instanceof Marmot);
      if (marmots.length >= 3) this.nets.push(new MarmotNet(this, marmots));
      this.encounters.push(enc);
    }
    const [rx, rz] = ROAMER.path[0];
    this.roamer = new Roamer(this, new THREE.Vector3(rx, T.heightAt(rx, rz), rz), MONSTER_NAMES, ROAMER.path as [number, number][], ROAMER.lair as [number, number]);
    this.foes.push(this.roamer);
    this.bosses.push(...createLords(this));
    let index = 0;
    for (const s of SITES) {
      if (!s.altar) continue;
      const lord = LORDS.find(l => LORD_SITE[l.id] === s.id);
      this.sites.push({
        id: s.id, name: s.name, index: index++, lit: false,
        altar: new THREE.Vector3(s.altar[0], T.heightAt(s.altar[0], s.altar[1]), s.altar[1]),
        enc: this.encounters.find(e => e.site === s.id) ?? null,
        boss: lord ? this.bosses.find(b => b.id === lord.id) ?? null : null,
      });
    }
    FIRE_STATE.mask = this.sites.map(() => false);
    FIRE_STATE.lit = 0;
    this.setup();
    this.respawn(true);
    this.ready = true;
    this.say('折多垭口：点亮任意 3 处灵火，打开 ⑦ 垭口的经幡门', 5);
  }

  override wake(x: number, z: number, r: number): void {
    for (const e of this.encounters) {
      if (e.cleared || e.alerted || Math.hypot(e.x - x, e.z - z) > r) continue;
      e.alerted = true;
      for (const f of e.foes) if (f.alive && f.state === 'idle') f.notice();
    }
  }

  protected override lordTier(): number { return this.lordsDown; }
  protected override firesText(): string { return `灵火 ${FIRE_STATE.lit} / ${FIRES_TO_UNLOCK}`; }

  protected tick(dt: number, input: PlayInput, locked: boolean): void {
    for (const n of this.nets) n.update(dt);
    this.updateEncounters();
    this.interact(dt, input.interact && !locked);
    // 通关：灵火够了、走进垭口经幡门
    if (!this.won && FIRE_STATE.lit >= FIRES_TO_UNLOCK && Math.hypot(this.feet.x - this.gate.x, this.feet.z - this.gate.y) < 9) this.victory();
  }

  private updateEncounters(): void {
    for (const e of this.encounters) {
      if (e.cleared) continue;
      // 走进领地就整片醒
      if (!e.alerted && this.player.alive && Math.hypot(this.feet.x - e.x, this.feet.z - e.z) < e.r * 0.75) {
        e.alerted = true;
        for (const f of e.foes) if (f.alive && f.state === 'idle') f.notice();
      }
      // 玩家跑远了：脱战回家
      if (e.alerted && Math.hypot(this.feet.x - e.x, this.feet.z - e.z) > e.r + 80) {
        e.alerted = false;
        for (const f of e.foes) if (f.alive) { f.state = 'idle'; f.interrupt(); }
      }
      if (e.foes.every(f => !f.alive)) {
        e.cleared = true;
        const site = this.sites.find(s => s.id === e.site);
        if (site && !site.lit) this.say(`${site.name}：雷魅清空${site.boss && !site.boss.defeated ? `，但领主${site.boss.label}还守着灵火` : '——去灵火坛按住 F 点亮灵火'}`, 4);
        else if (e.site === 'pass') this.say('垭口的守卫清掉了', 3);
      }
    }
  }

  protected onLordDown(b: Boss): void {
    this.lordsDown++;
    const P = this.player;
    P.dmgMul += 0.2;
    P.maxHp += 25;
    P.hp = P.maxHp; P.shield = P.maxShield;
    const site = this.sites.find(s => s.boss === b);
    if (site) this.light(site, false);
    this.say(`${b.label}被打败了——灵火点亮，伤害 +20%，血上限 +25`, 5);
    this.kit.offer(3);
  }

  /** 灵火坛交互：按住 F 1.2 秒点亮 */
  private interact(dt: number, holding: boolean): void {
    let prompt = '';
    const near = this.sites.find(s => Math.hypot(this.feet.x - s.altar.x, this.feet.z - s.altar.z) < 3.8);
    if (near && this.player.alive) {
      const left = near.enc ? near.enc.foes.filter(f => f.alive).length : 0;
      if (near.lit) prompt = '灵火已点亮';
      else if (near.boss && !near.boss.defeated) prompt = `领主${near.boss.label}守着这处灵火——打败它就会点亮`;
      else if (left > 0) prompt = `还有 ${left} 只雷魅守着灵火`;
      else {
        prompt = '按住 F 点亮灵火';
        this.holdE = holding ? this.holdE + dt : 0;
        if (this.holdE >= 1.2) { this.holdE = 0; this.light(near, true); }
      }
    } else this.holdE = 0;
    this.hud.prompt(prompt, this.holdE / 1.2);
  }

  private light(site: SiteState, announce: boolean): void {
    if (site.lit) return;
    site.lit = true;
    FIRE_STATE.mask![site.index] = true;
    FIRE_STATE.lit = this.sites.filter(s => s.lit).length;
    this.checkpoint.copy(site.altar);
    const P = this.player;
    P.hp = P.maxHp; P.shield = P.maxShield;
    this.fx.burst(site.altar.clone().setY(site.altar.y + 1.6), 4, '#9ff0ff');
    if (announce || FIRE_STATE.lit >= FIRES_TO_UNLOCK) {
      this.say(FIRE_STATE.lit >= FIRES_TO_UNLOCK && FIRE_STATE.lit === FIRES_TO_UNLOCK
        ? `灵火 ${FIRE_STATE.lit}/${FIRES_TO_UNLOCK}——⑦ 垭口的经幡门打开了！`
        : `灵火点亮 ${FIRE_STATE.lit}/${FIRES_TO_UNLOCK}（血已回满，这里是新的复活点）`, 4);
    }
    if (announce) this.kit.offer(3);
  }

  protected respawn(first: boolean): void {
    this.resetCommon();
    const c = this.checkpoint;
    // 灵火坛旁边一点，别站在坛子上
    this.walker.fly = false;
    this.walker.place(c.x + (first ? 0 : 3), c.z + (first ? 0 : 3));
    if (first) this.walker.lookAt(new THREE.Vector3(90, 60, -70));
    for (const e of this.encounters) {
      if (e.cleared || !e.alerted) continue;
      e.alerted = false;
      for (const f of e.foes) f.reset();
    }
    if (!first) this.hud.center('', '');
  }

  protected objective(): string {
    const lit = FIRE_STATE.lit;
    if (this.won) return '';
    if (lit >= FIRES_TO_UNLOCK) return '经幡门已开：去 ⑦ 垭口（东北的盘山天路顶上）';
    return `点亮灵火 ${lit}/${FIRES_TO_UNLOCK} · 清掉据点的雷魅后在灵火坛按住 F；领主据点打败领主直接点亮`;
  }

  private victory(): void {
    this.won = true;
    const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
    this.hud.victory('通关 · 折多垭口', [
      `用时 ${m} 分 ${String(s).padStart(2, '0')} 秒`,
      `点亮灵火 ${FIRE_STATE.lit} 处 · 打败领主 ${this.lordsDown}/3`,
      `击杀雷魅 ${this.kills} · 倒下 ${this.deaths} 次`,
      `秘卷：${this.kit.list().join('、') || '无'}`,
    ]);
  }

  protected override onShot(s: ShotResult): void {
    super.onShot(s);
    if (s.killed && s.target === this.roamer) this.say('穷奇倒下了', 3);
  }
}
