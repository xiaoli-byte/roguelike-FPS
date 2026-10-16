// V2 floor plan: 火狱第 1 关「熔湖堤道」。祝融火狱的外湖是一整片熔岩湖，一条玄武岩堤道从南岸蛇行到北岸宫门，
// 沿途两座堤墩是战场；湖面没有一堵墙，一进场整条路线、每一座墩上的守军和湖心的石龛都看得见。
// node scripts/level-plans/v2/inferno-1.mjs  → 写入 docs/level-design/plans-v2/inferno.json，再运行 whitebox:sync。
//
// 怪物：第三章阵容表（docs/art/enemy-roster-v2.md「第三章 · 祝融火狱 — 阵容表」，2026-10-11 设计稿待审）尚未实装，
// 怪物：第三章阵容（2026-10-11 用户确认，docs/art/enemy-roster-v2.md 第三章），squad 用正式敌人 id。
import { LOW, arena, cover, ngon, pillar, writePlan } from './common.mjs';
import { ding, lavaPool, lintLava, prop, shrine } from './inferno-kit.mjs';

// 宫门：码头北墙正中的祝融火门神龛，出口传送门开在拱里。
const exit = shrine(8, 80, 'south', 6);

const plan = {
  id: 'inferno-1-v2',
  revision: 'v2-slice-1',
  chapter: 'inferno',
  index: 1,
  title: '熔湖堤道',
  subtitle: '熔岩湖上的蛇形堤道 · 税关墩、锚链墩与宫门码头',
  identity: '祝融火狱的门户不是一座院子，而是一整片熔岩湖。玩家站在南岸渡口，一眼就能看到整条路线：玄武岩堤道向西北伸进湖里，接上税关墩，再斜着横过湖面到锚链墩，最后笔直北上，靠上宫门码头。湖面上没有一堵墙，每座墩四面都是熔岩；只有宫门码头背靠宫墙。湖心还有一座石龛，宝箱在龛里发光，从渡口就看得见，却要从锚链墩拐一条窄堤才能过去。',
  objective: '沿堤道穿过熔岩湖，清空税关墩与锚链墩，击退宫门码头的守军，进入祝融宫门。',
  pacing: ['南岸渡口：安全缓冲，整条堤道、两座墩、湖心石龛和对岸宫门一览无余', '税关墩：第一战，炭童群从墩上四面围上来，墩边就是熔岩，没有墙角可以背靠；打倒的炭童要补刀', '锚链墩：第二战，两只毕方单足立在锚链石桩顶上点射火矛，打它那条腿把它打下来', '湖心石龛：锚链墩南侧一条窄堤，清场后可去取过湖贡品', '宫门码头：最终战，火鼍潜在码头南缘的熔岩里，扑上岸咬人；把它引到宫墙下，离开熔岩它就长不回岩甲，胜利后宫门开启'],
  routeChoice: '一条蛇形单线，三段堤道各转一次方向；锚链墩南侧的窄堤通往湖心石龛，是死路藏宝点。走窄堤要在熔岩中间来回一趟，宝箱从开场就看得见。',
  encounterLogic: '第一关一场只教一件事，而且都由「四面是熔岩」这个处境出题。税关墩：只有炭童群。墩上没有墙，被围时退无可退，在墩中央的税亭台和墩边之间来回拉扯；炭童倒下会碎成余烬，4 秒后复燃，同伴还会蹲下吹火，学会补一枪或踩散炭堆。锚链墩：毕方第一次出现。四根 5 m 高的锚链石桩是它的栖点，它单足立在桩顶点射，「毕」一声就该横移；墩上没有更高的地方，打它唯一的那条腿把它打下来，两只炭童负责把人从石桩后面赶出来。宫门码头：火鼍第一次出现。码头南缘整条临着熔岩湖，它潜在熔岩里沿岸游、看到岸边鼓泡就是要扑；北面是宫墙和门阙。把它引到宫墙下打，离开熔岩它就回不去长岩甲；鼓楼台能从上面看清它脊背的接缝。别背对湖面站，甩尾会把人扫向熔岩。后一场要求前一场已清空。',
  artBrief: 'V2（祝融火狱建筑套件 SM_Tripo_Inferno*，本机 Hunyuan3D，熔岩缝 / 炭火自发光）：熔岩湖（不可通行的开放空洞，没有挡墙，是踩进去会烫伤并被托回岸上的熔岩地面，熔岩、热浪和潜游的火鼍从中露出）、黑色玄武岩堤道与堤墩、墩上的税亭、锚链石桩和青铜鼎，北岸是玄铁宫墙与朱红门阙，湖周是火山口崖壁。',
  whiteboxChecks: ['三段主堤宽 12 m，合计约 78 m，每段只转一次方向', '每座墩和码头都有可经台阶到达的高台，高台和台阶离熔岩至少 10 m', '可站立的掩体离熔岩至少 6 m；湖面是熔岩地面（没有挡墙，踩进去扣血并被托回岸上），没有落脚点', '湖心石龛窄堤宽 7 m', '锚链墩四根石桩 5 m（毕方栖点，高于 4 m）'],
  bounds: [180, 190],
  rooms: [
    { id: 'ferry', label: '南岸渡口', polygon: [[72, 170], [112, 170], [116, 177], [112, 184], [72, 184], [68, 177]], labelAt: [100, 178] },
    { id: 'toll', label: '税关墩', polygon: arena(30, 112, 78, 156, 8), labelAt: [40, 116] },
    { id: 'anchor', label: '锚链墩', polygon: arena(98, 64, 146, 108, 8), labelAt: [140, 90] },
    { id: 'shrine', label: '湖心石龛', polygon: ngon(140, 140, 10, 10, 10), labelAt: [140, 145] },
    { id: 'quay', label: '宫门码头', polygon: arena(44, 8, 116, 46, 8), labelAt: [100, 32] },
  ],
  passages: [
    { id: 'p1', from: 'ferry', to: 'toll', points: [[78, 172], [70, 152]], width: 12, kind: 'main', note: '第一段堤道向西北伸进湖里，接上税关墩' },
    { id: 'p2', from: 'toll', to: 'anchor', points: [[72, 118], [102, 102]], width: 12, kind: 'main', note: '第二段堤道斜着横过湖面，两侧都是熔岩' },
    { id: 'p3', from: 'anchor', to: 'quay', points: [[110, 66], [110, 44]], width: 12, kind: 'main', note: '第三段堤道笔直北上，正对宫门' },
    { id: 'p4', from: 'anchor', to: 'shrine', points: [[128, 106], [138, 131]], width: 7, kind: 'optional', note: '锚链墩南侧的窄堤，通往湖心石龛' },
  ],
  entry: { room: 'ferry', at: [92, 178] },
  exit: { room: 'quay', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'toll-house', label: '税亭台', rect: [48, 128, 60, 140], height: 3, stairs: [{ side: 'west', width: 4 }, { side: 'east', width: 4 }] },
    { id: 'anchor-winch', label: '绞盘台', rect: [116, 80, 128, 92], height: 3, stairs: [{ side: 'north', width: 4 }, { side: 'south', width: 4 }] },
    { id: 'quay-drum-west', label: '西鼓楼台', rect: [54, 12, 66, 24], height: 3.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'quay-drum-east', label: '东鼓楼台', rect: [94, 12, 106, 24], height: 3.5, stairs: [{ side: 'south', width: 4 }] },
  ],
  // 熔岩湖：一个圆覆盖整片湖面，圆内不是地面的格子都成为熔岩地面（没有挡墙：踩进去扣血并被托回岸上）；圆外是火山口崖壁。
  voids: [lavaPool('lake', '熔岩湖', [90, 100], 80)],
  covers: [
    // 税关墩：中央税亭台两侧各一道矮栏，西侧一只过税的青铜鼎，东南墩口一车被扣下的铁锭
    cover(38.5, 140, 39.7, 146, LOW), cover(68.3, 124, 69.5, 130, LOW), ding(40, 124),
    prop('goods', 46, 148, 'north'), prop('brazier', 64, 124),
    // 锚链墩：四根 5 m 锚链石桩围着绞盘台（毕方的栖点），西侧一道矮栏，东侧一堆断链
    pillar(106, 72, 2, 5), pillar(138, 72, 2, 5), pillar(106, 100, 2, 5), pillar(138, 100, 2, 5),
    cover(104.5, 84, 105.7, 90, LOW), prop('ruin', 137, 86, 'west'),
    // 湖心石龛：龛前两只青铜鼎
    ding(134, 140, 2.4), ding(146, 140, 2.4),
    // 宫门码头：北墙正中的火门神龛就是宫门，两座鼓楼台外侧各一座火坛；码头上两道矮墙，两只青铜鼎；东北角卸下的铁锭
    ...exit.covers, prop('brazier', 50, 30), prop('brazier', 108, 30),
    cover(64, 34, 70, 35.2, LOW), cover(90, 34, 96, 35.2, LOW), ding(58, 36), ding(102, 36),
    prop('goods', 76, 30, 'north'),
    // 南岸渡口：渡口卸下的一车矿石
    prop('goods', 108, 180, 'west'),
  ],
  encounters: [
    { id: 'A', at: [44, 120], room: 'toll', label: '税关墩炭童群', roster: '炭童 5：只有群怪，余烬不补刀会复燃；墩上四面临熔岩，没有墙角可背靠', timing: '踏上税关墩深处触发', facing: [66, 148],
      squad: [['tantong', 5]] },
    { id: 'B', at: [128, 74], room: 'anchor', label: '锚链墩毕方', roster: '毕方 2 + 炭童 2：毕方立在锚链石桩顶点射火矛，打腿把它打下来；炭童把人赶出石桩', timing: '踏上锚链墩深处触发', facing: [104, 100],
      squad: [['bifang', 2], ['tantong', 2]], requires: ['A'] },
    { id: 'C', at: [80, 28], room: 'quay', label: '码头火鼍', roster: '火鼍 1 + 炭童 2：沿岸潜游扑咬，引到宫墙下剥岩甲，别背对熔岩', timing: '登上宫门码头触发', facing: [104, 40],
      squad: [['tuo', 1], ['tantong', 2]], requires: ['B'] },
  ],
  rewards: [
    { at: [36, 130], room: 'toll', label: '税关扣下的过路钱', reward: 'coins', requires: ['A'] },
    { at: [140, 141], room: 'shrine', label: '湖心石龛贡品', reward: 'scroll', requires: ['B'] },
    { at: [62, 30], room: 'quay', label: '宫门供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [92, 178], to: [54, 134], label: '渡口望见税关墩税亭' },
    { from: [92, 178], to: [140, 140], label: '渡口隔着熔岩望见湖心石龛' },
    { from: [102, 102], to: [80, 10], label: '锚链墩望见对岸宫门' },
  ],
  notes: [
    { at: [90, 100], text: '熔岩湖（半径 80 m 的圆内）：熔岩地面，没有挡墙；踩进去扣血、灼烧，0.5 秒后被托回上一块落脚点；敌人被击退下去会烧死' },
    { at: [54, 134], text: '税亭台 3 m，墩中央唯一的高点；离熔岩 10 m 以上' },
    { at: [80, 44], text: '码头南缘：火鼍的潜游岸线。火鼍沿这条岸线在熔岩里游动、鼓泡扑岸（待实装）；把敌人击退下岸会烧死' },
    { at: [80, 18], text: '宫门：北墙正中的祝融火门神龛（约 9.9 m 宽），出口传送门开在拱里' },
  ],
};

lintLava(plan);
await writePlan(plan);
