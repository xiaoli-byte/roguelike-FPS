# 宝箱 / 商店 / 商人 / 祭台（ART7）

2026-10-22 完成 [unity-parity.md](../unity-parity.md) 第 5 节的 ART7。替换现在的程序方块（程序宝箱、MarketStall / ForgeStall / PrayerTent 占位），玩法接入是 R1（宝箱）、R3（商店）、U6（选人祭台）。

所有件都有 Unity Prefab（道具在 `unity/Assets/Art/Props/<ID>/`，商人在 `unity/Assets/Art/Characters/SK_Npc_Merchant/`），ArtValidator 通过。

## 1. 道具

路线同第一、二章：Codex 四视图 → Tripo 智能网格 P2.0 + 纹理生成 → `tripo_assets.py import` → build / validate / review / approve / publish → `unity_export.py` → `bridge.sh sync`。
跨章节道具用新加的 `style_theme = "loot"`：漆木、旧铜、亮金、白玉和绿玉、铁，暖色点缀，隔着一个房间也认得出是战利品。霜山商摊随第二章用 `kunlun`。

| ID | 用途 | 尺寸 W×H×D（米） | LOD 三角面 |
|---|---|---|---|
| SM_Prop_ChestCommon | 普通宝箱（木箱铁箍、圆挂锁），整只合着 | 0.85 × 0.9 × 0.57 | 2533 / 995 |
| SM_Prop_ChestRare | 稀有宝箱（朱漆、铜云纹、绿玉锁片、狮首环） | 1.08 × 1.0 × 0.63 | 2827 / 994 |
| SM_Prop_ChestLegendary | 传说宝箱（夜蓝漆金边、白玉龙纹、琥珀灵火宝石、塔式盖） | 0.88 × 1.15 × 0.46 | 2887 / 994 |
| SM_Prop_Anvil | 铁砧（强化台）：木墩上的铁砧、锤、火钳 | 1.04 × 1.2 × 0.66 | 2980 / 995 |
| SM_Prop_ScrollCase | 秘卷匣：红木架托着一卷发光金纸秘卷 | 0.9 × 0.8 × 0.44 | 2985 / 994 |
| SM_Prop_Potion | 药壶（战备药剂 / 回复拾取物）：青瓷葫芦、红绳、绿色药液窗 | 0.3 × 0.55 × 0.27 | 2984 / 994 |
| SM_Prop_AmmoCrate | 弹药箱（补满备弹）：橄榄绿木箱、铜角、半开的盖里露出弹壳 | 0.97 × 0.65 × 0.5 | 2594 / 994 |
| SM_Prop_HeroAltar | 选人祭台：两层石台、铜边云纹、八卦符文环（青金色发光槽）、正面三级台阶 | 3.5 × 0.9 × 3.69 | 7174 / 2486 / 1491 |
| SM_Tripo_FrostMarketStall | 霜山商摊（第二章商人摊位）：雪顶木摊、红帘、灯笼、货架 | 3.08 × 3.2 × 1.56 | 2543 / 994 |

- 选人祭台的网格比设计厚，按高度 0.9 m 对齐后直径只有 3.5 m（设计 5 m）。站一个英雄够用；要 5 m 就整体放大 1.4 倍，台高变成 1.26 m。光柱、符文环流光、氛围粒子是 U6 的运行时特效，模型里只有发光槽的底色。
- 修过的问题：选人祭台的 LOD2 贴图色差 10.8%，改 `lod_tris = [8000, 2500, 1500]`、`lod_rebake_stretch = 0.10`。

## 2. 宝箱的盖子（枢轴）

Tripo 出的是整只合着的箱子，因为开着盖的箱子重建效果差。`art/pipeline/derive_chest_parts.py`（Blender 部分是 `blender/bl_chest_parts.py`）按 registry 里每档的 `lid_split`（盖缝高度占总高的比例）把每级 LOD 横切成两件：

- `<ID>Body`：盖缝以下的箱体。切口用一圈 5 cm 的沿加一个下沉 12 cm 的浅托盘封口，开盖后看得出是个箱子，不是实心块。原点和整箱一样，在底面中心。
- `<ID>Lid`：盖缝以上的盖子，底面封口。**原点在铰链线上**：中线 x = 0、切口最靠后处、盖缝高度。运行时绕盖子的局部 X 轴转负角，盖子就向后翻开。
- 封口面的 UV 取所封边缘的平均 UV，颜色就是那一圈的颜色。只有一个材质，不加新贴图。
- 两件都直接写进 manifest（`generator.tool = "derived"`），带 `lidHinge`。这是盖子铰链在箱体空间里的位置，单位是 glTF 米。把盖子作为箱体的子物体放在这个点，就和整箱严丝合缝：

| 档 | 箱体 / 盖子 | lidHinge（x, y, z） | 盖缝 lid_split |
|---|---|---|---|
| 普通 | SM_Prop_ChestCommonBody / Lid | (0, 0.558, −0.286) | 0.62 |
| 稀有 | SM_Prop_ChestRareBody / Lid | (0, 0.600, −0.270) | 0.60 |
| 传说 | SM_Prop_ChestLegendaryBody / Lid | (0, 0.667, −0.204) | 0.58 |

开盖审核图：[chests-open-v001.jpg](review/chests-open-v001.jpg)。合着的整箱 `SM_Prop_Chest*` 也保留发布，给永远不开的装饰箱用。重新发布宝箱后要重跑 `python art/pipeline/derive_chest_parts.py`。

## 3. 商人 SK_Npc_Merchant（狸猫行商）

- **设计**：`art/pipeline/npc_designs_v1.json`（新的 NPC 设计表，`redesign_sheets.py --designs npc_designs_v1.json`）。
  - 一只胖乎乎的狸花猫行商：圆眼镜、斗笠、深青长袍配铜钱纹金边、芥黄腰带、棕色围裙。左胯挂铜钱串，右胯挂算盘，背着竹书笈，书笈上有瓶罐、卷轴和一盏发灵火的小铜灯。
  - 物种避开了英雄（小熊猫、鼯鼠、穿山甲、犀牛、狐、熊、隼）和敌人。风格锚是已过审的小熊猫英雄渲染图。
  - 设计稿 `DS_npc_merchant_v001`，四视图 `TV_npc_merchant_v001`，都按推荐版本直接用。
- **Tripo**：多视图智能网格 P2.0，15000 档，实得 16029 三角面，自带 4K 底色图。归档在 `art/source/_tripo_inbox/20261022T135819_SK_Npc_Merchant.glb`，附 json 回执。
- **眼部修复（2026-10-23）**：用户反馈「商人的建模还有瑕疵，眼睛那一块」，侧面近景里只有一侧看得到金框、框和眼球糊在一起像嵌进脸里，另一只眼被帽檐压着。四视图里是双眼一副细金丝圆眼镜，镜框立在脸前，帽檐在眼睛上方。
  - 问题一：Tripo 的眼镜是一块从脸面伸出约 2.5 cm 的厚片（322 面），不透明的镜片上又画了一对眼睛；侧面看是两块深色厚片贴在脸上，边框是扁的猫眼形，顶上一条深色横梁。
  - 问题二：脸上的左眼下半有一道浅色斜条（Tripo 把镜片反光投到了皮肤上），两只眼也画得不一样。
  - 问题三：斗笠沿口前面高（z 1.35）、两侧一路垂到眼睛高度（1.20），从侧面、斜上方看正好挡在眼睛前上方。
  - 修法：`art/source/characters/SK_Npc_Merchant/fix_eyes.py`（Blender，不重新生成，不花积分）。
    - 整副眼镜删掉，按四视图重做：两个细金丝圆环（环半径 2.7 cm、管径 2.8 mm）套在瞳孔上，环面朝向取脸的法线和正前方的中间，离眼面 1.7 cm（按环上每点到脸面的实测深度留 5 mm 空隙），中间一道向上拱的鼻梁，没有镜腿。新网格用同一个材质，UV 落在底色图空白处新画的一块金色渐变上。
    - 左眼贴图换成右眼的镜像（按模型上的点 x 取反取样，只改主体网格朝前的面，眼框边缘 1 cm 渐变）。
    - 帽檐只在两眼的方位局部抬高：以帽轴为心、正前方两侧各 55° 为中心的 cos² 包络，从帽檐内圈到外沿平滑增加，外沿最多 3 cm。正前方、正侧面、帽顶和耳朵不动，沿口从侧面到前面变成一条单调上升的平滑曲线。
    - 构建时 LOD0 超预算会整体塌陷减面，细环的分段边最便宜，会先被减成八边形；所以脚本里先把主体减到「LOD0 预算 − 眼镜面数」，构建时 LOD0 不再减面。减面前按位置焊接 UV 接缝（以前直接对断开的网格减面，鼻子、嘴角有细缝，这次一并消掉），胡须等脸前小部件锁住不减，Tripo 原来的法线减面后按最近点还原。
  - 骨架里的 `source` 换成修过的 `..._eyefix.glb`，Tripo 原件记在 `source_original`。背篓、长袍、尾巴没动；斗笠只动了上面说的那一段帽檐。
  - 重建 v010 并发布，Idle / Talk 重新烘焙。审核姿势和关键姿势的拉伸与修复前持平或略低（wave p99 12.2 → 10.2，Talk p99 ≤ 2.15），眼镜整副跟头骨走，绑骨没有受影响。
  - 改前 / 改后特写：[npc-merchant-eyes-v003.jpg](review/npc-merchant-eyes-v003.jpg)，上排是改前（v003），下排是改后（v010），从左到右依次为正面、3/4、左侧面、右侧面、斜上方、玩家视角。
- **绑骨**：`python art/pipeline/build_tripo_creature.py SK_Npc_Merchant --publish`，骨架 `art/pipeline/creature_rigs/SK_Npc_Merchant.json`，共 26 根骨。
  - 语义人形命名，Unity 建 Humanoid。
  - 尾巴 3 节，是运行时弹簧骨。
  - `pack` 骨挂在 chest 上，只管书笈，让书笈整块跟胸走。
  - 成品高 1.5 m，LOD 14960 / 5910 / 2364，贴图 2048，1.6 MB。新规格档 `npc`：`[15000, 6000, 2400]`、2048。
- **权重调整**：第一版手臂的限制盒太宽，手臂垂在袍子两侧，袍侧和算盘被分给了手臂，举手时整片袍子被拉起来（wave p99 22）。
  - 改成上臂只管 z 0.72 以上、小臂和爪只管 |x| > 0.30。
  - 改后审核（`creature_rigs/review_poses/SK_Npc_Merchant.json`）：wave 12.2（举到 100°，腋下拉开）、offer 5.9、arms_down 3.8、head_turn 3.3、点头鞠躬 1.7、甩尾 1.7、迈步 1.9。
- **动作**：手工关键帧，脚本是 `art/source/characters/SK_Npc_Merchant/anim/merchant_anims.py`，照旱魃的 `hanba_anims.py` 写。
  - 输出 `unity/Assets/Art/Characters/SK_Npc_Merchant/Anim/Keyframed/{Idle,Talk}.fbx` 和 `SK_Npc_Merchant.events.json`。
  - 这些 FBX 按 `unity/.gitignore` 不入库，换机器后重跑脚本即可：

    ```bash
    blender -b --factory-startup --python art/source/characters/SK_Npc_Merchant/anim/merchant_anims.py
    ```

  - **Idle**：4 s 循环，呼吸、重心左右换、歪头、尾巴慢摆。
  - **Talk**：5 s 循环，持续型片段，商店界面打开时一直播，关掉时玩法 CrossFade 回 Idle。动作依次是：右爪捧向客人 → 点头 → 张开双臂 → 左爪摸肚子、右爪比划。
  - 所有手势的上臂都保持在下垂 50° 以内，避开腋下拉伸。关键姿势的拉伸 p99 都 ≤ 2.2。
  - `NativeClipBuilder` 把它们并进 `AC_SK_Npc_Merchant`：Idle 是默认状态，说话用触发器 `act_Talk`。
  - ArtValidator 对商人只有一条警告：「上臂与水平面夹角 43.4°，不是 T-pose」，和旱魃一样。这条只影响套用 Mixamo 等外部人形动作时的重定向；Idle / Talk 是在它自己的骨架上做的关键帧，不受影响。

审核图：[npc-merchant-v001.jpg](review/npc-merchant-v001.jpg)，上面是成品转台，下面是 Talk 的三个关键姿势，按主骨着色。

## 4. 积分

Tripo 10 件（9 件道具 + 商人），每件网格 100 + 贴图 30，共 **1300**。同批次 ART5 用了 1690，余额 6835 → 3845。

## 5. 还没做 / 交给代码的

- **宝箱开盖**：R1 用 `lidHinge` 把 `<ID>Lid` 挂到 `<ID>Body` 上，转动、光效、掉落表演都在运行时做。
- **商人站位和交互**：R3 / B2 补给营负责。商摊、铁砧、秘卷匣、药壶、弹药箱的摆放和价签都在商店界面里。
- **选人祭台演出**：U6 负责光柱、符文环流光、拖拽惯性、Show → Idle。
- **第一、三章的商摊**：这次只做了霜山商摊。第一章继续用现有 MarketStall / ForgeStall 占位；第三章跟着 ART6 一起暂缓，见 [ch3-kit.md](ch3-kit.md)。
