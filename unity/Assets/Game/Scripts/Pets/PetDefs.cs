using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>灵宠品阶（docs/pet-system.md 第 2 节）：凡灵 72% / 灵兽 25% / 神兽 3%</summary>
    public enum PetRarity { Common, Rare, Mythic }

    public static class PetRarities
    {
        public static readonly string[] Names = { "凡灵", "灵兽", "神兽" };
        public static readonly Color[] Colors = { new(0.85f, 0.85f, 0.85f), new(0.4f, 0.65f, 1f), new(1f, 0.32f, 0.3f) };
        static readonly float[] Weights = { 72, 25, 3 };
        /// <summary>神兽的金色（光柱、横幅、金光三连射）</summary>
        public static readonly Color Gold = new(1f, 0.8f, 0.35f);

        public static string Name(PetRarity r) => Names[(int)r];
        public static Color Color(PetRarity r) => Colors[(int)r];
        public static string Hex(PetRarity r) => ColorUtility.ToHtmlStringRGB(Colors[(int)r]);

        /// <summary>按权重抽品阶</summary>
        public static PetRarity Roll()
        {
            float total = 0;
            foreach (var w in Weights) total += w;
            float x = UnityEngine.Random.value * total;
            for (int i = 0; i < Weights.Length; i++)
            {
                if (x < Weights[i]) return (PetRarity)i;
                x -= Weights[i];
            }
            return PetRarity.Common;
        }
    }

    /// <summary>程序化占位体的轮廓（模型缺失时用简单几何拼出能认出来的剪影）</summary>
    public enum PetShape { Boar, Cat, SmallBird, Pheasant, Lion, Leopard, Sage, Dragon }

    /// <summary>一只灵宠的静态数据：名字与出处、形态、移动、外观配色、技能说明。具体数值写在各自的 <see cref="PetBehaviour"/> 里</summary>
    public sealed class PetDef
    {
        public string id, assetId, name, title, lore, role;
        public PetRarity rarity;
        public Element element;
        public bool flying;
        /// <summary>真实身高（米）：模型脚底在 y = 0、朝 +Z；占位体按它缩放</summary>
        public float height = 0.7f;
        public float moveSpeed = 9f;
        /// <summary>跟随位：玩家身后 followBack 米、侧向 followSide 米；飞行宠物离玩家脚底 flyHeight 米</summary>
        public float followBack = 3f, followSide = 1.2f, flyHeight = 2f;
        /// <summary>离地悬浮（白泽踏云）</summary>
        public float hover;
        public PetShape shape;
        /// <summary>占位体主色 / 点缀色；fx = 攻击特效色（凡灵白金、灵兽元素色、神兽金红）</summary>
        public Color body, accent, fx;
        public string attackDesc, passiveName, passiveDesc, skillName, skillDesc, awakenDesc;
        public float skillCooldown = 20f;
        /// <summary>
        /// 单独建模、可拆下的发光件（Resources/Pets/Parts/&lt;partId&gt;，PetArtImport 从 Assets/Art/Prefabs/Attachments 生成）挂在骨骼挂点 partSocket 上：
        /// 精卫口中的火石（投掷时藏起、0.6 秒后再衔一颗）、应龙爪中的宝珠（杀蚩尤时飞到头顶）。空 = 没有
        /// </summary>
        public string partId, partSocket;
        /// <summary>发光件的辉光色</summary>
        public Color partGlow = new(1f, 0.8f, 0.45f);
        public Func<PetBehaviour> create;

        public Color RarityColor => PetRarities.Color(rarity);
        /// <summary>「神兽 · 白泽」</summary>
        public string Label => $"{PetRarities.Name(rarity)} · {name}";
    }

    /// <summary>八只灵宠（docs/pet-system.md 第 4 节）与按权重抽取</summary>
    public static class PetLibrary
    {
        static readonly Color CommonFx = new(1f, 0.92f, 0.7f), MythicFx = new(1f, 0.62f, 0.32f);

        public static readonly PetDef[] All =
        {
            new()
            {
                id = "dangkang", assetId = "SK_Pet_Dangkang", name = "当康", title = "拱福小猪", rarity = PetRarity.Common,
                lore = "《山海经·东山经》：见则天下大穰", role = "冲撞控制 + 经济", element = Element.None,
                height = 0.7f, moveSpeed = 9f, followBack = 2.6f, followSide = 1.1f, shape = PetShape.Boar,
                body = new Color(0.92f, 0.76f, 0.42f), accent = new Color(0.62f, 0.32f, 0.18f), fx = CommonFx,
                attackDesc = "冲向 12 米内目标，22 伤害 + 眩晕 0.5 秒",
                passiveName = "丰穰", passiveDesc = "场地清场后拱出一袋灵石（20–35）",
                skillName = "丰年冲", skillDesc = "沿准星冲出 18 米，路径上敌人 90 伤害 + 眩晕 1.2 秒", skillCooldown = 18,
                awakenDesc = "钱袋附带一个回血球；冲撞眩晕 +0.3 秒", create = () => new DangkangBehaviour(),
            },
            new()
            {
                id = "huan", assetId = "SK_Pet_Huan", name = "讙", title = "百声狸猫", rarity = PetRarity.Common,
                lore = "《山海经·西山经》：一目三尾，其音如夺百声", role = "嘲讽诱饵", element = Element.None,
                height = 0.6f, moveSpeed = 10f, followBack = 3f, followSide = -1.2f, shape = PetShape.Cat,
                body = new Color(0.36f, 0.37f, 0.4f), accent = new Color(0.85f, 0.62f, 0.25f), fx = CommonFx,
                attackDesc = "爪击 3 × 4（1 秒一轮）",
                passiveName = "夺百声", passiveDesc = "每 10 秒学你说话，10 米内敌人改打它 3 秒",
                skillName = "百声惑", skillDesc = "16 米内敌人改打它 5 秒，期间受伤 +25%", skillCooldown = 20,
                awakenDesc = "被嘲讽的敌人减速 30%", create = () => new HuanBehaviour(),
            },
            new()
            {
                id = "jingwei", assetId = "SK_Pet_Jingwei", name = "精卫", title = "衔石小鸟", rarity = PetRarity.Common,
                lore = "《山海经·北山经》：炎帝之女，衔石填海", role = "远程轰炸、火元素起手", element = Element.Fire, flying = true,
                height = 0.35f, moveSpeed = 13f, followSide = 0.9f, flyHeight = 2.1f, shape = PetShape.SmallBird,
                body = new Color(0.14f, 0.12f, 0.13f), accent = new Color(0.86f, 0.2f, 0.12f), fx = new Color(1f, 0.62f, 0.3f),
                attackDesc = "飞到目标上空投下火石：2 米范围 16 伤害，50% 灼烧",
                passiveName = "", passiveDesc = "",
                skillName = "衔石填海", skillDesc = "准星处 5 米内 2 秒落下 10 颗火石，每颗 24 伤害 + 必定灼烧", skillCooldown = 16,
                awakenDesc = "火石爆炸范围 2.8 米", create = () => new JingweiBehaviour(),
                partId = "SM_PetPart_JingweiPebble", partSocket = "pebble", partGlow = new Color(1f, 0.5f, 0.18f),
            },
            new()
            {
                id = "chongming", assetId = "SK_Pet_Chongming", name = "重明鸟", title = "双瞳辟邪鸟", rarity = PetRarity.Rare,
                lore = "《拾遗记》：双睛在目，能搏逐猛兽，妖灾不能为害", role = "标记增伤、雷元素", element = Element.Shock, flying = true,
                height = 0.6f, moveSpeed = 13f, followSide = -1f, flyHeight = 2.2f, shape = PetShape.Pheasant,
                body = new Color(0.98f, 0.9f, 0.62f), accent = new Color(0.35f, 0.7f, 1f), fx = DamageTable.ElementColor(Element.Shock),
                attackDesc = "双瞳雷光：2 道 × 9 伤害（0.7 秒一次），40% 雷殛",
                passiveName = "重瞳", passiveDesc = "你准星指着的敌人被标记，受到伤害 +15%",
                skillName = "辟邪", skillDesc = "连锁闪电跳 8 次，每次 60 伤害 + 必定雷殛", skillCooldown = 20,
                awakenDesc = "标记增伤 +25%；雷光多弹射 1 个敌人", create = () => new ChongmingBehaviour(),
            },
            new()
            {
                id = "suanni", assetId = "SK_Pet_Suanni", name = "狻猊", title = "香炉护主狮", rarity = PetRarity.Rare,
                lore = "龙生九子之一，喜烟好坐，香炉上的护法狮", role = "护盾守护、蚀元素", element = Element.Corrode,
                height = 0.8f, moveSpeed = 9f, followBack = 2.6f, followSide = 1.3f, shape = PetShape.Lion,
                body = new Color(0.62f, 0.48f, 0.22f), accent = new Color(0.25f, 0.62f, 0.5f), fx = DamageTable.ElementColor(Element.Corrode),
                attackDesc = "吐蚀香：6 米锥形，每 0.25 秒 4 伤害，25% 蚀化",
                passiveName = "护主", passiveDesc = "护盾上限 +20；护盾被打破时怒吼：补 30 护盾、震晕 5 米内敌人 1 秒（15 秒冷却）",
                skillName = "镇宅狮吼", skillDesc = "10 米内敌人眩晕 1.5 秒并蚀化；你 5 秒内伤害减免 +40%", skillCooldown = 22,
                awakenDesc = "蚀香留下 3 秒蚀雾", create = () => new SuanniBehaviour(),
            },
            new()
            {
                id = "zheng", assetId = "SK_Pet_Zheng", name = "狰", title = "五尾赤豹", rarity = PetRarity.Rare,
                lore = "《山海经·西山经》：五尾一角，其音如击石", role = "近战爆发、射速增益", element = Element.None,
                height = 0.85f, moveSpeed = 11f, followBack = 3.2f, followSide = -1.3f, shape = PetShape.Leopard,
                body = new Color(0.72f, 0.16f, 0.1f), accent = new Color(0.55f, 0.55f, 0.55f), fx = new Color(1f, 0.55f, 0.4f),
                attackDesc = "扑击后五尾连抽 5 × 7（1.4 秒一轮），吃玩家暴击率",
                passiveName = "击石", passiveDesc = "狰附近 6 米内的击杀给你射速 +8%（5 秒，最多 3 层）",
                skillName = "五尾裂石", skillDesc = "依次穿过最多 5 个敌人，每个 100 伤害、必定暴击", skillCooldown = 18,
                awakenDesc = "一轮 7 尾", create = () => new ZhengBehaviour(),
            },
            new()
            {
                id = "baize", assetId = "SK_Pet_Baize", name = "白泽", title = "万鬼图鉴", rarity = PetRarity.Mythic,
                lore = "黄帝巡狩遇白泽，能言，知天下鬼神万物之状", role = "让玩家变神", element = Element.None,
                height = 1.3f, moveSpeed = 10f, followBack = 3.4f, followSide = 1.5f, hover = 0.25f, shape = PetShape.Sage,
                body = new Color(0.96f, 0.95f, 0.9f), accent = new Color(1f, 0.78f, 0.3f), fx = MythicFx,
                attackDesc = "金光三连射：同时打 3 个目标，各 30 伤害（1 秒一次）",
                passiveName = "万鬼图 · 洞悉", passiveDesc = "你的每一次命中都算弱点（必定暴击），暴击伤害 +50%；25 米内敌人受到你的伤害 +20%",
                skillName = "白泽图", skillDesc = "30 米内所有敌人眩晕 1.5 秒，8 秒内受伤 +60%；你的技能冷却立刻减半", skillCooldown = 25,
                awakenDesc = "自动吸取 25 米内全部掉落物；暴击伤害改为 +80%", create = () => new BaizeBehaviour(),
            },
            new()
            {
                id = "yinglong", assetId = "SK_Pet_Yinglong", name = "应龙", title = "兴云布雨", rarity = PetRarity.Mythic,
                lore = "《山海经·大荒北经》：应龙蓄水，杀蚩尤与夸父", role = "全场一直在打雷", element = Element.Shock, flying = true,
                height = 1f, moveSpeed = 14f, followBack = 2.4f, followSide = -1.4f, flyHeight = 3.2f, shape = PetShape.Dragon,
                body = new Color(0.25f, 0.62f, 0.45f), accent = new Color(0.95f, 0.78f, 0.35f), fx = MythicFx,
                attackDesc = "龙息雷光：每秒 5 × 20 伤害打它盯住的目标",
                passiveName = "布雨", passiveDesc = "每 0.6 秒对 28 米内随机敌人降一道天雷（50 伤害 + 必定雷殛），每第 3 道附蚀化",
                skillName = "杀蚩尤", skillDesc = "6 秒雷暴，每秒 12 道天雷（70 伤害，火 → 雷 → 蚀轮转）；释放时你的护盾回满", skillCooldown = 25,
                awakenDesc = "布雨间隔 0.4 秒", create = () => new YinglongBehaviour(),
                partId = "SM_PetPart_YinglongPearl", partSocket = "pearl", partGlow = new Color(0.6f, 0.8f, 1f),
            },
        };

        static Dictionary<string, PetDef> byId;

        public static PetDef Get(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            if (byId == null)
            {
                byId = new Dictionary<string, PetDef>();
                foreach (var d in All)
                {
                    byId[d.id] = d;
                    byId[d.assetId] = d;
                }
            }
            return byId.TryGetValue(id, out var def) ? def : null;
        }

        /// <summary>抽一只：先按权重抽品阶（forced 时固定品阶），再在该品阶里平均抽</summary>
        public static PetDef Roll(PetRarity? forced = null)
        {
            var rarity = forced ?? PetRarities.Roll();
            var pool = new List<PetDef>();
            foreach (var d in All)
                if (d.rarity == rarity) pool.Add(d);
            return pool.Count > 0 ? pool[UnityEngine.Random.Range(0, pool.Count)] : All[0];
        }
    }
}
