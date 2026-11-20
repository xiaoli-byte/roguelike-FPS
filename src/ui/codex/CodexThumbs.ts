/**
 * 图鉴缩略图（Unity G/UI/Screens/CodexThumbs.cs 的网页对应）：把模型摆进一个离屏的小摄影棚，拍成 256² 的透明底图，按条目缓存（一次会话拍一次）。
 *   · 摄影棚：独立的场景 + 正交相机 + 三盏平行光（主光、补光、轮廓光）+ 中性灰环境光，用游戏的渲染器画到渲染目标上（2 倍超采样再缩小），
 *     画完立刻还原渲染器状态（同一帧里，游戏画面不受影响）。
 *   · 机位：武器从右侧看枪身（枪口朝右，略带俯视）；敌人、首领、灵宠从前方偏右上 3/4 角看。正交相机按包围盒取景。
 *   · 模型：武器 = 武器系统的世界模型（ctx.weapons.createWorldModel）；敌人 / 首领 = 美术资源库里绑定到它的模型（AssetLibrary，静止姿势）。
 *     秘卷没有模型；灵宠本体是 M9，没有模型来源时不拍（界面显示单字签）。
 * 未收录的条目在界面上把同一张图压成黑色剪影（CSS filter）。
 * 网页差异：Unity 用差分抠像（URP 中间缓冲不保留 alpha），网页的渲染目标本来就带 alpha；敌人拍的是绑定姿势（Unity 先求动画第 0 帧）。
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GameContext, WeaponInstance } from '../../core/types';
import { AssetLibrary } from '../../assets/AssetLibrary';
import type { CodexEntry } from './Codex';

export const THUMB_SIZE = 256;
const SUPER = 2;

export class CodexThumbs {
  private readonly cache = new Map<string, string>();
  private readonly missing = new Set<string>();
  private scene: THREE.Scene | null = null;
  private cam: THREE.OrthographicCamera | null = null;
  private target: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly ctx: GameContext) {}

  private key(e: CodexEntry): string {
    return `${e.kind}:${e.id}`;
  }

  /** 这一类条目有没有模型可拍（秘卷没有） */
  hasModel(e: CodexEntry | null): boolean {
    return !!e && e.kind !== 'scroll';
  }

  /** 已经拍过（或确认拍不了） */
  ready(e: CodexEntry | null): boolean {
    return !e || !this.hasModel(e) || this.cache.has(this.key(e)) || this.missing.has(this.key(e));
  }

  /** 缓存里的缩略图（data URL；还没拍 / 拍不了为 null） */
  peek(e: CodexEntry | null): string | null {
    return (e && this.cache.get(this.key(e))) || null;
  }

  /** 拍过的张数（测试用） */
  get count(): number {
    return this.cache.size;
  }

  /** 取缩略图：没拍过就现在拍（同步）；没有模型返回 null。美术资源还没读到时返回 null 但不记「拍不了」（下一帧再试） */
  get(e: CodexEntry): string | null {
    const k = this.key(e);
    if (!this.hasModel(e) || this.missing.has(k)) return null;
    const hit = this.cache.get(k);
    if (hit) return hit;
    let model: THREE.Object3D | null | 'later' = null;
    try {
      model = this.build(e);
    } catch (err) {
      console.warn(`[UI] 图鉴缩略图建不出模型 ${k}`, err);
    }
    if (model === 'later') return null;
    let url: string | null = null;
    if (model) {
      try {
        url = this.render(model, e.kind === 'weapon');
      } catch (err) {
        console.warn(`[UI] 图鉴缩略图拍不了 ${k}`, err);
      }
    }
    if (url) this.cache.set(k, url);
    else this.missing.add(k);
    return url;
  }

  /** 拆掉摄影棚（图鉴关上时；缓存的图留着） */
  releaseRig(): void {
    this.target?.dispose();
    this.target = null;
    this.scene = null;
    this.cam = null;
  }

  private build(e: CodexEntry): THREE.Object3D | null | 'later' {
    if (e.kind === 'weapon') {
      const def = e.def as { id: string; element?: string };
      const inst = { uid: -1, defId: def.id, rarity: 0, element: def.element ?? 'none', level: 0, mag: 0, reserve: 0, affixes: [] } as unknown as WeaponInstance;
      return this.ctx.weapons.createWorldModel(inst);
    }
    if (e.kind === 'enemy') {
      const asset = AssetLibrary.findBound('enemy', e.id) ?? AssetLibrary.findBound('boss', e.id);
      if (!asset) return AssetLibrary.enabled && !AssetLibrary.unavailable(e.id) && tries(this, e) < 120 ? 'later' : null;
      const root = cloneSkinned(asset.gltf.scene);
      for (const a of AssetLibrary.findAttachments('enemy', e.id)) root.add(a.gltf.scene.clone(true));
      return root;
    }
    return null;
  }

  private rig(): { scene: THREE.Scene; cam: THREE.OrthographicCamera; target: THREE.WebGLRenderTarget } {
    if (!this.scene || !this.cam || !this.target) {
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0x8a8a90, 1.2));
      const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
      key.position.set(2.2, 3.4, 3);
      const fill = new THREE.DirectionalLight(0x9db4ff, 0.7);
      fill.position.set(-3, 1.2, 2);
      const rim = new THREE.DirectionalLight(0xffd9a0, 1.4);
      rim.position.set(-1.5, 2.5, -3.5);
      scene.add(key, fill, rim);
      this.scene = scene;
      this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
      this.target = new THREE.WebGLRenderTarget(THUMB_SIZE * SUPER, THUMB_SIZE * SUPER, { depthBuffer: true });
      this.target.texture.colorSpace = THREE.SRGBColorSpace;
    }
    return { scene: this.scene, cam: this.cam, target: this.target };
  }

  private render(model: THREE.Object3D, weapon: boolean): string | null {
    const { scene, cam, target } = this.rig();
    const holder = new THREE.Group();
    holder.add(model);
    scene.add(holder);
    try {
      holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(holder);
      if (box.isEmpty()) return null;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(0.05, size.length() * 0.5);
      // 武器：从侧面看枪身（略带俯视）；其余：前方偏右上 3/4 角
      const dir = weapon ? new THREE.Vector3(1, 0.22, 0.12).normalize() : new THREE.Vector3(0.55, 0.38, 1).normalize();
      cam.position.copy(center).addScaledVector(dir, radius * 4);
      cam.up.set(0, 1, 0);
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      // 按包围盒八个角在画面里的投影取景（留 8% 边）
      const inv = cam.matrixWorldInverse;
      let hx = 0, hy = 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
        hx = Math.max(hx, Math.abs(v.x));
        hy = Math.max(hy, Math.abs(v.y));
      }
      const half = Math.max(hx, hy, 0.02) * 1.08;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.near = 0.01;
      cam.far = radius * 8;
      cam.updateProjectionMatrix();

      const r = this.ctx.renderer;
      const prevTarget = r.getRenderTarget();
      const prevColor = r.getClearColor(new THREE.Color());
      const prevAlpha = r.getClearAlpha();
      const prevTone = r.toneMapping;
      const prevAuto = r.autoClear;
      const n = THUMB_SIZE * SUPER;
      const px = new Uint8Array(n * n * 4);
      try {
        r.toneMapping = THREE.NoToneMapping;
        r.autoClear = true;
        r.setRenderTarget(target);
        r.setClearColor(0x000000, 0);
        r.clear();
        r.render(scene, cam);
        r.readRenderTargetPixels(target, 0, 0, n, n, px);
      } finally {
        r.setRenderTarget(prevTarget);
        r.setClearColor(prevColor, prevAlpha);
        r.toneMapping = prevTone;
        r.autoClear = prevAuto;
      }
      // 上下翻回来，缩到 256²
      const big = document.createElement('canvas');
      big.width = big.height = n;
      const bg = big.getContext('2d');
      if (!bg) return null;
      const img = bg.createImageData(n, n);
      for (let y = 0; y < n; y++) img.data.set(px.subarray((n - 1 - y) * n * 4, (n - y) * n * 4), y * n * 4);
      bg.putImageData(img, 0, 0);
      const out = document.createElement('canvas');
      out.width = out.height = THUMB_SIZE;
      const og = out.getContext('2d');
      if (!og) return null;
      og.imageSmoothingQuality = 'high';
      og.drawImage(big, 0, 0, THUMB_SIZE, THUMB_SIZE);
      return out.toDataURL('image/png');
    } finally {
      scene.remove(holder);
    }
  }
}

const tryCount = new WeakMap<CodexThumbs, Map<string, number>>();
/** 等美术资源读到的重试次数（每帧一次，约 2 秒后放弃） */
function tries(t: CodexThumbs, e: CodexEntry): number {
  let m = tryCount.get(t);
  if (!m) tryCount.set(t, (m = new Map()));
  const k = `${e.kind}:${e.id}`;
  const n = (m.get(k) ?? 0) + 1;
  m.set(k, n);
  return n;
}
