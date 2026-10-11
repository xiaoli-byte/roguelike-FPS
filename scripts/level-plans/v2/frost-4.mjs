// V2 floor plan: 霜山第 4 关「开明九门」。外庭北墙三道门：中门进十字形的开明兽庭，西门通玉库，东门经回廊绕进十字庭东翼；最后北上玉京殿前。
// node scripts/level-plans/v2/frost-4.mjs  → 写入 docs/level-design/plans-v2/frost.json，再运行 whitebox:sync。
// 怪物：第二章定稿阵容（见 docs/art/enemy-roster-v2.md 第二章）。
import { LOW, cover, gatePosts, pillar, rect, writePlan } from './common.mjs';
import { frostProp, frostShrine } from './frost-kit.mjs';

const prop = frostProp('kunlun');
// 玉京殿前西端（西墙 x 30）立瑶台神龛，龛口朝东对着横长的殿前；高度与三道门阙的门柱同为 9 m。
const exit = frostShrine('kunlun')(30, 15, 'east', 9);

// 开明兽庭：中央 60 m 方庭，四面各伸出一条 28 m 宽的翼
const cross = [[71, 34], [99, 34], [99, 50], [115, 50], [115, 66], [131, 66], [131, 94], [115, 94], [115, 110], [99, 110], [99, 128],
  [71, 128], [71, 110], [55, 110], [55, 94], [39, 94], [39, 66], [55, 66], [55, 50], [71, 50]];

await writePlan({
  id: 'frost-4-v2',
  revision: 'v2-slice-4',
  chapter: 'frost',
  index: 4,
  title: '开明九门',
  subtitle: '三门外庭 · 十字形开明兽庭 · 玉京殿前',
  identity: '《山海经》说昆仑有九门，由开明兽把守。宽阔的外庭北墙并列三道门：中门直入十字形的开明兽庭，九首巨像立在十字中央；西门通往玉库；东门进一条回廊，绕到十字庭的东翼，可以从侧面杀进兽庭。兽庭北翼连着横向展开的玉京殿前，出口在大殿西端。',
  objective: '突破外庭，从中门或东侧回廊进入开明兽庭并清场，最后击退玉京殿前的禁卫。',
  pacing: ['山门石阶：安全缓冲，望见外庭北墙的三道门', '九门外庭：第一战，狌狌、青鸟、豪彘同时上，抢东西门阙', '西门玉库：清场后可调查的藏宝间', '东门回廊：绕到开明兽庭东翼的侧路，可以从侧面进兽庭', '开明兽庭：第二战，旋龟绕着十字中央的巨像基座旋转，夫诸守在翼里射冰光', '玉京殿前：最终战，横向展开的殿前，精英旋龟沿殿前冲，狐巫立冰壁护着它，从大殿西端离开'],
  routeChoice: '外庭三门：中门是主路，西门玉库是死路藏宝点，东门回廊绕进兽庭东翼，形成一个回环，可以从侧面进兽庭。',
  encounterLogic: '开明九门把前三关学过的组合起来考。九门外庭：狌狌、青鸟、豪彘同时上，两座门阙是抢高点的关键。开明兽庭：十字形庭院四翼都能藏人，旋龟绕着巨像基座旋转反弹，夫诸守在十字的翼里隔着巨像射冰光；从东侧回廊绕进去可以先拔掉夫诸。玉京殿前：精英旋龟在横长的殿前来回冲，九尾狐巫立冰壁护着它，青鸟与豪彘封住走位；先打碎铜镜，再等旋龟翻倒。后一场要求前一场已清空。',
  artBrief: 'V2：昆仑雪墟建筑套件，三座青铜门阙、开明兽巨像（地标）、回廊与玉京大殿；当前为白盒。',
  whiteboxChecks: ['外庭北墙三道门：中门约 13 m，侧门约 8 m', '东门回廊与中门形成回环', '开明兽巨像基座 2.5 m，南北两道台阶'],
  bounds: [170, 190],
  rooms: [
    { id: 'steps', label: '山门石阶', polygon: [[72, 172], [98, 172], [102, 178], [98, 186], [72, 186], [68, 178]], labelAt: [85, 180] },
    { id: 'outer', label: '九门外庭', polygon: rect(14, 128, 156, 160), labelAt: [130, 154] },
    { id: 'treasury', label: '西门玉库', polygon: rect(30, 108, 50, 128), labelAt: [40, 116] },
    { id: 'cloister', label: '东门回廊', polygon: rect(120, 94, 140, 128), labelAt: [134, 110] },
    { id: 'cross', label: '开明兽庭', polygon: cross, labelAt: [62, 104] },
    { id: 'hall', label: '玉京殿前', polygon: rect(30, 4, 140, 26), labelAt: [120, 24] },
  ],
  passages: [
    { id: 'p1', from: 'steps', to: 'outer', points: [[85, 172], [85, 160]], width: 12, kind: 'main', note: '石阶直上外庭，正对中门' },
    { id: 'p2', from: 'outer', to: 'cross', points: [[85, 134], [85, 122]], width: 12, kind: 'main', note: '中门直入开明兽庭南翼，望见巨像' },
    { id: 'p3', from: 'cross', to: 'hall', points: [[85, 34], [85, 26]], width: 12, kind: 'main', note: '兽庭北翼登上玉京殿前' },
    { id: 'p4', from: 'outer', to: 'treasury', points: [[40, 134], [40, 122]], width: 7, kind: 'optional', note: '西门通往玉库' },
    { id: 'p5', from: 'outer', to: 'cloister', points: [[130, 134], [130, 122]], width: 7, kind: 'return', note: '东门进入回廊' },
    { id: 'p6', from: 'cloister', to: 'cross', points: [[126, 100], [126, 88]], width: 7, kind: 'return', note: '回廊北端绕进兽庭东翼' },
  ],
  entry: { room: 'steps', at: [85, 180] },
  exit: { room: 'hall', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'outer-que-west', label: '西门阙', rect: [18, 134, 30, 152], height: 3.5, stairs: [{ side: 'east', width: 4 }] },
    { id: 'outer-que-east', label: '东门阙', rect: [140, 134, 152, 152], height: 3.5, stairs: [{ side: 'west', width: 4 }] },
    { id: 'cross-statue', label: '开明兽巨像基座', rect: [77, 72, 93, 88], height: 2.5, stairs: [{ side: 'north', width: 4 }, { side: 'south', width: 4 }] },
    { id: 'cross-west', label: '西翼钟台', rect: [41, 70, 51, 90], height: 2, stairs: [{ side: 'east', width: 4 }] },
    { id: 'hall-platform', label: '大殿月台', rect: [62, 6, 108, 12], height: 3, stairs: [{ side: 'south', offset: -14, width: 4 }, { side: 'south', offset: 14, width: 4 }] },
    { id: 'hall-gallery', label: '东侧回廊台', rect: [126, 8, 136, 22], height: 2, stairs: [{ side: 'west', width: 4 }] },
  ],
  covers: [
    // 九门外庭：三道门、门阙之间的石柱与低墙
    ...gatePosts('x', 30, 20, 128, 'south'), ...gatePosts('x', 69, 32, 128, 'south'), ...gatePosts('x', 120, 20, 128, 'south'),
    pillar(56, 150), pillar(114, 150), pillar(85, 146, 2.4, 5), cover(64, 140, 70, 141.2, LOW), cover(100, 140, 106, 141.2, LOW),
    // 西门玉库：两座玉器架
    cover(32, 112, 34.6, 116, LOW), cover(45.4, 112, 48, 116, LOW),
    // 东门回廊：廊柱
    pillar(126, 112, 1.6, 4.5), pillar(134, 104, 1.6, 4.5),
    // 开明兽庭：巨像四角的冰柱，旋壳在柱间反弹
    pillar(64, 60), pillar(106, 60), pillar(64, 100), pillar(106, 100), cover(78, 98, 84, 99.2, LOW),
    // 玉京殿前：殿前石柱与低墙
    pillar(50, 18), pillar(114, 20), cover(60, 20, 66, 21.2, LOW), cover(104, 20, 110, 21.2, LOW),
    // —— 陈设（各取自房间的故事）——
    // 九门外庭：朝圣者在南墙下扎的祈福帐篷（西边一顶带供品，东边一顶），混战时是门阙之外的全掩护；外庭铜鼎旁也堆着供品
    prop('stall', 44, 156, 'north'), prop('goods', 49.5, 157, 'north'), prop('stall', 124, 156, 'north'), prop('goods', 152.5, 157, 'west'),
    // 西门玉库：玉库秘藏两侧靠北墙堆满西王母的玉器
    prop('hoard', 36, 109.5, 'south'), prop('hoard', 44, 109.5, 'south'),
    // 东门回廊：侧路上两盏冰灯，一进东门就能看见回廊通向兽庭
    prop('brazier', 122, 120), prop('brazier', 138.5, 106),
    // 开明兽庭：九门守卫的断柱——南翼入口西侧一截（进庭时挡夫诸的冰光），东翼一截（从回廊绕进来先拔夫诸时的掩体）
    prop('ruin', 75.5, 116, 'east'), prop('ruin', 121, 72, 'west'),
    // 玉京殿前：西端神龛与龛前一对冰灯
    ...exit.covers, prop('brazier', 38, 8.5), prop('brazier', 38, 21.5),
  ],
  encounters: [
    { id: 'A', at: [74, 146], room: 'outer', label: '九门混战', roster: '雪狌狌 4 + 三青鸟 2 + 冰棘豪彘 2：抢门阙', timing: '深入外庭触发', facing: [85, 156],
      squad: [['xingxing', 4], ['qingniao', 2], ['haozhi', 2]] },
    { id: 'B', at: [100, 80], room: 'cross', label: '巨像旋壳', roster: '冰甲旋龟 1 + 夫诸 1 + 雪狌狌 2：旋龟绕巨像旋转，夫诸在翼里射冰光', timing: '进入兽庭触发（中门或东翼都看得见触发点）', facing: [100, 96],
      squad: [['xuangui', 1], ['fuzhu', 1], ['xingxing', 2]], requires: ['A'] },
    { id: 'C', at: [85, 18], room: 'hall', label: '玉京禁卫', roster: '精英冰甲旋龟 1 + 九尾狐巫 1 + 三青鸟 2 + 冰棘豪彘 2：先碎铜镜，再等旋龟翻倒', timing: '登上殿前触发', facing: [85, 24],
      squad: [['xuangui', 1, true], ['fox_witch', 1], ['qingniao', 2], ['haozhi', 2]], requires: ['B'] },
  ],
  rewards: [
    { at: [148, 156], room: 'outer', label: '外庭铜鼎', reward: 'coins', requires: ['A'] },
    { at: [40, 112], room: 'treasury', label: '玉库秘藏', reward: 'scroll', requires: ['A'] },
    { at: [46, 15], room: 'hall', label: '殿前供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [85, 180], to: [85, 128], label: '石阶正对中门' },
    { from: [85, 122], to: [85, 80], label: '中门望见开明兽巨像' },
    { from: [126, 88], to: [85, 80], label: '东翼侧面望见巨像' },
    { from: [85, 34], to: [36, 15], label: '北翼登殿望见大殿西端出口' },
  ],
  notes: [
    { at: [85, 80], text: '开明兽巨像基座 2.5 m，四角冰柱让旋壳来回反弹' },
    { at: [130, 110], text: '东门回廊：外庭与兽庭东翼之间的回环' },
  ],
});
