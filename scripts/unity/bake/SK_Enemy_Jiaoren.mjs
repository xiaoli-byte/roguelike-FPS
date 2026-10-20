// 冻鲛人（第二章群怪）：投矛 / 戳刺自然出得来；群刺要凑够 3 只可以出手的鲛人（gatherPack），
// 单只采样凑不齐，直接调 AI 自己的入口 beginLunge（与群刺分派给每只的是同一个函数）
export default {
  expect: ['aim', 'throw', 'recover', 'jabWindup', 'jab', 'lungeWindup', 'lunge'],
  scenes: [
    {
      name: '群刺',
      // 玩家站定：突刺冲到跟前命中就收招（与游戏里一致），不会一路冲到 LUNGE_TIME
      player: { at: [0, 0, 5] },
      warmup: 1.0,
      start: (e) => e.beginLunge(0),
      seconds: 3,
      capture: ['lungeWindup', 'lunge'],
    },
  ],
};
