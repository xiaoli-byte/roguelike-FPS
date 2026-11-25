import type { WhiteboxSpec } from './types';
import { WB_1_1 } from './maps/1-1';
import { WB_1_2 } from './maps/1-2';
import { WB_1_3 } from './maps/1-3';
import { WB_1_4 } from './maps/1-4';
import { WB_1_A } from './maps/1-A';

/**
 * 第一章白盒登记表（纯数据，不依赖 three）。检视页 desert-lab.html?map=1-1、探针 scripts/desert/whitebox-probe.mjs、
 * 测试 tests/desert-whitebox.test.mjs 都从这里取。
 */
export const WHITEBOXES: Record<string, WhiteboxSpec> = {
  [WB_1_1.id]: WB_1_1,
  [WB_1_2.id]: WB_1_2,
  [WB_1_3.id]: WB_1_3,
  [WB_1_4.id]: WB_1_4,
  [WB_1_A.id]: WB_1_A,
};

export { buildTerrain, sunVector, allSites, type WbTerrain, type ResolvedBlock } from './terrain';
export { probeWhitebox, formatReport, WhiteboxProbe, type ProbeReport, type RouteReport } from './probe';
export { WB_COLORS, WB_METRICS, type WhiteboxSpec, type WbSite, type V2, type V3 } from './types';
export { WB_ASSETS, type WbAsset } from './assets';
