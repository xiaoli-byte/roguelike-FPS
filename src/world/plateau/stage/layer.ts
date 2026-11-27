/**
 * 第四章网页原生高原场景在正式游戏里的运行时层（同第一章的 desert/layer.ts：UnitySceneView 搭场景时建、每帧 update、卸载时 dispose）。
 * 场景文档（document.ts）只管玩法；画面、灯光、天气全在这里，检视页做好的十项（docs/art/reference-tingyuyuan.md）原样带进来：
 *   出图后期（FilmPost：印片 LUT、泛光、部分自动曝光）、柔光（天空球谐 + 半透明影子）、地形天空可见度 AO、地表混层、交界、
 *   俯视遮挡图、GPU 雨 + 淋湿积水、实时环境声床（接正式游戏的 Ambience 总线）。
 * 坐标：高原场景按自己的坐标建，外面套一个绕竖轴转 180° 的根节点就是正式游戏的坐标（document.ts 的 toGame）。
 * 雷暴：强度和闪光由正式游戏的机关雷暴（mechanisms/Storm.ts，夔登场时起）给，这里只照着画；落雷、伤害、导体都归它。
 */
import * as THREE from 'three';
import { AmbienceBed, type AmbiencePort } from '../../../audio/AmbienceBed';
import type { GameContext } from '../../../core/types';
import { FilmPost } from '../../../render/FilmPost';
import { stageFilm } from '../../../render/stageFilm';
import { stormVisuals } from '../../mechanisms/Storm';
import type { UnitySceneDocument } from '../../UnityLevelLibrary';
import { AmbienceSense } from '../ambienceSense';
import { buildContactField } from '../contact';
import { bakeCoverMap } from '../coverMap';
import { WORLD_UNIFORMS } from '../materials';
import { Rain } from '../rain';
import { SkyAmbient } from '../skyAmbient';
import { Weather } from '../weather';
import type { PlateauWorld } from './world41';

/** 每张图的光（同检视页） */
const RIG: Record<string, { hemi: [string, string, number]; sun: [string, number]; soft: number }> = {
  '4-1': { hemi: ['#c4dbff', '#6a8a44', 1.25], sun: ['#fff2dc', 2.9], soft: 0.62 },
};

const _cam = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class PlateauStageLayer {
  /** 根节点：绕竖轴转 180°（高原坐标 → 正式坐标） */
  readonly group = new THREE.Group();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private readonly weather: Weather;
  private readonly skyAmbient: SkyAmbient;
  private readonly rain: Rain;
  private readonly film: FilmPost;
  private ears: AmbienceSense | null = null;
  private bed: AmbienceBed | null = null;
  private readonly storm = { level: 0, flash: 0 };
  private readonly prevFog: THREE.Fog | THREE.FogExp2 | null;
  private readonly prevBackground: THREE.Color | THREE.Texture | null;
  private readonly prevContact: { tex: THREE.Texture; xf: THREE.Vector4 };
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly document: UnitySceneDocument, readonly world: PlateauWorld) {
    this.group.name = `plateau-stage-${world.id}`;
    this.group.rotation.y = Math.PI;
    const rig = RIG[world.id] ?? RIG['4-1'];
    this.hemi = new THREE.HemisphereLight(rig.hemi[0], rig.hemi[1], rig.hemi[2]);
    this.sun = new THREE.DirectionalLight(rig.sun[0], rig.sun[1]);
    const low = ctx.settings.quality === 'low';
    this.sun.castShadow = !low;
    this.sun.shadow.mapSize.set(low ? 1024 : ctx.settings.quality === 'medium' ? 2048 : 4096, low ? 1024 : ctx.settings.quality === 'medium' ? 2048 : 4096);
    Object.assign(this.sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 1000 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.intensity = rig.soft;
    this.group.add(this.hemi, this.sun, this.sun.target, world.local, world.sky);
    // 雾、背景在正式游戏的场景上（天空是跟着镜头的天球）
    this.prevFog = ctx.scene.fog;
    this.prevBackground = ctx.scene.background as THREE.Color | THREE.Texture | null;
    this.fog = new THREE.Fog(world.horizon, world.fog.near, world.fog.far);
    ctx.scene.fog = this.fog;
    ctx.scene.background = null;
    this.weather = new Weather({
      scene: this.group, sun: this.sun, hemi: this.hemi, fog: this.fog,
      clearFog: { color: this.fog.color.clone(), near: this.fog.near, far: this.fog.far }, stormFog: new THREE.Color(world.stormHorizon),
    }, world.terrain, world.conductors);
    this.weather.builtinRain = false;
    this.weather.external = this.storm;
    this.skyAmbient = new SkyAmbient(ctx.renderer, ctx.scene, world.sky, this.hemi, { yaw: Math.PI });
    this.skyAmbient.setEnabled(true);
    this.rain = new Rain(ctx.scene);
    this.film = new FilmPost(ctx.renderer);
    this.film.setQuality(ctx.settings.quality);
    this.prevContact = { tex: WORLD_UNIFORMS.uContactTex.value as THREE.Texture, xf: (WORLD_UNIFORMS.uContactXf.value as THREE.Vector4).clone() };
  }

  async build(parent: THREE.Object3D): Promise<void> {
    const ctx = this.ctx, w = this.world;
    parent.add(this.group);
    this.group.updateMatrixWorld(true);
    // 交界：距离场按高原坐标建；采样用世界坐标（转了 180°），映射的平移、缩放都取负
    buildContactField(this.group, w.world, w.terrain);
    const xf = WORLD_UNIFORMS.uContactXf.value as THREE.Vector4;
    xf.set(-xf.x, -xf.y, -xf.z, -xf.w);
    // 草的区块按需生成：先在出生点一带全部建好（遮挡图不拍草，但着色器变体要编）
    const sp = this.document.spawn.position;
    _cam.set(-sp[0], sp[1], -sp[2]);
    for (let i = 0, n = -1; i < 120 && w.grass.count !== n; i++) { n = w.grass.count; w.grass.update(_cam); }
    // 俯视遮挡图：只拍高原这一层（世界坐标的边界 = 高原边界转 180°）
    const T = w.terrain;
    const bake = new THREE.Scene();
    const home = this.group.parent;
    bake.add(this.group);
    let cover;
    try {
      cover = bakeCoverMap(ctx.renderer, bake, { minX: -T.maxX, maxX: -T.minX, minZ: -T.maxZ, maxZ: -T.minZ }, [w.grass.group, w.sky]);
    } finally {
      home?.add(this.group);
    }
    // 声床：耳朵按世界坐标看遮挡图、按高原坐标查地形 / 水 / 风；接正式游戏的 Ambience 总线
    const port = (ctx.audio as unknown as { ambiencePort?: () => AmbiencePort }).ambiencePort?.();
    if (port) {
      this.ears = new AmbienceSense(T, cover, { windAt: w.windAt, baseWind: 0.34, flip: true });
      this.bed = new AmbienceBed(port);
      this.weather.strikeListeners.push(at => this.bed?.strike(this.group.localToWorld(at.clone()), ctx.camera));
    }
    // 雷暴的画面交给这里（机关雷暴只管落雷 / 伤害 / 导体）
    stormVisuals.external = (level, flash) => { this.storm.level = level; this.storm.flash = flash; };
    // 出图后期：先按真实状态把着色器编好（进关时的加载画面里），再挂上接管渲染
    try {
      await this.film.compileScene(ctx.scene, ctx.camera);
    } catch (err) {
      console.warn('[plateau] 预编着色器失败（照常往下走）', err);
    }
    if (this.disposed) return;
    stageFilm.set(this.film, ctx.renderer);
  }

  update(dt: number, t: number): void {
    if (this.disposed) return;
    const ctx = this.ctx, w = this.world;
    WORLD_UNIFORMS.uTime.value = t;
    ctx.camera.getWorldPosition(_cam);
    this.group.worldToLocal(_cam);   // 镜头的高原坐标
    w.sky.position.copy(_cam);
    // 阴影中心取镜头前方 60 m，按 8 m 吸附（同检视页）
    ctx.camera.getWorldDirection(_fwd);
    _fwd.set(-_fwd.x, 0, -_fwd.z).normalize().multiplyScalar(60).add(_cam);
    const tx = Math.round(_fwd.x / 8) * 8, tz = Math.round(_fwd.z / 8) * 8;
    this.sun.target.position.set(tx, w.terrain.heightAt(tx, tz), tz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(w.sunDir, 450);
    w.update(dt, t, _cam);
    this.weather.update(dt, _cam);
    this.rain.update(ctx.camera, this.weather.level, WORLD_UNIFORMS.uWind.value as THREE.Vector2, this.fog.color, ctx.renderer.domElement.width, ctx.renderer.domElement.height, dt);
    this.skyAmbient.update();
    if (this.ears && this.bed) {
      this.ears.update(dt, ctx.camera, this.weather.level, this.bed.params);
      this.bed.update(dt);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (stageFilm.active === this.film) stageFilm.set(null, this.ctx.renderer);
    if (stormVisuals.external) stormVisuals.external = null;
    this.bed?.dispose();
    this.bed = null;
    this.rain.group.removeFromParent();
    this.skyAmbient.setEnabled(false);
    this.ctx.scene.getObjectByName('sky-ambient')?.removeFromParent();
    this.film.dispose?.();
    WORLD_UNIFORMS.uContactTex.value = this.prevContact.tex;
    (WORLD_UNIFORMS.uContactXf.value as THREE.Vector4).copy(this.prevContact.xf);
    WORLD_UNIFORMS.uWet.value = 0;
    WORLD_UNIFORMS.uStorm.value = 0;
    WORLD_UNIFORMS.uFlash.value = 0;
    if (this.ctx.scene.fog === this.fog) this.ctx.scene.fog = this.prevFog;
    if (this.ctx.scene.background === null) this.ctx.scene.background = this.prevBackground;
    this.group.removeFromParent();
    // 几何体是这张图自己的（材质大多是高原共用的缓存，留着）
    this.group.traverse(o => { (o as THREE.Mesh).geometry?.dispose(); });
  }
}
