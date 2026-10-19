using System.Text;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>
    /// 战斗调试叠层（开发版专用，Three.js ?debug 的 window.__rx）：屏幕左上角显示元素反应的实时计数——
    /// 每种反应 / 崩解的接受与执行次数、按来源（附着 / 引爆 / 强制）、每秒接受数、丢弃与合并、单帧峰值（接受 / 大特效 / 浮字，应 ≤ 预算）、
    /// 队列长度与熔池数。F9 开关，或代码里设 <see cref="Visible"/>（冒烟测试截图用）。F10 清零计数。
    /// 正式包（非 Development Build）里什么都不做。由 <see cref="SystemsBootstrap"/> 自动挂到 Game Systems。
    /// </summary>
    [GameSystem(900)]
    public sealed class CombatDebugOverlay : MonoBehaviour
    {
        /// <summary>显示叠层（F9 切换）</summary>
        public static bool Visible;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Visible = false;

        static readonly string[] Kinds = { "焚雷", "熔金", "封脉", "归墟", "崩解" };
        static readonly string[] Origins = { "附着", "引爆", "强制" };

        readonly StringBuilder sb = new(512);
        string text = "";
        float nextRefresh, secStart;
        int secBase, perSec;
        GUIStyle style;
        readonly GUIContent content = new();

        void Update()
        {
            if (!Debug.isDebugBuild) return;
            var kb = Keyboard.current;
            if (kb != null)
            {
                if (kb.f9Key.wasPressedThisFrame) Visible = !Visible;
                if (Visible && kb.f10Key.wasPressedThisFrame)
                {
                    ReactionSystem.Stats.Reset();
                    secBase = 0;
                }
            }
            var s = ReactionSystem.Stats;
            float now = Time.unscaledTime;
            if (now - secStart >= 1f || now < secStart)
            {
                int total = s.TotalAccepted;
                perSec = Mathf.Max(0, total - secBase);
                secBase = total;
                secStart = now;
            }
            if (Visible && now >= nextRefresh)
            {
                nextRefresh = now + 0.2f;
                text = Build(s, perSec);
            }
        }

        /// <summary>叠层文字（也给冒烟测试写进结果文件）</summary>
        public string Build(ReactionStats s, int acceptedPerSec)
        {
            sb.Clear();
            sb.Append("反应调试（F9 关 / F10 清零）\n");
            for (int i = 0; i < Kinds.Length; i++)
            {
                sb.Append(Kinds[i]).Append("  接受 ").Append(s.accepted[i]).Append("  执行 ").Append(s.executed[i]);
                sb.Append('\n');
            }
            for (int i = 0; i < Origins.Length; i++)
            {
                if (i > 0) sb.Append("  ");
                sb.Append(Origins[i]).Append(' ').Append(s.byOrigin[i]);
            }
            sb.Append('\n');
            sb.Append("每秒接受 ").Append(acceptedPerSec).Append("  丢弃 ").Append(s.dropped).Append("  并入引爆 ").Append(s.merged).Append('\n');
            sb.Append("单帧峰值：接受 ").Append(s.frameMax).Append('/').Append(CombatTuning.FrameBudget)
                .Append("  大特效 ").Append(s.bigFxFrameMax).Append('/').Append(CombatTuning.BigFxBudget)
                .Append("  浮字 ").Append(s.labelFrameMax).Append('/').Append(CombatTuning.LabelBudget).Append('\n');
            sb.Append("被挡：大特效 ").Append(s.bigFxDenied).Append("  浮字 ").Append(s.labelsDenied).Append('\n');
            sb.Append("队列 ").Append(s.queue).Append('/').Append(CombatTuning.QueueCap)
                .Append("  熔池 ").Append(s.pools).Append('/').Append(CombatTuning.Meltdown.MaxPools);
            if (s.errors > 0) sb.Append("  异常 ").Append(s.errors);
            return sb.ToString();
        }

        void OnGUI()
        {
            if (!Visible || !Debug.isDebugBuild) return;
            style ??= new GUIStyle(GUI.skin.box)
            {
                alignment = TextAnchor.UpperLeft, fontSize = 14, richText = false, wordWrap = false,
                normal = { textColor = new Color(0.95f, 0.95f, 0.9f) },
            };
            content.text = text;
            var size = style.CalcSize(content);
            GUI.Box(new Rect(12, 12, size.x + 8, size.y + 4), content, style);
        }
    }
}
