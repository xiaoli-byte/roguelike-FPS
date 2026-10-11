// V2 floor plan: 沙寺第 2 关「驼铃驿街」。商队驿站的三进：货场 → 水井院 → 库门前场，主线转一次弯。
// node scripts/level-plans/v2/desert-2.mjs  → 写入 docs/level-design/plans-v2/desert.json，再运行 whitebox:sync。
import { FULL, LOW, arena, cover, gatePosts, pillar, prop, rect, shrine, writePlan } from './common.mjs';

const exit = shrine(190, 41, 'west');

await writePlan({
  id: 'desert-2-v2',
  revision: 'v2-slice-2',
  chapter: 'desert',
  index: 2,
  title: '驼铃驿街',
  subtitle: '商队驿站三进 · 货场、水井院与库门前场',
  identity: '南门进驿，先穿过堆满货物的驼铃货场，向北进入以水井台为中心的井院，再向东攻入库门前场。每段通道都正对下一场地的地标：货场看见井台，井院看见库门神龛。',
  objective: '清空货场、水井院与库门守军，从东侧神龛离开。',
  pacing: ['南门：安全缓冲，望见货场卸货月台', '驼铃货场：第一战，火浣鼠沿货堆间的直道滚来，跳鼠侧面包抄；月台与箱垛两处高点', '卸货侧室：清场后可调查的财货间', '水井院：第二战，邪飞天悬在井台上给跳鼠群加护盾，先打琵琶', '库门前场：最终战，三只弩卫在北廊下钻沙伏击，火鼠惩罚躲着不动的人，胜利后神龛传送门开启'],
  routeChoice: '主线一次转向（货场向北进井院）；货场东侧的卸货侧室可选，门楼框口，不形成回环。',
  encounterLogic: '驿站的三场都不用坦克，压力来自数量和配合。货场：货堆与摊位之间留出的直道就是火浣鼠的滚道，跳鼠从侧面包抄，站着不动就会被炸。井院：邪飞天第一次出现，悬在井台上给周围的跳鼠加护盾，先打碎琵琶再清群怪；角楼上一只弩卫盯着井台。库门前场：三只弩卫守北廊下，钻沙伏击换位，两只火鼠专门惩罚躲在掩体后面不动的人。后一场要求前一场已清空。',
  artBrief: 'V2：沿用沙寺建筑套件（城墙模块、门楼、角楼、神龛），货场以摊位与货堆定身份，井院以井台与立柱定身份。',
  whiteboxChecks: ['主线通道宽 12 m，合计 54 m，只有货场到井院一次转向', '三个战斗场地各有可经台阶到达的高台', '掩体分 1.2 m 可翻越、2.6 m 全掩护与 4.5 m 立柱三档'],
  bounds: [198, 150],
  rooms: [
    { id: 'south', label: '驿站南门', polygon: [[4, 108], [26, 106], [30, 112], [30, 132], [26, 138], [4, 136]], labelAt: [16, 122] },
    { id: 'cargo', label: '驼铃货场', polygon: arena(46, 96, 102, 144), labelAt: [74, 138] },
    { id: 'supply', label: '卸货侧室', polygon: rect(102, 110, 120, 130), labelAt: [111, 120] },
    { id: 'well', label: '水井院', polygon: arena(70, 20, 122, 72), labelAt: [96, 26] },
    { id: 'depot', label: '库门前场', polygon: arena(136, 18, 190, 64), labelAt: [170, 50] },
  ],
  passages: [
    { id: 'p1', from: 'south', to: 'cargo', points: [[30, 122], [46, 122]], width: 12, kind: 'main', note: '南门直入货场，正对卸货月台' },
    { id: 'p2', from: 'cargo', to: 'well', points: [[86, 96], [86, 72]], width: 12, kind: 'main', note: '货场北口向北进井院，门楼框住井台' },
    { id: 'p3', from: 'well', to: 'depot', points: [[122, 42], [136, 42]], width: 12, kind: 'main', note: '井院东口直视库门神龛' },
    { id: 'p4', from: 'cargo', to: 'supply', points: [[96, 120], [108, 120]], width: 7, kind: 'optional', note: '货场东墙的卸货侧室，门楼门洞约 8 m' },
  ],
  entry: { room: 'south', at: [12, 122] },
  exit: { room: 'depot', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'cargo-dock', label: '货场卸货月台', rect: [54, 98, 76, 106], height: 3, stairs: [{ side: 'south', offset: -6, width: 4 }, { side: 'south', offset: 6, width: 4 }] },
    { id: 'cargo-stack', label: '货场箱垛', rect: [84, 126, 96, 138], height: 2.5, stairs: [{ side: 'west', width: 4 }] },
    { id: 'well-dais', label: '水井台', rect: [88, 38, 104, 54], height: 2.5, stairs: [{ side: 'north', width: 4 }, { side: 'south', width: 4 }] },
    { id: 'well-loft', label: '井院东北角楼', rect: [106, 24, 116, 34], height: 3.5, stairs: [{ side: 'west', width: 4 }] },
    { id: 'depot-gallery', label: '库房北廊', rect: [146, 20, 180, 27], height: 3.5, stairs: [{ side: 'south', offset: -10, width: 4 }, { side: 'south', offset: 10, width: 4 }] },
    { id: 'depot-ramp', label: '库门南低台', rect: [148, 52, 164, 61], height: 2, stairs: [{ side: 'north', width: 5 }] },
  ],
  covers: [
    // 驼铃货场：南墙下两座布篷摊、散落的货堆，低墙与立柱
    prop('stall', 60, 142.9, 'north'), prop('stall', 72, 142.9, 'north'),
    prop('goods', 58, 114, 'east'), prop('goods', 66, 128, 'north'), prop('goods', 80, 112, 'west'), prop('goods', 98, 104, 'south'),
    cover(84, 116, 90, 117.2, LOW), cover(66, 134, 67.2, 140, FULL), pillar(56, 132),
    // 入口驿道卸下的一堆货
    prop('goods', 8, 130, 'east'),
    // 卸货侧室：财货堆夹着宝箱，门楼卡住入口
    prop('hoard', 118.5, 114, 'west'), prop('hoard', 118.5, 126, 'west'),
    ...gatePosts('y', 110, 20, 102, 'west'),
    // 水井院：井台四周的立柱、低墙与倒塌柱段
    pillar(82, 34), pillar(110, 58), pillar(80, 60),
    cover(76, 44, 77.2, 50, LOW), cover(112, 40, 113.2, 46, FULL),
    prop('ruin', 100, 66, 'north'), prop('goods', 116, 50, 'west'),
    // 库门前场：入口两根门柱、两道低墙、财货与货堆，神道两侧火盆
    pillar(144, 32, 2.4, 5), pillar(144, 52, 2.4, 5),
    cover(152, 35, 158, 36.2, LOW), cover(166, 47, 172, 48.2, LOW), cover(168, 37, 169.2, 41, FULL),
    prop('hoard', 172, 60, 'north'), prop('goods', 183, 30, 'west'),
    prop('brazier', 178, 35), prop('brazier', 178, 47), prop('brazier', 186, 34), prop('brazier', 186, 48),
    ...exit.covers,
  ],
  encounters: [
    { id: 'A', at: [74, 118], room: 'cargo', label: '货堆火鼠', roster: '火浣鼠 4 + 跳鼠刀兵 3：火鼠沿货堆间的直道滚来，跳鼠侧面包抄', timing: '深入货场触发', facing: [58, 122],
      squad: [['fire_rat', 4], ['jerboa_blade', 3]] },
    { id: 'B', at: [108, 48], room: 'well', label: '井台护阵', roster: '跳鼠刀兵 4 + 蝎尾弩卫 1 + 邪飞天 1：飞天的天乐光环让跳鼠更快更狠，还会给它们加护盾、回血；先打琵琶', timing: '深入井院触发', facing: [86, 62],
      squad: [['jerboa_blade', 4], ['scorpion_archer', 1], ['apsara', 1]], requires: ['A'] },
    { id: 'C', at: [163, 41], room: 'depot', label: '库门弩阵', roster: '蝎尾弩卫 3 + 火浣鼠 2 + 跳鼠刀兵 2：中距离对枪，躲着不动会被火鼠逼出来', timing: '深入库门前场触发', facing: [146, 42],
      squad: [['scorpion_archer', 3], ['fire_rat', 2], ['jerboa_blade', 2]], requires: ['B'] },
  ],
  rewards: [
    { at: [99, 136], room: 'cargo', label: '货场货箱', reward: 'coins', requires: ['A'] },
    { at: [117, 120], room: 'supply', label: '侧室财货箱', reward: 'scroll', requires: ['A'] },
    { at: [176, 41], room: 'depot', label: '库门供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [12, 122], to: [65, 102], label: '南门望见卸货月台' },
    { from: [86, 96], to: [96, 46], label: '货场北口望见水井台' },
    { from: [122, 42], to: [188, 41], label: '井院东口望见库门神龛' },
  ],
  notes: [
    { at: [65, 102], text: '卸货月台 3 m，俯射整个货场，敌人从两侧台阶追上' },
    { at: [96, 46], text: '水井台 2.5 m，四面开放，邪飞天悬在台上护阵' },
  ],
});
