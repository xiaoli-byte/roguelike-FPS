// 冰灯水母（第二章辅助）：雷环前摇自然出得来；治疗连线跟着同伴漂（drift，即 Move）。
// 硬直要灯芯（头部判定）累计吃到 STAGGER_FRAC 的爆头伤害——喂一次假的爆头结果给它自己的 onHurt（与游戏里同一条路径）
export default {
  expect: ['shockWindup', 'stagger'],
  scenes: [
    {
      name: '灯芯被打硬直',
      props: [{ kind: 'ally', id: 'jiaoren', at: [2, 3], hp: 0.5, frozen: true }],
      player: { dist: 9 },
      start: (e) => e.onHurt({ request: { headshot: true, source: 'bullet' }, dealt: e.maxHp, isCrit: true, killed: false }),
      seconds: 3,
      capture: ['stagger'],
    },
  ],
};
