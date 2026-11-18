/**
 * 机关用到的场景件：按 scenePath 找渲染件（UnitySceneView 给每个渲染件根节点写了 userData.scenePath）和碰撞盒（场景文档 colliders 的
 * scenePath → 包围盒对上 ctx.world.boxes），以及把一组渲染件当成一个 Transform 来动（绕导出的枢轴平移 / 旋转 / 缩放）。
 * 另有全屏闪色（Unity GameUI.ScreenFlash）。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { StaticBox } from '../Collision';
import type { UnitySceneDocument } from '../UnityLevelLibrary';

/** scenePath 在 root 下（等于它或以「它/」开头） */
export function under(scenePath: string | undefined | null, root: string | null | undefined): boolean {
  return !!scenePath && !!root && (scenePath === root || scenePath.startsWith(`${root}/`));
}

export class SceneParts {
  private readonly roots: THREE.Object3D[] = [];

  constructor(private readonly ctx: GameContext, private readonly document: UnitySceneDocument, group: THREE.Object3D) {
    for (const child of group.children) if (typeof child.userData.scenePath === 'string') this.roots.push(child);
  }

  /** 路径下的渲染件根节点（世界变换就是渲染件的世界变换） */
  rootsUnder(path: string | null | undefined): THREE.Object3D[] {
    if (!path) return [];
    return this.roots.filter(r => under(r.userData.scenePath as string, path));
  }

  /** 路径完全相同的渲染件 */
  rootsAt(path: string | null | undefined): THREE.Object3D[] {
    if (!path) return [];
    return this.roots.filter(r => r.userData.scenePath === path);
  }

  /** 场上所有渲染件（找熔岩材质用） */
  all(): readonly THREE.Object3D[] { return this.roots; }

  /** 路径下的碰撞盒（场景文档的碰撞体按包围盒对上 ctx.world.boxes） */
  collidersUnder(path: string | null | undefined): StaticBox[] {
    if (!path) return [];
    const out: StaticBox[] = [];
    const boxes = this.ctx.world.boxes;
    for (const c of this.document.colliders) {
      if (!under(c.scenePath, path) || c.platform !== undefined) continue;
      const hit = boxes.find(b => !out.includes(b) && Math.abs(b.minX - c.min[0]) < 0.05 && Math.abs(b.maxX - c.max[0]) < 0.05
        && Math.abs(b.minY - c.min[1]) < 0.05 && Math.abs(b.maxY - c.max[1]) < 0.05 && Math.abs(b.minZ - c.min[2]) < 0.05 && Math.abs(b.maxZ - c.max[2]) < 0.05);
      if (hit) out.push(hit);
    }
    return out;
  }
}

const _m = new THREE.Matrix4(), _d = new THREE.Matrix4(), _t = new THREE.Matrix4(), _pivotInv = new THREE.Matrix4();
const _zero = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _ident = new THREE.Quaternion();

/**
 * 一组渲染件当成一个 Transform 动：枢轴 = 导出的那个 Transform 的世界位置 / 旋转；set() 给「相对原样」的本地平移 / 旋转 / 缩放，
 * 每个渲染件的世界矩阵 = 枢轴 × 增量 × 枢轴⁻¹ × 原世界矩阵（同 Unity 改子物体的 localPosition / localRotation / localScale）
 */
export class PartGroup {
  readonly pivot = new THREE.Matrix4();
  private readonly base: THREE.Matrix4[];
  private shown = true;

  constructor(readonly roots: readonly THREE.Object3D[], position: readonly number[] | null, rotation: readonly number[] | null = null) {
    const p = position ? new THREE.Vector3(position[0], position[1], position[2]) : new THREE.Vector3();
    const q = rotation ? new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]) : new THREE.Quaternion();
    this.pivot.compose(p, q, new THREE.Vector3(1, 1, 1));
    _pivotInv.copy(this.pivot).invert();
    this.base = roots.map(r => {
      r.updateMatrix();
      return _pivotInv.clone().multiply(r.matrix);
    });
  }

  get empty(): boolean { return this.roots.length === 0; }

  /** 相对原样的本地变换（枢轴空间）；worldOffset = 之后再整体平移（世界空间） */
  set(offset: THREE.Vector3 | null, rotation: THREE.Quaternion | null = null, scale: THREE.Vector3 | null = null, worldOffset: THREE.Vector3 | null = null): void {
    _d.compose(offset ?? _zero, rotation ?? _ident, scale ?? _one);
    for (let i = 0; i < this.roots.length; i++) {
      _m.copy(this.pivot).multiply(_d).multiply(this.base[i]);
      if (worldOffset) _m.premultiply(_t.makeTranslation(worldOffset.x, worldOffset.y, worldOffset.z));
      _m.decompose(this.roots[i].position, this.roots[i].quaternion, this.roots[i].scale);
    }
  }

  /** 世界空间里整体挪（不转） */
  setWorldOffset(offset: THREE.Vector3): void {
    _m.makeTranslation(offset.x, offset.y, offset.z);
    for (let i = 0; i < this.roots.length; i++) {
      _d.copy(_m).multiply(this.pivot).multiply(this.base[i]);
      _d.decompose(this.roots[i].position, this.roots[i].quaternion, this.roots[i].scale);
    }
  }

  setVisible(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    for (const r of this.roots) r.visible = on;
  }

  get visible(): boolean { return this.shown; }

  /** 材质（克隆到自己名下，调色 / 发光用） */
  ownMaterials(): THREE.Material[] {
    const out: THREE.Material[] = [];
    for (const root of this.roots) root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clones = list.map(m => m.clone());
      mesh.material = Array.isArray(mesh.material) ? clones : clones[0];
      out.push(...clones);
    });
    return out;
  }
}

/** 全屏闪色（Unity GameUI.ScreenFlash：颜色带 alpha，seconds 秒淡出） */
export class ScreenFlash {
  private el: HTMLDivElement | null = null;
  private level = 0;
  private fade = 1;

  flash(rgba: readonly [number, number, number, number], seconds: number): void {
    if (typeof document === 'undefined') return;
    if (!this.el) {
      const el = document.createElement('div');
      el.className = 'mechanism-flash';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;opacity:0;';
      (document.getElementById('app') ?? document.body).appendChild(el);
      this.el = el;
    }
    const [r, g, b, a] = rgba;
    this.el.style.background = `radial-gradient(ellipse at 50% 55%, rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${(a * 0.25).toFixed(3)}) 0%, rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${a.toFixed(3)}) 100%)`;
    this.level = 1;
    this.fade = 1 / Math.max(0.05, seconds);
  }

  update(dt: number): void {
    if (!this.el || this.level <= 0) return;
    this.level = Math.max(0, this.level - dt * this.fade);
    this.el.style.opacity = this.level.toFixed(3);
  }

  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}

/** Unity Color（线性 0..1）→ CSS 颜色 */
export function cssColor(c: readonly number[]): string {
  return `#${new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHexString()}`;
}

/** 0xRRGGBB（Unity Hex.Rgb 的 sRGB 值） */
export function hexOf(c: readonly number[]): number {
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHex();
}
