// V2 floor plan: 火狱第 5 关「祝融炉心」（首领关）。铸神前殿整备 → 熔铁护城渠上的一座桥 → 圆形祝融炉心殿。
// 炉心殿按首领设计的场地需求做（docs/art/enemy-roster-v2.md「火麒麟 · 首领设计」的「inferno-5 场地需求」）。
// node scripts/level-plans/v2/inferno-5.mjs  → 写入 docs/level-design/plans-v2/inferno.json，再运行 whitebox:sync。
//
// 首领：火麒麟 boss_qilin（玄鳞 → 55% 焚身，src/enemies/bosses/Qilin.ts）。
// 其他怪物（炉口刷出的炭童、排烟口刷出的神火飞鸦）由首领脚本召出，不写进 squad。
//
// 场地需求对照：
//  - 圆形炉心殿直径 48 m（半径 24），顶高至少 20 m（美术）；
//  - 中央熔池半径 7 m（void，围 1 m 高石沿，美术）；熔池正上方吊巨鼎，四条巨链拉到外墙东南西北的四个锁扣（离地 3–4 m）；
//  - 四条放射状熔岩渠宽 1.6 m（能跳过），从熔池通到外墙，走西北、东北、东南、西南四条对角线，把地面分成北东南西四个象限，
//    每条渠上一座窄桥；二阶段由脚本轮流涨宽到 4 m。渠是 hazards 里的熔岩带（kind 'lava'），运行时是没有挡墙的熔岩地面：
//    能跳过，踩进去扣血并被托回；窄桥是渠上留出的 4 m 缺口（地面敌人经桥过渠）；
//  - 外环跑道：半径 18–24 m 一圈 6 m 宽，不放任何东西；熔池边（半径 7–10 m）也不放；
//  - 8 根玄武岩柱：每个象限两根，直径 2 m，半径 13 m（两根狂怒时可撞塌，运行时）；
//  - 刷怪口：外墙两处炉口（炭童）、两处高排烟口（神火飞鸦），写在 notes；
//  - 进出：玩家从护城渠上的一座桥进场，开战后入口被熔铁闸封死（运行时）；麒麟从熔池跃出登场。
//  - 测试要求每个战斗场地有一座可上的高台：北墙外凸的神龛里，祝融火门神龛立在正中（胜利后出口传送门开在它的拱里），
//    两侧各一座 6 × 5 m 祭台（不占跑道），台阶朝南。
import { pillar, rect, writePlan } from './common.mjs';
import { arc, lavaPool, lavaStrip, lintLava, polar, prop, shrine } from './inferno-kit.mjs';

const C = [55, 40], R = 24, POOL = 7;
const deg = d => d * Math.PI / 180;
// 出口：北墙神龛正中的祝融火门神龛（背靠神龛北墙 y = 5，面朝殿心）。
const exit = shrine(5, 55, 'south', 6);

// 炉心殿外缘：北墙神龛（x 41–69，y 5 到殿墙）向外凸出，其余是整圆；再经一条零宽接缝绕回熔池内缘（偶奇规则下熔池是洞）。
const niche = [41, 69], nicheTop = 5;
const cut = Math.acos((niche[1] - C[0]) / R); // 神龛东边线与圆的交点方位角（北侧，取负）
const start = polar(C, -cut, R), end = polar(C, -(Math.PI - cut), R);
const outerLoop = [start, [niche[1], nicheTop], [niche[0], nicheTop], end, ...arc(C, R, -(Math.PI - cut), -(2 * Math.PI + cut), 40).slice(1, -1), start];
const poolLoop = arc(C, POOL, -cut, 2 * Math.PI - cut, 24);
const hall = [...outerLoop, ...poolLoop];

// 四条放射状熔岩渠（对角线方向），每条在半径 12 m 处留一座 4 m 窄桥：渠分内外两段（熔岩带两端是半圆头，各多出半个渠宽）。
const BRIDGE = 12, BRIDGE_HALF = 2, CHANNEL = 1.6;
const channels = [-135, -45, 45, 135].flatMap((a, i) => [
  ['inner', '内段', POOL, BRIDGE - BRIDGE_HALF - CHANNEL / 2], ['outer', '外段', BRIDGE + BRIDGE_HALF + CHANNEL / 2, R],
].map(([part, name, r0, r1]) => ({
  id: `channel-${['nw', 'ne', 'se', 'sw'][i]}-${part}`, label: `${['西北', '东北', '东南', '西南'][i]}熔岩渠${name}`, kind: 'lava',
  points: [polar(C, deg(a), r0), polar(C, deg(a), r1)], width: CHANNEL,
  note: '宽 1.6 m，能跳过，踩进去扣血并被托回；半径 12 m 处一座 4 m 窄桥。二阶段「熔流轮转」时脚本控制涨宽到 4 m，每次淹一个象限的外侧 6 秒',
})));
// 8 根玄武岩柱：每个象限（北东南西）两根，半径 13 m，象限中线 ±20°。
const pillars = [-90, 0, 90, 180].flatMap(q => [q - 20, q + 20]).map(a => pillar(...polar(C, deg(a), 13), 2, 6));

const plan = {
  id: 'inferno-5-v2',
  revision: 'v2-slice-5',
  chapter: 'inferno',
  index: 5,
  title: '祝融炉心',
  subtitle: '铸神前殿 · 熔铁护城渠上的桥 · 圆形炉心殿',
  identity: '火狱最深处是祝融的炉心殿：一座直径 48 m、顶高二十多米的圆殿，殿心是熔池，熔池上方吊着一口八米高的青铜巨鼎，四条巨链斜拉到外墙的四个锁扣上；四条熔岩渠从熔池放射到外墙，把地面切成四个象限，沿外墙一圈是留给火麒麟奔驰的环形跑道。殿外一圈熔铁护城渠，只有一座桥。铸神前殿在桥南，整备时能看到护城渠对岸紧闭的熔铁闸门和闸后炉心透出的红光，看不到殿里。',
  objective: '在铸神前殿整备，过桥进入炉心殿，击败火麒麟（玄鳞、焚身两个形态），从北墙神龛离开。',
  pacing: ['铸神前殿：安全整备，商人摊位与补给，隔着护城渠望见熔铁闸门', '护城渠桥：唯一的入口，进殿后熔铁闸落下封死', '祝融炉心殿：首领战。一阶段「玄鳞」沿外环跑道绕场奔驰、横穿象限冲撞，张鳞时躲到玄武岩柱后，去熔池饮熔时打断外墙锁扣让巨鼎砸它；55% 巨鼎整个坠进熔池，二阶段「焚身」在半空踏云越过熔岩渠，熔岩渠轮流涨宽；胜利后北墙神龛开启'],
  routeChoice: '单线：前殿 → 护城渠桥 → 炉心殿；无支路。殿内的选择是站位：外环跑道是麒麟的路，熔池边要躲饮熔时召出的炭童，象限之间只能跳渠或走桥。',
  encounterLogic: '过桥踏进炉心殿后触发首领，前殿与桥上购物、停留都不会触发；开战后入口被熔铁闸封死（运行时）。一阶段：麒麟沿外环跑道绕场，蹄印留火，然后转身横穿一个象限冲撞（地面先亮一条线）——别站在跑道上，也别站在冲撞线上；张鳞射出一圈鳞刃，每个象限两根玄武岩柱是唯一挡得住的东西。血量 85% 和 70% 时它跳到熔池边饮熔，两侧炉口各钻出 2 只炭童：这时打掉外墙上正对它那一角的锁扣，巨鼎一角坠下砸中它，眩晕 4 秒、鳞甲崩裂。锁扣在东南西北四面外墙上，环台任何位置都至少看得到两个。55%：剩下的铁链全断，巨鼎坠进熔池，麒麟化成焚身形态跃出。二阶段：它在 3–6 m 高处踏云奔跑，越过熔岩渠，俯冲落地炸出火环（起跳躲过）；熔岩溢进四条渠，按顺时针轮流涨宽、淹没一个象限的外侧；高处排烟口刷神火飞鸦。池中半露的倒鼎和玄武岩柱挡吐息。',
  artBrief: 'V2（祝融火狱建筑套件 SM_Tripo_Inferno*，本机 Hunyuan3D，熔岩缝 / 炭火自发光）：圆形炉心殿（玄武岩墙、顶高 ≥ 20 m）、中央熔池（熔岩地面，没有挡墙，围 1 m 石沿）、熔池上方吊着的 8 m 青铜巨鼎与四条斜拉巨链（鼎有吊着、一角坠下、整个坠池三种状态）、外墙四个发光锁扣、四条放射状熔岩渠与渠上窄桥、八根玄武岩柱、两处炉口、两处高排烟口、北墙神龛；殿外熔铁护城渠与熔铁闸门；前殿是祭祀祝融的铸神前殿。',
  whiteboxChecks: ['前殿商人摊位 8 m 内无遮挡', '炉心殿直径 48 m，熔池半径 7 m；外环跑道（半径 18–24 m）与熔池边（半径 7–10 m）不放任何掩体', '8 根玄武岩柱在半径 13 m，每个象限两根', '熔岩渠宽 1.6 m（hazards 熔岩带，能跳过，半径 12 m 处 4 m 窄桥）；护城渠与熔池是熔岩地面', '桥宽 10 m，前殿看得到闸门，看不到殿里'],
  bounds: [110, 136],
  rooms: [
    { id: 'preparation', label: '铸神前殿', polygon: rect(25, 88, 85, 124), labelAt: [36, 100] },
    { id: 'arena', label: '祝融炉心殿', polygon: hall, labelAt: [36, 26] },
  ],
  passages: [
    { id: 'p1', from: 'preparation', to: 'arena', points: [[55, 89], [55, 62]], width: 10, kind: 'main', note: '护城渠上唯一的桥，桥头是熔铁闸门，开战后封死' },
  ],
  entry: { room: 'preparation', at: [32, 117] },
  exit: { room: 'arena', at: exit.exit },
  mainRoute: ['p1'],
  preparation: { room: 'preparation', at: [66, 108], facing: [66, 116], label: '祝融炉心前补给' },
  platforms: [
    { id: 'arena-shrine-west', label: '神龛西祭台', rect: [42, 6, 48, 11], height: 2.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'arena-shrine-east', label: '神龛东祭台', rect: [62, 6, 68, 11], height: 2.5, stairs: [{ side: 'south', width: 4 }] },
  ],
  voids: [
    lavaPool('pool', '中央熔池', C, POOL),
    ...lavaStrip('moat', '熔铁护城渠', [[36, 76], [74, 76]], 7),
  ],
  hazards: channels,
  covers: [
    ...pillars, ...exit.covers,
    // 铸神前殿：祭祀用的锻台与铁锭、桥头一对火坛（商人摊位 8 m 内保持空旷）
    prop('stall', 78, 94, 'west'), prop('goods', 31, 94, 'east'), prop('brazier', 47, 92), prop('brazier', 63, 92),
    prop('hoard', 80, 120, 'west'),
  ],
  encounters: [
    { id: 'BOSS', at: [55, 29], room: 'arena', label: '火麒麟', roster: '首领火麒麟：玄鳞 → 55% 焚身；饮熔时召出炭童、二阶段排烟口刷神火飞鸦，由首领脚本召出', timing: '过桥踏进炉心殿后触发；击败后北墙神龛开启', facing: [55, 58],
      squad: [['boss_qilin', 1]] },
  ],
  rewards: [
    { at: [55, 52], room: 'arena', label: '炉心战后奖励', reward: 'upgrade', requires: ['BOSS'] },
  ],
  sightlines: [
    { from: [55, 96], to: [55, 64], label: '前殿隔着护城渠望见熔铁闸门（闸后看不到殿里）' },
    { from: [55, 62], to: [55, 9], label: '进殿正对熔池、巨鼎与北墙神龛' },
    { from: [72, 46], to: [31, 40], label: '东象限隔着熔池看到西墙锁扣' },
  ],
  notes: [
    { at: C, text: '中央熔池半径 7 m（熔岩地面）：上方吊 8 m 青铜巨鼎；麒麟从这里跃出、饮熔；55% 巨鼎整个坠入，成为池中半露的掩体' },
    { at: polar(C, deg(-90), R - 1), text: '北锁扣（离地 3–4 m，发光、可射击）' },
    { at: polar(C, 0, R - 1), text: '东锁扣（离地 3–4 m）' },
    { at: polar(C, deg(90), R - 1), text: '南锁扣（在熔铁闸门上方，离地 3–4 m）' },
    { at: polar(C, Math.PI, R - 1), text: '西锁扣（离地 3–4 m）' },
    { at: polar(C, deg(-160), R - 1), text: '西炉口：饮熔时钻出 2 只炭童' },
    { at: polar(C, deg(-20), R - 1), text: '东炉口：饮熔时钻出 2 只炭童' },
    { at: polar(C, deg(160), R - 1), text: '西南高排烟口（约 12 m 高）：二阶段刷神火飞鸦' },
    { at: polar(C, deg(20), R - 1), text: '东南高排烟口（约 12 m 高）：二阶段刷神火飞鸦' },
    { at: polar(C, deg(55), 21), text: '外环跑道：半径 18–24 m，6 m 宽，不放任何障碍' },
    { at: polar(C, deg(110), 13), text: '玄武岩柱（直径 2 m、高 6 m），每象限两根；其中两根狂怒时可被撞塌（运行时）' },
    { at: [55, 70], text: '熔铁闸门：开战后落下封死入口（运行时）' },
  ],
};

lintLava(plan);
await writePlan(plan);
