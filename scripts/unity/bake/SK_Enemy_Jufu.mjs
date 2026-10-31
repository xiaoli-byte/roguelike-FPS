// 举父（第四章远程·炮击）：poses.ts jufu。抢高（蹲 → 空中收腿举手 → 四肢着地）、远投（弯腰抠石 → 双手举过头 → 往前甩 → 双臂垂下）、
// 推开（双臂张开 → 横扫）、摔下高处（四肢乱挥）。步态 biped（指节着地跑：玩法里身体前倾由片段给）。
// FoeSpec：移速 5、步幅 0.9。招牌招式「举石 / 投石」另有手 K（Anim/Keyframed/throw.fbx）。
export default {
  plateau: {
    gait: 'biped',
    speed: 5,
    stride: 0.9,
    staggerTime: 0.6,
  },
};
