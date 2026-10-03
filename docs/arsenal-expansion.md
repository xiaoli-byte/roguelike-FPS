# 灵火破晓 · 武器库扩充与元素反应（最终设计）

> 本文是「扩充武器库资源，多加一些能产生不同化学反应的词条、秘卷」的最终设计与实现规格。
> 实现者照本文施工，不需要再做设计决策。玩家可见文字一律使用文中给出的简体中文原文。
> 数值单位：米 / 秒；`S` = 关卡强度系数（见 1.2）；`B` = 反应威力（见 2.3）。

---

## 0. 概览

### 0.1 规模

| 内容 | 数量 | 说明 |
|---|---|---|
| 元素反应 | 3 种两两反应 + 1 种三元素反应 | 焚雷、熔金、封脉 + 归墟；另有「引爆」动作（不是新反应） |
| 新武器 | 6 把 | 只有 2 把需要新开火机制：三才转轮（元素轮转）、贯虹灵炮（蓄力） |
| 新词条 | 10 个 | 其中 3 个副元素词条兼作新武器的固有词条 |
| 新传说特性 | 4 个 | 合璧、轮回、涅槃、鼎沸 |
| 新秘卷 | 24 个 | 普通 5 / 精良 4 / 稀有 9（含英雄专属 3）/ 史诗 4 / 传说 2 |
| 新属性 | 2 个 | `reactionDamagePct` 反应伤害、`reactionHaste` 反应急速 |

### 0.2 一句话规则（给玩家）

- **两种元素在同一个敌人身上相遇，就会发生反应**：灼烧 × 雷殛 =「焚雷」，灼烧 × 蚀化 =「熔金」，雷殛 × 蚀化 =「封脉」。
- **三种元素同时在身上，再补任何一种，就会坍缩成「归墟」**。
- 反应不会消耗两两相遇的状态（只有「归墟」会引燃灼烧、导走雷殛），所以叠元素永远不亏。
- **引爆**：贯虹灵炮满蓄、「破势」词条、「点穴」秘卷可以主动引爆敌人身上已有的元素。

### 0.3 流派与英雄

| 流派 | 核心反应 | 推荐英雄 | 起手武器 | 核心词条 / 传说 | 核心秘卷 |
|---|---|---|---|---|---|
| 雷火流（清群） | 焚雷 | 赤狐（火技能） | 青冥雷蛊、雷弧发射器、任意带「副·雷」的枪 | 副·雷、化合、疾化 | 雷火符、引雷、爆焰、焚天雷狱、狐火引雷 |
| 熔金流（破甲 + 区域） | 熔金 | 岩熊 | 赤蛟霰铳、朱雀吐息 | 副·蚀、回元、化盾 | 熔金符、引火、熔铸、金乌坠、熔岩撼地 |
| 封脉流（破盾 + 控场） | 封脉 | 雷隼（雷技能） | 蚀蛊灯、青冥雷蛊 | 副·蚀、蛊种 | 封脉符、引蚀、锁灵、镇岳、蚀羽惊雷 |
| 三相流（单体爆发） | 归墟 | 任意 | 三才转轮、带「轮回」的任意枪 | 轮回、乘隙 | 三才印、归真、劫火 |
| 引爆流（物理也能玩反应） | 任意 | 岩熊 / 雷隼 | 贯虹灵炮、赤铜左轮 | 破势、合璧、涅槃 | 点穴、化元、混元 |

---

## 1. 总则与术语

### 1.1 附着深度 depth

沿用现有 `procDepth` 约定：武器 / 技能直接命中 = 0，衍生伤害 ≥ 1。

- 只有 **depth < 2** 的元素附着能引发反应（`MAX_REACTION_DEPTH = 2`）。
- 反应自身造成的伤害一律 `procDepth = depth + 1`、`source: 'status'`，所以不会再附着元素，也就不会自激。
- 反应「扩散出去的元素」（焚雷点燃周围、熔池附蚀、封脉导流）以 `depth + 1` 附着，可以再引发**最多一级**连锁反应。
- 雷殛弹射仍只在 depth = 0 时触发（现有规则不变）。

### 1.2 关卡强度系数 S

`S = 1 + max(0, run.difficulty − 1) × 0.85`（与 `ScrollKit.procScale` 相同）。第一章 1.00–1.41，第二章 1.77–2.17，第三章 2.53–2.94。Combat 内自己按此公式计算，不 import 秘卷模块。

### 1.3 附着强度 Pin

`Pin` = 引发反应的那次附着的 `power`：

- 来自伤害管线第 4 步：`min(这一击实际伤害 effective, 敌人最大生命 × 0.5)`（与现有 power 规则一致）。
- 来自 `ctx.combat.applyStatus`：传入的 power，同样钳到最大生命 × 0.5。

### 1.4 反应伤害请求（统一格式）

```ts
{ base, element, source: 'status', canCrit: false, procDepth: p.depth + 1,
  tags: ['reaction', <reactionId>] /* 熔池跳伤为 ['reaction','meltdown','dot']；崩解为 ['reaction','collapse'] */,
  weaponUid: <来源武器>, point, direction?, knockback? }
```

倍率规则（`DamageCalc.statMultiplier`）：**带 `reaction` 标签时只乘 `stats.mult('reactionDamagePct')`**，不再乘 damagePct / 元素伤害 / 精英 / 首领属性——`Pin` 已经包含这些，避免二次相乘。

照常生效的：outgoing 修饰器（词条「化合」「鼎沸」、各反应符、狐狸被动「余烬」等）、`enemy.damageTakenMult`（蚀化 ×1.2）、雷殛标记 ×1.15（雷属性反应段）、封脉首领易伤、元素 × 层倍率（`LAYER_MULT`）。

不会发生的：暴击、吸血、元素附着、触发命中类词条 / 秘卷（它们只认 `source === 'weapon'`）。

`DamageCalc.isDot` 改为排除 `reaction` 标签（带 `dot` 的除外），所以反应伤害有命中火花、命中音效和「免疫」提示。

### 1.5 归属

反应的 `weaponUid` 取自：伤害管线第 4 步的 `req.weaponUid`，或 `applyStatus` 的 `opts.weaponUid`。技能、秘卷、持续伤害引发的反应没有武器归属——「本武器引发」类词条只认有归属的反应（文案已写明「本武器」）。

---

## 2. 元素反应

### 2.1 触发与判定

判定入口统一为 Combat 的私有方法 `attach(enemy, sid, power, depth, src, killed, duration?)`，它替换两处原有入口：

1. `damageEnemy` 第 4 步（`Combat.ts` 原 126–144 行）；
2. `applyStatus`（原 355 行）的 burn / shock / corrode 分支（stun / slow 直接走 `status.apply`）。

`attach` 先调用 `ReactionSystem.tryReact(...)`，**再**照常调用 `status.apply`（必须在 apply 之前判定：雷殛第 3 层会自删并眩晕；击杀那一击状态还没清空）。

`tryReact(enemy, incoming, pin, depth, src, killed)` 的判定顺序：

1. 拒绝：`depth >= 2`；`incoming` 不是 burn/shock/corrode；敌人已不存活且 `killed === false`；本帧已接受 8 次反应；待执行队列已满 32 条。
2. `others` = 敌人身上 burn/shock/corrode 中**除 incoming 以外**存在的状态。为空 → 不反应。
3. **归墟**：`others.length === 2`（另外两种都在）且 `!killed` 且该敌人的归墟冷却就绪 → 引发归墟。
4. **两两反应**：对 `others` 中每个状态 Y，组合 (incoming, Y) 对应的反应若冷却就绪即为候选；按优先级 **焚雷 > 熔金 > 封脉** 取第一个。
5. 都不满足 → 不反应，incoming 照常附着。

每次附着最多引发 1 个反应。反应判定成功后：记录冷却、（仅归墟）消耗状态、clone 反应中心点、入队、写 `result.reaction`，然后 incoming **照常附着**（击杀那一击仍只做雷殛弹射）。

### 2.2 状态消耗

| 反应 | 消耗 | 说明 |
|---|---|---|
| 焚雷 / 熔金 / 封脉 | **不消耗任何状态** | 保证两两反应纯增益；频率由逐敌冷却封顶 |
| 归墟 | 消耗身上已有的**灼烧**与**雷殛**，蚀化保留 | 被消耗的灼烧立刻「结清」剩余伤害（见下），不白丢 |

灼烧结清：`cash = Σ灼烧各层强度 × 0.22 × ceil(剩余秒数 / 0.5)`，在归墟执行时以一次**普通持续伤害请求**打出：`{ base: cash, element: 'fire', source: 'status', canCrit: false, procDepth: depth + 1, weaponUid }`（不带任何标签，吃元素加成、不吃反应加成，和原本的灼烧跳伤完全等价）。雷殛被消耗没有结清值。

> 设计依据：模拟发现，若两两反应消耗灼烧，赤狐燃爆雷这类「持续刷新、叠满 3 层」的灼烧会被反复打断，单体输出净亏 20–30%（见第 8 节）。因此两两反应一律不消耗。

### 2.3 威力公式与参数

```
B = clamp(k × Pin, 下限 × S, 上限 × S) × scale
```

- `scale`：附着时 `opts.reactionScale`（缺省 1；传说「万象」附着传 0.6）；强制反应 `opts.scale`。
- 强制反应传了 `opts.fixedBase` 时，`B = fixedBase`（不 clamp）。
- 实际冷却 = `基础冷却 / (1 + stats.get('reactionHaste'))`，最低 0.3 秒。逐敌人、逐反应各自计时。

| id | 名称 | 组合 | k | 下限 | 上限 | 基础冷却 | 颜色 | 定位 |
|---|---|---|---|---|---|---|---|---|
| `thunderfire` | 焚雷 | 灼烧 + 雷殛 | 1.0 | 14S | 80S | 1.0 秒 | `0xffd84a` | 清群爆燃 |
| `meltdown` | 熔金 | 灼烧 + 蚀化 | 1.0 | 14S | 100S | 1.2 秒 | `0xff7a1a` | 破甲 + 熔池 |
| `veinseal` | 封脉 | 雷殛 + 蚀化 | 1.0 | 14S | 90S | 1.2 秒（实测后由 1.5 下调；眩晕另有 3.5 秒独立冷却，不吃急速） | `0x5affd0` | 破盾 + 控场 + 导流 |
| `abyss` | 归墟 | 三种齐聚 | 1.5 | 40S | 320S | 6.0 秒 | `0xc89bff` | 单体爆发 |

记号：`r(x)` = `x × stats.mult('explosionRadiusPct')`（反应范围吃爆炸范围属性）。

### 2.4 四种反应

#### 焚雷 thunderfire（灼烧 ⇄ 雷殛）

执行（flush 时）：
1. 中心 `c` = 敌人存活时取其当前身体中心，否则取入队时 clone 的点。
2. 中心伤害：敌人存活且非击杀那一击时，`damageEnemy(enemy, req(B, 'fire'))`。
3. 爆炸：`explode(c, r(3.0), req(0.6B, 'fire', knockback 7), { exclude: {中心敌人}, falloff: 0.6, noFx: !bigFx(), color: 0xffd84a })`。
4. 扩散：对 `queryRadius(c, r(3.0))` 中除中心外的存活敌人（先拷贝列表），以 `attachFromReaction(e, 'burn', 0.2B, depth + 1, weaponUid)` 附着灼烧。这些敌人若带雷殛 → 次级焚雷；若带蚀化 → 熔金（受冷却限制）。
5. 表现：
   - `explode` 未获大特效预算时补 `fx.burst(c, 0xffd84a, 18, 7, 0.45, 0.13, 2)` + `fx.ring(地面点, r(3.0), 0xffd84a, 0.4)`；
   - 从 `c` 到被爆炸命中的敌人画 `fx.lightning(c, 敌人中心, 0x6fd8ff)`，最多 4 道；
   - 音效 `shock_zap`（volume 0.5，pitch 1.1，position c）；大特效时 `explode` 自带 `explosion` 音效与屏震；
   - 浮字「焚雷」，颜色 `#ffd84a`。

#### 熔金 meltdown（灼烧 ⇄ 蚀化）

1. 中心伤害：敌人存活且非击杀时，`damageEnemy(enemy, req(B × (enemy.armor > 0 ? 2 : 1), 'corrode'))`。叠加蚀化对护甲 ×1.6，实际对护甲约 ×3.2（有意近似：打穿护甲后溢出到生命的部分同样按 ×2 计）。
2. 熔池：中心为敌人脚底（`position.y + 0.05`），半径 `r(2.5)`，持续 3 秒，`ctx.tasks.every(0.5, tick, 3)` 驱动（非常驻，换关自动清除），共 6 跳：
   - 每跳对 `queryRadius(池心, 半径)`（先拷贝）内存活敌人造成 `req(0.12B, 'fire')`，标签 `['reaction','meltdown','dot']`；
   - 每个敌人**第一次**被某个熔池跳到时，`attachFromReaction(e, 'corrode', 0.25B, depth + 1, weaponUid)`（用池对象内的 `WeakSet` 记录）；
   - 全场同时最多 4 个熔池，第 5 个生成时把最旧的标记为结束（tick 回调见到标记即返回 `true` 结束）。
3. 表现：
   - 生成：`fx.burst(c, 0xff7a1a, 14, 4, 0.6, 0.14, 12)` + `fx.burst(c, 0x9dff4a, 8, 2.5, 0.7, 0.1, 8)`；音效 `skill_fire`（0.55，pitch 0.75）+ `corrode_tick`（0.7）；
   - 每跳：`fx.ring(池心, 半径, 0xff7a1a, 0.5)`，再在池内随机点 `fx.burst(·, 0xffa040, 4, 1.5, 0.6, 0.1, −3)`（每跳最多 2 簇，纯视觉随机用 `Math.random`）；每 2 跳一次 `burn_tick`（0.3）；
   - 浮字「熔金」，颜色 `#ff7a1a`。

#### 封脉 veinseal（雷殛 ⇄ 蚀化）

1. 中心伤害：敌人存活且非击杀时，`damageEnemy(enemy, req(B × (enemy.shield > 0 ? 2 : 1), 'shock'))`，叠加雷殛对护盾 ×1.6，实际对护盾约 ×3.2。
2. 控制（敌人存活且非击杀）：
   - 非首领：若该敌人 `sealStun` 冷却就绪（3.5 秒，不吃急速）→ `status.apply(enemy, 'stun', 0, 0.7, depth + 1)`（精英由 StatusSystem 自动 ×0.75），记 `stunned = true`；无论是否眩晕都 `status.apply(enemy, 'slow', 0.4, 3, depth + 1)`。
   - 首领：不眩晕、不减速，改为「脉滞」：4 秒内受到玩家方所有伤害 ×1.12（`ReactionSystem.vulnMult(enemy)`，在 Combat 第 2 步与 `previewMultiplier` 中乘入）。
3. 导流：取 8 米内（以 `c` 为圆心）除中心外最近的 3 名存活且 `lineClear(world, c, 敌人中心)` 的敌人，每名：`fx.lightning(c, 敌人中心, 0x5affd0)`；`damageEnemy(e, req(0.3B, 'shock'))`；`attachFromReaction(e, 'corrode', 0.35B, depth + 1, weaponUid)`。
4. 表现：`fx.ring(地面点, 1.6, 0x5affd0, 0.35)` 两次，间隔 0.1 秒（`ctx.tasks.delay`）；头顶 `fx.burst(头顶, 0x5affd0, 10, 2, 0.5, 0.08, 0)`；音效 `skill_shock`（0.5，pitch 0.8）+ `shock_zap`（0.6，pitch 0.7）；浮字「封脉」，颜色 `#5affd0`。

#### 归墟 abyss（三相齐聚）

1. 判定时（`tryReact` 内，同步）：
   - 消耗：对 `others` 中的 burn 调 `status.consume(enemy, 'burn')` 得 `cash`；对 shock 调 `status.consume(enemy, 'shock')`；蚀化保留。
   - 收束预警：`fx.groundWarning(地面点, 1.6, 0.35, 0xc89bff)` + 音效 `telegraph`（0.5，pitch 1.4）。
   - 入队时间 `at = now + 0.35`（连锁时再 +0.15）。
2. 执行（flush）：
   - `cash > 0` 且敌人存活：按 2.2 打出结清伤害。
   - 敌人存活：三段伤害各 `B / 3`，元素依次 `fire`、`shock`、`corrode`（每段自动吃到最有利的层倍率：雷打盾、蚀打甲、火打血）。
   - 余波：`explode(c, r(3.0), req(敌人已死 ? 0.6B : 0.3B, 'none', knockback 9), { exclude: {中心}, falloff: 0.6, noFx: !bigFx(), color: 0xc89bff })`。
   - 不扩散元素（归墟是终点）。
3. 表现：从 `c + (0, 7, 0)` 劈下 3 道 `fx.lightning`，颜色依次 `ELEMENT_COLORS.fire / shock / corrode`；`fx.ring(地面点, 3, 0xc89bff, 0.5)`；`fx.shake(0.3, 0.25)`；音效 `hit_crit`（0.8）；浮字「归墟」，颜色 `#c89bff`，大号（`big: true`）。

### 2.5 引爆 `ICombat.detonate(enemy, opts)`

来源：贯虹灵炮满蓄命中、词条「破势」、秘卷「点穴」。**只入队，不同步造成伤害**。

1. 拒绝（返回 `null`）：敌人不存活；`depth >= 2`；该敌人引爆冷却（0.5 秒）未就绪；身上没有 burn/shock/corrode；帧预算或队列已满。
2. `pin = min(opts.power, 最大生命 × 0.5) × (opts.mult ?? 1)`；记录引爆冷却。
3. 三种齐聚且归墟冷却就绪 → 引发归墟（消耗规则同 2.2，origin `'detonate'`），返回 `'abyss'`。
4. 身上有 ≥ 2 种：在「身上已有状态两两组合」中按优先级取第一个**冷却就绪**的反应 → 引发（设置冷却），返回其 id。
5. 否则（只有 1 种，或组合都在冷却）→「崩解」，返回 `'collapse'`：选状态优先级 灼烧 > 蚀化 > 雷殛：
   - 灼烧：`min(0.3 × 灼烧剩余伤害, 30S) × mult` 的火焰伤害；
   - 蚀化：`min(0.3 × 蚀化剩余伤害, 30S) × mult` 的蚀化伤害（蚀化剩余 = `power × 0.08 × ceil(剩余秒 / 0.5)`）；
   - 雷殛：`min(0.5 × 雷殛 power, 30S) × mult` 的雷电伤害，再 `status.chainFrom(enemy, 雷殛 power, depth)` 重新弹射一次；
   - 崩解**不消耗状态**，标签 `['reaction','collapse']`（吃反应伤害加成），**不派发** `'enemy:reaction'`；
   - 表现：`fx.burst(中心, 元素色, 14, 6, 0.3, 0.1, 0)` + `fx.ring(地面点, 1.5, 0xffffff, 0.25)`；音效 `hit_crit`（0.8，pitch 0.8）；浮字「崩解」，颜色取元素色。

### 2.6 强制反应 `ICombat.triggerReaction(enemy, id, power, opts?)`

供「涅槃」「蛊种」「劫火」使用：

- 不需要、也不消耗元素状态；`power` 作为 `Pin` 代入 2.3 公式（`fixedBase` 时直接作为 B）。
- 拒绝（返回 `false`）：`depth >= 2`；帧预算或队列已满；敌人存活、未传 `ignoreIcd` 且该反应冷却未就绪。敌人存活且未传 `ignoreIcd` 时会设置冷却。
- 敌人可以已死亡（此时必须传 `opts.point`；中心伤害跳过，范围部分照常）。
- 入队延迟：`depth > 0` 时 +0.15 秒；归墟再 +0.35 秒收束（同样有预警）。
- 派发事件时 `origin: 'forced'`，`tag` 透传。

### 2.7 连锁、防递归与预算

- 深度：直接命中（0）引发的反应扩散元素为 depth 1，可再引发一级连锁；连锁扩散的元素为 depth 2，不再反应。
- `tryReact` / `detonate` / `triggerReaction` 都只入队；效果在 `Combat.update()` 开头的 `reactions.flush()` 执行。flush 处理的是队列快照，执行中新产生的条目进入下一批。
- 连锁条目（depth ≥ 1）入队时 `at = now + 0.15`，让连锁节奏看得清。
- 预算：每帧最多**接受** 8 次反应（含引爆、强制；超出的不反应，元素照常附着）；每帧 `fx.explosion` 最多 3 个（`bigFx()`，超出走 `noFx: true` + burst/ring）；浮字每帧最多 4 个、同一敌人 0.3 秒一次；熔池同时最多 4 个；队列上限 32。
- 击杀那一击：可以引发两两反应（中心伤害与控制跳过，爆炸 / 熔池 / 导流照常）；不引发归墟。
- 反应造成的击杀，request 的 depth ≥ 1：野火燎原、蚀爆、连环爆、`lg_nova` 等原有连锁按它们自己的 `depth < 2` 规则处理，最多一级。
- `ReactionSystem.clear()`（Combat.clear 调用）：清空队列、冷却 / 脉滞 WeakMap、熔池列表与帧计数。

### 2.8 事件与时序

- `result.reaction`：在第 4 步写入，早于 `enemy.onDamaged` 与 `'enemy:damaged'`。
- `'enemy:reaction'`：在 flush 中**效果执行完毕后**派发，已在伤害管线之外——监听者可以直接造成伤害、施加状态、生成投射物。`point` 是复用向量，需要保存（例如延时任务）时必须 `clone()`。
- 载荷：`{ enemy, reaction, point, base: B, depth, hits, weaponUid?, origin: 'status' | 'detonate' | 'forced', tag?, centerKilled, stunned }`（`stunned` 仅封脉眩晕成功时为 true；`hits` = 受到本次反应伤害的敌人数）。
- 调用安全：`applyStatus` / `detonate` / `triggerReaction` 都不会同步造成伤害，**可以在任意事件回调里同步调用**；在 `'enemy:damaged'` / `'enemy:killed'` / `'enemy:statusApplied'` 回调里要**造成伤害**时，仍按惯例包进 `ctx.tasks.delay(0, …)`。
- 更新顺序 weapons → projectiles → combat：武器命中引发的反应在同一帧内就能看到效果。

### 2.9 表现汇总

| 反应 | 浮字 | 颜色 | 关键特效 | 音效 |
|---|---|---|---|---|
| 焚雷 | 焚雷 | `#ffd84a` | 金色爆炸 + 雷弧连向被炸敌人 | explosion + shock_zap |
| 熔金 | 熔金 | `#ff7a1a` | 熔滴 + 蚀液 + 熔池光环与上升火星 | skill_fire + corrode_tick，池内 burn_tick |
| 封脉 | 封脉 | `#5affd0` | 双层收紧光环 + 青色导流电弧 | skill_shock + shock_zap |
| 归墟 | 归墟（大号） | `#c89bff` | 紫色预警圈 → 三色天雷 + 光环 + 屏震 | telegraph → explosion + hit_crit |
| 崩解 | 崩解 | 元素色 | 白环 + 元素爆散 | hit_crit |

不新增任何 SfxId / StatusId / Element / ProjectileVisual。

---

## 3. 新武器（6 把）

### 3.0 共用新字段（`WeaponDef`，weapons 模块内部，已在契约阶段预落地）

| 字段 | 默认 | 含义 |
|---|---|---|
| `innate: { id: string; value: number }[]` | `[]` | 固有词条：`rollAffixes` 生成实例时原样放到 `affixes` 最前面，不占词条名额、不随稀有度放大、同 id 不会再被抽到 |
| `cycle: Element[] \| null` | `null` | 元素轮转（新机制 A） |
| `chargeTime` / `chargeMinMult` / `chargeFullPierce` / `chargeDetonate` | 0 / 0.2 / 0 / false | 蓄力（新机制 B） |
| `dropWeight: number` | 1 | `roll()` 不指定 defId 时的抽取权重 |
| `ProjectileParams.bounces: number` | 0 | 撞墙反弹次数，透传给 `ProjectileSpec.bounces`（引擎已支持反射与贴地滚动） |

`FireMode` 新增 `'charge'`。新武器都在 `WEAPON_DEFS` 末尾追加；`WEAPON_IDS` 自动派生，自动进入宝箱、商店、首领奖励与 F4 掉落。每把都要在 `WeaponModels.ts` 的 `PALETTES` 与 `BUILDERS` 登记（漏写会退化成步枪模型）。

持续 DPS 一律按「普通稀有度、无加成、身体命中、含换弹」计算：`伤害 × 弹丸 × 弹匣 ÷ (弹匣 ÷ 每秒发数 + 换弹)`。

| id | 名称 | 类别 | 模式 | 持续 DPS | 元素 | 角色 | dropWeight |
|---|---|---|---|---|---|---|---|
| `flamer` | 朱雀吐息 | 喷火器 | auto（投射物） | 69.1/目标，穿透 3 | 火 | 群体灼烧施加器 | 1 |
| `stormpod` | 青冥雷蛊 | 发射器 | semi（弹跳榴弹） | 71.3/爆心 | 蚀 + 固有雷 | 群体封脉引擎 | 1 |
| `magmashot` | 赤蛟霰铳 | 霰弹枪 | semi（双管） | 80.0 | 火 + 固有蚀 | 熔金破甲 | 1 |
| `trinity` | 三才转轮 | 手枪 | semi + 元素轮转 | 66.3 | 火→雷→蚀 | 归墟引擎 | 0.8 |
| `railgun` | 贯虹灵炮 | 蓄能炮 | charge | 满蓄 86.1 | 物理 | 引爆器 | 0.8 |
| `lantern` | 蚀蛊灯 | 蛊灯 | semi（慢速追踪） | 62.9（含蚀化约 75） | 蚀 + 固有蛊种 | 传染者 | 0.8 |

反应引擎类武器裸 DPS 压在 63–71，低于单体精准类，用差额换取反应潜力；贯虹灵炮必须蓄满才划算。

### 3.1 朱雀吐息 `flamer`

```ts
def({
  id: 'flamer', name: '朱雀吐息', category: '喷火器', kind: 'heavy', mode: 'auto',
  damage: 7.5, fireRate: 14, mag: 70, reserve: 280, reloadTime: 2.6, reloadStyle: 'cell',
  spreadHip: 0.05, spreadAim: 0.035, spreadPerShot: 0, spreadMax: 0.05, spreadRecovery: 0.3,
  recoil: { pitch: 0.0012, yaw: 0.0015, bias: 0, climb: 0 },
  critMult: 1.5, range: 11, pierce: 3,
  projectile: { speed: 24, gravity: -3, radius: 0.32, lifetime: 0.42, visual: 'flame', scale: 1.1, color: 0xff7a2a },
  element: 'fire', elementChance: 0.08, aimFov: -6, sfx: 'shot_beam', sfxVolume: 0.3, knockback: 0,
  tracerWidth: 0, impactSize: 0.4, kick: { back: 0.004, rot: 0.006 }, shake: 0.012, flash: 0.09,
  viewOffset: [0.24, -0.25, -0.54], aimOffset: [0.12, -0.2, -0.48], worldScale: 1.3,
  description: '朱雀衔火的喷焰枪，烈焰扑面，贯穿成群之敌。',
  notes: ['近距离持续喷射火焰，射程约 10 米', '火焰可贯穿 3 名敌人'],
}),
```

- DPS：7.5 × 70 ÷ (5 + 2.6) = 69.1（每个目标）；附着 0.08 × 14 = 1.12 次/秒/目标。射程 ≈ 24 × 0.42 ≈ 10 米，负重力让火舌上飘；`flame` 造型随寿命放大并淡出。
- 手感：贴近敌群「扫」过去。`shot_beam` 不带 position 播放 → 自动变成持续嗡鸣（AudioSystem 已支持）。
- 反应角色：自身只有火，靠高频把整群点燃；配雷隼信标 / 青冥雷蛊即成焚雷 / 熔金燃料。
- 模型 `buildFlamer`，`PALETTES.flamer = { body: 0x8a2a1a, dark: 0x2a1a14, accent: 0xffb03a, grip: 0x3a2a20 }`：
  - 枪身 `box(body, 0.07, 0.07, 0.32, 0, 0.02, −0.12)`；稀有度条 `box(rarity, 0.004, 0.008, 0.2, ±0.036, 0.02, −0.12)`。
  - 喷口 `cyl(dark, 0.022, 0.16, 0, 0.03, −0.36, 'z', 10, 0.034)`（−Z 端外扩）；三道 `ring(r, accent色, 0.03, 0.012, 0, 0.03, z)`，z = −0.30 / −0.34 / −0.38。
  - 朱雀头罩 `box(accent, 0.05, 0.03, 0.06, 0, 0.065, −0.33, 0.3)`；冠羽两片 `box(accent, 0.008, 0.03, 0.02, ±0.012, 0.085, −0.31, −0.4)`。
  - 引火苗 `cyl(energyMat, 0.006, 0.02, 0, −0.005, −0.41, 'y', 6)`。
  - 燃料罐 `m.mag = group(r, 0, −0.07, −0.05)`：`cyl(body, 0.035, 0.18, 0,0,0, 'z', 10)` + 两道 `cyl(dark, 0.037, 0.012, 0, 0, ±0.06, 'z', 10)` + 油量窗 `box(energyMat, 0.012, 0.03, 0.08, 0.036, 0, 0)`。
  - 后握 `pistolGrip(r, grip, −0.06, 0.06, 0.11, −0.25)`、`trigger(r, 0.02)`；前竖握 `box(grip, 0.025, 0.07, 0.03, 0, −0.04, −0.22)`，`m.leftHand = (0, −0.06, −0.22)`。
  - `m.muzzle.position = (0, 0.03, −0.45)`。

### 3.2 青冥雷蛊 `stormpod`

```ts
def({
  id: 'stormpod', name: '青冥雷蛊', category: '发射器', kind: 'launcher', mode: 'semi',
  damage: 95, fireRate: 1.2, mag: 5, reserve: 30, reloadTime: 2.5, reloadStyle: 'cylinder',
  spreadHip: 0.012, spreadAim: 0.005, spreadPerShot: 0.012, spreadMax: 0.03, spreadRecovery: 0.1,
  recoil: { pitch: 0.04, yaw: 0.008, bias: 0, climb: 0 },
  critMult: 1.6, range: 90, element: 'corrode', elementChance: 0.6,
  projectile: { speed: 30, gravity: 14, radius: 0.15, explosionRadius: 3.2, lifetime: 1.8, visual: 'orb', scale: 0.9, bounces: 2, explodeOnExpire: true, color: 0x9dff4a },
  innate: [{ id: 'subShock', value: 0.4 }],
  aimFov: -10, sfx: 'shot_launcher', sfxVolume: 0.8, knockback: 4,
  tracerWidth: 0, impactSize: 0.9, kick: { back: 0.06, rot: 0.12 }, shake: 0.13, flash: 0.2,
  viewOffset: [0.23, -0.24, -0.52], aimOffset: [0.08, -0.17, -0.44], worldScale: 1.4,
  description: '以青铜蛊罐封存雷蛊与蚀毒的弹跳榴弹，落地翻滚，炸开一片青雷。',
  notes: ['蛊弹撞墙反弹 2 次，触敌或 1.8 秒后爆炸', '蚀雷双属，易引发「封脉」'],
}),
```

- DPS：95 × 5 ÷ (4.17 + 2.5) = 71.3（爆心，边缘衰减到 50%）。爆炸范围内每个敌人各自判定：蚀化 0.6、固有雷殛 0.4。
- 正重力 + fan 0 → Firing 自动做抛物线补偿；撞墙反弹，低速落地后贴地滚动，到期必定爆炸。
- 依赖：词条流修复爆炸武器的 `isWeaponReq`（第 4 节），否则固有雷殛对爆炸伤害无效。
- 模型 `buildStormpod`，`PALETTES.stormpod = { body: 0x2f4a3a, dark: 0x1a2620, accent: 0xb08a3a, grip: 0x3a3026 }`：
  - 炮管 `tube(r, dark色, 0.04, 0.2, 0, 0.04, −0.2, 12)`；管口内辉 `cyl(energyMat, 0.03, 0.01, 0, 0.04, −0.29, 'z', 12)`。
  - 蛊罐转鼓 `drum = group(r, 0, 0.03, −0.03)`：`cyl(body, 0.05, 0.09, 0,0,0, 'z', 10)`；5 个罐包 `cyl(energyMat, 0.012, 0.095, cos(a)·0.033, sin(a)·0.033, 0, 'z', 6)`（a = i/5·2π）。`m.cylinder = m.mag = drum`，`m.cylinderSteps = 5`。
  - 符纸 `box(solidMat(0xe8d9a0, 0, 0.9), 0.025, 0.05, 0.002, 0.055, 0, −0.05, 0, 0, 0.15)` + 朱印 `box(glowMat(0xd23a2a), 0.008, 0.008, 0.003, 0.0555, −0.012, −0.05)`。
  - 顶部青铜导轨 `box(accent, 0.012, 0.008, 0.22, 0, 0.088, −0.12)`；稀有度条 `box(rarity, 0.004, 0.008, 0.12, ±0.03, −0.01, −0.15)`。
  - `pistolGrip(r, grip, −0.06, 0.05, 0.11, −0.3)`、`trigger(r, 0)`；前握 `box(grip, 0.024, 0.05, 0.03, 0, −0.03, −0.2)`，`m.leftHand = (0, −0.03, −0.2)`。
  - `m.muzzle = (0, 0.04, −0.31)`。

### 3.3 赤蛟霰铳 `magmashot`

```ts
def({
  id: 'magmashot', name: '赤蛟霰铳', category: '霰弹枪', kind: 'shotgun', mode: 'semi',
  damage: 11, pellets: 8, fireRate: 2.5, mag: 2, reserve: 36, reloadTime: 1.4, shellTime: 0.55, reloadStart: 0.3, reloadStyle: 'shell',
  spreadHip: 0.01, spreadAim: 0.005, spreadPerShot: 0.015, spreadMax: 0.035, spreadRecovery: 0.12, pelletCone: 0.09,
  recoil: { pitch: 0.06, yaw: 0.014, bias: 0, climb: 0 },
  critMult: 2, range: 28, falloff: [8, 26, 0.35],
  element: 'fire', elementChance: 0.07,
  innate: [{ id: 'subCorrode', value: 0.06 }],
  aimFov: -8, sfx: 'shot_shotgun', sfxVolume: 1.0, knockback: 1.0,
  tracerWidth: 0.014, impactSize: 0.5, kick: { back: 0.09, rot: 0.25 }, shake: 0.24, flash: 0.28,
  viewOffset: [0.22, -0.22, -0.5], aimOffset: [0, -0.075, -0.4], worldScale: 1.3,
  description: '双管并列的赤蛟霰铳，铁砂裹着熔火与蚀液，专剥重甲。',
  notes: ['双管：连开两枪后逐发装填，装填中开火可打断', '一次射出 8 枚弹丸', '火蚀双属，易引发「熔金」'],
}),
```

- DPS：11 × 8 × 2 ÷ (0.8 + 0.3 + 2 × 0.55) = 80。整发至少一枚附着灼烧 ≈ 44%；固有蚀化按「同帧同敌合并」（第 4 节）每发至少一次 ≈ 39%，强度取整发命中该敌的总伤害，所以熔金 Pin 大。
- 模拟：第一章铁甲盾卫击杀 1.80 → 1.42 秒（−21%）。
- 模型 `buildMagmashot`，`PALETTES.magmashot = { body: 0x5a1e14, dark: 0x1e1410, accent: 0xff6a1f, grip: 0x6b4a2a }`：
  - 并列双管 `cyl(body, 0.017, 0.36, ±0.019, 0.04, −0.2, 'z', 10)`；龙鳞脊 6 片 `box(accent, 0.012, 0.006, 0.03, 0, 0.062, z)`，z 从 −0.05 每片 −0.056 到 −0.33。
  - 蚀色导槽 `box(glowMat(0x9dff4a), 0.004, 0.01, 0.05, ±0.037, 0.04, −0.25)`；火色管口环 `cyl(glowMat(0xff6a1f), 0.02, 0.008, ±0.019, 0.04, −0.37, 'z', 10)`（固定颜色，一眼可见双元素）。
  - 机匣 `box(dark, 0.05, 0.06, 0.12, 0, 0.025, 0.02)` + `box(energyMat, 0.004, 0.012, 0.08, 0.026, 0.025, 0.02)`；稀有度条 `box(rarity, 0.004, 0.008, 0.1, ±0.026, 0, 0.02)`。
  - 枪托 `box(grip, 0.04, 0.06, 0.18, 0, −0.01, 0.15, −0.15)`；`pistolGrip(r, grip, −0.05, 0.07, 0.1, −0.35)`、`trigger(r, 0.04)`。
  - 护木 `box(grip, 0.05, 0.03, 0.12, 0, 0, −0.16)`，`m.leftHand = (0, −0.02, −0.16)`；不设 pump / mag。
  - `m.muzzle = (0, 0.04, −0.39)`。

### 3.4 三才转轮 `trinity`（新机制 A：元素轮转）

```ts
def({
  id: 'trinity', name: '三才转轮', category: '手枪', kind: 'pistol', mode: 'semi',
  damage: 42, fireRate: 3.0, mag: 6, reserve: 54, reloadTime: 1.8, reloadStyle: 'cylinder',
  spreadHip: 0.005, spreadAim: 0.0015, spreadPerShot: 0.016, spreadMax: 0.045, spreadRecovery: 0.16,
  recoil: { pitch: 0.04, yaw: 0.009, bias: 0, climb: 0 },
  critMult: 2.4, range: 80, falloff: [35, 80, 0.7],
  element: 'fire', cycle: ['fire', 'shock', 'corrode'], elementChance: 0.45,
  aimFov: -12, sfx: 'shot_pistol', sfxVolume: 0.95, knockback: 2,
  tracerWidth: 0.035, impactSize: 1.0, kick: { back: 0.07, rot: 0.26 }, shake: 0.1, flash: 0.14,
  viewOffset: [0.2, -0.17, -0.42], aimOffset: [0, -0.09, -0.34], worldScale: 1.9, dropWeight: 0.8,
  description: '天、地、人三才分镌于转轮弹巢，火、雷、蚀依次出膛。',
  notes: ['弹巢按 灼烧 → 雷殛 → 蚀化 轮转出膛', '枪身灵纹显示下一发的元素', '每次换弹从灼烧重新开始'],
}),
```

- DPS：42 × 6 ÷ (2 + 1.8) = 66.3；每种元素 1 发/秒 × 0.45。
- 机制 A 实现（weapons 流 B，约 50 行）：
  - `WeaponRuntime.cycleIndex`（预落地）。`WeaponSystem.shoot()` 在分派弹道前：`def.cycle` 非空时 `el = def.cycle[rt.cycleIndex % len]; rt.cycleIndex++`，设 `this.ballistics.elementOverride = el`；分派后复位 `null`。`finishReload` 时 `rt.cycleIndex = 0`。
  - `Firing` 新增公开字段 `elementOverride: Element | null` 与私有 `el(inst) = this.elementOverride ?? inst.element`，替换 trace / projectile（请求、颜色、spawn 的 element）/ beamTick（含电弧）里直接读 `inst.element` 的地方；`shotColor(inst, el = inst.element)` 增加可选参数，`feedback` 的枪口火焰颜色也用本发元素。
  - `inst.element` 固定为 `'fire'`，所以 `R.elementChance` 非零、缓存键不变；`roll()` 不会给它随机换元素（def.element 非 none）。
  - `ViewmodelState` 新增 `elementHint: Element | null`；`updateViewmodel` 设为 `def.cycle ? def.cycle[rt.cycleIndex % len] : null`；Viewmodel `animateParts` 中 `if (s.elementHint) e.baseColor.setHex(ELEMENT_COLORS[s.elementHint])`。
  - Describe 元素行显示「三相轮转 45%」，并设 `desc.elementLabel = '三相'`。
- 模型 `buildTrinity`，`PALETTES.trinity = { body: 0x3a3a44, dark: 0x1c1c22, accent: 0xe8d6a0, grip: 0x2a4a3a }`：
  - `pistolGrip(r, grip, −0.058, 0.032, 0.115, −0.32)`、`trigger(r, −0.03)`；框架 `box(body, 0.042, 0.052, 0.13, 0, 0.03, −0.025)`。
  - 转轮 `cy = group(r, 0, 0.04, −0.05)`：`cyl(dark, 0.034, 0.066, 0,0,0, 'z', 10)`；6 个弹膛帽 `cyl(glowMat([火,雷,蚀][i % 3] 的 ELEMENT_COLORS), 0.0065, 0.068, cos(a)·0.022, sin(a)·0.022, 0, 'z', 6)`。`m.cylinder = m.mag = cy`，`m.cylinderSteps = 6`。
  - 枪管 `cyl(body, 0.015, 0.2, 0, 0.058, −0.18, 'z', 8)` + 下挂凸耳 `box(body, 0.012, 0.016, 0.18, 0, 0.044, −0.18)`；卦象肋三道 `box(accent, 0.03, 0.004, 0.01, 0, 0.076, z)`，z = −0.12 / −0.16 / −0.20。
  - 灵纹条（动态变色）`box(energyMat, 0.004, 0.01, 0.12, ±0.016, 0.058, −0.18)`；稀有度条 `box(rarity, 0.004, 0.008, 0.11, ±0.022, 0.03, −0.03)`。
  - `m.muzzle = (0, 0.058, −0.285)`。

### 3.5 贯虹灵炮 `railgun`（新机制 B：蓄力 + 满蓄引爆）

```ts
def({
  id: 'railgun', name: '贯虹灵炮', category: '蓄能炮', kind: 'rifle', mode: 'charge',
  damage: 155, fireRate: 2, mag: 6, reserve: 36, reloadTime: 2.4, reloadStyle: 'cell',
  chargeTime: 0.9, chargeMinMult: 0.2, chargeFullPierce: 3, chargeDetonate: true,
  spreadHip: 0.01, spreadAim: 0, spreadPerShot: 0.02, spreadMax: 0.05, spreadRecovery: 0.15,
  recoil: { pitch: 0.05, yaw: 0.008, bias: 0, climb: 0 },
  critMult: 2.5, range: 200, pierce: 1,
  element: 'none', elementChance: 0.35,
  aimFov: -24, aimSpeed: 12, sfx: 'shot_sniper', sfxVolume: 0.9, knockback: 4,
  tracerWidth: 0.09, impactSize: 1.3, kick: { back: 0.08, rot: 0.16 }, shake: 0.18, flash: 0.2,
  viewOffset: [0.22, -0.22, -0.52], aimOffset: [0, -0.13, -0.36], worldScale: 1.1, dropWeight: 0.8,
  description: '以双轨灵纹束缚长虹的蓄能炮，一击贯穿，引万象归一。',
  notes: ['按住蓄力 0.9 秒，松开发射；蓄力越满伤害越高（20%–100%）', '满蓄：额外穿透 3 名敌人，并「引爆」命中目标身上的元素状态'],
}),
```

- 伤害倍率 = `chargeMinMult + (1 − chargeMinMult) × t²`（t = 蓄力进度 0..1）；松手后冷却 `1 / fireRate` = 0.5 秒。
- DPS：满蓄 155 × 6 ÷ (6 × 1.4 + 2.4) = 86.1；蓄一半 45.9；一直点按 34.4。射速词条 / 属性同时加快蓄力。
- 精良以上有 35% 随机带元素（沿用 `roll()`），带元素时 elementChance 0.35。
- 机制 B 实现（weapons 流 B，约 110 行）：
  - `WeaponSystem` 新私有字段 `charge = 0, charging = false, chargeFull = false`；公开 getter `chargeProgress = charging ? charge : 0`（契约里是可选只读属性）。
  - `update()` 的 `switch(def.mode)` 新增：
    ```ts
    case 'charge': {
      const can = ready && hasAmmo && this.cooldown <= 0;
      if (fireDown && can) {
        if (!this.charging) { this.charging = true; this.charge = 0; this.chargeFull = false; ctx.audio.play('weapon_switch', { volume: 0.4, pitch: 0.6 }); }
        this.charge = Math.min(1, this.charge + dt * rateMult / Math.max(0.05, def.chargeTime));
        if (this.charge >= 1 && !this.chargeFull) { this.chargeFull = true; ctx.audio.play('telegraph', { volume: 0.35, pitch: 1.6 }); }
      } else if (this.charging) {
        if (!fireDown && can) {
          const t = this.charge;
          this.shoot(inst, R, infinite, { mult: def.chargeMinMult + (1 - def.chargeMinMult) * t * t, pierceBonus: t >= 1 ? def.chargeFullPierce : 0, full: t >= 1, strength: 0.4 + 0.6 * t });
          this.cooldown = 1 / rate;
        }
        this.charging = false; this.charge = 0; this.chargeFull = false;   // 松手发射，或被换弹 / 切枪打断
      }
      break;
    }
    ```
  - `shoot(inst, R, infinite, shot: ShotMods = NO_SHOT)`：`mult`（终焉）再乘 `shot.mult`；`hitscan(..., shot)`；`feedback(inst, R, shot.strength)`。`ShotMods = { mult: number; pierceBonus: number; full: boolean; strength: number }` 与 `NO_SHOT = { mult: 1, pierceBonus: 0, full: false, strength: 1 }` 从 `Firing.ts` 导出。
  - `Firing.trace`：`pierceLeft = R.pierce + shot.pierceBonus`；曳光宽度 × `shot.strength`；`const res = ctx.combat.damageEnemy(enemy, req)` 后，若 `shot.full && def.chargeDetonate && res && !res.killed && enemy.alive` → `ctx.combat.detonate(enemy, { power: Math.min(res.dealt, enemy.maxHp * 0.5), depth: 0, weaponUid: inst.uid, point: req.point })`。
  - `stopActions()` 清零 charge 三个字段；`handleEmpty` 的 holdMode 不含 `'charge'`（空匣按半自动处理）。
  - `updateViewmodel`：`s.firing = this.beamOn || this.minigunFiring || this.charging`；`s.spin = def.mode === 'charge' ? this.charge : this.spin`（线圈转速随蓄力加快）。
  - Describe：伤害显示「31–155」（`R.damage × chargeMinMult` – `R.damage`）；射速显示「蓄力 0.90 秒」（`chargeTime / R.fireRateMult`）；秒伤按 `perShot ÷ (1 / R.fireRate + chargeTime / R.fireRateMult)` 自算。
- 模型 `buildRailgun`，`PALETTES.railgun = { body: 0x3a3f4a, dark: 0x1b1d24, accent: 0xc9a8ff, grip: 0x24242a }`：
  - 机匣 `box(body, 0.07, 0.09, 0.30, 0, 0.02, −0.02)`；双导轨 `box(dark, 0.012, 0.05, 0.55, ±0.022, 0.035, −0.425)`；发光芯 `box(glowMat(0xc9a8ff), 0.006, 0.02, 0.52, 0, 0.035, −0.42)`。
  - 线圈 `sp = group(r, 0, 0.035, −0.42)`：4 个 `ring(sp, accent色, 0.045, 0.012, 0, 0, z)`，z = −0.18 / −0.06 / 0.06 / 0.18，每个环上加一颗 `box(energyMat, 0.01, 0.01, 0.014, 0, 0.045, z)`（让旋转看得见）；`m.spinner = sp`。
  - 电容 `cap = group(r, 0, 0.085, 0.02)`：`cyl(dark, 0.03, 0.12, 0,0,0, 'z', 10)` + 两道 `cyl(energyMat, 0.031, 0.015, 0, 0, ±0.035, 'z', 10)`；`m.mag = cap`。
  - 枪托 `box(body, 0.04, 0.07, 0.16, 0, 0, 0.2)`；`pistolGrip(r, grip, −0.06, 0.07, 0.11, −0.3)`、`trigger(r, 0.04)`；照门 `rearNotch(r, 0.13, 0.08)`；准星 `box(dark, 0.006, 0.018, 0.006, 0, 0.072, −0.66)`。
  - 稀有度条 `box(rarity, 0.004, 0.008, 0.24, ±0.036, 0.04, −0.02)`；`m.leftHand = (0, −0.02, −0.32)`；`m.muzzle = (0, 0.035, −0.72)`。
  - aimFov −24 > −30，不切狙击镜，模型保持可见。

### 3.6 蚀蛊灯 `lantern`

```ts
def({
  id: 'lantern', name: '蚀蛊灯', category: '蛊灯', kind: 'launcher', mode: 'semi',
  damage: 55, fireRate: 1.6, mag: 8, reserve: 48, reloadTime: 2.0, reloadStyle: 'cell',
  spreadHip: 0.01, spreadAim: 0.004, spreadPerShot: 0.006, spreadMax: 0.02, spreadRecovery: 0.1,
  recoil: { pitch: 0.012, yaw: 0.004, bias: 0, climb: 0 },
  critMult: 1.8, range: 60, pierce: 6,
  projectile: { speed: 14, gravity: -0.3, radius: 0.38, lifetime: 3.2, visual: 'orb', scale: 1.5, homing: 2.2, color: 0x9dff4a },
  element: 'corrode', elementChance: 0.6,
  innate: [{ id: 'seed', value: 0.5 }],
  aimFov: -8, sfx: 'shot_launcher', sfxVolume: 0.4, knockback: 0.6,
  tracerWidth: 0, impactSize: 0.8, kick: { back: 0.03, rot: 0.07 }, shake: 0.04, flash: 0.1,
  viewOffset: [0.24, -0.22, -0.5], aimOffset: [0.06, -0.15, -0.42], worldScale: 1.4, dropWeight: 0.8,
  description: '南疆巫祝的养蛊铜灯，灯火所照之处，瘴疠横生。',
  notes: ['发射缓缓飘行的蛊灯，自动寻敌并穿透多名敌人'],
}),
```

- DPS：55 × 8 ÷ (5 + 2) = 62.9，加蚀化跳伤与 20% 易伤约 75；每颗灯最多命中 7 人（hitSet 防重复命中，追踪重选目标已跳过 hitSet）。
- 手感：射后不理，慢速钻进人群；蛊种（固有词条）让带种敌人的反应传染给旁边的人。
- 模型 `buildLantern`，`PALETTES.lantern = { body: 0x2f3a2a, dark: 0x161b14, accent: 0xc8b070, grip: 0x3b2c1e }`：
  - 握杆 `cyl(grip, 0.018, 0.22, 0, 0, −0.08, 'z', 8)`；`pistolGrip(r, grip, −0.055, 0.04, 0.1, −0.3)`、`trigger(r, 0)`；横梁 `box(accent, 0.012, 0.012, 0.08, 0, 0.02, −0.2)`。
  - 灯笼 `lg = group(r, 0, −0.03, −0.26)`：6 根灯骨 `box(dark, 0.004, 0.11, 0.004, cos(a)·0.05, 0, sin(a)·0.05)`；上下灯盖 `cyl(accent, 0.054, 0.01, 0, ±0.055, 0, 'y', 10)`；吊钩 `box(accent, 0.004, 0.03, 0.004, 0, 0.075, 0)`；铜坠 `cyl(accent, 0.006, 0.03, 0, −0.075, 0, 'y', 6)`。
  - 灯芯 `wick = group(lg, 0, 0, 0)`：`cyl(energyMat, 0.03, 0.07, 0,0,0, 'y', 10)`；`m.mag = wick`（cell 换弹时抽出）。
  - 稀有度条 `box(rarity, 0.004, 0.008, 0.14, ±0.02, 0, −0.08)`；`m.leftHand = (0, −0.02, −0.12)`；`m.muzzle = (0, −0.03, −0.33)`。

### 3.7 其他武器侧改动

- `Firing.projectile`：spawn 参数加 `bounces: p.bounces > 0 ? p.bounces : undefined`。
- `WeaponSystem.roll()`：不指定 defId 时 `rng.weighted(WEAPON_DEFS, (d) => d.dropWeight).id`（取代 `rng.pick(WEAPON_IDS)`）。
- 「疾化」射速：`update()` 里在狂热倍率旁 `const haste = R.rxnHaste > 0 && ctx.time.now < rt.rxnHasteUntil ? 1 + R.rxnHaste : 1;`，`rate` 与 `rateMult` 都乘 `haste`（蓄力速度随之加快）。
- `WeaponDefs.ts` 文件头注释「11 把武器」改为「17 把武器」。
- `ui/labels.ts` 的 `WEAPON_NAMES` 兜底项在契约阶段追加（见第 10 节）。

---

## 4. 新词条（10 个）

区间为精良基准，之后乘稀有度系数（精良 ×1、稀有 ×1.15、史诗 ×1.3、传说 ×1.45）。

### 4.1 基础设施（`Affixes.ts`，词条流 C）

- `AffixDef.allow` 与 `LegendaryDef.allow` 签名改为 `(def, element, picked: readonly string[])`；现有词条忽略多出的参数。`rollAffixes` 每抽一个词条就用当前 `picked` 重新过滤一次词条池。
- `AffixDef` 新增可选 `perHit?: boolean`：取值 `raw × rarityScale` 后再归一化为「每次命中几率」：
  `v = clamp(raw × 3.5 / hps(def), 0.02, 0.75)`，其中 `hps(def) = (def.mode === 'charge' ? 1 / (1 / def.fireRate + def.chargeTime) : shotsPerSecond(def)) × hitsPerShot(def)`。结果是每秒附着约 `raw × 3.5` 次，与射速无关。
- 辅助：`canReact(d, e, picked) = e !== 'none' || !!d.cycle || d.chargeDetonate || picked.some((id) => id.startsWith('sub'))`。
- 固有词条：`rollAffixes` 先把 `def.innate` 拷贝到结果最前面并计入 `picked`，然后照常按 `AFFIX_COUNT` 抽取（固有不占名额、不放大、不被重复抽到）。
- `roundValue`：`rxnShield` 取整数；`perHit` 词条保留 2 位小数且不低于 0.02。

### 4.2 词条表

| id | 简称 | 区间 | 权重 | 玩家文案 | 允许 |
|---|---|---|---|---|---|
| `subFire` | 副·焚 | raw 0.10–0.18（perHit） | 4 | `命中时 ${pct(v)} 几率附加灼烧` | `e !== 'fire' && !d.cycle` |
| `subShock` | 副·雷 | raw 0.10–0.18（perHit） | 4 | `命中时 ${pct(v)} 几率附加雷殛` | `e !== 'shock' && !d.cycle` |
| `subCorrode` | 副·蚀 | raw 0.10–0.18（perHit） | 4 | `命中时 ${pct(v)} 几率附加蚀化` | `e !== 'corrode' && !d.cycle` |
| `rxnDmg` | 化合 | 0.18–0.35 | 6 | `本武器引发的元素反应伤害 +${pct(v)}` | `canReact` |
| `rxnRefill` | 回元 | 0.08–0.15 | 4 | `本武器引发元素反应时回填 ${pct(v)} 弹匣` | `canReact` |
| `rxnHaste` | 疾化 | 0.12–0.22 | 4 | `本武器引发元素反应后 3 秒内射速 +${pct(v)}` | `canReact` |
| `statusHunter` | 乘隙 | 0.05–0.09 | 5 | `目标每带有一种元素状态，伤害 +${pct(v)}` | 任意 |
| `rxnShield` | 化盾 | 4–8（取整） | 4 | `本武器引发元素反应时获得 ${Math.round(v)} 点护盾` | `canReact` |
| `detonate` | 破势 | 0.6–0.9 | 4 | `暴击或爆头时引爆目标的元素状态（强度 ${pct(v)}，每 1.5 秒一次）` | `directHit(d) && d.mode !== 'charge'` |
| `seed` | 蛊种 | 0.30–0.45 | 2 | `命中种下蛊种：其发生元素反应时，以 ${pct(v)} 威力传染给附近 1 名敌人` | `!!d.projectile && !isExplosive(d)` |

固有：青冥雷蛊 `subShock 0.4`、赤蛟霰铳 `subCorrode 0.06`（每弹丸）、蚀蛊灯 `seed 0.5`。固有值是直接的每次命中几率 / 数值，不再归一化。

归一化示例（`subX` raw 0.14，精良）：冲锋枪 3.8%、步枪 6.1%、左轮 14%、狙击 54%、碎岩霰弹每弹丸 3.9%（合并后每发约 30%）、贯虹灵炮 69%。

权重占比：一把带元素的命中扫描武器，新增反应类可抽权重约 35（两种副元素 8 + 化合 6 + 回元 4 + 疾化 4 + 乘隙 5 + 化盾 4 + 破势 4），原有可抽权重约 115，即每次抽词条约 23% 落在反应类，不会把旧词条挤掉。

### 4.3 生效（`WeaponStats.ts` / `AffixEffects.ts`，词条流 C）

`WeaponStats`：`Totals`、`_t`、`ResolvedWeapon`、`blank()` 各加 10 个字段（`rxnHaste` 已预落地，只补 Totals 与赋值），`resolveWeapon` 里 `r.x = t.x`。

`AffixEffects`：

1. **修复既有缺陷**：新增 `isWeaponReq(req) = req.weaponUid !== undefined && (req.source === 'weapon' || (req.source === 'explosion' && hasTag(req, 'weapon')))`，替换 `hunterModifier`、`onDamaged`、`onKilled` 三处的 `source !== 'weapon'` 判断（焚城榴弹 / 蜂群飞弹 / 青冥雷蛊上的触发类词条与传说因此生效）。Combat 吸血**不改**（避免范围吸血暴涨）。`hasTag` 在本文件内自写一份。
2. **同帧合并**：`dealtNow: Map<IEnemy, number>` 与 `dealtPrev`。`onDamaged` 中（isWeaponReq、depth 0）累加 `dealtNow[enemy] += result.dealt`；`flush()` 开头交换两张表（`dealtPrev` = 上一帧全部伤害），执行完清空 `dealtPrev`。
3. **Proc 新种类**：`ProcKind` 加 `'sub' | 'detonate' | 'nirvana' | 'echo'`；`Proc` 加 `scale: number`、`reaction: ReactionId`、`mult: number`、`target: IEnemy | null`，`alloc()` 里全部重置。
   - `'sub'`：入队前在 `this.queue` 里查找同 uid、同 enemy、同 status 的 `'sub'`，找到就跳过（一发霰弹 / 一次爆炸只附着一次）。执行：`power = min(dealtPrev.get(enemy) ?? p.base, enemy.maxHp × 0.5)`，`ctx.combat.applyStatus(enemy, p.status, power, undefined, { depth: 0, weaponUid: p.uid })`。
   - `'detonate'`：`ctx.combat.detonate(enemy, { power: min(dealtPrev.get(enemy) ?? p.base, maxHp × 0.5), mult: p.mult, depth: 0, weaponUid: p.uid })`。
   - `'nirvana'` / `'echo'`：见第 5 节与本节「蛊种」。
   - 原 `'status'`（万象）改为 `applyStatus(enemy, s, base, undefined, { depth: 0, weaponUid: p.uid, reactionScale: 0.6 })`。
4. **onDamaged 新分支**（均要求 isWeaponReq、depth 0）：
   - `subFire / subShock / subCorrode`：`!result.killed && enemy.alive && result.statusApplied !== 对应状态 && rng < R.x` → `'sub'`。
   - `detonate`：`R.detonate > 0 && (req.headshot || result.isCrit) && !killed && enemy.alive && 身上有元素状态 && now − st.lastDetonate ≥ 1.5` → 记时间，`'detonate'`（`mult = R.detonate`）。
   - `seed`：`R.seed > 0 && enemy.alive && !killed` → `seeds.set(enemy, { until: now + 6, value: R.seed, uid: inst.uid })`（`WeakMap`，不入队）。
5. **weaponModifier**（由 `hunterModifier` 改名，仍在 `installModifier` 注册）：
   ```ts
   (enemy, req) => {
     if (req.weaponUid === undefined) return 1;
     const inst = host.find(req.weaponUid); if (!inst) return 1;
     const R = host.resolve(inst); const st = rxState(inst); let m = 1;
     const boil = R.legendary === 'lg_boil' && now - st.boilTime <= 4 ? 1 + st.boil * R.legendaryValue : 1;
     if (hasTag(req, REACTION_TAG)) {
       if (R.rxnDmg > 0) m *= 1 + R.rxnDmg;
       if (R.legendary === 'lg_lunhui' && hasTag(req, 'abyss')) m *= 1.5;
       return m * boil;
     }
     if (!isWeaponReq(req)) return 1;
     if (R.hunter > 0 && (enemy.isBoss || enemy.isElite)) m *= 1 + R.hunter;
     if (R.statusHunter > 0) m *= 1 + R.statusHunter * countElementStatuses(enemy);   // 修饰器在附着前调用，统计命中前的状态
     return m * boil;
   }
   ```
6. **onReaction**：`init()` 新增 `ev.on('enemy:reaction', (e) => this.onReaction(e))`：
   - 蛊种（任何来源的反应都可触发）：`seed = seeds.get(e.enemy)`，若 `seed && seed.until > now && e.tag !== 'echo'` → `seeds.delete(e.enemy)`，入队 `'echo'`；执行时 `t = ctx.enemies.nearest(e.point, 8, {e.enemy})`，`ctx.combat.triggerReaction(t, e.reaction, 0, { depth: e.depth + 1, weaponUid: seed.uid, fixedBase: e.base × seed.value, tag: 'echo' })`，并 `fx.beam(e.point, t 身体中心, 0x9dff4a, 0.06, 0.25)`。
   - 以下只在 `e.weaponUid` 对应本武器（`host.find`）时：
     - 回元：`now − st.lastRefill > 0.3` → `host.refill(inst, max(1, round(R.magCap × R.rxnRefill)))`。
     - 疾化：`host.runtime(inst).rxnHasteUntil = now + 3`。
     - 化盾：`now − st.lastShield > 0.3` → `ctx.player.addShield(R.rxnShield)`。
     - 鼎沸：`st.boil = (now − st.boilTime > 4 ? 0 : st.boil) + 1`，上限 8，`st.boilTime = now`。
7. 每把武器的反应运行时状态放在本文件私有 `WeakMap<WeaponInstance, RxState>`：`{ lunhuiAt: -99, lunhuiIdx: 0, lastDetonate: -99, lastRefill: -99, lastShield: -99, boil: 0, boilTime: -99 }`。只有 `cycleIndex`、`rxnHasteUntil` 放在共享的 `WeaponRuntime`（预落地）。

---

## 5. 新传说特性（4 个）

名字作为武器名前缀（如「合璧·赤铜左轮」），数值不随稀有度放大。

| id | 名称 | allow | value | 玩家文案 |
|---|---|---|---|---|
| `lg_bond` | 合璧 | `canReact` | 1 | `命中带有其他元素状态的敌人时，必定附加本武器的元素` |
| `lg_lunhui` | 轮回 | `!d.cycle` | 0.6 | `命中时依次附加灼烧、雷殛、蚀化（每 ${v} 秒一次）；本武器引发的「归墟」伤害 +50%` |
| `lg_nirvana` | 涅槃 | 任意 | 0.25 | `击杀身负两种以上元素状态的敌人时，于其尸身引发对应反应（威力为其最大生命的 ${pct(v)}）` |
| `lg_boil` | 鼎沸 | 任意 | 0.06 | `本武器每引发一次元素反应，武器与反应伤害 +${pct(v)}（最多 8 层，4 秒未触发则清空）` |

实现（`AffixEffects.onDamaged`，isWeaponReq、depth 0）：

- **合璧**：`req.element !== 'none' && !killed && enemy.alive`，`s` = 本发元素对应状态；若 `result.statusApplied !== s` 且敌人身上有 burn/shock/corrode 中**不同于 s** 的状态 → `'sub'`（状态 s）。用的是本发实际元素（与三才转轮兼容）。频率由反应冷却约束。
- **轮回**：`!killed && enemy.alive && now ≥ st.lunhuiAt` → `st.lunhuiAt = now + R.legendaryValue`，`s = ['burn','shock','corrode'][st.lunhuiIdx++ % 3]` → `'sub'`。归墟加成见 weaponModifier。物理武器也能借此成为三相引擎。
- **涅槃**：`result.killed`（此时 statuses 还没清空）且身上有 ≥ 2 种元素状态：三种都有 → `abyss`；否则按 焚雷 > 熔金 > 封脉 选身上已有的那一对。入队 `'nirvana'`，`point` 写死者身体中心。执行：`ctx.combat.triggerReaction(enemy, id, enemy.maxHp × R.legendaryValue, { depth: 1, weaponUid, point, ignoreIcd: true, tag: 'nirvana' })`。中心已死，只结算范围部分；反应造成的击杀 source 为 status，不会再触发涅槃。
- **鼎沸**：见第 4.3 节 weaponModifier 与 onReaction。

---

## 6. 新秘卷（24 个）

### 6.1 文件与约定

- 新建 `src/progression/scrolls/defsReaction.ts`，导出 `REACTION_SCROLLS: ScrollDef[]`，在 `ScrollDefs.ts` 的 `all` 数组末尾展开。
- 一律用 `scroll({...})`；描述写「每层 X」；标签直接写中文（`tagName` 原样显示，不改 labels.ts）。新标签：`反应`、`焚雷`、`熔金`、`封脉`、`归墟`、`引爆`、`控制`。
- 文件内私有辅助：
  ```ts
  const ELEM: readonly StatusId[] = ['burn', 'shock', 'corrode'];
  const statusCount = (e: IEnemy) => ELEM.reduce((n, s) => n + (e.statuses.has(s) ? 1 : 0), 0);
  const rxTag = (req: DamageRequest, id: string) => !!req.tags?.includes(id);
  const isWeaponReq = (req: DamageRequest) => req.weaponUid !== undefined && (req.source === 'weapon' || (req.source === 'explosion' && rxTag(req, 'weapon')));
  const isSkillReq = (req: DamageRequest) => req.source === 'skill' || rxTag(req, 'skill');
  function perEnemyIcd(): (e: IEnemy, now: number, cd: number) => boolean   // WeakMap 版内置冷却
  ```
- 在 `'enemy:damaged'` / `'enemy:killed'` 回调里造成伤害要包 `ctx.tasks.delay(0, …)`；`applyStatus` / `detonate` / `triggerReaction` 可同步调用；`'enemy:reaction'` 回调里可以直接造成伤害。显式施加状态一律传 `depth`。
- 升层会先卸载再 setup：闭包计数、WeakMap 会重置，属于可接受行为。

### 6.2 秘卷表

| # | id | 名称 | 稀有度 / 层 | 标签 | 描述（玩家可见原文） |
|---|---|---|---|---|---|
| 1 | `rx_catalyst` | 催化 | 普通 / 5 | 元素、反应、伤害 | 元素反应伤害每层 +8%。 |
| 2 | `rx_haste` | 灵动 | 普通 / 4 | 元素、反应 | 元素反应急速每层 +10%（同一敌人再次发生同种反应的间隔缩短）。 |
| 3 | `rx_tf_charm` | 雷火符 | 普通 / 4 | 元素、反应、焚雷、灼烧、雷殛 | 「焚雷」伤害每层 +12%；灼烧与雷殛伤害每层 +4%。 |
| 4 | `rx_mg_charm` | 熔金符 | 普通 / 4 | 元素、反应、熔金、灼烧、蚀化 | 「熔金」伤害每层 +12%；对护甲伤害每层 +6%。 |
| 5 | `rx_vs_charm` | 封脉符 | 普通 / 4 | 元素、反应、封脉、雷殛、蚀化 | 「封脉」伤害每层 +12%；对护盾伤害每层 +6%。 |
| 6 | `rx_lead_shock` | 引雷 | 精良 / 3 | 元素、反应、焚雷、雷殛、命中 | 武器命中灼烧中的敌人时，每层 8% 概率附加雷殛（引发「焚雷」）。 |
| 7 | `rx_lead_fire` | 引火 | 精良 / 3 | 元素、反应、熔金、灼烧、命中 | 武器命中蚀化中的敌人时，每层 8% 概率附加灼烧（引发「熔金」）。 |
| 8 | `rx_lead_corrode` | 引蚀 | 精良 / 3 | 元素、反应、封脉、蚀化、命中 | 武器命中雷殛中的敌人时，每层 8% 概率附加蚀化（引发「封脉」）。 |
| 9 | `rx_ward` | 化劫 | 精良 / 3 | 反应、护盾、生存 | 引发元素反应时每层回复 4 点护盾（每秒至多 3 次）；「归墟」改为每层 12 点。 |
| 10 | `rx_transmute` | 化元 | 稀有 / 3 | 反应、技能 | 引发元素反应时，所有技能冷却每层减少 0.25 秒（每 0.5 秒至多一次）。 |
| 11 | `rx_acupoint` | 点穴 | 稀有 / 3 | 反应、引爆、爆头 | 武器爆头命中带有元素状态的敌人时引爆其状态，引爆强度每层 40%（冷却 1.2 秒）。 |
| 12 | `rx_tf_scatter` | 爆焰 | 稀有 / 3 | 元素、反应、焚雷、爆炸 | 「焚雷」爆炸时向四周溅出 3 枚火星，各在落点 2 米内造成每层 18 点火焰伤害（随关卡强度成长），50% 概率附加灼烧。 |
| 13 | `rx_mg_shatter` | 熔铸 | 稀有 / 3 | 元素、反应、熔金、护甲 | 「熔金」击碎敌人护甲时，熔甲碎片迸射至 5 米内的敌人，造成其护甲上限每层 15% 的蚀化伤害（单体上限随关卡强度）并附加蚀化。 |
| 14 | `rx_vs_lock` | 锁灵 | 稀有 / 3 | 元素、反应、封脉 | 被「封脉」的敌人 4 秒内受到的元素伤害每层 +12%。 |
| 15 | `rx_ab_mark` | 三才印 | 稀有 / 3 | 元素、反应、归墟、命中 | 武器命中恰好身负两种元素状态的敌人时，每层 12% 概率补上第三种（引发「归墟」）。 |
| 16 | `fox_thunderfire` | 狐火引雷 | 稀有 / 3，赤狐专属 | 英雄、反应、焚雷、灼烧、雷殛 | 技能附加灼烧时，每层 30% 概率同时附加雷殛（引发「焚雷」）；「焚雷」伤害每层 +10%。 |
| 17 | `falcon_veinseal` | 蚀羽惊雷 | 稀有 / 3，雷隼专属 | 英雄、反应、封脉、雷殛、蚀化 | 技能附加雷殛时，每层 30% 概率同时附加蚀化（引发「封脉」）；「封脉」伤害每层 +10%。 |
| 18 | `bear_magma` | 熔岩撼地 | 稀有 / 3，岩熊专属 | 英雄、反应、熔金、技能 | 裂地重击（E）命中的敌人依次附加灼烧与蚀化（强度为该次伤害的 40%），引发「熔金」；「熔金」伤害每层 +10%。 |
| 19 | `rx_tf_capstone` | 焚天雷狱 | 史诗 / 2 | 元素、反应、焚雷 | 「焚雷」伤害每层 +20%；被「焚雷」波及的其他敌人额外附加雷殛，从而接连引发「焚雷」。 |
| 20 | `rx_mg_capstone` | 金乌坠 | 史诗 / 2 | 元素、反应、熔金、爆炸 | 「熔金」留下的熔池在 1.5 秒后坍缩爆炸，对 3.5 米内造成「熔金」威力每层 60% 的火焰伤害；对无护甲敌人的「熔金」伤害每层 +25%。 |
| 21 | `rx_vs_capstone` | 镇岳 | 史诗 / 2 | 元素、反应、封脉、控制 | 「封脉」造成的眩晕每层延长 0.4 秒，并额外放出每层 1 道电弧；首领被「封脉」后 6 秒内受到的伤害每层 +8%。 |
| 22 | `rx_ab_amp` | 归真 | 史诗 / 2 | 元素、反应、归墟、击杀 | 「归墟」伤害每层 +30%；「归墟」击杀敌人时，向 8 米内最近的 2 名敌人各附加两种随机元素状态（强度为「归墟」威力的每层 15%）。 |
| 23 | `rx_hunyuan` | 混元 | 传说 / 1 | 元素、反应、传说、风险 | 元素反应伤害 +60%，元素反应急速 +40%；但受到的伤害 +25%，护盾上限 −30。 |
| 24 | `rx_kalpa` | 劫火 | 传说 / 1 | 元素、反应、归墟、传说、风险 | 每引发 10 次元素反应，向准星所指的敌人降下「三相天劫」：直接引发一次「归墟」（无需元素状态）；但元素触发率 −8%。 |

稀有度分布：普通 5（1–5）、精良 4（6–9）、稀有 9（10–18，含 3 张英雄专属）、史诗 4（19–22）、传说 2（23–24）。名称与现有 74 个秘卷、10 个传说特性均不重名。

### 6.3 实现（逐条）

1. **催化**：`s.stat('reactionDamagePct', 0.08 * n)`。
2. **灵动**：`s.stat('reactionHaste', 0.1 * n)`。
3. **雷火符**：`s.outgoing((_e, r) => rxTag(r, 'thunderfire') ? 1 + 0.12 * n : 1)`；`s.stat('fireDamagePct', 0.04 * n)`；`s.stat('shockDamagePct', 0.04 * n)`。
4. **熔金符**：outgoing `meltdown` 标签 ×(1 + 0.12n)；`s.stat('armorDamagePct', 0.06 * n)`。
5. **封脉符**：outgoing `veinseal` 标签 ×(1 + 0.12n)；`s.stat('shieldDamagePct', 0.06 * n)`。
6–8. **引雷 / 引火 / 引蚀**（工厂 `leadScroll(id, name, need, give, tags)`）：`s.on('enemy:damaged', ({ enemy, result }))`，条件 `isWeaponReq(req) && depthOf(req) === 0 && !result.killed && enemy.alive && enemy.statuses.has(need) && result.statusApplied !== give && 逐敌 0.4 秒冷却 && ctx.rng.chance(0.08 * n)` → `ctx.combat.applyStatus(enemy, give, Math.min(result.dealt, enemy.maxHp * 0.5), undefined, { depth: 1, weaponUid: req.weaponUid })`。need/give：引雷 burn→shock，引火 corrode→burn，引蚀 shock→corrode。
9. **化劫**：`s.on('enemy:reaction', ({ reaction }) => { if (!s.ready('w', 0.33)) return; ctx.player.addShield((reaction === 'abyss' ? 12 : 4) * n); })`。
10. **化元**：`s.on('enemy:reaction', () => { if (s.ready('cd', 0.5)) ctx.player.reduceCooldowns(0.25 * n, 'both'); })`。
11. **点穴**：`s.on('enemy:damaged')`，`isWeaponReq(req) && depthOf(req) === 0 && req.headshot && !result.killed && enemy.alive && statusCount(enemy) > 0 && s.ready('a', 1.2)` → `ctx.combat.detonate(enemy, { power: Math.min(result.dealt, enemy.maxHp * 0.5), mult: 0.4 * n, depth: 0, weaponUid: req.weaponUid, point: req.point })`。
12. **爆焰**：`s.on('enemy:reaction', (ev))`，`ev.reaction === 'thunderfire' && ev.depth === 0 && s.ready('sc', 0.3)` → 连续 3 次 `ctx.projectiles.spawn({ owner: 'player', position: ev.point.clone(), velocity: 水平随机方向 × ctx.rng.range(4, 6) + 竖直 ctx.rng.range(6, 8), gravity: 16, radius: 0.12, lifetime: 1.2, visual: 'orb', scale: 0.6, color: 0xffa040, element: 'fire', explosionRadius: 2, damage: { base: 18 * n * procScale(ctx), element: 'fire', source: 'scroll', elementChance: 0.5, canCrit: false, procDepth: ev.depth + 1 } })`。
13. **熔铸**：`s.on('enemy:damaged')`，`result.armorBroken && rxTag(req, 'meltdown') && depthOf(req) < 2` → 记 `maxArmor`、身体中心 clone，`ctx.tasks.delay(0, () => forEachNear(ctx, c, 5, enemy, (e) => ctx.combat.damageEnemy(e, { base: Math.min(maxArmor * 0.15 * n, 60 * n * procScale(ctx)), element: 'corrode', source: 'scroll', elementChance: 1, canCrit: false, procDepth: depthOf(req) + 1, point: e.getBodyCenter(new THREE.Vector3()) })))`，并 `fx.burst(c, ELEMENT_COLORS.corrode, 16, 6, 0.5, 0.1, 10)`。
14. **锁灵**：`const until = new WeakMap<IEnemy, number>()`；`s.on('enemy:reaction', (ev) => { if (ev.reaction === 'veinseal') until.set(ev.enemy, ctx.time.now + 4); })`；`s.outgoing((e, r) => r.element !== 'none' && ctx.time.now < (until.get(e) ?? 0) ? 1 + 0.12 * n : 1)`。
15. **三才印**：`s.on('enemy:damaged')`，`isWeaponReq(req) && depthOf(req) === 0 && !result.killed && enemy.alive && statusCount(enemy) === 2 && s.ready('m', 0.1) && ctx.rng.chance(0.12 * n)` → 缺的那种 `applyStatus(enemy, missing, Math.min(result.dealt, enemy.maxHp * 0.5), undefined, { depth: 0, weaponUid: req.weaponUid })`。
16. **狐火引雷**（heroOnly `fox`）：`s.on('enemy:damaged')`，`isSkillReq(req) && result.statusApplied === 'burn' && !result.killed && enemy.alive && 逐敌 0.3 秒 && ctx.rng.chance(0.3 * n)` → `applyStatus(enemy, 'shock', Math.min(result.dealt, enemy.maxHp * 0.5), undefined, { depth: 1 })`；outgoing `thunderfire` ×(1 + 0.1n)。
17. **蚀羽惊雷**（heroOnly `falcon`）：同上模式，条件 `result.statusApplied === 'shock' && enemy.statuses.has('shock')`（雷殛叠满被清空时不触发），附加 `corrode`；outgoing `veinseal` ×(1 + 0.1n)。
18. **熔岩撼地**（heroOnly `bear`）：`let armedUntil = -1, windowEnd = -1`；`s.on('skill:used', ({ slot }) => { if (slot === 'secondary') { armedUntil = now + 2.2; windowEnd = -1; } })`；`s.on('enemy:damaged')`：`isSkillReq(req) && req.element === 'none' && now < armedUntil && !result.killed && enemy.alive` → 首次命中时 `windowEnd = now + 0.05`；`now ≤ windowEnd` 时依次 `applyStatus(enemy, 'burn', 0.4 × dealt, undefined, { depth: 1 })`、`applyStatus(enemy, 'corrode', 0.4 × dealt, undefined, { depth: 1 })`（第二次附着引发熔金）；窗口过后 `armedUntil = -1`。outgoing `meltdown` ×(1 + 0.1n)。
19. **焚天雷狱**：outgoing `thunderfire` ×(1 + 0.2n)；`s.on('enemy:reaction', (ev))`，`ev.reaction === 'thunderfire' && ev.depth === 0` → `forEachNear(ctx, ev.point, 3 * ctx.player.stats.mult('explosionRadiusPct'), ev.enemy, (e) => ctx.combat.applyStatus(e, 'shock', 0.3 * ev.base, undefined, { depth: 1 }))`。焚雷先给周围点上灼烧，本卷再补雷殛，周围敌人在 depth 1 上各自引发次级焚雷（受冷却限制）。
20. **金乌坠**：`s.on('enemy:reaction', (ev))`，`ev.reaction === 'meltdown' && ev.depth === 0` → `const p = ev.point.clone(), b = ev.base, d = ev.depth;` `ctx.tasks.delay(1.5, () => ctx.combat.explode(p, 3.5 * ctx.player.stats.mult('explosionRadiusPct'), { base: 0.6 * n * b, element: 'fire', source: 'scroll', canCrit: false, procDepth: d + 1 }, { color: 0xffc04a }))`；outgoing `meltdown` 且 `e.armor <= 0` ×(1 + 0.25n)。
21. **镇岳**：`s.on('enemy:reaction', (ev))`，`ev.reaction === 'veinseal' && ev.depth === 0`：
    - `ev.stunned && !ev.enemy.isBoss && ev.enemy.alive` → `applyStatus(ev.enemy, 'stun', 0, 0.7 + 0.4 * n)`（眩晕取较长值，相当于延长）；
    - 额外电弧：`ctx.enemies.queryRadius(ev.point, 8)` 拷贝后排除中心，`ctx.rng.shuffle` 取 n 名有视线的敌人，各 `fx.lightning(ev.point, 中心, 0x5affd0)`、`damageEnemy(e, { base: 0.3 * ev.base, element: 'shock', source: 'scroll', canCrit: false, procDepth: ev.depth + 1 })`、`applyStatus(e, 'corrode', 0.35 * ev.base, undefined, { depth: 1 })`；
    - 首领：`bossUntil.set(ev.enemy, now + 6)`；`s.outgoing((e) => now < (bossUntil.get(e) ?? 0) ? 1 + 0.08 * n : 1)`。
22. **归真**：outgoing `abyss` ×(1 + 0.3n)；`s.on('enemy:killed', ({ enemy, result }))`，`rxTag(req, 'abyss') && depthOf(req) < 2` → 取 `nearestOther` 两次（第二次排除第一名）得到最多 2 名敌人，对每名用 `ctx.rng.shuffle(['burn','shock','corrode'])` 取前两种，依次 `applyStatus(e, s, 0.15 * n * 估算威力, undefined, { depth: depthOf(req) })`。估算威力 = 本卷记录的最近一次归墟 `ev.base`（在 `'enemy:reaction'` 里缓存 `lastAbyssBase`）。
23. **混元**：`s.stat('reactionDamagePct', 0.6)`；`s.stat('reactionHaste', 0.4)`；`s.stat('maxShield', -30)`；`s.incoming(() => 1.25)`。
24. **劫火**：`s.stat('elementChancePct', -0.08)`；闭包计数 `c`，`s.on('enemy:reaction', (ev) => { if (ev.origin === 'forced') return; if (++c < 10) return; c = 0; ... })`：目标 = `ctx.enemies.raycast(ctx.player.eye, 瞄准方向, 30)?.enemy`，没有则取玩家 15 米内最近敌人；有目标时 `ctx.combat.triggerReaction(t, 'abyss', 100 * procScale(ctx), { depth: 0, ignoreIcd: true, tag: 'kalpa' })`，并从目标上方 12 米劈 3 道 `fx.lightning`（火、雷、蚀三色）+ `ctx.audio.play('boss_slam', { volume: 0.6, pitch: 1.3 })`。

### 6.4 抽取权重（`Scrolls.roll` 的 weight 函数，成长流 D）

每次 `roll()` 先计算一次：

- `hasElem`：英雄是 `fox` 或 `falcon`；或任一武器槽 `element !== 'none'`；或武器词条含 `subFire / subShock / subCorrode / lg_prism / lg_lunhui`；或已拥有任一带 `元素` 标签的秘卷。
- `flows`：已拥有秘卷的标签中出现过的流派标签集合（`焚雷 / 熔金 / 封脉 / 归墟`）。

对带 `反应` 标签的秘卷：

- `heroOnly` 的不降权；其余 `w *= hasElem ? 1.4 : 0.5`；
- 未拥有、且其标签包含 `flows` 中任一流派 → 再 `w *= 1.3`。

---

## 7. 掉落与内容池

| 池子 | 数量变化 | 旧内容单项出现率 | 缓解 |
|---|---|---|---|
| 武器 | 11 → 17 | 9.1% → 约 6.1% | 三才转轮、贯虹灵炮、蚀蛊灯 dropWeight 0.8 |
| 词条 | 19 → 29（+10） | 反应类约占每次抽取的 20% | 新词条权重 2–6，均不超过主力词条（伤害 12、射速 10） |
| 传说特性 | 6 → 10 | — | — |
| 秘卷 | 74 → 98 | 无元素来源的局，反应卷 ×0.5 | 见 6.4 |

---

## 8. 平衡表

### 8.1 新武器裸数值

| 武器 | 持续 DPS | 计算 | 元素附着（次/秒） |
|---|---|---|---|
| 朱雀吐息 | 69.1/目标 | 7.5 × 70 ÷ (5 + 2.6) | 火 1.12/目标，穿透 3 |
| 青冥雷蛊 | 71.3/爆心 | 95 × 5 ÷ (4.17 + 2.5) | 蚀 0.72、雷 0.48（范围内每人） |
| 赤蛟霰铳 | 80.0 | 11 × 8 × 2 ÷ (0.8 + 1.4) | 火约 1.1、蚀约 1.0（按每发） |
| 三才转轮 | 66.3 | 42 × 6 ÷ (2 + 1.8) | 三种各 0.45 |
| 贯虹灵炮 | 86.1（满蓄） | 155 × 6 ÷ (8.4 + 2.4) | 物理；随机元素时 0.25 |
| 蚀蛊灯 | 62.9（含蚀化约 75） | 55 × 8 ÷ (5 + 2) | 蚀 0.96/被命中的人 |

现有基准 60–90（范围 / 穿透 / 追踪 70–78，单体精准 85–95）。全部落在区间内。

### 8.2 单次反应参考值

| 反应 | 公式 | 第一章（S≈1.2，Pin≈50） | 第三章（S≈2.7，Pin≈134） | 上下限（第一章 / 第三章） |
|---|---|---|---|---|
| 焚雷 | B = clamp(Pin) | 中心 50 × 火对生命 1.25 ≈ 62；周围每人 0.6B ≈ 30 + 灼烧 10 | B 134，中心约 168 | 17–96 / 38–216 |
| 熔金 | B = clamp(Pin) | 对护甲 ×3.2 ≈ 160（第一章铁甲盾卫护甲 140–190）；熔池 6 × 6 | 对护甲约 430 | 17–120 / 38–270 |
| 封脉 | B = clamp(Pin) | 对护盾 ×3.2 ≈ 160（第二章巫祝护盾约 152）；导流 3 × 15 | 对护盾约 430 | 17–108 / 38–243 |
| 归墟 | B = clamp(1.5 Pin) | 75（下限 48），三段分摊 | 201，上限 864 | 48–384 / 108–864 |

首领：第三章熔心魔将约 13k 生命 + 3.3k 护盾 + 4.9k 护甲，单次归墟最多约 4% 总耐久，冷却 6 秒，不会秒首领；封脉对首领只给 +12% 易伤，不眩晕。

### 8.3 典型构筑的期望增益（蒙特卡洛）

模拟脚本：会话临时目录 `scratchpad/final/sim2.cjs` + `run2.cjs`（由 `rx_sim.cjs` 改写），每组 40 次 × 60 秒，dt 0.01。计入元素层倍率、持续伤害、蚀化易伤、雷殛标记 / 弹射、英雄技能附着（赤狐燃爆雷每 4 秒一次灼烧 150；雷隼信标每 0.5 秒雷殛 45、60% 在场；岩熊裂地每 4.5 秒），不计暴击。「群」= 中心目标周围平均 1.5 名敌人。武器档位：第一章精良 +1 级（×1.29）；第三章史诗 +3 级 + 玩家伤害 +30%（×2.83）+ 元素触发率 +5%。秘卷档位：第一章典型 = 催化 ×1 + 对应符 ×1（反应伤害 ×1.21）；第三章专精 = 催化 ×3 + 对应符 ×3 + 灵动 ×2（×1.69，急速 +20%）。

| 构筑 | 第一章 无秘卷 单体 / 群 | 第一章 典型 单体 / 群 | 第三章 无秘卷 单体 / 群 | 第三章 专精 单体 / 群 | 反应/秒 |
|---|---|---|---|---|---|
| 三相流·三才转轮 | +26% / +39% | +32% / +48% | +28% / +43% | +54% / +79% | 0.57–0.68（归墟 0.10–0.11） |
| 熔金·赤蛟霰铳 | +19% / +23% | +23% / +28% | +17% / +20% | +28% / +34% | 0.46–0.51 |
| 封脉·青冥雷蛊 | +28% / +39% | +33% / +47% | +28% / +40% | +48% / +67% | 0.32–0.33 |
| 赤狐 + 青冥雷蛊（三元素齐备） | +21% / +36% | +29% / +47% | +34% / +51% | +64% / +91% | 0.86–0.88 |
| 赤狐 + 贯虹灵炮（副·雷） | +26% / +45% | +32% / +55% | +33% / +55% | +57% / +96% | 0.57–0.60（另有崩解 0.53） |
| 赤狐 + 雷弧发射器 | +6% / +14% | +8% / +17% | +9% / +19% | +17% / +36% | 0.49–0.65 |
| 雷隼 + 蚀蛊灯 | +12% / +18% | +15% / +21% | +10% / +15% | +14% / +21% | 0.40–0.43 |
| 雷隼 + 朱雀吐息 | +13% / +24% | +16% / +30% | +10% / +19% | +20% / +39% | 0.44–0.59 |
| 岩熊 + 赤蛟霰铳 + 熔岩撼地 | +14% / +17% | +17% / +21% | +12% / +15% | +21% / +26% | 0.52–0.55 |
| 岩熊 + 碎岩霰弹 + 熔岩撼地 | +10% / +13% | +12% / +15% | +7% / +9% | +12% / +15% | 0.23 |
| 非专精：赤铜左轮（火）+ 副·雷 | +11% / +23% | +13% / +28% | +11% / +23% | +22% / +46% | 0.33–0.39 |
| 非专精：裂风步枪（雷）+ 副·焚 | +6% / +13% | +8% / +16% | +7% / +15% | +13% / +26% | 0.31–0.38 |
| 对照：赤铜左轮（火），无第二元素 | 0% | 0% | 0% | 0% | 0 |

破层 / 击杀时间：

| 场景 | 无反应 | 有反应 |
|---|---|---|
| 第一章铁甲盾卫（生命 198 + 护甲 174）· 赤蛟霰铳 | 1.80 秒 | 1.42 秒（−21%） |
| 同上 · 三才转轮 | 1.92 秒 | 1.53 秒（−20%） |
| 同上 · 岩熊 + 赤蛟霰铳 + 熔岩撼地 | 1.00 秒 | 0.91 秒 |
| 第三章精英巫祝（生命 702 + 护盾 624）· 青冥雷蛊 | 破盾 1.21 / 击杀 2.79 秒 | 破盾 0.84 / 击杀 1.91 秒（−32%） |
| 同上 · 雷隼 + 蚀蛊灯 | 破盾 1.06 / 击杀 2.57 秒 | 破盾 0.32 / 击杀 1.77 秒（−31%） |
| 第三章首领（单体）· 三才转轮 | 484 DPS | 620（+28%），专精 744（+54%） |
| 第三章首领 · 赤狐 + 贯虹灵炮 | 608 DPS | 808（+33%），专精 954（+57%） |

结论：

- 不刻意构筑时，现有内容（雷弹、万象、两把不同元素的枪）+ 一条副元素词条就能拿到单体 +6–13%、群战 +13–28%，鼓励混搭元素但不强迫。
- 第三章投入 8 层反应秘卷：单体 +14–64%（每层约 2–8%），群战 +21–96%。对照「炎心 ×4 = 纯火 +60%」、「利刃 ×5 = 武器 +30%」，处于同一量级，「值得追求但不碾压」。
- 雷隼两套构筑数字偏低：封脉的价值在破盾、眩晕、减速与首领易伤，模拟未计控制收益；破盾时间缩短 70%。实测偏弱，已把封脉冷却从 1.5 秒降到 1.2 秒（2026-10-03）。
- 第三章顶尖构筑（赤狐 + 青冥雷蛊 / 贯虹灵炮）专精后单体约 +60%，是本次的「旗舰」，上限由反应上限 `cap × S` 与逐敌冷却兜底。

### 8.4 频率与安全阀

- 单个敌人的理论最高反应频率（急速 0）：焚雷 1.0/秒、熔金 0.83/秒、封脉 0.83/秒、归墟 0.17/秒。急速最高约 +80%（灵动 ×4 + 混元），焚雷冷却降到 0.56 秒。
- 万象：附着引发的反应威力 ×0.6，且多数落在下限 14S 附近。
- 封脉眩晕独立 3.5 秒冷却（不吃急速），普通敌人眩晕覆盖率 ≤ 20%；精英 ×0.75；首领不眩晕。
- 每帧接受 8 次反应、大爆炸特效 3 个、浮字 4 个、熔池 4 个、队列 32 条。

### 8.5 调参旋钮（按优先级）

1. 焚雷周围份额 0.6 与扩散灼烧 0.2B（群战超过 +100% 时先降这两项）。
2. 各反应上限 `cap × S`（控制高单发武器：贯虹灵炮、赤蛟霰铳合并附着）。
3. k 系数（1.0 / 1.0 / 1.0 / 1.5，控制单体）。
4. 逐敌冷却（控制频率）。
5. 副元素归一化基数 3.5 与固有副元素数值。
6. 催化与各符每层数值（8% / 12%）。

实测先看 `window.__rx`（debug 计数器：每秒接受 / 丢弃的反应数、各反应计数），再看击杀时间：第一章普通敌人仍应 1–3 秒击杀、首领战 60–120 秒；专精反应构筑下首领战不短于 50 秒。

---

## 9. 引擎改动清单（按工作流）

> 契约阶段（第 10 节）先落地；之后 A–E 五条流并行，各自只改自己的独占文件。

### 9.A 反应系统（combat / fx）

**新文件 `src/combat/Reactions.ts`（约 450 行）**

```ts
export const MAX_REACTION_DEPTH = 2, FRAME_BUDGET = 8, BIG_FX_BUDGET = 3, LABEL_BUDGET = 4,
  CASCADE_DELAY = 0.15, ABYSS_WINDUP = 0.35, MAX_POOLS = 4, QUEUE_CAP = 32, ICD_FLOOR = 0.3,
  DETONATE_ICD = 0.5, SEAL_STUN_ICD = 3.5;
export const REACTION_TUNING: Record<ReactionId, { k: number; floor: number; cap: number; icd: number }> = {
  thunderfire: { k: 1.0, floor: 14, cap: 80, icd: 1.0 },
  meltdown:    { k: 1.0, floor: 14, cap: 100, icd: 1.2 },
  veinseal:    { k: 1.0, floor: 14, cap: 90, icd: 1.5 },
  abyss:       { k: 1.5, floor: 40, cap: 320, icd: 6.0 },
};
export const PAIR_PRIORITY: readonly ReactionId[] = ['thunderfire', 'meltdown', 'veinseal'];
export function pairOf(a: StatusId, b: StatusId): ReactionId | null;           // 纯函数
export function reactionBase(id: ReactionId, pin: number, S: number): number;  // 纯函数：clamp(k×pin, floor×S, cap×S)

export interface ReactionHost {           // 由 Combat 实现
  damageEnemy(enemy: IEnemy, req: DamageRequest): DamageResult | null;
  explode(center: THREE.Vector3, radius: number, req: DamageRequest, opts?: ExplosionOptions): number;
  attachFromReaction(enemy: IEnemy, sid: 'burn' | 'shock' | 'corrode', power: number, depth: number, weaponUid?: number): void;
}
export interface AttachSource { weaponUid?: number; scale?: number; point?: THREE.Vector3 }

export class ReactionSystem {
  constructor(ctx: GameContext, host: ReactionHost, status: StatusSystem, feedback: HitFeedback);
  tryReact(enemy: IEnemy, incoming: StatusId, pin: number, depth: number, src: AttachSource | null, killed: boolean): ReactionId | null;
  trigger(enemy: IEnemy, id: ReactionId, power: number, opts?: TriggerReactionOpts): boolean;   // ICombat.triggerReaction
  detonate(enemy: IEnemy, opts: DetonateOpts): DetonateOutcome | null;                            // ICombat.detonate
  flush(): void;          // Combat.update 开头：执行 at <= now 的条目，执行完逐条 emit 'enemy:reaction'
  vulnMult(enemy: IEnemy): number;   // 封脉首领脉滞 1.12
  clear(): void;
}
```

- 内部：`icd: WeakMap<IEnemy, Partial<Record<ReactionId | 'sealStun' | 'detonate', number>>>`（存「就绪时刻」）；`vuln: WeakMap<IEnemy, number>`；`queue / spare: Pending[]`；`pools: Pool[]`；按 `ctx.time.frame` 重置的 `used / bigFx / labels` 帧计数。
- `Pending = { kind: 'reaction' | 'collapse'; id: ReactionId; collapse: StatusId | null; enemy; point: Vector3（clone）; pin; depth; weaponUid?; scale; fixedBase: number | null; mult; cash; killed; at; origin; tag? }`。
- 伤害请求的 tags 用模块级静态数组（`TAGS.thunderfire = ['reaction','thunderfire']`、`TAGS.pool = ['reaction','meltdown','dot']`、`TAGS.collapse = ['reaction','collapse']` 等），热路径不分配；向量用模块级临时变量，`point` 传给 damageEnemy 时 clone。
- 浮字：`feedback.reactionLabel(enemy, 头顶 + 0.6, REACTION_NAMES[id], REACTION_COLORS[id], id === 'abyss')`。
- debug：`ctx.game.debug` 时 `window.__rx = { accepted, dropped, byId, perSec }`。

**`src/combat/Combat.ts`（约 90 行）**

- 字段 `private readonly reactions: ReactionSystem`，构造函数在 status / feedback 之后创建（`new ReactionSystem(ctx, this, this.status, this.feedback)`）。
- `update(dt)`：`this.reactions.flush(); this.feedback.flush(); this.status.update(dt); this.feedback.flush();`；`clear()` 加 `this.reactions.clear()`。
- 私有 `attach(enemy, sid, power, depth, src, killed, duration?)`：burn/shock/corrode 先 `rx = reactions.tryReact(...)`；然后 `killed` 时只做雷殛 `chainFrom`，否则 `status.apply(enemy, sid, power, duration, depth)`；返回 `{ rx, applied }`。第 4 步改为调用它并写 `result.reaction = rx`、`result.statusApplied`。
- 公开 `attachFromReaction(...)`（实现 `ReactionHost`，不在 ICombat 上）= `attach(enemy, sid, min(power, maxHp × 0.5), depth, { weaponUid }, false)`。
- `applyStatus(enemy, id, power, duration?, opts?)`：burn/shock/corrode → `attach(enemy, id, min(power, maxHp × 0.5), opts?.depth ?? 0, { weaponUid: opts?.weaponUid, scale: opts?.reactionScale }, false, duration)`；stun/slow → `status.apply(enemy, id, power, duration, opts?.depth ?? 0)`。现有调用不传 opts，行为不变（多了反应判定）。
- `triggerReaction` / `detonate` 转发给 ReactionSystem。
- 第 2 步倍率与 `previewMultiplier` 都乘 `this.reactions.vulnMult(enemy)`。
- 吸血保持只认 `source === 'weapon'`。

**`src/combat/Status.ts`（约 35 行）**

- `consume(enemy, id: 'burn' | 'shock'): number`：burn 返回 `sum(burnPowers) × BURN_RATIO × ceil(remaining / BURN_TICK)`（≤ 1.76 × Σ），清空 `burnPowers` 并删除状态；shock 删除并返回 0。
- `dotRemaining(enemy, id: 'burn' | 'corrode'): number`：同上公式（蚀化用 `power × CORRODE_RATIO × ceil(remaining / CORRODE_TICK)`），不修改状态。
- 蚀化不提供 consume（设计上永不被消耗）。

**`src/combat/DamageCalc.ts`（约 8 行）**

- `import { REACTION_TAG } from '../core/types'` 并 re-export。
- `isDot(req) = req.source === 'status' && !hasTag(req, 'chain') && (!hasTag(req, REACTION_TAG) || hasTag(req, 'dot'))`。
- `statMultiplier` 开头：`if (hasTag(req, REACTION_TAG)) return stats.mult('reactionDamagePct');`。

**`src/combat/Feedback.ts`（约 25 行）**

- `reactionLabel(enemy, pos, text, color, big)`：同一敌人 0.3 秒节流、每帧最多 4 条（`syncFrame` 计数），直接 `ctx.fx.damageNumber(pos, 0, { kind: 'reaction', text, color, big })`。

**`src/fx/DamageNumbers.ts`（约 30 行）**

- `kind === 'reaction'`：允许 amount 为 0、不参与合并、`life = 0.9`、文本取 `opts.text`、颜色取 `opts.color`（hex → css），类名 `fx-dn fx-dn-reaction`（`big` 时再加 `fx-dn-reaction-big`）。
- `DN` 新增 `text: string` 字段（合并逻辑跳过 reaction）；注入的 CSS 增加：`.fx-dn.fx-dn-reaction { font-size: 18px; font-weight: 800; letter-spacing: 2px; }`、`.fx-dn.fx-dn-reaction-big { font-size: 22px; }`。样式写在本文件的内联 CSS 里，不改 ui/css。

### 9.B 新武器（weapons：defs / system / firing / viewmodel / models / describe）

- `WeaponDefs.ts`：6 个 def（第 3 节）；文件头注释改为 17 把。
- `WeaponSystem.ts`：元素轮转（shoot 前后设 / 复位 `ballistics.elementOverride`、`cycleIndex` 自增、`finishReload` 归零）；`'charge'` 模式（第 3.5 节）与 `chargeProgress` getter；`shoot(..., shot)`；疾化射速；`roll()` 加权；`updateViewmodel` 的 `elementHint` / `firing` / `spin`；`vmState` 字面量补 `elementHint: null`；`stopActions` 清蓄力。
- `Firing.ts`：`elementOverride`、`el(inst)`、`shotColor(inst, el?)`、`ShotMods` / `NO_SHOT` 导出、trace 的穿透加成 / 满蓄引爆 / 曳光宽度、projectile 的 `bounces` 透传与元素颜色。
- `Viewmodel.ts`：`ViewmodelState.elementHint` 与能量槽改色（约 6 行）。
- `WeaponModels.ts`：6 个 `buildXxx` + `PALETTES` + `BUILDERS`（第 3 节）。
- `Describe.ts`：三相轮转元素行与 `elementLabel = '三相'`；蓄力武器的伤害 / 射速 / 秒伤显示。
- 武器流只经 `ctx.combat`（`detonate`）与战斗交互，不 import combat 具体类；不改 Affixes / WeaponStats / AffixEffects（它需要的 `rxnHaste` 字段与 `WeaponRuntime` 字段已在契约阶段落地）。

### 9.C 词条与传说（weapons：Affixes / WeaponStats / AffixEffects）

见第 4、5 节。不改 WeaponDefs / WeaponSystem / Firing（所需 def 字段已预落地；`rxnHasteUntil` 由本流写、武器流读）。

### 9.D 秘卷（progression）

`scrolls/defsReaction.ts`（新，24 个）、`ScrollDefs.ts`（注册）、`Scrolls.ts`（6.4 权重）。不 import combat 或 weapons，只用 `ctx.*` 与契约类型 / 常量。

### 9.E UI 与文档

- `src/ui/EnemyBars.ts`：`create()` 里 `stacks: [0, 0, 0, 0]` 改为 `STATUS_BADGES.map(() => 0)`；`syncStatus` 统计 burn/shock/corrode 种数 `n`，给状态行 `gf-ebar__status` 切换类名 `is-reactive`（n === 2）与 `is-primed`（n === 3），只在变化时写 DOM（`BarSlot` 加 `reactState` 字段缓存）。
- `src/ui/css/combat.css`：`.gf-ebar__status.is-reactive .gf-ebar__badge:not([hidden])` 加 1.2 秒呼吸外发光；`.gf-ebar__status.is-primed` 改为紫色 `#c89bff` 外发光，并加快到 0.6 秒——提示「再补一种就是归墟」。另加准星蓄力环样式 `.gf-xhair__charge`（圆环，`--p` 控制进度，`is-full` 时金色 `#ffe08a`）。
- `src/ui/Crosshair.ts`：在 `gf-xhair` 下创建 `gf-xhair__charge`；`update()` 读 `ctx.weapons.chargeProgress ?? 0`，>0 时显示并设 `--p`，=1 时加 `is-full`；值不变不写 DOM。
- `src/ui/HUD.ts` 与 `src/ui/InventoryPanel.ts`：元素徽记优先用 `ctx.weapons.describe(w).elementLabel`。HUD：有 elementLabel 时文本取其首字（「三」）并给徽记加类名 `is-tri`，没有时沿用 `ELEMENT_GLYPH` 并移除 `is-tri`；只在武器变化时重算（沿用已有缓存条件）。InventoryPanel：显示「三相 轮转」，颜色用 `#e8d6a0`。`is-tri` 的样式写在 `src/ui/css/hud.css`：`.gf-weapon__elem.is-tri { background: linear-gradient(135deg, #ff6a1f, #6fd8ff, #9dff4a); color: #111; }`。
- 新文件 `src/ui/ReactionTips.ts` + 在 `src/ui/UI.ts` 的 `init()` 中创建：监听 `'enemy:reaction'`，每局每种反应第一次出现时 `ctx.run.flags['rx:' + id] = 1` 并 `this.toast(...)`，颜色取 `REACTION_COLORS`：
  - 焚雷：「元素反应「焚雷」：灼烧 × 雷殛 → 雷火爆炸，点燃周围敌人」
  - 熔金：「元素反应「熔金」：灼烧 × 蚀化 → 熔穿护甲，留下熔池」
  - 封脉：「元素反应「封脉」：雷殛 × 蚀化 → 击碎护盾，麻痹并导流蚀化」
  - 归墟：「元素反应「归墟」：三相齐聚 → 三段重击，余波震退」
- `DESIGN.md`：第 5 节追加「5.1 元素反应」（第 2.1–2.7 节的规则表与防递归规则摘要）；第 7 节武器表补 6 行；第 10 节注明「反应秘卷 24 个（`defsReaction.ts`），共 98 个」；第 14.4 节记录本次契约变更清单。
- 不碰：`HeroSelect.ts`、`HeroPreview.ts`、`heroPreview/**`、`css/panels.css`、`css/menu.css`、`css/base.css`、`labels.ts`。

---

## 10. 契约变更（必须先于 A–E 落地，一次性提交）

所有新增字段均为可选或新键，向后兼容；落地后 `npm run typecheck` 必须通过（含下面的编译桩）。

### 10.1 `src/core/types.ts`

1. `StatKey` 元素段末尾追加：`| 'reactionDamagePct' | 'reactionHaste'`。
2. 在 `export type StatusId = ...;` 之后插入：

```ts
// ───── 元素反应（docs/arsenal-expansion.md 第 2 节） ─────
export type ReactionId = 'thunderfire' | 'meltdown' | 'veinseal' | 'abyss';
export const REACTION_IDS: readonly ReactionId[] = ['thunderfire', 'meltdown', 'veinseal', 'abyss'];
export const REACTION_NAMES: Record<ReactionId, string> = { thunderfire: '焚雷', meltdown: '熔金', veinseal: '封脉', abyss: '归墟' };
export const REACTION_COLORS: Record<ReactionId, number> = { thunderfire: 0xffd84a, meltdown: 0xff7a1a, veinseal: 0x5affd0, abyss: 0xc89bff };
/** 反应伤害请求统一带的标签（第二个标签为反应 id） */
export const REACTION_TAG = 'reaction';
/** 引爆结果：引发了某个反应，或单一状态的「崩解」 */
export type DetonateOutcome = ReactionId | 'collapse';
export interface StatusApplyOpts {
  /** 这次附着的 procDepth（缺省 0；>= 2 不会引发反应；只有 0 会触发雷殛弹射） */
  depth?: number;
  /** 归属武器（由它引发的反应带上该 weaponUid） */
  weaponUid?: number;
  /** 由这次附着引发的反应威力倍率（缺省 1；「万象」传 0.6） */
  reactionScale?: number;
}
export interface TriggerReactionOpts {
  depth?: number;
  weaponUid?: number;
  /** 反应中心；敌人已死时必须提供 */
  point?: THREE.Vector3;
  /** 无视该敌人该反应的内置冷却 */
  ignoreIcd?: boolean;
  /** 直接指定反应威力 B（跳过 k × power 与上下限） */
  fixedBase?: number;
  /** 威力倍率（缺省 1） */
  scale?: number;
  /** 透传到 'enemy:reaction'.tag（'echo' / 'nirvana' / 'kalpa'） */
  tag?: string;
}
export interface DetonateOpts {
  /** 引爆这一击的强度（通常 = 该次实际伤害；内部钳到最大生命 × 0.5） */
  power: number;
  /** 强度倍率，缺省 1 */
  mult?: number;
  depth?: number;
  weaponUid?: number;
  point?: THREE.Vector3;
}
```

3. `DamageResult` 末尾追加（必须可选：BossBase.ts 与 Bomber.ts 手写了字面量）：
```ts
  /** 这一击的元素附着引发的反应（Combat 第 4 步写入，早于 'enemy:damaged'） */
  reaction?: ReactionId | null;
```
4. `GameEvents` 追加：
```ts
  /** 反应效果执行完毕后派发（不在伤害管线内，监听者可以直接造成伤害）。point 为复用向量，保存请 clone */
  'enemy:reaction': { enemy: IEnemy; reaction: ReactionId; point: THREE.Vector3; base: number; depth: number; hits: number; weaponUid?: number; origin: 'status' | 'detonate' | 'forced'; tag?: string; centerKilled: boolean; stunned: boolean };
```
5. `ICombat`：把 `applyStatus` 一行替换为下面三行：
```ts
  /** 直接施加状态。burn/shock/corrode 会先判定元素反应；不会同步造成伤害，可在任意事件回调里调用 */
  applyStatus(enemy: IEnemy, id: StatusId, power: number, duration?: number, opts?: StatusApplyOpts): void;
  /** 强制引发一次反应（不需要也不消耗状态）；被预算 / 深度 / 冷却拒绝时返回 false。只入队，不同步造成伤害 */
  triggerReaction(enemy: IEnemy, id: ReactionId, power: number, opts?: TriggerReactionOpts): boolean;
  /** 引爆敌人身上已有的元素状态。只入队，不同步造成伤害 */
  detonate(enemy: IEnemy, opts: DetonateOpts): DetonateOutcome | null;
```
6. `DamageNumberOpts`：`kind?: DamageLayer | 'heal' | 'player' | 'immune' | 'reaction';`，并追加 `text?: string; color?: number; big?: boolean;`。
7. `WeaponDescription` 追加：`/** 元素的特殊显示（如三才转轮的「三相」）；有值时 UI 用它代替元素单字 */ elementLabel?: string;`。
8. `IWeaponSystem` 追加：`/** 蓄力武器的当前蓄力进度 0..1（非蓄力 / 未蓄力为 0） */ readonly chargeProgress?: number;`。

### 10.2 `src/core/Stats.ts`

- `BASE_STATS` 在 `corrodeDamagePct: 0,` 后加：`reactionDamagePct: 0, reactionHaste: 0,`。
- `STAT_INFO` 在 `corrodeDamagePct` 后加：`reactionDamagePct: { name: '反应伤害', format: 'pct' }, reactionHaste: { name: '反应急速', format: 'pct' },`。

### 10.3 编译桩（保证契约落地后即可通过 typecheck，A 流随后替换为正式实现）

- `src/combat/Combat.ts`：
  - import 增加 `DetonateOpts, DetonateOutcome, ReactionId, StatusApplyOpts, TriggerReactionOpts`；
  - `applyStatus(enemy: IEnemy, id: StatusId, power: number, duration?: number, opts?: StatusApplyOpts): void { this.status.apply(enemy, id, power, duration, opts?.depth ?? 0); }`；
  - 新增 `triggerReaction(_e: IEnemy, _id: ReactionId, _p: number, _o?: TriggerReactionOpts): boolean { return false; }`；
  - 新增 `detonate(_e: IEnemy, _o: DetonateOpts): DetonateOutcome | null { return null; }`。
- `src/fx/DamageNumbers.ts`：`type Kind = DamageLayer | 'heal' | 'player' | 'immune' | 'reaction';`，`LAYER_CSS` 加 `reaction: '#ffd84a'`。

### 10.4 weapons 模块内部共享接口（B、C 两条流都依赖，先落地）

- `src/weapons/WeaponDefs.ts`：
  - `FireMode` 加 `| 'charge'`；
  - `ProjectileParams` 加 `/** 撞墙反弹次数 */ bounces: number;`，`def()` 的投射物默认值加 `bounces: 0,`；
  - `WeaponDef` 加字段：`innate: { id: string; value: number }[]; cycle: Element[] | null; chargeTime: number; chargeMinMult: number; chargeFullPierce: number; chargeDetonate: boolean; dropWeight: number;`（带第 3.0 节注释）；
  - `DefInput` 的 `Omit<...>` 与 `Partial<Pick<...>>` 两个列表都加 `'innate' | 'cycle' | 'chargeTime' | 'chargeMinMult' | 'chargeFullPierce' | 'chargeDetonate' | 'dropWeight'`；
  - `def()` 默认值加 `innate: [], cycle: null, chargeTime: 0, chargeMinMult: 0.2, chargeFullPierce: 0, chargeDetonate: false, dropWeight: 1,`（放在 `...d` 之前）。
- `src/weapons/AffixEffects.ts`：`WeaponRuntime` 加 `/** 元素轮转进度（三才转轮） */ cycleIndex: number; /** 「疾化」射速加成截止时间 */ rxnHasteUntil: number;`。
- `src/weapons/WeaponSystem.ts`：`runtime()` 的初始化字面量加 `cycleIndex: 0, rxnHasteUntil: -99`。
- `src/weapons/WeaponStats.ts`：`ResolvedWeapon` 加 `/** 「疾化」射速加成（AffixEffects 写 rt.rxnHasteUntil，WeaponSystem 读取） */ rxnHaste: number;`，`blank()` 加 `rxnHaste: 0`。

### 10.5 `src/ui/labels.ts`（只追加；先读最新内容，不动未提交的 HERO_META 等改动）

`WEAPON_NAMES` 追加：
```ts
  flamer: { name: '朱雀吐息', category: '喷火器' },
  stormpod: { name: '青冥雷蛊', category: '发射器' },
  magmashot: { name: '赤蛟霰铳', category: '霰弹枪' },
  trinity: { name: '三才转轮', category: '手枪' },
  railgun: { name: '贯虹灵炮', category: '蓄能炮' },
  lantern: { name: '蚀蛊灯', category: '蛊灯' },
```

---

## 11. 工作流拆分与接口归属

| 流 | 标题 | 独占文件 | 对应章节 | 依赖 |
|---|---|---|---|---|
| A | 反应系统 | `src/combat/Reactions.ts`（新）、`src/combat/Combat.ts`、`src/combat/Status.ts`、`src/combat/DamageCalc.ts`、`src/combat/Feedback.ts`、`src/fx/DamageNumbers.ts` | 1、2、9.A | 契约 |
| B | 新武器与开火机制 | `src/weapons/WeaponDefs.ts`、`WeaponSystem.ts`、`Firing.ts`、`Viewmodel.ts`、`WeaponModels.ts`、`Describe.ts` | 3、7（武器部分）、9.B | 契约 |
| C | 词条与传说 | `src/weapons/Affixes.ts`、`WeaponStats.ts`、`AffixEffects.ts` | 4、5、9.C | 契约 |
| D | 秘卷 | `src/progression/scrolls/defsReaction.ts`（新）、`src/progression/ScrollDefs.ts`、`src/progression/Scrolls.ts` | 6、7（秘卷部分）、9.D | 契约 |
| E | UI 与文档 | `src/ui/EnemyBars.ts`、`src/ui/Crosshair.ts`、`src/ui/HUD.ts`、`src/ui/InventoryPanel.ts`、`src/ui/ReactionTips.ts`（新）、`src/ui/UI.ts`、`src/ui/css/combat.css`、`src/ui/css/hud.css`、`DESIGN.md` | 9.E | 契约 |

跨流接口（都由契约阶段提供类型，运行期才互相生效；任何一条流单独合入都能编译）：

- `ctx.combat.applyStatus(opts)` / `triggerReaction` / `detonate` / `'enemy:reaction'`：A 实现；B（贯虹灵炮）、C（词条传说）、D（秘卷）、E（提示）调用或监听。A 合入前它们是桩，调用不报错只是没有效果。
- `ResolvedWeapon.rxnHaste` + `WeaponRuntime.rxnHasteUntil`：C 计算与写入，B 读取（WeaponSystem 射速）。
- `WeaponDef.innate / cycle / charge* / dropWeight`：B 填数据；C 的 `rollAffixes` 读 `innate`、词条 allow 读 `cycle / mode / chargeDetonate`。
- `WeaponDescription.elementLabel`、`IWeaponSystem.chargeProgress`：B 提供，E 读取。
- `WeaponRuntime` 只由契约阶段扩展；C 的其他运行时状态放在 AffixEffects 私有 WeakMap，B 的蓄力状态放在 WeaponSystem 私有字段，互不改对方文件。
- `ui/labels.ts`：只在契约阶段追加 `WEAPON_NAMES`；之后任何流都不改。

---

## 12. 验证

- 每条流：`npm run typecheck`。
- 集成后 `npm run dev`，URL 加 `?debug`，控制台：
  - `__ctx.weapons.give(__ctx.weapons.roll({ defId: 'trinity', rarity: 2 }))`、`'railgun'`、`'stormpod'` 等；
  - `__ctx.scrolls.add('rx_tf_capstone')`（多次调用即升层）；F3 测三选一，F4 掉武器。
- 核对清单：
  - 两把不同元素的枪交替打同一敌人，依次出现「焚雷 / 熔金 / 封脉」浮字与特效；同一敌人冷却生效；三种齐聚时出现紫色预警与「归墟」。
  - 万象 + 旋风机炮时 `window.__rx` 每帧接受不超过 8；爆炸特效不超过 3。
  - 换关后熔池、归墟预警、延时反应不会回调或残留。
  - 焚城榴弹 / 蜂群飞弹上的命中回盾、击杀回填、猎首、狂热、万象、连环爆开始生效（缺陷修复）。
  - 三才转轮灵纹颜色与下一发元素一致，换弹后从灼烧开始；贯虹灵炮准星蓄力环、满蓄提示音、满蓄穿透与「崩解 / 反应」引爆。
  - 首领：封脉不眩晕，只出现易伤；单次归墟不超过总耐久约 4%。

---

## 13. 风险与对策

1. **契约面较大**：一次性提交第 10 节全部改动（全为可选字段 / 新键 + 编译桩）。若被否决，降级为秘卷侧监听 `'enemy:statusApplied'` 自行判定反应（失去武器归属、浮字与引爆）。
2. **连锁失控**：深度 < 2、逐敌冷却、每帧 8 次 / 3 个大特效、次级反应 Pin 小（多落在下限）四重约束。群战增益超过 +120% 时先降焚雷周围份额 0.6，或把焚天雷狱改为「每层 50% 概率附加雷殛」。
3. **二次相乘**：反应伤害在 statMultiplier 里只乘 `reactionDamagePct`（Pin 已含其他加成）；后续不要「顺手」让它吃元素 / 精英加成。
4. **控制过强**：封脉眩晕独立 3.5 秒冷却、精英 ×0.75、首领不眩晕；镇岳只在本次封脉成功眩晕时延长。仍过强则把镇岳延长改为每层 +0.25 秒。
5. **修复爆炸武器缺陷的副作用**：焚城榴弹、蜂群飞弹会突然获得回盾 / 回填 / 万象 / 连环爆，蜂群 5 枚 × 连环爆尤其要实测；必要时让万象在爆炸伤害上的概率再 ×0.5。
6. **性能**：`fx.explosion` 很贵（点光源 + 约 250 粒子）→ 每帧 3 个预算；熔池 4 个；浮字 4 个；queryRadius 结果在伤害前拷贝；热路径用模块级临时向量与静态 tags 数组。
7. **重入与时序**：反应效果只在 flush 执行；`'enemy:reaction'` 在 flush 内效果之后派发；监听者施加的状态进入下一批。击杀那一击触发的反应在执行前检查 `alive`。
8. **可读性**：不新增状态小标；靠反应浮字、首次提示、血条状态行的「可反应 / 归墟就绪」发光、三才转轮灵纹改色、准星蓄力环。
9. **内容池稀释**：dropWeight、反应卷条件加权、词条 allow 过滤；首测后可能还需调权重。
10. **新机制边界**：元素轮转只覆盖 `shoot()` 分派（点射 / 齐射每发都推进计数，三才转轮是半自动无此问题）；蓄力武器没有 HUD 进度条以外的契约依赖；三才转轮的 `inst.element` 为 fire，掉落光柱 / 世界模型能量色显示为火，属已知取舍（HUD / 背包用 `elementLabel` 纠正）。
11. **归属盲区**：持续伤害、雷殛弹射、技能引发的反应没有武器归属，「本武器」类词条不触发——这是有意的（避免技能刷武器词条），文案已写明。
12. **并行冲突**：本设计不碰 `HeroSelect.ts`、`HeroPreview.ts`、`heroPreview/**`、`panels.css`、`menu.css`、`base.css`；`labels.ts` 只在契约阶段追加。
13. **模拟局限**：未计暴击、走位丢失目标、敌人分散度与护层混合；以 `window.__rx` 与第一章击杀时间（1–3 秒）、首领战时长（60–120 秒）为准，按 8.5 的旋钮顺序调整。

---

## 附录：三份方案评审与取舍

| 维度（1–5） | reaction-depth | build-archetypes | weapon-feel |
|---|---|---|---|
| 反应系统的趣味与清晰度 | 4（相印引导三相，但多一个概念） | 5（「两种相遇就炸、三种齐聚降天劫」一句话） | 4（消耗旧状态的节奏好，规则偏多） |
| 构筑多样性（三英雄都有流派） | 4 | 5（五流派，岩熊有技能入口） | 4（六流派，岩熊入口偏弱） |
| 新武器手感差异 | 3（两把双属手铳 / 步枪偏同质） | 4（喷筒、毒针、多段雷鞭） | 5（蓄力炮、交替双铳、空爆、符铳、蛊灯） |
| 实现可行性与改动面 | 4（钩子逐行核对，纯函数公式，约 1800 行） | 3（反应修饰器 API、两个新属性、statusPowerMult、章节门槛，改动面最广） | 3（蓄力 + ShotMods 贯穿 Firing、reactionMods 可变表） |
| 数值合理性 | 5（蒙特卡洛 + 破层时间） | 3（人群系数偏乐观） | 3（公式估算，无模拟） |
| 合计 | 20 | 20 | 19 |

主干：**reaction-depth**——Combat.attach 统一入口、ReactionSystem 入队 / flush、`Pin × k` 夹在 `floor·S ~ cap·S` 的公式、只乘 reactionDamagePct 的倍率规则、预算与归属、契约形态、AffixEffects 的同帧合并与爆炸武器缺陷修复、副元素 perHit 归一化、大部分反应符与流派卷、青冥雷蛊 / 赤蛟霰铳 / 三才转轮 / 朱雀吐息四把武器、涅槃 / 合璧两个传说。

嫁接：
- **build-archetypes**：两两反应**不消耗**状态、只有三元素反应消耗（复跑模拟证实主干的消耗规则会让持续灼烧构筑净亏 20–30%，因此采用）；「引爆」作为物理构筑入口；「引雷 / 引火 / 引蚀」启动卡；「轮回」传说；「化劫」；英雄流派表；秘卷的条件加权。
- **weapon-feel**：贯虹灵炮（蓄力，第二个新机制）与满蓄引爆；蚀蛊灯与「蛊种」传染；「鼎沸」传说；「点穴」；首次出现反应时的教学提示。

舍弃：相印标记（不消耗规则下三相自然叠出，状态小标已可读）；灵犀长铳、阴阳双铳、九霄雷鞭等（新机制名额 / 角色重叠）；反应修饰器 API、statusDurationPct、statusPowerMult（契约面过大）；连珠、惊蛰（与蛊种重叠 / 与破势形成暴击循环）。
