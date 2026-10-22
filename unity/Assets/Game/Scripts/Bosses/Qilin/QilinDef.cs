using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟（终章首领，3-4 祝融炉心；Three.js src/enemies/bosses/Qilin.ts，docs/level-design/maps/3-4.md，D4 / D5）。
    /// 祝融炉心的守炉兽：两个形态各是一个模型（SK_Boss_Qilin / SK_Boss_QilinBurn，同一套四足马鹿骨架，× 1.25 ≈ 7.5 m 高到独角尖），55% 时在熔岩柱里换形。
    ///   一阶段 · 玄鳞（100–55%，玄铁鳞甲 = 护甲层，BS4）：踏火奔驰（绕外环跑道、蹄印留火、横穿象限冲撞）、张鳞（一圈鳞刃，柱子挡得住）、
    ///     麟火（近身扇形吐火）、饮熔（85% / 70% 血量线：跳到熔池边低头饮熔，炉口钻出炭童，饮完鳞甲回满、伤害 × 1.08）；
    ///     饮熔时打碎它身后那面墙上的锁扣 → 鼎角坠下砸中它：硬直 4 秒、鳞甲崩裂（护甲清零、全身都算弱点、受伤 × 2）。
    ///   转换（55%，5.2 s）：剩下的链全断、巨鼎坠池；麒麟跳进熔池沉下去，1.9 s 时在熔岩柱里换成焚身跃出。
    ///   二阶段 · 焚身（55–0%，BS5）：踏云俯冲火环、吐息扫象限、熔流轮转、火云雨 + 神火飞鸦、15% 狂怒。
    ///     BS5 落地之前先占位：<see cref="BurnPlaceholderStomp"/>（单次跃击 + 火环）和 <see cref="BurnPlaceholderBreath"/>（麟火换个 id），
    ///     焚身先当地面形态（BS5 决定踏云高度和 flying），换形时鳞甲炸飞（护甲清零）。
    ///   弱点：角根的火珠（pearl 骨，半径 0.3 × 1.25）；焚身另有胸口火心（命中区 heart，只在焚身启用）。命中区：头、颈、胸、背、臀五个球（长身子不是一根竖胶囊能盖住的）。
    /// 数值（D23 血条刻度 = 85% / 70% 饮熔线 + 55% 换形）：Three.js 是 5000 生命 + 1500 护甲 × 难度（3-4 难度 3.08 时 15400 + 4620）。
    /// 按模拟秒伤定档（<see cref="ReferenceDps"/>、<see cref="EstimateKillSeconds"/>）：饮熔回满鳞甲两次都不打断时 Three.js 的数值要将近 3 分钟，
    /// 所以 3.08 定档 12500 生命 + 2400 护甲：两次都砸中约 75 s、砸中一次约 95 s、一次都不打约 115 s，都落在 60–120 s（QilinTests 守着）。
    /// 动作：E5 的 AC_SK_Boss_Qilin(Burn)（招式状态 rear / scalesFire / breath / drink / stun / pant / tuck / leap / stomp / roar / paw），
    /// 招式按状态名交叉淡入并拉伸到实际时长（框架 PlayAct），出手跟 events.json 的事件走，没有就按时间兜底。
    /// </summary>
    [Defs(30)]
    public sealed class QilinDef : BossDef
    {
        public const string Id = "boss_qilin";
        public const string XuanForm = "xuan", BurnForm = "burn";
        public const string XuanPrefab = "SK_Boss_Qilin", BurnPrefab = "SK_Boss_QilinBurn", ProxyPrefab = "SK_Enemy_IronOx";
        /// <summary>两个形态的体型（美术按 6 m 高到独角尖制作）</summary>
        public const float ModelScale = 1.25f;
        /// <summary>换形阈值（生命层比例）与饮熔线（生命刻度事件，血条上各一道）</summary>
        public const float TransformAt = 0.55f;
        public const string DrinkMarkA = "drink85", DrinkMarkB = "drink70";
        public static readonly float[] DrinkAt = { 0.85f, 0.7f };
        /// <summary>3-4 的难度（D1：1 + 0.8 × 2 + 0.16 × 3）</summary>
        public const float StageDifficulty = 3.08f;
        /// <summary>鼎角砸中：硬直秒数、受伤倍率（鳞甲崩裂）</summary>
        public const float StunSeconds = 4f, CrackTakenMult = 2f;

        public static readonly Color Fire = Hex.Rgb(0xff6a1a), Warn = Hex.Rgb(0xff7a2a), Hot = Hex.Rgb(0xffd070), Ember = Hex.Rgb(0xff8a3a),
            ScaleDark = Hex.Rgb(0x2a2420);

        // ───────────── 场地 / 饮熔 ─────────────

        /// <summary>测试场兜底（关卡没摆吊鼎时）的锁扣高度</summary>
        public float lockHeight = 12f;
        /// <summary>饮熔：低头饮熔多久（秒）、饮熔点离池边多远（米）、饮完的伤害增长、每次召几只炭童</summary>
        public float drinkSeconds = 4f, drinkSpotOut = 3.1f, drinkDamageGrowth = 1.08f;
        public int drinkTantong = 4;
        public string tantongId = "tantong";

        // ───────────── 蹄印 / 奔驰 / 冲撞（TS 原值）─────────────

        /// <summary>蹄印：燃烧秒数、半径、每跳伤害（TS 原值，难度 1）、跳间隔</summary>
        public float printLife = 4f, printRadius = 0.95f, printDamage = 7f, printInterval = 0.4f;
        /// <summary>奔驰速度、上跑道速度、冲撞速度（米 / 秒）；冲撞判定半径（胸—臀线段到玩家）</summary>
        public float gallopSpeed = 18f, toTrackSpeed = 15f, chargeSpeed = 30f, chargeRadius = 1.6f;

        public QilinDef()
        {
            id = Id;
            name = "火麒麟";
            title = "祝融炉心 · 守炉神兽";
            brain = typeof(QilinBrain);
            // 难度 1 的参考值 = 定档 ÷ 3.08（定档表优先，见 VitalsAt）；Three.js 原值 5000 + 1500 护甲
            vitals = new BossVitals(4060, 0, 780);
            tiers.Add(new BossVitalsTier(StageDifficulty, new BossVitals(12500, 0, 2400)));
            damage = 16f;
            speed = 6.5f;
            element = Element.Fire;
            color = Fire;
            warnColor = Warn;
            // 占位胶囊的设计尺寸：半径 2、身高 7.2 m（TS radius / height）
            radius = 2f;
            height = 7.2f;
            idleMinRange = 9f;
            idleMaxRange = 16f;
            repeatWeight = 0.2f;
            phaseWait = 2f;

            forms.Add(new BossFormDef
            {
                id = XuanForm, name = "玄鳞", prefab = XuanPrefab, scale = ModelScale, proxyPrefab = ProxyPrefab, proxyScale = 2.2f,
                weakBone = "pearl", weakRadius = 0.3f,
            });
            forms.Add(new BossFormDef
            {
                id = BurnForm, name = "焚身", prefab = BurnPrefab, scale = ModelScale, proxyPrefab = ProxyPrefab, proxyScale = 2.2f,
                weakBone = "pearl", weakRadius = 0.3f, overlay = Fire, overlayAmount = 0.18f, firstMove = BurnPlaceholderStomp.MoveId,
            });
            phases.Add(new BossPhaseDef
            {
                at = TransformAt, form = BurnForm, seconds = 5.2f, formSwapAt = 1.9f, anim = "tuck", sfx = "boss_roar", shake = 0.6f,
                toast = "剩下的铁链全断了——巨鼎坠入熔池！", restScale = 0.9f,
            });
            marks.Add(new BossMark { at = DrinkAt[0], id = DrinkMarkA, tick = true });
            marks.Add(new BossMark { at = DrinkAt[1], id = DrinkMarkB, tick = true });

            // 受击球（TS QilinModel 的 XUAN_POINTS / BURN_POINTS 半径，挂在骨骼上；正式美术时按骨骼原点，偏移留 0）
            hitZones.Add(new BossHitZoneDef { id = "head", bone = "head", radius = 0.42f, priority = 2 });
            hitZones.Add(new BossHitZoneDef { id = "neck", bone = "neck_1", radius = 0.6f });
            hitZones.Add(new BossHitZoneDef { id = "chest", bone = "chest", radius = 0.85f });
            hitZones.Add(new BossHitZoneDef { id = "back", bone = "spine", radius = 0.85f });
            hitZones.Add(new BossHitZoneDef { id = "hips", bone = "hips", radius = 0.8f });
            hitZones.Add(new BossHitZoneDef { id = "heart", bone = "chest", radius = 0.45f, weak = true, priority = 5, form = BurnForm });

            moves.Add(() => new ScaleGallop());
            moves.Add(() => new ScaleBlades());
            moves.Add(() => new ScaleBreath());
            moves.Add(() => new ScaleDrink());
            // BS5 之前的焚身占位
            moves.Add(() => new BurnPlaceholderStomp());
            moves.Add(() => new BurnPlaceholderBreath());

            summonCap = 6;
            enrageBelow = 0.15f;
            enrageToast = "火麒麟狂怒——焚身之火愈烈！";
            intro.seconds = 3.2f;
            intro.anim = "tuck";
            intro.sfx = "boss_roar";
            intro.shake = 0.6f;
            intro.firstRest = 1.2f;
            defeat.seconds = 3.4f;
            defeat.toast = "火麒麟伏诛——祝融炉心重归平静";
        }

        // ───────────── 定档模型（EditMode 测试守着）─────────────

        /// <summary>武器秒伤带的中位（D11：身体 60–90，取 75）</summary>
        public const float BaseDps = 75f;
        /// <summary>难度每 +1 的装备成长（品质、强化、秘卷、天赋合计）与实际输出时间占比（躲招、换弹、换位）</summary>
        public const float DpsGrowth = 1.15f, Uptime = 0.75f;
        /// <summary>无属性打护甲的倍率（DamageTable：0.75）</summary>
        public const float ArmorMult = 0.75f;

        /// <summary>
        /// 定档用的模拟秒伤：75 ×（1 + 1.15 ×（难度 − 1））× 0.75。1-4（1.48）约 87、3-4（3.08）约 191。
        /// 只用来定首领耐久的量级（docs/unity-parity.md 7.4「用模拟秒伤算击杀用时，落在 60–120 s」），不是武器平衡的依据
        /// </summary>
        public static float ReferenceDps(float difficulty) => BaseDps * (1 + DpsGrowth * (Mathf.Max(1f, difficulty) - 1)) * Uptime;

        /// <summary>
        /// 模拟击杀用时（秒）：生命 + 护甲 ÷ 0.75（无属性）为基础量；两次饮熔里没打断的那几次各回满一次鳞甲；
        /// 每次砸中给 4 s × 秒伤 ×（受伤倍率 − 1）的额外输出（崩裂时护甲本来就打光了，清零不算收益）
        /// </summary>
        public static float EstimateKillSeconds(BossVitals v, float dps, int cauldronHits, int drinks = 2)
        {
            if (!(dps > 0)) return float.PositiveInfinity;
            cauldronHits = Mathf.Clamp(cauldronHits, 0, drinks);
            float armorRaw = v.armor / ArmorMult;
            float pool = v.hp + v.shield + armorRaw + armorRaw * (drinks - cauldronHits);
            float bonus = cauldronHits * StunSeconds * dps * (CrackTakenMult - 1f);
            return Mathf.Max(0, pool - bonus) / dps;
        }
    }
}
