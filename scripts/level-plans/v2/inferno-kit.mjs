// Chapter-3 (祝融火狱) helpers for the V2 floor plans (inferno-1..5.mjs): set-dressing boxes and portal-shrine pylons
// sized to the published Zhurong kit (local Hunyuan3D), lava voids, polar / spiral geometry and a design lint that keeps
// decks and covers off the lava.
//
// Lava is a damaging floor at runtime (src/world/Lava.ts, USER DECISION 2026-10-11 「熔岩做成伤害地面」): no fence;
// the player who steps, falls or is knocked in takes a fire burst and is lifted back to the last safe standing spot;
// ground enemies path around it and die when knocked in. Two plan shapes produce lava cells (WhiteboxGen):
//  - a lava void (`kind: 'lava'`): every non-floor cell inside the circle (lakes; channels as chains of overlapping
//    circles, lavaStrip);
//  - a lava hazard strip (`hazards[].kind = 'lava'`): floor cells within half its width of a polyline (inferno-5's
//    narrow channels cut through the hall floor).
// With no fence to land on, decks and standable covers no longer need the old 10 m / 6 m clearance; lintLava keeps
// decks, stairs and their feet 2 m clear and covers 1 m clear of lava (the player's safe spot keeps 1 m from lava), and
// keeps lava off the map border.
import { dress } from './common.mjs';

/**
 * Published LOD0 footprints of the Zhurong kit (public/assets/manifest.json bounds): width x depth x height in metres,
 * then the uniform scale the piece stands at in a level, so the art (fitted per axis into its box) is never stretched.
 * stall = 铁匠锻炉摊, goods = 铁锭矿石堆, hoard = 祝融火宝藏, ruin = 倾覆巨鼎（鼎口流出炉渣）, brazier = 祝融火坛.
 */
const FOOTPRINTS = {
  stall: [2.598, 1.631, 3.469, 1.35], goods: [2.184, 1.813, 1.522, 1.25], hoard: [2.312, 1.556, 1.713, 1.4],
  ruin: [3.105, 1.527, 1.538, 1.5], brazier: [1.134, 1.151, 2.356, 1.2],
};
const r2 = v => +v.toFixed(2);

/** Set dressing centred on a point, its front looking `face` (+y is south); the box keeps the model's proportions. */
export const prop = (art, x, y, face = 'south', scale = FOOTPRINTS[art][3]) => {
  const [w0, d0, h0] = FOOTPRINTS[art], sideways = face === 'east' || face === 'west';
  const hx = (sideways ? d0 : w0) * scale / 2, hy = (sideways ? w0 : d0) * scale / 2;
  return dress(r2(x - hx), r2(y - hy), r2(x + hx), r2(y + hy), r2(h0 * scale), art, face);
};

/**
 * A bronze ding cauldron on its basalt pedestal: the kit's fire altar at a large uniform scale (`size` / 1.6, so the
 * default 3.2 stands 2.27 m wide and 4.71 m tall; the shrine's smaller 2.4 pair 1.70 m and 3.53 m). Too tall to stand on
 * from the floor (jump apex about 2.7 m); burns with the altar's glow.
 */
export const ding = (x, y, size = 3.2) => prop('brazier', x, y, 'south', size / 1.6);

/**
 * Portal-shrine pylons for the Zhurong shrine (RedesignArtLayout REDESIGN_KIT_SHAPES.inferno: published 7.589 m wide,
 * placed at 1.3x = 9.866 m wide, 2.798 m deep, inner arch 4.16 m). The back stands on the room edge at `wall`, centred
 * at `centre`, front looking `face` into the room; the exit point is 5.5 m in front of the wall and the generator opens
 * the portal in the arch. `height` keeps the plan's tallest cover (the outer wall height follows the tallest standable
 * top, so the pylons never raise the ramparts). Pylons are 3.3 m deep (the portal stands 1.5 m off the wall and the
 * generator's invisible slab closes the arch 0.2 m inside the pylons' front), so the shrine stands 0.5 m proud of the
 * wall with its front on the pylons' front and its recess wall just behind the portal.
 */
const SHRINE = { width: 9.866, depth: 3.3, arch: 4.2 };
export const shrine = (wall, centre, face, height) => {
  const { width, depth, arch } = SHRINE;
  const into = { west: -1, east: 1, north: -1, south: 1 }[face];
  const d0 = Math.min(wall, wall + into * depth), d1 = Math.max(wall, wall + into * depth);
  const pylons = [[centre - width / 2, centre - arch / 2], [centre + arch / 2, centre + width / 2]];
  const along = face === 'west' || face === 'east';
  const covers = pylons.map(([u0, u1]) => along
    ? dress(r2(d0), r2(u0), r2(d1), r2(u1), height, 'shrine', face)
    : dress(r2(u0), r2(d0), r2(u1), r2(d1), height, 'shrine', face));
  const exit = along ? [r2(wall + into * 5.5), centre] : [centre, r2(wall + into * 5.5)];
  return { covers, exit };
};

/** A lava pool: a lava void (non-floor cells inside the circle are lava floor). */
export const lavaPool = (id, label, center, radius) => ({ id, label, center, radius, kind: 'lava' });

/**
 * A lava channel of half-width `half` along a polyline, as overlapping circles: radius half + 1.2, spaced so their union
 * covers the full channel width. Circles bleed up to 1.45 m beyond the channel; on floor that changes nothing, on the
 * outer mass it turns a sliver of wall into fence (keep channel ends off the map border).
 */
export function lavaStrip(id, label, points, half) {
  const radius = half + 1.2, spacing = 2 * Math.sqrt(radius ** 2 - half ** 2) * .9, out = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(length / spacing));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push({ id: `${id}-${out.length + 1}`, label,
      center: [r2(a[0] + (b[0] - a[0]) * k / n), r2(a[1] + (b[1] - a[1]) * k / n)], radius: r2(radius), kind: 'lava' });
  }
  return out;
}

/** Point at angle `a` (radians, 0 = east, +π/2 = south on the plan) and radius `r` around `c`. */
export const polar = (c, a, r) => [r2(c[0] + Math.cos(a) * r), r2(c[1] + Math.sin(a) * r)];
/** Arc points from angle a0 to a1 (either direction), `steps` segments. */
export const arc = (c, r, a0, a1, steps) => Array.from({ length: steps + 1 }, (_, i) => polar(c, a0 + (a1 - a0) * i / steps, r));

/**
 * A spiral band (the descending ramp of a shaft): at lap fraction t the band spans radii [inner(t), outer(t)] at angle
 * angle(t). Returns the polygon of the band between t0 and t1: outer edge forwards, inner edge back.
 */
export function spiralBand(c, angle, outer, inner, t0, t1, perLap = 72) {
  const steps = Math.max(2, Math.ceil(Math.abs(t1 - t0) * perLap));
  const ts = Array.from({ length: steps + 1 }, (_, i) => t0 + (t1 - t0) * i / steps);
  return [...ts.map(t => polar(c, angle(t), outer(t))), ...ts.reverse().map(t => polar(c, angle(t), inner(t)))];
}

// ---------------------------------------------------------------------------------------------------------------
// Design lint (mirrors WhiteboxGen's 0.5 m raster: floor = rooms + passage capsules; lava = non-floor inside a lava
// void circle, or non-cover floor inside a lava hazard strip).

const GRID = .5, PAD = 2;
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
export function inside(p, polygon) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (segmentDistance(p, a, b) < 1e-7) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}
export const area = polygon => Math.abs(polygon.reduce((s, p, i) => { const q = polygon[(i + 1) % polygon.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

const STEP_RISE = .4, STEP_DEPTH = .65;
/** Deck rect plus each stair's footprint and foot point (same arithmetic as WhiteboxGen.buildPlatform). */
function deckParts(d) {
  const [ax, ay, bx, by] = d.rect, x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, run = (Math.max(2, Math.round(d.height / STEP_RISE)) - 1) * STEP_DEPTH;
  const stairs = d.stairs.map(s => {
    const o = s.offset ?? 0, h = s.width / 2;
    switch (s.side) {
      case 'east': return { rect: [x1, cy + o - h, x1 + run, cy + o + h], foot: [x1 + run + 1.4, cy + o] };
      case 'west': return { rect: [x0 - run, cy + o - h, x0, cy + o + h], foot: [x0 - run - 1.4, cy + o] };
      case 'south': return { rect: [cx + o - h, y1, cx + o + h, y1 + run], foot: [cx + o, y1 + run + 1.4] };
      default: return { rect: [cx + o - h, y0 - run, cx + o + h, y0], foot: [cx + o, y0 - run - 1.4] };
    }
  });
  return { rect: [x0, y0, x1, y1], stairs };
}

/**
 * Throws when a deck (with its stairs and stair feet) comes within `deckGap` metres of a lava cell, any cover within
 * `coverGap`, a stair or its foot leaves the floor, or lava reaches the map border. Prints the plan's key numbers.
 * (Before lava became a damaging floor it was a climbable fence, and decks / standable covers kept 10 m / 6 m away.)
 */
export function lintLava(plan, { deckGap = 2, coverGap = 1 } = {}) {
  const [w, h] = plan.bounds, cols = Math.ceil((w + PAD * 2) / GRID), rows = Math.ceil((h + PAD * 2) / GRID);
  const voids = (plan.voids ?? []).filter(v => v.kind === 'lava'), strips = (plan.hazards ?? []).filter(z => z.kind === 'lava');
  const problems = [];
  for (const v of plan.voids ?? []) if (v.kind !== 'lava') problems.push(`void ${v.id} is a fenced hole, not lava (use lavaPool / lavaStrip)`);
  const floorAt = p => plan.rooms.some(r => inside(p, r.polygon))
    || plan.passages.some(path => path.points.some((b, i) => i > 0 && segmentDistance(p, path.points[i - 1], b) <= path.width / 2));
  const stripAt = p => strips.some(z => z.points.some((b, i) => i > 0 && segmentDistance(p, z.points[i - 1], b) <= z.width / 2));
  const coverAt = p => plan.covers.some(c => inside(p, c.polygon));
  const lava = [];
  const bucket = new Map(), key = (x, y) => `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const p = [(x + .5) * GRID - PAD, (z + .5) * GRID - PAD];
    const floor = floorAt(p);
    const isLava = floor ? stripAt(p) && !coverAt(p) : voids.some(v => Math.hypot(p[0] - v.center[0], p[1] - v.center[1]) <= v.radius + GRID / 2);
    if (!isLava) continue;
    if (x <= 1 || z <= 1 || x >= cols - 2 || z >= rows - 2) problems.push(`lava reaches the map border at (${p[0]}, ${p[1]})`);
    lava.push(p);
    const k = key(...p); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(p);
  }
  const nearest = ([x0, y0, x1, y1], reach) => {
    let best = Infinity;
    for (let bx = Math.floor((x0 - reach) / 8); bx <= Math.floor((x1 + reach) / 8); bx++)
      for (let by = Math.floor((y0 - reach) / 8); by <= Math.floor((y1 + reach) / 8); by++)
        for (const p of bucket.get(`${bx},${by}`) ?? []) {
          best = Math.min(best, Math.hypot(Math.max(x0 - p[0], 0, p[0] - x1), Math.max(y0 - p[1], 0, p[1] - y1)));
        }
    return best;
  };
  for (const d of plan.platforms ?? []) {
    const parts = deckParts(d);
    for (const r of [parts.rect, ...parts.stairs.map(s => s.rect), ...parts.stairs.map(s => [s.foot[0], s.foot[1], s.foot[0], s.foot[1]])]) {
      const gap = nearest(r, deckGap + 2);
      if (gap < deckGap) problems.push(`${d.id}: ${gap.toFixed(1)} m from lava (needs ${deckGap})`);
    }
    for (const s of parts.stairs) {
      const [x0, y0, x1, y1] = s.rect;
      for (const p of [[x0 + .2, y0 + .2], [x1 - .2, y0 + .2], [x0 + .2, y1 - .2], [x1 - .2, y1 - .2], s.foot])
        if (!floorAt(p)) problems.push(`${d.id}: stair or foot off the floor at (${p.map(v => v.toFixed(1))})`);
    }
    for (const [x, y] of [[parts.rect[0] + .2, parts.rect[1] + .2], [parts.rect[2] - .2, parts.rect[1] + .2], [parts.rect[0] + .2, parts.rect[3] - .2], [parts.rect[2] - .2, parts.rect[3] - .2]])
      if (!floorAt([x, y])) problems.push(`${d.id}: deck corner off the floor at (${x}, ${y})`);
  }
  for (const c of plan.covers) {
    const xs = c.polygon.map(p => p[0]), ys = c.polygon.map(p => p[1]);
    const gap = nearest([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], coverGap + 2);
    if (gap < coverGap) problems.push(`cover at (${xs[0]}, ${ys[0]}) h ${c.height}: ${gap.toFixed(1)} m from lava (needs ${coverGap})`);
  }
  const main = plan.mainRoute.reduce((s, id) => { const p = plan.passages.find(x => x.id === id).points; return s + p.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0); }, 0);
  console.log(`  ${plan.id}: main connectors ${main.toFixed(1)} m, ${voids.length} lava circles, ${strips.length} lava strips, ${lava.length} lava cells; rooms ${plan.rooms.map(r => `${r.id} ${Math.round(area(r.polygon))}`).join(', ')}`);
  if (problems.length) throw new Error(`${plan.id} lava lint:\n  ${problems.join('\n  ')}`);
}
