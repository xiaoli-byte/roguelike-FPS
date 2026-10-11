// V2 floor plan: 霜山第 2 关「冰瀑栈道」。冰河峡谷把场地切成两岸：西岸冰瀑台 → 过桥到东岸栈道坪 → 绕北桥回到瀑顶冰潭。
// node scripts/level-plans/v2/frost-2.mjs  → 写入 docs/level-design/plans-v2/frost.json，再运行 whitebox:sync。
// 怪物：第二章定稿阵容（见 docs/art/enemy-roster-v2.md 第二章）。
import { FULL, LOW, cover, ngon, pillar, rect, writePlan } from './common.mjs';
import { frostProp, frostShrine } from './frost-kit.mjs';

const prop = frostProp('kunlun');
// 冰潭北缘（十边形正北的一条直边，y 7.17）立瑶台神龛，龛口朝南；高度取本关最高掩体 5 m，不抬高外墙。
const exit = frostShrine('kunlun')(7.17, 68, 'south', 5);

await writePlan({
  id: 'frost-2-v2',
  revision: 'v2-slice-2',
  chapter: 'frost',
  index: 2,
  title: '冰瀑栈道',
  subtitle: '冰河峡谷两岸 · 西岸冰瀑台、东岸栈道坪与瀑顶冰潭',
  identity: '一条冻住的冰河把峡谷劈成两岸，路线在两岸之间来回：先在西岸冰瀑台下作战，过冰桥到东岸贴崖的栈道坪，再沿北桥绕回西侧，登上冰瀑顶上的圆形冰潭。两岸隔着峡谷互相看得见，青鸟可以越过峡谷追人；冰瀑背后藏着一处冰窟。',
  objective: '清空西岸冰瀑台与东岸栈道坪，在瀑顶冰潭击退守军，从冰潭北缘离开。',
  pacing: ['冰河渡口：安全缓冲，望见对岸的栈道', '西岸冰瀑台：第一战，冰鲸困在瀑下冰潭里往天上喷冰柱，冻鲛人沿岸投矛、成群突刺', '冰瀑后冰窟：清场后可调查的藏宝洞', '东岸栈道坪：第二战，过桥后九尾狐巫立冰壁改变掩体，青鸟在贴崖高栈道上空盯人', '瀑顶冰潭：最终战，圆形冰潭没有角落可躲，冰河豚从空中俯冲、冰棘豪彘在地面冲锋，两种自爆一高一低，从北缘离开'],
  routeChoice: '主线在两岸之间来回：西岸 → 冰桥 → 东岸 → 北桥 → 瀑顶；冰瀑背后的冰窟是死路藏宝点。',
  encounterLogic: '冰瀑栈道的三场各改变一次场地。西岸冰瀑台：北冥的生物第一次出现，冰鲸困在瀑下冰潭里把冰柱喷上天再砸下来，落点长出冰棱把岸边分割开，冻鲛人借着冰棱投矛、成群突刺。东岸栈道坪：九尾狐巫第一次出现，在栈道坪上立起冰壁，掩体一直在变，青鸟从高栈道上空盯着。瀑顶冰潭：圆形冰潭没有墙角可以背靠，冰河豚从空中俯冲鼓气、冰棘豪彘在地面冲锋炸刺，一高一低两种自爆同时逼近，躲了地面的就要抬头看天上的。后一场要求前一场已清空。',
  artBrief: 'V2：昆仑雪墟建筑套件，冰河峡谷、冰桥、贴崖木栈道、冰瀑（大型冰挂地标）与瀑顶冰潭；当前为白盒。',
  whiteboxChecks: ['两座冰桥横跨峡谷，桥宽 12 m', '三个战斗场地各有可经台阶到达的高台', '瀑顶冰潭为圆形，中央冰台 2 m'],
  bounds: [200, 130],
  rooms: [
    { id: 'ford', label: '冰河渡口', polygon: [[8, 102], [28, 100], [32, 108], [30, 120], [12, 124], [6, 114]], labelAt: [18, 112] },
    { id: 'west', label: '西岸冰瀑台', polygon: [[38, 68], [82, 62], [90, 74], [90, 118], [62, 124], [38, 118]], labelAt: [72, 116] },
    { id: 'cave', label: '冰瀑后冰窟', polygon: rect(8, 62, 32, 86), labelAt: [20, 74] },
    { id: 'east', label: '东岸栈道坪', polygon: [[108, 60], [150, 52], [192, 58], [194, 112], [150, 120], [108, 112]], labelAt: [150, 112] },
    { id: 'basin', label: '瀑顶冰潭', polygon: ngon(68, 30, 24, 24, 10), labelAt: [52, 20] },
  ],
  passages: [
    { id: 'p1', from: 'ford', to: 'west', points: [[30, 112], [38, 112]], width: 12, kind: 'main', note: '渡口登上西岸，冰瀑在左手' },
    { id: 'p2', from: 'west', to: 'east', points: [[90, 96], [108, 96]], width: 12, kind: 'main', note: '冰桥横跨峡谷，桥上望见东岸高栈道' },
    { id: 'p3', from: 'east', to: 'basin', points: [[116, 58], [116, 38], [89, 38]], width: 12, kind: 'main', note: '东岸北口转上北桥，绕回西侧登上瀑顶' },
    { id: 'p4', from: 'west', to: 'cave', points: [[38, 76], [32, 76]], width: 7, kind: 'optional', note: '冰瀑背后的冰窟，入口藏在瀑下岩台旁' },
  ],
  entry: { room: 'ford', at: [18, 112] },
  exit: { room: 'basin', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'west-shelf', label: '冰瀑岩台', rect: [42, 74, 54, 102], height: 3, stairs: [{ side: 'east', offset: -8, width: 4 }, { side: 'east', offset: 8, width: 4 }] },
    { id: 'west-boulder', label: '落冰巨石', rect: [72, 98, 82, 108], height: 2, stairs: [{ side: 'north', width: 4 }] },
    { id: 'east-gallery', label: '贴崖高栈道', rect: [176, 64, 188, 104], height: 3.5, stairs: [{ side: 'west', offset: -10, width: 4 }, { side: 'west', offset: 10, width: 4 }] },
    { id: 'east-pavilion', label: '茶亭台', rect: [128, 66, 140, 76], height: 2.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'basin-floe', label: '潭心冰台', rect: [60, 22, 76, 36], height: 2, stairs: [{ side: 'west', width: 4 }, { side: 'east', width: 4 }] },
  ],
  covers: [
    // 西岸冰瀑台：落冰、低墙
    pillar(66, 82), pillar(80, 76, 2.4, 5), cover(60, 110, 66, 111.2, LOW), cover(62, 68, 68, 69.2, LOW),
    // 冰瀑后冰窟：两座冻住的供桌
    cover(12, 66, 16, 68.6, LOW), cover(24, 66, 28, 68.6, LOW),
    // 东岸栈道坪：栈桩、低墙与全掩护
    pillar(140, 96), pillar(160, 72), pillar(156, 102, 2.4, 5),
    cover(146, 84, 152, 85.2, LOW), cover(122, 98, 123.2, 104, FULL), cover(164, 88, 165.2, 94, LOW),
    // 瀑顶冰潭：几根冰柱，没有墙角
    pillar(54, 42), pillar(84, 22), cover(62, 44, 68, 45.2, LOW),
    // —— 陈设（各取自房间的故事）——
    // 冰河渡口：渡口崖下一顶过路人歇脚的祈福帐篷（避开隔峡谷望东岸的视线）
    prop('stall', 14, 105, 'south'),
    // 西岸冰瀑台：鲸喷的冰柱砸断的一截玉柱横在渡口进来的路上，是躲鲛人投矛的第一道掩体；岸边冻箱旁一堆冻住的供品
    prop('ruin', 52, 112, 'north'), prop('goods', 86.5, 107, 'west'),
    // 冰瀑后冰窟：洞里的神龛——冰窟供奉旁一堆供品，洞底一盏冰灯
    prop('goods', 10.5, 79.5, 'east'), prop('brazier', 21, 84.5),
    // 东岸栈道坪：茶亭台下香客留下的供品；南侧崖下一顶祈福帐篷，在狐巫的冰壁之外给一处不会变的全掩护
    prop('goods', 125, 70, 'east'), prop('stall', 166, 110, 'north'),
    // 瀑顶冰潭：圆形冰潭保持没有墙角，只在北缘出口立神龛
    ...exit.covers,
  ],
  encounters: [
    { id: 'A', at: [70, 90], room: 'west', label: '瀑下鲸鲛', roster: '冰鲸 1 + 冻鲛人 4：冰柱雨把岸边分割开，鲛人借冰棱投矛突刺', timing: '深入西岸触发', facing: [46, 112],
      squad: [['ice_whale', 1], ['jiaoren', 4]] },
    { id: 'B', at: [152, 90], room: 'east', label: '栈道冰壁', roster: '九尾狐巫 1 + 雪狌狌 4 + 三青鸟 1：冰壁不断改变掩体，先打铜镜', timing: '深入东岸触发', facing: [118, 96],
      squad: [['fox_witch', 1], ['xingxing', 4], ['qingniao', 1]], requires: ['A'] },
    { id: 'C', at: [66, 46], room: 'basin', label: '冰潭双爆', roster: '冰河豚 3 + 冰棘豪彘 3：空中俯冲与地面冲锋两种自爆一高一低', timing: '登上瀑顶触发', facing: [84, 36],
      squad: [['ice_puffer', 3], ['haozhi', 3]], requires: ['B'] },
  ],
  rewards: [
    { at: [84, 112], room: 'west', label: '岸边冻箱', reward: 'coins', requires: ['A'] },
    { at: [16, 80], room: 'cave', label: '冰窟供奉', reward: 'scroll', requires: ['A'] },
    { at: [68, 16], room: 'basin', label: '冰潭供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [18, 112], to: [182, 84], label: '渡口隔着峡谷望见东岸高栈道' },
    { from: [108, 96], to: [48, 88], label: '东岸桥头回望西岸冰瀑' },
    { from: [89, 38], to: [68, 12], label: '北桥尽头望见冰潭北缘出口' },
  ],
  notes: [
    { at: [48, 88], text: '冰瀑岩台 3 m 贴着冰瀑，两道台阶' },
    { at: [99, 70], text: '冰河峡谷：两岸之间的冰河不可通行，只能走桥' },
  ],
});
