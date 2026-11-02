import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadPublishedMesh } from '../art/tools/pose_geometry_audit.mjs';

const id = 'SK_Weapon_Gunfire1001';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('public/assets/manifest.json', root), 'utf8'));
const entry = manifest.assets[id];
const bytes = await readFile(new URL(`public/${entry.url}`, root));
const jsonLength = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));

function pngDimensions(imageIndex) {
  const image = document.images[imageIndex];
  const view = document.bufferViews[image.bufferView];
  const start = 28 + jsonLength + (view.byteOffset ?? 0);
  assert.equal(image.mimeType, 'image/png');
  assert.equal(bytes.toString('hex', start, start + 8), '89504e470d0a1a0a');
  return [bytes.readUInt32BE(start + 16), bytes.readUInt32BE(start + 20)];
}

test('Gunfire 1001 publication preserves source geometry and project contract', () => {
  assert.ok(entry);
  assert.deepEqual(entry.bind, { source: 'weapon', id: 'rifle' });
  assert.equal(entry.kind, 'skeletal');
  assert.equal(entry.class, 'weapon_fp');
  assert.equal(entry.bytes, bytes.length);
  assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.ok(bytes.length <= 3000 * 1024);
  assert.equal(document.meshes.length, 1);
  assert.equal(document.materials.length, 1);
  assert.deepEqual(document.images.map((_, i) => pngDimensions(i)), [[1024, 1024], [1024, 1024], [1024, 1024]]);
  const meshNodes = document.nodes.filter(n => n.name === `${id}_LOD0`);
  assert.equal(meshNodes.length, 1);
  assert.equal(meshNodes[0].skin, 0);
  assert.deepEqual(document.skins[0].joints.map(i => document.nodes[i].name), ['j_r', 'j_0', 'j_13']);
  const primitive = document.meshes[0].primitives[0];
  assert.equal(document.accessors[primitive.indices].count / 3, 4996);
  assert.ok(primitive.extensions.KHR_draco_mesh_compression);
  const material = document.materials[0];
  assert.ok(material.pbrMetallicRoughness.baseColorTexture);
  assert.ok(material.normalTexture);
  assert.equal(material.pbrMetallicRoughness.metallicRoughnessTexture.index, material.occlusionTexture.index);
});

test('decoded mesh keeps independent magazine weights and original proportions', () => {
  const decoded = loadPublishedMesh(id, 0);
  const positions = decoded.attrs.POSITION;
  const joints = decoded.attrs.JOINTS_0;
  const weights = decoded.attrs.WEIGHTS_0;
  assert.ok(positions.length > 0);
  assert.equal(joints.length / 4, weights.length / 4);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], positions[i + a]);
      hi[a] = Math.max(hi[a], positions[i + a]);
    }
  }
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs(lo[a] - entry.bounds.min[a]) < 0.002, `bounds min ${a}`);
    assert.ok(Math.abs(hi[a] - entry.bounds.max[a]) < 0.002, `bounds max ${a}`);
  }
  const jointNames = document.skins[0].joints.map(i => document.nodes[i].name);
  const counts = Object.fromEntries(jointNames.map(n => [n, 0]));
  for (let i = 0; i < decoded.idx.length; i += 3) {
    const v = decoded.idx[i];
    let best = 0;
    for (let s = 1; s < 4; s++) if (weights[v * 4 + s] > weights[v * 4 + best]) best = s;
    counts[jointNames[joints[v * 4 + best]]] += 1;
  }
  assert.equal(counts.j_13, 172, 'Clip remains a separate animated magazine');
  assert.equal(counts.j_r, 4824, 'Main, Mantel and Trigger stay on the body');
});

test('Unity sidecar binds all weapon sockets without an extra red dot', async () => {
  const sidecar = JSON.parse(await readFile(new URL(`unity/Assets/Art/Weapons/${id}/${id}.art.json`, root), 'utf8'));
  assert.equal(sidecar.weapon.id, 'rifle');
  assert.deepEqual(Object.keys(sidecar.weapon.sockets).sort(), ['eject', 'finish', 'leftGrip', 'load', 'muzzle', 'sight']);
  assert.deepEqual(sidecar.weapon.parts, { muzzle: 'muzzle', mag: 'mag' });
  assert.equal(sidecar.meshes[0].tris, 4996);
  const handling = await readFile(new URL('unity/Assets/Game/Scripts/Weapons/Handling/Handling_Rifle.cs', root), 'utf8');
  assert.match(handling, /kind = SightKind.None/);
  const definition = await readFile(new URL('unity/Assets/Game/Scripts/Weapons/Defs/Weapon_Rifle.cs', root), 'utf8');
  assert.match(definition, /prefab = "SK_Weapon_Gunfire1001"/);
});
