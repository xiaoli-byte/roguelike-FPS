using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 实机顾客：玩家（<see cref="PlayerVitals"/> + <see cref="WeaponController"/>）、本局钱包（<see cref="RunState"/>）、秘卷（<see cref="LootDirector.scrolls"/>）。
    /// 「战斗中」= 场上有活着的首领，或商店 <see cref="CombatRadius"/> 米内有活着、没被定身演出挡住的敌人（开放大图里远处的敌人不挡补给）。
    /// 能交易 = 正常游玩（<see cref="GameStateMachine.IsPlaying"/>，没有暂停 / 模态 / 结算）且玩家活着
    /// </summary>
    public sealed class PlayerShopCustomer : IShopCustomer
    {
        /// <summary>商店附近多远内有敌人就算交战中（米）</summary>
        public const float CombatRadius = 28f;

        static readonly Color DenyColor = Hex.Rgb(0xff5a4f);
        static readonly List<EnemyAI> near = new();

        public static readonly PlayerShopCustomer Instance = new();

        PlayerVitals Vitals => PlayerVitals.Instance;
        WeaponController Wc => Vitals ? Vitals.GetComponent<WeaponController>() : null;

        public int Coins => RunState.Current?.coins ?? 0;
        public bool TrySpend(int price) => RunState.Ensure().TrySpend(price);
        public bool CanTrade => Vitals && !Vitals.Dead && GameStateMachine.IsPlaying;
        public int Frame => Time.frameCount;
        public int Chapter => EconomyConfig.Chapter;

        public int HostilesNear(Vector3 at)
        {
            foreach (var b in BossBrain.Active)
                if (b && !b.Dead)
                    return 1;
            near.Clear();
            int n = EnemyRegistry.InRadius(at, CombatRadius, near);
            near.Clear();
            return n;
        }

        public float Health => Vitals ? Vitals.health : 0;
        public float MaxHealth => Vitals ? Vitals.MaxHealth : 0;
        public float Shield => Vitals ? Vitals.shield : 0;
        public float MaxShield => Vitals ? Vitals.MaxShield : 0;
        public float Heal(float amount) => Vitals ? Vitals.Heal(amount) : 0;
        public float AddShield(float amount) => Vitals ? Vitals.AddShield(amount) : 0;

        public WeaponInstance ActiveWeapon => Wc ? Wc.Active : null;
        public IReadOnlyList<WeaponInstance> Weapons => Wc ? Wc.slots : System.Array.Empty<WeaponInstance>();
        public int ReserveCapacity(WeaponInstance w) => w == null ? 0 : WeaponStatsResolver.Resolve(w).reserveCap;
        public bool AddAmmoFraction(float fraction) => Wc && Wc.AddAmmoFraction(fraction);
        public WeaponInstance GiveWeapon(WeaponInstance w) => Wc ? Wc.Give(w) : null;
        public int? UpgradeCost(WeaponInstance w) => WeaponLibrary.UpgradeCost(w, Chapter);

        public bool Upgrade(WeaponInstance w)
        {
            bool ok = WeaponLibrary.Upgrade(w);
            return ok;
        }

        public (float damage, float dps) WeaponNumbers(WeaponInstance w)
        {
            if (w == null) return (0, 0);
            var r = WeaponStatsResolver.Resolve(w);
            return (r.damage, r.dps);
        }

        public int ScrollStacks(string id) => LootDirector.Instance ? LootDirector.Instance.scrolls.Stacks(id) : 0;
        public bool GainScroll(ScrollDef def) => LootDirector.Instance && Vitals && LootDirector.Instance.scrolls.Gain(def, Vitals);

        public void Deny(string message)
        {
            GameAudio.Play("ui_deny");
            GameUI.Toast(message, DenyColor);
        }

        public void Notify(string message, Color color) => GameUI.Toast(message, color);
        public void Sound(string id, float volume = 1f) => GameAudio.Play(id, volume);
        public void DropWeapon(WeaponInstance w, Vector3 at) => WeaponPickup.Drop(w, at, Vector3.up * 3f);
    }
}
