/**
 * 关卡自带的出图后期（第四章网页原生高原场景的 FilmPost：印片 LUT、泛光、部分自动曝光……，plateau/stage/layer.ts 挂上）。
 * Game.render 先问它：挂着就由它画这一帧（连枪模一起），不走 Unity 场景那套 PostStack；卸下时把色调映射还给 Game。
 */
import * as THREE from 'three';
import type { FilmPost } from './FilmPost';

let film: FilmPost | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let toneBefore: THREE.ToneMapping = THREE.ACESFilmicToneMapping;
let last = 0;

export const stageFilm = {
  /** 挂上 / 卸下（null） */
  set(next: FilmPost | null, r: THREE.WebGLRenderer): void {
    if (next && !film) toneBefore = r.toneMapping;
    if (!next && film) r.toneMapping = toneBefore;
    film = next;
    renderer = r;
    last = 0;
  },
  get active(): FilmPost | null { return film; },
  /** 画这一帧；返回 false = 没挂（Game 照原样画） */
  render(scene: THREE.Scene, camera: THREE.Camera, view: { scene: THREE.Scene; camera: THREE.Camera } | null): boolean {
    if (!film || !renderer) return false;
    const now = performance.now();
    const dt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    film.render(scene, camera, dt, view);
    return true;
  },
};
