// 4-1 三领主无头对局截图 + 据点模式验收（docs/threejs-migration.md M6）：?debug&dev&debugStage=4-1 开一局，依次把玩家放进飞廉 / 化蛇 / 夔的据点门槛
// （objectives.json 的门槛圆，关卡自己触发首领战），逐帧推进游戏（Game.frame 固定步长，不靠后台标签页的 rAF），拍登场、各阶段、招式、死亡演出；
// 每打掉一个领主检查：6.3 s 后本据点灵火坛点亮、没清关、没开出口，下一个领主照样能开打；三座都亮了才清关开出口。
//   node scripts/lords/fight-shots.mjs [端口=5673] [输出目录=docs/art/review/threejs-migration] [领主=feilian,huashe,kui]
// 开发钩子 window.__lord / window.__lords 只在开发服务器里、网址带 ?dev 时存在（src/enemies/bosses/lords/LordBrain.ts）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5673';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const order = (process.argv[4] ?? 'feilian,huashe,kui').split(',');
const log = (...a) => console.log('[lords]', ...a);
let b = null;
for (let k = 0; k < 4 && !b; k++) {
  try { b = await launch({ width: 1280, height: 720 }); } catch { log('Chromium 没起来，重试', k + 1); }
}
if (!b) throw new Error('Chromium 起不来');

try {
  await Promise.race([b.goto(`http://localhost:${port}/?debug&dev&debugStage=4-1`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 120000))]);
  await b.waitFor('window.__game && window.__ctx', 300000);
  for (let k = 0; k < 2400 && !b.logs.some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  log(b.logs.find(l => l.includes('[assets] 已加载')) ?? '美术资产没加载完');
  await b.waitFor('window.__game && window.__ctx', 180000);
  await b.eval(`(() => {
    const g = window.__game;
    window.requestAnimationFrame = () => 0;
    window.__step = (seconds, dt = 1 / 60) => {
      let t = window.__simT ?? performance.now();
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
      window.__simT = t;
    };
    return true;
  })()`);
  await b.eval(`window.__game.startRun(window.__ctx.heroes[0].id), true`);
  for (let k = 0; k < 400; k++) {
    await b.eval('window.__step(0.1)');
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena && !!window.__ctx.stage.unityDocument`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  log('state', await b.eval('window.__game.state'), await b.eval('window.__ctx.stage.unityDocument?.id'));
  await b.eval('window.__step(2)');
  const god = `(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`;
  const step = async (s) => { await b.eval(`window.__step(${s})`); await b.eval(god); };
  const objective = () => b.eval(`JSON.stringify((() => { const o = window.__ctx.stage.levelObjective; const s = window.__ctx.stage;
    return o ? { lit: o.lit, needed: o.needed, complete: o.complete, settled: [...o.settled], altars: o.altars.filter(a => a.lit).map(a => a.spec.name),
      cleared: s.cleared, portals: (s.portals ?? []).length, describe: o.describe(),
      fights: (s.whiteboxFights ?? []).filter(f => f.id.startsWith('boss:')).map(f => f.id + ':' + f.final + ':' + s.adventureState?.encounters?.find(e => e.id === f.id)?.phase) } : null; })())`);
  log('objective', await objective());

  const ids = { feilian: 'boss_feilian', huashe: 'boss_huashe', kui: 'boss_kui' };
  const lordState = (id) => b.eval(`JSON.stringify(window.__lords?.['${id}']?.debugState() ?? null)`);
  /** 把玩家放进据点门槛（门槛圆里、离圆心 ring 米、脚在地面上；化蛇要站在岸上） */
  const enter = async (id, ring) => b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, o = c.stage.levelObjective;
    const t = o.doc.bosses.find(x => x.bossId === '${id}').threshold, doc = c.stage.unityDocument.bosses.find(x => x.id === '${id}');
    const lakeY = '${id}' === 'boss_huashe' ? doc.floorY + 0.4 : -Infinity;
    for (const r of [${ring}, ${ring} - 4, ${ring} + 4, ${ring} - 8, ${ring} + 8]) for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const x = t.center[0] + Math.sin(a) * r, z = t.center[2] + Math.cos(a) * r;
      const y = c.world.groundHeight(x, z, t.maxY + 2, 0.3);
      if (!Number.isFinite(y) || y < t.minY || y > t.maxY || y < lakeY) continue;
      const p = new V(x, y + 0.05, z);
      c.player.teleport(p, Math.atan2(-(doc.position[0] - x), -(doc.position[2] - z)));
      c.player.pitch = 0.1;
      return { p: p.toArray().map(v => +v.toFixed(1)), r, a: +a.toFixed(2) };
    }
    return null;
  })()`);
  const look = async (id, height = 2) => b.eval(`(() => {
    const c = window.__ctx, w = window.__lords['${id}'], e = c.player.eye;
    const dx = w.position.x - e.x, dz = w.position.z - e.z, dy = w.position.y + ${height} - e.y;
    c.player.yaw = Math.atan2(-dx, -dz);
    c.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return true;
  })()`);
  /** 玩家挪到首领前方 dist 米（地面上，看得见），面朝它 */
  const front = async (id, dist, height = 2) => {
    const r = await b.eval(`(() => {
      const c = window.__ctx, w = window.__lords['${id}'], V = c.player.position.constructor;
      const lakeY = '${id}' === 'boss_huashe' ? w.lake.level + 0.3 : -Infinity;
      for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
        const a = w.facing + k * 0.5, x = w.position.x + Math.sin(a) * ${dist}, z = w.position.z + Math.cos(a) * ${dist};
        const y = c.world.groundHeight(x, z, w.position.y + 12, 0.3);
        if (!Number.isFinite(y) || Math.abs(y - w.position.y) > 8 || y < lakeY) continue;
        const p = new V(x, y + 0.05, z);
        if (c.world.segmentBlocked(new V(x, y + 1.6, z), new V(w.position.x, w.position.y + 2, w.position.z))) continue;
        c.player.teleport(p, 0);
        return p.toArray().map(v => +v.toFixed(1));
      }
      return null;
    })()`);
    await look(id, height);
    return r;
  };
  const moveAt = async (id, move, t, height = 2) => {
    let ok = false;
    for (let k = 0; k < 60 && !ok; k++) {
      ok = await b.eval(`window.__lords['${id}'].forceMove('${move}')`);
      if (!ok) await step(0.1);
    }
    for (let k = 0; k < 600; k++) {
      const st = JSON.parse(await lordState(id));
      if (st.move !== move || st.t >= t) return st;
      await step(1 / 60);
      await look(id, height);
    }
    return JSON.parse(await lordState(id));
  };
  const toPhase = async (id, frac) => {
    await b.eval(`window.__lords['${id}'].hp = window.__lords['${id}'].maxHp * ${frac}`);
    for (let k = 0; k < 40 && !JSON.parse(await lordState(id)).transitioning; k++) await step(0.1);
    return JSON.parse(await lordState(id));
  };
  const endTransition = async (id) => {
    for (let k = 0; k < 80 && JSON.parse(await lordState(id)).transitioning; k++) await step(0.1);
    for (let k = 0; k < 40 && JSON.parse(await lordState(id)).move; k++) await step(0.1);
  };

  const plan = {
    feilian: { ring: 18, intro: [[2.0, 'intro-vortex'], [3.8, 'intro-descend'], [5.2, 'intro-closeup']],
      shots: async (id) => {
        log('stage', await front(id, 14));
        log('gust', JSON.stringify(await moveAt(id, 'gust', 0.95, 2.5)));
        await b.shot(`${out}/feilian-phase1-gust.jpg`);
        await step(1.5);
        log('stage', await front(id, 16));
        log('charge', JSON.stringify(await moveAt(id, 'charge', 1.05, 2)));
        await b.shot(`${out}/feilian-phase1-charge.jpg`);
        await step(2.5);
        log('phase2', JSON.stringify(await toPhase(id, 0.6)));
        await front(id, 16, 4);
        await step(1.4);
        await look(id, 4);
        await b.shot(`${out}/feilian-phase2-tornado.jpg`);
        await endTransition(id);
        log('stage', await front(id, 15));
        log('wheel', JSON.stringify(await moveAt(id, 'wheel', 1.4, 2)));
        await b.shot(`${out}/feilian-phase2-wheel.jpg`);
        await step(2.5);
        log('phase3', JSON.stringify(await toPhase(id, 0.3)));
        await endTransition(id);
        log('stage', await front(id, 18, 3));
        log('storm', JSON.stringify(await moveAt(id, 'stormburst', 3.2, 3)));
        await b.shot(`${out}/feilian-phase3-stormburst.jpg`);
        await step(0.2);
        log('break', await b.eval(`window.__lords['${id}'].breakBar.break(), JSON.stringify(window.__lords['${id}'].debugState())`));
        await step(0.6);
        await look(id, 1.5);
        await b.shot(`${out}/feilian-break.jpg`);
      } },
    huashe: { ring: 40, intro: [[1.6, 'intro-lake'], [3.2, 'intro-breach'], [5.0, 'intro-closeup']],
      shots: async (id) => {
        log('stage', await front(id, 14, 1.5));
        log('spit', JSON.stringify(await moveAt(id, 'spit', 1.1, 1.5)));
        await b.shot(`${out}/huashe-phase1-spit.jpg`);
        await step(1.5);
        log('stage', await front(id, 7, 1.2));
        log('lunge', JSON.stringify(await moveAt(id, 'lunge', 1.0, 1.2)));
        await b.shot(`${out}/huashe-phase1-lunge.jpg`);
        await step(1.5);
        log('phase2', JSON.stringify(await toPhase(id, 0.6)));
        await endTransition(id);
        log('stage', await front(id, 16, 1.5));
        log('roar', JSON.stringify(await moveAt(id, 'roar', 2.6, 2)));
        await b.shot(`${out}/huashe-phase2-flood.jpg`);
        await step(2);
        log('phase3', JSON.stringify(await toPhase(id, 0.3)));
        await endTransition(id);
        log('stage', await front(id, 10, 1));
        log('tailsweep', JSON.stringify(await moveAt(id, 'tailsweep', 0.6, 1)));
        await b.shot(`${out}/huashe-phase3-tailsweep.jpg`);
        await step(1.5);
        log('stage', await front(id, 14, 1.5));
        log('wingslap', JSON.stringify(await moveAt(id, 'wingslap', 1.05, 1.5)));
        await b.shot(`${out}/huashe-phase3-wingslap.jpg`);
      } },
    kui: { ring: 14, intro: [[1.5, 'intro-drum'], [3.6, 'intro-rise'], [5.4, 'intro-closeup']],
      shots: async (id) => {
        log('stage', await front(id, 16, 3));
        log('leap', JSON.stringify(await moveAt(id, 'leap', 1.4, 3)));
        await b.shot(`${out}/kui-phase1-leap.jpg`);
        await step(1.8);
        log('stage', await front(id, 6, 3));
        log('clap', JSON.stringify(await moveAt(id, 'clap', 0.65, 3)));
        await b.shot(`${out}/kui-phase1-clap.jpg`);
        await step(1.5);
        log('phase2', JSON.stringify(await toPhase(id, 0.6)));
        await front(id, 16, 3);
        await step(1.6);
        await look(id, 3);
        await b.shot(`${out}/kui-phase2-perch.jpg`);
        await endTransition(id);
        log('stage', await front(id, 12, 3.4));
        log('drum', JSON.stringify(await moveAt(id, 'drum', 1.5, 3.4)));
        await b.shot(`${out}/kui-phase2-drum.jpg`);
      } },
  };

  for (const name of order) {
    const id = ids[name], p = plan[name];
    log('──', name, 'enter', JSON.stringify(await enter(id, p.ring)));
    let found = false;
    for (let k = 0; k < 300 && !found; k++) {
      await step(0.05);
      found = await b.eval(`!!window.__lords?.['${id}']`);
    }
    if (!found) {
      log('没触发', await objective());
      throw new Error(`${name} 没有出现\n${b.logs.slice(-20).join('\n')}`);
    }
    log('spawned (by level)', await lordState(id));
    for (const [t, shot] of p.intro) {
      for (let k = 0; k < 400; k++) {
        const st = JSON.parse(await lordState(id));
        if (!st.director || st.director.t >= t - 1e-3 || st.director.stage !== 'shots') break;
        await step(Math.min(0.1, Math.max(1 / 60, t - st.director.t)));
      }
      log(shot, await lordState(id));
      await b.shot(`${out}/${name}-${shot}.jpg`);
    }
    for (let k = 0; k < 120 && !JSON.parse(await lordState(id)).introDone; k++) await step(0.2);
    log('after intro', await lordState(id));
    await step(1);
    await p.shots(id);
    // 倒下：死亡演出 → 6.3 s 后据点结算（灵火点亮、不开出口）
    const before = JSON.parse(await objective());
    log('kill', await b.eval(`window.__lord && window.__lords['${id}'] ? (window.__lords['${id}'].gateOff = true, window.__ctx.combat.damageEnemy(window.__lords['${id}'], { base: 1e7, element: 'none', source: 'status', canCrit: false }), !window.__lords['${id}'].alive) : false`));
    await step(2.2);
    log('death', await lordState(id));
    await b.shot(`${out}/${name}-death.jpg`);
    // 结算在倒下 6.3 s（游戏时间）后；开头 1.2 s 真实时间的 0.3 倍慢放会让逐帧推进的游戏时间少走一截：按结算等
    let after = JSON.parse(await objective());
    for (let k = 0; k < 40 && !after.settled.includes(id); k++) {
      await step(0.5);
      after = JSON.parse(await objective());
    }
    log('settled', JSON.stringify(after));
    if (after.lit !== before.lit + 1) throw new Error(`${name} 倒下后灵火没点亮：${before.lit} → ${after.lit}`);
    if (after.lit < 3 && (after.cleared || after.portals > 0)) throw new Error(`${name} 倒下后不该清关 / 开出口`);
    // 看一眼点亮的灵火坛（站在坛前 7 m）
    log('altar view', await b.eval(`(() => {
      const c = window.__ctx, V = c.player.position.constructor, o = c.stage.levelObjective;
      const name = o.doc.bosses.find(x => x.bossId === '${id}').altar, a = o.altars.find(x => x.spec.name === name);
      for (let i = 0; i < 16; i++) {
        const ang = i / 16 * Math.PI * 2, x = a.position.x + Math.sin(ang) * 7, z = a.position.z + Math.cos(ang) * 7;
        const y = c.world.groundHeight(x, z, a.position.y + 6, 0.3);
        if (!Number.isFinite(y) || Math.abs(y - a.position.y) > 3) continue;
        c.player.teleport(new V(x, y + 0.05, z), 0);
        const e = c.player.eye, dx = a.position.x - e.x, dz = a.position.z - e.z;
        c.player.yaw = Math.atan2(-dx, -dz);
        c.player.pitch = Math.atan2(a.position.y + 2.5 - e.y, Math.hypot(dx, dz));
        return name;
      }
      return null;
    })()`));
    await step(0.5);
    await b.shot(`${out}/${name}-altar-lit.jpg`);
  }
  await step(6);
  const fin = JSON.parse(await objective());
  log('final', JSON.stringify(fin));
  const errors = b.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exception]'));
  log('errors', errors.length);
  for (const e of errors.slice(0, 30)) log(e);
} finally {
  await b.close();
}
