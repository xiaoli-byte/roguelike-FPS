/**
 * 把 LevelLayout 搭成场景：
 *  - 结构与装饰按材质合批，地面使用生成的石板材质、主题覆盖层与顶点色；
 *  - 半球光 + 平行光（阴影相机按竞技场包围盒精确拟合）+ 数量恒定（LIGHT_COUNT）的闪烁点光源；
 *  - 雾、天空穹顶、远山、环境粒子、地面法阵、火盆火焰（实例化网格动画）。
 * 所有本关创建的几何体 / 材质 / 纹理都登记在 disposables，dispose() 时统一释放。
 * 另提供 addCollision：把布局盒子写入碰撞世界（地面一整块大盒子，顶面 y = floorY）。
 */
import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { GameContext, ThemeDef } from '../core/types';
import type { CollisionWorld } from './Collision';
import type { MatKey } from './Batch';
import { GeoBatch } from './Batch';
import type { LevelLayout } from './LevelGen';
import { drawProps, type FlameSpot } from './Props';
import { Particles, SkyDome, drawFarRing } from './Sky';
import { drawStructures } from './Structures';
import { makeFloorTextures, makeRuneTexture, makeStoneTexture, makeWoodTexture, preloadSceneSurface, surfaceRelief, type FloorTextures } from './Textures';
import type { ThemeStyle } from './Themes';
import { themeStyle } from './Themes';
import { SceneDressing } from './SceneDressing';
import { sceneFlameMaterial } from './SceneFlame';
import { SceneBackdrop } from './SceneBackdrop';
import { AdventureTerrain } from './AdventureTerrain';
import { bakeAdventureRoadMask } from './AdventureRoadMask';
import { ShadowCadence } from './ShadowCadence';
import { SceneArchitecture } from './SceneArchitecture';
import { WhiteboxView } from './WhiteboxView';
import { AuthoredSceneView } from './AuthoredSceneView';
import { showsAuthoredArt } from './WhiteboxMode';

type Rand = () => number;

interface Disposable { dispose(): void }

/** 布局 → 碰撞世界 */
export function addCollision(world: CollisionWorld, L: LevelLayout): void {
  const pad = L.wallThickness + 12;
  world.addBox(L.minX - pad, L.floorY - 4, L.minZ - pad, L.maxX + pad, L.floorY, L.maxZ + pad, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
}

// 火焰几何（模块级缓存，永不释放）
let flameGeo: THREE.PlaneGeometry | null = null;
let runeGeo: THREE.CircleGeometry | null = null;
const _obj = new THREE.Object3D();

function hash2(x: number, z: number, s: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** 平滑值噪声 0..1 */
function vnoise(x: number, z: number, s: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s);
  const b = hash2(ix + 1, iz, s);
  const c = hash2(ix, iz + 1, s);
  const d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

interface Lamp { light: THREE.PointLight; base: number; phase: number; flicker: number }
interface Rune { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; speed: number; base: number }

export class ArenaView {
  readonly group = new THREE.Group();
  private readonly disposables: Disposable[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly runes: Rune[] = [];
  private readonly flameSpots: FlameSpot[] = [];
  private flameOuter: THREE.InstancedMesh | null = null;
  private floorMat: THREE.MeshStandardMaterial | null = null;
  private sunShadow: THREE.DirectionalLightShadow | null = null;
  private readonly shadowCadence = new ShadowCadence();
  private readonly sky: SkyDome | null = null;
  private readonly particles: Particles | null = null;
  private readonly st: ThemeStyle;
  private readonly dressing: SceneDressing | null = null;
  private readonly architecture: SceneArchitecture | null = null;
  private readonly authoredScene: AuthoredSceneView | null = null;
  private disposed = false;

  get artInspectionViews() { return this.authoredScene?.art.inspectionViews ?? []; }
  get artBrief() { return this.authoredScene?.art.identity ?? null; }

  constructor(private readonly ctx: GameContext, private readonly L: LevelLayout, private readonly theme: ThemeDef, rand: Rand) {
    this.group.name = 'arena';
    const st = themeStyle(L.theme);
    this.st = st;
    if (L.whitebox) {
      if (showsAuthoredArt()) {
        this.authoredScene = new AuthoredSceneView(ctx, L, theme, rand);
        this.group.add(this.authoredScene.group); this.disposables.push(this.authoredScene);
      } else {
        const whitebox = new WhiteboxView(ctx, L);
        this.group.add(whitebox.group); this.disposables.push(whitebox);
      }
      return;
    }
    const center = new THREE.Vector3(L.center.x, L.floorY, L.center.z);

    // ── 合批几何 ──
    const mats = this.makeMaterials(rand);
    const batch = new GeoBatch(rand);
    drawStructures(batch, L, st, rand);
    this.dressing = new SceneDressing(ctx, L, st, rand, this.flameSpots);
    this.group.add(this.dressing.group);
    this.disposables.push(this.dressing);
    this.architecture = new SceneArchitecture(ctx, L);
    this.group.add(this.architecture.group); this.disposables.push(this.architecture);
    if (L.adventure) {
      const terrain = new AdventureTerrain(ctx, L);
      this.group.add(terrain.group); this.disposables.push(terrain);
    }
    drawProps(batch, L, st, rand, this.flameSpots, this.dressing.replaced);
    const backdrop = new SceneBackdrop(ctx, L, rand);
    this.group.add(backdrop.group); this.disposables.push(backdrop);
    if (!backdrop.ready) drawFarRing(batch, L, theme, st, rand);
    for (const mesh of batch.build(mats)) {
      this.group.add(mesh);
      this.disposables.push(mesh.geometry);
    }

    this.buildFloor(rand);
    this.buildRunes(rand);
    this.buildFlames();
    this.buildLights(center);

    this.sky = new SkyDome(theme, st, center);
    this.group.add(this.sky.mesh);
    this.disposables.push(this.sky);

    this.particles = new Particles(st, ctx.settings.quality, rand);
    this.group.add(this.particles.points);
    this.disposables.push(this.particles);
  }

  // ───────────── 材质 ─────────────

  private makeMaterials(rand: Rand): Record<MatKey, THREE.Material> {
    const stoneTex = makeStoneTexture(rand);
    const stoneRelief = surfaceRelief(stoneTex);
    const woodTex = makeWoodTexture(rand);
    this.disposables.push(stoneTex, stoneRelief.bump, stoneRelief.roughness, woodTex);
    const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, ...p });
    const far = this.L.theme === 'desert'
      ? new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })
      : std({ roughness: 1 });
    if (this.L.theme === 'desert') {
      // Only the distant backdrop fades early; combat surfaces retain the scene fog.
      far.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
          #ifdef USE_FOG
            float backdropFog = smoothstep(24.0, 125.0, vFogDepth);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, backdropFog);
          #endif`);
      };
      far.customProgramCacheKey = () => 'desert-backdrop-fog-v1';
    }
    const mats: Record<MatKey, THREE.Material> = {
      stone: std({ map: stoneTex, bumpMap: stoneRelief.bump, bumpScale: 0.012, roughnessMap: stoneRelief.roughness, roughness: 0.96 }),
      rough: std({ roughness: 0.95, map: this.L.adventure ? stoneTex : null }),
      wood: std({ map: woodTex, roughness: 0.85 }),
      lacquer: std({ roughness: 0.42, metalness: 0.05 }),
      metal: std({ roughness: 0.38, metalness: 0.45 }),
      gloss: std({ roughness: 0.16, metalness: 0.2 }),
      cloth: std({ roughness: 1, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      far,
    };
    if (this.L.adventure) {
      // The existing lookout's snow cap used an untextured white face. Reuse
      // the authored surface with one world-space sample and restrained grain;
      // no additional geometry, texture allocation or draw call is introduced.
      mats.rough.onBeforeCompile = shader => {
        shader.vertexShader = `varying vec2 vArchitectureSurfaceUv;\n${shader.vertexShader}`
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec3 surfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vec3 surfaceAxis = abs(mat3(modelMatrix) * normal);
            vArchitectureSurfaceUv = (surfaceAxis.y >= max(surfaceAxis.x, surfaceAxis.z)
              ? surfaceWorld.xz : surfaceAxis.x > surfaceAxis.z ? surfaceWorld.zy : surfaceWorld.xy) / 2.0;`);
        shader.fragmentShader = `varying vec2 vArchitectureSurfaceUv;\n${shader.fragmentShader}`
          .replace('#include <map_fragment>', `
            #ifdef USE_MAP
              vec3 surfacePaint = texture2D(map, vArchitectureSurfaceUv).rgb;
              float surfaceGrain = dot(surfacePaint, vec3(.2126, .7152, .0722));
              diffuseColor.rgb *= .88 + surfaceGrain * .18;
            #endif`);
      };
      mats.rough.customProgramCacheKey = () => 'adventure-lookout-paint-v1';
    }
    for (const k of Object.keys(mats) as MatKey[]) this.disposables.push(mats[k]);
    return mats;
  }

  // ───────────── 地面 ─────────────

  private buildFloor(rand: Rand): void {
    const L = this.L;
    const st = this.st;
    const ext = L.half + L.wallThickness + 1;
    const size = ext * 2;
    const segs = 48;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const textureSeed = Math.floor(rand() * 0x100000000);
    const textures = (): FloorTextures => {
      const random = new Rng(textureSeed);
      return makeFloorTextures(L.theme, this.theme, st, () => random.next());
    };
    const tex = textures();
    const ownTextures = (maps: FloorTextures): void => {
      this.disposables.push(maps.map, maps.bump, maps.roughness);
      if (maps.emissive) this.disposables.push(maps.emissive);
    };
    this.disposables.push(geo); ownTextures(tex);

    // 世界坐标 UV + 大尺度明暗噪声 + 墙根暗角
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const seed = rand() * 100;
    const H = L.half;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + L.center.x;
      const z = pos.getZ(i) + L.center.z;
      uv.setXY(i, x / tex.tile, -z / tex.tile);
      let f = 0.9 + (vnoise(x * 0.07, z * 0.07, seed) - 0.5) * 0.22 + (vnoise(x * 0.31, z * 0.31, seed + 3) - 0.5) * 0.1;
      const edge = Math.min(H - Math.abs(x - L.center.x), H - Math.abs(z - L.center.z));
      const e = Math.max(0, Math.min(1, edge / 2.6));
      f *= 0.7 + 0.3 * e * e * (3 - 2 * e);
      col[i * 3] = f;
      col[i * 3 + 1] = f;
      col[i * 3 + 2] = f;
    }
    uv.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      bumpMap: tex.bump,
      bumpScale: L.theme === 'frost' ? 0.005 : 0.010,
      roughnessMap: tex.roughness,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      emissive: tex.emissive ? 0xffffff : 0x000000,
      emissiveMap: tex.emissive,
      emissiveIntensity: tex.emissive ? st.floorGlow * 1.2 : 0,
    });
    this.floorMat = mat;
    // Broad, world-space heat patches keep molten seams near furnace groups and the
    // arena edge. The authored paving stays quiet through the central combat route.
    const heatSpots = L.decos.filter(d => d.kind === 'brazier' && Math.abs(d.y - L.floorY) < 0.1)
      .sort((a, b) => Number(!!b.sceneRole) - Number(!!a.sceneRole)).slice(0, 8);
    const heatUniform = Array.from({ length: 8 }, (_, i) => heatSpots[i]
      ? new THREE.Vector3(heatSpots[i].x, heatSpots[i].z, 4.2 + heatSpots[i].s * 1.4)
      : new THREE.Vector3(1e5, 1e5, 1));
    // Paving is static for the entire stage. Bake the former exact distance
    // falloff once rather than evaluating every segment for every floor pixel.
    let roadMask: THREE.DataTexture | null = null;
    if (L.adventure) {
      const baked = bakeAdventureRoadMask(L.adventure.paths, L.center, ext);
      roadMask = new THREE.DataTexture(baked.data, baked.resolution, baked.resolution, THREE.RedFormat);
      roadMask.name = 'adventure.roadMask';
      roadMask.colorSpace = THREE.NoColorSpace;
      roadMask.minFilter = roadMask.magFilter = THREE.LinearFilter;
      roadMask.generateMipmaps = false;
      roadMask.needsUpdate = true;
      this.disposables.push(roadMask);
    }
    // THREE.Color(hex) converts sRGB theme colours to linear working space, just
    // like the existing colour-map sample. Snow stays restrained under the moon.
    const terrainTint = new THREE.Color(L.theme === 'frost' ? st.snow : st.sand);
    terrainTint.multiplyScalar(L.theme === 'frost' ? .67 : L.theme === 'desert' ? .86 : 1);
    const pavingTint = new THREE.Color(st.paving);
    mat.onBeforeCompile = shader => {
      shader.uniforms.surfaceCenter = { value: new THREE.Vector2(L.center.x, L.center.z) };
      shader.uniforms.surfaceHalf = { value: L.half };
      shader.uniforms.surfaceHeatSpots = { value: heatUniform };
      shader.vertexShader = `varying vec2 vSurfaceWorld;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = `varying vec2 vSurfaceWorld;\nuniform vec2 surfaceCenter;\nuniform float surfaceHalf;\nuniform vec3 surfaceHeatSpots[8];\n${shader.fragmentShader}`
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          #ifdef USE_EMISSIVEMAP
            vec2 surfaceP = vSurfaceWorld - surfaceCenter;
            float heat = 0.0;
            for (int i = 0; i < 8; i++) {
              heat = max(heat, 1.0 - smoothstep(surfaceHeatSpots[i].z * 0.35, surfaceHeatSpots[i].z,
                distance(vSurfaceWorld, surfaceHeatSpots[i].xy)));
            }
            float rim = smoothstep(surfaceHalf * 0.48, surfaceHalf * 0.93, max(abs(surfaceP.x), abs(surfaceP.y)));
            float vein = 0.72 + 0.28 * sin(surfaceP.x * 0.21 + sin(surfaceP.y * 0.18) * 2.0);
            totalEmissiveRadiance *= clamp(0.10 + rim * 0.32 + heat * 0.82, 0.10, 1.0) * vein;
          #endif`);
      if (roadMask) {
        shader.uniforms.adventureRoadMask = { value: roadMask };
        shader.uniforms.adventureRoadExtent = { value: ext };
        shader.uniforms.adventureGround = { value: terrainTint };
        shader.uniforms.adventurePaintedPaving = { value: pavingTint };
        shader.uniforms.adventureCoverRelief = { value: L.theme === 'frost' ? .08 : L.theme === 'desert' ? .12 : .18 };
        shader.fragmentShader = `uniform sampler2D adventureRoadMask;\nuniform float adventureRoadExtent;\nuniform vec3 adventureGround;\nuniform vec3 adventurePaintedPaving;\nuniform float adventureCoverRelief;\n${shader.fragmentShader}`
          .replace('#include <map_fragment>', `#include <map_fragment>
            vec2 roadUV = (vSurfaceWorld - surfaceCenter) / (2.0 * adventureRoadExtent) + .5;
            float roadWeight = texture2D(adventureRoadMask, roadUV).r;
            float adventurePaving = smoothstep(.08, .88, roadWeight);
            // Keep authored stone visible on worn routes; sand, snow and ash
            // cover its joints elsewhere instead of merely tinting every slab.
            float adventureGrain = dot(sampledDiffuseColor.rgb, vec3(.2126, .7152, .0722));
            vec3 adventureCover = adventureGround * (.91 + adventureGrain * .16);`)
          .replace('#include <color_fragment>', `#include <color_fragment>
            // The existing stone sample already has vertex colour. Apply that
            // broad shading once to the painted colour and ground cover too.
            vec3 adventurePaint = adventurePaintedPaving;
            #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
              adventureCover *= vColor.rgb;
              adventurePaint *= vColor.rgb;
            #endif
            vec3 adventureStone = mix(adventurePaint, diffuseColor.rgb, .4);
            diffuseColor.rgb = mix(adventureCover, adventureStone, adventurePaving);`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            roughnessFactor = mix(.98, roughnessFactor, adventurePaving);`)
          .replace('#include <normal_fragment_maps>', `
            vec3 adventureBaseNormal = normal;
            #include <normal_fragment_maps>
            normal = normalize(mix(adventureBaseNormal, normal, mix(adventureCoverRelief, 1.0, adventurePaving)));`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            #ifdef USE_EMISSIVEMAP
              totalEmissiveRadiance *= mix(.16, 1.0, adventurePaving);
            #endif`);
      }
    };
    mat.customProgramCacheKey = () => L.adventure ? 'adventure-ground-mask-v5' : 'scene-paving-v1';
    this.disposables.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'floor';
    mesh.position.set(L.center.x, L.floorY, L.center.z);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    // A fast first stage may be built before the background image load finishes.
    // Upgrade its maps once, and never touch an arena that has already been unloaded.
    if (!tex.authored) void preloadSceneSurface().then(ready => {
      if (!ready || this.disposed) return;
      const upgraded = textures(); ownTextures(upgraded);
      mat.map = upgraded.map; mat.bumpMap = upgraded.bump; mat.roughnessMap = upgraded.roughness;
      mat.emissiveMap = upgraded.emissive; mat.needsUpdate = true;
    });
  }

  /** 地面法阵（纯装饰，缓慢旋转） */
  private buildRunes(rand: Rand): void {
    if (this.L.runes.length === 0) return;
    if (!runeGeo) {
      runeGeo = new THREE.CircleGeometry(1, 64);
      runeGeo.rotateX(-Math.PI / 2);
    }
    const tex = makeRuneTexture(rand);
    this.disposables.push(tex);
    for (const r of this.L.runes) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: r.gold ? this.st.gold : this.theme.accent,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.disposables.push(mat);
      const mesh = new THREE.Mesh(runeGeo, mat);
      mesh.position.set(r.x, this.L.floorY + 0.03, r.z);
      mesh.scale.setScalar(r.r);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.runes.push({ mesh, mat, speed: (rand() < 0.5 ? -1 : 1) * (0.04 + rand() * 0.04), base: 0.42 + rand() * 0.12 });
    }
  }

  // ───────────── 火焰 ─────────────

  private buildFlames(): void {
    const n = this.flameSpots.length;
    if (n === 0) return;
    if (!flameGeo) {
      flameGeo = new THREE.PlaneGeometry(1, 1);
    }
    const outerMat = sceneFlameMaterial(this.st);
    this.disposables.push(outerMat);
    this.flameOuter = new THREE.InstancedMesh(flameGeo, outerMat, n);
    for (const m of [this.flameOuter]) {
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      this.disposables.push(m);
    }
    this.updateFlames(0);
  }

  private updateFlames(t: number): void {
    const outer = this.flameOuter;
    if (!outer) return;
    (outer.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    for (let i = 0; i < this.flameSpots.length; i++) {
      const f = this.flameSpots[i];
      const k = 1 + 0.12 * Math.sin(t * 7 + i * 1.7) + 0.06 * Math.sin(t * 15.3 + i * 3.1);
      const w = 1 - 0.07 * Math.sin(t * 13.7 + i);
      _obj.position.set(f.x, f.y, f.z);
      _obj.rotation.set(0, 0, 0);
      _obj.scale.set(f.s * w * 0.8, f.s * k * 1.05, 1);
      _obj.updateMatrix();
      outer.setMatrixAt(i, _obj.matrix);
    }
    outer.instanceMatrix.needsUpdate = true;
  }

  // ───────────── 灯光 ─────────────

  private buildLights(center: THREE.Vector3): void {
    const L = this.L;
    const st = this.st;
    const theme = this.theme;
    const ctx = this.ctx;

    const hemi = new THREE.HemisphereLight(st.hemiSky, st.hemiGround, st.hemiIntensity);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(theme.sun, st.sunIntensity);
    const dir = new THREE.Vector3(st.sunDir[0], st.sunDir[1], st.sunDir[2]).normalize();
    sun.position.copy(center).addScaledVector(dir, 110);
    sun.target.position.copy(center);
    this.group.add(sun, sun.target);
    this.disposables.push(sun);

    const quality = ctx.settings.quality;
    if (quality !== 'low') {
      sun.castShadow = true;
      // The sun and scenery are stationary. Reuse the map between updates;
      // animated enemies and loot still refresh at 30 Hz at full resolution.
      sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
      this.sunShadow = sun.shadow;
      const size = quality === 'high' ? 2048 : 1024;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.035;
      // 把竞技场（含围墙与墙顶装饰）的 8 个角投到光源视空间，精确拟合正交阴影相机
      const cam = sun.shadow.camera;
      const probe = new THREE.OrthographicCamera();
      probe.position.copy(sun.position);
      probe.lookAt(center);
      probe.updateMatrixWorld(true);
      const inv = probe.matrixWorldInverse;
      const e = L.half + L.wallThickness + 1;
      const top = L.floorY + L.wallHeight + 4.5;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const p = new THREE.Vector3();
      for (const x of [center.x - e, center.x + e]) {
        for (const y of [L.floorY - 0.5, top]) {
          for (const z of [center.z - e, center.z + e]) {
            p.set(x, y, z).applyMatrix4(inv);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
            minZ = Math.min(minZ, p.z);
            maxZ = Math.max(maxZ, p.z);
          }
        }
      }
      cam.left = minX;
      cam.right = maxX;
      cam.bottom = minY;
      cam.top = maxY;
      cam.near = Math.max(0.5, -maxZ - 2);
      cam.far = -minZ + 2;
      cam.updateProjectionMatrix();
    }

    // 点光源数量恒定为 LIGHT_COUNT（换关不触发着色器重编译）
    const flickerAmt = L.theme === 'frost' ? 0.35 : 1;
    for (let i = 0; i < L.lights.length; i++) {
      const s = L.lights[i];
      const light = new THREE.PointLight(st.lampColor, st.lampIntensity, 18, 1.4);
      light.position.set(s.x, s.y, s.z);
      light.castShadow = false;
      this.group.add(light);
      this.disposables.push(light);
      this.lamps.push({ light, base: st.lampIntensity, phase: i * 2.17, flicker: flickerAmt });
    }

    ctx.scene.fog = new THREE.Fog(theme.fogColor, st.fogNear, st.fogFar);
  }

  // ───────────── 每帧 ─────────────

  update(_dt: number, t: number): void {
    if (this.disposed) return;
    this.authoredScene?.update(_dt, t);
    if (this.sunShadow && this.shadowCadence.advance(_dt, this.ctx.world.version)) this.sunShadow.needsUpdate = true;
    this.dressing?.update(t);
    this.architecture?.update(this.ctx.camera);
    for (const l of this.lamps) {
      const f = 0.1 * Math.sin(t * 9.3 + l.phase) + 0.06 * Math.sin(t * 23.1 + l.phase * 2.3) + 0.04 * Math.sin(t * 3.7 + l.phase);
      l.light.intensity = l.base * (1 + f * l.flicker);
    }
    this.updateFlames(t);
    for (const r of this.runes) {
      r.mesh.rotation.y = t * r.speed;
      r.mat.opacity = r.base * (0.8 + 0.2 * Math.sin(t * 1.3 + r.speed * 40));
    }
    if (this.floorMat && this.st.floorGlow > 0) {
      this.floorMat.emissiveIntensity = this.st.floorGlow * (0.92 + 0.07 * Math.sin(t * 1.1) + 0.03 * Math.sin(t * 3.1));
    }
    this.sky?.update(t);
    const canvas = this.ctx.renderer.domElement;
    this.particles?.update(t, this.ctx.camera, canvas.height || 1080);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch (err) {
        console.error('[ArenaView] dispose failed', err);
      }
    }
    this.disposables.length = 0;
    this.lamps.length = 0;
    this.runes.length = 0;
    this.group.clear();
    if (this.ctx.scene.fog) this.ctx.scene.fog = null;
  }
}
