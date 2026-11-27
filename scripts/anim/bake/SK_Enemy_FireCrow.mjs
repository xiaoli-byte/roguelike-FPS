// 神火飞鸦（第三章飞行神风）：点火自然出得来；俯冲撞地就自爆（死亡后状态还停在 dive，自然场景里这一段超长被丢掉）——
// 玩家站定，飞到高度后点火：点火（ignite）→ 俯冲（dive），死后的帧不算
export default {
  expect: ['ignite', 'dive'],
  scenes: [
    {
      name: '点火俯冲',
      player: { at: [0, 0, 9] },
      warmup: 4,
      // 盘旋时冷却一好就会自己点火俯冲撞死：warmup 里压住冷却
      warmStep: (e) => { e.cooldown = 99; },
      // 盘旋爬升到巡航高度（8–14 米）要几秒；没爬够就点火的话俯冲一出手就撞地（片段只剩几帧）
      start: (e) => {
        if (e.position.y < 6) { e.position.y = e.altitude; e.velocity.y = 0; }
        e.startIgnite();
      },
      label: (e) => (e.alive === false ? 'dead' : e.state),
      seconds: 4,
      capture: ['dive'],
    },
  ],
};
