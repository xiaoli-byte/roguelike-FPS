# 第三章地图件（ART6 + 第三章 v2 新增件）

2026-11-03 完成；11-04 按 M33 补件需求补了铁桥 3 m 栏杆缺口（部件，不花积分）和熔铁闸门专用门框 SM_Tripo_InfernoMoltenGateFrame（Tripo 130）。上位设计 [ch3-v2.md](../level-design/ch3-v2.md) 第 6 节；美术路 A3。
（2026-10-22 用户曾说「暂时不做第三章的新模型」，11-02 解除，11-03 第三章 v2 重做按第 6 节恢复 Tripo。）

总览图：[review/ch3-v2/kit/ch3-v2-kit-overview.jpg](review/ch3-v2/kit/ch3-v2-kit-overview.jpg)（25 件的 3/4 视图）。

结果：ART6 12 件 + 必须 6 件 + 锦上添花 6 件 + 部件分离补的 1 件（绞盘 + 吊钩）= **25 件全部发布**，
另外切出 13 个部件（11-03 的 11 个 + 11-04 M33 补件要的铁桥缺口 2 个，第 3 节）；11-04 补生成熔铁闸门门框 1 件，共 **26 件**。八角堤墩按第 6.1 节弃用。Tripo 共花 **3380** 积分，余额 3505 → **125**（第 5 节）。

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
| SM_Tripo_InfernoMoltenGate | 熔铁闸门（**闸板**） | 6.83 × 9 × 1.33 | 11828 | — | ✔ | 闸板单独一件，X 按门洞宽缩放（10 m 门洞 ×1.46）；门框是 SM_Tripo_InfernoMoltenGateFrame（下一行、第 3.1 节末） |
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
| **11-04 M33 补件** | | | | | | |
| SM_Tripo_InfernoMoltenGateFrame | 熔铁闸门门框 | 13.89 × 12 × 3.32 | 12442 | — | ✔ | 和闸板配套：门框原点 = 门洞底面中心 = 闸板原点（`SOCKET_Gate`）。门洞实测：门柱身之间 7.84、柱脚 / 柱头箍带处最窄 6.4、门楣下缘 8.26（两角斜撑处 7.75）。给定闸板尺寸 W × H 时门框 **X = W / 8.35、Y = H / 8.8**，3-3 的 10 × 9 闸板 → X ×1.20、Y ×1.02（外廓 16.7 × 12.2），见第 3.1 节末 |

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
- **熔铁闸门**：闸板 SM_Tripo_InfernoMoltenGate 和门框 **SM_Tripo_InfernoMoltenGateFrame**（11-04 补）是两件，闸板单独升降。
  门框实测（发布尺度，13.89 × 12 × 3.32，原点在门洞底面中心）：门柱身内侧 ±3.92（y 1.5–6.5），柱脚箍带和柱头箍带向里凸到 ±3.2（y 0–1.5、6.5–7.5），门楣下缘中段 8.26、两角斜撑压到 7.75；门柱前后贯通 z ±1.27，斜撑只在中面 z −0.36…+0.44。
  **配法**：闸板宽要盖过门柱身（每边插进柱身 ≥ 0.25 m），顶要藏到门楣后面（≥ 0.5 m）→ 门框原尺寸配 8.35 × 8.8 的闸板。给定闸板 W × H（3-3 现在 PlaceFit 的尺寸）：门框 **X = W / 8.35、Y = H / 8.8**，Z 不必跟（闸板厚 1.4 < 门柱深 2.5）；两件同原点、同朝向。
  | 3-3 位置 | 闸板 W × H | 门框缩放 X / Y | 门框外廓 | 开闸后净宽（柱脚处） |
  |---|---|---|---|---|
  | 闸前桥封门（GateSize） | 10 × 9 | 1.20 / 1.02 | 16.7 × 12.2 | 7.7 |
  | 东铸北桥封门（X ×1.2） | 12 × 9 | 1.44 / 1.02 | 20.0 × 12.2 | 9.2 |
  | 炉闸（×1.2） | 12 × 10.8 | 1.44 / 1.23 | 20.0 × 14.7 | 9.2 |
  | ③ 东壁铸门（×0.9） | 9 × 8.1 | 1.08 / 0.92 | 15.0 × 11.0 | 6.9 |
  闸板关着时两角斜撑整个藏在闸板厚度里；开闸请往下沉进地面（3-4 的做法），往上提超过 3 m 闸板会从门楣顶上露出来。门框用网格碰撞体，开闸后柱脚箍带处是最窄的通道。10 × 9 闸板配 X 1.20 / Y 1.02 门框的样子：[review/ch3-v2/kit/ch3-v2-gate-frame-pair.jpg](review/ch3-v2/kit/ch3-v2-gate-frame-pair.jpg)。没有专用门框时的旧替代（SM_Tripo_InfernoGateway 门阙，门洞 6.6 × 6.67）不再需要。
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
| 熔铁闸门门框 | `SOCKET_Gate` (0, 0, 0) | 闸板挂点（门洞底面中心，闸板原点放这里） |
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
每件网格 100 + 纹理 30 = 130；图片页出概念图免费（这一轮约 60 张）。共 26 件 × 130 = **3380**，其中 24 件是原计划；**额外生成 2 件**：绞盘 + 吊钩 130（部件分离追加，11-03）、熔铁闸门门框 130（11-04 M33 补件，协调方转达用户已重新登录 Tripo 后做的）。
余额 3505 → 255（11-03）→ **125**（11-04）。没有失败重生成。

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
| 20261104T132513 | InfernoMoltenGateFrame（额外，11-04 补件） | 网格 P2.0 三角面 15000 | [04a2354f](https://studio.tripo3d.ai/workspace/generate/04a2354f-f193-4eca-85dc-c6c172d3c0d7) | 100 | 155 |
| 20261104T132732 | InfernoMoltenGateFrame（额外，11-04 补件） | 纹理 | [04a2354f](https://studio.tripo3d.ai/workspace/generate/04a2354f-f193-4eca-85dc-c6c172d3c0d7) | 30 | 125 |

**新账号（2026-11-06 起）**：用户 11-06 换到新账号、充值到 31800。这条线（T1 重出贴图）的软上限 6000，超过先停。
「纹理生成」= 左栏纹理生成上传我们自己的网格、打开「使用原始 UV」、勾「去光处理」、4K，每次 **20**（8K 有一次试用，没用）；导出 GLB 4k 不花积分。做法见第 7 节。

| 时间（UTC） | 件 | 项目 | Tripo 任务 | 积分 | 余额 |
|---|---|---|---|---|---|
| 20261106T1543 | 熔心魔将 DS v006 概念图 ×4 | 图片页 GPT Image 2.5（免费额度） | 图片任务 5a932e45 | 0 | 31800 |
| 20261106T1548 | InfernoFireAltar | 纹理生成①：文字提示（「炭不是火」） | [3b1cc693](https://studio.tripo3d.ai/workspace/texture/3b1cc693-09b2-464a-a37e-13d8d6740b11) | 20 | 31780 |
| 20261106T1551 | InfernoFireAltar | 纹理生成②：文字提示改写（不提火） | 同上 | 20 | 31760 |
| 20261106T1555 | InfernoFireAltar | 纹理生成③：参考图（当前火坛渲染、炭床涂暗）——**采用** | 同上 | 20 | 31740 |
| 20261106T1610 | InfernoRoundHallWall | 纹理生成（试点，参考图 = 原件平光渲染简化） | [97b6f229](https://studio.tripo3d.ai/workspace/texture/97b6f229-6856-4580-9511-7841393e972e) | 20 | 31720 |
| 20261106T1616 | InfernoBasaltColumns | 纹理生成（试点，同上） | [bc94a70f](https://studio.tripo3d.ai/workspace/texture/bc94a70f-08a5-4b75-9d10-364d13967158) | 20 | 31700 |
| 20261106T1622 | InfernoRockRib | 纹理生成（试点，同上） | [03a65abf](https://studio.tripo3d.ai/workspace/texture/03a65abf-4a2a-4680-bdf8-776fadb0e139) | 20 | 31680 |
| 20261106T1711 | 熔心魔将本体 SK_Boss_Warlord（boss-warlord.md 第 3.1 节） | 高精度模型 H3.1 多视图，三角面 50000，纹理 4K 去光 | [c8eeaec6](https://studio.tripo3d.ai/workspace/generate/c8eeaec6-2511-4758-b071-27fe76545f36) | 55 | — |
| 20261106T1711 | 熔心魔将大剑 SM_BossWeapon_Greatsword | 高精度模型 H3.1 多视图，三角面 15000，纹理 4K 去光 | [e6e0b59d](https://studio.tripo3d.ai/workspace/generate/e6e0b59d-7eda-4059-8b56-5bb98e442b47) | 55 | — |
| 20261106T1718 | InfernoGatehouse | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [e69fa5ea](https://studio.tripo3d.ai/workspace/texture/e69fa5ea-fcba-4d9e-aeeb-a4c741c2c209) | 20 | — |
| 20261106T1720 | InfernoCausewaySegment | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [83d1462a](https://studio.tripo3d.ai/workspace/texture/83d1462a-89c8-4de4-a117-b0bf145f4ae1) | 20 | — |
| 20261106T1723 | InfernoSpiralLedge | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [7e099041](https://studio.tripo3d.ai/workspace/texture/7e099041-8dfa-495a-af01-ec5958c8d247) | 20 | — |
| 20261106T1723 | InfernoKilnMouth | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [e3340838](https://studio.tripo3d.ai/workspace/texture/e3340838-9252-4a78-80a2-ff4edcac399b) | 20 | — |
| 20261106T1724 | InfernoLadleCrane | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [dec519a3](https://studio.tripo3d.ai/workspace/texture/dec519a3-9deb-4278-ab6b-b3562a5ae026) | 20 | — |
| 20261106T1725 | InfernoHangingForge | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [f089ce00](https://studio.tripo3d.ai/workspace/texture/f089ce00-a331-48af-ada0-9441b8659787) | 20 | — |
| 20261106T1726 | InfernoRoundHallFurnace | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [1410c4be](https://studio.tripo3d.ai/workspace/texture/1410c4be-af5a-41d1-9316-31b90b75a3fb) | 20 | — |
| 20261106T1733 | InfernoMoltenGate | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [4db3e846](https://studio.tripo3d.ai/workspace/texture/4db3e846-e5eb-420d-8ee6-f1f4512b622e) | 20 | — |
| 20261106T1734 | InfernoMoltenGateFrame | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [f5acc4c7](https://studio.tripo3d.ai/workspace/texture/f5acc4c7-a722-4776-91dd-b945703a8ec1) | 20 | — |
| 20261106T1735 | InfernoCausewayBreak | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [43780b0b](https://studio.tripo3d.ai/workspace/texture/43780b0b-e341-4f9e-9d43-39a2427f6cbd) | 20 | — |
| 20261106T1743 | InfernoScaffold | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [c0080211](https://studio.tripo3d.ai/workspace/texture/c0080211-4b01-4cb0-8564-7d2396a19e57) | 20 | — |
| 20261106T1744 | QilinCauldron | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [c2be336a](https://studio.tripo3d.ai/workspace/texture/c2be336a-144f-41ac-8062-862a9b9c7c51) | 20 | — |
| 20261106T1748 | InfernoCastingMould | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [48ab4493](https://studio.tripo3d.ai/workspace/texture/48ab4493-72cb-420f-b03a-eaf5b010e1d9) | 20 | — |
| 20261106T1750 | InfernoCastingBed | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [c7e4b06e](https://studio.tripo3d.ai/workspace/texture/c7e4b06e-99f7-43d4-8ec8-bebc1fb5ff79) | 20 | — |
| 20261106T1801 | InfernoBellows | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [92f1b3ae](https://studio.tripo3d.ai/workspace/texture/92f1b3ae-1602-4089-b671-babf118aa8ed) | 20 | — |
| 20261106T1805 | QilinChainLock | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [5f4ce7aa](https://studio.tripo3d.ai/workspace/texture/5f4ce7aa-53cf-4bac-af6b-85bf6ea0f8f9) | 20 | — |
| 20261106T1807 | InfernoIronBridge | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [53fd2d47](https://studio.tripo3d.ai/workspace/texture/53fd2d47-51c3-4b51-97ab-40280e5441bf) | 20 | — |
| 20261106T1809 | InfernoHallTruss | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [4ddf8c73](https://studio.tripo3d.ai/workspace/texture/4ddf8c73-aa95-4ae3-a4a2-2e95e8914282) | 20 | — |
| 20261106T1811 | InfernoCraneHook | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [981ba42c](https://studio.tripo3d.ai/workspace/texture/981ba42c-c2ec-42b8-a30d-da537d3d2fd4) | 20 | — |
| 20261106T1814 | InfernoSpout | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [6d5cadc5](https://studio.tripo3d.ai/workspace/texture/6d5cadc5-9eb3-4e7f-b809-7084513affa3) | 20 | — |
| 20261106T1816 | InfernoGuardianStatue | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [09ae73e9](https://studio.tripo3d.ai/workspace/texture/09ae73e9-4dd1-4083-a242-a6be1f3fab60) | 20 | — |
| 20261106T1818 | InfernoGeyserVent | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [74fe4647](https://studio.tripo3d.ai/workspace/texture/74fe4647-fc49-49d0-97da-f9dc4e86b151) | 20 | — |
| 20261106T1821 | InfernoWorkShed | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [dc99b0f8](https://studio.tripo3d.ai/workspace/texture/dc99b0f8-4680-4965-9195-91655fbc1061) | 20 | — |
| 20261107T1243 | InfernoCoverWall | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [c404b8a1](https://studio.tripo3d.ai/workspace/texture/c404b8a1-6767-47c4-bcc8-c40798e29658) | 20 | — |
| 20261107T1244 | InfernoPortalShrine | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [e6c30b1f](https://studio.tripo3d.ai/workspace/texture/e6c30b1f-2fe5-4ed9-8aef-322c8338f869) | 20 | — |
| 20261107T1245 | InfernoColumn | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [541ed68e](https://studio.tripo3d.ai/workspace/texture/541ed68e-b77f-4e1a-b1f6-033c2e3ca69c) | 20 | — |
| 20261107T1247 | InfernoZhurong | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [aa64829a](https://studio.tripo3d.ai/workspace/texture/aa64829a-7f1e-4b04-b245-6fa29b2bca27) | 20 | — |
| 20261107T1248 | InfernoRampart | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [b935a412](https://studio.tripo3d.ai/workspace/texture/b935a412-cb5f-461e-83b6-b9fe125b1829) | 20 | — |
| 20261107T1251 | InfernoRampartPlain | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [5ef2aee9](https://studio.tripo3d.ai/workspace/texture/5ef2aee9-72d2-4bb6-a282-5e16089459ce) | 20 | — |
| 20261107T1252 | InfernoGateway | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [254a99ef](https://studio.tripo3d.ai/workspace/texture/254a99ef-11a7-47d0-a3cd-fb03120bb7fe) | 20 | — |
| 20261107T1253 | InfernoBarricade | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [f1b30706](https://studio.tripo3d.ai/workspace/texture/f1b30706-0bd6-42a1-862e-ea907ed5f820) | 20 | — |
| 20261107T1255 | InfernoPlatformBlock | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [e9eb8a05](https://studio.tripo3d.ai/workspace/texture/e9eb8a05-c2c3-4931-af67-11e65e957b29) | 20 | — |
| 20261107T1256 | InfernoPlatformBlockB | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [140d77bc](https://studio.tripo3d.ai/workspace/texture/140d77bc-4347-402c-b281-ebf402c9450b) | 20 | — |
| 20261107T1257 | InfernoStairs | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [f7587567](https://studio.tripo3d.ai/workspace/texture/f7587567-3149-46c1-92f8-b097b4dfc3e4) | 20 | — |
| 20261107T1259 | InfernoIngotPile | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [96c0bb80](https://studio.tripo3d.ai/workspace/texture/96c0bb80-22ac-497a-aaf0-f2f876197a10) | 20 | — |
| 20261107T1301 | InfernoTreasureHoard | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [eb046b01](https://studio.tripo3d.ai/workspace/texture/eb046b01-c7e9-4891-98ef-c7173d632492) | 20 | — |
| 20261107T1303 | InfernoCauldronRuin | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [c5645784](https://studio.tripo3d.ai/workspace/texture/c5645784-c99a-4570-9534-0060cab403c9) | 20 | — |
| 20261107T1304 | InfernoFurnaceTower | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [5b66a005](https://studio.tripo3d.ai/workspace/texture/5b66a005-b115-4e96-b61a-342d3721ff7e) | 20 | — |
| 20261107T1307 | InfernoForgeStall | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [51212c9d](https://studio.tripo3d.ai/workspace/texture/51212c9d-0dc1-4e5f-9cbc-72456337e504) | 20 | — |
| 20261107T1309 | InfernoHallWall | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [61f4e40b](https://studio.tripo3d.ai/workspace/texture/61f4e40b-c483-4f2d-9c34-112f3acdd8bc) | 20 | — |
| 20261107T1311 | InfernoHallButtress | 纹理生成（全量铺开，参考图 = 原件平光渲染简化） | [d13e0a33](https://studio.tripo3d.ai/workspace/texture/d13e0a33-0eb9-4867-9096-4a8d24bea511) | 20 | — |

这条线新账号合计：火坛 60 + 试点 60 + 魔将 110 + 全量铺开 41 × 20 = 820 → **1050**（软上限 6000 以内）。账号是几条线共用的，别的会话同时在花，所以表里 11-06 17:00 以后的余额不逐行写；11-07 全量铺开做完时最后一次看到的余额是 **29190**。

## 6. 和设计不一致 / 没做的

| 件 | 情况 | 地图路怎么办 |
|---|---|---|
| 熔铁闸门门框 | **11-04 已补** SM_Tripo_InfernoMoltenGateFrame。和登记不一样的两处：① GPT 概念图把门洞画窄了，原尺寸门洞 6.4–7.84 × 8.26，不是登记的 10 × 9；② Tripo 在两个柱脚之间多生成了一根离地约 1 m 的门槛横杆（概念里没有，会挡路），已在本地删掉这一个连通块再进管线（`_tripo_inbox` 里原件 20261104T133050 和去杆版 20261104T133251 都在，收据写了删了什么） | 门框按闸板尺寸非等比缩放（X = W / 8.35、Y = H / 8.8，第 3.1 节末），3-3 的 10 × 9 闸板 → X ×1.20、Y ×1.02；渡口关楼门洞仍挂 `SOCKET_Gate` 直接用闸板 |
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

## 7. 重出贴图（2026-11-06 起，Tripo 新账号）

第三章的 Tripo 件贴图太碎（[ch3-look.md](ch3-look.md) 第一节：满件小橙点、红漆块、刻花，法线按底色亮度算出来、满强度），3-1 火坛的白黄火苗烘在贴图里。
这一轮只换贴图：**网格、UV、尺寸、原点、挂点、碰撞、关卡摆放都不动**。

> **11-07 结论：这条路不再用来给第三章件换贴图**（7.4）。重出的底色偏紫、变糊，和用户 11-07 的反馈冲突；3 件试点退回 v001，铺开的 41 件不发布。只有火坛（7.2）保留。

### 7.1 做法

1. **上传件**：`python art/pipeline/retexture.py strip <ID>` → `art/source/_tmp/retexture/<ID>_upload.glb`（只有几何 + 原 UV，没有材质、不压缩）。
   Tripo 件取当前高模的 Tripo 原件（`02_highpoly/HP_*_source.glb`），其他来源（Hunyuan 的 3-1 旧件）取已发布的 GLB。
2. **Tripo Studio 左栏「纹理生成」→「上传 3D 模型」**：「找到最佳角度」对话框里打开 **「使用原始 UV」**，确认；面板里勾 **「去光处理」**、分辨率 4K，每次 20 积分。
   - 提示方式三选一：参考图 / 多视图 / 文字。**参考图最稳**：文字说「炭不是火」也会照形状画成火苗，还会自己改配色（火坛的铜鼎被涂成朱红）。
   - 参考图 = 我们自己渲染的现有模型，在图上先改好要改的地方（火坛：炭床涂暗）。
3. **导出 GLB 4k**（不花积分）：只带一张底色（4096² JPEG）；网格被归一化到高 1，还可能绕竖轴转 90°，**UV 不变**（火坛逐顶点核对：位置差 0.04 mm、UV 差 < 0.0002）。所以只取底色，几何一律用我们自己的。
4. **入库**：
   - Tripo 件：`retexture.py hp <ID> --file <导出> --task <链接>` → `_tripo_inbox/<UTC>_<ID>_retex.glb`（Tripo 原件 + 新底色）+ 回执 → `tripo_assets.py import` → `assetctl build / validate / review / approve / publish`。build 按新底色重算法线（底色亮度派生）、自发光遮罩（`emissive_key`）和 AO，对齐结果和原来一样。
   - 非 Tripo 件（高模不在本机，build 重跑不了）：`retexture.py build <ID> --file <导出> --task <链接> [--bc <处理过的底色>] [--e <自发光>]` → 新 build 版本（发布件换 BC / E，法线、ORM 照旧）→ `assetctl validate / review / approve / publish`。
   - 两条路都先核对导出和上传件的 UV 是否逐顶点对得上，对不上就拒绝（上传时忘了开「使用原始 UV」就会这样）。
5. `unity_export.py <ID>` → `bridge.sh sync` → 重建用到它的关卡。

### 7.2 3-1 火坛 SM_Tripo_InfernoFireAltar（build v002）

- 原来：Hunyuan 2mv 网格 + 概念投影贴图，盆顶尖锥形的「火苗」是网格的一部分，贴图里涂成白黄色、自发光遮罩是一片白，比怪还亮。
- 现在：盆里那一堆（盆口以上、盆内）是暗紫黑的炭，只有极少几处暗红余烬（自发光覆盖 0.05%，基本不发光）；铜鼎回纹、朱漆日纹板、四角铁链照原设计，平涂、去光。
  - Tripo 出图后，又按 3D 位置把炭床区域（y > 1.74 m 且离中轴 < 0.44 m，或 y > 1.99 m）在 UV 上压暗 50%。
  - 尖锥网格还在（改网格会动尺寸），现在读作一堆炭；火舌、光晕、点光全由 `EnvFlame.Altar` 运行时挂（焰心不到近白，第 3 节色彩脚本）。
- 挂点：registry 补 `FX_AltarFire` (0, 2.03, 0) ↑ = 炭床顶面中心 = `EnvFlame` 原来按包围盒算的火舌起点（2.356 × 0.86）。网格没变，原来的火焰位置照样对得上。
- 尺寸 1.134 × 2.356 × 1.151、底面中心原点、3000 / 1000 三角面、UV、法线、ORM 都和 v001 一样；校验 33 项通过。
- 老问题，没有恶化：基座朝 +Z 的那块面板在原 UV 上的岛只有另外三面的一半大，还有 18% 的纹素和别的面重叠（另外三面 4–5%）；旧贴图同一处就是灰糊，新贴图也一样偏灰。要根治得重展 UV。
- Tripo 任务 [3b1cc693](https://studio.tripo3d.ai/workspace/texture/3b1cc693-09b2-464a-a37e-13d8d6740b11)，前两次文字提示作废，第三次参考图采用，共 60 积分。

### 7.3 「贴图太碎」试点（RoundHallWall / BasaltColumns / RockRib，build v003）

- **挑件**：按各图截图的画面占比挑。圆殿墙段是 3-4 炉心殿外壳（8 段一圈，交战视角的整面背景）；玄武岩柱丛 3-1 七处、3-2 一处、3-4 四处；岩肋 3-1 三处、3-2 五处，16 m 高。
- **参考图**：原件平光渲染（Tripo 对话框里 Y 转 90° 后看到的正面）做简化（`scratchpad/t1/stylize.py`）：
  - 中值滤波去掉小橙点、砂浆细线、铆钉；
  - 石面 / 铁件转成冷暗紫、降饱和；铜和朱漆只降饱和；
  - 熔岩缝涂成平涂亮橙。
- **熔岩留在原位**：Tripo 会自己挪熔岩。第一版岩肋的底部裂缝几乎没了，朱漆日纹反而被抠成了自发光。
  - 所以 `retexture.py hp` 默认按旧贴图把 `emissive_key` 抠得出的纹素原样放回（UV 一样）；
  - 新贴图里其他会被抠进去的亮橙红压暗到阈值以下；
  - 自发光覆盖和 v001 持平：圆殿墙 1.23 → 1.22%、柱丛 5.23 → 5.15%、岩肋 1.29 → 1.25%。
- **网格**：尺寸、朝向、对齐 IoU 和 v001 完全一样。
- **对比**：[review/ch3-v2/retexture/](review/ch3-v2/retexture/)，见那里的 README。
  - 单件转台用的是近似游戏里的材质压法；
  - 关卡里中距离的同机位对比要等 Unity 侧导入以后补。
- **11-07 已退回 v001**（7.4）：三件都重新发布 build v001，发布件和 v001 导出逐字节一致。

### 7.4 全量铺开（41 件）与否决（11-07）

- **做了什么**：ch3-kit 件表里除火坛和 3 件试点以外的 41 件全部走完 7.1。
  - Tripo 件 23 件走 `retexture.py hp`，Hunyuan 旧件 18 件走 `retexture.py build`，后者自发光遮罩不动，发光处放回旧底色。
  - 41 次纹理生成共 820 积分，任务链接见第 5 节；build / validate / review 全部通过，0 错误。
  - ForgeStall 在 Tripo 对话框里转 Y 90° 没生效，参考图改用侧面渲染。
- **为什么不发布**：用户 11-07 对第三章模型的反馈是「泛紫色、灰色」「贴图模糊」。紫色只留给光照，固有色回到暖灰石、铜、朱漆，见 [ch3-look.md](ch3-look.md) 第二、三节。拿 `texture_clean.py` 的紫色偏指标和锐度（底色 2048² 的拉普拉斯均值）量了发布件 → 新 build：
  - **紫色偏**：发布件 38 件在 0.00–0.07，WorkShed 0.19，SpiralLedge / GeyserVent 0.42。新 build 里 38 件到了 0.48–0.98。
    只有金色的 TreasureHoard 0.01、铜色的 Spout 0.22 / QilinCauldron 0.33 没怎么紫。
    原因是参考图做简化时，把石面和铁件转成了冷暗紫。Tripo 的去光处理只去明暗、不去色相，就把紫色当固有色烘进了底色。
  - **锐度**：中位数降到原来的 53%（27–76%）。例如 FurnaceTower 5.0 → 1.4，Zhurong 5.2 → 1.4，PortalShrine 3.9 → 1.1，Gatehouse 3.7 → 2.3。
    Tripo 重出的贴图本身比原始生成的糊；中值滤波过的参考图又把这种糊放大了。糊修不回来。
  - 试点 3 件一样：圆殿墙段紫色偏 0.15 → 0.62、锐度 5.3 → 3.3；柱丛 0.00 → 0.86；岩肋 0.21 → 0.84、锐度 2.8 → 1.7。
  - 火坛紫色偏只有 0.10。它的目的是去掉烘进去的白黄火苗，不是降细节，所以保留 v002。
- **处置**：
  - 41 件的新 build 不 approve、不 publish，review 记成 rejected。build 记录里加了 `rejected`（时间 + 原因），各阶段的 current 指回已发布的那一版，`assetctl publish` 不会误发。
  - 3 件试点的 build v002 / v003 一样标 rejected，current 指回 v001 后重新发布（publish v003 = build v001）。
  - 退回前后的底色对比在 [review/ch3-v2/retexture/revert/](review/ch3-v2/retexture/revert/)，左边是试点、右边是 v001，下面一排是原尺寸裁切。
  - 41 件的转台对比在 [review/ch3-v2/retexture/rollout/](review/ch3-v2/retexture/rollout/)：`overview_1..3.jpg` 每件一行，上改前、下改后；底色指标在 `bc_metrics.json`。
  - asset.json 和 03_work / 05_review 的 JSON 记录入库（积分、任务链接都在里面）。GLB 按 `.gitignore` 留在本机，以后要回看可以直接用。
- **之后**：第三章件的固有色问题由另一条线用 `texture_clean.py` 在 v001 原始贴图上只调色解决：去紫、补斑、提固有色，不做任何平滑。
  3-4 收尾对炉口的处理只动自发光遮罩 T_*_E 和材质 / 光照参数，不重画底色，两边不会互相覆盖（[ch3-look.md](ch3-look.md)）。

### 7.5 3-4 美术收尾（11-07，接 M34 的复查）

M34 的 3-4 复查（[review/ch3-v2/3-4/composition-check.md](review/ch3-v2/3-4/composition-check.md)）留下三件材质层面的事，加上构建器里写死的视觉参数。全部在原贴图上做，不走 Tripo、不做任何滤波：

- **构建器里写死的参数收进 `LevelKit.InfernoLook`**（[ch3-look.md](ch3-look.md) 第三节表格末三行）：
  - 主光：`Ch3RaiseSun(theme, InfernoLight.CraterSunPitch)`。只抬仰角到 55°，颜色、强度、方位照 `ShowcaseTheme.Inferno`，方位还是 30°，结果和原来一样。
  - 落灰：`InfernoLight.AshWindCrater` = 0.15。
  - 熔岩渠材质：`Ch3LavaChannel(Dir)`，岸壳 `InfernoLight.ChannelShoreWidth` = 0.3 m，资产仍是 `M_Lava_Channel.mat`。
  - 点光：`InfernoGlows` 七档 + `Ch3PointLight`，Level_3_4 / Level_3_4.Shrine 两处都改用它们。
- **圆殿两段炉口墙段的炉膛**：平涂亮黄，去色后比吊鼎还亮。处理方式是 `InfernoGlowTrim` 把这件的自发光再收到 ×0.3、染回熔岩橙；殿内两盏炉口点光 10 m / 3 → 10 m / 2。底色和 `T_*_E` 都不动。
- **② 闸楼（SM_Tripo_InfernoFurnaceTower）炉口白热**：自发光遮罩是一片近白。同样 `InfernoGlowTrim` ×0.32、染橙；闸楼点光 16 m / 3.5 → 16 m / 2.5。这件也是展示广场的角楼，那边一起变暗。
- **弧墙饰带（SM_Tripo_InfernoRoundHallWall build v004）**：v001 原贴图上，只对高度带 0.145–0.315（朱漆铜日纹饰带，两面）做纯颜色映射：
  - 彩度 ×0.4，亮度向带内均值收 ×0.42，色相不变，所以不会往紫偏；
  - 熔岩色键命中的纹素不动，其余纹素和 v001 逐像素一致；
  - 工具 `art/pipeline/tools/frieze_recolor.py`，回执在 `_tripo_inbox/20261107T142047_*_frieze.json`。
  - 它取**当前**高模的 Tripo 原件，回执不写回溯字段，所以和 `texture_clean.py` 谁先谁后都能叠：后跑的那个在前一个的结果上改。注意 texture_clean 的「提固有色」会把饰带的彩度拉回一些，洗完再跑一次本工具就行。

