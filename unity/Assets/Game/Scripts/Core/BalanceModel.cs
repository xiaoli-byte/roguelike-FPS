using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// I3 平衡模型（docs/balance.md；EditMode 测试 BalanceModelTests 守着）：把经济、魂晶、首领用时、逐关难度放到同一组假设上算。
    ///   · 编制：<see cref="Stages"/> 是 9 张开放大图的实际遭遇（从场景里的 EncounterSite 统计，测试逐关对照场景文件），
    ///     首领场只算首领本身 + <see cref="BossStageAdds"/> 只杂兵；
    ///   · 参考秒伤：<see cref="ReferenceDps"/> = 武器裸秒伤 90 × 装备倍率（1 + 1.15 ×（难度 − 1））× 武器之外 1.6 × 输出占比 0.8——
    ///     敌人耐久 × 难度，玩家的品质、强化、秘卷跟着长，长得比难度略快；四个首领、九张大图都用这一条曲线核对。
    ///     曲线按首领浸泡（BossSoakSuite）的实测校准：四个首领可选中时的实测秒伤（<see cref="BossBalance.Soak"/>）和 <see cref="TargetableDps"/> 差 ±12% 以内
    ///     （BalanceModelTests 守着 ±15%）；校准前是「秒伤带中位 75 × 装备倍率 × 0.75」，没算技能、灼烧跳伤、英雄被动和暴击，只有实测的一半；
    ///   · 装备计划：<see cref="Gear"/> 是每个首领前「正常玩」能拿到的武器（宝箱保底的品质、沿途的强化奖励、补给营里花钱的强化），
    ///     它的倍率要贴着参考曲线（±15%），花钱的那部分要在补给营的预算里；
    ///   · 补给营：三家店（1-3 末段、2-4 门外、3-4 门外）的预算 = 上一家店之后挣到的灵石，要够买计划里的强化和一瓶药，又买不下整店的货。
    /// 只算期望值：不含商店消费以外的花销、灵宠、灵石获取天赋（投影里另给）、炭童复燃和蜃楼蟾分身这类不掉落的单位。
    /// </summary>
    public static class BalanceModel
    {
        // ───────────── 参考秒伤 ─────────────

        /// <summary>
        /// 主力武器的裸秒伤（普通、身体、含换弹、不含暴击、不含元素克制）：裂风步枪实测 89.4（weapon-dps），首领浸泡用的就是它；
        /// 18 把的实测裸秒伤中位约 86，Three.js 秒伤带 60–90 的上沿。校准前取带中位 75
        /// </summary>
        public const float BaseDps = 90f;
        /// <summary>难度每 +1 的装备成长（品质、强化、秘卷合计）；真正在输出的时间占比（躲招、换位、转火扣掉，同 <see cref="BossBalance.Uptime"/>，校准前 0.75）</summary>
        public const float GearGrowth = 1.15f, Uptime = BossBalance.Uptime;
        /// <summary>
        /// 武器之外的输出（I3 首领浸泡拟合）：技能、灼烧等持续伤害、英雄被动（浸泡里武器伤害只占 66–82%）× 随机暴击（暴击率 9–13%）。
        /// 四个首领的实测 ÷（90 × 装备倍率）= 1.58 / 1.82 / 1.51 / 1.57，几何平均 1.61
        /// </summary>
        public const float KitMult = 1.6f;
        /// <summary>
        /// 首领击杀用时（docs/unity-parity.md 7.4）、一张开放大图纯输出的目标带（秒）。大图的带按 1-1 锚定：1-1 是第一张图、节奏的标杆，
        /// slice11 实测四处遭遇合计 45 s（5 / 8 / 12 / 20 s），本模型算 1-1 约 48 s；其余大图在 1-1 的 0.75–1.6 倍以内（少于 35 s 打得太薄，多于 75 s 拖沓）。
        /// 校准前的带是 70–150 s，同样是 1-1 的 0.7–1.5 倍，只是秒伤低估了一半
        /// </summary>
        public const float BossMinSeconds = 60f, BossMaxSeconds = 120f, FieldMinSeconds = 35f, FieldMaxSeconds = 75f;
        /// <summary>装备计划贴着参考曲线的容差、首领用时要扛住的秒伤偏差（构筑好坏）</summary>
        public const float GearTolerance = 0.15f, DpsSpread = 0.15f;

        /// <summary>某难度下的装备倍率：1 + 1.15 ×（难度 − 1）</summary>
        public static float GearMult(float difficulty) => 1 + GearGrowth * (Mathf.Max(1f, difficulty) - 1);

        /// <summary>某难度下主力武器的身体秒伤（装备后、不含暴击、不含技能）</summary>
        public static float BodyDps(float difficulty) => BaseDps * GearMult(difficulty);

        /// <summary>某难度下目标可选中、一直在打时的秒伤（武器 + 技能 + 持续伤害 + 被动 + 暴击）：对应首领浸泡的「可选中时秒伤」，1-4 约 223、2-4 约 356、3-3 约 462、3-4 约 488</summary>
        public static float TargetableDps(float difficulty) => BodyDps(difficulty) * KitMult;

        /// <summary>某难度下的参考秒伤（实际打在目标上的平均秒伤，扣掉躲招换位）：1-4 约 179、2-4 约 285、3-3 约 370、3-4 约 391</summary>
        public static float ReferenceDps(float difficulty) => TargetableDps(difficulty) * Uptime;

        // ───────────── 编制表 ─────────────

        /// <summary>一种敌人在一关里的只数、其中写定的精英只数</summary>
        public readonly struct Squad
        {
            public readonly string enemy;
            public readonly int count, elites;

            public Squad(string enemy, int count, int elites)
            {
                this.enemy = enemy;
                this.count = count;
                this.elites = elites;
            }

            public override string ToString() => elites > 0 ? $"{enemy}×{count}（精英 {elites}）" : $"{enemy}×{count}";
        }

        /// <summary>一张开放大图的编制：全部遭遇场地合计、精英升格只数、灵石窖藏数、强化奖励数（场地宝箱 + 窖藏）</summary>
        public sealed class StageLoad
        {
            public readonly string code;
            public readonly int promote, coinCaches, upgrades;
            public readonly Squad[] squads;

            public StageLoad(string code, int promote, int coinCaches, int upgrades, params Squad[] squads)
            {
                this.code = code;
                this.promote = promote;
                this.coinCaches = coinCaches;
                this.upgrades = upgrades;
                this.squads = squads;
            }

            public int Kills
            {
                get
                {
                    int n = 0;
                    foreach (var s in squads) n += s.count;
                    return n;
                }
            }
        }

        static Squad S(string enemy, int count, int elites = 0) => new(enemy, count, elites);

        /// <summary>
        /// 九张开放大图的实际编制（2026-10-30 按场景统计；BalanceModelTests 逐关对照场景文件，改了遭遇要同步这里）。
        /// 首领场（1-4 / 2-4 / 3-4）不在表里；3-3 末尾的熔心魔将另算（<see cref="LordOf"/>）
        /// </summary>
        public static readonly StageLoad[] Stages =
        {
            new("1-1", 0, 1, 1, S("tomb_beast", 2, 1), S("apsara", 1), S("jerboa_blade", 17), S("scorpion_archer", 5, 1), S("fire_rat", 6), S("mirage_toad", 3), S("sand_wraith", 1)),
            new("1-2", 1, 1, 1, S("jerboa_blade", 16), S("scorpion_archer", 8, 1), S("fire_rat", 9), S("tomb_beast", 2, 1), S("mirage_toad", 2), S("apsara", 3), S("sand_wraith", 2)),
            new("1-3", 1, 0, 1, S("tomb_beast", 3, 1), S("jerboa_blade", 17), S("scorpion_archer", 8, 1), S("apsara", 2), S("fire_rat", 8), S("mirage_toad", 3), S("sand_wraith", 3)),
            new("2-1", 1, 1, 1, S("xuangui", 1), S("jiaoren", 16), S("qingniao", 4), S("frost_crab", 2, 1), S("lantern_jelly", 3), S("fuzhu", 5, 1), S("haozhi", 5), S("xingxing", 10),
                S("fox_witch", 2), S("ice_puffer", 3), S("ice_whale", 1)),
            new("2-2", 1, 0, 1, S("xingxing", 21), S("qingniao", 7), S("fuzhu", 4, 1), S("haozhi", 8), S("xuangui", 2, 1), S("fox_witch", 2)),
            new("2-3", 1, 1, 1, S("jiaoren", 14), S("ice_puffer", 6), S("fuzhu", 6, 1), S("fox_witch", 2), S("xingxing", 5), S("qingniao", 3), S("xuangui", 1, 1), S("haozhi", 6),
                S("lantern_jelly", 3), S("frost_crab", 1)),
            new("3-1", 1, 0, 1, S("tuo", 1), S("tantong", 21), S("huodou", 10), S("mamian", 5, 1), S("fire_crow", 7), S("firecracker", 4, 1), S("bifang", 3)),
            new("3-2", 1, 1, 1, S("firecracker", 4), S("tantong", 20), S("mamian", 6, 1), S("huodou", 10), S("bifang", 2), S("fire_crow", 6), S("iron_ox", 1, 1)),
            new("3-3", 1, 0, 1, S("tuo", 1), S("tantong", 20), S("firecracker", 4), S("mamian", 2), S("founder", 1), S("bifang", 1), S("huodou", 4), S("nuo", 1), S("fire_crow", 3),
                S("iron_ox", 2, 1)),
        };

        /// <summary>首领场里随首领出来的杂兵（召唤的沙魇、炭童、飞鸦……）按这么多只普通单位算</summary>
        public const int BossStageAdds = 8;
        /// <summary>精英的生命倍率（同 EnemyAI.Spawn）、无属性打护甲的倍率（DamageTable）</summary>
        public const float EliteHpMult = 2.6f, ArmorMult = 0.75f;

        public static StageLoad Load(string code)
        {
            foreach (var s in Stages)
                if (s.code == code)
                    return s;
            return null;
        }

        /// <summary>首领场的首领 id（1-4 旱魃、2-4 鲲鹏、3-4 火麒麟）；开放大图 null</summary>
        public static string BossOf(StageSpec s) => s == null || !s.IsBoss ? null : s.chapter switch { 1 => HanbaDef.Id, 2 => KunPengDef.Id, _ => QilinDef.Id };

        /// <summary>开放大图末尾的领主（3-3 熔心魔将）；没有为 null</summary>
        public static string LordOf(StageSpec s) => s != null && s.code == "3-3" ? WarlordDef.Id : null;

        // ───────────── 逐关估算 ─────────────

        /// <summary>一关的期望收支（灵石已乘章节系数、未乘灵石获取）</summary>
        public struct StageEstimate
        {
            public StageSpec stage;
            public int kills;
            /// <summary>精英只数（升格按期望，可以是小数）</summary>
            public float elites;
            public float killCoins, cacheCoins, bossCoins, essence;
            /// <summary>杂兵总有效耐久（生命 + 护甲 ÷ 0.75 + 护盾，精英 × 2.6，已 × 难度）、按参考秒伤打完的秒数（开放大图）</summary>
            public float fieldEhp, fieldSeconds;
            public float Coins => killCoins + cacheCoins + bossCoins;
        }

        /// <summary>某一关的估算（RunPlan 里的关；不在表里的开放大图按空编制）</summary>
        public static StageEstimate Estimate(StageSpec s, int bossStageAdds = BossStageAdds)
        {
            var e = new StageEstimate { stage = s };
            int ch = s.chapter - 1;
            float killMult = EconomyConfig.KillChapterMult(ch);
            if (s.IsBoss)
            {
                e.kills = bossStageAdds + 1;
                e.killCoins = bossStageAdds * AverageNormalCoins(ch) * killMult;
                e.essence = bossStageAdds * KillResolver.DefaultEssence;
                AddBoss(ref e, BossOf(s), ch);
            }
            else
            {
                var load = Load(s.code);
                if (load != null) AddField(ref e, load, s.difficulty, killMult);
                e.cacheCoins = (load?.coinCaches ?? 0) * (EconomyConfig.ChestCoinsMin + EconomyConfig.ChestCoinsMax) * 0.5f * EconomyConfig.RewardChapterMult(ch);
                if (LordOf(s) is { } lord) AddBoss(ref e, lord, ch);
                e.fieldSeconds = e.fieldEhp / ReferenceDps(s.difficulty);
            }
            e.essence += EconomyConfig.EssencePerStage;
            return e;
        }

        static void AddField(ref StageEstimate e, StageLoad load, float difficulty, float killMult)
        {
            // 升格：每只按耐久加权从普通单位里抽一只升为精英（同 EncounterSpec.Promote 的「重型优先」：耐久加权、冲锋型 × 1.5），取期望
            float heft = 0;
            foreach (var q in load.squads)
                if (EnemyRoster.Get(q.enemy) is { } d && q.count > q.elites)
                    heft += Heft(d) * (q.count - q.elites);
            foreach (var q in load.squads)
            {
                var def = EnemyRoster.Get(q.enemy);
                if (def == null) continue;
                int normals = q.count - q.elites;
                float up = heft > 0 ? Mathf.Min(normals, load.promote * Heft(def) * normals / heft) : 0;
                e.kills += q.count;
                Kill(ref e, def, q.elites + up, true, difficulty, killMult);
                Kill(ref e, def, normals - up, false, difficulty, killMult);
            }
        }

        static void Kill(ref StageEstimate e, EnemyDef def, float n, bool elite, float difficulty, float killMult)
        {
            if (n <= 0) return;
            if (elite) e.elites += n;
            float coins = (def.coins.x + def.coins.y) * 0.5f * (elite ? EconomyConfig.EliteKillCoinMult : 1);
            e.killCoins += n * coins * killMult;
            e.essence += n * KillResolver.EssenceFor(def, elite ? Rank.Elite : Rank.Normal);
            e.fieldEhp += n * Bulk(def) * (elite ? EliteHpMult : 1) * difficulty;
        }

        static void AddBoss(ref StageEstimate e, string id, int ch)
        {
            var def = id != null ? Bosses.Get(id) : null;
            Vector2Int coins = def?.rewards != null ? def.rewards.coins : new Vector2Int(EconomyConfig.BossCoinsMin, EconomyConfig.BossCoinsMax);
            if (coins.y <= 0) coins = new Vector2Int(EconomyConfig.BossCoinsMin, EconomyConfig.BossCoinsMax);
            e.bossCoins += (coins.x + coins.y) * 0.5f * EconomyConfig.KillChapterMult(ch);
            e.essence += def?.rewards is { essence: > 0 } r ? r.essence : KillResolver.BossEssence;
        }

        /// <summary>有效耐久：生命 + 护甲 ÷ 0.75（无属性打护甲）+ 护盾</summary>
        static float Bulk(EnemyDef d) => d.hp + d.armor / ArmorMult + d.shield;

        /// <summary>升格权重：耐久，冲锋型再 × 1.5（同 EncounterSpec.Heft）</summary>
        static float Heft(EnemyDef d) => Mathf.Max(1, d.hp + d.armor + d.shield) * (d.charger ? 1.5f : 1);

        /// <summary>某章编制里普通单位的平均击杀灵石（首领场杂兵用）：取这一章三张大图的平均</summary>
        static float AverageNormalCoins(int ch)
        {
            float sum = 0;
            int n = 0;
            foreach (var s in RunPlan.Stages)
            {
                if (s.chapter - 1 != ch || s.IsBoss || Load(s.code) is not { } load) continue;
                foreach (var q in load.squads)
                    if (EnemyRoster.Get(q.enemy) is { } def)
                    {
                        sum += (def.coins.x + def.coins.y) * 0.5f * q.count;
                        n += q.count;
                    }
            }
            return n > 0 ? sum / n : 3f;
        }

        /// <summary>整局 12 关的估算（主线顺序）</summary>
        public static List<StageEstimate> EstimateRun(int bossStageAdds = BossStageAdds)
        {
            var list = new List<StageEstimate>();
            foreach (var s in RunPlan.Stages) list.Add(Estimate(s, bossStageAdds));
            return list;
        }

        // ───────────── 魂晶 ─────────────

        /// <summary>天赋全部升满的总价（10 项 × 1130 = 11300）</summary>
        public static int TalentTotal
        {
            get
            {
                int sum = 0;
                foreach (var t in TalentLibrary.All) sum += t.TotalCost;
                return sum;
            }
        }

        /// <summary>打到某一关（含）为止的魂晶：通关 = 最后一关 + 胜利奖励；阵亡 = 前面清掉的关 + 这一关的一半击杀（不含清关 +10）</summary>
        public static float RunEssence(string diedAt = null)
        {
            float sum = 0;
            foreach (var e in EstimateRun())
            {
                if (diedAt != null && e.stage.code == diedAt) return sum + (e.essence - EconomyConfig.EssencePerStage) * 0.5f;
                sum += e.essence;
            }
            return sum + MetaSave.VictoryEssenceBonus;
        }

        // ───────────── 装备计划与补给营 ─────────────

        /// <summary>首领前的装备计划：武器品质、强化等级（其中在补给营花钱买的级数）、秘卷伤害加成</summary>
        public readonly struct GearPlan
        {
            public readonly string before;
            public readonly int rarity, level, paidLevels;
            public readonly float scrollDamage;
            public readonly string why;

            public GearPlan(string before, int rarity, int level, int paidLevels, float scrollDamage, string why)
            {
                this.before = before;
                this.rarity = rarity;
                this.level = level;
                this.paidLevels = paidLevels;
                this.scrollDamage = scrollDamage;
                this.why = why;
            }

            public float Mult => WeaponLibrary.RarityDamage[Rarity.Clamp(rarity)] * (1 + WeaponLibrary.UpgradeStep * level) * (1 + scrollDamage);
        }

        /// <summary>
        /// 每个首领前「正常玩」的装备：品质取宝箱保底（第一章精英场保底精良、旱魃保底史诗、鲲鹏起保底传说），
        /// 强化先用沿途的强化奖励（每张大图一次），不够的在补给营买；换枪会丢掉强化，所以只算换上主力以后的那几次
        /// </summary>
        public static readonly GearPlan[] Gear =
        {
            new("1-4", Rarity.Uncommon, 3, 0, 0f, "第一章精英场保底精良；1-1 / 1-2 / 1-3 各一次强化奖励"),
            new("2-4", Rarity.Epic, 4, 1, 0.05f, "旱魃保底史诗；2-1 / 2-2 / 2-3 三次强化奖励 + 2-4 门外补给营买一级；第二章两三张伤害秘卷"),
            new("3-3", Rarity.Legendary, 3, 0, 0.1f, "鲲鹏保底传说；3-1 / 3-2 / 3-3 三次强化奖励（3-3 的窖藏在领主战之前）"),
            new("3-4", Rarity.Legendary, 4, 1, 0.1f, "3-4 门外补给营再买一级"),
        };

        /// <summary>一家补给营：在哪一关、预算从哪一关之后算起、为哪个首领备战（对应 <see cref="Gear"/> 的 before）</summary>
        public readonly struct Camp
        {
            public readonly string at, after, gear;

            public Camp(string at, string after, string gear)
            {
                this.at = at;
                this.after = after;
                this.gear = gear;
            }

            public int Chapter => (RunPlan.Get(at)?.chapter ?? 1) - 1;
        }

        /// <summary>三家补给营（RunPlan.supplyCamp）：1-3 末段（预算含 1-3，为旱魃备战）、2-4 门外和 3-4 门外（预算不含本关首领）</summary>
        public static readonly Camp[] Camps = { new("1-3", null, "1-4"), new("2-4", "1-3", "2-4"), new("3-4", "2-4", "3-4") };

        /// <summary>到这家店时，上一家店之后挣到的灵石（期望，不含上一家店剩下的）</summary>
        public static float CampBudget(Camp camp, float coinGainPct = 0)
        {
            float sum = 0;
            bool counting = camp.after == null;
            float gain = Mathf.Max(0.05f, 1 + coinGainPct);
            foreach (var e in EstimateRun())
            {
                var s = e.stage;
                if (counting)
                {
                    if (s.code == camp.at)
                    {
                        if (!s.IsBoss) sum += e.Coins * gain;
                        break;
                    }
                    sum += e.Coins * gain;
                }
                else if (s.code == camp.after)
                {
                    counting = true;
                    // 上一家店在首领门外（2-4）：那一关的首领灵石是逛完店之后才挣的，算进下一家店的预算
                    if (s.IsBoss) sum += e.bossCoins * gain;
                }
            }
            return sum;
        }

        /// <summary>这家店要花的钱：计划里在这里买的强化 + 一瓶战备药剂</summary>
        public static int CampPlanned(Camp camp)
        {
            int ch = camp.Chapter;
            int cost = ShopPricing.Potion(ch);
            foreach (var g in Gear)
            {
                if (g.before != camp.gear) continue;
                for (int lv = g.level - g.paidLevels; lv < g.level; lv++) cost += UpgradeCost(lv, ch);
            }
            return cost;
        }

        /// <summary>整店货价的期望（进店时）：两把武器（左边按章节稀有度表、右边带保底）、1.5 张秘卷（按稀有）、药剂、弹药箱、主力从进店时的等级强化到满级</summary>
        public static float ShelfValue(Camp camp)
        {
            int ch = camp.Chapter;
            float w1 = ExpectedWeaponPrice(ch, Rarity.Common), w2 = ExpectedWeaponPrice(ch, ch >= 1 ? Rarity.Rare : Rarity.Uncommon);
            float scrolls = 1.5f * ShopPricing.Scroll(Rarity.Rare, ch);
            int level = 0;
            foreach (var g in Gear)
                if (g.before == camp.gear)
                    level = g.level - g.paidLevels;
            float upgrades = 0;
            for (int lv = level; lv < WeaponLibrary.MaxUpgrade; lv++) upgrades += UpgradeCost(lv, ch);
            return w1 + w2 + scrolls + ShopPricing.Potion(ch) + ShopPricing.Ammo(ch) + upgrades;
        }

        static int UpgradeCost(int level, int chapter) => Mathf.FloorToInt(WeaponLibrary.UpgradeBaseCost * (level + 1) * (1 + WeaponLibrary.UpgradeChapterStep * chapter) + 0.5f);

        static float ExpectedWeaponPrice(int chapter, int minRarity)
        {
            float total = 0, sum = 0;
            for (int r = 0; r < Rarity.Count; r++)
            {
                float w = WeaponRoller.RarityWeight(chapter, r, 0, minRarity);
                total += w;
                sum += w * ShopPricing.Weapon(r, chapter);
            }
            return total > 0 ? sum / total : 0;
        }

        // ───────────── 首领 ─────────────

        /// <summary>首领在本场难度、参考秒伤 × dpsScale 下的击杀用时（秒），用各自的定档模型算</summary>
        public static float BossSeconds(string bossId, float dpsScale = 1f)
        {
            switch (bossId)
            {
                case HanbaDef.Id:
                {
                    // 旱魃是逐招模拟：保留中位打法的瞄准 / 暴击 / 弱点比例，只把身体秒伤换成参考曲线
                    var p = HanbaBalance.Mid;
                    p.bodyDps = ReferenceDps(HanbaDef.StageDifficulty) * dpsScale / p.aim;
                    return HanbaBalance.Average(new HanbaDef(), p, 8).mean;
                }
                case KunPengDef.Id:
                    return KunPengBalance.KillSeconds(new KunPengDef(), KunPengDef.StageDifficulty, ReferenceDps(KunPengDef.StageDifficulty) * dpsScale);
                case WarlordDef.Id:
                {
                    float own = WarlordBalance.ReferenceDps(WarlordDef.StageDifficulty) * WarlordBalance.Uptime;
                    return WarlordBalance.KillSeconds(new WarlordDef(), WarlordDef.StageDifficulty, ReferenceDps(WarlordDef.StageDifficulty) * dpsScale / own);
                }
                case QilinDef.Id:
                {
                    var v = new QilinDef().VitalsAt(QilinDef.StageDifficulty);
                    return QilinDef.EstimateKillSeconds(v, ReferenceDps(QilinDef.StageDifficulty) * dpsScale, 1);
                }
                default:
                    return 0;
            }
        }

        /// <summary>四个首领（按出场顺序）</summary>
        public static readonly string[] BossIds = { HanbaDef.Id, KunPengDef.Id, WarlordDef.Id, QilinDef.Id };

        // ───────────── 报告 ─────────────

        /// <summary>整份推演（日志 / 调试命令 balance / docs/balance.md 的数字来源）</summary>
        public static string Report()
        {
            var sb = new StringBuilder();
            sb.AppendLine("[Balance] 逐关估算（期望值，灵石已乘章节系数）");
            sb.AppendLine("关 | 难度 | 击杀 | 精英 | 击杀灵石 | 窖藏灵石 | 首领灵石 | 灵石 | 累计 | 魂晶 | 累计魂晶 | 杂兵耐久 | 参考秒伤 | 战斗用时");
            float coins = 0, essence = 0;
            foreach (var e in EstimateRun())
            {
                coins += e.Coins;
                essence += e.essence;
                var s = e.stage;
                sb.AppendLine($"{s.code} | {s.difficulty:0.00} | {e.kills} | {e.elites:0.#} | {e.killCoins:0} | {e.cacheCoins:0} | {e.bossCoins:0} | {e.Coins:0} | {coins:0} | " +
                              $"{e.essence:0} | {essence:0} | {e.fieldEhp:0} | {ReferenceDps(s.difficulty):0} | {(s.IsBoss ? "—" : e.fieldSeconds.ToString("0"))}");
            }
            sb.AppendLine($"[Balance] 魂晶：通关一局 {RunEssence():0}（含胜利 {MetaSave.VictoryEssenceBonus}）；1-4 阵亡 {RunEssence("1-4"):0}、2-4 阵亡 {RunEssence("2-4"):0}、3-4 阵亡 {RunEssence("3-4"):0}；" +
                          $"天赋总价 {TalentTotal}，约 {TalentTotal / Mathf.Max(1, RunEssence()):0.0} 次通关");
            sb.AppendLine("[Balance] 装备计划 | 倍率 | 参考曲线 | 偏差");
            foreach (var g in Gear)
            {
                float want = GearMult(RunPlan.Get(g.before).difficulty);
                sb.AppendLine($"{g.before} 前：{Rarity.Name(g.rarity)} +{g.level}（买 {g.paidLevels} 级），秘卷 +{g.scrollDamage:P0} | ×{g.Mult:0.00} | ×{want:0.00} | {g.Mult / want - 1:+0%;-0%}");
            }
            sb.AppendLine("[Balance] 补给营 | 预算 | 计划花销 | 整店货价 | 预算 / 整店");
            foreach (var c in Camps)
            {
                float budget = CampBudget(c), shelf = ShelfValue(c);
                sb.AppendLine($"{c.at} | {budget:0} | {CampPlanned(c)} | {shelf:0} | {budget / shelf:P0}");
            }
            sb.AppendLine("[Balance] 参考曲线 vs 首领浸泡 | 难度 | 曲线可选中时秒伤 | 浸泡实测 | 曲线 / 实测");
            foreach (var (stage, d, dps) in BossBalance.Soak)
                sb.AppendLine($"{stage} | {d:0.00} | {TargetableDps(d):0} | {dps:0} | {TargetableDps(d) / dps:0.00}");
            sb.AppendLine("[Balance] 首领 | 难度 | 参考秒伤 | 击杀用时（秒伤 × 0.85 / 1 / 1.15）");
            foreach (var id in BossIds)
            {
                float d = StageDifficultyOf(id);
                sb.AppendLine($"{id} | {d:0.00} | {ReferenceDps(d):0} | {BossSeconds(id, 1 - DpsSpread):0} / {BossSeconds(id):0} / {BossSeconds(id, 1 + DpsSpread):0} s");
            }
            return sb.ToString();
        }

        /// <summary>首领所在关的难度</summary>
        public static float StageDifficultyOf(string bossId) => bossId switch
        {
            HanbaDef.Id => HanbaDef.StageDifficulty,
            KunPengDef.Id => KunPengDef.StageDifficulty,
            WarlordDef.Id => WarlordDef.StageDifficulty,
            QilinDef.Id => QilinDef.StageDifficulty,
            _ => 1f,
        };
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>把整份平衡推演打到日志（I3）：DevCommands.Run("balance")</summary>
    [Defs]
    public sealed class BalanceReportCommand : DevCommand
    {
        public override string Id => "balance";
        public override string Label => "平衡推演";
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            Debug.Log(BalanceModel.Report());
            DevCommands.Say("平衡推演已写入日志");
        }
    }
#endif
}
