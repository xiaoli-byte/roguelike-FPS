/**
 * 4-1 的三场领主战（chuanzang-combat-v1.md 4.1–4.3）：
 * - 夔（⑥ 经幡山头）：雷暴压境、从残鼓里长出来。一足蹦跳（小跳、大跳、转身跳）、拄拳挪位、雷掌；二阶段召鼓（两只连鼓灵护驾）、
 *   捶胸引雷（经幡杆引雷、带电的杆回劈落在旁边的夔）；三阶段风雨（外圈落雷、连环大跳）。破防「破鼓」：单膝跪地。
 * - 飞廉（⑤ 冰川口冰舌顶）：从风涡里落下。风一直往外推；狂风、低头冲撞（撞上东西就晕）、风刃、侧跃；二阶段龙卷（火龙卷反烧它）、回旋冲撞；
 *   三阶段风眼（风往里吸）、风雷爆。破防「珠碎」：风雷珠炸散、侧倒、风停。
 * - 化蛇（④ 圣湖）：破水而出。吐水弹、扑岸（搁浅是大窗口）、翼拍浪；二阶段涨水（常驻 +1.2 m）、吼叫涨水、潜游突袭；三阶段大水（漩涡往湖心拉）、尾扫。
 *   破防「噎住」：翻肚子浮在水面。水里湿身（灼烧减半）、导电（雷殛 +50%）。
 * 打败领主：那个据点的灵火直接点亮，伤害 +20%、血上限 +25、秘卷三选一。玩家倒下或跑出擂台太远：领主回满血、战斗重置。
 */
import * as THREE from 'three';
import { WORLD_UNIFORMS } from '../materials';
import { LAKES, LORDS, MONSTER_NAMES } from '../spec';
import { spawnCreature, spawnStatic } from './assets';
import { Boss } from './boss';
import { orbitCam, type CamKey, type Shot } from './cinema';
import type { DamageInfo, HitSphere, PlayCtx } from './core';
import type { EncounterState } from './foe';
import { Liangu } from './foes';
import { windBladeMesh } from './fx';
import { defineMoves, type MoveDef } from './moves';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const smooth = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

function knockFrom(ctx: PlayCtx, x: number, z: number, k: number, up = 0): { x: number; z: number; up: number } {
  const dx = ctx.feet.x - x, dz = ctx.feet.z - z, d = Math.max(0.5, Math.hypot(dx, dz));
  return { x: dx / d * k, z: dz / d * k, up };
}

// ───────────────────────────── 夔 ─────────────────────────────

const KUI = defineMoves('SK_Boss_Kui', [
  { id: 'hop', name: '小跳', windup: 0.3, active: 0.55, recover: 0.25, noHit: true, events: [{ at: 0.85, name: 'land' }] },
  { id: 'leap', name: '大跳', windup: 0.75, active: 1.05, recover: 0.8, glint: true, noHit: true, events: [{ at: 1.8, name: 'land' }] },
  { id: 'leapChain', name: '连环大跳', windup: 0.5, active: 0.9, recover: 0.35, minPhase: 3, noHit: true, events: [{ at: 1.4, name: 'land' }] },
  { id: 'turnLeap', name: '转身跳', windup: 0.3, active: 0.5, recover: 0.3, noHit: true, events: [{ at: 0.8, name: 'land' }] },
  { id: 'knuckle', name: '拄拳', windup: 0, active: 3.9, recover: 0, noHit: true, events: [{ at: 1.3, name: 'step' }, { at: 2.6, name: 'step' }, { at: 3.9, name: 'step' }] },
  { id: 'clap', name: '雷掌', windup: 0.6, active: 0.2, recover: 0.6, cooldown: 4, glint: true },
  { id: 'drum', name: '捶胸引雷', windup: 0.8, active: 1.8, recover: 1.0, minPhase: 2, armored: true, noHit: true,
    events: [{ at: 0.8, name: 'beat' }, { at: 1.4, name: 'beat' }, { at: 2.0, name: 'beat' }] },
  { id: 'drum5', name: '捶胸引雷（五下）', windup: 0.8, active: 3.0, recover: 1.0, minPhase: 3, armored: true, noHit: true,
    events: [0.8, 1.4, 2.0, 2.6, 3.2].map(at => ({ at, name: 'beat' })) },
  { id: 'roar', name: '吼（演出）', windup: 0.5, active: 1.5, recover: 0.5, noHit: true },
  { id: 'rise', name: '从残鼓里长出来（演出）', windup: 2.2, active: 0.5, recover: 0.5, noHit: true },
  { id: 'kneel', name: '破鼓（单膝跪地）', windup: 0.4, active: 3.2, recover: 0.4, noHit: true },
]);

export class KuiBoss extends Boss {
  readonly phaseNames = ['一 · 一足', '二 · 雷鼓', '三 · 风雨'];
  protected readonly breakTime = 4;
  protected override downPose = 'kneel';
  private readonly drum: THREE.Group;
  private readonly A = new THREE.Vector3();
  private readonly B = new THREE.Vector3();
  private hops = 0;
  private sinceDrum = 0;
  private chain = 0;
  private ringT = 0;
  private drumDmg = 0;

  constructor(ctx: PlayCtx) {
    const lord = LORDS.find(l => l.id === 'kui')!;
    const c = spawnCreature('SK_Boss_Kui');
    super('kui', '夔', 12000, 900, c.host, c.body, 'kui', 'SK_Boss_Kui', [
      { bone: 'chest', r: 1.5, mult: 1 }, { bone: 'hips', r: 1.0, mult: 1 }, { bone: 'head', r: 0.7, mult: 1.5 },
      { bone: 'drum_core', r: 0.75, mult: 2.5, part: 'drum' }, { bone: 'shin', r: 0.5, mult: 1 },
    ], ctx, { x: lord.at[0], z: lord.at[2], r: lord.r });
    const [px, pz] = lord.perch!;
    this.home.set(px, ctx.terrain.heightAt(px, pz), pz);
    this.pos.copy(this.home);
    this.yaw = Math.atan2(lord.at[0] - px, lord.at[2] - pz);
    this.host.visible = false;
    this.blockers = [['hips', 2.0], ['chest', 1.6]];
    // 夔不在时，山头倒着它的残破雷鼓
    this.drum = spawnStatic('SM_Prop_KuiBrokenDrum', 1.3);
    this.drum.position.copy(this.home).setY(this.home.y + 0.6);
    this.drum.rotation.set(-1.25, this.yaw, 0);
    ctx.scene.add(this.drum);
  }

  override charged(): boolean { return true; }

  shouldStart(): boolean { return Math.hypot(this.ctx.feet.x - this.home.x, this.ctx.feet.z - this.home.z) < 22; }

  protected override weakMult(s: { bone: string; mult: number }): number {
    if (s.bone === 'drum_core' && (this.move.id === 'drum' || this.move.id === 'drum5')) return 3.5;
    return s.mult;
  }

  protected override partMul(sphere: HitSphere | undefined, _info: DamageInfo, dmg: number): number {
    if (sphere?.part === 'drum') this.drumDmg += dmg;
    return 1;
  }

  // ─── 演出 ───

  protected introShot(): Shot {
    const ctx = this.ctx;
    ctx.weather.stormy = true;
    this.host.visible = false;
    this.pos.copy(this.home);
    this.host.scale.setScalar(0.25);
    const drum = this.home.clone().setY(this.home.y + 1);
    // 机位：玩家这一侧、离鼓 14 m、略高，慢慢推近、抬头
    const side = Math.atan2(ctx.feet.x - this.home.x, ctx.feet.z - this.home.z);
    let struck = 0;
    return {
      name: '夔 · 登场', dur: 7, bars: true, skippable: true,
      cam: (t, out) => {
        const k = smooth(t / 7);
        const r = 15 - 5 * k, a = side + 0.5 - 0.35 * k;
        out.pos.set(drum.x + Math.sin(a) * r, drum.y + 2.5 + 2.5 * k, drum.z + Math.cos(a) * r);
        out.look.set(drum.x, drum.y + 1 + 3 * smooth((t - 2) / 3), drum.z);
        out.fov = 52;
      },
      card: { title: '夔', sub: '一足之雷', quote: '《大荒东经》：其声如雷。黄帝得之，以其皮为鼓', at: 4.4, dur: 2.6 },
      tick: (t) => {
        // 三道雷接连劈在残鼓上
        for (const at of [0.9, 1.4, 1.9]) if (t >= at && struck < [0.9, 1.4, 1.9].indexOf(at) + 1) { struck++; ctx.fx.bolt(this.home.x, this.home.z); ctx.shake(0.2); }
        // 从鼓里长出来
        const rise = smooth((t - 2) / 2.2);
        this.host.visible = t >= 2;
        this.host.scale.setScalar(0.25 + 0.75 * rise);
        this.drum.visible = rise < 0.55;
        this.show = t < 4.2 ? { id: 'rise', stage: 'windup', k: rise } : { id: 'roar', stage: t < 4.7 ? 'windup' : t < 6.2 ? 'active' : 'recover', k: t < 4.7 ? (t - 4.2) / 0.5 : t < 6.2 ? (t - 4.7) / 1.5 : (t - 6.2) / 0.8 };
        if (t >= 4.2 && !this.mem.landed) {
          this.mem.landed = 1;
          ctx.fx.shockwave(this.pos.x, this.pos.z, 10, 0.5, undefined, '#ffc6f4');
          ctx.fx.spray(this.pos, ['#8a7a60', '#c8b898'], 40, 7, 3, 10, 0.8);
          ctx.shake(0.5);
        }
        if (t > 4.7 && t < 6.2 && Math.random() < 0.15) ctx.fx.arc(this.boneWorld('head', _v).clone(), this.boneWorld('head', _w).clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 8, (Math.random() - 0.5) * 6)), '#ffd6fb', 0.15, 1);
      },
    };
  }

  protected override afterIntro(): void {
    this.show = null;
    this.host.scale.setScalar(1);
    this.mem.landed = 0;
    this.hops = 0; this.sinceDrum = 0;
    this.ctx.say('打它胸口的鼓心——落地砸拳、拄拳挪位的时候胸口最低', 4);
  }

  protected transition(n: number): Shot {
    const ctx = this.ctx;
    const from = this.pos.clone();
    const to = new THREE.Vector3(this.arena.x + 4, 0, this.arena.y + 3);
    to.y = ctx.terrain.heightAt(to.x, to.z);
    if (n === 2) {
      // 召鼓：跳到拉则旁、仰头吼，两只连鼓灵从擂台边飞来护驾；经幡杆开始通电
      let spawned = false;
      return {
        name: '夔 · 召鼓', dur: 3.2, bars: true, skippable: true,
        cam: orbitCam(to, 16, 6, Math.atan2(ctx.feet.x - to.x, ctx.feet.z - to.z) - 0.4, Math.atan2(ctx.feet.x - to.x, ctx.feet.z - to.z) + 0.2, 3.2, 3.5, 55),
        banner: { text: '二 · 雷鼓', at: 0.4, dur: 2.6 },
        tick: (t) => {
          const k = smooth(t / 1.1);
          this.pos.x = from.x + (to.x - from.x) * k; this.pos.z = from.z + (to.z - from.z) * k;
          this.pos.y = from.y + (to.y - from.y) * k + 6 * 4 * k * (1 - k);
          this.show = t < 1.1 ? { id: 'leap', stage: 'active', k } : { id: 'roar', stage: 'active', k: (t - 1.1) / 2 };
          if (t >= 1.1 && !spawned) {
            spawned = true;
            ctx.fx.shockwave(to.x, to.z, 12, 0.5, undefined, '#ffc6f4');
            ctx.shake(0.4);
            this.spawnDrums();
            for (const c of ctx.conductors) if (Math.hypot(c.pos.x - this.arena.x, c.pos.z - this.arena.y) < this.arenaR) c.charge = 3;
          }
        },
        onEnd: () => { this.show = null; this.ctx.say('经幡杆旁 2–5 m 能躲雷；带电的杆子会回劈落在旁边的夔', 4); },
      };
    }
    // 风雨：雷暴加剧，外圈落雷越来越密
    return {
      name: '夔 · 风雨', dur: 2.6, bars: false, lock: false,
      banner: { text: '三 · 风雨', at: 0.2, dur: 2.4 },
      tick: (t) => {
        this.show = { id: 'drum', stage: 'active', k: t / 2.6 };
        if (Math.random() < 0.1) ctx.fx.bolt(this.arena.x + (Math.random() - 0.5) * 60, this.arena.y + (Math.random() - 0.5) * 60);
      },
      onEnd: () => { this.show = null; this.ctx.say('外圈落雷越来越密——往山顶收', 3); },
    };
  }

  private spawnDrums(): void {
    const ctx = this.ctx;
    const enc: EncounterState = { id: 'kui-drums', site: 's6', x: this.arena.x, z: this.arena.y, r: this.arenaR, foes: [], alerted: true, cleared: false, burrows: [], tokens: { melee: 0, pounce: 0, ranged: 0, howl: 0 } };
    for (const a of [0.6, -0.6]) {
      const ang = Math.atan2(ctx.feet.x - this.arena.x, ctx.feet.z - this.arena.y) + Math.PI + a;
      const x = this.arena.x + Math.sin(ang) * 24, z = this.arena.y + Math.cos(ang) * 24;
      const f = new Liangu(ctx, new THREE.Vector3(x, ctx.terrain.heightAt(x, z) + 3, z), 3, MONSTER_NAMES);
      f.enc = enc;
      f.owner = this;
      enc.foes.push(f);
      f.notice();
      this.adds.push(f);
    }
  }

  protected deathShot(): Shot {
    const ctx = this.ctx;
    const c = this.pos.clone();
    const a0 = Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z);
    return {
      name: '夔 · 雷息', dur: 6, bars: true, skippable: true,
      slow: (t) => (t < 1.2 ? 0.3 : 1),
      cam: orbitCam(c, 13, 4, a0 - 0.3, a0 + 0.9, 6, 3, 55),
      card: { title: '夔 · 平息', sub: '雷暴退去', at: 3, dur: 2.8 },
      tick: (t) => {
        this.show = { id: 'kneel', stage: t < 1 ? 'windup' : 'active', k: Math.min(1, t) };
        if (t > 0.3 && !this.mem.burst) { this.mem.burst = 1; ctx.fx.burst(this.boneWorld('drum_core', _v).clone(), 4, '#ffffff'); ctx.fx.spray(_v, ['#ff7ae6', '#ffffff'], 60, 10, 5, 8, 1); }
        // 倒回残鼓里：缩小、化成雷云
        const sink = smooth((t - 1.6) / 2.4);
        this.host.scale.setScalar(1 - 0.75 * sink);
        if (sink > 0.5) this.drum.visible = true;
        if (sink > 0 && Math.random() < 0.4) ctx.fx.spray(this.boneWorld('chest', _v).clone(), ['#5a5468', '#8a84a0'], 3, 2, 3, -1, 1.2);
        if (t > 1.5) ctx.weather.stormy = false;
        if (t > 4) this.host.visible = false;
      },
      onEnd: () => { this.show = null; this.host.visible = false; this.inShow = false; },
    };
  }

  protected onBreak(): void {
    const ctx = this.ctx;
    ctx.fx.burst(this.boneWorld('drum_core', _v).clone(), 3, '#ffffff');
    ctx.fx.spray(_v, ['#ff7ae6', '#e8d8c0'], 40, 8, 4, 10, 0.8);
    ctx.shake(0.4);
    ctx.say('破鼓！夔单膝跪地——全力输出', 2.5);
    this.pos.y = this.ground(this.pos.x, this.pos.z);
  }

  protected override onReset(): void {
    this.ctx.weather.stormy = false;
    this.host.visible = false;
    this.drum.visible = true;
    this.host.scale.setScalar(1);
    this.show = null;
    this.mem.landed = 0;
  }

  protected override showing(): void { /* 演出动作在 Shot.tick 里 */ }

  // ─── 招式 ───

  private target(reach: number, keep = 0): void {
    const P = this.ctx.feet;
    const dist = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    const r = Math.min(reach, Math.max(0, dist - keep));
    const dx = (P.x - this.pos.x) / Math.max(0.1, dist), dz = (P.z - this.pos.z) / Math.max(0.1, dist);
    let bx = this.pos.x + dx * r, bz = this.pos.z + dz * r;
    // 不跳出擂台
    const ox = bx - this.arena.x, oz = bz - this.arena.y, od = Math.hypot(ox, oz);
    if (od > this.arenaR) { bx = this.arena.x + ox / od * this.arenaR; bz = this.arena.y + oz / od * this.arenaR; }
    this.A.copy(this.pos);
    this.B.set(bx, this.ground(bx, bz), bz);
  }

  protected override onEvent(ev: string, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    if (ev === 'warn') {
      if (id === 'hop') this.target(3.5, 3);
      else if (id === 'leap' || id === 'leapChain') {
        this.target(id === 'leap' ? 14 : 10);
        this.warns.push(ctx.fx.telegraph(this.B.x, this.B.z, 4, this.move.def!.windup + this.move.def!.active, () => {}, '#ffb347'));
      } else if (id === 'turnLeap') { this.A.copy(this.pos); this.B.copy(this.pos); this.mem.turnFrom = this.yaw; }
      else if (id === 'clap') this.warns.push(ctx.fx.coneWarn(this.pos.x, this.pos.z, this.yaw, Math.PI / 3, 8, this.move.def!.windup, '#ff5ad8'));
      else if (id === 'drum' || id === 'drum5') { this.drumDmg = 0; ctx.say('夔在捶胸——鼓面张开（鼓心 ×3.5）；快去经幡杆旁躲雷', 2.2); }
      else if (id === 'knuckle') { this.mem.knA = Math.atan2(this.pos.x - this.arena.x, this.pos.z - this.arena.y); this.mem.knR = Math.max(8, Math.hypot(this.pos.x - this.arena.x, this.pos.z - this.arena.y)); this.mem.knDir = Math.random() < 0.5 ? 1 : -1; }
    } else if (ev === 'land') {
      this.pos.copy(this.B);
      const x = this.pos.x, z = this.pos.z;
      if (id === 'leap' || id === 'leapChain') {
        // 双拳砸地：冲击波环扩到 16 m，环经过时人在地上就挨（跳起来躲）
        let done = false;
        ctx.fx.shockwave(x, z, 16, 0.9, (r) => {
          const d = Math.hypot(ctx.feet.x - x, ctx.feet.z - z);
          if (!done && Math.abs(d - r) < 1.3 && ctx.walker.grounded && !ctx.invulnerable()) { done = true; ctx.hurt(22, '夔的落地冲击', knockFrom(ctx, x, z, 10, 7)); }
        });
        ctx.fx.burst(_v.set(x, this.pos.y + 1, z), 5, '#ffc6f4');
        ctx.fx.spray(this.pos, ['#8a7a60', '#c8b898'], 40, 8, 3, 10, 0.8);
        ctx.shake(Math.max(0, 0.6 - dist * 0.02));
        this.backlash();
      } else {
        const r = id === 'turnLeap' ? 5 : 3.5, dmg = id === 'turnLeap' ? 10 : 8;
        ctx.fx.shockwave(x, z, r, 0.35);
        ctx.fx.spray(this.pos, ['#8a7a60'], 14, 4, 2, 10, 0.5);
        ctx.shake(0.15);
        if (Math.hypot(P.x - x, P.z - z) < r && ctx.walker.grounded && !ctx.invulnerable()) ctx.hurt(dmg, '夔', knockFrom(ctx, x, z, 6, 4));
      }
    } else if (ev === 'hit' && id === 'clap') {
      ctx.fx.burst(this.boneWorld('fist_L', _v).add(this.boneWorld('fist_R', _w)).multiplyScalar(0.5).clone(), 2.5, '#ffd6fb');
      ctx.shake(0.3);
      const dx = P.x - this.pos.x, dz = P.z - this.pos.z, d = Math.hypot(dx, dz);
      let a = Math.atan2(dx, dz) - this.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
      if (d < 8 && Math.abs(a) < Math.PI / 6 + 0.2 && !ctx.invulnerable()) ctx.hurt(16, '夔的雷掌', knockFrom(ctx, this.pos.x, this.pos.z, 12, 4), 'shock');
    } else if (ev === 'beat') {
      // 捶一下：玩家脚下 + 随机一处各一道雷；落点 5 m 内有经幡杆就劈杆
      ctx.fx.burst(this.boneWorld('drum_core', _v).clone(), 1.6, '#ff7ae6');
      ctx.shake(0.12);
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2, r = k === 0 ? 0 : 3 + Math.random() * 5;
        ctx.bolt(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, { r: 3.2, delay: 1.2, dmg: 18, source: '夔引来的雷' });
      }
    } else if (ev === 'step' && id === 'knuckle') {
      ctx.fx.spray(this.boneWorld('fist_L', _v).clone(), ['#8a7a60'], 6, 2, 1, 10, 0.4);
      ctx.fx.spray(this.boneWorld('fist_R', _v).clone(), ['#8a7a60'], 6, 2, 1, 10, 0.4);
    }
  }

  /** 落在带电的经幡杆 4 m 内：杆子回劈 */
  private backlash(): void {
    const ctx = this.ctx;
    for (const c of ctx.conductors) {
      if (c.charge <= 0 || Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z) > 4.5) continue;
      c.charge = 0;
      const chest = this.boneWorld('chest', new THREE.Vector3());
      for (let i = 0; i < 3; i++) ctx.fx.arc(c.pos, chest, '#ffffff', 0.35, 0.8);
      ctx.fx.burst(chest, 3, '#ff7ae6');
      this.hit(200, 1, chest, { kind: 'env', from: c.pos, poise: 0 });
      this.addBreak(150);
      this.stun(1.5, '落在带电的经幡杆旁，被回劈');
      return;
    }
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    // 三阶段：外圈落雷
    if (this.phase === 3) {
      this.ringT -= dt;
      if (this.ringT <= 0) {
        this.ringT = 1.2;
        const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 12;
        ctx.bolt(this.arena.x + Math.sin(a) * r, this.arena.y + Math.cos(a) * r, { r: 3.5, delay: 1.2, dmg: 16, source: '风雨里的落雷' });
      }
    }
    const id = this.move.id, st = this.move.stage;
    if (this.move.busy) {
      if (id === 'hop' || id === 'leap' || id === 'leapChain' || id === 'turnLeap') {
        if (st === 'windup') { if (id !== 'turnLeap') this.faceTo(this.B.x, this.B.z, dt, 4); return; }
        if (st === 'active') {
          const k = this.move.stageK;
          const H = id === 'leap' ? 4.2 : id === 'leapChain' ? 3.2 : 1.4;
          this.pos.x = this.A.x + (this.B.x - this.A.x) * k;
          this.pos.z = this.A.z + (this.B.z - this.A.z) * k;
          this.pos.y = this.A.y + (this.B.y - this.A.y) * k + H * 4 * k * (1 - k);
          if (id === 'turnLeap') this.yaw = this.mem.turnFrom + Math.PI * smooth(k);
          return;
        }
        // 收招：连环大跳接下一跳
        if (id === 'leapChain' && this.move.stageK > 0.9 && this.chain > 0) { this.chain--; this.begin(KUI.leapChain); }
        return;
      }
      if (id === 'knuckle') {
        // 拄拳：绕拉则挪位，2.5 m/s
        this.mem.knA += this.mem.knDir * dt * 2.5 / this.mem.knR;
        const tx = this.arena.x + Math.sin(this.mem.knA) * this.mem.knR, tz = this.arena.y + Math.cos(this.mem.knA) * this.mem.knR;
        this.faceTo(tx, tz, dt, 3);
        this.pos.set(tx, this.ground(tx, tz), tz);
        return;
      }
      if (id === 'clap' && st === 'windup') this.faceTo(P.x, P.z, dt, 2);
      if ((id === 'drum' || id === 'drum5') && st === 'windup') this.faceTo(P.x, P.z, dt, 2);
      return;
    }
    this.faceTo(P.x, P.z, dt, 3);
    if (this.cd > 0) return;
    this.cd = (this.phase === 3 ? 0.15 : 0.35) * this.tempo;
    // 选招
    const behind = Math.abs(Math.atan2(Math.sin(Math.atan2(P.x - this.pos.x, P.z - this.pos.z) - this.yaw), Math.cos(Math.atan2(P.x - this.pos.x, P.z - this.pos.z) - this.yaw))) > 2.0;
    if (this.phase >= 2 && this.sinceDrum >= (this.phase === 3 ? 4 : 5)) { this.sinceDrum = 0; this.begin(this.phase === 3 ? KUI.drum5 : KUI.drum); return; }
    if (behind && dist < 12) { this.begin(KUI.turnLeap); this.sinceDrum++; return; }
    if (dist < 8 && (this.mem.cd_clap ?? 0) <= ctx.time && Math.random() < 0.6) { this.begin(this.use(KUI.clap)); this.sinceDrum++; return; }
    this.hops++;
    this.sinceDrum++;
    if (this.hops % 4 === 0 || dist > 16) {
      if (this.phase === 3) { this.chain = 2; this.begin(KUI.leapChain); return; }
      this.begin(KUI.leap);
      return;
    }
    if (dist > 12 && Math.random() < 0.3) { this.begin(KUI.knuckle); return; }
    this.begin(KUI.hop);
  }

  protected override whileBroken(): void {}
}

// ───────────────────────────── 飞廉 ─────────────────────────────

const FEILIAN = defineMoves('SK_Boss_Feilian', [
  { id: 'gust', name: '蓄风狂风', windup: 1.0, active: 0.6, recover: 0.8, cooldown: 4, glint: true },
  { id: 'charge', name: '低头冲撞', windup: 0.8, active: 1.4, recover: 1.0, cooldown: 3, glint: true },
  { id: 'blades', name: '风刃', windup: 0.6, active: 0.1, recover: 0.6, cooldown: 2.5, noHit: true, events: [{ at: 0.6, name: 'release' }] },
  { id: 'sidestep', name: '侧跃', windup: 0.1, active: 0.6, recover: 0.2, cooldown: 4, noHit: true },
  { id: 'tornado', name: '龙卷风柱', windup: 1.0, active: 0.2, recover: 0.6, cooldown: 9, minPhase: 2, noHit: true, events: [{ at: 1.0, name: 'release' }] },
  { id: 'wheel', name: '回旋冲撞', windup: 0.8, active: 2.2, recover: 1.2, cooldown: 6, minPhase: 2, glint: true },
  { id: 'stormburst', name: '风雷爆', windup: 4.0, active: 0.3, recover: 1.5, cooldown: 14, minPhase: 3, armored: true, glint: true },
  { id: 'roar', name: '人立长嘶（演出）', windup: 0.5, active: 1.5, recover: 0.5, noHit: true },
  { id: 'down', name: '珠碎 / 撞晕（侧倒）', windup: 0.4, active: 3.2, recover: 0.4, noHit: true },
]);

interface Tornado { mesh: THREE.Group; pos: THREE.Vector3; life: number; tick: number; fire: number; mats: THREE.MeshBasicMaterial[] }

export class FeilianBoss extends Boss {
  readonly phaseNames = ['一 · 风伯', '二 · 龙卷', '三 · 风眼'];
  protected readonly breakTime = 4;
  private readonly orb: THREE.Mesh;
  private tornados: Tornado[] = [];
  private orbGone = 0;
  private recentDmg = 0;
  private windOff = 0;

  constructor(ctx: PlayCtx) {
    const lord = LORDS.find(l => l.id === 'feilian')!;
    const c = spawnCreature('SK_Boss_Feilian');
    super('feilian', '飞廉', 11000, 800, c.host, c.body, 'quad', 'SK_Boss_Feilian', [
      { bone: 'chest', r: 1.0, mult: 1 }, { bone: 'hips', r: 0.9, mult: 1 }, { bone: 'neck', r: 0.5, mult: 1 },
      { bone: 'head', r: 0.45, mult: 1.5 }, { bone: 'orb', r: 0.6, mult: 2.5, part: 'orb' },
    ], ctx, { x: lord.at[0], z: lord.at[2], r: lord.r });
    this.home.set(lord.at[0], ctx.terrain.heightAt(lord.at[0], lord.at[2]), lord.at[2]);
    this.pos.copy(this.home);
    this.yaw = Math.atan2(40 - lord.at[0], -150 - lord.at[2]);
    this.blockers = [['chest', 1.5], ['hips', 1.4]];
    // 鹿角间的风雷珠：程序化发光球，挂在 orb 骨上
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), new THREE.MeshBasicMaterial({ color: '#d9c4ff', transparent: true, opacity: 0.95 }));
    ctx.scene.add(this.orb);
  }

  override charged(): boolean { return this.orbGone <= 0 && this.phase >= 2; }

  shouldStart(): boolean { return Math.hypot(this.ctx.feet.x - this.home.x, this.ctx.feet.z - this.home.z) < 32; }

  protected override sphereR(s: { bone: string; r: number; part?: string }): number { return s.part === 'orb' && this.orbGone > 0 ? 0 : s.r; }

  protected override partMul(_s: HitSphere | undefined, _i: DamageInfo, dmg: number): number { this.recentDmg += dmg; return 1; }

  protected introShot(): Shot {
    const ctx = this.ctx;
    const land = this.home.clone();
    const side = Math.atan2(ctx.feet.x - land.x, ctx.feet.z - land.z);
    this.pos.set(land.x, land.y + 40, land.z);
    return {
      name: '飞廉 · 登场', dur: 6.5, bars: true, skippable: true,
      cam: (t, out) => {
        // 先仰拍风涡柱，再跟着飞廉落下来
        const k = smooth((t - 0.8) / 3);
        const r = 22 - 6 * smooth(t / 6.5), a = side + 0.4;
        out.pos.set(land.x + Math.sin(a) * r, land.y + 3 + 2 * (1 - k), land.z + Math.cos(a) * r);
        out.look.set(land.x, land.y + 3 + 30 * (1 - k), land.z);
        out.fov = 55;
      },
      card: { title: '飞廉', sub: '风伯', quote: '鹿身雀头，有角，蛇尾豹文——整片盆地的风都吹向它', at: 3.9, dur: 2.5 },
      tick: (t, dt) => {
        // 从 40 m 高的风涡里盘旋落下
        const k = smooth(t / 3.4);
        const spin = (1 - k) * 8;
        this.pos.set(land.x + Math.sin(spin) * 6 * (1 - k), land.y + 40 * (1 - k), land.z + Math.cos(spin) * 6 * (1 - k));
        this.yaw = spin + Math.PI / 2;
        if (t < 3.4) { this.show = { id: 'sidestep', stage: 'active', k: 0.5 }; if (Math.random() < 0.5) ctx.fx.spray(this.pos, ['#ffffff', '#d8f4ff'], 2, 3, 0, -2, 0.6); }
        else {
          if (!this.mem.landed) { this.mem.landed = 1; ctx.fx.shockwave(land.x, land.z, 14, 0.5, undefined, '#e8f6ff'); ctx.fx.spray(land, ['#ffffff', '#e0f0ff'], 70, 10, 4, 8, 1); ctx.shake(0.4); }
          this.faceTo(ctx.feet.x, ctx.feet.z, dt, 3);
          const tt = t - 3.4;
          this.show = { id: 'roar', stage: tt < 0.5 ? 'windup' : tt < 2.2 ? 'active' : 'recover', k: tt < 0.5 ? tt / 0.5 : tt < 2.2 ? (tt - 0.5) / 1.7 : (tt - 2.2) / 0.9 };
        }
      },
    };
  }

  protected override afterIntro(): void {
    this.show = null;
    this.pos.copy(this.home);
    this.mem.landed = 0;
    this.ctx.say('风一直把人往外推——打鹿角间的风雷珠；引它撞上冰碛巨石', 4);
  }

  protected transition(n: number): Shot {
    const ctx = this.ctx;
    if (n === 2) {
      const c = this.home.clone();
      return {
        name: '飞廉 · 龙卷', dur: 3, bars: true, skippable: true,
        cam: orbitCam(c, 20, 6, Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z) - 0.3, Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z) + 0.3, 3, 5, 55),
        banner: { text: '二 · 龙卷', at: 0.3, dur: 2.6 },
        tick: (t) => {
          // 跃上风涡、悬停仰头嘶鸣，风涡分出两根龙卷落下
          const k = smooth(t / 0.8), back = smooth((t - 2.2) / 0.8);
          this.pos.set(c.x, c.y + 6 * k * (1 - back), c.z);
          this.show = { id: 'tornado', stage: t < 1 ? 'windup' : 'active', k: Math.min(1, t) };
          if (t > 1.2 && !this.mem.tor) { this.mem.tor = 1; for (const a of [1.2, -1.2]) this.spawnTornado(c.x + Math.sin(this.yaw + a) * 12, c.z + Math.cos(this.yaw + a) * 12); }
        },
        onEnd: () => { this.show = null; this.mem.tor = 0; this.pos.copy(this.home); ctx.say('龙卷风柱追人——用燎的火点着它，火龙卷会被风吸回去烧飞廉', 4); },
      };
    }
    return {
      name: '飞廉 · 风眼', dur: 2.6, bars: false, lock: false,
      banner: { text: '三 · 风眼', at: 0.2, dur: 2.4 },
      tick: (t) => { this.show = { id: 'roar', stage: 'active', k: t / 2.6 }; },
      onEnd: () => { this.show = null; ctx.say('风向反了——风往它那里吸', 3); },
    };
  }

  protected deathShot(): Shot {
    const ctx = this.ctx;
    const c = this.pos.clone();
    const a0 = Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z);
    const z0 = WORLD_UNIFORMS.uWindLair.value.z;
    return {
      name: '飞廉 · 风止', dur: 6, bars: true, skippable: true,
      slow: (t) => (t < 1.2 ? 0.3 : 1),
      cam: orbitCam(c, 14, 5, a0 - 0.4, a0 + 0.8, 6, 2, 55),
      card: { title: '飞廉 · 风止', sub: '盆地的风停了', at: 3, dur: 2.8 },
      tick: (t) => {
        this.show = { id: 'down', stage: t < 0.6 ? 'windup' : 'active', k: Math.min(1, t / 0.6) };
        if (t > 0.2 && !this.mem.burst) { this.mem.burst = 1; ctx.fx.burst(this.boneWorld('orb', _v).clone(), 4, '#e8deff'); ctx.fx.spray(_v, ['#ffffff', '#d9c4ff'], 60, 12, 4, 2, 1.4); this.orbGone = 1e9; }
        // 风不再往冰川口吸
        WORLD_UNIFORMS.uWindLair.value.z = z0 + (31 - z0) * smooth((t - 1) / 4);
        for (const T of this.tornados) T.life = Math.min(T.life, 0.5);
      },
      onEnd: () => { this.show = null; this.inShow = false; },
    };
  }

  protected onBreak(): void {
    const ctx = this.ctx;
    ctx.fx.burst(this.boneWorld('orb', _v).clone(), 3.5, '#e8deff');
    ctx.fx.spray(_v, ['#ffffff', '#d9c4ff'], 50, 10, 3, 4, 1);
    ctx.shake(0.35);
    this.orbGone = 25;
    this.windOff = 6;
    this.downPose = 'down';
    ctx.say('珠碎！飞廉侧倒，风停了 6 秒', 2.5);
  }

  protected override onReset(): void {
    for (const t of this.tornados) this.ctx.scene.remove(t.mesh);
    this.tornados = [];
    this.orbGone = 0;
    this.show = null;
  }

  /** 只在冰舌顶上活动：不出擂台、不下冰崖、不上陡坡 */
  private onTop(x: number, z: number): boolean {
    const T = this.ctx.terrain;
    return Math.hypot(x - this.arena.x, z - this.arena.y) < this.arenaR && T.slopeAt(x, z) < 1.2 && T.heightAt(x, z) > this.home.y - 4;
  }

  /** 冲撞时撞上冰碛巨石 / 建筑：晕 */
  private bump(x: number, z: number): boolean { return this.ctx.world.blocked(x, z, this.ctx.terrain.heightAt(x, z)); }

  protected override onEvent(ev: string, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    if (ev === 'warn') {
      if (id === 'gust') this.warns.push(ctx.fx.coneWarn(this.pos.x, this.pos.z, Math.atan2(P.x - this.pos.x, P.z - this.pos.z), 0.88, 40, this.move.def!.windup, '#2fb8ff'));
      if (id === 'charge' || id === 'wheel') {
        this.yaw = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
        this.mem.hit = 0;
        if (id === 'charge') this.warns.push(ctx.fx.lineWarn(this.pos.x, this.pos.z, this.pos.x + Math.sin(this.yaw) * 30, this.pos.z + Math.cos(this.yaw) * 30, 3, this.move.def!.windup, '#ffb347'));
      }
      if (id === 'stormburst') {
        this.warns.push(ctx.fx.telegraph(this.pos.x, this.pos.z, 12, this.move.def!.windup, () => {}, '#c792ff'));
        ctx.say('飞廉在蓄风雷爆——打碎风雷珠打断它，或者顶风冲出圈！', 3);
      }
      if (id === 'sidestep') { const a = this.yaw + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2; this.mem.sx = Math.sin(a) * 10; this.mem.sz = Math.cos(a) * 10; }
    } else if (ev === 'hit' && id === 'gust') {
      // 狂风：锥形 40 m，推开 + 6；躲在巨石 / 冰脊后面不挨
      const a = Math.atan2(P.x - this.pos.x, P.z - this.pos.z) - this.yaw;
      const orb = this.boneWorld('orb', new THREE.Vector3());
      if (dist < 40 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.6 && !this.covered(orb)) {
        this.mem.gustT = 0.6;
        if (!ctx.invulnerable()) ctx.hurt(6, '飞廉的狂风');
      } else if (dist < 40) ctx.say('躲在掩体后面，狂风吹不到', 1.2);
    } else if (ev === 'hit' && id === 'stormburst') {
      ctx.fx.burst(this.boneWorld('orb', _v).clone(), 12, '#d9c4ff');
      ctx.fx.shockwave(this.pos.x, this.pos.z, 12, 0.4, undefined, '#c792ff');
      ctx.shake(0.6);
      if (dist < 12 && !ctx.invulnerable()) ctx.hurt(35, '飞廉的风雷爆', knockFrom(ctx, this.pos.x, this.pos.z, 14, 6), 'shock');
    } else if (ev === 'release' && id === 'blades') {
      const head = this.boneWorld('chest', new THREE.Vector3());
      const yaw = Math.atan2(P.x - head.x, P.z - head.z);
      for (const off of [-0.26, 0, 0.26]) {
        const dir = new THREE.Vector3(Math.sin(yaw + off), 0, Math.cos(yaw + off)).multiplyScalar(20);
        ctx.fx.shot(head.clone(), dir, 0.9, '#e6f6ff', (at, hitP) => {
          if (hitP && !ctx.invulnerable()) ctx.hurt(10, '飞廉的风刃', { x: dir.x * 0.3, z: dir.z * 0.3 });
          else ctx.fx.spray(at, ['#ffffff', '#d8f4ff'], 8, 3, 1, 4, 0.4);
        }, 0, windBladeMesh(), true);
      }
    } else if (ev === 'release' && id === 'tornado') {
      for (const a of this.phase === 3 ? [0, 2.1, -2.1] : [1.2, -1.2]) this.spawnTornado(P.x + Math.sin(this.yaw + a) * 12, P.z + Math.cos(this.yaw + a) * 12);
    }
  }

  /** 从风雷珠到玩家之间有没有挡风的东西 */
  private covered(from: THREE.Vector3): boolean {
    const ctx = this.ctx, to = ctx.center;
    for (let k = 0.15; k < 0.95; k += 0.05) {
      _v.lerpVectors(from, to, k);
      if (ctx.world.solidAt(_v.x, _v.y, _v.z) || _v.y < ctx.terrain.heightAt(_v.x, _v.z)) return true;
    }
    return false;
  }

  private spawnTornado(x: number, z: number): void {
    const g = new THREE.Group();
    const mats: THREE.MeshBasicMaterial[] = [];
    for (let k = 0; k < 6; k++) {
      const m = new THREE.MeshBasicMaterial({ color: '#e8e6ff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
      mats.push(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6 + k * 0.5, 0.12, 4, 24, 4.5).rotateX(Math.PI / 2), m);
      ring.position.y = 0.5 + k * 1.6;
      g.add(ring);
    }
    g.position.set(x, this.ctx.terrain.heightAt(x, z), z);
    this.ctx.scene.add(g);
    this.tornados.push({ mesh: g, pos: g.position, life: 9, tick: 0, fire: 0, mats });
  }

  /** 燎的火打中龙卷：变成火龙卷 8 秒，不再追人，被风吸回去烧飞廉 */
  override fireAt(at: THREE.Vector3, r: number): void {
    for (const T of this.tornados) {
      if (T.fire > 0 || Math.hypot(T.pos.x - at.x, T.pos.z - at.z) > r + 2.5 || at.y > T.pos.y + 10) continue;
      T.fire = 8; T.life = Math.max(T.life, 8);
      for (const m of T.mats) m.color.set('#ff8a3a');
      this.ctx.say('火龙卷！风把它吸回飞廉那里', 2);
      this.ctx.fx.burst(T.pos.clone().setY(T.pos.y + 3), 3, '#ff8a3a');
    }
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id, st = this.move.stage;
    if (this.move.busy) {
      if (id === 'gust' || id === 'stormburst' || id === 'tornado' || id === 'blades') { this.faceTo(P.x, P.z, dt, st === 'windup' ? 2.5 : 0.5); return; }
      if (id === 'charge' || id === 'wheel') {
        if (st === 'windup') { this.faceTo(P.x, P.z, dt, 5); return; }
        if (st === 'active') {
          if (id === 'wheel') this.yaw += dt * 2.6 / this.move.def!.active * (this.mem.wheelDir ?? 1);
          const spd = 24;
          const nx = this.pos.x + Math.sin(this.yaw) * spd * dt, nz = this.pos.z + Math.cos(this.yaw) * spd * dt;
          if (this.bump(nx, nz)) {
            this.move.finishActive();
            ctx.fx.burst(this.boneWorld('head', _v).clone(), 2.5, '#ffffff');
            ctx.fx.spray(_v, ['#ffffff', '#c8d8e0'], 30, 6, 3, 10, 0.6);
            ctx.shake(0.35);
            this.downPose = 'down';
            this.stun(2, '撞上冰碛巨石，撞晕了');
            return;
          }
          if (!this.onTop(nx, nz)) { this.move.finishActive(); return; }
          this.pos.set(nx, this.ground(nx, nz), nz);
          this.anim.move = 1;
          this.anim.phase += spd * dt / 1.6 * Math.PI;
          if (!this.mem.hit && Math.hypot(P.x - nx, P.z - nz) < 2.8 && !ctx.invulnerable()) {
            this.mem.hit = 1;
            ctx.hurt(22, '飞廉冲撞', { x: Math.sin(this.yaw) * 16, z: Math.cos(this.yaw) * 16, up: 5 });
          }
          return;
        }
        this.anim.move = 0;
        return;
      }
      if (id === 'sidestep' && st === 'active') {
        const nx = this.pos.x + this.mem.sx * dt / 0.6, nz = this.pos.z + this.mem.sz * dt / 0.6;
        if (this.onTop(nx, nz)) this.pos.set(nx, this.ground(nx, nz), nz);
        return;
      }
      return;
    }
    // 没在出招：小跑到离玩家 12–18 m 的地方
    const want = 15;
    if (Math.abs(dist - want) > 3) {
      const dir = dist > want ? 1 : -1;
      const step = 7 * dt * dir;
      const nx = this.pos.x + (P.x - this.pos.x) / Math.max(1, dist) * step, nz = this.pos.z + (P.z - this.pos.z) / Math.max(1, dist) * step;
      if (this.onTop(nx, nz)) {
        this.pos.set(nx, this.ground(nx, nz), nz);
        this.anim.move = 0.6; this.anim.phase += Math.abs(step) / 1.6 * Math.PI;
      } else this.anim.move = 0;
    } else this.anim.move = 0;
    this.faceTo(P.x, P.z, dt, 3);
    if (this.cd > 0) return;
    this.cd = 0.8 * this.tempo;
    // 短时间挨打太多：侧跃
    if (this.recentDmg > 700 && (this.mem.cd_sidestep ?? 0) <= ctx.time) { this.recentDmg = 0; this.begin(this.use(FEILIAN.sidestep)); return; }
    const m = this.pick([FEILIAN.gust, FEILIAN.charge, FEILIAN.blades, FEILIAN.tornado, FEILIAN.wheel, FEILIAN.stormburst], (d: MoveDef) => {
      if (d.id === 'tornado') return this.tornados.length < 2 ? 1.2 : 0;
      if (d.id === 'stormburst') return this.orbGone > 0 ? 0 : 2;
      if (d.id === 'blades') return dist > 10 ? 1.2 : 0.4;
      if (d.id === 'charge' || d.id === 'wheel') return dist > 8 ? 1 : 0.3;
      return 1;
    });
    if (m) { if (m.id === 'wheel') this.mem.wheelDir = Math.random() < 0.5 ? 1 : -1; this.begin(m); }
  }

  protected override after(dt: number): void {
    const ctx = this.ctx, P = ctx.feet;
    this.recentDmg = Math.max(0, this.recentDmg - dt * 200);
    this.orbGone = Math.max(0, this.orbGone - dt);
    this.windOff = Math.max(0, this.windOff - dt);
    this.boneWorld('orb', this.orb.position);
    const storm = this.move.id === 'stormburst' && this.move.stage === 'windup' ? this.move.stageK : 0;
    this.orb.visible = !this.defeated && this.orbGone <= 0 && this.host.visible;
    this.orb.scale.setScalar((1 + 0.15 * Math.sin(ctx.time * 7)) * (1 + 1.2 * storm));
    (this.orb.material as THREE.MeshBasicMaterial).color.setRGB(0.85 + 0.15 * storm, 0.77 - 0.3 * storm, 1);
    // 擂台里的风：一二阶段往外推，三阶段往里吸；狂风出手 0.6 秒猛推
    if (this.active && !this.defeated && !this.inShow && this.windOff <= 0) {
      const dist = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
      if (dist < 42 && dist > 1) {
        const sign = this.phase === 3 ? -1 : 1;
        let k = 1.6 * dt / dist * sign;
        if (storm > 0) k = -2.6 * dt / dist;
        if ((this.mem.gustT ?? 0) > 0) { this.mem.gustT -= dt; k = 9 * dt / dist; }
        ctx.walker.shove((P.x - this.pos.x) * k, (P.z - this.pos.z) * k);
        if (Math.random() < 0.3) ctx.fx.spray(_v.set(P.x + (Math.random() - 0.5) * 8, P.y + 1 + Math.random() * 2, P.z + (Math.random() - 0.5) * 8), '#f0f8ff', 1, 1, 0, -1, 0.5);
      }
    }
    // 龙卷：追人（火龙卷被风吸向飞廉、烧它）
    this.tornados = this.tornados.filter(T => {
      T.life -= dt;
      const tx = T.fire > 0 ? this.pos.x : P.x, tz = T.fire > 0 ? this.pos.z : P.z;
      const dx = tx - T.pos.x, dz = tz - T.pos.z, d = Math.hypot(dx, dz) || 1;
      const spd = T.fire > 0 ? 6 : 3.5;
      T.pos.x += dx / d * spd * dt; T.pos.z += dz / d * spd * dt;
      T.pos.y = ctx.terrain.heightAt(T.pos.x, T.pos.z);
      T.mesh.children.forEach((c, k) => { c.rotation.y = ctx.time * (3 + k) * (k % 2 ? -1 : 1); });
      T.tick -= dt;
      if (T.fire > 0) {
        T.fire -= dt;
        if (Math.random() < 0.6) ctx.fx.spray(T.pos.clone().setY(T.pos.y + Math.random() * 8), ['#ff8a3a', '#ffd24a'], 2, 2, 2, -2, 0.6);
        if (d < 3.5 && T.tick <= 0 && this.active) { T.tick = 0.5; this.hit(40 * ctx.player.dmgMul, 1, this.center(_w), { kind: 'env', elem: 'fire', from: T.pos, poise: 0 }); ctx.elements.apply(this, 'fire', 30); }
      } else {
        const pd = Math.hypot(P.x - T.pos.x, P.z - T.pos.z);
        if (pd < 2.4 && T.tick <= 0 && !ctx.invulnerable()) { T.tick = 0.6; ctx.hurt(8, '龙卷风柱', { x: -(P.z - T.pos.z) / pd * 5, z: (P.x - T.pos.x) / pd * 5, up: 7 }); }
      }
      if (T.life > 0 && this.active && !this.defeated) return true;
      ctx.scene.remove(T.mesh);
      return false;
    });
  }
}

// ───────────────────────────── 化蛇 ─────────────────────────────

const HUASHE = defineMoves('SK_Boss_Huashe', [
  { id: 'spit', name: '吐水弹', windup: 0.6, active: 1.35, recover: 0.6, cooldown: 3, noHit: true, events: [{ at: 0.6, name: 'release' }, { at: 1.05, name: 'release' }, { at: 1.5, name: 'release' }] },
  { id: 'lunge', name: '扑岸', windup: 0.7, active: 0.35, recover: 1.2, cooldown: 4, glint: true },
  { id: 'wingslap', name: '翼拍浪', windup: 0.8, active: 0.4, recover: 0.6, cooldown: 5 },
  { id: 'roar', name: '吼叫涨水', windup: 0.6, active: 2.4, recover: 0.8, cooldown: 12, minPhase: 2, armored: true, noHit: true },
  { id: 'dive', name: '潜游突袭', windup: 1.5, active: 0.35, recover: 1.2, cooldown: 7, minPhase: 2, glint: true },
  { id: 'tailsweep', name: '尾扫', windup: 0.7, active: 0.5, recover: 0.8, cooldown: 5, minPhase: 3 },
  { id: 'rise', name: '破水而出（演出）', windup: 1.0, active: 1.5, recover: 0.5, noHit: true },
  { id: 'choke', name: '噎住（翻肚子）', windup: 0.4, active: 3.2, recover: 0.4, noHit: true },
]);

export class HuasheBoss extends Boss {
  readonly phaseNames = ['一 · 游', '二 · 涨水', '三 · 大水'];
  protected readonly breakTime = 4;
  protected override downPose = 'choke';
  private readonly lake = LAKES.find(l => l.id === 'holy')!;
  private swimA = 0;
  /** 常驻水位（二阶段起 +0.6）+ 吼叫涨水（+0.5，6 秒后退） */
  private flood = 0;
  private surge = 0;
  private surgeT = 0;
  private readonly lakeMesh: THREE.Object3D | null;
  private readonly baseLevel: number;
  private readonly A = new THREE.Vector3();
  private readonly B = new THREE.Vector3();
  private readonly shadow: THREE.Mesh;
  private readonly mouthGlow: THREE.Sprite;

  constructor(ctx: PlayCtx) {
    const lord = LORDS.find(l => l.id === 'huashe')!;
    const c = spawnCreature('SK_Boss_Huashe');
    super('huashe', '化蛇', 10500, 700, c.host, c.body, 'serpent', 'SK_Boss_Huashe', [
      { bone: 'chest', r: 1.1, mult: 1 }, { bone: 'head', r: 0.7, mult: 1.6 }, { bone: 'mouth', r: 0.5, mult: 3, part: 'mouth' },
      { bone: 'spine2', r: 1.0, mult: 1 }, { bone: 'hips', r: 0.9, mult: 1 }, { bone: 'tail_3', r: 0.6, mult: 1 },
    ], ctx, { x: lord.at[0], z: lord.at[2], r: lord.r });
    this.baseLevel = ctx.terrain.waterLevelAt(this.lake.x, this.lake.z);
    this.lakeMesh = ctx.scene.getObjectByName('lake.holy') ?? null;
    this.swimPos(0);
    this.home.copy(this.pos);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#03141c', transparent: true, opacity: 0, depthWrite: false }));
    this.shadow.scale.set(1.6, 1, 6);
    ctx.scene.add(this.shadow);
    this.mouthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff5ad8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    ctx.scene.add(this.mouthGlow);
  }

  get level(): number { return this.baseLevel + this.flood + this.surge; }
  wet(): boolean { return this.pos.y < this.level + 0.6; }
  private get mouthOpen(): boolean { return ['spit', 'lunge', 'roar', 'dive'].includes(this.move.id) && this.move.stage !== null || this.brokenT > 0; }

  shouldStart(): boolean { return this.inLake(this.ctx.feet.x, this.ctx.feet.z, 1.45); }

  /** 在湖的椭圆 × k 以内 */
  private inLake(x: number, z: number, k: number): boolean {
    const L = this.lake, c = Math.cos(L.rot), s = Math.sin(L.rot), dx = x - L.x, dz = z - L.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    return (lx / (L.rx * k)) ** 2 + (lz / (L.rz * k)) ** 2 < 1;
  }

  /** 湖心岛占着中间：沿椭圆的 0.62 倍游 */
  private swimPos(a: number, depth = -0.3): void {
    const L = this.lake, c = Math.cos(L.rot), s = Math.sin(L.rot);
    const ex = Math.cos(a) * L.rx * 0.62, ez = Math.sin(a) * L.rz * 0.62;
    this.pos.set(L.x + ex * c - ez * s, this.level + depth, L.z + ex * s + ez * c);
    const ta = a + 0.05;
    const tx = Math.cos(ta) * L.rx * 0.62, tz = Math.sin(ta) * L.rz * 0.62;
    this.yaw = Math.atan2(L.x + tx * c - tz * s - this.pos.x, L.z + tx * s + tz * c - this.pos.z);
  }

  private playerAngle(): number {
    const L = this.lake, P = this.ctx.feet;
    return Math.atan2(((P.z - L.z) * Math.cos(L.rot) - (P.x - L.x) * Math.sin(L.rot)) / L.rz, ((P.x - L.x) * Math.cos(L.rot) + (P.z - L.z) * Math.sin(L.rot)) / L.rx);
  }

  protected override weakMult(s: { bone: string; mult: number; part?: string }): number { return s.part === 'mouth' ? 3 : s.mult; }
  protected override sphereR(s: { bone: string; r: number; part?: string }): number { return s.part === 'mouth' && !this.mouthOpen ? 0 : s.r; }

  protected override partMul(_s: HitSphere | undefined, info: DamageInfo): number {
    // 水里导电：雷殛 +50%；玩家自己站在 6 m 内的水里会被电到
    if (info.elem === 'shock' && this.wet()) {
      const P = this.ctx.feet;
      if (this.ctx.terrain.waterDepthAt(P.x, P.z) > 0.05 || P.y < this.level - 0.1 && this.inLake(P.x, P.z, 1.35)) {
        if (Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 6) this.ctx.hurt(5, '水导电（你也泡在水里）', undefined, 'shock');
      }
      return 1.5;
    }
    return 1;
  }

  protected introShot(): Shot {
    const ctx = this.ctx;
    const L = this.lake;
    const a0 = this.playerAngle();
    this.swimA = a0;
    this.swimPos(a0, -3);
    const head = new THREE.Vector3();
    return {
      name: '化蛇 · 登场', dur: 6.5, bars: true, skippable: true,
      cam: (t, out) => {
        // 贴着水面看湖，黑影游过来，破水而出时抬头
        this.boneWorld('head', head);
        const k = smooth((t - 2.3) / 1.5);
        const lx = this.pos.x, lz = this.pos.z;
        const dx = ctx.feet.x - lx, dz = ctx.feet.z - lz, d = Math.hypot(dx, dz) || 1;
        out.pos.set(lx + dx / d * 14 + dz / d * 4, this.level + 1.2 + 2.5 * k, lz + dz / d * 14 - dx / d * 4);
        out.look.set(lx, this.level + 0.3 + (head.y - this.level) * k, lz);
        out.fov = 55;
      },
      card: { title: '化蛇', sub: '人面豺身 · 鸟翼蛇行', quote: '《中山经》：其音如叱呼，见则其邑大水', at: 3.6, dur: 2.6 },
      tick: (t) => {
        if (t < 2.3) {
          // 水下的黑影 S 形游过来
          this.swimA += 0.006;
          this.swimPos(this.swimA, -3 + 1.5 * smooth(t / 2.3));
          this.host.visible = t > 1.4;
          (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.min(1, t);
          this.shadow.position.set(this.pos.x, this.level + 0.05, this.pos.z);
          this.shadow.rotation.y = this.yaw;
          if (Math.random() < 0.5) ctx.fx.spray(_v.set(this.pos.x + (Math.random() - 0.5) * 4, this.level, this.pos.z + (Math.random() - 0.5) * 4), '#e0f8ff', 1, 0.5, 1.5, 2, 0.5);
          this.show = { id: 'rise', stage: 'windup', k: 0 };
        } else {
          (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0;
          if (!this.mem.burst) {
            this.mem.burst = 1;
            this.host.visible = true;
            ctx.fx.spray(_v.set(this.pos.x, this.level, this.pos.z), ['#e8fbff', '#9fe8ff', '#ffffff'], 120, 9, 9, 14, 1.4);
            ctx.fx.burst(_v.clone().setY(this.level + 2), 5, '#bff4ff');
            ctx.shake(0.4);
          }
          this.swimPos(this.swimA, -1.5 + 1.2 * smooth((t - 2.3) / 0.8));
          this.faceTo(ctx.feet.x, ctx.feet.z, 1 / 30, 2);
          const tt = t - 2.3;
          this.show = { id: 'rise', stage: tt < 1 ? 'windup' : tt < 2.5 ? 'active' : 'recover', k: tt < 1 ? tt : tt < 2.5 ? (tt - 1) / 1.5 : (tt - 2.5) / 1.7 };
        }
      },
    };
  }

  protected override afterIntro(): void {
    this.show = null;
    this.mem.burst = 0;
    this.ctx.say('它张嘴的时候打嘴（×3）；引它扑上岸，搁浅时最好打', 4);
  }

  protected transition(n: number): Shot {
    const ctx = this.ctx;
    if (n === 2) {
      const f0 = this.flood;
      const c = new THREE.Vector3(this.lake.x, this.level, this.lake.z);
      return {
        name: '化蛇 · 涨水', dur: 3.2, bars: true, skippable: true,
        cam: orbitCam(c, 46, 14, Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z) - 0.2, Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z) + 0.25, 3.2, 0, 55),
        banner: { text: '二 · 涨水', at: 0.3, dur: 2.6 },
        tick: (t) => {
          this.show = { id: 'roar', stage: t < 0.6 ? 'windup' : 'active', k: Math.min(1, t / 2) };
          this.flood = f0 + 0.6 * smooth((t - 0.6) / 2.4);
          this.swimPos(this.swimA, -0.2);
        },
        onEnd: () => { this.show = null; this.flood = 0.6; ctx.say('湖水涨上来了——上塔林、巨石、玛尼堆，泡在水里会掉血', 4); },
      };
    }
    return {
      name: '化蛇 · 大水', dur: 2.6, bars: false, lock: false,
      banner: { text: '三 · 大水', at: 0.2, dur: 2.4 },
      tick: (t) => { this.show = { id: 'roar', stage: 'active', k: t / 2.6 }; this.swimPos(this.swimA, -0.2); },
      onEnd: () => { this.show = null; ctx.say('湖水打漩——泡在水里会被往湖心拉', 3); },
    };
  }

  protected deathShot(): Shot {
    const ctx = this.ctx;
    const c = this.pos.clone();
    const a0 = Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z);
    const f0 = this.flood, s0 = this.surge;
    return {
      name: '化蛇 · 水退', dur: 6, bars: true, skippable: true,
      slow: (t) => (t < 1.2 ? 0.3 : 1),
      cam: orbitCam(c, 16, 6, a0 - 0.3, a0 + 0.7, 6, 1, 55),
      card: { title: '化蛇 · 水退', sub: '湖面平了', at: 3, dur: 2.8 },
      tick: (t) => {
        this.show = { id: 'choke', stage: t < 0.6 ? 'windup' : 'active', k: Math.min(1, t / 0.6) };
        const sink = smooth((t - 1.6) / 3);
        this.pos.y = this.level - 0.2 - 3 * sink;
        this.flood = f0 * (1 - smooth((t - 1) / 4));
        this.surge = s0 * (1 - smooth((t - 1) / 2));
        if (t > 4.6) this.host.visible = false;
      },
      onEnd: () => { this.show = null; this.flood = 0; this.surge = 0; this.host.visible = false; this.inShow = false; },
    };
  }

  protected onBreak(): void {
    const ctx = this.ctx;
    ctx.fx.spray(this.boneWorld('mouth', _v).clone(), ['#e8fbff', '#9fe8ff'], 50, 6, 5, 12, 1);
    ctx.say('噎住了！化蛇翻着肚子浮在水面——打', 2.5);
    this.surge = 0; this.surgeT = 0;
    this.pos.y = this.level - 0.2;
  }

  protected override onReset(): void {
    this.flood = 0; this.surge = 0; this.surgeT = 0;
    this.show = null;
    this.host.visible = true;
    this.applyFlood();
  }

  protected override idle(dt: number): void {
    this.swimA += dt * 0.12;
    this.swimPos(this.swimA);
  }

  protected override onEvent(ev: string, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    void dist;
    if (ev === 'warn' && (id === 'lunge' || id === 'dive')) {
      // 扑线：从它朝玩家方向 8 m（冲上岸）
      this.A.copy(this.pos);
      const head = this.boneWorld('head', new THREE.Vector3());
      const yaw = Math.atan2(P.x - head.x, P.z - head.z);
      const reach = Math.min(10, Math.hypot(P.x - head.x, P.z - head.z) + 1);
      this.B.set(this.pos.x + Math.sin(yaw) * reach, 0, this.pos.z + Math.cos(yaw) * reach);
      this.B.y = Math.max(ctx.terrain.heightAt(this.B.x, this.B.z), this.level) - 0.2;
      this.mem.lyaw = yaw;
      const delay = this.move.def!.windup;
      this.warns.push(ctx.fx.lineWarn(head.x, head.z, head.x + Math.sin(yaw) * (reach + 2), head.z + Math.cos(yaw) * (reach + 2), 3.4, delay, '#ffb347'));
      this.mem.bit = 0;
      if (id === 'dive') ctx.say('水下有一串气泡朝你游过来', 1.5);
    } else if (ev === 'hit' && (id === 'lunge' || id === 'dive')) {
      const head = this.boneWorld('head', new THREE.Vector3());
      ctx.fx.spray(head, ['#e8fbff', '#9fe8ff'], 30, 6, 4, 12, 0.8);
    } else if (ev === 'release' && id === 'spit') {
      const from = this.boneWorld('mouth', new THREE.Vector3());
      const ox = (Math.random() - 0.5) * 5, oz = (Math.random() - 0.5) * 5;
      const to = new THREE.Vector3(P.x + ox + (this.pvx() * 0.8), 0, P.z + oz + this.pvz() * 0.8);
      to.y = ctx.fx.ground(to.x, to.z);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.85 }));
      ctx.fx.lob(from, to, 1.1, ball, 2.6, (at) => {
        ctx.fx.spray(at, ['#e8fbff', '#9fe8ff'], 24, 5, 4, 14, 0.6);
        ctx.fx.burst(at, 2.6, '#9fe8ff');
        if (at.distanceTo(ctx.feet) < 2.6 && !ctx.invulnerable()) ctx.hurt(12, '化蛇的水弹', knockFrom(ctx, at.x, at.z, 5, 2));
      }, '#5ab8ff');
    } else if (ev === 'hit' && id === 'wingslap') {
      // 拍水掀一圈浪往岸上推，1 m 高：跳过
      const x = this.pos.x, z = this.pos.z;
      let done = false;
      ctx.fx.spray(_v.set(x, this.level, z), ['#e8fbff', '#9fe8ff'], 60, 10, 5, 12, 1);
      ctx.shake(0.25);
      ctx.fx.shockwave(x, z, 30, 1.6, (r) => {
        const d = Math.hypot(ctx.feet.x - x, ctx.feet.z - z);
        if (!done && Math.abs(d - r) < 1.4 && ctx.walker.grounded && !ctx.invulnerable()) {
          done = true; ctx.hurt(10, '化蛇的浪', knockFrom(ctx, x, z, 9, 3));
        }
      }, '#9fe8ff', 3);
    } else if (ev === 'hit' && id === 'tailsweep') {
      // 尾巴横扫一段湖岸：尾巴那一侧 14 m 内、120° 的扇形
      const tail = this.boneWorld('tail_6', new THREE.Vector3());
      const yaw = Math.atan2(tail.x - this.pos.x, tail.z - this.pos.z);
      ctx.fx.spray(tail, ['#e8fbff', '#9fe8ff'], 40, 8, 4, 12, 0.8);
      const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
      let a = Math.atan2(dx, dz) - yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.hypot(dx, dz) < 14 && Math.abs(a) < 1.05 && ctx.walker.grounded && !ctx.invulnerable()) ctx.hurt(14, '化蛇的尾扫', knockFrom(ctx, this.pos.x, this.pos.z, 10, 4));
    } else if (ev === 'warn' && id === 'tailsweep') {
      const tail = this.boneWorld('tail_6', new THREE.Vector3());
      this.warns.push(ctx.fx.coneWarn(this.pos.x, this.pos.z, Math.atan2(tail.x - this.pos.x, tail.z - this.pos.z), 2.1, 14, this.move.def!.windup, '#5ab8ff'));
    } else if (ev === 'warn' && id === 'roar') {
      ctx.say('化蛇张嘴吼叫——湖水要涨了，打它的嘴！', 2.2);
    } else if (ev === 'warn' && id === 'wingslap') {
      this.warns.push(ctx.fx.telegraph(this.pos.x, this.pos.z, 6, this.move.def!.windup, () => {}, '#5ab8ff'));
    }
  }

  private pvx(): number { return this.ctx.pvel.x; }
  private pvz(): number { return this.ctx.pvel.y; }

  protected think(dt: number, _dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id, st = this.move.stage;
    if (this.move.busy) {
      if (id === 'lunge' || id === 'dive') {
        if (st === 'windup') {
          if (id === 'dive') {
            // 潜下去，一串气泡朝岸边游
            this.pos.y = this.level - 2.5;
            const k = this.move.stageK;
            const bx = this.A.x + (this.B.x - this.A.x) * k * 0.6, bz = this.A.z + (this.B.z - this.A.z) * k * 0.6;
            if (Math.random() < 0.7) ctx.fx.spray(_v.set(bx, this.level, bz), '#ffffff', 2, 0.5, 2, 3, 0.6);
          } else { this.face(this.mem.lyaw, dt); this.pos.y = this.level - 0.2; }
          return;
        }
        if (st === 'active') {
          const k = this.move.stageK;
          this.pos.lerpVectors(this.A, this.B, k);
          this.pos.y = Math.max(this.pos.y, ctx.terrain.heightAt(this.pos.x, this.pos.z) - 0.1);
          this.yaw = this.mem.lyaw;
          const head = this.boneWorld('head', _v);
          if (!this.mem.bit && Math.hypot(P.x - head.x, P.z - head.z) < 4.5 && !ctx.invulnerable()) {
            this.mem.bit = 1;
            ctx.hurt(20, '化蛇扑咬', knockFrom(ctx, head.x, head.z, 9, 4));
          }
          return;
        }
        // 搁浅在岸上，收招最后 30% 滑回水里
        const k = this.move.stageK;
        if (k > 0.7) this.pos.lerpVectors(this.B, this.A, smooth((k - 0.7) / 0.3));
        return;
      }
      this.faceTo(P.x, P.z, dt, 2);
      if (id === 'spit' || id === 'roar' || id === 'wingslap' || id === 'tailsweep') this.pos.y += (this.level - 0.1 - this.pos.y) * Math.min(1, dt * 4);
      if (id === 'roar' && st === 'active') { this.surge = Math.min(0.5, this.surge + dt * 0.4); this.surgeT = 6; }
      return;
    }
    // 朝玩家那一侧的湖岸游
    let d = this.playerAngle() - this.swimA;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.swimA += Math.max(-0.35 * dt, Math.min(0.35 * dt, d)) * (this.status.slow > 0 ? 0.6 : 1);
    this.swimPos(this.swimA);
    if (this.cd > 0) return;
    this.cd = 0.7 * this.tempo;
    const head = this.boneWorld('head', _v);
    const near = Math.hypot(P.x - head.x, P.z - head.z);
    const m = this.pick([HUASHE.spit, HUASHE.lunge, HUASHE.wingslap, HUASHE.roar, HUASHE.dive, HUASHE.tailsweep], (x: MoveDef) => {
      if (x.id === 'lunge') return near < 10 ? 3 : 0;
      if (x.id === 'dive') return near > 10 && near < 30 ? 1.2 : 0;
      if (x.id === 'roar') return this.surge > 0 ? 0 : this.phase === 3 ? 2 : 1;
      if (x.id === 'wingslap') return near < 26 ? 1 : 0.2;
      if (x.id === 'tailsweep') return near < 14 ? 1.2 : 0;
      return near < 60 ? 1 : 0;
    });
    if (m) this.begin(m);
  }

  private face(yaw: number, dt: number): void {
    let d = yaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-4 * dt, Math.min(4 * dt, d));
  }

  protected override after(dt: number): void {
    const ctx = this.ctx, P = ctx.feet;
    // 吼叫涨水 6 秒后退
    if (this.surgeT > 0 && this.move.id !== 'roar') { this.surgeT -= dt; if (this.surgeT <= 0) this.surgeT = 0; }
    if (this.surgeT <= 0 && this.move.id !== 'roar') this.surge = Math.max(0, this.surge - dt * 0.3);
    this.applyFlood();
    // 嘴里的紫红光（张嘴时）
    const open = this.mouthOpen && this.host.visible && !this.defeated;
    this.mouthGlow.visible = open;
    if (open) { this.boneWorld('mouth', this.mouthGlow.position); this.mouthGlow.scale.setScalar(1.2 + 0.3 * Math.sin(ctx.time * 20)); this.mouthGlow.material.opacity = 0.8; }
    // 泡在水里：二阶段起每秒 2；三阶段漩涡往湖心拉
    if (this.active && !this.defeated && !this.inShow && this.flood + this.surge > 0.3) {
      const inWater = this.inLake(P.x, P.z, 1.35) && P.y < this.level - 0.1;
      this.mem.soak = (this.mem.soak ?? 0) - dt;
      if (inWater && this.mem.soak <= 0) { this.mem.soak = 0.5; ctx.hurt(1, '冰湖刺骨的水'); }
      if (inWater && this.phase === 3) {
        const dx = this.lake.x - P.x, dz = this.lake.z - P.z, d = Math.hypot(dx, dz) || 1;
        ctx.walker.shove(dx / d * 1.6 * dt, dz / d * 1.6 * dt);
      }
    }
    // 漂浮在水面附近（没出招时）
    if (!this.move.busy && this.active && !this.inShow && this.brokenT <= 0) this.pos.y += (this.level - 0.3 - this.pos.y) * Math.min(1, dt * 3);
  }

  private applyFlood(): void {
    if (!this.lakeMesh) return;
    const f = this.flood + this.surge;
    this.lakeMesh.position.y = this.baseLevel + f;
    const k = 1 + 0.15 * f;
    this.lakeMesh.scale.set(k, 1, k);
  }
}

export function createLords(ctx: PlayCtx): Boss[] {
  return [new KuiBoss(ctx), new FeilianBoss(ctx), new HuasheBoss(ctx)];
}

export type { CamKey };
