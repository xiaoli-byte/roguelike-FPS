// 冰棘豪彘（第二章冲锋自爆）：刨地、冲锋、撞墙踉跄自然出得来；竖刺（冰刺新星）要冲到玩家跟前，
// 采样时玩家跟着本体退、冲不到——直接调 startBristle
export default {
  expect: ['scrape', 'charge', 'stagger', 'bristle'],
  scenes: [
    {
      name: '竖刺',
      player: { dist: 2.5 },
      start: 'startBristle',
      label: (e) => (e.alive === false ? 'dead' : e.state),
      seconds: 3,
      capture: ['bristle'],
    },
  ],
};
