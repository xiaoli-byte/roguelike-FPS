"""Register built-in ImageGen concepts with normal asset provenance and alignment."""
import json
import shutil
import sys
from pathlib import Path
from lib.config import CFG
from lib.state import AssetState
from lib import imaging
from stages.concept import register_sheet, compare_sheet

def register(item):
    spec = CFG.asset(item['id'])
    st = AssetState(spec)
    bo = st.require('blockout')
    ver = st.next_version('concept')
    out = spec.stage_dir('concept')
    stem = f'CN_{spec.id}_v{ver:03d}'
    sheet = out / f'{stem}_sheet.png'
    shutil.copyfile(item['path'], sheet)
    reference = [st.file(bo, f"BO_{spec.id}_v{bo['version']:03d}_{v}.png") for v in imaging.VIEW_ORDER]
    views = [im for im, _ in register_sheet(sheet, reference)]
    files = [sheet]
    for name, image in zip(imaging.VIEW_ORDER, views):
        path = out / f'{stem}_{name}.png'
        image.save(path)
        files.append(path)
    compare = out / f'{stem}_compare.png'
    ious = compare_sheet(reference, views, compare)
    prompt = out / f'{stem}_prompt.txt'
    prompt.write_text(item['prompt'], encoding='utf-8')
    st.add_version('concept', {'version': ver, 'from_blockout': bo['version'], 'generator': 'Codex built-in image_gen', 'source_image': item['path'], 'silhouette_iou': dict(zip(imaging.VIEW_ORDER, ious))}, [*files, compare, prompt])
    print(spec.id, 'registered', dict(zip(imaging.VIEW_ORDER, ious)), flush=True)

if __name__ == '__main__':
    for item in json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')):
        register(item)
