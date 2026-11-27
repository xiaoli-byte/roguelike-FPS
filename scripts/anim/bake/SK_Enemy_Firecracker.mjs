// 炮仗傀儡（第三章炮兵）：跺脚、扎马、点引信、齐射、收招自然出得来；
// 哑火要肚子（火药匣）被打中——直接调 dud：仰面倒地（toppled）→ 爬起（getup）
export default {
  expect: ['stomp', 'brace', 'fuse', 'volley', 'recover', 'toppled', 'getup'],
  scenes: [
    {
      name: '哑火翻倒',
      player: { dist: 8 },
      start: 'dud',
      seconds: 6,
      capture: ['toppled', 'getup'],
    },
  ],
};
