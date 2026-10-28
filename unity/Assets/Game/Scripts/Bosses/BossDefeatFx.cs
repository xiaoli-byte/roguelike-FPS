using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领倒下演出的特效时间轴（特效打磨 C 路）：首领倒下时行为组件已经停用（EnemyAI 关掉 Update），按时间放的倒下特效挂这个独立组件上——
    /// 在首领物体上按 at 秒排好一串动作，逐帧放，放完自己移除。首领物体被回收时自然停止。
    /// 用法：<c>BossDefeatFx.On(gameObject).At(0, () =&gt; …).At(2.4f, () =&gt; …)</c>
    /// </summary>
    public sealed class BossDefeatFx : MonoBehaviour
    {
        readonly List<(float at, Action run)> steps = new();
        float t;

        public static BossDefeatFx On(GameObject host)
        {
            if (!host || !Application.isPlaying) return null;
            if (!host.TryGetComponent(out BossDefeatFx fx)) fx = host.AddComponent<BossDefeatFx>();
            return fx;
        }

        /// <summary>倒下后 at 秒放 run（0 = 下一帧）</summary>
        public BossDefeatFx At(float at, Action run)
        {
            if (run != null) steps.Add((Mathf.Max(0, at), run));
            return this;
        }

        void Update()
        {
            t += Time.deltaTime;
            for (int i = steps.Count - 1; i >= 0; i--)
            {
                if (t < steps[i].at) continue;
                var run = steps[i].run;
                steps.RemoveAt(i);
                try
                {
                    run();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            if (steps.Count == 0) Destroy(this);
        }
    }
}
