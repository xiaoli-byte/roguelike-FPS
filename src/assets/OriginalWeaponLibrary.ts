import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface OriginalMotionData {
  FixedPoint: boolean;
  MotionPositionRecoil: { x: number; y: number; z: number };
  MotionRotationRecoil: { x: number; y: number; z: number };
  MotionPositionMaxState: { x: number; y: number; z: number };
  MotionPositionReset: number;
  MotionRotationReset: number;
  MotionRotationRecoilDeadZone: number;
  MotionRecoilInterval: number;
  PositionSpring2Stiffness: number;
  PositionSpring2Damping: number;
  RotationSpring2Stiffness: number;
  RotationSpring2Damping: number;
}

export interface OriginalWeaponEntry {
  url: string;
  weapon: string;
  target: string | null;
  motion: string;
  animations: Record<string, string>;
}

export interface LoadedOriginalWeapon {
  entry: OriginalWeaponEntry;
  gltf: GLTF;
  motion: OriginalMotionData;
}

export const ORIGINAL_WEAPON_IDS: Readonly<Record<string, string>> = {
  rifle: '1001', smg: '1002', railgun: '1008', sniper: '1106', revolver: '1202', shotgun: '1301',
};
export const NATIVE_VIEWMODEL_WEAPONS = new Set(['smg', 'revolver', 'railgun']);

const BASE = import.meta.env.BASE_URL;

class Library {
  private manifest: Promise<Record<string, OriginalWeaponEntry>> | null = null;
  private assets = new Map<string, Promise<LoadedOriginalWeapon | null>>();
  private loadedAssets = new Map<string, LoadedOriginalWeapon | null>();
  private loader = new GLTFLoader();

  private entries(): Promise<Record<string, OriginalWeaponEntry>> {
    this.manifest ??= fetch(`${BASE}assets/gunfire-original/manifest.json`, { cache: 'no-cache' })
      .then((response) => response.ok ? response.json() : { assets: {} })
      .then((document) => document.assets as Record<string, OriginalWeaponEntry>)
      .catch(() => ({}));
    return this.manifest;
  }

  get(defId: string): Promise<LoadedOriginalWeapon | null> | null {
    const weapon = ORIGINAL_WEAPON_IDS[defId];
    if (!weapon) return null;
    let pending = this.assets.get(defId);
    if (!pending) {
      pending = this.load(defId, weapon);
      this.assets.set(defId, pending);
    }
    return pending;
  }

  loaded(defId: string): LoadedOriginalWeapon | null {
    return this.loadedAssets.get(defId) ?? null;
  }

  preload(): Promise<void> {
    if (typeof location === 'undefined') return Promise.resolve();
    return Promise.all(Object.keys(ORIGINAL_WEAPON_IDS).map((id) => this.get(id))).then(() => undefined);
  }

  private async load(defId: string, weapon: string): Promise<LoadedOriginalWeapon | null> {
    try {
      const entries = await this.entries();
      const synced = entries[weapon];
      if (!synced && NATIVE_VIEWMODEL_WEAPONS.has(defId)) return this.fail(defId);
      const entry: OriginalWeaponEntry = synced ?? {
        url: '', weapon, target: defId, motion: `assets/gunfire-original/motion/${weapon}.json`, animations: {},
      };
      const motionResponse = await fetch(`${BASE}${entry.motion}`, { cache: 'no-cache' });
      if (!motionResponse.ok) return this.fail(defId);
      const document = await motionResponse.json() as { motion?: OriginalMotionData };
      if (!document.motion) return this.fail(defId);
      let gltf: GLTF | null = null;
      if (NATIVE_VIEWMODEL_WEAPONS.has(defId)) gltf = await this.loader.loadAsync(`${BASE}${entry.url}`);
      const loaded = { entry, gltf: gltf!, motion: document.motion };
      this.loadedAssets.set(defId, loaded);
      return loaded;
    } catch (error) {
      console.warn(`[assets] Unity 原生武器 ${weapon} 同步资源加载失败，使用网页现有模型`, error);
      return this.fail(defId);
    }
  }

  private fail(defId: string): null {
    this.loadedAssets.set(defId, null);
    return null;
  }
}

export const OriginalWeaponLibrary = new Library();
void OriginalWeaponLibrary.preload();
