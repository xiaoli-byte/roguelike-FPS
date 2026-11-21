// M8 实机核对（docs/threejs-migration.md 4.6）：一个无头浏览器进 1-1（?debug&dev&debugStage=1-1），逐帧推进游戏（Game.frame，固定步长），
// 逐把武器按住开火、放技能、挂状态 / 带电，断言「打得出、照 Unity 的规则、零报错」，改了观感的拍一张。
//   [M8_ONLY=flamer,immune,…] node scripts/web/m8-shots.mjs [端口=5741] [输出目录=docs/art/review/threejs-migration] [英雄，逗号分隔=fox,bear,falcon]
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5741';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const heroes = (process.argv[4] ?? 'fox,bear,falcon').split(',');
/** 只跑某几段（逗号分隔，如 M8_ONLY=flamer,immune）：weapons dash aim flamer railgun recoil status charge arc blocked coins immune weakpoint skills；不设 = 全跑 */
const only = process.env.M8_ONLY ? new Set(process.env.M8_ONLY.split(',')) : null;
const want = k => !only || only.has(k);
const log = (...a) => console.log('[m8]', ...a);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  log(ok ? '✔' : '✖', name, detail);
};

let b = null;
for (let k = 0; k < 4 && !b; k++) {
  try { b = await launch({ width: 1280, height: 720 }); } catch { log('Chromium 没起来，重试', k + 1); }
}
if (!b) throw new Error('Chromium 起不来');

const step = s => b.eval(`window.__step(${s})`);
const errorsSince = start => b.logs.slice(start).filter(l => /error|Error|TypeError|undefined is not/.test(l) && !/favicon|DevTools|\[assets\]|net::ERR|load texture blob:/.test(l));

async function enter(hero) {
  const start = b.logs.length;
  await Promise.race([b.goto(`http://localhost:${port}/?debug&dev&debugStage=1-1`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 120000))]);
  await b.waitFor('window.__game && window.__ctx', 300000);
  for (let k = 0; k < 1200 && !b.logs.slice(start).some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  await b.eval(`(() => {
    const g = window.__game, c = window.__ctx;
    window.requestAnimationFrame = () => 0;
    window.__step = (seconds, dt = 1 / 60) => {
      let t = window.__simT ?? performance.now();
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
      window.__simT = t;
    };
    // 按键：held 里的一直按着，tap 里的只按一帧
    const held = new Set(), tap = new Set();
    const down = c.input.down.bind(c.input), pressed = c.input.pressed.bind(c.input);
    c.input.enabled = true;
    c.input.down = a => held.has(a) || tap.has(a) || down(a);
    c.input.pressed = a => { if (tap.has(a)) { tap.delete(a); return true; } return pressed(a); };
    window.__keys = { held, tap };
    window.__events = { denied: [], fired: 0, used: [] };
    return true;
  })()`);
  await b.eval(`window.__game.startRun(${JSON.stringify(hero)}), true`);
  for (let k = 0; k < 600; k++) {
    await step(0.1);
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  await step(1.5);
  await b.eval(`(() => {
    const c = window.__ctx;
    c.input.enabled = true;
    c.events.on('skill:denied', e => window.__events.denied.push(e.reason));
    c.events.on('skill:used', e => window.__events.used.push(e.skillId));
    c.events.on('weapon:fired', () => window.__events.fired++);
    return true;
  })()`);
  return start;
}

const god = () => b.eval(`(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`);
const hold = (a, on = true) => b.eval(`window.__keys.held[${on ? '"add"' : '"delete"'}](${JSON.stringify(a)}), true`);
const tap = a => b.eval(`window.__keys.tap.add(${JSON.stringify(a)}), true`);
/** 在玩家正前方 dist 米刷 n 只敌人（横排），返回数量 */
const foes = (defId, n, dist, elite = false) => b.eval(`(() => {
  const c = window.__ctx, p = c.player, V = p.position.constructor;
  const f = p.getForward(new V()), r = new V(f.z, 0, -f.x);
  let k = 0;
  for (let i = 0; i < ${n}; i++) {
    const s = (i - (${n} - 1) / 2) * 1.6;
    const x = p.position.x + f.x * ${dist} + r.x * s, z = p.position.z + f.z * ${dist} + r.z * s;
    const e = c.enemies.spawn(${JSON.stringify(defId)}, { position: new V(x, c.world.groundHeight(x, z, p.position.y + 3, 0.3), z), elite: ${elite} });
    if (e) k++;
  }
  return k;
})()`);
const clearFoes = () => b.eval(`(() => { const c = window.__ctx; for (const e of [...c.enemies.list]) if (e.alive) c.combat.damageEnemy(e, { base: 1e7, element: 'none', source: 'status', canCrit: false, procDepth: 2, tags: ['purge'] }); return true; })()`);
const give = id => b.eval(`(() => { const w = window.__ctx.weapons; const inst = w.roll({ defId: ${JSON.stringify(id)}, rarity: 2 }); w.give(inst); return inst.mag; })()`);
const mag = () => b.eval(`window.__ctx.weapons.active?.mag ?? -1`);
/** 回到进场位置、平视（冲刺 / 后坐之后别顶着墙测） */
const level = async () => { await b.eval(`(() => {
  const p = window.__ctx.player;
  window.__home ??= { pos: p.position.clone(), yaw: p.yaw };
  p.teleport(window.__home.pos.clone(), window.__home.yaw);
  p.pitch = 0; p.velocity.set(0, 0, 0);
  window.__step(0.1);
  return true;
})()`); };

for (const hero of heroes) {
  log('══', hero);
  const start = await enter(hero);
  await b.eval('window.__home = undefined, true');
  await god();
  await level();

  if (hero === heroes[0]) {
    if (want('weapons')) {
      // ── 逐把武器：按住开火 2.5 s，弹匣要动、事件要发 ──
      const ids = await b.eval(`window.__ctx.weapons.allDefIds()`);
      for (const id of ids) {
        await clearFoes();
        await foes('jerboa_blade', 3, 7);
        await step(0.9);
        await god();
        const before = await give(id);
        await step(0.5);
        const firedBefore = await b.eval('window.__events.fired');
        await hold('fire');
        await step(1.6);
        // 蓄力 / 半自动：松开再按几下
        await hold('fire', false);
        await step(0.2);
        for (let i = 0; i < 3; i++) { await tap('fire'); await step(0.5); }
        const fired = (await b.eval('window.__events.fired')) - firedBefore;
        const blade = await b.eval(`!!window.__ctx.weapons.bladeHud`);
        check(`${id} 打得出`, blade || fired > 0, `弹匣 ${before} → ${await mag()}，开火事件 ${fired}`);
      }
    }

    if (want('dash')) {
      // ── 冲刺禁射：全自动按住，冲刺那 0.2 s 里不出枪 ──
      await clearFoes();
      await give('smg');
      await step(0.6);
      await hold('fire');
      await step(0.3);
      await hold('forward');
      await tap('dash');
      await step(1 / 60);
      const dashing = await b.eval('window.__ctx.player.isDashing');
      const f0 = await b.eval('window.__events.fired');
      let during = 0;
      for (let i = 0; i < 6 && await b.eval('window.__ctx.player.isDashing'); i++) { await step(1 / 60); during = (await b.eval('window.__events.fired')) - f0; }
      await step(0.5);
      const after = (await b.eval('window.__events.fired')) - f0;
      await hold('fire', false);
      await hold('forward', false);
      check('冲刺禁射', dashing && during === 0 && after > 0, `冲刺中 ${during} 发，冲刺后 0.5 s 内 ${after} 发`);
    }

    if (want('aim')) {
      // ── 开镜：换弹时不开镜；狙击进镜零散布 ──
      await give('sniper');
      await step(0.6);
      await hold('aim');
      await step(0.4);
      const scoped = await b.eval(`(() => { const c = window.__ctx; return [c.weapons.aimT, c.cameraFx.fovKick, c.weapons.currentSpread]; })()`);
      check('狙击开镜 0.14 s 开完、镜里零散布', scoped[0] === 1 && scoped[1] === -45 && scoped[2] < 0.004, JSON.stringify(scoped));
      await tap('fire');
      await step(0.1);
      await tap('reload');
      await step(0.3);
      const reloadAim = await b.eval(`[window.__ctx.weapons.isReloading, window.__ctx.weapons.aimT]`);
      check('换弹时不开镜', reloadAim[0] === true && reloadAim[1] === 0, JSON.stringify(reloadAim));
      await hold('aim', false);
      await step(3);
    }

    if (want('flamer')) {
      // ── 喷火锥：5 只怪排在前面，按住喷，前 4 只（1 + 穿透 3）吃伤害；截图 ──
      await level();
      await clearFoes();
      await give('flamer');
      await step(0.6);
      await foes('jerboa_blade', 5, 6);
      await step(0.9);
      await god();
      // 准星压到中间那只的胸口：跳鼠比眼睛矮，平视时细锥（半角 0.06）会从头顶擦过去
      await b.eval(`(() => {
        const c = window.__ctx, p = c.player, V = p.position.constructor;
        const es = c.enemies.list.filter(e => e.alive);
        if (!es.length) return false;
        es.sort((a, b) => a.position.distanceToSquared(p.position) - b.position.distanceToSquared(p.position));
        const t = es[0].getBodyCenter(new V());
        p.pitch = Math.atan2(t.y - p.eye.y, Math.hypot(t.x - p.eye.x, t.z - p.eye.z));
        return true;
      })()`);
      const projBefore = await b.eval('window.__ctx.projectiles.count');
      await hold('fire');
      // 头几跳就读（跳鼠血薄，喷满 0.5 s 前排可能已经烧死，最后一跳就烧不到人了）
      await step(0.15);
      const flame = await b.eval(`(() => { const w = window.__ctx.weapons; return { burned: w.flame.lastBurned, reach: w.flame.lastReach, proj: window.__ctx.projectiles.count }; })()`);
      await step(0.2);
      await b.shot(`${out}/m8-flamer.jpg`);
      await hold('fire', false);
      check('喷火锥烧到怪、不发投射物', flame.burned >= 1 && flame.burned <= 4 && flame.proj <= projBefore, JSON.stringify(flame));
    }

    if (want('railgun')) {
      // ── 贯虹：蓄满松手，虹光出来；截图 ──
      await level();
      await clearFoes();
      await give('railgun');
      await step(0.6);
      await foes('jerboa_blade', 2, 12);
      await step(0.9);
      await god();
      await hold('fire');
      await step(1.3);
      const charge = await b.eval('window.__ctx.weapons.chargeProgress');
      await hold('fire', false);
      await step(0.05);
      const rail = await b.eval('window.__ctx.weapons.rail.live');
      await step(0.05);
      await b.shot(`${out}/m8-railgun.jpg`);
      check('贯虹满蓄出虹光', charge >= 1 && rail >= 1, `蓄力 ${charge}，虹光 ${rail} 条`);
      await step(0.5);
      check('虹光 0.38 s 收掉', (await b.eval('window.__ctx.weapons.rail.live')) === 0);
    }

    if (want('recoil')) {
      // ── 镜头后坐完全回正 ──
      await clearFoes();
      await give('rifle');
      await step(0.6);
      await level();
      await hold('fire');
      await step(1);
      const up = await b.eval('window.__ctx.player.pitch');
      await hold('fire', false);
      await step(1.2);
      const back = await b.eval('window.__ctx.player.pitch');
      check('后坐轻轻上跳、完全回正', up > 0 && up < 0.12 && Math.abs(back) < 1e-3, `连射 1 s 抬 ${(up * 57.3).toFixed(2)}°，停火后 ${(back * 57.3).toFixed(3)}°`);
    }

    if (want('status')) {
      // ── 玩家减益：寒意只降走路速度、点燃跳伤 ──
      const st = await b.eval(`(() => {
        const c = window.__ctx, p = c.player;
        p.invulnerableTime = 0;
        p.status.chill(0.35, 1.5);
        p.status.ignite(2, 3);
        const hp0 = p.hp + p.shield;
        window.__step(1.2);
        const r = { speedMult: p.status.speedMult, chill: p.status.has('chill'), ignite: p.status.has('ignite'), lost: hp0 - (p.hp + p.shield), base: p.stats.get('moveSpeed') };
        window.__step(1.5);
        r.after = [p.status.has('chill'), p.status.has('ignite'), p.status.speedMult];
        p.invulnerableTime = 9999;
        return r;
      })()`);
      check('寒意 / 点燃', st.chill && st.ignite && Math.abs(st.speedMult - 0.65) < 1e-6 && st.lost > 0 && st.after[0] === false && st.after[1] === false, JSON.stringify(st));
    }

    if (want('charge')) {
      // ── 带电：带电的怪被打死，电传给旁边的同伴；火一碰带电的怪就是焚雷 ──
      await level();
      await clearFoes();
      await foes('jerboa_blade', 3, 6);
      await step(1);
      const arc = await b.eval(`(() => {
        const c = window.__ctx, es = c.enemies.list.filter(e => e.alive);
        const ch = c.combat.charge;
        ch.apply(es[0], 6);
        const rx = [];
        const off = c.events.on('enemy:reaction', e => rx.push(e.reaction));
        // 第二只：带电 + 一发必定灼烧 → 焚雷
        ch.apply(es[1], 6);
        c.combat.damageEnemy(es[1], { base: 5, element: 'fire', source: 'weapon', elementChance: 1, procDepth: 0, point: es[1].getBodyCenter(new c.player.position.constructor()) });
        window.__step(0.3);
        c.combat.damageEnemy(es[0], { base: 1e5, element: 'none', source: 'weapon', procDepth: 0 });
        window.__step(0.1);
        off();
        return { charged: es.slice(1).filter(e => e.alive && ch.isCharged(e)).length, alive: es.filter(e => e.alive).length, rx };
      })()`);
      check('带电：死亡传电 + 火碰带电 = 焚雷', arc.rx.includes('thunderfire') && (arc.charged >= 1 || arc.alive <= 1), JSON.stringify(arc));
    }

    if (want('arc')) {
      // ── 死亡传电选目标（Unity Charge.Arc → ReactionSystem.Nearest）：身体中心 ≤ 8 m 才传，不加敌人半径 ──
      // 三只同种怪刷好、过了出生无敌后，结算前把两只同伴摆到源的正侧方：一只 7.4 m，一只 8 m + 0.6 × 半径（EnemyManager.queryRadius 的粗筛查得到）
      await level();
      await clearFoes();
      await foes('jerboa_blade', 3, 6);
      await step(1.2);
      const pick = await b.eval(`(() => {
        const c = window.__ctx, p = c.player, V = p.position.constructor;
        const es = c.enemies.list.filter(e => e.alive && !e.untargetable);
        if (es.length < 3) return null;
        const [src, inside, edge] = es;
        const f = p.getForward(new V()), r = new V(f.z, 0, -f.x);
        const radius = src.radius;
        inside.position.copy(src.position).addScaledVector(r, 7.4);
        edge.position.copy(src.position).addScaledVector(r, -(8 + radius * 0.6));
        const cs = src.getBodyCenter(new V());
        const d = e => +e.getBodyCenter(new V()).distanceTo(cs).toFixed(3);
        const dist = { dInside: d(inside), dEdge: d(edge) };
        const ch = c.combat.charge;
        ch.apply(src, 6);
        c.combat.damageEnemy(src, { base: 1e5, element: 'none', source: 'weapon', procDepth: 0 });
        return { radius, ...dist, insideCharged: ch.isCharged(inside), edgeCharged: ch.isCharged(edge), srcAlive: src.alive };
      })()`);
      check('死亡传电：8 m 内的传、8 m 外（粗筛的半径余量里）的不传', !!pick && !pick.srcAlive && pick.dInside <= 8 && pick.dEdge > 8 && pick.dEdge <= 8 + pick.radius
        && pick.insideCharged && !pick.edgeCharged, JSON.stringify(pick));
      await step(0.3);

      // ── 死亡传电的同步重入（Unity Charge.Arc 的 near 是共用静态表）：第一跳打死了 a，a 的放电清空 near，外层不再传 b ──
      // 源、a、b、c 排成一条线（a 1.5 m、b 3 m、c 4.5 m）；a 只剩 1 血。Unity：a 挨 1 下死 → a 放电给 b、c 各 1 下；b 不挨外层第二下
      await clearFoes();
      await foes('jerboa_blade', 4, 6);
      await step(1.2);
      const re = await b.eval(`(() => {
        const c = window.__ctx, p = c.player, V = p.position.constructor;
        const es = c.enemies.list.filter(e => e.alive && !e.untargetable);
        if (es.length < 4) return null;
        const [src, a, bb, cc] = es;
        const f = p.getForward(new V()), r = new V(f.z, 0, -f.x);
        a.position.copy(src.position).addScaledVector(r, 1.5);
        bb.position.copy(src.position).addScaledVector(r, 3);
        cc.position.copy(src.position).addScaledVector(r, 4.5);
        a.hp = 1;
        a.shield = 0;
        a.armor = 0;
        const name = new Map([[a, 'a'], [bb, 'b'], [cc, 'c']]);
        const hits = { a: 0, b: 0, c: 0 };
        const off = c.events.on('enemy:damaged', ev => {
          const k = name.get(ev.enemy);
          if (k && ev.result.request?.tags?.includes('chain')) hits[k]++;
        });
        const ch = c.combat.charge;
        ch.apply(src, 6);
        c.combat.damageEnemy(src, { base: 1e5, element: 'none', source: 'weapon', procDepth: 0 });
        off();
        return { hits, aAlive: a.alive, hopB: ch.book.state(bb)?.hop ?? null, hopC: ch.book.state(cc)?.hop ?? null };
      })()`);
      check('死亡传电重入：第一跳打死 a 就停，b、c 各挨 a 放的 1 下（跳数 2）', !!re && !re.aAlive && re.hits.a === 1 && re.hits.b === 1 && re.hits.c === 1
        && re.hopB === 2 && re.hopC === 2, JSON.stringify(re));
      await step(0.3);
    }

    if (want('blocked')) {
      // ── 格挡（Unity DamageNumbers.Kind.Blocked）：命中区整发挡掉 → 浮字「格挡」+ 派发 enemy:damaged，不弹「免疫」 ──
      await level();
      await clearFoes();
      await foes('jerboa_blade', 1, 5);
      await step(1.2);
      const blk = await b.eval(`(() => {
        const c = window.__ctx, V = c.player.position.constructor;
        const e = c.enemies.list.find(x => x.alive && !x.untargetable);
        if (!e) return null;
        c.settings.damageNumbers = true;
        e.hitZones = { zoneAt: () => ({ multiplierFor: () => 0, record() {} }) };
        const seen = [], shown = [];
        const off = c.events.on('enemy:damaged', ev => { if (ev.enemy === e) seen.push({ blocked: !!ev.result.blocked, immune: !!ev.result.immune, dealt: ev.result.dealt }); });
        const ui = c.ui, orig = ui.damageNumber;
        ui.damageNumber = function (pos, amount, opts) { shown.push({ amount, kind: opts?.kind, text: opts?.text }); return orig.call(this, pos, amount, opts); };
        const count = t => [...document.querySelectorAll('.sf-dn')].filter(n => n.textContent === t).length;
        const before = { blocked: count('格挡'), immune: count('免疫') };
        const hp0 = e.hp;
        c.combat.damageEnemy(e, { base: 40, element: 'none', source: 'weapon', procDepth: 0, canCrit: false, point: e.getBodyCenter(new V()), direction: new V(0, 0, 1) });
        window.__step(0.12);
        ui.damageNumber = orig;
        off();
        e.hitZones = null;
        return { seen, shown, kept: e.hp === hp0, dom: { blocked: count('格挡') - before.blocked, immune: count('免疫') - before.immune } };
      })()`);
      await b.shot(`${out}/m8-blocked.jpg`);
      check('格挡：浮字「格挡」、派发 enemy:damaged、不弹「免疫」', !!blk && blk.kept && blk.seen.length === 1 && blk.seen[0].blocked && !blk.seen[0].immune
        && blk.shown.length === 1 && blk.shown[0].text === '格挡' && blk.dom.blocked >= 1 && blk.dom.immune === 0, JSON.stringify(blk));
    }

    if (want('coins')) {
      // ── 货币叫法（Unity D13）：宝箱提示、奖励名、属性名都写灵石 ──
      const coins = await b.eval(`(() => {
        const c = window.__ctx, p = c.player, V = p.position.constructor;
        const f = p.getForward(new V());
        c.loot.spawnChest(new V(p.position.x + f.x * 4, p.position.y, p.position.z + f.z * 4), 'coins');
        window.__step(0.2);
        const chest = c.loot.chests.list.at(-1);
        const prompt = chest?.interactable?.prompt?.();
        return { prompt, label: c.runPlan.rewardLabel('coins') };
      })()`);
      check('货币叫灵石：宝箱提示 / 奖励名', !!coins.prompt && JSON.stringify(coins.prompt).includes('一大堆灵石') && !JSON.stringify(coins).includes('金币') && coins.label === '灵石', JSON.stringify(coins));
    }

    if (want('immune')) {
      // ── 免疫（Unity Combat.Immune）：刚出生 0.7 s 不可选中——打上去返回 immune、不扣血，0.4 s 内只派发一次 enemy:damaged ──
      await level();
      await clearFoes();
      const imm = await b.eval(`(() => {
        const c = window.__ctx, p = c.player, V = p.position.constructor;
        const f = p.getForward(new V());
        const x = p.position.x + f.x * 6, z = p.position.z + f.z * 6;
        const e = c.enemies.spawn('jerboa_blade', { position: new V(x, c.world.groundHeight(x, z, p.position.y + 3, 0.3), z) });
        const seen = [];
        const off = c.events.on('enemy:damaged', ev => { if (ev.enemy === e) seen.push(!!ev.result.immune); });
        const untargetable = e.untargetable;
        const hp0 = e.hp;
        const r1 = c.combat.damageEnemy(e, { base: 10, element: 'none', source: 'weapon', procDepth: 0 });
        const r2 = c.combat.damageEnemy(e, { base: 10, element: 'none', source: 'weapon', procDepth: 0 });
        window.__step(0.5);
        const r3 = c.combat.damageEnemy(e, { base: 10, element: 'none', source: 'weapon', procDepth: 0 });
        off();
        return { untargetable, r1: r1 && { immune: !!r1.immune, dealt: r1.dealt }, r2: !!r2?.immune, r3: !!r3?.immune, seen, kept: e.hp === hp0 };
      })()`);
      check('免疫：不可选中返回 immune、不扣血、0.4 s 只派发一次', imm.untargetable && imm.r1?.immune && imm.r1.dealt === 0 && imm.r2 && imm.kept
        && imm.seen.length >= 1 && imm.seen[0] === true && imm.seen.filter(Boolean).length <= 2, JSON.stringify(imm));
    }

    if (want('weakpoint')) {
      // ── 「破绽」weak_point：3 层后弱点伤害 ×1.45，身体不变 ──
      await step(1);
      const wp = await b.eval(`(() => {
        const c = window.__ctx, e = c.enemies.list.find(x => x.alive && !x.untargetable);
        if (!e) return null;
        const hit = headshot => { const hp = e.hp + (e.shield ?? 0) + (e.armor ?? 0); c.combat.damageEnemy(e, { base: 1, element: 'none', source: 'weapon', procDepth: 0, canCrit: false, headshot }); return hp - (e.hp + (e.shield ?? 0) + (e.armor ?? 0)); };
        const b0 = hit(false), w0 = hit(true);
        for (let i = 0; i < 3; i++) c.scrolls.add('weak_point');
        const b1 = hit(false), w1 = hit(true);
        return { body: [b0, b1], weak: [w0, w1], stat: c.player.stats.get('weakpointDamagePct') };
      })()`);
      check('「破绽」3 层：弱点 ×1.45、身体不变', !!wp && Math.abs(wp.weak[1] / wp.weak[0] - 1.45) < 1e-3 && Math.abs(wp.body[1] - wp.body[0]) < 1e-6 && Math.abs(wp.stat - 0.45) < 1e-9, JSON.stringify(wp));
    }
  }

  if (want('skills')) {
    // ── 技能：Q / E 各放一次，施法姿势在播；没充能再按给拒绝事件；截图 ──
    await clearFoes();
    await foes('jerboa_blade', 4, 7);
    await step(1);
    await god();
    await level();
    await tap('skillSecondary');
    await step(0.12);
    const pose1 = await b.eval(`(() => { const p = window.__ctx.player.castPose; return [p.playing, Math.hypot(p.pos.x, p.pos.y, p.pos.z), Math.hypot(p.rot.x, p.rot.y, p.rot.z)]; })()`);
    await b.shot(`${out}/m8-cast-${hero}.jpg`);
    await step(1.4);
    await tap('skillPrimary');
    await step(0.1);
    const pose2 = await b.eval(`window.__ctx.player.castPose.playing`);
    await step(2);
    const used = await b.eval('window.__events.used');
    check(`${hero} 技能放得出、有施法姿势`, used.length >= 2 && pose1[0] !== 'none' && pose1[1] > 0.005 && pose2 !== 'none', `${JSON.stringify(used)} ${JSON.stringify(pose1)} ${pose2}`);
    // 主技能刚放完（1 层充能）：再按 → 拒绝
    await step(0.5);
    await tap('skillPrimary');
    await step(0.1);
    const denied = await b.eval('window.__events.denied');
    check(`${hero} 没充能 / 持续中再按给拒绝事件`, denied.length >= 1 && ['cooldown', 'busy'].includes(denied[0]), JSON.stringify(denied));
    if (hero === 'bear') {
      // 磐石壁垒的挡弹罩：朝玩家胸口打一发敌方投射物，被罩子挡下
      const ward = await b.eval(`(() => {
        const c = window.__ctx, p = c.player, V = p.position.constructor;
        const st = p.skillCtl.states.primary;
        st.charges = st.maxCharges; st.cooldownRemaining = 0;
        window.__step(0.05);
        window.__keys.tap.add('skillPrimary');
        window.__step(0.3);
        p.invulnerableTime = 0;
        const hp0 = p.hp + p.shield;
        const f = p.getForward(new V());
        const from = new V(p.position.x + f.x * 8, p.position.y + 1, p.position.z + f.z * 8);
        c.projectiles.spawn({ owner: 'enemy', position: from, velocity: new V(-f.x * 20, 0, -f.z * 20), gravity: 0, radius: 0.15, lifetime: 2, enemyDamage: 30, element: 'none', color: 0xff5533, visual: 'orb' });
        window.__step(0.8);
        const r = { lost: hp0 - (p.hp + p.shield), count: c.projectiles.count };
        p.invulnerableTime = 9999;
        return r;
      })()`);
      check('磐石壁垒挡下飞来的投射物', ward.lost === 0, JSON.stringify(ward));
    }
  }
  const errs = errorsSince(start);
  check(`${hero} 零报错`, errs.length === 0, errs.slice(0, 4).join(' | '));
}

await b.close();
const bad = results.filter(r => !r.ok);
log(`${results.length - bad.length} / ${results.length} 通过`);
if (bad.length) {
  for (const r of bad) log('✖', r.name, r.detail);
  process.exitCode = 1;
}
