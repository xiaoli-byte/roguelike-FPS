/** Actual published hero meshes, rendered together for art review. Dev only. */
import * as THREE from 'three';
import { AssetLibrary } from '../assets/AssetLibrary';
import { buildHeroModel, buildProceduralHero, heroAsset } from '../ui/heroPreview/heroes';
import { HEROES } from '../player/Heroes';
import { buildGunModel } from '../weapons/WeaponModels';
import { getWeaponDef } from '../weapons/WeaponDefs';
import { heroWhiteReview } from './heroWhiteReview';

const canvas = document.querySelector<HTMLCanvasElement>('#gallery')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setScissorTest(true);
const params = new URLSearchParams(location.search);
const heroIds = params.has('hero') ? [params.get('hero')!].filter(id => ['fox','bear','falcon'].includes(id)) : ['fox','bear','falcon'];
const white = params.get('white') === '1';
const mode = document.querySelector<HTMLAnchorElement>('#review-mode')!;
mode.textContent = white ? '查看贴图' : '切换白模';
const modeParams=new URLSearchParams(params);modeParams.delete('material');
if(white)modeParams.delete('white');else modeParams.set('white','1');
mode.href=`?${modeParams}`;
if (white) document.querySelector('header p')!.textContent = params.get('legacy') === '1'
  ? '旧版模型对比 · 程序化骨架'
  : 'Tripo 原生骨骼 · 白模持枪检视';
else document.querySelector('header p')!.textContent=params.get('legacy') === '1'
  ? '旧版程序化模型对比' : 'Tripo 原生骨骼 · 发布资产（LOD0 · BC/ORM 贴图）';
await AssetLibrary.preload();
const panels = await Promise.all(heroIds.map(async id => {
  const hero = HEROES.find(h => h.id === id)!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x191b23);
  scene.add(new THREE.HemisphereLight(0xffefd6, 0x263044, 1.8));
  const key = new THREE.DirectionalLight(0xffead5, 2.4);
  key.position.set(-2, 4, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0x8da9d4, 1.5);
  fill.position.set(3, 2, -2); scene.add(fill);
  if (params.get('legacy') !== '1' && !heroAsset(id)) console.warn(`[heroGallery] ${id}: 发布资产未加载，显示程序化回退模型`);
  const rig = params.get('legacy') === '1' ? buildProceduralHero(id) : buildHeroModel(id);
  rig.root.rotation.y = Number(params.get('angle') ?? .32);
  const weapon = getWeaponDef(hero.startingWeapon);
  rig.hand.add(buildGunModel(weapon.id, 0, weapon.element).root);
  scene.add(rig.root);
  const prepareWhite = white ? heroWhiteReview(scene, rig.root) : null;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x262b36, roughness: 0.95 }));
  scene.add(floor);
  for (let t = 1 / 60; t <= 1; t += 1 / 60) rig.update(1 / 60, t);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  camera.position.set(0, 1.2, 4.8); camera.lookAt(0, 1.05, 0);
  if (params.get('grip') === '1') {
    camera.position.set(0, id === 'bear' ? 1.48 : 1.20, 1.65);
    camera.lookAt(0,id === 'bear' ? 1.43 : 1.12,.3);
  }
  return { scene, camera, rig, prepareWhite, elapsed: 1 };
}));
function render(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const aspect=w/panels.length/h;
  const fitDistance=Math.max(4.8,...panels.map(({rig})=>new THREE.Box3().setFromObject(rig.root,true)
    .getSize(new THREE.Vector3()).x/(2*Math.tan(Math.PI/12)*aspect)*1.12));
  panels.forEach(({ scene, camera, rig, prepareWhite }, i) => {
    prepareWhite?.();
    camera.aspect = w / panels.length / h;
    if(params.get('grip')!=='1') {
      const box=new THREE.Box3().setFromObject(rig.root,true);
      const center=box.getCenter(new THREE.Vector3());
      camera.position.set(center.x,1.2,fitDistance);camera.lookAt(center.x,1.05,0);
    } else {
      const center=new THREE.Box3().setFromObject(rig.hand,true).getCenter(new THREE.Vector3());
      const distance=rig.height>2?2.3:1.7;
      camera.position.set(center.x,center.y+.06,center.z+distance);camera.lookAt(center);
    }
    camera.updateProjectionMatrix();
    renderer.setViewport(i * w / panels.length, 0, w / panels.length, h);
    renderer.setScissor(i * w / panels.length, 0, w / panels.length, h);
    renderer.render(scene, camera);
  });
}
render();
const viewButton=document.querySelector<HTMLButtonElement>('#review-view')!;
const angles=[.32,1.2,-1.2,Math.PI];
let viewIndex=0;
viewButton.addEventListener('click',()=>{
  viewIndex=(viewIndex+1)%angles.length;
  for(const panel of panels) panel.rig.root.rotation.y=angles[viewIndex];
  viewButton.textContent=['转到右侧','转到左侧','转到背面','回到正面'][viewIndex];
  render();
});
const poseButton = document.querySelector<HTMLButtonElement>('#review-pose')!;
let raised = false;
function switchPose(): void {
  raised = !raised;
  for (const panel of panels) {
    if (raised) panel.rig.playIntro();
    const frames = raised ? 39 : 90;
    for (let i = 0; i < frames; i++) {
      panel.elapsed += 1 / 60;
      panel.rig.update(1 / 60, panel.elapsed);
    }
  }
  poseButton.textContent = raised ? '回到待机' : '查看抬枪';
  poseButton.setAttribute('aria-pressed', String(raised));
  render();
}
poseButton.addEventListener('click', switchPose);
if (params.get('pose') === 'raised') switchPose();
window.addEventListener('resize', render);
(window as unknown as { __heroGallery: unknown }).__heroGallery = { panels, renderer, render };
