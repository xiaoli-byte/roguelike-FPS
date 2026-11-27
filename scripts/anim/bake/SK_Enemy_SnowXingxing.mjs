// 雪狌狌（第二章群怪）：跳砸 / 抓挠自然出得来。
// 攀爬要玩家站在 0.7–3.5 米高的台子上、边缘在 4.5 米内（findClimb 沿玩家方向找台沿）；
// 抛冰块要玩家站在爬不上去的高处（> 3.5 米）；起哄由同伴死亡触发，直接调 startRally
export default {
  expect: ['slamWindup', 'slamAir', 'recover', 'swipeWindup', 'swipe', 'throwWindup', 'throwRelease', 'climbPrep', 'climb', 'rally'],
  scenes: [
    {
      name: '攀爬（2 米高台）',
      props: [{ kind: 'box', min: [-4, 0, 2.5], max: [4, 2, 9] }],
      at: [0, 0, 0.5],
      player: { at: [0, 2, 4.5] },
      warmup: 0.8,
      seconds: 5,
      capture: ['climbPrep', 'climb'],
      // 攀爬的抬升由玩法（NavMeshLink）移动根节点，片段不带离地高度
      inPlace: true,
    },
    {
      name: '抛冰块（5 米高台，爬不上去）',
      props: [{ kind: 'box', min: [-4, 0, 6], max: [4, 5, 12] }],
      player: { at: [0, 5, 6.6] },
      warmup: 0.8,
      step: (e) => { e.cooldown = Math.min(e.cooldown, 0.2); },
      seconds: 5,
      capture: ['throwWindup', 'throwRelease'],
    },
    {
      name: '起哄（同伴被打死）',
      player: { dist: 9 },
      start: (e) => e.startRally(),
      seconds: 2,
      capture: ['rally'],
    },
  ],
};
