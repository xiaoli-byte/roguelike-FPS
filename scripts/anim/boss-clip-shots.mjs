// M12 第二期首领 / 商人实机核对：鲲鹏（2-4）、火麒麟（3-4）、旱魃（1-4）走关卡触发首领战（玩家走进首领场，同 Unity BossEncounter），
// 看片段播放器有没有接上、招式播的是哪个片段、顿帧（impactHold）、化鹏展翅、倒下（鹏的手 K death / 火麒麟的晕眩冻住）；
// 商人：1-1 里在玩家面前摆一家商铺（ctx.loot.spawnShop），看强化台旁边的行商 Idle → 走近 Talk。
// 逐帧推进游戏（Game.frame 固定步长，页面自己的 rAF 关掉，不靠后台标签页），一次只开一个无头浏览器。
//   node scripts/anim/boss-clip-shots.mjs [端口=5712] [kunpeng|qilin|qilin-intro|hanba|merchant] [输出目录=docs/art/review/threejs-migration]
// qilin-intro：火麒麟登场逐帧核对——跃出段 tuck 片段一路往前走（不再每帧从 0 重播、播放实例不堆积），落地交叉淡入 rear；跃出 / 落地各截一张。
// 输出：<目录>/m12-<首领>-<节拍>.jpg；控制台打印每拍的首领状态（含 clip = 当前片段状态、impactHolds）与页面报错条数。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5712';
const which = process.argv[3] ?? 'kunpeng';
const out = process.argv[4] ?? 'docs/art/review/threejs-migration';
const STAGE = { kunpeng: '2-4', qilin: '3-4', 'qilin-intro': '3-4', hanba: '1-4', merchant: '1-1' }[which];
if (!STAGE) throw new Error(`不认识 ${which}`);
const HOOK = { kunpeng: '__kunpeng', qilin: '__qilin', 'qilin-intro': '__qilin', hanba: '__hanba', merchant: null }[which];
const log = (...a) => console.log(`[m12 ${which}]`, ...a);

let b = null;
for (let k = 0; k < 4 && !b; k++) {
  try { b = await launch({ width: 1280, height: 720 }); } catch { log('Chromium 没起来，重试', k + 1); await new Promise(r => setTimeout(r, 15000)); }
}
if (!b) throw new Error('Chromium 起不来');

const god = `(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`;
const step = async (s) => { await b.eval(`window.__step(${s})`); await b.eval(god); };
const shot = async (name) => {
  await b.eval('window.__step(1 / 240, 1 / 240)');
  await b.shot(`${out}/m12-${which}-${name}.jpg`);
};
const state = async () => (HOOK ? JSON.parse(await b.eval(`JSON.stringify(window.${HOOK}.state())`)) : null);
const brief = (s) => s && JSON.stringify({
  form: s.form, phase: s.phase, move: s.move, stage: s.stage, act: s.act, clip: s.clip, holds: s.impactHolds, intro: s.introDone, tr: s.transitioning,
  hp: s.hp, deathLanded: s.deathLanded, deathLandSource: s.deathLandSource,
});
/** 让玩家看向首领（或某点） */
const look = (expr = `window.${HOOK}.boss.getBodyCenter(new V())`, pitchK = 0.9) => b.eval(`(() => {
  const c = window.__ctx, V = c.player.position.constructor, e = c.player.eye, t = ${expr};
  c.player.yaw = Math.atan2(-(t.x - e.x), -(t.z - e.z));
  c.player.pitch = Math.max(-1, Math.min(1.1, Math.atan2(t.y - e.y, Math.hypot(t.x - e.x, t.z - e.z)) * ${pitchK}));
  return true;
})()`);
/** 跑到某个条件成立（最多 seconds 秒） */
const until = async (cond, seconds, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) {
    if (await b.eval(cond)) return true;
    await step(dt);
  }
  return !!(await b.eval(cond));
};
const kill = (hook) => b.eval(`(() => { const e = window.${hook}.boss; e.shield = 0; window.__ctx.combat.damageEnemy(e, { base: 1e7, element: 'none', source: 'status', canCrit: false }); return !e.alive; })()`);

try {
  await Promise.race([b.goto(`http://localhost:${port}/?debug&dev&debugStage=${STAGE}`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 120000))]);
  await b.waitFor('window.__game && window.__ctx', 300000);
  for (let k = 0; k < 2400 && !b.logs.some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  log(b.logs.find(l => l.includes('[assets] 已加载')) ?? '美术资产没加载完');
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
  for (let k = 0; k < 240; k++) {
    await b.eval('window.__step(0.1)');
    if (await b.eval(`!!window.__game && window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  log('state', await b.eval('window.__game.state'));
  await step(2);

  if (which === 'merchant') {
    // 玩家面前 10 m 摆一家商铺，正面朝玩家
    const at = await b.eval(`(() => {
      const c = window.__ctx, p = c.player, V = p.position.constructor;
      const f = new V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const center = p.position.clone().addScaledVector(f, 10);
      const gy = c.world.groundHeight(center.x, center.z, center.y + 5, 0.3);
      if (Number.isFinite(gy)) center.y = gy;
      window.__shopDispose = c.loot.spawnShop(center, Math.atan2(p.position.x - center.x, p.position.z - center.z));
      window.__shopCenter = center;
      const m = c.loot.merchants.keepers;
      return { center: center.toArray().map(v => +v.toFixed(2)), merchants: m.length, at: m[0]?.host.position.toArray().map(v => +v.toFixed(2)) ?? null };
    })()`);
    log('shop', JSON.stringify(at));
    const mstate = () => b.eval(`JSON.stringify(window.__ctx.loot.merchants.keepers.map(k => ({ ready: k.clips.ready, state: k.clips.state, talking: k.talking })))`);
    await step(1);
    // 远处看：Idle
    await b.eval(`(() => {
      const c = window.__ctx, k = c.loot.merchants.keepers[0], V = c.player.position.constructor, s = window.__shopCenter;
      const d = new V(s.x - k.host.position.x, 0, s.z - k.host.position.z).normalize();
      const p = k.host.position.clone().addScaledVector(d, 9.5);
      const gy = c.world.groundHeight(p.x, p.z, p.y + 5, 0.3);
      p.y = (Number.isFinite(gy) ? gy : p.y) + 0.05;
      c.player.teleport(p);
      return true;
    })()`);
    await step(1.5);
    await look('window.__ctx.loot.merchants.keepers[0].host.position.clone().setY(window.__ctx.loot.merchants.keepers[0].host.position.y + 1)', 0.8);
    log('far', await mstate());
    await shot('idle');
    // 走到强化台前：Talk
    await b.eval(`(() => {
      const c = window.__ctx, k = c.loot.merchants.keepers[0], V = c.player.position.constructor, s = window.__shopCenter;
      const d = new V(s.x - k.host.position.x, 0, s.z - k.host.position.z).normalize();
      const p = k.host.position.clone().addScaledVector(d, 3.6);
      const gy = c.world.groundHeight(p.x, p.z, p.y + 5, 0.3);
      p.y = (Number.isFinite(gy) ? gy : p.y) + 0.05;
      c.player.teleport(p);
      return true;
    })()`);
    await step(1.2);
    await look('window.__ctx.loot.merchants.keepers[0].host.position.clone().setY(window.__ctx.loot.merchants.keepers[0].host.position.y + 1)', 0.8);
    log('near', await mstate());
    await shot('talk');
    await b.eval('window.__shopDispose?.(), true');
    log('after dispose', await b.eval('window.__ctx.loot.merchants.keepers.length'));
  } else {
    // 3-4 的领主战门槛（M7 FoundryLordGate，Unity 关卡目标完成之前停用 BossEncounter）：直接当作目标已完成
    log('lord gates', await b.eval(`(() => { const m = window.__mechanisms; if (!m) return 'no mechanisms';
      const g = (m.levels ?? []).filter(l => l && typeof l.unlock === 'function' && 'unlocked' in l); g.forEach(l => l.unlock(false)); return g.length; })()`));
    // 玩家沿出生点 → 首领场中心走进首领场（脚在首领场自己的地面上），让关卡自己触发首领战
    const R = { kunpeng: [20, 40], qilin: [6, 18], 'qilin-intro': [6, 18], hanba: [8, 30] }[which];
    const rim = await b.eval(`(() => {
      const c = window.__ctx, V = c.player.position.constructor, boss = c.stage.unityDocument?.bosses?.[0];
      const floor = boss ? boss.floorY : c.stage.arena.floorY;
      const center = boss ? new V(boss.center[0], floor, boss.center[2]) : new V(0, floor, 0);
      const from = c.player.position.clone();
      for (let k = 0; k <= 200; k++) {
        const p = from.clone().lerp(center, k / 200);
        const d = Math.hypot(p.x - center.x, p.z - center.z);
        if (d > ${R[1]} || d < ${R[0]}) continue;
        const y = c.world.groundHeight(p.x, p.z, floor + 8, 0.3);
        if (!Number.isFinite(y) || Math.abs(y - floor) > 2.5) continue;
        p.y = y + 0.05;
        c.player.teleport(p, Math.atan2(-(center.x - p.x), -(center.z - p.z)));
        return [p.toArray().map(v => +v.toFixed(2)), boss?.id ?? null, boss?.radius ?? null, +d.toFixed(1)];
      }
      return null;
    })()`);
    log('rim', JSON.stringify(rim));
    if (!(await until(`!!window.${HOOK}`, 10, 0.1))) {
      throw new Error(`首领没有出现（关卡没触发首领战）\n${JSON.stringify(await b.eval(`({ p: window.__ctx.player.position.toArray(), alive: window.__ctx.enemies.aliveCount() })`))}\n${b.logs.slice(-20).join('\n')}`);
    }
    log('spawned', brief(await state()));

    if (which === 'kunpeng') {
      await step(3.2);
      log('intro roar', brief(await state()));
      await shot('intro');
      await until(`window.__kunpeng.state().introDone`, 12, 0.2);
      // 一阶段：猛砸（slamWind → 控制器连到 slam；释放帧顿帧）
      await b.eval(`(() => { const c = window.__ctx, h = window.__kunpeng.boss.hole, V = c.player.position.constructor;
        const p = h.point(window.__kunpeng.boss.theta + 25, h.radius + 11, new V()); const y = c.world.groundHeight(p.x, p.z, h.floorY + 6, 0.3);
        p.y = (Number.isFinite(y) ? y : h.floorY) + 0.05; c.player.teleport(p, 0); return true; })()`);
      await step(0.6);
      const h0 = (await state()).impactHolds;
      await b.eval(`window.__kunpeng.forceMove('slam')`);
      await step(0.5);
      log('slam windup', brief(await state()));
      await until(`window.__kunpeng.state().stage === 'active'`, 4);
      await step(0.1);
      await look('window.__kunpeng.boss.moveById("slam").impact.clone().setY(window.__kunpeng.boss.hole.floorY + 2.5)', 0.6);
      const s1 = await state();
      log('slam impact', brief(s1), 'holds +', s1.impactHolds - h0);
      await shot('slam');
      await until(`!window.__kunpeng.state().move`, 6, 0.1);
      log('slam done', brief(await state()));
      // 吞吸 → 扑咬（控制器连段）
      await b.eval(`window.__kunpeng.forceMove('inhale')`);
      await step(1.8);
      await look();
      log('inhale', brief(await state()));
      await shot('inhale');
      await until(`window.__kunpeng.state().stage === 'recover'`, 6);
      await step(0.1);
      log('bite', brief(await state()));
      await until(`!window.__kunpeng.state().move`, 6, 0.1);
      // 潜袭：sink → erupt
      await step(1);
      await b.eval(`window.__kunpeng.forceMove('dive')`);
      await step(1.0);
      log('dive sink', brief(await state()));
      await until(`window.__kunpeng.state().stage === 'active'`, 4);
      await step(0.1);
      await look();
      log('dive erupt', brief(await state()));
      await shot('dive');
      await until(`!window.__kunpeng.state().move`, 6, 0.1);
      // 化鹏：展翅（spread）
      const h1 = (await state()).impactHolds;
      await b.eval('window.__kunpeng.setHealth(0.45)');
      await until(`window.__kunpeng.state().transitioning`, 4, 0.1);
      await step(2.4);
      await look();
      log('transform rise', brief(await state()));
      await step(1.25);
      await look();
      const s2 = await state();
      log('transform spread', brief(s2), 'holds +', s2.impactHolds - h1);
      await shot('spread');
      await until(`!window.__kunpeng.state().transitioning`, 6, 0.2);
      log('peng', brief(await state()));
      // 二阶段：狂风
      await until(`window.__kunpeng.state().move === 'gust' && window.__kunpeng.state().stage === 'active'`, 8, 0.1);
      await step(0.4);
      await look();
      log('gust', brief(await state()));
      await shot('gust');
      await until(`!window.__kunpeng.state().move`, 8, 0.2);
      // 落台歇翼：perch 从下降开始播 → perchRest；起飞预警时 takeoff
      await b.eval('window.__kunpeng.boss.movesSincePerch = 2');
      await b.eval(`window.__kunpeng.forceMove('perch')`);
      await until(`window.__kunpeng.boss.currentMove?.sub === 'descend'`, 6, 0.05);
      log('perch descend', brief(await state()));
      await until(`window.__kunpeng.state().stage === 'active'`, 3, 0.05);
      log('perch land', brief(await state()));
      await step(1.2);
      await look();
      log('perch rest', brief(await state()));
      await shot('perch');
      await step(3.0);
      log('takeoff warn', brief(await state()));
      await until(`!window.__kunpeng.state().move`, 6, 0.1);
      // 倒下：手 K death
      await b.eval('window.__kunpeng.setHealth(0.2)');
      await step(0.5);
      await until(`!window.__kunpeng.state().move && !window.__kunpeng.state().transitioning`, 10, 0.2);
      log('kill', await kill('__kunpeng'));
      // 倒下演出有慢动作（框架的时间缩放），按首领自己的倒下时间等节拍
      const deathT = () => b.eval('+window.__kunpeng.boss.deathTime.toFixed(2)');
      await until(`window.__kunpeng.boss.deathTime >= 1.2`, 8, 0.05);
      await look();
      log('death fall', await deathT(), brief(await state()));
      await shot('death-fall');
      await until(`window.__kunpeng.boss.deathLandedAt >= 0`, 8, 0.05);
      log('death landed', await deathT(), brief(await state()));
      await until(`window.__kunpeng.boss.deathTime >= 3.1`, 8, 0.05);
      await look('window.__kunpeng.boss.peng.pts.chest.getWorldPosition(new V())', 0.9);
      log('death last cry', await deathT(), brief(await state()));
      await shot('death');
    } else if (which === 'qilin') {
      await until(`(window.__qilin.state().director?.t ?? 99) >= 3 || window.__qilin.state().introDone`, 10);
      await look();
      log('intro', brief(await state()));
      await shot('intro');
      await until(`window.__qilin.state().introDone`, 15, 0.2);
      await step(0.5);
      log('after intro', brief(await state()));
      // 鳞刃（rear → scalesFire）
      await until(`!window.__qilin.state().move`, 10, 0.1);
      // 走到离它 13 m、看得见的地方（殿里柱子多）
      log('approach', await b.eval(`(() => {
        const c = window.__ctx, e = window.__qilin.boss, V = c.player.position.constructor, eye = new V();
        for (let k = 0; k < 24; k++) {
          const a = k / 24 * Math.PI * 2, p = new V(e.position.x + Math.sin(a) * 13, 0, e.position.z + Math.cos(a) * 13);
          const y = c.world.groundHeight(p.x, p.z, e.position.y + 6, 0.3);
          if (!Number.isFinite(y) || Math.abs(y - e.position.y) > 1.5) continue;
          p.y = y + 0.05;
          eye.copy(p).setY(p.y + 1.6);
          if (c.world.segmentBlocked(eye, e.getBodyCenter(new V()))) continue;
          c.player.teleport(p);
          return p.toArray().map(v => +v.toFixed(1));
        }
        return null;
      })()`));
      await b.eval(`window.__qilin.forceMove('scales')`);
      await step(0.4);
      await look();
      log('scales windup', brief(await state()));
      await shot('rear');
      await until(`!window.__qilin.state().move`, 10, 0.1);
      // 奔驰（Locomotion 的 Walk / Move 混合）
      await b.eval(`window.__qilin.forceMove('gallop')`);
      await step(1.6);
      await look();
      log('gallop', brief(await state()));
      await shot('gallop');
      await until(`!window.__qilin.state().move`, 12, 0.1);
      // 化焚身
      await b.eval('window.__qilin.setHealth(0.5)');
      await until(`window.__qilin.state().transitioning`, 6, 0.1);
      await until(`!window.__qilin.state().transitioning`, 20, 0.2);
      await step(0.5);
      await look();
      log('burn', brief(await state()));
      await shot('burn');
      await until(`!window.__qilin.state().move`, 15, 0.2);
      await b.eval(`window.__qilin.forceMove('pant')`);
      await step(1.5);
      await look();
      log('pant', brief(await state()));
      await shot('pant');
      await until(`!window.__qilin.state().move`, 12, 0.2);
      log('kill', await kill('__qilin'));
      await step(2.0);
      await look();
      log('death', brief(await state()));
      await shot('death');
    } else if (which === 'qilin-intro') {
      // 逐帧记：登场进度（age / 登场秒数）、动作、片段状态机第 0 层的播放实例（状态、权重、归一化时刻）
      const probe = () => b.eval(`(() => {
        const e = window.__qilin.boss, a = e.F.clips?.anim?.animator;
        const pbs = a ? a.layerWeights(0) : [];
        return { t: +(e.age / e.spawnDuration).toFixed(3), present: e.presented, anim: e.anim, roared: e.introRoared,
          n: pbs.length, pbs: pbs.slice(0, 3).map((p) => p.state + ':' + p.weight.toFixed(2) + '@' + p.normalizedTime.toFixed(3)) };
      })()`);
      await until(`window.__qilin.boss.presented`, 12, 1 / 60);
      const rows = [];
      let maxN = 0, tuckNorm = -1, shotLeap = false;
      for (let k = 0; k < 150; k++) {
        const r = await probe();
        rows.push(r);
        maxN = Math.max(maxN, r.n);
        const tuck = r.pbs.find((x) => x.startsWith('tuck:'));
        if (tuck && !r.roared) tuckNorm = Math.max(tuckNorm, +tuck.split('@')[1]);
        if (!shotLeap && r.t >= 0.3) {
          shotLeap = true;
          await look();
          log('leap', JSON.stringify(r));
          await shot('leap');
        }
        if (r.roared && r.t >= 0.5) break;
        await step(1 / 60);
      }
      for (const r of rows.filter((_, i) => i % 6 === 0)) log(JSON.stringify(r));
      log('max playbacks', maxN, 'tuck reached', tuckNorm.toFixed(3), '（片段 0.9 s 拉伸到 3.2 s，ActScale 钳到 0.4：落地 t = 0.45 时约 0.64，蜷身 qCoil 在 0.593）');
      await look();
      log('land', JSON.stringify(await probe()));
      await shot('land');
      // 登场结束、第一招收招：照 Unity IntroDone / FinishMove 的 PlayLocomotion 无条件交叉淡入步态（0.15 s；已在步态里也自我过渡，会看到两个 Locomotion 实例）
      const edge = async (what, cond, seconds) => {
        if (!(await until(cond, seconds, 1 / 60))) { log(what, '没等到'); return; }
        const rows = [];
        for (let k = 0; k < 4; k++) { await step(1 / 60); rows.push(await probe()); }
        log(what, rows.map((r) => `${r.anim} [${r.pbs.join(' ')}]`).join(' | '));
      };
      await edge('intro end', `window.__qilin.state().introDone`, 15);
      await until(`!!window.__qilin.state().move`, 12, 1 / 30);
      log('first move', brief(await state()));
      await edge('move end', `!window.__qilin.state().move`, 15);
    } else if (which === 'hanba') {
      await until(`window.__hanba.state().introDone`, 20, 0.2);
      await step(0.3);
      log('after intro', brief(await state()));
      await until(`!!window.__hanba.state().move && window.__hanba.state().stage === 'active'`, 10, 0.05);
      await look();
      log('move', brief(await state()));
      await shot('move');
    }
  }
  const errors = b.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exception]'));
  log('errors', errors.length);
  for (const e of errors.slice(0, 20)) log(e);
} finally {
  await b.close();
}
