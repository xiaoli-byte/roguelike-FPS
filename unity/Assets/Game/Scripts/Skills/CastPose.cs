using System;
using UnityEngine;
using Spiritfire.Art;

namespace Spiritfire.Game
{
    /// <summary>技能出手的动作类型（按技能 id 选，三位英雄共用）</summary>
    public enum CastStyle { None, Throw, Summon, Slam, Raise, Mark }

    /// <summary>
    /// 技能出手的覆盖姿态（HC3）：放出技能的那一刻，枪模按动作类型播一段短时间线，叠在 <see cref="FirstPersonViewmodel"/> 的姿态上——
    /// 投掷（燃爆雷、雷鼓信标）往右下一沉、枪口压低，给出手让位；召唤（尾焰火灵）往左上一抬再往前一送；
    /// 砸地（裂地重击）先抬后猛砸、带一下回弹；举手（磐石壁垒）枪往一侧放低；点名（雷目 · 裁决）往后一顿、枪口上挑。
    /// 关键帧之间按 smoothstep 过渡，0.4–0.6 s 放完归零（出手干脆、不拖慢开火：叠加只动枪模，不锁武器）。
    /// [GameSystem]：自动挂在 Game Systems 上，订阅 <see cref="GameEvents.SkillUsed"/>。
    /// </summary>
    [GameSystem(130)]
    public sealed class CastPose : MonoBehaviour
    {
        /// <summary>一个关键帧：时间（秒）、位置（米）、旋转（弧度），约定同 <see cref="FirstPersonViewmodel.OverlayPos"/></summary>
        public readonly struct Key
        {
            public readonly float t;
            public readonly Vector3 pos, rot;

            public Key(float t, Vector3 pos, Vector3 rot)
            {
                this.t = t;
                this.pos = pos;
                this.rot = rot;
            }
        }

        static Key K(float t, float x, float y, float z, float rx, float ry, float rz) => new(t, new Vector3(x, y, z), new Vector3(rx, ry, rz));

        // 每条时间线首尾都是 0：放完就回到原姿态
        static readonly Key[] Throw =
        {
            K(0, 0, 0, 0, 0, 0, 0),
            K(0.08f, 0.04f, -0.07f, 0.02f, -0.3f, 0.05f, -0.22f),
            K(0.2f, 0.05f, -0.09f, 0.03f, -0.38f, 0.06f, -0.28f),
            K(0.42f, 0, 0, 0, 0, 0, 0),
        };
        static readonly Key[] Summon =
        {
            K(0, 0, 0, 0, 0, 0, 0),
            K(0.1f, -0.01f, 0.02f, 0.03f, 0.12f, 0, 0.18f),
            K(0.25f, -0.02f, 0.025f, -0.02f, 0.08f, 0, 0.22f),
            K(0.6f, 0, 0, 0, 0, 0, 0),
        };
        static readonly Key[] Slam =
        {
            K(0, 0, 0, 0, 0, 0, 0),
            K(0.14f, 0, 0.035f, 0.02f, 0.3f, 0, 0.05f),
            K(0.24f, 0, -0.11f, -0.02f, -0.45f, 0, -0.05f),
            K(0.34f, 0, -0.07f, 0, -0.3f, 0, 0),
            K(0.6f, 0, 0, 0, 0, 0, 0),
        };
        static readonly Key[] Raise =
        {
            K(0, 0, 0, 0, 0, 0, 0),
            K(0.12f, -0.03f, -0.08f, 0.02f, -0.25f, 0.1f, 0.3f),
            K(0.3f, -0.03f, -0.08f, 0.02f, -0.25f, 0.1f, 0.3f),
            K(0.55f, 0, 0, 0, 0, 0, 0),
        };
        static readonly Key[] Mark =
        {
            K(0, 0, 0, 0, 0, 0, 0),
            K(0.06f, 0, 0.01f, 0.035f, 0.16f, 0, 0.04f),
            K(0.4f, 0, 0, 0, 0, 0, 0),
        };

        /// <summary>技能 id → 动作类型（没登记的技能不播）</summary>
        public static CastStyle StyleFor(string skillId) => skillId switch
        {
            "fox_blaze_grenade" or "falcon_storm_beacon" => CastStyle.Throw,
            "fox_nine_tails" => CastStyle.Summon,
            "bear_earth_splitter" => CastStyle.Slam,
            "bear_bastion" => CastStyle.Raise,
            "falcon_hawk_verdict" => CastStyle.Mark,
            _ => CastStyle.None,
        };

        public static Key[] Timeline(CastStyle s) => s switch
        {
            CastStyle.Throw => Throw,
            CastStyle.Summon => Summon,
            CastStyle.Slam => Slam,
            CastStyle.Raise => Raise,
            CastStyle.Mark => Mark,
            _ => Array.Empty<Key>(),
        };

        /// <summary>时间线在 t 秒的姿态（关键帧之间 smoothstep；超出末帧 = 0）</summary>
        public static void Evaluate(Key[] keys, float t, out Vector3 pos, out Vector3 rot)
        {
            pos = rot = Vector3.zero;
            if (keys.Length < 2 || t <= keys[0].t || t >= keys[^1].t) return;
            for (int i = 1; i < keys.Length; i++)
            {
                if (t > keys[i].t) continue;
                var a = keys[i - 1];
                var b = keys[i];
                float u = Mathf.SmoothStep(0, 1, (t - a.t) / Mathf.Max(1e-4f, b.t - a.t));
                pos = Vector3.LerpUnclamped(a.pos, b.pos, u);
                rot = Vector3.LerpUnclamped(a.rot, b.rot, u);
                return;
            }
        }

        Key[] playing;
        float startedAt;

        /// <summary>正在播的动作（测试 / 套件读）</summary>
        public CastStyle Playing { get; private set; }

        void OnEnable() => GameEvents.SkillUsed += OnSkillUsed;

        void OnDisable()
        {
            GameEvents.SkillUsed -= OnSkillUsed;
            Stop();
        }

        void OnSkillUsed(SkillSlot slot, string id) => Play(StyleFor(id));

        /// <summary>从头播一段动作（新的打断旧的）</summary>
        public void Play(CastStyle style)
        {
            var keys = Timeline(style);
            if (keys.Length < 2) return;
            playing = keys;
            Playing = style;
            startedAt = Time.time;
        }

        void Stop()
        {
            playing = null;
            Playing = CastStyle.None;
            FirstPersonViewmodel.OverlayPos = FirstPersonViewmodel.OverlayRot = Vector3.zero;
        }

        void Update()
        {
            if (playing == null) return;
            float t = Time.time - startedAt;
            if (t >= playing[^1].t)
            {
                Stop();
                return;
            }
            Evaluate(playing, t, out var pos, out var rot);
            FirstPersonViewmodel.OverlayPos = pos;
            FirstPersonViewmodel.OverlayRot = rot;
        }
    }
}
