/** Geometry checks complement the white-model review; they do not grade anatomy. */
import * as THREE from 'three';
import type { HeroRig } from '../ui/heroPreview/heroes/types';
import { GRIP_WRIST } from '../ui/heroPreview/heroes/gripHand';

export function auditHeroGrip(rig: HeroRig): {
  tested:number; intrusions:number; gloveIntrusions:number; gloveDistance:number;
  wrapCoverage:number; gripInsideGlove:boolean; wristError:number; wrist:number[]; examples:number[][];
} {
  rig.root.updateWorldMatrix(true,true);
  const body=rig.root.getObjectByName('SK_Hero_Fox_LOD0')??rig.root.getObjectByName('SK_Hero_Falcon_LOD0');
  if(!body) throw new Error('No authored hero body');
  const fox=body.name.includes('Fox'),inverseRoot=rig.root.matrixWorld.clone().invert(),inverseHand=rig.hand.matrixWorld.clone().invert();
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const owned:THREE.BufferGeometry[]=[],bodyProbes:THREE.Mesh[]=[],gloveProbes:THREE.Mesh[]=[];
  const point=new THREE.Vector3(),local=new THREE.Vector3();
  const handle=new THREE.Vector3(0,fox?-.055:-.058,fox?.035:.032).applyMatrix4(rig.hand.matrixWorld).applyMatrix4(inverseRoot);
  let gloveDistance=Infinity;
  const probe=(mesh:THREE.Mesh,glove:boolean):void=>{
    const geometry=mesh.geometry.clone();owned.push(geometry);
    const src=mesh.geometry.getAttribute('position'),positions=new THREE.Float32BufferAttribute(new Float32Array(src.count*3),3);
    const skinned=mesh as THREE.SkinnedMesh;if(skinned.isSkinnedMesh)skinned.skeleton.update();
    for(let i=0;i<src.count;i++) {
      point.fromBufferAttribute(src,i);if(skinned.isSkinnedMesh)skinned.applyBoneTransform(i,point);
      point.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);positions.setXYZ(i,point.x,point.y,point.z);
      if(glove)gloveDistance=Math.min(gloveDistance,point.distanceTo(handle));
    }
    geometry.setAttribute('position',positions);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const baked=new THREE.Mesh(geometry,material);baked.updateMatrixWorld();
    (glove?gloveProbes:bodyProbes).push(baked);
  };
  probe(body as THREE.SkinnedMesh,false);
  body.traverse(o=>{if(o.name==='hero-grip-sleeve')probe(o as THREE.Mesh,false);});
  rig.root.traverse(o=>{
    const m=o as THREE.Mesh;if(!m.isMesh)return;
    if(m.userData.heroGripSleeve)probe(m,false);
    if(m.userData.heroGripHand)probe(m,true);
  });
  const ray=new THREE.Raycaster(),directions=[new THREE.Vector3(.91,.31,.27).normalize(),new THREE.Vector3(-.25,.39,.88).normalize()];
  // Test each closed hand component separately. A union's nearest face can hide
  // another intersecting finger; source-body rays also catch the sleeve/coat.
  const inside=(p:THREE.Vector3,probes:THREE.Mesh[],clearance:number):boolean=>probes.some(m=>directions.every(d=>{
    ray.set(p,d);ray.far=4;const first=ray.intersectObject(m,false)[0];
    return !!first&&first.distance>clearance&&first.face!.normal.dot(d)>0;
  }));
  const examples:number[][]=[];let tested=0,intrusions=0,gloveIntrusions=0;
  rig.hand.traverse(o=>{
    const m=o as THREE.Mesh;if(!m.isMesh||m.userData.heroGripHand)return;
    for(let n:THREE.Object3D|null=m;n&&n!==rig.hand;n=n.parent)if(!n.visible)return;
    const mats=Array.isArray(m.material)?m.material:[m.material];if(mats.every(m=>!m.visible||m.transparent))return;
    const src=m.geometry.getAttribute('position'),stride=Math.max(1,Math.floor(src.count/300));
    const skinned=m as THREE.SkinnedMesh;if(skinned.isSkinnedMesh)skinned.skeleton.update();
    for(let i=0;i<src.count;i+=stride) {
      point.fromBufferAttribute(src,i);if(skinned.isSkinnedMesh)skinned.applyBoneTransform(i,point);
      point.applyMatrix4(m.matrixWorld);local.copy(point).applyMatrix4(inverseHand);point.applyMatrix4(inverseRoot);tested++;
      if(inside(point,bodyProbes,.004)){intrusions++;if(examples.length<8)examples.push(local.toArray());}
      if(inside(point,gloveProbes,.003)){gloveIntrusions++;if(examples.length<8)examples.push(local.toArray());}
    }
  });
  let wrapCoverage=0;
  for(let i=0;i<8;i++) {
    const angle=i*Math.PI/4,d=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)).transformDirection(rig.hand.matrixWorld).transformDirection(inverseRoot);
    ray.set(handle,d);ray.far=.055;if(ray.intersectObjects(gloveProbes,false).length)wrapCoverage++;
  }
  const gripInsideGlove=inside(handle,gloveProbes,0);
  const wristPoint=GRIP_WRIST.clone().applyMatrix4(rig.hand.matrixWorld),wrist=rig.hand.parent!.getWorldPosition(new THREE.Vector3());
  const wristError=wristPoint.distanceTo(wrist);wrist.applyMatrix4(inverseRoot);
  owned.forEach(g=>g.dispose());material.dispose();
  return {tested,intrusions,gloveIntrusions,gloveDistance,wrapCoverage,gripInsideGlove,wristError,wrist:wrist.toArray(),examples};
}
