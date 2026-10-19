#!/usr/bin/env bash
# 驱动 Unity 美术管线（scripts/unity/bridge.sh <命令> [超时秒数]）：
#   编辑器开着 → 写请求给编辑器里的 PipelineBridge，等它执行完；
#   编辑器没开 → 直接 -batchmode 跑同样的命令。
# 命令：refresh / sync / scenes / capture / sheets / motion / all / level11（1-1 古道穿越戈壁白盒 + 验收 + 截图）
set -euo pipefail
cmd="${1:-all}"
timeout="${2:-3600}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/unity"
dir="$proj/Library/SpiritfireBridge"
unity="${UNITY_EXE:-/s/Unity Hub/Editor/6000.5.4f1/Editor/Unity.exe}"

open=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" | Where-Object { \$_.CommandLine -match 'roguelike-FPS\\\\unity' -and \$_.CommandLine -notmatch 'batchmode' } | Measure-Object).Count")
if [ "$open" != "0" ]; then
  id="$(date +%s)$RANDOM"
  mkdir -p "$dir"
  printf '{"id":"%s","command":"%s"}' "$id" "$cmd" > "$dir/request.json.tmp"
  mv "$dir/request.json.tmp" "$dir/request.json"
  echo "编辑器已打开：请求 $id 已提交给 PipelineBridge（$cmd）"
  for ((i = 0; i < timeout; i += 2)); do
    if [ -f "$dir/response-$id.json" ]; then cat "$dir/response-$id.json"; exit 0; fi
    sleep 2
  done
  echo "超时：编辑器没有处理请求（还没编译 PipelineBridge？切到 Unity 窗口一次让它刷新）" >&2
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
  playtest) echo "playtest 需要打开的编辑器（Play 模式）" >&2; exit 1 ;;
  *) echo "未知命令 $cmd" >&2; exit 1 ;;
esac
mkdir -p "$proj/Logs"
echo "编辑器未打开：-batchmode 执行 $method"
"$unity" -batchmode -projectPath "$proj" -executeMethod "$method" -logFile "$proj/Logs/bridge-$cmd.log"
