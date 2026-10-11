// V2 floor plan: 沙寺第 4 关「错门寺城」。三进寺院，每道院门都错开位置，之字形推进到正殿。
// node scripts/level-plans/v2/desert-4.mjs  → 写入 docs/level-design/plans-v2/desert.json，再运行 whitebox:sync。
import { FULL, LOW, arena, cover, gatePosts, pillar, prop, rect, shrine, writePlan } from './common.mjs';

const exit = shrine(6, 112, 'south');

await writePlan({
  id: 'desert-4-v2',
  revision: 'v2-slice-4',
  chapter: 'desert',
  index: 4,
  title: '错门寺城',
  subtitle: '三进寺院 · 习武庭、旗庭与正殿庭',
  identity: '寺城的院门从不对齐：南候场向北进习武庭，出门却要向东绕进旗庭，再从旗庭北门进正殿庭，神龛嵌在正殿北墙。每道院门都由门楼框住下一院的地标：习武庭望见旗台，旗庭望见正殿神龛。',
  objective: '依次肃清习武庭、旗庭与正殿庭，从正殿神龛离开。',
  pacing: ['南候场：安全缓冲，望见习武庭演武台', '习武庭：第一战，跳鼠、火鼠、弩卫三种地面怪同场，抢东西两座演武台', '旗庭：第二战，蜃楼蟾隔着中央旗台曲射，镇墓兽在开阔旗庭里横冲，四角立柱与低墙穿插', '西僧廊：清场后可调查的经卷室', '正殿庭：最终战，邪飞天给精英镇墓兽赐福，先打飞天再引镇墓兽撞墙，胜利后神龛开启'],
  routeChoice: '院门错位：习武庭北上、旗庭东折、正殿北上，主线两次转向；旗庭西侧僧廊可选，门楼框口。',
  encounterLogic: '寺城把前三关学过的东西组合起来考。习武庭：三种地面怪第一次同场，跳鼠扑、火鼠滚、弩卫钻沙，两座演武台是唯一的高点。旗庭：蜃楼蟾在中央旗台对面曲射，镇墓兽在开阔的旗庭里横冲，蜃景分身让人分不清该躲哪颗火珠。正殿：终局考题。邪飞天躲在精英镇墓兽身后，给它天乐光环和赐福（伤害约 2.7 倍，一撞就是重伤），所以第一件事是越过冲撞线打碎琵琶或击杀飞天；之后再引精英撞墙，同时盯住配殿台下钻沙的弩卫。后一场要求前一场已清空。',
  artBrief: 'V2：沙寺建筑套件；习武庭以立柱与低墙、旗庭以中央旗台、正殿庭以配殿台与火盆神道定身份。',
  whiteboxChecks: ['主线通道宽 12 m，合计 42 m', '三个院落各有可经台阶到达的高台', '正殿东西配殿台 3.5 m，夹出直通神龛的神道'],
  bounds: [150, 172],
  rooms: [
    { id: 'south', label: '南候场', polygon: [[30, 146], [54, 146], [58, 152], [58, 164], [54, 168], [30, 168], [26, 164], [26, 152]], labelAt: [42, 160] },
    { id: 'drill', label: '习武庭', polygon: arena(14, 76, 70, 132), labelAt: [42, 84] },
    { id: 'banner', label: '旗庭', polygon: arena(84, 70, 140, 124), labelAt: [100, 118] },
    { id: 'cloister', label: '西僧廊', polygon: rect(66, 20, 84, 44), labelAt: [75, 32] },
    { id: 'sanctum', label: '正殿庭', polygon: arena(84, 6, 140, 56), labelAt: [112, 50] },
  ],
  passages: [
    { id: 'p1', from: 'south', to: 'drill', points: [[42, 146], [42, 132]], width: 12, kind: 'main', note: '候场北门直入习武庭，正对两座演武台之间' },
    { id: 'p2', from: 'drill', to: 'banner', points: [[70, 100], [84, 100]], width: 12, kind: 'main', note: '习武庭东门错开，望见旗庭中央旗台' },
    { id: 'p3', from: 'banner', to: 'sanctum', points: [[112, 70], [112, 56]], width: 12, kind: 'main', note: '旗庭北门直视正殿月台' },
    { id: 'p4', from: 'sanctum', to: 'cloister', points: [[90, 32], [78, 32]], width: 7, kind: 'optional', note: '正殿庭西墙的僧廊经卷室，门楼门洞约 7.2 m' },
  ],
  entry: { room: 'south', at: [42, 160] },
  exit: { room: 'sanctum', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'drill-stage-west', label: '习武庭西演武台', rect: [20, 92, 30, 116], height: 2.5, stairs: [{ side: 'east', width: 4 }] },
    { id: 'drill-stage-east', label: '习武庭东演武台', rect: [52, 108, 62, 124], height: 3, stairs: [{ side: 'west', width: 4 }] },
    { id: 'banner-dais', label: '旗庭中央旗台', rect: [104, 88, 120, 104], height: 3, stairs: [{ side: 'west', width: 4 }, { side: 'east', width: 4 }] },
    { id: 'sanctum-terrace-west', label: '正殿西配殿台', rect: [92, 12, 106, 24], height: 3.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'sanctum-terrace-east', label: '正殿东配殿台', rect: [118, 12, 132, 24], height: 3.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'sanctum-wing', label: '正殿东侧廊台', rect: [128, 30, 136, 48], height: 2, stairs: [{ side: 'west', width: 4 }] },
  ],
  covers: [
    // 习武庭：练武立柱、低墙与兵器货堆
    pillar(36, 96), pillar(48, 96), pillar(36, 116), pillar(42, 106, 2.4, 5),
    cover(22, 124, 28, 125.2, LOW), cover(60, 84, 61.2, 90, FULL), prop('goods', 64, 94, 'west'), prop('goods', 20, 84, 'east'),
    // 南候场：火盆迎客
    prop('brazier', 34, 150), prop('brazier', 50, 150),
    // 旗庭：四角立柱、旗台前后低墙、倒塌柱段
    pillar(94, 80), pillar(130, 80), pillar(94, 114), pillar(130, 114),
    cover(91, 90, 92.2, 96, LOW), cover(131, 92, 132.2, 98, LOW), prop('ruin', 112, 116, 'north'),
    // 正殿庭：月台前两道低墙与全掩护、财宝供奉，神龛两侧火盆
    cover(98, 34, 104, 35.2, LOW), cover(120, 34, 126, 35.2, LOW), pillar(104, 44), pillar(120, 44),
    prop('brazier', 108, 18), prop('brazier', 116, 18),
    ...exit.covers,
    // 西僧廊：经卷财宝夹着宝箱，门楼卡住入口
    prop('hoard', 70, 25, 'east'), prop('hoard', 70, 39, 'east'),
    ...gatePosts('y', 20, 24, 84, 'east'),
  ],
  encounters: [
    { id: 'A', at: [42, 100], room: 'drill', label: '演武场混战', roster: '跳鼠刀兵 4 + 火浣鼠 2 + 蝎尾弩卫 2：三种地面怪第一次同场，抢演武台', timing: '深入习武庭触发', facing: [42, 122],
      squad: [['jerboa_blade', 4], ['fire_rat', 2], ['scorpion_archer', 2]] },
    { id: 'B', at: [112, 108], room: 'banner', label: '旗台炮与冲', roster: '蜃楼蟾 1 + 镇墓兽 1 + 跳鼠刀兵 2：一边躲曲射一边躲冲撞', timing: '深入旗庭触发', facing: [94, 100],
      squad: [['mirage_toad', 1], ['tomb_beast', 1], ['jerboa_blade', 2]], requires: ['A'] },
    { id: 'C', at: [112, 30], room: 'sanctum', label: '正殿护法', roster: '精英镇墓兽 1 + 蝎尾弩卫 2 + 跳鼠刀兵 2 + 邪飞天 1：飞天赐福的精英镇墓兽一撞就是重伤，必须先打飞天', timing: '深入正殿庭触发', facing: [112, 46],
      squad: [['tomb_beast', 1, true], ['scorpion_archer', 2], ['jerboa_blade', 2], ['apsara', 1]], requires: ['B'] },
  ],
  rewards: [
    { at: [64, 82], room: 'drill', label: '习武庭兵器箱', reward: 'coins', requires: ['A'] },
    { at: [72, 32], room: 'cloister', label: '僧廊经卷', reward: 'scroll', requires: ['B'] },
    { at: [112, 36], room: 'sanctum', label: '正殿供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [42, 160], to: [42, 104], label: '候场望见习武庭中央' },
    { from: [70, 100], to: [112, 96], label: '习武庭东门望见旗台' },
    { from: [112, 70], to: [112, 8], label: '旗庭北门望见正殿神龛' },
  ],
  notes: [
    { at: [112, 96], text: '旗台 3 m，东西两道台阶；抢上旗台能俯射蜃楼蟾，也能躲镇墓兽冲撞' },
    { at: [112, 18], text: '东西配殿台 3.5 m 夹出神道，神龛嵌在北墙' },
  ],
});
