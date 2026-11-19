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
| M5 | 敌人框架增量 + 沙魇 + 第四章敌人并入主框架 | ~8k（多数是对照） | ✅ 2026-11-18（a1d71b84、b4d5e683、92dcc729），对照清单见 4.4：新增受击四层（`enemies/HitReaction.ts`）、迅捷龙卷（`EliteTornado.ts`）、出场位移（`SpawnEntrance.ts`，导演刷群接上）、词缀接管；照 Unity 改了出生 0.7 s 不可选中、击退推力 / 上抛、前摇 1/√攻速（35 处按最小比例）、名额回收死者、词缀取词过排除表、5 个敌人常量；沙魇照 SandWraithAI 重写（原来跑的是跳鼠刀兵的名册）；第四章经 `PlateauFoeAdapter` 接主框架（伤害倍率、全局名额、精英体型 / 金环 / 词缀、元素眩晕、减速、击退、脱战）。对照测试 `tests/enemy-framework.test.mjs`（常量读 C# 源码比）。待办：坠落回收照 Unity（等导航补高度）、EliteStrike / 金环纹样 / 词缀演出 / 变体着色（M11）、嘲讽（M9）、PerchPoint 导出 |
| M6 | 首领框架 + 登场镜头 + 旱魃 + 魔将 v2 + 鲲鹏 / 麒麟数值阶段 + 三领主 | ~20k | 🔶 首领框架（`src/enemies/bosses/framework/`：BossDef 定档 / 阶段表、BossBrain、BossMove、破防条、召唤上限、领主梯度、倒下演出、时间缩放仲裁、关卡钩子）、登场演出导演（`bosses/intro/`）、旱魃全套 ✅ 2026-11-17（87cd9188…fed45ef1；对照测试 `tests/hanba-boss.test.mjs`、`tests/boss-intro.test.mjs`；实机脚本 `scripts/hanba/fight-shots.mjs`）。1-4 走进泉床正常触发（c33c5467）。火麒麟 / 鲲鹏 ✅ 2026-11-18（0c0168ff…07ebf638：火麒麟定档 28000 + 2400 护甲、85 / 70 / 55% 刻度、狂怒长啸 / 熔流轮转 / 鳞冠；鲲鹏定档 16000 + 4800 护盾、75 / 50 / 25% 鲲怒 / 化鹏 / 鹏狂怒；对照测试 `tests/qilin-boss.test.mjs`、`tests/kunpeng-boss.test.mjs`；实机脚本 `scripts/kunpeng/fight-shots.mjs`、火麒麟同目录）。魔将 v2 ✅ 2026-11-18（0d97befe…b288e282：九招、高台砸落登场、狂怒换挡、零星陨石，`WarlordPoser.ts` 按 Blender 姿势表在网页现场烘焙 v006 骨架的手 K 片段，释放帧等片段事件；对照测试 `tests/warlord-boss.test.mjs` 42 条；实机脚本 `scripts/warlord/fight-shots.mjs`）。2-4 / 3-3 走关卡正常触发：Unity 首领场（`boss:`）照 `BossEncounter.PlayerInArena` 不看视线；3-3 的矩形首领场半径盖到高台出生点。4-1 三领主进首领框架 + 据点模式 ✅ 2026-11-19（113789d6、f85f8715）：`src/enemies/bosses/lords/`——领主底座（LordDef 4-1 难度 3.4 定档、tempo 0.9 / 0.75 × 领主梯度；LordBrain 片段按设计时长拉伸、片段事件出手、顿帧只顿首领、招式驱动位移、弱点开关、死亡演出交给登场导演播；LordMove）；飞廉七招 + 擂台风 + 风雷珠珠碎 + 龙卷风柱（柱身可点火）+ 风涡柱；化蛇六招 + 圣湖游线 / 涨水面 / 泡水 / 漩涡 / 湿身雷殛；夔八招（不依赖雷暴的部分）+ 残鼓（导出位置错 112 m，挪回出生点）+ 召鼓，落雷 / 导体回劈 / 高原雷暴经 `lords/KuiStorm.ts` 的 `bindKuiStorm` 等 M7 接；框架补破防条条件填充（BreakBarDef.fillWhen）。据点模式：`scripts/web/export-level-objectives.mjs` 从场景 YAML 导出 `objectives.json`（灵火坛 / LevelObjective / BossEncounter / ZheduoLevel 门槛圆），`src/world/objectives/`（SpiritAltar、LevelObjectives）——领主战不是终点战，倒下 6.3 s 后结算并点亮本据点灵火，6 座里点亮任意 3 座才清关开出口（4-3 同样 5 选 3）。对照测试 `tests/lord-bosses.test.mjs`（照 LordTests.cs）；实机脚本 `scripts/lords/fight-shots.mjs`。待办：夔的落雷 / 经幡杆带电与回劈 / 高原雷暴 / 召鼓充电（M7 合进来后 bindKuiStorm）；二阶段起带电（Charge.Hold，M8）；化蛇湿身灼烧减半（M8 状态）；飞廉的风接全局 WindField、顺风逆风步速（M7）；镜像片段 sidestepL / wheelR 与夔的 sink 没导出（退回 sidestep / wheel / kneel）；目标栏文字（界面）；邪飞天的和弦护盾 / 赐福；首领特效（旱魃日火贴花 / 水幕沙幕，鲲鹏浪墙 / 扶摇柱 / 水冠，火麒麟火浪，魔将火尾 / 火舌体积、`T_Boss_Warlord_E` 发光遮罩、登场转场风）随 M11b；鲲鹏 / 火麒麟换动画片段与首领顿帧随 M12；魔将熔铜渠涨落随 M7 |
| M7 | 地图机关：熔岩 v2、流沙 / 地表 / 边界 / 可破坏 / 断桥 / 风场、天气、各图专属脚本 | ~10k | 🔶 2026-11-19：导出（`scripts/web/export-mechanisms.mjs` 直接解析场景 YAML → `mechanisms.json` + 软边界距离场）、运行时（`src/world/mechanisms/`，UnitySceneView 搭好后建）、对照测试 `tests/unity-mechanisms.test.mjs`、实机脚本 `scripts/web/mechanism-shots.mjs` ✅；清单、差异与待办见 4.5 |
| M8 | 玩家与战斗增量：战斗契约（灵宠伤害源、弱点倍率、命中区）、状态（寒意 / 引燃 / 日灼，带电随第四章）、弹体（弱点判定、护罩、落地滚动）、镜头手感 / 卡帧 / 安全落点 / 移动特效、武器（散布手调、冲刺禁射、喷火锥、磁轨光束）、技能（施法姿势、特效换风格） | ~12k | ⬜ |
| M9 | 灵宠（全新） | 4.1k | ⬜ |
| M10 | 第一人称持枪手感 + 碎刃表现 | 5.8k | ⬜ |
| M11a | 渲染观感：StylizedLit / Terrain / Foliage / Fur 着色、材质参数导入、后处理栈、三色环境光 / 雾 / 天空、CSM | 7.6k 着色器 | 🔶 材质 ✅ 2026-11-16（1f213358，`src/world/UnityStylizedLit.ts`：色阶、阴影染色、阶梯高光、边缘光、地形高度混合 / 宏观噪声 / 坡度压暗 / 陡坡三向投影、植被风摆与背光透射，Trilight 投成 SH 环境光）；太阳阴影照 Unity 管线（0564dd10，2048 贴图、90 m、跟相机）；云天 + 逆光光柱接入（52c719c6）；后处理栈 ✅ 2026-11-18（646f7eae，`src/render/PostStack.ts`：HDR 目标 + URP Bloom + 照 URP Color.hlsl 写的 Neutral + 每关 Volume 调色烘 LUT + 暗角 + 色差 + 低血 / 受击 / 冲刺玩法屏效；`scripts/web/export-volume-profiles.mjs` 从 27 份 Profile 导出 `volumes.json`，含 3-3 火神王座局部 Volume 的盒子混合；`?post=0` 或低画质绕开）。待办：AO、3-3 第一人称手被泛光吹白、1-2 比 Unity 偏灰（大气在 ACES 下调的，要按 Neutral 重调）、Fur、导出器补 `_ORMMap` / 关键字 / 地形材质参数、流动雾带与小活物逐图摆位 |
| M11b | 特效核心：预设 JSON + 粒子引擎、线条、灯光池、贴花、预警圈、溶解、状态皮肤（首领专属特效随 M6） | 5k + 6.4k | ⬜ 注意：网页版已有一批「特效分层」（703950b2 / dd6db46d / 49b82303：`Fx.ts` 的余韵、`Seal.ts` 国风法印、三种新粒子形状、狐 / 熊 / 隼技能，准则 docs/art/fx-style.md 第五节），换粒子引擎时要一起迁过去，不能丢 |
| M11c | 界面：USS → CSS、四层路由、字体、约 10 个新界面、HUD 部件重做 | 13.5k | 🔶 第一期（基础 + HUD）✅ 2026-11-19（3f892251…ed68a128）：`scripts/web/convert-uss.mjs` 把 9 份 USS（763 条规则）转成 `src/ui/css/unity/*.css`（`--check`；`-unity-*` 映射表 MAPPED / 转不了的 UNSUPPORTED，现在只有 theme 的段间距一处），UI Toolkit 默认值的网页基准在 `src/ui/css/sf-base.css`（零优先级：纵向 flex、border-box、最小尺寸 0、`\n` 总换行）；`scripts/web/publish_fonts.py` 把三种字体（正文子集 + 余量、霞鹜文楷子集、Barlow Condensed）转 WOFF2 发布到 `public/assets/fonts`，@font-face 带按字表生成的 unicode-range（余量 4 MB 用到才下），旧 gf-* 界面的字体变量也换成它们；`src/ui/toolkit/`：四层（Hud / Overlay / Modal / Toast，1920×1080 Expand 缩放）、路由（栈、返回、焦点还原、方向键空间导航与连发、滑条左右调值）、提示队列、横幅、黑幕、闪光、图标、FitLabel；`src/ui/hud/`：生命护盾、武器槽、Q / E 技能盘 + 冲刺格、武器技能 V 盘、信息角、准星、六向受击弧 + 闪屏 + 低血暗角、伤害数字（池 80、按目标合并：Feedback 把敌人放进 `DamageNumberOpts.target` 交给 UI）、头顶血条、首领条（BossDef 刻度、无敌、破防条）、交互提示卡、中央大字、反应首遇教学卡；`src/ui/screens/`：暂停、设置（按设置表生成三页）。对照测试 `tests/uss-convert.test.mjs`、`tests/ui-router.test.mjs`；实机截图 `node scripts/web/ui-shots.mjs <端口>` → `docs/art/review/threejs-migration/ui-*.jpg`。与 Unity 的差异：目标文字没有遭遇 / 出口的 SetObjective 钩子，按同样格式从关卡状态拼；技能「放不出来」闪红靠按键时没有充能判断（技能系统没有拒绝事件）；网页武器没有预热转速、元素轮转「下一发」的读数（转速条 / 转速环不出现，三才转轮显示金圈「三」）；设置页没有显示模式 / 分辨率 / 垂直同步 / 帧率上限 / 屏幕特效 / 瞄准辅助（网页无对应设置），多一项阴影精度；暂停「返回主菜单」照网页现状不结算、总要二次确认（续玩随 M11d）；UICapture 不需要（浏览器截图本来就带界面）。**第二期待办**：图鉴（含运行时缩略图棚）、地图 + 标记 + 罗盘条（替换旧的行旅图 AdventureHUD）、关卡卡片、确认框、按键说明（+ 设置页「按键」改键页）、灵宠面板、精英灵契（头顶印章 EliteSeal）、秘卷触发弹字、瞄准镜（ScopeOverlay；现在沿用旧 gf-scope 遮罩）——层位登记在 `src/ui/UI.ts` 的 SCREEN_SLOTS；还没迁的旧界面：主菜单 / 选英雄 / 天赋 / 结算 / 秘卷三选一 / Tab 行囊（挂在界面层不缩放的壳里，照 Unity MainMenuScreen / HeroSelectScreen / TalentScreen / SummaryScreen / ScrollChoiceScreen / InventoryPanel 重做）；旧 CSS（`css/hud.css`、`combat.css` 里旧 HUD 的 gf-* 规则）与 `src/fx/DamageNumbers.ts`（现在只在没有 UI 时兜底）随旧界面一起清掉 |
| M11d | 核心：存档迁移、续玩、时间仲裁、卡帧、模态栈、画质档、剔除 | 7.6k 中约一半 | ⬜ |
| M11e | 音频：改播烘好的 ogg + WebAudio 总线 | 1.3k | ✅ 2026-11-18（db6ae16d；素材 ba1adca8：`scripts/web/publish-audio.mjs` 把 Unity 的 246 个音效片段 + 8 条曲目 / 声床 + 清单拷到 `public/assets/audio`，核对 OggS / DLP 密文，`--check` 逐字节）。`src/audio/AudioSystem.ts` 照 GameAudio 播 ogg：48 声道抢占、同 id 节流 + 敌方音色单独节流、密集音、k^1.6 衰减、近处声像收窄、远处 / 背后低通、遮挡（`ctx.world.raycast`）、I6 三层分层、光束循环、配乐交叉淡化；`AudioMixer.ts` 照 Spiritfire.mixer 搭总线与快照；MusicDirector / AmbienceDirector（每章声床、章节混响送、3-3 混响区）/ AudioDuck / UISound 照译；规则与常数在 `AudioRules.ts`，对照测试 `tests/audio-parity.test.mjs`。设置补环境音 / 界面音两档，五档缺省改成 1（同 Unity）。退路：清单 / 片段读不到退回老的实时合成配方。待办：老存档里的音量是旧语义（M11d 存档迁移时换算）；SFX Reverb 是卷积近似；3-3 的混响区照 Unity 挂在世界原点（离主路远，多半听不出，Unity 同样）；WeatherDirector 的风声随天气系统迁 |
| M12 | 动画：native-anim → AnimationClip、Blender 片段导 GLB、控制器状态机与事件、CreatureRig | 1.8k 运行时 | 🔶 第一期 ✅ 2026-11-16（51e4bf35）：`npm run` 外的 `node scripts/web/export-native-anims.mjs` 把 52 个资产 469 个采样片段导成 `public/assets/anim/*.json`（3.5 MB，带 231 个片段的事件）；`src/anim/` 复刻 Animator（一维混合树、任意状态 / 退出时刻转换、加法受击层、逐帧事件）、CreatureRig（脚步探地 + 两骨 IK、看向、受击弹簧、弹簧骨）、CreatureLocomotion；检视页 `anim-lab.html`。待办：敌人类改用 `CreatureAnimator`（接法见 `src/anim/CreatureAnimator.ts`）；Blender 手 K 片段（15 个资产约 123 个，旱魃 / 商人只有手 K）加 GLB 导出；魔将 11-07 换骨架后采样片段失效；布娃娃 |
| M13 | Unity EditMode 对照测试 → `node --test` | — | ⬜ |

依赖：M2 → M3 → M4；M5 → M6；M8 → M9；M10 依赖 M12 的武器挂点命名；M7 依赖 M1 的体积导出。M11 / M12 可与玩法并行。

### 4.1 M1 细项

- ✅ 接手 2026-11-08 的半成品：导出器（`WebSceneExporter.cs` / `WebGameplayExporter.cs` / `PipelineBridge` 三条命令）、`src/world/Unity*.ts`、`StageDirector` 异步载入 Unity 场景、`RunPlan` 改成 Unity 的 14 关、`Game.ts` 换 `UnityNavigation`、检视页、8 份 `tests/unity-*.test.mjs`。
- ✅ 发布瘦身（2.2 GB → 约 340 MB）与法线贴图修正。
- ✅ 重新导出（2026-11-16，批处理模式，16 分钟）：带上 11-08 之后一周的 Unity 改动；三张备选图 1-A / 2-A / 3-A 进清单（`pool: true`）和场景目录，不进 `UnityStages.ts` 主线表。原样 2.5 GB → 发布 390 MB。
- ⬜ 导出器补：LevelLayout 变体（现在编辑态导出可能把各走法的出生点 / 出口混在一起）、MonsterEntry、PerchPoint、SpawnAnchor 的 mode / from、熔岩 / 闸 / 间歇泉、流沙、地表区、边界区、可破坏物、风场、灵坛、传说碑、关卡目标。（灵火坛 / 关卡目标 / 首领据点门槛 2026-11-19 先由 `scripts/web/export-level-objectives.mjs` 直接读场景 YAML 导出到 `public/assets/unity-levels/objectives.json`，`--check` 核对；灵火坛位置与场景文档里的四角石柱渲染件一致）
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
- **敌人**：尺寸是设计尺寸，两边生成时都 × `scale`（精英再 × 1.25）。`WeakHeight`（计算属性）↔ `headY ?? height × 0.85`，`weakRadius` ↔ `headRadius ?? radius × 0.55`。新列：`rank`（`'elite'` = 名册即精英，`EnemyManager.spawn` 总按精英生成）、`affixExclusions`（`rollAffix` 读，原 `Affixes.EXCLUDE` 表撤掉）、`charger`（`CombatDirector` 读）；`placement` / `groundOnly`（待 M4）、`role` / `weakBone` / `hitboxes`（命中区结构没迁，见 4.4）、`element`（待 M11b）只是数据，类型上注明；`poise` / `staggerSeconds` / `hitch` 由 `StandardEnemy` 的受击四层读（M5）。第四章：名册在 `enemies/plateau/index.ts` 的 `PLATEAU_ENEMY_DEFS`，行为仍由 `FOE_SPECS` 驱动，测试另查两边的韧性 / 速度 / 体型 / 生命同值（穷奇按精英折算：423 × 2.6 ≈ 1100、1 × 1.25）。不对照：`prefab`、`ai`、`GlowColor`。
- **英雄**：`maxHp` / `maxShield` / `moveSpeed` ↔ `base` 同名键（没写取 `BASE_STATS`）；`baseStats [(Stat, v)]` ↔ `base` 其余键；`role` / `difficulty` / `tags` / `tip` ↔ `ui/labels.ts` 的 `HERO_META`；被动名 / 说明 ↔ `passive`（模板串代入常量后比较）。不对照：`armR / armL`（M10）、`unlockCost`（D8 全为 0）。
- **例外**（`EXCEPTIONS`，测试要求每条仍是真差异）：步枪 `viewAim`（Unity 换了 Gunfire 1001 原作模型的提把机瞄，网页仍是自家模型 + 红点）；蚀蛊灯弹体外观 `lantern`（网页还没有这种外观，随 M11b）；祸斗、炮仗傀儡的 `WeakHeight`（Unity 只给占位体用的弱点高，网页 `headY` 是头心 / 视线 / 胶囊上沿，弱点由逐骨命中球给出）。

### 4.4 M5 敌人行为对照（Unity → 网页，2026-11-18）

对照方法：框架逐文件读 C#（`G/Enemies/` 根目录、`Affixes/`、`Combat/EnemyStatus.cs` 与 `Combat/Status/*`、`Encounters/MonsterEntry.cs` 与 `SpawnModes/`）；逐怪先用脚本把 Unity 各 AI 的 `const` 按名字（CamelCase → UPPER_SNAKE）和网页同名常量比，再抽查没配上名字的（网页写成区间数组 / 对象字段，如铸匠的 `POUR` / `FLING`、傩的 `SPIT`）。框架常量、沙魇常量、第四章招式表由 `tests/enemy-framework.test.mjs` **直接读 C# 源码**比，改了一边另一边就红。逐招的状态机分支没有逐行比，等 M13 把 Unity 的 FrostEnemyTests / InfernoEnemyTests 迁成 node 测试时再锁。

记号：✅ 一致 · 🔧 本期照 Unity 改了 · ➕ 本期新增 · ⬜ 还缺（写明归哪期）。

**框架**

| 机制（Unity） | 网页（M5 后） | 结论 |
|---|---|---|
| 出手名额 `AttackTokens`：近战 4+章 / 远程 2+章 / 重击 1→2，同类间隔 0.12 / 0.32 / 0.7 s，持有者续期、远程 + 重击合计上限、时钟回退复位 | `enemies/AttackTokens.ts` | ✅ |
| 同上：持有者死亡 / 销毁后下一次申请顺手回收（`Prune`） | `attackDirector.setLiveness`（EnemyManager 注入） | 🔧 |
| 精英词缀取词 `EliteAffixes.Resolve`：写死的词缀也要过排除表；全被排除不给词缀 | `EnemyManager.spawn`、`rollAffix` 返回 null | 🔧 |
| 词缀随机流：本局具名流 `elite-affix` | `ctx.rng` | ⬜ 小差异，接 RunRng 具名流时一起换 |
| 迅捷：移速 / 攻速 ×1.5 | 同 | ✅ |
| 迅捷：定期蓄风挥出前行龙卷——首次 4.5–6.5 s、之后 7.5–10.5 s；4–24 m、高差 ≤ 4 m、看得见、拿到重击名额；蓄风 0.85 s（脚下长条预警）；20 m / 8 m/s / 扫掠半径 1.35 / 高 5.8 / 18 × 伤害倍率，只结算一次，打中掀起（前 3.5 / 侧 2.2 / 上 6.2）；撞墙散开；眩晕 / 死亡打断并还名额；收招 0.22 s | `enemies/EliteTornado.ts` + `Affixes.SwiftAffix` | ➕（外观是程序化风环；Unity 的三阶手绘风带、章节主题随 M11b） |
| 词缀招式接管 `AffixAttackBusy`：基础 AI 停手 | `StandardEnemy.affixAttackBusy`（第四章 `Foe.held`） | ➕ |
| 坚盾：额外护盾 = 最大生命 60%，脱战 4 s 后每秒回 22% | 同 | ✅；破盾崩甲片、回满六角格合拢 ⬜ M11b |
| 爆裂：死后 1 s、4.5 m、26 × 倍率（按死亡那一刻）、边缘 50%、清场不炸 | 同 | ✅；引信演出（星纹收缩、白热闪）⬜ M11b |
| 狂暴：生命 ≤ 40% 一次，伤害 ×1.2 / 攻速 ×1.6 / 移速 ×1.35 | 同 | ✅；心跳脉动、头顶火舌 ⬜ M11b |
| 精英金环 `EliteAura`（墨底鎏金带 + 词缀纹样，飞行精英投到地面） | 单道金环 | ⬜ M11b |
| 精英出手分量层 `EliteStrike`（蓄力压扁 / 后仰、释放帧拉长 + 局部顿帧、金光） | 无 | ⬜ M11b / M12（要各 AI 在前摇 / 出手处打点） |
| 受击四层 `HitReaction` + `Poise`：韧性 2 秒窗口（每秒回落一半）、弱点 ×2、爆炸 / 反应 ×3、持续伤害 0；破了硬直（打断招式，霸体除外）；轻怪每枪顿一下；反制 / 破防的眩晕期间受伤 ×1.25 | `enemies/HitReaction.ts` + `StandardEnemy.hitStagger / hitStun / hitch` | ➕ 前三章韧性都是 0，不进；第四章 Foe 自带同口径，适配层按 HitReaction 给倍率 |
| 出生 0.7 s 不可选中 | `StandardEnemy.untargetable` | 🔧（原来出生中就能打） |
| 前摇缩短 `Windup(time, minFraction) = time × max(minFraction, 1/√攻速)` | `windup`（秒下限版）曲线改 1/√攻速；Unity 写最小比例字面量的 35 处换成 `windupFrac` | 🔧（原来 1/(1 + 0.45(攻速 − 1))、下限按秒；镇墓兽踩地 0.4 s → 0.5 比例） |
| 击退 `Knockback`：水平冲量 × (1 − 抗性) 叠到推力（上限 9 m/s）、按 8/s 衰减推开；> 2 m/s 失控 0.25 × (1 − 抗性) s。上抛 `LaunchUp`：重力 26，带上没推完的推力，< 0.5 m/s 不掀 | `StandardEnemy.knockback / launchUp`；技能冲击波（`skills/common.ts`）、铁牛推挤改成分开调 | 🔧（原来整个冲量加到速度上、竖直也算，推得远）；飞行照旧 = Unity `AirKnockback` |
| 坠落回收：相对最后站过的导航点 12 m（被掀飞 40 m）、离网 2.5 s 拉回、找不到网格静默处决 | 低于 `arena.floorY − 12` 且脚下没地面 → 拉回场地中心 | ⬜ 网页导航 `isWalkable` 只有 XZ，多层图上判离网不可靠；等 UnityNavMesh 补「最近点 + 高度」再接 |
| 嘲讽 / 灵体诱饵（灵宠讙） | 无 | ⬜ M9 |
| 加成 `EnemyBuffs`（多通道：同通道取最强、不同通道相乘） | `SupportBuffs.BuffRegistry`（邪飞天）+ 狐巫 / 傩 / 铸匠各自一张 | ✅ 数值相同（光环 1.35 / 1.35 / 1.2 / 0.75，赐福 1.6 / 1.5 / 1.15 / 0.5、10 s），结构不同 |
| 状态 `EnemyStatus`：灼烧 4 s × 3 层 / 雷殛 3 s、弹射 8 m × 3、叠 3 层眩晕 0.8 s / 蚀化 5 s、承伤 ×1.2、移速 ×0.8 / 眩晕（精英 ×0.75，首领 ×0.35 且 ≤ 0.35 s、之后免疫 6.1 s）/ 减速 4 条取最强 | `combat/Status.ts` | ✅（Unity 本来就是照它移的）；寒意 / 引燃 / 日灼挂在玩家身上，M8 |
| 群协调 `PackCoordinator`（群门限、凑人、起哄、攀爬连线） | 各怪内部（冻鲛人群刺门限、雪狌狌 `frost/PackMotion`） | ✅ 行为一致；运行时攀爬连线（NavMeshLink）网页没有，狌狌走自己的攀爬 |
| 栖点 `PerchPoint`（关卡标记 + 兜底射线 + 认领） | 三青鸟 / 毕方扫碰撞盒顶面 | ⬜ 导出器没导 PerchPoint 标记（4.1 待办） |
| 命中区 `HitZone`（多段区、朝向门、部位计数） | 各怪自己的 `raycastHit` / `guardFactor` / `armourFactor` | ✅ 数值逐怪相同（M2 的弱点半径），结构不同 |
| 材质变体 `EnemyVariant`（沙化、日火裂纹、边缘光） | 沙魇只把反照率拉向焦沙色 | ⬜ M11a（StylizedLit 的 Variant 段） |
| 出生显形 `SpawnMaterialize` | `fx.spawnEffect` + 模型缩放长出 | ⬜ M11b |
| 入场点刷群：`MonsterEntry` 的 mode / spread / flyersOnly、各方式的预告时长 | `world/CombatDirector.ts`（M4） | ✅ |
| 入场动作 `SpawnEntrance`：跃下（墙头露头 0.6 s + 抛物线 0.75 s、落地一震）、飞临（12 m/s、1.2–3 s、弧高 0.12 × 距离 ≤ 6 m，终点在落点上方 2 m）、熔岩爬出（1.2 s，上岸前不可选中）；落地后站稳 0.7 s | `enemies/SpawnEntrance.ts` + `StandardEnemy.beginEntrance`，`CombatDirector.enterSpawn` 接上 | ➕；门缝光 / 熔岩鼓泡 / 炭堆的预告声光（`SpawnCues`）⬜ M4 |

**前三章逐怪 + 沙魇**（Unity `const` ↔ 网页同名常量）

| | 结果 |
|---|---|
| 第一章 | 跳鼠刀兵 13 项、火浣鼠 17 项（翻滚转速 126°/s = 2.2 rad/s）、邪飞天 9 项一致；🔧 蝎尾弓手沉沙深 1.25 → 1.8、蜃楼蟾腾空速 2.3 → 2.8、镇墓兽冲锋预警半宽 0.75 → 0.9（转速 80°/s = 1.4 rad/s 一致） |
| 沙魇 | 网页本来就有（`types/SandWraith.ts`），🔧 照 `SandWraithAI` 重写：18 个常量进对照测试；伏击点 = 玩家 0.35 s 后的预判位往回 0.6 m；沙下隐藏模型；出生 0.7 s 从沙里升起；破沙按「水平 ≤ 半径 + 0.35 m、高差 ≤ 2.2 m」判定，打中才掀；被打断钻回地面并重排冷却（0.8–1.4 s、潜沙至少 2–3.5 s）；冷却中按 Unity `KeepRange` 在 2.4–5 m 绕圈；前摇按 `Windup(0.35, 0.24)` / `Windup(0.6, 0.45)`。**原来构造时漏传名册，跑起来用的是跳鼠刀兵的 42 生命 / 7 移速 / 体型 1.3**，改成自己的 55 / 5.6 / 1.4。模型借跳鼠刀兵（同 Unity：`prefab = SK_Enemy_JerboaBlade`，`public/assets` 里没有独立的沙魇 GLB），沙化 + 日火裂纹的着色器皮 ⬜ M11a |
| 第二章 | 11 种同名常量 3–34 项全部一致 |
| 第三章 | 🔧 火鼍重规划 0.5 → 0.25 s、上岸前等待 8 → 5 s；其余 9 种一致 |

**第四章（`AI/Plateau/*`）**

Unity 的九种雷魅是照网页 `world/plateau/play/foes.ts` 译的（`PlateauKit` 注释：「照抄 foes.ts 的 defineMoves」）：8 个资产 22 招的前摇 / 出手 / 收招 / 冷却 / 闪光 / 无判定 / 时间点逐项一致（测试锁住）；伤害抽查一致（啸獭 6、电网 4、天狗 9 / 带电 14、獓狠挑角 16 / 踩踏 24 / 砸地 20、举父 18 / 12、蛮蛮 7 / 10、连鼓灵 10 / 8、帝江 22 / 10、穷奇 16 / 10 / 22；踩踏判定半径 2.0 × 体型 + 0.6、预警宽 3.2 × max(0.8, 体型)）。所以行为留在 Foe 类里（Foe 就是规格本身，改写成 `StandardEnemy` 子类只换结构），本期把它们接到和其他章同样的 EnemyBase / Registry / 定义表路径（`enemies/plateau/PlateauFoeAdapter.ts`）：

- 🔧 打玩家 × 伤害倍率（Unity `Strike`：dmg × DamageMult，等级 / 精英 / 狂暴都算），原来不乘；落雷按施法者算
- 🔧 出手拿群内令牌之外再拿全局名额（Unity `TakeToken`：扑咬 / 挑角 = 近战、远投 / 电弹 / 雷吠 = 远程），原来只看群内
- 🔧 出招冷却与招式时间轴 × 出手速度（Unity `cooldown −= dt × auraAttackRate`、`Move.speed = max(1, auraAttackRate)`）
- ➕ 精英体型 ×1.25（穷奇名册即精英，规格已折算）、脚下金环、四种词缀（`AffixHost`：迅捷龙卷接管时 Foe 停手；坚盾的护盾层先吃伤害，只有扣到生命的部分交给 Foe）
- 🔧 元素眩晕（雷殛叠满）→ Foe 停摆（原来 stunTime 没人递减、也没传给 Foe）；元素眩晕不加 +25%，只有反制 / 破防打出来的加（同 Unity `HitStun`）
- 🔧 减速按实际倍率（原来一律 ×0.6）；地面单位吃击退推力（原来整个忽略）；韧性按 HitReaction 口径（持续伤害 0、爆炸 / 反应 ×3）
- 🔧 脱战：玩家离领地 90 m 外且离它 60 m 外（不在出招、穷奇除外）回到未警觉状态——主游戏里原来根本不脱战（`r + 80 m` 的规则只在试玩页 `play/game.ts`）；未警觉时一直每秒回 30% 血（原来只在走回家的路上回）
- ⬜ 带电噼啪、四种死法、布娃娃、静电护盾泡的表现（M11b / M12）；飞行精英（蛮蛮、连鼓灵）的金环不投到地面；Unity 未警觉时 3–6 s 在 3 m 内踱一步、离家 6 m 才走回（网页 1.5 m 就走回）

**验证**：`tests/enemy-framework.test.mjs`（17 项）；实机冒烟（1-1，`window.__ctx.enemies.spawn`，每批 10–14 s，假无敌只记伤害，零报错）：前三章 27 种 + 沙魇（普通 / 狂暴精英）都会走、多数 10 s 内出手；第四章 12 只全部警觉追击，啸獭 / 獓狠 / 雷牦 / 蛮蛮 / 连鼓灵 / 帝江 / 穷奇出手；迅捷精英的龙卷放出来（跳鼠刀兵 1 道、啸獭 2 道、獓狠 2 道）；跃下露头时不可选中、落地离落点 ≤ 0.15 m；飞临 1.8 s 落到终点；击退 8 m/s 推开 1.07 m（理论 1.07）；上抛 6 m/s 最高 0.64 m（理论 0.69）；啸獭吃元素眩晕停摆、醒来恢复；举父·坚盾挨 50 只扣护盾、Foe 生命不动。

### 4.5 M7 地图机关清单（2026-11-19）

**数据**：`node scripts/web/export-mechanisms.mjs`（`--check` 只核对）不开 Unity，直接读场景 YAML：按 `m_Script` 的 guid 对上 `G/**/*.cs.meta` 认组件，读序列化字段；Transform 链（`m_Father`）乘出世界矩阵，预制体实例（stripped Transform）按 `m_Modifications` + 预制体根节点补齐；`scenePath` 同 `WebSceneExporter.ScenePath`（同名兄弟 `#序号`，根物体按 `SceneRoots`）；停用的物体 / 组件不导（LevelLayout 引用的照导出器临时激活）。坐标：点 x 取反、四元数 (x, −y, −z, w)、yaw = −Unity eulerAngles.y（这样 `LavaBody.ToLocal` 的公式在网页里原样成立）、本地向量镜像（流向 x 取反、转轴 (x, −y, −z)）、XZ 方向（风向、风暴来向）x 取反。软边界距离场（`Boundary_*_SDF.asset`，RFloat，按 `unity/.gitignore` 不入库）找不到时到主检出取，原样写 `public/assets/unity-levels/boundary/<关卡>.f32`（Unity 坐标，网页按 −x 采样）。
**选源场景**：发布的场景文档（2026-11-16 / 17 导出）是 Unity 编辑器从**主检出磁盘上**的场景导出的，其中 2-1 / 2-2 / 2-3 / 3-3 带着 11-08 没提交的改动（3-3 桥下熔岩比提交版挪了 11 m）。导出脚本把提交版和主检出的场景都读一遍，按「渲染件位置对上发布文档」选源，`mechanisms.json` 里每关记 `source` / `sceneSha1`。

**运行时**：`src/world/mechanisms/MechanismSystem.ts` 由 `UnitySceneView` 在渲染件、碰撞体就绪后按本关数据建（检视页的 ctx 没有玩家时不建；出错只是这张图没有机关）。渲染件按 `userData.scenePath` 找、碰撞盒按场景文档的包围盒对上 `ctx.world.boxes`，一组渲染件绕导出的枢轴动（`Parts.ts`）。调试：`?debug` 时 `window.__mechanisms`（`describe()`、`stormBegin()`、`sandstorm()`、`channels.flood(秒)`、`sluices[i].release(true)`…）。

| Unity 组件 | 场景实例 | 网页 | 说明 / 差异 |
|---|---|---|---|
| LavaVolume + LavaBody / LavaField / LavaFieldQuery（熔岩 v2） | 3-1 ×1、3-2 ×4、3-3 ×49、3-4 ×16、3-A ×1 | 照译 `LavaCore.ts` / `Lava.ts` | 判定体几何、涨落（自动 / 脚本 RiseTo）、踩入（着地 / 贴地扫掠 / 掉进熔岩井）→ SafeGround 下沉托回、击退 0.6 s 内烧死 / 自己走进去拉回、点光与火星、只给 XZ 的查询（地面探测 = `world.groundHeight`）。3-2 ① 铸槽的熔岩面场景里是空 MeshFilter（Awake 才建），运行时按 BuildMesh 现建。**没做**：导航 Lava 区代价 / 涨潮挖洞（网页导航网格没有区域代价和动态挖洞，地面敌人靠「拉回」兜底）、推下台沿（要 NavMesh 网格边查询）、掉落物吸向玩家 |
| SafeGround（玩家，机关用到的部分） | — | 照译 `SafeGround.ts` | 安全点环（0.2 s、8 个、1.5 m）、危险区登记、Sink / Recover。坠落出界仍由 PlayerController 管：Unity 图的出界高度改成 min(−60, 导航最低点 − 40)（原来是出生点 − 25：3-2 / 3-4 的井底比出生点低 30 m 以上，走下去就被拉回出生点） |
| LavaGeyser 间歇熔泉 | 3-2 ×4、3-4 ×4、3-A ×3 | 照译 `LavaFeatures.ts` | 节奏、预警圈、熔柱缩放、玩家扣血 + 掀起、敌人扣血 + 推、岩壳累计伤害引爆。敌人的 LaunchUp 网页没有：给带竖直分量的击退 + 记击退；壳缝发光件（cracks）这几张图本来就是空的 |
| LavaSluice 熔流闸 | 3-3 ×2（射断吊钩）、3-4 ×1（拉闸） | 照译 | 折线切段、熔流头推进、每段 RiseTo、烧槽里的地面敌人、退、冷却 / 次数、浇包倾倒、拉杆；预警长条是贴地半透明条带（`Telegraph.ts`） |
| Quicksand 流沙 | 1-2 ×3 | 照译 `Ground.ts` | 拉力（走 `world.moveBody`）、减速、芯里锁跳（jumpVelocity 归零）、下沉度被吞、敌人拖拽减速；流沙面是贴地圆片 + 自写漩涡着色器（近似 Spiritfire/Water 的漩涡模式） |
| SurfaceZone 冰面 / 冻地 | 2-1 ×5、2-3 ×20、2-4 ×12 | 照译 | 预设、Box / Disc 判定、取最滑的。网页 PlayerController 没有 MotorFrame 的地面加速 / 刹车倍率：每帧把玩家这一帧的速度变化只保留 accel（加速）/ friction（减速）那一份；敌人同法按 enemyAccel，急转按概率滑倒（眩晕 0.6 s） |
| SafeZone + SupplyCamp | 1-3、1-4、2-4、3-4 | 照译 | 每 0.1 s 把进圈的非首领挪到圈外导航点、进营提示。导航不挖洞；商店仍由 StageDirector 开 |
| BoundaryZone 软边界 | 16 张（2-4 没有） | 照译 `Boundary.ts` | 距离场采样 / 梯度、起风推回（4 + 18 × 风力）、白化、兜底环外托回、起风线外不记安全点、敌人拴绳（BoundaryTether 落点） |
| WeatherDirector + WeatherProfiles | 17 张（区域风暴：1-1 驼队营地沙暴、2-A 冰川白毛风、3-1 / 3-A 火山落灰） | 照译 `Weather.ts` | 7 种预设、区域风暴周期、白化、雾 / 主光 / 每种天气一层后处理（PostStack `postEffects.addLayer`）/ 植被风（`uSflWindDir`）/ 跟相机的粒子 / 远幕 / 沙墙、锁定距离（LockOnRange，敌人 AI 读随 M5）。雾按网页空气透视层的基础值换算（晴天原样）；**风声没做**（src/audio 不在本期） |
| WindField | 运行时（飞廉） | 照译 `Wind.ts` | 吸引点、覆盖、推玩家、步速倍率；没有调用方（三领主随 M6） |
| PlateauStorm + LightningStrike + Conductor | 4-1 导体 ×41；雷暴运行时（夔 / 大鹗） | 照译 `Storm.ts` | 票（入场条件 / 渐入渐出 / 回调）、落雷（导体引雷、预警圈 + 雷标、伤玩家衰减到 0.6）、压暗主光 / 环境光（含风格化材质的三色环境）/ 雾、后处理、雨丝。领主还没接：雷暴没有来源，调试 `__mechanisms.stormBegin()`；落点敌人「带电」先挂雷殛（Charge 随 M8） |
| Destructible 可破坏物 | 3-1 ×5、3-2 ×2、3-3 ×6（含两个熔流闸吊钩） | 照译 `Breakables.ts` | 伤害类型位掩码（accepts / weakTo）：子弹 = 射击、拿碎刃 = 近战、玩家方 `combat.explode` 包一层 = 爆炸 + 元素；碎了撤碰撞盒、藏外观、掉落、火药罐、通知 targets。残骸（rubble）在场景里是停用的、没导出；导航不挖洞 |
| BreakableSpan 断桥 | 3-2 ×2（北链桥 Signal、南链桥常设） | 照译 | 抖、塌（碰撞盒当帧撤）、翻滚下落（.NET Random 同种子）、整座断的连锁；桥上的敌人给向上击退（没有 LaunchUp） |
| IcefallIcicle 冰棱 | 2-1 ×5 | 照译 | 打空松脱、重力 26 下落、砸地范围伤害；碎冰堆（fallen）停用没导出：落地后那里没有掩体 |
| LoreNote | 4-3 ×1 | 照译 | 提示卡、第一次读横幅 + 台词 |
| FoundryChannels 熔铜渠 | 3-3 ×1（8 段） | 照译 `Levels.ts` | Flood / Recede / 高位停；魔将倒下退回。**魔将招式接入点**：`stageGates.foundryChannels`（`WarlordMoves.ChannelSurgeMove.onActiveBegin` 有它就 `flood(hold)`、没有才走环带兜底——那个文件归首领那边改） |
| FireGodThrone | 3-3 | 照译 | 熔岩柱跟着渠涨（水平 +45%、uAgitation / uEmission）；美术件 / 程序化回退导出时已选好；两盏灯的强度没做（灯没按路径导出） |
| FoundryWindGate 风闸 | 3-3 | 照译 | 拉杆交互、风箱鼓、炉口火星、风箱道喷火（地火 = 每 0.5 s 烫一下的圈）、19 段铸渠自动涨落、第二次进殿在拉开前不触发（`StageDirector.fightGate`）；炉门灯光没做 |
| FoundryLordGate | 3-3、3-4 | 照译 | 关卡目标（必清据点）完成前领主战不开 + 每 6 s 提示、完成时横幅 + 吼；清关宝箱交给 StageDirector 原有结算 |
| ForgeWellDirector | 3-2 | 照译 | 桥中段震、② 肃清北链桥崩断 + 挂钩放下、④ 第二波铸门亮 → 半开（撤碰撞）、目标完成全开 + 四口熔泉齐喷 |
| ZheduoLevel | 4-1 | 部分 | 开局 3 s 刷穷奇（名册精英）；巡视线 / 巢穴（QiongqiAI.route / lair）、啸獭洞口、三处领主据点门槛随 M5 / M6 |
| MovingPlatform / SceneActivator / WaterVolume | — | M1 已做 | SceneActivator 交互项的 getter 读错 this（每帧抛 TypeError），这一期顺手修了 |
| ForgeWellLift、PlatformCarrier | 场景里没有实例 | 不做 | 只在 Unity 冒烟套件里用 |

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
| 界面 | 66 个 C# / 13.5k 行 + 9 份 USS / 5.3k 行，三种字体（Noto Sans SC、霞鹜文楷子集、Barlow Condensed）；四层路由。网页没有的界面：图鉴（含运行时缩略图棚）、地图 + 标记 + 罗盘条、关卡卡片、确认框、按键说明、灵宠面板、精英灵契、秘卷触发弹字、瞄准镜、六向受击弧、可合并的提示队列。重做的：HUD 血盾 / 武器 / 技能环、伤害数字（按目标合并、池 80）、敌人血条、首领血条、设置页（由 GameSettings 生成） | `src/ui` 13.75k（其中 8.6k 是旧三英雄的展示）、CSS 5.7k、系统字体。M11c 第一期后：四层 + 路由、Toolkit 部件、HUD 部件、暂停 / 设置照 Unity，样式由 USS 转出，打包字体 | DOM + CSS：USS → CSS 转换（`-unity-*` 属性只有 94 处；UI Toolkit 默认纵向 flex，要加基准重置），1920×1080 四层缩放，webfont 取代 SDF 字体，Painter2D → SVG / canvas |
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
5. `tests/frost-tanks.test.mjs` 的「玄龟旋壳最多反弹两次」偶发失败（约 1/15：1.0 s 时还在缩壳没进旋转，出生 / 路径计时里有 `Math.random()`），M5 之前的基线一样，不是新回归。
6. **4-1 残鼓位置（Unity 构建器的错）**：`Level_4_1.BuildLords` 用 `ShowcaseSceneBuilder.Place(KuiDrumId, arena.transform, G(drumXZ), …)` 把世界坐标当成场地下的局部坐标，残鼓落在 (−205, 48.5, 131)，离夔的出生点（设计上残鼓就在这里）112 m；Unity 的 KuiDrum.Ensure 也按名字找到它，登场演出看的是远处那面鼓。网页（`lords/KuiDrum.ts`）离出生点 > 12 m 就把它挪回出生点（贴地高度不变）。
7. **发布的场景文档带着主检出没提交的场景改动**（M7 导出时发现）：2-1 / 2-2 / 2-3 / 3-3 的 `scenes/*.json` 是从主检出磁盘上 11-08 改过、没提交的 `.unity` 导出的，入库的 `.unity` 是旧的。`export-mechanisms.mjs` 按渲染件位置选源；以后重导场景 / 重新生成关卡前先决定那几份场景改动要不要提交。
