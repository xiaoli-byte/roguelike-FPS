/**
 * 第四章雷魅的程序化白模（docs/art/enemy-roster-v2.md 第四章），只为在检视页里看尺寸、轮廓和分布：
 * 啸獭、天狗、獓狠（+ 雷牦）、举父、蛮蛮、连鼓灵、帝江、穷奇。紫红发光处就是设计里的弱点 / 电纹。
 * 每只怪一个 Group + 一个待机动作；兽群按 spec.ENCOUNTERS 摆在各据点，穷奇沿 spec.ROAMER 巡视。
 * 没有 AI 和战斗，正式怪物等概念图审过、走完美术管线再做。
 */
import * as THREE from 'three';
import { GeoBuilder, mat4 } from './geo';
import type { HeightGrid } from './grid';
import { ENCOUNTERS, ROAMER, type Encounter, type MonsterKind, type V2 } from './spec';

export interface Monster { kind: MonsterKind; root: THREE.Group; update(t: number, dt: number): void }

const GLOW = '#ffc6f4';
const BONE = '#ddd3bf';

function sphere(b: GeoBuilder, key: 'plain' | 'glow', color: THREE.ColorRepresentation, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0, seg = 12): void {
  b.add(key, new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7))), color, mat4(x, y, z, ry, rx, rz, sx, sy, sz));
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function group(name: string, build: (b: GeoBuilder) => void): THREE.Group {
  const b = new GeoBuilder();
  build(b);
  return b.build(name);
}

/** 啸獭：哨兵直立张望（尾巴尖是静电球），其余伏在地上啃草 */
function marmot(sentinel: boolean, seed: number): Monster {
  const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
  const fur = '#9b7a48', belly = '#e8d7b0', mask = '#4a3a2a';
  if (sentinel) {
    body.add(group('marmot', b => {
      sphere(b, 'plain', fur, 0, 0.38, 0, 0.27, 0.38, 0.23);
      sphere(b, 'plain', belly, 0, 0.34, 0.1, 0.2, 0.29, 0.14);
      for (const s of [1, -1]) {
        sphere(b, 'plain', fur, s * 0.15, 0.52, 0.12, 0.06, 0.11, 0.06, 0, 0.5);
        sphere(b, 'plain', mask, s * 0.1, 0.03, 0.08, 0.08, 0.04, 0.11);
      }
      b.cyl('plain', 0.05, 0.08, 0.26, fur, 0, 0.05, -0.18, 8, undefined, 0, -1.1);
      sphere(b, 'glow', GLOW, 0, 0.14, -0.4, 0.09, 0.09, 0.09);
      for (const [x, y] of [[0.12, 0.6], [-0.1, 0.66], [0.02, 0.72]]) b.box('glow', 0.03, 0.08, 0.03, GLOW, x, y, -0.18, 0, undefined, 0.4);
    }));
    head.position.set(0, 0.78, 0.02);
    head.add(group('marmot-head', b => {
      sphere(b, 'plain', fur, 0, 0, 0, 0.17, 0.15, 0.16);
      sphere(b, 'plain', mask, 0, -0.01, 0.1, 0.11, 0.08, 0.07);
      for (const s of [1, -1]) {
        sphere(b, 'plain', mask, s * 0.11, 0.11, -0.02, 0.045, 0.045, 0.03);
        sphere(b, 'glow', GLOW, s * 0.065, 0.04, 0.13, 0.022, 0.022, 0.022);
      }
      b.box('plain', 0.07, 0.05, 0.02, '#f4efe2', 0, -0.1, 0.15);
    }));
    body.add(head);
  } else {
    body.add(group('marmot-low', b => {
      sphere(b, 'plain', fur, 0, 0.2, 0, 0.24, 0.2, 0.34);
      sphere(b, 'plain', fur, 0, 0.27, 0.3, 0.14, 0.12, 0.13);
      sphere(b, 'plain', mask, 0, 0.25, 0.4, 0.09, 0.07, 0.05);
      b.cyl('plain', 0.05, 0.07, 0.2, fur, 0, 0.15, -0.3, 8, undefined, 0, -1.6);
      sphere(b, 'glow', GLOW, 0, 0.16, -0.5, 0.07, 0.07, 0.07);
    }));
  }
  root.add(body);
  return {
    kind: 'marmot', root,
    update: (t) => {
      if (sentinel) { head.rotation.y = Math.sin(t * 0.8 + seed) * 0.9; body.position.y = Math.abs(Math.sin(t * 1.3 + seed)) * 0.02; }
      else { body.position.y = Math.max(0, Math.sin(t * 3.2 + seed * 2)) * 0.06; body.rotation.x = Math.sin(t * 2 + seed) * 0.08; }
    },
  };
}

/** 天狗：狸形、白首、灰身红腿，额心雷纹；成群绕圈巡视 */
function tiangou(seed: number): Monster {
  const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
  const grey = '#4b5159', red = '#8f4a31', white = '#f1eee6';
  body.add(group('tiangou', b => {
    sphere(b, 'plain', grey, 0, 0.78, 0, 0.3, 0.3, 0.62);
    for (const [x, z] of [[0.17, 0.42], [-0.17, 0.42], [0.17, -0.42], [-0.17, -0.42]]) b.cyl('plain', 0.07, 0.06, 0.7, red, x, 0, z, 6);
    b.cyl('plain', 0.03, 0.16, 0.8, grey, 0, 0.8, -0.62, 8, undefined, 0, -2.2);
    for (let k = 0; k < 4; k++) b.box('glow', 0.05, 0.05, 0.16, GLOW, 0, 1.06, 0.3 - k * 0.22, 0, undefined, 0.3);
  }));
  head.position.set(0, 1.05, 0.62);
  head.add(group('tiangou-head', b => {
    sphere(b, 'plain', white, 0, 0, 0, 0.32, 0.3, 0.3);
    sphere(b, 'plain', white, 0, -0.08, 0.26, 0.16, 0.13, 0.14);
    b.cyl('plain', 0.24, 0.42, 0.34, white, 0, -0.36, -0.12, 10, undefined, 0, 0.3);
    for (const s of [1, -1]) {
      b.cyl('plain', 0, 0.09, 0.26, white, s * 0.17, 0.2, -0.02, 6, undefined, 0, 0, s * -0.35);
      sphere(b, 'glow', GLOW, s * 0.12, 0.05, 0.26, 0.04, 0.035, 0.03);
    }
    b.box('glow', 0.05, 0.16, 0.04, GLOW, 0, 0.1, 0.27, 0, undefined, 0.2, 0.5);
    b.box('glow', 0.05, 0.12, 0.04, GLOW, 0.03, 0.18, 0.27, 0, undefined, 0.2, -0.6);
  }));
  body.add(head);
  root.add(body);
  return {
    kind: 'tiangou', root,
    update: (t) => {
      body.position.y = Math.abs(Math.sin(t * 7 + seed)) * 0.05;
      // 偶尔仰头长吠
      const howl = Math.max(0, Math.sin(t * 0.4 + seed * 1.7) - 0.85) * 6;
      head.rotation.x = -howl * 0.6;
    },
  };
}

/** 獓狠：白身四角、长毛如蓑，角间雷球；雷牦是小号的黑牦（紫电纹） */
function aoyin(small: boolean, seed: number): Monster {
  const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
  const s = small ? 0.55 : 1;
  const hair = small ? '#2c2622' : '#ece5d4', hairDark = small ? '#1d1916' : '#d6ccb6';
  body.add(group(small ? 'leiyak' : 'aoyin', b => {
    sphere(b, 'plain', hair, 0, 2.2 * s, 0, 1.5 * s, 1.2 * s, 2.3 * s);
    sphere(b, 'plain', hair, 0, 3.0 * s, 0.7 * s, 1.15 * s, 0.9 * s, 1.1 * s);
    // 三层蓑衣长毛
    for (let k = 0; k < 3; k++) {
      const y = (1.9 - k * 0.6) * s;
      b.add('plain', new THREE.CylinderGeometry((1.45 + k * 0.12) * s, (1.62 + k * 0.12) * s, 0.9 * s, 14, 1, true),
        k % 2 ? hairDark : hair, mat4(0, y, -0.1 * s, 0, 0, 0, 1, 1, 1.5));
    }
    for (const [x, z] of [[0.7, 1.2], [-0.7, 1.2], [0.7, -1.3], [-0.7, -1.3]]) b.cyl('plain', 0.24 * s, 0.28 * s, 0.5 * s, '#1a1614', x * s, 0, z * s, 8);
    for (let k = 0; k < 6; k++) b.box('glow', 0.08 * s, 0.5 * s, 0.06 * s, GLOW, (k % 2 ? 1 : -1) * 1.5 * s, (1.4 + (k % 3) * 0.5) * s, (k - 2.5) * 0.6 * s, 0, undefined, 0.3, 0.4);
  }));
  head.position.set(0, 2.2 * s, 2.3 * s);
  head.add(group('aoyin-head', b => {
    sphere(b, 'plain', hair, 0, 0, 0, 0.6 * s, 0.6 * s, 0.7 * s);
    sphere(b, 'plain', '#3a302a', 0, -0.18 * s, 0.55 * s, 0.36 * s, 0.28 * s, 0.22 * s);
    b.add('plain', new THREE.TorusGeometry(0.16 * s, 0.035 * s, 6, 14), '#b07a3e', mat4(0, -0.32 * s, 0.72 * s, 0, 1.4));
    for (const sx of [1, -1]) {
      // 四角：两只往前挑，两只往后卷
      b.rod('plain', v(sx * 0.35 * s, 0.35 * s, 0), v(sx * 0.95 * s, 0.75 * s, 0.55 * s), 0.11 * s, BONE, 6);
      b.rod('plain', v(sx * 0.95 * s, 0.75 * s, 0.55 * s), v(sx * 0.85 * s, 1.15 * s, 1.0 * s), 0.07 * s, BONE, 6);
      b.rod('plain', v(sx * 0.3 * s, 0.4 * s, -0.25 * s), v(sx * 0.8 * s, 0.9 * s, -0.75 * s), 0.1 * s, BONE, 6);
      b.rod('plain', v(sx * 0.8 * s, 0.9 * s, -0.75 * s), v(sx * 0.65 * s, 0.6 * s, -1.15 * s), 0.07 * s, BONE, 6);
      sphere(b, 'glow', GLOW, sx * 0.3 * s, 0.1 * s, 0.55 * s, 0.07 * s, 0.06 * s, 0.05 * s);
    }
    if (!small) sphere(b, 'glow', GLOW, 0, 0.62, 0.05, 0.3, 0.3, 0.3);
  }));
  body.add(head);
  root.add(body);
  return {
    kind: small ? 'leiyak' : 'aoyin', root,
    update: (t) => {
      // 低头吃草，偶尔抬头
      const down = Math.sin(t * 0.25 + seed) > -0.3 ? 1 : 0.2;
      head.rotation.x = down * 0.45 + Math.sin(t * 2 + seed) * 0.03;
      body.position.y = Math.sin(t * 0.9 + seed) * 0.03;
    },
  };
}

/** 举父：花臂长臂猿，双手举着带电的雷石，隔一阵做一次投掷动作 */
function jufu(seed: number): Monster {
  const root = new THREE.Group(), body = new THREE.Group(), arms = new THREE.Group();
  const fur = '#a3783e', dark = '#3a2a1e', amber = '#d39a3a';
  body.add(group('jufu', b => {
    sphere(b, 'plain', fur, 0, 1.35, -0.05, 0.6, 0.72, 0.5, 0, -0.35);
    sphere(b, 'plain', '#c9a26a', 0, 1.3, 0.3, 0.38, 0.45, 0.2, 0, -0.3);
    sphere(b, 'plain', fur, 0, 2.05, 0.3, 0.3, 0.3, 0.3);
    sphere(b, 'plain', '#6b4e33', 0, 1.98, 0.55, 0.16, 0.13, 0.12);
    for (const s of [1, -1]) {
      b.cyl('plain', 0.17, 0.2, 0.75, fur, s * 0.32, 0.05, -0.15, 8);
      sphere(b, 'plain', dark, s * 0.32, 0.03, 0.0, 0.17, 0.08, 0.24);
      sphere(b, 'glow', GLOW, s * 0.11, 2.08, 0.55, 0.04, 0.04, 0.03);
    }
    b.box('glow', 0.24, 0.24, 0.04, GLOW, 0, 1.25, 0.47, 0, undefined, -0.25);
  }));
  // 花臂（虎斑）与雷石
  arms.position.set(0, 1.75, 0.1);
  arms.add(group('jufu-arms', b => {
    for (const s of [1, -1]) {
      for (let k = 0; k < 6; k++) b.cyl('plain', 0.15, 0.16, 0.24, k % 2 ? dark : amber, s * 0.55, 0.1 + k * 0.24, 0, 8);
      sphere(b, 'plain', '#5a4330', s * 0.55, 1.55, 0.05, 0.2, 0.17, 0.2);
    }
    b.rock('plain', 0.62, '#80786c', 0, 1.6, 0.08, 0.85, 7, 1);
    for (let k = 0; k < 5; k++) b.box('glow', 0.06, 0.55, 0.06, GLOW, Math.cos(k * 1.3) * 0.5, 1.75, Math.sin(k * 1.3) * 0.5, k, undefined, 0.6, 0.4);
  }));
  body.add(arms);
  root.add(body);
  return {
    kind: 'jufu', root,
    update: (t) => {
      // 举石 → 后仰 → 甩出（只是个姿态循环）
      const c = (t * 0.35 + seed) % 1;
      const wind = c < 0.6 ? c / 0.6 : 1 - (c - 0.6) / 0.4;
      arms.rotation.x = -0.25 - wind * 0.7;
      body.rotation.x = -wind * 0.15;
    },
  };
}

/** 蛮蛮：一对一翼一目的鸭形鸟，翼尖之间连着一道电弧，在领地上空盘旋 */
function manman(seed: number): Monster {
  const root = new THREE.Group(), pair = new THREE.Group();
  const bird = (side: number): THREE.Group => group('manman', b => {
    sphere(b, 'plain', '#4d6788', 0, 0, 0, 0.42, 0.36, 0.55);
    sphere(b, 'plain', '#b5663a', 0, -0.12, 0.12, 0.32, 0.22, 0.36);
    sphere(b, 'plain', '#4d6788', 0, 0.32, 0.42, 0.27, 0.26, 0.26);
    b.box('plain', 0.2, 0.08, 0.26, '#e8962e', 0, 0.22, 0.6);
    sphere(b, 'glow', GLOW, 0, 0.38, 0.64, 0.11, 0.11, 0.06);
    // 只有一只翅膀
    b.box('plain', 1.3, 0.08, 0.5, '#4d6788', side * 0.95, 0.05, -0.05, 0, undefined, 0, side * 0.15);
    b.box('plain', 0.5, 0.09, 0.34, '#e6dcc4', side * 1.45, 0.08, -0.08, 0, undefined, 0, side * 0.15);
    for (const s of [1, -1]) b.cyl('plain', 0.03, 0.03, 0.3, '#e8962e', s * 0.12, -0.6, -0.05, 5);
  });
  const left = bird(-1), right = bird(1);
  left.position.x = -2.6; right.position.x = 2.6;
  pair.add(left, right);
  // 两只之间的电弧（不透明的雕塑式电条）
  const arc = group('manman-arc', b => {
    const pts = [v(-1.9, 0.05, 0), v(-0.9, 0.35, 0), v(0, -0.15, 0), v(0.9, 0.3, 0), v(1.9, 0.05, 0)];
    for (let k = 0; k < pts.length - 1; k++) b.rod('glow', pts[k], pts[k + 1], 0.06, GLOW, 5);
  });
  pair.add(arc);
  root.add(pair);
  const R = 10 + (seed % 3) * 4;
  return {
    kind: 'manman', root,
    update: (t) => {
      const a = t * 0.35 + seed;
      pair.position.set(Math.cos(a) * R, Math.sin(t * 1.3 + seed) * 0.6, Math.sin(a) * R);
      pair.rotation.y = -a;
      pair.rotation.z = Math.sin(t * 0.9 + seed) * 0.15;
      left.rotation.z = Math.sin(t * 6 + seed) * 0.25;
      right.rotation.z = -Math.sin(t * 6 + seed) * 0.25;
      arc.scale.y = 1 + Math.sin(t * 20 + seed) * 0.4;
    },
  };
}

/** 连鼓灵：六面小鼓（一面红鼓）绕着骨笼里的雷心转，一根骨槌绕着敲 */
function liangu(seed: number): Monster {
  const root = new THREE.Group(), ring = new THREE.Group(), stick = new THREE.Group();
  ring.add(group('liangu', b => {
    b.add('plain', new THREE.TorusGeometry(1.25, 0.06, 6, 36), '#8c6a3c', mat4(0, 0, 0, 0, Math.PI / 2));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const color = k === 0 ? '#b8322b' : '#7a6a58';
      const x = Math.cos(a) * 1.25, z = Math.sin(a) * 1.25;
      b.add('plain', new THREE.CylinderGeometry(0.3, 0.3, 0.42, 14), color, mat4(x, 0, z, -a, 0, Math.PI / 2));
      for (const s of [1, -1]) {
        b.add('plain', new THREE.CylinderGeometry(0.27, 0.27, 0.02, 14), '#9db0b8', mat4(x + Math.cos(a) * s * 0.22, 0, z + Math.sin(a) * s * 0.22, -a, 0, Math.PI / 2));
        b.add('plain', new THREE.TorusGeometry(0.3, 0.025, 4, 14), '#b07a3e', mat4(x + Math.cos(a) * s * 0.2, 0, z + Math.sin(a) * s * 0.2, -a + Math.PI / 2, 0, 0));
      }
    }
  }));
  const core = group('liangu-core', b => {
    sphere(b, 'glow', GLOW, 0, 0, 0, 0.36, 0.36, 0.36);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.rod('plain', v(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5), v(Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5), 0.035, BONE, 4);
    }
  });
  stick.add(group('liangu-stick', b => {
    b.rod('plain', v(0.7, -0.6, 0), v(1.0, 0.7, 0), 0.06, BONE, 5);
    sphere(b, 'plain', BONE, 1.0, 0.75, 0, 0.12, 0.12, 0.12);
  }));
  root.add(ring, core, stick);
  return {
    kind: 'liangu', root,
    update: (t) => {
      ring.rotation.y = t * 0.6 + seed;
      ring.rotation.z = 0.35 + Math.sin(t * 0.7 + seed) * 0.08;
      stick.rotation.y = -t * 1.4;
      root.position.y = Math.sin(t * 1.1 + seed) * 0.15;
      core.scale.setScalar(1 + Math.max(0, Math.sin(t * 6)) * 0.15);
    },
  };
}

/** 帝江：无面的红皮囊，六短足四小翼，一路蹦跳跳舞 */
function dijiang(seed: number): Monster {
  const root = new THREE.Group(), body = new THREE.Group(), wings = new THREE.Group();
  body.add(group('dijiang', b => {
    sphere(b, 'plain', '#c8352b', 0, 0.62, 0, 0.55, 0.5, 0.5);
    sphere(b, 'plain', '#e2b13c', 0, 0.42, 0.12, 0.4, 0.3, 0.38);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.5;
      b.cyl('plain', 0.07, 0.09, 0.32, '#8a2a22', Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32, 6);
    }
    for (let k = 0; k < 4; k++) b.box('glow', 0.04, 0.24, 0.04, GLOW, (k - 1.5) * 0.18, 0.7, -0.45, 0, undefined, 0.2, k * 0.5);
  }));
  wings.position.set(0, 0.85, -0.3);
  wings.add(group('dijiang-wings', b => {
    for (const s of [1, -1]) for (const up of [0, 1]) {
      sphere(b, 'plain', '#d9483a', s * 0.42, up * 0.22, -0.05, 0.32, 0.08, 0.16, 0, 0, s * (0.5 + up * 0.4));
      sphere(b, 'glow', GLOW, s * 0.16, up * 0.15, -0.02, 0.07, 0.07, 0.07);
    }
  }));
  body.add(wings);
  root.add(body);
  return {
    kind: 'dijiang', root,
    update: (t) => {
      const hop = Math.abs(Math.sin(t * 3.4 + seed));
      body.position.y = hop * 0.55;
      body.rotation.y = t * 1.8 + seed;
      body.scale.set(1 + (1 - hop) * 0.08, 1 - (1 - hop) * 0.1, 1 + (1 - hop) * 0.08);
      wings.rotation.x = Math.sin(t * 12 + seed) * 0.3;
    },
  };
}

/** 穷奇：生翼的猛虎，背上一道猬毛雷冠；沿路线巡视 */
function qiongqi(): Monster {
  const root = new THREE.Group(), body = new THREE.Group(), wingL = new THREE.Group(), wingR = new THREE.Group();
  const orange = '#c8692a', black = '#231a14';
  body.add(group('qiongqi', b => {
    sphere(b, 'plain', orange, 0, 1.45, 0, 0.62, 0.6, 1.4);
    sphere(b, 'plain', '#f1e6d2', 0, 1.2, 0.2, 0.45, 0.35, 1.0);
    for (let k = 0; k < 7; k++) b.box('plain', 1.26, 0.12, 0.14, black, 0, 1.55 + Math.sin(k) * 0.05, -0.9 + k * 0.3, 0, undefined, 0, 0);
    for (const [x, z] of [[0.36, 0.85], [-0.36, 0.85], [0.36, -0.85], [-0.36, -0.85]]) {
      b.cyl('plain', 0.16, 0.13, 1.0, orange, x, 0.05, z, 8);
      sphere(b, 'plain', '#f1e6d2', x, 0.06, z + 0.08, 0.17, 0.08, 0.22);
    }
    // 头
    sphere(b, 'plain', orange, 0, 1.75, 1.55, 0.5, 0.46, 0.48);
    sphere(b, 'plain', '#f1e6d2', 0, 1.58, 1.92, 0.3, 0.2, 0.2);
    for (const s of [1, -1]) {
      b.cyl('plain', 0, 0.06, 0.16, '#fbf6ea', s * 0.12, 1.36, 2.02, 5, undefined, 0, Math.PI);
      sphere(b, 'glow', GLOW, s * 0.2, 1.85, 1.95, 0.07, 0.05, 0.04);
      b.cyl('plain', 0, 0.12, 0.18, orange, s * 0.3, 2.12, 1.45, 6);
    }
    // 尾
    b.rod('plain', v(0, 1.6, -1.35), v(0, 1.1, -2.3), 0.09, orange, 6);
    b.rod('plain', v(0, 1.1, -2.3), v(0, 1.3, -2.9), 0.07, black, 6);
    // 猬毛雷冠（弱点）
    for (let k = 0; k < 9; k++) b.cyl('glow', 0, 0.07, 0.4 + (k % 3) * 0.12, GLOW, 0, 1.95, 1.0 - k * 0.24, 5, undefined, 0, -0.5);
  }));
  const wing = (s: number): THREE.Group => group('qiongqi-wing', b => {
    for (let k = 0; k < 5; k++) b.box('plain', 0.9 + k * 0.08, 0.06, 0.32, k % 2 ? '#4a3626' : '#e2d3b4', s * (0.5 + k * 0.32), 0, -k * 0.18, 0, undefined, 0, s * 0.08);
    b.rod('glow', v(0, 0.05, 0.1), v(s * 2.0, 0.05, -0.4), 0.035, GLOW, 4);
  });
  wingL.add(wing(1)); wingR.add(wing(-1));
  wingL.position.set(0.45, 1.85, 0.55); wingR.position.set(-0.45, 1.85, 0.55);
  body.add(wingL, wingR);
  root.add(body);
  return {
    kind: 'qiongqi', root,
    update: (t) => {
      body.position.y = Math.abs(Math.sin(t * 5)) * 0.06;
      // 时不时展翼
      const spread = Math.max(0, Math.sin(t * 0.5) - 0.6) * 2.5;
      wingL.rotation.z = 0.9 - spread * 0.9 + Math.sin(t * 2) * 0.05;
      wingR.rotation.z = -0.9 + spread * 0.9 - Math.sin(t * 2) * 0.05;
    },
  };
}

function make(kind: MonsterKind, seed: number, sentinel = false): Monster {
  switch (kind) {
    case 'marmot': return marmot(sentinel, seed);
    case 'tiangou': return tiangou(seed);
    case 'aoyin': return aoyin(false, seed);
    case 'leiyak': return aoyin(true, seed);
    case 'jufu': return jufu(seed);
    case 'manman': return manman(seed);
    case 'liangu': return liangu(seed);
    case 'dijiang': return dijiang(seed);
    case 'qiongqi': return qiongqi();
  }
}

export interface MonsterField { group: THREE.Group; monsters: Monster[]; update(t: number, dt: number): void }

/** 游猎精英：沿闭合路线巡视 */
export interface Roamer { kind: MonsterKind; speed: number; path: V2[] }

/**
 * 按遇敌表摆怪：天狗绕群中心转圈巡视，其余原地待机；穷奇沿巡视路线走。
 * ground：怪站的地面高度（默认地形；4-2 传「地形或桥面 / 栈道」）。
 */
export function buildMonsters(
  terrain: Pick<HeightGrid, 'heightAt'>, encounters: readonly Encounter[] = ENCOUNTERS, roamer: Roamer | null = ROAMER,
): MonsterField {
  const group = new THREE.Group();
  group.name = 'monsters';
  const monsters: Monster[] = [];
  const movers: ((t: number, dt: number) => void)[] = [];
  let seed = 1;
  // 啸獭洞口：小土堆 + 黑洞
  const mounds = new GeoBuilder();
  for (const e of encounters) for (const [x, z] of e.burrows ?? []) {
    const y = terrain.heightAt(x, z);
    mounds.lathe('plain', [[0, 0], [0.9, 0], [0.55, 0.28], [0.3, 0.32], [0, 0.3]], '#7d6448', x, y - 0.05, z, 10);
    mounds.add('plain', new THREE.CircleGeometry(0.22, 10), '#1a1410', mat4(x, y + 0.31, z, 0, -Math.PI / 2));
  }
  if (!mounds.isEmpty()) group.add(mounds.build('burrows'));
  for (const e of encounters) {
    const tiangou = e.units.filter(u => u.kind === 'tiangou');
    const cx = tiangou.reduce((s, u) => s + u.at[0], 0) / Math.max(1, tiangou.length);
    const cz = tiangou.reduce((s, u) => s + u.at[2], 0) / Math.max(1, tiangou.length);
    e.units.forEach((u, idx) => {
      const m = make(u.kind, seed++, u.sentinel);
      const [x, h, z] = u.at;
      const base = terrain.heightAt(x, z);
      m.root.position.set(x, base + h, z);
      m.root.rotation.y = Math.atan2(e.x - x, e.z - z) + Math.PI + (seed % 5) * 0.4;
      group.add(m.root);
      monsters.push(m);
      if (u.kind === 'tiangou') {
        // 绕着同伴中心转圈（开阔地包抄的巡视样子）
        const r0 = Math.hypot(x - cx, z - cz) + 5, a0 = Math.atan2(z - cz, x - cx), dir = idx % 2 ? 1 : -1;
        movers.push((t) => {
          const a = a0 + dir * t * (6 / r0);
          const px = cx + Math.cos(a) * r0, pz = cz + Math.sin(a) * r0;
          m.root.position.set(px, terrain.heightAt(px, pz), pz);
          m.root.rotation.y = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
        });
      }
    });
  }
  // 穷奇沿闭合路线巡视
  if (roamer) {
    const roam = make(roamer.kind, 99);
    const path = roamer.path.map(([x, z]) => new THREE.Vector2(x, z));
    const lens = path.map((p, i) => p.distanceTo(path[(i + 1) % path.length]));
    const total = lens.reduce((a, b) => a + b, 0);
    group.add(roam.root);
    monsters.push(roam);
    movers.push((t) => {
      let d = (t * roamer.speed) % total, i = 0;
      while (d > lens[i]) { d -= lens[i]; i++; }
      const a = path[i], b = path[(i + 1) % path.length];
      const k = d / lens[i];
      const x = a.x + (b.x - a.x) * k, z = a.y + (b.y - a.y) * k;
      roam.root.position.set(x, terrain.heightAt(x, z), z);
      roam.root.rotation.y = Math.atan2(b.x - a.x, b.y - a.y);
    });
  }
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group, monsters,
    update: (t, dt) => {
      if (!group.visible) return;
      for (const m of movers) m(t, dt);
      for (const m of monsters) m.update(t, dt);
    },
  };
}
