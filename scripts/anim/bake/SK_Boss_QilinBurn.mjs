// 火麒麟 · 焚身形态（3-4 二阶段）：同玄鳞（时长 / 连段见 SK_Boss_Qilin.mjs），少了饮熔（drink）。
// 出手时刻见 SK_Boss_QilinBurn.events.json
export default {
  boss: 'boss_qilin',
  form: 'burn',
  defId: 'boss_qilin_burn',
  theme: 'zhurong',
  idle: 'idle',
  gait: [['Walk', 6], ['Move', 16]],
  acts: ['rear', 'scalesFire', 'breath', 'stun', 'pant', 'tuck', 'leap', 'stomp', 'roar', 'paw'],
  next: { tuck: 'stomp', rear: 'scalesFire' },
  seconds: { rear: 1.0, scalesFire: 1.2, tuck: 0.9, stomp: 0.75, leap: 1.0, pant: 3.5, paw: 1.0 },
  lead: { scalesFire: ['rear', 1.0], stomp: ['tuck', 0.9], pant: ['stomp', 0.8] },
};
