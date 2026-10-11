// V2 redesign slice: 沙寺第 1 关「风口裂隘」重做。线性串联三个大型战斗场地，带高台、坡梯与多高度掩体。
// node scripts/level-plans/v2/desert-1.mjs  → 写入 docs/level-design/plans-v2/desert.json，再运行 whitebox:sync。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
/** Axis-aligned polygon from two corners. */
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Octagon with chamfered corners: readable arena outline without a boxy silhouette. */
const arena = (x0, y0, x1, y1, c = 6) => [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];
const cover = (x0, y0, x1, y1, height) => ({ polygon: rect(x0, y0, x1, y1), height });
const pillar = (x, y, size = 2, height = 4.5) => cover(x - size / 2, y - size / 2, x + size / 2, y + size / 2, height);
const LOW = 1.2, FULL = 2.6;
/** Set dressing that is also solid cover: `art` names the model, `face` the plan direction its front looks. */
const dress = (x0, y0, x1, y1, height, art, face) => ({ ...cover(x0, y0, x1, y1, height), art, face });
// Boxes follow each published model's own footprint at a uniform scale (stall 3.7 x 2.2, goods 2.6 x 2.0,
// hoard 3.6 x 2.7 m), so the art is never stretched to fit its collision.
const STALL = 3.6, GOODS = 2.5, HOARD = 2.5, RUIN = 1.6, BRAZIER = 2.4;
// Gate posts: a pair of 'gate' boxes is drawn as one uniformly scaled gateway spanning both (its posts measured
// at 4.07 of 13.52 m width and 4.01 m deep, so an 18 m span gives 5.41 m posts, 5.34 m deep, a 7.2 m opening).
const GATE_POST = 9;
// Portal shrine pylons: the published shrine is 9.68 m wide and 3.3 m deep with a ~4.9 m arch; its back stands on
// the east wall line (x 246), so the pylons cover x 242.7..246 either side of the arch and the exit portal
// (240.5, 42) rises just in front of it, framed by the arch, banners and sun finial.
const SHRINE_PYLON = 9;

const plan = {
  id: 'desert-1-v2',
  revision: 'v2-slice-1',
  chapter: 'desert',
  index: 1,
  title: '风口裂隘',
  subtitle: '三场串联 · 高台集市、断柱庭与沙王门前',
  identity: '自西向东一条主线：驿道入口 → 风蚀集市 → 断柱庭 → 沙王门前。每个场地都能看到下一个场地的门洞，不需要找路。',
  objective: '依次清空集市、断柱庭与门前守军，从东侧石门离开。',
  pacing: ['入口驿道：安全缓冲，望见集市中央高台', '风蚀集市：第一战，中央高台与北侧回廊两层交火', '断柱庭：第二战，弩卫在柱林里钻沙换位，跳鼠把人逼出掩体', '侧室：清场后可调查的藏宝间', '沙王门前：最终战，后方石台守军，胜利后石门开启'],
  routeChoice: '主线笔直推进；断柱庭南侧有一间可选藏宝室，入口清晰可见，不形成回环。',
  encounterLogic: '第一关一场只教一件事。集市：只有跳鼠群，学会看扑斩前摇、横移躲落点。断柱庭：弩卫藏在柱林里，贴近就钻沙换位，两只跳鼠把人从柱子后面赶出来。门前：第一次见镇墓兽，宽阔的门前场地四面有墙，学会引它撞墙、绕背打裂缝。后一场要求前一场已清空。',
  artBrief: 'V2 白盒切片：先验证尺度、高差与节奏，美术待 Tripo 建筑模块落地后替换。',
  whiteboxChecks: ['主线通道宽 12 m，任意两点之间不超过两次转向', '每个战斗场地至少一处可经台阶到达的高台', '高台台阶有导航坡道，敌人能追上高台', '掩体分 1.2 m 可翻越、2.6 m 全掩护与 4.5 m 立柱三档'],
  bounds: [252, 84],
  rooms: [
    { id: 'gate', label: '驿道入口', polygon: [[4, 28], [28, 26], [34, 32], [34, 52], [28, 58], [4, 56]], labelAt: [18, 42] },
    { id: 'market', label: '风蚀集市', polygon: arena(50, 16, 104, 68), labelAt: [77, 26] },
    { id: 'court', label: '断柱庭', polygon: arena(118, 12, 178, 72), labelAt: [148, 20] },
    { id: 'cache', label: '藏宝侧室', polygon: rect(140, 72, 158, 82), labelAt: [149, 78] },
    { id: 'altar', label: '沙王门前', polygon: arena(192, 20, 246, 64), labelAt: [214, 28] },
  ],
  passages: [
    { id: 'p1', from: 'gate', to: 'market', points: [[34, 42], [50, 42]], width: 12, kind: 'main', note: '入口直通集市，门洞正对中央高台' },
    { id: 'p2', from: 'market', to: 'court', points: [[104, 42], [118, 42]], width: 12, kind: 'main', note: '短过渡，进门即见断柱庭柱林' },
    { id: 'p3', from: 'court', to: 'altar', points: [[178, 42], [192, 42]], width: 12, kind: 'main', note: '直视沙王门前的后方石台' },
    { id: 'p4', from: 'court', to: 'cache', points: [[149, 68], [149, 76]], width: 7, kind: 'optional', note: '断柱庭南墙的藏宝侧室，门楼门洞约 7.2 m' },
  ],
  entry: { room: 'gate', at: [12, 42] },
  exit: { room: 'altar', at: [240.5, 42] },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'market-dais', label: '集市中央高台', rect: [70, 34, 86, 50], height: 3, stairs: [{ side: 'west', width: 4 }, { side: 'east', width: 4 }] },
    { id: 'market-gallery', label: '集市北回廊', rect: [58, 17, 96, 23], height: 3, stairs: [{ side: 'south', offset: -13, width: 4 }, { side: 'south', offset: 13, width: 4 }] },
    { id: 'court-rampart', label: '断柱庭东城垛', rect: [164, 20, 174, 64], height: 3.5, stairs: [{ side: 'west', offset: -12, width: 4 }, { side: 'west', offset: 12, width: 4 }] },
    { id: 'court-terrace', label: '断柱庭西台地', rect: [124, 48, 138, 64], height: 2.4, stairs: [{ side: 'north', width: 5 }] },
    // 门前两座侧台夹出一条直通出口的神道：传送门立在道尽头，两侧台是躲镇墓兽冲撞的高点
    { id: 'altar-dais-north', label: '神道北侧台', rect: [226, 24, 240, 35], height: 2, stairs: [{ side: 'west', width: 5 }] },
    { id: 'altar-dais-south', label: '神道南侧台', rect: [226, 49, 240, 60], height: 2, stairs: [{ side: 'west', width: 5 }] },
  ],
  covers: [
    // 风蚀集市：高台两侧的低矮货墙 + 南侧半掩护
    cover(57, 40, 63, 41.2, LOW), cover(92, 40, 98, 41.2, LOW),
    cover(62, 58, 68, 59.2, FULL), cover(86, 58, 92, 59.2, FULL),
    pillar(56, 62, 2, 4.5), pillar(98, 62, 2, 4.5),
    // 集市的身份：南墙下两座布篷摊位，入口与货箱旁的货物堆
    dress(69.2, 65.8, 72.9, 68, STALL, 'stall', 'north'), dress(83.2, 65.8, 86.9, 68, STALL, 'stall', 'north'),
    dress(52, 26.7, 54, 29.3, GOODS, 'goods', 'east'), dress(101, 54.7, 103, 57.3, GOODS, 'goods', 'west'),
    // 车马口：入口处卸下的一堆货
    dress(7, 48.7, 9, 51.3, GOODS, 'goods', 'east'),
    // 断柱庭：柱林 + 低墙
    pillar(130, 26), pillar(142, 30), pillar(154, 24), pillar(146, 42), pillar(132, 38),
    cover(148, 52, 156, 53.2, LOW), cover(152, 34, 153.2, 40, FULL),
    // 沙王门前：两根门柱 + 两道低墙
    pillar(206, 30, 2.4, 5), pillar(206, 54, 2.4, 5),
    cover(212, 35, 218, 36.2, LOW), cover(212, 48, 218, 49.2, LOW),
    // 神道火盆：入口一对、传送门前一对
    dress(223.3, 35.3, 224.7, 36.7, BRAZIER, 'brazier', 'south'), dress(223.3, 47.3, 224.7, 48.7, BRAZIER, 'brazier', 'north'),
    dress(236.3, 35.3, 237.7, 36.7, BRAZIER, 'brazier', 'south'), dress(236.3, 47.3, 237.7, 48.7, BRAZIER, 'brazier', 'north'),
    // 断柱庭：倒塌的柱段与碎石堆（低矮掩体，避开神道与台阶脚）
    dress(132, 19, 138, 22, RUIN, 'ruin', 'south'), dress(150, 19, 156, 22, RUIN, 'ruin', 'south'),
    dress(143, 59, 149, 62, RUIN, 'ruin', 'north'),
    // 侧室宝库：宝箱（149, 79）两侧的财宝堆
    dress(141.2, 79.3, 144.8, 82, HOARD, 'hoard', 'north'), dress(153.2, 79.3, 156.8, 82, HOARD, 'hoard', 'north'),
    // 门前祭坛神龛：两侧塔门（龛洞 6.5 m 宽），传送门在龛口升起
    dress(242.7, 37.16, 246, 39.55, SHRINE_PYLON, 'shrine', 'west'), dress(242.7, 44.45, 246, 46.84, SHRINE_PYLON, 'shrine', 'west'),
    // 宝库门楼：两根门柱卡住侧室 18 m 宽的入口，门洞收窄到约 7.2 m
    dress(140, 69.33, 145.41, 74.67, GATE_POST, 'gate', 'north'), dress(152.59, 69.33, 158, 74.67, GATE_POST, 'gate', 'north'),
  ],
  encounters: [
    { id: 'A', at: [78, 58], room: 'market', label: '集市跳鼠群', roster: '跳鼠刀兵 5：只有群怪，学会看蹲伏前摇', timing: '深入集市触发', facing: [62, 42],
      squad: [['jerboa_blade', 5]] },
    { id: 'B', at: [146, 46], room: 'court', label: '柱林弩卫', roster: '蝎尾弩卫 2 + 跳鼠刀兵 2：弩卫在柱林里钻沙换位，跳鼠把人逼出掩体', timing: '深入断柱庭触发', facing: [130, 42],
      squad: [['scorpion_archer', 2], ['jerboa_blade', 2]], requires: ['A'] },
    { id: 'C', at: [212, 42], room: 'altar', label: '门前镇墓兽', roster: '镇墓兽 1 + 跳鼠刀兵 2：第一次面对冲撞，引它撞墙再打背', timing: '深入门前触发', facing: [204, 42],
      squad: [['tomb_beast', 1], ['jerboa_blade', 2]], requires: ['B'] },
  ],
  rewards: [
    { at: [98, 64], room: 'market', label: '集市货箱', reward: 'coins', requires: ['A'] },
    { at: [149, 79], room: 'cache', label: '侧室宝箱', reward: 'scroll', requires: ['B'] },
    { at: [231, 42], room: 'altar', label: '门前供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [12, 42], to: [78, 42], label: '入口望见集市高台' },
    { from: [104, 42], to: [148, 30], label: '集市出口望见柱林' },
    { from: [178, 42], to: [233, 42], label: '断柱庭出口望见后石台' },
  ],
  notes: [
    { at: [78, 30], text: '高台上能俯射整个集市，敌人沿两侧台阶追上' },
    { at: [169, 42], text: '东城垛 3.5 m，二段跳或台阶上墙' },
  ],
};

const target = resolve(root, 'docs/level-design/plans-v2/desert.json');
await mkdir(dirname(target), { recursive: true });
const existing = await readFile(target, 'utf8').then(JSON.parse, () => []);
const plans = [...existing.filter(p => p.id !== plan.id), plan].sort((a, b) => a.index - b.index);
await writeFile(target, JSON.stringify(plans, null, 2) + '\n', 'utf8');
console.log(`Wrote ${plan.id} to docs/level-design/plans-v2/desert.json`);
