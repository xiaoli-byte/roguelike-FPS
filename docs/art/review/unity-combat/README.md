# Unity 战斗演出审阅图集

生成于 2026-10-29 22:17。浏览器打开同目录的 [index.html](index.html) 体验更好（点图放大、← → 翻页）。

每只怪 / 每个首领一张拼图：一行一个招式，四格依次是 **前摇**（预警最满的那一帧）、**出手**、**命中**（没打中则为收招）、**第一人称**（前摇最后一帧的玩家视角）。第三人称旁观机位里的青色胶囊是玩家站位。

重新生成：`bash scripts/unity/bridge.sh playtest gallery-<desert|frost|inferno|hanba|kunpeng|warlord|qilin>`、`playtest boss-intro`、`playtest fx`，然后 `python scripts/unity/combat_gallery.py`。

## 特效打磨（2026-10-29）

四路特效打磨（A 射击核心、B 爆炸 / 元素 / 状态 / 护盾、C 首领与怪物专属 + 预警、D 环境氛围）和一轮风格审查都已完成，本图集是打磨之后用合并后的代码重拍的。特效按 fx-style.md 的准则做：形状先于细节、每个特效 2–3 个色阶、中尺度东方纹样、克制的光、第一人称读感优先；烟尘按章节换暖沙 / 冷白 / 紫褐。各路改前 / 改后对比：

准则：[docs/art/fx-style.md](../../fx-style.md) · 审查报告：[fx-polish/style-audit.md](../fx-polish/style-audit.md)

| 路 | 内容 | 改前 / 改后对比图 |
|---|---|---|
| A 射击核心 | 枪口火焰、抛壳、曳光、弹孔 / 焦痕、命中层、暴击、碎刃刀光 | [blade](../fx-polish/A/blade.jpg) · [crit](../fx-polish/A/crit.jpg) · [hits](../fx-polish/A/hits.jpg) · [holes](../fx-polish/A/holes.jpg) · [muzzle-3p-1](../fx-polish/A/muzzle-3p-1.jpg) · [muzzle-3p-2](../fx-polish/A/muzzle-3p-2.jpg) · [muzzle-all-after](../fx-polish/A/muzzle-all-after.jpg) · [muzzle-fp-1](../fx-polish/A/muzzle-fp-1.jpg) · [muzzle-fp-2](../fx-polish/A/muzzle-fp-2.jpg) · [scorch](../fx-polish/A/scorch.jpg) · [shells](../fx-polish/A/shells.jpg) · [tracer](../fx-polish/A/tracer.jpg) |
| B 爆炸 / 元素 / 状态 / 护盾 | 卡通爆炸三档、五种元素反应、状态外观、护盾球壳 / 破甲、火舌、出生死亡 | [B1-explosion](../fx-polish/B/B1-explosion.jpg) · [B2-reactions](../fx-polish/B/B2-reactions.jpg) · [B3-status-far](../fx-polish/B/B3-status-far.jpg) · [B3b-status-far-zoom](../fx-polish/B/B3b-status-far-zoom.jpg) · [B4-status-near](../fx-polish/B/B4-status-near.jpg) · [B5-shield-armor](../fx-polish/B/B5-shield-armor.jpg) · [B6-flames](../fx-polish/B/B6-flames.jpg) · [B7-spawn-death](../fx-polish/B/B7-spawn-death.jpg) · [B8-spawn-themes](../fx-polish/B/B8-spawn-themes.jpg) |
| C 首领与怪物专属 + 预警 | 首领登场 / 招式 / 倒下、普通怪招式、三章出生法阵、地面预警 | [enemy-moves](../fx-polish/C/enemy-moves.jpg) · [gallery-hanba-boss_hanba](../fx-polish/C/gallery-hanba-boss_hanba.jpg) · [gallery-kunpeng-boss_kunpeng](../fx-polish/C/gallery-kunpeng-boss_kunpeng.jpg) · [gallery-qilin-boss_qilin](../fx-polish/C/gallery-qilin-boss_qilin.jpg) · [gallery-warlord-boss_warlord](../fx-polish/C/gallery-warlord-boss_warlord.jpg) · [intro-hanba](../fx-polish/C/intro-hanba.jpg) · [intro-kunpeng](../fx-polish/C/intro-kunpeng.jpg) · [intro-qilin](../fx-polish/C/intro-qilin.jpg) · [intro-warlord](../fx-polish/C/intro-warlord.jpg) · [spawn-sigils](../fx-polish/C/spawn-sigils.jpg) · [style-pass](../fx-polish/C/style-pass.jpg) · [telegraph-look](../fx-polish/C/telegraph-look.jpg) |
| D 环境氛围 | 12 关空气粒子、火盆 / 灯笼、水面 / 流沙 / 熔岩、沙帘 | [envfx_1-1](../fx-polish/D/envfx_1-1.jpg) · [envfx_1-2](../fx-polish/D/envfx_1-2.jpg) · [envfx_1-3](../fx-polish/D/envfx_1-3.jpg) · [envfx_1-4](../fx-polish/D/envfx_1-4.jpg) · [envfx_2-1](../fx-polish/D/envfx_2-1.jpg) · [envfx_2-2](../fx-polish/D/envfx_2-2.jpg) · [envfx_2-3](../fx-polish/D/envfx_2-3.jpg) · [envfx_2-4](../fx-polish/D/envfx_2-4.jpg) · [envfx_3-1](../fx-polish/D/envfx_3-1.jpg) · [envfx_3-2](../fx-polish/D/envfx_3-2.jpg) · [envfx_3-3](../fx-polish/D/envfx_3-3.jpg) · [envfx_3-4](../fx-polish/D/envfx_3-4.jpg) |
| 风格审查 | 按 fx-style.md 自查清单逐项过 A / B 两路，亮沙 / 雪 / 熔岩三种地面改前 / 改后（S1–S12） | [S1-explosion-grounds](../fx-polish/style/S1-explosion-grounds.jpg) · [S2-explosion-sequence](../fx-polish/style/S2-explosion-sequence.jpg) · [S3-reactions](../fx-polish/style/S3-reactions.jpg) · [S4-status](../fx-polish/style/S4-status.jpg) · [S5-shield-armor](../fx-polish/style/S5-shield-armor.jpg) · [S6-fire-grounds](../fx-polish/style/S6-fire-grounds.jpg) · [S7-muzzle](../fx-polish/style/S7-muzzle.jpg) · [S8-ground-marks](../fx-polish/style/S8-ground-marks.jpg) · [S9-holes-scorch](../fx-polish/style/S9-holes-scorch.jpg) · [S10-hits](../fx-polish/style/S10-hits.jpg) · [S11-blade](../fx-polish/style/S11-blade.jpg) · [S12-spawn-death](../fx-polish/style/S12-spawn-death.jpg) |

## 截图说明

- 三章普通怪都在测试场（TestArena）截：沙地、红色刷怪台、悬浮的武器架是测试场的东西，不是本章地形（红色圆台不是预警，别和红 / 橙色预警混看）；首领在各自的真实关卡里截。
- 普通和精英同时刷在刷怪台上，冰鲸、玄冰巨蟹这类大体型的两只会互相穿插——是测试摆位，不是游戏问题。
- 第三章模型暂缓，3-3 / 3-4 场地里的方块和浅色板是白盒占位；场地柱子密，个别旁观机位被柱子挡住。
- 「命中」= 出手后玩家第一次挨的一下（4 点以上，跳伤不算）；几只怪同时出手时可能记到别的怪头上。没打中就拍收招；辅助招（施法、换位、护甲）第三格是出手后 0.7 s 的「效果」。
- 「第一人称」格：眼睛位置不动、视线临时转向出招者（拍完还原），看的是玩家正看着它时预警读不读得出来。
- 本轮（2026-10-29）在特效打磨四路 + 风格审查收口之后、用合并 ff7ad722 后的代码全部重拍：七组 gallery、boss-intro（测试场 + 四个首领关）、fx；各图标题里有截图时间。

## 问题清单

| # | 严重 | 归属 | 对象 | 问题 | 状态 | 见图 |
|---|---|---|---|---|---|---|
| 1 | 高 | 物理 / 击退 | 冰甲旋龟（第二章） | 旋壳撞飞玩家后，玩家视角一度落到地面以下：第一人称里地形消失、能看到地面网格条的背面衬在天空上，旁观机位里玩家替身也不见了；约 0.6 s 后才回到地面（这段时间测试套件没有挪玩家）。需单独复现确认是击飞把角色控制器推进了地面。 | **已修：击退本身不穿地（knockback 套件扫了 19 种冲量）；根因是角色控制器的重叠恢复——敌人根节点的角色胶囊没有刚体、算静态碰撞体，压到玩家时控制器沿最短方向把人推出去，朝下时不扫掠、直接推进地形。PlayerMotor 加防穿地托回（帧初胶囊中心到现在脚底之间隔着一层朝上的地面、且胶囊和世界几何重叠时，把人放回那层地面），压顶 / 平台 / 升降台 / 移动平台 / 台边 / 台阶 / 陡坡 / 薄桥 / 大位移都不误救；knockback、frost、arena、slice11、map-3-2、boss-kunpeng 回归通过、已重拍（图集套件里真遇到一次被挤进地下 1.6 m，已当帧托回）** | [frost-xuangui](frost-xuangui.jpg) |
| 2 | 高 | 预警看不清 | 鲲鹏（2-4） | 鲲 · 吞吸的预警是白色半透明面 + 白描边，铺在白 / 浅蓝冰面上几乎看不出，第一人称只剩一条淡白边；吐冰、扇翼狂风的前摇最后一帧在第一人称里看不到任何地面预警。冰原场景的预警建议换成高饱和冷色（青 / 品红）描边 + 填充。 | **已修：预警统一危险色（赤红，第三章品红）+ 形状外侧暗衬边，亮边 / 衬边按屏幕像素保底，体积投射画在冰面 / 水面之上，吞吸扇形在冰面上一眼读得出；吐冰落点圈、扇翼狂风冻风带改在前摇一开始就画（冻风带原来整个投影盒落到冰窟底、改前改后都没画出来，已修）；看着高处的鲲鹏时脚下的落点圈在视野下沿以外——第一人称底边加危险色光带，预警核心在哪侧哪侧亮、跟「屏幕特效」设置走（TelegraphUnderfoot）；boss-kunpeng 回归通过、已重拍（a2f9de83 / 81b03dcc / 04fcb5d8）** | [kunpeng-boss_kunpeng](kunpeng-boss_kunpeng.jpg) |
| 3 | 中 | 预警看不清 | 旱魃（1-4） | 日轮扫射、旱风、焦裂的预警都是白色细描边 + 很淡的白填充，在亮沙地上对比度低；第一人称里扇形 / 长条只看得出一条细线，离得 13 m 时更难分辨范围。 | **已修：日轮扫射 / 旱风 / 焦裂改危险色赤红 + 暗衬边，亮边至少 3.4 像素、倒计时由外往里收，亮沙上 13–20 m 外第一人称读得出范围；扇形盖过月牙泉的部分也画得出（按水体包围盒补液面）；boss-hanba 回归通过、已重拍（a2f9de83 / 04fcb5d8）** | [hanba-boss_hanba](hanba-boss_hanba.jpg) |
| 4 | 中 | 预警看不清 | 火麒麟 · 焚身（3-4） | 麟火扫象限、火云雨的前摇最后一帧在旁观机位和第一人称里都看不到地面上的象限 / 落点预警（只看得到麒麟本体），可能是预警被熔岩地纹盖住或画得太晚，需确认。 | **已修：两个原因都有——画得太晚（扫象限落地后才画、火云雨出手后才逐颗画）+ 熔岩地纹盖住 / 颜色混进熔岩。现在扫象限起飞那一刻、火云雨长啸一开始就画（落地 / 放出时重新计时），第三章危险色换电光品红，体积投射画在熔岩面之上、窄熔岩渠按熔岩体补；boss-qilin 回归通过、已重拍（a2f9de83 / 81b03dcc / 04fcb5d8）** | [qilin-boss_qilin](qilin-boss_qilin.jpg) |
| 5 | 中 | 特效缺失 | 元素曳光（通用） | fx 套件这次不合格 1 项：「Shock 开枪后没有画出曳光」——雷元素的曳光没画出来（图里雷 · 侧面那张是 18:40 旧图）；火、蚀两种曳光在侧面图里都是同样的一条细黄线，看不出元素区别，第一人称里几乎看不到曳光。 | **已修：曳光按元素换形状——火 = 橙红弹头 + 红光晕 + 沿途火星，雷 = 蓝白锯齿折线、一闪一闪 + 电弧碎纹，蚀 = 绿色长拖尾（留 0.35 s）+ 蚀液滴；下面垫一道深红 / 深蓝 / 深绿的普通混合线，亮沙上也分得开；枪口那一段加亮加粗，第一人称看得到；雷漏画是套件固定等两帧的时序问题，改成等这一发真打出去再拍（FxLines / Ballistics / FxSuite）；fx、weapons 回归通过、已重拍** | [fx-tracer](fx-tracer.jpg) |
| 6 | 中 | 可读性 | 熔心魔将（3-3） | 魔将本体是暗红黑配色，3-3 熔铸坊整体也是暗红打光，11–14 m 外只剩剪影，前摇动作（举刃、蓄冲）在第一人称里几乎读不出来；招式预警是浅米色，倒还看得见。 | **已修：读招轮廓——平时暖金边光 + 淡余烬自发光，前摇中边光转白热、自发光跳动烧亮（WarlordBrain），14 m 外第一人称可读；boss-warlord 回归通过、已重拍** | [warlord-boss_warlord](warlord-boss_warlord.jpg) |
| 7 | 中 | 可读性 | 沙魇（第一章 / 旱魃召唤物） | 本体颜色和沙地几乎一样，测试场和 1-4 鸣沙山里远处都很难发现；潜沙突袭的落点预警是淡黄细圈，在亮沙上也偏弱。伏击怪可以藏，但出招前的预警需要更醒目。 | **已修：本体沙色改为烧焦的赭暗沙、裂纹更亮、暖边光加强（EnemyVariant）；潜沙突袭的落点圈改危险色赤红 + 暗衬边 + 由外往里收的倒计时（Telegraph 统一配色，a2f9de83）；desert 回归通过、已重拍** | [desert-sand_wraith](desert-sand_wraith.jpg) [hanba-sand_wraith](hanba-sand_wraith.jpg) |
| 8 | 中 | 特效 | 三青鸟（第二章） | 冰羽扇射的冰羽是大块不透明的白色扁三角片，近看像纸片，缺少冰的透明感和发光；命中格里五片冰羽插在地上很突兀。 | **已修：冰羽改为两片带夹角的冰蓝羽面 + 羽尖冰晶亮点 + 冷光（ProjectileVisuals feather / QingniaoAI）；frost 回归通过、已重拍** | [frost-qingniao](frost-qingniao.jpg) |
| 9 | 中 | 玩法 / 关卡 | 旱魃（1-4） | boss-hanba 套件这次有两项不合格：站在月牙泉浅水里，日晒判定没认出水（在水里 False），浅水里叠层速度和空地一样（应减半）。不是图集套件引入的，顺带记录。 | **已修（测试取点）：9fe30fe3 把落脚点改到泉床上水深 > 0.15 m 处后，判定本身没问题——boss-hanba 回归通过：站在水深 0.46 m 处在水里 True、倍率 0.5，2 s 叠 2 层（空地 4 层）** | [hanba-boss_hanba](hanba-boss_hanba.jpg) |
| 10 | 低 | 特效 | 跳鼠刀兵 / 沙魇（第一章） | 交叉斩 / 交叉爪击的刀光很淡很细，出手帧在沙地上几乎看不到 X 字刀光，近战出手缺少一下明确的视觉重音。 | **已修：敌方刀光加宽 1.5 倍、垫暗月牙、刃口保持暖色、多留 25%（SlashArc hostile，跳鼠 / 沙魇 / 狌狌 / 魔将）；desert 回归通过、已重拍** | [desert-jerboa_blade](desert-jerboa_blade.jpg) [desert-sand_wraith](desert-sand_wraith.jpg) |
| 11 | 低 | 特效 | 状态外观（通用） | 五种状态主要靠整体染色区分（橙 / 紫 / 绿 / 黄 / 蓝），感电和减速在近景里几乎没有粒子（电弧、冰晶）；第一人称 15 m 外只能靠颜色分辨，减速和感电的蓝紫色容易混。 | **已修：减速改冰白 + 冰晶星芒 + 细雪，和雷元素天蓝拉开；感电频闪拉开明暗、电弧更多更亮（StatusFx）；fx 回归通过、已重拍** | [fx-status](fx-status.jpg) |
| 12 | 低 | 演出 | 鲲鹏（2-4） | 倒下演出偏短：被击杀后 1.5 s 鹏还在下坠，3.5 s 时场上已经什么都不剩（没有残骸 / 落羽 / 冰面余波），和旱魃、魔将、火麒麟的倒下演出相比收得太快。 | **已修：倒下演出 3.2 → 4.4 s，鹏 55% 砸冰面（碎冰 + 冰环 + 震屏）后趴着抽两下、鲲没顶涌冰浪，炸开后落点留 6 s 冻雾 + 霜斑（KunPengBrain）；boss-kunpeng 回归通过、已重拍** | [kunpeng-boss_kunpeng](kunpeng-boss_kunpeng.jpg) |
| 13 | 中 | 特效风格 | 鲲鹏（2-4）化形 / 冰属性爆发 | 收口审查（fx-style ③ 元素色）：鲲 → 鹏化形那一下是一大团赭黄泥色的卡通火团。原因是 B 路的卡通爆炸只有火的色阶，传冰蓝进去，火团就混成了泥色。鲲 · 吐冰的冰块落地、MatriarchNova 也是同样的调用。 | **已修：这三处改走 FX3 冷的冰爆 Fx.FrostNova（KunPengBrain / BossHazards 的 LobKind.Ice / MatriarchMoves），其余爆炸不变。boss-kunpeng、gallery-kunpeng 回归通过，已重拍（72f14d4e）** | [kunpeng-boss_kunpeng](kunpeng-boss_kunpeng.jpg) |
| 14 | 低 | 特效风格 | FX3 冰爆 / 冰河豚自爆（第二章） | 收口审查（fx-style ②④）：FX3 冰爆是一团柔边的白粉雾，再加白色冷环，冰河豚鼓气自爆、fx 套件的「冰爆」都是这样。亮沙上看是一大片白，读不出准则里「块面清楚的冰晶多面体」那种大形。FX3 写在风格准则之前，A / B / C / D 四路和风格审查都没有覆盖它。 | 未修：属于 FX3 整套的风格整改，不在收口范围内，这里只登记。改法建议：白雾换成冰蓝两段的卡通团块，冷环加粗，主形改成几块大冰晶 | [frost-ice_puffer](frost-ice_puffer.jpg) [fx-frost](fx-frost.jpg) |
| 15 | 低 | 特效风格 | 状态 · 减速（冰壳，通用） | 收口审查（fx-style ②⑦）：在没有加密的机器上补跑了 fx-style（冰壳 UV2 已经生效，冰晶不再被岛缝切直边）。但三种地面上冰壳整体还是偏浅白，大切面的明暗分得不明显，整只怪读成一层光滑的浅冰蓝。 | 未修：风格审查报告里登记过的残留小偏差（亮面朝主光时偏浅），这次确认还在。建议把暗面的冰蓝压深一档、晶格放大，让切面读得出来 | [fx-status](fx-status.jpg) |
| 16 | 低 | 测试 / 截图 | 鲲鹏（2-4）倒下 · 余韵 | 图集「余韵」这一格（倒下后 5.2 s）几乎整幅都是浅蓝白，看不到场景。旁观机位跟的是鲲沉下去的位置，镜头很可能落到了冰窟水面以下，也可能是被冻雾整个罩住了。 | 未修：先查 GalleryRecorder 的旁观机位，对象沉到水下时机位该抬到水面以上；如果是冻雾糊屏，就按 fx-style ②「雪雾偏冷白、不糊屏」收薄 | [kunpeng-boss_kunpeng](kunpeng-boss_kunpeng.jpg) |

招式表里有、这一轮没截到的招式：第二章 · 冰原 九尾狐巫 · 狐火；第二章 · 冰原 三青鸟 · 歇脚；第三章 · 火狱 炮仗傀儡 · 哑炸倒地；第三章 · 火狱 熔铜匠 · 裂锅；第三章 · 火狱 马面狱卒 · 重拳；第三章 · 火狱 变脸傩巫 · 碎面；第三章 · 火狱 火鼍 · 陆上扑咬

## 一、首领登场演出

**旱魃 · 1-4 鸣沙山月牙泉** `hanba` · 8 张 · 截于 2026-10-29 21:00

![旱魃 · 1-4 鸣沙山月牙泉](intro-hanba.jpg)

**鲲鹏 · 2-4 北冥** `kunpeng` · 8 张 · 截于 2026-10-29 21:01

![鲲鹏 · 2-4 北冥](intro-kunpeng.jpg)

**熔心魔将 · 3-3 熔铸坊** `warlord` · 8 张 · 截于 2026-10-29 21:01

![熔心魔将 · 3-3 熔铸坊](intro-warlord.jpg)

**火麒麟 · 3-4 祝融殿** `qilin` · 8 张 · 截于 2026-10-29 21:02

![火麒麟 · 3-4 祝融殿](intro-qilin.jpg)


## 二、首领招式 · 旱魃（1-4）

**旱魃** `boss_hanba` · 59 张 · 截于 2026-10-29 20:15

![旱魃](hanba-boss_hanba.jpg)

**邪飞天** `apsara` · 5 张 · 截于 2026-10-29 20:15

![邪飞天](hanba-apsara.jpg)

**沙魇** `sand_wraith` · 12 张 · 截于 2026-10-29 20:15

![沙魇](hanba-sand_wraith.jpg)

**蝎尾弩卫** `scorpion_archer` · 4 张 · 截于 2026-10-29 20:15

![蝎尾弩卫](hanba-scorpion_archer.jpg)


## 二、首领招式 · 鲲鹏（2-4）

**鲲鹏** `boss_kunpeng` · 39 张 · 截于 2026-10-29 22:11

![鲲鹏](kunpeng-boss_kunpeng.jpg)


## 二、首领招式 · 熔心魔将（3-3）

**熔心魔将** `boss_warlord` · 59 张 · 截于 2026-10-29 20:25

![熔心魔将](warlord-boss_warlord.jpg)


## 二、首领招式 · 火麒麟（3-4）

**火麒麟** `boss_qilin` · 47 张 · 截于 2026-10-29 20:27

![火麒麟](qilin-boss_qilin.jpg)

**神火飞鸦** `fire_crow` · 4 张 · 截于 2026-10-29 20:27

![神火飞鸦](qilin-fire_crow.jpg)

**炭童** `tantong` · 8 张 · 截于 2026-10-29 20:27

![炭童](qilin-tantong.jpg)


## 三、普通怪物 · 第一章 · 沙海

**邪飞天** `apsara` · 14 张 · 截于 2026-10-29 20:41

![邪飞天](desert-apsara.jpg)

**火浣鼠** `fire_rat` · 10 张 · 截于 2026-10-29 20:41

![火浣鼠](desert-fire_rat.jpg)

**跳鼠刀兵** `jerboa_blade` · 14 张 · 截于 2026-10-29 20:41

![跳鼠刀兵](desert-jerboa_blade.jpg)

**蜃楼蟾** `mirage_toad` · 13 张 · 截于 2026-10-29 20:41

![蜃楼蟾](desert-mirage_toad.jpg)

**沙魇** `sand_wraith` · 17 张 · 截于 2026-10-29 20:41

![沙魇](desert-sand_wraith.jpg)

**蝎尾弩卫** `scorpion_archer` · 17 张 · 截于 2026-10-29 20:41

![蝎尾弩卫](desert-scorpion_archer.jpg)

**三彩镇墓兽** `tomb_beast` · 15 张 · 截于 2026-10-29 20:41

![三彩镇墓兽](desert-tomb_beast.jpg)


## 三、普通怪物 · 第二章 · 冰原

**九尾狐巫** `fox_witch` · 22 张 · 截于 2026-10-29 20:44（没截到：狐火）

![九尾狐巫](frost-fox_witch.jpg)

**玄冰巨蟹** `frost_crab` · 18 张 · 截于 2026-10-29 20:44

![玄冰巨蟹](frost-frost_crab.jpg)

**夫诸** `fuzhu` · 13 张 · 截于 2026-10-29 20:44

![夫诸](frost-fuzhu.jpg)

**冰棘豪彘** `haozhi` · 13 张 · 截于 2026-10-29 20:44

![冰棘豪彘](frost-haozhi.jpg)

**冰河豚** `ice_puffer` · 12 张 · 截于 2026-10-29 20:44

![冰河豚](frost-ice_puffer.jpg)

**冰鲸** `ice_whale` · 13 张 · 截于 2026-10-29 20:44

![冰鲸](frost-ice_whale.jpg)

**冻鲛人** `jiaoren` · 17 张 · 截于 2026-10-29 20:44

![冻鲛人](frost-jiaoren.jpg)

**冰灯水母** `lantern_jelly` · 9 张 · 截于 2026-10-29 20:44

![冰灯水母](frost-lantern_jelly.jpg)

**三青鸟** `qingniao` · 14 张 · 截于 2026-10-29 20:44（没截到：歇脚）

![三青鸟](frost-qingniao.jpg)

**雪狌狌** `xingxing` · 25 张 · 截于 2026-10-29 20:44

![雪狌狌](frost-xingxing.jpg)

**冰甲旋龟** `xuangui` · 22 张 · 截于 2026-10-29 20:44

![冰甲旋龟](frost-xuangui.jpg)


## 三、普通怪物 · 第三章 · 火狱

**毕方** `bifang` · 17 张 · 截于 2026-10-29 20:49

![毕方](inferno-bifang.jpg)

**神火飞鸦** `fire_crow` · 9 张 · 截于 2026-10-29 20:49

![神火飞鸦](inferno-fire_crow.jpg)

**炮仗傀儡** `firecracker` · 14 张 · 截于 2026-10-29 20:49（没截到：哑炸倒地）

![炮仗傀儡](inferno-firecracker.jpg)

**熔铜匠** `founder` · 14 张 · 截于 2026-10-29 20:49（没截到：裂锅）

![熔铜匠](inferno-founder.jpg)

**祸斗** `huodou` · 17 张 · 截于 2026-10-29 20:49

![祸斗](inferno-huodou.jpg)

**熔炉铁牛** `iron_ox` · 16 张 · 截于 2026-10-29 20:49

![熔炉铁牛](inferno-iron_ox.jpg)

**马面狱卒** `mamian` · 17 张 · 截于 2026-10-29 20:49（没截到：重拳）

![马面狱卒](inferno-mamian.jpg)

**变脸傩巫** `nuo` · 14 张 · 截于 2026-10-29 20:49（没截到：碎面）

![变脸傩巫](inferno-nuo.jpg)

**炭童** `tantong` · 17 张 · 截于 2026-10-29 20:49

![炭童](inferno-tantong.jpg)

**炭童** `tantong_reborn` · 9 张 · 截于 2026-10-29 20:49

![炭童](inferno-tantong_reborn.jpg)

**火鼍** `tuo` · 24 张 · 截于 2026-10-29 20:49（没截到：陆上扑咬）

![火鼍](inferno-tuo.jpg)


## 四、通用战斗特效

**命中 / 暴击 / 破盾破甲** `hit` · 6 张 · 截于 2026-10-29 20:58

![命中 / 暴击 / 破盾破甲](fx-hit.jpg)

**弹着点 / 弹孔（沙 · 石 · 冰 · 金属）** `impact` · 8 张 · 截于 2026-10-29 20:58

![弹着点 / 弹孔（沙 · 石 · 冰 · 金属）](fx-impact.jpg)

**爆炸 + 焦痕 / 枪口火焰 / 雷击** `blast` · 5 张 · 截于 2026-10-29 20:58

![爆炸 + 焦痕 / 枪口火焰 / 雷击](fx-blast.jpg)

**元素曳光（火 / 雷 / 蚀）** `tracer` · 6 张 · 截于 2026-10-29 20:58

![元素曳光（火 / 雷 / 蚀）](fx-tracer.jpg)

**状态外观** `status` · 6 张 · 截于 2026-10-29 20:58

![状态外观](fx-status.jpg)

**出生法阵 + 显形 / 死亡迸散 + 溶解** `spawn` · 4 张 · 截于 2026-10-29 20:58

![出生法阵 + 显形 / 死亡迸散 + 溶解](fx-spawn.jpg)

**元素反应（熔池 / 归墟）** `reaction` · 5 张 · 截于 2026-10-29 20:58

![元素反应（熔池 / 归墟）](fx-reaction.jpg)

**FX3 冰霜专属** `frost` · 15 张 · 截于 2026-10-29 21:26

![FX3 冰霜专属](fx-frost.jpg)

**FX4 火狱专属** `inferno` · 17 张 · 截于 2026-10-29 21:26

![FX4 火狱专属](fx-inferno.jpg)
