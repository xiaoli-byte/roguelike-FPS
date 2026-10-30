# Unity 对齐 Three.js 全量计划（parity v1，2026-10-20）

用户目标（2026-10-19）：Unity 版先做到 Three.js 版的**全部内容和水准**，再超越。
本文是总计划：目标、决定、差距总表、架构扩展点、工作单元与批次、美术长杆、验收。

- 依据：12 份子系统盘点（武器、战斗、秘卷、局流程、英雄、敌人 ×3 章、首领、关卡、UI、手感特效音频、美术），外加代码核对。
- 基线：master `f273091`。
- 关卡设计以 [unity-maps-v1.md](level-design/unity-maps-v1.md) 为准。本文不重复其中的地图细节。

路径缩写：`G/` = `unity/Assets/Game/Scripts/`，`P/` = `unity/Assets/Pipeline/`，`A/` = `unity/Assets/`，`S/` = `scripts/unity/`。

---

## 1. 目标与原则

### 1.1 对齐终点

| 维度 | Three.js | Unity 现状 | 对齐终点 |
|---|---|---|---|
| 整局 | 3 章 × 5 关，菜单 → 选英雄 → 结算 | 只有 1-1 白盒，通关是死胡同 | 3 章 × (3 张图 + 首领场) = 12 关，整局可通 |
| 英雄 | 燎 / 鼯 / 磐 | 燎 | 三人 |
| 武器 | 18 把（含碎刃），6 种开火模式 | 6 把，3 种模式 | 18 把 |
| 词条 / 传说 | 29 / 10 | 0 | 全部 |
| 秘卷 | 118 卷，带行为框架 | 16 卷，只有纯属性 | 118 卷 + 破绽（Unity 独有） |
| 敌人 | V2 阵容 27 种 + 旧 8 种 | 第一章 6 种 | V2 阵容 27 种 |
| 首领 | 5 个 | 0 | 旱魃 / 鲲鹏 / 火麒麟 + 熔心魔将（领主） |
| 局外 | 魂晶、10 天赋、存档、主菜单、结算 | 无 | 全部 |
| 手感 / 特效 | 完整反馈链 | 声音接近，画面和镜头明显更薄 | 超过 Three.js |

### 1.2 原则

1. **批判式移植**：每个系统都要回答三件事——Three.js 怎么做、哪些是浏览器时代的绕路、Unity 用什么做得更好。差距表里「Unity 做法」一列就是这个判断。下表是要丢掉的浏览器绕路：

| Three.js 绕路 | Unity 做法 |
|---|---|
| AABB 碰撞世界 + 只挡移动的墙 | PhysX 碰撞层（只挡移动的层另设一层） |
| NavGrid、flow field、手写 BFS（熔岩潜游） | NavMesh：区域 + 代理类型 + NavMeshLink |
| 首领从导航网格反推场地（冰窟、炉心） | 关卡里放 `BossArena` 显式锚点 |
| DOM / CSS 界面、DOM 伤害数字 | UI Toolkit + SDF 字体，池化 |
| 两盏常驻点光（为避免材质重编译） | Forward+ 光源池 |
| `renderer.compile` 预热、GLB 后台预载与回退 | ShaderVariantCollection；导入期生成 Prefab |
| 30 Hz 阴影刷新、手写分块 instancing | URP 级联阴影、GPU Resident Drawer |
| MouseLookFilter（指针锁定的位移尖峰） | Input System 原始输入 |
| 整页常驻 | 常驻 Core 场景 + 叠加加载关卡场景 |
| 程序化 CPU 粒子 | Shuriken 预设池 + URP Decal |

2. **手感优先**：要「射得爽」，秘卷叠起来要看得见。轻后坐、散布收紧，反馈要强（爆炸、顿帧、伤害数字、震屏）。数值以 Three.js 为基准；为手感改过的值单独一列，并注明原因。
3. **开放关卡**：不做走廊，不沿路摆景点，不立空气墙；边界靠地形 + 软边界。Three.js V2 的围墙八边形布局不重建，V2 平面图只取其中的「遭遇教学点」。
4. **并行友好**：新内容就是新文件。共享热点在第 0 批一次改完契约，之后每个单元只拥有自己的文件。
5. **先占位，后美术**：代码不等美术。缺模型时用占位体，换上正式资产不改代码。

**范围外**（对齐之后再做）：
- 第四章川藏高原。4-1 / 4-2 只是网页实验页，不在主流程里。
- Three.js 的 classic / LD-03 布局和旧阵容 8 种敌人。
- 白盒检视 lab 工具。

---

## 2. 决定

用户已授权（2026-10-19）：「不要停下来请用户审查，都按推荐选项推进」。下面每条都可以回滚，回滚时只改对应单元。

| # | 决定 | 理由 |
|---|---|---|
| D1 | **章节结构**：每章 3 张开放大图 + 1 个首领场，共 12 关。难度 = 1 + 0.8×章 + 0.16×关序（关序 0–3）。 | Unity 单张图主线 300–400 m、4 个以上据点，3 图 + 首领 ≈ Three.js 5 关的时长；章末难度 1.48 / 2.28 / 3.08 与 Three.js 一致。 |
| D2 | **第一章**：1-1 古道穿越戈壁 → 1-2 雅丹迷城 → 1-3 沉沙古城（末段寺院前庭设补给营）→ 1-4 鸣沙山月牙泉 · 旱魃（露天沙山盆地，2026-10-22 用户改定，不做地下穴）。 | 用户已定（unity-maps-v1）。 |
| D3 | **第二章**：2-1 冰瀑栈道 → 2-2 昆仑天阙 · 开明九门 → 2-3 瑶池冰湖 → 2-4 北冥冰台 · 鲲鹏。 | 沿用 V2「昆仑 → 北冥」的走向：攀冰瀑、叩天门、渡瑶池、下北冥。美术套件随之从昆仑套件过渡到北冥套件。2-2 合并了 V2 的玉阶雪关和开明九门。 |
| D4 | **第三章**：3-1 熔湖堤道 → 3-2 铸神井 → 3-3 铸范大坊（含鼓风正殿）→ 3-4 祝融炉心 · 火麒麟。 | 用 V2 阵容：Unity 已有全套模型和采样动作。Three.js 默认第三章仍是 LD-03 旧阵容，不跟。3-3 合并了 V2 的铸范大坊和鼓风正殿。 |
| D5 | **章末首领**是旱魃（全新）、鲲鹏、火麒麟。**熔心魔将**做成 3-3 终点场地的领主战（必经）。 | 保住全部首领内容。魔将原本的「方场熔岩涌动」改成 3-3 的熔铜渠涨落。 |
| D6 | **不移植**：沙暴巨像（用户决定由旱魃取代）；霜翼妖后 + 寒霜冰晶（鲲鹏取代，它的「回盾供能物」机制由旱魃「飞天之殇」继承）。两者的招式沉淀为 `BossHazards` 原语。 | 用户决定 / 只属于旧布局。 |
| D7 | **碎刃纳入**，作为第 18 把武器（掉落权重 0.6），完整移植：斩 / 千刃出窍 / 碎刃屏障 / 杀气爆发 / 人刀合一 / 噬灵鬼眼。 | 用户要全量。 |
| D8 | **英雄**燎、鼯、磐三人默认全部可选。`HeroDef.unlockCost` 字段保留，值为 0。 | Three.js 的 `DEFAULT_HEROES` 本来就三人全开，300 魂晶解锁是死代码。 |
| D9 | **旧阵容 8 种**（沙匪刀客 / 骨弩手 / 铁甲盾卫 / 爆骸虫 / 幽灵飞灯 / 巫祝 / 重炮兵 / 狙击手）和驼碑力士**不移植**。模型留在资产库，以后可做挑战变体。 | 只出现在不重建的 LD-03 / classic 布局里，Unity 也没有它们的动作。 |
| D10 | **稀有度统一 5 档**（普通 / 精良 / 稀有 / 史诗 / 传说，颜色用 Three.js 的），武器和秘卷共用 `G/Core/Rarity.cs`。 | 现在秘卷是 4 档、武器是 5 档，两边冲突，传说秘卷没有位置。 |
| D11 | **散布**：保留 Unity「收紧到约 40%」的做法。`WeaponDef` 照抄 TS 原值，另加一列 `spreadScale = 0.4`。按 Three.js 秒伤带复测：身体 60–90、近战约 105、狙击 120。 | 手感优先，同时不丢原值。 |
| D12 | **破绽**（Unity 独有）保留。断首按「弱点」判定，数值在平衡单元里复核。 | Unity 的弱点范围比 Three.js 的爆头宽。 |
| D13 | **货币**：局内叫「灵石」，局外叫「魂晶」。 | Unity 的 HUD 和灵宠描述已经在用灵石。 |
| D14 | **边界**：撤掉 1-1 的空气墙（`LevelKit.Boundary` 在第 2 层立的不可见墙），改成软边界：风沙把人推回、画面白化；更远处再放一圈兜底碰撞，并做坠落回收。 | 用户的开放关卡规则。 |
| D15 | **灵宠**（Unity 独有）保留，并跨关持久化。 | — |
| D16 | **数据代码优先**：每条武器 / 敌人 / 秘卷 / 词条 / 天赋就是一个 .cs，带 `[Defs]` 属性自动注册。调参总表（CombatTuning、EconomyConfig、FeelProfile）先写成代码默认值，以后由编辑器单元生成 ScriptableObject 覆盖。 | worktree 里没有编辑器，写不出 .asset；代码文件可以并行写、能 diff、能单测。这一条有意偏离盘点里「全部用 SO」的建议。 |
| D17 | **场景**：常驻 Core 场景（玩家、HUD、各系统）+ 叠加加载关卡场景。关卡场景只放环境和标记（PlayerSpawn、站位、出口…）。 | 现在每个关卡场景各自烘一份玩家，跨关什么都带不走。 |
| D18 | **UI 迁到 UI Toolkit**，打包 OFL 字体：正文 Noto Sans SC、标题霞鹜文楷、数字 Barlow Condensed。 | 现有 UI 只有约 950 行，越早迁越便宜。现在用的系统字体在 Steam Deck 上会显示成豆腐块，这会挡住 demo。 |
| D19 | **输入**：Input System 的动作写在代码里（`GameInput`），支持改键和手柄，放在 Art.Runtime 程序集。 | PlayerMotor 在 Art.Runtime 里；代码定义的动作不需要编辑器生成包装类。 |
| D20 | **包**：加 Animation Rigging。不装 VFX Graph（Shuriken + 贴花够用，也不依赖 compute shader）；不装 Cinemachine（第一人称镜头自写 CameraFeel，登场镜头用 Timeline——首领登场演出最后改成代码驱动的镜头表，见 [boss-intros.md](level-design/boss-intros.md)）。 | 少一个依赖，`manifest.json` 也少一处冲突。 |
| D21 | **特效**：池化的 Shuriken 预设 + URP Decal。贴图先程序生成，以后再换手绘。 | 资产库里一张特效贴图都没有。 |
| D22 | **存档**：存在 `persistentDataPath` 下的 JSON，原子写 + `.bak` + 版本迁移。测试和作弊用独立的 dev 档。 | — |
| D23 | 首领血条的刻度和阶段阈值都从 `BossDef` 读。 | Three.js 写死了一张表，鲲鹏和火麒麟的刻度是错的。 |
| D24 | **经济**按「每章收入」重调（Three.js 按 15 关算），由 `EconomyConfig` 出投影表，第 4 批定稿。 | Unity 是 12 关，每关据点更多。 |
| D25 | 第三章没有 Unity 设计文档。2-2 起的每张图，由地图单元先写 `docs/level-design/maps/<id>.md`（一张图一个文件），再动手建。 | 多个单元改同一份文档会冲突。 |
| D26 | 旱魃第三阶段以 unity-maps-v1 为准：日蚀时露出泉珠。不采用 enemy-roster-v2 里的「烈日坠地倒计时」。 | unity-maps-v1 更新。 |
| D27 | 第四章排在对齐之后。它的开放图规则（据点任意顺序、N 选 M 灵火坛、风雪软边界）现在就并进目标图系统和天气系统。 | — |
| D28 | **超越项**在对齐过程中顺手做：顿帧、冰面惯性、流沙、沙暴、中途续玩、图鉴、手柄。自动翻越会改变关卡可达规则，留到第 4 批评估。 | — |

---

## 3. 差距总表

状态：✅ 完成 · 🟡 部分 · ❌ 缺失 · ➖ 决定不移植。
量：S ≤ 半个会话 · M ≈ 一个会话 · L ≈ 一个满会话（XL 已拆开）。
「单元」列对应第 5 节。

### 3.0 已知缺陷（P0，先修）

| 缺陷 | 证据 | 单元 |
|---|---|---|
| 后处理整套丢失：`VP_*.asset` 的 components 全是 `{fileID: 0}`，重开工程后没有色调映射和 Bloom | `ShowcaseSceneBuilder.BuildLighting` 里 `profile.Add<…>()` 之后没有 `AddObjectToAsset` | W0-8 |
| 1-1 有空气墙 | `LevelKit.Boundary`（第 2 层的双面 MeshCollider，高 −30 到 80 m） | L3 / M11 |
| 中文用系统字体，Deck / Linux 上是豆腐块 | `Hud.cs:59`、`PetVisuals.cs:599` 调 `CreateDynamicFontFromOSFont` | U1 |
| 二段跳无法生效 | `PlayerMotor.airJumps` 没有任何地方赋值，`Stat` 里也没有 ExtraJumps | W0-1 / H1 |
| 空中刹车 21 m/s²，把冲刺跳的惯性吃掉 | `PlayerMotor` 地面和空中共用 acceleration × airControl | H1 |
| 武器爆炸不吃「爆炸伤害%」 | `SourceMult` 只看来源 | W0-1 |
| 投射物打不出爆头 | `PlayerProjectile.Cast` 不读弱点 | C4 |
| DoT 不吃元素加成；元素属性一加上就会悄悄算错 | `EnemyStatus` 的跳伤乘区是 1 | C2 |
| 特效材质在运行时 `Shader.Find`，打包时可能被剥离 | `FxMaterials` | F1 |
| 秘卷已满层时静默重复登记；秘卷只有 4 档稀有度 | `ScrollInventory.Gain` | W0-4 / S0 |
| 灵宠 FBX 导入了两份 | `Art/Pets` 和 `Art/Characters` | W0-9 |

### 3.1 核心架构与局流程

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 局状态 RunState | ❌ | 灵石在 `Hud.coins`，秘卷在 LootDirector，武器在 WeaponController，换场景全丢 | `RunState` + `IRunPersistent` 快照 | M | W0-5 / L1 |
| 章节规划 | ❌ | `ExitPortal.nextStage` 是一个字符串 | `RunPlan` 代码表：12 个 StageSpec | S | W0-5 |
| 难度缩放 | 🟡 | 只有整数 level | 浮点 difficulty（D1） | S | W0-4 / E1 |
| 场景流转 | ❌ | R 键同步重载场景 | Core 场景 + 叠加加载 + 淡入淡出 + 异步加载 + 预热 | L | L1 |
| 运行时生成玩家 | ❌ | `PlayerRigBuilder` 在编辑期烘进场景 | `PlayerFactory` 按 HeroDef 组装 | L | L1 |
| 游戏状态机 | 🟡 | 三个布尔量，5 处直接写 `timeScale` | `GameState` + 模态栈 + `TimeScaleArbiter` | M | W0-5 |
| 事件总线 | 🟡 | 只有零散的 C# 事件 | `GameEvents`（见 4.5） | M | W0-2 |
| 种子随机 | ❌ | 全用 `UnityEngine.Random` | `RunRng.Fork(流)` | S | W0-5 |
| 存档 | ❌ | 只有画质存在 PlayerPrefs | `SaveService`（D22） | M | R2 |
| 设置 | ✅ | —（操作 / 画面 / 声音 / 按键四页，控件按 GameSettings 自动生成；F4 加显示模式、分辨率、垂直同步、帧率上限、屏幕特效，F5 加环境音、界面音） | `GameSettings` + 设置面板 | M | W0-6 / U4 |
| 输入 | 🟡 | 6 个以上组件直接读 Keyboard | `GameInput`（D19） | M | W0-6 |
| 失焦暂停 | ❌ | — | `OnApplicationFocus` | S | W0-5 |
| 调试作弊 | ❌ | 只有自动冒烟测试 | `DevCommands` 注册表 | M | W0-5 |
| 中途续玩（超越） | ✅ | —（I5：每关开头把进关快照原子写进 `run.json`，主菜单「继续征程」、暂停「返回主菜单」= 暂离不结算，一局结算即删档，坏档丢弃并提示；见 7.6） | `RunSuspend` + `RunStateJson` | M | I5 |

### 3.2 战斗、元素、反应

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 伤害管线 | 🟡 | 缺伤害标签、bypassShield、canCrit、处决 / 静默处决、结果标志、吸血；监听器抛异常会留下僵尸敌人 | 分阶段管线 + try/finally | M | W0-1 / C2 |
| 暴击 / 弱点 | 🟡 | 投射物打不出弱点；没有 canCrit | 投射物取同体弱点球；`noCrit` | S | C4 |
| 属性乘区 | 🟡 | 缺 19 个属性键；只按来源算乘区 | 按标签算；Mult 下限 0.05 | S | W0-1 |
| 护盾 → 护甲 → 生命 | 🟡 | 缺护盾 / 护甲%、skipShield、首层与主层区分、溢出量 | 照 TS 移植 `applyLayers` | S | W0-1 |
| 破盾 / 破甲反馈 | ✅ | —（FX1：`FxDirector` 订阅破盾 / 破甲事件 → `ShieldShatter` 六边形碎片 / `ArmorChip` 甲片；打在盾 / 甲上的每一下也有各自的火花变体） | 事件 + 碎片特效 | S | W0-2 / FX1 |
| 灼烧 / 雷殛 / 蚀化 / 减速 | ✅ | 数值一致；只差 tick 对齐、音效节流 | 并进状态注册 | S | C2 |
| 眩晕 | 🟡 | 缺首领规则（×0.35、≤ 0.35 s、6.1 s 免疫）和 stunImmune | `IStunPolicy` | S | C2 |
| 状态查询与事件 | ❌ | 只有几个 bool | `StatusId` + `TryGet` + `GameEvents.StatusApplied` | S | W0-2 / C2 |
| 状态外观 | ✅ | —（FX2：`StatusFx`，光晕面片已撤） | 身体着色（MPB）+ 骨骼上挂粒子 | M | FX2 |
| 反应核心 | 🟡 | 事件缺深度 / 来源 / 标签 / 武器；没有大特效预算；每次反应都分配内存 | ReactionEvent 结构体 + 池化 + 每种反应一个处理器文件 | M | C1 |
| 焚雷 / 熔金 / 封脉 / 归墟 | ✅ | —（表现按 Three.js 移植：焚雷金爆 / 熔池贴花 / 封脉双环 / 归墟收束涡旋 + 爆开预设，FX1 / FX2） | 处理器 + 特效预设 | S×4 | C1 / FX1 / FX2 |
| 崩解 | ❌ | — | 并进 Detonate | S | C1 |
| 引爆 Detonate | ❌ | 贯虹满蓄、点穴、破势都依赖它 | `ReactionSystem.Detonate` | M | C1 |
| 强制反应 | ❌ | 涅槃、回响、劫火依赖它 | `ReactionSystem.Trigger` | S | C1 |
| 施加元素的选项 | 🟡 | 缺 reactionScale、持续时间、归属 | `ApplyStatus(opts)` | S | C1 |
| 反应浮字 / 首次遇到时的教学 | 🟡 | 没有预算，没有教学 | 预算 + `ReactionTips` | S | U3 |
| 范围爆炸 | 🟡 | 没有嵌套保护；每次都分配；击退不按距离衰减 | `ExplosionOptions` + NonAlloc + 嵌套深度 ≤ 6 | S | W0-1 |
| 爆炸特效 | ✅ | —（`Combat.Explode` 默认播 `Fx.Explosion`，noFx 时不播；焦痕贴花） | 预设：火球、烟、焦痕、灯、震屏 | M | FX1 |
| 爆炸波及玩家 | 🟡 | 只判一个点，没有冲量 | `Combat.BlastPlayer` | S | C3 |
| 玩家受伤与修饰器 | 🟡 | 没有受伤修饰列表；伤害事件在死亡判定之后才发（不能免死） | `PlayerVitals.Incoming`；`PlayerHit` 先于死亡判定 | M | W0-2 / C3 |
| 玩家减益 | ❌ | 寒意、日晒灼烧、点燃都没有 | `PlayerStatus` | M | C3 |
| 击杀结算 | 🟡 | 缺魂晶、静默处决、精英死亡震屏 | `KillResolver` | S | C2 |
| 吸血 | ❌ | — | 管线的奖励阶段处理 | S | C2 |
| 伤害数字 | 🟡 | 暴击不合并、没有 DOT 道、没有开关 | 见 3.12 | M | U3 |
| 命中标记 / 命中音 | ✅ | 只差时长曲线 | — | S | U2 |
| 命中火花 | ✅ | —（`FxDirector` 按伤害结果统一出：元素色 / 层色 / 敌人色，暴击星芒 + 金环，每帧 ≤ 10，同 Three.js） | `Fx.EnemyHit` | S | FX1 |
| 受击闪白 / 硬直 / 布娃娃 | ✅ | Unity 比 Three.js 好 | 只补 KnockedBack 标志 | S | E1 |
| 免疫 / 不可选中 | 🟡 | DOT 每跳都显示「免疫」；反应没有守卫 | 节流 + 守卫 | S | C2 |
| 精英 / 首领战斗修正 | ❌ | Damageable 没有首领概念 | `Damageable.rank` | S | W0-1 / C2 |
| 投射物系统 | 🟡 | 没有穿透、没有对象池；追踪每帧 FindObjectsByType | 池化 + 评分选目标 | M | C4 |
| 投射物外观 | 🟡 | 只有球和胶囊 | 按外观 id 注册 Prefab | M | C4 |
| 敌方投射物 | 🟡 | 缺追踪、挡弹 ward、冲刺穿过、对象池 | `EnemyProjectileSpec` | M | C4 |
| 战斗数值表 | ❌ | 全是 const | `CombatTuning`（代码默认值 + SO 覆盖） | S | C1 |
| 修饰器注册 | 🟡 | 公开的 List；迭代时删除会抛异常 | `ModifierList<T>` 返回句柄 | S | W0-1 |
| 伤害标签与归属 | 🟡 | instigator 是组件，不是武器实例 | `DamageTag` + `weaponUid` | S | W0-1 |
| 战斗调试 | 🟡 | 没有实时计数 | 调试叠层 + `PreviewMultiplier` | S | C1 |
| 顿帧（超越） | ✅ | —（F3 `HitStop`；I7 时长 / 缩放进 `FeelProfile`，另加清场慢动作 `ClearSlowMo`） | `HitStop` | S | F3 |

### 3.3 武器

框架：

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 定义与注册 | 🟡 | 6 把写死在静态构造里，缺约 20 个字段 | 每把一个 `[Defs]` 文件 | M | W0-3 |
| 开火模式 | 🟡 | 只有 Semi / Auto / Beam | `IFireMode`：点射 / 预热 / 蓄力 / 齐射 | L | W1 |
| 弹道 | 🟡 | 没有穿透；投射物瞄准封顶 60 m（曳光已按元素着色、按武器表加粗，FX1） | 穿透循环（×0.85，最多 8 个）；元素色 HDR 曳光 | M | W1 / FX1 |
| 数值合成 | 🟡 | 散在 WeaponController 内联；备弹和爆炸半径不吃属性 | `WeaponStatsResolver`（带缓存） | M | W2 |
| 实例元素 | ❌ | 左轮、冲锋枪的元素率永远不触发 | 精良以上 35% 随机元素 + MPB 着色 | S | W2 |
| 稀有度 | 🟡 | 颜色与 TS 不一致；没有章节权重和幸运 | `Rarity` 表 | S | W0-3 / W2 |
| 掷骰与掉落 | 🟡 | 奖励串写死成 "weapon:beam"；场景里留着测试武器架 | `WeaponRoller.Roll` | S | W2 / M11 |
| 强化 +1 … +5 | 🟡 | 只有倍率，没有获取途径 | `UpgradeCost` + 强化台 + upgrade 奖励 | S | W2 / R3 |
| 开镜 | 🟡 | 没有每把枪自己的开镜速度；没有狙击镜；红点和瞄具没导出 | 参数进定义；镜遮罩用 UI；瞄具补网格 | M | WC1 / W3 |
| 换弹风格与装填动作 | 🟡 | 只有下沉；逐发换弹完没有 0.3 s 上膛 | `HandlingProfile` + TwoBoneIK + 动画事件 | L | W1 / W4 |
| 第一人称手感 | 🟡 | 缺侧倾、滞后、落地、冲刺姿态、切枪收放；枪口位置是常数 | 弹簧阻尼；用枪口 socket | M | W4 |
| 活动零件 | ❌ | 骨骼在，没有代码驱动 | `WeaponPartAnimator` | M | W4 |
| 零件语义与挂点 | ❌ | sidecar 里只有 j_N 编号 | 导出时映射成语义名 + sockets | M | W3 |
| 武器 HUD | 🟡 | 缺副槽、元素、+N、能量、蓄力环 | 见 3.12 | M | U2 |
| 描述与对比 | ❌ | 只显示一行名字 | `WeaponDescriber` + ▲▼ 对比 | M | WC8 |
| 地上的武器 | 🟡 | 缺 worldScale 和元素光 | 补上 | S | W2 |
| 双槽切枪 | 🟡 | 缺每把枪单独冷却、防抖、齐射打完 | 并进开火框架 | S | W1 |
| 弹药经济 | 🟡 | 缺应急补给、换关补给、无限弹药 | 计数器 | S | W1 |
| 武器事件 | 🟡 | 只有 Fired / Changed | 进 `GameEvents` | S | W0-2 |
| 武器音效 | ✅ | 只差机炮预热、蓄力音 | — | S | WC2 / WC3 |
| 秒伤基准 | ✅ | —（I3：按裸秒伤判 Three.js 秒伤带，18 把都在 ±20% 内；另报实战秒伤和倍率，见 [balance.md](balance.md) 第二节） | `WeaponDpsSuite` 输出 CSV | S | WC8 / I3 |

18 把（数值见 `src/weapons/WeaponDefs.ts`）：

| id | 名称 | 模式 | 状态 | 缺口要点 | 单元 |
|---|---|---|---|---|---|
| revolver | 赤铜左轮 | 半自动 | 🟡 | 转轮 1/8 圈、快装器换弹、随机元素 | WC4 |
| smg | 蜂鸣冲锋枪 | 全自动 | 🟡 | 弹匣取放、左手送弹 | WC4 |
| rifle | 裂风步枪 | 全自动 | ❌ | 定义、rig、红点 | WC1 |
| burst | 三叠点射枪 | 点射 3 发 | ❌ | 点射模式、管状瞄具 | WC1 |
| shotgun | 碎岩霰弹 | 泵动 / 逐发 | 🟡 | 0.3 s 上膛、泵动、手持弹壳 | WC4 |
| sniper | 鹰隼狙击 | 栓动，穿透 2 | ❌ | 狙击镜、隐藏枪模、换弹退镜 | WC1 |
| launcher | 焚城榴弹 | 投射物 | 🟡 | 160 m 瞄准、半径吃属性、榴弹外观、弹鼓转动 | WC4 |
| crossbow | 追魂连弩 | 投射物，穿透 3 | ❌ | 弩弦、弩箭显隐、投射物穿透 | WC3 |
| beam | 雷弧发射器 | 光束 | 🟡 | 弹射几率减半且不暴击、能量罐换弹、颤动 | WC4 |
| minigun | 旋风机炮 | 预热 | ❌ | 预热 / 减速、转管、移速 −2 | WC2 |
| swarm | 蜂群飞弹 | 齐射追踪 | ❌ | 齐射 5 枚、火箭外观 | WC2 |
| flamer | 朱雀吐息 | 火焰锥 | ❌ | 粒子锥 + 每跳 OverlapCapsule | WC2 |
| stormpod | 青冥雷蛊 | 弹跳蛊弹 | 🟡 | 固有副·雷改走词条、鼓转动、外观 | WC4 |
| magmashot | 赤蛟霰铳 | 双管折开 | ❌ | 导出枪管关节、折开换弹 | WC4 |
| trinity | 三才转轮 | 元素轮转 | ❌ | 每发覆盖元素、枪身发光显示下一发 | WC4 |
| railgun | 贯虹灵炮 | 蓄力引爆 | ❌ | 蓄力模式、Detonate、虹光 | WC3 |
| lantern | 蚀蛊灯 | 追踪穿透 | ❌ | 投射物穿透 + 蛊种 | WC3 |
| demon_blade | 碎刃 | 近战接管 | ✅ | —（碎片网格 / 刃群 WC5，控制器 WC6；第一人称 `BladeView` WC7：代码生成的三段斩剪辑 + 判定帧事件、程序剑指（静态手臂补两根手指）、碎片在手 / 伸刃 / 归位闪、FX1 预设的程序刀光、视觉顿帧；套件 `playtest blade-fp`） | 碎片网格、控制器、第一人称 | WC5 / WC6 / WC7 |

### 3.4 词条与传说（全部 ❌）

| 组 | id（名称） | 单元 |
|---|---|---|
| 数值 15 | dmg 伤害 · rate 射速 · mag 弹匣 · reload 换弹 · critDmg 暴伤 · critChance 暴击率 · elemChance 元素率 · spread 散布 · recoil 后坐 · pierce 穿透 · blast 爆炸范围 · projSpeed 弹速 · reserve 备弹 · hunter 猎首 · swift 轻盈 | AF1 |
| 触发 14 | headBlast 爆头爆炸 · killRefill 击杀回填 · hitShield 命中回盾 · ricochet 弹射 · subFire 副·焚 · subShock 副·雷 · subCorrode 副·蚀 · rxnDmg 化合 · rxnRefill 回元 · rxnHaste 疾化 · statusHunter 乘隙 · rxnShield 化盾 · detonate 破势 · seed 蛊种 | AF2 |
| 传说 10 | lg_nth 天命 · lg_nova 殉爆 · lg_last 终焉 · lg_prism 万象 · lg_frenzy 狂热 · lg_endless 无尽 · lg_bond 合璧 · lg_lunhui 轮回 · lg_nirvana 涅槃 · lg_boil 鼎沸 | AF3 |

框架要求：
- 准入过滤：gunOnly / directHit / canReact / isExplosive。每抽一条都要按已抽到的重新过滤。
- perHit 类按「× 3.5 ÷ 每秒命中数」归一，夹在 2–75%。
- fixed 词条不随稀有度放大；固有词条排最前，不占名额。
- 触发效果先排队，下一帧再执行；同一帧对同一敌人的伤害合并。

### 3.5 秘卷（118 卷 + 破绽）

框架：

| 项 | 状态 | Unity 做法 | 单元 |
|---|---|---|---|
| ScrollScope（属性、订阅、出伤 / 受伤修饰、任务、限时增益、条件属性、内置冷却、卸载） | ❌ | `ScrollScope : IDisposable` | S0 |
| 属性键（19 个） | 🟡 | 一次补齐 | W0-1 |
| 战斗 / 武器 / 技能钩子 | 🟡 | `GameEvents` + 修饰器 | W0-2 |
| 反应接口（Detonate / Trigger / reactionId） | 🟡 | 同上 | C1 |
| 抽取规则：5 档；权重 [100, 52, 26, 11, 4]；幸运、章节、已有 ×1.3、专属 ×1.5、元素源 ×1.4 / ×0.5、流派 ×1.3；精英和首领 min=1；全满层转灵石 | 🟡 | `ScrollRoll` 纯函数 + 单测 | S0 |
| 叠层：卸载后重装（批处理，不重复送上限）；获得提示带稀有度色 | 🟡 | `StatSheet.BeginBatch` | S0 |
| 跨关持久化 | ❌ | 存进 RunState | W0-5 / L1 |
| 三选一界面：挂轴卡、点阵、新得 / 升层、下一层数值预览 | 🟡 | UI Toolkit | S7 |
| 已获得面板（Tab / 暂停 / 结算） | ❌ | 共用的 ScrollList | U4 / U5 |
| 说明文本、触发时弹字 | 🟡 | 从数据模板生成描述；触发时在准星旁弹字 | S7 |
| 数据校验、回归测试（移植 scroll-tactics.test.mjs） | ❌ | EditMode | S0 / S6 |
| 秘卷场景模型（商店摊位） | ❌ | 程序网格按稀有度着色 | R3 |

内容（✅ = Unity 已有且数值一致）：

| 组 | 数 | 状态 | id（名称） | 单元 |
|---|---|---|---|---|
| 攻击 | 24 | 5 ✅ · 1 🟡 · 18 ❌ | ✅ keen_blade 利刃 · hawk_eye 鹰目 · fatal_art 致命诀 · rapid_fire 骤雨 · swift_hands 疾手；🟡 bottomless 百宝囊（缺备弹）；❌ giant_slayer 屠巨 · shield_breaker 破盾 · armor_piercer 穿甲 · first_blood 先声夺人 · executioner 断命 · close_combat 近身搏杀 · sharpshooter 百步穿杨 · headsman 断首 · crit_streak 连击心法 · steady 稳如磐石 · meteor_shot 流星 · last_rounds 背水弹匣 · reload_rush 装填激励 · reload_nova 换弹冲击 · blast_master 爆破专家 · chain_blast 连环爆 · volatile_rounds 爆裂弹 · thunder_judgment 天雷引 | S1 |
| 元素 | 10 | 10 ❌ | ember_heart 炎心 · thunder_heart 雷心 · venom_heart 蚀心 · five_elements 五行共鸣 · ignite_rounds 燃弹 · storm_rounds 雷弹 · acid_rounds 蚀弹 · wildfire 野火燎原 · static_arc 静电弧 · acid_burst 蚀爆 | S2 |
| 功能·技能与生存 | 22 | 7 ✅ · 15 ❌ | ✅ iron_bones 铁骨 · spirit_ward 灵盾 · quick_recovery 回春 · harvest 收割 · soul_siphon 摄魂 · stone_skin 石肤 · streamer 流光；❌ spirit_spring 灵泉 · arcane_surge 法力涌动 · extra_charge 多重储备 · skill_echo 回响 · soul_reap 夺魂 · blood_drinker 噬血 · regen 生生不息 · last_stand 背水一战 · shield_nova 碎盾反击 · thorns 以牙还牙 · pain_to_power 化痛为力 · second_wind 绝处逢生 · phoenix_feather 凤羽 · phantom_step 幻影步 · high_ground 居高临下 | S3 |
| 功能·机动与经济 | 8 | 2 ✅ · 6 ❌ | ✅ wind_walker 踏风 · spirit_lure 灵引；❌ cloud_step 凌云 · war_drum 战鼓 · golden_touch 点金手 · fortune_charm 招财符 · bounty 悬赏令 · treasure_bowl 聚宝盆 | S3b |
| 传说 + 英雄专属 | 10 | 10 ❌ | glass_cannon 玉碎 · berserk_blood 狂血 · gambler 赌徒之心 · thousand_blades 万剑归宗 · midas_heart 贪婪之心 · blood_pact 血契 · overdrive 超载 · fox_resonance 火灵共鸣（燎）· falcon_sky 九天雷鸣（鼯）· bear_mountain 不动如山（磐） | S4 |
| 反应·基础 | 12 | 12 ❌ | rx_catalyst 催化 · rx_haste 灵动 · rx_tf_charm 雷火符 · rx_mg_charm 熔金符 · rx_vs_charm 封脉符 · rx_lead_shock 引雷 · rx_lead_fire 引火 · rx_lead_corrode 引蚀 · rx_ward 化劫 · rx_transmute 化元 · rx_tf_scatter 爆焰 · rx_vs_lock 锁灵 | S5a |
| 反应·进阶 | 12 | 12 ❌ | rx_acupoint 点穴 · rx_mg_shatter 熔铸 · rx_ab_mark 三才印 · fox_thunderfire 火灵引雷（燎）· falcon_veinseal 蚀羽惊雷（鼯）· bear_magma 熔岩撼地（磐）· rx_tf_capstone 焚天雷狱 · rx_mg_capstone 金乌坠 · rx_vs_capstone 镇岳 · rx_ab_amp 归真 · rx_hunyuan 混元 · rx_kalpa 劫火 | S5b |
| 战术 | 20 | 20 ❌ | tac_crossfire 交替火力 · tac_cover_change 换位掩护 · tac_reload_guard 装填壁垒 · tac_loaded_focus 凝神装填 · tac_dash_load 滑步装填 · tac_dash_wave 踏浪震击 · tac_landing_wave 坠星震地 · tac_battle_mage 术法回流 · tac_spell_ward 施法护符 · tac_alternating_arts 双诀相生 · tac_pristine_shield 完璧锋芒 · tac_emergency_reload 破盾急装 · tac_healing_barrier 回生结界 · tac_crit_insight 会心悟道 · tac_focused_prey 追猎印记 · tac_reaction_ward 化应为盾 · tac_reaction_stride 应变疾行 · tac_stagger_hunter 乘隙追击 · tac_dash_capstone 疾影破军 · tac_spellgun_cycle 灵武轮转 | S6 |
| Unity 独有 | 1 | ✅ | weak_point 破绽（D12） | S1 |

合计 24 + 10 + 30 + 10 + 24 + 20 = 118。其中传说 11 卷（风险标签显示为「高风险」），英雄专属 6 卷：磐的两卷按 D8 照常进卡池。

### 3.6 英雄、玩家、技能

| 英雄 | 状态 | 被动 / E / Q | 缺口 | 单元 |
|---|---|---|---|---|
| 燎 · 爆竹游侠（fox，红熊猫） | ✅ | 余烬 / 燃爆雷 / 尾焰火灵 | —（H2 补齐投掷继承速度、半径吃属性；HC3 火灵卡通火舌、引信火苗、纸灰余火、出手动作） | H2 / HC3 |
| 鼯 · 雷鼓机关师（falcon，鼯鼠） | ❌ | 凌空（二段跳、滞空 +15%、滑翔）/ 雷鼓信标 / 雷目 · 裁决 | 整个英雄；雷鼓信标道具 | HC1 |
| 磐 · 工匠武僧（bear，穿山甲） | ❌ | 厚皮（破盾冲击波）/ 裂地重击 / 磐石壁垒 | 整个英雄；敌人击飞上抛 | HC2 |

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 英雄定义与技能槽 | 🟡 | `Configure` 里只有一个 switch；没有 SecondaryCharges、ReduceCooldown、SkillUsed | `HeroDef` + `TimedSkill` 撤销栈 | M | W0-3 / H2 |
| 基础移动 | 🟡 | 空中刹车 21 m/s²，吃掉冲刺跳惯性；显式欧拉积分 | 地面和空中分别设加速与阻力（78 / 60 / 20 / 1.2）；梯形积分 | S | H1 |
| 多段跳 | 🟡 | `airJumps` 无人赋值；没有转向 | ExtraJumps 映射；二段跳转向 65% | S | H1 |
| 滑翔 | ❌ | — | `IMotorModifier` | S | HC1 |
| 冲刺 | 🟡 | 冲刺后 0.06 s 锁定、跳跃打断冲刺、气流特效都缺 | 补齐 | S | H1 |
| 运动 API | 🟡 | 缺 Launch / CancelDash / Teleport / 无敌 / 突进 / 坠落回收 | 补齐 | S | H1 |
| 镜头 rig | ❌ | 主相机只有旋转抖动 | `CameraFeel`（见 3.13） | M | F3 |
| 视角设置 | ❌ | 灵敏度写死；没有反转 Y；FOV 70（Three.js 80） | `GameSettings` | S | W0-6 |
| 枪模随移动的反应 | 🟡 | 见 3.3 | — | S | W4 |
| 第一人称手臂 | 🟡 | 三套手臂都在，只接了燎 | 由 HeroDef 引用；按英雄 × 武器调握点 | S | L1 / W4 |
| 玩家生命钩子 | 🟡 | 见 3.2 | — | S | W0-2 / C3 |
| 技能 HUD | 🟡 | 框色写死；充能点数量固定 | 环形冷却 + 英雄色 | S | U2 |
| SkillFx 工具包 | 🟡 | 缺 shockwave / groundCrack / burst | `SkillFx` | M | H2 |
| 选英雄 + 3D 祭台 | ❌ | — | 见 3.12 | L | U6 |
| 冰面惯性（超越） | ❌ | — | `SurfaceZone` | S | L8 |
| 技能出手动作（超越） | ✅ | —（HC3 `CastPose`：投掷 / 召唤 / 砸地 / 举手 / 点名五种，三位英雄共用） | 覆盖姿态时间线 | M | HC3 |
| 自动翻越（超越，待定） | ➖ | 会改变关卡可达规则 | I7 评估后不做（理由见 [feel.md](feel.md) 第三节） | M | I7 |

### 3.7 敌人框架

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 定义与注册 | 🟡 | 一个静态字典只有 7 条 | 每种敌人一个 `[Defs]` 文件 | M | W0-4 |
| AI 基类 | 🟡 | 缺 CancelAttack、玩家死后待机、静态事件、发光通道 [3]、坠落回收 | 补齐 | S | E1 |
| 出手名额 | 🟡 | 上限不随章节变，没有续期和 Reset | 独立文件 | S | E1 |
| 辅助加成登记 | 🟡 | 写死只认 ApsaraAI | `EnemyBuffs` 多通道相乘 | S | E1 |
| 敌人注册表 | ❌ | 到处 `FindObjectsByType` | `EnemyRegistry` NonAlloc 查询 | S | E1 |
| 多段命中区 | 🟡 | 只有一个弱点球 | `HitZone` + ZoneDamaged；存活时启用布娃娃胶囊做命中盒 | M | E2 |
| 寻视线 / 高台站位 | 🟡 | 没有 seekSight | `Sight.Seek` | S | E3 |
| 飞行基类 | ❌ | 必须挂 NavMeshAgent | `FlyingEnemyAI` | M | E3 |
| 栖落点 | ❌ | Three.js 扫 AABB 顶面 | `PerchPoint` 标记 + 兜底搜索 | S | E3 |
| 危险物库 | 🟡 | 爆炸没有击退，FireZone 只能画圆 | `EnemyHazards` / `HazardZone` / `GroundWave` / `SpikeField` | M | E4 |
| 地上的火（可吃） | 🟡 | — | `FloorFire` + `FireFeed` | S | E4 |
| 连环爆 | ❌ | — | `ExplosiveChain` | S | E4 |
| 精英 | 🟡 | 缺金环、名字前缀 | `EliteAura` | S | EN4 |
| 词缀框架 | ❌ | — | `EliteAffix` 注册表 | S | EN4 |
| 迅捷 / 坚盾 / 爆裂 / 狂暴 | ❌ | — | 每种词缀一个文件 | S×4 | EN4 |
| 出生表现 | ✅ | —（FX2：`SpawnMaterialize` 法阵贴花 + 溶解显形 + 按地表的沙旋 / 雪旋） | 溶解显形 + 沙旋 | S | FX2 |
| 死亡表现 / 清场 | 🟡 | 没有 PurgeAll（迸散 + 尸体溶解已做，FX2 `DeathDissolve`） | 迸散 + 溶解；`PurgeAll` | S | E1 / FX2 |
| 遭遇编排 | 🟡 | 不分站位角色，没有多波次 | 见 3.10 | L | L2 |
| 动作补全 | 🟡 | 第二章缺约 25 段，第三章缺全部招牌状态；首领片段没有事件 | 强制状态采样 + 事件叠加 | M | E5 |
| 圆盘影 | ➖ | URP 阴影已替代 | 只在飞行怪下加贴花 | — | — |

### 3.8 敌人阵容

第一章（Unity 已能玩，按 Three.js 补齐）：

| id | 名称 | 状态 | 缺口 | 单元 |
|---|---|---|---|---|
| jerboa_blade | 跳鼠刀兵 | ✅ | 精英扑空立刻重扑（0.24 s 蹲伏）、旋斩命中震屏、起跳扬沙；补 TS 的出手条件（高差 1.6 m、扑斩直线无遮挡）与打断后冷却重摇 | EN1 |
| scorpion_archer | 蝎尾弩卫 | ✅ | 寻视线（`SightSeeker`，10–22 m）、上弦最后 0.15 s 弩尖金光、`arrow` 弩矢、沉沙 / 钻出扬沙、潜行沙浪 + 沙痕、钻出近处震屏、钳击发光通道 2。**修**：玩家阵亡 / 清场时卡在沙下隐身（TS cancelAttack 的回地面没移植） | EN1 |
| mirage_toad（+ decoy 蜃景） | 蜃楼蟾 | ✅ | 寻视线（盲吐够不着时）、喉囊鼓起 ×1.32 + 吐出一缩（弱点球跟着变大）、真火珠 `flame` 外观 + 金色落点圈 + 落地火团 / 冲击环 / 「炽沙」余火（地火，祸斗能吃）/ 焦痕，幻影火珠冷白半透明、无预警；打断后冷却重摇 | EN1 |
| fire_rat | 火浣鼠 | ✅ | 火毛发光按状态、蜷身身体烧红、尾火、滚动火球壳 + 火尾、撞墙回弹、爆炸改走 `Blast.Player`（边缘 0.5、掀开 5.5、震屏 0.7）+ 火环 + 火柱 + 焦痕；高差条件。火焰本体 FX4：火苗毛 `_FLAMEKEY`、骨骼火舌 + 火球火舌（SF_FxFlame）、余火 = 余烬地火 | EN1 / FX4 |
| tomb_beast | 三彩镇墓兽 | ✅ | 精英一直二连冲（同 TS isElite \|\| enraged）、每掉 12% 崩陶片、撞墙背上喷日火柱、死时陶身炸碎 + 火柱 + 焦痕、踏地爆心掀开 8 + 冲击波外推 9 / 上 5、STOMP_RANGE 3.2、砸地点在身前 1 m、冲锋超时刹车、高差条件；FX4：背上龟裂里的日火火舌随旺度蹿高 + 火星、冲锋犁出的日火裂痕是日火地火 | EN1 / FX4 |
| apsara | 邪飞天 | ✅ | 精英护盾 / 回复 ×1.3、登场旋降 1.8 s、琴碎后哀鸣 1.4 s + 拉远到 18–26 m、最后 3 s 金光预警 → 重凝 1.6 s、每 1/4 断一根弦、琴碎后弱点挪胸口（原来直接关掉，琴碎后打不出暴击）。**和 TS 不同**：光环从出生就开（落地前就有金丝提示） | EN1 |
| sand_wraith | 沙魇（旱魃召唤，Unity 新增） | ✅ | 定义 `Enemy_SandWraith` + `SandWraithAI`：借跳鼠美术换 `EnemyVariant` 皮（沙化 + 日火裂纹，着色器参数）；沉沙 → 潜行（打不到、沙痕）→ 定点 0.6 s 预警 → 破沙旋斩掀开 → 0.7 s 硬直；贴脸爪击；精英连潜；受击扬沙、倒下崩沙。旱魃召 sand_wraith ×2 + 沙魇·蝎尾弩卫；1-x 编排可直接写 id。其余第一章杂兵用 `EnemyVariant.Sand` 换「沙魇·」皮 | EN1 |

第一章验收：`bridge.sh playtest desert`（`DesertEnemiesSuite`，TestArena）——七种各刷普通 + 精英，逼出全部状态、各自的精英行为（重扑 / 五连射 / 双吐 / 二连冲 / ×1.3 护盾 / 连潜）与死亡产物（余火 / 焦痕 / 崩沙 / 分身消散 / 光环撤掉），并核对数值与 AC_ 片段。

第二章（美术都在：SK_ + AC_ + 采样片段；玩法全缺）：

| id | 名称 | 定位 | 缺的片段 / 美术 | 单元 |
|---|---|---|---|---|
| jiaoren | 冻鲛人 | 群体扑击、掷矛 | lungeWindup / lunge / jab*；矛（程序化） | EN2a |
| xingxing（SK_Enemy_SnowXingxing） | 雪狌狌 | 群体近战、攀爬 | swipe* / throw* / climbPrep / climb / rally；冰块 | EN2a |
| xuangui | 冰甲旋龟 | 坦克、旋壳 | biteWindup / bite | EN2b |
| frost_crab | 玄冰巨蟹 | 坦克、钳夺 | sweepWindup / sweep / shellBreak | EN2b |
| qingniao | 三青鸟 | 飞行远程、栖落 | screech / swoop* / toPerch / perched / takeoff；没有 GlowShell；只弹了 1/3 根尾羽 | EN2c |
| ice_puffer | 冰河豚 | 飞行自爆、冻雾 | inflate；没有 GlowShell | EN2c |
| haozhi | 冰棘豪彘 | 冲锋自爆、刺阵 | bristle；没有 GlowShell | EN2d |
| fuzhu | 夫诸 | 精准远程、冻带 | 齐 | EN2d |
| ice_whale | 冰鲸 | 炮兵、冰柱雨 | 齐（需要大体型代理类型） | EN2d |
| fox_witch（+ fox_ice_wall 冰壁） | 九尾狐巫 | 支援：霜甲、冰壁、镜光 | enter / armorWindup / foxfireWindup / scream；只弹了 1/9 条尾巴；冰壁没有美术 | EN2e |
| lantern_jelly | 冰灯水母 | 支援：治疗连线、雷环 | stagger | EN2e |

第三章（美术都在；玩法全缺）：

| id | 名称 | 定位 | 缺的片段 / 美术 | 单元 |
|---|---|---|---|---|
| tantong（+ tantong_ember / tantong_reborn） | 炭童 | 群体，余烬会复燃 | pounce* / flail / blow；余烬堆、炭块（程序化） | EN3a |
| huodou | 祸斗 | 群体，吃火后变强 | eat / spit* / bark；没有 GlowShell | EN3a |
| iron_ox | 熔炉铁牛 | 坦克，炉门是弱点 | choke；渣墙（程序化） | EN3b |
| tuo | 火鼍 | 熔岩潜游坦克 | swim / surge / lunge / sweep* / roar / regrow；岩甲分区要烘焙 | EN3b |
| bifang | 毕方 | 栖落狙击 | fall / downed | EN3c |
| mamian | 马面狱卒 | 钩链拖拽 | drag / staggered / punch；链和钩（程序化） | EN3c |
| firecracker | 炮仗傀儡 | 炮兵，本身是炸弹 | toppled / getup；箱盖（程序化） | EN3d |
| fire_crow | 神火飞鸦 | 飞行神风 | dive；翼网格要转 90° | EN3d |
| founder | 熔铜匠 | 支援：铜衣护甲 | pourWindup / pouring / crackStagger | EN3e |
| nuo | 变脸傩巫 | 支援：三面光环 | dance / cover；面具分区要烘焙 | EN3e |

不移植（D9 / D27）：

| id | 名称 | 原因 |
|---|---|---|
| grunt · archer · brute · bomber · wisp · shaman · mortar · marksman | 沙匪刀客 · 骨弩手 · 铁甲盾卫 · 爆骸虫 · 幽灵飞灯 · 巫祝 · 重炮兵 · 狙击手 | ➖ 只在 LD-03 / classic 出现；13 骨白模，没有 AC_ |
| camel_stele | 驼碑力士 | ➖ Three.js 已退役 |
| marmot · tiangou · aoyin（含雷牦）· jufu · manman · liangu · dijiang · qiongqi | 第四章雷魅 | ➖ 对齐后再做；模型在，没有 AC_ |

### 3.9 首领

| 首领 | 状态 | 内容要点 | 美术 | 单元 |
|---|---|---|---|---|
| 旱魃（1-4） | ❌ | 日晒与荫蔽（射线判定 + 真实阴影）；烈日 / 焦土 / 赤地千里三阶段；日轮扫射、旱风、沙魇、焦裂、飞天之殇、日蚀露出泉珠（×3） | 只有设计稿提示词 | BS1 / BS2 / ART1 / ART2 |
| 鲲鹏（2-4） | ❌ | 鲲：吞吸、猛砸 + 冰浪、潜袭、吐冰；转换 4.6 s；鹏：扇翼狂风、俯冲掠台撞柱眩晕、羽刃雨、落台歇翼。4000 生命 + 1200 护盾，阈值 50% | 模型和片段都在，片段没有事件 | BS3 |
| 火麒麟（3-4，含锁扣、巨鼎） | ✅ | 玄鳞：踏火奔驰、张鳞、麟火、饮熔（85 / 70%）+ 打锁扣砸鼎；焚身：踏云俯冲、吐息、熔流轮转、火云雨、15% 狂怒。5000 生命 + 1500 护甲，阈值 55%。Unity（BS5，2026-10-24）：焚身是飞行形态（踏云 4.5 m，代码积分），熔流是运行时 LavaVolume + NavMeshObstacle 挖导航，15% 排上狂怒长啸；定档按整场（含换形演出与焚身折算）10500 + 2400 | 两种形态都在；吊鼎和锁扣缺（程序件）；焚身缺踏云奔跑、俯冲、起飞、空中吐息 / 长啸动作（代码驱动：Locomotion 奔跑步态 + tuck / stomp / breath / rear 代替） | BS4 / BS5 |
| 熔心魔将（3-3 领主） | ❌ | 烈焰冲锋、扇形横扫、陨石雨、跃击、焰刃连斩；熔岩涌动改成熔铜渠涨落 | 部件骨架，没有片段 | BS6 / ART8 |
| 沙暴巨像 | ➖ | 由旱魃取代；招式作为 `BossHazards` 的参考实现 | — | B1 |
| 霜翼妖后 + 寒霜冰晶 | ➖ | 由鲲鹏取代 | — | — |
| 夔 / 飞廉 / 化蛇 / 大鹗 | ➖ | 第四章 | — | — |

| 首领框架项 | 状态 | Unity 做法 | 单元 |
|---|---|---|---|
| BossBase 等价物：抽招、阶段、霸体、多段命中、形态切换、召唤、死亡演出 | ❌ | `BossBrain : EnemyAI` + `BossMove` + `BossDef`；出手时刻来自动画事件 | B0 |
| 危险物：冲击环、持续区 / 环带、抛物线落石、地刺、光束、预警撤回 | 🟡 | `BossHazards` + `WarnScope` | B1 |
| 首领血条 | ❌ | 刻度来自 BossDef | U3 |
| 首领关流程：补给营、门槛触发、登场、溃散、结算、拴绳 | ❌ | `BossEncounter` + `SafeZone` | B2 |
| 首领登场演出：电影运镜 → 连续落回第一人称开打（接管输入 / HUD / 武器、黑边、名字卡、镜头表、按住交互键跳过、交接零误差、打断复原） | 🟡 | `Bosses/Intro/`：`BossIntroDirector` + 各首领的 `<Id>Intro.cs` 镜头表（代码驱动，不用 Timeline），设计与四段镜头表见 [boss-intros.md](level-design/boss-intros.md)；冒烟 `boss-intro`、EditMode `BossIntroTests`。编辑器里的验收待做 | BS-intro |
| 首领规则（isBoss 分支） | ❌ | `Damageable.rank` + `IStunPolicy` | W0-1 / C2 |
| 场地锚点 | ❌ | `BossArena` | B0 |
| 测试与 soak | ❌ | 每个招式放一次、强制越阈值、90 s soak、击杀用时 | B0 + 各 BS 单元 |

### 3.10 关卡与世界

12 张图：

| 关 | 名称 | Three.js 来源（只取教学点） | 母题 / 机制 | 状态 | 单元 |
|---|---|---|---|---|---|
| 1-1 | 古道穿越戈壁 | desert-1-v2 | 开阔、沙暴 | 🟡 白盒已验收 | M11 |
| 1-2 | 雅丹迷城 | desert-2-v2 | 收紧、屋顶层、流沙 | ❌ | M12 |
| 1-3 | 沉沙古城 | desert-3-v2 + desert-4-v2 | 城市半埋、补给营 | ❌ | M13 |
| 1-4 | 鸣沙山月牙泉 | desert-5-v2（只取流程） | 露天首领场、沙山环抱、月牙泉、南岸楼阁 | ❌ | M14 |
| 2-1 | 冰瀑栈道 | frost-2-v2 | 垂直之字、冰面、断桥 | ❌ | M21 |
| 2-2 | 昆仑天阙 · 开明九门 | frost-1-v2 + frost-4-v2 | 阶梯山坡、三门择路 | ❌ | M22 |
| 2-3 | 瑶池冰湖 | frost-3-v2 | 冰湖、B / C 任意顺序后开 D | ❌ | M23 |
| 2-4 | 北冥冰台 | frost-5-v2 | 首领场、冰窟 | ❌ | M24 |
| 3-1 | 熔湖堤道 | inferno-1-v2 | 熔岩湖、多条堤道 | ❌ | M31 |
| 3-2 | 铸神井 | inferno-2-v2 | 火山陷坑、螺旋岩台、升降台 | ❌ | M32 |
| 3-3 | 铸范大坊 · 鼓风正殿 | inferno-3-v2 + inferno-4-v2 | 熔铜渠、回访大殿、魔将 | ❌ | M33 |
| 3-4 | 祝融炉心 | inferno-5-v2 | 首领场、吊鼎、熔流 | ❌ | M34 |

开放化改写（D25 每张图写进 maps/<id>.md）：
- 1-2 的「风口峡 12 m 走廊」改成 2–3 条平行的干河道，脊与脊之间有缺口。
- 2-1 的栈道段扩成 20–40 m 宽的阶地，每场战斗至少有两条接近路线。
- 3-x 的围墙 / 走廊布局改成火山口、岛和堤道。

| 系统 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 遭遇框架 | 🟡 | 不分站位角色；没有多波次、视线触发、精英升格 | `EncounterSpec` + `SpawnAnchor{role, lane, elevated}` | L | L2 |
| 目标图 | 🟡 | 必须严格按顺序 | `LevelObjective`：必清 / 可选 / N 选 M / 终点 | M | L2 |
| 支路藏宝 / 隐秘入口 | ❌ | — | `CachePOI` + 可破坏的门 | M | L2 / L6 |
| 首领前补给营 | ❌ | — | `SupplyCamp` + `SafeZone` | S | B2 |
| 出口传送门 | 🟡 | 死胡同，没有升起动画和下一关卡片 | 读 RunPlan；做升起动画；清关宝箱 | S | L2 |
| 软边界 | ❌ | 现在是空气墙 | 有符号距离推回 + 白化 | M | L3 |
| 天气与风 | ❌ | 只有一个静态风向 | `WeatherDirector` + 各种 Profile | M | L3 |
| 沙暴 | ❌ | — | 天气 Profile + 感知修正 | S | L3 |
| 熔岩 | ❌ | — | `LavaField` + NavMesh 区域 + LavaSwimmer 代理 | L | L7 |
| 冰面 / 流沙 / 水面 | ❌ | — | `SurfaceZone` / `Quicksand` / `WaterVolume` | M | L8 |
| 场景件：可破坏、开关、移动平台、断桥 | ✅ | —（L6：`Destructible` 按伤害类型（怎么打的 + 元素）吃伤害、血空就碎，掉落 / 爆炸可选，碎片 FX `PropShatter`，完整时挖导航、碎了撤；`SceneActivator` 射一下或按 F 触发，按钮 / 拨杆 / 一次性，`IActivatable` 事件驱动其他件；`MovingPlatform` 折线路线（往返 / 循环 / 站上去开 / 等信号），载人核心 `PlatformCarrier` 对角色控制器安全（全是扫掠 Move、排在 PlayerMotor 之前，下面有人就停、乘客顶头就停、横推挡路的玩家），3-2 升降台同用；`BreakableSpan` 踩塌 / 打断 / 信号断，塌了的段挖掉导航；TestArena 东北角各放一件，`playtest scene-pieces`） | 通用组件 | M | L6 |
| 地貌库 / 地表 / 散布 / 远景 | 🟡 | 只有沙漠；远景是四块平板 | 雅丹、峡谷、火山口等地貌；多块地形；远景环 | L | L4 |
| 天空、光照、雾 | 🟡 | 只有 Showcase 主题 | ChapterTheme 数据化 | S | L4 / F4 |
| 关卡数据与验收 | 🟡 | 只针对 1-1 | `ILevelCheck` 规则集 + 性能预算 | M | L5 |
| 构建器注册、bridge 命令 | ❌ | 写死了 `level11` | `[LevelBuilder]` | S | W0-7 |
| 防卡死 / 安全落脚点 | 🟡 | 只处理落单敌人 | `SafeGround` + 坠落回收 | S | H1 |
| 行旅图 / 罗盘 | ❌ | — | 罗盘条 + 全图（D：不做常驻小地图） | M | U7 |
| 奖励类型与清关结算 | 🟡 | 缺 upgrade、保底、清关宝箱 | `RewardRegistry` | S | R1 |
| 整关分支（精英 / 宝藏 / 商店关） | ➖ | Three.js 主线本来就不走 | 用遭遇变体表达 | — | — |
| 溜索 / 晃桥 / 宠物飞渡 | ➖ | 第四章 | 2-1 的断桥用 BreakableSpan | — | — |

### 3.11 经济、商店、局外

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 灵石钱包 | 🟡 | 钱存在 UI 上 | 移进 RunState | S | W0-5 |
| 击杀掉落 | 🟡 | 缺章节系数、首领包、魂晶 | `EconomyConfig` | S | R1 |
| 掉落物 | 🟡 | 没有对象池、没有 240 上限、清场后不吸附 | 池化 + 溢出直接入账 | S | R1 |
| 宝箱 | 🟡 | 只有写死的奖励串；模型是方块拼的 | 分档 + 提示行 + 保底 | M | R1 / ART7 |
| 秘卷三选一队列 | 🟡 | 没有 min；全满时丢弃 | 全满转灵石 | S | R1 / S0 |
| 随机掷骰 | ❌ | — | `WeaponRoller` / `ScrollRoll` | M | W2 / S0 |
| 经济属性（灵石获取 / 幸运） | 🟡 | 缺键 | W0-1 | S | W0-1 |
| 商店（7 个摊位，×(1+0.25ch)） | ❌ | — | `Shop` + `IShopOffer` | L | R3 |
| 强化台 | 🟡 | 只有数据 | 并进商店；可选任一槽位 | M | R3 |
| 首领补给与奖励 | ❌ | — | `BossEncounter` | M | B2 |
| 阵亡流程 | 🟡 | 只显示文字 + R | 慢动作 → 倒地镜头 → 结算 | S | F3 / U5 |
| 胜利流程 | ❌ | — | 最终首领后进胜利结算 | S | BS5 / U5 |
| 结算界面 | 🟡 | 一行文字 | 计数滚动 + 秘卷 / 武器 chips | M | U5 |
| 存档 / 魂晶 | ❌ | — | `SaveService` / `MetaSave` | M | R2 |
| 生涯统计 | ❌ | — | `CareerStats` | S | R2 |
| 主菜单、操作说明 | ❌ | — | 3D 远景主菜单 | M | U5 |
| 调试作弊 | ❌ | — | `DevCommands` | M | W0-5 |
| 经济数值表 | ✅ | —（I3：`EconomyConfig` 公式；`playtest economy` 扫 12 关场景投影每章收入、商店、魂晶、逐关难度，见 [balance.md](balance.md)） | `EconomyConfig` + 投影表 | S | R1 / I3 |

天赋（全部 ❌，每项 5 级，费用 60 / 120 / 200 / 300 / 450 魂晶，单元 R2）：

| id | 名称 | 每级 |
|---|---|---|
| vitality | 生命强化 | 生命上限 +8 |
| barrier | 护盾强化 | 护盾上限 +6 |
| mastery | 武器精通 | 武器伤害 +4% |
| lethal | 致命 | 暴击率 +2% |
| swift | 迅捷 | 移速 +0.15 |
| reload | 装填 | 换弹速度 +5% |
| affinity | 元素亲和 | 元素触发率 +3% |
| haste | 技能急速 | 技能急速 +5% |
| wealth | 财富 | 灵石获取 +8% |
| fortune | 幸运 | 幸运 +1 |

### 3.12 UI

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 框架（层级、路由、自适应、按钮音） | 🟡 | 每个界面自己做命中测试，没有 EventSystem | UI Toolkit + `UIRouter`；自适应 = 四层面板按参考分辨率 1920×1080 缩放、Expand（逻辑尺寸不小于 1920×1080，16:9 各档排版一致），theme.uss 根上默认 `white-space: nowrap`、成段说明单独写 normal；会换行的标签是 `FitLabel`（按内容量宽时补字距 × 字数 + 2px：引擎测宽不计字距、非整数倍缩放取整偏窄，短句会被挤断）；面板头 / 页签 / 脚不收缩，长列表只压滚动区；`playtest ui-res` 五档分辨率（1280×720 / 1366×768 / 1600×900 / 1920×1080 / 2560×1440）按实际渲染行数查断行 / 行高不够 / 溢出 / 重叠并截图 | L | U1 |
| 主题与字体 | 🟡 | 系统字体（P0），没有 SDF | theme.uss + 打包字体 | M | U1 |
| 图标 | ❌ | — | 9 个 SVG 转 VectorImage；缩略图自动渲染 | S | U1 |
| 文案 / 本地化 | 🟡 | 字符串内联在代码里 | StatInfo + 定义数据；以后接字符串表 | S | W0-1 / U1 |
| 手柄与按键提示 | ❌ | — | `GameInput` + InputGlyphs | M | W0-6 / U1 |
| 生命 / 护盾条 | 🟡 | 没有护盾拖尾和碎裂，没有徽记 | Widget | S | U2 |
| 武器槽 | 🟡 | 见 3.3 | Widget | M | U2 |
| Q/E 技能环、冲刺格 | 🟡 | 方块；格数写死 3 | Painter2D 圆环 | S | U2 |
| 武器技能图标（V） | ❌ | — | 复用技能环模板 | S | WC6 |
| 信息角 | 🟡 | 没有图标、增减飘字、魂晶 | Widget | S | U2 |
| 动态准星 | 🟡 | 缺瞄敌变红、换弹环、蓄力环、狙击镜、近战括号 | Widget | M | U2 / WC1 |
| 受击方向、闪屏、低血量 | 🟡 | 只有一根箭头；闪屏颜色固定 | 6 路弧追踪来源；蓝 / 红闪 | S | U2 |
| 伤害数字 | 🟡 | 见 3.2 | 池化 Label + 数字字体 | M | U3 |
| 敌人头顶血条 | ❌ | — | 屏幕空间对象池 | M | U3 |
| 首领血条 | ❌ | — | BossDef 刻度 | S | U3 |
| Tab 面板 | ❌ | — | 秘卷 / 属性 / 武器 / 灵宠 | M | U4 |
| Toast / 横幅 / 黑幕 | 🟡 | 只有单行、没有颜色、用缩放时间（暂停就停） | 队列合并 ×N；用不缩放时间 | S | U1 |
| 交互提示卡 | 🟡 | 只有一行富文本 | `InteractPrompt` 结构体 | M | W0-5 / U2 |
| 反应首遇教学 | ❌ | — | `ReactionTips` | S | U3 |
| 主菜单 / 操作说明 / 天赋 / 结算 | ❌ | — | Screens | M | U5 |
| 选英雄 + 3D 祭台 + 出场演出 | ❌ | — | 独立 Stage + Timeline | L | U6 |
| 暂停 / 设置 | 🟡 | 只有画质 | 自动生成设置控件 | M | U4 |
| 秘卷三选一 | 🟡 | 见 3.5 | Screen | S | S7 |
| 罗盘 / 全图 | ❌ | — | 罗盘条 + M 键全图 | M | U7 |
| 灵宠面板（Unity 独有） | ✅ | 跟着 UI 技术迁移 | Widget | S | U2 |
| UI 测试钩子与截图 | 🟡 | 截图只拍到相机，拍不到 UI Toolkit | 按 id 的测试 API + 截图合成 | S | U1 |

### 3.13 手感、特效、音频、品质

| 项 | 状态 | 缺口 | Unity 做法 | 量 | 单元 |
|---|---|---|---|---|---|
| 特效门面与对象池 | 🟡 | 一个 `ShotFx` 单例，size 只放大粒子数 | `Fx` + `FxPreset` 注册 | L | F1 |
| 弹着点 / 命中溅射 / 破层 | ✅ | —（按地表石 / 沙 / 冰 / 金属四套预设 + 弹孔贴花 SF_FxDecal；盾 / 甲 / 血肉三种命中变体） | 预设 + 贴花 | M | FX1 |
| 爆炸 | ✅ | — | 闪光球、火球、烟、碎石、焦痕、灯、震屏 | M | FX1 |
| 曳光 / 光束 / 闪电 | ✅ | — | 池化 + HDR | S | F1 / FX1 |
| 预警圈 / 冲击环 | 🟡 | 平面 Quad 在坡上穿地，不能取消 | Decal 着色器（D21） | M | F2 |
| 出生法阵 / 死亡迸散 | ✅ | — | 预设 + 溶解 | M | FX2 |
| 枪口火焰 | ✅ | —（`Fx.MuzzleFlash(socket, …)`：第一人称星芒 + 火舌挂在 W3 的挂点下，没有挂点退回常数枪口；同帧请求合并） | 挂到 muzzle socket | S | W4 / FX1 |
| 反应 / 状态视觉 | ✅ | — | 熔池贴花着色器 + 身体着色 | M | FX2 |
| 光源池 | 🟡 | 全局只有 1 盏 | 6–8 盏 | S | F1 |
| 着色器预热 | ❌ | 打包可能丢变体 | ShaderVariantCollection | S | F1 |
| 镜头 rig（晃动、倾斜、弹簧、受击冲击） | ❌ | — | `CameraFeel`（唯一写入方） | M | F3 |
| FOV 层 | 🟡 | 写死 70°，WeaponController 每帧覆盖 | 设置 80° + 开镜 / 冲刺 / 速度 | S | F3 |
| 震屏 | 🟡 | 全项目只有镇墓兽调用 | trauma 模型 + 全来源接入 + 设置缩放 | S | F3 |
| 阵亡镜头 / 顿帧 | ❌ | — | 倒地 + `HitStop` | S | F3 |
| 后坐 | ✅ | 完全回正，比 Three.js 好 | — | — | — |
| 音效核心 / 命中音 / 配乐 | ✅ | 75 个 id、201 个 ogg、4 首曲子 | — | — | — |
| 音效覆盖 | ✅ | —（清单 75 个 id 都有调用点；按钮音由 UISound 挂在每层根上、走 UI 总线） | 跟着各单元接 | S | F5 + 各单元 |
| 压低 / 混音 / 限幅 | ✅ | —（`Resources/Audio/Spiritfire.mixer`，bridge.sh audio 生成：Master 限幅 → World（快照：暂停 / 模态 0.45 + 6 kHz 低通、结算 0.8）→ SFX / Music / Ambience / Reverb，UI 直挂 Master；玩家音量 = 暴露参数；跳伤 / 雷弧同时 ≤ 3 声、叠声衰减） | AudioMixer + 快照 | M | F5 |
| 空间音频 / 环境音（超越） | ✅ | —（I6：三章声床、ReverbSend 按章节 / 封闭关 / AmbienceZone、遮挡低通、关键枪声 / 爆炸分层） | 遮挡低通、混响区、环境声床 | M | I6 |
| 画质档 | ✅ | —（`QualityProfile` 三档：渲染比例 + FSR 1.0、MSAA、阴影距离 / 级联 / 分辨率 / 软硬、附加光投影、SSAO、闪光灯数、粒子预算、毛发、lodBias、mip、地形细节；「高」= 工程原值；三档都用 PC 级，运行时改资产、编辑器退出 Play 还原。STP 不用：URP 的 TAA / STP 不支持叠加相机） | `QualityProfile` | M | F4 |
| 后处理 | ✅ | —（关卡 VP 已修好；`GameplayVolumes`：低血量去饱和、受击色差、冲刺色差 + 暗角、慢动作，乘设置「屏幕特效」；低档 Bloom 降到 1/4） | 修复 + 玩法屏效 Volume | M | W0-8 / F4 |
| LOD / 剔除 | 🟡 | GPU Resident Drawer 没开 | 开启 + 遮挡烘焙 | M | I4 |
| 运行时分配 | 🟡 | 每次都 new GameObject / MPB | 池化 | S | F1 / C4 |
| 性能叠层 | 🟡 | 只打印一行 fps | `PerfOverlay` | S | L5 |
| 美术运行时接入 | ✅ | Unity 更好 | — | — | — |

### 3.14 美术资产（详见第 6 节）

| 项 | 状态 | 说明 |
|---|---|---|
| 英雄 3 + 手臂 6 + 鳞球 | ✅ | 片段只有 Idle / Show |
| 灵宠 8 | ✅ | `Art/Pets` 下有重复导入（W0-9） |
| 枪 17 | 🟡 | 缺零件语义；瞄具、弩弦、弩箭没导出 |
| 碎刃 | ❌ | 程序化，管线导不了 |
| 第一章敌人 6 | ✅ | — |
| 第二章敌人 11 | ✅ | 缺约 25 段片段；4 个没有 GlowShell |
| 第三章敌人 10 | ✅ | 缺招牌状态的片段 |
| 旱魃 | 🟡 | ART1 / ART2 已完成：本体 + 日轮已进 Unity；10 段关键帧动作 + 事件表已并进 AC_SK_Boss_Hanba（[boss-hanba.md](art/boss-hanba.md)）；缺裂缝自发光，人形关键帧丢了非人形骨曲线（E5） |
| 鲲鹏 / 火麒麟 | 🟡 | 片段没有事件；吊鼎和锁扣缺 |
| 熔心魔将 | 🟡 | 没有片段 |
| 第一章套件 / 地标 | ✅ | 1-1 剩几件白盒；1-2 / 1-3 / 1-4 的专用件缺 |
| 第二章套件（昆仑 + 北冥） | ✅ | 冰瀑栈道套件缺；FrostTao 没导出 |
| 第三章套件 | 🟡 | 缺熔岩材质和地图专用件 |
| 地形层 | 🟡 | 只生成了沙漠；Frost 有调色板没生成；Inferno 没有 |
| 宝箱 / 商店 / 商人 / 祭台 | ❌ | 现在是程序方块 |
| 特效贴图 | ❌ | — |
| UI 字体 / 图标 | ❌ | — |
| 音频 | ✅ | — |

### 3.15 Unity 独有与超越项

| 项 | 状态 | 处理 |
|---|---|---|
| 灵宠系统（8 只、灵契、觉醒） | ✅ | 保留；跨关持久化（L1） |
| 布娃娃死亡、方向性受击弹簧、出生前预警 | ✅ | 保留 |
| 后坐完全回正、陡坡下滑 | ✅ | 保留 |
| 顿帧、冰面惯性、流沙、沙暴、手柄 | ❌ | F3 / L8 / L3 / W0-6 |
| 中途续玩、图鉴 | ✅ | I5：`RunSuspend` 续玩档；`Codex`（存档 codex 段）+ `CodexTracker` + `CodexScreen`（模型缩略图 / 剪影），见 7.6 |
| 环境音、分层枪声、首领主题曲 | ✅ | I6 |
| 自动翻越 | ➖ 不做 | I7 评估（feel.md） |

---

## 4. 架构与扩展点

### 4.1 并行工作规则

1. 第 0 批在主工作区按顺序做完并推送。之后的单元各开一个 worktree，从 master 最新提交开出（worktree 不包含主工作区未提交的改动）。
2. worktree 里只写文本文件：`.cs` / `.uss` / `.uxml` / `.json` / `.md` / `.py` / `.mjs`。**不要在 worktree 里生成** `.asset` / `.prefab` / `.unity` / `.mat`。
3. 需要编辑器的部分（生成资产、建场景、导美术、Play 模式测试），到主工作区通过 `bash scripts/unity/bridge.sh <命令>` 排队执行。编辑器同一时刻只跑一条命令。
4. 合入流程：
   1. worktree 内 `python scripts/unity/csc_check.py` 通过。
   2. rebase 到 master。
   3. 主工作区执行 `bridge.sh refresh`。
   4. 把编辑器为本单元新文件生成的 `.meta` 一起提交。
   5. 跑本单元的验收命令。
   6. 推送。
5. 一个文件在同一批次里只有一个拥有者（见 4.12）。非拥有者要改共享文件时，只改小块，用 `git add -p` 提交，并在单元说明里写明。

### 4.2 目录约定

```
G/Core/        RunState RunPlan RunRng GameState TimeScaleArbiter GameEvents Defs ModifierList StatInfo
               GameSettings DevCommands SystemsBootstrap SceneFlow PlayerFactory LevelBootstrap SaveService EconomyConfig
G/Combat/      Combat Damage DamageCalc Damageable Hitbox · Reactions/<Id>Handler · Status/<Id> · Projectiles/
G/Weapons/     WeaponController WeaponDefs WeaponInstance · FireModes/ · Defs/Weapon_<Id> · Handling/Handling_<Id>
               Affixes/{Numeric,Trigger}/<Id> · Legendaries/<Id> · DemonBlade/
G/Skills/      HeroSkills TimedSkill SkillFx · Heroes/Hero_<Id> · <Hero>Skills
G/Enemies/     EnemyAI EnemyRoster EnemyDef EnemyRegistry · Defs/<Desert|Frost|Inferno>/Enemy_<Id>
               AI/<Frost|Inferno>/<Id>AI · Hazards/ · Affixes/
G/Bosses/      BossBrain BossMove BossDef BossArena BossHazards · Hanba/ KunPeng/ Qilin/ Warlord/
G/World/       BoundaryZone WeatherDirector LavaField SurfaceZone Quicksand WaterVolume Destructible MovingPlatform SupplyCamp SafeZone
G/Encounters/  EncounterSite EncounterSpec SpawnAnchor LevelObjective ExitPortal CachePOI BossEncounter
G/Loot/        LootDirector Pickup Chest · Rewards/<Kind>Reward · Shop/<Kind>Offer
G/Progression/ Scrolls ScrollScope ScrollKit ScrollRoll · Scrolls/<Group>/ · Meta/{MetaSave,CareerStats,Talents/}
G/UI/          GameUI · Toolkit/ · Widgets/<Name> · Screens/<Name>Screen
G/Fx/          Fx FxPreset FxLightPool · Presets/<Id>
G/Testing/     PlaytestRunner IPlaytestSuite · Suites/<Name>Suite · Bot/
A/Game/Tests/  Spiritfire.Game.Tests.asmdef（EditMode）
P/Runtime/     PlayerMotor MotorModifiers GameInput FirstPersonViewmodel CreatureRig …
P/Editor/Levels/ Level_<c>_<n> LevelKit.<Part> LevelValidator LevelChecks/ Level_TestArena
S/bake/<ID>.mjs  每个资产一份采样场景；<ID>.events.json 是动画事件叠加表
```

程序集保持现状：Game、Art.Runtime、Art.Editor 三个，另加一个 Tests。`csc_check.py` 按目录 glob 收源文件，所以不要在 `G/` 下再建 asmdef。

### 4.3 内容注册（代码优先，W0-3 / W0-4）

```csharp
// G/Core/Defs.cs
public interface IDef { string Id { get; } }
[AttributeUsage(AttributeTargets.Class)]
public sealed class DefsAttribute : UnityEngine.Scripting.PreserveAttribute { }
public interface IDefSource<T> where T : class, IDef { IEnumerable<T> Create(); }

public static class Registry<T> where T : class, IDef
{
    public static T Get(string id);              // 没有则返回 null
    public static IReadOnlyList<T> All { get; }
    public static bool TryGet(string id, out T def);
}
```

- **加载**：第一次访问时扫描 Spiritfire.Game 程序集里所有带 `[Defs]` 的类。是 T 的非抽象子类就 new 一个；实现了 `IDefSource<T>` 就调用 `Create()`。id 重复直接报错。`SubsystemRegistration` 时清空，关掉 Domain Reload 也安全。
- **IL2CPP**：`A/Game/link.xml` 保留整个 Spiritfire.Game 程序集；`[Defs]` 继承 `PreserveAttribute`，双保险。
- **兼容门面**：`WeaponLibrary.Get/All`、`EnemyRoster.Get/Spawn`、`ScrollLibrary.Get/Roll` 改成读注册表，外部调用不用改。

| 内容 | 定义类型 | 一条内容 = 一个文件 |
|---|---|---|
| 武器 | `WeaponDef`（补齐 TS 全部字段 + `spreadScale`） | `Weapons/Defs/Weapon_<Id>.cs`（`IDefSource<WeaponDef>`） |
| 敌人 | `EnemyDef`（`Type ai`、rank、placementRole、flying、groundOnly、charger、coins、essence、color、affixExclusions） | `Enemies/Defs/<Ch>/Enemy_<Id>.cs` + `Enemies/AI/<Ch>/<Id>AI.cs` |
| 秘卷 | `abstract ScrollDef`（rarity 0–4、maxStacks、tags、heroOnly、描述模板、`virtual Install(ScrollScope s, int n)`） | `Progression/Scrolls/<Group>/<Id>.cs` 或组文件 |
| 词条 / 传说 | `AffixDef` + `IAffixEffect`（OnFire / OnHit / OnKill / OnReaction / Modifier） | `Weapons/Affixes/…`、`Weapons/Legendaries/…` |
| 英雄 | `HeroDef`（数值、手臂 Prefab、初始武器、技能工厂、`IHeroPassive`、主题色、定位 / 难度 / 标签 / 要诀） | `Skills/Heroes/Hero_<Id>.cs` |
| 首领 | `BossDef`（阈值、形态列表、命中体、奖励、代理 Prefab） | `Bosses/<Id>/<Id>Def.cs` |
| 天赋 | `TalentDef` | `Progression/Meta/Talents/<Id>.cs` |
| 奖励 | `IRewardHandler`（Key、Grant、Hint、Color） | `Loot/Rewards/<Kind>Reward.cs` |
| 商店摊位 | `IShopOffer` | `Loot/Shop/<Kind>Offer.cs` |
| 状态 / 反应 | `IStatusEffect` / `IReactionHandler` | `Combat/Status/…`、`Combat/Reactions/…` |
| 特效 | `FxPreset`（编辑器据此生成 Prefab） | `Fx/Presets/<Id>.cs` |
| 系统组件 | `[GameSystem] MonoBehaviour` | 自动挂到 Game Systems（替代改 PlayerRigBuilder） |
| 冒烟套件 | `IPlaytestSuite` | `Testing/Suites/<Name>Suite.cs` |
| 调试命令 | `DevCommand` | 各单元自己的文件 |
| 关卡 | `[LevelBuilder("1-2", scene)]`（编辑器程序集，TypeCache 发现） | `P/Editor/Levels/Level_1_2.cs` |

### 4.4 战斗契约（W0-1）

```csharp
[Flags] public enum DamageTag { None = 0, Weapon = 1 << 0, Melee = 1 << 1, Skill = 1 << 2, Explosion = 1 << 3, Chain = 1 << 4,
  Dot = 1 << 5, Purge = 1 << 6, Collapse = 1 << 7, Reaction = 1 << 8, Thunderfire = 1 << 9, Meltdown = 1 << 10,
  Veinseal = 1 << 11, Abyss = 1 << 12, Echo = 1 << 13, Nirvana = 1 << 14, Kalpa = 1 << 15, Proc = 1 << 16, Pet = 1 << 17 }

public struct DamageInfo  { /* 现有字段 */ public DamageTag tags; public int weaponUid; public bool noCrit, bypassShield;
                            public Reaction? reactionId; public string procId; }
public struct DamageResult{ /* 现有字段 */ public Element statusApplied; public Reaction? reaction;
                            public bool shieldBroken, armorBroken; public DamageLayer firstLayer; public float effective; }
public enum Rank { Normal, Elite, Boss }              // Damageable.rank

public sealed class ModifierList<T> where T : Delegate // 快照迭代、异常隔离、结果夹到 ≥ 0 且有限
{ public IDisposable Add(T fn, int priority = 0); }
public delegate float Outgoing(in HitContext c);       // c.target / c.info / c.crit / c.weak
public static ModifierList<Outgoing> Combat.Outgoing;  // 在暴击掷骰「之后」求值
public static ModifierList<Incoming> PlayerVitals.Incoming; // priority：Multiplier = 0，FinalAmount = 100（可以返回 0 免死）
public static ModifierList<Incoming> Damageable.Incoming;   // 敌人身上：列表，替代单个 Func

Combat.Execute(Damageable d, bool purge);
Combat.Explode(in ExplosionOptions o);  // falloff、排除集合、noFx、playerDamage、knockback 按衰减；NonAlloc；嵌套深度 ≤ 6
DamageCalc.StatMultiplier(in DamageInfo i, Damageable t);  // 按标签：武器爆炸同时吃伤害% 和爆炸伤害%
DamageCalc.DotStatMultiplier / StatusPowerFromDealt / ReactionPowerFromStatus
```

- **Stat 枚举**一次补齐，只往末尾追加：HpRegen、Lifesteal、JumpVelocity、ExtraJumps、AmmoReservePct、SpreadPct、RecoilPct、ProjectileSpeedPct、BossDamagePct、EliteDamagePct、ShieldDamagePct、ArmorDamagePct、ElementDamagePct、FireDamagePct、ShockDamagePct、CorrodeDamagePct、SecondaryCharges、CoinGainPct、Luck。
- `StatInfo` 表：中文名、显示格式、lowerIsBetter。
- `Mult` 下限 0.05；`BeginBatch` / `EndBatch`；`Version` 计数。
- 这一步之后 `Damage.cs` 和 `Stats.cs` **冻结**。以后再加字段，要单独开一个小单元，并通知所有正在进行的单元 rebase。

### 4.5 事件总线（W0-2）

```csharp
public static class GameEvents   // 静态 C# 事件 + struct 载荷；SubsystemRegistration 时清空
{
  // 战斗
  EnemySpawned(EnemyAI) · EnemyDamaged(in HitEvent) · EnemyKilled(in KillEvent) · StatusApplied(Damageable, StatusId, int)
  EnemyShieldBroken(Damageable) · EnemyArmorBroken(Damageable)
  Reacted(in ReactionEvent{ enemy, id, point, B, depth, origin(Status|Detonate|Forced), tag, weaponUid, centerKilled, stunned })
  // 玩家
  PlayerHit(in PlayerHit{ amount, toShield, toHp, element, source, from })   // 在死亡判定之前发
  PlayerHealed(float actual) · PlayerShieldBroken · PlayerDied · PlayerDashed(Vector3) · PlayerJumped(bool air) · PlayerLanded(float fall)
  // 武器 / 技能 / 秘卷
  WeaponFired · ReloadStarted · Reloaded · WeaponSwitched(prev, next) · WeaponAcquired · WeaponSkillUsed   // 都带 WeaponInstance
  SkillUsed(SkillSlot, string id) · ScrollAcquired(ScrollDef, int) · ScrollProc(string id)
  // 局 / 关卡
  RunStarted · StageLoaded(StageSpec) · StageCleared · RunEnded(RunSummary) · EncounterStarted · EncounterCleared(EncounterSite)
  CoinsChanged(int delta, int total) · EssenceChanged · Pickup(kind, amount) · StateChanged(GameState)
  BossSpawned · BossPhase · BossForm · BossDefeated(BossBrain)
}
```

- 旧事件（`Combat.EnemyDamaged`、`EnemyKilled`、`PlayerDamaged`、`ReactionSystem.Reacted`、`EncounterSite.AnySiteCleared`）保留为转发，第 4 批删除。
- PlayerMotor 在 Art.Runtime 程序集里，它的事件由 PlayerVitals 转发进 GameEvents。
- `ReactionSystem.Detonate(Damageable, DetonateOpts)` 和 `Trigger(Damageable, Reaction, TriggerOpts)` 的签名在 W0-2 定下；C1 落地之前只打一次警告，然后返回 null。

### 4.6 局状态与场景（W0-5 定契约，L1 落地）

```csharp
[Serializable] public sealed class RunState
{
    public static RunState Current;           // 开局时创建；直接打开关卡场景时，由 LevelBootstrap 建一个 dev 局
    public string heroId; public int seed, chapter, stage; public float difficulty, time, damageDealt;
    public int coins, essence, kills, stagesCleared;
    public Dictionary<string, int> flags, scrolls; public List<WeaponSave> weapons; public PetSave pet; public float hp, shield;
    public void Credit(int amount, string source);  public bool TrySpend(int price);   // 都会发 GameEvents.CoinsChanged
}
public interface IRunPersistent { void Capture(RunState s); void Restore(RunState s); }
public sealed class StageSpec { string code, title, chapterName, scene, music; StageKind kind; float difficulty; string clearReward; }
public static class RunPlan { IReadOnlyList<StageSpec> Stages; StageSpec First; StageSpec Next(StageSpec s); bool IsFinal(StageSpec s); }
```

- **场景**：`A/Scenes/Core.unity` 常驻（玩家、HUD、各系统、音频）。关卡用 `LoadSceneAsync(Additive)` 加载，然后 `SetActiveScene`，让光照、雾和光照探针跟着关卡走。所有临时生成物都挂在关卡场景根下，卸载关卡就一起清掉。
- **关卡场景里的标记**：PlayerSpawn、SpawnAnchor、ExitPortal、SupplyCamp、CachePOI、PerchPoint、BossArena。
- **PlayerFactory** 按 HeroDef 在运行时组装玩家。第一人称 rig 由 `WeaponRigFactory` 按「英雄 × 武器」懒加载。
- `Hud.coins`、`GameSession.Completed`、`PauseMenu.Pick` 这些测试在用的 API 保留为转发，PlaytestRunner 不用改。

### 4.7 时间、输入、设置（W0-5 / W0-6）

- `GameState { Boot, Menu, Playing, Paused, Modal, Transition, Summary }` + `GameEvents.StateChanged`。模态是栈（Push / Pop）。
- `TimeScaleArbiter.Request(object owner, float scale, int priority) → IDisposable`。优先级：Pause > Modal > Transition > DeathSlowMo > HitStop。**全项目只有它能写 `Time.timeScale`。**
- `GameInput`（`P/Runtime`，Spiritfire.Art 命名空间）：
  - 在代码里定义 Gameplay / UI 两套动作表，支持键鼠和手柄。
  - 动作：Move、Look、Jump、Dash、Fire、Aim、Reload、Interact、SkillQ、SkillE、WeaponSkill、Weapon1、Weapon2、Swap、Pause、Inventory、PetSkill、Map。
  - 查询接口 `Down` / `Pressed` / `Released(Action)`；改键结果存 JSON。
  - 现有的 TestMode 布尔先保留。
- `GameSettings`：每个条目带 key、类型、默认值、范围、分组、显示名，变化时发 `Changed`。消费方自己订阅：PlayerMotor（灵敏度、反转 Y）、CameraFeel（FOV、震屏强度）、GameAudio（音量）、DamageNumbers（开关）、QualityProfile。

### 4.8 UI 门面（W0-5 先转发，U1 换后端）

```csharp
public static class GameUI
{
    Toast(string text, Color? color = null, float seconds = 2.8f);  Banner(string title, string sub = null, float seconds = 2.6f);
    FloatText(Vector3 world, string text, Color c, float scale = 1.3f);  SetPrompt(InteractPrompt? p);  SetObjective(string text);
    SetBoss(BossBrain b);  ScreenFlash(Color c, float seconds);  Awaitable Fade(float to, float seconds);
}
public struct InteractPrompt { string title, subtitle; string[] lines; Color color; int cost; bool canAfford; string action; }
// IInteractable 用默认接口成员包住旧的 string Prompt；[HudWidget] 组件自注册；UIRouter.Open(id) / Close / Back；IScreen
```

W0-5 把约 30 处 `Hud.Instance.*` 调用机械替换成 `GameUI.*`，先转发到现在的 Hud。U1 再把后端换成 UI Toolkit，调用方不用动。

### 4.9 关卡构建（W0-7）

- 构建器注册：`[LevelBuilder("1-2", "Assets/Scenes/L1_2_Yardang.unity")]`。命令 `bridge.sh level <id>` / `bridge.sh levels`。构建设置里的场景顺序按 RunPlan 生成。
- `LevelKit.cs` 拆成 partial，每个 partial 归一个单元：

| partial | 单元 |
|---|---|
| `LevelKit.Terrain.cs`、`LevelKit.Backdrop.cs`、`LevelKit.Scatter.cs` | L4 |
| `LevelKit.Boundary.cs` | L3 |
| `LevelKit.Validate.cs` | L5 |
| `LevelKit.Lava.cs` | L7 |
| `LevelKit.Props.cs` | 共用，只追加 |

- 每张图的布局数据写在它自己的 `Level_<c>_<n>.cs` 里，代码本身就是 LevelSpec。手工微调存在覆盖层里，重新生成时不会被冲掉。
- **TestArena**（W0-8）：平地、坡道、2.5 / 4 / 6 m 台、栖落柱、熔岩 / 冰 / 水的占位条带、刷怪台。敌人、武器、首领单元都先在这里验收，不必等地图。

### 4.10 测试（W0-7）

- EditMode 测试程序集 `A/Game/Tests/Spiritfire.Game.Tests.asmdef`；`csc_check.py` 加上这个程序集。新增命令 `bridge.sh tests [过滤]`。
- PlaytestRunner 改成 `IPlaytestSuite` 注册表：现有的 1-1 冒烟测试搬进 `Testing/Suites/Slice11Suite.cs`。命令 `bridge.sh playtest <suite> [scene]`。新单元只加自己的 Suite 文件。

### 4.11 占位策略（代码不等美术）

- **敌人**：`EnemyRoster.Spawn` 找不到 Prefab 时生成 `PlaceholderBody`——一个按 EnemyDef 尺寸做的胶囊，带弱点球和元素色发光，AI 照常运行。动画状态缺片段时，CreatureRig 播 Idle，并只打一次警告。
- **关卡件**：`LevelKit.PlaceOrBox(prefabId, size)` 找不到 Prefab 时放白盒，并打上 `Placeholder` 标签；验收报告会列出所有占位件。
- **特效**：FxPreset 先用程序贴图（软圆、条纹、噪声烟）。
- **首领**：BossDef 可以指定代理 Prefab，例如旱魃先用 `SK_Enemy_Apsara` 放大 3.5 倍，加一个白盒日轮。
- **美术 ID**：先在 registry 登记，Prefab 名固定。换正式资产只需要重导，不改代码。

### 4.12 共享热点归属

| 文件 | 第 0 批 | 第 1 批拥有者 | 之后 |
|---|---|---|---|
| `G/Combat/Combat.cs` | W0-1 | C2 | 只追加 |
| `G/Combat/Damage.cs`、`G/Core/Stats.cs` | W0-1 | 冻结 | 冻结 |
| `G/Combat/ReactionSystem.cs` | W0-2 | C1 | — |
| `G/Combat/EnemyStatus.cs` | W0-2 | C2 | — |
| `G/Player/PlayerVitals.cs` | W0-2 | C3 | — |
| `G/Skills/HeroSkills.cs` | W0-2 / W0-3 | H2 | — |
| `G/Weapons/WeaponController.cs` | W0-6 | W1 | — |
| `G/Weapons/WeaponDefs.cs`、`WeaponInstance.cs` | W0-3 | W2 | — |
| `G/Enemies/EnemyRoster.cs`、`EnemyAI.cs` | W0-4 | E1 | — |
| `G/Enemies/EnemyBody.cs`、`Combat/Hitbox.cs` | — | E2 | — |
| `G/Progression/Scrolls.cs`、`ScrollScope.cs` | W0-4 | S0 | — |
| `G/Loot/LootDirector.cs` | W0-4 | R1 | — |
| `G/Core/GameSession.cs` | W0-5 | L1 | — |
| `G/UI/Hud.cs`、`GameUI.cs` | W0-5 | U2 / U1 | Hud 退役 |
| `P/Runtime/PlayerMotor.cs` | W0-6 | H1 | — |
| `P/Runtime/FirstPersonViewmodel.cs` | — | W4 | — |
| `P/Editor/Levels/PlayerRigBuilder.cs` | W0-3 | L1 | 退役 |
| `P/Editor/Levels/LevelKit.*.cs` | W0-7 | 按 partial 分 | — |
| `P/Editor/PipelineBridge.cs`、`S/bridge.sh`、`G/Testing/PlaytestRunner.cs` | W0-7 | 冻结（命令和套件走注册） | — |
| `P/Editor/ArtPrefabBuilder.cs`、`ArtSidecar.cs` | — | W3 | — |
| `P/Editor/NativeClipBuilder.cs`、`CreatureRigBuilder.cs` | — | E5 | — |
| `A/Art/Shaders/SF_StylizedLit.shader` | — | — | FX2（FX4 追加） |
| `unity/Packages/manifest.json` | W0-7 | 冻结 | — |
| `art/pipeline/registry.toml` | W0-9 拆成 `registry.d/*.toml` | 每个美术单元一个文件 | — |
| `ProjectSettings/EditorBuildSettings.asset` | — | 只由 `levels` 命令按 RunPlan 重写 | — |

---

## 5. 工作单元与批次

「编辑器」一列：**是** = 必须在主工作区用编辑器生成资产 / 场景，或在编辑器里调手感；**否** = 在 worktree 里写代码，验收通过 bridge 队列跑。
量：S / M / L（XL 已拆）。∥ = 依赖只有第 0 批，可以立刻并行开工。

```
第 0 批（顺序，主工作区）  W0-1 → W0-2 → W0-3 → W0-4 → W0-5 → W0-6 → W0-8
                           W0-7、W0-9 与上面并行
第 1 批（核心系统）        战斗 C · 特效 F · 武器 W · 英雄 H · 敌人 E · 关卡 L · 首领 B · 局 R · 秘卷 S0 · UI U1–U3 · 美术 ART
第 2 批（内容）            武器 WC · 词条 AF · 秘卷 S1–S7 · 英雄 HC · 敌人 EN · 特效 FX · 商店 R3 · 面板 U4 · 旱魃动作 ART2
第 3 批（地图与首领）      M11–M34 · BS1–BS6 · U5–U7
第 4 批（整合与打磨）      I1–I7
```

### 第 0 批：脚手架（顺序执行）

| 单元 | 内容（做完 = …） | 拥有文件 | 依赖 | 编辑器 | 量 |
|---|---|---|---|---|---|
| W0-1 战斗与属性契约 | 按 4.4 落地：Stat 补 19 键、StatInfo、Mult 下限、Batch；DamageTag / weaponUid / noCrit / bypassShield / reactionId；DamageResult 新字段；Damageable 的 rank 和 Incoming 列表；Outgoing 改到暴击之后求值；按标签算乘区；Explode 用 Options + NonAlloc + 嵌套深度保护；Execute。**现有行为不变**，1-1 冒烟测试全绿 | `G/Core/{Stats,StatInfo,ModifierList}.cs` `G/Combat/{Damage,DamageCalc,Combat,Damageable}.cs` | — | 否 | M |
| W0-2 事件总线与钩子 | 按 4.5 落地 GameEvents；PlayerVitals：Incoming 两段、PlayerHit 先于死亡判定、Heal 返回实际量、invulnerableUntil；EnemyStatus：StatusId / TryGet / Applied / 最近附着记录；ReactionEvent 和 Detonate / Trigger 签名；HeroSkills：SkillSlot / SkillUsed / ReduceCooldowns / SecondaryCharges；武器发换弹 / 切枪 / 获得事件 | `G/Core/GameEvents.cs` `G/Player/PlayerVitals.cs` `G/Combat/{EnemyStatus,ReactionSystem}.cs` `G/Skills/HeroSkills.cs` | W0-1 | 否 | M |
| W0-3 注册表：框架 / 武器 / 英雄 / 稀有度 | Registry + `[Defs]` + link.xml；WeaponDef 补全字段；6 把武器一把一个文件；WeaponInstance（uid、元素、词条、运行时状态）；Rarity 5 档；HeroDef + 燎迁出；PlayerRigBuilder 读注册表。1-1 重建后不变 | `G/Core/{Defs,Rarity}.cs` `A/Game/link.xml` `G/Weapons/{WeaponDefs,WeaponInstance}.cs` `G/Weapons/Defs/*` `G/Skills/Heroes/*` `P/Editor/Levels/PlayerRigBuilder.cs` `G/Loot/LootCatalog.cs` | W0-2 | 否 | M |
| W0-4 注册表：敌人 / 秘卷 / 奖励 / 自举 | EnemyDef + Spawn(float 难度, SpawnOptions) + 占位体；第一章 7 个定义迁出；ScrollDef 抽象类 + 最小 ScrollScope；现有 16 卷迁进两个组文件；RewardRegistry 取代 Grant 里的 switch；`[GameSystem]` 自举 | `G/Enemies/{EnemyRoster,EnemyDef,PlaceholderBody}.cs` `G/Enemies/Defs/Desert/*` `G/Progression/{Scrolls,ScrollScope}.cs` `G/Progression/Scrolls/{Offense,Utility}/*StatScrolls.cs` `G/Loot/LootDirector.cs` `G/Loot/Rewards/*` `G/Core/SystemsBootstrap.cs` | W0-3 | 否 | M |
| W0-5 局状态 / 时间仲裁 / UI 门面 | RunState + 钱包 + IRunPersistent；RunPlan 12 关表 + 难度；RunRng；GameState + 模态栈 + TimeScaleArbiter；失焦暂停；DevCommands（F1 无敌 / F2 清怪 / F3 秘卷 / F4 武器 / F6 灵石 / 跳关）；GameUI 转发 + 替换约 30 处调用；InteractPrompt | `G/Core/{RunState,RunPlan,RunRng,GameState,TimeScaleArbiter,DevCommands,GameSession,Interaction}.cs` `G/UI/GameUI.cs` | W0-4 | 否 | M |
| W0-6 输入与设置门面 | 所有直接读 Keyboard / Mouse 的地方改走 GameInput（键鼠 + 手柄、方向键、P、Tab、V / 中键）；GameSettings 持久化（灵敏度、反转 Y、FOV 80、音量、震屏、伤害数字），消费方订阅；TestMode 照常工作 | `P/Runtime/{GameInput,PlayerMotor}.cs` `G/Core/GameSettings.cs` `G/Weapons/WeaponController.cs` `G/Player/Interactor.cs` `G/Pets/PetOwner.cs` | W0-5 | 否 | M |
| W0-7 工程基础设施 | 加 Animation Rigging；Tests 程序集 + csc_check 支持；bridge 新增 `level <id>` / `levels` / `tests` / `playtest <suite>`；`[LevelBuilder]`；LevelKit 拆 partial；PlaytestRunner 拆成 Suite（行为不变） | `unity/Packages/manifest.json` `A/Game/Tests/*.asmdef` `S/csc_check.py` `S/bridge.sh` `P/Editor/{PipelineBridge,Playtest}.cs` `P/Editor/Levels/{LevelBuilderAttribute,LevelKit*}.cs` `G/Testing/{PlaytestRunner,IPlaytestSuite}.cs` `G/Testing/Suites/Slice11Suite.cs` | — | 是 | M |
| W0-8 画面基线 / 测试场 / 契约测试 | 修 VolumeProfile 子资产 → 重建 1-1 和 3 个展示场景 → 重开工程确认 Bloom 和色调映射生效；建 TestArena；EditMode 测试：伤害乘区与 TS 一致、注册表数量和 id 唯一、反应调参一致 | `P/Editor/ShowcaseSceneBuilder.cs` `P/Editor/Levels/Level_TestArena.cs` `A/Scenes/TestArena.unity` `A/Game/Tests/{DamageCalcParity,Registry,ReactionTuning}Tests.cs` | W0-1…W0-7 | 是 | M |
| W0-9 美术登记表拆分与退役 | registry 拆成 `registry.d/*.toml`，加 status 字段（active / retired / alternative / derived）；`unity_export --all` 跳过 retired；驼碑力士和 `Art/Pets` 下的第一版副本退役（先确认没有引用）；拆分前后资产数一致 | `art/pipeline/registry.toml`→`registry.d/` `art/pipeline/lib/config.py` `art/pipeline/unity_export.py` | — | 否 | S |

### 第 1 批：核心系统

| 单元 | 内容（做完 = …） | 拥有文件 | 依赖 | 编辑器 | 量 |
|---|---|---|---|---|---|
| C1 反应接口 ∥ | Detonate：0.5 s ICD、同帧合并；三相 → 归墟，两相 → 按优先级，单相 → 崩解（灼烧 / 蚀化剩余的 30%、雷殛 50%，上限 30×S）。Trigger：ignoreIcd / fixedBase / scale / tag。reactionScale。首领封脉 → 脉滞 ×1.12。预算：大特效 3 个 / 帧、浮字 4 个 / 帧。池化 + NonAlloc。每种反应一个处理器文件；CombatTuning；调试计数叠层 | `G/Combat/ReactionSystem.cs` `G/Combat/Reactions/*` `G/Combat/CombatTuning.cs` `G/Testing/CombatDebugOverlay.cs` | W0-2 W0-8 | 否 | M |
| C2 管线收尾 / 状态注册 / 首领规则 ∥ | IStatusEffect 注册（敌人和玩家共用）；DoT 吃元素 / 精英 / 首领乘区（先除回再乘回）；按 tick 对齐的剩余 DoT；首领眩晕规则、stunImmune；吸血；静默处决；KillResolver（魂晶、精英 ×5、首领 60）；免疫节流；不可选中守卫 | `G/Combat/{Combat,EnemyStatus,KillResolver}.cs` `G/Combat/Status/*` | W0-2 | 否 | M |
| C3 玩家受击与减益 ∥ | BlastPlayer（胶囊表面距离、两点视线、冲量、无敌帧跳过）；PlayerStatus：寒意（取最强、上限 70%）、日晒灼烧叠层、点燃；HpRegen；破盾时震屏 | `G/Player/{PlayerVitals,PlayerStatus}.cs` | W0-2 | 否 | S |
| C4 投射物系统 ∥ | 对象池；穿透；投射物爆头；追踪 0.1 s 后启动、0.25 s 重选目标；载体到期也触发；反弹能量 0.55 / 0.78；外观注册（grenade / orb / rocket / arrow / flame / lantern / bolt / feather / quill / spear / chunk）；EnemyProjectileSpec（追踪、回调、可挡）；冲刺无敌时子弹穿过；ProjectileWard | `G/Combat/PlayerProjectile.cs` `G/Combat/Projectiles/*` `G/Enemies/EnemyProjectile.cs` | W0-4 | 否 | M |
| F1 特效门面与对象池 ∥ | `Fx.Burst / Ring / EnemyHit / Explosion / Impact / Beam / Lightning`（返回可取消句柄）；预设由编辑器生成 Prefab 和 .mat；程序贴图集；光源池；按画质的密度系数；ShaderVariantCollection 预热；ShotFx 保留为兼容层；Lightning / SlashArc 池化 | `G/Fx/{Fx,FxPreset,FxLightPool,ShotFx,Lightning,SlashArc,FxMaterials}.cs` `G/Fx/Presets/*` `P/Editor/FxBuilder.cs` `A/Game/Resources/Fx/**` `A/Art/Fx/**` | W0-7 | 是 | L |
| F2 预警贴花 ∥ | 加 DecalRendererFeature；SF_Telegraph 着色器（由内向外填充、紧迫脉动 10 → 32 Hz、收尾闪、取消淡出）；形状 Circle / Annulus / Sector / Line / Spokes / Polygon，句柄 + WarnScope；贴合坡面 | `G/Fx/Telegraph.cs` `A/Art/Shaders/SF_Telegraph.shader` `A/Settings/*_Renderer.asset` | W0-7 | 是 | M |
| F3 镜头 rig / 震屏 / 顿帧 ∥ | CameraFeel 唯一写入渲染姿态和 FOV：晃动、侧倾、落地弹簧 K140 / C17、受击冲击、Punch、6 轴 trauma × 设置、FOV 层（80° + 开镜 + 冲刺 / 高速，合计 ≤ 8°）、阵亡倒地；运行时插入 Head 节点，瞄准仍用 motor.eye；HitStop 走仲裁器，有频率上限 | `G/Player/CameraFeel.cs` `G/Fx/CameraShake.cs` `G/Core/HitStop.cs`（改 WeaponController 小块） | W0-5 W0-6 | 否 | M |
| F4 画质档 / 后处理 / 屏效 | QualityProfile（渲染比例、STP、阴影、粒子密度、灯数、毛发、lodBias、mip、后处理）；分辨率 / 全屏 / 垂直同步 / 帧率上限；GameplayVolumes（低血量、受击、冲刺、慢动作）；GPU Resident Drawer | `G/Core/{GraphicsQuality,QualityProfile}.cs` `G/Fx/GameplayVolumes.cs` `P/Runtime/ArtQuality.cs` `A/Settings/*_RPAsset.asset` | W0-8 | 是 | M |
| F5 混音 / 压低 / 音效覆盖 ∥ | AudioMixer（限幅、SFX / Music / UI / Ambience / Reverb）+ 快照；暂停 0.45、结算 0.8；音量读设置；UI 按钮音；跳伤 / 雷弧音节流 | `G/Audio/{GameAudio,MusicDirector,AudioDuck}.cs` `A/Game/Resources/Audio/Spiritfire.mixer` | W0-5 W0-6 | 是 | M |
| W1 武器控制器拆分 ∥ | 状态机 + IFireMode：Semi / Auto / Burst / Beam / Spinup / Charge / Volley；每把枪 readyAt、开火缓冲 0.14 s、补发 ≤ 4、切枪先收后出、齐射切枪打完；逐发换弹后上膛 0.3 s；无限弹药计数、应急补给、换关补 35%；射线穿透；IWeaponTakeover；IWeaponHudSource。6 把的秒伤回归不变 | `G/Weapons/WeaponController.cs` `G/Weapons/FireModes/*` `G/Weapons/{IFireMode,Ballistics,IWeaponTakeover,IWeaponHudSource}.cs` | W0-6 | 否 | L |
| W2 数值 / 元素 / 掷骰 / 强化 ∥ | WeaponStatsResolver（带缓存）；章节稀有度表 + 幸运；随机元素 + MPB 着色；Roll(章, min, id?)；UpgradeCost；奖励串 weapon / weapon:min=N / upgrade；worldScale；EditMode 对表测试 | `G/Weapons/{WeaponStatsResolver,WeaponRoller,WeaponInstance,WeaponDefs}.cs` `G/Loot/Rewards/{Weapon,Upgrade}Reward.cs` | W0-4 | 否 | M |
| W3 零件语义与挂点（导出管线） | 按 WeaponModels 的分组名把 j_N 映射成语义零件，写 sockets（muzzle / sight / leftGrip / load / finish / eject）；赤蛟霰铳拆出枪管关节；瞄具 / 弩弦 / 弩箭补成程序网格；17 把重导（不改网格） | `art/pipeline/unity_export.py` `P/Editor/{ArtSidecar,ArtPrefabBuilder}.cs` `A/Art/Weapons/*/*.art.json` `A/Art/Prefabs/Weapons/*` | W0-7 W0-9 | 是 | M |
| W4 第一人称手感与换弹 IK | 弹簧阻尼晃动、侧倾、滞后、落地、冲刺 / 滞空姿态、开火颤动、空仓抖动；枪口火焰挂 socket；WeaponPartAnimator；HandlingProfile + TwoBoneIK，加弹由动画事件触发；WeaponRigFactory 运行时建 rig；GripSheet 握持审查 | `P/Runtime/FirstPersonViewmodel.cs` `G/Weapons/{WeaponPartAnimator,HandlingProfile,WeaponRigFactory}.cs` `P/Editor/GripSheet.cs` | W1 W3 L1 | 是 | L |
| H1 移动手感与运动 API ∥ | 地面 / 空中加速与阻力分开，超速衰减；ExtraJumps 映射 + 二段跳转向；冲刺锁定、跳打断冲刺；梯形积分；IMotorModifier 栈；Launch / CancelDash / Teleport / GrantInvulnerability / Lunge；SafeGround 坠落回收；移动特效；1-1 过沟与可达性重跑通过 | `P/Runtime/{PlayerMotor,MotorModifiers}.cs` `G/Player/{SafeGround,MovementFx}.cs` | W0-6 | 否 | M |
| H2 技能框架与 SkillFx | Configure(HeroDef)；TimedSkill 撤销栈；拒绝反馈；HandOrigin 防穿墙；SkillFx.Shockwave / GroundCrack / ThrowVelocity / SafeHandOrigin；燎补齐投掷继承速度、半径吃属性、走 EnemyRegistry 选目标 | `G/Skills/{HeroSkills,TimedSkill,SkillFx,IHeroPassive,LiaoSkills}.cs` `G/Skills/Heroes/Hero_Liao.cs` | W0-3 F1 F2 | 否 | M |
| E1 敌人基类与注册表 ∥ | CancelAttack 统一；玩家死后待机；EnemyRegistry（NonAlloc、最近 N 个带视线）；glow[3]；坠落回收；AttackTokens 按章节上限 / 续期 / Reset；EnemyBuffs 多通道，邪飞天迁过去；浮点难度；PurgeAll | `G/Enemies/{EnemyAI,EnemyRegistry,AttackTokens,EnemyBuffs,ApsaraAI,EnemyRoster,EnemyDef}.cs` | W0-4 W0-5 | 否 | M |
| E2 多段命中区 ∥ | HitZone（倍率、弱点、启停、朝向门、半径缩放）+ ZoneDamaged；存活时启用布娃娃胶囊做命中盒；SetWeakPoint；Hitbox.blocksSight；着色通道合成 | `G/Enemies/{EnemyBody,HitZone}.cs` `G/Combat/Hitbox.cs` `P/Runtime/CreatureRagdoll.cs` | W0-4 | 否 | M |
| E3 飞行 / 栖落 / 寻视线 | FlyingEnemyAI（不用 agent、地形相对高度、SphereCast 避障、起落、空中出生）；PerchPoint + 兜底搜索 + 认领；Sight.Seek | `G/Enemies/{FlyingEnemyAI,PerchPoint,Sight}.cs` | E1 | 否 | M |
| E4 敌方危险物库 | Blast（击退 + 震屏）；HazardZone；GroundWave（从镇墓兽里抽出来）；SpikeField（只挡移动的层 + carve）；FloorFire + FireFeed；ExplosiveChain；FireZone 变兼容包装 | `G/Enemies/Hazards/*` `G/Fx/FireZone.cs`（改 TombBeastAI 小块） | E1 F2 | 否 | M |
| E5 动作管线 ∥ | 采样配置拆成每个资产一个 `S/bake/<ID>.mjs`（可强制进入状态，可放熔岩 / 火 / 栖柱 / 友军桩）；`<ID>.events.json` 写成 Mecanim 事件；手工关键帧 FBX 自动并进 AC_；分叉弹簧链（狐巫 9 尾、青鸟 3 羽） | `S/bake-native-anims.mjs` `S/bake/` `P/Editor/{NativeClipBuilder,CreatureRigBuilder}.cs` | W0-7 | 是 | M |
| L1 常驻场景 / 运行时玩家 / 流转 | 按 4.6：Core 场景 + 叠加 + 淡入淡出 + 异步 + 章节卡 + 预热；PlayerFactory；IRunPersistent 恢复；直接开 L1_1 也能玩；R 快速重开；1-1 只剩环境和标记 | `G/Core/{SceneFlow,PlayerFactory,LevelBootstrap,PlayerSpawn,GameSession}.cs` `P/Editor/Levels/{PlayerRigBuilder,CoreSceneBuilder}.cs` `A/Scenes/Core.unity` | W0-5 W0-6 W0-8 | 是 | L |
| L2 遭遇框架 v2 / 目标图 | 多波次；按角色选站位 + 到场延迟 + 高台；冲锋怪走远端；按进场深度 + 视线触发；出生净空按体型；预警结束复检；精英升格；小队词缀；波次提示；LevelObjective；CachePOI；SpiritAltar；ExitPortal 读 RunPlan、升起动画、清关宝箱 | `G/Encounters/{EncounterSite,EncounterSpec,SpawnAnchor,LevelObjective,ExitPortal,CachePOI,SpiritAltar}.cs` | E1 | 否 | L |
| L3 软边界 / 天气 / 风 | 有符号距离纹理；推回 (4 + 18×wind) m/s + 白化；兜底碰撞；NavMesh 回避区 + 拴绳；WeatherDirector（Volume、雾、主光、`_WindDir`、WindZone、粒子）；沙暴期间远程锁定 ≤ 25 m | `G/World/{BoundaryZone,WeatherDirector,WeatherProfiles}.cs` `P/Editor/Levels/LevelKit.Boundary.cs` | H1 F1 F4 | 是 | M |
| L4 地形库 / 地表 / 散布 / 远景 ∥ | 地貌：雅丹、城墙压沙、洞穴碗、V 形谷 + 阶地、平湖、阶梯坡 + 挡土墙、火山口 / 螺旋台、熔岩湖堤道；多块地形 + holes；按章节的 Splat；生成 Frost / Inferno 地形层；远景环 + 远山 + 地平线色等于雾色；散布规则 | `P/Editor/Levels/{HeightField,TerrainTextureGen,LevelKit.Terrain,LevelKit.Backdrop,LevelKit.Scatter}.cs` `A/Levels/Terrain/**` | W0-7 | 是 | L |
| L5 关卡验收与性能预算 ∥ | ILevelCheck：锚点有路、出生净空、交互净空、防越界、主线不靠二段跳、场地尺寸、掩体数、高差层数、地标视线、占位清单、面数 / 批次预算；俯视地图截图；PerfOverlay | `P/Editor/Levels/{LevelKit.Validate,LevelValidator}.cs` `P/Editor/Levels/LevelChecks/*` `G/Testing/PerfOverlay.cs` | W0-7 | 是 | M |
| L6 场景件 ∥ | Destructible、Activator（叫 SceneActivator：和 System.Activator 重名）、MovingPlatform（对 CharacterController 安全，载人核心 PlatformCarrier 与 3-2 升降台共用）、BreakableSpan；TestArena 里各放一件 | `G/World/{Destructible,SceneActivator,MovingPlatform,PlatformCarrier,BreakableSpan}.cs` `G/Fx/Presets/PropShatter.cs` `P/Editor/Levels/{LevelKit.Pieces,TestArenaPieces}.cs` | W0-2 | 否 | M |
| L7 熔岩 | 熔岩面着色器 + 火星；玩家扣 12% + 两跳、下沉后托回、1 s 无敌；敌人被打进熔岩烧死；NavMesh Lava 区域 + LavaSwimmer 代理；查询 API；涨退熔岩 | `G/World/LavaField.cs` `A/Art/Shaders/SF_Lava.shader` `P/Editor/Levels/LevelKit.Lava.cs` `unity/ProjectSettings/NavMeshAreas.asset` | H1 W0-8 | 是 | L |
| L8 冰面 / 流沙 / 水面 | 地表牵引 → 玩家和敌人都受影响；冰斑 / 冻带复用；流沙（拉力 + 预警 + 高代价）；风格化水面 + 涉水减速；半透明冰着色器 | `G/World/{SurfaceZone,Quicksand,WaterVolume}.cs` `A/Art/Shaders/{SF_Ice,SF_Water}.shader` | H1 | 是 | M |
| B0 首领框架 | 按 3.9；TestArena 里用代理首领跑 3 个假招式 + 1 次换形 | `G/Bosses/{BossBrain,BossMove,BossDef,BossArena,Summons}.cs` | E1 E2 | 否 | M |
| B1 首领危险物 | wave / zone / lob / erupt / blast / beam（扫掠判定）；WarnScope；Clear；巨像 / 妖后 / 魔将的招式作参考实现 | `G/Bosses/{BossHazards,WarnScope}.cs` | B0 F2 E4 | 否 | L |
| B2 首领关流程 / 补给营 | 门槛触发、可封门；登场预警 + 名字卡；溃散；结算（回满、保底武器宝箱、魂晶）；胜利链；拴绳；SafeZone | `G/Encounters/BossEncounter.cs` `G/World/{SafeZone,SupplyCamp}.cs` | B0 L2 L1 | 否 | M |
| R1 经济 / 掉落 / 宝箱 ∥ | 章节系数、首领包；掉落物池化、吸附、溢出入账；宝箱分档、提示行、保底、全满转灵石；EconomyConfig + 投影菜单 | `G/Loot/{LootDirector,Pickup,Chest}.cs` `G/Core/EconomyConfig.cs` `G/Loot/Rewards/{Scroll,Coins,Heal}Reward.cs` | W0-4 W0-5 | 否 | M |
| R2 存档 / 魂晶 / 天赋 / 生涯 ∥ | SaveService（原子写、.bak、迁移、ISaveSection、dev 档）；魂晶来源；10 项天赋作为 talent 来源；生涯统计；坏档测试 | `G/Core/SaveService.cs` `G/Progression/Meta/**` | W0-5 | 否 | M |
| S0 秘卷运行时 ∥ | ScrollScope 全功能；ScrollKit 助手（ProcScale = 1 + (d−1)×0.85 等）；叠层改成卸载重装 + 批处理；ScrollRoll 权重；数据校验；sandbox 窗口 | `G/Progression/{ScrollScope,ScrollTicker,ScrollKit,Scrolls,ScrollRoll}.cs` | W0-4 W0-5 | 否 | M |
| U1 UI Toolkit 基座 ∥ | PanelSettings 分层；theme.uss；3 套 OFL 字体（GB2312 一级 + 扫描全部中文字面量 + 动态回退）；图标；UIRouter + 焦点导航；按钮音；GameUI 后端（Toast 队列、横幅、黑幕）；截图能拍到 UI | `G/UI/Toolkit/*` `G/UI/GameUI.cs` `G/UI/Screens/UIRouter.cs` `A/Game/Resources/UI/**` | W0-5 W0-6 | 是 | L |
| U2 HUD 组件迁移 | 生命 / 护盾、武器槽、Q/E 环、冲刺格、信息角、准星（瞄敌变红 / 换弹环 / 蓄力环 / 近战括号）、命中曲线、受击弧、闪屏、低血量、提示卡、灵宠面板；Hud.cs 退役（保留转发） | `G/UI/Widgets/*`（除 U3 的）`G/UI/{Hud,SkillHud}.cs` `G/Pets/PetHud.cs` | U1 W1 H2 | 否 | L |
| U3 伤害数字 / 头顶血条 / 首领血条 / 反应教学 | 按 3.12 | `G/UI/Widgets/{DamageNumbers,EnemyBars,BossBar,ReactionTips}.cs` | U1 C1 C2 B0 | 否 | M |
| ART1 旱魃本体 + 日轮 ∥ | 定稿 DS → 四视图 → Tripo P2.0 → 语义人形 + 发 / 衣链绑骨 → 发布 → 导入；日轮挂 socket_sunring；泉珠发光分区 + socket_core；ArtValidator 通过，能在 TestArena 刷出 | `art/source/characters/SK_Boss_Hanba/**` `art/source/props/SM_BossPart_HanbaSunRing/**` `art/pipeline/registry.d/boss_hanba.toml` `A/Art/Characters/SK_Boss_Hanba/**` | W0-9 | 是 | L |
| ART3 第一章件 A ∥ | 1-1 收尾（驿站残墙、烽燧垛墙、积薪、长城转角、骆驼刺 / 砾石散布件、车辙贴花、敦煌题材远景地标）+ 1-2（半埋佛塔、狮身雅丹、岩拱、半埋屋顶 ×3、塔刹） | `art/source/props/SM_Tripo_Desert{PosthouseWall,BeaconParapet,BrushwoodPile,HanWallCorner,StupaBuried,YardangSphinx,RockArch,BuriedRoof*,Finial}/**` `registry.d/ch1_kit_a.toml` | W0-9 | 是 | M |
| ART4 第一章件 B ∥ | 1-3（二层店铺楼、井台、寺塔、回廊、香炉、碑）+ 1-4（月牙阁、穴顶裂缝岩体、龟裂泉床贴花） | `art/source/props/SM_Tripo_Desert{ShopHouse,Well,TemplePagoda,Cloister*,CrescentPavilion}/**` `SM_Env_DesertCaveCeilingRift` `SM_Prop_Desert{IncenseBurner,Stele}` `registry.d/ch1_kit_b.toml` | W0-9 | 是 | M |
| ART5 第二章件 ∥ | 冰瀑三段、冰桥、冰棱（+ 碎块）、栈道套件 ×5、崖壁片、白玉挡土墙、钟亭、湖心亭、冰窟边缘；导出 FrostTao 套件 | `art/source/props/SM_Tripo_Frost{Icefall*,IceBridge,Icicle,PlankRoad*,…}/**` `registry.d/ch2_kit.toml` | W0-9 | 是 | L |
| ART6 第三章件 ∥ | 玄武岩堤道 / 墩、螺旋岩台 / 岩肋、铸范 / 铸床、巨型风箱、悬炉 + 吊链、QilinCauldron（4 个链挂点）、QilinChainLock、熔铁闸门、圆殿外壳 | `art/source/props/SM_{Tripo_Inferno*,Prop_Qilin*}/**` `registry.d/ch3_kit.toml` | W0-9 | 是 | L |
| ART7 宝箱 / 商店 / 商人 / 祭台 ∥ | 宝箱 3 档（盖子枢轴）、铁砧、秘卷匣、药壶、弹药箱、商人（待机 / 说话）、选人祭台、霜山商摊 | `art/source/props/SM_Prop_{Chest,Anvil,ScrollCase,Potion,AmmoCrate,HeroAltar}/**` `art/source/characters/SK_Npc_Merchant/**` `registry.d/props_loot.toml` | W0-9 | 是 | M |
| ART8 熔心魔将动作 | 魔将加进采样 BOSSES → AC_ 里有冲锋、横扫、跃击、连斩、施法、受击、死亡 + 事件 | `S/bake/SK_Boss_Warlord.mjs` `A/Art/Characters/SK_Boss_Warlord/Anim/**` | E5 | 是 | M |

### 第 2 批：内容

| 单元 | 内容（做完 = …） | 拥有文件 | 依赖 | 编辑器 | 量 |
|---|---|---|---|---|---|
| WC1 步枪 / 点射 / 狙击 | 3 把武器 + 红点 / 管状瞄具 + 狙击镜遮罩（隐藏枪模、换弹退镜、开镜 0 散布） | `G/Weapons/Defs/Weapon_{Rifle,Burst,Sniper}.cs` `G/Weapons/Handling/Handling_{Rifle,Burst,Sniper}.cs` `G/UI/Widgets/ScopeOverlay.cs` | W1 W2 W4 U2 | 是 | M |
| WC2 机炮 / 蜂群 / 喷火 | 预热转管、−2 移速；5 枚追踪齐射；粒子火焰锥 + 每跳 OverlapCapsule（不再每秒生成 14 个物体） | `Weapon_{Minigun,Swarm,Flamer}.cs` `Handling_*` `G/Weapons/FlameCone.cs` | W1 W2 W4 C4 F1 | 是 | M |
| WC3 连弩 / 蛊灯 / 贯虹 | 弩弦拉伸 + 弩箭显隐 + 穿透 3；蛊灯追踪穿透 + 蛊种；蓄力 0.2 + 0.8t²，满蓄穿透 +3 并引爆、虹光 | `Weapon_{Crossbow,Lantern,Railgun}.cs` `Handling_*` `G/Weapons/CrossbowString.cs` | W1 W4 C1 C4 AF2 | 是 | M |
| WC4 霰铳 / 三才 + 原 6 把表现 | 折开换弹；元素轮转 + 枪身发光预告下一发；原 6 把补零件动画和装填动作（快装器、弹匣、泵、能量罐、弹鼓） | `Weapon_{Magmashot,Trinity,Smg,Revolver,Shotgun,Launcher,Beam,Stormpod}.cs` `Handling_*` | W2 W3 W4 | 是 | M |
| WC5 碎刃 · 碎片与刃群 ∥ | 移植 BladeShape（128 片，各向异性 1.55，Lloyd 7 轮）→ 编辑器烘焙 Mesh；刀柄贴图 + 鬼眼着色；RenderMeshInstanced；阵形：旋涡 / 圆盾 / 刃球 / 炸散 | `G/Weapons/DemonBlade/{BladeShape,BladeShards,BladeSwarmRenderer}.cs` `P/Editor/BladeMeshBaker.cs` `A/Art/Weapons/SK_Weapon_DemonBlade/**` | W0-7 | 是 | L |
| WC6 碎刃 · 控制器 | 三段斩、刃气、千刃出窍、屏障（挡弹）、杀气爆发、人刀合一、噬灵鬼眼；IWeaponTakeover；武器技能图标；移植 demon-blade.test.mjs | `G/Weapons/DemonBlade/{DemonBladeController,DemonBladeDef,BladeWard}.cs` `G/Weapons/Defs/Weapon_DemonBlade.cs` | W1 C2 C4 WC5 | 否 | L |
| WC7 碎刃 · 第一人称 | 三段斩剪辑（代码生成）+ 判定帧事件；剑指手势（Rigging）；碎片在手、伸刃、归位闪；刀光 | `G/Weapons/DemonBlade/BladeView.cs` `A/Art/Weapons/SK_Weapon_DemonBlade/Anim/**` | WC5 W4 | 是 | L |
| WC8 描述 / 对比 / 秒伤基准 | WeaponDescriber（等价 Describe.ts）；拾取时 ▲▼ 对比；WeaponDpsSuite 输出 CSV | `G/Weapons/WeaponDescriber.cs` `G/UI/Widgets/WeaponCard.cs` `G/Testing/Suites/WeaponDpsSuite.cs` | W2 AF1 U2 | 否 | M |
| AF1 词条框架 + 数值 15 | AffixDef、抽取（准入、重新过滤、perHit 归一）、文本 + 传说前缀；数值 15 条 | `G/Weapons/Affixes/{AffixDef,AffixRoll,AffixText}.cs` `G/Weapons/Affixes/Numeric/*` | W2 | 否 | M |
| AF2 触发 14 | IAffixEffect；排队到下一帧执行；同帧合并；见 3.4 | `G/Weapons/Affixes/Trigger/*` `G/Weapons/Affixes/AffixEffects.cs` | AF1 C1 C2 | 否 | L |
| AF3 传说 10 | WeaponRuntime 状态；开火类钩子；见 3.4 | `G/Weapons/Legendaries/*` `G/Weapons/WeaponRuntime.cs` | AF2 W1 | 否 | M |
| S1 攻击 24 | 见 3.5 | `G/Progression/Scrolls/Offense/*` | S0 C2 | 否 | M |
| S2 元素 10 | 同上 | `…/Scrolls/Element/*` | S0 C2 | 否 | M |
| S3 功能·技能与生存 | 同上（含 7 卷迁移） | `…/Scrolls/Utility/{UtilityStatScrolls,Skill,Survival}.cs` | S0 C3 H2 | 否 | M |
| S3b 功能·机动与经济 | 同上 | `…/Scrolls/Utility/{Mobility,Economy}.cs` | S0 H1 R1 | 否 | S |
| S4 传说 + 英雄专属 | 同上；高风险标签、红色负面行 | `…/Scrolls/Legend/*` | S0 C3 H2 R1 | 否 | M |
| S5a 反应·基础 12 | 同上 | `…/Scrolls/Reaction/Basic*.cs` | S0 C1 | 否 | M |
| S5b 反应·进阶 12 | 同上 | `…/Scrolls/Reaction/Advanced*.cs` | S0 C1 B0 | 否 | M |
| S6 战术 20 | 同上 + TacticsKit + 移植 scroll-tactics.test.mjs | `…/Scrolls/Tactics/*` `A/Game/Tests/ScrollTacticsTests.cs` | S0 W1 H1 C1 | 否 | M |
| S7 秘卷界面 | 三选一（挂轴展开、点阵、新得 / 升层、下一层预览、手柄、传说金框）；带色获得提示；触发弹字 | `G/UI/Screens/ScrollChoiceScreen.cs` `G/UI/Widgets/ScrollProcPop.cs` `G/UI/ScrollChoice.cs` | U1 S0 | 否 | M |
| HC1 鼯 | 90 / 70 / 额外跳 1、赤铜左轮；凌空 + 滑翔；雷鼓信标；雷目 · 裁决；信标道具先占位 | `G/Skills/Heroes/Hero_Falcon.cs` `G/Skills/{FalconSkills,Glide}.cs` | H1 H2 W1 F1 | 是 | M |
| HC2 磐 | 140 / 80 / 7.0 / 减伤 10%、碎岩霰弹；厚皮；裂地重击；磐石壁垒；敌人击飞上抛 | `G/Skills/Heroes/Hero_Bear.cs` `G/Skills/BearSkills.cs` | H1 H2 C3 E1 | 是 | M |
| HC3 燎打磨 + 出手动作 ✅ | 爆竹、余火、引信、火灵造型；技能出手的覆盖姿态时间线（三位英雄共用） | `G/Skills/CastPose.cs` | H2 W4 F1 | 是 | S |
| EN1 第一章对齐 + 沙魇 | 按 3.8；EnemyVariant 材质变体 | `G/Enemies/{JerboaBlade,ScorpionArcher,MirageToad,FireRat,TombBeast,Apsara}AI.cs` `G/Enemies/EnemyVariant.cs` `G/Enemies/Defs/Desert/*` | E1 E3 E4 C4 F1 | 是 | M |
| EN2a 冻鲛人 + 雪狌狌 | AI + PackCoordinator + 攀爬用的 NavMeshLink + 补采样 | `G/Enemies/{Defs,AI}/Frost/{Jiaoren,Xingxing}*` `G/Enemies/PackCoordinator.cs` `S/bake/SK_Enemy_{Jiaoren,SnowXingxing}.mjs` | E1 E4 C3 C4 E5 | 是 | M |
| EN2b 旋龟 + 巨蟹 | 正面格挡、旋壳反弹、过热翻身、钳夺、横扫、断钳 | `…/Frost/{XuanGui,FrostCrab}*` `S/bake/SK_Enemy_{XuanGui,FrostCrab}.mjs` | E2 E4 L8 E5 | 是 | M |
| EN2c 三青鸟 + 冰河豚 | 飞行、栖落、俯冲；鼓胀自爆、冻雾 | `…/Frost/{Qingniao,IcePuffer}*` `S/bake/SK_Enemy_{Qingniao,IcePuffer}.mjs` | E3 E4 C4 E5 | 是 | M |
| EN2d 豪彘 + 夫诸 + 冰鲸 | 冲锋刺爆 + 刺阵；冰光冻带 + 后跳；冰柱雨 + 刺阵 + 鳍拍（大体型代理类型） | `…/Frost/{Haozhi,Fuzhu,IceWhale}*` `S/bake/SK_Enemy_Haozhi.mjs` | E2 E4 C4 L8 E5 | 是 | L |
| EN2e 狐巫 + 冰壁 + 水母 | 霜甲（走 EnemyBuffs）、冰壁（Destructible + 挡视线）、镜光、狐火、碎镜；治疗连线（Rigging）、雷环 | `…/Frost/{FoxWitch,FoxIceWall,LanternJelly}*` `S/bake/SK_Enemy_{FoxWitch,LanternJelly}.mjs` | E1 E2 C3 C4 L6 E5 | 是 | L |
| EN3a 炭童 + 祸斗 | 余烬堆、踩灭、复燃；吃火、喷火、群体分工 | `G/Enemies/{Defs,AI}/Inferno/{Tantong,Huodou}*` `S/bake/SK_Enemy_{Tantong,Huodou}.mjs` | E1 E2 E4 L7 E5 | 是 | M |
| EN3b 铁牛 + 火鼍 | 炉门（×0.2 / ×3）、吸气、渣墙、挑飞；熔岩潜游、上岸扑咬、岩甲分区再生 | `…/Inferno/{IronOx,Tuo}*` `S/bake/SK_Enemy_{IronOx,Tuo}.mjs` | E2 E4 L7 H1 E5 FX4 | 是 | L |
| EN3c 毕方 + 马面 | 栖落、毕—方两声、火矛、断腿坠落；钩链拖拽（Tether）、射断链、缴械后肉搏 | `…/Inferno/{Bifang,Mamian}*` `S/bake/SK_Enemy_{Bifang,Mamian}.mjs` | E2 E3 C3 H1 L7 E5 | 是 | L |
| EN3d 炮仗傀儡 + 神火飞鸦 | 一窝蜂齐射、哑火、地老鼠、死亡连环爆；鸦群盘旋、点燃俯冲、空爆连锁 | `…/Inferno/{Firecracker,FireCrow}*` `S/bake/SK_Enemy_{Firecracker,FireCrow}.mjs` | E2 E3 E4 E5 | 是 | M |
| EN3e 熔铜匠 + 傩巫 | 浇铜衣（先 ×2 后 ×0.5）、坩埚裂；三面光环（FaceDef）、换脸、碎面、扫火 | `…/Inferno/{Founder,Nuo}*` `S/bake/SK_Enemy_{Founder,Nuo}.mjs` | E1 E2 E4 E5 FX4 | 是 | M |
| EN4 精英词缀与外观 | 词缀注册 + 迅捷 / 坚盾 / 爆裂 / 狂暴 + 金环 + 名字前缀 + 排除表 | `G/Enemies/Affixes/*` `G/Enemies/EliteAura.cs` | E1 E4 F1 | 否 | M |
| FX1 战斗特效一 ✅ | 爆炸、敌人命中（暴击星芒）、弹着点 + 弹孔、破盾 / 破甲、枪口、元素曳光、闪电；所有调用点接上。验收：`playtest fx`（TestArena 逐项截图 + 同屏粒子峰值） | `G/Fx/Presets/{Explosion,EnemyHit*,Impact*,ShieldShatter,ArmorChip}.cs` `G/Fx/{FxDirector,FxDecals,FxBudget,Surfaces,MuzzleFlashes}.cs` `A/Art/Shaders/SF_FxDecal.shader` `G/Testing/Suites/FxSuite.cs` | F1 F2 F3 | 是 | M |
| FX2 战斗特效二 ✅ | 死亡迸散 + 溶解、出生法阵 + 显形、状态着色 / 状态粒子、熔池贴花、归墟 | `G/Fx/Presets/{Death,Spawn,Abyss}.cs` `G/Fx/{StatusFx,DeathDissolve}.cs` `A/Art/Shaders/SF_StylizedLit.shader`（溶解段，默认跳过） `G/Enemies/SpawnMaterialize.cs` | F1 F2 | 是 | M |
| FX3 冰霜特效 + 发光遮罩 ✅ | 碎冰、冰爆、霜气、冻雾（流动霜纹贴花 + 续着的冷雾）、冰环（SF_FxIce 冰刺）、霜甲壳（SF_FxIce 多面冰，从脚下往上冻）、星芒（一次性 + 骨骼星芒）；按色键给青鸟 / 河豚 / 豪彘 / 狐巫 / 镜生成 _E 贴图（R/G/B = 三层，GlowMask 按发光通道 × Three.js 强度公式写 SF_StylizedLit 的遮罩段，默认跳过）；第二章 14 个敌人脚本的冰屑 / 冰环 / 冻雾 / 霜甲换成新预设。验收：`playtest fx`（只跑这段：`fx-elements`）、`frost`、`arena` | `G/Fx/Presets/Frost*.cs` `G/Fx/{Fx.Frost,FrostShell,IceSpikes,FrostGlints,FrostFogFx,FxIceMeshes,GlowMask}.cs` `A/Art/Shaders/SF_FxIce.shader` `art/pipeline/tools/emission_mask.py` `A/Game/Resources/Fx/GlowMasks/*_E.png` | F1 | 是 | M |
| FX4 火狱特效 + 火苗着色 + 分区遮罩 ✅ | 火药爆（金色火星、红纸屑、黑火药烟、焦痕、火舌火柱）、熔铜流（`MoltenStream`：浇铜液流 + 熔铁团）、链（`FxChain` 程序化链环 + 倒刺钩、逐节烧红、断链落地，SF_FxChain）、火舌（SF_FxFlame 噪声火苗面片：骨骼火舌 / 地上火苗 / 火柱）、地火变体（SF_FxDecal 模式 5：余烬 / 纸灰 / 熔铜 / 熔岩溅 / 日火裂痕，`FloorFire.Spawn` 的 look 参数）、碎岩甲 / 熔岩飞溅 / 断链预设；SF_StylizedLit 加 `_FLAMEKEY`（`FlameKey`：火浣鼠 / 祸斗 / 炭童的火苗毛）与分区段（`RegionMask`），默认值下都跳过；`RegionMaskPostprocessor` 在模型导入后烘火鼍 8 块岩甲 / 傩面分区遮罩；第三章 11 个敌人 + 火浣鼠 / 镇墓兽接上。验收：`playtest fx`（`fx-elements`）、`inferno`、`desert` | `G/Fx/Presets/Inferno*.cs` `G/Fx/{Fx.Inferno,FlameTongues,FlameKey,BoneFlames,MoltenStream,FxChain,FloorFireFx,RegionMask}.cs` `A/Art/Shaders/{SF_FxFlame,SF_FxChain}.shader` `P/Editor/RegionMaskPostprocessor.cs`（改 SF_StylizedLit 小块） | F1 FX2 | 是 | L |
| R3 商店 / 强化台 | 7 个摊位、价格 ×(1+0.25ch) 取整到 5、拒绝提示、强化预览、售罄、按住 F 防误买、摊位贴地形 | `G/Loot/Shop/*` | R1 W2 U2 S0 | 是 | L |
| U4 暂停 / 设置 / Tab 面板 | 暂停（双击确认 + 本局概况）；设置自动生成（含分辨率、改键、手柄）；Tab（秘卷、属性网格、武器卡、灵宠页）；测试钩子保留 | `G/UI/Screens/{PauseScreen,SettingsScreen,InventoryPanel}.cs` `G/UI/Widgets/{StatGrid,ScrollList}.cs` `G/UI/PauseMenu.cs` | U1 WC8 S0 | 否 | L |
| ART2 旱魃动作 | Blender 脚本关键帧 6–10 段 + 事件叠加；运行时层（悬浮、日轮旋转、弹簧骨） | `art/source/characters/SK_Boss_Hanba/anim/**` `A/Art/Characters/SK_Boss_Hanba/Anim/**` | ART1 E5 | 是 | L |

### 第 3 批：地图与首领

每张图都按同一流程：先写 `docs/level-design/maps/<id>.md`（场地表、遭遇、地标视线、开放化说明）→ 白盒 → `level <id>` 验收 → 换正式件。

| 单元 | 内容（做完 = …） | 拥有文件 | 依赖 | 编辑器 | 量 |
|---|---|---|---|---|---|
| M11 1-1 收尾 | 撤空气墙，换软边界；④ 加沙暴；散布；白盒件换正式件；1–2 个藏宝点；放开 ②③ 的先后顺序；遭遇改用 EncounterSpec；撤掉武器架；出口接 1-2 | `P/Editor/Levels/Level_1_1.cs` `A/Scenes/L1_1_GobiRoad.unity` `docs/level-design/maps/1-1.md` | L2 L3 L4 L5 EN1 ART3 | 是 | M |
| M12 1-2 雅丹迷城 | 雅丹场地形；辫状干河道；屋脊之海（屋顶层 + 流沙）；塔尖广场；岩拱出口；塔尖全程可见 | `P/Editor/Levels/Level_1_2.cs` `A/Scenes/L1_2_Yardang.unity` `docs/level-design/maps/1-2.md` | L4 L2 L8 EN1 ART3 | 是 | L |
| M13 1-3 沉沙古城 | 墙头 / 屋顶 / 街巷三路并行；城墙压沙；半埋长街；下沉井台；寺院前庭补给营；下行通往 1-4 | `Level_1_3.cs` `L1_3_SunkenCity.unity` `maps/1-3.md` | L4 L2 B2 R3 ART4 | 是 | L |
| M14 1-4 鸣沙山月牙泉 | 露天沙山盆地（刀刃脊沙山环抱、112 × 92 m 盆底）；北面观景台安全起步台；月牙泉浅水 CrescentSpring；南岸月牙阁 + 回廊 + 白杨（全影来源）；两座新月丘；BossArena 锚点 | `Level_1_4.cs` `L1_4_Crescent.unity` `maps/1-4.md` | B0 B2 L4 ART4 | 是 | M |
| BS1 旱魃 · 日晒与烈日 | SunExposure（每 0.1 s 从胸 / 头朝太阳打射线 + 主光投影；浅水减灼烧）；日轮扫射、旱风、召沙魇；可以用代理模型 | `G/Bosses/Hanba/{HanbaBrain,HanbaDef,SunExposure,SunRing}.cs` `G/Bosses/Hanba/Moves/Phase1*.cs` | B1 M14 C3 EN1 | 是 | L |
| BS2 旱魃 · 焦土 / 赤地 / 日蚀 | 吸干泉水 + 喷气裂缝、焦裂、飞天之殇、日轮升顶、日蚀 3 s 泉珠 ×3；登场 / 转阶段 / 死亡演出；定档约 4.4k + 2.2k，60–120 s | `G/Bosses/Hanba/Moves/{Phase2,Phase3}*.cs` `A/Game/Timelines/Hanba*` | BS1 ART1 ART2 | 是 | L |
| M21 2-1 冰瀑栈道 | V 形谷 + 阶地（20–40 m）、两到三种渡法、冰河 / 冰潭冰面、冰桥冰棱、断桥冲刺、狌狌攀爬链接 | `Level_2_1.cs` `L2_1_Icefall.unity` `maps/2-1.md` | L4 L6 L8 EN2a EN2c ART5 | 是 | L |
| M22 2-2 昆仑天阙 | 阶梯山坡 + 挡土墙；三门择路，都通向十字兽庭；开明兽像地标；钟亭 / 玉库藏宝 | `Level_2_2.cs` `L2_2_Kunlun.unity` `maps/2-2.md` | L4 L2 EN2a EN2b EN2d EN2e ART5 | 是 | L |
| M23 2-3 瑶池冰湖 | 椭圆冰湖、湖心亭和小岛；B / C 任意顺序后开 D；岸边渔营 / 冻船藏宝 | `Level_2_3.cs` `L2_3_Yaochi.unity` `maps/2-3.md` | L8 L2 EN2b EN2d EN2e | 是 | L |
| M24 2-4 北冥冰台 | 雪岭营地补给营 + 转一次弯的冰崖通道；环台 + 冰窟（落入就扣血并送回 SafeGround）+ 冰柱 + 祭台 | `Level_2_4.cs` `L2_4_Beiming.unity` `maps/2-4.md` | B2 L8 L4 | 是 | M |
| BS3 鲲鹏 | 按 3.9；水面遮罩切口；事件叠加表；四种代理测试 | `G/Bosses/KunPeng/**` `A/Art/Characters/SK_Boss_{Kun,Peng}/Anim/*.events.json` | B1 M24 E3 E5 C4 | 是 | L |
| M31 3-1 熔湖堤道 | 火山口熔岩湖、玄武岩岛 / 墩、多条堤道；会被打进熔岩；毕方栖柱 | `Level_3_1.cs` `L3_1_Causeway.unity` `maps/3-1.md` | L7 L4 EN3a EN3b EN3c ART6 | 是 | L |
| M32 3-2 铸神井 | 宽螺旋岩台 + 横向坡 + 下跳捷径；熔岩井心全程可见；升降台出口 | `Level_3_2.cs` `L3_2_ForgeWell.unity` `maps/3-2.md` | L7 L6 EN3a EN3c EN3d ART6 | 是 | L |
| M33 3-3 铸范大坊 | 铸床被熔铜渠切开（桥是走位线）；鼓风正殿回访，拉风闸后状态改变；终点场地是魔将领主战 | `Level_3_3.cs` `L3_3_Foundry.unity` `maps/3-3.md` | L7 L6 EN3b EN3d EN3e BS6 ART6 | 是 | L |
| M34 3-4 祝融炉心 | 铸神前殿补给营 + 单桥；圆殿、熔池、吊鼎、4 条链和锁扣、4 条渠、外环跑道；熔铁闸封门 | `Level_3_4.cs` `L3_4_Zhurong.unity` `maps/3-4.md` | L7 B2 L6 ART6 | 是 | M |
| BS4 火麒麟 · 玄鳞 + 锁扣砸鼎 | 踏火奔驰、张鳞、麟火、饮熔（召炭童、回甲）；打对锁扣 → 鼎角砸晕 4 s + 鳞甲崩裂 ×2；巨鼎物理 + Timeline | `G/Bosses/Qilin/{QilinBrain,QilinDef,QilinLock,QilinCauldron}.cs` `G/Bosses/Qilin/Moves/Scale*.cs` | B1 M34 L6 L7 EN3a | 是 | L |
| BS5 火麒麟 · 焚身 | 转换：断链，鼎坠下成为掩体；踏云俯冲火环、吐息扫象限、熔流轮转（运行时改 NavMesh）、火云雨 + 飞鸦、狂怒；最终胜利链 | `G/Bosses/Qilin/Moves/Burn*.cs` | BS4 EN3d | 是 | L |
| BS6 熔心魔将（3-3 领主） | 冲锋留火、横扫、陨石雨、跃击、连斩、熔铜渠涨落、20% 狂怒 | `G/Bosses/Warlord/**` | B1 ART8 | 是 | M |
| U5 主菜单 / 天赋 / 结算 | Boot → 主菜单（3D 远景、标题、魂晶、生涯、操作说明、退出）；天赋面板；结算（计数滚动、chips、再来一局）；阵亡慢动作 → 结算 | `G/UI/Screens/{MainMenu,Talent,Summary,Controls}Screen.cs` `G/Core/RunEnd.cs` `P/Editor/Levels/MenuSceneBuilder.cs` `A/Scenes/MainMenu.unity` | U1 R2 L1 | 是 | M |
| U6 选英雄 + 3D 祭台 | 名录 + 详情 + 属性条 + 初始武器卡；祭台、光柱、符文环、氛围粒子、拖拽惯性、Show → Idle、Timeline 出场道具 | `G/UI/Screens/HeroSelectScreen.cs` `G/UI/HeroStage/*` `A/Scenes/HeroSelect.unity` | U1 HC1 HC2 ART7 | 是 | L |
| U7 罗盘 / 全图 | 罗盘条显示目标和已发现地点；M 键全图（用 L5 的俯视截图）；LevelMeta 由构建器写入 | `G/UI/Widgets/CompassStrip.cs` `G/UI/Screens/MapScreen.cs` `G/Core/LevelMeta.cs` | U1 L5 L2 | 否 | M |

### 第 4 批：整合与打磨

| 单元 | 内容（做完 = …） | 拥有文件 | 依赖 | 编辑器 | 量 |
|---|---|---|---|---|---|
| I1 十二关串联 | 主菜单 → 选英雄 → 1-1 … 3-4 → 胜利结算可以走通；关间结算卡；构建设置按 RunPlan；demo 开关（demoEnd = 1-4） | `G/Core/RunPlan.cs` `P/Editor/Levels/BuildOrder.cs` | 全部 M / BS、U5、U6 | 是 | M |
| I2 整局自动化通关 | 见 7.5 | `G/Testing/Suites/FullRunSuite.cs` `G/Testing/Bot/*` | I1 | 是 | L |
| I3 平衡 ✅ | 秒伤带统一按裸秒伤判（扩充 6 把的带是公式值，之前拿含元素克制 / 蚀化易伤 / 余烬的实际掉血去比，误报 5 把带外），18 把都在带内，唯一离群赤蛟霰铳每粒 11 → 10；`boss-soak` 用各章代表配装真打四个首领，改前 35–40 游戏秒（估算 42–48 s），旧定档模型漏了技能、灼烧、秘卷和余烬，耐久按实测提到 1.75–2.7 倍，改后估算 72–79 s，四个模型改从 `BossBalance` 取参考秒伤；3-3 魔将只走到第 2 阶段是阶段门槛能被跳过（越线后等招式收尾的 ≤ 2 s 照常掉血），加生命下限后每个阶段都打得到；`economy` 扫 12 关场景：必经到店灵石 = 核心篮子 1.3–1.7 倍、整店 0.64 倍，全清最多买下整店，魂晶全清 1190、点满天赋 9.5 次，都不改，只修首领灵石捡不到（倒下后吸取）和投影缺省值；逐关难度基本平，2-1 偏重记给地图单元；1-1 的武器宝箱都是指定 id，不受随机元素影响 | `docs/balance.md` `G/Testing/Suites/{BossSoak,EconomyProjection}Suite.cs` `G/Bosses/BossBalance.cs`（改 `Damageable` / `BossBrain` 阶段门槛、四个首领定档、`Weapon_Magmashot`、`EconomyConfig` / `LootDirector`；`CombatTuning` 不改） | I1 | 是 | M |
| I4 性能 | GPU 遮挡；1-3 烘焙遮挡；地形分块 LOD；远景 impostor；按固定机位采基线（docs/performance.md 协议）；预算写进 L5 | `P/Editor/Levels/LevelKit.Perf.cs` `A/Settings/**` | I1 | 是 | M |
| I5 中途续玩与图鉴（超越） | 每关开头写 run.json，主菜单「继续征程」；武器 / 秘卷 / 敌人 / 灵宠图鉴 | `G/Core/RunSuspend.cs` `G/Progression/Codex.cs` `G/UI/Screens/CodexScreen.cs` | R2 U5 | 否 | M |
| I6 音频超越 ✅ | 各章环境声床；关键枪声 / 爆炸改分层（瞬态、主体、尾音）；旱魃主题曲；遮挡低通 + 混响区 | `G/Audio/{AmbienceZone,AudioOcclusion}.cs` `A/Game/Resources/Audio/Music/amb_*.ogg` `src/audio/Ambience.ts` | F5 | 是 | M |
| I7 手感终调 ✅ | FeelProfile SO 定稿（顿帧、击杀慢动作、屏效、震屏曲线）；手柄瞄准辅助；评估自动翻越（要做的话同步改 unity-maps 和验收规则） | `G/Core/FeelProfile.cs` `docs/feel.md` | I2 | 是 | M |

---

## 6. 美术长杆

用户已说不必审查。概念图按推荐版本直接进 Tripo。生产路线：Codex 概念 / 四视图 → Tripo 网页 → `tripo_assets.py import` → publish → `unity_export.py`（见 [unity-art-pipeline.md](unity-art-pipeline.md)）。

| 资产 | 现状 | 路线 | 阻塞 | 占位（代码先跑） |
|---|---|---|---|---|
| **旱魃本体 + 日轮 + 泉珠** | ✅ ART1（2026-10-20）：84 根骨（语义人形 + 衣 / 袖 / 发链），socket_core / socket_sunring，泉珠发光壳；见 [boss-hanba.md](art/boss-hanba.md) | 概念 → 四视图 → Tripo → 语义人形 + 发 / 衣链 | BS1 / BS2 演出、最终观感 | SK_Enemy_Apsara 放大 3.5 倍 + 白盒日轮环；ProceduralIdle |
| **旱魃动作** | ✅ ART2（2026-10-21）：10 段 Blender 关键帧 + 事件叠加表，见 [boss-hanba.md](art/boss-hanba.md) 第 8 节 | Blender 关键帧 + 运行时层（E5 的关键帧导入） | BS2 | 代码驱动姿态（悬浮 + 日轮旋转 + 手臂 IK） |
| 沙魇 | ✅ EN1：`EnemyVariant` + StylizedLit 的 Variant 段（沙化、UV Voronoi 日火裂纹、暖边光），借跳鼠 / 第一章杂兵的模型 | 材质变体（Shader 参数） | — | — |
| 1-1 收尾件 | 驿站残墙、垛墙、积薪还是白盒；没有散布件；远景巨像题材不对 | Tripo | M11 | 现有白盒 |
| 1-2 专用件 | 全缺 | Tripo + 雅丹高度场 | M12 | 高度场岩墙 + 沙漠套件下沉 |
| 1-3 专用件 | 店铺楼、井台、寺塔、回廊、香炉、碑 | Tripo | M13 | 沙漠 V2 套件半埋 |
| 1-4 擂台 | 月牙阁、白杨、芦苇 | Tripo | M14 / BS1 | 白盒台 + SM_Env_DesertCliff |
| **冰瀑栈道套件** | 冰瀑、冰桥、冰棱、栈道 ×5、崖壁片全缺 | Tripo / Hunyuan + 冰着色器 | M21 | SM_Env_TravelDeck + FrostCliff + 程序冰块 |
| 第二章其他 | 钟亭、湖心亭、挡土墙、冰窟边缘；FrostTao 已登记但没导出 | 导出 + Tripo | M22–M24 | 昆仑 / 北冥套件 |
| **第三章专用件** | 堤道、螺旋岩台、铸范、风箱、悬炉、吊鼎 + 锁扣、熔铁闸 | Tripo；链条程序生成 | M31–M34 / BS4 | 火狱套件 + 白盒；鼎先用 CauldronRuin 放大 |
| 熔岩 / 冰 / 水着色器 | 全缺 | 写 Shader，不走管线 | L7 / L8 | 自发光平面 |
| 第二章缺约 25 段片段 | 采样器从没进过这些状态 | E5 强制状态采样 | EN2* | 播 Idle + 警告 |
| 第三章招牌状态片段 | 同上，需要熔岩 / 火 / 友军桩 | E5 + 场景桩 | EN3* | 同上 |
| 熔心魔将动作 | 部件骨架没有片段 | 采样 setAnim | BS6 | ProceduralIdle |
| 鲲鹏 / 火麒麟动画事件 | 片段在，没有事件 | events.json 叠加表 | BS3 / BS4 | 代码按时间触发 |
| 碎刃 | 程序化，管线导不了 | C# 烘焙网格 + 拷贝刀柄贴图 | WC5 | — |
| 武器零件语义、瞄具、弩弦 | 缺 | 改导出管线 | W4 / WC* | 相机空间枪口常数 |
| 宝箱 / 商店道具 / 商人 / 强化台 / 选人祭台 | 程序方块 | Tripo | R3 / U6 | 现有 MarketStall / ForgeStall / PrayerTent / 程序宝箱 |
| 发光遮罩（青鸟 / 河豚 / 豪彘 / 狐巫 + 镜） | ✅ FX3：`emission_mask.py` 按色键 + 资产空间区域烘 _E（R/G/B 三层），`GlowMask` 运行时按发光通道点亮；狐巫本体（狐火 / 翠玉）和铜镜（青玉 / 镜面蓄光）的规则是 Unity 版新定的 | 按色键脚本生成 _E | — | — |
| 特效贴图 | 全缺 | 先程序生成，再手绘 | FX* | 程序贴图 |
| UI 字体 / 图标 / 缩略图 | 系统字体，没有图标 | OFL 字体；从 icons.ts 抽 SVG；RenderTexture 自动渲染缩略图 | U1 | — |
| 环境音 / 分层枪声 / 旱魃主题 | 无 | 合成烘焙或授权素材 | I6 | 无 |

排期：ART1、ART3–ART7 在第 1 批就开工；ART2 在第 2 批；ART8 跟在 E5 后面。美术不阻塞代码。地图单元先用占位件跑完验收；换正式件只重跑 `level <id>`。

---

## 7. 验收

### 7.1 每个单元都要做

1. `python scripts/unity/csc_check.py` 退出码 0（worktree 里也能跑）。
2. `git diff --stat` 只包含本单元拥有的文件，以及写明了的共享小块。
3. 本单元新增的 EditMode 测试：`bash scripts/unity/bridge.sh tests <过滤>` 全绿。
4. 本单元的冒烟套件：`bash scripts/unity/bridge.sh playtest <suite> [scene]` 全绿；`slice11` 不回退。
5. 合入后提交编辑器生成的 `.meta`，然后推送（见 4.1）。

### 7.2 第 0 批

| 检查 | 命令 / 标准 |
|---|---|
| 行为不变 | `bridge.sh level 1-1` 报告全部 OK；`bridge.sh playtest slice11` 与改动前结果一致 |
| 契约 | EditMode：伤害乘区、分层、反应调参与 Three.js 数值逐项一致；注册表里武器 6、敌人 7、秘卷 16、英雄 1，id 唯一 |
| 画面 | 重开工程后 1-1 截图里有 Bloom 和色调映射，与修复前的截图对比 |
| 基础设施 | `bridge.sh levels`、`tests`、`playtest <suite>` 都能用；TestArena 能刷出第一章 6 种敌人和占位体 |
| 美术登记 | registry 拆分前后资产数一致；`unity_export.py --all` 的结果不变（退役资产除外） |

### 7.3 第 1 批

| 组 | 标准 |
|---|---|
| 战斗 C | 崩解 / 引爆 / 强制反应、DoT 乘区、首领眩晕、吸血、穿透、投射物爆头都有 EditMode 测试；`playtest reactions` 里四种反应和崩解都能在 TestArena 打出来；连环爆炸 50 次不爆栈 |
| 特效 F | Development Player 包里没有粉色材质；`playtest feel` 期间每帧 GC Alloc 不随特效增长；预警贴花在 30° 坡上不穿地 |
| 武器 W | 6 把武器的秒伤回归与改动前相差 ≤ 3%；每种 IFireMode 都能用 TestMode 驱动；17 把的 GripSheet 网格图里手到握点的距离 ≤ 2 cm |
| 英雄 H | 冲刺跳距离 ≈ 6 m（unity-maps-v1 尺度表）；1-1 过沟 / 可达性重跑通过；二段跳 ≈ 2.7 m |
| 敌人 E | TestArena 里飞行占位体能起飞、栖落、找到视线；HitZone 计数能触发事件；`ExplosiveChain` 引爆顺序正确 |
| 关卡 L | Core → 1-1 → 出口 → 再进 1-1：武器、秘卷、灵石、灵宠、血量都带过去；软边界推回且没有空气墙；熔岩扣血、托回、敌人被打进去烧死；`level 1-1` 新规则集全部通过 |
| 首领 B | 代理首领：每个招式至少放一次、越阈值换形、溃散、结算链完整 |
| 局 R / 秘卷 S0 | 坏档能从 .bak 恢复；天赋生效；ScrollRoll 的权重分布用 10 万次抽样与公式比对，误差 < 1% |
| UI U | 截图里能看到 UI Toolkit 叠层；Deck 分辨率下没有豆腐块；手柄能走完暂停菜单 |
| 美术 ART | `bridge.sh sync` 后 ArtValidator 通过；资产能在 TestArena 或展示场景里放出来 |

### 7.4 第 2、3 批

| 类别 | 标准 |
|---|---|
| 每把武器 | `playtest weapons`：WeaponDpsSuite CSV 的裸秒伤（I3 口径，不含元素克制 / 易伤 / 被动）落在 Three.js 秒伤带内（考虑 ×spreadScale 说明）；零件动画、换弹、元素着色截图归档 |
| 每卷秘卷 | 每个钩子至少一条 EditMode 测试（参照 tests/scroll-*.test.mjs 的写法）；`playtest scrolls` 依次授予全部 118 卷各 1 层和满层，60 s 没有异常 |
| 每种敌人 | TestArena 刷出普通和精英，60 s 内每个状态都到达过、每个片段都存在、没有异常；断言的数值（hp、伤害、范围）与 Three.js DEF 一致 |
| 每张图 | `bridge.sh level <id>` 全部检查通过（NavMesh、视线、坡度、锚点净空、越界、预算、没有 Placeholder）；`playtest map-<id>` 机器人清完全部必清场地并走出出口 |
| 每个首领 | `playtest boss-<id>`：每个招式放一次、强制越过每个阈值、90 s soak（不出场、状态值有限）；用模拟秒伤算击杀用时，落在 60–120 s；`playtest boss-soak` 用代表配装真打一遍，估算用时 60–120 s、每个阶段都走到（I3，参考秒伤取 `BossBalance` 的浸泡实测） |

### 7.5 第 4 批：整局自动化通关（I2）

`bash scripts/unity/bridge.sh playtest fullrun`：
- 机器人：导航到据点、自动瞄准射击、开宝箱选第一项、商店买一件、走出口、打首领。
- 以 4 倍时间跑完 12 关，三位英雄各跑一次。

每关断言：
- RunState 带过去（武器、秘卷、灵石、灵宠、血量）。
- 没有异常，没有 Placeholder。
- 帧时 P95 在预算内。
- 存档已写入。

结尾断言：胜利结算出现，魂晶已结算，生涯统计已更新。报告写到 `Assets/Art/_Review/fullrun_report.txt`。

落地（I1 / I2，2026-10-25）：
- 命令是 `bridge.sh playtest full-run`（英雄 燎）、`full-run-falcon`、`full-run-bear`；一整局约 300 s（编辑器刚启动、资源还冷时约 450 s），在 600 s 上限内。分段套件 `full-run-ch1/ch2/ch3` 用接力档（`Library/SpiritfireBridge/fullrun_relay.json`）串起来，单独查某一章时用。
- 测试加速写在 `RunBot` 和套件注释里：小怪伤害 × 6、首领 × 1（不加速，阶段全走）、时间 × 4、登场演出关、致命一击拦下记「倒下」、备弹补满、场地 60 / 首领 150 游戏秒补刀、场地之间按导航路径传送（只落在和出生点连通的地方）。
- Placeholder、帧时 P95 只记进报告不判；「存档已写入」I5 落地后已加：每关查 `run.dev.json` 是这一局、这一关的进关快照。
- 一局的另外两种结束 + 试玩开关由 `playtest run-ends` 验：阵亡 / 放弃 → 结算 → 主菜单，demoEnd = 1-4 时打完旱魃 → 胜利结算 → 主菜单。

这一项通过，就等于对齐完成。之后按第 2 节 D27 / D28 进入超越阶段。

### 7.6 I5 中途续玩与图鉴（超越，2026-10-25 落地）

续玩档（`G/Core/RunSuspend.cs`）：
- 文件：`persistentDataPath/save/run.json`（调试档 `run.dev.json`），和 `profile.json` 同目录。信封 `{ version: 2, game, kind: "run", build, savedAt, stage, label, hero, run: {…} }`，`run` 是 `RunState` 的全部公有字段（`RunStateJson`，接力档 RunRelay 用同一套）：英雄、种子、章 / 关序 / 编号 / 难度、用时、伤害、灵石、魂晶、击杀、清关数、标记、秘卷（id → 层数，按获得顺序）、两把枪（id、品质、强化、元素、弹匣、备弹、手上那把、词条含传说特性）、灵宠（id、灵契等级、经验、灵技冷却）、生命 / 护盾、开局天赋快照 `talents`（天赋 id → 等级）。
- 天赋开局锁定（v2）：`RunState.Begin` 发 `RunStarted` 时 `TalentHooks.Lock` 把这一局该用的档的天赋等级拍进 `RunState.talents`，之后跨关、重来本关、暂离后继续征程都按快照套（`MetaSave.ApplyTalents(stats, run)`）；暂离期间在主菜单买的天赋照常进元进度，下一局开局才生效。读到 v1 的档（没有快照）按读档那一刻档里的天赋补上，从继续征程起锁定；快照里不认识的天赋 id 原样保留不生效，等级夹到满级，负数按坏档。
- 写：`GameEvents.StageLoaded` 时写 `SceneFlow.EntrySnapshot`（= 重来本关回到的那份）；先写 `.tmp` 刷盘再 `File.Replace` 原子替换，不留 `.bak`。已结算的局（阵亡后练习）不写；直接打开关卡的调试局只在调试档开着时写。
- 随机流不另存：`RunState.Stream` 只由「种子 + 关卡编号 + 流名」决定，进关时这一关的流都在起点，读回来同样从起点开始。秘卷的跨叠层计数（ScrollInventory.memory）和重来本关一样回到零。
- 删：`GameEvents.RunEnded`（阵亡 / 放弃 / 胜利 / 开新局时放弃旧局）删掉那个档的续玩档。
- 读：主菜单 `MenuFlow.Suspended` 逐项校验（JSON、版本、英雄 / 关卡存在且在试玩路线里、没结算过、数值 / 品质 / 元素合法）；坏档挪成 `.corrupt`、主菜单提示一次「上次的征程存档已损坏」，不崩溃；版本更新的档原样留着不读。
- 界面：主菜单「继续征程」（写着关卡 · 英雄 · 用时 · 灵石）；暂停「返回主菜单」在有续玩档时是暂离（`MenuFlow.Suspend`，一按就走、不结算），没有续玩档时照旧结算并二次确认；有未完成的征程时「出征」先弹确认框（`ConfirmScreen`：「开始新征程会放弃当前的征程（第 x-y 关），确定吗？」），确认后旧局按败北结算。

图鉴（`G/Progression/Codex.cs`、`CodexTracker.cs`、`G/UI/Screens/CodexScreen.cs`、`CodexThumbs.cs`）：
- 存档 `codex` 段（元进度，每个档一份）：`{ weapon: [...], scroll: [...], enemy: [...], pet: [...], fresh: ["enemy:apsara", …] }`；认不出的 id 原样保留不计数。
- 收录：敌人 = 首次打中 / 被打中 / 打死 / 首领登场；秘卷 = 获得事件；武器、灵宠、读档恢复的秘卷 = 每 0.5 s 看一眼手上的。附属单位（蜃景、炭童余烬）不单列，复燃的炭童算炭童，测试首领不进。
- 界面：主菜单「图鉴」；四页签 + 4 × 3 翻页 + 详情（武器复用 WeaponDescriber 的基础数值与特性，秘卷 1 层 / 叠满描述，敌人打法要点 + 基础数值，灵宠攻击 / 被动 / 灵技 / 觉醒）；缩略图是运行时摄影棚拍的模型图（黑白底差分抠像），未收录染黑成剪影、名字「？？？」，秘卷用单字签；新收录带朱印「新」。

验证：EditMode `RunSuspendTests`（34 项，含天赋锁定 3 项）；`playtest suspend`（打到 1-2 开头暂离 → 主菜单买天赋 → 继续征程，进关快照 20 个字段逐项一致、手上东西一致、随机流同一串、天赋效果不变；图鉴四页签翻页；放弃删档后再出征新天赋生效；坏档丢弃）；`playtest run-ends` 第 0 步（暂离 → 确认框取消 / 确认）；`full-run` 每关「存档已写入」。
