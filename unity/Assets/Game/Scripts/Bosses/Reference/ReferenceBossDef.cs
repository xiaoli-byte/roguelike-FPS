using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 「危险物样机」（B1 的验收对象，TestArena 用；不进 RunPlan）：一具装着全部参考招式（<see cref="ReferenceMove"/>）的代理首领——
    ///   沙暴巨像 5 招（砸地冲击波、巨石投掷、眼部扫射、践踏、裂地岩刺）、霜翼妖后 3 招（寒霜新星、冰枪齐射、冰棱螺旋）、熔心魔将 6 招（烈焰冲锋、火焰横扫、陨石雨、跃击、焰刃连斩、熔岩涌动），
    ///   把 <see cref="BossHazards"/> 的每种原语（冲击波 / 扇形波、持续区 / 环带、抛射 / 坠落、地刺、范围伤害、光束扫掠、预警两组撤回）都跑到。
    /// 两道阶段阈值（66% / 33%）让「二阶段起」「三阶段起」的变体也能被强制出到；阶段转换不换形、演出 1.2 s。
    /// 模型：SK_Enemy_TombBeast × 2.2（镇墓兽，体型接近巨像）当代理，没有就占位胶囊。数值给测试场用（难度 1 下 3000 生命），伤害基数 22（= 巨像，TS 原值换算见 <see cref="ReferenceMove.Dmg"/>）。
    /// </summary>
    [Defs(901)]
    public sealed class ReferenceBossDef : BossDef
    {
        public const string Id = "boss_hazard_lab";

        /// <summary>全部参考招式的工厂（套件 / 测试按这个顺序逐个出）</summary>
        public static readonly IReadOnlyList<Func<BossMove>> All = new Func<BossMove>[]
        {
            () => new ColossusSlam(), () => new ColossusBoulders(), () => new ColossusBeam(), () => new ColossusStomp(), () => new ColossusFissure(),
            () => new MatriarchNova(), () => new MatriarchLances(), () => new MatriarchSpiral(),
            () => new WarlordCharge(), () => new WarlordSweep(), () => new WarlordMeteor(), () => new WarlordLeap(), () => new WarlordCombo(), () => new WarlordLava(),
        };

        public ReferenceBossDef()
        {
            id = Id;
            name = "危险物样机";
            title = "首领危险物 · 参考招式";
            vitals = new BossVitals(3000);
            damage = 22f;
            speed = 4.6f;
            color = Hex.Rgb(0xffa640);
            warnColor = Hex.Rgb(0xff7a2a);
            radius = 0.9f;
            height = 4.4f;
            idleMinRange = 7f;
            idleMaxRange = 13f;
            forms.Add(new BossFormDef
            {
                id = "lab", name = null, prefab = null, scale = 1f, proxyPrefab = "SK_Enemy_TombBeast", proxyScale = 2.2f, weakBone = "head", weakRadius = 0.4f,
            });
            phases.Add(new BossPhaseDef { at = 0.66f, seconds = 1.2f, toast = "危险物样机进入二阶段", restScale = 0.85f });
            phases.Add(new BossPhaseDef { at = 0.33f, seconds = 1.2f, toast = "危险物样机进入三阶段", restScale = 0.7f });
            foreach (var make in All) moves.Add(make);
            summonCap = 0;
            enrageAfter = 0;
            intro.seconds = 1.6f;
            intro.banner = true;
        }
    }
}
