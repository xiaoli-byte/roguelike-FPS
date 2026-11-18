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
| M2 | 数据桥：导出器改 Newtonsoft 整份序列化（✅ 2026-11-16，`defs.json` schema 2：武器的 `spreadTuned` / `projectile` / `blade` / `innate`、首领 `tiers` / `phases` / `forms` / `hitZones`、敌人 `ai` / `role` / `rank` / `element` 都在，枚举写名字）。Unity 已冻结，不做运行时覆盖：一次性把 TS 定义表对齐 `defs.json`，再加对照测试锁住；持枪手感 / 词条 / 灵宠表随各自的期补导 | 0.1k | ✅ 2026-11-18（92c14dfc）：英雄 3 / 敌人 40 / 武器 18 行逐字段对齐（129 列，映射与约定见 4.3），`node scripts/web/defs-parity.mjs` 出差异报告，`tests/unity-defs-parity.test.mjs` 锁住（例外 4 条，各带原因）。改到 Unity 值的：散布（`spreadTs` × 0.4 / 6 把 `spreadTuned`，运行时读有效值）、霰弹锥角 0.075 → 0.06、赤蛟霰铳每粒 11 → 10、左轮 / 雷蛊音量 1.0 / 0.5、雷蛊 `rollAfter`、四只敌人的弱点半径、蜃景伤害 0、鼯的被动说明；敌人补 Unity 新列；第四章名册改成显式表（穷奇 423 + 名册精英、雷牦注册、尺寸 / 掉落 / 颜色照 Unity）。首领不在这份对照里（M6）；持枪手感 / 词条 / 灵宠表随各自的期补导 |
| M3 | 局流程：RunPlan / RunRoute / RunRng / RunState / EconomyConfig，图池洗牌 | 0.9k + 0.3k | ✅ 2026-11-16（3679d15f）：`src/progression/` 的 RunRng（具名流）、StagePlan（16 关 + 图池 + ready 判定 + 试玩终点）、RunRoute、Economy、RewardScale；生涯第一局 / 调试局不排路线；Unity 的 RunRoute / RunPlan 对照测试原样迁成 `tests/unity-run-route.test.mjs`。没迁：经济投影（依赖 BalanceModel）、续玩存档 |
| M4 | 遭遇与导演：EncounterSite v2、LevelLayout、CombatDirector、MonsterEntry、RewardScale | 4.4k | 🔶 导演 / 入场点 / 布局变体 / 奖励倍率的运行时 ✅（89668cb3，`src/world/CombatDirector.ts`、`LevelLayout.ts`，对照测试 `tests/unity-combat-director.test.mjs`）。待办：导出器写 `entries` / `layout` / 各项 `scenePath`（格式见 4.2）；入场方式的专属声光与跃下 / 飞临动作、驻守点伏击、EncounterSite v2 其余部分 |
| M5 | 敌人框架增量 + 沙魇 + 第四章敌人并入主框架 | ~8k（多数是对照） | ⬜ |
| M6 | 首领框架 + 登场镜头 + 旱魃 + 魔将 v2 + 鲲鹏 / 麒麟数值阶段 + 三领主 | ~20k | 🔶 首领框架（`src/enemies/bosses/framework/`：BossDef 定档 / 阶段表、BossBrain、BossMove、破防条、召唤上限、领主梯度、倒下演出、时间缩放仲裁、关卡钩子）、登场演出导演（`bosses/intro/`）、旱魃全套 ✅ 2026-11-17（87cd9188…fed45ef1；对照测试 `tests/hanba-boss.test.mjs`、`tests/boss-intro.test.mjs`；实机脚本 `scripts/hanba/fight-shots.mjs`）。1-4 走进泉床正常触发（c33c5467）。火麒麟 / 鲲鹏 ✅ 2026-11-18（0c0168ff…07ebf638：火麒麟定档 28000 + 2400 护甲、85 / 70 / 55% 刻度、狂怒长啸 / 熔流轮转 / 鳞冠；鲲鹏定档 16000 + 4800 护盾、75 / 50 / 25% 鲲怒 / 化鹏 / 鹏狂怒；对照测试 `tests/qilin-boss.test.mjs`、`tests/kunpeng-boss.test.mjs`；实机脚本 `scripts/kunpeng/fight-shots.mjs`、火麒麟同目录）。魔将 v2 ✅ 2026-11-18（0d97befe…b288e282：九招、高台砸落登场、狂怒换挡、零星陨石，`WarlordPoser.ts` 按 Blender 姿势表在网页现场烘焙 v006 骨架的手 K 片段，释放帧等片段事件；对照测试 `tests/warlord-boss.test.mjs` 42 条；实机脚本 `scripts/warlord/fight-shots.mjs`）。2-4 / 3-3 走关卡正常触发：Unity 首领场（`boss:`）照 `BossEncounter.PlayerInArena` 不看视线；3-3 的矩形首领场半径盖到高台出生点。待办：三领主；邪飞天的和弦护盾 / 赐福；首领特效（旱魃日火贴花 / 水幕沙幕，鲲鹏浪墙 / 扶摇柱 / 水冠，火麒麟火浪，魔将火尾 / 火舌体积、`T_Boss_Warlord_E` 发光遮罩、登场转场风）随 M11b；鲲鹏 / 火麒麟换动画片段与首领顿帧随 M12；魔将熔铜渠涨落随 M7 |
| M7 | 地图机关：熔岩 v2、流沙 / 地表 / 边界 / 可破坏 / 断桥 / 风场、天气、各图专属脚本 | ~10k | ⬜ |
| M8 | 玩家与战斗增量：战斗契约（灵宠伤害源、弱点倍率、命中区）、状态（寒意 / 引燃 / 日灼，带电随第四章）、弹体（弱点判定、护罩、落地滚动）、镜头手感 / 卡帧 / 安全落点 / 移动特效、武器（散布手调、冲刺禁射、喷火锥、磁轨光束）、技能（施法姿势、特效换风格） | ~12k | ⬜ |
| M9 | 灵宠（全新） | 4.1k | ⬜ |
| M10 | 第一人称持枪手感 + 碎刃表现 | 5.8k | ⬜ |
| M11a | 渲染观感：StylizedLit / Terrain / Foliage / Fur 着色、材质参数导入、后处理栈、三色环境光 / 雾 / 天空、CSM | 7.6k 着色器 | 🔶 材质 ✅ 2026-11-16（1f213358，`src/world/UnityStylizedLit.ts`：色阶、阴影染色、阶梯高光、边缘光、地形高度混合 / 宏观噪声 / 坡度压暗 / 陡坡三向投影、植被风摆与背光透射，Trilight 投成 SH 环境光）；太阳阴影照 Unity 管线（0564dd10，2048 贴图、90 m、跟相机）；云天 + 逆光光柱接入（52c719c6）；后处理栈 ✅ 2026-11-18（646f7eae，`src/render/PostStack.ts`：HDR 目标 + URP Bloom + 照 URP Color.hlsl 写的 Neutral + 每关 Volume 调色烘 LUT + 暗角 + 色差 + 低血 / 受击 / 冲刺玩法屏效；`scripts/web/export-volume-profiles.mjs` 从 27 份 Profile 导出 `volumes.json`，含 3-3 火神王座局部 Volume 的盒子混合；`?post=0` 或低画质绕开）。待办：AO、3-3 第一人称手被泛光吹白、1-2 比 Unity 偏灰（大气在 ACES 下调的，要按 Neutral 重调）、Fur、导出器补 `_ORMMap` / 关键字 / 地形材质参数、流动雾带与小活物逐图摆位 |
| M11b | 特效核心：预设 JSON + 粒子引擎、线条、灯光池、贴花、预警圈、溶解、状态皮肤（首领专属特效随 M6） | 5k + 6.4k | ⬜ 注意：网页版已有一批「特效分层」（703950b2 / dd6db46d / 49b82303：`Fx.ts` 的余韵、`Seal.ts` 国风法印、三种新粒子形状、狐 / 熊 / 隼技能，准则 docs/art/fx-style.md 第五节），换粒子引擎时要一起迁过去，不能丢 |
| M11c | 界面：USS → CSS、四层路由、字体、约 10 个新界面、HUD 部件重做 | 13.5k | ⬜ |
| M11d | 核心：存档迁移、续玩、时间仲裁、卡帧、模态栈、画质档、剔除 | 7.6k 中约一半 | ⬜ |
| M11e | 音频：改播烘好的 ogg + WebAudio 总线 | 1.3k | ✅ 2026-11-18（db6ae16d；素材 ba1adca8：`scripts/web/publish-audio.mjs` 把 Unity 的 246 个音效片段 + 8 条曲目 / 声床 + 清单拷到 `public/assets/audio`，核对 OggS / DLP 密文，`--check` 逐字节）。`src/audio/AudioSystem.ts` 照 GameAudio 播 ogg：48 声道抢占、同 id 节流 + 敌方音色单独节流、密集音、k^1.6 衰减、近处声像收窄、远处 / 背后低通、遮挡（`ctx.world.raycast`）、I6 三层分层、光束循环、配乐交叉淡化；`AudioMixer.ts` 照 Spiritfire.mixer 搭总线与快照；MusicDirector / AmbienceDirector（每章声床、章节混响送、3-3 混响区）/ AudioDuck / UISound 照译；规则与常数在 `AudioRules.ts`，对照测试 `tests/audio-parity.test.mjs`。设置补环境音 / 界面音两档，五档缺省改成 1（同 Unity）。退路：清单 / 片段读不到退回老的实时合成配方。待办：老存档里的音量是旧语义（M11d 存档迁移时换算）；SFX Reverb 是卷积近似；3-3 的混响区照 Unity 挂在世界原点（离主路远，多半听不出，Unity 同样）；WeatherDirector 的风声随天气系统迁 |
| M12 | 动画：native-anim → AnimationClip、Blender 片段导 GLB、控制器状态机与事件、CreatureRig | 1.8k 运行时 | 🔶 第一期 ✅ 2026-11-16（51e4bf35）：`npm run` 外的 `node scripts/web/export-native-anims.mjs` 把 52 个资产 469 个采样片段导成 `public/assets/anim/*.json`（3.5 MB，带 231 个片段的事件）；`src/anim/` 复刻 Animator（一维混合树、任意状态 / 退出时刻转换、加法受击层、逐帧事件）、CreatureRig（脚步探地 + 两骨 IK、看向、受击弹簧、弹簧骨）、CreatureLocomotion；检视页 `anim-lab.html`。待办：敌人类改用 `CreatureAnimator`（接法见 `src/anim/CreatureAnimator.ts`）；Blender 手 K 片段（15 个资产约 123 个，旱魃 / 商人只有手 K）加 GLB 导出；魔将 11-07 换骨架后采样片段失效；布娃娃 |
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

### 4.2 走法变体 / 入场点的导出格式（✅ 2026-11-17 已导出：第一、二章主图与三张备选图各 2–3 种走法、6–8 个入场点；三四章老图还没有）

```
"entries": [{ "scenePath": "...", "position": [x,y,z], "forward": [x,y,z],
  "mode": 0-6,            // SpawnMode：现身 埋伏 余烬 熔岩 飞临 跃下 增援门
  "spread": 4, "label": "北沙丘背后", "from": [x,y,z] | null, "flyersOnly": false }],
"layout": { "variants": [{ "id": "main", "title": "自驼队营地入", "weight": 1,
  "spawn": { "scenePath": "...", "position": [..], "forward": [..] } | null,
  "exit": "<ExitPortal 的 scenePath>" | null,
  "only": ["<scenePath>"], "hide": ["<scenePath>"],
  "requires": [{ "site": "<据点 title>", "requires": ["<title>"] }],
  "sites": [{ "site": "<title>", "spec": { "waves": [UnityWave…] } | null, "reward": "weapon" | null }] }] } | null
```

- renderers、colliders、encounters、exits、caches、camps、platforms、water、activators、entries 每项加 `scenePath`：层级名用 `/` 连接，同名兄弟加 `#兄弟序号`；某物体「下」= 路径相等或以「该路径/」开头。
- 被任何变体引用的物体，即使在保存的场景里停用，也连同子树导出；顶层 `spawn` 保持主走法的出生点。
- 导出时被任何走法引用、但在保存的场景里停用的物体会临时激活后再导（场景不保存）；`?variant=<id>` 指定走法。
- 发布时贴图按内容哈希命名（`t_<sha1>.webp`），重导时没变的贴图和网格逐字节不变。
- 渲染观感（M11a）还要：材质 `_ORMMap`、`_ADDITIVE` / `_EMISSION` 关键字，地形材质参数（现在写死在 `TERRAIN_STYLES`）。

### 4.3 M2 字段映射（`scripts/web/defs-parity.mjs`）

Unity 侧是 `defs.json`（Newtonsoft：公有字段 + 计算属性，枚举写名字，Vector / Color 写数组，+∞ 写 `"Infinity"`）。网页侧：`WeaponDefs.ts` 只 import 类型，整份去类型后直接 import；英雄 / 敌人所在文件 import 了 three 和模型，只求值文件里顶格的 `const` 初始化式（相对 import 递归求值，其余给占位）——**定义表必须写成字面量**，不能在函数里拼。映射写在脚本的 `WEAPON_FIELDS` / `ENEMY_FIELDS` / `HERO_FIELDS`，测试和报告共用。

- **通用**：数值容差 1e-6（Unity 是 float32）；枚举名 → TS 小写字面量（`ReloadStyle.Magazine` → `'mag'`，`Element.None` → `'none'`）；`Color [r, g, b, a]` ↔ `0xRRGGBB`，每通道差 ≤ 1/255（Unity 有些颜色手写成两位小数）；TS 可选字段的缺省 = Unity C# 字段初值（`staggerSeconds` 0.6、`scale` 1、其余 0 / false / `'none'` / `[]`）。
- **武器**：角度一律半角弧度、射速发 / 秒（点射轮 / 秒、光束跳 / 秒），两边相同不换算。散布：`spreadTs` = TS 原值，有效值 = `spreadTuned ?? spreadTs × spreadScale(0.4)`（恢复速度不缩），`def()` 照 Unity 的 `spreadHip…` 计算属性算好，`WeaponSystem` 只读有效值。`recoil.*` / `kick.*` / `falloff [start, end, mult] | null` ↔ 摊平的 `recoilPitch…` / `kickBack…` / `falloffStart…`（null = 999 / 1000 / 1）。`viewHip` / `viewAim` = `WeaponDef.View(x, y, z)` = TS `viewOffset` / `aimOffset` 的 z 取反。计算属性 `IsHitscan` / `IsExplosive` / `IsBlade` / `HitsPerShot` / `ComboCycleTime` ↔ 同名帮助函数；`RARITY_DAMAGE` / `MAX_LEVEL` / `LEVEL_DAMAGE` 对 `WeaponDefs.cs` 的常量。不对照：`prefab`（原作模型名）、握点 `rightHand…`（M10）、`subElement / subChance`（全表 None / 0，副元素走 `innate`）。
- **敌人**：尺寸是设计尺寸，两边生成时都 × `scale`（精英再 × 1.25）。`WeakHeight`（计算属性）↔ `headY ?? height × 0.85`，`weakRadius` ↔ `headRadius ?? radius × 0.55`。新列：`rank`（`'elite'` = 名册即精英，`EnemyManager.spawn` 总按精英生成）、`affixExclusions`（`rollAffix` 读，原 `Affixes.EXCLUDE` 表撤掉）、`charger`（`CombatDirector` 读）；`placement` / `groundOnly`（待 M4）、`role` / `weakBone` / `hitboxes` / `poise` / `staggerSeconds` / `hitch`（待 M5）、`element`（待 M11b）只是数据，类型上注明。第四章：名册在 `enemies/plateau/index.ts` 的 `PLATEAU_ENEMY_DEFS`，行为仍由 `FOE_SPECS` 驱动，测试另查两边的韧性 / 速度 / 体型 / 生命同值（穷奇按精英折算：423 × 2.6 ≈ 1100、1 × 1.25）。不对照：`prefab`、`ai`、`GlowColor`。
- **英雄**：`maxHp` / `maxShield` / `moveSpeed` ↔ `base` 同名键（没写取 `BASE_STATS`）；`baseStats [(Stat, v)]` ↔ `base` 其余键；`role` / `difficulty` / `tags` / `tip` ↔ `ui/labels.ts` 的 `HERO_META`；被动名 / 说明 ↔ `passive`（模板串代入常量后比较）。不对照：`armR / armL`（M10）、`unlockCost`（D8 全为 0）。
- **例外**（`EXCEPTIONS`，测试要求每条仍是真差异）：步枪 `viewAim`（Unity 换了 Gunfire 1001 原作模型的提把机瞄，网页仍是自家模型 + 红点）；蚀蛊灯弹体外观 `lantern`（网页还没有这种外观，随 M11b）；祸斗、炮仗傀儡的 `WeakHeight`（Unity 只给占位体用的弱点高，网页 `headY` 是头心 / 视线 / 胶囊上沿，弱点由逐骨命中球给出）。

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
| 音频 | 7 个 / 1k + 混音器构建器；254 个 ogg（13 MB，正是从网页的合成配方烘出来的） | ✅ M11e：播 `public/assets/audio` 的 ogg（读不到时退回 `src/audio` 的实时合成配方） | 改播烘好的 ogg；WebAudio 总线：总限幅 → World（暂停 / 模态快照 0.45 增益 + 6 kHz 低通）→ SFX / 音乐 / 环境 / 混响，章节混响送、遮挡低通、敌人语音变体、密集音节流（同类最多 3 个）、首领主题 |
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
3. **旧的美术资产测试（23 个失败）**：nature-scene、gunfire-assets、setdressing-assets、native-hero-grip、authored-scene-layout、travel-deck、handling、cargo-hoist、articulation、architecture-scene、whitebox-flow 里按「三级 LOD + Draco」旧契约写的检查（missing LOD1、pose_geometry_audit 读不到网格、熊 / 隼 / 狐的 Tripo 契约）。发布的模型 2026-10-25 起只有一级 LOD，测试要按现行契约改写。
4. 主线 14 关里没有 4-2、4-4（Unity 里第四章本来就只建了 4-1、4-3）。
