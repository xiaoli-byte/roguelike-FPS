// 马面狱卒（第三章钩链拖拽）：抡链、甩钩、收链、锁链横扫自然出得来。
//   钩中拖拽  玩家站定在 8 米：抡链 → 甩钩钩中 → 拖拽（drag）
//   射断链    拖拽中链子被打断（chainCut）→ 踉跄（staggered）
//   缴械肉搏  锁芯被打爆（disarm）→ 踉跄 → 空手追击（brawl，持续型）→ 抡拳（punchWind → punch）
export default {
  expect: ['spin', 'throw', 'reel', 'sweepWind', 'sweep', 'recover', 'drag', 'staggered', 'brawl', 'punchWind', 'punch'],
  scenes: [
    {
      name: '钩中拖拽',
      player: { at: [0, 0, 8] },
      start: 'beginSpin',
      seconds: 5,
      capture: ['drag'],
    },
    {
      name: '射断链',
      player: { at: [0, 0, 8] },
      start: 'beginSpin',
      step: (e) => { if (e.state === 'drag' && e.stateTime > 0.35) e.chainCut = true; },
      seconds: 5,
      capture: ['staggered'],
    },
    {
      name: '缴械追击',
      player: { dist: 7 },
      start: 'disarm',
      seconds: 5,
      capture: ['brawl'],
      loops: { brawl: [0.6, 2.4] },
    },
    {
      name: '缴械肉搏',
      player: { dist: 1.5 },
      start: (e) => { e.disarm(); e.cooldown = 0; },
      step: (e) => { e.cooldown = Math.min(e.cooldown, 0.3); },
      seconds: 5,
      capture: ['punchWind', 'punch'],
    },
  ],
};
