import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

async function tsModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  source = source.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const mathUrl = await tsModule('../src/core/math.ts');
const navUrl = await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl });
const checkUrl = await tsModule('../src/world/LevelCheck.ts', { './NavGrid': navUrl });
const themeUrl = await tsModule('../src/world/Themes.ts');
const { generateLevel, PROP_COLLIDER } = await import(await tsModule('../src/world/LevelGen.ts', { './LevelCheck': checkUrl, './Themes': themeUrl }));
const { validateAndRepair, LIGHT_COUNT } = await import(checkUrl);
const { Rng } = await import(await tsModule('../src/core/Rng.ts'));
const { fitScenePropScale } = await import(await tsModule('../src/world/ScenePropFit.ts'));
const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
const assets = Object.fromEntries(Object.values(manifest.assets).filter(a => a.bind.source === 'scene').map(a => [a.bind.id, a]));
const themes = ['desert', 'frost', 'inferno'];
const types = ['combat', 'elite', 'boss', 'treasure', 'shop'];

test('360 generated scenes keep navigation, spawn reserves and a constant light budget', () => {
  for (const theme of themes) for (const type of types) for (let seed = 1; seed <= 24; seed++) {
    const layout = generateLevel(new Rng(seed * 7919), { type, theme });
    const original = JSON.stringify(layout);
    assert.equal(validateAndRepair(layout), true, `${theme}/${type}/${seed}`);
    assert.equal(JSON.stringify(layout), original, 'published layout should need no further navigation repair');
    assert.equal(layout.lights.length, LIGHT_COUNT);
    const dressed = layout.decos.filter(d => d.sceneRole);
    assert.ok(dressed.length >= 4, `${theme}/${type}/${seed}: missing composition`);
    for (const d of dressed) {
      assert.ok(assets[`${theme}.${d.kind}`], `composition must use published Hunyuan asset: ${d.kind}`);
      assert.ok(['principal', 'support', 'accent'].includes(d.sceneLayer), 'composition lost its visual hierarchy');
      assert.ok(Math.hypot(d.x - layout.playerSpawn.x, d.z - layout.playerSpawn.z) > 3.5, 'entrance obstructed');
      assert.ok(Math.hypot(d.x - layout.rewardPoint.x, d.z - layout.rewardPoint.z) > 3.1, 'reward obstructed');
      for (const p of layout.portalPoints) assert.ok(Math.hypot(d.x - p.x, d.z - p.z) > 3.7, 'portal obstructed');
    }
  }
});

test('scene dressing is reproducible and the foreground focal object remains in the entrance view', () => {
  for (const theme of themes) for (const type of types) {
    const stage = { type, theme };
    const a = generateLevel(new Rng(20261004), stage), b = generateLevel(new Rng(20261004), stage);
    assert.deepEqual(a, b);
    if (type !== 'combat' && type !== 'elite') continue;
    const primary = a.decos.find(d => d.sceneRole === 'focal' && d.kind === (theme === 'desert' ? 'statue' : 'crystal'));
    assert.ok(primary, `${theme}: missing foreground focal asset`);
    const bearing = Math.atan2(-(primary.x - a.playerSpawn.x), -(primary.z - a.playerSpawn.z));
    const delta = Math.atan2(Math.sin(bearing - a.playerYaw), Math.cos(bearing - a.playerYaw));
    assert.ok(Math.abs(delta) < 0.7, `${theme}: focal object outside entrance view`);
  }
});

test('generated asset footprints fit real collision boxes, elevated dressing avoids each stair head', () => {
  let platforms = 0;
  for (const theme of themes) for (let seed = 1; seed <= 24; seed++) {
    const layout = generateLevel(new Rng(seed * 7919), { type: 'combat', theme });
    for (const d of layout.decos.filter(d => d.sceneRole)) {
      const asset = assets[`${theme}.${d.kind}`], collider = PROP_COLLIDER[d.kind];
      const scale = fitScenePropScale(asset.bounds, d.yaw, d.s, collider);
      const cornerPoints = [];
      for (const x of [asset.bounds.min[0], asset.bounds.max[0]]) for (const z of [asset.bounds.min[2], asset.bounds.max[2]]) {
        const wx = d.x + (x * Math.cos(d.yaw) + z * Math.sin(d.yaw)) * scale;
        const wz = d.z + (-x * Math.sin(d.yaw) + z * Math.cos(d.yaw)) * scale;
        assert.ok(wx > layout.minX && wx < layout.maxX && wz > layout.minZ && wz < layout.maxZ, 'generated art intersects the perimeter');
        cornerPoints.push({ x: wx, z: wz });
      }
      if (collider) {
        const box = layout.boxes.find(b => b.look === 'collider' && b.group === d.group && Math.abs((b.minX + b.maxX) / 2 - d.x) < 1e-6 && Math.abs((b.minZ + b.maxZ) / 2 - d.z) < 1e-6);
        assert.ok(box, `physical scene prop must have collision: ${theme}/${d.kind}`);
        const s = fitScenePropScale(asset.bounds, d.yaw, d.s, collider), c = Math.cos(d.yaw), sin = Math.sin(d.yaw);
        for (const x of [asset.bounds.min[0], asset.bounds.max[0]]) for (const z of [asset.bounds.min[2], asset.bounds.max[2]]) {
          const wx = d.x + (x * c + z * sin) * s, wz = d.z + (-x * sin + z * c) * s;
          assert.ok(wx >= box.minX - 1e-6 && wx <= box.maxX + 1e-6 && wz >= box.minZ - 1e-6 && wz <= box.maxZ + 1e-6, 'art overhangs its collision footprint');
        }
        assert.ok(d.y + asset.bounds.max[1] * s <= box.maxY + 1e-6);
      }
      if (d.sceneRole !== 'platform') continue;
      platforms++;
      const ramp = layout.ramps.find(r => r.group === d.group);
      assert.ok(ramp, 'elevated art lost its platform');
      assert.equal(d.y, ramp.top);
      assert.ok(Math.hypot(d.x - ramp.head.x, d.z - ramp.head.z) >= 2.15 - 1e-6, 'stair head narrowed by decoration');
      for (const p of cornerPoints) assert.ok(p.x > ramp.x0 + 0.18 && p.x < ramp.x1 - 0.18 && p.z > ramp.z0 + 0.18 && p.z < ramp.z1 - 0.18, 'elevated art overhangs the platform');
    }
  }
  assert.ok(platforms > 40, 'platform dressing should appear across sampled layouts');
});

/** Slab intersection against the renderer's conservative collision envelopes. */
function sightBlocked(from, to, box) {
  let enter = 0, exit = 1;
  for (const [axis, low, high] of [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']]) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-8) { if (from[axis] < box[low] || from[axis] > box[high]) return false; continue; }
    const a = (box[low] - from[axis]) / delta, b = (box[high] - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return enter > 0.001 && enter < 0.99;
}

test('entry compositions have chapter-specific silhouettes and unobstructed focal sightlines', () => {
  for (const theme of themes) for (const type of ['combat', 'elite']) for (let seed = 1; seed <= 24; seed++) {
    const layout = generateLevel(new Rng(seed * 7919), { theme, type });
    const focal = layout.decos.find(d => d.sceneRole === 'focal' && d.sceneLayer === 'principal');
    assert.ok(focal, `${theme}/${type}/${seed}: principal asset missing`);
    assert.ok(focal.s >= 1.35, 'focal scale should dominate wall accents');
    const canonicalX = focal.x * Math.cos(layout.playerYaw) - focal.z * Math.sin(layout.playerYaw);
    assert.equal(Math.sign(canonicalX), theme === 'frost' ? 1 : -1);
    const bearing = Math.atan2(-(focal.x - layout.playerSpawn.x), -(focal.z - layout.playerSpawn.z));
    const delta = Math.atan2(Math.sin(bearing - layout.playerYaw), Math.cos(bearing - layout.playerYaw));
    assert.ok(Math.abs(delta) < 0.7, 'principal asset left the entrance view');
    const asset = assets[`${theme}.${focal.kind}`];
    const s = fitScenePropScale(asset.bounds, focal.yaw, focal.s, PROP_COLLIDER[focal.kind]);
    const from = { ...layout.playerSpawn, y: layout.floorY + 1.55 };
    const to = { x: focal.x, z: focal.z, y: focal.y + asset.bounds.max[1] * s * 0.70 };
    for (const b of layout.boxes) {
      if (b.group === focal.group || b.noRaycast) continue;
      assert.equal(sightBlocked(from, to, b), false, `${theme}/${type}/${seed}: ${b.look} hides the focal art`);
    }
    const accents = layout.decos.filter(d => d.sceneRole === 'focal' && d.sceneLayer !== 'principal');
    assert.ok(accents.length >= 1, 'foreground should include a lower supporting object');
  }
});

test('wall and platform dressing keep principal/support scale contrast rather than repeating one size', () => {
  let variedPlatforms = 0;
  for (const theme of themes) for (let seed = 1; seed <= 24; seed++) {
    const layout = generateLevel(new Rng(seed * 7919), { theme, type: 'combat' });
    const wall = layout.decos.filter(d => d.sceneRole === 'alcove');
    assert.ok(new Set(wall.map(d => d.sceneLayer)).size >= 2, 'wall groups lost their layering');
    const groups = new Map();
    for (const d of layout.decos.filter(d => d.sceneRole === 'platform')) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    for (const props of groups.values()) if (props.length > 1) {
      assert.ok(Math.max(...props.map(d => d.s)) - Math.min(...props.map(d => d.s)) >= 0.20, 'platform pairs have matching size');
      variedPlatforms++;
    }
  }
  assert.ok(variedPlatforms > 20, 'sample should contain enough actual varied platform pairs');
});

test('entry centre keeps courtyard depth and the far doorway visible, including old tree canopies', () => {
  let distantCoverGroups = 0;
  for (const theme of themes) for (const type of ['combat', 'elite']) {
    // Include the actual browser-inspection regression seed as well as varied rotations/layouts.
    for (const seed of [20261004, ...Array.from({ length: 24 }, (_, i) => (i + 1) * 7919)]) {
      const layout = generateLevel(new Rng(seed), { theme, type });
      const from = { ...layout.playerSpawn, y: layout.floorY + 1.7 };
      const targets = [layout.center, layout.portalPoints[1]].map(p => ({ ...p, y: layout.floorY + 1.6 }));
      for (const b of layout.boxes) {
        if (b.noRaycast) continue;
        for (const to of targets) assert.equal(sightBlocked(from, to, b), false, `${theme}/${type}/${seed}: ${b.look} blocks centre depth`);
      }
      for (const d of layout.decos.filter(d => ['pine', 'cactus'].includes(d.kind))) {
        // Conservative existing model bounds: pine's lower canopy radius=1.55m;
        // cactus arms reach 0.62m plus 0.18m radius. These exceed their collision boxes.
        const radius = (d.kind === 'pine' ? 1.55 : 0.8) * d.s;
        const visual = { minX: d.x - radius, maxX: d.x + radius, minZ: d.z - radius, maxZ: d.z + radius,
          minY: d.y, maxY: d.y + (d.kind === 'pine' ? 4.8 : 3.5) * d.s };
        for (const to of targets) assert.equal(sightBlocked(from, to, visual), false, `${theme}/${type}/${seed}: ${d.kind} branches block centre view`);
        assert.ok(layout.boxes.some(b => b.group === d.group && b.look === 'collider'
          && Math.abs((b.minX + b.maxX) / 2 - d.x) < 1e-6 && Math.abs((b.minZ + b.maxZ) / 2 - d.z) < 1e-6), 'tree was visually moved without its collision');
      }
      const decorativeGroups = new Set(layout.decos.filter(d => d.sceneRole).map(d => d.group));
      const far = new Set(layout.boxes.filter(b => b.group > 0 && !decorativeGroups.has(b.group)
        && ['crate', 'lowWall', 'ruin', 'pillar', 'stele', 'platform'].includes(b.look)
        && (((b.minX + b.maxX) / 2) * Math.sin(layout.playerYaw) + ((b.minZ + b.maxZ) / 2) * Math.cos(layout.playerYaw)) < -layout.half * 0.15).map(b => b.group));
      assert.ok(far.size > 0, `${theme}/${type}/${seed}: far battle area lost its cover`);
      distantCoverGroups += far.size;
    }
  }
  assert.ok(distantCoverGroups > 300, 'central sightline should preserve substantial distant battle cover');
});
