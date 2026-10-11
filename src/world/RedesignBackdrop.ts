/**
 * Landscape beyond the V2 ramparts, so the walls stand in a desert instead of a void:
 *  - a dune field that starts flat under the rampart bodies and rolls up and away to the fog (seen from
 *    decks, gateway mouths and the exit; it also fills the gaps between rooms from above);
 *  - a ring of far mesas whose tops clear the rampart line from the arena floor. They ignore scene fog
 *    (at that range it would erase them) and are tinted towards the horizon colour instead;
 *  - low sand drifts banked against each rampart's foot, which soften the hard wall/floor line;
 *  - windblown sand lying on the floor in each room's corners and in patches along its walls, so the
 *    one earth texture does not run unbroken from wall to wall.
 * Pure geometry from the layout: nothing here collides, and nothing rises inside the playable floor.
 */
import * as THREE from 'three';
import type { ThemeDef } from '../core/types';
import type { LevelLayout } from './LevelTypes';
import type { RedesignArtPlacement } from './RedesignArtLayout';
import type { ThemeStyle } from './Themes';
import type { WhiteboxRect } from './WhiteboxTypes';
import { whiteboxPoint } from './WhiteboxGen';

/** Flat apron behind the walls (covers the 3 m rampart bodies) before dunes may rise. */
const APRON = 5;
/** Grid step of the dune field and how far it reaches past the level bounds. */
const STEP = 5, REACH = 230;
/** Mesas stand this far outside the level bounds; the camera far plane is 500 m. */
const MESA_NEAR = 140, MESA_FAR = 195;

function hash(x: number, z: number, seed: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in [0, 1]. */
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number, seed: number): number {
  let sum = 0, amp = .5, f = 1;
  for (let i = 0; i < 4; i++) { sum += amp * noise(x * f, z * f, seed + i * 13); amp *= .5; f *= 2.03; }
  return sum / .9375;
}

const smooth = (a: number, b: number, t: number) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** Distance from (x, z) to the playable floor (0 inside it). */
function floorDistance(rects: readonly WhiteboxRect[], x: number, z: number): number {
  let best = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.minX - x, 0, x - r.maxX), dz = Math.max(r.minZ - z, 0, z - r.maxZ);
    best = Math.min(best, dx * dx + dz * dz);
    if (best === 0) return 0;
  }
  return Math.sqrt(best);
}

export interface RedesignBackdrop { group: THREE.Group; dispose(): void }

export function buildRedesignBackdrop(L: LevelLayout, theme: ThemeDef, style: ThemeStyle, ramparts: readonly RedesignArtPlacement[],
  rand: () => number): RedesignBackdrop {
  const group = new THREE.Group(); group.name = 'redesign.backdrop';
  const owned: { dispose(): void }[] = [];
  const seed = Math.floor(rand() * 1000);
  const rects = L.whitebox!.floorRects;
  const sand = new THREE.Color(style.sand), crest = new THREE.Color(style.paving), trough = new THREE.Color(style.stone2);
  const horizon = new THREE.Color(theme.fogColor);

  // Dune field: one height grid around the whole level. Wind-aligned ridges plus broad swells.
  {
    const x0 = L.minX - REACH, x1 = L.maxX + REACH, z0 = L.minZ - REACH, z1 = L.maxZ + REACH;
    const cols = Math.ceil((x1 - x0) / STEP), rows = Math.ceil((z1 - z0) / STEP);
    const positions = new Float32Array((cols + 1) * (rows + 1) * 3), colors = new Float32Array(positions.length);
    const wind = new THREE.Vector2(.82, .57), c = new THREE.Color();
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP, k = (j * (cols + 1) + i) * 3;
      const d = floorDistance(rects, x, z);
      const along = (x * wind.x + z * wind.y) / 34 + fbm(x / 70, z / 70, seed) * 2.6;
      const ridge = Math.pow(1 - Math.abs(Math.sin(along * Math.PI)), 2.2);
      const swell = fbm(x / 140, z / 140, seed + 7);
      const h = smooth(APRON, APRON + 45, d) * (3 + ridge * 9 + swell * 16) + smooth(90, REACH, d) * swell * 22;
      positions[k] = x; positions[k + 1] = L.floorY - .06 + h; positions[k + 2] = z;
      c.copy(trough).lerp(sand, .55 + .45 * ridge).lerp(crest, Math.max(0, ridge - .7) * 1.4);
      colors[k] = c.r; colors[k + 1] = c.g; colors[k + 2] = c.b;
    }
    const index: number[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, cc = a + cols + 1, dd = cc + 1;
      index.push(a, cc, b, b, cc, dd);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(index); geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const dunes = new THREE.Mesh(geometry, material);
    dunes.name = 'redesign.backdrop.dunes'; dunes.receiveShadow = true;
    group.add(dunes); owned.push(geometry, material);
  }

  // Far mesas: layered sandstone buttes on a loose ring outside the level bounds.
  {
    const cx = (L.minX + L.maxX) / 2, cz = (L.minZ + L.maxZ) / 2, hx = (L.maxX - L.minX) / 2, hz = (L.maxZ - L.minZ) / 2;
    const rock = new THREE.Color(style.stone2).lerp(new THREE.Color(style.stone), .45), cap = new THREE.Color(style.stone);
    const sun = new THREE.Vector3(...style.sunDir).normalize();
    const parts: THREE.BufferGeometry[] = [];
    const count = 18;
    for (let n = 0; n < count; n++) {
      const angle = (n + .5 + (rand() - .5) * .6) / count * Math.PI * 2;
      const out = MESA_NEAR + rand() * (MESA_FAR - MESA_NEAR);
      // A point on the bounds' ellipse-ish outline pushed outwards by `out`.
      const ex = Math.cos(angle), ez = Math.sin(angle);
      const edge = 1 / Math.max(Math.abs(ex) / hx, Math.abs(ez) / hz);
      const px = cx + ex * (edge + out), pz = cz + ez * (edge + out);
      // Wide, flat-topped buttes read as distant; tall narrow spires read as nearby boulders.
      const height = 48 + rand() * 30, radius = 45 + rand() * 45, tiers = 3 + Math.floor(rand() * 3);
      const geo = new THREE.CylinderGeometry(radius * .8, radius, height, 16, tiers * 2, false);
      const pos = geo.getAttribute('position'), col = new Float32Array(pos.count * 3), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), t = (y + height / 2) / height;
        // Stepped tiers with a ragged outline; the cap is flat like a butte.
        const tier = Math.floor(t * tiers) / tiers, inset = 1 - tier * .2 - (hash(i, n, seed) - .5) * .14;
        const a = Math.atan2(z, x), wobble = 1 + (noise(Math.cos(a) * 2 + n, Math.sin(a) * 2, seed) - .5) * .35;
        pos.setXYZ(i, x * inset * wobble, y, z * inset * wobble);
      }
      geo.computeVertexNormals();
      const nrm = geo.getAttribute('normal');
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + height / 2) / height;
        // Unlit: a soft sun term from the smooth normal, then heavy aerial perspective towards the horizon.
        const lit = .58 + .4 * Math.max(0, nrm.getX(i) * sun.x + nrm.getY(i) * sun.y + nrm.getZ(i) * sun.z);
        c.copy(rock).lerp(cap, smooth(.85, 1, t) * .7).multiplyScalar(lit).lerp(horizon, .45 - t * .2);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.translate(px, L.floorY + height / 2 - 6, pz);
      parts.push(geo.toNonIndexed());
      geo.dispose();
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const mesas = new THREE.Mesh(merged, material);
    mesas.name = 'redesign.backdrop.mesas';
    group.add(mesas); owned.push(merged, material);
  }

  // Sand drifts banked against each rampart's inner face, dipping under the floor at their outer edge.
  {
    const positions: number[] = [], colors: number[] = [], uvs: number[] = [], index: number[] = [];
    const c = new THREE.Color();
    for (const r of ramparts) {
      const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), tx = fz, tz = -fx;
      // The inner face sits half a depth in front of the placement centre.
      const ox = r.x + fx * r.size[2] / 2, oz = r.z + fz * r.size[2] / 2;
      // Kit pieces abut without overlapping, so each drift spans exactly its own piece.
      const u0 = -r.size[0] / 2, u1 = r.size[0] / 2, segs = Math.max(2, Math.round((u1 - u0) / 1.5));
      const base = positions.length / 3;
      for (let s = 0; s <= segs; s++) {
        const u = u0 + s * (u1 - u0) / segs, wx = ox + tx * u, wz = oz + tz * u;
        // Ragged tongues of sand: a broad swell plus short lobes, so the toe never runs parallel to the wall.
        const lobe = fbm(wx / 6, wz / 6, seed + 3) * .6 + Math.pow(fbm(wx / 1.8, wz / 1.8, seed + 9), 2) * 1.4;
        const depth = .3 + lobe * 1.5, height = .06 + lobe * .16;
        // Three rows: buried under the wall, crest at the face, toe below the floor.
        for (const [k, out, y] of [[0, -.4, height], [1, depth * .35, height * .7], [2, depth, -.03]] as const) {
          const px = wx + fx * out, pz = wz + fz * out;
          positions.push(px, L.floorY + y, pz); uvs.push(px / 2.5, pz / 2.5);
          c.copy(sand).lerp(trough, .45).lerp(crest, k === 1 ? .1 : 0);
          colors.push(c.r, c.g, c.b);
        }
      }
      for (let s = 0; s < segs; s++) for (let k = 0; k < 2; k++) {
        const a = base + s * 3 + k, b = a + 1, cc = a + 3, dd = cc + 1;
        index.push(a, b, cc, b, dd, cc);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index); geometry.computeVertexNormals();
    const grain = sandGrain(rand);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    owned.push(grain);
    const drifts = new THREE.Mesh(geometry, material);
    drifts.name = 'redesign.backdrop.drifts'; drifts.receiveShadow = true;
    group.add(drifts); owned.push(geometry, material);
  }

  // Windblown sand on the floor: soft-edged patches heaped into room corners and strewn along the walls.
  {
    const plan = L.whitebox!.plan, wind = new THREE.Vector2(.82, .57);
    const positions: number[] = [], colors: number[] = [], uvs: number[] = [], index: number[] = [];
    const c = new THREE.Color();
    const patch = (x: number, z: number, radius: number, strength: number, k: number): void => {
      // A ragged disc stretched along the wind, opaque-ish in the middle and fading out at the rim.
      const base = positions.length / 3, rim = 28, y = L.floorY + .004;
      const push = (px: number, pz: number, alpha: number, tint: number): void => {
        positions.push(px, y, pz); uvs.push(px / 2.5, pz / 2.5);
        c.copy(sand).lerp(crest, .45 + tint).multiplyScalar(1.12); colors.push(c.r, c.g, c.b, alpha);
      };
      push(x, z, .9 * strength, .55);
      for (const [ring, alpha] of [[.55, .7 * strength], [1, 0]] as const) for (let i = 0; i < rim; i++) {
        const a = i / rim * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const stretch = 1 + .5 * Math.abs(ca * wind.x + sa * wind.y);
        const ragged = .7 + .6 * fbm(x / 3 + ca * 1.4, z / 3 + sa * 1.4, seed + 21 + k);
        const r = radius * ring * stretch * (ring < 1 ? 1 : ragged);
        push(x + ca * r, z + sa * r, alpha, ring < 1 ? .4 : .2);
      }
      for (let i = 0; i < rim; i++) {
        const j = (i + 1) % rim, a = base + 1 + i, b = base + 1 + j, oa = a + rim, ob = b + rim;
        index.push(base, b, a, a, b, ob, a, ob, oa);
      }
    };
    let k = 0;
    for (const room of plan.rooms) {
      const poly = room.polygon.map(p => whiteboxPoint(plan, p)), n = poly.length;
      poly.forEach((p, i) => {
        const prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
        // Corner heap: along the inward bisector, a couple of metres off the vertex.
        const ax = prev.x - p.x, az = prev.z - p.z, bx = next.x - p.x, bz = next.z - p.z;
        const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
        let ix = ax / la + bx / lb, iz = az / la + bz / lb;
        const li = Math.hypot(ix, iz) || 1; ix /= li; iz /= li;
        const cx = p.x + ix * 3, cz = p.z + iz * 3;
        if (floorDistance(rects, cx, cz) === 0) patch(cx, cz, 5 + hash(cx, cz, seed) * 3, 1, k++);
        // Strewn along the edge to the next vertex: one patch every ~11 m, set in from the wall.
        const count = Math.floor(lb / 11);
        for (let m = 1; m <= count; m++) {
          const t = (m - .5 + (hash(p.x + m, p.z, seed) - .5) * .6) / count, inset = 2 + hash(p.z, p.x + m, seed) * 1.5;
          // Inward normal of this edge: the side the bisector points to.
          let nx = -bz / lb, nz = bx / lb;
          if (nx * ix + nz * iz < 0) { nx = -nx; nz = -nz; }
          const ex = p.x + bx * t + nx * inset, ez = p.z + bz * t + nz * inset;
          if (hash(ex, ez, seed + 5) < .65 && floorDistance(rects, ex, ez) === 0) patch(ex, ez, 2.8 + hash(ez, ex, seed) * 2.2, .8, k++);
        }
      });
    }
    if (index.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(index); geometry.computeVertexNormals();
      const grain = sandGrain(rand);
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 1, metalness: 0, transparent: true,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const patches = new THREE.Mesh(geometry, material);
      patches.name = 'redesign.backdrop.floorSand'; patches.receiveShadow = true; patches.renderOrder = .5;
      group.add(patches); owned.push(geometry, material, grain);
    }
  }

  return { group, dispose: () => { for (const o of owned) o.dispose(); owned.length = 0; group.clear(); } };
}

/** Concatenate non-indexed geometries that share position/normal/color attributes. */
function mergeGeometries(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = parts.reduce((n, p) => n + p.getAttribute('position').count, 0);
  const position = new Float32Array(total * 3), color = new Float32Array(total * 3);
  let at = 0;
  for (const p of parts) {
    position.set(p.getAttribute('position').array as Float32Array, at * 3);
    color.set(p.getAttribute('color').array as Float32Array, at * 3);
    at += p.getAttribute('position').count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return merged;
}

/** Small tiling speckle so sand drifts are not flat colour. */
function sandGrain(rand: () => number): THREE.CanvasTexture {
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(205 + rand() * 50);
    g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    g.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1 + Math.floor(rand() * 2), 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
