"""Technical pivot normalization only; never creates or reshapes any mesh."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import bpy
from mathutils import Vector
from bl_common import args, finish, log

P = args()
assert P['asset_id'] == 'SM_Env_CargoHoist'
bpy.ops.wm.open_mainfile(filepath=P['source_blend'])
lods = sorted([o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(P['asset_id']+'_LOD')], key=lambda o: o.name)
assert len(lods) == 3
points = [v.co.copy() for lod in lods for v in lod.data.vertices]
lo = Vector([min(v[i] for v in points) for i in range(3)])
hi = Vector([max(v[i] for v in points) for i in range(3)])
shift = Vector((-(lo.x+hi.x)/2, -(lo.y+hi.y)/2, -lo.z))
metrics = json.loads(Path(P['source_metrics']).read_text(encoding='utf8'))
for lod, record in zip(lods, metrics['lods']):
    count_before = len(lod.data.vertices), len(lod.data.polygons)
    for vertex in lod.data.vertices:
        vertex.co += shift
    lod.data.update()
    assert count_before == (len(lod.data.vertices), len(lod.data.polygons))
    record['bbox_min'] = [float(min(v.co[i] for v in lod.data.vertices)) for i in range(3)]
    record['bbox_max'] = [float(max(v.co[i] for v in lod.data.vertices)) for i in range(3)]
for image in bpy.data.images:
    if image.source == 'FILE':
        target = Path(P['texture_dir']) / Path(bpy.path.abspath(image.filepath)).name
        if target.exists(): image.filepath = str(target)
bpy.ops.object.select_all(action='DESELECT')
for lod in lods: lod.select_set(True)
bpy.context.view_layer.objects.active = lods[0]
props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
options = dict(filepath=P['export_glb'], export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_texcoords=True, export_normals=True,
    export_tangents=True, export_materials='EXPORT', export_image_format='WEBP',
    export_animations=False, export_morph=False, export_extras=True,
    export_cameras=False, export_lights=False, export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6, export_draco_position_quantization=14,
    export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
    export_draco_generic_quantization=12)
bpy.ops.export_scene.gltf(**{k: v for k, v in options.items() if k in props})
bpy.ops.wm.save_as_mainfile(filepath=P['blend_path'], compress=True, relative_remap=True)
metrics['pivot_normalization'] = dict(source_build=P['source_build'],
    translation_blender_xyz=list(shift), operation='identical rigid translation for all LOD vertices',
    topology_unchanged=True, uv_unchanged=True, shape_source_unchanged=True)
metrics['export'] = dict(path=P['export_glb'], bytes=Path(P['export_glb']).stat().st_size)
metrics['blend'] = P['blend_path']
log('Normalized all-LOD pivot only: '+str(tuple(shift)))
finish(P, metrics)
