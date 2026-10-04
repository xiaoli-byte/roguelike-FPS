// node art/tools/audit_setdressing.mjs SM_Env_MarketStall [--published]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IDS, repository, readJson, current, loadSetdressing, measureSetdressing } from './setdressing_geometry.mjs';
const id=process.argv[2]; if(!IDS.includes(id))throw new Error('Select one of '+IDS.join(', '));
const published=process.argv.includes('--published'), asset=loadSetdressing(id,published);
const source=`art/source/props/${id}/`, state=asset.state, measured=measureSetdressing(asset);
const hash=file=>createHash('sha256').update(fs.readFileSync(path.resolve(repository,file))).digest('hex');
const stages=['blockout','concept','highpoly','build','validate','review'].filter(stage=>state.stages[stage]?.current);
const files=stages.flatMap(stage=>Object.values(current(state,stage).files).map(file=>({stage,path:source+file.path,sha256:file.sha256,verified:hash(source+file.path)===file.sha256})));
const manifest=readJson('public/assets/manifest.json'), previous=readJson('art/reviews/authored-scenes-setdressing-20261004/before-manifest.json');
const changedExistingAssets=Object.keys(previous.assets).filter(key=>JSON.stringify(previous.assets[key])!==JSON.stringify(manifest.assets[key]));
const concept=current(state,'concept'), highpoly=current(state,'highpoly'), review=state.stages.review?.current?current(state,'review'):null;
const structureDir=`art/reviews/authored-scenes-setdressing-20261004/${id}-structure-v${String(current(state,'build').version).padStart(3,'0')}`;
const structureReview=fs.existsSync(path.resolve(repository,structureDir,'evidence.json'))?readJson(`${structureDir}/evidence.json`):null;
if(structureReview)structureReview.images=structureReview.files.map(file=>({path:path.relative(repository,file).replaceAll('\\','/'),sha256:hash(file)}));
const report={created:new Date().toISOString(),id,published,geometryFile:asset.file,sourceOnlyLocalHunyuan:true,artisticMeshCreatedProcedurally:false,
  sourceStages:Object.fromEntries(stages.map(stage=>[stage,current(state,stage)])),
  exactPrompt:source+Object.values(concept.files).find(f=>f.path.endsWith('_prompt.txt')).path,
  conceptSource:source+Object.values(concept.files).find(f=>f.path.includes('_source.')).path,
  conceptSheet:source+Object.values(concept.files).find(f=>f.path.endsWith('_sheet.png')).path,
  workflow:source+Object.values(highpoly.files).find(f=>f.path.endsWith('_graph.json')).path,
  reviewSheet:review?source+Object.values(review.files).find(f=>f.path.endsWith('.png')).path:null,
  measured,structureReview,checkedLocalFiles:files,changedExistingAssets,
  manifestEntry:published?manifest.assets[id]:null,
  publishedHashVerified:published?hash(asset.file)===manifest.assets[id].sha256:null,
  sourceFrontDirection:[0,0,1],runtimeFit:'Use production architectureMatrix: all-LOD bounds, uniform scale, center X/Z, minimum Y at placement base.',
  limitations:['Single static prop, no moving-part rig or new collision in this asset.','Ray sections sample actual surfaces but do not alone prove all surfaces or every support are intact; use the finished review sheet too.','AI visual acceptance and automatic QA do not constitute user acceptance or a scene FPS benchmark.']};
if(files.some(f=>!f.verified)||changedExistingAssets.length||report.publishedHashVerified===false)throw new Error('Hash/provenance or existing manifest entry changed');
const out=path.resolve(repository,`art/reviews/authored-scenes-setdressing-20261004/${id}-${published?'published':'build'}-audit.json`);
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n'); asset.dispose();
console.log(JSON.stringify({output:out,published,bytes:manifest.assets[id]?.bytes,measured,verifiedFiles:files.length,changedExistingAssets},null,2));
