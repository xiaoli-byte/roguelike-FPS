# 第一章地图专用件（ART3 + ART4）

2026-10-20 完成 [unity-parity.md](../unity-parity.md) 第 5 节的 ART3、ART4。设计依据是 [unity-maps-v1.md](../level-design/unity-maps-v1.md) 第 1、5 节。

清单里每一件都有 Unity Prefab（`unity/Assets/Art/Props/<ID>/`），并且通过了 ArtValidator（`bridge.sh sync`）。摆放不在这里做，由地图单元 M11–M14 负责：`LevelKit.PlaceOrBox` 按下表的 ID 找 Prefab。

## 1. 生产路线

1. 登记：`art/pipeline/registry.toml` 的「第一章地图件 A / B」两节，`style_theme = "silkroad"`。
2. 概念：本机 Codex 出四视图（`tripo_assets.py concept`）。
   - PATH 上的 codex-cli 0.146 只能用 gpt-5.6-sol，当天这个模型一直返回 429。
   - 改用 Codex 桌面版自带的 codex-cli 0.160（`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`），它能跑 pipeline.toml 里配置的 gpt-6.1-sol。
   - 两路并行，每张约 1 分钟，共 26 张，不花 API 额度。
3. 审核：用户 2026-10-19 授权免审，由 Claude 看图审核，审核人记为 `Claude AI visual review`。
   - 背视图没有镜像的（驿站残墙）、侧视图左右颠倒的，用重注册修正（翻转对应视图），不重新出图。
4. Tripo Studio：智能网格、多视图（前 / 左侧 / 右侧 / 后 = 管线的 front / left / right / back）、P2.0、三角面，再做纹理生成，导出 GLB 4k。
   - 面数：地标和大建筑 8000，重复件 6000，小件 3000，散布件 1500。
   - 上传的是从概念原图抠出的四个人物，统一比例，居中放在 1024² 透明图上。比管线配准后的 512×1024 小图清楚。
5. 入库：下载文件归档到 `art/source/_tripo_inbox/<UTC>_<ID>.glb`，附 JSON 回执（任务链接、sha256、设置、积分），再执行 `tripo_assets.py import`。
6. 之后依次 `assetctl build / validate / review / approve / publish` → `unity_export.py` → `bridge.sh sync`。

## 2. 资产表

尺寸是发布后的实际包围盒（宽 × 高 × 深，米，正面朝 +Z）。

| ID | 用途 | 规格档 | 尺寸 W×H×D | LOD 三角面 | 建议摆放 |
|---|---|---|---|---|---|
| **1-1 收尾** | | | | | |
| SM_Tripo_DesertPosthouseWall | 驿站残墙（院墙一段，带木窗，断口阶梯） | tripo_architecture | 4.87 × 3.2 × 0.99 | 3957 / 2486 / 796 | 两端平切可连排；矮墙段按高度缩放 |
| SM_Tripo_DesertBeaconParapet | 烽燧台垛墙（两垛一口，垛口 0.6 m 可蹲射） | tripo_prop | 1.89 × 1.1 × 0.38 | 2984 / 994 | 白盒是 3.5 m 一段，这里每段 1.9 m，沿台边连排 |
| SM_Tripo_DesertBrushwoodPile | 烽燧积薪 | tripo_prop | 1.2 × 1.3 × 1.19 | 2837 / 994 | 白盒 2.2 m 见方，可放大 1.5–1.8 倍 |
| SM_Tripo_DesertHanWallCorner | 汉长城转角（派生件，见第 3 节） | tripo_architecture_kit | 4.69 × 3.5 × 4.69 | 5652 / 2486 / 796 | 中线交点在原点，臂 A 沿 +X、臂 B 沿 −Z，各长 4 m，端面与直段对接 |
| SM_Tripo_DesertCamelthorn | 骆驼刺散布件 | tripo_scatter | 约 1.1 × 0.7 × 1.0 | 1194 / 596 | 随机偏航 + 0.8–1.3 倍缩放，GPU instancing |
| SM_Tripo_DesertGravelScatter | 黑戈壁砾石散布件 | tripo_scatter | 1.05 × 0.45 × 1.04 | 1194 / 398 | 同上；砾石滩可放大到 1.5 倍 |
| SM_Decal_DesertCartRuts | 古道车辙贴花（程序绘制） | ground_decal | 2.4 × 0 × 8 | 128 / 4 | 离地 2 cm，沿 Z 平铺（贴图 Z 向循环），沿古道样条首尾相接 |
| SM_Tripo_DesertSeatedColossus | 敦煌坐像（1-1 远景地标；1-3 寺院前庭巨像） | tripo_architecture | 11.97 × 20 × 9.76 | 7960 / 2486 / 795 | 远景可放大 1.5–2 倍；1-3 放在 4 m 底座上 |
| **1-2 雅丹迷城** | | | | | |
| SM_Tripo_DesertStupaBuried | 半埋佛塔（塔尖广场地标） | tripo_architecture | 9.45 × 11 × 8.88 | 7127 / 2487 / 796 | 环台实测在 3.0 m 和 6.0 m，正面有两段台阶。下沉 0.5 m 后是 2.5 / 5.5 m，塔顶 10.5 m |
| SM_Tripo_DesertYardangSphinx | 狮身雅丹 | tripo_architecture | 9.57 × 13 × 17.48 | 7960 / 2487 / 795 | 头部在正面（+Z）；要接近设计的 26 m 长，可沿 Z 拉伸 1.3–1.5 倍 |
| SM_Tripo_DesertRockArch | 岩拱（出口） | tripo_architecture | 15.68 × 13 × 6.61 | 7960 / 2486 / 796 | 拱洞前后通透，路线沿 Z 穿过；拱顶平台约 12 m |
| SM_Tripo_DesertBuriedRoofHall | 半埋屋顶·殿堂歇山顶 | tripo_architecture | 6.48 × 5.5 × 3.7 | 5777 / 2486 / 1487 | 墙体直落到底，下沉到窗台。屋顶层要 3–4 m 高时放大 1.5 倍、下沉 2–3 m |
| SM_Tripo_DesertBuriedRoofHouse | 半埋屋顶·民居两坡顶 | tripo_architecture | 4.76 × 4.5 × 3.16 | 5747 / 2486 / 795 | 左山墙有门洞上半；建议放大 1.4 倍 |
| SM_Tripo_DesertBuriedRoofFlat | 半埋屋顶·平顶土坯房 | tripo_architecture | 3.56 × 3.6 × 3.87 | 5506 / 2486 / 796 | 屋面实测 2.0 m，屋顶小间 3.5 m。放大 1.8 倍后屋面 3.6 m，是屋脊之海的落脚平台 |
| SM_Tripo_DesertFinial | 塔刹（屋脊之海掩体） | tripo_prop | 2.53 × 5.5 × 2.28 | 2985 / 995 | 可半埋 1–2 m |
| SM_Tripo_DesertYardangSmall | 雅丹岩丘·小（4 m） | tripo_architecture | 3.76 × 4 × 5.74 | 6424 / 2487 / 796 | 头部在 +Z。Tripo 做短了，要接近设计可沿 Z 拉伸 1.5 倍；背面沙坡没生成，用地形沙坡接上顶面 |
| SM_Tripo_DesertYardangMedium | 雅丹岩丘·中（9 m） | tripo_architecture | 6.21 × 9 × 14.01 | 7887 / 2486 / 796 | 头部在 +Z，尾部一级台阶 |
| （已有）SM_Tripo_DesertYardangFleet | 雅丹岩丘·舰形（20 m） | tripo_architecture | — | — | 2026-10-17 已发布，三档里的大档 |
| **1-3 沉沙古城** | | | | | |
| SM_Tripo_DesertShopHouse | 二层店铺楼 | tripo_architecture | 6.32 × 8 × 3.09 | 6746 / 2486 / 1191 | 一层敞开店面，二层前廊敞开、背面有大门洞可穿行，二层地面约 3 m。进深只有 3.1 m，建议放大 1.3 倍 |
| SM_Tripo_DesertWell | 集市井台 | tripo_prop | 2.82 × 3.4 × 2.48 | 2855 / 995 | 台面实测 0.5 m；要做到设计的 1 m 井台，放大 1.5–2 倍 |
| SM_Tripo_DesertTemplePagoda | 寺塔（前庭地标） | tripo_architecture | 9.93 × 22.16 × 10.08 | 5981 / 2487 / 795 | 只有正面有门 |
| SM_Tripo_DesertCloister | 寺院回廊·二层（一跨） | tripo_architecture | 6.17 × 7.5 × 2.85 | 5025 / 2487 / 795 | 前敞后实，二层地面约 3 m；两端平切，沿 X 每 6.17 m 连排 |
| SM_Prop_DesertIncenseBurner | 寺院香炉 | tripo_prop | 1.33 × 2.6 × 1.16 | 2984 / 995 | 可放大 1.3 倍 |
| SM_Prop_DesertStele | 龟趺碑 | tripo_prop | 1.68 × 3.8 × 2.14 | 2984 / 995 | 碑面空白，龟首朝 +Z |
| **1-4 干涸月牙泉** | | | | | |
| SM_Tripo_DesertCrescentPavilion | 月牙阁 | tripo_architecture | 8.53 × 11 × 7.63 | 6756 / 2486 / 794 | 一层敞廊可遮阳；二层台实测 5.0 m，放大 1.2 倍到设计的 6 m；外楼梯在右侧（−X）；前半屋顶塌了，台面前半露天 |
| SM_Env_DesertCaveCeilingRift | 穴顶裂缝岩体 | tripo_architecture | 20.09 × 9 × 9.04 | 7960 / 2487 / 795 | 正面（+Z）是裂缝口的悬挑边。两块相向放、留 3–5 m 缝，就拼出日光裂缝；底面是下垂的岩块 |
| SM_Decal_DesertCrackedBed | 龟裂泉床贴花（程序绘制） | ground_decal | 8 × 0 × 8 | 128 / 4 | 外轮廓沿裂缝，随机旋转铺满月牙形泉床，彼此可重叠 |

另外：
- 每个 ID 在 registry 的 `blockout.id` 是 `desert.silkroad.<名>`，Prefab 上的 `ArtAssetInfo.bind` 也是它。
- 关卡里要非均匀缩放的件（雅丹沿 Z 拉伸、垛墙沿 X），碰撞体是最低一级 LOD 的 MeshCollider，会跟着一起缩放。

## 3. 不走 Tripo 的三件

- **SM_Tripo_DesertHanWallCorner**：`art/pipeline/derive_wall_corner.py` + `blender/bl_wall_corner.py`。
  - Tripo 概念把 L 形背面画成了外凸角，夯土层画法也和已发布的直段不一致，所以没送 Tripo。
  - 做法：从已发布的 SM_Tripo_DesertHanWall 截一臂，按 45° 斜接面切开，另一臂是它沿斜接面的镜像。两臂切口顶点完全重合，焊在一起，没有封口面，也没有接缝。夯土层和贴图都与直段相同。
  - 以派生件写进 manifest（`generator.tool = "derived"`）。直段重新发布后要重跑。
- **SM_Decal_DesertCartRuts / SM_Decal_DesertCrackedBed**：`art/pipeline/build_ground_decals.py`。
  - BC / N / ORM 都用 numpy 程序绘制：车辙是两道 1.6 m 轨距的凹槽，带沙埂和被沙填平的段落；泉床是两级 Voronoi 裂缝的上翘泥片，外轮廓按整片泥片取舍。
  - GLB 直接写出，材质 alphaMode MASK（StylizedLit 镂空），两级 LOD。
  - 只有一级 LOD 时，FBX 的单个网格会被 Unity 折叠到 Prefab 根上，LODGroup 和校验就找不到 `_LOD0`。所以 LOD1 是去掉细分的 1×2 面片，30 m 外切换。
  - 规格档 `ground_decal`，见 `pipeline.toml`。

## 4. 积分

Tripo Studio 计价：智能网格 100，纹理生成 30，导出免费。

| 项 | 次数 | 积分 |
|---|---|---|
| 智能网格 | 23 件 + 骆驼刺重做 1 次 | 2400 |
| 纹理生成 | 24 | 720 |
| 合计 | | **3120** |

- 账号余额：开工时 10215，结束时约 6835。这个账号同时也在给旱魃（ART1）出模，所以两个数之差不全是这里花的。
- 各件的任务链接和设置在 `_tripo_inbox/*.json` 回执里，也写在 `asset.json` 的 highpoly 记录里。
- Codex 概念图走 ChatGPT 账号，不花 API 额度。共 26 张：24 件各一张，长城转角一张（被否决），中雅丹 v005 一张。

## 5. 审核中的修正

| 资产 | 问题 | 处理 |
|---|---|---|
| PosthouseWall | 概念背视图没镜像（窗户还在左边） | 重注册 v002，背视图水平翻转后再送 Tripo |
| HanWallCorner | 概念背视图画成外凸角 | 否决概念，改为从直段派生 |
| Camelthorn | v001 网格的叶团是一片薄墙，侧面只剩一条 | 正视图复制到四个方向（背面镜像）作 v002 概念，重新生成，四个方向都圆了 |
| ShopHouse | 左视图上传失败，按三视图生成；800 面的 LOD2 色差 7.8% | 网格合理，保留；LOD2 放到 1200 面 |
| BuriedRoofHall | 重展 UV 烘焙在这件上不稳定，LOD1 拉伸 49%、色差 20% | 两级远景 LOD 都沿用供应方 UV（`lod_rebake_stretch = 0.10`），LOD2 放到 1500 面 |
| Camelthorn LOD1 | 400 面重烘到 256² 后色差 9% | LOD1 放到 600 面 |
| YardangMedium | v001–v004 概念（10-17）都被否决、曾经砍掉 | 换成船底 / 鲸背形的描述重画，v005 通过 |
| YardangSmall | Tripo 做短了，背面沙坡没生成 | 保留，关卡里拉伸，用地形补沙坡 |

## 6. 还是白盒 / 没做的

- **ART3 / ART4 清单内：没有剩余**，每一件都有 Prefab。
- **摆放没做**：M11–M14 的关卡代码和场景都没动，现在各图仍用白盒。换成正式件需要关卡单元改 `PlaceOrBox` 的 ID，并按第 2 节的建议缩放。
- **清单外**：
  - unity-maps-v1 第 5 节的「莫高窟式崖壁石窟立面」不在 ART3 范围内，没做。
  - 雅丹场大面积的岩墙按设计由地形高度场生成，不建模。
- 1-3 的「坐姿沙王巨像」直接用 SM_Tripo_DesertSeatedColossus。旧的胡狼头 SM_Tripo_DesertColossus（V2）题材不对，应退役（W0-9 的 status 字段落地后标 retired）。
