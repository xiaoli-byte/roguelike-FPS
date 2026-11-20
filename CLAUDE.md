# 协作约定（所有会话必读）

设计与架构见 [DESIGN.md](DESIGN.md)，美术管线见 `art/README.md`。回复用户一律用简体中文。

## 方向：全部迁回 Three.js（2026-11-15）

- 用户确认 Unity 版停止开发，游戏整体迁回网页版（Three.js + TypeScript + Vite，源码在 `src/`）。原话：「可以不落到unity里，我希望全部迁移到threeJS」「是，全部迁回」。
- **新的玩法、场景、特效、美术工作一律落在网页版**，不要再往 `unity/` 里加新功能；动手前先确认落点是 `src/`。
- 下面 Git 约定里和 Unity 有关的条目（`csc_check.py`、`dlp-unity-fix.mjs`）只在确实动到 `unity/` 时适用；网页版改动跑 `npm run typecheck`。

## Git：提交与推送

- **远端只用 SSH**：`git@github.com:xiaoli-byte/roguelike-FPS.git`。这台机器上 HTTPS 推送会卡在 Git Credential Manager 的登录框，不要用。
  推送前看一眼 `git remote -v`；如果变回了 https，执行 `git remote set-url origin git@github.com:xiaoli-byte/roguelike-FPS.git`。
- **直接提交到 `master` 并推送到 `origin`**，不开分支、不开 PR。
- **做完一项就提交并推送**，不要把完成的工作攒在工作区。做到一半的不提交。
- **只提交自己的改动**：同一个工作区经常有好几个会话同时在改。用 `git add <具体路径>`，不要 `git add -A` / `git add .`；
  共享文件里别人的 hunk 用 `git add -p` 排除。别人的半成品留在工作区，不要替别人提交或回退。
- **提交前先验证**：TS 改动跑 `npm run typecheck`（涉及构建时跑 `npm run build`）；Unity C# 改动跑 `python scripts/unity/csc_check.py`。
- **推送前**先 `git fetch origin`；远端有新提交时 `git pull --rebase --autostash origin master`，再推送。
- **拉取后**如果 `unity/` 有更新，跑 `node scripts/unity/dlp-unity-fix.mjs`：本机 DLP 会把 Git 写出的 `.cs` / `.json` 等存成密文，Unity 读不了（`%TSD-Header-###%`）。`--check` 只检查。
- 单个文件不能超过 GitHub 的 100 MB 上限。可再生的中间产物按 `.gitignore` 留在本机，新增大体积目录先确认是否该入库。
- 提交信息沿用现有风格：`feat(scope): 简述`，scope 如 `unity`、`plateau`、`pets`、`art`。

## 工作方式

- **不要停下来请用户审查**：设计稿、四视图、模型、方案都按推荐选项直接推进，做完再汇报结果。用户原话："其他会话不要再让我做审查了，我都同意。"
- **场景搭建 / 地编按 [docs/art/level-art.md](docs/art/level-art.md) 做**：氛围、打光、光影、构图、特效和几何同等重要，交付前过一遍文末的验收清单（2026-11-21 用户确认）。
