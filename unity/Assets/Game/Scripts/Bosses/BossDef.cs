using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>首领的三层耐久（某个难度下）：生命 / 护盾 / 护甲</summary>
    [Serializable]
    public struct BossVitals
    {
        public float hp, shield, armor;

        public BossVitals(float hp, float shield = 0, float armor = 0)
        {
            this.hp = hp;
            this.shield = shield;
            this.armor = armor;
        }

        /// <summary>三层合计</summary>
        public float Total => hp + shield + armor;

        public BossVitals Scaled(float k) => new(hp * k, shield * k, armor * k);

        public static BossVitals Lerp(BossVitals a, BossVitals b, float t) =>
            new(Mathf.Lerp(a.hp, b.hp, t), Mathf.Lerp(a.shield, b.shield, t), Mathf.Lerp(a.armor, b.armor, t));

        public override string ToString() => $"{hp:0} 生命 + {shield:0} 护盾 + {armor:0} 护甲";
    }

    /// <summary>
    /// 定档：某个难度下的三层数值（BS 单元按模拟秒伤定档，例如旱魃在 1-4 的难度 1.48 下约 4400 生命 + 2200 护盾）。
    /// 见 <see cref="BossDef.VitalsAt"/>：两个定档之间按难度线性插值，定档范围之外按难度等比外推
    /// </summary>
    [Serializable]
    public struct BossVitalsTier
    {
        public float difficulty;
        public BossVitals vitals;

        public BossVitalsTier(float difficulty, BossVitals vitals)
        {
            this.difficulty = difficulty;
            this.vitals = vitals;
        }
    }

    /// <summary>
    /// 一次阶段转换（Three.js BossBase.thresholds + onPhase / transitionTick）：生命层（不含护盾 / 护甲，与血条刻度一致）跌到 <see cref="at"/> 以下时，
    /// 等当前招式收尾（最多 <see cref="BossDef.phaseWait"/> 秒，之后强制打断并撤回预警），然后进入 <see cref="seconds"/> 秒的转换演出（不可选中、霸体）。
    /// 写了 <see cref="form"/> 就在演出的 <see cref="formSwapAt"/> 秒换形态（鲲 → 鹏、玄鳞 → 焚身）
    /// </summary>
    public sealed class BossPhaseDef
    {
        /// <summary>生命层比例阈值（0..1，降序排列）：跌到它以下进入下一阶段</summary>
        public float at = 0.5f;
        /// <summary>换成哪个形态（<see cref="BossFormDef.id"/>）；null / 空 = 不换形</summary>
        public string form;
        /// <summary>转换演出时长（秒），期间不可选中、霸体</summary>
        public float seconds = 2.4f;
        /// <summary>演出的第几秒换形（负数 = 演出时长的 40%，Three.js 鲲鹏在冰雾最浓的 1.55 / 4.6 s）</summary>
        public float formSwapAt = -1;
        /// <summary>演出动作（Animator 状态名；没有这个状态时不播，只打一次警告）</summary>
        public string anim = "roar";
        /// <summary>演出开始的音效 / 震屏强度（0 = 不震）</summary>
        public string sfx = "boss_roar";
        public float shake = 0.45f;
        /// <summary>演出开始时的提示（null = 不提示）</summary>
        public string toast;
        /// <summary>新阶段的喘息倍率（越小出招越密）</summary>
        public float restScale = 1f;
        /// <summary>演出结束后第一招（招式 id；null = 照常抽）</summary>
        public string firstMove;

        /// <summary>换形时刻（秒）：没写时取演出时长的 40%</summary>
        public float SwapAt => formSwapAt >= 0 ? Mathf.Min(formSwapAt, seconds) : seconds * 0.4f;
    }

    /// <summary>
    /// 生命刻度事件（不是阶段）：生命层第一次跌到 <see cref="at"/> 以下时调 <see cref="BossBrain.OnMark"/> 并派发 <see cref="BossBrain.Marked"/>。
    /// 例：火麒麟 85% / 70% 饮熔，鲲 75% 后连掀两道冰浪。<see cref="tick"/> = 血条上也画一道刻度
    /// </summary>
    public sealed class BossMark
    {
        public float at;
        public string id;
        public bool tick;
    }

    /// <summary>
    /// 形态（鲲 / 鹏、玄鳞 / 焚身…）：每个形态一个模型（同一个 Prefab 的形态共用一份模型，只换着色）、各自的弱点与命中区、换形时的护盾 / 护甲回复。
    /// 模型按顺序找：<see cref="prefab"/>（正式美术）→ <see cref="proxyPrefab"/> × <see cref="proxyScale"/>（美术缺失时的代理，4.11）→ 按首领尺寸的占位胶囊
    /// </summary>
    public sealed class BossFormDef
    {
        public string id;
        /// <summary>显示名后缀（血条标题「鲲鹏 · 鹏」）；null = 只显示首领名</summary>
        public string name;
        /// <summary>正式美术 Prefab（按名字在场景的敌人目录 / GameDatabase 里找）与体型倍率</summary>
        public string prefab;
        public float scale = 1f;
        /// <summary>美术缺失时的代理 Prefab 与体型倍率（例：旱魃先用 SK_Enemy_Apsara × 3.5）</summary>
        public string proxyPrefab;
        public float proxyScale = 1f;
        /// <summary>形态着色（乘在反照率上；代理体共用一个模型时靠它分辨形态）。白色 = 不着色</summary>
        public Color tint = Color.white;
        /// <summary>形态覆盖色（插值量 0 = 不覆盖），比 tint 更醒目</summary>
        public Color overlay = Color.white;
        public float overlayAmount;
        /// <summary>弱点：骨骼名（包含匹配，空 = 头骨）、偏移（骨骼本地）、半径（设计尺寸，随体型放大）</summary>
        public string weakBone;
        public Vector3 weakOffset;
        public float weakRadius = 0.5f;
        /// <summary>换成这个形态时护盾 / 护甲至少回到最大值的这个比例（鲲 → 鹏护盾重凝六成）</summary>
        public float shieldRestore, armorRestore;
        /// <summary>换成这个形态后的第一招（招式 id；null = 照常抽）</summary>
        public string firstMove;
        /// <summary>飞行形态（鹏、焚身踏云）：子类自己管高度，基类不做离网回收</summary>
        public bool flying;
    }

    /// <summary>
    /// 一个命中区（Three.js BossBase.hitShapes：挂在骨骼锚点上的球 / 竖直胶囊）：生成时在骨骼下建碰撞体 + <see cref="HitZone"/>。
    /// 尺寸都是设计尺寸（随体型放大）；<see cref="form"/> 不为空时只在那个形态启用
    /// </summary>
    public sealed class BossHitZoneDef
    {
        public string id;
        /// <summary>骨骼名（包含匹配；空 = 根节点）</summary>
        public string bone;
        public Vector3 offset;
        public float radius = 0.5f;
        /// <summary>&gt; 0 = 竖直胶囊（总高），0 = 球</summary>
        public float height;
        public float multiplier = 1f;
        public bool weak;
        public int priority = 1;
        public ZoneFacing facing = ZoneFacing.Any;
        /// <summary>累计伤害到这个值发 <see cref="HitZone.Broke"/>（0 = 不计）</summary>
        public float breakAt;
        /// <summary>只在这个形态启用（null = 所有形态）</summary>
        public string form;
    }

    /// <summary>
    /// 首领奖励（B2 的结算链读它：回满、保底武器宝箱、魂晶）。
    /// 击杀魂晶现在由 <see cref="KillResolver"/> 按「首领、没有敌人定义」给 <see cref="KillResolver.BossEssence"/>（60），这里的 <see cref="essence"/> 与它一致；
    /// 击杀灵石由 LootDirector 按级别掉（首领包 2 弹药 + 2 生命另算）
    /// </summary>
    public sealed class BossRewards
    {
        public int essence = KillResolver.BossEssence;
        /// <summary>击杀灵石区间（TS coins）</summary>
        public Vector2Int coins = new(EconomyConfig.BossCoinsMin, EconomyConfig.BossCoinsMax);
        /// <summary>结算宝箱的奖励串（LootDirector.Grant 的 key，档位按首领场写进去）与档位</summary>
        public string chest = "weapon";
        public ChestTier chestTier = ChestTier.Boss;
        /// <summary>倒下后回满玩家生命与护盾（B2 结算）</summary>
        public bool healPlayer = true;
    }

    /// <summary>登场（Three.js spawnDuration + entrance）：期间不可选中、霸体，招式的首次可用时间从登场结束算起</summary>
    public sealed class BossIntroDef
    {
        public float seconds = 2.6f;
        /// <summary>登场动作（Animator 状态名，没有就不播）与吼声</summary>
        public string anim = "roar";
        public string sfx = "boss_roar";
        public float shake = 0.45f;
        /// <summary>登场时打名字卡（大横幅：首领名 + 称号）。B2 的登场演出自己打名字卡时关掉</summary>
        public bool banner = true;
        /// <summary>登场结束后到第一次出招的喘息（秒）</summary>
        public float firstRest = 1.4f;
    }

    /// <summary>溃散（Three.js onDeath + updateDeathFx）：连串爆炸、最后一下大爆炸，召唤物一起崩解</summary>
    public sealed class BossDefeatDef
    {
        /// <summary>溃散演出时长（秒）：期间每 0.2 s 一团爆炸，第 88% 时最后一下大爆炸并隐去模型</summary>
        public float seconds = 3.2f;
        /// <summary>倒下瞬间的慢动作（时间缩放、真实秒数；scale ≥ 1 或秒数 0 = 不放慢）</summary>
        public float slowMo = 0.35f, slowMoSeconds = 0.6f;
        /// <summary>倒下时的提示（null = 不提示）</summary>
        public string toast;
        /// <summary>溃散演出结束后多久回收物体（秒）</summary>
        public float despawnAfter = 1.5f;
    }

    /// <summary>
    /// 首领定义（docs/unity-parity.md 4.3「首领」：阈值、形态列表、命中体、奖励、代理 Prefab）。一个首领一个文件 Bosses/&lt;Id&gt;/&lt;Id&gt;Def.cs，
    /// 写成 BossDef 的 [Defs] 子类（构造函数里填字段）或 <see cref="IDefSource{T}"/>，由 <see cref="Registry{T}"/> 收集，<see cref="Bosses.Spawn(string, BossArena, float, Transform)"/> 按它生成。
    /// 首领不进敌人名册（<see cref="EnemyRoster"/>）：名册的条数是契约（RegistryTests），测试场的敌人冒烟也逐个遍历名册；生成路径由 <see cref="Bosses"/> 自己负责，
    /// 占位体要的尺寸由 <see cref="ToEnemyDef"/> 转一份不登记的敌人定义。
    /// 血条（U3）的刻度与阶段阈值都从这里读（D23）：<see cref="BarTicks"/>。
    /// id 以 boss_ 开头（配乐按这个前缀切 boss 曲，同 Three.js 的 boss_kunpeng / boss_qilin）。
    /// </summary>
    public class BossDef : IDef
    {
        public string id;
        /// <summary>首领名（血条、名字卡）与称号（名字卡第二行 / 血条副标题）</summary>
        public string name, title;
        /// <summary>行为组件（<see cref="BossBrain"/> 或它的子类）</summary>
        public Type brain = typeof(BossBrain);

        // ───────────── 数值 ─────────────

        /// <summary>难度 1 的三层耐久（没有定档时按难度等比放大，同普通敌人 × 难度）</summary>
        public BossVitals vitals = new(1000);
        /// <summary>定档表（按难度升序）：有的话优先用它（见 <see cref="VitalsAt"/>）</summary>
        public readonly List<BossVitalsTier> tiers = new();
        /// <summary>基础伤害（难度 1；× (1 + (难度 − 1) × 0.55)，同 <see cref="EnemyAI.DamageMult"/>）与移速</summary>
        public float damage = 12f, speed = 5f;
        public Element element;
        /// <summary>主题色（溃散爆炸、预警、占位体）</summary>
        public Color color = Hex.Rgb(0xff8844);
        /// <summary>预警色（null = 主题色提亮）</summary>
        public Color? warnColor;

        // ───────────── 体型（设计尺寸，随形态体型放大）─────────────

        /// <summary>占位胶囊的半径 / 身高（模型没有角色胶囊时也用它）</summary>
        public float radius = 1f, height = 4f;

        // ───────────── 阶段 / 形态 / 命中体 ─────────────

        /// <summary>阶段转换（按 at 降序）：phases[i] 描述从第 i 阶段进入第 i + 1 阶段</summary>
        public readonly List<BossPhaseDef> phases = new();
        /// <summary>生命刻度事件（不是阶段）</summary>
        public readonly List<BossMark> marks = new();
        /// <summary>形态（forms[0] = 初始形态，至少一个）</summary>
        public readonly List<BossFormDef> forms = new();
        /// <summary>额外的命中区（弱点球之外：翼、尾、背甲…）</summary>
        public readonly List<BossHitZoneDef> hitZones = new();

        // ───────────── 招式调度 ─────────────

        /// <summary>招式工厂（每只首领生成时各 new 一份，招式对象带自己的计时）</summary>
        public readonly List<Func<BossMove>> moves = new();
        /// <summary>越过阈值后最多再等当前招式多久（秒，Three.js PHASE_WAIT），之后强制打断</summary>
        public float phaseWait = 2f;
        /// <summary>
        /// 不重复：刚出过的那一招的权重倍率（0 = 只要还有别的招可出就不连出同一招；Three.js 是 0.2）
        /// </summary>
        public float repeatWeight;
        /// <summary>招式间隙的走位：和玩家保持的距离带（米，世界尺寸）</summary>
        public float idleMinRange = 7f, idleMaxRange = 14f;
        /// <summary>只有招式间隙能被眩晕（Three.js 霸体规则）；false = 整场免疫眩晕</summary>
        public bool stunBetweenMoves = true;

        // ───────────── 狂怒 ─────────────

        /// <summary>登场结束后多少秒进入狂怒（0 = 没有计时狂怒）</summary>
        public float enrageAfter;
        /// <summary>生命层比例低于它进入狂怒（0 = 没有；火麒麟 0.15、鹏 0.25）</summary>
        public float enrageBelow;
        /// <summary>狂怒时的喘息 / 前摇倍率与伤害倍率</summary>
        public float enrageRestScale = 0.7f, enrageWindupScale = 0.85f, enrageDamageScale = 1.15f;
        public string enrageToast;

        // ───────────── 召唤 ─────────────

        /// <summary>同时在场（含正在预警）的召唤物上限</summary>
        public int summonCap = 6;

        // ───────────── 奖励 / 登场 / 溃散 ─────────────

        public BossRewards rewards = new();
        public BossIntroDef intro = new();
        public BossDefeatDef defeat = new();

        string IDef.Id => id;

        /// <summary>初始形态</summary>
        public BossFormDef FirstForm => forms.Count > 0 ? forms[0] : null;

        /// <summary>按 id 找形态（没有返回 null）</summary>
        public BossFormDef Form(string formId)
        {
            if (string.IsNullOrEmpty(formId)) return null;
            foreach (var f in forms)
                if (f != null && f.id == formId) return f;
            return null;
        }

        /// <summary>预警色：写了 <see cref="warnColor"/> 用它，否则主题色往白提亮一点</summary>
        public Color WarnColor => warnColor ?? Color.Lerp(color, Color.white, 0.25f);

        /// <summary>
        /// 某个难度下的三层耐久：有定档表时在相邻两档之间按难度线性插值，低于第一档 / 高于最后一档按难度等比外推；
        /// 没有定档表时 = <see cref="vitals"/> × 难度（同普通敌人）。难度非法时按 1
        /// </summary>
        public BossVitals VitalsAt(float difficulty)
        {
            float d = float.IsFinite(difficulty) && difficulty > 0 ? Mathf.Max(0.5f, difficulty) : 1f;
            if (tiers.Count == 0) return vitals.Scaled(d);
            var first = tiers[0];
            if (d <= first.difficulty || tiers.Count == 1)
            {
                var anchor = d <= first.difficulty ? first : tiers[^1];
                return anchor.vitals.Scaled(d / Mathf.Max(0.01f, anchor.difficulty));
            }
            for (int i = 1; i < tiers.Count; i++)
            {
                var a = tiers[i - 1];
                var b = tiers[i];
                if (d > b.difficulty) continue;
                float t = (d - a.difficulty) / Mathf.Max(1e-4f, b.difficulty - a.difficulty);
                return BossVitals.Lerp(a.vitals, b.vitals, t);
            }
            var last = tiers[^1];
            return last.vitals.Scaled(d / Mathf.Max(0.01f, last.difficulty));
        }

        /// <summary>
        /// 血条刻度（D23，降序、去重）：全部阶段阈值 + 标了 tick 的生命刻度。U3 的首领血条只读这里，不再写死一张表
        /// </summary>
        public IReadOnlyList<float> BarTicks
        {
            get
            {
                if (barTicks != null) return barTicks;
                var l = new List<float>();
                foreach (var p in phases)
                    if (p != null && p.at > 0 && p.at < 1)
                        l.Add(p.at);
                foreach (var m in marks)
                    if (m != null && m.tick && m.at > 0 && m.at < 1)
                        l.Add(m.at);
                l.Sort((a, b) => b.CompareTo(a));
                for (int i = l.Count - 1; i > 0; i--)
                    if (Mathf.Abs(l[i] - l[i - 1]) < 1e-4f)
                        l.RemoveAt(i);
                return barTicks = l;
            }
        }

        List<float> barTicks;

        /// <summary>阶段数（= 阈值个数 + 1）</summary>
        public int PhaseCount => phases.Count + 1;

        EnemyDef enemyDef;

        /// <summary>
        /// 转成一份<b>不登记</b>的敌人定义（占位体的尺寸与颜色、旧接口兼容）：数值是难度 1 的基础值，体型倍率 1（首领自己按形态放大）
        /// </summary>
        public EnemyDef ToEnemyDef()
        {
            if (enemyDef != null) return enemyDef;
            var f = FirstForm;
            return enemyDef = new EnemyDef
            {
                id = id, name = name, prefab = f?.prefab ?? "", hp = vitals.hp, shield = vitals.shield, armor = vitals.armor,
                speed = speed, damage = damage, knockbackResist = 1, scale = 1, weakBone = f?.weakBone, weakRadius = f?.weakRadius ?? 0.5f,
                ai = brain, rank = Rank.Boss, color = color, element = element, radius = radius, height = height,
                weakHeight = height * 0.85f, essence = rewards?.essence ?? KillResolver.BossEssence,
                coins = rewards?.coins ?? Vector2Int.zero,
            };
        }

        /// <summary>
        /// 自检（冒烟测试与生成前调用）：id / 名字、至少一个形态、阶段阈值在 (0, 1) 内严格降序、引用的形态和招式存在、招式工厂能造出带 id 的招式、行为类型可用。
        /// 返回问题列表（空 = 通过）
        /// </summary>
        public List<string> Validate()
        {
            var errs = new List<string>();
            if (string.IsNullOrWhiteSpace(id)) errs.Add("没有 id");
            else if (!id.StartsWith("boss", StringComparison.Ordinal)) errs.Add($"id「{id}」不以 boss 开头（配乐按这个前缀切 boss 曲）");
            if (string.IsNullOrWhiteSpace(name)) errs.Add("没有名字");
            if (brain == null || !typeof(BossBrain).IsAssignableFrom(brain) || brain.IsAbstract) errs.Add($"行为类型 {brain} 不是可实例化的 BossBrain");
            if (forms.Count == 0) errs.Add("没有形态（至少一个，forms[0] 是初始形态）");
            var formIds = new HashSet<string>();
            foreach (var f in forms)
            {
                if (f == null || string.IsNullOrEmpty(f.id)) errs.Add("有形态没有 id");
                else if (!formIds.Add(f.id)) errs.Add($"形态 id「{f.id}」重复");
                else if (!(f.scale > 0) || !(f.proxyScale > 0)) errs.Add($"形态 {f.id} 的体型倍率 ≤ 0");
            }
            float prev = 1f;
            foreach (var p in phases)
            {
                if (p == null)
                {
                    errs.Add("有空的阶段");
                    continue;
                }
                if (!(p.at > 0 && p.at < 1)) errs.Add($"阶段阈值 {p.at} 不在 (0, 1) 内");
                else if (!(p.at < prev)) errs.Add($"阶段阈值没有严格降序（{p.at} 在 {prev} 之后）");
                prev = Mathf.Min(prev, p.at);
                if (!(p.seconds >= 0)) errs.Add($"阶段 {p.at} 的演出时长 {p.seconds} 非法");
                if (!string.IsNullOrEmpty(p.form) && Form(p.form) == null) errs.Add($"阶段 {p.at} 要换的形态 {p.form} 不存在");
            }
            var moveIds = new HashSet<string>();
            foreach (var make in moves)
            {
                BossMove m = null;
                try
                {
                    m = make?.Invoke();
                }
                catch (Exception e)
                {
                    errs.Add($"招式工厂抛异常：{e.Message}");
                }
                if (m == null)
                {
                    errs.Add("有招式工厂返回 null");
                    continue;
                }
                if (string.IsNullOrEmpty(m.Id)) errs.Add($"招式 {m.GetType().Name} 没有 id");
                else if (!moveIds.Add(m.Id)) errs.Add($"招式 id「{m.Id}」重复");
                if (m.forms != null)
                    foreach (var fid in m.forms)
                        if (Form(fid) == null)
                            errs.Add($"招式 {m.Id} 限定的形态 {fid} 不存在");
            }
            if (moves.Count == 0) errs.Add("没有招式");
            foreach (var p in phases)
                if (p != null && !string.IsNullOrEmpty(p.firstMove) && !moveIds.Contains(p.firstMove))
                    errs.Add($"阶段 {p.at} 的第一招 {p.firstMove} 不存在");
            foreach (var f in forms)
                if (f != null && !string.IsNullOrEmpty(f.firstMove) && !moveIds.Contains(f.firstMove))
                    errs.Add($"形态 {f.id} 的第一招 {f.firstMove} 不存在");
            foreach (var z in hitZones)
                if (z != null && !string.IsNullOrEmpty(z.form) && Form(z.form) == null)
                    errs.Add($"命中区 {z.id} 限定的形态 {z.form} 不存在");
            for (int i = 1; i < tiers.Count; i++)
                if (!(tiers[i].difficulty > tiers[i - 1].difficulty))
                    errs.Add("定档表没有按难度严格升序");
            var v = VitalsAt(1);
            if (!(v.hp > 0) || !float.IsFinite(v.Total)) errs.Add($"难度 1 的耐久非法（{v}）");
            if (summonCap < 0) errs.Add("召唤上限 < 0");
            return errs;
        }
    }
}
