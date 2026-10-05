/** Authored floor-plan coordinates in metres. X points right, Y becomes world +Z. */
export type WhiteboxPoint = [number, number];

export interface WhiteboxPlan {
  id: string;
  revision?: string;
  chapter: 'desert' | 'frost' | 'inferno';
  /** One-based chapter slot, matching the reviewed floor-plan atlas. */
  index: number;
  title: string;
  subtitle: string;
  identity: string;
  objective: string;
  pacing: string[];
  routeChoice: string;
  encounterLogic: string;
  artBrief: string;
  whiteboxChecks: string[];
  bounds: WhiteboxPoint;
  rooms: { id: string; label: string; polygon: WhiteboxPoint[]; labelAt: WhiteboxPoint }[];
  passages: { id: string; from: string; to: string; points: WhiteboxPoint[]; width: number; kind: 'main' | 'optional' | 'return'; note: string }[];
  entry: { room: string; at: WhiteboxPoint };
  /** Boss arrival is a separate safe room; facing is a target point, not a direction vector. */
  preparation?: { room: string; at: WhiteboxPoint; facing: WhiteboxPoint; label: string };
  exit: { room: string; at: WhiteboxPoint };
  mainRoute: string[];
  covers: { polygon: WhiteboxPoint[]; height: number }[];
  encounters: { id: string; at: WhiteboxPoint; room: string; label: string; roster: string; timing: string; facing: WhiteboxPoint;
    /** One encounter reached through another authored room; shares its cleared state. */
    approaches?: { room: string; at: WhiteboxPoint; facing: WhiteboxPoint }[] }[];
  rewards: { at: WhiteboxPoint; room: string; label: string;
    reward?: 'coins' | 'scroll' | 'weapon' | 'heal' | 'upgrade';
    /** Empty means freely available; otherwise each authored encounter must be cleared. */
    requires?: string[] }[];
  sightlines: { from: WhiteboxPoint; to: WhiteboxPoint; label: string }[];
  notes: { at: WhiteboxPoint; text: string }[];
}

export interface WhiteboxRect { minX: number; minZ: number; maxX: number; maxZ: number }
export interface WhiteboxCheckpoint { id: string; label: string; x: number; z: number; yaw: number }

/** Technical blockout only. These shapes do not replace the Hunyuan art pipeline. */
export interface WhiteboxMetadata {
  planId: string;
  title: string;
  plan: WhiteboxPlan;
  floorRects: WhiteboxRect[];
  checkpoints: WhiteboxCheckpoint[];
  gridSize: number;
}
