using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英词缀登记（docs/unity-parity.md 3.7、EN4；Three.js 版 Affixes.ts 的 rollAffix / isAffixId + EnemyManager.spawn / StandardEnemy.init）：
    ///   定义：<see cref="Registry{T}"/> 里的 <see cref="EliteAffix"/>（迅捷 swift、坚盾 shielded、爆裂 volatile、狂暴 frenzied——TS 就这四种）。
    ///   取词（<see cref="Resolve"/>，同 TS）：只有精英带词缀（首领不带）；写死的词缀登记过、又不在这种敌人的排除表（<see cref="EnemyDef.affixExclusions"/>）里就用它，
    ///     否则从没被排除的词缀里均匀随机一个（<see cref="Roll"/>）。
    ///   装上（<see cref="Dress"/>，<see cref="EnemyRoster.Spawn(string, Vector3, Quaternion, float, bool, SpawnOptions)"/> 在 AI.Spawn 之后调）：
    ///     精英脚下的金环（<see cref="EliteAura"/>，带词缀时内圈是词缀纹样：迅捷卷云钩、坚盾六角甲、爆裂火药星、狂暴锯齿牙）、名字前缀（「精英·迅捷 跳鼠刀兵」/ 没有词缀「精英·跳鼠刀兵」）、
    ///     词缀运行时（<see cref="EliteAffixRuntime"/>）。
    ///   接线（<see cref="Install"/>，进入 Play 时自动）：遭遇的 <see cref="SquadAffixes.Source"/> = 本登记；头顶血条的 <see cref="EnemyBars.AffixOf"/> 读运行时。
    /// </summary>
    public static class EliteAffixes
    {
        /// <summary>全部词缀（按 [Defs] 顺序：迅捷、坚盾、爆裂、狂暴）</summary>
        public static IReadOnlyList<EliteAffix> All => Registry<EliteAffix>.All;

        public static EliteAffix Get(string id) => Registry<EliteAffix>.Get(id);

        public static bool Exists(string id) => Get(id) != null;

        /// <summary>遭遇用的词缀来源（<see cref="IEliteAffixSource"/>）</summary>
        public static readonly IEliteAffixSource Source = new SourceImpl();

        sealed class SourceImpl : IEliteAffixSource
        {
            public bool Exists(string affixId) => EliteAffixes.Exists(affixId);
            public string Roll(EnemyDef def, RunRng rng) => EliteAffixes.Roll(def, rng);
        }

        /// <summary>这种敌人能随机到的词缀 id（去掉排除表里的）</summary>
        public static List<string> Allowed(EnemyDef def)
        {
            var ids = new List<string>();
            foreach (var a in All)
                if (def?.affixExclusions == null || Array.IndexOf(def.affixExclusions, a.Id) < 0)
                    ids.Add(a.Id);
            return ids;
        }

        /// <summary>均匀随机一个没被排除的词缀；全被排除返回 null（同 TS rollAffix）</summary>
        public static string Roll(EnemyDef def, RunRng rng)
        {
            var ids = Allowed(def);
            if (ids.Count == 0) return null;
            return rng != null ? rng.Pick(ids) : ids[UnityEngine.Random.Range(0, ids.Count)];
        }

        /// <summary>写死的词缀能不能给这种敌人：登记过、不在排除表里</summary>
        public static bool Allows(EnemyDef def, string id) =>
            !string.IsNullOrEmpty(id) && Exists(id) && (def?.affixExclusions == null || Array.IndexOf(def.affixExclusions, id) < 0);

        /// <summary>
        /// 一只敌人生成时的词缀：不是精英 / 是首领 → null；写死的可用就用它，否则随机（同 TS EnemyManager.spawn：精英没有或给了无法识别的词缀时随机一个）
        /// </summary>
        public static string Resolve(EnemyDef def, bool elite, string requested, RunRng rng)
        {
            if (!elite || (def != null && def.rank == Rank.Boss)) return null;
            return Allows(def, requested) ? requested : Roll(def, rng);
        }

        /// <summary>显示名：精英「精英·」前缀，带词缀时再加词缀名（「精英·迅捷 跳鼠刀兵」）</summary>
        public static string DisplayName(string baseName, bool elite, string affixId)
        {
            if (!elite) return baseName;
            var a = Get(affixId);
            return a != null ? $"精英·{a.Name} {baseName}" : $"精英·{baseName}";
        }

        /// <summary>
        /// 装扮一只刚生成的敌人（EnemyRoster.Spawn 在 AI.Spawn 之后调）：不是精英（含首领）什么也不做，返回 null；
        /// 精英挂金环、改名、按 <see cref="Resolve"/> 装上词缀，返回词缀 id（全被排除时 null）
        /// </summary>
        public static string Dress(EnemyAI ai, EnemyDef def, string requested, RunRng rng = null)
        {
            if (!ai || !ai.Health || ai.Health.rank != Rank.Elite) return null;
            string id = Resolve(def, true, requested, rng ?? Rng());
            ai.Health.displayName = DisplayName(def != null ? def.name : ai.Health.displayName, true, id);
            var aura = EliteAura.Attach(ai, def != null ? def.radius : 0.4f);
            var affix = Get(id);
            if (affix == null) return null;
            if (aura) aura.SetSigil(affix.Id, affix.Color);
            var rt = ai.gameObject.AddComponent<EliteAffixRuntime>();
            rt.Install(ai, affix);
            return id;
        }

        /// <summary>造一个控制器并装到 host 上（运行时与测试共用）</summary>
        public static EliteAffixController Attach(EliteHost host, string id)
        {
            var a = Get(id);
            if (a == null || host == null) return null;
            var c = a.Create();
            c.Affix = a;
            c.Install(host);
            return c;
        }

        /// <summary>这只敌人身上的词缀 id（没有返回 null）：头顶血条用</summary>
        public static string AffixOf(EnemyAI e) => e && e.TryGetComponent<EliteAffixRuntime>(out var rt) ? rt.AffixId : null;

        static RunRng fallback;

        /// <summary>随机词缀用的随机流：有本局就用本局的「elite-affix」流（同种子可复现），否则一个随机种子的流</summary>
        static RunRng Rng()
        {
            var run = RunState.Current;
            if (run != null) return run.Stream("elite-affix");
            return fallback ??= new RunRng(UnityEngine.Random.Range(1, int.MaxValue));
        }

        /// <summary>接线：遭遇的词缀来源、头顶血条的词缀标签。进入 Play 时自动调（各自的 ResetStatics 之后）；测试可以手动调</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        public static void Install()
        {
            fallback = null;
            SquadAffixes.Source = Source;
            EnemyBars.AffixOf = AffixOf;
            foreach (var a in All)
                if (!EnemyBars.AffixLabels.ContainsKey(a.Id))
                    EnemyBars.AffixLabels[a.Id] = (a.Name, a.Color, a.Hint);
            // 金环与词缀纹样的程序贴图先生成好（第一只精英出生时不卡）
            if (Application.isPlaying) EliteSigilTextures.WarmUp();
        }
    }
}
