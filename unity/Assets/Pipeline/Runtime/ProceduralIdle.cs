using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Art
{
    /// <summary>
    /// 非人形（Generic）角色在没有动画片段时的程序待机：躯干呼吸、头部轻摆、尾巴 / 飘带 / 耳朵从根到梢的波动。
    /// 只在静止姿势上叠加小幅旋转，不改骨骼长度；有 Animator 控制器的资产不需要它。
    /// </summary>
    public sealed class ProceduralIdle : MonoBehaviour
    {
        [Range(0f, 3f)] public float amplitude = 1f;
        [Range(0.1f, 3f)] public float speed = 1f;
        public float phase;

        struct Joint
        {
            public Transform t;
            public Quaternion rest;
            public Vector3 axis;
            public float degrees;
            public float lag;
        }

        readonly List<Joint> joints = new();

        static readonly (string match, Vector3 axis, float deg)[] Body =
        {
            ("spine", Vector3.right, 1.6f), ("chest", Vector3.right, 2.2f), ("neck", Vector3.right, 2f), ("head", Vector3.forward, 3f),
            ("sac", Vector3.right, 6f), ("hips", Vector3.up, 1.2f),
        };

        static readonly string[] Chains = { "tail", "banner", "ribbon", "ear", "skirt", "pagoda", "bell" };

        void Awake()
        {
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                string n = t.name.ToLowerInvariant();
                foreach (var (match, axis, deg) in Body)
                    if (n == match) Add(t, axis, deg, 0f);
                foreach (var c in Chains)
                {
                    if (!n.StartsWith(c)) continue;
                    // 链节序号（tail_3 / banner_L2 的末位数字）决定相位延迟：波从根部往梢部传
                    int idx = 0;
                    for (int i = n.Length - 1; i >= 0 && char.IsDigit(n[i]); i--) idx = n[i] - '0';
                    Add(t, Vector3.right, 7f + idx * 2f, idx * 0.6f);
                }
            }
            if (phase == 0f) phase = Random.value * 10f;
        }

        void Add(Transform t, Vector3 axis, float deg, float lag) =>
            joints.Add(new Joint { t = t, rest = t.localRotation, axis = axis, degrees = deg, lag = lag });

        void LateUpdate()
        {
            float time = Time.time * speed * 1.6f + phase;
            foreach (var j in joints)
            {
                float a = Mathf.Sin(time - j.lag) * j.degrees * amplitude;
                j.t.localRotation = j.rest * Quaternion.AngleAxis(a, j.axis);
            }
        }
    }
}
