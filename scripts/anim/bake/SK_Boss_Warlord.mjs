// 熔心魔将（3-3 领主）：部件骨架（程序化模型 WarlordModel 的关节 = GLB 骨骼 j_*），Warlord.ts 的 setAnim 逐个采样。
// 步态按 velocity 算（walk = 速度 / 2.5），Walk / Move 让它自己 setMove 走。出手时刻见 SK_Boss_Warlord.events.json。
// 各段时长取 Warlord.ts 的切换时刻（一阶段数值）：
//   烈焰冲锋  chargeReady（预警 0.9 s）→ charge（直线冲锋，撞墙才接 crash，1.6 s 眩晕）
//   扇形横扫  sweepReady（0.85 s）→ sweep（0.8 s）；二连时 0.2 s 后 sweepReady2（0.55 s）→ sweepBack
//   陨石雨    raise（0.8 s 起每段落一颗，持续 3.2 s）
//   跃击      crouch（0.48 s）→ leap（滞空约 1 s）→ land（落地重击 + 火浪，0.7 s）
//   焰刃连斩  slashA / slashB 交替，每段 0.72 s，0.5 s 时斩下
//   熔岩涌动  plant（0.45 s 砸地）
export default {
  boss: 'boss_warlord',
  defId: 'boss_warlord',
  parts: true,
  theme: 'zhurong',
  idle: 'idle',
  gaitBy: 'velocity',
  gait: [['Walk', 2.3], ['Move', 4.6]],
  acts: ['chargeReady', 'charge', 'crash', 'sweepReady', 'sweep', 'sweepReady2', 'sweepBack', 'raise', 'crouch', 'leap', 'land', 'slashA', 'slashB', 'plant', 'roar'],
  next: { chargeReady: 'charge', sweepReady: 'sweep', sweepReady2: 'sweepBack', crouch: 'leap', leap: 'land' },
  seconds: {
    chargeReady: 0.9, charge: 1.2, crash: 1.6, sweepReady: 0.85, sweep: 0.8, sweepReady2: 0.55, sweepBack: 0.8,
    crouch: 0.48, leap: 1.0, land: 0.7, slashA: 0.72, slashB: 0.72, plant: 1.3,
  },
  lead: {
    charge: ['chargeReady', 0.9], crash: ['charge', 1.2], sweep: ['sweepReady', 0.85], sweepReady2: ['sweep', 0.2],
    sweepBack: ['sweepReady2', 0.55], leap: ['crouch', 0.48], land: ['leap', 1.0], slashB: ['slashA', 0.72],
  },
};
