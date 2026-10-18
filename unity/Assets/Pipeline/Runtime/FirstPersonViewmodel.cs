using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Art
{
    /// <summary>
    /// 第一人称枪模的待机呼吸、移动摆动与鼠标滞后（与 Three.js 版 Viewmodel 的幅度同量级），
    /// 用来在展示场景里检查枪与手臂在真实镜头运动下的穿插。枪模坐标约定见 ShowcaseSceneBuilder.BuildFirstPerson。
    /// 战斗时由武器驱动：<see cref="Kick"/> 开枪后坐（后退 + 枪口上抬，叠加有上限、指数回位），<see cref="aim"/> 开镜混合到 aimOffset，
    /// <see cref="lower"/> 换弹 / 切枪时枪身下沉。
    /// </summary>
    public sealed class FirstPersonViewmodel : MonoBehaviour
    {
        public Vector3 hipOffset = new(0.224f, -0.19f, 0.42f);
        /// <summary>开镜位置（相机局部坐标）；0 向量 = 不支持开镜混合</summary>
        public Vector3 aimOffset;
        public float swayAmount = 0.00042f;
        /// <summary>开镜程度 0–1（武器每帧写入）</summary>
        [System.NonSerialized] public float aim;
        /// <summary>换弹 / 切枪下沉程度 0–1（武器每帧写入）</summary>
        [System.NonSerialized] public float lower;

        Vector3 lastCamPos;
        float bobPhase, swayX, swayY, move;
        float kickZ, kickRot, shownZ, shownRot;

        void OnEnable() => lastCamPos = transform.parent ? transform.parent.position : Vector3.zero;

        /// <summary>
        /// 开枪后坐：back 米（向后），rot 弧度（枪口上抬），与 Three.js 武器表的 kick.back / kick.rot 同义。
        /// 同 Three.js 版 Viewmodel.onShot：每发直接叠加、上限为单发的 2.4 倍（连射不会越叠越高），之后指数回位
        /// </summary>
        public void Kick(float back, float rot)
        {
            kickZ = Mathf.Max(kickZ - back, -back * 2.4f);
            kickRot = Mathf.Min(kickRot + rot, rot * 2.4f);
        }

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

            // 后坐回位（位移 15/s、转角 12/s 指数衰减，同 Three.js），显示值再做一点极短的平滑，免得单帧跳变
            kickZ *= Mathf.Exp(-15f * dt);
            kickRot *= Mathf.Exp(-12f * dt);
            shownZ = Mathf.Lerp(shownZ, kickZ, 1 - Mathf.Exp(-45f * dt));
            shownRot = Mathf.Lerp(shownRot, kickRot, 1 - Mathf.Exp(-45f * dt));

            float steady = 1 - aim * 0.8f;
            float breath = Mathf.Sin(Time.time * 1.6f) * 0.0025f * steady;
            float bobX = Mathf.Sin(bobPhase) * 0.011f * move * steady;
            float bobY = -Mathf.Abs(Mathf.Cos(bobPhase)) * 0.012f * move * steady;
            var basePos = aimOffset != Vector3.zero ? Vector3.Lerp(hipOffset, aimOffset, aim) : hipOffset;
            basePos += new Vector3(0, -0.12f, -0.04f) * lower;
            transform.localPosition = basePos + new Vector3(bobX + swayX * 0.5f * steady, bobY + breath + swayY * 0.5f * steady, shownZ);
            transform.localRotation = Quaternion.Euler(0, 180, 0) *
                                      Quaternion.Euler(-(breath * 1.2f + swayY * steady) * Mathf.Rad2Deg + shownRot * Mathf.Rad2Deg - lower * 35f,
                                          -swayX * 1.3f * steady * Mathf.Rad2Deg, 0);
        }
    }
}
