using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一条调试命令（docs/unity-parity.md 4.3：各单元自己的文件里加 [Defs] 子类）：id、显示名、热键、执行。
    /// 只在编辑器和 Development Build 里生效（<see cref="DevCommands.Enabled"/>）。
    /// </summary>
    public abstract class DevCommand : IDef
    {
        public abstract string Id { get; }
        /// <summary>显示名（提示、以后的调试面板）</summary>
        public abstract string Label { get; }
        /// <summary>热键（None = 只能用 <see cref="DevCommands.Run"/> 调）</summary>
        public virtual Key Hotkey => Key.None;
        /// <summary>只在正常游玩时响应热键（暂停、模态、结算、阵亡时不响应）</summary>
        public virtual bool PlayingOnly => true;
        public abstract void Execute();
    }

    /// <summary>
    /// 调试命令表（同 Three.js ?debug 的 F 键）：F1 无敌 · F2 清怪 · F3 秘卷三选一 · F4 掉一把随机枪 · F6 灵石 +1000 · F7 跳关（直接结算本关）。
    /// 非 Development Build 里整套关闭（命令类本身也只在编辑器 / Development Build 里编译）。
    /// </summary>
    public static class DevCommands
    {
        /// <summary>编辑器、Development Build 里为 true</summary>
        public static bool Enabled => Debug.isDebugBuild;

        public static IReadOnlyList<DevCommand> All => Registry<DevCommand>.All;

        /// <summary>按 id 执行；没开或没有这条命令返回 false</summary>
        public static bool Run(string id)
        {
            if (!Enabled) return false;
            var c = Registry<DevCommand>.Get(id);
            if (c == null) return false;
            Execute(c);
            return true;
        }

        /// <summary>检查热键（<see cref="DevCommandRunner"/> 每帧调用）</summary>
        public static void Poll()
        {
            if (!Enabled) return;
            foreach (var c in All)
            {
                if (!GameInput.KeyPressed(c.Hotkey)) continue;
                if (c.PlayingOnly && !GameStateMachine.IsPlaying) continue;
                Execute(c);
            }
        }

        static void Execute(DevCommand c)
        {
            try { c.Execute(); }
            catch (Exception e) { Debug.LogException(e); }
        }

        /// <summary>调试提示（统一前缀）</summary>
        public static void Say(string text) => GameUI.Toast("[调试] " + text, new Color(0.6f, 0.9f, 1f), 2f);
    }

    /// <summary>调试热键 + 时间仲裁自检（有人绕过 <see cref="TimeScaleArbiter"/> 直接写 Time.timeScale 时报一次警告）。自动挂到 Game Systems 上</summary>
    [GameSystem(900)]
    public sealed class DevCommandRunner : MonoBehaviour
    {
        bool warned;

        void Update()
        {
            if (!DevCommands.Enabled)
            {
                enabled = false;
                return;
            }
            DevCommands.Poll();
        }

        void LateUpdate()
        {
            if (warned || !TimeScaleArbiter.Tampered) return;
            warned = true;
            Debug.LogWarning($"[TimeScale] Time.timeScale = {Time.timeScale}，仲裁结果是 {TimeScaleArbiter.Current}：有代码绕过 TimeScaleArbiter 直接写了时间缩放");
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>F1 无敌（再按一次关）</summary>
    [Defs]
    public sealed class GodModeCommand : DevCommand
    {
        public override string Id => "god";
        public override string Label => "无敌";
        public override Key Hotkey => Key.F1;

        public override void Execute()
        {
            var pv = PlayerVitals.Instance;
            if (!pv) return;
            bool on = !float.IsPositiveInfinity(pv.invulnerableUntil);
            pv.invulnerableUntil = on ? float.PositiveInfinity : -1;
            DevCommands.Say(on ? "无敌：开" : "无敌：关");
        }
    }

    /// <summary>F2 清掉场上所有敌人（走处决：算击杀、照常掉落和推进场地）</summary>
    [Defs]
    public sealed class KillAllCommand : DevCommand
    {
        public override string Id => "kill_all";
        public override string Label => "清怪";
        public override Key Hotkey => Key.F2;

        public override void Execute()
        {
            int n = 0;
            foreach (var ai in EnemyAI.All.ToArray())
            {
                if (!ai) continue;
                var d = ai.Health;
                if (!d || d.Dead) continue;
                Combat.Execute(d, false);
                n++;
            }
            DevCommands.Say($"清怪 {n} 只");
        }
    }

    /// <summary>F3 弹一次秘卷三选一（走秘卷沙盒；按 id 授予 / 满层 / 清空见 <see cref="ScrollSandbox"/> 与 scroll_all / scroll_max / scroll_clear 命令）</summary>
    [Defs]
    public sealed class GrantScrollCommand : DevCommand
    {
        public override string Id => "scroll";
        public override string Label => "秘卷三选一";
        public override Key Hotkey => Key.F3;

        public override void Execute()
        {
            if (!ScrollSandbox.Offer(3)) DevCommands.Say("没有掉落系统，无法弹出秘卷三选一");
        }
    }

    /// <summary>F4 在面前掉一把随机枪（随机品质）</summary>
    [Defs]
    public sealed class GrantWeaponCommand : DevCommand
    {
        public override string Id => "weapon";
        public override string Label => "随机武器";
        public override Key Hotkey => Key.F4;

        public override void Execute()
        {
            var pv = PlayerVitals.Instance;
            var all = WeaponLibrary.All;
            if (!pv || all.Count == 0) return;
            var rng = RunState.Ensure().Stream("dev");
            var def = rng.Pick(all);
            var fwd = Vector3.ProjectOnPlane(pv.transform.forward, Vector3.up).normalized;
            WeaponPickup.Drop(new WeaponInstance(def, rng.Int(0, 4)), pv.transform.position + fwd * 2f + Vector3.up, Vector3.up * 3f);
        }
    }

    /// <summary>F6 灵石 +1000</summary>
    [Defs]
    public sealed class GrantCoinsCommand : DevCommand
    {
        public override string Id => "coins";
        public override string Label => "灵石 +1000";
        public override Key Hotkey => Key.F6;

        public override void Execute()
        {
            RunState.Ensure().Credit(1000, "dev");
            DevCommands.Say("灵石 +1000");
        }
    }

    /// <summary>F7 跳关：直接结算本关（场景流转 L1 落地后改成进下一关）</summary>
    [Defs]
    public sealed class SkipStageCommand : DevCommand
    {
        public override string Id => "skip_stage";
        public override string Label => "跳关";
        public override Key Hotkey => Key.F7;

        public override void Execute()
        {
            var s = GameSession.Instance;
            if (s && !s.Completed) s.CompleteStage();
        }
    }
#endif
}
