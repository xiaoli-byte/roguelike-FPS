namespace Spiritfire.Game
{
    /// <summary>
    /// 会自己退场的敌人（火浣鼠滚到身边炸开、冰棘豪彘的冰刺新星、炭童余烬复燃 / 被祸斗吃掉…）：自爆 / 自己消失同 Three.js 不经过伤害结算——
    /// 没有玩家击杀事件、不给奖励。冒烟套件据此区分「自己退场」与「死了却没派发击杀事件」。
    /// Detonated = 这一只是自己退场的（被玩家打死的为 false）
    /// </summary>
    public interface ISelfDestruct
    {
        bool Detonated { get; }
    }
}
