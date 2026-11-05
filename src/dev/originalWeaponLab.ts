import * as THREE from 'three';
import { OriginalWeaponLibrary } from '../assets/OriginalWeaponLibrary';
import { OriginalWeaponView } from '../weapons/OriginalWeaponView';
import type { ViewmodelState } from '../weapons/Viewmodel';

const params = new URLSearchParams(location.search);
const weapon = params.get('weapon') ?? 'smg';
const status = document.getElementById('status')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202633);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 100);
scene.add(new THREE.HemisphereLight(0xdceaff, 0x303044, 1.8));
const key = new THREE.DirectionalLight(0xffe8c3, 2.4);
key.position.set(3, 5, 4);
scene.add(key);
const state: ViewmodelState = {
  aimT: 0, lowerT: 0, reloading: false, reloadP: 0, shellMode: false, firstShell: true,
  firing: false, spin: 0, scoped: false, sinceShot: 99, cock: 1, elementHint: null, cycleIndex: -1, blade: null,
};
const asset = await OriginalWeaponLibrary.get(weapon);
if (!asset?.gltf) throw new Error(`Unity 原生武器 ${weapon} 未加载`);
const view = new OriginalWeaponView(asset, renderer, 1.7);
view.root.position.copy(view.hip);
scene.add(view.root);
status.textContent = `${weapon} · Unity 原生双手与动画\n空格：开火　R：换弹　A：瞄准`;
let reloadingAt = -1;
addEventListener('keydown', (event) => {
  if (event.code === 'Space') view.fire();
  if (event.code === 'KeyR') reloadingAt = 0;
  if (event.code === 'KeyA') state.aimT = state.aimT ? 0 : 1;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (reloadingAt >= 0) {
    reloadingAt += dt;
    state.reloading = true;
    state.reloadP = Math.min(1, reloadingAt / 1.7);
    if (state.reloadP >= 1) {
      state.reloading = false;
      reloadingAt = -1;
    }
  }
  view.root.position.lerpVectors(view.hip, view.aim, state.aimT);
  if (params.get('anim') !== '0') view.update(dt, state);
  renderer.render(scene, camera);
});
document.title = 'done';
