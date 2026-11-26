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
| M6 | 首领框架 + 登场镜头 + 旱魃 + 魔将 v2 + 鲲鹏 / 麒麟数值阶段 + 三领主 | ~20k | 🔶 首领框架（`src/enemies/bosses/framework/`：BossDef 定档 / 阶段表、BossBrain、BossMove、破防条、召唤上限、领主梯度、倒下演出、时间缩放仲裁、关卡钩子）、登场演出导演（`bosses/intro/`）、旱魃全套 ✅ 2026-11-17（87cd9188…fed45ef1；对照测试 `tests/hanba-boss.test.mjs`、`tests/boss-intro.test.mjs`；实机脚本 `scripts/hanba/fight-shots.mjs`）。1-4 走进泉床正常触发（c33c5467）。火麒麟 / 鲲鹏 ✅ 2026-11-18（0c0168ff…07ebf638：火麒麟定档 28000 + 2400 护甲、85 / 70 / 55% 刻度、狂怒长啸 / 熔流轮转 / 鳞冠；鲲鹏定档 16000 + 4800 护盾、75 / 50 / 25% 鲲怒 / 化鹏 / 鹏狂怒；对照测试 `tests/qilin-boss.test.mjs`、`tests/kunpeng-boss.test.mjs`；实机脚本 `scripts/kunpeng/fight-shots.mjs`、火麒麟同目录）。魔将 v2 ✅ 2026-11-18（0d97befe…b288e282：九招、高台砸落登场、狂怒换挡、零星陨石，`WarlordPoser.ts` 按 Blender 姿势表在网页现场烘焙 v006 骨架的手 K 片段，释放帧等片段事件；对照测试 `tests/warlord-boss.test.mjs` 42 条；实机脚本 `scripts/warlord/fight-shots.mjs`）。2-4 / 3-3 走关卡正常触发：Unity 首领场（`boss:`）照 `BossEncounter.PlayerInArena` 不看视线；3-3 的矩形首领场半径盖到高台出生点。4-1 三领主进首领框架 + 据点模式 ✅ 2026-11-19（113789d6、f85f8715）：`src/enemies/bosses/lords/`——领主底座（LordDef 4-1 难度 3.4 定档、tempo 0.9 / 0.75 × 领主梯度；LordBrain 片段按设计时长拉伸、片段事件出手、顿帧只顿首领、招式驱动位移、弱点开关、死亡演出交给登场导演播；LordMove）；飞廉七招 + 擂台风 + 风雷珠珠碎 + 龙卷风柱（柱身可点火）+ 风涡柱；化蛇六招 + 圣湖游线 / 涨水面 / 泡水 / 漩涡 / 湿身雷殛；夔八招（不依赖雷暴的部分）+ 残鼓（导出位置错 112 m，挪回出生点）+ 召鼓，落雷 / 导体回劈 / 高原雷暴经 `lords/KuiStorm.ts` 的 `bindKuiStorm` 接 M7（`MechanismSystem` 建好雷暴后绑定，fc87b69b；4-1 实机：登场雷劈经幡杆、二阶段压暗下雨）；框架补破防条条件填充（BreakBarDef.fillWhen）。据点模式：`scripts/web/export-level-objectives.mjs` 从场景 YAML 导出 `objectives.json`（灵火坛 / LevelObjective / BossEncounter / ZheduoLevel 门槛圆），`src/world/objectives/`（SpiritAltar、LevelObjectives）——领主战不是终点战，倒下 6.3 s 后结算并点亮本据点灵火，6 座里点亮任意 3 座才清关开出口（4-3 同样 5 选 3）。对照测试 `tests/lord-bosses.test.mjs`（照 LordTests.cs）；实机脚本 `scripts/lords/fight-shots.mjs`。待办：夔的落雷 / 经幡杆带电与回劈 / 高原雷暴 / 召鼓充电（M7 合进来后 bindKuiStorm）；二阶段起带电（Charge.Hold，M8）；化蛇湿身灼烧减半（M8 状态）；飞廉的风接全局 WindField、顺风逆风步速（M7）；镜像片段 sidestepL / wheelR 与夔的 sink 没导出（退回 sidestep / wheel / kneel）；目标栏文字（界面）；邪飞天的和弦护盾 / 赐福；首领特效（旱魃日火贴花 / 水幕沙幕，鲲鹏浪墙 / 扶摇柱 / 水冠，火麒麟火浪，魔将火尾 / 火舌体积、`T_Boss_Warlord_E` 发光遮罩、登场转场风）随 M11b；鲲鹏 / 火麒麟 / 旱魃换动画片段与首领顿帧 ✅ M12 第二期（2026-11-21，b829e50c、aa67eca3；火麒麟登场 / 回步态修正 61a1a14a、a0ee1274、7387884c、5e8b244d）：模型层接 `src/anim/ClipPlayer`（旱魃是 `HanbaAnimator.bindClips`），片段触发照 Unity（鲲鹏 `KunPengBrain.Act`：控制器自己连段的扑咬 / 猛砸 / 破水不重播，落台 / 起飞 / 收羽的时刻照抄；火麒麟 `PlayAct` 的交叉淡入秒数逐个照抄，登场只在现身播一次 tuck、落地播一次 rear），收招 / 转换结束 / 登场结束 / 硬直结束照 BossBrain 的 `PlayLocomotion` 无条件回 Locomotion（已在步态里也 0.15 s 自我过渡；打断不回，同 AbortMove；框架加 `onStaggerEnded` 钩子），片段事件进招式 cue，音效 / 震屏仍由招式自己播；鲲鹏释放帧顿帧 `impactHold` 七处招式 + 化鹏展翅，秒数同 Unity（只顿片段，×0.05 → ×1.6 追回；火麒麟 Unity 本来没有顿帧，旱魃照旧）；化鹏展翅接 spread 事件；鹏倒下播手 K death（翼折 / 栽落 / 触地 land / 最后一声，倒下特效先用 ctx.fx，正式件随 M11b）；火麒麟倒下片段 97% 冻住；魔将熔铜渠涨落已接 3-3 神范台的熔铜渠（fc87b69b：引渠 + 每段 hazard 预警、倒下退渠；渠里冒泡 / 涌浪外观随 M11b） |
| M7 | 地图机关：熔岩 v2、流沙 / 地表 / 边界 / 可破坏 / 断桥 / 风场、天气、各图专属脚本 | ~10k | 🔶 2026-11-19：导出（`scripts/web/export-mechanisms.mjs` 直接解析场景 YAML → `mechanisms.json` + 软边界距离场）、运行时（`src/world/mechanisms/`，UnitySceneView 搭好后建）、对照测试 `tests/unity-mechanisms.test.mjs`、实机脚本 `scripts/web/mechanism-shots.mjs` ✅；清单、差异与待办见 4.5 |
| M8 | 玩家与战斗增量：战斗契约（灵宠伤害源、弱点倍率、命中区）、状态（寒意 / 引燃 / 日灼，带电随第四章）、弹体（弱点判定、护罩、落地滚动）、镜头手感 / 卡帧 / 安全落点 / 移动特效、武器（散布手调、冲刺禁射、喷火锥、磁轨光束）、技能（施法姿势、特效换风格） | ~12k | ✅ 2026-11-21（fa5ebf28、ef7a6719、08e1215d、80d45480），对照清单见 4.6：战斗契约（灵宠伤害源只做类型与接口、弱点伤害 + 秘卷「破绽」、命中区、不可选中返回 immune 并节流派发受击事件）、带电 + 死亡传电 + 领主常驻带电、顿帧、多挡弹区 + 球罩、落地滚动、镜头手感（trauma² 震屏、受击冲击按来向、开枪一顿、阵亡倒地）、移动特效、坠落托回安全点、玩家减益（寒意 / 点燃 / 日晒，敌人侧入口已转过来）、武器（扳机闩、冲刺禁射、开镜规则、散布手调、镜头后坐 × 0.3 完全回正、光束共用冷却、喷火锥、贯虹虹光）、技能（施法姿势、拒绝事件、出手点、磐的挡弹罩 / 贴地起跳 / 锁冲刺）。焚雷扩散取最近 16 个。M13 对照测试对出、落在 M8 的五条全部照 Unity 改完（4.6「M13 对出的不一致」）。复审后（2b51eaee…）：死亡传电照 Unity `Nearest` 选目标、同步重入时外层只传到这一跳、命中区整发格挡弹「格挡」、局内货币统一叫灵石（`src/ui` 除外）；rebase 到 master 后 `tests/unity-*.test.mjs` 七处随改、能转的 todo 转成断言。对照测试 `tests/m8-combat.test.mjs` / `m8-player.test.mjs` / `m8-weapons.test.mjs` / `m8-parity.test.mjs`（常量读 C# 源码比）；实机脚本 `scripts/web/m8-shots.mjs`。待办见 4.6 末尾 |
| M9 | 灵宠（全新） | 4.1k | ⬜ |
| M10 | 第一人称持枪手感 + 碎刃表现 | 5.8k | ✅ 2026-11-24（11-26 复核修正、对照测试去掉 Unity 依赖、实机重跑 104 / 104），对照清单见 4.8（分支合并时哈希会变，提交按标题查：「M10 碎刃第一人称照 Unity」「M10 第一人称持枪手感照 Unity」「M10 赤蛟霰铳折开换弹照 Unity BreakAction」「M10 补齐 WeaponHandlingTests / BladeFirstPersonTests 剩下的三条对照」「M10 握点与第一人称手臂对 Unity 武器表 / 英雄表」「M10 实机核对脚本与截图」「M10 对照清单与计划表」「M10 复核修正」「M10 对照测试不再读 unity/」）：持握表（HandlingProfile 预设 × 17 把的改项）、`FirstPersonViewmodel` 的弹簧手感（鼠标滞后 / 侧倾 / 前后 / 竖直 / 落地，按枪重放慢）、后坐每发叠加上限 2.4 倍 + 显示弹簧、枪模后坐 × `ViewKickScale` 0.55（向后再 × 0.76）、整匣换弹按包络叠换弹姿态、弹匣入位一顿并发加弹事件（`WeaponSystem.commitLoad` = Unity `CommitLoad`）、左手按时间线去送弹口 + 前臂两骨 IK（`weapons/TwoBoneIK.ts`）、零件（弹匣偏移 / 俯仰 / 管式隐藏、转轮甩出自转、泵动行程、赤蛟霰铳折开与膛口弹壳）、三才转轮换元素亮闪、灵炮蓄力灵纹、武器染色；碎刃第一人称（第三段新关键帧、伸刃、出刀 / 判定帧 / 收势事件、命中视觉顿帧 40 / 70 ms、刀光月牙、剑指补两根手指、光点、命中镜头冲击与顿帧申请，视觉顿帧按真实帧时长 `ctx.time.rawDt`）。对照测试 `tests/m10-handling.test.mjs`（27 条）/ `tests/m10-blade.test.mjs`（19 条），期望值照 C# 抄成常量（注明文件:行号），不读 `unity/` 也不读 `unity-gameplay/defs.json`；运行时不读任何 Unity 导出物；实机脚本 `scripts/web/m10-shots.mjs`。待办：刀光 / 判定帧火星换特效预设、第三段的世界大弧（M11b）；第一人称曝光补偿（M11a） |
| M11a | 渲染观感：StylizedLit / Terrain / Foliage / Fur 着色、材质参数导入、后处理栈、三色环境光 / 雾 / 天空、CSM | 7.6k 着色器 | 🔶 材质 ✅ 2026-11-16（1f213358，`src/world/UnityStylizedLit.ts`：色阶、阴影染色、阶梯高光、边缘光、地形高度混合 / 宏观噪声 / 坡度压暗 / 陡坡三向投影、植被风摆与背光透射，Trilight 投成 SH 环境光）；太阳阴影照 Unity 管线（0564dd10，2048 贴图、90 m、跟相机）；云天 + 逆光光柱接入（52c719c6）；后处理栈 ✅ 2026-11-18（646f7eae，`src/render/PostStack.ts`：HDR 目标 + URP Bloom + 照 URP Color.hlsl 写的 Neutral + 每关 Volume 调色烘 LUT + 暗角 + 色差 + 低血 / 受击 / 冲刺玩法屏效；`scripts/web/export-volume-profiles.mjs` 从 27 份 Profile 导出 `volumes.json`，含 3-3 火神王座局部 Volume 的盒子混合；`?post=0` 或低画质绕开）。待办：AO、3-3 第一人称手被泛光吹白、1-2 比 Unity 偏灰（大气在 ACES 下调的，要按 Neutral 重调）、Fur、导出器补 `_ORMMap` / 关键字 / 地形材质参数、流动雾带与小活物逐图摆位 |
| M11b | 特效核心：预设 JSON + 粒子引擎、线条、灯光池、贴花、预警圈、溶解、状态皮肤（首领专属特效随 M6） | 5k + 6.4k | ⬜ 注意：网页版已有一批「特效分层」（703950b2 / dd6db46d / 49b82303：`Fx.ts` 的余韵、`Seal.ts` 国风法印、三种新粒子形状、狐 / 熊 / 隼技能，准则 docs/art/fx-style.md 第五节），换粒子引擎时要一起迁过去，不能丢 |
| M11c | 界面：USS → CSS、四层路由、字体、约 10 个新界面、HUD 部件重做 | 13.5k | ✅ 2026-11-21。第一期（基础 + HUD）✅ 2026-11-19（3f892251…ed68a128）：`scripts/web/convert-uss.mjs` 把 9 份 USS（763 条规则）转成 `src/ui/css/unity/*.css`（`--check`；`-unity-*` 映射表 MAPPED / 转不了的 UNSUPPORTED，现在只有 theme 的段间距一处），UI Toolkit 默认值的网页基准在 `src/ui/css/sf-base.css`（零优先级：纵向 flex、border-box、最小尺寸 0、`\n` 总换行）；`scripts/web/publish_fonts.py` 把三种字体（正文子集 + 余量、霞鹜文楷子集、Barlow Condensed）转 WOFF2 发布到 `public/assets/fonts`，@font-face 带按字表生成的 unicode-range（余量 4 MB 用到才下），旧 gf-* 界面的字体变量也换成它们；`src/ui/toolkit/`：四层（Hud / Overlay / Modal / Toast，1920×1080 Expand 缩放）、路由（栈、返回、焦点还原、方向键空间导航与连发、滑条左右调值）、提示队列、横幅、黑幕、闪光、图标、FitLabel；`src/ui/hud/`：生命护盾、武器槽、Q / E 技能盘 + 冲刺格、武器技能 V 盘、信息角、准星、六向受击弧 + 闪屏 + 低血暗角、伤害数字（池 80、按目标合并：Feedback 把敌人放进 `DamageNumberOpts.target` 交给 UI）、头顶血条、首领条（BossDef 刻度、无敌、破防条）、交互提示卡、中央大字、反应首遇教学卡；`src/ui/screens/`：暂停、设置（按设置表生成三页）。对照测试 `tests/uss-convert.test.mjs`、`tests/ui-router.test.mjs`；实机截图 `node scripts/web/ui-shots.mjs <端口>` → `docs/art/review/threejs-migration/ui-*.jpg`。与 Unity 的差异：目标文字没有遭遇 / 出口的 SetObjective 钩子，按同样格式从关卡状态拼；技能「放不出来」闪红靠按键时没有充能判断（技能系统没有拒绝事件）；网页武器没有预热转速、元素轮转「下一发」的读数（转速条 / 转速环不出现，三才转轮显示金圈「三」）；设置页没有显示模式 / 分辨率 / 垂直同步 / 帧率上限 / 屏幕特效 / 瞄准辅助（网页无对应设置），多一项阴影精度；暂停「返回主菜单」照网页现状不结算、总要二次确认（续玩随 M11d）；UICapture 不需要（浏览器截图本来就带界面）。**第二期** ✅ 2026-11-21（分支合并前 rebase 过，这里写提交标题不写哈希，`git log -F --grep '<标题>'` 可查：「确认框、按键说明、设置「按键」改键页与键位表」「HUD 新部件」「新界面与旧界面重做」「界面全部走新路由」「罗盘条与全图的方位照 Unity」「图鉴敌人页照 Unity 名册」「清掉旧 gf-* 界面的残留」「M11c 第二期路由规则与数据映射对照测试」「M11c 第二期 1920×1080 实机截图 26 张」；审查后的修正「Tab 行囊常驻属性照 Unity StatGrid.KeyStats」「精英印章的词缀纹样改用词缀本身的颜色」「图鉴武器缩略图摘掉掉落模型的稀有度光晕再取景」「关卡卡片只在出口进门时弹」「局内货币在界面上叫灵石」「秘卷代价行照 Unity」「ui-screens 补对照——行囊属性表」「M11c 第二期截图按审查修正重拍」「掉落 / 宝箱 / 商店提示里的局内货币改叫灵石」）：新界面——确认框、按键说明、设置「按键」改键页（`src/ui/KeyBinds.ts` 键位表：改键只换第一个键盘键、存 localStorage 只存改过的、套到 `ctx.input.bindings`）、图鉴（`src/ui/codex/`：收录存档、条目清单、离屏缩略图棚 `CodexThumbs`、局内收录 `CodexTracker`；敌人页照 Unity 名册只列 44 条、章内按 [Defs] 序、首领「首领 · 称号」，网页注册表里旧三英雄名册与首领附属件不列）、M 键全图 + 罗盘条（`MapMarkers.ts` 地点表；方位照 Unity：北 = +Z、东 = −X，导出器只翻 X）、关卡卡片（出口进门 `Portal.enter` 换关前问 `IUI.stageCard`，同 Unity `GameSession.CompleteStage` 只在真正过关时弹；检视页跳关 / 重置直接 `game.advance` 不弹）、HUD 部件精英印章 / 秘卷触发弹字 / 狙击镜遮罩 / 灵宠面板（数据走 `PetSource`，M9 接之前是空态壳）；旧界面迁到新路由与 USS 样式——主菜单（CSS 远景 `MenuBackdrop` 垫底）、选英雄（嵌旧 3D 预览台）、天赋、整局结算、秘卷三选一、Tab 行囊（含灵宠页）；文字映射集中在 `ScreenData.ts`；层位登记在 `UI.ts` 的 SCREEN_SLOTS（全部 done）。旧 gf-* 界面与样式删掉：`base.css` 只留容器文字基准（原来的 `.gf-ui button { font: inherit }` 一直盖着 USS 按钮字号），`dom.ts` / `labels.ts` / `icons.ts` 只剩新界面在用的；`src/fx/Fx.ts` 不再挂 `src/fx/DamageNumbers.ts`（文件没动，现无引用），`fx.damageNumber` 转交 UI 的 HUD 数字。对照测试 `tests/ui-screens.test.mjs`（路由规则 / 热键 / 键位 / 按键说明对 Unity C#，各界面文字映射对 Unity 字面量，图鉴名册 / Lore / 分页 / 存档，全图投影用 1-1 真数据），`tests/adventure-ui.test.mjs` 改测新地点表。实机 `node scripts/web/ui2-shots.mjs <端口>` → `docs/art/review/threejs-migration/ui2-*.jpg`（28 张，1920×1080；审查第一轮后重拍，多了高风险卷的三选一卡面与图鉴说明两张，关卡卡片改走出口进门）：每张在页面里核对 USS 写死的长度 / 颜色 / 排版值（27648 项零不一致；宽高只有图鉴详情大图框被 flex 压 5 px，Yoga 同样会压）、摘掉全部 gf- 规则前后 sf 元素计算样式不变、页面报错 0（worktree 里跑要给 vite 放行主检出的 node_modules，见脚本头注释）。与 Unity 的差异：灵宠本体没迁（M9），HUD 灵宠面板不显示、行囊灵宠页 / 图鉴灵宠页签是空态；秘卷系统没有「触发」事件，秘卷触发弹字只有入口 `UI.scrollProc(id)` 没有调用方；精英印章的词缀纹样是 canvas 简化版（Unity 纹样随金环属 M11b）；关卡卡片没有「重来本关」（没有进关快照，M11d）；秘卷卡面没有「当前 → 下一层」属性预览（网页秘卷定义没有 PreviewStats）；行囊武器卡数值格用武器系统的描述，条数随武器而定（Unity 固定六格）；全图上没开的出口不上图（网页清场后才定出口）、场地没有「前置场地」只按远近挑目标；主菜单 / 选英雄没有 3D 菜单场景（CSS 远景 + 旧预览台）；没有手柄（按键说明与改键页手柄一列写「—」、设置主菜单副标题去掉「手柄」）；胜利题记按网页 `CHAPTER_COUNT`（4）写「四章尽破」，Unity 写死「三章尽破」；图鉴缩略图拍绑定姿势（Unity 先求动画第 0 帧）、连鼓灵没有网页模型（单字签） |
| M11d | 核心：存档迁移、续玩、时间仲裁、卡帧、模态栈、画质档、剔除 | 7.6k 中约一半 | ✅ 2026-11-21（提交见 git log 的 `feat(core): M11d …` 一组；rebase 到界面第二期之后旧哈希失效），对照清单见 4.7：存档信封（`core/SaveService.ts`：版本 / .bak / .corrupt / 迁移，localStorage 一文件一键；老存档 `gunflame.meta.v1` 按信封 v1 迁成 meta / career 两段，老键不动）、元进度与生涯（`progression/Meta.ts`：一局只结一次、天赋开局快照）、设置表（`core/GameSettings.ts`：设置页由表生成，补帧率上限 / 屏幕特效；老设置导入时把 M11e 之前的音量按旧缺省换算，听感不变）、续玩（`progression/RunSuspend.ts`：每进一关写进关快照，主菜单「继续征程」、暂停「返回主菜单」暂离不结算、没结算的局回主菜单按失败结算）、时间仲裁提到 core（首领框架原处转出口）+ 模态栈 + 顿帧 + 清场慢动作 + 手感表、三档画质参数表（渲染比例已接）、Unity 场景小件 / 散布件按距离剔除、性能预算、平衡模型与经济投影（`progression/BalanceModel.ts`，`?debug` 的 `__balance()`）。对照测试 `tests/unity-core-time` / `unity-core-save` / `unity-core-quality` / `unity-balance` / `unity-core-flow`；实机 `node scripts/web/core-check.mjs <端口>`。2026-11-22 按审查修：阵亡当场结算（慢动作里不能暂停 / 暂离）、进关快照先于 `stage:loaded`（暂离 → 继续不再刷聚宝盆 / 弹药）、换关载入失败不结算、放弃旧征程等场景清单；第 2 轮：清单没到时确认框照弹（宽松读续玩档，和放弃同一个判断）、放弃旧征程之后再定新局路线；rebase 到界面第二期之后「继续征程」接到新主菜单，出征前的确认框接上；局流程测试 `tests/unity-core-flow`。待办：画质表其余列（各系统那一期接）、顿帧的斩击 / 技能直接来源与武器 / 秘卷的正式读档入口（M8） |
| M11e | 音频：改播烘好的 ogg + WebAudio 总线 | 1.3k | ✅ 2026-11-18（db6ae16d；素材 ba1adca8：`scripts/web/publish-audio.mjs` 把 Unity 的 246 个音效片段 + 8 条曲目 / 声床 + 清单拷到 `public/assets/audio`，核对 OggS / DLP 密文，`--check` 逐字节）。`src/audio/AudioSystem.ts` 照 GameAudio 播 ogg：48 声道抢占、同 id 节流 + 敌方音色单独节流、密集音、k^1.6 衰减、近处声像收窄、远处 / 背后低通、遮挡（`ctx.world.raycast`）、I6 三层分层、光束循环、配乐交叉淡化；`AudioMixer.ts` 照 Spiritfire.mixer 搭总线与快照；MusicDirector / AmbienceDirector（每章声床、章节混响送、3-3 混响区）/ AudioDuck / UISound 照译；规则与常数在 `AudioRules.ts`，对照测试 `tests/audio-parity.test.mjs`。设置补环境音 / 界面音两档，五档缺省改成 1（同 Unity）。退路：清单 / 片段读不到退回老的实时合成配方。待办：老存档里的音量是旧语义（M11d 存档迁移时换算）；SFX Reverb 是卷积近似；3-3 的混响区照 Unity 挂在世界原点（离主路远，多半听不出，Unity 同样）；WeatherDirector 的风声随天气系统迁 |
| M12 | 动画：native-anim → AnimationClip、Blender 片段导 GLB、控制器状态机与事件、CreatureRig | 1.8k 运行时 | 🔶 第一期 ✅ 2026-11-16（51e4bf35）：`npm run` 外的 `node scripts/web/export-native-anims.mjs` 把 52 个资产 469 个采样片段导成 `public/assets/anim/*.json`（3.5 MB，带 231 个片段的事件）；`src/anim/` 复刻 Animator（一维混合树、任意状态 / 退出时刻转换、加法受击层、逐帧事件）、CreatureRig（脚步探地 + 两骨 IK、看向、受击弹簧、弹簧骨）、CreatureLocomotion；检视页 `anim-lab.html`。第二期 ✅ 2026-11-21（6565af60…7b831709；审查修正 61a1a14a、a0ee1274、a128c4d1、40507fe1、7387884c、0f008982、5e8b244d）：`scripts/web/export-keyframed-anims.mjs` 在 Blender 后台原样跑各资产的 `*_anims.py`、逐帧采样成和采样片段同一种 JSON（不走 GLB；鲲 7 / 鹏 13 / 火麒麟两形态各 10 / 旱魃 10 / 商人 2 / 第四章五种敌人 6，共 58 个手 K 片段，54 个资产 4.1 MB）；`src/anim/ClipPlayer.ts`（Animator + CreatureLocomotion + CreatureRig + EnemyAI 的 Play / PlayTimed / PlayLocomotion，数据异步读，读好之前和没有片段的资产照旧程序化摆姿势）；前三章 27 种敌人按各类的 `clipCues` 表（AI 状态 → 片段，照 Unity 各 AI 的播放调用）播片段，眩晕 / 硬直播 Hit、受击弹簧 + 叠加层 Flinch、死亡冻住；第四章七种敌人（`world/plateau/play/foe.ts`）片段按招式总长拉伸、stun / stagger / hop / flee；首领（见 M6）：鲲鹏、火麒麟两形态、旱魃的模型层换成片段，片段触发 / 交叉淡入照 Unity，收招 / 转换 / 登场 / 硬直结束照 `PlayLocomotion` 无条件回步态，鲲鹏释放帧顿帧，鹏的手 K 倒下（`CreatureAnimator` / `ClipPlayer.update` 加 animDt：顿帧只压状态机的时间）；商人（`src/progression/loot/Merchant.ts`）：商铺强化台旁边摆狸猫行商，玩家走近 / 刚成交 Talk、走开 Idle——Unity 版没把行商摆进商店，照叠加表的用法做。对照测试 `tests/anim-keyframed.test.mjs`（Unity events.json 逐条、片段表对 Unity AI、第四章 / 旱魃出手事件 ≤ 1 帧；照 Unity KunPengTests.KeyframedClips_EventsLandOnTheMoveTimeline 逐条、鲲鹏片段触发对 Act、顿帧秒数对 ImpactHold、火麒麟 PlayAct 淡入秒数、商人）；实机脚本 `scripts/anim/enemy-clip-shots.mjs`（普通敌人逐章）、`scripts/anim/boss-clip-shots.mjs`（鲲鹏 / 火麒麟 / 旱魃走关卡触发、商人），截图 `docs/art/review/threejs-migration/m12-*.jpg`。与 Unity 的差异：鲲鹏猛砸 / 潜袭 / 吐冰 / 狂风的出手与落台的离台仍按时间轴（Unity 的 WindupDone / ActiveDone 等片段事件 hit / projectile / gustStart / liftoff，事件落在时间点 ≤ 1 帧；火麒麟的鳞刃 / 狂怒长啸已经等 hit）；鲲鹏片段的 sfx: / fx: 事件不转（招式自己播，Unity 是 ClipsDriveSfx 时招式不播）。待办：老八种敌人 / 沙傀 / 连鼓灵没有片段（程序化）；魔将 11-07 换骨架后采样片段失效（`WarlordPoser` 现场烘焙）；第四章提前收招时片段跳到收招段（FinishActive）与释放帧顿帧（ImpactHold）、招式时间点跟片段事件走（现在只按时间轴）；鹏倒下的翼折 / 触地 / 长啸专属特效（M11b）；镜像片段 sidestepL / wheelR 与夔的 sink；布娃娃 |
| M13 | Unity EditMode 对照测试 → `node --test` | — | 🔶 2026-11-21：伤害乘区 / 战斗管线 / 属性表、元素反应、词条 / 传说、武器解析与掷骰、武器描述、秘卷（定义与公式）、精英词缀与站位、开火计时常量——8 份 `tests/unity-*.test.mjs`；75 份 Unity 测试逐份的去向和对照出来的不一致见 7.1 / 7.2。待办：FireMode / WeaponSpecials / Hero / Motor / Projectile 的行为用例（等 M8）、秘卷逐卷触发、Hazard / BossHazard |

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
| FoundryChannels 熔铜渠 | 3-3 ×1（8 段） | 照译 `Levels.ts` | Flood / Recede / 高位停；魔将倒下退回。**魔将招式接入点**：`stageGates.foundryChannels`（`WarlordMoves.ChannelSurgeMove.onActiveBegin` 有它就 `flood(hold)`、没有才走环带兜底；fc87b69b 已接上，3-3 实机引渠 1 次、兜底 0、8 段预警） |
| FireGodThrone | 3-3 | 照译 | 熔岩柱跟着渠涨（水平 +45%、uAgitation / uEmission）；美术件 / 程序化回退导出时已选好；两盏灯的强度没做（灯没按路径导出） |
| FoundryWindGate 风闸 | 3-3 | 照译 | 拉杆交互、风箱鼓、炉口火星、风箱道喷火（地火 = 每 0.5 s 烫一下的圈）、19 段铸渠自动涨落、第二次进殿在拉开前不触发（`StageDirector.fightGate`）；炉门灯光没做 |
| FoundryLordGate | 3-3、3-4 | 照译 | 关卡目标（必清据点）完成前领主战不开 + 每 6 s 提示、完成时横幅 + 吼；清关宝箱交给 StageDirector 原有结算 |
| ForgeWellDirector | 3-2 | 照译 | 桥中段震、② 肃清北链桥崩断 + 挂钩放下、④ 第二波铸门亮 → 半开（撤碰撞）、目标完成全开 + 四口熔泉齐喷 |
| ZheduoLevel | 4-1 | 部分 | 开局 3 s 刷穷奇（名册精英）；巡视线 / 巢穴（QiongqiAI.route / lair）、啸獭洞口、三处领主据点门槛随 M5 / M6 |
| MovingPlatform / SceneActivator / WaterVolume | — | M1 已做 | SceneActivator 交互项的 getter 读错 this（每帧抛 TypeError），这一期顺手修了 |
| ForgeWellLift、PlatformCarrier | 场景里没有实例 | 不做 | 只在 Unity 冒烟套件里用 |

### 4.6 M8 玩家与战斗对照（Unity → 网页，2026-11-21）

对照方法：`G/Combat/`、`G/Player/`、`G/Weapons/`（不含 `GunfireOriginal*`、`DemonBlade/`、`Affixes/`、`Legendaries/`、`Handling/`）、`G/Skills/`、`G/Core/HitStop.cs`、`G/Fx/CameraShake.cs` 逐文件读；Unity 这几块本来就是照 TS 移过去的，所以先找「Unity 改过 / 新增」的地方照改，其余只锁常量。三份测试 **直接读 C# 源码** 比常量（`CombatTuning.cs` 是状态 / 反应数值的单一来源），行为断言照 Unity EditMode（Ch4FoundationTests 的带电、FireModeTests 的扳机与冲刺禁射、CastPoseTests、WeaponSpecialsTests、ProjectileTests）。

记号同 4.4：✅ 一致 · 🔧 本期照 Unity 改了 · ➕ 本期新增 · ⬜ 还缺（写明归哪期）。

**战斗契约与结算（`G/Combat/`）**

| 机制（Unity） | 网页 | 结论 |
|---|---|---|
| 伤害来源 `DamageSource.Pet` / `DamageTag.Pet`：只乘「灵宠伤害」，不随机暴击（forceCrit 由灵宠自己给），不吸血、不顿帧 | `combat/PetContract.ts`（`petHit`）、`DamageCalc.isPetHit`、属性 `petDamagePct` | ➕ 只有类型和接口，灵宠本体 M9 |
| `Combat.ForceWeakpoint`（白泽「万鬼图」：武器 / 技能 / 爆炸直接命中改判为弱点，只影响暴击与弱点加成） | `PetContract.addForceWeakpoint` + `Combat.damageEnemy` | ➕ |
| 弱点：必暴，再乘 `WeakpointDamagePct`；命中盒 `multiplier`；进攻卷「破绽」`weak_point`（精良、3 层、弱点伤害每层 +15%，Unity 独有 D12） | `weakpointDamagePct`；`enemy.weakpointDamageMult`；`defsOffense.ts` 表尾加「破绽」（前 24 张顺序不动），秘卷共 119 张 | ➕ / ✅ / ➕（M13 对出） |
| 命中区 `HitZone` + `EnemyBody.ZoneAt / ZoneIncoming`：倍率、弱点开关、启停、朝向门（cos 0.34）、半径缩放、累计到 breakAt 发一次；分区容差 0.08 m、退到 0.5 m 内最近的普通区；倍率 < 0.5 记格挡 | `combat/HitZone.ts`（`HitZoneSet`），`Combat.damageEnemy` 读 `enemy.hitZones` | ➕ 现有敌人仍用各自的 `raycastHit / guardFactor`（数值相同，4.4），新移植的敌人挂 `hitZones` 即可 |
| 弱点规则 `WeakpointRule`：先进身体、往前 1.5 m 内穿过同一单位的弱点按弱点算（命中扫描、投射物同一条） | `EnemyBase.raycastHit`、`Projectiles` 的敌人命中、`HitZone.weakHit` | 🔧（原来是「身体明显更近才算身体」） |
| 贴脸：射线起点在敌人胶囊里直接算命中 | `rayVerticalCapsule` 起点在圆柱内返回 0 | ✅ |
| 暴击 / 属性乘区 / 雷殛标记 ×1.15 / 输出修饰器 / 分层 / 吸血上限 5%（≥ 2）/ 爆炸嵌套上限 6 / 爆炸波及玩家 | `Combat.ts`、`DamageCalc.ts`、`Blast.ts` | ✅ |
| 免疫 `Combat.Immune`：打不可选中的敌人返回 `DamageResult.immune = true`（不结算），直接命中 0.4 s 节流地派发 `EnemyDamaged`；持续伤害跳伤 / 处决 / 0 伤害不提示；格挡掉全部伤害（total 0、blocked）也派发，`DamageNumbers` 弹「格挡」（`blocked && total < 1`，处决不弹）；没被格挡的 0 伤害不派发、不弹字 | `Combat.damageEnemy` 第 0 步返回 `immune` 结果（原来返回 null、不派发）；`DamageResult.immune`；命中计数 / 引爆 / 词条 / 斩击 / 技能冲击波 / 反应的调用方跳过 immune；天雷引、引子三卷照 Unity 加「total > 0」；`Feedback.blocked` 弹「格挡」（`DamageNumberOpts` 没有这一种，按世界浮字出），没被格挡的 0 伤害原来弹「免疫」、现在不弹 | 🔧（M13 对出；格挡提示复审补） |
| 焚雷扩散灼烧 `CombatTuning.Thunderfire.SpreadTargets = 16`：身体中心在 R 内、按距离取最近 16 个（C# 注释写明是有意改的） | `Reactions.runThunderfire`、`TF_SPREAD_TARGETS` | 🔧（原来半径内全部；M13 对出） |
| 击杀结算 `KillResolver`：精英魂晶 ×5、首领 60、精英死亡震屏（半径 2、×0.8）、静默处决没有战果 | `Combat.ts` | ✅ |
| 状态 `Burn / Shock / Corrode / Stun / Slow` 与四种反应、引爆 / 崩解、预算（`CombatTuning.cs`） | `Status.ts`、`Reactions.ts` | ✅ 数值逐项读 C# 比 |
| `StatusId` 一个枚举 8 项 + `StatusRegistry` 按宿主登记（寒意 / 日晒 / 点燃只挂玩家） | 敌人 `StatusId`（5 项）+ 玩家 `PlayerStatusId`（3 项，`player/PlayerStatus.ts`） | 结构不同、集合相同（`tests/m8-parity.test.mjs` 锁住） |
| 带电 `Charge` / `ChargeState`：计时取较大者、常驻持有、就反应而言 = 有雷殛、死亡向 8 m 内最近 2 个同伴传电（带电 6 s、6 点雷伤、深度 1），连锁 ≤ 4 跳，首领不接不放；选目标 `ReactionSystem.Nearest(c, 8, ArcTargets + 2)`：身体中心 ≤ 8 m（不加敌人半径），只看最近 4 个候选、首领占名额再跳过；重入：`near` 是静态共用表，传电的雷伤打死某只带电的时，`Died` 同步重入的 `Arc` 把它清空，外层就停在这一跳（跳数到顶的那次不清，外层照常传完） | `combat/Charge.ts`（`ChargeBook` / `ChargeSystem`，选目标 `arcCandidates`；重入靠 `arcs` 计数看出来，同样停在这一跳），`Reactions` 经 `host.isCharged` 读 | ➕；选目标复审时照 `Nearest` 改（原来按 `queryRadius` 的「8 m + 半径」、在全部候选里取）；第二轮复审照 Unity 补重入（原来外层接着传第 2 个，同一只会挨两下 12 点、跳数被压回更小，连锁比 Unity 长） |
| 同上：夔一直带电；飞廉二阶段起、风雷珠在时带电；高原敌自己的带电 | `lords/Kui.ts`、`lords/Feilian.ts`（鸭子类型拿 `ctx.combat.charge`）、`PlateauFoeAdapter.foeCharged` | ➕ |
| 同上：落雷把落点敌人充上电（`LightningStrike` → `Charge.Apply`） | `world/mechanisms/Storm.ts` 仍挂雷殛 | ⬜ 那个目录本期不能改：把第 204 行换成 `chargeSystem(ctx)?.apply(e, o.chargeFoes)` 即可 |
| 同上：边缘光换紫红雷光 + 贴身短电弧 | 贴身紫红小电火花（全场每秒 14 下） | ⬜ 边缘光随 M11b |
| 顿帧 `HitStop`：×0.05，击杀 0.035 / 精英 0.07 / 首领 0.18、重暴击（≥ 目标总量 18%）0.025、直接命中引发的反应 0.045；不叠加只延长、间隔 0.12 s（两倍长可插队）、预算 0.15 s 每秒回 0.075、单次 ≤ 0.2 s | `core/HitStop.ts`（M11d；M8 原来在 `combat/HitStop.ts` 另迁了一份，两边合并时删掉，只留 Game 接事件的这份，对照在 `unity-core-time`） | ➕ |
| 投射物：反弹 0.55 / 0.78、低于 2.2 m/s 改滚动、摩擦 2.5、`rollAfter`（青冥雷蛊反弹用完后滚到寿命耗尽，进入时保留 70%） | `Projectiles.ts` | 🔧 摩擦 2.8 → 2.5；➕ rollAfter |
| 挡弹区 `ProjectileWard`：可以同时有多个、取最先挡下的；球罩只挡从外面飞进来的 | `ProjectileSystem.addWard`、`wardEntry` | ➕ |
| 投射物瞄准最远 60 m + 按飞行时间精确解抛物线 | 160 m + 补偿封顶 2.4 s | 保留网页：C# 注释写明 TS 的做法是目标（「WC4 连同补偿封顶一起做」） |
| 投射物外观（`ProjectileView / Visuals / Meshes / Pools`）、蚀蛊灯 `lantern` 外观 | `ProjectileVisuals.ts` | ⬜ M11b |

**玩家（`G/Player/`）**

| 机制（Unity） | 网页 | 结论 |
|---|---|---|
| 镜头手感 `CameraFeel`：行走晃动、侧移倾斜、K 140 / C 17 弹簧（落地下沉、受击冲击按来向、Punch、开枪向后一顿）、阵亡倒地 0.8 s / 复活 0.35 s、FOV 分层（开镜 + 冲刺 6° / 高速，合计 ≤ 8°，开镜压掉） | `player/CameraRig.ts` | 🔧 整份照译（原来是指数衰减震屏 + 侧向受击抖动） |
| 震屏 `CameraShake` + `FeelProfile`：trauma²、8 个声部、最强 + 其余 × 0.35、0.06 s 内合并；重落地（> 14 m/s）、重击（≥ 8% 生命上限）、元素反应按距离、首领倒下 | `player/CameraShake.ts`；`fx.shake` 经 `cameraFx.addShake` 进来 | 🔧；旧通道 `cameraFx.shakeIntensity` 照写（首领登场演出读） |
| 后坐回正 `PlayerMotor.RecoilRecoverFraction = 1` | `PlayerController` | 🔧 0.92 → 1 |
| 移动特效 `MovementFx`：冲刺风痕（视线前方迎面掠过）+ 脚下扬尘、二段跳扩散环 + 火星、落地扬尘（≥ 6 m/s）+ 重落地加环 | `player/MovementFx.ts` | 🔧（原来冲刺只有身后一撮气流） |
| 安全落脚点 `SafeGround`（玩家部分）：0.2 s 记一个、留 8 个、间隔 1.5 m、四周 0.5 m 都有地面；出界线 = min(killY, 最低安全点 − 40 m)、高速下坠掉进虚空；托回扣 10%、1 s 无敌 | `player/FallRecovery.ts`，有机关时交给 M7 的 `SafeGround` | 🔧（原来拉回出生点、不扣血） |
| 减益 `PlayerStatus`：寒意（取最强一条、上限 70%、最多 4 条、只乘走路速度）、点燃（0.5 s 一跳、只刷新时长并取较大跳伤）、日晒（旱魃） | `player/PlayerStatus.ts`；敌人侧 `chillPlayer`（两处）/ `ignitePlayer` 有 `player.status` 时转过来；旱魃的日晒层挂到玩家身上 | 🔧（原来两份寒意各改属性表、点燃是模块级任务） |
| 生命护盾 `PlayerVitals`：减伤上限 80%、受伤修饰器、PlayerHit 先于死亡判定、破盾震屏 0.25 / 0.2、回盾、低血心跳 | `PlayerController` | ✅ |
| 英雄基础属性 `HeroStats`、交互 `Interactor` | `Heroes.ts`、`world/Interaction` | ✅ |
| 手柄瞄准辅助 `AimAssist`（只在右摇杆转视角时介入） | 无 | ⬜ 网页没有手柄视角输入，随手柄支持（M11d 设置 / 输入）一起迁 |
| `FirstPersonView / FirstPersonExposure / ViewmodelCameraTrim` | 枪模 `viewScene` 清深度后画进同一张 HDR、走同一遍后处理（`render/PostStack.ts`）；持枪手感 `weapons/Viewmodel.ts` | ✅ 渲染方式 M11a、持枪手感 M10（见 4.8）；⬜ 第一人称曝光补偿 M11a；✖ ViewmodelCameraTrim（Unity 叠加相机的性能裁剪） |

**武器（`G/Weapons/`）**

| 机制（Unity） | 网页 | 结论 |
|---|---|---|
| 时序 `WeaponTiming`（切枪 0.35 / 收枪 40%、缓冲 0.14、自动换弹 0.25、上膛 0.3、补发 ≤ 4、空仓 0.3、应急补给 2.5、转停 0.9 / 0.6…） | `weapons/FireControl.ts` 的 `WEAPON_TIMING` | ✅（常量集中到一处） |
| 扳机闩 `TriggerState`：缓冲里，或按住但这次按压还没打出过，都算「扣了一下」；打出后必须松开 | `TriggerState` | 🔧（原来只有 0.14 s 缓冲：冷却中按住超过 0.14 s 不会打出） |
| 冲刺禁射 `FireInput.blocked`：半自动 / 全自动 / 光束 / 齐射不开火，点射暂停，机炮转速保持，蓄力不受影响 | `WeaponSystem.update` | 🔧（原来冲刺中照打） |
| 开镜：换弹 / 切枪 / 冲刺 / 被接管时不开；开镜程度线性每秒 7；视角层 = aimFov × 开镜程度 | 同上 | 🔧（原来只有狙击换弹退镜、按每把枪 `aimSpeed` 指数逼近；`aimSpeed` 字段 Unity 运行时也不读） |
| 散布：跑动 +20%（开镜 +10%）、滞空 ×1.15（开镜 ×1.05）、进镜（视角层 < −30°）零散布；六把枪的 `spreadTuned`（M2 已对） | `spreadAngle` | 🔧（原来 +60% / ×1.5，镜里仍有散布） |
| 后坐 `RecoilScale 0.3`：镜头抬枪量 × 0.3 | `WeaponSystem.feedback` | 🔧 |
| 开枪的镜头反馈 `CameraFeel.FireKick`：枪的震屏（开镜减半）+ 头向后一顿 | `PlayerController.fireKick` | 🔧（原来只震屏） |
| 打空：按着扳机就立即换弹（哪种模式都一样），没有备弹时空仓音 | `handleEmpty` | 🔧（原来蓄力 / 半自动按住不换） |
| 光束 `BeamMode`：走共用冷却；弹射用主目标同一份模板（元素几率不打折、照常掷暴击）、深度 1 + chain | `updateBeam`、`Firing.beamTick` | 🔧（原来每次重新按下立刻补一跳；弹射几率减半、不暴击） |
| 齐射 `VolleyMode`、点射、预热、蓄力（0.2 + 0.8·t²、满蓄穿透 + 引爆）、整匣 / 逐发换弹、换关清理 | `WeaponSystem` | ✅ |
| 喷火锥 `FlameCone`：不发投射物，沿准星扫半角 0.06 的锥（长 = 弹速 × 寿命 ≤ 射程、撞墙截短），按沿轴距离前 1 + 穿透 名各吃一次、被挡的不占名额、不按弱点算 | `weapons/FlameCone.ts`（敌人按竖直胶囊算最近点）+ `fx.flameJet` | 🔧（原来每跳一枚 flame 投射物） |
| 贯虹 `RailgunBeam`：满蓄主光束 + 三股彩虹丝缠绕 0.38 s | `weapons/RailgunBeam.ts`（朝向镜头的带子） | ➕ 虹光是 Unity 新增的那层 |
| `RailgunCharge`（线圈 × 42、颤动、灵纹脉动）、`BreakAction`（折开 0.48）、`TrinityCycle`（锁膛、灵纹显示下一发） | `Viewmodel.ts` 原有 | ✅；三才转轮换元素时的亮闪（FlashGain 0.9）、枪模后坐缩放 `ViewKickScale 0.55 × 0.76`、弹匣入位的加弹事件 `CommitLoad` ✅ M10（见 4.8） |
| 命中扫描穿透 ×0.85 / 最多 8 个、距离衰减、贴脸从眼前发射 1.3 m | `Firing.ts` | ✅ |
| 曳光按元素换形状、弹孔贴花、枪口火焰预设 | `fx.tracer` | ⬜ M11b |
| 词条 / 传说 / 数值解析 / 掉落 | — | 不在本期（M2 已对数值） |
| 解析结果直接给弹速 `ResolvedWeapon.projectileSpeed` | 只有 `projSpeedMult`，弹速在 `Firing` / `FlameCone` 里现乘 | 保留网页：数值一致、只是字段不同（M13 对出，不改） |

**技能（`G/Skills/`）**

| 机制（Unity） | 网页 | 结论 |
|---|---|---|
| 施法姿势 `CastPose`：投掷 / 召唤 / 砸地 / 举手 / 点名五条时间线叠在枪模上，0.4–0.6 s 放完 | `player/CastPose.ts` + `ViewmodelState.overlayPos / overlayRot` | ➕ |
| 拒绝反馈 `HeroSkills.Deny`：没有充能 / 持续中 / 技能拒绝，0.35 s 一次 | `SkillController` 发 `'skill:denied'` | ➕ 事件；HUD 技能格闪红还按「按键时没充能」判，改订阅这个事件归界面（M11c） |
| 出手点 `SafeHandOrigin`：右 0.24 / 下 0.2 / 前 0.45，球扫停在墙前 | `skills/common.handOrigin`（射线多探一个半径） | 🔧（原来 0.22 / 0.16 / 0.55，贴墙退到眼前） |
| 冲击波 `Shockwave`（技能来源、不算爆炸、边缘 0.45、击退 + 上抛 + 眩晕）、投掷继承 35% 水平速度 | `skills/common.ts` | ✅（上抛 M5 已对） |
| 燎：燃爆雷 / 尾焰火灵 / 余烬 | `skills/fox.ts` | ✅ 数值 |
| 磐：裂地重击「脚下 0.35 m 内有地面、竖直速度 −2…0.5 也按地面起跳」、跃起期间锁冲刺 | `skills/bear.ts`、`PlayerController.lockDash` | 🔧 |
| 磐：磐石壁垒的球形挡弹罩（胸口为心、半径 1.6 m，Unity 加强） | `bear.ts` 经 `projectiles.addWard` | ➕ |
| 鼯：雷鼓信标 / 雷目·裁决 / 凌空（灵宠不吃）/ 滑翔 | `skills/falcon.ts`、`PlayerController` | ✅；🔧 凌空排除灵宠 |
| 技能特效「换风格」（HC3：卡通火苗、纸灰地火、去掉叠在爆炸上的闪光） | 网页自己的分层特效（fx-style 第五节：法印、火舌、炭火） | 保留网页：同一份准则下各做的一版，换粒子引擎时一起对（M11b） |
| 身体被锁（下沉、硬直）时不能放技能 | 无 | ⬜ 网页的下沉在 M7 的 SafeGround 里，没有统一的身体锁；随 M11d 的输入门 |

**M13 对出的不一致（本期改法；rebase 到 master 后 `tests/unity-*.test.mjs` 的对应断言与 todo 一并改好，见第 7 条）**：

1. 弱点伤害%：`StatKey` 加 `weakpointDamagePct`，`Combat.damageEnemy` 弱点（含白泽改判）另乘它（fa5ebf28）；`defsOffense.ts` 表尾加「破绽」`weak_point`（精良、3 层、`['暴击']`、「弱点伤害每层 +15%。」），秘卷 118 → 119 张（`DESIGN.md` 第 10 节同步），进攻 24 → 25 张（前 24 张顺序不动）。
2. 灵宠伤害源：`DamageSource` 加 `'pet'`、`StatKey` 加 `petDamagePct`；`isPetHit` 时属性只乘 `petDamagePct`、不掷随机暴击（`forceCrit` 照常），见 `combat/PetContract.ts`（fa5ebf28）。
3. 免疫提示：`Combat.damageEnemy` 打不可选中的敌人返回 `{ immune: true, dealt: 0, isCrit: false, killed: false, layer: 'health' }`（原来返回 null），直接命中按 `IMMUNE_FEEDBACK_GAP = 0.4` s / 敌人节流，放行的那一次弹「免疫」并派发 `enemy:damaged`；持续伤害跳伤 / 处决 / 0 伤害不提示；整发被命中区格挡（effective 0、blocked）也派发（Unity `total > 0 || immune || blocked`）。`DamageResult` 加 `immune?`。用返回值算命中的调用方（爆炸、技能冲击波、碎刃斩击 / 刃群、满蓄引爆、反应 `hit()`、封脉导流）跳过 immune；武器词条 `AffixEffects.onDamaged` 照 Unity 跳过 immune；天雷引、引子三卷照 Unity 加「total > 0」。已死的敌人仍返回 null（Unity `default`）。复审补：整发被格挡弹「格挡」不弹「免疫」，没被格挡的 0 伤害不派发不弹字（同 Unity）；「免疫不算命中」的测试改成真调用（爆炸 / 冲击波 / 封脉导流 / 反应打中心 / 满蓄引爆 / 词条 / 刃群，逐个把 `!r.immune` 改回去都会红）。
4. 玩家减益：寒意 / 点燃 / 日晒在 `player/PlayerStatus.ts`（ef7a6719）。Unity 是一个 `StatusId`（8 项）+ 按宿主登记，网页是敌人 `StatusId`（5 项）+ 玩家 `PlayerStatusId`（3 项），集合相同；`ChillTakesStrongest…` / `IgniteTicks…` 在 `m8-player.test.mjs`，`SunburnStacks…` 在 `hanba-boss.test.mjs`，`EveryStatusHasOneDefinition` 的对应断言在 `m8-parity.test.mjs`。
5. 焚雷扩散灼烧：`Reactions.runThunderfire` 照 `ReactionSystem.Nearest` 取身体中心在 R 内、按距离最近的 `TF_SPREAD_TARGETS = 16` 个（原来半径内全部，且按 queryRadius 的「R + 敌人半径」算）。带电死亡传电的选目标是同一类偏差，复审时一并照 `Nearest` 改了；第二轮复审又照 `Charge.Arc` 共用 `near` 的行为补了同步重入：第一个目标被 6 点雷伤打死时外层只传到它 1 个（上表带电那行）。
6. 解析结果的弹速：不改，见武器表最后一行。
7. rebase 到 master（23b57e73）后 master 的对照测试随改：`package.json` 的 `"test"` 取两边测试文件的并集；`unity-damage-calc` 的免疫用例照 Unity `ImmuneFeedbackIsThrottledAndSkipsDots` 断言 immune 结果、0.4 s 节流、跳伤不提示，Stat 枚举两边一项不差，属性乘区补灵宠来源 / 标签，弱点另乘弱点伤害%、灵宠不随机暴击，寒意 / 点燃 / 日晒 / `EveryStatusHasOneDefinition` 四条 todo 照 CombatPipelineTests 转成断言；`unity-scrolls` 119 张、两边 id 集合相同，手抄进攻表比前 24 张（「破绽」在表尾），「破绽」todo 转成断言；`unity-reactions` 的焚雷 todo 转成断言；`unity-fire-modes` 改读 `FireControl.WEAPON_TIMING` / `chargeMult` / `switchPose` 比数值（顺带迁了 `SwitchPoseHolstersThenDraws`），并确认 `WeaponSystem` 引用的是这份常量（换弹最短时间也改用 `WEAPON_TIMING.MinReload`）。
8. 局内货币叫法（D13）：`core/Stats` 的 `coinGainPct`「灵石获取」、财富天赋「每级灵石获取 +8%」、宝箱提示「一大堆灵石」（精英关「（精英加成）」，同 `CoinsReward.Line`；Unity 首领档也写精英加成但 `ChestCoins` 只给精英 ×1.4，这里按实际发放只在精英关标）、`RunPlan` 奖励名「灵石」、商店「灵石不足」、强化 / 秘卷满层「改为灵石」，逐条对 Unity 原文（`m8-parity`）。`src/ui` 里的「金币」由界面第二期（M11c）改完。

**验证**：rebase 到 master（23b57e73）后 `npm run typecheck` 通过；`npm test` 全套 1130 项、0 失败、6 条 todo（master 是 12 条，转掉的 6 条见第 7 条；第二轮复审加了死亡传电重入那一项）。实机（1-1，`?debug&dev&debugStage=1-1`，无头浏览器，`node scripts/web/m8-shots.mjs 5711`）：逐把武器（21 把）按住开火、冲刺禁射、开镜、喷火锥、贯虹、后坐回正、玩家减益、带电 / 焚雷、死亡传电选目标（7.4 m 的传、8.27 m 的不传）、死亡传电重入（第一跳打死 a 就停：b、c 各挨 1 下、跳数 2；旧代码 b 挨 2 下、跳数 1）、格挡浮字、货币叫法、免疫、「破绽」、三个英雄的 Q / E 与拒绝事件、磐的挡弹罩——第二轮复审后整轮重跑 43 / 43、零报错（第一轮复审后是 42 / 42；复审前整轮是 38 / 39：喷火锥那项平视开火、细锥从跳鼠头顶擦过，改成准星压到胸口、头几跳就读之后只单独重跑过；这一轮是改过的脚本整轮跑），截图 `docs/art/review/threejs-migration/m8-*.jpg`（`m8-blocked.jpg` 是格挡浮字）。

**待办**：`Storm.ts` 落雷充电换成 Charge（上表）；喷火锥枪口到锥中段的火舌在亮沙地上几乎看不见（只有锥末堆起的白热团），正式火焰外观随 M11b；HUD 订阅 `skill:denied`、状态图标读 `player.status`（M11c）；`DamageNumberOpts` 加「格挡」这一种、按 Unity 的数字样式（`Kind.Blocked`）画，现在按世界浮字（带框）出（M11c）；`src/ui` 里的「金币」（界面）；带电 / 喷火 / 虹光的正式外观（M11b）；枪模后坐缩放与转轮亮闪（✅ M10）；手柄瞄准辅助；FireModeTests 其余 29 条行为用例要给 WeaponSystem 做假输入 / 假弹道夹具。

### 4.7 M11d 核心对照清单（2026-11-21）

照 Unity `G/Core/` 逐文件翻译，数值以 C# 为准。对照测试四份（`package.json` 的 test 列表末尾）：`tests/unity-core-time.test.mjs`（仲裁 / 模态栈 / 顿帧 / 清场慢动作 / 手感表 / 帧率上限，常数逐个读 `HitStop.cs`、`TimeScaleArbiter.cs`、`ClearSlowMo.cs`、`FeelProfile.cs` 比）、`tests/unity-core-save.test.mjs`（SaveServiceTests、RunSuspendTests、设置项——设置表逐项读 `GameSettings.cs` 比）、`tests/unity-core-quality.test.mjs`（画质三档逐项读 `QualityProfile.cs` 比、剔除、预算）、`tests/unity-balance.test.mjs`（BalanceModelTests，编制表逐行读 `BalanceModel.cs` 比，敌人 / 首领数值读 `defs.json`）。实机：`node scripts/web/core-check.mjs <端口>`（无头 Chromium 开正式主菜单走一遍老存档导入 → 开局写续玩档 → 画质 / 剔除 → 顿帧 / 模态 / 暂停 → 设置页 → 换关 → 暂离 → 继续征程 → 放弃结算，25 项；截图 `docs/art/review/threejs-migration/core-*.jpg`）。调试：`?debug` 时 `__balance()` 打平衡模型的整份推演，`__game.timeArbiter` / `__game.fsm` / `__game.hitStop` / `__game.culler` 可以直接看。

| Unity | 网页 | 说明 / 差异 |
|---|---|---|
| SaveService（版本化信封 + 段、`.bak` 轮换、坏档挪 `.corrupt`、文件级迁移 `FromWebV1`、新版本文件只读、没人认领的段原样写回、SaveFlusher 合并写盘） | `core/SaveService.ts` | ✅ 照译。存储是 localStorage，一个「文件」一个键：`spiritfire.save/profile.json`（正式档）、`profile.dev.json`（调试档：`?debugStage` 调试局、白盒检视页 = Unity `-devprofile`）、`settings.json`（共享）。setItem 本身原子，不要 `.tmp` + File.Replace；合并写盘 0.75 s，切后台 / 关页（`visibilitychange` / `pagehide`）立刻写。**老存档**：信封 v1 就是 M11d 之前的 `gunflame.meta.v1`（白盒的 `gunflame.whitebox.meta.v1`）原样，新键里没文件时读一次按 v1 → v2 拆成 meta / career 两段，老键不删不改 |
| MetaSave（魂晶 / 天赋 / 英雄）、CareerStats、`BankRun`、天赋开局快照、`ApplyTalents` 幂等 | `progression/Meta.ts` | ✅ meta 段 + career 段（照 Unity 多记阵亡 / 各章阵亡 / 最快通关 / 单局最多击杀 / 总用时 / 总伤害 / 累计魂晶 / 各英雄局数胜场；老存档没有阵亡，按 局数 − 胜场 补）；一局只结一次（`run.flags['meta.banked']`）；天赋按 `run.talents` 快照生效，和属性表现有的一样时不动（版本号不变）。界面读的 `meta.save` 形状不变（活视图）。图鉴段（Codex*）随界面第二期 |
| GameSettings（设置表、`settings` 段只写非默认项、老 PlayerPrefs 导入） | `core/GameSettings.ts`、`core/settings.ts`；设置页 `ui/screens/SettingsScreen.ts` 由 `GAME_SETTINGS` 生成 | ✅ 两边都有的项键 / 显示名 / 分组 / 默认 / 范围 / 步长 / 选项 / 顺序逐项对 C#；补进表的：帧率上限、屏幕特效（接后处理的玩法屏效强度），震屏上限 1.5。Unity 独有、网页不列：显示模式 / 分辨率 / 垂直同步（浏览器管）、手柄瞄准辅助（没有手柄输入）；网页独有：阴影精度。画质在 Unity 存 ArtQuality 自己的 PlayerPrefs，网页存在设置段（下标）。**老设置**（`gunflame.settings.v1`）导入一次：M11e 之前的音量是旧语义（主 / 音效 / 音乐缺省 0.8 / 0.9 / 0.5 就是总线电平，音乐另乘 0.6），除以旧缺省换成新推子（旧 0.4 / 0.45 / 0.25 → 0.5 / 0.5 / 0.5，实际电平 = 推子 × 清单 mix 0.8 / 0.9 / 0.3，听感不变），超过旧缺省的夹在 1；带环境音 / 界面音两项的是 M11e 之后存的，原样 |
| GraphicsQuality（帧率上限、显示模式、分辨率、垂直同步） | `GameSettings.ts` 的 `FrameLimiter` / `targetFrameRate` | 🔶 帧率上限按 rAF 跳帧（144 Hz 限 60 = 隔 2 或 3 帧，平均 60），后台标签页浏览器自己限；显示模式 / 分辨率 / 垂直同步不做 |
| RunSuspend（进关快照、续玩档、坏档提示、放弃按败北结算、`CanSuspend`）+ MenuFlow（`ResumeRun` / `Suspend` / `ToMenu(bank)` / `StartRun` 放弃旧局） | `progression/RunSuspend.ts`；`core/Game.ts` 的 `continueRun` / `suspendRun` / `canSuspend` / `suspendedRun`、`toMenu(bank)`；主菜单「继续征程」（`ui/screens/MainMenuScreen.ts`）、出征前的确认框（`startNewRun`，选英雄「出征」走它）、暂停「返回主菜单」 | ✅ 每进一关（关卡搭好、玩家就位后、发 `stage:loaded` 之前，同 Unity Arrive 先记 entry 再 Announce——聚宝盆入账、每关补弹不进快照）写 `spiritfire.save/run.json`（调试档开着时调试局写 `run.dev.json`）：关卡（槽位编号 + 地图编号）、英雄、种子、路线、武器（品质 / 强化 / 元素 / 弹药 / 词条 / 手上那把）、秘卷层数（按获得顺序）、灵石、魂晶、生命护盾、用时 / 伤害 / 击杀 / 清关数、标记、天赋快照；随机流只由「种子 + 关卡 + 流名」决定，不另存。一局结算（阵亡当场 / 放弃 / 胜利 / 开新局放弃旧局）就删档；阵亡慢动作里不能暂停、不能暂离；暂停「返回主菜单」能暂离时一按就走、不结算，否则（调试局）按失败结算、二次确认；没结算过的局回主菜单先按失败结算（Three.js 原来不结算、白丢魂晶，照 Unity 不跟）。有续玩档时出征先弹确认框（文字同 Unity MenuFlow.StartRun），放弃旧局等场景清单读到之后再做，放弃之后才定新局的路线（同 Unity 先 Forfeit 再 Begin：生涯第一局暂离后开新局也洗牌）；场景清单没到 / 读不到时主菜单、确认框、放弃、继续征程都宽松读续玩档（只不查备选图在不在、不动盘上的档），确认框弹没弹和放弃不放弃看同一个判断；主菜单读到坏档提示一次。差异：继续征程照样发 `run:started`（网页的掉落 / 技能 / HUD 靠它复位）；章从 0 起（网页 RunState）；没有灵宠（M9）；读档装回武器靠 `weapons.roll` + 改字段 + `applyHeldMods`，秘卷 `scrolls.add` 静音装回（M8 给武器 / 秘卷加正式读档入口后换掉） |
| TimeScaleArbiter | `core/TimeScaleArbiter.ts`（首领框架 `enemies/bosses/framework/TimeScaleArbiter.ts` 改成转出口，行为不变） | ✅ 优先级 顿帧 100 / 阵亡 200 / 过渡 300 / 模态 400 / 暂停 500，清场慢动作 90；同级取最后一个；句柄 scale 可改；NaN / 负数当 0、上限 100。比 Unity 多的（M6 那一版就有）：按真实时间自动撤销、外部接管（白盒检视页的俯视暂停还直接写 timeScale）。主游戏不再直接写：暂停 / 模态 / 阵亡慢动作都经仲裁 |
| GameStateMachine（底层状态 + 模态栈） | `core/GameStateMachine.ts`，`Game.fsm` | ✅ 暂停 / 模态各是栈上一项（停住时间，弹出撤销）；`game:stateChanged` 由它发 |
| HitStop | `core/HitStop.ts`，Game 接 `enemy:killed` / `enemy:damaged` / `enemy:reaction` | ✅ 击杀 0.035 / 0.07 / 0.18 s、重暴击（打掉总量 18%，冲锋枪暴击不算）0.025 s、直接反应 0.045 s，×0.05；不叠加、最小间隔 0.12 s、预算桶 0.15 s / 每秒回 0.075 s、不够 12 ms 不顿。没接：斩击命中、技能落地这类直接 `request` 的来源（武器 / 技能在 M8） |
| ClearSlowMo | `core/ClearSlowMo.ts`（`EncounterClearWatcher` 看 `stage.exploration.encounters` 从开打变清掉） | ✅ 打过 ≥ 4 只的场地清掉时 ×0.3 约 0.4 s（真实时间），比顿帧低一档 |
| FeelProfile | `core/FeelProfile.ts` | ✅ 默认表；震屏曲线随 M8 镜头手感接，手柄瞄准辅助网页没有手柄 |
| QualityProfile（三档） | `core/QualityTiers.ts` | 🔶 表照抄；现在读的只有渲染比例（像素比 = min(设备像素比, 低 1 / 中 1.5 / 高 2) × 0.7 / 0.85 / 1，浏览器双线性放大，没有 FSR 锐化）和剔除距离。其余列还没人读，各系统仍各看 `settings.quality`：后处理低档整栈不开（Unity 低档 MSAA 1、Bloom 1/4），MSAA 中 2 / 高 4 同表；阴影由「阴影精度」1024 / 2048 / 4096 决定、低档不渲染（Unity 低档 1024 硬阴影 45 m 一级）；粒子 / 闪光灯 / 贴花上限随 M11b，毛发随 M11a，lodBias / mip / 地形细节网页没有对应 |
| CullLayers（小件层 8 / 散布层 9 + 相机 layerCullDistances） | `core/CullLayers.ts`，Game 在 `stage:loaded` 给 Unity 场景分层 | ✅ 尺寸分层（≤ 1.6 m 小件、≤ 6 m 散布）、各档距离（高 120 m / 散布到雾终点；中 90 m / 0.85；低 60 m / 0.65）照抄；three.js 没有按层的剔除距离，改成记包围盒中心、相机挪 1.5 m 才重算、改 `visible`（球面距离）。只收 Unity 场景文档里看得见的静态网格：蒙皮 / 实例化 / 着色器材质（水、熔岩）/ 会摆的（幡、灯笼）/ 已经藏起来的不动（Unity 是跳过带刚体 / 可受伤 / 非 Default 层的）；机关会动的件按原位置剔；非 Unity 场景（旧竞技场）不剔；`?cull=0` 关 |
| PerfBudget | `core/PerfBudget.ts` | 🔶 预算数照抄（运行时 / 构建时）；`?perf=1` 性能表还没调 `checkPerf`；PerfViews（固定机位、必经点连线）不迁 |
| BalanceModel + EconomyConfig.Project | `progression/BalanceModel.ts`（经济投影 `projectEconomy`）、`progression/BalanceBosses.ts`（四个首领的击杀用时） | ✅ 编制表照抄 C#（Unity 从场景里的 EncounterSite 统计，网页测试逐行对源码）；参考秒伤 90 × 装备倍率 × 1.6 × 0.8；补给营预算、装备计划、每章收入、魂晶估算。只算前三章（第四章网页是另一套场景，同 Unity）。EconomyConfig 本身和具名随机流 RunRng 在 M3 已迁 |
| GameSession / SceneFlow / RunEnd / LevelBootstrap / SystemsBootstrap / PlayerFactory / PlayerSpawn / DevCommands | `core/Game.ts` | 不另迁：Unity 的场景装配；用得到的规则（开局结算旧局、进关快照先于 StageLoaded、阵亡当场结算 + 慢动作、结算一次）都落在 Game 里，`tests/unity-core-flow.test.mjs` 拿真的 Game.ts 跑一遍（渲染 / 场景 / 界面 / 玩家 / 武器 / 秘卷打桩） |

Unity 测试的去向：SaveServiceTests、RunSuspendTests（除图鉴四条）、FeelProfileTests（除瞄准辅助）、BalanceModelTests（除 `Weapons_SustainedTheoryNearThreeJsBand`、`Stage11_WeaponRewardsCannotRollRandomElement`——武器，随 M8 / M13）、GraphicsAudioTests 的 QualityTiersAreMonotonic / HighTierMatchesProjectAssets / DisplayAndVolumeSettingsPersist（网页有的项）/ FrameCapRules、PerfTests 的分层 / 剔除距离 / 预算 → 上面四份，局流程（OnDied / Arrive / StartRun / Suspend / ResumeRun 的先后）另有 `tests/unity-core-flow.test.mjs`；GraphicsAudioTests 的 ProfileWritesPipelineAsset、PerfTests 的固定机位、RenderPerfSettingsTests 纯 Unity，FxBudgetFollowsQualityTier 随 M11b。
界面第二期合进来之后：旧主菜单 `ui/MainMenu.ts` 和手写设置面板 `ui/SettingsPanel.ts` 已删，「继续征程」与确认框接在新主菜单 / 选英雄上，主菜单和暂停里的「设置」都是由 `GAME_SETTINGS` 生成的那一页。
**还没做**：画质表其余列随各系统那一期接；顿帧的直接来源随 M8。

### 4.8 M10 第一人称持枪手感 + 碎刃表现对照清单（2026-11-24）

对照方法：Unity `G/Weapons/HandlingProfile.cs` + `Handling/**`（25 个）、`TwoBoneIK` / `WeaponHandRig` / `WeaponPartAnimator` / `WeaponRigFactory` / `WeaponRigPart` / `WeaponTint(System)` / `BreakAction` / `CrossbowString` / `RailgunCharge` / `TrinityCycle`、`Pipeline/Runtime/FirstPersonViewmodel.cs`、`G/Player/` 的 `FirstPersonView` 一组、`G/Weapons/DemonBlade/**`（17 个）逐文件读，数值和时序以 C# 为准。两份对照测试 `tests/m10-handling.test.mjs`、`tests/m10-blade.test.mjs` 的期望值照 C# 抄成测试里的常量、每个旁注出自哪个 C# 文件哪一行（2026-11-26 用户要求「不能有任何依赖unity的代码」：测试不打开 `unity/` 或 `public/assets/unity-*` 下的任何文件，本期运行时代码也不读；握点原来读 `unity-gameplay/defs.json`，也抄成了常量），行为断言照 Unity EditMode 的 WeaponHandlingTests、BladeFirstPersonTests（去向见 7.1）。任何 `GunfireOriginal*` 不迁。记号：✅ 一致 · 🔶 部分 · ⬜ 还缺（归哪期）· ✖ 不迁。

**持枪手感**

| Unity | 网页 | 结论 |
|---|---|---|
| `HandlingProfile.cs`（`Make`：按装填动作 × 换弹风格的预设——时间线 reach / magOut / magIn / loadAt / finish、换弹姿态 tiltRot / tiltPos、弹匣偏移 / 俯仰 / 管式隐藏、转轮、泵动、伸手手型）+ `Handling/Profiles/HandlingProfile_<Id>.cs` 17 份（枪重 / 晃动 / 摆动 / 转轮格数 / 泵动行程） | `weapons/WeaponHandling.ts` 的 `makeHandling` + `WEAPON_HANDLING` | ✅ 预设与 17 份改项照 C# 抄成测试常量逐项比；表小，直接写在 TS 里，没有导出器 |
| 武器表握点 `rightHand / rightPitch / leftHand / leftRoll`、英雄 `armR / armL`（M2 留给本期） | `WEAPON_HANDLING` 的 right / rightPitch / leftRoll / support + 枪模 `buildXxx` 的 `leftHand`（挂在泵上的加泵的位置）；手臂按清单 bind = fp / 英雄 / arm_r\|arm_l | ✅ 对 Unity 武器表（`Weapon_<Id>.cs` 的握持行，抄成测试常量）逐把比（Unity 的 `Grip()` x 取反）。例外：裂风步枪（Unity 换成原作模型 SK_Weapon_Gunfire1001，握点是按那支枪量的；网页仍是自己的步枪模型）；焚城榴弹 / 雷弧发射器 / 青冥雷蛊的右手偏移、右手俯仰与左手横滚（Unity 武器表从来没写过、全 0，是移植遗漏；网页这几项早于移植、对的是同一份美术枪模）——保留网页，例外本身也断言住 |
| `FirstPersonViewmodel.cs`：呼吸 / 行走摆动（开镜收到 15%，× 摆动倍率 / √枪重）、鼠标滞后弹簧 ω 14 ζ 0.62、侧倾 / 前后 / 竖直 / 落地弹簧（ω 按 √枪重放慢，子步 1/240 s）、起跳一抬、冲刺 / 滞空姿态、切枪收放、腰射 ↔ 开镜混合、持续开火颤动（蓄力 0.0008 + 0.0026 × 蓄力，其余 0.003）、空仓抖动、技能覆盖姿态 | `weapons/Viewmodel.ts` 的 `update` | ✅ 常数照 C# 抄成测试常量逐个比；旋转 X·Y·Z 和 Unity 的 `AngleAxis(−rx)·AngleAxis(−ry)·AngleAxis(rz)` 镜像后是同一个 |
| 后坐 `Kick`：每发叠加、上限单发 2.4 倍、随机横滚，按枪重^−0.3 指数回位，再过欠阻尼弹簧显示（42 / 40 / 36）；`WeaponController` 的 `ViewKickScale` 0.55、向后再 × 0.76；有原作后坐运动的枪不叠 | `Viewmodel.kick` / `onShot` | ✅ |
| 换弹姿态：整匣按包络（进 0–15%、出 82–100%）叠 tilt，逐发装填的整体姿态 shellTilt、每压一发往下一磕；弹匣入位一顿 `Seat` | `Viewmodel.update` | ✅ |
| `WeaponStateMachine.CommitLoad`（`WeaponHandRig` 整匣换弹过 loadAt 时调）：弹匣入位就加满、换弹总时长不变、之后切枪保留并算一次换弹；逐发装填不吃；没有第一人称时到时才加；收尾一声轻的 | `WeaponSystem.commitLoad`（`Viewmodel.onCommitLoad`） | ✅ 四条用例在真 WeaponSystem 上跑。收尾音分开记「这一匣是不是动画事件加的」：事件加的收尾只给轻声（Unity），到时才加的（原作枪模 smg / revolver / railgun、没有左手）照旧 `reload_end`——Unity 那三把由原作动画自己放换弹音，网页不迁那一层，不分开记会只剩一声很轻的切枪声 |
| `WeaponHandRig`：平时刚性跟着握点、偏差按 20/s 衰减；换弹按 `SampleHand` 去送弹口（跟着弹匣走）/ 收尾点，伸手手型；泵动霰弹枪手里那发弹 | `Viewmodel.animateHands`、`WeaponHandling.sampleLoadingHand` | ✅ |
| `TwoBoneIK` + `WeaponHandRig.Apply`：相机空间里「手在当前位置」「手在握点」各解一次肘，前臂按两个肘方向之间的转动摆 × 0.7、最多 35° | `weapons/TwoBoneIK.ts`、`Viewmodel.poseForearm` | ✅ 肩 / 极点的相机空间 z 取反 |
| `WeaponPartAnimator`：弹匣离位（偏移 / 俯仰，管式到 85% 隐藏）、转轮每发一格 + 换弹甩出自转、泵动（开火后 0.12–0.44 s、上膛 0.3 s，行程按枪）；转轮兼弹匣时不按弹匣动 | `Viewmodel.animateParts` | ✅ |
| `WeaponRigFactory`（右手在握把、左手在握点 / 横滚、整体缩放 0.76、腰射锚点右下 HipShift、逐发装填的姿态写进 shellTilt、原作枪模不套换弹姿态 / 零件 / 左手）、`WeaponRigPart`（零件基类） | `Viewmodel.build` / `addArms` | ✅；零件基类是 Unity 的组件结构，网页内联在 Viewmodel 里 |
| 原作枪模的 6 把（贯虹灵炮 / 赤铜左轮 / 裂风步枪 / 碎岩霰弹 / 蜂鸣冲锋枪 / 鹰隼狙击，Prefab `SK_Weapon_Gunfire*`） | 有原作模型的 3 把（左轮 / 冲锋枪 / 灵炮）走 `OriginalWeaponView`；步枪 / 霰弹 / 狙击只有原作后坐运动，模型是网页自己的 | 🔶 GunfireOriginal 不迁：后三把在网页照持握表做整套换弹（姿态、左手、零件），Unity 播原作换弹。前三把弹匣入位那一顿按持握表 loadAt（Unity `Configure` 在原作分支之前就写了 `seatAt`），不发加弹事件、到时加弹 |
| `TrinityCycle`：锁膛（只向前转到最近的等价膛）、换弹甩出 0.045 / 自转 14 / 锁膛阻尼 25、灵纹显示下一发（换弹中显示第一发）、换元素亮闪 `FlashGain` 0.9 / `FlashDecay` 14 | `Viewmodel.animateParts` / `animateGlow`、`trinityPulse` | ✅ |
| `RailgunCharge`：蓄力灵纹脉动（满蓄快闪）、蓄能色（物理 = 满蓄虹紫）、枪口光球 | `chargePulse`、`updateFlash` | ✅ |
| `BreakAction`：折开 0.48 rad、弹壳画在膛口、这一发 55%–92% 滑进枪管、两管交替 | `Viewmodel` 的 breech / chamberShell、`breakShellPose`、`ReloadBreech.ts` | ✅ |
| `CrossbowString`：弦两半、弦扣按上弦程度拉、≥ 0.98 箭才落槽；上弦程度 = 换弹 (进度 − 0.6) / 0.3、空匣 0、否则 1 − 冷却 / 间隔 | `WeaponModels.setCrossbowString`、`WeaponSystem` 写 `cock` | ✅ 原有（Unity 照 TS 移的） |
| `BarrelSpinner` / `WeaponSpinner`（转管 × 预热量 × 满转速） | `animateParts`：`spin × 42 × dt` | ✅ 原有 |
| `WeaponSight` / `SightPart` / `Handling_Burst / Rifle / Sniper / Minigun`（红点 / 筒式瞄具占位网格、进镜——视角层 < −30°——隐藏枪模） | `WeaponModels` 的程序零件 `sight`（Unity 的占位网格就是照它补的）、`ViewmodelState.scoped`；镜内遮罩 M11c | ✅ |
| `WeaponTint` / `WeaponTintSystem`：纹路发光 = 元素色 × 稀有度亮度（0.5 / 0.8 / 1.1 / 1.5 / 2.0）× 1.6，无元素保留美术白纹；切枪 / 拾枪按实例重新着色 | `WeaponModels.weaponGlowColor` / `ART_GLOW`（网页每个实例各建一份枪模） | ✅ |
| `CastPose`（技能出手的覆盖姿态） | `player/CastPose.ts` | ✅ M8，测试核对过 |
| `FirstPersonView`（枪模层清深度后画进主相机、和世界同一遍后处理，60° / 0.01 / 20） | `core/Game.ts` 的 `viewScene` / `viewCamera` + `render/PostStack.ts` | ✅ M11a 已是这种画法 |
| `FirstPersonExposure`（关卡 Volume 上第一人称层的曝光 / 伽马 / 特效补偿） | 无 | ⬜ M11a（渲染） |
| `ViewmodelCameraTrim`（渲染叠加枪模相机时临时关 SSAO / 贴花） | — | ✖ 网页没有叠加相机 |

实机看到的一处（数据和 Unity 相同，没开 Unity 对比——编辑器别的会话在用）：整匣换弹中段左手跟着弹匣 / 弹箱下到画面下沿，三叠点射枪手腕在下沿（NDC y ≈ −1.0）、旋风机炮在下沿以下（≈ −1.7，弹箱下抽 0.24）。

**碎刃第一人称**

| Unity | 网页 | 结论 |
|---|---|---|
| `BladeSwing`：待机 / 剑指 / 立掌 / 举手与三段斩关键帧（第三段是 Unity 改过的：刃口下压、刀面朝镜头侧倾）、时间线（蓄势到判定帧 × 0.55、t² 加速、缓出）、伸刃（第三段 2.2，刀根 0.09 内不动，0.72 后缩回） | `demonBlade/BladeView.ts` 的 `IDLE` / `SWINGS` / `sampleSwing` / `slashStretch` | ✅ 关键帧照 C# 抄成测试常量比 |
| `BladeView`：层级（Sway 枪重 0.85 → 刀姿 → × 0.72）、三个事件按视觉进度派发（出刀 / 判定帧 / 收势）、命中视觉顿帧 40 / 70 ms（真实时间）、刀身闪亮、人刀合一常态伸长 1.3、手势过渡 0.14 s、右手拳心、碎片归位放大、homeWorld 交接 | `BladeView.ts` + `Viewmodel`（Sway） | ✅ Unity 把时间线烘成剪辑，网页直接求解析式（测试核对三个关键姿态落在事件上）。视觉顿帧按 `Game.frame` 记的真实帧时长 `ctx.time.rawDt`（Unity `Time.unscaledDeltaTime`）扣：命中在同一帧先申请全局顿帧，拿 dt / timeScale 反推会一帧扣光 |
| `BladeTrail` + `Fx/Presets/BladeTrail`：采样寿命 0.16 s、亮度跟刀尖速度、最新 0.04 s 白热、墨笔起收锋、侧看补宽、带身普通混合 + 加色光边、每段另起一条 | `demonBlade/BladeTrail.ts`（自带网格） | 🔶 外观参数照预设，网格自己画；随 M11b 换特效预设 |
| 判定帧：刃口白热一闪、甩出碎刃火星、镜头朝挥动方向一带 | `BladeView` 的 `onBladeStrike` / `spawnSparks`（火星先用 `ctx.fx.burst`） | 🔶 火星随 M11b 换预设 |
| 第三段斩在世界里的大弧（`Fx.Slash`） | 无 | ⬜ M11b |
| `BladeGlints`：剑指指尖灵光、判定帧刃口闪、归位闪（加色、面向镜头的方片、有上限） | `demonBlade/BladeGlints.ts` | ✅ |
| `BladeSwordSign`：三只英雄手臂各自的指根 / 方向 / 手套与皮肤 UV，拳头前沿补两根伸直并拢的手指；整只手按手指指向 + 前臂朝左下摆、0.76 缩放 | `demonBlade/BladeSwordSign.ts` | ✅（x 取反、v 翻回 glTF） |
| `DemonBladeController` 的第一人称部分：判定帧调 `OnBladeStrike`、命中镜头冲击 Punch(1.6 / 0.5°, ±1.4°)、申请 70 / 40 ms 顿帧 | `DemonBlade.ts`、`PlayerController.punchDegrees` | ✅（玩法本体原有，`tests/demon-blade.test.mjs`）。`IPlayer.punchDegrees`、`IGame.hitStop` 进了接口，控制器不再试探着调；`m10-blade` 真跑控制器的三段判定帧核对冲击 / 顿帧实参 |
| `BladeShards`（旋涡 / 圆盾 / 刃球 / 炸散，出窍 / 归刀常数）、`BladeSwarmRenderer`（碎片本体、柔光 + 拉丝拖尾 6–90 像素、旋涡雾光 / 判定光盘、盾面光膜 / 挡弹闪光、刃球光核） | `demonBlade/BladeSwarm.ts` | ✅ 原有（Unity 照 TS 移的），阵形常数照 C# 抄成测试常量比 |
| `BladeEffects`（人刀合一斩波、噬灵鬼眼魂力光点） | `demonBlade/BladeEffects.ts` | ✅ 原有 |
| `BladeModel` / `BladeMeshes` / `BladeShape`（128 片 Voronoi 碎片、刀根鬼面、刀柄贴图集、睁眼贴图） | `demonBlade/BladeModel.ts` / `BladeShape.ts` | ✅ 原有；Unity 烘成蒙皮网格（一片一根骨骼）是它那边的画法 |
| `BladeWard`（屏障的圆盘挡弹面） | `DemonBlade.ts` 的 ward（`projectiles.setWard`） | ✅ 原有 |
| `BladeSkillWidget`（V 盘：爆 / 合） | `ui/hud/SkillWidget.ts` | ✅ M11c |
| `DemonBladeDef`、`IBladeView` | `WeaponDefs` 的 `blade`；接口 | ✅（定义表 M2 已对）/ 结构不同 |
| `BladePlaceholderView`（WC6 占位视图） | — | ✖ Unity 过渡用，已被 BladeView 取代 |

**验证**（2026-11-26 复核修正、测试去 Unity 依赖之后重跑）：`npm run typecheck` 通过；`npm test` 全套 1303 项、0 失败、6 条 todo、3 条跳过（native-hero-grip 的三条英雄绑定检查，本机没有源导出，和 master 一样）；`tests/m10-*.test.mjs` 与本期改动的 `src` 不读 `unity/` / `public/assets/unity-*` 下的任何文件（关卡本身仍从 `unity-levels` 载入，那是 master 上已有的、另一期处理）。实机（1-1，`?debug&dev&debugStage=1-1`，无头浏览器逐帧推进，`node scripts/web/m10-shots.mjs <端口>`，`M10_ONLY=guns|blade` 可分开跑）：17 把枪逐把装备 / 按住开火 / 开镜 / 留 1 发按 R——整匣换弹全部在进度 0.78–0.79（loadAt）加满、换弹姿态到 1、左手离握点 11–45 cm（枪模坐标）、前臂摆 5–34°、弹匣离位到 1，三才转轮换元素亮闪 0.77，节点矩阵没有非有限值，88 项全过（原作枪模左轮 / 冲锋枪 / 灵炮没有左手，到时加弹）；碎刃三位英雄：三段斩各自触发判定帧事件、屏障 / 杀气爆发 / 千刃出窍剑指（左手 1.0），16 项全过；合计 104 / 104，页面报错 0。截图 `docs/art/review/threejs-migration/m10-fire.jpg` / `m10-aim.jpg` / `m10-reload.jpg`（联系表）、`m10-blade.jpg`、`m10-blade-slash3.jpg`、`m10-blade-point.jpg`。之前一版联系表后半全白：别的会话同时占着显卡，上下文丢了又被浏览器恢复（`isContextLost()` 是 false），脚本改成按 `webglcontextlost` 事件 + 截图近白比例判定、作废重来。
旧 `tests/handling.test.mjs`（第 8 节第 3 条）：已按单级 LOD 契约改写，9 条全绿，不用再动。

**待办**：刀光换特效预设、判定帧火星换预设、第三段斩的世界大弧（M11b）；第一人称曝光补偿（M11a）。握点测试里焚城榴弹 / 雷弧发射器 / 青冥雷蛊的例外是定论（Unity 冻结、以后整个删掉，网页的值为准），不再等 Unity 补。

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
| 界面 | 66 个 C# / 13.5k 行 + 9 份 USS / 5.3k 行，三种字体（Noto Sans SC、霞鹜文楷子集、Barlow Condensed）；四层路由。网页没有的界面：图鉴（含运行时缩略图棚）、地图 + 标记 + 罗盘条、关卡卡片、确认框、按键说明、灵宠面板、精英灵契、秘卷触发弹字、瞄准镜、六向受击弧、可合并的提示队列。重做的：HUD 血盾 / 武器 / 技能环、伤害数字（按目标合并、池 80）、敌人血条、首领血条、设置页（由 GameSettings 生成） | `src/ui` 13.75k（其中 8.6k 是旧三英雄的展示）、CSS 5.7k、系统字体。M11c 第一期后：四层 + 路由、Toolkit 部件、HUD 部件、暂停 / 设置照 Unity，样式由 USS 转出，打包字体；第二期后（2026-11-21）：上面「网页没有的界面」全部补上（灵宠面板是等 M9 数据的空态壳），主菜单 / 选英雄 / 天赋 / 结算 / 秘卷三选一 / 行囊照 Unity 重做，旧 gf-* 界面与 CSS 删光 | DOM + CSS：USS → CSS 转换（`-unity-*` 属性只有 94 处；UI Toolkit 默认纵向 flex，要加基准重置），1920×1080 四层缩放，webfont 取代 SDF 字体，Painter2D → SVG / canvas |
| 核心 | 40 个 / 7.6k：存档信封（版本、备份、迁移）、局中暂停续玩、时间缩放仲裁、卡帧、模态栈、三档画质、距离剔除、性能预算、BalanceModel、EconomyConfig、具名随机流 | `src/core` 2.6k + `progression/Meta.ts` | 照译 |
| 音频 | 7 个 / 1k + 混音器构建器；254 个 ogg（13 MB，正是从网页的合成配方烘出来的） | ✅ M11e：播 `public/assets/audio` 的 ogg（读不到时退回 `src/audio` 的实时合成配方） | 改播烘好的 ogg；WebAudio 总线：总限幅 → World（暂停 / 模态快照 0.45 增益 + 6 kHz 低通）→ SFX / 音乐 / 环境 / 混响，章节混响送、遮挡低通、敌人语音变体、密集音节流（同类最多 3 个）、首领主题 |
| 动画 | 53 份 `*.native-anim.json`（487 个片段、154 个带事件，30 fps，**本来就是 glTF 空间**——当初从网页的敌人代码采样来的）；125 个手 K 片段（9 首领、5 高原敌、商人）来自 20 个入库的 Blender 脚本；控制器拓扑对所有生物一致（Idle ⇄ Move 按 Speed，Any → `act_*` 触发，加法受击层） | 网页敌人逐类程序化摆姿势，没有片段 | native-anim 无损转 `THREE.AnimationClip`；Blender 脚本加 GLB 导出（17 个人形资产别从 Unity 转）；AnimationMixer 状态机照控制器拓扑；CreatureRig 的足部射线 + 两骨 IK、视线、受击弹簧照译；布娃娃先用网页现有的程序化倒地 |

## 6.1 资源体积

- 关卡发布目录 390 MB（网格 134、贴图 110、场景文档 155；17 张图）。
- 场景导出器按网格逐件写道具，没有引用 `public/assets` 里已有的道具 GLB，同一件道具在网页里存了两份。导出器改成引用资产 ID 后还能再省一截。
- 贴图以后转 KTX2（省显存，不只是省下载）。

## 7. 测试

- 网页现有：`npm test`（含 8 份 `tests/unity-*.test.mjs`：场景同步、碰撞、导航、材质、地形网格、关卡载入、玩法定义、武器同步）。
- M13：把 Unity EditMode 里的对照测试（`unity/Assets/Game/Tests/`，75 份）改写成 `node --test`，断言同样的数。工具在 `tests/unity-parity-kit.mjs`（`tsGraph` 载入去类型后的 TS 模块图、可按文件打桩；`cs` / `csTest` / `csConsts` 读 C# 源码里的常量和 Unity 测试里手抄的表；`combatRig` 真的 Combat 管线 + 假敌人）。常量尽量从 C# 源码用正则读出来比，改了一边另一边就红。对照出来和 Unity 不一致的地方不改实现，写成 `test.todo`（每条写明 Unity 的值、网页的值、文件）。

### 7.1 Unity 测试 → 网页测试对照表（2026-11-21）

状态：✅ 已迁 · 🔶 迁了一部分 · ➖ 网页原版测试已覆盖（Unity 那份本来就是从网页测试移植过去的）· ⬜ 没迁（写明等哪一期）· ✖ 不迁（纯 Unity）。

| Unity 测试 | 状态 | 网页测试 / 原因 |
|---|---|---|
| DamageCalcParityTests、CombatPipelineTests、StatSheetTests | ✅ M13 | `tests/unity-damage-calc.test.mjs` |
| ReactionTuningTests、ReactionTests | ✅ M13 | `tests/unity-reactions.test.mjs` |
| AffixTests、AffixTriggerTests、LegendaryTests | ✅ M13 | `tests/unity-affixes.test.mjs`：词条表 / 准入 / 文本逐条读 `Weapons/Affixes/**`、`Weapons/Legendaries/**`，抽取分布，AffixEffects 的触发与传说运行时。没迁：开火钩子那几条（天命每第 N 发、终焉末发 ×3、无尽不耗弹——在 WeaponSystem 的开火状态机里，随 FireMode 等 M8）、词条跨关保留（AffixesSurviveStageChange） |
| WeaponStatsTests | ✅ M13 | `tests/unity-weapon-stats.test.mjs`：解析器逐项、强化费用、各章稀有度 / 幸运 / 随机元素 / 掉落权重、奖励串 `weapon:<id>:<品质>` / `weapon:min=N`（解析 / 档位保底 / 提示，2026-11-21 补上） |
| WeaponDescriberTests | ✅ M13 | `tests/unity-weapon-describe.test.mjs` |
| ScrollRuntimeTests、ScrollOffenseTests、ScrollElementTests、ScrollUtilityTests、ScrollLegendTests、ScrollReactionTests | 🔶 M13 | `tests/unity-scrolls.test.mjs`：119 张的定义逐张对 `Progression/Scrolls/**`、Unity 测试里的数据表、属性卷（Unity 的 (Stat, 每层值) 装进网页逐张比）、抽取权重与 10 万次抽样、procScale、条件增伤四卷、元素弹三卷、传说卷的属性部分。没迁：其余各卷的触发行为（Unity 侧约 4000 行，靠 ScrollScope / ElementKit / TacticsKit 的假宿主驱动；网页要逐卷用真 Combat 搭场景）、ScrollRuntime 里 Unity 独有的部分（作用域钩子的装卸残留、Describe 的 `{s0}` / `{t0}` 模板、沙盒、读档——读档等 M11d）；经济那几条已在 `unity-combat-director` |
| ScrollTacticsTests | ➖ | `tests/scroll-tactics.test.mjs`（23 条，Unity 那份从它移植）；定义表另在 `unity-scrolls` 里对过 |
| EliteAffixTests | ✅ M13 / M5 | `tests/unity-elite-affixes.test.mjs`（登记 / 随机 / 四种词缀的数 / 龙卷表）+ `tests/enemy-framework.test.mjs`（龙卷扫掠）。头顶血条标签、金环、名字前缀属界面（M11c） |
| EncounterTests | 🔶 M13 | 站位角色的到场延迟、锚点加分（含高台 / Auto，2026-11-21 补上；选点行为在 `encounters`）、精英体型在 `tests/unity-elite-affixes.test.mjs`。EncounterSpec v2（Of / Wave / E、Promote、FromSquads / ToSquads、BandFor）、SquadAffixes.Resolve 网页没有实现——等 M4 待办「EncounterSite v2 其余部分」。网页旧的波次编排另有 `tests/encounters.test.mjs` |
| InfernoSquadsTests | ⬜ M4 | 网页没有 InfernoSquads / EncounterSpec（同上） |
| FireModeTests | 🔶 M13 / M8 | `tests/unity-fire-modes.test.mjs`：计时常量、蓄力曲线、切枪姿态（`FireControl.ts` 直接 import 比数值，确认 `WeaponSystem` 引用它）；扳机闩 / 冲刺禁射在 `m8-weapons`。其余 29 条行为用例没迁：状态机还在 WeaponSystem 单体里，要做假输入 / 假弹道夹具 |
| WeaponSpecialsTests | ⬜ M8 | 定义已在 `unity-defs-parity`；机制（穿透、蛊种、蓄力、轮转、双管逐发）靠状态机驱动，同 FireMode |
| RunRouteTests、RunPlanTests | ✅ M3 | `tests/unity-run-route.test.mjs` |
| CombatDirectorTests | ✅ M4 | `tests/unity-combat-director.test.mjs`（含 ScrollRuntime 的经济几条、BalanceModel 的击杀奖励） |
| EnemyFrameworkTests | ✅ M5 | `tests/enemy-framework.test.mjs` |
| Ch4FoundationTests | 🔶 M5 / M6 / M7 | 受击四层在 `enemy-framework`，破防条 / BossDef 缺省 / 领主梯度在 `hanba-boss`，导体与落雷在 `unity-mechanisms`；带电（计时 / 持有 / 死亡传电选目标）在 `m8-combat` |
| PlateauFoesTests | 🔶 M5 | 招式表（PlateauMoves ↔ defineMoves）在 `enemy-framework`；其余雷魅契约没迁（`src/enemies/plateau` 归 M12 在改） |
| HanbaBalanceTests | ✅ M6 | `tests/hanba-boss.test.mjs` |
| WarlordBalanceTests、WarlordSwordTests、WarlordDashTests、WarlordVfxTests | ✅ M6 | `tests/warlord-boss.test.mjs` |
| KunPengTests、QilinTests、LordTests、BossIntroTests | ✅ M6 | `tests/kunpeng-boss`、`qilin-boss`、`lord-bosses`、`boss-intro` |
| BossGaitAnimTests | ✅ M6 / M12 | 魔将的步态 / 登场落地在 `warlord-boss`；火麒麟的跃起 / 倒下 / 焚身踏云步态（手 K 片段）在 `anim-keyframed` |
| BossEncounterTests | ➖ | `tests/boss-supply.test.mjs`（Unity 那份从它移植）+ `lord-bosses` |
| LavaTests、WorldTests、ScenePiecesTests | ✅ M7 | `tests/unity-mechanisms.test.mjs`（网页旧熔岩另有 `tests/lava.test.mjs`）。LavaTests 的导航区域 / 游泳代理两条是 Unity 工程设置，不迁 |
| AudioI6Tests | ✅ M11e | `tests/audio-parity.test.mjs` |
| GraphicsAudioTests | 🔶 M11a / M11e | 混音 / 压低 / 密集音节流在 `audio-parity`，玩法屏效在 `post-stack`；画质档 / 显示设置等 M11d |
| RegistryTests | ✅ M2 | `tests/unity-defs-parity.test.mjs`（定义表逐字段）；秘卷登记另在 `unity-scrolls` |
| BalanceModelTests | ⬜ | BalanceModel（关卡表 / 经济投影 / 参考曲线）没迁（M3 备注）；首领击杀用时的参考曲线已在各首领测试里 |
| HudWidgetTests、EliteReadTests | ⬜ M11c | 界面后续期（路由 / 提示队列已在 `tests/ui-router.test.mjs`） |
| SaveServiceTests、RunSuspendTests | ⬜ M11d | 存档信封 / 迁移 / 续玩没迁 |
| HeroTests、SkillFrameworkTests、MotorTests、ProjectileTests、FeelProfileTests | ⬜ M8 | `src/player`、`src/combat/Projectiles.ts` M8 正在改，落定后迁。HeroTests 里属于 M10 的只有三位英雄的第一人称手臂名（armR / armL），已在 `tests/m10-handling.test.mjs` 的握点用例里对过（抄成常量 + 清单 bind 核对） |
| HazardTests、BossHazardTests | ⬜ | 网页有实现（`src/enemies/Hazards.ts`、`bosses/Hazards.ts`）、还没有对照测试；`src/enemies` 归 M12 在改，下一轮迁 |
| DemonBladeTests | ➖ | `tests/demon-blade.test.mjs`（Unity 那份从它移植） |
| ShopServiceTests | ➖ | `tests/shop-services.test.mjs` |
| FrostEnemyTests、FrostEnemyTests2 | ➖ | `tests/frost-pack` / `frost-tanks` / `frost-skirmishers` / `frost-ranged` / `frost-support` |
| InfernoEnemyTests、InfernoEnemyTests2 | ➖ | `tests/inferno-pack` / `inferno-tanks` / `inferno-ranged` / `inferno-blasters` / `inferno-support` |
| WeaponHandlingTests | ✅ M10 | `tests/m10-handling.test.mjs`：13 条里迁了 12 条（持握表与换弹风格、弹匣曲线与包络、整匣 / 逐发的手位时间线、两骨 IK、前臂摆动、CommitLoad 四条在真 WeaponSystem 上跑、左手静止在握点、三才转轮归转轮），另加持握预设 / 弹簧常数 / 握点与手臂对 Unity 表的数值对照（期望值照 C# 抄成常量、注明文件:行号，不读 `unity/`）；原作枪模的入位点、到时加弹的收尾音各一条；SocketsResolveThroughComponentAndByName ✖（Unity 的 WeaponSockets 挂点组件，网页枪模没有挂点，握点数值已对）。旧 `tests/handling.test.mjs` 9 条全绿（第 8 节第 3 条的 LOD 契约已按单级 LOD 改写） |
| BladeFirstPersonTests、CastPoseTests | ✅ M10 / M8 | `tests/m10-blade.test.mjs`：9 条全迁（两条剪辑用例改成对解析时间线——网页不烘剪辑，直接求同一条时间线），另加关键帧 / 常数 / 顿帧（含经 Viewmodel 的同帧顿帧）/ 真控制器冲击的对照（期望值照 C# 抄成常量，不读 `unity/`）；CastPoseTests 两条 M8 已迁在 `tests/m8-weapons.test.mjs`，核对过 |
| EliteStrikeSpringTests、KeyframedCurveTests | ⬜ M12 | 精英出手分量层的弹簧、手 K 片段的非人形骨 |
| FxTests、FxShotTests、FxStyleTests、GlowCrackTests | ⬜ M11b | 特效预设 / 图集 / 预算是 Unity 的 FxPreset 数据，随特效核心迁；GlowCrack 的资产导入设置不迁 |
| FirstPersonViewTests、PerfTests、RenderPerfSettingsTests | ✖ | 纯 Unity：相机栈、图层剔除距离、GPU Resident Drawer / 遮挡剔除设置 |

### 7.2 M13 对照出来的不一致（各测试文件末尾有 `test.todo`；标 ✅ 的已照 Unity 改好、todo 换成了真断言）

| 项 | Unity | 网页 | 文件 |
|---|---|---|---|
| ✅ 弱点伤害% 与进攻卷「破绽」weak_point | 命中弱点另乘 `Stat.WeakpointDamagePct`（`Combat.cs`）；「破绽」精良、3 层、弱点伤害每层 +15% | 2026-11-21 M8 改（4.6 第 1 条）：原来 StatKey 没有 `weakpointDamagePct`、也没有这张卷 | `src/core/types.ts`、`src/combat/Combat.ts`、`src/progression/scrolls/defsOffense.ts`（M8 战斗契约） |
| ✅ 灵宠伤害源 | `DamageSource.Pet` 只吃 `Stat.PetDamagePct`、不随机暴击 | 2026-11-21 M8 改（4.6 第 2 条）：原来 DamageSource 没有 pet，StatKey 没有 `petDamagePct` | `src/core/types.ts`、`src/combat/DamageCalc.ts`（M8 / M9） |
| ✅ 免疫提示事件 | 打不可选中的敌人返回 `DamageResult.immune = true` 并转发 EnemyDamaged（0.4 s 节流） | 2026-11-21 M8 改（4.6 第 3 条）：原来返回 null、不派发 `enemy:damaged`；格挡提示一并照 Unity | `src/combat/Combat.ts` |
| ✅ 玩家减益 寒意 / 引燃 / 日灼 | CombatPipelineTests 里有四条 | 2026-11-21 M8 改（4.6 第 4 条）：`player/PlayerStatus.ts`，四条已转成断言 | `src/combat/Status.ts`（M8） |
| ✅ 焚雷扩散灼烧的目标数 | `CombatTuning.Thunderfire.SpreadTargets = 16`（按距离取最近 16 个，Unity 注释写明是有意改的） | 2026-11-21 M8 改（4.6 第 5 条）：原来点燃半径内全部 | `src/combat/Reactions.ts` |
| ✅ 货币叫法 | 点金手 / 赏金 / 聚宝盆 / 贪婪之心写「灵石」 | 2026-11-21 秘卷定义（含聚宝盆提示）改成灵石。秘卷以外也全部改完：M11c 第二期把界面（`src/ui/labels.ts` coins / gold、暂停 / 关卡卡片 / 整局结算的「灵石」格、商店交互卡 `PromptWidget`「灵石不足」；旧的 `src/ui/SummaryScreen.ts`、`css/hud.css` 随旧 gf-* 界面删了）、`core/Stats.ts` 属性名「灵石获取」（= `StatInfo`）、`progression/Meta.ts` 财富天赋「每级灵石获取 +8%」（= `Talent_Wealth`）、`RunPlan.ts` 清关奖励名「灵石」（= `Chest.Label`）改成灵石；掉落 / 宝箱 / 商店的提示随后照 Unity 改：`Loot.ts`「当前武器已满级，改为灵石」/「没有可强化的武器，改为灵石」（`UpgradeReward`）、「秘卷已全部满层，改为灵石」（`LootDirector`），`loot/Chests.ts`「一大堆灵石」（`CoinsReward.Line`），`loot/Shop.ts`「灵石不足」（`ShopCounter.NotEnough`），白盒检视页的试购提示同改。玩家看得到的字串里不再有「金币」（`tests/ui-screens.test.mjs` 读 Unity 字面量对照）。宝箱说明行：M8 起精英关的宝箱写「一大堆灵石（精英加成）」（= Unity `CoinsReward.Line` 精英档）；Unity 首领档也写「精英加成」，但 `EconomyConfig.ChestCoins` 只给精英档 ×1.4，网页按实际发放只在精英关标（4.6 第 8 条） | `defsUtility.ts`、`defsLegend.ts`、`src/ui`、`core/Stats.ts`、`progression/Meta.ts`、`RunPlan.ts`、`Loot.ts`、`loot/Chests.ts`、`loot/Shop.ts` |
| ✅ 战鼓 | 「每处据点开战时」 | 2026-11-21 改：听新事件 `encounter:started`（StageDirector 在一场遭遇第一波开始时报一次，首领战不报，= EncounterSite.Activate → EncounterStarted） | `defsUtility.ts`、`StageDirector.ts`、`core/types.ts` |
| ✅ 回春的描述 | 「恢复速度每层 +8/秒」 | 2026-11-21 改 | `defsUtility.ts` |
| ✅ 功能卷标签顺序 | 主标签在前：灵盾 / 回春「护盾, 生存」、收割「击杀, 生存」、摄魂「击杀, 护盾」 | 2026-11-21 改 | `defsUtility.ts` |
| ✅ 高风险传说卷 | 标签「高风险」，代价另起一行红字（`LegendScroll.Text(收益, 代价)`） | 2026-11-21 改：标签「高风险」，ScrollDef 加 `upside` / `downside`（`legendText`），description = 收益 + 换行 +「代价：…」。代价行界面已接上（M11c 第二期）：三选一卡面收益与「代价」朱字行分开（`ScreenData.splitDownside` = Unity `ScrollChoiceScreen.SplitDownside`，传说卷读 `upside` / `downside`），行囊秘卷列表另起一行红字「代价：…」（`sf-owned__down`，同 Unity `ScrollList`），图鉴说明是富文本、代价行 `<color=#ff6a50>`（`scrollRichText` = Unity `Describe`）；暂停页只有小签、不带说明（同 Unity） | `defsLegend.ts`、`ScrollKit.ts`、`core/types.ts` |
| ✅ 武器奖励串 | `weapon:<id>:<品质>` / `weapon:min=N` 可指定武器、品质、保底 | 2026-11-21 改：`RewardType` 加 `weapon:${string}`，`rewardRules.parseWeaponReward / weaponRewardRoll / weaponRewardHintFor`；不带参数的 `weapon` 照旧按关卡档位保底（= ApplyTier）。顺带：Unity 藏宝点的 `weapon:min=1` 以前被适配器退成金币、`upgrade` 也退成金币，现在照奖励串发。据点清场奖励（`site.reward` / `chestOffset`）网页还没接 | `src/progression/Loot.ts`、`loot/rewardRules.ts`、`UnitySceneAdapter.ts` |
| 解析结果的弹速 | `ResolvedWeapon.projectileSpeed` | 只有 `projSpeedMult`，弹速在 Firing 里现乘（数值一致） | `src/weapons/WeaponStats.ts` |
| ✅ 高台站位加分 | 俯射角色上高台 +3、其它 −1.5；Auto 锚点不加不减；只站地面的不上高台 | 2026-11-21 改：`WaveRunner.anchorBonus`，锚点角色加 `auto`、带 `elevated`。**场景文档没有 elevated**：`WebSceneExporter.Encounter` 的 anchors 只写 position / lane / role，要导出器补 `SpawnAnchor.elevated`（适配器已接好）。顺带修了适配器把 StationRole 枚举值错一位读（0 = Auto 当成正面，锚点和条目的角色整体错一位）；条目的 Auto 改按敌人定义的 placement | `src/world/WaveRunner.ts`、`UnitySceneAdapter.ts` |

## 8. 已知问题

1. **法线贴图（已修）**：Unity 工程是线性色彩空间，`WebSceneExporter.ExportTexture` 把贴图 Blit 进默认（sRGB）的 ARGB32 渲染纹理。sRGB 贴图（颜色、地形 splat）来回一编一解没事；线性贴图（法线）的 RGB 被多套了一层 sRGB 曲线，再加上 Unity 法线贴图的 DXT5nm 打包布局（R=1、G=y、A=x），网页当普通 RGB 法线读，所有 Unity 道具的法线方向都是错的。发布步骤按 `UnpackNormalmapRGorAG` 解包修正；导出器本身下次改成线性渲染纹理（`RenderTextureReadWrite.Linear`）并直接写 RGB 法线。
2. **地形 splat 贴图（已修，2026-11-16）**：libwebp 无损编码默认把 alpha = 0 处的 RGB 清零，而 splat 的 A 通道存第 4 层权重，前 3 层权重在没有第 4 层的地方全丢了（1-1 有 98% 的像素权重和 < 0.5）。`webp_textures.py` 改为 `exact=True`，64 张 splat 解码后与 Unity 导出逐像素一致。
3. **旧的美术资产测试（已改写，2026-11-21）**：nature-scene（6）、gunfire-assets（4）、setdressing-assets（3）、native-hero-grip（3）、authored-scene-layout（2）、travel-deck、handling、cargo-hoist、articulation、architecture-scene（各 1）共 23 条按「三级 LOD」旧契约写的检查，已按现行契约（`art/README.md`：每个资产只有 `<ID>_LOD0`、不减面、面数只记录不设闸门）改写，`npm test` 全套 0 失败。whitebox-flow 里没有这类检查，基线上也没有失败。
   - 读发布 GLB 统一走 `tests/published-glb.mjs`：照文件自己声明的方式解码（Draco / meshopt / 不压缩），发布了几级读几级，`singleLodViolations` 断言「清单 `lodDistance = [0]`、文件里只有 `_LOD0`、压缩是 `AssetLibrary` 读得了的」。这 23 条涉及的资产实际全是 Draco + WebP；清单 350 个资产里 349 个符合。`art/tools/pose_geometry_audit.mjs` 的 `loadPublishedMesh`（按网格序号取）和 `setdressing_geometry.mjs` 的 `loadSetdressing`（写死三级）没动，测试不再靠它们读多级。
   - 照旧断言的性质：树根在碰撞半径内、栈桥板面沿中线连续、板面平整、绞车 / 货摊 / 冰船 / 渣车的体量与结构、门洞净空、等比缩放、建筑与巨崖落在碰撞包络里、地标贴地、松与石的视觉上限、远景在场地外、共享几何 / 材质不被销毁、贴图 1024² 与 ORM 打包、文件大小上限、sha256、Hunyuan / Tripo 来源登记、蒙皮修正不换缓冲。
   - 删掉的断言（只对多级 LOD 有意义，各测试文件头有注明）：LOD1 / LOD2 节点齐全、各级面数预算与逐级递减、跨 LOD 轮廓漂移、切换距离 `[0, 18, 42]`、近景 LOD1 / 远景 LOD2 的选级。喂三级网格的 fixture 用例保留——运行时对任意级数都要成立。
   - 两处放宽：① 建筑碰撞包络的宽高深是当年按三级 LOD 的并集量的，只剩 LOD0 后等比缩放贴不满（实测最大缝：冰原门楼顶 4.1 cm、熔炉门楼前后各 3.9 cm，墙 ≤ 6 mm），断言改成「不伸出包络 + 缝 ≤ 5 cm + 贴地」；② 地标可见性的采样从 5×6×3 格加密到 10×12×6 格——换成 LOD0 网格后 66 个采样点把 desert-4 的残垣量成 28.8%（阈值 30%），加密后稳定在 34%，是采样噪声不是摆位被挡。
   - **改写时发现的真问题**（没改资产和 `src`）：① `strip_lods.py` 改写了发布的 GLB 和清单的 sha256 / bytes，但没在 `art/source/**/asset.json` 的 publish 阶段登记——有 asset.json 的 234 个资产里 171 个的 publish sha256 对不上清单（gunfire-assets 里留了一条 `test.todo`；原来「发布文件 = 已审核 build 导出」的逐字节核对因此改成核对 LOD0 面数）；② `SM_Weapon_BoneDragon`（武器 launcher，本地 Blender 构建）的 GLB 里没有任何 `_LOD<n>` 节点，`AssetLibrary.load` 会抛「GLB 里没有按 _LOD<n> 命名的网格」而退回程序化模型；③ prop 档多了程序化的 `SM_Prop_InfernoChainLink`（7 件而不是 6 件），handling 测试已按来源分开断言，不算问题。
4. 主线 14 关里没有 4-2、4-4（Unity 里第四章本来就只建了 4-1、4-3）。
5. `tests/frost-tanks.test.mjs` 的「玄龟旋壳最多反弹两次」偶发失败（**已在测试里修掉，2026-11-21**）：`EnemyBase` 的 `losTimer` / `repathTimer` 用裸 `Math.random()`，抽到 ≳ 0.93 时玄龟 1.0 s 还在缩壳没进旋转（约 1/15）。这条用例现在把 `Math.random` 临时换成恒为 0.5 的随机源（和测试里 `ctx.rng` 的桩一致），跑完还原；`src` 没动——敌人基类那几处计时以后可以改走 `ctx.rng`。
6. **4-1 残鼓位置（Unity 构建器的错）**：`Level_4_1.BuildLords` 用 `ShowcaseSceneBuilder.Place(KuiDrumId, arena.transform, G(drumXZ), …)` 把世界坐标当成场地下的局部坐标，残鼓落在 (−205, 48.5, 131)，离夔的出生点（设计上残鼓就在这里）112 m；Unity 的 KuiDrum.Ensure 也按名字找到它，登场演出看的是远处那面鼓。网页（`lords/KuiDrum.ts`）离出生点 > 12 m 就把它挪回出生点（贴地高度不变）。
7. **发布的场景文档带着主检出没提交的场景改动**（M7 导出时发现）：2-1 / 2-2 / 2-3 / 3-3 的 `scenes/*.json` 是从主检出磁盘上 11-08 改过、没提交的 `.unity` 导出的，入库的 `.unity` 是旧的。`export-mechanisms.mjs` 按渲染件位置选源；以后重导场景 / 重新生成关卡前先决定那几份场景改动要不要提交。
