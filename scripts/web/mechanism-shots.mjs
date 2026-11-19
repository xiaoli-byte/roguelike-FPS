// 地图机关实机核对（docs/threejs-migration.md M7 验收）：一个无头浏览器依次进有机关的关（?debug&dev&debugStage=<关>），
// 逐帧推进游戏（Game.frame，固定步长），把玩家放到机关上 / 触发机关，读 window.__mechanisms 的状态断言「在、会动、生效」，每关拍一张。
//   node scripts/web/mechanism-shots.mjs [端口=5737] [输出目录=docs/art/review/threejs-migration] [只跑的场景，逗号分隔]
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5737';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const log = (...a) => console.log('[m7]', ...a);
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
const god = () => b.eval(`(() => { const p = window.__ctx.player; p.invulnerableTime = 9999; p.hp = p.maxHp(); return true; })()`);
const mech = expr => b.eval(`(() => { const m = window.__mechanisms; return m ? (${expr}) : null; })()`);

async function enter(stage) {
  const errorsBefore = b.logs.length;
  await Promise.race([b.goto(`http://localhost:${port}/?debug&dev&debugStage=${stage}`), new Promise((_, rej) => setTimeout(() => rej(new Error('打开页面超时')), 120000))]);
  await b.waitFor('window.__game && window.__ctx', 300000);
  // 美术资产在后台加载（第四章的高原模型在里面，没加载完开局会失败）：等清单加载完再开局
  for (let k = 0; k < 1200 && !b.logs.slice(errorsBefore).some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
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
  for (let k = 0; k < 600; k++) {
    await step(0.1);
    if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena && !!window.__mechanisms`)) break;
    await new Promise(r => setTimeout(r, 250));
  }
  await step(1);
  const ok = await b.eval('!!window.__mechanisms');
  check(`${stage} 机关系统建起来`, ok, ok ? JSON.stringify(await mech('m.describe().scene')) : '');
  return errorsBefore;
}

/** 玩家放到 (x, z) 的地面上（y 给了就用 y），朝 yaw 看 */
const place = (x, z, y = null, yaw = 0, pitch = 0, top = 400) => b.eval(`(() => {
  const c = window.__ctx, V = c.player.position.constructor;
  const yy = ${y === null ? `c.world.groundHeight(${x}, ${z}, ${top}, 0.3)` : y};
  c.player.teleport(new V(${x}, yy + 0.05, ${z}), ${yaw});
  c.player.pitch = ${pitch};
  return [${x}, yy, ${z}];
})()`);

// 高原模型的内嵌贴图在无头浏览器里偶尔解不开（GLTFLoader blob 贴图，第四章老资产，和机关无关）：不算
const errorsSince = start => b.logs.slice(start).filter(l => /error|Error|TypeError|undefined is not/.test(l) && !/favicon|DevTools|\[assets\]|net::ERR|load texture blob:/.test(l));

async function scene(id, fn) {
  if (only && !only.has(id)) return;
  log('──', id);
  try {
    const start = await enter(id);
    await fn();
    const errs = errorsSince(start);
    check(`${id} 零报错`, errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    check(`${id} 跑完`, false, String(e?.stack ?? e));
  }
}

try {
  // ── 3-3 铸范大坊：熔岩判定 / 熔铜渠涨落 / 熔流闸 ──
  await scene('3-3', async () => {
    await god();
    const lava = await mech(`(() => { const v = [...m.volumes.values()].find(v => /主渠 2/.test(v.scenePath)); return v && [v.body.center.x, v.body.level, v.body.center.z, v.body.yaw]; })()`);
    check('3-3 主渠熔岩体', !!lava, JSON.stringify(lava));
    // 站到渠边岸上，再走进熔岩
    await place(lava[0] + 7, lava[2], null, Math.PI / 2, -0.25);
    await step(1.5);
    await b.eval(`(() => { window.__hurt = []; window.__ctx.events.on('player:damaged', e => window.__hurt.push(+e.amount.toFixed(2))); window.__ctx.player.invulnerableTime = 0; return true; })()`);
    await place(lava[0], lava[2], lava[1]);
    let sank = false;
    for (let k = 0; k < 30 && !sank; k++) {
      await step(0.05);
      sank = await mech('m.safe.sinking');
    }
    await step(0.8);
    const after = await mech('({ entries: m.lava.entries, recoveries: m.safe.recoveries, hurt: window.__hurt, maxHp: window.__ctx.player.maxHp(), pos: window.__ctx.player.position.toArray().map(v => +v.toFixed(2)) })');
    // 12% + 两跳 1.5%（最大生命 100：12、1.5、1.5）
    check('3-3 踩进熔岩：下沉、扣 12% + 两跳 1.5%、托回岸上', sank && after.entries >= 1 && after.hurt.length === 3
      && Math.abs(after.hurt[0] - after.maxHp * 0.12) < 0.01 && Math.abs(after.pos[0] - lava[0]) > 2, JSON.stringify(after));
    await god();
    // 熔铜渠涨落（魔将的「熔铜渠涨落」接这里）：涨起来拍一张
    const ch = await mech('m.channels ? (m.channels.flood(6), { count: m.channels.count }) : null');
    check('3-3 熔铜渠 8 段', ch?.count === 8, JSON.stringify(ch));
    const center = await b.eval(`(() => { const b = window.__ctx.stage.unityDocument.bosses[0]; return b && [b.center[0], b.floorY, b.center[2]]; })()`);
    await place(center[0] + 14, center[2] + 14, null, Math.atan2(14, 14), -0.18);
    await step(3.8);
    const flooding = await mech('({ flooding: m.channels.flooding, over: m.channels.overflowing, lvl: m.channels.surge.map(v => +(v.level - v.baseLevel).toFixed(2)) })');
    check('3-3 熔铜渠预警 2.4 s 后涨过渠岸', flooding.flooding && flooding.over, JSON.stringify(flooding));
    await b.shot(`${out}/m7-3-3-channels.jpg`);
    await step(9.5);
    const receded = await mech('m.channels.surge.every(v => v.level - v.baseLevel < 0.05)');
    check('3-3 高位停 6 s 后退回', receded);
    // 熔流闸：射断吊钩（直接打碎）→ 熔流沿槽冲下去
    const sl = await mech(`(() => { const s = m.sluices[0]; const hook = m.activatable(s.d.hook); hook?.break?.(); return { phase: s.phase, path: s.d.path }; })()`);
    const p0 = sl.path[0], p1 = sl.path[1];
    await place(p0[0] + (p1[0] - p0[0]) * 0.5 + 9, p0[2] + (p1[2] - p0[2]) * 0.5 + 9, null, Math.atan2(-9, -9) + Math.PI, -0.3);
    await step(1.6);
    const flow = await mech('({ phase: m.sluices[0].phase, built: m.sluices[0].volumesBuilt.filter(Boolean).length, active: m.sluices[0].volumesBuilt.filter(v => v && v.active).length })');
    check('3-3 熔流闸：吊钩断了就放，熔岩段运行时建起来', flow.phase === 'flowing' && flow.active > 0, JSON.stringify(flow));
    await b.shot(`${out}/m7-3-3-sluice.jpg`);
  });

  // ── 3-2 铸神井：间歇熔泉、断桥 ──
  await scene('3-2', async () => {
    await god();
    const g = await mech('(() => { const g = m.geysers[0]; return [g.base.x, g.base.y, g.base.z]; })()');
    await place(g[0] + 1.6, g[2], null, Math.PI / 2, -0.2, g[1] + 2.5);
    await step(0.3);
    await mech('m.geysers[0].eruptNow(0.6)');
    await step(0.75);
    const st = await mech('({ state: m.geysers[0].state, hits: m.geysers[0].playerHits, vy: +window.__ctx.player.velocity.y.toFixed(2), p: window.__ctx.player.position.toArray().map(v => +v.toFixed(2)), base: m.geysers[0].base.toArray() })');
    check('3-2 熔泉喷发：玩家挨一下、被掀起', st.state === 'erupting' && st.hits === 1, JSON.stringify(st));
    await place(g[0] + 9, g[2] + 9, null, Math.atan2(-9, -9) + Math.PI, 0.25, g[1] + 3);
    await mech('(m.geysers[1].eruptNow(0.6), m.geysers[2].eruptNow(0.6))');
    await step(0.8);
    await b.shot(`${out}/m7-3-2-geyser.jpg`);
    const span = await mech('(() => { const s = m.spans.find(s => /North/.test(s.d.scenePath)); s.breakAll(-1); return s.count; })()');
    await step(3);
    const fallen = await mech('m.spans.find(s => /North/.test(s.d.scenePath)).fallenCount');
    check('3-2 北链桥整座断', fallen === span, `${fallen}/${span}`);
  });

  // ── 1-2 雅丹：流沙 ──
  await scene('1-2', async () => {
    await god();
    const q = await mech('(() => { const q = m.quicksand.all[0]; return q.position; })()');
    await place(q[0] + 3.4, q[2], q[1], Math.PI / 2, -0.35);
    await step(0.5);
    const edge = await mech('({ inside: m.quicksand.playerInside, pos: window.__ctx.player.position.toArray() })');
    await step(1.5);
    const pulled = await b.eval('window.__ctx.player.position.toArray()');
    check('1-2 流沙把人往圆心拖', edge.inside && Math.hypot(pulled[0] - q[0], pulled[2] - q[2]) < 3.3, `${JSON.stringify(edge)} → ${pulled.map(v => v.toFixed(2))}`);
    await b.shot(`${out}/m7-1-2-quicksand.jpg`);
    await place(q[0], q[2], q[1]);
    await step(3);
    const sw = await mech('m.quicksand.swallowed');
    check('1-2 芯里待 2.2 s 被吞、托回', sw >= 1, `swallowed ${sw}`);
  });

  // ── 2-1 冰瀑栈道：冰面、冰棱 ──
  await scene('2-1', async () => {
    await god();
    const z = await mech('(() => { const z = m.surfaces.zones[0]; return [z.shape.center ?? null, z.shape.top]; })()');
    const ice = await mech('m.data.surfaces[0].position');
    await place(ice[0], ice[2], z[1], 0, -0.1);
    await step(0.3);
    const on = await mech('({ on: m.surfaces.playerOnSurface, id: m.surfaces.playerSurface.id })');
    check('2-1 站上冰面：牵引换成冰面', on.on && on.id === 'ice', JSON.stringify(on));
    const ic = await mech('(() => { const i = m.icicles[0]; i.dropNow(); return [...i.d.hanging.position, i.d.groundY]; })()');
    // 落点所在的桥面上、离冰棱 7 m，抬头看冰拱
    await place(ic[0] + 7, ic[2], null, Math.PI / 2, 0.45, ic[3] + 2);
    await step(0.45);
    await b.shot(`${out}/m7-2-1-icicle.jpg`);
    await step(2);
    check('2-1 射落的冰棱砸地', await mech('m.icicles[0].landed'));
  });

  // ── 1-1 戈壁古道：区域沙暴、软边界 ──
  await scene('1-1', async () => {
    await god();
    const r = await mech('(() => { const r = m.weather.regions[0]; r.force("storm", 3); return r.d.center; })()');
    await place(r[0], r[2], null, 0, 0.05);
    await step(0.5);
    const w = await mech('({ storm: m.weather.stormAt(window.__ctx.player.position), fog: [window.__ctx.scene.fog.near, window.__ctx.scene.fog.far], lock: m.weather.lockOnRange(window.__ctx.player.position) })');
    check('1-1 驼队营地沙暴：雾收到 32 m 内、远程锁定 25 m', w.storm > 0.9 && w.fog[1] < 60 && w.lock === 25, JSON.stringify(w));
    await b.shot(`${out}/m7-1-1-sandstorm.jpg`);
    await mech('m.weather.regions[0].force("calm", 0)');
    // 软边界：放到界外 8 m，几秒内被推回
    const out8 = await mech(`(() => {
      const bz = m.boundary, p = window.__ctx.player.position.clone();
      for (let r = 10; r < 400; r += 2) for (let a = 0; a < 6.28; a += 0.2) {
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, d = bz.distance({ x, y: 0, z });
        if (d > 7.5 && d < 8.5) return [x, z, d];
      }
      return null;
    })()`);
    await place(out8[0], out8[1]);
    await step(0.2);
    const w0 = await mech('({ d: m.boundary.playerDistance, wind: m.boundary.playerWind })');
    await step(3);
    const d1 = await mech('m.boundary.playerDistance');
    check('1-1 软边界：起风线外被风推回', w0.wind > 0.4 && d1 < w0.d - 2, `${JSON.stringify(w0)} → ${d1.toFixed(2)}`);
    await b.shot(`${out}/m7-1-1-boundary.jpg`);
  });

  // ── 4-1 折多垭口：导体 + 雷暴 ──
  await scene('4-1', async () => {
    await god();
    const c = await mech('m.conductors.length');
    check('4-1 导体 41 根', c === 41, String(c));
    // 经幡杆（Conductor_Pole_1，高 3.4 m）：旁边 1.2 m 的落雷被它（或附近更高的导体）引走
    const pole = await mech('m.conductors.find(c => /Pole_1$/.test(c.d.scenePath)).d.position');
    await place(pole[0] + 12, pole[2] + 12, null, Math.atan2(-12, -12) + Math.PI, 0.15);
    await mech('m.stormBegin({ fadeIn: 1, intervalMin: 0.6, intervalMax: 1, strikeMin: 6, strikeMax: 20 })');
    await step(4);
    // 导体引雷：在杆子旁边落一道
    await mech(`m.strikes.strike(new (window.__ctx.player.position.constructor)(${pole[0]} + 1.2, ${pole[1]}, ${pole[2]}), { warn: 0.3, onLanded: i => { window.__bolt = { conductor: i.conductor && i.conductor.d.scenePath, point: i.point.toArray().map(v => +v.toFixed(1)) }; } })`);
    await step(0.4);
    const s = await mech('({ level: m.storm.level, strikes: m.strikes.count, bolt: window.__bolt, struck: m.conductors.filter(c => c.strikes > 0).length, charged: m.conductors.filter(c => c.charged).length })');
    check('4-1 雷暴：渐入、落雷、导体引雷充电', s.level > 0.9 && s.strikes >= 2 && !!s.bolt?.conductor && s.struck >= 1 && (s.charged >= 1 || /Diaolou/.test(s.bolt.conductor)), JSON.stringify(s));
    await b.shot(`${out}/m7-4-1-storm.jpg`);
  });
} finally {
  await b.close();
}
const failed = results.filter(r => !r.ok);
log(`${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
