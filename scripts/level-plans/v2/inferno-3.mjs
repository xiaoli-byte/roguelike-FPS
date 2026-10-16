// V2 floor plan: 火狱第 3 关「铸范大坊」。祝融的大铸坊是一整座大厅，北墙炉闸放出的熔铜沿铸渠流遍地面，
// 把大厅切成五张铸床；铸床之间只有铁桥。东线直奔神范台，西线绕远拿两处私藏、从背后杀进东铸床。
// node scripts/level-plans/v2/inferno-3.mjs  → 写入 docs/level-design/plans-v2/inferno.json，再运行 whitebox:sync。
//
// 怪物：第三章阵容表（docs/art/enemy-roster-v2.md「第三章 · 祝融火狱 — 阵容表」，2026-10-11 设计稿待审）尚未实装，
// 怪物：第三章阵容（2026-10-11 用户确认，docs/art/enemy-roster-v2.md 第三章），squad 用正式敌人 id。
//
// 铸渠（各宽 8 m）：主渠 T 从北墙炉闸（x 76）南下到 y 52，汇入横贯大厅的横渠 H（y 52–60），再分出西渠 L（x 46–54）
// 和东渠 R（x 98–106）南流到南墙。五张铸床：西北炉前床、东北神范床、西南废范场、中央铸床、东铸床。
import { FULL, LOW, cover, pillar, rect, writePlan } from './common.mjs';
import { ding, lavaStrip, lintLava, prop, shrine } from './inferno-kit.mjs';

// 出口：神范台东墙的祝融火门神龛，面朝西、在神范台南侧两座火坛之外。
const exit = shrine(144, 36, 'west', 5);

const plan = {
  id: 'inferno-3-v2',
  revision: 'v2-slice-3',
  chapter: 'inferno',
  index: 3,
  title: '铸范大坊',
  subtitle: '熔铜铸渠切开的大铸坊 · 中央铸床、东铸床与神范台 · 西线回环',
  identity: '一整座没有隔墙的大铸坊，却被地上的熔铜切成了五张铸床：北墙正中的炉闸放出熔铜，主渠南下，汇进横贯大厅的横渠，再分成东西两条渠流到南墙。铸床之间只有铁桥，渠上没有墙，隔着熔铜什么都看得见。从南闸门进中央铸床，往东过桥是东铸床，再往北过桥就是神范台；往西过桥是废范场，再往北是炉前床，沿炉闸桥越过主渠也能到神范台——西线是一个大回环，绕远，但能拿两处私藏，并从北面背后杀进东铸床的范列。',
  objective: '清空中央铸床，击退东铸床的炮阵，在神范台击败守范的铁牛，从神范里离开。',
  pacing: ['南闸门：安全缓冲，正对中央铸床的浇包吊台，左右两条铸渠一直流到北墙', '中央铸床：第一战，火鼍在铸床两侧的东西渠里换边潜游、扑上床沿', '东铸床：第二战，成排的铸范挡得住直射挡不住火箭，熔铜匠给扎堆的炮仗傀儡浇铜甲', '西线（可选）：废范场与炉前床各有一处私藏，炉闸桥越过主渠接回神范床', '神范台：最终战，傩巫的黑面让精英铁牛刀枪不入，毕方立在神范框架的立柱上，胜利后神范开启'],
  routeChoice: '东线：中央铸床 → 东铸床 → 神范台，三座桥最短。西线：中央铸床 → 废范场 → 炉前床 → 炉闸桥 → 神范床，再南下东铸床打炮阵、回到神范台；多走一圈，换来两处私藏（残兵、铸经），并且从北面进东铸床，绕到炮阵背后。',
  encounterLogic: '铸坊的三场都由「铸渠切开的铸床」出题。中央铸床：火鼍第一次出现。铸床东西两侧都是熔铜渠，它在两条渠里换边潜游，看到床沿鼓泡就是要扑；离开渠它就长不回岩甲，所以要把它引到铸床正中的浇包吊台下打，吊台上能看清它脊背的接缝。东铸床：熔铜匠第一次出现。三排铸范是全掩体，挡得住直射，挡不住炮仗傀儡的火箭齐射；熔铜匠躲在范列后面给傀儡浇铜甲，刚浇上的通红铜甲一打就碎，等它冷了就硬——看到它弓背就准备集火。两只傀儡挨在一排范后，打爆一只会连环炸另一只。走西线的人从北桥进来，先碰到的是炮阵的背面。神范台：变脸傩巫第一次出现。精英熔炉铁牛守着神范，傩巫跳傩给它加成：黑面时它几乎打不动，赤面时它更快更狠，先挑要命的那张脸打碎；铁牛仰头吸气时会把人往神范前拉，顶着吸力打它胸口炉门；毕方立在神范框架的 5 m 立柱上点射。后一场要求前一场已清空。',
  artBrief: 'V2（祝融火狱建筑套件 SM_Tripo_Inferno*，本机 Hunyuan3D，熔岩缝 / 炭火自发光）：一整座玄铁大铸坊，地面铸渠里流着熔铜（熔岩地面，没有挡墙，熔铜光照亮四周），渠上铁桥，北墙炉闸、浇包吊台、成排的铸范与范框、东北角的神范（巨型铸模，出口在神范里）。',
  whiteboxChecks: ['铸渠宽 8 m，只能走桥；主线三座桥宽 12 m，西线桥宽 10 m', '每场战斗的铸床都有可经台阶到达的高台，高台和台阶离铸渠至少 10 m', '可站立的掩体离铸渠至少 6 m', '神范床有三根 5 m 立柱（毕方栖点）'],
  bounds: [152, 162],
  rooms: [
    { id: 'gate', label: '南闸门', polygon: rect(60, 146, 92, 158), labelAt: [86, 152] },
    { id: 'central', label: '中央铸床', polygon: rect(54, 60, 98, 140), labelAt: [64, 134] },
    { id: 'east', label: '东铸床', polygon: rect(106, 60, 144, 140), labelAt: [132, 136] },
    { id: 'mould', label: '神范台', polygon: rect(80, 8, 144, 52), labelAt: [92, 48] },
    { id: 'scrap', label: '废范场', polygon: rect(8, 60, 46, 140), labelAt: [27, 74] },
    { id: 'forge', label: '炉前床', polygon: rect(8, 8, 72, 52), labelAt: [40, 46] },
  ],
  passages: [
    { id: 'p1', from: 'gate', to: 'central', points: [[76, 147], [76, 136]], width: 12, kind: 'main', note: '南闸门直入中央铸床，正对浇包吊台' },
    { id: 'p2', from: 'central', to: 'east', points: [[95, 100], [109, 100]], width: 12, kind: 'main', note: '东桥越过东渠，进东铸床的范列' },
    { id: 'p3', from: 'east', to: 'mould', points: [[125, 63], [125, 49]], width: 12, kind: 'main', note: '北桥越过横渠，登上神范台' },
    { id: 'p4', from: 'central', to: 'scrap', points: [[57, 118], [43, 118]], width: 10, kind: 'optional', note: '西桥越过西渠，进废范场' },
    { id: 'p5', from: 'scrap', to: 'forge', points: [[27, 63], [27, 49]], width: 10, kind: 'return', note: '废范场北桥越过横渠，到炉前床' },
    { id: 'p6', from: 'forge', to: 'mould', points: [[69, 22], [83, 22]], width: 10, kind: 'return', note: '炉闸桥：贴着炉闸越过主渠，接回神范床' },
  ],
  entry: { room: 'gate', at: [70, 152] },
  exit: { room: 'mould', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'central-ladle', label: '浇包吊台', rect: [70, 92, 82, 104], height: 3, stairs: [{ side: 'north', width: 4 }, { side: 'south', width: 4 }] },
    { id: 'east-wall', label: '铸铁墙台', rect: [136, 80, 143, 96], height: 3.5, stairs: [{ side: 'west', width: 4 }] },
    { id: 'mould-dais', label: '神范台', rect: [118, 12, 136, 24], height: 3.5, stairs: [{ side: 'south', offset: -5, width: 4 }, { side: 'south', offset: 5, width: 4 }] },
  ],
  voids: [
    ...lavaStrip('trunk', '主渠', [[76, 9], [76, 52]], 4),
    ...lavaStrip('cross', '横渠', [[9, 56], [143, 56]], 4),
    ...lavaStrip('west', '西渠', [[50, 61], [50, 139]], 4),
    ...lavaStrip('east', '东渠', [[102, 61], [102, 139]], 4),
  ],
  covers: [
    // 中央铸床：火鼍要有空地才能引它离渠，铸床中间只留两只青铜鼎、两根立柱、南端两道矮栏和一车铜锭
    ding(66, 74), ding(86, 74), pillar(65, 114), pillar(87, 114),
    cover(60.5, 124, 61.7, 130, LOW), cover(90.3, 124, 91.5, 130, LOW), prop('goods', 76, 130, 'north'),
    // 东铸床：三排铸范（2.6 m 全掩体），每排中间留缺口；东南角一只青铜鼎
    cover(113, 106, 121, 108.4, FULL), cover(125, 106, 133, 108.4, FULL),
    cover(113, 118, 121, 120.4, FULL), cover(125, 118, 133, 120.4, FULL),
    cover(113, 130, 121, 132.4, FULL), cover(125, 130, 133, 132.4, FULL),
    ding(138, 132), prop('goods', 120, 70, 'south'),
    // 神范台：神范框架的三根 5 m 立柱（毕方栖点）、一道矮墙、一只青铜鼎、神范前两座火坛
    pillar(98, 18, 2, 5), pillar(98, 40, 2, 5), pillar(110, 30, 2, 5), cover(104, 44, 110, 45.2, LOW), ding(139, 44),
    prop('brazier', 116, 31), prop('brazier', 138, 31), ...exit.covers,
    // 废范场：打坏的铸范堆（倒塌铸范），一堆铁锭
    prop('ruin', 27, 92, 'east'), prop('ruin', 30, 132, 'north'), prop('goods', 38, 72, 'west'),
    // 炉前床：炉工的锻台、火坛，私藏旁的宝器
    prop('stall', 30, 14, 'south'), prop('brazier', 58, 14), prop('hoard', 16, 30, 'east'),
    // 南闸门：卸下的一车矿石
    prop('goods', 86, 148.5, 'south'),
  ],
  encounters: [
    { id: 'A', at: [76, 80], room: 'central', label: '铸床火鼍', roster: '火鼍 1 + 炭童 3：在东西两渠里换边潜游、扑上床沿；引到吊台下剥岩甲', timing: '深入中央铸床触发', facing: [76, 128],
      squad: [['tuo', 1], ['tantong', 3]] },
    { id: 'B', at: [124, 113], room: 'east', label: '范列炮阵', roster: '炮仗傀儡 2 + 熔铜匠 1 + 炭童 2：铸范挡不住齐射；铜甲刚浇上时集火，扎堆的傀儡连环炸', timing: '深入东铸床触发（东桥或北桥）', facing: [112, 100],
      squad: [['firecracker', 2], ['founder', 1], ['tantong', 2]], requires: ['A'] },
    { id: 'C', at: [112, 22], room: 'mould', label: '神范铁牛', roster: '精英熔炉铁牛 1 + 变脸傩巫 1 + 毕方 1 + 炭童 2：先碎傩巫的面具，吸气时打炉门', timing: '东铸床清空后登上神范台触发', facing: [122, 46],
      squad: [['iron_ox', 1, true], ['nuo', 1], ['bifang', 1], ['tantong', 2]], requires: ['B'] },
  ],
  rewards: [
    { at: [62, 136], room: 'central', label: '浇包里凝住的铜钱', reward: 'coins', requires: ['A'] },
    { at: [16, 120], room: 'scrap', label: '废范里没出炉的残兵', reward: 'weapon', requires: ['A'] },
    { at: [16, 20], room: 'forge', label: '炉工私藏的铸经', reward: 'scroll', requires: ['A'] },
    { at: [127, 44], room: 'mould', label: '神范供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [70, 152], to: [76, 98], label: '南闸门正对浇包吊台' },
    { from: [109, 100], to: [127, 18], label: '东桥头望见神范台' },
    { from: [57, 118], to: [76, 10], label: '西桥头隔着两条渠望见北墙炉闸' },
    { from: [83, 22], to: [124, 113], label: '炉闸桥隔着横渠望见东铸床的范列背面' },
  ],
  notes: [
    { at: [76, 6], text: '炉闸：熔铜的源头。以后可做周期性开闸，主渠涨满溢到桥面' },
    { at: [102, 100], text: '铸渠宽 8 m：熔岩地面，没有挡墙；火鼍潜游的「河」。落渠扣血并被托回岸边，敌人被击退下去会烧死' },
    { at: [76, 98], text: '浇包吊台 3 m：两侧离铸渠 16 m，看火鼍脊背的高点' },
  ],
};

lintLava(plan);
await writePlan(plan);
