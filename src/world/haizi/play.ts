/**
 * 4-4 神山海子 · 终局首领战（docs/level-design/chuanzang-combat-v1.md 4.5）：雷泽雷神。
 * 共用的枪、技能、秘卷、元素、演出、HUD 在 plateau/play/session.ts；这里只写这张图的东西：
 * - 导雷石柱：落雷 5 m 内劈石柱、给柱子充电（两道充满）；满电时打柱顶雷晶，一道雷劈向雷神的神面（600 + 破防）；
 * - 二阶段起湖水通电：站在浅水里每 0.5 秒挨 4 点电；
 * - 打败雷神：湖心岛的灵火点亮，第四章通关。
 * 入口：/plateau-lab.html?map=4-4&play
 */
import * as THREE from 'three';
import { FIRE_STATE } from '../plateau/landmarks';
import type { Boss } from '../plateau/play/boss';
import type { HitSphere, Target, Conductor, KnockBack } from '../plateau/play/core';
import { PlaySession, type PlayInput } from '../plateau/play/session';
import type { CollisionWorld, Walker } from '../plateau/walker';
import type { Weather } from '../plateau/weather';
import { loadPlateauModels } from '../plateau/play/assets';
import { LeizeBoss } from './leize';
import type { HaiziScene, Pillar } from './scene';
import { SPAWN } from './spec';
import type { HaiziTerrain } from './terrain';

/** 柱顶雷晶：子弹打得到 */
class CrystalTarget implements Target {
  alive = true;
  readonly label: string;
  private readonly list: HitSphere[];
  constructor(readonly pillar: Pillar, private readonly onHit: (p: Pillar) => void) {
    this.label = `${pillar.name}雷晶`;
    this.list = [{ c: pillar.top, r: 0.8, mult: 1 }];
  }
  spheres(): readonly HitSphere[] { return this.list; }
  hit(): number { this.onHit(this.pillar); return 0; }
}

export class LeizePlay extends PlaySession {
  /** 模型加载完（start）才建 */
  leize!: LeizeBoss;
  private soak = 0;

  constructor(
    scene: THREE.Scene, camera: THREE.PerspectiveCamera, readonly haizi: HaiziTerrain, world: CollisionWorld, walker: Walker, weather: Weather,
    readonly arena: HaiziScene, bound: (x: number, z: number) => number,
  ) {
    super(scene, camera, haizi, world, walker, weather, arena.conductors, bound);
    this.checkpoint.set(SPAWN.x, 0, SPAWN.z);
    for (const p of arena.pillars) this.props.push(new CrystalTarget(p, q => this.discharge(q)));
    weather.onStrike = (at, c) => this.strikeEffects(at, c ? this.conductors.find(k => k.pos === c) ?? null : null, 3, 12, '雷暴');
  }

  async start(): Promise<void> {
    this.hud.loading('正在加载雷泽雷神…');
    await loadPlateauModels((d, n) => this.hud.loading(`正在加载雷泽雷神… ${d}/${n}`), ['SK_Boss_Leize']);
    this.hud.loading('');
    this.leize = new LeizeBoss(this, this.haizi, this.world, this.arena.lake, this.arena.pillars);
    this.bosses.push(this.leize);
    this.setup();
    this.respawn(true);
    this.ready = true;
    this.say('神山海子：走到湖边，雷泽雷神会从湖心的漩涡里升起', 5);
  }

  /** 脚下的地面（湖岸、拱起的身段） */
  groundAt(x: number, z: number): number { return Math.max(this.world.groundAt(x, z, 60), this.haizi.waterLevelAt(x, z)); }

  knockFrom(x: number, z: number, k: number, up = 0): KnockBack {
    const dx = this.feet.x - x, dz = this.feet.z - z, d = Math.max(0.5, Math.hypot(dx, dz));
    return { x: dx / d * k, z: dz / d * k, up };
  }

  /** 打柱顶雷晶：满电才劈得出去 */
  private discharge(p: Pillar): void {
    if (p.charge < 0.999) {
      if (!this.mem.crystalHint || this.time - this.mem.crystalHint > 3) { this.mem.crystalHint = this.time; this.say(`${p.name}只充了 ${Math.round(p.charge * 100)}%——站在它旁边，让雷劈它充电`, 2.2); }
      return;
    }
    p.setCharge(0);
    if (this.leize.active && !this.leize.defeated && !this.leize.inShow) this.leize.struckByPillar(p);
  }

  protected override onStrike(_at: THREE.Vector3, cond: Conductor | null): void {
    if (!cond) return;
    const p = this.arena.pillars.find(q => q.top === cond.pos);
    if (!p) return;
    p.setCharge(Math.min(1, p.charge + 0.5));
    if (p.charge >= 0.999) this.say(`${p.name}充满了——打柱顶的雷晶，把雷劈回雷神的神面！`, 3);
  }

  protected tick(dt: number, _input: PlayInput, _locked: boolean): void {
    // 二阶段起湖水通电：站在浅水里挨电
    const L = this.leize;
    if (L.active && !L.defeated && L.phase >= 2 && !L.inShow) {
      const F = this.feet;
      const inWater = this.haizi.waterDepthAt(F.x, F.z) > 0.05 && F.y < this.haizi.waterLevelAt(F.x, F.z) + 0.15;
      this.soak -= dt;
      if (inWater && this.soak <= 0) { this.soak = 0.5; this.hurt(4, '通电的湖水', undefined, 'shock'); }
    }
    if (!this.won && L.defeated && !L.inShow) this.victory();
  }

  protected onLordDown(_b: Boss): void {
    const P = this.player;
    P.hp = P.maxHp; P.shield = P.maxShield;
    FIRE_STATE.mask = undefined;
    FIRE_STATE.lit = 1;
    this.say('雷泽平息——湖心岛的灵火点亮了', 5);
  }

  protected respawn(first: boolean): void {
    this.resetCommon();
    this.walker.fly = false;
    this.walker.place(this.checkpoint.x, this.checkpoint.z);
    this.walker.lookAt(new THREE.Vector3(0, 6, -16));
    if (!first) this.hud.center('', '');
    for (const p of this.arena.pillars) p.setCharge(0);
  }

  protected objective(): string {
    if (this.won) return '';
    if (!this.leize.active && !this.leize.defeated) return '走到湖边：雷泽雷神在湖心的漩涡下面';
    return '打败雷泽雷神 · 拍腹前摇打腹鼓 · 低头时打神面 · 导雷石柱充满后打雷晶';
  }

  private victory(): void {
    this.won = true;
    const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
    this.hud.victory('第四章 · 雪域天路 通关', [
      `雷泽雷神 · 归于雷泽 —— 用时 ${m} 分 ${String(s).padStart(2, '0')} 秒 · 倒下 ${this.deaths} 次`,
      `秘卷：${this.kit.list().join('、') || '无'}`,
    ]);
  }
}
