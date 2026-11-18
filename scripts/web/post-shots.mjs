// 后处理栈（M11a）的无头对照截图 + 粗测帧时间：?debug&perf=1&debugStage=<图> 开一局，在出生点逐帧推进，
// 同一个画面先关后处理（原样：ACES 直接画到画布）拍一张、再开后处理拍一张；两种状态各跑 N 帧、每帧 readPixels 一个像素逼 GPU 做完，
// 记平均 / 中位的整帧耗时（无头 Chromium + 软件合成，只能看相对差，绝对值不可信）。
//   node scripts/web/post-shots.mjs [端口=5681] [输出目录=docs/art/review/threejs-migration] [图=1-1,1-2,2-1,3-3,4-1]
// 输出：<目录>/post-<图>-before.jpg、post-<图>-after.jpg，帧时间打印成 JSON（最后一行）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5681';
const out = process.argv[3] ?? 'docs/art/review/threejs-migration';
const maps = (process.argv[4] ?? '1-1,1-2,2-1,3-3,4-1').split(',');
const FRAMES = Number(process.env.POST_FRAMES ?? 90);
const log = (...a) => console.log('[post-shots]', ...a);
const results = {};

for (const map of maps) {
  let b = null;
  try {
    b = await launch({ width: 1280, height: 720 });
    await b.goto(`http://localhost:${port}/?debug&perf=1&debugStage=${map}`);
    await b.waitFor('window.__game && window.__ctx && window.__post', 180000);
    for (let k = 0; k < 1200 && !b.logs.some(l => l.includes('[assets] 已加载')); k++) await new Promise(r => setTimeout(r, 250));
    await b.eval(`(() => {
      const g = window.__game;
      window.__step = (seconds, dt = 1 / 60) => {
        let t = window.__simT ?? performance.now();
        const n = Math.max(1, Math.round(seconds / dt));
        for (let i = 0; i < n; i++) { t += dt * 1000; g.lastFrame = t - dt * 1000; g.frame(t); }
        window.__simT = t;
      };
      // 帧时间：推一帧（固定 dt），再读一个像素逼 GPU 做完；返回每帧毫秒
      window.__timeFrames = (n) => {
        const gl = window.__ctx.renderer.getContext(), px = new Uint8Array(4), ms = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          window.__step(1 / 60);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          ms.push(performance.now() - t0);
        }
        ms.sort((a, c) => a - c);
        return { median: ms[Math.floor(ms.length / 2)], mean: ms.reduce((s, v) => s + v, 0) / ms.length, p90: ms[Math.floor(ms.length * 0.9)] };
      };
      return true;
    })()`);
    await b.eval('window.__game.startRun(window.__ctx.heroes[0].id), true');
    for (let k = 0; k < 400; k++) {
      await b.eval('window.__step(0.1)');
      if (await b.eval(`window.__game.state === 'playing' && !!window.__ctx.stage.arena`)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    // 站定、无敌，等淡入和首帧编译过去
    await b.eval(`(() => { const p = window.__ctx.player; p.invulnerableTime = 1e9; return true; })()`);
    await b.eval('window.__step(3)');
    await b.eval("(() => { const ui = document.getElementById('ui-root'); if (ui) ui.style.visibility = 'hidden'; return true; })()");
    const info = await b.eval(`(() => { const s = window.__post.stack; return { active: s.active, scene: window.__post.scene.sceneId, overlays: window.__post.scene.overlays.length, stats: s.stats, lut: window.__post.lutCheck(), state: window.__game.state }; })()`);
    log(map, JSON.stringify(info));

    const shoot = async (disabled, name) => {
      await b.eval(`(() => { window.__post.stack.disabled = ${disabled}; window.__step(0.5); return true; })()`);
      const timing = await b.eval(`window.__timeFrames(${FRAMES})`);
      await b.eval('window.__step(1 / 60)');
      await b.shot(`${out}/post-${map}-${name}.jpg`, 88);
      return timing;
    };
    const before = await shoot(true, 'before');
    const after = await shoot(false, 'after');
    results[map] = { before, after, shafts: info.stats?.shafts, mips: info.stats?.bloomMips, lut: info.lut };
    log(map, 'before', JSON.stringify(before), 'after', JSON.stringify(after));

    if (map === maps[0]) {
      // 朝太阳看：光柱（显示空间叠加）在后处理之后照样出、不落在枪上
      const sun = await b.eval(`(async () => {
        const { Atmosphere } = await import('/src/world/Atmosphere.ts');
        const d = Atmosphere.uniforms.sfAtmoSunDir.value, p = window.__ctx.player;
        p.yaw = Math.atan2(-d[0], -d[2]) + 0.25;
        p.pitch = Math.min(0.5, Math.max(0, Math.asin(Math.min(1, d[1])) * 0.6));
        return [d[0], d[1], d[2]];
      })()`);
      log(map, 'sun dir', JSON.stringify(sun));
      await b.eval(`(() => { window.__post.stack.disabled = true; window.__step(0.5); return true; })()`);
      await b.shot(`${out}/post-${map}-sun-before.jpg`, 88);
      await b.eval(`(() => { window.__post.stack.disabled = false; window.__step(0.5); return true; })()`);
      await b.shot(`${out}/post-${map}-sun-after.jpg`, 88);
      results[map].sunShafts = await b.eval('window.__post.stack.stats.shafts');
      // 低血量（饱和度 −38、对比 +6）+ 受击色差脉冲
      await b.eval(`(() => {
        const p = window.__ctx.player; p.hp = p.maxHp() * 0.06;
        window.__step(0.6);
        window.__post.effects.pulseHurt(1);
        const t0 = performance.now(); while (performance.now() - t0 < 30) {}
        window.__step(1 / 60);
        return true;
      })()`);
      await b.shot(`${out}/post-${map}-lowhp-hurt.jpg`, 88);
      results[map].gameplay = await b.eval(`(() => { const g = window.__post.stack.gameplay; return { low: g.lowHealth.weight, hurt: g.hurt.weight, sat: window.__post.stack.params.ColorAdjustments.saturation, ca: window.__post.stack.params.ChromaticAberration.intensity }; })()`);
      log(map, 'extras', JSON.stringify({ sunShafts: results[map].sunShafts, gameplay: results[map].gameplay }));
    }
    const errors = b.logs.filter(l => /\[exception\]|\[error\]/.test(l) && !l.includes('加载失败')).slice(-8);
    if (errors.length) log(map, 'errors:\n' + errors.join('\n'));
  } catch (err) {
    log(map, 'FAILED', err.message);
    if (b) log(b.logs.slice(-20).join('\n'));
  } finally {
    await b?.close();
  }
}
console.log(JSON.stringify(results));
