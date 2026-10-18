using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>每帧朝向主相机（光晕片、拾取物图标）</summary>
    public sealed class Billboard : MonoBehaviour
    {
        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam) transform.rotation = cam.transform.rotation;
        }
    }
}
