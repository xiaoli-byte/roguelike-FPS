"""Register numeric CargoHoist reference and native ImageGen pixels, no art geometry."""
from __future__ import annotations
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

os.environ['ART_PIPELINE_SKIP_ENV'] = '1'
from PIL import Image
import numpy as np
from scipy import ndimage
from lib.config import CFG
from lib.state import AssetState, sha256
from lib import imaging
from prepare_nature_batch import prepare_reference

ID = 'SM_Env_CargoHoist'
REGISTRATION_VERSION = 2


def registered_components(image, views, height):
    """Separate overlapping column ranges by connected silhouettes, preserving RGB.

    This concept has only dark timber/iron on white; white enclosed openings are
    background too. No repaint, geometry, or nonuniform warp is performed.
    """
    source = np.asarray(image.convert('RGBA')).copy()
    rgb = source[..., :3].astype(np.int32)
    background = np.median(np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]), axis=0)
    foreground = np.linalg.norm(rgb-background, axis=-1) >= 28
    labels, count = ndimage.label(foreground)
    areas = np.bincount(labels.ravel()); areas[0] = 0
    selected = np.argsort(areas)[-4:]
    if count < 4 or min(areas[selected]) < 1000:
        raise ValueError('Expected four complete isolated silhouette components')
    selected = sorted(selected, key=lambda label: float(np.nonzero(labels == label)[1].mean()))
    coverage = float(sum(areas[selected]) / max(1, foreground.sum()))
    if coverage < .995:
        raise ValueError(f'Four components cover only {coverage:.3%} of foreground; review fragments')
    panels, registration = [], {}
    for name, label, camera in zip(imaging.VIEW_ORDER, selected, views['views']):
        mask = labels == label
        box = imaging.bbox(mask)
        isolated = source.copy(); isolated[..., 3] = np.where(mask, 255, 0).astype(np.uint8)
        figure = Image.fromarray(isolated, 'RGBA').crop(box)
        scale = height * camera['px_h'] / camera['world_h'] / figure.height
        width_px, height_px = round(figure.width * scale), round(figure.height * scale)
        pw, ph = camera['px_w'], camera['px_h']
        if width_px > pw - 4 or height_px > ph - 4:
            raise ValueError('Concept exceeds numeric reference; do not squeeze')
        panel = Image.new('RGBA', (pw, ph), (0, 0, 0, 0))
        offset = [(pw-width_px)//2, (ph-height_px)//2]
        panel.alpha_composite(figure.resize((width_px, height_px), Image.Resampling.LANCZOS), tuple(offset))
        panels.append(panel)
        registration[name] = dict(source_bbox=list(box), source_component_area=int(areas[label]),
            source_foreground_coverage=coverage, scale=scale, offset=offset, size=[width_px, height_px],
            physical_height_m=height, method='white-background key, four connected components, uniform height and center')
    return panels, registration


def register(source_json: Path):
    spec = CFG.asset(ID)
    state = AssetState(spec)
    bo = prepare_reference(ID)
    views = json.loads(state.file(bo, f"BO_{ID}_v{bo['version']:03d}_views.json").read_text(encoding='utf8'))
    item = json.loads(source_json.read_text(encoding='utf8'))
    assert item['id'] == ID and item['prompt'].strip()
    source = Path(item['path']).resolve()
    current = state.current('concept')
    digest = sha256(source)
    if current and current.get('source_sha256') == digest and current.get('from_blockout') == bo['version'] and current.get('registration_version') == REGISTRATION_VERSION:
        print('CONCEPT_UNCHANGED', ID)
        return
    with Image.open(source) as image:
        panels, registration = registered_components(image, views, spec.raw['reference_dimensions'][1])
    version = state.next_version('concept')
    stem = f'CN_{ID}_v{version:03d}'
    out = spec.stage_dir('concept')
    native = out/(stem+'_source'+source.suffix)
    shutil.copyfile(source, native)
    files, panel_paths = [native], []
    for name, panel in zip(imaging.VIEW_ORDER, panels):
        file = out/(stem+'_'+name+'.png')
        panel.save(file)
        files.append(file)
        panel_paths.append(file)
    sheet = out/(stem+'_sheet.png')
    imaging.compose_row(panel_paths, sheet)
    prompt = out/(stem+'_prompt.txt')
    prompt.write_text(item['prompt'], encoding='utf8')
    alignment = out/(stem+'_registration.json')
    alignment.write_text(json.dumps(registration, indent=2), encoding='utf8')
    files.extend([sheet, prompt, alignment])
    state.add_version('concept', dict(version=version, from_blockout=bo['version'],
        generator='Codex built-in image_gen', source_image=str(source), source_sha256=digest,
        prompt=item['prompt'], reference_mode='bounds_only', highpoly_mode='multiview',
        registration_version=REGISTRATION_VERSION, registration=registration), files)
    print('CONCEPT_READY_FOR_REVIEW', ID, sheet)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--concept', required=True, type=Path)
    register(parser.parse_args().concept)
