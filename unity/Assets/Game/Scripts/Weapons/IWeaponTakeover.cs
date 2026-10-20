using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>接管者每帧拿到的输入（已经过输入权判断）</summary>
    public struct TakeoverInput
    {
        public float dt;
        /// <summary>左键（碎刃：斩）</summary>
        public bool fireDown, firePressed;
        /// <summary>右键（碎刃：千刃出窍）</summary>
        public bool aimDown;
        /// <summary>R（碎刃：碎刃屏障）</summary>
        public bool reloadDown;
        /// <summary>武器技能键 V / 中键（碎刃：杀气爆发 / 人刀合一）</summary>
        public bool skillPressed;
        /// <summary>切枪完毕且活着</summary>
        public bool ready;
        /// <summary>攻速倍率（武器射速倍率）</summary>
        public float speed;
    }

    /// <summary>
    /// 武器接管（同 TS WeaponSystem 里碎刃的分支）：当前武器被接管时，<see cref="WeaponController"/> 不开镜、不换弹、不走开火模式，
    /// 每帧把输入交给接管者；<see cref="OwnsViewmodel"/> 为真时连第一人称 rig 也不显示，由接管者自己画。
    /// 切枪仍由控制器管（切走 / 换关 / 跨关恢复时调 <see cref="Release"/>；死亡时照常 Tick，ready = false）。碎刃（WC5–WC7）实现它并在 <see cref="WeaponTakeovers"/> 登记。
    /// 冷却、杀意之类不论当前武器都要推进的计时，接管者自己在 Update 里跑。
    /// </summary>
    public interface IWeaponTakeover
    {
        /// <summary>这把枪归我管（例如 def.IsBlade）</summary>
        bool Handles(WeaponInstance w);
        /// <summary>接管第一人称渲染：true 时控制器隐藏这把枪的 rig、不写开镜 / 下沉 / 后坐</summary>
        bool OwnsViewmodel { get; }
        /// <summary>接管期间 HUD 读的数据源；null = 仍用控制器的</summary>
        IWeaponHudSource Hud { get; }
        /// <summary>切到这把枪（掏枪开始时；之后 <see cref="TakeoverInput.ready"/> 才变真）</summary>
        void Engage(WeaponController wc, WeaponInstance w);
        void Tick(WeaponController wc, WeaponInstance w, in TakeoverInput input);
        /// <summary>收起（切走、换关、跨关恢复、组件停用）：碎片归位、持续动作结束</summary>
        void Release(WeaponController wc);
    }

    /// <summary>接管者登记表（进入 Play 时清空，接管者在自己的自举里登记）</summary>
    public static class WeaponTakeovers
    {
        static readonly List<IWeaponTakeover> all = new();

        public static IReadOnlyList<IWeaponTakeover> All => all;

        public static void Register(IWeaponTakeover t)
        {
            if (t != null && !all.Contains(t)) all.Add(t);
        }

        public static void Unregister(IWeaponTakeover t) => all.Remove(t);

        /// <summary>第一个声明管这把枪的接管者；没有为 null</summary>
        public static IWeaponTakeover Find(WeaponInstance w)
        {
            if (w == null) return null;
            for (int i = 0; i < all.Count; i++)
                if (all[i] != null && all[i].Handles(w)) return all[i];
            return null;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetAll() => all.Clear();
    }
}
