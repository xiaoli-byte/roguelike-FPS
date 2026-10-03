/**
 * 英雄选择界面的 3D 预览台（独立的小 WebGLRenderer，只在英雄选择页可见时渲染）。
 * 契约（HeroSelect 依赖）：
 *  - new HeroPreview(ctx, host)：host 为预览容器，canvas 由本类创建并挂入 host。
 *  - supported：WebGL 不可用时为 false，此时所有方法均为空操作（界面用 2D 徽记兜底）。
 *  - setHero(hero)：切换展示的英雄——该英雄的 3D 角色模型（heroPreview/heroes 的 HeroRig）右手持初始武器，
 *    站在祭台上作为舞台主角，配英雄主题氛围；旧英雄沉入祭台淡出，符文环与光柱闪亮，新英雄自光中升起并亮相。
 *  - start() / stop()：开始 / 停止渲染循环（停止时不再渲染；约 1 秒后绘制缓冲缩到 1×1，再开始时恢复）。
 *    可重复调用；停止后再开始会重播一次登场亮相。
 *  - prewarm(heroes)：可选。当前英雄亮相结束后趁空闲预先搭建其余英雄并预编译着色器，首次切换不卡顿。
 *  - dispose()：释放本类自建的所有资源（英雄模型调用 rig.dispose()；不释放 WeaponModels / enemies/Models 的共享缓存）。
 *
 * 场景：低多边形石质祭台（heroPreview/altar）顶面（y = 0）站着英雄，周围是英雄主题氛围（heroPreview/ambience）。
 * 英雄默认右前 3/4 侧对镜头（BASE_YAW：持枪的右手与尾巴 / 翅膀都看得到），待机时很慢地左右轻摆 ±4°；
 * 可拖拽绕 Y 旋转（带惯性），松手约 1.6 秒后开始平滑转回、约 3 秒回到默认朝向——不会持续自转。
 * 取景（syncCamera）：全身入画，英雄约占画面高度 74–83%（身高差略有保留）；机位在腰下、注视胸口（略微仰拍），
 * 再用镜头平移（setViewOffset）把脚底放在底部名牌之上；画面过窄时拉远相机保证左右放得下。
 * 英雄的尺寸在搭建时逐顶点实测（ExtentProbe，含蒙皮尾巴；并把亮相动作快进一遍量它伸展多远），
 * 亮相时若伸出待机取景（狐尾火焰升高、雷隼展翅），相机按包络临时拉远、动作结束推回，脚底位置不变。
 * 资源约定：
 *  - 英雄模型由 buildHeroModel 每次新建（按 id 缓存，最多 MAX_SLOTS 个）；rig.materials 归模型所有，这里直接改
 *    transparent / opacity 做淡入淡出，释放时调用 rig.dispose()。模型里不在 rig.materials 中的材质（共享缓存）
 *    一律克隆后再改，只释放克隆体。
 *  - 手持枪模（buildGunModel）的几何体 / 材质是 WeaponModels 的模块级共享缓存：同样克隆材质、只释放克隆体；
 *    释放英雄前先把枪模从 rig.hand 上摘下，避免共享几何体被模型的 dispose 波及。
 *  - 祭台 / 氛围 / 贴图 / 环境贴图均为自建，dispose 时释放。
 * canvas 绝对定位铺满 host（host 尺寸由 CSS 决定，ResizeObserver 跟随），背景透明，舞台底色由 host 的 CSS 负责。
 * host CSS 变量：按取景写入 --gf-stage-horizon（视平线）、--gf-stage-feet（脚底）、--gf-stage-focus（胸口）
 * （px，自 host 顶边起算，供舞台背景对齐）；读取 --gf-stage-plate（底部名牌占用的高度，px）。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext, HeroDef, Settings } from '../core/types';
import { DEG, angleDiff, clamp, clamp01, damp, lerp } from '../core/math';
import { getWeaponDef, hasWeaponDef } from '../weapons/WeaponDefs';
import { buildGunModel } from '../weapons/WeaponModels';
import { buildAltar, type Altar } from './heroPreview/altar';
import { ambienceKind, createAmbience, type Ambience, type AmbienceFrame, type AmbienceKind } from './heroPreview/ambience';
import { buildHeroModel, type HeroRig } from './heroPreview/heroes/index';
import { makeGlowTexture, makePillarTexture, makeRuneTexture, makeSparkTexture } from './heroPreview/textures';

// ───────────────────────────── 取景 ─────────────────────────────
// 调整构图只需要改这一组常量（syncCamera 用它们解出相机距离与镜头平移）。

/** 竖直视场角（度）：偏窄，透视变形小 */
const FOV = 30;
const TAN_HALF_FOV = Math.tan((FOV * DEG) / 2);
/** 机位高度与注视点高度（占英雄身高的比例）：机位在腰下、注视胸口 → 略微仰拍 */
const CAM_Y = 0.36;
const AIM_Y = 0.68;
/** 头顶留白：占画面高度的比例（不少于 TOP_MIN px） */
const TOP_FRAC = 0.085;
const TOP_MIN = 14;
/** 身高差保留（SIZE_KEEP）让高个子英雄变大时，最高点至少离顶边这么多（占画面高度） */
const TOP_HARD = 0.065;
/**
 * 脚底留白：占画面高度的比例，且不少于底部名牌的高度 + PLATE_GAP（名牌高度读自 host 的 --gf-stage-plate，
 * 读不到时用 PLATE_RESERVE）。脚底以下的祭台台座向下出画 / 被名牌盖住。
 */
const FEET_FRAC = 0.14;
const PLATE_RESERVE = 66;
const PLATE_GAP = 6;
/** 身高差保留：英雄在画面中的高度 ∝ (身高 / REF_H)^SIZE_KEEP（0 = 人人一样高，1 = 按真实比例） */
const REF_H = 1.95;
const SIZE_KEEP = 0.3;
/** 水平：英雄（含尾巴 / 翅膀 / 枪）待机时绕转轴的最大水平半径至多占画面半宽的比例，超出时拉远相机 */
const WIDTH_FILL = 0.9;
/** 亮相动作（默认朝向下）伸展的水平半宽至多占画面半宽的比例；最高点离顶边至少多少（占画面高度） */
const INTRO_WIDTH_FILL = 0.96;
const INTRO_EDGE = 0.03;
/**
 * 亮相拉远的包络（自 playIntro 起的秒数）：PULL_IN_A→B 拉远，保持到 PULL_HOLD，PULL_HOLD→PULL_OUT 推回。
 * 覆盖三位英雄动作最舒展的一段（雷隼约 0.1–1.3 秒展翅收翅，狐尾 0.12–1.05 秒扇形展开）；
 * 动作中途切走英雄时按 PULL_RELEASE 的速率平滑推回。
 */
const PULL_IN_A = 0.02;
const PULL_IN_B = 0.3;
const PULL_HOLD = 1.0;
const PULL_OUT = 1.7;
const PULL_RELEASE = 5;
/** 舞台背景的英雄色柔光对准的高度（占身高） */
const FOCUS_Y = 0.62;
/** 环境反射强度（金属部件没有环境贴图时几乎是黑的） */
const ENV_INTENSITY = 0.45;

// ───────────────────────────── 动画 ─────────────────────────────

/** 默认朝向：正面转向画面右侧约 27°，右手（本地 −X，持枪侧）朝向镜头 */
const BASE_YAW = 27 * DEG;
/** 待机轻摆：幅度与角频率（rad/s，周期约 12.6 秒） */
const SWAY_AMP = 4 * DEG;
const SWAY_RATE = 0.5;
/** 拖拽：每像素转角、角速度上限；松手后惯性衰减率与回正弹簧的角频率 */
const DRAG_YAW = 0.011;
const SPIN_MAX = 8;
const INERTIA_DECAY = 4;
const RETURN_OMEGA = 4.2;
/** 松手后多久开始转回默认朝向（秒）；回正弹簧约 1.1 秒到位，松手后约 3 秒回到默认朝向 */
const RETURN_DELAY = 1.6;
/** 新英雄升起前的等待（先让旧英雄下沉、光柱亮起）、升起与下沉时长（秒） */
const ENTER_DELAY = 0.12;
const IN_DELAY = 0.16;
const IN_TIME = 0.6;
const OUT_TIME = 0.32;
/** 氛围交叉淡入淡出时长（秒）；取景跟随新英雄身高的速率 */
const AMB_FADE = 0.45;
const FIT_RATE = 5;
/** 减弱动态时粒子 / 符文 / 待机动画的速度倍率 */
const REDUCED_SPEED = 0.35;
const MAX_DT = 0.05;
/** 最多缓存的英雄模型数（超出时释放最久未用且已隐藏的） */
const MAX_SLOTS = 3;
/** 预热（prewarm）两步之间至少间隔多久（秒）：一步搭建一位英雄，下一步预编译它的着色器 */
const WARM_GAP = 0.45;
/**
 * stop() 之后多久把绘制缓冲缩到 1×1（毫秒）：释放全尺寸的多重采样颜色 / 深度缓冲（高 DPR 下可达数十 MB）。
 * 要晚于菜单面板的淡出（Presence 300ms），否则缩小时画布被清空，淡出中的舞台会先变空。
 */
const RELEASE_DELAY = 1000;

const PIXEL_RATIO_CAP: Record<Settings['quality'], number> = { low: 1, medium: 1.25, high: 2 };
const DENSITY: Record<Settings['quality'], number> = { low: 0.55, medium: 0.8, high: 1 };

// ───────────────────────────── 灯光 ─────────────────────────────

/** 轮廓光（英雄色，后左上 / 后右下）基础强度，切换闪光时追加的倍率 */
const RIM_A = 2.6;
const RIM_B = 1.7;
const RIM_SURGE = 0.6;
/** 符文环附近点光源（脚下的英雄色反光）基础强度，电弧闪光 / 切换闪光的追加强度 */
const POINT_BASE = 1.3;
const POINT_FLASH = 1.6;
const POINT_SURGE = 2.4;

interface Pose {
  /** 相对祭台顶面的高度偏移（米） */
  y: number;
  /** 缩放倍率 */
  s: number;
  /** 不透明度 */
  o: number;
  /** 相对当前朝向的额外转角（弧度，升起时转身入场） */
  r: number;
}

const REST: Readonly<Pose> = { y: 0, s: 1, o: 1, r: 0 };
const SUNK: Readonly<Pose> = { y: -0.5, s: 0.94, o: 0, r: -0.5 };

interface FadeMat {
  readonly mat: THREE.Material;
  /** 原始不透明度与 transparent 标记（完全显现时恢复） */
  readonly base: number;
  readonly transparent: boolean;
}

interface HeroSlot {
  readonly id: string;
  readonly rig: HeroRig;
  /** 位置（升降）/ 朝向 / 缩放；rig.root 挂在下面，本类不改 rig.root 的变换 */
  readonly pivot: THREE.Group;
  /** 挂在 rig.hand 上的枪模根节点（释放前先摘下） */
  readonly gun: THREE.Object3D | null;
  /** 参与淡入淡出的材质：rig.materials + 克隆体 */
  readonly fades: FadeMat[];
  /** 本类克隆的材质（共享缓存的替身），释放时只释放这些 */
  readonly clones: THREE.Material[];
  /** 站立高度（rig.height，氛围按它定位） */
  readonly height: number;
  /** 取景：画面里的等效总高（实测最高点，含火焰等高出头顶的部分，计入前倾 / 后掠的透视）、绕转轴的最大水平半径 */
  readonly frameH: number;
  readonly radius: number;
  /** 取景：亮相动作伸展到的等效最高点、默认朝向下的等效水平半宽（米，用来保证亮相时也不出画） */
  readonly introTop: number;
  readonly introHalfW: number;
  /** 模型自己的时钟（秒）：rig.update 的 t；只在模型更新时推进 */
  clock: number;
  /** 距上次 playIntro 的秒数（亮相拉远包络用；未在亮相时为 −1） */
  introT: number;
  /** 氛围：包围盒中心高度、身体半宽 */
  readonly cy: number;
  readonly halfW: number;
  /** 过渡：从 from 缓动到 REST（showing）或 SUNK */
  readonly from: Pose;
  readonly cur: Pose;
  showing: boolean;
  t: number;
  dur: number;
  /** 当前是否处于半透明（材质已切到 transparent） */
  fading: boolean;
  appliedO: number;
  /** 到位后播放亮相动作 */
  introPending: boolean;
  /** 模型 update / playIntro 抛过异常：之后不再调用，避免每帧刷屏 */
  broken: boolean;
  used: number;
}

interface AmbienceSlot {
  readonly kind: AmbienceKind;
  readonly amb: Ambience;
  vis: number;
  target: number;
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

/** 估算透视放大时假定的相机距离（米，实际约 4.4–5.6） */
const PROBE_DIST = 4.6;
/** 搭建时快进模型的步长、待机步数、亮相步数（之后已回到待机）与其中参与测量的时长（秒） */
const PROBE_STEP = 1 / 30;
const PROBE_IDLE_STEPS = 24;
const PROBE_INTRO_STEPS = 75;
const PROBE_INTRO_SPAN = 1.8;

/**
 * 逐顶点测量英雄（Mesh.getVertexPosition 含蒙皮 / 变形），坐标相对 root 的父节点（搭建时 pivot 为单位变换）。
 * 包围盒在旋转后的网格上会偏大（狐尾的姿态包围盒把水平半径高估约 25%），所以取景改用顶点。
 * 搭建时先量几帧待机，再把亮相动作快进一遍量它伸展到多远（狐尾火焰升高、雷隼展翅），保证亮相时也不出画。
 */
class ExtentProbe {
  /**
   * 待机：换算到转轴平面上的等效最高点（默认朝向下前倾的头投影得更高、后掠的冠羽更低，已近似计入透视）、
   * 绕转轴（Y）的最大水平半径
   */
  top = -Infinity;
  radius = 0;
  /** 亮相：等效最高点、默认朝向 ± 轻摆下的等效水平半宽（同样计入透视放大） */
  introTop = -Infinity;
  introHalfW = 0;
  private readonly cos: number;
  private readonly sin: number;
  /** 亮相时的朝向范围：默认朝向 ± 待机轻摆幅度（远处的翼尖对朝向很敏感） */
  private readonly cosLo: number;
  private readonly sinLo: number;
  private readonly cosHi: number;
  private readonly sinHi: number;

  constructor(
    private readonly root: THREE.Object3D,
    yaw: number,
    sway: number,
    /** 相机高度（米），换算等效最高点用 */
    private readonly camY: number,
  ) {
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.cosLo = Math.cos(yaw - sway);
    this.sinLo = Math.sin(yaw - sway);
    this.cosHi = Math.cos(yaw + sway);
    this.sinHi = Math.sin(yaw + sway);
  }

  get valid(): boolean {
    return Number.isFinite(this.top);
  }

  idle(stride: number): void {
    this.visit(stride, (v) => {
      const z = v.z * this.cos - v.x * this.sin;
      const top = this.camY + (v.y - this.camY) * (PROBE_DIST / Math.max(0.5, PROBE_DIST - z));
      if (top > this.top) this.top = top;
      const r = Math.hypot(v.x, v.z);
      if (r > this.radius) this.radius = r;
    });
  }

  intro(stride: number): void {
    this.visit(stride, (v) => {
      this.introAt(v, this.cosLo, this.sinLo);
      this.introAt(v, this.cosHi, this.sinHi);
    });
  }

  private introAt(v: THREE.Vector3, cos: number, sin: number): void {
    // 该朝向下的屏幕横向 / 朝镜头方向分量；离镜头越近投影越大
    const x = v.x * cos + v.z * sin;
    const z = v.z * cos - v.x * sin;
    const k = PROBE_DIST / Math.max(0.5, PROBE_DIST - z);
    const top = this.camY + (v.y - this.camY) * k;
    if (top > this.introTop) this.introTop = top;
    const hw = Math.abs(x) * k;
    if (hw > this.introHalfW) this.introHalfW = hw;
  }

  private visit(stride: number, fn: (v: THREE.Vector3) => void): void {
    const root = this.root;
    if (root.parent) root.parent.updateMatrixWorld(true);
    else root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i += stride) fn(mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld));
    });
  }
}

function smooth01(x: number): number {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
}

/** 亮相拉远包络：0（待机取景）→ 1（亮相取景）→ 0 */
function introEnvelope(t: number): number {
  if (t < 0) return 0;
  if (t < PULL_IN_B) return smooth01((t - PULL_IN_A) / (PULL_IN_B - PULL_IN_A));
  if (t < PULL_HOLD) return 1;
  return 1 - smooth01((t - PULL_HOLD) / (PULL_OUT - PULL_HOLD));
}

function copyPose(out: Pose, p: Readonly<Pose>): void {
  out.y = p.y;
  out.s = p.s;
  out.o = p.o;
  out.r = p.r;
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** 探测 WebGL2（three r163+ 只支持 WebGL2）；结果缓存，探测用的上下文立即释放 */
let webglProbe: boolean | null = null;
function probeWebGL(): boolean {
  if (webglProbe !== null) return webglProbe;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    webglProbe = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

export class HeroPreview {
  supported: boolean;

  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 30);
  private ro: ResizeObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private reduced = false;
  private disposed = false;
  private running = false;
  private lost = false;
  private raf = 0;
  /** stop() 后延迟缩小绘制缓冲的定时器（见 RELEASE_DELAY） */
  private releaseTimer = 0;
  private lastNow = -1;
  /** 真实累计时间 */
  private time = 0;
  private width = 0;
  private height = 0;
  private pixelRatio = 0;
  private sizeDirty = true;
  private cameraDirty = true;
  private plateReserve = PLATE_RESERVE;

  /** 目标英雄（start 之前设置也有效，场景建好后再搭建） */
  private hero: HeroDef | null = null;
  /** 待预热的英雄（prewarm），以及已搭建、等待预编译着色器的那一位 */
  private readonly warmQueue: HeroDef[] = [];
  private warmPending: HeroSlot | null = null;
  private warmAt = 0;
  private built = false;
  private shownOnce = false;

  // 场景
  private altar: Altar | null = null;
  private sparkTex: THREE.Texture | null = null;
  private glowTex: THREE.Texture | null = null;
  private readonly ownedTextures: THREE.Texture[] = [];
  /** PMREM 环境贴图（GPU 生成，上下文恢复后需重建） */
  private envTex: THREE.Texture | null = null;
  private envDirty = false;
  private readonly hemi = new THREE.HemisphereLight(0xfff1dc, 0x231a26, 1.1);
  /** 暖色主光（镜头右前上方，照亮英雄正脸）+ 冷色弱补光（镜头左侧）+ 两盏英雄色轮廓光（身后）+ 符文环点光源 */
  private readonly key = new THREE.DirectionalLight(0xffe2b8, 2.5);
  private readonly fill = new THREE.DirectionalLight(0xa9bcff, 0.45);
  private readonly rimA = new THREE.DirectionalLight(0xffffff, RIM_A);
  private readonly rimB = new THREE.DirectionalLight(0xffffff, RIM_B);
  private readonly point = new THREE.PointLight(0xffffff, POINT_BASE, 2.6, 2);
  /** 英雄 / 氛围缓存：Map 用于查找，数组用于每帧遍历（热路径不创建迭代器） */
  private readonly slots = new Map<string, HeroSlot>();
  private readonly slotList: HeroSlot[] = [];
  private current: HeroSlot | null = null;
  private readonly ambiences = new Map<AmbienceKind, AmbienceSlot>();
  private readonly ambienceList: AmbienceSlot[] = [];
  private readonly theme = new THREE.Color(0xd4a94e);
  private readonly themeTarget = new THREE.Color(0xd4a94e);
  private readonly frameInfo: AmbienceFrame;
  private flash = 0;

  /** 取景跟随的英雄尺寸（切换时平滑过渡）与上次取景所用的值 */
  private fitH = 1.9;
  private fitFrameH = 1.9;
  private fitIntroTop = 1.9;
  private fitIntroHW = 0.7;
  private fitR = 0.7;
  private fitCy = 0.95;
  private fitHalfW = 0.4;
  private framedH = -1;
  private framedIntroTop = -1;
  private framedIntroHW = -1;
  private framedR = -1;
  /** 亮相拉远量（0–1）与上次取景所用的值 */
  private introPull = 0;
  private framedPull = 0;
  /** 已写入 host 的 CSS 变量（px），变化不足 0.5px 时不重写 */
  private cssHorizon = NaN;
  private cssFeet = NaN;
  private cssFocus = NaN;

  // 交互（拖拽旋转 + 惯性 + 回正）
  private yaw = BASE_YAW;
  private spinVel = 0;
  private idle = RETURN_DELAY;
  private dragId: number | null = null;
  private dragX = 0;
  private dragAcc = 0;
  private dragDist = 0;
  private suppressClick = false;

  constructor(private readonly ctx: GameContext, private readonly host: HTMLElement) {
    this.frameInfo = { dt: 0, t: 0, calm: false, yaw: BASE_YAW, cy: this.fitCy, halfW: this.fitHalfW, height: this.fitH, theme: this.theme };
    this.supported = probeWebGL();
    if (!this.supported) return;

    const c = document.createElement('canvas');
    c.className = 'gf-hero-preview__canvas';
    const st = c.style;
    st.position = 'absolute';
    st.left = '0';
    st.top = '0';
    st.width = '100%';
    st.height = '100%';
    st.display = 'block';
    st.cursor = 'grab';
    // 横向拖拽旋转，竖向滑动仍可滚动页面
    st.touchAction = 'pan-y';
    st.userSelect = 'none';
    c.setAttribute('aria-hidden', 'true');
    host.prepend(c);
    this.canvas = c;

    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('lostpointercapture', this.onPointerUp);
    c.addEventListener('click', this.onClick);
    c.addEventListener('webglcontextlost', this.onContextLost);
    c.addEventListener('webglcontextrestored', this.onContextRestored);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(host);
    }
    if (typeof window.matchMedia === 'function') {
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = this.motionQuery.matches;
      this.motionQuery.addEventListener?.('change', this.onMotionPref);
    }
  }

  setHero(hero: HeroDef): void {
    if (!this.usable()) return;
    if (this.hero && this.hero.id === hero.id) return;
    this.hero = hero;
    if (this.built) this.applyHero(hero);
  }

  /**
   * 预热：当前英雄登场、亮相结束后，趁舞台安静时逐个搭建其余英雄（模型 + 氛围）并预编译着色器（不透明 / 淡入淡出用的
   * 半透明两种变体），首次切换到他们时不再卡顿。总数受 MAX_SLOTS 限制。可重复调用。
   */
  prewarm(heroes: readonly HeroDef[]): void {
    if (!this.usable()) return;
    for (const hero of heroes) {
      if (this.slots.size + this.warmQueue.length >= MAX_SLOTS) break;
      if (this.slots.has(hero.id) || this.warmQueue.some((q) => q.id === hero.id)) continue;
      if (this.hero && this.hero.id === hero.id) continue;
      this.warmQueue.push(hero);
    }
  }

  start(): void {
    if (!this.usable() || this.running) return;
    this.cancelRelease();
    const wasBuilt = this.built;
    if (!this.ensureRenderer()) return;
    this.attachCanvas();
    this.running = true;
    this.lastNow = -1;
    this.setViewport(this.host.clientWidth, this.host.clientHeight);
    // 重新进入本页：英雄再从光中登场一次（首次进入由 buildScene → applyHero 负责）
    if (wasBuilt) this.replayEntrance();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.endDrag();
    // 页面淡出后再缩小绘制缓冲（离开本页期间——包括整局游戏——不再占着全尺寸的多重采样缓冲）
    if (wasRunning && this.renderer && !this.disposed && !this.releaseTimer)
      this.releaseTimer = window.setTimeout(this.releaseBuffers, RELEASE_DELAY);
  }

  private cancelRelease(): void {
    if (!this.releaseTimer) return;
    clearTimeout(this.releaseTimer);
    this.releaseTimer = 0;
  }

  /** 停止后把绘制缓冲缩到 1×1；下次 start() 的首帧由 syncSize 按当前尺寸恢复 */
  private readonly releaseBuffers = (): void => {
    this.releaseTimer = 0;
    const r = this.renderer;
    if (this.running || this.disposed || !r) return;
    r.setSize(1, 1, false);
    this.sizeDirty = true;
  };

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.cancelRelease();
    this.disposed = true;
    this.ro?.disconnect();
    this.ro = null;
    this.motionQuery?.removeEventListener?.('change', this.onMotionPref);
    this.motionQuery = null;

    for (const s of this.slotList) this.disposeSlot(s);
    this.warmQueue.length = 0;
    this.warmPending = null;
    this.slots.clear();
    this.slotList.length = 0;
    this.current = null;
    for (const a of this.ambienceList) {
      this.scene.remove(a.amb.group);
      a.amb.dispose();
    }
    this.ambiences.clear();
    this.ambienceList.length = 0;
    if (this.altar) {
      this.scene.remove(this.altar.group);
      this.altar.dispose();
      this.altar = null;
    }
    for (const t of this.ownedTextures) t.dispose();
    this.ownedTextures.length = 0;
    this.sparkTex = null;
    this.glowTex = null;
    this.envTex?.dispose();
    this.envTex = null;
    this.scene.environment = null;
    this.scene.clear();

    const st = this.host.style;
    st.removeProperty('--gf-stage-horizon');
    st.removeProperty('--gf-stage-feet');
    st.removeProperty('--gf-stage-focus');

    const r = this.renderer;
    this.renderer = null;
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointerdown', this.onPointerDown);
      c.removeEventListener('pointermove', this.onPointerMove);
      c.removeEventListener('pointerup', this.onPointerUp);
      c.removeEventListener('pointercancel', this.onPointerUp);
      c.removeEventListener('lostpointercapture', this.onPointerUp);
      c.removeEventListener('click', this.onClick);
      c.removeEventListener('webglcontextlost', this.onContextLost);
      c.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    if (r) {
      r.dispose();
      r.forceContextLoss();
    }
    c?.remove();
    this.canvas = null;
    this.built = false;
    this.hero = null;
    this.supported = false;
  }

  // ───────────────────────────── 初始化 ─────────────────────────────

  private usable(): boolean {
    return this.supported && !this.disposed;
  }

  /** 确保 canvas 仍在 host 内（外部可能清空过 host），且 host 能作为绝对定位的参照 */
  private attachCanvas(): void {
    const c = this.canvas;
    if (!c) return;
    if (c.parentElement !== this.host) this.host.prepend(c);
    if (this.host.isConnected && getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
  }

  private ensureRenderer(): boolean {
    if (this.renderer) return true;
    const canvas = this.canvas;
    if (!canvas) return false;
    try {
      const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      r.setClearColor(0x000000, 0);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      this.renderer = r;
    } catch (err) {
      // 上下文创建失败（数量上限、驱动问题等）：退回 2D 兜底，之后所有方法空操作
      console.warn('[HeroPreview] WebGL 初始化失败，改用 2D 徽记', err);
      this.dispose();
      return false;
    }
    this.buildScene(this.renderer);
    return true;
  }

  /** 用 RoomEnvironment 生成柔和的环境反射（只影响本预览场景） */
  private buildEnvironment(r: THREE.WebGLRenderer): void {
    this.envDirty = false;
    this.envTex?.dispose();
    this.envTex = null;
    let pmrem: THREE.PMREMGenerator | null = null;
    const room = new RoomEnvironment();
    try {
      pmrem = new THREE.PMREMGenerator(r);
      this.envTex = pmrem.fromScene(room, 0.04).texture;
    } catch (err) {
      console.warn('[HeroPreview] 环境贴图生成失败', err);
    } finally {
      room.dispose();
      pmrem?.dispose();
    }
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = ENV_INTENSITY;
  }

  private buildScene(r: THREE.WebGLRenderer): void {
    this.buildEnvironment(r);
    const spark = makeSparkTexture();
    const glow = makeGlowTexture();
    const rune = makeRuneTexture();
    const pillar = makePillarTexture();
    this.ownedTextures.push(spark, glow, rune, pillar);
    this.sparkTex = spark;
    this.glowTex = glow;

    this.altar = buildAltar(rune, pillar, glow);
    this.scene.add(this.altar.group);

    // 主光在镜头右前上方（英雄面朝画面右侧，正脸受光）；补光在镜头左侧（持枪手一侧不至于死黑）；
    // 两盏英雄色轮廓光在身后左上 / 右下，把剪影从深色背景里勾出来；点光源贴着符文环，给脚下一点英雄色反光。不开阴影。
    this.key.position.set(2.2, 3.8, 4.2);
    this.fill.position.set(-3.6, 1.4, 2.2);
    this.rimA.position.set(-2.8, 2.8, -3.4);
    this.rimB.position.set(3.0, 1.5, -3.0);
    this.point.position.set(0, 0.16, 0.5);
    this.scene.add(this.hemi, this.key, this.fill, this.rimA, this.rimB, this.point);

    this.built = true;
    if (this.hero) this.applyHero(this.hero);
  }

  /** 切到某位英雄：主题色、英雄模型（旧沉新升 + 光柱闪亮）、氛围（交叉淡入淡出） */
  private applyHero(hero: HeroDef): void {
    const first = !this.shownOnce;
    this.shownOnce = true;
    const instant = this.reduced;

    this.themeTarget.setHex(hero.color);
    if (first || instant) this.theme.copy(this.themeTarget);

    let slot = this.slots.get(hero.id);
    if (!slot) {
      slot = this.buildSlot(hero);
      this.slots.set(hero.id, slot);
      this.slotList.push(slot);
    }
    for (const s of this.slotList) if (s !== slot) this.retarget(s, false, 0, instant);
    this.retarget(slot, true, first ? ENTER_DELAY : IN_DELAY, instant);
    this.current = slot;
    this.trimSlots();
    if (first || instant) this.snapFit(slot);
    if (!instant) this.altar?.surge(1);
    // 新英雄以默认朝向登场（拖拽中则不打断）
    if (this.dragId === null) this.idle = Math.max(this.idle, RETURN_DELAY);

    // 氛围
    const kind = ambienceKind(hero.id);
    this.ensureAmbience(kind);
    for (const a of this.ambienceList) {
      a.target = a.kind === kind ? 1 : 0;
      if (instant) a.vis = a.target;
    }
  }

  /** 某种英雄氛围（按需创建一次，之后交叉淡入淡出复用） */
  private ensureAmbience(kind: AmbienceKind): AmbienceSlot | null {
    const had = this.ambiences.get(kind);
    if (had) return had;
    if (!this.sparkTex || !this.glowTex) return null;
    const amb = createAmbience(kind, {
      density: DENSITY[this.ctx.settings.quality] ?? 1,
      spark: this.sparkTex,
      glow: this.glowTex,
    });
    const a: AmbienceSlot = { kind, amb, vis: 0, target: 0 };
    amb.group.visible = false;
    this.scene.add(amb.group);
    this.ambiences.set(kind, a);
    this.ambienceList.push(a);
    return a;
  }

  /** 预热一步（见 prewarm）：只在舞台安静时做——当前英雄已到位、亮相结束，且没有别的英雄在过渡中 */
  private warmStep(): void {
    if (!this.warmPending && this.warmQueue.length === 0) return;
    if (this.time - this.warmAt < WARM_GAP) return;
    const cur = this.current;
    if (!cur || !cur.showing || cur.t < cur.dur || cur.introPending || cur.introT >= 0 || this.dragId !== null) return;
    for (const s of this.slotList) if (s !== cur && s.pivot.parent) return;
    this.warmAt = this.time;
    const pending = this.warmPending;
    if (pending) {
      this.warmPending = null;
      if (this.slots.get(pending.id) === pending) this.compileSlot(pending);
      return;
    }
    const hero = this.warmQueue.shift();
    if (!hero || this.slots.has(hero.id) || this.slots.size >= MAX_SLOTS) return;
    const slot = this.buildSlot(hero);
    this.slots.set(hero.id, slot);
    this.slotList.push(slot);
    this.ensureAmbience(ambienceKind(hero.id));
    this.warmPending = slot;
  }

  /** 预编译一位（尚未上场的）英雄与其氛围的着色器：不透明一遍、淡入淡出用的半透明一遍（OPAQUE 宏不同，是两套程序） */
  private compileSlot(s: HeroSlot): void {
    const r = this.renderer;
    if (!r || this.lost) return;
    const fades = s.fades;
    try {
      r.compile(s.pivot, this.camera, this.scene);
      for (let i = 0; i < fades.length; i++) {
        fades[i].mat.transparent = true;
        fades[i].mat.needsUpdate = true;
      }
      r.compile(s.pivot, this.camera, this.scene);
      const amb = this.ambiences.get(ambienceKind(s.id));
      if (amb) r.compile(amb.amb.group, this.camera, this.scene);
    } catch (err) {
      console.warn('[HeroPreview] 预编译着色器失败', s.id, err);
    } finally {
      for (let i = 0; i < fades.length; i++) {
        const f = fades[i];
        f.mat.transparent = s.fading || f.transparent;
        f.mat.needsUpdate = true;
      }
    }
  }

  /** 重新进入本页：其他英雄立即隐藏，当前英雄回到默认朝向并重新从光中升起、亮相 */
  private replayEntrance(): void {
    const cur = this.current;
    if (!cur) return;
    for (const s of this.slotList) {
      // 上一次亮相的拉远包络作废（真正的亮相在重新到位后由 updateSlot 从 0 开始计时）
      s.introT = -1;
      if (s === cur) continue;
      s.showing = false;
      copyPose(s.cur, SUNK);
      s.pivot.visible = false;
      this.scene.remove(s.pivot);
    }
    for (const a of this.ambienceList) a.vis = a.target;
    this.theme.copy(this.themeTarget);
    this.snapFit(cur);
    this.yaw = BASE_YAW;
    this.spinVel = 0;
    this.idle = RETURN_DELAY;
    if (this.reduced) return;
    cur.showing = false;
    copyPose(cur.cur, SUNK);
    this.retarget(cur, true, ENTER_DELAY, false);
    this.altar?.surge(0.85);
  }

  /**
   * 搭建一位展示英雄：buildHeroModel + 右手挂初始武器（buildGunModel，1:1）+ 整理可淡入淡出的材质 + 量尺寸。
   * 模型创建失败时退回占位模型（buildHeroModel 对未知 id 返回占位）。
   */
  private buildSlot(hero: HeroDef): HeroSlot {
    let rig: HeroRig;
    try {
      rig = buildHeroModel(hero.id, hero.color);
    } catch (err) {
      console.error('[HeroPreview] 英雄模型创建失败，改用占位模型', hero.id, err);
      rig = buildHeroModel('', hero.color);
    }
    const pivot = new THREE.Group();
    pivot.name = `heroPreview:${hero.id}`;
    pivot.visible = false;
    pivot.add(rig.root);

    // 手持初始武器：第一人称枪模（米制，原点在握把顶部、枪管沿 −Z），与 rig.hand 的约定一致，直接挂上
    let gun: THREE.Object3D | null = null;
    if (hasWeaponDef(hero.startingWeapon)) {
      try {
        const def = getWeaponDef(hero.startingWeapon);
        gun = buildGunModel(def.id, 0, def.element).root;
        rig.hand.add(gun);
      } catch (err) {
        console.warn('[HeroPreview] 初始武器模型创建失败', hero.startingWeapon, err);
        gun?.removeFromParent();
        gun = null;
      }
    }

    // 材质：模型自有的直接淡入淡出；其余（枪模 / 共享缓存）先克隆再替换，只改、只释放克隆体
    const owned = new Set<THREE.Material>(rig.materials);
    const fades: FadeMat[] = [];
    const clones: THREE.Material[] = [];
    const cloneOf = new Map<THREE.Material, THREE.Material>();
    const track = (m: THREE.Material): void => {
      fades.push({ mat: m, base: m.opacity, transparent: m.transparent });
    };
    for (const m of owned) track(m);
    const adopt = (m: THREE.Material): THREE.Material => {
      if (owned.has(m)) return m;
      let c = cloneOf.get(m);
      if (!c) {
        c = m.clone();
        cloneOf.set(m, c);
        clones.push(c);
        track(c);
      }
      return c;
    };
    rig.root.traverse((o) => {
      const holder = o as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
      const m = holder.material;
      if (!m) return;
      holder.material = Array.isArray(m) ? m.map(adopt) : adopt(m);
    });

    // 量尺寸：取景用逐顶点测量（含蒙皮形变）——先跑几帧待机量最高点 / 水平半径 / 头顶前探，再把亮相动作快进一遍
    // 量它伸展到多远（模型用自己的时钟，快进不影响别的英雄；快进结束时已回到待机）。氛围锚点沿用各网格包围盒。
    const height0 = rig.height > 0.3 ? rig.height : 1.8;
    const probe = new ExtentProbe(rig.root, BASE_YAW, SWAY_AMP, CAM_Y * height0);
    let clock = 0;
    try {
      rig.update(0, clock);
      probe.idle(1);
      for (let i = 1; i <= PROBE_IDLE_STEPS; i++) {
        clock += PROBE_STEP;
        rig.update(PROBE_STEP, clock);
        if (i % 6 === 0) probe.idle(2);
      }
      rig.playIntro();
      for (let i = 1; i <= PROBE_INTRO_STEPS; i++) {
        clock += PROBE_STEP;
        rig.update(PROBE_STEP, clock);
        if (i % 2 === 0 && i * PROBE_STEP <= PROBE_INTRO_SPAN) probe.intro(3);
      }
    } catch {
      /* 由每帧 update 处理（会记录一次并停用该模型的动画） */
    }
    pivot.updateMatrixWorld(true);
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let radius = 0;
    rig.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox || g.boundingBox.isEmpty()) return;
      _box.copy(g.boundingBox).applyMatrix4(mesh.matrixWorld);
      minY = Math.min(minY, _box.min.y);
      maxY = Math.max(maxY, _box.max.y);
      minX = Math.min(minX, _box.min.x);
      maxX = Math.max(maxX, _box.max.x);
      const ax = Math.max(Math.abs(_box.min.x), Math.abs(_box.max.x));
      const az = Math.max(Math.abs(_box.min.z), Math.abs(_box.max.z));
      radius = Math.max(radius, Math.hypot(ax, az));
    });
    const hasBox = Number.isFinite(minY) && Number.isFinite(maxX);
    const height = rig.height > 0.3 ? rig.height : hasBox ? Math.max(0.5, maxY) : 1.8;
    const ext = probe.valid;
    if (ext) radius = probe.radius;
    // 取景高度取实测（rig.height 的 0.9–1.2 倍之间）：狐尾尖的火焰高过耳尖、岩熊的头前倾，雷隼的冠羽后掠显得矮些
    const frameH = ext ? clamp(probe.top, height * 0.9, height * 1.2) : height;

    return {
      id: hero.id,
      rig,
      pivot,
      gun,
      fades,
      clones,
      height,
      frameH,
      radius: clamp(hasBox || ext ? radius : height * 0.4, height * 0.25, height * 0.8),
      introTop: Number.isFinite(probe.introTop) ? clamp(probe.introTop, frameH, height * 1.35) : frameH,
      introHalfW: clamp(probe.introHalfW, 0, height),
      clock,
      introT: -1,
      cy: hasBox ? clamp((minY + maxY) / 2, height * 0.3, height * 0.7) : height * 0.5,
      halfW: clamp(hasBox ? (maxX - minX) / 2 : height * 0.25, height * 0.2, height * 0.42),
      from: { ...SUNK },
      cur: { ...SUNK },
      showing: false,
      t: 0,
      dur: IN_TIME,
      fading: false,
      appliedO: -1,
      introPending: false,
      broken: false,
      used: this.time,
    };
  }

  /** 切换某位英雄的目标姿态（从当前姿态缓动，过渡中途反转也连续）；显现时到位后亮相 */
  private retarget(s: HeroSlot, show: boolean, delay: number, instant: boolean): void {
    if (s.showing === show) return;
    s.showing = show;
    copyPose(s.from, s.cur);
    s.dur = show ? IN_TIME : OUT_TIME;
    s.t = instant ? s.dur : show && s.cur.o < 0.02 ? -delay : 0;
    s.used = this.time;
    if (show) {
      s.introPending = !instant;
      // 沿用上一次亮相的计时会让拉远包络一帧跳变、并在到位重播亮相时再推拉一轮：作废它，到位后从 0 重新开始
      s.introT = -1;
      if (!s.pivot.parent) this.scene.add(s.pivot);
    }
  }

  private trimSlots(): void {
    while (this.slots.size > MAX_SLOTS) {
      let victim: HeroSlot | null = null;
      for (const s of this.slotList) {
        if (s.showing || s.pivot.parent) continue;
        if (!victim || s.used < victim.used) victim = s;
      }
      if (!victim) return;
      this.slots.delete(victim.id);
      this.slotList.splice(this.slotList.indexOf(victim), 1);
      this.disposeSlot(victim);
    }
  }

  private disposeSlot(s: HeroSlot): void {
    this.scene.remove(s.pivot);
    // 先摘下枪模：它的几何体是 WeaponModels 的共享缓存，不能被模型的 dispose 波及
    s.gun?.removeFromParent();
    try {
      s.rig.dispose();
    } catch (err) {
      console.warn('[HeroPreview] 英雄模型释放失败', s.id, err);
    }
    for (const m of s.clones) m.dispose();
    s.clones.length = 0;
    s.fades.length = 0;
  }

  /** 取景立即对准某位英雄（首次 / 减弱动态 / 重新进入） */
  private snapFit(s: HeroSlot): void {
    this.fitH = s.height;
    this.fitFrameH = s.frameH;
    this.fitIntroTop = s.introTop;
    this.fitIntroHW = s.introHalfW;
    this.fitR = s.radius;
    this.fitCy = s.cy;
    this.fitHalfW = s.halfW;
    this.introPull = 0;
    this.cameraDirty = true;
  }

  /** 取景平滑跟随当前英雄的尺寸（岩熊更高更宽，切换时镜头随之推拉） */
  private followFit(s: HeroSlot, dt: number, calm: boolean): void {
    const k = calm ? 1 : 1 - Math.exp(-FIT_RATE * dt);
    this.fitH += (s.height - this.fitH) * k;
    this.fitFrameH += (s.frameH - this.fitFrameH) * k;
    this.fitIntroTop += (s.introTop - this.fitIntroTop) * k;
    this.fitIntroHW += (s.introHalfW - this.fitIntroHW) * k;
    this.fitR += (s.radius - this.fitR) * k;
    this.fitCy += (s.cy - this.fitCy) * k;
    this.fitHalfW += (s.halfW - this.fitHalfW) * k;
    if (
      Math.abs(this.fitFrameH - this.framedH) > 1e-4 ||
      Math.abs(this.fitIntroTop - this.framedIntroTop) > 1e-4 ||
      Math.abs(this.fitIntroHW - this.framedIntroHW) > 1e-4 ||
      Math.abs(this.fitR - this.framedR) > 1e-4
    )
      this.cameraDirty = true;
  }

  // ───────────────────────────── 尺寸 / 取景 ─────────────────────────────

  private readonly onResize = (): void => {
    this.setViewport(this.host.clientWidth, this.host.clientHeight);
  };

  private setViewport(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.sizeDirty = true;
  }

  /** 按画质封顶像素比；尺寸变化时更新绘制缓冲、重读名牌高度并标记重新取景 */
  private syncSize(r: THREE.WebGLRenderer): void {
    const cap = PIXEL_RATIO_CAP[this.ctx.settings.quality] ?? 2;
    const pr = Math.min(window.devicePixelRatio || 1, cap);
    if (pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      r.setPixelRatio(pr);
      this.sizeDirty = true;
    }
    if (!this.sizeDirty) return;
    this.sizeDirty = false;
    r.setSize(this.width, this.height, false);
    let plate = NaN;
    try {
      plate = parseFloat(getComputedStyle(this.host).getPropertyValue('--gf-stage-plate'));
    } catch {
      /* 读不到就用默认值 */
    }
    this.plateReserve = Number.isFinite(plate) && plate >= 0 ? plate : PLATE_RESERVE;
    this.cameraDirty = true;
  }

  /** 相机在 (0, yc, d) 注视 (0, yt, 0) 时，点 (0, y, z) 在像平面（焦距 = 1）上的竖直坐标 */
  private static projectY(d: number, yc: number, yt: number, y: number, z: number): number {
    const tanP = (yt - yc) / d;
    const D = d - z;
    const dy = y - yc;
    return (dy - D * tanP) / (dy * tanP + D);
  }

  /** 脚底到头顶（转轴上，高 H）在像平面上的竖直跨度；d 为相机到转轴的水平距离 */
  private static spanAt(d: number, H: number, yc: number, yt: number): number {
    return HeroPreview.projectY(d, yc, yt, H, 0) - HeroPreview.projectY(d, yc, yt, 0, 0);
  }

  /** 让脚底到高 H 在像平面上的跨度等于 S 的相机距离（跨度随距离近似反比，几步迭代即收敛） */
  private static solveDist(S: number, H: number, yc: number, yt: number): number {
    let d = H / S;
    for (let i = 0; i < 6; i++) d *= HeroPreview.spanAt(d, H, yc, yt) / S;
    return d;
  }

  /**
   * 取景：相机在 (0, CAM_Y·Hb, d) 注视 (0, AIM_Y·Hb, 0)（Hb = 身高）。先按「最高点 / 脚底应落在画面的哪一行」
   * 解出距离 d（最高点取实测的等效高度：含狐尾火焰、岩熊前倾的头），画面太窄放不下英雄的水平半径时再拉远；
   * 最后用竖直镜头平移把脚底精确放到名牌之上。竖直构图与宽高比无关，所以窄屏时头和脚都不会出画。
   * 亮相动作伸展得更开（狐尾火焰升高、雷隼展翅）时，按 introPull（0–1 的包络）把相机临时拉远到「亮相范围也放得下」
   * 的距离，脚底所在行不变——英雄以脚为基点略微缩小，动作结束后再推回待机取景。舞台背景的 CSS 变量始终按待机取景写。
   */
  private syncCamera(): void {
    this.cameraDirty = false;
    const w = this.width;
    const h = this.height;
    if (w <= 0 || h <= 0) return;
    this.framedH = this.fitFrameH;
    this.framedIntroTop = this.fitIntroTop;
    this.framedIntroHW = this.fitIntroHW;
    this.framedR = this.fitR;
    this.framedPull = this.introPull;
    const Hb = Math.max(0.5, this.fitH);
    const H0 = Math.max(Hb, this.fitFrameH);
    const R = Math.max(0.2, this.fitR);
    const aspect = w / h;
    const yc = CAM_Y * Hb;
    const yt = AIM_Y * Hb;
    const k2 = 2 * TAN_HALF_FOV;

    // 画面上脚底 / 最高点所在的行（px，自顶边起）；身高差保留不会把最高点推到 TOP_HARD 以上
    const feetPx = h - Math.max(FEET_FRAC * h, this.plateReserve + PLATE_GAP);
    const topPx = Math.max(TOP_FRAC * h, TOP_MIN);
    const topHard = Math.max(TOP_HARD * h, TOP_MIN);
    const span = clamp((feetPx - topPx) * Math.pow(H0 / REF_H, SIZE_KEEP), 24, Math.max(24, feetPx - topHard));

    // 待机取景
    const d0 = Math.max(
      HeroPreview.solveDist((span / h) * k2, H0, yc, yt),
      R / (TAN_HALF_FOV * aspect * WIDTH_FILL),
      H0 * 0.8,
    );
    // 因画面过窄而拉远时英雄变矮：把多出来的空白上下均分（脚底只会上移，不会压到名牌）
    const shrink = span - (HeroPreview.spanAt(d0, H0, yc, yt) / k2) * h;
    const feetRow = feetPx - Math.max(0, shrink) / 2;

    // 亮相取景：最高点离顶边至少 INTRO_EDGE，水平伸展至多占半宽的 INTRO_WIDTH_FILL
    let d = d0;
    if (this.introPull > 0) {
      const introEdge = Math.max(INTRO_EDGE * h, 4);
      const room = Math.max(24, feetRow - introEdge);
      const d1 = Math.max(
        d0,
        HeroPreview.solveDist((room / h) * k2, Math.max(H0, this.fitIntroTop), yc, yt),
        this.fitIntroHW / (TAN_HALF_FOV * aspect * INTRO_WIDTH_FILL),
      );
      d = d0 + (d1 - d0) * this.introPull;
    }

    // 画面中心在像平面上的位置：让脚底落在 feetRow
    const c = HeroPreview.projectY(d, yc, yt, 0, 0) - (1 - (2 * feetRow) / h) * TAN_HALF_FOV;

    const cam = this.camera;
    cam.fov = FOV;
    cam.aspect = aspect;
    cam.near = 0.1;
    cam.far = d + 10;
    cam.position.set(0, yc, d);
    cam.lookAt(0, yt, 0);
    cam.setViewOffset(w, h, 0, (-c * h) / k2, w, h);
    cam.updateProjectionMatrix();

    // 舞台背景按待机取景对齐（亮相拉远的一秒里背景不跟着动）；视平线是水平方向无穷远处（像平面坐标 −tanP）
    const c0 = d === d0 ? c : HeroPreview.projectY(d0, yc, yt, 0, 0) - (1 - (2 * feetRow) / h) * TAN_HALF_FOV;
    const row = (u: number): number => (h / 2) * (1 - (u - c0) / TAN_HALF_FOV);
    this.writeStageVars(row(-(yt - yc) / d0), feetRow, row(HeroPreview.projectY(d0, yc, yt, FOCUS_Y * Hb, 0)));
  }

  private writeStageVars(horizon: number, feet: number, focus: number): void {
    const st = this.host.style;
    if (!(Math.abs(horizon - this.cssHorizon) < 0.5)) {
      this.cssHorizon = horizon;
      st.setProperty('--gf-stage-horizon', `${horizon.toFixed(1)}px`);
    }
    if (!(Math.abs(feet - this.cssFeet) < 0.5)) {
      this.cssFeet = feet;
      st.setProperty('--gf-stage-feet', `${feet.toFixed(1)}px`);
    }
    if (!(Math.abs(focus - this.cssFocus) < 0.5)) {
      this.cssFocus = focus;
      st.setProperty('--gf-stage-focus', `${focus.toFixed(1)}px`);
    }
  }

  // ───────────────────────────── 循环 ─────────────────────────────

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const prev = this.lastNow;
    this.lastNow = now;
    const r = this.renderer;
    if (!r || this.lost || document.hidden || !this.host.isConnected || !r.domElement.isConnected) return;
    if (!this.ro) this.setViewport(this.host.clientWidth, this.host.clientHeight);
    if (this.width <= 0 || this.height <= 0) return;
    const dt = prev < 0 ? 0 : Math.min(MAX_DT, Math.max(0, (now - prev) / 1000));
    if (this.envDirty) this.buildEnvironment(r);
    this.syncSize(r);
    this.tick(dt);
    if (this.cameraDirty) this.syncCamera();
    r.render(this.scene, this.camera);
  };

  private tick(dt: number): void {
    const calm = this.reduced;
    const motion = calm ? REDUCED_SPEED : 1;
    this.time += dt;
    const t = this.time;

    if (calm) this.theme.copy(this.themeTarget);
    else this.theme.lerp(this.themeTarget, 1 - Math.exp(-7 * dt));

    this.updateYaw(dt, calm);
    const cur = this.current;
    if (cur) this.followFit(cur, dt, calm);
    const slots = this.slotList;
    for (let i = 0; i < slots.length; i++) this.updateSlot(slots[i], dt, dt * motion);
    this.warmStep();

    // 亮相拉远：包络本身是平滑的，亮相中直接跟随；切走英雄等导致目标骤降时按 PULL_RELEASE 平滑推回
    // （亮相中途重播时包络从 0 重新开始：先平滑回落，等上升沿追上再跟随）
    const inIntro = !!cur && cur.showing && !calm && cur.introT >= 0;
    const pullTarget = inIntro ? introEnvelope(cur.introT) : 0;
    const follow = pullTarget >= this.introPull || (inIntro && cur.introT >= PULL_IN_B);
    let pull = follow ? pullTarget : damp(this.introPull, pullTarget, PULL_RELEASE, dt);
    if (pull < 1e-3) pull = 0;
    this.introPull = pull;
    if (Math.abs(pull - this.framedPull) > 1e-4) this.cameraDirty = true;

    // 氛围
    const f = this.frameInfo;
    f.dt = dt * motion;
    f.t = t;
    f.calm = calm;
    f.yaw = this.yaw + (cur ? cur.cur.r : 0);
    f.cy = this.fitCy;
    f.halfW = this.fitHalfW;
    f.height = this.fitH;
    let flash = 0;
    const ambs = this.ambienceList;
    for (let i = 0; i < ambs.length; i++) {
      const a = ambs[i];
      if (a.vis !== a.target) a.vis = calm ? a.target : approach(a.vis, a.target, dt / AMB_FADE);
      const visible = a.vis > 0.001;
      a.amb.group.visible = visible;
      if (!visible) continue;
      a.amb.update(f, a.vis * a.vis * (3 - 2 * a.vis));
      flash = Math.max(flash, a.amb.flash);
    }
    this.flash = damp(this.flash, flash, 18, dt);

    // 祭台与灯光
    const altar = this.altar;
    altar?.update(dt, t, this.theme, motion, calm);
    const surge = altar ? altar.flare : 0;
    this.rimA.color.copy(this.theme);
    this.rimB.color.copy(this.theme);
    this.rimA.intensity = RIM_A * (1 + RIM_SURGE * surge);
    this.rimB.intensity = RIM_B * (1 + RIM_SURGE * surge);
    this.point.color.copy(this.theme);
    this.point.intensity =
      POINT_BASE * (calm ? 1 : 0.85 + 0.15 * Math.sin(t * 1.6)) + this.flash * POINT_FLASH + surge * POINT_SURGE;
  }

  /**
   * 朝向：拖拽时跟手并估算角速度；松手后惯性衰减，RETURN_DELAY 秒后用临界阻尼弹簧就近转回默认朝向
   * （目标叠加很慢的 ±4° 轻摆）。不会持续自转。
   */
  private updateYaw(dt: number, calm: boolean): void {
    if (this.dragId !== null) {
      if (dt > 0) this.spinVel = damp(this.spinVel, clamp(this.dragAcc / dt, -SPIN_MAX, SPIN_MAX), 18, dt);
      this.dragAcc = 0;
    } else {
      this.idle += dt;
      if (this.idle < RETURN_DELAY) {
        this.spinVel *= Math.exp(-(calm ? 8 : INERTIA_DECAY) * dt);
        this.yaw += this.spinVel * dt;
      } else {
        const sway = calm ? 0 : Math.sin(this.time * SWAY_RATE) * SWAY_AMP;
        const target = this.yaw + angleDiff(this.yaw, BASE_YAW + sway);
        const w = RETURN_OMEGA;
        this.spinVel += (w * w * (target - this.yaw) - 2 * w * this.spinVel) * dt;
        this.yaw += this.spinVel * dt;
      }
    }
    // 规约到默认朝向附近（旋转是周期的，不产生跳变）
    const rel = this.yaw - BASE_YAW;
    if (rel > Math.PI || rel < -Math.PI) this.yaw = BASE_YAW + angleDiff(0, rel);
  }

  private updateSlot(s: HeroSlot, dt: number, rigDt: number): void {
    if (!s.pivot.parent) return;
    s.t += dt;
    const k = clamp01(s.t / s.dur);
    const to = s.showing ? REST : SUNK;
    const c = s.cur;
    let arrived = false;
    if (k >= 1) {
      copyPose(c, to);
      if (!s.showing) {
        s.introT = -1;
        s.pivot.visible = false;
        this.scene.remove(s.pivot);
        return;
      }
      arrived = true;
    } else {
      const from = s.from;
      let ey: number;
      let eo: number;
      if (s.showing) {
        // 升起：位移 ease-out（三次），不透明度更早到位
        const u = 1 - k;
        ey = 1 - u * u * u;
        const ko = Math.min(1, k * 1.6);
        eo = 1 - (1 - ko) * (1 - ko);
      } else {
        // 沉入：加速下沉，不透明度略快于位移地线性淡出
        ey = k * k;
        eo = Math.min(1, k * 1.25);
      }
      c.y = lerp(from.y, to.y, ey);
      c.s = lerp(from.s, to.s, ey);
      c.r = lerp(from.r, to.r, ey);
      c.o = lerp(from.o, to.o, eo);
    }
    const p = s.pivot;
    // 透明度接近 0 时整体隐藏（避免看不见的模型仍写深度、挡住后面的粒子）
    p.visible = c.o > 0.01;
    p.position.y = c.y;
    p.rotation.y = this.yaw + c.r;
    p.scale.setScalar(c.s);
    if (s.introT >= 0) {
      s.introT += rigDt;
      if (s.introT > PULL_OUT) s.introT = -1;
    }
    if (p.visible && !s.broken) {
      try {
        s.clock += rigDt;
        s.rig.update(rigDt, s.clock);
      } catch (err) {
        s.broken = true;
        console.error('[HeroPreview] 英雄模型 update 出错，已停止其动画', s.id, err);
      }
    }
    if (arrived && s.introPending) {
      s.introPending = false;
      if (!this.reduced && !s.broken) {
        try {
          s.rig.playIntro();
          s.introT = 0;
        } catch (err) {
          console.error('[HeroPreview] 英雄亮相动作出错', s.id, err);
        }
      }
    }
    // 在 rig.update 之后写不透明度（过渡期间覆盖模型自己的不透明度动画）
    this.applyFade(s, c.o);
  }

  /**
   * 淡入淡出：半透明期间把材质切成 transparent 并按比例缩放不透明度；完全显现后恢复原始 transparent 与不透明度
   * （不透明材质回到不透明队列，保证与模型自带的加性特效的绘制次序正确）。切换 transparent 需要 needsUpdate。
   */
  private applyFade(s: HeroSlot, o: number): void {
    const fading = o < 0.999;
    if (fading !== s.fading) {
      s.fading = fading;
      const fades = s.fades;
      for (let i = 0; i < fades.length; i++) {
        const f = fades[i];
        const want = fading || f.transparent;
        if (f.mat.transparent !== want) {
          f.mat.transparent = want;
          f.mat.needsUpdate = true;
        }
      }
    }
    if (!fading && s.appliedO === 1) return;
    const v = fading ? o : 1;
    s.appliedO = v;
    const fades = s.fades;
    for (let i = 0; i < fades.length; i++) fades[i].mat.opacity = fades[i].base * v;
  }

  // ───────────────────────────── 事件 ─────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.dragId !== null || !this.canvas) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.dragId = e.pointerId;
    this.dragX = e.clientX;
    this.dragAcc = 0;
    this.dragDist = 0;
    this.suppressClick = false;
    this.idle = 0;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已失效 */
    }
    this.canvas.style.cursor = 'grabbing';
    if (e.pointerType === 'mouse') e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    const dx = e.clientX - this.dragX;
    this.dragX = e.clientX;
    this.dragDist += Math.abs(dx);
    const d = dx * DRAG_YAW;
    this.yaw += d;
    this.dragAcc += d;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    if (this.dragDist > 6) this.suppressClick = true;
    this.endDrag();
  };

  private endDrag(): void {
    if (this.dragId === null) return;
    const id = this.dragId;
    this.dragId = null;
    this.idle = 0;
    const c = this.canvas;
    if (!c) return;
    c.style.cursor = 'grab';
    try {
      if (c.hasPointerCapture(id)) c.releasePointerCapture(id);
    } catch {
      /* 指针已失效 */
    }
  }

  /** 拖拽结束后的 click 不再冒泡（避免触发外层的点击 / 双击逻辑） */
  private readonly onClick = (e: MouseEvent): void => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
  };

  private readonly onContextRestored = (): void => {
    this.lost = false;
    this.pixelRatio = 0;
    this.sizeDirty = true;
    // PMREM 是 GPU 渲染出来的，上下文丢失后内容无法自动恢复；下一帧（three 自身完成恢复后）重建
    this.envDirty = true;
  };

  private readonly onMotionPref = (e: MediaQueryListEvent): void => {
    this.reduced = e.matches;
  };
}
