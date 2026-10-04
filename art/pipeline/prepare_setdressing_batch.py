"""Register three native ImageGen concepts, preserving alpha; no artistic meshes."""
from __future__ import annotations
import argparse
import json
import os
import shutil
import sys
from pathlib import Path
os.environ['ART_PIPELINE_SKIP_ENV'] = '1'
import numpy as np
from PIL import Image
from scipy import ndimage
from lib.config import CFG
from lib.state import AssetState, sha256
from lib import imaging
from prepare_nature_batch import prepare_reference

ASSETS = ('SM_Env_MarketStall', 'SM_Env_FrozenSkiff', 'SM_Env_SlagCart')


def register_panels(image, views, height):
    source = np.asarray(image.convert('RGBA')).copy()
    native_alpha = bool((source[..., 3] < 250).mean() > .05)
    if native_alpha:
        foreground = source[..., 3] > 0
        method = 'preserved native alpha; four connected components; uniform height and centre'
    else:
        rgb = source[..., :3].astype(np.int32)
        background = np.median(np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]), axis=0)
        foreground = np.linalg.norm(rgb-background, axis=-1) >= 28
        source[..., 3] = np.where(foreground, 255, 0)
        method = 'contrasting plain-background key; four connected components; uniform height and centre'
    labels, count = ndimage.label(foreground)
    areas = np.bincount(labels.ravel()); areas[0] = 0
    selected = np.argsort(areas)[-4:]
    if count < 4 or min(areas[selected]) < 1000:
        raise ValueError('Expected four isolated complete figures; inspect source rather than crop blindly')
    selected = sorted(selected, key=lambda label: float(np.nonzero(labels == label)[1].mean()))
    coverage = float(sum(areas[selected]) / max(1, foreground.sum()))
    if coverage < .995:
        raise ValueError(f'Four components preserve only {coverage:.3%} of foreground; inspect disconnected parts')
    panels, registration = [], {}
    for name, label, camera in zip(imaging.VIEW_ORDER, selected, views['views']):
        mask = labels == label
        box = imaging.bbox(mask)
        isolated = source.copy(); isolated[..., 3] = np.where(mask, source[..., 3], 0)
        figure = Image.fromarray(isolated, 'RGBA').crop(box)
        scale = height * camera['px_h'] / camera['world_h'] / figure.height
        width, high = round(figure.width * scale), round(figure.height * scale)
        pw, ph = camera['px_w'], camera['px_h']
        if width > pw-4 or high > ph-4:
            raise ValueError('Concept exceeds numeric camera; do not stretch art')
        panel = Image.new('RGBA', (pw, ph), (0, 0, 0, 0))
        offset = [(pw-width)//2, (ph-high)//2]
        panel.alpha_composite(figure.resize((width, high), Image.Resampling.LANCZOS), tuple(offset))
        panels.append(panel)
        registration[name] = dict(source_bbox=list(box), source_component_area=int(areas[label]),
            source_foreground_coverage=coverage, native_alpha_preserved=native_alpha,
            scale=scale, offset=offset, size=[width, high], physical_height_m=height, method=method)
    return panels, registration


def register(item):
    asset_id = item['id']
    assert asset_id in ASSETS and item['prompt'].strip()
    spec = CFG.asset(asset_id); state = AssetState(spec)
    bo = prepare_reference(asset_id)
    views = json.loads(state.file(bo, f"BO_{asset_id}_v{bo['version']:03d}_views.json").read_text(encoding='utf8'))
    source = Path(item['path']).resolve(); digest = sha256(source)
    current = state.current('concept')
    if current and current.get('source_sha256') == digest and current.get('from_blockout') == bo['version']:
        print('CONCEPT_UNCHANGED', asset_id); return
    with Image.open(source) as image:
        panels, registration = register_panels(image, views, spec.raw['reference_dimensions'][1])
    version = state.next_version('concept'); stem = f'CN_{asset_id}_v{version:03d}'
    out = spec.stage_dir('concept'); native = out/(stem+'_source'+source.suffix)
    shutil.copyfile(source, native)
    files, panel_paths = [native], []
    for name, panel in zip(imaging.VIEW_ORDER, panels):
        file = out/(stem+'_'+name+'.png'); panel.save(file); files.append(file); panel_paths.append(file)
    sheet = out/(stem+'_sheet.png'); imaging.compose_row(panel_paths, sheet)
    prompt = out/(stem+'_prompt.txt'); prompt.write_text(item['prompt'], encoding='utf8')
    alignment = out/(stem+'_registration.json'); alignment.write_text(json.dumps(registration, indent=2), encoding='utf8')
    files.extend([sheet, prompt, alignment])
    state.add_version('concept', dict(version=version, from_blockout=bo['version'],
        generator='Codex built-in image_gen', source_image=str(source), source_sha256=digest,
        prompt=item['prompt'], reference_mode='bounds_only', highpoly_mode='multiview',
        registration_version=1, registration=registration,
        source_history=item.get('source_history', [])), files)
    print('CONCEPT_READY_FOR_REVIEW', asset_id, sheet)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--concepts', required=True, type=Path)
    parser.add_argument('--assets', nargs='+', choices=ASSETS, default=ASSETS)
    args = parser.parse_args()
    for item in json.loads(args.concepts.read_text(encoding='utf8')):
        if item['id'] in args.assets: register(item)
