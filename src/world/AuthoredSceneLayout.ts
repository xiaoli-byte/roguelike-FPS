/** Art assembly for the approved metre-scale plans. No collision or source mesh is generated here. */
import type { DecoFootprint, LevelLayout, P2, SceneArchitecturePlacement } from './LevelTypes';
import type { WhiteboxRect } from './WhiteboxTypes';

export interface AuthoredBoundary {
  id: string;
  a: P2;
  b: P2;
  /** Unit normal from the playable floor into the blocked mass. */
  outward: P2;
  length: number;
}
export interface AuthoredScenePlacement extends SceneArchitecturePlacement {
  role: 'boundary' | 'corner' | 'cover' | 'landmark' | 'accent' | 'vista';
  roomId?: string;
  label?: string;
  boundaryId?: string;
  story?: { id: string; beat: 'entry' | 'junction' | 'supply' | 'focal'; observer: P2; focusHeight: number };
}
export interface AuthoredInspectionView extends P2 { id: string; label: string; yaw: number; targetY?: number; pitch?: number }
/** A tightly framed art bay may substitute real meshes for its old wall's raycast only. */
export interface AuthoredArtRayWindow {
  id: string;
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  /** Required subjects. Renderer activates this window only when their sources are ready. */
  placementIndices: number[];
}
export interface AuthoredDeckPlacement extends SceneArchitecturePlacement {
  assetId: 'SM_Env_TravelDeck';
  passageId: string;
  segmentIndex: number;
  /** Uniform scale of the measured source, separate from the envelope's s=1 fitting. */
  sourceScale: number;
  /** Local wood surface height; the higher rivets are deliberately not used as the floor datum. */
  surfaceY: number;
}
export interface AuthoredSceneLayout {
  planId: string;
  title: string;
  identity: string;
  architecture: AuthoredScenePlacement[];
  placements: AuthoredScenePlacement[];
  boundaries: AuthoredBoundary[];
  landmarks: AuthoredScenePlacement[];
  /** Independent ground-overlay instances; never passed through wall/cover clearance rules. */
  decks: AuthoredDeckPlacement[];
  /** Exact rotated footprints, available if a later material pass needs a ground overlay mask. */
  deckFloorMasks: { passageId: string; polygon: P2[] }[];
  inspectionViews: AuthoredInspectionView[];
  rayWindows: AuthoredArtRayWindow[];
}

export const AUTHORED_DECK_SIZE = { width: 5.516021, height: .734755, depth: 3.881925, surfaceY: .610 } as const;
const DECK_PASSAGES: Record<string, readonly string[]> = {
  // The four east-west lake piers; the two shore roads and the eastern working paths remain stone/ice.
  'frost-3': ['f3-c', 'f3-d', 'f3-g', 'f3-h'],
  // Both physical crossings; west-bank, east-bank and north-flank remain ordinary bank paths.
  'inferno-3': ['middle-bridge', 'north-bridge'],
};

export function authoredDeckFootprint(p: AuthoredDeckPlacement): P2[] {
  return authoredPlacementFootprint(p);
}
export function authoredPlacementFootprint(p: SceneArchitecturePlacement): P2[] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), w = p.envelope.width * p.s / 2, d = p.envelope.depth * p.s / 2;
  return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => ({ x: p.x + c * x + s * z, z: p.z - s * x + c * z }));
}
function polygonArea(polygon: readonly P2[]): number {
  return Math.abs(polygon.reduce((sum, p, index) => {
    const q = polygon[(index + 1) % polygon.length]; return sum + p.x * q.z - q.x * p.z;
  }, 0)) / 2;
}
/** Exact rectangle/rotated-polygon intersection handles diagonal piers without AABB over-rejection. */
function clippedArea(polygon: readonly P2[], rect: WhiteboxRect): number {
  let points = [...polygon];
  for (const [axis, value, sign] of [['x', rect.minX, 1], ['x', rect.maxX, -1], ['z', rect.minZ, 1], ['z', rect.maxZ, -1]] as const) {
    const output: P2[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const insideA = (a[axis] - value) * sign >= -1e-9, insideB = (b[axis] - value) * sign >= -1e-9;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        output.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    points = output;
    if (points.length < 3) return 0;
  }
  return polygonArea(points);
}
export function authoredDeckInsideFloor(L: LevelLayout, placement: AuthoredDeckPlacement): boolean {
  const polygon = authoredDeckFootprint(placement), area = polygonArea(polygon);
  return (L.whitebox?.floorRects.reduce((sum, rect) => sum + clippedArea(polygon, rect), 0) ?? 0) >= area - 1e-6;
}
export function authoredPlacementOutsideFloor(L: LevelLayout, placement: SceneArchitecturePlacement): boolean {
  const polygon = authoredPlacementFootprint(placement);
  return L.whitebox?.floorRects.every(rect => clippedArea(polygon, rect) < 1e-7) ?? false;
}
export function authoredPlacementIntersectsRect(placement: SceneArchitecturePlacement, rect: WhiteboxRect): boolean {
  return clippedArea(authoredPlacementFootprint(placement), rect) > 1e-7;
}

export function buildAuthoredDecks(L: LevelLayout): AuthoredDeckPlacement[] {
  if (!L.whitebox) return [];
  const plan = L.whitebox.plan, selected = DECK_PASSAGES[plan.id] ?? [], result: AuthoredDeckPlacement[] = [];
  for (const passageId of selected) {
    const passage = plan.passages.find(path => path.id === passageId);
    if (!passage) throw new Error(`${plan.id}: missing bridge passage ${passageId}`);
    let accepted: AuthoredDeckPlacement[] | null = null;
    // Uniform scale for each complete crossing. Turn clearance controls its width, never stretch/crop the source mesh.
    for (const fit of [1, .95, .9, .85, .8, .75, .7]) {
      const sourceScale = (passage.width - .45) / AUTHORED_DECK_SIZE.width * fit;
      const env = { width: AUTHORED_DECK_SIZE.width * sourceScale, depth: AUTHORED_DECK_SIZE.depth * sourceScale, height: AUTHORED_DECK_SIZE.height * sourceScale };
      const candidate: AuthoredDeckPlacement[] = [];
      for (let index = 1; index < passage.points.length; index++) {
        const a = passage.points[index - 1], b = passage.points[index], dx = b[0] - a[0], dz = b[1] - a[1];
        const length = Math.hypot(dx, dz), count = Math.ceil(length / (env.depth * .88));
        for (let i = 0; i < count; i++) {
          const t = (i + .5) / count;
          candidate.push({ assetId: 'SM_Env_TravelDeck', x: a[0] + dx * t - plan.bounds[0] / 2, z: a[1] + dz * t - plan.bounds[1] / 2,
            y: L.floorY + .01 - AUTHORED_DECK_SIZE.surfaceY * sourceScale, yaw: Math.atan2(dx, dz), s: 1, envelope: env,
            type: 'wall', court: 'arrival', passageId, segmentIndex: index - 1, sourceScale, surfaceY: AUTHORED_DECK_SIZE.surfaceY });
        }
      }
      if (candidate.every(p => authoredDeckInsideFloor(L, p))) { accepted = candidate; break; }
    }
    if (!accepted) throw new Error(`${plan.id}/${passageId}: deck cannot fit the approved crossing`);
    result.push(...accepted);
  }
  return result;
}

type Direction = 'north' | 'east' | 'south' | 'west';
type Feature = { room: string; side: Direction; kind: 'gate' | 'landmark' | 'cliff' | 'nature'; height: number; label: string };
interface ArtDirection { identity: string; naturalRooms: string[]; features: Feature[] }

/** Each composition follows the reviewed geography, rather than rotating a shared court. */
export const AUTHORED_ART_DIRECTION: Record<string, ArtDirection> = {
  'desert-1': { identity: '风蚀峡口：岩脊遮住折返，东北石门露出天际线。', naturalRooms: ['entry', 'throat', 'basin', 'ridge'], features: [
    { room: 'throat', side: 'north', kind: 'cliff', height: 11, label: '折返高岩脊' }, { room: 'exit', side: 'north', kind: 'gate', height: 12, label: '东北石门' }, { room: 'ridge', side: 'west', kind: 'landmark', height: 7, label: '脊后遗龛' }] },
  'desert-2': { identity: '土墙驿街：前货棚绞盘接向井院沿街布棚，北库门楼高于卸货湾，街巷转角区分货运和售卖。', naturalRooms: ['supply'], features: [
    { room: 'cargo', side: 'south', kind: 'landmark', height: 6, label: '货棚残墙' }, { room: 'north', side: 'north', kind: 'gate', height: 11, label: '北库门楼' }, { room: 'gate', side: 'east', kind: 'landmark', height: 9, label: '驿站侧楼' }] },
  'desert-3': { identity: '沉沙城防：北城楼最高，残屋夹院藏着低矮旧货摊与储粮瓮，东西城墙形成连续折转。', naturalRooms: ['entry'], features: [
    { room: 'north', side: 'north', kind: 'gate', height: 15, label: '北城楼' }, { room: 'inner', side: 'north', kind: 'landmark', height: 6, label: '城内残屋' }, { room: 'east', side: 'east', kind: 'cliff', height: 12, label: '掩埋东城岩台' }] },
  'desert-4': { identity: '错门寺城：五庭逐级抬升天际线，正殿在北，西廊保持低矮。', naturalRooms: [], features: [
    { room: 'court1', side: 'south', kind: 'landmark', height: 7, label: '习武庭照壁' }, { room: 'court3', side: 'west', kind: 'gate', height: 9, label: '旗庭西仪门' }, { room: 'sanctum', side: 'north', kind: 'gate', height: 15, label: '北正殿山门' }, { room: 'cloister', side: 'west', kind: 'landmark', height: 6, label: '西僧廊' }] },
  'desert-5': { identity: '扇形仪场：北侧王门是唯一最高物，西高岩与东侧遗碑不对称。', naturalRooms: ['arena'], features: [
    { room: 'arena', side: 'north', kind: 'gate', height: 17, label: '沙王仪门' }, { room: 'arena', side: 'west', kind: 'cliff', height: 12, label: '半毁看台岩座' }, { room: 'exit', side: 'east', kind: 'landmark', height: 9, label: '离场遗碑' }] },
  'frost-1': { identity: '林间巡礼：西侧疏松雪林，东北祈雪堂穿过树冠成为目标。', naturalRooms: ['entry', 'patrol', 'pines'], features: [
    { room: 'pines', side: 'west', kind: 'nature', height: 12, label: '古雪松' }, { room: 'chapel', side: 'north', kind: 'landmark', height: 14, label: '祈雪堂' }, { room: 'entry', side: 'south', kind: 'cliff', height: 10, label: '入林岩阶' }] },
  'frost-2': { identity: '折冰长廊：三条长廊由南岗、东折冰壁和北中继站分段辨认。', naturalRooms: ['entry', 'east', 'west'], features: [
    { room: 'lower', side: 'south', kind: 'landmark', height: 10, label: '南段岗亭' }, { room: 'east', side: 'east', kind: 'cliff', height: 14, label: '折返点冰壁' }, { room: 'exit', side: 'north', kind: 'gate', height: 13, label: '北中继站' }] },
  'frost-3': { identity: '冻湖三栈：西岸仓场接入木栈道，中栈低护岸修船坞侧泊短船，卷扬机靠船首，北栈由检修门楼标记。', naturalRooms: ['lower-pier', 'middle-pier', 'upper-pier', 'supplies'], features: [
    { room: 'north', side: 'west', kind: 'landmark', height: 13, label: '岸侧绞盘院' }, { room: 'middle-pier', side: 'east', kind: 'cliff', height: 10, label: '冻结修船槽岸' }, { room: 'upper-pier', side: 'north', kind: 'gate', height: 11, label: '检修站门楼' }] },
  'frost-4': { identity: '雪埋禅院：外院围合，南庭疏松，中心内殿高过周边回廊。', naturalRooms: ['south'], features: [
    { room: 'entry', side: 'east', kind: 'gate', height: 12, label: '东北山门' }, { room: 'sanctum', side: 'north', kind: 'landmark', height: 15, label: '祈雪内殿' }, { room: 'south', side: 'south', kind: 'nature', height: 11, label: '避风庭老松' }] },
  'frost-5': { identity: '霜冠裂厅：北侧尖裂冰冠、西南残殿与东前厅高度不同。', naturalRooms: ['arena', 'north-bay'], features: [
    { room: 'north-bay', side: 'north', kind: 'cliff', height: 16, label: '霜冠裂峰' }, { room: 'south-bay', side: 'south', kind: 'landmark', height: 9, label: '西南残殿' }, { room: 'entry', side: 'east', kind: 'gate', height: 12, label: '东前厅门楼' }] },
  'inferno-1': { identity: '灰烬卸货场：卸货口渣车斜停在货运通道旁，低货坪转向东北高窑门，背风货栈构成中景。', naturalRooms: ['entry', 'yard'], features: [
    { room: 'store', side: 'west', kind: 'landmark', height: 9, label: '背风货栈' }, { room: 'altar', side: 'north', kind: 'gate', height: 14, label: '东北窑门' }, { room: 'yard', side: 'south', kind: 'cliff', height: 10, label: '卸货岩坡' }] },
  'inferno-2': { identity: '锯齿排炉街：西卸灰、北上料、南渣箱三舱体量不重复。', naturalRooms: ['ash', 'slag'], features: [
    { room: 'ash', side: 'west', kind: 'cliff', height: 10, label: '卸灰岩渣' }, { room: 'feed', side: 'north', kind: 'landmark', height: 13, label: '上料炉塔' }, { room: 'furnace', side: 'east', kind: 'gate', height: 15, label: '总炉出口' }] },
  'inferno-3': { identity: '断裂输渣线：西岸停运渣车与北岸检修绞盘区分作业区域，双岸岩壁夹出隔离带，北桥检修、南桥排渣分工。', naturalRooms: ['transfer', 'north-bank', 'receiver'], features: [
    { room: 'repair', side: 'north', kind: 'landmark', height: 11, label: '检修炉塔' }, { room: 'receiver', side: 'east', kind: 'cliff', height: 13, label: '接料岸岩壁' }, { room: 'sluice', side: 'south', kind: 'gate', height: 15, label: '出渣闸门' }] },
  'inferno-4': { identity: '三角铸炉围场：东模具场的余渣车朝着卸料工位，南散热场宽岩、西维修间低楼，三边用途不同。', naturalRooms: ['cooling', 'repair'], features: [
    { room: 'molds', side: 'east', kind: 'landmark', height: 13, label: '东铸模炉' }, { room: 'cooling', side: 'south', kind: 'cliff', height: 10, label: '散热岩脊' }, { room: 'control', side: 'north', kind: 'gate', height: 15, label: '总控门楼' }] },
  'inferno-5': { identity: '黑炉双腔：西冷灰低峰、东燃烧高炉、南侧卸压门形成不对称剪影。', naturalRooms: ['cold', 'cooling'], features: [
    { room: 'cold', side: 'west', kind: 'cliff', height: 11, label: '西冷炉岩冠' }, { room: 'hot', side: 'east', kind: 'landmark', height: 16, label: '东燃烧主炉' }, { room: 'exit', side: 'south', kind: 'gate', height: 12, label: '南卸压门' }] },
};

/** Measured proportions, used only as fitting envelopes; the renderer measures every actual LOD again. */
const KITS = {
  desert: { prefix: 'Desert', wall: [7.094620704650879, 4.259038349962793, 1.397688388824463], cliff: [15.153131484985352, 8.625554691068828, 6.246606111526489], gate: [10.912160873413086, 6.756574053142685, 1.4093958139419556], landmark: [4.815759658813477, 4.345164847094566, 1.632590413093567], nature: [3.3961299657821655, 2.8989577094325796, 2.5654640197753906], rock: 'SM_Env_DesertSandstone', landmarkId: 'SM_Env_DesertRuin', natureId: 'SM_Env_DesertSandstone' },
  frost: { prefix: 'Frost', wall: [7.6283440589904785, 4.289610447885934, 1.6203770637512207], cliff: [14.544893264770508, 8.580973275878932, 5.424958944320679], gate: [10.92976999282837, 6.634599492419511, 2.316908359527588], landmark: [4.204041481018066, 4.881163149679196, 3.309501051902771], nature: [2.692608118057251, 4.547362909419462, 2.192634105682373], rock: 'SM_Env_InfernoBasalt', landmarkId: 'SM_Env_FrostWayshrine', natureId: 'SM_Env_FrostPine' },
  inferno: { prefix: 'Inferno', wall: [8.54405689239502, 4.175696918595349, 1.8089215755462646], cliff: [14.603328704833984, 8.58099388005212, 8.181882381439209], gate: [10.966840744018555, 6.797794237238122, 1.3496425151824951], landmark: [3.82464337348938, 4.53801500517875, 3.2514331340789795], nature: [2.5826412439346313, 2.8579097812471446, 2.401129364967346], rock: 'SM_Env_InfernoBasalt', landmarkId: 'SM_Env_InfernoFoundry', natureId: 'SM_Env_InfernoBasalt' },
} as const;

const STORY_ROOMS: Record<string, readonly [string, string, string]> = {
  'desert-1': ['entry', 'throat', 'ridge'], 'desert-2': ['entry', 'cargo', 'supply'],
  'desert-3': ['entry', 'north', 'inner'], 'desert-4': ['entry', 'court3', 'cloister'], 'desert-5': ['entry', 'arena', 'exit'],
  'frost-1': ['entry', 'chapel', 'pines'], 'frost-2': ['entry', 'east', 'west'], 'frost-3': ['entry', 'middle', 'supplies'],
  'frost-4': ['entry', 'south', 'sanctum'], 'frost-5': ['entry', 'arena', 'south-bay'],
  'inferno-1': ['entry', 'kiln', 'store'], 'inferno-2': ['handoff', 'work', 'feed'], 'inferno-3': ['transfer', 'repair', 'receiver'],
  'inferno-4': ['strip', 'molds', 'repair'], 'inferno-5': ['entry', 'hot', 'cooling'],
};
const STORY_LABELS: Record<string, readonly [string, string, string]> = {
  'desert-1': ['沙口路祭', '折返引路碑', '脊后封藏龛'], 'desert-2': ['驿街镇碑', '货场装卸绞盘', '货栈储粮瓮'],
  'desert-3': ['入城镇碑', '守城祭坛', '残屋间旧货摊'], 'desert-4': ['寺门供坛', '旗庭仪碑', '僧廊供器'],
  'desert-5': ['王场迎祭碑', '仪场镇灵祭', '离场还愿台'],
  'frost-1': ['雪线行旅石', '祈雪堂路坛', '林间避风祭'], 'frost-2': ['冰廊界石', '东折供坛', '西岗祈雪龛'],
  'frost-3': ['卸货口路祭', '中岸工坊绞盘', '北岸补给龛'], 'frost-4': ['山门踏雪祭', '南庭祈雪坛', '内殿供器'],
  'frost-5': ['裂厅警戒石', '冰冠礼坛', '南湾暂歇龛'],
  'inferno-1': ['卸货口满载渣车', '主窑添料炉', '炉料储存区'], 'inferno-2': ['交接炉口', '工台侧熔器', '上料口旧炉'],
  'inferno-3': ['西岸停运渣车', '检修场吊运绞盘', '接料坪废炉'], 'inferno-4': ['脱模口熔器', '铸模余渣车', '修补场废炉'],
  'inferno-5': ['入炉警戒碑', '热池引火炉', '冷却侧熔器'],
};
const STORY_ASSETS = {
  desert: [
    { id: 'SM_Prop_DesertReliquary', dimensions: [1.5225342512130737, 2.4668116327375174, .5826185345649719] },
    { id: 'SM_Prop_DesertUrns', dimensions: [.8227123618125916, .8418817366473377, .794567346572876] },
  ],
  frost: [
    { id: 'SM_Prop_FrostPrayerCairn', dimensions: [1.0537017583847046, 1.9748221912741428, .7252599596977234] },
    { id: 'SM_Prop_FrostShrine', dimensions: [.9493070840835571, 1.9146205368815572, .9411364793777466] },
  ],
  inferno: [
    { id: 'SM_Prop_InfernoChainObelisk', dimensions: [1.082619309425354, 2.13026094387169, 1.079758644104004] },
    { id: 'SM_Prop_InfernoCrucible', dimensions: [1.2723237872123718, .9878747650654987, 1.2814818620681763] },
  ],
} as const;

const CARGO_HOIST = { id: 'SM_Env_CargoHoist', dimensions: [3.617898941040039, 3.4051780700683594, 2.541876792907715] } as const;
const MARKET_STALL = { id: 'SM_Env_MarketStall', dimensions: [3.5071096420, 3.0883384174, 2.6016705036] } as const;
const FROZEN_SKIFF = { id: 'SM_Env_FrozenSkiff', dimensions: [2.0340162516, 1.5428213894, 3.8537964821] } as const;
const SLAG_CART = { id: 'SM_Env_SlagCart', dimensions: [2.5219415426, 2.2148337997, 2.5224294662] } as const;
type StoryPiece = { asset: { id: string; dimensions: readonly number[] }; height: number; yawOffset?: number };

/** Conservative sight test against the complete oriented envelope, including vertical extent. */
export function authoredEnvelopeOccludes(observer: P2, target: P2 & { y: number }, p: AuthoredScenePlacement): boolean {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const ax = observer.x - p.x, az = observer.z - p.z, bx = target.x - p.x, bz = target.z - p.z;
  const a = [c * ax - s * az, 1.62 - p.y, s * ax + c * az];
  const b = [c * bx - s * bz, target.y - p.y, s * bx + c * bz];
  const mins = [-p.envelope.width * p.s / 2, 0, -p.envelope.depth * p.s / 2];
  const maxs = [-mins[0], p.envelope.height * p.s, -mins[2]];
  let near = 0, far = .985;
  for (let axis = 0; axis < 3; axis++) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) { if (a[axis] < mins[axis] || a[axis] > maxs[axis]) return false; continue; }
    const t0 = (mins[axis] - a[axis]) / delta, t1 = (maxs[axis] - a[axis]) / delta;
    near = Math.max(near, Math.min(t0, t1)); far = Math.min(far, Math.max(t0, t1));
    if (near > far) return false;
  }
  return far >= 0 && near < .985;
}

export function authoredPlacementRect(p: SceneArchitecturePlacement): WhiteboxRect {
  const c = Math.abs(Math.cos(p.yaw)), s = Math.abs(Math.sin(p.yaw));
  const hx = (p.envelope.width * c + p.envelope.depth * s) * p.s / 2;
  const hz = (p.envelope.width * s + p.envelope.depth * c) * p.s / 2;
  return { minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz };
}
const intersects = (a: WhiteboxRect, b: WhiteboxRect): boolean => a.minX < b.maxX - 1e-7 && a.maxX > b.minX + 1e-7 && a.minZ < b.maxZ - 1e-7 && a.maxZ > b.minZ + 1e-7;
const mid = (b: AuthoredBoundary): P2 => ({ x: (b.a.x + b.b.x) / 2, z: (b.a.z + b.b.z) / 2 });
function envelope(dimensions: readonly number[], height: number): DecoFootprint {
  return { width: dimensions[0] * height / dimensions[1], height, depth: dimensions[2] * height / dimensions[1] };
}

/** Extract only exposed edges of the actual floor union, not each merging rectangle's seams. */
export function authoredBoundaries(L: LevelLayout): AuthoredBoundary[] {
  const metadata = L.whitebox;
  if (!metadata) return [];
  const grid = metadata.gridSize, cols = Math.round((L.maxX - L.minX) / grid), rows = Math.round((L.maxZ - L.minZ) / grid);
  const floor = new Uint8Array(cols * rows);
  for (const r of metadata.floorRects) for (let z = Math.round((r.minZ - L.minZ) / grid); z < Math.round((r.maxZ - L.minZ) / grid); z++) {
    floor.fill(1, z * cols + Math.round((r.minX - L.minX) / grid), z * cols + Math.round((r.maxX - L.minX) / grid));
  }
  const occupied = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < cols && z < rows && floor[z * cols + x] === 1;
  const lines = new Map<string, number[]>();
  function edge(axis: 'x' | 'z', line: number, direction: number, start: number): void {
    const key = `${axis}:${line}:${direction}`;
    const values = lines.get(key) ?? []; values.push(start); lines.set(key, values);
  }
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) if (occupied(x, z)) {
    if (!occupied(x - 1, z)) edge('z', x, -1, z);
    if (!occupied(x + 1, z)) edge('z', x + 1, 1, z);
    if (!occupied(x, z - 1)) edge('x', z, -1, x);
    if (!occupied(x, z + 1)) edge('x', z + 1, 1, x);
  }
  const result: AuthoredBoundary[] = [];
  for (const [key, values] of lines) {
    const [axis, lineValue, directionValue] = key.split(':'), line = Number(lineValue), direction = Number(directionValue);
    values.sort((a, b) => a - b);
    for (let i = 0; i < values.length;) {
      const start = values[i++]; let end = start + 1;
      while (i < values.length && values[i] === end) { end++; i++; }
      const a = axis === 'x' ? { x: L.minX + start * grid, z: L.minZ + line * grid } : { x: L.minX + line * grid, z: L.minZ + start * grid };
      const b = axis === 'x' ? { x: L.minX + end * grid, z: a.z } : { x: a.x, z: L.minZ + end * grid };
      result.push({ id: `${key}:${start}`, a, b, length: (end - start) * grid, outward: axis === 'x' ? { x: 0, z: direction } : { x: direction, z: 0 } });
    }
  }
  return result;
}

export function buildAuthoredSceneLayout(L: LevelLayout): AuthoredSceneLayout {
  if (!L.whitebox) throw new Error('Authored art requires a reviewed floor plan');
  const plan = L.whitebox.plan, direction = AUTHORED_ART_DIRECTION[plan.id], kit = KITS[L.theme];
  if (!direction) throw new Error(`No art direction for ${plan.id}`);
  const boundaries = authoredBoundaries(L), placements: AuthoredScenePlacement[] = [], rayWindows: AuthoredArtRayWindow[] = [];
  const floor = L.whitebox.floorRects;
  const rooms = plan.rooms.map(room => ({ ...room, x: room.labelAt[0] - plan.bounds[0] / 2, z: room.labelAt[1] - plan.bounds[1] / 2 }));
  const nearestRoom = (p: P2) => rooms.reduce((best, room) => Math.hypot(room.x - p.x, room.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? room : best);
  const clear = (p: AuthoredScenePlacement): boolean => !floor.some(r => intersects(authoredPlacementRect(p), r));
  function beside(boundary: AuthoredBoundary, along: number, dimensions: readonly number[], height: number, assetId: string, role: AuthoredScenePlacement['role'], inset = .018): AuthoredScenePlacement | null {
    const env = envelope(dimensions, height), normal = boundary.outward;
    const p: AuthoredScenePlacement = {
      x: boundary.a.x + (boundary.b.x - boundary.a.x) * along + normal.x * (env.depth / 2 + inset),
      z: boundary.a.z + (boundary.b.z - boundary.a.z) * along + normal.z * (env.depth / 2 + inset),
      y: L.floorY, yaw: Math.atan2(-normal.x, -normal.z), s: 1, envelope: env,
      assetId, type: assetId.endsWith('Gate') ? 'gate' : 'wall', court: 'arrival', role, boundaryId: boundary.id,
    };
    if (!clear(p)) return null;
    p.roomId = nearestRoom(p).id; return p;
  }
  // Long building facades and natural banks: one 9–15m module, never one instance per grid cell.
  for (const boundary of [...boundaries].sort((a, b) => b.length - a.length)) {
    if (boundary.length < 3.5) continue;
    const room = nearestRoom(mid(boundary)), natural = direction.naturalRooms.includes(room.id);
    const dimensions = natural ? kit.cliff : kit.wall;
    const assetId = `SM_Env_${kit.prefix}${natural ? 'Cliff' : 'Wall'}`;
    const count = Math.max(1, Math.ceil(boundary.length / 12));
    for (let i = 0; i < count; i++) {
      const along = (i + .5) / count;
      let piece: AuthoredScenePlacement | null = null;
      for (const height of [8.6, 7.2, 5.8, 4.4]) {
        piece = beside(boundary, along, dimensions, height, assetId, 'boundary');
        if (piece) break;
      }
      if (piece) placements.push(piece);
    }
  }
  // Rasterised diagonal banks have short step edges. Assemble large cliff silhouettes
  // behind those edges at landscape spacing, instead of turning every step into masonry.
  const bankAnchors = placements.filter(p => p.role === 'boundary' && p.assetId.endsWith('Cliff')).map(p => {
    const edge = boundaries.find(b => b.id === p.boundaryId)!;
    return mid(edge);
  });
  for (const boundary of boundaries) {
    const point = mid(boundary);
    if (!direction.naturalRooms.includes(nearestRoom(point).id)) continue;
    if (bankAnchors.some(p => Math.hypot(p.x - point.x, p.z - point.z) < 9)) continue;
    let piece: AuthoredScenePlacement | null = null;
    for (const inset of [.018, 2, 4, 7]) {
      piece = beside(boundary, .5, kit.cliff, 9.8, `SM_Env_${kit.prefix}Cliff`, 'boundary', inset);
      if (piece) break;
    }
    if (piece) { placements.push(piece); bankAnchors.push(point); }
  }
  // Grounded retaining courses close the *real mesh* gaps left when a wide cliff
  // has to shrink to fit a narrow blocked strip. Spacing follows the fitted wall,
  // not the original landscape module pitch. These are published Hunyuan meshes.
  for (const boundary of boundaries) {
    if (boundary.length < 3.5) continue;
    const maxHeight = Math.min(3.4, (boundary.length - .08) * kit.wall[1] / kit.wall[0]);
    const env = envelope(kit.wall, maxHeight);
    const count = boundary.length - env.width < .3 ? 1 : Math.ceil((boundary.length - env.width) / (env.width * .72)) + 1;
    for (let i = 0; i < count; i++) {
      const along = count === 1 ? .5 : (env.width / 2 + .02 + i * (boundary.length - env.width - .04) / (count - 1)) / boundary.length;
      const x = boundary.a.x + (boundary.b.x - boundary.a.x) * along;
      const z = boundary.a.z + (boundary.b.z - boundary.a.z) * along;
      if (placements.some(p => p.boundaryId === boundary.id && p.assetId.endsWith('Wall') && p.role === 'boundary'
        && Math.hypot(p.x - x - boundary.outward.x * p.envelope.depth / 2, p.z - z - boundary.outward.z * p.envelope.depth / 2) < p.envelope.width * .29)) continue;
      let p: AuthoredScenePlacement | null = null;
      for (const height of [maxHeight, maxHeight * .85, maxHeight * .72]) {
        p = beside(boundary, along, kit.wall, height, `SM_Env_${kit.prefix}Wall`, 'accent');
        if (p) break;
      }
      if (p) { p.y -= .12; p.label = 'boundary-foot'; placements.push(p); }
    }
  }
  // Diagonal floor edges are half-metre stair steps, but their art must read as one
  // continuous bank. Fit rotated source walls to the locally averaged outward normal.
  const rakeAnchors: P2[] = [];
  for (const boundary of boundaries) {
    if (boundary.length >= 3.5) continue;
    const point = mid(boundary);
    if (rakeAnchors.some(p => Math.hypot(p.x - point.x, p.z - point.z) < 3.3)) continue;
    let nx = 0, nz = 0;
    for (const neighbor of boundaries) {
      const p = mid(neighbor), distance = Math.hypot(p.x - point.x, p.z - point.z);
      if (distance > 5 || neighbor.outward.x * boundary.outward.x + neighbor.outward.z * boundary.outward.z < 0) continue;
      const weight = Math.min(neighbor.length, 4) / (1 + distance);
      nx += neighbor.outward.x * weight; nz += neighbor.outward.z * weight;
    }
    const magnitude = Math.hypot(nx, nz); if (magnitude < .01) continue;
    nx /= magnitude; nz /= magnitude;
    let found: AuthoredScenePlacement | null = null;
    for (const height of [3.4, 2.8]) {
      const env = envelope(kit.wall, height);
      for (const inset of [.15, .4, .7, 1.1, 1.5]) {
        const p: AuthoredScenePlacement = { assetId: `SM_Env_${kit.prefix}Wall`, x: point.x + nx * (env.depth / 2 + inset), z: point.z + nz * (env.depth / 2 + inset),
          y: L.floorY - .12, yaw: Math.atan2(-nx, -nz), s: 1, envelope: env, type: 'wall', court: 'arrival', role: 'accent',
          boundaryId: boundary.id, label: 'boundary-rake', roomId: nearestRoom(point).id };
        if (authoredPlacementOutsideFloor(L, p)) { found = p; break; }
      }
      if (found) break;
    }
    if (found) { placements.push(found); rakeAnchors.push(point); }
  }
  // Turn masses fill short stepped sections; distance thinning keeps diagonal banks inexpensive.
  const rockDimensions = L.theme === 'desert' ? KITS.desert.nature : KITS.inferno.nature;
  for (const boundary of boundaries) {
    const point = mid(boundary);
    if (placements.some(p => p.role === 'corner' && Math.hypot(p.x - point.x, p.z - point.z) < 6)) continue;
    if (boundary.length > 3.5 && placements.some(p => p.boundaryId === boundary.id)) continue;
    for (const height of [7.6, 5.5, 3.6]) {
      const piece = beside(boundary, .5, rockDimensions, height, kit.rock, 'corner');
      if (piece) { placements.push(piece); break; }
    }
  }
  // Authored silhouettes occupy blocked ground behind their own room, not the room's playable centre.
  const normal: Record<Direction, P2> = { north: { x: 0, z: -1 }, east: { x: 1, z: 0 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 } };
  for (const feature of direction.features) {
    const room = rooms.find(r => r.id === feature.room)!;
    const n = normal[feature.side];
    const target = { x: room.x, z: room.z };
    if (n.x) target.x = (n.x > 0 ? Math.max : Math.min)(...room.polygon.map(p => p[0])) - plan.bounds[0] / 2;
    if (n.z) target.z = (n.z > 0 ? Math.max : Math.min)(...room.polygon.map(p => p[1])) - plan.bounds[1] / 2;
    const candidates = boundaries.filter(b => b.outward.x === n.x && b.outward.z === n.z)
      .sort((a, b) => Math.hypot(mid(a).x - target.x, mid(a).z - target.z) - Math.hypot(mid(b).x - target.x, mid(b).z - target.z));
    const assetId = feature.kind === 'landmark' ? kit.landmarkId : feature.kind === 'nature' ? kit.natureId : `SM_Env_${kit.prefix}${feature.kind === 'gate' ? 'Gate' : 'Cliff'}`;
    let placed = false;
    for (const b of candidates.slice(0, 64)) {
      for (const inset of [.025, 2, 4, 7, 11, 16, 22]) {
        const p = beside(b, .5, kit[feature.kind], feature.height, assetId, 'landmark', inset);
        if (!p) continue;
        p.roomId = feature.room; p.label = feature.label; placements.push(p); placed = true; break;
      }
      if (placed) break;
    }
    if (!placed) throw new Error(`${plan.id}/${feature.label}: no art-safe silhouette position`);
  }
  // Existing cover volumes remain authoritative. Art facades stay within their union.
  const covers = L.boxes.filter(b => b.tag === 'whitebox-cover');
  const coverEdges = authoredBoundaries({ ...L, whitebox: { ...L.whitebox, floorRects: covers } });
  const inCoverUnion = (r: WhiteboxRect): boolean => {
    const area = (r.maxX - r.minX) * (r.maxZ - r.minZ);
    const covered = covers.reduce((sum, b) => sum + Math.max(0, Math.min(r.maxX, b.maxX) - Math.max(r.minX, b.minX)) * Math.max(0, Math.min(r.maxZ, b.maxZ) - Math.max(r.minZ, b.minZ)), 0);
    return covered >= area - 1e-6;
  };
  for (const edge of coverEdges) {
    // Whole 2.6m walls on broad edges; two real, uniformly scaled masonry courses on short edges.
    const full = envelope(kit.wall, 2.6);
    const layers = full.width <= edge.length - .035 ? 1 : 2;
    const env = envelope(kit.wall, 2.6 / layers);
    if (env.width > edge.length - .035) continue;
    const count = Math.max(1, Math.ceil(edge.length / (env.width * .92)));
    for (let layer = 0; layer < layers; layer++) for (let index = 0; index < count; index++) {
      const along = count === 1 ? .5 : (env.width / 2 + .018 + index * (edge.length - env.width - .036) / (count - 1)) / edge.length;
      const p: AuthoredScenePlacement = { assetId: `SM_Env_${kit.prefix}Wall`,
        x: edge.a.x + (edge.b.x - edge.a.x) * along - edge.outward.x * (env.depth / 2 + .018),
        z: edge.a.z + (edge.b.z - edge.a.z) * along - edge.outward.z * (env.depth / 2 + .018),
        y: L.floorY + layer * env.height, yaw: Math.atan2(edge.outward.x, edge.outward.z),
        s: 1, envelope: env, type: 'wall', court: 'arrival', role: 'cover', label: `cover:${edge.id}:${layer}:${index}` };
      if (inCoverUnion(authoredPlacementRect(p))) placements.push(p);
    }
  }
  const inspectionViews: AuthoredInspectionView[] = [];
  function frame(p: AuthoredScenePlacement, observer: P2, id: string, label: string, beat: NonNullable<AuthoredScenePlacement['story']>['beat']): void {
    const focusHeight = p.envelope.height * (p.assetId === CARGO_HOIST.id ? .5 : beat === 'focal' ? .66 : .6);
    p.story = { id, beat, observer: { x: observer.x, z: observer.z }, focusHeight };
    const targetY = p.y + focusHeight, distance = Math.hypot(p.x - observer.x, p.z - observer.z);
    inspectionViews.push({ id: `art-${id}`, label, x: observer.x, z: observer.z,
      yaw: Math.atan2(observer.x - p.x, observer.z - p.z), targetY,
      pitch: Math.max(-.35, Math.min(.35, Math.atan2(targetY - 1.62, distance))) });
  }
  function reveal(target: AuthoredScenePlacement): void {
    const observer = target.story!.observer, at = { x: target.x, z: target.z, y: target.y + target.story!.focusHeight };
    for (const p of [...placements]) {
      if (p === target || p.role === 'cover' || p.role === 'landmark' || p.story || !authoredEnvelopeOccludes(observer, at, p)) continue;
      const b = boundaries.find(edge => edge.id === p.boundaryId);
      if (!b) continue;
      let shifted = false;
      for (const distance of [.7, 1.2, 1.8, 2.6, 4, 6, 9]) {
        const copy = { ...p, x: p.x + b.outward.x * distance, z: p.z + b.outward.z * distance };
        if (authoredPlacementOutsideFloor(L, copy) && !authoredEnvelopeOccludes(observer, at, copy)) {
          p.x = copy.x; p.z = copy.z; shifted = true; break;
        }
      }
      // The tested retaining courses remain. A redundant skyline mass can yield
      // to its landmark without changing the actual obstacle or player route.
      if (!shifted && (p.role === 'boundary' || p.role === 'corner')) placements.splice(placements.indexOf(p), 1);
    }
  }
  for (const [index, p] of placements.filter(p => p.role === 'landmark').entries()) {
    const room = rooms.find(room => room.id === p.roomId)!;
    const viewpoints = L.whitebox.checkpoints.filter(point => nearestRoom(point).id === p.roomId);
    const coverScore = (observer: P2): number => placements.filter(other => other.role === 'cover').reduce((sum, other) => sum +
      [.35, .5, .75].filter(height => authoredEnvelopeOccludes(observer, { x: p.x, z: p.z, y: p.y + p.envelope.height * height }, other)).length, 0)
      + Math.hypot(observer.x - room.x, observer.z - room.z) * .001;
    const observer = [room, ...viewpoints].sort((a, b) => coverScore(a) - coverScore(b))[0];
    frame(p, observer, `focal-${index}`, p.label ?? '主景', 'focal');
    reveal(p);
  }
  const storyAssets = STORY_ASSETS[L.theme], beats = ['entry', 'junction', 'supply'] as const;
  for (const [index, roomId] of STORY_ROOMS[plan.id].entries()) {
    const room = rooms.find(r => r.id === roomId)!;
    // The western transfer station is entered from its far corner. Its existing
    // room checkpoint shows both the waiting cart and the bridge approach.
    const observer = index === 0 && plan.id !== 'inferno-3' ? L.playerSpawn : room;
    const usesHoist = index === 1 && ['desert-2', 'frost-3', 'inferno-3'].includes(plan.id);
    const usesStall = plan.id === 'desert-3' && index === 2;
    const usesCart = index === 0 && ['inferno-1', 'inferno-3'].includes(plan.id) || plan.id === 'inferno-4' && index === 1;
    const primaryHeight = usesCart ? 2.2 : usesStall ? 3.15 : usesHoist ? 3.4 : index === 1 ? 3.1 : index === 2 ? 2.35 : 2.7;
    const primary = usesCart ? SLAG_CART : usesStall ? MARKET_STALL : usesHoist ? CARGO_HOIST : storyAssets[0], companion = storyAssets[1];
    const yawOffset = usesCart ? plan.id === 'inferno-1' ? Math.PI / 6 : plan.id === 'inferno-3' ? -Math.PI / 5 : Math.PI / 10 : 0;
    const specs = [{ asset: primary, height: primaryHeight, yawOffset }, { asset: companion, height: L.theme === 'inferno' ? 1.15 : L.theme === 'frost' ? 1.8 : 1.02 },
      ...(index === 2 ? [{ asset: companion, height: L.theme === 'frost' ? 1.3 : .8 }] : [])];
    const side = usesStall || usesCart && plan.id === 'inferno-4' ? { x: 0, z: -1 } : usesCart ? { x: 1, z: 0 } : undefined;
    assembleStory(roomId, observer, specs, `story-${beats[index]}`, STORY_LABELS[plan.id][index], beats[index], side,
      usesCart ? plan.id === 'inferno-4' ? 5 : 6 : 0);
  }
  if (plan.id === 'desert-2') {
    // This street awning is beyond the well court, separate from the cargo hoist
    // before its approach. The broad canopy marks an inhabited trading frontage.
    const streetView = L.whitebox.checkpoints.find(point => point.id === 'encounter-B')!;
    assembleStory('well', streetView, [
      { asset: MARKET_STALL, height: 3.2 }, { asset: STORY_ASSETS.desert[1], height: 1.05 }, { asset: STORY_ASSETS.desert[1], height: .8 },
    ], 'work-market', '井院沿街布棚', 'focal', { x: 0, z: -1 }, 5);
  }
  if (plan.id === 'frost-3') assembleRepairDock({ asset: FROZEN_SKIFF, height: 1.8 });
  function assembleStory(roomId: string, observer: P2, specs: readonly StoryPiece[], id: string, label: string,
    beat: NonNullable<AuthoredScenePlacement['story']>['beat'], preferredSide?: P2, minDistance = 0): void {
    // Angled carts and boats keep their real proportions; only the placement
    // envelope is rotated for the floor-clearance calculation.
    const footprint = (spec: StoryPiece): DecoFootprint => {
      const env = envelope(spec.asset.dimensions, spec.height), c = Math.abs(Math.cos(spec.yawOffset ?? 0)), s = Math.abs(Math.sin(spec.yawOffset ?? 0));
      return { width: env.width * c + env.depth * s, depth: env.width * s + env.depth * c, height: env.height };
    };
    const widths = specs.map(spec => footprint(spec).width);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + (specs.length - 1) * .35;
    const canReveal = (target: AuthoredScenePlacement): boolean => {
      const at = { x: target.x, z: target.z, y: target.y + target.envelope.height * .6 };
      return placements.every(p => {
        if (!authoredEnvelopeOccludes(observer, at, p)) return true;
        // Existing combat cover and another subject cannot be moved for decoration.
        if (p.role === 'cover' || p.role === 'landmark' || p.story) return false;
        if (p.role === 'boundary' || p.role === 'corner') return true;
        const b = boundaries.find(edge => edge.id === p.boundaryId);
        return !!b && [.7, 1.2, 1.8, 2.6, 4, 6, 9].some(distance => {
          const copy = { ...p, x: p.x + b.outward.x * distance, z: p.z + b.outward.z * distance };
          return authoredPlacementOutsideFloor(L, copy) && !authoredEnvelopeOccludes(observer, at, copy);
        });
      });
    };
    const groupReadable = (members: AuthoredScenePlacement[]): boolean => members.every(target => members.every(other => other === target ||
      !authoredEnvelopeOccludes(observer, { x: target.x, z: target.z, y: target.y + target.envelope.height * .6 }, other)));
    const inArea = (b: AuthoredBoundary): boolean => nearestRoom(mid(b)).id === roomId
      && (!preferredSide || b.outward.x === preferredSide.x && b.outward.z === preferredSide.z)
      && Math.hypot(mid(b).x - observer.x, mid(b).z - observer.z) >= minDistance;
    const candidates = boundaries.filter(b => b.length > totalWidth + .2 && inArea(b))
      .sort((a, b) => {
        const score = (edge: AuthoredBoundary) => {
          const p = mid(edge), distance = Math.hypot(p.x - observer.x, p.z - observer.z);
          const front = beat === 'entry' ? ((p.x - observer.x) * -Math.sin(L.playerYaw) + (p.z - observer.z) * -Math.cos(L.playerYaw)) / Math.max(distance, 1) : 1;
          return distance + (front < -.1 ? 30 : 0);
        };
        return score(a) - score(b);
      });
    let cluster: AuthoredScenePlacement[] | null = null;
    for (const b of candidates) {
      let cursor = (b.length - totalWidth) / 2;
      const members = specs.map((spec, member) => {
        const along = (cursor + widths[member] / 2) / b.length; cursor += widths[member] + .35;
        const fit = footprint(spec);
        const p = beside(b, along, [fit.width, fit.height, fit.depth], spec.height, spec.asset.id, 'accent', .045);
        if (p) { p.roomId = roomId; p.label = label; p.envelope = envelope(spec.asset.dimensions, spec.height); p.yaw += spec.yawOffset ?? 0; }
        return p;
      });
      if (members.every((p): p is AuthoredScenePlacement => !!p && canReveal(p)) && groupReadable(members)) { cluster = members; break; }
    }
    if (!cluster) {
      // Fan-shaped arenas may have no long orthogonal edge. A compact alcove
      // follows the room-facing diagonal instead of treating raster steps as walls.
      const diagonal = boundaries.filter(inArea).sort((a, b) =>
        Math.hypot(mid(a).x - observer.x, mid(a).z - observer.z) - Math.hypot(mid(b).x - observer.x, mid(b).z - observer.z));
      for (const b of diagonal) {
        const at = mid(b), distance = Math.hypot(at.x - observer.x, at.z - observer.z);
        const nx = (at.x - observer.x) / distance, nz = (at.z - observer.z) / distance;
        for (const inset of [.2, .5, .9, 1.4, 2]) {
          let cursor = -totalWidth / 2;
          const members: AuthoredScenePlacement[] = specs.map((spec, member) => {
            const env = envelope(spec.asset.dimensions, spec.height), fit = footprint(spec), offset = cursor + widths[member] / 2; cursor += widths[member] + .35;
            return { assetId: spec.asset.id, type: 'wall', court: 'arrival', s: 1, y: L.floorY,
              x: at.x + nx * (fit.depth / 2 + inset) + nz * offset, z: at.z + nz * (fit.depth / 2 + inset) - nx * offset,
              yaw: Math.atan2(-nx, -nz) + (spec.yawOffset ?? 0), envelope: env, role: 'accent', boundaryId: b.id, roomId, label };
          });
          if (members.every(p => authoredPlacementOutsideFloor(L, p) && canReveal(p)) && groupReadable(members)) { cluster = members; break; }
        }
        if (cluster) break;
      }
    }
    if (!cluster) throw new Error(`${plan.id}/${roomId}: no safe story alcove`);
    placements.push(...cluster);
    frame(cluster[0], observer, id, label, beat);
    for (const p of cluster) {
      p.story ??= { id, beat, observer: { x: observer.x, z: observer.z }, focusHeight: p.envelope.height * .6 };
      reveal(p);
    }
  }
  function assembleRepairDock(skiff: StoryPiece): void {
    // This is the authored U-shaped repair basin, not another wall alcove.
    // Original navigation/collision stays intact; only this closed bay may use
    // its real visible meshes for projectiles once every required asset loads.
    const x = (value: number) => value - plan.bounds[0] / 2, z = (value: number) => value - plan.bounds[1] / 2;
    const atBoundary = (axis: 'x' | 'z', value: number, outward: number) => boundaries.find(b =>
      b.a[axis] === (axis === 'x' ? x(value) : z(value)) && b.b[axis] === b.a[axis] && b.outward[axis] === outward
      && (axis === 'x' ? mid(b).z > z(56) && mid(b).z < z(69) : mid(b).x > x(87) && mid(b).x < x(96)))!;
    const rear = atBoundary('x', 87, 1), front = atBoundary('x', 96, -1), north = atBoundary('z', 56, 1);
    if (!rear || !front || !north) throw new Error('frost-3: authored repair basin boundaries changed');
    const basinEdges = new Set([rear.id, front.id, north.id]);
    // Recompose the existing pieces, rather than adding another complete wall set.
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i], outsideSouthWing = p.boundaryId === rear.id && p.label === 'boundary-foot' && p.z > z(65);
      if (!p.story && basinEdges.has(p.boundaryId ?? '') && !outsideSouthWing) placements.splice(i, 1);
    }
    const wall = (px: number, pz: number, height: number, y: number, yaw: number, label: string, boundaryId?: string): AuthoredScenePlacement => {
      const p: AuthoredScenePlacement = { assetId: 'SM_Env_FrostWall', x: x(px), z: z(pz), y: L.floorY + y, yaw, s: 1,
        envelope: envelope(kit.wall, height), type: 'wall', court: 'arrival', role: height > 8 ? 'boundary' : 'accent', roomId: 'middle-pier', label, boundaryId };
      if (!authoredPlacementOutsideFloor(L, p)) throw new Error(`frost-3/${label}: repair-bank mesh intrudes on a working quay`);
      placements.push(p); return p;
    };
    const rearHeight = 6, rearEnv = envelope(kit.wall, rearHeight);
    for (const layer of [0, 3.2]) wall(87.468 + rearEnv.depth / 2, 56.018 + rearEnv.width / 2, rearHeight, layer, Math.PI / 2, '修船坞后岸', rear.id);
    const wingHeight = 4.4, wingEnv = envelope(kit.wall, wingHeight);
    // Deep overlap joins the source's solid stone body, not just its highest
    // snow/roof spikes. It also closes the old 8m bullet wall's upper band.
    for (const layer of [0, 2.4, 4.8]) {
      wall(95.98 - wingEnv.width / 2, 56.018 + wingEnv.depth / 2, wingHeight, layer, 0, '修船坞北侧岸', north.id);
      wall(95.98 - wingEnv.width / 2, 65.02 + wingEnv.depth / 2, wingHeight, layer, Math.PI, '修船坞南侧岸');
    }
    const lipEnv = envelope(kit.wall, 3.4);
    for (const pz of [56.02 + lipEnv.width / 2, 64.98 - lipEnv.width / 2]) {
      wall(95.982 - lipEnv.depth / 2, pz, 3.4, 1.15 - 3.4, Math.PI / 2, '修船坞近侧护岸', front.id);
    }
    const observer = L.whitebox!.checkpoints.find(point => point.id === 'reward-2')!;
    const boat: AuthoredScenePlacement = { assetId: skiff.asset.id, x: x(93.35), z: z(62), y: L.floorY, yaw: 0, s: 1,
      envelope: envelope(skiff.asset.dimensions, skiff.height), type: 'wall', court: 'arrival', role: 'accent', roomId: 'middle-pier', label: '中栈侧泊修船坞', boundaryId: front.id };
    if (!authoredPlacementOutsideFloor(L, boat)) throw new Error('frost-3: the complete skiff does not fit its authored basin');
    placements.push(boat); frame(boat, observer, 'work-skiff', boat.label!, 'focal');
    const hoist: AuthoredScenePlacement = { assetId: CARGO_HOIST.id, x: x(91.5), z: z(58.72), y: L.floorY, yaw: 0, s: 1,
      envelope: envelope(CARGO_HOIST.dimensions, 2.1), type: 'wall', court: 'arrival', role: 'accent', roomId: 'middle-pier', label: '船坞卷扬机', boundaryId: front.id,
      story: { id: 'work-skiff', beat: 'focal', observer, focusHeight: 1.05 } };
    if (authoredPlacementOutsideFloor(L, hoist) && !authoredPlacementIntersectsRect(hoist, authoredPlacementRect(boat))
      && !authoredEnvelopeOccludes(observer, { x: boat.x, y: boat.y + boat.story!.focusHeight, z: boat.z }, hoist)) placements.push(hoist);
    rayWindows.push({ id: 'frost-3-repair-basin', bounds: {
      minX: x(88.6), maxX: x(96.002), minZ: z(56.7), maxZ: z(65.85), minY: L.floorY, maxY: L.floorY + 9.2,
    }, placementIndices: [] });
    // Indices are populated after every remaining placement mutation below.
  }
  // A few unequal tree crowns frame the snow chapter's room silhouettes.
  if (L.theme === 'frost') {
    const chosen = [STORY_ROOMS[plan.id][0], STORY_ROOMS[plan.id][1], STORY_ROOMS[plan.id][2], direction.features[0].room];
    for (const [index, roomId] of chosen.entries()) {
      const room = rooms.find(r => r.id === roomId)!;
      const candidates = boundaries.filter(b => nearestRoom(mid(b)).id === roomId)
        .sort((a, b) => Math.hypot(mid(a).x - room.x, mid(a).z - room.z) - Math.hypot(mid(b).x - room.x, mid(b).z - room.z));
      for (const b of candidates) {
        const p = beside(b, index % 2 ? .7 : .3, kit.nature, [8.2, 10, 7.5, 9.2][index], kit.natureId, 'accent', .5);
        if (!p || placements.some(other => other.assetId === kit.natureId && Math.hypot(other.x - p.x, other.z - p.z) < 5)) continue;
        if (placements.filter(other => other.story).some(other => authoredEnvelopeOccludes(other.story!.observer, { x: other.x, z: other.z, y: other.y + other.story!.focusHeight }, p))) continue;
        p.label = '房区雪松'; p.roomId = roomId; placements.push(p); break;
      }
    }
  }
  for (const window of rayWindows) window.placementIndices = placements.flatMap((p, index) => p.story?.id === 'work-skiff' ? [index] : []);
  const decks = buildAuthoredDecks(L);
  return { planId: plan.id, title: plan.title, identity: direction.identity, architecture: placements, placements, boundaries, landmarks: placements.filter(p => p.role === 'landmark'),
    decks, deckFloorMasks: decks.map(p => ({ passageId: p.passageId, polygon: authoredDeckFootprint(p) })), inspectionViews, rayWindows };
}
