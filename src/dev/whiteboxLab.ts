/** Isolated LD whitebox sandbox, sharing the real game movement and combat. */
import '../ui/styles.css';
import './whiteboxLab.css';
import * as THREE from 'three';
import { Game } from '../core/Game';
import type { StageNode, StageType, ThemeId } from '../core/types';
import { AssetLibrary } from '../assets/AssetLibrary';
import { StageDirector } from '../world/StageDirector';
import { getWhiteboxPlan, whiteboxPoint } from '../world/WhiteboxGen';
import type { WhiteboxCheckpoint } from '../world/WhiteboxTypes';
import { probeWhitebox, WhiteboxWalker } from './WhiteboxTraversal';

const initial = new URLSearchParams(location.search);
initial.set('layout', 'whitebox'); initial.set('perf', '1'); initial.set('debug', '1');
initial.set('look', initial.get('look') === 'whitebox' ? 'whitebox' : 'art');
history.replaceState(null, '', `${location.pathname}?${initial}`);
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const themes: ThemeId[] = ['desert', 'frost', 'inferno'];
const theme = $<HTMLSelectElement>('wb-theme'), stageChoice = $<HTMLSelectElement>('wb-stage');
const typeChoice = $<HTMLSelectElement>('wb-type'), checkpoints = $<HTMLSelectElement>('wb-checkpoint');
const routeChoice = $<HTMLSelectElement>('wb-route');
const lookChoice = $<HTMLSelectElement>('wb-look');
lookChoice.value = initial.get('look')!;
const status = $<HTMLOutputElement>('wb-status'), walkStatus = $<HTMLOutputElement>('wb-walk-status');
const auditStatus = $<HTMLOutputElement>('wb-audit-status'), performanceOutput = $<HTMLOutputElement>('wb-performance');
const invulnerable = $<HTMLInputElement>('wb-invulnerable');
const seed = Number(initial.get('seed') ?? 20261004) >>> 0;
if (themes.includes(initial.get('theme') as ThemeId)) theme.value = initial.get('theme')!;
if (Array.from(typeChoice.options).some(o => o.value === initial.get('type'))) typeChoice.value = initial.get('type')!;

function selectedStage(): StageNode {
  const id = theme.value as ThemeId, index = Math.max(0, Math.min(4, Number(stageChoice.value) || 0));
  const type: StageType = index === 4 ? 'boss' : typeChoice.value === 'auto' ? 'combat' : typeChoice.value as StageType;
  return { theme: id, chapter: themes.indexOf(id), index, type, reward: type === 'shop' ? 'none' : type === 'boss' ? 'weapon' : 'scroll' };
}
function refreshChoices(index = stageChoice.value || initial.get('stage') || '0'): void {
  const id = theme.value as ThemeId;
  stageChoice.replaceChildren(...Array.from({ length: 5 }, (_, i) => {
    const plan = getWhiteboxPlan({ theme: id, chapter: themes.indexOf(id), index: i, type: i === 4 ? 'boss' : 'combat', reward: 'none' });
    return new Option(`${i + 1} · ${plan.title}`, String(i));
  }));
  stageChoice.value = Array.from(stageChoice.options).some(o => o.value === index) ? index : '0';
  typeChoice.disabled = stageChoice.value === '4';
}
refreshChoices();
await AssetLibrary.preload();
const game = new Game(), ctx = game.ctx, director = ctx.stage as StageDirector;
const walker = new WhiteboxWalker(ctx);
const overview = new THREE.OrthographicCamera(-80, 80, 60, -60, .1, 600);
overview.up.set(0, 0, -1);
let mode: 'overview' | 'inspect' | 'play' = 'overview';
let sceneFog: THREE.Scene['fog'] = null;
let requested: StageNode | null = selectedStage(), loaded = false;
if (requested.theme === 'desert' && requested.index === 0 && requested.type === 'combat') requested = null;
let lastAuditPlan = '', performancePlan = '', lastPerformanceReport: unknown = null;
let lastWalkState = walker.report.state;
type InspectionPoint = WhiteboxCheckpoint & { pitch?: number };
let inspectionPoints: InspectionPoint[] = [];

const requestLock = ctx.input.requestLock.bind(ctx.input);
ctx.input.requestLock = () => { if (mode === 'play') requestLock(); };
ctx.input.freeLook = false;
ctx.input.onLockChange = locked => {
  if (!locked && mode === 'play') setMode('inspect');
};
game.setInspectionView(() => mode === 'overview' ? overview : null);

function frameOverview(): void {
  const bounds = director.whitebox?.plan.bounds;
  if (!bounds) return;
  const panelWidth = $('wb-panel').getBoundingClientRect().width;
  const w = window.innerWidth, h = window.innerHeight;
  const usableW = Math.max(200, w - panelWidth - 60), usableH = Math.max(200, h - 172);
  const metresPerPixel = Math.max(bounds[0] / usableW, bounds[1] / usableH) * 1.05;
  const halfW = w * metresPerPixel / 2, halfH = h * metresPerPixel / 2;
  const shiftX = panelWidth * metresPerPixel / 2;
  overview.left = -halfW - shiftX; overview.right = halfW - shiftX;
  overview.top = halfH + 14 * metresPerPixel; overview.bottom = -halfH + 14 * metresPerPixel;
  overview.position.set(0, 180, 0); overview.lookAt(0, 0, 0); overview.updateProjectionMatrix();
  $('wb-scale').textContent = `${bounds[0]} × ${bounds[1]} m`;
}

function setMode(next: typeof mode, lock = false): void {
  walker.stop();
  mode = next;
  document.body.classList.remove('wb-clean');
  ctx.input.releaseAll(); ctx.input.flushMouse();
  if (next !== 'play') ctx.input.exitLock();
  if (game.state === 'paused') game.resume();
  ctx.time.timeScale = next === 'overview' ? 0 : 1;
  ctx.input.enabled = next !== 'overview';
  ctx.ui.showHUD(next !== 'overview');
  // The survey camera is 180m up; gameplay distance fog would hide the entire plan.
  ctx.scene.fog = next === 'overview' ? null : sceneFog;
  document.body.classList.toggle('wb-overview', next === 'overview');
  document.body.classList.toggle('wb-first-person', next === 'inspect');
  document.body.classList.toggle('wb-playing', next === 'play');
  $('wb-overview').setAttribute('aria-pressed', String(next === 'overview'));
  $('wb-first-person').setAttribute('aria-pressed', String(next === 'inspect'));
  $('wb-view-label').textContent = next === 'overview' ? '俯视 · 时间暂停' : next === 'inspect' ? '第一人称 · 未锁鼠标' : '第一人称 · 试玩';
  frameOverview();
  if (lock) { ctx.dom.canvas.focus(); requestLock(); }
}

function checkpoint(): InspectionPoint | undefined { return inspectionPoints.find(p => p.id === checkpoints.value); }
function locate(point: InspectionPoint | undefined): void {
  if (!point || game.state !== 'playing') return;
  walker.stop();
  ctx.player.teleport(new THREE.Vector3(point.x, (ctx.stage.arena?.floorY ?? 0) + .001, point.z), point.yaw);
  ctx.player.pitch = point.pitch ?? 0;
  ctx.input.releaseAll(); ctx.input.flushMouse();
  if (mode === 'overview') ctx.time.timeScale = 0;
  walkStatus.textContent = `快速定位：${point.label}（传送，不计为步行通过）`;
  walkStatus.dataset.state = 'idle';
}

ctx.events.on('run:started', ({ run }) => {
  run.seed = seed; ctx.rng.reseed(seed); ctx.player.invulnerableTime = invulnerable.checked ? 1e9 : 0;
});
ctx.events.on('stage:loaded', ({ stage }) => {
  loaded = true; walker.reset();
  sceneFog = ctx.scene.fog;
  walkStatus.textContent = '选择主路、支路或检查点，以真实角色步行验证。';
  const target = requested;
  if (target) { requestAnimationFrame(() => loadStage(target)); return; }
  theme.value = stage.theme; refreshChoices(String(stage.index));
  if (stage.type !== (stage.index === 4 ? 'boss' : 'combat') || typeChoice.value !== 'auto') typeChoice.value = stage.type === 'boss' || stage.type === 'combat' ? 'auto' : stage.type;
  const metadata = director.whitebox, plan = metadata?.plan ?? getWhiteboxPlan(stage);
  $('wb-title').textContent = `${stage.chapter + 1}-${stage.index + 1} · ${plan.title}`;
  const art = lookChoice.value === 'art';
  $('wb-art-brief').textContent = art ? director.artBrief ?? plan.artBrief : '技术占位 · 对照通道与碰撞';
  $('wb-revision').textContent = art ? '场景美术 · 基于已验证平面图' : '技术白盒 · 对照检查';
  document.title = `${plan.title} · ${art ? '场景美术' : '技术白盒'}`;
  $('wb-subtitle').textContent = plan.subtitle;
  $('wb-intent').textContent = plan.routeChoice;
  $<HTMLAnchorElement>('wb-atlas').href = `/level-design/index.html#${plan.id}`;
  $('wb-checks').replaceChildren(...plan.whiteboxChecks.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  const spatial = metadata?.checkpoints ?? [], artViews = director.artInspectionViews;
  inspectionPoints = [...spatial, ...artViews];
  const spatialGroup = document.createElement('optgroup'); spatialGroup.label = '通道与战斗检查点';
  spatialGroup.append(...spatial.map(p => new Option(p.label, p.id)));
  const artGroup = document.createElement('optgroup'); artGroup.label = '美术观察点 · 角色眼高';
  artGroup.append(...artViews.map(p => new Option(p.label, p.id)));
  checkpoints.replaceChildren(spatialGroup, ...(artViews.length ? [artGroup] : []));
  checkpoints.value = 'exit';
  routeChoice.replaceChildren(new Option('当前位置 → 所选检查点', 'target'), new Option('完整主路（按图纸折点）', 'main'),
    ...plan.passages.filter(p => p.kind !== 'main').map(p => new Option(`${p.kind === 'optional' ? '支路' : '回接'} · ${plan.rooms.find(r => r.id === p.from)?.label ?? p.from} → ${plan.rooms.find(r => r.id === p.to)?.label ?? p.to}`, p.id)));
  auditStatus.dataset.state = 'idle'; delete auditStatus.dataset.report;
  auditStatus.textContent = '独立碰撞探针尚未运行。仅几何通过不代表战斗难度通过。';
  lastAuditPlan = '';
  const params = new URLSearchParams(location.search);
  params.set('theme', stage.theme); params.set('stage', String(stage.index)); params.set('type', typeChoice.value); params.set('seed', String(seed));
  history.replaceState(null, '', `${location.pathname}?${params}`);
  requestAnimationFrame(() => { setMode('overview'); runAudit(); });
});

function loadStage(node = selectedStage()): void {
  walker.stop();
  if (game.state === 'paused') game.resume();
  if (game.state === 'summary' || game.state === 'menu') { requested = node; game.startRun(ctx.heroes[0].id); return; }
  if (!loaded || game.state !== 'playing') { requested = node; return; }
  requested = null; ctx.time.timeScale = 1;
  game.advance(node);
}

function runAudit(): void {
  const metadata = director.whitebox;
  if (!metadata || game.state !== 'playing') return;
  const report = probeWhitebox(ctx, metadata);
  lastAuditPlan = metadata.planId;
  auditStatus.dataset.state = report.passed ? 'passed' : 'failed';
  auditStatus.dataset.report = JSON.stringify(report);
  const passedPassages = report.passages.filter(p => p.passed).length;
  const passedPoints = report.checkpoints.filter(p => p.passed).length;
  auditStatus.textContent = [`${report.passed ? '碰撞 / 导航通过' : '存在待修复点'} · ${metadata.planId}`,
    `通道 ${passedPassages}/${report.passages.length} · 关键点 ${passedPoints}/${report.checkpoints.length}`,
    ...report.passages.filter(p => !p.passed).map(p => `${p.id}：${p.error}`),
    ...report.checkpoints.filter(p => !p.passed).map(p => `${p.id}：${p.error}`),
    '独立探针结果；不等于人工试玩结论。'].join('\n');
}

$('wb-overview').onclick = () => setMode('overview');
$('wb-first-person').onclick = () => setMode('inspect');
$('wb-clean-view').onclick = () => { setMode('inspect'); document.body.classList.add('wb-clean'); };
$('wb-return-tools').onclick = () => setMode('inspect');
$('wb-play').onclick = () => setMode('play', true);
$('wb-locate').onclick = () => locate(checkpoint());
$('wb-entry').onclick = () => { checkpoints.value = 'entry'; locate(checkpoint()); };
$('wb-reset').onclick = () => { if (game.state === 'paused') game.resume(); loadStage(); };
$('wb-clear').onclick = () => ctx.enemies.killAll();
$('wb-audit').onclick = runAudit;
$('wb-walk').onclick = () => {
  const point = checkpoint();
  if (!point || game.state !== 'playing') return;
  ctx.input.releaseAll(); ctx.input.enabled = true; ctx.time.timeScale = 1;
  const plan = director.whitebox?.plan, floorY = ctx.stage.arena?.floorY ?? 0;
  if (routeChoice.value !== 'target' && plan) {
    const passages = routeChoice.value === 'main' ? plan.mainRoute.map(id => plan.passages.find(p => p.id === id)!) : plan.passages.filter(p => p.id === routeChoice.value);
    const at = passages.flatMap(p => p.points).map(at => { const p = whiteboxPoint(plan, at); return new THREE.Vector3(p.x, floorY, p.z); });
    if (routeChoice.value === 'main') { const p = whiteboxPoint(plan, plan.exit.at); at.push(new THREE.Vector3(p.x, floorY, p.z)); }
    const target = at.pop();
    if (target) walker.start(routeChoice.value, routeChoice.selectedOptions[0].text, target, at);
  } else walker.start(point.id, point.label, new THREE.Vector3(point.x, floorY, point.z));
  if (mode === 'overview') $('wb-view-label').textContent = '俯视 · 真实步行中';
};
$('wb-stop-walk').onclick = () => walker.stop();
invulnerable.onchange = () => { ctx.player.invulnerableTime = invulnerable.checked ? 1e9 : 0; };
theme.onchange = () => { refreshChoices('0'); loadStage(); };
stageChoice.onchange = () => { typeChoice.disabled = stageChoice.value === '4'; loadStage(); };
typeChoice.onchange = () => loadStage();
lookChoice.onchange = () => {
  const params = new URLSearchParams(location.search);
  params.set('look', lookChoice.value);
  history.replaceState(null, '', `${location.pathname}?${params}`);
  lastPerformanceReport = null; performancePlan = 'changed';
  loadStage();
};
$('wb-sample').onclick = () => { performancePlan = director.whitebox?.planId ?? ''; game.performanceMeter?.sample(); };
window.addEventListener('resize', frameOverview);
window.addEventListener('keydown', event => {
  if (event.code === 'Escape' && mode !== 'overview') { setMode('inspect'); event.preventDefault(); }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code) && event.isTrusted) walker.stop();
});
document.addEventListener('pointerlockerror', () => { if (mode === 'play' && !ctx.input.pointerLocked) setMode('inspect'); });

let lastStatus = 0, lastTick = 0;
const projected = new THREE.Vector3();
function update(now: number): void {
  requestAnimationFrame(update);
  const dt = Math.min(.05, Math.max(0, (now - lastTick) / 1000)); lastTick = now;
  if (game.state === 'playing') walker.update(dt);
  else walker.stop();
  if (lastWalkState !== walker.report.state) {
    lastWalkState = walker.report.state;
    if (mode === 'overview' && walker.report.state !== 'walking') {
      ctx.time.timeScale = 0; ctx.input.enabled = false; $('wb-view-label').textContent = '俯视 · 时间暂停';
    }
  }
  const marker = $('wb-walk-marker');
  marker.hidden = mode !== 'overview' || !loaded;
  if (!marker.hidden) {
    projected.copy(ctx.player.position).project(overview);
    marker.style.left = `${(projected.x + 1) * window.innerWidth / 2}px`;
    marker.style.top = `${(1 - projected.y) * window.innerHeight / 2}px`;
    marker.style.transform = `translate(-50%, -50%) rotate(${-ctx.player.yaw}rad)`;
  }
  if (now - lastStatus < 160) return;
  lastStatus = now;
  const metadata = director.whitebox, a = ctx.stage.exploration;
  const fights = a?.encounters ?? [], active = fights.find(e => e.phase === 'active');
  const p = ctx.player.position;
  const phase = !loaded || game.state === 'transition' ? '载入中' : active ? `${active.label} · 交战` : ctx.stage.cleared ? '已完成' : a?.phase === 'battle' ? '目标战斗' : '探索';
  status.textContent = [
    `${phase} · 敌人 ${ctx.enemies.aliveCount()} · ${game.fps} FPS`,
    ...(active && a?.spawnBlocked ? ['守卫等待入场 · 退回通道拉开距离'] : []),
    `遭遇 ${fights.filter(e => e.phase === 'cleared').length}/${fights.length} · 补给 ${a?.sites.filter(s => s.visited).length ?? 0}/${a?.sites.length ?? 0}`,
    `位置 ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · ${ctx.player.onGround ? '着地' : '离地'}`,
    `交互：${ctx.interact.current?.prompt().title ?? '无'}${mode === 'overview' ? walker.report.state === 'walking' ? ' · 步行中' : ' · 时间暂停' : ''}`,
  ].join('\n');
  status.dataset.plan = metadata?.planId ?? ''; status.dataset.phase = active ? 'encounter' : a?.phase ?? ctx.stage.stage?.type ?? 'loading';
  status.dataset.look = lookChoice.value;
  status.dataset.rayWindows = String(ctx.world.activeRayWindowCount);
  status.dataset.activeEncounter = active?.id ?? ''; status.dataset.alive = String(ctx.enemies.aliveCount());
  status.dataset.spawnBlocked = String(!!a?.spawnBlocked);
  status.dataset.position = JSON.stringify({ x: p.x, y: p.y, z: p.z }); status.dataset.mode = mode;
  status.dataset.view = JSON.stringify({ yaw: ctx.player.yaw, pitch: ctx.player.pitch });
  status.dataset.encounters = JSON.stringify(fights.map(e => ({ id: e.id, label: e.label, phase: e.phase })));
  status.dataset.ground = String(ctx.player.onGround); status.dataset.auditPlan = lastAuditPlan;
  const w = walker.report;
  walkStatus.dataset.state = w.state; walkStatus.dataset.report = JSON.stringify(w);
  if (w.state !== 'idle') walkStatus.textContent = [w.targetLabel, `${w.state === 'walking' ? '步行中' : w.state === 'passed' ? '已抵达' : w.state === 'failed' ? '需检查' : '已停止'} · ${w.elapsed.toFixed(1)} 秒 · 实走 ${w.distance.toFixed(1)} m · 距目标 ${w.remaining.toFixed(1)} m`, w.message].join('\n');
  $('wb-stop-walk').hidden = w.state !== 'walking';
  $<HTMLButtonElement>('wb-walk').disabled = w.state === 'walking' || game.state !== 'playing';
  $<HTMLButtonElement>('wb-locate').disabled = game.state !== 'playing';
  const meter = game.performanceMeter;
  if (meter && (!performancePlan || performancePlan === metadata?.planId)) {
    performanceOutput.dataset.state = meter.state; performanceOutput.dataset.frames = String(meter.progress);
    if (meter.report && meter.report !== lastPerformanceReport) {
      const r = meter.report; lastPerformanceReport = r;
      performanceOutput.dataset.report = JSON.stringify(r);
      performanceOutput.textContent = `${r.frames} 帧 · ${r.fps.toFixed(1)} FPS\n更新 P95 ${r.updateMs.p95.toFixed(2)} ms · GPU ${r.gpu.ms ? r.gpu.ms.p95.toFixed(2) + ' ms' : r.gpu.status}\n${r.render.calls.toFixed(0)} calls · ${Math.round(r.render.triangles).toLocaleString()} triangles\n${r.resolution.width} × ${r.resolution.height} · ${r.metadata.quality}${r.hiddenFrames ? ` · 后台帧 ${r.hiddenFrames}` : ''}`;
    } else if (!meter.report) {
      delete performanceOutput.dataset.report;
      performanceOutput.textContent = meter.state === 'idle' ? '等待采样：30 帧预热 + 240 帧记录' : meter.state === 'warmup' ? '30 帧预热中…' : meter.state === 'pending-gpu' ? '等待 GPU 计时结果…' : `采样 ${meter.progress} / 240 帧…`;
    }
  } else if (meter) {
    performanceOutput.dataset.state = 'idle'; delete performanceOutput.dataset.report;
    performanceOutput.textContent = '已切换地图，需重新采样当前关卡。';
  }
}

game.start();
game.startRun(ctx.heroes[0].id);
requestAnimationFrame(update);
