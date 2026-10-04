import * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { LevelLayout, LayoutBox } from './LevelTypes';
import { whiteboxPoint } from './WhiteboxGen';

/** Technical scale/occlusion blockout only. No environment art is constructed here. */
export class WhiteboxView {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly oldBackground: THREE.Scene['background'];
  constructor(private readonly ctx: GameContext, L: LevelLayout) {
    this.group.name = 'whitebox-layout';
    this.oldBackground = ctx.scene.background;
    ctx.scene.background = new THREE.Color(0xc8d4df);
    ctx.scene.fog = null;
    const meta = L.whitebox!;
    const plan = meta.plan;
    const neutral = new THREE.MeshStandardMaterial({ color: 0x91a1b0, roughness: 1 });
    const cover = new THREE.MeshStandardMaterial({ color: 0xbb9874, roughness: 1 });
    const floor = new THREE.MeshStandardMaterial({ color: 0xe4e9e8, roughness: 1 });
    const cube = new THREE.BoxGeometry(1, 1, 1);
    this.owned.push(neutral, cover, floor, cube);
    const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), center = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const boxes = (items: readonly Pick<LayoutBox,'minX'|'maxX'|'minY'|'maxY'|'minZ'|'maxZ'>[], mat: THREE.Material, name: string): void => {
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(cube, mat, items.length); mesh.name = name;
      items.forEach((b,i) => {
        center.set((b.minX+b.maxX)/2,(b.minY+b.maxY)/2,(b.minZ+b.maxZ)/2);
        scale.set(b.maxX-b.minX,b.maxY-b.minY,b.maxZ-b.minZ);
        mesh.setMatrixAt(i,matrix.compose(center,rotation,scale));
      });
      mesh.computeBoundingSphere(); this.group.add(mesh); this.owned.push(mesh);
    };
    boxes(L.boxes.filter(b=>b.tag==='whitebox-wall'),neutral,'whitebox-walls');
    boxes(L.boxes.filter(b=>b.tag==='whitebox-cover'),cover,'whitebox-solid-cover');
    boxes(meta.floorRects.map(b=>({...b,minY:L.floorY-.12,maxY:L.floorY})),floor,'whitebox-floor');

    const hemi = new THREE.HemisphereLight(0xffffff,0x788798,2.5);
    const sun = new THREE.DirectionalLight(0xfff5e5,2.1); sun.position.set(-30,75,24);
    this.group.add(hemi,sun); this.owned.push(sun);
    // One world-space scale grid; wall volumes naturally occlude it.
    const size = Math.ceil(Math.max(plan.bounds[0],plan.bounds[1])/10)*10;
    const grid = new THREE.GridHelper(size,size,0x637f90,0xa8bac2); grid.position.y=L.floorY+.018;
    this.group.add(grid); this.owned.push(grid.geometry);
    if (Array.isArray(grid.material)) this.owned.push(...grid.material); else this.owned.push(grid.material);

    const routeMats = {
      main: new THREE.LineBasicMaterial({color:0x13769c,depthWrite:false}),
      optional: new THREE.LineBasicMaterial({color:0x39836b,depthWrite:false}),
      return: new THREE.LineBasicMaterial({color:0x88649a,depthWrite:false}),
    };
    this.owned.push(...Object.values(routeMats));
    for (const passage of plan.passages) {
      const geo = new THREE.BufferGeometry().setFromPoints(passage.points.map(p=>{const q=whiteboxPoint(plan,p);return new THREE.Vector3(q.x,L.floorY+.045,q.z);}));
      this.owned.push(geo); this.group.add(new THREE.Line(geo,routeMats[passage.kind]));
    }
    for (const room of plan.rooms) {
      const p=whiteboxPoint(plan,room.labelAt);
      this.label(room.label,p.x,L.floorY+.12,p.z,0x355565,Math.max(8,room.label.length*1.25),true);
    }
    const marker = (at: readonly number[], label: string, color: number): void => {
      const p=whiteboxPoint(plan,at as [number,number]);
      const geo=new THREE.RingGeometry(.9,1.08,32);geo.rotateX(-Math.PI/2);
      const mat=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthWrite:false});
      const ring=new THREE.Mesh(geo,mat);ring.position.set(p.x,L.floorY+.07,p.z);this.group.add(ring);this.owned.push(geo,mat);
      this.label(label,p.x,L.floorY+2.8,p.z,color,Math.max(3.5,label.length*.8));
    };
    marker(plan.entry.at,'入口 S',0x247d76);marker(plan.exit.at,'出口 X',0x435ead);
    for(const encounter of plan.encounters) marker(encounter.at,encounter.id.length>2?'首领':encounter.id,0xad4444);
    for(const reward of plan.rewards) marker(reward.at,'物资',0xa68124);
  }
  private label(text: string,x:number,y:number,z:number,color:number,width:number,onFloor=false):void {
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=128;
    const c=canvas.getContext('2d')!;
    c.fillStyle='#f3f7f3';c.globalAlpha=.92;c.fillRect(0,0,768,128);c.globalAlpha=1;
    c.strokeStyle='#'+color.toString(16).padStart(6,'0');c.lineWidth=6;c.strokeRect(3,3,762,122);
    c.fillStyle=c.strokeStyle;c.font='600 58px "Microsoft YaHei", sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,384,68,730);
    const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;this.owned.push(tex);
    if(onFloor){
      const geo=new THREE.PlaneGeometry(width,width/6);geo.rotateX(-Math.PI/2);
      const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false});
      const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);this.group.add(mesh);this.owned.push(geo,mat);
    }else{
      const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false});const sprite=new THREE.Sprite(mat);
      sprite.position.set(x,y,z);sprite.scale.set(width,width/6,1);this.group.add(sprite);this.owned.push(mat);
    }
  }
  dispose():void {
    this.group.removeFromParent();for(const item of this.owned)item.dispose();this.owned.length=0;this.group.clear();
    this.ctx.scene.background=this.oldBackground;
  }
}
