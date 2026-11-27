// 玄冰巨蟹（第二章坦克）：钳夺自然出得来；横扫要玩家在侧面（flank），掀壳（断钳）要血量掉到 BREAK_AT 以下——
// 直接调 beginSweep / breakClaw
export default {
  expect: ['grabWindup', 'grab', 'grabRecover', 'sweepWindup', 'sweep', 'shellBreak'],
  scenes: [
    {
      name: '横扫（玩家在侧面）',
      player: { dist: 2.5, angle: Math.PI / 2, facing: true },
      start: 'beginSweep',
      seconds: 3,
      capture: ['sweepWindup', 'sweep'],
    },
    {
      name: '断钳',
      player: { dist: 6 },
      start: 'breakClaw',
      seconds: 4,
      capture: ['shellBreak'],
    },
  ],
};
