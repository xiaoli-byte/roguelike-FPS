# 第三章地图件（ART6 + 第三章 v2 新增件）

2026-11-03 恢复。上位设计 [ch3-v2.md](../level-design/ch3-v2.md) 第 6 节；美术路 A3 负责。
（2026-10-22 用户曾说「暂时不做第三章的新模型」，11-02 解除，11-03 第三章 v2 重做按第 6 节恢复 Tripo。）

## 0. 件表与状态

登记在 `art/pipeline/registry.toml` 的「第三章地图件（ART6）」和「第三章 v2 地图件」两节，`style_theme = "zhurong"`。
尺寸 = 登记的参考包围盒（宽 X × 高 Y × 深 Z，米，正面朝 +Z）。到货前地图路用 `LevelKit.PlaceOrBox` 按这个尺寸放白盒；
到货后的实测尺寸、承重件顶面高度、建议摆放缩放见第 2 节。

| ID | 名称 | 登记尺寸 | 面数档 | 状态 |
|---|---|---|---|---|
| **ART6（保留 11 + 修改 1）** | | | | |
| SM_Tripo_InfernoCausewaySegment | 玄武岩堤道段 | 12 × 5 × 12 | 1.5 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoCausewayPier | 八角堤墩 | 20 × 6 × 20 | — | **弃用**（ch3-v2 第 6.1 节），不建模 |
| SM_Tripo_InfernoSpiralLedge | 螺旋岩台沿 | 14 × 7 × 8 | 1.5 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoRockRib | 岩肋 | 9 × 16 × 12 | 1.5 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoCastingMould | 铸范 | 3.2 × 2.8 × 2.2 | 0.8 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoCastingBed | 铸床 | 8 × 1.4 × 5 | 0.8 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoBellows | 巨型风箱 | 18 × 5 × 8 | 3 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoHangingForge | 悬炉锻台（**改：26 m 可走甲板**，承重） | 26 × 8 × 26 | 3 万 | 重出概念 |
| SM_Prop_QilinCauldron | 火麒麟吊鼎（兼 3-1 镇湖鼎） | 6.4 × 8 × 6.4 | 3 万 | 概念已过审，待 Tripo |
| SM_Prop_QilinChainLock | 火麒麟锁扣 | 2 × 2.4 × 1.2 | 0.8 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoMoltenGate | 熔铁闸门 | 10 × 9 × 1.4 | 1.5 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoRoundHallWall | 圆殿墙段 | 18 × 22 × 5 | 1.5 万 | 概念已过审，待 Tripo |
| SM_Tripo_InfernoRoundHallFurnace | 圆殿炉口墙段 | 18 × 22 × 5 | 3 万 | 概念已过审，待 Tripo |
| **v2 新增 · 必须的最小集** | | | | |
| SM_Tripo_InfernoGatehouse | 渡口关楼（承重：城台 +8） | 16 × 12 × 14 | 3 万 | 出概念 |
| SM_Tripo_InfernoBasaltColumns | 玄武岩柱丛（矮柱 3 / 4.5 m 可站） | 8 × 9 × 7 | 1.5 万 | 出概念 |
| SM_Tripo_InfernoScaffold | 井壁栈架（承重：+4.5 / +9） | 12 × 10 × 8 | 1.5 万 | 出概念 |
| SM_Tripo_InfernoIronBridge | 铁桥（承重：桥面 +0.8） | 12 × 2.5 × 10 | 1.5 万 | 出概念 |
| SM_Tripo_InfernoHallTruss | 殿顶屋架 | 24 × 9 × 8 | 1.5 万 | 出概念 |
| SM_Tripo_InfernoLadleCrane | 浇包吊车（承重：走道 +12） | 18 × 16 × 8 | 3 万 | 出概念 |
| **v2 新增 · 锦上添花** | | | | |
| SM_Tripo_InfernoKilnMouth | 炉窟门脸 | 16 × 12 × 5 | 3 万 | 出概念 |
| SM_Tripo_InfernoSpout | 兽首熔流口 | 5 × 4 × 6 | 1 万 | 出概念 |
| SM_Tripo_InfernoGuardianStatue | 神道铜人（基座 2.6 m，头顶平） | 3.5 × 7.5 × 3.5 | 1.5 万 | 出概念 |
| SM_Tripo_InfernoCausewayBreak | 断堤端头（左端接堤道段） | 12 × 5 × 12 | 1.5 万 | 出概念 |
| SM_Tripo_InfernoGeyserVent | 熔泉喷口 | 6 × 2.5 × 6 | 0.8 万 | 出概念 |
| SM_Tripo_InfernoWorkShed | 铸坊工棚 | 10 × 7 × 8 | 1.5 万 | 出概念 |

**巨链链环 SM_Prop_InfernoChainLink：已完成并发布。**
用 Blender 程序化建模（`art/pipeline/blender/bl_proc_chain.py`）。按 unity-parity.md 第 6 节「链条程序生成」，只出一个链环，链长和垂度由运行时决定。
长 1 m、宽 0.65 m、棍粗 0.16 m，两侧各有一圈铆钉箍。节距 0.68 m，沿 Y 叠放，每隔一节绕 Y 转 90°。悬炉吊链、吊鼎四链、链桥都用它。

## 1. 生产路线

1. 登记：见第 0 节。
2. 概念：ART6 的 11 件沿用 2026-10-21 已过审的概念图（锁扣右视图、圆殿炉口墙段两张侧视图当时已重注册修正）。
   悬炉锻台（改）和 12 件新增件重出四视图。2026-11-03 起 Codex 没有余额，改用 Tripo Studio 图片页（GPT Image 2.5），
   登记时 `generation.provider = tripo_studio`。
3. Tripo Studio：智能网格、多视图（前 / 左 / 右 / 后）、P2.0、三角面，面数按第 0 节的档；再做纹理生成，导出 GLB 4K。
   上传的是从概念原图抠出的四个单视图，居中放在 1024² 透明图上（[ch1-map-kit.md](ch1-map-kit.md) 第 1 节第 4 步）。
4. 入库：下载文件归档到 `art/source/_tripo_inbox/<UTC>_<ID>.glb` + JSON 回执，再 `tripo_assets.py import`
   → `assetctl build / validate / review / approve / publish` → `unity_export.py` → `bridge.sh sync`。

## 2. 资产表（到货后填）

尺寸是发布后的实际包围盒（宽 × 高 × 深，米，正面朝 +Z）。

| ID | 实测尺寸 W×H×D | LOD0 三角面 | 承重顶面高度 | 建议摆放 |
|---|---|---|---|---|

## 3. 积分记录

用户授权（2026-11-03）：「需要建模的你就自行使用tripo进行建模，我同意你使用我的积分，不必再询问我了」。余额低于 150 停止。
每件网格 100 + 纹理 30 = 130。

| 时间（UTC） | 件 | 项目 | Tripo 任务 | 积分 | 余额 |
|---|---|---|---|---|---|

## 4. 遗留

- 吊鼎的四个链挂点没有做成骨骼或空节点：静态件的导出管线不带挂点。挂点位置在建模后按网格实测，再写进这份文档，交给 BS4 的 `QilinCauldron.cs`。
