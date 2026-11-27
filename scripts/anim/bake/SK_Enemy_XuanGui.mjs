// 冰甲旋龟（第二章坦克）：啄击、后撤、缩壳旋转、过热翻身自然出得来；
// 蛇尾反咬要玩家站在它身后（朝向点积 < BITE_BEHIND），采样时玩家总在正前方——直接调 beginBite
export default {
  expect: ['peckWindup', 'peck', 'backoff', 'retract', 'spin', 'overheat', 'rightself', 'biteWindup', 'bite'],
  scenes: [
    {
      name: '蛇尾反咬',
      // 玩家在身后 2 米（相对本体朝向）
      player: { dist: 2, angle: Math.PI, facing: true },
      start: 'beginBite',
      seconds: 2.5,
      capture: ['biteWindup', 'bite'],
    },
  ],
};
