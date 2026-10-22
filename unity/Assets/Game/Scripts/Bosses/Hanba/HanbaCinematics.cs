using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃的演出层（docs/unity-parity.md 第 5 节 BS2「登场 / 转阶段 / 死亡演出」）：代码驱动，不用 Timeline（D20 允许，片段的事件时刻对得上就行）。
    /// 挂在首领物体上、和行为组件分开——首领倒下时 EnemyAI 会把行为组件停用（之后 Update、动画事件都不再走 <see cref="HanbaBrain"/>），死亡演出靠这里接着跑。
    ///   · 名字卡：登场时由框架打（BossIntroDef.banner，名字 + 称号）；转阶段时这里打阶段名卡（「二 · 焦土」「三 · 赤地千里」，<see cref="Card"/>）。
    ///   · 慢动作：<see cref="SlowMo"/> 经 <see cref="TimeScaleArbiter"/> 申请（优先级 = 顿帧 + 50：压过顿帧、让给阵亡慢动作和场景过渡），按真实时间撤销；
    ///     组件停用 / 销毁时一定撤销，时间不会卡在慢速。登场长啸、进二 / 三阶段各一下；倒下那一下由框架的 <see cref="BossDefeatSequence"/>（阵亡慢动作）放。
    ///   · 震屏：长啸、转阶段、倒地（death 片段 2.0 s collapse、3.17 s 跪落，和 events.json 同一时刻；首领倒下后动画事件不再转发，这里按时间补上）。
    ///   · 死亡演出（<see cref="Defeat"/>）：悬浮的身体慢慢落地；升到头顶的日轮砸回地面碎掉（没升顶就原地熄灭）；倒地后泉眼复涌（<see cref="HanbaSpring.Refill"/>），
    ///     被推到头顶 / 压暗的太阳用 <see cref="SunRestoreSeconds"/> 秒回到第一次接手时的午后（<see cref="HanbaSunDriver.Restore"/>，影子慢慢回来）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HanbaCinematics : MonoBehaviour
    {
        /// <summary>演出慢动作的优先级：压过顿帧（100），让给阵亡慢动作（200）</summary>
        public const int SlowMoPriority = TimeScaleArbiter.Priority.HitStop + 50;
        /// <summary>death 片段里的倒地 / 跪落时刻（秒，片段 4 s：collapse 在 60 帧、跪落在 95 帧）；泉眼复涌在倒地之后</summary>
        public const float CollapseAt = 2.0f, KneelAt = 3.17f, RefillAt = 2.4f, RefillSeconds = 3f, SunRestoreSeconds = 5f;

        TimeScaleArbiter.Handle slow;
        float slowUntil;
        HanbaBrain boss;
        float deathT = -1, sinkFrom;
        bool collapsed, kneeled, refilled;

        /// <summary>放过几次演出慢动作、最近一次的倍率（测试用）</summary>
        public int SlowMos { get; private set; }
        public float LastSlowScale { get; private set; } = 1f;
        /// <summary>演出慢动作正在生效</summary>
        public bool Slowing => slow != null && slow.Live;
        /// <summary>打过的阶段名卡（测试用）</summary>
        public int Cards { get; private set; }
        public string LastCard { get; private set; }
        /// <summary>死亡演出：开始了、泉眼复涌了</summary>
        public bool DefeatStarted => deathT >= 0;
        public bool Refilled => refilled;

        /// <summary>申请一段演出慢动作（scale 倍速，持续 realSeconds 真实秒）；已有一段时换成新的</summary>
        public void SlowMo(float scale, float realSeconds)
        {
            if (!(scale > 0 && scale < 1) || !(realSeconds > 0)) return;
            Release();
            slow = TimeScaleArbiter.Request(this, scale, SlowMoPriority);
            slowUntil = Time.unscaledTime + realSeconds;
            SlowMos++;
            LastSlowScale = scale;
        }

        /// <summary>阶段名卡（大横幅）</summary>
        public void Card(string title, string sub, float seconds = 2.6f)
        {
            if (string.IsNullOrEmpty(title)) return;
            GameUI.Banner(title, sub, seconds);
            Cards++;
            LastCard = title;
        }

        /// <summary>死亡演出（首领倒下时由 <see cref="HanbaBrain"/> 调一次）</summary>
        public void Defeat(HanbaBrain b)
        {
            if (deathT >= 0) return;
            boss = b;
            deathT = 0;
            sinkFrom = b ? b.HoverNow : 0;
            var ring = b ? b.Ring : null;
            if (ring && ring.Risen) ring.Fall(b.transform.position, 1.1f);
        }

        void Update()
        {
            if (slow != null && Time.unscaledTime >= slowUntil) Release();
            if (deathT < 0) return;
            deathT += Time.deltaTime;
            Sink();
            if (!collapsed && deathT >= CollapseAt)
            {
                collapsed = true;
                CameraShake.Quake(transform.position, 0.55f, 60f, 0.5f);
                Fx.Burst(transform.position + Vector3.up * 0.3f, HanbaDef.Sand, 26, 6f, 0.9f, 0.4f, 6f);
            }
            if (!kneeled && deathT >= KneelAt)
            {
                kneeled = true;
                CameraShake.Quake(transform.position, 0.45f, 60f, 0.4f);
                GameAudio.PlayAt("boss_slam", transform.position + Vector3.up, 0.8f, 0.8f);
            }
            if (!refilled && deathT >= RefillAt)
            {
                refilled = true;
                var spring = boss ? boss.Spring : null;
                if (spring && spring.Level < 0.99f)
                {
                    spring.Refill(RefillSeconds);
                    GameAudio.PlayAt("shield_recharge", transform.position, 0.8f, 0.6f);
                }
                // 太阳回到午后（只在这一战动过主光时）
                var sky = SunExposure.OpenSky ? HanbaSunDriver.Find() : null;
                if (sky && (sky.Drives > 0 || sky.Dim < 0.99f)) sky.Restore(SunRestoreSeconds);
            }
        }

        /// <summary>悬浮的身体在 1.5 s 内落到地面（行为组件停了，悬浮层不再跑）</summary>
        void Sink()
        {
            var m = boss ? boss.Model : null;
            if (m == null || !m.root) return;
            float k = Mathf.Clamp01(deathT / 1.5f);
            float s = Mathf.Max(0.01f, m.scale);
            m.root.transform.localPosition = Vector3.up * (Mathf.Lerp(sinkFrom, 0, k * k) / s);
        }

        void Release()
        {
            slow?.Dispose();
            slow = null;
        }

        void OnDisable() => Release();

        void OnDestroy() => Release();
    }
}
