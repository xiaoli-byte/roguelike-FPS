"""单遍后处理调色对齐：把 playtest fp-grade-ch1/2/3 每关的拟合值并成每章一套（第二批 E 路，docs/performance-unity.md「第一人称渲染」）。

每关的结果在 unity/Assets/Art/_Review/fp_grade_fp-grade-ch<N>.txt（第一人称曝光补偿在 playtest fp-shots 的 fp_look_fp-shots.txt：FPK 系数 伽马 特效系数、FLASH 白芯倍数）：
    FIT  <关卡> <章> v0 … v9        （曝光、对比、饱和、色温、色调、暗角、Bloom、提升、伽马、增益）
    HESS <关卡> <章> h00 … h99       （拟合终点的 JᵀJ / 残差数，10×10）
章节的共同值 = 各关的二次近似之和的最小点：θ = (Σ H_k)⁻¹ Σ H_k θ_k（哪一关对哪个参数更敏感，就更听那一关的）。
另外打印各关按共同值估出的均方差增量 (θ − θ_k)ᵀ H_k (θ − θ_k)，看有没有哪一关被牺牲太多。

    python scripts/unity/fp_grade_combine.py                 # 读三章的结果，打印每章一行，写 _Review/fp_grade_theta.txt（fp-look 核对用）
"""
import glob
import os
import re
import sys

import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REVIEW = os.path.join(ROOT, "unity", "Assets", "Art", "_Review")
NAMES = ["曝光", "对比", "饱和", "色温", "色调", "暗角", "Bloom", "提升", "伽马", "增益"]
N = len(NAMES)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    fits, hess, fpk, flash = {}, {}, {}, {}
    # 第一人称曝光补偿（playtest fp-shots 的 FPK / FLASH 行：每章第一关开火 / 换弹 / 技能拟合的 系数、伽马，枪口火焰倍数）
    for path in sorted(glob.glob(os.path.join(REVIEW, "fp_look_fp-shots.txt"))):
        for line in open(path, encoding="utf-8"):
            m = re.match(r"\s*FPK (\S+) (\S+) ([0-9.]+) ([0-9.]+) ([0-9.]+)", line)
            if m:
                fpk[m.group(2)] = (float(m.group(3)), float(m.group(4)), float(m.group(5)))
            m = re.match(r"\s*FLASH (\S+) (\S+) ([0-9.]+)", line)
            if m:
                flash[m.group(2)] = float(m.group(3))
    for path in sorted(glob.glob(os.path.join(REVIEW, "fp_grade_fp-grade-ch*.txt"))):
        for line in open(path, encoding="utf-8"):
            t = line.split()
            if len(t) >= 3 and t[0] == "FIT" and len(t) == 3 + N:
                fits[(t[2], t[1])] = np.array([float(v) for v in t[3:]])
            elif len(t) >= 3 and t[0] == "HESS" and len(t) == 3 + N * N:
                hess[(t[2], t[1])] = np.array([float(v) for v in t[3:]]).reshape(N, N)
    if not fits:
        sys.exit(f"{REVIEW} 里没有 fp_grade_fp-grade-ch*.txt 的 FIT 行：先跑 bridge.sh playtest fp-grade-ch1 …")
    lines = ["# 章 曝光 对比 饱和 色温 色调 暗角 Bloom 提升 伽马 增益 第一人称系数 第一人称伽马 枪口火焰白芯倍数 第一人称特效系数（fp_grade_combine.py 生成，fp-look 核对时代替工程里的 Volume 值）"]
    for chapter in sorted({k[0] for k in fits}):
        keys = sorted(k for k in fits if k[0] == chapter)
        a = np.zeros((N, N))
        b = np.zeros(N)
        for k in keys:
            h = hess.get(k, np.eye(N))
            a += h
            b += h @ fits[k]
        theta = np.linalg.lstsq(a, b, rcond=None)[0]
        print(f"== {chapter}（{len(keys)} 关）")
        for k in keys:
            d = theta - fits[k]
            cost = float(d @ hess.get(k, np.eye(N)) @ d)
            print(f"   {k[1]}: " + "、".join(f"{n} {v:.3f}" for n, v in zip(NAMES, fits[k])) + f"；用共同值多出的均方差 ≈ {cost:.2f}")
        k, g, fx = fpk.get(chapter, (1.0, 1.0, 1.0))
        fl = flash.get(chapter, 1.0)
        print("   共同值: " + "、".join(f"{n} {v:.3f}" for n, v in zip(NAMES, theta)) + f"、第一人称 ×{k:.3f} ^{g:.2f}、特效 ×{fx:.3f}、白芯 ×{fl:.1f}")
        lines.append(chapter + " " + " ".join(f"{v:.5f}" for v in theta) + f" {k:.4f} {g:.3f} {fl:.2f} {fx:.4f}")
    out = os.path.join(REVIEW, "fp_grade_theta.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(out)


if __name__ == "__main__":
    main()
