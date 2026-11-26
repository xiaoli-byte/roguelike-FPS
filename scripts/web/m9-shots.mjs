// M9 灵宠实机核对（docs/threejs-migration.md 4.8）：一个无头浏览器进 1-1（?debug&dev&debugStage=1-1），逐帧推进游戏（Game.frame，固定步长），
// 逐只结契八只灵宠（window.__pets 调试入口），看跟随、出手、灵技、换关保留、换宠留封印、嘲讽，断言伤害数照灵宠规则、零报错，每只拍一张。
//   [M9_ONLY=pets,stone,swap,stage,taunt,altar] [M9_PETS=jingwei,yinglong] node scripts/web/m9-shots.mjs [端口=5721] [输出目录=docs/art/review/threejs-migration]
// worktree 里跑要给 vite 放行主检出的 node_modules（见 docs/threejs-migration.md 第 4 节 M11c 的说明）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5721';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const only = process.env.M9_ONLY ? new Set(process.env.M9_ONLY.split(',')) : null;
const want = k => !only || only.has(k);
const t0 = Date.now();
const log = (...a) => console.log(`[m9 +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
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
/** 页面报错：console.error / 未捕获异常（警告另记：本机 DLP 偶尔把发布的 ogg 存成密文，音频解不出来是 [warning]，和灵宠无关） */
const errorsSince = start => b.logs.slice(start).filter(l => /^\[(error|exception)\]/.test(l) && !/favicon|DevTools|\[assets\]|net::ERR/.test(l));
const warningsSince = start => b.logs.slice(start).filter(l => /^\[warning\]/.test(l) && /Error|error|失败/.test(l));

async function enter(query = '') {
  const start = b.logs.length;
  await Promise.race([b.goto(`http://127.0.0.1:${port}/?debug&dev&debugStage=1-1${query}`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 120000))]);
  await b.waitFor('window.__game && window.__ctx && window.__pets', 300000);
  for (let k = 0; k < 1200 && !b.logs.slice(start).some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
  log('页面就绪', query || '（无参数）');
  await b.eval(`(() => {
    const g = window.__game, c = window.__ctx;
    window.requestAnimationFrame = () => 0;
    window.__step = (seconds, dt = 1 / 60) => {
      let t = window.__simT ?? performance.now();
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
      window.__simT = t;
    };
    const held = new Set(), tap = new Set();
    const down = c.input.down.bind(c.input), pressed = c.input.pressed.bind(c.input), keyPressed = c.input.keyPressed.bind(c.input);
    c.input.down = a => held.has(a) || tap.has(a) || down(a);
    c.input.pressed = a => { if (tap.has(a)) { tap.delete(a); return true; } return pressed(a); };
    c.input.keyPressed = k => { if (tap.has(k)) { tap.delete(k); return true; } return keyPressed(k); };
    window.__keys = { held, tap };
    return true;
  })()`);
  await b.eval(`window.__game.startRun('fox'), true`);
  for (let k = 0; k < 600; k++) {
    await step(0.1);
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  log('进关');
  await step(1.5);
  await b.eval(`(() => {
    const c = window.__ctx;
    c.input.enabled = true;
    window.__petHits = [];
    // 每一次灵宠伤害：出手之前的预期倍率（Combat.previewMultiplier：只吃灵宠伤害、元素、易伤、输出修饰器、层）和这一次的结算结果配成一对，
    // 在包装里就地记（结算里会嵌套别的伤害、派发事件的先后不可靠：雷殛弹射、反应、连锁）
    const orig = c.combat.damageEnemy.bind(c.combat);
    c.combat.damageEnemy = (e, q) => {
      if (q.source !== 'pet') return orig(e, q);
      const m = c.combat.previewMultiplier(e, q);
      const clean = e.alive && e.shield <= 0 && e.armor <= 0 && !e.untargetable;
      const hpBefore = e.hp;
      const r = orig(e, q);
      if (r) window.__petHits.push({ base: q.base, dealt: r.dealt, crit: r.isCrit, force: !!q.forceCrit, canCrit: q.canCrit, el: q.element, tags: (q.tags || []).join(','),
        layer: r.layer, immune: !!r.immune, preview: m, full: clean && !r.killed && r.dealt < hpBefore });
      return r;
    };
    return true;
  })()`);
  return start;
}

const god = () => b.eval(`(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`);
/** 在玩家正前方 dist 米刷 n 只敌人（横排） */
const foes = (defId, n, dist, elite = false) => b.eval(`(() => {
  const c = window.__ctx, p = c.player, V = p.position.constructor;
  const f = p.getForward(new V()), r = new V(f.z, 0, -f.x);
  let k = 0;
  for (let i = 0; i < ${n}; i++) {
    const s = (i - (${n} - 1) / 2) * 1.8;
    const x = p.position.x + f.x * ${dist} + r.x * s, z = p.position.z + f.z * ${dist} + r.z * s;
    const e = c.enemies.spawn(${JSON.stringify(defId)}, { position: new V(x, c.world.groundHeight(x, z, p.position.y + 3, 0.3), z), elite: ${elite} });
    if (e) k++;
  }
  // 这一排的中心：怪全倒了（灵技清场）时镜头照样对着战场
  const cx = p.position.x + f.x * ${dist}, cz = p.position.z + f.z * ${dist};
  window.__foeSpot = new V(cx, c.world.groundHeight(cx, cz, p.position.y + 3, 0.3) + 0.8, cz);
  return k;
})()`);
const clearFoes = () => b.eval(`(() => { const c = window.__ctx; for (const e of [...c.enemies.list]) if (e.alive) c.combat.damageEnemy(e, { base: 1e7, element: 'none', source: 'status', canCrit: false, procDepth: 2, tags: ['purge'] }); return true; })()`);
const home = async () => { await b.eval(`(() => {
  const p = window.__ctx.player;
  window.__home ??= { pos: p.position.clone(), yaw: p.yaw };
  p.teleport(window.__home.pos.clone(), window.__home.yaw);
  p.pitch = -0.05; p.velocity.set(0, 0, 0);
  window.__step(0.1);
  return true;
})()`); };
const pet = () => b.eval(`(() => { const p = window.__pets.pet; if (!p) return null;
  const c = window.__ctx;
  return { id: p.def.id, level: p.level, xp: p.xp, state: p.state, skillLeft: p.skillLeft, dmg: p.damageDealt, rigged: p.rigged,
    dist: Math.hypot(p.position.x - c.player.position.x, p.position.z - c.player.position.z), y: p.position.y - c.player.position.y,
    target: !!p.target, busy: p.isBusy, placeholder: p.model.placeholder, fur: p.model.fur ? p.model.fur.shells.length : 0, part: !!p.model.part };
})()`);
/** 镜头对着灵宠和前方的怪（第一人称：微微低头看前方） */
const lookAhead = () => b.eval(`(() => { const p = window.__ctx.player; p.pitch = -0.12; return true; })()`);
/**
 * 玩家视角拍灵宠出手：玩家站到灵宠身后（目标 → 灵宠连线的延长线上 back 米），镜头对着灵宠与目标之间，
 * 灵宠、弹道 / 闪电、挨打的怪同在画面里（飞行灵宠悬在玩家头顶，直接看它只拍得到天）。怪全倒了就对着刚才那一排的位置，什么都没有就看灵宠。
 */
const lookAtPet = async (back = null) => {
  await b.eval(`(() => {
    const c = window.__ctx, p = c.player, pet = window.__pets.pet; if (!pet) return false;
    const V = p.position.constructor, pc = pet.center();
    let tgt = pet.target && pet.target.alive ? pet.target : null;
    if (!tgt) { let best = Infinity; for (const e of c.enemies.list) { if (!e.alive) continue; const d = e.position.distanceTo(pc); if (d < best) { best = d; tgt = e; } } }
    window.__shotTarget = tgt;
    const ec = tgt ? tgt.getBodyCenter(new V()) : window.__foeSpot ? window.__foeSpot.clone() : null;
    window.__shotAim = ec;
    if (!ec) return true;
    const dx = pc.x - ec.x, dz = pc.z - ec.z, d = Math.hypot(dx, dz) || 1;
    // 飞行灵宠悬得高：站远一点，免得只拍到天
    const back = ${back ?? 'null'} ?? (pet.def.flying ? 6 : 3.6);
    // 正后方被墙挡住就绕着灵宠转一点再试（要同时看得见灵宠和目标）
    let spot = null;
    for (const deg of [0, 30, -30, 60, -60, 95, -95]) {
      const a = deg * Math.PI / 180, ux = (dx * Math.cos(a) - dz * Math.sin(a)) / d, uz = (dx * Math.sin(a) + dz * Math.cos(a)) / d;
      const x = pc.x + ux * back, z = pc.z + uz * back;
      const g = c.world.groundHeight(x, z, p.position.y + 3, 0.3);
      const pos = new V(x, Number.isFinite(g) ? g : p.position.y, z);
      const eye = pos.clone(); eye.y += 1.62;
      if (!c.world.segmentBlocked(eye, pc) && !c.world.segmentBlocked(eye, ec)) { spot = pos; break; }
      spot ??= pos;
    }
    p.teleport(spot, p.yaw);
    p.velocity.set(0, 0, 0);
    return true; })()`);
  await step(1 / 60);
  await b.eval(`(() => {
    const c = window.__ctx, p = c.player, pet = window.__pets.pet; if (!pet) return false;
    const V = p.position.constructor, e = p.eye, tgt = window.__shotTarget;
    const t = pet.center();
    const ec = tgt && tgt.alive ? tgt.getBodyCenter(new V()) : window.__shotAim;
    if (ec) t.lerp(ec, pet.def.flying ? 0.62 : 0.45);
    p.yaw = Math.atan2(-(t.x - e.x), -(t.z - e.z));
    p.pitch = Math.atan2(t.y - e.y, Math.hypot(t.x - e.x, t.z - e.z));
    return true; })()`);
  await step(1 / 60);
};

const PETS = ['dangkang', 'huan', 'jingwei', 'chongming', 'suanni', 'zheng', 'baize', 'yinglong'].filter(id => !process.env.M9_PETS || process.env.M9_PETS.split(',').includes(id));
const FOE = 'jerboa_blade';
/** 灵技放出后多久拍（秒）：投石 / 雷暴要等落下来 */
const SKILL_SHOT_AT = { jingwei: 1.3, chongming: 0.15, yinglong: 0.4 };
/** 收拾场地（截图干净）：收掉封印（精英 6% 掉的）和地上的掉落物（LootSystem 的拾取物私有，调试脚本直接清） */
const tidy = () => b.eval('window.__pets.seals.forEach(s => s.remove()), window.__ctx.loot.pickups.clear(), true');
const aliveFoes = () => b.eval('window.__ctx.enemies.list.filter(e => e.alive).length');

// 一个页面跑到底（中途重开页面在这台机器上会卡死渲染进程）：灵兽台用调试入口 __pets.altar() 摆（同 ?petAltar 进关时摆的那一套）
const start = await enter('');
await b.eval('window.__home = undefined, true');
await god();
await home();

if (want('pets')) {
  for (const id of PETS) {
    await clearFoes();
    // 上一只灵技段的精英被击杀可能掉了封印（6%）、满地掉落物：收掉，不进下一只的画面
    await tidy();
    await home();
    // 先解除上一只（不留封印：一只只拍，脚边不堆封印）
    await b.eval(`window.__pets.unbind(), window.__pets.give(${JSON.stringify(id)}, 1), window.__petHits.length = 0, true`);
    await step(1.2);
    // 动画数据是异步读的（开局就预读了）：真实时间再等一会儿
    for (let k = 0; k < 20 && !(await pet())?.rigged; k++) { await new Promise(r => setTimeout(r, 200)); await step(0.05); }
    const p1 = await pet();
    check(`${id}：结契、模型 / 动画`, p1?.id === id && !p1.placeholder && p1.rigged, JSON.stringify(p1));
    // 跟随：玩家往前走 6 米，灵宠要跟上
    await b.eval(`(() => { const p = window.__ctx.player, V = p.position.constructor; const f = p.getForward(new V()); p.teleport(p.position.clone().addScaledVector(f, 6), p.yaw); return true; })()`);
    await step(2.2);
    const p2 = await pet();
    check(`${id}：跟随`, p2 && p2.dist < 4.5 && p2.dist > 0.5, `离玩家 ${p2?.dist.toFixed(2)} m，高 ${p2?.y.toFixed(2)}`);
    await home();
    await foes(FOE, 3, 9);
    await step(0.9);
    await god();
    await lookAhead();
    // 普攻：等它出手
    let hits = 0;
    for (let k = 0; k < 16 && hits === 0; k++) {
      await step(0.5);
      hits = await b.eval('window.__petHits.length');
    }
    const sample = await b.eval('window.__petHits.slice(0, 40)');
    const bad = sample.filter(h => h.source === 'x' || h.canCrit !== false || !h.tags.includes('pet') || (h.crit && !h.force));
    check(`${id}：普攻打得出、走灵宠伤害源`, hits > 0 && bad.length === 0, `命中 ${hits} 次，样本 ${JSON.stringify(sample[0] ?? null)}`);
    // 伤害数：没暴击、满血、没有护盾 / 护甲时 = 基础 × 预览倍率（只吃灵宠伤害等）
    const plain = sample.filter(h => !h.crit && h.layer === 'health' && h.full && !h.immune);
    const off = plain.filter(h => Math.abs(h.dealt - h.base * h.preview) > 0.02 * Math.max(1, h.base * h.preview));
    check(`${id}：伤害数 = 基础 × 灵宠倍率`, plain.length > 0 && off.length === 0, `${plain.length} 次，偏差 ${off.length}：${JSON.stringify(off[0] ?? plain[0] ?? null)}`);
    // 截图前场上要有活着的怪（应龙 / 狰这种几下就清场的：补一排，等它再出手）
    if (await aliveFoes() < 2) { await foes(FOE, 3, 8); await step(1.2); await god(); }
    await step(0.25);
    await lookAtPet();
    await b.shot(`${out}/m9-${id}-attack.jpg`);
    // 灵技
    await foes(FOE, 3, 11, true);
    await step(0.8);
    await god();
    const before = await b.eval('window.__petHits.length');
    const cast = await b.eval('window.__pets.forceSkill()');
    await step(SKILL_SHOT_AT[id] ?? 0.45);
    await lookAtPet();
    await b.shot(`${out}/m9-${id}-skill.jpg`);
    await step(2.5);
    const p3 = await pet();
    const after = await b.eval('window.__petHits.length');
    check(`${id}：灵技放出、进冷却`, cast === true && p3.skillLeft > 0, `冷却剩 ${p3.skillLeft.toFixed(1)} s，期间命中 ${after - before}`);
    await clearFoes();
    await god();
  }
}

if (want('stone')) {
  // 精卫火石落地爆炸（审查第 1 轮）：照 Unity PlayerProjectile.Impact 播爆炸特效和爆炸声（弹体色 0xffd9a0）、边缘 30%——拍爆炸那一刻
  await clearFoes();
  await tidy();
  await home();
  await b.eval(`window.__pets.unbind(), window.__pets.give('jingwei', 1), true`);
  await step(1.2);
  await b.eval(`(() => {
    const c = window.__ctx;
    window.__booms = [];
    const orig = c.combat.explode.bind(c.combat);
    c.combat.explode = (at, r, q, o) => { if (q.source === 'pet') window.__booms.push({ t: c.time.now, r, o: { ...(o || {}) } }); return orig(at, r, q, o); };
    return true;
  })()`);
  await foes(FOE, 3, 9);
  await step(0.6);
  await god();
  await lookAhead();
  const waitBoom = async (n, max) => {
    for (let k = 0; k < max; k++) {
      if ((await b.eval('window.__booms.length')) >= n) return true;
      await step(1 / 60);
    }
    return false;
  };
  await lookAtPet();
  const got = await waitBoom(1, 600);
  await step(2 / 60);
  await b.shot(`${out}/m9-jingwei-stone.jpg`);
  const boom = await b.eval('window.__booms[0] ?? null');
  check('精卫火石：落地爆炸边缘 30%、播爆炸特效（色 0xffd9a0）', got && boom && boom.o.falloff === 0.3 && boom.o.color === 0xffd9a0 && !boom.o.noFx, JSON.stringify(boom));
  // 衔石填海：准星对着那一排怪的脚下，十颗火石陆续落下（怪还在出生显形、没扑过来时就放，画面里看得清落点）
  await clearFoes();
  await tidy();
  await foes(FOE, 3, 13, true);
  await step(0.1);
  await god();
  await b.eval(`(() => { const c = window.__ctx, p = c.player, s = window.__foeSpot, e = p.eye;
    p.yaw = Math.atan2(-(s.x - e.x), -(s.z - e.z)); p.pitch = Math.atan2(s.y - 0.8 - e.y, Math.hypot(s.x - e.x, s.z - e.z)); return true; })()`);
  await step(1 / 60);
  const n0 = await b.eval('window.__booms.length');
  const cast = await b.eval('window.__pets.forceSkill()');
  const rained = await waitBoom(n0 + 3, 600);
  await step(3 / 60);
  await b.shot(`${out}/m9-jingwei-rain.jpg`);
  await step(2);
  const rain = await b.eval(`window.__booms.slice(${n0})`);
  check('精卫「衔石填海」：火石雨每颗都带爆炸特效', cast === true && rained && rain.length >= 3 && rain.every(x => x.o.falloff === 0.3 && !x.o.noFx), `落地 ${rain.length} 颗`);
  await clearFoes();
  await god();
}

if (want('swap')) {
  await clearFoes();
  // 上面灵技段的精英被击杀会掉封印（6%）：先解除、收掉，只数这一段换下来的
  await b.eval('window.__pets.unbind(), window.__pets.seals.forEach(s => s.remove()), true');
  await step(0.1);
  await home();
  await b.eval(`window.__pets.give('huan', 2), true`);
  await step(0.5);
  const seals0 = await b.eval('window.__pets.seals.length');
  await b.eval(`window.__pets.give('zheng', 1), true`);
  await step(1.2);
  const seals1 = await b.eval(`window.__pets.seals.map(s => [s.def.id, s.level, s.bound])`);
  const had = seals1.find(s => s[0] === 'huan');
  check('换宠：旧灵宠变回封印，灵契等级留着', seals1.length === seals0 + 1 && had && had[1] === 2 && had[2] === true, JSON.stringify(seals1));
}

if (want('taunt')) {
  await clearFoes();
  await tidy();
  await home();
  await b.eval(`window.__pets.give('huan', 3), true`);
  await step(0.6);
  await foes(FOE, 4, 7);
  await step(0.9);
  await b.eval(`(() => { const p = window.__ctx.player; p.invulnerableTime = 0; p.hp = p.maxHp(); p.shield = p.maxShield(); window.__hpBefore = p.hp + p.shield; return true; })()`);
  const cast = await b.eval('window.__pets.forceSkill()');
  await step(0.2);
  const taunted = await b.eval(`window.__ctx.enemies.list.filter(e => e.alive && e.taunted).length`);
  await step(2.5);
  await lookAtPet(4.5);
  await b.shot(`${out}/m9-huan-taunt.jpg`);
  const lost = await b.eval(`(() => { const p = window.__ctx.player; return window.__hpBefore - (p.hp + p.shield); })()`);
  check('讙「百声惑」：附近敌人改打诱饵、打不到玩家', cast && taunted >= 3 && lost <= 0.01, `被嘲讽 ${taunted} 只，玩家掉血 ${lost.toFixed(1)}`);
  await god();
}

if (want('altar')) {
  await clearFoes();
  // 换宠 / 嘲讽两段留下的封印先收掉（灵兽台只数自己摆的八个）
  await b.eval('window.__pets.unbind(), true');
  await tidy();
  await step(0.1);
  await home();
  await b.eval('window.__pets.altar(), true');
  await step(2.5);
  const seals = await b.eval('window.__pets.seals.length');
  check('灵兽台：八只灵宠的封印摆出来', seals === 8, `封印 ${seals}`);
  // 转身看灵兽台（找封印平均位置）
  await b.eval(`(() => { const c = window.__ctx, p = c.player, s = window.__pets.seals;
    let x = 0, z = 0; for (const k of s) { x += k.root.position.x; z += k.root.position.z; }
    x /= s.length; z /= s.length;
    p.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z)); p.pitch = -0.1; return true; })()`);
  await step(0.3);
  await b.shot(`${out}/m9-altar.jpg`);
  // 按 F 结契最近的一只
  await b.eval(`(() => { const c = window.__ctx, s = window.__pets.seals[0]; c.player.teleport(s.root.position.clone().add(new s.root.position.constructor(0, 0, 1.6)), c.player.yaw); return true; })()`);
  await step(0.5);
  await b.eval(`(() => { const c = window.__ctx, s = window.__pets.seals[0]; const p = c.player;
    p.yaw = Math.atan2(-(s.root.position.x - p.position.x), -(s.root.position.z - p.position.z)); return true; })()`);
  await step(0.3);
  const current = await b.eval('window.__ctx.interact.current ? window.__ctx.interact.current.prompt().title : null');
  await b.eval(`window.__keys.tap.add('interact'), true`);
  await step(0.6);
  const p0 = await pet();
  check('封印按 F 结契', !!p0 && current?.startsWith('灵兽封印'), `${current} → ${p0?.id}`);
  await home();
}

if (want('stage')) {
  await clearFoes();
  await b.eval('window.__foeSpot = null, true');
  await b.eval(`window.__pets.give('yinglong', 3), window.__pets.pet.skillLeft = 7.5, true`);
  await step(0.3);
  const before = await pet();
  const next = await b.eval(`JSON.stringify(window.__ctx.runPlan.nextOptions(window.__ctx.run)[0] ?? null)`);
  await b.eval(`window.__game.advance(window.__ctx.runPlan.nextOptions(window.__ctx.run)[0]), true`);
  for (let k = 0; k < 600; k++) {
    await step(0.1);
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena && window.__ctx.stage.stage?.index === 1`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  await step(1.5);
  const after = await pet();
  const save = await b.eval('JSON.stringify(window.__ctx.run.pet)');
  check('换关保留：同一只、灵契等级 / 经验 / 冷却接着算', after?.id === before?.id && after.level === before.level && Math.abs(after.skillLeft - (before.skillLeft - 1.5)) < 0.6,
    `${JSON.stringify(before)} → ${JSON.stringify(after)}；run.pet = ${save}；下一关 ${next}`);
  // 换关的黑幕按真实时间淡出（UICurtain，不走游戏时间）：等它退掉再拍
  for (let k = 0; k < 60; k++) {
    const covered = await b.eval(`(() => { const c = document.querySelector('.sf-curtain'); if (!c) return false; const st = getComputedStyle(c); return st.display !== 'none' && +st.opacity > 0.01; })()`);
    if (!covered) break;
    await new Promise(r => setTimeout(r, 200));
    await step(1 / 60);
  }
  await step(0.5);
  await lookAtPet();
  await b.shot(`${out}/m9-stage-carry.jpg`);
}

const errs = errorsSince(start);
check('页面报错 0', errs.length === 0, errs.slice(0, 5).join(' | '));
const warns = warningsSince(start);
if (warns.length) log('警告（不算报错）：', warns.slice(0, 5).join(' | '));
await b.close();
const failed = results.filter(r => !r.ok);
log(`共 ${results.length} 项，失败 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
