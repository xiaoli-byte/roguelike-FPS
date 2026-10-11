/**
 * 邪飞天（apsara，第一章 · 赤沙古道的辅助）：被旱魃的日火侵蚀的敦煌飞天，悬浮在空中，一面琵琶悬在她身前随手势转动。
 * 琵琶单独建模（SM_EnemyPart_ApsaraPipa，挂在 pipa 挂点上），手不碰琵琶：她隔空轮指拨弦，指尖与琴弦之间牵着金色光弦。
 * 弱点是琵琶上的四个发光琴轸（头部判定挂在琵琶上）。设计见 docs/art/enemy-roster-v2.md「邪飞天 · 天乐与赐福」。
 *
 * 她不攻击（用户 2026-10-07 定），只做辅助，但辅助要强到改变战局：
 * - 天乐光环（常驻，弹奏时）：16 米内同伴伤害 ×1.35、攻速 ×1.35、移速 ×1.2、受到的伤害 ×0.75；
 *   琵琶到每个受加成的同伴之间牵一根金丝，同伴身边飘起金色音符。
 * - 莲花和弦（约 8 秒）：仰身、双臂划弧举过头结印，琵琶升到头顶飞旋；同伴得到最大生命 50% 的护盾（8 秒后消散）。
 * - 天女散花（约 10 秒，有同伴受伤时）：旋身一周、双臂舒展撒花，琵琶绕身飞转；同伴回复最大生命 25%。
 * - 飞天赐福（约 16 秒）：双手捧向范围内最强的同伴，10 秒内它的伤害再 ×1.6、攻速再 ×1.5、受到的伤害再减半，
 *   脚下开出金莲、头顶浮起光环。
 * - 琴碎：琵琶（弱点）累计承受她最大生命 30% 的伤害后炸碎，所有光环和赐福立刻消失，她仰头哀鸣，此后只会躲；
 *   杀死她同样驱散全部加成（已给的护盾照常消散）。
 *
 * 动作要「自然优雅」（敦煌飞天的体态）：三道弯身段（髋、胸、头交替反向倾斜）随呼吸缓缓起伏；一腿屈膝后翘、一腿舒展，
 * 脚尖绷直，两腿缓慢交替；右手轮指（四指依次弹出）沿琴弦划弧，左手按弦带揉弦；姿态权重用临界阻尼弹簧过渡（缓入缓出），
 * 举臂时双臂先向两侧舒展再划弧上举；长飘带细而软，波浪从根部往尾端传。
 *
 * 状态机：hover → chordWindup | bloomWindup | blessWindup → hover
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { GroundDecal } from '../bosses/Visuals';
import { BuffRegistry, type Buffable } from '../SupportBuffs';
import { Geo, flat, joint, part } from '../Models';
import { FLAME_FX_TIME, createFlameTongue, type FlameTongue } from '../fx/FlameFx';

export const APSARA_DEF: ScaledEnemyDef = {
  id: 'apsara',
  name: '邪飞天',
  hp: 170,
  speed: 4.2,
  radius: 0.42,
  height: 1.9,
  damage: 0,
  coins: [3, 5],
  essence: 1,
  flying: true,
  // 弱点 = 悬浮琵琶上的琴轸：判定球挂在琵琶挂点上（随琵琶的位置和转动走）
  headY: 1.35,
  headRadius: 0.24,
  knockbackResist: 0.3,
  color: 0xe0b060,
  // 美术按 1.9 米制作，游戏里放大约 1.3 倍（约 2.5 米）
  scale: 1.3,
};

/** 悬停：离地高度（脚底，米）、上下浮动幅度 / 角频率 */
const HOVER = 0.9;
/** 出场：从约 2.6 米高处旋身飘落（秒） */
const ENTRANCE = 1.8;
const ENTRANCE_HEIGHT = 2.6;
const BOB = [0.1, 1.5] as const;
/** 躲在同伴身后：离玩家的距离带（米），同伴质心后方多远 */
const KEEP_RANGE = [14, 20] as const;
const BEHIND_ALLIES = 4;
/** 天乐光环 */
const AURA_RANGE = 16;
const AURA = { damage: 1.35, rate: 1.35, speed: 1.2, taken: 0.75 };
/** 莲花和弦 */
const CHORD_COOLDOWN = [7, 9] as const;
const CHORD_WINDUP = 1.1;
const CHORD_SHIELD = 0.5;
const CHORD_DURATION = 8;
/** 天女散花 */
const BLOOM_COOLDOWN = [9, 11] as const;
const BLOOM_WINDUP = 1.5;
const BLOOM_HEAL = 0.25;
/** 飞天赐福 */
const BLESS_COOLDOWN = [14, 18] as const;
const BLESS_WINDUP = 1.3;
const BLESS_DURATION = 10;
const BLESS = { damage: 1.6, rate: 1.5, speed: 1.15, taken: 0.5 };
/** 琴碎：琵琶累计承受的伤害（相对最大生命） */
const PIPA_BREAK = 0.3;
/** 琴碎后多少秒琵琶重聚（用户 2026-10-07 定）；最后几秒胸前聚起金光预警；重聚演出时长 */
const PIPA_REFORM = 20;
const REFORM_WARN = 3;
const REFORM_TIME = 1.6;
/** 轮指：一轮的时长（秒） */
const LUNZHI = 0.6;
/**
 * 轮指的旋律（MIDI 音高，基准 D5 = 74；0 = 休止）。每轮轮指弹一个音，十六轮一句，五声音阶、先落后起。
 * 每个音对应一根弦（音高从低到高 → 子弦到缠弦的反序），弹到的那根弦会亮一下、颤一下。
 */
const MELODY = [81, 78, 76, 74, 76, 78, 81, 0, 86, 83, 81, 78, 76, 78, 74, 0];
/** 四根弦在琴面上的位置（琵琶挂点坐标，琴心原点、琴面朝 +Z）：琴码处 x、琴枕处 x */
const STRING_X: readonly (readonly [number, number])[] = [[-0.036, -0.018], [-0.012, -0.006], [0.012, 0.006], [0.036, 0.018]];
const STRING_BRIDGE_Y = -0.22, STRING_NUT_Y = 0.2, STRING_BRIDGE_Z = 0.068, STRING_NUT_Z = 0.05;
/** 琵琶相对美术尺寸的缩放（Q 版身体配一面小一点的琵琶，琴头不挡脸） */
const PIPA_SCALE = 0.82;
/**
 * 弹奏时双手相对琵琶的位置（琵琶局部坐标：琴心为原点、琴头 +Y、琴面 +Z）与指尖朝向的点。
 * 琵琶悬在胸前（琴心 -0.03, 0.95, 0.3，缩到 PIPA_SCALE，琴头斜向她的左上，和真实持琴一样），双手在琴边、不接触：
 * 左手扣在琴颈旁，右手在琴腹右侧。Q 版手臂很短（肩到腕约 0.4 米），两个手位都在够得着的范围内。
 */
const PIPA_NECK_HAND = new THREE.Vector3(0.085, 0.2, 0.02);
const PIPA_NECK_AIM = new THREE.Vector3(-0.04, 0.22, 0.03);
const PIPA_BODY_HAND = new THREE.Vector3(-0.13, 0.05, 0.09);
const PIPA_STRING_AIM = new THREE.Vector3(0.03, -0.08, 0.12);

const C = {
  skin: 0xf0d8c4, silk: 0xb8443a, jade: 0x3f8a74, gold: 0xd8b060, hair: 0x3a2418, wood: 0x6a3a22,
  peg: 0xc89a3a, pegHot: 0xfff2b8, note: 0xffd890, lotus: 0xffc8a0, ward: 0xffd070, heal: 0xb8f0a0,
  bless: 0xffe08a, fire: 0xffa040, shard: 0xf0e6d8, woodShard: 0x7a4a2a, petal: 0xffd27a, petalPink: 0xffb0b8,
};

/** 长飘带：质点数、总长（模型单位，未缩放）、宽度 */
const RIBBON_POINTS = 14;
const RIBBON_LENGTH = 2.5;
const RIBBON_WIDTH = 0.1;

/** 手指名（拇指 → 小指） */
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type Side = 'L' | 'R';
/** 每帧要用的骨骼名，按左右预先拼好（不在动画里逐帧拼字符串） */
const boneNames = (s: Side) => ({
  thigh: `thigh_${s}`, shin: `shin_${s}`, foot: `foot_${s}`, toe: `toe_${s}`, skirt1: `skirt_${s}1`, skirt2: `skirt_${s}2`,
  arm: `arm_${s}`, forearm: `forearm_${s}`, hand: `hand_${s}`, middle1: `middle_1_${s}`,
  finger1: FINGERS.map((f) => `${f}_1_${s}`), finger2: FINGERS.map((f) => `${f}_2_${s}`),
  /** 小臂下短飘带 1..3（下标 0 不用） */
  ribbon: ['', `ribbon_${s}1`, `ribbon_${s}2`, `ribbon_${s}3`],
});
const BN: Record<Side, ReturnType<typeof boneNames>> = { L: boneNames('L'), R: boneNames('R') };
/** 右手食指、中指第二节（指尖光弦的起点） */
const THREAD_BONES = ['index_2_R', 'middle_2_R'] as const;
type Curl = readonly [number, number, number, number, number];
/** 手势：五指弯曲量（0 = 伸直，1 = 握拳；负值 = 张开反翘） */
const GESTURE: Record<string, Curl> = {
  relax: [0.25, 0.2, 0.28, 0.34, 0.42],
  press: [0.35, 0.8, 0.85, 0.85, 0.8],
  mudra: [0.75, 0.85, 0.08, 0.12, 0.18],
  offer: [0.1, 0.08, 0.12, 0.18, 0.25],
  splay: [-0.2, -0.2, -0.2, -0.2, -0.2],
};
/** 手的 IK 目标（模型空间、未缩放；左手，右手取 x 镜像）。弹奏手位不在这里：贴着琵琶算（PIPA_NECK_HAND / PIPA_BODY_HAND） */
const HAND: Record<string, [number, number, number]> = {
  relax: [0.4, 0.95, 0.12],
  // 举臂途中经过的侧上方（双臂先向两侧舒展、再划弧上举）
  side: [0.5, 1.42, 0.14],
  raise: [0.16, 1.8, 0.12],
  // 散花：一手高扬、一手低展，掌心朝上
  scatterHi: [0.48, 1.45, 0.24],
  scatterLo: [0.44, 0.98, 0.26],
  // 琴碎哀鸣：一手捂胸（左）、一手向上伸出想抓回琵琶（右）；失琴后双手交叉抱在胸前（左右镜像后正好交叉）
  clutch: [0.05, 1.15, 0.22],
  reach: [0.35, 1.6, 0.35],
  hug: [-0.08, 1.12, 0.2],
};

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _scratch: IEnemy[] = [];
// 动画专用的临时量（各自只在一个函数里用，互不借用，避免嵌套调用时互相覆盖）
const _hPlay = new THREE.Vector3(), _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _h3 = new THREE.Vector3(), _h4 = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _s4 = new THREE.Vector3();
const _sq1 = new THREE.Quaternion(), _sq2 = new THREE.Quaternion();
const _f1 = new THREE.Vector3(), _f2 = new THREE.Vector3(), _f3 = new THREE.Vector3();
const _k1 = new THREE.Vector3(), _k2 = new THREE.Vector3(), _k3 = new THREE.Vector3(), _k4 = new THREE.Vector3();
const TETHER_POOL = 12;
const NO_CAPS: readonly Capsule[] = [];
const _live = new Set<IEnemy>();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 二次贝塞尔：a → (经过 m 附近) → b */
const bezier = (out: THREE.Vector3, a: THREE.Vector3, m: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 =>
  out.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(m, 2 * t * (1 - t)).addScaledVector(b, t * t);

/** 带阻尼的弹簧（惯性用） */
class Spring {
  x = 0;
  v = 0;
  constructor(private readonly k: number, private readonly d: number) {}
  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30);
    this.v += (this.k * (target - this.x) - this.d * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

/** 临界阻尼弹簧：姿态权重的缓入缓出（不过冲），w = 角频率（越大越快） */
class Ease {
  x = 0;
  v = 0;
  constructor(private readonly w: number) {}
  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30), w = this.w;
    this.v += (w * w * (target - this.x) - 2 * w * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

/** 锥形胶囊碰撞体（世界坐标）：线段 a → b，半径从 ra 渐变到 rb */
interface Capsule {
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  ra: number;
  rb: number;
}
const _cab = new THREE.Vector3(), _cq = new THREE.Vector3();
/** 把点推到胶囊表面外（在里面才动） */
function pushOutOfCapsule(p: THREE.Vector3, c: Capsule): void {
  _cab.subVectors(c.b, c.a);
  const l2 = _cab.lengthSq();
  const t = l2 > 1e-8 ? clamp01(_cq.subVectors(p, c.a).dot(_cab) / l2) : 0;
  _cq.copy(c.a).addScaledVector(_cab, t);
  const r = c.ra + (c.rb - c.ra) * t;
  const dx = p.x - _cq.x, dy = p.y - _cq.y, dz = p.z - _cq.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return;
  const k = r / d;
  p.set(_cq.x + dx * k, _cq.y + dy * k, _cq.z + dz * k);
}

/**
 * 燃着金火的长飘带：一条质点链（Verlet），根部钉在肩后。每个质点被拉向一条「往身后、中段自然下垂、尾端微扬」的目标曲线，
 * 曲线上叠一道从根部往尾端传的波浪（丝绸在空中翻卷），根部拉得紧、尾端松，身体一动尾段因惯性甩开再慢慢归位。
 * 画成一条朝向相机、两端收窄的带子（世界坐标），尾端挂一片火舌；琴碎时整条燃起再熄灭。
 * 质点不穿进身体：每轮长度约束后把质点推出躯干 / 双腿的胶囊（急转身时飘带从身侧绕过去，而不是穿过腰腿）。
 */
class FireRibbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly tip: FlameTongue;
  private readonly p: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly pos: Float32Array;
  private readonly gpos: Float32Array;
  private ready = false;
  private readonly side = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly tgt = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();

  constructor(parent: THREE.Object3D, private readonly seed: number) {
    const n = RIBBON_POINTS;
    for (let i = 0; i < n; i++) {
      this.p.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    const geo = (colors: boolean): [THREE.BufferGeometry, Float32Array] => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 2 * 3);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const idx: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx);
      if (colors) {
        // 丝带：朱砂 → 石绿渐变，两边稍亮（金边感）
        const col = new Float32Array(n * 2 * 3);
        const a = new THREE.Color(C.silk), b = new THREE.Color(C.jade), c = new THREE.Color();
        for (let i = 0; i < n; i++) {
          c.copy(a).lerp(b, smooth(i / (n - 1)));
          col.set([c.r, c.g, c.b, c.r * 1.12, c.g * 1.12, c.b * 1.08], i * 6);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      return [g, pos];
    };
    const [g1, p1] = geo(true);
    this.pos = p1;
    this.mesh = new THREE.Mesh(g1, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    const [g2, p2] = geo(false);
    this.gpos = p2;
    this.glow = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({
      color: C.fire, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 4;
    this.tip = createFlameTongue(seed, 0xfff6d0, 0xffb040, 0xe0501a);
    parent.add(this.mesh, this.glow, this.tip);
  }

  /**
   * @param anchor 根部的世界坐标
   * @param back 世界空间里「身后」的方向（飘带默认往这边飘）
   * @param scale 体型缩放（长度、宽度一起放大）
   * @param burn 0 = 只有尾端火舌，1 = 整条燃起
   */
  update(dt: number, anchor: THREE.Vector3, back: THREE.Vector3, scale: number, time: number, burn: number, camera: THREE.Vector3, colliders: readonly Capsule[] = []): void {
    const n = RIBBON_POINTS, seg = (RIBBON_LENGTH / (n - 1)) * scale, L = seg * (n - 1);
    if (!this.ready) {
      for (let i = 0; i < n; i++) {
        this.p[i].copy(anchor).addScaledVector(back, i * seg);
        this.prev[i].copy(this.p[i]);
      }
      this.ready = true;
    }
    const h = Math.min(dt, 1 / 30);
    // 横向（与「身后」和竖直都垂直）：波浪往两侧摆
    this.side.crossVectors(back, AY).normalize();
    for (let i = 1; i < n; i++) {
      const p = this.p[i], q = this.prev[i];
      this.vel.subVectors(p, q).multiplyScalar(0.94);
      q.copy(p);
      p.add(this.vel);
      const w = i / (n - 1);
      // 波浪从根部往尾端传（相位随 i 递减）：竖直起伏 + 左右摆，越往尾端幅度越大
      const wave = time * 2.0 - i * 0.62 + this.seed * 6;
      this.tgt.copy(anchor).addScaledVector(back, i * seg);
      this.tgt.y += L * (-0.22 * Math.sin(Math.PI * w) + 0.12 * w * w) + Math.sin(wave) * 0.16 * w * scale;
      this.tgt.addScaledVector(this.side, Math.sin(wave * 0.7 + 1.3) * 0.2 * w * scale);
      p.lerp(this.tgt, clamp01((5 - 4.2 * w) * h));
    }
    this.p[0].copy(anchor);
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 1; i < n; i++) {
        const a = this.p[i - 1], b = this.p[i];
        this.dir.subVectors(b, a);
        const d = this.dir.length() || 1e-6;
        b.copy(a).addScaledVector(this.dir, seg / d);
        for (let c = 0; c < colliders.length; c++) pushOutOfCapsule(b, colliders[c]);
      }
    }
    // 朝向相机的带子：两端收窄（根部窄、中段宽、尾端尖）
    const width = RIBBON_WIDTH * scale;
    for (let i = 0; i < n; i++) {
      const a = this.p[Math.max(0, i - 1)], b = this.p[Math.min(n - 1, i + 1)];
      this.dir.subVectors(b, a).normalize();
      this.toCam.subVectors(camera, this.p[i]).normalize();
      this.side.crossVectors(this.dir, this.toCam).normalize();
      const w01 = i / (n - 1);
      const w = width * 0.5 * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, 0.15 + w01 * 0.95)));
      const k = i * 6, pi = this.p[i], s = this.side;
      this.pos[k] = pi.x + s.x * w; this.pos[k + 1] = pi.y + s.y * w; this.pos[k + 2] = pi.z + s.z * w;
      this.pos[k + 3] = pi.x - s.x * w; this.pos[k + 4] = pi.y - s.y * w; this.pos[k + 5] = pi.z - s.z * w;
      const gw = w * 1.7;
      this.gpos[k] = pi.x + s.x * gw; this.gpos[k + 1] = pi.y + s.y * gw; this.gpos[k + 2] = pi.z + s.z * gw;
      this.gpos[k + 3] = pi.x - s.x * gw; this.gpos[k + 4] = pi.y - s.y * gw; this.gpos[k + 5] = pi.z - s.z * gw;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.glow.material.opacity = 0.1 + 0.6 * burn;
    const tip = this.p[n - 1];
    this.tip.position.copy(tip);
    const s = (0.16 + 0.25 * burn) * scale * (1 + 0.15 * Math.sin(time * 13 + this.seed * 9));
    this.tip.scale.set(s * 0.9, s * 1.3, s);
    this.tip.material.uniforms.uAlpha.value = 0.85;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.glow.removeFromParent();
    this.tip.removeFromParent();
    this.mesh.geometry.dispose();
    this.glow.geometry.dispose();
    this.mesh.material.dispose();
    this.glow.material.dispose();
    this.tip.material.dispose();
  }
}

// ───────────── 加成登记（src/enemies/SupportBuffs.ts：多只飞天可以同时加成同一个同伴，倍率按乘法叠上、按乘法撤下） ─────────────

type BuffAlly = IEnemy & Buffable;
const registry = new BuffRegistry<BuffAlly, Apsara>(AURA, BLESS);
const takenInstalled = new WeakSet<object>();

/** 受到的伤害：全局伤害修正，只对受加成的同伴生效 */
function installTakenModifier(ctx: GameContext): void {
  if (takenInstalled.has(ctx)) return;
  takenInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy) => registry.taken(enemy as BuffAlly));
}

/** 同伴身上的加成提示：脚下淡金光环（光环中）、金莲 + 头顶光环（被赐福） */
interface AllyFx {
  ring: GroundDecal;
  lotus: GroundDecal | null;
  halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null;
}
const allyFx = new Map<IEnemy, AllyFx>();

function releaseBlessFx(fx: AllyFx): void {
  fx.lotus?.release();
  fx.lotus = null;
  if (fx.halo) {
    fx.halo.removeFromParent();
    fx.halo.geometry.dispose();
    fx.halo.material.dispose();
    fx.halo = null;
  }
}

/**
 * 牵向受加成同伴的金丝：每根是一条朝向相机的细发光带（不是 1 像素的线，十几米外也看得清），中段微微下垂像丝线，
 * 一串亮点从琵琶沿丝流向同伴（加法混合，顶点色控制明暗）。
 */
class TetherStrips {
  static readonly MAX = 12;
  static readonly SEG = 10;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();

  /** @param max 最多几根丝 */
  constructor(parent: THREE.Object3D, color: number, private readonly max = TetherStrips.MAX) {
    const n = max * (TetherStrips.SEG + 1) * 2;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let k = 0; k < max; k++) {
      const base = k * (TetherStrips.SEG + 1) * 2;
      for (let i = 0; i < TetherStrips.SEG; i++) {
        const v = base + i * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    parent.add(this.mesh);
  }

  /** @param ends 每根丝的起点、终点（世界坐标） */
  /** @param alphas 每根丝的不透明度（缺省 1；隔墙的丝淡出用） */
  update(ends: [THREE.Vector3, THREE.Vector3][], width: number, time: number, camera: THREE.Vector3, alphas?: readonly number[]): void {
    const S = TetherStrips.SEG;
    let k = 0;
    for (const [from, to] of ends) {
      if (k >= this.max) break;
      const alpha = alphas ? alphas[k] : 1;
      const len = from.distanceTo(to);
      const base = k * (S + 1) * 2;
      for (let i = 0; i <= S; i++) {
        const u = i / S;
        this.a.lerpVectors(from, to, u);
        this.a.y -= Math.sin(Math.PI * u) * Math.min(0.6, len * 0.06);   // 丝线微垂
        this.b.lerpVectors(from, to, Math.min(1, u + 1 / S));
        this.b.y -= Math.sin(Math.PI * Math.min(1, u + 1 / S)) * Math.min(0.6, len * 0.06);
        this.dir.subVectors(this.b, this.a).normalize();
        if (i === S) this.dir.subVectors(to, from).normalize();
        this.toCam.subVectors(camera, this.a).normalize();
        this.side.crossVectors(this.dir, this.toCam).normalize().multiplyScalar(width * 0.5);
        const v = (base + i * 2) * 3;
        this.pos[v] = this.a.x + this.side.x; this.pos[v + 1] = this.a.y + this.side.y; this.pos[v + 2] = this.a.z + this.side.z;
        this.pos[v + 3] = this.a.x - this.side.x; this.pos[v + 4] = this.a.y - this.side.y; this.pos[v + 5] = this.a.z - this.side.z;
        // 亮点沿丝从琵琶流向同伴；两端淡
        const pulse = Math.pow(Math.max(0, Math.sin(u * Math.PI * 3 - time * 5 + k)), 6);
        const c = (0.35 + 0.75 * pulse) * Math.min(1, Math.sin(Math.PI * u) * 4 + 0.2) * alpha;
        const col = this.col;
        col[v] = col[v + 1] = col[v + 2] = col[v + 3] = col[v + 4] = col[v + 5] = c;
      }
      k++;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, k * S * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** 一只手：IK 目标与手势（都平滑过渡） */
interface HandState {
  side: Side;
  target: THREE.Vector3;
  curl: number[];
  /** 每根手指的弯曲轴（模型空间，绑定姿势下算好：手指方向 × 掌心朝向） */
  axes: THREE.Vector3[];
}

export class Apsara extends StandardEnemy {
  /** 琵琶挂点（美术资产 SM_EnemyPart_ApsaraPipa 挂在这里）：原点在琴心，琴面朝 +Z、琴头朝 +Y */
  private pipa!: THREE.Group;
  private pegs: THREE.Mesh[] = [];
  /** 白模身体（美术身体就绪后隐藏） */
  private body!: THREE.Group;
  private ribbons: FireRibbon[] = [];
  /** 长飘带的身体碰撞体：躯干（裙摆下沿 → 胸口，下宽上窄）+ 两条腿（大腿根 → 脚） */
  private readonly bodyCaps: Capsule[] = [0, 1, 2].map(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), ra: 0, rb: 0 }));
  /** 指尖光弦（右手食指、中指 → 琴面）与牵向受加成同伴的金丝 */
  private threads: TetherStrips | null = null;
  /** 指尖光弦的两组端点（指尖 → 琴弦上的落点） */
  private readonly threadEnds: [THREE.Vector3, THREE.Vector3][] = [[new THREE.Vector3(), new THREE.Vector3()], [new THREE.Vector3(), new THREE.Vector3()]];
  private readonly threadView: [THREE.Vector3, THREE.Vector3][] = [];
  private tethers: TetherStrips | null = null;
  private readonly tetherEnds: [THREE.Vector3, THREE.Vector3][] = [];
  private readonly tetherPool: [THREE.Vector3, THREE.Vector3][] = [];
  private readonly tetherFrom = new THREE.Vector3();
  private readonly tetherAlpha: number[] = [];
  /** 金丝隔墙淡出：每个同伴的当前不透明度、上次视线检测的结果（每 0.2 秒检测一次） */
  private readonly tetherVis = new Map<IEnemy, number>();
  private readonly tetherClear = new Map<IEnemy, boolean>();
  private tetherLosTimer = 0;
  /** palmGoal 的输出：掌心目标方向 */
  private readonly palmDir = new THREE.Vector3();
  /** 拨弦波纹：贴着琴面、竖直荡开的金环（对象池） */
  private ripples: { m: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; t: number }[] = [];
  private readonly hands: HandState[] = [];
  /** 当前给光环的同伴 */
  private readonly auraTargets = new Set<IEnemy>();
  private blessTarget: IEnemy | null = null;

  private chordCd: number;
  private bloomCd: number;
  private blessCd: number;
  private windTime = 1;
  private pipaDamage = 0;
  /** 琴碎（或死亡）后不再弹奏、不再加成 */
  silenced = false;
  private lastPluck = 0;
  /** 轮指计数（每进入新的一轮弹一个音） */
  private rollIndex = -1;
  /** 四根光弦（原点在琴码，沿 +Y 伸向琴枕）与各自的拨动亮度、断弦后的回弹时间 */
  private strings: { m: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>; pluck: number; snapT: number; tilt: number; pitch: number }[] = [];
  private stringsBroken = 0;
  /** 琵琶被打中的时间与震向（琴身弹开再回摆） */
  private hitAt = -9;
  private hitSign = 1;
  private screamTime = 0;
  /** 打在身上的时间与侧向（-1..1，正 = 往她左边推） */
  private bodyHitAt = -9;
  /** 当前护琴权重（手势里用） */
  private guard = 0;
  /** 出场 / 重聚时琵琶从无到有（0..1） */
  private pipaAppear = 1;
  /** 琴碎后琵琶重聚的时间 */
  private reformAt = Infinity;
  private reformAcc = 0;
  /** 琵琶自己的受击闪白材质（从全身的闪白材质里挑出挂在琵琶下的） */
  private pipaFlash: { mat: THREE.Material & { emissive: THREE.Color; emissiveIntensity: number } }[] = [];
  private hitLat = 0;
  private noteAcc = 0;
  // 姿态权重（临界阻尼弹簧，缓入缓出）
  private readonly eRaise = new Ease(7);
  private readonly eScatter = new Ease(6);
  private readonly eOffer = new Ease(7);
  private readonly eScream = new Ease(10);
  private readonly eLegs = new Ease(1.2);
  private pRaise = 0;
  private pScatter = 0;
  private pOffer = 0;
  private pScream = 0;
  private pipaSpin = 0;
  private bodySpin = 0;
  /** 旋身角速度：散花放出后带着惯性多转一点再回正（欠阻尼弹簧） */
  private spinVel = 0;
  /** 上一次放出技能的时间（收势用）；预备 / 收势的当前权重 */
  private releaseAt = -9;
  private anticip = 0;
  private release = 0;
  private readonly pipaPos = new THREE.Vector3(-0.03, 0.95, 0.27);
  private readonly pipaRot = new THREE.Euler();
  private readonly leanX = new Spring(14, 5.5);
  private readonly leanZ = new Spring(14, 5.5);
  private readonly skirtX = new Spring(16, 3);
  private readonly skirtZ = new Spring(16, 3);
  private readonly headYaw = new Spring(20, 7);
  private readonly prevVel = new THREE.Vector3();
  /** 赐福目标在模型空间的方向（双手捧向它） */
  private readonly offerDir = new THREE.Vector3(0, 0, 1);

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, APSARA_DEF, opts);
    this.hoverHeight = HOVER;
    // 死亡：像落叶一样旋着飘落、化作花瓣（见 animateDeath）
    this.deathDuration = 1.8;
    this.chordCd = ctx.rng.range(1.5, 3);
    this.bloomCd = ctx.rng.range(4, 6);
    this.blessCd = ctx.rng.range(5, 8);
    // 出场由自己演（见 ai 的 enter 与 pose），不用基类的「从小放大」
    this.spawnDuration = 0.01;
    this.eScatter.x = 1;
    this.setState('enter');
    installTakenModifier(ctx);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const skin = flat(C.skin), silk = flat(C.silk), jade = flat(C.jade), gold = flat(C.gold, { metal: 0.6, rough: 0.4 });
    // 白模：悬浮的飞天（裙摆、上衣、头、发髻、头饰），美术身体就绪后整组隐藏
    const body = joint(root, 0, 0, 0);
    this.body = body;
    part(body, Geo.cone(0.34, 0.6, 8), silk, 0, 0.55, 0);
    part(body, Geo.box(0.32, 0.36, 0.2), jade, 0, 1.05, 0);
    part(body, Geo.ico(0.2, 1), skin, 0, 1.5, 0).scale.set(1, 1.05, 0.95);
    part(body, Geo.ico(0.16, 1), flat(C.hair), 0, 1.68, 0.05);
    part(body, Geo.cone(0.1, 0.24, 5, 'bottom'), gold, 0, 1.78, 0);
    for (const s of [1, -1]) {
      part(body, Geo.box(0.36, 0.06, 0.06), skin, s * 0.3, 1.1, 0, 0, 0, s * -0.6);
      part(body, Geo.box(0.05, 0.3, 0.05), skin, s * 0.08, 0.15, 0, 0.2, 0, 0);
    }

    // 悬浮琵琶（挂点在琴心，琴面朝 +Z、琴头朝 +Y；整体约 0.94 米高，含流苏；运行时缩到 PIPA_SCALE）
    const pipa = joint(root, 0, 1.0, 0.42);
    pipa.name = 'pipa'; // 挂点名：美术资产按它绑定（registry.toml 的 blockout.attachment）
    this.pipa = pipa;
    const wood = flat(C.wood, { rough: 0.6 });
    part(pipa, Geo.ico(0.15, 2), wood, 0, -0.12, -0.02).scale.set(1, 1.35, 0.42);
    part(pipa, Geo.box(0.26, 0.4, 0.02), flat(C.gold, { rough: 0.5 }), 0, -0.12, 0.045);
    part(pipa, Geo.box(0.05, 0.3, 0.05), wood, 0, 0.2, 0);
    part(pipa, Geo.ico(0.045, 1), gold, 0, 0.4, -0.01);
    part(pipa, Geo.cyl(0.015, 0.015, 0.14, 6), flat(0xb83a2a), 0, -0.42, 0);
    // 四个琴轸（弱点），两侧各两个
    for (const [x, y] of [[0.075, 0.355], [-0.075, 0.355], [0.075, 0.29], [-0.075, 0.29]]) {
      this.pegs.push(this.glowPart(pipa, Geo.ico(0.013, 1), C.peg, C.pegHot, x, y, 0));
    }
    // 四根光弦：被打碎前一根根崩断（见 snapString）
    for (const [xb, xn] of STRING_X) {
      const dy = STRING_NUT_Y - STRING_BRIDGE_Y, dz = STRING_NUT_Z - STRING_BRIDGE_Z;
      const len = Math.hypot(xn - xb, dy, dz);
      const geo = new THREE.BoxGeometry(0.0035, len, 0.0035).translate(0, len / 2, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: C.note, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      // 琴面从琴码到琴枕微微往后收：弦沿琴面走，两端都贴着琴面
      const tilt = -Math.atan2(xn - xb, dy), pitch = Math.atan2(dz, dy);
      m.position.set(xb, STRING_BRIDGE_Y, STRING_BRIDGE_Z);
      m.rotation.set(pitch, 0, tilt);
      m.renderOrder = 4;
      pipa.add(m);
      this.strings.push({ m, pluck: 0, snapT: -1, tilt, pitch });
    }
    this.setHeadAnchor(pipa, 0, 0.3, 0);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (n) {
      this.body.visible = false;
      this.initHands(n.pose);
    }
    const pipaMats = new Set<THREE.Material>();
    this.pipa.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) pipaMats.add(x);
    });
    this.pipaFlash = this.flashMats.filter((f) => pipaMats.has(f.mat));
    // 两条燃火长飘带（世界坐标质点链，挂在关卡组下）
    this.ribbons = [new FireRibbon(this.ctx.stageGroup, 0.2), new FireRibbon(this.ctx.stageGroup, 0.7)];
    this.threads = new TetherStrips(this.ctx.stageGroup, C.note, 2);
    this.tethers = new TetherStrips(this.ctx.stageGroup, C.ward);
    // 拨弦波纹：三枚金环轮流用，挂在琵琶上（贴着琴面）
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({
        color: C.note, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false;
      m.renderOrder = 4;
      this.pipa.add(m);
      this.ripples.push({ m, t: 1 });
    }
  }

  /** 绑定姿势下算出每根手指的弯曲轴：手指方向 × 掌心朝向（掌心朝前 +Z），正转 = 往掌心弯 */
  private initHands(P: NativePose): void {
    for (const side of ['L', 'R'] as const) {
      const axes: THREE.Vector3[] = [];
      for (const f of FINGERS) {
        const a = P.restPosition(`${f}_1_${side}`), b = P.restPosition(`${f}_2_${side}`);
        const ax = new THREE.Vector3(0, 0, 1);
        if (a && b) ax.crossVectors(_v.subVectors(b, a).normalize(), AZ).normalize();
        axes.push(ax);
      }
      const rest = P.restPosition(`hand_${side}`);
      this.hands.push({ side, target: rest ? rest.clone() : new THREE.Vector3(), curl: [...GESTURE.relax], axes });
    }
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0;
    // 重聚被打断（眩晕等）：琵琶已经现身了，直接完成，不留一把看得见却不弹的琴
    if (this.state === 'reform') this.finishReform();
    if (this.state !== 'hover' && this.state !== 'idle') this.setState('hover');
  }

  protected override onDispose(): void {
    super.onDispose();
    this.dropAllBuffs();
    for (const r of this.ribbons) r.dispose();
    this.ribbons.length = 0;
    this.threads?.dispose();
    this.tethers?.dispose();
    this.threads = null;
    this.tethers = null;
    for (const r of this.ripples) {
      r.m.geometry.dispose();
      r.m.material.dispose();
    }
    this.ripples.length = 0;
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    this.hoverHeight = HOVER + Math.sin(this.age * BOB[1]) * BOB[0];
    this.chordCd -= dt * this.attackRate;
    this.bloomCd -= dt * this.attackRate;
    this.blessCd -= dt * this.attackRate;
    this.screamTime = Math.max(0, this.screamTime - dt);
    if (this.state !== 'enter') this.updateAura();
    switch (this.state) {
      case 'reform': {
        // 琵琶重聚：双手举过头，琵琶在头顶由无到有、旋着落回胸前；落定后弦全部复原，加成恢复
        this.stopMoving();
        this.facePlayer(2, dt);
        this.glowTarget[0] = 0.4 + 0.6 * clamp01(this.stateTime / REFORM_TIME);
        if (this.stateTime >= REFORM_TIME) {
          this.finishReform();
          this.setState('hover');
        }
        break;
      }
      case 'enter': {
        // 飞天降临：原地旋身飘落，落定时弹出第一声和弦，之后才开始给同伴加成
        this.stopMoving();
        this.facePlayer(1.5, dt);
        this.petalAcc += dt * 14;
        while (this.petalAcc > 1) {
          this.petalAcc -= 1;
          this.getBodyCenter(_p);
          _p.x += (Math.random() - 0.5) * 0.8 * this.sizeScale;
          _p.z += (Math.random() - 0.5) * 0.8 * this.sizeScale;
          this.ctx.fx.burst(_p, Math.random() < 0.5 ? C.petal : C.petalPink, 1, 0.8, 1.6, 0.07, -0.2);
        }
        if (this.stateTime >= ENTRANCE) {
          this.landEntrance();
          this.setState('hover');
        }
        break;
      }
      case 'hover': {
        this.positionBehindAllies();
        // 快速滑行时身体转向前进方向（飞天往前飞），停下来再转回去看着玩家（面对战场）
        if (Math.hypot(this.velocity.x, this.velocity.z) > 1.8) this.faceMovement(2.2, dt);
        else this.facePlayer(2.5, dt);
        this.glowTarget[0] = this.silenced ? 0 : 0.12 + 0.06 * Math.sin(this.age * 3);
        if (this.silenced && this.screamTime <= 0) {
          // 琴碎后：最后几秒胸前聚起越来越密的金光（给玩家的预警：趁现在杀掉她），到点开始重聚
          const left = this.reformAt - this.age;
          if (left <= 0) {
            this.beginReform();
            break;
          }
          if (left < REFORM_WARN) {
            this.reformAcc += dt * (4 + 14 * (1 - left / REFORM_WARN));
            while (this.reformAcc > 1) {
              this.reformAcc -= 1;
              this.pipa.getWorldPosition(_p);
              _p.x += (Math.random() - 0.5) * 0.5 * this.sizeScale;
              _p.y += (Math.random() - 0.5) * 0.5 * this.sizeScale;
              _p.z += (Math.random() - 0.5) * 0.5 * this.sizeScale;
              this.ctx.fx.burst(_p, Math.random() < 0.6 ? C.note : C.woodShard, 1, 0.3, 0.6, 0.1, 0);
            }
          }
        }
        if (this.silenced || this.screamTime > 0) break;
        if (this.chordCd <= 0 && this.anyAlly((e) => !wardedUntil.has(e))) {
          this.beginCast('chordWindup', CHORD_WINDUP, 0.9);
        } else if (this.bloomCd <= 0 && this.anyAlly((e) => e.hp < e.maxHp * 0.85)) {
          this.beginCast('bloomWindup', BLOOM_WINDUP, 0.8);
        } else if (this.blessCd <= 0) {
          const t = this.pickBlessTarget();
          if (t) {
            this.blessTarget = t;
            this.beginCast('blessWindup', BLESS_WINDUP, 1.1);
          }
        }
        break;
      }
      case 'chordWindup':
      case 'bloomWindup':
      case 'blessWindup': {
        this.stopMoving();
        const t = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.5 + 0.5 * t;
        if (this.state === 'blessWindup' && this.blessTarget) this.faceTowards(this.blessTarget.position, 3, dt);
        else this.facePlayer(2, dt);
        if (this.stateTime >= this.windTime) {
          if (this.state === 'chordWindup') {
            this.castChord();
            this.chordCd = this.ctx.rng.range(CHORD_COOLDOWN[0], CHORD_COOLDOWN[1]);
          } else if (this.state === 'bloomWindup') {
            this.castBloom();
            this.bloomCd = this.ctx.rng.range(BLOOM_COOLDOWN[0], BLOOM_COOLDOWN[1]);
          } else {
            this.castBless();
            this.blessCd = this.ctx.rng.range(BLESS_COOLDOWN[0], BLESS_COOLDOWN[1]);
          }
          this.setState('hover');
        }
        break;
      }
      default:
        this.setState('hover');
    }
  }

  private beginReform(): void {
    this.setState('reform');
    this.pipa.visible = true;
    this.pipaAppear = 0;
    this.reformAcc = 0;
    this.pipa.getWorldPosition(_p);
    this.ctx.fx.burst(_p, C.note, 20, 2, 0.8, 0.07, -1);
    this.ctx.audio.play('pipa_bloom', { position: _p, volume: 0.7, pitch: 0.9 });
  }

  /** 重聚完成：弦全部复原、弱点回到琵琶、恢复弹奏和加成 */
  private finishReform(): void {
    this.silenced = false;
    this.pipaDamage = 0;
    this.stringsBroken = 0;
    for (const sg of this.strings) {
      sg.snapT = -1;
      sg.pluck = 1;
      sg.m.scale.set(1, 1, 1);
      sg.m.rotation.set(sg.pitch, 0, sg.tilt);
    }
    this.reformAt = Infinity;
    this.setHeadAnchor(this.pipa, 0, 0.3, 0);
    this.pipa.getWorldPosition(_p);
    this.ctx.audio.play('pipa_chord', { position: _p, volume: 0.9 });
    this.ctx.fx.ring(_q.set(this.position.x, this.position.y - this.hoverHeight + 0.05, this.position.z), 3, C.note, 0.7);
    this.ctx.fx.burst(_p, C.pegHot, 14, 2.5, 0.6, 0.06, 2);
    this.glowLevel[0] = 1;
  }

  /** 落定：脚下一圈金环、花瓣散开、第一声扫弦 */
  private landEntrance(): void {
    const ctx = this.ctx;
    this.pipa.getWorldPosition(_p);
    ctx.audio.play('pipa_chord', { position: _p, volume: 0.6 });
    ctx.fx.ring(_q.set(this.position.x, this.position.y - this.hoverHeight + 0.05, this.position.z), 2.2, C.note, 0.7);
    ctx.fx.burst(_p, C.petal, 16, 2.5, 1.2, 0.08, -0.5);
    const r = this.ripples.find((x) => x.t >= 1);
    if (r) r.t = 0;
    this.lastPluck = this.age;
  }

  private beginCast(state: string, windup: number, pitch: number): void {
    this.windTime = this.windup(windup, windup * 0.6);
    this.setState(state);
    this.pipa.getWorldPosition(_p);
    this.ctx.audio.play('pipa_roll', { position: _p, volume: 0.55, pitch: pitch * 1.2 });
  }

  /** 躲在同伴身后：同伴质心再往远离玩家的方向退几米；没有同伴就和玩家保持距离 */
  private positionBehindAllies(): void {
    const pl = this.ctx.player.position;
    let n = 0;
    _q.set(0, 0, 0);
    for (const e of this.auraTargets) {
      _q.add(e.position);
      n++;
    }
    if (n === 0 || this.silenced) {
      this.keepRange(KEEP_RANGE[0] + (this.silenced ? 4 : 0), KEEP_RANGE[1] + (this.silenced ? 6 : 0), this.speed);
      return;
    }
    _q.multiplyScalar(1 / n);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    const d = _v.length() || 1;
    _q.addScaledVector(_v, BEHIND_ALLIES / d);
    // 别贴近玩家：目标离玩家至少 KEEP_RANGE[0]
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    if (_v.length() < KEEP_RANGE[0]) _q.set(pl.x, _q.y, pl.z).addScaledVector(_v.normalize(), KEEP_RANGE[0]);
    if (Math.hypot(_q.x - this.position.x, _q.z - this.position.z) > 2) this.navigate(_q, this.speed, 1.5);
    else this.stopMoving();
  }

  private anyAlly(pred: (e: IEnemy) => boolean): boolean {
    for (const e of this.auraTargets) if (pred(e)) return true;
    return false;
  }

  /** 范围内最强（最大生命最高）的、还没被赐福的同伴 */
  private pickBlessTarget(): IEnemy | null {
    let best: IEnemy | null = null;
    for (const e of this.auraTargets) {
      if (registry.get(e as BuffAlly)?.blessedBy) continue;
      if (!best || e.maxHp > best.maxHp) best = e;
    }
    return best;
  }

  /** 天乐光环：每帧刷新范围内的同伴（进入的加上、离开的撤下），并处理赐福到期 */
  private updateAura(): void {
    const now = this.ctx.time.now;
    const live = _live;
    live.clear();
    if (!this.silenced && this.alive && this.stunTime <= 0) {
      const list = this.ctx.enemies.queryRadius(this.position, AURA_RANGE, _scratch);
      for (const e of list) if (e !== this && e.alive && !e.isBoss && !(e instanceof Apsara)) live.add(e);
      _scratch.length = 0;
    }
    for (const e of this.auraTargets) if (!live.has(e)) registry.removeAura(e as BuffAlly, this, now);
    this.auraTargets.clear();
    for (const e of live) {
      this.auraTargets.add(e);
      const b = registry.addAura(e as BuffAlly, this, now);
      if (!allyFx.has(e)) {
        // 脚下淡金光环：和赐福的金莲分两档，一眼区分「受加成」和「被赐福」
        const fx: AllyFx = { ring: GroundDecal.acquire(this.ctx.stageGroup, C.ward), lotus: null, halo: null };
        allyFx.set(e, fx);
        b.fx.onClear = () => {
          fx.ring.release();
          releaseBlessFx(fx);
          allyFx.delete(e);
        };
        b.fx.onUnbless = () => releaseBlessFx(fx);
      }
    }
    live.clear();
    registry.tick(now);
  }

  /** 撤下这只飞天给的全部加成（琴碎 / 死亡 / 清理） */
  private dropAllBuffs(): void {
    registry.dropSource(this, this.ctx.time.now);
    this.auraTargets.clear();
    this.blessTarget = null;
  }

  /** 莲花和弦：金色声环外扩，向范围内同伴各拉一道光弦，开出金莲护盾 */
  private castChord(): void {
    const ctx = this.ctx;
    this.releaseAt = this.age;
    this.pipa.getWorldPosition(_p);
    ctx.audio.play('pipa_chord', { position: _p, volume: 0.9 });
    ctx.fx.ring(this.position.clone(), AURA_RANGE, C.ward, 0.9);
    ctx.fx.burst(_p, C.petal, 24, 3, 1.0, 0.08, -1);
    const now = ctx.time.now;
    for (const e of this.auraTargets) {
      if (!e.alive) continue;
      const amount = Math.round(e.maxHp * CHORD_SHIELD * (this.isElite ? 1.3 : 1));
      e.maxShield += amount;
      e.shield = Math.min(e.maxShield, e.shield + amount);
      wardedUntil.set(e, now + CHORD_DURATION);
      e.getBodyCenter(_q);
      ctx.fx.beam(_p, _q, C.ward, 0.05, 0.6);
      ctx.fx.burst(_q, C.lotus, 18, 2.2, 0.9, 0.1, -1.5);
      ctx.fx.ring(_v.set(e.position.x, e.position.y + 0.05, e.position.z), Math.max(1.2, e.radius * 2.4), C.ward, 0.7);
      // CHORD_DURATION 秒后金莲护盾消散：只拿走这次给的、还没被打掉的那部分
      const target = e;
      ctx.tasks.delay(CHORD_DURATION, () => {
        wardedUntil.delete(target);
        if (!target.alive) return;
        target.shield = Math.max(0, target.shield - amount);
        target.maxShield = Math.max(target.shield, target.maxShield - amount);
        target.getBodyCenter(_q);
        ctx.fx.burst(_q, C.petal, 8, 1.6, 0.6, 0.07, -1);
      });
    }
  }

  /** 天女散花：花瓣从她手中撒向四周，范围内同伴回复最大生命 25% */
  private castBloom(): void {
    const ctx = this.ctx;
    this.releaseAt = this.age;
    // 旋身是加速转进去的（见 pose）：放出时正转得最快，换成角速度带着惯性转出去，再由弹簧拉回正
    this.bodySpin -= Math.PI * 2;
    this.spinVel = (Math.PI * 4) / Math.max(0.3, this.windTime);
    this.getBodyCenter(_p);
    ctx.audio.play('pipa_bloom', { position: _p, volume: 0.85 });
    ctx.fx.burst(_p, C.petal, 30, 4, 1.6, 0.09, -0.4);
    ctx.fx.burst(_p, C.petalPink, 24, 3.5, 1.8, 0.08, -0.3);
    ctx.fx.ring(this.position.clone(), AURA_RANGE, C.heal, 0.9);
    for (const e of this.auraTargets) {
      if (!e.alive) continue;
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * BLOOM_HEAL * (this.isElite ? 1.3 : 1));
      e.getBodyCenter(_q);
      ctx.fx.burst(_q, C.heal, 14, 1.8, 0.8, 0.09, -2);
      ctx.fx.burst(_q, C.petalPink, 8, 1.5, 1.2, 0.08, -0.5);
    }
  }

  /** 飞天赐福：金丝牵向最强的同伴，脚下开金莲、头顶浮起光环，10 秒内大幅强化 */
  private castBless(): void {
    const ctx = this.ctx, e = this.blessTarget;
    if (!e || !e.alive) return;
    this.releaseAt = this.age;
    registry.grantBless(e as BuffAlly, this, ctx.time.now + BLESS_DURATION, ctx.time.now);
    this.pipa.getWorldPosition(_p);
    e.getBodyCenter(_q);
    ctx.fx.beam(_p, _q, C.bless, 0.12, 0.8);
    ctx.fx.burst(_q, C.bless, 30, 3, 1.0, 0.12, -2);
    ctx.audio.play('pipa_bless', { position: _q, volume: 0.9 });
    // 脚下金莲（地面贴花，跟着走）、头顶光环（每帧摆到它头顶）
    const fx = allyFx.get(e);
    if (!fx) return;
    releaseBlessFx(fx);
    fx.lotus = GroundDecal.acquire(ctx.stageGroup, C.bless);
    fx.lotus.pattern = 1;
    fx.halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.035, 6, 32), new THREE.MeshBasicMaterial({
      color: C.bless, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    fx.halo.rotation.x = Math.PI / 2;
    ctx.stageGroup.add(fx.halo);
  }

  /**
   * 受击：打在琵琶上和打在身上的反应不同。
   * - 打身体：照常后仰，再顺着子弹方向侧摆一下、回弹（头慢半拍）。
   * - 打琵琶：身体几乎不仰，改成护琴——含胸、低头看琴、右手五指惊开、左手攥紧琴颈；琴身自己弹开（见 posePipa）。
   *   累计到琴碎伤害就炸琴，所有加成立刻消失（琴碎之后弱点挪到胸口，算打身体）。
   */
  protected override onHurt(r: DamageResult): void {
    const kick = this.hurtKick;
    super.onHurt(r);
    const onPipa = !this.silenced && this.alive && !!r.request.headshot;
    if (!onPipa) {
      const d = r.request.direction;
      if (d) {
        // 子弹往她左边（模型 +X）飞，就把她往左推
        const lat = d.x * Math.cos(this.facing) - d.z * Math.sin(this.facing);
        this.hitLat = THREE.MathUtils.clamp(lat, -1, 1) * (r.isCrit ? 1 : 0.65);
        this.bodyHitAt = this.age;
      }
      return;
    }
    this.hurtKick = kick + (this.hurtKick - kick) * 0.2;
    // 只有琵琶闪白（身体不闪），一眼分得清打中的是琴
    this.flashTimer = 0;
    this.pipaDamage += r.dealt;
    if (this.pipaDamage >= this.maxHp * PIPA_BREAK) {
      this.shatterPipa();
      return;
    }
    // 每 1/4 的琴碎伤害崩断一根弦（第四根随琴碎一起断）；没断弦的这一下就是闷响 + 琴身一震 + 琴轸一闪
    const want = Math.min(3, Math.floor((this.pipaDamage / (this.maxHp * PIPA_BREAK)) * 4));
    let snapped = false;
    while (this.stringsBroken < want) {
      this.snapString();
      snapped = true;
    }
    this.hitAt = this.age;
    this.hitSign = Math.random() < 0.5 ? -1 : 1;
    this.glowLevel[0] = 1;
    if (!snapped) {
      this.pipa.getWorldPosition(_p);
      this.ctx.audio.play('pipa_hit', { position: _p, volume: 0.8 });
    }
  }

  /** 崩断一根弦：从高音弦断起；断弦卷向琴码、甩出火星和一道细电光 */
  private snapString(): void {
    const s = this.strings[this.strings.length - 1 - this.stringsBroken];
    this.stringsBroken++;
    if (!s) return;
    s.snapT = 0;
    const ctx = this.ctx;
    s.m.getWorldPosition(_p);
    this.pipa.localToWorld(_q.set(s.m.position.x * 3, STRING_NUT_Y, STRING_NUT_Z + 0.25));
    ctx.fx.burst(_p, C.pegHot, 10, 2.5, 0.4, 0.04, 6);
    ctx.fx.lightning(_p, _q, C.note);
    ctx.audio.play('pipa_snap', { position: _p, volume: 0.9 });
  }

  private shatterPipa(): void {
    this.silenced = true;
    const ctx = this.ctx;
    this.pipa.getWorldPosition(_p);
    this.pipa.visible = false;
    this.cancelAttack();
    this.dropAllBuffs();
    ctx.fx.burst(_p, C.woodShard, 18, 5, 0.9, 0.07, 14);
    ctx.fx.burst(_p, C.pegHot, 12, 4, 0.5, 0.06, 6);
    for (let i = 0; i < 4; i++) {
      _q.set(_p.x + (Math.random() - 0.5) * 2, _p.y + (Math.random() - 0.3) * 1.5, _p.z + (Math.random() - 0.5) * 2);
      ctx.fx.lightning(_p, _q, C.note);
    }
    ctx.audio.play('pipa_snap', { position: _p, volume: 1, pitch: 0.8 });
    ctx.audio.play('shield_break', { position: _p, volume: 0.9, pitch: 1.5 });
    ctx.audio.play('boss_roar', { position: this.position, volume: 0.45, pitch: 2 });
    // 弱点挪到胸口（琵琶没了，打身体照常；胸口算爆头）
    this.setHeadAnchor(this.nativeBody?.pose.bone('chest') ?? this.body, 0, 0, 0);
    this.screamTime = 1.4;
    this.reformAt = this.age + PIPA_REFORM;
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.silenced = true;
    this.dropAllBuffs();
    if (attackDirector.purging) return;
    // 瓷身碎裂、金箔花瓣飘散，琵琶落地摔碎
    const ctx = this.ctx;
    const center = this.getBodyCenter(new THREE.Vector3());
    ctx.fx.burst(center, C.shard, 20, 4, 1.0, 0.08, 10);
    ctx.fx.burst(center, C.petal, 26, 2.5, 1.8, 0.07, -0.5);
    ctx.fx.burst(center, C.petalPink, 18, 2.2, 2.0, 0.07, -0.4);
    if (this.pipa.visible) {
      this.pipa.getWorldPosition(_p);
      ctx.fx.burst(_p, C.woodShard, 12, 3, 0.8, 0.07, 14);
      this.pipa.visible = false;
    }
    ctx.audio.play('shield_break', { position: center, volume: 0.7, pitch: 1.6 });
  }

  // ───────────── 动画 ─────────────

  private deathT = 0;
  private petalAcc = 0;

  /**
   * 死亡：像一片落叶旋着缓缓飘落（下落速度压住、身体慢慢转、微微后仰），身体舒展、长飘带继续飘；
   * 后半段边飘边化作金箔花瓣散去（缩小消失）。
   */
  protected override animateDeath(t: number): void {
    const dt = Math.max(0, (t - this.deathT) * this.deathDuration);
    this.deathT = t;
    if (this.velocity.y < -1.1) this.velocity.y = -1.1;
    this.velocity.x *= 0.96;
    this.velocity.z *= 0.96;
    this.model.rotation.set(-0.35 * smooth(t / 0.6), t * t * 3.2, 0.15 * Math.sin(t * 5));
    const fade = smooth((t - 0.45) / 0.55);
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (1 - fade)));
    // 动画照常跑（垂手、腿舒展、飘带飘动）
    if (dt > 0) this.pose(dt);
    this.petalAcc += dt * (4 + 30 * fade);
    while (this.petalAcc > 1) {
      this.petalAcc -= 1;
      this.getBodyCenter(_p);
      _p.x += (Math.random() - 0.5) * 0.6 * this.sizeScale;
      _p.y += (Math.random() - 0.3) * 0.8 * this.sizeScale;
      this.ctx.fx.burst(_p, Math.random() < 0.5 ? C.petal : C.petalPink, 1, 1.2, 1.6, 0.07, -0.3);
    }
    for (const r of this.ribbons) {
      r.mesh.visible = r.glow.visible = r.tip.visible = fade < 0.95;
      r.mesh.material.transparent = true;
      r.mesh.material.opacity = 1 - fade;
    }
  }


  protected override pose(dt: number): void {
    const st = this.state;
    const cast = clamp01(this.stateTime / Math.max(0.01, this.windTime));
    this.pRaise = this.eRaise.step(st === 'chordWindup' || (st === 'reform' && this.stateTime < REFORM_TIME * 0.7) ? 1 : 0, dt);
    // 出场前 70% 用散花的姿势（一手高扬、一手低展，琵琶绕身飞），再收回弹奏
    const enter = st === 'enter' ? clamp01(this.stateTime / ENTRANCE) : 1;
    this.pScatter = this.eScatter.step(st === 'bloomWindup' || enter < 0.7 ? 1 : 0, dt);
    this.pOffer = this.eOffer.step(st === 'blessWindup' ? 1 : 0, dt);
    this.pScream = this.eScream.step(this.screamTime > 0 ? 1 : 0, dt);
    // 散花：旋身一周（缓入缓出）；其余时候转回来
    // 预备：前摇头 30% 先往下一沉、含胸（吸气蓄势），再舒展开施法；收势：放出后身体一扬、仰头，再慢慢落回
    const winding = st === 'chordWindup' || st === 'bloomWindup' || st === 'blessWindup';
    this.anticip = winding && cast < 0.3 ? Math.sin(Math.PI * (cast / 0.3)) : 0;
    const ft = this.age - this.releaseAt;
    this.release = ft < 1.2 ? (1 - Math.exp(-ft * 30)) * Math.exp(-ft * 4.5) : 0;
    // 旋身：散花加速转进去（cast²，放出时转得最快）；出场缓转落定；其余时候欠阻尼弹簧回正（多转一点再回来）
    if (st === 'bloomWindup') {
      this.bodySpin = Math.PI * 2 * cast * cast;
      this.spinVel = 0;
    } else if (st === 'enter') {
      this.bodySpin = Math.PI * 1.5 * (1 - smooth(enter));
      this.spinVel = 0;
    } else {
      const h = Math.min(dt, 1 / 30), k = 7;
      this.spinVel += (-k * k * this.bodySpin - 2 * 0.6 * k * this.spinVel) * h;
      this.bodySpin += this.spinVel * h;
      if (Math.abs(this.bodySpin) < 1e-3 && Math.abs(this.spinVel) < 1e-2) this.bodySpin = this.spinVel = 0;
    }
    // 飘落：先快后慢（缓出），最后稳稳停在悬浮高度
    const fall = 1 - enter;
    this.model.position.y = ENTRANCE_HEIGHT * fall * fall * fall - 0.06 * this.anticip + 0.05 * this.release;
    this.pipaAppear = st === 'reform' ? smooth(clamp01(this.stateTime / (REFORM_TIME * 0.55))) : smooth(clamp01(enter / 0.45));
    this.posePipa(dt);
    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.body.rotation.set(-0.15 * this.pRaise, this.bodySpin, 0);
    this.updateFx(dt);
  }

  /**
   * 琵琶：平时悬在胸前，随她的浮动慢半拍、轻轻摆转；和弦时升到头顶飞旋；散花时绕身飞一圈；
   * 赐福时往目标那边送出一点、琴面朝向目标；每拨一下琴身轻颤。
   */
  private posePipa(dt: number): void {
    const k = 1 - Math.exp(-6 * dt);
    const t = this.age;
    const pr = this.pRaise, ps = this.pScatter, po = this.pOffer;
    _t.set(-0.03, 0.95 + 0.035 * Math.sin(t * BOB[1] - 0.8), 0.27);
    // 升到头顶：先往前送、再划弧上去（不从脸前直穿）
    if (pr > 0.001) bezier(_t, _w.copy(_t), _q.set(0, 1.55, 0.85), _v.set(0, 2.1, 0.12), pr);
    // 散花：绕身一圈（半径约 0.6，胸口高度）
    const orbit = t * 2.4;
    _t.lerp(_v.set(Math.sin(orbit) * 0.62, 1.15, Math.cos(orbit) * 0.62), ps);
    _t.lerp(_v.copy(this.offerDir).multiplyScalar(0.75).setY(0.98), po);
    this.pipaPos.lerp(_t, k);
    this.pipa.position.copy(this.pipaPos);
    // 被打中：琴身往后一弹、歪向一侧，再衰减着回摆
    const ht = t - this.hitAt;
    const jolt = ht < 0.6 ? Math.exp(-7 * ht) * Math.cos(22 * ht) : 0;
    this.pipa.position.z -= 0.05 * jolt;
    this.pipaSpin += dt * (0.4 + 8 * pr + 5 * ps);
    const sway = Math.sin(t * 0.55) * 0.18 * (1 - pr) * (1 - ps);
    const yaw = pr + ps > 0.05 ? this.pipaSpin * (pr + ps) : sway;
    const pluck = Math.max(0, 1 - (t - this.lastPluck) * 7) * 0.05;
    this.pipaRot.set(pluck - 0.15 * po, yaw, -0.3 * (1 - pr) * (1 - ps) + 0.04 * Math.sin(t * 0.9));
    this.pipa.rotation.copy(this.pipaRot);
    this.pipa.rotation.x -= 0.3 * jolt;
    this.pipa.rotation.z += 0.22 * jolt * this.hitSign;
    this.pipa.scale.setScalar(PIPA_SCALE * Math.max(0.001, this.pipaAppear) * (1 + 0.12 * this.release));
  }

  /**
   * 美术骨骼动画（creature_rigs/SK_Enemy_Apsara.json）。模型空间：X = 生物左侧，Y = 上，Z = 前。
   * - 身段：三道弯（髋、胸、头交替反向倾斜）随五秒一轮的呼吸缓缓起伏；浮动时身体随升降轻轻前后倾；
   *   移动时整体朝移动方向倾、转弯时侧倾（弹簧）；散花旋身一周；哀鸣时仰头、颤抖。
   * - 腿：飞天腿，一腿屈膝后翘、一腿舒展，脚尖绷直，十秒一轮缓慢交替；移动时往后拖。
   * - 手：IK 目标按姿势混合（弹奏 / 弧线举臂结印 / 散花 / 捧送 / 张开），手腕扭转让掌心对着要的方向，五指按手势弯曲；
   *   右手轮指（小指 → 食指依次弹出）、随拍沿琴弦划弧，左手按弦揉弦。
   * - 布料：裙摆和小臂下的短飘带有惯性，短飘带在 IK 之后按重力下垂。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
    const vz = this.velocity.x * sf + this.velocity.z * cf, vx = this.velocity.x * cf - this.velocity.z * sf;
    const h = Math.max(dt, 1e-3);
    const az = ((this.velocity.x - this.prevVel.x) * sf + (this.velocity.z - this.prevVel.z) * cf) / h;
    const ax = ((this.velocity.x - this.prevVel.x) * cf - (this.velocity.z - this.prevVel.z) * sf) / h;
    this.prevVel.copy(this.velocity);
    // 往前飞时前倾更多（飞天的飞行姿态），倒退 / 横移时倾得少
    const lx = this.leanX.step(THREE.MathUtils.clamp(vz * 0.07, -0.18, 0.36), dt);
    const lz = this.leanZ.step(THREE.MathUtils.clamp(-vx * 0.05, -0.2, 0.2), dt);
    const sx = this.skirtX.step(THREE.MathUtils.clamp(-az * 0.015 - vz * 0.05, -0.45, 0.45), dt);
    const sz = this.skirtZ.step(THREE.MathUtils.clamp(ax * 0.015 + vx * 0.05, -0.35, 0.35), dt);
    const pr = this.pRaise, ps = this.pScatter, po = this.pOffer, sc = this.pScream;
    const calm = (1 - pr) * (1 - ps) * (1 - sc);
    const tremble = sc * Math.sin(t * 43) * 0.02;
    // 受击包络：打琵琶 = 护琴（快起慢收）；打身体 = 侧摆回弹（衰减振荡）
    const ph = t - this.hitAt, bh = t - this.bodyHitAt;
    const guard = ph < 0.8 ? (1 - Math.exp(-ph * 35)) * Math.exp(-ph * 5) : 0;
    const sway = bh < 0.9 ? this.hitLat * (1 - Math.exp(-bh * 40)) * Math.exp(-bh * 6) * Math.cos(bh * 11) : 0;
    const swayLag = bh > 0.06 && bh < 0.96 ? this.hitLat * Math.exp(-(bh - 0.06) * 6) * Math.cos((bh - 0.06) * 11) : 0;
    this.guard = guard;

    // 身段：三道弯 + 呼吸（五秒一轮）；施法仰身；散花旋身；哀鸣仰头
    const br = Math.sin(t * (Math.PI * 2) / 5);
    const breath = Math.sin(t * 1.3);
    P.rotate('hips', AY, this.bodySpin + 0.1 * calm);
    P.rotate('hips', AX, lx + 0.035 * Math.cos(t * BOB[1]) - 0.06 * pr);
    P.rotate('hips', AZ, lz + (0.09 + 0.035 * br) * calm + 0.08 * sway);
    P.rotate('spine', AZ, (-0.06 - 0.02 * br) * calm);
    P.rotate('spine', AX, -0.06 * pr - 0.04 * sc + 0.02 * breath);
    P.rotate('chest', AZ, (-0.1 - 0.03 * br) * calm + tremble - 0.24 * sway);
    P.rotate('chest', AY, -0.12 * calm - 0.25 * ps * Math.sin(this.bodySpin));
    P.rotate('chest', AX, -0.1 * pr - this.hurtKick * 0.22 - 0.015 * breath - 0.05 * po);
    // 头：看向玩家（弹簧，慢半拍），侧倾听琴（随拨弦轻点头）；施法 / 哀鸣仰头
    const pl = this.ctx.player.position;
    let dyaw = Math.atan2(pl.x - this.position.x, pl.z - this.position.z) - this.facing;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const hy = this.headYaw.step(THREE.MathUtils.clamp(dyaw, -0.6, 0.6) * calm, dt);
    const nod = Math.max(0, 1 - (t - this.lastPluck) * 5) * 0.03 * calm;
    P.rotate('neck', AY, hy * 0.4);
    P.rotate('head', AY, hy * 0.35);
    P.rotate('neck', AZ, (0.05 + 0.02 * br) * calm);
    P.rotate('head', AZ, (0.1 + 0.035 * Math.sin(t * (Math.PI * 2) / 5 + 1)) * calm + tremble + 0.14 * swayLag);
    // 失琴后低着头
    const sad = this.silenced ? 1 - sc : 0;
    P.rotate('neck', AX, -0.1 * pr - 0.08 * ps - 0.15 * sc + 0.04 * po + 0.12 * sad + 0.2 * guard);
    P.rotate('chest', AX, 0.12 * guard + 0.14 * this.anticip - 0.16 * this.release);
    P.rotate('spine', AX, 0.06 * this.anticip - 0.05 * this.release);
    P.rotate('head', AX, -0.12 * pr - 0.1 * ps - 0.25 * sc + nod + 0.06 * po + 0.1 * sad + 0.1 * this.anticip - 0.1 * this.release);

    // 腿：飞天腿，一腿屈膝后翘、一腿舒展，十秒一轮缓慢交替；移动时往后拖
    const swap = this.eLegs.step(Math.sin(t * (Math.PI * 2) / 10) > 0 ? 1 : 0, dt);
    for (let i = 0; i < 2; i++) {
      const s = BN[i === 0 ? 'L' : 'R'];
      const bent = i === 0 ? swap : 1 - swap;     // 1 = 屈膝后翘，0 = 舒展
      const ph = t * 0.9 + i * 2.1;
      P.rotate(s.thigh, AX, mix(-0.18, 0.28, bent) + lx * 0.3 + 0.03 * Math.sin(ph));
      P.rotate(s.thigh, AZ, (i === 0 ? -1 : 1) * 0.04);
      P.rotate(s.shin, AX, mix(0.12, 1.05, bent) + lx * 0.6 + 0.04 * Math.sin(ph + 0.7));
      P.rotate(s.foot, AX, mix(0.55, 0.45, bent) + 0.04 * Math.sin(ph + 1.4));
      P.rotate(s.toe, AX, 0.18);
    }
    // 裙摆：惯性（弹簧）+ 轻轻飘动（慢）
    const flutter = (i: number): number => 0.04 * Math.sin(t * 1.6 + i * 1.3);
    P.rotate('skirt_F1', AX, Math.max(-0.1, sx) + flutter(0));
    P.rotate('skirt_F2', AX, sx * 0.6 + flutter(1));
    // 后片盖住屈起后翘的腿：小腿要从布里穿出来时把后片往后掀到刚好盖过去（正角 = 往后）
    P.rotate('skirt_B1', AX, Math.max(Math.min(0.1, sx) + flutter(2), this.backPanelLift(P)));
    P.rotate('skirt_B2', AX, sx * 0.6 + flutter(3));
    for (let j = 0; j < 2; j++) {
      const s = BN[j === 0 ? 'L' : 'R'], k = j === 0 ? 1 : -1;
      P.rotate(s.skirt1, AZ, k * Math.max(-0.05, sz * k) + flutter(4) * k);
      P.rotate(s.skirt2, AZ, sz * 0.6 + flutter(5) * k);
      P.rotate(s.skirt1, AX, sx * 0.5);
    }

    // 双手
    const kk = 1 - Math.exp(-14 * dt);
    const beat = ((t % LUNZHI) / LUNZHI);
    for (const hs of this.hands) {
      const left = hs.side === 'L', m = left ? 1 : -1, bn = BN[hs.side];
      // 姿势表里的手位（左手坐标，右手镜像）
      const v3 = (a: readonly number[], out: THREE.Vector3) => out.set(a[0] * m, a[1], a[2]);
      // 弹奏（或琴碎后垂手）
      // 弹奏手位贴着琵琶算（琵琶局部 → 模型空间，含它的浮动、摆转和缩放）：左手扣在琴颈旁，右手在琴腹右前方
      const playing = !this.silenced && this.pipa.visible;
      this.pipa.updateMatrix();
      const play = playing ? _hPlay.copy(left ? PIPA_NECK_HAND : PIPA_BODY_HAND).applyMatrix4(this.pipa.matrix) : v3(this.silenced ? HAND.hug : HAND.relax, _hPlay);
      if (playing) {
        if (left) play.add(_w.set(0.006 * Math.sin(t * 9), 0.004 * Math.sin(t * 9 + 1), 0));          // 揉弦
        else play.add(_w.set(0, -0.035 * Math.sin(Math.PI * smooth(beat)), 0.01 * Math.sin(Math.PI * 2 * beat))); // 沿弦划弧
      }
      _t.copy(play);
      // 举臂结印：先向两侧舒展再划弧上举（贝塞尔经过侧上方）
      if (pr > 0.001) bezier(_t, play, v3(HAND.side, _h1), v3(HAND.raise, _h2), pr);
      // 散花：一手高扬（左）、一手低展（右），随旋身起伏
      if (ps > 0.001) _t.lerp(v3(left ? HAND.scatterHi : HAND.scatterLo, _w).add(_v.set(0, 0.05 * Math.sin(t * 3 + (left ? 0 : 1.5)), 0)), ps);
      // 赐福：双手捧向目标（肩前方、掌心朝上）
      if (po > 0.001) {
        const sh = P.restPosition(bn.arm);
        if (sh) _t.lerp(_w.copy(sh).addScaledVector(this.offerDir, 0.36).add(_v.set(0.04 * m, -0.1, 0)), po);
      }
      if (sc > 0.001) _t.lerp(v3(left ? HAND.clutch : HAND.reach, _h1), sc);
      hs.target.lerp(_t, kk);
      P.twoBoneIK(bn.arm, bn.forearm, bn.hand, hs.target, 0);
      this.swivelElbow(P, hs.side, m);
      // 弹奏时手指朝琴：左手指尖越过琴颈、右手指尖朝琴弦
      const aimW = playing ? (1 - pr) * (1 - ps) * (1 - po) * (1 - sc) : 0;
      if (aimW > 0.01) {
        const goal = _h1.copy(left ? PIPA_NECK_AIM : PIPA_STRING_AIM).applyMatrix4(this.pipa.matrix);
        this.aimHand(P, hs.side, goal, aimW * 0.85);
      }
      const palmW = this.palmGoal(hs, left, pr, ps, po, sc, P);
      if (palmW > 0) this.twistWrist(P, hs.side, this.palmDir, palmW);
      // 手势
      const base: Curl = this.silenced ? GESTURE.relax : left ? GESTURE.press : GESTURE.relax;
      for (let f = 0; f < 5; f++) {
        let target = base[f];
        // 轮指：小指 → 无名指 → 中指 → 食指依次从勾起状态弹开，拇指稳住
        if (!left && !this.silenced && f > 0) {
          const start = (4 - f) * 0.16, u = beat - start;
          const flick = u >= 0 && u < 0.35 ? Math.sin((u / 0.35) * Math.PI) : 0;
          target = 0.55 - 0.55 * flick;
        }
        target = mix(target, GESTURE.mudra[f], pr);
        target = mix(target, GESTURE.offer[f], Math.max(ps, po));
        target = mix(target, left ? GESTURE.relax[f] + 0.25 : GESTURE.splay[f] + Math.sin(t * 37 + f) * 0.06, sc);
        // 护琴：右手五指惊开、左手攥紧琴颈
        if (this.guard > 0.01) target = left ? Math.min(1, target + 0.35 * this.guard) : mix(target, GESTURE.splay[f], 0.8 * this.guard);
        hs.curl[f] = mix(hs.curl[f], target, kk);
        const c = hs.curl[f], axis = hs.axes[f];
        const thumb = f === 0;
        P.rotate(bn.finger1[f], axis, c * (thumb ? 0.55 : 0.75));
        P.rotate(bn.finger2[f], axis, c * (thumb ? 0.6 : 0.95));
      }
    }
    // 小臂下的短飘带：布料始终受重力下垂（手臂举起时也一样），再叠一点惯性和飘动；在 IK 之后按当前朝向摆
    for (let j = 0; j < 2; j++) {
      const rb = BN[j === 0 ? 'L' : 'R'].ribbon;
      for (let i = 1; i <= 3; i++) {
        const a = P.hostPosition(rb[i], _h1);
        const cur = i < 3 ? P.hostPosition(rb[i + 1], _h2).sub(a) : a.sub(P.hostPosition(rb[i - 1], _h2));
        if (cur.lengthSq() < 1e-8) continue;
        cur.normalize();
        const goal = _h3.set(
          (0.3 * sz + 0.07 * Math.sin(t * 1.4 + i * 0.6) + 0.25 * ps * Math.sin(this.bodySpin)) * (0.6 + 0.3 * i),
          -1,
          (-0.35 * sx + 0.07 * Math.sin(t * 1.7 + i) - 0.3 * ps) * (0.6 + 0.3 * i),
        ).normalize();
        const axis = _h4.crossVectors(cur, goal);
        const sin = axis.length();
        if (sin < 1e-5) continue;
        P.rotateCurrent(rb[i], axis.divideScalar(sin), Math.atan2(sin, cur.dot(goal)));
      }
    }
  }

  /**
   * 后片要往后掀多少（弧度，0 = 不用掀）：在身体正中的竖直剖面上看，后片从挂点（skirt_B1）垂到下摆，
   * 双腿膝 → 踝之间够得着的点都要在后片前面；取它们相对挂点往后最大的角度，再留一点余量。
   * 在腿摆好之后、裙摆转动之前调用（这时后片还是绑定角度）。
   */
  private backPanelLift(P: NativePose): number {
    const b1 = P.hostPosition('skirt_B1', _k1), b2 = P.hostPosition('skirt_B2', _k2);
    const reach = 2 * b1.distanceTo(b2);
    const panel = Math.atan2(b1.z - b2.z, b1.y - b2.y);
    let need = -1;
    for (let j = 0; j < 2; j++) {
      const bn = BN[j === 0 ? 'L' : 'R'];
      const knee = P.hostPosition(bn.shin, _k3), ankle = P.hostPosition(bn.foot, _k4);
      for (let k = 0; k <= 4; k++) {
        _k2.lerpVectors(knee, ankle, k / 4);
        const dy = b1.y - _k2.y, dz = b1.z - _k2.z;
        // 后片只有一掌宽：横向离得远的（侧面）不管；挂点以上、够不着的也不管
        if (dy <= 0 || Math.abs(_k2.x - b1.x) > 0.16 || dy * dy + dz * dz > reach * reach) continue;
        need = Math.max(need, Math.atan2(dz, dy));
      }
    }
    return need < 0 ? 0 : Math.max(0, need + 0.1 - panel);
  }

  /** 绕「肩 → 腕」轴转整条手臂，把手肘摆到自然的下外侧略靠后（腕的位置不变）：IK 只沿用 A 字姿态的弯曲平面，伸向身前时手肘会折到里面 */
  private swivelElbow(P: NativePose, side: Side, m: number): void {
    const bn = BN[side];
    const sh = P.hostPosition(bn.arm, _s1);
    const el = P.hostPosition(bn.forearm, _s2);
    const axis = P.hostPosition(bn.hand, _s3).sub(sh);
    const len = axis.length();
    if (len < 1e-4) return;
    axis.divideScalar(len);
    const e = el.sub(sh);
    e.addScaledVector(axis, -e.dot(axis));
    const pole = _s4.set(0.6 * m, -1, -0.3);
    pole.addScaledVector(axis, -pole.dot(axis));
    if (e.lengthSq() < 1e-8 || pole.lengthSq() < 1e-8) return;
    e.normalize();
    pole.normalize();
    P.rotateCurrent(bn.arm, axis, Math.atan2(axis.dot(_q.crossVectors(e, pole)), e.dot(pole)));
  }

  /** 让手指（腕 → 中指根）转向 goal 点，权重 w；在腕关节处绕两者的公垂轴转 */
  private aimHand(P: NativePose, side: Side, goal: THREE.Vector3, w: number): void {
    const bn = BN[side];
    const wrist = P.hostPosition(bn.hand, _s1);
    const cur = P.hostPosition(bn.middle1, _s2).sub(wrist).normalize();
    const want = goal.sub(wrist).normalize();
    const axis = _s3.crossVectors(cur, want);
    const sin = axis.length();
    if (sin < 1e-5) return;
    P.rotateCurrent(bn.hand, axis.divideScalar(sin), Math.atan2(sin, cur.dot(want)) * w);
  }

  /** 这只手此刻掌心该朝哪（写进 palmDir，模型空间），返回权重；垂手时为 0（保持绑定姿势的掌心朝前） */
  private palmGoal(hs: HandState, left: boolean, raise: number, scatter: number, offer: number, scream: number, P: NativePose): number {
    const wrist = P.hostPosition(BN[hs.side].hand, _s1);
    const dir = this.palmDir.set(0, 0, 0);
    let w = 0;
    if (!this.silenced && this.pipa.visible) {
      // 弹奏：右手掌心对着琴腹、左手对着琴颈
      dir.set(this.pipaPos.x + (left ? 0.05 : -0.02), this.pipaPos.y + (left ? 0.18 : -0.08) * PIPA_SCALE, this.pipaPos.z).sub(wrist).normalize();
      w = 1;
    }
    const blend = (d: THREE.Vector3, k: number) => {
      if (k <= 0.01) return;
      dir.lerp(d.normalize(), k).normalize();
      w = Math.max(w, k);
    };
    blend(_q.set(left ? -1 : 1, 0, 0.2), raise);       // 结印：双掌相对
    blend(_q.set(0, 1, 0.2), scatter);                  // 散花：掌心朝上
    blend(_q.set(0, 0.7, 0.3), offer);                  // 捧送：掌心朝上、略朝前
    // 失琴：双手抱胸，掌心朝自己；哀鸣：捂胸的手掌心朝自己，伸出的手掌心朝前上
    blend(_q.set(0, 0, -1), this.silenced ? 1 - scream : 0);
    blend(left ? _q.set(0, 0, -1) : _q.set(0, 0.6, 1), scream);
    return w > 0.01 ? w : 0;
  }

  /** 扭转手腕，让掌心（绑定姿势下朝 +Z）转到 dir 在扭转平面上的投影方向 */
  private twistWrist(P: NativePose, side: Side, dir: THREE.Vector3, w: number): void {
    const bn = BN[side];
    const rest = P.restQuaternion(bn.hand);
    if (!rest) return;
    // 绕手掌自身的指向轴（腕 → 中指根）转：只调掌心朝向，不改手指指向
    const wrist = P.hostPosition(bn.hand, _s1);
    const axis = P.hostPosition(bn.middle1, _s2).sub(wrist).normalize();
    const q = P.hostQuaternion(bn.hand, _sq1).multiply(_sq2.copy(rest).invert());
    const palm = _s3.set(0, 0, 1).applyQuaternion(q);
    const a = palm.addScaledVector(axis, -palm.dot(axis));
    const b = _s4.copy(dir).addScaledVector(axis, -dir.dot(axis));
    if (a.lengthSq() < 1e-6 || b.lengthSq() < 1e-6) return;
    a.normalize();
    b.normalize();
    const ang = Math.atan2(axis.dot(_q.crossVectors(a, b)), a.dot(b));
    P.rotateCurrent(bn.hand, axis, THREE.MathUtils.clamp(ang, -1.8, 1.8) * w);
  }

  /** 按当前骨骼摆好飘带的身体碰撞体（尺寸按美术身体量的：胸宽约 0.12、裙摆下沿约 0.3，乘体型） */
  private updateBodyCaps(P: NativePose, s: number): readonly Capsule[] {
    const caps = this.bodyCaps, torso = caps[0];
    const hips = P.bone('hips'), chest = P.bone('chest');
    if (!hips || !chest) return NO_CAPS;
    // 飘带在世界坐标里模拟：碰撞体直接取骨骼的世界位置
    hips.getWorldPosition(torso.a);
    chest.getWorldPosition(torso.b);
    torso.a.y -= 0.3 * s;
    torso.ra = 0.27 * s;
    torso.rb = 0.13 * s;
    for (let i = 1; i < 3; i++) {
      const c = caps[i], bn = BN[i === 1 ? 'L' : 'R'];
      const thigh = P.bone(bn.thigh), foot = P.bone(bn.foot);
      if (!thigh || !foot) return NO_CAPS;
      thigh.getWorldPosition(c.a);
      foot.getWorldPosition(c.b);
      c.ra = 0.08 * s;
      c.rb = 0.05 * s;
    }
    return this.bodyCaps;
  }

  /** 特效：拨弦波纹、指尖光弦、牵向同伴的金丝、同伴身上的音符 / 光环 / 金莲、长飘带、琴轸 */
  private updateFx(dt: number): void {
    const ctx = this.ctx;
    FLAME_FX_TIME.value = ctx.time.now;
    const s = this.sizeScale, t = this.age;
    const playing = !this.silenced && this.alive && this.pipa.visible;
    // 每两轮轮指，最后一下（食指弹出）荡出一圈贴着琴面的淡金环
    const beat = (t % LUNZHI) / LUNZHI;
    if (playing && this.pRaise + this.pScatter < 0.3 && beat > 0.62 && t - this.lastPluck > LUNZHI * 1.8) {
      this.lastPluck = t;
      const r = this.ripples.find((x) => x.t >= 1);
      if (r) r.t = 0;
    }
    // 轮指的声音：每轮弹旋律里的一个音（施法升琴、散花时不弹），弹到的弦亮一下；断了几根弦就跑调几分
    const cycle = Math.floor(t / LUNZHI);
    if (cycle !== this.rollIndex) {
      this.rollIndex = cycle;
      const note = MELODY[cycle % MELODY.length];
      if (playing && note > 0 && this.state !== 'enter' && this.pRaise + this.pScatter < 0.3) {
        const detune = 1 + (Math.random() - 0.5) * 0.035 * this.stringsBroken;
        this.pipa.getWorldPosition(_p);
        ctx.audio.play('pipa_roll', { position: _p, volume: 0.32 * (1 - 0.15 * this.stringsBroken), pitch: 2 ** ((note - 74) / 12) * detune });
        const str = this.strings[3 - (Math.round((note - 74) / 3.5) % 4)];
        if (str && str.snapT < 0) str.pluck = 1;
      }
    }
    for (let i = 0; i < this.strings.length; i++) {
      const sg = this.strings[i];
      const m = sg.m;
      if (sg.snapT >= 0) {
        // 断弦：0.3 秒内缩成琴码处的一截短头、翘离琴面、抖几下，然后暗着挂在那
        sg.snapT += dt;
        const u = clamp01(sg.snapT / 0.3);
        const wob = Math.exp(-5 * sg.snapT) * Math.sin(30 * sg.snapT);
        m.scale.set(1, 1 - 0.78 * (1 - (1 - u) * (1 - u)), 1);
        m.rotation.set(sg.pitch + 0.9 * u + 0.4 * wob, 0, sg.tilt + 0.5 * wob * (i < 2 ? -1 : 1));
        m.material.opacity = 0.9 * (1 - u) + 0.18 * u;
        continue;
      }
      sg.pluck = Math.max(0, sg.pluck - dt * 2.5);
      const glow = Math.max(this.pRaise, this.pScatter, sg.pluck);
      m.material.opacity = (0.32 + 0.6 * glow) * (playing ? 1 : 0.4);
      m.scale.set(1 + 1.4 * sg.pluck * Math.abs(Math.sin(t * 90)), 1, 1);
    }
    for (const r of this.ripples) {
      if (r.t >= 1) {
        r.m.visible = false;
        continue;
      }
      r.t = Math.min(1, r.t + dt / 0.75);
      const e = 1 - (1 - r.t) * (1 - r.t);
      r.m.visible = true;
      r.m.position.set(0, -0.12, 0.08);
      r.m.scale.setScalar(0.05 + 0.17 * e);
      r.m.material.opacity = 0.5 * (1 - r.t) * (1 - r.t);
    }
    // 指尖光弦：右手食指、中指指尖 → 琴面
    const n = this.nativeBody;
    const th = this.threads;
    if (th) {
      // 朝向相机的细光带（约 1.2 厘米宽），亮点从指尖流进琴弦；弹到哪根弦就落在哪根弦上
      const on = playing && n ? 0.75 * (1 - this.pRaise) * (1 - this.pScatter) * (1 - this.pOffer) : 0;
      th.mesh.material.opacity = on * (0.75 + 0.25 * Math.sin(t * 17));
      const view = this.threadView;
      view.length = 0;
      if (on > 0.01 && n) {
        for (let i = 0; i < THREAD_BONES.length; i++) {
          const b = n.pose.bone(THREAD_BONES[i]);
          if (!b || !b.parent) continue;
          // 指尖：第二节骨骼再沿手指方向外推一节
          const pair = this.threadEnds[i];
          b.getWorldPosition(pair[0]);
          b.parent.getWorldPosition(_p);
          pair[0].lerp(_p, -0.9);
          // 落点：琴弦中段（从琴码往上 40%），两根光弦落在相邻的两根弦上
          const sg = this.strings[1 + i];
          const xb = STRING_X[1 + i][0], xn = STRING_X[1 + i][1];
          this.pipa.localToWorld(pair[1].set(
            xb + (xn - xb) * 0.4, STRING_BRIDGE_Y + (STRING_NUT_Y - STRING_BRIDGE_Y) * 0.4, STRING_BRIDGE_Z + (STRING_NUT_Z - STRING_BRIDGE_Z) * 0.4,
          ));
          if (sg && sg.snapT >= 0) continue; // 弦断了就不再连
          view.push(pair);
        }
      }
      th.update(view, 0.016 * s, t * 1.6, ctx.camera.getWorldPosition(_w));
    }
    // 牵向受加成同伴的金丝（从琵琶到同伴胸口，轻轻闪烁）+ 同伴身边飘起的音符
    const te = this.tethers;
    if (te) {
      // 端点用对象池：from 共用一个，to 每个同伴一个
      const ends = this.tetherEnds, alphas = this.tetherAlpha;
      ends.length = 0;
      alphas.length = 0;
      // 隔墙的同伴照常加成，只是金丝不穿墙画：每 0.2 秒查一次视线，挡住的丝在约 0.2 秒内淡出、露出来再淡入
      this.tetherLosTimer -= dt;
      const recheck = this.tetherLosTimer <= 0;
      if (recheck) this.tetherLosTimer = 0.2;
      const from = this.pipa.getWorldPosition(this.tetherFrom);
      for (const e of this.auraTargets) {
        const i = ends.length;
        if (i >= TETHER_POOL) break;
        const pair = (this.tetherPool[i] ??= [from, new THREE.Vector3()]);
        e.getBodyCenter(pair[1]);
        if (recheck || !this.tetherClear.has(e)) this.tetherClear.set(e, !ctx.world.segmentBlocked(from, pair[1]));
        const want = playing && this.tetherClear.get(e) ? 1 : 0;
        const a = THREE.MathUtils.damp(this.tetherVis.get(e) ?? 0, want, 12, dt);
        this.tetherVis.set(e, a);
        if (a < 0.01) continue;
        ends.push(pair);
        alphas.push(a);
      }
      // 离开光环的同伴不再记
      for (const e of this.tetherVis.keys()) {
        if (!this.auraTargets.has(e)) {
          this.tetherVis.delete(e);
          this.tetherClear.delete(e);
        }
      }
      te.update(ends, 0.045 * s, t, ctx.camera.getWorldPosition(_w), alphas);
      const k = ends.length;
      this.noteAcc += dt * k;
      while (this.noteAcc > 0.35 && this.auraTargets.size) {
        this.noteAcc -= 0.35;
        let pick = Math.floor(Math.random() * this.auraTargets.size), e: IEnemy | null = null;
        for (const a of this.auraTargets) if (pick-- === 0) { e = a; break; }
        if (!e) break;
        e.getBodyCenter(_q);
        _q.x += (Math.random() - 0.5) * e.radius * 2;
        _q.z += (Math.random() - 0.5) * e.radius * 2;
        ctx.fx.burst(_q, C.note, 1, 0.5, 1.0, 0.07, -1.5);
      }
    }
    // 同伴身上的加成提示跟着它走：脚下淡金光环；被赐福的再加金莲和头顶光环
    for (const e of this.auraTargets) {
      const fx = allyFx.get(e);
      if (!fx) continue;
      const r = Math.max(0.8, e.radius * 1.5);
      fx.ring.circle(e.position.x, e.position.y, e.position.z, r, r - 0.09);
      fx.ring.opacity = 0.4 + 0.12 * Math.sin(t * 3 + e.position.x);
      if (fx.halo) {
        fx.halo.position.set(e.position.x, e.position.y + e.height + 0.35, e.position.z);
        fx.halo.rotation.z = t * 1.5;
        fx.halo.scale.setScalar(Math.max(1, e.radius * 1.6) * (1 + 0.06 * Math.sin(t * 4)));
      }
      if (fx.lotus) {
        fx.lotus.circle(e.position.x, e.position.y, e.position.z, Math.max(1.4, e.radius * 2.2), Math.max(1.0, e.radius * 1.6));
        fx.lotus.time = t;
        fx.lotus.opacity = 0.55 + 0.15 * Math.sin(t * 3);
      }
    }
    // 长飘带：根部在两肩后，往身后略向外张开飘
    if (this.ribbons.length) {
      const burn = this.silenced ? Math.max(0, 1 - (1.4 - this.screamTime) * 0.3) * (this.screamTime > 0 ? 1 : 0.4) : 0.1 + 0.2 * Math.max(this.pRaise, this.pScatter);
      const cam = ctx.camera.getWorldPosition(_f1);
      const caps = n ? this.updateBodyCaps(n.pose, s) : NO_CAPS;
      for (let i = 0; i < this.ribbons.length; i++) {
        const r = this.ribbons[i];
        const m = i === 0 ? 1 : -1;
        const spin = this.facing + this.bodySpin;
        const back = _f2.set(-Math.sin(spin) + Math.cos(spin) * 0.5 * m, 0, -Math.cos(spin) - Math.sin(spin) * 0.5 * m).normalize();
        const anchor = _f3;
        const b = n?.pose.bone(BN[i === 0 ? 'L' : 'R'].arm);
        if (b) b.getWorldPosition(anchor);
        else this.localPoint(0.22 * m, 1.25, -0.05, anchor);
        anchor.addScaledVector(back, 0.1 * s);
        r.update(dt, anchor, back, s, this.age + i * 1.7, burn, cam, caps);
      }
    }
    // 琵琶受击闪白（盖过基类每帧复位的颜色；0.12 秒）
    const ft = t - this.hitAt;
    if (ft < 0.12) {
      for (const f of this.pipaFlash) {
        f.mat.emissive.setRGB(1, 1, 1);
        f.mat.emissiveIntensity = 0.3 + 1.8 * (1 - ft / 0.12);
      }
    }
    // 琴轸：随施法变亮
    for (const p of this.pegs) p.scale.setScalar(1 + 0.25 * clamp01(this.glowLevel[0]));
  }
}

/** 正在被金莲护盾保护的同伴 → 到期时间（避免重复叠盾） */
const wardedUntil = new WeakMap<IEnemy, number>();
