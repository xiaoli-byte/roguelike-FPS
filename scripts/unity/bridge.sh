#!/usr/bin/env bash
# 驱动 Unity 美术管线 / 关卡 / 测试：scripts/unity/bridge.sh [--timeout 秒] <命令> [参数…]
#   编辑器开着 → 写请求给编辑器里的 PipelineBridge，等它执行完；
#   编辑器没开 → 直接 -batchmode 跑同样的命令（playtest 除外）。
# 多个会话同时提交时在编辑器里排队，按提交顺序逐个执行（见 PipelineBridge.cs）。
# 等待超时默认 3600 s：--timeout N、环境变量 BRIDGE_TIMEOUT，或沿用旧写法把秒数放在最后（bridge.sh level11 1800、bridge.sh playtest 900）——
# 最后一个参数是纯数字就当超时，所以关卡 id、套件名、测试过滤都不要写成纯数字。
# 命令：
#   refresh / sync / scenes / capture / sheets / motion / all / pets / petcompare / fur（毛发画质对比截图）/ furbench（毛发三档帧耗时）
#   level <id>              按 [LevelBuilder] 登记生成一张关卡 + 验收 + 截图（level 1-1 = 1-1 古道穿越戈壁；旧名 level11 仍可用）
#   levels                  生成全部登记的关卡，构建设置里的关卡场景按登记顺序排
#   tests [过滤]            EditMode 测试（过滤 = 测试全名的正则，如 StatSheet）；汇总在回应的 tests 字段，明细 unity/Assets/Art/_Review/tests_report.txt
#   playtest [套件] [场景]  Play 模式冒烟测试（默认 slice11 = 1-1 切片）；场景可写 Assets/… .unity、关卡 id 或 Assets/Scenes 下的场景名
set -euo pipefail
timeout="${BRIDGE_TIMEOUT:-3600}"
pos=()
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) timeout="$2"; shift 2 ;;
    --timeout=*) timeout="${1#*=}"; shift ;;
    *) pos+=("$1"); shift ;;
  esac
done
cmd="${pos[0]:-all}"
args=("${pos[@]:1}")
if [ ${#args[@]} -gt 0 ] && [[ "${args[${#args[@]}-1]}" =~ ^[0-9]+$ ]]; then
  timeout="${args[${#args[@]}-1]}"
  args=("${args[@]:0:${#args[@]}-1}")
fi
root="$(cd "$(dirname "$0")/../.." && pwd)"
proj="$root/unity"
dir="$proj/Library/SpiritfireBridge"
unity="${UNITY_EXE:-/s/Unity Hub/Editor/6000.5.4f1/Editor/Unity.exe}"

json_str() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '"%s"' "$s"; }

open=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" | Where-Object { \$_.CommandLine -match 'roguelike-FPS\\\\unity' -and \$_.CommandLine -notmatch 'batchmode' } | Measure-Object).Count")
if [ "$open" != "0" ]; then
  # 好几个会话共用一个编辑器：每个请求单独一个文件排队（queue/<毫秒时间戳>-<pid>-<随机数>.json），
  # 编辑器按文件名顺序一次处理一个、处理完只删自己那条。先写同目录的临时文件（不是 .json，编辑器不看）再改名，
  # 编辑器读不到半截内容，同时提交的会话也不会抢同一个临时文件。
  queue="$dir/queue"
  mkdir -p "$queue"
  id="$(date +%s%3N)-$$-$RANDOM"
  req="$queue/$id.json"
  args_json=""
  for a in ${args[@]+"${args[@]}"}; do args_json="${args_json:+$args_json,}$(json_str "$a")"; done
  printf '{"id":"%s","command":%s,"args":[%s]}' "$id" "$(json_str "$cmd")" "$args_json" > "$queue/.$id.tmp"
  mv "$queue/.$id.tmp" "$req"
  # 等不下去（超时 / Ctrl-C）就撤回还没执行的请求，免得之后突然在编辑器里跑起来
  trap 'rm -f "$req"; exit 130' INT TERM
  ahead=0
  for f in "$queue"/*.json; do
    if [[ "$(basename "$f")" < "$id.json" ]]; then ahead=$((ahead + 1)); fi
  done
  if [ -f "$dir/request.json" ]; then ahead=$((ahead + 1)); fi
  echo "编辑器已打开：请求 $id 已提交给 PipelineBridge（$cmd${args[*]:+ ${args[*]}}），前面还有 $ahead 个请求排队"
  for ((i = 0; i < timeout; i += 2)); do
    if [ -f "$dir/response-$id.json" ]; then cat "$dir/response-$id.json"; exit 0; fi
    sleep 2
  done
  rm -f "$req"
  echo "超时：编辑器没有处理请求（前面的请求还没跑完？还没编译 PipelineBridge？切到 Unity 窗口一次让它刷新）" >&2
  exit 2
fi

mkdir -p "$proj/Logs"
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
  furbench) method=Spiritfire.Art.Editor.FurBench.BatchRun ;;
  level|levels)
    # 和编辑器里走同一套命令分发（PipelineBridge.BatchRun），回应写 response-batch-<命令>.json
    batch=(-bridgeCommand "$cmd")
    for a in ${args[@]+"${args[@]}"}; do batch+=(-bridgeArg "$a"); done
    rm -f "$dir/response-batch-$cmd.json"
    echo "编辑器未打开：-batchmode 执行 PipelineBridge.BatchRun（$cmd${args[*]:+ ${args[*]}}）"
    rc=0
    "$unity" -batchmode -projectPath "$proj" -executeMethod Spiritfire.Art.Editor.PipelineBridge.BatchRun "${batch[@]}" -logFile "$proj/Logs/bridge-$cmd.log" || rc=$?
    if [ -f "$dir/response-batch-$cmd.json" ]; then cat "$dir/response-batch-$cmd.json"; fi
    exit $rc ;;
  tests)
    # 编辑器没开时用 Unity 自带的命令行测试（结果是 NUnit XML，没有 tests_report.txt）；过滤同样是测试全名的正则
    filter=()
    if [ ${#args[@]} -gt 0 ]; then filter=(-testFilter "${args[0]}"); fi
    echo "编辑器未打开：-batchmode -runTests（EditMode）"
    rc=0
    "$unity" -batchmode -projectPath "$proj" -runTests -testPlatform EditMode -testResults "$proj/Logs/bridge-tests.xml" ${filter[@]+"${filter[@]}"} -logFile "$proj/Logs/bridge-tests.log" || rc=$?
    echo "结果：$proj/Logs/bridge-tests.xml（退出码 $rc：0 全部通过 / 2 有失败 / 3 运行出错）"
    exit $rc ;;
  playtest) echo "playtest 需要打开的编辑器（Play 模式）" >&2; exit 1 ;;
  *) echo "未知命令 $cmd" >&2; exit 1 ;;
esac
echo "编辑器未打开：-batchmode 执行 $method"
"$unity" -batchmode -projectPath "$proj" -executeMethod "$method" -logFile "$proj/Logs/bridge-$cmd.log"
