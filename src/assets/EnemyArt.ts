/**
 * 敌人 / Boss 的美术资产接入（StandardEnemy 与 BossBase 共用）。
 *
 * 顺序：先绑身体（人形骨骼走 SkinnedBody，其余走通用部件骨架 PartsRig），再挂武器等静态挂件。
 * 部件骨架会隐藏宿主里所有实体网格，所以要先知道哪些挂点会换上美术挂件、把它们排除在外。
 */
import type * as THREE from 'three';
import { AssetLibrary } from './AssetLibrary';
import { applyArtEnvironment } from './ArtEnvironment';
import { isHumanoidRig } from './HumanoidBind';
import { attachNativeBody, type NativeBody } from './NativeRig';
import { attachPartsBody } from './PartsRig';
import { attachSkinnedBody, type SkinnedBody } from './SkinnedBody';
import { attachStaticPart, type AttachedPart } from './StaticAttachment';

export interface EnemyArtOptions {
  /** buildModel 返回的模型根 */
  host: THREE.Object3D;
  /** EnemyDef.id（清单 bind.id） */
  defId: string;
  /** 章节主题（清单 bind.variant）：同一兵种在各章节换用不同造型，缺失时回退默认资产 */
  variant?: string;
  /** 人形敌人的 HumanoidRig（约定存放在 this.rig）；其他敌人传 undefined */
  rig: unknown;
  renderer: THREE.WebGLRenderer;
  lowQuality: boolean;
  /** 登记实例材质：交给敌人释放、参与受击闪白 */
  own: (m: THREE.MeshStandardMaterial) => void;
}

export interface EnemyArt {
  body: SkinnedBody | null;
  /** 原生骨架资产（清单 skeleton.mode = 'native'）：敌人按骨骼名直接驱动；其余资产为 null */
  native: NativeBody | null;
  parts: AttachedPart[];
}

export function attachEnemyArt(o: EnemyArtOptions): EnemyArt {
  const lodScale = o.lowQuality ? 0.5 : 1;
  const attachments = AssetLibrary.findAttachments('enemy', o.defId, o.variant);
  const sockets = attachments
    .map((a) => o.host.getObjectByName(a.entry.bind.attachment ?? ''))
    .filter((s): s is THREE.Object3D => !!s);

  let body: SkinnedBody | null = null;
  let native: NativeBody | null = null;
  const asset = AssetLibrary.findBound('enemy', o.defId, o.variant);
  if (asset && asset.entry.kind === 'skeletal') {
    if (asset.entry.skeleton?.mode === 'native') body = native = attachNativeBody(o.host, asset, lodScale);
    else if (asset.entry.rig) body = attachPartsBody(o.host, asset, lodScale, sockets);
    else if (isHumanoidRig(o.rig)) body = attachSkinnedBody(o.host, o.rig, asset, lodScale);
  }
  const own = (mats: THREE.MeshStandardMaterial[]): void => {
    for (const m of mats) {
      applyArtEnvironment(m, o.renderer);
      o.own(m);
    }
  };
  if (body) own(body.materials);

  const parts: AttachedPart[] = [];
  for (const a of attachments) {
    const part = attachStaticPart(o.host, a, lodScale);
    if (!part) continue;
    own(part.materials);
    parts.push(part);
  }
  return { body, native, parts };
}
