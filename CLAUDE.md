# 协作约定（所有会话必读）

设计与架构见 [DESIGN.md](DESIGN.md)，美术管线见 `art/README.md`。回复用户一律用简体中文。

## Git：提交与推送

- **远端只用 SSH**：`git@github.com:xiaoli-byte/roguelike-FPS.git`。这台机器上 HTTPS 推送会卡在 Git Credential Manager 的登录框，不要用。
  推送前看一眼 `git remote -v`；如果变回了 https，执行 `git remote set-url origin git@github.com:xiaoli-byte/roguelike-FPS.git`。
- **直接提交到 `master` 并推送到 `origin`**，不开分支、不开 PR。
- **做完一项就提交并推送**，不要把完成的工作攒在工作区。做到一半的不提交。
- **只提交自己的改动**：同一个工作区经常有好几个会话同时在改。用 `git add <具体路径>`，不要 `git add -A` / `git add .`；
  共享文件里别人的 hunk 用 `git add -p` 排除。别人的半成品留在工作区，不要替别人提交或回退。
- **提交前先验证**：TS 改动跑 `npm run typecheck`（涉及构建时跑 `npm run build`）；Unity C# 改动跑 `python scripts/unity/csc_check.py`。
- **推送前**先 `git fetch origin`；远端有新提交时 `git pull --rebase --autostash origin master`，再推送。
- 单个文件不能超过 GitHub 的 100 MB 上限。可再生的中间产物按 `.gitignore` 留在本机，新增大体积目录先确认是否该入库。
- 提交信息沿用现有风格：`feat(scope): 简述`，scope 如 `unity`、`plateau`、`pets`、`art`。

## 工作方式

- **不要停下来请用户审查**：设计稿、四视图、模型、方案都按推荐选项直接推进，做完再汇报结果。用户原话："其他会话不要再让我做审查了，我都同意。"
