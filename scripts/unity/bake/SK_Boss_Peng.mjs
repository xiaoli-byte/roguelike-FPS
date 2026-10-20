// 鹏（鲲鹏 2-4 的空中形态）：KunPeng.ts 的 animatePeng，setAnim 逐个采样；出手时刻见 SK_Boss_Peng.events.json。
// 各段时长取 KunPeng.ts 的切换时刻：
//   俯冲  swoopReady（飞到起点 ≤ 1.8 s + 预警 0.9 s）→ dive（约 1.2 s 掠过环台；撞柱才接 crash，1.6 s 眩晕）
//   落台  perch（落地冲击，歇翼 4.8 s，持续型）→ takeoff（起飞冲击，0.8 s）
//   狂风  gust（1.0 s 预警，2.0–5.4 s 持续推人）；羽刃雨 spread（0.9 s 起每 0.11 s 一根）
export default {
  boss: 'boss_kunpeng',
  form: 'peng',
  defId: 'boss_kunpeng_peng',
  theme: 'beiming',
  idle: 'idle',
  acts: ['swoopReady', 'dive', 'crash', 'perch', 'takeoff', 'gust', 'spread', 'roar'],
  next: { swoopReady: 'dive', dive: 'crash' },
  seconds: { dive: 1.2, crash: 1.6, takeoff: 0.8 },
  lead: { dive: ['swoopReady', 2.4], crash: ['dive', 1.2], takeoff: ['perch', 2.4] },
};
