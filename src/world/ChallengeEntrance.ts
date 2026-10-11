import * as THREE from 'three';
import type { GameContext, Interactable } from '../core/types';

/** A local discovery mark on an existing side passage; it never advances the stage. */
export class ChallengeEntrance {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly item: Interactable;
  private readonly removeInteract: () => void;
  private readonly eye = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private discovered = false;
  private disposed = false;
  private opened = false;

  constructor(private readonly ctx: GameContext, readonly room: string, position: THREE.Vector3, parent: THREE.Object3D,
    private readonly canOpen: () => boolean, private readonly open: () => void,
    private readonly discover: () => void) {
    this.group.name = `challenge.hiddenEntrance:${room}`;
    this.group.position.copy(position);
    this.group.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.75, 1, 32), new THREE.MeshBasicMaterial({
      color: 0xb591f2, transparent: true, opacity: .6, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = .04;
    this.group.add(this.ring);
    parent.add(this.group);
    this.item = {
      position: position.clone().add(new THREE.Vector3(0, 1, 0)), radius: 3.5, enabled: false,
      prompt: () => ({ title: '隐秘入口', subtitle: canOpen() ? '调查 · 探索支路' : '暂时无法调查',
        lines: canOpen() ? ['前方似乎另有空间。', '可选择调查，也可沿主路继续前进。']
          : ['先清除附近的主路守卫，再回来调查。'], color: '#b591f2', key: 'F' }),
      onInteract: () => {
        if (this.disposed || this.opened || !this.item.enabled || !ctx.player.alive
          || ctx.game.state !== 'playing' || !this.canOpen()) return;
        // Register first: repeating F or revisiting the room cannot reopen this challenge.
        this.opened = true;
        this.item.enabled = false;
        this.group.visible = false;
        this.open();
      },
    };
    this.removeInteract = ctx.interact.add(this.item);
  }

  update(_dt: number, time: number): void {
    if (this.disposed || this.opened) return;
    const player = this.ctx.player;
    this.eye.copy(player.position); this.eye.y += 1.2;
    this.target.copy(this.group.position); this.target.y += .6;
    const visible = player.alive && this.ctx.game.state === 'playing'
      && Math.abs(player.position.y - this.group.position.y) <= 3
      && Math.hypot(player.position.x - this.group.position.x, player.position.z - this.group.position.z) <= 12
      && !this.ctx.world.segmentBlocked(this.eye, this.target);
    this.group.visible = visible;
    this.item.enabled = visible;
    this.ring.material.opacity = .5 + Math.sin(time * 2) * .12;
    if (visible && !this.discovered) { this.discovered = true; this.discover(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.item.enabled = false; this.removeInteract();
    this.group.removeFromParent(); this.ring.geometry.dispose(); this.ring.material.dispose();
  }
}
