// V2 floor plan: 沙寺第 3 关「沉沙围城」。被流沙半埋的围城：瓮城 → 城楼前 → 东南门前，U 形推进。
// node scripts/level-plans/v2/desert-3.mjs  → 写入 docs/level-design/plans-v2/desert.json，再运行 whitebox:sync。
import { FULL, LOW, arena, cover, gatePosts, pillar, prop, rect, shrine, writePlan } from './common.mjs';

const exit = shrine(150, 121, 'west');

await writePlan({
  id: 'desert-3-v2',
  revision: 'v2-slice-3',
  chapter: 'desert',
  index: 3,
  title: '沉沙围城',
  subtitle: '围城三段 · 西瓮城、北城楼与东南门前',
  identity: '从南城缺口钻进被流沙半埋的围城：先在西瓮城里躲开被困的镇墓兽，再向东顶着炮火攻上北城楼前的炮台，最后折向南面的东南门前，神龛在门洞尽头。路线呈 U 形，每次转向都由门楼框出下一场地。',
  objective: '肃清瓮城、拔掉城楼炮阵，击败东南门前的守军，从神龛离开。',
  pacing: ['南城缺口：安全缓冲，望见瓮城断塔', '西瓮城：第一战，封闭瓮城里的镇墓兽与火浣鼠，城墙走道与断塔是喘息点', '北城楼前：第二战，没有近战，蜃楼蟾在城台下越墙曲射，弩卫守中距离，柱与残墙掩护推进', '北侧残屋：清场后可调查的藏宝间', '东南门前：最终战，邪飞天鼓舞四只火浣鼠，加速带盾的火球冲过来，先断飞天，胜利后神龛开启'],
  routeChoice: '主线两次转向（瓮城向东、城楼向南）；城楼北侧残屋可选，门楼框口，不形成回环。',
  encounterLogic: '围城把难点拆开。瓮城：封闭的瓮城里关着一只镇墓兽，三只火浣鼠从断塔两侧滚出来，躲冲撞的时候还得留意脚下，城墙走道是喘息点。城楼前：没有近战，只有蜃楼蟾在 4 米城台下越墙曲射、投出蜃景分身，两只弩卫守中距离，要顶着炮火推进。门前：邪飞天在后排鼓舞四只火浣鼠，加速又带护盾的火球很难在半路打爆，必须先断飞天。后一场要求前一场已清空。',
  artBrief: 'V2：沙寺建筑套件；以倒塌柱段、残墙与城墙走道表现围城破败，东南门前以火盆神道收束。',
  whiteboxChecks: ['主线通道宽 12 m，合计 46 m', '三个战斗场地各有可经台阶到达的高台', '城楼炮台 4 m，二段跳或台阶可上'],
  bounds: [160, 160],
  rooms: [
    { id: 'breach', label: '南城缺口', polygon: [[22, 128], [48, 128], [52, 134], [52, 150], [48, 154], [22, 154]], labelAt: [36, 146] },
    { id: 'barbican', label: '西瓮城', polygon: arena(10, 50, 66, 110), labelAt: [44, 58] },
    { id: 'gatehouse', label: '北城楼前', polygon: arena(80, 30, 140, 82), labelAt: [120, 76] },
    { id: 'ruins', label: '北侧残屋', polygon: rect(102, 12, 122, 30), labelAt: [112, 22] },
    { id: 'court', label: '东南门前', polygon: arena(96, 96, 150, 146), labelAt: [104, 130] },
  ],
  passages: [
    { id: 'p1', from: 'breach', to: 'barbican', points: [[36, 128], [36, 110]], width: 12, kind: 'main', note: '缺口向北钻进瓮城，正对中央断塔' },
    { id: 'p2', from: 'barbican', to: 'gatehouse', points: [[66, 66], [80, 66]], width: 12, kind: 'main', note: '瓮城东门直视城楼炮台' },
    { id: 'p3', from: 'gatehouse', to: 'court', points: [[118, 82], [118, 96]], width: 12, kind: 'main', note: '城楼南口望见东南门前神道' },
    { id: 'p4', from: 'gatehouse', to: 'ruins', points: [[112, 36], [112, 22]], width: 7, kind: 'optional', note: '城楼北墙的残屋，门楼门洞约 8 m' },
  ],
  entry: { room: 'breach', at: [36, 146] },
  exit: { room: 'court', at: exit.exit },
  mainRoute: ['p1', 'p2', 'p3'],
  platforms: [
    { id: 'barbican-walk', label: '瓮城西墙走道', rect: [12, 64, 20, 98], height: 3.5, stairs: [{ side: 'east', offset: -10, width: 4 }, { side: 'east', offset: 10, width: 4 }] },
    { id: 'barbican-tower', label: '瓮城断塔基座', rect: [38, 72, 48, 82], height: 2.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'gatehouse-terrace', label: '城楼东侧炮台', rect: [124, 40, 136, 70], height: 4, stairs: [{ side: 'west', offset: -9, width: 4 }, { side: 'west', offset: 9, width: 4 }] },
    { id: 'gatehouse-bastion', label: '城楼西北棱堡', rect: [86, 36, 98, 46], height: 2.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'court-dais-north', label: '神道北侧台', rect: [130, 102, 144, 112], height: 2, stairs: [{ side: 'west', width: 5 }] },
    { id: 'court-dais-south', label: '神道南侧台', rect: [130, 130, 144, 140], height: 2, stairs: [{ side: 'west', width: 5 }] },
  ],
  covers: [
    // 西瓮城：倒塌柱段、残墙、围城物资；东南角留空，给镇墓兽冲撞，西侧全掩护墙用来引它撞晕
    prop('ruin', 30, 70, 'south'), prop('ruin', 58, 72, 'west'),
    cover(28, 90, 34, 91.2, FULL), cover(50, 62, 56, 63.2, LOW), pillar(26, 104), pillar(58, 60),
    prop('goods', 22, 104, 'east'),
    // 南城缺口：卸下的攻城物资
    prop('goods', 26, 146, 'east'),
    // 北城楼前：碎石、残墙、立柱与散落物资
    prop('ruin', 100, 60, 'north'), cover(106, 48, 112, 49.2, LOW), cover(92, 66, 93.2, 72, FULL),
    pillar(118, 56), pillar(104, 40), prop('goods', 110, 74, 'north'),
    // 北侧残屋：财宝堆夹着宝箱，门楼卡住入口
    prop('hoard', 106, 15, 'south'), prop('hoard', 118, 15, 'south'),
    ...gatePosts('x', 102, 20, 30, 'south'),
    // 东南门前：入口门柱、低墙与全掩护、倒塌柱段，神道火盆
    pillar(106, 106, 2.4, 5), cover(108, 118, 114, 119.2, LOW), cover(120, 126, 121.2, 132, FULL),
    prop('ruin', 112, 138, 'north'),
    prop('brazier', 128, 116), prop('brazier', 128, 126), prop('brazier', 141, 115), prop('brazier', 141, 127),
    ...exit.covers,
  ],
  encounters: [
    { id: 'A', at: [48, 94], room: 'barbican', label: '瓮城困兽', roster: '镇墓兽 1 + 火浣鼠 3：封闭场地里一边躲冲撞一边躲火球', timing: '深入瓮城触发', facing: [36, 100],
      squad: [['tomb_beast', 1], ['fire_rat', 3]] },
    { id: 'B', at: [110, 58], room: 'gatehouse', label: '城楼炮阵', roster: '蜃楼蟾 1 + 蝎尾弩卫 2：纯远程，顶着曲射和真假火珠推进', timing: '深入城楼前触发', facing: [90, 66],
      squad: [['mirage_toad', 1], ['scorpion_archer', 2]], requires: ['A'] },
    { id: 'C', at: [118, 121], room: 'court', label: '门前火阵', roster: '火浣鼠 4 + 跳鼠刀兵 2 + 邪飞天 1：被光环加速、带护盾的火鼠很难在半路打爆，先断飞天', timing: '深入东南门前触发', facing: [118, 106],
      squad: [['fire_rat', 4], ['jerboa_blade', 2], ['apsara', 1]], requires: ['B'] },
  ],
  rewards: [
    { at: [56, 106], room: 'barbican', label: '瓮城补给箱', reward: 'coins', requires: ['A'] },
    { at: [112, 16], room: 'ruins', label: '残屋秘藏', reward: 'scroll', requires: ['B'] },
    { at: [134, 121], room: 'court', label: '门前供箱', reward: 'upgrade', requires: ['C'] },
  ],
  sightlines: [
    { from: [36, 146], to: [43, 77], label: '缺口望见瓮城断塔' },
    { from: [66, 66], to: [130, 55], label: '瓮城东门望见城楼炮台' },
    { from: [118, 82], to: [148, 121], label: '城楼南口望见门前神龛' },
  ],
  notes: [
    { at: [130, 55], text: '城楼炮台 4 m，蜃楼蟾守在台下曲射，抢上炮台可以俯射它' },
    { at: [16, 81], text: '瓮城西墙走道 3.5 m，躲镇墓兽冲撞的高点，两道台阶' },
  ],
});
