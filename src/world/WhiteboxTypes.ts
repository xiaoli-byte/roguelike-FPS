/** Authored floor-plan coordinates in metres. X points right, Y becomes world +Z. */
export type WhiteboxPoint = [number, number];

/**
 * Solid cover. Its height is honoured per piece (low 1.2 m vault cover, 2.6 m full cover, taller
 * pillars). V2 set dressing (a stall, a goods pile, a treasure hoard) is ordinary cover that names the
 * art to stand in its box and which plan direction that art's front faces (+y is south).
 */
export interface WhiteboxCover {
  polygon: WhiteboxPoint[];
  height: number;
  art?: 'stall' | 'goods' | 'hoard' | 'ruin' | 'brazier' | 'gate' | 'shrine';
  face?: 'north' | 'south' | 'east' | 'west';
}

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
  covers: WhiteboxCover[];
  /**
   * Raised walkable decks (V2 redesign). An axis-aligned top [x0, y0, x1, y1] at `height` metres with
   * one or more stepped stairs on its sides; enemies path onto it through the stair ramps.
   */
  platforms?: WhiteboxPlatform[];
  /**
   * Open holes inside the playable area: every non-floor cell inside a void circle. A plain void (frost-5's ice hole
   * where the boss rises) raises no tall wall: only an invisible, shot-through fence keeps players and enemies out, so
   * the hole stays open to sight and gunfire and its own art (water, ice, the boss) shows through. A `kind: 'lava'`
   * void (chapter 3's lava lakes and channels) has no fence at all: it is a damaging lava floor (WhiteboxLava).
   */
  voids?: WhiteboxVoid[];
  /**
   * Strips laid over the floor. `kind: 'lava'` strips (inferno-5's narrow radial channels) cut lava into walkable
   * floor and are lava at runtime, exactly like lava voids. `kind: 'flame'` lanes are planned only (no runtime yet):
   * the whitebox keeps them as ordinary floor; the floor-plan atlas draws them for review.
   */
  hazards?: WhiteboxHazard[];
  encounters: { id: string; at: WhiteboxPoint; room: string; label: string; roster: string; timing: string; facing: WhiteboxPoint;
    /** Enemy squad carried by the plan itself: [enemyId, count, elite?]. Falls back to WHITEBOX_SQUADS. */
    squad?: [string, number, boolean?][];
    /** Encounter ids that must be cleared before this one can trigger. */
    requires?: string[];
    /** One encounter reached through another authored room; shares its cleared state. */
    approaches?: { room: string; at: WhiteboxPoint; facing: WhiteboxPoint }[] }[];
  rewards: { at: WhiteboxPoint; room: string; label: string;
    reward?: 'coins' | 'scroll' | 'weapon' | 'heal' | 'upgrade';
    /** Empty means freely available; otherwise each authored encounter must be cleared. */
    requires?: string[] }[];
  sightlines: { from: WhiteboxPoint; to: WhiteboxPoint; label: string }[];
  notes: { at: WhiteboxPoint; text: string }[];
}

export interface WhiteboxPlatform {
  id: string;
  label?: string;
  rect: [number, number, number, number];
  height: number;
  /** side: which edge the stair descends from; offset: along that edge from its centre; width: tread width. */
  stairs: { side: 'north' | 'south' | 'east' | 'west'; offset?: number; width: number }[];
}

export interface WhiteboxVoid {
  id: string;
  label: string;
  center: WhiteboxPoint;
  radius: number;
  /** Absent: a fenced hole. 'lava': an unfenced lava floor that hurts and returns the player (WhiteboxLava). */
  kind?: 'lava';
}

export interface WhiteboxHazard {
  id: string;
  label: string;
  kind: 'lava' | 'flame';
  /** Centre line of the strip and its width in metres. */
  points: WhiteboxPoint[];
  width: number;
  note: string;
}

export interface WhiteboxRect { minX: number; minZ: number; maxX: number; maxZ: number }
export interface WhiteboxCheckpoint { id: string; label: string; x: number; z: number; yaw: number }

/**
 * Runtime lava floor (lava voids + lava hazard strips) rasterised on the whitebox grid, in world coordinates.
 * The floor stays at floorY and the player can walk, jump or be knocked onto it (LavaSystem hurts them and lifts
 * them back to safe ground); enemy navigation treats lava as blocked. There is no collision fence.
 */
export interface WhiteboxLava {
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** Cell size in metres (WHITEBOX_GRID_SIZE). */
  cell: number;
  /** 1 = lava, row-major (z * cols + x). */
  mask: Uint8Array;
  /** Lava cells merged into rectangles (surface mesh, nav rasterisation). */
  rects: WhiteboxRect[];
}

/** Technical blockout only. These shapes do not replace the Hunyuan art pipeline. */
export interface WhiteboxMetadata {
  planId: string;
  title: string;
  plan: WhiteboxPlan;
  floorRects: WhiteboxRect[];
  checkpoints: WhiteboxCheckpoint[];
  gridSize: number;
  /** Present only when the plan has lava (lava voids or lava hazard strips). */
  lava?: WhiteboxLava;
}
