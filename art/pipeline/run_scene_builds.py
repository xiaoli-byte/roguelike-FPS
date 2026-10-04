"""Game-ready processing of local Hunyuan meshes, without procedural asset modelling."""
import time
import traceback
from types import SimpleNamespace
from lib.config import CFG
from lib.state import AssetState
from prepare_scene_batch import SPECS
from stages import build, validate, review

if __name__ == '__main__':
    # Let Hunyuan own the GPU; 512px prop bakes can run on CPU alongside inference.
    CFG.data['build']['bake_device'] = 'CPU'
    for asset_id, *_ in SPECS:
        spec = CFG.asset(asset_id)
        deadline = time.monotonic() + 1800
        while not AssetState(spec).current('highpoly'):
            if time.monotonic() > deadline:
                raise TimeoutError(f'{asset_id}: waiting for Hunyuan result timed out')
            time.sleep(2)
        try:
            build.run(spec, SimpleNamespace())
            validate.run(spec, SimpleNamespace())
            review.run(spec, SimpleNamespace())
            print('SCENE_READY_FOR_REVIEW', asset_id, flush=True)
        except Exception:
            traceback.print_exc()
