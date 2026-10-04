import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { createHash } from 'node:crypto';

async function tsModule(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  source = source.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`);
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
}
const { WEAPON_HANDLING, sampleLoadingHand } = await import(await tsModule('../src/weapons/WeaponHandling.ts'));
const { WEAPON_DEFS } = await import(await tsModule('../src/weapons/WeaponDefs.ts'));
const mathUrl = await tsModule('../src/core/math.ts');
const { buildHumanoid, reachWeaponGrip } = await import(await tsModule('../src/enemies/Models.ts', { '../core/math': mathUrl }));
const { addReloadBreech } = await import(await tsModule('../src/weapons/ReloadBreech.ts'));
const { fitScenePropScale } = await import(await tsModule('../src/world/ScenePropFit.ts'));

test('generated prop scaling stays inside collision boxes under rotation and oversized layout scaling', () => {
  const bounds = { min: [-0.6, 0, -0.4], max: [0.5, 2.2, 0.5] };
  assert.equal(fitScenePropScale(bounds, 0, 2), 2, 'noncolliding decoration should retain requested size');
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI * 1.3]) for (const size of [0.7, 1, 1.8]) {
    const scale = fitScenePropScale(bounds, yaw, size, [0.9, 1.1]);
    for (const x of [bounds.min[0], bounds.max[0]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      const px = (x * Math.cos(yaw) + z * Math.sin(yaw)) * scale;
      const pz = (-x * Math.sin(yaw) + z * Math.cos(yaw)) * scale;
      const half = 0.9 * Math.min(1.25, size) / 2;
      assert.ok(Math.max(Math.abs(px), Math.abs(pz)) <= half + 1e-8);
    }
    assert.ok(bounds.max[1] * scale <= 1.1 * size + 1e-8);
  }
});

test('double-barrel animation partitions existing art without losing triangles or modifying shared geometry', () => {
  const root = new THREE.Group();
  const body = new THREE.LOD(); body.name = 'SK_Weapon_MagmaShot_j_r'; root.add(body);
  const source = new THREE.BoxGeometry(0.06, 0.06, 0.30); source.translate(0, 0.04, -0.13);
  const originalIndexCount = source.index.count;
  body.addLevel(new THREE.Mesh(source), 0);
  body.addLevel(new THREE.Mesh(source), 6);
  const owned = [], hinge = addReloadBreech(root, owned);
  assert.equal(source.index.count, originalIndexCount);
  assert.equal(owned.length, 4);
  const barrels = hinge.children.find(o => o.isLOD);
  assert.deepEqual(barrels.levels.map(l => l.distance), [0, 6]);
  for (let i = 0; i < 2; i++) {
    const front = barrels.levels[i].object.geometry, fixed = body.levels[i].object.geometry;
    assert.equal(front.attributes.position.count + fixed.attributes.position.count, originalIndexCount);
    assert.ok(front.attributes.uv && fixed.attributes.uv);
    assert.ok(front.attributes.position.array.every(Number.isFinite));
  }
  hinge.rotation.x = -0.48;
  root.updateMatrixWorld(true);
  const before = new THREE.Vector3(0, 0.04, -0.30), after = hinge.localToWorld(new THREE.Vector3(0, 0.036, -0.265));
  assert.ok(after.y < before.y, 'barrels should open downward');
  owned.forEach(g => g.dispose()); source.dispose();
});

test('all 18 weapons have handling profiles and finite, continuous loading paths', () => {
  assert.equal(WEAPON_DEFS.length, 18);
  for (const def of WEAPON_DEFS) {
    const profile = WEAPON_HANDLING[def.id];
    assert.ok(profile, def.id);
    const support = profile.support ?? [0, 0, -0.25];
    const out = { x: 0, y: 0, z: 0, roll: 0, pitch: 0 };
    let previous;
    for (let i = 0; i <= 100; i++) {
      sampleLoadingHand(profile, i / 100, support, profile.load, out);
      assert.ok(Object.values(out).every(Number.isFinite), def.id);
      if (previous) assert.ok(Math.hypot(out.x - previous.x, out.y - previous.y, out.z - previous.z) < 0.06, `${def.id}: hand teleported`);
      previous = { ...out };
    }
    if (!['shell', 'breech'].includes(profile.action)) {
      assert.deepEqual([out.x, out.y, out.z], support, `${def.id}: did not return to grip`);
    } else assert.ok(Math.hypot(out.x - profile.load[0], out.y - profile.load[1], out.z - profile.load[2]) < 1e-8, `${def.id}: shell not at loading port on insertion frame`);
  }
});

test('detached magazines, cells and drums carry the hand with the actual moving part', () => {
  for (const id of ['smg', 'sniper', 'crossbow', 'flamer', 'railgun', 'stormpod', 'minigun', 'lantern']) {
    const contact = [-0.08, -0.15, -0.06];
    const out = {};
    sampleLoadingHand(WEAPON_HANDLING[id], 0.5, [0, 0, -0.25], contact, out);
    assert.deepEqual([out.x, out.y, out.z], contact, id);
  }
});

test('pump-fed and break-action shotguns use different loading ports and hand actions', () => {
  assert.equal(WEAPON_HANDLING.shotgun.action, 'shell');
  assert.equal(WEAPON_HANDLING.magmashot.action, 'breech');
  assert.notDeepEqual(WEAPON_HANDLING.shotgun.load, WEAPON_HANDLING.magmashot.load);
  assert.equal(WEAPON_HANDLING.flamer.action, 'cellBottom');
  assert.equal(WEAPON_HANDLING.railgun.action, 'cellTop');
});

function rig(shoulderX, shoulderY, upperArm, foreArm) {
  const root = new THREE.Group();
  root.position.set(5, 1, -9);
  root.rotation.y = 1.1;
  root.scale.setScalar(1.25);
  return buildHumanoid(root, { hipY: 0.9, hipX: 0.15, thigh: 0.45, legW: 0.14, legColor: 0xffffff,
    torsoW: 0.5, torsoH: 0.6, torsoD: 0.3, torsoColor: 0xffffff,
    shoulderX, shoulderY, upperArm, foreArm, armW: 0.12, armColor: 0xffffff, neckY: 0.65 });
}

function gripDistance(r, side, weapon, point) {
  reachWeaponGrip(r, side, weapon, ...point);
  const actual = new THREE.Vector3();
  (side > 0 ? r.handL : r.handR).getWorldPosition(actual);
  const expected = new THREE.Vector3(...point).applyMatrix4(weapon.matrixWorld);
  return actual.distanceTo(expected) / 1.25;
}

test('musket hands remain on trigger and fore-end during aiming and recoil', () => {
  const r = rig(0.27, 0.52, 0.30, 0.28);
  const gun = new THREE.Group(); r.torso.add(gun);
  for (const pitch of [-0.8, -0.4, 0, 0.4, 0.8]) {
    gun.position.set(-0.12, 0.46, 0.18);
    gun.rotation.set(-pitch - 0.08, 0, 0);
    assert.ok(gripDistance(r, -1, gun, [0, -0.085, 0.025]) < 0.025, `right: ${pitch}`);
    assert.ok(gripDistance(r, 1, gun, [0, -0.055, 0.22]) < 0.035, `left: ${pitch}`);
  }
});

test('staff raising and shield bashing keep wrists within reach', () => {
  const r = rig(0.29, 0.52, 0.28, 0.27);
  const staff = new THREE.Group(); r.torso.add(staff);
  for (const [lift, tilt] of [[0, 0.08], [0.3, 0.3], [0.45, 0]]) {
    staff.position.set(-0.36, 0.05 + lift, 0.14);
    staff.rotation.x = tilt;
    assert.ok(gripDistance(r, -1, staff, [0, 0.42, 0]) < 0.025);
  }
  const brute = rig(0.58, 0.64, 0.38, 0.36);
  const shield = new THREE.Group(); brute.torso.add(shield);
  for (const [x, z] of [[0.3, 0.44], [0.05, 0.62], [0.1, 0.66]]) {
    shield.position.set(x, 0.3, z);
    assert.ok(gripDistance(brute, 1, shield, [0.04, 0.08, -0.13]) < 0.025);
  }
});

test('Hunyuan prop exports have textured geometry, two LODs and bounded download cost', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
  const entries = Object.entries(manifest.assets).filter(([, a]) => a.bind.source === 'scene' && a.class === 'prop');
  assert.equal(entries.length, 6);
  for (const [id, entry] of entries) {
    const file = await readFile(new URL(`../public/${entry.url}`, import.meta.url));
    assert.ok(file.byteLength < 600 * 1024, id);
    assert.equal(createHash('sha256').update(file).digest('hex'), entry.sha256, id);
    assert.equal(file.readUInt32LE(0), 0x46546c67, id);
    assert.equal(file.readUInt32LE(4), 2, id);
    assert.equal(file.readUInt32LE(8), file.byteLength, id);
    const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
    assert.equal(gltf.meshes.length, 2, id);
    const provenance = JSON.parse(await readFile(new URL(`../art/source/props/${id}/asset.json`, import.meta.url), 'utf8'));
    const generated = provenance.stages.highpoly.versions.find(v => v.version === entry.version.highpoly);
    assert.match(generated.tool, /Hunyuan3D 2.1/, id);
    assert.ok(gltf.materials[0].pbrMetallicRoughness.baseColorTexture, `${id}: missing base color`);
    assert.ok(gltf.materials[0].normalTexture, `${id}: missing baked normal`);
    assert.ok(gltf.materials[0].occlusionTexture, `${id}: missing baked occlusion`);
    for (let i = 0; i < 2; i++) {
      const node = gltf.nodes.find(n => n.name === `${id}_LOD${i}`);
      assert.ok(node, id);
      const mesh = gltf.meshes[node.mesh], primitive = mesh.primitives[0];
      const positions = gltf.accessors[primitive.attributes.POSITION];
      assert.ok([...positions.min, ...positions.max].every(Number.isFinite), id);
      assert.ok(primitive.attributes.TEXCOORD_0 !== undefined, `${id}: missing UVs`);
      const triangles = gltf.accessors[primitive.indices].count / 3;
      assert.ok(triangles <= (i === 0 ? 2500 : 900), `${id}: triangle budget exceeded`);
      assert.ok(positions.min[1] > -0.02, `${id}: prop sinks below floor`);
    }
  }
});
