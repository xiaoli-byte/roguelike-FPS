// V2 floor plan: 火狱第 2 关「铸神井」。祝融宫下的铸神井是一口熔岩竖井，一条凿在井壁上的螺旋坡道顺时针绕井一圈多，
// 一路下到井底的炉坛；坡道内侧没有护栏，井心整片是熔岩，每一圈都能隔着井看到下一场仗。
// node scripts/level-plans/v2/inferno-2.mjs  → 写入 docs/level-design/plans-v2/inferno.json，再运行 whitebox:sync。
//
// 怪物：第三章阵容表（docs/art/enemy-roster-v2.md「第三章 · 祝融火狱 — 阵容表」，2026-10-11 设计稿待审）尚未实装，
// 怪物：第三章阵容（2026-10-11 用户确认，docs/art/enemy-roster-v2.md 第三章），squad 用正式敌人 id。
//
// 几何：井心 C (100, 100)。坡道按「圈数」t 参数化：方位角 -90° + 360°·t（从正北顺时针），外缘半径 92 - 38t，
// 内缘半径 66 - 38t（坡道宽 26 m）。绕满一圈后坡道内缩 38 m，和上一圈之间隔一条 12 m 的熔岩缝。
// 平面白盒是平的，「下行」只在美术里表现（坡道每圈下降约 12 m）。
import { LOW, cover, pillar, rect, writePlan } from './common.mjs';
import { ding, inside, lavaPool, lavaStrip, lintLava, polar, prop, shrine, spiralBand } from './inferno-kit.mjs';

const C = [100, 100];
const angle = t => -Math.PI / 2 + Math.PI * 2 * t;
const outer = t => 92 - 38 * t, inner = t => 66 - 38 * t, mid = t => 79 - 38 * t;
/** A point on the ramp: lap fraction t, `fromInner` metres out from the ramp's inner (lava) edge. */
const at = (t, fromInner) => polar(C, angle(t), inner(t) + fromInner);
const band = (t0, t1) => spiralBand(C, angle, outer, inner, t0, t1);

const rooms = [
  { id: 'rim', label: '井口栈台', polygon: band(0, .06), labelAt: at(.03, 18) },
  { id: 'upper', label: '上环 · 炼渣回廊', polygon: band(.06, .255), labelAt: at(.12, 20) },
  { id: 'vent', label: '中环 · 风口', polygon: band(.305, .53), labelAt: at(.36, 20) },
  { id: 'falls', label: '熔瀑栈道', polygon: band(.585, .8), labelAt: at(.66, 18) },
  { id: 'store', label: '铸范库', polygon: rect(16, 117, 32, 133), labelAt: [24, 128] },
  { id: 'altar', label: '井底炉坛', polygon: band(.835, 1.15), labelAt: at(.92, 6) },
];
const room = id => rooms.find(r => r.id === id).polygon;

/**
 * An axis-aligned deck against the ramp's outer (rock) wall at lap fraction t: `depth` metres radially, `length`
 * along the wall, stairs on its two along-wall sides. Steps inward from the wall until deck and stairs lie in the room.
 */
function wallDeck(id, label, roomId, t, depth, length, height) {
  const a = angle(t), radialX = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
  const run = (Math.max(2, Math.round(height / .4)) - 1) * .65 + 1.8;
  for (let back = .5; back < 8; back += .25) {
    const [cx, cy] = polar(C, a, outer(t) - back - depth / 2);
    const [hx, hy] = radialX ? [depth / 2, length / 2] : [length / 2, depth / 2];
    const r = [+(cx - hx).toFixed(2), +(cy - hy).toFixed(2), +(cx + hx).toFixed(2), +(cy + hy).toFixed(2)];
    const probe = radialX ? [[r[0], r[1] - run], [r[2], r[1] - run], [r[0], r[3] + run], [r[2], r[3] + run]]
      : [[r[0] - run, r[1]], [r[0] - run, r[3]], [r[2] + run, r[1]], [r[2] + run, r[3]]];
    if (probe.every(p => inside(p, room(roomId))))
      return { id, label, rect: r, height, stairs: radialX ? [{ side: 'north', width: 4 }, { side: 'south', width: 4 }] : [{ side: 'west', width: 4 }, { side: 'east', width: 4 }] };
  }
  throw new Error(`${id}: no room for the deck`);
}
/** A low wall laid along the ramp at (t, fromInner): 6 m long, its long side following the wall direction. */
const curb = (t, fromInner, height = LOW) => {
  const [x, y] = at(t, fromInner), a = angle(t), radialX = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
  return radialX ? cover(+(x - .6).toFixed(2), +(y - 3).toFixed(2), +(x + .6).toFixed(2), +(y + 3).toFixed(2), height)
    : cover(+(x - 3).toFixed(2), +(y - .6).toFixed(2), +(x + 3).toFixed(2), +(y + .6).toFixed(2), height);
};
const chord = (roomA, tA, roomB, tB, width = 12) => ({ from: roomA, to: roomB, points: [polar(C, angle(tA), mid(tA)), polar(C, angle(tB), mid(tB))], width });

// 井心熔岩：井心一个半径 52 m 的圆，加上第一圈和第二圈之间那条熔岩缝（缝中线半径 60 - 38t）。
const seam = Array.from({ length: 20 }, (_, i) => { const t = .02 + i * .02; return polar(C, angle(t), 60 - 38 * t); });
// 出口：井底炉坛正北（t ≈ 0.98）贴着井心一侧的坡道内沿立祝融火门神龛，背靠熔岩井心、面朝北面的岩壁；
// 神龛只能正对东南西北，这里是炉坛上唯一一段内沿接近东西走向的地方（背墙离熔岩 1 m，守熔岩边 1 m 的落脚规则）。
const exitShrine = shrine(70.7, 96, 'north', 5);

const plan = {
  id: 'inferno-2-v2',
  revision: 'v2-slice-2',
  chapter: 'inferno',
  index: 2,
  title: '铸神井',
  subtitle: '绕井一圈多的螺旋坡道 · 上环回廊、中环风口与井底炉坛',
  identity: '祝融铸神兵用的竖井。坡道凿在井壁上，从井口顺时针绕着熔岩井心往下走一圈多：外侧是岩壁，内侧没有护栏，直接是井。整关只有一个方向——一直往里、往下。站在井口就能隔着井看到井底炉坛，在中环风口能看到对面上环刚打过的仗；越往下坡道越靠近井心，最后一段的井底炉坛两侧都是熔岩。三道从井壁伸出的岩肋把坡道收窄成 12 m 的关口，切出三场战斗；最后一道关口是贴着熔瀑、内侧直接临井的悬空栈道。',
  objective: '沿螺旋坡道下到井底：清空上环炼渣回廊和中环风口，击退井底炉坛的守军，乘炉坛升降台离开。',
  pacing: ['井口栈台：安全缓冲，俯瞰熔岩井，隔着熔岩缝望见井底炉坛', '上环 · 炼渣回廊：第一战，祸斗跟着炭童绕弯包抄，吃掉地上的炭童余烬变强', '岩肋关口：坡道被岩肋收窄到 12 m，过了关口视野重新打开', '中环 · 风口：第二战，两只炮仗傀儡扎堆在弯道远端齐射，马面狱卒把人从岩壁凹处拖到井沿', '熔瀑栈道：贴着熔瀑的悬空栈道，喘口气；外侧岩壁凿出一间铸范库', '井底炉坛：最终战，坡道最窄、两侧都是熔岩，神火飞鸦从井口上空俯冲，熔炉铁牛把人往前吸，胜利后乘炉坛升降台离开'],
  routeChoice: '纯螺旋单线，没有岔路回环；唯一的支路是熔瀑栈道外侧岩壁里的铸范库（死路藏宝点）。选择不在路线上，而在每段坡道上站哪：贴岩壁安全但被逼进凹处，靠井沿视野好但没有退路。',
  encounterLogic: '螺旋坡道的每一段都是弯的，看不到弯后，内侧又是井，三场都围着「弯道 + 井沿」出题。上环炼渣回廊：祸斗第一次出现。炭童倒下的余烬，你不补刀会复燃，补刀又要花时间；三只祸斗会顺着弯道从两头包抄，跑去吃余烬，吃过的祸斗变大、能喷火。要么快速补刀断它们的口粮，要么趁它低头吃火时从侧面打火腹。中环风口：炮仗傀儡和马面狱卒第一次出现。两只傀儡守在弯道远端，看不到你也能齐射覆盖弯道；它们挨得近，打爆一只会连环炸到另一只。马面在中距离甩勾魂索，把躲在岩壁凹处的人拖到井沿开阔处——拖拽中打链子能挣脱，打掉腕上锁芯就缴了它的械。井底炉坛：坡道两侧都是熔岩、最窄也最长，神火飞鸦第一次出现，从井口上空成群盘旋，沿直线俯冲，地上先亮一条朱红线，只能横移；熔炉铁牛第一次出现，仰头吸气时把人沿坡道往它那边拉，胸口炉门打开——顶着吸力往炉门里打能把它呛倒。后一场要求前一场已清空。',
  artBrief: 'V2（祝融火狱建筑套件 SM_Tripo_Inferno*，本机 Hunyuan3D，熔岩缝 / 炭火自发光）：熔岩竖井（井心与圈间熔岩缝都是开放空洞，没有挡墙，是踩进去会烫伤并被托回坡道的熔岩地面，熔岩光与热浪、飞鸦从中露出）、凿在玄武岩井壁上的螺旋坡道（每圈下降约 12 m，白盒是平的）、井口吊臂与铁链、风口的巨型鼓风口、熔瀑、井底炉坛与升降台。',
  whiteboxChecks: ['坡道宽 26 m，三道岩肋关口（含悬空栈道）宽 12 m，主连接合计不超过 80 m', '每场战斗的坡道段都有贴岩壁的高台，高台和台阶离熔岩至少 10 m', '可站立的掩体离井沿至少 6 m；井沿没有挡墙（熔岩地面）', '井口栈台隔着熔岩缝看得见井底炉坛'],
  bounds: [200, 200],
  rooms,
  passages: [
    { id: 'p1', ...chord('rim', .05, 'upper', .07), kind: 'main', note: '井口栈台直接接上上环回廊' },
    { id: 'p2', ...chord('upper', .25, 'vent', .31), kind: 'main', note: '岩肋关口：坡道被收窄到 12 m，过口望见对面的井壁' },
    { id: 'p3', ...chord('vent', .525, 'falls', .59), kind: 'main', note: '岩肋关口：内侧贴着井沿，下到熔瀑栈道' },
    { id: 'p4', ...chord('falls', .795, 'altar', .84), kind: 'main', note: '悬空栈道：贴着熔瀑下到井底炉坛' },
    { id: 'p5', from: 'falls', to: 'store', points: [at(.7, 13), [24, 125]], width: 7, kind: 'optional', note: '熔瀑栈道外侧岩壁里的铸范库' },
  ],
  entry: { room: 'rim', at: at(.03, 16) },
  exit: { room: 'altar', at: exitShrine.exit },
  mainRoute: ['p1', 'p2', 'p3', 'p4'],
  platforms: [
    wallDeck('upper-ledge', '回廊渣台', 'upper', .2, 7, 14, 3),
    wallDeck('vent-ledge', '风口检修台', 'vent', .45, 7, 14, 3.5),
    wallDeck('altar-ledge', '炉坛吊臂台', 'altar', .9, 6, 12, 3),
  ],
  voids: [lavaPool('shaft', '熔岩井心', C, 52), ...lavaStrip('seam', '圈间熔岩缝', seam, 6)],
  covers: [
    // 井口栈台：吊臂的配重铁锭
    prop('goods', ...at(.02, 22), 'south'),
    // 上环炼渣回廊：发红的炼渣堆（祸斗吃火的地方）、两道矮渣墙、一只青铜鼎、一根玄武岩柱
    curb(.1, 9), curb(.155, 14), ding(...at(.125, 20)), pillar(...at(.18, 9), 2, 4.5), prop('ruin', ...at(.235, 12), 'east'),
    prop('brazier', ...at(.085, 21)),
    // 中环风口：岩壁上的鼓风口两侧各一根柱，弯道上两道矮墙、一座锻台、一只青铜鼎
    pillar(...at(.38, 20), 2, 5), pillar(...at(.51, 20), 2, 5), curb(.34, 10), curb(.42, 8), curb(.5, 11),
    prop('stall', ...at(.395, 10), 'south'), ding(...at(.365, 17)),
    // 熔瀑栈道：栈道上的火坛与一车铁锭
    prop('brazier', ...at(.64, 9)), prop('goods', ...at(.76, 12), 'west'),
    // 铸范库：两堆祝融的青铜宝器夹着宝箱
    prop('hoard', 20, 121, 'east'), prop('hoard', 28, 131, 'north'),
    // 井底炉坛：两道矮墙、两只青铜鼎
    curb(.95, 12), curb(1.04, 10), ding(...at(.99, 19)), ding(...at(1.08, 8)), ...exitShrine.covers,
  ],
  encounters: [
    { id: 'A', at: at(.2, 14), room: 'upper', label: '回廊祸斗', roster: '祸斗 3 + 炭童 3：祸斗沿弯道包抄，吃炭童的余烬变强；快补刀，或趁它低头吃火打火腹', timing: '深入上环回廊触发', facing: at(.085, 13),
      squad: [['huodou', 3], ['tantong', 3]] },
    { id: 'B', at: at(.47, 13), room: 'vent', label: '风口炮阵', roster: '炮仗傀儡 2 + 马面狱卒 1 + 炭童 2：傀儡隔着弯道齐射，扎堆的打一只连环炸；马面把人拖到井沿', timing: '深入中环风口触发', facing: at(.335, 13),
      squad: [['firecracker', 2], ['mamian', 1], ['tantong', 2]], requires: ['A'] },
    { id: 'C', at: at(1.02, 14), room: 'altar', label: '井底飞鸦铁牛', roster: '神火飞鸦 4 + 熔炉铁牛 1：飞鸦沿直线俯冲，只能横移；铁牛吸气时顶着吸力打炉门', timing: '下到井底炉坛深处触发', facing: at(.87, 13),
      squad: [['fire_crow', 4], ['iron_ox', 1]], requires: ['B'] },
  ],
  rewards: [
    { at: at(.23, 20), room: 'upper', label: '回廊炼渣里的金块', reward: 'coins', requires: ['A'] },
    { at: [24, 126], room: 'store', label: '铸范库秘藏', reward: 'scroll', requires: ['B'] },
    { at: at(1.1, 20), room: 'altar', label: '炉坛供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: at(.03, 16), to: at(1.05, 14), label: '井口隔着熔岩缝俯瞰井底炉坛' },
    { from: at(.33, 13), to: at(.15, 6), label: '风口关口回望上环回廊' },
    { from: at(.6, 10), to: at(1.1, 13), label: '熔瀑栈道隔着井心望见炉坛升降台' },
  ],
  notes: [
    { at: C, text: '熔岩井心（半径 52 m）与圈间熔岩缝：熔岩地面，没有挡墙：落井扣血并被托回坡道，敌人被击退下去会烧死' },
    { at: at(.45, 20), text: '风口：岩壁上的巨型鼓风口，以后可做周期性的热风（把人往井沿推）' },
    { at: at(.84, 13), text: '悬空栈道：唯一一段内侧直接临井的连接，熔瀑从外侧岩壁泻下' },
  ],
};

lintLava(plan);
await writePlan(plan);
