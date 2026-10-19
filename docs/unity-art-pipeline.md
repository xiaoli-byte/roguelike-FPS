# Unity 美术管线（第一阶段）

2026-10-16 起游戏迁到 Unity（6000.5.4f1 · URP 17.5），工程在仓库的 `unity/` 目录。第一阶段只做美术管线和第一章「赤沙古道」展示场景，玩法（TS → C#）之后再移植。

现有管线前半段不变：白模 → 概念 → Hunyuan / Tripo → Blender 游戏化 → 自动 QA → 人工审核 → 发布到 `public/assets/manifest.json`（见 [art/README.md](../art/README.md)）。Unity 分支从**已发布、已过审**的 GLB 出发，审核闸门仍在 assetctl 里。

```
public/assets/*.glb ──▶ unity_export.py ──▶ unity/Assets/Art/<类别>/<ID>/ ──▶ Spiritfire ▸ Art ▸ Sync All ──▶ Prefab + QA
 (manifest 条目)        Blender 无头           <ID>.fbx                      材质（风格化 Lit）
                        T-pose / FBX           Textures/*.png                Prefab（LODGroup / Animator / 碰撞体）
                        取贴图 / 写 sidecar     <ID>.art.json（契约）          Unity 侧自动 QA
```

## 1. 常用命令

```bash
# 1) 发布资产 → Unity（增量：源 GLB 校验和不变则跳过；--force 全部重导）
python art/pipeline/unity_export.py --set showcase
python art/pipeline/unity_export.py SK_Enemy_Fuzhu SM_Tripo_FrostColumn
python art/pipeline/unity_export.py --all

# 2) Unity：编辑器菜单 Spiritfire ▸ Art ▸ Sync All，或无头一条命令跑完 Sync → 建场景 → 截图
"S:/Unity Hub/Editor/6000.5.4f1/Editor/Unity.exe" -batchmode -projectPath unity \
  -executeMethod Spiritfire.Art.Editor.ReviewCapture.BatchAll -logFile unity/Logs/batch.log
```

本机 Blender 不在 `pipeline.toml` 的默认路径时，在 `art/pipeline/.env` 写 `ART_BLENDER=<blender.exe 路径>`。

**入库与新机器**：FBX 与贴图 PNG 是生成物，不入库（`unity/.gitignore`）；它们的 `.meta`、`*.art.json`、材质与 Prefab 入库，引用 GUID 因此稳定。新机器拉取后**先跑 `python art/pipeline/unity_export.py --all`，再用 Unity Hub 打开 `unity/` 目录**——先开 Unity 的话，它会把找不到资产的 `.meta` 当成孤立文件删掉，Prefab 与场景的引用就断了（此时 `git checkout -- unity/Assets` 恢复后按顺序重来）。Hub 里要添加的是 `unity` 子目录，不是仓库根目录。

## 2. 契约：`<ID>.art.json`

Unity 侧所有设置都从 sidecar 推导，编辑器里手改的导入设置、材质参数会在下次 Sync 时被覆盖。改风格改 `ArtPrefabBuilder.StylePreset`，改导入改 `ArtImportPostprocessor`。

| 字段 | 内容 |
|---|---|
| `id` `kind` `class` `category` `bind` | 与 manifest 条目一致；`bind` 写进 Prefab 的 `ArtAssetInfo`，玩法代码按它找美术资产 |
| `lodDistance` `budget` | LOD 切换距离（米）与规格档（每级面数、贴图边长），来自 `pipeline.toml` |
| `bounds` | 设计包围盒，已换成 Unity 坐标（X 取反）；Unity QA 用它查单位、朝向 |
| `rig.type` | `humanoid`（建 Humanoid Avatar，可用 Mixamo 动画）/ `generic`（部件骨架、Tripo 非人形）/ `none` |
| `rig.human` | Unity 人形骨骼名 → 资产骨骼名；支持 Tripo 语义命名（`arm_L`）与 Mixamo 命名（`LeftArm`） |
| `rig.tpose` | 导出时的 T-pose 修正量（上臂原下垂角度、旋转角） |
| `meshes` | 每个网格的 LOD 序号、面数、材质槽 |
| `materials` | glTF 材质因子、双面、透明模式、贴图角色（BC / N / ORM / E） |
| `source` | 源 GLB 路径、sha256、是否高清版本、生成器、许可 |

## 3. 关键约定

- **坐标**：导入后角色朝 +Z、Y 上、1 单位 = 1 米，与 Unity / Mixamo 惯例一致。glTF 是右手系，Unity 是左手系，所以 X 取反，角色左手在 Unity −X。
  FBX 的轴向参数只改文件里的坐标系声明，Unity（`bakeAxisConversion`）会按声明换算回来，所以换哪组参数，角色都朝 Unity −Z。为此导出前把 Blender 顶层物体绕 Z 转 180°，这个旋转只写在根节点上，不应用到网格和骨骼数据。Unity QA 的朝向检查（人形左手在 −X、脚尖朝 +Z；非人形检查包围盒中心）就是为这类问题设的。
- **人形 T-pose**：Tripo 重绑的骨架是 A-pose（上臂下垂 43–61°）。Unity Humanoid 以 T-pose 为肌肉空间的参考，所以导出时把上臂、前臂转到水平，应用到网格后设为新的绑定姿势。Unity QA 检查上臂与水平面的夹角不超过 8°。
- **贴图**：从 GLB 里原样取出（WebP 解码成 PNG，像素不变），有 `@hi` 版本时用 2048² 高清版。BC / E 是 sRGB，N 是法线，ORM 是线性。
- **材质**：全部用 `Spiritfire/StylizedLit`。名字带 `_Glow` 的材质走叠加混合、不投影（对应 Three.js 版的加法发光件）。
  Tripo 静态件重烘的远景 LOD 自带材质 `M_<名>_LOD<i>` 与 512² 等小贴图：sidecar 的 `materials` 里多一项，`meshes` 里该级 LOD 的材质槽指向它，Sync 照常按槽名分配，不需要特殊处理。
- **LOD**：FBX 里的 `<ID>_LOD<n>` 网格组成 LODGroup。切换距离按 70° 竖直视角换算成屏幕高度，开启交叉淡入淡出（着色器支持 `LOD_FADE_CROSSFADE`）。
- **碰撞**：角色用胶囊（玩法判定也基于胶囊）。场景件用最低一级 LOD 的 MeshCollider，并标为 Batching / Occluder / Occludee Static。

## 4. 风格化着色（`unity/Assets/Art/Shaders/SF_StylizedLit.shader`）

目标是《枪火重生》式的手绘读感：固有色由贴图负责，光照只负责体积。

- **主光软阶梯**：N·L 和投影一起经过 `smoothstep(_RampThreshold ± _RampSoftness)`，分成亮、暗两大块，投影边缘与明暗交界用的是同一种笔触。
- **冷暗部**：环境光取球谐，暗部额外叠加 `_ShadowTint × 主光 × _ShadowLift`。背光面偏冷而不发黑，配合场景的三色渐变环境光（天顶冷蓝、地平线暖沙、地面赭石）。
- **阶梯高光与环境反射**：只在低粗糙度、金属区域出现（ORM 的 G / B 通道）。
- **边缘光**：菲涅尔经阶梯处理成一道细边，受光侧更亮，用来勾剪影。
- **运行时参数**：`_FlashAmount`（受击闪白）、`_Tint`（词缀 / 精英着色）可以用 MaterialPropertyBlock 覆盖。闪白期间该渲染器会退出 SRP Batcher，结束后要清掉。
- **其余 Pass**：ShadowCaster / DepthOnly / DepthNormals 都写全了，支持 SSAO、Forward+（集群光照）、LOD 交叉淡入淡出和 SRP Batcher。

按类别的参数预设在 `ArtPrefabBuilder.StylePreset`：角色边缘光更强，枪械高光更亮，场景件暗部更暖、边缘光更弱。

### 4.1 毛发与羽毛（按画质）

带毛 / 羽的灵宠和怪物在 registry.toml 里登记一张 `[assets.<ID>.fur]`（集中写在文件末尾「毛发 / 羽毛」一节），经 `unity_export.py` 写进 sidecar 的 `fur`。按画质分三档（`Spiritfire.Art.ArtQuality`，与网页版设置里的「画质」同名同档）：

| 画质 | 效果 | 开销 |
|---|---|---|
| 低 | 不加毛发，和以前一样 | 0 |
| 中 | StylizedLit 的 `_FUR` 细节：顺毛向拉长的发丝笔触、沿毛向的各向异性光泽带、剪影处的绒边，明暗交界更软；再加轮廓发丝面片（fins，`Spiritfire/FurFin`），轮廓上竖起一圈柔边发丝 | 细节是每像素几次值噪声；fins 多一次蒙皮绘制，但只有轮廓附近的面片会光栅化，其余在顶点着色器里收成线 |
| 高 | 再给 LOD0 叠壳层（`FurShells` + `Spiritfire/FurShell`）：毛 16 层、羽 10 层，表面也有立体的发丝 | 每层多画一次已蒙皮的 LOD0，例如火浣鼠「高」档多约 9.5 万三角面；远了 LOD 切走就没有了 |

- **用在哪**（2026-10-19 定）：毛发不是越多越好。项目是《枪火重生》式的大块面风格，Tripo 模型上的毛本来就是雕出来的大毛簇；
  战斗里怪物多在 5–20 米外快速移动，到 LOD 切换距离毛发就没了，同屏数量一多开销却成倍涨。所以只用在看得见、加分的地方：
  - **灵宠（讙、狻猊、狰、白泽、应龙的鬃毛）**：一直跟在玩家身边、会被近看，给完整毛发（「中」fins、「高」再叠 16 层壳）。
  - **大白毛（獓狠、天狗、飞廉）**：`shells = 0`，「中」「高」都只有轮廓发丝面片 + 着色细节，不叠壳层；雷牦群复用獓狠模型时也不会成倍加开销。
  - **不加**：群怪（啸獭、火浣鼠、祸斗）、举父、穷奇，以及全部羽毛（精卫、重明、三青鸟、毕方、蛮蛮：雕出来的大片羽毛加了几乎没区别）。
- **毛向和遮罩是导入时自动烘的**（`FurBake`，在 `ArtImportPostprocessor.OnPostprocessModel` 里）：
  - 每个顶点的毛向是蒙皮权重加权的骨骼方向。躯干、颈、头这一组（hips / spine / chest / neck / head / body）反过来用，所以毛往后、往下顺；四肢、尾巴、耳朵、翅膀的毛顺到末端；再往下偏一点（重力）。
  - 遮罩是权重加权的每根骨骼毛长倍数（`bones`，可用通配符；0 = 不长毛，如爪、蹄、喙、铃铛），再乘上排除球（`exclude`，眼睛、鼻口）的软边。
  - 写进网格的有三组：UV2 存绑定姿势下的位置，发丝图案贴在皮肤上，动画时不游走；UV3 存毛向在切线和副切线上的分量和遮罩，切线随蒙皮转动，所以毛向跟着骨骼走；UV4 存绑定空间的毛向，发丝沿它拉长。
  - 排除球用 creature_rigs 的骨架坐标（front = -Y，左 = +X，up = +Z），导入时换算成模型空间 (-x, z, -y)。
  - Sync 日志里的 `[fur]` 一行记录每级 LOD 的遮罩均值、无毛顶点比例和头骨位置，用来核对坐标。
- **配置项**：
  - `kind`：fur 或 feather。
  - `length`：毛长，缺省是身高的 2%，羽毛是 1.2%。
  - `density`：发丝格的密度，缺省 1 / (0.5 × length)。毛越长，发丝越粗越稀，大怪不会被画成一层细绒。
  - `shells`：「高」档的壳层数（缺省毛 16 / 羽 10；0 = 只要轮廓发丝面片，「高」档也不叠壳层）。
  - `fins`：是否生成轮廓发丝面片（缺省 true）。
  - `comb` / `droop`：顺毛梳和重力下垂。
  - `stretch`：发丝沿毛向拉长的程度。
  - `facing`：正对镜头的面只留长发丝的程度。从正上方看，发丝是一颗颗点，像砂纸，所以把毛感集中到轮廓上。
  - `detail` / `sheen` / `fuzz`：「中」档的发丝笔触、光泽和绒边强度。
  - 改完以后：先 `python art/pipeline/unity_export.py <ID>`，再 Sync。sidecar 的 fur 变了会自动重新导入模型。
- **为什么这样做**（2026-10-19 调研后重做；第一版只有硬裁剪的 10 层壳，近看是一圈锯齿噪点，读不出发丝）：
  - Lengyel 等《Real-Time Fur over Arbitrary Surfaces》（I3D 2001）和 NVIDIA 的 shells + fins 白皮书：壳层约 16 层、层距约为模型尺寸的千分之一，层距太大会露出一层层台阶；壳层到了轮廓会变透、露缝，所以在网格边上竖垂直于表面的 fins，按 max(0, 2|p| − 1)（p = 面片法线 · 视线）只在轮廓附近淡入；发丝贴图是预滤波的半透明体，不是硬裁剪；光照用沿发丝方向 T 的 Kajiya-Kay 模型，内层按 Banks 的近似压暗。
  - 我们的取舍：PC 档开着 4× MSAA，所以发丝用 alpha-to-coverage（`AlphaToMask On`）而不是半透明混合：不用排序，边缘由解析的覆盖率（有符号距离 / fwidth）在一个像素内过渡，柔边不闪；发丝格在屏幕上不到两个像素时，覆盖率渐变成该高度的平均值（代替贴图的 mipmap），远处是一层绒而不是噪点。发丝截面只量切平面里的距离（法线由绑定位置的屏幕导数求出），每根粗细一致。
  - 资料：[Lengyel 2001](https://hhoppe.com/fur.pdf)、[NVIDIA Fur (Shells and Fins)](https://developer.download.nvidia.com/SDK/10.5/direct3d/Source/Fur/doc/FurShellsAndFins.pdf)、[Unity AlphaToMask](https://docs.unity3d.com/2021.3/Documentation/Manual/SL-AlphaToMask.html)、[hecomi/UnityFurURP](https://github.com/hecomi/UnityFurURP)（URP 的 shell / fin 实现参考）。
- **fins 的实现**（`FurBake.BuildFins`）：导入时取 LOD1 的边（按位置焊接后去重，遮罩均值 ≥ 0.12），每条边一片四边形，根在边上、梢由着色器沿法线推出，并且与壳层同样顺毛梳、下垂。四个顶点沿用边两端的蒙皮权重、切线和毛发数据，所以面片跟着骨骼动；面片法线存成在端点切线框架里的分量（UV2），着色器里用蒙皮后的切线还原。生成的网格是模型资产的子资产，挂在 `<ID>_FurFins` 上；Prefab 把它放进 LOD0 组，`FurShells.finRenderer` 按画质开关。
- **壳层的实现**：网格只有一个子网格时，多出来的材质槽会把同一个已蒙皮的网格再画一遍。所以骨骼动画、受击闪白（渲染器上的 MaterialPropertyBlock）和 LOD 交叉淡化都自动跟着，不需要几何着色器或自定义渲染通道。
  - 壳层材质按（模板，层数）缓存，同种角色的所有实例共用，SRP Batcher 照常合批。
  - 壳层只有 UniversalForward 通道：不投影，也不进深度和法线预通道。
- **切换画质**：`ArtQuality.Set(...)` 会存进 PlayerPrefs，并广播 `Changed`，FurShells 随之重新套用。没存过时按 Unity 画质档推断：Mobile → 低，其余 → 高。
  - 玩家入口：游戏里按 Esc 弹出暂停菜单（`PauseMenu`），「画面 · 画质」三档 低 / 中 / 高，点选即时生效并保存。Esc、「继续游戏」或点击面板外的空白处继续。
  - 样板场景里按 G 循环 低 → 中 → 高（`ShowcaseCamera`），左上角显示当前档。这个设置和游戏里的是同一项，也会保存。
  - Play 时「画质」同时切 Unity 渲染档（`GraphicsQuality`）：低 → Mobile（0.8 倍渲染分辨率、单级硬阴影、Forward、无 SSAO / MSAA），中 / 高 → PC。只换 QualitySettings 档位，不改 URP 资产；编辑器退出 Play 时还原进 Play 前的档。Mobile 档原本排除了 Standalone，现在 PC 上也能选，PC 的默认档仍是 PC。编辑器里第一次切到 Mobile 时，新的着色器变体是异步编译的，头几帧角色只画出影子。Fur Quality Shots 不进 Play，只对比毛发。
  - 冒烟测试 `PlaytestRunner.QualityMenuTest` 打开暂停菜单，依次点三档，核对 Unity 档、`_SFFurDetail` 和火浣鼠的壳层数，拍 `playtest_pause_quality_<low|medium|high>.png`。只跑这一组：在 `Library/SpiritfireBridge/playtest-focus.txt` 里写 `quality`，再跑 `bridge.sh playtest`。
- **帧耗时基准**：Spiritfire ▸ Art ▸ Fur Bench，或 `bash scripts/unity/bridge.sh furbench`。在样板场景里摆最坏情况（白泽 + 讙在身边、一群 6 头獓狠在 7–14 米），玩家眼高机位，1920×1080、4× MSAA，三档各测两轮取平均，写到 `Assets/Art/_Review/fur_bench.txt`。2026-10-19 实测：低 13.16 ms、中 13.27 ms（+0.11）、高 13.86 ms（+0.70）。开销很小，所以 PC 没存过设置时默认仍是「高」，Mobile 档默认「低」。
- **对比截图**：Spiritfire ▸ Art ▸ Fur Quality Shots，或 `bash scripts/unity/bridge.sh fur`。
  - 每个带毛的角色出一张 `Assets/Art/_Review/fur_<ID>.png`：低 / 中 / 高三档左右并排，上排全身、下排头胸。
  - `fur_summary.txt` 记壳层数和「高」档多画的三角面。

## 5. 人形动画：Mixamo

人形资产（跳鼠刀兵、邪飞天、英雄……）共用 `Assets/Art/Animations/AC_Humanoid.controller`。参数有 `Speed`（米/秒）、`Attack`、`Hit`（触发）和 `Dead`（布尔）。Locomotion 是 Idle / Walk / Run 的一维混合树，另有攻击、受击、死亡三个状态。

动画来自 [Mixamo](https://www.mixamo.com/)（需要 Adobe 账号，由作者本机下载）。下载设置：**FBX for Unity、Without Skin、30 fps、勾选 In Place**（有这个选项的动作）。文件名以状态名开头，放进 `unity/Assets/Art/Animations/Mixamo/`：

| 保存为 | Mixamo 里搜 | 说明 |
|---|---|---|
| `Idle.fbx` | Sword And Shield Idle（或 Fighting Idle） | 循环 |
| `Walk.fbx` | Sword And Shield Walk（或 Walking） | 循环，In Place |
| `Run.fbx` | Sword And Shield Run（或 Running） | 循环，In Place |
| `Attack_Slash.fbx` | Sword And Shield Slash（或 Standing Melee Attack Horizontal） | 单次 |
| `Hit.fbx` | Hit Reaction | 单次 |
| `Death.fbx` | Dying | 单次 |

放好后执行 Spiritfire ▸ Art ▸ Sync All，导入规则会自动设成 Humanoid、设好循环并锁定根运动，再重建状态机。缺哪个片段，对应状态就空着，Sync 会给出警告。Mixamo 的原始 FBX 不入库（见 `unity/.gitignore`），因为 Adobe 条款允许在作品里使用，但不允许单独再分发原始文件。

### 5.1 原生骨架敌人：从 Three.js 版采样的专属动作

Three.js 版里，27 个原生骨架敌人（第一章到第三章的新阵容）每只都有逐只设计的程序动画：状态机、阻尼参数、步态相位和 IK。GLB 里没有关键帧，所以不重写这些动画，而是在 Node 里跑真实的敌人代码，把动作逐帧录下来：

```bash
node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs              # 全部
node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs fuzhu qingniao
```

- **怎么跑游戏代码**：`scripts/unity/ts-hooks.mjs` 让 Node 直接 import `src/` 里的 TS（去掉类型、补全扩展名）。美术挂载换成桩：`stubs/EnemyArt.mjs` 按发布 GLB 的节点层级和 TRS 搭出同名骨架，交给真实的 `NativePose`，所以骨骼静止朝向与游戏里一致。特效、音效、伤害调用都是空操作。
- **场景脚本**：
  - **Idle**：关掉 AI，原地站立，自动找首尾最接近的一段做成无缝循环。
  - **Move**：玩家始终保持在 30 米外，取稳定移动的一段找循环点，并记下录制时的移动速度。
  - **Hit**：待机中触发一次受击抖动。
  - **招式**：玩家在 3、7、12 米处，AI 自然出招，每个状态取第一段完整的连续帧，并记下紧接着的状态（`next`），用来把起手、出招、收招串成连段。
- **数据**：每帧记录每根骨骼在模型空间的朝向和位置，写到 `<资产>/Anim/<资产>.native-anim.json`（可再生成，不入库）。
- **Unity 换算**（`NativeClipBuilder`，在 Sync 里执行）：
  - 取模型空间增量 D = q(t)·q_rest⁻¹，镜像到 Unity（X 取反，四元数为 (x, −y, −z, w)），再乘上 Unity 同名骨骼自己的绑定朝向。这样不受 Blender、FBX 改动骨骼局部轴向的影响。
  - 人形资产导出时摆成了 T-pose：按骨骼位置重算当时的最小转角修正，从绑定朝向里扣掉。人形片段再用 `HumanPoseHandler` 转成肌肉曲线，所以也能重定向；尾巴、飘带等非人形骨骼保留变换曲线。
  - 关键帧精简：只保留去掉后插值误差会超出容差的帧，体积约降到原来的 1/3。
- **状态机 `AC_<资产>`**：
  - Idle 与 Move 按 `Speed` 切换，Move 的播放速度由 `MoveScale` 控制。
  - 任意状态都能用触发器进入 `Hit`，或进入连段的第一招 `act_<状态>`；连段按 `next` 自动往下接，最后回到 Idle。
  - 有采样片段的资产优先用它，比 Mixamo 优先；英雄和其他人形资产用 `AC_Humanoid`。
- **动作审核图**：Spiritfire ▸ Art ▸ Anim Review Sheets，每个角色一张，行是片段，列是 5 个时间点，输出到 `Assets/Art/_Review/anim/`。用来检查肢体翻转、穿地、循环接缝。批处理模式下单独调 `Camera.Render` 不会刷新蒙皮，所以每格先 `BakeMesh` 再渲染。
- **已知限制**：
  - 有些动作转动的是整个身体（host 节点）而不是骨骼，例如玄龟翻身、甲壳旋转，以及 Boss 的升降、俯仰。这些目前只记录了离地高度，旋转还没进片段。
  - `liftAbove` 贴地修正需要网格顶点，采样时没有生效，只影响少数飘带的离地检查。
  - Boss（鲲鹏、火麒麟）和旧的部件骨架敌人还没采样；它们用的是 `setAnim` 驱动，可以照同样的方式扩展。

### 5.2 运行时动画层：在采样片段之上做得比 Three.js 更好

采样片段只当底层的关键姿势，环境适应和战斗反馈交给 Unity 运行时。改进点都是对照 Three.js 版的局限定的：

| 层 | Three.js 版 | Unity 版 |
|---|---|---|
| 运动 | 每只怪手工喂一套步态参数 | `CreatureLocomotion` 从根节点的实际运动推导 `Speed`、`MoveScale`。混合树里的 Idle / Walk（半速采样）/ Move（全速采样）按真实速度过渡。原地转身时用脚掌的弧速度驱动慢步态；转弯时身体压向弯内侧 |
| 脚步 | 平地 IK，把踝关节直接钉在地面上（走路时脚会陷进地里约一个踝高） | `CreatureRig` 每条腿射线找真实地面，落脚高度不低于「地面 + 静止踝高」；按离地高度判定支撑相并锁住脚掌（防滑步）；骨盆按最需要下探的脚整体升降；身体离地（悬浮、跳起）时自动关闭 |
| 看向 | 烘死在动画里 | 头颈链实时转向玩家，有限角和阻尼，目标在身后时自动放开 |
| 次级运动 | 固定的正弦波 | 尾巴、飘带、袍摆、铃铛等做成弹簧骨，以动画姿势为弹簧目标，叠加惯性和过冲，按族配置刚度、阻尼、重力。蝎尾出刺这类设计动作保留 |
| 受击 | 一个通用的抖动 | 按受击方向推开脊柱链、二阶弹簧回弹，力度随伤害缩放；重击时再叠采样来的受击片段 |
| 时机 | 写死在 TS 计时器里 | 采样时记录游戏逻辑真实调用伤害、弹体、特效、音效的时刻，写成动画事件 `OnAnimEvent(name)` |
| 死亡 | 程序化瘫倒 | `CreatureRagdoll`：胶囊半径按每根骨骼实际蒙皮顶点的厚度测量，用 CharacterJoint 连接；倒地后会顺着坡滚 |

骨骼分组由 `CreatureRigBuilder` 按骨骼名自动识别，规则覆盖语义命名和 Mixamo 命名，蟹的 8 条腿、鹿的 4 节腿都能识别。运行时组件都有显式的 `Tick(dt)`，所以 `ShowcaseSimulator` 能在编辑器里不进 Play 模式逐帧模拟（Spiritfire ▸ 批处理 `ShowcaseSimulator.BatchMotion`），出 `motion_<章节>_<角色>.png` 动作图，并把「支撑脚离地误差」在 IK 开、关下各统计一次（`motion_<章节>_metrics.txt`）。

2026-10-17 的实测（缓坡场景，支撑相脚掌到真实地面的距离）：

| 章节 | IK 关 | IK 开 |
|---|---|---|
| 赤沙古道 | 平均 7.3 cm，穿地 > 3 cm 占 17% | 小熊猫 0.7 cm、蝎子 0.4 cm、跳鼠 1.0 cm、蛤蟆 1.1 cm，穿地 6% |
| 昆仑雪墟 | 平均 10.6 cm，穿地 30% | 平均 2.6 cm，穿地 2% |
| 祝融火狱 | 平均 1.6 cm，穿地 7% | 平均 1.2 cm，穿地 0% |

已知问题：镇墓兽（腾跃式奔跑，身体起伏 30 cm 以上）在步态与招式切换时误差偏大；部分角色走圈时的近景机位被相邻角色挡住。

其余非人形资产（部件骨架的旧敌人与 Boss、武器）暂时用 `ProceduralIdle` 做程序待机。

## 6. 展示场景 `Assets/Scenes/Showcase_<Desert|Frost|Inferno>.unity`

三章共用一套广场布局，由 `ShowcaseSceneBuilder` 全部用代码生成（Spiritfire ▸ Showcase ▸ Build All Scenes），改布局改代码，不在场景里手摆。章节差异都在 `ShowcaseTheme` 里：每个布局角色（城门、墙板、端头、立柱、集市、火盆、高台、神龛、巨像、崖壁……）对应的资产 ID，以及各章的光照、天空、雾、后处理与地表（沙纹 / 雪堆 / 带自发光岩浆裂纹的玄武岩）。城墙长度按墙板与端头的实际宽度自动计算，角色排按包围盒宽度自动排开。

- **布局**：广场、北面城门，城墙套件按 4.5 m 墙板加两端端头拼接，四角角楼；西侧集市，东侧高台和传送神龛；远景是崖壁和巨像。中央一排角色：跳鼠刀兵（人形）、邪飞天和琵琶（人形）、小熊猫英雄（Mixamo 命名的人形）、蜃楼蛤蟆（非人形）。
- **光照**：暖色低角度主光、三色渐变环境光、天空盒反射，火盆点光用来测试 Forward+ 附加光。后处理是 Neutral 色调映射、Bloom、对比度和饱和度微调、轻微暖白平衡、暗角，再加线性沙尘雾。
- **第一人称**：转轮手枪和小熊猫左右手臂挂在一台叠加相机上（竖直视角 60°，FirstPerson 层）。腰射位置、手臂挂点取自 Three.js 版的 `viewOffset` 与 `WEAPON_HANDLING.revolver`。
- **操作**：右键 + 鼠标转视角，WASD / QE 移动，Shift 加速；F 切换第一人称；1–8 切到预设机位；H 让所有角色受击闪白；G 循环切换画质 低 / 中 / 高（对比毛发）。
- **审核截图**：`ReviewCapture` 按机位输出 1920×1080 的 PNG 到 `Assets/Art/_Review/`（不入库）。

## 7. Unity 侧自动 QA（`ArtValidator`）

报告写到 `Assets/Art/_Review/validation.json`。批处理时有错误则退出码为 1。`registry.toml` 里登记的 `qa_waivers` 会随 sidecar（`qaWaivers`）带过来：同名检查（如「LOD2 面数」）记为「◇ 已豁免」并附上理由，不阻塞，与 assetctl validate 的处理一致。

- **尺寸与朝向**：导入后 LOD0 的高度与设计包围盒相差不超过 5%。非人形资产还要求水平中心一致，否则判为左右或前后翻转。人形资产要求左手在 −X、脚尖朝 +Z。
- **面数**：每级 LOD 面数不超过规格档（允许 2% 三角化误差），并且逐级递减。
- **人形**：Avatar 有效、确实是人形，上臂接近水平（T-pose），并且挂了 Animator 控制器。
- **材质与贴图**：没有空材质槽，全部使用 StylizedLit；N 贴图导入为法线类型，ORM 关闭 sRGB；贴图边长不超过规格。

## 8. 后续

- 玩法移植：输入、角色控制器、武器与 Viewmodel、敌人状态机。`ArtAssetInfo.bind*` 与 manifest 的 `bind` 同义，可以直接接上。
- 非人形动画：把各敌人和 Boss 的程序招式移植成 C#，或在 Blender 里按 ROM 烘成片段。
- 场景：烘焙光照需要给静态件生成第二套 UV（`generateSecondaryUV`）；可以按章节加 Volume 预设（霜山偏冷、熔火高 Bloom）；植被和沙地可以考虑做贴花 / 地形混合。
- 许可：Hunyuan3D 的产出在欧盟、英国、韩国有地区限制（见 art/README.md 第 11 节）。这个限制随资产进入 Unity，`ArtAssetInfo.license` 里保留了原文。
