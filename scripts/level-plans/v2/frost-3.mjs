// V2 floor plan: 霜山第 3 关「瑶池冰湖」。枢纽结构：冰封的瑶池湖面居中，西岸祭坛与东岸船坞两场自选顺序，都清空后瑶台开启。
// node scripts/level-plans/v2/frost-3.mjs  → 写入 docs/level-design/plans-v2/frost.json，再运行 whitebox:sync。
// 怪物：第二章定稿阵容（见 docs/art/enemy-roster-v2.md 第二章）。
import { LOW, cover, ngon, pillar, writePlan } from './common.mjs';
import { frostProp, frostShrine } from './frost-kit.mjs';

const prop = frostProp('sea');
// 瑶台南缘（y 44 的直边，背后是湖岸山体）东段立冰窟神龛，龛口朝北对着瑶台；高度取本关最高掩体 4.5 m。
const exit = frostShrine('sea')(44, 124, 'north', 4.5);

// 瑶台：开口朝南的半圆平台
const yaotai = [[66, 44], ...Array.from({ length: 9 }, (_, i) => {
  const a = Math.PI + (i + 1) / 10 * Math.PI;
  return [+(100 + Math.cos(a) * 34).toFixed(2), +(44 + Math.sin(a) * 34).toFixed(2)];
}), [134, 44]];

await writePlan({
  id: 'frost-3-v2',
  revision: 'v2-slice-3',
  chapter: 'frost',
  index: 3,
  title: '瑶池冰湖',
  subtitle: '湖心枢纽 · 西岸祭坛与东岸船坞自选顺序 · 半圆瑶台',
  identity: '西王母的瑶池冻成了一整片椭圆冰面，整关以湖心为枢纽：从南面栈桥踏上冰面先打一场开阔的对射；之后西岸祭坛和东岸船坞两场战斗的顺序由玩家自己选，两边都清空，北岸半圆形的瑶台才会有守军现身。湖面没有墙，只有湖心亭和两座小岛。',
  objective: '肃清湖心，再以任意顺序清空西岸祭坛与东岸船坞，最后击退瑶台守军离开。',
  pacing: ['南岸栈桥：安全缓冲，望见冰封的湖心亭', '瑶池湖心：第一战，开阔冰面，两只夫诸隔着冰面射冰光，冰灯水母连线给它们回血，抢岛、断线', '西岸祭坛：自选，冻鲛人冲上岸投矛突刺，冰河豚从湖面飘来俯冲', '东岸船坞：自选，玄冰巨蟹竖着巨钳在冻船之间横行，鲛人跟在钳墙后面', '瑶台：最终战，两只九尾狐巫不断立冰壁，冰甲旋龟在冰壁之间旋转反弹'],
  routeChoice: '湖心是枢纽：西岸与东岸两场顺序自选，往返都经过湖面；两边清空后北岸瑶台开启。',
  encounterLogic: '瑶池是一关枢纽：湖心先打，西岸、东岸自选，瑶台最后。湖心：冰面上几乎没有墙，两只夫诸隔着冰面蓄力射冰光，冰光扫过的冰面会打滑，冰灯水母飘在后面用触须给它们回血；湖心亭和两座小岛是唯一的掩体，躲在岛后挡住视线就能断开水母的连线。西岸祭坛：冻鲛人冲上岸先投矛再成群突刺，冰河豚从湖面飘过来俯冲，打死的鲛人会掉回血的鲛珠。东岸船坞：第一次见玄冰巨蟹，它竖着巨钳横着走，正面打不动，要在冻船之间绕到它身后打背缝，鲛人跟在钳墙后面。瑶台：两只狐巫不断立冰壁，冰甲旋龟在冰壁之间旋转反弹，路线随时被改变。',
  artBrief: 'V2：昆仑雪墟建筑套件，椭圆冰湖面、湖心亭、白玉栏杆、冻住的小船与半圆瑶台；当前为白盒。',
  whiteboxChecks: ['湖心为枢纽，东西两岸可自选顺序', '每个战斗场地都有可经台阶到达的高台', '瑶台在东西两岸都清空后才开启'],
  bounds: [200, 172],
  rooms: [
    { id: 'pier', label: '南岸栈桥', polygon: [[90, 152], [110, 150], [114, 158], [110, 166], [92, 168], [86, 160]], labelAt: [100, 160] },
    { id: 'lake', label: '瑶池湖心', polygon: ngon(100, 92, 44, 32, 14), labelAt: [124, 116] },
    { id: 'altar', label: '西岸祭坛', polygon: [[6, 62], [40, 58], [48, 76], [48, 112], [38, 126], [6, 122], [2, 92]], labelAt: [24, 118] },
    { id: 'boat', label: '东岸船坞', polygon: [[150, 70], [188, 64], [196, 92], [190, 122], [154, 120]], labelAt: [172, 112] },
    { id: 'yaotai', label: '瑶台', polygon: yaotai, labelAt: [82, 40] },
  ],
  passages: [
    { id: 'p1', from: 'pier', to: 'lake', points: [[100, 150], [100, 122]], width: 12, kind: 'main', note: '栈桥踏上冰面，正对湖心亭' },
    { id: 'p2', from: 'lake', to: 'altar', points: [[57, 92], [48, 92]], width: 12, kind: 'main', note: '湖面西岸登上祭坛（与东岸顺序自选）' },
    { id: 'p3', from: 'lake', to: 'boat', points: [[143, 92], [154, 92]], width: 12, kind: 'main', note: '湖面东岸进入船坞（与西岸顺序自选）' },
    { id: 'p4', from: 'lake', to: 'yaotai', points: [[100, 61], [100, 44]], width: 12, kind: 'main', note: '湖面北岸登上瑶台，两岸清空后开启' },
  ],
  entry: { room: 'pier', at: [100, 160] },
  exit: { room: 'yaotai', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3', 'p4'],
  platforms: [
    { id: 'lake-pavilion', label: '湖心亭', rect: [92, 84, 108, 100], height: 3, stairs: [{ side: 'west', width: 4 }, { side: 'east', width: 4 }] },
    { id: 'lake-north', label: '北小岛', rect: [116, 66, 126, 74], height: 2, stairs: [{ side: 'south', width: 4 }] },
    { id: 'lake-south', label: '南小岛', rect: [70, 102, 80, 110], height: 2, stairs: [{ side: 'north', width: 4 }] },
    { id: 'altar-stage', label: '西岸祭坛', rect: [12, 84, 24, 100], height: 3, stairs: [{ side: 'east', width: 4 }] },
    { id: 'boat-roof', label: '船屋顶', rect: [174, 78, 186, 90], height: 2.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'yaotai-terrace', label: '瑶台玉阶', rect: [88, 14, 112, 24], height: 3.5, stairs: [{ side: 'south', offset: -7, width: 4 }, { side: 'south', offset: 7, width: 4 }] },
  ],
  covers: [
    // 瑶池湖心：几道冰脊，冰面开阔
    cover(80, 72, 86, 73.2, LOW), cover(114, 112, 120, 113.2, LOW), pillar(126, 98),
    // 西岸祭坛：石柱、低墙
    pillar(36, 78), pillar(22, 108), cover(38, 104, 44, 105.2, LOW),
    // 东岸船坞：冻住的小船
    cover(160, 84, 166, 87, LOW), cover(176, 104, 182, 107, LOW), pillar(186, 96),
    // 瑶台：两根玉柱
    pillar(80, 36), pillar(120, 26),
    // —— 陈设（各取自房间的故事）——
    // 南岸栈桥：渔人的晒鱼架，栈桥头一盏鲸骨灯（避开正对湖心亭的视线）
    prop('goods', 90.5, 160, 'east'), prop('brazier', 108, 154),
    // 瑶池湖心：湖面不加陈设，湖心亭与两座小岛仍是唯一的掩体
    // 西岸祭坛：两盏鲸骨灯照着祭坛台前（让开台阶与望向祭坛的视线）；鲛人登岸处冲上来一截断桅，挡住湖面飘来的冰河豚
    prop('brazier', 27, 83), prop('brazier', 27, 101), prop('ruin', 34, 116, 'north'),
    // 东岸船坞：冻船之间的渔人毡房和晒鱼架，让巨蟹的钳墙有东西可绕；船坞藏货旁堆着珍珠与鲸牙
    prop('stall', 158, 76, 'east'), prop('goods', 170, 74.5, 'south'), prop('hoard', 188.5, 112.5, 'west'),
    // 瑶台：玉阶两道台阶之间、瑶台供箱身后偏东堆着珍珠（让开湖岸望玉阶的视线）；南缘冰窟神龛与两盏鲸骨灯
    prop('hoard', 102.5, 26.1, 'south'),
    ...exit.covers, prop('brazier', 117, 41.5), prop('brazier', 131, 41.5),
  ],
  encounters: [
    { id: 'A', at: [100, 112], room: 'lake', label: '湖心冰光', roster: '夫诸 2 + 冰灯水母 1：冰光隔湖狙击，水母连线回血，抢岛断线', timing: '踏上冰面深处触发', facing: [100, 118],
      squad: [['fuzhu', 2], ['lantern_jelly', 1]] },
    { id: 'B', at: [30, 106], room: 'altar', label: '岸边鲛群', roster: '冻鲛人 4 + 冰河豚 2：投矛突刺加空中俯冲，鲛珠可回血', timing: '登上西岸触发（与东岸顺序自选）', facing: [44, 92],
      squad: [['jiaoren', 4], ['ice_puffer', 2]], requires: ['A'] },
    { id: 'C', at: [168, 104], room: 'boat', label: '船坞巨蟹', roster: '玄冰巨蟹 1 + 冻鲛人 3：钳墙推进，绕到背后打背缝', timing: '进入船坞触发（与西岸顺序自选）', facing: [158, 92],
      squad: [['frost_crab', 1], ['jiaoren', 3]], requires: ['A'] },
    { id: 'D', at: [100, 32], room: 'yaotai', label: '瑶台冰壁旋龟', roster: '九尾狐巫 2 + 冰甲旋龟 1：旋壳在冰壁之间反弹', timing: '两岸清空后登上瑶台触发', facing: [100, 40],
      squad: [['xuangui', 1], ['fox_witch', 2]], requires: ['B', 'C'] },
  ],
  rewards: [
    { at: [128, 108], room: 'lake', label: '湖面冻箱', reward: 'coins', requires: ['A'] },
    { at: [186, 106], room: 'boat', label: '船坞藏货', reward: 'scroll', requires: ['C'] },
    { at: [100, 30], room: 'yaotai', label: '瑶台供箱', reward: 'upgrade', requires: ['D'] },
  ],
  sightlines: [
    { from: [100, 160], to: [100, 92], label: '栈桥正对湖心亭' },
    { from: [100, 92], to: [24, 92], label: '湖心亭望见西岸祭坛' },
    { from: [100, 92], to: [180, 84], label: '湖心亭望见东岸船屋' },
    { from: [100, 61], to: [100, 19], label: '湖面北岸望见瑶台玉阶' },
  ],
  notes: [
    { at: [100, 92], text: '湖心亭 3 m，东西两道台阶，是整片冰面唯一的大掩体' },
    { at: [100, 52], text: '瑶台在两岸都清空后才有守军现身' },
  ],
});
