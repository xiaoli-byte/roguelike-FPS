// 穷奇（第四章游猎·精英，虎身有翼、背上猬毛雷冠）：poses.ts qiongqi。
//   glide 伏低张翼 → 滑翔（翅膀全展、腿前伸）→ 落地缓冲；spin 双翼一展原地旋斩；claw 左右前爪轮流拍下；absorb 人立接雷、双翼半张；
//   flee 展翼飞回巢穴（持续循环，flap 1）。
// FoeSpec：潜行 5.5、步幅 1.4。招牌招式「滑翔展翼 / 落地扑杀」另有手 K（Anim/Keyframed/glide.fbx）。
export default {
  plateau: {
    gait: 'quad',
    speed: 5.5,
    stride: 1.4,
    // 网页没把 flee 放进招式表（是 posture）：补一行，录成持续循环
    loops: { flee: { pose: 'flee', state: { flap: 1, move: 1, phaseRate: (13 / 1.4) * Math.PI }, seconds: [0.6, 2.4] } },
    state: { glide: { active: { flap: 0.2 } } },
    staggerTime: 0.7,
  },
};
