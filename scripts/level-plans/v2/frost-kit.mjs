// Chapter-2 set dressing for the V2 floor plans (frost-1..5.mjs): cover boxes sized to the published Hunyuan kit
// pieces of the Kunlun kit (frost-1/2/4) and the North-Sea kit (frost-3/5), and their portal shrines.
// common.mjs `prop` / `shrine` are sized to the desert models; these follow each frost model's own footprint.
import { dress } from './common.mjs';

/**
 * Published LOD0 footprints (public/assets/manifest.json bounds): width x depth x height in metres, then the uniform
 * scale the piece stands at in a level, so the art (fitted per axis into its box) is never stretched.
 *  - kunlun: stall = pilgrims' prayer tent, goods = frozen offerings, hoard = the Queen Mother's jade,
 *    ruin = toppled white-jade column, brazier = bronze ice lantern;
 *  - sea: stall = fishermen's yurt, goods = fish-drying rack, hoard = pearl and whale-ivory hoard,
 *    ruin = broken mast and sail, brazier = whale-oil bone lantern.
 */
const FOOTPRINTS = {
  kunlun: {
    stall: [4.005, 3.864, 3.531, 1], goods: [1.739, 1.299, 1.545, 1.5], hoard: [2.816, 1.674, 1.716, 1.3],
    ruin: [4.079, 2.105, 1.578, 1], brazier: [.899, .886, 2.362, 1.2],
  },
  sea: {
    stall: [3.16, 3.087, 3.418, 1.15], goods: [1.412, .730, 1.540, 1.6], hoard: [1.831, 1.286, 1.721, 1.4],
    ruin: [2.157, 1.186, 1.578, 1.8], brazier: [1.004, .720, 2.357, 1.2],
  },
};

/** Set dressing centred on a point, its front looking `face` (+y is south); the box keeps the model's proportions. */
export const frostProp = kit => (art, x, y, face = 'south') => {
  const [w0, d0, h0, s] = FOOTPRINTS[kit][art], sideways = face === 'east' || face === 'west', r = v => +v.toFixed(2);
  const hx = (sideways ? d0 : w0) * s / 2, hy = (sideways ? w0 : d0) * s / 2;
  return dress(r(x - hx), r(y - hy), r(x + hx), r(y + hy), r(h0 * s), art, face);
};

/**
 * Portal-shrine pylons for the kit's shrine (RedesignArtLayout REDESIGN_KIT_SHAPES: Kunlun 10.458 m wide, 2.937 m
 * deep, arch about 5.2 m at the ground; North-Sea ice grotto 7.623 m wide, 3.713 m deep, arch about 4.4 m). The back
 * stands on the room edge at `wall`, centred at `centre`, front looking `face` into the room; the exit point is
 * 5.5 m in front of the wall and the generator opens the portal in the arch. `height` keeps the plan's tallest
 * cover (the outer wall height follows the tallest standable top, so the pylons never raise the ramparts).
 * Pylons are at least 3.3 m deep: the portal (1.5 m body half-width) stands 1.5 m off the wall and the generator's
 * invisible slab closes the arch 0.2 m inside the pylons' front, so a shallower front would cut into the portal. The
 * Kunlun shrine (2.937 m) therefore stands 0.36 m proud of the wall, its front on the pylons' front.
 */
const SHRINES = { kunlun: { width: 10.458, depth: 2.937, arch: 5.2 }, sea: { width: 7.623, depth: 3.713, arch: 4.4 } };
export const frostShrine = kit => (wall, centre, face, height) => {
  const { width, arch } = SHRINES[kit], depth = Math.max(SHRINES[kit].depth, 3.3), r = v => +v.toFixed(2);
  const into = { west: -1, east: 1, north: -1, south: 1 }[face];
  const d0 = Math.min(wall, wall + into * depth), d1 = Math.max(wall, wall + into * depth);
  const pylons = [[centre - width / 2, centre - arch / 2], [centre + arch / 2, centre + width / 2]];
  const along = face === 'west' || face === 'east';
  const covers = pylons.map(([u0, u1]) => along
    ? dress(r(d0), r(u0), r(d1), r(u1), height, 'shrine', face)
    : dress(r(u0), r(d0), r(u1), r(d1), height, 'shrine', face));
  const exit = along ? [r(wall + into * 5.5), centre] : [centre, r(wall + into * 5.5)];
  return { covers, exit };
};
