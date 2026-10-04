import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(await readFile(new URL('../src/world/AdventureRoadMask.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { bakeAdventureRoadMask } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Independent reference of the former GPU road formula, evaluated in world coordinates.
function reference(paths, x, z) {
  let weight = 0;
  for (const path of paths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / Math.max(dx * dx + dz * dz, .001)));
    const distance = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
    const inner = path.width * .5 * .55, outer = path.width * .5 + 1.4;
    const u = Math.max(0, Math.min(1, (distance - inner) / (outer - inner)));
    weight = Math.max(weight, 1 - u * u * (3 - 2 * u));
  }
  return weight;
}
function sample(mask, center, extent, x, z) {
  const n = mask.resolution, u = (x - center.x + extent) / (2 * extent) * n - .5, v = (z - center.z + extent) / (2 * extent) * n - .5;
  const ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
  const texel = (a, b) => mask.data[Math.max(0, Math.min(n - 1, b)) * n + Math.max(0, Math.min(n - 1, a))] / 255;
  return (texel(ix, iz) * (1 - fx) + texel(ix + 1, iz) * fx) * (1 - fz)
    + (texel(ix, iz + 1) * (1 - fx) + texel(ix + 1, iz + 1) * fx) * fz;
}
const regionPaths = [
  {
    "points": [
      {
        "x": -10.5,
        "z": 28.5
      },
      {
        "x": -24.5,
        "z": 15.5
      },
      {
        "x": -27.5,
        "z": -4.5
      },
      {
        "x": -25.5,
        "z": -18.5
      },
      {
        "x": -18.5,
        "z": -27.5
      },
      {
        "x": -5.5,
        "z": -28.5
      },
      {
        "x": 11.5,
        "z": -27.5
      },
      {
        "x": 12.5,
        "z": -12.5
      }
    ],
    "width": 6.2
  },
  {
    "points": [
      {
        "x": -10.5,
        "z": 28.5
      },
      {
        "x": 17.5,
        "z": 23.5
      },
      {
        "x": 26.5,
        "z": 9.5
      },
      {
        "x": 27.5,
        "z": -12.5
      },
      {
        "x": 12.5,
        "z": -12.5
      }
    ],
    "width": 6.2
  },
  {
    "points": [
      {
        "x": -10.5,
        "z": 28.5
      },
      {
        "x": -8.5,
        "z": 17.5
      },
      {
        "x": -8.5,
        "z": -1.5
      },
      {
        "x": -5.5,
        "z": -5.5
      },
      {
        "x": -5.5,
        "z": -12.5
      },
      {
        "x": -0.5,
        "z": -17.5
      },
      {
        "x": 12.5,
        "z": -12.5
      }
    ],
    "width": 5.8
  },
  {
    "points": [
      {
        "x": -8.5,
        "z": -1.5
      },
      {
        "x": -0.5,
        "z": 4.5
      },
      {
        "x": 8.5,
        "z": 4.45
      }
    ],
    "width": 5.4
  }
];
const origin = { x: 0, z: 0 };

test('empty road masks remain zero with one byte per texel', () => {
  const mask = bakeAdventureRoadMask([], origin, 45);
  assert.equal(mask.resolution, 512);
  assert.equal(mask.data.byteLength, 512 * 512);
  assert.ok(mask.data.every(value => value === 0));
});

test('all regional roads preserve their original blend within texture filtering precision', () => {
  const center = { x: 14.3, z: -7.2 }, extent = 45;
  const paths = regionPaths.map(path => ({ ...path, points: path.points.map(p => ({ x: p.x + center.x, z: p.z + center.z })) }));
  const mask = bakeAdventureRoadMask(paths, center, extent);
  let maximum = 0, total = 0, count = 0;
  for (let z = -45; z <= 45; z += .41) for (let x = -45; x <= 45; x += .43) {
    const worldX = x + center.x, worldZ = z + center.z;
    const error = Math.abs(sample(mask, center, extent, worldX, worldZ) - reference(paths, worldX, worldZ));
    maximum = Math.max(maximum, error); total += error; count++;
  }
  assert.ok(maximum < .035, `intersection filtering error: ${maximum}`);
  assert.ok(total / count < .0005, `average blend error: ${total / count}`);
  for (const path of paths) for (const p of path.points) assert.ok(sample(mask, center, extent, p.x, p.z) > .99, 'route waypoint lost its paving');
});

test('world-space offsets and quarter-turns keep road centers and gradients aligned', () => {
  const center = { x: 83.5, z: -41.25 }, extent = 45;
  for (let rotation = 0; rotation < 4; rotation++) {
    const transform = p => {
      for (let i = 0; i < rotation; i++) p = { x: p.z, z: -p.x };
      return { x: p.x + center.x, z: p.z + center.z };
    };
    const paths = [{ points: [transform({ x: -18, z: 7 }), transform({ x: 21, z: 7 })], width: 6 }];
    const mask = bakeAdventureRoadMask(paths, center, extent);
    for (const distance of [0, 1.5, 2.2, 3, 3.8, 4.4, 6]) {
      const point = transform({ x: 3, z: 7 + distance });
      assert.ok(Math.abs(sample(mask, center, extent, point.x, point.z) - reference(paths, point.x, point.z)) < .004, 'road gradient no longer follows world coordinates');
    }
  }
});

test('road intersections use the maximum weight rather than accumulating brightness', () => {
  const paths = [
    { points: [{ x: -15, z: 0 }, { x: 15, z: 0 }], width: 6 },
    { points: [{ x: 0, z: -15 }, { x: 0, z: 15 }], width: 4 },
  ];
  const mask = bakeAdventureRoadMask(paths, origin, 25);
  assert.equal(sample(mask, origin, 25, 0, 0), 1);
  for (const [x, z] of [[3, 3], [4, 3], [4, 4], [-3, -3]]) {
    assert.ok(Math.abs(sample(mask, origin, 25, x, z) - reference(paths, x, z)) < .015);
  }
});

test('roads beyond the former 32-segment shader limit are included', () => {
  const paths = Array.from({ length: 40 }, (_, i) => ({ points: [{ x: -78 + i * 4, z: -5 }, { x: -78 + i * 4, z: 5 }], width: 2 }));
  const mask = bakeAdventureRoadMask(paths, origin, 85);
  for (const path of paths) assert.ok(sample(mask, origin, 85, path.points[0].x, 0) > .99);
});

test('zero-length segments remain finite and match the original endpoint falloff', () => {
  const center = { x: 1.25, z: -2.5 }, paths = [{ points: [{ ...center }, { ...center }], width: 6 }];
  const mask = bakeAdventureRoadMask(paths, origin, 25);
  for (const distance of [0, 2, 3, 4, 5]) {
    assert.ok(Math.abs(sample(mask, origin, 25, center.x + distance, center.z) - reference(paths, center.x + distance, center.z)) < .004);
  }
  assert.throws(() => bakeAdventureRoadMask(paths, origin, 0), RangeError);
});
