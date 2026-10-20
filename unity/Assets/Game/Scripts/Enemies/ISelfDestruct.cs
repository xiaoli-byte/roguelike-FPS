namespace Spiritfire.Game
{
    /// <summary>
    /// 会自爆的敌人（火浣鼠滚到身边炸开、冰棘豪彘的冰刺新星…）：自爆身亡同 Three.js 不经过伤害结算——没有击杀事件、不给奖励。
    /// 冒烟套件据此区分「自己炸死」与「死了却没派发击杀事件」。Detonated = 这一只是自爆死的（被玩家打死的为 false）
    /// </summary>
    public interface ISelfDestruct
    {
        bool Detonated { get; }
    }
}
