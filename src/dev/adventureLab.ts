/** Dev-only walkthrough using the real Game, StageDirector, interaction and HUD. */
import '../ui/styles.css';
import * as THREE from 'three';
import { Game } from '../core/Game';
import type { StageNode, StageType, ThemeId } from '../core/types';
import { AssetLibrary } from '../assets/AssetLibrary';
import { getStageDesign } from '../world/StageDesign';

await AssetLibrary.preload();
const game = new Game(), ctx = game.ctx;
const theme = document.getElementById('tour-theme') as HTMLSelectElement;
const stageIndex = document.getElementById('tour-stage') as HTMLSelectElement;
const stageType = document.getElementById('tour-type') as HTMLSelectElement;
const sitesPanel = document.getElementById('tour-sites')!;
const encountersPanel = document.getElementById('tour-encounters')!;
const altarButton = document.getElementById('tour-altar') as HTMLButtonElement;
const hint = document.getElementById('tour-hint')!;
const status = document.getElementById('tour-status') as HTMLOutputElement;
const panel = document.getElementById('tour-controls')!;
const meter = game.performanceMeter;
const performanceReadout = document.getElementById('performance-readout') as HTMLOutputElement;
let performanceState = '';
let performanceFrames = -1;
let performanceReport: unknown = null;
if (meter) {
  document.getElementById('performance-controls')!.hidden = false;
  document.getElementById('performance-sample')!.onclick = () => meter.sample();
}
const initial = new URLSearchParams(location.search), themes: ThemeId[] = ['desert', 'frost', 'inferno'];
const inspectionSeed = Number(initial.get('seed') ?? 20261004) >>> 0;
if (themes.includes(initial.get('theme') as ThemeId)) theme.value = initial.get('theme')!;
if (Array.from(stageType.options).some(o => o.value === initial.get('type'))) stageType.value = initial.get('type')!;
function refreshStageChoices(index = stageIndex.value || initial.get('stage') || '0'): void {
  const id = theme.value as ThemeId, chapter = themes.indexOf(id);
  stageIndex.replaceChildren(...Array.from({ length: 5 }, (_, i) => new Option(
    `${i + 1} · ${getStageDesign({ chapter, index: i, type: i === 4 ? 'boss' : 'combat', theme: id }).title}`, String(i))));
  stageIndex.value = Array.from(stageIndex.options).some(o => o.value === index) ? index : '0';
}
function selectedStage(): StageNode {
  const id = theme.value as ThemeId, index = Math.max(0, Math.min(4, Number(stageIndex.value) || 0));
  const type = stageType.value === 'auto' ? index === 4 ? 'boss' : 'combat' : stageType.value as StageType;
  return { chapter: themes.indexOf(id), index, type, reward: type === 'shop' ? 'none' : type === 'boss' ? 'weapon' : 'scroll', theme: id };
}
refreshStageChoices();
// This inspection page stays unlocked; the production game still requests lock.
ctx.input.requestLock = () => {};
ctx.input.freeLook = false;
ctx.input.onLockChange = () => {};
ctx.events.on('run:started', ({ run }) => {
  run.seed = inspectionSeed;
  ctx.rng.reseed(run.seed);
  ctx.player.invulnerableTime = 1e9;
});
let loaded = false;
let requested: StageNode | null = selectedStage();
if (requested.theme === 'desert' && requested.index === 0 && requested.type === 'combat') requested = null;
let entry = new THREE.Vector3();
let entryYaw = 0;
let siteButtons: HTMLButtonElement[] = [], encounterButtons: HTMLButtonElement[] = [];
ctx.events.on('stage:loaded', ({ stage }) => {
  loaded = true;
  const arena = ctx.stage.arena;
  if (arena) { entry.copy(arena.playerSpawn); entryYaw = arena.playerYaw; }
  rebuildJumpButtons();
  const target = requested;
  if (target) {
    // First-entry events occur just before Game changes to playing.
    requestAnimationFrame(() => loadStage(target));
    return;
  }
  theme.value = stage.theme; refreshStageChoices(String(stage.index));
  if (stage.type !== (stage.index === 4 ? 'boss' : 'combat') || stageType.value !== 'auto') stageType.value = stage.type;
  const design = getStageDesign(stage);
  const guidance = stage.type === 'shop' ? '休整院落：寻找商人，购买补给与强化武器。'
    : stage.type === 'treasure' ? '宝藏院落：没有敌人，寻找宝箱与出口。' : `${design.routeHint} ${design.combatHint}`;
  hint.textContent = `${guidance} WASD 移动，F 交互；检视中开启无敌。`;
  updateLink(stage);
});
function updateLink(stage: StageNode): void {
  const params = new URLSearchParams(location.search);
  params.set('theme', stage.theme); params.set('stage', String(stage.index)); params.set('type', stageType.value);
  params.set('seed', String(inspectionSeed)); params.set('debug', '1');
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
function loadStage(node = selectedStage()): void {
  if (!loaded || game.state !== 'playing') { requested = node; return; }
  requested = null;
  game.advance(node);
}
function go(p: THREE.Vector3, yaw: number): void {
  if (game.state !== 'playing') return;
  ctx.player.teleport(p.clone(), yaw);
  ctx.input.flushMouse();
  ctx.dom.canvas.focus();
}
document.getElementById('tour-entry')!.onclick = () => go(entry, entryYaw);
function goNear(p: THREE.Vector3, triggerRadius: number): void {
  if (game.state !== 'playing') return;
  // Stay inside the real trigger, with body clearance. A failed nearby search
  // must not project the player into a different route or encounter.
  for (const radius of [Math.min(2.8, triggerRadius * .55), Math.min(1.4, triggerRadius * .3), .5, 0]) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const to = p.clone().add(new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius));
      if (![[0, 0], [.5, 0], [-.5, 0], [0, .5], [0, -.5]]
        .every(([x, z]) => ctx.nav.isWalkable(to.x + x, to.z + z))) continue;
      go(to, Math.atan2(-(p.x - to.x), -(p.z - to.z))); return;
    }
  }
  ctx.ui.toast('该点附近没有足够的安全落脚空间，请沿道路靠近');
}
altarButton.onclick = () => { const p = ctx.stage.exploration?.objective; if (p) goNear(p, 4.2); };
function rebuildJumpButtons(): void {
  const a = ctx.stage.exploration;
  siteButtons = (a?.sites ?? []).map((site, i) => {
    const button = document.createElement('button'); button.id = `tour-cache-${i}`;
    button.onclick = () => goNear(site.position, 5.5); return button;
  });
  encounterButtons = (a?.encounters ?? []).map((encounter, i) => {
    const button = document.createElement('button'); button.id = `tour-encounter-${i}`;
    button.onclick = () => goNear(encounter.position, encounter.triggerRadius ?? 3.5); return button;
  });
  sitesPanel.replaceChildren(...siteButtons); encountersPanel.replaceChildren(...encounterButtons);
  altarButton.hidden = !a;
}
document.getElementById('tour-clear')!.onclick = () => ctx.enemies.killAll();
document.getElementById('tour-reset')!.onclick = () => loadStage();
theme.onchange = () => { refreshStageChoices(); loadStage(); };
stageIndex.onchange = stageType.onchange = () => loadStage();
document.getElementById('tour-toggle')!.onclick = () => {
  const collapsed = panel.classList.toggle('collapsed');
  document.getElementById('tour-toggle')!.textContent = collapsed ? '展开' : '收起';
};
let lastStatus = 0;
function showStatus(now: number): void {
  requestAnimationFrame(showStatus);
  if (now - lastStatus < 200) return;
  lastStatus = now;
  const a = ctx.stage.exploration;
  const visited = a?.sites.filter(s => s.visited).length ?? 0;
  const encounters = a?.encounters ?? [], active = encounters.find(e => e.phase === 'active');
  const defeated = encounters.filter(e => e.phase === 'cleared').length;
  const node = ctx.stage.stage ?? ctx.run.stage, design = getStageDesign(node);
  const labels = { explore: '探索中', battle: '祭坛战斗', cleared: '区域已肃清' };
  const phase = a ? active ? `${active.label} · 遭遇战` : labels[a.phase]
    : !loaded || game.state === 'transition' ? '载入中' : ctx.stage.cleared ? '区域已通过' : node.type === 'boss' ? '首领战斗' : '休整区域';
  const ready = game.state === 'playing';
  for (const [i, button] of siteButtons.entries()) {
    const site = a?.sites[i]; button.disabled = !ready || !site;
    if (site) button.textContent = `${site.label}${site.visited ? ' · 已探访' : ''}`;
  }
  for (const [i, button] of encounterButtons.entries()) {
    const encounter = encounters[i]; button.disabled = !ready || !encounter || !!active && active !== encounter && encounter.phase !== 'cleared';
    if (encounter) button.textContent = `${encounter.label} · ${{ undiscovered: '待触发', active: '交战中', cleared: '已结束' }[encounter.phase]}`;
  }
  altarButton.disabled = !ready || !!active;
  if (a) altarButton.textContent = active ? '祭坛 · 先清遭遇' : a.phase === 'battle' ? '祭坛 · 战斗中' : a.phase === 'cleared' ? '祭坛 · 已完成' : '祭坛';
  const text = [
    `${node.chapter + 1}-${node.index + 1} · ${design.title} · ${Array.from(stageType.options).find(o => o.value === node.type)?.text ?? node.type}`,
    `状态：${phase}${a ? ` · 补给 ${visited}/${a.sites.length} · 遭遇 ${defeated}/${encounters.length}` : ''}`,
    `波次：${ctx.stage.waveCount ? `${ctx.stage.waveIndex + 1}/${ctx.stage.waveCount}` : '未开始'} · 敌人 ${ctx.enemies.aliveCount()}`,
    `已通过 ${ctx.run.stagesCleared} 区域 · 交互：${ctx.interact.current?.prompt().title ?? '无'}`,
  ].join('\n');
  if (status.textContent !== text) status.textContent = text;
  status.dataset.phase = active ? 'encounter' : a?.phase ?? (loaded ? node.type : 'loading');
  status.dataset.stage = String(node.index); status.dataset.stageId = design.id;
  status.dataset.encounters = String(defeated); status.dataset.activeEncounter = active?.id ?? '';
  status.dataset.visited = String(visited);
  status.dataset.cleared = String(ctx.run.stagesCleared);
  status.dataset.alive = String(ctx.enemies.aliveCount());
  status.dataset.viewmodel = String(ctx.viewScene.getObjectByName('viewmodel')?.visible ?? false);
  status.dataset.renderCalls = String(ctx.renderer.info.render.calls);
  if (meter && (meter.state !== performanceState || meter.progress !== performanceFrames || meter.report !== performanceReport)) {
    performanceState = meter.state; performanceFrames = meter.progress; performanceReport = meter.report;
    performanceReadout.dataset.state = meter.state;
    performanceReadout.dataset.frames = String(meter.progress);
    const r = meter.report;
    if (r) {
      const ms = (s: { median: number; p95: number }): string => `${s.median.toFixed(2)} / ${s.p95.toFixed(2)} ms`;
      performanceReadout.dataset.report = JSON.stringify(r);
      performanceReadout.textContent = [
        `已锁存 ${r.frames} 帧 · RAF ${r.fps.toFixed(1)} FPS`,
        `帧间隔中位 / P95：${ms(r.rafMs)}`,
        `更新中位 / P95：${ms(r.updateMs)}`,
        `渲染提交中位 / P95：${ms(r.renderSubmitMs)}`,
        `GPU 中位 / P95：${r.gpu.ms ? ms(r.gpu.ms) : r.gpu.status === 'disjoint' ? 'disjoint（结果失效）' : 'unavailable（设备未提供计时）'} · ${r.gpu.samples} 次`,
        `双场景平均 ${r.render.calls.toFixed(0)} calls · ${r.render.triangles.toFixed(0)} triangles`,
        `${r.resolution.width}×${r.resolution.height} · DPR ${r.resolution.pixelRatio} · ${r.metadata.quality} · ${r.metadata.theme}`,
      ].join('\n');
    } else {
      delete performanceReadout.dataset.report;
      performanceReadout.textContent = meter.state === 'idle' ? '等待采样：30 帧预热 + 240 帧记录'
        : meter.state === 'warmup' ? '正在预热 30 帧…' : meter.state === 'pending-gpu' ? '240 帧完成，等待非阻塞 GPU 结果…' : `正在采样 ${meter.progress} / 240 帧…`;
    }
  }
}
game.start();
game.startRun(ctx.heroes[0].id);
requestAnimationFrame(showStatus);
