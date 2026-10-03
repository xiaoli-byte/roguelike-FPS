"""资产状态与版本记录（asset.json）。

每个阶段的每次产出都是一个新版本（v001、v002……），不覆盖旧版本；asset.json 记录
- 每个阶段的全部版本：文件、上游版本、参数、耗时、校验和
- 当前采用的版本（current）
- 审核结论（concept / review 两道人工闸门）
下游阶段只认上游的 current 版本；闸门阶段还要求 current 版本已通过审核。
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from contextlib import contextmanager
from pathlib import Path

from .config import ROOT, AssetSpec, PipelineError

ORDER = ["blockout", "concept", "highpoly", "build", "validate", "review", "publish"]
# 需要人工审核通过才能进入下一阶段的关口
GATES = {"concept", "review"}
# 附属阶段（不在主链上）：产出新版本时只作废这些下游阶段
SIDE_STAGES = {"matid": ["build", "validate", "review", "publish"], "emid": ["build", "validate", "review", "publish"]}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


class AssetState:
    def __init__(self, spec: AssetSpec) -> None:
        self.spec = spec
        self.path = spec.dir / "asset.json"
        if self.path.exists():
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
        else:
            self.data = {"id": spec.id, "display": spec.display, "kind": spec.kind, "class": spec.cls, "stages": {}}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        # Windows 上目标文件被其他进程短暂占用（杀毒 / DLP 扫描刚写入的文件）时 os.replace 会拒绝访问：重试几次
        for attempt in range(20):
            try:
                os.replace(tmp, self.path)
                return
            except PermissionError:
                time.sleep(0.1 * (attempt + 1))
        raise PipelineError(f"无法写入 {self.path}（文件被占用）")

    @contextmanager
    def _locked(self, timeout: float = 60.0):
        """多个管线进程会同时更新同一个 asset.json（比如材质分区和游戏化批次并行）：
        加文件锁，锁内先重读磁盘上的最新状态再修改，避免互相覆盖。"""
        lock = self.path.with_suffix(".lock")
        lock.parent.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        while True:
            try:
                fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                break
            except FileExistsError:
                if time.time() - lock.stat().st_mtime > 120:  # 进程崩溃留下的陈旧锁
                    lock.unlink(missing_ok=True)
                elif time.time() - t0 > timeout:
                    raise PipelineError(f"等待 {lock} 超时")
                time.sleep(0.1)
        try:
            if self.path.exists():
                self.data = json.loads(self.path.read_text(encoding="utf-8"))
            yield self.data
            self.save()
        finally:
            lock.unlink(missing_ok=True)

    def _find(self, name: str, version: int) -> dict:
        for v in self.stage(name)["versions"]:
            if v["version"] == version:
                return v
        raise PipelineError(f"{self.spec.id}: 找不到 {name} v{version:03d}")

    # ── 版本 ──

    def stage(self, name: str) -> dict:
        return self.data["stages"].setdefault(name, {"current": None, "versions": []})

    def next_version(self, name: str) -> int:
        vs = self.stage(name)["versions"]
        return (max(v["version"] for v in vs) + 1) if vs else 1

    def current(self, name: str) -> dict | None:
        st = self.data["stages"].get(name)
        if not st or st["current"] is None:
            return None
        for v in st["versions"]:
            if v["version"] == st["current"]:
                return v
        return None

    def require(self, name: str) -> dict:
        """取上游阶段的当前版本；闸门阶段要求已审核通过。"""
        v = self.current(name)
        if v is None:
            raise PipelineError(f"{self.spec.id}: 还没有 {name} 阶段的产出，先运行 `assetctl.py {name} {self.spec.id}`")
        if name in GATES and v.get("review", {}).get("verdict") != "approved":
            raise PipelineError(
                f"{self.spec.id}: {name} v{v['version']:03d} 尚未通过审核。"
                f"看过产出后运行 `assetctl.py approve {self.spec.id} {name} --by <审核人>`（或 reject）")
        return v

    def require_any(self, name: str) -> dict:
        """取当前版本，不管审核结论（用于补跑同一版本内的后处理）。"""
        v = self.current(name)
        if v is None:
            raise PipelineError(f"{self.spec.id}: 还没有 {name} 阶段的产出")
        return v

    def refresh_hashes(self, name: str, rec: dict) -> None:
        """同一版本的文件被后处理改写后，更新校验和；已有的审核结论作废（内容变了要重审）。
        rec 上调用方改过的字段一并写回。"""
        hashes = {k: sha256(self._abs(f["path"])) for k, f in rec["files"].items()}
        with self._locked():
            target = self._find(name, rec["version"])
            target.update({k: v for k, v in rec.items() if k not in ("files", "review")})
            for k, h in hashes.items():
                target["files"][k]["sha256"] = h
            target.pop("review", None)
            target["modified"] = now()

    def add_version(self, name: str, record: dict, files: list[Path]) -> dict:
        rec = {
            "version": record.pop("version"),
            "created": now(),
            "files": {f.name: {"path": self._rel(f), "sha256": sha256(f)} for f in files},
            **record,
        }
        with self._locked():
            st = self.stage(name)
            if any(v["version"] == rec["version"] for v in st["versions"]):
                raise PipelineError(f"{self.spec.id}: {name} v{rec['version']:03d} 已被另一个进程占用，请重跑")
            st["versions"].append(rec)
            st["current"] = rec["version"]
            # 上游换了版本，下游的「当前」全部作废，必须重跑（附属阶段只作废它真正影响的阶段）
            later_stages = SIDE_STAGES[name] if name in SIDE_STAGES else ORDER[ORDER.index(name) + 1:]
            for later in later_stages:
                if later in self.data["stages"]:
                    self.data["stages"][later]["current"] = None
        return rec

    def _rel(self, f: Path) -> str:
        """资产目录内的文件记相对路径；目录外（如 public/assets 发布产物）记 @root/ 开头的项目相对路径。"""
        try:
            return str(f.relative_to(self.spec.dir)).replace("\\", "/")
        except ValueError:
            return "@root/" + str(f.relative_to(ROOT)).replace("\\", "/")

    def _abs(self, rel: str) -> Path:
        return ROOT / rel[6:] if rel.startswith("@root/") else self.spec.dir / rel

    def file(self, rec: dict, name: str) -> Path:
        return self._abs(rec["files"][name]["path"])

    def set_review(self, name: str, verdict: str, by: str, note: str) -> dict:
        with self._locked():
            v = self.current(name)
            if v is None:
                raise PipelineError(f"{self.spec.id}: {name} 阶段没有当前版本可审核")
            v["review"] = {"verdict": verdict, "by": by, "note": note, "time": now()}
        return v

    def summary(self) -> list[str]:
        lines = []
        for name in ORDER[:2] + ["matid", "emid"] + ORDER[2:]:
            v = self.current(name)
            if v is None:
                lines.append(f"  {name:9} —")
                continue
            r = v.get("review", {})
            tag = f"  [{r['verdict']} by {r['by']}]" if r else ("  [待审核]" if name in GATES else "")
            lines.append(f"  {name:9} v{v['version']:03d}  {v['created']}{tag}")
        return lines
