import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { AssetLibrary } from '../../assets/AssetLibrary';
import { attachNativeBody, type NativeBody } from '../../assets/NativeRig';
import { ClipPlayer } from '../../anim/ClipPlayer';
import { groundAt } from './physics';

/**
 * 商铺的狸猫行商（SK_Npc_Merchant，清单绑定 npc / merchant）：站在强化台旁边（沿摊位弧挪半个摊位间隔、往外退一点——正后方会被强化台的光柱挡住），
 * 面朝商铺中心，头跟着玩家转（CreatureRig 的看向）。
 * 动作是 Blender 手 K 的两段循环（M12 第二期，public/assets/anim/SK_Npc_Merchant.json）：Locomotion（= Idle）与 Talk。
 * Unity 版没把行商摆进商店（SK_Npc_Merchant.prefab 没被场景 / 脚本引用），只在叠加表里写了用法：Talk 是持续型——进状态后一直播，
 * 交易界面关掉时由玩法 CrossFade 回 Idle。网页的商店没有界面（摊位上按 F 买），照这个用法换成：玩家走到行商 TALK_RANGE 以内、
 * 或刚成交（coins:changed 且 delta < 0）就 Talk，走开且成交过去 TALK_HOLD 秒后回 Idle。
 * 只是摆设：不挡路、不能交互、不碰商店的交易逻辑。美术没加载到时不摆（不出程序化替身）。
 */

const ASSET = 'SK_Npc_Merchant';
/** 沿摊位弧往一侧挪的角度（摊位间隔 25° 的一半）与比摊位弧往外退的距离（米） */
const SIDE = 12.5 * Math.PI / 180;
const OUT = 0.8;
/** 玩家走到这个距离以内就开口（米，水平） */
const TALK_RANGE = 6.5;
/** 成交后至少说这么久（秒） */
const TALK_HOLD = 3;
/** Idle ↔ Talk 的交叉淡入（秒） */
const FADE = 0.3;

const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };

interface Keeper {
  host: THREE.Group;
  body: NativeBody;
  clips: ClipPlayer;
  talking: boolean;
  talkUntil: number;
  disposed: boolean;
}

export class MerchantNpcs {
  private keepers: Keeper[] = [];
  private readonly look = new THREE.Vector3();
  private listening = false;

  constructor(private readonly ctx: GameContext, private readonly group: THREE.Group) {}

  /**
   * 在强化台（bench，台子中心的地面点）旁边摆一个行商，面朝商铺中心（center）。返回撤掉它的函数；
   * 资产没加载到、或那里是墙 / 落差太大时不摆（返回空函数）。
   */
  spawn(bench: THREE.Vector3, center: THREE.Vector3): () => void {
    const ctx = this.ctx;
    const asset = AssetLibrary.get(ASSET) ?? AssetLibrary.findBound('npc', 'merchant');
    if (!asset) return () => {};
    _dir.set(bench.x - center.x, 0, bench.z - center.z);
    const r = _dir.length() + OUT;
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    _dir.normalize();
    // 摊位弧上、强化台和它一侧邻摊的正中间，再往外退 OUT
    const c = Math.cos(SIDE), s = Math.sin(SIDE);
    const x = center.x + (_dir.x * c + _dir.z * s) * r, z = center.z + (-_dir.x * s + _dir.z * c) * r;
    // 要有地方站：从台子胸口高度朝站位打一条射线，撞墙就不摆；脚下的地面和台子差太多（站到崖下 / 坡上）也不摆
    const chest = new THREE.Vector3(bench.x, bench.y + 1.1, bench.z);
    _to.set(x - bench.x, 0, z - bench.z);
    const reach = _to.length() + 0.45;
    if (ctx.world.raycast(chest, _to.normalize(), reach, _hit)) return () => {};
    const y = groundAt(ctx, x, z, bench.y + 1.5);
    if (!Number.isFinite(y) || Math.abs(y - bench.y) > 0.9) return () => {};

    const host = new THREE.Group();
    host.name = 'merchant';
    host.position.set(x, y, z);
    // 模型约定：facing = atan2(dx, dz)，+Z 朝前——面朝商铺中心
    host.rotation.y = Math.atan2(center.x - x, center.z - z);
    let body: NativeBody | null = null;
    try {
      body = attachNativeBody(host, asset);
    } catch (err) {
      console.warn('[merchant] 行商的模型挂不上', err);
    }
    if (!body) return () => {};
    this.group.add(host);
    host.updateMatrixWorld(true);
    const clips = new ClipPlayer(asset.id, body.model, { root: host, rig: true, inPlace: true });
    clips.lookTarget = this.look;
    clips.playLocomotion();
    const k: Keeper = { host, body, clips, talking: false, talkUntil: 0, disposed: false };
    this.keepers.push(k);
    this.listen();
    return () => this.remove(k);
  }

  /** 成交（扣了灵石）：附近的行商开口 */
  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.ctx.events.on('coins:changed', ({ delta }) => {
      if (!(delta < 0)) return;
      const p = this.ctx.player.position, now = this.ctx.time.now;
      for (const k of this.keepers) {
        if (Math.hypot(k.host.position.x - p.x, k.host.position.z - p.z) <= TALK_RANGE * 2) k.talkUntil = now + TALK_HOLD;
      }
    });
  }

  update(dt: number): void {
    if (this.keepers.length === 0) return;
    const ctx = this.ctx;
    const p = ctx.player.position;
    this.look.copy(ctx.player.eye);
    const now = ctx.time.now;
    for (const k of this.keepers) {
      const near = ctx.player.alive && Math.hypot(k.host.position.x - p.x, k.host.position.z - p.z) <= TALK_RANGE;
      const talk = near || now < k.talkUntil;
      if (talk !== k.talking && k.clips.ready) {
        k.talking = talk;
        // 叠加表：Talk 进状态后一直播（循环），说完 CrossFade 回 Idle
        if (talk) k.clips.play('Talk', FADE);
        else k.clips.playLocomotion();
      }
      k.clips.update(dt);
    }
  }

  clear(): void {
    for (const k of [...this.keepers]) this.remove(k);
  }

  private remove(k: Keeper): void {
    if (k.disposed) return;
    k.disposed = true;
    k.clips.dispose();
    k.body.dispose();
    k.host.removeFromParent();
    this.keepers = this.keepers.filter((x) => x !== k);
  }
}
