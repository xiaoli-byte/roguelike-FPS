// V2 floor plan: 霜山第 5 关「北冥冰台」（首领关）。雪岭营地 → 转一次弯的冰崖通道 → 绕着中央北冥冰窟一整圈的环形祭台。
// node scripts/level-plans/v2/frost-5.mjs  → 写入 docs/level-design/plans-v2/frost.json，再运行 whitebox:sync。
// 首领：鲲鹏 boss_kunpeng（鲲 / 鹏两个形态，src/enemies/bosses/KunPeng.ts）。
import { LOW, cover, pillar, rect, ring, writePlan } from './common.mjs';
import { frostProp, frostShrine } from './frost-kit.mjs';

const prop = frostProp('sea');
// 环台南缘（外圈十六边形正南的顶点 y 100，两侧边在龛宽处约 y 99.24）立冰窟神龛，龛口朝北；高度取冰柱的 6 m。
const exit = frostShrine('sea')(99.25, 80, 'north', 6);

// 营地的补给货箱（商人摊位 8 m 内保持空旷）
const crate = (x, y) => cover(x - 1, +(y - 1.3).toFixed(2), x + 1, +(y + 1.3).toFixed(2), 2.5);

await writePlan({
  id: 'frost-5-v2',
  revision: 'v2-slice-5',
  chapter: 'frost',
  index: 5,
  title: '北冥冰台',
  subtitle: '雪岭营地 · 环绕北冥冰窟的环形祭台',
  identity: '昆仑之北就是北冥。冰台是绕着中央冰窟一整圈的环形祭台：北冥的冰海从中间破开，鲲在冰窟里醒来，从冰窟各个方向探头扑咬，整场战斗都在绕着冰窟转；打到一半鲲沉入冰窟，冰海炸开，化成巨鹏升空，在环台上空盘旋俯冲。环台宽约 28 m，没有角落可以背靠。营地在西南方的低处，看不到冰台。',
  objective: '在营地整备，沿冰崖登上环形冰台，击败鲲与化身后的鹏，从南缘离开。',
  pacing: ['雪岭营地：安全整备，商人摊位与补给', '冰崖通道：一次转向，营地看不到祭台', '北冥冰台：首领战，一阶段鲲从中央冰窟各个方向探头扑咬、吞吸，二阶段化鹏升空扇风俯冲，四根冰柱与东西祭台是掩体，胜利后南缘出口开启'],
  routeChoice: '单线：营地 → 冰崖通道 → 环形祭台；无支路。',
  encounterLogic: '登上环台后触发首领，营地与通道内购物、停留都不会触发。鲲从冰窟北侧第一次探头；一阶段要绕着冰窟找它探头的位置，二阶段鹏在空中，柱子和祭台挡风、躲俯冲。',
  artBrief: 'V2：北冥冰海风格，环形冰台、中央破开的冰窟（不可通行的空洞，只有透明挡墙，冰海与首领的特效从中露出）、冰柱与鲸骨；当前为白盒。',
  whiteboxChecks: ['营地商人摊位 8 m 内无遮挡', '环台外径 44 m、内径 15 m，绕冰窟一整圈', '通道宽 10 m，一次转向，营地不可直视祭台'],
  bounds: [130, 130],
  rooms: [
    { id: 'preparation', label: '雪岭营地', polygon: rect(4, 90, 40, 126), labelAt: [32, 122] },
    { id: 'arena', label: '北冥冰台', polygon: ring(80, 56, 44, 15, 16), labelAt: [80, 94] },
  ],
  passages: [
    { id: 'p1', from: 'preparation', to: 'arena', points: [[40, 100], [52, 100], [52, 86]], width: 10, kind: 'main', note: '营地东门出，沿冰崖转一次弯从西南登上环台' },
  ],
  entry: { room: 'preparation', at: [12, 120] },
  exit: { room: 'arena', at: exit.exit },
  mainRoute: ['p1'],
  preparation: { room: 'preparation', at: [22, 110], facing: [22, 118], label: '北冥冰台前补给' },
  platforms: [
    { id: 'arena-altar-west', label: '西祭台', rect: [40, 49, 48, 63], height: 2.5, stairs: [{ side: 'east', width: 4 }] },
    { id: 'arena-altar-east', label: '东祭台', rect: [112, 49, 120, 63], height: 2.5, stairs: [{ side: 'west', width: 4 }] },
  ],
  // 中央北冥冰窟：不可通行但不立高墙，只有一圈看不见、不挡子弹的挡墙，鲲从这里探头、鹏从这里升空。
  voids: [{ id: 'ice-hole', label: '北冥冰窟', center: [80, 56], radius: 15 }],
  covers: [
    // 雪岭营地：角落里的补给货箱
    crate(8, 95), crate(36, 95), crate(8, 122),
    // 北冥冰台：四根冰柱、两道冰脊低墙
    pillar(100.5, 35.5, 3, 6), pillar(59.5, 35.5, 3, 6), pillar(59.5, 76.5, 3, 6), pillar(100.5, 76.5, 3, 6),
    cover(78, 84, 84, 85.2, LOW), cover(96, 60, 97.2, 66, LOW),
    // —— 陈设（各取自房间的故事）——
    // 雪岭营地：北冥渔人的营地——西北角与东南角各一座毡房，毡房边的晒鱼架，营地东门（去冰崖）一盏鲸骨灯。
    // 商人摊位（22, 110）周围 8 m 见方保持空旷：陈设全在 x 14..30、y 102..118 之外。
    prop('stall', 9.5, 99.5, 'east'), prop('stall', 35.5, 121.5, 'west'), prop('goods', 31.5, 124, 'north'), prop('brazier', 37.5, 108),
    // 北冥冰台：东西祭台台前各一对鲸骨灯（让开台阶）；战后奖励旁是鲲鹏守着的珍珠鲸牙堆；南缘冰窟神龛。
    // 冰窟（半径 15 m）与环台走道上不放别的陈设，绕冰窟转圈的路线保持通畅。
    prop('brazier', 50, 49.5), prop('brazier', 50, 62.5), prop('brazier', 110, 49.5), prop('brazier', 110, 62.5),
    prop('hoard', 101, 90.5, 'west'), ...exit.covers,
  ],
  encounters: [
    { id: 'BOSS', at: [80, 20], room: 'arena', label: '鲲鹏', roster: '首领鲲鹏：鲲 → 化鹏；无额外常驻巡逻小队', timing: '登上环台后触发；击败后南缘出口开启', facing: [62, 80],
      squad: [['boss_kunpeng', 1]] },
  ],
  rewards: [
    { at: [96, 90], room: 'arena', label: '鲲鹏战后奖励', reward: 'upgrade', requires: ['BOSS'] },
  ],
  sightlines: [
    { from: [40, 100], to: [52, 100], label: '营地东门只看到冰崖转角，看不到祭台' },
    { from: [52, 86], to: [80, 20], label: '登台后中央冰窟里的冰雾挡住视线，看不见北侧的鲲' },
  ],
  notes: [
    { at: [80, 56], text: '中央北冥冰窟（半径 15 m）：鲲从这里探头，化鹏时冰海从这里炸开' },
  ],
});
