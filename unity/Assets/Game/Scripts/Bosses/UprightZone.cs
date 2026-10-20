using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>首领的竖直胶囊命中区（Three.js rayVerticalCapsule）：只跟骨骼的位置走，每帧把朝向摆正，不跟着骨骼转</summary>
    [DisallowMultipleComponent]
    public sealed class UprightZone : MonoBehaviour
    {
        void LateUpdate() => transform.rotation = Quaternion.identity;
    }
}
