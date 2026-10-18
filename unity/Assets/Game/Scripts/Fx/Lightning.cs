using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>闪电弧（雷殛弹射、焚雷、封脉导流、归墟天雷）：折线 LineRenderer，加色，0.2 s 内闪两次折线后淡出</summary>
    public sealed class Lightning : MonoBehaviour
    {
        const int Segments = 9;
        const float Life = 0.22f;

        LineRenderer line;
        Vector3 from, to;
        Color color;
        float age, jitter, nextJag;

        public static void Spawn(Vector3 from, Vector3 to, Color color, float width = 0.07f)
        {
            var go = new GameObject("Lightning");
            var l = go.AddComponent<Lightning>();
            l.from = from;
            l.to = to;
            l.color = color;
            l.jitter = Mathf.Clamp(Vector3.Distance(from, to) * 0.08f, 0.12f, 0.6f);
            l.line = go.AddComponent<LineRenderer>();
            l.line.positionCount = Segments + 1;
            l.line.sharedMaterial = FxMaterials.Additive;
            l.line.widthMultiplier = width;
            l.line.numCapVertices = 2;
            l.line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            l.Jag();
            ShotFx.Instance?.MuzzleFlash(to, 1.2f);
        }

        void Jag()
        {
            var dir = to - from;
            var side = Vector3.Cross(dir, Vector3.up);
            if (side.sqrMagnitude < 1e-4f) side = Vector3.Cross(dir, Vector3.right);
            side.Normalize();
            var up = Vector3.Cross(side, dir).normalized;
            for (int i = 0; i <= Segments; i++)
            {
                float t = i / (float)Segments;
                var p = Vector3.Lerp(from, to, t);
                if (i > 0 && i < Segments)
                {
                    float k = Mathf.Sin(t * Mathf.PI) * jitter;
                    p += side * Random.Range(-k, k) + up * Random.Range(-k, k);
                }
                line.SetPosition(i, p);
            }
            nextJag = age + 0.07f;
        }

        void Update()
        {
            age += Time.deltaTime;
            if (age >= Life)
            {
                Destroy(gameObject);
                return;
            }
            if (age >= nextJag) Jag();
            float a = 1 - age / Life;
            var c = new Color(Mathf.Lerp(1, color.r, 0.6f), Mathf.Lerp(1, color.g, 0.6f), Mathf.Lerp(1, color.b, 0.6f), a);
            line.startColor = c;
            line.endColor = new Color(color.r, color.g, color.b, a);
        }
    }
}
