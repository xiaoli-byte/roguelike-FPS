using UnityEngine;

namespace Spiritfire.Game
{
    public abstract class TornadoVisualBase : MonoBehaviour
    {
        public virtual void SetTravel(Vector3 direction) { }
        public virtual void SetAlpha(float alpha) { }
        public abstract void FadeOut(float seconds);
    }
}
