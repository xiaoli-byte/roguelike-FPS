// 熔炉铁牛（第三章坦克）：挑飞、吸气、熔铁喷吐自然出得来；呛火要吸气时炉门（头部判定）累计吃到 CHOKE_FRACTION 的伤害——
// 让它吸气，0.75 秒后调它自己的 choke（片段从吸气姿势过渡过去，与游戏里一致）
export default {
  expect: ['tossWindup', 'toss', 'inhale', 'spitWindup', 'spit', 'choke'],
  scenes: [
    {
      name: '吸气呛火',
      player: { dist: 6 },
      start: 'beginInhale',
      step: (e, api, i) => { if (i === 45 && e.state === 'inhale') e.choke(); },
      seconds: 5,
      capture: ['choke'],
    },
  ],
};
