using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Art
{
    /// <summary>
    /// 第一人称枪模的待机呼吸、移动摆动与鼠标滞后（与 Three.js 版 Viewmodel 的幅度同量级），
    /// 用来在展示场景里检查枪与手臂在真实镜头运动下的穿插。枪模坐标约定见 ShowcaseSceneBuilder.BuildFirstPerson。
    /// </summary>
    public sealed class FirstPersonViewmodel : MonoBehaviour
    {
        public Vector3 hipOffset = new(0.224f, -0.19f, 0.42f);
        public float swayAmount = 0.00042f;

        Vector3 lastCamPos;
        float bobPhase, swayX, swayY, move;

        void OnEnable() => lastCamPos = transform.parent ? transform.parent.position : Vector3.zero;

        void LateUpdate()
        {
            var cam = transform.parent;
            if (!cam) return;
            float dt = Mathf.Max(Time.deltaTime, 1e-4f);
            var v = (cam.position - lastCamPos) / dt;
            lastCamPos = cam.position;
            float planar = new Vector2(v.x, v.z).magnitude;
            move = Mathf.Lerp(move, Mathf.Clamp01(planar / 5f), 1 - Mathf.Exp(-8 * dt));
            bobPhase += dt * (6f + 4f * move);

            var d = Mouse.current != null ? Mouse.current.delta.ReadValue() : Vector2.zero;
            swayX = Mathf.Lerp(swayX, Mathf.Clamp(-d.x * swayAmount, -0.05f, 0.05f), 1 - Mathf.Exp(-10 * dt));
            swayY = Mathf.Lerp(swayY, Mathf.Clamp(-d.y * swayAmount, -0.05f, 0.05f), 1 - Mathf.Exp(-10 * dt));

            float breath = Mathf.Sin(Time.time * 1.6f) * 0.0025f;
            float bobX = Mathf.Sin(bobPhase) * 0.011f * move;
            float bobY = -Mathf.Abs(Mathf.Cos(bobPhase)) * 0.012f * move;
            transform.localPosition = hipOffset + new Vector3(bobX + swayX * 0.5f, bobY + breath + swayY * 0.5f, 0);
            transform.localRotation = Quaternion.Euler(0, 180, 0) *
                                      Quaternion.Euler(-(breath * 1.2f + swayY) * Mathf.Rad2Deg, -swayX * 1.3f * Mathf.Rad2Deg, 0);
        }
    }
}
