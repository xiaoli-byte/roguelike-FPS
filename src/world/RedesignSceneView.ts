/**
 * Scene art for V2 redesign plans: themed ground, lighting, sky and the Tripo building kit placed by
 * buildRedesignArtLayout. Each published model is fitted into its placement box and instanced in
 * 24 m chunks with the asset's own LOD distances. Until a model has loaded, the technical greybox
 * for those boxes stays visible, so collision is never invisible.
 */
import * as THREE from 'three';
import type { GameContext, ThemeDef } from '../core/types';
import { Rng } from '../core/Rng';
import { AssetLibrary, type LoadedAsset } from '../assets/AssetLibrary';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import type { LevelLayout, P2 } from './LevelTypes';
import { buildRedesignArtLayout, REDESIGN_ART_ASSETS, REDESIGN_PLATFORM_VARIANTS, REDESIGN_WALL_KITS, redesignKitKey, type RedesignArtKind, type RedesignArtPlacement } from './RedesignArtLayout';
import { buildRedesignBackdrop } from './RedesignBackdrop';
import { Particles, SkyDome } from './Sky';
import { redesignThemeStyle, type ThemeStyle } from './Themes';
import { makeFloorTextures } from './Textures';
import { ShadowCadence, fitSunShadow, followSun, shadowMapSize, syncShadowMapSize, type ShadowFollow } from './ShadowCadence';
import { WhiteboxView } from './WhiteboxView';
import { whiteboxPoint } from './WhiteboxGen';

const CHUNK = 24;
/**
 * Repeated flat masonry loses nothing visible at LOD1 even point-blank (the normal map carries the
 * detail), and there are a hundred-odd of them in view: those kits start at LOD1.
 */
/** The modular wall kits (art/pipeline/derive_wall_kit.py): every rampart piece of every theme. */
const WALL_KIT = Object.values(REDESIGN_WALL_KITS).flatMap(k => [k.panel, k.plain, k.endL, k.endR]);
const KITS = Object.values(REDESIGN_ART_ASSETS);
const NEAREST_LOD: Readonly<Record<string, number>> = { ...Object.fromEntries(WALL_KIT.map(id => [id, 1])), ...Object.fromEntries(KITS.map(k => [k.platform, 1])) };
/** LOD switch distance scale per kit (default 1.5x the prop-scale manifest distances; the landmark is seen from afar). */
const LOD_RANGE: Readonly<Record<string, number>> = { ...Object.fromEntries(KITS.map(k => [k.landmark, 3])), ...Object.fromEntries(WALL_KIT.map(id => [id, .85])) };
/** While a variant is unpublished its placements use the kit it varies (never leaving collision bare). */
const FALLBACK_ASSET: Readonly<Record<string, string>> = Object.fromEntries([
  ...Object.values(REDESIGN_WALL_KITS).map(k => [k.plain, k.panel]),
  ...Object.entries(REDESIGN_PLATFORM_VARIANTS).flatMap(([kit, list]) => list.map(([id]) => [id, REDESIGN_ART_ASSETS[kit].platform])),
]);
/** Kits whose instances each get a slight brightness / warmth shift, so long runs never read as copies. */
const TINTED = new Set([...WALL_KIT, ...KITS.map(k => k.tower)]);
/** Deck-top slabs stop this far inside the deck rectangle, leaving the podium blocks' edges as its rim. */
const DECK_INSET = .3;
/** Processional road width (metres, half the main passages) and the length one eroded-edge tile spans. */
const ROUTE_WIDTH = 6, ROUTE_EDGE_TILE = 9;

/**
 * Worn sandstone flagstones in courses of uneven depth, 4 m per tile: each stone gets its own tone, a lit
 * upper bevel and a shaded lower one, a few are cracked or missing (sand shows through). The same canvas
 * drives a bump map so the joints read as recessed.
 */
function pavingTexture(style: ThemeStyle, rand: () => number): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 512, canvas = document.createElement('canvas'), bumpCanvas = document.createElement('canvas');
  canvas.width = canvas.height = bumpCanvas.width = bumpCanvas.height = S;
  const g = canvas.getContext('2d')!, b = bumpCanvas.getContext('2d')!;
  const base = new THREE.Color(style.paving), sand = new THREE.Color(style.sand), joint = new THREE.Color(style.trim).lerp(sand, .35);
  const hex = (c: THREE.Color) => `#${c.getHexString()}`, c = new THREE.Color();
  g.fillStyle = hex(joint); g.fillRect(0, 0, S, S);
  b.fillStyle = '#202020'; b.fillRect(0, 0, S, S);
  // Course heights that add up to the tile exactly, so rows continue across the seam.
  const rows: number[] = [];
  let left = S;
  while (left > 0) { const h = Math.min(left, Math.round(S / 4 * (.7 + rand() * .6))); rows.push(left - h < 40 ? left : h); left -= rows[rows.length - 1]; }
  let y = 0;
  for (const h of rows) {
    let x = -rand() * S / 4;
    while (x < S) {
      const w = S / 4 * (.6 + rand() * .9), missing = rand() < .06;
      c.copy(missing ? sand : base).multiplyScalar(missing ? .95 : .78 + rand() * .3);
      for (const dx of [0, S]) {
        const x0 = x - dx + 2, y0 = y + 2, ww = w - 4, hh = h - 4;
        g.fillStyle = hex(c); g.fillRect(x0, y0, ww, hh);
        if (missing) continue;
        g.fillStyle = 'rgba(255,240,215,.16)'; g.fillRect(x0, y0, ww, 3);
        g.fillStyle = 'rgba(60,35,20,.18)'; g.fillRect(x0, y0 + hh - 3, ww, 3); g.fillRect(x0 + ww - 3, y0, 3, hh);
        b.fillStyle = '#c8c8c8'; b.fillRect(x0 + 1, y0 + 1, ww - 2, hh - 2);
        if (rand() < .18) {
          // A hairline crack across the stone.
          g.strokeStyle = 'rgba(70,45,30,.45)'; g.lineWidth = 1.5; g.beginPath();
          g.moveTo(x0 + rand() * ww, y0); g.lineTo(x0 + rand() * ww, y0 + hh * (.4 + rand() * .3)); g.lineTo(x0 + rand() * ww, y0 + hh); g.stroke();
        }
      }
      x += w;
    }
    y += h;
  }
  for (let i = 0; i < 7000; i++) {
    const v = rand() < .5 ? 40 : 255;
    g.fillStyle = `rgba(${v},${v - 10},${v - 25},${.03 + rand() * .06})`;
    g.fillRect(Math.floor(rand() * S), Math.floor(rand() * S), 1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));
  }
  const make = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(.25, .25); t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: make(canvas, true), bump: make(bumpCanvas, false) };
}

/** Alpha across the road (v = 0..1): solid in the middle, edges eaten away by sand at random depths. */
function erodedEdge(rand: () => number): THREE.CanvasTexture {
  const W = 256, H = 64, canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!, image = g.createImageData(W, H);
  // Smooth wander plus whole missing edge stones (a step inwards over a short run).
  const lip = (phase: number) => {
    const out: number[] = [];
    let bite = 0, biteLeft = 0;
    for (let x = 0; x < W; x++) {
      if (biteLeft <= 0 && rand() < .025) { bite = .08 + rand() * .14; biteLeft = 6 + Math.floor(rand() * 18); }
      out.push(.06 + .12 * (.5 + .5 * Math.sin(x / W * Math.PI * 6 + phase)) + rand() * .05 + (biteLeft-- > 0 ? bite : 0));
    }
    return out;
  };
  const top = lip(rand() * 6), bottom = lip(rand() * 6);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const v = (y + .5) / H, d = Math.min((v - top[x] + .03) / .06, (1 - v - bottom[x] + .03) / .06);
    const a = Math.max(0, Math.min(1, d)), i = (y * W + x) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.round(a * 255); image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Kits whose back always faces solid mass (wall bodies and corner towers stand outside every floor, their
 * fronts towards it, and no standable top reaches their height): those back faces are never seen in
 * play, so the displayed geometry drops them. Shadow proxies keep the whole mesh.
 */
/**
 * Glow billboards measured from each published LOD0: height as a share of the model height, offsets along its own X
 * (side) and +Z front (front) as shares of its width / depth, glow size as a share of its height. Chapter-2 'brazier'
 * models are lanterns (a cold glow on the lamp); chapter-3 fire altars, forge hearths and furnace mouths burn warm.
 * Every 'brazier' placement glows (an unlisted one keeps the desert flame glow); other kinds glow only when listed.
 */
const LAMP_GLOW: Readonly<Record<string, { at: number; side: number; front?: number; scale: number; cold?: boolean }>> = {
  SM_Tripo_FrostIceLantern: { at: .8, side: 0, scale: .45, cold: true },
  SM_Tripo_FrostSeaBoneLantern: { at: .67, side: -.3, scale: .4, cold: true },
  // Zhurong kit: the altar's flame tongues above its bowl, the forge stall's coal bed under its hood, and the corner
  // tower's arched furnace mouth at the foot of its front face.
  SM_Tripo_InfernoFireAltar: { at: .9, side: 0, scale: .55 },
  SM_Tripo_InfernoForgeStall: { at: .3, side: 0, front: .25, scale: .3 },
  SM_Tripo_InfernoFurnaceTower: { at: .12, side: 0, front: .5, scale: .2 },
};

/**
 * Kits whose models carry an emissive mask (T_*_E, colour-keyed from the concepts' painted lava, coals and furnace
 * fire): the mask is white in the GLB, the kit's glow colour and a slow breathing pulse come from here.
 */
const KIT_EMISSIVE: Readonly<Record<string, { color: number; intensity: number; pulse: number }>> = {
  inferno: { color: 0xff6a1c, intensity: 2.2, pulse: .15 },
};
/**
 * Share of the kit glow per asset. Every deck block's lava band under its lid and every wall bay's lava channel at full
 * strength drew one unbroken orange line around each room and along each deck (rows of identical glowing chests); the
 * repeated pieces glow low so the fire altars, furnace mouths, gateway lintel and floor cracks carry the heat.
 */
const KIT_EMISSIVE_SHARE: Readonly<Record<string, number>> = {
  SM_Tripo_InfernoPlatformBlock: .3, SM_Tripo_InfernoStairs: .45,
  SM_Tripo_InfernoRampartPanel: .5, SM_Tripo_InfernoRampartEndL: .5, SM_Tripo_InfernoRampartEndR: .5,
};

/** Placement kinds that stand on a plan cover box (each replaces exactly one greybox cover box). */
const COVER_KINDS = new Set<RedesignArtKind>(['column', 'barricade', 'coverwall', 'stall', 'goods', 'hoard', 'ruin', 'brazier']);

// Desert only: where a frost passage leaves a room at a slant, a passage wall's back can face the room
// (RedesignArtLayout exactRuns), so the frost kit keeps its back faces.
const FRONT_ONLY = new Set([...WALL_KIT.filter(id => id.startsWith('SM_Tripo_Desert')), 'SM_Tripo_DesertCornerTower']);

/**
 * The geometry without the model's back: triangles facing back (-Z after the node transform) that also lie
 * in its rear half. Back-facing facets in the front half are the undersides of sculpted block joints and
 * grooves; dropping those (as an orientation-only test did) punched see-through holes in the wall face.
 */
function frontFacing(geometry: THREE.BufferGeometry, nodeMatrix: THREE.Matrix4, bounds: THREE.Box3): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position'), index = geometry.index;
  const count = index ? index.count : pos.count, keep: number[] = [];
  const normal = new THREE.Matrix3().getNormalMatrix(nodeMatrix), middle = (bounds.min.z + bounds.max.z) / 2;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < count; t += 3) {
    const i0 = index ? index.getX(t) : t, i1 = index ? index.getX(t + 1) : t + 1, i2 = index ? index.getX(t + 2) : t + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    const rear = m.copy(a).add(b).add(c).divideScalar(3).applyMatrix4(nodeMatrix).z < middle;
    const n = b.sub(a).cross(c.sub(a)).applyMatrix3(normal).normalize();
    if (n.z >= -.25 || !rear) keep.push(i0, i1, i2);
  }
  // Own copies of the vertex data: disposing this geometry must not drop GPU buffers the cached asset shares.
  const out = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geometry.attributes)) out.setAttribute(name, attribute.clone());
  out.setIndex(keep);
  return out;
}

/** A slight, position-seeded brightness and warmth shift (multiplies the texture), the same every build. */
function instanceTint(x: number, z: number): THREE.Color {
  const h = (k: number) => { const v = Math.sin(x * (12.9898 + k) + z * (78.233 - k)) * 43758.5453; return v - Math.floor(v); };
  const light = .9 + h(0) * .14, warm = (h(3) - .5) * .06;
  return new THREE.Color(light * (1 + warm), light, light * (1 - warm * 1.5));
}

/** Box spanned by every LOD of a published asset, including node transforms. */
function assetBounds(asset: LoadedAsset): THREE.Box3 {
  const box = new THREE.Box3(), p = new THREE.Vector3();
  for (const mesh of asset.lods) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  }
  return box;
}

/** World matrix fitting the asset's measured box into the placement box (per-axis scale, feet on ground). */
export function redesignPlacementMatrix(p: RedesignArtPlacement, bounds: THREE.Box3, source: THREE.Matrix4): THREE.Matrix4 {
  const size = bounds.getSize(new THREE.Vector3());
  const scale = new THREE.Vector3(p.size[0] / Math.max(size.x, 1e-6), p.size[1] / Math.max(size.y, 1e-6), p.size[2] / Math.max(size.z, 1e-6));
  const place = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), scale);
  const centre = new THREE.Matrix4().makeTranslation(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  return place.multiply(centre).multiply(source);
}

export class RedesignSceneView {
  readonly group = new THREE.Group();
  readonly placements: RedesignArtPlacement[];
  private readonly owned: { dispose(): void }[] = [];
  private readonly lods: THREE.LOD[] = [];
  private readonly built = new Set<string>();
  private readonly materials = new Map<THREE.Material, THREE.Material>();
  private readonly proxyMaterials = new Map<THREE.Side, THREE.MeshBasicMaterial>();
  private readonly frontGeometries = new Map<string, THREE.BufferGeometry>();
  /** The cover greybox's own instance matrices, before any box is collapsed under finished art. */
  private coverMatrices: THREE.Matrix4[] | null = null;
  private readonly greybox: WhiteboxView;
  private readonly sky: SkyDome;
  private readonly particles: Particles;
  /** Additive glow billboards over each brazier's flame (no real lights: four point lights would cost every lit pixel). */
  private flames: { sprite: THREE.Sprite; size: number; phase: number }[] = [];
  /** Kit materials whose emissive mask glows (KIT_EMISSIVE), pulsed together in update(). */
  private readonly glowing: { material: THREE.MeshStandardMaterial; share: number; phase: number }[] = [];
  /** The ground's lava-crack emissive (inferno), breathing slowly in update(). */
  private groundGlow: THREE.MeshStandardMaterial | null = null;
  private readonly shadowCadence = new ShadowCadence();
  private sunShadow: THREE.DirectionalLightShadow | null = null;
  /** The sun and its player-following shadow box (the level is wider than the box). */
  private sun: THREE.DirectionalLight | null = null;
  private shadowFollow: ShadowFollow | null = null;
  private readonly previousBackground: THREE.Scene['background'];
  private readonly previousFog: THREE.Scene['fog'];
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly layout: LevelLayout, private readonly theme: ThemeDef, rand: () => number) {
    this.group.name = `redesign.art.${layout.whitebox?.planId}`;
    this.previousBackground = ctx.scene.background; this.previousFog = ctx.scene.fog;
    // The greybox owns collision-matching boxes; art hides it piece by piece as models arrive.
    this.greybox = new WhiteboxView(ctx, layout);
    this.group.add(this.greybox.group); this.owned.push(this.greybox);
    const style = redesignThemeStyle(layout.theme);
    ctx.scene.background = new THREE.Color(theme.fogColor);
    ctx.scene.fog = new THREE.Fog(theme.fogColor, Math.max(60, style.fogNear), Math.max(220, style.fogFar));
    this.placements = buildRedesignArtLayout(layout);
    const center = new THREE.Vector3(layout.center.x, layout.floorY, layout.center.z);
    this.buildGround(rand);
    const backdrop = buildRedesignBackdrop(layout, theme, style, this.placements.filter(p => p.kind === 'rampart'), rand);
    this.group.add(backdrop.group); this.owned.push(backdrop);
    this.buildLights(center);
    this.sky = new SkyDome(theme, style, center); this.group.add(this.sky.mesh); this.owned.push(this.sky);
    this.particles = new Particles(style, ctx.settings.quality, rand); this.group.add(this.particles.points); this.owned.push(this.particles);
    this.buildArt();
    this.buildFlames();
    if (this.placements.some(p => !this.built.has(p.assetId)))
      void AssetLibrary.preload().then(() => { if (!this.disposed) this.buildArt(); });
  }

  /** Placement asset ids that are still drawn as greybox (missing or not yet loaded). */
  get pendingAssets(): string[] { return [...new Set(this.placements.map(p => p.assetId))].filter(id => !this.built.has(id)); }

  private buildGround(rand: () => number): void {
    const L = this.layout, style = redesignThemeStyle(L.theme), rng = new Rng(Math.floor(rand() * 0xFFFFFFFF));
    const maps = makeFloorTextures(L.theme, this.theme, style, () => rng.next());
    for (const t of [maps.map, maps.bump, maps.roughness, maps.emissive]) if (t) { t.repeat.set(1 / maps.tile, 1 / maps.tile); this.owned.push(t); }
    const material = new THREE.MeshStandardMaterial({ map: maps.map, bumpMap: maps.bump, bumpScale: .012,
      roughnessMap: maps.roughness, roughness: .97, metalness: 0 });
    if (maps.emissive && style.floorGlow > 0) {
      material.emissiveMap = maps.emissive; material.emissive.setHex(0xffffff); material.emissiveIntensity = material.userData.glow = style.floorGlow;
      this.groundGlow = material;
    }
    this.owned.push(material);
    // One merged plane per floor rect, UVs in world metres so the tiling is continuous across rects.
    const positions: number[] = [], uvs: number[] = [], index: number[] = [];
    for (const r of L.whitebox!.floorRects) {
      const base = positions.length / 3, y = L.floorY + .002;
      positions.push(r.minX, y, r.minZ, r.maxX, y, r.minZ, r.maxX, y, r.maxZ, r.minX, y, r.maxZ);
      uvs.push(r.minX, r.minZ, r.maxX, r.minZ, r.maxX, r.maxZ, r.minX, r.maxZ);
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index); geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, material);
    ground.name = 'redesign.ground'; ground.receiveShadow = true;
    this.group.add(ground); this.owned.push(geometry);

    // Deck tops: one continuous paved slab per deck over the podium blocks, inset so the blocks' bevelled
    // edges still read as the deck rim (tiled tops alone made a 4 m chequerboard). Feet stay on collision.
    // Deck tops are laid stone, the same flagstones as the processional road.
    const deckPaving = pavingTexture(style, () => rng.next());
    const deckMaterial = new THREE.MeshStandardMaterial({ map: deckPaving.map, bumpMap: deckPaving.bump, bumpScale: .02, roughness: .9, metalness: 0 });
    this.owned.push(deckMaterial, deckPaving.map, deckPaving.bump);
    const deckPos: number[] = [], deckUv: number[] = [], deckIndex: number[] = [], seen = new Set<string>();
    for (const r of L.ramps) {
      const key = `${r.x0},${r.z0},${r.x1},${r.z1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const x0 = r.x0 + DECK_INSET, x1 = r.x1 - DECK_INSET, z0 = r.z0 + DECK_INSET, z1 = r.z1 - DECK_INSET, y = L.floorY + r.top + .035;
      const base = deckPos.length / 3;
      deckPos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      deckUv.push(x0, z0, x1, z0, x1, z1, x0, z1);
      deckIndex.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    this.buildRoute(rng);
    if (deckIndex.length) {
      const deckGeometry = new THREE.BufferGeometry();
      deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
      deckGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(deckUv, 2));
      deckGeometry.setIndex(deckIndex); deckGeometry.computeVertexNormals();
      const decks = new THREE.Mesh(deckGeometry, deckMaterial);
      decks.name = 'redesign.deckTops'; decks.receiveShadow = true;
      this.group.add(decks); this.owned.push(deckGeometry);
    }
  }

  /**
   * A paved processional road along the main route (entry → each main passage → exit): the one
   * consistent floor cue that says "this way" in rooms that are otherwise open on several sides.
   * Its edges are eroded by an alpha map on a second UV set, so it fades into the earth.
   */
  private buildRoute(rng: Rng): void {
    const L = this.layout, plan = L.whitebox!.plan;
    const route: P2[] = [whiteboxPoint(plan, plan.entry.at)];
    let room = plan.entry.room;
    for (const id of plan.mainRoute) {
      const path = plan.passages.find(p => p.id === id);
      if (!path) continue;
      const points = path.from === room ? path.points : [...path.points].reverse();
      for (const p of points) route.push(whiteboxPoint(plan, p));
      room = path.from === room ? path.to : path.from;
    }
    route.push(whiteboxPoint(plan, plan.exit.at));
    const positions: number[] = [], uvs: number[] = [], edge: number[] = [], index: number[] = [];
    let along = 0;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < .01) continue;
      // Each piece runs a little past both ends so bends close without a gap.
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, nx = -uz * ROUTE_WIDTH / 2, nz = ux * ROUTE_WIDTH / 2;
      const ax = a.x - ux * ROUTE_WIDTH / 2, az = a.z - uz * ROUTE_WIDTH / 2, bx = b.x + ux * ROUTE_WIDTH / 2, bz = b.z + uz * ROUTE_WIDTH / 2;
      const y = L.floorY + .006, base = positions.length / 3, run = len + ROUTE_WIDTH;
      positions.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
      // Courses lie across the road (texture rows run along the local cross axis), as laid stone does.
      for (const [t, w] of [[along, 1], [along + run, 1], [along + run, -1], [along, -1]]) uvs.push(w * ROUTE_WIDTH / 2, t);
      edge.push(along / ROUTE_EDGE_TILE, 0, (along + run) / ROUTE_EDGE_TILE, 0, (along + run) / ROUTE_EDGE_TILE, 1, along / ROUTE_EDGE_TILE, 1);
      // The left edge comes first here, so this winding faces up.
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      along += run;
    }
    if (!index.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(edge, 2));
    geometry.setIndex(index); geometry.computeVertexNormals();
    const style = redesignThemeStyle(L.theme), { map, bump } = pavingTexture(style, () => rng.next()), alphaMap = erodedEdge(() => rng.next());
    alphaMap.channel = 1;
    const material = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: .02, alphaMap, transparent: true, depthWrite: false, roughness: .9, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const road = new THREE.Mesh(geometry, material);
    road.name = 'redesign.route'; road.receiveShadow = true; road.renderOrder = 1;
    this.group.add(road); this.owned.push(geometry, material, map, bump, alphaMap);
  }

  private buildLights(center: THREE.Vector3): void {
    const style = redesignThemeStyle(this.layout.theme), L = this.layout;
    const hemi = new THREE.HemisphereLight(style.hemiSky, style.hemiGround, style.hemiIntensity * 1.15);
    const sun = new THREE.DirectionalLight(this.theme.sun, style.sunIntensity);
    sun.position.copy(center).addScaledVector(new THREE.Vector3(...style.sunDir).normalize(), 180);
    sun.target.position.copy(center); this.group.add(hemi, sun, sun.target);
    this.owned.push(hemi, sun);
    if (this.ctx.settings.quality === 'low') return;
    sun.castShadow = true; sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
    // The player's shadow-quality setting picks the map size; the map covers a 128 m box that follows the
    // player (medium 2048 is 6.25 cm a texel), not the whole level (about 13 cm).
    sun.shadow.mapSize.setScalar(shadowMapSize(this.ctx.settings));
    sun.shadow.bias = -.00035; sun.shadow.normalBias = .035;
    const view = new THREE.OrthographicCamera(); view.position.copy(sun.position); view.lookAt(center); view.updateMatrixWorld(true);
    // Depth range still spans the whole level (anything may cast into the box); width and height follow the player.
    const bounds = new THREE.Box3(), point = new THREE.Vector3();
    for (const x of [L.minX - 8, L.maxX + 8]) for (const y of [L.floorY - .5, L.floorY + 18]) for (const z of [L.minZ - 8, L.maxZ + 8])
      bounds.expandByPoint(point.set(x, y, z).applyMatrix4(view.matrixWorldInverse));
    this.shadowFollow = fitSunShadow(sun.shadow.camera, bounds, center,
      new THREE.Vector3().setFromMatrixColumn(view.matrixWorld, 0), new THREE.Vector3().setFromMatrixColumn(view.matrixWorld, 1));
    this.sunShadow = sun.shadow; this.sun = sun;
  }

  private material(original: THREE.Material, assetId: string): THREE.Material {
    const existing = this.materials.get(original);
    if (existing) return existing;
    const copy = original.clone();
    if (copy instanceof THREE.MeshStandardMaterial) {
      applyArtEnvironment(copy, this.ctx.renderer); copy.envMapIntensity = .35;
      // Lava seams, coals and furnace mouths: the kit's emissive mask, tinted and pulsed (update()).
      const glow = this.layout.whitebox ? KIT_EMISSIVE[redesignKitKey(this.layout.whitebox.plan)] : undefined;
      if (glow && copy.emissiveMap) {
        const share = KIT_EMISSIVE_SHARE[assetId] ?? 1;
        copy.emissive.setHex(glow.color); copy.emissiveIntensity = glow.intensity * share;
        this.glowing.push({ material: copy, share, phase: this.glowing.length * 2.399 });
      }
    }
    this.materials.set(original, copy); this.owned.push(copy);
    return copy;
  }

  /**
   * The sun map re-renders at 30 Hz for moving casters and spans the whole level, so all architecture is
   * drawn into it each time. Each kit casts through its lowest LOD instead, as one InstancedMesh for the
   * whole level (the shadow view covers every chunk anyway, so splitting it would only add draw calls);
   * its instance count is zero except while the shadow pass draws it.
   * Wall and tower silhouettes are simple enough that the low LOD shadow is indistinguishable.
   */
  private shadowProxy(asset: LoadedAsset, assetId: string, placements: RedesignArtPlacement[], bounds: THREE.Box3): THREE.InstancedMesh {
    const source = asset.lods[asset.lods.length - 1];
    source.updateWorldMatrix(true, false);
    const original = Array.isArray(source.material) ? source.material[0] : source.material;
    let material = this.proxyMaterials.get(original.side);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: original.side });
      this.proxyMaterials.set(original.side, material); this.owned.push(material);
    }
    const proxy = new THREE.InstancedMesh(source.geometry, material, placements.length);
    proxy.name = `${assetId}.shadow`; proxy.castShadow = true; proxy.receiveShadow = false; proxy.matrixAutoUpdate = false;
    placements.forEach((p, i) => proxy.setMatrixAt(i, redesignPlacementMatrix(p, bounds, source.matrixWorld)));
    proxy.instanceMatrix.needsUpdate = true; proxy.computeBoundingBox(); proxy.computeBoundingSphere();
    // Zero instances in the main pass (nothing is drawn), all of them only while the shadow pass draws it.
    const count = placements.length;
    proxy.count = 0;
    proxy.onBeforeShadow = () => { proxy.count = count; };
    proxy.onAfterShadow = () => { proxy.count = 0; };
    this.owned.push(proxy);
    return proxy;
  }

  /** The geometry a kit displays at one LOD: its back faces stripped when the kit always backs onto mass. */
  private displayGeometry(assetId: string, index: number, source: THREE.Mesh, bounds: THREE.Box3): THREE.BufferGeometry {
    if (!FRONT_ONLY.has(assetId)) return source.geometry;
    const key = `${assetId}#${index}`;
    let geometry = this.frontGeometries.get(key);
    if (!geometry) {
      geometry = frontFacing(source.geometry, source.matrixWorld, bounds);
      this.frontGeometries.set(key, geometry); this.owned.push(geometry);
    }
    return geometry;
  }

  private buildArt(): void {
    const low = this.ctx.settings.quality === 'low';
    for (const placedId of new Set(this.placements.map(p => p.assetId))) {
      if (this.built.has(placedId)) continue;
      // A variant that will never load (not published) stands in as the kit it varies.
      const assetId = FALLBACK_ASSET[placedId] && AssetLibrary.unavailable(placedId) ? FALLBACK_ASSET[placedId] : placedId;
      const asset = AssetLibrary.get(assetId);
      if (!asset) continue;
      this.built.add(placedId);
      const bounds = assetBounds(asset), matching = this.placements.filter(p => p.assetId === placedId);
      const final = asset.lods.length - 1, nearest = Math.min(final, NEAREST_LOD[assetId] ?? 0);
      const levels = low ? [final] : asset.lods.map((_, i) => i).filter(i => i >= nearest);
      const chunks = new Map<string, RedesignArtPlacement[]>();
      for (const p of matching) {
        const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
        chunks.set(key, [...(chunks.get(key) ?? []), p]);
      }
      for (const [key, chunk] of chunks) {
        const lod = new THREE.LOD(); lod.name = `${placedId}.chunk.${key}`;
        lod.position.set(chunk.reduce((s, p) => s + p.x, 0) / chunk.length, 0, chunk.reduce((s, p) => s + p.z, 0) / chunk.length);
        lod.updateMatrix(); lod.matrixAutoUpdate = false; lod.autoUpdate = false;
        const local = new THREE.Matrix4().makeTranslation(-lod.position.x, 0, -lod.position.z);
        for (const index of levels) {
          const source = asset.lods[index];
          source.updateWorldMatrix(true, false);
          const material = Array.isArray(source.material) ? source.material.map(m => this.material(m, assetId)) : this.material(source.material, assetId);
          const geometry = this.displayGeometry(assetId, index, source, bounds);
          const mesh = new THREE.InstancedMesh(geometry, material, chunk.length);
          // Shadows come from the chunk's proxy below, never from the displayed LOD.
          mesh.name = `${assetId}.LOD${index}`; mesh.castShadow = false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
          chunk.forEach((p, i) => mesh.setMatrixAt(i, local.clone().multiply(redesignPlacementMatrix(p, bounds, source.matrixWorld))));
          if (TINTED.has(assetId)) chunk.forEach((p, i) => mesh.setColorAt(i, instanceTint(p.x, p.z)));
          mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
          // Large architecture keeps detail further out than the asset's prop-scale default.
          // Ramparts read the same at their lowest LOD from ~50 m (checked in game), so they drop to it sooner.
          const distance = index === levels[0] ? 0 : (asset.entry.lodDistance[index] ?? index * 24) * (LOD_RANGE[assetId] ?? 1.5);
          lod.addLevel(mesh, distance, .1);
          this.owned.push(mesh);
        }
        this.group.add(lod); this.lods.push(lod);
      }
      if (!low) this.group.add(this.shadowProxy(asset, assetId, matching, bounds));
    }
    this.group.updateMatrixWorld(true);
    this.updateGreybox();
    if (this.sunShadow) this.sunShadow.needsUpdate = true;
  }

  /**
   * A warm glow over every brazier bowl, flickering in update(). It reads as fire with or without the
   * model (the greybox box stands in until it is published) and costs one tiny draw per brazier.
   */
  private buildFlames(): void {
    const braziers = this.placements.filter(p => p.kind === 'brazier' || LAMP_GLOW[p.assetId]);
    if (!braziers.length) return;
    const materials = new Map<boolean, THREE.SpriteMaterial>();
    const material = (cold: boolean): THREE.SpriteMaterial => {
      const cached = materials.get(cold);
      if (cached) return cached;
      const size = 64, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d')!, grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      const stops = cold ? ['rgba(225,255,255,1)', 'rgba(120,225,255,.7)', 'rgba(50,160,230,.2)', 'rgba(30,110,200,0)']
        : ['rgba(255,236,170,1)', 'rgba(255,170,70,.75)', 'rgba(240,96,30,.22)', 'rgba(200,60,20,0)'];
      [0, .25, .6, 1].forEach((at, i) => grad.addColorStop(at, stops[i]));
      g.fillStyle = grad; g.fillRect(0, 0, size, size);
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      const made = new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      this.owned.push(map, made); materials.set(cold, made);
      return made;
    };
    for (const p of braziers) {
      // Desert braziers: the bowl rim sits at about 80% of the height, the warm glow in the flame just above it.
      // Frost lanterns (LAMP_GLOW) get a smaller cold glow on their lamp instead of a fire.
      const lamp = LAMP_GLOW[p.assetId], glow = p.size[1] * (lamp?.scale ?? .85);
      const side = (lamp?.side ?? 0) * p.size[0], front = (lamp?.front ?? 0) * p.size[2];
      const sprite = new THREE.Sprite(material(Boolean(lamp?.cold)));
      // The lamp's offset along the model's own X and +Z (front), turned by the placement yaw.
      sprite.position.set(p.x + Math.cos(p.yaw) * side + Math.sin(p.yaw) * front, p.y + p.size[1] * (lamp?.at ?? .88),
        p.z - Math.sin(p.yaw) * side + Math.cos(p.yaw) * front);
      sprite.scale.setScalar(glow);
      sprite.name = 'redesign.brazierGlow'; sprite.renderOrder = 3;
      this.group.add(sprite);
      this.flames.push({ sprite, size: glow, phase: (p.x * 1.7 + p.z * 2.3) % (Math.PI * 2) });
    }
  }

  /** Greybox layers stay only where their art is still missing; the themed ground always replaces its floor. */
  private updateGreybox(): void {
    // Ready once every placement of the kinds has its art (a wall run mixes several kit pieces).
    const ready = (...kinds: RedesignArtKind[]) => this.placements.every(p => !kinds.includes(p.kind) || this.built.has(p.assetId));
    const layers: Record<string, boolean> = {
      'whitebox-floor': false,
      'whitebox-walls': !ready('rampart'),
      'whitebox-solid-cover': this.updateCoverGreybox(),
      'whitebox-platforms': !ready('platform'),
      'whitebox-stairs': !ready('stairs'),
    };
    // Its own lights, scale grid and room labels never show under the art layer.
    for (const child of this.greybox.group.children) child.visible = layers[child.name] ?? false;
  }

  /**
   * Cover boxes hide one by one: each greybox box collapses once the art placed on it (same centre) has
   * been built, so one unpublished kit no longer leaves every cover box drawn over finished models.
   * Returns whether any cover box still shows.
   */
  private updateCoverGreybox(): boolean {
    const mesh = this.greybox.group.getObjectByName('whitebox-solid-cover') as THREE.InstancedMesh | undefined;
    if (!mesh) return false;
    if (!this.coverMatrices) {
      this.coverMatrices = Array.from({ length: mesh.count }, (_, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; });
    }
    const built = this.placements.filter(p => COVER_KINDS.has(p.kind) && this.built.has(p.assetId));
    // Massif covers are tiled by several podium blocks: any built tile inside the box covers it.
    const massifs = this.placements.filter(p => p.kind === 'massif' && this.built.has(p.assetId));
    // Gate posts are drawn by the gateway standing over them: any cover box inside a built gateway's footprint.
    const gates = this.placements.filter(p => (p.kind === 'gateway' || p.kind === 'shrine') && this.built.has(p.assetId));
    const underGate = (x: number, z: number) => gates.some(g => {
      const dx = x - g.x, dz = z - g.z, c = Math.cos(g.yaw), s = Math.sin(g.yaw);
      return Math.abs(dx * c - dz * s) <= g.size[0] / 2 && Math.abs(dx * s + dz * c) <= g.size[2] / 2;
    });
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0), centre = new THREE.Vector3();
    let showing = false;
    this.coverMatrices.forEach((m, i) => {
      centre.setFromMatrixPosition(m);
      const covered = built.some(p => Math.abs(p.x - centre.x) < .3 && Math.abs(p.z - centre.z) < .3) || underGate(centre.x, centre.z)
        || massifs.some(p => Math.abs(p.x - centre.x) <= m.elements[0] / 2 && Math.abs(p.z - centre.z) <= m.elements[10] / 2);
      mesh.setMatrixAt(i, covered ? hidden : m);
      showing ||= !covered;
    });
    mesh.instanceMatrix.needsUpdate = true;
    return showing;
  }

  update(dt: number, time: number): void {
    if (this.disposed) return;
    for (const lod of this.lods) lod.update(this.ctx.camera);
    this.sky.update(time);
    this.particles.update(time, this.ctx.camera, this.ctx.renderer.domElement.height || 1080);
    for (const f of this.flames) {
      const flicker = 1 + Math.sin(time * 9.1 + f.phase) * .06 + Math.sin(time * 23.7 + f.phase * 3) * .04;
      f.sprite.scale.setScalar(f.size * flicker);
    }
    if (this.glowing.length) {
      const glow = KIT_EMISSIVE[redesignKitKey(this.layout.whitebox!.plan)];
      for (const g of this.glowing)
        g.material.emissiveIntensity = glow.intensity * g.share * (1 + Math.sin(time * 1.3 + g.phase) * glow.pulse * .6 + Math.sin(time * 3.1 + g.phase * 1.7) * glow.pulse * .4);
    }
    if (this.groundGlow) {
      this.groundGlow.emissiveIntensity = this.groundGlow.userData.glow * (.9 + .07 * Math.sin(time * .8) + .03 * Math.sin(time * 2.3));
    }
    if (this.sunShadow) syncShadowMapSize(this.sunShadow, shadowMapSize(this.ctx.settings));
    followSun(this.shadowFollow, this.sun, this.ctx.player?.position);
    if (this.sunShadow && this.shadowCadence.advance(dt, this.ctx.world.version)) this.sunShadow.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent(); this.group.clear();
    for (const r of this.owned) r.dispose();
    this.owned.length = 0; this.materials.clear(); this.lods.length = 0; this.glowing.length = 0; this.groundGlow = null;
    this.ctx.scene.background = this.previousBackground; this.ctx.scene.fog = this.previousFog;
  }
}
