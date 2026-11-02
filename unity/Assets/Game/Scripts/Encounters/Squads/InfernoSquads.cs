using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第三章编组库（第三章 v2 S2，docs/level-design/ch3-v2.md 第 4.3 节）：G01–G14 每个编组是一个工厂，返回一波 <see cref="WaveSpec"/>，
    /// 成员、站位角色、出场方式（<see cref="WaveEntry.via"/>）、精英词缀都照 4.3 写死；只数用参数调（0 = 不要这一种）。
    /// 各图构建器按名字取、拼成场地：
    /// <code>
    /// using static Spiritfire.Game.InfernoSquads;
    /// site.spec = EncounterSpec.Of(
    ///         G02(),                                     // 第一波：黑犬包抄（祸斗 ×4 + 炭童 ×2，增援门）
    ///         G01().After(1, 1.6f))                      // 第二波：余烬潮（炭童 ×6 余烬起身 + 祸斗 ×1）
    ///     .Gather(0.6f).Distance(10, 32);
    /// G03(tuo: 1, mamian: 0, tantong: 3)                 // 拆半教学：只要火鼍 + 炭童
    /// G03(tuo: 0, mamian: 1, tantong: 3).Plus(E(Huodou, 2).As(StationRole.Flank).Via(SpawnMode.Gate)).Named("狱卒巡岸")
    /// G05(eliteAffix: Shielded)                          // 第一只马面升精英·坚盾
    /// Check(site.spec, "3-1 ②", rep.Fail)                // 自查：每波 ≤ 3 种、远程 ≤ 3（精英算原种）
    /// </code>
    /// 出场方式在场地里没有对应站位时自动退回现身（<see cref="SpawnStations.ModeFor"/>），所以先接线、后摆站位也能跑。
    /// 4.3 里 G09 写的是铜匠 ×2 + 炮仗 ×2（4 只远程），违反「同时在场远程 ≤ 3」：这里默认用它实际用法的铜匠 ×1 + 炮仗 ×2。
    /// </summary>
    public static class InfernoSquads
    {
        // ───────────── 第三章阵容 id（EnemyRoster）与精英词缀 id ─────────────
        public const string Tantong = "tantong", Huodou = "huodou", Tuo = "tuo", Mamian = "mamian", Bifang = "bifang",
            Firecracker = "firecracker", FireCrow = "fire_crow", IronOx = "iron_ox", Founder = "founder", Nuo = "nuo";
        public const string Swift = "swift", Shielded = "shielded", Volatile = "volatile", Frenzied = "frenzied";

        /// <summary>编组规则 4.1：每波 ≤ 3 种怪（精英算原种）、同时在场远程 ≤ 3、场地同时在场上限 ≤ 10</summary>
        public const int MaxSpecies = 3, MaxRanged = 3, MaxAliveCap = 10;

        /// <summary>算「远程」的怪（4.1 第 3 条：毕方、马面、炮仗、铜匠）</summary>
        public static readonly IReadOnlyCollection<string> RangedIds = new HashSet<string> { Bifang, Mamian, Firecracker, Founder };

        public static bool IsRanged(string id) => id != null && ((HashSet<string>)RangedIds).Contains(id);

        static WaveEntry E(string id, int n) => EncounterSpec.E(id, n);

        static WaveSpec Wave(string label, string hint, params WaveEntry[] entries)
        {
            var list = new List<WaveEntry>();
            foreach (var e in entries)
                if (e != null && e.count > 0)
                    list.Add(e);
            return new WaveSpec { label = label, hint = hint ?? "", entries = list.ToArray() };
        }

        /// <summary>n 只里第一只按 affix 升精英（affix 为 null = 不升）：返回 (精英条目, 其余条目)</summary>
        static (WaveEntry elite, WaveEntry rest) Lead(string id, int n, string affix)
        {
            if (string.IsNullOrEmpty(affix) || n <= 0) return (null, E(id, n));
            return (E(id, 1).Elite(affix).NoHoldBack(), E(id, n - 1));
        }

        // ───────────── G01–G14 ─────────────

        /// <summary>G01 余烬潮（★，教学）：炭童余烬起身（玩家进 18 m 陆续起身），祸斗 2 s 后从侧翼 lane 跑进来吃余烬。钥匙：蹲下吹火的炭童；爽点：一下清一堆余烬。不配精英</summary>
        public static WaveSpec G01(int tantong = 6, int huodou = 1) => Wave("余烬潮",
            "倒下的炭童碎成余烬，4 秒内补一枪或踩散——祸斗会来吃",
            E(Tantong, tantong).Via(SpawnMode.Ember),
            E(Huodou, huodou).As(StationRole.Flank).At(2f).Via(SpawnMode.Gate));

        /// <summary>G02 黑犬包抄（★★）：1 只祸斗正面吠叫、其余绕侧后，炭童前排；增援门从两三条 lane 同时进。eliteAffix = 正面那只升精英（一般 Swift）。钥匙：正在吃火的那只</summary>
        public static WaveSpec G02(int huodou = 4, int tantong = 2, string eliteAffix = null)
        {
            var (lead, _) = Lead(Huodou, Mathf.Min(1, huodou), eliteAffix);
            var front = lead ?? E(Huodou, Mathf.Min(1, huodou));
            return Wave("黑犬包抄", "背靠掩体听声辨位——绕到熔岩边的祸斗一枪打下去",
                front.As(StationRole.Assault).Via(SpawnMode.Gate),
                E(Huodou, Mathf.Max(0, huodou - 1)).As(StationRole.Flank).Via(SpawnMode.Gate),
                E(Tantong, tantong).As(StationRole.Assault).Via(SpawnMode.Gate));
        }

        /// <summary>G03 熔湖伏鼍（★★★）：火鼍熔岩潜行进场，马面埋伏在高台，炭童熔岩爬出。钥匙：马面的锁芯；爽点：剥甲后熔肉、把炭童打回熔岩。火鼍不做精英</summary>
        public static WaveSpec G03(int tuo = 1, int mamian = 1, int tantong = 3) => Wave("熔湖伏鼍",
            "离熔岩岸远一点——先缴马面的索，再把火鼍引上岸剥甲",
            E(Tuo, tuo).Via(SpawnMode.LavaCrawl).NoHoldBack(),
            E(Mamian, mamian).As(StationRole.Ranged).Via(SpawnMode.Ambush),
            E(Tantong, tantong).Via(SpawnMode.LavaCrawl));

        /// <summary>G04 栖柱火矛（★★）：毕方已栖在相隔约 120° 的高点（埋伏），炭童余烬起身。钥匙：「毕」一声就该动；爽点：打腿断足坠落</summary>
        public static WaveSpec G04(int bifang = 3, int tantong = 4) => Wave("栖柱火矛",
            "「毕」一声就换掩体——打它那条腿，摔下来有 2.5 秒的窗口",
            E(Bifang, bifang).As(StationRole.Precision).Via(SpawnMode.Ambush),
            E(Tantong, tantong).Via(SpawnMode.Ember));

        /// <summary>G05 勾魂狱卒（★★）：马面从墙头跃下，祸斗 / 炭童走增援门。eliteAffix = 第一只马面升精英（坚盾 / 迅捷）。钥匙：甩链时最亮的锁芯</summary>
        public static WaveSpec G05(int mamian = 2, int huodou = 2, int tantong = 2, string eliteAffix = null)
        {
            var (lead, rest) = Lead(Mamian, mamian, eliteAffix);
            return Wave("勾魂狱卒", "断它的视线、打锁芯——别站在马面和熔岩之间",
                lead?.As(StationRole.Ranged).Via(SpawnMode.Drop),
                rest.As(StationRole.Ranged).Via(SpawnMode.Drop),
                E(Huodou, huodou).As(StationRole.Flank).Via(SpawnMode.Gate),
                E(Tantong, tantong).Via(SpawnMode.Gate));
        }

        /// <summary>G06 一窝蜂炮阵（★★）：炮仗傀儡扎堆埋伏在炮台（3.5 m 内），炭童现身推人。eliteAffix = 一只傀儡升精英（只放可选守军，一般 Volatile）。钥匙：引信烧到箱底前的火药仓</summary>
        public static WaveSpec G06(int firecracker = 3, int tantong = 4, string eliteAffix = null)
        {
            var (lead, rest) = Lead(Firecracker, firecracker, eliteAffix);
            return Wave("一窝蜂炮阵", "找扎堆的那一窝——引信烧着时打火药仓，一只炸三只",
                lead?.As(StationRole.Artillery).Via(SpawnMode.Ambush),
                rest.As(StationRole.Artillery).Via(SpawnMode.Ambush),
                E(Tantong, tantong));
        }

        /// <summary>G07 神火鸦群（★★）：飞鸦从排烟口 / 悬炉底 / 王座方向飞临，傀儡埋伏在鸦群下。钥匙：正在点火的那只；爽点：一枪引爆一串</summary>
        public static WaveSpec G07(int fireCrow = 5, int firecracker = 1) => Wave("神火鸦群",
            "抬头看朱红线——打成团的那一串，空中连爆还能炸到傀儡",
            E(FireCrow, fireCrow).Via(SpawnMode.FlyIn),
            E(Firecracker, firecracker).As(StationRole.Artillery).Via(SpawnMode.Ambush));

        /// <summary>G08 鼓风铁牛（★★★）：铁牛从炉门 / 铸门里走出来（增援门），马面埋伏在侧台，炭童现身。eliteAffix = 铁牛升精英（狂暴 / 坚盾）。钥匙：吸气时敞开的炉门</summary>
        public static WaveSpec G08(int ironOx = 1, int mamian = 1, int tantong = 3, string eliteAffix = null)
        {
            var (lead, rest) = Lead(IronOx, ironOx, eliteAffix);
            return Wave("鼓风铁牛", "先缴马面的索，再顶着吸力打敞开的炉门——呛火就跪",
                lead?.Via(SpawnMode.Gate),
                rest.Via(SpawnMode.Gate).NoHoldBack(),
                E(Mamian, mamian).As(StationRole.Ranged).Via(SpawnMode.Ambush),
                E(Tantong, tantong));
        }

        /// <summary>G09 趁热打铁（★★★）：铜匠埋伏在范列后、傀儡埋伏在铸床上，炭童余烬起身。founderAffix = 一只铜匠升精英（只放可选守军，一般 Volatile）。钥匙：弓背浇铜的铜匠</summary>
        public static WaveSpec G09(int founder = 1, int firecracker = 2, int tantong = 3, string founderAffix = null)
        {
            var (lead, rest) = Lead(Founder, founder, founderAffix);
            return Wave("趁热打铁", "先杀浇铜的铜匠——绕后或从吊梁上打它背上的坩埚",
                lead?.As(StationRole.Support).Via(SpawnMode.Ambush),
                rest.As(StationRole.Support).Via(SpawnMode.Ambush),
                E(Firecracker, firecracker).As(StationRole.Artillery).Via(SpawnMode.Ambush),
                E(Tantong, tantong).Via(SpawnMode.Ember));
        }

        /// <summary>G10 三面傩阵（★★★）：傩巫在后方台上跳傩（埋伏），祸斗 / 炭童走增援门。eliteAffix = 傩巫升精英（坚盾）。钥匙：傩巫的面具</summary>
        public static WaveSpec G10(int nuo = 1, int huodou = 3, int tantong = 3, string eliteAffix = null)
        {
            var (lead, rest) = Lead(Nuo, nuo, eliteAffix);
            return Wave("三面傩阵", "看光环颜色——先打碎傩巫的面具，金面的祸斗最难缠",
                lead?.As(StationRole.Support).Via(SpawnMode.Ambush),
                rest.As(StationRole.Support).Via(SpawnMode.Ambush),
                E(Huodou, huodou).As(StationRole.Flank).Via(SpawnMode.Gate),
                E(Tantong, tantong).Via(SpawnMode.Gate));
        }

        /// <summary>G11 熔流伏兵（★★，路遇）：炭童从桥 / 堤两侧熔岩爬出，毕方已栖在桥头。钥匙：毕方；爽点：一梭子把爬上来的炭童推回熔岩</summary>
        public static WaveSpec G11(int tantong = 5, int bifang = 1) => Wave("熔流伏兵",
            "别停在堤上——冲到对岸掩体，或者把爬上来的炭童打回熔岩",
            E(Tantong, tantong).Via(SpawnMode.LavaCrawl),
            E(Bifang, bifang).As(StationRole.Precision).Via(SpawnMode.Ambush));

        /// <summary>G12 狱门坚守（★★★★，精英组）：精英马面从楼台跃下，傀儡埋伏，飞鸦飞临。mamianAffix = 精英词缀（默认狂暴）。钥匙：精英马面</summary>
        public static WaveSpec G12(string mamianAffix = Frenzied, int firecracker = 2, int fireCrow = 3) => Wave("狱门坚守",
            "先速杀精英马面——引飞鸦到傀儡头顶打，连爆一起炸翻",
            E(Mamian, 1).Elite(mamianAffix ?? "").As(StationRole.Ranged).Via(SpawnMode.Drop).NoHoldBack(),
            E(Firecracker, firecracker).As(StationRole.Artillery).Via(SpawnMode.Ambush),
            E(FireCrow, fireCrow).Via(SpawnMode.FlyIn));

        /// <summary>G13 炉心守将（★★★★★，精英组）：精英铁牛从熔铁闸里走出（增援门），铜匠埋伏在牌坊台，祸斗走 lane。oxAffix = 精英词缀（默认狂暴）。钥匙：铜匠</summary>
        public static WaveSpec G13(string oxAffix = Frenzied, int founder = 1, int huodou = 3) => Wave("炉心守将",
            "先杀牌坊台上的铜匠，还是趁铁牛吸气打炉门——狂暴之后别拖",
            E(IronOx, 1).Elite(oxAffix ?? "").Via(SpawnMode.Gate).NoHoldBack(),
            E(Founder, founder).As(StationRole.Support).Via(SpawnMode.Ambush),
            E(Huodou, huodou).As(StationRole.Flank).Via(SpawnMode.Gate));

        /// <summary>G14 毕方鸦阵（★★★）：全空中编组，从井口排烟孔一路盘下来（飞临）。钥匙：毕方；爽点：断足的毕方摔进熔岩井</summary>
        public static WaveSpec G14(int bifang = 2, int fireCrow = 4) => Wave("毕方鸦阵",
            "抬头横移——打毕方的腿，让它从链柱上摔下去",
            E(Bifang, bifang).As(StationRole.Precision).Via(SpawnMode.FlyIn),
            E(FireCrow, fireCrow).Via(SpawnMode.FlyIn));

        // ───────────── 登记（试玩套件逐组刷、报告用）─────────────

        /// <summary>一个编组：id（G01…）、名字、星级、默认编制</summary>
        public readonly struct Squad
        {
            public readonly string id, name;
            public readonly int stars;
            public readonly Func<WaveSpec> make;

            public Squad(string id, string name, int stars, Func<WaveSpec> make)
            {
                this.id = id;
                this.name = name;
                this.stars = stars;
                this.make = make;
            }
        }

        /// <summary>G01–G14 的默认编制（精英组按 4.3 带精英，其余不带）</summary>
        public static readonly IReadOnlyList<Squad> All = new[]
        {
            new Squad("G01", "余烬潮", 1, () => G01()),
            new Squad("G02", "黑犬包抄", 2, () => G02()),
            new Squad("G03", "熔湖伏鼍", 3, () => G03()),
            new Squad("G04", "栖柱火矛", 2, () => G04()),
            new Squad("G05", "勾魂狱卒", 2, () => G05()),
            new Squad("G06", "一窝蜂炮阵", 2, () => G06()),
            new Squad("G07", "神火鸦群", 2, () => G07()),
            new Squad("G08", "鼓风铁牛", 3, () => G08()),
            new Squad("G09", "趁热打铁", 3, () => G09()),
            new Squad("G10", "三面傩阵", 3, () => G10()),
            new Squad("G11", "熔流伏兵", 2, () => G11()),
            new Squad("G12", "狱门坚守", 4, () => G12()),
            new Squad("G13", "炉心守将", 5, () => G13()),
            new Squad("G14", "毕方鸦阵", 3, () => G14()),
        };

        /// <summary>按 id（"G01"…，不分大小写）取默认编制；没有返回 null</summary>
        public static WaveSpec Get(string id)
        {
            foreach (var s in All)
                if (string.Equals(s.id, id, StringComparison.OrdinalIgnoreCase))
                    return s.make();
            return null;
        }

        // ───────────── 拼装（扩展方法）─────────────

        /// <summary>往一波里再加几条（链式；只数为 0 的跳过）</summary>
        public static WaveSpec Plus(this WaveSpec w, params WaveEntry[] more)
        {
            var list = new List<WaveEntry>(w.entries ?? Array.Empty<WaveEntry>());
            foreach (var e in more)
                if (e != null && e.count > 0)
                    list.Add(e);
            w.entries = list.ToArray();
            return w;
        }

        /// <summary>改波次名（链式）</summary>
        public static WaveSpec Named(this WaveSpec w, string label)
        {
            w.label = label ?? "";
            return w;
        }

        /// <summary>把一波里所有条目的出场方式改成 mode（链式；比如整组改现身做对照）</summary>
        public static WaveSpec AllVia(this WaveSpec w, SpawnMode mode)
        {
            if (w.entries != null)
                foreach (var e in w.entries)
                    if (e != null)
                        e.via = mode;
            return w;
        }

        // ───────────── 自查 ─────────────

        /// <summary>一波里有几种怪（只数 &gt; 0；精英算原种）</summary>
        public static int Species(WaveSpec w)
        {
            var set = new HashSet<string>();
            if (w?.entries != null)
                foreach (var e in w.entries)
                    if (e != null && e.count > 0 && !string.IsNullOrEmpty(e.enemy))
                        set.Add(e.enemy);
            return set.Count;
        }

        /// <summary>一波里远程（<see cref="RangedIds"/>）的只数</summary>
        public static int Ranged(WaveSpec w)
        {
            int n = 0;
            if (w?.entries != null)
                foreach (var e in w.entries)
                    if (e != null && e.count > 0 && IsRanged(e.enemy))
                        n += e.count;
            return n;
        }

        /// <summary>
        /// 自查一个场地的编排：每波 ≤ 3 种怪、每波远程 ≤ 3、同时在场上限 ≤ 10、名册里有这种怪（名册在编辑期也能查）。
        /// 每条问题回调一次 fail（比如 LevelKit.Report.Fail），返回问题条数
        /// </summary>
        public static int Check(EncounterSpec spec, string where, Action<string> fail)
        {
            int bad = 0;
            void Bad(string msg)
            {
                bad++;
                fail?.Invoke($"{where}：{msg}");
            }
            if (spec?.waves == null) return 0;
            if (spec.maxAlive > MaxAliveCap) Bad($"同时在场上限 {spec.maxAlive} > {MaxAliveCap}");
            for (int i = 0; i < spec.waves.Length; i++)
            {
                var w = spec.waves[i];
                if (w == null) continue;
                string tag = $"第 {i + 1} 波「{w.label}」";
                int sp = Species(w), rg = Ranged(w);
                if (sp > MaxSpecies) Bad($"{tag} {sp} 种怪（≤ {MaxSpecies}）");
                if (rg > MaxRanged) Bad($"{tag} 远程 {rg} 只（≤ {MaxRanged}）");
                if (w.entries == null) continue;
                foreach (var e in w.entries)
                    if (e != null && e.count > 0 && EnemyRoster.Get(e.enemy) == null)
                        Bad($"{tag} 名册里没有 {e.enemy}");
            }
            return bad;
        }

        /// <summary>自查一波（同 <see cref="Check(EncounterSpec, string, Action{string})"/>）</summary>
        public static int Check(WaveSpec wave, string where, Action<string> fail) => Check(EncounterSpec.Of(wave), where, fail);

        /// <summary>一行摘要：「余烬潮：炭童×6·余烬起身、祸斗×1·增援门（2 种，远程 0）」</summary>
        public static string Describe(WaveSpec w)
        {
            var parts = new List<string>();
            if (w?.entries != null)
                foreach (var e in w.entries)
                    if (e != null && e.count > 0)
                    {
                        var def = EnemyRoster.Get(e.enemy);
                        string name = def != null && !string.IsNullOrEmpty(def.name) ? def.name : e.enemy;
                        string elite = e.elite ? $"（精英{(string.IsNullOrEmpty(e.affix) ? "" : "·" + e.affix)}）" : "";
                        parts.Add($"{name}×{e.count}{elite}·{SpawnModes.Label(e.via)}");
                    }
            return $"{w?.label}：{string.Join("、", parts)}（{Species(w)} 种，远程 {Ranged(w)}）";
        }
    }
}
