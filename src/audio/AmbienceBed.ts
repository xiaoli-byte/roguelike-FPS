/**
 * 实时环境声床（检视页 / 游玩版）：一个 AudioWorklet（ambienceWorklet.ts）现场合成风、雨、水、雷，接在 SynthPlayer 的总线上。
 * 和正式游戏的 Ambience.ts（离线烘好的 24 s 循环，走 Unity 那套）不是一回事：这里按玩家此刻站的地方实时调各层——
 * 由 AmbienceSense（src/world/plateau/ambienceSense.ts）每帧把「周围是什么」填进 params。
 *
 * 雷：thunderAt(dist, pan) 按声速晚 dist / 343 秒才响；雷暴大时自己偶尔来一声远雷（看不见的云里打雷）。
 * 浏览器没有 AudioWorklet（或载入失败）就安静地什么都不做。
 */
import * as THREE from 'three';
import type { SynthPlayer } from './SynthPlayer';
import { AMBIENCE_DEFAULTS, AMBIENCE_WORKLET_SRC, type AmbienceParams } from './ambienceWorklet';

export type { AmbienceParams };

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class AmbienceBed {
  /** 声床音量（乘在 params.volume 上；SynthPlayer.volume 再管总音量） */
  volume = 1;
  /** 这一帧的环境（AmbienceSense.update 填） */
  readonly params: AmbienceParams = { ...AMBIENCE_DEFAULTS };
  private node: AudioWorkletNode | null = null;
  private clock = 0;
  private sendIn = 0;
  private rumbleIn = 10;
  private readonly queue: { at: number; dist: number; pan: number }[] = [];

  constructor(player: SynthPlayer) {
    player.onReady(p => { void this.start(p); });
  }

  /** 处理器已经在跑 */
  get running(): boolean { return !!this.node; }

  private async start(p: SynthPlayer): Promise<void> {
    const ac = p.ac, out = p.out;
    if (!ac || !out || !ac.audioWorklet) return;
    const url = URL.createObjectURL(new Blob([AMBIENCE_WORKLET_SRC], { type: 'text/javascript' }));
    try {
      await ac.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ac, 'ambience-bed', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(out);
      this.node = node;
      this.post();
    } catch (err) {
      console.warn('[AmbienceBed] 环境声床起不来，不出声', err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** 每帧（params 填好之后）：到点的雷发出去、雷暴里偶尔一声远雷、参数每 0.08 s 发一次 */
  update(dt: number): void {
    this.clock += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (q.at > this.clock) continue;
      this.queue.splice(i, 1);
      this.node?.port.postMessage({ type: 'thunder', dist: q.dist, pan: q.pan });
    }
    const rain = this.params.rain;
    if (rain > 0.35) {
      this.rumbleIn -= dt;
      if (this.rumbleIn <= 0) {
        this.rumbleIn = 9 + Math.random() * 22 / rain;
        this.thunderAt(1800 + Math.random() * 5000, Math.random() * 1.6 - 0.8, 0);
      }
    }
    this.sendIn -= dt;
    if (this.sendIn <= 0) { this.sendIn = 0.08; this.post(); }
  }

  /** 一声雷：dist 米外、声像 pan（−1..1）；缺省按声速晚到 */
  thunderAt(dist: number, pan: number, delay = dist / 343): void {
    if (this.queue.length > 8) this.queue.shift();
    this.queue.push({ at: this.clock + delay, dist, pan });
  }

  /** 落雷劈在 at：按此刻镜头算距离和左右 */
  strike(at: THREE.Vector3, camera: THREE.Camera): void {
    camera.getWorldPosition(_d);
    _d.subVectors(at, _d);
    const dist = _d.length();
    _r.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(_q)).setY(0);
    const pan = dist > 1 && _r.lengthSq() > 1e-6 ? THREE.MathUtils.clamp(_d.setY(0).normalize().dot(_r.normalize()), -1, 1) : 0;
    this.thunderAt(dist, pan);
  }

  private post(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: 'p', p: { ...this.params, volume: this.params.volume * this.volume } });
  }
}
