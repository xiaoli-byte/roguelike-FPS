import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { postEffects } from '../../render/PostStack';
import { stylizedShared } from '../UnityStylizedLit';
import type { UnitySceneDocument } from '../UnityLevelLibrary';
import { heightSampler } from './document';
import type { DesertBuild, DesertMapArt, DesertPart } from './spec';

// Vite 只在编译时替换 import.meta.glob(...) 调用本身，运行时没有这个函数：按 import.meta.env 判断是不是在 Vite 里（node 测试里没有）
const DEMOS: Record<string, () => Promise<unknown>> = import.meta.env ? import.meta.glob('./demos/*.ts') : {};

function demoNames(): string[] {
  if (typeof location === 'undefined') return [];
  return (new URLSearchParams(location.search).get('desertDemo') ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 美术重建层的运行时部分：UnitySceneView 搭好场景后建（远景、沙丘脊、环境特效、补光、新模型……），每帧 update，卸载时 dispose。
 * 出了错只是这张图少了这一层，不能挡住进关（UnitySceneView 里包了 try）。
 */
export class DesertArtLayer {
  readonly group = new THREE.Group();
  private parts: DesertPart[] = [];
  private offGrade: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly document: UnitySceneDocument, readonly art: DesertMapArt) {
    this.group.name = `desert-art-${art.id}`;
  }

  async build(parent: THREE.Object3D): Promise<void> {
    parent.add(this.group);
    if (this.art.grade) this.offGrade = postEffects.addLayer({ priority: 20, weight: 1, overrides: this.art.grade });
    stylizedShared.uSflRimBack.value = this.art.rimBack ?? 0;
    const terrain = heightSampler(this.document);
    const ctx = this.ctx;
    const b: DesertBuild = {
      ctx, document: this.document, group: this.group, art: this.art,
      terrainHeight: terrain,
      groundHeight: (x, z, top = 400) => {
        const world = ctx.world as { groundHeight?: (x: number, z: number, top: number, radius?: number) => number } | undefined;
        const g = world?.groundHeight?.(x, z, top, 0.2);
        return g !== undefined && Number.isFinite(g) && g > -1e5 ? g : terrain(x, z);
      },
      rendererUrl: m => this.document.renderers.find(r => typeof m === 'string' ? r.name === m || r.scenePath?.startsWith(m) : m.test(r.name) || m.test(r.scenePath ?? ''))?.url ?? null,
      low: ctx.settings?.quality === 'low',
    };
    const parts = this.art.build ? await this.art.build(b) : [];
    // 演示模块（src/world/desert/demos/<名>.ts，网址 desertDemo=<名>[,<名>]）：做共用模块时单独验图用，不进正式规格
    for (const name of demoNames()) {
      const load = DEMOS[`./demos/${name}.ts`];
      if (!load) { console.warn(`[desert] 没有演示模块 ${name}`); continue; }
      const mod = await load() as { build?: (b: DesertBuild) => Promise<DesertPart[]> | DesertPart[] };
      if (mod.build) parts.push(...await mod.build(b));
    }
    if (this.disposed) {
      for (const p of parts) p.dispose();
      return;
    }
    this.parts = parts;
  }

  update(dt: number, t: number): void {
    for (const p of this.parts) p.update?.(dt, t);
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    this.offGrade?.();
    this.offGrade = null;
    stylizedShared.uSflRimBack.value = 0;
    this.group.removeFromParent();
  }
}
