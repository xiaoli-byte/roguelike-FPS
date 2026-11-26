/**
 * 地图机关数据：每张图的 level.json 里的 mechanisms 段（public/assets/levels/<id>/level.json；2026-11-26 由 Unity 导出的 mechanisms.json 一次性转来）。
 * 坐标都是网页的（Unity x 取反）；yaw = −Unity eulerAngles.y（度）；scenePath 和场景文档里 renderers / colliders 的 scenePath 一一对上。
 */
import type { LavaShape, LavaTide } from './LavaCore';

type V3 = [number, number, number];
type Q = [number, number, number, number];
type RGBA = [number, number, number, number];

/** 每个条目都带的：物体路径与世界变换 */
export interface MechanismBase {
  scenePath: string;
  position: V3;
  rotation: Q;
  scale: V3;
  yaw: number;
  /** 网页的世界矩阵（列主序，16 个） */
  matrix: number[];
}

/** 被引用的 Transform：路径 + 世界变换 */
export interface MechanismRef {
  scenePath: string;
  position: V3;
  rotation: Q;
  yaw: number;
  scale: V3;
}

export interface LavaVolumeData extends MechanismBase {
  shape: LavaShape;
  size: [number, number];
  depth: number;
  tide: LavaTide;
  surface: string | null;
  flow: [number, number];
  depthShore: boolean;
}

export interface LavaGeyserData extends MechanismBase {
  period: number; phase: number; warnTime: number; eruptTime: number; startActive: boolean; activeSite: string | null;
  radius: number; height: number; column: MechanismRef | null; cracks: string[]; crackColor: RGBA;
  playerDamage: number; playerLaunch: number; enemyDamage: number; enemyLaunch: number; enemyPush: number;
  shell: string | null; shellHp: number; detonateWarn: number; hideShellOnBurst: boolean;
}

export interface LavaSluiceData extends MechanismBase {
  trigger: 'hook' | 'lever' | 'both'; hook: string | null; lever: MechanismRef | null; title: string;
  path: V3[]; width: number; floodRise: number; restDrop: number; segmentLength: number; frontSpeed: number;
  warn: number; duration: number; riseTime: number; fallTime: number; cooldown: number; uses: number;
  ladle: MechanismRef | null; tiltAxis: V3; tiltAngle: number; tiltSeconds: number; pour: string | null;
}

export interface QuicksandData extends MechanismBase {
  radius: number; coreRadius: number; pullEdge: number; pullCore: number; slowEdge: number; slowCore: number;
  sinkTime: number; burst: number; above: number; below: number; surface: boolean;
}

export interface SurfaceProfile { id: string; title: string; accel: number; friction: number; enemyAccel: number; stumble: number }
export interface ZoneArea { shape: 'box' | 'disc'; radius: number; above: number; below: number }

export interface SurfaceZoneData extends MechanismBase {
  profile: SurfaceProfile; area: ZoneArea; lifetime: number; fadeTime: number;
}

export interface SafeZoneData extends MechanismBase { radius: number; height: number; pushMargin: number; carveNavMesh: boolean }
export interface SupplyCampData extends MechanismBase { label: string; safeRadius: number; openShop: boolean; restoreOnArrive: boolean }

export type BreakKind = 'wood' | 'clay' | 'stone' | 'ice' | 'metal';

export interface DestructibleData extends MechanismBase {
  kind: BreakKind; baseHp: number; scaleWithDifficulty: boolean; accepts: number; weakTo: number; weakMult: number;
  displayName: string; blocksSight: boolean; intact: string | null; rubble: string | null; size: number; coins: [number, number];
  ammoChance: number; healthChance: number; blastRadius: number; blastDamage: number; blastPlayerDamage: number; targets: string[];
}

export interface BreakableSpanData extends MechanismBase {
  segments: MechanismRef[]; segmentSize: [number, number]; segmentThickness: number; triggers: number; stepDelay: number;
  stepByEnemies: boolean; warnTime: number; chainDelay: number; baseHp: number; signalOrigin: number; fallLimit: number;
  kind: BreakKind; displayName: string;
}

export interface ConductorData extends MechanismBase {
  height: number; attractRadius: number; canCharge: boolean; chargePerStrike: number; drainPerSecond: number;
  chargedAt: number; splashRadius: number; splashDamage: number;
}

export interface LoreNoteData extends MechanismBase {
  title: string; place: string; lines: string[]; bannerTitle: string; bannerSub: string; afterLines: string[]; radius: number;
}

export interface IcicleData extends MechanismBase {
  hanging: MechanismRef | null; fallen: string | null; groundY: number; tipDepth: number; baseHp: number;
  dropDamage: number; radius: number; playerDamage: number;
}

export interface ObjectiveData { title: string; required: string[]; optional: string[]; altarsNeeded: number }
export interface BossRefData { bossId: string; scenePath: string | null; stronghold: boolean }

export interface FoundryChannelsData extends MechanismBase { surge: string[]; rise: number; warn: number; riseTime: number; fallTime: number }

export interface LordGateData extends MechanismBase {
  objective: ObjectiveData | null; encounter: BossRefData | null; clearChestPoint: V3 | null; lockedHint: string;
  wakeTitle: string; wakeSub: string; wakeObjective: string; clearChest: boolean;
}

export interface FireGodThroneData extends MechanismBase { fallRoot: MechanismRef | null; fallRenderers: string[]; channels: string | null }

export interface WindGateData extends MechanismBase {
  firstVisit: string | null; secondVisit: string | null; bellows: MechanismRef[]; bellowsRest: number; bellowsLow: number;
  bellowsHigh: number; pumpPeriod: number; lever: MechanismRef | null; furnaceMouth: V3 | null; lightLow: number; lightHigh: number;
  tides: string[]; laneFrom: V3[]; laneTo: V3[]; jetEvery: number; jetWarn: number; jetRadius: number; jetDuration: number;
  jetTick: number; jetTickInterval: number; jetSpots: number; jetRange: number;
}

export interface ForgeWellData extends MechanismBase {
  deckSite: string | null; forgeSite: string | null; objective: ObjectiveData | null; northBridge: string | null; collapseFrom: number;
  bridgeMid: V3; bridgeMidRadius: number; forgeBelly: V3 | null; hook: MechanismRef | null; hookUp: V3; hookDown: V3; hookTime: number;
  hookLamps: string[]; gate: MechanismRef | null; gateGlow: string[]; gateWarn: number; gateHalf: number; gateFull: number;
  gateSpeed: number; gateDirection: number; geysers: string[];
}

export interface ZheduoData extends MechanismBase {
  roamerRoute: V3[]; roamerLair: V3 | null; roamerDelay: number; roamerId: string;
  burrows: { site: string | null; holes: V3[] }[];
  strongholds: { encounter: BossRefData | null; center: V3 | null; radius: number; minY: number; maxY: number }[];
}

export interface WeatherRegionData {
  name: string; center: V3; radius: number; fade: number; profile: string; from: [number, number];
  calm: number; warn: number; storm: number; abate: number; firstDelay: number; armRadius: number; loop: boolean;
}

export interface WeatherData extends MechanismBase {
  baseFogColor: RGBA; baseFogStart: number; baseFogEnd: number; theme: string; whiteoutProfile: string;
  /** 盛行风（XZ，网页坐标） */
  windDir: [number, number]; baseWind: number; regions: WeatherRegionData[];
}

export interface SoftBoundaryTuning {
  softStart: number; windRamp: number; pushBase: number; pushGain: number; hazeLead: number; failsafe: number;
  navInset: number; tetherSlack: number; tetherGrace: number;
}

export interface BoundaryData {
  /** url = 距离场文件（assets/levels/<id>/boundary.f32）；asset / sha1 是 Unity 导出时的来源字段，levels 目录的数据不带 */
  scenePath: string; asset?: string; url: string; width: number; height: number; sha1?: string;
  /** 距离场原点 / 格距：Unity 坐标（网页按 −x 采样） */
  origin: [number, number]; cell: number; theme: string; tuning: SoftBoundaryTuning;
}

export interface SceneMechanisms {
  /** 来源字段（Unity 场景路径 / 导出来源 / 场景 sha1）：levels 目录的数据不带，第一章重做版自己编的还写着 */
  scene?: string;
  source?: string;
  sceneSha1?: string;
  weather: WeatherData | null;
  boundary: BoundaryData | null;
  lava?: LavaVolumeData[];
  geysers?: LavaGeyserData[];
  sluices?: LavaSluiceData[];
  quicksand?: QuicksandData[];
  surfaces?: SurfaceZoneData[];
  safeZones?: SafeZoneData[];
  camps?: SupplyCampData[];
  destructibles?: DestructibleData[];
  spans?: BreakableSpanData[];
  conductors?: ConductorData[];
  lore?: LoreNoteData[];
  icicles?: IcicleData[];
  foundryChannels?: FoundryChannelsData[];
  lordGates?: LordGateData[];
  fireGodThrones?: FireGodThroneData[];
  windGates?: WindGateData[];
  forgeWells?: ForgeWellData[];
  zheduo?: ZheduoData[];
}

export interface MechanismsDocument {
  schema: number;
  generator: string;
  scenes: Record<string, SceneMechanisms>;
}

const BASE = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : '/';
const fields = new Map<string, Promise<Float32Array | null>>();

/**
 * @deprecated 2026-11-26 起机关数据在每张图的 level.json 里（UnitySceneDocument.mechanisms），不再有整份的 mechanisms.json：
 * 一律返回 null（调用方按「读不到」兜底）。只因第一章会话未入库的 terrainSculpt 还 import 它而保留同名导出，P5 去掉。
 */
export function loadMechanisms(): Promise<MechanismsDocument | null> {
  return Promise.resolve(null);
}

/** 运行时生成的距离场（第一章重做从白盒的可玩区算出来，没有文件）：先登记，loadBoundaryField 按同一个地址取 */
export function provideBoundaryField(url: string, field: Float32Array): void {
  fields.set(url, Promise.resolve(field));
}

/** 软边界距离场（float32，小端） */
export function loadBoundaryField(url: string): Promise<Float32Array | null> {
  let p = fields.get(url);
  if (!p) {
    p = fetch(`${BASE}${url}`).then(async r => r.ok ? new Float32Array(await r.arrayBuffer()) : null).catch(() => null);
    fields.set(url, p);
  }
  return p;
}
