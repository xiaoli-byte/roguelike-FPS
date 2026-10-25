using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>图鉴的四类</summary>
    public enum CodexKind
    {
        Weapon,
        Scroll,
        Enemy,
        Pet,
    }

    /// <summary>
    /// 图鉴（I5，比 Three.js 多做的部分）：武器 / 秘卷 / 敌人（含首领）/ 灵宠，首次获得（敌人：首次交手）时收录。
    /// 存档文件里的「codex」段（元进度，跟魂晶、天赋同一个文件，不随单局清掉；每个档各一份：调试局只记调试档）。
    /// 收录由 <see cref="CodexTracker"/>（[GameSystem]）在局内调 <see cref="Unlock"/>；新收录的条目带「新」标记，图鉴里看过之后清掉（<see cref="MarkSeen"/>）。
    /// 条目清单（名字、排序、描述来源）在 <see cref="CodexCatalog"/>。
    /// <code>
    /// { "weapon": ["smg", …], "scroll": [...], "enemy": [...], "pet": [...], "fresh": ["enemy:apsara", …] }
    /// </code>
    /// 认不出的 id（新版本加的条目、改了名的）原样保留，只是不计进收录数。
    /// </summary>
    public sealed class Codex : ISaveSection, ISaveFileBound
    {
        public const string SectionKey = "codex";

        public string Key => SectionKey;
        public int Version => 1;

        static readonly string[] JsonKeys = { "weapon", "scroll", "enemy", "pet" };

        readonly List<string>[] unlocked = { new(), new(), new(), new() };
        readonly HashSet<string>[] lookup = { new(), new(), new(), new() };
        readonly HashSet<string> fresh = new();

        /// <summary>所属的存档文件（收录后稍后写盘）</summary>
        public SaveFile File { get; private set; }

        /// <summary>新收录了一条（类别, id）：局内提示用</summary>
        public static event Action<CodexKind, string> Unlocked;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Unlocked = null;

        /// <summary>当前档（主菜单 / 当前局用的档）的图鉴</summary>
        public static Codex Current => SaveService.Profile.Section<Codex>();

        /// <summary>某一局该记进的图鉴（调试局 → 调试档）</summary>
        public static Codex For(RunState run) => SaveService.ProfileFor(run).Section<Codex>();

        public void Bind(SaveFile file) => File = file;

        static string FreshKey(CodexKind kind, string id) => JsonKeys[(int)kind] + ":" + id;

        public bool IsUnlocked(CodexKind kind, string id) => id != null && lookup[(int)kind].Contains(id);

        /// <summary>新收录、还没在图鉴里看过</summary>
        public bool IsFresh(CodexKind kind, string id) => id != null && fresh.Contains(FreshKey(kind, id));

        /// <summary>按收录先后的 id（含认不出的）</summary>
        public IReadOnlyList<string> UnlockedIds(CodexKind kind) => unlocked[(int)kind];

        /// <summary>某一类收录了几条（只数条目清单里有的）</summary>
        public int Count(CodexKind kind)
        {
            int n = 0;
            foreach (var e in CodexCatalog.Of(kind))
                if (IsUnlocked(kind, e.id)) n++;
            return n;
        }

        /// <summary>四类合计收录数</summary>
        public int TotalCount
        {
            get
            {
                int n = 0;
                foreach (CodexKind k in Enum.GetValues(typeof(CodexKind))) n += Count(k);
                return n;
            }
        }

        /// <summary>某一类里还没看过的新条目数</summary>
        public int FreshCount(CodexKind kind)
        {
            int n = 0;
            foreach (var e in CodexCatalog.Of(kind))
                if (IsFresh(kind, e.id)) n++;
            return n;
        }

        /// <summary>
        /// 收录一条：第一次收录返回 true（记「新」标记、稍后写盘、发 <see cref="Unlocked"/>）；已经收录过、id 为空返回 false。
        /// 不在条目清单里的 id 也收（以后的版本可能会有），只是图鉴里不显示
        /// </summary>
        public bool Unlock(CodexKind kind, string id)
        {
            if (string.IsNullOrEmpty(id) || !lookup[(int)kind].Add(id)) return false;
            unlocked[(int)kind].Add(id);
            fresh.Add(FreshKey(kind, id));
            File?.SaveSoon();
            try { Unlocked?.Invoke(kind, id); }
            catch (Exception e) { Debug.LogException(e); }
            return true;
        }

        /// <summary>在图鉴里看过了：清掉「新」标记（有变化时稍后写盘）</summary>
        public void MarkSeen(CodexKind kind, string id)
        {
            if (id != null && fresh.Remove(FreshKey(kind, id))) File?.SaveSoon();
        }

        /// <summary>清空（测试 / 调试）</summary>
        public void Clear()
        {
            foreach (var l in unlocked) l.Clear();
            foreach (var h in lookup) h.Clear();
            fresh.Clear();
        }

        public string Capture()
        {
            var o = new JObject();
            for (int k = 0; k < JsonKeys.Length; k++)
            {
                var a = new JArray();
                foreach (var id in unlocked[k]) a.Add(id);
                o[JsonKeys[k]] = a;
            }
            var f = new JArray();
            foreach (var key in fresh) f.Add(key);
            o["fresh"] = f;
            return o.ToString(Formatting.None);
        }

        /// <summary>v1：宽容读取——某一项不是字符串数组就当空；重复的 id 去重</summary>
        public void Restore(string json, int version)
        {
            Clear();
            var o = MetaJson.Object(json);
            if (o == null) return;
            for (int k = 0; k < JsonKeys.Length; k++)
                foreach (var id in MetaJson.StringList(o[JsonKeys[k]]))
                    if (lookup[k].Add(id))
                        unlocked[k].Add(id);
            foreach (var key in MetaJson.StringList(o["fresh"])) fresh.Add(key);
        }
    }

    /// <summary>图鉴里的一条（名字、章节、稀有度、对应的定义）</summary>
    public sealed class CodexEntry
    {
        public CodexKind kind;
        public string id, name;
        /// <summary>名字下面的一行（武器类别、秘卷稀有度、敌人定位、灵宠称号）</summary>
        public string subtitle;
        /// <summary>主题色（稀有度色、元素色、首领朱砂）</summary>
        public Color color = UITheme.Paper;
        /// <summary>出没的章（敌人；0 = 不分章）</summary>
        public int chapter;
        public bool boss;
        /// <summary>WeaponDef / ScrollDef / EnemyDef / BossDef / PetDef</summary>
        public object def;

        public string Key => kind + ":" + id;
        public override string ToString() => Key;
    }

    /// <summary>
    /// 图鉴的条目清单：武器（WeaponLibrary 的顺序）、秘卷（按稀有度、再按注册顺序）、敌人（按章，章末是首领；分身 / 余烬这类附属单位不单列）、
    /// 灵宠（PetLibrary 的顺序）。敌人的描述写在 <see cref="Lore"/>（关卡里看得到的打法要点），没写的按定义拼一句。
    /// </summary>
    public static class CodexCatalog
    {
        static readonly List<CodexEntry>[] lists = new List<CodexEntry>[4];

        /// <summary>不单列的附属单位（蜃景分身、炭童余烬）；复燃的炭童算炭童</summary>
        static readonly HashSet<string> hiddenEnemies = new() { "mirage_toad_decoy", "tantong_ember" };
        static readonly Dictionary<string, string> enemyAlias = new() { ["tantong_reborn"] = "tantong" };
        /// <summary>测试场用的首领（不进 RunPlan）</summary>
        static readonly HashSet<string> hiddenBosses = new() { "boss_proxy", "boss_hazard_lab" };

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            for (int i = 0; i < lists.Length; i++) lists[i] = null;
        }

        public static string KindName(CodexKind k) => k switch
        {
            CodexKind.Weapon => "武器",
            CodexKind.Scroll => "秘卷",
            CodexKind.Enemy => "敌人",
            _ => "灵宠",
        };

        /// <summary>某一类的全部条目（第一次用到时按注册表建好、缓存）</summary>
        public static IReadOnlyList<CodexEntry> Of(CodexKind kind) => lists[(int)kind] ??= Build(kind);

        public static CodexEntry Find(CodexKind kind, string id)
        {
            if (id == null) return null;
            foreach (var e in Of(kind))
                if (e.id == id) return e;
            return null;
        }

        /// <summary>全部条目数</summary>
        public static int Total => Of(CodexKind.Weapon).Count + Of(CodexKind.Scroll).Count + Of(CodexKind.Enemy).Count + Of(CodexKind.Pet).Count;

        /// <summary>
        /// 受伤体 → 图鉴里的敌人 id：首领取首领定义的 id，普通敌人取名册 id（复燃的炭童算炭童）；附属单位（分身、余烬）和不是敌人的返回 null
        /// </summary>
        public static string EnemyIdOf(Damageable d)
        {
            if (!d) return null;
            var ai = d.GetComponent<EnemyAI>();
            if (!ai) ai = d.GetComponentInParent<EnemyAI>();
            return EnemyIdOf(ai);
        }

        public static string EnemyIdOf(EnemyAI ai)
        {
            if (!ai) return null;
            if (ai is BossBrain boss) return boss.Def != null && !hiddenBosses.Contains(boss.Def.id) ? boss.Def.id : null;
            return EnemyId(ai.enemyId);
        }

        /// <summary>名册 id → 图鉴 id（别名换成本体，附属单位返回 null）</summary>
        public static string EnemyId(string rosterId)
        {
            if (string.IsNullOrEmpty(rosterId) || hiddenEnemies.Contains(rosterId)) return null;
            return enemyAlias.TryGetValue(rosterId, out var to) ? to : rosterId;
        }

        static List<CodexEntry> Build(CodexKind kind)
        {
            var list = new List<CodexEntry>();
            switch (kind)
            {
                case CodexKind.Weapon:
                    foreach (var w in WeaponLibrary.All)
                        list.Add(new CodexEntry { kind = kind, id = w.id, name = w.name, subtitle = w.category, color = Elemental(w.element, UITheme.Paper), def = w });
                    break;
                case CodexKind.Scroll:
                {
                    var all = new List<ScrollDef>(ScrollLibrary.All);
                    var order = new Dictionary<ScrollDef, int>();
                    for (int i = 0; i < all.Count; i++) order[all[i]] = i;
                    all.Sort((a, b) => a.rarity != b.rarity ? a.rarity.CompareTo(b.rarity) : order[a].CompareTo(order[b]));
                    foreach (var s in all)
                        list.Add(new CodexEntry { kind = kind, id = s.id, name = s.name, subtitle = $"{Rarity.Name(s.rarity)}秘卷", color = Rarity.Color(s.rarity), def = s });
                    break;
                }
                case CodexKind.Enemy:
                {
                    var byChapter = new List<CodexEntry>();
                    int seq = 0;
                    var seqOf = new Dictionary<CodexEntry, int>();
                    foreach (var e in EnemyRoster.All)
                    {
                        if (EnemyId(e.id) != e.id) continue;
                        var entry = new CodexEntry
                        {
                            kind = kind, id = e.id, name = e.name, subtitle = RoleName(e), chapter = Lore.Chapter(e.id),
                            color = Elemental(e.element, UITheme.Paper2), def = e,
                        };
                        seqOf[entry] = seq++;
                        byChapter.Add(entry);
                    }
                    foreach (var b in Registry<BossDef>.All)
                    {
                        if (hiddenBosses.Contains(b.id)) continue;
                        var entry = new CodexEntry
                        {
                            kind = kind, id = b.id, name = b.name, subtitle = string.IsNullOrEmpty(b.title) ? "首领" : $"首领 · {b.title}",
                            chapter = Lore.Chapter(b.id), boss = true, color = UITheme.CinnabarHi, def = b,
                        };
                        // 首领排在本章敌人之后
                        seqOf[entry] = 100000 + seq++;
                        byChapter.Add(entry);
                    }
                    byChapter.Sort((a, b) =>
                    {
                        int ca = a.chapter > 0 ? a.chapter : 99, cb = b.chapter > 0 ? b.chapter : 99;
                        return ca != cb ? ca.CompareTo(cb) : seqOf[a].CompareTo(seqOf[b]);
                    });
                    list.AddRange(byChapter);
                    break;
                }
                default:
                    foreach (var p in PetLibrary.All)
                        list.Add(new CodexEntry { kind = kind, id = p.id, name = p.name, subtitle = $"{PetRarities.Name(p.rarity)} · {p.title}", color = p.RarityColor, def = p });
                    break;
            }
            return list;
        }

        static Color Elemental(Element e, Color fallback) => e != Element.None ? UITheme.ElementColor(e) : fallback;

        /// <summary>敌人的定位（站位角色 + 飞行）</summary>
        public static string RoleName(EnemyDef e)
        {
            string role = e.placementRole switch
            {
                EnemyPlacement.Assault => "突击",
                EnemyPlacement.Flank => "侧袭",
                EnemyPlacement.Ranged => "远程",
                EnemyPlacement.Precision => "狙击",
                EnemyPlacement.Artillery => "炮击",
                _ => "辅助",
            };
            return e.flying ? $"{role} · 飞行" : role;
        }

        /// <summary>敌人 / 首领的描述（没写的按定义拼一句）</summary>
        public static string Describe(CodexEntry e)
        {
            var lore = Lore.Text(e.id);
            if (!string.IsNullOrEmpty(lore)) return lore;
            if (e.def is EnemyDef d) return $"{RoleName(d)}型敌人。";
            if (e.def is BossDef) return "镇守一方的首领。";
            return "";
        }

        /// <summary>
        /// 敌人与首领的图鉴描述（打法要点，摘自各敌人定义的设计说明；docs/level-design 的章节划分）：id → (章, 描述)
        /// </summary>
        public static class Lore
        {
            static readonly Dictionary<string, (int chapter, string text)> table = new()
            {
                // ── 第一章 · 赤沙古道 ──
                ["jerboa_blade"] = (1, "戈壁里成群出没的跳鼠兵，三五只一拥而上，扑斩接交叉斩。弱点：两耳之间的铜铃。"),
                ["fire_rat"] = (1, "浑身火毛的鼠妖，蜷成火球滚进人群，死时自爆。整个身体都是弱点，趁它滚过来之前打掉。"),
                ["scorpion_archer"] = (1, "披甲的蝎人弩手，躲在远处压制射击。弱点：尾巴弧顶的毒囊。"),
                ["tomb_beast"] = (1, "活过来的唐三彩镇墓兽，重甲冲锋，正面极硬。弱点：背上的龟裂，绕到身后打。"),
                ["apsara"] = (1, "怀抱琵琶的堕落飞天，悬在半空为同伴赐福。弱点：琵琶的琴轸——先打掉她。"),
                ["mirage_toad"] = (1, "躲在岩丘后吊射火球，还会吐出蜃景分身迷惑人。弱点：下颌的喉囊。"),
                ["sand_wraith"] = (1, "被旱魃的日火烧成沙的跳鼠兵，潜在沙下逼近，破沙旋斩之后会硬直片刻。"),
                ["boss_hanba"] = (1, "第一章首领。悬浮的干瘦女神，背负白金日轮，所到之处赤地千里。烈日、焦土、赤地三个阶段：日轮扫射、召来沙魇、吸干泉水。躲进阴影里能少受日晒。"),
                // ── 第二章 · 北冥昆仑 ──
                ["frost_crab"] = (2, "巨钳竖在脸前当墙、横着走的坦克，夹击甩人、横扫冲击环；血量低时巨钳碎裂。弱点：背后的鳃缝。"),
                ["ice_puffer"] = (2, "飘近之后俯冲、鼓气炸开，留下减速冻雾。整个身体都是弱点，鼓气时还会变大。"),
                ["jiaoren"] = (2, "先远投骨矛、再成群突刺的鲛人。弱点：额头的鲛珠，死后会掉下一点回复。"),
                ["xingxing"] = (2, "四足狂奔、跳砸冰环、攀上高台，够不着就抛冰块。弱点：额头冰晶。"),
                ["xuangui"] = (2, "正面冰壳格挡，缩壳旋转撞墙反弹，过热时翻倒露出散热孔。平时弱点在身后的蛇头。"),
                ["fox_witch"] = (2, "躲在同伴身后立冰壁、结霜甲，用照妖镜放冻结光束。打碎她的铜镜，她就只能放追踪狐火。"),
                ["fuzhu"] = (2, "精准远程。远远踱步，蓄力射出直线冰光，光下的地面结冰打滑；被逼近就后跳拉开。弱点：胸口冰晶。"),
                ["haozhi"] = (2, "刨地冲锋，冲到近前急停竖刺，炸出一圈冰刺后自毁，留下残刺阵。弱点：背上的刺冠。"),
                ["ice_whale"] = (2, "炮兵。喷气孔胀亮后喷出冰柱，落点长出挡路的冰棱阵；贴近会昂身拍击。弱点：头顶喷气孔。"),
                ["lantern_jelly"] = (2, "漂浮的辅助，光触须连着同伴为它们回血；靠近会放一圈冻电。打它的灯芯能把连线全部打断。"),
                ["qingniao"] = (2, "在高处盘旋，冰羽横排扇射，掉血时俯冲换位，飞累了落到柱顶歇脚。弱点：胸口霜晶。"),
                ["boss_kunpeng"] = (2, "第二章首领。《庄子》北冥之鱼，化而为鸟：先是冰窟里的鲲，吞吸、猛砸掀冰浪、从脚下破冰潜袭；半血之后化而为鹏，转到空中作战。"),
                // ── 第三章 · 祝融炉心 ──
                ["huodou"] = (3, "食火吐火的黑犬，三四只包抄扑咬；吃掉地上的火会变大，吃过火才吐火。弱点：两侧肋间的熔火腹。"),
                ["tantong"] = (3, "一米来高的炭块小孩，成群扑抓、抛炭；死后碎成余烬，不补刀会复燃。弱点：头顶的烛芯火苗。"),
                ["fire_crow"] = (3, "成群盘旋，轮流点火俯冲撞地爆炸；在空中打爆会炸到同伴。一枪即死。"),
                ["firecracker"] = (3, "远远一窝蜂齐射，近身撒地老鼠；引信烧着时打它的火药仓能让它哑炸。弱点：腹部铜火药仓。"),
                ["founder"] = (3, "躲在同伴身后往它们身上浇铜甲，近身泼铜；背上的坩埚被打裂就不再浇。弱点：坩埚里的熔铜。"),
                ["iron_ox"] = (3, "照镇河铁牛铸成的炉牛，铁甲极硬；胸口炉门只在鼓风吸气、呛火跪倒时敞开——那是打进炉膛的时机。"),
                ["mamian"] = (3, "马头狱卒，甩出勾魂索把人拖到身前；射断链子、跳起或冲刺都能挣脱。锁芯被打坏后改用双拳肉搏。"),
                ["nuo"] = (3, "跳火傩给附近同伴加赤 / 黑 / 金三张脸之一的光环，隔一阵变一次脸。弱点：傩面，只能从正面打。"),
                ["bifang"] = (3, "独脚火鹤，单足立在柱顶高台，「毕—方」两声：一声瞄准、一声射出火矛。打它的腿能让它摔下来。弱点：喙里的炭火。"),
                ["tuo"] = (3, "熔岩河里的巨鳄，背负玄武岩甲，潜熔游动、岸边扑咬、甩尾扫人。弱点：脊背的熔岩接缝。"),
                ["boss_warlord"] = (3, "铸范大坊的领主，熔火深渊的统帅。一身玄铁甲、角盔、一柄焰刃：烈焰冲锋、火焰横扫、陨石雨、跃击、焰刃连斩。"),
                ["boss_qilin"] = (3, "终章首领，祝融炉心的守炉神兽。玄鳞形态踏火奔驰、张鳞、饮熔回甲——打断锁链让巨鼎砸下能崩碎它的鳞甲；血量过半后化为焚身。"),
            };

            public static int Chapter(string id) => id != null && table.TryGetValue(id, out var v) ? v.chapter : 0;
            public static string Text(string id) => id != null && table.TryGetValue(id, out var v) ? v.text : null;
        }
    }
}
