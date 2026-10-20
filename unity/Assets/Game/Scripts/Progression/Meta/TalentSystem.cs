using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>场景开始时套一次天赋（自动挂到 Game Systems 上；Start 时玩家和属性表都已就绪）</summary>
    [GameSystem(50)]
    public sealed class TalentSystem : MonoBehaviour
    {
        void Start() => TalentHooks.ApplyToPlayer();
    }
}
