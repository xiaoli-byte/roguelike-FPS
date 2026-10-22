/**
 * 玩家手段（chuanzang-combat-v1.md 第 2 节）：燎的 E 燃爆雷、Q 尾焰火灵、被动余烬；冲刺无敌；秘卷（三选一）。
 * 数值按网页版的枪缩放（每发 16、9 发 / 秒）；秘卷名字和效果取自正式游戏的秘卷表。
 */
import * as THREE from 'three';
import type { Actor, DamageInfo, Elem, HitSphere, PlayCtx, Target } from './core';

export interface ScrollDef { id: string; name: string; rarity: 0 | 1 | 2; max: number; desc: string; combo?: string }

export const SCROLLS: ScrollDef[] = [
  { id: 'thunder_heart', name: '雷心', rarity: 0, max: 2, desc: '子弹 25% 挂雷殛（2 层 40%）', combo: '自己造带电：配燎的火就是焚雷' },
  { id: 'venom_heart', name: '蚀心', rarity: 0, max: 2, desc: '子弹 25% 挂蚀化（2 层 40%）', combo: '带电的怪 + 蚀化 = 封脉，打断前摇' },
  { id: 'ember_heart', name: '炎心', rarity: 0, max: 2, desc: '子弹 20% 挂灼烧（2 层 32%）', combo: '用枪烧蓑毛；带电的怪一枪一个焚雷' },
  { id: 'rx_tf_charm', name: '雷火符', rarity: 0, max: 3, desc: '焚雷伤害 +40%' },
  { id: 'rx_tf_scatter', name: '爆焰', rarity: 2, max: 2, desc: '焚雷半径 +50%，雷弧多跳 2 个', combo: '啸獭窝、帝江群一炸一片' },
  { id: 'rx_vs_lock', name: '锁灵', rarity: 2, max: 2, desc: '封脉眩晕 +0.6 秒，首领脉滞 +6%' },
  { id: 'rx_mg_shatter', name: '熔铸', rarity: 2, max: 2, desc: '熔金对蓑毛 / 甲 ×3，蓑毛烧得快一倍', combo: '獓狠' },
  { id: 'wildfire', name: '野火燎原', rarity: 2, max: 1, desc: '灼烧中的敌人死时把灼烧传给 6 m 内的敌人' },
  { id: 'static_arc', name: '静电弧', rarity: 2, max: 2, desc: '打中带电的敌人时，电弧跳到 6 m 内另 1 个敌人（8 伤害、挂雷殛）' },
  { id: 'wind_walker', name: '踏风', rarity: 0, max: 2, desc: '冲刺冷却 −35%，无敌时间 +0.1 秒', combo: '穿过蛮蛮电弧、獓狠冲撞、雷息' },
  { id: 'high_ground', name: '居高临下', rarity: 1, max: 2, desc: '比目标高 3 m 以上时伤害 +25%', combo: '抢屋顶；站上露出水面的身段' },
  { id: 'spirit_ward', name: '灵盾', rarity: 0, max: 3, desc: '护盾 +25' },
  { id: 'rx_catalyst', name: '催化', rarity: 0, max: 3, desc: '反应伤害 +10%' },
  { id: 'rx_haste', name: '灵动', rarity: 1, max: 2, desc: '反应冷却 −20%' },
];

const RARITY_COLOR = ['#cfe8c4', '#7ec3ff', '#d59bff'];

const GRENADE = { radius: 4.5, damage: 120, speed: 21, lift: 3.2, gravity: 20, life: 4, cd: 8, power: 40 };
const FOXFIRE = { count: 9, duration: 3, damage: 30, speed: 17, homing: 7, range: 45, cd: 18, power: 22 };
const EMBER_BONUS = 0.2;

interface Grenade { mesh: THREE.Group; pos: THREE.Vector3; vel: THREE.Vector3; life: number }
interface Wisp { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; life: number; target: Actor | null }

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Kit {
  readonly owned = new Map<string, number>();
  cdE = 0;
  cdQ = 0;
  private grenades: Grenade[] = [];
  private wisps: Wisp[] = [];
  private foxLeft = 0;
  private foxT = 0;
  private arcCd = 0;
  /** 正在三选一（游戏暂停） */
  offering: ScrollDef[] | null = null;
  private offerEl: HTMLDivElement | null = null;
  private onPicked: (() => void) | null = null;
  private readonly rng = { s: 7 };
  /** 统计（试玩脚本检查） */
  readonly stats = { grenades: 0, wisps: 0, procs: { fire: 0, shock: 0, corrode: 0 } as Record<Elem, number> };

  constructor(private readonly ctx: PlayCtx, private readonly camera: THREE.Camera) {}

  stacks(id: string): number { return this.owned.get(id) ?? 0; }

  add(id: string): void {
    const def = SCROLLS.find(s => s.id === id);
    if (!def) return;
    this.owned.set(id, Math.min(def.max, this.stacks(id) + 1));
    this.applyPassives();
  }

  /** 秘卷的被动数值（护盾上限、冲刺） */
  applyPassives(): void {
    const P = this.ctx.player, W = this.ctx.walker;
    const ward = this.stacks('spirit_ward') * 25;
    const base = 50 + ward;
    if (P.maxShield !== base) { P.shield += base - P.maxShield; P.maxShield = base; }
    W.dashCooldown = 0.9 * (1 - 0.35 * Math.min(1, this.stacks('wind_walker')) - 0.1 * Math.max(0, this.stacks('wind_walker') - 1));
    W.dashGrace = 0.2 + 0.1 * this.stacks('wind_walker');
  }

  private rand(): number { this.rng.s = (this.rng.s * 16807) % 2147483647; return this.rng.s / 2147483647; }

  // ─────────────── 子弹 ───────────────

  /** 子弹打中之前：余烬、居高临下 */
  bulletDamage(base: number, target: Target): number {
    let d = base;
    const a = target as Partial<Actor>;
    if (a.status && a.status.burn > 0) d *= 1 + EMBER_BONUS;
    if (a.pos && this.stacks('high_ground') && this.ctx.feet.y - a.pos.y >= 3) d *= 1 + 0.25 * this.stacks('high_ground');
    return d;
  }

  /** 子弹打中之后：元素附着、静电弧 */
  afterBullet(target: Target, at: THREE.Vector3, dealt: number): void {
    const a = target as Actor;
    if (!a.status || !a.alive) return;
    const procs: [Elem, string, number][] = [['shock', 'thunder_heart', 0.25], ['corrode', 'venom_heart', 0.25], ['fire', 'ember_heart', 0.2]];
    for (const [elem, id, p] of procs) {
      const n = this.stacks(id);
      if (n && this.rand() < p * (n > 1 ? 1.6 : 1)) {
        this.stats.procs[elem]++;
        this.ctx.elements.apply(a, elem, Math.max(16, dealt * 2));
        if (elem === 'fire') this.ctx.onFire(at, 0.6);
      }
    }
    if (this.stacks('static_arc') && (a.charged() || a.status.shock > 0) && this.arcCd <= 0) {
      this.arcCd = 0.25;
      const others = this.ctx.actors().filter(o => o !== a && o.alive && o.center(_v).distanceTo(at) < 6).slice(0, this.stacks('static_arc'));
      for (const o of others) {
        const p = o.center(new THREE.Vector3());
        this.ctx.fx.arc(at, p, '#ff7ae6', 0.15);
        o.hit(8 * this.ctx.player.dmgMul, 1, p, { kind: 'reaction', elem: 'shock', poise: 1 });
        this.ctx.elements.apply(o, 'shock', 16);
      }
    }
  }

  // ─────────────── 技能 ───────────────

  update(dt: number, input: { skillE: boolean; skillQ: boolean }, locked: boolean): void {
    this.cdE = Math.max(0, this.cdE - dt);
    this.cdQ = Math.max(0, this.cdQ - dt);
    this.arcCd = Math.max(0, this.arcCd - dt);
    if (!locked && this.ctx.player.alive) {
      if (input.skillE && this.cdE <= 0) this.throwGrenade();
      if (input.skillQ && this.cdQ <= 0) { this.cdQ = FOXFIRE.cd; this.foxLeft = FOXFIRE.count; this.foxT = 0.3; }
    }
    if (this.foxLeft > 0) {
      this.foxT -= dt;
      if (this.foxT <= 0) { this.foxT = (FOXFIRE.duration - 0.3) / (FOXFIRE.count - 1); this.foxLeft--; this.spawnWisp(); }
    }
    this.updateGrenades(dt);
    this.updateWisps(dt);
  }

  private throwGrenade(): void {
    this.cdE = GRENADE.cd;
    this.stats.grenades++;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.28, 10), new THREE.MeshStandardMaterial({ color: '#c8231b', emissive: '#3a0402', roughness: 0.6 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.084, 0.084, 0.05, 10), new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.5, roughness: 0.4 }));
    cap.position.y = 0.15;
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffe08a' }));
    spark.position.y = 0.22;
    g.add(body, cap, spark);
    this.camera.getWorldPosition(_v);
    this.camera.getWorldDirection(_w);
    const pos = _v.clone().addScaledVector(_w, 0.6).add(new THREE.Vector3(0, -0.15, 0));
    const vel = _w.clone().multiplyScalar(GRENADE.speed).add(new THREE.Vector3(0, GRENADE.lift, 0));
    g.position.copy(pos);
    this.ctx.scene.add(g);
    this.grenades.push({ mesh: g, pos, vel, life: GRENADE.life });
  }

  private updateGrenades(dt: number): void {
    this.grenades = this.grenades.filter(G => {
      G.life -= dt;
      G.vel.y -= GRENADE.gravity * dt;
      G.pos.addScaledVector(G.vel, dt);
      G.mesh.position.copy(G.pos);
      G.mesh.rotation.x += dt * 9; G.mesh.rotation.z += dt * 5;
      if (Math.random() < 0.6) this.ctx.fx.spray(G.pos, ['#ffd27a', '#ff8a3a'], 1, 0.6, 0.5, 2, 0.3);
      let boom = G.life <= 0 || G.pos.y <= this.ctx.fx.ground(G.pos.x, G.pos.z) + 0.1 || this.ctx.world.solidAt(G.pos.x, G.pos.y, G.pos.z);
      if (!boom) for (const a of this.ctx.actors()) {
        if (!a.alive) continue;
        if (a.spheres().some(s => s.c.distanceTo(G.pos) < s.r + 0.25)) { boom = true; break; }
      }
      if (!boom) return true;
      this.ctx.scene.remove(G.mesh);
      this.blast(G.pos.clone(), GRENADE.radius, GRENADE.damage, GRENADE.power);
      return false;
    });
  }

  /** 燎的火爆炸：对半径内的单位按距离衰减造成伤害、挂灼烧；点燃场地机关 */
  blast(at: THREE.Vector3, r: number, dmg: number, power: number): void {
    const fx = this.ctx.fx;
    fx.burst(at, r * 0.8, '#ffb04a');
    fx.burst(at, r * 0.45, '#fff0c0');
    fx.spray(at, ['#ff3a1a', '#ffd24a', '#ff8a3a', '#ffffff'], 60, 9, 6, 16, 0.9);
    fx.shockwave(at.x, at.z, r, 0.3, undefined, '#ffb04a');
    this.ctx.shake(0.35);
    for (const a of this.ctx.actors()) {
      if (!a.alive) continue;
      let best: HitSphere | null = null, bd = Infinity;
      for (const s of a.spheres()) { const d = s.c.distanceTo(at) - s.r; if (d < bd) { bd = d; best = s; } }
      if (!best || bd > r) continue;
      const fall = 1 - 0.4 * Math.max(0, bd) / r;
      const info: DamageInfo = { kind: 'blast', elem: 'fire', power, sphere: best, from: at, poise: 3, blastR: r };
      a.hit(this.bulletDamage(dmg * fall * this.ctx.player.dmgMul, a), 1, best.c, info);
      if (a.alive) this.ctx.elements.apply(a, 'fire', power);
    }
    this.ctx.onFire(at, r);
  }

  private spawnWisp(): void {
    this.stats.wisps++;
    this.camera.getWorldPosition(_v);
    this.camera.getWorldDirection(_w);
    const right = new THREE.Vector3().crossVectors(_w, new THREE.Vector3(0, 1, 0)).normalize();
    const k = this.foxLeft % 2 ? 1 : -1;
    const pos = _v.clone().addScaledVector(right, 0.6 * k).add(new THREE.Vector3(0, -0.25, 0)).addScaledVector(_w, 0.5);
    const vel = _w.clone().multiplyScalar(FOXFIRE.speed * 0.6).addScaledVector(right, 4 * k).add(new THREE.Vector3(0, 3, 0));
    // 目标：视野前方 45 m 内最近的
    let target: Actor | null = null, best = Infinity;
    for (const a of this.ctx.actors()) {
      if (!a.alive) continue;
      const c = a.center(new THREE.Vector3());
      const d = c.distanceTo(_v);
      if (d > FOXFIRE.range) continue;
      const dir = c.clone().sub(_v).normalize();
      const score = d * (1.6 - dir.dot(_w));
      if (dir.dot(_w) > 0.35 && score < best) { best = score; target = a; }
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff9a3a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.copy(pos);
    this.ctx.scene.add(mesh);
    this.wisps.push({ mesh, pos, vel, life: 2.8, target });
  }

  private updateWisps(dt: number): void {
    this.wisps = this.wisps.filter(W => {
      W.life -= dt;
      if (W.target && W.target.alive) {
        const want = W.target.center(_v).sub(W.pos).normalize().multiplyScalar(FOXFIRE.speed);
        W.vel.lerp(want, Math.min(1, FOXFIRE.homing * dt));
      } else W.vel.y -= 2 * dt;
      W.pos.addScaledVector(W.vel, dt);
      W.mesh.position.copy(W.pos);
      W.mesh.scale.setScalar(0.8 + 0.3 * Math.sin(W.life * 30));
      this.ctx.fx.spray(W.pos, ['#ff8a3a', '#ffd24a'], 1, 0.4, 0.3, -1, 0.25);
      let hitA: Actor | null = null;
      for (const a of this.ctx.actors()) {
        if (!a.alive) continue;
        if (a.spheres().some(s => s.c.distanceTo(W.pos) < s.r + 0.3)) { hitA = a; break; }
      }
      const ground = W.pos.y <= this.ctx.fx.ground(W.pos.x, W.pos.z);
      if (!hitA && !ground && W.life > 0) return true;
      this.ctx.scene.remove(W.mesh);
      this.ctx.fx.burst(W.pos, 0.9, '#ff9a3a');
      this.ctx.fx.spray(W.pos, ['#ff8a3a', '#ffd24a'], 10, 4, 2, 10, 0.5);
      if (hitA) {
        let best: HitSphere | null = null, bd = Infinity;
        for (const s of hitA.spheres()) { const d = s.c.distanceTo(W.pos) - s.r; if (d < bd) { bd = d; best = s; } }
        hitA.hit(this.bulletDamage(FOXFIRE.damage * this.ctx.player.dmgMul, hitA), best && best.mult > 1 ? Math.min(best.mult, 1.5) : 1, W.pos.clone(),
          { kind: 'blast', elem: 'fire', power: FOXFIRE.power, sphere: best ?? undefined, from: W.pos.clone(), poise: 1.5, blastR: 0.8 });
        if (hitA.alive) this.ctx.elements.apply(hitA, 'fire', FOXFIRE.power);
      }
      this.ctx.onFire(W.pos, 1.2);
      return false;
    });
  }

  // ─────────────── 秘卷三选一 ───────────────

  /** 弹出三选一（游戏暂停）；picked 在选完后调用 */
  offer(n = 3, picked?: () => void): void {
    const pool = SCROLLS.filter(s => this.stacks(s.id) < s.max);
    const choice: ScrollDef[] = [];
    while (choice.length < n && pool.length) choice.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    if (!choice.length) { picked?.(); return; }
    this.offering = choice;
    this.onPicked = picked ?? null;
    const el = document.createElement('div');
    el.id = 'scroll-offer';
    el.innerHTML = `<h3>选一张秘卷 <small>按 1 / 2 / 3</small></h3><div class="cards">${choice.map((s, i) => `
      <div class="card" data-i="${i}" style="border-color:${RARITY_COLOR[s.rarity]}">
        <kbd>${i + 1}</kbd><b style="color:${RARITY_COLOR[s.rarity]}">${s.name}${this.stacks(s.id) ? ` · ${this.stacks(s.id) + 1} 层` : ''}</b>
        <p>${s.desc}</p>${s.combo ? `<i>${s.combo}</i>` : ''}</div>`).join('')}</div>`;
    el.querySelectorAll<HTMLDivElement>('.card').forEach(c => { c.onclick = () => this.pick(Number(c.dataset.i)); });
    document.body.appendChild(el);
    this.offerEl = el;
  }

  pick(i: number): void {
    if (!this.offering || !this.offering[i]) return;
    const s = this.offering[i];
    this.add(s.id);
    this.offering = null;
    this.offerEl?.remove();
    this.offerEl = null;
    this.ctx.say(`获得秘卷「${s.name}」：${s.desc}`, 3.5);
    const cb = this.onPicked;
    this.onPicked = null;
    cb?.();
  }

  /** 秘卷列表（HUD） */
  list(): string[] {
    return [...this.owned.entries()].map(([id, n]) => `${SCROLLS.find(s => s.id === id)?.name ?? id}${n > 1 ? ` ×${n}` : ''}`);
  }

  clear(): void {
    for (const G of this.grenades) this.ctx.scene.remove(G.mesh);
    for (const W of this.wisps) this.ctx.scene.remove(W.mesh);
    this.grenades = []; this.wisps = []; this.foxLeft = 0;
  }
}

export const KIT_NUMBERS = { GRENADE, FOXFIRE, EMBER_BONUS };
