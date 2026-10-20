using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 齐射（蜂群飞弹；碎刃的固定扇形以后也走它）：扣一下耗 1 发弹药，按 projectile.stagger 的间隔依次发出 projectile.count 枚弹体（同 TS volleyLeft / updateVolley）。
    /// 追踪由弹体自己做（projectile.homing → <see cref="PlayerProjectileSpec.homing"/>）。
    /// 齐射中不能再扣、不能换弹；切枪 / 拾取替换时剩下的弹体立即打完（弹药已扣，同 TS finishVolley）。
    /// 固定扇形（fanFixed）一轮只有第一枚有后坐 / 音效；随机散开的每枚都有。
    /// 扳机规则同半自动，冷却 1 / 射速从扣下时算。
    /// </summary>
    public sealed class VolleyMode : FireModeBase
    {
        int left, count;
        float timer;

        public VolleyMode(WeaponDef def) : base(def) { }

        public override string Id => "volley";
        public override bool Busy => left > 0;
        /// <summary>这一轮还剩几枚没发</summary>
        public int Left => left;
        /// <summary>每轮弹体数</summary>
        public int Count => def.projectile != null ? Mathf.Max(1, def.projectile.count) : 1;

        public override void Tick(in FireInput input, IFireHost host)
        {
            if (left == 0 && (input.pulled || (input.testAuto && input.down)) && input.CanShoot && host.HasAmmo && host.Cooldown <= 0)
            {
                host.ConsumeTrigger();
                host.Shoot(in ShotMods.Volley);
                host.Cooldown = Interval(input.rate);
                count = left = Count;
                timer = 0;
                Advance(host);
            }
            if (left <= 0) return;
            // 同 TS：开始这一帧也扣掉 dt（第二枚在 stagger 秒后、按帧对齐）
            timer -= input.dt;
            Advance(host);
        }

        void Advance(IFireHost host)
        {
            float stagger = def.projectile != null ? Mathf.Max(0, def.projectile.stagger) : 0;
            bool fixedFan = def.projectile != null && def.projectile.fanFixed;
            while (left > 0 && timer <= 0)
            {
                int i = count - left;
                host.VolleyProjectile(i, count, !fixedFan || i == 0);
                left--;
                timer += stagger;
            }
        }

        public override void Stop(IFireHost host, bool flush)
        {
            if (flush)
            {
                // 收尾的这几枚不再给后坐 / 音效（同 TS finishVolley）
                while (left > 0)
                {
                    int i = count - left;
                    host.VolleyProjectile(i, count, false);
                    left--;
                }
            }
            left = 0;
        }
    }
}
