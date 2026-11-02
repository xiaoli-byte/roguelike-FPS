import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadPublishedMesh } from '../art/tools/pose_geometry_audit.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('public/assets/manifest.json', root), 'utf8')).assets;
const cases = [
  { id: 'SK_Weapon_Gunfire1002', target: 'smg', tris: 2394, moving: 'mag', movingTris: 290 },
  { id: 'SK_Weapon_Gunfire1202', target: 'revolver', tris: 3068, moving: 'cylinder', movingTris: 300 },
  { id: 'SK_Weapon_Gunfire1008', target: 'railgun', tris: 3336, moving: 'spinner', movingTris: 252 },
  { id: 'SK_Weapon_Gunfire1106', target: 'sniper', tris: 6502, moving: 'mag', movingTris: 0 },
  { id: 'SK_Weapon_Gunfire1301', target: 'shotgun', tris: 2574, moving: 'pump', movingTris: 216 },
];

for (const c of cases) test(`${c.id}: runtime mesh, weights, materials and sockets`, async () => {
  const entry = manifest[c.id];
  assert.ok(entry);
  assert.deepEqual(entry.bind, { source: 'weapon', id: c.target });
  const bytes = await readFile(new URL(`public/${entry.url}`, root));
  assert.equal(entry.bytes, bytes.length);
  assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
  const length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length));
  const lod = doc.nodes.filter(n => n.name === `${c.id}_LOD0`);
  assert.equal(lod.length, 1);
  assert.equal(lod[0].skin, 0);
  const tris = doc.meshes[0].primitives.reduce((s, p) => s + doc.accessors[p.indices].count / 3, 0);
  assert.equal(tris, c.tris);
  assert.deepEqual(doc.skins[0].joints.map(i => doc.nodes[i].name), ['j_r', 'j_0', 'j_13']);
  assert.ok(doc.materials.every(m => m.normalTexture));
  const decodedParts = c.id === 'SK_Weapon_Gunfire1301' ? [loadPublishedMesh(c.id, 0, 0), loadPublishedMesh(c.id, 0, 1)] : [loadPublishedMesh(c.id, 0)];
  let moving = 0;
  for (const decoded of decodedParts) {
    const joints = decoded.attrs.JOINTS_0, weights = decoded.attrs.WEIGHTS_0;
    for (let i = 0; i < decoded.idx.length; i += 3) {
      const v = decoded.idx[i];
      let best = 0;
      for (let s = 1; s < 4; s++) if (weights[v * 4 + s] > weights[v * 4 + best]) best = s;
      if (joints[v * 4 + best] === 2) moving++;
    }
  }
  assert.equal(moving, c.movingTris, `${c.moving} rigid-part triangles`);
  const sidecar = JSON.parse(await readFile(new URL(`unity/Assets/Art/Weapons/${c.id}/${c.id}.art.json`, root), 'utf8'));
  assert.equal(sidecar.weapon.id, c.target);
  assert.equal(sidecar.weapon.parts[c.moving], c.moving);
  assert.deepEqual(Object.keys(sidecar.weapon.sockets).sort(), ['eject', 'finish', 'leftGrip', 'load', 'muzzle', 'sight']);
  const definition = await readFile(new URL(`unity/Assets/Game/Scripts/Weapons/Defs/Weapon_${c.target[0].toUpperCase()}${c.target.slice(1)}.cs`, root), 'utf8');
  assert.match(definition, new RegExp(`prefab = "${c.id}"`));
});
