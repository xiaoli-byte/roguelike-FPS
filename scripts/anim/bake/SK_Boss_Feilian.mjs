// 飞廉（4-1 ⑤ 冰川口领主，B1 路）：plateau/play 的程序化姿势（poses.ts feilian），见 _plateau.mjs。
// 四足鹿形：Walk 7 m/s（招式间隙小跑到 12–18 m）、Move 24 m/s（低头冲撞 / 回旋冲撞）；步幅按网页版 bosses.ts（phase += 速度 / 1.6 × π）。
// 冲撞、回旋冲撞的出手段要跑步态。人立长嘶、侧跃、回旋冲撞的倾斜、侧倒（珠碎）由 feilian_anims.py 手 K 覆盖。
export default {
  plateau: {
    gait: 'quad',
    speed: 24,
    stride: 1.6,
    gaits: { Walk: { speed: 7, move: 0.6 }, Move: { speed: 24, move: 1 } },
    state: {
      charge: { active: { move: 1, phaseRate: (24 / 1.6) * Math.PI } },
      wheel: { active: { move: 1, phaseRate: (24 / 1.6) * Math.PI } },
    },
    idle: { seconds: [2, 4] },
    staggerTime: 0.6,
  },
};
