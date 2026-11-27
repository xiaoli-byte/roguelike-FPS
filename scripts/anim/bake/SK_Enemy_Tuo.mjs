// 火鼍（第三章熔岩潜游坦克）：陆上扑咬自然出得来；其余招牌状态都要熔岩（ctx.stage.lavaSystem.lava 掩码）：
//   潜熔伏击  出生在岸上 → 爬进熔岩（toLava）→ 潜游（swim）沿熔岩寻路游向玩家那一侧的岸 → 岸边鼓泡（surge）→ 冲上岸（lunge）→ 咬
//   回熔长甲  碎掉 3 块岩甲：爬回熔岩、原地长甲（regrow）
//   甩尾      玩家在侧后方 5 米内（朝向点积 < 0.1）——直接调 beginSweep
//   鼍鸣      血量第一次低于 40%——直接调 beginRoar
// 出生状态 enter 只有一帧（马上判定去熔岩还是上岸），不出片段；land 是陆上的追击步态（= Move）
const LAVA = { kind: 'lava', rects: [[-40, 6, 40, 40]] };

export default {
  expect: ['biteWindup', 'bite', 'toLava', 'swim', 'surge', 'lunge', 'regrow', 'sweepWindup', 'sweep', 'roar'],
  skip: { enter: '出生只有一帧，立刻转 toLava / land' },
  locomotion: ['land'],
  scenes: [
    {
      name: '潜熔伏击',
      props: [LAVA],
      at: [0, 0, 3],
      player: { at: [30, 0, 2] },
      warmup: 0.7,
      step: (e) => { e.ambushCd = Math.min(e.ambushCd, 0); },
      seconds: 9,
      capture: ['toLava', 'swim', 'surge', 'lunge'],
      loops: { swim: [0.6, 2.4] },
    },
    {
      name: '回熔长甲',
      props: [LAVA],
      at: [0, 0, 3],
      player: { at: [0, 0, -10] },
      warmup: 0.7,
      start: (e) => { for (const i of [0, 3, 5]) e.breakPlate(i); },
      seconds: 9,
      capture: ['regrow'],
    },
    {
      name: '甩尾（玩家在侧后方）',
      player: { dist: 3.2, angle: Math.PI * 0.75, facing: true },
      start: 'beginSweep',
      seconds: 2.5,
      capture: ['sweepWindup', 'sweep'],
    },
    {
      name: '鼍鸣',
      player: { dist: 8 },
      start: 'beginRoar',
      seconds: 4,
      capture: ['roar'],
    },
  ],
};
