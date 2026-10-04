"""Read-only measured all-LOD architecture bounds; no edits or artistic geometry."""
import hashlib,json,pathlib,re,sys,time
import bpy
p=pathlib.Path(sys.argv[sys.argv.index("--")+1]);P=json.loads(p.read_text(encoding="utf-8"))
assets=[]
for item in P["assets"]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=item["glb"])
    lods=[]
    for obj in sorted(bpy.context.scene.objects,key=lambda o:o.name):
        match=re.fullmatch(re.escape(item["id"])+r"_LOD(\d+)",obj.name)
        if obj.type!="MESH" or not match:continue
        points=[]
        for vertex in obj.data.vertices:
            world=obj.matrix_world@vertex.co
            points.append([float(world.x),float(world.z),float(-world.y)])
        lower=[min(v[k] for v in points) for k in range(3)]
        upper=[max(v[k] for v in points) for k in range(3)]
        lods.append({"lod":int(match.group(1)),"name":obj.name,"vertices":len(points),
                     "bounds":{"min":lower,"max":upper}})
    assert [l["lod"] for l in lods]==[0,1,2]
    lower=[min(l["bounds"]["min"][k] for l in lods) for k in range(3)]
    upper=[max(l["bounds"]["max"][k] for l in lods) for k in range(3)]
    size=[upper[k]-lower[k] for k in range(3)]
    scale=min(P["runtime_envelope"][k]/max(size[k],1e-6) for k in range(3))
    assets.append({"id":item["id"],"build_version":item["build_version"],
                   "glb":item["glb"],"sha256":hashlib.sha256(pathlib.Path(item["glb"]).read_bytes()).hexdigest(),
                   "lods":lods,"all_lod_union":{"min":lower,"max":upper},
                   "all_lod_size_xyz_m":size,
                   "runtime_envelope_xyz_m":P["runtime_envelope"],
                   "uniform_fit_scale_per_placement_unit":scale,
                   "fitted_size_xyz_m_per_placement_unit":[v*scale for v in size],
                   "source_offset_xyz_m":[-(lower[0]+upper[0])/2,-lower[1],-(lower[2]+upper[2])/2]})
report={"schema":1,"created":time.strftime("%Y-%m-%d %H:%M:%S"),
        "method":"Decoded actual GLB vertices, full node world transform, converted Blender XYZ to game XYZ, union of every LOD. Fit/center/ground exactly as architectureMatrix before placement.s.",
        "geometry_edited":False,"placement_scale_basis":1,
        "source":{"path":__file__,"sha256":hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()},
        "arguments":{"path":str(p),"sha256":hashlib.sha256(p.read_bytes()).hexdigest()},"assets":assets}
path=pathlib.Path(P["report"]);path.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
print("[wall-bounds] "+json.dumps({"report":str(path),"assets":[{k:a[k] for k in ("id","all_lod_union","all_lod_size_xyz_m","uniform_fit_scale_per_placement_unit","fitted_size_xyz_m_per_placement_unit")} for a in assets]},ensure_ascii=False),flush=True)
