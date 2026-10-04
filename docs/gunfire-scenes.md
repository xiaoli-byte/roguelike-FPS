# 《枪火重生》场景美术对齐（2026-10-04）

## 当前阶段：第三轮区域用途与中景轮廓

第三轮为驿街与残屋院补粗木商棚，为冻湖修船坞补短船，为熔火卸货、转运和模具场补运渣车。共六个指定区域，没有把同一套新道具铺满十五关。继续采用风格化、适度细节的游戏模型；新模型全部来自本机 Hunyuan3D，代码只负责摆放和技术装配。

### 三件新资产与来源

| 成品 | 全 LOD 实测宽 × 高 × 深 | 发布 GLB | 概念原图与实际提示词 |
| --- | --- | --- | --- |
| 粗木商棚 `SM_Env_MarketStall` | 3.507 × 3.088 × 2.602m | 237,968 字节 | [原图](../art/source/props/SM_Env_MarketStall/01_concept/CN_SM_Env_MarketStall_v001_source.png) / [提示词](../art/source/props/SM_Env_MarketStall/01_concept/CN_SM_Env_MarketStall_v001_prompt.txt) |
| 冻湖短船 `SM_Env_FrozenSkiff` | 2.034 × 1.543 × 3.854m | 176,432 字节 | [透明原图](../art/source/props/SM_Env_FrozenSkiff/01_concept/CN_SM_Env_FrozenSkiff_v002_source.png) / [原概念提示词](../art/source/props/SM_Env_FrozenSkiff/01_concept/CN_SM_Env_FrozenSkiff_v001_prompt.txt) / [透明编辑提示词](../art/source/props/SM_Env_FrozenSkiff/01_concept/CN_SM_Env_FrozenSkiff_v002_prompt.txt) |
| 短底盘渣车 `SM_Env_SlagCart` | 2.522 × 2.215 × 2.522m | 290,476 字节 | [原图](../art/source/props/SM_Env_SlagCart/01_concept/CN_SM_Env_SlagCart_v001_source.png) / [提示词](../art/source/props/SM_Env_SlagCart/01_concept/CN_SM_Env_SlagCart_v001_prompt.txt) |

概念使用内置 ImageGen；本机 ComfyUI Hunyuan3D 2mv 工作流使用 50 steps、CFG 5、octree 384，三件 seed 为 202610141 / 202610142 / 202610143。Blender 只做既有减面、UV、投影烘焙和 LOD。每件均为 **5000 / 1600 / 500 三角面、1024² BC/N/ORM、单材质**。环境库存现为 **26 件、5,370,136 字节**，本轮增加 704,876 字节，全部既有 manifest 条目保持原内容。

实际 Draco 三档结构检查与五视图审图确认：商棚售卖口贯通、屋顶有厚度；短船内舱深约 0.98m，中央底壳约 0.15–0.18m，座板有支撑；渣车双轮、底盘和车斗保留体积。商棚保留直接投影覆盖 45.5% 的警告；短船保留 UV 利用率 43% 和直接投影覆盖 42.3% 两项警告；渣车零警告。内舱和底部补色较简，不作为近景英雄资产。三件自动 QA 均零错误、零豁免，经 Codex AI 视觉审核，不等于用户最终签收。

短船 v001 白底概念未用于最终高模输入；内置 ImageGen 的透明编辑保留雪盖和原轮廓，注册按原生 alpha 提取，未按白色像素删雪。[alpha 核验](../art/reviews/authored-scenes-setdressing-20261004/frozen-skiff-alpha-audit.json)。所有版本、精确提示词、工作流、哈希、结构审图、发布记录和队列结束记录见 [本轮资产汇总](../art/reviews/authored-scenes-setdressing-20261004/setdressing-summary.json)。概念与大体积中间产物留在本机；常规来源测试只依赖入库档案与发布 GLB，`ART_LOCAL_SOURCE_AUDIT=1` 额外核对本机概念和高模原件。

### 六处场景与修船坞弹道

- 驼铃驿街：商棚沿水井院北面商街布置，瓮与货棚绞盘区形成交易/储运关系；从原井院遭遇安全点斜望柜台与回接巷口。
- 沉沙围城：残屋夹院的休整位置用旧货摊替换供碑，保留城门、外环和院内掩体的空间关系。
- 冻湖三栈：短船侧泊原 U 形槽，卷扬机靠船首；重排已有墙岩，近侧降为低护岸，后岸与侧岸真实墙身深搭接。船槽净增 3 个实例，原栈桥、补给操作条带和八条通道不变。
- 熔火三处：灰烬卸货口、输渣线西岸转运站、三角围场东模具区分别使用与运输方向相应的渣车构图，避免三处统一朝向。

修船槽仍保留原 8m 移动阻挡和原导航。仅这个窄区域用固定实际 LOD1 网格作为射击代理，精确扣除旧合并墙盒在窗口内的射线区间；窗口之外、地面和掩体仍使用原碰撞。真实船体与护岸供子弹、光束、扫掠投射物和爆炸视线共同查询。缺失资产时显示临时封闭面并保留旧遮挡；网格就绪后原子切换，卸载或换回技术白盒撤销。

实际网格回归包含 114 条命中/法线比对：84 条船体命中，以及越过船顶、低舷、槽内分段投射物和 1.2/4/7/7.9m 后岸/侧岸检查。另有 2500 条随机几何差集对照。运行时只查询预建的 13 个局部候选，BVH 共 12,045 个三角；4000 次 Node 查询平均检查约 131 个三角、约 0.02ms/次。这是本机 CPU 专项测量，不是整场 GPU 帧率。

同时修复远山环使用最后一个遭遇点作为中心的问题：仅背景改用图纸边界中点，十五关背景位置不再受最终遭遇点偏移影响，保持 30 个最低 LOD 岩壁实例。原遭遇位置、入口出口与批准图纸保持不变。工作台美术说明现在读取实际装配意图，原平面图阶段的将来时说明仍可在图册对照。

### 第三轮验证、实景与性能

`npm test` **197/197 通过**，`npm run build` 成功，十五份原图纸同步与 `git diff --check` 通过。额外开启本机原件核验的绞盘及三件新道具来源检查 **8/8 通过**。局部遮挡与渲染两份专项共 18 项，另经独立只读代码审查；完整日志见 [全量测试](../art/reviews/authored-scenes-setdressing-20261004/npm-test.log)、[生产构建](../art/reviews/authored-scenes-setdressing-20261004/build.log)、[本机来源核验](../art/reviews/authored-scenes-setdressing-20261004/local-source-test.log)。

十五关浏览器实际碰撞/导航探针均通过。修船槽完成美术→技术白盒→美术切换，DOM 激活计数为 **1→0→1**；其余十四关为 0。[逐关记录](../art/reviews/authored-scenes-setdressing-20261004/browser-all-plans.json) / [切换记录](../art/reviews/authored-scenes-setdressing-20261004/browser-ray-window-lifecycle.json)。真实控制器从中栈补给位置接入中栈到北栈支路，实走 **57.6m / 7.6s**，结束误差 0.3m；无敌开启，敌人正常行动，途中无传送或改速，抵达时检修站四名守卫已激活。它是通行证据，不代表正常战斗胜利。[步行报告](../art/reviews/authored-scenes-setdressing-20261004/browser-art-walks.json)。

| 实际游戏相机 | 本轮实景 |
| --- | --- |
| 井院沿街商棚 | [柜台、储物瓮与巷道](../art/reviews/authored-scenes-setdressing-20261004/desert-2-stall-final.png) |
| 残屋休整院 | [旧货摊与院内掩体](../art/reviews/authored-scenes-setdressing-20261004/desert-3-stall-final.png) |
| 中栈修船坞 | [低护岸、短船与卷扬机](../art/reviews/authored-scenes-setdressing-20261004/frost-3-skiff-final.png) |
| 灰烬卸货口 | [斜停满载渣车与卸货通路](../art/reviews/authored-scenes-setdressing-20261004/inferno-1-cart-final.png) |
| 西岸转运站 | [停运渣车、炉盏与转运出口](../art/reviews/authored-scenes-setdressing-20261004/inferno-3-cart-final.png) |
| 东侧铸模场 | [余渣车与作业炉](../art/reviews/authored-scenes-setdressing-20261004/inferno-4-cart-final.png) |

截图为净视预览，部分使用清理敌人帮助观察；性能另在正常游戏更新、无敌检视下采样。最高实例数从上一轮 413 降为 **412（输渣线 361 + 51 桥板）**，冻湖为 395（337 + 58 桥板）；新道具均沿用分块实例和原 LOD 策略。

生成队列、Blender、测试和构建全部结束后，在本机 **1920×1080 / high**（CSS 1280×720、DPR 1.5）稳定采样：每项 30 帧预热、240 帧记录，均为 playing、零隐藏帧、零 GPU disjoint。

| 场景状态 | FPS | 更新 P95 | GPU P95 |
| --- | ---: | ---: | ---: |
| 输渣线入口探索，0 敌人 | 59.52 | 0.60ms | 7.65ms |
| 接料坪 B 遭遇，4 敌人 | 59.70 | 1.40ms | 8.50ms |
| 冻湖修船坞近景，射击代理激活，0 敌人 | 59.52 | 0.50ms | 11.39ms |

这是三个稳定视角的本机样本，不保证切关或任意战斗状态帧率。修船坞近景的 GPU 开销高于入口，后续增加效果需保留余量。[完整性能报告](../art/reviews/authored-scenes-setdressing-20261004/browser-performance.json)。全量测试并发运行时，4000 次局部射线测得约 0.036ms/次；单文件独立审查约 0.020ms/次，平均均为 131 个三角，已区分测试负载差异。

最终稳定采样之后，浏览器没有新增 error / warn；控制台档案同时保留开发中途的井院摆放失败记录，该处随后已随十五关完成实际验证。[控制台范围说明](../art/reviews/authored-scenes-setdressing-20261004/browser-console.json) / [最终验证汇总](../art/reviews/authored-scenes-setdressing-20261004/verification-summary.json)。检视页停在修船坞观察点，俯视暂停，便于继续检查。

## 第二轮场景细化记录

第二轮在入口、路口和补给区增加各关对应的供坛、储物瓮、工坊设备和炉盏组合；雪地补充疏密不同的雪松。主要地标按角色眼高重排视线，避免正对地标却被前排墙或掩体完全挡住。原平面图、通道宽度、掩体碰撞和遭遇配置继续保留。

### 货运绞盘与房区用途

新增本机 Hunyuan3D 成品 `SM_Env_CargoHoist`，用于驼铃驿街货场、冻湖中岸工坊和输渣线检修场。粗木架、卷筒、手摇轮与厚底座均来自真实生成网格；代码只负责等比摆放。它是静态环境件，尚无绳索牵引或转动功能。累计环境库存从 22 件增加到 **23 件，4,665,260 字节**。

- 概念来自内置 ImageGen：[实际提示词](../art/source/props/SM_Env_CargoHoist/01_concept/CN_SM_Env_CargoHoist_v002_prompt.txt)、[原图](../art/source/props/SM_Env_CargoHoist/01_concept/CN_SM_Env_CargoHoist_v002_source.png)、[注册四视图](../art/source/props/SM_Env_CargoHoist/01_concept/CN_SM_Env_CargoHoist_v002_sheet.png)。注册 v002 保留原像素，修复等列裁切截掉摇柄的问题。
- 本机 Hunyuan3D 2mv：50 steps、CFG 5、octree 384、seed 202610104；[实际工作流](../art/source/props/SM_Env_CargoHoist/02_highpoly/HP_SM_Env_CargoHoist_v001_graph.json)。随后由既有 Blender 管线减面、UV、投影烘焙及制作 LOD。
- 实际 Draco 全 LOD 包络 **3.617899 × 3.405178 × 2.541877m**；5000 / 1600 / 500 三角面，1024² BC/N/ORM，254,532 字节。全部 LOD 使用相同刚体轴心校正，没有程序化补造模型。
- 自动 QA 37 项通过、零错误、零豁免；保留 1 项投影覆盖警告：四视图直接覆盖 48.5% 顶点，其余内侧与底面采用既有扩散补色，细节较简。五视图和 LOD 经 Codex AI 视觉审核，不能代替用户签收。[成品审图](../art/source/props/SM_Env_CargoHoist/05_review/SM_Env_CargoHoist_v002_review_v002.png) / [完整来源、哈希及实际测量](../art/reviews/authored-scenes-detail-20261004/cargo-hoist-summary.json)。

### 地面、灯光与检视

各房区单独指定铺石比例，墙边积沙、积雪与灰烬以宽缓边缘过渡。道路、铺装、沉积和风化共用一张 384² RGBA 蒙版，运行时一次采样，约 576 KiB；冻湖保留冷蓝冰层，输渣隔离带改为不连续热岛与大块冷渣。熔火高/中画质固定使用一盏不投影的近距离炉光，在入口与路口两处实际炉龛间选择距相机较近的一处，以 6 米距离差滞回避免反复切换；低画质关闭。

工作台新增角色眼高的美术观察点及“净视预览”，可以查看地标和小龛的实际构图，Esc 返回工具。净视仅隐藏 UI，战斗仍运行；切回俯视暂停。正常游戏使用同一艺术装配，模型按分块 LOD 和共享实例绘制；最高实例数为输渣线 **362 件建筑/自然/道具 + 51 块桥板 = 413**。

### 第二轮验证与画面

最终 `npm test` **181/181 通过**，`npm run build` 成功，十五份图纸同步检查和 `git diff --check` 通过。检查包含原净空与碰撞不变、三档栈桥连续、实际 Draco 地标可见性、新绞盘体积/来源，以及恒定单灯在两炉龛之间的接管与滞回。

十五关均在浏览器通过实际碰撞/导航探针，并有 6–7 个角色眼高的美术观察点。冻湖主路 **138.1m / 17.8s**、输渣线主路 **166.2m / 21.4s** 由真实控制器完成，无敌开启、敌人正常行动，途中无传送或改速。这是通行证据，不代表正常击败敌人或战斗难度验收。

沙寺旗庭与驿站的实景检查发现技术背板从错位墙端露出，现将支持面收进每块 Hunyuan 墙内部；两个问题视角增加真实三档 Draco 网格射线回归，浏览器最终截图确认穿帮消失。其余主景可见性采用实际网格采样，不能将包络预筛当作可见性证明。部分短边角缝仍在 [全图边界报告](../art/reviews/authored-scenes-detail-20261004/boundary-visibility-eye-all.json) 中保留。

| 最终场景 | 实机截图 |
| --- | --- |
| 驼铃驿街货场 | [绞盘、储物瓮与墙面](../art/reviews/authored-scenes-detail-20261004/desert-2-cargo-final.png) |
| 错门寺城旗庭 | [仪门、铺石与背板修复](../art/reviews/authored-scenes-detail-20261004/desert-4-gate-final.png) |
| 冻湖中岸工坊 | [绞盘、栈桥与积雪地表](../art/reviews/authored-scenes-detail-20261004/frost-3-workshop-final.png) |
| 输渣线检修场 | [货运设备与炉龛暖光](../art/reviews/authored-scenes-detail-20261004/inferno-3-workshop-final.png) |

原始记录：[全量测试](../art/reviews/authored-scenes-detail-20261004/npm-test.log)、[生产构建](../art/reviews/authored-scenes-detail-20261004/build.log)、[十五关浏览器报告](../art/reviews/authored-scenes-detail-20261004/browser-all-plans.json)、[实际步行](../art/reviews/authored-scenes-detail-20261004/browser-art-walks.json)。本轮截图均为游戏相机，不是概念渲染图。

### 第二轮性能记录

生成队列、Blender 与测试/构建全部结束后，在本机 CSS 1280×720、DPR 1.5、实际 **1920×1080 / high** 采样，每项 30 帧预热、240 帧记录。最终单灯版在稳定状态下：输渣线入口 **59.95 FPS，GPU P95 6.15ms**；接料坪 4 名敌人交战 **59.64 FPS，GPU P95 8.87ms**；冻湖入口 **58.61 FPS，GPU P95 7.06ms**。均为 playing、零隐藏帧、零 GPU disjoint。最终浏览器 console 无 error / warn，记录见 [console 日志](../art/reviews/authored-scenes-detail-20261004/browser-console.json)。

完整 [性能 JSON](../art/reviews/authored-scenes-detail-20261004/browser-performance.json) 同时保留初版双灯、关闭炉光、最终单灯和初入场景的样本。初版双灯一次战斗测得 49.07 FPS，关闭炉光测得 60.02 FPS；敌人运动状态自然不同，不能把 FPS 差全部归因于灯光。最终采用固定单灯减半额外点光计算、保持材质灯数稳定，近景暖光通过截图检查。最终单灯刚进入场景时也测到一次 52.62 FPS，稳定后另测 59.95 FPS；不能将稳定样本外推为切关过程或任意交战视角的帧率保证。

## 第一轮批准布局的场景装配记录

用户试玩认可白盒后，十五张独立平面进入第一轮美术装配。通道宽度、分路、掩体碰撞、入口出口和怪物遭遇继续取自 [逐关设计](level-design/README.md)，艺术层沿地面真实轮廓布置本机 Hunyuan 成品，并为各房区指定不同地标、边缘高度与自然/建筑比例。这里记录本次实现和证据，不代表十五关美术已经最终验收。

场景入口为 `http://localhost:5259/whitebox-lab.html?theme=desert&stage=0&look=art`；三章与 `stage=0..4` 对应各章五关。切换 `look=whitebox` 可对照同一布局的技术占位。正常游戏采用这组已批准布局；旧模板记录保留在本文后半部分，不能代替当前场景的验证。

| 章节 | 本轮装配方向 | 用于组织空间的既有成品 |
| --- | --- | --- |
| 沙寺 | 裂隘的折返岩脊、驿街的低货棚与高库门、城防环线、错门院落、偏置仪场分别组织轮廓 | `DesertWall`、`DesertCliff`、`DesertGate`、`DesertRuin`、`DesertSandstone`，配遗碑与陶罐 |
| 霜山 | 林地树冠、折冰长廊的分段标识、冻湖跨岸栈道、内旋禅院、非对称裂厅 | `FrostWall`、`FrostCliff`、`FrostGate`、`FrostWayshrine`、`FrostPine`，配石灯龛与祈愿石 |
| 熔火 | 卸货场的横纵转折、锯齿炉街、双岸输渣通道、三角围场、冷暖双腔 | `InfernoWall`、`InfernoCliff`、`InfernoGate`、`InfernoFoundry`、`InfernoBasalt`，配祭炉与锁魂碑 |

表内环境件前缀均为 `SM_Env_`。房区名称描述空间用途；尚无独立成品的绞盘、船、货箱、工坊设备不因命名而视为已经生成。当前使用已合格墙段、地标和岩块建立这些区域的体量，后续可按实际画面再补必要资产。

原 **21 件 Hunyuan 环境成品**的实际 Draco 各 LOD 包络和发布哈希已核对，见 [库存报告](../art/reviews/authored-scenes-20261004/asset-audit.json)。新增 **1 件厚木栈桥**后共 22 件，GLB 库存合计 4,410,728 字节。建筑实例按源模型全 LOD 包络等比适配，地面与原有碰撞独立；代码负责摆放、材质和技术支撑，美术成品网格仍来自本机 Hunyuan。

### 新增栈桥的生成与发布证据

`SM_Env_TravelDeck` 用于 frost-3 的四段指定栈道，以及 inferno-3 的两处跨岸桥面，没有在其他十三张图普遍铺设。宽木板、厚端面与简洁铁箍遵循已确认的风格化游戏品质方向；四视图先以竖立方式呈现顶面与底面，本机 Hunyuan3D 2mv 生成真实体积后再以刚体旋转放平。

| 环节 | 来源或指标 |
| --- | --- |
| 概念 | 内置 `image_gen`；[实际提示词](../art/source/props/SM_Env_TravelDeck/01_concept/CN_SM_Env_TravelDeck_v002_prompt.txt)、[原始生成图](../art/source/props/SM_Env_TravelDeck/01_concept/CN_SM_Env_TravelDeck_v002_source.png)、[注册四视图](../art/source/props/SM_Env_TravelDeck/01_concept/CN_SM_Env_TravelDeck_v002_sheet.png) |
| 概念版本来源 | [原始 prompt 注册表](../art/pipeline/travel_deck_concept_v001.json)；concept v002 为原像素注册与厚度参考校正，并非第二张 AI 重绘 |
| 本机高模 | Hunyuan3D 2mv checkpoint `hunyuan3d-dit-v2-mv_fp16.safetensors`；50 steps、CFG 5、octree 384、seed 202610090；[实际 ComfyUI 工作流](../art/source/props/SM_Env_TravelDeck/02_highpoly/HP_SM_Env_TravelDeck_v001_graph.json) |
| 游戏成品 | Blender 减面、UV、投影/烘焙、LOD；5000 / 1600 / 500 三角面，1024² BC/N/ORM，单材质，Draco + WebP |
| 发布 | [141,304 字节 GLB](../public/assets/props/SM_Env_TravelDeck.glb)，blockout v002 / concept v002 / highpoly v001 / build v002 |
| 审核 | 37 项自动检查通过，无错误、警告或豁免；[最终五视图与 LOD 审查图](../art/source/props/SM_Env_TravelDeck/05_review/SM_Env_TravelDeck_v002_review_v001.png) 经 Codex AI 视觉审核；不是用户成品签收 |

完整输入/输出哈希、manifest、保留的首次失败记录与发布审核见 [栈桥汇总](../art/reviews/authored-scenes-20261004/travel-deck-summary.json)。首次构建只有落地基准偏差；修正版对所有 LOD 做相同刚体平移，未程序化补造艺术网格。

实际源体积为 **5.516021 × 0.734755 × 3.881925 米**（宽/高/深）。铁件高于木面，桥面定位采用中央木面 `Y≈0.610`，以 `floorY + 0.01 - 0.610 × scale` 作为实例底面。每 LOD 中央 81 点检查未发现孔洞，单 LOD 顶面高差小于 2 毫米。铺板保持等比缩放，原地面继续承担移动碰撞，没有新增跳跃条件。模型来源与中央表面检查：`node --test tests/travel-deck.test.mjs`，两项通过。

### 当前验证边界

场景边界使用 [实际网格采样工具](../art/tools/audit_authored_boundary.mjs) 复查：在地面外缘内 0.4 米、视高 1.2 米，每段最多间隔 2 米向外发射射线，实际命中 Draco LOD1 三角面；包络只负责预筛。保留 [修复前基线](../art/reviews/authored-scenes-20261004/boundary-visibility.json) 和 [最终十五关结果](../art/reviews/authored-scenes-20261004/boundary-visibility-all.json)，源文件 SHA 可识别所测版本。该结果帮助定位看似可走却有碰撞的低位缺口；不包含技术背板，不是所有高度与角度的遮挡证明。

复跑：`node art/tools/audit_authored_boundary.mjs --plans desert-1,frost-3,inferno-3 --height 1.62 --out art/reviews/authored-scenes-20261004/boundary-visibility-eye.json`。全部地图见 [眼高复查](../art/reviews/authored-scenes-20261004/boundary-visibility-eye-all.json)。旋转护岸按真实包络多边形避让已批准可走区；三张重点图的眼高采样未命中长度约为 1.47% / 2.96% / 2.25%，剩余主要是短折缝和模型端角，后续仍可继续修整。比较地图时采用报告中的边界长度加权值。

### 本轮实机与性能记录

`npm test` **172/172 通过**，`npm run build` 通过，十五份运行时图纸与原 JSON 同步。新增检查包含艺术包络不侵入通路、完整掩体高度、真实网格边缘射线、三个 LOD 桥面连续性、材质资源释放及异步加载后的卸载安全。日志位于 `art/reviews/authored-scenes-20261004/`。

十五关均已在浏览器载入艺术版并通过碰撞/导航探针，最终检查页无 console error / warn。冻湖三栈美术/白盒切换后的探针结果一致。真实控制器在无敌检视中走完冻湖主路 **137.9m / 17.8s**、输渣线主路 **166.3m / 21.5s**；怪物照常激活，途中没有传送或改速度。这证明所测路线能走通，不代表正常战斗已通关或难度平衡。

冻湖仅改变桥外底面为冷蓝冰湖；输渣线根据两岸房区限制暗熔渣河带。其他十三图没有套用这两种地理材质。全部可走地面和碰撞仍保持原方案。

性能为单次本机实测：CSS 1280×720、DPR 1.5、实际 **1920×1080 / high**，每项 30 帧预热、240 帧记录；均为 playing、零隐藏帧、零 GPU disjoint。模型最多的是输渣线，355 个建筑/自然实例加 51 块桥板，使用共享网格与分块 LOD。

| 场景 / 状态 | RAF FPS | RAF P95 | GPU P95 |
| --- | ---: | ---: | ---: |
| 输渣线入口探索 | 60.02 | 16.8ms | 5.51ms |
| 输渣线主路末端，4 名活跃敌人 | 60.01 | 16.8ms | 7.82ms |
| 输渣线接料坪近战，4 名活跃敌人 | 59.77 | 16.7ms | 7.57ms |
| 冻湖入口探索 | 60.02 | 16.7ms | 6.52ms |

记录：[十五关探针](../art/reviews/authored-scenes-20261004/browser-all-plans.json)、[艺术版实走](../art/reviews/authored-scenes-20261004/browser-art-walks.json)、[完整性能报告](../art/reviews/authored-scenes-20261004/browser-performance.json)。这是指定场景短时采样，不外推所有交战视角或长时间帧率；以下旧批次的 FPS 和测试数量仅作历史记录。

## 前序九件建筑资产批次记录

以下保存此前在手绘地标和自然件基础上追加九件建筑资产的记录。该批目标是接近《枪火重生》的大平面、简洁轮廓、手绘色块、冷暖分区和第一人称构图，保留本项目的半开放探索路线与三章主题。

九件新资产均已由本机 Hunyuan 生成、检查并发布。实际版本和来源哈希见 [资产汇总](../art/reviews/gunfire-scenes-20261004/asset-summary.json) 与 [最终清单](../art/reviews/gunfire-scenes-20261004/after-manifest.json)；最终实机验证见本文末尾，不使用上一轮结果替代本轮结论。

## 官方视觉参考

已实际查看下面的官方画面，并与本项目上一轮三章 `*-after.png` 对照。链接指向官方主页面或其原图；观察来自画面，具体色值、尺寸与验收规则是本项目的实现选择。

| 参考 | 画面观察 | 本轮采用的方向 |
| --- | --- | --- |
| [官方站沙漠实机原图](https://image.yijoys.com/qh_en/web02/img/media/11-526ff72787.jpg)，来源：[Gunfire Reborn 官方站](https://gfr.yijoys.com/en/) | 连续砂岩断墙、右侧屋檐、中央横桥和木坡形成前中后景；暖亮沙地与宽岩面占主画面 | 墙段与门楼连接成短街、侧路院墙和目的地返墙，减少孤立地标的展台感 |
| [Steam 沙漠实机原图](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1217060/ss_fa14b2f27eceb1a4cdd2269cd90b653fb1573296.1920x1080.jpg?t=1789092024)，来源：[Steam 主游戏](https://store.steampowered.com/app/1217060/Gunfire_Reborn/) | 巨大棱角砂岩、暖黄地面、棕紫阴影，环境细节集中在大平面和少量阶层 | 增加宽厚巨崖，避免边界只由等距小石簇和薄片砂岩重复组成 |
| [官方雪地 DLC 实机原图](https://shared.steamstatic.com/store_item_assets/steam/apps/3063250/ss_5d6b74330ca17040d5bd4d51c9c8e70719d610ea.1920x1080.jpg?t=1726629419)，来源：[Realm of Frost and Inkwash](https://store.steampowered.com/app/3063250/Gunfire_Reborn__Realm_of_Frost_and_Inkwash/) | 连续蓝白雪坡、简洁斜角石壁、木箱掩体和远处栈道望楼；暖灯只占小面积 | 雪墙、宽山门、覆雪巨崖与稀疏松树组成冷蓝主景，红木和灯火作为局部焦点 |
| [Steam 古墓场景原图](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1217060/ss_b489e3c646b594f7c1a066a4657cad1006468050.1920x1080.jpg?t=1789092024)，来源：[Steam 主游戏](https://store.steampowered.com/app/1217060/Gunfire_Reborn/) | 高柱、梁、墙面连续围合；宽而少的雕刻、冷蓝石构和暖橙门口构成明暗层次 | 熔火章借用冷暗石构与集中暖光的视觉语言，保留本项目的炉场主题 |

本项目的 Inferno 是熔火主题变体；本轮参考用于统一其建筑尺度、色块与灯光语言，未将它描述为原作的同名章节。原图曾在浏览器中实际查看，但没有保存独立的本地官方参考截图；最终交付画面须使用本项目真实运行截图。

## 本轮场景构成

新增资产清单为三章各一件墙段、门楼和巨崖，共九件。墙段承担连续围合与转角，门楼提供真实的地面通行负空间，巨崖承担更大的区域边界和中远景岩墙。沿用此前已发布的残垣、雪亭、祭炉、砂岩、雪松和玄武岩作为地标与小尺度陪衬。

`AdventureGen` 已加入入口门楼与两侧短街、北侧路线门楼、外侧路线背墙、补给点短返墙和祭坛两翼。布局根据真实预留、路宽和交互空间筛选，入口与北环各保留一道门；被预留空间拒绝的返墙保持开放。现有 84×84 区域、双循环主路、三个可选补给点和祭坛流程继续使用。雪松按实际树根与冠幅选择安全位置，不能用配置中的数量上限代表最终树数。

`SceneArchitecture` 只加载发布艺术资产，按 18 米空间块实例化，共享几何、纹理和场景材质副本，并冻结静态矩阵。高／中画质的墙从 LOD1 开始、门保留 LOD0，门在 20 米切中级，最远级在 44 米切换；低画质直接使用最远级，切换带 12% 迟滞。`AdventureTerrain` 已接入三件已发布巨崖；资产异步加载期间沿用已发布的 Hunyuan 自然件，加载完成后替换。

`SceneBackdrop` 同样优先使用本章真实巨崖的最远 LOD，沿用固定 30 个远景实例，无投影、灯光或碰撞。加载期间保留旧已发布 Hunyuan 岩石，换源时只释放场景自有实例和材质，不释放资产库的几何与贴图；已销毁场景不会因回调复活。远景参数在构造时固定，异步换源不改变随机序列；根据真实网格包络居中、落地并保证宽巨崖的水平占地仍在可玩区外。FrostCliff 使用其原画雪面，不套旧玄武岩的纯色积雪覆盖。最终画面与性能见下方实机记录。

## 艺术资产来源与当前状态

九件资产均采用内置 `image_gen` 四视图概念与本机 ComfyUI / **Hunyuan3D 2mv** 形体生成流程。艺术网格来自 Hunyuan；没有创建程序化艺术模型替代。尺寸参考阶段仅建立数值包络与相机 JSON，登记 `reference_mode=bounds_only`、`geometry_created=false`。Blender 只做技术清理、减面、UV、投影、烘焙和 LOD；运行时变换、碰撞盒、纹理调色与实例摆放不新增艺术网格。

完整概念记录见 [architecture_concepts_v001.json](../art/pipeline/architecture_concepts_v001.json)、[architecture_concepts_v002.json](../art/pipeline/architecture_concepts_v002.json)、[architecture_concepts_v003.json](../art/pipeline/architecture_concepts_v003.json)、[cliff_concepts_v001.json](../art/pipeline/cliff_concepts_v001.json) 和 [cliff_concepts_v002.json](../art/pipeline/cliff_concepts_v002.json)。原图、配准输入、图谱、阶段版本与文件哈希保存于各资产的 `art/source/props/<ID>/asset.json` 和阶段目录；审核者明确登记为 **Codex AI visual review**。

九件均使用三档 **5000 / 1600 / 500** 三角预算、1024² BaseColor / Normal / ORM、单材质和每件 900 KiB 上限。

| 资产 | 最终状态 | concept / 高模 / build | 已发布包大小 B | 校验警告 / 错误 |
| --- | --- | --- | ---: | --- |
| SM_Env_DesertWall | 已发布 | v001 / v001 / v001 | 196,708 | 0 / 0 |
| SM_Env_FrostWall | 已发布 | v001 / v001 / v001 | 281,208 | 1 / 0 |
| SM_Env_FrostGate | 已发布；最终门洞报告 v002 通过 | v002 / v001 / v001 | 261,588 | 2 / 0 |
| SM_Env_InfernoWall | 已发布 | v001 / v001 / v001 | 184,336 | 0 / 0 |
| SM_Env_DesertGate | 已发布；build v002 门洞报告通过 | v002 / v002 / v002 | 245,308 | 0 / 0 |
| SM_Env_InfernoGate | 已发布；build v001 门洞报告通过 | v002 / v001 / v001 | 234,440 | 0 / 0 |
| SM_Env_DesertCliff | 已发布 | v001 / v001 / v001 | 185,556 | 1 / 0 |
| SM_Env_FrostCliff | 已发布，透明参考保留完整雪盖 | v002 / v001 / v001 | 158,796 | 1 / 0 |
| SM_Env_InfernoCliff | 已发布 | v001 / v001 / v001 | 181,000 | 2 / 0 |

九件合计 **1,928,940 字节（约 1.84 MiB）**。实际均为单材质、三张 1024² PBR、5000 / 1600 / 500 三角形；FrostWall LOD0 为 4998。七项警告完整保留，零错误、零预算或 QA 豁免；发布 GLB 实读哈希与审核后的导出一致。

霜山巨崖的白底 concept v001 在配准抠像时损失了白色雪盖，被拒绝用于三维生成；采用内置 ImageGen 仅去除背景，得到真透明 concept v002，完整雪盖通过四视图检查后送入 Hunyuan。重试提示词、设计提示词和原生输出保存于 [cliff_concepts_v002.json](../art/pipeline/cliff_concepts_v002.json)，原始编辑参考、提示词与哈希随资产登记。原白底参考继续留档，没有手工补面或程序化雪盖。

## 门洞失败与净空校准

沙寺门楼 build v001 的普通模型 QA 不能证明门洞可用。对实际全部 LOD 三角形进行完整深度的开口盒裁剪后，源模型在目标高度的居中净宽仅 5.74–5.78 米，运行时约 6.60–6.65 米，未达到所需通路；因此拒绝运行时使用，原成品、输入、报告和哈希保留。记录见 [DesertGate v001 拒绝报告](../art/source/props/SM_Env_DesertGate/05_review/SM_Env_DesertGate_v001_aperture_rejection_v001.json)。随后通过更宽的 concept v002 重新运行本机 Hunyuan，没有切除、拉伸或程序化补建门柱。

沙寺门楼 build v002 的 [门洞报告](../art/source/props/SM_Env_DesertGate/05_review/SM_Env_DesertGate_v002_aperture_v001.json) 已确认源模型 6.4×3.8 米与运行时 7.68×4.56 米所需开口在三档 LOD 中均为空，侵入三角形数为零；19:11:56 已完成发布。

霜山门楼实际屋顶厚于原参考。早先均匀缩入过薄的参考包络会同时缩小门洞；当前统一使用全部 LOD 的联合包络、真实高度和厚度，先按 10.5 米包络宽度等比 fit，再统一 1.2 倍摆放（运行时外宽 12.6 米），保持比例、落地及统一轴心。构建网格没有修改。[FrostGate 门洞报告 v002](../art/source/props/SM_Env_FrostGate/05_review/SM_Env_FrostGate_v001_aperture_v002.json) 已确认源模型所需 6.4×3.8 米、运行时所需 **7.68×4.56 米** 的贯通开口：LOD0 / LOD1 / LOD2 均无侵入三角形。早先失败的 fit 报告 v001 继续留档，QA 与预算豁免均为零。

熔火门楼 build v001 的 [门洞报告](../art/source/props/SM_Env_InfernoGate/05_review/SM_Env_InfernoGate_v001_aperture_v001.json) 也已确认上述源与运行时开口在三档 LOD 中均无侵入三角形；19:14:55 已完成发布。

## 配色、地面与氛围

沙漠地面改暖赭沙色，铺地更亮，远景为暖灰砂岩；尘埃使用低透明度普通混合并横向飘动，减少高反差静止星点。雪地以蓝白雪与浅蓝露石为主，雪面降低细碎闪粒与光泽，红木、灯火保留为局部焦点。熔火地面、雾与背景改为冷蓝紫灰，暖橙集中在炉和火盆；余烬数量与亮度降低。

地表继续复用已有 ImageGen 石材原图和 512px 纹理。浅色覆盖统一石纹与章节色块，减少细小斑点和裂纹；地面粗糙度保持哑光。道路仍使用既有 **512×512 R8 蒙版和一次采样**，路外积沙、积雪和灰烬继续沿用大尺度顶点明暗。雪平台复用已有石材采样产生低对比变化，避免纯白平板感。本轮没有增加动态灯、后处理、粒子数量、替代艺术网格或地表绘制调用。

## 最终验证

九件最终发布后，全量 `npm test` **114/114 通过，零跳过、零失败**；`ART_LOCAL_SOURCE_AUDIT=1 node --test tests/gunfire-assets.test.mjs tests/nature-scene.test.mjs` **18/18 通过，零跳过、零失败**。`npm run build` 和 `git diff --check` 通过。原始日志：[全量测试](../art/reviews/gunfire-scenes-20261004/npm-test.log)、[本机源资产审计](../art/reviews/gunfire-scenes-20261004/source-audit.log)、[生产构建](../art/reviews/gunfire-scenes-20261004/build.log)。

检查实际发布 Draco 网格的三档 LOD、1024² 纹理、单材质、哈希、来源图谱与预算；三章门洞按全深度三角形裁剪验证，四个方向均保留所需通路。建筑与巨崖采用真实联合包络，所有级别统一轴心、落地和等比尺度；验证共享几何及贴图不会被场景释放。远景旧源换新、真实巨崖占地和销毁后回调也通过检查。测试夹具的简化几何只用于生命周期验证，不导出为艺术资产。

宽巨崖接入后发现入口门柱被近处岩块遮住，现将入口门楼移到 `(-8.5, 10)`，同时预留完整门楼包络和两侧柱脚视线；散石选择避开预留。北侧门楼周围的边界岩块按原径向向外避让，保持边界环和路线，不删除门柱或岩墙。三章默认与 360 个种子共 **363 个布局**，完整门楼与岩块至少留 0.2 米间隔，入口柱脚可见，出生区和门洞物理通行通过；另有 360 个布局的连通与边界封闭检查、120 个种子的双路线通行检查。雪松按实际根部和冠幅留空；各布局保留 4–8 棵，不用数量上限代表最终摆放结果。

三章已在固定种子 `20261004`、相同检视预设、距离 20、暂停播放下逐一检查入口、主景、补给支路、祭坛和全景。入口机位眼高约 1.7 米；其余机位用于构图检视，不能全部称为玩家眼高。祭坛机位根据实际碰撞包络自动避开岩壁，因此霜山祭坛最终角度与早期截图不同。真实游戏性能使用独立的 `adventure-lab`、真实 Game 和第一人称绘制。

| 章节 | 入口 | 主景与前态 | 支路 | 祭坛 | 全景 |
| --- | --- | --- | --- | --- | --- |
| 沙寺 | [最终入口](../art/reviews/gunfire-scenes-20261004/desert-entry-after.png) | [前态](../art/reviews/gunfire-scenes-20261004/desert-before.png) / [最终](../art/reviews/gunfire-scenes-20261004/desert-after.png) | [补给点](../art/reviews/gunfire-scenes-20261004/desert-site-after.png) | [祭坛](../art/reviews/gunfire-scenes-20261004/desert-objective-after.png) | [全景](../art/reviews/gunfire-scenes-20261004/desert-overview-after.png) |
| 霜山 | [最终入口](../art/reviews/gunfire-scenes-20261004/frost-entry-after.png) | [前态](../art/reviews/gunfire-scenes-20261004/frost-before.png) / [最终](../art/reviews/gunfire-scenes-20261004/frost-after.png) | [补给点](../art/reviews/gunfire-scenes-20261004/frost-site-after.png) | [祭坛](../art/reviews/gunfire-scenes-20261004/frost-objective-after.png) | [全景](../art/reviews/gunfire-scenes-20261004/frost-overview-after.png) |
| 熔火 | [最终入口](../art/reviews/gunfire-scenes-20261004/inferno-entry-after.png) | [前态](../art/reviews/gunfire-scenes-20261004/inferno-before.png) / [最终](../art/reviews/gunfire-scenes-20261004/inferno-after.png) | [补给点](../art/reviews/gunfire-scenes-20261004/inferno-site-after.png) | [祭坛](../art/reviews/gunfire-scenes-20261004/inferno-objective-after.png) | [全景](../art/reviews/gunfire-scenes-20261004/inferno-overview-after.png) |

画面验收：沙寺保留暖赭沙地、青绿门梁和大片砂岩；霜山为完整白雪盖、冷蓝岩壁和局部红木；熔火为冷紫石构与少量橙火焦点。连续墙段、门楼与宽崖形成前中后景，原半开放支路和祭坛仍可辨认、可到达。

## 本轮实机性能

全部 Hunyuan、Blender、测试和构建工作结束后采样，ComfyUI 队列空闲；自有场景检视页暂停。真实 Game、固定种子 `20261004`、默认狐／蜂鸣冲锋枪，CSS 1280×720、DPR 1.5，实际绘制 **1920×1080，high**。每项先预热 30 帧，再锁存 240 帧，非阻塞 GPU 计时各 35 次。以下是九件新资产全部接入后的本轮结果。

| 场景与原始记录 | RAF FPS | RAF P95 ms | 更新平均 ms | 渲染提交平均 ms | GPU 平均 / P95 ms | 双场景 calls / triangles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [沙寺探索](../art/reviews/gunfire-scenes-20261004/desert-exploration.json) | 60.02 | 16.8 | 0.18 | 1.65 | 5.51 / 6.50 | 109.5 / 188,261 |
| [霜山探索](../art/reviews/gunfire-scenes-20261004/frost-exploration.json) | 60.02 | 16.8 | 0.16 | 1.85 | 6.98 / 7.67 | 125 / 202,423 |
| [熔火探索](../art/reviews/gunfire-scenes-20261004/inferno-exploration.json) | 60.02 | 16.8 | 0.19 | 1.88 | 4.99 / 5.62 | 109 / 184,135 |
| [熔火祭坛 Q／E 战斗](../art/reviews/gunfire-scenes-20261004/inferno-combat.json) | 59.77 | 16.8 | 0.92 | 2.46 | 6.56 / 7.42 | 98.2 / 172,666 |

四项 `hiddenFrames=0`、GPU `disjointEvents=0`，无浏览器警告或错误。战斗采样在祭坛真实第 1 波、3 名存活敌人时触发 Q／E，后续实机截图为第 2/4 波、5 名敌人：[游戏截图](../art/reviews/gunfire-scenes-20261004/inferno-combat.png)、[截图时状态](../art/reviews/gunfire-scenes-20261004/inferno-combat-state.json)。该结果覆盖本机上述探索与技能战斗负载，不是任意分辨率、敌人数或同时运行生成任务时的固定帧率保证。

前态与最终清单、十五张场景机位截图、性能 JSON 和日志都保存在 `art/reviews/gunfire-scenes-20261004/`。历史迭代、此前实测和失败记录继续见 [scene-stylization.md](scene-stylization.md)、[scene-landmarks.md](scene-landmarks.md)、[adventure-map.md](adventure-map.md) 和 [performance.md](performance.md)。
