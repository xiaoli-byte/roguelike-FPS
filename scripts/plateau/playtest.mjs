// 第四章战斗的脚本化试玩（docs/level-design/chuanzang-combat-v1.md 第 6 节）：
//   node scripts/plateau/playtest.mjs <场景…> [--url http://localhost:5199] [--out docs/art/review/ch4-combat]
// 场景：
//   smoke                    每种怪刷一只跑 6 秒（不报错、会出招）
//   foes | foes:kind,kind    每只怪的每个招式（前摇 / 出手 / 收招）和两种死法截图，拼成 foe-<种类>.jpg
//   kui feilian huashe       4-1 三个领主：登场（镜头表逐镜截图 + 落回第一人称的误差）→ 每招 → 转二、三阶段 → 破防 → 死亡
//   dae                      4-2 大鹗（同上）
//   leize                    4-4 雷泽雷神
//   poses --who kui --list "roar:active:0.5,…"   定格姿势逐张截图（--tmp 目录）
//   eval --js "…" [--shot 路径] [--map 4-1]        在页面里跑一段代码
//   findflat                 找一块平、干、远离遇敌的空地
// 先开 dev 服务器（npm run dev -- --port 5199）。页面在后台不给 rAF：一律用页面自己的 simulate 按固定步长推进，截图前手动渲染一帧。
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://localhost:5199');
const SHEETS = opt('--out', 'docs/art/review/ch4-combat');
/** 原始截图（不入库，.gitignore）；每个场景结束拼成审阅总图放 SHEETS */
const OUT = `${SHEETS}/raw`;
mkdirSync(OUT, { recursive: true });
function sheet(name, files, cols = 4) {
  if (!files.length) return;
  const r = spawnSync('python', ['scripts/plateau/contact_sheet.py', `${SHEETS}/${name}.jpg`, ...files, '--cols', String(cols), '--w', '400'], { encoding: 'utf-8' });
  console.log(r.stdout.trim() || r.stderr.trim());
}
const wanted = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

// ───────────── 页面里的工具（每次打开页面注入一次） ─────────────
function pageTools() {
  const G = window.plateau ?? window.gorge ?? window.haizi;
  window.G = G;
  const sim = (s, st, r) => (G.sim ?? G.simulate)(s, st, r);
  const T = {
    /** 推进直到 pred() 为真（最多 max 秒），返回用了多久；没等到返回 −1 */
    until(pred, max = 20, step = 1 / 30) {
      let t = 0;
      while (t < max) { if (pred()) return t; sim(step, step, false); t += step; }
      return -1;
    },
    run(sec, step = 1 / 30) { if (sec > 0) sim(sec, step, false); },
    /** 截图前：渲染一帧 */
    frame() { sim(1 / 30, 1 / 30, true); },
    flat: [-50, 145],
    V: (x, y, z) => new G.camera.position.constructor(x, y, z),
    /** 截图：藏起检视页的面板、平面图、提示 */
    clean() {
      if (document.getElementById('t-clean')) return;
      const st = document.createElement('style');
      st.id = 't-clean';
      st.textContent = '#panel,#map,#hud,#perf,#hint,#checks,#cross,#maps{display:none!important}';
      document.head.appendChild(st);
    },
    reset(x, z) {
      const P = G.play;
      for (const f of P.foes) if (f.enc && String(f.enc.id).startsWith('dev-') && f.host.visible) { if (f.alive) f.die(); f.host.visible = false; }
      G.walker.place(x ?? T.flat[0], z ?? T.flat[1]);
      P.dev.heal();
    },
    /** 玩家眼睛的位姿（镜头交还时应该在这） */
    eyePose() {
      const W = G.walker, cam = G.camera;
      const e = T.V(0, 0, 0); W.eye(e);
      const q = cam.quaternion.clone().setFromEuler(new cam.rotation.constructor(W.pitch, W.yaw, 0, 'YXZ'));
      return { e, q };
    },
  };
  window.T = T;
  return true;
}

const MAP_URL = { '4-1': 'plateau-lab.html?play', '4-2': 'plateau-lab.html?map=4-2&play', '4-4': 'plateau-lab.html?map=4-4&play' };

// ───────────── 一页一页的场景 ─────────────
const SCENES = {
  smoke() {
    const P = G.play, D = P.dev;
    D.god(true); P.autoPick = true;
    const out = [];
    for (const k of ['marmot', 'tiangou', 'aoyin', 'leiyak', 'jufu', 'manman', 'liangu', 'dijiang']) {
      T.reset();
      const f = D.spawn(k, 14, 0);
      T.run(6);
      out.push(`${k}: alive=${f.alive} hp=${Math.round(f.hp)} moves=${JSON.stringify([...f.move.count])}`);
    }
    return { log: out };
  },
  findflat() {
    const T0 = G.terrain, P = G.play;
    const out = [];
    for (let x = -240; x <= 220; x += 10) for (let z = -120; z <= 200; z += 10) {
      let ok = true, hmin = Infinity, hmax = -Infinity;
      for (let dx = -15; dx <= 15 && ok; dx += 5) for (let dz = -15; dz <= 15 && ok; dz += 5) {
        const h = T0.heightAt(x + dx, z + dz);
        hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
        if (T0.waterDepthAt(x + dx, z + dz) > 0 || G.world.occupied(x + dx, z + dz, 1)) ok = false;
      }
      if (!ok || hmax - hmin > 1.5) continue;
      const enc = P.encounters.reduce((m, e) => Math.min(m, Math.hypot(e.x - x, e.z - z) - e.r), 1e9);
      if (enc < 30) continue;
      out.push([x, z, +(hmax - hmin).toFixed(2), Math.round(enc)]);
    }
    out.sort((a, b) => a[2] - b[2]);
    return { log: out.slice(0, 15).map(String) };
  },
};

const KIND_MODEL = { marmot: 'SK_Enemy_Marmot', tiangou: 'SK_Enemy_Tiangou', aoyin: 'SK_Enemy_Aoyin', leiyak: 'SK_Enemy_Aoyin', jufu: 'SK_Enemy_Jufu', manman: 'SK_Enemy_Manman', liangu: 'SM_EnemyPart_LianguCore', dijiang: 'SK_Enemy_Dijiang' };
/** 各怪截图的机位：侧面多远、多高、看向多高 */
const CAM = { marmot: [3, 0.9, 0.45], tiangou: [3.8, 1.2, 0.6], aoyin: [7.5, 2.2, 1.4], leiyak: [5.5, 1.6, 1], jufu: [4.6, 1.6, 1.1], manman: [7, 2.5, 0.4], liangu: [5.5, 2, 0.5], dijiang: [3.6, 1.2, 0.6] };

async function foes(b, only) {
  const out = [];
  const kinds = only?.length ? only : Object.keys(KIND_MODEL);
  for (const kind of kinds) {
    const mine = [];
    const ids = await b.eval(`Object.keys(G.play.dev.moveTable()['${KIND_MODEL[kind]}'].moves)`);
    for (const id of ids) {
      if (kind === 'leiyak' && id === 'slam') continue;
      const [dist, h, lookH] = CAM[kind];
      await b.eval(`(() => { T.reset(); G.play.dev.god(true); G.play.dev.hud.visible = false; T.clean();
        window.F = G.play.dev.spawn('${kind}', ${kind === 'jufu' ? 14 : 9}, 0);
        if ('${kind}' === 'manman') { window.F2 = G.play.dev.spawn('manman', 12, 0.4); F.pair(F2, true); F2.pair(F, false); F2.host.scale.x *= -1; F2.enc = F.enc; F.enc.foes.push(F2); }
        T.run(0.4);
        G.play.dev.watch(() => ({ pos: F.pos, yaw: F.yaw, h: ${lookH} }), Math.PI / 2 - 0.45, ${dist}, ${h}, 50);
        return F.force('${id}'); })()`);
      for (const stage of ['windup', 'active', 'recover']) {
        const k = stage === 'windup' ? 0.75 : 0.45;
        const t = await b.eval(`T.until(() => !F.move.busy || (F.move.id === '${id}' && F.move.stage === '${stage}' && F.move.stageK >= ${k}), 8)`);
        if (t < 0) { out.push(`${kind}/${id}/${stage}: 没等到`); continue; }
        const st = await b.eval(`F.move.id + '/' + F.move.stage`);
        if (!st.startsWith(id)) { out.push(`${kind}/${id}/${stage}: 招式已结束（${st}）`); break; }
        await b.eval('T.frame()');
        const file = `${OUT}/foe-${kind}-${id}-${stage}.jpg`;
        await b.shot(file, 80);
        mine.push(file);
      }
    }
    for (const kindOfDeath of ['normal', 'blast']) {
      await b.eval(`(() => { T.reset(); window.F = G.play.dev.spawn('${kind}', 9, 0); T.run(0.3);
        G.play.dev.watch(() => ({ pos: F.pos, yaw: F.yaw, h: ${CAM[kind][2]} }), Math.PI / 2 - 0.45, ${CAM[kind][0]}, ${CAM[kind][1]}, 50);
        F.hit(99999, 1, F.center(T.V(0, 0, 0)), { kind: '${kindOfDeath === 'blast' ? 'blast' : 'bullet'}', from: G.walker.feet.clone() }); T.run(${kind === 'dijiang' ? 0.1 : kind === 'manman' ? 1.0 : 0.6}); T.frame(); })()`);
      const file = `${OUT}/foe-${kind}-death-${kindOfDeath}.jpg`;
      await b.shot(file, 80);
      mine.push(file);
    }
    out.push(...mine);
    sheet(`foe-${kind}`, mine);
  }
  await b.eval('G.play.dev.stopWatch(); G.play.dev.hud.visible = true');
  return out;
}

// 领主：在哪张图、玩家站哪 / 看哪、机位（侧面距离、高度、看向高度）、哪几招要拍玩家视角、清掉哪个据点的遇敌
const LORDS = {
  kui: { map: '4-1', site: 's6', stand: [100, -52], look: [115, -61], cam: [17, 6, 3.2], fp: ['leap', 'drum', 'clap'] },
  feilian: { map: '4-1', site: 's5', stand: [48, -204], look: [40, -228], cam: [15, 5, 2.4], fp: ['gust', 'charge', 'stormburst', 'tornado'] },
  huashe: { map: '4-1', site: 's4', stand: [-96, -142], look: [-140, -150], cam: [16, 6, 1.6], fp: ['lunge', 'spit', 'wingslap', 'roar'] },
  dae: { map: '4-2', stand: [-30, 70], look: [-1, -58], cam: [24, 6, 0], fp: ['dive', 'feathers'] },
  leize: { map: '4-4', stand: [-10, 59], look: [0, -16], cam: [34, 4, 6], fp: ['bellyDrum', 'breath', 'clawSlam'] },
};
const SHOW_ONLY = ['roar', 'rise', 'kneel', 'down', 'choke', 'fall', 'grab', 'flyTo'];

/**
 * 登场演出：逐镜截图；逐帧量镜头和玩家眼睛的位姿，交还那一刻（handoff 开始）的误差、落回段每帧最大位移 / 转角；
 * 武器、HUD 淡入完才开打（inShow 落下）。
 */
async function intro(b, id, tag) {
  const out = [];
  const r = await b.eval(`(() => {
    const C = G.play.dev.cinema;
    const shot = C.shot; if (!shot) return { err: '没有演出' };
    const marks = []; let acc = 0; for (const s of shot.shots ?? []) { marks.push([s.id, acc + s.dur * 0.55]); acc += s.dur; }
    return { name: shot.name, dur: shot.dur, land: shot.landDur, handoff: shot.handoff, marks, canSkip: C.canSkip };
  })()`);
  if (r.err) { out.push(`${id}: ${r.err}`); return { out, files: [] }; }
  const files = [];
  for (const [sid, at] of r.marks) {
    await b.eval(`T.until(() => G.play.dev.cinema.t >= ${at} || G.play.dev.cinema.phase !== 'cam', ${r.dur + 2})`);
    await b.eval('T.frame()');
    const f = `${OUT}/lord-${id}-intro${tag}-${sid}.jpg`; await b.shot(f, 82); files.push(f);
  }
  const m = await b.eval(`(() => {
    const C = G.play.dev.cinema, cam = G.camera;
    let maxStep = 0, maxAng = 0, prevP = cam.position.clone(), prevQ = cam.quaternion.clone(), n = 0;
    while (C.phase === 'cam' && n < 300) { T.run(1 / 30); n++;
      if (C.phase === 'cam' && C.t > C.shot.dur - C.shot.landDur) { maxStep = Math.max(maxStep, cam.position.distanceTo(prevP)); maxAng = Math.max(maxAng, cam.quaternion.angleTo(prevQ)); }
      prevP.copy(cam.position); prevQ.copy(cam.quaternion); }
    const { e, q } = T.eyePose();
    return { phase: C.phase, posErr: cam.position.distanceTo(e), angErr: cam.quaternion.angleTo(q) * 180 / Math.PI, fovErr: Math.abs(cam.fov - 72), maxStep, maxAngDeg: maxAng * 180 / Math.PI, ui: C.uiAlpha };
  })()`);
  out.push(`${id} 登场${tag}：${r.name} ${r.dur}s（落回 ${r.land}s + 淡入 ${r.handoff}s）能否跳过=${r.canSkip}；交还误差 位置 ${m.posErr.toFixed(4)} m、朝向 ${m.angErr.toFixed(3)}°、视角 ${m.fovErr.toFixed(3)}°；落回段每帧最大位移 ${m.maxStep.toFixed(3)} m、转角 ${m.maxAngDeg.toFixed(2)}°`);
  await b.eval(`T.run(${(r.handoff ?? 0) * 0.5})`);
  await b.eval('T.frame()');
  { const f = `${OUT}/lord-${id}-intro${tag}-handoff.jpg`; await b.shot(f, 82); files.push(f); }
  const fight = await b.eval(`T.until(() => !B.inShow, 4)`);
  out.push(`  淡入完到开打：${fight.toFixed(2)} s`);
  return { out, files };
}

async function lord(b, id) {
  const out = [];
  const L = LORDS[id];
  const files = [];
  const shot = async (name, quality = 82) => { await b.eval('T.frame()'); const f = `${OUT}/lord-${id}-${name}.jpg`; await b.shot(f, quality); files.push(f); };
  await b.eval(`(() => { T.clean(); const P = G.play; P.dev.god(true); P.autoPick = true;
    try { localStorage.removeItem('ch4.introSeen'); } catch {}
    G.walker.place(${L.stand[0]}, ${L.stand[1]}); G.walker.lookAt(T.V(${L.look[0]}, G.terrain.heightAt(${L.look[0]}, ${L.look[1]}) + 3, ${L.look[1]}));
    for (const e of P.encounters ?? []) if (e.site === '${L.site ?? '-'}') for (const f of e.foes) { if (f.alive) f.die(); f.host.visible = false; }
    if (P.encounter) for (const f of P.encounter.foes) { if (f.alive) f.die(); f.host.visible = false; }
    window.B = P.bosses.find(x => x.id === '${id}'); return !!B; })()`);
  if (await b.eval(`T.until(() => B.active, 4)`) < 0) { out.push(`${id}: 没有开打`); return out; }
  const first = await intro(b, id, '');
  out.push(...first.out); files.push(...first.files);
  // 第二次：重置战斗再走进去，按任意键跳过，看是不是平滑落回
  await b.eval(`(() => { B.reset(); G.walker.place(${L.stand[0]} + 60, ${L.stand[1]} + 60); T.run(0.5); G.walker.place(${L.stand[0]}, ${L.stand[1]}); G.walker.lookAt(T.V(${L.look[0]}, G.terrain.heightAt(${L.look[0]}, ${L.look[1]}) + 3, ${L.look[1]})); })()`);
  if (await b.eval(`T.until(() => B.active, 4)`) >= 0) {
    const sk = await b.eval(`(() => { const C = G.play.dev.cinema; T.run(1.2); const can = C.canSkip; G.press('any'); T.run(1 / 30);
      const cam = G.camera; let maxStep = 0, prev = cam.position.clone(), n = 0;
      while (C.phase === 'skip' && n < 60) { T.run(1 / 30); n++; maxStep = Math.max(maxStep, cam.position.distanceTo(prev)); prev.copy(cam.position); }
      const { e, q } = T.eyePose();
      const r = { can, phase: C.phase, skipFrames: n, maxStep, posErr: cam.position.distanceTo(e), angErr: cam.quaternion.angleTo(q) * 180 / Math.PI };
      T.until(() => !B.inShow, 4); return r; })()`);
    out.push(`  第二次登场：能跳过=${sk.can}，按键后 ${(sk.skipFrames / 30).toFixed(2)} s 落回眼睛（每帧最大位移 ${sk.maxStep.toFixed(3)} m），交还误差 ${sk.posErr.toFixed(4)} m / ${sk.angErr.toFixed(3)}°`);
  }
  await b.eval(`(() => { G.play.dev.hud.visible = false; })()`);
  const moves = await b.eval(`Object.keys(G.play.dev.moveTable()[B.model].moves)`);
  const [cd, ch, cl] = L.cam;
  const defs = await b.eval(`G.play.dev.moveTable()[B.model].moves`);
  for (const m of moves) {
    if (SHOW_ONLY.includes(m)) continue;
    await b.eval(`(() => { G.play.dev.heal(); B.hp = Math.max(B.hp, B.maxHp * 0.7); B.force('${m}');
      G.play.dev.watch(() => ({ pos: B.pos, yaw: B.yaw, h: ${cl} }), Math.PI / 2 - 0.5, ${cd}, ${ch}, 55); })()`);
    for (const stage of ['windup', 'active', 'recover']) {
      if (!(defs[m][stage] > 0)) continue;
      const k = stage === 'windup' ? 0.8 : 0.45;
      const w = await b.eval(`T.until(() => !B.move.busy || (B.move.id === '${m}' && B.move.stage === '${stage}' && B.move.stageK >= ${k}), 10)`);
      const st = await b.eval(`B.move.id + '/' + B.move.stage`);
      if (w < 0 || !st.startsWith(m)) { out.push(`  ${m}/${stage}: ${st}`); break; }
      await shot(`${m}-${stage}`, 78);
    }
    if (L.fp.includes(m)) {
      await b.eval(`(() => { G.play.dev.stopWatch(); G.play.dev.hud.visible = true; B.force('${m}'); G.walker.lookAt(B.center(T.V(0, 0, 0))); })()`);
      await b.eval(`T.until(() => !B.move.busy || (B.move.id === '${m}' && B.move.stage === 'windup' && B.move.stageK >= 0.7), 10)`);
      await b.eval(`G.walker.lookAt(B.center(T.V(0, 0, 0)).setY(B.pos.y + 1))`);
      await shot(`${m}-fp`, 80);
      await b.eval(`T.until(() => !B.move.busy, 8); G.play.dev.hud.visible = false`);
    }
  }
  await b.eval(`(() => { G.play.dev.stopWatch(); G.play.dev.hud.visible = true; G.play.dev.heal(); })()`);
  for (const n of [2, 3]) {
    await b.eval(`(() => { B.interrupt(); B.toPhase(${n}); })()`);
    await b.eval(`T.until(() => B.inShow, 2)`);
    const dur = await b.eval(`G.play.dev.cinema.shot?.dur ?? 2.6`);
    await b.eval(`T.run(${dur * 0.45})`);
    await shot(`phase${n}`);
    await b.eval(`T.until(() => !B.inShow, 8); T.run(3)`);
    await shot(`phase${n}-fight`);
  }
  await b.eval(`(() => { G.play.dev.heal(); B.forceBreak(); G.play.dev.watch(() => ({ pos: B.pos, yaw: B.yaw, h: ${cl} }), Math.PI / 2 - 0.5, ${cd}, ${ch}, 55); })()`);
  await b.eval(`T.run(1.2)`);
  await shot('break');
  await b.eval(`G.play.dev.stopWatch(); T.until(() => !B.broken, 6)`);
  await b.eval(`(() => { G.play.dev.heal(); B.hp = 1; B.hit(99999, 1, B.center(T.V(0, 0, 0)), { kind: 'bullet' }); })()`);
  const dd = await b.eval(`T.until(() => B.inShow && G.play.dev.cinema.shot && G.play.dev.cinema.shot.name !== 'observe', 2) >= 0 ? G.play.dev.cinema.shot.dur : 0`);
  let t = 0;
  for (const at of [0.15, 0.4, 0.62].map(k => k * dd)) { await b.eval(`T.run(${at - t})`); t = at; await shot(`death-${Math.round(at * 10)}`); }
  await b.eval(`T.until(() => !B.inShow, 10); T.run(0.5)`);
  const log = await b.eval(`JSON.stringify({ defeated: B.defeated, used: [...B.used].map(([k, v]) => k + '×' + v).join(' '), shows: [...new Set(G.play.dev.cinema.played)].filter(n => n !== 'observe').join(' / '), offering: !!G.play.kit.offering, scrolls: G.play.kit.list() })`);
  out.push(log);
  // 镜头表（给 Unity 的 BossIntroDirector）
  const tables = await b.eval(`JSON.stringify([...G.play.dev.cinema.tables.values()])`);
  writeFileSync(`${OUT}/intro-${id}.json`, tables);
  sheet(`lord-${id}-show`, files.filter(f => /-(intro|phase|break|death)/.test(f)));
  sheet(`lord-${id}-moves`, files.filter(f => !/-(intro|phase|break|death)/.test(f)), 5);
  return out;
}

async function openMap(b, map) {
  await b.goto(`${BASE}/${MAP_URL[map]}`);
  await b.waitFor('(window.plateau ?? window.gorge ?? window.haizi)?.play?.ready', 240000);
  await b.eval(`(${pageTools.toString()})()`);
}

async function main() {
  const b = await launch({ width: 1280, height: 720 });
  let map = '';
  const need = async (m) => { if (map !== m) { await openMap(b, m); map = m; } };
  try {
    for (const name of wanted.length ? wanted : ['smoke']) {
      if (name === 'poses') {
        await need(opt('--map', '4-1'));
        const who = opt('--who', 'kui');
        const [cd, ch, cl, side] = (opt('--cam', '11,3,3,-0.6')).split(',').map(Number);
        await b.eval(`(() => { T.clean(); const P = G.play; P.dev.god(true); P.dev.hud.visible = false; G.walker.place(-50, 160); T.run(0.2);
          const B = P.bosses.find(x => x.id === '${who}');
          if (B) { B.active = true; B.inShow = true; B.host.visible = true; B.host.scale.setScalar(1); B.pos.set(-50, G.terrain.heightAt(-50, 140), 140); B.yaw = 0.6; window.W = B; }
          else { window.W = P.dev.spawn('${who}', 12, 0); W.stun(999, ''); W.stunT = 0; W.state = 'idle'; W.home.copy(W.pos); W.yaw = 0.6; }
          P.dev.watch(() => ({ pos: W.pos, yaw: W.yaw, h: ${cl} }), Math.PI / 2 + ${side}, ${cd}, ${ch}, 50); })()`);
        for (const item of opt('--list', '').split(',').filter(Boolean)) {
          const [id, stage, k] = item.split(':');
          await b.eval(`(() => { const st = { id: '${id}', stage: '${stage}', k: ${Number(k)} };
            if (W.isBoss) W.show = st; else { W.move.cancel(); W.posture = '${id}'; }
            T.run(0.4); })()`);
          const f = `${opt('--tmp', OUT)}/_pose-${who}-${id}-${stage}-${k}.jpg`;
          await b.eval('T.frame()'); await b.shot(f, 82); console.log(f);
        }
        continue;
      }
      if (name === 'eval') {
        await need(opt('--map', '4-1'));
        const r = await b.eval(`(() => { ${opt('--js', '')} })()`);
        if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
        const sh = opt('--shot', '');
        if (sh) { await b.eval('T.frame()'); await b.shot(sh, 85); console.log(sh); }
        continue;
      }
      if (LORDS[name]) {
        await need(LORDS[name].map);
        console.log(`── ${name}`);
        for (const l of await lord(b, name)) console.log(l);
        continue;
      }
      if (name === 'foes' || name.startsWith('foes:')) {
        await need('4-1');
        console.log(`── ${name}`);
        for (const l of await foes(b, name.split(':')[1]?.split(','))) console.log(l);
        continue;
      }
      const fn = SCENES[name];
      if (!fn) { console.log(`没有场景 ${name}`); continue; }
      await need('4-1');
      console.log(`── ${name}`);
      const src = fn.toString();
      const res = await b.eval(`(${/^(function|\(|async)/.test(src) ? src : `function ${src}`})()`);
      for (const l of res.log ?? []) console.log(l);
    }
    const errs = b.logs.filter(l => /error|exception/i.test(l));
    if (errs.length) console.log('页面报错：\n' + errs.slice(0, 20).join('\n'));
  } finally { await b.close(); }
}

await main();
