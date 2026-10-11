/** User references: silver fractured faces, dark seams, cyan root motifs and violet edge light. */
import * as THREE from 'three';
import type { GunModel } from './WeaponModels';

export const BLADE_SHARDS = 128; // One mesh, one natural polygon cell, one emitted projectile.
export const BLADE_RUNE_COLOR = 0x9954ff;
export const BLADE_GLYPH_COLOR = 0x69d5ff;
export const BLADE_LENGTH = 0.78;
const ROOT_Z = -0.04;
const HALF_WIDTH = 0.021;
const FLOW_COUNT = 64;
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

/** u = 0 at the hilt and 1 at the tip. Increasing phase moves a chip toward the hilt. */
export function bladeFlowU(time: number, phase: number, speed = 0.72): number {
  return 1 - ((time * speed + phase) % 1 + 1) % 1;
}
const midY = (u: number): number => -0.002 + 0.047 * u * u;
const taper = (u: number): number => u < 0.90 ? 1 - 0.15 * u : Math.max(0.012, (1 - u) / 0.1 * 0.865);
const point = (u: number, v: number): [number, number] => [midY(u) + v * taper(u), ROOT_Z - BLADE_LENGTH * u];
/** User image 3: dark spine/root follows a sloping boundary above the pale fractured edge. */
const SPINE_PROFILE = [[0, -0.72], [0.12, -0.60], [0.25, -0.20], [0.40, 0.45], [0.70, 0.65], [1, 0.85]];
function spineV(u: number): number {
  for (let i = 1; i < SPINE_PROFILE.length; i++) {
    const [a, va] = SPINE_PROFILE[i - 1], [b, vb] = SPINE_PROFILE[i];
    if (u <= b) return (va + (vb - va) * (u - a) / (b - a)) * HALF_WIDTH;
  }
  return HALF_WIDTH * 0.85;
}
/** Logical pieces are sorted physically along the blade, never as a fan. */
export function bladeRankForAmmo(blades: number, max: number): number {
  return Math.min(BLADE_SHARDS - 1, Math.max(0, BLADE_SHARDS - Math.min(BLADE_SHARDS, Math.round(blades))));
}
type V2 = [number, number];
interface GeometrySet { groups: THREE.BufferGeometry[]; homes: THREE.Vector3[]; cells: V2[][]; halo: THREE.BufferGeometry; chips: THREE.BufferGeometry }
let cached: GeometrySet | null = null;
let silver: THREE.MeshStandardMaterial | null = null;
let black: THREE.MeshStandardMaterial | null = null;
let wrap: THREE.MeshStandardMaterial | null = null;
let cyan: THREE.MeshBasicMaterial | null = null;
let staticHalo: THREE.ShaderMaterial | null = null;

/** Half-plane clipping makes actual closed polygon fragments rather than painted rectangles. */
function clip(poly: V2[], nx: number, ny: number, limit: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit;
    if (da <= 1e-10) out.push(a);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function geometry(positions: number[], colors?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

function resources(): GeometrySet {
  if (cached) return cached;
  let seed = 71007;
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sites: V2[] = [];
  for (let col = 0; col < 32; col++) for (let row = 0; row < 4; row++) {
    sites.push([(col + 0.2 + random() * 0.6) / 32 * BLADE_LENGTH, (row + 0.2 + random() * 0.6) / 4 * HALF_WIDTH * 2 - HALF_WIDTH]);
  }
  const positions = Array.from({ length: BLADE_SHARDS }, () => [] as number[]);
  const colors = Array.from({ length: BLADE_SHARDS }, () => [] as number[]);
  const cellPolygons: V2[][] = [];
  const homes: THREE.Vector3[] = [];
  for (const site of sites) {
    let poly: V2[] = [[0, -HALF_WIDTH], [BLADE_LENGTH, -HALF_WIDTH], [BLADE_LENGTH, HALF_WIDTH], [0, HALF_WIDTH]];
    for (const other of sites) {
      if (other === site) continue;
      const nx = other[0] - site[0], ny = other[1] - site[1];
      poly = clip(poly, nx, ny, (other[0] ** 2 + other[1] ** 2 - site[0] ** 2 - site[1] ** 2) / 2);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    // Each natural Voronoi polygon is an independent mesh; never merge adjacent cells.
        const cell = poly;
        const cu = cell.reduce((sum, p) => sum + p[0], 0) / cell.length;
        const cv = cell.reduce((sum, p) => sum + p[1], 0) / cell.length;
        const idx = cellPolygons.length, P = positions[idx], C = colors[idx];
        cellPolygons.push(cell);
        const [hy, hz] = point(cu / BLADE_LENGTH, cv); homes.push(new THREE.Vector3(0, hy, hz));
        const shade = 0.84 + random() * 0.16;
        const inset = cell.map(([u, v]): V2 => {
          const dx = u - cu, dy = v - cv, len = Math.hypot(dx, dy) || 1;
          const k = Math.max(0.72, 1 - 0.00042 / len);
          return [cu + dx * k, cv + dy * k];
        });
        const add = (x: number, p: V2, dark: boolean): void => {
          const u = p[0] / BLADE_LENGTH, [y, z] = point(u, p[1]);
          P.push(x, y, z);
          const edge = THREE.MathUtils.clamp((-p[1] / HALF_WIDTH + 0.3) / 1.3, 0, 1);
          const light = shade * (0.9 + 0.1 * edge);
          if (dark) C.push(0.012, 0.022, 0.036);
          else C.push(light * 0.91, light * 0.96, light);
        };
        const thickness = 0.0031 - 0.0014 * cu / BLADE_LENGTH;
        // Split each face at the dark spine boundary instead of placing a rectangular black block over it.
        const slope = (spineV(cu / BLADE_LENGTH + 0.001) - spineV(cu / BLADE_LENGTH - 0.001)) / (0.002 * BLADE_LENGTH);
        const intercept = spineV(cu / BLADE_LENGTH) - slope * cu;
        for (const dark of [false, true]) {
          const face = clip(inset, dark ? slope : -slope, dark ? -1 : 1, dark ? -intercept : intercept);
          for (let i = 1; i < face.length - 1; i++) {
            for (const j of [0, i, i + 1]) add(thickness, face[j], dark);
            for (const j of [0, i + 1, i]) add(-thickness, face[j], dark);
          }
        }
        for (let i = 0; i < inset.length; i++) {
          const a = inset[i], b = inset[(i + 1) % inset.length];
          add(thickness, a, true); add(-thickness, a, true); add(-thickness, b, true);
          add(thickness, a, true); add(-thickness, b, true); add(thickness, b, true);
        }
        // The original cell's dark backing travels with the cell, so missing tip sections leave no full-length spine.
        for (let i = 1; i < cell.length - 1; i++) for (const j of [0, i, i + 1]) add(0, cell[j], true);

  }
  const groups = positions.map((P, i) => {
    const { y, z } = homes[i];
    for (let j = 0; j < P.length; j += 3) { P[j + 1] -= y; P[j + 2] -= z; }
    const g = geometry(P, colors[i]); g.userData.fragmentIndex = i; g.userData.cellCount = 1; g.userData.cellCountTotal = cellPolygons.length;
    return g;
  });
  const haloP: number[] = [], haloUv: number[] = [];
  for (let i = 0; i < 48; i++) {
    const ua = i / 48, ub = (i + 1) / 48;
    for (const [u, v] of [[ua, -1], [ub, -1], [ub, 1], [ua, -1], [ub, 1], [ua, 1]]) {
      const y = midY(u) - HALF_WIDTH * taper(u), z = ROOT_Z - BLADE_LENGTH * u;
      haloP.push(0, y + v * 0.027, z); haloUv.push(u, v);
    }
  }
  const halo = geometry(haloP); halo.setAttribute('uv', new THREE.Float32BufferAttribute(haloUv, 2));
  cached = { groups, homes, cells: cellPolygons, halo, chips: geometry([
    0, -0.55, 0, 0, 0.4, -0.32, 0, 0.55, 0.65,
    0, -0.55, 0, 0, 0.55, 0.65, 0, -0.28, 0.28,
  ]) };
  return cached;
}

/** Shared single-cell geometry also used by the projectile pool. */
export function bladeFragmentGeometry(index: number): THREE.BufferGeometry { return resources().groups[index]; }
let fragmentOrder: number[] | null = null;
export function bladeFragmentOrder(): number[] {
  return fragmentOrder ??= resources().homes.map((_, i) => i).sort((a,b)=>resources().homes[a].z-resources().homes[b].z || a-b);
}
/** A bright head and a fading wake behind it, both travelling from tip (1) toward hilt (0). */
export function bladeSeamLight(u: number, time: number, activity = 0): number {
  let light = 0;
  for (const phase of [0,.5]) {
    const d = u - bladeFlowU(time,phase,.48);
    light += Math.exp(-Math.pow(d / (.045 + activity*.012),2))
      + (d>0 ? .32*Math.exp(-d/.12) : 0);
  }
  return light;
}

/** Four staggered elliptical orbits in view-camera metres, leaving the crosshair open. */
export function bladeFormationPosition(rank: number, time: number, aspect: number, out: THREE.Vector3): THREE.Vector3 {
  const ring = rank % 4, slot = Math.floor(rank / 4);
  const angle = slot / 32 * Math.PI * 2 + ring * .049 + time * (ring % 2 ? -.085 : .11);
  const breath = .009 * Math.sin(time * 1.15 + slot * .55 + ring);
  const width = Math.max(.8, Math.min(1.5, aspect));
  return out.set((.25 + ring * .095 + breath) * Math.cos(angle) * width,
    .065 + (.17 + ring * .062 + breath) * Math.sin(angle),
    -(.95 + ring * .11) + .025 * Math.sin(angle * 2 + time * .7 + ring));
}
export function bladeFragmentIndex(bladesBefore: number): number { return bladeFragmentOrder()[bladeRankForAmmo(bladesBefore, BLADE_SHARDS)]; }

/** Batched light follows the real cell edges; decorative chips flow tip -> hilt. */
const orbitGlowGeometry = new THREE.PlaneGeometry(1, 1);
const orbitFxGeometry = orbitGlowGeometry.clone();
orbitFxGeometry.setAttribute('aSeed',new THREE.InstancedBufferAttribute(Float32Array.from({length:BLADE_SHARDS*2},(_,i)=>i*.618034),1));
let cachedEdges: Float32Array[] | null = null;
let cachedMeleeEdges: Float32Array[] | null = null;
function cellEdgePositions(): Float32Array[] {
  if (!cachedEdges) cachedEdges=resources().groups.map(g=>{
    const edges=new THREE.EdgesGeometry(g,24), positions=new Float32Array(edges.getAttribute('position').array);
    edges.dispose(); return positions;
  });
  return cachedEdges;
}
/** One face outline per natural cell; omit back faces, extrusion walls and material-split diagonals. */
function meleeCellEdges(): Float32Array[] {
  if(!cachedMeleeEdges) {
    const G=resources();
    cachedMeleeEdges=G.cells.map((cell,i)=>{
      const cu=cell.reduce((sum,p)=>sum+p[0],0)/cell.length,cv=cell.reduce((sum,p)=>sum+p[1],0)/cell.length;
      const inset=cell.map(([u,v])=>{
        const k=Math.max(.72,1-.00042/(Math.hypot(u-cu,v-cv)||1));
        return point((cu+(u-cu)*k)/BLADE_LENGTH,cv+(v-cv)*k);
      });
      const P:number[]=[];
      for(let j=0;j<inset.length;j++) {
        const a=inset[j],b=inset[(j+1)%inset.length],home=G.homes[i];
        P.push(0,a[0]-home.y,a[1]-home.z,0,b[0]-home.y,b[1]-home.z);
      }
      return new Float32Array(P);
    });
  }
  return cachedMeleeEdges;
}
const _right=new THREE.Vector3(), _up=new THREE.Vector3(), _point=new THREE.Vector3();
const _tailRotation=new THREE.Quaternion();
const _edgeColor=new THREE.Color();
export class BladeEnergy {
  /** Viewmodel-only glow at each real cell; no duplicate physical fragments. */
  readonly orbitGlows: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly orbitTails: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly orbitMotes: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly cellRims: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly edgePos: THREE.BufferAttribute;
  private readonly edgeCol: THREE.BufferAttribute;
  private readonly previousVisible=new Uint8Array(BLADE_SHARDS);
  private readonly landPulse=new Float32Array(BLADE_SHARDS);
  private lastDt=0;
  readonly group = new THREE.Group();
  private readonly halo: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly chips: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private time = 0;
  private animated = true;
  constructor() {
    const G = resources();
    this.group.name = 'blade.energy';
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPower: { value: 0.28 }, uLength: { value: 1 }, uTime:{value:0}, uActivity:{value:0} },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 vUv; uniform float uPower; uniform float uLength; uniform float uTime; uniform float uActivity;
        void main(){float edge=exp(-abs(vUv.y)*7.); float veil=exp(-abs(vUv.y)*2.8);
        float ends=smoothstep(0.,.04,vUv.x)*(1.-smoothstep(max(0.,uLength-.04),uLength+.005,vUv.x));
        float head=1.-fract(uTime*.48);float head2=1.-fract(uTime*.48+.5);
        float charge=exp(-pow((vUv.x-head)/.07,2.))+exp(-pow((vUv.x-head2)/.07,2.));
        vec3 col=mix(vec3(.34,.04,1.),vec3(.92,.8,1.),edge*(.45+.4*charge));
        gl_FragColor=vec4(col,ends*(veil*.2+edge*.65)*uPower*(.65+charge*.85+uActivity*.15));
        #include <colorspace_fragment>
        }`,
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, toneMapped: false,
    });
    this.halo = new THREE.Mesh(G.halo, mat); this.halo.renderOrder = 4; this.halo.frustumCulled = false;
    this.chips = new THREE.InstancedMesh(G.chips, new THREE.MeshBasicMaterial({
      color: 0xe9dfff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    }), FLOW_COUNT);
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.chips.frustumCulled = false;
    this.chips.name = 'blade.tipToHiltFragments'; this.chips.renderOrder = 5;
    this.orbitGlows = new THREE.InstancedMesh(orbitGlowGeometry, new THREE.ShaderMaterial({
      uniforms: { uPower: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 vUv; uniform float uPower;
        void main(){float r=length(vUv-.5)*2.; float a=exp(-r*r*5.)*(1.-smoothstep(.75,1.,r));
        gl_FragColor=vec4(mix(vec3(.45,.12,1.),vec3(.87,.76,1.),exp(-r*r*30.)),a*uPower);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    }), BLADE_SHARDS);
    this.orbitGlows.name = 'blade.formationGlows'; this.orbitGlows.count = 0;
    this.orbitGlows.frustumCulled = false; this.orbitGlows.renderOrder = 3;
    this.orbitGlows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const instancedVertex=`attribute float aSeed; varying vec2 vUv; varying float vSeed;
      void main(){vUv=uv;vSeed=aSeed;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`;
    this.orbitTails=new THREE.InstancedMesh(orbitFxGeometry,new THREE.ShaderMaterial({
      uniforms:{uPower:{value:0},uTime:{value:0}},vertexShader:instancedVertex,
      fragmentShader:`varying vec2 vUv; varying float vSeed; uniform float uTime; uniform float uPower;
        void main(){float x=vUv.x;float bend=.10*sin(x*5.-uTime*3.+vSeed)*pow(1.-x,1.5);
          float width=.025+.15*pow(x,.65);float band=exp(-pow((vUv.y-.5-bend)/width,2.));
          float a=band*pow(x,1.5)*(1.-smoothstep(.86,1.,x));
          vec3 col=mix(vec3(.34,.06,1.),vec3(.84,.73,1.),pow(x,3.));
          gl_FragColor=vec4(col,a*uPower);
          #include <colorspace_fragment>
        }`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
    }),BLADE_SHARDS);
    this.orbitMotes=new THREE.InstancedMesh(orbitFxGeometry,new THREE.ShaderMaterial({
      uniforms:{uPower:{value:0},uTime:{value:0}},vertexShader:instancedVertex,
      fragmentShader:`varying vec2 vUv; varying float vSeed; uniform float uTime; uniform float uPower;
        void main(){vec2 p=abs(vUv-.5)*2.;float a=pow(max(0.,1.-p.x-p.y),2.);
          float twinkle=.22+.78*pow(.5+.5*sin(uTime*3.2+vSeed*17.),4.);
          gl_FragColor=vec4(.78,.68,1.,a*uPower*twinkle);
          #include <colorspace_fragment>
        }`,
      transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
    }),BLADE_SHARDS*2);
    for(const m of [this.orbitTails,this.orbitMotes]) {
      m.count=0; m.frustumCulled=false; m.renderOrder=4; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.orbitTails.name='blade.cellCometTails'; this.orbitMotes.name='blade.cellStarMotes';
    const edgeSize=cellEdgePositions().reduce((n,p)=>n+p.length,0);
    this.edgePos=new THREE.BufferAttribute(new Float32Array(edgeSize),3).setUsage(THREE.DynamicDrawUsage);
    this.edgeCol=new THREE.BufferAttribute(new Float32Array(edgeSize),3).setUsage(THREE.DynamicDrawUsage);
    const edgeGeo=new THREE.BufferGeometry(); edgeGeo.setAttribute('position',this.edgePos); edgeGeo.setAttribute('color',this.edgeCol);
    edgeGeo.setDrawRange(0,0);
    this.cellRims=new THREE.LineSegments(edgeGeo,new THREE.LineBasicMaterial({
      vertexColors:true,transparent:true,opacity:.75,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false,toneMapped:false,
    }));
    this.cellRims.name='blade.cellRims'; this.cellRims.frustumCulled=false; this.cellRims.renderOrder=6;
    this.group.add(this.halo,this.chips,this.orbitGlows,this.orbitTails,this.orbitMotes,this.cellRims);
    this.update(0,0,0,'high');
  }
  updateFormation(shards: readonly THREE.Mesh[], amount: number, facing: THREE.Quaternion, activity: number,
    time=this.time, quality='high'): void {
    if (!this.animated) return;
    const mesh = this.orbitGlows;
    for(const fx of [this.halo,this.chips]) {fx.scale.z=1;fx.position.z=0;}
    mesh.count = 0;
    this.orbitTails.count=this.orbitMotes.count=0;
    let edgeCount=0;
    _right.set(1,0,0).applyQuaternion(facing); _up.set(0,1,0).applyQuaternion(facing);
    const order=bladeFragmentOrder(),edges=cellEdgePositions();
    for(let i=0;i<shards.length;i++) {
      const shard=shards[i], visible=amount>0 && shard.visible;
      if(visible && !this.previousVisible[i]) this.landPulse[i]=.24;
      this.previousVisible[i]=visible?1:0;
      this.landPulse[i]=Math.max(0,this.landPulse[i]-this.lastDt);
      if(!visible) continue;
      const rank=order.indexOf(i), ring=rank%4;
      const pulse=this.landPulse[i]/.24;
      _m.compose(shard.position,facing,_s.setScalar(.067+pulse*.035)); mesh.setMatrixAt(mesh.count++,_m);
      const angle=Math.floor(rank/4)/32*Math.PI*2+ring*.049+time*(ring%2?-.085:.11);
      const tangent=angle+(ring%2?-Math.PI/2:Math.PI/2);
      _tailRotation.copy(facing).multiply(_q.setFromAxisAngle(_p.set(0,0,1),tangent));
      if(quality!=='low' || rank%2===0) {
        _p.copy(shard.position).addScaledVector(_right,-Math.cos(tangent)*.047).addScaledVector(_up,-Math.sin(tangent)*.047);
        _m.compose(_p,_tailRotation,_s.set(.115,.022,1)); this.orbitTails.setMatrixAt(this.orbitTails.count++,_m);
      }
      const moteCount=quality==='high'?2:quality==='medium'?1:rank%4===0?1:0;
      for(let j=0;j<moteCount;j++) {
        const a=time*(1.3+ring*.13)+rank*2.39996+j*Math.PI;
        _p.copy(shard.position).addScaledVector(_right,Math.cos(a)*(.021+j*.01)).addScaledVector(_up,Math.sin(a)*(.012+j*.008));
        _m.compose(_p,facing,_s.set(.007,.004,1)); this.orbitMotes.setMatrixAt(this.orbitMotes.count++,_m);
      }
      const edge=edges[i];
      for(let j=0;j<edge.length;j+=3) {
        _point.fromArray(edge,j).multiply(shard.scale).applyQuaternion(shard.quaternion).add(shard.position);
        this.edgePos.setXYZ(edgeCount,_point.x,_point.y,_point.z);
        const sweep=.5+.5*Math.sin(time*3.2-rank*.17+j*.08);
        _edgeColor.setRGB(.30+.43*sweep+pulse*.6,.13+.40*sweep+pulse*.6,.85+pulse*.2).multiplyScalar(amount);
        this.edgeCol.setXYZ(edgeCount++,_edgeColor.r,_edgeColor.g,_edgeColor.b);
      }
    }
    this.cellRims.geometry.setDrawRange(0,edgeCount); this.cellRims.material.opacity=.65+Math.min(.3,activity*.2);
    this.edgePos.needsUpdate=this.edgeCol.needsUpdate=true;
    for(const fx of [this.orbitTails,this.orbitMotes]) {
      fx.instanceMatrix.needsUpdate=true; fx.material.uniforms.uTime.value=time;
      fx.material.uniforms.uPower.value=amount*(fx===this.orbitTails ? .75+activity*.22 : 1.0);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.material.uniforms.uPower.value = amount * (.28 + activity * .14 + .045 * Math.sin(this.time * 2.4));
    this.halo.visible = this.halo.visible && amount < .02;
    this.chips.visible = amount < .02;
  }
  /** Closed melee blade: illuminate its actual cracks, without spreading or moving its 128 physical cells. */
  updateMelee(shards: readonly THREE.Mesh[], amount: number, facing: THREE.Quaternion, activity: number,
    time=this.time, quality='high', extent=1): void {
    if(!this.animated || amount<=0) return;
    const edges=meleeCellEdges();let edgeCount=0;
    this.orbitGlows.count=this.orbitMotes.count=this.orbitTails.count=0;
    this.halo.visible=this.chips.visible=true;
    this.halo.material.uniforms.uTime.value=time;
    for(const fx of [this.halo,this.chips]) {fx.scale.z=extent;fx.position.z=ROOT_Z*(1-extent);}
    for(let i=0;i<shards.length;i++) {
      const shard=shards[i];if(!shard.visible) continue;
      const u=THREE.MathUtils.clamp((ROOT_Z-shard.position.z)/(BLADE_LENGTH*extent),0,1);
      const charge=bladeSeamLight(u,time,activity);
      // Soft light at the charged cells only, leaving most silver faces and dark cracks readable.
      if(charge>.12) {
        _m.compose(shard.position,facing,_s.setScalar(.022+charge*.011+activity*.006));
        this.orbitGlows.setMatrixAt(this.orbitGlows.count++,_m);
      }
      const edge=edges[i];
      for(let j=0;j<edge.length;j+=3) {
        _point.fromArray(edge,j).multiply(shard.scale).applyQuaternion(shard.quaternion).add(shard.position);
        this.edgePos.setXYZ(edgeCount,_point.x,_point.y,_point.z);
        const eu=THREE.MathUtils.clamp((ROOT_Z-_point.z)/(BLADE_LENGTH*extent),0,1);
        const flow=bladeSeamLight(eu,time,activity), brightness=amount*(.025+.30*flow+activity*.16);
        _edgeColor.setRGB(.48+.35*flow,.18+.50*flow,1).multiplyScalar(brightness);
        this.edgeCol.setXYZ(edgeCount++,_edgeColor.r,_edgeColor.g,_edgeColor.b);
      }
    }
    const count=quality==='low'?12:quality==='medium'?24:40;
    for(let i=0;i<count;i++) {
      const u=bladeFlowU(time,i*.618034,.48),phase=i*2.39996;
      _p.set(Math.sin(phase+time*2)*.007,midY(u)-HALF_WIDTH*taper(u)-(.009+activity*.022)*Math.sin(Math.PI*u),ROOT_Z-BLADE_LENGTH*u*extent);
      _m.compose(_p,facing,_s.setScalar(.0035+activity*.002));
      this.orbitMotes.setMatrixAt(this.orbitMotes.count++,_m);
    }
    this.cellRims.geometry.setDrawRange(0,edgeCount);this.cellRims.material.opacity=.8;
    this.edgePos.needsUpdate=this.edgeCol.needsUpdate=true;
    this.orbitGlows.instanceMatrix.needsUpdate=true;this.orbitGlows.material.uniforms.uPower.value=amount*(.24+activity*.18);
    this.orbitMotes.instanceMatrix.needsUpdate=true;this.orbitMotes.material.uniforms.uTime.value=time;
    this.orbitMotes.material.uniforms.uPower.value=amount*(.65+activity*.65);
  }
  update(dt: number, ranged: number, activity: number, quality: string, remaining = 1): void {
    if (!this.animated) return;
    this.lastDt=dt;
    this.time += dt;
    const power = 0.22 + activity * 0.8;
    this.halo.visible = remaining > 0;
    this.halo.material.uniforms.uPower.value = power + ranged * 0.12;
    this.halo.material.uniforms.uLength.value = remaining;
    this.halo.material.uniforms.uTime.value=this.time;
    this.halo.material.uniforms.uActivity.value=activity;
    this.chips.count = remaining <= 0 ? 0 : quality === 'low' ? 20 : quality === 'medium' ? 40 : FLOW_COUNT;
    this.chips.material.opacity = 0.32 + activity * 0.6;
    for (let i = 0; i < this.chips.count; i++) {
      const u = remaining * bladeFlowU(this.time, i * 0.61803398875);
      const envelope = Math.sin(Math.PI * u);
      const y = midY(u) - HALF_WIDTH * taper(u), z = ROOT_Z - BLADE_LENGTH * u;
      const phase = i * 2.39996;
      // u decreases: fragments actually travel toward increasing Z (the hilt).
      _p.set(Math.sin(phase + this.time * 1.5) * (0.006 + activity * 0.025) * envelope,
        y - (0.004 + (i % 7) * 0.002 + activity * 0.038) * envelope, z);
      _q.setFromEuler(_e.set(phase + this.time * 2, Math.sin(phase) * 0.6, phase));
      const size = (0.003 + (i % 5) * 0.0013) * (0.55 + envelope) * (1 + activity * 0.6);
      _m.compose(_p, _q, _s.setScalar(size)); this.chips.setMatrixAt(i, _m);
    }
    this.chips.instanceMatrix.needsUpdate = true;
  }
  /** World drops use a shared static veil without allocating animated GPU instance buffers. */
  makeStatic(): void {
    if (!this.animated) return;
    staticHalo ??= this.halo.material.clone();
    staticHalo.uniforms.uPower.value = 0.22;
    this.halo.material.dispose(); this.halo.material = staticHalo;
    this.chips.removeFromParent(); this.chips.dispose(); this.chips.material.dispose();
    this.orbitGlows.removeFromParent(); this.orbitGlows.dispose(); this.orbitGlows.material.dispose();
    this.disposeFormation();
    this.animated = false;
  }
  dispose(): void {
    if (!this.animated) return;
    this.halo.material.dispose(); this.chips.dispose(); this.chips.material.dispose();
    this.orbitGlows.dispose(); this.orbitGlows.material.dispose();
    this.disposeFormation();
  }
  private disposeFormation(): void {
    for(const m of [this.orbitTails,this.orbitMotes]) {m.removeFromParent();m.dispose();m.material.dispose();}
    this.cellRims.removeFromParent();this.cellRims.geometry.dispose();this.cellRims.material.dispose();
  }
}

/** Cached cell geometry and opaque materials; only the animated energy owns materials. */
export function buildDemonBlade(model: GunModel): void {
  const G = resources(), root = model.root;
  silver ??= new THREE.MeshStandardMaterial({ color: 0xf3f7ff, vertexColors: true, metalness: 0.04, roughness: 0.55, side: THREE.DoubleSide });
  black ??= new THREE.MeshStandardMaterial({ color: 0x101b23, metalness: 0.05, roughness: 0.8, side: THREE.DoubleSide });
  wrap ??= new THREE.MeshStandardMaterial({ color: 0x344b53, metalness: 0, roughness: 0.96, side: THREE.DoubleSide });
  cyan ??= new THREE.MeshBasicMaterial({ color: BLADE_GLYPH_COLOR, toneMapped: false, side: THREE.DoubleSide });
  const box = (parent: THREE.Object3D, material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(cachedBox(w, h, d), material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const grip = new THREE.Mesh(gripGeometry(), black); grip.name = 'blade.referenceWrappedGrip'; root.add(grip);
  const bands = new THREE.Mesh(gripWrapGeometry(), wrap); root.add(bands);
  box(root, black, 0.034, 0.034, 0.022, 0, 0, 0.240);
  const guard = new THREE.Group(); guard.name = 'blade.blackGuard'; root.add(guard);
  // Reference guard lies across the blade face, with a small rectangular, horn-free silhouette.
  box(guard, black, 0.014, 0.079, 0.014, 0, 0, -0.033);
  const runes: THREE.Mesh[] = [];
  const body = new THREE.Group(); body.name = 'blade.darkSeams'; root.add(body);
  const shards = G.groups.map((g, i) => {
    const mesh = new THREE.Mesh(g, silver!); mesh.name = `blade.fragment${i}`;
    mesh.position.copy(G.homes[i]); root.add(mesh); return mesh;
  });
  const motif = referenceMotifs(G.homes);
  for (let i = 0; i < BLADE_SHARDS; i++) for (const g of motif[i]) {
    const rune = new THREE.Mesh(g, cyan); rune.name = 'blade.referenceBlueScroll'; shards[i].add(rune); runes.push(rune);
  }
  for (const sign of [-1, 1]) {
    const seal = new THREE.Mesh(pommelSeal(sign), cyan); root.add(seal); runes.push(seal);
  }
  const energy = new BladeEnergy(); root.add(energy.group);
  const tip = new THREE.Vector3(0, midY(1), ROOT_Z - BLADE_LENGTH);
  model.muzzle.position.copy(tip);
  model.blade = {
    body, shards, shardHome: G.homes.map(pos => ({ pos: pos.clone(), rot: new THREE.Euler() })),
    shardOrder: bladeFragmentOrder(),
    runes, guard, tassel: [], tip, energy,
    trailInner: new THREE.Vector3(0, midY(0.25) - HALF_WIDTH, ROOT_Z - BLADE_LENGTH * 0.25),
  };
}

const boxes = new Map<string, THREE.BoxGeometry>();
const glyphs = new Map<string, THREE.BufferGeometry>();
function cachedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w}:${h}:${d}`; let g = boxes.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxes.set(key, g); } return g;
}
function cachedGlyph(key: string, P: number[]): THREE.BufferGeometry {
  let g = glyphs.get(key); if (!g) { g = geometry(P); glyphs.set(key, g); } return g;
}

let gripGeo: THREE.BufferGeometry | null = null, wrapGeo: THREE.BufferGeometry | null = null;
function gripGeometry(): THREE.BufferGeometry {
  if (gripGeo) return gripGeo;
  const shape = new THREE.Shape();
  const outline = [[-.016,-.011],[-.013,-.015],[.013,-.015],[.016,-.011],[.016,.011],[.013,.015],[-.013,.015],[-.016,.011]];
  shape.moveTo(...outline[0] as [number, number]);
  for (const p of outline.slice(1)) shape.lineTo(p[0],p[1]); shape.closePath();
  gripGeo = new THREE.ExtrudeGeometry(shape,{depth:.262,bevelEnabled:false,steps:1}); gripGeo.translate(0,0,-.029);
  return gripGeo;
}
function gripWrapGeometry(): THREE.BufferGeometry {
  if (wrapGeo) return wrapGeo;
  const P: number[]=[];
  // Flush diagonal cloth seams, rather than the old raised sawtooth bars.
  for (const sign of [-1,1]) for(let i=0;i<25;i++) {
    const z=-.020+i*.0098, x=sign*.0162;
    P.push(x,-.010,z-.0025, x,.010,z+.0025, x,.010,z+.0035, x,-.010,z-.0025, x,.010,z+.0035, x,-.010,z-.0015);
  }
  wrapGeo=geometry(P); return wrapGeo;
}

/** Curled blue flame/scroll marks traced from image 3; coordinates follow the blade surface. */
const REFERENCE_SCROLLS: V2[][] = [
  [[.008,.86],[.022,.56],[.041,.68],[.033,.86],[.050,.77],[.065,.42],[.050,.25],[.032,.32],[.042,.49]],
  [[.006,.36],[.015,.02],[.035,-.08],[.057,.06],[.069,.27],[.084,.13],[.091,-.06],[.067,-.27],[.032,-.35],[.014,-.23]],
  [[.006,-.44],[.034,-.53],[.082,-.45],[.122,-.30],[.162,.02],[.185,.33],[.212,.40]],
  [[.078,.69],[.086,.36],[.105,.28],[.127,.45],[.133,.61],[.149,.72]],
  [[.054,.84],[.095,.92],[.151,.90],[.193,.77],[.224,.60]],
  [[.105,.13],[.146,.17],[.193,.47],[.228,.76],[.256,.82]],
  [[.083,-.40],[.153,-.19],[.220,.35],[.277,.70],[.333,.83]],
  [[.160,-.22],[.212,.05],[.261,.53],[.313,.74],[.382,.87]],
  [[.241,.40],[.298,.55],[.374,.80],[.462,.86]],
];
let motifCache: THREE.BufferGeometry[][] | null = null;
/** Cut every blue stroke against the real cell boundary, so it follows only that cell. */
function referenceMotifs(homes: THREE.Vector3[]): THREE.BufferGeometry[][] {
  if (motifCache) return motifCache;
  const arrays = Array.from({length:BLADE_SHARDS},()=>[[] as number[],[] as number[]]);
  for (const path of REFERENCE_SCROLLS) {
    const curve=new THREE.CatmullRomCurve3(path.map(([u,v])=>new THREE.Vector3(u,v,0)));
    for(let j=0;j<64;j++) {
      const a=curve.getPoint(j/64), b=curve.getPoint((j+1)/64);
      const u=(a.x+b.x)*.5;
      if (Math.min(a.y,b.y)*HALF_WIDTH < spineV(u)+.0008) continue;
      const ribbon: V2[] = [[a.x*BLADE_LENGTH,a.y*HALF_WIDTH-.00068],[b.x*BLADE_LENGTH,b.y*HALF_WIDTH-.00068],
        [b.x*BLADE_LENGTH,b.y*HALF_WIDTH+.00068],[a.x*BLADE_LENGTH,a.y*HALF_WIDTH+.00068]];
      for(let idx=0;idx<BLADE_SHARDS;idx++) {
        let polygon=ribbon;
        const cell=resources().cells[idx];
        for(let k=0;k<cell.length && polygon.length>=3;k++) {
          const ca=cell[k],cb=cell[(k+1)%cell.length],nx=cb[1]-ca[1],ny=ca[0]-cb[0];
          polygon=clip(polygon,nx,ny,nx*ca[0]+ny*ca[1]);
        }
        if(polygon.length<3) continue;
        for(let face=0;face<2;face++) {
          const P=arrays[idx][face],home=homes[idx];
          for(let k=1;k<polygon.length-1;k++) for(const n of [0,k,k+1]) {
            const [cu,cv]=polygon[n],uu=cu/BLADE_LENGTH,[y,z]=point(uu,cv);
            P.push((face===0?-1:1)*(.00325-.0014*uu),y-home.y,z-home.z);
          }
        }
      }
    }
  }
  motifCache=arrays.map((faces,i)=>faces.filter(P=>P.length>0).map((P,j)=>cachedGlyph(`scroll:${i}:${j}`,P)));
  return motifCache;
}

function pommelSeal(sign: number): THREE.BufferGeometry {
  const key=`seal:${sign}`;
  const cachedSeal=glyphs.get(key); if(cachedSeal) return cachedSeal;
  const P:number[]=[];
  const paths:V2[][] = [
    [[-.010,-.007],[-.010,.003],[-.006,.007],[.000,.005],[.001,.001],[-.003,-.001],[-.005,.002]],
    [[.010,.007],[.010,-.003],[.006,-.007],[.000,-.005],[-.001,-.001],[.003,.001],[.005,-.002]],
    [[-.003,.008],[.003,.007],[.007,.003],[.004,-.001],[.003,-.006]],
  ];
  for(const path of paths) {
    const curve=new THREE.CatmullRomCurve3(path.map(([y,z])=>new THREE.Vector3(sign*.0172,y,.240+z)));
    for(let j=0;j<30;j++) {
      const a=curve.getPoint(j/30), b=curve.getPoint((j+1)/30), w=.00075;
      P.push(a.x,a.y-w,a.z, b.x,b.y-w,b.z, b.x,b.y+w,b.z, a.x,a.y-w,a.z, b.x,b.y+w,b.z, a.x,a.y+w,a.z);
    }
  }
  return cachedGlyph(key,P);
}
