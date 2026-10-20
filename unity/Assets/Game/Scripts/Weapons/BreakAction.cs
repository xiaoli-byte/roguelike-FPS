using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 赤蛟霰铳的折开换弹（同 TS ReloadBreech + Viewmodel：铰链 reload.breech 在 (0, 0.004, −0.035)，逐发装填期间枪管组下折 0.48 弧度，阻尼 10）：
    ///   开合程度 open 逐渐逼近「逐发装填中」（准备、每一发、上膛前都算开着，装满 / 打断后合上）；
    ///   枪管关节：有 barrels / breech / reload.breech 节点时绕枪模的横轴转它（枪口向下）；
    ///   美术枪模还没有枪管关节（W3 拆出之前）：整支枪绕铰链点低头 0.48 × 40% 代替（手臂跟着枪走，读起来像「掰开枪身」）；
    ///   弹壳：每压一发，膛口上方出现一枚弹壳（TS 同色 #b86b32），在这一发进度 22%–98% 可见，后半段滑进当前这根枪管（两管交替）。
    /// </summary>
    public sealed class BreakAction : WeaponRigPart
    {
        /// <summary>完全折开的角度（弧度）、没有枪管关节时整枪低头的比例</summary>
        public const float OpenAngle = 0.48f, FallbackScale = 0.4f;
        /// <summary>铰链（枪模空间）、两根枪管的横向位置、膛口 z（TS 枪管从 z &lt; −0.065 开始）</summary>
        public static readonly Vector3 Hinge = new(0, 0.004f, -0.035f);
        public const float BoreX = 0.019f, BoreY = 0.04f, ChamberZ = -0.065f, ShellLength = 0.052f;
        static readonly Color ShellColor = Hex.Rgb(0xb86b32);

        Transform barrels, shell;
        Quaternion barrelsRel, gunBaseRot;
        Vector3 gunBasePos;
        float open;

        /// <summary>当前开合程度 0..1（测试 / 调试读）</summary>
        public float Open => open;
        /// <summary>美术有枪管关节（false = 整枪低头代替）</summary>
        public bool HasHinge => barrels;

        protected override void Build()
        {
            barrels = Bone("barrels", "breech", "reload.breech");
            if (barrels) barrelsRel = Quaternion.Inverse(gun.rotation) * barrels.rotation;
            gunBasePos = gun.localPosition;
            gunBaseRot = gun.localRotation;
            shell = Piece(gun, "reload.shell", ProjectileMeshes.Box, Lit, ShellColor, Vector3.zero,
                new Vector3(0.013f, 0.013f, ShellLength)).transform;
            shell.gameObject.SetActive(false);
        }

        /// <summary>这一发的弹壳可见窗口（同 TS rounds：逐发装填中、单发进度 0.22–0.98）</summary>
        public static bool ShellVisible(bool shellReload, float shellProgress) => shellReload && shellProgress > 0.22f && shellProgress < 0.98f;

        /// <summary>弹壳位置（枪模空间）：先停在膛口后上方（手把它递过来），进度 55%–92% 滑进第 bore 根枪管（0 右 1 左）</summary>
        public static Vector3 ShellPose(float shellProgress, int bore)
        {
            float x = (bore % 2 == 0 ? 1 : -1) * BoreX;
            var inserted = new Vector3(x, BoreY, ChamberZ - ShellLength * 0.5f);
            var held = new Vector3(x, BoreY + 0.035f, ChamberZ + 0.045f);
            return Vector3.Lerp(held, inserted, Smooth((shellProgress - 0.55f) / 0.37f));
        }

        void OnDisable()
        {
            open = 0;
            Apply(0);
            if (shell) shell.gameObject.SetActive(false);
        }

        void LateUpdate()
        {
            if (!wc || !gun) return;
            var sm = wc.Machine;
            bool live = Live;
            bool shellReload = live && sm.Reloading && sm.ShellReload;
            open = Damp(open, shellReload ? 1 : 0, 10, Time.deltaTime);
            Apply(open);

            float p = shellReload ? sm.ShellProgress : 0;
            bool show = ShellVisible(shellReload, p);
            if (shell.gameObject.activeSelf != show) shell.gameObject.SetActive(show);
            if (show) shell.localPosition = ShellPose(p, sm.ShellsInserted);
        }

        void Apply(float k)
        {
            float rad = -OpenAngle * k;
            if (barrels)
            {
                barrels.rotation = Quaternion.AngleAxis(rad * Mathf.Rad2Deg, gun.right) * (gun.rotation * barrelsRel);
                return;
            }
            if (!gun) return;
            // 整枪绕铰链点（枪模空间）转：铰链在父空间的位置保持不动
            var r = Quaternion.AngleAxis(rad * FallbackScale * Mathf.Rad2Deg, Vector3.right);
            var h = Vector3.Scale(gun.localScale, Hinge);
            gun.localRotation = gunBaseRot * r;
            gun.localPosition = gunBasePos + gunBaseRot * h - gunBaseRot * (r * h);
        }
    }
}
