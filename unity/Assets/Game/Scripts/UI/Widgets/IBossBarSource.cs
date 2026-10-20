using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领血条的数据源（docs/unity-parity.md D23 / U3）：首领框架（B0 的 BossBrain）实现它，刻度和阶段阈值从 BossDef 读，
    /// 不再像 Three.js 那样写死一张表（鲲鹏、火麒麟的刻度在那张表里是错的）。
    /// 血条每帧现读这些成员：换形（火麒麟玄鳞 → 焚身）时 <see cref="BarHealth"/> 可以换成另一个受伤体，阈值、副标题也可以跟着变。
    /// 用法：<c>GameUI.SetBoss(this)</c>（泛型重载，见 <see cref="GameUI.SetBoss{T}"/>）；没人调用时，生成出来的 Rank.Boss 敌人实现了本接口也会被血条自动接上。
    /// 成员名都带 Bar 前缀，免得和 EnemyAI / BossBrain 自己的成员撞名（实现时可以显式实现）。
    /// </summary>
    public interface IBossBarSource
    {
        /// <summary>当前承伤的身体（护盾 / 护甲 / 生命三层都从它读）；null = 暂时没有（血条保持上一帧）</summary>
        Damageable BarHealth { get; }
        /// <summary>首领名（「旱魃」）；空 = 用 Damageable.displayName</summary>
        string BarTitle { get; }
        /// <summary>副标题（称号 / 形态 / 阶段名，如「焚身」「第二阶段 · 焦土」）；空 = 不显示</summary>
        string BarSubtitle { get; }
        /// <summary>阶段阈值（生命比例 0..1，降序或乱序都行）：血条上画刻度，越过时刻度熄灭、血条亮一下</summary>
        IReadOnlyList<float> BarThresholds { get; }
        /// <summary>无敌（登场、换形、阶段转换）：血条褪色、底部显示锁与「无敌」</summary>
        bool BarInvulnerable { get; }
    }

    /// <summary>只有一个受伤体 + 名字的首领（旧接口 <see cref="GameUI.SetBoss(Damageable, string)"/>）：没有刻度，不可选中即无敌</summary>
    public sealed class DamageableBossSource : IBossBarSource
    {
        readonly Damageable health;
        readonly string title;

        public DamageableBossSource(Damageable health, string title)
        {
            this.health = health;
            this.title = title;
        }

        public Damageable BarHealth => health;
        public string BarTitle => !string.IsNullOrEmpty(title) ? title : health ? (string.IsNullOrEmpty(health.displayName) ? health.name : health.displayName) : "";
        public string BarSubtitle => null;
        public IReadOnlyList<float> BarThresholds => Array.Empty<float>();
        public bool BarInvulnerable => health && !health.Dead && health.untargetable;
    }
}
