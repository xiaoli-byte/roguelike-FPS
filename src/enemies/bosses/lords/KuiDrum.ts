/**
 * 山头的残破雷鼓（Unity Kui/KuiDrum.cs；SM_Prop_KuiBrokenDrum，夔没现身时倒在山头）：登场从鼓里长出来，死时倒回鼓里。
 * 摆位：场景文档里导出的渲染件 SM_Prop_KuiBrokenDrum_LOD0（Unity 场地 BossArena · 夔 下的 KuiDrum/Model）；这里只管显隐、被雷劈中的裂光、震动。
 * 导出的残鼓在 (−205, 48.5, 131)，离夔的出生点（残鼓本该在的地方，(−115, 48.3, 61)）112 m：Unity 构建器 Level_4_1.BuildLords 用
 * ShowcaseSceneBuilder.Place 把世界坐标当成了场地下的局部坐标（多加了一次场地中心 (−90, 70)）。网页照设计意图把它挪回出生点（贴地高度不变）。
 * 场景里没摆时（检视页）在首领出生点立一个程序化的放倒的鼓（圆柱 + 鼓皮）。
 */
import * as THREE from 'three';
import type { GameContext } from '../../../core/types';
import { KuiPalette } from './KuiPlans';

export const KUI_DRUM_NAME = 'SM_Prop_KuiBrokenDrum_LOD0';

export class KuiDrum {
  /** 被雷劈过几次（测试用） */
  struck = 0;
  visible = true;
  /** 导出的残鼓离出生点太远、挪回来了 */
  relocated = false;
  readonly placeholder: boolean;
  private readonly rest = new THREE.Vector3();
  private shakeLeft = 0;
  private shakeAmp = 0;

  private constructor(private readonly ctx: GameContext, readonly object: THREE.Object3D, placeholder: boolean) {
    this.placeholder = placeholder;
    this.rest.copy(object.position);
  }

  /** 找场景里的残鼓（离出生点 > 12 m 就挪到出生点）；没有就在出生点立一个占位鼓 */
  static ensure(ctx: GameContext, spawn: THREE.Vector3, facing: number): KuiDrum {
    const found = ctx.scene.getObjectByName(KUI_DRUM_NAME);
    if (found) {
      const d = new KuiDrum(ctx, found, false);
      found.updateWorldMatrix(true, false);
      const wp = found.getWorldPosition(new THREE.Vector3());
      if (Math.hypot(wp.x - spawn.x, wp.z - spawn.z) > 12) {
        const g0 = ctx.world.groundHeight(wp.x, wp.z, wp.y + 4, 0);
        const g1 = ctx.world.groundHeight(spawn.x, spawn.z, spawn.y + 4, 0);
        const lift = Number.isFinite(g0) ? wp.y - g0 : 0;
        const target = new THREE.Vector3(spawn.x, (Number.isFinite(g1) ? g1 : spawn.y) + lift, spawn.z);
        found.parent?.worldToLocal(target);
        found.position.copy(target);
        found.updateMatrixWorld(true);
        d.rest.copy(found.position);
        d.relocated = true;
      }
      return d;
    }
    const root = new THREE.Group();
    root.name = 'KuiDrum (placeholder)';
    root.position.copy(spawn);
    root.rotation.y = facing;
    const tilt = new THREE.Group();
    tilt.rotation.x = 80 * Math.PI / 180;
    root.add(tilt);
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3328, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: KuiPalette.Skin, roughness: 0.9 });
    const crack = new THREE.MeshBasicMaterial({ color: KuiPalette.ThunderEdge });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.9, 24), wood);
    body.position.set(0, 0, -0.9);
    tilt.add(body);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.04, 24), skin);
    face.position.set(0, 0.47, -0.9);
    tilt.add(face);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 1.6), crack);
    seam.position.set(0, 0.5, -0.9);
    tilt.add(seam);
    ctx.stageGroup.add(root);
    return new KuiDrum(ctx, root, true);
  }

  /** 鼓心（裂口）的世界位置 */
  center(out = new THREE.Vector3()): THREE.Vector3 {
    return this.object.getWorldPosition(out).setY(out.y + 0.9);
  }

  setVisible(on: boolean): void {
    if (this.visible === on) return;
    this.visible = on;
    this.object.visible = on;
  }

  /** 被雷劈中：裂口紫红一亮、电火星、震一下 */
  strike(): void {
    this.struck++;
    const c = this.center();
    this.ctx.fx.burst(c, KuiPalette.Thunder, 24, 6, 0.5, 0.22, 2);
    this.ctx.fx.explosion(c, 1.2, KuiPalette.Thunder);
    this.rattle(0.35, 0.12);
  }

  rattle(seconds: number, amp: number): void {
    this.shakeLeft = Math.max(this.shakeLeft, seconds);
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  update(dt: number): void {
    if (this.shakeLeft <= 0) return;
    this.shakeLeft -= dt;
    if (this.shakeLeft <= 0) {
      this.object.position.copy(this.rest);
      this.shakeAmp = 0;
      return;
    }
    const k = this.shakeAmp * Math.min(1, this.shakeLeft * 4);
    this.object.position.set(this.rest.x + (Math.random() - 0.5) * 2 * k, this.rest.y + (Math.random() - 0.5) * 2 * k, this.rest.z + (Math.random() - 0.5) * 2 * k);
  }

  dispose(): void {
    if (!this.placeholder) {
      this.object.position.copy(this.rest);
      this.object.visible = true;
      return;
    }
    this.object.removeFromParent();
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }
}
