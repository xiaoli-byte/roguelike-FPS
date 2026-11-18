// 熔心魔将无头对局截图（docs/threejs-migration.md M6 验收）：?debug&dev&debugStage=3-3 开一局，把玩家放进神范台的首领场（场景文档 bosses[0]：
// 离中心 radius 以内、脚在首领场地面 floorY ±6 m 以内），让关卡自己触发首领战；逐帧推进游戏（Game.frame，固定步长，不靠后台标签页的 rAF），
// 在登场演出（下坠 → 落地 → 咆哮）、一阶段连斩、二阶段剑气、三阶段（狂怒换挡后的回旋二连）各拍一张。
//   node scripts/warlord/fight-shots.mjs [端口=5661] [输出目录=docs/art/review/threejs-migration]
// 开发钩子 window.__warlord 只在开发服务器里、网址带 ?dev 时存在（src/enemies/bosses/Warlord.ts）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5661';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const log = (...a) => console.log('[warlord]', ...a);
// 机器忙的时候 Chromium 起得慢（cdp.mjs 每次只等 30 s）：多试几轮
let b = null;
for (let k = 0; k < 4 && !b; k++) {
  try { b = await launch({ width: 1280, height: 720 }); } catch (e) { log('Chromium 没起来，重试', k + 1); }
}
if (!b) throw new Error('Chromium 起不来');

try {
  log('browser up');
  await Promise.race([b.goto(`http://localhost:${port}/?debug&dev&debugStage=3-3`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 90000))]);
  await b.waitFor('window.__game && window.__ctx', 300000);
  log('page ready');
  // 美术资产在后台加载（魔将的正式模型、大剑都在里面）：等清单加载完再开局
  for (let k = 0; k < 2400 && !b.logs.some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  log(b.logs.find(l => l.includes('[assets] 已加载')) ?? '美术资产没加载完');
  // 开发服务器第一次优化依赖时会整页重载：再等一次游戏对象
  await b.waitFor('window.__game && window.__ctx', 180000);
  // 停掉页面自己的 rAF 循环，改由下面的 step 逐帧推进
  await b.eval(`(() => {
    const g = window.__game;
    // 页面自己的 rAF 循环停掉（不然截图那一两秒里游戏按真实时间又跑了一截）
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
  for (let k = 0; k < 300; k++) {
    await b.eval('window.__step(0.1)');
    const ok = await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`);
    if (ok) break;
    await new Promise(r => setTimeout(r, 250));
  }
  log('state', await b.eval('window.__game.state'));
  await b.eval('window.__step(2)');
  const god = `(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`;
  // 玩家走进首领场：沿首领场中心 → 魔将出生点（高台）这条线，挑离中心 radius − 2 m 以内、站在首领场自己地面上的点（同 Unity BossEncounter.PlayerInArena）
  const entry = await b.eval(`(() => {
    const c = window.__ctx, V = c.player.position.constructor, boss = c.stage.unityDocument?.bosses?.find(x => x.id === 'boss_warlord');
    if (!boss) return null;
    const center = new V(boss.center[0], boss.floorY, boss.center[2]), spawn = new V(boss.position[0], boss.floorY, boss.position[2]);
    const away = center.clone().sub(spawn).setY(0).normalize();
    for (const d of [16, 14, 12, 10, 8, 6, 4]) {
      for (const side of [0, 3, -3, 6, -6]) {
        const p = center.clone().addScaledVector(away, d).add(new V(-away.z * side, 0, away.x * side));
        if (Math.hypot(p.x - center.x, p.z - center.z) > boss.radius - 2) continue;
        const y = c.world.groundHeight(p.x, p.z, boss.floorY + 4, 0.3);
        if (!Number.isFinite(y) || Math.abs(y - boss.floorY) > 2.5) continue;
        p.y = y + 0.05;
        c.player.teleport(p, Math.atan2(-(spawn.x - p.x), -(spawn.z - p.z)));
        c.player.pitch = 0.22;
        return { p: p.toArray(), boss };
      }
    }
    return { p: null, boss };
  })()`);
  log('entry', JSON.stringify(entry));
  let found = false;
  for (let k = 0; k < 600 && !found; k++) {
    await b.eval('window.__step(0.05)');
    await b.eval(god);
    found = await b.eval('!!window.__warlord');
  }
  log(found ? 'fight triggered by the level' : 'fight did not trigger');
  if (!found) {
    log('director', await b.eval(`JSON.stringify((() => { const s = window.__ctx.stage, st = s.adventureState, p = window.__ctx.player.position;
      const f = (s.whiteboxFights ?? []).find(x => x.id.startsWith('boss:'));
      return { t: s.t, next: s.nextEncounterAt, phase: st?.phase, whitebox: !!s.layout?.whitebox, enc: f ? st?.encounters?.find(e => e.id === f.id)?.phase : null,
        contains: f?.contains(p), depth: f?.contains(p, f.entryDepth), optional: f?.optional, requires: f?.requires, alive: window.__ctx.enemies.aliveCount(),
        waves: !!s.waves, encounterWaves: !!s.encounterWaves, others: (st?.encounters ?? []).filter(e => e.phase !== 'undiscovered').map(e => e.id + ':' + e.phase) };
    })())`));
    log('player', JSON.stringify(await b.eval(`({ p: window.__ctx.player.position.toArray(), alive: window.__ctx.enemies.aliveCount() })`)));
    await b.eval(`(() => { const c = window.__ctx, V = c.player.position.constructor, s = c.stage.unityDocument.bosses[0].position; c.enemies.spawn('boss_warlord', { position: new V(s[0], s[1], s[2]), level: c.run.difficulty }); return true; })()`);
    for (let k = 0; k < 20 && !found; k++) {
      await b.eval('window.__step(0.05)');
      found = await b.eval('!!window.__warlord');
    }
  }
  if (!found) throw new Error(`首领没有出现\n${b.logs.filter(l => !l.includes('加载失败')).slice(-30).join('\n')}`);
  const state = () => b.eval('JSON.stringify(window.__warlord.state())');
  const step = async (s) => { await b.eval(`window.__step(${s})`); await b.eval(god); };
  /** 推到登场演出的第 t 秒 */
  const introTo = async (t) => {
    for (let k = 0; k < 400; k++) {
      const st = JSON.parse(await state());
      if (!st.director || st.director.t >= t - 1e-3 || st.director.stage !== 'shots') return st;
      await step(Math.min(0.1, Math.max(1 / 60, t - st.director.t)));
    }
    return JSON.parse(await state());
  };
  log('spawned', await state());

  // ── 登场演出：远景（拖火下坠）→ 后侧低机位跟拍落地 → 咆哮特写 + 名字卡 ──
  log('intro vista', JSON.stringify(await introTo(1.75)));
  await b.shot(`${out}/warlord-intro-vista.jpg`);
  log('intro impact', JSON.stringify(await introTo(2.8)));
  await b.shot(`${out}/warlord-intro-impact.jpg`);
  log('intro roar', JSON.stringify(await introTo(3.85)));
  await b.shot(`${out}/warlord-intro-roar.jpg`);
  for (let k = 0; k < 60 && !JSON.parse(await state()).introDone; k++) await step(0.2);
  log('after intro', await state());

  /**
   * 截图站位：魔将挪到首领场中央一带一块平地上（地面高度在首领场地面 ±0.3 m 以内：不站进中央熔池 / 浅渠，否则预警、冲击环都埋在熔岩面下），
   * 玩家在他南边 dist 米的平地上、两人之间视线不挡，面朝他
   */
  const frontOf = async (dist, side = 0) => b.eval(`(() => {
    const c = window.__ctx, w = window.__warlord.boss, V = c.player.position.constructor, ctr = w.bossCenter;
    const ground = (x, z) => c.world.groundHeight(x, z, ctr.y + 4, 0.3);
    const flat = (x, z) => { const y = ground(x, z); if (!(Math.abs(y - ctr.y) <= 0.3)) return NaN;
      for (const [ox, oz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) if (!(Math.abs(ground(x + ox, z + oz) - y) <= 0.3)) return NaN; return y; };
    for (const dz of [13, 10, 16, 7, 19, 4]) for (const dx of [0, 4, -4, 8, -8]) {
      const bp = new V(ctr.x + dx, 0, ctr.z + dz), by = flat(bp.x, bp.z);
      if (!Number.isFinite(by)) continue;
      const p = new V(bp.x + ${side}, 0, bp.z - ${dist}), py = flat(p.x, p.z);
      if (!Number.isFinite(py)) continue;
      bp.y = by; p.y = py + 0.05;
      if (c.world.segmentBlocked(new V(p.x, p.y + 1.6, p.z), new V(bp.x, by + 2, bp.z))) continue;
      w.position.copy(bp);
      w.velocity.set(0, 0, 0);
      c.player.teleport(p, Math.atan2(-(bp.x - p.x), -(bp.z - p.z)));
      w.facing = Math.atan2(p.x - bp.x, p.z - bp.z);
      return [bp.toArray(), p.toArray()];
    }
    return null;
  })()`);
  /** 视线对准魔将身上（height 米高处） */
  const look = async (height = 2.2, pitchK = 1) => b.eval(`(() => {
    const c = window.__ctx, w = window.__warlord.boss, e = c.player.eye;
    const dx = w.position.x - e.x, dz = w.position.z - e.z, dy = w.position.y + ${height} - e.y;
    c.player.yaw = Math.atan2(-dx, -dz);
    c.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)) * ${pitchK};
    return true;
  })()`);
  /** 强制出招，推到招式时间轴的第 t 秒（期间每帧把视线对准他） */
  const moveTo = async (id, t, height = 2.2, keep = null) => {
    let ok = false;
    for (let k = 0; k < 40 && !ok; k++) {
      ok = await b.eval(`window.__warlord.forceMove('${id}')`);
      if (!ok) await step(0.1);
    }
    if (keep) await keep();
    let st = JSON.parse(await state());
    for (let k = 0; k < 600 && st.move === id; k++) {
      const mt = await b.eval('window.__warlord.boss.currentMove?.t ?? 99');
      if (mt >= t) break;
      await step(1 / 60);
      await look(height);
      st = JSON.parse(await state());
    }
    return st;
  };

  // ── 一阶段：焰刃连斩（袈裟 → 逆袈裟 → 下劈，拍下劈落地那一下） ──
  await step(1.5);
  log('stage', JSON.stringify(await frontOf(8, 1.5)));
  await look(2.0);
  log('phase1 combo', JSON.stringify(await moveTo('warlord_combo', 2.03, 1.8)));
  await b.shot(`${out}/warlord-phase1-combo.jpg`);
  await step(2.5);

  // ── 二阶段：50% 引动熔铜渠（转换演出 + 涨落），然后熔铜剑气（横剑气 + 竖剑气飞来） ──
  await b.eval('window.__warlord.setHealth(0.45)');
  await step(0.5);
  log('phase2 transition', await state());
  for (let k = 0; k < 40 && JSON.parse(await state()).transitioning; k++) await step(0.2);
  for (let k = 0; k < 40 && JSON.parse(await state()).move; k++) await step(0.2);
  log('phase2', await state());
  log('stage', JSON.stringify(await frontOf(16, 2)));
  await look(1.6, 0.6);
  log('phase2 wave', JSON.stringify(await moveTo('warlord_wave', 1.3, 1.4)));
  await b.shot(`${out}/warlord-phase2-wave.jpg`);
  await step(3);

  // ── 三阶段：20% 狂怒——咆哮炸开换挡（白热铜、肩头火），之后回旋二连 ──
  await b.eval('window.__warlord.setHealth(0.15)');
  for (let k = 0; k < 40 && !JSON.parse(await state()).transitioning; k++) await step(0.1);
  await frontOf(11);
  await look(2.2, 0.8);
  await step(1.3);
  log('phase3 fury', await state());
  for (let k = 0; k < 40 && JSON.parse(await state()).transitioning; k++) await step(0.1);
  await frontOf(10);
  await look(2.2, 0.8);
  // 转换后第一招就是回旋二连：等它第一圈出手
  for (let k = 0; k < 120; k++) {
    const st = JSON.parse(await state());
    if (st.move === 'warlord_spin' && st.stage === 'active') break;
    if (!st.move && k > 40) await b.eval(`window.__warlord.forceMove('warlord_spin')`);
    await step(1 / 30);
    await look(2.0, 0.8);
  }
  await step(0.05);
  log('phase3 spin', await state());
  await b.shot(`${out}/warlord-phase3-spin.jpg`);
  await step(2);
  log('end', await state());
  const errors = b.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exception]'));
  log('errors', errors.length);
  for (const e of errors.slice(0, 20)) log(e);
} finally {
  await b.close();
}
