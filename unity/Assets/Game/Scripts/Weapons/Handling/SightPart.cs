using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 瞄具零件（WC1，挂在 rig 上的 <see cref="WeaponRigPart"/>，由 <see cref="WeaponRigParts"/> 按武器 id 自动补挂）：
    ///   · 建：登记了零件表的瞄具（红点 / 筒式，<see cref="WeaponSight"/>）在枪模下补一份占位网格（<see cref="WeaponSightBuilder"/>）；
    ///     显示的那把枪换了（切到同 id 不同品质的枪）就按它的稀有度重涂稀有度色零件；
    ///   · 开镜：手上就是这把、进了镜（<see cref="WeaponSight.Scoped"/>：视角层 &lt; −30°，同 TS Viewmodel 的 root.visible = !scoped）时
    ///     关掉整套 rig 的渲染器（枪模、手臂、瞄具；只关原本开着的，退镜 / rig 停用时原样打开，不碰 PlayerFactory 关掉的 LOD1+），
    ///     镜内遮罩由 <see cref="ScopeOverlay"/> 画。换弹 / 切枪 / 冲刺时控制器不让开镜，视角层回落就自动退镜。
    /// 登记：进入 Play 前把武器表里每条 <see cref="WeaponSight"/> 都登记成这个零件（每把枪只能有一种零件；同时要转管的枪以后再合并）。
    /// </summary>
    public sealed class SightPart : WeaponRigPart
    {
        WeaponSight sight;
        readonly List<Renderer> hidden = new();
        int paintedUid = -1, paintedRarity = -1;

        /// <summary>这把 rig 此刻因为进了镜而隐藏着（测试读）</summary>
        public bool Hiding { get; private set; }
        /// <summary>占位瞄具根节点（没有零件表的瞄准镜为 null）</summary>
        public Transform Mesh { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void RegisterAll()
        {
            foreach (var s in Registry<WeaponSight>.All)
                if (s.kind != SightKind.None) WeaponRigParts.Register(s.weaponId, typeof(SightPart));
        }

        protected override void Build()
        {
            sight = WeaponSight.For(weaponId);
            if (sight != null) Mesh = WeaponSightBuilder.Attach(gun, sight);
        }

        void LateUpdate()
        {
            if (!wc || sight == null) return;
            var shown = Shown;
            if (shown != null && Mesh && (shown.uid != paintedUid || shown.rarity != paintedRarity))
            {
                paintedUid = shown.uid;
                paintedRarity = shown.rarity;
                WeaponSightBuilder.SetRarity(Mesh, sight, shown.rarity);
            }
            bool scoped = Live && wc.enabled && wc.Takeover == null && WeaponSight.Scoped(wc.FovKick);
            if (scoped == Hiding) return;
            if (scoped) Hide();
            else Restore();
        }

        void OnDisable() => Restore();

        void Hide()
        {
            Hiding = true;
            foreach (var r in GetComponentsInChildren<Renderer>(true))
            {
                if (!r.enabled) continue;
                r.enabled = false;
                hidden.Add(r);
            }
        }

        void Restore()
        {
            foreach (var r in hidden)
                if (r) r.enabled = true;
            hidden.Clear();
            Hiding = false;
        }
    }
}
