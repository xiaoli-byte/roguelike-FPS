# 第三章地图件（ART6 + 第三章 v2 新增件）

2026-11-03 完成；11-04 按 M33 补件需求补了铁桥 3 m 栏杆缺口（部件，不花积分），熔铁闸门门框改用现成门阙（Tripo 掉登录，没生成专用件）。上位设计 [ch3-v2.md](../level-design/ch3-v2.md) 第 6 节；美术路 A3。
（2026-10-22 用户曾说「暂时不做第三章的新模型」，11-02 解除，11-03 第三章 v2 重做按第 6 节恢复 Tripo。）

总览图：[review/ch3-v2/kit/ch3-v2-kit-overview.jpg](review/ch3-v2/kit/ch3-v2-kit-overview.jpg)（25 件的 3/4 视图）。

结果：ART6 12 件 + 必须 6 件 + 锦上添花 6 件 + 部件分离补的 1 件（绞盘 + 吊钩）= **25 件全部发布**，
另外切出 13 个部件（11-03 的 11 个 + 11-04 M33 补件要的铁桥缺口 2 个，第 3 节）。八角堤墩按第 6.1 节弃用。Tripo 共花 **3250** 积分，余额 3505 → **255**（第 5 节）。

## 0. 件表

尺寸是发布后的实际包围盒（宽 X × 高 Y × 深 Z，米，正面朝 +Z，原点在底面中心）。
Tripo 网格普遍比概念「瘦」，构建时按参考框等比对齐、取最紧的一轴，所以不少件比登记尺寸小——「建议摆放」给出怎么缩放到设计尺寸。
「顶面」是承重件实测的可站立顶面高度（发布尺度，向上法线面按高度聚类取面积最大的几层）。
「E」= 有自发光遮罩 `T_*_E`（第 4 节）。所有件只有 `_LOD0`，没有减面。

| ID | 名称 | 实测尺寸 W×H×D | 三角面 | 顶面（发布尺度） | E | 建议摆放 |
|---|---|---|---|---|---|---|
| **ART6** | | | | | | |
| SM_Tripo_InfernoCausewaySegment | 玄武岩堤道段 | 8.48 × 5 × 4.14 | 13945 | 堤面 4.0–4.5 | ✔ | 当堤道立面用：X ×1.42（12 m 一段），Z 按堤宽放大（堤面本身是地形） |
| SM_Tripo_InfernoSpiralLedge | 螺旋岩台沿 | 12.78 × 7 × 4.69 | 17004 | — | ✔ | 原样；背面贴井壁地形 |
| SM_Tripo_InfernoRockRib | 岩肋 | 9.37 × 16 × 7.54 | 13263 | — | ✔ | 原样 |
| SM_Tripo_InfernoCastingMould | 铸范（全遮 2.8） | 2.33 × 2.8 × 1.25 | 7541 | — | ✔ | X ×1.37、Z ×1.76 回到 3.2 × 2.2 占地 |
| SM_Tripo_InfernoCastingBed | 铸床（矮掩体） | 5.28 × 1.4 × 2.09 | 6625 | 1.4 | ✔ | X ×1.5、Z ×2.4 回到 8 × 5 |
| SM_Tripo_InfernoBellows | 巨型风箱（整件） | 9.26 × 5 × 4.02 | 30117 | — | ✔ | 等比 ×1.94 → 18 × 9.7 × 7.8；兽首喷口在 +X 端。要鼓动用部件版（第 3 节） |
| SM_Tripo_InfernoHangingForge | 悬炉锻台（整件，承重） | 17.56 × 8 × 17.63 | 25035 | **甲板 6.32**（17.3 × 16.8 m 平面） | ✔ | 等比 ×1.48 → 26 × 11.8 × 26，甲板顶 **9.35**；四角链柱、炉腹见第 3 节 |
| SM_Prop_QilinCauldron | 火麒麟吊鼎 / 3-1 镇湖鼎 | 5.52 × 8 × 4.23 | 28534 | 鼎口熔岩面 6.26 | ✔ | 原样；四个链挂点见第 3 节 |
| SM_Prop_QilinChainLock | 火麒麟锁扣 | 1.29 × 2.4 × 0.59 | 7946 | — | ✔ | 原样；背面贴墙 |
| SM_Tripo_InfernoMoltenGate | 熔铁闸门（**闸板**） | 6.83 × 9 × 1.33 | 11828 | — | ✔ | 闸板单独一件，X 按门洞宽缩放（10 m 门洞 ×1.46）；门框用 SM_Tripo_InfernoGateway（门洞实测 6.6 × 6.67，第 6 节） |
| SM_Tripo_InfernoRoundHallWall | 圆殿墙段 | 17.03 × 22 × 5.47 | 12930 | — | ✔ | 凹面朝 +Z（圆心方向），8 段一圈；排烟口发光 |
| SM_Tripo_InfernoRoundHallFurnace | 圆殿炉口墙段 | 17.16 × 22 × 4.85 | 24066 | — | ✔ | 同上；概念 v003 去掉了炉口火焰，炉口内壁平涂亮橙 |
| SM_Tripo_InfernoCausewayPier | 八角堤墩 | — | — | — | — | **弃用**，不建模 |
| **v2 必须的最小集** | | | | | | |
| SM_Tripo_InfernoGatehouse | 渡口关楼（承重） | 17.31 × 12 × 8.97 | 28929 | **城台 9.94**（左右两块各约 5 × 5.5 m）；檐下平台 8.0 | ✔ | 要城台正好 +8：等比 ×0.805（13.9 × 9.7 × 7.2）；门洞是空的，闸板挂 `SOCKET_Gate`；两侧外挂石阶没画出来，用 SM_Tripo_InfernoStairs |
| SM_Tripo_InfernoBasaltColumns | 玄武岩柱丛（全遮） | 6.63 × 9 × 6.52 | 15702 | 柱顶 3.6 / 4.0–4.3 / 5.1–5.4 / 6.8 / 9.0 | ✔ | 随机偏航；最低两根 3.6、4.2 可当台阶 |
| SM_Tripo_InfernoScaffold | 井壁栈架（承重） | 8.2 × 10 × 5.23 | 13939 | **下层 4.03、上层 8.73**（两层都是通宽平台） | ✔ | 等比 ×1.12 → 下层 4.5、上层 9.8；背面是岩体，嵌进井壁；层间是竖梯，22° 坡道由构建器补 |
| SM_Tripo_InfernoIronBridge | 铁桥（承重） | 10.87 × 2.5 × 8.05 | 12758 | **桥面 1.37**，栏杆顶 后 1.96 / 前 1.74 | ✔ | X ×1.1、Z ×1.24 → 12 × 10；桥面比约定（枢轴上 0.8）高 0.57，下沉 0.57 m 或 Y ×0.58；Tripo 没画出 3 m 缺口 → 要击退带就换部件 **SM_Tripo_InfernoIronBridgeGapped**（第 3 节，包围盒和原点同整件，直接换 ID） |
| SM_Tripo_InfernoHallTruss | 殿顶屋架 | 26.88 × 8.97 × 4.27 | 13204 | — | — | X ×0.89 → 24 m；斗拱端头托在扶壁顶；只给轮廓，不加碰撞也行 |
| SM_Tripo_InfernoLadleCrane | 浇包吊车门架（承重） | 17.22 × 13 × 8.09 | 23865 | **横梁顶 11.74**（宽约 1.75 m）；腿顶平台 10.0 | ✔ | 等比 ×1.02 → 横梁 +12；横梁只有 1.75 m 宽，3 m 走道要构建器补一块程序铁板；没有侧面铁梯 |
| **v2 锦上添花** | | | | | | |
| SM_Tripo_InfernoKilnMouth | 炉窟门脸 | 14.29 × 12 × 5.05 | 30388 | — | ✔ | X ×1.12 → 16 m；拱门贯通，背面贴岩壁 |
| SM_Tripo_InfernoSpout | 兽首熔流口 | 3.87 × 4 × 3.68 | 9773 | — | ✔ | 等比 ×1.3；嘴里平涂亮橙，熔流是特效（`FX_LavaPour`）；下颌没做成长溢流槽 |
| SM_Tripo_InfernoGuardianStatue | 神道铜人 | 2.97 × 7.5 × 2.34 | 15267 | **基座顶 2.15** | ✔ | 等比 ×1.21 → 基座 2.6（全遮）、总高 9.1；手里是立剑不是钺 |
| SM_Tripo_InfernoCausewayBreak | 断堤端头 | 8.7 × 5 × 8.77 | 16169 | — | ✔ | GPT 把它画成了下方崩裂的残堤块：半沉进熔岩用（下沉 1.5–2 m），不能和堤道段首尾拼 |
| SM_Tripo_InfernoGeyserVent | 熔泉喷口 | 6.72 × 2.08 × 6.62 | 7030 | — | ✔ | 原样；顶部岩壳是单独部件，可射爆（第 3 节） |
| SM_Tripo_InfernoWorkShed | 铸坊工棚 | 8.5 × 7 × 6.3 | 14568 | — | ✔ | 等比 ×1.18 → 10 m 宽；正面开敞，炉口平涂亮橙 |
| **部件分离补的件** | | | | | | |
| SM_Tripo_InfernoCraneHook | 绞盘 + 吊钩（整件） | 3.13 × 6 × 1.79 | 6535 | — | ✔ | 一般用部件版：绞盘挂横梁下 `SOCKET_Hook`，吊钩用链条连 |

## 1. 生产路线（这一轮的做法）

1. **登记**：registry「第三章地图件（ART6）」「第三章 v2 地图件」两节，`style_theme = "zhurong"`；`lod_tris` 记 Tripo 生成档（大件 3 万、中件 1.5 万、掩体 0.8 万）。
2. **概念**：ART6 的 10 件沿用 10-21 已过审的概念；悬炉锻台（v004）、圆殿炉口墙段（v003，去火焰）和 13 件新件改用 **Tripo Studio 图片页（GPT Image 2.5，免费额度）**，
   Codex 已没有余额。每个 prompt 出 4 张，挑一张登记，`generation.provider = tripo_studio`，记下选的是第几张。
   - prompt 开头写死「ONE SINGLE HORIZONTAL ROW … / 2 by 2 GRID …」和「No fire, no smoke, no sparks, no lava stream, no lava pool, no glow halo」；宽扁件（悬炉、铁桥、屋架、断堤、喷口）用 2×2 网格，每个视图大一倍。
   - 圆殿炉口墙段：上传 v002 原图做参考，「MANDATORY CHANGES」只改炉口内部。
   - 图片主机在 Chrome 里经常挂起：不靠页面显示，用页面里的 `fetch` 把 4×N 张原图打成一个包下载，本地拆开看。
   - 抠图（`scratchpad/a3/figs.py`）：除了从四边洪泛，**封闭在物体里的背景色空隙也抠掉**（桁架三角、栈架格间、吊车 A 字腿），否则 Tripo 会把灰底当成实心板。
   - 已过审的 ART6 概念里风箱、铸床的侧视图画反，上传 Tripo 前互换；锁扣的右视图镜像。
3. **Tripo**：智能网格、多视图（前 / 左 / 右 / 后各一张 1024² 抠图）、P2.0、三角面，再纹理生成；导出 GLB 4K，归档 `art/source/_tripo_inbox/<UTC>_<ID>.glb` + 回执。
4. **入库**：`tripo_assets.py import` → `assetctl build / validate / review / approve / publish` → `derive_inferno_parts.py`（部件）→ `unity_export.py` → `bridge.sh sync`。
5. 审核人记 `Claude AI visual review`（用户授权免审）。

## 2. 承重件：顶面高度与构建器常数

都是发布尺度（不缩放）下的实测值；构建器按自己的缩放乘上去。

| 件 | 顶面 | 等比缩放建议 | 缩放后顶面 | 备注 |
|---|---|---|---|---|
| 悬炉锻台 | 甲板 6.32（平面 x ±8.64、z −8.54…8.30） | ×1.48（26 m 宽） | **9.35** | 甲板沿没有连续矮栏（只有四角柱台），四面都是击退边；炉腹最低点 = 网格底 |
| 渡口关楼 | 城台 9.94（左右两块），檐台 8.0 | ×0.805（城台 +8） | **8.0** | 城台中间是门楣匾额，左右两块各约 4 × 4.4 m（缩放后） |
| 井壁栈架 | 下层 4.03、上层 8.73 | ×1.12 | **4.5 / 9.8** | 两层都通宽；层间竖梯 |
| 铁桥 | 桥面 1.37 | X ×1.1、Z ×1.24、Y ×0.58（或下沉 0.57） | **0.8** | 栏杆顶 1.96（Y ×0.58 后 1.14） |
| 浇包吊车门架 | 横梁 11.74（宽 1.75）、腿顶 10.0 | ×1.02 | **12.0** | 走道宽度不够，构建器补 3 m 宽程序铁板 + 栏杆 |
| 神道铜人 | 基座 2.15 | ×1.21 | **2.6** | 头顶的 `SOCKET_Perch` 在 7.5（×1.21 → 9.1） |
| 玄武岩柱丛 | 柱顶 3.6 / 4.0–4.3 / 5.1–5.4 / 6.8 / 9.0 | ×1.0 | 同左 | 3.6、4.2 两级可跳上 |
| 堤道段 | 4.0–4.5 | 立面件 | — | 堤面走地形 |

## 3. 部件分离与挂点

### 3.1 部件（`derive_inferno_parts.py`，registry 各件的 `parts` 表）

部件直接写进 `public/assets/manifest.json`（`generator.tool = "derived"`，`partOrigin` = 部件原点在母件里的位置，glTF 米：x = 资产左、y 上、z 前；
Unity 里 X 取反）。每个部件各自一个 Prefab：`unity/Assets/Art/Prefabs/Props/<部件 ID>.prefab`（网格 / 贴图在 `unity/Assets/Art/Props/<部件 ID>/`）。整件母件也照常发布，静态摆放用整件更省。
切口用平面切开再封口（封口 UV 取切口一圈的平均 UV）；只封切出来的口，Tripo 网格原有的接缝不动。

| 母件 | 部件 Prefab | 原点 | 原点在母件里（glTF） | 用途 |
|---|---|---|---|---|
| 巨型风箱 | SM_Tripo_InfernoBellowsFrame | 底面中心 | (0, 0, 0) | 框架、顶板、压杆、兽首喷口 |
| | SM_Tripo_InfernoBellowsBag | 包围盒中心 | (−0.525, 2.42, 0) | 风箱囊（6.95 × 2.6 × 3.37），沿 Y 缩放 0.85–1.1 就是「鼓动」 |
| 悬炉锻台 | SM_Tripo_InfernoHangingForgeDeck | 底面中心 | (0, 0, 0) | 甲板 + 炉腹（顶面 6.32） |
| | SM_Tripo_InfernoHangingForgePillarFL / FR / BL / BR | 底面中心 | (±6.96, 6.3, ±6.82)：FL = (+x, +z)，FR = (−x, +z)，BL = (+x, −z)，BR = (−x, −z) | 四角链柱（3.5 × 1.7 × 3.6，带灯）；吊链用 SM_Prop_InfernoChainLink 从 `SOCKET_Chain` 往上拼 |
| 绞盘 + 吊钩 | SM_Tripo_InfernoCraneHookWinch | 包围盒中心 | (0, 5.04, 0) | 绞盘（挂在吊车 `SOCKET_Hook`） |
| | SM_Tripo_InfernoCraneHookBlock | 包围盒中心 | (0, 1.83, 0.07) | 吊钩 + 滑轮组，链条连到绞盘的 `SOCKET_ChainTop`；浇包用 SM_Prop_InfernoCrucible 放大挂在钩上 |
| 熔泉喷口 | SM_Tripo_InfernoGeyserVentBase | 底面中心 | (0, 0, 0) | 底座锥（顶 1.31） |
| | SM_Tripo_InfernoGeyserVentCrust | 底面中心 | (0, 1.15, 0) | 顶部岩壳（2.8 × 0.93 × 2.8），射爆后隐藏 / 换碎块 |
| 铁桥 | SM_Tripo_InfernoIronBridgeGapped | 底面中心 | (0, 0, 0) | **带 3 m 栏杆缺口的整桥**（11-04 补，M33 要的击退带）：前侧（+Z）栏杆中段 x ±1.37 切到路缘顶 1.415（12 m 桥长时缺口 3.0 m，桥长 L 时 = 2.74 × L / 10.87）；包围盒、原点、桥面高度都和整件一样，`PlaceFit` 直接换 ID；网格碰撞体跟着网格，缺口处没有碰撞；缺口朝哪边就把桥转到哪边（+Z 是前）。14733 三角面（切面多出约 2000） |
| | SM_Tripo_InfernoIronBridgeRailPiece | 底面中心 | (0, 1.415, 3.2) | 切下来的那段前栏（2.74 × 0.33 × 0.62，370 三角面），可当「被撞断的栏杆」碎块，一般不用 |

其余拆分要求的落实：
- **熔铁闸门**：发布的就是闸板本身（单独一件，能升降）；门框没有单独建，用现成的 **SM_Tripo_InfernoGateway**（祝融熔铁门阙，11.31 × 10.75 × 2.2，8000 三角面）当门框：门洞实测宽 6.6（x ±3.3）、净高 6.67、前后贯通，门阙原点就在门洞底面中心。要 10 × 9 的门洞：门阙 X ×1.52、Y ×1.35（外廓 17.2 × 14.5）；闸板和门阙同原点，X 缩到门洞宽 + 0.6（两边各插进门柱 0.3 m），厚 1.33 < 门阙深 2.2，升起时从门楣后面穿出去 / 落进地下（3-4 已经这样用）。
- **渡口关楼**：门洞是空的，闸门挂 `SOCKET_Gate`，复用熔铁闸板（X 缩放到门洞宽）。
- **浇包吊车**：门架不带吊钩 / 绞盘 / 链（概念就这样画），吊钩件见上。
- **兽首熔流口 / 炉窟门脸 / 圆殿炉口 / 工棚**：只有建筑，熔流和火都在挂点上由特效做。

### 3.2 特效 / 挂件挂点

registry `fx_points`（glTF 米）→ `unity_export.py` 写进 `*.art.json` 的 `fxPoints`（X 取反）→ `ArtPrefabBuilder` 在 Prefab 根下建同名空节点；`dir` 给了的话节点的 +Z 指向它。
地图路在这些节点下面挂粒子 / 光 / 链条，不要往网格上画火。

| 件 | 挂点（glTF 坐标，发布尺度） | 用途 |
|---|---|---|
| 悬炉锻台（整件 / Deck） | `FX_BellyFire` (0, 0.3, 0) ↓；`FX_PortGlow` ×4 (±5.73, 3.54, 0)、(0, 3.4, ±5.81) | 炉腹往下掉火星、炉口一明一灭 |
| 悬炉锻台（整件 / Pillar*） | `FX_Lantern` ×4 (±7.61, 6.92, ±8.07)；`SOCKET_Chain` ×4 (±6.96, 8.0, ±6.82)（部件里是本地 (±0.65, 0.62, ±1.25) 和 (0, 1.7, 0)） | 柱灯火苗；吊链起点 |
| 巨型风箱（整件 / Frame） | `FX_NozzleFire` (4.2, 2.1, 0) → +X | 鼓风时喷口喷火 |
| 火麒麟吊鼎 | `FX_LavaSurface` (0, 6.26, 0) ↑；`SOCKET_ChainFL` (2.51, 5.98, 1.85)、`FR` (−2.56, 5.97, 1.94)、`BL` (2.56, 6.0, −1.94)、`BR` (−2.52, 6.07, −1.85) | 鼎口熔岩面着色器 / 热浪；四角铁环 = 四条巨链挂点（交 BS4 的 `QilinCauldron.cs`） |
| 火麒麟锁扣 | `FX_CoreGlow` (0, 0.8, 0.3) → +Z | 火晶核脉动光 |
| 熔铁闸门 | `FX_Sparks` (0, 0.1, 0) ↓ | 落闸 / 升闸时底边火星 |
| 圆殿墙段 | `FX_VentSmoke` (0, 16.4, −1.6) → +Z | 排烟口冒烟、红光 |
| 圆殿炉口墙段 | `FX_KilnFire` (0, 1.2, −1.6) → +Z | 炉口火焰；炭童从这里钻出 |
| 渡口关楼 | `FX_Brazier` ×4 (±5.8, 11.6, 2.0)、(±5.5, 11.0, −1.7) ↑；`SOCKET_Gate` (0, 0, 0) → +Z | 城台四角火盆；门洞闸板位置 |
| 铁桥 | `FX_Lantern` ×4 (±4.64, 1.63, ±3.06) | 桥头铜兽灯 |
| 浇包吊车门架 | `SOCKET_Hook` ×2 (±4.0, 10.0, 0) ↓ | 绞盘挂点 |
| 绞盘（部件） | `SOCKET_ChainTop` 本地 (0, −0.96, 0) | 链条从绞盘底下出 |
| 吊钩（部件） | `SOCKET_ChainBottom` 本地 (0, 1.83, 0) | 链条接吊钩顶 |
| 炉窟门脸 | `FX_KilnFire` (0, 0.8, 0) → +Z | 门内炭火光 / 热浪 |
| 兽首熔流口 | `FX_LavaPour` (0, 1.43, 0.9) → 前下方 | 熔铜从嘴里吐出（熔铜瀑落口、闸渠口） |
| 神道铜人 | `SOCKET_Perch` (0, 7.5, 0) | 毕方栖点 |
| 熔泉喷口（整件 / Base） | `FX_GeyserJet` (0, 2.08, 0) ↑（Base 里 (0, 1.31, 0)）；Crust：`FX_CrustBurst` 本地 (0, 0.5, 0) | 间歇熔泉 S3 的喷柱；岩壳被射爆的碎块 |
| 铸坊工棚 | `FX_ForgeFire` (0.2, 1.7, −1.9) → +Z | 棚内炉火 |

## 4. 自发光遮罩

`emid`（01c）要再出一张 GPT 遮罩图，这一轮没有 Codex 余额，改成在构建时从 Tripo 底色按颜色抠：
registry `emissive_key = { hue = [0.02, 0.17], min_sat = 0.65, min_val = 0.85 }`（亮橙到亮黄、高饱和、高亮度）→ `bl_build_tripo.py` 烘 `T_<名>_E`（= 底色 × 遮罩），
材质的自发光贴图接它，Unity 里 `_EMISSION` 打开。只有画成平涂亮橙的熔岩缝、炉口、火晶核、灯会亮，铜和朱漆不会被抠进去。
覆盖率：堤道段 4.9%、岩台沿 7.0%、柱丛 5.2%、熔泉喷口 4.4%、熔流口 3.8%，其余 0.1–2.6%；殿顶屋架没有发光部分，不加。

## 5. 积分记录

用户授权（2026-11-03）：「需要建模的你就自行使用tripo进行建模，我同意你使用我的积分，不必再询问我了」。余额低于 150 停止。
每件网格 100 + 纹理 30 = 130；图片页出概念图免费（这一轮约 60 张）。共 25 件 × 130 = **3250**，其中 24 件是原计划，**绞盘 + 吊钩 130 是部件分离追加的额外生成**。
余额 3505 → **255**。没有失败重生成。

| 时间（UTC） | 件 | 项目 | Tripo 任务 | 积分 | 余额 |
|---|---|---|---|---|---|
| 20261102T165050 | InfernoCausewaySegment | 网格 P2.0 三角面 15000 | [1bdcb980](https://studio.tripo3d.ai/workspace/generate/1bdcb980-e30b-4842-9cd5-31f9ab406aff) | 100 | 3405 |
| 20261102T165219 | InfernoSpiralLedge | 网格 P2.0 三角面 15000 | [c73c9a51](https://studio.tripo3d.ai/workspace/generate/c73c9a51-c907-47cb-ad9c-3893da7eca6a) | 100 | 3305 |
| 20261102T165303 | InfernoRockRib | 网格 P2.0 三角面 15000 | [41c669c9](https://studio.tripo3d.ai/workspace/generate/41c669c9-7a4a-4229-a960-8468971bddb6) | 100 | 3205 |
| 20261102T165453 | InfernoCastingMould | 网格 P2.0 三角面 8000 | [8e0b34a1](https://studio.tripo3d.ai/workspace/generate/8e0b34a1-de38-4985-931c-ad23b62aecd1) | 100 | 3105 |
| 20261102T165645 | InfernoCastingBed | 网格 P2.0 三角面 8000 | [b6307ffa](https://studio.tripo3d.ai/workspace/generate/b6307ffa-4448-4c71-8b60-40a2d17db0c4) | 100 | 3005 |
| 20261102T165725 | QilinChainLock | 网格 P2.0 三角面 8000 | [57bb18ed](https://studio.tripo3d.ai/workspace/generate/57bb18ed-30a8-4df7-97e4-cbffa41e34da) | 100 | 2905 |
| 20261102T165816 | InfernoMoltenGate | 网格 P2.0 三角面 15000 | [509045aa](https://studio.tripo3d.ai/workspace/generate/509045aa-0f73-42bf-8c10-0958a98aca86) | 100 | 2805 |
| 20261102T165908 | InfernoRoundHallWall | 网格 P2.0 三角面 15000 | [0141a296](https://studio.tripo3d.ai/workspace/generate/0141a296-573d-4e88-b31a-4e2055c8acb8) | 100 | 2705 |
| 20261102T170020 | InfernoBellows | 网格 P2.0 三角面 30000 | [f79904e4](https://studio.tripo3d.ai/workspace/generate/f79904e4-0d83-4465-bc20-ae5cb607cca4) | 100 | 2605 |
| 20261102T170112 | QilinCauldron | 网格 P2.0 三角面 30000 | [67271eec](https://studio.tripo3d.ai/workspace/generate/67271eec-6ae9-422d-84e5-cb450b7d8712) | 100 | 2505 |
| 20261102T170150 | InfernoCausewaySegment | 纹理 | [1bdcb980](https://studio.tripo3d.ai/workspace/generate/1bdcb980-e30b-4842-9cd5-31f9ab406aff) | 30 | 2475 |
| 20261102T170251 | InfernoSpiralLedge | 纹理 | [c73c9a51](https://studio.tripo3d.ai/workspace/generate/c73c9a51-c907-47cb-ad9c-3893da7eca6a) | 30 | 2445 |
| 20261102T170328 | InfernoRockRib | 纹理 | [41c669c9](https://studio.tripo3d.ai/workspace/generate/41c669c9-7a4a-4229-a960-8468971bddb6) | 30 | 2415 |
| 20261102T170405 | InfernoCastingMould | 纹理 | [8e0b34a1](https://studio.tripo3d.ai/workspace/generate/8e0b34a1-de38-4985-931c-ad23b62aecd1) | 30 | 2385 |
| 20261102T170442 | InfernoCastingBed | 纹理 | [b6307ffa](https://studio.tripo3d.ai/workspace/generate/b6307ffa-4448-4c71-8b60-40a2d17db0c4) | 30 | 2355 |
| 20261102T170511 | QilinChainLock | 纹理 | [57bb18ed](https://studio.tripo3d.ai/workspace/generate/57bb18ed-30a8-4df7-97e4-cbffa41e34da) | 30 | 2325 |
| 20261102T170536 | InfernoMoltenGate | 纹理 | [509045aa](https://studio.tripo3d.ai/workspace/generate/509045aa-0f73-42bf-8c10-0958a98aca86) | 30 | 2295 |
| 20261102T170601 | InfernoRoundHallWall | 纹理 | [0141a296](https://studio.tripo3d.ai/workspace/generate/0141a296-573d-4e88-b31a-4e2055c8acb8) | 30 | 2265 |
| 20261102T170635 | InfernoBellows | 纹理 | [f79904e4](https://studio.tripo3d.ai/workspace/generate/f79904e4-0d83-4465-bc20-ae5cb607cca4) | 30 | 2235 |
| 20261102T170651 | QilinCauldron | 纹理 | [67271eec](https://studio.tripo3d.ai/workspace/generate/67271eec-6ae9-422d-84e5-cb450b7d8712) | 30 | 2205 |
| 20261102T180159 | InfernoHangingForge | 网格 P2.0 三角面 30000 | [99dbb7bf](https://studio.tripo3d.ai/workspace/generate/99dbb7bf-e053-4c0f-b2e2-a961b9271df8) | 100 | 2105 |
| 20261102T180312 | InfernoGatehouse | 网格 P2.0 三角面 30000 | [355744d0](https://studio.tripo3d.ai/workspace/generate/355744d0-647e-4cc2-bcb6-c2009eafc218) | 100 | 2005 |
| 20261102T180421 | InfernoLadleCrane | 网格 P2.0 三角面 30000 | [70903862](https://studio.tripo3d.ai/workspace/generate/70903862-5f0a-4ad1-a41f-2893557a08a4) | 100 | 1905 |
| 20261102T180526 | InfernoBasaltColumns | 网格 P2.0 三角面 15000 | [7d018205](https://studio.tripo3d.ai/workspace/generate/7d018205-0971-4dc0-bc62-fee3196e395b) | 100 | 1805 |
| 20261102T180627 | InfernoScaffold | 网格 P2.0 三角面 15000 | [17c7b100](https://studio.tripo3d.ai/workspace/generate/17c7b100-4458-400e-9df2-38015f39c493) | 100 | 1705 |
| 20261102T180720 | InfernoIronBridge | 网格 P2.0 三角面 15000 | [9507e6e7](https://studio.tripo3d.ai/workspace/generate/9507e6e7-c109-4da3-96fd-560980b88c9b) | 100 | 1605 |
| 20261102T180816 | InfernoHallTruss | 网格 P2.0 三角面 15000 | [3fe16759](https://studio.tripo3d.ai/workspace/generate/3fe16759-6cb1-4458-8db0-d5b6f791dc63) | 100 | 1505 |
| 20261102T181436 | InfernoHangingForge | 纹理 | [99dbb7bf](https://studio.tripo3d.ai/workspace/generate/99dbb7bf-e053-4c0f-b2e2-a961b9271df8) | 30 | 1475 |
| 20261102T181646 | InfernoGatehouse | 纹理 | [355744d0](https://studio.tripo3d.ai/workspace/generate/355744d0-647e-4cc2-bcb6-c2009eafc218) | 30 | 1445 |
| 20261102T181713 | InfernoLadleCrane | 纹理 | [70903862](https://studio.tripo3d.ai/workspace/generate/70903862-5f0a-4ad1-a41f-2893557a08a4) | 30 | 1415 |
| 20261102T181828 | InfernoBasaltColumns | 纹理 | [7d018205](https://studio.tripo3d.ai/workspace/generate/7d018205-0971-4dc0-bc62-fee3196e395b) | 30 | 1385 |
| 20261102T182021 | InfernoScaffold | 纹理 | [17c7b100](https://studio.tripo3d.ai/workspace/generate/17c7b100-4458-400e-9df2-38015f39c493) | 30 | 1355 |
| 20261102T182122 | InfernoIronBridge | 纹理 | [9507e6e7](https://studio.tripo3d.ai/workspace/generate/9507e6e7-c109-4da3-96fd-560980b88c9b) | 30 | 1325 |
| 20261102T182150 | InfernoHallTruss | 纹理 | [3fe16759](https://studio.tripo3d.ai/workspace/generate/3fe16759-6cb1-4458-8db0-d5b6f791dc63) | 30 | 1295 |
| 20261102T211136 | InfernoRoundHallFurnace | 网格 P2.0 三角面 30000 | [daa3b041](https://studio.tripo3d.ai/workspace/generate/daa3b041-6556-4d2a-a823-7187e0965809) | 100 | 1195 |
| 20261102T211254 | InfernoCraneHook | 网格 P2.0 三角面 8000（部件分离额外件） | [efae4706](https://studio.tripo3d.ai/workspace/generate/efae4706-9c6f-47f8-9863-124b6608419c) | 100 | 1095 |
| 20261102T211355 | InfernoGeyserVent | 网格 P2.0 三角面 8000 | [285199e2](https://studio.tripo3d.ai/workspace/generate/285199e2-5010-49ab-b8e3-6edca76ae4d9) | 100 | 995 |
| 20261102T211501 | InfernoKilnMouth | 网格 P2.0 三角面 30000 | [a64cd91b](https://studio.tripo3d.ai/workspace/generate/a64cd91b-e70f-4dc1-a5fd-913d0ab23df5) | 100 | 895 |
| 20261102T211615 | InfernoSpout | 网格 P2.0 三角面 10000 | [af104ff3](https://studio.tripo3d.ai/workspace/generate/af104ff3-238f-4ce7-88c1-698fb243e660) | 100 | 795 |
| 20261102T211733 | InfernoGuardianStatue | 网格 P2.0 三角面 15000 | [a734248d](https://studio.tripo3d.ai/workspace/generate/a734248d-bcc4-4468-8234-b138b1a3c399) | 100 | 695 |
| 20261102T211836 | InfernoCausewayBreak | 网格 P2.0 三角面 15000 | [8494e5af](https://studio.tripo3d.ai/workspace/generate/8494e5af-a845-4653-81f3-1488b71e55cc) | 100 | 595 |
| 20261102T211941 | InfernoWorkShed | 网格 P2.0 三角面 15000 | [7b949262](https://studio.tripo3d.ai/workspace/generate/7b949262-6cc8-4f9c-b066-1303fd6fe416) | 100 | 495 |
| 20261102T212052 | InfernoRoundHallFurnace | 纹理 | [daa3b041](https://studio.tripo3d.ai/workspace/generate/daa3b041-6556-4d2a-a823-7187e0965809) | 30 | 465 |
| 20261102T212150 | InfernoCraneHook | 纹理 | [efae4706](https://studio.tripo3d.ai/workspace/generate/efae4706-9c6f-47f8-9863-124b6608419c) | 30 | 435 |
| 20261102T212248 | InfernoGeyserVent | 纹理 | [285199e2](https://studio.tripo3d.ai/workspace/generate/285199e2-5010-49ab-b8e3-6edca76ae4d9) | 30 | 405 |
| 20261102T212345 | InfernoKilnMouth | 纹理 | [a64cd91b](https://studio.tripo3d.ai/workspace/generate/a64cd91b-e70f-4dc1-a5fd-913d0ab23df5) | 30 | 375 |
| 20261102T212436 | InfernoSpout | 纹理 | [af104ff3](https://studio.tripo3d.ai/workspace/generate/af104ff3-238f-4ce7-88c1-698fb243e660) | 30 | 345 |
| 20261102T212535 | InfernoGuardianStatue | 纹理 | [a734248d](https://studio.tripo3d.ai/workspace/generate/a734248d-bcc4-4468-8234-b138b1a3c399) | 30 | 315 |
| 20261102T212633 | InfernoCausewayBreak | 纹理 | [8494e5af](https://studio.tripo3d.ai/workspace/generate/8494e5af-a845-4653-81f3-1488b71e55cc) | 30 | 285 |
| 20261102T212735 | InfernoWorkShed | 纹理 | [7b949262](https://studio.tripo3d.ai/workspace/generate/7b949262-6cc8-4f9c-b066-1303fd6fe416) | 30 | 255 |

## 6. 和设计不一致 / 没做的

| 件 | 情况 | 地图路怎么办 |
|---|---|---|
| 熔铁闸门 | 闸板是单独一件；**专用门框没建**：11-03 余额 255 时为保 150 底线没生成，11-04 M33 补件要门框时 Tripo 网页掉了登录（没有重新登录，按规则停） | 门框用 SM_Tripo_InfernoGateway（门洞 6.6 × 6.67，缩放见第 3.1 节末）；渡口关楼门洞挂 `SOCKET_Gate`。要专用门框，Tripo 登录恢复后再生成一件（130，余额会到 125） |
| 悬炉锻台 | GPT 没画中心炉坛和西侧吊臂根；链柱只有 1.7 m 高（栖点够用） | 中心全遮用 SM_Prop_InfernoCrucible / FireAltar 放大摆在甲板中央；吊臂用程序几何 |
| 渡口关楼 | 两侧外挂石阶没画；城台在 9.94（设计 +8） | SM_Tripo_InfernoStairs 贴两侧；等比 ×0.805 |
| 铁桥 | Tripo 画的两侧栏杆连续，没有 3 m 缺口 | **11-04 已用部件补上**：SM_Tripo_InfernoIronBridgeGapped（前栏中段切掉 3 m，第 3.1 节），不花积分 |
| 浇包吊车 | 横梁顶只有 1.75 m 宽、没有侧面铁梯 | 补程序走道板和竖梯 |
| 断堤端头 | 画成了底部崩裂的残堤块，两端都不能和堤道段齐平对接 | 半沉进熔岩当残堤 / 跳石；断堤缺口两侧用堤道段 + Basalt |
| 兽首熔流口 | 下颌没做成长溢流槽 | 熔流特效从 `FX_LavaPour` 往前下方喷 |
| 神道铜人 | 手持立剑，不是钺；头顶有一根短盔缨 | 毕方栖点用 `SOCKET_Perch` |
| 井壁栈架 | 层间是竖梯，没有 22° 铁梯坡 | 坡道由构建器补 |

其他：
- ART6 的 10 件沿用旧概念，堤道段、岩台沿、岩肋的熔岩缝画成了火舌形的亮橙带，属于平涂色块（走 `T_E`），没有火焰几何。
- 链条（悬炉吊链、吊鼎四链、吊车链）一律用 SM_Prop_InfernoChainLink 在运行时拼，件里不带链。
