/**
 * 三条河的水面：沿中线的条带，比河槽宽一圈（两岸地形会盖住多出来的部分，涨水时水面自然漫上岸）。
 * 大渡河是浑绿的急流，河滩段水浅发亮；涨水时整组水面一起抬高。
 */
import * as THREE from 'three';
import { waterMaterial } from '../plateau/fx';
import { PATHS, fordWeight, halfAt, waterAt } from './terrain';
import { MAP } from './spec';

export class GorgeWater {
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'water';
    const B = MAP.bounds, pad = 260;
    for (const P of PATHS) {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let n = 0;
      for (let i = 0; i < P.x.length; i++) {
        const x = P.x[i], z = P.z[i];
        if (x < B.minX - pad || x > B.maxX + pad || z < B.minZ - pad || z > B.maxZ + pad) continue;
        const s = P.s[i], half = halfAt(P, s) + 7 + fordWeight(s) * 6;
        const nx = -P.tz[i], nz = P.tx[i], y = waterAt(P, s);
        pos.push(x + nx * half, y, z + nz * half, x - nx * half, y, z - nz * half);
        uv.push(0, s / 7, 1, s / 7);
        if (n > 0) { const a = (n - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        n++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const main = P.id === 'dd';
      const mesh = new THREE.Mesh(g, waterMaterial(main ? '#557a70' : '#5d857c', main ? '#9fb8a4' : '#a7c2b2', main ? 1.5 : 1.9, false));
      mesh.renderOrder = 2;
      mesh.name = `river-${P.id}`;
      this.group.add(mesh);
    }
  }

  /** 涨水：整组水面抬高 */
  set flood(v: number) { this.group.position.y = v; }
}
