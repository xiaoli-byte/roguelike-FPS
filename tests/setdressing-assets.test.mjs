// 现行发布契约（art/README.md，2026-10-25 起）：每个资产只有一级 LOD（<资产ID>_LOD0），不减面，面数只记录、不是闸门。
// art/tools/setdressing_geometry.mjs 的 loadSetdressing 写死读三级 LOD，这里改用 tests/published-glb.mjs 读实际发布的那一级，
// 量体量的 measureSetdressing 照用。删掉的断言：LOD1 / LOD2 的面数预算（5000 / 1600 / 500）、跨 LOD 的轮廓漂移（< 8%）。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { IDS, repository, readJson, current, measureSetdressing } from '../art/tools/setdressing_geometry.mjs';
import { loadPublished, singleLodViolations, toGeometry } from './published-glb.mjs';

/** 发布的 GLB → measureSetdressing 要的 { id, meshes }（每级一个已套上节点变换的 Mesh）。 */
async function publishedSetdressing(id) {
  const asset = await loadPublished(id);
  assert.deepEqual(singleLodViolations(asset), []);
  const meshes = asset.lods.map(({ primitives, matrix }) => {
    assert.equal(primitives.length, 1, `${id}: one material, one primitive`);
    const geometry = toGeometry(primitives[0]).applyMatrix4(matrix); geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true); return mesh;
  });
  return { id, meshes, dispose() { for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); } } };
}

for(const id of IDS){
  test(`${id} preserves native concept provenance and published local Hunyuan geometry`,()=>{
    const source=`art/source/props/${id}/`,state=readJson(source+'asset.json'),entry=readJson('public/assets/manifest.json').assets[id];
    const hash=file=>createHash('sha256').update(fs.readFileSync(path.resolve(repository,file))).digest('hex');
    assert.ok(entry); assert.equal(entry.generator.mode,'multiview');
    assert.equal(entry.generator.checkpoint,'hunyuan3d-dit-v2-mv_fp16.safetensors');
    assert.equal(current(state,'blockout').geometry_created,false);
    assert.equal(current(state,'concept').generator,'Codex built-in image_gen');
    assert.equal(current(state,'concept').review.verdict,'approved');
    assert.equal(current(state,'review').review.verdict,'approved');
    assert.equal(current(state,'review').review.by,'Codex AI visual review');
    assert.equal(current(state,'validate').passed,true); assert.deepEqual(current(state,'validate').waived,[]);
    assert.equal(hash(`public/${entry.url}`),entry.sha256); assert.ok(entry.bytes<900*1024);
    const conceptFiles=Object.values(current(state,'concept').files);
    assert.ok(conceptFiles.some(file=>file.path.endsWith('_prompt.txt')));
    assert.ok(conceptFiles.some(file=>file.path.endsWith('_source.png')));
    for(const file of conceptFiles)assert.match(file.sha256,/^[a-f0-9]{64}$/);
    const highpolyFiles=Object.values(current(state,'highpoly').files);
    const graph=highpolyFiles.find(file=>file.path.endsWith('_graph.json'));
    assert.ok(graph,'exact submitted local workflow is kept in the repository');
    assert.equal(hash(source+graph.path),graph.sha256);
    if(process.env.ART_LOCAL_SOURCE_AUDIT==='1'){
      for(const file of [...conceptFiles,...highpolyFiles])assert.equal(hash(source+file.path),file.sha256);
    }
    for(const view of Object.values(current(state,'concept').registration)){
      assert.ok(view.source_foreground_coverage>=.995);
      if(id==='SM_Env_FrozenSkiff')assert.equal(view.native_alpha_preserved,true,'snow needs source alpha rather than a white background key');
    }
  });
  test(`${id} published single LOD retains volume and readable structural parts`,async()=>{
    const asset=await publishedSetdressing(id);
    try{
      const measured=measureSetdressing(asset);
      assert.equal(measured.lods.length,1);
      for(const lod of measured.lods){
        assert.ok(lod.triangles>0);
        assert.ok(Math.abs(lod.min[1])<.035,`LOD${lod.lod}: detached ground support ${lod.min[1]}`);
        assert.ok(lod.absoluteSignedVolume>.05,`LOD${lod.lod}: no meaningful closed volume`);
        assert.ok(lod.largestComponentTriangleFraction>.98,`LOD${lod.lod}: disconnected major structure`);
        if(id==='SM_Env_MarketStall'){
          assert.ok(lod.size[0]>3 && lod.size[1]>2.6 && lod.size[2]>1.8,'stall cannot collapse to a facade');
          assert.ok(lod.canopySections.every(s=>s.roofThickness>.04),'canopy needs actual thickness');
          assert.ok(lod.servingOpening.some(s=>s.frontSetback===null||s.frontSetback>.2),'serving front must retain an opening');
        }else if(id==='SM_Env_FrozenSkiff'){
          assert.ok(lod.size[0]>1.7 && lod.size[1]>1.3 && lod.size[2]>3.2,'boat needs full-width deep hull');
          assert.ok(lod.hullSections.some(s=>s.centreRecess>.18),'boat must retain an actual recessed inner cabin');
          const floor=lod.hullSections.map(s=>s.line[2]).filter(p=>p.top!==null);
          assert.ok(floor.length>=4 && floor.every(p=>p.shellThickness>.035),'intact hull/seat sections need actual thickness');
        }else{
          assert.ok(lod.size.every(v=>v>1.5),'cart must retain three-dimensional tub/chassis');
          assert.ok(lod.wheelSections.every(s=>s.extent>.35),'both side wheels need actual volume');
          assert.ok(lod.tubSection.every(s=>s.extent>.7),'tub must retain volume above the chassis');
        }
      }
    }finally{asset.dispose();}
  });
}
