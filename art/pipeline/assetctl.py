"""灵火破晓 · 美术资产管线命令行（规范见 art/README.md）。

    python art/pipeline/assetctl.py list
    python art/pipeline/assetctl.py status   <资产ID>
    python art/pipeline/assetctl.py serve                         # 白模接收端（游戏 ?debug 控制台导出）
    python art/pipeline/assetctl.py blockout <资产ID>              # 重新登记 _tmp/incoming 里的白模
    python art/pipeline/assetctl.py concept  <资产ID> [--model ...] [--dry-run]
    python art/pipeline/assetctl.py matid    <资产ID>              # 可选：材质分区（金属遮罩）
    python art/pipeline/assetctl.py emid     <资产ID>              # 可选：发光分区（自发光遮罩，运行时按实例着色）
    python art/pipeline/assetctl.py approve  <资产ID> <concept|review> --by <审核人> [--note ...]
    python art/pipeline/assetctl.py reject   <资产ID> <concept|review> --by <审核人> --note <原因>
    python art/pipeline/assetctl.py highpoly <资产ID> [--seed N] [--mode single|multiview]
    python art/pipeline/assetctl.py build    <资产ID>              # 对齐 / 减面 / UV / 烘焙 / 蒙皮 / LOD / 导出
    python art/pipeline/assetctl.py validate <资产ID>
    python art/pipeline/assetctl.py review   <资产ID>              # 渲染审核图
    python art/pipeline/assetctl.py publish  <资产ID>              # 发布到 public/assets 并更新清单
    python art/pipeline/assetctl.py run      <资产ID> --from highpoly [--to publish]
    python art/pipeline/assetctl.py batch    <阶段|run> (--assets A B … | --class <规格档> | --all) [--from build --to review]

每个阶段只读上游的「当前版本」；concept 与 review 是人工闸门，未批准时下游拒绝运行。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.config import CFG, PipelineError  # noqa: E402
from lib.state import ORDER, AssetState  # noqa: E402


def cmd_list(_a) -> None:
    for aid in CFG.all_assets():
        spec = CFG.asset(aid)
        st = AssetState(spec)
        done = [s for s in ORDER if st.current(s)]
        print(f"{aid:28} {spec.display:8} {spec.cls:15} 进度：{done[-1] if done else '未开始'}")


def cmd_status(a) -> None:
    spec = CFG.asset(a.asset)
    print(f"{spec.id}（{spec.display}）  {spec.kind} / {spec.cls}  LOD 面数 {spec.lod_tris}  贴图 {spec.texture}²")
    print("\n".join(AssetState(spec).summary()))


def cmd_review_verdict(a, verdict: str) -> None:
    st = AssetState(CFG.asset(a.asset))
    v = st.set_review(a.stage, verdict, a.by, a.note or "")
    print(f"{a.asset} {a.stage} v{v['version']:03d} → {verdict}（{a.by}）")


def stage_runner(name: str):
    def go(a) -> None:
        from importlib import import_module
        mod = import_module(f"stages.{name}")
        mod.run(CFG.asset(a.asset), a)
    return go


def cmd_batch(a) -> None:
    """对多个资产执行同一个阶段（或一段主链），单个失败不影响其余，最后汇总。"""
    from importlib import import_module
    ids = a.assets or [i for i in CFG.all_assets() if a.all or CFG.asset(i).cls == a.cls]
    if not ids:
        raise PipelineError("没有选中资产：用 --assets、--class 或 --all")
    results = []
    for aid in ids:
        print(f"\n━━━━ {aid} ━━━━", flush=True)
        try:
            spec = CFG.asset(aid)
            if a.stage == "run":
                cmd_run(argparse.Namespace(asset=aid, start=a.start, end=a.end, seed=None))
            else:
                import_module(f"stages.{a.stage}").run(spec, argparse.Namespace(
                    asset=aid, model=None, quality=None, note="", dry_run=False, seed=None))
            results.append((aid, "✔", ""))
        except PipelineError as e:
            results.append((aid, "✘", str(e).splitlines()[0]))
            print(f"✘ {e}", flush=True)
    print("\n批处理汇总：")
    for aid, mark, msg in results:
        print(f"  {mark} {aid:30} {msg}")
    if any(m == "✘" for _, m, _ in results):
        raise PipelineError(f"{sum(m == '✘' for _, m, _ in results)} 个资产失败")


def cmd_run(a) -> None:
    from importlib import import_module
    chain = ["highpoly", "build", "validate", "review", "publish"]
    if a.start not in chain or a.end not in chain:
        raise PipelineError(f"--from / --to 只能是 {chain}")
    for name in chain[chain.index(a.start): chain.index(a.end) + 1]:
        print(f"\n━━ {name} ━━", flush=True)
        import_module(f"stages.{name}").run(CFG.asset(a.asset), a)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="美术资产管线")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list").set_defaults(fn=cmd_list)
    p = sub.add_parser("status")
    p.add_argument("asset")
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser("serve")
    p.set_defaults(fn=lambda a: __import__("stages.blockout", fromlist=["serve"]).serve())
    p = sub.add_parser("blockout")
    p.add_argument("asset")
    p.set_defaults(fn=lambda a: __import__("stages.blockout", fromlist=["ingest"]).ingest(a.asset))

    p = sub.add_parser("concept")
    p.add_argument("asset")
    p.add_argument("--model", help="覆盖 pipeline.toml 的 [concept].model")
    p.add_argument("--quality")
    p.add_argument("--note", default="", help="本次额外的修改要求（追加到提示词末尾）")
    p.add_argument("--dry-run", action="store_true", help="只打印提示词，不调用接口")
    p.set_defaults(fn=stage_runner("concept"))

    p = sub.add_parser("matid", help="材质分区：从当前概念生成金属遮罩（附属阶段，可选）")
    p.add_argument("asset")
    p.add_argument("--model")
    p.set_defaults(fn=stage_runner("matid"))

    p = sub.add_parser("emid", help="发光分区：从当前概念生成自发光遮罩（附属阶段，可选；运行时按实例着色）")
    p.add_argument("asset")
    p.add_argument("--model")
    p.set_defaults(fn=stage_runner("emid"))

    p = sub.add_parser("concept-register", help="对当前概念版本重新配准（不调用接口）")
    p.add_argument("asset")
    p.set_defaults(fn=lambda a: __import__("stages.concept", fromlist=["reregister"]).reregister(CFG.asset(a.asset)))

    for verdict in ("approve", "reject"):
        p = sub.add_parser(verdict)
        p.add_argument("asset")
        p.add_argument("stage", choices=["concept", "review"])
        p.add_argument("--by", required=True)
        p.add_argument("--note")
        p.set_defaults(fn=lambda a, v=verdict: cmd_review_verdict(a, "approved" if v == "approve" else "rejected"))

    p = sub.add_parser("highpoly")
    p.add_argument("asset")
    p.add_argument("--seed", type=int)
    p.add_argument("--mode", choices=["single", "multiview"], help="默认取登记表 highpoly_mode，再缺省为 single")
    p.set_defaults(fn=stage_runner("highpoly"))

    for name in ("build", "validate", "review", "publish"):
        p = sub.add_parser(name)
        p.add_argument("asset")
        p.set_defaults(fn=stage_runner(name))

    p = sub.add_parser("batch", help="对多个资产执行同一阶段，失败不中断，最后汇总")
    p.add_argument("stage", choices=["concept", "matid", "emid", "highpoly", "build", "validate", "review", "publish", "run"])
    p.add_argument("--assets", nargs="+")
    p.add_argument("--class", dest="cls")
    p.add_argument("--all", action="store_true")
    p.add_argument("--from", dest="start", default="highpoly")
    p.add_argument("--to", dest="end", default="review")
    p.set_defaults(fn=cmd_batch)

    p = sub.add_parser("run")
    p.add_argument("asset")
    p.add_argument("--from", dest="start", default="highpoly")
    p.add_argument("--to", dest="end", default="publish")
    p.add_argument("--seed", type=int)
    p.set_defaults(fn=cmd_run)

    a = ap.parse_args()
    try:
        a.fn(a)
    except PipelineError as e:
        print(f"✘ {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
