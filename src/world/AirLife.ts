import * as THREE from 'three';
import { Atmosphere, ATMOSPHERE_WIND_GLSL } from './Atmosphere';

/**
 * 小活物（docs/art/composition.md 第 8.3 节）：落叶、远处的鸟、光里的尘。都拴在世界上，不拴在镜头上；数量少、位置有来由。
 *   落叶  只从给定的树冠下掉，落在自己的树底下：平时每棵树空中只有三四片，阵风锋面扫到时被带得远一点。
 *   鸟    绕着给定的圆心盘旋的一小群，放在 80 m 以外的高处：给尺度，不进交战视线（中景里会动的黑点 = 假敌人）。
 *   尘    给定的盒子里慢慢漂的细尘，只有被太阳照到、逆着光看时才亮；盒子摆在有光漏进来的地方（门洞、殿内、林下）。
 * 都读 Atmosphere 的风、时间、日光（先 Atmosphere.bind），位置全在顶点着色器里算，每样一次绘制调用；落叶和鸟吃空气透视和场景雾。
 *
 * 用法：
 *   const life = new AirLife({
 *     leaves: [{ position: [12, 9, -30], radius: 4, ground: 0.2, color: 0xb5452a }],
 *     birds: [{ center: [0, 90, -260], radius: 70 }],
 *     motes: [{ center: [4, 2.5, -12], size: [6, 4, 6] }],
 *   });
 *   group.add(life.group);
 *   life.dispose();   // 卸载这张图时
 */
export interface LeafCrown {
  /** 树冠中心（世界坐标） */
  position: [number, number, number];
  /** 树冠半径（m）：叶子从这个圆盘下面掉 */
  radius: number;
  /** 树脚下地面的世界高度：叶子落到这里就躺着，过一会儿消失 */
  ground: number;
  /** 这棵树循环用的叶子数，默认 10（同时在空中的约三分之一） */
  count?: number;
  /** 叶子的颜色，默认枫红 */
  color?: THREE.ColorRepresentation;
}

export interface BirdFlock {
  /** 盘旋的圆心（世界坐标，y 是飞行高度） */
  center: [number, number, number];
  /** 盘旋半径（m） */
  radius: number;
  /** 几只，默认 7 */
  count?: number;
  /** 飞行速度（m/s），默认 9 */
  speed?: number;
  /** 翼展（m），默认 1.6 */
  size?: number;
}

export interface MoteBox {
  /** 盒子中心（世界坐标） */
  center: [number, number, number];
  /** 盒子的长宽高（m） */
  size: [number, number, number];
  /** 几粒，默认按体积每 2 立方米一粒、最多 400 */
  count?: number;
}

export interface AirLifeOptions {
  leaves?: readonly LeafCrown[];
  birds?: readonly BirdFlock[];
  motes?: readonly MoteBox[];
  seed?: number;
}

const LEAF_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
${ATMOSPHERE_WIND_GLSL}
attribute vec4 aCrown; // 树冠中心 xyz, 半径
attribute vec4 aLeaf;  // 种子, 一轮多少秒, 地面高度, 叶子大小
attribute vec3 aTint;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
	float seed = aLeaf.x, period = aLeaf.y, t = sfWind.w / period + seed;
	float lap = floor( t ), tau = ( t - lap ) * period;
	// 每一轮换一个出发点（树冠圆盘里）
	float h1 = fract( sin( ( lap + seed ) * 91.7 ) * 43758.5453 ), h2 = fract( sin( ( lap + seed ) * 37.3 ) * 24634.6345 );
	float ang = h1 * 6.2832, rad = sqrt( h2 ) * aCrown.w;
	vec3 start = aCrown.xyz + vec3( cos( ang ) * rad, -0.3 * aCrown.w, sin( ang ) * rad );
	float drop = max( start.y - aLeaf.z, 0.1 ), fall = 1.0 + 0.5 * h1, air = min( tau, drop / fall );
	// 飘：左右摆着往下掉，顺风漂一点；阵风锋面扫到时被带出去
	vec2 gust = sfGust( start.xz );
	vec3 c = start + vec3( 0.0, -air * fall, 0.0 );
	c.xz += sfWind.xy * ( air * ( 0.25 + 0.03 * sfWind.z ) + gust.x * 1.6 * min( air, 1.0 ) );
	c.xz += vec2( sin( air * 2.3 + seed * 40.0 ), cos( air * 1.9 + seed * 71.0 ) ) * ( 0.35 * min( air, 1.0 ) );
	float landed = step( drop / fall, tau );
	c.y = max( c.y, aLeaf.z + 0.03 );
	// 翻：空中绕两根轴转，落地后平躺
	float spin = ( 1.0 - landed ) * ( air * ( 3.0 + 4.0 * h2 ) ) + seed * 50.0, tilt = ( 1.0 - landed ) * ( 1.1 * sin( air * 2.7 + seed * 13.0 ) );
	vec3 ax = vec3( cos( spin ), 0.0, sin( spin ) ), az = vec3( -sin( spin ), 0.0, cos( spin ) );
	vec3 up = vec3( 0.0, 1.0, 0.0 );
	vec3 ey = az * cos( tilt ) + up * sin( tilt );
	vec3 wp = c + ( ax * position.x + ey * position.y ) * aLeaf.w;
	vUv = position.xy * 2.0;
	vTint = aTint * ( 0.8 + 0.4 * h1 );
	// 一轮的开头淡入，落地躺一会儿之后淡出；离相机 3 m 内不画（不往脸上糊）
	vFade = smoothstep( 0.0, 0.4, tau ) * ( 1.0 - smoothstep( period - 1.5, period - 0.2, tau ) ) * smoothstep( 2.0, 4.0, distance( c, cameraPosition ) );
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = vFade > 0.01 ? projectionMatrix * mvPosition : vec4( 2.0, 2.0, 2.0, 1.0 );
	#include <fog_vertex>
}
`;

const LEAF_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
uniform vec4 sfSunLight;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
	// 叶形：两头尖的椭圆；淡入淡出用抖动的镂空，不走半透明排序
	float shape = abs( vUv.x ) * 1.25 + vUv.y * vUv.y;
	float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	if ( shape > 1.0 || n > vFade ) discard;
	vec3 c = vTint;
	#ifdef USE_FOG
		c *= sfAtmoAir.rgb * 0.75 + sfSunLight.rgb * ( 0.55 * sfSunShare( vSfWorld ) );
	#endif
	gl_FragColor = vec4( c, 1.0 );
	#include <fog_fragment>
}
`;

const BIRD_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
${ATMOSPHERE_WIND_GLSL}
attribute vec4 aFlock; // 圆心 xyz, 半径
attribute vec4 aBird;  // 相位, 高度偏移, 角速度（弧度 / 秒）, 翼展
void main() {
	float t = sfWind.w, seed = aBird.x;
	float ang = seed * 6.2832 + t * aBird.z;
	float r = aFlock.w * ( 1.0 + 0.18 * sin( t * 0.11 + seed * 9.0 ) );
	vec3 c = aFlock.xyz + vec3( cos( ang ) * r, aBird.y + 2.5 * sin( t * 0.23 + seed * 17.0 ), sin( ang ) * r );
	vec3 fwd = vec3( -sin( ang ), 0.0, cos( ang ) ) * sign( aBird.z ), right = vec3( fwd.z, 0.0, -fwd.x );
	// 扇几下、滑一段：翼尖上下摆，滑翔时停在略高处
	float beat = sin( t * 7.0 + seed * 31.0 ), glide = smoothstep( 0.2, 0.6, sin( t * 0.7 + seed * 23.0 ) );
	float flap = mix( beat * 0.55, 0.12, glide );
	// position.x = -1 / 0 / 1（左翼尖 / 身体 / 右翼尖），position.z 前后
	vec3 wp = c + ( right * position.x + fwd * position.z * 0.55 + vec3( 0.0, abs( position.x ) * flap, 0.0 ) ) * ( aBird.w * 0.5 );
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const BIRD_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
void main() {
	// 逆光的小剪影：暗的蓝灰，远了被空气吃淡
	gl_FragColor = vec4( 0.16, 0.17, 0.2, 1.0 );
	#include <fog_fragment>
}
`;

const MOTE_VERTEX = /* glsl */ `
${ATMOSPHERE_WIND_GLSL}
attribute vec3 aCenter;
attribute vec3 aSize;
attribute vec4 aMote; // 三个种子, 大小
uniform sampler2D sfCloudTex;
uniform vec4 sfAtmoB, sfCloud, sfCloudSlope, sfAtmoSunDir;
varying vec2 vUv;
varying float vGlow;
void main() {
	float t = sfWind.w;
	// 在盒子里循环漂：顺风慢慢走，带一点上下浮动；出了盒子从另一头进来，所以这团尘一直在这个地方
	vec3 drift = vec3( sfWind.x, 0.0, sfWind.y ) * ( 0.12 + 0.02 * sfWind.z ) * t + vec3( 0.0, 0.05 * t, 0.0 );
	vec3 cell = fract( aMote.xyz + drift / aSize ) - 0.5;
	vec3 c = aCenter + cell * aSize + vec3( sin( t * 0.6 + aMote.x * 40.0 ), cos( t * 0.5 + aMote.y * 40.0 ), sin( t * 0.4 + aMote.z * 40.0 ) ) * 0.08;
	// 盒子边上淡掉：看不出盒子的形状
	vec3 edge = smoothstep( 0.5, 0.36, abs( cell ) );
	vec3 v = c - cameraPosition;
	float d = length( v );
	// 只有被太阳照到（云影外）、逆着光看才亮
	vec2 g = c.xz - sfCloudSlope.xy * c.y;
	float share = 1.0 - sfAtmoB.w * ( 1.0 - texture2D( sfCloudTex, g * sfCloud.x + sfCloud.yz ).r );
	float fw = max( dot( v / max( d, 1e-3 ), sfAtmoSunDir.xyz ), 0.0 );
	float twinkle = 0.6 + 0.4 * sin( t * ( 1.5 + aMote.y * 2.0 ) + aMote.z * 60.0 );
	vGlow = edge.x * edge.y * edge.z * share * ( 0.12 + 0.88 * fw * fw * fw ) * twinkle * smoothstep( 1.2, 3.0, d ) * ( 1.0 - smoothstep( 16.0, 28.0, d ) );
	vUv = position.xy * 2.0;
	vec3 cr = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] ), cu = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
	// 尘粒小于一个像素时会闪：大小不低于 1.2 个像素对应的世界尺寸
	float size = max( aMote.w, d * 0.0016 );
	vec4 clip = projectionMatrix * viewMatrix * vec4( c + ( cr * position.x + cu * position.y ) * size, 1.0 );
	gl_Position = vGlow > 0.004 ? clip : vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const MOTE_FRAGMENT = /* glsl */ `
uniform vec4 sfSunLight;
varying vec2 vUv;
varying float vGlow;
void main() {
	float a = max( 1.0 - dot( vUv, vUv ), 0.0 );
	gl_FragColor = vec4( sfSunLight.rgb * ( a * a * vGlow * 0.55 ), 1.0 );
}
`;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUAD = [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0];

export class AirLife {
  readonly group = new THREE.Group();
  private readonly owned: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(options: AirLifeOptions) {
    const rnd = mulberry(options.seed ?? 7301);
    this.group.name = 'AirLife';
    if (options.leaves?.length) this.buildLeaves(options.leaves, rnd);
    if (options.birds?.length) this.buildBirds(options.birds, rnd);
    if (options.motes?.length) this.buildMotes(options.motes, rnd);
  }

  private add(geometry: THREE.InstancedBufferGeometry, count: number, attributes: Record<string, [number, Float32Array]>, material: THREE.ShaderMaterial, name: string): void {
    geometry.instanceCount = count;
    for (const [key, [itemSize, array]] of Object.entries(attributes)) geometry.setAttribute(key, new THREE.InstancedBufferAttribute(array, itemSize));
    // 空气透视的共享 uniform 原样挂上（不克隆）：风、时间、日光、云影
    Object.assign(material.uniforms, Atmosphere.uniforms);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.owned.push(geometry, material);
  }

  private buildLeaves(crowns: readonly LeafCrown[], rnd: () => number): void {
    const total = crowns.reduce((sum, crown) => sum + (crown.count ?? 10), 0);
    const aCrown = new Float32Array(total * 4), aLeaf = new Float32Array(total * 4), aTint = new Float32Array(total * 3), tint = new THREE.Color();
    let o = 0;
    for (const crown of crowns) {
      tint.set(crown.color ?? 0xb5452a);
      // 一轮 = 掉下来的时间的三倍左右：同时在空中的只有三分之一
      const drop = Math.max(1, crown.position[1] - crown.ground);
      for (let i = 0; i < (crown.count ?? 10); i++, o++) {
        aCrown.set([...crown.position, crown.radius], o * 4);
        aLeaf.set([rnd(), drop * (2.4 + 1.2 * rnd()) + 4, crown.ground, 0.22 + 0.12 * rnd()], o * 4);
        aTint.set([tint.r, tint.g, tint.b], o * 3);
      }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(QUAD, 3));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    this.add(geometry, total, { aCrown: [4, aCrown], aLeaf: [4, aLeaf], aTint: [3, aTint] }, new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: LEAF_VERTEX, fragmentShader: LEAF_FRAGMENT, side: THREE.DoubleSide, fog: true, toneMapped: false,
    }), 'AirLife.leaves');
  }

  private buildBirds(flocks: readonly BirdFlock[], rnd: () => number): void {
    const total = flocks.reduce((sum, flock) => sum + (flock.count ?? 7), 0);
    const aFlock = new Float32Array(total * 4), aBird = new Float32Array(total * 4);
    let o = 0;
    for (const flock of flocks) {
      const turn = (flock.speed ?? 9) / Math.max(1, flock.radius) * (rnd() < 0.5 ? -1 : 1), lead = rnd();
      for (let i = 0; i < (flock.count ?? 7); i++, o++) {
        aFlock.set([...flock.center, flock.radius * (0.82 + 0.36 * rnd())], o * 4);
        // 一群挤在圆上的一小段弧里，前后拉开
        aBird.set([lead + (rnd() - 0.5) * 0.09, (rnd() - 0.5) * 6, turn * (0.94 + 0.12 * rnd()), (flock.size ?? 1.6) * (0.85 + 0.3 * rnd())], o * 4);
      }
    }
    // 两片翅膀：身体前后两点 + 左右翼尖
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 0, -0.5, -1, 0, -0.1, 1, 0, -0.1], 3));
    geometry.setIndex([0, 1, 2, 1, 0, 3]);
    this.add(geometry, total, { aFlock: [4, aFlock], aBird: [4, aBird] }, new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: BIRD_VERTEX, fragmentShader: BIRD_FRAGMENT, side: THREE.DoubleSide, fog: true, toneMapped: false,
    }), 'AirLife.birds');
  }

  private buildMotes(boxes: readonly MoteBox[], rnd: () => number): void {
    const counts = boxes.map(box => box.count ?? Math.min(400, Math.max(12, Math.round(box.size[0] * box.size[1] * box.size[2] / 2))));
    const total = counts.reduce((sum, n) => sum + n, 0);
    const aCenter = new Float32Array(total * 3), aSize = new Float32Array(total * 3), aMote = new Float32Array(total * 4);
    let o = 0;
    boxes.forEach((box, b) => {
      for (let i = 0; i < counts[b]; i++, o++) {
        aCenter.set(box.center, o * 3);
        aSize.set(box.size, o * 3);
        aMote.set([rnd(), rnd(), rnd(), 0.012 + 0.014 * rnd()], o * 4);
      }
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(QUAD, 3));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    this.add(geometry, total, { aCenter: [3, aCenter], aSize: [3, aSize], aMote: [4, aMote] }, new THREE.ShaderMaterial({
      uniforms: {}, vertexShader: MOTE_VERTEX, fragmentShader: MOTE_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    }), 'AirLife.motes');
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const item of this.owned) item.dispose();
    this.owned.length = 0;
  }
}
