/** Authored stage routes. Art remains the published Hunyuan library. */
import type { StageNode } from '../core/types';
import type { AdventurePath, P2, SceneArchitecturePlacement } from './LevelTypes';

type XY = readonly [number, number];
type Waypoint = 'entry' | 'objective' | 'west' | 'east' | 'north' | XY;
export interface StageEncounterPlan extends P2 {
  id: string;
  label: string;
  kind: 'approach' | 'cache';
  siteIndex?: number;
  /** Direction from which the player normally enters this battle pocket. */
  from: P2;
}
export interface StageDesign {
  id: string;
  title: string;
  routeHint: string;
  combatHint: string;
  layoutKind: string;
  entrance: P2;
  objective: P2;
  sites: P2[];
  paths: AdventurePath[];
  ridges: { id: string; anchors: XY[] }[];
  ridgeHeight: readonly [number, number];
  /** Published wall modules form actual courts and folded passages. */
  wallPlans: { court: SceneArchitecturePlacement['court']; x: number; z: number; yaw: number }[];
  wallBudget: number;
  gateSockets: { court: SceneArchitecturePlacement['court']; x: number; z: number; yaw: number; s: number }[];
  overlook: P2;
  encounterPlans: StageEncounterPlan[];
  bossKind: 'open-crescent' | 'split-wings' | 'three-lanes';
}
interface Geometry {
  entry?: XY;
  objective?: XY;
  west?: XY;
  east?: XY;
  north?: XY;
  left: Waypoint[];
  right: Waypoint[];
  direct: Waypoint[];
  links?: Waypoint[][];
  ridges: [XY[], XY[], XY[]];
  gate?: XY;
  sideGate?: XY;
  overlook?: XY;
  approach: XY[];
}
const p = ([x, z]: XY): P2 => ({ x, z });
const line = (...points: XY[]): XY[] => points;
const ridge = (x: number, z: number, axis: 'x' | 'z', turn = 0): XY[] =>
  [0, -4, 4, -8, 8].map((d, i): XY => axis === 'x' ? [x + d, z + (i >= 3 ? turn : 0)] : [x + (i >= 3 ? turn : 0), z + d]);
function design(chapter: number, index: number, title: string, layoutKind: string,
  routeHint: string, combatHint: string, g: Geometry): StageDesign {
  const points = { entry: p(g.entry ?? [-10.5, 29.5]), objective: p(g.objective ?? [12.5, -13.5]),
    west: p(g.west ?? [-27.5, -5.5]), east: p(g.east ?? [26.5, 9.5]), north: p(g.north ?? [-18.5, -27.5]) };
  const resolve = (point: Waypoint): P2 => typeof point === 'string' ? { ...points[point] } : p(point);
  const paths = [g.left, g.right, g.direct, ...(g.links ?? [])].map((route, i) => ({
    points: route.map(resolve), width: i < 2 ? 6.2 : i === 2 ? 5.8 : 5.4,
  }));
  const overlook = p(g.overlook ?? [8.5, -.25]);
  // The final short link is a usable lookout spur, rather than an extra
  // full-map road. Every other link changes actual route connectivity.
  paths.push({ points: [resolve(g.direct[Math.max(1, Math.floor(g.direct.length / 2))]),
    { x: overlook.x - 7.5, z: overlook.z + 6.7 }, { x: overlook.x, z: overlook.z + 4.7 }], width: 5.4 });
  const gate = p(g.gate ?? [-8.5, 10]), sideGate = p(g.sideGate ?? [-3.5, -28.38235294117647]);
  const courtyard = layoutKind.includes('court') || layoutKind.includes('linked') || layoutKind.includes('crossing');
  const corridor = layoutKind.includes('serpentine') || layoutKind.includes('dogleg');
  const counts = index === 0 && chapter === 0 ? [5, 5, 5] : corridor ? [4, 2, 4]
    : courtyard ? [3, 2, 3] : [4, 4, 2];
  const wallPlans: StageDesign['wallPlans'] = [];
  const addRun = (a: P2, b: P2, court: SceneArchitecturePlacement['court'], both: boolean): void => {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    // Quarter-turn modular runs preserve the measured uniform art envelope.
    if (length < 7 || Math.min(Math.abs(dx), Math.abs(dz)) > .1) return;
    const horizontal = Math.abs(dx) > Math.abs(dz), count = Math.min(2, Math.floor(length / 6.4));
    for (const side of both ? [-1, 1] : [1]) for (let i = 0; i < count; i++) {
      const d = (i - (count - 1) / 2) * 6.35;
      wallPlans.push({ court, x: (a.x + b.x) / 2 + (horizontal ? d : side * 4.6),
        z: (a.z + b.z) / 2 + (horizontal ? side * 4.6 : d), yaw: horizontal ? 0 : Math.PI / 2 });
    }
  };
  // Long straight legs create two-sided corridors; cross-links open between
  // separate court walls. Actual clearance filtering happens before placement.
  for (let i = 2; i < g.direct.length; i++)
    addRun(resolve(g.direct[i - 1]), resolve(g.direct[i]), i < 3 ? 'arrival' : 'shrine', true);
  for (const route of g.links ?? []) for (let i = 1; i < route.length; i++)
    addRun(resolve(route[i - 1]), resolve(route[i]), i === 1 ? 'west' : 'east', courtyard);
  if (!wallPlans.length) {
    addRun(resolve(g.left[2]), resolve(g.left[3]), 'west', false);
    addRun(resolve(g.right[2]), resolve(g.right[3]), 'east', false);
  }
  // Cache courts use real L-shaped returns beside the walking street, with
  // open north/south connections instead of a closed ring of identical walls.
  for (const [court, point, sign] of [['west', points.west, -1], ['east', points.east, 1]] as const) {
    const x = point.x + sign * 6.1;
    wallPlans.push({ court, x, z: point.z + 4.6, yaw: Math.PI / 2 },
      { court, x, z: point.z - 1.75, yaw: Math.PI / 2 },
      { court, x: x - sign * 2.55, z: point.z - 6.05, yaw: 0 });
    const inner = point.x - sign * 6.6;
    for (const dz of [-13.1, -6.75, 6.75, 13.1])
      wallPlans.push({ court, x: inner, z: point.z + dz, yaw: Math.PI / 2 });
  }
  return { id: `chapter-${chapter + 1}-stage-${index + 1}`, title, routeHint, combatHint, layoutKind,
    entrance: points.entry, objective: points.objective, sites: [points.west, points.east, points.north], paths,
    ridges: g.ridges.map((anchors, i) => ({ id: ['west-ridge', 'central-ridge', 'north-ridge'][i], anchors: anchors.slice(0, counts[i]) })),
    ridgeHeight: index === 0 && chapter === 0 ? [5.1, 7.9] : courtyard ? [3.8, 5.4] : corridor ? [5.2, 7.5] : [4.5, 6.5],
    wallPlans, wallBudget: courtyard || corridor ? 22 : 18,
    gateSockets: [{ court: 'arrival', ...gate, yaw: 0, s: 1.2 },
      { court: 'north', ...sideGate, yaw: Math.abs(sideGate.x) > 20 ? 0 : Math.PI / 2, s: 1.2 }],
    overlook, encounterPlans: [
      ...g.approach.map((point, i) => ({ id: `approach-${i + 1}`, label: i === 0 ? '前路守卫' : '侧路巡逻',
        kind: 'approach' as const, ...p(point), from: i === 0 ? { ...points.entry } : p(g.approach[0]) })),
      { id: 'cache-guard', label: '物资守卫', kind: 'cache', siteIndex: index % 3, ...[points.west, points.east, points.north][index % 3],
        from: { ...points.entry } },
    ], bossKind: chapter === 0 ? 'open-crescent' : chapter === 1 ? 'split-wings' : 'three-lanes' };
}

const DESERT = [
  design(0, 0, '风蚀关口', 'three-approaches', '西侧营地、东侧驿站与中路石门通往祭坛，先绕岩壁取补给。', '门后刀客迎击，营地弩手从侧面支援。', {
    left: ['entry', [-24.5, 15.5], 'west', [-25.5, -18.5], 'north', [-5.5, -28.5], [11.5, -27.5], 'objective'],
    right: ['entry', [17.5, 23.5], 'east', [27.5, -12.5], 'objective'],
    direct: ['entry', [-8.5, 17.5], [-8.5, -1.5], [-5.5, -5.5], [-5.5, -12.5], [-.5, -17.5], 'objective'],
    ridges: [line([-17.5, -8.5], [-17.5, -2.5], [-16.5, -14], [-18.5, 3.5], [-13, -9]),
      line([3.5, 13.5], [8.5, 12.5], [10.5, 17.5], [-.5, 18], [13.5, 12.5]),
      line([19, -1.5], [18.5, 4.5], [19.5, -6], [15, .5], [18, 8])], approach: [[-8.5, 3.5]],
  }),
  design(0, 1, '驿站连院', 'courtyard-ladder', '两条外街之间有横巷，穿过连院可切换左右战线。', '前院近战压上，后院弩手隔墙射击；横巷用于侧绕。', {
    entry: [-9.5, 29.5], west: [-26.5, -4.5], east: [25.5, 7.5], north: [-17.5, -26.5],
    left: ['entry', [-25.5, 19.5], 'west', [-26.5, -20.5], 'north', [-5.5, -28.5], [11.5, -27.5], 'objective'],
    right: ['entry', [21.5, 25.5], 'east', [26.5, -17.5], 'objective'],
    direct: ['entry', [-8.5, 17.5], [-8.5, 1.5], [1.5, -6.5], [2.5, -17.5], 'objective'],
    links: [['west', [-8.5, 1.5], [6.5, 1.5], 'east']],
    ridges: [ridge(-17.5, -10.5, 'z'), ridge(5.5, 15.5, 'x'), ridge(18.5, -6.5, 'z')],
    approach: [[-8.5, 1.5], [23.5, -7.5]],
  }),
  design(0, 2, '断墙环城', 'outer-ring-two-chords', '残墙围出大环路，中段两条横径缩短行程；北侧藏着秘卷。', '远程守外环，重甲看守内径，沿横径接近射手。', {
    entry: [-5.5, 30.5], objective: [13.5, -15.5], west: [-27.5, -2.5], east: [26.5, 3.5], north: [-17.5, -27.5],
    left: ['entry', [-25.5, 23.5], 'west', [-27.5, -21.5], 'north', [-5.5, -28.5], [12.5, -27.5], 'objective'],
    right: ['entry', [22.5, 25.5], 'east', [26.5, -17.5], 'objective'],
    direct: ['entry', [-5.5, 17.5], [-5.5, 1.5], [-.5, -10.5], 'objective'], gate: [-5.5, 10],
    links: [[[-25.5, 23.5], [-5.5, 17.5], [22.5, 25.5]], ['west', [-5.5, 1.5], 'east']],
    ridges: [ridge(-17.5, -10.5, 'z'), ridge(8.5, 10.5, 'x'), ridge(17.5, -5.5, 'z')],
    overlook: [8.5, -.25], approach: [[-5.5, 1.5], [-25.5, -15.5]],
  }),
  design(0, 3, '双寺夹谷', 'linked-loops', '两座院落各有绕行环线，南北联络径连起补给与主祭坛。', '峡口重甲守正面，弩手占院后；先从侧院拆掉支援。', {
    entry: [-11.5, 30.5], objective: [11.5, -16.5], west: [-26.5, -7.5], east: [26.5, 6.5], north: [-19.5, -26.5],
    left: ['entry', [-25.5, 19.5], 'west', [-27.5, -21.5], 'north', [-5.5, -28.5], [11.5, -27.5], 'objective'],
    right: ['entry', [20.5, 25.5], 'east', [27.5, -17.5], 'objective'],
    direct: ['entry', [-8.5, 17.5], [-8.5, -.5], [2.5, -.5], [2.5, -14.5], 'objective'],
    links: [['west', [-8.5, -.5]], [[2.5, -.5], 'east'], ['north', [2.5, -14.5]]],
    ridges: [ridge(-17.5, -12.5, 'z'), ridge(6.5, 13.5, 'x'), ridge(19.5, -6.5, 'z')],
    approach: [[-8.5, -.5], [25.5, -8.5]],
  }),
];
const FROST = [
  design(1, 0, '松径岔口', 'loop-and-northern-shortcut', '林径从岩壁两侧分开，西侧斜径能提前进入北方雪庭。', '刀客在松径前压，灵火从远处点射；借岩壁断开射线。', {
    entry: [-7.5, 30.5], objective: [12.5, -14.5], west: [-27.5, -3.5], east: [26.5, 8.5], north: [-18.5, -27.5],
    left: ['entry', [-25.5, 20.5], 'west', [-26.5, -20.5], 'north', [-5.5, -28.5], [11.5, -27.5], 'objective'],
    right: ['entry', [21.5, 25.5], 'east', [27.5, -16.5], 'objective'],
    direct: ['entry', [-7.5, 17.5], [-7.5, -1.5], [1.5, -14.5], 'objective'], gate: [-7.5, 10],
    links: [['west', [-20.5, -16.5], 'north']],
    ridges: [ridge(-15.5, -8.5, 'z'), ridge(5.5, 15.5, 'x'), ridge(19.5, -3.5, 'z')],
    approach: [[-7.5, -.5]],
  }),
  design(1, 1, '冰壁曲廊', 'serpentine-with-bypass', '曲廊连续转折，外侧长路能绕过巫祝所在的内庭。', '转角近战突进，后排巫祝支援；外绕接近后排。', {
    entry: [-12.5, 30.5], objective: [13.5, -15.5], west: [-26.5, -6.5], east: [27.5, 5.5], north: [-19.5, -26.5],
    left: ['entry', [-26.5, 19.5], 'west', [-27.5, -21.5], 'north', [-5.5, -28.5], [12.5, -27.5], 'objective'],
    right: ['entry', [18.5, 26.5], 'east', [27.5, -17.5], 'objective'],
    direct: ['entry', [-10.5, 18.5], [-10.5, 2.5], [-2.5, 2.5], [-2.5, -8.5], [5.5, -8.5], 'objective'], gate: [-10.5, 10],
    links: [['east', [5.5, -8.5]]],
    ridges: [ridge(-18.5, -10.5, 'z'), ridge(4.5, 15.5, 'x'), ridge(17.5, -4.5, 'z')],
    overlook: [7.5, .75], approach: [[-10.5, 2.5], [25.5, -7.5]],
  }),
  design(1, 2, '双环雪堡', 'two-courts-three-crossings', '雪堡内外两环通过三处雪径相连，横穿内环可绕过正面守军。', '射手分守两环，巫祝位于内侧；用联络径逐个拆阵。', {
    entry: [-4.5, 30.5], objective: [11.5, -16.5], west: [-27.5, -1.5], east: [26.5, 4.5], north: [-18.5, -27.5],
    left: ['entry', [-25.5, 22.5], 'west', [-27.5, -20.5], 'north', [-5.5, -28.5], [11.5, -27.5], 'objective'],
    right: ['entry', [23.5, 25.5], 'east', [27.5, -18.5], 'objective'],
    direct: ['entry', [-4.5, 17.5], [-4.5, 1.5], [-6.5, -12.5], 'objective'], gate: [-4.5, 10],
    links: [['west', [-4.5, 1.5], 'east'], ['north', [-6.5, -12.5]], [[23.5, 25.5], [-4.5, 17.5]]],
    ridges: [ridge(-16.5, -10.5, 'z'), ridge(8.5, 11.5, 'x'), ridge(18.5, -7.5, 'z')],
    overlook: [7.5, -.25], approach: [[-4.5, 1.5], [-25.5, -13.5]],
  }),
  design(1, 3, '回环冻谷', 'western-altar-loop', '祭坛藏在西侧，东雪庭与北冻谷形成远近两条回环路线。', '精准射手守远线，内谷突袭与支援交替；从北谷回切。', {
    entry: [-8.5, 30.5], objective: [-12.5, -15.5], west: [-27.5, -4.5], east: [27.5, 6.5], north: [-18.5, -27.5],
    left: ['entry', [-26.5, 20.5], 'west', [-27.5, -21.5], 'north', 'objective'],
    right: ['entry', [22.5, 25.5], 'east', [27.5, -20.5], [5.5, -28.5], 'north', 'objective'],
    direct: ['entry', [-6.5, 17.5], [-6.5, 1.5], [3.5, 1.5], [3.5, -12.5], 'objective'], gate: [-6.5, 10], sideGate: [27.5, -10.5],
    links: [['west', [-6.5, 1.5]], ['east', [3.5, 1.5]]],
    ridges: [ridge(-17.5, -4.5, 'z'), ridge(8.5, 13.5, 'x'), ridge(17.5, -12.5, 'z')],
    overlook: [9.5, 1.75], approach: [[-6.5, 1.5], [25.5, -8.5]],
  }),
];
const INFERNO = [
  design(2, 0, '余烬前哨', 'eastern-court-shortcut', '外圈前哨与内侧祭路相连，东侧短径可从守军背后切入。', '盾卫挡路，灵火与远射互相掩护；从侧径击破火力点。', {
    entry: [-10.5, 30.5], objective: [13.5, -14.5], west: [-27.5, -6.5], east: [26.5, 7.5], north: [-18.5, -27.5],
    left: ['entry', [-25.5, 18.5], 'west', [-26.5, -20.5], 'north', [-5.5, -28.5], [12.5, -27.5], 'objective'],
    right: ['entry', [19.5, 25.5], 'east', [27.5, -15.5], 'objective'],
    direct: ['entry', [-8.5, 18.5], [-8.5, -.5], [-.5, -8.5], 'objective'],
    links: [['east', [4.5, 3.5], [-8.5, -.5]]],
    ridges: [ridge(-17.5, -12.5, 'z'), ridge(5.5, 15.5, 'x'), ridge(19.5, -7.5, 'z')],
    approach: [[-8.5, -.5]],
  }),
  design(2, 1, '玄岩三庭', 'triangular-court-network', '三处战庭通过斜向石径互通，选择短路接战或外路取物资。', '前庭盾阵、侧庭巫祝、后庭炮手分工；斜径用于拆支援。', {
    entry: [-8.5, 30.5], objective: [12.5, -16.5], west: [-27.5, -2.5], east: [26.5, 6.5], north: [-19.5, -26.5],
    left: ['entry', [-25.5, 21.5], 'west', [-27.5, -21.5], 'north', [-5.5, -28.5], [11.5, -27.5], 'objective'],
    right: ['entry', [23.5, 25.5], 'east', [27.5, -18.5], 'objective'],
    direct: ['entry', [-7.5, 17.5], [-7.5, 1.5], [2.5, -11.5], 'objective'], gate: [-7.5, 10],
    links: [['west', [-7.5, 1.5], 'east'], ['north', [2.5, -11.5]]],
    ridges: [ridge(-17.5, -8.5, 'z'), ridge(6.5, 14.5, 'x'), ridge(18.5, -7.5, 'z')],
    overlook: [8.5, -.25], approach: [[-7.5, 1.5], [25.5, -9.5]],
  }),
  design(2, 2, '裂谷侧廊', 'dogleg-and-long-flank', '内廊两次折返，西北长路直通后庭；东侧补给另有短径。', '转角盾卫掩护炮手，精准射手守外线；长侧路绕开炮口。', {
    entry: [-12.5, 30.5], objective: [10.5, -15.5], west: [-26.5, -8.5], east: [27.5, 7.5], north: [-18.5, -27.5],
    left: ['entry', [-26.5, 18.5], 'west', [-26.5, -21.5], 'north', [-5.5, -28.5], [10.5, -27.5], 'objective'],
    right: ['entry', [18.5, 26.5], 'east', [27.5, -17.5], 'objective'],
    direct: ['entry', [-10.5, 17.5], [-10.5, 2.5], [1.5, 2.5], [1.5, -7.5], [-4.5, -7.5], [-4.5, -15.5], 'objective'], gate: [-10.5, 10],
    links: [['east', [1.5, 2.5]], ['north', [-4.5, -15.5]], ['west', [-10.5, 2.5]]],
    ridges: [ridge(-18.5, -12.5, 'z'), ridge(4.5, 15.5, 'x'), ridge(17.5, -6.5, 'z')],
    overlook: [9.5, 1.75], approach: [[-10.5, 2.5], [25.5, -8.5]],
  }),
  design(2, 3, '熔炉环路', 'three-crossings-final-loop', '外围环路与炉心径有三处联络口，祭坛在西侧；左右来回切换火力线。', '盾阵护巫祝，炮手封长线；联络口通向后排的侧面。', {
    entry: [-5.5, 30.5], objective: [-11.5, -16.5], west: [-27.5, -3.5], east: [26.5, 3.5], north: [-18.5, -27.5],
    left: ['entry', [-25.5, 22.5], 'west', [-26.5, -21.5], 'north', 'objective'],
    right: ['entry', [23.5, 25.5], 'east', [27.5, -20.5], [4.5, -28.5], 'north', 'objective'],
    direct: ['entry', [-4.5, 17.5], [-4.5, 1.5], [3.5, 1.5], [3.5, -13.5], 'objective'], gate: [-4.5, 10], sideGate: [27.5, -10.5],
    links: [['west', [-4.5, 1.5]], ['east', [3.5, 1.5]], [[23.5, 25.5], [-4.5, 17.5]]],
    ridges: [ridge(-17.5, -7.5, 'z'), ridge(9.5, 11.5, 'x'), ridge(18.5, -12.5, 'z')],
    overlook: [10.5, 1.75], approach: [[-4.5, 1.5], [25.5, -8.5]],
  }),
];
const chapters = [DESERT, FROST, INFERNO];
for (const [chapter, row] of chapters.entries()) {
  const last = row[3];
  row.push({ ...last, id: `chapter-${chapter + 1}-stage-5`,
    title: ['沙王庭院', '霜冠祭坛', '炎脊斗场'][chapter], layoutKind: ['boss-crescent', 'boss-wings', 'boss-lanes'][chapter],
    routeHint: ['宽阔中央庭院与半月侧廊，留足绕行和退路。', '两翼雪台包住开阔祭坛，换侧规避远程攻击。', '三条开阔战线连接侧廊，借外侧岩墙切断炮口视线。'][chapter],
    combatHint: ['首领冲击中央，利用外圈侧廊绕开正面。', '首领法术覆盖中庭，左右换侧留出撤退路线。', '首领压迫长线，从侧廊重新接近。'][chapter] });
}

/** Theme also handles inspection callers that use chapter=0 for every palette. */
export function getStageDesign(stage: Pick<StageNode, 'chapter' | 'index' | 'type' | 'theme'>): StageDesign {
  const chapter = stage.theme === 'frost' ? 1 : stage.theme === 'inferno' ? 2 : 0;
  const index = stage.type === 'boss' ? 4 : Math.max(0, Math.min(4, Number.isFinite(stage.index) ? Math.floor(stage.index) : 0));
  return chapters[chapter][index];
}
