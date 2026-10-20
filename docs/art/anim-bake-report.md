# 原生骨架动作采样报告（E5 动作管线，2026-10-21）

对应 [unity-parity.md](../unity-parity.md) 3.7「动作补全」、3.8 第二 / 三章「缺的片段」、3.14、第 6 节「第二章缺约 25 段片段 / 第三章招牌状态片段 / 熔心魔将动作 / 鲲鹏火麒麟动画事件」。
采样器原理见 [unity-art-pipeline.md](../unity-art-pipeline.md) 5.1。

## 1. 怎么重新生成

```bash
# 1) 采样（Node，几十秒；输出可再生成、不入库）
node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs            # 全部
node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs tuo SK_Boss_Warlord
BAKE_VERBOSE=1 node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs qingniao   # 打印每个强制场景的状态序列

# 2) 片段 + AC_ 状态机 + 弹簧链（Unity：Spiritfire ▸ Art ▸ Sync All）
bash scripts/unity/bridge.sh sync
bash scripts/unity/bridge.sh sheets      # 可选：动作审核图 Assets/Art/_Review/anim/
```

- 采样数据写到 `unity/Assets/Art/Characters/<资产>/Anim/<资产>.native-anim.json`（`unity/.gitignore` 忽略）。种子固定，两次全量采样的片段完全一致（只有 `baked` 时间戳不同）。
- Sync 之后要入库的：新出现的 `.meta`（五个 `<资产>.events.json.meta`、`SK_Boss_Warlord/Anim.meta`、`SK_Boss_Warlord.native-anim.json.meta`）、重建的 `AC_<资产>.controller`（熔心魔将是新建的）、角色 Prefab。`.anim` 本身照旧不入库。

## 2. 管线改了什么

| 项 | 做法 |
|---|---|
| 每个资产一份采样配置 | `scripts/unity/bake/<资产 ID>.mjs`（下划线开头的文件不当配置）。原来写死在采样器里的 `IDLE_STATE / IDLE_LOOP_MAX / ALLIES / BOSSES` 全部搬进各自的文件；字段说明在 `bake-native-anims.mjs` 文件头 |
| 强制进入状态 | `scenes[]`：`start` 直接调 AI 自己的入口（`beginLunge`、`startScreech`、`breakClaw`、`beginRoar`……与游戏里是同一段代码），`step` 每帧保持条件，`label` 给叠在状态上的演出起名（狐巫碎镜尖啸、祸斗吠叫），`loops` 把持续型状态切成无缝循环，`inPlace` 去掉离地高度（攀爬、坠落由玩法抬 / 降根节点） |
| 场景道具 | `props`：`box`（高台、矮墙）、`pillar`（栖柱）、`lava`（熔岩掩码，同 `StageDirector.lavaSystem.lava`，导航同步避开）、`fire`（`FireFeed.registerFloorFire` 地火）、`ally`（友军桩，可冻住 AI、可设剩余血量） |
| 采样器修正 | 玩家桩的 `isDashing / onGround / isLunging` 显式给值：以前 lenient 代理把 `isDashing` 当成空函数（真值），马面的钩子永远钩不中、拖拽一开始就判「冲刺逃脱」——现在自然出招就能录到 `drag` |
| Boss 连段 | `lead`：连段后半先把前一段放够它在游戏里的时长再录（猛砸从 slamWind 接过去，而不是从待机）；`seconds`：每段按 `KunPeng.ts / Qilin.ts / Warlord.ts` 里的切换时刻定长。火麒麟的 `next` 按现在的招式编排改成 tuck → stomp、leap → drink |
| 部件骨架 Boss | 熔心魔将（`rig.mode = parts`）：桩按清单的骨架指纹（与 `attachPartsBody` 同规则）把程序化模型的关节 `j_*` 交给采样器，静止姿势在登场演出之前取；步态按 velocity（`gaitBy: 'velocity'`） |
| 事件叠加表 | `Anim/<资产>.events.json`（手写、入库）：`{ "clips": { "<状态>": [{ "at": 0–1, "name": "hit", "float": 可选 }] } }`，或对象形式 `{ events, replace, next, loop, speed }`。NativeClipBuilder 与采样事件合并后写成 Mecanim 事件 `OnAnimEvent(name)`。已写：鲲、鹏、火麒麟两形态、熔心魔将 |
| 手工关键帧 | `Anim/Keyframed/*.fbx`：文件名 = 状态名（多 take 用 take 名，下划线 / 空格转驼峰），导入设置对齐本体（人形 Copy From Other Avatar，其余 Generic 按骨骼名重定向曲线、丢掉根节点曲线），复制成 `<资产>_<状态>.anim` 并进 AC_；同名时手工优先；只有关键帧、没有采样数据的资产（旱魃）也会生成 AC_ |
| 持续型状态 | `loop` 为真的招式（潜游、栖落、空手追击）在 AC_ 里没有自动退出，进去后一直循环，由玩法 CrossFade 出去；即使是连段后半也挂 `act_` 触发器 |
| 分叉弹簧链 | `CreatureRigBuilder`：同族子骨骼不止一根时主干在分叉处收尾、每个分支各起一链（主干在前，分支追的是主干摆过之后的姿势）。狐巫 `tail_root` → 1 + 9 条，三青鸟 `tail_0` → 1 + 3 条；布娃娃只取主干尾根 |

## 3. 第二章（11 种，新增 25 段）

| 资产 | 现在的片段（Idle / Hit / Walk / Move 之外） | 本次新增 | 仍缺 / 说明 |
|---|---|---|---|
| 冻鲛人 Jiaoren | aim throw recover jabWindup jab lungeWindup lunge | lungeWindup、lunge（`beginLunge`，玩家站定、刺中收招） | 无 |
| 雪狌狌 SnowXingxing | slamWindup slamAir recover swipeWindup swipe climbPrep climb throwWindup throwRelease rally | climbPrep、climb（2 m 高台，inPlace）、throwWindup、throwRelease（5 m 高台爬不上去）、rally（`startRally`） | 无。climb 片段不带抬升，Unity 用 NavMeshLink 抬根节点 |
| 冰甲旋龟 XuanGui | peckWindup peck backoff retract spin overheat rightself biteWindup bite | biteWindup、bite（玩家在身后，`beginBite`） | 翻身 / 壳旋转转的是 host，已随参照系进骨骼姿势（见 5.1） |
| 玄冰巨蟹 FrostCrab | grabWindup grab grabRecover sweepWindup sweep shellBreak | sweepWindup、sweep（玩家在侧面）、shellBreak（`breakClaw`） | 断钳后巨钳网格隐藏要玩法做（片段只有姿势） |
| 三青鸟 Qingniao | volley recover toPerch perched↻ takeoff screech swoopDown swoopUp | toPerch、perched（循环）、takeoff（3 m 栖柱）、screech、swoopDown、swoopUp | 无；尾羽 3 根都弹（分叉链） |
| 冰河豚 IcePuffer | dive recover inflate | inflate（`startInflate`，自爆后的帧不算） | 无 |
| 冰棘豪彘 Haozhi | scrape charge stagger bristle | bristle（`startBristle`） | 无 |
| 夫诸 Fuzhu | crouch leap land charge recover | — | 无（原本就齐） |
| 冰鲸 IceWhale | rear slam recover swell spout | — | 无（原本就齐） |
| 九尾狐巫 FoxWitch | blink mirrorCharge wallWindup enter armorWindup scream foxfireWindup | enter（出生缩放一结束就录）、armorWindup（两只鲛人桩）、scream（碎镜后 stalk 里的 screamTime）、foxfireWindup | 无；九条尾巴都弹。待机改用 stalk（以前停在 enter 里） |
| 冰灯水母 LanternJelly | shockWindup stagger | stagger（喂一次假爆头给它自己的 `onHurt`） | 治疗连线不是状态（drift 里画线），不需要片段 |

## 4. 第三章（10 种，新增 31 段）

| 资产 | 现在的片段 | 本次新增 | 仍缺 / 说明 |
|---|---|---|---|
| 炭童 Tantong | throwWindup throwRelease recover pounceWindup pounce flail blowGo blow | blowGo、blow（余烬炭堆友军桩） | 复燃后的 tantong_reborn 共用本体片段 |
| 祸斗 Huodou | biteWindup bite recover eat spitWindup spit bark | eat、spitWindup、spit（地火道具）、bark（run 里叠的 pBark，关 AI 原地录） | 吠声由玩法播（bark 片段没有音效事件） |
| 熔炉铁牛 IronOx | tossWindup toss inhale spitWindup spit choke | choke（吸气 0.75 s 后呛火） | 无 |
| 火鼍 Tuo | biteWindup bite toLava swim↻ surge lunge regrow sweepWindup sweep roar | toLava、swim（循环）、surge、lunge（熔岩湖：上岸 → 爬进熔岩 → 潜游 → 岸边鼓泡 → 扑咬）、regrow（碎 3 块甲回熔）、sweepWindup、sweep（玩家在侧后）、roar | `enter` 只有一帧（马上判定去熔岩还是上岸），不出片段；岩甲分区的材质要烘焙（不归 E5） |
| 毕方 Bifang | takeoff glide land cryBi cryFang recover fall downed | fall（inPlace）、downed（站在 4 m 栖柱顶、腿伤拨满） | 没有 Walk / Move：毕方不走路，滑翔换落脚点（设计如此） |
| 马面狱卒 Mamian | sweepWind sweep recover spin throw drag reel staggered brawl↻ punchWind punch | drag（修了 isDashing 后自然就钩中）、staggered（拖拽中射断链）、brawl（缴械后空手追击，循环）、punchWind、punch | throw 的 `next` 现在是 drag（钩中）；没钩中时玩法要自己 CrossFade 到 reel |
| 炮仗傀儡 Firecracker | stomp brace fuse volley recover toppled getup | toppled、getup（`dud`） | 无 |
| 神火飞鸦 FireCrow | ignite dive | dive（先压住冷却爬到巡航高度再点火；撞地自爆后的帧不算） | 无（翼网格转 90° 不归 E5） |
| 熔铜匠 Founder | flingWindup retreat enter pourWindup pouring crackStagger | enter、pourWindup、pouring（冻住的铁牛当浇铸对象）、crackStagger（`crackCrucible`） | 无。待机改用 stalk |
| 变脸傩巫 Nuo | spitWindup spit wipe enter cover | enter、cover（`breakFace`） | dance 是她的移动步态（= Walk / Move），站着跳 = Idle（待机改用 dance）；面具分区材质不归 E5 |

## 5. 首领

| 资产 | 片段 | 本次 | 说明 |
|---|---|---|---|
| 鲲 SK_Boss_Kun | inhale bite slamWind slam spit roar rise sink erupt | 时长按招式切换时刻（inhale 3.9 / bite 0.7 / slamWind 1.1 / slam 0.85 / sink 2.0 / erupt 1.0 / spit 1.3），bite / slam / erupt 从前一段接过去；`SK_Boss_Kun.events.json`（扑咬、猛砸、二道冰浪、破冰、吐冰、吞吸起止） | rise / roar 只有音效、震屏事件 |
| 鹏 SK_Boss_Peng | swoopReady dive crash perch takeoff gust spread roar | dive / crash / takeoff 定长并接前段；`SK_Boss_Peng.events.json`（俯冲 hitOpen、落台 / 起飞冲击、羽刃雨 10 发） | 俯冲擦中是整段线段检测，事件只标开始 |
| 火麒麟 · 玄鳞 SK_Boss_Qilin | Walk Move rear scalesFire drink breath stun pant tuck leap stomp roar paw | 定长 + 接前段（scalesFire ← rear、drink ← leap、stomp ← tuck、pant ← stomp）；`next` 改成现在的编排；事件表 | gallop 步态 = Walk / Move |
| 火麒麟 · 焚身 SK_Boss_QilinBurn | 同上少 drink | 同上 | — |
| 熔心魔将 SK_Boss_Warlord | Idle Walk Move chargeReady charge crash sweepReady sweep sweepReady2 sweepBack raise crouch leap land slashA slashB plant roar | **全新**（以前只有 ProceduralIdle）：部件骨架采样 18 段 + `SK_Boss_Warlord.events.json` | ART8 在此基础上补施法 / 受击 / 死亡；受击、死亡目前没有片段（Hit 不适用于部件骨架，走 CreatureRig 程序受击 + 布娃娃） |
| 旱魃 SK_Boss_Hanba | — | 关键帧并入已就绪 | Three.js 没有可采样的源：等 ART2 把 Blender 关键帧放进 `Anim/Keyframed/*.fbx`（见 6.4） |

第一章 6 种、英雄 3 个：配置只是搬家（邪飞天的待机 / 同伴），片段不变。

## 6. 已知限制与风险

1. **自然出招片段有小幅变化**：`isDashing` 修好后马面能钩中，throw 的 `next` 从 reel 变成 drag。第一章 6 种的片段列表与时长和改动前完全一致；
   第二 / 三章前面敌人的强制场景会多消耗固定种子的随机数，排在后面的敌人自然出招片段（同一段代码的另一次采样）时长有零点几秒的差别，状态都在。
2. **inPlace 片段**：climb、fall 不带离地高度，玩法要自己抬 / 降根节点；slamAir、glide 照旧带（玩法不动根节点的高度）。
3. **事件叠加表是按代码读出来的时刻**，落地类判定对到采样姿势落定（约 0.1 s，比 Three.js「切动画那一刻就结算」晚一点，和画面对得上）。BS3 / BS4 / BS6 接玩法时以事件为准；对不上就改 events.json，重跑 Sync 即可，不用重新采样。
4. **关键帧 FBX 会被 `unity/.gitignore` 的 `/Assets/Art/Characters/**/*.fbx` 忽略**：ART2 的源文件在 `art/source/characters/SK_Boss_Hanba/anim/**`（入库），导出到 `Anim/Keyframed/` 的 FBX 和模型 FBX 一样是生成物；要直接入库就得在 `.gitignore` 里给 `Anim/Keyframed/` 开例外（不归 E5）。导出约定：骨架与本体同名骨骼，状态名 = 文件名（不带下划线），人形资产按本体 Avatar 导入。
5. **持续型状态没有自动退出**：swim、perched、brawl 进去后一直循环，玩法必须 CrossFade 出去（EN2c / EN3b / EN3c 注意）。
6. **熔心魔将的骨架指纹**：程序化模型（WarlordModel.ts）一改关节位置，采样器就拒绝采（与运行时同规则），要重新导出 GLB。
7. 采样时 host 自身的旋转已经随参照系算进骨骼姿势（旋龟翻身、火鼍下潜），但 Unity 侧没有单独的 host 节点：整体位移仍是玩法的事。
