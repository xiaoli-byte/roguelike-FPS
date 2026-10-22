/**
 * 4-1 游玩模式：把正式模型的雷魅和三个领主放进开放盆地，加上射击、燎的技能、秘卷、元素反应、演出、灵火点亮、出口和通关。
 * 规则（chuanzang-v1.md 2.6，战斗设计见 chuanzang-combat-v1.md）：
 * - 6 个据点任意顺序。普通据点：清掉那片的雷魅，在灵火坛按住 F 点亮。领主据点（④ 圣湖 化蛇、⑤ 冰川口 飞廉、⑥ 经幡山头 夔）：
 *   打败领主直接点亮，另给伤害 +20%、血上限 +25。每点亮一处灵火、每打败一个领主，秘卷三选一。
 * - 点亮任意 3 处，⑦ 垭口的经幡门打开；走进门里通关。点亮灵火 = 回满血 + 存档点。
 * - 倒下：回到最后点亮的灵火（没有就回出生点）；正在打的那片雷魅回家回血，领主战重置；打死的不复活。
 * - 领主难度梯度：第几个打的领主血量 ×(1 + 0.15 n)、收招更短。
 */
import * as THREE from 'three';
import { FIRE_STATE } from '../landmarks';
import { ALERT_RADIUS, ENCOUNTERS, FIRES_TO_UNLOCK, LORDS, MONSTER_NAMES, PLACEMENTS, ROAMER, SITES } from '../spec';
import { basinDistance, type Terrain } from '../terrain';
import type { CollisionWorld, Walker } from '../walker';
import type { Weather } from '../weather';
import { loadPlateauModels } from './assets';
import type { Boss } from './boss';
import { createLords } from './bosses';
import { Cinema } from './cinema';
import { PLAYER_R, type Actor, type BoltOpts, type Conductor, type DamageInfo, type Elem, type KnockBack, type PlayCtx, type PlayerState, type Target } from './core';
import { ElementSystem } from './elements';
import type { EncounterState, Foe } from './foe';
import { MarmotNet, Manman, Marmot, Roamer, Tiangou, createFoe } from './foes';
import { CombatFx } from './fx';
import { GUN, Gun, type ShotResult } from './gun';
import { Hud } from './hud';
import { KIT_NUMBERS, Kit } from './kit';
import { moveTable } from './moves';
import { NavField } from './nav';

export interface PlayInput {
  firing: boolean; interact: boolean; reload: boolean;
  skillQ?: boolean; skillE?: boolean;
  /** 秘卷三选一：1 / 2 / 3（0 = 没按） */
  pick?: number;
  /** 这一帧按了任意键（跳过演出） */
  anyKey?: boolean;
}

interface SiteState { id: string; name: string; altar: THREE.Vector3; index: number; lit: boolean; enc: EncounterState | null; boss: Boss | null }

const LORD_SITE: Record<string, string> = { kui: 's6', feilian: 's5', huashe: 's4' };
const _v = new THREE.Vector3();

export class PlayMode implements PlayCtx {
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
  readonly encounters: EncounterState[] = [];
  readonly foes: Foe[] = [];
  readonly bosses: Boss[] = [];
  readonly sites: SiteState[] = [];
  readonly nets: MarmotNet[] = [];
  readonly conductors: Conductor[];
  private readonly condGlow: THREE.Sprite[] = [];
  private roamer!: Roamer;
  private gun!: Gun;
  private checkpoint: THREE.Vector3;
  private kills = 0;
  private deaths = 0;
  private lordsDown = 0;
  private holdE = 0;
  private deadT = 0;
  private won = false;
  private trauma = 0;
  private actorCache: Actor[] = [];
  private readonly mem: Record<string, number> = {};
  private readonly lastFeet = new THREE.Vector3();
  private readonly gate: THREE.Vector2;
  /** 无头试玩：自动选第一张秘卷 */
  autoPick = false;
  ready = false;

  constructor(
    readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    readonly terrain: Terrain,
    readonly world: CollisionWorld,
    readonly walker: Walker,
    readonly weather: Weather,
    conductors: THREE.Vector3[] = [],
  ) {
    this.fx = new CombatFx(scene, terrain, world);
    this.elements = new ElementSystem(this);
    this.kit = new Kit(this, camera);
    this.hud = new Hud();
    this.elements.onLabel = (at, text, color) => this.hud.label(at, text, color);
    this.conductors = conductors.map((p, i) => ({ pos: p, top: p.y, charge: 0, name: `导体${i}` }));
    const spawn = SITES.find(s => s.kind === 'spawn')!;
    this.checkpoint = new THREE.Vector3(spawn.x, 0, spawn.z);
    const g = PLACEMENTS.find(p => p.kind === 'flagGate')!;
    this.gate = new THREE.Vector2(g.x, g.z);
    this.cinema.clip = (look, pos) => {
      // 从看的点往镜头走，碰到碰撞体 / 地形就停在前面 0.4 m
      const d = pos.distanceTo(look), n = Math.ceil(d / 0.4);
      for (let i = 1; i <= n; i++) {
        _v.lerpVectors(look, pos, i / n);
        if (world.solidAt(_v.x, _v.y, _v.z) || _v.y < terrain.heightAt(_v.x, _v.z) + 0.4) {
          pos.lerpVectors(look, pos, Math.max(0.15, (i - 1.5) / n));
          return;
        }
      }
    };
    weather.onStrike = (at, c) => this.strikeEffects(at, c ? this.conductors.find(k => k.pos === c) ?? null : null, 3, 12, '雷暴');
  }

  get yaw(): number { return this.walker.yaw; }
  get inputLocked(): boolean { return this.cinema.locked || !!this.kit.offering; }

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
    this.respawn(true);
    this.ready = true;
    this.say('折多垭口：点亮任意 3 处灵火，打开 ⑦ 垭口的经幡门', 5);
  }

  // ─────────────── PlayCtx ───────────────

  bound(x: number, z: number): number { return basinDistance(x, z); }

  actors(): readonly Actor[] { return this.actorCache; }

  private collectActors(): void {
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
      this.hud.center(`你倒下了——${source}`, '回到最近点亮的灵火…');
    }
  }

  say(text: string, seconds = 3): void { this.hud.say(text, seconds); }

  wake(x: number, z: number, r: number): void {
    for (const e of this.encounters) {
      if (e.cleared || e.alerted || Math.hypot(e.x - x, e.z - z) > r) continue;
      e.alerted = true;
      for (const f of e.foes) if (f.alive && f.state === 'idle') f.notice();
    }
  }

  shake(a: number): void { this.trauma = Math.min(1, this.trauma + a); }

  onFire(at: THREE.Vector3, r: number): void { for (const b of this.bosses) if (b.active && !b.defeated) b.fireAt(at, r); }

  dealt(at: THREE.Vector3, d: number, weak: boolean, info: DamageInfo): void {
    if (info.kind === 'dot') { this.hud.damageNumber(at, d, false, 'fire'); return; }
    this.hud.damageNumber(at, d, weak, info.kind === 'reaction' ? undefined : info.elem);
  }

  /** 一道落雷：5 m 内有导体（更高的）就劈导体，导体底下 2 m 溅电；预警圈画在实际要劈的地方 */
  bolt(x: number, z: number, o: BoltOpts): void {
    const r = o.r ?? 3.2, delay = o.delay ?? 1.2, dmg = o.dmg ?? 18;
    let cond: Conductor | null = null;
    if (o.conduct !== false) {
      let best = 5;
      for (const c of this.conductors) { const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < best) { best = d; cond = c; } }
    }
    if (cond) {
      // 被引走：预警画在导体底下（2 m），再拉一道细线提示「雷被杆子引走了」
      const bx = cond.pos.x, bz = cond.pos.z;
      this.fx.telegraph(bx, bz, 2, delay, () => this.strike(new THREE.Vector3(bx, cond!.pos.y, bz), cond, 2, 12, o), '#ff5ad8');
      this.fx.lineWarn(x, z, bx, bz, 0.4, delay, '#ff5ad8');
    } else {
      this.fx.telegraph(x, z, r, delay, () => this.strike(new THREE.Vector3(x, this.fx.ground(x, z), z), null, r, dmg, o));
    }
  }

  private strike(at: THREE.Vector3, cond: Conductor | null, r: number, dmg: number, o: BoltOpts): void {
    if (cond) {
      this.fx.bolt(cond.pos.x, cond.pos.z, '#ffd6fb', this.terrain.heightAt(cond.pos.x, cond.pos.z));
      this.fx.arc(cond.pos, new THREE.Vector3(cond.pos.x, this.terrain.heightAt(cond.pos.x, cond.pos.z), cond.pos.z), '#ffffff', 0.25, 0.2);
    } else this.fx.bolt(at.x, at.z);
    this.strikeEffects(at, cond, r, dmg, o.source);
    o.onStrike?.(at, cond);
  }

  /** 落雷劈下来的那一刻：打玩家、给导体充电、天狗衔雷、穷奇吞雷、领主知道 */
  private strikeEffects(at: THREE.Vector3, cond: Conductor | null, r: number, dmg: number, source: string): void {
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
  }

  // ─────────────── 每帧 ───────────────

  update(realDt: number, input: PlayInput): void {
    if (!this.ready) return;
    const { gameDt } = this.cinema.update(realDt, this.camera);
    // 秘卷三选一：游戏暂停
    if (this.kit.offering) {
      if (input.pick) this.kit.pick(input.pick - 1);
      else if (this.autoPick) this.kit.pick(0);
      this.hud.update(0, this.player, this.gun.ammo, GUN.mag, this.gun.reloading > 0, this.firesText(), this.bossBar(), this.objective(), this.skillsHud(), this.kit.list());
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
    // 倒下 → 2.5 秒后在存档点重来
    if (!P.alive) {
      this.deadT += dt;
      if (this.deadT > 2.5) this.respawn(false);
    }
    // 护盾：4 秒没挨打开始回
    if (P.alive && this.time - P.lastHurt > 4) P.shield = Math.min(P.maxShield, P.shield + 30 * dt);
    this.nav?.update(dt, this.feet.x, this.feet.z);
    // 射击、技能
    const locked = this.inputLocked;
    const targets: Target[] = this.actorCache;
    if (input.reload && !locked) this.gun.startReload();
    const shots = this.gun.update(dt, input.firing && P.alive && !this.won && !locked, this, targets);
    for (const s of shots) this.onShot(s);
    this.kit.update(dt, { skillE: !!input.skillE, skillQ: !!input.skillQ }, locked || this.won);
    // 怪
    for (const f of this.foes) {
      if (!f.alive && !f.host.visible) continue;
      const d2 = f.pos.distanceToSquared(this.feet);
      if (f === this.roamer || d2 < 220 * 220 || f.state === 'alert') {
        f.notePlayerVel(this.pvel.x, this.pvel.y);
        f.update(dt, d2 < 170 * 170);
      }
    }
    for (const n of this.nets) n.update(dt);
    this.updateEncounters();
    // 领主
    for (const b of this.bosses) {
      const d = Math.hypot(this.feet.x - b.arena.x, this.feet.z - b.arena.y);
      if (!b.active && !b.defeated && P.alive && b.shouldStart()) { b.setTier(this.lordsDown); b.start(); }
      if (b.active && !b.defeated && !b.inShow && (d > b.arenaR + 30 || !P.alive)) {
        b.reset();
        if (P.alive) this.say(`${b.label}的战斗重置了——离擂台太远`, 2.5);
      }
      b.update(dt);
      for (const a of b.adds) { a.notePlayerVel(this.pvel.x, this.pvel.y); a.update(dt, true); }
      if (b.defeated && !b.rewarded && !b.inShow) this.onLordDown(b);
    }
    this.elements.update(dt);
    // 导体：带电时杆顶发紫光
    this.conductors.forEach((c, i) => {
      c.charge = Math.max(0, c.charge - dt);
      const g = this.condGlow[i];
      g.visible = c.charge > 0;
      if (g.visible) { g.material.opacity = Math.min(1, c.charge / 3) * (0.6 + 0.4 * Math.sin(this.time * 25 + i)); if (Math.random() < 0.08) this.fx.arc(c.pos, c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, -1.5 - Math.random() * 2, (Math.random() - 0.5) * 2)), '#ff7ae6', 0.1); }
    });
    this.fx.update(dt, this.center, PLAYER_R);
    this.interact(dt, input.interact && !locked);
    // 通关：灵火够了、走进垭口经幡门
    if (!this.won && FIRE_STATE.lit >= FIRES_TO_UNLOCK && Math.hypot(this.feet.x - this.gate.x, this.feet.z - this.gate.y) < 9) this.victory();
    this.hud.update(realDt, this.player, this.gun.ammo, GUN.mag, this.gun.reloading > 0, this.firesText(), this.bossBar(), this.objective(), this.skillsHud(), this.kit.list());
    // 镜头：演出接管 → 震屏
    this.gun.view.visible = !(this.cinema.active && this.cinema.shot?.cam);
    this.cinema.apply(this.camera);
    if (this.trauma > 0) {
      const k = this.trauma * this.trauma;
      this.camera.position.add(_v.set((Math.random() - 0.5) * 0.25 * k, (Math.random() - 0.5) * 0.25 * k, (Math.random() - 0.5) * 0.25 * k));
      this.camera.rotateZ((Math.random() - 0.5) * 0.04 * k);
      this.trauma = Math.max(0, this.trauma - realDt * 1.8);
    }
    this.hud.numbers(this.camera, realDt);
  }

  private skillsHud(): { q: number; e: number; qMax: number; eMax: number } {
    return { q: this.kit.cdQ, e: this.kit.cdE, qMax: KIT_NUMBERS.FOXFIRE.cd, eMax: KIT_NUMBERS.GRENADE.cd };
  }

  private bossBar(): Boss | null { return this.bosses.find(b => b.active && !b.defeated && !this.cinema.locked) ?? null; }
  private firesText(): string { return `灵火 ${FIRE_STATE.lit} / ${FIRES_TO_UNLOCK}`; }

  private onShot(s: ShotResult): void {
    if (!s.target) return;
    this.hud.hitmark(s.mult > 1, s.killed);
    if (s.killed && (s.target as Foe).enc !== undefined) {
      this.kills++;
      if (s.target === this.roamer) this.say('穷奇倒下了', 3);
    }
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

  private onLordDown(b: Boss): void {
    b.rewarded = true;
    b.active = false;
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

  private respawn(first: boolean): void {
    const P = this.player;
    P.hp = P.maxHp; P.shield = P.maxShield; P.alive = true;
    this.fx.clear();
    this.kit.clear();
    this.elements.clear();
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
    for (const b of this.bosses) if (b.active && !b.defeated) b.reset();
    if (!first) this.hud.center('', '');
  }

  private objective(): string {
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

  // ─────────────── 调试 / 脚本化试玩 ───────────────

  /** 控制台 / 试玩脚本用（plateau.play.dev） */
  get dev(): Record<string, unknown> {
    const self = this;
    return {
      moveTable,
      /** 在玩家前方 dist 米刷一只（不属于任何遇敌：自己一群） */
      spawn(kind: string, dist = 12, angle = 0): Foe {
        const a = self.walker.yaw + Math.PI + angle;
        const F = self.walker.feet;
        const x = F.x + Math.sin(a) * dist, z = F.z + Math.cos(a) * dist;
        const enc: EncounterState = { id: `dev-${kind}`, site: '', x, z, r: 30, foes: [], alerted: true, cleared: false, burrows: [], tokens: { melee: 0, pounce: 0, ranged: 0, howl: 0 } };
        const f = createFoe(kind as never, self, new THREE.Vector3(x, self.terrain.heightAt(x, z) + (kind === 'manman' ? 7 : kind === 'liangu' ? 3 : 0), z), kind === 'manman' ? 7 : kind === 'liangu' ? 3 : 0, MONSTER_NAMES);
        f.enc = enc;
        enc.foes.push(f);
        self.foes.push(f);
        self.encounters.push(enc);
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
        // 跳过融合：直接到位
        self.cinema.t = 0.6;
      },
      stopWatch(): void { if (self.cinema.shot?.name === 'observe') self.cinema.shot = null; },
      stopObserve(): void { if (self.cinema.shot?.name === 'observe') self.cinema.shot = null; },
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
