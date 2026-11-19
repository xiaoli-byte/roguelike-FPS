/**
 * 4-1 领主的死亡演出（Unity Bosses/Lords/LordCinema.cs；chuanzang-combat-v1.md 4.0「死亡演出」、docs/art/ch4-boss-intros.json 每个领主第三段）：
 *   · show：绕倒下的领主转半圈（看点 = 倒下那一刻的身体中心，不跟着下沉的模型晃），开头 slowSeconds 秒 slowScale 倍慢放；cardAt 起名字卡「夔 · 平息」；
 *   · land：切到玩家身后的过肩机位（后 3.2 m、上 0.9 m、右 0.9 m，看着领主），之后平滑推进玩家眼睛（零误差交还）。
 * 网页做法：镜头表写成一份 BossIntroScript（LordIntros.buildLordDeathScript），交给登场演出导演（intro/BossIntroDirector）播——
 * 接管输入 / HUD / 黑边 / 跳过 / 零误差落回都是同一套。导演看到的「首领」是个替身：倒下那一刻的位置与身体中心（不再动）、
 * 名字卡写 cardTitle / cardSub。deathTick 由首领自己在倒下后的 update 里驱动。
 * 与 Unity 的差异：跳过沿用登场演出的规则（第一次看先看满 1.5 s，Unity 死亡演出随时能跳）。
 */
import * as THREE from 'three';
import type { GameContext } from '../../../core/types';
import { BossIntroDirector, introEnabled, type DirectedBoss } from '../intro/BossIntroDirector';
import type { LordDeathSpec } from './LordDef';
import { buildLordDeathScript } from './LordIntros';

interface LordLike {
  readonly position: THREE.Vector3;
  readonly height: number;
  readonly model: THREE.Object3D;
  readonly ldef: { id: string; name: string; death: LordDeathSpec };
  getBodyCenter(out: THREE.Vector3): THREE.Vector3;
  getHeadCenter(out: THREE.Vector3): THREE.Vector3;
}

/** 首领替身：倒下那一刻的位置 / 身体中心（之后不动），名字卡写死亡演出的标题 */
class FallenLord implements DirectedBoss {
  readonly alive = true;
  readonly position: THREE.Vector3;
  readonly height: number;
  readonly model: THREE.Object3D;
  readonly introOffset = new THREE.Vector3();
  private readonly body: THREE.Vector3;
  private readonly head: THREE.Vector3;

  constructor(boss: LordLike, readonly name: string, readonly title: string | null) {
    this.position = boss.position.clone();
    this.height = boss.height;
    this.model = boss.model;
    this.body = boss.getBodyCenter(new THREE.Vector3());
    this.head = boss.getHeadCenter(new THREE.Vector3());
  }

  getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.body);
  }

  getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.head);
  }

  introOverlay(): void {}
}

/** 开一段死亡演出（?intro=0、玩家死了时不放：首领的 deathTick 照常跑） */
export function playLordDeath(ctx: GameContext, boss: LordLike): BossIntroDirector | null {
  if (!introEnabled() || !ctx.player.alive) return null;
  const spec = boss.ldef.death;
  const fallen = new FallenLord(boss, spec.cardTitle || boss.ldef.name, spec.cardSub || null);
  const center = fallen.getBodyCenter(new THREE.Vector3());
  const script = buildLordDeathScript(boss.ldef.id, spec, () => center.clone());
  if (script.validate().length > 0) return null;
  try {
    return new BossIntroDirector(ctx, script, fallen, fallen.position.clone());
  } catch (err) {
    console.error('[Lord] 死亡演出没放起来', err);
    return null;
  }
}
