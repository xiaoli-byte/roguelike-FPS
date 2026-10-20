using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 贯虹灵炮的第一人称蓄力表现（同 TS Viewmodel：spinner 转速、charge 颤动、能量槽脉动、枪口聚光）：
    ///   线圈（白模节点 j_15，四道加速环）：转速 = 线圈转速 × 42 弧度 / 秒；线圈转速蓄力中等于蓄力进度，松手后 0.6 s 转停（<see cref="ChargeMode.Spin"/>）；
    ///   颤动：蓄力中枪模随机抖 0.0008 + 0.0026·t 米；
    ///   灵纹：亮度 0.8 + 0.7·t，满蓄后 34 Hz 闪烁（未满 18 Hz 微闪）；颜色 = 实例元素色，物理用灵炮的虹紫；
    ///   枪口聚光：一团加色光球，大小 flash × (0.25 + 0.55·t)，满蓄后忽明忽暗。
    /// 松手 / 被打断后灵纹交还 <see cref="WeaponTint"/> 的静态着色。满蓄一击的弹道虹光见 <see cref="RailgunBeam"/>。
    /// </summary>
    public sealed class RailgunCharge : WeaponRigPart
    {
        /// <summary>线圈每单位转速的角速度（弧度 / 秒，TS spinner.rotation.z += spin × 42 × dt）</summary>
        public const float CoilSpeed = 42f;
        /// <summary>美术枪模的枪口（TS 白模 −0.72，美术前端在 −0.63）：找不到 j_0 时用</summary>
        static readonly Vector3 MuzzleFallback = new(0, 0.035f, -0.64f);

        Transform coil, orb;
        Renderer orbRenderer;
        Quaternion coilBase;
        Vector3 gunBasePos;
        float coilAngle;
        bool glowing;
        readonly List<Renderer> glow = new();

        /// <summary>当前蓄力（0..1，测试 / 调试读）</summary>
        public float ChargeNow { get; private set; }

        protected override void Build()
        {
            coil = Bone("coils", "spinner", "j_15");
            if (coil) coilBase = coil.localRotation;
            gunBasePos = gun.localPosition;
            var muzzle = Bone("muzzle", "j_0");
            var at = muzzle ? gun.InverseTransformPoint(muzzle.position) : MuzzleFallback;
            orbRenderer = Piece(gun, "charge_orb", ProjectileMeshes.Sphere, FxMaterials.Additive, Color.clear, at, Vector3.one * 0.01f);
            orb = orbRenderer.transform;
            orb.gameObject.SetActive(false);
            GlowRenderers(gun, glow);
            glow.Remove(orbRenderer);
        }

        /// <summary>灵纹亮度（同 TS charge 武器的 pulse）</summary>
        public static float Pulse(float charge, bool full, float time) =>
            0.8f + 0.7f * Mathf.Clamp01(charge) + (full ? Mathf.Sin(time * 34f) * 0.22f : Mathf.Sin(time * 18f) * 0.06f);

        /// <summary>枪口光球直径（米，枪模空间）：flash × (0.25 + 0.55·t)</summary>
        public static float OrbSize(float flash, float charge) => Mathf.Max(0, flash) * (0.25f + 0.55f * Mathf.Clamp01(charge));

        /// <summary>蓄力颤动幅度（米）</summary>
        public static float Jitter(float charge) => 0.0008f + 0.0026f * Mathf.Clamp01(charge);

        /// <summary>蓄能色：有元素用元素色，物理用灵炮的虹紫（同 TS FULL_CHARGE_GLOW）</summary>
        public static Color EnergyColor(Element e) => e == Element.None ? Ballistics.FullChargeColor : WeaponTint.ElementColor(e);

        void OnDisable()
        {
            if (gun) gun.localPosition = gunBasePos;
            if (orb) orb.gameObject.SetActive(false);
            coilAngle = 0;
            if (coil) coil.localRotation = coilBase;
        }

        void LateUpdate()
        {
            if (!wc || !gun) return;
            float dt = Time.deltaTime;
            var w = Shown;
            var mode = Live ? wc.ActiveMode : null;
            float charge = mode?.Charge ?? 0;
            float spin = mode?.Spin ?? 0;
            bool full = mode is ChargeMode cm && cm.Full;
            bool charging = mode != null && mode.Firing && charge > 0.02f;
            ChargeNow = charge;

            if (coil)
            {
                coilAngle = Mathf.Repeat(coilAngle + spin * CoilSpeed * dt, Mathf.PI * 2);
                coil.localRotation = coilBase * Quaternion.Euler(0, 0, coilAngle * Mathf.Rad2Deg);
            }

            if (charging)
            {
                float j = Jitter(charge);
                gun.localPosition = gunBasePos + new Vector3((Random.value - 0.5f) * j, (Random.value - 0.5f) * j, 0);
            }
            else gun.localPosition = gunBasePos;

            var def = w?.def;
            var color = EnergyColor(w?.element ?? Element.None);
            if (charging && def != null)
            {
                if (!orb.gameObject.activeSelf) orb.gameObject.SetActive(true);
                float size = OrbSize(def.flash, charge) * (0.92f + Random.value * 0.16f);
                orb.localScale = Vector3.one * Mathf.Max(0.002f, size * 0.5f);
                float a = 0.2f + 0.45f * charge + (full ? Random.value * 0.2f : 0);
                FxMaterials.Tint(orbRenderer, color * (1.5f + 1.5f * charge) * a);

                SetGlow(glow, color * (RarityGlow(w.rarity) * Pulse(charge, full, Time.time)));
                glowing = true;
            }
            else
            {
                if (orb.gameObject.activeSelf) orb.gameObject.SetActive(false);
                if (glowing)
                {
                    glowing = false;
                    if (w != null) WeaponTint.Apply(gun.gameObject, w.element, w.rarity);
                }
            }
        }
    }
}
