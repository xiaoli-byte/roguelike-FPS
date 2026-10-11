import * as THREE from 'three';
import type { DamageRequest, GameContext, IEnemy } from '../core/types';
import { bladeFragmentOrder, BLADE_SHARDS } from '../weapons/DemonBladeModel';
import type { ProjectileView, Trail } from './ProjectileVisuals';

type Target = (index: number, out: THREE.Vector3) => THREE.Vector3;
interface Cell {
  uid: number; index: number; view: ProjectileView; position: THREE.Vector3; start: THREE.Vector3;
  returning: boolean; elapsed: number; delay: number; duration: number; trail: Trail | null; launched: boolean;
  damage: DamageRequest | null; radius: number; hitSet: Set<IEnemy>; damageBlocked: boolean;
}
interface Recall { returned: number; elapsed: number; duration: number; target: Target; indices: number[] }
const _end = new THREE.Vector3(), _dir = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _prev = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
const _contactFrom = new THREE.Vector3(), _contactTo = new THREE.Vector3();
const ringGeo = new THREE.RingGeometry(.965, 1.025, 192);

/** Four ordered arc lanes, with exact stationary launch and moving formation endpoints. */
export function bladeRecallPosition(start: THREE.Vector3, end: THREE.Vector3, rank: number,
  t: number, facing: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  if (t <= 0) return out.copy(start);
  if (t >= 1) return out.copy(end);
  const lane = rank % 4, horizontal = lane % 2 ? 1 : -1, vertical = lane < 2 ? 1 : -1;
  _side.set(1,0,0).applyQuaternion(facing); _up.set(0,1,0).applyQuaternion(facing);
  const distance = start.distanceTo(end), bend = Math.min(2.4, .25 + distance * .10);
  _c1.lerpVectors(start,end,.30).addScaledVector(_side,horizontal*bend).addScaledVector(_up,vertical*bend*.65);
  _c2.lerpVectors(start,end,.84).addScaledVector(_side,horizontal*bend*.55).addScaledVector(_up,vertical*bend*.45);
  const u = t*t*(3-2*t), v = 1-u;
  return out.copy(start).multiplyScalar(v*v*v).addScaledVector(_c1,3*v*v*u)
    .addScaledVector(_c2,3*v*u*u).addScaledVector(end,u*u*u);
}

/** Actual cells stay inert while parked; returning cells sweep their curved path for damage. */
export class BladeFlight {
  readonly cells: Cell[] = [];
  private readonly recalls = new Map<number, Recall>();
  private readonly crown = new THREE.Group();
  private readonly rings: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>[] = [];
  private readonly filaments: THREE.LineSegments;
  private readonly filamentPositions = new THREE.BufferAttribute(new Float32Array(BLADE_SHARDS*6),3).setUsage(THREE.DynamicDrawUsage);
  private time = 0;
  constructor(private readonly ctx: GameContext, parent: THREE.Group,
    private readonly releaseView: (view: ProjectileView) => void,
    private readonly acquireTrail: () => Trail, private readonly releaseTrail: (trail: Trail) => void,
    private readonly recallContact?: (cell: Cell, from: THREE.Vector3, to: THREE.Vector3) => boolean) {
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms:{uTime:{value:0},uPower:{value:0},uLane:{value:i},uWave:{value:i===4?1:0}},
        vertexShader:`varying vec2 vPoint;void main(){vPoint=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`varying vec2 vPoint;uniform float uTime,uPower,uLane,uWave;
          void main(){float angle=atan(vPoint.y,vPoint.x);float radius=length(vPoint);
            float sweep=pow(.5+.5*cos(angle*4.-uTime*9.+uLane*1.7),12.);
            float ticks=pow(.5+.5*cos(angle*32.+uLane*.3),18.);
            float broken=smoothstep(.10,.24,fract(angle/6.2831853*8.+uTime*.17));
            float rim=exp(-pow((radius-.995)/.016,2.));
            float power=mix((.13+.6*sweep+.22*ticks)*broken, .55,uWave)*rim*uPower;
            gl_FragColor=vec4(mix(vec3(.42,.09,1.),vec3(.91,.81,1.),sweep),power);
            #include <colorspace_fragment>
          }`,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
      });
      const ring = new THREE.Mesh(ringGeo, mat); this.crown.add(ring); this.rings.push(ring);
    }
    this.crown.visible = false; parent.add(this.crown);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',this.filamentPositions);geo.setDrawRange(0,0);
    this.filaments=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0xf0e7ff,transparent:true,
      opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    this.filaments.frustumCulled=false;this.filaments.visible=false;parent.add(this.filaments);
  }
  park(uid: number, index: number, view: ProjectileView, at: THREE.Vector3,
    damage: DamageRequest | null = null, radius = .055): void {
    const old = this.cells.find(c => c.uid === uid && c.index === index);
    if (old) this.remove(old);
    view.root.position.copy(at); view.root.visible = true;
    view.setBladeRecallGlow(false);
    this.cells.push({ uid, index, view, position: at.clone(), start: at.clone(), returning: false,
      elapsed: 0, delay: 0, duration: 1, trail: null, launched:false,
      damage: damage ? {...damage, tags: damage.tags?.slice()} : null, radius, hitSet: new Set(), damageBlocked:false });
  }
  begin(uid: number, duration: number, target: Target): void {
    this.cancel(uid);
    // Rebuild from the root out: the most recently fired small cells land first.
    const order = bladeFragmentOrder();
    const cells = this.cells.filter(c => c.uid === uid).sort((a,b) => order.indexOf(b.index) - order.indexOf(a.index));
    this.recalls.set(uid, { returned: 0, elapsed: 0, duration, target, indices: cells.map(c => c.index) });
    cells.forEach((c,i) => {
      c.returning = true; c.elapsed = 0; c.start.copy(c.position); c.launched=false;
      c.hitSet.clear(); c.damageBlocked=false;
      c.view.setBladeRecallGlow(true);
      c.delay = duration * (.08 + .28 * i / Math.max(1,cells.length - 1));
      c.duration = duration * .56;
      c.trail = this.acquireTrail(); c.trail.reset(c.position, i % 4 === 0 ? 0xe9dcff : 0x9954ff, .005, .06, .62);
    });
  }
  returned(uid: number): number { return this.recalls.get(uid)?.returned ?? 0; }
  /** Transfer ownership of the actual parked instances back to damage-bearing projectiles. */
  extract(uid: number): Cell[] {
    this.cancel(uid);
    const order=bladeFragmentOrder();
    const cells=this.cells.filter(c=>c.uid===uid).sort((a,b)=>order.indexOf(a.index)-order.indexOf(b.index));
    for(const c of cells) this.cells.splice(this.cells.indexOf(c),1);
    return cells;
  }
  cancel(uid: number): void {
    for (const c of this.cells) if (c.uid === uid) {
      c.returning = false; c.start.copy(c.position);
      c.view.setBladeRecallGlow(false);
      if (c.trail) { this.releaseTrail(c.trail); c.trail = null; }
    }
    this.recalls.delete(uid);
    if (!this.recalls.size) {this.crown.visible=false;this.filaments.visible=false;}
  }
  /** Melee/skill recovery can retire the cells it has already restored to the blade. */
  discardRestored(uid: number, remaining: number): void {
    const missing = BLADE_SHARDS - remaining, order = bladeFragmentOrder();
    for (const c of [...this.cells]) if (c.uid === uid && order.indexOf(c.index) >= missing) this.remove(c);
  }
  update(dt: number): void {
    if (dt <= 0) return;
    this.time+=dt;
    this.crown.visible = false;
    for (const recall of this.recalls.values()) {
      recall.elapsed += dt;
      if (recall.elapsed >= recall.duration || recall.indices.length === 0) continue;
      const p = recall.elapsed / recall.duration, envelope = Math.sin(Math.PI * p);
      this.crown.visible = true;
      const order=bladeFragmentOrder();
      // Sample opposite real slots, rather than placing a generic ring on the first returning cell.
      this.rings.forEach((ring,i) => {
        const lane=Math.min(i,3);
        recall.target(order[lane],_a);recall.target(order[lane+64],_b);
        ring.position.addVectors(_a,_b).multiplyScalar(.5);
        const width=_a.distanceTo(_b)*.5;
        recall.target(order[lane+32],_a);recall.target(order[lane+96],_b);
        const height=_a.distanceTo(_b)*.5;
        const scale=i===4 ? 1+Math.max(0,(p-.84)/.16)*.65 : .82+.18*Math.min(1,p/.16);
        ring.scale.set(width*scale,height*scale,1);ring.quaternion.copy(this.ctx.camera.quaternion);
        ring.material.uniforms.uTime.value=recall.elapsed;
        ring.material.uniforms.uPower.value=i===4 ? Math.max(0,1-Math.abs(p-.90)/.10)*.9 : envelope*.85;
      });
    }
    let filamentCount=0;
    for (const c of [...this.cells]) {
      if (!c.returning) {c.view.setBladeChargeLight(.22+.10*Math.sin(this.time*2+c.index));continue;}
      const recall = this.recalls.get(c.uid); if (!recall) continue;
      const previousT = THREE.MathUtils.clamp((c.elapsed - c.delay) / c.duration, 0, 1);
      c.elapsed += dt;
      const t = THREE.MathUtils.clamp((c.elapsed - c.delay) / c.duration, 0, 1);
      if(c.elapsed<c.delay) {
        c.view.setBladeChargeLight(.3+.7*Math.pow(c.elapsed/c.delay,2));continue;
      }
      if(!c.launched) {
        c.launched=true;
        if(bladeFragmentOrder().indexOf(c.index)%4===0) this.ctx.fx.burst(c.position,0xcaa5ff,3,.45,.20,.02,0);
      }
      recall.target(c.index, _end);
      _prev.copy(c.position);
      bladeRecallPosition(c.start,_end,bladeFragmentOrder().indexOf(c.index),t,this.ctx.camera.quaternion,c.position);
      if (c.damage && !c.damageBlocked && this.recallContact) {
        // Sample the curve itself, including a whole return crossed during a long frame.
        const steps = Math.max(1, Math.ceil((t-previousT)*64));
        _contactFrom.copy(_prev);
        for (let step=1; step<=steps && c.returning && !c.damageBlocked; step++) {
          bladeRecallPosition(c.start,_end,bladeFragmentOrder().indexOf(c.index),
            previousT+(t-previousT)*step/steps,this.ctx.camera.quaternion,_contactTo);
          c.damageBlocked = !this.recallContact(c,_contactFrom,_contactTo);
          _contactFrom.copy(_contactTo);
        }
        if (!c.returning || !this.cells.includes(c)) continue;
      }
      _dir.subVectors(c.position,_prev).normalize();
      c.view.root.position.copy(c.position); c.view.animate(_dir,c.elapsed,100,dt,1);
      this.filamentPositions.setXYZ(filamentCount++,_prev.x,_prev.y,_prev.z);
      this.filamentPositions.setXYZ(filamentCount++,c.position.x,c.position.y,c.position.z);
      if (c.trail) { c.trail.push(c.position); c.trail.update(this.ctx.camera.position); }
      if (t >= 1) {
        recall.returned++;
        if (recall.returned % 4 === 1) this.ctx.fx.burst(_end,0xe8dbff,4,.5,.16,.018,0);
        if (recall.returned === recall.indices.length) {
          for(let lane=0;lane<4;lane++) {
            recall.target(bladeFragmentOrder()[lane+32],_d);this.ctx.fx.burst(_d,0xd1b6ff,6,.65,.25,.023,0);
          }
          this.ctx.audio.play('reload_end',{volume:.4,pitch:1.6});
        }
        this.remove(c);
      }
    }
    this.filamentPositions.needsUpdate=true;this.filaments.geometry.setDrawRange(0,filamentCount);
    this.filaments.visible=filamentCount>0;
  }
  private remove(c: Cell): void {
    this.releaseView(c.view);
    if (c.trail) this.releaseTrail(c.trail);
    const i = this.cells.indexOf(c); if (i >= 0) this.cells.splice(i,1);
  }
  clear(): void { for (const c of [...this.cells]) this.remove(c); this.recalls.clear(); this.crown.visible = false;
    this.filaments.visible=false;this.filaments.geometry.setDrawRange(0,0); }
}
