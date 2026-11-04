"""Extract indexed DXBC programs and shader metadata from a Gunfire AssetBundle."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

import UnityPy
from UnityPy.export.ShaderConverter import ShaderProgram
from UnityPy.helpers import CompressionHelper
from UnityPy.streams import EndianBinaryReader

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", default="art/source/_tmp/gunfire-bundles/complete/data468")
    parser.add_argument("--shader", default="Lightweight Render Pipeline/M1/Character")
    parser.add_argument("--output", default="art/source/_tmp/gunfire-shaders")
    parser.add_argument("--pass-index", type=int, default=0)
    parser.add_argument("--index", type=int, action="append", help="Blob index; defaults to the first vertex and fragment program")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    environment = UnityPy.load(str(ROOT / args.bundle))
    shader, shader_tree = next(
        (obj.read(), obj.read_typetree())
        for obj in environment.objects
        if obj.type.name == "Shader" and obj.read().m_ParsedForm.m_Name == args.shader
    )
    compressed = bytes(shader.compressedBlob)
    offset = shader.offsets[0]
    compressed_size = shader.compressedLengths[0]
    decompressed = CompressionHelper.decompress_lz4(
        compressed[offset:offset + compressed_size], shader.decompressedLengths[0]
    )
    program = ShaderProgram(EndianBinaryReader(decompressed, endian="<"), shader.object_reader.version)
    parsed = shader.m_ParsedForm
    selected_pass = parsed.m_SubShaders[0].m_Passes[args.pass_index]
    indices = args.index
    if indices is None:
        indices = [] if args.all else [
            selected_pass.progVertex.m_SubPrograms[0].m_BlobIndex,
            selected_pass.progFragment.m_SubPrograms[0].m_BlobIndex,
        ]
    if args.all:
        indices = sorted({p.m_BlobIndex for p in selected_pass.progVertex.m_SubPrograms + selected_pass.progFragment.m_SubPrograms})
    stem = re.sub(r"[^a-z0-9]+", "-", args.shader.lower()).strip("-")
    output = ROOT / args.output / stem
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for index in indices:
        subprogram = program.m_SubPrograms[index]
        code = bytes(subprogram.m_ProgramCode)
        start = code.find(b"DXBC")
        if start < 0:
            raise ValueError(f"Program {index} has no DXBC payload")
        suffix = "vs" if subprogram.m_ProgramType in (14, 15) or "Vertex" in str(subprogram.m_ProgramType) else "ps"
        name = f"{index:05d}-{suffix}.dxbc"
        (output / name).write_bytes(code[start:])
        records.append({
            "index": index,
            "file": name,
            "stage": suffix,
            "programType": str(subprogram.m_ProgramType),
            "unityHeaderBytes": start,
            "bytes": len(code) - start,
            "keywords": subprogram.m_Keywords,
            "localKeywords": subprogram.m_LocalKeywords,
        })
    metadata = {
        "sourceBundle": args.bundle,
        "shader": args.shader,
        "unityVersion": list(shader.object_reader.version),
        "subProgramCount": len(program.m_SubPrograms),
        "properties": shader_tree["m_ParsedForm"]["m_PropInfo"],
        "programs": records,
    }
    (output / "manifest.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "programs": records}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
