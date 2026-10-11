/** Transfer the fox's existing animated tail chains onto the generated art mesh.
 * The atlas, positions, normals and UVs stay intact. Only instance skin attributes
 * are changed; the shared GLB remains immutable and other heroes use its native rig.
 */
import * as THREE from 'three';
import type { LoadedAsset } from '../../../assets/AssetLibrary';
import { attachPartsBody, jointPaths } from '../../../assets/PartsRig';
import type { SkinnedBody } from '../../../assets/SkinnedBody';
import type { HeroRig } from './types';
import { artGripSocket } from './artGripRig';

export function attachHeroArt(root: THREE.Group, asset: LoadedAsset, controls?: HeroRig['artControls']): SkinnedBody | null {
  // Painted eyes and ornaments replace the prototype's opaque glowing polygons.
  // Transparent / additive flames and magical particles remain separate effects.
  const hidePrototypeGlows = (): void => root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    if (mesh.material.type === 'MeshBasicMaterial' && !mesh.material.transparent
      && mesh.material.blending === THREE.NormalBlending) mesh.visible = false;
  });
  const tails: THREE.SkinnedMesh[] = [];
  root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) tails.push(o as THREE.SkinnedMesh); });
  if (!tails.length) {
    // The new wings are continuous sculpted surfaces. Prototype feather pivots
    // would tear those surfaces apart; each wing moves on its shoulder instead.
    const paths = jointPaths(root);
    const remap = new Map<string, string>();
    for (const group of controls?.rigidGroups ?? []) {
      const name = [...paths].find(([, node]) => node === group)?.[0];
      if (!name) continue;
      for (const [childName, node] of paths) {
        for (let p: THREE.Object3D | null = node; p; p = p.parent) {
          if (p === group) { remap.set(childName, name); break; }
        }
      }
    }
    const geometries: THREE.BufferGeometry[] = [];
    const lods = asset.lods.map(original => {
      if (!remap.size) return original;
      const source = original as THREE.SkinnedMesh;
      const geometry = source.geometry.clone();
      geometries.push(geometry);
      const indices = geometry.getAttribute('skinIndex');
      const boneIndex = new Map(source.skeleton.bones.map((bone, i) => [bone.name, i]));
      for (let i = 0; i < indices.count; i++) {
        const values = [indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)]
          .map(k => boneIndex.get(remap.get(source.skeleton.bones[k]?.name) ?? '') ?? k);
        indices.setXYZW(i, ...values as [number, number, number, number]);
      }
      const template = new THREE.SkinnedMesh(geometry, source.material);
      template.name = source.name;
      template.skeleton = source.skeleton;
      return template;
    });
    const body = attachPartsBody(root, { ...asset, lods });
    if (body) hidePrototypeGlows();
    if (!body) { geometries.forEach(g => g.dispose()); return null; }
    return { ...body, dispose: () => { body.dispose(); geometries.forEach(g => g.dispose()); } };
  }
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const names = new Map([...jointPaths(root)].map(([name, node]) => [node, name]));
  const extra = new Map<string, THREE.Object3D>();
  const v = new THREE.Vector3();
  const sources = tails.map((tail, ti) => {
    const boneNames = tail.skeleton.bones.map((bone, bi) => {
      const name = `hero_tail_${ti}_${bi}`;
      extra.set(name, bone);
      return name;
    });
    const pos = tail.geometry.getAttribute('position');
    const points = new Float32Array(pos.count * 3);
    tail.skeleton.update();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      tail.applyBoneTransform(i, v).applyMatrix4(tail.matrixWorld).applyMatrix4(inv);
      v.toArray(points, i * 3);
    }
    return { name: names.get(tail.parent!), points, boneNames,
      indices: tail.geometry.getAttribute('skinIndex'), weights: tail.geometry.getAttribute('skinWeight') };
  });
  const geometries: THREE.BufferGeometry[] = [];
  const skeletons: THREE.Skeleton[] = [];
  const lods = asset.lods.map(original => {
    const src = original as THREE.SkinnedMesh;
    const geometry = src.geometry.clone();
    geometries.push(geometry);
    const bones = [...src.skeleton.bones, ...[...extra.keys()].map(name => {
      const bone = new THREE.Bone(); bone.name = name; return bone;
    })];
    const boneIndex = new Map(bones.map((bone, i) => [bone.name, i]));
    const positions = geometry.getAttribute('position');
    const oldIndices = geometry.getAttribute('skinIndex');
    const oldWeights = geometry.getAttribute('skinWeight');
    const indices = new THREE.Uint16BufferAttribute(new Uint16Array(positions.count * 4), 4);
    const weights = new THREE.Float32BufferAttribute(new Float32Array(positions.count * 4), 4);
    for (let i = 0; i < positions.count; i++) {
      const values = [oldIndices.getX(i), oldIndices.getY(i), oldIndices.getZ(i), oldIndices.getW(i)];
      const influence = [oldWeights.getX(i), oldWeights.getY(i), oldWeights.getZ(i), oldWeights.getW(i)];
      const tail = sources.find(source => values.some((k, slot) =>
        src.skeleton.bones[k]?.name === source.name && influence[slot] > 0.45));
      if (tail) {
        const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
        let nearest = 0, distance = Infinity;
        for (let j = 0; j < tail.points.length; j += 3) {
          const d = (px - tail.points[j]) ** 2 + (py - tail.points[j + 1]) ** 2 + (pz - tail.points[j + 2]) ** 2;
          if (d < distance) { distance = d; nearest = j / 3; }
        }
        const sourceI = [tail.indices.getX(nearest), tail.indices.getY(nearest), tail.indices.getZ(nearest), tail.indices.getW(nearest)];
        values.splice(0, 4, ...sourceI.map(k => boneIndex.get(tail.boneNames[k])!));
        influence.splice(0, 4, tail.weights.getX(nearest), tail.weights.getY(nearest), tail.weights.getZ(nearest), tail.weights.getW(nearest));
      }
      indices.setXYZW(i, ...values as [number, number, number, number]);
      weights.setXYZW(i, ...influence as [number, number, number, number]);
    }
    geometry.setAttribute('skinIndex', indices);
    geometry.setAttribute('skinWeight', weights);
    const template = new THREE.SkinnedMesh(geometry, src.material);
    template.name = src.name;
    template.skeleton = new THREE.Skeleton(bones);
    skeletons.push(template.skeleton);
    return template;
  });
  const body = attachPartsBody(root, { ...asset, lods }, 1, [], extra);
  const release = (): void => {
    for (const geometry of geometries) geometry.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
  };
  if (!body) { release(); return null; }
  hidePrototypeGlows();
  return { ...body, dispose: () => { body.dispose(); release(); } };
}

/** Use the same art binding and surface attachments in production and review. */
export function withHeroArt(rig: HeroRig, asset: LoadedAsset): HeroRig {
  const body = attachHeroArt(rig.root, asset, rig.artControls);
  if (!body) return rig;
  const mesh = body.lod.levels[0].object as THREE.SkinnedMesh;
  const positions = mesh.geometry.getAttribute('position');
  const indices = mesh.geometry.getAttribute('skinIndex');
  const weights = mesh.geometry.getAttribute('skinWeight');
  const paths = jointPaths(rig.root);
  const nodeNames = new Map([...paths].map(([name, node]) => [node, name]));
  let tailNumber = 0;
  rig.root.traverse(o => {
    const tail = o as THREE.SkinnedMesh;
    if (!tail.isSkinnedMesh || /^SK_Hero_/.test(tail.name)) return;
    const ti = tailNumber++;
    tail.skeleton.bones.forEach((bone, bi) => nodeNames.set(bone, `hero_tail_${ti}_${bi}`));
  });
  const boneNames = mesh.skeleton.bones.map(bone => nodeNames.get(bone) ?? '');
  const tailSamples = (rig.artControls?.tailFlames ?? []).map((_, ti) => {
    const ranked: [number, number][] = [];
    for (let i = 0; i < positions.count; i++) {
      let progress = 0, influence = 0;
      for (let slot = 0; slot < 4; slot++) {
        const bone = indices.getComponent(i, slot), w = weights.getComponent(i, slot);
        const match = new RegExp(`^hero_tail_${ti}_(\\d+)$`).exec(boneNames[bone] ?? '');
        if (match) { progress += Number(match[1]) * w; influence += w; }
      }
      if (influence > 0.8) ranked.push([i, progress / influence]);
    }
    ranked.sort((a, b) => b[1] - a[1]);
    return ranked.slice(0, Math.max(8, Math.floor(ranked.length * 0.025))).map(([i]) => i);
  });
  const grip = artGripSocket(rig, asset.id, body.lod);
  const socket = grip?.hand ?? rig.hand;
  const point = new THREE.Vector3(), center = new THREE.Vector3();
  const surfaceCenter = (vertices: readonly number[], node: THREE.Object3D, yOffset: number): void => {
    if (!vertices.length) return;
    center.set(0, 0, 0);
    for (const i of vertices) {
      point.fromBufferAttribute(positions, i);
      mesh.applyBoneTransform(i, point).applyMatrix4(mesh.matrixWorld);
      center.add(point);
    }
    center.multiplyScalar(1 / vertices.length); center.y += yOffset;
    node.parent!.worldToLocal(center);
    node.position.copy(center);
  };
  const align = (dt=0,t=0): void => {
    rig.root.updateWorldMatrix(true, true); mesh.skeleton.update();
    grip?.update(dt,t); mesh.skeleton.update();
    (rig.artControls?.tailFlames ?? []).forEach((flame, i) => surfaceCenter(tailSamples[i], flame, 0.025));
  };
  align();
  return {
    root: rig.root, height: rig.height, hand: socket, artControls: rig.artControls,
    materials: [...rig.materials, ...body.materials, ...(grip?.materials ?? [])],
    update: (dt, t) => { rig.update(dt, t); align(dt,t); },
    playIntro: () => { rig.playIntro(); grip?.playIntro(); },
    dispose: () => {
      grip?.dispose(); body.dispose(); body.materials.forEach(material => material.dispose()); rig.dispose();
    },
  };
}
