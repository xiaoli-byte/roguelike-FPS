// V2 floor plan: 火狱第 4 关「鼓风正殿」。同一座鼓风正殿要打两次：第一次穿过它去北面熔渊上的悬炉锻台，
// 在悬炉拉开风闸，沿东风道绕回来时，正殿的风箱已经鼓起来、炉门大开，换了一批守军，出口就在殿西的炉门里。
// node scripts/level-plans/v2/inferno-4.mjs  → 写入 docs/level-design/plans-v2/inferno.json，再运行 whitebox:sync。
//
// 怪物：第三章阵容表（docs/art/enemy-roster-v2.md「第三章 · 祝融火狱 — 阵容表」，2026-10-11 设计稿待审）尚未实装，
// 怪物：第三章阵容（2026-10-11 用户确认，docs/art/enemy-roster-v2.md 第三章），squad 用正式敌人 id。
import { LOW, arena, cover, pillar, rect, writePlan } from './common.mjs';
import { ding, lavaPool, lintLava, prop, shrine } from './inferno-kit.mjs';

// 出口：正殿南墙西段的祝融火门神龛，面朝北，在殿西大炉炉坛的东南。
const exit = shrine(136, 46, 'north', 6);

const plan = {
  id: 'inferno-4-v2',
  revision: 'v2-slice-4',
  chapter: 'inferno',
  index: 4,
  title: '鼓风正殿',
  subtitle: '打两次的鼓风正殿 · 熔渊悬炉锻台 · 东风道回环',
  identity: '祝融的大炉靠一座鼓风正殿供风：殿里卧着两台巨型风箱，把大殿分成南北两条风箱道，殿西是大炉的炉门。玩家从南门进殿，先打一场；穿过北门的链桥，登上吊在熔渊上的悬炉锻台，拉开风闸；再沿锻台东侧的链桥进入东风道，顺着风道绕回正殿东北角。这时风箱已经鼓起来，炉门大开，殿里换了一批守军——同一座殿，第二次从另一个门进来，打的是另一场仗，出口就是殿西的炉门。',
  objective: '穿过鼓风正殿，在熔渊悬炉拉开风闸，沿东风道绕回正殿，击退炉门守军，从炉门离开。',
  pacing: ['南耳室：安全缓冲，望见正殿两台巨型风箱', '鼓风正殿（一）：第一战，熔炉铁牛在风箱道里推进，吸气把人沿风箱道往它那边拉', '链桥与悬炉锻台：第二战，锻台吊在熔渊上，四面无墙；毕方立在四根吊链柱顶，马面狱卒甩钩把人拖出铁砧', '东风道：隔着熔渊回望悬炉，风道里有炉工的私藏', '鼓风正殿（二）：最终战，风箱鼓起，炉门喷出的火落在风箱道上，祸斗吃火变强，傩巫金面加速，神火飞鸦从殿顶俯冲；胜利后从炉门离开'],
  routeChoice: '推荐路线是一个回环：正殿 → 链桥 → 悬炉 → 东风道 → 正殿。也可以从悬炉原路走链桥回殿，近但拿不到风道私藏，而且是从北门进殿，正对炉门守军；走风道是从东北角进殿，先到东侧检修台的高处。',
  encounterLogic: '一座殿打两次，两次的问题不一样。鼓风正殿（一）：熔炉铁牛第一次在室内出现，两台巨型风箱把殿分成南北两条长风箱道，正好是铁牛吸气拉人的直线；顶着吸力往它胸口的炉门里打能把它呛倒，打不断就被熔铁扇面喷一脸，喷出的熔铁冷成铁渣墙，会把风箱道堵死一段。炭童从风箱两头包抄。悬炉锻台：锻台吊在熔渊上，四面没有墙，四根 6 m 吊链柱是毕方的栖点，它们单足立在柱顶点射；马面狱卒甩勾魂索，把躲在铁砧台后面的人拖到锻台边、拖进炭童堆。打链子挣脱，打锁芯缴械，打毕方的腿把它打下来。鼓风正殿（二）：风闸拉开后风箱鼓起，炉门喷出的火落在两条风箱道上（目标：火区运行时）；祸斗第一次和傩巫同场，它们去吃地上的火和炭堆，吃过就喷火；傩巫跳金面时祸斗更快还回血，先打碎金面；神火飞鸦从殿顶排烟口成群俯冲，在空中打爆一只会连环炸到旁边的。后一场要求前一场已清空。',
  artBrief: 'V2（祝融火狱建筑套件 SM_Tripo_Inferno*，本机 Hunyuan3D，熔岩缝 / 炭火自发光）：玄铁鼓风正殿（两台巨型皮风箱、殿西大炉炉门、殿顶排烟口）、北门外熔渊（熔岩地面，没有挡墙，熔岩光从深处照上来）、四根吊链柱吊着的悬炉锻台与铁砧、铁链桥、东风道里的风轮与风管。',
  whiteboxChecks: ['正殿 110 x 48 m，两台风箱 18 x 8 m、高 5 m，南北风箱道各宽约 20 m', '主连接（南门、链桥、风道链桥、风道南口）合计不超过 80 m', '每场战斗的场地都有可经台阶到达的高台，悬炉铁砧台离熔渊至少 10 m', '悬炉四根吊链柱 6 m（毕方栖点）'],
  bounds: [166, 160],
  rooms: [
    { id: 'porch', label: '南耳室', polygon: rect(62, 140, 98, 156), labelAt: [90, 150] },
    { id: 'hall', label: '鼓风正殿', polygon: arena(28, 88, 138, 136, 8), labelAt: [80, 132] },
    { id: 'forge', label: '悬炉锻台', polygon: arena(57, 26, 103, 68, 8), labelAt: [70, 60] },
    { id: 'duct', label: '东风道', polygon: rect(118, 20, 150, 76), labelAt: [140, 60] },
  ],
  passages: [
    { id: 'p1', from: 'porch', to: 'hall', points: [[80, 141], [80, 134]], width: 12, kind: 'main', note: '南门直入正殿，两台风箱之间' },
    { id: 'p2', from: 'hall', to: 'forge', points: [[80, 89], [80, 67]], width: 10, kind: 'main', note: '北门外的铁链桥，横过熔渊登上悬炉' },
    { id: 'p3', from: 'forge', to: 'duct', points: [[101, 47], [120, 47]], width: 10, kind: 'main', note: '悬炉东侧链桥，进东风道' },
    { id: 'p4', from: 'duct', to: 'hall', points: [[134, 75], [134, 93]], width: 10, kind: 'main', note: '风道南口回到正殿东北角，先到东侧检修台' },
  ],
  entry: { room: 'porch', at: [72, 150] },
  exit: { room: 'hall', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3', 'p4'],
  platforms: [
    { id: 'hall-furnace', label: '炉坛', rect: [31, 102, 39, 122], height: 3.5, stairs: [{ side: 'east', width: 4 }] },
    { id: 'hall-service', label: '风箱检修台', rect: [124, 104, 134, 120], height: 3, stairs: [{ side: 'west', width: 4 }] },
    { id: 'forge-anvil', label: '铁砧台', rect: [74, 40, 86, 50], height: 3, stairs: [{ side: 'west', width: 4 }, { side: 'east', width: 4 }] },
  ],
  // 熔渊：北门外一个半径 38 m 的圆，圆内除了悬炉、链桥和风道都是熔渊；圆和正殿之间隔着 4 m 殿墙。
  voids: [lavaPool('abyss', '熔渊', [80, 46], 38)],
  // 第二次进殿时的火区（目标运行时，白盒仍是可走地面）：炉门喷火沿两条风箱道落下，祸斗来吃。
  hazards: [
    { id: 'flame-north', label: '北风箱道火区', kind: 'flame', points: [[46, 102], [116, 102]], width: 4, note: '仅第二次进殿（C）时：炉门周期性喷火，沿风箱道落成火区烧 4 秒；祸斗跑来吃火' },
    { id: 'flame-south', label: '南风箱道火区', kind: 'flame', points: [[46, 122], [116, 122]], width: 4, note: '仅第二次进殿（C）时：与北道交替喷火' },
  ],
  covers: [
    // 鼓风正殿：两台巨型风箱（5 m）分出南北风箱道；风箱道里各两道矮墙，中央十字口两只青铜鼎
    cover(50, 108, 68, 116, 5), cover(92, 108, 110, 116, 5),
    cover(56, 96, 62, 97.2, LOW), cover(98, 96, 104, 97.2, LOW), cover(56, 127, 62, 128.2, LOW), cover(98, 127, 104, 128.2, LOW),
    ding(72, 100), ding(88, 124), prop('brazier', 43, 96), prop('goods', 116, 131, 'west'),
    // 悬炉锻台：四根 6 m 吊链柱（毕方栖点），两道矮墙，一座锻台
    pillar(64, 33, 2, 6), pillar(96, 33, 2, 6), pillar(64, 61, 2, 6), pillar(96, 61, 2, 6),
    cover(63.5, 44, 64.7, 50, LOW), cover(95.3, 38, 96.5, 44, LOW), prop('stall', 80, 33, 'south'),
    // 东风道：风轮残骸、风管、炉工的私藏
    prop('ruin', 140, 34, 'west'), prop('goods', 128, 66, 'north'), prop('hoard', 144, 24, 'west'), pillar(132, 50, 2, 4.5),
    // 南耳室：两座火坛
    prop('brazier', 66, 144), prop('brazier', 94, 144),
    // 出口神龛
    ...exit.covers,
  ],
  encounters: [
    { id: 'A', at: [80, 100], room: 'hall', label: '风箱道铁牛', roster: '熔炉铁牛 1 + 炭童 4：吸气沿风箱道拉人，顶着吸力打炉门；喷出的铁渣墙会堵住风箱道', timing: '深入正殿触发（第一次）', facing: [80, 128],
      squad: [['iron_ox', 1], ['tantong', 4]] },
    { id: 'B', at: [72, 31], room: 'forge', label: '悬炉钩索', roster: '毕方 2 + 马面狱卒 1 + 炭童 2：毕方立在吊链柱顶，马面把人从铁砧台后拖到锻台边', timing: '登上悬炉锻台触发', facing: [80, 62],
      squad: [['bifang', 2], ['mamian', 1], ['tantong', 2]], requires: ['A'] },
    { id: 'C', at: [48, 126], room: 'hall', label: '炉门守军', roster: '祸斗 3 + 变脸傩巫 1 + 神火飞鸦 3：祸斗吃风箱道上的火，先碎傩巫金面；飞鸦从殿顶俯冲', timing: '悬炉清空后回到正殿触发（北门或东北角）', facing: [104, 100],
      squad: [['huodou', 3], ['nuo', 1], ['fire_crow', 3]], requires: ['B'] },
  ],
  rewards: [
    { at: [124, 130], room: 'hall', label: '风箱下的铜钱', reward: 'coins', requires: ['A'] },
    { at: [144, 30], room: 'duct', label: '风道炉工私藏', reward: 'scroll', requires: ['B'] },
    { at: [60, 132], room: 'hall', label: '炉门供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [72, 150], to: [80, 112], label: '南耳室正对两台风箱之间的十字口' },
    { from: [80, 89], to: [80, 45], label: '北门望见熔渊上的悬炉' },
    { from: [120, 47], to: [80, 45], label: '风道链桥回望悬炉' },
    { from: [134, 93], to: [36, 129], label: '风道南口斜望殿西炉门' },
  ],
  notes: [
    { at: [80, 112], text: '两台巨型风箱：第二次进殿时鼓起来；以后可做火区运行时——炉门喷火沿两条风箱道落成火区' },
    { at: [80, 46], text: '熔渊（半径 38 m）：熔岩地面，没有挡墙；悬炉、链桥与风道之外都是熔渊' },
    { at: [36, 112], text: '炉坛 3.5 m：殿西大炉炉门前的高台，出口在炉门里' },
  ],
};

lintLava(plan);
await writePlan(plan);
