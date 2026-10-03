/**
 * 寒霜冰晶：霜翼妖后召唤的可击毁小怪。不移动、不攻击；存活时通过冰链为妖后回复护盾（回复逻辑在 Matriarch）。
 * 每个冰晶的可输送能量有限（charge，由 Matriarch 召唤时设置）：耗尽后冰链熄灭、不再回盾，但仍可击碎。
 * 妖后陨落时随之崩解。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { EnemyBase } from '../EnemyBase';
import { BeamMesh } from './Visuals';
import { geo, glow, glowMesh, mesh, pivot, std } from './parts';

export const CRYSTAL_DEF: EnemyDef = {
  id: 'boss_ice_crystal',
  name: '寒霜冰晶',
  hp: 180,
  speed: 0,
  radius: 0.7,
  height: 2.6,
  damage: 0,
  coins: [1, 3],
  essence: 0,
  headY: 2.25,
  headRadius: 0.4,
  knockbackResist: 1,
  color: 0x9fe8ff,
};

const LINK = 0x7fe0ff;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class IceCrystal extends EnemyBase {
  /** 被供能的 Boss（由 Matriarch 在召唤后设置） */
  owner: EnemyBase | null = null;
  /** 剩余可输送的护盾量（由 Matriarch 在召唤后设置）；≤ 0 时冰链熄灭 */
  charge = 0;
  private link: BeamMesh | null = null;
  private spinner: THREE.Group | null = null;
  private halo: THREE.Mesh | null = null;
  private pulseAcc = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, CRYSTAL_DEF, opts);
    this.spawnDuration = 0.9;
    this.deathDuration = 0.45;
  }

  protected override buildModel(): THREE.Object3D {
    const ice = std(0xbfefff, { emissive: 0x2f8fd8, ei: 0.6, rough: 0.2, metal: 0.1, opacity: 0.85 });
    const iceDark = std(0x7fb8d8, { emissive: 0x1a5a90, ei: 0.4, rough: 0.4 });
    const root = new THREE.Group();
    const base = mesh(root, geo.dodeca(0.45), iceDark, 0, 0.12, 0);
    base.scale.set(1.5, 0.5, 1.5);
    const spinner = pivot(root, 0, 0, 0);
    mesh(spinner, geo.cyl(0.28, 0.36, 1.6, 6), ice, 0, 1.0, 0);
    mesh(spinner, geo.cone(0.28, 0.7, 6), ice, 0, 2.15, 0);
    for (let i = 0; i < 3; i++) {
      const g = pivot(spinner, 0, 0.2, 0);
      g.rotation.y = (i / 3) * Math.PI * 2 + 0.4;
      const c = pivot(g, 0, 0, 0.38);
      c.rotation.x = 0.42;
      mesh(c, geo.cyl(0.14, 0.19, 0.9, 6), ice, 0, 0.45, 0);
      mesh(c, geo.cone(0.14, 0.35, 6), ice, 0, 1.07, 0);
    }
    glowMesh(spinner, geo.octa(0.2), glow(0xd8fbff), 0, 1.25, 0, 'core');
    this.halo = glowMesh(spinner, geo.sphere(0.65, 10, 8), glow(0x5ad0ff, 0.3, true), 0, 1.3, 0, 'halo');
    this.spinner = spinner;
    return root;
  }

  override init(): void {
    super.init();
    this.model.traverse((o) => {
      if (o.userData.glow) o.castShadow = false;
    });
    this.link = BeamMesh.acquire(this.ctx.stageGroup, LINK, 0xe8fdff);
    this.link.visible = false;
    this.ctx.fx.ring(new THREE.Vector3(this.position.x, this.position.y + 0.1, this.position.z), 3, LINK, 0.6);
  }

  override update(dt: number): void {
    super.update(dt);
    this.updateLink(dt);
  }

  protected override think(_dt: number): void {
    this.stopMoving();
  }

  protected override animate(dt: number): void {
    if (this.spinner) this.spinner.rotation.y += dt * 0.6;
    if (this.halo) this.halo.scale.setScalar(1 + 0.12 * Math.sin(this.age * 5));
  }

  private updateLink(dt: number): void {
    const link = this.link;
    if (!link) return;
    const o = this.owner;
    if (!this.alive || !o || !o.alive || this.age < this.spawnDuration || this.charge <= 0) {
      link.visible = false;
      if (this.halo && this.charge <= 0) this.halo.visible = false;
      return;
    }
    _a.set(this.position.x, this.position.y + 1.3, this.position.z);
    o.getBodyCenter(_b);
    link.set(_a, _b, 0.07);
    link.setOpacity(0.55);
    link.flicker(0.6 + 0.4 * Math.sin(this.age * 23 + this.id));
    this.pulseAcc += dt;
    if (this.pulseAcc >= 0.45) {
      this.pulseAcc = 0;
      this.ctx.fx.burst(_b, LINK, 3, 1.5, 0.4, 0.25, 0);
    }
  }

  protected override onDeath(_result: DamageResult): void {
    if (this.link) this.link.visible = false;
    this.getBodyCenter(_a);
    this.ctx.fx.burst(_a, 0xd8f6ff, 26, 8, 0.9, 0.35, 16);
    this.ctx.fx.burst(_a, LINK, 10, 4, 0.6, 0.3, 2);
    this.ctx.audio.play('shield_break', { position: this.position, pitch: 1.3, volume: 0.8 });
  }

  protected override animateDeath(t: number): void {
    const s = 1 + t * 0.35;
    this.model.scale.set(s, Math.max(0.01, 1 - t), s);
  }

  protected override onDispose(): void {
    this.link?.release();
    this.link = null;
  }
}
