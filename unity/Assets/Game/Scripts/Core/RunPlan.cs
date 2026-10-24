using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>关卡种类：开放大图 / 章末首领场</summary>
    public enum StageKind
    {
        Field,
        Boss,
    }

    /// <summary>
    /// 一关（docs/unity-parity.md 4.6，D1–D4）：编号「章-关」、标题、章名、场景路径、配乐、种类、难度、清关奖励、有没有补给营。
    /// 场景路径是 Assets 相对路径；构建设置的场景顺序按这张表生成（编辑器 Levels/BuildOrder.cs）。
    /// </summary>
    public sealed class StageSpec
    {
        /// <summary>编号「1-1」</summary>
        public readonly string code;
        public readonly string title;
        /// <summary>章名（章节卡、结算用）</summary>
        public readonly string chapterName;
        /// <summary>场景路径（Assets/Scenes/…unity）</summary>
        public readonly string scene;
        /// <summary>进关时的配乐 id（GameAudio：calm / combat / boss）</summary>
        public readonly string music;
        public readonly StageKind kind;
        /// <summary>章（1 起）</summary>
        public readonly int chapter;
        /// <summary>章内关序（0 起，首领场 = 3）</summary>
        public readonly int index;
        /// <summary>在整张表里的位置（0 起）</summary>
        public readonly int order;
        /// <summary>难度 = 1 + 0.8 ×（章 − 1）+ 0.16 × 关序（D1）：章末 1.48 / 2.28 / 3.08，与 Three.js 一致</summary>
        public readonly float difficulty;
        /// <summary>清关奖励（奖励串，见 <see cref="RewardRegistry"/>）：开放图给秘卷，首领给武器（W2 之后按章节掷高稀有度）</summary>
        public readonly string clearReward;
        /// <summary>
        /// 这一关里有首领前的补给营（<see cref="SupplyCamp"/>：完整商店 + 安全区）：第一章在 1-3 末段的寺院塔院（1-4 月牙泉入口只是安全起步台），
        /// 第二、三章在首领场自己的门槛外（2-4 雪岭营地、3-4 炉心外的营地）。关卡构建器按这一列摆，整局冒烟按这一列查
        /// </summary>
        public readonly bool supplyCamp;

        public StageSpec(int order, int chapter, int index, string title, string chapterName, string scene, StageKind kind, string music, string clearReward,
            bool supplyCamp = false)
        {
            this.order = order;
            this.chapter = chapter;
            this.index = index;
            code = $"{chapter}-{index + 1}";
            this.title = title;
            this.chapterName = chapterName;
            this.scene = scene;
            this.kind = kind;
            this.music = music;
            this.clearReward = clearReward;
            this.supplyCamp = supplyCamp;
            difficulty = RunPlan.Difficulty(chapter, index);
        }

        /// <summary>「1-1 · 古道穿越戈壁」</summary>
        public string Label => $"{code} · {title}";
        public bool IsBoss => kind == StageKind.Boss;

        public override string ToString() => Label;
    }

    /// <summary>
    /// 整局的关卡规划（代码表，D1–D4）：3 章 × (3 张开放大图 + 1 个首领场) = 12 关，主线顺序固定。
    ///
    /// 试玩开关（I1）：<see cref="DemoEnd"/> 设成某一关（缺省 null = 完整版）后，这一关就是「最后一关」——<see cref="IsFinal"/> 为真、
    /// <see cref="Next"/> 到此为止：打完 1-4 的首领直接走胜利链 → 整局结算（BossEncounter.Decide / GameSession.CompleteStage 都读 IsFinal），
    /// 构建设置里之后的关卡场景不打进包（BuildOrder）。来源（先到先得）：代码里赋值（测试）→ 命令行 <c>-demoEnd 1-4</c> / <c>-demoEnd=1-4</c> /
    /// <c>-demo</c>（= <see cref="DemoDefault"/>）→ 编译符号 <c>SPIRITFIRE_DEMO</c>（= <see cref="DemoDefault"/>，打试玩包用；编辑器菜单
    /// Spiritfire/构建设置/试玩版 开关它）。<see cref="Stages"/> 永远是完整的 12 关（构建顺序、经济投影用）。
    /// </summary>
    public static class RunPlan
    {
        public const int Chapters = 3, StagesPerChapter = 4;
        public const float ChapterSlope = 0.8f, StageSlope = 0.16f;
        /// <summary>试玩版缺省到哪一关（第一章首领 · 旱魃）</summary>
        public const string DemoDefault = "1-4";
        /// <summary>命令行参数：<c>-demoEnd 1-4</c> / <c>-demoEnd=1-4</c>；<c>-demo</c> = <see cref="DemoDefault"/></summary>
        public const string DemoEndArg = "-demoEnd", DemoArg = "-demo";

        static readonly StageSpec[] stages = Build();
        static string demoEnd;
        static bool demoResolved;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            demoEnd = null;
            demoResolved = false;
        }

        /// <summary>全部关卡（主线顺序，完整版 12 关，不受试玩开关影响）</summary>
        public static IReadOnlyList<StageSpec> Stages => stages;
        public static StageSpec First => stages[0];

        /// <summary>
        /// 试玩版的最后一关编号（null / 空 = 完整版）。设成不在表里的编号等于关掉。缺省按命令行 / 编译符号解析一次（见类注释）
        /// </summary>
        public static string DemoEnd
        {
            get
            {
                if (!demoResolved)
                {
                    demoResolved = true;
                    demoEnd = ResolveDemoEnd(Environment.GetCommandLineArgs());
                }
                return demoEnd;
            }
            set
            {
                demoResolved = true;
                demoEnd = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
            }
        }

        /// <summary>试玩开关开着（DemoEnd 指向表里的一关，而且不是完整版的最后一关）</summary>
        public static bool IsDemo => Get(DemoEnd) is { } s && s.order < stages.Length - 1;

        /// <summary>这一局的最后一关：试玩版 = DemoEnd，完整版 = 3-4</summary>
        public static StageSpec Final => IsDemo ? Get(DemoEnd) : stages[stages.Length - 1];

        /// <summary>这一局要走的关卡（第一关 … <see cref="Final"/>）</summary>
        public static IReadOnlyList<StageSpec> Playable
        {
            get
            {
                int n = Final.order + 1;
                if (n == stages.Length) return stages;
                var list = new StageSpec[n];
                Array.Copy(stages, list, n);
                return list;
            }
        }

        /// <summary>这一关在不在这一局的路线上（试玩版里 DemoEnd 之后的关卡不在）</summary>
        public static bool InPlay(StageSpec s) => s != null && s.order <= Final.order;

        /// <summary>命令行 / 编译符号 → 试玩终点（纯函数，EditMode 可测）</summary>
        public static string ResolveDemoEnd(string[] args)
        {
            if (args != null)
                for (int i = 0; i < args.Length; i++)
                {
                    var a = args[i];
                    if (string.IsNullOrEmpty(a)) continue;
                    if (a.StartsWith(DemoEndArg + "=", StringComparison.OrdinalIgnoreCase)) return Normalize(a.Substring(DemoEndArg.Length + 1));
                    if (string.Equals(a, DemoEndArg, StringComparison.OrdinalIgnoreCase)) return i + 1 < args.Length ? Normalize(args[i + 1]) : DemoDefault;
                    if (string.Equals(a, DemoArg, StringComparison.OrdinalIgnoreCase)) return DemoDefault;
                }
#if SPIRITFIRE_DEMO
            return DemoDefault;
#else
            return null;
#endif
        }

        static string Normalize(string code) => string.IsNullOrWhiteSpace(code) ? null : code.Trim();

        /// <summary>难度 = 1 + 0.8 ×（章 − 1）+ 0.16 × 关序（章从 1 起，关序从 0 起）</summary>
        public static float Difficulty(int chapter, int index) => 1 + ChapterSlope * (chapter - 1) + StageSlope * index;

        /// <summary>下一关；这一局的最后一关（<see cref="IsFinal"/>，试玩版 = DemoEnd）之后返回 null</summary>
        public static StageSpec Next(StageSpec s) => s != null && !IsFinal(s) && s.order + 1 < stages.Length ? stages[s.order + 1] : null;

        /// <summary>这一局的最后一关（完整版 3-4；试玩版 DemoEnd）：打完 = 胜利结算</summary>
        public static bool IsFinal(StageSpec s) => s != null && s.order >= Final.order;

        /// <summary>完整版的最后一关（3-4：击败全部首领）</summary>
        public static bool IsLast(StageSpec s) => s != null && s.order == stages.Length - 1;

        /// <summary>按编号取（「1-2」）；没有则 null</summary>
        public static StageSpec Get(string code)
        {
            if (string.IsNullOrEmpty(code)) return null;
            foreach (var s in stages)
                if (s.code == code) return s;
            return null;
        }

        /// <summary>按场景路径取（不区分大小写，斜杠方向不限）；没有则 null（测试场、展示场景）</summary>
        public static StageSpec ForScene(string scenePath)
        {
            if (string.IsNullOrEmpty(scenePath)) return null;
            var p = scenePath.Replace('\\', '/');
            foreach (var s in stages)
                if (string.Equals(s.scene, p, StringComparison.OrdinalIgnoreCase)) return s;
            return null;
        }

        static StageSpec[] Build()
        {
            const string Ch1 = "赤沙古道", Ch2 = "昆仑雪墟", Ch3 = "祝融火狱";
            var list = new List<StageSpec>();
            void Add(int chapter, string title, string chapterName, string scene, StageKind kind = StageKind.Field, bool supply = false)
            {
                int index = 0;
                foreach (var s in list)
                    if (s.chapter == chapter) index++;
                bool boss = kind == StageKind.Boss;
                list.Add(new StageSpec(list.Count, chapter, index, title, chapterName, $"Assets/Scenes/{scene}.unity", kind,
                    boss ? "boss" : "calm", boss ? "weapon" : "scroll", supply));
            }
            // 第一章（D2；补给营在 1-3 末段的寺院塔院）
            Add(1, "古道穿越戈壁", Ch1, "L1_1_GobiRoad");
            Add(1, "雅丹迷城", Ch1, "L1_2_Yardang");
            Add(1, "沉沙古城", Ch1, "L1_3_SunkenCity", supply: true);
            Add(1, "鸣沙山月牙泉 · 旱魃", Ch1, "L1_4_Crescent", StageKind.Boss);
            // 第二章（D3；补给营在 2-4 首领场门槛外）
            Add(2, "冰瀑栈道", Ch2, "L2_1_Icefall");
            Add(2, "昆仑天阙 · 开明九门", Ch2, "L2_2_Kunlun");
            Add(2, "瑶池冰湖", Ch2, "L2_3_Yaochi");
            Add(2, "北冥冰台 · 鲲鹏", Ch2, "L2_4_Beiming", StageKind.Boss, true);
            // 第三章（D4；3-3 终点是熔心魔将领主战，D5；补给营在 3-4 首领场门槛外）
            Add(3, "熔湖堤道", Ch3, "L3_1_Causeway");
            Add(3, "铸神井", Ch3, "L3_2_ForgeWell");
            Add(3, "铸范大坊", Ch3, "L3_3_Foundry");
            Add(3, "祝融炉心 · 火麒麟", Ch3, "L3_4_Zhurong", StageKind.Boss, true);
            return list.ToArray();
        }
    }
}
