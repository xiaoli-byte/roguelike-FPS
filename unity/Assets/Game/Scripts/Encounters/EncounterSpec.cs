using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 出生站位角色（同 Three.js EnemyPlacement，多一个 Auto）：
    ///   刷怪锚点 <see cref="SpawnAnchor.role"/> 上 Auto = 谁都可以站；编制条目 <see cref="WaveEntry.role"/> 上 Auto = 取 <see cref="EnemyDef.placementRole"/>。
    /// </summary>
    public enum StationRole { Auto, Assault, Flank, Ranged, Precision, Artillery, Support }

    /// <summary>
    /// 一个编制条目（TS WaveEntry）：哪种敌人、几只、精英 / 词缀、站位角色、到场延迟、走哪条 lane。
    /// 代码里用 <see cref="EncounterSpec.E"/> 写，链式补 <see cref="Elite"/> / <see cref="As"/> / <see cref="At"/>。
    /// </summary>
    [Serializable]
    public sealed class WaveEntry
    {
        public string enemy;
        public int count = 1;
        public bool elite;
        [Tooltip("精英词缀 id（空 = 用场地的小队词缀，再没有就由词缀登记随机；只对精英生效）")]
        public string affix = "";
        [Tooltip("站位角色（Auto = EnemyDef.placementRole）")]
        public StationRole role;
        [Tooltip("波次开始后几秒到场（< 0 = 按角色的默认延迟：正面 0、远程 0.2、辅助 0.6、侧翼 0.85、精确 0.9、炮击 1.2）")]
        public float arrivalDelay = -1f;
        [Tooltip("指定 lane（< 0 = 按波次轮换：正面 / 远程 / 辅助走本波的主 lane，侧翼走相邻 lane）")]
        public int lane = -1;
        [Tooltip("近战成群（≥ 3 只、非精英）时留最后一只晚 2.5 s 从侧翼进场")]
        public bool holdBack = true;

        public WaveEntry Clone() => (WaveEntry)MemberwiseClone();

        /// <summary>升为精英（链式）</summary>
        public WaveEntry Elite(string affixId = "")
        {
            elite = true;
            affix = affixId ?? "";
            return this;
        }

        /// <summary>改站位角色 / lane（链式）</summary>
        public WaveEntry As(StationRole r, int laneIndex = -1)
        {
            role = r;
            lane = laneIndex;
            return this;
        }

        /// <summary>到场延迟（链式，秒）</summary>
        public WaveEntry At(float seconds)
        {
            arrivalDelay = seconds;
            return this;
        }

        /// <summary>不拆侧翼（链式）</summary>
        public WaveEntry NoHoldBack()
        {
            holdBack = false;
            return this;
        }

        public override string ToString() => $"{enemy}×{count}{(elite ? "（精英）" : "")}";
    }

    /// <summary>
    /// 一波（TS WavePlan）：编制 + 波次标题 / 提示；上一波剩下 ≤ <see cref="triggerRemaining"/> 只（且已全部出场）时，
    /// 再等 <see cref="delay"/> 秒开这一波（第一波用场地的 <see cref="EncounterSpec.gather"/>）。
    /// </summary>
    [Serializable]
    public sealed class WaveSpec
    {
        [Tooltip("波次名（多波时横幅显示「第 2 / 3 波 · 名字」）")]
        public string label = "";
        [Tooltip("横幅副标题：这一波的打法提示")]
        public string hint = "";
        public WaveEntry[] entries = Array.Empty<WaveEntry>();
        [Tooltip("上一波剩下 ≤ N 只时开这一波（第一波忽略）")]
        public int triggerRemaining = 1;
        [Tooltip("条件满足后再等几秒")]
        public float delay = 1.6f;

        public int Count
        {
            get
            {
                int n = 0;
                if (entries != null)
                    foreach (var e in entries)
                        if (e != null && !string.IsNullOrEmpty(e.enemy)) n += Mathf.Max(0, e.count);
                return n;
            }
        }

        public WaveSpec Clone()
        {
            var w = (WaveSpec)MemberwiseClone();
            w.entries = entries == null ? Array.Empty<WaveEntry>() : Array.ConvertAll(entries, e => e?.Clone());
            return w;
        }

        /// <summary>改开波条件（链式）</summary>
        public WaveSpec After(int remaining, float seconds = 1.6f)
        {
            triggerRemaining = remaining;
            delay = seconds;
            return this;
        }

        /// <summary>改横幅提示（链式）</summary>
        public WaveSpec Hint(string text)
        {
            hint = text ?? "";
            return this;
        }
    }

    /// <summary>
    /// 一个场地的遭遇编排（代码写在各关的 Level_&lt;c&gt;_&lt;n&gt;.cs 里，序列化进场景的 <see cref="EncounterSite"/>）：
    ///   多波次（<see cref="WaveSpec"/>）、首波集结时间、精英升格只数（从现有单位里升，不加怪，TS Waves.promote）、
    ///   小队词缀（本场地精英共用的词缀 id）、同时在场上限、出生点离玩家的距离带。
    /// 运行时 <see cref="EncounterSite"/> 先 <see cref="Clone"/> 一份再升格，模板本身不改（同一份编排可以给多个场地 / 多次开战用）。
    /// </summary>
    [Serializable]
    public sealed class EncounterSpec
    {
        public WaveSpec[] waves = Array.Empty<WaveSpec>();
        [Tooltip("开战到第一波的集结时间（秒）：沿路遭遇 0.4，祭坛类 2")]
        public float gather = 0.4f;
        [Tooltip("精英升格：开战时从现有单位里挑几只升为精英（重型优先、不同种类优先，先升最后两波），总数不变")]
        public int promote;
        [Tooltip("小队词缀：本场地的精英共用这个词缀 id（空 = 每只由词缀登记随机）")]
        public string squadAffix = "";
        [Tooltip("全场同时在场的敌人上限（含本场地正在预警的）")]
        public int maxAlive = 10;
        [Tooltip("出生点离玩家的水平距离（米）：太近不刷、太远不刷（卡住 2 s 后放宽到 6–48 m）")]
        public float minPlayerDistance = 10f, maxPlayerDistance = 36f;
        [Tooltip("同一条目里相邻两只的出场间隔（秒）")]
        public float stagger = 0.18f;

        public bool IsEmpty => waves == null || waves.Length == 0 || Total == 0;

        /// <summary>全部波次的敌人总数</summary>
        public int Total
        {
            get
            {
                int n = 0;
                if (waves != null)
                    foreach (var w in waves)
                        if (w != null) n += w.Count;
                return n;
            }
        }

        public EncounterSpec Clone()
        {
            var s = (EncounterSpec)MemberwiseClone();
            s.waves = waves == null ? Array.Empty<WaveSpec>() : Array.ConvertAll(waves, w => w?.Clone());
            return s;
        }

        // ───────────── 代码编写用的小工具 ─────────────

        /// <summary>一个场地：若干波</summary>
        public static EncounterSpec Of(params WaveSpec[] waves) => new() { waves = waves ?? Array.Empty<WaveSpec>() };

        /// <summary>一波：标题 + 编制</summary>
        public static WaveSpec Wave(string label, params WaveEntry[] entries) => new() { label = label ?? "", entries = entries ?? Array.Empty<WaveEntry>() };

        /// <summary>一个条目：敌人 id、只数、到场延迟（&lt; 0 = 按角色默认）</summary>
        public static WaveEntry E(string enemy, int count = 1, float arrivalDelay = -1f) =>
            new() { enemy = enemy, count = count, arrivalDelay = arrivalDelay };

        /// <summary>改首波集结时间（链式）</summary>
        public EncounterSpec Gather(float seconds)
        {
            gather = Mathf.Max(0, seconds);
            return this;
        }

        /// <summary>出生点离玩家的距离带（链式，米）</summary>
        public EncounterSpec Distance(float min, float max)
        {
            minPlayerDistance = Mathf.Max(0, min);
            maxPlayerDistance = Mathf.Max(minPlayerDistance, max);
            return this;
        }

        /// <summary>精英升格只数 + 小队词缀（链式）</summary>
        public EncounterSpec Elites(int count, string affix = "")
        {
            promote = Mathf.Max(0, count);
            squadAffix = affix ?? "";
            return this;
        }

        // ───────────── 旧编制（EncounterSite.Squad）互转 ─────────────

        /// <summary>
        /// 旧式单波编制 → 编排：一波，条目的 delay 原样当到场延迟，首波不集结，出生点离玩家 10–28 m（与旧 EncounterSite 的出场时间、距离带一致）
        /// </summary>
        public static EncounterSpec FromSquads(IReadOnlyList<EncounterSite.Squad> squads, string label = "")
        {
            var entries = new List<WaveEntry>();
            if (squads != null)
                foreach (var q in squads)
                {
                    if (q == null || string.IsNullOrEmpty(q.enemy)) continue;
                    entries.Add(new WaveEntry { enemy = q.enemy, count = q.count, elite = q.elite, arrivalDelay = Mathf.Max(0, q.delay) });
                }
            return new EncounterSpec
            {
                gather = 0, minPlayerDistance = 10f, maxPlayerDistance = 28f,
                waves = new[] { new WaveSpec { label = label ?? "", entries = entries.ToArray(), triggerRemaining = 0, delay = 0 } },
            };
        }

        /// <summary>
        /// 编排 → 旧式编制（给只认 Squad[] 的读者：LootDirector 的宝箱档位、L5 验收的出生净空）。
        /// 要升格精英时，每种普通单位再补一条 count = 0 的精英记录：体型检查按精英 ×1.25 算，宝箱档位按「有精英」算。
        /// </summary>
        public EncounterSite.Squad[] ToSquads()
        {
            var list = new List<EncounterSite.Squad>();
            var normals = new List<string>();
            if (waves != null)
                foreach (var w in waves)
                {
                    if (w?.entries == null) continue;
                    foreach (var e in w.entries)
                    {
                        if (e == null || string.IsNullOrEmpty(e.enemy)) continue;
                        list.Add(new EncounterSite.Squad { enemy = e.enemy, count = e.count, delay = Mathf.Max(0, e.arrivalDelay), elite = e.elite });
                        if (!e.elite && !normals.Contains(e.enemy)) normals.Add(e.enemy);
                    }
                }
            if (promote > 0)
                foreach (var id in normals)
                    list.Add(new EncounterSite.Squad { enemy = id, count = 0, elite = true });
            return list.ToArray();
        }

        // ───────────── 精英升格（TS Waves.promote） ─────────────

        /// <summary>
        /// 从现有单位里升 count 只精英（不加怪）：第 k 只落在倒数第 (k mod 2) + 1 波（只有一波就都在这一波），
        /// 这一波没有可升的就往前找。候选 = 非精英、只数 &gt; 0、名册里有、不是首领；同一场地先升没升过的种类，
        /// 按耐久（生命 + 护甲 + 护盾，冲锋型 ×1.5）加权抽。返回实际升了几只。只改传入的这一份（调用方先 <see cref="Clone"/>）。
        /// </summary>
        public static int Promote(EncounterSpec spec, int count, RunRng rng)
        {
            if (spec?.waves == null || spec.waves.Length == 0 || count <= 0) return 0;
            var used = new HashSet<string>();
            int done = 0;
            for (int k = 0; k < count; k++)
            {
                int n = spec.waves.Length;
                int first = n - 1 - (k % Mathf.Min(2, n));
                bool ok = false;
                for (int step = 0; step < n && !ok; step++)
                {
                    var w = spec.waves[(first - step + n) % n];
                    ok = PromoteIn(w, used, rng);
                }
                if (!ok) break;
                done++;
            }
            return done;
        }

        static bool PromoteIn(WaveSpec w, HashSet<string> used, RunRng rng)
        {
            if (w?.entries == null) return false;
            var cand = new List<WaveEntry>();
            foreach (var e in w.entries)
            {
                if (e == null || e.elite || e.count <= 0 || string.IsNullOrEmpty(e.enemy)) continue;
                var def = EnemyRoster.Get(e.enemy);
                if (def == null || def.rank != Rank.Normal) continue;
                cand.Add(e);
            }
            if (cand.Count == 0) return false;
            var fresh = cand.FindAll(e => !used.Contains(e.enemy));
            var pool = fresh.Count > 0 ? fresh : cand;
            var pick = rng != null ? rng.Weighted(pool, Heft) : pool[0];
            if (pick == null) pick = pool[0];
            pick.count--;
            var elite = pick.Clone();
            elite.count = 1;
            elite.elite = true;
            elite.holdBack = false;
            var list = new List<WaveEntry>(w.entries) { elite };
            list.RemoveAll(e => e == null || e.count <= 0);
            w.entries = list.ToArray();
            used.Add(pick.enemy);
            return true;
        }

        /// <summary>升格权重：越耐打越先升（冲锋型再 ×1.5），同 TS 的「重型优先」</summary>
        static float Heft(WaveEntry e)
        {
            var d = EnemyRoster.Get(e.enemy);
            if (d == null) return 1;
            float bulk = Mathf.Max(1, d.hp + d.armor + d.shield);
            return d.charger ? bulk * 1.5f : bulk;
        }
    }
}
