// Hero-select performances (src/ui/heroPreview/heroes/heroShows.ts): every pose channel stays finite and inside the
// skin's range of motion measured by art/tools/review_native_rig.py (tail ≤ ~15° per joint, ears ≤ ~20° + spring slack).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPose, redPandaShow, pangolinShow, flyingSquirrelShow } from '../src/ui/heroPreview/heroes/heroShows.ts';

const L = { s: 1, shoulderL: [0.17, 1.1, 0], shoulderR: [-0.17, 1.1, 0], hipL: [0.1, 0.72, 0], hipR: [-0.1, 0.72, 0], chest: [0, 1.0, 0], head: [0, 1.25, 0] };
const SHOWS = { fox: redPandaShow, bear: pangolinShow, falcon: flyingSquirrelShow };
const TAIL_JOINTS = 6;

function* frames(show) {
  for (let u = 0; u <= show.intro; u += 1 / 30) yield [u, 4 + u, null];
  for (let t = 4; t < 16; t += 1 / 15) yield [-1, t, null];
  for (let i = 0; i < show.fidgets.length; i++)
    for (let u = 0; u <= show.fidgets[i]; u += 1 / 30) yield [-1, 20 + u, { index: i, u, w: Math.min(1, u / 0.3, (show.fidgets[i] - u) / 0.3) }];
}

for (const [id, make] of Object.entries(SHOWS)) test(`${id}: show poses are finite and within the rig's range of motion`, () => {
  const show = make(L);
  assert.ok(show.intro > 1.5 && show.intro < 3.5, 'intro length');
  assert.ok(['rise', 'self'].includes(show.entrance));
  const P = createPose();
  let n = 0;
  for (const [u, t, fid] of frames(show)) {
    show.pose(P, u, t, fid);
    const nums = [...Object.values(P.root), ...Object.values(P.hips), ...P.footL, ...P.footR, ...P.spine, ...P.neck, ...P.head,
      ...Object.values(P.gun), P.right.onGun, P.left.onGun, P.right.curl, P.left.curl, ...P.right.target, ...P.left.target,
      ...Object.values(P.tail), P.earL, P.earR, ...Object.values(P.fx)];
    for (const x of nums) assert.ok(Number.isFinite(x), `${id} non-finite pose value at u=${u} t=${t}`);
    const perJoint = Math.abs(P.tail.pitch) / TAIL_JOINTS + Math.abs(P.tail.curl) + Math.abs(P.tail.wave);
    assert.ok(perJoint <= 0.3, `${id} tail bends ${perJoint.toFixed(2)} rad per joint at u=${u}`);
    assert.ok(Math.abs(P.earL) <= 0.45 && Math.abs(P.earR) <= 0.45, `${id} ear flick out of range at u=${u}`);
    assert.ok(P.hips.drop >= -0.05 && P.hips.drop <= 0.4, `${id} hips drop ${P.hips.drop}`);
    n++;
  }
  assert.ok(n > 300);
});
