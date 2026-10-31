// 夔（4-1 ⑥ 经幡山头领主，B1 路）：plateau/play 的程序化姿势（poses.ts kui），见 _plateau.mjs。
// 一足：没有走路步态，只有蹦（hop / leap / leapChain / turnLeap，位移全由玩法驱动）和拄拳（knuckle，三步 3.9 s 一段）。
// 招式时长取 docs/art/ch4-move-events.json；招牌招式（蹦跳的蓄力 / 落地、拄拳、捶胸、破鼓跪地、倒回残鼓）由
// art/source/characters/SK_Boss_Kui/anim/kui_anims.py 手 K 覆盖（Anim/Keyframed/<状态>.fbx，同名优先）。
export default {
  plateau: {
    gait: 'kui',
    gaits: null,
    idle: { seconds: [2, 4] },
    staggerTime: 0.6,
  },
};
