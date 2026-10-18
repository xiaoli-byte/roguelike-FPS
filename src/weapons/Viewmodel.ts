/**
 * 第一人称武器模型：挂在 ctx.viewCamera 下（相机在原点朝 −Z），右下持枪。
 *
 * 动画：呼吸摆动、移动晃动、鼠标惯性、横移倾斜、跳跃 / 落地、冲刺姿态、开火后坐、
 * 换弹（按 ReloadStyle）、切枪收放、机炮转管、霰弹泵动、左轮转轮、弩弦上弦、
 * 元素轮转（灵纹改色 + 转轮对准下一发）、蓄力（线圈加速、颤动与枪口聚光）、
 * 碎刃由 demonBlade/BladeView 负责（持刀姿态、三段斩、剑指、128 片碎刃、刀光），这里只叠通用摆动。
 * 枪口火焰为加法混合精灵；武器场景里一个复用的 PointLight 照亮枪身。
 * 主场景不再放枪口点光源（主场景点光源数量会让所有受光材质的片元开销上升，集成阶段要求压缩）。
 */
import * as THREE from 'three';
import type { Element, GameContext, WeaponInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp, clamp01, damp, DEG, lerp, TAU } from '../core/math';
import { getWeaponDef, type WeaponDef } from './WeaponDefs';
import { boxGeo, buildGunModel, getFlashTexture, setCrossbowString, solidMat, type GunModel } from './WeaponModels';
import { BladeView, createBladePoseInput, type BladePoseInput } from './demonBlade/BladeView';
import { AssetLibrary } from '../assets/AssetLibrary';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import { attachStaticPart } from '../assets/StaticAttachment';
import { WEAPON_HANDLING, sampleLoadingHand, type HandPose } from './WeaponHandling';
import { addReloadBreech } from './ReloadBreech';

export interface ViewmodelState {
  aimT: number;
  /** 切枪：0 = 正常持枪，1 = 完全收下 */
  lowerT: number;
  reloading: boolean;
  /** 换弹进度 0..1；逐发装填时为当前一发的进度 */
  reloadP: number;
  /** 逐发装填中 */
  shellMode: boolean;
  /** 逐发装填时，当前是否为本次换弹的第一发（之后各发从装填口起手） */
  firstShell: boolean;
  /** 持续开火（光束 / 机炮 / 蓄力中） */
  firing: boolean;
  /** 机炮转速 0..1；蓄力武器为蓄力进度 0..1 */
  spin: number;
  /** 狙击开镜，隐藏模型 */
  scoped: boolean;
  /** 距上次开火的秒数 */
  sinceShot: number;
  /** 弩上弦进度 0..1（1 = 已上弦） */
  cock: number;
  /** 元素轮转：下一发的元素（能量槽显示该元素色）；非轮转武器为 null */
  elementHint: Element | null;
  /** 元素轮转：弹巢进度（转轮对准下一发所在弹膛）；非轮转武器为 −1 */
  cycleIndex: number;

  /** 碎刃：控制器的姿态输入（WeaponSystem 每帧写入；其他武器为 null） */
  blade: BladePoseInput | null;
}

/** ViewmodelState 默认值（WeaponSystem 持有一份并逐帧改写） */
export function createViewmodelState(): ViewmodelState {
  return {
    aimT: 0, lowerT: 0, reloading: false, reloadP: 0, shellMode: false, firstShell: true, firing: false, spin: 0, scoped: false, sinceShot: 99, cock: 1,
    elementHint: null, cycleIndex: -1,
    blade: null,
  };
}

interface VmEntry {
  uid: number;
  def: WeaponDef;
  gun: GunModel;
  /** 本模型独享的能量槽材质（脉动） */
  energyMat: THREE.MeshBasicMaterial;
  /** 美术手臂的实例材质 */
  armMats: THREE.MeshStandardMaterial[];
  leftArm: THREE.Object3D | null;
  support: THREE.Vector3;
  loadOffset: THREE.Vector3;
  /** 逐发装填时手里实际可见的弹壳 / 双管弹药。 */
  rounds: THREE.Group | null;
  breech: THREE.Group | null;
  ownedGeometry: THREE.BufferGeometry[];
  baseColor: THREE.Color;
  magBase: THREE.Vector3;
  magRotX: number;
  pumpBase: number;
  /** 碎刃的第一人称表现；其他武器为 null */
  blade: BladeView | null;
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _tint = new THREE.Color();
const _axis = new THREE.Vector3();
const _euler = new THREE.Euler();
const _handPose: HandPose = { x: 0, y: 0, z: 0, roll: 0, pitch: 0 };
const _supportPoint: [number, number, number] = [0, 0, 0];
const _loadPoint: [number, number, number] = [0, 0, 0];
const _v2 = new THREE.Vector3();
/** 碎刃不在挥砍等状态时的默认姿态输入 */
const BLADE_IDLE = createBladePoseInput();

/**
 * 第一人称枪模相对建模尺寸的整体缩放。
 * 开镜位置同步乘以该系数（相机原点处的等比缩放不改变投影），所以开镜画面与缩放前完全一致；
 * 腰射时枪模以握把为锚点缩小，并整体再往右下挪一点。
 * 实测（1280×720，viewCamera FOV 60，腰射静止）：冲锋枪屏幕覆盖 6.6% → 4.1%（线性约缩小 21%），
 * 外接框左上角 (767,452) → (815,504)；各武器枪管延长线都穿过准星（偏差 ≤ 2 像素）。
 */
const VM_SCALE = 0.76;
/** 腰射锚点的额外右下偏移（相机空间，米） */
const HIP_SHIFT_X = 0.024;
const HIP_SHIFT_Y = -0.02;

/** 袖子底色：深色布料，只混入少量英雄主题色 */
const SLEEVE_BASE = 0x2b2a2f;
const SLEEVE_TINT = 0.3;

const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 换弹倾斜包络：进入 0–15%，保持，82–100% 退出 */
function reloadEnvelope(p: number): number {
  return smooth(p / 0.15) * (1 - smooth((p - 0.82) / 0.18));
}

/** 弹匣离位曲线：12–38% 取出，38–55% 离位，55–78% 装入 */
function magCurve(p: number): number {
  if (p < 0.12) return 0;
  if (p < 0.38) return smooth((p - 0.12) / 0.26);
  if (p < 0.55) return 1;
  if (p < 0.78) return 1 - smooth((p - 0.55) / 0.23);
  return 0;
}

/**
 * 第一人称手套与袖子的材质。袖子是偏暗的布料色，只带一点英雄主题色倾向；主题色本身只用在袖口的一圈细滚边上，
 * 避免整条手臂变成一大块高饱和色块（例如赤狐的橙色）。dim < 1 时袖子再压暗（碎刃）。
 */
function armMaterials(heroColor: number, dim = 1): { glove: THREE.Material; cuff: THREE.Material; sleeve: THREE.Material; trim: THREE.Material } {
  const glove = solidMat(0x2e241e, 0.05, 0.9);
  const cuff = solidMat(0x1b1714, 0.1, 0.8);
  _c.setHex(SLEEVE_BASE).lerp(_tint.setHex(heroColor), SLEEVE_TINT).multiplyScalar(0.85 * dim);
  const sleeve = solidMat(_c.getHex(), 0.02, 0.92);
  _c.setHex(heroColor).multiplyScalar(0.62);
  const trim = solidMat(_c.getHex(), 0.1, 0.7);
  return { glove, cuff, sleeve, trim };
}

/** 往 parent 下加一块手臂方块 */
function armBox(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz = 0): void {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.name = 'arm';
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
}

/**
 * 程序化第一人称手臂（一侧）。分组名 arm_r / arm_l 也是美术资产（SM_Arms_<英雄><R|L>）的挂点名：
 * 右手在握把处，坐标就是枪模坐标（分组放在枪模原点）；左手以左手握点为原点（分组放到 gun.leftHand）。
 */
export function buildArm(side: 'r' | 'l', heroColor: number): THREE.Group {
  const { glove, cuff, sleeve, trim } = armMaterials(heroColor);
  const g = new THREE.Group();
  g.name = side === 'r' ? 'arm_r' : 'arm_l';
  const mk = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz = 0): void =>
    armBox(g, mat, w, h, d, x, y, z, rx, ry, rz);
  /** 袖口滚边：紧贴护腕、沿前臂方向后移一点的一圈细带 */
  const band = (size: number, x: number, y: number, z: number, rx: number, ry: number): void => {
    _axis.set(0, 0, 1).applyEuler(_euler.set(rx, ry, 0));
    mk(trim, size, size, 0.016, x + _axis.x * 0.03, y + _axis.y * 0.03, z + _axis.z * 0.03, rx, ry);
  };
  if (side === 'r') {
    // 右手：握把
    mk(glove, 0.052, 0.078, 0.07, 0.003, -0.05, 0.034, -0.3, 0);
    mk(glove, 0.018, 0.018, 0.045, -0.024, -0.008, 0.018, -0.2, 0.3);
    mk(cuff, 0.074, 0.074, 0.045, 0.024, -0.098, 0.1, 0.62, 0.38);
    band(0.078, 0.024, -0.098, 0.1, 0.62, 0.38);
    mk(sleeve, 0.07, 0.07, 0.34, 0.075, -0.165, 0.2, 0.62, 0.38);
  } else {
    // 左手：护木 / 前握把（以握点为原点）
    mk(glove, 0.054, 0.046, 0.085, -0.006, -0.022, 0, 0, 0);
    mk(glove, 0.012, 0.03, 0.07, 0.03, -0.006, 0, 0, 0);
    mk(cuff, 0.072, 0.072, 0.045, -0.034, -0.068, 0.058, 0.6, -0.5);
    band(0.076, -0.034, -0.068, 0.058, 0.6, -0.5);
    mk(sleeve, 0.068, 0.068, 0.4, -0.094, -0.15, 0.162, 0.6, -0.5);
  }
  return g;
}

/**
 * 给枪模装上第一人称手臂。
 * - 碎刃：拳头横握刀柄；返回前臂节点（腕部为原点、袖子挂在下面）：挥砍时手腕翻转幅度很大，袖子若随手腕整体旋转
 *   会像一块木板扫进画面，所以 Viewmodel 每帧让它只跟随刀姿旋转的 FOREARM_FOLLOW。美术手臂是握枪姿势，碎刃保持程序化手臂。
 * - 其他武器：左右手（buildArm）；该英雄有美术手臂资产（bind = fp / 英雄 id / arm_r|arm_l）时换上美术网格，
 *   返回它们的实例材质（换枪时释放）。
 */
function addArms(gun: GunModel, heroColor: number, heroId: string | undefined, renderer: THREE.WebGLRenderer, defId: string): { forearm: THREE.Object3D | null; mats: THREE.MeshStandardMaterial[] } {
  const r = gun.root;
  const handling = WEAPON_HANDLING[defId];
  const right = buildArm('r', heroColor);
  if (handling) {
    right.position.fromArray(handling.right);
    right.rotation.x = handling.rightPitch;
  }
  r.add(right);
  if (gun.leftHand || handling?.support) {
    const left = buildArm('l', heroColor);
    if (gun.leftHand) {
      left.position.copy(gun.leftHand);
      if (gun.leftParent) {
        gun.leftParent.updateMatrix();
        left.position.applyMatrix4(gun.leftParent.matrix);
      }
    } else left.position.fromArray(handling.support!);
    left.rotation.z = handling?.leftRoll ?? 0;
    // 握点跟随泵动，但手不直接挂在泵上：换弹时可以独立离开护木。
    r.add(left);
  }
  const mats: THREE.MeshStandardMaterial[] = [];
  if (!heroId) return { forearm: null, mats };
  for (const asset of AssetLibrary.findAttachments('fp', heroId)) {
    const part = attachStaticPart(r, asset);
    if (!part) continue;
    for (const m of part.materials) {
      applyArtEnvironment(m, renderer);
      mats.push(m);
    }
    part.lod.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  }
  return { forearm: null, mats };
}

export class Viewmodel {
  /** 挂在 viewCamera 下 */
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly entries = new Map<number, VmEntry>();
  private cur: VmEntry | null = null;
  private visible = false;

  private readonly flash: THREE.Sprite;
  private readonly flashMat: THREE.SpriteMaterial;
  /** 武器场景枪口闪光（照亮枪身） */
  private readonly vmLight: THREE.PointLight;

  // 动画状态
  private bobPhase = 0;
  private move = 0;
  private swayX = 0;
  private swayY = 0;
  private roll = 0;
  private fwdLag = 0;
  private vyLag = 0;
  private land = 0;
  private dashT = 0;
  private airT = 0;
  private kickZ = 0;
  private kickRot = 0;
  private kickRoll = 0;
  private reloadTilt = 0;
  private magOut = 0;
  private shellT = 0;
  private shellBump = 0;
  private prevReloadP = 0;
  private cylAngle = 0;
  private cylTarget = 0;
  /** 换枪后第一帧把轮转武器的转轮直接对准当前弹膛 */
  private cylSnap = false;
  private rackT = 99;
  private flashT = 0;
  private flashDur = 0.05;
  private lightI = 0;

  constructor(private readonly ctx: GameContext) {
    this.root.name = 'viewmodel';
    this.root.add(this.pivot);
    this.root.visible = false;
    this.flashMat = new THREE.SpriteMaterial({
      map: getFlashTexture(),
      color: 0xffc070,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.flash = new THREE.Sprite(this.flashMat);
    // 略微置于枪口前方，减少被枪管遮挡
    this.flash.position.set(0, 0, -0.04);
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.vmLight = new THREE.PointLight(0xffc080, 0, 1.4, 2);
    this.root.add(this.vmLight);
  }

  init(): void {
    this.ctx.viewCamera.add(this.root);
    this.ctx.events.on('player:landed', ({ fallSpeed }) => {
      this.land += Math.min(0.05, Math.max(0, fallSpeed) * 0.0035);
    });
    this.ctx.events.on('player:jumped', () => {
      this.land -= 0.012;
    });
    // 暂停 / 模态框期间武器场景仍在渲染但不再更新：别让一帧枪口火焰定格在菜单底下
    this.ctx.events.on('game:stateChanged', ({ to }) => {
      if (to !== 'playing') this.killFlash();
    });
  }

  get currentUid(): number {
    return this.cur ? this.cur.uid : -1;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.visible = v && !!this.cur;
    if (!v) this.killFlash();
  }

  /** 切换显示的武器（同一把直接返回） */
  setWeapon(inst: WeaponInstance | null): void {
    if (!inst) {
      if (this.cur) this.pivot.remove(this.cur.gun.root);
      this.cur = null;
      return;
    }
    if (this.cur && this.cur.uid === inst.uid) return;
    if (this.cur) this.pivot.remove(this.cur.gun.root);
    let e = this.entries.get(inst.uid);
    if (!e) {
      e = this.build(inst);
      this.entries.set(inst.uid, e);
    }
    this.cur = e;
    this.pivot.add(e.gun.root);
    e.gun.muzzle.add(this.flash);
    this.flash.visible = false;
    this.cylAngle = this.cylTarget = 0;
    this.cylSnap = true;
    this.magOut = 0;
    this.reloadTilt = 0;
    this.shellT = 0;
    if (e.gun.cylinder) e.gun.cylinder.rotation.z = 0;
    e.blade?.resetAnim();
  }

  /** 释放不再持有的武器模型 */
  prune(keep: readonly (WeaponInstance | null)[]): void {
    for (const [uid, e] of this.entries) {
      if (e === this.cur) continue;
      if (keep.some((w) => w !== null && w.uid === uid)) continue;
      this.disposeEntry(e);
      this.entries.delete(uid);
    }
  }

  /** 丢弃全部缓存模型（新开一局，英雄袖色可能变化） */
  resetModels(): void {
    if (this.cur) this.pivot.remove(this.cur.gun.root);
    this.cur = null;
    for (const e of this.entries.values()) this.disposeEntry(e);
    this.entries.clear();
    this.clearTransient();
  }

  /** 清空瞬时动画（换关 / 开局） */
  clearTransient(): void {
    this.kickZ = this.kickRot = this.kickRoll = 0;
    this.reloadTilt = this.magOut = this.shellT = this.shellBump = 0;
    this.land = this.vyLag = 0;
    this.rackT = 99;
    this.killFlash();
    this.cur?.blade?.resetAnim();
  }

  /** 当前显示的碎刃（第一人称）；不是碎刃时为 null */
  bladeView(): BladeView | null {
    return this.cur?.blade ?? null;
  }

  private killFlash(): void {
    this.flashT = 0;
    this.lightI = 0;
    this.flash.visible = false;
    this.vmLight.intensity = 0;
  }

  private disposeEntry(e: VmEntry): void {
    e.gun.root.removeFromParent();
    if (this.flash.parent && this.flash.parent === e.gun.muzzle) e.gun.muzzle.remove(this.flash);
    e.energyMat.dispose();
    e.gun.artGlow?.dispose(); // 美术枪模、美术手臂的实例材质（贴图共享，不在这里释放）
    for (const m of e.armMats) m.dispose();
    for (const g of e.ownedGeometry) g.dispose();
    e.blade?.dispose();
  }

  private build(inst: WeaponInstance): VmEntry {
    const def = getWeaponDef(inst.defId);
    if (def.blade) return this.buildBlade(inst);
    const gun = buildGunModel(inst.defId, inst.rarity, inst.element);
    const base = new THREE.Color(ELEMENT_COLORS[inst.element]);
    const energyMat = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false });
    for (const m of gun.energy) m.material = energyMat;
    const arms = addArms(gun, this.ctx.player.hero?.color ?? 0x5a6a7a, this.ctx.player.hero?.id, this.ctx.renderer, def.id);
    const armMats = arms.mats;
    const leftArm = gun.root.getObjectByName('arm_l') ?? null;
    const support = leftArm?.position.clone() ?? new THREE.Vector3();
    const loadOffset = new THREE.Vector3().fromArray(WEAPON_HANDLING[def.id]?.load ?? [0, 0, 0]);
    if (gun.mag) {
      gun.root.updateMatrixWorld(true);
      gun.mag.getWorldPosition(_v);
      gun.root.worldToLocal(_v);
      loadOffset.sub(_v);
    }
    let rounds: THREE.Group | null = null;
    let breech: THREE.Group | null = null;
    const ownedGeometry: THREE.BufferGeometry[] = [];
    if (leftArm && def.reloadStyle === 'shell') {
      rounds = new THREE.Group();
      rounds.name = 'reload.rounds';
      for (let i = 0; i < (def.id === 'magmashot' ? 2 : 1); i++) {
        const shell = new THREE.Mesh(boxGeo(0.013, 0.013, 0.052), solidMat(0xb86b32, 0.4, 0.5));
        shell.position.set(i * 0.018, 0.014, -0.025);
        rounds.add(shell);
      }
      rounds.visible = false;
      leftArm.add(rounds);
    }
    // 双管折开式枪：在已完成美术绑定后增设运行时铰链，白模骨架指纹保持原样。
    if (def.id === 'magmashot') breech = addReloadBreech(gun.root, ownedGeometry);
    gun.root.scale.setScalar(VM_SCALE);
    gun.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    return {
      uid: inst.uid,
      def,
      gun,
      energyMat,
      armMats,
      leftArm, support, loadOffset, rounds, breech, ownedGeometry,
      baseColor: base,
      magBase: gun.mag ? gun.mag.position.clone() : new THREE.Vector3(),
      magRotX: gun.mag ? gun.mag.rotation.x : 0,
      pumpBase: gun.pump ? gun.pump.position.z : 0,
      blade: null,
    };
  }

  /** 碎刃：BladeView 自带刀模、双手与刀光；关键帧是相机空间的真实位置，不做 VM_SCALE 缩放 */
  private buildBlade(inst: WeaponInstance): VmEntry {
    const def = getWeaponDef(inst.defId);
    const view = new BladeView(this.ctx, this.ctx.player.hero?.color ?? 0x5a6a7a);
    // 英雄的美术手臂：右手拳握刀柄、左手并掌作剑指（实例材质随刀模释放）
    const heroId = this.ctx.player.hero?.id;
    const armMats = heroId ? view.attachArtArms(AssetLibrary.findAttachments('fp', heroId), this.ctx.renderer) : [];
    const root = new THREE.Group();
    root.name = 'viewmodel.demonBlade';
    root.add(view.root);
    const gun: GunModel = {
      root, muzzle: view.model.tip, mag: null, cylinder: null, cylinderSteps: 6, spinner: null, pump: null, bolt: null,
      stringHalves: null, stringTip: null, energy: [], leftHand: null, leftParent: null, artGlow: null, blade: null,
    };
    return {
      uid: inst.uid, def, gun,
      energyMat: new THREE.MeshBasicMaterial({ toneMapped: false }),
      armMats, leftArm: null, support: new THREE.Vector3(), loadOffset: new THREE.Vector3(), rounds: null, breech: null,
      ownedGeometry: [], baseColor: new THREE.Color(ELEMENT_COLORS[inst.element]), magBase: new THREE.Vector3(), magRotX: 0, pumpBase: 0,
      blade: view,
    };
  }

  // ───────────── 事件 ─────────────

  /** 开火：后坐、枪口火焰、闪光 */
  onShot(def: WeaponDef, color: number, strength = 1): void {
    const k = def.kick;
    this.kickZ = Math.min(this.kickZ + k.back * strength, k.back * 2.4);
    this.kickRot = Math.min(this.kickRot + k.rot * strength, k.rot * 2.4);
    this.kickRoll += (Math.random() - 0.5) * k.rot * 0.4 * strength;
    const e = this.cur;
    if (e && e.gun.cylinder) this.cylTarget += TAU / e.gun.cylinderSteps;
    if (def.flash > 0) {
      // 强度 < 1（未蓄满的蓄力射击）时火焰与闪光相应减弱
      const sk = 0.5 + 0.5 * strength;
      this.flashDur = def.flash > 0.2 ? 0.07 : 0.05;
      this.flashT = this.flashDur;
      this.flash.scale.setScalar(def.flash * (0.8 + Math.random() * 0.45) * sk);
      this.flashMat.rotation = Math.random() * TAU;
      this.flashMat.color.setHex(color);
      this.vmLight.color.setHex(color);
      this.lightI = 1;
    }
  }

  /** 空仓扣扳机：轻微抖动 */
  dryKick(): void {
    this.kickRot += 0.02;
  }

  /** 霰弹：压入一发 */
  shellInserted(): void {
    this.shellBump = 1;
  }

  /** 霰弹：装填结束后上膛（泵动一次） */
  rack(): void {
    this.rackT = 0;
  }

  // ───────────── 每帧 ─────────────

  update(dt: number, s: ViewmodelState): void {
    const e = this.cur;
    this.root.visible = this.visible && !!e && !s.scoped;
    if (!e) {
      this.updateLights(dt, s);
      return;
    }
    const ctx = this.ctx;
    const p = ctx.player;
    const def = e.def;
    const time = ctx.time.now;

    // ── 移动晃动 ──
    const vx = p.velocity.x, vz = p.velocity.z;
    const hs = Math.hypot(vx, vz);
    const grounded = p.onGround;
    this.move = damp(this.move, grounded ? clamp01(hs / 7.5) : 0, 10, dt);
    if (grounded) this.bobPhase += dt * hs * 1.55;
    const aimK = 1 - 0.85 * s.aimT;
    const bobX = Math.sin(this.bobPhase) * 0.011 * this.move * aimK;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.011 * this.move * aimK;
    const bobRoll = Math.sin(this.bobPhase) * 0.018 * this.move * aimK;
    const breath = Math.sin(time * 1.6) * 0.0032 * aimK;

    // ── 鼠标惯性 ──
    const inp = ctx.input;
    const mdx = inp.enabled ? inp.mouseDX : 0;
    const mdy = inp.enabled ? inp.mouseDY * (ctx.settings.invertY ? -1 : 1) : 0;
    this.swayX = damp(this.swayX, clamp(-mdx * 0.00042, -0.05, 0.05), 10, dt);
    this.swayY = damp(this.swayY, clamp(mdy * 0.00042, -0.04, 0.04), 10, dt);

    // ── 横移倾斜 / 前后 / 垂直惯性 ──
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const lateral = vx * cy - vz * sy;
    const forward = -vx * sy - vz * cy;
    this.roll = damp(this.roll, clamp(-lateral * 0.009, -0.07, 0.07), 8, dt);
    this.fwdLag = damp(this.fwdLag, clamp(forward * 0.0022, -0.02, 0.02), 6, dt);
    this.vyLag = damp(this.vyLag, clamp(-p.velocity.y * 0.0022, -0.03, 0.03), 7, dt);
    this.land = damp(this.land, 0, 8, dt);
    this.dashT = damp(this.dashT, p.isDashing ? 1 : 0, 14, dt);
    this.airT = damp(this.airT, grounded ? 0 : 1, 7, dt);

    // ── 后坐恢复 ──
    this.kickZ = damp(this.kickZ, 0, 15, dt);
    this.kickRot = damp(this.kickRot, 0, 12, dt);
    this.kickRoll = damp(this.kickRoll, 0, 12, dt);
    this.shellBump = damp(this.shellBump, 0, 10, dt);

    // ── 换弹 ──
    const fullReload = s.reloading && !s.shellMode;
    const rp = fullReload ? s.reloadP : 0;
    this.reloadTilt = damp(this.reloadTilt, fullReload ? reloadEnvelope(rp) : 0, 18, dt);
    this.magOut = damp(this.magOut, fullReload ? magCurve(rp) : 0, 20, dt);
    this.shellT = damp(this.shellT, s.shellMode ? 1 : 0, 10, dt);
    if (!e.blade && fullReload && this.prevReloadP < 0.8 && rp >= 0.8) {
      this.kickRot -= 0.05;
      this.land += 0.01;
    }
    this.prevReloadP = rp;

    // ── 组合姿态 ──
    const hip = def.viewOffset, aim = def.aimOffset;
    const lowE = smooth(s.lowerT);
    const swayK = 1 - 0.6 * s.aimT;
    const kz = this.kickZ * VM_SCALE;
    let x = lerp(hip[0] + HIP_SHIFT_X, aim[0] * VM_SCALE, s.aimT) + bobX + this.swayX * 0.5 * swayK + this.dashT * 0.015;
    let y = lerp(hip[1] + HIP_SHIFT_Y, aim[1] * VM_SCALE, s.aimT) + bobY + breath + this.swayY * 0.5 * swayK + this.vyLag - this.land
      - lowE * 0.3 + kz * 0.15 - this.dashT * 0.02 + this.airT * 0.008;
    let z = lerp(hip[2], aim[2] * VM_SCALE, s.aimT) + kz + this.fwdLag + lowE * 0.05;
    let rx = this.kickRot + breath * 1.2 + this.swayY * 1.0 * swayK - lowE * 0.9 - this.dashT * 0.12 + this.airT * 0.05;
    let ry = -this.swayX * 1.3 * swayK;
    let rz = this.roll * swayK + bobRoll + this.kickRoll - this.dashT * 0.3;

    const tilt = this.reloadTilt;
    switch (def.reloadStyle) {
      case 'mag': rz += 0.45 * tilt; rx += 0.12 * tilt; x -= 0.03 * tilt; y += 0.01 * tilt; break;
      case 'cylinder': rz += 0.75 * tilt; rx += 0.1 * tilt; x -= 0.04 * tilt; break;
      case 'tube': rx += 0.5 * tilt; rz += 0.15 * tilt; y -= 0.04 * tilt; z += 0.04 * tilt; break;
      case 'cell': rz += 0.3 * tilt; rx += 0.12 * tilt; x -= 0.02 * tilt; break;
      case 'box': rz += 0.28 * tilt; x -= 0.02 * tilt; y -= 0.05 * tilt; break;
      case 'shell': break;
    }
    const st = this.shellT;
    rz -= 0.38 * st;
    rx += 0.1 * st - this.shellBump * 0.06;
    x -= 0.015 * st;
    y += 0.015 * st - this.shellBump * 0.012;

    if (s.firing && !e.blade) {
      // 持续开火的颤动；蓄力时随蓄力加剧
      const j = def.mode === 'charge' ? 0.0008 + 0.0026 * s.spin : 0.003;
      x += (Math.random() - 0.5) * j;
      y += (Math.random() - 0.5) * j;
    }
    const bl = e.blade;
    if (bl) bl.pose(dt, s.blade ?? BLADE_IDLE);
    this.pivot.position.set(x, y, z);
    this.pivot.rotation.set(rx, ry, rz);
    if (bl) {
      this.pivot.updateMatrixWorld(true);
      bl.animate(dt, s.blade ?? BLADE_IDLE);
    }

    this.animateParts(dt, e, s, time);
    this.animateHands(dt, e, s);
    this.updateFlash(dt, e, s);
    this.updateLights(dt, s);
  }

  private animateHands(dt: number, e: VmEntry, s: ViewmodelState): void {
    const left = e.leftArm;
    const profile = WEAPON_HANDLING[e.def.id];
    if (!left || !profile || e.blade) return;
    const g = e.gun;
    _v.copy(e.support);
    if (g.leftParent && g.leftHand) {
      g.leftParent.updateMatrix();
      _v.copy(g.leftHand).applyMatrix4(g.leftParent.matrix);
    }
    _supportPoint[0] = _v.x; _supportPoint[1] = _v.y; _supportPoint[2] = _v.z;
    if (e.breech) e.breech.rotation.x = -0.48 * this.shellT;
    if (s.reloading) {
      _v2.fromArray(profile.load);
      if (g.mag && !s.shellMode) {
        g.root.updateMatrixWorld(true);
        g.mag.getWorldPosition(_v2);
        g.root.worldToLocal(_v2).add(e.loadOffset);
      }
      _loadPoint[0] = _v2.x; _loadPoint[1] = _v2.y; _loadPoint[2] = _v2.z;
      sampleLoadingHand(profile, s.reloadP, _supportPoint, _loadPoint, _handPose, !s.shellMode || s.firstShell);
      left.position.set(_handPose.x, _handPose.y, _handPose.z);
      left.rotation.set(_handPose.pitch, 0, _handPose.roll);
    } else {
      const k = 1 - Math.exp(-20 * dt);
      left.position.lerp(_v, k);
      left.rotation.x = lerp(left.rotation.x, 0, k);
      left.rotation.z = lerp(left.rotation.z, profile.leftRoll, k);
    }
    if (e.rounds) e.rounds.visible = s.shellMode && s.reloadP > 0.22 && s.reloadP < 0.98;
  }

  private animateParts(dt: number, e: VmEntry, s: ViewmodelState, time: number): void {
    const g = e.gun;
    const mo = this.magOut;
    // 弹匣 / 能量罐 / 弹箱
    if (g.mag && g.mag !== g.cylinder) {
      const b = e.magBase;
      switch (e.def.reloadStyle) {
        case 'cell': {
          // 顶置能量罐向上抽出，枪身下方的燃料罐向下卸出
          const up = b.y >= 0;
          g.mag.position.set(b.x + 0.03 * mo, b.y + (up ? 0.12 : -0.16) * mo, b.z);
          break;
        }
        case 'tube':
          g.mag.position.set(b.x, b.y - 0.02 * mo, b.z + 0.12 * mo);
          g.mag.visible = mo < 0.85;
          break;
        case 'box':
          g.mag.position.set(b.x - 0.02 * mo, b.y - 0.24 * mo, b.z);
          break;
        default: {
          // 枪身下方的弹匣向下抽出，顶置箭匣（弩）向上提起
          const up = b.y > 0.06;
          g.mag.position.set(b.x, b.y + (up ? 0.13 : -0.2) * mo, b.z + 0.03 * mo);
          g.mag.rotation.x = e.magRotX + (up ? -0.25 : 0.3) * mo;
          break;
        }
      }
    }
    // 转轮：每发转一格；换弹时甩出并快速旋转
    if (g.cylinder) {
      if (mo > 0.3) {
        this.cylAngle += dt * 14;
        this.cylTarget = this.cylAngle;
      } else {
        if (s.cycleIndex >= 0) {
          // 元素轮转：转轮锁定到「下一发」所在弹膛（换弹收尾时按归零后的位置），只向前转。
          // 弹膛数是轮转长度的整数倍时，同色弹膛等价，周期缩短为 steps / len 格
          const steps = g.cylinderSteps;
          const step = TAU / steps;
          const len = e.def.cycle ? e.def.cycle.length : 1;
          const period = len > 0 && steps % len === 0 ? step * len : TAU;
          const want = (s.reloading ? 0 : s.cycleIndex) * step;
          this.cylTarget = want + Math.ceil((this.cylTarget - step * 0.5 - want) / period) * period;
          if (this.cylSnap) this.cylAngle = this.cylTarget;
        }
        this.cylAngle = damp(this.cylAngle, this.cylTarget, 25, dt);
      }
      this.cylSnap = false;
      g.cylinder.rotation.z = this.cylAngle;
      const b = e.magBase;
      g.cylinder.position.set(b.x - 0.045 * mo, b.y, b.z);
    }
    // 机炮转管
    if (g.spinner) g.spinner.rotation.z += s.spin * 42 * dt;
    // 霰弹泵动：开火后与装填结束时各拉一次
    if (g.pump) {
      let pz = 0;
      const t1 = (s.sinceShot - 0.12) / 0.32;
      if (t1 > 0 && t1 < 1) pz = Math.sin(t1 * Math.PI) * 0.075;
      this.rackT += dt;
      const t2 = this.rackT / 0.3;
      if (t2 < 1) pz = Math.max(pz, Math.sin(t2 * Math.PI) * 0.075);
      g.pump.position.z = e.pumpBase + pz;
    }
    // 弩：弦与箭
    if (g.stringHalves) {
      const c = smooth(s.cock);
      setCrossbowString(g, c);
      if (g.bolt) g.bolt.visible = s.cock >= 0.98;
    }
    // 元素轮转：能量槽（灵纹）显示下一发的元素
    if (s.elementHint) e.baseColor.setHex(ELEMENT_COLORS[s.elementHint]);
    // 能量槽脉动；蓄力武器随蓄力逐渐增亮，满蓄后快速闪烁
    let pulse: number;
    if (e.def.mode === 'charge' && s.firing) {
      pulse = 0.8 + 0.7 * s.spin + (s.spin >= 1 ? Math.sin(time * 34) * 0.22 : Math.sin(time * 18) * 0.06);
    } else {
      pulse = s.firing ? 1.3 + Math.sin(time * 40) * 0.25 : 0.82 + Math.sin(time * 3) * 0.14;
    }
    e.energyMat.color.copy(e.baseColor).multiplyScalar(pulse);
    // 美术枪的雕纹发光：有元素轮转提示时跟着下一发的元素色走（三才转轮），否则用实例基准色
    if (g.artGlow) g.artGlow.emissive.copy(s.elementHint ? e.baseColor : (g.artGlow.userData.glowBase as THREE.Color)).multiplyScalar(pulse);
  }

  private updateFlash(dt: number, e: VmEntry, s: ViewmodelState): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flashMat.opacity = clamp01(this.flashT / this.flashDur);
    } else if (s.firing && e.def.mode === 'beam') {
      // 光束持续放电的枪口辉光
      this.flash.visible = true;
      this.flashMat.opacity = 0.55 + Math.random() * 0.3;
      this.flash.scale.setScalar(e.def.flash * (0.7 + Math.random() * 0.5));
      this.flashMat.rotation = Math.random() * TAU;
    } else if (s.firing && e.def.mode === 'charge' && s.spin > 0.02) {
      // 蓄力：枪口聚起一团逐渐增大的灵光（能量色）
      const c = s.spin;
      this.flash.visible = true;
      this.flashMat.color.copy(e.baseColor);
      this.flashMat.opacity = 0.2 + 0.45 * c + (c >= 1 ? Math.random() * 0.2 : 0);
      this.flash.scale.setScalar(e.def.flash * (0.25 + 0.55 * c) * (0.92 + Math.random() * 0.16));
      this.flashMat.rotation += dt * (2 + 10 * c);
    } else {
      this.flash.visible = false;
    }
  }

  private updateLights(dt: number, s: ViewmodelState): void {
    this.lightI = Math.max(0, this.lightI - dt / 0.07);
    let i = this.lightI;
    if (s.firing && this.cur && this.cur.def.mode === 'beam') i = Math.max(i, 0.35 + Math.random() * 0.15);
    else if (s.firing && this.cur && this.cur.def.mode === 'charge' && s.spin > 0.02 && this.lightI <= 0) {
      // 蓄力辉光：武器场景灯色取能量色（主场景不放枪口点光源）
      const cur = this.cur;
      this.vmLight.color.copy(cur.baseColor);
      i = 0.06 + 0.16 * s.spin;
    }
    if (i <= 0.001 || !this.visible) {
      this.vmLight.intensity = 0;
      return;
    }
    if (this.cur) {
      this.cur.gun.muzzle.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(this.cur.gun.muzzle.matrixWorld);
      this.root.worldToLocal(_v);
      this.vmLight.position.copy(_v);
    }
    this.vmLight.intensity = i * 0.22;
  }

  /**
   * 枪口的主场景世界坐标（曳光起点）：取 viewmodel 枪口在武器相机中的屏幕位置，
   * 换算到主相机前方约 0.9 米处，使曳光看起来从枪口射出（两台相机 FOV 不同）。
   */
  getMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx;
    const cam = ctx.camera;
    const e = this.cur;
    if (e) {
      e.gun.muzzle.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(e.gun.muzzle.matrixWorld);
      ctx.viewCamera.worldToLocal(_v);
    } else {
      _v.set(0.18, -0.15, -0.6);
    }
    return this.projectLaunchWorld(out);
  }

  private projectLaunchWorld(out: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx, cam = ctx.camera;
    const depth = 0.9;
    const vz = Math.min(-0.05, _v.z);
    const tanV = Math.tan(ctx.viewCamera.fov * DEG * 0.5);
    const tanM = Math.tan(cam.fov * DEG * 0.5);
    const k = (depth / -vz) * (tanM / tanV);
    out.set(_v.x * k, _v.y * k, -depth);
    cam.updateMatrixWorld();
    return cam.localToWorld(out);
  }
}
