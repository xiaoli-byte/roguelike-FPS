// Tripo hero integration: published runtime assets, native-skeleton grip rig, and fallback choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { Vector3, Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
// v2 heroes (docs/art/hero-roster-v2.md): internal ids unchanged — fox = 燎, falcon = 鼯, bear = 磐
const ASSET = { fox: 'SK_Hero_RedPanda', falcon: 'SK_Hero_FlyingSquirrel', bear: 'SK_Hero_Pangolin' };
const DESIGN_HEIGHT = { fox: 1.55, falcon: 1.6, bear: 1.95 };
const root = new URL('../', import.meta.url);

// nativeTripo.ts imports its show modules without extensions (bundler resolution): Node can't load that graph from
// src directly, so strip the types into tests/.cache/ (inside the repo, so 'three' still resolves) and stub the asset
// library (it starts preloading on import).
async function loadNativeTripo() {
  const out = new URL('tests/.cache/native/', root);
  await mkdir(out, { recursive: true });
  const files = { nativeTripo: 'src/ui/heroPreview/heroes/nativeTripo.ts', heroShows: 'src/ui/heroPreview/heroes/heroShows.ts',
    heroShowFx: 'src/ui/heroPreview/heroes/heroShowFx.ts', SpringChain: 'src/assets/SpringChain.ts' };
  const stubLib = `data:text/javascript;base64,${Buffer.from('export const AssetLibrary={findAttachments:()=>[]};').toString('base64')}`;
  for (const [name, path] of Object.entries(files)) {
    let s = stripTypeScriptTypes(await readFile(new URL(path, root), 'utf8'), { mode: 'transform' });
    s = s.replaceAll("'./heroShows'", "'./heroShows.mjs'").replaceAll("'./heroShowFx'", "'./heroShowFx.mjs'")
      .replaceAll("'../../../assets/SpringChain'", "'./SpringChain.mjs'").replaceAll("'../../../assets/AssetLibrary'", `'${stubLib}'`);
    await writeFile(new URL(`${name}.mjs`, out), s);
  }
  return import(new URL('nativeTripo.mjs', out).href);
}
const { createNativeHero, NATIVE_HERO_IDS } = await loadNativeTripo();
const manifest = JSON.parse(await readFile(new URL('public/assets/manifest.json', root), 'utf8'));

function parseGlb(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const len = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + len).toString('utf8'));
}

for (const id of NATIVE_HERO_IDS) test(`${id}: published Tripo asset matches the runtime contract`, async () => {
  const asset = ASSET[id];
  const entry = manifest.assets[asset];
  assert.ok(entry, `${asset} missing from manifest`);
  assert.deepEqual(entry.bind, { source: 'hero', id });
  assert.equal(entry.kind, 'skeletal');
  assert.equal(entry.skeleton?.mode, 'native');
  assert.equal(entry.rig, undefined, 'native heroes must not carry a parts-rig remap');
  const bytes = await readFile(new URL(`public/${entry.url}`, root));
  assert.equal(entry.bytes, bytes.length);
  assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(bytes.length <= 3200 * 1024, 'hero_display file budget');
  const j = parseGlb(bytes);
  assert.ok(j.extensionsRequired.includes('KHR_draco_mesh_compression'));
  assert.ok(j.extensionsRequired.includes('EXT_texture_webp'));
  const nodes = j.nodes.filter(n => /_LOD\d$/.test(n.name ?? '')).map(n => n.name).sort();
  assert.deepEqual(nodes, [0, 1, 2].map(i => `${asset}_LOD${i}`));
  const tris = nodes.map(n => j.meshes[j.nodes.find(x => x.name === n).mesh].primitives
    .reduce((s, p) => s + j.accessors[p.indices].count / 3, 0));
  assert.ok(tris[0] <= 16000 && tris[1] < tris[0] && tris[2] < tris[1] && tris[2] <= 2400, `LOD tris ${tris}`);
  assert.equal(j.skins.length, 1);
  assert.ok(j.nodes.filter(n => /_LOD\d$/.test(n.name ?? '')).every(n => n.skin === 0), 'all LODs share one skeleton');
  // v2 builds drop the "mixamorig:" prefix (nativeTripo.ts strips it either way) and add tail / ear bones
  const joints = new Set(j.skins[0].joints.map(i => j.nodes[i].name.replace(/^mixamorig[:_]?/, '')));
  for (const b of ['Hips', 'Spine1', 'Spine2', 'Neck', 'Head', 'RightArm', 'RightForeArm', 'RightHand', 'LeftHandThumb4', 'RightHandPinky3'])
    assert.ok(joints.has(b), `missing ${b}`);
  assert.ok(j.images.length >= 2 && j.images.every(i => i.mimeType === 'image/webp'), 'webp textures');
  const mat = j.materials[0];
  assert.ok(mat.pbrMetallicRoughness.baseColorTexture && mat.pbrMetallicRoughness.metallicRoughnessTexture && mat.occlusionTexture);
  const h = entry.bounds.max[1] - entry.bounds.min[1];
  assert.ok(Math.abs(h - DESIGN_HEIGHT[id]) < 0.02, `height ${h}`);
  assert.ok(Math.abs(entry.bounds.min[1]) < 0.01, 'feet on the ground');
});

// The published GLBs are Draco-compressed (browser worker decoder). The grip rig is exercised on the
// uncompressed source export, which carries the identical Tripo skeleton and skin.
for (const id of NATIVE_HERO_IDS) test(`${id}: native bind, reachable hands and finite deformation`, async (t) => {
  const source = new URL(`art/source/characters/${ASSET[id]}/03_model/tripo_p2_rigged_original.glb`, root);
  try { await access(source); } catch { t.skip('source export not present on this machine'); return; }
  const bytes = await readFile(source);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  const rig = createNativeHero(id, gltf.scene, { height: DESIGN_HEIGHT[id] });
  assert.ok(rig);
  assert.ok(Math.abs(rig.height - DESIGN_HEIGHT[id]) < 1e-6);
  const meshes = [], bones = [];
  rig.root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); if (o.isBone) bones.push(o); });
  assert.ok(bones.length >= 65);
  assert.equal(meshes.length, 1);
  const translations = bones.map(b => b.position.clone());
  const stage = new Group(); stage.position.set(2, -.4, 1); stage.scale.setScalar(.94); stage.rotation.y = -.7; stage.add(rig.root);
  rig.root.rotation.y = 1.2;
  rig.playIntro();
  const headQ = [];
  for (let frame = 0; frame < 100; frame++) {
    rig.update(1 / 60, frame / 60);
    for (const side of ['Right', 'Left']) {
      assert.ok(rig.root.userData.gripAudit[side].wristError < .001, `${id} ${side} misses wrist target`);
      assert.ok(rig.root.userData.gripAudit[side].knuckleError < .001, `${id} ${side} misses palm contact`);
    }
    bones.forEach((b, i) => assert.ok(b.position.distanceTo(translations[i]) < 1e-9, 'bone length changed'));
    if (frame % 30 === 0) headQ.push(bones.find(b => /Head$/.test(b.name)).quaternion.clone());
  }
  assert.ok(headQ[0].angleTo(headQ[3]) > 1e-3, 'idle animation moves the head');
  const feet = bones.filter(b => /(Left|Right)Foot$/.test(b.name)).map(b => b.getWorldPosition(new Vector3()));
  rig.update(1 / 60, 3.7);
  bones.filter(b => /(Left|Right)Foot$/.test(b.name)).forEach((b, i) =>
    assert.ok(b.getWorldPosition(new Vector3()).distanceTo(feet[i]) < 1e-6, 'idle must not slide the feet'));
  for (const mesh of meshes) {
    mesh.skeleton.update();
    const p = new Vector3();
    const weights = mesh.geometry.getAttribute('skinWeight'), index = mesh.geometry.getAttribute('skinIndex');
    for (let i = 0; i < weights.count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      assert.ok(p.toArray().every(Number.isFinite));
      assert.ok(p.distanceTo(stage.position) < 6, 'exploded skin');
    }
    let chestFront = -Infinity;
    for (let i = 0; i < weights.count; i++) {
      let torso = 0;
      for (let s = 0; s < 4; s++) if (/Spine/.test(mesh.skeleton.bones[index.getComponent(i, s)].name)) torso += weights.getComponent(i, s);
      if (torso < .7) continue;
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld); rig.root.worldToLocal(p);
      if (Math.abs(p.y - rig.hand.position.y) < .13) chestFront = Math.max(chestFront, p.z);
    }
    assert.ok(Number.isFinite(chestFront));
    assert.ok(rig.hand.position.z - chestFront > .045, `${id}: receiver too close to chest`);
  }
  const sibling = createNativeHero(id, gltf.scene, { height: DESIGN_HEIGHT[id] });
  const siblingBones = []; sibling.root.traverse(o => { if (o.isBone) siblingBones.push(o); });
  assert.ok(bones.every((b, i) => b !== siblingBones[i]), 'instances share bones');
  assert.ok(rig.materials.every(m => !sibling.materials.includes(m)), 'instances share fade materials');
  const gun = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  let gunDisposed = false, bodyDisposed = false;
  gun.geometry.addEventListener('dispose', () => { gunDisposed = true; });
  meshes[0].geometry.addEventListener('dispose', () => { bodyDisposed = true; });
  rig.hand.add(gun);
  rig.dispose();
  assert.equal(gunDisposed, false, 'hero disposal released a shared gun');
  assert.equal(bodyDisposed, false, 'hero disposal released shared asset geometry');
  sibling.update(1 / 60, 1); sibling.dispose(); gun.geometry.dispose(); gun.material.dispose();
});

test('native rig refuses templates without a Mixamo skeleton', () => {
  const g = new Group(); g.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  assert.equal(createNativeHero('fox', g), null);
});

// Model selection in heroes/index.ts with its art sources stubbed.
const dataModule = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
async function selector(asset, native) {
  let s = stripTypeScriptTypes(await readFile(new URL('src/ui/heroPreview/heroes/index.ts', root), 'utf8'), { mode: 'transform' });
  const stubs = {
    './fox': dataModule("export const buildFoxModel=()=>({kind:'procedural'});"),
    './falcon': dataModule("export const buildFalconModel=()=>({kind:'procedural'});"),
    './bear': dataModule("export const buildBearModel=()=>({kind:'procedural'});"),
    './placeholder': dataModule("export const buildPlaceholderHero=()=>({kind:'placeholder'});"),
    '../../../assets/AssetLibrary': dataModule(`export const AssetLibrary={findBound:()=>(${JSON.stringify(asset)})};`),
    './artBody': dataModule("export const withHeroArt=(r)=>({kind:'parts-art'});"),
    './nativeTripo': dataModule(`export const createNativeHero=(id,scene,o)=>{${native}};`),
  };
  for (const [k, v] of Object.entries(stubs)) s = s.replaceAll(`'${k}'`, `'${v}'`);
  return (await import(dataModule(s))).buildHeroModel;
}
const nativeAsset = { id: 'SK_Hero_Fox', gltf: { scene: {} }, entry: { skeleton: { mode: 'native' }, lodDistance: [0, 10, 24], bounds: { min: [0, 0, 0], max: [0, 1.9, 0] } } };
test('hero model selection: native art, then procedural fallback', async () => {
  assert.equal((await selector(nativeAsset, "return {kind:'native',h:o.height};"))('fox').kind, 'native');
  assert.equal((await selector(nativeAsset, "return {kind:'native',h:o.height};"))('fox').h, 1.9);
  assert.equal((await selector(null, "throw new Error('unused')"))('fox').kind, 'procedural', 'asset not loaded');
  assert.equal((await selector(nativeAsset, 'return null;'))('fox').kind, 'procedural', 'skeleton rejected');
  const warn = console.warn; console.warn = () => {};
  try { assert.equal((await selector(nativeAsset, "throw new Error('bad')"))('fox').kind, 'procedural', 'build threw'); }
  finally { console.warn = warn; }
  assert.equal((await selector(null, ''))('unknown').kind, 'placeholder');
});
