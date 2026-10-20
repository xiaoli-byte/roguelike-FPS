using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 代理首领「试炼傀儡」（B0 首领框架的验收对象，TestArena 用；不进 RunPlan）：
    ///   模型：旱魃 SK_Boss_Hanba × 1.4（GameDatabase / 场景敌人目录里有时），否则 SK_Enemy_Apsara 放大 3.5 倍当代理（4.11），再没有就是占位胶囊；
    ///   两个形态：石身 → 50% 转换演出（2.4 s，不可选中）中途换焚身——同一个模型换着色，护盾重凝五成，胸口露出 ×1.25 的火核命中区，第一招震地；
    ///   三招：震地（跃起砸向玩家脚下，圆形预警）、冲撞（直线预警，沿线冲过去）、召唤（两只跳鼠刀兵，场地召唤点上先亮预警）；
    ///   75% 时石壳开裂（生命刻度事件，血条上画一道）：下一招必定召唤；20% 以下狂怒（喘息 / 前摇缩短、伤害 ×1.15）。
    /// 数值是给测试场用的（难度 1 下 2400 生命 + 600 护盾），不代表任何正式首领的定档。
    /// </summary>
    [Defs(900)]
    public sealed class ProxyBossDef : BossDef
    {
        public const string Id = "boss_proxy";
        public const string StoneForm = "stone", EmberForm = "ember";
        public const string CrackMark = "crack";

        public ProxyBossDef()
        {
            id = Id;
            name = "试炼傀儡";
            title = "首领框架 · 代理";
            brain = typeof(ProxyBossBrain);
            vitals = new BossVitals(2400, 600);
            damage = 14f;
            speed = 5.5f;
            color = Hex.Rgb(0xe0a050);
            warnColor = Hex.Rgb(0xff7a3a);
            // 占位胶囊的设计尺寸（× 形态体型 1.4 ≈ 6.3 m 高，和代理模型 1.9 × 3.5 ≈ 6.7 m 相当）
            radius = 0.6f;
            height = 4.5f;
            idleMinRange = 8f;
            idleMaxRange = 15f;

            forms.Add(new BossFormDef
            {
                id = StoneForm, name = "石身", prefab = "SK_Boss_Hanba", scale = 1.4f, proxyPrefab = "SK_Enemy_Apsara", proxyScale = 3.5f,
                weakBone = "head", weakRadius = 0.32f,
            });
            forms.Add(new BossFormDef
            {
                id = EmberForm, name = "焚身", prefab = "SK_Boss_Hanba", scale = 1.4f, proxyPrefab = "SK_Enemy_Apsara", proxyScale = 3.5f,
                weakBone = "head", weakRadius = 0.32f, tint = new Color(1f, 0.66f, 0.5f), overlay = Hex.Rgb(0xff6a2a), overlayAmount = 0.2f,
                shieldRestore = 0.5f, firstMove = ProxySlam.MoveId,
            });
            phases.Add(new BossPhaseDef { at = 0.5f, form = EmberForm, seconds = 2.4f, toast = "试炼傀儡褪去石壳——焚身！", restScale = 0.8f });
            marks.Add(new BossMark { at = 0.75f, id = CrackMark, tick = true });
            hitZones.Add(new BossHitZoneDef { id = "core", bone = "chest", radius = 0.45f, multiplier = 1.25f, form = EmberForm, priority = 2 });

            moves.Add(() => new ProxySlam());
            moves.Add(() => new ProxyDash());
            moves.Add(() => new ProxySummon());

            enrageBelow = 0.2f;
            enrageAfter = 240f;
            enrageToast = "试炼傀儡狂怒了！";
            summonCap = 4;
            intro.seconds = 2.6f;
        }
    }
}
