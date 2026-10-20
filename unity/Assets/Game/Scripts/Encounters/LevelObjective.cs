using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 关卡目标图（docs/unity-parity.md 3.10「目标图：必清 / 可选 / N 选 M / 终点」；D27 并入第四章开放图规则）：
    ///   必清场地：全部肃清，顺序不限（要强制先后就在场地的 requires 里写）；
    ///   可选场地：只列出来（罗盘 / 结算用），不影响出口；
    ///   灵火坛：M 座里点亮 N 座（<see cref="altarsNeeded"/>；0 = 不要求）。
    /// 条件全部满足 → <see cref="Completed"/>（出口传送门升起、清关宝箱由 <see cref="ExitPortal"/> 处理）。
    /// 目标栏：没在交战时显示「肃清据点 2/4 · 点亮灵火 1/3」；完成后交给出口写「前往出口」。
    /// 数组都空且 <see cref="autoCollect"/> 时，开局按场景收集：非可选的场地 = 必清，可选的 = 可选，全部灵火坛。
    /// </summary>
    public sealed class LevelObjective : MonoBehaviour
    {
        [Tooltip("目标名（横幅 / 结算用，可空）")]
        public string title = "";
        public EncounterSite[] required = Array.Empty<EncounterSite>();
        public EncounterSite[] optional = Array.Empty<EncounterSite>();
        public SpiritAltar[] altars = Array.Empty<SpiritAltar>();
        [Tooltip("要点亮几座灵火坛（N 选 M 的 N；0 = 不要求）")]
        public int altarsNeeded;
        [Tooltip("数组都空时按场景收集场地和灵火坛")]
        public bool autoCollect = true;

        public bool Complete { get; private set; }
        public int RequiredCleared { get; private set; }
        public int RequiredTotal => required?.Length ?? 0;
        public int OptionalCleared { get; private set; }
        public int AltarsLit { get; private set; }
        /// <summary>实际要点亮的座数（不超过灵火坛总数）</summary>
        public int AltarsNeeded => Mathf.Clamp(altarsNeeded, 0, altars?.Length ?? 0);

        public event Action<LevelObjective> Completed;
        /// <summary>进度变化（肃清 / 点亮）</summary>
        public event Action<LevelObjective> Changed;
        public static event Action<LevelObjective> AnyCompleted;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => AnyCompleted = null;

        bool started;

        /// <summary>这个场景的目标（没有返回 null）</summary>
        public static LevelObjective For(Scene scene)
        {
            foreach (var o in FindObjectsByType<LevelObjective>())
                if (o.gameObject.scene == scene) return o;
            return null;
        }

        void Start()
        {
            Collect();
            started = true;
            GameEvents.EncounterCleared += OnSiteCleared;
            SpiritAltar.AnyLit += OnAltarLit;
            Refresh(false);
            ShowProgress();
        }

        void OnDestroy()
        {
            GameEvents.EncounterCleared -= OnSiteCleared;
            SpiritAltar.AnyLit -= OnAltarLit;
        }

        void Collect()
        {
            if (!autoCollect || RequiredTotal > 0 || (optional?.Length ?? 0) > 0 || (altars?.Length ?? 0) > 0) return;
            var req = new List<EncounterSite>();
            var opt = new List<EncounterSite>();
            foreach (var s in FindObjectsByType<EncounterSite>())
            {
                if (s.gameObject.scene != gameObject.scene) continue;
                (s.optional ? opt : req).Add(s);
            }
            req.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
            opt.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
            required = req.ToArray();
            optional = opt.ToArray();
            var alt = new List<SpiritAltar>();
            foreach (var a in FindObjectsByType<SpiritAltar>())
                if (a.gameObject.scene == gameObject.scene) alt.Add(a);
            alt.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
            altars = alt.ToArray();
        }

        void OnSiteCleared(EncounterSite s)
        {
            if (!s || s.gameObject.scene != gameObject.scene) return;
            Refresh(true);
            // 场地刚肃清（它把目标栏清空了）：没完成就写回总进度
            if (!Complete) ShowProgress();
        }

        void OnAltarLit(SpiritAltar a)
        {
            if (!a || a.gameObject.scene != gameObject.scene) return;
            Refresh(true);
            if (!Complete)
            {
                int need = AltarsNeeded;
                if (need > 0) GameUI.Toast($"灵火 {Mathf.Min(AltarsLit, need)} / {need}", SpiritAltar.FlameColor);
                ShowProgress();
            }
        }

        /// <summary>重新数进度；新完成时发事件（announce = 横幅提示）</summary>
        public void Refresh(bool announce)
        {
            int req = 0, opt = 0, lit = 0;
            if (required != null)
                foreach (var s in required)
                    if (!s || s.phase == EncounterSite.Phase.Cleared) req++;
            if (optional != null)
                foreach (var s in optional)
                    if (s && s.phase == EncounterSite.Phase.Cleared) opt++;
            if (altars != null)
                foreach (var a in altars)
                    if (a && a.Lit) lit++;
            bool changed = req != RequiredCleared || opt != OptionalCleared || lit != AltarsLit;
            RequiredCleared = req;
            OptionalCleared = opt;
            AltarsLit = lit;
            if (changed) Changed?.Invoke(this);
            if (Complete || !started) return;
            if (req < RequiredTotal || lit < AltarsNeeded) return;
            Complete = true;
            if (announce && !string.IsNullOrEmpty(title)) GameUI.Toast($"目标完成 · {title}", new Color(0.66f, 0.87f, 0.78f));
            Completed?.Invoke(this);
            AnyCompleted?.Invoke(this);
        }

        /// <summary>目标栏文字：「肃清据点 2/4 · 点亮灵火 1/3」（已完成为空）</summary>
        public string Describe()
        {
            if (Complete) return "";
            var sb = new StringBuilder();
            if (RequiredTotal > 0) sb.Append($"肃清据点 {RequiredCleared}/{RequiredTotal}");
            if (AltarsNeeded > 0)
            {
                if (sb.Length > 0) sb.Append(" · ");
                sb.Append($"点亮灵火 {Mathf.Min(AltarsLit, AltarsNeeded)}/{AltarsNeeded}");
                if (altars.Length > AltarsNeeded) sb.Append($"（共 {altars.Length} 处，任选）");
            }
            return sb.ToString();
        }

        /// <summary>没在交战时把总进度写进目标栏</summary>
        void ShowProgress()
        {
            if (EncounterSite.ActiveSites.Count > 0) return;
            var text = Describe();
            if (!string.IsNullOrEmpty(text)) GameUI.SetObjective(text);
        }
    }
}
