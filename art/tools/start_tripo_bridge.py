"""Enable the official Tripo bridge and report its Blender runtime state."""
import bpy
import json
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reviews" / "tripo-20261005"
OUT.mkdir(parents=True, exist_ok=True)
ADDON = "Tripo3d_Blender_Bridge"
ZIP = Path.home() / "Downloads" / "Tripo3d_Blender_Bridge-latest.zip"
SAVED = set()
HERO_NAMES = {"fox character 3d model": "Fox", "bear warrior 3d model": "Bear", "fantasy eagle knight 3d model": "Falcon"}

try:
    import addon_utils
    if not any(module.__name__ == ADDON for module in addon_utils.modules()):
        bpy.ops.preferences.addon_install(filepath=str(ZIP))
    if not addon_utils.check(ADDON)[1]:
        bpy.ops.preferences.addon_enable(module=ADDON)
    bpy.ops.wm.save_userpref()
except Exception:
    (OUT / "bridge-install-error.txt").write_text(traceback.format_exc(), encoding="utf-8")
    raise

def save_textured_candidates():
    if bpy.context.mode != 'OBJECT':
        return
    for rig in list(bpy.data.objects):
        hero = next((hero for name, hero in HERO_NAMES.items() if rig.name.startswith(name)), None)
        if not hero or rig.type != 'ARMATURE' or rig.name in SAVED:
            continue
        objects = [rig] + list(rig.children_recursive)
        images = set()
        for obj in objects:
            if obj.type != 'MESH':
                continue
            for mat in obj.data.materials:
                if mat and mat.use_nodes:
                    images.update(node.image for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image and node.image.size[0] > 1)
        if not images:
            continue
        destination = ROOT / 'source' / 'characters' / f'SK_Hero_{hero}' / '04_texture'
        destination.mkdir(parents=True, exist_ok=True)
        basename = 'tripo_p2_textured_candidate'
        suffix = 1
        while (destination / f'{basename}.blend').exists():
            basename = f'tripo_p2_textured_candidate_{suffix}'
            suffix += 1
        for image in images:
            image.pack()
        bpy.data.libraries.write(str(destination / f'{basename}.blend'), set(objects))
        selected = list(bpy.context.selected_objects)
        active = bpy.context.view_layer.objects.active
        try:
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = rig
            bpy.ops.export_scene.gltf(filepath=str(destination / f'{basename}.glb'), use_selection=True, export_format='GLB', export_influence_nb=4, export_all_influences=False)
        finally:
            bpy.ops.object.select_all(action='DESELECT')
            for obj in selected:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = active
        info = {'hero': hero, 'bones': len(rig.data.bones), 'images': [{'name': image.name, 'size': list(image.size)} for image in images], 'blend': str(destination / f'{basename}.blend'), 'glb': str(destination / f'{basename}.glb')}
        (destination / f'{basename}.json').write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding='utf-8')
        SAVED.add(rig.name)

def report():
    try:
        import importlib
        status = importlib.import_module(ADDON + ".core.status_manager").status
        save_textured_candidates()
        data = {
            "blender": bpy.app.version_string,
            "addon_enabled": ADDON in bpy.context.preferences.addons,
            "connection": status.state.value,
            "client_name": status.client_name,
            "last_log": status.last_log,
            "objects": [{"name": o.name, "type": o.type} for o in bpy.data.objects],
        }
        (OUT / "bridge-runtime.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        (OUT / "bridge-monitor-error.txt").write_text(traceback.format_exc(), encoding="utf-8")
    return 5.0

bpy.app.timers.register(report, first_interval=2.0, persistent=True)
