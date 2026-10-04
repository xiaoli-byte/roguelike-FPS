"""Create a new CargoHoist build with a centered grounded pivot, retaining old QA."""
import json
import os
import shutil
import sys
os.environ['ART_PIPELINE_SKIP_ENV'] = '1'
from lib.config import CFG
from lib.state import AssetState
from lib import blender

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf8')
    spec = CFG.asset('SM_Env_CargoHoist')
    state = AssetState(spec)
    source = state.require('build')
    old_tag = f"{spec.id}_v{source['version']:03d}"
    version = state.next_version('build')
    tag = f'{spec.id}_v{version:03d}'
    work, export = spec.stage_dir('build'), spec.stage_dir('export')
    textures = work / f'textures_v{version:03d}'
    textures.mkdir(exist_ok=True)
    for name in source['files']:
        if name.endswith('.png'):
            shutil.copyfile(state.file(source, name), textures/name)
    result = blender.run('bl_ground_cargo_hoist.py', dict(asset_id=spec.id,
        source_build=source['version'], source_blend=str(state.file(source, old_tag+'.blend')),
        source_metrics=str(state.file(source, old_tag+'_metrics.json')),
        texture_dir=str(textures), export_glb=str(export/(tag+'.glb')),
        blend_path=str(work/(tag+'.blend'))), spec.dir/'_tmp'/f'normalize_v{version:03d}', 'normalize')
    metrics = work/(tag+'_metrics.json')
    metrics.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    state.add_version('build', dict(version=version, **{'from': source['from']},
        technical_parent_build=source['version'], pivot_normalization=result['pivot_normalization'],
        align_iou=source['align_iou'], uncovered_ratio=source['uncovered_ratio'],
        lods=source['lods'], export_kb=round(result['export']['bytes']/1024, 1),
        seconds=result['_seconds'], bake_device=source['bake_device']),
        [work/(tag+'.blend'), export/(tag+'.glb'), metrics, *sorted(textures.glob('*.png'))])
    print('NORMALIZED_BUILD', tag)
