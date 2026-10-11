import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const dataModule = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
async function ts(path, imports = {}) {
  let s = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries(imports)) s = s.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(s.replaceAll("'three'", `'${new URL('../node_modules/three/build/three.module.js', import.meta.url).href}'`));
}
const modelUrl = await ts('../src/weapons/DemonBladeModel.ts');
const { buildDemonBlade, bladeFlowU, bladeSeamLight, bladeRankForAmmo, bladeFormationPosition, BLADE_RUNE_COLOR, BLADE_SHARDS, bladeFragmentGeometry } = await import(modelUrl);
const sharedUrl = await ts('../src/fx/shared.ts');
const { BladeFx } = await import(await ts('../src/fx/BladeFx.ts', {
  './shared': sharedUrl, './BladeArcs': await ts('../src/fx/BladeArcs.ts', { './shared': sharedUrl }),
  './Particles': dataModule('export const STYLE_GLOW=0, STYLE_MOTE=1, STYLE_SPARK=2;'),
}));
const defsUrl = await ts('../src/weapons/WeaponDefs.ts');
const typesUrl = await ts('../src/core/types.ts'), mathUrl = await ts('../src/core/math.ts');
const { getWeaponDef } = await import(defsUrl);
const { BladeSkill:ProductionBladeSkill }=await import(await ts('../src/weapons/BladeSkill.ts',{
  './WeaponDefs':defsUrl,'./Melee':await ts('../src/weapons/Melee.ts',{'../core/types':typesUrl,'../core/math':mathUrl}),
}));
const { bladeColor } = await import(await ts('../src/weapons/Melee.ts', { '../core/types': typesUrl, '../core/math': mathUrl }));
const firingUrl = await ts('../src/weapons/Firing.ts', { '../core/types': typesUrl, '../core/math': mathUrl, './DemonBladeModel': modelUrl });
const { Ballistics } = await import(firingUrl);
const { WeaponSystem } = await import(await ts('../src/weapons/WeaponSystem.ts', {
  '../core/math': mathUrl,
  './Affixes': dataModule('export function rollAffixes(){return [];}'),
  './AffixEffects': dataModule('export class AffixEffects {}'),
  './BladeSkill': dataModule('export class BladeSkill {}'),
  './Describe': dataModule('export function describeWeapon(){}'),
  './Firing': firingUrl,
  './Melee': await ts('../src/weapons/Melee.ts', { '../core/types': typesUrl, '../core/math': mathUrl }),
  './Viewmodel': dataModule('export class Viewmodel {} export function createViewmodelState(){return {}; }'),
  './WeaponDefs': defsUrl,
  './WeaponModels': dataModule('export function buildWorldModel(){}'),
  './WeaponStats': dataModule('export function resolveWeapon(){}'),
}));
// Only external art and DOM texture constructors are stubbed; animation methods are production code.
const { Viewmodel, createViewmodelState } = await import(await ts('../src/weapons/Viewmodel.ts', {
  './DemonBladeModel': modelUrl, '../core/types': typesUrl, '../core/math': mathUrl, './WeaponDefs': defsUrl,
  './WeaponModels': dataModule(`export const BLADE_SHARDS=128, BLADE_RUNE_COLOR=${BLADE_RUNE_COLOR}; export const boxGeo=()=>{}, buildGunModel=()=>{}, getFlashTexture=()=>{}, setCrossbowString=()=>{}, solidMat=()=>{};`),
  '../assets/AssetLibrary': dataModule('export const AssetLibrary={get:()=>null};'),
  '../assets/ArtEnvironment': dataModule('export function applyArtEnvironment(){}'),
  '../assets/StaticAttachment': dataModule('export function attachStaticPart(){}'),
  './WeaponHandling': await ts('../src/weapons/WeaponHandling.ts'), './ReloadBreech': await ts('../src/weapons/ReloadBreech.ts'),
}));
function model() {
  const m = { root: new THREE.Group(), muzzle: new THREE.Object3D() };
  m.root.add(m.muzzle); buildDemonBlade(m); return m;
}
function harness(quality = 'high') {
  let flashes = 0;
  const ctx = { settings: { quality }, camera: new THREE.PerspectiveCamera(), world: { groundHeight: () => 0 } };
  const deps = { glow: { spawn() {} }, sparks: { spawn() {} }, ground: { ring() {} }, flashes: { sphere() { flashes++; }, light() {} } };
  return { fx: new BladeFx(ctx, deps), batch: { quad() {} }, flashes: () => flashes };
}
const enemy = i => ({ alive: true, removed: false, radius: .3,
  position: new THREE.Vector3(i % 6, 0, -5 - Math.floor(i / 6)),
  getBodyCenter(out) { return out.copy(this.position).add(new THREE.Vector3(0, .9, 0)); } });

test('fractured blade keeps 128 independent polygon cells, finite closed geometry and a continuous silhouette', () => {
  const a = model(), b = model(), bounds = new THREE.Box3();
  assert.equal(a.blade.shards.length, 128);
  assert.equal(new Set(a.blade.shardOrder).size, 128);
  assert.equal(a.blade.shards[0].geometry.userData.cellCountTotal, 128);
  for (let i = 0; i < 128; i++) {
    const shard = a.blade.shards[i], g = shard.geometry;
    assert.equal(g.userData.cellCount, 1, 'one mesh contains exactly one natural polygon');
    assert.equal(g,bladeFragmentGeometry(i));
    assert.ok(g.attributes.position.count >= 24);
    for (const key of ['position', 'normal', 'color']) assert.ok([...g.attributes[key].array].every(Number.isFinite));
    assert.equal(g, b.blade.shards[i].geometry, 'geometry stays shared');
    assert.notEqual(shard.position, b.blade.shards[i].position, 'instance transforms stay independent');
    bounds.union(new THREE.Box3().setFromObject(shard));
  }
  assert.ok(Math.abs(bounds.min.z + .82) < .003);
  assert.ok(Math.abs(bounds.max.z + .04) < .003);
  assert.ok(bounds.max.y - bounds.min.y < .09);
});

test('real fragments travel tip to hilt, freeze at dt=0, and obey quality limits', () => {
  assert.ok(bladeFlowU(.3, .12) < bladeFlowU(.2, .12));
  const a = model().blade.energy, b = model().blade.energy;
  const chips = a.group.getObjectByName('blade.tipToHiltFragments'), mat = new THREE.Matrix4();
  a.update(.1, 0, 1, 'high'); chips.getMatrixAt(0, mat); const startZ = mat.elements[14];
  a.update(.1, 0, 1, 'high'); chips.getMatrixAt(0, mat);
  assert.ok(mat.elements[14] > startZ, 'increasing local Z points back toward the hilt');
  const before = [...chips.instanceMatrix.array]; a.update(0, 0, 1, 'high');
  assert.deepEqual([...chips.instanceMatrix.array], before);
  assert.notEqual(chips.material, b.group.getObjectByName('blade.tipToHiltFragments').material);
  for (const [q, n] of [['low',20], ['medium',40], ['high',64]]) { a.update(.01, 1, .8, q); assert.equal(chips.count,n); }
  assert.ok([...chips.instanceMatrix.array].every(Number.isFinite));
  a.dispose(); b.dispose();
});

test('empty ranged magazine rebuilds the complete melee blade; ranged/reload counts remain accurate', () => {
  const gun = model(), rig = gun.blade, rank = new Uint8Array(128);
  rig.shardOrder.forEach((i,k) => { rank[i]=k; });
  const bl = { rig, rank, color: BLADE_RUNE_COLOR, runeMat: rig.runes[0].material.clone(), shardMats: [], snap:true,
    present:Array(128).fill(true), appearT:new Float32Array(128).fill(.12), launchT:new Float32Array(128).fill(-1),
    jit:new Float32Array(256) };
  const vm = Object.create(Viewmodel.prototype);
  Object.assign(vm, { ctx:{ settings:{quality:'high'}, viewCamera:new THREE.PerspectiveCamera(60,1) }, pivot:new THREE.Group(), trail:{update(){}}, trailOn:false, hitFlash:0 });
  const state = createViewmodelState(); Object.assign(state,{form:'ranged',bladesMax:128});
  const entry = { gun, def:getWeaponDef('demon_blade') };
  for (const n of [128,127,3,1,0]) {
    state.blades=n;
    for (let i=0;i<30;i++) vm.animateBlade(1/60,entry,bl,state,1);
    assert.equal(rig.shards.filter(m=>m.visible).length,n);
  }
  state.reloading=true; state.reloadP=.5; vm.animateBlade(1/60,entry,bl,state,1);
  assert.equal(bl.present.filter(Boolean).length,0,"reload progress does not fabricate arrived fragments");
  state.blades=64; vm.animateBlade(1/60,entry,bl,state,1);
  assert.equal(bl.present.filter(Boolean).length,64);
  state.reloading=false; state.form='melee'; state.blades=0;
  for (let i=0;i<30;i++) vm.animateBlade(1/60,entry,bl,state,1);
  assert.equal(rig.shards.filter(m=>m.visible).length,128);
  rig.shards.forEach((m,i)=>assert.ok(m.position.distanceTo(rig.shardHome[i].pos)<1e-6));
});

test('world-drop energy releases animated instance resources and borrows a static material', () => {
  const a=model().blade.energy, b=model().blade.energy;
  const chips=a.group.getObjectByName('blade.tipToHiltFragments');
  let released=0; chips.addEventListener('dispose',()=>released++);
  chips.material.addEventListener('dispose',()=>released++);
  a.makeStatic(); b.makeStatic();
  assert.equal(released,2); assert.equal(a.group.children.length,1);
  assert.equal(a.group.children[0].material,b.group.children[0].material);
  let sharedDisposed=false; a.group.children[0].material.addEventListener('dispose',()=>{sharedDisposed=true;});
  a.dispose(); assert.equal(sharedDisposed,false);
});

test('128 real ranged cells occupy distinct animated orbit slots and emit individually in original tip-to-hilt order', () => {
  const gun=model(),rig=gun.blade,rank=new Uint8Array(128);
  rig.shardOrder.forEach((i,k)=>{rank[i]=k;});
  const bl={rig,rank,color:BLADE_RUNE_COLOR,runeMat:rig.runes[0].material.clone(),shardMats:[],snap:true,
    present:Array(128).fill(true),appearT:new Float32Array(128).fill(.12),launchT:new Float32Array(128).fill(-1)};
  const vm=Object.create(Viewmodel.prototype);
  Object.assign(vm,{ctx:{settings:{quality:'high'},viewCamera:new THREE.PerspectiveCamera(60,1)},pivot:new THREE.Group(),trail:{update(){}},trailOn:false,hitFlash:0});
  const state=createViewmodelState(); Object.assign(state,{form:'ranged',bladesMax:128,blades:128});
  const entry={gun,def:getWeaponDef('demon_blade')};
  vm.animateBlade(0,entry,bl,state,0);
  for(let n=128;n>=1;n--) {
    rig.shards.forEach((m,i)=>{if(bl.present[i]) {
      const expected=bladeFormationPosition(rank[i],0,1,new THREE.Vector3());
      assert.ok(m.position.distanceTo(expected)<1e-6,'cell occupies its stable slot, never a merged blade group');
      assert.equal(m.scale.x,1);
    }});
    const previous=rig.shards.map(m=>m.visible);
    state.blades=n-1; vm.animateBlade(0,entry,bl,state,0);
    assert.deepEqual(rig.shards.flatMap((m,i)=>previous[i]&&!m.visible?[i]:[]),[rig.shardOrder[128-n]]);
    assert.ok([...bl.launchT].every(v=>v<0), "the emitted world cell has no duplicate viewmodel copy");
    vm.animateBlade(.12,entry,bl,state,0);
    assert.equal(rig.shards.filter(m=>m.visible).length,n-1);
  }
});

test('cell light rims, comet tails and star motes follow only remaining real cells with bounded quality budgets', () => {
  const {shards,energy}=model().blade, facing=new THREE.Quaternion();
  shards.forEach((m,i)=>m.position.copy(bladeFormationPosition(i,1,1,new THREE.Vector3())));
  energy.update(0,1,0,'high');energy.updateFormation(shards,1,facing,0,1,'high');
  assert.equal(energy.orbitTails.count,128);assert.equal(energy.orbitMotes.count,256);
  assert.ok(energy.cellRims.geometry.drawRange.count>128*6);
  const edges=[...energy.cellRims.geometry.attributes.position.array],tails=[...energy.orbitTails.instanceMatrix.array];
  energy.update(0,1,0,'high');energy.updateFormation(shards,1,facing,0,1,'high');
  assert.deepEqual([...energy.cellRims.geometry.attributes.position.array],edges);
  assert.deepEqual([...energy.orbitTails.instanceMatrix.array],tails);
  energy.updateFormation(shards,1,facing,0,1,'low');
  assert.equal(energy.orbitTails.count,64);assert.equal(energy.orbitMotes.count,32);
  shards.forEach(m=>{m.visible=false;});energy.updateFormation(shards,1,facing,0,1,'high');
  assert.equal(energy.orbitTails.count,0);assert.equal(energy.orbitMotes.count,0);assert.equal(energy.cellRims.geometry.drawRange.count,0);
  let releases=0;energy.orbitTails.material.addEventListener('dispose',()=>releases++);
  energy.orbitMotes.material.addEventListener('dispose',()=>releases++);energy.cellRims.geometry.addEventListener('dispose',()=>releases++);
  energy.makeStatic();assert.equal(releases,3);assert.equal(energy.group.children.length,1);
});

test('closed melee cells receive travelling crack light without changing their physical positions or becoming an orbit', () => {
  const {shards,energy}=model().blade,facing=new THREE.Quaternion(),before=shards.map(m=>m.position.clone());
  const peak=time=>{let best=-1,u=0;for(let i=0;i<=1000;i++){const light=bladeSeamLight(i/1000,time);if(light>best){best=light;u=i/1000;}}return u;};
  assert.ok(peak(.6)<peak(.3),'the charge moves toward lower u, from tip toward hilt');
  energy.update(0,0,0,'high');energy.updateFormation(shards,0,facing,0,.3,'high');
  energy.updateMelee(shards,1,facing,0,.3,'high');
  assert.ok(energy.cellRims.geometry.drawRange.count>128*6);
  assert.ok(energy.orbitGlows.count>0 && energy.orbitGlows.count<128);
  assert.equal(energy.orbitTails.count,0,'melee has no orbit comet tails');assert.equal(energy.orbitMotes.count,40);
  shards.forEach((m,i)=>assert.ok(m.position.equals(before[i])));
  const light=[...energy.cellRims.geometry.attributes.color.array],positions=[...energy.cellRims.geometry.attributes.position.array];
  energy.updateMelee(shards,1,facing,0,.3,'high');assert.deepEqual([...energy.cellRims.geometry.attributes.color.array],light);
  energy.updateMelee(shards,1,facing,.8,.6,'low');assert.equal(energy.orbitMotes.count,12);
  assert.notDeepEqual([...energy.cellRims.geometry.attributes.color.array],light);
  assert.deepEqual([...energy.cellRims.geometry.attributes.position.array],positions);
});

test('formation stays in front with an open crosshair across viewport shapes, animates deterministically and pauses',()=>{
  for(const aspect of [.6,1,16/9,2.4]) for(const time of [0,3,17]) {
    const positions=Array.from({length:128},(_,rank)=>bladeFormationPosition(rank,time,aspect,new THREE.Vector3()));
    for(let i=0;i<positions.length;i++) {
      const p=positions[i]; assert.ok(Number.isFinite(p.x+p.y+p.z));
      assert.ok(p.z < -.9 && p.z > -1.35);
      assert.ok(Math.hypot(p.x/aspect,p.y-.065)>.10,'crosshair centre stays open');
      for(let j=0;j<i;j++) assert.ok(p.distanceTo(positions[j])>.025,'small cells remain separated');
    }
  }
  const a=bladeFormationPosition(7,2,1,new THREE.Vector3()),b=bladeFormationPosition(7,3,1,new THREE.Vector3());
  assert.ok(a.distanceTo(b)>.01,'idle orbit moves');
  assert.deepEqual(a,bladeFormationPosition(7,2,1,new THREE.Vector3()),'same paused time has the same slot');
});

test('ranged launch and recall endpoints use actual moving orbit slots, including invisible consumed cells',()=>{
  const gun=model(),rig=gun.blade,rank=new Uint8Array(128);
  rig.shardOrder.forEach((i,k)=>{rank[i]=k;});
  const bl={rig,rank,color:BLADE_RUNE_COLOR,runeMat:rig.runes[0].material.clone(),shardMats:[],snap:true,
    present:Array(128).fill(true),appearT:new Float32Array(128).fill(.12),launchT:new Float32Array(128).fill(-1)};
  const vm=Object.create(Viewmodel.prototype),viewCamera=new THREE.PerspectiveCamera(60,1),camera=new THREE.PerspectiveCamera(80,1);
  const pivot=new THREE.Group(); pivot.position.set(.2,-.2,-.5); pivot.rotation.set(.4,.2,-.3); pivot.scale.setScalar(.76);
  viewCamera.add(pivot); pivot.add(gun.root);
  const ctx={settings:{quality:'high'},viewCamera,camera};
  const entry={gun,blade:bl}; Object.assign(vm,{ctx,pivot,cur:entry,trail:{update(){}},trailOn:false,hitFlash:0});
  const state=createViewmodelState(); Object.assign(state,{form:'ranged',bladesMax:128,blades:128});
  vm.animateBlade(0,entry,bl,state,2);
  const point=new THREE.Vector3(),projected=new THREE.Vector3();
  for(let k=0;k<128;k++) {
    const i=rig.shardOrder[k]; vm.getBladeLaunchWorld(128-k,128,point);
    rig.shards[i].getWorldPosition(projected); projected.project(viewCamera);
    assert.ok(point.clone().project(camera).distanceTo(new THREE.Vector3(projected.x,projected.y,point.clone().project(camera).z))<1e-6,
      'projectile starts at the actual cell screen position');
    assert.ok(vm.getBladeFragmentWorld(i,new THREE.Vector3()).distanceTo(point)<1e-8);
  }
  state.blades=0; vm.animateBlade(0,entry,bl,state,3);
  const before=vm.getBladeFragmentWorld(0,new THREE.Vector3());
  vm.animateBlade(0,entry,bl,state,4); const after=vm.getBladeFragmentWorld(0,new THREE.Vector3());
  assert.ok(before.distanceTo(after)>.01,'hidden recall destination keeps orbiting');
  assert.equal(rig.energy.orbitGlows.count,0,'empty formation has no phantom glow cells');
  state.form='melee';
  for(let frame=0;frame<30;frame++) vm.animateBlade(1/60,entry,bl,state,4);
  rig.shards.forEach((m,i)=>assert.ok(m.position.distanceTo(rig.shardHome[i].pos)<1e-6));
});

test('continuous ranged feedback has zero camera recoil, shake, hand kick or throwing gesture',()=>{
  const def=getWeaponDef('demon_blade');
  assert.deepEqual(def.recoil,{pitch:0,yaw:0,bias:0,climb:0});
  assert.deepEqual(def.kick,{back:0,rot:0}); assert.equal(def.shake,0);
  let sounds=0;
  const vm=Object.create(Viewmodel.prototype);
  Object.assign(vm,{kickZ:0,kickRot:0,kickRoll:0,throwT:9,hitFlash:0});
  const weapon=Object.create(WeaponSystem.prototype);
  Object.assign(weapon,{ctx:{player:{addRecoil(){throw Error('unexpected recoil');}},
    fx:{shake(){throw Error('unexpected camera shake');}},audio:{play(){sounds++;}}},vm,consecutive:128,aimT:0});
  for(let i=0;i<128;i++) weapon.feedback({element:'none'},{def,recoilMult:100},1);
  assert.equal(vm.kickZ,0); assert.equal(vm.kickRot,0); assert.equal(vm.kickRoll,0); assert.equal(vm.throwT,9);
  assert.equal(sounds,128,'audio feedback remains'); assert.ok(vm.hitFlash>0,'light feedback remains');
});

test('production firing consumes one piece and emits from consecutive tip-to-hilt launch points', () => {
  const gun=model(), emitted=[], launchAmmo=[], events=[], def=getWeaponDef('demon_blade');
  const ctx={time:{now:0},events:{emit:(name)=>events.push(name)},
    player:{eye:new THREE.Vector3(0,0,0),getAimDirection:v=>v.set(0,0,-1)},
    world:{raycast:()=>null,segmentBlocked:()=>false},enemies:{raycast:()=>null},projectiles:{spawn:p=>emitted.push(p)}};
  const vm={getMuzzleWorld:v=>v.set(0,0,-.9),getBladeLaunchWorld:(before,max,out)=>{
    launchAmmo.push(before); return out.copy(gun.blade.shardHome[gun.blade.shardOrder[bladeRankForAmmo(before,max)]].pos);
  }};
  const ballistics=new Ballistics(ctx,vm,()=>.5), system=Object.create(WeaponSystem.prototype), runtime={shots:0};
  Object.assign(system,{ctx,ballistics,rand:()=>.5,runtime:()=>runtime,feedback(){},strikeUntil:-99,
    consecutive:0,lastShotTime:-99,spreadNow:0,bloom:0});
  const inst={uid:9001,defId:'demon_blade',element:'none',mag:128};
  const R={def,magCap:128,damage:2.25,fireRate:128/3,critChance:0,critMult:2,pierce:1,projSpeedMult:1,explosionRadius:0,
    elementChance:0,legendary:null,legendaryValue:0};
  for(let i=0;i<128;i++) {system.shoot(inst,R,false); assert.equal(inst.mag,127-i); assert.equal(emitted.length,i+1);}
  assert.deepEqual(launchAmmo,Array.from({length:128},(_,i)=>128-i));
  assert.equal(events.length,128);
  emitted.forEach((p,i)=>{
    assert.equal(p.damage.base,2.25); assert.equal(p.visual,'blade');
    assert.equal(p.bladeFragmentIndex,gun.blade.shardOrder[i],'projectile is the exact cell removed from the blade');
    if(i>0) assert.ok(p.position.z>emitted[i-1].position.z,'launch site advances along the blade toward the hilt');
    const target=new THREE.Vector3(0,0,-24), expected=target.sub(p.position).normalize();
    assert.ok(p.velocity.clone().normalize().distanceTo(expected)<1e-6,'all pieces converge on the crosshair, no lateral fan');
  });
  assert.deepEqual(Array.from({length:128},(_,i)=>bladeRankForAmmo(128-i,128)),Array.from({length:128},(_,i)=>i));
});

test('24 simultaneous marked targets retain every convergence group inside the dart budget', () => {
  const { fx, batch, flashes } = harness(), targets = Array.from({length:24},(_,i)=>enemy(i));
  targets.forEach(e=>fx.mark(e,.8,BLADE_RUNE_COLOR));
  fx.update(.2,new THREE.Vector3(),batch);
  targets.forEach(e=>fx.impale(e,BLADE_RUNE_COLOR));
  assert.equal(fx.groups.filter(g=>g.active).length,24);
  const darts = fx.darts.filter(d=>d.active);
  assert.equal(darts.length,336);
  assert.equal(new Set(darts.map(d=>d.group)).size,24);
  fx.update(.04,new THREE.Vector3(),batch);
  const ages = darts.map(d=>d.age); fx.update(0,new THREE.Vector3(),batch);
  assert.deepEqual(darts.map(d=>d.age),ages);
  assert.ok([...fx.blades.instanceMatrix.array].every(Number.isFinite));
  fx.update(.2,new THREE.Vector3(),batch); assert.equal(flashes(),24);
  fx.clear(); assert.equal(fx.blades.count,0); assert.ok(fx.darts.every(d=>!d.active));
});

test('single-target skill has 40 converging blades and still arrives in the damage window', () => {
  for (const [q,n] of [['low',20], ['medium',30], ['high',40]]) {
    const {fx,batch,flashes}=harness(q); fx.impale(enemy(0),BLADE_RUNE_COLOR);
    assert.equal(fx.darts.filter(d=>d.active).length,n);
    assert.ok(fx.groups[0].at >= .1 && fx.groups[0].at <= .16);
    fx.update(.17,new THREE.Vector3(),batch); assert.equal(flashes(),1);
  }
});

test('one shot is one smallest cell; the full blade keeps the same continuous DPS and firing duration', () => {
  const def=getWeaponDef('demon_blade');
  for (const element of ['none','fire','shock','corrode']) assert.equal(bladeColor({element},def),BLADE_RUNE_COLOR);
  assert.equal(def.damage,2.25); assert.equal(def.fireRate,128/3); assert.equal(def.mag,128);
  assert.equal(def.mag/def.fireRate,3);
  assert.equal(def.projectile.count,1); assert.equal(def.projectile.fan,0); assert.equal(def.projectile.fanFixed,false);
  assert.equal(def.fireRate * def.projectile.count * def.damage,96);
  assert.deepEqual(def.melee.combo.map(s=>[s.damage,s.duration,s.windup]),[[28,.3,.08],[28,.3,.08],[54,.46,.14]]);
});

const { ProjectileView } = await import(await ts('../src/combat/ProjectileVisuals.ts', {
  '../weapons/DemonBladeModel': modelUrl, '../core/math': mathUrl,
}));
test('pooled flying cells reuse their exact blade geometry without enlarging or grouping them', () => {
  const view = new ProjectileView('blade');
  for (const i of [127,62,0,91]) {
    view.setup(BLADE_RUNE_COLOR,false,.12,i);
    assert.equal(view.bladeCell.geometry,bladeFragmentGeometry(i));
    assert.equal(view.glow.geometry,bladeFragmentGeometry(i));
    assert.ok(Math.abs(view.bladeCell.scale.x*view.root.scale.x-1)<1e-8);
    assert.equal(view.coreMat.vertexColors,true);
    assert.equal(view.bladeCell.geometry.userData.cellCount,1);
  }
});

const visualsUrl = await ts('../src/combat/ProjectileVisuals.ts',{'../weapons/DemonBladeModel':modelUrl,'../core/math':mathUrl});
const flightUrl = await ts('../src/combat/BladeFlight.ts',{'../weapons/DemonBladeModel':modelUrl});
const { BladeFlight, bladeRecallPosition } = await import(flightUrl);

test('recall arcs keep exact real endpoints, distinct upper/lower lanes and finite camera-relative paths', () => {
  const start=new THREE.Vector3(0,2,-12),end=new THREE.Vector3(.2,1.7,-1),out=new THREE.Vector3(),facing=new THREE.Quaternion();
  for(let lane=0;lane<4;lane++) {
    assert.ok(bladeRecallPosition(start,end,lane,0,facing,out).equals(start));
    assert.ok(bladeRecallPosition(start,end,lane,1,facing,out).equals(end));
    for(let k=0;k<=100;k++) assert.ok(bladeRecallPosition(start,end,lane,k/100,facing,out).toArray().every(Number.isFinite));
  }
  const arcs=Array.from({length:4},(_,i)=>bladeRecallPosition(start,end,i,.5,facing,new THREE.Vector3()));
  assert.ok(arcs[0].x<arcs[1].x && arcs[2].x<arcs[3].x);
  assert.ok(arcs[0].y>arcs[2].y && arcs[1].y>arcs[3].y);
  const moved=end.clone().add(new THREE.Vector3(3,1,2));
  assert.ok(bladeRecallPosition(start,moved,0,1,facing,out).equals(moved));
});
const { ProjectileSystem } = await import(await ts('../src/combat/Projectiles.ts',{
  '../core/math':mathUrl,'./ProjectileVisuals':visualsUrl,'./BladeFlight':flightUrl,'../weapons/DemonBladeModel':modelUrl,
  './Blast':dataModule('export function blastPlayer(){} export function lineClear(){return true;}'),
}));
function flightContext() {return {stage:{arena:null},camera:new THREE.PerspectiveCamera(),scene:new THREE.Scene(),
  world:{raycast:()=>null},enemies:{raycast:()=>null,list:[]},settings:{quality:'high'},
  fx:{burst(){},impact(){}},audio:{play(){}},combat:{damageEnemy(){throw new Error('parked fragments must never damage');}}};}
function spawnCell(system,index=0,uid=10,lifetime=.1) {
  system.spawn({owner:'player',position:new THREE.Vector3(0,2,-1),velocity:new THREE.Vector3(0,0,-10),
    radius:.12,lifetime,color:BLADE_RUNE_COLOR,visual:'blade',bladeFragmentIndex:index,bladeWeaponUid:uid,
    damage:{base:2.25,element:'none',source:'weapon'},pierce:0});
}
test('expired real fragments park indefinitely without damage, drift, fade or losing their geometry',()=>{
  const ctx=flightContext(),system=new ProjectileSystem(ctx); spawnCell(system,127);
  system.update(.05); const at=system.active[0].pos.clone(),view=system.active[0].view;
  system.update(.06); assert.equal(system.count,0); assert.equal(system.retainedBladeFragments(10),1);
  const c=system.bladeFlight.cells[0]; assert.equal(c.view,view); assert.equal(c.index,127);
  assert.ok(c.position.distanceTo(at)<1e-9); assert.equal(c.view.bladeCell.geometry,bladeFragmentGeometry(127));
  system.update(120); assert.ok(c.position.distanceTo(at)<1e-9); assert.equal(c.view.root.visible,true);
  assert.ok(Math.abs(c.view.root.scale.x-.12)<1e-9);
  system.clear(); assert.equal(system.retainedBladeFragments(10),0); assert.equal(view.root.visible,false);
});
test('wall contact parks a fragment at the real collision point; recall interrupts still flying damage carriers',()=>{
  const ctx=flightContext(),system=new ProjectileSystem(ctx); spawnCell(system,12);
  const p=system.active[0],point=new THREE.Vector3(1,2,-3);
  system.onWallContact(p,point,new THREE.Vector3(1,0,0));
  assert.ok(system.bladeFlight.cells[0].position.distanceTo(point.clone().add(new THREE.Vector3(.08,0,0)))<1e-9);
  spawnCell(system,11); const view=system.active.at(-1).view;
  system.recallBladeFragments(10,1.4,(i,out)=>out.set(i*.01,1,-.9));
  assert.equal(system.count,0); assert.equal(system.retainedBladeFragments(10),2);
  assert.ok(system.bladeFlight.cells.some(c=>c.view===view));
  for(let i=0;i<180;i++) system.update(1/120);
  assert.equal(system.returnedBladeFragments(10),2); assert.equal(system.retainedBladeFragments(10),0);
});
test('recall preserves 128 exact cells, tracks a moving hand, freezes on pause and lands each once',()=>{
  const ctx=flightContext(),system=new ProjectileSystem(ctx); let offset=0;
  for(let i=0;i<128;i++) spawnCell(system,i,10);
  system.update(.2); assert.equal(system.retainedBladeFragments(10),128);
  const views=system.bladeFlight.cells.map(c=>({index:c.index,view:c.view}));
  system.recallBladeFragments(10,1.4,(i,out)=>out.set(offset+i*.001,1,-.9));
  system.update(.3); const before=system.bladeFlight.cells.map(c=>c.position.clone());
  system.update(0); system.bladeFlight.cells.forEach((c,i)=>assert.ok(c.position.distanceTo(before[i])<1e-10));
  offset=2; for(let i=0;i<180;i++) system.update(1/120);
  assert.equal(system.returnedBladeFragments(10),128); assert.equal(system.retainedBladeFragments(10),0);
  for(const c of views) assert.ok(c.view.root.position.distanceTo(new THREE.Vector3(2+c.index*.001,1,-.9))<1e-6,"every actual cell lands at its moving home");
  assert.equal(system.count,0);
  assert.equal(system.bladeFlight.crown.visible,false);
});
test('cancelled recall parks at current positions; another weapon is untouched and resume cannot duplicate cells',()=>{
  const ctx=flightContext(),system=new ProjectileSystem(ctx);
  spawnCell(system,3,10); spawnCell(system,4,20); system.update(.2);
  const other=system.bladeFlight.cells.find(c=>c.uid===20),otherAt=other.position.clone();
  system.recallBladeFragments(10,1.4,(i,out)=>out.set(0,1,-.9)); system.update(.5);
  const moving=system.bladeFlight.cells.find(c=>c.uid===10),at=moving.position.clone();
  system.cancelBladeRecall(10); system.update(20);
  assert.ok(moving.position.distanceTo(at)<1e-9); assert.ok(other.position.distanceTo(otherAt)<1e-9);
  system.recallBladeFragments(10,1.4,(i,out)=>out.set(1,1,-.9)); system.update(1.5);
  assert.equal(system.returnedBladeFragments(10),1); assert.equal(system.retainedBladeFragments(20),1);
  system.clear(); assert.equal(system.bladeFlight.cells.length,0);
});

test('production reload fills only arrived cells and interruption preserves the partial blade and parked remainder',()=>{
  const ctx=flightContext(),system=new ProjectileSystem(ctx); ctx.projectiles=system;
  ctx.run={flags:{}}; ctx.time={now:0}; ctx.events={emit(){}};
  const inst={uid:10,defId:'demon_blade',mag:0,reserve:0,element:'none'};
  const runtime={form:'ranged',cycleIndex:0};
  for(let i=0;i<128;i++) spawnCell(system,i,10); system.update(.2);
  const weapon=Object.create(WeaponSystem.prototype);
  Object.assign(weapon,{ctx,slots:[inst,null],activeSlot:0,switchTimer:0,volleyLeft:0,morphLeft:0,
    skill:{dashing:false},runtime:()=>runtime,ballistics:{stopBeam(){}},vm:{getBladeFragmentWorld:(i,out)=>out.set(i*.001,1,-.9)},
    magCapacity:()=>128});
  const R={def:getWeaponDef('demon_blade'),magCap:128,reloadTime:1.4};
  assert.equal(weapon.startReload(inst,R),true);
  weapon.updateReload(.15,inst,R); system.update(.15); assert.equal(inst.mag,0);
  for(let i=0;i<95;i++){weapon.updateReload(1/120,inst,R);system.update(1/120);}
  weapon.updateReload(0,inst,R);
  assert.ok(inst.mag>0 && inst.mag<128); const returned=inst.mag;
  assert.equal(returned,system.returnedBladeFragments(10));
  weapon.cancelReload(); system.update(5);
  assert.equal(inst.mag,returned); assert.equal(system.retainedBladeFragments(10),128-returned);
  assert.equal(weapon.startReload(inst,R),true);
  for(let i=0;i<180;i++){weapon.updateReload(1/120,inst,R);system.update(1/120);}
  assert.equal(inst.mag,128); assert.equal(system.retainedBladeFragments(10),0);
});

test('manual recall training keeps an empty blade parked even while fire is held; default gameplay still auto recalls',()=>{
  let reloads=0;
  const weapon=Object.create(WeaponSystem.prototype);
  Object.assign(weapon,{ctx:{run:{flags:{manualBladeRecall:1}},player:{alive:true}},
    reloading:false,switchTimer:0,autoReload:0,fireBuffer:.14,burstLeft:0,volleyLeft:0,
    startReload(){reloads++;}});
  const inst={mag:0,reserve:0},R={def:getWeaponDef('demon_blade')};
  for(let i=0;i<600;i++) weapon.handleEmpty(1/60,inst,R,false,true,true,'auto');
  assert.equal(reloads,0,'neither holding fire nor waiting may recall training fragments');
  assert.equal(weapon.autoReload,0);
  weapon.ctx.run.flags.manualBladeRecall=0;
  weapon.handleEmpty(.3,inst,R,false,false,true,'auto');
  assert.equal(reloads,1,'normal game behavior remains unchanged');
});

function abilityHarness(retained=0) {
  const def=getWeaponDef('demon_blade'),inst={uid:97,defId:'demon_blade',mag:128,element:'none',affixes:[]};
  const hits=[],shots=[],shakes=[],cancelled=[];let recalled=0,blocked=false,haste=0;
  const target={...enemy(0),height:1.8,getHeadCenter(out){return this.getBodyCenter(out);}};
  const R={def,damage:2.25,damageMult:1,critChance:0,critMult:2,meleeElementChance:.35};
  const ctx={time:{now:0},player:{alive:true,position:new THREE.Vector3(),eye:new THREE.Vector3(0,1.65,0),height:1.8,
    yaw:0,pitch:0,stats:{get:()=>haste},getForward:out=>out.set(0,0,-1),getAimDirection:out=>out.set(0,0,-1)},
    world:{raycast:()=>null,segmentBlocked:()=>blocked},enemies:{list:[target],raycast:()=>null},rng:{next:()=>1},
    combat:{damageEnemy(e,req){hits.push({e,req});return {dealt:req.base,killed:false};}},
    fx:{shake(...args){shakes.push(args);},blade:{slashArc(){},slashHit(){}}},audio:{play(){}},events:{emit(){}}};
  const ability=new ProductionBladeSkill(ctx,{resolve:()=>R,interrupt(){},surge:()=>retained,
    fireCell(weapon,point,mult){if(!weapon.mag)return false;shots.push({before:weapon.mag--,point:point.clone(),mult});return true;},
    recall(){recalled++;},cancelSurge(uid){cancelled.push(uid);}});
  const advance=dt=>{ctx.time.now+=dt;ability.update(dt);};
  return {ability,ctx,inst,R,target,hits,shots,shakes,cancelled,advance,recalled:()=>recalled,
    block:()=>{blocked=true;},haste:n=>{haste=n;}};
}

test('melee skill charges, cleaves once then echoes once, and respects range and walls',()=>{
  const h=abilityHarness();assert.equal(h.ability.tryCast(h.inst,h.R,'melee'),true);
  h.advance(.27);assert.equal(h.hits.length,0);h.advance(.01);assert.equal(h.hits.length,1);
  assert.equal(h.hits[0].req.base,100);assert.ok(h.hits[0].req.tags.includes('weaponSkill'));
  h.advance(.02);assert.equal(h.hits.length,1);h.advance(.20);assert.equal(h.hits.length,2);assert.equal(h.hits[1].req.base,50);
  h.advance(.5);assert.equal(h.hits.length,2);assert.equal(h.ability.dashing,false);
  assert.equal(h.ability.tryCast(h.inst,h.R,'melee'),false);
  const wall=abilityHarness();wall.block();wall.ability.tryCast(wall.inst,wall.R,'melee');wall.advance(.6);assert.equal(wall.hits.length,0);
  const escaped=abilityHarness();escaped.ability.tryCast(escaped.inst,escaped.R,'melee');escaped.advance(.28);
  escaped.target.position.z=-20;escaped.advance(.21);assert.equal(escaped.hits.length,1,'escaping the cleave area avoids the echo');
});

test('two form cooldowns are independent; ranged fallback consumes 32 consecutive cells, keeps one aim point and recalls once',()=>{
  const h=abilityHarness();h.ability.tryCast(h.inst,h.R,'melee');h.advance(.9);
  assert.equal(h.ability.tryCast(h.inst,h.R,'ranged'),true,'melee cooldown does not block ranged skill');
  const cd=h.ability.fill(h.R.def.rangedSkill,'ranged').cooldownRemaining;
  h.advance(0);assert.equal(h.ability.fill(h.R.def.rangedSkill,'ranged').cooldownRemaining,cd);
  h.advance(.21);assert.equal(h.shots.length,0);h.advance(.5);assert.equal(h.shots.length,32);
  assert.deepEqual(h.shots.map(s=>s.before),Array.from({length:32},(_,i)=>128-i));
  h.shots.forEach(s=>{assert.equal(s.mult,2);assert.ok(s.point.equals(h.shots[0].point));});
  assert.equal(h.inst.mag,96);h.advance(1);assert.equal(h.recalled(),1);h.advance(2);assert.equal(h.recalled(),1);
  assert.equal(h.shakes.length,2,'ranged skill introduces no camera shake');
  h.ability.resetForRun();assert.equal(h.ability.fill(h.R.def.skill,'melee').cooldownRemaining,0);
  assert.equal(h.ability.fill(h.R.def.rangedSkill,'ranged').cooldownRemaining,0);
});

test('ranged skill uses parked cells before ammunition; death cancels it and haste rescales both cooldowns',()=>{
  const h=abilityHarness(24);h.ability.tryCast(h.inst,h.R,'ranged');h.advance(.8);
  assert.equal(h.shots.length,0);assert.equal(h.inst.mag,128);
  const before=h.ability.fill(h.R.def.rangedSkill,'ranged').cooldownRemaining;
  h.haste(1);h.advance(.1);assert.ok(Math.abs(h.ability.fill(h.R.def.rangedSkill,'ranged').cooldownRemaining-(before/2-.1))<1e-9);
  h.ctx.player.alive=false;h.advance(.1);assert.deepEqual(h.cancelled,[97]);assert.equal(h.ability.dashing,false);assert.equal(h.recalled(),0);
});

test('parked-fragment surge transfers all exact view instances in tip-to-hilt order and interruption conserves every cell',()=>{
  const ctx=flightContext(),system=new ProjectileSystem(ctx),order=model().blade.shardOrder;
  ctx.player={getAimDirection:out=>out.set(0,0,-1)};
  for(const index of order)spawnCell(system,index,98,.02);
  system.update(.03);const views=new Map(system.bladeFlight.cells.map(c=>[c.index,c.view]));
  assert.equal(system.surgeBladeFragments(98,new THREE.Vector3(1,2,-7),{base:4.5,source:'weapon',weaponUid:98},.22),128);
  assert.deepEqual(system.surges.map(c=>c.index),order);
  system.surges.forEach(c=>assert.equal(c.view,views.get(c.index)));
  const positions=system.surges.map(c=>c.position.clone());system.update(0);
  system.surges.forEach((c,i)=>assert.ok(c.position.equals(positions[i])));
  for(let i=0;i<30;i++)system.update(1/120);
  assert.ok(system.count>0);system.cancelBladeSurge(98);
  assert.equal(system.count,0);assert.equal(system.surges.length,0);assert.equal(system.retainedBladeFragments(98),128);
  system.bladeFlight.cells.forEach(c=>assert.equal(c.view,views.get(c.index)));
  system.recallBladeFragments(98,1.4,(index,out)=>out.set(index*.001,2,-1));
  for(let i=0;i<180;i++)system.update(1/120);
  assert.equal(system.returnedBladeFragments(98),128);assert.equal(system.retainedBladeFragments(98),0);
});

test('surged cells deal one real collision hit each and stop at a nearer wall before an enemy',()=>{
  const run=blocked=>{
    const ctx=flightContext(),system=new ProjectileSystem(ctx),hits=[];
    ctx.player={getAimDirection:out=>out.set(0,0,-1)};
    spawnCell(system,12,44,.02);system.update(.03);
    const target={alive:true,untargetable:false};
    ctx.enemies.raycast=(origin,dir,max)=>max>=.03?{enemy:target,distance:.03,point:origin.clone().addScaledVector(dir,.03),headshot:false}:null;
    if(blocked)ctx.world.raycast=(origin,dir,max)=>max>=.01?{distance:.01,point:origin.clone().addScaledVector(dir,.01),normal:new THREE.Vector3(0,0,1),box:null}:null;
    ctx.combat.damageEnemy=(enemy,req)=>hits.push(req);
    system.surgeBladeFragments(44,new THREE.Vector3(0,2,-5),{base:4.5,source:'weapon',weaponUid:44},.02);
    for(let i=0;i<30;i++)system.update(1/120);
    const count=hits.length;for(let i=0;i<30;i++)system.update(1/120);assert.equal(hits.length,count,'parked cells cannot keep damaging');
    assert.equal(system.retainedBladeFragments(44),1);return hits;
  };
  const hits=run(false);assert.equal(hits.length,1);assert.equal(hits[0].base,4.5);assert.ok(hits[0].tags.includes('bladeSurge'));
  assert.equal(run(true).length,0);
});

test('ranged skill point-blank lock keeps finite forward velocity instead of a zero-length aim vector',()=>{
  const specs=[],def=getWeaponDef('demon_blade'),eye=new THREE.Vector3(0,1.6,0);
  const ctx={player:{eye,getAimDirection:out=>out.set(0,0,-1)},world:{segmentBlocked:()=>false},projectiles:{spawn:s=>specs.push(s)}};
  const ballistics=new Ballistics(ctx,{getBladeLaunchWorld:(before,max,out)=>out.set(.3,1.6,-1)},()=>.5);
  ballistics.projectile({uid:88,element:'none'},{def,magCap:128,damage:2.25,critChance:0,critMult:2,elementChance:0,pierce:0,projSpeedMult:1},
    0,false,2,0,0,false,128,eye);
  assert.equal(specs.length,1);assert.equal(specs[0].velocity.length(),45);assert.equal(specs[0].velocity.z,-45);
  assert.ok(specs[0].damage.tags.includes('weaponSkill'));
});

function recallDamageHarness() {
  const ctx=flightContext(),system=new ProjectileSystem(ctx),hits=[];
  const start=new THREE.Vector3(0,2,-12),end=new THREE.Vector3(0,2,-1);
  const index=model().blade.shardOrder[0],targets=[];
  ctx.combat.damageEnemy=(enemy,req)=>{hits.push({enemy,req});};
  ctx.enemies.list=targets;
  ctx.enemies.raycast=(origin,dir,max,exclude)=>{
    let best=null;
    for(const target of targets) {
      if(exclude?.has(target) || !target.alive || target.untargetable)continue;
      const point=new THREE.Ray(origin,dir).intersectSphere(new THREE.Sphere(target.center,.035),new THREE.Vector3());
      if(!point)continue;const distance=point.distanceTo(origin);
      if(distance<=max && (!best || distance<best.distance))best={enemy:target,point,distance,headshot:true};
    }
    return best;
  };
  const addTarget=t=>{
    const target={alive:true,isBoss:true,untargetable:false,
      center:bladeRecallPosition(start,end,0,t,ctx.camera.quaternion,new THREE.Vector3())};
    targets.push(target);return target;
  };
  system.spawn({owner:'player',position:start,velocity:new THREE.Vector3(0,0,-1),radius:.025,lifetime:.001,
    visual:'blade',bladeFragmentIndex:index,bladeWeaponUid:121,color:BLADE_RUNE_COLOR,
    damage:{base:7,element:'shock',elementChance:.4,critMult:3,weaponUid:121,source:'weapon',procDepth:0}});
  const view=system.active[0].view;system.update(.01);
  const recall=()=>system.recallBladeFragments(121,1.4,(_,out)=>out.copy(end));
  return {ctx,system,hits,start,end,view,addTarget,recall};
}

test('each actual recalling cell pierces different enemies once, keeps weapon damage and still arrives exactly once',()=>{
  const h=recallDamageHarness(),a=h.addTarget(.25),b=h.addTarget(.65);
  h.system.update(20);assert.equal(h.hits.length,0,'parked fragments remain inert');
  h.recall();assert.equal(h.system.bladeFlight.cells[0].view,h.view);
  for(let i=0;i<180;i++)h.system.update(1/120);
  assert.deepEqual(h.hits.map(hit=>hit.enemy),[a,b]);
  h.hits.forEach(({req})=>{
    assert.equal(req.base,7);assert.equal(req.element,'shock');assert.equal(req.elementChance,.4);
    assert.equal(req.critMult,3);assert.equal(req.weaponUid,121);assert.equal(req.source,'weapon');
    assert.equal(req.headshot,true);assert.ok(req.tags.includes('bladeRecall'));
    assert.ok(Math.abs(req.direction.length()-1)<1e-9);
  });
  assert.equal(h.system.returnedBladeFragments(121),1);assert.equal(h.system.retainedBladeFragments(121),0);
  assert.ok(h.view.root.position.distanceTo(h.end)<1e-9);h.system.update(10);assert.equal(h.hits.length,2);
});

test('recall samples its curved arc through a long frame and walls prevent damage beyond the obstruction',()=>{
  const fast=recallDamageHarness();fast.addTarget(.5);fast.recall();fast.system.update(1.5);
  assert.equal(fast.hits.length,1,'the enemy on the bowed arc is missed by a straight endpoint chord');
  assert.equal(fast.system.returnedBladeFragments(121),1);
  const blocked=recallDamageHarness();blocked.addTarget(.25);blocked.addTarget(.75);
  blocked.ctx.world.raycast=(origin,dir,max)=>{
    const distance=(-7-origin.z)/dir.z;
    return dir.z>0 && distance>=0 && distance<=max ? {distance,point:origin.clone().addScaledVector(dir,distance),normal:new THREE.Vector3(0,0,-1)} : null;
  };
  blocked.recall();blocked.system.update(1.5);
  assert.equal(blocked.hits.length,1,'target before the wall is hit; target after it is protected');
  assert.equal(blocked.system.returnedBladeFragments(121),1,'occlusion does not lose the recalled fragment');
});

test('paused, waiting and cancelled recalls cause no hits; a new recall resets only its own hit history',()=>{
  const h=recallDamageHarness();h.addTarget(.25);h.recall();
  h.system.update(0);h.system.update(.1);assert.equal(h.hits.length,0,'pre-launch charge is inert');
  h.system.update(.25);assert.equal(h.hits.length,1);
  const at=h.system.bladeFlight.cells[0].position.clone();
  h.system.update(0);assert.equal(h.hits.length,1);
  h.system.cancelBladeRecall(121);h.system.update(10);
  assert.equal(h.hits.length,1);assert.ok(h.system.bladeFlight.cells[0].position.equals(at));
  // Restart from the current position with an enemy directly along the new return path.
  const target=h.ctx.enemies.list[0];target.center.copy(at);
  h.recall();h.system.update(1.5);assert.equal(h.hits.length,2);
  assert.equal(h.system.returnedBladeFragments(121),1);
});
