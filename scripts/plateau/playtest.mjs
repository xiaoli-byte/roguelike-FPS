// 第四章战斗的脚本化试玩（docs/level-design/chuanzang-combat-v1.md 第 6 节）：
//   node scripts/plateau/playtest.mjs <场景…> [--url http://localhost:5199] [--out docs/art/review/ch4-combat]
// 场景：smoke（每种怪刷一只跑 6 秒）、foes（每只怪的每个招式截图）、kui、feilian、huashe、dae、leize、all
// 先开 dev 服务器（npm run dev -- --port 5199）。页面在后台不给 rAF：一律用 plateau.simulate(秒) 按固定步长推进，截图前手动渲染一帧。
// 每个场景是一个在页面里执行的函数（toString 之后注入），返回要截的图（{ name, 机位… }）由这里截。
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--url', 'http://localhost:5199');
const SHEETS = opt('--out', 'docs/art/review/ch4-combat');
/** 原始截图（不入库，.gitignore）；每个场景结束拼成审阅总图放 SHEETS */
const OUT = `${SHEETS}/raw`;
function sheet(name, files, cols = 4) {
  if (!files.length) return;
  const r = spawnSync('python', ['scripts/plateau/contact_sheet.py', `${SHEETS}/${name}.jpg`, ...files, '--cols', String(cols), '--w', '400'], { encoding: 'utf-8' });
  console.log(r.stdout.trim() || r.stderr.trim());
}
const wanted = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

// ───────────── 页面里的工具（注入一次） ─────────────
function pageTools() {
  const p = window.plateau;
  const T = {
    /** 推进直到 pred() 为真（最多 max 秒），返回用了多久 */
    until(pred, max = 20, step = 1 / 30) {
      let t = 0;
      while (t < max) { if (pred()) return t; p.simulate(step, step, false); t += step; }
      return -1;
    },
    run(sec, step = 1 / 30) { p.simulate(sec, step, false); },
    /** 截图前：渲染一帧 */
    frame() { p.simulate(1 / 30, 1 / 30, true); },
    flat: [-50, 145],
    /** 截图：藏起检视页的面板、平面图、提示 */
    clean() {
      if (document.getElementById('t-clean')) return;
      const st = document.createElement('style');
      st.id = 't-clean';
      st.textContent = '#panel,#map,#hud,#perf,#hint,#checks,#cross,#maps{display:none!important}';
      document.head.appendChild(st);
    },
    reset(x, z) {
      const P = p.play;
      for (const f of P.foes) if (f.enc && String(f.enc.id).startsWith('dev-') && f.host.visible) { if (f.alive) f.die(); f.host.visible = false; }
      p.walker.place(x ?? T.flat[0], z ?? T.flat[1]);
      P.dev.heal();
    },
  };
  window.T = T;
  return true;
}

// ───────────── 场景 ─────────────
const SCENES = {
  /** 找一块平、干、远离遇敌的空地（截图用） */
  findflat() {
    const p = window.plateau, T0 = p.terrain, P = p.play;
    const out = [];
    for (let x = -240; x <= 220; x += 10) for (let z = -120; z <= 200; z += 10) {
      let ok = true, hmin = Infinity, hmax = -Infinity;
      for (let dx = -15; dx <= 15 && ok; dx += 5) for (let dz = -15; dz <= 15 && ok; dz += 5) {
        const h = T0.heightAt(x + dx, z + dz);
        hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
        if (T0.waterDepthAt(x + dx, z + dz) > 0 || p.world.occupied(x + dx, z + dz, 1)) ok = false;
      }
      if (!ok || hmax - hmin > 1.5) continue;
      const enc = P.encounters.reduce((m, e) => Math.min(m, Math.hypot(e.x - x, e.z - z) - e.r), 1e9);
      if (enc < 30) continue;
      out.push([x, z, +(hmax - hmin).toFixed(2), Math.round(enc)]);
    }
    out.sort((a, b) => a[2] - b[2]);
    return { log: out.slice(0, 15).map(String) };
  },
  /** 调试：某只怪每 0.5 秒的状态 */
  probe() {
    const p = window.plateau, P = p.play, D = P.dev;
    D.god(true);
    T.reset();
    const f = D.spawn(window.PROBE ?? 'marmot', 14, 0);
    const out = [];
    for (let i = 0; i < 16; i++) {
      T.run(0.5);
      out.push(`${(i * 0.5 + 0.5).toFixed(1)}s state=${f.state} move=${f.move.id}/${f.move.stage} pos=${f.pos.toArray().map(v => v.toFixed(1))} dist=${Math.hypot(f.pos.x - p.walker.feet.x, f.pos.z - p.walker.feet.z).toFixed(1)} token=${f.token} cd=${f.cd.toFixed(2)} stuck=${f.mem.stuck}`);
    }
    return { log: out };
  },
  /** 每种怪刷一只跑 6 秒：不报错、会出招 */
  smoke() {
    const p = window.plateau, P = p.play, D = P.dev;
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
};

// ───────────── 多步场景（node 这边一步步驱动、截图） ─────────────

const KIND_MODEL = { marmot: 'SK_Enemy_Marmot', tiangou: 'SK_Enemy_Tiangou', aoyin: 'SK_Enemy_Aoyin', leiyak: 'SK_Enemy_Aoyin', jufu: 'SK_Enemy_Jufu', manman: 'SK_Enemy_Manman', liangu: 'SM_EnemyPart_LianguCore', dijiang: 'SK_Enemy_Dijiang' };
/** 各怪截图的机位：侧面多远、多高、看向多高 */
const CAM = { marmot: [3, 0.9, 0.45], tiangou: [3.8, 1.2, 0.6], aoyin: [7.5, 2.2, 1.4], leiyak: [5.5, 1.6, 1], jufu: [4.6, 1.6, 1.1], manman: [7, 2.5, 0.4], liangu: [5.5, 2, 0.5], dijiang: [3.6, 1.2, 0.6] };

async function foes(b, only) {
  const out = [];
  mkdirSync(OUT, { recursive: true });
  const kinds = only?.length ? only : Object.keys(KIND_MODEL);
  for (const kind of kinds) {
    const ids = await b.eval(`Object.keys(plateau.play.dev.moveTable()['${KIND_MODEL[kind]}'].moves)`);
    for (const id of ids) {
      if (kind === 'leiyak' && id === 'slam') continue;
      const [dist, h, lookH] = CAM[kind];
      await b.eval(`(() => { T.reset(); plateau.play.dev.god(true); plateau.play.dev.hud.visible = false; T.clean();
        window.F = plateau.play.dev.spawn('${kind}', ${kind === 'jufu' ? 14 : 9}, 0);
        if ('${kind}' === 'manman') { window.F2 = plateau.play.dev.spawn('manman', 12, 0.4); F.pair(F2, true); F2.pair(F, false); F2.host.scale.x *= -1; F2.enc = F.enc; F.enc.foes.push(F2); }
        T.run(0.4);
        plateau.play.dev.watch(() => ({ pos: F.pos, yaw: F.yaw, h: ${lookH} }), Math.PI / 2 - 0.45, ${dist}, ${h}, 50);
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
        out.push(file);
      }
    }
    // 死亡（普通 / 爆炸）
    const before = out.length;
    for (const kindOfDeath of ['normal', 'blast']) {
      await b.eval(`(() => { T.reset(); window.F = plateau.play.dev.spawn('${kind}', 9, 0); T.run(0.3);
        plateau.play.dev.watch(() => ({ pos: F.pos, yaw: F.yaw, h: ${CAM[kind][2]} }), Math.PI / 2 - 0.45, ${CAM[kind][0]}, ${CAM[kind][1]}, 50);
        F.hit(99999, 1, F.center(new F.pos.constructor()), { kind: '${kindOfDeath === 'blast' ? 'blast' : 'bullet'}', from: plateau.walker.feet.clone() }); T.run(${kind === 'manman' ? 1.0 : 0.6}); T.frame(); })()`);
      const file = `${OUT}/foe-${kind}-death-${kindOfDeath}.jpg`;
      await b.shot(file, 80);
      out.push(file);
    }
    void before;
    sheet(`foe-${kind}`, out.filter(f => f.includes(`/foe-${kind}-`)));
  }
  await b.eval('plateau.play.dev.stopWatch(); plateau.play.dev.hud.visible = true');
  return out;
}

// 领主：站位（玩家站哪、看哪）、机位（侧面距离、高度、看向高度）、只在演出里用的招
const LORDS = {
  kui: { site: 's6', stand: [100, -52], look: [115, -61], cam: [17, 6, 3.2], fp: ['leap', 'drum', 'clap'] },
  feilian: { site: 's5', stand: [48, -204], look: [40, -228], cam: [15, 5, 2.4], fp: ['gust', 'charge', 'stormburst', 'tornado'] },
  huashe: { site: 's4', stand: [-96, -142], look: [-140, -150], cam: [16, 6, 1.6], fp: ['lunge', 'spit', 'wingslap', 'roar'] },
};
const SHOW_ONLY = ['roar', 'rise', 'kneel', 'down', 'choke'];

async function lord(b, id) {
  const out = [];
  const L = LORDS[id];
  const shot = async (name, quality = 82) => { await b.eval('T.frame()'); const f = `${OUT}/lord-${id}-${name}.jpg`; await b.shot(f, quality); out.push(f); };
  await b.eval(`(() => { T.clean(); const P = plateau.play; P.dev.god(true); P.autoPick = true;
    plateau.walker.place(${L.stand[0]}, ${L.stand[1]}); plateau.walker.lookAt(new plateau.camera.position.constructor(${L.look[0]}, plateau.terrain.heightAt(${L.look[0]}, ${L.look[1]}) + 3, ${L.look[1]}));
    for (const e of P.encounters) if (e.site === '${L.site}') for (const f of e.foes) { if (f.alive) f.die(); f.host.visible = false; }
    window.B = P.bosses.find(x => x.id === '${id}'); return !!B; })()`);
  // 登场演出
  const started = await b.eval(`T.until(() => B.active, 3)`);
  if (started < 0) { out.push(`${id}: 没有开打`); return out; }
  const intro = await b.eval(`plateau.play.dev.cinema.shot?.dur ?? 0`);
  let t = 0;
  for (const at of [0.25, 0.45, 0.62, 0.8].map(k => k * intro)) { await b.eval(`T.run(${at - t})`); t = at; await shot(`intro-${Math.round(at * 10)}`); }
  await b.eval(`T.until(() => !B.inShow, 10)`);
  await b.eval(`(() => { plateau.play.dev.hud.visible = false; })()`);
  const moves = await b.eval(`Object.keys(plateau.play.dev.moveTable()[B.model].moves)`);
  const [cd, ch, cl] = L.cam;
  for (const m of moves) {
    if (SHOW_ONLY.includes(m)) continue;
    await b.eval(`(() => { plateau.play.dev.heal(); B.hp = Math.max(B.hp, B.maxHp * 0.7); B.force('${m}');
      plateau.play.dev.watch(() => ({ pos: B.pos, yaw: B.yaw, h: ${cl} }), Math.PI / 2 - 0.5, ${cd}, ${ch}, 55); })()`);
    for (const stage of ['windup', 'active', 'recover']) {
      const k = stage === 'windup' ? 0.8 : 0.45;
      const w = await b.eval(`T.until(() => !B.move.busy || (B.move.id === '${m}' && B.move.stage === '${stage}' && B.move.stageK >= ${k}), 10)`);
      const st = await b.eval(`B.move.id + '/' + B.move.stage`);
      if (w < 0 || !st.startsWith(m)) { out.push(`${id}/${m}/${stage}: ${st}`); break; }
      await shot(`${m}-${stage}`, 78);
    }
    // 玩家视角看预警
    if (L.fp.includes(m)) {
      await b.eval(`(() => { plateau.play.dev.stopWatch(); plateau.play.dev.hud.visible = true; B.force('${m}'); const c = B.center(new plateau.camera.position.constructor()); plateau.walker.lookAt(c); })()`);
      await b.eval(`T.until(() => !B.move.busy || (B.move.id === '${m}' && B.move.stage === 'windup' && B.move.stageK >= 0.7), 10)`);
      await b.eval(`plateau.walker.lookAt(B.center(new plateau.camera.position.constructor()).setY(B.pos.y + 1))`);
      await shot(`${m}-fp`, 80);
      await b.eval(`T.until(() => !B.move.busy, 8); plateau.play.dev.hud.visible = false`);
    }
  }
  await b.eval(`(() => { plateau.play.dev.stopWatch(); plateau.play.dev.hud.visible = true; plateau.play.dev.heal(); })()`);
  // 转阶段
  for (const n of [2, 3]) {
    await b.eval(`(() => { B.interrupt(); B.toPhase(${n}); })()`);
    await b.eval(`T.until(() => B.inShow, 2)`);
    const dur = await b.eval(`plateau.play.dev.cinema.shot?.dur ?? 2.6`);
    await b.eval(`T.run(${dur * 0.45})`);
    await shot(`phase${n}`);
    await b.eval(`T.until(() => !B.inShow, 8); T.run(3)`);
    await shot(`phase${n}-fight`);
  }
  // 破防
  await b.eval(`(() => { plateau.play.dev.heal(); B.forceBreak(); plateau.play.dev.watch(() => ({ pos: B.pos, yaw: B.yaw, h: ${cl} }), Math.PI / 2 - 0.5, ${cd}, ${ch}, 55); })()`);
  await b.eval(`T.run(1.2)`);
  await shot('break');
  await b.eval(`plateau.play.dev.stopWatch(); T.until(() => !B.broken, 6)`);
  // 击杀 → 死亡演出
  await b.eval(`(() => { plateau.play.dev.heal(); B.hp = 1; B.hit(99999, 1, B.center(new plateau.camera.position.constructor()), { kind: 'bullet' }); })()`);
  const dd = await b.eval(`T.until(() => B.inShow && plateau.play.dev.cinema.shot && plateau.play.dev.cinema.shot.name !== 'observe', 2) >= 0 ? plateau.play.dev.cinema.shot.dur : 0`);
  t = 0;
  for (const at of [0.15, 0.4, 0.62].map(k => k * dd)) { await b.eval(`T.run(${at - t})`); t = at; await shot(`death-${Math.round(at * 10)}`); }
  await b.eval(`T.until(() => !B.inShow, 10); T.run(0.5)`);
  const log = await b.eval(`JSON.stringify({ defeated: B.defeated, used: [...B.used].map(([k, v]) => k + '×' + v).join(' '), shows: plateau.play.dev.cinema.played.join(' / '), said: plateau.play.dev.hud.said, offering: !!plateau.play.kit.offering, scrolls: plateau.play.kit.list() })`);
  out.push(log);
  const files = out.filter(f => f.endsWith('.jpg'));
  sheet(`lord-${id}-show`, files.filter(f => /-(intro|phase|break|death)/.test(f)));
  sheet(`lord-${id}-moves`, files.filter(f => !/-(intro|phase|break|death)/.test(f)), 5);
  return out;
}

async function main() {
  const b = await launch({ width: 1280, height: 720 });
  try {
    await b.goto(`${BASE}/plateau-lab.html?play`);
    await b.waitFor('window.plateau?.play?.ready', 240000);
    await b.eval(`(${pageTools.toString()})()`);
    for (const name of wanted.length ? wanted : ['smoke']) {
      if (name === 'poses') {
        // node playtest.mjs poses --who kui --list "roar:active:0.5,leap:windup:1" [--cam 11,3,3,-0.6]：定格姿势逐张截图
        const who = opt('--who', 'kui');
        const [cd, ch, cl, side] = (opt('--cam', '11,3,3,-0.6')).split(',').map(Number);
        await b.eval(`(() => { T.clean(); const P = plateau.play; P.dev.god(true); P.dev.hud.visible = false; plateau.walker.place(-50, 160); T.run(0.2);
          const B = P.bosses.find(x => x.id === '${who}');
          if (B) { B.active = true; B.inShow = true; B.host.visible = true; B.host.scale.setScalar(1); B.pos.set(-50, plateau.terrain.heightAt(-50, 140), 140); B.yaw = 0.6; window.W = B; }
          else { window.W = P.dev.spawn('${who}', 12, 0); W.stun(999, ''); W.stunT = 0; W.state = 'idle'; W.home.copy(W.pos); W.yaw = 0.6; }
          P.dev.watch(() => ({ pos: W.pos, yaw: W.yaw, h: ${cl} }), Math.PI / 2 + ${side}, ${cd}, ${ch}, 50); })()`);
        for (const item of opt('--list', '').split(',').filter(Boolean)) {
          const [id, stage, k] = item.split(':');
          await b.eval(`(() => { const st = { id: '${id}', stage: '${stage}', k: ${Number(k)} };
            if (W.isBoss) W.show = st; else { W.move.cancel(); W.anim.pose = '${id}'; W.posture = '${id}'; W.force && 0; W.__st = st; }
            T.run(0.4); })()`);
          const f = `${opt("--tmp", OUT)}/_pose-${who}-${id}-${stage}-${k}.jpg`;
          await b.eval('T.frame()'); await b.shot(f, 82); console.log(f);
        }
        continue;
      }
      if (name === 'eval') {
        // node playtest.mjs eval --js "页面里的代码；可以 return 值" [--shot 路径]（截图前会先渲染一帧）
        const r = await b.eval(`(() => { ${opt('--js', '')} })()`);
        if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
        const sh = opt('--shot', '');
        if (sh) { await b.eval('T.frame()'); await b.shot(sh, 85); console.log(sh); }
        continue;
      }
      if (LORDS[name]) {
        console.log(`── ${name}`);
        for (const l of await lord(b, name)) console.log(l);
        continue;
      }
      if (name === 'foes' || name.startsWith('foes:')) {
        console.log(`── ${name}`);
        for (const l of await foes(b, name.split(':')[1]?.split(','))) console.log(l);
        continue;
      }
      const fn = SCENES[name];
      if (!fn) { console.log(`没有场景 ${name}`); continue; }
      console.log(`── ${name}`);
      const src = fn.toString();
      const res = await b.eval(`(${/^(function|\(|async)/.test(src) ? src : `function ${src}`})()`);
      for (const l of res.log ?? []) console.log(l);
    }
    const errs = b.logs.filter(l => /error|exception/i.test(l));
    if (errs.length) console.log('页面报错：\n' + errs.slice(0, 20).join('\n'));
  } finally { await b.close(); }
}

void writeFileSync;
await main();
