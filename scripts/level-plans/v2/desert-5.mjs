// V2 floor plan: 沙寺第 5 关「沙王仪场」（首领关）。商旅补给院 → 转一次弯的门楼通道 → 八角沙王仪场。
// node scripts/level-plans/v2/desert-5.mjs  → 写入 docs/level-design/plans-v2/desert.json，再运行 whitebox:sync。
import { LOW, arena, cover, pillar, prop, rect, shrine, writePlan } from './common.mjs';

const exit = shrine(110, 55, 'west');

await writePlan({
  id: 'desert-5-v2',
  revision: 'v2-slice-5',
  chapter: 'desert',
  index: 5,
  title: '沙王仪场',
  subtitle: '商旅补给院 · 八角沙王仪场',
  identity: '首领关只有两段：在商旅补给院整备，沿一条转一次弯的门楼通道进入八角形的沙王仪场。补给院看不到仪场，进场后巨像立在场地中央，南北两座祭墩、四根巨柱与被砸碎的柱段提供躲避；神龛在仪场东墙，胜利后开启。',
  objective: '在补给院整备，进入仪场击败沙暴巨像，从东墙神龛离开。',
  pacing: ['商旅补给院：安全整备，商人摊位与补给', '门楼通道：一次转向，补给院看不到仪场', '沙王仪场：首领战，祭墩高差与巨柱掩护，胜利后神龛开启'],
  routeChoice: '单线：补给院 → 门楼通道 → 仪场；无支路。',
  encounterLogic: '跨入仪场后触发首领；补给院与通道内购物、停留都不会触发。',
  artBrief: 'V2：沙寺建筑套件；仪场以巨柱、祭墩、碎柱段与神龛火盆定身份，背后巨像地标与首领呼应。',
  whiteboxChecks: ['补给院商人摊位 8 m 内无遮挡', '仪场 70 x 70 m，两座 2.5 m 祭墩', '通道宽 10 m，一次转向，补给院不可直视仪场'],
  bounds: [120, 136],
  rooms: [
    { id: 'preparation', label: '商旅补给院', polygon: rect(4, 94, 40, 130), labelAt: [32, 124] },
    { id: 'arena', label: '沙王仪场', polygon: arena(40, 20, 110, 90, 10), labelAt: [75, 84] },
  ],
  passages: [
    { id: 'p1', from: 'preparation', to: 'arena', points: [[22, 94], [22, 72], [40, 72]], width: 10, kind: 'main', note: '补给院北门出，转一次弯从西门进入仪场；门楼立在直段中央' },
  ],
  entry: { room: 'preparation', at: [12, 124] },
  exit: { room: 'arena', at: exit.exit },
  mainRoute: ['p1'],
  preparation: { room: 'preparation', at: [22, 114], facing: [22, 122], label: '沙王仪场前补给' },
  platforms: [
    { id: 'arena-mound-north', label: '北祭墩', rect: [64, 30, 76, 40], height: 2.5, stairs: [{ side: 'south', width: 4 }] },
    { id: 'arena-mound-south', label: '南祭墩', rect: [64, 70, 76, 80], height: 2.5, stairs: [{ side: 'north', width: 4 }] },
  ],
  covers: [
    // 补给院：角落里的商队货堆（商人摊位周围 8 m 保持空旷）
    prop('goods', 8, 99, 'east'), prop('goods', 36, 99, 'west'), prop('goods', 8, 126, 'east'),
    // 沙王仪场：四根巨柱、被巨像砸碎的柱段、两道低墙
    pillar(56, 40, 3, 6), pillar(56, 70, 3, 6), pillar(92, 36, 3, 6), pillar(92, 74, 3, 6),
    prop('ruin', 84, 28, 'south'), prop('ruin', 84, 82, 'north'), prop('ruin', 50, 55, 'east'),
    cover(78, 46, 79.2, 52, LOW), cover(78, 58, 79.2, 64, LOW),
    // 神龛神道两侧火盆
    prop('brazier', 98, 49), prop('brazier', 98, 61), prop('brazier', 104, 48), prop('brazier', 104, 62),
    ...exit.covers,
  ],
  encounters: [
    { id: 'BOSS', at: [72, 55], room: 'arena', label: '沙暴巨像', roster: '1 沙暴巨像，实际半径 2.1 米；无额外常驻巡逻小队', timing: '跨入仪场后触发；击败后神龛开启', facing: [52, 72],
      squad: [['boss_colossus', 1]] },
  ],
  rewards: [
    { at: [94, 55], room: 'arena', label: '沙王战后奖励', reward: 'upgrade', requires: ['BOSS'] },
  ],
  sightlines: [
    { from: [22, 94], to: [22, 72], label: '补给院北门只看到通道转角，看不到仪场' },
    { from: [40, 72], to: [108, 55], label: '仪场西门望见东墙神龛与巨像' },
  ],
  notes: [
    { at: [70, 35], text: '北祭墩 2.5 m，南侧台阶；与南祭墩一起提供高差躲避' },
  ],
});
