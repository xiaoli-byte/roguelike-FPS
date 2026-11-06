"""Compile replica scripts with the original Unity 2018 compiler and API references."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REPLICA = ROOT / "gunfire-reborn-replica"
UNITY_DATA = Path(os.environ.get("REPLICA_UNITY_DATA", r"F:\gunfire-reborn-replica\Tools\Unity\2018.4.36f1\Editor\Data"))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    compiler = UNITY_DATA / "Tools" / "Roslyn" / "csc.exe"
    if not compiler.exists():
        raise FileNotFoundError(compiler)
    framework = UNITY_DATA / "MonoBleedingEdge" / "lib" / "mono" / "4.7.1-api"
    assemblies = list((UNITY_DATA / "Managed" / "UnityEngine").glob("*.dll"))
    assemblies.append(UNITY_DATA / "Managed" / "UnityEditor.dll")
    extensions = UNITY_DATA / "UnityExtensions" / "Unity"
    assemblies.extend(path for path in (
        extensions / "GUISystem" / "UnityEngine.UI.dll",
        extensions / "Networking" / "UnityEngine.Networking.dll",
        extensions / "Timeline" / "Runtime" / "UnityEngine.Timeline.dll",
        extensions / "TestRunner" / "UnityEngine.TestRunner.dll",
        extensions / "UnitySpatialTracking" / "Runtime" / "UnityEngine.SpatialTracking.dll",
        extensions / "UnityGoogleAudioSpatializer" / "Runtime" / "UnityEngine.GoogleAudioSpatializer.dll",
    ) if path.exists())
    output = Path(tempfile.mkdtemp(prefix="replica_csc_2018_"))
    references = [f'-r:"{(framework / name).as_posix()}"' for name in ("mscorlib.dll", "System.dll", "System.Core.dll", "System.Xml.dll", "System.Data.dll")]
    references.extend(f'-r:"{path.as_posix()}"' for path in assemblies)

    def compile_assembly(name: str, sources: list[Path], extra_references: list[str] | None = None) -> subprocess.CompletedProcess:
        arguments = ["-nologo", "-preferreduilang:en-US", "-target:library", "-nostdlib+", "-unsafe", "-langversion:7.3",
                     "-define:UNITY_EDITOR,UNITY_STANDALONE_WIN,UNITY_2018_4_OR_NEWER,UNITY_2018_3_OR_NEWER,UNITY_2018_2_OR_NEWER,UNITY_2018_1_OR_NEWER,UNITY_2017_4_OR_NEWER,UNITY_2017_3_OR_NEWER,UNITY_2017_2_OR_NEWER,UNITY_2017_1_OR_NEWER,UNITY_5_6_OR_NEWER"]
        arguments.extend(references)
        arguments.extend(extra_references or [])
        arguments.append(f'-out:"{(output / name).as_posix()}"')
        arguments.extend(f'"{path.as_posix()}"' for path in sources)
        response_file = output / (name + ".rsp")
        response_file.write_text("\n".join(arguments), encoding="utf-8")
        return subprocess.run([str(compiler), f"@{response_file}"], cwd=REPLICA, capture_output=True, text=True, encoding="utf-8", errors="replace")

    text_mesh_sources = sorted((REPLICA / "Packages" / "com.unity.textmeshpro" / "Scripts" / "Runtime").rglob("*.cs"))
    text_mesh = compile_assembly("Unity.TextMeshPro.dll", text_mesh_sources)
    sources = sorted((REPLICA / "Assets").rglob("*.cs"))
    for relative in (
        "com.unity.postprocessing/PostProcessing/Runtime",
        "com.unity.render-pipelines.core/Runtime",
        "com.unity.render-pipelines.core/ShaderLibrary",
        "com.unity.render-pipelines.lightweight/Runtime",
    ):
        sources.extend(sorted((REPLICA / "Packages" / relative).rglob("*.cs")))
    processes = [text_mesh]
    if text_mesh.returncode == 0:
        processes.append(compile_assembly("Replica.Editor.dll", sources, [f'-r:"{(output / "Unity.TextMeshPro.dll").as_posix()}"']))
    errors = [line for process in processes for line in (process.stdout + process.stderr).splitlines() if "error CS" in line]
    report = {"status": "compiled" if all(process.returncode == 0 for process in processes) else "failed", "editor": "2018.4.36f1", "files": len(sources) + len(text_mesh_sources), "errorCount": len(errors), "errors": errors[:100]}
    (REPLICA / "script-compilation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (REPLICA / "script-compilation.log").write_text("\n".join(process.stdout + process.stderr for process in processes), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "compiled" else 1


if __name__ == "__main__":
    raise SystemExit(main())
