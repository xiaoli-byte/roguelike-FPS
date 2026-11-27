// 毕方（第三章栖落狙击）：起飞、滑翔、落脚、毕—方两声都能自然出招采到（空场里落在地面落脚点）。
// 断腿坠落要站在高处（perchHigh，栖柱顶面比玩家高 3.2 米以上）时独脚累计吃到 25% 伤害——
// 摆一根 4 米栖柱、本体直接站在柱顶，把腿伤拨满：翻下柱子（fall）→ 在地上扑腾（downed）
// 毕方不走路（滑翔换落脚点），没有 Walk / Move
export default {
  idleState: 'perch',
  expect: ['takeoff', 'glide', 'land', 'cryBi', 'cryFang', 'recover', 'fall', 'downed'],
  scenes: [
    {
      name: '断腿坠落',
      props: [{ kind: 'pillar', at: [0, 0], height: 4, size: 2 }],
      at: [0, 4, 0],
      player: { at: [0, 0, 16] },
      warmup: 0.8,
      start: (e) => {
        e.perch.set(e.position.x, 4, e.position.z);
        e.position.y = 4;
        e.perchHigh = true;
        e.setState('perch');
        e.legDamage = e.maxHp;
      },
      seconds: 5,
      capture: ['fall', 'downed'],
      // 坠落的落差由玩法（位置插值）给，片段不带离地高度
      inPlace: true,
    },
  ],
};
