/** 行旅图：只提示道路、已发现的补给与祭坛方向，不占用鼠标。 */
import type { AdventureInfo, ArenaInfo, GameContext } from '../core/types';
import { h } from './dom';
import { getStageDesign } from '../world/StageDesign';

const MAP_W = 226;
const MAP_H = 180;
const MAP_PAD = 18;
const UPDATE_MS = 80;

const PHASE_TEXT = {
  explore: '探索区域 · 寻找灵火祭坛',
  battle: '守住祭坛 · 肃清敌人',
  cleared: '区域已肃清 · 可继续探索',
};

export class AdventureHUD {
  readonly root: HTMLDivElement;
  private readonly map: HTMLCanvasElement;
  private readonly mapCtx: CanvasRenderingContext2D | null;
  private readonly terrain = document.createElement('canvas');
  private readonly terrainCtx: CanvasRenderingContext2D | null;
  private readonly instruction: HTMLDivElement;
  private readonly targetLabel: HTMLSpanElement;
  private readonly distance: HTMLSpanElement;
  private readonly direction: HTMLSpanElement;
  private readonly discovered: HTMLSpanElement;
  private readonly zoneLabel: HTMLSpanElement;
  private readonly stageName: HTMLDivElement;
  private readonly routeHint: HTMLDivElement;
  private readonly encounterGlyph = new Path2D('M-4-4L4 4 M-4 4L4-4 M-4-1L-1-4 M1 4L4 1');
  private readonly cacheGlyph = new Path2D('M-4-2H4V4H-4Z M-4-2V-4H4V-2 M-1-1H1V1H-1Z');
  private readonly altarGlyph = new Path2D('M0-6L1.8-1.8L6 0L1.8 1.8L0 6L-1.8 1.8L-6 0L-1.8-1.8Z');
  private arena: ArenaInfo | null = null;
  private info: AdventureInfo | null = null;
  private lastUpdate = -Infinity;
  private phase = '';
  private shownDistance = -1;
  private shownDiscoveries = '';
  private shownDirection = Infinity;
  private shownZone = '';
  private scale = 1;
  private offsetX = 0;
  private offsetZ = 0;
  private dpr = 1;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-adventure gf-hud__corner', parent);
    this.root.hidden = true;
    this.stageName = h('div', 'gf-adventure__stage', this.root);
    const header = h('div', 'gf-adventure__head', this.root);
    h('span', 'gf-adventure__title', header, '行旅图');
    this.zoneLabel = h('span', 'gf-adventure__zone', header);
    this.discovered = h('span', 'gf-adventure__discovered', header);
    this.routeHint = h('div', 'gf-adventure__route', this.root);
    this.map = h('canvas', 'gf-adventure__map', this.root);
    this.map.setAttribute('role', 'img');
    this.map.setAttribute('aria-label', '区域道路、祭坛、遭遇守卫与已发现补给的位置');
    this.mapCtx = this.map.getContext('2d');
    this.terrainCtx = this.terrain.getContext('2d');
    this.instruction = h('div', 'gf-adventure__instruction', this.root);
    const target = h('div', 'gf-adventure__target', this.root);
    const compass = h('span', 'gf-adventure__compass', target);
    compass.setAttribute('aria-hidden', 'true');
    this.direction = h('span', 'gf-adventure__direction', compass);
    this.targetLabel = h('span', 'gf-adventure__label', target);
    this.distance = h('span', 'gf-adventure__distance', target);
  }

  reset(): void {
    this.root.hidden = true;
    this.arena = null;
    this.info = null;
    this.lastUpdate = -Infinity;
    this.phase = '';
    this.shownDistance = -1;
    this.shownDiscoveries = '';
    this.shownDirection = Infinity;
    this.shownZone = '';
    this.mapCtx?.clearRect(0, 0, MAP_W, MAP_H);
    this.terrainCtx?.clearRect(0, 0, MAP_W, MAP_H);
  }

  update(now: number): void {
    const info = this.ctx.stage.exploration ?? null;
    const arena = this.ctx.stage.arena;
    if (!info || !arena) {
      if (!this.root.hidden) this.reset();
      return;
    }
    if (now - this.lastUpdate < UPDATE_MS) return;
    this.lastUpdate = now;
    if (info !== this.info || arena !== this.arena || this.dpr !== Math.min(2, window.devicePixelRatio || 1)) {
      this.info = info;
      this.arena = arena;
      const design = getStageDesign(this.ctx.stage.stage ?? this.ctx.run.stage);
      this.stageName.textContent = info.title ?? design.title;
      this.routeHint.textContent = info.routeHint ?? design.routeHint;
      this.prepareMap(info, arena);
    }
    this.root.hidden = false;
    const p = this.ctx.player.position;
    const active = info.encounters?.find(e => e.phase === 'active');
    const preparation = info.preparation;
    const inPreparation = info.phase === 'explore' && !active && preparation
      && Math.hypot(preparation.position.x - p.x, preparation.position.z - p.z) <= 18;
    const phaseKey = info.phase === 'cleared' && !info.exit ? 'reward' : info.phase;
    const stateKey = `${phaseKey}/${active?.id ?? ''}/${this.ctx.stage.waveIndex}/${this.ctx.stage.waveCount}/${!!info.spawnBlocked}/${!!inPreparation}`;
    if (this.phase !== stateKey) {
      this.phase = stateKey;
      this.root.dataset.phase = info.phase;
      this.root.dataset.encounter = active ? 'active' : '';
      this.instruction.textContent = inPreparation ? '战前补给 · 弹药、生命、护盾与装备'
        : active && info.spawnBlocked ? '守卫等待入场 · 退回通道拉开距离' : active ? `${active.label} · 击退拦路守卫`
        : phaseKey === 'reward' ? '清场奖励 · 出口即将开启'
          : info.automaticEncounters && info.phase === 'explore' ? '沿路探索 · 接近战区自动触发' : PHASE_TEXT[info.phase];
      this.targetLabel.textContent = inPreparation ? preparation.label : active?.label ?? (info.phase === 'cleared' && info.exit ? '前往出口' : info.objectiveLabel ?? '灵火祭坛');
    }
    let currentZone = '探索区域';
    let nearestZoneDistance = Infinity;
    for (const zone of info.zones) {
      const d = Math.hypot(zone.position.x - p.x, zone.position.z - p.z);
      if (d <= zone.radius && d < nearestZoneDistance) {
        currentZone = zone.label;
        nearestZoneDistance = d;
      }
    }
    if (currentZone !== this.shownZone) {
      this.shownZone = currentZone;
      this.zoneLabel.textContent = currentZone;
    }
    const target = inPreparation ? preparation.position : active?.position ?? (info.phase === 'cleared' ? info.exit ?? info.objective : info.objective);
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const distance = Math.round(Math.hypot(dx, dz));
    if (distance !== this.shownDistance) {
      this.shownDistance = distance;
      this.distance.textContent = `${distance} 米`;
    }
    // 玩家水平朝向不含镜头震动，让方向提示在战斗中保持稳定。
    const angle = Math.atan2(dx, -dz) + this.ctx.player.yaw;
    const degrees = Math.round(angle * 180 / Math.PI);
    if (degrees !== this.shownDirection) {
      this.shownDirection = degrees;
      this.direction.style.transform = `rotate(${degrees}deg)`;
    }
    const discoveries = info.sites.reduce((n, site) => n + Number(site.visited), 0);
    const encounters = info.encounters ?? [], defeated = encounters.filter(e => e.phase === 'cleared').length;
    const discoveryKey = `${discoveries}/${info.sites.length}/${defeated}/${encounters.length}`;
    if (discoveryKey !== this.shownDiscoveries) {
      this.shownDiscoveries = discoveryKey;
      this.discovered.textContent = `${discoveries}/${info.sites.length} 补给${encounters.length ? ` · ${defeated}/${encounters.length} 遭遇` : ''}`;
    }
    this.draw(info);
  }

  private prepareMap(info: AdventureInfo, arena: ArenaInfo): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const canvas of [this.map, this.terrain]) {
      canvas.width = Math.round(MAP_W * this.dpr);
      canvas.height = Math.round(MAP_H * this.dpr);
    }
    this.mapCtx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.terrainCtx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scale = Math.min((MAP_W - MAP_PAD * 2) / Math.max(1, arena.maxX - arena.minX),
      (MAP_H - MAP_PAD * 2) / Math.max(1, arena.maxZ - arena.minZ));
    this.offsetX = (MAP_W - (arena.maxX - arena.minX) * this.scale) / 2 - arena.minX * this.scale;
    this.offsetZ = (MAP_H - (arena.maxZ - arena.minZ) * this.scale) / 2 - arena.minZ * this.scale;
    const c = this.terrainCtx;
    if (!c) return;
    c.clearRect(0, 0, MAP_W, MAP_H);
    for (const rect of info.floorRects ?? []) {
      c.fillStyle = 'rgba(200, 215, 225, .2)';
      c.fillRect(this.x(rect.minX), this.z(rect.minZ), (rect.maxX-rect.minX)*this.scale, (rect.maxZ-rect.minZ)*this.scale);
    }
    for (const zone of info.floorRects ? [] : info.zones) {
      const x = this.x(zone.position.x), z = this.z(zone.position.z);
      c.beginPath(); c.arc(x, z, zone.radius * this.scale, 0, Math.PI * 2);
      c.fillStyle = 'rgba(200, 185, 153, .11)'; c.fill();
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const path of info.paths) {
      c.beginPath();
      path.points.forEach((p, i) => i === 0 ? c.moveTo(this.x(p.x), this.z(p.z)) : c.lineTo(this.x(p.x), this.z(p.z)));
      c.lineWidth = Math.max(2, path.width * this.scale);
      c.strokeStyle = 'rgba(200, 185, 153, .22)'; c.stroke();
    }
    c.textAlign = 'center';
    c.fillStyle = 'rgba(244, 216, 147, .6)'; c.font = '10px "Bahnschrift", sans-serif';
    c.fillText('N', MAP_W - 13, 14);
    c.beginPath(); c.moveTo(MAP_W - 13, 19); c.lineTo(MAP_W - 13, 26);
    c.lineWidth = 1; c.strokeStyle = 'rgba(244, 216, 147, .35)'; c.stroke();
  }

  private draw(info: AdventureInfo): void {
    const c = this.mapCtx;
    if (!c) return;
    c.clearRect(0, 0, MAP_W, MAP_H);
    c.drawImage(this.terrain, 0, 0, MAP_W, MAP_H);
    const p = this.ctx.player.position;
    if (info.preparation) {
      c.save(); c.translate(this.x(info.preparation.position.x), this.z(info.preparation.position.z));
      c.fillStyle = '#f4d893'; c.strokeStyle = '#f4d893'; c.lineWidth = 1.5;
      c.strokeRect(-6, -6, 12, 12); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '10px sans-serif';
      c.fillText('商', 0, 0); c.restore();
    }
    for (const encounter of info.encounters ?? []) {
      if (encounter.phase === 'undiscovered'
        && Math.hypot(encounter.position.x - p.x, encounter.position.z - p.z) > 18) continue;
      c.save(); c.translate(this.x(encounter.position.x), this.z(encounter.position.z));
      c.lineWidth = 1.5;
      c.strokeStyle = encounter.phase === 'active' ? '#ff9476' : encounter.phase === 'cleared' ? '#91d7be' : '#e6b679';
      c.beginPath(); c.arc(0, 0, encounter.phase === 'active' ? 8 : 6, 0, Math.PI * 2); c.stroke();
      if (encounter.phase === 'cleared') {
        c.beginPath(); c.moveTo(-3, 0); c.lineTo(-.5, 2.5); c.lineTo(3.5, -2.5); c.stroke();
      } else c.stroke(this.encounterGlyph);
      c.restore();
    }
    for (const site of info.sites) {
      // 路线可查，支路奖励要走近才显露，保留探索感。
      if (!site.visited && Math.hypot(site.position.x - p.x, site.position.z - p.z) > 18) continue;
      c.save(); c.translate(this.x(site.position.x), this.z(site.position.z));
      c.lineWidth = 1; c.strokeStyle = site.visited ? 'rgba(184, 234, 255, .45)' : '#efe4cc';
      c.stroke(this.cacheGlyph);
      if (site.visited) {
        c.beginPath(); c.moveTo(-2, 0); c.lineTo(0, 2); c.lineTo(3, -1); c.stroke();
      }
      c.restore();
    }
    const active = info.encounters?.find(e => e.phase === 'active');
    const target = active?.position ?? (info.phase === 'cleared' ? info.exit ?? info.objective : info.objective);
    c.save(); c.translate(this.x(target.x), this.z(target.z));
    c.fillStyle = active ? '#ff9476' : info.phase === 'cleared' ? '#b8eaff' : '#f4d893';
    c.shadowColor = c.fillStyle; c.shadowBlur = 6; c.fill(this.altarGlyph); c.restore();
    c.save(); c.translate(this.x(p.x), this.z(p.z)); c.rotate(-this.ctx.player.yaw);
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 18, -Math.PI / 2 - .42, -Math.PI / 2 + .42); c.closePath();
    c.fillStyle = 'rgba(184, 234, 255, .1)'; c.fill();
    c.beginPath(); c.moveTo(0, -5.5); c.lineTo(4, 4); c.lineTo(0, 2); c.lineTo(-4, 4); c.closePath();
    c.fillStyle = '#b8eaff'; c.strokeStyle = '#07060a'; c.lineWidth = 1.5; c.stroke(); c.fill();
    c.restore();
  }

  private x(v: number): number { return v * this.scale + this.offsetX; }
  private z(v: number): number { return v * this.scale + this.offsetZ; }
}
