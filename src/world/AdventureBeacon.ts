/** 现有 Hunyuan 祭坛上的导航光与交互。几何只用于光效，不创建美术模型。 */
import * as THREE from 'three';
import type { GameContext, Interactable } from '../core/types';

const COLORS = { explore: 0xffda82, battle: 0xff7156, cleared: 0x79e5ba };
type Phase = keyof typeof COLORS;
const PHASE_LABELS: Record<Phase, string> = {
  explore: '探索支路 · 准备后启动',
  battle: '试炼进行中 · 清除守卫',
  cleared: '试炼完成 · 前往出口',
};
const LABEL_FADE_NEAR = 3.4;
const LABEL_FADE_FAR = 6;

export class AdventureBeacon {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly ring: THREE.Mesh;
  private readonly beam: THREE.Mesh;
  private readonly labelMaterial: THREE.SpriteMaterial;
  private readonly labelTexture: THREE.CanvasTexture;
  private readonly label: THREE.Sprite;
  private readonly item: Interactable;
  private readonly removeInteract: () => void;
  private phase: Phase = 'explore';
  private disposed = false;

  constructor(private readonly ctx: GameContext, position: THREE.Vector3, parent: THREE.Object3D, activate: () => boolean) {
    this.group.name = 'adventure.altarBeacon';
    this.group.position.copy(position);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(COLORS.explore) }, uActive: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uActive; varying vec2 vUv;
        void main(){ float ribbon=.8+.2*sin(vUv.y*48.-uTime*2.6+vUv.x*12.566);
          float fade=pow(1.-vUv.y,2.4); gl_FragColor=vec4(uColor,fade*ribbon*(.18+uActive*.11));
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    const beamGeo = new THREE.CylinderGeometry(1.35, 2.1, 27, 20, 1, true);
    beamGeo.translate(0, 13.5, 0);
    this.beam = new THREE.Mesh(beamGeo, this.material);
    this.beam.renderOrder = 3;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.8, 48), new THREE.MeshBasicMaterial({
      color: COLORS.explore, transparent: true, opacity: .58, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = .025;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    this.labelTexture = new THREE.CanvasTexture(canvas); this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.labelMaterial = new THREE.SpriteMaterial({ map: this.labelTexture, depthWrite: false, fog: false, toneMapped: false });
    this.label = new THREE.Sprite(this.labelMaterial); this.label.position.y = 5.1; this.label.scale.set(4.8, 1.2, 1);
    this.paintLabel(); this.fadeLabel();
    this.group.add(this.beam, this.ring, this.label); parent.add(this.group);
    this.item = {
      position: position.clone().add(new THREE.Vector3(0, 1.2, 0)), radius: 4.2, enabled: true,
      prompt: () => {
        const info = ctx.stage?.exploration;
        const active = info?.encounters?.find(e => e.phase === 'active');
        return { title: '灵火祭坛', subtitle: active ? '附近仍在交战' : '启动区域试炼',
          lines: active ? [`先清除 ${active.label} 的守卫。`]
            : [info?.routeHint ?? '可先探索支路、寻找物资，再挑战祭坛守卫。', '试炼完成后，未交战的沿途守卫将撤离。'],
          color: '#ffda82', key: 'F' };
      },
      onInteract: () => {
        if (this.disposed || !this.item.enabled || this.phase !== 'explore' || !ctx.player.alive || ctx.game.state !== 'playing') return;
        if (activate()) this.setPhase('battle');
      },
    };
    this.removeInteract = ctx.interact.add(this.item);
  }

  setPhase(phase: Phase): void {
    if (this.disposed || phase === this.phase) return;
    this.phase = phase; this.item.enabled = phase === 'explore';
    this.material.uniforms.uColor.value.setHex(COLORS[phase]);
    this.material.uniforms.uActive.value = phase === 'battle' ? 1 : 0;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(COLORS[phase]);
    this.paintLabel();
    this.beam.visible = phase !== 'cleared';
  }

  /** 每个阶段只上传一次文字纹理；靠近时使用透明度给已有 F 提示留出画面。 */
  private paintLabel(): void {
    const paint = (this.labelTexture.image as HTMLCanvasElement).getContext('2d');
    if (!paint) return;
    const color = `#${COLORS[this.phase].toString(16).padStart(6, '0')}`;
    paint.clearRect(0, 0, 512, 128);
    paint.fillStyle = 'rgba(20,17,25,.83)'; paint.fillRect(0, 0, 512, 128);
    paint.strokeStyle = color; paint.lineWidth = 3; paint.strokeRect(2, 2, 508, 124);
    paint.fillStyle = '#fff2cd'; paint.textAlign = 'center'; paint.textBaseline = 'middle';
    paint.font = 'bold 44px "Microsoft YaHei", sans-serif'; paint.fillText('灵火祭坛', 256, 42);
    paint.fillStyle = color; paint.font = '28px "Microsoft YaHei", sans-serif'; paint.fillText(PHASE_LABELS[this.phase], 256, 94);
    this.labelTexture.needsUpdate = true;
  }

  private fadeLabel(): void {
    // 水平距离符合操作距离，避免标牌悬高使贴近祭坛时仍盖住近景。
    const distance = Math.hypot(this.ctx.camera.position.x - this.group.position.x, this.ctx.camera.position.z - this.group.position.z);
    const t = Math.max(0, Math.min(1, (distance - LABEL_FADE_NEAR) / (LABEL_FADE_FAR - LABEL_FADE_NEAR)));
    this.labelMaterial.opacity = t * t * (3 - 2 * t);
  }

  update(_dt: number, time: number): void {
    if (this.disposed) return;
    this.material.uniforms.uTime.value = time;
    const scale = 1 + Math.sin(time * 1.5) * .03; this.ring.scale.setScalar(scale);
    this.label.position.y = 5.1 + Math.sin(time * 1.2) * .1;
    this.fadeLabel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.item.enabled = false; this.removeInteract(); this.group.removeFromParent();
    this.ring.geometry.dispose(); (this.ring.material as THREE.Material).dispose();
    this.beam.geometry.dispose(); this.material.dispose(); this.labelMaterial.dispose(); this.labelTexture.dispose();
  }
}
