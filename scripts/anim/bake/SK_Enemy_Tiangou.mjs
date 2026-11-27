// 天狗（第四章群怪·包抄）：poses.ts tiangou。雷吠坐低仰头长吠；扑咬伏低 → 腾空前扑（前腿前伸、后腿后蹬）→ 落地滑一下。
// FoeSpec：移速 9.5、步幅 1.1。扑咬出手段 10 m/s 冲：跑步态。招牌招式扑咬另有手 K（Anim/Keyframed/pounce.fbx，同名优先）。
export default {
  plateau: {
    gait: 'quad',
    speed: 9.5,
    stride: 1.1,
    state: { pounce: { active: { move: 1, phaseRate: (10 / 1.1) * Math.PI } } },
    staggerTime: 0.45,
  },
};
