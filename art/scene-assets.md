# 本机场景资产与动作检视（2026-10-04）

## 第三轮：摊棚、修船与运渣陈设

本批为指定房区补三件中型静态道具：`SM_Env_MarketStall` 用于沙寺第二关水井院与第三关残屋夹院；`SM_Env_FrozenSkiff` 仅用于冻湖第三关修船槽；`SM_Env_SlagCart` 用于熔火第一关卸货口、第三关西岸转运站与第四关东模具堆场。沿用已经批准的十五张白盒，陈设用途与平面位置由关卡装配决定，没有按统一模板铺满所有关卡。具体布局、可见性与冻湖修船槽弹道处理见 [场景记录](../docs/gunfire-scenes.md)。

三件概念来自 **Codex 内置 `image_gen`**，三维艺术网格全部由本机 **ComfyUI 0.30.0 / Hunyuan3D 2mv** 生成。尺寸阶段只保存 `bounds_only` 数字参考，`geometry_created=false`；没有程序制作艺术替代网格，也没有重做其他已发布资产。随后以既有 Blender 管线完成等比对齐、减面、UV、四向投影、CPU 烘焙、LOD、Draco/WebP 导出。三件高模、构建与审核均为 v001，只有船的概念注册为 v002。此批不需要额外刚体落地修正或艺术网格补丁。

| 已发布资产 | 全 LOD 实测宽 × 高 × 深（米） | GLB 字节 | QA 通过 / 警告 / 错误 / 豁免 |
| --- | --- | ---: | --- |
| [MarketStall](../public/assets/props/SM_Env_MarketStall.glb) | 3.507110 × 3.088338 × 2.601671 | 237,968 | 37 / 1 / 0 / 0 |
| [FrozenSkiff](../public/assets/props/SM_Env_FrozenSkiff.glb) | 2.034016 × 1.542821 × 3.853796 | 176,432 | 36 / 2 / 0 / 0 |
| [SlagCart](../public/assets/props/SM_Env_SlagCart.glb) | 2.521942 × 2.214834 × 2.522429 | 290,476 | 38 / 0 / 0 / 0 |

每件均为 **5000 / 1600 / 500 三角面、1024² BC/N/ORM、单材质**。本机使用 `hunyuan3d-dit-v2-mv_fp16.safetensors`，50 steps、CFG 5、octree 384；种子依次为 `202610141`、`202610142`、`202610143`，实际推理耗时 168.8 / 134.9 / 273.7 秒。全部源 GLB 前方为 +Z，船体长轴为 Z，渣车轮轴为 X。运行时必须采用所有 LOD 的共同包络居中、底面定位和等比缩放；渣车最低点为 `Y=-0.034692`，来自最远 LOD 轮底，不能只用 LOD0 的 2.170 米高度代替联合尺寸。

本轮保存的真实输入与审图：

| 资产 | 完整提示词 | 原始概念 / 注册四视图 | 实际成品审核 |
| --- | --- | --- | --- |
| 摊棚 | [v001 prompt](source/props/SM_Env_MarketStall/01_concept/CN_SM_Env_MarketStall_v001_prompt.txt) | [原图](source/props/SM_Env_MarketStall/01_concept/CN_SM_Env_MarketStall_v001_source.png) / [四视图](source/props/SM_Env_MarketStall/01_concept/CN_SM_Env_MarketStall_v001_sheet.png) | [五视图与 LOD](source/props/SM_Env_MarketStall/05_review/SM_Env_MarketStall_v001_review_v001.png) / [棚下结构](reviews/authored-scenes-setdressing-20261004/SM_Env_MarketStall-structure-v001/lod0-underside.png) |
| 木船 | [v001 创建 prompt](source/props/SM_Env_FrozenSkiff/01_concept/CN_SM_Env_FrozenSkiff_v001_prompt.txt) / [v002 透明底编辑 prompt](source/props/SM_Env_FrozenSkiff/01_concept/CN_SM_Env_FrozenSkiff_v002_prompt.txt) | [原生透明图](source/props/SM_Env_FrozenSkiff/01_concept/CN_SM_Env_FrozenSkiff_v002_source.png) / [四视图](source/props/SM_Env_FrozenSkiff/01_concept/CN_SM_Env_FrozenSkiff_v002_sheet.png) | [五视图与 LOD](source/props/SM_Env_FrozenSkiff/05_review/SM_Env_FrozenSkiff_v001_review_v001.png) / [俯视内舱](reviews/authored-scenes-setdressing-20261004/SM_Env_FrozenSkiff-structure-v001/lod0-elevated.png) |
| 渣车 | [v001 prompt](source/props/SM_Env_SlagCart/01_concept/CN_SM_Env_SlagCart_v001_prompt.txt) | [原图](source/props/SM_Env_SlagCart/01_concept/CN_SM_Env_SlagCart_v001_source.png) / [四视图](source/props/SM_Env_SlagCart/01_concept/CN_SM_Env_SlagCart_v001_sheet.png) | [五视图与 LOD](source/props/SM_Env_SlagCart/05_review/SM_Env_SlagCart_v001_review_v001.png) / [底盘结构](reviews/authored-scenes-setdressing-20261004/SM_Env_SlagCart-structure-v001/lod0-underside.png) |

初始木船白底概念注册因可能误去浅色雪盖而被明确拒绝，原图、完整创建 prompt 和拒绝记录保留。内置工具随后只进行透明背景编辑，注册 v002 使用工具返回的真实 alpha，不再对白雪按亮度抠像；四个轮廓保留全部 alpha 大于 4/255 的像素，剔除的是极低透明背景散点。alpha 加权保留比例为 99.9983%，详见 [透明度证据](reviews/authored-scenes-setdressing-20261004/frozen-skiff-alpha-audit.json)。原始创建 prompt 集合及原生输出路径在 [setdressing_concepts_v001.json](pipeline/setdressing_concepts_v001.json)，透明编辑与完整来源链在 [frozen_skiff_alpha_v002.json](pipeline/frozen_skiff_alpha_v002.json)。

审核使用实际导出 Draco 网格，保留源节点变换，并检查全部 LOD 的包络、连通体和代表性三角面射线。三件每档均为单个连接的主体。摊棚的实际服务开口保持开放，棚顶代表厚度 0.197–0.269 米，棚下支架没有被整面封死；木船中央舱槽约 0.98 米深，船底代表厚度 0.15–0.18 米，两根座板与厚船舷保持连接；渣车的两侧厚轮、底盘和后支脚可辨，轮部纵向剖面为 1.176–1.254 米。额外 [结构审图工具](pipeline/blender/bl_setdressing_structure_review.py) 仅渲染实际 GLB 的三档俯视与底面，没有创建或修改艺术几何。

警告如实保留：摊棚直接投影覆盖 45.5%；木船 UV 利用率 43%、直接投影覆盖 42.3%。遮挡区域沿用管线的扩散补色，船内舱和道具底面较素，适合正常游玩距离的静态陈设；没有把这类区域描述为精修特写，也没有以缩小尺寸掩盖形体问题。渣车自动 QA 无警告，但仍有 43.7% 顶点依靠扩散补色，最远 LOD 的轮缘较粗。概念与成品批准者均明确为 **Codex AI visual review**，尚非用户对本轮成品的最终验收。

六项资产来源/实际三档结构测试在 `ART_LOCAL_SOURCE_AUDIT=1` 下通过。默认 `node --test tests/setdressing-assets.test.mjs` 只依赖已入库的档案、工作流与发布 GLB；本地来源审计再实读被忽略的概念输入和高模原文件。每件 24 个当前版本本地文件的哈希核验、原始工作流、QA 详情、拒绝历史、精确包络、最终 GLB 哈希、manifest 与审图路径在 [完整成品汇总](reviews/authored-scenes-setdressing-20261004/setdressing-summary.json)。旧 manifest 条目逐项保持一致。

三件合计 **704,876 字节**；新增后环境资产库存为 **26 件、5,370,136 字节 GLB**，不是单关同时加载量或 FPS 结论。全部生成和 Blender 任务顺序结束，23:41:58 的 [本机队列记录](reviews/authored-scenes-setdressing-20261004/final-local-queue.json) 为 ComfyUI 0 running / 0 pending、Blender 0 进程。模型发布、来源核验与 AI 审图完成，不据此宣称十五关美术已经最终完成。

## 第二轮：补充货运用途道具

新增 **`SM_Env_CargoHoist` 粗木货运绞盘架**，供冻湖工作栈道、断裂输渣线检修场与沙寺驿街的局部主景装配。厚木架、粗卷筒、侧面手摇盘及三角撑脚建立货运用途辨识，沿用适度细节的风格化手绘方向；它是静态场景件，没有新增交互或独立运动机构。

新概念使用 **Codex 内置 `image_gen`**，三维艺术网格由本机 **ComfyUI / Hunyuan3D 2mv** 生成。`bounds_only` 只提供数字尺寸与正交相机参考，未程序化制作艺术替代网格。真实 [完整提示词](source/props/SM_Env_CargoHoist/01_concept/CN_SM_Env_CargoHoist_v002_prompt.txt)、[原始生成图](source/props/SM_Env_CargoHoist/01_concept/CN_SM_Env_CargoHoist_v002_source.png)、[注册四视图](source/props/SM_Env_CargoHoist/01_concept/CN_SM_Env_CargoHoist_v002_sheet.png)、[原始 prompt 注册表](pipeline/cargo_hoist_concept_v001.json) 与 [本机 Hunyuan 工作流](source/props/SM_Env_CargoHoist/02_highpoly/HP_SM_Env_CargoHoist_v001_graph.json) 均已保存。

| 项目 | 最终已发布结果 |
| --- | --- |
| 高模来源 | `hunyuan3d-dit-v2-mv_fp16.safetensors`，四视图；50 steps、CFG 5、octree 384、seed `202610104` |
| 版本 | 数值参考 v001 / 概念注册 v002 / 高模 v001 / 构建 v002 |
| 实际宽 × 高 × 深 | **3.617899 × 3.405178 × 2.541877 米**，包含全部 LOD 和摇柄外伸 |
| 全 LOD 边界 | min `[-1.808949, 0, -1.270928]`，max `[1.808949, 3.405178, 1.270949]` |
| 三角面 / 贴图 | **5000 / 1600 / 500**；1024² BC、N、ORM，单材质，Draco + WebP |
| 发布文件 | [SM_Env_CargoHoist.glb](../public/assets/props/SM_Env_CargoHoist.glb)，**254,532 字节** |
| 自动 QA | **37 项通过、0 错误、1 警告、0 豁免** |
| 视觉审核 | [成品五视图、LOD 布线及贴图](source/props/SM_Env_CargoHoist/05_review/SM_Env_CargoHoist_v002_review_v002.png)，Codex AI 审核通过，尚非用户成品验收 |

保留的警告是**四视图直接投影覆盖 48.5% 顶点**，其余 51.5% 使用既有管线的网格扩散补色；内侧与底面细节更简化。实际审图中木架、卷筒、手摇轮和底座色彩保持连续，适用于正常游玩距离的静态场景道具。该警告没有被豁免或改成通过。

原图的摇柄与相邻视图在横向投影上重叠，默认等列切分会截断摇柄，故首次概念注册 v001 被明确拒绝并留存。v002 从原图的四个独立二维轮廓分图、去白底、等比配准，保留全部前景与源 RGB，没有重画概念。首个构建的水平轴心偏移也保留在 QA 记录中；构建 v002 仅对全部 LOD 做相同刚体平移，修正居中和落地，不改形状、拓扑或 UV。

通过 [实际 Draco 审查](tools/audit_cargo_hoist.mjs) 复核，中央卷筒在三 LOD 的代表高度保持 **1.04–1.21 米厚度**，不是平面贴片。摆放沿用 `architectureMatrix` 的全 LOD 包络居中、底面定位与等比缩放。两项来源/完整概念/真实体积检查 `node --test tests/cargo-hoist.test.mjs` 已通过。完整参数、24 个本地来源文件的哈希核验、manifest 与审核记录见 [货运绞盘汇总](reviews/authored-scenes-detail-20261004/cargo-hoist-summary.json)。发布前后逐项对比确认旧 manifest 资产条目均未改变；本轮新增后环境库共 **23 件、4,665,260 字节 GLB**，不据此推断场景 FPS。

## 第一轮：批准白盒后的十五关装配

用户已试玩认可十五张独立白盒，本批沿用其房区、通道、掩体与遭遇布置，进入第一轮场景美术装配。逐关平面与入口见 [关卡设计记录](../docs/level-design/README.md)，整体美术记录见 [gunfire-scenes.md](../docs/gunfire-scenes.md)。这次批准的是白盒游玩方案；场景美术仍需继续接受第一人称检查与用户试玩。

装配复用 **21 件已发布本机 Hunyuan 环境资产**，另新增一件 `SM_Env_TravelDeck`，当前环境资产库共 **22 件、4,410,728 字节 GLB**。该数字是资产库存体积，并非每关同时加载或绘制的规模。复用库含六件小道具、三件自然物、三件地标、三件墙体、三件门楼和三件巨崖。全部旧资产的实际 Draco 网格、各 LOD 包络、三角面数、哈希及原审核记录已重新核对，见 [库存审查](reviews/authored-scenes-20261004/asset-audit.json)；本次另实际查看了六件墙体/巨崖复审图，其他旧资产沿用已有审核，未表述为重新逐件人工验收。

`AuthoredSceneLayout.ts` 根据各关真实地面轮廓、房区身份与地标位置摆放成品；`SceneArchitecture.ts` 按源网格所有 LOD 的共同包络进行等比适配。美术摆放不改批准的碰撞和导航布局。墙脚、岩壁、门楼和掩体立面均复用 Hunyuan 网格；代码中的地面、材质、碰撞与边界支撑属于运行时技术层。

### 新增厚木栈桥 `SM_Env_TravelDeck`

概念由内置 `image_gen` 生成，三维艺术网格由本机 ComfyUI 的 **Hunyuan3D 2mv** 四视图推理生成。平板以竖立姿态拍摄四视图，以便条件图覆盖可走顶面、底面及厚端面；构建时通过刚体旋转还原水平铺板。尺寸参考只写 `bounds_only` 数值，没有程序生成的艺术替代网格。

| 项目 | 已发布结果 |
| --- | --- |
| 本机生成 | `hunyuan3d-dit-v2-mv_fp16.safetensors`；seed `202610090`；50 steps；CFG 5；octree 384；139.7 秒 |
| 概念 / 高模 / 构建 | v002 / v001 / v002 |
| 面数与贴图 | 5000 / 1600 / 500 三角面；1024² BC、N、ORM；单材质；Draco + WebP |
| 全 LOD 实测宽 × 高 × 深 | 5.516021 × 0.734755 × 3.881925 米 |
| 自动 QA / 视觉审核 | 37 项通过、0 错误、0 警告、0 豁免；Codex AI 明确视觉审核通过 |
| 发布文件 | [SM_Env_TravelDeck.glb](../public/assets/props/SM_Env_TravelDeck.glb)，141,304 字节 |
| SHA-256 | `4c6ceba7e29ec3ebca9063fa2a971a41ea2581da7f308051dc61aa6ff674f61a` |

真实 [提示词](source/props/SM_Env_TravelDeck/01_concept/CN_SM_Env_TravelDeck_v002_prompt.txt)、[原始概念图](source/props/SM_Env_TravelDeck/01_concept/CN_SM_Env_TravelDeck_v002_source.png)、[注册四视图](source/props/SM_Env_TravelDeck/01_concept/CN_SM_Env_TravelDeck_v002_sheet.png)、[本机生成工作流](source/props/SM_Env_TravelDeck/02_highpoly/HP_SM_Env_TravelDeck_v001_graph.json)、[最终复审图](source/props/SM_Env_TravelDeck/05_review/SM_Env_TravelDeck_v002_review_v001.png) 均已保存。完整版本、输入/输出哈希、manifest 记录、QA 和审核者见 [成品汇总](reviews/authored-scenes-20261004/travel-deck-summary.json)。最初构建因落地基准偏差未通过，失败记录保留；v002 仅对全部 LOD 做相同刚体平移，未补网格、改变拓扑或重画 UV。

栈桥仅用于冻湖三栈与断裂输渣线的指定跨岸通道。每 LOD 中央顶面 81 点实测均连续，顶面约 `Y=0.610` 米、单 LOD 高差小于 2 毫米；最高点是边缘铁件，不能作为木板地面基准。以 `y = floorY + 0.01 - 0.610 × scale` 放置，使用等比缩放和原地面碰撞，不引入跳跃台阶。实测详情见 [几何审查](reviews/authored-scenes-20261004/travel-deck-audit.json)，对应 `node --test tests/travel-deck.test.mjs` 两项检查已通过。

### 边界可读性审查

[实际网格审查工具](tools/audit_authored_boundary.mjs) 对 desert-1、frost-3、inferno-3 沿地面外边界最多每 2 米采样一次，在边界内 0.4 米、视高 1.2 米向外检测真实 Draco LOD1。近邻包络只用于预筛，最终结果来自三角面命中。初始 [基线报告](reviews/authored-scenes-20261004/boundary-visibility.json) 与修复后的 [复跑报告](reviews/authored-scenes-20261004/boundary-visibility-after.json) 均保留源文件 SHA，供定位低位长缺口。

复跑命令：`node art/tools/audit_authored_boundary.mjs --plans desert-1,frost-3,inferno-3 --out art/reviews/authored-scenes-20261004/boundary-visibility-after.json`。可加 `--height 1.62` 检查玩家眼高，另存的 [眼高报告](reviews/authored-scenes-20261004/boundary-visibility-eye.json) 记录对应源码版本。比较用 `lengthWeighted`，避免短阶梯边界过度计数。单一高度/角度的缺失命中仅表示边界可读性风险；该审查不包含技术背板，不证明玩家能越界，也不证明所有视角的围合已经完成。此批没有借用旧地图帧率作为十五关的性能结论。

## 此前资产与动作批次记录

以下保留前序记录。此前三章各追加 Hunyuan 四视图墙段、开放门楼与宽巨崖，共九件；完整实际提示词见 `art/pipeline/architecture_concepts_v003.json`、`art/pipeline/cliff_concepts_v002.json`。

正式场景网格由本机 **ComfyUI / Hunyuan3D 2.1、2mv** 生成。程序负责尺寸参考、动画、减面、UV、烘焙、摆放、碰撞适配与 LOD；此前脚本拼装的六件成品已撤下。

| 主题 | 资产 | 场景替换点 |
|---|---|---|
| 沙寺 | SM_Prop_DesertReliquary 镇灵碑 | desert.statue |
| 沙寺 | SM_Prop_DesertUrns 陶罐组 | desert.pots |
| 霜山 | SM_Prop_FrostShrine 石灯龛 | frost.stoneLantern |
| 霜山 | SM_Prop_FrostPrayerCairn 祈愿石 | frost.crystal |
| 熔火 | SM_Prop_InfernoCrucible 祭炉 | inferno.brazier |
| 熔火 | SM_Prop_InfernoChainObelisk 锁魂碑 | inferno.crystal、inferno.spike（按原碰撞范围适配） |
| 沙寺 | SM_Env_DesertSandstone 侵蚀砂岩簇 | desert.rock、场外岩层 |
| 霜山 | SM_Env_FrostPine 积雪松树 | frost.pine |
| 熔火 / 霜山 | SM_Env_InfernoBasalt 断裂玄武岩簇 | inferno.rock、熔火场外岩峰、霜山场外积雪岩峰 |

概念四视图由 Codex 内置 image_gen 生成，已复制到各资产的 `01_concept/`。完整提示词集合在 `art/pipeline/scene_concepts.json`，该文件的源路径指向本次本机 ImageGen 输出；资产目录里的副本与 `asset.json` 记录独立保存。

前六件陈设的三维生成使用 `hunyuan_3d_v2.1.safetensors`，50 步、CFG 5、体素分辨率 384、种子 20261003。每个资产的 `asset.json` 保存实际工作流、模型、GPU、耗时、版本血缘与校验和；`02_highpoly/` 保留本机高模。Blender 对生成网格进行后处理，输出 2500 / 900 面预算的两级 LOD，以及 512² BaseColor、Normal、ORM 贴图。烘焙使用 CPU，让 Hunyuan 独占 GPU。

运行时从 `public/assets/manifest.json` 加载 `public/assets/props/*.glb`，替换原有装饰点。带碰撞的模型按真实包围盒、旋转方向与生成器既有碰撞体等比适配，不扩大通道障碍；火焰高度随实际缩放调整。低画质直接使用远景 LOD。几何与贴图共享，材质按场景复制并复用，主题环境设置不会污染原资产；场景退出时释放本场景的材质、雾效、辉光与接触阴影资源。

三章陈设按主题组合：沙寺镇灵碑配陶罐、霜山祈愿石配石灯龛、熔火锁魂碑配祭炉。远门两侧形成礼仪焦点，侧墙组采用不同前后位置、尺度与陪衬数量，高台后侧摆矮陪衬；入口视线设置主景，避开中轴战斗路线、出生点、奖励、传送门与台阶口。陈设实体直接进入生成期占地与导航验证，高台上的物件随所属平台一起移除或保留。熔火间接光增加冷色补光，让黑曜石雕刻在暖火光中仍然可读，关卡点光源维持两盏。

源资产校验保留了警告：镇灵碑的 UV 利用率、祭炉的参考占地、锁魂碑的参考深度和部分遮挡区域投影覆盖。尺寸由运行时碰撞适配处理，遮挡区域通过已有网格补色流程处理。未使用 QA 豁免。

流水线中的概念和成品审核记录为 **Codex AI 视觉检查**。用户于 2026-10-04 确认这批生成场景模型质量过关，并要求继续搭建场景；这是本轮陈设搭建的依据，原流水线审核记录仍按实际审核者保留。概念四视图、成品五视图、LOD 布线、贴图与校验报告都保留在本机资产目录中，供后续美术检查。

开发服务器运行后打开 `/details-lab.html`：可检查十八把武器与三名英雄的手臂，暂停并拖动换弹进度；炮手可分别检视三连炮击、炮托砸击，并以 6 / 20 / 32 米切换实际曲射角；法师可分别检视法阵施放、护佑引导。动作进度可暂停拖动，可切换正面和两侧镜头，选择保存在网址参数中；还可单独查看九件 Hunyuan 道具，以及三章固定种子的陈设全景、入口与主景近景。检视页显示实际生成模式、LOD 数与文件大小，面板可收起以查看完整构图。此检视页不进入正式打包入口。正式游戏直接使用已发布资产。

炮手按铜炮的实际结构分工持握：后手承托炮尾，前手托光滑炮管，避开铁箍；架炮时屈膝、弯肘，身体吸收每发后坐，近身时抬举、前踏、炮尾下砸。炮口仰角根据真实炮口到落点的抛物线调整，架炮和弹间提前转向，下方支撑手随仰角滑到可达的承托位置。前踏在起招时锁定落脚点，通过现有导航与碰撞积分移动整个角色；接触帧还检查真实炮尾的短距离包络和遮挡，墙挡住或玩家闪开时可以落空。法师法阵采用聚符、伸手、送杖，护佑采用举杖、抬手引导、收势；法珠保留在杖头，特效由实际挂点发出。原有伤害、前摇、三发间隔与法阵延迟保持。

真实身体网格检查发现，旧持握方式把手腕世界朝向强制复制成武器朝向，导致炮手手腕反折超过 110°，握点位置虽然可达，手掌和袖口仍然塌陷。现按发布身体校准真实掌心偏移与掌厚，通过肩、肘解接触点，主手腕保持局部中立；法师持杖前臂做小幅旋前/旋后，自由手只做小幅局部手势。法师生成袖口还混有髋部权重，抬手时出现极端拉伸；`ArticulationWeights.ts` 只修正两件身体的臂袖权重，缓存所有 LOD，保留肩部接缝以及原始位置、索引、UV、法线、贴图。没有新建程序化美术模型，也未重做已确认的 Hunyuan 场景资产。

此前动作修正验证：45 项自动测试与生产构建通过。炮手真实炮体检查覆盖 1264 帧攻击/后坐/收势及 127 帧动态瞄准，头部和躯干保持净空；校准掌面后的炮手关键姿态与法师 84 帧两类施法/收势，手掌深入和接触间距均不超过 3 毫米，腕区没有压缩塌陷，法杖对头部、躯干和骨盆保持净空。真实 EnemyBase、CollisionWorld、NavGrid 验证炮托从 2.2 / 2.3 米起招，分别前进约 0.935 / 0.972 米，在原 0.55 秒命中时点造成 14 伤害，挡墙及侧闪均不命中。场景测试保留三章、五类关卡的 360 个布局覆盖。浏览器检查了 6 / 20 / 32 米炮击、前踏炮托击，以及两类施法的蓄力、释放和收势；本次修正后的截图保存在 `art/reviews/grip-fix-20261004/`。早期 `polish-20261004` 截图保留为过程记录，不代表最终姿态。

本轮场景细化（2026-10-04）：继续使用用户已确认的六件本机 Hunyuan 模型，给陈设增加主景、陪衬与点缀层次。沙寺入口左侧以镇灵碑引导视线，霜山右侧使用祈愿石与灯龛，熔火以锁碑和高低祭炉构图；墙边不再等距离重复同尺寸雕像，高台后部陈设也采用不同位置和尺度。入口至庭院中心保留 2.4 米视廊，至远门保留 1.3 米纵深视线；随机柱子、高台及旧松树、仙人掌都在生成模型与碰撞之前避让，树冠和枝臂采用实际外延检查。远处两侧继续保留战斗掩体。

新增的二维石板原图来自 **Codex 内置 image_gen**，已原样保存为 `public/assets/environment/weathered-stone-v1.png`；最终完整提示词、生成器与原始输出路径保存在 `art/source/environment/weathered-stone-v1.json`。原图没有改写，运行时叠加主题色、积沙、积雪或灰烬，并从相同像素计算浅凹凸与粗糙度。道具脚下和墙根增加轻量平面接触层；熔火裂缝亮度集中在祭炉组和周边，中央铺地与闪烁保持克制。旧锥形火焰换为单批、单 pass 的柔和动态 billboard 特效。以上均为材质和特效处理，没有以程序创建新的三维美术模型。

天空、雾、颗粒和主题补光调整后，近处道具与远处环境有更明确的层次。沙寺旧远山采用较淡的青灰色与单独 24–125 米背景雾，保留场内雾和照明；旧远山几何仍保留。熔火原 spike 装饰点复用已确认的 Hunyuan 锁碑，按原碰撞宽、高适配。关卡仍使用两盏点光源，低画质保留已有低面数 LOD；平面火焰几何跨关共享，逐关材质和实例正确释放，共享 Hunyuan 原资源不随换关释放。

本轮验证：**48 项自动测试、类型检查与生产构建通过**。场景检查包含原 360 个布局的导航与保留区、144 个主题主景视线，以及新增 150 个入口中央视线和树冠检查（含实际种子 `20261004`）。三章高/低画质构造、更新与重复释放 smoke 通过；浏览器逐章检查入口和主景近景，未出现渲染错误。最终实机截图保存在 `art/reviews/scene-refinement-20261004/`。

追加的自然环境件：侵蚀砂岩簇用于沙寺近处碎石与场外岩层；积雪松树替换霜山原有的叠锥树；断裂玄武岩簇用于熔火近处碎岩与场外岩峰。三件的概念原图由 **Codex 内置 image_gen** 生成，完整最终提示词和原始输出路径在 `art/pipeline/nature_concepts.json`，未经改写的原图副本与按物理高度配准的四个视图保存在各资产 `01_concept/`。新参考阶段只保存尺寸、落地轴心和正交相机 JSON（`bounds_only`、`geometry_created=false`），没有程序化白模网格；三维艺术形体全部来自本机 Hunyuan 输出。概念和成品批准者仍明确记录为 Codex AI 视觉检查。

两件岩簇使用 Hunyuan3D 2.1 单图，种子分别为 20261004、20261006；松树使用本机 `hunyuan3d-dit-v2-mv_fp16.safetensors` 四视图生成，种子 20261005。均为 50 步、CFG 5、384 体素。每次实际 ComfyUI 图谱在提交前保存，成功输出同时记录图谱和高模哈希。新 `nature_prop` 规格采用 5000 / 1600 / 500 面预算的三级 LOD、0 / 18 / 42 米切换与 1024² BaseColor、Normal、ORM，单件上限 900 KiB；CPU 烘焙与下一件 Hunyuan GPU 推理可并行。清单中的 `generator` 和 `license` 取自对应 build 的真实高模版本。

松树第一版单图高模是薄片，完成后深度只有 0.022 米；该版本被 AI 拒绝，未发布。原始高模、旧校验报告和新增失败报告都按版本保留。自然件新增横向体量至少达到参考尺寸 25% 的自动检查，失败形体由 Hunyuan 重生成。四视图版的最远 LOD 又因小拓扑环停在 540 面，随后只对最远 LOD 做有界邻点焊接与减面；清理上限是高度的 1.5%，实际尝试阈值和面数写入 metrics，无法达到预算就失败。近景和中景网格保持原样，旧六件陈设默认不启用此处理。

运行时测量所有 LOD 顶点的联合高度和水平半径。松树冠幅保持在原有 3.1 × s 米包络内，高度不超过 4.6 × s 米，保留既有树干碰撞；近处无碰撞碎岩保持直径不超过 1.7 × s、高度不超过 0.85 × s 米，避免替换成不可阻挡的高岩。减面造成低 LOD 略向外扩张也纳入适配。小碎岩的 LOD 距离随实际缩放调整；低画质从 LOD1 开始，仍可继续切到 LOD2。树冠除入口中轴和远门外，也避让主景视线，新增 60 个布局覆盖此前遮挡种子。

三章场外环境都复用 Hunyuan 岩簇的最后一级 LOD，每章单批 30 个实例，采用少量高峰与较宽低岩、不同转向及埋入地面的高低组合。沙寺使用砂岩，熔火和霜山使用断裂岩簇；霜山通过正确考虑实例非等比缩放的世界法线，为朝上的岩面混合雪色并使用 60–180 米背景雾。以上是材质处理，未生成额外雪帽网格。材质保留原资产纹理，按主题降低饱和度并加入背景雾，不增加灯光或投影。共享几何和贴图不随换关释放；场景独有材质和实例重复释放也只触发一次。

自然环境件实际发布规格：砂岩 5000 / 1600 / 500 面、233364 字节；松树 4993 / 1600 / 496 面、478220 字节；玄武岩 5000 / 1600 / 500 面、254860 字节。三件合计 966444 字节（约 944 KiB）。Hunyuan 推理分别耗时 132.9 / 194.7 / 144.9 秒，松树最远 LOD 的实际邻点清理阈值为 0.05547 米。两件岩簇各保留一项天然不对称轴心警告；松树保留 IoU 0.745 和 52% 遮挡区域扩散补色两项警告，没有校验豁免。

本轮自然件验证：**58 项测试和生产构建通过**。新增检查解码实际发布 Draco 顶点，核对全部 LOD 的三维体量、近景尺寸包络、三级切换、1024 WebP/PBR 通道和真实本机 Hunyuan 图谱、原高模与四视图输入哈希；拒绝的薄片版本仍保留失败证据。远景检查覆盖三章各 30 个实际 LOD2 实例的场外净空、峰高差异、源资源共享、重复释放和积雪材质注入。浏览器查看三件模型（雪松含转向后的侧面）、三章入口与主景，未发现资产加载或着色器错误。实机截图保存于 `art/reviews/nature-models-20261004/`。

仓库保留三件自然资产的小型 Hunyuan 工作流 JSON；高模 GLB、输入 PNG 和烘焙中间文件仍留本机。默认 `npm test` 只依赖仓库发布物、图谱及来源档案；设置 `ART_LOCAL_SOURCE_AUDIT=1` 后追加原高模和四视图输入文件的实读哈希检查。本机审计模式的自然件 9 项检查已通过，不以缺失中间产物跳过运行时模型 QA。

验证命令：`npm test`（鼠标输入、装填路径、武器轴线与释放挂点、真实骨骼网格/掌面/袖口、炮托导航与碰撞、碰撞适配、生成资产来源与 GLB 规格），`npm run build`。浏览器检查用于确认实际渲染；它不代表已验证所有玩家设备或用户的 DLP 打开与外发路径。

地域建筑追加：本机 Hunyuan 新生成沙寺残垣壁龛 `SM_Env_DesertRuin`、覆雪山道祭亭 `SM_Env_FrostWayshrine`、黑曜铸造祭炉 `SM_Env_InfernoFoundry`。每章四处建筑与既有陪衬形成补给区和祭坛地标；主路保留石板，路外使用积沙、积雪或灰烬覆盖。三件合计约 995 KiB，三级 LOD、1024² PBR，均按实际网格等比适配完整碰撞包络。完整 ImageGen 最终提示词在 `art/pipeline/landmark_concepts.json`，生成、失败重试、成品规格、运行时布局与验证记录见 `docs/scene-landmarks.md`。检视页目前可检查十二件 Hunyuan 场景资产，新增背面镜头与地标主景/支路构图。完整测试 98 项、生产构建和本机来源审计 10 项通过。

画风调整追加：按用户指定的《枪火重生》级别品质，将三件地标与砂岩、雪松、玄武岩重做为大形体、手绘色块与少量中尺度细节。概念由内置 image_gen 编辑，三维形体仍由本机 Hunyuan 生成，Blender 仅做技术处理。最终六件均为 5000 / 1600 / 500 面、1024² PBR、单材质，总 1,576,124 字节，比旧发布物减少 20.6%；四项 QA 警告保留、零错误/豁免。雪亭第一稿最远 LOD 超预算被拒绝后，以闭合侧墙和厚实连接的参考重新生成，最终按原限额通过，失败证据保留。场景/检视材质副本降低粗糙度纹理和强法线的细碎感，地面与远景一起统一画风；修复异步加载重复墙边风化层和道具旋转后的镜头偏差。完整测试 **99 项**、本机来源审计 **11 项**、生产构建通过。完整提示词、实际版本、同机位画面对比和性能记录见 `docs/scene-stylization.md` 与 `art/reviews/stylized-scene-20261004/`。
