"""在编辑器外检查 Unity C# 能不能编译（编辑器在 Play 模式、桥接命令被拒时用）。

用 Unity 上次生成的 Library/Bee/artifacts/<dag>/<程序集>.rsp（引用、宏、分析器都在里面），把源文件列表换成当前磁盘上的文件，
输出写到临时目录，用编辑器自带的 Roslyn 编译。依赖它的程序集会引用这里刚编出来的 dll，而不是 Library 里的旧版。

    python scripts/unity/csc_check.py                 # 依次检查 Art.Runtime → Game → Art.Editor → Game.Tests
    python scripts/unity/csc_check.py Spiritfire.Game

在 git worktree 里也能用：worktree 没有 Library，就借主工作区 unity/Library 里的 .rsp 和引用，源文件仍取当前 worktree。
EditMode 测试程序集（Spiritfire.Game.Tests）是新加的：编辑器还没编译过它、Library 里没有它的 .rsp 时只提示跳过，不算失败。

退出码 0 = 全部编译通过；有错误时打印 error CS… 行。
"""
import glob
import os
import subprocess
import sys
import tempfile

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "unity"))
UNITY = os.environ.get("UNITY_EDITOR_DATA", r"S:\Unity Hub\Editor\6000.5.4f1\Editor\Data")
# 程序集 → 源文件 glob（与各自 asmdef 所在目录一致）
ASSEMBLIES = {
    "Spiritfire.Art.Runtime": "Assets/Pipeline/Runtime/**/*.cs",
    "Spiritfire.Game": "Assets/Game/Scripts/**/*.cs",
    "Spiritfire.Art.Editor": "Assets/Pipeline/Editor/**/*.cs",
    "Spiritfire.Game.Tests": "Assets/Game/Tests/**/*.cs",
}
# 找不到 .rsp 时跳过而不是报错的程序集（编辑器第一次导入 asmdef 之前没有 .rsp）
OPTIONAL = {"Spiritfire.Game.Tests"}


def library_root() -> str:
    """有 Library 的 unity 目录：本工作区自己的，没有就找主工作区的（worktree 的 git common dir 在主工作区 .git）"""
    if os.path.isdir(os.path.join(ROOT, "Library", "Bee")):
        return ROOT
    r = subprocess.run(["git", "-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                       capture_output=True, text=True)
    main = os.path.join(os.path.dirname(r.stdout.strip()), "unity") if r.returncode == 0 else ""
    if main and os.path.isdir(os.path.join(main, "Library", "Bee")):
        return os.path.normpath(main)
    sys.exit(f"{ROOT} 和主工作区都没有 Library/Bee：先让编辑器正常编译一次")


def find_rsp(name: str, optional: bool = False):
    hits = glob.glob(os.path.join(library_root(), "Library", "Bee", "artifacts", "*", f"{name}.rsp"))
    if not hits:
        if optional:
            return None
        sys.exit(f"找不到 {name}.rsp：先让编辑器正常编译一次")
    return max(hits, key=os.path.getmtime)


def csc() -> list[str]:
    dotnet = os.path.join(UNITY, "NetCoreRuntime", "dotnet.exe")
    dlls = glob.glob(os.path.join(UNITY, "DotNetSdk", "sdk", "*", "Roslyn", "bincore", "csc.dll"))
    if not os.path.exists(dotnet) or not dlls:
        sys.exit(f"在 {UNITY} 下找不到 dotnet / csc.dll（可用环境变量 UNITY_EDITOR_DATA 指定 Editor/Data）")
    return [dotnet, dlls[0]]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    names = sys.argv[1:] or list(ASSEMBLIES)
    out_dir = tempfile.mkdtemp(prefix="csc_check_")
    built: dict[str, str] = {}
    failed = False
    # .rsp 里的引用是相对 Library 所在目录的路径；源文件用当前工作区的绝对路径
    os.chdir(library_root())
    for name in names:
        rsp_in = find_rsp(name, name in OPTIONAL)
        if rsp_in is None:
            print(f"{name}: 跳过（Library 里还没有 {name}.rsp：编辑器导入这个程序集、编译一次之后才能检查）")
            continue
        lines = open(rsp_in, encoding="utf-8").read().splitlines()
        keep = []
        for line in lines:
            if line.startswith('"Assets') or line.startswith("-out:") or line.startswith("-refout:"):
                continue
            # 引用本次刚编过的程序集
            for dep, path in built.items():
                if line.startswith("-r:") and line.rstrip('"').endswith(f"{dep}.ref.dll"):
                    line = f'-r:"{path}"'
            keep.append(line)
        dll = os.path.join(out_dir, f"{name}.dll")
        keep.append(f'-out:"{dll}"')
        files = sorted(glob.glob(os.path.join(ROOT, ASSEMBLIES.get(name, "")), recursive=True))
        keep += ['"' + f.replace(os.sep, "/") + '"' for f in files]
        rsp = os.path.join(out_dir, f"{name}.rsp")
        with open(rsp, "w", encoding="utf-8") as fh:
            fh.write("\n".join(keep) + "\n")
        r = subprocess.run(csc() + ["-nologo", f"@{rsp}"], capture_output=True, text=True, encoding="utf-8", errors="replace")
        errors = [l for l in (r.stdout + r.stderr).splitlines() if "error CS" in l]
        print(f"{name}: {len(files)} 个文件，{'通过' if r.returncode == 0 else f'{len(errors)} 个错误'}")
        for e in errors[:30]:
            print("  " + e[e.find("Assets"):] if "Assets" in e else "  " + e)
        if r.returncode != 0:
            failed = True
        built[name] = dll
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
