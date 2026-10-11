/** Preview an unpublished hero GLB against the real display animations. Dev only. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { AssetEntry, LoadedAsset } from '../assets/AssetLibrary';
import { buildFoxModel } from '../ui/heroPreview/heroes/fox';
import { buildBearModel } from '../ui/heroPreview/heroes/bear';
import { buildFalconModel } from '../ui/heroPreview/heroes/falcon';
import { withHeroArt } from '../ui/heroPreview/heroes/artBody';
import type { HeroRig } from '../ui/heroPreview/heroes/types';

export async function replaceHeroCandidate(hero: 'fox' | 'bear' | 'falcon', version: number): Promise<void> {
  const id = `SK_Hero_${hero[0].toUpperCase()}${hero.slice(1)}`;
  const base = `/art/source/characters/${id}`;
  const meta = await (await fetch(`${base}/00_blockout/BO_${id}_v001.json`)).json();
  const draco = new DRACOLoader();
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(
    `${base}/04_export/${id}_v${String(version).padStart(3, '0')}.glb`);
  draco.dispose();
  const lods: THREE.Mesh[] = [];
  gltf.scene.traverse(o => {
    const match = /_LOD(\d+)$/.exec(o.name);
    if ((o as THREE.Mesh).isMesh && match) lods[Number(match[1])] = o as THREE.Mesh;
  });
  const entry: AssetEntry = { url: '', kind: 'skeletal', class: 'hero_display', bind: {source:'hero', id:hero},
    lodDistance: [0,10,24], keepGlow: 'all', bounds: meta.bounds, sha256: '',
    rig: { mode:'parts', joints:meta.joints.map((j: {name:string; restLocal:number[]}) => [j.name,j.restLocal]), keep:[] } };
  const asset: LoadedAsset = {id, entry, gltf, lods};
  const rig = withHeroArt(({fox:buildFoxModel, bear:buildBearModel, falcon:buildFalconModel})[hero](), asset);
  const lab = (window as unknown as {__lab:{rig:HeroRig; scene:THREE.Scene; render:()=>void}}).__lab;
  const gun = new URLSearchParams(location.search).get('nogun') !== '1' ? lab.rig.hand.children.at(-1) : undefined;
  gun?.removeFromParent();
  lab.rig.root.removeFromParent();
  lab.rig.dispose();
  if (gun) rig.hand.add(gun);
  const params = new URLSearchParams(location.search);
  let t = 0;
  const advance = (end:number):void => { while(t<end) { t+=1/60; rig.update(1/60,t); } };
  advance(Number(params.get('t') ?? 1));
  if (params.has('intro')) { rig.playIntro(); advance(t+Number(params.get('intro'))); }
  lab.rig = rig;
  lab.scene.add(rig.root);
  lab.render();
}
