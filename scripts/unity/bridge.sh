#!/usr/bin/env bash
# 驱动 Unity 美术管线（scripts/unity/bridge.sh <命令> [超时秒数]）：
#   编辑器开着 → 写请求给编辑器里的 PipelineBridge，等它执行完；
#   编辑器没开 → 直接 -batchmode 跑同样的命令。
# 多个会话同时提交时在编辑器里排队，按提交顺序逐个执行（见 PipelineBridge.cs）。
# 命令：refresh / sync / scenes / capture / sheets / motion / all / level11（1-1 古道穿越戈壁白盒 + 验收 + 截图）/ fur（毛发画质对比截图）
set -euo pipefail
cmd="${1:-all}"
timeout="${2:-3600}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/unity"
dir="$proj/Library/SpiritfireBridge"
unity="${UNITY_EXE:-/s/Unity Hub/Editor/6000.5.4f1/Editor/Unity.exe}"

open=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" | Where-Object { \$_.CommandLine -match 'roguelike-FPS\\\\unity' -and \$_.CommandLine -notmatch 'batchmode' } | Measure-Object).Count")
if [ "$open" != "0" ]; then
  # 好几个会话共用一个编辑器：每个请求单独一个文件排队（queue/<毫秒时间戳>-<pid>-<随机数>.json），
  # 编辑器按文件名顺序一次处理一个、处理完只删自己那条。先写同目录的临时文件（不是 .json，编辑器不看）再改名，
  # 编辑器读不到半截内容，同时提交的会话也不会抢同一个临时文件。
  queue="$dir/queue"
  mkdir -p "$queue"
  id="$(date +%s%3N)-$$-$RANDOM"
  req="$queue/$id.json"
  printf '{"id":"%s","command":"%s"}' "$id" "$cmd" > "$queue/.$id.tmp"
  mv "$queue/.$id.tmp" "$req"
  # 等不下去（超时 / Ctrl-C）就撤回还没执行的请求，免得之后突然在编辑器里跑起来
  trap 'rm -f "$req"; exit 130' INT TERM
  ahead=0
  for f in "$queue"/*.json; do
    if [[ "$(basename "$f")" < "$id.json" ]]; then ahead=$((ahead + 1)); fi
  done
  if [ -f "$dir/request.json" ]; then ahead=$((ahead + 1)); fi
  echo "编辑器已打开：请求 $id 已提交给 PipelineBridge（$cmd），前面还有 $ahead 个请求排队"
  for ((i = 0; i < timeout; i += 2)); do
    if [ -f "$dir/response-$id.json" ]; then cat "$dir/response-$id.json"; exit 0; fi
    sleep 2
  done
  rm -f "$req"
  echo "超时：编辑器没有处理请求（前面的请求还没跑完？还没编译 PipelineBridge？切到 Unity 窗口一次让它刷新）" >&2
  exit 2
fi

case "$cmd" in
  all) method=Spiritfire.Art.Editor.ReviewCapture.BatchAll ;;
  sync) method=Spiritfire.Art.Editor.ArtSync.BatchSync ;;
  scenes) method=Spiritfire.Art.Editor.ReviewCapture.BatchScenes ;;
  capture) method=Spiritfire.Art.Editor.ReviewCapture.BatchCapture ;;
  sheets) method=Spiritfire.Art.Editor.AnimReviewSheet.BatchRender ;;
  motion) method=Spiritfire.Art.Editor.ShowcaseSimulator.BatchMotion ;;
  level11) method=Spiritfire.Art.Editor.Levels.Level_1_1.BatchBuild ;;
  petcompare) method=Spiritfire.Art.Editor.PetStyleCompare.BatchRun ;;
  fur) method=Spiritfire.Art.Editor.FurReview.BatchRun ;;
  playtest) echo "playtest 需要打开的编辑器（Play 模式）" >&2; exit 1 ;;
  *) echo "未知命令 $cmd" >&2; exit 1 ;;
esac
mkdir -p "$proj/Logs"
echo "编辑器未打开：-batchmode 执行 $method"
"$unity" -batchmode -projectPath "$proj" -executeMethod "$method" -logFile "$proj/Logs/bridge-$cmd.log"
