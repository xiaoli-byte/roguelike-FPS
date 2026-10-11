// V2 floor plan: 霜山第 1 关「玉阶雪关」。昆仑山门是一层层的白玉台地：之字形逐层仰攻，下层东行、中层西行，最后登上天门。
// node scripts/level-plans/v2/frost-1.mjs  → 写入 docs/level-design/plans-v2/frost.json，再运行 whitebox:sync。
// 怪物：第二章定稿阵容（2026-10-10，昆仑 A 方案 + 北冥 C 方案，docs/art/enemy-roster-v2.md 第二章）。
import { FULL, LOW, cover, gatePosts, pillar, rect, writePlan } from './common.mjs';
import { frostProp, frostShrine } from './frost-kit.mjs';

const prop = frostProp('kunlun');
// 天门即出口：瑶台神龛立在天门门洞里（背靠北墙 y 6，龛口朝南），传送门在龛口升起；高度与天门门柱同为 9 m。
const exit = frostShrine('kunlun')(6, 69, 'south', 9);

await writePlan({
  id: 'frost-1-v2',
  revision: 'v2-slice-1',
  chapter: 'frost',
  index: 1,
  title: '玉阶雪关',
  subtitle: '三层白玉台地 · 之字形仰攻天门',
  identity: '昆仑山门不是一座院子，而是一整面山坡上层层叠起的白玉台地。玩家在下层台由西向东横穿，从东端台阶登上中层台，再由东向西折返，最后登上收窄成漏斗的天门广场，出口就是天门本身。每一层的北缘都是上一层的挡土墙，狌狌会从上面翻下来；中层台完全露天，青鸟从山上俯冲。',
  objective: '逐层攻上三层台地，击退天门广场的守军，穿过天门离开。',
  pacing: ['山道入口：安全缓冲，仰望层层台地', '下层台：第一战，一大群雪狌狌从挡墙月台上翻下来，自西向东横穿', '中层台：第二战，露天长台，三只青鸟从山上压下，自东向西折返', '东崖钟亭：中层台东端一条崖边小径通往钟亭藏宝', '天门广场：最终战，漏斗形广场越走越窄，冰甲旋龟在围墙间旋转反弹，穿过天门离开'],
  routeChoice: '之字形单线：下层东行 → 中层西行 → 天门；中层台东端崖边小径通往钟亭，是死路藏宝点。',
  encounterLogic: '第一关一场只教一件事。下层台：只有一大群雪狌狌，它们会翻上挡墙月台追人，让玩家知道高台不再安全。中层台：三只青鸟在露天长台上空盘旋，第一次要抬头打飞行怪，两只狌狌在地面骚扰。天门广场：第一次见冰甲旋龟，越来越窄的漏斗广场让旋壳频繁反弹，两只豪彘的冰刺逼人离开掩体。后一场要求前一场已清空。',
  artBrief: 'V2：昆仑雪墟建筑套件，白玉台基挡墙、积雪石阶、青铜门阙（天门）；当前为白盒。',
  whiteboxChecks: ['三层台地之字形相连，每层从一端进、另一端出', '每层台地都有可经台阶到达的高台', '天门门洞约 11 m，出口在门洞内'],
  bounds: [150, 152],
  rooms: [
    { id: 'trail', label: '山道入口', polygon: [[8, 130], [30, 128], [34, 136], [30, 146], [10, 148], [6, 140]], labelAt: [18, 140] },
    { id: 'lower', label: '下层台', polygon: rect(10, 96, 140, 122), labelAt: [24, 102] },
    { id: 'middle', label: '中层台', polygon: rect(16, 58, 144, 86), labelAt: [100, 80] },
    { id: 'bell', label: '东崖钟亭', polygon: rect(122, 30, 142, 50), labelAt: [132, 40] },
    { id: 'plaza', label: '天门广场', polygon: [[46, 6], [92, 6], [112, 46], [26, 46]], labelAt: [64, 44] },
  ],
  passages: [
    { id: 'p1', from: 'trail', to: 'lower', points: [[20, 130], [20, 122]], width: 12, kind: 'main', note: '山道登上下层台西端' },
    { id: 'p2', from: 'lower', to: 'middle', points: [[132, 96], [132, 86]], width: 12, kind: 'main', note: '下层台东端的大台阶登上中层台' },
    { id: 'p3', from: 'middle', to: 'plaza', points: [[34, 58], [34, 46]], width: 12, kind: 'main', note: '中层台西端的大台阶登上天门广场' },
    { id: 'p4', from: 'middle', to: 'bell', points: [[132, 58], [132, 50]], width: 7, kind: 'optional', note: '中层台东端的崖边小径，通往钟亭' },
  ],
  entry: { room: 'trail', at: [18, 140] },
  exit: { room: 'plaza', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'lower-stage', label: '挡墙月台', rect: [56, 98, 94, 106], height: 3, stairs: [{ side: 'south', offset: -12, width: 4 }, { side: 'south', offset: 12, width: 4 }] },
    { id: 'lower-east', label: '东端石台', rect: [124, 108, 136, 120], height: 2, stairs: [{ side: 'west', width: 4 }] },
    { id: 'middle-watch', label: '中层望台', rect: [104, 60, 116, 70], height: 3.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'middle-west', label: '西端石台', rect: [42, 72, 54, 84], height: 2.5, stairs: [{ side: 'east', width: 4 }] },
    { id: 'plaza-drum', label: '鼓楼台', rect: [34, 30, 44, 42], height: 3.5, stairs: [{ side: 'east', width: 4 }] },
    { id: 'plaza-step', label: '东侧玉阶', rect: [90, 32, 100, 42], height: 2, stairs: [{ side: 'west', width: 4 }] },
  ],
  covers: [
    // 下层台：两根石柱、低墙
    pillar(36, 110), pillar(110, 104), cover(70, 114, 76, 115.2, LOW), cover(100, 116, 106, 117.2, LOW),
    // 中层台：露天长台上零星的掩护，挡不住头顶
    pillar(90, 72), pillar(64, 64), cover(76, 78, 82, 79.2, LOW), cover(122, 64, 123.2, 70, FULL), cover(28, 64, 34, 65.2, LOW),
    // 东崖钟亭：两座冻住的铜钟
    pillar(128, 36, 3, 3), pillar(136, 36, 3, 3),
    // 天门广场：天门门柱、广场上的石柱与低墙
    ...gatePosts('x', 55, 28, 6, 'south'),
    pillar(56, 26), pillar(80, 20, 2.4, 5), cover(60, 36, 66, 37.2, LOW),
    // —— 陈设（各取自房间的故事）——
    // 山道入口：朝山人的路，台阶脚下一对冰灯把视线引上台地，路边留着一堆冻住的供品
    prop('brazier', 12.5, 131.5), prop('brazier', 27.5, 131.5), prop('goods', 29, 141.5, 'west'),
    // 下层台：入口右手一顶朝山人的祈福帐篷（让开仰望月台的视线），是狌狌群扑下来时的第一处全掩护；东段一截被狌狌推下挡墙的玉柱
    prop('stall', 40, 119.5, 'north'), prop('ruin', 112, 113, 'north'),
    // 中层台：露天长台保持空旷，只在东端崖边小径口点一盏冰灯，提示钟亭藏在那里
    prop('brazier', 124.5, 60),
    // 东崖钟亭：两座冻钟之间一盏冰灯照着亭子，钟亭供奉两侧堆着冻住的供品
    prop('brazier', 132, 32), prop('goods', 126, 45, 'east'), prop('goods', 138, 45, 'west'),
    // 天门广场：天门内的神龛与门前一对冰灯；天门供箱旁是献给西王母的玉器堆（贴着东缘，旋壳在这里反弹）
    ...exit.covers, prop('brazier', 59, 13), prop('brazier', 79, 13), prop('hoard', 91, 24, 'west'),
  ],
  encounters: [
    { id: 'A', at: [80, 112], room: 'lower', label: '月台狌狌群', roster: '雪狌狌 6：会翻上挡墙月台追人，高台不再安全', timing: '深入下层台触发', facing: [26, 112],
      squad: [['xingxing', 6]] },
    { id: 'B', at: [80, 70], room: 'middle', label: '露天青鸟', roster: '三青鸟 3 + 雪狌狌 2：第一次抬头打飞行怪', timing: '深入中层台触发', facing: [130, 78],
      squad: [['qingniao', 3], ['xingxing', 2]], requires: ['A'] },
    { id: 'C', at: [70, 26], room: 'plaza', label: '天门旋龟', roster: '冰甲旋龟 1 + 冰棘豪彘 2：漏斗广场里旋壳频繁反弹，冰刺逼人离开掩体', timing: '深入天门广场触发', facing: [38, 42],
      squad: [['xuangui', 1], ['haozhi', 2]], requires: ['B'] },
  ],
  rewards: [
    { at: [130, 100], room: 'lower', label: '台下香炉', reward: 'coins', requires: ['A'] },
    { at: [132, 44], room: 'bell', label: '钟亭供奉', reward: 'scroll', requires: ['B'] },
    { at: [84, 30], room: 'plaza', label: '天门供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [18, 140], to: [75, 102], label: '山道仰望挡墙月台' },
    { from: [132, 86], to: [48, 78], label: '中层台东端望见整条长台' },
    { from: [34, 46], to: [69, 8], label: '广场入口正对天门' },
  ],
  notes: [
    { at: [75, 102], text: '挡墙月台 3 m：上一层的挡土墙脚下，狌狌从这里翻下来' },
    { at: [69, 8], text: '天门门洞约 11 m，出口传送门在门洞内' },
  ],
});
