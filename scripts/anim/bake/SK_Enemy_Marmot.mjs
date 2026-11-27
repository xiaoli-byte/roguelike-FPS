// 啸獭（第四章群怪·哨兵）：plateau/play 的程序化姿势（poses.ts marmot），见 _plateau.mjs。
// 步态 upright：跑起来前倾、前爪着地当前腿；尖啸直立抱胸；扑咬伏低炸毛 → 前扑 → 坐起抖毛；钻洞一头扎下去 → 洞口探头。
// FoeSpec：移速 6.5、步幅 0.5（foes.ts FOE_SPECS.marmot）。
export default {
  plateau: {
    gait: 'upright',
    speed: 6.5,
    stride: 0.5,
    // 扑咬出手段往前蹿（11 m/s）：跑步态
    state: { bite: { active: { move: 1, phaseRate: (11 / 0.5) * Math.PI } } },
    staggerTime: 0.4,
  },
};
