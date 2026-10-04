"""Far-LOD cleanup of an existing Hunyuan mesh; never creates an art shape."""

import bpy


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def fit_far_lod_budget(obj, budget, max_height_fraction):
    """Collapse can stall on tiny topology rings; weld only the distant LOD.

    Every attempt starts from the same mesh, so weld displacements do not add
    up. UVs and material slots remain on the original mesh data. If bounded
    cleanup cannot reach the budget, fail instead of relaxing validation.
    """
    before = triangle_count(obj)
    if before <= budget:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    source = obj.data.copy()
    height = max(v.co.z for v in source.vertices) - min(v.co.z for v in source.vertices)
    attempts = []
    try:
        for fraction in (0, 0.005, 0.0075, 0.010, 0.0125, 0.015):
            if fraction > max_height_fraction:
                continue
            old = obj.data
            obj.data = source.copy()
            if old.users == 0:
                bpy.data.meshes.remove(old)
            threshold = height * fraction
            if threshold:
                bpy.ops.object.mode_set(mode="EDIT")
                bpy.ops.mesh.select_all(action="SELECT")
                bpy.ops.mesh.remove_doubles(threshold=threshold)
                bpy.ops.mesh.dissolve_degenerate(threshold=1e-5)
                bpy.ops.mesh.delete_loose()
                bpy.ops.object.mode_set(mode="OBJECT")
            count = triangle_count(obj)
            if count > budget:
                mod = obj.modifiers.new("fit_far_budget", "DECIMATE")
                mod.decimate_type = "COLLAPSE"
                mod.ratio = max(0, budget - 4) / count
                mod.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=mod.name)
            mod = obj.modifiers.new("tri_far_budget", "TRIANGULATE")
            bpy.ops.object.modifier_apply(modifier=mod.name)
            obj.data.validate(clean_customdata=False)
            count = triangle_count(obj)
            attempts.append({"weld_m": round(threshold, 5), "tris": count})
            if count <= budget:
                return {"before_tris": before, "after_tris": count,
                        "weld_m": round(threshold, 5), "attempts": attempts}
        raise RuntimeError(f"{obj.name}: bounded far-LOD cleanup still exceeds {budget}: {attempts}")
    finally:
        bpy.data.meshes.remove(source)
