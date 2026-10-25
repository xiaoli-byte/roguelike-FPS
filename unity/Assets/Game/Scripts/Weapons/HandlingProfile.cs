using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>装填动作（同 TS WeaponHandling.LoadingAction）：决定左手怎么换弹、弹匣往哪走</summary>
    public enum LoadingAction { Magazine, Speedloader, Drum, Shell, Breech, Tube, CellTop, CellBottom, Wick, AmmoBox, BoltClip }

    /// <summary>
    /// 一把枪的第一人称持握与换弹（W4，docs/unity-parity.md 3.3「换弹风格与装填动作」；同 TS src/weapons/WeaponHandling.ts + Viewmodel 的换弹部分）。
    /// 每把一个 Handling/Profiles/HandlingProfile_&lt;Id&gt;.cs（[Defs] + <see cref="IDefSource{T}"/>），id = 武器 id。
    /// 位置一律不在这里：握点、送弹口、收尾点、枪口都是枪模 Prefab 的挂点（W3 <see cref="Spiritfire.Art.WeaponSockets"/>），这里只管「怎么动」：
    ///   · 时间线（整匣换弹进度 0..1，同 TS sampleLoadingHand / magCurve）：0 → <see cref="reachEnd"/> 左手从握点伸到送弹口；
    ///     弹匣 <see cref="magOutStart"/>–<see cref="magOutEnd"/> 取出、离位、<see cref="magInStart"/>–<see cref="magInEnd"/> 装入；
    ///     <see cref="loadAt"/> 弹匣入位 = 加弹的动画事件（<see cref="WeaponStateMachine.CommitLoad"/>；没有第一人称 rig 时换弹结束才加，结果一样）；
    ///     <see cref="finishStart"/>–<see cref="finishEnd"/> 手去收尾点（拉机柄、拍枪管），之后回到握点；
    ///   · 逐发装填（Shell / Breech）：每一发 0–22% 手从握点（第一发）或送弹口（之后）去弹药袋拿弹，22%–88% 送到送弹口；
    ///   · 换弹时枪身姿态 <see cref="tiltRot"/> / <see cref="tiltPos"/>（Three.js 相机空间约定：rx + 枪口上抬、ry + 枪口左摆、rz + 右侧上翻；x 右、y 上、z 朝后），
    ///     包络：进 0–15%，保持，82–100% 退出；
    ///   · 弹匣离位 <see cref="magOffset"/>（Three.js 枪模坐标，x 取反后用）与俯仰 <see cref="magPitch"/>；转轮每发一格 <see cref="cylinderSteps"/>、换弹甩出 <see cref="cylinderSwing"/>；
    ///     泵动行程 <see cref="pumpStroke"/>；
    ///   · 手感：<see cref="weight"/>（冲锋枪 = 1；越重晃动越慢、后坐回位越慢、落地下沉越深）、晃动 / 摆动倍率。
    /// 预设按装填动作给（<see cref="Make"/>），各把文件只改不同的地方。
    /// </summary>
    public sealed class HandlingProfile : IDef
    {
        public string weaponId;
        public LoadingAction action;

        public float reachEnd = 0.14f;
        public float magOutStart = 0.12f, magOutEnd = 0.38f, magInStart = 0.55f, magInEnd = 0.78f;
        public float loadAt = 0.78f;
        public float finishStart = 0.78f, finishEnd = 0.88f;

        public Vector3 tiltRot, tiltPos;
        public Vector3 magOffset;
        public float magPitch;
        /// <summary>离位到这个程度后隐藏弹匣（管式装填：榴弹 / 飞弹塞进去就看不见了）；≥ 1 = 不隐藏</summary>
        public float magHideAt = 1f;
        /// <summary>转轮每发转一格的格数（0 = 不转；三才转轮由 <see cref="TrinityCycle"/> 自己转）</summary>
        public int cylinderSteps;
        /// <summary>换弹时转轮甩出的横移（Three.js x，米；左手那边是负）</summary>
        public float cylinderSwing = -0.045f;
        /// <summary>换弹甩出时转轮自转（弧度 / 秒，TS 14）</summary>
        public float cylinderSpin = 14f;
        public float pumpStroke;

        public float weight = 1f, swayScale = 1f, bobScale = 1f;
        /// <summary>左手伸到送弹口时的横滚 / 俯仰（弧度）</summary>
        public float reachRoll = 0.35f, reachPitch = 0.12f;

        string IDef.Id => weaponId;

        public bool Shell => action is LoadingAction.Shell or LoadingAction.Breech;

        /// <summary>某把枪的持握；没有登记为 null</summary>
        public static HandlingProfile For(string weaponId) => Registry<HandlingProfile>.Get(weaponId);

        /// <summary>
        /// 按装填动作和换弹风格的预设（TS Viewmodel 的 reloadStyle 姿态 + animateParts 的弹匣动作 + sampleLoadingHand 的手型）
        /// </summary>
        public static HandlingProfile Make(string weaponId, LoadingAction action, ReloadStyle style)
        {
            var p = new HandlingProfile { weaponId = weaponId, action = action };
            switch (style)
            {
                case ReloadStyle.Magazine: p.tiltRot = new Vector3(0.12f, 0, 0.45f); p.tiltPos = new Vector3(-0.03f, 0.01f, 0); break;
                case ReloadStyle.Cylinder: p.tiltRot = new Vector3(0.1f, 0, 0.75f); p.tiltPos = new Vector3(-0.04f, 0, 0); break;
                case ReloadStyle.Tube: p.tiltRot = new Vector3(0.5f, 0, 0.15f); p.tiltPos = new Vector3(0, -0.04f, 0.04f); break;
                case ReloadStyle.Cell: p.tiltRot = new Vector3(0.12f, 0, 0.3f); p.tiltPos = new Vector3(-0.02f, 0, 0); break;
                case ReloadStyle.Box: p.tiltRot = new Vector3(0, 0, 0.28f); p.tiltPos = new Vector3(-0.02f, -0.05f, 0); break;
                case ReloadStyle.Shell: p.tiltRot = new Vector3(0.1f, 0, -0.38f); p.tiltPos = new Vector3(-0.015f, 0.015f, 0); break;
            }
            switch (action)
            {
                // TS 弹匣下抽 0.2：腰射时连手带弹匣掉出画面，换弹看不清。收到 0.14，弹匣和手留在画面下沿
                case LoadingAction.Magazine: p.magOffset = new Vector3(0, -0.14f, 0.03f); p.magPitch = 0.3f; break;
                case LoadingAction.BoltClip: p.magOffset = new Vector3(0, 0.13f, 0.03f); p.magPitch = -0.25f; p.reachRoll = -0.9f; break;
                case LoadingAction.CellTop: p.magOffset = new Vector3(0.03f, 0.12f, 0); p.reachRoll = -0.9f; break;
                case LoadingAction.Wick: p.magOffset = new Vector3(0.03f, 0.12f, 0); p.reachRoll = -0.9f; break;
                case LoadingAction.CellBottom: p.magOffset = new Vector3(0.03f, -0.16f, 0); break;
                case LoadingAction.Tube: p.magOffset = new Vector3(0, -0.02f, 0.12f); p.magHideAt = 0.85f; p.reachRoll = 0.65f; break;
                case LoadingAction.AmmoBox: p.magOffset = new Vector3(-0.02f, -0.24f, 0); break;
                case LoadingAction.Speedloader:
                case LoadingAction.Drum: p.reachRoll = -1.25f; break;
                case LoadingAction.Shell:
                case LoadingAction.Breech: p.reachPitch = -0.3f; break;
            }
            return p;
        }

        // ───────────── 纯函数（EditMode 可测）─────────────

        static float Smooth(float x)
        {
            x = Mathf.Clamp01(x);
            return x * x * (3 - 2 * x);
        }

        /// <summary>换弹姿态包络（同 TS reloadEnvelope）：进 0–15%，保持，82–100% 退出</summary>
        public static float Envelope(float p) => Smooth(p / 0.15f) * (1 - Smooth((p - 0.82f) / 0.18f));

        /// <summary>弹匣离位程度 0..1（同 TS magCurve，分界用本把的时间线）</summary>
        public float MagOut(float p)
        {
            if (p < magOutStart) return 0;
            if (p < magOutEnd) return Smooth((p - magOutStart) / Mathf.Max(1e-3f, magOutEnd - magOutStart));
            if (p < magInStart) return 1;
            if (p < magInEnd) return 1 - Smooth((p - magInStart) / Mathf.Max(1e-3f, magInEnd - magInStart));
            return 0;
        }

        /// <summary>逐发装填时左手去拿弹的弹药袋（Three.js 枪模坐标 (−0.11, −0.21, 0.08)，x 取反）</summary>
        public static readonly Vector3 Pouch = WeaponDef.Grip(-0.11f, -0.21f, 0.08f);

        /// <summary>
        /// 换弹中左手的位置与手型（同 TS sampleLoadingHand；坐标都是枪模空间）。support = 握点，contact = 送弹口，finish = 收尾点；
        /// firstShell = 逐发装填的第一发（从握点出发；之后各发从送弹口出发、保持装填手型）。roll / pitch 是相对握持手型的目标（弧度）
        /// </summary>
        public void SampleHand(float progress, Vector3 support, Vector3 contact, Vector3 finish, bool firstShell, float baseRoll,
            out Vector3 pos, out float roll, out float pitch)
        {
            float p = Mathf.Clamp01(progress);
            Vector3 from = support, to = contact;
            float t;
            if (Shell)
            {
                if (p < 0.22f)
                {
                    from = firstShell ? support : contact;
                    to = Pouch;
                    t = Smooth(p / 0.22f);
                }
                else
                {
                    from = Pouch;
                    t = Smooth((p - 0.22f) / 0.66f);
                }
            }
            else if (p < reachEnd) t = Smooth(p / reachEnd);
            else if (p < finishStart)
            {
                from = contact;
                t = 1;
            }
            else if (p < finishEnd)
            {
                from = contact;
                to = finish;
                t = Smooth((p - finishStart) / Mathf.Max(1e-3f, finishEnd - finishStart));
            }
            else
            {
                from = finish;
                to = support;
                t = Smooth((p - finishEnd) / Mathf.Max(1e-3f, 1 - finishEnd));
            }
            pos = Vector3.Lerp(from, to, t);
            float reach = Shell ? (firstShell ? Smooth(p / 0.22f) : 1) : Smooth(p / reachEnd) * (1 - Smooth((p - finishEnd) / Mathf.Max(1e-3f, 1 - finishEnd)));
            roll = Mathf.Lerp(baseRoll, reachRoll, reach);
            pitch = reachPitch * reach;
        }
    }
}
