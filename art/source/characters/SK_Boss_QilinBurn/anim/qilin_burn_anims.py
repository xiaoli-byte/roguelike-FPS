"""火麒麟 · 焚身（SK_Boss_QilinBurn）的手工关键帧动作：和玄鳞共用一份姿势表（同一套骨骼名与层级），按焚身的幅度（轻、狂）生成。

    blender -b --factory-startup --python art/source/characters/SK_Boss_QilinBurn/anim/qilin_burn_anims.py -- [--review <目录>]

等价于 art/source/characters/SK_Boss_Qilin/anim/qilin_anims.py -- --form burn；姿势、片段、事件见那个文件和 docs/art/vfx/qilin.md。
产出 unity/Assets/Art/Characters/SK_Boss_QilinBurn/Anim/Keyframed/<状态>.fbx 与 SK_Boss_QilinBurn.events.json 里手 K 的那几项。
"""
import runpy
import sys
from pathlib import Path

if "--" not in sys.argv:
    sys.argv.append("--")
if "--form" not in sys.argv:
    sys.argv += ["--form", "burn"]
runpy.run_path(str(Path(__file__).resolve().parents[2] / "SK_Boss_Qilin/anim/qilin_anims.py"), run_name="__main__")
