/** Small authored formations. Weapon roles determine stations and arrival order. */
import type { EnemyPlacement, GameContext, StageNode, WaveEntry, WavePlan } from '../core/types';
import { bossIdForChapter } from './bosses';

const IDS: Record<string, string> = { g: 'grunt', a: 'archer', b: 'bomber', r: 'brute', w: 'wisp', s: 'shaman', m: 'mortar', p: 'marksman' };
const PLACEMENT: Record<string, EnemyPlacement> = { grunt: 'assault', brute: 'assault', bomber: 'flank', archer: 'ranged', wisp: 'ranged', marksman: 'precision', mortar: 'artillery', shaman: 'support' };
const ARRIVAL: Record<EnemyPlacement, number> = { assault: 0, ranged: .2, support: .6, flank: .85, precision: .9, artillery: 1.2 };

/** Legacy WaveEntry records receive the same tactical default as authored entries. */
export function placementForEnemy(id: string): EnemyPlacement { return PLACEMENT[id] ?? 'assault'; }

// Chapter/index are zero-based. g刀客 a弩手 b爆骸 r盾卫 w飞灯 s巫祝 m炮手 p狙击.
// All approaches and the guarded cache combined with these normal finales total 18–30.
const FINAL_SQUADS: readonly (readonly (readonly string[])[])[] = [
  [['g3 a1', 'g2 a1', 'g2 a1 b1'], ['g2 a2', 'g2 a1 b1', 'g2 a2 b1'],
    ['g2 a1 r1', 'g2 a2 b1', 'g1 r1 a2 b1'], ['g2 a2 r1', 'g2 a1 b2', 'g2 a1 r1 m1']],
  [['g2 a1 w1', 'g2 a1 s1', 'g2 w1 a1 s1'], ['g2 a1 w1', 'g2 p1 a1', 'g2 a1 s1 w1'],
    ['g2 a1 s1', 'g2 w1 p1', 'g2 a2 s1 b1'], ['g2 a1 s1 w1', 'g2 p1 a1 b1', 'g2 a1 s1 w1 p1']],
  [['g2 r1 a1 m1', 'g2 a1 w1 s1', 'g1 r1 a1 m1 w1'], ['g2 r1 a1 m1', 'g2 a1 p1 w1', 'g1 r1 s1 m1 a1'],
    ['g2 r1 a1 s1', 'g2 m1 p1 a1', 'g2 r1 a1 m1 w1'], ['g2 r1 a1', 'g1 m1 w1 a1', 'g1 s1 a1 r1', 'g1 m1 p1 r1']],
];
const APPROACH_SQUADS: readonly (readonly (readonly string[])[])[] = [
  [['g3 a1', 'g2 a1 b1'], ['g2 a2', 'g2 a1 b1'], ['g2 a1 r1', 'g2 a1 b1'], ['g2 a1 r1 m1', 'g2 a2 b1']],
  [['g2 a1 w1', 'g2 a1 w1'], ['g2 a1 p1 w1', 'g2 a1 w1 b1'], ['g2 a1 s1 w1', 'g2 a1 p1 b1'], ['g2 a1 s1 p1', 'g2 a1 w1 p1']],
  [['g2 r1 a1 m1', 'g2 a1 w1 b1'], ['g2 a1 m1 p1', 'g2 r1 a1 s1'], ['g1 r1 a1 m1 s1', 'g2 w1 a1 p1'], ['g2 r1 a1 m1', 'g1 r1 a1 p1 s1']],
];
const CACHE_SQUADS: readonly (readonly string[])[] = [
  ['g2 b1', 'g1 a1 b1', 'g1 a1 b1', 'g1 a1 b1'],
  ['g1 a1 w1', 'g1 p1 w1', 'g2 a1 s1', 'g1 a1 w1 s1'],
  ['g1 a1 b1 w1', 'g1 a1 m1 b1', 'g1 a1 p1 b1', 'g1 r1 s1 a1'],
];
const LABELS: readonly (readonly (readonly string[])[])[] = [
  [['门前试锋', '两翼弩阵', '爆骸来袭'], ['交错箭线', '侧径追击', '残垣合围'],
    ['盾卫拦路', '外廊夹击', '盾弩守殿'], ['重盾前锋', '沙径驱赶', '铜炮压轴']],
  [['飞灯巡守', '护佑初现', '雪寺护阵'], ['林间箭影', '红线锁定', '法杖掩护'],
    ['符阵拦截', '长廊狙线', '雪径回援'], ['寺外护佑', '红线追猎', '双阵守寺']],
  [['铸炉炮哨', '炉边护阵', '黑岩回援'], ['铜炮前哨', '裂谷狙击', '铸炉护卫'],
    ['符盾封路', '炮狙交替', '黑岩夹攻'], ['重盾试探', '熔炉炮火', '法杖守军', '深殿决阵']],
];

function indices(stage: StageNode): [number, number] {
  return [Math.max(0, Math.min(2, stage.chapter)), Math.max(0, Math.min(3, stage.index))];
}
function formation(squad: string, label: string, flank: boolean): WavePlan {
  const entries: WaveEntry[] = [];
  for (const token of squad.split(' ')) {
    const enemyId = IDS[token[0]], count = Number(token.slice(1)), placement = placementForEnemy(enemyId);
    const flanks = flank && enemyId === 'grunt' ? 1 : 0;
    if (count > flanks) entries.push({ enemyId, count: count - flanks, placement, arrivalDelay: ARRIVAL[placement] });
    if (flanks) entries.push({ enemyId, count: flanks, placement: 'flank', arrivalDelay: ARRIVAL.flank });
  }
  const hint = entries.some(e => e.enemyId === 'mortar') ? '炮弹能越过低墙，沿侧路接近炮手'
    : entries.some(e => e.enemyId === 'marksman') ? '激光变亮时冲刺或借石墙断开红线'
      : entries.some(e => e.enemyId === 'shaman') ? '先打断巫祝施法，避免护盾和脚下法阵'
        : entries.some(e => e.enemyId === 'brute') ? '诱导盾卫冲向石墙，再攻击背身'
          : entries.some(e => e.enemyId === 'bomber') ? '先处理爆骸虫，给冲刺留出空地'
            : entries.some(e => e.enemyId === 'wisp') ? '绕岩角躲开光球，再接近横移远程'
              : '刀客在前、弩手在后，利用两侧掩体换位';
  return { entries, label, hint, triggerRemaining: 1, delay: 1.6 };
}
/** Promote a real existing unit; elites replace normals rather than adding bodies. */
function promote(ctx: GameContext, wave: WavePlan, used: Set<string>): void {
  const priority = ['brute', 'shaman', 'marksman', 'mortar', 'archer', 'grunt', 'wisp'];
  const candidates = wave.entries.filter(e => !e.elite && e.count > 0 && priority.includes(e.enemyId));
  const fresh = candidates.filter(e => !used.has(e.enemyId)), choices = fresh.length ? fresh : candidates;
  if (!choices.length) return;
  const pick = ctx.rng.weighted(choices, e => 8 - priority.indexOf(e.enemyId));
  pick.count--;
  wave.entries.push({ ...pick, count: 1, elite: true });
  wave.entries = wave.entries.filter(e => e.count > 0);
  used.add(pick.enemyId);
}
export function buildWaves(ctx: GameContext, stage: StageNode): WavePlan[] {
  if (stage.type === 'boss') return [{ entries: [{ enemyId: bossIdForChapter(stage.chapter), count: 1 }], triggerRemaining: 0, delay: 1.5 }];
  if (stage.type !== 'combat' && stage.type !== 'elite') return [];
  const [ch, idx] = indices(stage), used = new Set<string>();
  let plans = FINAL_SQUADS[ch][idx].map((squad, w) => formation(squad, LABELS[ch][idx][w], w % 2 === 1));
  if (stage.type === 'elite') {
    plans = plans.slice(-2);
    for (const wave of plans) {
      let total = wave.entries.reduce((n, e) => n + e.count, 0);
      for (const e of wave.entries) while (total > 5 && e.enemyId === 'grunt' && e.count > 1) { e.count--; total--; }
      wave.triggerRemaining = 0; wave.delay = 2;
    }
    promote(ctx, plans[0], used); promote(ctx, plans[1], used);
    if (ch === 2) promote(ctx, plans[1], used);
  } else {
    const elites = ch === 0 ? (idx >= 2 ? 1 : 0) : ch === 1 ? (idx === 3 ? 2 : 1) : (idx === 3 ? 3 : idx === 0 ? 1 : 2);
    for (let i = 0; i < elites; i++) promote(ctx, plans[plans.length - 1 - (i % Math.min(2, plans.length))], used);
  }
  plans[0].triggerRemaining = 0;
  return plans;
}
/** Once-only route skirmishes. Ordinal changes the flank without creating another wave. */
export function buildEncounterWaves(_ctx: GameContext, stage: StageNode, kind: 'approach' | 'cache', ordinal: number): WavePlan[] {
  if (stage.type !== 'combat' && stage.type !== 'elite') return [];
  const [ch, idx] = indices(stage), side = Math.max(0, ordinal) % 2 === 1;
  const squad = kind === 'cache' ? CACHE_SQUADS[ch][idx] : APPROACH_SQUADS[ch][idx][side ? 1 : 0];
  const plan = formation(squad, kind === 'cache' ? '物资守军' : side ? '侧路伏阵' : '前哨拦截', kind === 'cache' || side);
  plan.triggerRemaining = 0;
  return [plan];
}
