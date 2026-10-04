/** Art pass over the reviewed floor plans; every sculpted silhouette is a published Hunyuan asset. */
import * as THREE from 'three';
import type { GameContext, ThemeDef } from '../core/types';
import { Rng } from '../core/Rng';
import { AssetLibrary } from '../assets/AssetLibrary';
import type { LevelLayout } from './LevelTypes';
import { buildAuthoredSceneLayout } from './AuthoredSceneLayout';
import type { AuthoredSceneLayout, AuthoredBoundary } from './AuthoredSceneLayout';
import { SceneArchitecture } from './SceneArchitecture';
import { AuthoredArtOcclusion } from './AuthoredArtOcclusion';
import { SceneBackdrop } from './SceneBackdrop';
import { Particles, SkyDome } from './Sky';
import { themeStyle } from './Themes';
import { makeFloorTextures, preloadSceneSurface } from './Textures';
import type { FloorTextures } from './Textures';
import { ShadowCadence } from './ShadowCadence';
import { bakeAdventureRoadMask } from './AdventureRoadMask';

type Vec = readonly [number, number, number];

/** Selected working / ceremonial floors; the surrounding rooms retain their natural ground. */
const ROOM_PAVING: Record<string, Record<string, number>> = {
  'desert-1': { exit: .7 },
  'desert-2': { well: .78, north: .72, cargo: .5, gate: .64 },
  'desert-3': { north: .85, inner: .48, court: .64 },
  'desert-4': { court1: .68, court2: .45, court3: .82, court4: .72, sanctum: .95, cloister: .42 },
  'desert-5': { arena: .82, entry: .58 },
  'frost-1': { chapel: .86, patrol: .26 },
  'frost-2': { lower: .65, exit: .85 },
  'frost-3': { entry: .62, middle: .8, north: .76, 'lower-pier': .48, 'middle-pier': .75, 'upper-pier': .85, supplies: .42 },
  'frost-4': { north: .55, west: .72, east: .42, sanctum: .92 },
  'frost-5': { entry: .72, arena: .8, 'south-bay': .42 },
  'inferno-1': { yard: .65, store: .5, altar: .88 },
  'inferno-2': { work: .72, feed: .6, furnace: .94, ash: .3, slag: .35 },
  'inferno-3': { transfer: .5, repair: .66, receiver: .82, sluice: .94 },
  'inferno-4': { cooling: .45, molds: .76, control: .95, repair: .56 },
  'inferno-5': { cold: .45, hot: .88, exit: .8, cooling: .35 },
};
const smooth = (a: number, b: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t);
};

/** One stage-baked RGBA sample: travelled route, room paving, wind deposits, broad surface wear. */
export function bakeAuthoredGroundField(layout: LevelLayout, boundaries: readonly AuthoredBoundary[], resolution = 384): {
  data: Uint8Array; resolution: number; extent: number;
} {
  const plan = layout.whitebox!.plan, extent = layout.half + 2;
  const route = bakeAdventureRoadMask((layout.adventure?.paths ?? []).map(path => ({ ...path, width: path.width * .4 })), { x: 0, z: 0 }, extent, resolution);
  const deposits = bakeAdventureRoadMask(boundaries.map(edge => ({ points: [edge.a, edge.b],
    width: (layout.theme === 'frost' ? 2.7 : 1.8) * (.7 + Math.max(0, edge.outward.x * .8 - edge.outward.z * .6)),
  })), { x: 0, z: 0 }, extent, resolution);
  const data = new Uint8Array(resolution * resolution * 4), step = extent * 2 / resolution;
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const i = z * resolution + x, wx = -extent + (x + .5) * step, wz = -extent + (z + .5) * step;
    // Baked metre-scale drift keeps borders soft without spending fragment work on noise.
    const broad = .5 + .22 * Math.sin(wx * .093 + wz * .051) + .16 * Math.cos(wz * .137 - wx * .029) + .1 * Math.sin(wx * .181 - wz * .079);
    data[i * 4] = route.data[i];
    data[i * 4 + 2] = Math.round(deposits.data[i] * (.55 + broad * .45));
    data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, broad)) * 255);
  }
  for (const room of plan.rooms) {
    const weight = ROOM_PAVING[plan.id]?.[room.id]; if (!weight) continue;
    const polygon = room.polygon.map(([x, z]) => ({ x: x - plan.bounds[0] / 2, z: z - plan.bounds[1] / 2 }));
    const xs = polygon.map(p => p.x), zs = polygon.map(p => p.z);
    const minX = Math.max(0, Math.floor((Math.min(...xs) + extent) / step)), maxX = Math.min(resolution - 1, Math.ceil((Math.max(...xs) + extent) / step));
    const minZ = Math.max(0, Math.floor((Math.min(...zs) + extent) / step)), maxZ = Math.min(resolution - 1, Math.ceil((Math.max(...zs) + extent) / step));
    for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
      const x = -extent + (ix + .5) * step, z = -extent + (iz + .5) * step;
      let inside = false, distance = Infinity;
      for (let j = 0, previous = polygon.length - 1; j < polygon.length; previous = j++) {
        const a = polygon[previous], b = polygon[j], dx = b.x - a.x, dz = b.z - a.z;
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / Math.max(.001, dx * dx + dz * dz)));
        distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
      }
      if (!inside) continue;
      const i = (iz * resolution + ix) * 4;
      const feather = 2.2 + data[i + 3] / 255 * 1.6;
      data[i + 1] = Math.max(data[i + 1], Math.round(weight * smooth(.5, feather, distance) * 255));
    }
  }
  if (plan.id === 'inferno-3') {
    // Unequal cooling pools occupy the slag strip, separated by broad dark crust.
    const reaches = [
      { width: 10, points: [[55, 15], [59, 24]] },
      { width: 13, points: [[54, 49], [59, 56]] },
      { width: 10, points: [[65, 78], [61, 89]] },
      { width: 11, points: [[56, 109], [64, 120]] },
      { width: 6, points: [[75, 49], [76, 52]] },
    ].map(path => ({ width: path.width, points: path.points.map(([x, z]) => ({ x: x - plan.bounds[0] / 2, z: z - plan.bounds[1] / 2 })) }));
    const heat = bakeAdventureRoadMask(reaches, { x: 0, z: 0 }, extent, resolution);
    for (let i = 0; i < resolution * resolution; i++) data[i * 4 + 3] = Math.round(heat.data[i] * (.62 + data[i * 4 + 3] / 255 * .38));
  }
  return { data, resolution, extent };
}

/** Technical surface skin only: no replacement sculptures, facades or generated prop meshes. */
class SurfaceBuffer {
  private readonly positions: number[] = [];
  private readonly uv: number[] = [];
  private readonly colours: number[] = [];

  quad(a: Vec, b: Vec, c: Vec, d: Vec, colour: THREE.Color, vertical = false): void {
    for (const p of [a, b, d, b, c, d]) {
      this.positions.push(...p);
      this.uv.push(vertical ? (Math.abs(b[0] - a[0]) > .001 ? p[0] : p[2]) / 3 : p[0] / 8,
        vertical ? p[1] / 3 : -p[2] / 8);
      this.colours.push(colour.r, colour.g, colour.b);
    }
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return geometry;
  }
}

export class AuthoredSceneView {
  readonly group = new THREE.Group();
  readonly art: AuthoredSceneLayout;
  private readonly owned: { dispose(): void }[] = [];
  private readonly architecture: SceneArchitecture;
  private readonly sky: SkyDome;
  private readonly particles: Particles;
  private readonly shadowCadence = new ShadowCadence();
  private readonly previousBackground: THREE.Scene['background'];
  private readonly previousFog: THREE.Scene['fog'];
  private sunShadow: THREE.DirectionalLightShadow | null = null;
  private floorMaterial: THREE.MeshStandardMaterial | null = null;
  private focalLight: THREE.PointLight | null = null;
  private readonly focalFixtures: { id: string; position: THREE.Vector3 }[] = [];
  private readonly focalCameraPosition = new THREE.Vector3();
  private focalFixtureIndex = -1;
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly layout: LevelLayout, private readonly theme: ThemeDef, rand: () => number) {
    if (!layout.whitebox) throw new Error('Authored scenery requires a reviewed floor plan');
    this.group.name = `authored.art.${layout.whitebox.planId}`;
    this.art = buildAuthoredSceneLayout(layout);
    const style = themeStyle(layout.theme), center = new THREE.Vector3(layout.center.x, layout.floorY, layout.center.z);
    this.previousBackground = ctx.scene.background; this.previousFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color(theme.fogColor);
    ctx.scene.fog = new THREE.Fog(theme.fogColor, Math.max(42, style.fogNear), Math.max(155, style.fogFar));

    this.buildGround(rand);
    this.buildClosure();
    this.architecture = new SceneArchitecture(ctx, { ...layout, architecture: [...this.art.architecture, ...this.art.decks] });
    this.group.add(this.architecture.group); this.owned.push(this.architecture);
    const backdropSeed = Math.floor(rand() * 0xFFFFFFFF);
    // Gameplay center is the last encounter, not the reviewed map's geometric centre.
    // Backdrop clearance is radial around the map bounds; keep its copy independent.
    const backdropLayout = { ...layout, center: { x: (layout.minX + layout.maxX) * .5, z: (layout.minZ + layout.maxZ) * .5 } };
    const makeBackdrop = (): SceneBackdrop => {
      const rng = new Rng(backdropSeed);
      return new SceneBackdrop(ctx, backdropLayout, () => rng.next());
    };
    const backdrop = makeBackdrop();
    this.group.add(backdrop.group); this.owned.push(backdrop);
    if (!backdrop.ready) void AssetLibrary.preload().then(() => {
      if (this.disposed || backdrop.ready) return;
      backdrop.dispose();
      const loaded = makeBackdrop(); this.group.add(loaded.group); this.owned.push(loaded);
    });
    this.buildLights(center);
    this.buildFocalLights();
    this.sky = new SkyDome(theme, style, center);
    this.group.add(this.sky.mesh); this.owned.push(this.sky);
    this.particles = new Particles(style, ctx.settings.quality, rand);
    this.group.add(this.particles.points); this.owned.push(this.particles);
    this.buildArtOcclusion();
    this.group.userData.authoredArt = {
      planId: this.art.planId, title: this.art.title, identity: this.art.identity,
      placements: this.art.placements.length, decks: this.art.decks.length, boundaries: this.art.boundaries.length,
      assets: [...new Set([...this.art.placements, ...this.art.decks].map(p => p.assetId))],
    };
  }

  private buildArtOcclusion(): void {
    const windows = this.art.rayWindows;
    if (!windows.length) return;
    // Until all local art is ready, the original solid collision must also look solid.
    // These temporary technical faces disappear in the same turn that mesh rays activate.
    const pending = new Map<string, THREE.Mesh>();
    const material = new THREE.MeshStandardMaterial({ color: themeStyle(this.layout.theme).stone,
      map: this.floorMaterial?.map, roughness: 1, side: THREE.DoubleSide });
    this.owned.push(material);
    for (const spec of windows) {
      const b = spec.bounds, surface = new SurfaceBuffer(), colour = new THREE.Color(0xffffff);
      surface.quad([b.minX, b.minY, b.minZ], [b.maxX, b.minY, b.minZ], [b.maxX, b.maxY, b.minZ], [b.minX, b.maxY, b.minZ], colour, true);
      surface.quad([b.maxX, b.minY, b.maxZ], [b.minX, b.minY, b.maxZ], [b.minX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.maxZ], colour, true);
      surface.quad([b.minX, b.minY, b.maxZ], [b.minX, b.minY, b.minZ], [b.minX, b.maxY, b.minZ], [b.minX, b.maxY, b.maxZ], colour, true);
      surface.quad([b.maxX, b.minY, b.minZ], [b.maxX, b.minY, b.maxZ], [b.maxX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.minZ], colour, true);
      surface.quad([b.minX, b.maxY, b.minZ], [b.maxX, b.maxY, b.minZ], [b.maxX, b.maxY, b.maxZ], [b.minX, b.maxY, b.maxZ], colour);
      const geometry = surface.geometry(), mesh = new THREE.Mesh(geometry, material);
      mesh.name = `authored.ray-window.pending.${spec.id}`; mesh.receiveShadow = true;
      this.group.add(mesh); this.owned.push(geometry); pending.set(spec.id, mesh);
    }
    this.owned.push(new AuthoredArtOcclusion(this.ctx.world, [...this.art.placements, ...this.art.decks], windows,
      id => { const mesh = pending.get(id); if (mesh) mesh.visible = false; }));
  }

  private addSurface(buffer: SurfaceBuffer, material: THREE.Material, name: string, castShadow = false): void {
    const geometry = buffer.geometry(), mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.receiveShadow = true; mesh.castShadow = castShadow && this.ctx.settings.quality !== 'low';
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh); this.owned.push(geometry);
  }

  private ownTextures(textures: FloorTextures): void {
    this.owned.push(textures.map, textures.bump, textures.roughness);
    if (textures.emissive) this.owned.push(textures.emissive);
  }

  private buildGround(rand: () => number): void {
    const layout = this.layout, style = themeStyle(layout.theme), seed = Math.floor(rand() * 0xFFFFFFFF);
    const textures = (): FloorTextures => {
      const rng = new Rng(seed);
      return makeFloorTextures(layout.theme, this.theme, style, () => rng.next());
    };
    const maps = textures(); this.ownTextures(maps);
    const material = new THREE.MeshStandardMaterial({
      map: maps.map, bumpMap: maps.bump, bumpScale: layout.theme === 'frost' ? .005 : .012,
      roughnessMap: maps.roughness, roughness: .97, metalness: 0, vertexColors: true,
      emissive: maps.emissive ? 0xffffff : 0x000000, emissiveMap: maps.emissive,
      emissiveIntensity: layout.theme === 'inferno' ? .16 : 0,
    });
    this.floorMaterial = material; this.owned.push(material);
    const baked = bakeAuthoredGroundField(layout, this.art.boundaries), extent = baked.extent;
    const mask = new THREE.DataTexture(baked.data, baked.resolution, baked.resolution, THREE.RGBAFormat);
    mask.minFilter = mask.magFilter = THREE.LinearFilter; mask.generateMipmaps = false; mask.needsUpdate = true;
    this.owned.push(mask);
    const ground = new THREE.Color(layout.theme === 'desert' ? 0xd9b88b : layout.theme === 'frost' ? 0xb8d0df : 0x666a7a);
    const paving = new THREE.Color(layout.theme === 'desert' ? 0xd8c3a0 : layout.theme === 'frost' ? 0x9eb7c8 : 0x928b91);
    const weather = new THREE.Color(layout.theme === 'desert' ? 0xe6cba0 : layout.theme === 'frost' ? 0xd4e2e8 : 0x444957);
    material.onBeforeCompile = shader => {
      shader.uniforms.authoredRoad = { value: mask };
      shader.uniforms.authoredExtent = { value: extent };
      shader.uniforms.authoredGround = { value: ground };
      shader.uniforms.authoredPaving = { value: paving };
      shader.uniforms.authoredWeather = { value: weather };
      shader.vertexShader = `varying vec2 vAuthoredWorld;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAuthoredWorld = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = `varying vec2 vAuthoredWorld;\nuniform sampler2D authoredRoad;\nuniform float authoredExtent;\nuniform vec3 authoredGround;\nuniform vec3 authoredPaving;\nuniform vec3 authoredWeather;\n${shader.fragmentShader}`
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 authoredField = texture2D(authoredRoad, vAuthoredWorld / (2.0 * authoredExtent) + .5);
          float authoredWay = authoredField.r;
          float authoredStone = max(authoredWay * .62, authoredField.g) * (1.0 - authoredField.b * .88);
          float authoredGrain = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
          vec3 naturalGround = mix(authoredGround, authoredWeather, authoredField.b * .7);
          vec3 paintedGround = mix(naturalGround, authoredPaving, authoredStone) * (.92 + authoredGrain * .14);
          diffuseColor.rgb = mix(paintedGround, diffuseColor.rgb, .07 + authoredStone * .48);
          diffuseColor.rgb *= .93 + authoredField.a * .13;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(.98, roughnessFactor, authoredStone);`)
        .replace('#include <normal_fragment_maps>', `vec3 authoredBaseNormal = normal;
          #include <normal_fragment_maps>
          normal = normalize(mix(authoredBaseNormal, normal, .08 + authoredStone * .52));`);
    };
    material.customProgramCacheKey = () => 'authored-painted-ground-v2';
    const floor = new SurfaceBuffer(), pointColour = new THREE.Color();
    for (const rect of layout.whitebox!.floorRects) {
      pointColour.setRGB(.97, .97, .97);
      floor.quad([rect.minX, layout.floorY, rect.minZ], [rect.minX, layout.floorY, rect.maxZ],
        [rect.maxX, layout.floorY, rect.maxZ], [rect.maxX, layout.floorY, rect.minZ], pointColour);
    }
    this.addSurface(floor, material, 'authored.paving.exact-floor-plan');

    // A quiet substrate behind the boundary assets seals the horizon and their ground contacts.
    // It is below the playable floor and cannot add walkable terrain or change route geometry.
    const outside = new SurfaceBuffer(), pad = 180, y = layout.floorY - .03;
    const tint = new THREE.Color().setRGB(.97, .97, .97);
    outside.quad([layout.minX - pad, y, layout.minZ - pad], [layout.minX - pad, y, layout.maxZ + pad],
      [layout.maxX + pad, y, layout.maxZ + pad], [layout.maxX + pad, y, layout.minZ - pad], tint);
    const substrate = this.makeSubstrateMaterial(material);
    this.addSurface(outside, substrate, 'authored.horizon.substrate');

    if (!maps.authored) void preloadSceneSurface().then(ready => {
      if (!ready || this.disposed) return;
      const loaded = textures(); this.ownTextures(loaded);
      material.map = loaded.map; material.bumpMap = loaded.bump;
      material.roughnessMap = loaded.roughness; material.emissiveMap = loaded.emissive;
      material.needsUpdate = true;
      if (substrate !== material) { substrate.map = loaded.map; substrate.needsUpdate = true; }
    });
  }

  /** Two reviewed bridge geographies, applied only to the existing plane below the walk surface. */
  private makeSubstrateMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const plan = this.layout.whitebox!.plan;
    if (plan.id !== 'frost-3' && plan.id !== 'inferno-3') return base;
    const ice = plan.id === 'frost-3', material = base.clone();
    material.name = ice ? 'authored.frozen-lake' : 'authored.slag-channel';
    material.bumpMap = null; material.roughnessMap = null;
    material.roughness = ice ? .48 : .97; material.metalness = 0;
    material.emissiveMap = null;
    material.emissive.set(ice ? 0x000000 : 0xd4512a); material.emissiveIntensity = ice ? 0 : .45;
    const cool = new THREE.Color(ice ? 0x3a6e8b : 0x292733), hot = new THREE.Color(0x9d4633);
    // The isolation strip is the interval between the western transfer / repair courts and
    // the three eastern landing courts. Read their authored polygons rather than a generic arena band.
    const west = plan.rooms.filter(room => room.id === 'transfer' || room.id === 'repair');
    const east = plan.rooms.filter(room => ['north-bank', 'receiver', 'sluice'].includes(room.id));
    const left = ice ? 0 : Math.max(...west.flatMap(room => room.polygon.map(point => point[0]))) - plan.bounds[0] / 2;
    const right = ice ? 0 : Math.min(...east.flatMap(room => room.polygon.map(point => point[0]))) - plan.bounds[0] / 2;
    const north = ice ? 0 : Math.min(...plan.rooms.flatMap(room => room.polygon.map(point => point[1]))) - plan.bounds[1] / 2 - 7;
    const south = ice ? 0 : Math.max(...plan.rooms.flatMap(room => room.polygon.map(point => point[1]))) - plan.bounds[1] / 2 + 7;
    material.userData.substrate = { kind: ice ? 'ice' : 'slag', channel: ice ? null : { left, right, north, south } };
    material.onBeforeCompile = (shader, renderer) => {
      base.onBeforeCompile(shader, renderer);
      shader.uniforms.substrateCool = { value: cool }; shader.uniforms.substrateHot = { value: hot };
      shader.uniforms.substrateChannel = { value: new THREE.Vector4(left, right, north, south) };
      shader.fragmentShader = `uniform vec3 substrateCool;\nuniform vec3 substrateHot;\nuniform vec4 substrateChannel;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', ice ? `
          // Unequal frozen plates and shore drift use the same baked field, with no animated noise.
          float frozenPlate = smoothstep(.36, .76, authoredField.a);
          diffuseColor.rgb = mix(substrateCool, substrateCool * 1.32, frozenPlate * .55 + authoredField.b * .25)
            * (.94 + authoredGrain * .12);
          #include <color_fragment>` : `
          float channelBend = sin(vAuthoredWorld.y * .041 + .8) * 2.4;
          float channelSides = smoothstep(substrateChannel.x - 3.5, substrateChannel.x + 3.0, vAuthoredWorld.x + channelBend)
            * (1.0 - smoothstep(substrateChannel.y - 3.0, substrateChannel.y + 3.5, vAuthoredWorld.x + channelBend * .6));
          float channelEnds = smoothstep(substrateChannel.z - 7.0, substrateChannel.z + 3.0, vAuthoredWorld.y)
            * (1.0 - smoothstep(substrateChannel.w - 3.0, substrateChannel.w + 7.0, vAuthoredWorld.y));
          float slagChannel = channelSides * channelEnds;
          float slagHeat = smoothstep(.12, .88, authoredField.a) * slagChannel;
          vec3 slagPaint = mix(substrateCool * (.93 + authoredGrain * .14), substrateHot, slagHeat * .36);
          diffuseColor.rgb = mix(diffuseColor.rgb, slagPaint, slagChannel);
          #include <color_fragment>`);
      if (!ice) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= slagHeat * .58;');
      else shader.fragmentShader = shader.fragmentShader.replace('roughnessFactor = mix(.98, roughnessFactor, authoredStone);',
        'roughnessFactor = .43 + authoredField.b * .2 + (1.0 - authoredField.a) * .08;');
    };
    material.customProgramCacheKey = () => ice ? 'authored-frozen-lake-v2' : 'authored-slag-channel-v2';
    this.owned.push(material); return material;
  }

  private buildClosure(): void {
    const layout = this.layout, style = themeStyle(layout.theme);
    const material = new THREE.MeshStandardMaterial({
      map: this.floorMaterial?.map, roughness: .97, metalness: 0, vertexColors: true, side: THREE.FrontSide,
    });
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 closurePaint = texture2D(map, vMapUv);
          diffuseColor.rgb *= .9 + dot(closurePaint.rgb, vec3(.2126, .7152, .0722)) * .16;
        #endif`);
    };
    material.customProgramCacheKey = () => 'authored-quiet-closure-v1';
    this.owned.push(material);
    const backing = new SurfaceBuffer();
    const colour = new THREE.Color(style.stone2).lerp(new THREE.Color(style.stone), .7);
    const bottom = layout.floorY - .08, top = layout.floorY + layout.wallHeight;
    for (const edge of this.art.boundaries) {
      // Continuous rock banks are assembled from Hunyuan cliffs. A tall raster-edge curtain
      // would slice through their silhouette, so only a straight architectural facade gets a back skin.
      if (edge.length < 3.5) continue;
      const facades = this.art.placements.filter(p => p.boundaryId === edge.id && p.role === 'boundary');
      if (!facades.length || facades.some(p => !p.assetId.endsWith('Wall'))) continue;
      const axis = edge.outward.x ? 'x' : 'z', along = edge.outward.x ? 'z' : 'x';
      for (const p of facades) {
        const c = Math.abs(Math.cos(p.yaw)), s = Math.abs(Math.sin(p.yaw));
        const hx = (p.envelope.width * c + p.envelope.depth * s) * p.s * .5;
        const hz = (p.envelope.width * s + p.envelope.depth * c) * p.s * .5;
        // A support belongs inside its individual wall's mass. A single plane behind a
        // whole boundary protrudes at staggered ends and beside shorter neighbouring walls.
        // Leave the sculpted ends, columns and cornice entirely to the published mesh.
        const halfSpan = (edge.outward.x ? hz : hx) * .8;
        const start = Math.max(edge.a[along], p[along] - halfSpan);
        const end = Math.min(edge.b[along], p[along] + halfSpan);
        if (end - start < .2) continue;
        const plane = p[axis];
        let facadeTop = Math.min(top, p.y + p.envelope.height * p.s * .72);
        // Preserve the real sightlines that layout opened through the published pieces.
        for (const story of this.art.placements) {
          if (!story.story) continue;
          const observer = story.story.observer, delta = story[axis] - observer[axis];
          if (Math.abs(delta) < .001) continue;
          const fraction = (plane - observer[axis]) / delta;
          if (fraction <= 0 || fraction >= 1) continue;
          const hitAlong = observer[along] + (story[along] - observer[along]) * fraction;
          if (hitAlong < start - .1 || hitAlong > end + .1) continue;
          const hitHeight = layout.floorY + 1.62 + (story.y + story.story.focusHeight - layout.floorY - 1.62) * fraction;
          if (hitHeight > layout.floorY + .2 && hitHeight < facadeTop)
            facadeTop = Math.max(layout.floorY + .15, Math.min(facadeTop, hitHeight - .2));
        }
        const facesOutward = -(edge.b.z - edge.a.z) * edge.outward.x + (edge.b.x - edge.a.x) * edge.outward.z > 0;
        let supports = [{ start, end, low: bottom, high: facadeTop }];
        for (const window of this.art.rayWindows) {
          const w = window.bounds, minPlane = axis === 'x' ? w.minX : w.minZ, maxPlane = axis === 'x' ? w.maxX : w.maxZ;
          if (plane < minPlane || plane > maxPlane) continue;
          const minAlong = along === 'x' ? w.minX : w.minZ, maxAlong = along === 'x' ? w.maxX : w.maxZ;
          const remaining: typeof supports = [];
          for (const support of supports) {
            const from = Math.max(support.start, minAlong), to = Math.min(support.end, maxAlong);
            const low = Math.max(support.low, w.minY), high = Math.min(support.high, w.maxY);
            if (from >= to || low >= high) { remaining.push(support); continue; }
            // Inside the aperture only the published triangles are visible and bullet-blocking.
            if (support.low < low) remaining.push({ ...support, high: low });
            if (support.high > high) remaining.push({ ...support, low: high });
            if (support.start < from) remaining.push({ start: support.start, end: from, low, high });
            if (support.end > to) remaining.push({ start: to, end: support.end, low, high });
          }
          supports = remaining;
        }
        for (const support of supports) {
          const a: Vec = axis === 'x' ? [plane, support.low, support.start] : [support.start, support.low, plane];
          const b: Vec = axis === 'x' ? [plane, support.low, support.end] : [support.end, support.low, plane];
          const cap: Vec = [b[0], support.high, b[2]], d: Vec = [a[0], support.high, a[2]];
          if (facesOutward) backing.quad(b, a, d, cap, colour, true);
          else backing.quad(a, b, cap, d, colour, true);
        }
      }
    }
    this.addSurface(backing, material, 'authored.boundary.technical-closure', true);

    // A cover remains legible all the way to its true bullet-blocking height. Hunyuan stone and
    // masonry occupy its envelope; the inset support fills only their recessed areas and cap.
    const covers = new SurfaceBuffer(), coverColour = new THREE.Color(style.stone).multiplyScalar(.88);
    for (const box of layout.boxes.filter(b => b.tag === 'whitebox-cover')) {
      const inset = Math.min(.48, (box.maxX - box.minX) * .16, (box.maxZ - box.minZ) * .16);
      const x0 = box.minX + inset, x1 = box.maxX - inset, z0 = box.minZ + inset, z1 = box.maxZ - inset;
      const y0 = box.minY, y1 = box.maxY;
      covers.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], coverColour, true);
      covers.quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], coverColour, true);
      covers.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], coverColour, true);
      covers.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], coverColour, true);
      covers.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], coverColour);
    }
    const coverMaterial = material.clone(); coverMaterial.side = THREE.DoubleSide;
    coverMaterial.onBeforeCompile = material.onBeforeCompile;
    coverMaterial.customProgramCacheKey = material.customProgramCacheKey;
    this.owned.push(coverMaterial);
    this.addSurface(covers, coverMaterial, 'authored.cover.technical-closure', true);
  }

  private buildLights(center: THREE.Vector3): void {
    const style = themeStyle(this.layout.theme);
    const hemi = new THREE.HemisphereLight(style.hemiSky, style.hemiGround, style.hemiIntensity * 1.15);
    const sun = new THREE.DirectionalLight(this.theme.sun, style.sunIntensity);
    sun.position.copy(center).addScaledVector(new THREE.Vector3(...style.sunDir).normalize(), 150);
    sun.target.position.copy(center); this.group.add(hemi, sun, sun.target);
    this.owned.push(hemi, sun);
    if (this.ctx.settings.quality === 'low') return;
    sun.castShadow = true; sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
    sun.shadow.mapSize.setScalar(this.ctx.settings.quality === 'high' ? 2048 : 1024);
    sun.shadow.bias = -.00035; sun.shadow.normalBias = .035;
    const view = new THREE.OrthographicCamera(); view.position.copy(sun.position);
    view.lookAt(center); view.updateMatrixWorld(true);
    const bounds = new THREE.Box3(), point = new THREE.Vector3(), layout = this.layout;
    for (const x of [layout.minX - 7, layout.maxX + 7]) {
      for (const y of [layout.floorY - .5, layout.floorY + 16]) {
        for (const z of [layout.minZ - 7, layout.maxZ + 7]) bounds.expandByPoint(point.set(x, y, z).applyMatrix4(view.matrixWorldInverse));
      }
    }
    const camera = sun.shadow.camera;
    camera.left = bounds.min.x; camera.right = bounds.max.x;
    camera.bottom = bounds.min.y; camera.top = bounds.max.y;
    camera.near = Math.max(.5, -bounds.max.z - 3); camera.far = -bounds.min.z + 3;
    camera.updateProjectionMatrix(); this.sunShadow = sun.shadow;
  }

  private buildFocalLights(): void {
    if (this.layout.theme !== 'inferno' || this.ctx.settings.quality === 'low') return;
    // A diagnostic override allows a same-camera GPU comparison without changing art or quality.
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('warmLights') === '0') return;
    const fixtures = this.art.placements.filter(p => p.assetId === 'SM_Prop_InfernoCrucible'
      && p.story && (p.story.beat === 'entry' || p.story.beat === 'junction')).slice(0, 2);
    for (const p of fixtures) {
      this.focalFixtures.push({ id: p.story!.id,
        position: new THREE.Vector3(p.x, p.y + p.envelope.height * p.s * .82, p.z) });
    }
    if (!this.focalFixtures.length) return;
    // The two alcoves are 61–110m apart. Keep one resident light near the viewer rather
    // than evaluating both point lights on every distant Standard-material fragment.
    const light = this.focalLight = new THREE.PointLight(0xff9a54, 12, 9, 2);
    light.name = 'authored.focal-light'; light.castShadow = false;
    this.group.add(light); this.owned.push(light); this.updateFocalLight();
  }

  private updateFocalLight(): void {
    if (!this.focalLight) return;
    this.ctx.camera.getWorldPosition(this.focalCameraPosition);
    let nearest = 0, nearestDistance = Infinity;
    for (let i = 0; i < this.focalFixtures.length; i++) {
      const distance = this.focalFixtures[i].position.distanceTo(this.focalCameraPosition);
      if (distance < nearestDistance) { nearest = i; nearestDistance = distance; }
    }
    if (nearest === this.focalFixtureIndex) return;
    // A 6m distance advantage avoids oscillation between alcoves. Moving the same
    // object preserves a constant light count and therefore a stable shader variant.
    if (this.focalFixtureIndex >= 0
      && this.focalFixtures[this.focalFixtureIndex].position.distanceTo(this.focalCameraPosition) <= nearestDistance + 6) return;
    this.focalFixtureIndex = nearest;
    this.focalLight.position.copy(this.focalFixtures[nearest].position);
    this.focalLight.userData.fixtureId = this.focalFixtures[nearest].id;
  }

  update(dt: number, time: number): void {
    if (this.disposed) return;
    this.updateFocalLight();
    this.architecture.update(this.ctx.camera);
    this.sky.update(time);
    this.particles.update(time, this.ctx.camera, this.ctx.renderer.domElement.height || 1080);
    if (this.sunShadow && this.shadowCadence.advance(dt, this.ctx.world.version)) this.sunShadow.needsUpdate = true;
    if (this.floorMaterial && this.layout.theme === 'inferno') this.floorMaterial.emissiveIntensity = .16 + Math.sin(time * .8) * .016;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent(); this.group.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
    this.ctx.scene.background = this.previousBackground; this.ctx.scene.fog = this.previousFog;
  }
}
