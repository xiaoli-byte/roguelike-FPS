// 鲲（鲲鹏 2-4 的水下形态）：KunPeng.ts 的 animateKun，setAnim 逐个采样；出手时刻见 SK_Boss_Kun.events.json。
// 各段时长取 KunPeng.ts registerMoves 里的切换时刻：
//   吞吸  inhale 3.9 s → bite（扑咬判定在切 bite 的那一刻），招式到 4.6 s 结束
//   猛砸  slamWind 1.1 s → slam（冲击 + 冰浪），1.95 s 回待机
//   潜袭  sink 2.0 s（0.5 s 没入水下）→ erupt（破冰冲击），3.0 s 结束
//   吐冰  spit 1.3 s（0.7 s 吐出冰弹）
export default {
  boss: 'boss_kunpeng',
  form: 'kun',
  defId: 'boss_kunpeng_kun',
  theme: 'beiming',
  idle: 'idle',
  acts: ['inhale', 'bite', 'slamWind', 'slam', 'spit', 'roar', 'rise', 'sink', 'erupt'],
  next: { slamWind: 'slam', inhale: 'bite', sink: 'erupt' },
  seconds: { inhale: 3.9, bite: 0.7, slamWind: 1.1, slam: 0.85, spit: 1.3, sink: 2.0, erupt: 1.0 },
  lead: { bite: ['inhale', 3.9], slam: ['slamWind', 1.1], erupt: ['sink', 2.0] },
};
