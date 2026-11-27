// 变脸傩巫（第三章辅助）：喷火、抹脸换面自然出得来；dance 是她的移动步态（= Move）。
//   登场      出生缩放 0.7 秒一结束就开录
//   碎面捂脸  当前那张面具累计吃到 MASK_BREAK 的伤害——直接调 breakFace（cover）
export default {
  idleState: 'dance',
  expect: ['enter', 'spitWindup', 'spit', 'wipe', 'cover'],
  scenes: [
    {
      name: '登场',
      player: { dist: 12 },
      warmup: 0.7,
      seconds: 2,
      capture: ['enter'],
    },
    {
      name: '碎面捂脸',
      player: { dist: 9 },
      warmup: 2,
      start: 'breakFace',
      seconds: 3,
      capture: ['cover'],
    },
  ],
};
