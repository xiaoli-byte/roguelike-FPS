// Shared helpers for the V2 floor-plan scripts (desert-2.mjs …): geometry, cover and set-dressing boxes sized to
// the published Tripo models, gate posts and portal-shrine pylons, and writing a plan into its chapter JSON.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Axis-aligned polygon from two corners. */
export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** Octagon with chamfered corners: readable arena outline without a boxy silhouette. */
export const arena = (x0, y0, x1, y1, c = 6) => [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];
/** Elliptic polygon (rounded basins, lake shores): `sides` vertices, starting at angle `rot` (radians, 0 = east). */
export const ngon = (cx, cy, rx, ry, sides, rot = 0) => Array.from({ length: sides }, (_, i) => {
  const a = rot + i / sides * Math.PI * 2;
  return [+(cx + Math.cos(a) * rx).toFixed(2), +(cy + Math.sin(a) * ry).toFixed(2)];
});
/**
 * A full ring around an impassable core, as one polygon: the outer loop, then the inner loop backwards, joined by a
 * zero-width seam at angle `seam` (the seam's cells count as floor, so the ring stays closed).
 */
export const ring = (cx, cy, outer, inner, sides, seam = 0) => {
  const at = (r, i) => { const a = seam + i / sides * Math.PI * 2; return [+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)]; };
  return [...Array.from({ length: sides + 1 }, (_, i) => at(outer, i)), ...Array.from({ length: sides + 1 }, (_, i) => at(inner, sides - i))];
};
export const cover = (x0, y0, x1, y1, height) => ({ polygon: rect(x0, y0, x1, y1), height });
export const pillar = (x, y, size = 2, height = 4.5) => cover(x - size / 2, y - size / 2, x + size / 2, y + size / 2, height);
/** Cover heights: vaultable low wall, full cover wall. */
export const LOW = 1.2, FULL = 2.6;
/** Set dressing that is also solid cover: `art` names the model, `face` the plan direction its front looks. */
export const dress = (x0, y0, x1, y1, height, art, face) => ({ ...cover(x0, y0, x1, y1, height), art, face });

/**
 * Set dressing centred on a point, its box following the published model's own footprint at a uniform scale
 * (width x depth in metres, the depth along `face`): stall 3.7 x 2.2, goods 2.6 x 2.0, hoard 3.6 x 2.7,
 * ruin 6 x 3, brazier 1.4 x 1.4. Heights are the models' own.
 */
const DRESSING = {
  stall: { w: 3.7, d: 2.2, h: 3.6 }, goods: { w: 2.6, d: 2, h: 2.5 }, hoard: { w: 3.6, d: 2.7, h: 2.5 },
  ruin: { w: 6, d: 3, h: 1.6 }, brazier: { w: 1.4, d: 1.4, h: 2.4 },
};
export const prop = (art, x, y, face = 'south') => {
  const { w, d, h } = DRESSING[art], sideways = face === 'east' || face === 'west';
  const hx = (sideways ? d : w) / 2, hy = (sideways ? w : d) / 2;
  return dress(+(x - hx).toFixed(2), +(y - hy).toFixed(2), +(x + hx).toFixed(2), +(y + hy).toFixed(2), h, art, face);
};

/**
 * A gateway spanning an entrance where two rooms meet directly: two 'gate' posts on the shared edge, scaled so
 * the gateway (13.524 m wide, 4.01 m deep, posts 4.0675 m each) spans exactly `span` metres from `from`.
 * `axis` is the plan axis the edge runs along ('x' or 'y'), `at` the edge's coordinate on the other axis, and
 * `face` the direction the gateway's front looks (into the room it is approached from).
 */
export const gatePosts = (axis, from, span, at, face, height = 9) => {
  const s = span / 13.524, post = 4.0675 * s, half = 4.01 * s / 2, r = v => +v.toFixed(2);
  const a = [from, from + post], b = [from + span - post, from + span];
  return [a, b].map(([u0, u1]) => axis === 'x'
    ? dress(r(u0), r(at - half), r(u1), r(at + half), height, 'gate', face)
    : dress(r(at - half), r(u0), r(at + half), r(u1), height, 'gate', face));
};

/**
 * The portal-shrine pylons (published shrine 9.68 m wide, 3.3 m deep, arch ~4.9 m): its back on a straight room
 * edge at `wall` (plan coordinate on the axis the shrine faces along), centred at `centre` on the other axis,
 * facing `face` (into the room). The exit point is placed 5.5 m in front of the wall, which puts the portal
 * (four metres further in) in the arch.
 */
export const shrine = (wall, centre, face) => {
  const r = v => +v.toFixed(2), into = { west: -1, east: 1, north: -1, south: 1 }[face];
  // `into` points from the wall into the room; the pylons reach 3.3 m that way.
  const d0 = Math.min(wall, wall + into * 3.3), d1 = Math.max(wall, wall + into * 3.3);
  const pylons = [[centre - 4.84, centre - 2.45], [centre + 2.45, centre + 4.84]];
  const along = face === 'west' || face === 'east';
  const covers = pylons.map(([u0, u1]) => along
    ? dress(r(d0), r(u0), r(d1), r(u1), 9, 'shrine', face)
    : dress(r(u0), r(d0), r(u1), r(d1), 9, 'shrine', face));
  const exit = along ? [r(wall + into * 5.5), centre] : [centre, r(wall + into * 5.5)];
  return { covers, exit };
};

/** Write (or replace) one plan in docs/level-design/plans-v2/<chapter>.json, ordered by index. */
export async function writePlan(plan) {
  const target = resolve(root, `docs/level-design/plans-v2/${plan.chapter}.json`);
  await mkdir(dirname(target), { recursive: true });
  const existing = await readFile(target, 'utf8').then(JSON.parse, () => []);
  const plans = [...existing.filter(p => p.id !== plan.id), plan].sort((a, b) => a.index - b.index);
  await writeFile(target, JSON.stringify(plans, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${plan.id} to docs/level-design/plans-v2/${plan.chapter}.json`);
}
