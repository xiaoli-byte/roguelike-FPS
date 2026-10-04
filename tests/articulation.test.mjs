import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  analyzePose, articulationGeometry, boundCannonAim, closedMeshEdgeStats, createCannonAim,
  deformationByRegion, loadPublishedMesh, makeHumanoidRig, mortarGripMetrics,
  sampleAimedMortarPose, sampleRigPose, skinPositions, vertexWeights, withArticulationWeights,
  weaponMeshOverlaps, weaponSurfaceDepths, wristAngles, wristVertexMask,
} from '../art/tools/pose_geometry_audit.mjs';

test('published body skin corrections preserve every visual buffer and cache all three LODs', () => {
  for (const kind of ['Mortar', 'Shaman']) for (let lod = 0; lod < 3; lod++) {
    const source = loadPublishedMesh('SK_Enemy_' + kind, lod);
    const rig = makeHumanoidRig(kind);
    const original = new Float32Array(source.attrs.WEIGHTS_0);
    const fixed = withArticulationWeights(source, rig);
    assert.notEqual(fixed.corrected, fixed.geometry);
    for (const attribute of ['position', 'normal', 'uv', 'tangent', 'skinIndex']) {
      assert.equal(fixed.corrected.getAttribute(attribute), fixed.geometry.getAttribute(attribute), `${kind}/${lod}: ${attribute} replaced`);
    }
    assert.equal(fixed.corrected.index, fixed.geometry.index);
    assert.deepEqual(source.attrs.WEIGHTS_0, original, `${kind}/${lod}: source weights mutated`);
    assert.equal(articulationGeometry(source.id, fixed.geometry, source.boneNames, source.boneNames.map(n => rig.inv[n])), fixed.corrected);
    assert.equal(articulationGeometry('SK_Enemy_Grunt', fixed.geometry, source.boneNames, source.boneNames.map(n => rig.inv[n])), fixed.geometry);
    for (let i = 0; i < fixed.attrs.WEIGHTS_0.length; i += 4) {
      const sum = fixed.attrs.WEIGHTS_0.slice(i, i + 4).reduce((a, b) => a + b, 0);
      assert.ok(Number.isFinite(sum) && Math.abs(sum - 1) < 0.003, `${kind}/${lod}: invalid skin weights`);
    }
  }
});

test('real shoulder junctions retain their original source weights', () => {
  for (const kind of ['Mortar', 'Shaman']) {
    const source = loadPublishedMesh('SK_Enemy_' + kind), rig = makeHumanoidRig(kind);
    const fixed = withArticulationWeights(source, rig);
    let checked = 0;
    for (let i = 0; i < source.attrs.POSITION.length / 3; i++) {
      const point = source.attrs.POSITION.slice(i * 3, i * 3 + 3);
      // All vertices near either true shoulder pivot are inside the untouched joint collar.
      const near = ['armL', 'armR'].some(name => {
        const shoulder = rig.inv[name].clone().invert().elements;
        return Math.hypot(point[0] - shoulder[12], point[1] - shoulder[13], point[2] - shoulder[14]) < 0.075;
      });
      if (!near) continue;
      assert.deepEqual(fixed.attrs.WEIGHTS_0.slice(i * 4, i * 4 + 4), source.attrs.WEIGHTS_0.slice(i * 4, i * 4 + 4));
      checked++;
    }
    assert.ok(checked > 20, `${kind}: shoulder test did not sample actual geometry`);
  }
});

test('generated shaman cuffs lose their distant hips influence without changing the mesh', () => {
  const source = loadPublishedMesh('SK_Enemy_Shaman'), rig = makeHumanoidRig('Shaman');
  const fixed = withArticulationWeights(source, rig);
  let sourceMass = 0, fixedMass = 0, vertices = 0;
  for (let i = 0; i < source.attrs.POSITION.length / 3; i++) {
    const weights = vertexWeights(source, i);
    const hand = weights.filter(w => /^hand[LR]$/.test(w.bone)).reduce((s, w) => s + w.weight, 0);
    const hips = weights.find(w => w.bone === 'hips')?.weight ?? 0;
    if (hand < 0.45 || hips < 0.04) continue;
    sourceMass += hips;
    fixedMass += vertexWeights(fixed, i).find(w => w.bone === 'hips')?.weight ?? 0;
    vertices++;
  }
  assert.ok(vertices > 20, 'must sample the published cuff defect');
  assert.ok(fixedMass < sourceMass * 0.10, `hips contamination remains: ${fixedMass}/${sourceMass}`);
});

test('actual shaman skin, staff contact and body clearance stay bounded through both spells and their recoveries', () => {
  const staff = loadPublishedMesh('SM_EnemyWeapon_Staff');
  assert.deepEqual(closedMeshEdgeStats(staff), { open: 0, nonManifold: 0 });
  for (const [state, action] of [['castCircle', 'circle'], ['ward', 'ward'], ['recover', 'circle'], ['recover', 'ward']]) for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const audit = analyzePose('Shaman', state, t, action, false, true);
    assert.ok(audit.wristTriangles.triangles > 100);
    assert.equal(audit.wristTriangles.collapsed15pct, 0, `${state}/${t}: wrist mesh collapsed`);
    assert.ok(audit.sleeveTriangles.p99EdgeRatio < 2.2, `${state}/${t}: cuff stretched ${audit.sleeveTriangles.p99EdgeRatio}x`);
    assert.ok(audit.sleeveTriangles.maxEdgeRatio < 3.5, `${state}/${t}: sleeve edge outlier`);
    assert.ok(audit.wrists.every(w => w.bendDeg < 25), `${state}/${t}: bent wrist exceeds local gesture range`);
    const hand = weaponSurfaceDepths(audit.rig, audit.asset, audit.positions, staff, ['handR'], wristVertexMask(audit.asset, audit.rig)).handR;
    assert.ok(hand.maximumDepth <= 0.003, `${state}/${action}/${t}: actual palm ${hand.maximumDepth}m inside staff`);
    assert.ok(hand.minimumSurfaceDistance <= 0.003, `${state}/${action}/${t}: actual palm ${hand.minimumSurfaceDistance}m away from staff`);
    assert.deepEqual(weaponMeshOverlaps(audit.rig, audit.asset, audit.positions, staff, ['head', 'torso', 'hips'], 0.0001), {}, `${state}/${action}/${t}: actual staff encloses head or torso`);
  }
});

test('the mesh audit detects wrist collapse even when the wrist position stays on its target', () => {
  const source = loadPublishedMesh('SK_Enemy_Mortar'), rig = makeHumanoidRig('Mortar');
  const asset = withArticulationWeights(source, rig);
  sampleRigPose('Mortar', rig, 'fire', 1, 'shell');
  const mask = wristVertexMask(asset, rig);
  const good = deformationByRegion(asset, skinPositions(rig, asset), ['handL', 'handR'], mask);
  const before = rig.r.handR.position.clone();
  rig.r.handR.rotation.x = Math.PI;
  rig.root.updateMatrixWorld(true);
  const bad = deformationByRegion(asset, skinPositions(rig, asset), ['handL', 'handR'], mask);
  assert.deepEqual(rig.r.handR.position, before, 'diagnostic must not move the wrist target');
  assert.equal(good.collapsed15pct, 0);
  assert.ok(bad.collapsed15pct > good.collapsed15pct + 5, 'audit accepted a folded wrist merely because its position is unchanged');
});

test('the published cannon mesh clears head and torso throughout attacks, recoil and recovery', () => {
  const rig = makeHumanoidRig('Mortar');
  const body = withArticulationWeights(loadPublishedMesh('SK_Enemy_Mortar'), rig);
  const cannon = loadPublishedMesh('SM_EnemyWeapon_Cannon');
  assert.deepEqual(closedMeshEdgeStats(cannon), { open: 0, nonManifold: 0 }, 'weapon parity test requires a closed published shell');
  let frames = 0;
  const sample = (state, progress, action, shotAge) => {
    sampleRigPose('Mortar', rig, state, progress, action, shotAge);
    const overlaps = weaponMeshOverlaps(rig, body, skinPositions(rig, body), cannon, ['head', 'torso', 'hips'], 0.0001);
    assert.deepEqual(overlaps, {}, `${state}/${action} progress=${progress}, shotAge=${shotAge}: body enclosed by cannon`);
    frames++;
  };
  sample('move', 0, 'shell', Infinity);
  for (const [state, action] of [['brace', 'shell'], ['smashWindup', 'smash'], ['recover', 'smash']]) {
    for (let i = 0; i <= 100; i++) sample(state, i / 100, action, Infinity);
  }
  for (let i = 0; i <= 50; i++) sample('fire', 1, 'shell', i * 0.35 / 50);
  // At the last shot, ai resets stateTime and shotAge; animate then advances shotAge by dt.
  // Keep recovery progress and shotAge physically coupled, including the two haste affixes.
  for (const attackRate of [1, 1.5, 1.6]) for (const fps of [30, 60, 144]) {
    for (let i = 0; i <= 100; i++) {
      const progress = i / 100;
      sample('recover', progress, 'shell', progress * 0.8 / Math.sqrt(attackRate) + 1 / fps);
    }
  }
  assert.equal(frames, 1264);
});

test('bounded cannon aiming keeps the actual head and torso clear with neutral wrists and bent supporting elbows', () => {
  const rig = makeHumanoidRig('Mortar');
  const body = withArticulationWeights(loadPublishedMesh('SK_Enemy_Mortar'), rig);
  const cannon = loadPublishedMesh('SM_EnemyWeapon_Cannon');
  const wristMask = wristVertexMask(body, rig);
  const phases = [['fire', 1, 0], ['fire', 1, 0.07], ['recover', 0.1, 0.1 * 0.8 / Math.sqrt(1.6) + 1 / 144]];
  const frames = [];
  // Pitch endpoints and their interpolation, at both allowed lateral boundaries.
  for (let i = 0; i <= 15; i++) for (const yaw of [-0.25, 0.25]) {
    for (const [state, progress, shotAge] of phases) frames.push({ pitch: 0.30 + 0.75 * i / 15, yaw, state, progress, shotAge });
  }
  // Brace interpolation also includes the near-compensation transition.
  for (const pitch of [0.30, 0.45, 0.55, 0.65, 1.05]) for (const yaw of [-0.25, 0.25]) {
    frames.push({ pitch, yaw, state: 'brace', progress: 0.55, shotAge: Infinity });
  }
  for (const pitch of [0.30, 0.34, 0.45, 0.65, 0.75, 0.90, 1.05]) {
    for (const [state, progress, shotAge] of phases) frames.push({ pitch, yaw: 0, state, progress, shotAge });
  }
  for (const frame of frames) {
    const { pitch, yaw, state, progress, shotAge } = frame;
    const velocity = new THREE.Vector3(Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch));
    const aim = boundCannonAim(velocity, createCannonAim());
    const pose = sampleAimedMortarPose(rig, state, progress, 'shell', shotAge, aim);
    const label = JSON.stringify(frame);
    const posed = skinPositions(rig, body);
    assert.deepEqual(weaponMeshOverlaps(rig, body, posed, cannon, ['head', 'torso', 'hips'], 0.0001), {}, `${label}: cannon encloses body`);
    for (const contact of mortarGripMetrics(rig, pose)) {
      assert.ok(contact.palmError < 0.002, `${label}: ${contact.side} palm detached ${contact.palmError}m`);
      assert.ok(contact.elbowBendDeg > 5 && contact.elbowBendDeg < 145, `${label}: ${contact.side} elbow ${contact.elbowBendDeg}°`);
    }
    assert.ok(wristAngles(rig).every(w => w.bendDeg < 1e-5), `${label}: weapon copied into a local wrist rotation`);
    assert.equal(deformationByRegion(body, posed, ['handL', 'handR'], wristMask).collapsed15pct, 0, `${label}: actual wrist triangles collapsed`);
  }
  assert.equal(frames.length, 127);
});

test('actual weapon palms touch their surfaces without centimetre penetration or a hovering support hand', () => {
  const rig = makeHumanoidRig('Mortar');
  const body = withArticulationWeights(loadPublishedMesh('SK_Enemy_Mortar'), rig);
  const cannon = loadPublishedMesh('SM_EnemyWeapon_Cannon');
  const wristMask = wristVertexMask(body, rig);
  // Torso-local launch directions captured from real prepareAim at 6/20/32m,
  // flat ground, actor scale 1, no player velocity; all then receive the same 6ms recoil.
  const frames = [
    { label: '6m', direction: [0.00421987909836968, 0.9408744216101724, 0.3387292656091568] },
    { label: '20m', direction: [0.009681174169867648, 0.7348560248216707, 0.6781540368161093] },
    { label: '32m', direction: [0.010974028081511033, 0.6572470169903064, 0.7535953352861272] },
    { label: 'smash lift', state: 'smashWindup', progress: 0.65, action: 'smash' },
    { label: 'smash contact', state: 'smashWindup', progress: 1, action: 'smash' },
    { label: 'carry', state: 'move', progress: 0, action: 'shell' },
  ];
  for (const frame of frames) {
    const pose = frame.direction
      ? sampleAimedMortarPose(rig, 'fire', 1, 'shell', 0.006, boundCannonAim(new THREE.Vector3(...frame.direction), createCannonAim()))
      : sampleRigPose('Mortar', rig, frame.state, frame.progress, frame.action);
    const depth = weaponSurfaceDepths(rig, body, skinPositions(rig, body), cannon, ['handL', 'handR'], wristMask);
    for (const hand of ['handL', 'handR']) {
      assert.ok(depth[hand].vertices >= 12, `${frame.label}/${hand}: must sample the real palm mesh`);
      assert.ok(depth[hand].maximumDepth <= 0.003, `${frame.label}/${hand}: palm ${depth[hand].maximumDepth}m inside barrel`);
      assert.ok(depth[hand].minimumSurfaceDistance <= 0.003, `${frame.label}/${hand}: palm hovers ${depth[hand].minimumSurfaceDistance}m above barrel`);
    }
    assert.ok(mortarGripMetrics(rig, pose).every(c => c.palmError < 0.002 && c.elbowBendDeg > 5), `${frame.label}: surface clearance must preserve supporting arm reach`);
  }
  const shamanRig = makeHumanoidRig('Shaman');
  const shaman = withArticulationWeights(loadPublishedMesh('SK_Enemy_Shaman'), shamanRig);
  const staff = loadPublishedMesh('SM_EnemyWeapon_Staff');
  const shamanMask = wristVertexMask(shaman, shamanRig);
  for (const [state, progress, action] of [['move', 0, 'circle'], ['castCircle', 1, 'circle'], ['ward', 1, 'ward']]) {
    sampleRigPose('Shaman', shamanRig, state, progress, action);
    const hand = weaponSurfaceDepths(shamanRig, shaman, skinPositions(shamanRig, shaman), staff, ['handR'], shamanMask).handR;
    assert.ok(hand.vertices > 35, `${state}: must sample the real shaman palm mesh`);
    assert.ok(hand.maximumDepth <= 0.003, `${state}: actual palm ${hand.maximumDepth}m inside staff`);
    assert.ok(hand.minimumSurfaceDistance <= 0.003, `${state}: actual palm ${hand.minimumSurfaceDistance}m away from staff`);
  }
});
