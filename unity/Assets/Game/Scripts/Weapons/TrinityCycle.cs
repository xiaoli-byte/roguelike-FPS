using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 三才转轮的第一人称表现（同 TS Viewmodel：elementHint 着色灵纹、转轮锁定到下一发所在膛位）：
    ///   灵纹：枪身发光改成「下一发」的元素色（属性块覆盖 <see cref="WeaponTint"/> 的静态火色），亮度 0.82 + 0.14·sin(3t) 呼吸；
    ///         下一发的元素一变（开枪 / 换弹归零）就亮闪一下，0.15 s 左右收回（Unity 新增，让轮转一眼可见）。
    ///         换弹中显示换弹完成后的第一发（灼烧），与弹巢归零一致。
    ///   弹巢（白模节点 j_8）：六膛，膛位 i 在 90° − i·60°，转到「下一发」那一膛朝上（转角 = 下标 × 60°，只向前转；同色膛等价，周期 3 格），阻尼 25；
    ///         整匣换弹时随弹匣曲线（12–38% 甩出、55–78% 收回）向左甩出 4.5 cm 并快转，收回后锁到第一膛。
    /// </summary>
    public sealed class TrinityCycle : WeaponRigPart
    {
        public const int Chambers = 6;
        /// <summary>换弹甩出距离（米）、甩出时转速（弧度 / 秒）、锁膛阻尼</summary>
        public const float SwingOut = 0.045f, ReloadSpin = 14f, LockDamp = 25f;
        /// <summary>换元素时的亮闪强度与衰减速度</summary>
        public const float FlashGain = 0.9f, FlashDecay = 14f;

        Transform cylinder;
        Quaternion cylBase;
        Vector3 cylBasePos;
        float cylAngle, cylTarget, magOut, flash;
        bool snap = true, hasShown;
        Element shownNext;
        readonly List<Renderer> glow = new();

        /// <summary>灵纹此刻显示的元素（测试 / 调试读）</summary>
        public Element GlowElement => shownNext;
        /// <summary>弹巢当前转角（弧度）</summary>
        public float CylinderAngle => cylAngle;

        protected override void Build()
        {
            cylinder = Bone("cylinder", "j_8");
            if (cylinder)
            {
                cylBase = cylinder.localRotation;
                cylBasePos = cylinder.localPosition;
            }
            GlowRenderers(gun, glow);
        }

        /// <summary>下一发的元素：轮转武器取 cycle[下标]（换弹中按归零后的第一发）；不轮转的枪就是实例元素</summary>
        public static Element Next(WeaponInstance w, bool reloading)
        {
            if (w == null) return Element.None;
            var c = w.def?.cycle;
            if (c == null || c.Length == 0) return w.element;
            int i = reloading ? 0 : w.cycleIndex;
            return c[((i % c.Length) + c.Length) % c.Length];
        }

        /// <summary>
        /// 锁膛目标角（同 TS animateParts）：want = 下标 × 每格角；从上一个目标出发只向前转到最近的等价位置——
        /// 膛数是轮转长度的整数倍时同色膛等价，周期 = 每格角 × 长度，否则一整圈
        /// </summary>
        public static float LockTarget(float prevTarget, int index, int steps, int cycleLength)
        {
            steps = Mathf.Max(1, steps);
            float step = Mathf.PI * 2 / steps;
            float period = cycleLength > 0 && steps % cycleLength == 0 ? step * cycleLength : Mathf.PI * 2;
            float want = index * step;
            return want + Mathf.Ceil((prevTarget - step * 0.5f - want) / period) * period;
        }

        /// <summary>弹匣（转轮）离位曲线（同 TS magCurve）：12–38% 取出，38–55% 离位，55–78% 装入</summary>
        public static float MagCurve(float p)
        {
            if (p < 0.12f) return 0;
            if (p < 0.38f) return Smooth((p - 0.12f) / 0.26f);
            if (p < 0.55f) return 1;
            if (p < 0.78f) return 1 - Smooth((p - 0.55f) / 0.23f);
            return 0;
        }

        /// <summary>灵纹亮度：呼吸 + 换元素亮闪</summary>
        public static float Pulse(float time, float flash) => 0.82f + 0.14f * Mathf.Sin(time * 3f) + FlashGain * Mathf.Clamp01(flash);

        void OnEnable() => snap = true;

        void LateUpdate()
        {
            if (!wc) return;
            var w = Shown;
            if (w == null) return;
            float dt = Time.deltaTime;
            var sm = wc.Machine;
            bool live = Live;
            bool reloading = live && sm.Reloading;
            bool fullReload = reloading && !sm.ShellReload;
            int len = w.def.cycle?.Length ?? 0;

            if (cylinder)
            {
                magOut = Damp(magOut, fullReload ? MagCurve(sm.ReloadProgress) : 0, 20, dt);
                if (magOut > 0.3f)
                {
                    cylAngle += dt * ReloadSpin;
                    cylTarget = cylAngle;
                }
                else
                {
                    cylTarget = LockTarget(cylTarget, reloading ? 0 : w.cycleIndex, Chambers, len);
                    if (snap) cylAngle = cylTarget;
                    cylAngle = Damp(cylAngle, cylTarget, LockDamp, dt);
                }
                snap = false;
                cylinder.localRotation = cylBase * Quaternion.Euler(0, 0, cylAngle * Mathf.Rad2Deg);
                cylinder.localPosition = cylBasePos + new Vector3(-SwingOut * magOut, 0, 0);
            }

            var next = Next(w, reloading);
            if (!hasShown || next != shownNext)
            {
                if (hasShown) flash = 1;
                shownNext = next;
                hasShown = true;
            }
            flash = Mathf.Max(0, flash - dt * FlashDecay * Mathf.Max(0.2f, flash));
            SetGlow(glow, WeaponTint.ElementColor(next) * (RarityGlow(w.rarity) * Pulse(Time.time, flash)));
        }
    }
}
