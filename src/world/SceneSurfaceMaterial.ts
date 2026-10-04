import * as THREE from 'three';

// Published environment art uses a consistent soft painted finish.
// Apply to scene-owned clones: library materials and their shared maps stay intact.
const PAINTED_ENVIRONMENT_IDS = new Set([
  'SM_Env_DesertSandstone', 'SM_Env_FrostPine', 'SM_Env_InfernoBasalt',
  'SM_Env_DesertRuin', 'SM_Env_FrostWayshrine', 'SM_Env_InfernoFoundry',
  'SM_Env_DesertWall', 'SM_Env_FrostWall', 'SM_Env_InfernoWall',
  'SM_Env_DesertGate', 'SM_Env_FrostGate', 'SM_Env_InfernoGate',
  'SM_Env_DesertCliff', 'SM_Env_FrostCliff', 'SM_Env_InfernoCliff',
]);

export function applyHandPaintedEnvironment(material: THREE.MeshStandardMaterial, assetId: string): void {
  if (!PAINTED_ENVIRONMENT_IDS.has(assetId)) return;
  // A scalar roughness floor alone cannot tame the roughness map's multiplier.
  // Detach it from this clone without disposing the library's packed ORM map.
  material.roughnessMap = null;
  material.roughness = .9;
  material.metalness = 0;
  material.normalScale.setScalar(.22);
}
