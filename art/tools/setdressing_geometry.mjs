// Decode actual generated GLBs for asset review. Never creates or changes art meshes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const IDS = ['SM_Env_MarketStall', 'SM_Env_FrozenSkiff', 'SM_Env_SlagCart'];
const require = createRequire(import.meta.url), decoderFile = path.join(repository, 'node_modules/three/examples/jsm/libs/draco/draco_decoder.js');
const sandbox = { module: { exports: {} }, exports: {}, require, process, console, Buffer, TextDecoder, WebAssembly,
  __dirname: path.dirname(decoderFile), __filename: decoderFile, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(decoderFile, 'utf8'), sandbox);
const draco = await sandbox.module.exports();
export const readJson = file => JSON.parse(fs.readFileSync(path.resolve(repository, file), 'utf8'));
export const current = (state, stage) => state.stages[stage].versions.find(v => v.version === state.stages[stage].current);

export function loadSetdressing(id, published = false) {
  if (!IDS.includes(id)) throw new Error('Only the three new set-dressing assets are supported');
  const root = `art/source/props/${id}/`, state = readJson(root + 'asset.json');
  const build = current(state, 'build');
  const file = published ? `public/${readJson('public/assets/manifest.json').assets[id].url}`
    : root + Object.values(build.files).find(f => f.path.endsWith('.glb')).path;
  const bytes = fs.readFileSync(path.resolve(repository, file));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12))), binary = 20 + bytes.readUInt32LE(12) + 8;
  function nodeMatrix(index) {
    const n = gltf.nodes[index], matrix = new THREE.Matrix4();
    if (n.matrix) matrix.fromArray(n.matrix);
    else matrix.compose(new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1]));
    const parent = gltf.nodes.findIndex(p => p.children?.includes(index));
    return parent < 0 ? matrix : nodeMatrix(parent).multiply(matrix);
  }
  const meshes = [];
  for (let lod = 0; lod < 3; lod++) {
    const nodeIndex = gltf.nodes.findIndex(n => n.name === `${id}_LOD${lod}`), node = gltf.nodes[nodeIndex];
    const primitive = gltf.meshes[node.mesh].primitives[0], ext = primitive.extensions.KHR_draco_mesh_compression, view = gltf.bufferViews[ext.bufferView];
    const input = new Int8Array(bytes.buffer, bytes.byteOffset + binary + (view.byteOffset || 0), view.byteLength);
    const buffer = new draco.DecoderBuffer(); buffer.Init(input, input.byteLength);
    const decoder = new draco.Decoder(), decoded = new draco.Mesh(), status = decoder.DecodeBufferToMesh(buffer, decoded);
    if (!status.ok()) throw new Error(status.error_msg());
    const attribute = decoder.GetAttributeByUniqueId(decoded, ext.attributes.POSITION), floats = new draco.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(decoded, attribute, floats);
    const vertices = new Float32Array(decoded.num_points() * 3);
    for (let i = 0; i < vertices.length; i++) vertices[i] = floats.GetValue(i);
    const indices = new Uint32Array(decoded.num_faces() * 3), face = new draco.DracoInt32Array();
    for (let i = 0; i < decoded.num_faces(); i++) { decoder.GetFaceFromMesh(decoded, i, face); for (let k = 0; k < 3; k++) indices[i * 3 + k] = face.GetValue(k); }
    for (const item of [floats, face, buffer, decoded, decoder]) draco.destroy(item);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.applyMatrix4(nodeMatrix(nodeIndex)); geometry.computeBoundingBox();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true); meshes.push(mesh);
  }
  return { id, file, state, gltf, meshes, dispose() { for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); } } };
}

function distances(mesh, origin, direction) {
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
  return ray.intersectObject(mesh, false).map(hit => hit.distance).filter((v, i, a) => i === 0 || Math.abs(v-a[i-1]) > 1e-4);
}

export function measureSetdressing(asset) {
  const all = new THREE.Box3(), lods = [];
  for (const [lod, mesh] of asset.meshes.entries()) {
    const box = mesh.geometry.boundingBox, size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3()); all.union(box);
    const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
    const a = new THREE.Vector3(), b = a.clone(), c = a.clone(); let signedVolume = 0;
    const welded = new Map(), representatives = [], parents = Array.from({length:positions.count},(_,i)=>i);
    const find = i => { while (parents[i] !== i) { parents[i]=parents[parents[i]]; i=parents[i]; } return i; };
    for (let i=0;i<positions.count;i++) {
      a.fromBufferAttribute(positions,i);
      const key=a.toArray().map(v=>Math.round(v*100000)).join(':');
      if (!welded.has(key)) welded.set(key,i);
      representatives[i]=welded.get(key);
    }
    for (let i = 0; i < indices.count; i += 3) {
      a.fromBufferAttribute(positions, indices.getX(i)); b.fromBufferAttribute(positions, indices.getX(i+1)); c.fromBufferAttribute(positions, indices.getX(i+2));
      signedVolume += a.dot(b.cross(c)) / 6;
      const roots=[0,1,2].map(k=>find(representatives[indices.getX(i+k)]));
      parents[roots[1]]=roots[0]; parents[roots[2]]=roots[0];
    }
    const parts=new Map();
    for(let i=0;i<indices.count;i+=3){const key=find(representatives[indices.getX(i)]);parts.set(key,(parts.get(key)??0)+1);}
    const componentTriangles=[...parts.values()].sort((a,b)=>b-a);
    const detail = {};
    if (asset.id === 'SM_Env_FrozenSkiff') {
      // Record real top/bottom intersections across the inner cabin and sidewalls.
      // Seats may interrupt the recess at some stations; never infer it from bounds alone.
      const sections = [];
      for (const z of [-.3, -.15, 0, .15, .3]) {
        const atZ = centre.z + z * size.z;
        const line = [-.4, -.25, 0, .25, .4].map(x => {
          const hits = distances(mesh, [centre.x+x*size.x, box.max.y+1, atZ], [0,-1,0]);
          return { xFraction: x, top: hits.length ? box.max.y+1-hits[0] : null, crossings: hits.length,
            shellThickness: hits.length >= 2 ? hits[1]-hits[0] : null };
        });
        const mid = line[2].top, edges = [line[0].top,line[4].top].filter(v=>v!==null);
        sections.push({ zFraction:z, line, centreRecess: mid!==null && edges.length ? Math.max(...edges)-mid : null });
      }
      detail.hullSections = sections;
    } else if (asset.id === 'SM_Env_MarketStall') {
      detail.canopySections = [-.25, 0, .25].map(z => {
        const hits = distances(mesh, [centre.x,box.max.y+1,centre.z+z*size.z], [0,-1,0]);
        return { zFraction:z, crossings:hits.length, top:hits.length ? box.max.y+1-hits[0] : null, roofThickness:hits.length>=2 ? hits[1]-hits[0]:null };
      });
      detail.servingOpening = [.48,.56,.64].map(y => {
        const hits = distances(mesh, [centre.x,box.min.y+y*size.y,box.max.z+1], [0,0,-1]);
        return {heightFraction:y, crossings:hits.length, frontSetback:hits.length ? hits[0]-1:null};
      });
    } else {
      detail.wheelSections = [-.37,.37].map(x => {
        const hits = distances(mesh, [centre.x+x*size.x,box.min.y+size.y*.25,box.min.z-1], [0,0,1]);
        return {xFraction:x,crossings:hits.length,extent:hits.length>=2 ? hits.at(-1)-hits[0]:null};
      });
      detail.tubSection = [.5,.65,.78].map(y=>{
        const hits=distances(mesh,[box.max.x+1,box.min.y+y*size.y,centre.z],[-1,0,0]);
        return {heightFraction:y,crossings:hits.length,extent:hits.length>=2 ? hits.at(-1)-hits[0]:null};
      });
    }
    lods.push({lod,triangles:indices.count/3,vertices:positions.count,min:box.min.toArray(),max:box.max.toArray(),size:size.toArray(),absoluteSignedVolume:Math.abs(signedVolume),
      weldedComponents:componentTriangles.length,largestComponentTriangleFraction:componentTriangles[0]/(indices.count/3),componentTriangles:componentTriangles.slice(0,8),...detail});
  }
  return {allLodBounds:{min:all.min.toArray(),max:all.max.toArray(),size:all.getSize(new THREE.Vector3()).toArray()},lods};
}
