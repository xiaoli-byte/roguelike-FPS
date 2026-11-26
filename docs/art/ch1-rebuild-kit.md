# 第一章重建件（2026-11-22，1-1 / 1-2 场景重搭）

1-1 / 1-2 按 [level-art.md](level-art.md) 重搭场景时补的 5 件 Tripo 新模型。登记在 `art/pipeline/registry.toml` 末尾「第一章重建件」一节（`style_theme = "silkroad"`），
定义与提示词在 `art/pipeline/tripo_studio/ch1_rebuild_kit.py`。11-27 构成 / 特效那一步又补 3 件（白色覆钵塔、驼队帐篷，登记在「第一章重建件 · 补」；驿站木门框，照 1-1 出生第一眼的构图概念图做）。

## 1. 生产路线

1. 登记：`python art/pipeline/tripo_studio/ch1_rebuild_kit.py registry` 打印登记段，追加到 registry.toml。
2. 四视图：OpenAI 图像接口（`lib/openai_image.py generate()`，`gpt-image-2.6-sunburst`，2048×1152，quality high，一张 25–40 秒）。
   - `ch1_rebuild_kit.py concept <ID> --round N [--extra "..."]`：调用前把 `art/pipeline/.env` 的 `OPENAI_API_KEY` 强制写进 `os.environ`（系统变量里有一把没额度的旧 key），原图和调用记录（用量、请求号）落在 `tripo_studio/sheets_raw/<ID>_r<N>.png/.json`，实际提示词在 `tripo_studio/prompts/<ID>_r<N>.txt`。
   - 提示词：一行四视图（前 / 左 / 后 / 右）、纯白底、中性白光只画固有色（不烘明暗 / AO）、厚实简化大形、第一章配色，< 2500 字。
   - 登记：`register_sheet.py` 写死了 Tripo 图片页的出处，这批用同样逻辑、但把 OpenAI 调用记录写进 `asset.json` 的脚本登记（会话临时目录 `reg_openai.py`，逻辑与 register_sheet.py 相同），审核人 `Claude AI visual review`（用户授权免审）。
   - `crop_inputs.py <ID>` → `tripo_studio/inputs/<ID>/{front,left,back,right}.png`（1024² 透明底，统一比例）。
3. Tripo Studio 多视图智能网格 P2.0 → 纹理生成（去光、4K）→ 导出 GLB 4k → `wait_dl.py` → `archive.py`。
4. `run_pipe.py <ID>`（import → build → validate → review）→ `texture_clean.py hp <ID> --preview` 量紫偏 → `tone_match.py measure <ID>` 量彩度 → 必要时 `tone_match.py apply <ID> --factor … --run`（见第 5 节）→ `ap.sh <ID> "<备注>"` 发布。Unity 已冻结，不跑 `unity_export.py` / `bridge.sh`。

## 2. 资产表

发布件在 `public/assets/props/<ID>.glb`，尺寸取 `public/assets/manifest.json` 的 bounds（X 宽 × Y 高 × Z 深，m，脚底 y = 0、轴心居中）。
构建按登记尺寸等比适配、先顶到上限的那一轴说了算，所以有几件比登记的小；「摆放」一栏是想回到登记尺寸时场景里该乘的等比缩放。

| ID | 中文 / 用途 | 登记 W×H×D | 面数（目标 → 实得） | 发布 X×Y×Z | 摆放 | 版本 |
|---|---|---|---|---|---|---|
| SM_Tripo_DesertPosthouseGate | 驿站残门（1-1 出生点前门框） | 9.8 × 5.5 × 3.2 | 15000 → 14970 | 8.96 × 4.87 × 3.58 | ×1.13 → 10.1 × 5.5 × 4.05（门洞约 4.3 m） | v002 |
| SM_Tripo_DesertLowRockA | 风蚀卧石·长（半身掩体） | 3.6 × 1.0 × 1.9 | 6000 → 5870 | 3.65 × 1.00 × 1.89 | ×1 | v002 |
| SM_Tripo_DesertLowRockB | 风蚀卧石·块（半身掩体） | 2.2 × 1.2 × 1.8 | 6000 → 6107 | 1.78 × 1.20 × 1.59 | ×1（高度已是 1.2 m 掩体高；要 2.2 m 宽得 ×1.24，高会到 1.5 m） | v002 |
| SM_Tripo_DesertCamelSkeleton | 半埋驼骨（近景叙事件） | 3.2 × 1.0 × 1.6 | 8000 → 8786 | 2.70 × 0.99 × 1.79 | ×1；要 3.2 m 长 ×1.19 | v002 |
| SM_Tripo_DesertDeadPoplar | 胡杨枯木（1-1 干河床两岸） | 4.5 × 5.5 × 4.0 | 12000 → 12153 | 4.11 × 5.50 × 4.12 | ×1 | v002 |
| SM_Tripo_DesertWhiteStupa | 白色覆钵塔（1-2 ③ 塔尖广场地标，立在 10 m 塔座上） | 12.2 × 19.8 × 12.2 | 16000 → 15356 | 13.66 × 19.07 × 12.62 | ×1.04 → 19.8 m 高；X 含两侧积沙，塔座顶面要留 ≥ 14 m | v002 |
| SM_Tripo_DesertCaravanTent | 驼队帐篷（1-1 ④ 营地，全身掩体） | 5.4 × 2.8 × 3.4 | 9000 → 8354 | 5.18 × 2.80 × 3.81 | ×1 | v002 |
| SM_Tripo_DesertTimberGate | 驿站木门框（1-1 出生点门框，褪色朱红） | 9.4 × 6.8 × 2.8 | 14000 → 13617 | 9.16 × 6.80 × 3.02 | ×1 | v002 |

八件都是 v002：v001 是 Tripo 原贴图，v002 只换了调过彩度的底色（几何、UV、法线、ORM 不变，见第 5 节）。

## 3. 四视图

| 件 | 采用 | 轮次 | 说明 |
|---|---|---|---|
| PosthouseGate | r3 | 3 | r1 / r2 门洞只有约 3.5 m（按 5.5 m 总高折算）；r3 把高墩写成 1.8 m 宽、门洞「大于两倍墩宽、等于高墩高度的四分之三」，门洞约 4.3 m。登记尺寸按画出的比例改成 9.8 × 5.5 × 3.2（前视 1.83、背视 1.93、侧视 0.6 含断梁和积沙） |
| LowRockA | r1 | 1 | 钝头在前视左、尾巴在右；侧视宽高比 1.9–2.0，登记深度改成 1.9 m |
| LowRockB | r2 | 2 | r1 腰收得太细（帽檐从 0.55 m 起，半身掩体底下全透）；r2 加「腰只比帽窄一点（约 75%）、帽占上面三分之二、条带淡」 |
| CamelSkeleton | r1 | 1 | 骨架画成伏卧（脊椎在上、肋骨两侧下弯），读得清、骨头够粗，保留 |
| DeadPoplar | r1 | 1 | 画出的背视不是前视的镜像（剪影 IoU 0.79 / 镜像 0.77），四个方向各画了一棵树；背视改用前视镜像，左 / 右保留 |

## 4. Tripo 任务与积分

2026-11-27 00:24–00:59（北京时间），Claude in Chrome 里已登录的 Tripo Studio（界面英文）。设置八件相同：Smart Mesh（智能网格）→ 多视图（Front = front，Left / Right / Back = left / right / back），AI 模型 **P2.0**（下拉里只有 P2.0 和 P1.0 - Fast），拓扑三角面，生成数量 1；纹理用左侧 Texture 模块：Remove Lighting（去光）开、4K。导出 GLB、贴图 4k，文件名 = 资产 ID。
任务地址都是 `https://studio.tripo3d.ai/workspace/generate/<任务>`。

| 件 | 任务 | 面数 | 积分（网格 + 纹理） |
|---|---|---|---|
| CamelSkeleton | `1189f48a-509a-45b0-9c3a-8f988e48a8f6` | 8786 | 100 + 20 |
| DeadPoplar | `946940e6-4e5d-413e-9e66-fd408f113a22` | 12153 | 100 + 20 |
| LowRockA | `7c4d211b-af25-4b52-a383-d0b37627f9af` | 5870 | 100 + 20 |
| LowRockB | `e6c19954-c0dc-4a66-956e-76af4f862354` | 6107 | 100 + 20 |
| PosthouseGate | `9c87c50e-7f9a-470a-9ae8-7cf1e5093acf` | 14970 | 100 + 20 |
| WhiteStupa | `b9058d92-64a2-41d5-8a91-348afbe1e626` | 15356 | 100 + 20 |
| CaravanTent | `de244b9c-bcb6-4bcd-8b20-b6a50b571153` | 8354 | 100 + 20 |
| TimberGate | `99f15fea-410f-4c96-b5d2-69b3d1eacab5` | 13617 | 100 + 20 |

合计 **960 积分**，每件一次成形、没有重生成。导出 GLB 4k 不扣积分（导出前后余额相同）。
4K + 去光的纹理生成现在是 **20** 积分（`archive.py` 写死记 30，这批的 inbox 收据已改成 20）。
账号余额 25200 → 23880（−1320）：多出的 360（用量记录里 00:30:29、00:51:01 和 00:53–00:54 之间各一次 Multiview to Model，00:31–00:33、00:52:32、01:00:15 各一次 Texture Generation）不是这批的，资产列表里也没有对应件，应是同账号的别的会话。

流程备忘：
- 槽位用 `file_upload` 直接传给四个 file input（Front / Left / Right / Back 顺序），换下一件前点四个垃圾桶清空，清完 file input 才会重新出现。八件没有一次静默失败，生成前都缩放核对过四槽有图。
- Topology 弹窗的面数会被记住；Remove Lighting / 4K 这次也保持住了（第一件手动开过，后面七件都默认开着）。
- 排队：一件网格出来就在资产列表点它 → 左侧 Texture 生成纹理 → 回 Model 清槽排下一件；导出一次一件，`wait_dl.py` 等落地再 Escape。点资产列表后列表会重排（正在生成的件插到最前），点之前看一眼地址栏 / 缩略图。
- 一个标签页跑完 8 次网格 + 8 次纹理 + 8 次导出，没卡（中途窗口尺寸变过一次，坐标要重新截图取）。

## 5. 审核中的修正

**彩度（八件都改了）。** Tripo 去光 4K 纹理和四视图的色相、明度大体一致，但彩度普遍高出一截（底色 vs 概念正视的 Lab 彩度中位数）：

| 件 | 底色 C50 | 概念 C50 | 比 | 处理 |
|---|---|---|---|---|
| CamelSkeleton | 42.8 | 28.9 | 0.68 | ×0.7 |
| DeadPoplar | 25.3 | 14.8 | 0.59 | ×0.7 |
| LowRockA | 73.0 | 49.6 | 0.68 | ×0.7 |
| LowRockB | 79.9 | 53.3 | 0.67 | ×0.7 |
| PosthouseGate | 63.6 | 45.2 | 0.71 | ×0.7 |
| WhiteStupa | 37.3 | 18.1 | 0.49 | 按分位数匹配（中位 ×0.5，相轮 / 朱带 ×0.8） |
| CaravanTent | 35.8 | 28.6 | 0.80 | ×0.8 |
| TimberGate | 57.0 | 38.2 | 0.67 | ×0.7 |

不改的样子：沙丘是橙黄颜料色、两块砂岩橙得像熔岩、夯土门墩明黄、白塔的灰泥成了奶油黄、木门框是新漆的正红而不是褪色朱红。`texture_clean.py` 量出来紫偏都是 0，它把饱和橙当熔岩色键原样留着，管不到这个。
用 `tone_match.py` 只缩 Lab a*/b*：原分辨率、不平滑、几何和 UV 不动，写成 `_tripo_inbox/<UTC>_<ID>_tone.glb`（收据记 `tone_match` 参数、`retexture_of_highpoly` 指回 v001），重新 import → build → validate → review 成 v002 再发布。
×0.7 比按中位数完全对齐略留一点彩度（胡杨按 0.59 会灰成一片）；白塔浅灰泥和铜相轮差得不一样多，均匀缩放要么灰泥还黄、要么相轮发灰，所以按分位数匹配。

**逐件：**
- TimberGate：按要求核过网格——两柱之间门洞通透、双层门楣之间的方木块彼此留空（网格里正面看是 4 块）、两只云纹雀替、左端旗杆、右柱内侧的流苏绳和两只流苏是单独垂下的件，没糊到柱子上；石础 + 积沙。剪影 IoU 0.876，尺寸 9.16 × 6.80 × 3.02 按高度适配、和登记吻合。
- PosthouseGate：形对（高墩、矮墩、斜搭断梁、断头垂落插沙、门洞约两倍墩宽），但剪影 IoU 0.673（正视 0.59）有一条警告——模型的墩比概念厚、积沙更宽，深度先顶到登记上限 3.68 m，等比下来只有 4.87 m 高；门洞净高按比例约 3.2–3.8 m，人走得过。没重生成（形没坏，再出一次大概率一样），场景里按 ×1.13 放回 5.5 m。
- WhiteStupa：方形两级台基、鼓座朱带、钟形覆钵、方座、约十三层相轮、宝盖、刹顶，四向一致；宽 13.66 m（含两侧积沙），比登记 12.2 宽。
- CaravanTent：左端叉杆立着、右端杆断一角塌、背面积沙、顶上靛蓝条带都在；正面门洞是智能网格做出的浅凹面（不是真的空腔），门帘系开、里面是比篷布略深的褐色，读得出门洞但不算黑。作全身掩体不影响，要更像敞开的门可以在门洞里补一块暗色贴花或靠场景阴影。
- LowRockB：腰约帽宽 75%，帽下不透，是可用的半身掩体；比登记窄（1.78 m 宽）。
- CamelSkeleton：长 2.70 m（登记 3.2），Tripo 把它做得短而厚，按高度适配。
- DeadPoplar、LowRockA：尺寸、形状都和登记吻合。
