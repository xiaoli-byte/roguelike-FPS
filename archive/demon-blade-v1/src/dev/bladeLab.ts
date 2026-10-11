/** Development-only production-model/FX inspector, served by Vite outside release entrypoints. */
import * as THREE from 'three';
import { Game } from '../core/Game';
import { HEROES } from '../player/Heroes';
import type { IEnemy, WeaponInstance } from '../core/types';
import { buildGunModel } from '../weapons/WeaponModels';
import { BLADE_RUNE_COLOR, BLADE_SHARDS, bladeFormationPosition } from '../weapons/DemonBladeModel';
import { Ballistics } from '../weapons/Firing';
import { BladeSkill } from '../weapons/BladeSkill';
import { resolveWeapon } from '../weapons/WeaponStats';
import { getWeaponDef } from '../weapons/WeaponDefs';
import { createViewmodelState, Viewmodel } from '../weapons/Viewmodel';
import { PerformanceMeter } from './PerformanceMeter';

const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const view = select('view'), action = select('action'), quality = select('quality'), targetsControl = select('targets'), backdrop = select('backdrop'), speed = select('speed');
const play = input('play'), slider = input('time'), ammo = input('ammo');
const readout = document.getElementById('readout')!, params = new URLSearchParams(location.search);
for (const control of [view, action, quality, targetsControl, backdrop, speed]) {
  const value = params.get(control.id);
  if (value && [...control.options].some(o => o.value === value)) control.value = value;
}
if (params.has('ammo')) ammo.value = String(THREE.MathUtils.clamp(Number(params.get('ammo')), 0, BLADE_SHARDS));
if (params.get('play') === '0') play.checked = false;
slider.value = params.get('time') ?? '0';
const game = new Game(), ctx = game.ctx;
ctx.player.resetForRun(HEROES[0]);
ctx.player.position.set(0, 0, 0); ctx.player.eye.set(0, 1.65, 0);
ctx.settings.quality = quality.value as 'high' | 'medium' | 'low';
ctx.settings.damageNumbers = false;
ctx.renderer.shadowMap.enabled = false;
ctx.scene.background = new THREE.Color(0x151b2b);
ctx.scene.add(new THREE.HemisphereLight(0xdce5ff, 0x42415c, 2.0));
const key = new THREE.DirectionalLight(0xfff6ea, 2.8); key.position.set(-3, 6, 2); ctx.scene.add(key);
const rim = new THREE.DirectionalLight(0x997aff, 1.4); rim.position.set(-3, 1, -4); ctx.scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ color: 0x252c40, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; ctx.scene.add(floor);
const grid = new THREE.GridHelper(40, 40, 0x454e65, 0x30384c); grid.position.y = 0.002; ctx.scene.add(grid);

const model = buildGunModel('demon_blade', 0, 'none', { art: false });
model.root.position.set(0, 1.3, -3); model.root.scale.setScalar(2.5);
ctx.scene.add(model.root);
const vm = new Viewmodel(ctx); vm.init();
const inst: WeaponInstance = { uid: 77001, defId: 'demon_blade', rarity: 0, element: 'none', level: 0, mag: BLADE_SHARDS, reserve: 0, affixes: [] };
vm.setWeapon(inst);
const state = createViewmodelState(), def = getWeaponDef('demon_blade');
const ballistics = new Ballistics(ctx, vm, () => 0.5);
let skillRecallStart=-1;
const ability=new BladeSkill(ctx,{
  resolve:()=>resolveWeapon(inst,ctx.player.stats),interrupt:()=>{},
  surge:(weapon,point,sk)=>ctx.projectiles.surgeBladeFragments(weapon.uid,point,{base:0,source:'weapon',element:'none',tags:['weaponSkill']},sk.chargeTime),
  fireCell:(weapon,point,mult)=>{if(weapon.mag<=0)return false;const before=weapon.mag--;
    ballistics.projectile(weapon,{...resolveWeapon(weapon,ctx.player.stats),damage:0},0,false,mult,0,0,false,before,point);return true;},
  recall:(weapon)=>{skillRecallStart=ctx.time.now;recallBase=weapon.mag;
    ctx.projectiles.recallBladeFragments(weapon.uid,1.4,(index,out)=>vm.getBladeFragmentWorld(index,out));},
  cancelSurge:(uid)=>ctx.projectiles.cancelBladeSurge(uid),
});
const targets: IEnemy[] = [], targetRoot = new THREE.Group(); ctx.scene.add(targetRoot);
const targetGeometry = new THREE.CapsuleGeometry(0.3, 0.9, 4, 8);
const targetMaterial = new THREE.MeshStandardMaterial({ color: 0x4e6676, roughness: 0.75 });
function buildTargets(): void {
  targets.length = 0; targetRoot.clear();
  const count = Number(targetsControl.value);
  for (let i = 0; i < count; i++) {
    const position = new THREE.Vector3(count === 1 ? 0 : (i % 6 - 2.5) * 1.35, 0, -4.8 - Math.floor(i / 6) * 1.5);
    const mesh = new THREE.Mesh(targetGeometry, targetMaterial); mesh.position.copy(position); mesh.position.y = 0.9; targetRoot.add(mesh);
    // Only the production BladeFx mark/impale contract is exercised by these visual targets.
    targets.push({ position, alive: true, removed: false, radius: 0.3, height: 1.8,
      getBodyCenter: (out: THREE.Vector3) => out.copy(position).add(_height) } as unknown as IEnemy);
  }
}
const _height = new THREE.Vector3(0, 0.9, 0), _origin = new THREE.Vector3(0, 1.65, 0), _dir = new THREE.Vector3(0, 0, -1), _point = new THREE.Vector3();
const _showcaseFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2);
buildTargets();
let time = Number(slider.value), last = performance.now(), previousPhase = -1, fired = false, marked = false, impaled = false, settling = 30, recallBase = 0;
const meter = new PerformanceMeter(ctx.renderer, () => ({ quality: quality.value, theme: backdrop.value, gameState: 'blade-inspection', phase: action.value, enemies: targets.length }));
function reset(): void {
  ability.resetForRun();inst.mag=Number(ammo.value);skillRecallStart=-1;
  const sampleTime = Number(slider.value);
  time = 0; ctx.player.yaw = 0; previousPhase = -1; fired = marked = impaled = false; settling = 1;
  vm.clearTransient();
  ctx.fx.clear?.(); ctx.projectiles.clear?.();
  updateScene(0);
  for (let i = 0; i < 30; i++) vm.update(1 / 60, state);
  ctx.fx.clear?.(); ctx.projectiles.clear?.();
  ability.resetForRun();inst.mag=Number(ammo.value);skillRecallStart=-1;
  previousPhase = -1; fired = marked = impaled = false;
  updateScene(0);
  while (time < sampleTime) {
    const dt = Math.min(1 / 120, sampleTime - time);
    time += dt; updateScene(dt);
  }
  last = performance.now();
}
function sync(): void {
  ctx.settings.quality = quality.value as 'high' | 'medium' | 'low';
  const background = backdrop.value === 'sand' ? 0xc5aa82 : backdrop.value === 'snow' ? 0xc7d9e4 : 0x151b2b;
  ctx.scene.background = new THREE.Color(background);
  (floor.material as THREE.MeshStandardMaterial).color.setHex(backdrop.value === 'sand' ? 0xb59974 : backdrop.value === 'snow' ? 0xadbfcf : 0x252c40);
  model.root.visible = view.value === 'model'; vm.setVisible(view.value === 'first'); targetRoot.visible = view.value === 'first';
  if (view.value === 'model') { ctx.camera.up.set(0, 0.7, 0.714); ctx.camera.position.set(-4, 1.3, -3.7); ctx.camera.lookAt(0, 1.3, -3.7); ctx.camera.fov = 40; }
  else { ctx.camera.up.set(0, 1, 0); ctx.camera.position.set(0, 1.65, 0); ctx.camera.rotation.set(0, 0, 0); ctx.camera.fov = 80; }
  ctx.camera.updateProjectionMatrix();
  document.getElementById('ammo-value')!.textContent = ammo.value;
  const query = new URLSearchParams({ view: view.value, action: action.value, quality: quality.value, targets: targetsControl.value, backdrop: backdrop.value, ammo: ammo.value, speed: speed.value, play: play.checked ? '1' : '0', time: slider.value });
  history.replaceState(null, '', `?${query}`);
}
for (const c of [action, ammo]) c.addEventListener('change', () => { sync(); reset(); });
for (const c of [view, quality, backdrop, play, speed]) c.addEventListener('change', () => { sync(); settling = 1; last = performance.now(); });
targetsControl.addEventListener('change', () => { buildTargets(); reset(); sync(); });
slider.addEventListener('input', () => { play.checked = false; reset(); sync(); });
document.getElementById('toggle')!.onclick = () => document.body.classList.toggle('clean');
document.getElementById('step')!.onclick = () => {
  play.checked = false;
  const wasRanged = action.value === 'ranged'; action.value = 'ranged';
  slider.value = String(wasRanged ? Math.min(3.49, (Math.floor(time * def.fireRate + 1e-6) + 1) / def.fireRate + 1e-7) : 0);
  sync(); reset();
};
document.getElementById('recall-now')!.onclick = () => {
  ammo.value=String(state.blades); action.value='recall'; slider.value='0';
  // Keep the real cells already in the world; reset only the inspector's recall clock.
  time=0; fired=true; recallBase=state.blades; play.checked=true;
  ctx.projectiles.recallBladeFragments(inst.uid,1.4,(index,out)=>vm.getBladeFragmentWorld(index,out));
  settling=1; sync(); last=performance.now();
};
document.getElementById('sample')!.onclick = () => { play.checked = true; sync(); meter.sample(); };
window.addEventListener('resize', () => { settling = 1; });
sync();
reset();

function updateScene(dt: number): void {
  ctx.time.now = time;
  const t = time, color = BLADE_RUNE_COLOR;
  state.form = 'melee'; state.bladesMax = BLADE_SHARDS; state.blades = Number(ammo.value); state.morphT = 1;
  state.swing = -1; state.swingP = 0; state.reloading = false; state.skillT = -1;
  let ranged = 0, activity = action.value === 'idle' ? 0 : 0.9;
  if (action.value === 'morph') {
    const leg = t % 2; state.form = leg < 1 ? 'ranged' : 'melee'; state.morphT = Math.min(1, (leg % 1) / 0.65);
    ranged = state.form === 'ranged' ? state.morphT : 1 - state.morphT;
  } else if (action.value === 'ranged' || action.value === 'ranged-ready' || action.value === 'recall' || action.value === 'cycle') {
    state.form = 'ranged'; ranged = 1;
    const recalling = action.value === 'recall' || (action.value === 'cycle' && t >= 4.2);
    if (recalling) {
      const start = action.value === 'cycle' ? 4.2 : 0;
      state.reloadP = Math.min(1, (t-start)/1.4); state.reloading = state.reloadP < 1;
      if (!fired) {
        recallBase = action.value === 'cycle' ? 0 : Number(ammo.value);
        if (action.value === 'recall') {
          // Reconstruct actual previously emitted cells for a direct recall inspection URL.
          const resolved = resolveWeapon(inst,ctx.player.stats);
          for(let before=BLADE_SHARDS;before>recallBase;before--)
            ballistics.projectile(inst,{...resolved,damage:0},0,false,1,0,0,false,before);
          for(let i=0;i<72;i++) ctx.projectiles.update?.(1/120);
        }
        ctx.projectiles.recallBladeFragments(inst.uid,1.4,(index,out)=>vm.getBladeFragmentWorld(index,out));
        fired=true;
      }
      state.blades = Math.min(BLADE_SHARDS,recallBase+ctx.projectiles.returnedBladeFragments(inst.uid));
    } else {
      const phase = Math.floor(t * def.fireRate);
      if (action.value === 'ranged' || action.value === 'cycle') {
        const initial = action.value === 'cycle' ? BLADE_SHARDS : Number(ammo.value);
        state.blades = Math.max(0,initial-phase-1);
        for(let shot=previousPhase+1;shot<=phase && shot<initial;shot++) {
          if(action.value === 'cycle') ctx.player.yaw = .12*Math.sin(shot/128*Math.PI*3);
          vm.onShot(def,color,1);
          const resolved=resolveWeapon(inst,ctx.player.stats);
          ballistics.projectile(inst,{...resolved,damage:0},0,false,1,0,0,false,initial-shot);
        }
      }
      previousPhase=phase;
    }
  } else if (action.value === 'combo') {
    const cycle = t % 1.8;
    const segment = cycle < 0.3 ? 0 : cycle < 0.6 ? 1 : cycle < 1.06 ? 2 : -1;
    if (segment >= 0) {
      const s = def.melee!.combo[segment], start = segment === 0 ? 0 : segment === 1 ? 0.3 : 0.6;
      state.swing = segment; state.swingP = Math.min(1, (cycle - start) / s.duration); state.swingHitP = s.windup / s.duration;
      if (segment !== previousPhase) { vm.onSlash(segment, color); fired = false; }
      if (!fired && cycle - start >= s.windup) {
        ctx.fx.blade.slashArc(_origin, 0, 0, segment, s.range, s.halfAngle, color);
        ctx.fx.blade.slashHit(_point.set(0, 1.2, -3), _dir, color, segment === 2); vm.onSlashHit(segment === 2); fired = true;
      }
    }
    previousPhase = segment;
  } else if (action.value === 'skill' || action.value==='skill-ranged') {
    const form=action.value==='skill'?'melee':'ranged';state.form=form;ranged=form==='ranged'?1:0;
    if(!marked) {
      if(form==='ranged' && inst.mag<BLADE_SHARDS) {
        for(let before=BLADE_SHARDS;before>inst.mag;before--) ballistics.projectile(inst,{...resolveWeapon(inst,ctx.player.stats),damage:0},0,false,1,0,0,false,before);
        for(let i=0;i<72;i++)ctx.projectiles.update?.(1/120);
      }
      ability.tryCast(inst,resolveWeapon(inst,ctx.player.stats),form);marked=true;
    }
    ability.update(dt);state.skillT=ability.dashProgress;state.blades=inst.mag;
    if(skillRecallStart>=0) {
      state.reloading=t-skillRecallStart<1.4;state.reloadP=Math.min(1,(t-skillRecallStart)/1.4);
      state.blades=Math.min(128,recallBase+ctx.projectiles.returnedBladeFragments(inst.uid));
    }
    activity=state.skillT>=0?1.2:0;
  }
  // Production Viewmodel handles the first-person formation; showcase keeps the same individual cells.
  vm.update(dt, state);
  if (model.blade) {
    const rig = model.blade;
    const n = state.blades;
    rig.energy.update(dt, ranged, activity, quality.value, ranged < 0.5 ? 1 : n / BLADE_SHARDS);
    rig.body.visible = false;
    for (let i = 0; i < rig.shards.length; i++) {
      const shard = rig.shards[i], home = rig.shardHome[i].pos;
      const rank = rig.shardOrder.indexOf(i);
      shard.visible = ranged < 0.5 || rank >= BLADE_SHARDS - n;
      shard.position.copy(home); shard.quaternion.identity();
      if(ranged<.5 && state.skillT>=0) {const extent=1+.65*Math.sin(Math.PI*state.skillT);
        shard.position.z=-.04+(home.z+.04)*extent;shard.scale.set(1,1,extent);}else shard.scale.setScalar(1);
      if (ranged > 0) {
        bladeFormationPosition(rank,t,1,_point);
        const x=_point.x,y=_point.y,z=_point.z;
        _point.set(z*.06,y*.9,x*.9-.4);
        shard.position.lerp(_point,ranged);
        shard.rotation.x = ranged*(Math.floor(rank/4)*Math.PI/16+t*.16);
      }
    }
    rig.energy.updateFormation(rig.shards,ranged,_showcaseFacing,activity,t,quality.value);
    if(ranged<.5) rig.energy.updateMelee(rig.shards,1-ranged,_showcaseFacing,activity,t,quality.value,
      state.skillT>=0?1+.65*Math.sin(Math.PI*state.skillT):1);
  }
  ctx.projectiles.update?.(dt); ctx.fx.update?.(dt);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!play.checked && settling <= 0 && (meter.state === 'idle' || meter.state === 'complete')) { last = now; return; }
  const dt = play.checked ? Math.min(0.05, (now - last) / 1000) * Number(speed.value) : 0; last = now;
  if (play.checked) {
    time += dt;
    if (time >= 8.4) { time = 8.4; play.checked = false; }
    slider.value = String(time);
  }
  meter.beginFrame(now);
  updateScene(dt);
  meter.endUpdate(); meter.beginRender();
  ctx.renderer.info.reset(); ctx.renderer.clear(); ctx.renderer.render(ctx.scene, ctx.camera);
  if (view.value === 'first') { ctx.renderer.clearDepth(); ctx.renderer.render(ctx.viewScene, ctx.viewCamera); }
  meter.endRender();
  if (meter.report) {
    readout.dataset.report = JSON.stringify(meter.report);
    readout.textContent = `${meter.report.fps.toFixed(1)} FPS · ${meter.report.resolution.width}×${meter.report.resolution.height}\nGPU ${meter.report.gpu.ms?.mean.toFixed(2) ?? '不可用'} ms\n${Math.round(meter.report.render.calls)} 次绘制 · ${Math.round(meter.report.render.triangles)} 三角形\n${targets.length}目标 · ${quality.value}`;
  } else readout.textContent = `${action.value} · ${time.toFixed(3)} 秒${action.value === 'ranged' || action.value === 'cycle' || action.value === 'recall' ? `\n刀身 ${state.blades} 个 · 悬停／召回 ${ctx.projectiles.retainedBladeFragments(inst.uid)} 个真实碎片` : ''}\n${ctx.renderer.info.render.calls} 次绘制 · ${ctx.renderer.info.render.triangles} 三角形\n${meter.state === 'idle' ? '可暂停或拖动时刻检视' : '性能采样中…'}`;
  if (!play.checked) settling--;
}
requestAnimationFrame(frame);
