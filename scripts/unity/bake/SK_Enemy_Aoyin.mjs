// 獓狠（第四章坦克）+ 雷牦（同一模型 ×0.72）：poses.ts aoyin。
//   stampede 刨地（右前蹄刨两下、低头）→ 13 m/s 踩踏（跑步态）→ 打滑停下；gore 四角挑左右交替（gore = 往右甩、goreL = 往左甩）；
//   slam 人立雷球举高 → 前蹄砸地。
// FoeSpec：走 3.5 m/s、步幅 1.6。招牌招式「踩踏起步 / 砸地」另有手 K（Anim/Keyframed/stampede.fbx、slam.fbx）。
export default {
  plateau: {
    gait: 'quad',
    speed: 3.5,
    stride: 1.6,
    alias: { goreL: 'gore' },
    state: {
      stampede: { active: { move: 1, phaseRate: (13 / 1.6) * Math.PI } },
      gore: { all: { side: 1 } },
      goreL: { all: { side: -1 } },
    },
    staggerTime: 0.8,
  },
};
