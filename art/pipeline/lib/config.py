"""读取 pipeline.toml / registry.toml / .env，给出每个资产的规格与目录。"""

from __future__ import annotations

import os
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
ROOT = PIPELINE_DIR.parents[1]

ASSET_ID = re.compile(r"^(SK|SM)_[A-Z][A-Za-z]+_[A-Z][A-Za-z0-9]+$")

# 每个资产目录下的阶段子目录（编号即流水线顺序）
STAGE_DIRS = {
    "blockout": "00_blockout",
    "concept": "01_concept",
    "highpoly": "02_highpoly",
    "build": "03_work",
    "export": "04_export",
    "review": "05_review",
}


class PipelineError(Exception):
    """管线可预期的失败（规格不符、闸门未通过、外部服务报错），CLI 打印后以退出码 1 结束。"""


def _load_env() -> None:
    env = PIPELINE_DIR / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


@dataclass
class AssetSpec:
    id: str
    display: str
    kind: str
    cls: str
    category: str
    blockout: dict
    brief: str
    material: dict
    keep_glow: str
    lod_tris: list[int]
    lod_distance: list[float]
    texture: int
    texel_density: int
    max_file_kb: int
    raw: dict = field(repr=False, default_factory=dict)

    @property
    def dir(self) -> Path:
        return ROOT / CFG.paths["source"] / self.category / self.id

    def stage_dir(self, stage: str) -> Path:
        d = self.dir / STAGE_DIRS[stage]
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def runtime_path(self) -> Path:
        return ROOT / CFG.paths["runtime"] / self.category / f"{self.id}.glb"

    @property
    def runtime_url(self) -> str:
        return f"assets/{self.category}/{self.id}.glb"


class Config:
    def __init__(self) -> None:
        if os.environ.get("ART_PIPELINE_SKIP_ENV") != "1":
            _load_env()
        self.data = tomllib.loads((PIPELINE_DIR / "pipeline.toml").read_text(encoding="utf-8"))
        self.registry = tomllib.loads((PIPELINE_DIR / "registry.toml").read_text(encoding="utf-8")).get("assets", {})
        self.paths = self.data["paths"]
        self.tools = self.data["tools"]

    def section(self, name: str) -> dict:
        return self.data[name]

    def asset(self, asset_id: str) -> AssetSpec:
        raw = self.registry.get(asset_id)
        if raw is None:
            raise PipelineError(f"registry.toml 里没有登记 {asset_id}")
        if not ASSET_ID.match(asset_id):
            raise PipelineError(f"资产 ID 不符合命名规范 SK|SM_<类>_<名>：{asset_id}")
        kind = raw.get("kind")
        if kind not in ("skeletal", "static"):
            raise PipelineError(f"{asset_id}: kind 必须是 skeletal 或 static")
        if (kind == "skeletal") != asset_id.startswith("SK_"):
            raise PipelineError(f"{asset_id}: 前缀与 kind 不一致（SK_ ↔ skeletal，SM_ ↔ static）")
        cls = self.data["classes"].get(raw.get("class", ""))
        if cls is None:
            raise PipelineError(f"{asset_id}: 未知规格档 class={raw.get('class')}")
        return AssetSpec(
            id=asset_id,
            display=raw.get("display", asset_id),
            kind=kind,
            cls=raw["class"],
            category=cls["category"],
            blockout=raw.get("blockout", {}),
            brief=raw.get("brief", "").strip(),
            material={"roughness": 0.8, "metallic": 0.0, **raw.get("material", {})},
            keep_glow=raw.get("keep_glow", "attachments"),
            lod_tris=list(cls["lod_tris"]),
            lod_distance=list(cls["lod_distance"]),
            texture=int(cls["texture"]),
            texel_density=int(cls["texel_density"]),
            max_file_kb=int(cls["max_file_kb"]),
            raw=raw,
        )

    def all_assets(self) -> list[str]:
        return list(self.registry.keys())


CFG = Config()
