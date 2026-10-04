// Actual published Draco geometry + the production HumanoidRig / IK / pose curves.
// This audit never writes or changes art assets. Import its helpers for mesh regression tests.
// Usage: node art/tools/pose_geometry_audit.mjs

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as THREE from 'three';
const require = createRequire(import.meta.url);
// Always resolve against the repository, even when launched from another directory.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dracoFile=path.resolve(repository, 'node_modules/three/examples/jsm/libs/draco/draco_decoder.js');
const sandbox={module:{exports:{}},exports:{},require,process,console,Buffer,TextDecoder,WebAssembly,__dirname:path.dirname(dracoFile),__filename:dracoFile,setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(dracoFile,'utf8'),sandbox);
const draco=await sandbox.module.exports();
const moduleCache=new Map();
async function ts(file){
file=path.resolve(repository, file);if(moduleCache.has(file))return moduleCache.get(file);
let src=stripTypeScriptTypes(fs.readFileSync(file,'utf8'));
for(const m of [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)]){
const spec=m[1];const url=spec==='three'?pathToFileURL(path.resolve(repository, 'node_modules/three/build/three.module.js')).href:spec.startsWith('.')?await ts(path.resolve(path.dirname(file),spec)+'.ts'):spec;
src=src.replaceAll("'"+spec+"'","'"+url+"'").replaceAll('"'+spec+'"','"'+url+'"');
}
const url='data:text/javascript;base64,'+Buffer.from(src).toString('base64');moduleCache.set(file,url);return url;}
const {buildHumanoid,reachPalmGrip,reachArm,applyWalk,applyCrouch}=await import(await ts('src/enemies/Models.ts'));
const {applyBindPose,HUMANOID_JOINTS}=await import(await ts('src/assets/HumanoidBind.ts'));
const actions=await import(await ts('src/enemies/AttackPoses.ts'));
export const mortarSupportGrip = actions.mortarSupportGrip;
const cannonAim = await import(await ts('src/enemies/CannonAim.ts'));
export const { createCannonAim, boundCannonAim, applyCannonAim } = cannonAim;
const { articulationGeometry } = await import(await ts('src/assets/ArticulationWeights.ts'));
export { articulationGeometry };
const manifest=JSON.parse(fs.readFileSync(path.resolve(repository, 'public/assets/manifest.json'),'utf8')).assets;
export function loadPublishedMesh(id, lod = 0){
const b=fs.readFileSync(path.resolve(repository, 'public/'+manifest[id].url));
const j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));const binStart=20+b.readUInt32LE(12)+8;
const prim=j.meshes[lod].primitives[0], ext=prim.extensions.KHR_draco_mesh_compression,bv=j.bufferViews[ext.bufferView];
const input=new Int8Array(b.buffer,b.byteOffset+binStart+(bv.byteOffset||0),bv.byteLength);
const buffer=new draco.DecoderBuffer();buffer.Init(input,input.byteLength);
const decoder=new draco.Decoder(), mesh=new draco.Mesh();const status=decoder.DecodeBufferToMesh(buffer,mesh);
if(!status.ok())throw Error(status.error_msg());
const attrs={};
for(const [key,uid] of Object.entries(ext.attributes)){
const attr=decoder.GetAttributeByUniqueId(mesh,uid),arr=new draco.DracoFloat32Array();
decoder.GetAttributeFloatForAllPoints(mesh,attr,arr);
const result=new Float32Array(mesh.num_points()*attr.num_components());
for(let i=0;i<result.length;i++)result[i]=arr.GetValue(i);attrs[key]=result;draco.destroy(arr);}
const idx=new Uint32Array(mesh.num_faces()*3),face=new draco.DracoInt32Array();for(let i=0;i<mesh.num_faces();i++){decoder.GetFaceFromMesh(mesh,i,face);for(let k=0;k<3;k++)idx[i*3+k]=face.GetValue(k);}
draco.destroy(face);draco.destroy(buffer);draco.destroy(mesh);draco.destroy(decoder);
return {id,entry:manifest[id],attrs,idx,boneNames:j.skins?.[0]?.joints.map(i=>j.nodes[i].name) ?? []};}
export function makeHumanoidRig(kind){const root=new THREE.Group(),m=kind==='Mortar';const r=buildHumanoid(root,{
hipY:m?.9:.86,hipX:m?.17:.12,thigh:m?.46:.44,legW:m?.22:.13,legColor:0,
torsoW:m?.66:.44,torsoH:m?.66:.60,torsoD:m?.44:.28,torsoColor:0,
shoulderX:m?.42:.29,shoulderY:m?.56:.52,upperArm:m?.32:.28,foreArm:m?.30:.27,armW:m?.18:.13,armColor:0,neckY:m?.7:.64});
const bp=manifest['SK_Enemy_'+kind].bindPose;applyBindPose(r,bp.armSpreadL,bp.armSpreadR);root.updateMatrixWorld(true);
const inv={};for(const k of HUMANOID_JOINTS)inv[k]=r[k].matrixWorld.clone().invert();
applyBindPose(r,0,0);return {root,r,inv};}
export function sampleRigPose(kind,obj,state,t,last,shotAge=Infinity,transformPose){
const {r}=obj,p={};applyWalk(r,0,0,0);if(kind==='Mortar')actions.sampleMortarPose(state,t,shotAge,last,p);else actions.sampleShamanPose(state,t,last,p);
if (transformPose) transformPose(p);
applyCrouch(r,p.crouch);r.torso.rotation.set(p.lean,p.twist,0);r.head.rotation.x=p.head;
const weapon=obj.weapon??(obj.weapon=new THREE.Group());r.torso.add(weapon);weapon.position.set(p.x,p.y,p.z);weapon.rotation.set(p.pitch,p.yaw,p.roll);
if(kind==='Mortar'){
applyMortarPalmGrips(obj, p);
}else{
if (state === 'ward') r.hips.position.y += Math.sin(THREE.MathUtils.clamp(t, 0, 1) * Math.PI * 2) * 0.012;
reachPalmGrip(r,-1,weapon,...actions.SHAMAN_STAFF_GRIP,new THREE.Vector3(.0197,-.0815,-.0079),new THREE.Vector3(-1,-.45,.12),p.staffForearmRoll);
reachArm(r,1,new THREE.Vector3(p.handX,p.handY,p.handZ),new THREE.Vector3(1,-.25,.25));
r.handL.rotation.set(THREE.MathUtils.clamp(p.handPitch,-.30,.30),THREE.MathUtils.clamp(p.handYaw,-.16,.16),THREE.MathUtils.clamp(p.handRoll,-.10,.10));
}obj.root.updateMatrixWorld(true);return p;}

/** Re-fit candidate surface grips without changing production constants or any mesh. */
export function applyMortarPalmGrips(obj, pose, rightGrip = actions.MORTAR_RIGHT_GRIP, leftGrip) {
  const support = new THREE.Vector3();
  if (leftGrip) support.set(leftGrip[0], pose.supportY, leftGrip[2]);
  else actions.mortarSupportGrip(pose, support);
  reachPalmGrip(obj.r, -1, obj.weapon, ...rightGrip, new THREE.Vector3(.0614, -.0406, .0234), new THREE.Vector3(-1, -.65, .15));
  reachPalmGrip(obj.r, 1, obj.weapon, support.x, support.y, support.z, new THREE.Vector3(-.0619, -.0415, .0254), new THREE.Vector3(1, -.65, .15));
  obj.root.updateMatrixWorld(true);
}

/** Apply the production aim compensation after base/recoil sampling and before palm IK. */
export function sampleAimedMortarPose(obj, state, progress, action, shotAge, aim, transformAimedPose) {
  return sampleRigPose('Mortar', obj, state, progress, action, shotAge, p => {
    if (action !== 'shell') return;
    const baseline = {};
    actions.sampleMortarPose(state, progress, Infinity, action, baseline);
    cannonAim.applyCannonAim(p, aim, state, progress, p.pitch - baseline.pitch);
    if (transformAimedPose) transformAimedPose(p);
  });
}
export function wristAngles(obj){return ['L','R'].map(s=>{
const hand=obj.r['hand'+s],q=hand.quaternion,v=new THREE.Vector3(0,-1,0).applyQuaternion(q);
const bend=Math.acos(THREE.MathUtils.clamp(v.dot(new THREE.Vector3(0,-1,0)),-1,1));
return {side:s,bendDeg:THREE.MathUtils.radToDeg(bend),totalDeg:THREE.MathUtils.radToDeg(q.angleTo(new THREE.Quaternion())),quat:q.toArray()};
});}

/** Actual palm contact and elbow bend after the final socket pose and production IK. */
export function mortarGripMetrics(obj, pose, rightGrip = actions.MORTAR_RIGHT_GRIP, leftGrip) {
  const support = new THREE.Vector3();
  if (leftGrip) support.set(leftGrip[0], pose.supportY, leftGrip[2]);
  else actions.mortarSupportGrip(pose, support);
  return [
    ['L', new THREE.Vector3(-.0619, -.0415, .0254), support.toArray()],
    ['R', new THREE.Vector3(.0614, -.0406, .0234), rightGrip],
  ].map(([side, offset, grip]) => {
    const actual = obj.r['hand' + side].localToWorld(offset);
    const target = obj.weapon.localToWorld(new THREE.Vector3(...grip));
    const shoulder = obj.r['arm' + side].getWorldPosition(new THREE.Vector3());
    const elbow = obj.r['elbow' + side].getWorldPosition(new THREE.Vector3());
    const wrist = obj.r['hand' + side].getWorldPosition(new THREE.Vector3());
    return {
      side,
      palmError: actual.distanceTo(target),
      elbowBendDeg: 180 - THREE.MathUtils.radToDeg(shoulder.sub(elbow).angleTo(wrist.sub(elbow))),
    };
  });
}
export function skinPositions(obj,asset){
const mats=asset.boneNames.map(k=>obj.r[k].matrixWorld.clone().multiply(obj.inv[k]));const {POSITION:pos,JOINTS_0:js,WEIGHTS_0:ws}=asset.attrs;
const out=new Float32Array(pos.length),v=new THREE.Vector3(),acc=new THREE.Vector3(),mapped=new THREE.Vector3();
for(let i=0;i<pos.length/3;i++){v.fromArray(pos,i*3);acc.set(0,0,0);for(let k=0;k<4;k++){const w=ws[i*4+k];if(w>0)acc.addScaledVector(mapped.copy(v).applyMatrix4(mats[js[i*4+k]]),w);}acc.toArray(out,i*3);}return out;
}
export function deformationByRegion(asset,posed,regionNames,vertexMask){
const pos=asset.attrs.POSITION,js=asset.attrs.JOINTS_0,ws=asset.attrs.WEIGHTS_0;
const region = new Uint8Array(pos.length/3);
const selected = regionNames ?? ['handL', 'handR'];
for(let i=0;i<region.length;i++)for(let k=0;k<4;k++)if(ws[i*4+k]>.15 && selected.includes(asset.boneNames[js[i*4+k]]) && (!vertexMask || vertexMask[i]))region[i]=1;
const distances=(buf,a,b)=>Math.hypot(buf[a*3]-buf[b*3],buf[a*3+1]-buf[b*3+1],buf[a*3+2]-buf[b*3+2]);
let severe=0,collapsed=0,max=0,ratio=[];
const va=new THREE.Vector3(),vb=new THREE.Vector3(),vc=new THREE.Vector3();
for(let i=0;i<asset.idx.length;i+=3){const [a,b,c]=asset.idx.slice(i,i+3);if(!region[a]&&!region[b]&&!region[c])continue;
let stretch=0;for(const [x,y] of [[a,b],[b,c],[c,a]])stretch=Math.max(stretch,distances(posed,x,y)/Math.max(1e-8,distances(pos,x,y)));
ratio.push(stretch);max=Math.max(max,stretch);if(stretch>2)severe++;
const area=(buf)=>{va.fromArray(buf,a*3);vb.fromArray(buf,b*3).sub(va);vc.fromArray(buf,c*3).sub(va);return vb.cross(vc).length();};
if(area(posed)/Math.max(1e-10,area(pos))<.15)collapsed++;
}
ratio.sort((a,b)=>a-b);return {triangles:ratio.length,maxEdgeRatio:max,p95EdgeRatio:ratio[Math.floor(ratio.length*.95)],p99EdgeRatio:ratio[Math.floor(ratio.length*.99)],severe2x:severe,collapsed15pct:collapsed};}

/** Weight data lets callers distinguish wrist triangles from cloth connected to the hips. */
export function vertexWeights(asset, i) {
  const js = asset.attrs.JOINTS_0, ws = asset.attrs.WEIGHTS_0;
  return Array.from({ length: 4 }, (_, k) => ({ bone: asset.boneNames[js[i * 4 + k]], weight: ws[i * 4 + k] }))
    .filter(({ weight }) => weight > 0.001);
}

/** Anatomical wrist/palm band at the terminal bone, excluding the outer wide sleeve. */
export function wristVertexMask(asset, rig) {
  const mask = new Uint8Array(asset.attrs.POSITION.length / 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < mask.length; i++) {
    for (const { bone, weight } of vertexWeights(asset, i)) {
      if (!/^hand[LR]$/.test(bone) || weight < 0.20) continue;
      p.fromArray(asset.attrs.POSITION, i * 3).applyMatrix4(rig.inv[bone]);
      if (p.y >= -0.11 && p.y <= 0.045 && Math.hypot(p.x, p.z) <= 0.115) mask[i] = 1;
    }
  }
  return mask;
}

/** Apply only the production skin-weight postprocessing to decoded GLB attributes. */
export function withArticulationWeights(asset, rig) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(asset.attrs.POSITION, 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(asset.attrs.JOINTS_0), 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(asset.attrs.WEIGHTS_0, 4));
  for (const [semantic, name, size] of [['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2], ['TANGENT', 'tangent', 4]]) {
    if (asset.attrs[semantic]) geometry.setAttribute(name, new THREE.BufferAttribute(asset.attrs[semantic], size));
  }
  geometry.setIndex(new THREE.BufferAttribute(asset.idx, 1));
  const corrected = articulationGeometry(asset.id, geometry, asset.boneNames, asset.boneNames.map(name => rig.inv[name]));
  return { ...asset, attrs: { ...asset.attrs, WEIGHTS_0: corrected.getAttribute('skinWeight').array }, geometry, corrected };
}

/** Vertices of the posed body inside a simple measured weapon shaft; an overlap diagnostic, not a collision mesh. */
export function shaftOverlaps(obj, asset, posed, radiusAt, yMin, yMax) {
  obj.weapon.updateWorldMatrix(true, false);
  const inverse = obj.weapon.matrixWorld.clone().invert();
  const point = new THREE.Vector3();
  const counts = {};
  for (let i = 0; i < posed.length / 3; i++) {
    point.fromArray(posed, i * 3).applyMatrix4(inverse);
    if (point.y < yMin || point.y > yMax || Math.hypot(point.x, point.z) >= radiusAt(point.y)) continue;
    const dominant = vertexWeights(asset, i).sort((a, b) => b.weight - a.weight)[0]?.bone;
    if (dominant) counts[dominant] = (counts[dominant] ?? 0) + 1;
  }
  return counts;
}

/** Actual weapon mesh parity. Requires a closed shell; edge coincidences are de-duplicated. */
export function weaponMeshOverlaps(obj, asset, posed, weaponAsset, boneFilter, minimumRayDepth = 0.003) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(weaponAsset.attrs.POSITION, 3));
  geo.setIndex(new THREE.BufferAttribute(weaponAsset.idx, 1));
  geo.computeBoundingBox();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const direction = new THREE.Vector3(0.617, 0.413, 0.671).normalize();
  const point = new THREE.Vector3();
  obj.weapon.updateWorldMatrix(true, false);
  const inverse = obj.weapon.matrixWorld.clone().invert();
  const counts = {};
  for (let i = 0; i < posed.length / 3; i++) {
    point.fromArray(posed, i * 3).applyMatrix4(inverse);
    if (!geo.boundingBox.containsPoint(point)) continue;
    const dominant = vertexWeights(asset, i).sort((a, b) => b.weight - a.weight)[0]?.bone;
    if (!dominant || (boneFilter && !boneFilter.includes(dominant))) continue;
    ray.set(point, direction);
    const hits = ray.intersectObject(mesh, false);
    if (hits.length === 0 || hits[0].distance < minimumRayDepth) continue;
    let crossings = 0, previous = -Infinity;
    for (const hit of hits) if (hit.distance - previous > 1e-5) { crossings++; previous = hit.distance; }
    if (crossings % 2 === 0) continue;
    if (dominant) counts[dominant] = (counts[dominant] ?? 0) + 1;
  }
  geo.dispose(); material.dispose();
  return counts;
}

/** Closest real triangle distance of terminal-bone vertices, with closed-shell penetration depth. */
const weaponContactCache = new WeakMap();
export function weaponSurfaceDepths(obj, asset, posed, weaponAsset, boneFilter = ['handL', 'handR'], vertexMask) {
  let cached = weaponContactCache.get(weaponAsset);
  if (!cached) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(weaponAsset.attrs.POSITION, 3));
    geometry.setIndex(new THREE.BufferAttribute(weaponAsset.idx, 1));
    geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const triangles = [];
    for (let j = 0; j < weaponAsset.idx.length; j += 3) {
      const triangle = new THREE.Triangle(...[0, 1, 2].map(k => new THREE.Vector3().fromArray(weaponAsset.attrs.POSITION, weaponAsset.idx[j + k] * 3)));
      triangles.push({ triangle, box: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]) });
    }
    cached = { geometry, mesh, triangles };
    weaponContactCache.set(weaponAsset, cached);
  }
  const { geometry, mesh, triangles } = cached;
  obj.weapon.updateWorldMatrix(true, false);
  const inverse = obj.weapon.matrixWorld.clone().invert();
  const ray = new THREE.Raycaster();
  const direction = new THREE.Vector3(0.617, 0.413, 0.671).normalize();
  const point = new THREE.Vector3(), nearest = new THREE.Vector3();
  const result = {};
  for (let i = 0; i < posed.length / 3; i++) {
    if (vertexMask && !vertexMask[i]) continue;
    const dominant = vertexWeights(asset, i).sort((a, b) => b.weight - a.weight)[0]?.bone;
    if (!boneFilter.includes(dominant)) continue;
    const out = result[dominant] ??= { vertices: 0, insideVertices: 0, maximumDepth: 0, sumDepth: 0, minimumSurfaceDistance: Infinity };
    out.vertices++;
    point.fromArray(posed, i * 3).applyMatrix4(inverse);
    let distanceSq = Infinity;
    for (const { triangle, box } of triangles) {
      const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
      const dy = Math.max(box.min.y - point.y, 0, point.y - box.max.y);
      const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
      if (dx * dx + dy * dy + dz * dz >= distanceSq) continue;
      triangle.closestPointToPoint(point, nearest);
      distanceSq = Math.min(distanceSq, point.distanceToSquared(nearest));
    }
    const distance = Math.sqrt(distanceSq);
    out.minimumSurfaceDistance = Math.min(out.minimumSurfaceDistance, distance);
    if (!geometry.boundingBox.containsPoint(point) || distance < 1e-6) continue;
    ray.set(point, direction);
    let crossings = 0, previous = -Infinity;
    for (const hit of ray.intersectObject(mesh, false)) {
      if (hit.distance - previous > 1e-5) { crossings++; previous = hit.distance; }
    }
    if (crossings % 2 === 0) continue;
    out.insideVertices++;
    out.maximumDepth = Math.max(out.maximumDepth, distance);
    out.sumDepth += distance;
  }
  for (const out of Object.values(result)) {
    out.meanDepth = out.sumDepth / Math.max(1, out.insideVertices);
    delete out.sumDepth;
  }
  return result;
}

/** Verify parity testing is valid after welding the GLB's UV/normal split vertices by position. */
export function closedMeshEdgeStats(asset) {
  const positions = asset.attrs.POSITION;
  const vertices = Array.from({ length: positions.length / 3 }, (_, i) =>
    Array.from(positions.slice(i * 3, i * 3 + 3)).map(n => Math.round(n * 100000)).join(','));
  const edges = new Map();
  for (let i = 0; i < asset.idx.length; i += 3) {
    for (const [a, b] of [[asset.idx[i], asset.idx[i + 1]], [asset.idx[i + 1], asset.idx[i + 2]], [asset.idx[i + 2], asset.idx[i]]]) {
      const key = [vertices[a], vertices[b]].sort().join('|');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return { open: [...edges.values()].filter(n => n === 1).length, nonManifold: [...edges.values()].filter(n => n > 2).length };
}

export function analyzePose(kind, state, progress, action, neutralWrists = false, repairWeights = false, shotAge = Infinity) {
  const source = loadPublishedMesh('SK_Enemy_' + kind);
  const rig = makeHumanoidRig(kind);
  const asset = repairWeights ? withArticulationWeights(source, rig) : source;
  const pose = sampleRigPose(kind, rig, state, progress, action, shotAge);
  if (neutralWrists) {
    rig.r.handL.quaternion.identity();
    rig.r.handR.quaternion.identity();
    rig.root.updateMatrixWorld(true);
  }
  const positions = skinPositions(rig, asset);
  return {
    asset, rig, positions, pose,
    wrists: wristAngles(rig),
    wristTriangles: deformationByRegion(asset, positions, ['handL', 'handR'], wristVertexMask(asset, rig)),
    sleeveTriangles: deformationByRegion(asset, positions, ['elbowL', 'elbowR']),
    shoulderTriangles: deformationByRegion(asset, positions, ['armL', 'armR']),
    // Cannon radius .176 measured at local y=.40, staff shaft .02 is a conservative baseline.
    shaft: shaftOverlaps(rig, asset, positions, kind === 'Mortar' ? () => 0.176 : () => 0.02,
      kind === 'Mortar' ? 0 : -0.68, kind === 'Mortar' ? 0.98 : 0.85),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  for (const [kind, state, t, action] of [
    ['Mortar', 'move', 0, 'shell'], ['Mortar', 'fire', 1, 'shell'],
    ['Mortar', 'smashWindup', 0.65, 'smash'], ['Mortar', 'smashWindup', 1, 'smash'],
    ['Shaman', 'move', 0, 'circle'], ['Shaman', 'castCircle', 1, 'circle'], ['Shaman', 'ward', 1, 'ward'],
  ]) for (const neutral of [false, true]) {
    const audit = analyzePose(kind, state, t, action, neutral);
    console.log(JSON.stringify({
      kind, state, progress: t, neutralWrists: neutral,
      wrists: audit.wrists, wristTriangles: audit.wristTriangles,
      sleeveTriangles: audit.sleeveTriangles, shoulderTriangles: audit.shoulderTriangles,
      shaftOverlaps: audit.shaft,
    }));
  }
}
