# 魔刀千刃 — 双形态近 / 中距离武器（设计稿）

> 状态：设计已与用户确认（2026-10-02）；技术实现方案见第 10 节（共享契约已落地）。按键：**右键切换形态，V（或鼠标中键）释放武器技能**；主动技能：**千刃·无间（突进连斩）**。
> 数值为初稿，实现与实测时可在 ±15% 内调整，但要保持 DESIGN.md 第 4 节的基准（普通稀有度身体 DPS 60–90；近战因风险更高，允许到约 105）。
> 依赖 docs/arsenal-expansion.md 的元素反应系统（`ctx.combat.detonate`）。

## 1. 概览

| 项 | 内容 |
|---|---|
| id | `demon_blade` |
| 名称 / 类别 | 魔刀千刃 / 刀 |
| 定位 | 近战爆发 + 中距离补刀；靠「斩」回收飞刃，再用「千刃」远程收割，循环往复 |
| 掉落 | 进入普通武器池（宝箱、商店、Boss 奖励），`dropWeight` 0.6（比普通武器少见） |
| 元素 | 与其他武器相同的随机元素规则（精良及以上 35% 带随机元素） |

## 2. 操作

| 按键 | 斩（近战形态） | 千刃（中距离形态） |
|---|---|---|
| 左键（按住连续） | 三段连斩 | 射出一扇 3 柄飞刃 |
| 右键 | 切换到「千刃」 | 切换到「斩」 |
| R | 无效果（不耗弹） | 召回飞刃（即换弹） |
| V / 鼠标中键 | 千刃·无间 | 千刃·无间 |

持有魔刀时右键**不再是开镜**（不写 `fovKick`）。切换形态有 0.25 秒变形动画，期间不能攻击。

## 3. 形态一「斩」（近战）

- 三段连斩：横斩 → 回斩 → 下劈。左键按住会自动接段；松开超过 0.6 秒连段重置。
  - 第 1、2 段：伤害 28，前摇 0.08 秒，整段 0.30 秒；判定为前方 3.2 米、水平 110° 的扇形（高度覆盖脚下到头顶上方 0.6 米）。
  - 第 3 段：伤害 54，前摇 0.14 秒，整段 0.46 秒；判定为前方 3.8 米、70° 的扇形，带强击退（6 m/s），玩家向前小幅突进 0.6 米。
  - 一轮约 1.06 秒，单体约 104 DPS；扇形内所有敌人都会被命中（群伤是近战的回报）。
- 每段对同一敌人只结算一次；挥空不消耗任何资源。
- **斩击回刃**：每段斩击命中的每名敌人召回 1 柄飞刃到弹匣（每段最多召回 3 柄），这是两个形态的核心循环。
- 暴击：使用正常暴击率（没有爆头概念）；第 3 段对眩晕中的敌人必定暴击。
- 持刀移速 +0.4（只在「斩」形态）。
- 伤害 `source: 'weapon'`，正常吃武器伤害加成、稀有度、强化、词条，并正常附着元素，因此能触发元素反应与命中类词条 / 秘卷。每段斩击视为一次「开火」，发出 `weapon:fired`，让「开火时 / 射击时」类效果生效。

## 4. 形态二「千刃」（中距离）

- 左键：一次射出 3 柄飞刃，呈 ±5° 小扇形；射速 2.0 轮 / 秒（半自动按住连发）。
- 每柄飞刃伤害 16，弹速 45 m/s，射程 24 米，穿透 1，暴击倍率 2.0（可爆头）。
- 弹匣 18 柄飞刃（= 6 轮）；R 或打空后自动「召回」，耗时 1.4 秒（换弹类词条与秘卷正常生效，「换弹时」触发也算）。
- 第一人称画面：刀身裂解成 18 片悬浮在手背后方的刃片，**刃片数量就是剩余弹药**；射出时刃片飞离，召回时飞回重组。
- 身体 DPS 约 65（中距离两柄命中的平均情况）。

## 5. 换形一击

- 切换形态后 2 秒内的第一次攻击伤害 +50%（「斩」为第一段斩击，「千刃」为第一轮飞刃）。HUD 武器槽边框发光、准星朱红脉动提示。
- 换形一击用掉后 1.5 秒内再变形不会打开新的窗口（防止连按右键「变形取消收势」让每一击都 +50%）。

## 6. 武器技能「千刃·无间」（V / 鼠标中键）

1. 向准星水平方向**瞬身突进 8 米**（0.18 秒，期间无敌、穿过敌人，被墙体阻挡时提前停下）。
2. 突进路径两侧 1.6 米内的敌人受到一次斩击（伤害 = 60 × 本武器伤害倍率），并被打上「刃印」。
3. 0.6 秒后，千刃从四面八方同时贯穿所有带刃印的敌人：每名敌人受到 140 × 本武器伤害倍率的伤害，然后调用 `ctx.combat.detonate(enemy, { power })`——身上有两种以上元素就**引爆元素反应**，否则造成「崩解」伤害（规则见 docs/arsenal-expansion.md 第 2.5 节）。
4. 每命中一名敌人召回 2 柄飞刃（最多补满弹匣）。
5. 冷却 16 秒，受「技能急速」影响；不论处于哪个形态都能释放，释放后保持当前形态。

「本武器伤害倍率」= 稀有度倍率 × 强化倍率 × 武器伤害类词条 / 属性（与 `resolveWeapon` 的结果一致）。

## 7. 词条兼容

- 数值类词条按形态生效：伤害、暴击、元素触发对两种形态都有效；弹匣、换弹、散布、后坐、弹速、穿透只影响「千刃」形态。
- 「斩」形态不应抽到只对枪有意义的词条组合：`allow()` 规则——`spread` / `recoil` / `projSpeed` 允许（作用于飞刃），`headBlast` 只作用于飞刃爆头；`swift` 两形态都生效。
- 传说特性：`lg_nth`（第 N 发必暴）对斩击按段计数；`lg_last`（最后一发 ×3）只作用于飞刃；`lg_endless`（不耗弹）只作用于飞刃。

## 8. 表现

- **模型**：约 1.1 米的弧形长刀。刀身暗钢色，刃口有朱红发光符纹；护手是兽首衔刃的造型；握把缠布，柄尾挂一条随动的红色流苏；刀身靠近护手处镶一颗元素色宝珠（无元素时为暗金）。
- **斩击**：每段有挥砍弧光（扇形拖尾面片，元素色或朱红），命中时有火花、短暂的顿帧（命中停顿约 40 毫秒，仅表现层）和轻微屏震。
- **千刃**：飞刃是旋转的小刃片，带细拖尾；召回时刃片从世界中飞回手边。
- **千刃·无间**：突进时残影与风压线；刃印是敌人身上的旋转红色刃环；爆发时数十柄刃从周围射入目标的特效。
- **HUD**：武器槽显示当前形态（「斩」/「千刃」）；「斩」形态弹药显示为 ∞；武器槽旁新增武器技能图标，带冷却环与按键提示 V。
- **音效**：新增挥砍破风声、斩击命中声、飞刃投掷声、召回声、突进声、千刃爆发声（程序化合成，接入 SfxId）。

## 9. 需要的引擎改动（实现时以当时的代码为准细化）

- `core/Input.ts`：新增动作 `weaponSkill`，默认绑定 `KeyV` 与鼠标中键（button 1）；主菜单「操作说明」（`ui/labels.ts` 的 `CONTROLS`）补充 V 与「持魔刀时右键切换形态」。
- `weapons/WeaponDefs.ts`：新增射击模式（例如 `melee`）或「形态」机制（一把武器两套参数），以及近战参数（各段伤害、时长、扇形、击退）。
- `weapons/WeaponSystem.ts`：形态切换、连段状态机、近战扇形判定（遍历 `ctx.enemies.list` 做距离 + 角度 + 视线检查）、斩击回刃、武器技能（冷却、突进、刃印、延迟爆发），以及切枪 / 死亡 / 换关时重置这些状态。
- `IWeaponSystem` / `WeaponDescription`：暴露当前形态、武器技能冷却（供 HUD）。
- 玩家位移（突进）需要 `ctx.player` 提供可控的位移 / 无敌接口；若没有，就在契约里新增最小接口。
- `Viewmodel.ts` / `WeaponModels.ts`：刀模型、三段挥砍动画、形态变形动画、刃片弹匣的可视化。
- `audio/`：新增音效。`ui/HUD.ts` / `ui/css/hud.css`：形态显示与武器技能图标。
- `DESIGN.md` 第 2 节（操作）与第 7 节（武器表）补充魔刀千刃。

---

## 10. 技术实现方案

> 状态：**共享契约已落地**（2026-10-02，清单见 10.12），`npm run typecheck` 与 `npm run build` 通过，现有 17 把武器行为不变。L / V / P 三条流均已实现并完成浏览器联调（2026-10-03），实现备注见 10.5、10.7、10.8、10.9、10.10 末尾，联调结果见 10.14。之后按代码 / 手感审查做了一轮修复（换形一击冷却、软突进与连段追击、两柄齐射的扇形、弧光两层与几何、屏震与镜头冲击、贯穿时序与视野外表现、悬浮阵重排、准星距离提示等），各节以「审查修复」标出；这一轮只做了类型检查与打包，尚未在浏览器里复测。
> 之后由 L（逻辑）/ V（表现）/ P（玩家·HUD·音效·文档）三条流并行实现（10.13），任何一条流单独合入都能编译运行。
> 本节数值是第 3–6 节落地后的精确值；实测调参仍允许 ±15%，但改动请同步本节的常量表。

### 10.0 关键决策

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| D1 | 一把武器两套参数怎么表达 | **根字段 = 远程形态「千刃」**（`mode: 'auto'`、投射物、弹匣、召回）；**`WeaponDef.melee: MeleeParams` = 近战形态「斩」**；`melee !== null` 即双形态武器。`FireMode` 新增 `'melee'`，但它只由 `formMode(def, form)` 返回，不写在任何 def 上 | 远程形态整套复用现有投射物 / 换弹 / 散布 / 词条（`resolveWeapon` 语义不变）；所有只读 `def.mode` 的旧代码（Affixes、Describe、HeroSelect）默认把魔刀当成一把普通投射物武器，零回归 |
| D2 | 千刃的「半自动按住连发、2 轮/秒」 | `mode: 'auto'`，`fireRate: 2` | 语义就是按住以 2 轮/秒连发；`'semi'` 需要逐次点击 |
| D3 | 「弹匣 18 柄 = 6 轮」 | 新字段 `perProjectileAmmo`：一轮每柄各耗 1 发，实际射出 `min(3, 余量)` 柄 | 现有 `shoot()` 每轮只耗 1 发（蜂群）；斩击回刃会让余量不是 3 的倍数，「刃片数 = 弹药」要求按柄计 |
| D4 | 召回不需要备弹 | 新字段 `recall: true`，`reserve: 0` | 备弹恒 0：弹药拾取（`needsAmmo`）、商店补弹、`addAmmoFraction` 自然跳过；HUD 显示 ∞ |
| D5 | 运行时状态放哪 | **形态 `form` 放 `WeaponRuntime`**（按实例，切走再切回保持）；变形、换形一击、连段放 **WeaponSystem 私有**；武器技能放 **新文件 `weapons/BladeSkill.ts`**（WeaponSystem 持有） | 形态是武器的「持久姿态」；其余都是瞬态，按 10.4.9 的规则重置 |
| D6 | 技能冷却按什么计 | **全局一条**（所有武器技能共用），不按实例 | 防止两把魔刀互切刷技能；与英雄技能一样换关不重置、开新局清零 |
| D7 | 射速加成是否影响斩击 | **影响**：攻速倍率 = `R.fireRateMult × 狂热 × 疾化`，整段时长 / 前摇 ÷ 倍率 | 设计稿第 7 节「数值类词条按形态生效」未列射速；按「射速 = 攻速」补齐，射速秘卷对近战流派有意义 |
| D8 | 斩击 / 技能伤害来源 | 一律 `source: 'weapon'`、`procDepth: 0`、`weaponUid`；吃 `damagePct`、吸血、命中类词条 / 秘卷、元素附着；**技能不吃 `skillDamagePct`**。请求带标签 `'slash'`（技能再加 `'weaponSkill'`），只做标识，不影响倍率 | 设计稿明确「本武器伤害倍率」；武器技能不是英雄技能 |
| D9 | 「每段对同一敌人只结算一次」 | **单判定帧**：前摇结束那一帧结算整段扇形 | 天然满足；不需要逐帧命中集合 |
| D10 | 技能回刃计数 | 突进斩击每命中 1 名敌人 +2（含被斩死的）；贯穿不再回刃 | 设计稿第 6.4 条的「命中」取第一次命中，避免双倍 |
| D11 | 「0.6 秒后」从何时算 | 从**突进结束**算 | 突进被墙挡住提前结束时，贯穿也相应提前 |
| D12 | 斩击的副元素 / 万象 / 弹射几率 | 按命中频率归一化（10.11 的 `meleeHitScale`） | 这些几率按千刃每秒 6 次命中归一化，斩击每秒约 2.8 次，不修正会减半 |
| D13 | 音效 | 设计稿 6 个 + 新增 `blade_morph`（变形）共 7 个 | 变形需要独立反馈 |

### 10.1 数值常量表

#### 10.1.1 `demon_blade` 定义（L 流追加到 `WEAPON_DEFS` 末尾）

```ts
def({
  id: 'demon_blade', name: '魔刀千刃', category: '刀', kind: 'blade', mode: 'auto',
  // ── 千刃（远程形态 = 根字段） ──
  damage: 16, fireRate: 2.0, mag: 18, reserve: 0, reloadTime: 1.4, reloadStyle: 'recall',
  recall: true, perProjectileAmmo: true,
  spreadHip: 0.006, spreadAim: 0.006, spreadPerShot: 0.004, spreadMax: 0.02, spreadRecovery: 0.12,
  recoil: { pitch: 0.006, yaw: 0.003, bias: 0, climb: 0 },
  critMult: 2.0, range: 24, pierce: 1,
  projectile: {
    speed: 45, radius: 0.12, lifetime: 0.54, visual: 'blade', scale: 1,
    count: 3, stagger: 0, fan: 0.0873 /* 5° */, fanFixed: true, color: 0xff3a24 /* 朱红 */,
  },
  element: 'none', elementChance: 0.17,
  aimFov: 0, sfx: 'blade_throw', sfxVolume: 0.7, knockback: 0.8,
  tracerWidth: 0, impactSize: 0.6, kick: { back: 0.025, rot: 0.04 }, shake: 0.03, flash: 0,
  viewOffset: [0.24, -0.24, -0.46], aimOffset: [0.24, -0.24, -0.46], worldScale: 1.4, dropWeight: 0.6,
  // ── 斩（近战形态） ──
  melee: {
    combo: [
      { damage: 28, windup: 0.08, duration: 0.30, range: 3.2, halfAngle: 0.9599 /* 55° */, knockback: 1.5, lunge: 0,   stunCrit: false, shake: 0.22 },
      { damage: 28, windup: 0.08, duration: 0.30, range: 3.2, halfAngle: 0.9599,           knockback: 1.5, lunge: 0,   stunCrit: false, shake: 0.22 },
      { damage: 54, windup: 0.14, duration: 0.46, range: 3.8, halfAngle: 0.6109 /* 35° */, knockback: 6,   lunge: 0.6, stunCrit: true,  shake: 0.5 },
    ],
    comboReset: 0.6, reachBelow: 0.3, reachAbove: 0.6, elementChance: 0.35,
    recallPerHit: 1, recallMaxPerSwing: 3, moveBonus: 0.4, formNames: ['斩', '千刃'],
    morphTime: 0.25, formStrikeWindow: 2, formStrikeMult: 1.5,
  },
  // ── 武器技能 ──
  skill: {
    kind: 'dashSlash', id: 'thousand_edge', name: '千刃·无间', glyph: '刃',
    description: '向准星水平方向瞬身突进 8 米（无敌、穿过敌人，被墙阻挡时提前停下），斩击路径两侧 1.6 米内的敌人并打上刃印；0.6 秒后千刃贯穿所有刃印目标并引爆其身上的元素状态。每命中 1 名敌人召回 2 柄飞刃。',
    cooldown: 16, dashDist: 8, dashTime: 0.18, iframes: 0.25, exitSpeed: 6,
    pathRadius: 1.6, slashDamage: 60, impaleDelay: 0.6, impaleDamage: 140, recallPerHit: 2, maxMarks: 24,
  },
  description: '妖魔铸就的弧形长刀，刀身可裂解为千柄飞刃。近身连斩召回飞刃，再化作刃雨远程收割。',
  notes: [
    '右键切换「斩」/「千刃」（0.25 秒），切换后 2 秒内的第一次攻击伤害 +50%',
    '「斩」：横斩 → 回斩 → 下劈，扇形内所有敌人都会被命中；每命中 1 名敌人召回 1 柄飞刃（每段最多 3 柄）',
    '「斩」：下劈对眩晕中的敌人必定暴击；持「斩」时移动速度 +0.4',
    '「千刃」：一次射出 3 柄飞刃（可爆头、穿透 1）；R 或打空后召回飞刃，不消耗备弹',
  ],
}),
```

说明：`lifetime 0.54 ≈ 24 / 45`（射程 24 米）；`fan` 为半角，3 柄 = −5° / 0° / +5°（余量只剩 2 柄时 ±2.5°，见 10.4.6）；`shake` 为 `ctx.fx.shake` 的强度（第 1、2 段 0.22 ≈ 狙击枪每发，第 3 段 0.5；原 0.05 / 0.14 实测不到 1 像素）；`aimFov 0`（魔刀永不开镜）；`flash 0`（无枪口火焰）；`elementChance 0.17`（飞刃每柄）与 `melee.elementChance 0.35`（斩击每次）使两种形态每秒附着约 1 次。

#### 10.1.2 基准核算（普通稀有度、无加成、身体命中）

| 项 | 计算 | 结果 |
|---|---|---|
| 斩一轮 | 0.30 + 0.30 + 0.46 | 1.06 秒 |
| 斩单体 DPS | (28 + 28 + 54) / 1.06 | **103.8**（≤ 105 的近战上限） |
| 千刃爆发 DPS | 16 × 3 × 2.0 | 96（`R.dps`，不含召回） |
| 千刃持续 DPS | 6 轮：0 … 2.5 秒，288 伤害；按住开火时打空立即召回 1.4 秒 → 周期 3.9 秒；松手则 0.25 秒后自动召回 → 4.15 秒 | **73.8 / 69.4**（三柄全中）；两柄约 49 / 46 |
| 换形一击 | 斩第一段 28 → 42；千刃第一轮 48 → 72；用掉后 `STRIKE_REARM` 1.5 秒内变形不再打开窗口 | +14 / +24 |
| 变形穿插（判定帧后变形取消收势） | 千刃一轮 48 → 变形 0.25 → 横斩 28 → 变形 0.25，一个循环约 0.61 秒 | 爆发约 125（单体每循环净耗 2 柄，约 5.5 秒后召回 1.4 秒，平均约 99）；换形一击每约 1.8 秒最多一次，再 +10 左右。修复前每个循环都吃换形一击，爆发约 187、平均约 145 |
| 技能单体 | 60 + 140（+ 引爆）每 16 秒 | 约 +12.5 DPS；群体时线性放大 |

#### 10.1.3 逻辑常量（L 流，WeaponSystem / `weapons/Melee.ts` / `weapons/BladeSkill.ts` 模块级）

| 常量 | 值 | 用途 |
|---|---|---|
| `MORPH_BUFFER` | 0.25 | 右键在不能变形时（判定帧前 / 切枪中）缓冲的秒数 |
| `MELEE_HUD_SPREAD` | 0.035 | 斩形态 `currentSpread` 的目标值（准星张开，提示近战） |
| `MELEE_CLOSE` | 0.35 | 敌人胶囊表面距玩家 ≤ 此值时不判扇形角度（只排除正后方：水平点积 < −0.3） |
| `KNOCK_LIFT` | 0.2 | 斩击击退方向的上抬分量（与水平单位向量相加后归一化） |
| `SEG_EXIT_SPEED` | 2 | 第三段前冲 / 连段追击结束后沿突进方向速度的下限（软突进：不低于突进开始时的速度，见 10.5） |
| `CHASE_REACH` / `CHASE_MARGIN` / `CHASE_MAX` | 1.2 / 0.2 / 1.4 | 连段追击：上一段命中、本段不自带前冲、扇形内没有敌人在攻击距离内但最近的敌人表面在 range + 1.2 内时，前摇中朝它软突进 min(1.4, 差距 + 0.2) 米 |
| `STRIKE_REARM` | 1.5 | 换形一击用掉后，至少隔这么久变形完成才再打开窗口 |
| `SLASH_SHAKE_TIME` | 0.13 | 斩击命中屏震时长（强度为 `MeleeSegment.shake`） |
| `SLASH_PUNCH` | `[[−0.45, 0.15], [0.45, 0.15], [0, −0.9]]` | 斩击命中的镜头冲击 [roll, pitch]（`IPlayer.cameraPunch`，受击弹簧的角速度冲量） |
| `IN_RANGE_EVERY` | 3 | 准星「攻击距离内」检测间隔（帧，`IWeaponSystem.meleeInRange`） |
| `SWING_PITCH` | `[1.06, 0.96, 0.82]` | 三段挥砍 `blade_swing` 的音高 |
| `SLASH_HIT_VOLUME` | `[0.7, 0.7, 1.0]` | 三段 `blade_hit` 音量（第三段 pitch 0.85） |
| `MAX_SLASH_FX` | 6 | 每段最多播几个 `fx.blade.slashHit` |
| `SLASH_TAGS` | `['slash']` | 斩击伤害请求的标签（模块级常量数组，不修改） |
| `SKILL_TAGS` | `['slash', 'weaponSkill']` | 技能伤害请求的标签 |
| `SKILL_KEY` | `'V'` | HUD 按键提示 |
| `SKILL_DASH_GRACE` | 0.08 | 突进阶段最长 = `dashTime + grace`（`isLunging` 未结束也强制进入等待） |
| `SKILL_DENY_GAP` | 0.4 | 冷却中按 V 的 `ui_deny` 最短间隔 |
| `SKILL_PATH_KNOCK` | 2.5 | 路径斩击击退（沿「路径最近点 → 敌人」水平方向） |
| `IMPALE_KNOCK` | 2 | 贯穿击退 |
| `IMPALE_POWER_CAP` | 0.5 | 引爆强度 = `min(贯穿实际伤害, 最大生命 × 0.5)` |
| `IMPALE_LEAD` | 0.13 | 贯穿特效提前于伤害发射的秒数（刃群与伤害数字 / 闪白 / 重击音效同时落下） |
| `DASH_SHAKE` / `IMPALE_SHAKE` | (0.3, 0.12) / (0.55, 0.25) | 突进起手 / 贯穿结算的屏震（原 0.1 / 0.18 实测不到 2 像素） |
| `RECALL_FX_DIST` | 6 | 换弹召回时刃片特效的起点：眼前 6 米 |

### 10.2 `weapons/WeaponDefs.ts`（契约已落地）

| 新增 | 内容 | 缺省 |
|---|---|---|
| `FireMode` | 加 `'melee'`（只由 `formMode()` 返回） | — |
| `WeaponKind` | 加 `'blade'` | — |
| `ReloadStyle` | 加 `'recall'`（V 流：刃片飞回重组的换弹动画） | — |
| `ProjectileParams.fanFixed` | 固定扇形：一轮 n 发按偏航角均匀分布在 [−fan, +fan] | `false` |
| `interface MeleeSegment` | `damage / windup / duration / range / halfAngle / knockback / lunge / stunCrit / shake` | — |
| `interface MeleeParams` | `combo / comboReset / reachBelow / reachAbove / elementChance / recallPerHit / recallMaxPerSwing / moveBonus / formNames / morphTime / formStrikeWindow / formStrikeMult` | — |
| `interface WeaponSkillParams` | `kind: 'dashSlash' / id / name / glyph / description / cooldown / dashDist / dashTime / iframes / exitSpeed / pathRadius / slashDamage / impaleDelay / impaleDamage / recallPerHit / maxMarks` | — |
| `WeaponDef.melee` | 近战形态 | `null` |
| `WeaponDef.skill` | 武器技能 | `null` |
| `WeaponDef.recall` | 召回式换弹（不需要 / 不消耗备弹） | `false` |
| `WeaponDef.perProjectileAmmo` | 按弹体计弹药 | `false` |
| `isDualForm(d)` | `d.melee !== null` | — |
| `formMode(d, form)` | 双形态且 `form === 'melee'` → `'melee'`，否则 `d.mode` | — |
| `comboCycleTime(d)` | 连段整轮时长（未计攻速）；普通武器 0 | — |

L 流只追加 `demon_blade` 定义，并把文件头「17 把」改为「18 把」。

### 10.3 「本武器伤害倍率」与 `weapons/WeaponStats.ts`

```
damageMult = RARITY_DAMAGE[稀有度] × (1 + LEVEL_DAMAGE × 强化等级) × (1 + Σ伤害词条 dmg)
```

- 即 `R.damage = def.damage × R.damageMult`（已落地，与 `resolveWeapon` 完全一致）。**不含**玩家 `damagePct`、元素 / 精英 / 首领加成与 outgoing 修饰器——它们由 Combat 对 `source: 'weapon'` 统一乘。
- 斩击基础伤害 = `seg.damage × R.damageMult`；技能路径斩击 = `skill.slashDamage × R.damageMult`；贯穿 = `skill.impaleDamage × R.damageMult`。
- 已落地：`R.damageMult`、`R.meleeElementChance`（双形态 = `min(1, melee.elementChance + 元素触发率词条)`，无元素 0；普通武器 = `elementChance`）。
- L 流追加（WeaponStats 私有，不是契约）：
  - `meleeDps = Σ seg.damage × damageMult / (comboCycleTime(def) / fireRateMult)`（普通武器 0），Describe 显示。
  - `meleeHitScale = clamp((shotsPerSecond(def) × hitsPerShot(def)) / (combo.length / comboCycleTime(def)), 0.5, 3)`（魔刀 = 6 / 2.83 ≈ 2.12；普通武器 1），AffixEffects 用于斩击命中的几率归一化。
  - `R.dps` 对双形态武器保持远程形态的计算（`novaDamage` 等沿用）。

### 10.4 WeaponSystem 状态机（L 流）

#### 10.4.1 新私有状态（初值）

```ts
// 形态（rt.form 在 WeaponRuntime：'melee' | 'ranged'，新实例 'melee'）
private morphLeft = 0;        // 变形剩余秒（> 0 时不能攻击）
private morphBuffer = 0;      // 右键缓冲
private strikeUntil = -99;    // 换形一击窗口截止（ctx.time.now；-99 = 无）
// 连段
private comboIndex = 0;       // 下一段 0..2
private swingIdx = -1;        // 当前段，-1 = 空闲
private swingT = 0;           // 当前段已进行秒数（已乘攻速）
private swingHit = false;     // 当前段的判定帧已结算
private swingStrike = false;  // 当前段带「换形一击」
private comboIdle = 0;        // 上一段结束后的空闲秒数
// 千刃齐射
private volleyCount = 0;      // 本轮实际枚数（perProjectileAmmo 时 = min(count, 发射前余量)）
// 武器技能（新文件 weapons/BladeSkill.ts）
private readonly skill: BladeSkill;
```

`import type * as THREE` 需要改为值导入（或把临时向量放进 Melee.ts / BladeSkill.ts 的模块级）。

#### 10.4.2 每帧顺序（`update(dt)`，在现有流程上插入）

1. `effects.flush()`；`inputOk`；`handleSwitchInput()` **在 `skill.dashing` 时跳过**（突进中不能切枪）。
2. 计时器；**`this.skill.update(dt)`**（冷却、突进扫描、待贯穿——不论当前武器是什么，放在 `if (!inst) idle()` 之前）。
3. `inst / R / def / rt`；`form = def.melee ? rt.form : null`；`mode = form ? formMode(def, form) : def.mode`。
4. **开镜 / 变形**：`def.melee` 时——`pressed('aim')` → `morphBuffer = MORPH_BUFFER`；`aimT` 与 `fovKick` 按 `idle()` 的方式衰减到 0，**不写 `def.aimFov`**。否则走原开镜逻辑。
5. **变形推进**：`morphBuffer > 0` 时 `canMorph()` 则 `doMorph()`，否则 `morphBuffer -= dt`；`morphLeft > 0` 时递减，减到 0 的那一帧 `strikeUntil = now + melee.formStrikeWindow`。
6. **武器技能**：`inputOk && pressed('weaponSkill') && def.skill` → `this.skill.tryCast(inst, R)`。
7. **换弹**：`pressed('reload')` 且 `mode !== 'melee'` 才 `startReload`。
8. **开火**：`ready = switchTimer <= 0 && !reloading && player.alive && morphLeft <= 0 && !skill.dashing`；`switch (mode)` 新增 `case 'melee': this.updateMelee(dt, fireDown, ready, inst, R, rateMult)`（`rateMult` 即攻速倍率，见 D7）。
9. `handleEmpty`：`mode === 'melee'` 时 `autoReload = 0` 直接返回；`checkStarvation`、`updateSpread`（`mode === 'melee'` 时 `hudSpread = damp(hudSpread, MELEE_HUD_SPREAD, 18, dt)`）、`updateViewmodel`（写 10.7.1 的新字段）。

#### 10.4.3 形态切换

- `canMorph()`：`switchTimer <= 0 && morphLeft <= 0 && !(swingIdx >= 0 && !swingHit) && !skill.dashing && player.alive`（判定帧之后可以取消收势）。
- `doMorph(inst)`：`morphBuffer = 0`；换弹中则 `cancelReload()`（召回作废）；连段重置（`swingIdx = -1; comboIndex = 0; comboIdle = 0`）；`fireBuffer = 0`；`rt.form` 翻转；`morphLeft = melee.morphTime`；`strikeUntil = -99`；`applyHeldMods()`；`audio.play('blade_morph', { volume: 0.8 })`；`emit('weapon:formChanged', { weapon, form })`。
- 形态在变形**开始**时就翻转（HUD 立即显示新形态名，`ViewmodelState.form` 为目标形态、`morphT` 为进度）；攻击要等 `morphLeft` 归零。
- **换形一击**：斩——`startSwing()` 时若 `now < strikeUntil` 则本段 `swingStrike = true` 并清除窗口，本段所有命中 × `formStrikeMult`；千刃——`shoot()` 时若 `def.melee && now < strikeUntil`，`mult *= formStrikeMult` 并清除窗口（整轮 3 柄都吃）。
- **换形一击的冷却**（审查修复）：用掉窗口时 `strikeReadyAt = now + STRIKE_REARM`（1.5 秒）；变形完成时只有 `now >= strikeReadyAt` 才打开窗口。`canMorph()` 允许判定帧后变形取消收势，原实现下按住左键连按右键可以「变形 → 带换形一击的一轮飞刃 → 变形 → 带换形一击的横斩」循环，单体约 187 DPS。`strikeReadyAt` 只在 `clear()`（换关 / 开局）复位，切枪不复位。
- 移速：`applyHeldMods()` 在 `R.swift` 之外，双形态且 `rt.form === 'melee'` 时再 `stats.add('moveSpeed', melee.moveBonus, HELD_SOURCE)`（同一 source，切枪 / 变形时整体重算）。

#### 10.4.4 三段连斩（`updateMelee`）

```ts
private updateMelee(dt, fireDown, ready, inst, R, speed): void {
  const m = R.def.melee!;
  if (this.swingIdx < 0) {
    this.comboIdle += dt;
    if (this.comboIdle > m.comboReset) this.comboIndex = 0;
    if (!ready || !(fireDown || this.fireBuffer > 0)) return;
    this.startSwing(inst, R, this.comboIndex, 0);
  }
  this.swingT += dt * speed;
  for (let guard = 0; this.swingIdx >= 0 && guard < 3; guard++) {
    const seg = m.combo[this.swingIdx];
    if (!this.swingHit && this.swingT >= seg.windup) { this.swingHit = true; this.resolveSwing(inst, R, seg, this.swingIdx); }
    if (this.swingT < seg.duration) break;
    const over = this.swingT - seg.duration;
    this.comboIndex = (this.swingIdx + 1) % m.combo.length;
    this.swingIdx = -1;
    this.comboIdle = 0;
    if (ready && (fireDown || this.fireBuffer > 0)) this.startSwing(inst, R, this.comboIndex, over); // 按住自动接段
  }
}
```

- `startSwing(inst, R, idx, t0)`：`swingIdx = idx; swingT = t0; swingHit = false; fireBuffer = 0`；换形一击判定；`vm.onSlash(idx, color)`；`audio.play('blade_swing', { volume: 0.75, pitch: SWING_PITCH[idx] })`；`seg.lunge > 0` 时 `player.getForward(_fwd)` 并 `player.lunge(_fwd, seg.lunge, Math.max(0.05, seg.windup / speed), 0, SEG_EXIT_SPEED)`（无无敌 = 软突进，见 10.5：边跑边砍不减速、空中不悬停）。
- **连段追击**（审查修复）：第三段击退 6 m/s 会把不动的敌人从表面 2.0 → 3.2 → 4.3 米推出攻击距离，按住左键时下一轮横斩 / 回斩全部挥空。上一段命中、本段 `lunge = 0`、扇形内没有敌人在 `range` 内、但加长 `CHASE_REACH` 的同角扇形里最近的敌人表面在 `range + 1.2` 内时，前摇中朝它软突进 `min(CHASE_MAX, 差距 + CHASE_MARGIN)` 米；突进时长 = 判定帧之前剩下的整帧数 × dt（玩家在武器系统之前更新），判定帧时已走完。设计数值（击退 6）不变。
- 被打断的段（切枪 / 拾取替换 / 死亡 / 换关的 `stopActions → resetMelee`）若带软突进（第三段前冲或追击），`player.cancelLunge()` 一并结束；技能突进中不动它。
- `resolveSwing(inst, R, seg, idx)`（判定帧，**每段一次**）：
  1. `rt.shots++`；`nthCrit = R.legendary === 'lg_nth' && rt.shots % round(R.legendaryValue) === 0`（斩击按段计，与千刃按轮共用计数器）。
  2. `sweepSector(ctx, seg, melee, out)`（10.4.5）得到命中列表。
  3. 逐个敌人：`point` = 身体中心沿「敌人 → 玩家」水平方向移到表面（−0.8 × 半径），`direction` = 水平单位向量 + `KNOCK_LIFT` 归一化（两者都 `new`，因为 `DamageResult.request` 会被监听者持有，同 Firing）；请求：
     ```ts
     { base: seg.damage * R.damageMult * (swingStrike ? melee.formStrikeMult : 1),
       element: inst.element, source: 'weapon', elementChance: R.meleeElementChance,
       critMult: R.critMult, weaponUid: inst.uid, point, direction, knockback: seg.knockback,
       procDepth: 0, tags: SLASH_TAGS,
       forceCrit: nthCrit || (seg.stunCrit && e.stunTime > 0) || rand() < R.critChance ? true : undefined }
     ```
     （没有 `headshot`：斩击没有爆头。）
  4. 回刃：`addBlades(inst, min(命中数 × recallPerHit, recallMaxPerSwing), 第一个命中点)`。
  5. 有命中：`vm.onSlashHit(idx === 2)`；`audio.play('blade_hit', { volume: SLASH_HIT_VOLUME[idx], pitch: idx === 2 ? 0.85 : 1 })`；`fx.shake(seg.shake, SLASH_SHAKE_TIME)`；`player.cameraPunch(...SLASH_PUNCH[idx])`（横斩 / 回斩向挥砍方向一歪、下劈向下一顿，只动镜头不改瞄准）；前 `MAX_SLASH_FX` 个命中点 `fx.blade.slashHit(point, dir, color, idx === 2)`。
  6. 无论是否命中：`fx.blade.slashArc(player.eye, player.yaw, player.pitch, idx, seg.range, seg.halfAngle, color)`；`lastShotTime = now`；`emit('weapon:fired', { weapon: inst })`（「开火时」类效果）。
- `color` = `inst.element === 'none' ? def.projectile.color (0xff3a24) : ELEMENT_COLORS[inst.element]`（斩击、飞刃、刃印共用）。
- 斩击不调用 `addRecoil`（不打乱瞄准）、不调用 `feedback()`（那是枪声 / 枪口火焰 / 后坐）。
- 准星提示：`mode === 'melee'` 时每 `IN_RANGE_EVERY` 帧用下一段（挥砍中为当前段）的扇形 `sweepSector` 扫一次，结果给 `IWeaponSystem.meleeInRange`（10.9）。

#### 10.4.5 近战判定（新文件 `weapons/Melee.ts`，L 流，纯函数 + 模块级临时量）

`sweepSector(ctx, seg, melee, out: IEnemy[]): IEnemy[]`（`out` 由 WeaponSystem 持有复用）：

```
p = player.position; eye = player.eye; f = player.getForward(_f)        // 水平朝向（只看 yaw）
yLo = p.y − melee.reachBelow;  yHi = p.y + player.height + melee.reachAbove
cosMax(seg)                                                          // 预先算好 cos 不必每敌 acos
for e of ctx.enemies.list:
  if !e.alive → 跳过
  if e.position.y > yHi || e.position.y + e.height < yLo → 跳过         // 高度：脚下到头顶上方 0.6 米
  dx, dz = e.position − p;  d = hypot(dx, dz);  surf = d − e.radius
  if surf > seg.range → 跳过                                         // 距离按胶囊表面
  dot = (dx·f.x + dz·f.z) / max(d, 1e-4)
  if surf > MELEE_CLOSE:
     allow = seg.halfAngle + asin(min(1, e.radius / d))              // 大体型敌人按角半径放宽
     if dot < cos(allow) → 跳过
  else if dot < −0.3 → 跳过                                          // 贴身但在正后方
  视线：!world.segmentBlocked(eye, 身体中心) || !world.segmentBlocked(eye, 头部中心)，否则跳过
  out.push(e)
```

`sweepPath(ctx, a, b, radius, melee, exclude: Set<IEnemy>, out)`（技能用）：`a → b` 为本帧脚底位移；高度带 `[min(a.y, b.y) − reachBelow, max(a.y, b.y) + height + reachAbove]`；敌人到线段 ab 的**水平**距离 − 半径 ≤ `radius`；视线从「线段最近点 + 眼高 1.62」到身体中心或头部；`exclude`（本次释放已命中）跳过。

两个函数都不分配（模块级 `_f / _c / _h` 临时向量），只遍历一次 `ctx.enemies.list`。

#### 10.4.6 千刃形态（复用现有开火 / 换弹）

- **开火**：`'auto'` 分支照旧调用 `shoot()`。`shoot()` 改动：
  - 扣弹：`def.perProjectileAmmo` 时 `volleyCount = infinite ? count : min(count, 发射前 mag)`，非无限弹药且未被「无尽」免耗时扣 `volleyCount` 发；否则照旧扣 1 发、`volleyCount = count`。
  - 「终焉」：`perProjectileAmmo` 时条件改为「本轮打空弹匣」（`consumed && inst.mag === 0`）。
  - 换形一击倍率（10.4.3）。
  - `weapon:fired` 每轮一次（不变）。
- **固定扇形齐射**：`updateVolley` 中
  ```ts
  const n = this.volleyCount, i = n - this.volleyLeft;
  // 按整轮 count 的槽位间距、以准星为中心：3 柄 −fan / 0 / +fan，只剩 2 柄 ±fan / 2，1 柄 0
  const yaw = p.fanFixed ? (p.fan * (2 * i - (n - 1))) / Math.max(1, p.count - 1) : 0;
  this.ballistics.projectile(inst, R, this.spreadNow, this.volleyCrit, this.volleyMult, p.fanFixed ? 0 : p.fan, yaw);
  if (!p.fanFixed || i === 0) this.feedback(inst, R, 1);   // 一轮只有一次后坐 / 音效 / 第一人称后坐
  ```
  审查修复：原公式 `fan × (2i / (n − 1) − 1)` 按实际柄数铺满 [−fan, +fan]，余量只剩 2 柄时两柄分别飞向 ±5°、准星正中无刃，约 6 米外瞄准小怪中心会两柄全空（斩击 / 技能回刃让余量常不是 3 的倍数，「终焉」的最后一轮恰好是这 2 柄）。
  `Ballistics.projectile(…, fan, yawOffset = 0)`（Firing.ts）：在得到「枪口 → 准星落点」单位方向之后、乘弹速之前 `_vel.applyAxisAngle(UP, yawOffset)`（`UP = (0,1,0)` 模块常量）。三柄共享同一个准星落点，扇形以准星为中心。
- **召回（换弹）**：`startReload` 条件改为 `inst.mag < R.magCap && (R.def.recall || inst.reserve > 0)`，`mode === 'melee'` 时直接返回 false；`updateReload` 整匣分支 `take = recall ? cap − mag : min(cap − mag, reserve)`，`recall` 时不扣 `reserve`；`handleEmpty` 的「有备弹」判断改为 `recall || reserve > 0`；`checkStarvation` 把 `recall` 武器视为永不空。召回开始播 `blade_recall`（0.8）代替 `reload_start`，并 `fx.blade.recall(eye + aim × RECALL_FX_DIST, 枪口世界坐标, cap − mag, color)`；完成播 `reload_end`（0.5，pitch 1.35）。`weapon:reloadStart / reloaded` 照常派发（「换弹时」秘卷生效）。
- **回刃**：`addBlades(inst, n, from: THREE.Vector3 | null)`：封顶 `magCap`，实际增加 `add > 0` 时若有 `from` 则 `fx.blade.recall(from, vm.getMuzzleWorld(_t), add, color)`，并 `audio.play('blade_recall', { volume: 0.35, pitch: 1.5 })`。不派发 `weapon:reloaded`。

#### 10.4.7 武器技能「千刃·无间」（新文件 `weapons/BladeSkill.ts`，L 流）

```ts
export interface BladeSkillHost {
  resolve(inst: WeaponInstance): ResolvedWeapon;
  /** 回刃（封顶弹匣，播召回特效） */
  addBlades(inst: WeaponInstance, n: number, from: THREE.Vector3 | null): void;
  /** 释放时打断：换弹、连段、开火 / 变形缓冲 */
  interrupt(): void;
}
export class BladeSkill {
  constructor(ctx: GameContext, host: BladeSkillHost);
  get dashing(): boolean;                 // phase === DASH
  get dashProgress(): number;             // 0..1；不在突进为 −1（写 ViewmodelState.skillT）
  tryCast(inst: WeaponInstance, R: ResolvedWeapon): boolean;
  update(dt: number): void;               // 冷却 + 突进扫描 + 待贯穿，每帧调用（不论当前武器）
  abort(): void;                          // 回到 IDLE、丢弃刃印；冷却保留（死亡 / 换关）
  resetForRun(): void;                    // abort + 冷却清零（开新局）
  fill(def: WeaponSkillParams): WeaponSkillState; // 写入并返回复用的 HUD 状态对象
}
```

阶段：`IDLE → DASH → PENDING → IDLE`。

- **冷却**（`update` 开头）：`total = max(0.1, cdBase / max(0.2, 1 + skillHaste))`（与 SkillController 同公式）；`total` 变化时剩余按比例换算；`cdLeft = max(0, cdLeft − dt)`。`cdBase` 取最近一次释放的 `skill.cooldown`（初值 16）。不响应 `player.reduceCooldowns()`（那是英雄技能）。
- **`tryCast`**：非 IDLE → false；`cdLeft > 0` → `ui_deny`（0.5，间隔 ≥ `SKILL_DENY_GAP`）→ false；`player.alive` 且 WeaponSystem 的 `switchTimer <= 0`（由调用方保证）。然后：`host.interrupt()`；记下 `inst`；`elapsed = 0; hitSet.clear(); marks.length = 0; prev.copy(player.position)`；`player.getForward(_fwd)`，`moved = player.lunge(_fwd, dashDist, dashTime, iframes, exitSpeed)`；`phase = DASH`；开始冷却（`cdLeft = total`）；`audio.play('blade_dash', { volume: 0.9 })`；`fx.shake(DASH_SHAKE, 0.12)`（0.3）；`emit('weapon:skillUsed', { weapon: inst, skillId })`；立刻 `sweep(prev, prev)`（起点处的敌人）；`!moved`（契约桩或被拒绝）时当帧直接 `endDash()`——技能在原地结算，不白耗冷却。可以在任一形态、变形中释放，释放后保持当前形态。
- **DASH**（每帧）：`elapsed += dt`；`sweep(prev, player.position)`；`fx.blade.dashTrail(prev, player.position, color)`；`prev.copy(position)`；`!player.isLunging || elapsed >= dashTime + SKILL_DASH_GRACE` → `endDash()`。
- **路径斩击**（`sweep` 每个新命中）：`hitSet.add(e)`；请求 `{ base: slashDamage × R.damageMult, element: inst.element, source: 'weapon', elementChance: R.meleeElementChance, critMult: R.critMult, weaponUid, point, direction（路径最近点 → 敌人，+0.3 上抬）, knockback: SKILL_PATH_KNOCK, procDepth: 0, tags: SKILL_TAGS, forceCrit: rand() < R.critChance }`；`host.addBlades(inst, recallPerHit, point)`（被斩死的也算）；仍存活且 `marks.length < maxMarks` → `marks.push(e)` 并 `fx.blade.mark(e, impaleDelay + max(0, dashTime − elapsed) + 0.1, color)`；`fx.blade.slashHit(point, dir, color, true)`；本帧有命中播一次 `blade_hit`（1.0，pitch 0.8）。
- **`endDash()`**：`fx.blade.slashArc(player.eye, player.yaw, 0, 1, pathRadius × 2, π / 2, color)`（收刀的一道横弧）；`marks` 为空 → IDLE，否则 PENDING、`impaleLeft = impaleDelay`。
- **PENDING**：`impaleLeft -= dt`，≤ 0 时 `impale()` 后回 IDLE。剩余 ≤ `IMPALE_LEAD`（0.13 秒）时先对所有存活的刃印敌人 `fx.blade.impale(e, color)`（刃群出发后 0.1–0.16 秒到齐），到点只结算伤害与引爆——刃群、伤害数字 / 闪白与重击音效在同一帧前后约 30 毫秒内落下（原实现同帧先出伤害、刃群晚约 0.1 秒、重击音效再晚）。
- **`impale()`**：重新 `R = host.resolve(inst)`；对每个仍存活的刃印敌人：`fx.blade.impale(e, color)`（先播，击杀也有表现）；请求 `{ base: impaleDamage × R.damageMult, …同上, direction: (0, 1, 0) 略带「玩家 → 敌人」水平分量, knockback: IMPALE_KNOCK, tags: SKILL_TAGS }`；`res = combat.damageEnemy(e, req)`；`res && !res.killed && e.alive` 时 `combat.detonate(e, _det)`，`_det` 为模块级复用的 `DetonateOpts`：`{ power: min(res.dealt, e.maxHp × IMPALE_POWER_CAP), mult: 1, depth: 0, weaponUid: inst.uid, point }`（身上 ≥ 2 种元素引发反应，否则「崩解」；规则见 arsenal-expansion 2.5；引爆只入队）。全部结束后 `audio.play('blade_impale', { position: 第一个刃印点, volume: 1 })`、`fx.shake(IMPALE_SHAKE, 0.25)`（0.55）、`emit('weapon:skillImpale', { weapon, points })`（各刃印敌人身体中心，新建数组；HUD 的朱红暗角闪与视野外方向刃光，见 10.9）、`marks.length = 0`。
- **`abort()`**：`marks` 非空时 `fx.blade.clearMarks()`（刃印淡出）——死亡 / 超时中止后刃环不再照常转到时长结束（原实现只有换关的 `fx.clear()` 会清掉）。
- 刃印只存敌人引用（`marks: IEnemy[]`，复用数组）；施法实例被丢弃（`give` 替换）也照常贯穿，`weaponUid` 找不到实例时词条自然不触发。

#### 10.4.8 `IWeaponSystem` 新只读字段（契约已落地，均为可选；L 流在 WeaponSystem 实现为 getter）

| 字段 | 实现 |
|---|---|
| `activeForm: WeaponForm \| null` | 当前武器双形态 → `runtime(inst).form`，否则 `null` |
| `formMorphProgress: number` | `morphLeft > 0 ? 1 − morphLeft / melee.morphTime : 1` |
| `formStrikeTime: number` | `max(0, strikeUntil − now)` |
| `weaponSkill: WeaponSkillState \| null` | 当前武器 `def.skill` → `this.skill.fill(def.skill)`（复用对象：`id / name / glyph / key 'V' / cooldownRemaining / cooldownTotal / active = phase !== IDLE`），否则 `null` |

`describe()` 对双形态武器额外给出 `formNames` 与 `skill: { name, key: 'V', description, cooldown }`（10.11.3）。

#### 10.4.9 重置规则

| 状态 | 切枪 / 拾取替换（`stopActions`） | 死亡（`player:died`） | 换关（`stage:loaded → clear()`） | 开新局（`resetForRun`） | 暂停 / 弹窗 |
|---|---|---|---|---|---|
| `rt.form`（实例） | 保留 | 保留 | 保留 | 新实例为 `'melee'` | 保留 |
| `morphLeft / morphBuffer` | 清零（不触发换形一击） | 清零 | 清零 | 清零 | 冻结 |
| `strikeUntil` | 清除 | 清除 | 清除 | 清除 | 冻结（按 `ctx.time.now` 计，暂停不流逝） |
| 连段 `swingIdx / comboIndex / comboIdle` | 重置 | 重置 | 重置 | 重置 | 冻结；恢复后进行中的段继续（按键已被 `releaseAll` 松开，不会自动接段） |
| 技能 DASH | 突进中不响应切枪输入；`give()` 照常（不打断突进） | `skill.abort()`（P 流的 `die()` 结束 lunge） | `skill.abort()` | `skill.resetForRun()` | 冻结 |
| 技能 PENDING / 刃印 | 保留，照常贯穿 | `abort()` | `abort()`（`fx.clear()` 清刃印特效） | `resetForRun()` | 冻结 |
| 技能冷却 | 继续计时 | 保留 | 保留 | 清零 | 冻结（与英雄技能一致） |
| 斩形态移速（`HELD_SOURCE`） | `applyHeldMods()` 重算 | — | — | `stats.reset` | — |
| 召回（换弹） | 取消 | 取消 | 取消 | 取消 | 冻结 |

审查修复后另有：`resetMelee()` 打断带软突进的段时 `player.cancelLunge()`（技能突进中除外）；`strikeReadyAt`（换形一击冷却）只在 `clear()` 复位。

实现：`stopActions()` 末尾追加 `resetMelee()`（`morphLeft = morphBuffer = 0; strikeUntil = −99; swingIdx = −1; comboIndex = 0; comboIdle = 0; swingStrike = false`）；`player:died` 处理追加 `this.skill.abort()`；`clear()` 追加 `this.skill.abort()`；`resetForRun()` 追加 `this.skill.resetForRun()`。`game:stateChanged` 不需要新处理（与蓄力不同，斩击没有「松手触发」）。

### 10.5 玩家突进（P 流，`player/PlayerController.ts`）

契约（已落地，当前为桩）：`IPlayer.isLunging`、`lunge(dir, dist, time, iframes = 0, exitSpeed = 0): boolean`、`cancelLunge()`。实现：

- 私有字段：`lungeLeft = 0`（剩余秒）、`lungeDirX / lungeDirZ`、`lungeSpeed`、`lungeExit`。常量 `LUNGE_BLOCK_FRAC = 0.35`、`LUNGE_FAST = 15`（米/秒）。
- `lunge()`：`!alive || !(dist > 0) || !(time > 0)` → false；方向压平归一化（水平长度 < 1e-4 时用 `getForward`）；正在冲刺先 `endDash()`；`lungeLeft = time; lungeSpeed = dist / time; lungeExit = exitSpeed`；`iframes > 0` → `invulnerableTime = max(invulnerableTime, iframes)`；`lungeSpeed > LUNGE_FAST` 时 `rig.dashKick()`；返回 true。
- `updateMovement()`：`lungeLeft > 0` 时——不响应冲刺开始与跳跃（`jumpBuffer` 照常计时，突进结束后仍可起跳），`v.x/z = dir × lungeSpeed`、`v.y = 0`、跳过重力与滑翔；`moveBody` 之后计算本帧沿 dir 的实际推进 `prog`，`r.hitWall && prog < LUNGE_BLOCK_FRAC × lungeSpeed × dt` → `endLunge()`（被墙挡住提前停下）；`lungeLeft -= dt`，≤ 0 → `endLunge()`。
- `endLunge()`：`lungeLeft = 0`，水平速度 = `dir × lungeExit`。`cancelLunge()` 在突进中调用它。
- `teleport / die / resetForRun`：`lungeLeft = 0`（不保留出口速度）。
- 碰撞：走现有 `ctx.world.moveBody`（轴分离 + 台阶 + 贴地；子步长 ≤ 0.28 米、最多 12 步，44 米/秒 × 0.05 秒 = 2.2 米/帧不会穿墙）。敌人与玩家之间本来就没有实体碰撞，所以「穿过敌人」是自然结果。
- 无敌：`invulnerableTime` 已让 `takeDamage` 返回 0；契约已把 `Projectiles.touchesPlayer` 的穿透条件扩展为 `(isDashing || isLunging) && invulnerableTime > 0`，敌方投射物在突进中直接穿过（与冲刺一致）。
- 相机：`rigInput.dashing = isDashing || (lungeLeft > 0 && lungeSpeed > LUNGE_FAST)`（第三段 0.6 米前冲约 4 米/秒，不触发冲刺表现）。如需调整 CameraRig 的冲刺 FOV，`player/CameraRig.ts` 归 P 流。

**实现备注（P 流，已落地）**：

- 每帧推进 `lungeStep = min(dt, lungeLeft)` 秒（`_delta = dir × lungeSpeed × lungeStep`，竖直分量 0），最后一帧不多走，总位移精确等于 `dist`；`lungeLeft -= dt` 与撞墙判定（`prog < LUNGE_BLOCK_FRAC × lungeSpeed × lungeStep`）放在 `moveBody` 之后、沿墙滑动修正之前，所以出口速度不会指向墙内。入射角小于约 54°（`cos²θ ≥ 0.35`）时沿墙滑行、不提前停下。
- 突进期间 `v.y = 0`、跳过重力，`moveBody` 的竖直位移为 0：地面上靠「下坡贴地」保持 `onGround`（台阶照常抬升），空中释放则水平悬停，结束后正常下落。
- `applyImpulse` 在突进中：有无敌（`invulnerableTime > 0`，即武器技能）时**忽略外力**（击退 / 抛起不打断瞬身，也避免被抛起后失去贴地、在台阶处误判撞墙）；无无敌（第三段前冲）时直接结束突进（不施加出口速度）并照常施加外力，让击退与英雄技能跃起（岩熊「裂地重击」）优先。
- 突进不派发 `player:dashed`、不消耗冲刺充能（冲刺类秘卷不触发）。

**软突进（审查修复）**：`iframes = 0` 的突进（第三段前冲、连段追击）原来与技能走同一条路径——每帧强制 `v.x/z = dir × lungeSpeed`、`v.y = 0` 并跳过重力，结束时水平速度设为 `dir × 2`：持刀奔跑（约 7.9 m/s）时第三段反而把速度压到 4.3 再到 2；横移 / 后撤的速度被改成正前方；空中出第三段会截停上升、悬停 0.14 秒并丢掉跳跃弧线；前摇里的冲刺与二段跳被吞掉；切枪后仍被拖着往前走。现在：

- `lunge()` 记下 `lungeSoft = !(iframes > 0)` 与开始时沿 dir 的速度 `lungeEntryAlong`。硬突进（技能）行为不变。
- 软突进：照常 `applyHorizontal`、重力、跳跃 / 二段跳、滑翔，之后只把沿 dir 的分量抬到不低于 `lungeSpeed`（已经更快时不变，侧向分量保留）；冲刺直接打断它（不施加出口速度）；外力（`applyImpulse`）照旧打断它；撞墙提前结束的判定同硬突进；不触发 `dashKick` / 冲刺镜头。
- `endLunge()` 对软突进只把沿 dir 的速度回落到 `max(exitSpeed, lungeEntryAlong)`，侧向不动。
- `IPlayer.cameraPunch(roll, pitch)`（新增）：转给 `CameraRig.punch()`，给受击弹簧加角速度冲量（只动镜头，不改瞄准）。

### 10.6 输入（契约已落地，`core/Input.ts`）

- `Action` 新增 `'weaponSkill'`：`DEFAULT_BINDINGS.weaponSkill = ['KeyV']`，`MOUSE_ACTIONS.weaponSkill = 1`（中键）。
- 中键：`mousedown` 被接受时 `e.button === 1` 即 `preventDefault()`（防自动滚动）；另监听 `auxclick`，锁定指针或点在画布上时拦截中键（防中键粘贴 / 打开链接）。
- 持魔刀时右键 `aim` 只读 `pressed`（边沿）用于变形，WeaponSystem 不写 `fovKick`（10.4.2 第 4 步）；其他武器右键照旧开镜。

### 10.7 第一人称（V 流，`weapons/Viewmodel.ts`、`weapons/WeaponModels.ts`）

#### 10.7.1 `ViewmodelState` 新字段（契约已落地，默认值见 `createViewmodelState()`；WeaponSystem 每帧写入）

| 字段 | 默认 | 写入规则（按**当前显示**的实例 `shown`；切枪收放期间显示的是旧枪） |
|---|---|---|
| `form` | `null` | `shown` 双形态 → `runtime(shown).form`，否则 `null` |
| `morphT` | 1 | `shown === inst && morphLeft > 0 ? 1 − morphLeft / morphTime : 1` |
| `swing` | −1 | `shown === inst ? swingIdx : −1` |
| `swingP` | 0 | `swingIdx >= 0 ? clamp01(swingT / seg.duration) : 0` |
| `swingHitP` | 0.25 | `seg.windup / seg.duration`（0.267 / 0.267 / 0.304） |
| `blades` / `bladesMax` | 0 / 1 | `shown.mag` / `magCapacity(shown)` |
| `skillT` | −1 | `skill.dashProgress`（突进中 0..1） |
| `strikeT` | 0 | `formStrikeTime / formStrikeWindow`（0..1） |

既有字段：`reloading / reloadP` 在千刃召回时照常写（`reloadStyle 'recall'`）；`firing` 恒 false；`aimT` 恒 0；`scoped` 恒 false。

契约桩方法（V 实现）：`vm.onSlash(segment, color)`（每段开始）、`vm.onSlashHit(heavy)`（判定帧有命中时一次）。千刃齐射仍走 `vm.onShot(def, color, 1)`（`def.flash = 0` → 无枪口火焰，只做 kick 与刃片飞出）。`vm.getMuzzleWorld()` 是飞刃出生点与召回特效终点。

#### 10.7.2 刀模型挂点（`WeaponModels.ts`）

- `PALETTES.demon_blade = { body: 0x34343a /* 暗钢 */, dark: 0x18161a, accent: 0xa8842e /* 暗金 */, grip: 0x5c1810 /* 缠布暗红 */ }`；`BUILDERS.demon_blade = buildDemonBlade`；`export const BLADE_SHARDS = 18`。
- `GunModel` 新增 `blade: BladeRig | null`（`blankModel` 初始化为 `null`；其他武器不受影响）：

```ts
export interface BladeRig {
  /** 刀身组（刀脊 + 刃口符纹）：原点在护手，沿 −Z 伸出约 0.78、刀尖向 +Y 上翘约 0.06；斩形态显示，变形时淡出 */
  body: THREE.Group;
  /** 18 片刃片：9 段 × 刃口 / 刀背两列；斩形态在 home 拼成刀刃，千刃形态移到悬浮阵位 */
  shards: THREE.Mesh[];
  /** 每片的 home 位置与朝向（root 空间，构建时记录） */
  shardHome: { pos: THREE.Vector3; rot: THREE.Euler }[];
  /** 刃口朱红符纹（0xff3a24，用 markMat 系的独立实例或 Viewmodel 克隆材质，换形一击 / 变形时增亮） */
  runes: THREE.Mesh[];
  /** 宝珠：元素色（加入 energy 列表随能量槽脉动）；无元素时为暗金 0xc9a040（不进 energy，用 markMat） */
  orb: THREE.Mesh;
  /** 兽首护手 */
  guard: THREE.Object3D;
  /** 柄尾流苏链节（2–3 节，自上而下串联，逐节滞后摆动） */
  tassel: THREE.Object3D[];
}
```

- `muzzle`：斩形态在刀尖，千刃形态在悬浮阵中心前方——Viewmodel 每帧按 `form / morphT` 移动 `gun.muzzle` 的本地位置（它是 root 的子节点）。
- 单手持刀：`leftHand = null`；`addArms` 照常加右手手套与袖子。掉落模型走 `buildWorldModel`（刃片在 home，`worldScale 1.4`）。

#### 10.7.3 动画关键姿态（相对 `viewOffset` 的 pivot 偏移 Δx / Δy / Δz 与旋转 rx / ry / rz，弧度；V 可在 ±30% 内调）

| 姿态 | Δx | Δy | Δz | rx | ry | rz |
|---|---|---|---|---|---|---|
| 斩·待机 | 0 | 0 | 0 | 0.35 | 0.10 | −0.45 |
| 横斩·蓄势（p = 0.4 × hitP） | +0.10 | +0.04 | +0.04 | 0.20 | +1.05 | −1.35 |
| 横斩·出刀（p = hitP） | 0 | 0 | −0.06 | 0.05 | 0 | −1.45 |
| 横斩·收势（p = 1） | −0.20 | −0.03 | 0 | 0 | −1.15 | −1.30 |
| 回斩·蓄势 | −0.20 | −0.02 | +0.02 | 0.05 | −1.15 | +1.25 |
| 回斩·出刀 | 0 | −0.02 | −0.06 | 0.05 | 0 | +1.35 |
| 回斩·收势 | +0.18 | −0.04 | 0 | 0 | +1.10 | +1.20 |
| 下劈·蓄势（举过头顶） | +0.02 | +0.20 | +0.06 | +1.35 | 0.10 | −0.15 |
| 下劈·出刀 | 0 | +0.02 | −0.08 | −0.35 | 0 | −0.10 |
| 下劈·收势 | −0.02 | −0.16 | −0.02 | −1.00 | −0.05 | −0.10 |
| 千刃·待机（掌心朝前，刀身消失） | −0.02 | +0.02 | +0.04 | 0.15 | 0.25 | 0.10 |
| 技能·突进（刀压低于身后） | +0.04 | −0.06 | +0.08 | −0.20 | −0.60 | −1.20 |

- 挥砍曲线：0 → 0.4 hitP 由待机（或上一段收势）缓入到蓄势；0.4 hitP → hitP 加速（三次缓入）到出刀；hitP → 1 缓出到收势；段结束后 0.15 秒回待机（连段时直接衔接下一段蓄势）。
- 顿帧：`onSlashHit` 冻结表现层挥砍进度 0.04 秒（heavy 0.06）+ `kickRot += 0.03`（heavy 0.06）；逻辑进度不受影响。
- 变形 斩 → 千刃（`morphT` 0 → 1）：0–0.35 符纹增亮 ×2.5、刀身轻颤（±0.003）；0.35–0.85 刃片自刀尖向护手依次脱离（每片延迟 0.03），沿弧线飞到悬浮阵位；刀脊在 0.6 前缩放淡出；0.85–1 落位。千刃 → 斩 倒放。
- 悬浮阵：手背后上方两层扇形（半径 0.13 / 0.18，−70° … +70°，各 9 片），刃尖朝 −Z，各自 `sin(time × 2 + i) × 0.004` 浮动，整体 ±3° 缓摆。可见刃片数 = `round(blades / bladesMax × 18)`；投掷时阵中央的刃片先飞走。斩形态可把缺失的刃片画成刀身上的暗槽（提示回刃进度，可选）。
- 召回（`reloading && form === 'ranged'`）：刃片按 `reloadP` 逐片从屏幕前方（z ≈ −0.6，随机 x / y）0.12 秒飞回阵位。
- 技能：`skillT` 0–0.2 过渡到「技能·突进」并保持，0.8–1 横向挥出（复用横斩 出刀 → 收势）。
- 流苏：每节对 pivot 的位移 / 旋转做一阶滞后（damp λ = 8 / 6 / 4），竖直下垂 + 速度反向摆动。
- `reloadStyle 'recall'` 在 `switch (def.reloadStyle)` 中不做整枪倾斜（刃片自己飞）。

**实现备注（V 流 + 联调，已落地；可调常量在 `Viewmodel.ts` 顶部）**：

- 姿态表的实际值（相对上表，按实机画面调过）：
  - 斩·待机 `[0, 0, 0, 0.45, −0.12, −0.5]`（刀尖在准星右侧）。千刃·待机 ry 0.12。技能·突进 `[0.02, 0.05, 0.02, −0.15, −1.35, −1.35]`（原值手会出画）。
  - 横斩 / 回斩的 ry 符号与上表相反：横斩右 → 左（蓄势 ry −1.05、收势 +1.15），回斩左 → 右，与 `IBladeFx.slashArc` 一致。
  - 三段的「出刀」（判定帧）姿态 ry 约 +0.27：手在视野右侧，刀尖略偏左才正好扫过准星（ry 0 时刀与视线平行，接触点偏右）。下劈的出刀 / 收势也带 ry，刀路是右上 → 左下的斜线，与下劈弧光的倾斜一致。
  - 横斩收势与回斩蓄势的 rz 收到 ∓0.8（避免连段时手腕一帧内翻转 2.3 弧度）；回斩收势、下劈收势按画面重调。
- 挥砍曲线：起手占前摇的 `WIND_FRAC` 0.5，起手过渡用 smoothstep；出刀走「蓄势 → 出刀 → 收势」的 Catmull-Rom 样条，判定帧前后速度连续。
- 顿帧（联调改）：命中时表现层**钉在出刀姿态**（`p = hitP`）停 0.04 / 0.06 秒，再以 λ 22 追上逻辑进度。判定帧常落在两帧之间（上一帧刀还在蓄势侧），直接跳到接触姿态、由刀光拖尾补出弧线，保证敌人闪白 / 火花的那一帧刀正好砍在身上。原实现冻结在上一帧，刀停在半空约 3 帧后才甩过敌人。
- 技能：`skillT` 的前 0.35 进入突进姿态；突进结束后立即播 0.2 秒横扫（横斩的出刀 → 收势），与收刀弧光同步，撞墙提前结束时也有这一刀。
- 悬浮阵（原布局在第一人称下是一团压在手上的黑块）：手背上方略靠前，root 空间扇心 `(0.005, 0.06, −0.12)`，半径 0.075 / 0.115，内层 ±64°、外层 ±72° 交错；刃尖沿径向朝外并前倾 35°，刃面朝镜头，缩放 0.8；刃口片与刀背片在两侧混排。
- 变形节奏：刃片从进度 0.30 开始脱离，相邻两段间隔 0.028，单片飞行 0.30，约 0.84 全部落位；刀脊在 0.22–0.6 缩回。
- 「斩」形态下缺失的刃片露出暗色刀脊（回刃进度提示）；弹药为 0 时只剩带红血槽的细骨。
- 流苏：每节一个阻尼弹簧（刚度 150 / 105 / 72，阻尼 10 / 8 / 6），由重力与挂点反向速度驱动（一阶滞后的摆幅太小）。
- 刀身钢色比 `PALETTES.demon_blade.body` 亮（第一人称没有环境贴图，原色接近纯黑）；`BladeRig` 另有 `shardOrder / tip / trailInner`。

**审查修复（第一人称）**：

- 横斩·蓄势 `[0.04, 0.04, 0.04, 0.2, −0.75, −1.35]`（原 Δx 0.10 / ry −1.05 时蓄势两帧刀尖 NDC x 1.39 / 1.04，整把刀在画面外）。
- 下劈·出刀 rx −0.35 → −0.18（判定帧刀尖原在 NDC y −0.52 ≈ 裆部，顿帧把刀停在那里；目标约 −0.25 = 2.6 米外敌人胸口）；下劈·收势 rx −0.55 → −0.8、Δy −0.03 → −0.06，顿帧后仍有明显的下劈追随。改后需用刀尖投影复测：判定帧 y 应在 −0.2 到 −0.3 之间、前一帧高于 0。
- 袖子：魔刀分支的袖子挂在独立的前臂节点（腕部 = 护腕中心为原点）上，长度 0.34 → 0.2、颜色 ×0.72 → ×0.5；Viewmodel 每帧让前臂只跟随刀姿相对待机姿态偏离量的 35%（`FOREARM_FOLLOW`），挥砍时手腕翻转而前臂基本不动，不再有约 400 × 80 像素的纯色板扫进画面。
- 悬浮阵：剩余刃片在随数量收窄的扇面里重新均匀排布（半角 = 72° × n / 18，最小 12°；按满阵阵位角从左到右排序，内外层交替且左右对称），阵位变化以 damp λ 14 平滑；投掷时阵中央的刃片飞走、其余向中间合拢，扇面宽度即剩余量（原实现中间先空，弹药少时只剩两侧零散几片）。审查建议的「空阵位画 alpha 0.12 轮廓」与收窄的扇面冲突，未做。
- 刃片材质按模型克隆，千刃形态加元素色 / 朱红自发光（`SHARD_GLOW` 0.5，随变形进度淡入）；最后一轮（剩余 ≤ 一轮柄数）时刃片自发光与符纹亮度 ×1–2、6 Hz 脉动。刃面钢色已是 0x5c5f6a（审查所说的 0x34343a 是调色板值，实际未使用）。
- 刀光拖尾改为两层：普通混合的深色刃面（主题色 × 0.75，逐顶点透明度 ≤ 0.6，内缘几乎透明）+ 刃面外侧 18% 的加法细热边（最新一截混白 0.3）。纯加法叠在天空上会变成粉紫光柱。

### 10.8 特效（V 流）

- **新文件 `fx/BladeFx.ts`**：`export class BladeFx implements IBladeFx`，构造参数取 FxSystem 的 `glow: ParticlePool`、`sparks: SparkStreaks`（及需要时的 `GroundEffects`）；`readonly group: THREE.Group`；`update(dt, camPos)`；`clear()`。所有池在构造时建好，热路径零分配，几何体 / 材质模块级缓存；暂停时 FxSystem 传入 dt = 0（冻结）。
- **`fx/Fx.ts` 最小接线**：把契约桩 `readonly blade: IBladeFx = NOOP_BLADE_FX` 换成 `readonly blade: BladeFx`（构造函数里创建并 `root.add(blade.group)`）；`update()` 中 `this.blade.update(d, _camPos)`（放在 ribbons 之后）；`clear()` 中 `this.blade.clear()`；删除 `NOOP_BLADE_FX`。
- 各方法建议实现：

| 方法 | 实现 |
|---|---|
| `slashArc` | 8 个弧面池：内半径 0.55 × range、外半径 0.85 × range、24 段的新月面片（加法混合、双面、顶点色从刃口到内侧渐暗），0.08 秒扫开、0.15 秒淡出；横斩平面略向左下倾 15°、回斩向右下倾 15°、下劈为竖直面；不透明度 ≤ 0.55 防眩光 |
| `slashHit` | `sparks` 垂直于 dir 的扇形火花 10–16 道 + 一片小新月闪光；heavy 时加 `glow` 光团与地面 `ring(1.2)` |
| `mark` | 24 个刃环池：6 片小刃绕敌人身体中心旋转（半径 = 敌人半径 + 0.35，6 弧度/秒，脉动），逐帧跟随 `enemy.position`；到期或 `!enemy.alive` 时 0.1 秒淡出 |
| `impale` | 每个敌人 28 柄刃光：起点在半径 4–6 米的球面（偏上半球），0–0.06 秒错开出发、0.1–0.16 秒射入身体中心（自建 InstancedMesh 细长面片，池 512）；到达时 `glow` 闪光 + `sparks` 爆散 + 地面环；同时移除该敌人的刃印 |
| `dashTrail` | 残影：竖直的人形光片（glow 贴图着色，0.9 × 1.8 米），每 0.04 秒最多 1 个、0.3 秒淡出，池 6；风压线：沿位移方向两侧 ±0.4 米各一道细光带 |
| `recall` | 每次最多 8 个光点，沿略带弧度的路径 0.2–0.3 秒从 from 飞到 to（自建小池或 `glow` 粒子） |

- **飞刃外观 `combat/ProjectileVisuals.ts`**：契约桩让 `'blade'` 暂用 shard 外观；V 改为独立 case：内核为压扁的八面体刃片（约 0.95 × 0.18 × 2.4 个半径单位）+ 刃口发光层（加法，略大）+ 小光晕（2.0）；`animate` 中绕本地 Y 轴 24 弧度/秒自旋并轻微摆动。拖尾已在契约中接好（`Projectiles.ts`：`visual === 'blade'` 时宽 0.35 × size、间距 0.16 的细拖尾）。

**实现备注（V 流 + 联调，已落地）**：

- 弧光拆到 `fx/BladeArcs.ts`；`Fx.ts` 中 `blade.update` 放在线状特效批次的 begin / end 之间（多传 `RibbonBatch`，弧光外缘、刃片拖尾、刀痕、刃印光环、风压线都是朝向相机的光带），构造时另传 `FlashEffects`（贯穿爆闪）。
- 弧光几何：横斩 / 回斩弧心比眼睛低 0.32 米、前端下压 0.12（浅碗，略俯视能看到新月面）；另加外缘刃光带；不透明度上限 0.55。
- 联调改：
  - 弧光在判定帧生成时**已扫开 42%**（`REVEAL_START`）：那一刻第一人称的刀已从蓄势侧挥到中线，从 0 起扫会落后刀身约半个弧。
  - 下劈弧面顶端向右倾 26°、右移 0.3 米，中段沿弧面法线背离眼睛鼓出 0.13（`DIP_V`）：原竖直面几乎经过眼睛，侧看只是一根竖条。
  - 技能收刀弧光改用横斩方向（`segment 0`，右 → 左），与第一人称从身侧压刀姿态横斩而出的方向一致（原为回斩方向，刀与弧光反向）。
- 贯穿错开 0–0.03 秒出发、0.1–0.13 秒射入，由 BladeSkill 提前 `IMPALE_LEAD` 0.13 秒调用（审查修复，见 10.4.7）；刃印的 6 柄从环上收入，0.1–0.12 秒到齐。
- **审查修复（亮色关卡的颜色）**：魔刀特效全是加法混合且混白 25–60%，在沙漠 / 砖墙上被洗成白 / 粉。弧光改为「普通混合深色底层（弧光色 × 0.7，不透明度 0.4）+ 加法细热边（`MAX_ALPHA` 0.55 → 0.35，径向收窄为 v³）」两层共用几何体；外缘刃光带混白 0.35 → 0.12；贯穿刃混白 0–0.45 → 0–0.12；刃印 0.25 + 0.25·sin → 0.08 + 0.12·sin；斩击火花 / 刀痕、突进风压线、召回、贯穿爆闪的混白统一为 0.3（`HOT_WHITE`），贯穿爆闪的白色光核改为主题色。
- **审查修复（弧光几何）**：`R_OUT` 0.85 → 1.05、`R_IN` 0.55 → 0.72，最亮的外缘落在真实判定距离上（判定按胶囊表面，敌人中心在 3.6 米处也会被砍中，原弧光止于 2.72 米）。`TILT_H` 15° → 22°、`DROP_H` 0.32 → 0.55：从眼睛看弧面的掠射角 ≈ asin(DROP_H / 距离)，只由弧心与眼睛的距离决定（2.3–3.4 米处由约 5–8° 提到约 9–13°），径向下压不改变它，所以 `DIP_H` 反而由 0.12 降到 0.06，免得外缘沉到地面（审查建议的 0.32 在 3.4 米处会把外缘压到离地约 5 厘米）。下劈的 `SHIFT_V` 0.3 → 0.4（同理）。「在 viewScene 里画朝向镜头的新月面片」的方案未做。
- **审查修复（视野外的贯穿）**：前方 3 / 5 / 7 / 9 米的 4 个敌人在 8 米突进后有 3 个在身后，贯穿全部发生在屏幕外。`impale()` 判断目标与相机前向夹角 > 55° 时，刃群起点改为「相机 + 前向 × [2.5, 4] + 上 × [0.8, 2.4] + 右 × [−3, 3]」，从玩家眼前上方掠过头顶射向身后；视野内仍用球壳起点。HUD 另有全屏反馈（10.9）。审查可选建议（命中后降低出口速度、按最后命中点截短突进）改变技能手感与数值，未做。
- 空闲时弧光网格与刃片实例网格保持可见、绘制量为 0，换关预编译能编到；实测第一次挥砍无卡顿。

### 10.9 HUD（P 流，`ui/HUD.ts`、`ui/Crosshair.ts`、`ui/UI.ts`、`ui/css/hud.css`、`ui/css/combat.css`）

- 全部通过 `IWeaponSystem` 的可选字段读取（`?? null / ?? 1 / ?? 0` 兜底），不 import weapons 模块；`activeForm !== null` 即「当前是双形态 / 召回武器」。
- **武器槽**（`WeaponPanel`）：
  - 标题行新增形态徽记 `span.gf-weapon__form`，文字 `describe().formNames[activeForm === 'melee' ? 0 : 1]`，类 `is-melee`（朱红）/ `is-ranged`（暗金）；只在形态变化时写 DOM。`formMorphProgress < 1` 时 `.gf-weapon__main.is-morphing`（徽记翻转动画）。
  - 弹药：`melee` 形态 `magEl = '∞'`（`is-inf`），分隔符隐藏，`reserveEl = '刃 ' + mag`（小号，提示回刃进度）；`ranged` 形态 `magEl = mag`、`reserveEl = '∞'`。需要把现在内联创建的分隔符 `gf-weapon__sep` 存成字段。
  - 提示：`ranged` 时换弹中显示「召回中」、空匣显示「按 R 召回」，永不显示「弹药耗尽」。
  - 换形一击：`formStrikeTime > 0` → `.gf-weapon__main.is-strike`（朱红 `#ff4a30` 边框光晕，0.6 秒往返脉动）。
- **武器技能图标**：新类 `WeaponSkillIcon`（结构仿 `SkillIcon`：圆盘 + SVG 冷却环 + 单字 `glyph` + 冷却秒数 + 按键角标 `key`），根 `div.gf-wskill`，放在右下角武器槽左侧；`weaponSkill` 为 null 时隐藏；`cooldownRemaining > 0` → `is-cooling`，`active` → `is-active`；冷却从 > 0 变为 0 时 `flash()`；`title` = 技能描述。
- **事件**（`ui/UI.ts` 追加两行接线）：`weapon:skillUsed` → `hud.onWeaponSkillUsed()`（图标闪一下）；`weapon:formChanged` → `hud.onWeaponFormChanged()`（武器槽 `pulse()`）。
- **准星**（可选）：`activeForm === 'melee'` 时 `.gf-xhair.is-melee`（四条准星线换成左右两道弧形括号，样式追加到 `combat.css`）；散布由 L 流设为 `MELEE_HUD_SPREAD`。
- **操作说明** `ui/labels.ts` 的 `CONTROLS`：右键改为「瞄准（缩放视野、降低散布）；持魔刀千刃时切换形态」，新增 `{ keys: ['V', '中键'], action: '武器技能（魔刀千刃：千刃·无间）' }`。`WEAPON_NAMES.demon_blade` 已在契约中加入。

**实现备注（P 流，已落地）**：

- 形态名取 `describe().formNames`（只在武器变化时取），缺省兜底 `['近战', '远程']`；徽记在标题行最左（元素徽记之前）。变形翻转为 CSS 动画（`is-morphing` 期间徽记从 90° 翻入，0.25 秒）。
- `weapon:formChanged` → `hud.onWeaponFormChanged()` 调用武器槽的 `morphPulse()`（整槽提亮 0.32 秒），**不用**切枪的 `pulse()`（横移滑入是「换了一把枪」的语义）。
- 弹药：`melee` 时 `magEl = '∞'`（`is-inf`）、分隔符隐藏、`reserveEl = '刃 N'`（`is-blades`），且不显示低弹红字；`ranged` 时备弹恒为 ∞。提示：`ranged` 换弹中「召回中」、空匣「按 R 召回」（闪烁警示）；`melee` 无提示。
- 换形一击：`is-strike` 右边框 `#ff4a30` 光晕，0.3 秒单程往返（一次往返 0.6 秒）；减少动态效果时常亮。
- 武器技能图标复用 `.gf-skill` 的结构与样式（根为 `div.gf-skill.gf-wskill`，圆盘 52 px、朱红冷却环，释放中 `is-active` 朱红脉动）；右下角改为 `flex` 横排（图标在左、底部对齐，向武器槽透明的左内边距重叠 22 px）。`title` 为 `describe().skill` 的「名称（V / 鼠标中键）：描述」。冷却从 > 0 变为 0 时闪一下；刚出现 / 重置后的第一帧不闪。
- 准星：`.gf-xhair.is-melee` 隐藏上下两条线，左右两条改为 8 × 22 px 的弧形括号（`border` + 椭圆圆角），颜色仍随 `--xc`（压到敌人身上变红）。

**审查修复（HUD / 准星）**：

- 攻击距离：近战形态不再用 150 米射线判断变红，改读 `IWeaponSystem.meleeInRange`（新增可选字段，WeaponSystem 每 3 帧按下一段扇形判定）。在距离内括号朱红 `#ff4a30`、`--gap` 收紧 4 像素；距离外括号不透明度 0.55。
- 换形一击窗口：`formStrikeTime > 0` 时 `.gf-xhair.is-strike`，准星（括号 / 线与中心点）朱红并以 0.3 秒往返脉动（玩家视线在准星上，武器槽边框容易错过）。
- 贯穿：`weapon:skillImpale` → `hud.onWeaponImpale(points)` → 准星层 0.12 秒朱红暗角闪（`.gf-bladeflash`），并对水平夹角 > 50° 的每个刃印在屏幕边缘朝它的方向亮 0.52 秒朱红刃光（复用受击方向弧的形状，`.gf-dmgdir__arc--blade`，跟随转向）。
- 武器槽：形态徽记下方 11 像素、60% 不透明度的「右键 ⇄ 千刃 / 右键 ⇄ 斩」，本次会话前 5 次变形后淡出并收起；斩形态的 ∞ 46 → 28 像素，「刃 N」16 → 22 像素并按储量由灰转朱红（`--fill`）。千刃形态徽记与武器名「魔刀千刃」字面重复的问题未改：形态名「斩 / 千刃」是已确认的设计用语（notes、描述、文档通用）。

### 10.10 音效（P 流，`audio/SfxWeapons.ts`、`audio/Sfx.ts`）

契约已在 `SfxId`、`WEAPON_SFX`（占位配方）与 `SFX_META`（占位混音）三处加入 7 个 id；P 流替换为正式配方（程序化合成，`Synth.ts` 工具）：

| SfxId | 触发 | 配方方向 | 建议 `SFX_META` |
|---|---|---|---|
| `blade_swing` | 每段挥砍开始（pitch 1.06 / 0.96 / 0.82） | 带通噪声 600 → 3800 Hz 上扫 0.14 秒（q 1.2，attack 0.02）+ 极轻的正弦哨音 2200 → 1400 | `m(0.45, { prio: 3, throttle: 0.03, pitch: 0.05, send: 0.06 })` |
| `blade_hit` | 判定帧有命中 / 技能路径命中 | 低频钝击 160 → 60 Hz 0.09 秒 + 棕噪声低通 1800 爆裂 0.08 秒 + 金属余振三角波 1850 / 2770 Hz 0.12 秒，过 `drive(2)` | `m(0.5, { prio: 3, throttle: 0.04, pitch: 0.05, send: 0.08 })` |
| `blade_throw` | 千刃齐射（一轮一次，`def.sfx`） | 三道错开 0 / 0.015 / 0.03 秒的带通噪声「嗖」（3200 → 1500 Hz）+ 4 kHz 细咔嗒 | `gun(0.42, 0.08)` |
| `blade_recall` | 召回开始、回刃（0.35 / pitch 1.5） | 带通扫频 800 → 3000 Hz 0.35 秒 + 颤音（tremolo）+ 结尾金属合拢（三角波 2400 / 3600） | `m(0.45, { prio: 3, throttle: 0.08, send: 0.12 })` |
| `blade_morph` | 变形开始 | 两声机括咔嗒（带通 3500 q 2）+ 刃鸣三角波 1500 → 2600 Hz 0.2 秒 | `m(0.42, { prio: 3, throttle: 0.08, send: 0.12 })` |
| `blade_dash` | 技能突进 | 棕噪声低通 3000 → 400 呼啸 0.22 秒 + 次低频 90 → 40 Hz + 粉噪声尾 | `m(0.55, { prio: 3, throttle: 0.1, send: 0.12 })` |
| `blade_impale` | 千刃贯穿（一次释放一次） | 12 个 0.012 秒的随机高频瞬态（2–5 kHz）在 0.08 秒内铺开 + 110 → 35 Hz 重击过 `drive(4)` + 粉噪声低通 2400 → 300 的 1 秒长尾 | `m(0.7, { prio: 3, throttle: 0.1, pitch: 0.02, send: 0.3 })` |

`AudioSystem.ts` 不需要改（无持续音）；如需按 id 特殊处理也归 P。

**实现备注（P 流，已落地）**：7 个正式配方在 `audio/SfxWeapons.ts`，`SFX_META` 沿用上表建议值。在上表方向之上的补充：`blade_swing` 另加收势回落的第二道带通（3200 → 900 Hz）、刃口高频嘶声（高通 5.2 kHz）与粉噪声低通「呼」（风压，给出刀身重量），主体 attack 0.05 秒让峰值落在判定帧附近；`blade_hit` 另加 75 → 42 Hz 次低频下沉与 1.3 kHz 中频撕裂（刃口咬入），金属余振压到很轻，避免听成打在护甲上；`blade_throw` 三道「嗖」各自 ±6% 音高；`blade_morph` 刃鸣带 11 Hz 颤音并加一缕高通 4.5 → 7.5 kHz 的出鞘「锵」；`blade_dash` 起手加一道 1.6 → 4.2 kHz 风切；`blade_impale` 重击后加 1320 / 1980 Hz 三角波刃鸣余韵。审查修复：`blade_impale` 在伤害那一帧播放，瞬态铺开 0.08 → 0.03 秒、重击层 `at` 0.07 → 0、长尾与刃鸣 0.08 → 0.01，与刃群 / 伤害同帧。

### 10.11 词条兼容（L 流，`weapons/Affixes.ts`、`AffixEffects.ts`、`Describe.ts`）

#### 10.11.1 `allow()` 规则

| 词条 | 现规则 | 改为 | 作用形态 |
|---|---|---|---|
| `spread` | `isHitscan(d)` | `isHitscan(d) \|\| isDualForm(d)` | 千刃 |
| `headBlast` / `ricochet` / `pierce` / `detonate` | `directHit`（`detonate` 另要求非蓄力） | `directHit = isHitscan(d) \|\| d.kind === 'crossbow' \|\| isDualForm(d)` | 爆头爆炸只在飞刃爆头时触发（斩击没有 `headshot`）；穿透只作用于飞刃；弹射、破势两形态都生效 |
| `reserve` | `any` | `(d) => !d.recall` | — |
| `recoil` / `projSpeed` / `mag` / `reload` | 已允许 | 不变 | 千刃 |
| `blast` | `isExplosive` | 不变（魔刀不会抽到） | — |
| `seed` | 投射物且非爆炸 | 不变（魔刀可抽到，两形态命中都种蛊） | 两形态 |
| `swift` / 伤害 / 暴击 / 元素类 / 反应类 | `any` 等 | 不变 | 两形态 |

`describeAffix(def, a)`：双形态武器上 `mag / reload / spread / recoil / projSpeed / pierce / headBlast` 的文案末尾加「（千刃）」。

#### 10.11.2 传说特性与计数

- `lg_nth`（天命）：`rt.shots` 每段斩击（判定帧，命中与否都算）+1、每轮飞刃 +1，共用计数；`value(d)` 照旧（魔刀 `shotsPerSecond = 2` → 每第 4 次）；双形态文案「每第 N 次攻击必定暴击（斩击按段、飞刃按轮计）」。
- `lg_last`（终焉）：只作用于飞刃（斩击不耗弹）；`perProjectileAmmo` 时判定「本轮打空弹匣」；文案「最后一轮飞刃伤害 ×3」。
- `lg_endless`（无尽）：只作用于飞刃（斩击本来不耗弹）；免耗时整轮不扣；文案「飞刃齐射时 30% 几率不消耗飞刃」。
- `lg_frenzy`（狂热）：两形态命中都叠层，层数同时加快斩击（D7）。其余传说（连环爆、万象、合璧、轮回、涅槃、鼎沸）两形态都生效，不改。
- 命中频率归一化（`AffixEffects.onDamaged`）：`const k = hasTag(req, 'slash') ? R.meleeHitScale : 1`；副·焚 / 雷 / 蚀几率 `min(0.75, R.subX × k)`；万象几率 `min(0.75, R.legendaryValue × k)`；弹射几率斩击用 `R.ricochet`（不再除以 √弹体数）、飞刃照旧 `R.ricochet / √3`。
- `dropWeight 0.6`：总权重 17.0，单次掉落约 3.5% 是魔刀。

#### 10.11.3 `Describe.ts`

双形态武器的属性行：`斩击 28 / 28 / 54`（× damageMult）、`飞刃 16 ×3`、`攻速 一轮 1.06 秒`（÷ fireRateMult）、`射速 2.0 轮/秒`、`秒伤 斩 约 104 · 千刃 约 96`、`弹匣 18 柄飞刃`、`召回 1.4 秒`（代替「备弹」「换弹」两行）、`暴击`、`元素 斩 35% · 飞刃 17%`、`穿透 1（飞刃）`、`强化`。特性行 = notes + 词条 + `【武器技能·千刃·无间】V / 鼠标中键：<description> 冷却 16 秒。` + 传说；`desc.formNames = melee.formNames`、`desc.skill = { name, key: 'V', description, cooldown }`。

### 10.12 契约清单（已落地，2026-10-02）

| 文件 | 内容 |
|---|---|
| `core/types.ts` | `ProjectileVisual` 加 `'blade'`；`SfxId` 加 `blade_swing / blade_hit / blade_throw / blade_recall / blade_morph / blade_dash / blade_impale`；`GameEvents` 加 `'weapon:formChanged' { weapon, form }`、`'weapon:skillUsed' { weapon, skillId }`；`IPlayer` 加 `isLunging / lunge(dir, dist, time, iframes?, exitSpeed?) / cancelLunge()`；`WeaponDescription` 加 `formNames? / skill?`；新类型 `WeaponForm = 'melee' \| 'ranged'`、`WeaponSkillState`；`IWeaponSystem` 加可选 `activeForm / formMorphProgress / formStrikeTime / weaponSkill`；新接口 `IBladeFx`（`slashArc / slashHit / mark / impale / dashTrail / recall`）与 `IFx.blade` |
| `core/Input.ts` | `Action 'weaponSkill'`（`KeyV` + 中键 `button 1`）；中键 `mousedown` / `auxclick` `preventDefault` |
| `weapons/WeaponDefs.ts` | 10.2 全部类型、字段（默认值）与 `isDualForm / formMode / comboCycleTime` |
| `weapons/WeaponStats.ts` | `ResolvedWeapon.damageMult`、`meleeElementChance` 及其计算 |
| `weapons/AffixEffects.ts` | `WeaponRuntime.form: WeaponForm` |
| `weapons/WeaponSystem.ts` | `runtime()` 字面量补 `form: 'melee'`；`vmState = createViewmodelState()`（两处机械改动，无行为变化） |
| `weapons/Viewmodel.ts` | `ViewmodelState` 新字段 + `createViewmodelState()`；空方法 `onSlash(segment, color)`、`onSlashHit(heavy)` |
| `fx/Fx.ts` | `NOOP_BLADE_FX` 与 `readonly blade: IBladeFx` 桩 |
| `player/PlayerController.ts` | `isLunging`（恒 false）、`lunge()`（返回 false）、`cancelLunge()` 桩 |
| `combat/ProjectileVisuals.ts` | `'blade'` 暂用 shard 外观与动画 |
| `combat/Projectiles.ts` | `'blade'` 细拖尾；`touchesPlayer` 突进无敌穿透 |
| `audio/SfxWeapons.ts`、`audio/Sfx.ts` | 7 个占位配方与混音参数 |
| `ui/labels.ts` | `WEAPON_NAMES.demon_blade = { name: '魔刀千刃', category: '刀' }` |
| `core/types.ts`（审查修复追加） | `IPlayer.cameraPunch(roll, pitch)`；`IPlayer.lunge` 文档改为硬 / 软突进两种语义；`IWeaponSystem.meleeInRange?`；`IBladeFx.clearMarks()`；`GameEvents['weapon:skillImpale'] { weapon, points }` |

### 10.13 并行实现分工

| 流 | 独占文件 | 对应小节 | 依赖的契约 |
|---|---|---|---|
| **L 逻辑** | `weapons/WeaponDefs.ts`、`WeaponSystem.ts`、`Firing.ts`、`WeaponStats.ts`、`Describe.ts`、`Affixes.ts`、`AffixEffects.ts`，新文件 `weapons/Melee.ts`、`weapons/BladeSkill.ts` | 10.1、10.3、10.4、10.11 | `WeaponDefs` 新类型、`WeaponRuntime.form`、`ViewmodelState` 字段与 `onSlash / onSlashHit`、`IFx.blade`、`IPlayer.lunge / isLunging`、`IWeaponSystem` 可选字段、新事件、新 SfxId |
| **V 表现** | `weapons/WeaponModels.ts`、`weapons/Viewmodel.ts`、`combat/ProjectileVisuals.ts`、新文件 `fx/BladeFx.ts`（可再拆 `fx/Blade*.ts`）、`fx/Fx.ts`（只改 blade 接线三处） | 10.7、10.8 | `ViewmodelState` 字段、`IBladeFx`、`ProjectileVisual 'blade'`、`WeaponDef.kind 'blade' / reloadStyle 'recall'` |
| **P 玩家 / HUD / 音效 / 文档** | `player/PlayerController.ts`（及 `CameraRig.ts`）、`ui/HUD.ts`、`ui/Crosshair.ts`、`ui/UI.ts`（两行事件接线）、`ui/labels.ts`（只改 `CONTROLS`）、`ui/css/hud.css`、`ui/css/combat.css`（只追加准星样式）、`audio/*`、`DESIGN.md`、本文档 | 10.5、10.9、10.10 | `IPlayer` 突进接口、`IWeaponSystem` 可选字段、`WeaponDescription.formNames / skill`、新事件、新 SfxId |

冻结（契约文件，三条流都不改）：`core/types.ts`、`core/Input.ts`、`combat/Projectiles.ts`。不在任何流内、也不需要改：`combat/Combat.ts` 等战斗文件、英雄选择相关文件（`ui/HeroSelect.ts`、`ui/HeroPreview.ts`、`ui/heroPreview/**`、`ui/css/panels.css`、`ui/css/menu.css`、`ui/css/base.css`、`hero-lab.html`）。

**流之间的接口**

- **L → V（第一人称）**：每帧写 10.7.1 的 `ViewmodelState` 字段；调用 `vm.onSlash(segment, color)`（每段开始）、`vm.onSlashHit(heavy)`（判定帧有命中）、`vm.onShot(def, color, 1)`（每轮飞刃一次）、`vm.getMuzzleWorld(out)`（飞刃出生点 / 召回终点）。
- **L → V（特效）**：`ctx.fx.blade.slashArc`（每段判定帧、技能收刀）、`slashHit`（每个命中，每段 ≤ 6）、`mark`（技能路径命中的存活敌人）、`impale`（贯穿每个刃印敌人）、`dashTrail`（突进每帧）、`recall`（召回开始、斩击 / 技能回刃）；飞刃投射物 `visual: 'blade'`。颜色一律为 10.4.4 的 `color`。
- **L → P（玩家）**：`player.lunge(fwd, 0.6, windup / 攻速, 0, 2)`（第三段）、`player.lunge(fwd, 8, 0.18, 0.25, 6)`（技能）；读 `player.isLunging` 判断突进结束。P 合入前 `lunge` 返回 false：技能在原地结算，第三段不前冲。
- **L → P（HUD / 音效）**：`IWeaponSystem.activeForm / formMorphProgress / formStrikeTime / weaponSkill`、`describe().formNames / skill`、事件 `weapon:formChanged / weapon:skillUsed`；播放 10.10 表中的 7 个 SfxId（音量 / 音高见 10.4）。L 合入前这些字段为 `undefined`，HUD 必须兜底为「普通武器」显示。
- **V ↔ P**：无直接接口。

**合入顺序**：任意。建议 L 先合（魔刀进入掉落池即可试玩，其余为桩），V、P 随后；三条流都合入后按 10.14 联调。

### 10.14 验证清单

- `npm run typecheck`、`npm run build` 零错误；其他 17 把武器行为不变（右键开镜、换弹、蓄力、轮转）。
- 调试（`?debug`）：`__ctx.weapons.give(__ctx.weapons.roll({ defId: 'demon_blade', rarity: 0 }))`。
- 斩：按住左键三段自动循环、一轮约 1.06 秒；松开 > 0.6 秒回到横斩；扇形内多敌同时受击；每段每敌只出一个伤害数字；第三段前冲约 0.6 米、强击退；对眩晕敌人第三段必暴；挥空不消耗；命中回刃（HUD「刃 N」增加，每段最多 +3）；持斩移速 7.5 → 7.9。
- 千刃：一轮 3 柄呈 −5° / 0° / +5°（余量 2 柄时 ±2.5°，准星正中仍能命中小怪），可爆头、穿透 1、24 米外消失；18 柄 = 6 轮；R 或打空 0.25 秒后召回 1.4 秒；备弹恒 0、HUD 显示 ∞；地上的弹药包不会被吸取；「换弹冲击」等换弹秘卷生效。
- 变形：右键 0.25 秒、期间不能攻击；判定帧之前按右键会缓冲到判定帧之后；变形后 2 秒内第一次攻击伤害 ×1.5（斩 28 → 42，千刃每柄 16 → 24），HUD 武器槽发光、准星朱红脉动；用掉后 1.5 秒内连按右键变形不再出现换形一击；持魔刀时右键不改 FOV。
- 技能：V 与中键都能释放（中键不触发浏览器自动滚动）；突进 8 米 0.18 秒、撞墙提前停下、期间敌方投射物穿身而过；路径两侧 1.6 米内敌人受击并出现刃印；0.6 秒后贯穿 140，身上两种元素的敌人引发反应、一种元素「崩解」；每命中 1 敌 +2 柄；冷却 16 秒（技能急速 +100% → 8 秒），HUD 冷却环与 V 提示。
- 重置：连段中切枪 → 切回从横斩开始；突进中死亡 → 无贯穿；待贯穿时换关 → 无贯穿、刃印消失；暂停于挥砍中 → 恢复后该段继续、不自动接段；新开一局技能冷却清零。
- 词条：魔刀能抽到散布 / 后坐 / 弹速 / 穿透 / 爆头爆炸，抽不到备弹 / 爆炸范围；天命按「段 / 轮」计数。

**联调结果（2026-10-03，浏览器实测，`?debug` + 逐帧推进截图）**：以上各条均已实测通过——三段连斩判定间隔 0.30 / 0.37 秒、一轮 1.06 秒，扇形内 4 敌同时受击、每段回刃封顶 +3，第三段前冲 0.6 米、对眩晕敌人必暴；换形一击 28 → 42、16 → 24；飞刃 6 轮打空、爆头 ×2、穿透 1（第三名敌人不受击），打空后召回 1.4 秒、HUD「按 R 召回」与 N / ∞；技能 V 与中键均可释放，突进 8 米 / 撞墙 2.95 米提前停、无敌 0.25 秒内受伤为 0，突进结束 0.6 秒后贯穿，灼烧 + 雷殛的敌人引发焚雷、只有蚀化的敌人崩解，技能急速 +100% 冷却 16 → 8 秒，冷却中按下 `ui_deny`；切枪后回到横斩、形态按实例保留、其他武器右键仍开镜；突进中死亡 / 待贯穿时换关都不贯穿，新开一局冷却清零；控制台无报错。联调中调整的手感参数见 10.7、10.8 的实现备注。
