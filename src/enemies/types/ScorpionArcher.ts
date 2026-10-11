/**
 * 蝎尾弩卫（scorpion_archer，第一章 · 赤沙古道的远程怪）：上身是戴金币面纱的女射手，下身是巨蝎，蜷起的尾巴尖上长着一具铜弩。
 * 保持 12–22 米，蝎子式横向疾走。弱点是尾弩根部发光的毒囊（头部判定，在她头顶后上方，要抬枪瞄）。
 *
 * - 尾弩三连射：尾巴后收上弦 0.6 秒（毒囊亮起、弩尖金光一闪），连射三支金色弩矢（精英五支扇形）。
 * - 钻沙：玩家逼近到 7 米内时潜入沙中（不可选中，地面拖出一道沙浪），从玩家 13–20 米外、看得见玩家的地方钻出，
 *   钻出后立刻快速上弦再射一轮（伏击）。玩家站在钻出点附近会被掀起的沙石伤到。
 * - 钳击：钻沙冷却中被贴身时，张开巨钳 0.35 秒后夹击。
 *
 * 状态机：move → aim → fire → recover → move
 *         move → dive → tunnel → emerge → aim（伏击）
 *         move → snapWindup → snap → recover → move
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp, clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { Geo, flat, joint, part } from '../Models';

export const SCORPION_ARCHER_DEF: ScaledEnemyDef = {
  id: 'scorpion_archer',
  name: '蝎尾弩卫',
  // 基础缩放：下面的尺寸都是美术 2 米版的数值，游戏里放大 1.8 倍（尾弩顶 3.6 米、毒囊约 2.5 米、蝎身约 2.9 米长）；
  // 模型、碰撞半径、身高、弱点判定和按 sizeScale 缩放的特效一起放大
  scale: 1.8,
  hp: 120,
  speed: 3.4,
  radius: 0.85,
  // 尾弩顶离地约 2.0
  height: 2.0,
  damage: 11,
  coins: [2, 4],
  essence: 1,
  // 弱点 = 尾巴弧顶的毒囊（囊心离地约 1.6，在她头部后上方约 0.8 米）；判定球跟着尾巴移动
  headY: 1.6,
  headRadius: 0.22,
  knockbackResist: 0.5,
  color: 0xffd27a,
};

const MIN_RANGE = 12;
const MAX_RANGE = 22;
const AIM_TIME = 0.6;
/** 钻出后的伏击上弦（更短） */
const AMBUSH_AIM_TIME = 0.42;
const SHOTS = 3;
const ELITE_SHOTS = 5;
const SHOT_GAP = 0.16;
const BOLT_SPEED = 30;
/** 玩家逼近到这个距离内就钻沙 */
const BURROW_TRIGGER = 7;
const DIVE_TIME = 0.55;
const TUNNEL_SPEED = 10;
const TUNNEL_MAX = 2.6;
const EMERGE_TIME = 0.5;
const EMERGE_RADIUS = 1.5;
/** 钻沙时身体沉入地面的深度（米，按体型缩放） */
const SINK_DEPTH = 1.25;
/** 钳击距离 / 钻出掀沙半径（美术 2 米版的数值，按 sizeScale 放大） */
const SNAP_RANGE = 1.8;
const SNAP_WINDUP = 0.35;
const SNAP_DAMAGE_MULT = 1.4;
/** 美术 crossbow 骨骼长度（米，art/pipeline/creature_rigs/SK_Enemy_ScorpionArcher.json） */
const CROSSBOW_LENGTH = 0.8;
/** 美术绑定姿势里脚尖离地的高度（米）：资产按拄地的钳尖落地，八只脚尖高 10–13 厘米（智能网格版实测） */
const ART_FOOT_LIFT = 0.1;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

const C = {
  shell: 0x8a2e2a, shellDark: 0x5a1c1c, gold: 0xc79a3a, skin: 0xc68a5e, cloth: 0xb8463a,
  veil: 0xa83a32, teal: 0x3f9a8e, linen: 0xe8dcc0, bronze: 0x9a7a3a,
  sac: 0xd8a040, sacHot: 0xfff0c0, eye: 0xffd27a, eyeHot: 0xfff6d8,
};

/** 程序化尾巴各节（从腹末开始，相对上一节的 y / z 偏移）：先向后上方翘起，再向前弯到头顶后上方 */
const TAIL: readonly [number, number][] = [[0.23, -0.23], [0.32, -0.07], [0.28, 0.16], [0.17, 0.28], [0.08, 0.32], [0.04, 0.32]];

const _v = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _exit = new THREE.Vector3();
const _eye = new THREE.Vector3();

interface Leg {
  pivot: THREE.Group;
  side: number;
  /** 三角步态分组：0 = 左1 右2 左3 右4，1 = 另一组 */
  group: number;
  index: number;
}

export class ScorpionArcher extends StandardEnemy {
  protected host!: THREE.Group;
  protected torso!: THREE.Group;
  protected headJoint!: THREE.Group;
  protected aimArm!: THREE.Group;
  private readonly tail: THREE.Group[] = [];
  private crossbow!: THREE.Group;
  private sacMesh!: THREE.Mesh;
  private readonly claws: { arm: THREE.Group; jaw: THREE.Group; side: number }[] = [];
  private readonly legs: Leg[] = [];
  private readonly eyeGlows: THREE.Mesh[] = [];

  private aimTime = AIM_TIME;
  private shots = 0;
  private shotTimer = 0;
  private recoil = 0;
  private recoverTime = 0.35;
  private burrowCd: number;
  /** 0 = 在地面上，1 = 完全潜入沙中 */
  private sink = 0;
  private tunnelDust = 0;
  private readonly tunnelTarget = new THREE.Vector3();
  private snapHit = false;
  private ambush = false;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, SCORPION_ARCHER_DEF, opts);
    this.walkScale = 1;
    this.stepRate = 2.4;
    this.accel = 14;
    this.burrowCd = ctx.rng.range(2, 4);
  }

  /** 潜在沙里时不可选中（射线 / 范围 / 伤害全部忽略） */
  get untargetable(): boolean {
    return this.state === 'tunnel' || (this.state === 'dive' && this.sink > 0.6) || (this.state === 'emerge' && this.sink > 0.6);
  }

  protected override afterInit(): void {
    if (this.hasArtBody) this.glowsAsOverlay();
    const sacBone = this.nativeBody?.pose.bone('sac');
    if (sacBone) {
      // 原生骨架：弱点判定跟着美术的毒囊骨骼；有发光壳时收起白模的发光球
      sacBone.add(this.sacMesh);
      this.sacMesh.position.set(0, 0, 0);
      this.setHeadAnchor(sacBone, 0, 0, 0);
      if (this.nativeBody?.glowShell) this.sacMesh.visible = false;
      // 美术的眼睛本身画成发光的；白模的眼睛发光点对不上，收起
      for (const g of this.eyeGlows) g.visible = false;
    }
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    this.host = root;
    const shell = flat(C.shell), dark = flat(C.shellDark), gold = flat(C.gold, { metal: 0.6, rough: 0.4 });
    const skin = flat(C.skin), cloth = flat(C.cloth), veil = flat(C.veil), teal = flat(C.teal), linen = flat(C.linen);

    // 蝎身：头胸甲 + 三节腹甲，沿 -Z 向后变窄
    const body = joint(root, 0, 0.55, 0);
    const pro = part(body, Geo.box(0.95, 0.42, 0.85), shell, 0, 0, 0.25);
    pro.scale.set(1, 1, 1);
    part(body, Geo.box(0.7, 0.08, 0.6), gold, 0, 0.23, 0.25);
    for (const [i, [w, z]] of [[0.9, -0.3], [0.78, -0.72], [0.62, -1.08]].entries()) {
      part(body, Geo.box(w, 0.38 - i * 0.04, 0.42), i % 2 ? dark : shell, 0, 0.02, z);
      part(body, Geo.box(w * 0.9, 0.05, 0.08), gold, 0, 0.22 - i * 0.02, z + 0.18);
    }

    // 八条腿：从头胸甲两侧伸出，向外再向下着地（三角步态两组交替）
    const legZ = [0.45, 0.2, -0.08, -0.36];
    for (const s of [1, -1]) {
      legZ.forEach((z, i) => {
        const pivot = joint(body, s * 0.42, 0.02, z);
        part(pivot, Geo.box(0.5, 0.11, 0.11), shell, s * 0.25, 0.12, 0, 0, 0, s * 0.45);
        part(pivot, Geo.box(0.12, 0.8, 0.12, 'top'), dark, s * 0.5, 0.3, 0, 0, 0, s * 0.2);
        part(pivot, Geo.cone(0.06, 0.16, 5), gold, s * 0.66, -0.49, 0, Math.PI, 0, 0);
        const group = (i + (s > 0 ? 0 : 1)) % 2;
        this.legs.push({ pivot, side: s, group, index: i });
      });
    }

    // 两只巨钳：从头胸甲前方向外前伸，钳口可开合
    for (const s of [1, -1]) {
      const arm = joint(body, s * 0.38, -0.02, 0.62);
      part(arm, Geo.box(0.16, 0.16, 0.5, 'bottom'), shell, s * 0.12, 0, 0.2, Math.PI / 2, s * 0.5, 0);
      const claw = joint(arm, s * 0.32, -0.12, 0.62);
      part(claw, Geo.box(0.32, 0.22, 0.42), shell, 0, 0, 0.12);
      part(claw, Geo.box(0.26, 0.08, 0.04), gold, 0, 0.11, 0.06);
      part(claw, Geo.cone(0.09, 0.42, 5), dark, -s * 0.06, 0, 0.5, Math.PI / 2, 0, 0);
      const jaw = joint(claw, s * 0.1, 0, 0.3);
      part(jaw, Geo.cone(0.07, 0.36, 5), dark, 0, 0, 0.16, Math.PI / 2, 0, 0);
      this.claws.push({ arm, jaw, side: s });
    }

    // 上身：腰带与垂片，女射手的躯干、手臂与戴金币面纱的头
    const torso = joint(body, 0, 0.22, 0.45);
    this.torso = torso;
    part(torso, Geo.cyl(0.26, 0.3, 0.18, 8, 'bottom'), gold, 0, 0, 0);
    part(torso, Geo.box(0.22, 0.42, 0.05, 'top'), cloth, 0, 0.05, 0.27);
    part(torso, Geo.box(0.12, 0.36, 0.04, 'top'), teal, 0.16, 0.04, 0.24, 0, 0, -0.2);
    part(torso, Geo.cyl(0.18, 0.22, 0.32, 8, 'bottom'), skin, 0, 0.16, 0);
    part(torso, Geo.cyl(0.22, 0.2, 0.22, 8, 'bottom'), linen, 0, 0.42, 0);
    for (const s of [1, -1]) {
      const sh = joint(torso, s * 0.24, 0.58, 0);
      if (s < 0) this.aimArm = sh;
      part(sh, Geo.cyl(0.055, 0.05, 0.34, 6, 'top'), skin, 0, 0, 0, 0, 0, s * 0.42);
      part(sh, Geo.cyl(0.065, 0.065, 0.1, 6), gold, s * 0.11, -0.22, 0, 0, 0, s * 0.42);
      part(sh, Geo.cyl(0.05, 0.042, 0.3, 6, 'top'), skin, s * 0.14, -0.3, 0, 0, 0, s * 0.3);
      part(sh, Geo.box(0.07, 0.11, 0.035), skin, s * 0.23, -0.6, 0);
    }
    const head = joint(torso, 0, 0.7, 0);
    this.headJoint = head;
    part(head, Geo.ico(0.15, 1), skin, 0, 0.12, 0);
    part(head, Geo.cone(0.22, 0.42, 7), veil, 0, 0.2, -0.04);
    part(head, Geo.box(0.22, 0.14, 0.04), veil, 0, 0.06, 0.13);
    part(head, Geo.box(0.24, 0.03, 0.03), gold, 0, 0.18, 0.15);
    for (const s of [1, -1]) this.eyeGlows.push(this.glowPart(head, Geo.ico(0.026, 0), C.eye, C.eyeHot, s * 0.055, 0.15, 0.15, 0));
    // 头巾后摆
    part(head, Geo.box(0.26, 0.5, 0.04, 'top'), veil, 0, 0.12, -0.16, 0.25, 0, 0);

    // 尾巴：一串节点，尖端是铜弩与毒囊（弱点）
    let parent: THREE.Group = joint(body, 0, 0.05, -1.3);
    this.tail.push(parent);
    for (const [i, [dy, dz]] of TAIL.entries()) {
      const len = Math.hypot(dy, dz);
      const seg = part(parent, Geo.box(0.34 - i * 0.03, 0.26 - i * 0.02, len + 0.04), i % 2 ? dark : shell, 0, dy / 2, dz / 2);
      seg.rotation.x = -Math.atan2(dy, dz);
      part(parent, Geo.box(0.36 - i * 0.03, 0.04, 0.06), gold, 0, dy * 0.9, dz * 0.9);
      parent = joint(parent, 0, dy, dz);
      this.tail.push(parent);
    }
    const tip = parent;
    this.sacMesh = this.glowPart(tip, Geo.ico(0.2, 1), C.sac, C.sacHot, 0, 0.04, 0.12, 1);
    this.setHeadAnchor(tip, 0, 0.04, 0.12);
    const bow = joint(tip, 0, 0.1, 0.3);
    this.crossbow = bow;
    const bronze = flat(C.bronze, { metal: 0.6, rough: 0.45 });
    part(bow, Geo.box(0.1, 0.1, 0.5), bronze, 0, 0, 0.12);
    part(bow, Geo.box(0.9, 0.05, 0.06), bronze, 0, 0.02, 0.3);
    for (const s of [1, -1]) part(bow, Geo.box(0.22, 0.04, 0.05), gold, s * 0.42, 0.02, 0.24, 0, s * 0.5, 0);
    return root;
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    if (this.burrowCd > 0) this.burrowCd -= dt;
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[1] = 0.25 + 0.1 * Math.sin(this.age * 2.6);
        if (this.burrowCd <= 0 && d < BURROW_TRIGGER && this.findExit(_exit)) {
          this.tunnelTarget.copy(_exit);
          this.setState('dive');
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.55, pitch: 0.7 });
          break;
        }
        if (d < SNAP_RANGE * this.sizeScale && this.cooldown <= 0.6 && this.requestAttack('melee', SNAP_WINDUP + 0.6)) {
          this.snapHit = false;
          this.setState('snapWindup');
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.6, pitch: 1.3 });
          break;
        }
        if (!this.sees && this.seekSight(MIN_RANGE - 2, MAX_RANGE, this.speed)) {
          this.faceMovement(5, dt);
          break;
        }
        // 蝎子式横走：横移比例大，正面始终对着玩家
        this.keepRange(MIN_RANGE, MAX_RANGE, d < MIN_RANGE ? this.speed * 1.3 : this.speed, 0.8);
        this.facePlayer(3.5, dt);
        if (this.cooldown <= 0 && this.sees && d <= MAX_RANGE + 8) this.beginAim(AIM_TIME);
        break;
      }
      case 'aim': {
        // 上弦：几乎站定，毒囊越来越亮，最后 0.15 秒弩尖金光一闪
        this.setMove(-Math.cos(this.facing) * this.strafeSign, Math.sin(this.facing) * this.strafeSign, this.speed * 0.15);
        this.facePlayer(5, dt);
        const t = clamp01(this.stateTime / this.aimTime);
        this.glowTarget[1] = 0.35 + 0.65 * t;
        if (this.stateTime >= this.aimTime - 0.15 && this.stateTime - dt < this.aimTime - 0.15) {
          this.getMuzzle(_muzzle);
          this.ctx.fx.burst(_muzzle, 0xfff2c0, 6, 1.2, 0.2, 0.09 * this.sizeScale, 0);
        }
        if (!this.sees && this.blindTime > 0.35) {
          this.releaseAttack();
          this.rollCooldown(0.8, 1.4);
          this.setState('move');
          break;
        }
        if (this.stateTime >= this.aimTime) {
          this.shots = 0;
          this.shotTimer = 0;
          this.setState('fire');
        }
        break;
      }
      case 'fire': {
        this.stopMoving();
        this.facePlayer(6, dt);
        this.glowTarget[1] = 1;
        const total = this.isElite ? ELITE_SHOTS : SHOTS;
        this.shotTimer -= dt;
        if (this.shotTimer <= 0 && this.shots < total) {
          this.fireBolt(this.shots, total);
          this.shots++;
          this.shotTimer = SHOT_GAP / Math.sqrt(this.attackRate);
        }
        if (this.shots >= total && this.shotTimer <= 0) {
          this.recoverTime = 0.4;
          this.setState('recover');
        }
        break;
      }
      case 'dive': {
        this.stopMoving();
        this.sink = smooth(this.stateTime / DIVE_TIME);
        this.sandSpray(this.stateTime < 0.35 ? 3 : 1);
        if (this.stateTime >= DIVE_TIME) {
          this.sink = 1;
          this.tunnelDust = 0;
          this.setState('tunnel');
        }
        break;
      }
      case 'tunnel': {
        // 潜行：沿导航网格去钻出点，地面上拖出一道沙浪
        const arrived = this.moveTo(this.tunnelTarget, TUNNEL_SPEED, 0.8);
        this.faceMovement(10, dt);
        this.tunnelDust -= dt;
        if (this.tunnelDust <= 0) {
          this.tunnelDust = 0.07;
          _v.set(this.position.x, this.position.y + 0.15, this.position.z);
          this.ctx.fx.burst(_v, 0xc9a46a, 3, 1.6, 0.5, 0.32 * this.sizeScale, -3);
        }
        if (arrived || this.stateTime >= TUNNEL_MAX) {
          this.stopMoving();
          this.setState('emerge');
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.7, pitch: 0.5 });
          this.ctx.fx.ring(_v.set(this.position.x, this.position.y + 0.08, this.position.z), EMERGE_RADIUS * this.sizeScale, 0xe8c27a, 0.4);
        }
        break;
      }
      case 'emerge': {
        this.stopMoving();
        this.facePlayer(8, dt);
        this.sink = 1 - smooth(this.stateTime / EMERGE_TIME);
        if (this.stateTime < 0.3) this.sandSpray(4);
        if (this.stateTime >= 0.18 && this.stateTime - dt < 0.18) {
          // 钻出时掀起沙石：站得太近会被打到
          const p = this.ctx.player.position;
          if (Math.hypot(p.x - this.position.x, p.z - this.position.z) < EMERGE_RADIUS * this.sizeScale + this.ctx.player.radius) {
            this.ctx.combat.damagePlayer(this.def.damage * 0.8 * this.damageMult, 'none', this, this.position);
          }
          if (this.distToPlayerXZ() < 8) this.ctx.fx.shake(0.18, 0.25);
        }
        if (this.stateTime >= EMERGE_TIME) {
          this.sink = 0;
          this.burrowCd = this.ctx.rng.range(9, 12);
          // 伏击：钻出后马上快速上弦（不受攻击令牌限制）
          this.ambush = true;
          this.beginAim(AMBUSH_AIM_TIME, true);
        }
        break;
      }
      case 'snapWindup': {
        this.stopMoving();
        this.facePlayer(7, dt);
        this.glowTarget[2] = clamp01(this.stateTime / SNAP_WINDUP);
        if (this.stateTime >= this.windup(SNAP_WINDUP, 0.2)) this.setState('snap');
        break;
      }
      case 'snap': {
        this.stopMoving();
        if (!this.snapHit && this.stateTime >= 0.06) {
          this.snapHit = true;
          this.melee(SNAP_RANGE * this.sizeScale, this.def.damage * SNAP_DAMAGE_MULT, 0.3);
        }
        this.glowTarget[2] = 0;
        if (this.stateTime >= 0.25) {
          this.recoverTime = 0.5;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.glowTarget[1] = 0.25;
        this.keepRange(MIN_RANGE, MAX_RANGE, this.speed * 0.6, 0.8);
        this.facePlayer(4, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.ambush = false;
          if (this.cooldown <= 0.5) this.rollCooldown(2.4, 3.6);
          this.setState('move');
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  private beginAim(time: number, free = false): void {
    if (!free && !this.requestAttack('ranged', time + SHOTS * SHOT_GAP + 0.6)) {
      this.cooldown = this.ctx.rng.range(0.4, 0.9);
      return;
    }
    this.aimTime = this.windup(time, 0.3);
    this.setState('aim');
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.5, pitch: 1.6 });
  }

  /** 选钻出点：玩家 13–20 米外、可走、从那里看得见玩家；找不到就不钻 */
  private findExit(out: THREE.Vector3): boolean {
    const pl = this.ctx.player;
    for (let i = 0; i < 10; i++) {
      if (!this.ctx.nav.randomWalkable(pl.position, 13, 20, out)) continue;
      _eye.set(out.x, out.y + 1.6 * this.sizeScale, out.z);
      if (!this.ctx.world.segmentBlocked(_eye, pl.eye)) return true;
    }
    return false;
  }

  private sandSpray(count: number): void {
    _v.set(this.position.x, this.position.y + 0.2, this.position.z);
    this.ctx.fx.burst(_v, 0xc9a46a, count, 2.4, 0.6, 0.38 * this.sizeScale, -4);
  }

  private fireBolt(index: number, total: number): void {
    this.root.updateMatrixWorld(true);
    this.getMuzzle(_muzzle);
    // 精英五支扇形：以玩家为中心左右展开
    const fan = total > SHOTS ? (index - (total - 1) / 2) * 0.09 : 0;
    const target = this.playerChest(_v);
    if (fan !== 0) {
      const dx = target.x - _muzzle.x, dz = target.z - _muzzle.z;
      const c = Math.cos(fan), s = Math.sin(fan);
      target.x = _muzzle.x + dx * c - dz * s;
      target.z = _muzzle.z + dx * s + dz * c;
    }
    this.shoot({
      speed: BOLT_SPEED, damage: this.def.damage, radius: 0.14, color: 0xffd27a,
      lead: fan === 0 ? 0.35 : 0, spread: 0.012, visual: 'arrow', lifetime: 3, from: _muzzle,
      target: fan === 0 ? undefined : target.clone(),
    });
    this.recoil = 1;
  }

  /** 弩尖（世界坐标） */
  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    // 美术：crossbow 骨骼从毒囊上方沿弩身指向前方，骨长 0.8 米，弩尖就在骨骼末端（骨骼局部 +Y）
    const bone = this.nativeBody?.pose.bone('crossbow');
    if (bone) return bone.localToWorld(out.set(0, CROSSBOW_LENGTH, 0));
    return this.crossbow.localToWorld(out.set(0, 0.02, 0.4));
  }

  protected override cancelAttack(): void {
    // 潜沙途中被打断（如玩家死亡、清场）：立刻回到地面
    if (this.state !== 'move' && this.state !== 'chase') {
      this.sink = 0;
      this.ambush = false;
      this.setState('move');
      this.rollCooldown(1.2, 2);
    }
  }

  protected override pose(dt: number): void {
    this.recoil = Math.max(0, this.recoil - dt * 7);
    // 钻沙：整个模型沉进地面，完全潜入时隐藏（只剩沙浪）
    // 美术模型按最低点（拄地的钳尖）落地，脚尖比钳尖高；钳子抬起后整体下沉，让八只脚尖贴地
    const footLift = this.nativeBody ? ART_FOOT_LIFT : 0;
    // host 在模型根下，模型根已按 sizeScale 缩放：这里是美术 2 米版的局部单位，不再乘 sizeScale
    this.host.position.y = -this.sink * SINK_DEPTH - footLift;
    this.host.visible = this.sink < 0.98;
    if (this.nativeBody) {
      this.poseNative(this.nativeBody, dt);
      return;
    }
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const amp = Math.min(1, sp / 2.5);
    const ph = this.walkPhase * 2;
    const aim = this.state === 'aim' ? clamp01(this.stateTime / this.aimTime) : this.state === 'fire' ? 1 : 0;
    const snapOpen = this.state === 'snapWindup' ? clamp01(this.stateTime / SNAP_WINDUP) : 0;
    const digging = this.state === 'dive' || this.state === 'emerge' ? 1 : 0;

    // 八条腿三角步态：两组交替抬起、前后划动；钻沙时快速刨沙
    for (const l of this.legs) {
      const p = ph + l.group * Math.PI + (digging ? this.age * 30 : 0);
      const lift = Math.max(0, Math.sin(p)) * (amp + digging * 0.8);
      l.pivot.rotation.y = Math.cos(p) * 0.28 * (amp + digging * 0.5) * l.side;
      l.pivot.rotation.z = lift * 0.35 * l.side;
    }
    // 上身：横走时微微摇摆，上弦时左手抬起比作准星
    this.torso.rotation.z = Math.sin(ph) * 0.04 * amp;
    this.torso.rotation.x = -0.06 * aim + 0.05 * this.hurtKick;
    this.aimArm.rotation.x = -1.3 * aim;
    this.aimArm.rotation.z = 0.35 * aim;
    this.headJoint.rotation.x = 0.08 * aim;
    // 尾巴：平时轻摆，上弦时整体后收，开火时向前一弹
    const sway = Math.sin(this.age * 1.6) * 0.04;
    this.tail.forEach((j, i) => {
      if (i === 0) return;
      j.rotation.x = 0.07 * aim - 0.12 * this.recoil + (i > 3 ? sway : 0);
    });
    // 巨钳：张开蓄力，夹击瞬间合拢
    for (const c of this.claws) {
      const shut = this.state === 'snap' ? 1 - clamp01(this.stateTime / 0.08) : 0;
      c.jaw.rotation.y = c.side * (0.15 + 0.6 * snapOpen) * (1 - shut);
      c.arm.rotation.y = -c.side * 0.3 * snapOpen + c.side * 0.25 * (this.state === 'snap' ? 1 : 0);
      c.arm.rotation.x = -0.25 * snapOpen;
    }
  }

  /**
   * 原生骨架动画（管线按几何重搭的语义骨骼，见 art/pipeline/creature_rigs/SK_Enemy_ScorpionArcher.json）。
   * 模型空间：X = 蝎子左侧，Y = 上，Z = 前；绕 +X 正转 = 前端下压 / 向后摆，负转 = 抬起 / 向前伸。
   *
   * 八条腿是真正的落脚步态：每只脚落地后钉在世界坐标里，身体走开（或转身）到一定距离才抬脚，
   * 迈向「绑定位置 + 前进方向的一点提前量」；相邻的腿（同侧前后、对侧同排）不同时抬起，自然形成两组交替的三角步态。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const k = this.sizeScale;
    const aim = this.state === 'aim' ? smooth(this.stateTime / this.aimTime) : this.state === 'fire' ? 1 : 0;
    const snapOpen = this.state === 'snapWindup' ? smooth(this.stateTime / SNAP_WINDUP) : 0;
    const snapShut = this.state === 'snap' ? 1 - clamp01(this.stateTime / 0.07) : 0;
    const digging = this.state === 'dive' || this.state === 'emerge';
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const breathe = Math.sin(this.age * 1.9);

    // 蝎身：行走时轻微起伏，钻沙时低头扎进沙里，受击后仰
    // 骨骼平移在 host 局部单位（已随模型缩放），不乘 sizeScale
    P.translate('hips', 0, 0.012 * breathe - 0.03 * Math.min(1, sp / (3 * k)), 0);
    P.rotate('hips', AX, (digging ? 0.32 : 0) - 0.2 * this.hurtKick);
    if (this.stunTime > 0) P.rotate('hips', AZ, Math.sin(this.age * 9) * 0.1);
    for (const [i, a] of ['abdomen_1', 'abdomen_2', 'abdomen_3'].entries()) P.rotate(a, AX, -0.02 * breathe * (i + 1) + (digging ? -0.08 : 0));

    // 上身（女射手）：放松的站姿——手臂收向身体、肘部微屈，双手轻搭在身前的蝎甲上；呼吸带动胸口和肩。
    // 头看向玩家（限幅），胸口跟着转一点；走动时上身抵消蝎身的起伏、稍有滞后，手臂轻摆。
    const look = this.lookAngles();
    const gaitSway = Math.sin(this.walkPhase) * Math.min(1, sp / 3);
    this.upperLag = this.upperLag + (gaitSway - this.upperLag) * Math.min(1, dt * 6);
    P.rotate('waist', AX, -0.06 * aim + 0.14 * this.hurtKick + 0.012 * breathe);
    P.rotate('waist', AZ, -0.05 * this.upperLag);
    P.rotate('waist', AY, look.yaw * 0.25);
    P.rotate('chest', AX, -0.035 * aim - 0.02 * breathe + 0.06 * this.hurtKick);
    P.rotate('chest', AY, look.yaw * 0.25 + 0.04 * this.upperLag);
    P.rotate('neck', AY, look.yaw * 0.2);
    P.rotate('head', AY, look.yaw * 0.3);
    P.rotate('head', AX, look.pitch * 0.6 + 0.08 * aim - 0.1 * this.hurtKick);
    P.rotate('head', AZ, 0.04 * Math.sin(this.age * 0.8) - 0.03 * this.upperLag);
    for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
      const relax = 1 - (side === 'L' ? aim : 0);
      // 肩：随呼吸微抬
      P.rotate(`shoulder_${side}`, AZ, sx * 0.03 * breathe);
      // 上臂：从 A 字收向身体并略向前，走动时轻摆（左右相反）
      P.rotate(`arm_${side}`, AZ, -sx * 0.32 * relax);
      P.rotate(`arm_${side}`, AX, -0.18 * relax + 0.06 * sx * this.upperLag + 0.12 * this.hurtKick);
      // 前臂：肘部微屈，手往前搭到蝎甲上
      P.rotate(`forearm_${side}`, AX, -0.35 * relax + 0.03 * breathe);
      P.rotate(`forearm_${side}`, AZ, sx * 0.12 * relax);
      P.rotate(`hand_${side}`, AX, 0.25 * relax);
    }
    // 上弦：左手抬起指向玩家当作准星（肘微屈），右手收到腰侧
    if (aim > 0) {
      P.rotate('arm_L', AX, -1.15 * aim + look.pitch * 0.5 * aim);
      // 向身体中线收一点，像伸手指着玩家，而不是平举在身侧
      P.rotate('arm_L', AY, (look.yaw * 0.6 - 0.4) * aim);
      P.rotate('arm_L', AZ, -0.15 * aim);
      P.rotate('forearm_L', AX, -0.2 * aim);
      P.rotate('hand_L', AX, -0.15 * aim);
      P.rotate('arm_R', AX, 0.18 * aim);
      P.rotate('forearm_R', AX, -0.35 * aim);
    }

    // 尾巴：平时轻摆；上弦时整条尾巴后收蓄力，开火瞬间向前一弹；钻沙时收紧贴背
    const sway = Math.sin(this.age * 1.4);
    for (let i = 1; i <= 4; i++) {
      const w = i / 4;
      P.rotate(`tail_${i}`, AX, -0.07 * aim * (1 - 0.5 * w) + 0.16 * this.recoil * w + (digging ? 0.1 : 0) + 0.02 * sway * w);
      P.rotate(`tail_${i}`, AZ, 0.025 * Math.sin(this.age * 1.1 + i * 0.6));
    }
    P.rotate('crossbow', AX, -0.08 * aim + 0.12 * this.recoil);

    // 巨钳（前肢）：真实的蝎子把钳子抬离地面、举在身前戒备，走动时随步伐一前一后地摆、上下起伏，钳指一张一合。
    // 美术绑定姿势里钳尖拄在地上，所以先整体抬起：钳臂根部上抬，钳掌回压保持钳尖朝前。
    const move = Math.min(1, sp / 2.5);
    const gait = this.walkPhase;
    for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
      const ph = gait + (sx > 0 ? 0 : Math.PI);
      const swing = Math.sin(ph) * move;
      const bob = Math.max(0, Math.cos(ph)) * move;
      const dig = digging ? Math.sin(this.age * 24 + (sx > 0 ? 0 : Math.PI)) : 0;
      const idle = 0.5 + 0.5 * Math.sin(this.age * 1.3 + (sx > 0 ? 0 : 1.7));
      // 钳臂：抬起 + 随步伐一前一后地划（前探时抬高、收回时压低），左右也跟着摆；上弦时收到胸前；钻沙时向下刨
      P.rotate(`claw_${side}1`, AX, -0.55 - 0.18 * swing - 0.08 * bob + 0.06 * breathe + 0.14 * aim
        - 0.3 * snapOpen - 0.12 * snapShut + (digging ? 0.6 + 0.35 * dig : 0));
      P.rotate(`claw_${side}1`, AY, sx * (0.14 + 0.28 * swing - 0.18 * aim + 0.35 * snapOpen - 0.3 * snapShut));
      // 钳腕：配合抬臂向下折回，让钳掌保持水平朝前；摆动比钳臂晚一点（有重量感）
      P.rotate(`claw_${side}2`, AX, 0.24 + 0.1 * Math.sin(ph - 0.6) * move - 0.05 * aim);
      P.rotate(`claw_${side}2`, AY, -sx * (0.1 * Math.sin(ph - 0.6) * move + 0.25 * snapShut));
      P.rotate(`claw_${side}`, AX, 0.18 + 0.14 * Math.sin(ph - 1.1) * move);
      // 钳指：平时缓慢开合，走动时随步伐一张一合，夹击前大张、出手瞬间合拢
      const open = 0.12 + 0.12 * idle + 0.12 * move * (0.5 + 0.5 * Math.sin(ph * 2)) + 0.55 * snapOpen;
      P.rotate(`pinch_${side}`, AY, -sx * open * (1 - snapShut));
    }

    // 弱点发光壳：平时微光，上弦时越来越亮
    if (n.glowShell) {
      const gl = this.glowLevel[1];
      n.glowShell.opacity = clamp01(0.06 + 0.03 * Math.sin(this.age * 2.6) + gl * gl * 0.55);
    }

    this.stepLegs(P, dt, digging);
  }

  private readonly feet: { world: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  /** 上一次迈步的脚组（0 / 1） */
  private lastGroup = 1;
  /** 上身对步伐摆动的滞后量（让上身显得在稳住自己） */
  private upperLag = 0;

  /** 头部看向玩家的偏航 / 俯仰（模型空间，弧度，限幅）：偏航正 = 向左，俯仰正 = 低头 */
  private lookAngles(): { yaw: number; pitch: number } {
    const n = this.nativeBody;
    if (!n || !n.pose.has('head')) return { yaw: 0, pitch: 0 };
    const head = n.pose.hostPosition('head', _v);
    const eye = this.host.worldToLocal(_eye.copy(this.ctx.player.eye));
    const dx = eye.x - head.x, dy = eye.y - head.y, dz = eye.z - head.z;
    const yaw = clamp(Math.atan2(dx, dz), -0.7, 0.7);
    const pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.45);
    return { yaw: Number.isFinite(yaw) ? yaw : 0, pitch: Number.isFinite(pitch) ? pitch : 0 };
  }

  /** 八条腿的落脚步态（见 poseNative 说明）。钻沙时原地快速刨动 */
  private stepLegs(P: NativeBody['pose'], dt: number, digging: boolean): void {
    const k = this.sizeScale;
    const host = this.host;
    host.updateWorldMatrix(true, false);
    const legs: string[] = [];
    for (const side of ['L', 'R']) for (let i = 1; i <= 4; i++) legs.push(`leg_${side}${i}`);
    if (this.feet.length === 0) {
      for (const l of legs) {
        const rest = P.restPosition(`${l}c`);
        const w = rest ? host.localToWorld(rest.clone()) : new THREE.Vector3();
        this.feet.push({ world: w.clone(), from: w.clone(), to: w.clone(), t: 1 });
      }
    }
    // 交替三角步态：两组脚（左1 右2 左3 右4 / 另一组）轮流迈步，一组全部落地后另一组才抬起。
    // 一步的腾空时间 T 随速度变短；抬脚时把落点预测到「落地那一刻的绑定位置 + 前方 v·T」，
    // 于是脚着地后从身前 v·T 被身体带到身后约 v·T 再迈，着地 ≈ 2T、腾空 T，任何时刻都有一组脚撑在地上。
    const v = Math.hypot(this.velocity.x, this.velocity.z);
    const stepTime = digging ? 0.09 : clamp(0.3 * k / Math.max(v, 0.1), 0.08, 0.2);
    const stepDist = Math.max(0.1 * k, v * stepTime + 0.02 * k);
    const rests: THREE.Vector3[] = [];
    const errs: number[] = [];
    legs.forEach((l, i) => {
      const r = P.restPosition(`${l}c`);
      const w = r ? host.localToWorld(r.clone()) : this.feet[i].world.clone();
      rests.push(w);
      errs.push(this.feet[i].world.distanceTo(w));
    });
    const group = (i: number): number => (i % 4 + Math.floor(i / 4)) % 2;
    const swinging = this.feet.some((f) => f.t < 1);
    if (!swinging) {
      // 误差更大的那组先迈；组里只要有一只脚落后超过阈值，整组一起迈（钻沙时持续刨动）
      let best = -1, bestErr = digging ? 0 : stepDist;
      for (const gi of [0, 1]) {
        const e = Math.max(...errs.filter((_, i) => group(i) === gi));
        if (e > bestErr || (digging && gi !== this.lastGroup)) { best = gi; bestErr = e; }
      }
      if (best >= 0) {
        this.lastGroup = best;
        this.feet.forEach((f, i) => {
          if (group(i) !== best) return;
          f.from.copy(f.world);
          f.to.copy(rests[i]);
          f.to.x += this.velocity.x * stepTime * 2;
          f.to.z += this.velocity.z * stepTime * 2;
          f.t = 0;
        });
      }
    }
    legs.forEach((l, i) => {
      const f = this.feet[i];
      const rest = P.restPosition(`${l}c`);
      if (!rest) return;
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / stepTime);
        const e = smooth(f.t);
        f.world.lerpVectors(f.from, f.to, e);
        f.world.y += Math.sin(Math.PI * f.t) * (digging ? 0.18 : 0.13) * k;
        if (f.t >= 1) f.world.copy(f.to);
      }
      // 换回模型空间做两骨 IK；脚踝永远不低于绑定高度（不穿地）
      const target = host.worldToLocal(_eye.copy(f.world));
      target.y = Math.max(target.y, rest.y);
      P.twoBoneIK(`${l}a`, `${l}b`, `${l}c`, target, 1);
    });
  }
}
