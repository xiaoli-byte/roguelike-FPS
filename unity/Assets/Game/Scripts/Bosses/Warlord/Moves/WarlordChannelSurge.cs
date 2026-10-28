using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将 · 熔铜渠涨落（D5：TS 的「方场熔岩涌动」在 3-3 改成神范台的熔铜渠涨落；二阶段起、渠没在涨时才出，越过 50% 后第一招就是它）：
    ///   插剑入地（plant，前摇 0.45 s）→ 剑落地的一刻引动神范台的十字浅渠和中央熔池（<see cref="FoundryChannels.Flood"/>）：
    ///   每片熔岩先翻涌发亮 2.4 s，同时铺满渠岸的预警长条（hazard 组：招式被打断也照常兑现）；再 1.2 s 涨过渠岸 0.75 m——渠岸上的人下沉托回、扣血；
    ///   高位停 6 s（狂怒 8 s）后自己退回。桥和象限中央是干的：躲涨潮就是上桥、往象限中央跑。
    /// 场地里没有熔铜渠时（测试场、临时场地）退回 TS 的写法：场地外圈环带熔岩（预警 3 s、持续 10 s，内圈半径按场地缩放），同参考招式 <see cref="WarlordLava"/>。
    /// </summary>
    public sealed class WarlordChannelSurge : ReferenceMove
    {
        public const string MoveId = "warlord_channels";
        public override string Id => MoveId;
        public override string Name => "魔将 · 熔铜渠涨落";

        FoundryChannels channels;
        HazardZone ring;
        bool announced;

        /// <summary>引动过几次熔铜渠、退回环带写法几次、这次画了几条渠岸预警（测试用）</summary>
        public int Floods { get; private set; }
        public int Fallbacks { get; private set; }
        public int LastWarnings { get; private set; }
        /// <summary>这次高位停的秒数</summary>
        public float LastHold { get; private set; }

        public WarlordChannelSurge()
        {
            cooldown = 22f;
            recovery = 0.6f;
            windup = 0.45f;
            active = 0.85f;
            recover = 0.1f;
        }

        FoundryChannels Channels => channels ? channels : channels = Brain is WarlordBrain w && w.Channels ? w.Channels : FoundryChannels.For(Brain.Arena);

        /// <summary>熔铜渠（或兜底的环带）还在涨 / 生效</summary>
        public bool Active => Channels ? Channels.Flooding : ring && !ring.Ended;

        public override float Weight(BossBrain b) => b.Phase >= 1 && !Active ? 2.5f : 0f;

        protected override void OnStart()
        {
            Brain.Halt();
            Sfx("boss_roar", 0.8f);
            LastWarnings = 0;
        }

        protected override void OnTelegraph()
        {
            Hazards.GroundWarning(OnGround(Brain.transform.position), 3.2f, WindupTime, WarlordRef.Warn);
            Brain.Glow(0, 1);
        }

        protected override void OnWindup(float dt) => Brain.Face(Brain.PlayerPosition, 200f, dt);

        protected override void OnActiveBegin()
        {
            var c = OnGround(Brain.transform.position);
            Brain.Shake(0.4f, 1.6f);
            Fx.Ring(c + Vector3.up * 0.1f, 12f, WarlordRef.Lava, 0.9f);
            Fx.Burst(c + Vector3.up * 0.5f, WarlordRef.Embers, 30, 8f, 0.9f, 0.2f, 4f);
            // 跺地引渠：脚下砸出一圈尘浪 + 熔铜四溅
            Fx.Slam(c, 4f, Hex.Rgb(0x4a3a30));
            Fx.MoltenBurst(c + Vector3.up * 0.3f, 1.8f, false);
            Sfx("boss_slam", 1f, 0.7f);
            var ch = Channels;
            if (ch && ch.Count > 0) FloodChannels(ch);
            else RingFallback();
            if (announced) return;
            announced = true;
            GameUI.Toast(ch && ch.Count > 0 ? "熔铜渠要漫上来了——上桥，或往象限中央躲！" : "熔岩正在涌向外圈——靠近中心或站上高处！", Hex.Rgb(0xff6a2a));
        }

        /// <summary>引动熔铜渠：每片熔岩的漫溢范围铺一条预警（盒按长边铺长条、熔池铺圆），填满的那一刻熔岩正好漫过渠岸</summary>
        void FloodChannels(FoundryChannels ch)
        {
            float hold = Brain.Def is WarlordDef wd ? wd.SurgeHoldAt(Phase) : 6f;
            if (Brain.Enraged) hold += 2f;
            LastHold = hold;
            if (ch.Flood(hold)) Floods++;
            float fill = ch.warn + ch.riseTime;
            foreach (var v in ch.surge)
            {
                if (!v) continue;
                var b = v.Body;
                var center = new Vector3(b.center.x, Floor + 0.02f, b.center.z);
                if (v.shape == LavaShape.Disc)
                    Hazards.GroundWarning(center, v.size.x, fill, WarlordRef.Lava, WarnKind.Hazard);
                else
                {
                    // 盒：沿本地 +Z（长边）从一头铺到另一头，半宽 = 盒宽的一半
                    var fwd = v.transform.forward;
                    fwd.y = 0;
                    fwd.Normalize();
                    var from = center - fwd * v.size.y * 0.5f;
                    float yaw = Mathf.Atan2(fwd.x, fwd.z) * Mathf.Rad2Deg;
                    Hazards.LineWarning(from, yaw, v.size.y, v.size.x * 0.5f, fill, WarlordRef.Lava, 0.3f, WarnKind.Hazard);
                }
                LastWarnings++;
                SurgeFx(v, center, fill);
            }
        }

        /// <summary>
        /// 熔铜渠涨的样子（只有外观）：漫上来之前渠里咕嘟冒熔泡、溅熔滴；漫过渠岸那一下沿渠从一头到另一头涌过一串熔铜浪（长条），熔池一圈往外溅
        /// </summary>
        void SurgeFx(LavaVolume v, Vector3 center, float fill)
        {
            var fwd = v.transform.forward;
            fwd.y = 0;
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.forward;
            fwd.Normalize();
            var right = Vector3.Cross(Vector3.up, fwd);
            bool disc = v.shape == LavaShape.Disc;
            float len = disc ? v.size.x : v.size.y, wid = disc ? v.size.x : v.size.x;
            // 冒泡：涨到一半起越冒越密
            Hazards.Repeat(0.22f, fill, () =>
            {
                var p = disc
                    ? center + Quaternion.Euler(0, Random.value * 360f, 0) * Vector3.forward * (Mathf.Sqrt(Random.value) * len * 0.8f)
                    : center + fwd * Random.Range(-0.5f, 0.5f) * len + right * Random.Range(-0.35f, 0.35f) * wid;
                Fx.MoltenSplash(p + Vector3.up * 0.15f, Random.Range(0.6f, 1.1f));
            });
            if (disc)
            {
                Hazards.Later(Mathf.Max(0.1f, fill - 0.15f), () =>
                {
                    for (int i = 0; i < 6; i++)
                    {
                        float a = i / 6f * Mathf.PI * 2f + Random.Range(-0.3f, 0.3f);
                        Fx.MoltenSplash(center + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * len * 0.9f + Vector3.up * 0.2f, 1.3f);
                    }
                    Fx.Ring(center + Vector3.up * 0.1f, len * 1.2f, WarlordRef.Lava, 0.6f, false);
                });
                return;
            }
            // 长条：一串熔铜浪从渠头涌到渠尾（每 0.08 s 一个，约 4 m 一个）
            int n = Mathf.Clamp(Mathf.RoundToInt(len / 4f), 2, 6);
            for (int i = 0; i < n; i++)
            {
                var p = center + fwd * ((i + 0.5f) / n - 0.5f) * len;
                float at = Mathf.Max(0.1f, fill - 0.35f) + i * 0.08f;
                Hazards.Later(at, () => Fx.MoltenBurst(p + Vector3.up * 0.2f, Mathf.Clamp(wid * 0.45f, 0.8f, 1.8f), false));
            }
        }

        /// <summary>兜底（场地里没有熔铜渠）：TS 的外圈环带熔岩</summary>
        void RingFallback()
        {
            Fallbacks++;
            var c = Brain.Arena ? Brain.Arena.Center : Brain.transform.position;
            c.y = Floor;
            float extent = Brain.Arena ? Brain.Arena.Extent : 20f;
            float inner = Mathf.Clamp(extent * 0.38f, 5f, 15f);
            ring = Hazards.Zone(new BossZoneSpec(c, extent + 20f, 10f, Dmg(5), WarlordRef.Lava)
            {
                innerRadius = inner, arm = 3f, interval = 0.5f, embers = true, element = Element.Fire, maxHeight = 0.8f,
            });
            LastWarnings++;
        }

        protected override void OnEnd(bool cancelled) => Brain.Glow(0, 0);
    }
}
