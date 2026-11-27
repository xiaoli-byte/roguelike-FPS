// 帝江（第四章近战·自爆，浑敦无面目、六足四翼）：poses.ts dijiang。步态 hexa（六足三角步）：歌舞是它的移动——
// 一边转圈一边蹦，玩法里每 0.5 / 0.33 / 0.25 s 一蹦（根节点抛物线），片段只管六足乱蹬、四翼扇（网页 phase 固定 14 rad/s）。
//   swell 原地转圈、胀大、六足乱蹬、四翼张开（胀大 1.5 倍是骨骼缩放，采样不记缩放：Unity 玩法里缩 body 骨）。
// FoeSpec：移速 8；步幅按「相位 14 rad/s」反推 = 8π / 14 ≈ 1.8。
export default {
  plateau: {
    gait: 'hexa',
    speed: 8,
    stride: (8 * Math.PI) / 14,
    idle: { state: { flap: 0.3 } },
    gaits: { Walk: { speed: 4, move: 1, state: { flap: 1 } }, Move: { speed: 8, move: 1, state: { flap: 1 } } },
    state: { swell: { all: { flap: 1 } } },
    stagger: false, // 太轻：不硬直，被打退半步（玩法）
  },
};
