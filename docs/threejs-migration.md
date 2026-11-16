# Unity → Three.js 全量迁移计划（2026-11-15）

用户原话（2026-11-15）：「把 unreal 的代码删除，把 unity 完全迁移到 threeJS 里，要使用 threeJS 一比一还原 unity 所做的。」

本文是总计划：决定、现状盘点、数据管线、分期与进度、已知问题。和 [unity-parity.md](unity-parity.md)（2026-10-20，Three.js → Unity 方向）正好相反：这一次 **Unity 是规格，网页照着还原**。

路径缩写：`G/` = `unity/Assets/Game/Scripts/`，`P/` = `unity/Assets/Pipeline/`，`S/` = `scripts/unity/`。

---

## 1. 决定

1. **Unreal 删除**。`unreal/`、`scripts/unreal/`、`tests/unreal-*.test.mjs` 从未入库，2026-11-15 已移到回收站；`art/README.md` 里未提交的「UE 分支」一段撤掉。文档里指向 Epic 官方资料的参考链接（关卡白盒、骨骼挂点、Two Bone IK）保留，那不是 Unreal 代码。
2. **Unity 工程保留，作为规格和数据源**。网页是运行时；Unity 里能导出的东西（场景、定义表、导航网格、遭遇编排）一律导出，不在网页里手抄一遍。
3. **数值以 Unity 为准**。TS 里已有的系统如果 Unity 改过数值或机制，按 Unity 改；Unity 照 TS 移植过去、数值相同的部分只做对照检查，不重写。
4. **逻辑逐文件翻译**。导不出来的行为（AI 状态机、首领招式、导演、镜头手感）照 C# 一个文件一个文件译成 TS，保留原来的常量、时序和分支；Unity 引擎能力按第 5 节的对照表换成 Three.js / Web 的等价物。
5. **不迁的东西**：
   - `GunfireOriginal*`（`G/Weapons/GunfireOriginal*.cs` 和 `Library/GunfireBundles`）：从商业游戏包里提取的原作武器模型、动画和枪口特效，不往网页里扩。网页武器用本项目自己的 `public/assets/weapons/SK_Weapon_<Id>.glb`。
   - Unity 编辑器工具（`P/Editor/**` 里的关卡生成器、QA、截图）：它们是做内容的工具，产出物经导出器进网页。
   - Unity 测试本身；其中的对照断言改写成 `node --test`（第 7 节 M13）。

## 2. 现状盘点（2026-11-15）

Unity 运行时约 29 万行 C#（1167 个文件，含测试与编辑器工具）；网页 `src/` 约 16 万行 TS。三份子系统盘点的结论：

**Unity 本来就是照 TS 移过去的，大块数值一致**——第一到三章 31 种敌人的 hp/护甲/护盾/速度/伤害逐个相同；18 把武器主数值相同；29 个词条、10 个传说、118 卷秘卷、10 个天赋、元素状态与反应、碎刃逻辑、移动手感常量、掉落与商店价格都相同。这部分只做对照。

**真正的空缺**（按体量排）：

| 空缺 | Unity 规模 | 网页现状 |
|---|---|---|
| 首领：旱魃（三阶段、日晒 / 阴影机制、日轮、泉眼、日蚀…） | 4.8k 行 | 未入库的 `bosses/Hanba.ts` 只有横扫 / 热风 / 裂地三招 |
| 首领：魔将 v2（重甲剑士：连斩、居合、剑气、突刺、回旋、蓄势）| 3.1k | `Warlord.ts` 是旧熔岩魔将 |
| 首领框架：难度档、破韧条、阶段、狂暴、召唤上限、击败演出、领主缩放 | 4.4k | `BossBase.ts` 只有阶段 |
| 首领登场镜头（代码驱动机位、黑边、跳过、慢放仲裁） | 2.0k | 无 |
| 每局路线：图池洗牌、备选图 1-A / 2-A / 3-A、补给营钉章末、具名随机流 | 0.9k | 线性 14 关 |
| 走法变体 LevelLayout、战斗导演 CombatDirector、入场点 MonsterEntry | 0.8k | 无 |
| 遭遇 v2：刷怪方式（伏击 / 余烬 / 熔岩爬出 / 飞入 / 跃下 / 闸门）、路遇埋伏、N 选 M 目标、第三章编队 G01–G14、灵坛 | 4.6k 中约一半 | 核心有，以上全无 |
| 敌人框架增量：韧性 / 硬直、命中区、栖点、群协调、精英重击、变体、龙卷词缀、沙魇 | ~3k | 无 |
| 地图机关：熔岩闸 / 间歇泉、流沙、地表区、边界区、可破坏物、断桥、风场、各图专属脚本（冰锥、炉井、铸坊风门、火神王座、折多） | ~6k | 只有平台 / 水 / 机关 |
| 灵宠（8 只，稀有度、灵契升级、跟随、攻击 / 被动 / G 技能、跨关携带） | 4.1k | 无 |
| 第一人称持枪手感：弹簧跟随、前臂 IK、挂点、每把枪重量摆动、瞄具 | 2.4k | 旧手绘挂点表 |
| 镜头手感：trauma² 震屏、重击加踢、FOV 分层、卡帧、清场慢放 | 0.8k | 旧指数衰减震屏 |
| 喷火器改锥形扫描、冲刺禁射、散布手调值 | 小 | 旧版 |
| 第四章：三领主并进首领框架、九种高原敌并进主敌人框架（穷奇 HP 1100 → 423） | 9k | 独立的 `world/plateau/play/*` |
| UI / 特效 / 音频 / 渲染 / 角色动画 | 见第 6 节 | 见第 6 节 |

## 3. 数据管线：Unity → 网页

```bash
npm run unity:web:maps      # = bash scripts/unity/bridge.sh webexport（要 Unity 编辑器）
npm run unity:web:publish   # = node scripts/unity/optimize-web-levels.mjs（不要 Unity）
```

```
Unity 编辑器 ──bridge.sh webexport──▶ public/assets/unity-levels.next/   （原样导出，约 2.2 GB，Git 忽略）
                                        │
                     node S/optimize-web-levels.mjs
                                        ▼
                                   public/assets/unity-levels/        （发布目录，入库，约 340 MB）
Unity 编辑器 ──bridge.sh webgameplay──▶ public/assets/unity-gameplay/defs.json
```

- `WebSceneExporter`（`P/Editor/`）每关写一份场景文档：渲染件（网格 + 材质）、碰撞体、地形高度场与 splat、导航网格、环境（雾 / 环境光 / 太阳 / 天空盒 / 灯）、遭遇（波次、锚点、条件、奖励）、出口、宝箱、营地、首领场、平台、水体、机关、植被、草皮，并顺手生成 `src/world/UnityStages.ts`。
- 发布步骤 `optimize-web-levels.mjs`（`bridge.sh webpublish` 的整份拷贝已停用，`ExportAll` 也不再顺手拷贝）：
  - 地形 GLB 只留材质。几何体在运行时由高度场重建（`UnityTerrainMesh.ts`），原样导出里 1025² 顶点的地形网格从来不画，单张 56 MB，共 855 MB。
  - 其余网格的顶点 / 索引缓冲走 `EXT_meshopt_compression`（无过滤器，逐字节无损，1.25 GB → 110 MB）；碰撞网格去掉用不到的法线和 UV。网页加载器挂 `MeshoptDecoder`。
  - 贴图 PNG → WebP（`S/webp_textures.py`）：颜色 q90；地形 splat 无损；**法线贴图先解包再 q95**（见第 8 节第 1 条）。
  - `--check` 只核对发布目录是不是由当前原样导出生成的。
- 网页侧：`src/world/Unity*.ts` 读场景文档并搭场景（`UnitySceneView`）、碰撞（`Collision.ts` 高度场 + 三角网格）、导航（`UnityNavMesh.ts` A*）、关卡流程（`UnitySceneAdapter.ts` → `StageDirector`）。检视页 `unity-map.html?map=1-1`（`build:labs`）。

## 4. 分期与进度

状态：✅ 完成 · 🔶 进行中 · ⬜ 未开始。每一期做完就提交推送；跨期共用的文件（`core/Game.ts`、`core/types.ts`、`world/StageDirector.ts`）由主会话合并。

| 期 | 内容 | Unity 规模 | 状态 |
|---|---|---|---|
| M0 | 删除 Unreal | — | ✅ 2026-11-15 |
| M1 | 场景：14 张主线图的几何、碰撞、导航、环境、遭遇锚点、平台、水、机关进网页；发布瘦身；法线修正 | 导出器 1.1k | 🔶 见 4.1 |
| M2 | 数据桥：导出器改 Newtonsoft 整份序列化（✅ 2026-11-16，`defs.json` schema 2：武器的 `spreadTuned` / `projectile` / `blade` / `innate`、首领 `tiers` / `phases` / `forms` / `hitZones`、敌人 `ai` / `role` / `rank` / `element` 都在，枚举写名字）。Unity 已冻结，不做运行时覆盖：一次性把 TS 定义表对齐 `defs.json`，再加对照测试锁住；持枪手感 / 词条 / 灵宠表随各自的期补导 | 0.1k | 🔶 |
| M3 | 局流程：RunPlan / RunRoute / RunRng / RunState / EconomyConfig，图池洗牌 | 0.9k + 0.3k | ⬜ |
| M4 | 遭遇与导演：EncounterSite v2、LevelLayout、CombatDirector、MonsterEntry、RewardScale | 4.4k | ⬜ |
| M5 | 敌人框架增量 + 沙魇 + 第四章敌人并入主框架 | ~8k（多数是对照） | ⬜ |
| M6 | 首领框架 + 登场镜头 + 旱魃 + 魔将 v2 + 鲲鹏 / 麒麟数值阶段 + 三领主 | ~20k | ⬜ |
| M7 | 地图机关：熔岩 v2、流沙 / 地表 / 边界 / 可破坏 / 断桥 / 风场、天气、各图专属脚本 | ~10k | ⬜ |
| M8 | 玩家与战斗增量：战斗契约（灵宠伤害源、弱点倍率、命中区）、状态（寒意 / 引燃 / 日灼，带电随第四章）、弹体（弱点判定、护罩、落地滚动）、镜头手感 / 卡帧 / 安全落点 / 移动特效、武器（散布手调、冲刺禁射、喷火锥、磁轨光束）、技能（施法姿势、特效换风格） | ~12k | ⬜ |
| M9 | 灵宠（全新） | 4.1k | ⬜ |
| M10 | 第一人称持枪手感 + 碎刃表现 | 5.8k | ⬜ |
| M11a | 渲染观感：StylizedLit / Terrain / Foliage / Fur 着色、材质参数导入、后处理栈、三色环境光 / 雾 / 天空、CSM | 7.6k 着色器 | ⬜ |
| M11b | 特效核心：预设 JSON + 粒子引擎、线条、灯光池、贴花、预警圈、溶解、状态皮肤（首领专属特效随 M6） | 5k + 6.4k | ⬜ |
| M11c | 界面：USS → CSS、四层路由、字体、约 10 个新界面、HUD 部件重做 | 13.5k | ⬜ |
| M11d | 核心：存档迁移、续玩、时间仲裁、卡帧、模态栈、画质档、剔除 | 7.6k 中约一半 | ⬜ |
| M11e | 音频：改播烘好的 ogg + WebAudio 总线 | 1.3k | ⬜ |
| M12 | 动画：native-anim → AnimationClip、Blender 片段导 GLB、控制器状态机与事件、CreatureRig | 1.8k 运行时 | ⬜ |
| M13 | Unity EditMode 对照测试 → `node --test` | — | ⬜ |

依赖：M2 → M3 → M4；M5 → M6；M8 → M9；M10 依赖 M12 的武器挂点命名；M7 依赖 M1 的体积导出。M11 / M12 可与玩法并行。

### 4.1 M1 细项

- ✅ 接手 2026-11-08 的半成品：导出器（`WebSceneExporter.cs` / `WebGameplayExporter.cs` / `PipelineBridge` 三条命令）、`src/world/Unity*.ts`、`StageDirector` 异步载入 Unity 场景、`RunPlan` 改成 Unity 的 14 关、`Game.ts` 换 `UnityNavigation`、检视页、8 份 `tests/unity-*.test.mjs`。
- ✅ 发布瘦身（2.2 GB → 约 340 MB）与法线贴图修正。
- ✅ 重新导出（2026-11-16，批处理模式，16 分钟）：带上 11-08 之后一周的 Unity 改动；三张备选图 1-A / 2-A / 3-A 进清单（`pool: true`）和场景目录，不进 `UnityStages.ts` 主线表。原样 2.5 GB → 发布 390 MB。
- ⬜ 导出器补：LevelLayout 变体（现在编辑态导出可能把各走法的出生点 / 出口混在一起）、MonsterEntry、PerchPoint、SpawnAnchor 的 mode / from、熔岩 / 闸 / 间歇泉、流沙、地表区、边界区、可破坏物、风场、灵坛、传说碑、关卡目标。
- ⬜ 场景文档里的高度场 / 草皮密度 / 植被实例（4-3 一份 26 MB）拆成按内容寻址的二进制文件：重导出时地形没变就不产生新数据。
- ⬜ 天空盒立方体贴图是 HDR，导出器 Blit 进 ARGB32 会截断高光。
- ✅ 接上空气透视 / 云影层（`src/world/Atmosphere.ts`，「游戏场景搭建」会话做的网页独有层，用户 2026-11-15 定的「全部迁移到 Three.js、不必落到 Unity」）：`UnityEnvironmentView` 在雾 / 环境光 / 太阳建好后 `Atmosphere.bind`，每帧 `update(t)`，卸载时 `unbind`；Unity 自写着色器（水、熔岩 / 流体）挂上它的共享 uniform；低雾基准高度取最低水面，没有水取导航网格顶点高度的 5% 分位；接上后线性雾起点推到 ≥ 120 m（终点不动）。网址带 `atmosphere=0` 关掉，看 Unity 原样的雾。这是在 Unity 规格之上**有意加的一层**。
- ✅ vite 开发服务器不再监视 `gunfire-reborn-replica/`（指向另一块盘上整个 Unity 工程的符号链接，chokidar 会跟进去）、`Library/`、`logfile/`、`public/assets/unity-levels.next/`：之前它对所有请求都不响应。

## 5. Unity 能力 → 网页对照

| Unity | 网页 |
|---|---|
| NavMesh / NavMeshAgent / SamplePosition / NavMesh.Raycast / OffMeshLink | `UnityNavMesh.ts`（已有 A*、最近点、随机点）；待补：代理转向与避让、部分路径、导航射线、跳跃 / 攀爬连接 |
| Physics Raycast / SphereCast / Overlap* | `CollisionWorld`（已有盒体、三角网格、高度场）；待补：球扫、胶囊重叠、锥形扫描 |
| 布娃娃胶囊命中区 | 按 GLB 骨骼读每段胶囊 |
| Animator + 动画事件（`act_` 打点） | `THREE.AnimationMixer` + 每个片段的事件时间表 |
| ParticleSystem / LineRenderer / TrailRenderer | `src/fx`（粒子、条带、拖尾） |
| Graphics.RenderMeshInstanced | `InstancedMesh` |
| UI Toolkit（USS / UXML） | DOM + CSS（`src/ui`） |
| AudioMixer 快照 | WebAudio 总线 |
| URP Volume / 后处理 | 见第 6 节 |
| 协程 / `[DefaultExecutionOrder]` | `TaskRunner`；更新顺序在 `Game.ts` 里写死 |
| TimeScaleArbiter（卡帧 / 慢放） | `ctx.time.timeScale` 仲裁 |
| Timeline | Unity 没用；首领登场是代码驱动，照译 |

## 6. UI / 特效 / 音频 / 渲染 / 角色美术

**几何已经齐了，"看起来像 Unity"的那层只有 25–35%。** Unity 里 350 件美术资产（68 角色、232 道具、30 武器、20 挂件）的源 GLB 哈希和 `public/assets` 里的当前文件逐个对上（350/350）；`unity/Assets/Art` 的 6.4 GB 里 3.2 GB 是 `_Review` 审阅图，其余是从这些 GLB 解出来的 FBX / PNG。差的是材质、后处理、特效、动画片段、界面。

| 子系统 | Unity | 网页现状 | 迁法 |
|---|---|---|---|
| 着色器 | 37 个 / 7.6k 行。`SF_StylizedLit`（963 份材质里 689 份用它：色阶阈值 / 柔边、阴影染色与抬升、三色环境光、边缘光、阶梯高光；可选溶解、发光遮罩、区域遮罩、火焰键、毛发）、Terrain（高度混合、宏观噪声、坡度压暗）、Foliage（风、背光透射）、Water / MirrorLake、Lava、Ice、Fur、Sky、Fx*、Telegraph | 只有水、熔岩、远景；**StylizedLit 落成了普通 MeshStandardMaterial** | `MeshStandardMaterial` + `onBeforeCompile` 替换直接 / 间接光照块，可选块用 define；材质参数从 `.mat`（文本 YAML）导出 |
| 后处理 / 光照 | 27 份 Volume Profile：Bloom、**URP Neutral** 色调映射、ColorAdjustments、白平衡、LiftGammaGain、暗角、第一人称独立曝光；玩法 Volume（低血去饱和、受击 / 冲刺色差、慢放）。HDR、MSAA 4×、SSAO、贴花、2048 阴影 4 级联 90 m 软阴影；每关三色环境光、线性雾、天空渐变 / 云、实时太阳 | ACES、PCF 阴影，**没有任何后处理**；导出器写了雾 / 环境光 / 太阳 / 天空 / 灯，没写 Volume | 后处理栈（Bloom、照 URP Neutral 曲线写的色调映射——`THREE.NeutralToneMapping` 是 Khronos 曲线，不一样——每关调色烘成 LUT、暗角、色差、AO）、CSM 4 级联；导出器补 Volume Profile |
| 特效 | 121 个文件 / 27.6k 行：FxRuntime / FxPreset（声明式层列表，池化、可取消）、程序化贴图、线条、URP 贴花与预警圈、6–8 盏灯光池、命中材质、溶解、状态皮肤；35 个预设；环境（水、瀑布、火、液体、平面反射）；各首领 / 章节专属约 6.4k | `src/fx` 3.4k + 散在各处的 `*Fx*.ts` 约 7.6k | 预设导出成 JSON + 实例化公告板 / 拉伸 / 网格粒子引擎（序列帧、加色 / 透明混合、灯光池固定数量免得材质重编译）；投影盒贴花读深度；首领专属特效跟着首领移植 |
| 界面 | 66 个 C# / 13.5k 行 + 9 份 USS / 5.3k 行，三种字体（Noto Sans SC、霞鹜文楷子集、Barlow Condensed）；四层路由。网页没有的界面：图鉴（含运行时缩略图棚）、地图 + 标记 + 罗盘条、关卡卡片、确认框、按键说明、灵宠面板、精英灵契、秘卷触发弹字、瞄准镜、六向受击弧、可合并的提示队列。重做的：HUD 血盾 / 武器 / 技能环、伤害数字（按目标合并、池 80）、敌人血条、首领血条、设置页（由 GameSettings 生成） | `src/ui` 13.75k（其中 8.6k 是旧三英雄的展示）、CSS 5.7k、系统字体 | DOM + CSS：USS → CSS 转换（`-unity-*` 属性只有 94 处；UI Toolkit 默认纵向 flex，要加基准重置），1920×1080 四层缩放，webfont 取代 SDF 字体，Painter2D → SVG / canvas |
| 核心 | 40 个 / 7.6k：存档信封（版本、备份、迁移）、局中暂停续玩、时间缩放仲裁、卡帧、模态栈、三档画质、距离剔除、性能预算、BalanceModel、EconomyConfig、具名随机流 | `src/core` 2.6k + `progression/Meta.ts` | 照译 |
| 音频 | 7 个 / 1k + 混音器构建器；254 个 ogg（13 MB，正是从网页的合成配方烘出来的） | `src/audio` 实时合成 | 改播烘好的 ogg；WebAudio 总线：总限幅 → World（暂停 / 模态快照 0.45 增益 + 6 kHz 低通）→ SFX / 音乐 / 环境 / 混响，章节混响送、遮挡低通、敌人语音变体、密集音节流（同类最多 3 个）、首领主题 |
| 动画 | 53 份 `*.native-anim.json`（487 个片段、154 个带事件，30 fps，**本来就是 glTF 空间**——当初从网页的敌人代码采样来的）；125 个手 K 片段（9 首领、5 高原敌、商人）来自 20 个入库的 Blender 脚本；控制器拓扑对所有生物一致（Idle ⇄ Move 按 Speed，Any → `act_*` 触发，加法受击层） | 网页敌人逐类程序化摆姿势，没有片段 | native-anim 无损转 `THREE.AnimationClip`；Blender 脚本加 GLB 导出（17 个人形资产别从 Unity 转）；AnimationMixer 状态机照控制器拓扑；CreatureRig 的足部射线 + 两骨 IK、视线、受击弹簧照译；布娃娃先用网页现有的程序化倒地 |

## 6.1 资源体积

- 关卡发布目录 390 MB（网格 134、贴图 110、场景文档 155；17 张图）。
- 场景导出器按网格逐件写道具，没有引用 `public/assets` 里已有的道具 GLB，同一件道具在网页里存了两份。导出器改成引用资产 ID 后还能再省一截。
- 贴图以后转 KTX2（省显存，不只是省下载）。

## 7. 测试

- 网页现有：`npm test`（含 8 份 `tests/unity-*.test.mjs`：场景同步、碰撞、导航、材质、地形网格、关卡载入、玩法定义、武器同步）。
- M13：把 Unity EditMode 里的对照测试（DamageCalcParity、ReactionTuning、Affix、Legendary、WeaponStats、FireMode、RunRoute、RunPlan、CombatDirector、Encounter、InfernoSquads、Lava、首领平衡、Scroll*）改写成 `node --test`，断言同样的数。

## 8. 已知问题

1. **法线贴图（已修）**：Unity 工程是线性色彩空间，`WebSceneExporter.ExportTexture` 把贴图 Blit 进默认（sRGB）的 ARGB32 渲染纹理。sRGB 贴图（颜色、地形 splat）来回一编一解没事；线性贴图（法线）的 RGB 被多套了一层 sRGB 曲线，再加上 Unity 法线贴图的 DXT5nm 打包布局（R=1、G=y、A=x），网页当普通 RGB 法线读，所有 Unity 道具的法线方向都是错的。发布步骤按 `UnpackNormalmapRGorAG` 解包修正；导出器本身下次改成线性渲染纹理（`RenderTextureReadWrite.Linear`）并直接写 RGB 法线。
2. **地形 splat 贴图（已修，2026-11-16）**：libwebp 无损编码默认把 alpha = 0 处的 RGB 清零，而 splat 的 A 通道存第 4 层权重，前 3 层权重在没有第 4 层的地方全丢了（1-1 有 98% 的像素权重和 < 0.5）。`webp_textures.py` 改为 `exact=True`，64 张 splat 解码后与 Unity 导出逐像素一致。
3. 主线 14 关里没有 4-2、4-4（Unity 里第四章本来就只建了 4-1、4-3）。
