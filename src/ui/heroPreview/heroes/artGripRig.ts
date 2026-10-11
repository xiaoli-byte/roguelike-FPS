/** Anatomical arm and hand correction for generated hero bodies. */
import * as THREE from 'three';
import type { HeroRig } from './types';
import { buildGripHand, GRIP_WRIST } from './gripHand';
const V=(p: readonly number[]): THREE.Vector3=>new THREE.Vector3().fromArray(p);
const PROFILES: Record<string, { shoulder:number[]; elbow:number[]; wrist:number[]; idle:number[]; raised:number[]; cut:number }> = {
  SK_Hero_Fox: {shoulder:[-.22,1.325,.005],elbow:[-.285,1.085,.015],wrist:[-.318,.845,.07],idle:[-.335,.865,.16],raised:[-.34,1.095,.33],cut:.845},
  SK_Hero_Falcon: {shoulder:[-.245,1.35,.005],elbow:[-.272,1.105,.015],wrist:[-.286,.855,.045],idle:[-.335,.895,.18],raised:[-.35,1.13,.365],cut:.845},
};
export interface HeroArtGrip {
  hand: THREE.Object3D; materials: THREE.Material[];
  update: (dt:number,t:number)=>void; playIntro: ()=>void; dispose: ()=>void;
}
/** The weapon and fingers share the wrist frame; sleeve weights follow a
 * three-joint IK chain. Bear uses its existing rig and hand unchanged. */
export function artGripSocket(rig: HeroRig, assetId: string, lod: THREE.LOD): HeroArtGrip | null {
  const profile=PROFILES[assetId],torso=rig.artControls?.rightArm?.parent;
  if(!profile||!torso) return null;
  const fox=assetId==='SK_Hero_Fox';
  rig.root.updateWorldMatrix(true,true);
  const inverseRoot=rig.root.matrixWorld.clone().invert();
  const bindTorso=new THREE.Matrix4().multiplyMatrices(inverseRoot,torso.matrixWorld),invTorso=bindTorso.clone().invert();
  const s=V(profile.shoulder).applyMatrix4(invTorso),e=V(profile.elbow).applyMatrix4(invTorso),w=V(profile.wrist).applyMatrix4(invTorso);
  const upper=new THREE.Bone();upper.name='hero-grip-upper';upper.position.copy(s);torso.add(upper);
  const lower=new THREE.Bone();lower.name='hero-grip-forearm';lower.position.copy(e).sub(s);upper.add(lower);
  const wrist=new THREE.Bone();wrist.name='hero-grip-wrist';wrist.position.copy(w).sub(e);lower.add(wrist);
  const hand=new THREE.Group();hand.name='hero-art-grip';hand.position.copy(GRIP_WRIST).negate();wrist.add(hand);
  const glove=buildGripHand(fox);hand.add(glove.root);
  rig.root.updateWorldMatrix(true,true);
  const armBones=[upper,lower,wrist],inverses=armBones.map(b=>new THREE.Matrix4().multiplyMatrices(inverseRoot,b.matrixWorld).invert());
  const geometries:THREE.BufferGeometry[]=[],skeletons:THREE.Skeleton[]=[];
  const bindS=V(profile.shoulder),bindE=V(profile.elbow),bindW=V(profile.wrist);
  const point=new THREE.Vector3(),closest=new THREE.Vector3(),sample=new THREE.Vector3();
  const segmentDistance=(p:THREE.Vector3,a:THREE.Vector3,b:THREE.Vector3):number=>{
    closest.copy(b).sub(a);const t=THREE.MathUtils.clamp(point.copy(p).sub(a).dot(closest)/closest.lengthSq(),0,1);
    return closest.multiplyScalar(t).add(a).distanceTo(p);
  };
  const inHand=(x:number,y:number,z:number):boolean=>y<profile.cut&&y>.65&&x<(fox?-.205:-.215)&&x>-.39&&z>-.065&&z<.175;
  // Generated sleeves are fused to nearby coat faces. Separate their surfaces
  // before reweighting, so no triangle bridges a moving arm to a stationary coat.
  const sleeveSurface=(x:number,y:number,z:number):boolean=>{
    sample.set(x,y,z);
    const dist=Math.min(segmentDistance(sample,bindS,bindE),segmentDistance(sample,bindE,bindW));
    return x<(y<1.04?(fox?-.235:-.24):-.18)&&y>=profile.cut&&y<profile.shoulder[1]+.055&&z>-.12&&z<.17&&dist<.105;
  };
  const sleeves:THREE.SkinnedMesh[]=[];
  for(const level of lod.levels) {
    const mesh=level.object as THREE.SkinnedMesh,geometry=mesh.geometry.clone();geometries.push(geometry);mesh.geometry=geometry;
    const positions=geometry.getAttribute('position'),oldIndices=geometry.getAttribute('skinIndex');
    const torsoIndex=mesh.skeleton.bones.indexOf(torso as THREE.Bone);
    const originalArmBones=new Set(mesh.skeleton.bones.map((b,i)=>{
      for(let parent:THREE.Object3D|null=b;parent;parent=parent.parent) if(parent===rig.artControls!.rightArm) return i;
      return -1;
    }));
    const indices=new THREE.Uint16BufferAttribute(new Uint16Array(positions.count*4),4),weights=new THREE.Float32BufferAttribute(new Float32Array(positions.count*4),4),first=mesh.skeleton.bones.length;
    for(let i=0;i<positions.count;i++) {
      const y=positions.getY(i);
      const elbowBlend=THREE.MathUtils.smoothstep(y,profile.elbow[1]-.055,profile.elbow[1]+.055);
      const retained=THREE.MathUtils.smoothstep(y,profile.shoulder[1]-.10,profile.shoulder[1]+.03);
      indices.setXYZW(i,first,first+1,first+2,torsoIndex);
      weights.setXYZW(i,elbowBlend*(1-retained),(1-elbowBlend)*(1-retained),0,retained);
    }
    const sleeveGeometry=geometry.clone();geometries.push(sleeveGeometry);
    sleeveGeometry.setAttribute('skinIndex',indices);sleeveGeometry.setAttribute('skinWeight',weights);
    const sleevePositions=sleeveGeometry.getAttribute('position');
    for(let i=0;i<positions.count;i++) {
      // Co-located UV seam vertices receive the same anatomical weights.
      // Any remaining coat faces must not follow the superseded arm chain.
      for(let k=0;k<4;k++) if(originalArmBones.has(oldIndices.getComponent(i,k))) oldIndices.setComponent(i,k,torsoIndex);
      if(sleevePositions.getY(i)<profile.cut) sleevePositions.setY(i,profile.cut);
    }
    const sourceIndex=geometry.index!,kept:number[]=[],armFaces:number[]=[];
    for(let i=0;i<sourceIndex.count;i+=3) {
      const a=sourceIndex.getX(i),b=sourceIndex.getX(i+1),c=sourceIndex.getX(i+2);
      const x=(positions.getX(a)+positions.getX(b)+positions.getX(c))/3,y=(positions.getY(a)+positions.getY(b)+positions.getY(c))/3,z=(positions.getZ(a)+positions.getZ(b)+positions.getZ(c))/3;
      if(inHand(x,y,z)) continue;
      if(sleeveSurface(x,y,z)) armFaces.push(a,b,c);
      else kept.push(a,b,c);
    }
    geometry.setIndex(kept);geometry.clearGroups();
    sleeveGeometry.setIndex(armFaces);sleeveGeometry.clearGroups();
    sleeveGeometry.computeVertexNormals();
    const skeleton=new THREE.Skeleton([...mesh.skeleton.bones,...armBones],[...mesh.skeleton.boneInverses,...inverses.map(m=>m.clone())]);
    skeletons.push(skeleton);mesh.bind(skeleton,new THREE.Matrix4());
    const sleeve=new THREE.SkinnedMesh(sleeveGeometry,mesh.material);sleeve.name='hero-grip-sleeve';sleeve.castShadow=true;sleeve.frustumCulled=false;
    sleeve.bind(skeleton,new THREE.Matrix4());mesh.add(sleeve);sleeves.push(sleeve);
  }
  const upperRest=lower.position.clone(),lowerRest=wrist.position.clone(),l1=upperRest.length(),l2=lowerRest.length();
  // Closed inner sleeves and a shaped cuff cover the cut boundaries of the
  // fused source surface. They follow the limb, without inheriting wrist twist.
  const fillLimb=(parent:THREE.Object3D,axis:THREE.Vector3,top:number,bottom:number,length:number,progress:number):void=>{
    const geo=new THREE.CylinderGeometry(top,bottom,length,10,1);geometries.push(geo);
    const part=new THREE.Mesh(geo,glove.materials[1]);part.castShadow=true;part.userData.heroGripSleeve=true;
    part.position.copy(axis).multiplyScalar(progress);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axis.clone().normalize());parent.add(part);
  };
  fillLimb(upper,upperRest,.042,.056,l1*.92,.50);
  fillLimb(lower,lowerRest,.032,.042,l2*.92,.50);
  fillLimb(lower,lowerRest,.045,.054,.078,1-.025/l2);
  const idle=V(profile.idle).applyMatrix4(invTorso),raised=V(profile.raised).applyMatrix4(invTorso);
  const invRotation=new THREE.Quaternion().setFromRotationMatrix(bindTorso).invert();
  const gunBasis=(forward:THREE.Vector3):THREE.Quaternion=>{
    const z=forward.normalize().negate(),x=new THREE.Vector3(0,1,0).cross(z).normalize(),y=z.clone().cross(x).normalize();
    return invRotation.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z)));
  };
  const idleQ=gunBasis(new THREE.Vector3(-.08,-.78,.63)),raisedQ=gunBasis(new THREE.Vector3(-.12,-.22,1));
  const target=new THREE.Vector3(),dir=new THREE.Vector3(),pole=new THREE.Vector3(),bend=new THREE.Vector3(),elbow=new THREE.Vector3(),upperDir=new THREE.Vector3(),lowerDir=new THREE.Vector3();
  const gunQ=new THREE.Quaternion(),lowerQ=new THREE.Quaternion(),inverseUpper=new THREE.Quaternion(),restUpperDir=upperRest.clone().normalize(),restLowerDir=lowerRest.clone().normalize();
  let intro=-1,blend=0;
  const update=(dt:number,t:number):void=>{
    if(intro>=0) {intro+=dt;if(intro>1.5) intro=-1;}
    blend=THREE.MathUtils.damp(blend,intro>=.15&&intro<1.0?1:0,10,dt);
    target.lerpVectors(idle,raised,blend);target.y+=.003*Math.sin(t*1.8);
    dir.copy(target).sub(s);const d=THREE.MathUtils.clamp(dir.length(),Math.abs(l1-l2)+.01,l1+l2-.008);dir.normalize();target.copy(s).addScaledVector(dir,d);
    pole.set(-1,-.15,-.8).applyQuaternion(invRotation);bend.copy(pole).addScaledVector(dir,-pole.dot(dir)).normalize();
    const along=(l1*l1-l2*l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    elbow.copy(s).addScaledVector(dir,along).addScaledVector(bend,height);
    upperDir.copy(elbow).sub(s).normalize();lowerDir.copy(target).sub(elbow).normalize();
    upper.quaternion.setFromUnitVectors(restUpperDir,upperDir);lowerQ.setFromUnitVectors(restLowerDir,lowerDir);inverseUpper.copy(upper.quaternion).invert();lower.quaternion.copy(inverseUpper).multiply(lowerQ);
    gunQ.slerpQuaternions(idleQ,raisedQ,blend);wrist.quaternion.copy(lowerQ).invert().multiply(gunQ);
    rig.root.updateWorldMatrix(true,true);
  };
  update(0,0);
  return {hand,materials:glove.materials,update,playIntro:()=>{intro=0;},dispose:()=>{
    sleeves.forEach(s=>s.removeFromParent());geometries.forEach(g=>g.dispose());skeletons.forEach(s=>s.dispose());glove.dispose();upper.removeFromParent();
  }};
}
