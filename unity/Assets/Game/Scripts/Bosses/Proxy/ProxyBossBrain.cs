using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>代理首领的行为：石壳开裂时排一次召唤，换形时火星迸散，转换演出里前摇发光渐亮</summary>
    public sealed class ProxyBossBrain : BossBrain
    {
        public override void OnMark(string markId)
        {
            if (markId != ProxyBossDef.CrackMark) return;
            QueueMove(ProxySummon.MoveId);
            GameUI.Toast("试炼傀儡的石壳裂开了", Def.color);
        }

        protected override void TransitionTick(float t, float dt)
        {
            var pd = Def.phases.Count > 0 ? Def.phases[0] : null;
            Glow(0, pd != null && pd.seconds > 0 ? Mathf.Clamp01(t / pd.seconds) : 0);
        }

        protected override void OnTransitionEnd(BossPhaseDef phase) => Glow(0, 0);

        protected override void OnFormChanged(BossFormDef previous, BossFormDef next)
        {
            if (next == null || next.id != ProxyBossDef.EmberForm) return;
            SkillFx.Burst(BodyCenter, next.overlay, 40, 10f, 1.2f, 0.45f, 6f);
            Shake(0.5f, 0.6f);
        }
    }
}
