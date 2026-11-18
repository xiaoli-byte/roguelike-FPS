/**
 * 机关之间共享的东西（MechanismSystem 建好后交给每个机关）：上下文、场景件、熔岩、安全落脚点、闪屏、预警、据点状态。
 */
import type * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import type { UnitySceneDocument } from '../UnityLevelLibrary';
import type { LavaField, LavaVolumeRuntime } from './Lava';
import type { SceneParts, ScreenFlash } from './Parts';
import type { SafeGround } from './SafeGround';
import type { Telegraphs } from './Telegraph';

export type SitePhase = 'undiscovered' | 'active' | 'cleared';

/** 一件能被打碎 / 触发的场景件（Unity IActivatable：Destructible、BreakableSpan、ForgeWellDirector…） */
export interface Activatable {
  readonly scenePath: string;
  onActivated(on: boolean): void;
}

export interface MechanismHost {
  readonly ctx: GameContext;
  readonly document: UnitySceneDocument;
  readonly parts: SceneParts;
  /** 运行时建的东西挂这里（卸载时整组拿掉） */
  readonly group: THREE.Group;
  readonly lava: LavaField;
  readonly safe: SafeGround;
  readonly flash: ScreenFlash;
  readonly tele: Telegraphs;
  /** 第三章（危险色用品红） */
  readonly inferno: boolean;
  /** 本局难度（Unity RunState.difficulty；没有时 1） */
  difficulty(): number;
  /** 据点（EncounterSite.title）此刻的阶段；没有这个据点返回 null */
  site(title: string | null | undefined): SitePhase | null;
  /** 此刻正在交战的据点 title */
  activeSite(): string | null;
  volume(scenePath: string | null | undefined): LavaVolumeRuntime | null;
  activatable(scenePath: string | null | undefined): Activatable | null;
  /** 首领（按 def.id）此刻在场的那只 */
  boss(id: string): IEnemy | null;
}
