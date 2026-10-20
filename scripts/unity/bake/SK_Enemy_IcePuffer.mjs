// 冰河豚（第二章飞行自爆）：俯冲自然出得来；鼓胀要俯冲扎到玩家胸口跟前，采样时玩家跟着本体退，扎不到——直接调 startInflate。
// 鼓胀结束就自爆（死亡），死后的帧不算鼓胀
export default {
  expect: ['dive', 'recover', 'inflate'],
  scenes: [
    {
      name: '鼓胀自爆',
      player: { dist: 1.5 },
      start: 'startInflate',
      label: (e) => (e.alive === false ? 'dead' : e.state),
      seconds: 3,
      capture: ['inflate'],
    },
  ],
};
