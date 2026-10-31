// 化蛇（4-1 ④ 圣湖海子领主，B1 路）：plateau/play 的程序化姿势（poses.ts huashe），见 _plateau.mjs。
// 蛇行：没有腿的步态，游动是 anim.ts serpent 的时间正弦波（周期 2π / 2.2 ≈ 2.86 s），待机循环就是游动；位置全由玩法驱动（绕湖心岛游）。
// 水中游动的波形、翼拍浪、潜游突袭出水、噎住翻肚子由 huashe_anims.py 手 K 覆盖。
export default {
  plateau: {
    gait: 'serpent',
    gaits: null,
    idle: { seconds: [2.6, 3.0] },
    staggerTime: 0.6,
  },
};
