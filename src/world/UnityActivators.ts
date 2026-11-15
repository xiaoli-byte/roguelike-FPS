import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { unityPoint, type UnityActivator, type UnitySceneDocument } from './UnityLevelLibrary';
import type { UnityPlatformView } from './UnityPlatforms';

class Activator {
  on = false;
  count = 0;
  private lastAt = -Infinity;
  private swingT = -1;
  private hintAt = -Infinity;
  private readonly swing?: THREE.Object3D;
  private readonly lamps: THREE.Mesh[] = [];
  private readonly owned = new Set<THREE.Material>();
  private readonly disposeInteract?: () => void;

  constructor(private readonly ctx: GameContext, private readonly def: UnityActivator, private readonly system: UnityActivatorSystem, roots: ReadonlyMap<string, THREE.Object3D[]>) {
    const objects = roots.get(def.id) ?? [];
    this.swing = objects.find(object => object.userData.unitySwing) ?? objects[0];
    for (const root of objects) {
      if (!root.userData.unityLamp) continue;
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        this.lamps.push(object);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const clones = materials.map(material => material.clone());
        for (const clone of clones) this.owned.add(clone);
        object.material = Array.isArray(object.material) ? clones : clones[0];
      });
    }
    if (def.byInteract) this.disposeInteract = ctx.interact.add({
      position: unityPoint(def.position).add(new THREE.Vector3(0, def.focusHeight, 0)),
      radius: def.interactRadius,
      get enabled() { return !this.def.oneShot || this.count === 0; },
      prompt: () => ({
        title: def.title,
        subtitle: this.locked ? '锁着' : def.toggle ? this.on ? '关上' : '打开' : def.verb,
        lines: [this.locked ? def.lockedHint : def.hint],
        color: this.hex(def.onColor),
      }),
      onInteract: () => this.activate(),
    });
    for (const box of ctx.world.boxes) {
      if (box.tag !== `unity-activator-${def.id}`) continue;
      box.onHit = (damage = Infinity) => {
        if (def.byShot && damage >= def.minShotDamage) this.activate();
      };
    }
  }

  private hex(value: [number, number, number, number]): string {
    return `#${new THREE.Color().setRGB(value[0], value[1], value[2], THREE.SRGBColorSpace).getHexString()}`;
  }

  private get locked(): boolean {
    return !!this.def.lockedBy && !this.ctx.stage.exploration?.encounters?.some(site => site.id === this.def.lockedBy && site.phase === 'cleared');
  }

  activate(force = false): boolean {
    if (this.def.oneShot && this.count > 0) return false;
    if (!force && this.locked) {
      if (this.ctx.time.now >= this.hintAt) {
        this.hintAt = this.ctx.time.now + 1.5;
        this.ctx.ui.toast(this.def.lockedHint, '#ff9966');
      }
      return false;
    }
    if (!force && this.ctx.time.now - this.lastAt < this.def.cooldown) return false;
    this.count++;
    this.lastAt = this.ctx.time.now;
    this.on = this.def.toggle ? !this.on : true;
    this.swingT = 0;
    this.system.activate(this.def.targets, this.on);
    if (this.def.toast) this.ctx.ui.toast(this.def.toast, this.hex(this.def.onColor));
    this.tint(1);
    return true;
  }

  update(dt: number): void {
    if (this.swingT < 0) return;
    this.swingT += dt;
    const k = Math.exp(-this.swingT * 3.2);
    if (this.swing) this.swing.rotation.x = 28 * Math.PI / 180 * k * Math.sin(this.swingT * 15);
    this.tint(k);
    if (k < 0.01) {
      this.swingT = -1;
      if (this.swing) this.swing.rotation.x = 0;
      this.tint(0);
    }
  }

  private tint(flash: number): void {
    const value = this.on || flash > 0.01 ? this.def.onColor : this.def.offColor;
    for (const mesh of this.lamps) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ('color' in material && material.color instanceof THREE.Color) material.color.setRGB(value[0], value[1], value[2], THREE.SRGBColorSpace);
        if (material instanceof THREE.MeshStandardMaterial) material.emissive.setRGB(value[0], value[1], value[2], THREE.SRGBColorSpace);
      }
    }
  }

  dispose(): void {
    this.disposeInteract?.();
    for (const material of this.owned) material.dispose();
  }
}

export class UnityActivatorSystem {
  private readonly items: Activator[] = [];
  private readonly byId = new Map<string, Activator>();

  constructor(private readonly ctx: GameContext, document: UnitySceneDocument, roots: ReadonlyMap<string, THREE.Object3D[]>, private readonly platforms: readonly UnityPlatformView[]) {
    for (const def of document.activators ?? []) {
      const item = new Activator(ctx, def, this, roots);
      this.items.push(item);
      this.byId.set(def.id, item);
    }
  }

  activate(targets: readonly string[], on: boolean): void {
    for (const id of targets) {
      for (const platform of this.platforms) if (platform.id === id) platform.activate(on);
      const chained = this.byId.get(id);
      if (chained && (!chained.on || !on)) chained?.activate(true);
    }
  }

  update(dt: number): void {
    for (const item of this.items) item.update(dt);
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.length = 0;
    this.byId.clear();
  }
}
