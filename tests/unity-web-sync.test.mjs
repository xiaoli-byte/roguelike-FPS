import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('public/assets/gunfire-original/manifest.json', root), 'utf8'));
const expected = { '1002': 'smg', '1202': 'revolver', '1008': 'railgun' };

function document(bytes) {
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

function floats(bytes, gltf, index) {
  const accessor = gltf.accessors[index];
  assert.equal(accessor.componentType, 5126);
  const view = gltf.bufferViews[accessor.bufferView];
  const start = 28 + bytes.readUInt32LE(12) + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  return Array.from({ length: accessor.count * width }, (_, i) => bytes.readFloatLE(start + i * 4));
}

for (const [weapon, target] of Object.entries(expected)) test(`Unity ${weapon} ships native arms, skin and generic clips to Three.js`, async () => {
  const entry = manifest.assets[weapon];
  assert.ok(entry);
  assert.equal(entry.target, target);
  const bytes = await readFile(new URL(`public/${entry.url}`, root));
  assert.equal(entry.bytes, bytes.length);
  assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  const gltf = document(bytes);
  const names = gltf.meshes.map(mesh => mesh.name);
  assert.ok(names.includes('hero_fpp_101_A_R'), 'right native arm');
  assert.ok(names.includes('hero_fpp_101_A_L'), 'left native arm');
  assert.equal(gltf.skins.length, gltf.meshes.length);
  assert.ok(gltf.skins.every(skin => skin.joints.length > 0 && gltf.accessors[skin.inverseBindMatrices].count === skin.joints.length));
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    const weights = floats(bytes, gltf, primitive.attributes.WEIGHTS_0);
    assert.ok(weights.every(weight => Number.isFinite(weight) && weight >= 0), `${mesh.name}: valid weights`);
    for (let i = 0; i < weights.length; i += 4) {
      const sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3];
      assert.ok(Math.abs(sum - 1) < 1e-5, `${mesh.name}: normalized weights`);
    }
  }
  for (const role of ['Right', 'Left']) {
    for (const action of ['Pose', 'Fire']) {
      const clip = gltf.animations.find(animation => animation.name === `${role}_${action}`);
      assert.ok(clip, `${role}_${action}`);
      assert.ok(clip.channels.length > 100);
    }
  }
  const reload = gltf.animations.find(animation => animation.name === 'Right_Reload');
  assert.ok(reload?.channels.length > 100);
  assert.ok(Math.max(...reload.samplers.map(sampler => gltf.accessors[sampler.input].max?.[0] ?? 0)) > 1);
  assert.ok(!gltf.animations.some(animation => animation.name === 'Left_Reload'));
  const viewmodel = await readFile(new URL('src/weapons/Viewmodel.ts', root), 'utf8');
  assert.match(viewmodel, /new OriginalWeaponView\(synced/);
  assert.match(viewmodel, /new OriginalRecoil\(synced\.motion\)/);
  assert.match(viewmodel, /upgradeWhenSynced/);
  const library = await readFile(new URL('src/assets/OriginalWeaponLibrary.ts', root), 'utf8');
  assert.match(library, /loadedAssets\.set\(defId, loaded\)/);
});

test('all 16 Unity motion documents are mirrored byte for byte', async () => {
  const weapons = ['1001', '1002', '1003', '1004', '1005', '1006', '1008', '1009', '1010', '1013', '1014', '1101', '1102', '1106', '1202', '1301'];
  for (const weapon of weapons) {
    const unity = await readFile(new URL(`unity/Assets/Resources/Gunfire/Motion/${weapon}.json`, root));
    const web = await readFile(new URL(`public/assets/gunfire-original/motion/${weapon}.json`, root));
    assert.deepEqual(JSON.parse(web), JSON.parse(unity), weapon);
  }
});
