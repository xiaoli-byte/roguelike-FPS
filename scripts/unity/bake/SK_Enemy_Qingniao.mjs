// 三青鸟（第二章飞行远程）：齐射自然出得来。
// 栖落要飞满 11–14 秒、附近有 1.4–7 米高的柱顶（findPerch 扫碰撞盒）——摆一根 3 米栖柱、把飞行计时拨满；
// 尖啸俯冲要累计受伤 30%（hurtSinceSwoop），玩家站定、直接调 startScreech
export default {
  expect: ['volley', 'recover', 'toPerch', 'perched', 'takeoff', 'screech', 'swoopDown', 'swoopUp'],
  scenes: [
    {
      name: '栖柱落脚',
      props: [{ kind: 'pillar', at: [0, 13], height: 3, size: 1.6 }],
      at: [0, 0, 4],
      player: { at: [0, 0, 0] },
      start: (e) => { e.perchAfter = 0; e.flyTime = 1; e.cooldown = 99; },
      seconds: 16,
      capture: ['toPerch', 'perched', 'takeoff'],
      // 栖落是持续状态：切一段无缝循环，玩法按需停留再接起飞
      loops: { perched: [1.2, 2.8] },
    },
    {
      name: '尖啸俯冲',
      player: { at: [0, 0, 10] },
      start: (e) => { e.cooldown = 99; e.startScreech(); },
      seconds: 5,
      capture: ['screech', 'swoopDown', 'swoopUp'],
    },
  ],
};
