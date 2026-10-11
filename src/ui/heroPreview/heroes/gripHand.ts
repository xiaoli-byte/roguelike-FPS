/** Right-hand pose authored in weapon space, with distinct digits and wrist. */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

export const GRIP_WRIST = new THREE.Vector3(-0.064, -0.061, 0.112);
export function buildGripHand(fox: boolean): { root: THREE.Group; materials: THREE.Material[]; dispose: () => void } {
  const root = new THREE.Group(); root.name = 'hero-grip-hand'; root.userData.heroGripHand = true;
  const glove = new THREE.MeshStandardMaterial({ color: fox ? 0x392923 : 0x4a3426, roughness: .86 });
  const seam = new THREE.MeshStandardMaterial({ color: fox ? 0x6e3f27 : 0x73614b, roughness: .9 });
  const geometries: THREE.BufferGeometry[] = [];
  const grip = new THREE.Group(); root.add(grip);
  grip.position.set(0, fox ? -.055 : -.058, fox ? .035 : .032);
  grip.rotation.x = fox ? -.3 : -.32;
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material = glove): THREE.Mesh => {
    geometries.push(geo); const mesh = new THREE.Mesh(geo, mat); mesh.userData.heroGripHand = true;
    mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const hull = (points: number[][]): THREE.BufferGeometry => new ConvexGeometry(points.map(p => new THREE.Vector3(...p as [number,number,number])));
  add(grip, hull([
    [-.055,-.048,.035],[-.027,-.048,.042],[-.029,-.048,-.005],[-.052,-.048,-.008],
    [-.052,.037,.036],[-.027,.037,.041],[-.027,.031,-.01],[-.047,.031,-.018],
    [-.043,.05,.045],[-.026,.046,.046],[-.038,-.058,.024],[-.026,-.053,.026],
  ]));
  const tube = (parent: THREE.Object3D, points: number[][], radius: number, mat: THREE.Material = glove): void => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p as [number,number,number])), false, 'centripetal');
    add(parent, new THREE.TubeGeometry(curve, points.length * 2, radius, 7, false), mat);
    for (const p of [points[0],points[points.length-1]]) {
      const cap=add(parent,new THREE.SphereGeometry(radius,7,5),mat); cap.position.set(...p as [number,number,number]);
    }
  };
  // Three separate fingers surround the front and far side of the handle.
  for (const [i,y] of [.012,-.011,-.034].entries()) {
    const digit = new THREE.Bone(); digit.name = ['grip-middle','grip-ring','grip-pinky'][i]; grip.add(digit);
    const r=i===2?.008:.0095;
    const spread=fox?0:.005;
    tube(digit,[[-.038,y,.027],[-.034,y,-.018],[-.019,y,-.038],[.012,y,-.039],[.031+spread,y,-.024],[.032+spread,y,.005],[.024+spread,y,.016]],r);
    tube(digit,[[-.034,y+.004,-.017],[-.02,y+.004,-.032],[.006,y+.004,-.033]],.0013,seam);
  }
  const index = new THREE.Bone(); index.name='grip-index'; grip.add(index);
  tube(index,[[-.036,.039,.018],[-.029,.047,-.019],[-.027,.052,-.049],[-.025,.055,-.076]],.009);
  const thumb = new THREE.Bone(); thumb.name='grip-thumb'; grip.add(thumb);
  tube(thumb,[[-.027,.047,.04],[-.005,.058,.045],[.029,.052,.039],[.038,.035,.029],[.038,.024,.008]],.01);
  grip.updateMatrixWorld(true);
  const wrist=grip.worldToLocal(GRIP_WRIST.clone());
  add(grip,hull([
    [wrist.x-.026,wrist.y-.023,wrist.z],[wrist.x+.024,wrist.y-.022,wrist.z],
    [wrist.x-.026,wrist.y+.022,wrist.z],[wrist.x+.024,wrist.y+.022,wrist.z],
    [-.049,-.04,.025],[-.027,-.041,.039],[-.048,.035,.038],[-.027,.034,.043],
  ]));
  const wristCap=add(root,new THREE.SphereGeometry(.033,10,7));wristCap.position.copy(GRIP_WRIST);
  return { root, materials:[glove,seam], dispose:()=>{geometries.forEach(g=>g.dispose());glove.dispose();seam.dispose();} };
}
