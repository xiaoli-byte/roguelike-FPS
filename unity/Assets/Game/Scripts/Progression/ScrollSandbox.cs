using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷沙盒（不依赖编辑器的调试接口，docs/unity-parity.md S0「sandbox」）：按 id 授予 / 移除任意秘卷、直接设层数、
    /// 全部 1 层 / 全部满层、清空、弹三选一、列出当前持有。调试命令（F3 等）、冒烟套件（playtest scrolls）、以后的调试面板都调这里。
    /// 作用对象：当前掉落系统（<see cref="LootDirector"/>）持有的秘卷 + 当前玩家；场景里没有掉落系统时用一份沙盒自己的持有表
    /// （测试 / 展示场景也能用，没有玩家时只登记不改属性）。
    /// </summary>
    public static class ScrollSandbox
    {
        static ScrollInventory fallback;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => fallback = null;

        /// <summary>当前的秘卷持有表</summary>
        public static ScrollInventory Inventory => LootDirector.Instance ? LootDirector.Instance.scrolls : (fallback ??= new ScrollInventory());

        static PlayerVitals Player => PlayerVitals.Instance;
        static StatSheet Sheet => Player ? Player.stats : null;

        static ScrollDef Find(string id)
        {
            var def = ScrollLibrary.Get(id);
            if (def == null) Debug.LogWarning($"[ScrollSandbox] 未知秘卷：{id}");
            return def;
        }

        /// <summary>授予 count 层（逐层走正常获得流程：发获得事件）；返回实际加了几层</summary>
        public static int Grant(string id, int count = 1)
        {
            var def = Find(id);
            if (def == null) return 0;
            int got = 0;
            for (int i = 0; i < count; i++)
                if (Inventory.Gain(def, Sheet, Player)) got++;
                else break;
            return got;
        }

        /// <summary>直接设成 n 层（0 = 移除，夹到上限；不发获得事件）；返回实际层数</summary>
        public static int SetStacks(string id, int n)
        {
            var def = Find(id);
            return def == null ? 0 : Inventory.SetStacks(def, n, Sheet, Player);
        }

        /// <summary>设成满层</summary>
        public static int Max(string id)
        {
            var def = Find(id);
            return def == null ? 0 : Inventory.SetStacks(def, def.maxStacks, Sheet, Player);
        }

        /// <summary>整卷移除；没持有返回 false</summary>
        public static bool Remove(string id)
        {
            var inv = Inventory;
            if (!inv.Has(id)) return false;
            inv.Remove(id);
            return true;
        }

        /// <summary>清空全部秘卷</summary>
        public static void Clear() => Inventory.Clear();

        /// <summary>
        /// 每卷都设成 1 层（maxed = true 时设成满层）。英雄专属只给当前英雄的（allHeroes = true 时全给）。整批包在一次属性批处理里。返回设了几卷
        /// </summary>
        public static int GrantAll(bool maxed = false, bool allHeroes = false)
        {
            var inv = Inventory;
            var sheet = Sheet;
            string hero = ScrollRoll.ContextFor(inv, Player).heroId;
            int n = 0;
            sheet?.BeginBatch();
            try
            {
                foreach (var def in ScrollLibrary.All)
                {
                    if (!allHeroes && def.heroOnly != null && def.heroOnly != hero) continue;
                    if (inv.SetStacks(def, maxed ? def.maxStacks : Mathf.Max(1, inv.Stacks(def.id)), sheet, Player) > 0) n++;
                }
            }
            finally
            {
                sheet?.EndBatch();
            }
            return n;
        }

        /// <summary>弹一次秘卷三选一（走掉落系统的队列：精英 / 首领保底、全满层转灵石都照常）；没有掉落系统返回 false</summary>
        public static bool Offer(int count = 3)
        {
            var loot = LootDirector.Instance;
            if (!loot) return false;
            loot.OfferScrolls(count);
            return true;
        }

        /// <summary>按当前条件试抽 count 张（不弹界面、不改持有）：调试抽取权重用</summary>
        public static List<ScrollDef> PreviewRoll(int count = 3, int minRarity = 0) =>
            ScrollLibrary.Roll(Inventory, count, minRarity);

        /// <summary>当前持有的一行摘要：「利刃×3、鹰目×1」</summary>
        public static string Describe()
        {
            var sb = new StringBuilder();
            foreach (var (def, n) in Inventory.Owned())
            {
                if (sb.Length > 0) sb.Append('、');
                sb.Append(def.name).Append('×').Append(n);
            }
            return sb.Length > 0 ? sb.ToString() : "（无）";
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>调试：每卷秘卷各 1 层（当前英雄的专属也给）</summary>
    [Defs]
    public sealed class ScrollGrantAllCommand : DevCommand
    {
        public override string Id => "scroll_all";
        public override string Label => "秘卷全部 1 层";

        public override void Execute() => DevCommands.Say($"秘卷各 1 层：{ScrollSandbox.GrantAll()} 卷");
    }

    /// <summary>调试：每卷秘卷满层</summary>
    [Defs]
    public sealed class ScrollMaxAllCommand : DevCommand
    {
        public override string Id => "scroll_max";
        public override string Label => "秘卷全部满层";

        public override void Execute() => DevCommands.Say($"秘卷满层：{ScrollSandbox.GrantAll(maxed: true)} 卷");
    }

    /// <summary>调试：清空秘卷</summary>
    [Defs]
    public sealed class ScrollClearCommand : DevCommand
    {
        public override string Id => "scroll_clear";
        public override string Label => "清空秘卷";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            ScrollSandbox.Clear();
            DevCommands.Say("秘卷已清空");
        }
    }

    /// <summary>调试：在日志里列出当前持有的秘卷</summary>
    [Defs]
    public sealed class ScrollListCommand : DevCommand
    {
        public override string Id => "scroll_list";
        public override string Label => "列出秘卷";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            var text = ScrollSandbox.Describe();
            Debug.Log("[ScrollSandbox] " + text);
            DevCommands.Say(text);
        }
    }
#endif
}
