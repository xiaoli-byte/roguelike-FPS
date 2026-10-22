# 第二章地图件（ART5）

2026-10-22 完成 [unity-parity.md](../unity-parity.md) 第 5 节的 ART5。设计依据是 [unity-maps-v1.md](../level-design/unity-maps-v1.md) 第 2、5 节和 [plans-v2/frost.json](../level-design/plans-v2/frost.json)（2-1 冰瀑栈道、2-2 玉阶雪关的钟亭和挡土墙、2-3 瑶池冰湖的湖心亭、2-5 北冥冰台的冰窟）。

清单里每一件都有 Unity Prefab（`unity/Assets/Art/Props/<ID>/`），ArtValidator 通过。摆放不在这里做，由地图单元 M21–M24 负责。

## 0. 两个取舍

- **FrostTao 不做。** parity 表写的是「已登记但没导出」，实际这 16 件（寒山道观，第二章备选方案 B）只登记了概念，本机连概念图都没有。
  2026-10-10 用户定稿第二章用 A + C（昆仑 + 北冥），B 只作存档（[enemy-roster-v2.md](enemy-roster-v2.md) 第二章）。
  所以不花约 2000 积分去建一套不用的风格，登记原样保留。
- **栈道四件改用 Blender 程序化建模。** 栈道是要首尾精确拼接的模块件。Tripo 的概念四视图互相矛盾：栏杆在哪一侧各视图不一致，6 米宽的桥面被画成约 3 米。
  直段、转角、断口、木柱支撑四件因此用 `art/pipeline/blender/bl_proc_timber.py` 建模：倒角方木加 numpy 手绘图集，尺寸按拼接网格固定。
  外观照已批的概念图：深色旧木板、褪色朱漆栏杆、铜绿铜箍、雪帽、短冰棱。龛平台是山体凿出的岩龛，仍走 Tripo。

## 1. 生产路线

同第一章（[ch1-map-kit.md](ch1-map-kit.md) 第 1 节）：

1. 登记：registry「第二章地图件（ART5）」一节。昆仑件用 `style_theme = "kunlun"`，冰窟边缘用 `beiming`。
2. 概念：本机 Codex 出四视图。概念图都按推荐版本直接通过。
   - 冰瀑上段、白玉挡土墙的两张侧视图左右画反，冰瀑下段的右视图朝向画错，都用重注册修正。
   - 冰桥第一版的侧视图把 8 米桥宽画成约 3 米。加强「桥面宽 8 米」的措辞重出一次。
3. Tripo：智能网格 P2.0 + 纹理生成，导出 GLB 4k。面数：地标 8000，挡土墙 6000，冰棱、碎块、冰柱、冰窟边缘 3000。
4. 入库：`tripo_assets.py import` → `assetctl build / validate / review / approve / publish` → `unity_export.py` → `bridge.sh sync`。
5. 栈道四件：`python art/pipeline/proc_assets.py build <ID>`（registry `[assets.<ID>.proc] script = "bl_proc_timber.py"`）。之后照常 validate / review / approve / publish。

冰一律画成不透明的冰川蓝（Tripo 出不了透明）。半透明、折射交给 Unity 的冰着色器（L8）。

## 2. 资产表

尺寸是发布后的实际包围盒（宽 × 高 × 深，米，正面朝 +Z）。

Tripo 网格普遍比概念「瘦」。构建时按参考框等比对齐，取高度、宽度、进深里最紧的一个，所以不少件的宽度比登记的小。「建议摆放」一列给出关卡里怎么放大或拼接。

| ID | 用途 | 规格档 | 尺寸 W×H×D | LOD 三角面 | 建议摆放 |
|---|---|---|---|---|---|
| **冰瀑（2-1 地标，主体约 40 m，三段叠放）** | | | | | |
| SM_Tripo_FrostIcefallTop | 冰瀑上段：瀑顶岩唇 + 冰帘 | tripo_architecture | 13.02 × 12 × 4.24 | 7963 / 2487 / 796 | 背面是平的岩面，贴崖放；X 放大 1.2 倍与中段同宽 |
| SM_Tripo_FrostIcefallMid | 冰瀑中段：冰柱帘 | tripo_architecture | 15.87 × 16 × 5.17 | 7959 / 2486 / 795 | 上下两端是平切口，叠在下段顶上 |
| SM_Tripo_FrostIcefallBase | 冰瀑下段：瀑脚冰锥 + 冰潭台 | tripo_architecture | 16.17 × 12 × 10.74 | 7959 / 2486 / 795 | 三段叠起来 40 m；冰体本身可整体放大 |
| **冰桥与冰** | | | | | |
| SM_Tripo_FrostIceBridge | 冰桥半跨，一端厚、一端薄切口 | tripo_architecture | 10.03 × 6.92 × 8.96 | 7960 / 2486 / 796 | 两件镜像（X 取反），在薄端对接。30 m 峡谷整体沿 X 放大 1.5 倍，桥面宽约 9 m |
| SM_Tripo_FrostIcicle | 冰棱（可射落） | tripo_prop | 2.02 × 4.54 × 1.63 | 2984 / 994 | 顶面平，挂在冰桥 / 崖檐下；射落后换成碎块 |
| SM_Tripo_FrostIcicleShards | 冰棱碎块（射落后的矮掩体，也用作冰柱碎后） | tripo_prop | 1.68 × 1.0 × 1.23 | 2408 / 995 | 当掩体时放大 1.6–1.8 倍 |
| SM_Tripo_FrostIcePillar | 冰柱（2-1 冰柱林，可破坏） | tripo_prop | 2.52 × 5.46 × 2.69 | 2984 / 994 | 随机偏航 + 0.8–1.2 倍 |
| **栈道（贴崖木栈道；Blender，见第 3 节）** | | | | | |
| SM_Tripo_FrostPlankRoadStraight | 直段 | proc_kit | 8 × 3.49 × 6.21 | 2732 / 504 | 沿 X 每 8 m 一段，首尾相接 |
| SM_Tripo_FrostPlankRoadCorner | 绕外凸崖角的 90° 转角 | proc_kit | 6.2 × 3.49 × 6.08 | 2922 / 552 | 见第 3 节的拼接网格 |
| SM_Tripo_FrostPlankRoadBroken | 断口（4 m 缺口两端各放一件，另一件镜像） | proc_kit | 5.0 × 3.49 × 6.2 | 2511 / 420 | 干净端在 x = −2.5，接直段 |
| SM_Tripo_FrostPlankRoadPost | 木柱支撑（排架） | proc_kit | 6.24 × 9 × 1.24 | 912 / 132 | 放在直段下方，排架的 X 对齐桥面宽度方向 |
| SM_Tripo_FrostPlankRoadNiche | 龛平台（凿进山体的岩龛，栈道上的三处平台） | tripo_architecture | 7.48 × 8 × 3.96 | 7673 / 2485 / 792 | 背面是平的岩面，嵌进崖壁；龛底高约 2.4 m，与栈道桥面同高 |
| **崖壁与第二章其他件** | | | | | |
| SM_Tripo_FrostCanyonCliff | 峡谷崖壁片（可拼接的绝壁，带冻结渗水冰瀑） | tripo_architecture | 14.17 × 19.74 × 7.84 | 7960 / 2487 / 795 | 左右是不规则岩垛，相邻片互相插进去；20–40 m 的谷壁整体放大 1–2 倍 |
| SM_Tripo_FrostJadeRetainingWall | 白玉挡土墙段（带栏板，2-2 台地北缘） | tripo_architecture | 7.02 × 6.5 × 2.26 | 5962 / 2487 / 796 | 每 7 m 一段连排；台地高差不同就按高度缩放 |
| SM_Tripo_FrostBellPavilion | 钟亭（2-2 东崖钟亭藏宝点） | tripo_architecture | 5.14 × 8.5 × 5.1 | 7646 / 2477 / 1480 | 台阶朝正面（+Z），藏宝点放在钟下 |
| SM_Tripo_FrostLakePavilion | 湖心亭（2-3 冰面上唯一的大掩体，左右两道台阶） | tripo_architecture | 8.42 × 11 × 8.12 | 6699 / 2487 / 1483 | 网格比设计高窄（设计 16 × 11 × 16）。按 1.4 倍放大（台基约 11.8 m），或者台基用白玉台基模块铺到 16 m、亭子放中间 |
| SM_Tripo_FrostIceHoleRim | 北冥冰窟边缘段（2-5 环台内缘） | tripo_prop | 3.79 × 2.2 × 2.76 | 2550 / 994 | 正面朝冰窟中心。半径 15 m 一圈 16 段，每段弦长 5.85 m，X 放大约 1.55 倍 |

## 3. 栈道套件的拼接网格（Blender 程序化）

脚本：`art/pipeline/blender/bl_proc_timber.py`。公共部分已抽到 `blender/bl_proc_common.py`（`Geo`、`Atlas`、`export_asset`），第一章的 `bl_proc_desert.py` 也改为调用它。重建骆驼刺，网格和贴图哈希逐字节一致。

坐标与原点（游戏 / glTF：+Z 是外沿，也就是栏杆一侧；−Z 是贴崖一侧；原点是桥面足迹中心，落在最低点）：

- **直段**：桥面 x ∈ [−4, 4]、z ∈ [−3, 3]，桥面顶 y = 2.4。悬臂梁插进崖里，在 x = −3、−1、1、3 处，每根带一根贴崖立柱和一根斜撑。栏杆柱每 2 m 一根，栏杆贯通全长，接缝处连续。
- **转角**：桥面 x ∈ [−3, 3]、z ∈ [−3, 3]。外沿（+Z）和 +X 边有栏杆，−X 边和 −Z 边敞开。从 −X 接直段；转过去的直段绕 Y 转 90°，栏杆朝 +X，接在 −Z 边。转角下面立四根角柱、四面剪刀撑，因为崖只碰到它背后的一个角。
- **断口**：干净端在 x = −2.5，接直段；+X 端是断开的。木板在 x ≈ 0.9–2.4 之间参差折断，两块垂下，栏杆垂挂，第三根悬臂梁断了一半。4 m 缺口的另一端放一件镜像（X 取反）。
- **木柱支撑**：排架宽 6 m（X）、高 9 m，顶梁平面在 y = 9。放在直段下方时，排架的 X 对齐直段的 Z（桥面宽度方向）。顶梁托住悬臂梁底，悬臂梁底在直段的 y = 1.92。
- LOD1 去掉倒角、铜箍、钉帽和冰棱。贴图是一张 1024² 图集：8 条木板（钉帽按各件的梁位画）、2 条方木、端面、漆、铜、雪、冰、石，ORM 里有逐像素的粗糙度和金属度。
- 校验豁免：「场景轴心居中」（原点是拼接点）、「LOD1 贴图色差」（小件去掉了）、「UV 利用率」（共用图集）。

审核图：`docs/art/review/frost-plank-road-{straight,corner,broken,post}-v001.jpg`。

## 4. 修过的问题

| 件 | 问题 | 处理 |
|---|---|---|
| 钟亭、湖心亭 | LOD2 贴图色差超限（7.7% / 6.0%） | `lod_tris = [8000, 2500, 1500]`、`lod_rebake_stretch = 0.10`（同第一章的半埋殿顶） |
| 峡谷崖壁片 | 等比对齐被进深卡住，高 19.74 m（登记 24 m） | 校验豁免「场景高度」。崖壁片在关卡里整体放大 |
| 冰桥 | 第一版概念把桥面画窄 | 重出概念；网格桥面宽 8.96 m |

## 5. 积分

Tripo 13 件，每件网格 100 + 贴图 30，共 **1690**。栈道四件用 Blender，不花积分。

同一批次里 ART7 用了 1300（10 件），账户余额 6835 → 3845。ART6 只出了概念图，没有花 Tripo 积分。

## 6. 还是白盒 / 没做的

- **摆放**：M21–M24 地图单元还没做，所有件都只是 Prefab。
- **冰的着色**：冰瀑、冰桥、冰棱、冰柱、冰窟边缘现在是不透明的手绘冰色。半透明冰着色器是 L8（`SF_Ice`），不在美术管线里。
- **可破坏逻辑**：冰棱射落和冰柱破碎只备了模型（冰棱、冰柱、碎块），断裂、掉落、伤害由玩法代码做。
- **冰瀑后的冰窟内部**：2-1 的藏宝洞没有专门的件，靠地形洞穴和现有北冥件拼。
- **FrostTao**：按用户定稿不做，见第 0 节。
