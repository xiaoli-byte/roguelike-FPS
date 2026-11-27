// 熔铜匠（第三章辅助）：甩铜、后撤自然出得来。
//   登场      出生缩放 0.7 秒一结束就开录
//   浇铜衣    要射程内有同伴（pickPourTarget 挑最大血量的）：放一头冻住的熔炉铁牛当桩
//   坩埚裂    坩埚累计吃到 CRUCIBLE_BREAK 的伤害——直接调 crackCrucible
export default {
  idleState: 'stalk',
  expect: ['enter', 'flingWindup', 'retreat', 'pourWindup', 'pouring', 'crackStagger'],
  scenes: [
    {
      name: '登场',
      player: { dist: 14 },
      warmup: 0.7,
      seconds: 2,
      capture: ['enter'],
    },
    {
      name: '浇铜衣',
      props: [{ kind: 'ally', id: 'iron_ox', at: [2.5, 4], frozen: true }],
      player: { at: [0, 0, 14] },
      warmup: 2,
      start: (e) => { e.flingCd = 99; e.pourCd = 0; },
      seconds: 5,
      capture: ['pourWindup', 'pouring'],
    },
    {
      name: '坩埚裂',
      player: { dist: 10 },
      warmup: 2,
      start: 'crackCrucible',
      seconds: 3,
      capture: ['crackStagger'],
    },
  ],
};
