/**
 * 雷魅的底座（chuanzang-combat-v1.md 第 1 节）：模型 + 程序化动作 + 命中球 + 招式时间轴 + 受击的四层 + 带电 + 出手令牌。
 * 各怪的 AI 在 foes.ts 里继承它，只写 think()（选招、走位）和 onEvent()（招式时间点上做什么）。
 *
 * 状态：idle（在领地里待着）→ alert（发现玩家，整片遇敌一起醒）→ dead。玩家跑远了（离领地中心 r + 80 m）就脱战回家回血。
 * 受击：每一枪闪白 + 按方向歪一下；韧性（2 秒内累计）满了硬直（打断非霸体的招、撤回预警）；眩晕（封脉、各怪的反制）；
 * 死亡按死因分普通 / 弱点击杀 / 爆炸击杀（被掀飞打转）/ 炸开（帝江），带电的死时把电传给同伴。
 */
import * as THREE from 'three';
import type { NativeBody } from '../../../assets/NativeRig';
import type { MonsterKind } from '../spec';
import { CreatureAnimator, newAnimState, type AnimState, type DeathKind, type Gait } from './anim';
import { spawnCreature, type PlateauModel } from './assets';
import type { Actor, DamageInfo, HitSphere, PlayCtx } from './core';
import { StatusBag } from './elements';
import type { WarnHandle } from './fx';
import { MoveRunner, movesOf, type MoveDef } from './moves';

export const MAGENTA = new THREE.Color('#ff4fd8');
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export interface SphereSpec { bone: string; r: number; mult: number; part?: string }

export interface FoeSpec {
  model: PlateauModel; scale: number; gait: Gait; hp: number; speed: number; stride: number;
  spheres: SphereSpec[];
  /** 发现玩家的视距 */
  sight: number;
  /** 韧性：2 秒内累计的韧性伤害超过它就硬直（Infinity = 不硬直） */
  poise: number;
  /** 硬直时长 */
  staggerTime: number;
  /** 轻的怪每挨一枪顿一下（秒） */
  hitch?: number;
  /** 前摇发光的骨骼（弱点 / 雷纹）和光晕最大尺寸（米） */
  glowBone?: string;
  glowSize?: number;
  /** 身体中心离地高度（反应爆点、雷弧落点） */
  centerY: number;
}

/** 一处遇敌的共享状态：领地、出手令牌 */
export interface EncounterState {
  id: string; site: string; x: number; z: number; r: number;
  foes: Foe[];
  alerted: boolean;
  cleared: boolean;
  burrows: THREE.Vector3[];
  /** 出手令牌：近战扑击 2、天狗扑咬 1、远程 2、雷吠 1 */
  tokens: Record<TokenKind, number>;
}

export type TokenKind = 'melee' | 'pounce' | 'ranged' | 'howl';
export const TOKEN_LIMITS: Record<TokenKind, number> = { melee: 2, pounce: 1, ranged: 2, howl: 1 };

/** 状态图标贴图缓存（灼烧 / 雷殛 / 蚀化 / 带电 / 护盾层） */
const pipCache = new Map<string, THREE.Texture>();
function pipTexture(key: string): THREE.Texture {
  let tex = pipCache.get(key);
  if (tex) return tex;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 32;
  const g = cv.getContext('2d')!;
  const cols: Record<string, string> = { b: '#ff8a3a', s: '#ff5ad8', c: '#7ddc4a', e: '#ffffff', h: '#c792ff' };
  const items = key.split('');
  items.forEach((ch, i) => {
    const x = 64 + (i - (items.length - 1) / 2) * 26;
    g.beginPath(); g.arc(x, 16, 10, 0, Math.PI * 2);
    g.fillStyle = cols[ch] ?? '#fff'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#000a'; g.stroke();
    if (ch === 'e') { g.fillStyle = '#ff4fd8'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.fillText('⚡', x, 22); }
  });
  tex = new THREE.CanvasTexture(cv);
  pipCache.set(key, tex);
  return tex;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return glowTex = new THREE.CanvasTexture(cv);
}
export function glowSprite(color: THREE.ColorRepresentation, size: number): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.scale.setScalar(size);
  return sp;
}

export abstract class Foe implements Actor {
  readonly label: string;
  readonly spec: FoeSpec;
  readonly host: THREE.Group;
  readonly body: NativeBody | null;
  readonly anim: AnimState = newAnimState();
  readonly animator: CreatureAnimator | null;
  readonly pos = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  readonly status = new StatusBag();
  readonly move = new MoveRunner();
  readonly isBoss = false;
  yaw = 0;
  hp: number;
  maxHp: number;
  state: 'idle' | 'alert' | 'dead' = 'idle';
  /** 静电护盾层数（连鼓灵给的，每层完全挡一次伤害） */
  shieldLayers = 0;
  /** 加速剩余秒数（连鼓灵红鼓） */
  haste = 0;
  /** 离地高度（飞的、站在屋顶上的） */
  hover: number;
  enc: EncounterState | null = null;
  sentinel = false;
  /** 打死它的那一下（死法、浮字） */
  deathKind: DeathKind = 'normal';
  /** 领主召来的帮手：算领主一群 */
  owner: unknown = null;
  protected cd = 0;
  protected readonly mem: Record<string, number> = {};
  protected readonly vel = new THREE.Vector3();
  protected deadT = 0;
  protected flash = 0;
  protected stunT = 0;
  protected staggerT = 0;
  protected poiseAcc = 0;
  protected chargeT = 0;
  protected hitchT = 0;
  protected token: TokenKind | null = null;
  /** 不在出招时的持续姿势（蛮蛮落地追啄、穷奇飞回巢穴）：动画状态名 */
  protected posture = '';
  protected warns: WarnHandle[] = [];
  protected readonly hitList: HitSphere[];
  protected readonly extras: THREE.Object3D[] = [];
  private readonly shieldMesh: THREE.Mesh;
  private readonly pip: THREE.Sprite;
  private pipKey = '';
  protected readonly glow: THREE.Sprite | null;
  private crackle = 0;
  private readonly ragVel = new THREE.Vector3();
  private ragSpin = 0;

  constructor(readonly kind: MonsterKind, readonly ctx: PlayCtx, spec: FoeSpec, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>, body?: { host: THREE.Group; body: NativeBody | null }) {
    this.spec = spec;
    this.label = names[kind];
    this.hp = this.maxHp = spec.hp;
    this.hover = hover;
    if (body) { this.host = body.host; this.body = body.body; }
    else {
      const c = spawnCreature(spec.model, spec.scale);
      this.host = c.host;
      this.body = c.body;
    }
    this.animator = this.body ? new CreatureAnimator(this.body.pose, spec.gait, spec.model) : null;
    this.hitList = spec.spheres.map(s => ({ c: new THREE.Vector3(), r: s.r * spec.scale, mult: s.mult, part: s.part }));
    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({
      color: '#c792ff', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.shieldMesh.visible = false;
    this.pip = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.pip.scale.set(1.6, 0.4, 1);
    this.pip.visible = false;
    this.pip.renderOrder = 15;
    this.glow = spec.glowBone && this.body?.pose.has(spec.glowBone) ? glowSprite('#ff6ae0', 1) : null;
    if (this.glow) { this.glow.visible = false; ctx.scene.add(this.glow); }
    ctx.scene.add(this.host, this.shieldMesh, this.pip);
    this.pos.copy(at);
    this.home.copy(at);
  }

  get alive(): boolean { return this.state !== 'dead'; }
  get group(): unknown { return this.owner ?? this.enc ?? this; }
  get stunned(): boolean { return this.stunT > 0; }

  /** 本章规则：带电（各怪覆盖：在电网里、衔雷、雷球攒电……） */
  charged(): boolean { return this.chargeT > 0; }
  charge(sec: number): void { this.chargeT = Math.max(this.chargeT, sec); }

  center(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + this.spec.centerY * this.spec.scale);
  }

  spheres(): readonly HitSphere[] {
    if (!this.host.visible) return [];
    const P = this.body?.pose;
    this.spec.spheres.forEach((s, i) => {
      const b = P?.bone(s.bone);
      if (b) b.getWorldPosition(this.hitList[i].c);
      else this.hitList[i].c.copy(this.pos).setY(this.pos.y + this.spec.centerY * this.spec.scale);
    });
    return this.hitList;
  }

  /** 部位伤害倍率（蓑毛、手里的雷石、鼓面）；返回 0 表示这一下被部位吃掉了 */
  protected partMul(_sphere: HitSphere | undefined, _info: DamageInfo, _dmg: number): number { return 1; }

  hit(dmg: number, mult: number, at: THREE.Vector3, info: DamageInfo = { kind: 'bullet' }): number {
    if (!this.alive || !this.host.visible) return 0;
    if (this.shieldLayers > 0 && info.kind !== 'dot') {
      this.shieldLayers--;
      this.ctx.fx.burst(at, 0.6, '#c792ff');
      this.ctx.fx.spray(at, '#c792ff', 8, 3, 1, 6, 0.3);
      this.alarm();
      return 0;
    }
    const part = this.partMul(info.sphere, info, dmg);
    let d = dmg * mult * part * (this.stunT > 0 ? 1.25 : 1);
    if (d <= 0) { this.alarm(); return 0; }
    this.hp -= d;
    this.flash = 1;
    // 受击方向（模型空间）：从哪边打来
    const from = info.from ?? this.ctx.center;
    _v.subVectors(from, this.pos).setY(0).normalize();
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.anim.hurtX = THREE.MathUtils.clamp(-(_v.x * c - _v.z * s), -1, 1);
    this.anim.hurtZ = THREE.MathUtils.clamp(_v.x * s + _v.z * c, -1, 1);
    this.anim.hurt = Math.min(1, this.anim.hurt + (info.kind === 'dot' ? 0.1 : 0.5));
    if (this.spec.hitch && info.kind !== 'dot') this.hitchT = this.spec.hitch;
    if (mult > 1 && info.kind === 'bullet') this.ctx.fx.spray(at, ['#ffe08a', '#ffffff'], 4, 3, 1, 8, 0.25);
    // 韧性
    const poise = d * (info.poise ?? (mult > 1 ? 2 : 1));
    this.poiseAcc += poise;
    if (this.poiseAcc >= this.spec.poise && this.alive) { this.poiseAcc = 0; this.onPoiseBreak(); }
    this.alarm();
    if (this.hp <= 0) {
      d += this.hp;
      this.die(info, mult);
    }
    this.ctx.dealt(at, d, mult > 1, info);
    return d;
  }

  /** 挨打就醒（整片） */
  protected alarm(): void {
    if (this.state !== 'idle') return;
    this.state = 'alert';
    if (this.enc) this.enc.alerted = true;
  }

  /** 韧性满了：硬直（霸体招不打断） */
  protected onPoiseBreak(): void {
    if (this.move.def?.armored) return;
    this.interrupt();
    this.staggerT = this.spec.staggerTime;
    this.onStagger();
  }

  protected onStagger(): void {}

  /** 打断当前招式：撤回预警、还令牌 */
  interrupt(): void {
    for (const w of this.warns) w.cancel();
    this.warns = [];
    if (this.move.busy) this.onInterrupt(this.move.id);
    this.move.cancel();
    this.giveToken();
  }

  protected onInterrupt(_id: string): void {}

  stun(sec: number, why: string): void {
    if (!this.alive || sec <= 0) return;
    this.interrupt();
    this.stunT = Math.max(this.stunT, sec);
    this.ctx.say(`${this.label}：${why}`, 1.2);
  }

  // ─────────────── 令牌 ───────────────

  protected takeToken(kind: TokenKind): boolean {
    if (this.token === kind) return true;
    const E = this.enc;
    if (!E) { this.token = kind; return true; }
    const used = E.foes.filter(f => f.alive && f.token === kind).length;
    // 玩家刚被击飞 / 打倒：冻结令牌（不连段到死）
    if (used >= TOKEN_LIMITS[kind] || this.ctx.time - this.ctx.player.lastHurt < 0.6 && kind !== 'ranged') return false;
    this.token = kind;
    return true;
  }

  protected giveToken(): void { this.token = null; }

  /** 强制出某一招（试玩脚本、以后烘焙 Unity 片段的强制场景用；子类按需要先摆好条件） */
  force(id: string): boolean {
    const def = movesOf(this.spec.model).find(m => m.id === id);
    if (!def || !this.alive) return false;
    this.interrupt();
    this.stunT = this.staggerT = 0;
    this.state = 'alert';
    this.prepare(id);
    this.begin(def);
    return true;
  }

  protected prepare(_id: string): void {}

  /** 开始一招（出招需要的令牌先拿到） */
  protected begin(def: MoveDef): void {
    this.move.start(def);
    this.warns = [];
  }

  // ─────────────── 死亡 ───────────────

  die(info?: DamageInfo, mult = 1): void {
    if (this.state === 'dead') return;
    const wasCharged = this.charged();
    const burning = this.status.burn > 0;
    this.state = 'dead';
    this.hp = 0;
    this.deadT = 0;
    this.interrupt();
    this.shieldMesh.visible = false;
    this.pip.visible = false;
    if (this.glow) this.glow.visible = false;
    this.anim.deathSide = Math.random() < 0.5 ? 1 : -1;
    const blast = info && (info.kind === 'blast' || info.kind === 'reaction');
    this.deathKind = blast ? 'blast' : mult > 1 ? 'weak' : 'normal';
    this.anim.deathKind = this.deathKind;
    if (this.deathKind === 'blast' && this.hover <= 0.5) {
      const from = info?.from ?? this.ctx.center;
      _v.subVectors(this.pos, from).setY(0);
      if (_v.lengthSq() < 1e-4) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _v.normalize();
      const k = 6 / Math.max(1, this.spec.scale * (this.maxHp > 600 ? 2.5 : 1));
      this.ragVel.set(_v.x * k, 5 / Math.max(1, this.spec.scale), _v.z * k);
      this.ragSpin = (Math.random() < 0.5 ? -1 : 1) * 6;
    }
    if (this.deathKind === 'weak') this.ctx.fx.burst(this.center(_w), 0.8 * this.spec.scale, '#ffffff');
    for (const e of this.extras) e.visible = false;
    if (wasCharged) this.ctx.elements.discharge(this);
    if (burning && this.ctx.kit.stacks('wildfire')) {
      const at = this.center(new THREE.Vector3());
      for (const o of this.ctx.actors()) {
        if (o === this || !o.alive || o.center(_w).distanceTo(at) > 6) continue;
        this.ctx.fx.arc(at, o.center(new THREE.Vector3()), '#ff8a3a', 0.25, 0.6);
        this.ctx.elements.apply(o, 'fire', 24, 1);
      }
    }
    this.giveToken();
    this.onDeath(info);
  }

  protected onDeath(_info?: DamageInfo): void {}

  /** 玩家倒下重来：活着的回家、回满血 */
  reset(): void {
    if (!this.alive) return;
    this.interrupt();
    this.hp = this.maxHp;
    this.state = 'idle';
    this.pos.copy(this.home);
    this.cd = 1;
    this.stunT = this.staggerT = 0;
    this.shieldLayers = 0;
    this.status.clear();
    this.vel.set(0, 0, 0);
  }

  dispose(): void {
    this.ctx.scene.remove(this.host, this.shieldMesh, this.pip);
    if (this.glow) this.ctx.scene.remove(this.glow);
    for (const e of this.extras) this.ctx.scene.remove(e);
  }

  // ─────────────── 移动 ───────────────

  protected canStand(x: number, z: number): boolean {
    const T = this.ctx.terrain;
    // 怪不出可玩区（玩家那边是风雪软边界，怪这边直接不让走）
    if (this.ctx.bound(x, z) > 4) return false;
    if (T.waterDepthAt(x, z) > 0.7 || T.slopeAt(x, z) > 1.1) return false;
    return !this.ctx.world.blocked(x, z, T.heightAt(x, z));
  }

  protected groundY(x: number, z: number): number {
    return this.ctx.world.groundAt(x, z, this.pos.y + 0.6);
  }

  protected face(angle: number, dt: number, rate = 8): void {
    let d = angle - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  protected faceTo(x: number, z: number, dt: number, rate = 8): void {
    this.face(Math.atan2(x - this.pos.x, z - this.pos.z), dt, rate);
  }

  /** 玩家相对朝向的偏角（0 = 正对玩家） */
  protected offFacing(): number {
    const a = Math.atan2(this.ctx.feet.x - this.pos.x, this.ctx.feet.z - this.pos.z) - this.yaw;
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  }

  /** 怪在玩家视野里的偏角（0 = 玩家正看着它） */
  protected inPlayerView(): number {
    const yaw = this.ctx.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const dx = this.pos.x - this.ctx.feet.x, dz = this.pos.z - this.ctx.feet.z, d = Math.hypot(dx, dz) || 1;
    return Math.acos(THREE.MathUtils.clamp((dx * fx + dz * fz) / d, -1, 1));
  }

  /** 朝目标走一步，被挡就左右试几个角度绕；返回走过的距离 */
  protected steer(tx: number, tz: number, speed: number, dt: number, keep = 0): number {
    const ctx = this.ctx;
    speed *= (this.status.slow > 0 ? 0.6 : 1) * (this.haste > 0 ? 1.4 : 1);
    const goal = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (goal <= keep + 0.05) return 0;
    // 追玩家（目标在玩家身边）、离得还远，或者上一步卡住了：按寻路场走下一个路点，绕开墙和房子
    if (this.hover <= 0.5 && ctx.nav && goal > keep + 3 && (Math.hypot(tx - ctx.feet.x, tz - ctx.feet.z) < 10 || this.mem.stuck > 0)) {
      const wp = ctx.nav.next(this.pos.x, this.pos.z);
      if (wp) { tx = wp[0]; tz = wp[1]; keep = 0; }
    }
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    if (d <= keep + 0.05) return 0;
    const step = Math.min(d - keep, speed * dt);
    const base = Math.atan2(dx, dz);
    this.mem.stuck = Math.max(0, (this.mem.stuck ?? 0) - dt);
    for (const off of [0, 0.5, -0.5, 1.1, -1.1, 1.6, -1.6]) {
      const a = base + off, nx = this.pos.x + Math.sin(a) * step, nz = this.pos.z + Math.cos(a) * step;
      if (this.hover > 0.5 || this.canStand(nx, nz)) {
        this.pos.x = nx; this.pos.z = nz;
        if (this.hover <= 0.5) this.pos.y = this.groundY(nx, nz);
        this.face(a, dt);
        this.anim.phase += (step / this.spec.stride) * Math.PI;
        return step;
      }
    }
    this.mem.stuck = 2;
    return 0;
  }

  /** 冲锋 / 扑击的直线位移：撞到东西就停 */
  protected dash(vx: number, vz: number, dt: number): boolean {
    const nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    if (!this.canStand(nx, nz)) return false;
    this.pos.x = nx; this.pos.z = nz;
    this.anim.phase += (Math.hypot(vx, vz) * dt / this.spec.stride) * Math.PI;
    return true;
  }

  // ─────────────── 每帧 ───────────────

  update(dt: number, near: boolean): void {
    const ctx = this.ctx;
    if (this.state === 'dead') {
      this.deadT += dt;
      this.updateDeath(dt);
      if (this.host.visible) this.render(near, dt);
      return;
    }
    this.cd -= dt;
    this.haste = Math.max(0, this.haste - dt);
    this.chargeT = Math.max(0, this.chargeT - dt);
    this.poiseAcc = Math.max(0, this.poiseAcc - this.spec.poise * 0.5 * dt);
    this.hitchT = Math.max(0, this.hitchT - dt);
    const dist = Math.hypot(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z);
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.anim.stun = Math.min(1, this.anim.stun + dt * 5);
      this.anim.move = 0;
      this.whileStunned(dt);
    } else if (this.staggerT > 0) {
      this.staggerT -= dt;
      this.anim.stagger = Math.min(1, this.anim.stagger + dt * 8);
      this.anim.move = 0;
    } else if (this.hitchT <= 0) {
      this.anim.stun = Math.max(0, this.anim.stun - dt * 3);
      this.anim.stagger = Math.max(0, this.anim.stagger - dt * 5);
      this.move.speed = this.haste > 0 ? 1.4 : 1;
      for (const ev of this.move.update(dt)) this.onEvent(ev, dist);
      if (!this.move.busy) this.giveTokenIfIdle();
      if (this.state === 'idle') this.idle(dt, dist);
      else if (!ctx.player.alive) { this.state = 'idle'; this.interrupt(); }
      else this.think(dt, dist);
    }
    // 前摇发光（弱点 / 雷纹从暗到亮），出手闪白星
    if (this.glow) {
      const st = this.move.stage;
      const g = st === 'windup' ? this.move.stageK : st === 'active' ? 1 : 0;
      this.glow.visible = g > 0.02 && near && this.host.visible;
      if (this.glow.visible) {
        this.body!.pose.bone(this.spec.glowBone!)!.getWorldPosition(this.glow.position);
        this.glow.scale.setScalar((0.25 + 0.55 * g) * (this.spec.glowSize ?? 0.8));
        this.glow.material.opacity = 0.3 + 0.6 * g;
      }
    }
    this.render(near, dt);
  }

  private giveTokenIfIdle(): void { if (this.token) this.giveToken(); }

  /** 招式时间点（warn / glint / hit / release / land / end 和自定义）；glint 统一在弱点上闪白星 */
  protected onEvent(ev: string, _dist: number): void {
    if (ev === 'glint') {
      const b = this.body?.pose.bone(this.spec.glowBone ?? 'head');
      if (b) this.ctx.fx.glint(b.getWorldPosition(new THREE.Vector3()), 1.1 * this.spec.scale);
    }
  }

  protected whileStunned(_dt: number): void {}

  /** 没发现玩家：原地待着、小范围踱步；看见了就叫醒整片 */
  protected idle(dt: number, dist: number): void {
    const back = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
    this.anim.move = 0;
    if (back > 1.5 && this.spec.speed > 0) {
      const moved = this.steer(this.home.x, this.home.z, this.spec.speed * 0.6, dt);
      this.anim.move = moved > 0 ? 0.6 : 0;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.3 * dt);
    }
    const sight = this.sentinel ? 48 : this.spec.sight;
    if (dist < sight && this.ctx.player.alive && this.sees()) this.notice();
  }

  protected sees(): boolean {
    const eyeY = this.pos.y + 1.2 * this.spec.scale;
    const c = this.ctx.center;
    return this.ctx.terrain.lineOfSight(this.pos.x, eyeY, this.pos.z, c.x, c.y, c.z);
  }

  /** 发现玩家：自己和整片遇敌都醒 */
  notice(): void {
    this.state = 'alert';
    if (this.enc && !this.enc.alerted) {
      this.enc.alerted = true;
      for (const f of this.enc.foes) if (f.alive && f.state === 'idle') f.state = 'alert';
    }
  }

  /** 发现之后：各怪各打各的 */
  protected abstract think(dt: number, dist: number): void;

  /** 记下玩家速度（举父往前扔用） */
  notePlayerVel(vx: number, vz: number): void { this.mem.pvx = vx; this.mem.pvz = vz; }

  private updateDeath(dt: number): void {
    const ctx = this.ctx;
    this.anim.dead = Math.min(1, this.anim.dead + dt * (this.deathKind === 'weak' ? 3.5 : 2));
    this.anim.move = 0; this.anim.stun = 0; this.anim.stagger = 0;
    if (this.ragVel.lengthSq() > 0.01) {
      // 被掀飞：抛物线 + 打转，落地就停
      this.ragVel.y -= 22 * dt;
      this.pos.addScaledVector(this.ragVel, dt);
      this.yaw += this.ragSpin * dt;
      const g = ctx.terrain.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y <= g) { this.pos.y = g; this.ragVel.set(0, 0, 0); ctx.fx.spray(this.pos, '#8a7a60', 8, 3, 1.5, 10, 0.4); }
    } else if (this.hover > 0.5 && !this.mem.fallen) {
      // 飞的：打着旋掉下来
      this.yaw += dt * 6;
      const g = ctx.terrain.heightAt(this.pos.x, this.pos.z);
      this.pos.y = Math.max(g, this.pos.y - dt * 11);
      if (this.pos.y <= g + 0.01) { this.mem.fallen = 1; ctx.fx.spray(this.pos, ['#f0ece0', '#5a4a3a'], 18, 4, 2, 10, 0.6); }
    }
    if (this.deadT > 3.2) this.pos.y -= dt * 0.7;
    if (this.deadT > 4.5) this.host.visible = false;
  }

  /** 摆姿势、闪白、带电噼啪、状态图标、护盾壳 */
  protected render(near: boolean, dt: number): void {
    const ctx = this.ctx;
    this.anim.hurt = Math.max(0, this.anim.hurt - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.host.position.copy(this.pos);
    this.host.rotation.y = this.yaw;
    const st = this.move.stage;
    this.anim.pose = this.move.id || this.posture;
    this.anim.stage = st ?? '';
    this.anim.k = this.move.stageK;
    if (near) {
      const look = Math.atan2(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z) - this.yaw;
      this.anim.look = this.state === 'alert' ? Math.atan2(Math.sin(look), Math.cos(look)) : 0;
      this.animator?.apply(this.anim, ctx.time + this.home.x);
      if (this.body) {
        const m = this.body.materials[0] as THREE.MeshStandardMaterial;
        const ch = this.alive && this.charged() ? 0.05 + 0.05 * Math.max(0, Math.sin(ctx.time * 20)) : 0;
        m.emissive.setRGB(this.flash * 0.9 + ch, this.flash * 0.9 + ch * 0.3, this.flash * 0.9 + ch);
      }
      this.host.updateMatrixWorld(true);
      this.placeExtras();
      // 带电：身上随机噼啪
      if (this.alive && this.charged()) {
        this.crackle -= dt;
        if (this.crackle <= 0) {
          this.crackle = 0.12 + Math.random() * 0.15;
          const c = this.center(_v), r = 0.6 * this.spec.scale;
          const a = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * r * 2, (Math.random() - 0.3) * r * 2, (Math.random() - 0.5) * r * 2));
          const b = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * r * 2, (Math.random() - 0.3) * r * 2, (Math.random() - 0.5) * r * 2));
          ctx.fx.arc(a, b, '#ff7ae6', 0.08, 0.15);
        }
      }
    }
    // 状态图标：灼烧 / 雷殛 / 蚀化 / 带电 / 护盾层
    const S = this.status;
    const key = this.alive ? `${S.burn > 0 ? 'b' : ''}${S.shock > 0 ? 's' : ''}${S.corrode > 0 ? 'c' : ''}${this.charged() ? 'e' : ''}${'h'.repeat(this.shieldLayers)}` : '';
    if (key !== this.pipKey) {
      this.pipKey = key;
      this.pip.visible = key.length > 0;
      if (key) { this.pip.material.map = pipTexture(key); this.pip.material.needsUpdate = true; }
    }
    if (this.pip.visible) this.pip.position.copy(this.pos).setY(this.pos.y + (this.spec.centerY * 2 + 0.5) * this.spec.scale + 0.3);
    this.shieldMesh.visible = this.shieldLayers > 0 && this.alive;
    if (this.shieldMesh.visible) {
      this.center(this.shieldMesh.position);
      this.shieldMesh.scale.setScalar(this.spec.centerY * 1.6 * this.spec.scale + 0.3);
      (this.shieldMesh.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.05 * this.shieldLayers;
    }
  }

  protected placeExtras(): void {}

  /** 骨骼的世界位置 */
  protected boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 {
    const b = this.body?.pose.bone(name);
    return b ? b.getWorldPosition(out) : this.center(out);
  }

  /** 骨骼的世界朝向 */
  protected boneQuat(name: string, out: THREE.Quaternion): THREE.Quaternion {
    const b = this.body?.pose.bone(name);
    return b ? b.getWorldQuaternion(out) : out.identity();
  }
}

