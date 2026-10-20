# 旱魃本体 + 日轮（ART1，2026-10-20）

第一章首领旱魃的正式美术：本体 `SK_Boss_Hanba` 和背后的白金日轮 `SM_BossPart_HanbaSunRing`。设计依据是 [unity-maps-v1.md](../level-design/unity-maps-v1.md) 第 3 节（悬浮的干瘦女神，身体约 4.5 米，日轮直径 6 米，焦黄残衣拖地，皮肤龟裂透白金光，心口「泉珠」是弱点），工作单元见 [unity-parity.md](../unity-parity.md) 第 5 节 ART1。动作不在这里，是 ART2。

审核图归档：[boss-hanba-design-v001.jpg](review/boss-hanba-design-v001.jpg)（设计稿 + 两套四视图）、[boss-hanba-model-rig-v001.jpg](review/boss-hanba-model-rig-v001.jpg)（成品转台、权重分区、6 个审核姿势、日轮审核图）。

## 1. 设计稿与四视图

按邪飞天的先例走（同样是悬浮人形，琵琶单独建模）：设计稿 → 本体四视图，日轮用 `reference_key` 从同一张设计稿出道具四视图。

- **设计条目**：`art/pipeline/enemy_designs_v2.json` 新加 `desert_hanba`（本体）和 `desert_hanba_sunring`（日轮）。旧条目 `desert_boss_hanba` 是青衣版（2026-10-07，PNG 已不在本机），标成 `superseded`。
- **出图**：本机 Codex CLI，`ART_CODEX_MODEL=gpt-5.6-sol`（pipeline.toml 的 gpt-6.1-sol 这台机器的 codex-cli 0.146.0 不认）。风格锚定图用第一章已过审模型的合影 `STYLE_ANCHOR_desert_v001.png`。
  - 设计稿 `DS_desert_hanba_v001`：焦黄 / 赭红残衣、炭黑龟裂皮肤透金光、心口水蓝泉珠、带火焰芒和八辐的白金日轮。按推荐版本直接用。
  - 本体四视图 `TV_desert_hanba_v001`：对称悬浮 A 字（掌心朝前、脚尖朝下），**特效分离的底态**：裂缝是平涂细线、眼睛平涂、泉珠是哑光水蓝球，不画日轮。
  - 日轮四视图：v001、v002 都被画成竖椭圆（四视图一行时每格是细高的 512 × 1024，模型把圆塞扁了；内圈拟合宽 / 高 0.68、0.81）。v003 = v002 的正、背视图按实测比例横向拉伸 1.238 修回正圆（日轮径向对称，拉伸不改设计），侧视图不动。
- 设计 PNG 按 `.gitignore` 不入库，只留提示词和生成记录（`art/source/characters/_design/desert/desert_hanba*/`）。

## 2. Tripo 生成

Claude in Chrome 打开 Tripo Studio，**智能网格 · 多视图**（前 / 左侧 / 右侧 / 后 = 四视图的 front / left / right / back），P2.0、三角面、生成数量 1，再点「纹理生成」。导出 GLB 4k（免费），归档进 `art/source/_tripo_inbox/20261020T131731_<资产>.glb`，同名 .json 回执记任务号、sha256、实得面数。

| 模型 | 任务 | 目标 / 实得面数 | 导出 | 积分 |
|---|---|---|---|---|
| 本体 SK_Boss_Hanba | [b2da5c15](https://studio.tripo3d.ai/zh/workspace/generate/b2da5c15-e1e2-46f9-937b-72fdaf1de851) | 30000 / 30791 | 5.2 MB，一张 4096 底色图 | 网格 100 + 贴图 30 |
| 日轮 SM_BossPart_HanbaSunRing | [82d96858](https://studio.tripo3d.ai/zh/workspace/generate/82d96858-dc3b-45a2-a5ef-f89cdbae2776) | 6000 / 6083 | 2.7 MB | 网格 100 + 贴图 30 |

**积分：共 260，10215 → 9955**（同一时段另一个会话在做第一章场景件，账户余额后来继续下降，那部分不是这里用的）。两个模型都一次成功，没有重做。

## 3. 本体：绑骨与发布

`python art/pipeline/build_tripo_creature.py SK_Boss_Hanba --publish`（骨架 `art/pipeline/creature_rigs/SK_Boss_Hanba.json`，审核姿势 `creature_rigs/review_poses/SK_Boss_Hanba.json`）。Tripo 只出了网格和贴图，没有绑骨，骨架全部自定义。

**成品**：高 4.5 米（头冠尖）；LOD 29550 / 11820 / 4925 面 + 泉珠发光壳 109 面；2048 贴图 2.0 MB，画质「高」用的 `@hi.glb`（4096）4.2 MB；84 根骨；校验 0 错误。

**体型与坐标**（构建按网格总高等比缩放、落地、按包围盒居中；米制 front = −Y，生物的左 = +X，up = +Z）：网格的包围盒被背后的长发和向后斜拖的下摆撑偏了，身体中线实测在 x 0.04、y −0.37，所有骨骼都按这条中线放。

| 部分 | 骨骼 | 要点 |
|---|---|---|
| 躯干 | root、hips、spine、chest、neck、head | 语义人形命名，Unity 按 semantic 映射建 Humanoid（41 根人形骨，含手指）。头用渐变球（截在下巴以上）锁住脸和头冠 |
| 手臂 | shoulder / arm / forearm / hand ×2 | 按手臂截面质心实测：肩 ±0.33 / z 3.33 → 肘 ±0.62 / 2.88 → 腕 ±0.925 / 2.44 |
| 手指 | thumb / index / middle / ring / pinky 各两节 ×2 | 按网格连通性在离腕 0.28 米处切开、量指根和指尖。右手五指分得开；左手指尖相连，按中线镜像右手（两手包围盒镜像后差不到 2 厘米） |
| 腿 | thigh / shin / foot / toe ×2 | 髋 ±0.10 / 2.48 → 膝 1.40 → 踝 0.46 → 趾尖 0.0（悬空，脚尖朝下）。限制盒不过中线（两腿内侧被 Tripo 熔在一起，越过中线时两只脚会互相分到对方的权重） |
| 残衣 | skirt_F 2 节，skirt_FL / FR / L / R / BL / BR / B 各 3 节 | 按各高度、各方位的衣片外缘（按底色挑出的饱和色顶点）实测；后侧下摆斜拖到半径 1.3 米 |
| 袖垂片 | sleeve_L / R 各 2 节 | **挂在锁骨 shoulder 上，不挂上臂**：挂上臂时平举双臂整片袖子翻起，拉伸 p99 5.9；挂锁骨后 3.0 |
| 长发 | hair_C 4 节（到 1.05 米），hair_L / R 各 4 节（到 1.55 米） | 一整片发幕垂在背后，三条链沿发幕中线 |
| 泉珠 | pearl（变形）+ socket_core（不变形） | 按水蓝贴图顶点拟合球：心 (0.049, −0.555, 3.251)、半径 0.117。pearl 只靠前半球裁剪的渐变球拿权重（距离权重里禁用，否则会吃掉周围一圈石框）；发光壳就建在 pearl 上 |
| 日轮挂点 | socket_sunring（不变形，挂 chest） | (0.04, 1.05, 3.45)：6 米日轮的轮毂厚 1.24 米，要避开最厚 0.8 米的头发；轮子下沿离地约 0.45 米 |

运行时弹簧骨：Unity 的 `CreatureRigBuilder` 按名字把 skirt_* / sleeve_* 归到 cloth 族、hair_* 归到 fur 族，不用另配。

**权重**：骨段距离（`weights = "segments"`），另加新的 **`color_bias`**（见第 5 节）。Tripo 把残衣、长发和皮肤熔成了一张连通网格，单靠距离，贴着腿的衣片会分给大腿、贴着背的发根会分给后摆。按底色把顶点分成「暗」（头发、皮肤，饱和度 < 0.42）和「饱和」（残衣，焦黑边也在 0.47 以上）两类，腿和发链偏向暗类、衣链和袖链偏向饱和类。

- 每个顶点的类别取 24 个最近邻里暗色顶点的比例，所以皮肤上的金色裂纹（高饱和细线）不会被分到衣服上。
- 是软偏置（下限 0.05），连在一起的边界仍按距离混合。试过硬切：头发和衣片分得最干净（衣片误归头发 0.9%），但熔在一起的边全被撕开，荡腿时拉伸 p99 到 70。
- 结果：按贴图颜色核对，背后的头发顶点 96.9% 归发链，背后的衣片只有 5% 归到发链（不加偏置时是 12%）。

**审核**（`art/tools/review_native_creature.py`，拉伸 = 姿势下边长 / 静止边长，取动了的边的 99 分位；前几章的敌人一般在 2–4）：

| 姿势 | 对应招式 | p99 |
|---|---|---|
| raise_sun | 举手召日（右臂高举、左臂前伸、仰头） | 3.23 |
| palm_press | 焦裂：俯身双手按地 | 3.06 |
| arms_wide | 双臂平举 | 3.23 |
| head_turn | 转头 | 2.67 |
| claws | 十指成爪 | 1.46 |
| hair_swing | 长发摆动 | 3.82 |
| robe_wind | 旱风：衣摆、袖子、头发后扬 | 2.10 |
| robe_flare | 衣摆向外扬开 | 3.17 |
| leg_swing | 悬空荡腿 | 2.21 |
| lean_back | 后仰 | 2.08 |

超标的边集中在两处：发梢和后摆交界（发链转动时，压在衣服上的发根内层被拉开），以及两腿内侧熔在一起的几十条边。运行时发链和衣链都是弹簧骨，会受重力垂下来；腿只做小幅摆动，不影响观感。

**调骨的做法**：先写离线蒙皮模拟（同一套骨段距离、限制盒、渐变球、颜色偏置，numpy 几秒出结果，拉伸数值和 Blender 审核差不到 10%），每版骨架先跑模拟再正式构建。试过的变体和结论：袖链挂上臂 → 改挂锁骨；腿限制盒越中线 1.5 cm → 超标边从 1.9% 升到 5.5%，不采用；pearl 参与距离权重 → 石框被吃进发光壳，改成只用渐变球。

## 4. 日轮

`bounds_only` 参考（`reference_dimensions = [6.0, 6.0, 1.3]`，`reference_origin = "center"`，原点 = 轮心）→ `tripo_assets.py adopt`（四视图 v003）→ `tripo_assets.py import` → `assetctl build / validate / review / approve / publish`。

- 第一次登记的厚度是 0.4 米，对齐时缩放取三个方向里最小的一个，被厚度卡住，轮子只剩 2.1 米（IoU 0.16）。Tripo 网格的轮毂两面凸起，厚约直径的 0.21，参考厚度改成 1.3 米后重新登记：尺寸 5.7 × 1.24 × 6.0 米，剪影 IoU 0.81。
- 成品：`boss_attachment` 档，LOD 5969 / 1988 面，2048 贴图，862 KB，assetctl 校验 41 项 0 警告。
- 平涂底态，本身不发光：发光、聚焦成光束、日蚀熄灭都由运行时着色器 / 特效做。
- 资产目录在 `art/source/attachments/SM_BossPart_HanbaSunRing/`（`boss_attachment` 档的类目是 attachments，不是 props）。

## 5. 管线改动

`art/pipeline/blender/bl_build_tripo_creature.py` 新加骨架 JSON 选项 `color_bias`（只在 `weights = "segments"` 时生效；没有这一项的资产走原来的分支，结果不变）：

```json
"color_bias": {"k": 24, "sat_split": 0.42, "ramp": [0.2, 0.8], "floor": 0.05,
               "bones": [{"bones": ["thigh_L", "…"], "class": "dark"}, {"bones": ["skirt_F1", "…"], "class": "cloth"}]}
```

每个顶点取 Tripo 底色图在其 UV 处的颜色，饱和度低于 `sat_split` 记为暗色；类别是 `k` 个最近邻里暗色的比例，按 `ramp` 映射成该类骨骼的打分系数（不低于 `floor`），乘到 1/d⁴ 上再取前三。衣服、头发、皮肤熔在一起的 Tripo 角色都可以用（以后的长袍、长发角色照这个配）。

## 6. 进 Unity

`python art/pipeline/unity_export.py SK_Boss_Hanba SM_BossPart_HanbaSunRing`，再 `bash scripts/unity/bridge.sh sync`。

| 资产 | Prefab | 导入结果 | ArtValidator |
|---|---|---|---|
| SK_Boss_Hanba | `Assets/Art/Prefabs/Characters/SK_Boss_Hanba.prefab` | 取 `@hi.glb`（4096 贴图）；Humanoid（semantic 映射，41 根人形骨）+ `AC_Humanoid`；LOD 29550 / 11820 / 4925；尺寸 2.68 × 4.5 × 1.84 米，与设计包围盒一致；`CreatureRigBuilder` 认出 13 条弹簧链（衣链 8、发链 3、袖链 2） | 0 错误，1 条警告：上臂与水平面夹 56.7°（A 字绑定姿势，非英雄不做 T-pose 修正，和举父一样） |
| SM_BossPart_HanbaSunRing | `Assets/Art/Prefabs/Attachments/SM_BossPart_HanbaSunRing.prefab` | LOD 5969 / 1988；尺寸 5.70 × 6.0 × 1.24 米，与设计一致 | 0 错误 0 警告 |

挂点朝向：两根挂点骨在 Blender 里都朝 +Y、roll 0（从发布的 GLB 回读确认绑定矩阵是单位矩阵），经 FBX 进 Unity 后与模型轴对齐，所以日轮按局部单位变换挂到 `socket_sunring` 上就是轮面朝前、火焰朝上。

**这个工作区的 Unity 批处理目前跑不起来**（和本资产无关）：W0-7 往 `Packages/manifest.json` 加的 `com.unity.animation.rigging` 一直没装进 `Library/PackageCache`。UPM 下载、解压都成功，最后把临时目录改名成 `com.unity.animation.rigging@ae5f251e1ed4` 时报 EPERM。GUI 编辑器会弹「Retry / Continue / Quit」，选 Continue 后照常运行；`-batchmode` 遇到这个错误直接退出（return 1）。所以这次是开着 GUI 编辑器、让 `bridge.sh sync` 把请求排进编辑器的 PipelineBridge 队列跑完的（249 个资产 247 通过；4 个错误都是同时在做的 SM_Decal_* 贴花，不是这两个资产）。

## 7. 交接（BS1 / BS2 / ART2）

- **Prefab 名固定**：`SK_Boss_Hanba`、`SM_BossPart_HanbaSunRing`，代码里的代理（SK_Enemy_Apsara 放大 3.5 倍）可以直接换成正式模型。
- **挂点**：`socket_core` 在泉珠中心（弱点命中盒，半径约 0.12 米，离地 3.25 米），`socket_sunring` 在背后轮心（离地 3.45 米，身后 1.4 米）。日轮 Prefab 的 `ArtAssetInfo.bind = enemy / boss_hanba / sunring`：关卡生成器把它放进 `EnemyCatalog.attachments` 后，`EnemyRoster` 会按 `socket_sunring` 挂上（和邪飞天的琵琶同一套）。日轮旋转、升顶、挡在身前都由代码移动这个挂点或日轮本身。
- **泉珠发光**：`SK_Boss_Hanba_GlowShell`（材质 `M_Boss_Hanba_Glow`，叠加混合）只盖泉珠前半球，日蚀和施法后摇时由代码打开 / 调亮，其余时间关掉。裂缝的白金光还没做：要在 StylizedLit 上按底色（金色细线）做自发光遮罩，属于 FX / 着色器单元。
- **悬浮高度**：模型的残衣下摆落在 z = 0，脚尖离地约 0 米。游戏里整体抬高约 0.5 米悬浮，下摆的弹簧骨会自然垂下。
- **人形**：Unity 建 Humanoid（semantic 映射），绑定姿势是 A 字（非英雄不做 T-pose 修正），QA 会给「上臂与水平面夹角」一条警告，和举父一样；ART2 用 Blender 关键帧做动作时直接在这套骨架上做。
