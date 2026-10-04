// Read-only real-mesh visibility sampling; this does not generate or alter art.
// node art/tools/audit_authored_boundary.mjs --plans desert-1,frost-3,inferno-3 --height 1.62 --out art/reviews/authored-scenes-20261004/boundary-visibility-eye.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadPublishedMesh } from './pose_geometry_audit.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = { plans: 'desert-1,frost-3,inferno-3', height: '1.2', out: 'art/reviews/authored-scenes-20261004/boundary-visibility-after.json' };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].slice(2);
  if (!(key in options) || !process.argv[i + 1]) throw new Error('Usage: --plans desert-1,frost-3,inferno-3 --height 1.2 --out path.json');
  options[key] = process.argv[i + 1];
}
const height = Number(options.height);
if (!Number.isFinite(height) || height < 0) throw new Error('--height must be a non-negative number of metres above floorY');
const sources = {}, data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function ts(file, imports = {}) {
  const raw = fs.readFileSync(path.resolve(repository, file), 'utf8');
  sources[file] = createHash('sha256').update(raw).digest('hex');
  let source = stripTypeScriptTypes(raw, { mode: 'transform' });
  for (const [specifier, url] of Object.entries({ three: pathToFileURL(path.resolve(repository, 'node_modules/three/build/three.module.js')).href, ...imports })) {
    source = source.replaceAll("'" + specifier + "'", "'" + url + "'").replaceAll('"' + specifier + '"', '"' + url + '"');
  }
  return data(source);
}
const plansModule = ts('src/world/WhiteboxPlans.ts');
const { WHITEBOX_PLANS } = await import(plansModule);
const { generateWhitebox } = await import(ts('src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansModule }));
const { buildAuthoredSceneLayout } = await import(ts('src/world/AuthoredSceneLayout.ts'));
const { architectureAssetBounds, architectureMatrix } = await import(ts('src/world/SceneArchitecture.ts', {
  '../assets/AssetLibrary': data('export const AssetLibrary={get(){return null},preload(){return Promise.resolve()}}'),
  '../assets/ArtEnvironment': data('export function applyArtEnvironment(){}'),
  './SceneSurfaceMaterial': data('export function applyHandPaintedEnvironment(){}'),
}));
const manifest = JSON.parse(fs.readFileSync(path.resolve(repository, 'public/assets/manifest.json'), 'utf8')).assets;
const assets = new Map(), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function asset(id) {
  if (assets.has(id)) return assets.get(id);
  const bytes = fs.readFileSync(path.resolve(repository, 'public/' + manifest[id].url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  function matrix(index) {
    const node = gltf.nodes[index], local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else local.compose(new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]), new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const parent = gltf.nodes.findIndex(n => n.children?.includes(index));
    return parent < 0 ? local : matrix(parent).multiply(local);
  }
  const lods = gltf.nodes.map((n, i) => ({ ...n, index: i })).filter(n => /_LOD\d+$/.test(n.name)).sort((a, b) => a.name.localeCompare(b.name)).map(node => {
    const decoded = loadPublishedMesh(id, node.mesh), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(decoded.attrs.POSITION, 3));
    geometry.setIndex(new THREE.BufferAttribute(decoded.idx, 1)); geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, material); mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix(node.index)); mesh.updateMatrixWorld(true); return mesh;
  });
  if (!lods.length) throw new Error('No LOD nodes: ' + id);
  const result = { lods, bounds: architectureAssetBounds(lods) }; assets.set(id, result); return result;
}
const maps = [];
for (const planId of options.plans.split(',')) {
  const plan = WHITEBOX_PLANS.find(p => p.id === planId);
  if (!plan) throw new Error('Unknown plan: ' + planId);
  const level = generateWhitebox({ type: plan.index === 5 ? 'boss' : 'combat', theme: plan.chapter, index: plan.index - 1, reward: 'coins' });
  const layout = buildAuthoredSceneLayout(level);
  const placements = layout.placements.map((placement, index) => {
    const { lods, bounds } = asset(placement.assetId), source = lods[Math.min(1, lods.length - 1)];
    const mesh = new THREE.Mesh(source.geometry, material); mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(architectureMatrix(source, placement, bounds)); mesh.updateMatrixWorld(true);
    return { placement, index, mesh, box: source.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld) };
  });
  const ray = new THREE.Raycaster(), point = new THREE.Vector3(), samples = [], groups = [];
  ray.near = 0; ray.far = 20;
  let triangleCandidateCount = 0;
  for (const boundary of layout.boundaries) {
    const count = Math.max(1, Math.ceil(boundary.length / 2)), local = [];
    for (let i = 0; i < count; i++) {
      const t = (i + .5) / count, x = boundary.a.x + (boundary.b.x - boundary.a.x) * t, z = boundary.a.z + (boundary.b.z - boundary.a.z) * t;
      ray.set(new THREE.Vector3(x - boundary.outward.x * .4, level.floorY + height, z - boundary.outward.z * .4), new THREE.Vector3(boundary.outward.x, 0, boundary.outward.z).normalize());
      let hit = null;
      for (const p of placements) {
        if (!p.box.containsPoint(ray.ray.origin) && (!ray.ray.intersectBox(p.box, point) || point.distanceTo(ray.ray.origin) > 20)) continue;
        triangleCandidateCount++;
        const candidate = ray.intersectObject(p.mesh, false)[0];
        if (candidate && (!hit || candidate.distance < hit.distance)) hit = { distance: candidate.distance, assetId: p.placement.assetId, role: p.placement.role, placement: p.index, point: candidate.point.toArray(), boundaryId: p.placement.boundaryId ?? null };
      }
      const status = !hit ? 'missing20' : hit.distance > 8 ? 'beyond8' : hit.distance > 2.4 ? 'setback' : 'near';
      const nearestRoom = plan.rooms.map(r => ({ id: r.id, label: r.label, d: Math.hypot(x - (r.labelAt[0] - plan.bounds[0] / 2), z - (r.labelAt[1] - plan.bounds[1] / 2)) })).sort((a, b) => a.d - b.d)[0];
      const sample = { boundaryId: boundary.id, edgeLength: boundary.length, worldBoundary: [x, z], planBoundary: [x + plan.bounds[0] / 2, z + plan.bounds[1] / 2], origin: ray.ray.origin.toArray(), outward: boundary.outward, status, nearestRoom, hit };
      samples.push(sample); local.push(sample);
    }
    groups.push({ boundaryId: boundary.id, length: boundary.length, a: boundary.a, b: boundary.b, outward: boundary.outward, samples: count, noHitWithin8: local.filter(s => ['missing20', 'beyond8'].includes(s.status)).length, setback: local.filter(s => s.status === 'setback').length, near: local.filter(s => s.status === 'near').length, worstDistance: Math.max(...local.map(s => s.hit?.distance ?? 20)), nearestRoom: local[0].nearestRoom.label, example: local.find(s => s.status !== 'near') ?? local[0] });
  }
  const counts = { near: 0, setback: 0, beyond8: 0, missing20: 0 }, metresByStatus = { ...counts };
  const sampleCounts = new Map(groups.map(g => [g.boundaryId, g.samples]));
  for (const s of samples) { counts[s.status]++; metresByStatus[s.status] += s.edgeLength / sampleCounts.get(s.boundaryId); }
  const estimatedBoundaryMetres = Object.values(metresByStatus).reduce((a, b) => a + b, 0);
  maps.push({ planId, title: plan.title, placements: placements.length, boundaries: layout.boundaries.length, samples: samples.length, counts, noHitWithin8Fraction: (counts.beyond8 + counts.missing20) / samples.length, triangleCandidateCount, risks: groups.filter(g => g.noHitWithin8 || g.setback).sort((a, b) => b.noHitWithin8 - a.noHitWithin8 || b.length - a.length), sampleResults: samples, lengthWeighted: { estimatedBoundaryMetres, metresByStatus, noHitWithin8Fraction: (metresByStatus.beyond8 + metresByStatus.missing20) / estimatedBoundaryMetres, notes: 'Each sample represents its segment length divided by sample count; midpoint quadrature, not continuous mesh coverage.' } });
}
const report = { created: new Date().toISOString(), method: {
  heightM: height, insetInsideFloorM: .4, maxRayM: 8, extendedDiagnosticMaxRayM: 20, maxSampleSpacingM: 2, lod: 1,
  geometry: 'Actual decoded published Draco LOD1; production architectureMatrix using actual all-LOD bounds; double-sided visibility.',
  nearbyPrefilter: 'World transformed actual mesh bounding box intersects ray within 20 m before triangles.',
  riskThreshold: 'A hit more than 2.4 m from start is >2 m behind collision boundary; report as setback.',
  limitations: [
    `Single outward horizontal ray per sample; missing at ${height} m signals collision readability risk, not proof the area is visually open at every height or angle.`,
    'Gate openings, deliberate vistas, roofs and low props can count as missing although a different view may communicate the boundary.',
    'Only layout.placements art meshes are audited; decks, technical backing/closure surfaces, ground, lighting and particles are excluded.',
    'Collision and floor polygons are unchanged; this does not prove reachable out-of-bounds or navigation defects.',
    'Short raster step edges receive one midpoint each; use lengthWeighted for map comparisons rather than unweighted sample percentages.',
  ], sourceSha256: sources, assetSha256: Object.fromEntries([...assets.keys()].map(id => [id, manifest[id].sha256])),
}, maps };
const output = path.resolve(repository, options.out); fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, heightM: height, maps: maps.map(m => ({ planId: m.planId, placements: m.placements, samples: m.samples, counts: m.counts, lengthWeightedNoHitWithin8: m.lengthWeighted.noHitWithin8Fraction })) }, null, 2));
