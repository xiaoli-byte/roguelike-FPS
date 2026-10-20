using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>开火模式的公共部分：缺省的只读状态，以及「按射速补发」的连发循环（全自动 / 光束 / 机炮共用）</summary>
    public abstract class FireModeBase : IFireMode
    {
        protected readonly WeaponDef def;

        protected FireModeBase(WeaponDef def) => this.def = def;

        public abstract string Id { get; }
        public abstract void Tick(in FireInput input, IFireHost host);
        public virtual void Cancel() { }
        public virtual void Stop(IFireHost host, bool flush) => Cancel();
        public virtual bool Busy => false;
        public virtual bool Firing => false;
        public virtual float Charge => 0;
        public virtual float Spin => 0;
        public virtual float MoveSlow => 0;

        /// <summary>两发之间的间隔（秒）：射速下限 0.1 发 / 秒</summary>
        public static float Interval(float rate) => 1f / Mathf.Max(0.1f, rate);

        /// <summary>
        /// 连发（同 TS autoFire）：冷却到了就打，冷却累加而不是重置——保留余量，射速与帧率无关；
        /// 同一帧最多 <see cref="WeaponTiming.MaxCatchUp"/> 发。宿主在帧末把负冷却钳回 0，所以停火再开不会一下子补一串。返回本帧发数
        /// </summary>
        protected static int Repeat(in FireInput input, IFireHost host)
        {
            float gap = Interval(input.rate);
            int n = 0;
            while (host.Cooldown <= 0 && n < WeaponTiming.MaxCatchUp && host.HasAmmo)
            {
                host.Shoot(in ShotMods.None);
                host.Cooldown += gap;
                n++;
            }
            return n;
        }
    }
}
