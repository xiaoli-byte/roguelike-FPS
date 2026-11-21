import * as THREE from 'three';
import type { DamageRequest, Element, GameContext, IEnemy } from '../core/types';
import { PET_TAG } from '../combat/PetContract';
import { type PetDef, type RGB, PET_GOLD, rgbHex } from './PetDefs';
import { type PetModel, buildPetModel, disposePetModel, modelRigged, socketOf } from './PetVisuals';
import { glowSprite, type PetFxSystem } from './PetFx';
import { Routines, type RoutineGen } from './Routine';
import type { PetBehaviour, PetZoneHandle } from './PetBehaviours';

/**
 * 灵宠本体（照译 Unity G/Pets/Pet.cs；docs/pet-system.md 第 3、6 节）：
 *   状态：跟随（玩家身后 2.5–3.5 m；飞行宠物在肩后上方）→ 交战（玩家 18 m 内有敌人：打玩家正在打的那个，否则离玩家最近的）
 *        → 归位（离玩家超过 22 m 或卡住 3 s：灵火一闪瞬移回身边）。
 *   移动：地面宠物照 NavMeshAgent 的参数（加速度 40、停止距离 0.35）走：直线可走就直走，否则按导航网格寻路（ctx.nav.findPath），
 *        碰撞走 ctx.world.moveBody（台阶 0.45 m）；飞行宠物插值飞行，遇墙抬高，离地不低于 0.6 m。
 *   灵体：没有碰撞体，不挡玩家、不挡子弹、不受伤。
 *   骨骼动画：步态速度由这里喂（平滑后的水平速度，冲刺超过 20 m/s 也不会被当成瞬移），看向目标 / 玩家，出招按状态名 playAct；
 *        瞬移、出场时重置步态。
 *   程序动画（只动 Visual 子节点）：出场弹出、升级闪光、悬浮起伏、飞行压弯、攻击前冲（骨骼动画灵宠缩小到约三分之一）；
 *        占位体另有呼吸、跑动颠步、挤压拉伸、扇翅 / 甩尾。
 *   灵契：1–5 级，经验 6 / 10 / 16 / 24；每级伤害 +15%、灵技冷却 −6%；3 级觉醒。
 * 攻击统一走 hit / aoe：来源 'pet'（combat/PetContract：只吃灵宠伤害、不随机暴击、不吸血、不顿帧）、标签 'pet'、深度 0（能引发元素反应）。
 * 时间一律是游戏时间（ctx.time.now，暂停时不走），同 Unity Time.time。
 */

export const ENGAGE_RANGE = 18;
export const LEASH_RANGE = 22;
export const STUCK_TIME = 3;
export const TARGET_MEMORY = 3;
export const MAX_LEVEL = 5;
export const AWAKEN_LEVEL = 3;
export const XP_NEED: readonly number[] = [6, 10, 16, 24];

export type PetMode = 'follow' | 'engage' | 'return';

/** 灵宠要用到的外部服务（PetSystem 实现） */
export interface PetHost {
  readonly ctx: GameContext;
  readonly fx: PetFxSystem;
  /** 头顶浮字（Unity GameUI.FloatText） */
  floatText(pos: THREE.Vector3, text: string, color: RGB, scale: number): void;
  banner(title: string, sub?: string, seconds?: number): void;
  toast(text: string, color?: RGB, seconds?: number): void;
  /** 全屏闪光（颜色含 alpha） */
  flash(rgba: readonly [number, number, number, number], seconds: number): void;
  /** 灵契升级（HUD / 存档） */
  leveledUp(pet: Pet): void;
  /** 灵宠的抛物线弹（精卫的火石；Unity PlayerProjectile.Spawn） */
  throwStone(spec: StoneSpec): void;
  /** 灵宠留在地上的持续伤害区（狻猊觉醒的蚀雾；Unity PetZone.Spawn） */
  spawnZone(pet: Pet, center: THREE.Vector3, radius: number, duration: number, damage: number, element: Element, chance: number, color: RGB): PetZoneHandle;
}

/** 灵宠的抛物线弹：命中敌人 / 墙 / 地面或到期时在落点做 explodeRadius 的范围伤害（中心 100% → 边缘 50%） */
export interface StoneSpec {
  from: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: number;
  radius: number;
  life: number;
  explodeRadius: number;
  request: DamageRequest;
  /** 弹体模型：发光件 id（精卫的火石）；没有 / 没加载到用灰色小球 */
  partId: string;
  /** 弹体放到多大（米） */
  size: number;
  glow: RGB;
  onImpact?: (at: THREE.Vector3) => void;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };
const _queryOut: IEnemy[] = [];

const flatLen = (x: number, z: number) => Math.hypot(x, z);
export function flat(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
function deltaAngle(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function easeOutBack(k: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

export class Pet {
  readonly def: PetDef;
  readonly host: PetHost;
  readonly ctx: GameContext;
  /** 脚底（root.position） */
  readonly root = new THREE.Group();
  readonly visual = new THREE.Group();
  readonly position: THREE.Vector3;
  model!: PetModel;
  behaviour!: PetBehaviour;
  state: PetMode = 'follow';
  level = 1;
  xp = 0;
  /** 灵技剩余冷却（秒） */
  skillLeft = 0;
  target: IEnemy | null = null;
  /** 本体造成的伤害合计（行囊「本局灵宠造成伤害」） */
  damageDealt = 0;
  /** 已解除结契（换宠 / 换关）：不再出手 / 嘲讽 */
  released = false;
  /** 当前朝向（root.rotation.y；模型 +Z 朝前，facing = atan2(dx, dz)） */
  yaw = 0;
  readonly routines = new Routines();
  /** 动画事件（片段里的 hit / fire / drop / cast / roar…）：玩法时机仍由代码决定，这里只给特效挂 */
  onAnimEvent: ((name: string) => void) | null = null;

  private aura: THREE.Sprite | null = null;
  private readonly lookTarget = new THREE.Vector3();
  private readonly flyVel = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  private readonly lastGoal = new THREE.Vector3(Infinity, 0, 0);
  private readonly lungeDir = new THREE.Vector3();
  /** think 专用的临时向量（移动 / 飞行内部会用模块级临时向量，这里不能和它们共用） */
  private readonly goalV = new THREE.Vector3();
  private readonly beforeV = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private side = 1;
  private age = 0;
  private attackTimer = 0;
  private retargetTimer = 0;
  private stuckTimer = 0;
  private repath = 0;
  private returnCooldown = 0;
  private speedSm = 0;
  private bank = 0;
  private lastYaw = 0;
  private hopPhase = 0;
  private popT = 0;
  private flashT = -1;
  private lungeT = -1;
  private lungeDur = 0.2;
  private lungeDist = 0;
  private whipT = -1;
  private queuedCast = 0;
  private moving = false;
  private onGround = false;
  private busy = 0;
  private manual = 0;
  private playerTarget: IEnemy | null = null;
  private playerTargetUntil = 0;
  private actLockUntil = 0;
  private actScale = 1;
  private partShowAt = 0;
  /** 发光件拆下来了（在世界里飞，不跟着挂点） */
  partDetached = false;
  private readonly moveResult = { onGround: false, hitWall: false, hitCeiling: false, stepped: false, groundY: 0, wallNormal: new THREE.Vector3() };

  constructor(host: PetHost, def: PetDef) {
    this.host = host;
    this.ctx = host.ctx;
    this.def = def;
    this.position = this.root.position;
    this.root.name = `灵宠 · ${def.name}`;
  }

  // ───────────── 生成 / 销毁 ─────────────

  /** skillLeft = 灵技剩余冷却（换宠再换回来时接着算，不刷新）；Unity Pet.Spawn + Init */
  static spawn(host: PetHost, def: PetDef, behaviour: PetBehaviour, pos: THREE.Vector3, yaw: number, level = 1, xp = 0, skillLeft = 0): Pet {
    const p = new Pet(host, def);
    p.skillLeft = Math.max(0, skillLeft);
    p.init(behaviour, Math.max(1, Math.min(MAX_LEVEL, Math.round(level))), xp, pos, yaw);
    return p;
  }

  private init(behaviour: PetBehaviour, level: number, xp: number, pos: THREE.Vector3, yaw: number): void {
    const ctx = this.ctx;
    this.level = level;
    this.xp = xp;
    this.side = this.def.followSide >= 0 ? 1 : -1;
    this.root.position.copy(pos);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.visual.name = 'Visual';
    this.root.add(this.visual);
    ctx.scene.add(this.root);
    this.model = buildPetModel(ctx, this.def, this.visual, { root: this.root });
    const rc = this.def.rarityColor;
    this.aura = glowSprite(rc, this.def.rarity === 2 ? 0.32 : 0.18, Math.max(0.8, this.model.size * 1.6));
    this.aura.position.y = this.height * 0.5;
    this.visual.add(this.aura);
    const clips = this.model.clips;
    if (clips) {
      clips.lookTarget = this.lookTarget;
      clips.onEvent = (e) => this.onAnimEvent?.(e.name);
      clips.onReady = (p) => {
        // 飞行宠物整体压弯由 Visual 倾斜负责，骨盆不再叠一层
        if (p.anim && this.def.flying) p.anim.locomotion.leanPerTurn = 0;
        p.anim?.locomotion.teleported();
      };
    }
    if (this.def.flying) this.root.position.copy(this.flyGoal(_v1));
    else this.snapToGround();
    this.lastPos.copy(this.position);
    this.lastYaw = this.yaw;
    this.popT = 0;
    this.visual.scale.setScalar(0.01);
    this.host.fx.burst(_v1.copy(this.position).addScaledVector(_up, this.height * 0.5), rc, 2.5 + this.model.size, 0.6);
    ctx.fx.impact(_v1.copy(this.position).addScaledVector(_up, 0.3), _up, rgbHex(rc), 2);
    this.behaviour = behaviour;
    behaviour.bind(this);
    if (this.awakened) behaviour.onAwaken();
  }

  /** 解除结契：撤销被动加成、事件、修正、诱饵（可重复调用）。换宠时先调它，再 dispose */
  release(): void {
    if (this.released) return;
    this.released = true;
    try {
      this.behaviour?.unbind();
    } catch (err) {
      console.error('[pets] 撤销被动出错', err);
    }
    this.routines.stopAll();
  }

  /** 从场景里移除并释放模型（先 release） */
  dispose(): void {
    this.release();
    // 拆下来在世界里飞的发光件不在本体层级下，不会跟着移除
    if (this.partDetached && this.model.part) this.model.part.removeFromParent();
    this.root.removeFromParent();
    disposePetModel(this.model);
    this.aura?.material.dispose();
  }

  // ───────────── 属性 ─────────────

  get height(): number {
    return this.model ? this.model.height : this.def.height;
  }

  get size(): number {
    return this.model ? this.model.size : this.def.height;
  }

  /** 升到下一级还需要的总经验（满级 0） */
  get xpNext(): number {
    return this.level >= MAX_LEVEL ? 0 : XP_NEED[this.level - 1];
  }

  get awakened(): boolean {
    return this.level >= AWAKEN_LEVEL;
  }

  get damageMult(): number {
    return 1 + 0.15 * (this.level - 1);
  }

  get cooldownMult(): number {
    return 1 - 0.06 * (this.level - 1);
  }

  get skillCooldown(): number {
    return this.def.skillCooldown * this.cooldownMult;
  }

  /** 灵技冷却好了（正在普攻也算好：按 G 会排队，动作一结束就放） */
  get skillReady(): boolean {
    return this.skillLeft <= 0;
  }

  get isBusy(): boolean {
    return this.busy > 0;
  }

  get rigged(): boolean {
    return modelRigged(this.model);
  }

  /** 诱饵接口（EnemyBase.taunt）：脚底位置、还在不在 */
  get alive(): boolean {
    return !this.released;
  }

  /** 前方（模型 +Z） */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** 右方（网页右手系：前 +Z 时右 = −X） */
  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  // ───────────── 发光件（精卫的火石、应龙的宝珠） ─────────────

  get part(): THREE.Object3D | null {
    return this.model.part;
  }

  /** 发光件当前世界位置（藏起来 / 没有时用 fallback） */
  partPos(fallback: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.model.part;
    return p && p.visible && p.parent ? p.getWorldPosition(out) : out.copy(fallback);
  }

  /** 扔出去了：藏起手里 / 嘴里的发光件，seconds 秒后再冒出来（连续调用取最晚的） */
  hidePart(seconds: number): void {
    const p = this.model.part;
    if (!p) return;
    p.visible = false;
    this.partShowAt = Math.max(this.partShowAt, this.ctx.time.now + seconds);
  }

  /** 把发光件从挂点上拆下来（保持世界位姿），之后由调用方摆位置；返回它（没有时 null） */
  detachPart(): THREE.Object3D | null {
    const p = this.model.part;
    if (!p) return null;
    if (!this.partDetached) {
      this.ctx.scene.attach(p);
      this.partDetached = true;
    }
    p.visible = true;
    return p;
  }

  /** 装回挂点，恢复挂上时的姿势 */
  reattachPart(): void {
    const p = this.model.part, home = this.model.partHome;
    if (!p || !this.partDetached || !home) return;
    home.add(p);
    p.position.copy(this.model.partLocal.pos);
    p.quaternion.copy(this.model.partLocal.quat);
    p.scale.copy(this.model.partLocal.scale);
    this.partDetached = false;
    if (this.model.partGlow) this.model.partGlow.boost = 0;
  }

  /** 挂点在世界里的位置（发光件拆下来时它该回去的地方） */
  partHomePos(out: THREE.Vector3): THREE.Vector3 {
    const home = this.model.partHome;
    if (!home) return this.center(out);
    return home.localToWorld(out.copy(this.model.partLocal.pos));
  }

  set partBoost(v: number) {
    if (this.model.partGlow) this.model.partGlow.boost = v;
  }

  // ───────────── 挂点 / 位置 ─────────────

  socket(name: string): THREE.Object3D | null {
    return socketOf(this.model, name);
  }

  socketPos(name: string, fallback: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.socket(name);
    return s ? s.getWorldPosition(out) : out.copy(fallback);
  }

  center(out = new THREE.Vector3()): THREE.Vector3 {
    return this.visual.getWorldPosition(out).addScaledVector(_up, this.height * 0.5);
  }

  /** 出手点：mouth 挂点；没有就从头骨往前一点；都没有（占位体）按体型估一个头部前方的点 */
  mouth(out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.socket('mouth');
    if (s) return s.getWorldPosition(out);
    const head = this.socket('head');
    if (head) return head.getWorldPosition(out).addScaledVector(this.forward(_v3), this.size * 0.12);
    return this.visual.getWorldPosition(out).addScaledVector(this.forward(_v3), this.size * 0.35).addScaledVector(_up, this.height * 0.7);
  }

  /** 玩家水平朝向（视线压平；Unity PetOwner.Forward） */
  ownerForward(out: THREE.Vector3): THREE.Vector3 {
    this.ctx.player.getForward(out);
    out.y = 0;
    return out.lengthSq() > 1e-8 ? out.normalize() : out.set(0, 0, 1);
  }

  // ───────────── 灵契 ─────────────

  addXp(amount: number): void {
    if (this.level >= MAX_LEVEL || !(amount > 0)) return;
    this.xp += amount;
    while (this.level < MAX_LEVEL && this.xp >= XP_NEED[this.level - 1]) {
      this.xp -= XP_NEED[this.level - 1];
      this.level++;
      this.flashT = 0;
      this.host.fx.burst(this.center(_v1), PET_GOLD, 3 + this.size, 0.7);
      this.say(`灵契 Lv.${this.level}`, PET_GOLD, 1.35);
      if (this.level === AWAKEN_LEVEL) {
        this.behaviour.onAwaken();
        this.host.banner(`灵契觉醒 · ${this.def.name}`, undefined, 2.2);
        this.host.toast(this.def.awakenDesc, undefined, 3);
        this.host.fx.pillar(this.position, PET_GOLD, 1.2, 8, 1.4);
      }
      this.host.leveledUp(this);
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
  }

  // ───────────── 灵技 ─────────────

  /** 按 G：冷却好了就放；正在普攻就排队（1.6 s 内动作结束即放）。返回是否放出 / 已排队 */
  tryCast(): boolean {
    if (this.skillLeft > 0 || !this.behaviour || this.released) return false;
    if (this.busy > 0 || this.manual > 0) {
      this.queuedCast = this.ctx.time.now + 1.6;
      return true;
    }
    return this.cast();
  }

  private cast(): boolean {
    this.queuedCast = 0;
    if (!this.behaviour.skill()) return false;
    this.skillLeft = this.skillCooldown;
    this.flashT = 0;
    return true;
  }

  /** 玩家打了这个敌人（武器 / 技能 / 爆炸的直接伤害，不含反应）：记 3 s，优先打它 */
  notePlayerTarget(e: IEnemy): void {
    if (!e.alive) return;
    this.playerTarget = e;
    this.playerTargetUntil = this.ctx.time.now + TARGET_MEMORY;
  }

  // ───────────── 每帧 ─────────────

  update(dt: number): void {
    if (this.released || !(dt > 0)) return;
    const ctx = this.ctx;
    const now = ctx.time.now;
    this.age += dt;
    this.skillLeft = Math.max(0, this.skillLeft - dt);
    this.attackTimer -= dt;
    this.returnCooldown -= dt;
    try {
      this.behaviour.tick(dt);
    } catch (err) {
      console.error('[pets] 被动出错', err);
    }
    if (this.queuedCast > 0 && this.busy === 0 && this.manual === 0) {
      if (now <= this.queuedCast && this.skillLeft <= 0) this.cast();
      this.queuedCast = 0;
    }
    if (this.manual === 0 && this.busy === 0 && ctx.player.alive) this.think(dt);
    else if (this.manual === 0 && !this.def.flying) this.fall(dt);
    this.routines.update(dt);
    if (this.released) return;
    if (this.partShowAt > 0 && now >= this.partShowAt) {
      // 再衔 / 再握一颗：小小一闪冒出来
      this.partShowAt = 0;
      const p = this.model.part;
      if (p && !p.visible) {
        p.visible = true;
        this.host.fx.burst(p.getWorldPosition(_v1), this.def.partGlow, Math.max(0.3, this.size * 0.35), 0.25);
      }
    }
    if (this.target && this.target.alive) this.target.getBodyCenter(this.lookTarget);
    else this.lookTarget.copy(ctx.player.eye);
    this.root.rotation.y = this.yaw;
    this.animate(dt);
  }

  private think(dt: number): void {
    const ctx = this.ctx;
    const ppos = ctx.player.position;
    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0) {
      this.retargetTimer = 0.25;
      this.target = this.pickTarget(ppos);
    } else if (this.target && !this.valid(this.target, ppos)) this.target = null;

    // 归位：离玩家太远 / 卡住
    if (flat(this.position, ppos) > LEASH_RANGE || this.stuckTimer > STUCK_TIME) {
      if (this.returnCooldown <= 0) {
        this.teleport(this.followGoal(this.goalV));
        this.playLocomotion(0.05); // 归位：甩掉没播完的出招动作
      }
      return;
    }
    this.state = this.target ? 'engage' : 'follow';
    const goal = this.followGoal(this.goalV);
    if (this.target) {
      const ep = this.behaviour.engagePoint(this.target);
      if (ep) goal.copy(ep);
    }

    let speed = this.def.moveSpeed;
    const dist = this.def.flying ? this.position.distanceTo(goal) : flat(goal, this.position);
    if (flat(this.position, ppos) > 7) speed *= 1.6; // 落后太多就追
    // 迟滞：离目标点 1.4 m 外才起步，0.6 m 内停下（不在原地抖）
    if (dist > 1.4) this.moving = true;
    else if (dist < 0.6) this.moving = false;
    const before = this.beforeV.copy(this.position);
    if (this.moving) this.moveTowards(goal, speed, dt);
    else this.halt(dt);

    // 卡住检测：想走却几乎不动
    const actual = flat(this.position, before) / dt;
    this.stuckTimer = this.moving && dist > 2 && actual < 0.4 ? this.stuckTimer + dt : 0;

    // 朝向：交战看目标，走路看前进方向，停下时随玩家视线
    const dir = this.tmpV;
    if (this.target && (!this.moving || dist < 3)) this.face(this.target.getBodyCenter(dir).sub(this.position), 540, dt);
    else if (this.moving) this.face(dir.subVectors(this.position, before), 480, dt);
    else this.face(this.ownerForward(dir), 120, dt);

    if (this.target && this.attackTimer <= 0 && this.behaviour.canAttack(this.target)) {
      this.behaviour.attack(this.target);
      this.attackTimer = this.behaviour.attackInterval;
    }
  }

  // ───────────── 目标 ─────────────

  valid(e: IEnemy, ppos: THREE.Vector3): boolean {
    return e.alive && !e.untargetable && flat(e.position, ppos) <= ENGAGE_RANGE;
  }

  /** 玩家最近 3 s 打过的敌人优先；否则离玩家最近、灵宠（或玩家）看得见的 */
  private pickTarget(ppos: THREE.Vector3): IEnemy | null {
    const ctx = this.ctx;
    if (this.playerTarget && ctx.time.now < this.playerTargetUntil && this.valid(this.playerTarget, ppos)) return this.playerTarget;
    let best: IEnemy | null = null, fallback: IEnemy | null = null;
    let bestD = Infinity, fallD = Infinity;
    const eye = ctx.player.eye;
    const c = this.center(_v1);
    for (const e of ctx.enemies.list) {
      if (!this.valid(e, ppos)) continue;
      let d = flat(e.position, ppos);
      if (e === this.target) d -= 2; // 粘住当前目标，免得来回换
      const ec = e.getBodyCenter(_v2);
      if (d < bestD && !ctx.world.segmentBlocked(c, ec)) {
        bestD = d;
        best = e;
      } else if (d < fallD && !ctx.world.segmentBlocked(eye, ec)) {
        fallD = d;
        fallback = e;
      }
    }
    return best ?? fallback;
  }

  // ───────────── 移动 ─────────────

  /** 跟随位：地面 = 玩家身后侧方；飞行 = 肩后上方 */
  followGoal(out: THREE.Vector3): THREE.Vector3 {
    return this.def.flying ? this.flyGoal(out) : this.groundGoal(out);
  }

  private groundGoal(out: THREE.Vector3): THREE.Vector3 {
    const p = this.ctx.player.position;
    const f = this.ownerForward(_v3);
    const rx = -f.z, rz = f.x;
    const s = Math.abs(this.def.followSide) * this.side;
    return out.set(p.x - f.x * this.def.followBack + rx * s, p.y, p.z - f.z * this.def.followBack + rz * s);
  }

  private flyGoal(out: THREE.Vector3): THREE.Vector3 {
    const p = this.ctx.player.position;
    const f = this.ownerForward(_v3);
    const rx = -f.z, rz = f.x;
    const s = Math.abs(this.def.followSide) * this.side;
    return out.set(p.x - f.x * 1.3 + rx * s, p.y + this.def.flyHeight + Math.sin(this.age * 0.9) * 0.15, p.z - f.z * 1.3 + rz * s);
  }

  private moveTowards(goal: THREE.Vector3, speed: number, dt: number): void {
    if (this.def.flying) {
      this.flyTowards(goal, speed, dt);
      return;
    }
    // 导航：目标挪了 0.6 m 以上或每 0.25 s 重新算；直线可走就直走（NavMeshAgent 的路径在开阔地上也是直线）
    this.repath -= dt;
    if (this.repath <= 0 || this.lastGoal.distanceToSquared(goal) > 0.36) {
      this.repath = 0.25;
      this.lastGoal.copy(goal);
      this.path.length = 0;
      this.pathIndex = 0;
      if (!this.directClear(goal)) {
        const out: THREE.Vector3[] = [];
        if (this.ctx.nav.findPath(this.position, goal, out) && out.length > 0) for (const p of out) this.path.push(p.clone());
      }
    }
    let wp: THREE.Vector3 = goal;
    while (this.pathIndex < this.path.length) {
      const p = this.path[this.pathIndex];
      if (this.pathIndex < this.path.length - 1 && flat(p, this.position) < 0.6) this.pathIndex++;
      else {
        wp = p;
        break;
      }
    }
    const dx = wp.x - this.position.x, dz = wp.z - this.position.z;
    const d = flatLen(dx, dz);
    const last = wp === goal || this.pathIndex >= this.path.length - 1;
    // 停止距离 0.35 m、到点前减速（autoBraking）
    let want = speed;
    if (last) want = d <= 0.35 ? 0 : Math.min(speed, Math.sqrt(2 * 40 * Math.max(0, d - 0.35)));
    const tx = d > 1e-4 ? (dx / d) * want : 0, tz = d > 1e-4 ? (dz / d) * want : 0;
    this.integrate(tx, tz, dt);
  }

  private halt(dt: number): void {
    if (this.def.flying) {
      // 悬停时也轻轻贴着跟随位
      const k = 20 * dt;
      const l = this.flyVel.length();
      if (l <= k) this.flyVel.set(0, 0, 0);
      else this.flyVel.multiplyScalar((l - k) / l);
      this.position.addScaledVector(this.flyVel, dt);
      return;
    }
    this.integrate(0, 0, dt);
  }

  /** 地面：加速度 40 朝期望速度、重力、ctx.world.moveBody（墙、台阶 0.45 m、下台阶贴地） */
  private integrate(tx: number, tz: number, dt: number): void {
    const v = this.vel;
    const dx = tx - v.x, dz = tz - v.z;
    const len = Math.hypot(dx, dz), step = 40 * dt;
    if (len <= step) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (dx / len) * step;
      v.z += (dz / len) * step;
    }
    v.y -= 26 * dt;
    _v1.copy(v).multiplyScalar(dt);
    const halfW = clamp(this.def.height * 0.35, 0.2, 0.45) * 0.85;
    const r = this.ctx.world.moveBody(this.position, halfW, Math.max(0.5, this.def.height), _v1, this.onGround, 0.45, this.moveResult);
    this.onGround = r.onGround;
    if (r.onGround && v.y < 0) v.y = 0;
    if (r.hitCeiling && v.y > 0) v.y = 0;
  }

  /** 冲刺 / 动作期间（脚本接管位置之外）：地面宠物照样受重力 */
  private fall(dt: number): void {
    this.vel.x = this.vel.z = 0;
    this.integrate(0, 0, dt);
  }

  /** 膝盖 / 腰两条中线都不挡：直线可走 */
  private directClear(goal: THREE.Vector3): boolean {
    const w = this.ctx.world;
    const knee = this.position.y + 0.4;
    _v1.set(this.position.x, knee, this.position.z);
    _v2.set(goal.x, Math.max(knee, goal.y + 0.4), goal.z);
    if (w.segmentBlocked(_v1, _v2)) return false;
    _v1.y += 0.5;
    _v2.y += 0.5;
    return !w.segmentBlocked(_v1, _v2);
  }

  /** 飞行：朝目标插值，前方有墙就先抬高越过去；离地不低于 0.6 m */
  private flyTowards(goalIn: THREE.Vector3, speed: number, dt: number): void {
    const pos = this.position;
    const goal = _v2.copy(goalIn);
    const ctx = this.ctx;
    _v1.subVectors(goal, pos);
    const span = _v1.length();
    if (span > 1e-3 && ctx.world.raycast(pos, _v1.divideScalar(span), span, _hit)) {
      const dir = _v3.set(goal.x - pos.x, 0, goal.z - pos.z);
      if (dir.lengthSq() > 1e-4) dir.normalize();
      else dir.set(0, 0, 1);
      const px = _hit.point.x + dir.x * 0.5, pz = _hit.point.z + dir.z * 0.5;
      const g = ctx.world.groundHeight(px, pz, _hit.point.y + 30);
      const top = g > -Infinity ? g : _hit.point.y + 3;
      goal.set(pos.x + dir.x * 0.4, top + 1.5, pos.z + dir.z * 0.4);
    }
    _v1.subVectors(goal, pos);
    const d = _v1.length();
    if (d > 0.05) _v1.multiplyScalar(Math.min(speed, d * 2.5) / d);
    else _v1.set(0, 0, 0);
    // MoveTowards(flyVel, want, 30 dt)
    _v3.subVectors(_v1, this.flyVel);
    const l = _v3.length(), k = 30 * dt;
    if (l <= k) this.flyVel.copy(_v1);
    else this.flyVel.addScaledVector(_v3, k / l);
    pos.addScaledVector(this.flyVel, dt);
    const ground = groundY(ctx, pos);
    if (pos.y < ground + 0.6) pos.y = moveToward(pos.y, ground + 0.6, 8 * dt);
  }

  private face(dir: THREE.Vector3, rateDeg: number, dt: number): void {
    if (dir.x * dir.x + dir.z * dir.z < 1e-4) return;
    const want = Math.atan2(dir.x, dir.z);
    const d = deltaAngle(this.yaw, want);
    const step = rateDeg * Math.PI / 180 * dt;
    this.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
  }

  /** 贴地（出生 / 瞬移后） */
  private snapToGround(): void {
    const g = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 1.5);
    if (g > -Infinity) this.position.y = g;
    this.onGround = true;
    this.vel.set(0, 0, 0);
  }

  /** 灵火一闪：原地光晕 → 瞬移 → 落点光晕 + 小弹出 */
  teleport(toIn: THREE.Vector3): void {
    const ctx = this.ctx;
    const rc = this.def.rarityColor;
    const to = toIn.clone();
    this.host.fx.burst(this.center(), rc, 1.5 + this.size, 0.4);
    this.position.copy(to);
    if (this.def.flying) this.position.y = Math.max(to.y, groundY(ctx, to) + 0.6);
    else this.snapToGround();
    this.flyVel.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.lastPos.copy(this.position);
    this.stuckTimer = 0;
    this.returnCooldown = 1;
    this.moving = false;
    this.path.length = 0;
    this.lastGoal.set(Infinity, 0, 0);
    this.state = 'return';
    this.host.fx.burst(_v1.copy(this.position).addScaledVector(_up, this.height * 0.5), rc, 1.8 + this.size, 0.5);
    ctx.fx.impact(_v1.copy(this.position).addScaledVector(_up, 0.2), _up, rgbHex(rc), 1);
    this.popT = 0.2;
    this.speedSm = 0;
    this.model.clips?.anim?.locomotion.teleported();
  }

  /**
   * 冲刺（冲撞、扑击、穿刺）：脚本接管位置，按 speed 冲向 dest，撞墙停下；每步回调 (上一点, 这一点) 做路径判定。
   * 用法：在 act 的生成器里 yield this.dashTo(...)
   */
  *dashTo(dest: THREE.Vector3, speed: number, onStep: ((a: THREE.Vector3, b: THREE.Vector3) => void) | null = null, maxTime = 1.5): RoutineGen {
    this.manual++;
    const target = dest.clone();
    let t = 0;
    const a = new THREE.Vector3(), step = new THREE.Vector3();
    try {
      // 第一步在开协程的这一帧（dt = 0 时只判定不走）
      let dt: number = yield null;
      while (t < maxTime) {
        dt = Math.max(0, dt);
        t += dt;
        const pos = this.position;
        step.subVectors(target, pos);
        if (!this.def.flying) step.y = 0;
        const d = step.length();
        if (d < 0.05) break;
        step.multiplyScalar(Math.min(d, speed * dt) / d);
        const sl = step.length();
        if (sl > 1e-6) {
          if (!this.def.flying) {
            _v1.set(pos.x, pos.y + 0.4, pos.z);
            _v2.copy(step).divideScalar(sl);
            if (this.ctx.world.raycast(_v1, _v2, sl + 0.3, _hit) && _hit.normal.y < 0.5) break;
          }
          a.copy(pos);
          pos.add(step);
          if (!this.def.flying) pos.y = groundY(this.ctx, _v1.set(pos.x, a.y + 0.6, pos.z));
          this.face(step, 1440, dt);
          onStep?.(a, pos);
        }
        dt = yield null;
      }
    } finally {
      this.manual--;
      this.lastPos.copy(this.position);
      this.vel.set(0, 0, 0);
      this.path.length = 0;
      this.lastGoal.set(Infinity, 0, 0);
    }
  }

  /** 做一个动作（冲撞、连抓、灵技演出）：期间不跟随、不普攻 */
  act(routine: RoutineGen): void {
    const self = this;
    function* wrap(): RoutineGen {
      self.busy++;
      try {
        yield routine;
      } finally {
        self.busy--;
      }
    }
    this.routines.start(wrap());
  }

  /** 开一条不占动作的协程（白泽 / 重明鸟的连锁、应龙的雷暴） */
  run(routine: RoutineGen): void {
    this.routines.start(routine);
  }

  // ───────────── 程序动画 ─────────────

  private animate(dt: number): void {
    const pos = this.position;
    const vx = (pos.x - this.lastPos.x) / dt, vz = (pos.z - this.lastPos.z) / dt;
    this.lastPos.copy(pos);
    let fl = Math.hypot(vx, vz);
    if (fl > 40) fl = 0; // 瞬移那一帧
    this.speedSm += (fl - this.speedSm) * (1 - Math.exp(-10 * dt));
    const yawRate = deltaAngle(this.lastYaw, this.yaw) / dt;
    this.lastYaw = this.yaw;
    const rigged = this.rigged;
    // 骨骼动画：步态速度由这里喂（冲刺照常读成快跑，CreatureLocomotion 自己的 20 m/s 瞬移过滤不再生效）
    const loco = this.model.clips?.anim?.locomotion;
    if (rigged && loco) loco.speedOverride = this.speedSm;
    // Unity 偏航正 = 右转；网页 yaw 正 = 左转（从上往下看逆时针）：倾斜公式里换号
    const bankTarget = clamp(yawRate * 180 / Math.PI * 0.05, -25, 25) * (this.def.flying ? 1 : rigged ? 0 : 0.35);
    this.bank += (bankTarget - this.bank) * (1 - Math.exp(-6 * dt));

    const h = this.height;
    const move = clamp01(this.speedSm / 3.5);
    const breath = rigged ? 1 : 1 + Math.sin(this.age * 2.4) * 0.025;
    let oy = this.def.hover, ox = 0, oz = 0;
    let pitch = 0;
    if (this.def.flying) {
      oy += Math.sin(this.age * 2.2) * 0.08 * Math.max(0.5, h);
      if (!rigged) pitch = clamp(this.speedSm * 1.2, 0, 14);
    } else {
      if (!rigged) {
        // 跳步：步频跟速度走，个子越小步子越快（骨骼动画灵宠有真正的步态）
        this.hopPhase += dt * this.speedSm * clamp(2.4 / Math.max(0.3, h), 2, 7);
        oy += Math.abs(Math.sin(this.hopPhase)) * move * h * 0.12;
        pitch = Math.sin(this.hopPhase * 2) * 4 * move;
      }
      if (this.def.hover > 0) oy += Math.sin(this.age * 1.8) * 0.05;
    }
    // 攻击前冲 + 挤压拉伸（骨骼动画：只留缩小后的前冲，不做非等比缩放）
    let stretch = 1;
    if (this.lungeT >= 0) {
      this.lungeT += dt;
      const k = clamp01(this.lungeT / this.lungeDur);
      const s = Math.sin(k * Math.PI);
      // 世界方向 → 本体局部（绕 Y 转 −yaw）
      const c = Math.cos(-this.yaw), sn = Math.sin(-this.yaw);
      const lx = this.lungeDir.x * c + this.lungeDir.z * sn, lz = -this.lungeDir.x * sn + this.lungeDir.z * c;
      ox += lx * s * this.lungeDist;
      oy += this.lungeDir.y * s * this.lungeDist;
      oz += lz * s * this.lungeDist;
      if (!rigged) stretch = 1 + s * 0.22;
      if (k >= 1) this.lungeT = -1;
    }
    // 出场弹出 / 升级闪光
    let pop = 1;
    if (this.popT >= 0) {
      this.popT += dt;
      pop = this.popT < 0.45 ? easeOutBack(this.popT / 0.45) : 1;
      if (this.popT >= 0.45) this.popT = -1;
    }
    if (this.flashT >= 0) {
      this.flashT += dt;
      pop *= 1 + Math.sin(clamp01(this.flashT / 0.5) * Math.PI) * 0.25;
      if (this.flashT >= 0.5) this.flashT = -1;
    }
    this.visual.position.set(ox, oy, oz);
    // 俯仰（正 = 低头，Unity Euler x）、侧倾（Unity z 正 = 左倾；网页镜像后取反）
    this.visual.rotation.set(pitch * Math.PI / 180, 0, -this.bank * Math.PI / 180, 'YXZ');
    const thin = 1 / Math.sqrt(stretch);
    const p = Math.max(0.01, pop);
    if (rigged) this.visual.scale.setScalar(p);
    else this.visual.scale.set(p * thin, p * breath * thin, p * stretch / Math.sqrt(breath));
    if (this.aura) this.aura.scale.setScalar(Math.max(0.8, this.size * 1.6) * (1 + Math.sin(this.age * 3) * 0.08));

    // 扇翅（飞得越快扇得越快）、甩尾、龙身波动：只有占位体有这些部件；网页镜像：绕 Y / Z 取反、x 偏移取反
    const flap = Math.sin(this.age * (8 + this.speedSm * 0.8)) * 38 * Math.PI / 180;
    for (const w of this.model.wings) w.t.rotation.set(0, 0, -w.sign * flap);
    const whip = this.whipT >= 0;
    if (whip) {
      this.whipT += dt;
      if (this.whipT > 0.5) this.whipT = -1;
    }
    this.model.tails.forEach((tl, i) => {
      const sway = (whip ? Math.sin(this.age * 40 + i * 1.7) * 40 : Math.sin(this.age * 3 + i * 1.3) * (8 + move * 10)) * Math.PI / 180;
      tl.t.quaternion.copy(tl.rest).multiply(_q.setFromEuler(_e.set(whip ? sway : 0, -sway, 0, 'YXZ')));
    });
    this.model.spine.forEach((sp, i) => {
      sp.t.position.set(sp.rest.x - Math.sin(this.age * 3.2 - i * 0.7) * 0.06, sp.rest.y + Math.sin(this.age * 2.4 - i * 0.5) * 0.03, sp.rest.z);
    });
    this.model.clips?.update(dt);
    this.model.partGlow?.update(this.ctx.time.now);
  }

  /**
   * 攻击前冲：沿 dir 冲出 dist 米再收回（dur 秒），带挤压拉伸。骨骼动画灵宠的动作本身有前冲，这里只叠约三分之一、不拉伸
   */
  lunge(dir: THREE.Vector3, dist = 0.35, dur = 0.22): void {
    if (dir.lengthSq() > 1e-8) this.lungeDir.copy(dir).normalize();
    else this.forward(this.lungeDir);
    this.lungeDist = dist * Math.max(0.6, this.height) * (this.rigged ? 0.35 : 1);
    this.lungeDur = dur;
    this.lungeT = 0;
  }

  /** 尾巴连抽（狰、讙）：占位体的程序甩尾；骨骼动画灵宠由动作片段 + 尾巴弹簧骨负责 */
  whipTails(): void {
    this.whipT = 0;
  }

  // ───────────── 骨骼动画 ─────────────

  /**
   * 播一个动作（状态名见 docs/pet-system.md 7.3，如 chargeWindup、claw、breathe）。骨骼动画灵宠按状态名淡入：
   *   seconds > 0：用 ActScale 把片段拉伸到 seconds 播完（0.4–2.5 倍），让动作和玩法计时对上；
   *   同一个状态正在播、还没到 90%：不重新淡入（狻猊 / 应龙 0.2–0.25 秒出手一次），给了 seconds 就按剩余时长重新对时；
   *   restart = 每次都从头播（讙的连爪、狰的连抽）；priority（灵技、怒吼）：播完之前普通出手的动作不打断它。
   * 返回 false = 播不了（占位体 / 片段没读好 / 没有这个状态）；调用方照常叠程序动作（lunge / whipTails）。
   */
  playAct(state: string, seconds = 0, priority = false, restart = false, fade = 0.08): boolean {
    const clips = this.model.clips;
    const anim = clips?.anim;
    if (!clips || !anim || !clips.ready || !state || !clips.has(state)) return false;
    const now = this.ctx.time.now;
    if (!priority && now < this.actLockUntil) return true;
    const len = clips.clipLength(state);
    const cur = anim.animator.currentState(0);
    if (!restart && cur && cur.name === state && cur.normalizedTime < 0.9) {
      const left = len * (1 - cur.normalizedTime);
      if (seconds > 0.05 && len > 0) this.setActScale(clamp(left / seconds, 0.4, 2.5));
      if (priority) this.actLockUntil = now + (len > 0 ? left / this.actScale : 0.3);
      return true;
    }
    const scale = len > 0 && seconds > 0.05 ? clamp(len / seconds, 0.4, 2.5) : 1;
    if (seconds > 0.05 && len > 0) clips.playTimed(state, seconds, fade);
    else clips.play(state, fade);
    this.actScale = scale;
    if (priority) this.actLockUntil = now + (len > 0 ? len / scale : 0.5);
    return true;
  }

  /** 回到移动混合树，打断正在播的动作 */
  playLocomotion(fade = 0.15): void {
    const clips = this.model.clips;
    if (!clips?.ready) return;
    this.actLockUntil = 0;
    this.setActScale(1);
    clips.play('Locomotion', fade);
  }

  private setActScale(k: number): void {
    this.actScale = k;
    const a = this.model.clips?.anim?.animator;
    if (a?.hasParameter('ActScale')) a.setFloat('ActScale', k);
  }

  // ───────────── 攻击工具 ─────────────

  /** 到目标身体（竖直胶囊）表面的距离（大个子敌人近战也够得着） */
  distTo(e: IEnemy | null): number {
    if (!e) return Infinity;
    const c = this.center(_v1);
    const lo = e.position.y + Math.min(e.radius, e.height * 0.5);
    const hi = Math.max(lo, e.position.y + e.height - e.radius);
    const y = clamp(c.y, lo, hi);
    return Math.max(0, Math.hypot(c.x - e.position.x, c.y - y, c.z - e.position.z) - e.radius);
  }

  sees(e: IEnemy): boolean {
    return !this.ctx.world.segmentBlocked(this.mouth(_v1), e.getBodyCenter(_v2));
  }

  /** 灵宠伤害请求：数值 × 灵契倍率，来源 pet（PetContract.petHit 的字段） */
  info(amount: number, element: Element, statusChance: number, depth = 0): DamageRequest {
    return {
      base: amount * this.damageMult, element, source: 'pet', elementChance: statusChance, canCrit: false,
      tags: [PET_TAG], procDepth: depth,
    };
  }

  hit(target: IEnemy | null, amount: number, opts: { element?: Element; statusChance?: number; knockback?: number; forceCrit?: boolean; from?: THREE.Vector3; depth?: number } = {}) {
    if (!target || !target.alive) return null;
    const c = target.getBodyCenter(new THREE.Vector3());
    const o = opts.from ?? this.center(_v3);
    const req = this.info(amount, opts.element ?? 'none', opts.statusChance ?? 0, opts.depth ?? 0);
    req.point = c;
    req.direction = new THREE.Vector3().subVectors(c, o).normalize();
    if (opts.knockback) req.knockback = opts.knockback;
    if (opts.forceCrit) req.forceCrit = true;
    return this.ctx.combat.damageEnemy(target, req);
  }

  /** 范围伤害：墙后不受伤，中心 100% → 边缘 edge（不播爆炸特效，特效由调用方给） */
  aoe(center: THREE.Vector3, radius: number, amount: number, element: Element = 'none', statusChance = 0, edge = 0.5): number {
    return this.ctx.combat.explode(center, radius, this.info(amount, element, statusChance), { noFx: true, falloff: edge });
  }

  /** center 周围 radius 内活着、可选中的敌人（按距离排序） */
  enemiesNear(center: THREE.Vector3, radius: number): IEnemy[] {
    const found = this.ctx.enemies.queryRadius(center, radius, _queryOut);
    const list = found.filter((e) => e.alive && !e.untargetable);
    _queryOut.length = 0;
    const d = new Map<IEnemy, number>();
    for (const e of list) d.set(e, e.getBodyCenter(_v1).distanceTo(center));
    return list.sort((a, b) => d.get(a)! - d.get(b)!);
  }

  /** 玩家准星指着的敌人（range 内，被地形挡住就没有） */
  aimedEnemy(range: number): IEnemy | null {
    const ctx = this.ctx;
    const eye = ctx.player.eye;
    const dir = ctx.player.getAimDirection(_v1);
    const hit = ctx.enemies.raycast(eye, dir, range);
    if (!hit) return null;
    if (ctx.world.raycast(eye, dir, hit.distance, _hit)) return null;
    return hit.enemy;
  }

  /** 准星落点（打到地形 / 敌人，否则 range 米外） */
  aimPoint(range: number, out = new THREE.Vector3()): THREE.Vector3 {
    const ctx = this.ctx;
    const eye = ctx.player.eye;
    const dir = ctx.player.getAimDirection(_v1);
    let best = range;
    const e = ctx.enemies.raycast(eye, dir, range);
    if (e) best = e.distance;
    if (ctx.world.raycast(eye, dir, best, _hit)) best = _hit.distance;
    return out.copy(eye).addScaledVector(dir, best);
  }

  /** 头顶浮字（灵契升级、学舌、怒吼） */
  say(text: string, c: RGB, scale = 1.1): void {
    this.host.floatText(_v1.copy(this.position).addScaledVector(_up, this.height + this.def.hover + 0.45), text, c, scale);
  }
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** 地面高度（从 p 上方 3 m 往下找）；没有地面返回 p.y */
export function groundY(ctx: GameContext, p: THREE.Vector3): number {
  const g = ctx.world.groundHeight(p.x, p.z, p.y + 3);
  return g > -Infinity ? g : p.y;
}

function moveToward(a: number, b: number, step: number): number {
  return Math.abs(b - a) <= step ? b : a + Math.sign(b - a) * step;
}
