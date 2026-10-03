/**
 * 英雄预览台自建贴图（Canvas 程序化绘制，白色图案 + 透明底，由材质颜色着色）：
 * 祭台符文环、粒子光点、柔和光晕、光柱。
 * 由 HeroPreview 持有，dispose 时释放（全部自建，不借用 WeaponModels 等模块的共享贴图）。
 */
import * as THREE from 'three';
import { TAU } from '../../core/math';

function canvas2d(w: number, hgt: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  return [c, c.getContext('2d')];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 先天八卦（自上起顺时针），每卦三爻由内到外：1 = 阳爻（实线），0 = 阴爻（断线） */
const TRIGRAMS: readonly (readonly number[])[] = [
  [1, 1, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1],
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 0],
];

/** 祭台顶面的符文环：双圈刻度 + 八卦 + 内八角星 */
export function makeRuneTexture(): THREE.CanvasTexture {
  const S = 512;
  const R = S / 2;
  const [c, g] = canvas2d(S, S);
  if (g) {
    g.translate(R, R);
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    const ring = (r: number, w: number, a: number): void => {
      g.globalAlpha = a;
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    };
    ring(R * 0.955, 6, 1);
    ring(R * 0.885, 2, 0.7);
    ring(R * 0.6, 3.5, 0.95);
    ring(R * 0.545, 1.5, 0.5);
    ring(R * 0.2, 2, 0.55);

    // 外圈刻度（每 8 格一道长刻）
    for (let i = 0; i < 64; i++) {
      g.save();
      g.rotate((i / 64) * TAU);
      const major = i % 8 === 0;
      g.globalAlpha = major ? 0.95 : 0.45;
      g.fillRect(-1.5, -R * 0.95, 3, major ? R * 0.07 : R * 0.04);
      g.restore();
    }

    // 八卦
    const half = R * 0.12;
    const th = R * 0.034;
    for (let i = 0; i < 8; i++) {
      g.save();
      g.rotate((i / 8) * TAU);
      g.globalAlpha = 0.95;
      const bars = TRIGRAMS[i];
      for (let k = 0; k < 3; k++) {
        const y = -(R * 0.665 + k * R * 0.072) - th / 2;
        if (bars[k]) {
          g.fillRect(-half, y, half * 2, th);
        } else {
          const gap = half * 0.26;
          g.fillRect(-half, y, half - gap, th);
          g.fillRect(gap, y, half - gap, th);
        }
      }
      // 卦间的小圆点
      g.rotate(TAU / 16);
      g.globalAlpha = 0.8;
      g.beginPath();
      g.arc(0, -R * 0.74, R * 0.017, 0, TAU);
      g.fill();
      g.restore();
    }

    // 内八角星（两个错开 45° 的正方形）
    g.globalAlpha = 0.55;
    g.lineWidth = 2.5;
    for (let s = 0; s < 2; s++) {
      g.save();
      g.rotate((s * TAU) / 8);
      g.strokeRect(-R * 0.36, -R * 0.36, R * 0.72, R * 0.72);
      g.restore();
    }
    g.globalAlpha = 1;
  }
  const t = toTexture(c);
  t.anisotropy = 4;
  return t;
}

/** 粒子用的小光点：亮核 + 柔和外晕 */
export function makeSparkTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, g] = canvas2d(S, S);
  if (g) {
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.16, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.42, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  return toTexture(c);
}

/** 柔和圆形光晕（无亮核）：符文环中心的柔光、狐火、电弧光晕 */
export function makeGlowTexture(): THREE.CanvasTexture {
  const S = 64;
  const [c, g] = canvas2d(S, S);
  if (g) {
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  return toTexture(c);
}

/** 光柱：自下而上渐隐，叠加几道竖向光纹（贴在开口圆柱上，u 绕圆周、v 自下而上） */
export function makePillarTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 128;
  const [c, g] = canvas2d(W, H);
  if (g) {
    // Canvas 顶部对应圆柱顶端（flipY），所以顶端透明、底部最亮
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grd.addColorStop(0.9, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0.4)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // 用 destination-out 擦出明暗相间的竖纹（平滑插值的循环噪声，圆周接缝处无断层）
    g.globalCompositeOperation = 'destination-out';
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const N = 9;
    const vals: number[] = [];
    for (let i = 0; i < N; i++) vals.push(rnd());
    for (let x = 0; x < W; x++) {
      const u = (x / W) * N;
      const i = Math.floor(u) % N;
      const s = (1 - Math.cos((u - Math.floor(u)) * Math.PI)) / 2;
      const v = vals[i] * (1 - s) + vals[(i + 1) % N] * s;
      g.globalAlpha = 0.15 + v * 0.75;
      g.fillRect(x, 0, 1, H);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
