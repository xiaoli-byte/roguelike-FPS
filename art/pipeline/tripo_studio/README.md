# Tripo Studio 路线辅助脚本

2026-11-02..04 第三章 v2 套件（A3）在会话临时目录里写的脚本，11-07 收进仓库；路径改成相对仓库根，审核备注不再写死日期。
四视图走 Tripo Studio 图片页（GPT Image 2.5，免费额度），网格走 Tripo 多视图智能网格。整条路线见 `docs/art/ch3-kit.md` 第 1 节、`docs/art/zhurong-kit-31.md`。

| 脚本 | 做什么 |
|---|---|
| `zhurong31_kit.py` | 祝融 3-1 套件定义：`prompts` 写 `prompts/<ID>.txt`，`registry` 打印 registry.toml 登记段 |
| `make_prompts.py` | 第三章 v2（A3）那一批的提示词（历史，留档） |
| `unpack.py <bundle>` | 页面里 `fetch` 打包下载的多张原图（4 字节头长 + JSON 头 + 数据）拆到 `sheets_raw/` |
| `figs.py` | 抠图：四边洪泛 + 封闭在物体里的背景色空隙；按一行 / 2×2 网格切出四个视图 |
| `grid2row.py` | 2×2 网格转一行 |
| `register_sheet.py <ID> <图> --layout row\|grid --prompt <txt> --variant N [--same-front] [--swap-sides] [--flip back,left,right] --batch "<日期 批次>"` | 登记为资产的当前概念并通过（`tripo_assets.register`）；比例超出登记尺寸会被拒，按画出的比例改 `reference_dimensions`，不压扁 |
| `crop_inputs.py <ID>` | 当前概念的四个视图 → `inputs/<ID>/{front,left,back,right}.png`（1024² 透明底，统一比例），上传 Tripo 用 |
| `wait_dl.py <前缀>` | 等下载目录里的文件出现且大小稳定（下载期间离开页面会取消下载） |
| `archive.py <ID> <task-uuid> <面数>` | `Downloads/<ID>.glb` → `art/source/_tripo_inbox/<UTC>_<ID>.glb` + 收据（sha256、实得面数；纹理默认记「去光」，`TRIPO_DELIGHT=0` 关） |
| `run_pipe.py <ID>` | import → build → validate → review，日志在 `logs/` |
| `ap.sh <ID> "<备注>"` | 审核通过（Claude AI visual review，用户授权免审）+ 发布 |
| `codex_concept.py <ID>` | 用 Codex 桌面版自带的 codex-cli 跑 `tripo_assets.py concept`（11-07 试过：ChatGPT 账号不再支持 gpt-6.1-sol，`gpt-6-luna` 不出图） |
| `wait_sync.py` | 等 Unity bridge 队列清空后跑 `bridge.sh sync` |

`inputs/ logs/ sheets_raw/ prompts/` 和预览 jpg 不入库（`.gitignore`）。下载目录默认 `S:\文档\Downloads`，用 `TRIPO_DOWNLOADS` 改。
