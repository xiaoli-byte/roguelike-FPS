using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>关卡种类：开放大图 / 章末首领场</summary>
    public enum StageKind
    {
        Field,
        Boss,
    }

    /// <summary>
    /// 一关（docs/unity-parity.md 4.6，D1–D4）：编号「章-关」、标题、章名、场景路径、配乐、种类、难度、清关奖励。
    /// 场景路径是 Assets 相对路径；还没建的关卡也先写好将来的路径（构建设置的场景顺序由 levels 命令按这张表生成）。
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

        public StageSpec(int order, int chapter, int index, string title, string chapterName, string scene, StageKind kind, string music, string clearReward)
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
            difficulty = RunPlan.Difficulty(chapter, index);
        }

        /// <summary>「1-1 · 古道穿越戈壁」</summary>
        public string Label => $"{code} · {title}";
        public bool IsBoss => kind == StageKind.Boss;

        public override string ToString() => Label;
    }

    /// <summary>
    /// 整局的关卡规划（代码表，D1–D4）：3 章 × (3 张开放大图 + 1 个首领场) = 12 关，主线顺序固定。
    /// 只有 1-1 的场景已经建好；其余场景路径是地图单元（M12…M34）将来要建的文件。
    /// </summary>
    public static class RunPlan
    {
        public const int Chapters = 3, StagesPerChapter = 4;
        public const float ChapterSlope = 0.8f, StageSlope = 0.16f;

        static readonly StageSpec[] stages = Build();

        /// <summary>全部关卡（主线顺序）</summary>
        public static IReadOnlyList<StageSpec> Stages => stages;
        public static StageSpec First => stages[0];

        /// <summary>难度 = 1 + 0.8 ×（章 − 1）+ 0.16 × 关序（章从 1 起，关序从 0 起）</summary>
        public static float Difficulty(int chapter, int index) => 1 + ChapterSlope * (chapter - 1) + StageSlope * index;

        /// <summary>下一关；最后一关之后返回 null</summary>
        public static StageSpec Next(StageSpec s) => s != null && s.order + 1 < stages.Length ? stages[s.order + 1] : null;

        public static bool IsFinal(StageSpec s) => s != null && s.order == stages.Length - 1;

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
                if (string.Equals(s.scene, p, System.StringComparison.OrdinalIgnoreCase)) return s;
            return null;
        }

        static StageSpec[] Build()
        {
            const string Ch1 = "赤沙古道", Ch2 = "昆仑雪墟", Ch3 = "祝融火狱";
            var list = new List<StageSpec>();
            void Add(int chapter, string title, string chapterName, string scene, StageKind kind = StageKind.Field)
            {
                int index = 0;
                foreach (var s in list)
                    if (s.chapter == chapter) index++;
                bool boss = kind == StageKind.Boss;
                list.Add(new StageSpec(list.Count, chapter, index, title, chapterName, $"Assets/Scenes/{scene}.unity", kind,
                    boss ? "boss" : "calm", boss ? "weapon" : "scroll"));
            }
            // 第一章（D2）
            Add(1, "古道穿越戈壁", Ch1, "L1_1_GobiRoad");
            Add(1, "雅丹迷城", Ch1, "L1_2_Yardang");
            Add(1, "沉沙古城", Ch1, "L1_3_SunkenCity");
            Add(1, "干涸月牙泉 · 旱魃", Ch1, "L1_4_Crescent", StageKind.Boss);
            // 第二章（D3）
            Add(2, "冰瀑栈道", Ch2, "L2_1_Icefall");
            Add(2, "昆仑天阙 · 开明九门", Ch2, "L2_2_Kunlun");
            Add(2, "瑶池冰湖", Ch2, "L2_3_Yaochi");
            Add(2, "北冥冰台 · 鲲鹏", Ch2, "L2_4_Beiming", StageKind.Boss);
            // 第三章（D4；3-3 终点是熔心魔将领主战，D5）
            Add(3, "熔湖堤道", Ch3, "L3_1_Causeway");
            Add(3, "铸神井", Ch3, "L3_2_ForgeWell");
            Add(3, "铸范大坊", Ch3, "L3_3_Foundry");
            Add(3, "祝融炉心 · 火麒麟", Ch3, "L3_4_Zhurong", StageKind.Boss);
            return list.ToArray();
        }
    }
}
