import * as THREE from 'three';
import { AirLife } from './AirLife';
import { Atmosphere } from './Atmosphere';
import { MistStreams } from './MistStreams';
import { unityAtmosphereLayout, type AtmosphereLayoutSource, type UnityAtmosphereLayout } from './unityAtmosphereLayout';

/**
 * 把一张 Unity 导出场景的氛围摆位（unityAtmosphereLayout.ts 按这张图的数据算出来的）建成网格：
 * 场地外圈 / 谷底的雾带、贴水面的雾、落叶、鸟、尘。最多四次绘制调用，没有的那一样不建。
 *
 * 用法（Atmosphere.bind 之后——摆位要读风向，雾和活物要读它的风、时间、日光）：
 *   const dressing = new UnityAtmosphereDressing(document);
 *   parent.add(dressing.group);
 *   dressing.useSceneDepth(depthTexture);   // 可选：这一帧的场景深度（有水面的图现成有），雾带和后面的表面软相交
 *   dressing.dispose();                     // 卸载这张图时，在 Atmosphere.unbind 之前
 */
export class UnityAtmosphereDressing {
  readonly group = new THREE.Group();
  /** 这张图算出来的摆位（检视 / 调试用） */
  readonly layout: UnityAtmosphereLayout;
  readonly mist: MistStreams | null = null;
  readonly waterMist: MistStreams | null = null;
  readonly life: AirLife | null = null;

  constructor(document: AtmosphereLayoutSource) {
    this.group.name = 'UnityAtmosphereDressing';
    const layout = this.layout = unityAtmosphereLayout(document, Atmosphere.wind);
    if (layout.mist.length) {
      this.mist = new MistStreams(layout.mist);
      this.group.add(this.mist.mesh);
    }
    if (layout.waterMist.length) {
      // 贴水面的雾要后于水面画（水面是透明物、renderOrder 0），否则被水面盖掉
      this.waterMist = new MistStreams(layout.waterMist, { renderOrder: 1, seed: 7207 });
      this.waterMist.mesh.name = 'MistStreams.water';
      this.group.add(this.waterMist.mesh);
    }
    if (layout.leaves.length || layout.birds.length || layout.motes.length) {
      this.life = new AirLife({ leaves: layout.leaves, birds: layout.birds, motes: layout.motes });
      this.group.add(this.life.group);
    }
  }

  /** 这一帧的场景深度（THREE.DepthTexture）；传 null 关掉。贴水面的那一组不用（它本来就贴着水面） */
  useSceneDepth(texture: THREE.Texture | null): void {
    this.mist?.useSceneDepth(texture);
  }

  dispose(): void {
    this.mist?.dispose();
    this.waterMist?.dispose();
    this.life?.dispose();
    this.group.removeFromParent();
  }
}
