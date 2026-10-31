# 第四章 · 雪域天路 移植进 Unity（ch4 port v1，2026-10-31）

用户 2026-10-31 选定：第四章直接移植进 Unity，按首领与精英动作调优那一套流程做（设计单 → 手 K → 特效按风格准则 → 顿帧 / 震屏 / 音效 / 特效对齐到释放帧），分路并行。

网页版是**参考，不是照抄**（[Critical, not copy]）：数据、招式时间轴、镜头表照搬，动作、特效、手感按 Unity 现行标准重做。

## 0. 依据
- 地图：[level-design/chuanzang-v1.md](level-design/chuanzang-v1.md)。4-1 开放盆地、4-2 Y 形三江口，规则见 2.1 / 2.6 / 3.1。
- 战斗：[level-design/chuanzang-combat-v1.md](level-design/chuanzang-combat-v1.md)，包括八只雷魅、五个领主、带电与导体、受击四层、出手令牌、破防条、登场镜头表。
- 数据：
  - [art/ch4-move-events.json](art/ch4-move-events.json)：13 个资产、67 招的出手时间点，状态名 = 招式 id；
  - [art/ch4-boss-intros.json](art/ch4-boss-intros.json)：五个领主的镜头表。
- 网页代码：`src/world/plateau/`（4-1 + `play/` 战斗）、`src/world/gorge/`（4-2 + 大鹗）、`src/world/haizi/`（4-4 + 雷泽雷神）。
- 模型（都已导入 Unity）：
  - 雷魅：SK_Enemy_Marmot（啸獭）、Tiangou、Aoyin（獓狠；雷牦复用 ×0.72）、Jufu、Manman、Dijiang、Qiongqi；连鼓灵是 SM_EnemyPart_Liangu* 部件。
  - 领主：SK_Boss_Kui、Feilian、Huashe、Dae、Leize。
- 现成的 Unity 基础：
  - 灵火坛 `Encounters/SpiritAltar.cs` + `LevelObjective`（据点任意顺序、M 选 N 开出口，D27 已落地）；
  - 反应 焚雷 / 熔金 / 封脉 / 归墟；
  - `AttackTokens`、`WeatherDirector`（StormPhase）、`BossIntroDirector`、`EliteStrike`、`FxBudget`、`TelegraphTone`。

## 1. 决定

| # | 决定 | 理由 |
|---|---|---|
| C4-1 | 第四章接在第三章之后，整局 16 关；雷泽雷神是终局首领。demo 开关不变 | 网页文档把章节位置留作待定，按推荐直接定 |
| C4-2 | 第一期移植 4-1、4-2、4-4。4-3 雪域宫堡先写设计 `docs/level-design/maps/4-3.md`，第二期再建；在那之前 RunPlan 的第四章是 4-1 → 4-2 → 4-4 | 4-3 只有一行设计 |
| C4-3 | 开放图沿用塞尔达式：没有空气墙，边界靠地形 + 风雪软边界；Unity Terrain 多块拼接；据点任意顺序，点亮 3 处灵火开出口 | 用户的开放关卡原则 |
| C4-4 | 腐化色是「邪火紫红雷光」。预警仍走 TelegraphTone：草甸、雪地上用正红，雷魅的电弧 / 雷标用紫红，但必须和危险预警分得开。写进 fx-style §2.2 第四章底色 | 与 fx-style 一致 |
| C4-5 | Tripo 模型的金属度是 1，带电时整只被染成紫红。移植时第四章生物统一改成非金属，带电改用边缘光 | 网页文档第 7 节 |
| C4-6 | 4-1 三领主按打的先后变强：第 n 个打的（n = 0, 1, 2），血 ×(1 + 0.15n)、收招 ×(1 − 0.1n)；n = 2 时每阶段多一招变体。4-1 的领主转阶段只出横幅、不接管镜头 | combat 5.2 / 4.0 |
| C4-7 | 动作先用 `bake-native-anims` 从网页程序化姿势采样打底，招牌招式再用 Blender 手 K 覆盖（`Anim/Keyframed/<招式 id>.fbx`）；时间点照 ch4-move-events.json | 与前三章同一条管线 |
| C4-8 | 音效、配乐提示点放第二期，做法和 I6 一样：合成后离线烘焙成 ogg；镜头表的时间点就是提示点 | 网页版没有音效 |

## 2. 共享契约（F 路先建接口，其他路照调）

| 契约 | 内容 | 位置（建议） |
|---|---|---|
| 带电 | 状态「带电」：持续秒数，可叠时长；就反应而言等同带雷殛，火一碰就是焚雷；打爆带电的怪，电会放到 r 内的同伴身上（连锁，有上限）。API：`Charge.Apply(Damageable, seconds, source)`、`Charge.IsCharged(Damageable)`、`Charge.Arc(from, radius, maxHops)`；身上的噼啪视觉走边缘光 | `Combat/Charge*.cs` |
| 导体与落雷 | `Conductor` 组件：高度、引雷半径、能否充电、充电量 0..1、`Struck` 事件、`Discharge()`。`Lightning.Strike(pos, warn, radius, damage, source)`：预警 → 落雷，落点 r 内有更高的导体就劈导体，导体底下 2 m 溅电。经幡杆、拉则、碉楼、雷桩、导雷石柱、铁索桥都挂 Conductor | `World/Conductor.cs`、`World/Lightning.cs` |
| 破防条 | 领主血条下的金条：打弱点、反应伤害往里填，满了就破防，倒地 / 跪下 3.5–5 s、受伤 +30%、弱点全露；之后清空，下一次多要 25%。BossDef 里配阈值和破防姿势名；UI 在首领血条下 | `Bosses/BreakBar.cs` + BossBrain 接入 + `UI` 首领血条 |
| 领主梯度 | 见 C4-6：`LordScaling.For(levelId)` 返回第几个、各项倍率；转阶段只出横幅时 `BossDef.phaseCinematic = false` | `Bosses/LordScaling.cs` |
| 受击四层 | 闪白 + 数字 → 抖动（韧性未破）→ 硬直（韧性破）→ 眩晕（反制 / 破防）。韧性写在 EnemyDef；硬直、眩晕调 AI 的统一入口 | `Enemies/` 现有受击路径扩展 |
| 天气与风 | WeatherDirector 加「高原雷暴」：压暗、雨、按间隔落雷（走 Lightning，导体引雷），有入场条件和退场回调（夔、大鹗用）。WindField：基础风向 + 吸引点（飞廉），驱动经幡、草、粒子、玩家推力；4-2 峡谷风顺河吹 | `World/WeatherDirector.cs`、`World/WindField.cs` |
| 章节主题 | RunPlan 第四章；SpawnThemes 第四章出生法阵；VP_Plateau；BalanceModel / EconomyConfig 第四章编制；敌人注册 | 各自现有文件 |

**F 路的第一笔提交必须先把以上接口建好**：类型、方法签名、中文注释，能编译，最小实现即可。提交后通知 main，main 转给各路。在那之前，其他路先写设计单、移植 AI 逻辑，调到这些接口的地方先留桩。

## 3. 分路

### 第一期（2026-10-31 开工）

| 路 | 内容 | 拥有的文件 |
|---|---|---|
| **F 地基** | 第 2 节全部契约；RunPlan 第四章；fx-style 第四章底色；材质改非金属；平衡模型第四章 | `Combat/Charge*`、`World/{Conductor,Lightning,WindField}*`、`Bosses/{BreakBar,LordScaling}*`；共享改动：`BossBrain`、`BossDef`、`WeatherDirector`、`RunPlan`、`BuildOrder`、`SpawnThemes`、`TelegraphTone`、`EconomyConfig`、`BalanceModel`、首领血条 UI |
| **M1 地图 4-1** | 600 × 500 m 开放盆地；7 据点 + 出生 + 垭口；天路、牧道、河谷、山脊高路；冰川河、圣湖、冰湖；地标白盒；风雪软边界；6 座灵火坛（3 处开垭口）；风场吸向飞廉；7 处遇敌 + 穷奇游猎线；三领主擂台的锚点和场地件位置；先写 `maps/4-1.md` | `Pipeline/Editor/Levels/Level_4_1.cs`、`LevelKit.Plateau.cs`（新分部）、`docs/level-design/maps/4-1.md`、4-1 地图套件 |
| **E 雷魅** | 八只雷魅 + 雷牦 + 穷奇的 AI、受击、四种死法、带电互动（电网、比翼电弧、雷标、雷石电场）；采样配置 + 招牌招式手 K；特效；穷奇按精英走 EliteStrike；先写设计单 | `Enemies/AI/Plateau/**`、第四章 EnemyDef、`scripts/unity/bake/SK_Enemy_{Marmot,Tiangou,Aoyin,Jufu,Manman,Dijiang,Qiongqi}.mjs`、连鼓灵部件组装、`Fx/Fx.Plateau.cs`、`docs/art/vfx/foes-ch4.md`、`plateau-foes` / `beats-ch4-foes` 套件 |
| **B1 4-1 三领主** | 夔、飞廉、化蛇：BossDef / Brain / Moves；登场按 ch4-boss-intros.json 进 BossIntroDirector；场地机制（经幡杆回劈、风场与龙卷 / 火龙卷、湖面涨水与湿身导电）；破防；死亡演出；手 K + 特效；先写设计单 | `Bosses/{Kui,Feilian,Huashe}/**`、`Fx/Fx.{Kui,Feilian,Huashe}.cs`、`art/source/characters/SK_Boss_{Kui,Feilian,Huashe}/anim/**`、`docs/art/vfx/{kui,feilian,huashe}.md`、`boss-kui` / `boss-feilian` / `boss-huashe` 套件 |

### 第二期（第一期的地基落地、第二批收尾结束后）
- **M2 地图 4-2**：三江口、铁索桥、溜索、栈道、吊桥、伸臂桥、跳石、急流冲到河滩、涨水、落石、峡谷风。
- **M4 地图 4-4**：神山海子，湖心岛、导雷石柱、玛尼堆。同一路写 **4-3 设计**。
- **B2 大鹗 + 雷泽雷神**：四个环境机关、龙身拱段平台、通电湖水。
- **A 音效与 UI**：每招前摇声、落雷、反应、登场 / 转阶段 / 死亡提示点；书法名字卡；反应字样。
- 第四章整局自动通关（扩展 FullRunSuite）、图集（gallery-plateau / gallery-ch4-lords）。

## 4. 验收
- **每路**：
  - csc_check 和 EditMode 全过；
  - 自己的试玩套件全过；
  - 改动按「改前 / 改后」或「网页 / Unity」对比拼图，放 `docs/art/review/ch4-port/<路>/`。
- **地图**：
  - L5 关卡验收全过：锚点有路、出生净空、防越界、主线不靠二段跳、性能预算；
  - 网页版的视线点、可达率作为下限：4-1 盆地可走 ≥ 90%、全部据点和出口可达。
- **怪物 / 领主**：
  - 设计单里每个招式的节拍表；
  - 释放帧和判定误差 ≤ 1 帧；
  - 预警倒计时和释放帧对齐；
  - 第一人称读得出；
  - 性能 `perf-fx` 主线程不变差 10% 以上。
- **领主登场**：交还第一人称误差为 0（和前三章一样）。
