// 蛮蛮（第四章远程·扫线，一翼一目、成对）：poses.ts manman。步态 bird：一直扇翅（flap 1）。
//   sweep 翅膀高举、脖子伸长 → 俯冲平飞 → 慢慢爬升；bolt 张嘴一啄；hop 落地追啄（比翼断了之后，持续循环）。
// 一对里右翼那只是同一模型 X 镜像（玩法里模型节点 scale.x = −1）。FoeSpec：飞行 9 m/s、步幅 0.6。
// 招牌招式「成对扫线」另有手 K（Anim/Keyframed/sweep.fbx）。
export default {
  plateau: {
    gait: 'bird',
    speed: 9,
    stride: 0.6,
    idle: { state: { flap: 1 } },
    gaits: { Walk: { speed: 4.5, move: 0.5, state: { flap: 1 } }, Move: { speed: 9, move: 1, state: { flap: 1 } } },
    state: { sweep: { all: { flap: 1 } }, bolt: { all: { flap: 1 } } },
    loops: { hop: { pose: 'hop', state: { flap: 0.15, move: 1, phaseRate: 9 }, seconds: [0.6, 2.2] } },
    staggerTime: 0.5,
  },
};
