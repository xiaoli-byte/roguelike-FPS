using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一组一起撤回的预警（Three.js Hazards.ts 的 WarnScope 'move' / 'hazard'）：
    ///   招式自己兑现的预警（砸地、践踏、横扫、冲锋、跃击…）放进招式的 WarnScope，招式结束或被打断（换阶段、首领死亡）时 <see cref="Cancel"/>：
    ///   只撤回还没填满的（填满 = 已经兑现），约 0.1 s 淡出；
    ///   随已发出的危险物兑现的预警（巨石 / 陨石落点、成排地刺）放进另一个 WarnScope，只在清场时 <see cref="End"/>。
    /// 也可以登记别的特效句柄（光束、持续粒子），Cancel 时一起取消。using 块结束时自动 Cancel。
    /// 便捷方法与 <see cref="Telegraph"/> 同名同参，生成后自动登记。
    /// </summary>
    public sealed class WarnScope : IDisposable
    {
        readonly List<TelegraphHandle> warnings = new(8);
        readonly List<FxHandle> effects = new(4);

        /// <summary>调试用的名字（「move」「hazard」、招式名…）</summary>
        public string Name { get; }

        public WarnScope(string name = null) => Name = name;

        /// <summary>还在填充、撤回时会被撤掉的预警数</summary>
        public int PendingCount
        {
            get
            {
                int n = 0;
                foreach (var w in warnings)
                    if (w.Pending) n++;
                return n;
            }
        }

        /// <summary>还在显示的预警数（含已填满、正在收尾的）</summary>
        public int AliveCount
        {
            get
            {
                int n = 0;
                foreach (var w in warnings)
                    if (w.Alive) n++;
                return n;
            }
        }

        public TelegraphHandle Add(TelegraphHandle h)
        {
            if (!h.Alive) return h;
            if (warnings.Count >= 32) Prune();
            warnings.Add(h);
            return h;
        }

        public FxHandle Add(FxHandle h)
        {
            if (!h.Alive) return h;
            if (effects.Count >= 32) Prune();
            effects.Add(h);
            return h;
        }

        // ───────────── 便捷生成（同 Telegraph） ─────────────

        public TelegraphHandle Spawn(in TelegraphSpec spec) => Add(Telegraph.Spawn(spec));
        public TelegraphHandle Circle(Vector3 center, float radius, float duration, Color color) => Add(Telegraph.Circle(center, radius, duration, color));
        public TelegraphHandle Annulus(Vector3 center, float inner, float outer, float duration, Color color) => Add(Telegraph.Annulus(center, inner, outer, duration, color));

        public TelegraphHandle Sector(Vector3 center, float yawDeg, float halfAngleDeg, float radius, float duration, Color color, float inner = 0) =>
            Add(Telegraph.Sector(center, yawDeg, halfAngleDeg, radius, duration, color, inner));

        public TelegraphHandle Lane(Vector3 from, Vector3 to, float width, float duration, Color color, float hold = 0) =>
            Add(Telegraph.Lane(from, to, width, duration, color, hold));

        public TelegraphHandle Spokes(Vector3 center, int count, float length, float width, float yawDeg, float duration, Color color, float inner = 0) =>
            Add(Telegraph.Spokes(center, count, length, width, yawDeg, duration, color, inner));

        public TelegraphHandle Polygon(Vector3 center, int sides, float radius, float yawDeg, float duration, Color color) =>
            Add(Telegraph.Polygon(center, sides, radius, yawDeg, duration, color));

        // ───────────── 撤回 ─────────────

        /// <summary>撤回组里还没填满的预警（已填满 = 已兑现，不撤），取消登记的其它特效；然后清空登记</summary>
        public void Cancel()
        {
            foreach (var w in warnings) w.Cancel();
            foreach (var e in effects) e.Cancel();
            warnings.Clear();
            effects.Clear();
        }

        /// <summary>全部立刻收起（清场：首领死亡 / 释放），不管填没填满</summary>
        public void End()
        {
            foreach (var w in warnings) w.End();
            foreach (var e in effects) e.Cancel();
            warnings.Clear();
            effects.Clear();
        }

        /// <summary>这个预警登记在组里</summary>
        public bool Contains(TelegraphHandle h)
        {
            foreach (var w in warnings)
                if (w.Same(h))
                    return true;
            return false;
        }

        /// <summary>把一个预警从组里摘出来（不动它）：前摇里画的落点预警在出手时交给另一组（招式组 → 危险物组）；返回它原本在不在组里</summary>
        public bool Release(TelegraphHandle h) => warnings.RemoveAll(w => w.Same(h)) > 0;

        /// <summary>只忘掉登记，不动它们（预警照常播完）</summary>
        public void Clear()
        {
            warnings.Clear();
            effects.Clear();
        }

        public void Dispose() => Cancel();

        void Prune()
        {
            warnings.RemoveAll(w => !w.Alive);
            effects.RemoveAll(e => !e.Alive);
        }
    }
}
