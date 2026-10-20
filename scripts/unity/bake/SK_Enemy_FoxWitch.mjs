// 九尾狐巫（第二章辅助）：冰壁、照妖镜、闪身自然出得来。
// 登场（enter）在出生之后：出生缩放 0.7 秒（不跑 AI）一结束就开录；
// 霜甲要 12 米内有同伴（放两只冻鲛人桩，冷却里只留霜甲）；
// 碎镜后先尖啸 1.2 秒（stalk 里叠的 screamTime，起名 scream），之后不再立冰壁 / 照镜，改放狐火
export default {
  idleState: 'stalk',
  expect: ['enter', 'wallWindup', 'armorWindup', 'mirrorCharge', 'blink', 'scream', 'foxfireWindup'],
  scenes: [
    {
      name: '登场',
      player: { dist: 14 },
      warmup: 0.7,
      seconds: 2,
      capture: ['enter'],
    },
    {
      name: '霜甲',
      props: [
        { kind: 'ally', id: 'jiaoren', at: [-2, 4], frozen: true },
        { kind: 'ally', id: 'jiaoren', at: [2, 4], frozen: true },
      ],
      player: { at: [0, 0, 14] },
      warmup: 2,
      start: (e) => { e.wallCd = 99; e.mirrorCd = 99; e.blinkCd = 99; e.armorCd = 0; },
      seconds: 4,
      capture: ['armorWindup'],
    },
    {
      name: '碎镜尖啸 → 狐火',
      player: { at: [0, 0, 10] },
      warmup: 2,
      start: (e) => { e.blinkCd = 99; e.breakMirror(); },
      label: (e) => (e.state === 'stalk' && e.screamTime > 0 ? 'scream' : e.state),
      seconds: 6,
      capture: ['scream', 'foxfireWindup'],
    },
  ],
};
