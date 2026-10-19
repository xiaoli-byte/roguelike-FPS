/**
 * 4-1 游玩模式：把正式模型的雷魅和三个领主放进开放盆地，加上射击、受伤、灵火点亮、出口和通关。
 * 规则（chuanzang-v1.md 2.6）：
 * - 6 个据点任意顺序。普通据点：清掉那片的雷魅，在灵火坛按住 E 点亮。领主据点（④ 圣湖 化蛇、⑤ 冰川口 飞廉、⑥ 经幡山头 夔）：
 *   打败领主直接点亮，另给伤害 +20%、血上限 +25。
 * - 点亮任意 3 处，⑦ 垭口的经幡门打开；走进门里通关。点亮灵火 = 回满血 + 存档点。
 * - 倒下：回到最后点亮的灵火（没有就回出生点）；正在打的那片雷魅回家回血，领主战重置；打死的不复活。
 */
import * as THREE from 'three';
import { FIRE_STATE } from '../landmarks';
import { ALERT_RADIUS, ENCOUNTERS, FIRES_TO_UNLOCK, LORDS, MONSTER_NAMES, PLACEMENTS, ROAMER, SITES } from '../spec';
import type { Terrain } from '../terrain';
import type { CollisionWorld, Walker } from '../walker';
import type { Weather } from '../weather';
import { loadPlateauModels } from './assets';
import { Boss, FeilianBoss, HuasheBoss, KuiBoss } from './bosses';
import { PLAYER_R, type KnockBack, type PlayCtx, type PlayerState, type Target } from './core';
import { Foe, Roamer, type EncounterState } from './foes';
import { CombatFx } from './fx';
import { GUN, Gun, type ShotResult } from './gun';
import { NavField } from './nav';

export interface PlayInput { firing: boolean; interact: boolean; reload: boolean }

interface SiteState { id: string; name: string; altar: THREE.Vector3; index: number; lit: boolean; enc: EncounterState | null; boss: Boss | null }

const LORD_SITE: Record<string, string> = { kui: 's6', feilian: 's5', huashe: 's4' };

export class PlayMode implements PlayCtx {
  readonly fx: CombatFx;
  nav: NavField | null = null;
  readonly player: PlayerState = { hp: 100, maxHp: 100, shield: 50, maxShield: 50, dmgMul: 1, alive: true, lastHurt: -99 };
  time = 0;
  readonly feet = new THREE.Vector3();
  readonly center = new THREE.Vector3();
  readonly encounters: EncounterState[] = [];
  readonly foes: Foe[] = [];
  readonly bosses: Boss[] = [];
  readonly sites: SiteState[] = [];
  private roamer!: Roamer;
  private gun!: Gun;
  private checkpoint: THREE.Vector3;
  private kills = 0;
  private deaths = 0;
  private lordsDown = 0;
  private holdE = 0;
  private deadT = 0;
  private won = false;
  private readonly lastFeet = new THREE.Vector3();
  private readonly pvel = new THREE.Vector2();
  private readonly gate: THREE.Vector2;
  private readonly hud: Hud;
  ready = false;

  constructor(
    readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    readonly terrain: Terrain,
    readonly world: CollisionWorld,
    readonly walker: Walker,
    readonly weather: Weather,
  ) {
    this.fx = new CombatFx(scene, terrain, world);
    const spawn = SITES.find(s => s.kind === 'spawn')!;
    this.checkpoint = new THREE.Vector3(spawn.x, 0, spawn.z);
    const g = PLACEMENTS.find(p => p.kind === 'flagGate')!;
    this.gate = new THREE.Vector2(g.x, g.z);
    this.hud = new Hud();
  }

  /** 加载模型、摆怪、开局（出生点） */
  async start(): Promise<void> {
    this.hud.loading('正在加载第四章的雷魅和领主模型…');
    await loadPlateauModels((d, n) => this.hud.loading(`正在加载第四章的雷魅和领主模型… ${d}/${n}`));
    this.hud.loading('');
    this.nav = new NavField(this.terrain, this.world);
    const T = this.terrain;
    for (const E of ENCOUNTERS) {
      const enc: EncounterState = { id: E.id, site: E.site, x: E.x, z: E.z, r: E.r, foes: [], alerted: false, cleared: false };
      for (const u of E.units) {
        const ground = T.heightAt(u.at[0], u.at[2]);
        const f = new Foe(u.kind, this.scene, new THREE.Vector3(u.at[0], ground + u.at[1], u.at[2]), u.at[1], MONSTER_NAMES);
        f.enc = enc;
        f.sentinel = !!u.sentinel;
        // 蛮蛮成对：第二只是镜像（只有右翼）
        if (u.kind === 'manman' && enc.foes.some(o => o.kind === 'manman') && enc.foes.filter(o => o.kind === 'manman').length % 2 === 1) f.host.scale.x *= -1;
        enc.foes.push(f);
        this.foes.push(f);
      }
      this.encounters.push(enc);
    }
    const [rx, rz] = ROAMER.path[0];
    this.roamer = new Roamer(this.scene, new THREE.Vector3(rx, T.heightAt(rx, rz), rz), MONSTER_NAMES, ROAMER.path as [number, number][], ROAMER.lair as [number, number]);
    this.foes.push(this.roamer);
    this.bosses.push(new KuiBoss(this.scene, this), new FeilianBoss(this.scene, this), new HuasheBoss(this.scene, this));
    let index = 0;
    for (const s of SITES) {
      if (!s.altar) continue;
      const lord = LORDS.find(l => LORD_SITE[l.id] === s.id);
      this.sites.push({
        id: s.id, name: s.name, index: index++, lit: false,
        altar: new THREE.Vector3(s.altar[0], T.heightAt(s.altar[0], s.altar[1]), s.altar[1]),
        enc: this.encounters.find(e => e.site === s.id) ?? null,
        boss: lord ? this.bosses.find(b => b.lord.id === lord.id) ?? null : null,
      });
    }
    FIRE_STATE.mask = this.sites.map(() => false);
    FIRE_STATE.lit = 0;
    this.gun = new Gun(this.camera);
    this.scene.add(this.camera);
    this.respawn(true);
    this.ready = true;
    this.say('折多垭口：点亮任意 3 处灵火，打开 ⑦ 垭口的经幡门', 5);
  }

  // ─────────────── PlayCtx ───────────────

  hurt(dmg: number, source: string, knock?: KnockBack): void {
    const P = this.player;
    if (!P.alive || this.won) return;
    P.lastHurt = this.time;
    const s = Math.min(P.shield, dmg);
    P.shield -= s;
    P.hp -= dmg - s;
    if (knock) this.walker.knock(knock.x, knock.z, knock.up ?? 0);
    this.hud.hurt(dmg, s >= dmg);
    if (P.hp <= 0) {
      P.hp = 0; P.alive = false; this.deadT = 0; this.deaths++;
      this.hud.center(`你倒下了——${source}`, '回到最近点亮的灵火…');
    }
  }

  say(text: string, seconds = 3): void { this.hud.say(text, seconds); }

  // ─────────────── 每帧 ───────────────

  update(dt: number, input: PlayInput): void {
    if (!this.ready) return;
    this.time += dt;
    const W = this.walker;
    this.feet.copy(W.feet);
    this.center.copy(W.feet).setY(W.feet.y + 0.95);
    this.pvel.set((this.feet.x - this.lastFeet.x) / Math.max(dt, 1e-3), (this.feet.z - this.lastFeet.z) / Math.max(dt, 1e-3));
    this.lastFeet.copy(this.feet);
    const P = this.player;
    // 倒下 → 2.5 秒后在存档点重来
    if (!P.alive) {
      this.deadT += dt;
      if (this.deadT > 2.5) this.respawn(false);
    }
    // 护盾：4 秒没挨打开始回
    if (P.alive && this.time - P.lastHurt > 4) P.shield = Math.min(P.maxShield, P.shield + 30 * dt);
    this.nav?.update(dt, this.feet.x, this.feet.z);
    // 射击
    const targets: Target[] = [...this.foes.filter(f => f.alive && f.pos.distanceToSquared(this.feet) < 300 * 300), ...this.bosses];
    if (input.reload) this.gun.startReload();
    const shots = this.gun.update(dt, input.firing && P.alive && !this.won, this, targets);
    for (const s of shots) this.onShot(s);
    // 怪
    for (const f of this.foes) {
      const d2 = f.pos.distanceToSquared(this.feet);
      if (!f.alive && !f.host.visible) continue;
      if (f === this.roamer || d2 < 220 * 220 || f.state === 'alert') {
        f.notePlayerVel(this.pvel.x, this.pvel.y);
        f.update(dt, this, d2 < 170 * 170);
      }
    }
    this.updateEncounters();
    // 领主
    for (const b of this.bosses) {
      const d = Math.hypot(this.feet.x - b.arena.x, this.feet.z - b.arena.y);
      if (!b.active && !b.defeated && P.alive && b.shouldStart(this)) b.start(this);
      if (b.active && !b.defeated && (d > b.arenaR + 30 || !P.alive)) {
        b.reset(this);
        if (P.alive) this.say(`${b.label}的战斗重置了——离擂台太远`, 2.5);
      }
      b.update(dt, this);
      if (b.defeated && !b.rewarded) this.onLordDown(b);
    }
    this.fx.update(dt, this.center, PLAYER_R);
    this.interact(dt, input.interact);
    // 通关：灵火够了、走进垭口经幡门
    if (!this.won && FIRE_STATE.lit >= FIRES_TO_UNLOCK && Math.hypot(this.feet.x - this.gate.x, this.feet.z - this.gate.y) < 9) this.victory();
    const active = this.bosses.find(b => b.active && !b.defeated) ?? null;
    this.hud.update(dt, this.player, this.gun.ammo, GUN.mag, this.gun.reloading > 0, FIRE_STATE.lit, active, this.objective());
    this.hud.numbers(this.camera, dt);
  }

  private onShot(s: ShotResult): void {
    if (!s.target) return;
    this.hud.hitmark(s.mult > 1, s.killed);
    this.hud.damageNumber(s.point, s.dealt, s.mult > 1);
    if (s.killed && s.target instanceof Foe) {
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
        for (const f of e.foes) if (f.alive && f.state === 'idle') f.notice(this);
      }
      // 啸獭哨兵叫醒附近 60 m 内的别的遇敌
      const sentinel = e.foes.find(f => f.sentinel && f.state === 'alert');
      if (sentinel) for (const o of this.encounters) {
        if (o !== e && !o.alerted && Math.hypot(o.x - sentinel.pos.x, o.z - sentinel.pos.z) < ALERT_RADIUS) {
          o.alerted = true;
          for (const f of o.foes) if (f.alive) f.state = 'alert';
        }
      }
      // 玩家跑远了：脱战回家
      if (e.alerted && Math.hypot(this.feet.x - e.x, this.feet.z - e.z) > e.r + 80) {
        e.alerted = false;
        for (const f of e.foes) if (f.alive) f.state = 'idle';
      }
      if (e.foes.every(f => !f.alive)) {
        e.cleared = true;
        const site = this.sites.find(s => s.id === e.site);
        if (site && !site.lit) this.say(`${site.name}：雷魅清空${site.boss && !site.boss.defeated ? `，但领主${site.boss.label}还守着灵火` : '——去灵火坛点亮灵火'}`, 4);
        else if (e.site === 'pass') this.say('垭口的守卫清掉了', 3);
      }
    }
  }

  private onLordDown(b: Boss): void {
    b.rewarded = true;
    b.active = false;
    this.lordsDown++;
    if (b instanceof KuiBoss) this.weather.stormy = false;
    const P = this.player;
    P.dmgMul += 0.2;
    P.maxHp += 25;
    P.hp = P.maxHp; P.shield = P.maxShield;
    const site = this.sites.find(s => s.boss === b);
    if (site) this.light(site, false);
    this.say(`${b.label}被打败了——灵火点亮，伤害 +20%，血上限 +25`, 5);
  }

  /** 灵火坛交互：按住 E 1.2 秒点亮 */
  private interact(dt: number, holding: boolean): void {
    let prompt = '';
    const near = this.sites.find(s => Math.hypot(this.feet.x - s.altar.x, this.feet.z - s.altar.z) < 3.8);
    if (near && this.player.alive) {
      const left = near.enc ? near.enc.foes.filter(f => f.alive).length : 0;
      if (near.lit) prompt = '灵火已点亮';
      else if (near.boss && !near.boss.defeated) prompt = `领主${near.boss.label}守着这处灵火——打败它就会点亮`;
      else if (left > 0) prompt = `还有 ${left} 只雷魅守着灵火`;
      else {
        prompt = '按住 E 点亮灵火';
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
  }

  private respawn(first: boolean): void {
    const P = this.player;
    P.hp = P.maxHp; P.shield = P.maxShield; P.alive = true;
    this.fx.clear();
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
    for (const b of this.bosses) if (b.active && !b.defeated) b.reset(this);
    if (!first) this.hud.center('', '');
  }

  private objective(): string {
    const lit = FIRE_STATE.lit;
    if (this.won) return '';
    if (lit >= FIRES_TO_UNLOCK) return '经幡门已开：去 ⑦ 垭口（东北的盘山天路顶上）';
    return `点亮灵火 ${lit}/${FIRES_TO_UNLOCK} · 清掉据点的雷魅后在灵火坛按住 E；领主据点打败领主直接点亮`;
  }

  private victory(): void {
    this.won = true;
    const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
    this.hud.victory([
      `用时 ${m} 分 ${String(s).padStart(2, '0')} 秒`,
      `点亮灵火 ${FIRE_STATE.lit} 处 · 打败领主 ${this.lordsDown}/3`,
      `击杀雷魅 ${this.kills} · 倒下 ${this.deaths} 次`,
    ]);
  }
}

// ───────────────────────────── HUD ─────────────────────────────

const CSS = `
#play-hud{position:fixed;inset:0;pointer-events:none;font-family:"Microsoft YaHei",sans-serif;color:#fff;z-index:20}
#play-hud .bars{position:absolute;left:50%;transform:translateX(-50%);bottom:54px;width:340px;text-align:center}
#play-hud .bar{height:12px;background:#0008;border:1px solid #fff4;border-radius:3px;margin-top:6px;overflow:hidden}
#play-hud .bar i{display:block;height:100%}
#play-hud .shield i{background:linear-gradient(90deg,#6ad6ff,#b8f0ff)}
#play-hud .hp i{background:linear-gradient(90deg,#e8434a,#ff8a6a)}
#play-hud .num{font-size:13px;text-shadow:0 1px 2px #000}
#play-hud .ammo{position:absolute;right:28px;bottom:24px;font-size:34px;font-weight:bold;text-shadow:0 2px 4px #000}
#play-hud .ammo small{font-size:16px;opacity:.75}
#play-hud .obj{position:absolute;left:50%;top:14px;transform:translateX(-50%);font-size:14px;background:#0007;padding:6px 14px;border-radius:4px;white-space:nowrap}
#play-hud .fires{display:none;position:absolute;left:16px;top:78px;font-size:16px;font-weight:bold;color:#9ff0ff;text-shadow:0 1px 3px #000}
#play-hud .boss{position:absolute;left:50%;top:48px;transform:translateX(-50%);width:520px;display:none;text-align:center}
#play-hud .boss .bar{height:14px}
#play-hud .boss i{background:linear-gradient(90deg,#b2186f,#ff4fd8)}
#play-hud .boss b{font-size:17px;text-shadow:0 1px 3px #000}
#play-hud .say{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:20px;font-weight:bold;text-shadow:0 2px 6px #000;transition:opacity .4s;white-space:nowrap}
#play-hud .prompt{position:absolute;left:50%;top:60%;transform:translateX(-50%);font-size:16px;text-shadow:0 1px 3px #000;text-align:center}
#play-hud .prompt .bar{width:180px;margin:6px auto 0}
#play-hud .prompt i{background:#9ff0ff}
#play-hud .vig{position:absolute;inset:0;box-shadow:inset 0 0 160px #e00;opacity:0;transition:opacity .25s}
#play-hud .hitm{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;opacity:0;
  background:linear-gradient(45deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%),linear-gradient(-45deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%)}
#play-hud .center{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);text-align:center;text-shadow:0 2px 8px #000}
#play-hud .center b{font-size:34px;display:block}
#play-hud .center span{font-size:16px;opacity:.85}
#play-hud .dmg{position:absolute;font-weight:bold;font-size:15px;text-shadow:0 1px 2px #000;transform:translate(-50%,-50%)}
#play-hud .loading{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:18px;background:#000a;padding:12px 20px;border-radius:6px}
#play-hud .win{position:absolute;inset:0;background:#000b;display:none;align-items:center;justify-content:center;flex-direction:column;pointer-events:auto}
#play-hud .win h2{font-size:40px;margin:0 0 10px;color:#ffe08a}
#play-hud .win p{margin:4px;font-size:17px}
#play-hud .win button{margin-top:18px;font-size:16px;padding:8px 22px;cursor:pointer}
`;

class Hud {
  private readonly root: HTMLDivElement;
  private readonly el: Record<string, HTMLElement> = {};
  private sayT = 0;
  private vig = 0;
  private hitT = 0;
  private readonly nums: { el: HTMLDivElement; pos: THREE.Vector3; t: number }[] = [];
  private readonly _p = new THREE.Vector3();

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'play-hud';
    this.root.innerHTML = `
      <div class="vig"></div>
      <div class="fires"></div>
      <div class="obj"></div>
      <div class="boss"><b></b><div class="bar"><i></i></div></div>
      <div class="say"></div>
      <div class="hitm"></div>
      <div class="prompt"><span></span><div class="bar"><i></i></div></div>
      <div class="center"><b></b><span></span></div>
      <div class="bars"><div class="num"></div><div class="bar shield"><i></i></div><div class="bar hp"><i></i></div></div>
      <div class="ammo"></div>
      <div class="loading"></div>
      <div class="win"><h2>通关 · 折多垭口</h2><div class="stats"></div><button>再打一遍</button></div>`;
    document.body.appendChild(this.root);
    for (const k of ['vig', 'fires', 'obj', 'boss', 'say', 'hitm', 'prompt', 'center', 'bars', 'ammo', 'loading', 'win']) this.el[k] = this.root.querySelector(`.${k}`)!;
    (this.root.querySelector('.win button') as HTMLButtonElement).onclick = () => location.reload();
  }

  loading(text: string): void {
    this.el.loading.textContent = text;
    this.el.loading.style.display = text ? '' : 'none';
  }

  say(text: string, seconds: number): void {
    this.el.say.textContent = text;
    this.el.say.style.opacity = '1';
    this.sayT = seconds;
  }

  center(title: string, sub: string): void {
    (this.el.center.querySelector('b') as HTMLElement).textContent = title;
    (this.el.center.querySelector('span') as HTMLElement).textContent = sub;
  }

  hurt(_dmg: number, shieldOnly: boolean): void { this.vig = shieldOnly ? 0.35 : 0.8; }

  hitmark(weak: boolean, killed: boolean): void {
    this.hitT = 0.12;
    this.el.hitm.style.filter = killed ? 'drop-shadow(0 0 4px #f44) brightness(1.2) sepia(1) hue-rotate(-50deg) saturate(6)' : weak ? 'sepia(1) saturate(8) hue-rotate(10deg)' : '';
  }

  damageNumber(at: THREE.Vector3, dealt: number, weak: boolean): void {
    if (dealt <= 0) return;
    const el = document.createElement('div');
    el.className = 'dmg';
    el.textContent = String(Math.round(dealt));
    el.style.color = weak ? '#ffd24a' : '#ffffff';
    if (weak) el.style.fontSize = '19px';
    this.root.appendChild(el);
    this.nums.push({ el, pos: at.clone(), t: 0 });
    if (this.nums.length > 30) { const n = this.nums.shift()!; n.el.remove(); }
  }

  numbers(camera: THREE.Camera, dt: number): void {
    for (const n of this.nums) {
      n.t += dt;
      this._p.copy(n.pos).setY(n.pos.y + n.t * 1.2).project(camera);
      const vis = this._p.z < 1 && n.t < 0.8;
      n.el.style.display = vis ? '' : 'none';
      n.el.style.left = `${(this._p.x * 0.5 + 0.5) * innerWidth}px`;
      n.el.style.top = `${(-this._p.y * 0.5 + 0.5) * innerHeight}px`;
      n.el.style.opacity = String(1 - n.t / 0.8);
    }
    for (let i = this.nums.length - 1; i >= 0; i--) if (this.nums[i].t >= 0.8) { this.nums[i].el.remove(); this.nums.splice(i, 1); }
  }

  prompt(text: string, progress: number): void {
    (this.el.prompt.querySelector('span') as HTMLElement).textContent = text;
    const bar = this.el.prompt.querySelector('.bar') as HTMLElement;
    bar.style.display = progress > 0 ? '' : 'none';
    (bar.querySelector('i') as HTMLElement).style.width = `${progress * 100}%`;
  }

  update(dt: number, P: PlayerState, ammo: number, mag: number, reloading: boolean, lit: number, boss: Boss | null, objective: string): void {
    this.sayT -= dt;
    if (this.sayT <= 0) this.el.say.style.opacity = '0';
    this.vig = Math.max(0, this.vig - dt * 1.5);
    this.el.vig.style.opacity = String(this.vig);
    this.hitT -= dt;
    this.el.hitm.style.opacity = this.hitT > 0 ? '1' : '0';
    (this.el.bars.querySelector('.num') as HTMLElement).textContent = `护盾 ${Math.ceil(P.shield)} / ${P.maxShield}　生命 ${Math.ceil(P.hp)} / ${P.maxHp}${P.dmgMul > 1 ? `　伤害 ×${P.dmgMul.toFixed(1)}` : ''}`;
    (this.el.bars.querySelector('.shield i') as HTMLElement).style.width = `${(P.shield / P.maxShield) * 100}%`;
    (this.el.bars.querySelector('.hp i') as HTMLElement).style.width = `${(P.hp / P.maxHp) * 100}%`;
    this.el.ammo.innerHTML = reloading ? '换弹…' : `${ammo}<small> / ${mag}</small>`;
    this.el.fires.textContent = `灵火 ${lit} / 3`;
    this.el.obj.textContent = objective;
    this.el.obj.style.display = objective ? '' : 'none';
    this.el.boss.style.display = boss ? 'block' : 'none';
    if (boss) {
      (this.el.boss.querySelector('b') as HTMLElement).textContent = `${boss.label} · 第 ${boss.phase} 阶段`;
      (this.el.boss.querySelector('i') as HTMLElement).style.width = `${(boss.hp / boss.maxHp) * 100}%`;
    }
  }

  victory(lines: string[]): void {
    this.el.win.style.display = 'flex';
    (this.el.win.querySelector('.stats') as HTMLElement).innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    document.exitPointerLock();
  }
}
