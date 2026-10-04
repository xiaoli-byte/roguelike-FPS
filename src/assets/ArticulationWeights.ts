/**
 * Correct the generated sleeve weights of two humanoid bodies without changing their art geometry.
 * Generated cuffs occasionally mix a hand with the hips; lifting the arm then stretches a 12 mm
 * edge to 195 mm. Outside the torso, lower sleeves should follow their own arm chain.
 * The shoulder seam retains its original blend. Positions, indices, UVs and materials are shared.
 */
import * as THREE from 'three';

const TARGETS = new Set(['SK_Enemy_Mortar', 'SK_Enemy_Shaman']);
const cache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
const point = new THREE.Vector3();
const along = new THREE.Vector3();
const nearest = new THREE.Vector3();

function smooth(a: number, b: number, n: number): number {
  const t = THREE.MathUtils.clamp((n - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * boneInverses must be the runtime inverse rest matrices in geometry/model space, in skinIndex order.
 * Returns a cached corrected geometry for the two known bodies, or the original for other assets.
 * Only skinWeight is owned by the returned geometry; all visual attributes remain the originals.
 */
export function articulationGeometry(
  assetId: string,
  geometry: THREE.BufferGeometry,
  jointNames: readonly string[],
  boneInverses: readonly THREE.Matrix4[],
): THREE.BufferGeometry {
  if (!TARGETS.has(assetId)) return geometry;
  const position = geometry.getAttribute('position');
  const indices = geometry.getAttribute('skinIndex');
  const source = geometry.getAttribute('skinWeight');
  if (!position || !indices || !source || source.itemSize !== 4) return geometry;
  const key = assetId + ':' + boneInverses.map(m => m.elements.map(n => Math.round(n * 1e5)).join(',')).join(';');
  const previous = cache.get(geometry)?.get(key);
  if (previous) return previous;

  const rest = jointNames.map((_, i) => boneInverses[i]?.clone().invert());
  const chains = ['L', 'R'].map(side => {
    const names = ['arm' + side, 'elbow' + side, 'hand' + side];
    const ids = names.map(name => jointNames.indexOf(name));
    if (ids.some(i => i < 0 || !rest[i])) return null;
    const shoulder = new THREE.Vector3().setFromMatrixPosition(rest[ids[0]]!);
    const elbow = new THREE.Vector3().setFromMatrixPosition(rest[ids[1]]!);
    const wrist = new THREE.Vector3().setFromMatrixPosition(rest[ids[2]]!);
    const direction = wrist.clone().sub(shoulder).normalize();
    return { ids, shoulder, direction, upperLength: elbow.distanceTo(shoulder), length: wrist.distanceTo(shoulder) };
  }).filter((chain): chain is NonNullable<typeof chain> => !!chain);
  if (chains.length !== 2) return geometry;

  const weights = new Float32Array(source.count * 4);
  let corrected = 0;
  for (let i = 0; i < source.count; i++) {
    const ids = [indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)];
    const old = [source.getX(i), source.getY(i), source.getZ(i), source.getW(i)];
    weights.set(old, i * 4);
    point.fromBufferAttribute(position, i);
    // Pick the arm that actually owns this point; a sleeve may still have a small opposite-arm influence.
    const chain = chains.reduce((best, current) => {
      const mass = ids.reduce((sum, id, k) => sum + (current.ids.includes(id) ? old[k] : 0), 0);
      return mass > best.mass ? { value: current, mass } : best;
    }, { value: chains[0], mass: 0 });
    if (chain.mass < 0.12) continue;
    const c = chain.value;
    along.subVectors(point, c.shoulder);
    const depth = along.dot(c.direction);
    // The mortar's armpit contains a real cloth bridge to the torso. Keep that entire upper-arm
    // transition; only its distal forearm/cuff can safely lose foreign-body influences.
    const start = assetId === 'SK_Enemy_Mortar' ? c.upperLength + 0.035 : c.upperLength * 0.35;
    const end = assetId === 'SK_Enemy_Mortar' ? c.upperLength + 0.11 : c.upperLength * 0.80;
    if (depth < start || depth > c.length + 0.25) continue;
    nearest.copy(c.shoulder).addScaledVector(c.direction, THREE.MathUtils.clamp(depth, 0, c.length + 0.25));
    const radius = point.distanceTo(nearest);
    const outsideTorso = smooth(Math.abs(c.shoulder.x) * 0.62, Math.abs(c.shoulder.x) * 0.75, Math.abs(point.x));
    const corridor = 1 - smooth(assetId === 'SK_Enemy_Shaman' ? 0.20 : 0.17, assetId === 'SK_Enemy_Shaman' ? 0.30 : 0.25, radius);
    const amount = smooth(start, end, depth)
      * smooth(0.12, 0.28, chain.mass) * outsideTorso * corridor;
    if (amount < 1e-5) continue;
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const armOnly = c.ids.includes(ids[k]) ? old[k] / chain.mass : 0;
      weights[i * 4 + k] = old[k] * (1 - amount) + armOnly * amount;
      sum += weights[i * 4 + k];
    }
    if (sum > 0) for (let k = 0; k < 4; k++) weights[i * 4 + k] /= sum;
    corrected++;
  }
  if (corrected === 0) return geometry;
  const clone = geometry.clone();
  // Reuse the untouched visual buffers, including skinIndex; only weights receive a new buffer.
  for (const name of Object.keys(geometry.attributes)) clone.setAttribute(name, geometry.getAttribute(name));
  clone.setIndex(geometry.index);
  clone.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
  clone.userData = { ...geometry.userData, articulationWeightCorrections: corrected };
  let byKey = cache.get(geometry);
  if (!byKey) { byKey = new Map(); cache.set(geometry, byKey); }
  byKey.set(key, clone);
  return clone;
}
