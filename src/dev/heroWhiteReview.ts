/** Neutral clay review: suppress authored paint and procedural glow cards. */
import * as THREE from 'three';

export function heroWhiteReview(scene: THREE.Scene, root: THREE.Object3D): () => void {
  scene.overrideMaterial = new THREE.MeshStandardMaterial({ color: 0xd7d9de, roughness: 0.9 });
  scene.traverse(o => {
    if (o instanceof THREE.HemisphereLight) { o.color.setHex(0xffffff); o.groundColor.setHex(0x555555); }
    else if (o instanceof THREE.Light) o.color.setHex(0xffffff);
  });
  // Animation can create or re-enable flames, so inspect immediately before
  // each render instead of capturing only the effects present at construction.
  return () => root.traverse(o => {
    if (o instanceof THREE.Sprite || o instanceof THREE.Points) { o.visible = false; return; }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some(m => m.type === 'MeshBasicMaterial' || m.transparent || m.blending === THREE.AdditiveBlending)) o.visible = false;
  });
}
