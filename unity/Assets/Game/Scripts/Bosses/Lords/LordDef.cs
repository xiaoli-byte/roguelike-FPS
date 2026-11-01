using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 死亡演出的镜头表（docs/art/ch4-boss-intros.json 每个领主的第三段：show + land）：
    ///   show：绕首领转半圈（从玩家方向 −<see cref="orbitFrom"/> 转到 +<see cref="orbitTo"/>，距 <see cref="radius"/>、高 <see cref="height"/>），开头 <see cref="slowSeconds"/> 秒 <see cref="slowScale"/> 倍慢放；
    ///   land：切到玩家身后的过肩机位（后 3.2 m、上 0.9 m、右 0.9 m），<see cref="landSeconds"/> 秒 smootherstep 推进玩家眼睛（零误差交还）；
    ///   名字卡 <see cref="cardAt"/> 起 <see cref="cardSeconds"/> 秒。
    /// </summary>
    public sealed class LordDeathSpec
    {
        public string name;
        public float seconds = 6f, landSeconds = 1.2f, handoff = 0.5f;
        public float cardAt = 3f, cardSeconds = 2.8f;
        public string cardTitle, cardSub, epithet;
        /// <summary>环绕：半径、机位高、看点高（米）、起止偏角（弧度，相对「首领 → 玩家」方向）</summary>
        public float radius = 13f, height = 4f, lookHeight = 2.5f, orbitFrom = -0.3f, orbitTo = 0.9f;
        /// <summary>开头的慢放倍率与真实秒数</summary>
        public float slowScale = 0.3f, slowSeconds = 1.2f;

        /// <summary>环绕段的秒数（整段 − 落回）</summary>
        public float ShowSeconds => Mathf.Max(0.1f, seconds - landSeconds);
    }

    /// <summary>
    /// 4-1 三领主（夔、飞廉、化蛇）的定义底座（docs/unity-ch4-port.md C4-6、chuanzang-combat-v1.md 第 4 节「领主通用」）：
    ///   · 4-1 的难度（RunPlan：1 + 0.8 × 3 = 3.4）下按 I3 参考秒伤定档，领主梯度（<see cref="LordScaling"/>）在生成时再乘血量；
    ///   · <see cref="BossDef.lordLevel"/> = 「4-1」、转阶段只出横幅（<see cref="BossDef.phaseCinematic"/> = false），阶段名写在 <see cref="BossPhaseDef.toast"/>；
    ///   · 一场领主战内部的节奏：二阶段收招 × <see cref="tempo2"/>、三阶段 × <see cref="tempo3"/>（网页版 boss.ts tempo），再乘领主梯度；
    ///   · 死亡不放通用的溃散爆炸，改成领主自己的死亡演出（<see cref="death"/>，<see cref="LordCinema"/>）；倒下后据点灵火由 BossEncounter 据点模式点亮。
    /// </summary>
    public abstract class LordDef : BossDef
    {
        /// <summary>4-1 的关卡 id（领主梯度的记账键）与难度</summary>
        public const string Level = "4-1";
        public const float StageDifficulty = 3.4f;
        /// <summary>网页版的数值是按网页的枪（9 发 / 秒 × 16）定的：耐久、破防条、机关伤害按「Unity 定档 ÷ 网页血量」统一换算</summary>
        public float webHp = 12000f;

        /// <summary>二 / 三阶段的收招倍率（网页版 boss.ts：0.9 / 0.75）</summary>
        public float tempo2 = 0.9f, tempo3 = 0.75f;
        /// <summary>死亡演出的镜头表与倒下的动作（Animator 状态名）</summary>
        public readonly LordDeathSpec death = new();
        public string deathAnim = "kneel";
        /// <summary>主题色三阶（亮芯 / 主色 / 暗边）</summary>
        public Color core = Color.white, edge = Color.gray;

        protected LordDef()
        {
            lordLevel = Level;
            phaseCinematic = false;
            repeatWeight = 1f;
            phaseWait = 2f;
            summonCap = 4;
            stunBetweenMoves = true;
            // 倒下：领主自己的死亡演出（LordCinema），通用溃散只留倒下那一下的爆点；慢放由演出放
            defeat.seconds = 6f;
            defeat.despawnAfter = 1.5f;
            defeat.slowMo = 1f;
            defeat.slowMoSeconds = 0f;
            rewards.chest = "scroll";
            intro.banner = true;
        }

        /// <summary>4-1 难度下的耐久（定档）</summary>
        public float StageHp => VitalsAt(StageDifficulty).hp;

        /// <summary>网页数值 → Unity：按耐久比例（破防条、机关对领主的伤害、侧跃的挨打阈值）</summary>
        public float WebScale => StageHp / Mathf.Max(1f, webHp);

        // ───────────── 定档模型（EditMode 测试守着）─────────────

        /// <summary>弱点 / 破防窗口给的额外输出（相对参考秒伤）：领主战的弱点都在明处（鼓心、风雷珠、张开的嘴），破防 4 s × 1.3</summary>
        public const float WeakBonus = 1.1f;

        /// <summary>
        /// 模拟击杀用时（秒，登场结束到倒下）：tier 档的血量 ÷（参考秒伤 × 弱点加成）+ 两次转阶段的不可选中时间。
        /// 4-1 三领主每一档都要落在 60–120 s（docs/unity-parity.md 7.4），第 0 档在 70–85 s
        /// </summary>
        public float EstimateKillSeconds(int tier)
        {
            var t = new LordTier(tier);
            float dps = BalanceModel.ReferenceDps(StageDifficulty) * WeakBonus;
            float trans = 0;
            foreach (var p in phases)
                if (p != null)
                    trans += p.seconds;
            return StageHp * t.HpMult / Mathf.Max(1f, dps) + trans;
        }
    }
}
