# 灵火破晓（Spiritfire Dawn）— 设计与架构文档

> 一款受《枪火重生》启发的浏览器第一人称射击肉鸽。原创世界观、角色与美术（低多边形程序化几何），不使用任何外部素材。
> 技术栈：Three.js 0.186 + TypeScript 7（原生 tsc）+ Vite 8。只依赖 `three`（可用 `three/examples/jsm/*` 附加模块）。
> 所有面向玩家的文字使用**简体中文**。

---

## 1. 设计支柱

1. **爽快射击**：高移速、冲刺、二段跳；命中反馈强（闪白、伤害数字、命中标记、音效、屏震）；爆头即暴击。
2. **构筑成长**：每局靠「秘卷」（被动 Buff）、武器掉落与强化、元素协同构建流派，局与局之间差异大。
3. **可读的敌人**：所有高伤攻击都有前摇与预警（地面圈、激光瞄准线、蓄力发光），可以闪避。
4. **短局**：一局 3 章 × 5 关，约 20–30 分钟。

## 2. 操作

| 按键 | 功能 |
|---|---|
| WASD | 移动 |
| 空格 | 跳跃（部分英雄可二段跳） |
| Shift | 冲刺（有充能与冷却） |
| 鼠标左键 | 射击 |
| 鼠标右键 | 瞄准（缩放视野、降低散布）；持魔刀千刃时切换形态「斩」/「千刃」（不开镜） |
| R | 换弹（魔刀千刃「千刃」形态为召回飞刃，「斩」形态无效果） |
| 1 / 2 / 滚轮 / X | 切换武器 |
| Q | 主技能（长冷却） |
| E | 副技能（多充能投掷类） |
| V / 鼠标中键 | 武器技能（当前武器有武器技能时；目前只有魔刀千刃「千刃·无间」） |
| F | 交互（拾取武器、开宝箱、购买、进入传送门） |
| Tab（按住） | 查看已获得秘卷与属性 |
| Esc / P | 暂停 |

## 3. 一局的结构

- 3 章：**荒漠遗迹（desert）→ 霜雪古寺（frost）→ 熔火深渊（inferno）**。
- 每章 5 关：第 0–3 关为普通关，第 4 关是 **Boss**。
- 关卡类型 `StageType`：
  - `combat` 战斗：3–4 波敌人，清完出宝箱 + 出口传送门。
  - `elite` 精英：更少但更强的敌人（含 2–3 个精英），奖励更好。
  - `treasure` 宝藏：没有敌人，直接给宝箱。
  - `shop` 商店：没有敌人，有商店摊位与强化台。
  - `boss` 首领。
- 清关后出现 **1–3 个出口传送门**，每个门显示「下一关类型 + 奖励类型」（类似枪火重生的分支选择）。
- 奖励 `RewardType`：`scroll`（三选一秘卷）、`weapon`（一把武器）、`coins`（一堆金币）、`heal`（回复 50% 生命并 +10 生命上限）、`upgrade`（免费强化当前武器一级）。
- 规划规则（`RunPlanner`）：
  - 每章第 0 关固定 `combat` + `scroll`。
  - 第 1–3 关的选项从 combat / elite / treasure / shop 中抽取，每章至少提供一次 shop 选项（通常在第 2 或第 3 关）；treasure 每章最多一次。
  - 第 3 关清关后只有一个门：通往 Boss。
  - Boss 清关：奖励宝箱（`weapon`，高稀有度）+ 回满生命，出口通往下一章第 0 关；最终 Boss 清关后 4 秒判定胜利（`ctx.game.endRun(true)`）。
- 难度倍率 `difficultyFor(node) = 1 + chapter × 0.9 + index × 0.12`（第一章 1.00–1.48，第二章 1.90–2.38，第三章 2.80–3.28）。
  敌人生命 × 难度；敌人伤害 × `1 + (难度 − 1) × 0.55`（EnemyBase 已实现）。

## 4. 数值基准（所有模块共同遵守）

- 玩家：生命 90–140、护盾 50–80（按英雄）；护盾在 3 秒未受伤后以 30/秒 恢复。移速 7.5 m/s，跳跃初速 8.6 m/s，重力 26 m/s²。
- 第一章敌人单次伤害 8–15（近战重击 / 冲锋 20–30），难度 1。玩家满状态约能承受第一章 12–15 次普通命中。
- 武器（普通稀有度、无加成）身体 DPS 约 60–90；稀有度伤害倍率 `[1, 1.15, 1.35, 1.6, 1.9]`；强化每级 +12%（最多 5 级）。
- 第一章普通敌人 1–3 秒击杀；Boss 战 60–120 秒。
- 金币：普通敌人 2–5，精英 ×3，Boss 60–100；每关约 40–70 金币（第一章），章节越后越多（× (1 + 0.35 × chapter)）。
- 魂晶（局外货币）：普通敌人 1、精英 5、Boss 60；每清一关 +10；胜利额外 +200。

## 5. 元素与状态

伤害分三层：**护盾（蓝）→ 护甲（黄）→ 生命（红）**，打穿上一层的溢出伤害继续打下一层（按下一层倍率重新换算）。

| 元素 | 对护盾 | 对护甲 | 对生命 | 附着状态 |
|---|---|---|---|---|
| 物理 none | ×1.0 | ×0.75 | ×1.0 | — |
| 灼烧 fire | ×0.8 | ×1.0 | ×1.25 | burn |
| 雷殛 shock | ×1.6 | ×0.8 | ×1.0 | shock |
| 蚀化 corrode | ×1.0 | ×1.6 | ×1.0 | corrode |

- **burn 灼烧**：持续 4 秒，每 0.5 秒造成 `power × 0.22` 火焰伤害；最多 3 层（每层独立计入 DOT），重复附着刷新时间。
- **shock 雷殛**：附着瞬间向 8 米内最多 3 个其他敌人弹射闪电，造成 `power × 0.5` 雷电伤害（procDepth+1，不再弹射）；标记 3 秒内受到雷电伤害 +15%；叠满 3 层时眩晕 0.8 秒并清空层数。
- **corrode 蚀化**：持续 5 秒，受到所有伤害 +20%（写入 `damageTakenMult`）、移速 −20%（写入 `slowMult`），每 0.5 秒 `power × 0.08` 伤害。
- **stun 眩晕**：写 `enemy.stunTime`。**slow 减速**：`slowMult` 取所有减速中最强的。
- `power` = 触发附着的那一击最终伤害（上限为敌人最大生命 × 0.5）。元素伤害类属性（`elementDamagePct`、`fireDamagePct` 等）作用于直接元素伤害与 DOT。
- 元素附着概率 = 武器/技能给出的 `elementChance` + `elementChancePct`。

### 5.1 元素反应（`combat/Reactions.ts`，完整规格见 `docs/arsenal-expansion.md` 第 1–2 节）

给玩家的一句话规则：**两种元素在同一个敌人身上相遇就会反应**（灼烧 × 雷殛 =「焚雷」，灼烧 × 蚀化 =「熔金」，雷殛 × 蚀化 =「封脉」）；**三种同时在身上，再补任何一种就坍缩成「归墟」**；两两反应不消耗状态，叠元素永远不亏；贯虹灵炮满蓄、「破势」词条、「点穴」秘卷可以主动**引爆**已有的元素。

| id | 名称 | 组合 | k | 下限 | 上限 | 基础冷却 | 颜色 | 效果（`B` = 反应威力） |
|---|---|---|---|---|---|---|---|---|
| `thunderfire` | 焚雷 | 灼烧 + 雷殛 | 1.0 | 14S | 80S | 1.0 秒 | `#ffd84a` | 中心 B 火焰；`r(3)` 米爆炸 0.6B（击退 7，边缘 60%）；给周围敌人附着灼烧 0.2B（可连锁一级） |
| `meltdown` | 熔金 | 灼烧 + 蚀化 | 1.0 | 14S | 100S | 1.2 秒 | `#ff7a1a` | 中心 B 蚀化（有护甲 ×2）；脚下 `r(2.5)` 米熔池 3 秒 6 跳 × 0.12B 火焰，首次被跳到的敌人附着蚀化 0.25B；全场最多 4 个熔池 |
| `veinseal` | 封脉 | 雷殛 + 蚀化 | 1.0 | 14S | 90S | 1.2 秒 | `#5affd0` | 中心 B 雷电（有护盾 ×2）；非首领眩晕 0.7 秒（独立 3.5 秒冷却，不吃急速）+ 减速 40% 3 秒，首领改为「脉滞」4 秒受伤 ×1.12；导流：8 米内最近 3 名有视线的敌人各 0.3B 雷电 + 附着蚀化 0.35B |
| `abyss` | 归墟 | 三种齐聚 | 1.5 | 40S | 320S | 6.0 秒 | `#c89bff` | 消耗灼烧（结清剩余伤害）与雷殛、保留蚀化；0.35 秒紫色收束预警后三段各 B/3（火、雷、蚀依次）；`r(3)` 米余波 0.3B（中心已死 0.6B，击退 9）；不扩散元素 |

- **判定入口**：Combat 私有 `attach()` 统一替换伤害管线第 4 步与 `applyStatus` 的 burn / shock / corrode 分支（stun / slow 直接走 `status.apply`）。先 `ReactionSystem.tryReact`，**再**照常 `status.apply`（雷殛第 3 层会自删；击杀那一击状态尚未清空）。
- **tryReact 顺序**：① 拒绝：附着 depth ≥ 2、不是元素状态、敌人已死且不是击杀那一击、本帧已接受 8 次、队列已满 32 条；② `others` = 身上除本次元素外已有的元素状态，为空不反应；③ 另外两种都在、非击杀、归墟冷却就绪 → 归墟；④ 否则在 (本次, 已有) 组合中按 **焚雷 > 熔金 > 封脉** 取第一个冷却就绪的。每次附着最多引发 1 个反应，本次元素照常附着。
- **状态消耗**：焚雷 / 熔金 / 封脉**不消耗任何状态**（频率由逐敌冷却封顶）；只有归墟消耗灼烧与雷殛。灼烧结清值 `Σ各层强度 × 0.22 × ceil(剩余秒 / 0.5)`，以一次不带标签的普通火焰持续伤害请求打出。
- **威力**：`B = clamp(k × Pin, 下限 × S, 上限 × S) × scale`。`S = 1 + max(0, run.difficulty − 1) × 0.85`；`Pin` = 引发反应那次附着的 power（`min(实际伤害, 最大生命 × 0.5)`）；`scale` 来自 `StatusApplyOpts.reactionScale`（「万象」0.6）或强制反应的 `opts.scale`；强制反应传 `fixedBase` 时 `B = fixedBase`。范围 `r(x) = x × explosionRadiusPct`。
- **冷却**：实际冷却 = 基础冷却 / (1 + `reactionHaste`)，最低 0.3 秒，逐敌人、逐反应计时。
- **反应伤害请求**：`{ source: 'status', canCrit: false, procDepth: depth + 1, tags: ['reaction', <id>] }`（熔池跳伤 `['reaction','meltdown','dot']`，崩解 `['reaction','collapse']`）。`DamageCalc.statMultiplier` 遇到 `reaction` 标签**只乘 `reactionDamagePct`**（Pin 已含伤害 / 元素 / 精英加成，避免二次相乘）；outgoing 修饰器、`damageTakenMult`、雷殛标记、脉滞、层倍率照常生效；不暴击、不吸血、不附着元素、不触发命中类词条 / 秘卷。`isDot` 排除 `reaction`（带 `dot` 的熔池除外），所以反应有命中火花与「免疫」提示。
- **归属**：反应的 `weaponUid` 取自引发它的武器命中或 `applyStatus` 的 `opts.weaponUid`；技能、秘卷、持续伤害引发的反应没有武器归属，「本武器引发」类词条不触发（有意为之）。
- **引爆** `ICombat.detonate(enemy, opts)`：只入队。拒绝（返回 `null`）：敌人不存活、depth ≥ 2、该敌人引爆冷却 0.5 秒未就绪、身上没有元素状态、预算或队列已满。三种齐聚且归墟就绪 → 归墟；≥ 2 种 → 身上已有组合中第一个冷却就绪的两两反应；否则「崩解」：按 灼烧 > 蚀化 > 雷殛 取一种，造成 `min(0.3 × 剩余持续伤害, 30S) × mult`（雷殛为 `min(0.5 × power, 30S) × mult` 并重新弹射一次），不消耗状态、不派发 `'enemy:reaction'`。**与设计文档的差异**：直接引爆（depth 0）延后到下一次 flush（约一帧）执行；引爆冷却内再来的引爆若能找到本帧 / 上一帧入队、尚未执行的引爆，就并入它（强度取较高者、返回那次的结果、不占帧预算），否则照常拒绝——同一次爆头的「点穴」（同帧先到）、贯虹灵炮满蓄（同帧）与「破势」（下一帧）因此合并为一次，不会被先到的弱引爆占掉冷却。「点穴」只在引爆被接受（含合并）时才计 1.2 秒冷却。
- **强制反应** `ICombat.triggerReaction(enemy, id, power, opts?)`：供「涅槃」「蛊种」「劫火」使用，不需要也不消耗元素状态；敌人可以已死（必须传 `opts.point`，只结算范围部分）；被深度 / 预算 / 冷却拒绝时返回 `false`，`ignoreIcd` 跳过冷却；事件 `origin: 'forced'`，`tag` 透传。
- **防递归与预算**：
  - 深度：直接命中（0）引发的反应扩散元素为 depth 1，可再引发**一级**连锁；连锁扩散的元素为 depth 2，不再反应。反应自身伤害 `procDepth = depth + 1`、`source: 'status'`，不会再附着元素。雷殛弹射仍只在 depth 0 时触发。
  - `tryReact` / `detonate` / `triggerReaction` 都**只入队**；效果在 `Combat.update()` 开头的 `reactions.flush()` 执行（处理队列快照，执行中新产生的条目进入下一批）。连锁条目延后 0.15 秒，归墟另有 0.35 秒收束。
  - 每帧最多接受 8 次反应（含引爆、强制）、大爆炸特效 3 个、反应浮字 4 个（同一敌人 0.3 秒一次）；熔池同时最多 4 个；队列上限 32。
  - 击杀那一击：可以引发两两反应（跳过中心伤害与控制，爆炸 / 熔池 / 导流照常），不引发归墟。反应造成的击杀 depth ≥ 1，野火燎原、蚀爆、连环爆等原有连锁按各自 `depth < 2` 规则最多再走一级。野火燎原原本不看深度、以 depth 0 附着，会让反应击杀重新起链：现改为以「击杀那一击的深度 + 1」（最多 2）附着蔓延的灼烧——直接击杀蔓延出的灼烧可再引发一级反应，反应 / 持续伤害击杀蔓延出的不再反应；蔓延本身照旧不受深度限制。
  - `ReactionSystem.clear()`（由 `Combat.clear()` 调用）清空队列、冷却、脉滞、熔池与帧计数，换关不残留。
- **事件与时序**：`DamageResult.reaction` 在第 4 步写入（早于 `enemy.onDamaged` 与 `'enemy:damaged'`）；`'enemy:reaction'` 在 flush 中**效果执行完毕后**派发，载荷 `{ enemy, reaction, point, base, depth, hits, weaponUid?, origin, tag?, centerKilled, stunned }`，已在伤害管线之外，监听者可直接造成伤害（`point` 为复用向量，保存需 `clone()`）。`applyStatus` / `detonate` / `triggerReaction` 不会同步造成伤害，可在任意回调里同步调用；在 `'enemy:damaged'` / `'enemy:killed'` / `'enemy:statusApplied'` 回调里要造成伤害仍包进 `ctx.tasks.delay(0, …)`。
- **可读性**（不新增状态小标 / SfxId / StatusId）：反应浮字（`DamageNumberOpts.kind = 'reaction'`，归墟大号）、每局首次出现某反应的 toast 教学（`ui/ReactionTips.ts`）、敌人血条状态行发光（两种元素 = 可反应呼吸光，三种 = 紫色「归墟就绪」急促光）。
- **新属性**：`reactionDamagePct`（反应伤害）、`reactionHaste`（反应急速）。

## 6. 英雄（`player/Heroes.ts`，id 固定）

| id | 名称 | 定位 | 基础 | 初始武器 |
|---|---|---|---|---|
| `fox` | 赤狐 · 焰尾游侠 | 火焰爆发 | 生命 100 / 护盾 60 / 移速 7.8 | `smg` |
| `falcon` | 雷隼 · 天穹猎手 | 雷电机动 | 生命 90 / 护盾 70 / 额外跳跃 1 | `revolver` |
| `bear` | 岩熊 · 镇山守卫 | 近战坦克 | 生命 140 / 护盾 80 / 移速 7.0 / 减伤 10% | `shotgun` |

- **赤狐**
  - E「燃爆雷」：投掷火焰手雷（2 充能，8 秒），落地/碰撞后 4.5 米爆炸，120 × 技能伤害，必定附着灼烧。
  - Q「九尾狐火」：3 秒内依次放出 9 团追踪狐火，各 60 伤害 + 灼烧（冷却 20 秒）。
  - 被动「余烬」：对灼烧中的敌人伤害 +20%（用 `ctx.combat.addOutgoingModifier` 实现）。
- **雷隼**
  - E「雷暴信标」：投出信标，落地后 5 秒内每 0.5 秒电击 7 米内最多 4 个敌人（45 × 技能伤害，雷殛 100%）（2 充能，10 秒）。
  - Q「鹰眼·裁决」：8 秒内无限弹药（不消耗弹匣）、射速 +40%、每次命中额外向 1 个附近敌人弹射闪电（冷却 25 秒）。
  - 被动「凌空」：二段跳；空中时伤害 +15%；按住空格下落减缓（滑翔）。
- **岩熊**
  - E「裂地重击」：向前小跃后砸地，6 米范围 150 × 技能伤害、强击退、眩晕 1.2 秒（2 充能，9 秒）。
  - Q「磐石壁垒」：8 秒内受到伤害 −50%、立即回满护盾、武器伤害 +25%，结束时释放冲击波（冷却 22 秒）。
  - 被动「厚皮」：护盾恢复延迟 −1 秒；护盾被打破时释放冲击波击退周围敌人（内置冷却 8 秒）。

## 7. 武器（`weapons/`，id 固定）

| id | 名称 | 类别 | 模式 | 要点 |
|---|---|---|---|---|
| `revolver` | 赤铜左轮 | 手枪 | 半自动 | 伤害 38、射速 3.5、弹匣 8、暴击倍率 2.5，极准 |
| `smg` | 蜂鸣冲锋枪 | 冲锋枪 | 全自动 | 伤害 11、射速 13、弹匣 36，散布大 |
| `rifle` | 裂风步枪 | 步枪 | 全自动 | 伤害 18、射速 8、弹匣 30，均衡 |
| `burst` | 三叠点射枪 | 步枪 | 三连发 | 每发 24、弹匣 24、暴击 2.2 |
| `shotgun` | 碎岩霰弹 | 霰弹枪 | 半自动 | 9 弹丸 × 12、射速 1.4、弹匣 6、逐发装填 |
| `sniper` | 鹰隼狙击 | 狙击枪 | 半自动 | 伤害 160、射速 0.9、弹匣 5、暴击 3.0、穿透 2、开镜 |
| `launcher` | 焚城榴弹 | 发射器 | 半自动投射物 | 抛物线、4 米爆炸 110、默认灼烧 |
| `crossbow` | 追魂连弩 | 弩 | 半自动投射物 | 高速弩箭 55、穿透 3 |
| `beam` | 雷弧发射器 | 光束 | 持续 | 25 米光束，约 60 DPS，默认雷殛，命中弹射 |
| `minigun` | 旋风机炮 | 重武器 | 预热全自动 | 预热 0.6 秒、射速 20、弹匣 120、开火时减速 |
| `swarm` | 蜂群飞弹 | 发射器 | 半自动投射物 | 一次 5 枚小型追踪火箭，各 30 伤害 1.8 米爆炸 |
| `flamer` | 朱雀吐息 | 喷火器 | 全自动投射物 | 伤害 7.5、射速 14、弹匣 70，射程约 10 米、穿透 3，默认灼烧 8%；约 69 DPS / 目标，群体灼烧施加器 |
| `stormpod` | 青冥雷蛊 | 发射器 | 半自动弹跳榴弹 | 95 伤害 3.2 米爆炸，撞墙反弹 2 次、触敌或 1.8 秒后爆炸；蚀化 60% + 固有「副·雷」40%，封脉引擎 |
| `magmashot` | 赤蛟霰铳 | 霰弹枪 | 半自动双管 | 8 弹丸 × 11、弹匣 2、逐发装填；灼烧 7% + 固有「副·蚀」每弹丸 6%，熔金破甲 |
| `trinity` | 三才转轮 | 手枪 | 半自动 + 元素轮转 | 伤害 42、射速 3、弹匣 6、暴击 2.4；弹巢按 灼烧 → 雷殛 → 蚀化 轮转出膛（各 45%），换弹从灼烧重来；归墟引擎 |
| `railgun` | 贯虹灵炮 | 蓄能炮 | 蓄力 | 按住蓄力 0.9 秒、松开发射，满蓄 155（未满 20%–100%，按进度平方）；满蓄额外穿透 3 并引爆命中目标的元素状态 |
| `lantern` | 蚀蛊灯 | 蛊灯 | 半自动慢速追踪 | 55 伤害、穿透 6、自动寻敌；蚀化 60% + 固有「蛊种」50%（反应传染给附近敌人） |
| `demon_blade` | 魔刀千刃 | 刀 | 双形态：近战 / 飞刃 | 右键切换（0.25 秒），切换后 2 秒内第一次攻击 +50%。「斩」：三段连斩 28 / 28 / 54（扇形群伤，一轮 1.06 秒约 104 DPS），每命中 1 敌召回 1 柄飞刃，持斩移速 +0.4；「千刃」：一轮 3 柄 ±5° 飞刃各 16（射速 2、可爆头、穿透 1），弹匣 18 柄、R 召回 1.4 秒不耗备弹。武器技能「千刃·无间」（V / 中键，冷却 16 秒）：突进 8 米斩击路径并打刃印，0.6 秒后千刃贯穿 140 并引爆元素 |

- 共 18 把（原 11 把 + 武器库扩充 6 把 + 魔刀千刃，详见 `docs/arsenal-expansion.md` 第 3 节与 `docs/demon-blade.md`）。新武器裸 DPS 63–86，反应引擎类压在 63–71，用差额换取反应潜力；贯虹灵炮必须蓄满才划算；魔刀「斩」因必须贴身，允许到约 105。
- **双形态武器**（魔刀千刃，`docs/demon-blade.md` 第 10 节）：根字段描述远程形态「千刃」，`WeaponDef.melee` 描述近战形态「斩」（`FireMode 'melee'` 只由 `formMode()` 返回）；形态按武器实例保存（切走再切回保持），新实例为「斩」。「斩」的伤害 `source: 'weapon'`，正常吃伤害加成、词条、元素附着与命中类效果，每段视为一次开火（`weapon:fired`）；射速加成同时加快斩击。召回式换弹（`WeaponDef.recall`）不需要也不消耗备弹，弹药拾取 / 商店补弹自动跳过它。
- **武器技能**（`WeaponDef.skill`，V / 鼠标中键）：冷却全局一条（所有武器技能共用，防止两把魔刀互切刷技能），受「技能急速」影响、不受英雄技能冷却缩减影响，换关保留、开新局清零；伤害不吃「技能伤害」。突进由 `IPlayer.lunge()` 驱动：走正常碰撞（被墙挡住提前停下、台阶抬升、不穿地），期间无敌、穿过敌人与敌方投射物。
- 新开火机制只有两种：**元素轮转**（`WeaponDef.cycle`，三才转轮；武器灵纹显示下一发元素）与**蓄力**（`mode: 'charge'` + `chargeTime / chargeMinMult / chargeFullPierce / chargeDetonate`，贯虹灵炮；准星显示蓄力环）。投射物新增 `bounces`（撞墙反弹）。
- 固有词条 `WeaponDef.innate`：生成实例时放在词条最前面，不占名额、不随稀有度放大、不会被重复抽到。
- 掉落权重 `WeaponDef.dropWeight`（默认 1）：三才转轮、贯虹灵炮、蚀蛊灯为 0.8，魔刀千刃为 0.6。
- 稀有度决定伤害倍率与词条数（普通 0 / 精良 1 / 稀有 1 / 史诗 2 / 传说 3 + 1 个传说特性）。
- 反应类词条 10 个（副·焚 / 副·雷 / 副·蚀〔按射速归一化为每次命中几率〕、化合、回元、疾化、乘隙、化盾、破势、蛊种）与传说特性 4 个（合璧〔同一敌人按最短反应冷却限频，避免雷殛叠层眩晕锁死；可抽条件比文档的 `canReact` 窄，只允许带元素或元素轮转的武器——合璧附加的是本发实际元素，物理弹即使有副元素词条 / 满蓄引爆也无元素可附加，按文档会出现完全无效的传说，因此物理的贯虹灵炮 / 赤铜左轮只有随机到元素时才能抽到合璧〕、轮回、涅槃、鼎沸），词条池 19 → 29、传说 6 → 10，见设计文档第 4–5 节。
- 物理武器在精良及以上有 35% 概率带随机元素（含 railgun）；自带元素的武器保持默认元素：launcher、flamer、magmashot、trinity 为火（trinity 实际按轮转出膛），beam 为雷，stormpod、lantern 为蚀。
- 稀有度随章节提升：第一章以普通/精良为主，第三章常见史诗；`luck` 属性提高高稀有度权重。
- 强化：商店强化台，费用 `50 × (level + 1) × (1 + 0.3 × chapter)`，最多 5 级。
- 瞄准（右键）：只有武器系统写 `ctx.cameraFx.fovKick`（负数 = 放大），玩家控制器读取它来设置 FOV。持魔刀千刃时右键只用于切换形态，不写 `fovKick`。

## 8. 敌人（`enemies/`，id 固定）

| id | 名称 | 行为 | 基础（难度 1） |
|---|---|---|---|
| `grunt` | 沙匪刀客 | 近战冲锋，0.35 秒举刀前摇后劈砍，偶尔突进 | 生命 80，速度 6.5，伤害 12 |
| `archer` | 骨弩手 | 保持 12–20 米，发射 3 发慢速弩矢，横移 | 生命 70，伤害 8/发 |
| `brute` | 铁甲盾卫 | 缓慢逼近，12 米内蓄力 0.8 秒后冲锋 | 生命 160 + 护甲 140，冲锋伤害 25 |
| `bomber` | 爆骸虫 | 冲向玩家，2.5 米内引信 0.6 秒后自爆（4 米 30 伤害）；被提前击杀时爆炸伤害其他敌人 | 生命 45，速度 8.5 |
| `wisp` | 幽灵飞灯 | 飞行，悬停横移，发射追踪光球 | 生命 60 + 护盾 40，伤害 10 |
| `shaman` | 巫祝 | 保持距离，在玩家脚下施放 1.2 秒预警的法阵（3.5 米 22 伤害），定期给周围友军加护盾 | 生命 90 + 护盾 80 |
| `mortar` | 重炮兵 | 缓慢，抛射 3 发带地面预警的炮弹 | 生命 150 + 护甲 60，伤害 20 |
| `marksman` | 狙击手 | 远距离，激光瞄准 1.5 秒，开火前 0.25 秒锁定位置（可闪避），命中 30 | 生命 80 |

- 精英（`elite`）：体型 ×1.25、生命 ×2.6、伤害 ×1.25（EnemyBase 已处理），外加一个词缀：`swift`（+50% 移速与攻速）、`shielded`（额外大量护盾，脱战回盾）、`volatile`（死亡时爆炸）、`frenzied`（低血量时狂暴）。
- 章节敌人池：
  - 第一章：grunt、archer、bomber，第 2 关起加入 brute。
  - 第二章：grunt、archer、wisp、shaman、marksman、bomber。
  - 第三章：全部，含 mortar、brute，精英更多。
- 波次：combat 3 波（第一章）～4 波（第三章），每关 12–26 只；后一波在上一波剩余 ≤ 2–3 只时进场。elite 关 2 波 + 2–3 个精英。

## 9. Boss（`enemies/bosses/`，id 固定）

- `boss_colossus` **沙暴巨像**（第一章）：约 5 米高的石像。生命 3000 + 护甲 1500，头部为弱点。
  招式：砸地冲击波环（低矮扩散环，可跳过）、5 颗带地面预警的抛物巨石、眼部扫射光束（膝盖高度旋转，需跳过）、50%/25% 血量召唤刀客。二阶段（50%）加快，冲击波变为双环。
- `boss_matriarch` **霜翼妖后**（第二章）：飞行。生命 3200 + 护盾 1800。
  招式：冰棱螺旋弹幕、快速瞄准冰枪齐射、带直线预警的俯冲、召唤冰晶（可击毁的小怪，存活时为 Boss 回盾：每个每秒 1.2% 最大护盾，单个累计最多 10%，耗尽后熄灭）。二阶段弹幕更密、护盾可再生。
- `boss_warlord` **熔心魔将**（第三章）：持焰刃的魔将。生命 4000 + 护盾 1000 + 护甲 1500。
  招式：冲锋并留下火焰地带（持续伤害区）、扇形火焰横扫、陨石雨（大量地面预警）、跃击；二阶段（50%）外圈熔岩区；三阶段（20%）陨石更频繁。
- Boss 的 `def.isBoss = true`；由 StageDirector 在 boss 关刷出并调用 `ctx.ui.setBoss()`。

## 10. 秘卷（`progression/Scrolls.ts`）

- 至少 40 个，覆盖稀有度 0–4，主题包括：通用伤害、暴击 / 爆头、射速 / 换弹 / 弹匣、元素（火 / 雷 / 蚀）、技能、生存（护盾 / 吸血 / 减伤）、机动、经济、爆炸、「命中时 / 击杀时 / 换弹时 / 受伤时 / 护盾破碎时」触发类，以及少数高风险高回报的传说秘卷。
- 大多数可叠层（maxStacks 2–5），层数越多效果越强；描述里用 `{n}` 或直接写明每层数值。
- 触发类效果监听 `ctx.events`，要检查 `request.procDepth` 防止无限递归；所有属性修饰使用 source `scroll:<id>`，卸载时 `stats.removeSource`。
- **反应秘卷 24 个**（`progression/scrolls/defsReaction.ts`，导出 `REACTION_SCROLLS`，在 `ScrollDefs.ts` 的 `all` 末尾展开），**共 98 个**（原 74 个）。稀有度：普通 5（催化、灵动、雷火符、熔金符、封脉符）/ 精良 4（引雷、引火、引蚀、化劫）/ 稀有 9（化元、点穴、爆焰、熔铸、锁灵、三才印 + 英雄专属狐火引雷、蚀羽惊雷、熔岩撼地）/ 史诗 4（焚天雷狱、金乌坠、镇岳、归真）/ 传说 2（混元、劫火）。逐条描述与实现见 `docs/arsenal-expansion.md` 第 6 节。
  - 新标签（中文原样显示）：`反应`、`焚雷`、`熔金`、`封脉`、`归墟`、`引爆`、`控制`。
  - 反应秘卷监听 `'enemy:reaction'` 时可直接造成伤害；`applyStatus` / `detonate` / `triggerReaction` 可同步调用，显式施加状态一律传 `depth`。
  - **与设计文档 6.3 的差异**：引雷 / 引火 / 引蚀、狐火引雷、蚀羽惊雷、熔岩撼地的附着沿用触发那一击的深度（武器 / 技能直接命中为 0，鹰眼弹射等衍生命中为 1），而不是固定 depth 1——否则它们引发的反应全是 depth 1，爆焰 / 焚天雷狱 / 金乌坠 / 镇岳（只认 depth 0）与熔铸（depth 1 熔金的伤害为 procDepth 2，被拒绝）永远不生效，与 0.3 节流派表把它们列为同一流派核心的意图相悖。它们仍受逐敌 0.3–0.4 秒冷却与概率约束；引雷 / 狐火引雷附加的雷殛与雷属性武器命中一样会弹射一次。
  - 金乌坠的坍缩爆炸另有每帧 3 个完整爆炸特效的预算（同帧被接受的多次熔金 1.5 秒后同帧坍缩），超出的改为 `noFx` + 轻量火星 / 地面光环。
  - 抽取权重（`Scrolls.roll`）：带 `反应` 标签且非英雄专属的秘卷，本局有元素来源（赤狐 / 雷隼、任一武器带元素或副元素 / 轮回 / 万象词条、已有元素秘卷）时 ×1.4，否则 ×0.5；未拥有且属于已投入流派（焚雷 / 熔金 / 封脉 / 归墟）的再 ×1.3。

## 11. 经济与局外成长

- 商店（每次 4–6 个摊位 + 1 个强化台）：武器（价格按稀有度 60/100/160/240/360 × (1 + 0.25 × chapter)）、秘卷（80–220）、生命药剂（40，回复 40%）、弹药箱（20，补满备弹）。
- 局外天赋（`progression/Meta.ts`，存 localStorage）：约 10 项、每项 5 级、价格 60/120/200/300/450 魂晶，例如生命强化（+8 生命/级）、护盾强化（+6）、武器精通（+4% 伤害）、致命（+2% 暴击）、迅捷（+0.15 移速）、装填（+5% 换弹）、元素亲和（+3% 元素触发）、技能急速（+5%）、财富（+8% 金币）、幸运（+1）。

## 12. 关卡生成（`world/`）

- 竞技场式关卡：combat 约 56 × 56 米，Boss 约 64 × 64 米；地面 y = 0；四周高墙（8–12 米）加装饰。
- 掩体 12–22 个（箱子、矮墙、柱子，高 1.2–3 米）、2–4 个高台（1.5–3 米）配台阶（每阶 ≤ 0.45 米，走过去自动抬升），Boss 场中央保持开阔。
- 刷怪点 10–16 个，距玩家出生点 ≥ 14 米；奖励点在中心附近；传送门点在远端。
- 主题：desert（沙地、砂岩、暖阳、橙雾）、frost（雪、冰蓝、冷光、青雾）、inferno（玄武岩、发光熔岩裂缝、红雾、偏暗）。
- 同材质的静态几何合并（`BufferGeometryUtils.mergeGeometries`）以减少 draw call；太阳光开阴影（阴影相机覆盖竞技场）；可加少量点光源（≤ 4）。
- 天空：大球体渐变 shader（`skyTop` / `skyBottom`），配合雾。

## 13. UI / HUD（`ui/`）

- 主菜单（开始游戏 → 选英雄、天赋、设置、操作说明）、英雄选择卡片、暂停菜单（继续 / 设置 / 放弃本局 / 回主菜单）、设置（灵敏度、FOV、音量、画质、伤害数字、屏震、反转 Y）、结算界面。
- 秘卷三选一模态框（按稀有度着色的卡片）。
- HUD：生命 / 护盾条、弹药、两个武器槽（名称 + 稀有度色）、Q/E 技能冷却环与充能、冲刺充能、金币、关卡标签与波次、剩余敌人数、动态准星（随 `weapons.currentSpread` 张开）、命中 / 暴击 / 击杀标记、受击方向指示、低血量暗角、护盾破碎闪光、Boss 血条（护盾 / 护甲 / 生命分层）、敌人头顶血条（受伤或精英时显示，含分层与状态图标）、交互提示（武器对比信息）、提示消息队列、大标题横幅、黑幕淡入淡出、Tab 面板（秘卷与属性）。
- 元素反应相关：血条状态行身负两种元素时呼吸发光（`is-reactive`）、三种齐聚时紫色急促发光（`is-primed`，「归墟就绪」）；准星蓄力环（读 `weapons.chargeProgress`，满蓄转金）；武器徽记优先显示 `WeaponDescription.elementLabel`（三才转轮为三色「三」徽记，Tab 面板显示「三相 轮转」）；每局每种反应首次出现时 toast 教学（`ReactionTips`，记录在 `run.flags['rx:<id>']`）。
- 魔刀千刃相关（`docs/demon-blade.md` 10.9）：武器槽标题前的形态徽记（「斩」朱红 /「千刃」暗金，变形时翻入）；「斩」形态弹药显示 ∞ 与「刃 N」（弹匣里的飞刃数 = 回刃进度），「千刃」形态备弹显示 ∞、换弹提示为「召回中」/「按 R 召回」；换形一击窗口内武器槽右边框朱红脉动；武器槽左侧的武器技能图标（冷却环 + 「刃」字 + 按键 V，释放中发光、冷却转好时闪一下，当前武器没有武器技能时隐藏）；「斩」形态准星换成左右两道弧形括号。全部读 `IWeaponSystem` 的可选字段，缺省按普通武器显示。
- 风格：东方奇幻（墨色、朱红、鎏金），系统字体（"Microsoft YaHei", "PingFang SC", sans-serif），不引用外部字体或图片。

---

## 14. 技术架构

### 14.1 目录与所有权

| 路径 | 负责人 | 说明 |
|---|---|---|
| `src/core/*`、`src/main.ts`、`index.html`、配置文件 | 架构（冻结） | 契约、主循环、输入、事件、随机、属性、任务调度 |
| `src/world/Collision.ts` | 架构（冻结） | AABB 碰撞世界 |
| `src/enemies/EnemyBase.ts`、`src/enemies/Registry.ts` | 架构（冻结） | 敌人基类与注册表 |
| `src/world/**`（除 Collision.ts） | 世界 | StageDirector、NavGrid、关卡生成、主题、传送门 |
| `src/player/**` | 玩家 | PlayerController、Heroes 与技能 |
| `src/weapons/**` | 武器 | WeaponSystem、武器定义、第一人称模型、掉落模型 |
| `src/enemies/**`（除 bosses/、EnemyBase、Registry） | 敌人 | EnemyManager、8 种敌人、精英词缀、Waves |
| `src/enemies/bosses/**` | Boss | 三个 Boss |
| `src/combat/**` | 战斗 | Combat（伤害管线、状态）、ProjectileSystem |
| `src/progression/**` | 成长 | Meta、RunPlan、Scrolls、Loot、Interaction |
| `src/fx/**`、`src/audio/**` | 表现 | 粒子 / 伤害数字 / 各种特效、程序化音效与音乐 |
| `src/ui/**` | UI | 所有 DOM 界面与样式 |

每个负责人**只修改自己目录下的文件**，可以在自己目录里新建文件。必须保留占位文件里的导出名与构造签名（`new X(ctx)`）。

### 14.2 上下文与生命周期

- `Game` 构造全部系统并挂到 `ctx`（`GameContext`，见 `core/types.ts`）。系统之间只通过 `ctx.xxx` 的**接口**交互，不要 import 其他负责人的具体类（例外：`enemies/Waves.ts` 可以 import `enemies/bosses/index.ts` 里的 `bossIdForChapter`，StageDirector 可以 import `enemies/Waves.ts` 里的 `buildWaves`）。
- 构造函数里**不要访问其他系统**；订阅事件、读取其他系统放在 `init()`（所有系统构造完之后调用一次）。
- `clear()`：每次换关与开新局时调用（清掉本关的敌人、投射物、掉落、交互物、特效等）。`ctx.tasks.clear()` 会清掉非常驻任务。
- 每帧更新顺序（仅 `playing` 状态）：`player → weapons → enemies → projectiles → combat → loot → interact → stage → scrolls → tasks`；表现层 `fx → audio → ui` 每帧都会更新（非 playing 状态用真实 dt）。
- `ctx.time.now` 是累计的**游戏时间**（暂停时不走），冷却与计时一律基于它或 dt。
- 渲染：主场景 `ctx.scene` + `ctx.camera` → 清深度 → 第一人称武器场景 `ctx.viewScene` + `ctx.viewCamera`（FOV 60，位于原点朝 −Z）。
- 相机：玩家控制器每帧设置 `ctx.camera` 的位置与旋转（`rotation.order = 'YXZ'`，yaw = 0 朝 −Z），并读取 `ctx.cameraFx`（震动由 fx 写入，`fovKick` 只由武器写入）。
- 模态框：`ctx.game.openModal()` 冻结玩法并释放鼠标；UI 在点击处理函数里**同步**调用回调与 `ctx.game.closeModal()`（重新锁定鼠标需要用户手势）。

### 14.3 约定

- 单位：米 / 秒 / 弧度，Y 向上。实体 `position` 为脚底中心。模型朝 +Z 建模，`root.rotation.y = facing`，`facing = atan2(dx, dz)`。
- 玩法随机用 `ctx.rng`；纯视觉随机可以用 `Math.random`。
- 金币变化：修改 `ctx.run.coins` 后必须 `ctx.events.emit('coins:changed', ...)`。
- 伤害一律走 `ctx.combat.damageEnemy / damagePlayer / explode`，不要直接改血量。
- 击杀、伤害统计、魂晶（击杀部分）、killHeal / killShield / lifesteal 由 Combat 负责；清关魂晶与 `stagesCleared` 由 StageDirector 负责。
- 热路径避免每帧分配：复用模块级临时向量；几何体 / 材质做模块级缓存；每关创建的对象在 `clear()` / `unload()` 中移除并释放（共享缓存的几何体不要释放）。
- 敌人头顶血条由 UI 负责（读 `ctx.enemies.list`）；伤害数字由 Fx 负责（Combat 调用 `ctx.fx.damageNumber`）。
- 关卡临时物体（技能召唤物、Boss 危险区、信标等）挂到 `ctx.stageGroup`，换关时自动移除；配合 `ctx.tasks`（非常驻任务换关时自动清除）驱动。注意任务被清除时不会回调，所以不要依赖任务结束来移除物体。
- 临时开关放在 `ctx.run.flags`（例如 `infiniteAmmo`：雷隼 Q 期间 >0，武器射击不耗弹；换关时 Game 会归零）。
- 调试：URL 加 `?debug` 开启（`window.__game` / `window.__ctx`，F1 无敌、F2 清怪、F3 秘卷、F4 掉武器、F6 +1000 金币，未锁定鼠标也能转视角）。

### 14.4 契约变更

`core/types.ts` 等冻结文件如需修改，不要自己改：先在自己的代码里绕过去，并在完成报告的「契约变更请求」中写明原因与建议改法，由集成阶段统一处理。

#### 变更记录：武器库扩充与元素反应（`docs/arsenal-expansion.md` 第 10 节）

契约阶段一次性落地，全部为可选字段 / 新键 + 编译桩，向后兼容；之后反应系统、新武器、词条、秘卷、UI 五条流并行实现。

- `core/types.ts`
  - `StatKey` 追加 `reactionDamagePct`、`reactionHaste`。
  - `StatusId` 之后新增：`ReactionId`（`thunderfire | meltdown | veinseal | abyss`）、`REACTION_IDS`、`REACTION_NAMES`、`REACTION_COLORS`、`REACTION_TAG = 'reaction'`、`DetonateOutcome`（`ReactionId | 'collapse'`）、`StatusApplyOpts`（`depth / weaponUid / reactionScale`）、`TriggerReactionOpts`（`depth / weaponUid / point / ignoreIcd / fixedBase / scale / tag`）、`DetonateOpts`（`power / mult / depth / weaponUid / point`）。
  - `DamageResult.reaction?: ReactionId | null`（可选：BossBase.ts 与 Bomber.ts 手写了字面量）。
  - `GameEvents['enemy:reaction']`：`{ enemy, reaction, point, base, depth, hits, weaponUid?, origin: 'status' | 'detonate' | 'forced', tag?, centerKilled, stunned }`。
  - `ICombat.applyStatus` 增加可选 `opts?: StatusApplyOpts`；新增 `triggerReaction(enemy, id, power, opts?) => boolean` 与 `detonate(enemy, opts) => DetonateOutcome | null`（都只入队，不同步造成伤害）。
  - `DamageNumberOpts.kind` 增加 `'reaction'`，并追加 `text? / color? / big?`。
  - `WeaponDescription.elementLabel?: string`（特殊元素显示，如「三相」）；`IWeaponSystem.chargeProgress?: number`（蓄力进度 0..1）。
- `core/Stats.ts`：`BASE_STATS` 与 `STAT_INFO` 追加「反应伤害」「反应急速」（均为 pct）。
- 编译桩：`Combat.triggerReaction` 返回 `false`、`Combat.detonate` 返回 `null`、`applyStatus` 透传 `opts.depth`；`DamageNumbers` 的 `Kind` 加 `'reaction'`。反应系统流随后替换为正式实现。
- weapons 模块内部共享接口：`FireMode` 加 `'charge'`；`ProjectileParams.bounces`（默认 0）；`WeaponDef` 加 `innate / cycle / chargeTime / chargeMinMult / chargeFullPierce / chargeDetonate / dropWeight`（默认 `[] / null / 0 / 0.2 / 0 / false / 1`）；`WeaponRuntime` 加 `cycleIndex / rxnHasteUntil`；`ResolvedWeapon.rxnHaste`。
- `ui/labels.ts`：`WEAPON_NAMES` 追加 6 把新武器（之后任何流都不改）。
- 约定：`run.flags['rx:<reactionId>']` 由 UI 写入，表示本局已提示过该反应（每局新建 RunState 自动重置）。
- 新文件：`combat/Reactions.ts`（ReactionSystem）、`progression/scrolls/defsReaction.ts`（24 个反应秘卷）、`ui/ReactionTips.ts`（反应首次提示）。

#### 变更记录：魔刀千刃（`docs/demon-blade.md` 第 10 节）

契约阶段一次性落地（清单见设计稿 10.12），全部为可选字段 / 新键 + 编译桩，向后兼容，现有 17 把武器行为不变；之后逻辑（L）、表现（V）、玩家·HUD·音效·文档（P）三条流并行实现。

- `core/types.ts`
  - `ProjectileVisual` 追加 `'blade'`（旋转飞刃，细拖尾）。
  - `SfxId` 追加 `blade_swing / blade_hit / blade_throw / blade_recall / blade_morph / blade_dash / blade_impale`（挥砍破风 / 斩击命中 / 飞刃投掷 / 召回 / 变形 / 突进 / 千刃贯穿）。
  - `GameEvents` 追加 `'weapon:formChanged' { weapon, form }`（变形**开始**时派发，`form` 为目标形态）与 `'weapon:skillUsed' { weapon, skillId }`。
  - `IPlayer` 追加 `isLunging`、`lunge(dir, dist, time, iframes?, exitSpeed?) => boolean`、`cancelLunge()`：受控突进沿水平方向匀速移动，走正常碰撞（被墙挡住提前结束）、期间忽略移动 / 冲刺 / 跳跃输入、竖直速度为 0；`iframes > 0` 时 `invulnerableTime = max(当前, iframes)`；结束时水平速度 = `dir × exitSpeed`；新的覆盖进行中的，teleport / 死亡 / 新开一局结束它。
  - 新类型 `WeaponForm = 'melee' | 'ranged'`、`WeaponSkillState { id, name, glyph, key, cooldownRemaining, cooldownTotal, active }`（复用对象，读取后不要保存引用）。
  - `IWeaponSystem` 追加可选 `activeForm / formMorphProgress / formStrikeTime / weaponSkill`（未实现时 UI 按普通武器显示）；`WeaponDescription` 追加 `formNames? / skill? { name, key, description, cooldown }`。
  - 新接口 `IBladeFx`（`slashArc / slashHit / mark / impale / dashTrail / recall`）与必填的 `IFx.blade`。
- `core/Input.ts`：`Action` 追加 `'weaponSkill'`（`KeyV` + 鼠标中键 `button 1`）；中键 `mousedown` / `auxclick` `preventDefault`（防浏览器自动滚动 / 中键粘贴）。
- `combat/Projectiles.ts`：敌方投射物在玩家 `(isDashing || isLunging) && invulnerableTime > 0` 时穿身而过；`'blade'` 投射物的细拖尾。
- weapons 模块内部共享接口：`FireMode` 加 `'melee'`（只由 `formMode()` 返回，不写在任何 def 上）、`WeaponKind` 加 `'blade'`、`ReloadStyle` 加 `'recall'`；`ProjectileParams.fanFixed`（默认 `false`）；`MeleeSegment / MeleeParams / WeaponSkillParams`；`WeaponDef` 加 `melee / skill / recall / perProjectileAmmo`（默认 `null / null / false / false`）与 `isDualForm / formMode / comboCycleTime`；`ResolvedWeapon.damageMult / meleeElementChance`；`WeaponRuntime.form`；`ViewmodelState` 加 `form / morphT / swing / swingP / swingHitP / blades / bladesMax / skillT / strikeT`（`createViewmodelState()`）与 `onSlash / onSlashHit`。
- 编译桩（各流随后替换）：`PlayerController.lunge` 返回 `false`（技能原地结算）、`Fx.blade` 为空实现、`'blade'` 暂用 shard 外观、7 个占位音色。
- `ui/labels.ts`：`WEAPON_NAMES.demon_blade`；`CONTROLS` 右键说明补「持魔刀千刃时切换形态」，新增 V / 中键「武器技能」。
- 约定：武器技能冷却全局一条（WeaponSystem 持有，换关保留、开新局清零）；HUD 只读 `IWeaponSystem` 的可选字段，不 import weapons 模块。
