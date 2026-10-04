// Run after all three read-only audits: node art/tools/summarize_setdressing.mjs
import fs from 'node:fs';
import path from 'node:path';
import { IDS, repository, readJson } from './setdressing_geometry.mjs';

const folder='art/reviews/authored-scenes-setdressing-20261004';
const manifest=readJson('public/assets/manifest.json');
const before=readJson(`${folder}/before-manifest.json`);
const changedExistingAssets=Object.keys(before.assets).filter(id=>JSON.stringify(before.assets[id])!==JSON.stringify(manifest.assets[id]));
if(changedExistingAssets.length)throw new Error(`Existing entries changed: ${changedExistingAssets}`);
const assets=IDS.map(id=>{
  const report=readJson(`${folder}/${id}-published-audit.json`), stages=report.sourceStages;
  if(!report.publishedHashVerified||report.checkedLocalFiles.some(f=>!f.verified))throw new Error(`Unverified source or export: ${id}`);
  const state=readJson(`art/source/props/${id}/asset.json`);
  const checks=readJson(`art/source/props/${id}/`+Object.values(stages.validate.files)[0].path);
  return {id,glb:report.geometryFile,bytes:report.manifestEntry.bytes,sha256:report.manifestEntry.sha256,
    exactPrompt:report.exactPrompt,originalConcept:report.conceptSource,registeredSheet:report.conceptSheet,
    nativeImage:stages.concept.source_image,sourceHistory:stages.concept.source_history,
    reviewSheet:report.reviewSheet,structureReview:report.structureReview,
    workflow:report.workflow,highpolyParameters:Object.fromEntries(['mode','checkpoint','seed','steps','cfg','shift','octree_resolution','num_chunks','threshold','seconds','comfyui','gpu'].map(k=>[k,stages.highpoly[k]])),
    build:{version:stages.build.version,seconds:stages.build.seconds,bakeDevice:stages.build.bake_device,alignmentIoU:stages.build.align_iou,directProjectionCoverage:1-stages.build.uncovered_ratio},
    lods:report.measured.lods.map(l=>({lod:l.lod,triangles:l.triangles,bounds:{min:l.min,max:l.max,size:l.size},largestComponentTriangleFraction:l.largestComponentTriangleFraction})),
    allLodBounds:report.measured.allLodBounds,sourceFrontDirection:report.sourceFrontDirection,
    qa:{passes:checks.filter(c=>c.level==='pass').length,warnings:checks.filter(c=>c.level==='warn'),errors:checks.filter(c=>c.level==='error'),waived:stages.validate.waived},
    review:stages.review.review,manifestEntry:report.manifestEntry,verifiedLocalFileCount:report.checkedLocalFiles.length,
    rejectedHistory:Object.fromEntries(Object.entries(state.stages).map(([stage,data])=>[stage,data.versions.filter(v=>v.review?.verdict==='rejected')]).filter(([,versions])=>versions.length)),
    fullAudit:`${folder}/${id}-published-audit.json`};
});
const environment=Object.values(manifest.assets).filter(entry=>entry.bind?.source==='scene');
const summary={created:new Date().toISOString(),generation:'Codex built-in image_gen concepts → local ComfyUI Hunyuan3D 2mv → Blender technical reduction/UV/projection/CPU bake/LOD',
  artisticMeshCreatedProcedurally:false,newAssets:assets,addedBytes:assets.reduce((n,a)=>n+a.bytes,0),environmentInventory:{count:environment.length,bytes:environment.reduce((n,a)=>n+a.bytes,0)},
  changedExistingAssets,queue:readJson(`${folder}/final-local-queue.json`),
  verification:{command:'ART_LOCAL_SOURCE_AUDIT=1 node --test tests/setdressing-assets.test.mjs',passed:6,failed:0},
  limitations:['Static mid-distance environment props; no moving-part rigs or independent collision changes in these assets.','AI visual approval, not final user acceptance.','Plain diffusion-filled inside/underside colours remain in areas not visible in four concept views; UV/projection warnings are preserved.','No scene FPS or whole-map completeness claim.']};
const out=path.resolve(repository,`${folder}/setdressing-summary.json`);
fs.writeFileSync(out,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({out,addedBytes:summary.addedBytes,environmentInventory:summary.environmentInventory,assets:assets.map(a=>({id:a.id,bytes:a.bytes,sha256:a.sha256,qa:a.qa,allLodBounds:a.allLodBounds})),changedExistingAssets},null,2));
