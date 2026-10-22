/**
 * 第四章各张图共用的游玩底座：枪、燎的技能与秘卷、元素反应、演出、HUD、落雷与导体、怪和领主的更新、倒下重来。
 * 4-1 开放盆地（game.ts PlayMode：遇敌、灵火、垭口）、4-2 大鹗领主战（gorge/play.ts）、4-4 雷泽雷神（haizi/play.ts）各自继承它，
 * 只写这张图自己的东西（目标、奖励、场地机关、通关）。战斗设计见 docs/level-design/chuanzang-combat-v1.md。
 */
import * as THREE from 'three';
import type { HeightGrid } from '../grid';
import type { CollisionWorld, Walker } from '../walker';
import type { Weather } from '../weather';
import type { Boss } from './boss';
import { Cinema } from './cinema';
import { PLAYER_R, type Actor, type BoltOpts, type Conductor, type DamageInfo, type Elem, type KnockBack, type PlayCtx, type PlayerState, type Target } from './core';
import { ElementSystem } from './elements';
import type { EncounterState, Foe } from './foe';
import { Roamer, Tiangou, createFoe } from './foes';
import { CombatFx } from './fx';
import { GUN, Gun, type ShotResult } from './gun';
import { Hud } from './hud';
import { KIT_NUMBERS, Kit } from './kit';
import { moveTable } from './moves';
import type { NavField } from './nav';
import { MONSTER_NAMES, type MonsterKind } from '../spec';

export interface PlayInput {
  firing: boolean; interact: boolean; reload: boolean;
  skillQ?: boolean; skillE?: boolean;
  /** 秘卷三选一：1 / 2 / 3（0 = 没按） */
  pick?: number;
  /** 这一帧按了任意键（跳过演出） */
  anyKey?: boolean;
}

const _v = new THREE.Vector3();

export abstract class PlaySession implements PlayCtx {
  readonly fx: CombatFx;
  readonly elements: ElementSystem;
  readonly kit: Kit;
  readonly cinema = new Cinema();
  readonly hud: Hud;
  nav: NavField | null = null;
  readonly player: PlayerState = { hp: 100, maxHp: 100, shield: 50, maxShield: 50, dmgMul: 1, alive: true, lastHurt: -99 };
  time = 0;
  readonly feet = new THREE.Vector3();
  readonly center = new THREE.Vector3();
  readonly pvel = new THREE.Vector2();
  readonly foes: Foe[] = [];
  readonly bosses: Boss[] = [];
  readonly conductors: Conductor[];
  /** 场地机关里能被子弹打的东西（雷桩、锚桩、木楔、雷晶） */
  readonly props: Target[] = [];
  protected readonly condGlow: THREE.Sprite[] = [];
  protected gun!: Gun;
  protected checkpoint = new THREE.Vector3();
  protected kills = 0;
  protected deaths = 0;
  protected deadT = 0;
  protected won = false;
  protected trauma = 0;
  protected actorCache: Actor[] = [];
  protected readonly mem: Record<string, number> = {};
  protected readonly lastFeet = new THREE.Vector3();
  /** 无头试玩：自动选第一张秘卷 */
  autoPick = false;
  ready = false;

  constructor(
    readonly scene: THREE.Scene,
    protected readonly camera: THREE.PerspectiveCamera,
    readonly terrain: HeightGrid,
    readonly world: CollisionWorld,
    readonly walker: Walker,
    readonly weather: Weather,
    conductors: THREE.Vector3[],
    private readonly boundFn: (x: number, z: number) => number,
  ) {
    this.fx = new CombatFx(scene, terrain, world);
    this.elements = new ElementSystem(this);
    this.kit = new Kit(this, camera);
    this.hud = new Hud();
    this.elements.onLabel = (at, text, color) => this.hud.label(at, text, color);
    this.conductors = conductors.map((p, i) => ({ pos: p, top: p.y, charge: 0, name: `导体${i}` }));
    this.cinema.clip = (look, pos) => {
      // 从看的点往镜头走，碰到碰撞体 / 地形就停在前面
      const d = pos.distanceTo(look), n = Math.ceil(d / 0.4);
      for (let i = 1; i <= n; i++) {
        _v.lerpVectors(look, pos, i / n);
        if (world.solidAt(_v.x, _v.y, _v.z) || _v.y < terrain.heightAt(_v.x, _v.z) + 0.4) {
          pos.lerpVectors(look, pos, Math.max(0.15, (i - 1.5) / n));
          return;
        }
      }
    };
  }

  get yaw(): number { return this.walker.yaw; }
  get inputLocked(): boolean { return this.cinema.locked || !!this.kit.offering; }

  /** 共用的开局：导体发光、枪、被动 */
  protected setup(): void {
    for (const c of this.conductors) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff6ae0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      sp.position.copy(c.pos);
      sp.scale.setScalar(2.2);
      sp.visible = false;
      this.scene.add(sp);
      this.condGlow.push(sp);
    }
    this.gun = new Gun(this.camera);
    this.scene.add(this.camera);
    this.kit.applyPassives();
    this.walker.dashGrace = 0.2;
  }

  // ─────────────── PlayCtx ───────────────

  bound(x: number, z: number): number { return this.boundFn(x, z); }
  actors(): readonly Actor[] { return this.actorCache; }

  protected collectActors(): void {
    const out: Actor[] = [];
    const F = this.feet;
    for (const f of this.foes) if (f.alive && f.host.visible && f.pos.distanceToSquared(F) < 150 * 150) out.push(f);
    for (const b of this.bosses) {
      if (b.active && !b.defeated && b.host.visible) out.push(b);
      for (const a of b.adds) if (a.alive && a.host.visible) out.push(a);
    }
    this.actorCache = out;
  }

  invulnerable(): boolean { return this.walker.dodging || this.cinema.locked || !this.player.alive || this.won; }

  hurt(dmg: number, source: string, knock?: KnockBack, elem?: Elem): void {
    const P = this.player;
    if (!P.alive || this.won || this.cinema.locked || this.mem.god) return;
    if (this.walker.dodging) { this.hud.dodged(); return; }
    P.lastHurt = this.time;
    const s = Math.min(P.shield, dmg);
    P.shield -= s;
    P.hp -= dmg - s;
    if (knock) this.walker.knock(knock.x, knock.z, knock.up ?? 0);
    this.hud.hurt(dmg, s >= dmg, elem === 'shock');
    this.shake(Math.min(0.5, dmg / 40));
    if (elem === 'shock') { this.walker.speedMul = 0.8; this.mem.shockT = 1; }
    if (P.hp <= 0) {
      P.hp = 0; P.alive = false; this.deadT = 0; this.deaths++;
      this.hud.center(`你倒下了——${source}`, '回到最近的存档点…');
    }
  }

  say(text: string, seconds = 3): void { this.hud.say(text, seconds); }
  wake(_x: number, _z: number, _r: number): void {}
  shake(a: number): void { this.trauma = Math.min(1, this.trauma + a); }
  onFire(at: THREE.Vector3, r: number): void { for (const b of this.bosses) if (b.active && !b.defeated) b.fireAt(at, r); }

  dealt(at: THREE.Vector3, d: number, weak: boolean, info: DamageInfo): void {
    if (info.kind === 'dot') { this.hud.damageNumber(at, d, false, 'fire'); return; }
    this.hud.damageNumber(at, d, weak, info.kind === 'reaction' ? undefined : info.elem);
  }

  /** 一道落雷：5 m 内有导体就劈导体，导体底下 2 m 溅电；预警圈画在实际要劈的地方 */
  bolt(x: number, z: number, o: BoltOpts): void {
    const r = o.r ?? 3.2, delay = o.delay ?? 1.2, dmg = o.dmg ?? 18;
    let cond: Conductor | null = null;
    if (o.conduct !== false) {
      let best = 5;
      for (const c of this.conductors) { const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < best) { best = d; cond = c; } }
    }
    if (cond) {
      const bx = cond.pos.x, bz = cond.pos.z;
      this.fx.telegraph(bx, bz, 2, delay, () => this.strike(new THREE.Vector3(bx, cond!.pos.y, bz), cond, 2, 12, o), '#ff5ad8');
      this.fx.lineWarn(x, z, bx, bz, 0.4, delay, '#ff5ad8');
    } else {
      this.fx.telegraph(x, z, r, delay, () => this.strike(new THREE.Vector3(x, this.fx.ground(x, z), z), null, r, dmg, o));
    }
  }

  private strike(at: THREE.Vector3, cond: Conductor | null, r: number, dmg: number, o: BoltOpts): void {
    if (cond) {
      this.fx.bolt(cond.pos.x, cond.pos.z, '#ffd6fb', cond.pos.y);
      this.fx.arc(cond.pos, new THREE.Vector3(cond.pos.x, this.terrain.heightAt(cond.pos.x, cond.pos.z), cond.pos.z), '#ffffff', 0.25, 0.2);
    } else this.fx.bolt(at.x, at.z);
    this.strikeEffects(at, cond, r, dmg, o.source);
    o.onStrike?.(at, cond);
  }

  /** 落雷劈下来的那一刻：打玩家、给导体充电、天狗衔雷、穷奇吞雷、领主知道 */
  protected strikeEffects(at: THREE.Vector3, cond: Conductor | null, r: number, dmg: number, source: string): void {
    const F = this.feet;
    const bx = cond ? cond.pos.x : at.x, bz = cond ? cond.pos.z : at.z;
    if (Math.hypot(F.x - bx, F.z - bz) < r && F.y < this.terrain.heightAt(bx, bz) + 3 && !this.invulnerable()) this.hurt(dmg, cond ? `${source}（导体溅电）` : source, undefined, 'shock');
    if (cond) cond.charge = 10;
    const ground = new THREE.Vector3(bx, this.terrain.heightAt(bx, bz), bz);
    this.shake(Math.max(0, 0.35 - this.center.distanceTo(ground) * 0.01));
    for (const a of this.actorCache) {
      const d = Math.hypot(a.pos.x - bx, a.pos.z - bz);
      if (a instanceof Tiangou && d < 3) a.absorbBolt();
      if (a instanceof Roamer && d < 12) a.absorbBolt(ground);
    }
    for (const b of this.bosses) if (b.active && !b.defeated) b.onBolt(ground);
    this.onStrike(ground, cond);
  }

  /** 子类：落雷劈下来（4-2 劈中铁索、4-4 给导雷石柱充电） */
  protected onStrike(_at: THREE.Vector3, _cond: Conductor | null): void {}

  // ─────────────── 每帧 ───────────────

  /** 子类每帧：这张图自己的东西（遇敌、灵火、机关、通关） */
  protected abstract tick(dt: number, input: PlayInput, locked: boolean): void;
  protected abstract objective(): string;
  protected firesText(): string { return ''; }
  protected abstract respawn(first: boolean): void;
  /** 领主被打败（演出结束之后） */
  protected abstract onLordDown(b: Boss): void;
  /** 领主难度梯度：第几个打的 */
  protected lordTier(_b: Boss): number { return 0; }

  update(realDt: number, input: PlayInput): void {
    if (!this.ready) return;
    const { gameDt } = this.cinema.update(realDt, this.camera);
    // 秘卷三选一：游戏暂停
    if (this.kit.offering) {
      if (input.pick) this.kit.pick(input.pick - 1);
      else if (this.autoPick) this.kit.pick(0);
      this.drawHud(0);
      this.hud.alpha = 1;
      this.cinema.apply(this.camera);
      return;
    }
    if (input.anyKey && this.cinema.active) this.cinema.skip();
    const dt = gameDt;
    this.time += dt;
    const W = this.walker;
    this.feet.copy(W.feet);
    this.center.copy(W.feet).setY(W.feet.y + 0.95);
    this.pvel.set((this.feet.x - this.lastFeet.x) / Math.max(realDt, 1e-3), (this.feet.z - this.lastFeet.z) / Math.max(realDt, 1e-3));
    this.lastFeet.copy(this.feet);
    this.collectActors();
    const P = this.player;
    this.mem.shockT = (this.mem.shockT ?? 0) - dt;
    if (this.mem.shockT <= 0) W.speedMul = 1;
    if (!P.alive) {
      this.deadT += dt;
      if (this.deadT > 2.5) this.respawn(false);
    }
    if (P.alive && this.time - P.lastHurt > 4) P.shield = Math.min(P.maxShield, P.shield + 30 * dt);
    this.nav?.update(dt, this.feet.x, this.feet.z);
    const locked = this.inputLocked;
    if (input.reload && !locked) this.gun.startReload();
    const targets: Target[] = this.props.length ? [...this.actorCache, ...this.props] : this.actorCache;
    const shots = this.gun.update(dt, input.firing && P.alive && !this.won && !locked, this, targets);
    for (const s of shots) this.onShot(s);
    this.kit.update(dt, { skillE: !!input.skillE, skillQ: !!input.skillQ }, locked || this.won);
    this.updateFoes(dt);
    for (const b of this.bosses) {
      const d = Math.hypot(this.feet.x - b.arena.x, this.feet.z - b.arena.y);
      if (!b.active && !b.defeated && P.alive && b.shouldStart()) { b.setTier(this.lordTier(b)); b.start(); }
      if (b.active && !b.defeated && !b.inShow && (d > b.arenaR + 30 || !P.alive)) {
        b.reset();
        if (P.alive) this.say(`${b.label}的战斗重置了——离擂台太远`, 2.5);
      }
      b.update(dt);
      for (const a of b.adds) { a.notePlayerVel(this.pvel.x, this.pvel.y); a.update(dt, true); }
      if (b.defeated && !b.rewarded && !b.inShow) { b.rewarded = true; b.active = false; this.onLordDown(b); }
    }
    this.tick(dt, input, locked);
    this.elements.update(dt);
    this.conductors.forEach((c, i) => {
      c.charge = Math.max(0, c.charge - dt);
      const g = this.condGlow[i];
      g.visible = c.charge > 0;
      if (g.visible) {
        g.material.opacity = Math.min(1, c.charge / 3) * (0.6 + 0.4 * Math.sin(this.time * 25 + i));
        if (Math.random() < 0.08) this.fx.arc(c.pos, c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, -1.5 - Math.random() * 2, (Math.random() - 0.5) * 2)), '#ff7ae6', 0.1);
      }
    });
    this.fx.update(dt, this.center, PLAYER_R);
    this.drawHud(realDt);
    // 演出接管镜头时藏起武器和 HUD；落回眼睛之后淡入（枪从画面下方抬上来）
    const ui = this.cinema.uiAlpha;
    this.gun.view.visible = !this.cinema.takesCamera && ui > 0.01;
    this.gun.view.position.y -= 0.35 * (1 - ui);
    this.hud.alpha = this.cinema.takesCamera && this.cinema.locked ? 0 : ui;
    this.cinema.apply(this.camera);
    if (this.trauma > 0) {
      const k = this.trauma * this.trauma;
      this.camera.position.add(_v.set((Math.random() - 0.5) * 0.25 * k, (Math.random() - 0.5) * 0.25 * k, (Math.random() - 0.5) * 0.25 * k));
      this.camera.rotateZ((Math.random() - 0.5) * 0.04 * k);
      this.trauma = Math.max(0, this.trauma - realDt * 1.8);
    }
    this.hud.numbers(this.camera, realDt);
  }

  protected updateFoes(dt: number): void {
    for (const f of this.foes) {
      if (!f.alive && !f.host.visible) continue;
      const d2 = f.pos.distanceToSquared(this.feet);
      if (f instanceof Roamer || d2 < 220 * 220 || f.state === 'alert') {
        f.notePlayerVel(this.pvel.x, this.pvel.y);
        f.update(dt, d2 < 170 * 170);
      }
    }
  }

  protected drawHud(dt: number): void {
    this.hud.update(dt, this.player, this.gun.ammo, GUN.mag, this.gun.reloading > 0, this.firesText(), this.bossBar(), this.objective(),
      { q: this.kit.cdQ, e: this.kit.cdE, qMax: KIT_NUMBERS.FOXFIRE.cd, eMax: KIT_NUMBERS.GRENADE.cd }, this.kit.list());
  }

  protected bossBar(): Boss | null { return this.bosses.find(b => b.active && !b.defeated && !this.cinema.locked) ?? null; }

  protected onShot(s: ShotResult): void {
    if (!s.target) return;
    this.hud.hitmark(s.mult > 1, s.killed);
    if (s.killed && (s.target as Foe).enc !== undefined) this.kills++;
  }

  /** 重来时清场（子类再把人放回存档点） */
  protected resetCommon(): void {
    const P = this.player;
    P.hp = P.maxHp; P.shield = P.maxShield; P.alive = true;
    this.fx.clear();
    this.kit.clear();
    this.elements.clear();
    for (const b of this.bosses) if (b.active && !b.defeated) b.reset();
  }

  // ─────────────── 调试 / 脚本化试玩 ───────────────

  /** 控制台 / 试玩脚本用（plateau.play.dev / gorge.play.dev / haizi.play.dev） */
  get dev(): Record<string, unknown> {
    const self = this;
    return {
      moveTable,
      /** 在玩家前方 dist 米刷一只（自己一群） */
      spawn(kind: MonsterKind, dist = 12, angle = 0): Foe {
        const a = self.walker.yaw + Math.PI + angle;
        const F = self.walker.feet;
        const x = F.x + Math.sin(a) * dist, z = F.z + Math.cos(a) * dist;
        const enc: EncounterState = { id: `dev-${kind}`, site: '', x, z, r: 30, foes: [], alerted: true, cleared: false, burrows: [], tokens: { melee: 0, pounce: 0, ranged: 0, howl: 0 } };
        const hover = kind === 'manman' ? 7 : kind === 'liangu' ? 3 : 0;
        const at = new THREE.Vector3(x, self.terrain.heightAt(x, z) + hover, z);
        // 穷奇平时是游猎（PlayMode 里只有一只）；这里刷一只原地巡逻的，巢穴就在脚下
        const f = kind === 'qiongqi' ? new Roamer(self, at, MONSTER_NAMES, [[x, z]], [x, z]) : createFoe(kind, self, at, hover, MONSTER_NAMES);
        f.enc = enc;
        enc.foes.push(f);
        self.foes.push(f);
        f.notice();
        return f;
      },
      /** 观察机位：跟拍 target()（每帧取），从它的侧面 side 弧度、dist 米、高 h 米看过去 */
      watch(target: () => { pos: THREE.Vector3; yaw: number; h?: number }, side = Math.PI / 2, dist = 7, h = 2, fov = 55): void {
        self.cinema.play({ name: 'observe', dur: 1e6, bars: false, lock: false, skippable: false, cam: (_t, out) => {
          const T = target(), a = T.yaw + side;
          out.look.set(T.pos.x, T.pos.y + (T.h ?? 1), T.pos.z);
          out.pos.set(T.pos.x + Math.sin(a) * dist, T.pos.y + h, T.pos.z + Math.cos(a) * dist);
          const g = self.terrain.heightAt(out.pos.x, out.pos.z) + 0.6;
          if (out.pos.y < g) out.pos.y = g;
          out.fov = fov;
        } });
        self.cinema.t = 0.6;
      },
      stopWatch(): void { if (self.cinema.shot?.name === 'observe') self.cinema.shot = null; },
      god(on = true): void { self.mem.god = on ? 1 : 0; },
      heal(): void { self.player.hp = self.player.maxHp; self.player.shield = self.player.maxShield; self.player.alive = true; },
      scroll(id: string): void { self.kit.add(id); },
      reactions: () => ({ ...self.elements.counts }),
      kit: self.kit,
      hud: self.hud,
      fx: self.fx,
      cinema: self.cinema,
    };
  }
}
