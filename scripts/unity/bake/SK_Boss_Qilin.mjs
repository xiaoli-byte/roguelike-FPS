// 火麒麟 · 玄鳞形态（3-4 一阶段）：Qilin.ts 的 animateBody，setAnim 逐个采样；
// 步态频率取实际水平速度，Walk / Move 以给定速度前进录制。出手时刻见 SK_Boss_Qilin.events.json。
// 各段时长取 Qilin.ts 的切换时刻：
//   张鳞  rear 1.0 s → scalesFire（火环，≤ 85% 时 0.4 s 后第二环），2.2 s 结束
//   饮熔  leap 1.0 s（抛物线跃向池边）→ drink（落地冲击）
//   踏云  tuck（预警 0.9 s）→ stomp（0.3 s 砸下、冲击 + 火浪，再弹起 0.45 s）
//   喘息  stomp（0.8 s 预警）→ pant（落地冲击，喘 3.5 s，3.0 s 时预警、3.5 s 弹起冲击）
//   麟火  breath（0.8 s 扇形预警后开喷，2.4 s 结束）；冲锋前 paw 刨地（1.0 s 预警线）
// next 按现在的招式编排：tuck → stomp（踏云），leap → drink（饮熔），rear → scalesFire（张鳞）
export default {
  boss: 'boss_qilin',
  form: 'xuan',
  defId: 'boss_qilin_xuan',
  theme: 'zhurong',
  idle: 'idle',
  gait: [['Walk', 6], ['Move', 16]],
  acts: ['rear', 'scalesFire', 'drink', 'breath', 'stun', 'pant', 'tuck', 'leap', 'stomp', 'roar', 'paw'],
  next: { tuck: 'stomp', leap: 'drink', rear: 'scalesFire' },
  seconds: { rear: 1.0, scalesFire: 1.2, tuck: 0.9, stomp: 0.75, leap: 1.0, pant: 3.5, paw: 1.0 },
  lead: { scalesFire: ['rear', 1.0], drink: ['leap', 1.0], stomp: ['tuck', 0.9], pant: ['stomp', 0.8] },
};
